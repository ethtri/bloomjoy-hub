import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { fetchReviewedReleaseSource, manifestPath, validateReleaseManifestGitAnchor } from './refund-release.mjs';

const manifestRelativePath = 'scripts/refunds/refund-production-release.json';
const baseManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

const fixture = (t, changeCanonical = () => {}) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'refund-squash-proof-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, {
    cwd: root, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  const write = (name, text) => {
    const target = path.join(root, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, text);
  };
  const commit = (message) => { git('add', '.'); git('commit', '-m', message); return git('rev-parse', 'HEAD'); };
  git('init', '-b', 'main');
  git('config', 'user.email', 'fixture@example.invalid');
  git('config', 'user.name', 'Refund provenance fixture');
  git('config', 'core.autocrlf', 'false');
  write('src/refund.ts', 'export const outcome = "old";\n');
  write('Docs/fixture.md', 'Original documentation\n');
  write(manifestRelativePath, JSON.stringify(baseManifest));
  const base = commit('base');
  git('checkout', '-b', 'reviewed');
  write('src/refund.ts', 'export const outcome = "reviewed";\n');
  const source = commit('reviewed source');
  const manifest = { ...baseManifest, sourceGitCommit: source };
  write(manifestRelativePath, JSON.stringify(manifest));
  const reviewedAnchor = commit('pin source');
  git('checkout', 'main');
  git('merge', '--squash', 'reviewed');
  changeCanonical({ root, git, write, manifest });
  const canonicalAnchor = commit('squashed reviewed change');
  git('branch', '-D', 'reviewed');
  return { root, git, write, commit, base, source, manifest, reviewedAnchor, canonicalAnchor };
};

test('ordinary squash proves canonical source without a source-pointer repair commit', (t) => {
  const f = fixture(t);
  assert.equal(f.git('rev-parse', `${f.reviewedAnchor}^{tree}`), f.git('rev-parse', `${f.canonicalAnchor}^{tree}`));
  assert.throws(() => f.git('merge-base', '--is-ancestor', f.source, 'HEAD'));
  const before = fs.readFileSync(path.join(f.root, manifestRelativePath));
  const proof = validateReleaseManifestGitAnchor(f.root, f.manifest);
  assert.equal(proof.squashEquivalentAnchor, f.canonicalAnchor);
  assert.equal(proof.sourceGitCommit, f.source);
  assert.deepEqual(fs.readFileSync(path.join(f.root, manifestRelativePath)), before);
  f.write('Docs/fixture.md', 'Later release-neutral documentation\n');
  const docsHead = f.commit('docs only');
  const later = validateReleaseManifestGitAnchor(f.root, f.manifest);
  assert.equal(later.anchorGitCommit, docsHead);
  assert.equal(later.squashEquivalentAnchor, f.canonicalAnchor);
});

for (const [label, mutate] of [
  ['changed runtime', ({ write }) => write('src/refund.ts', 'export const outcome = "different";\n')],
  ['added file', ({ write }) => write('public/unreviewed.json', '{}\n')],
  ['deleted file', ({ root }) => fs.unlinkSync(path.join(root, 'src/refund.ts'))],
  ['renamed file', ({ git }) => git('mv', 'src/refund.ts', 'src/renamed.ts')],
  ['changed file mode', ({ git }) => git('update-index', '--chmod=+x', 'src/refund.ts')],
  ['changed neutral documentation before anchor', ({ write }) => write('Docs/fixture.md', 'Not the reviewed full tree\n')],
]) {
  test(`squash equivalence rejects ${label}`, (t) => {
    const f = fixture(t, mutate);
    assert.throws(() => validateReleaseManifestGitAnchor(f.root, f.manifest), /no verified squash-equivalent anchor/);
  });
}

test('unrelated branch equivalence cannot replace canonical history', (t) => {
  const f = fixture(t, ({ write }) => write('Docs/fixture.md', 'Unreviewed canonical tree\n'));
  f.git('branch', 'kept-review', f.reviewedAnchor);
  assert.throws(() => validateReleaseManifestGitAnchor(f.root, f.manifest), /no verified squash-equivalent anchor/);
});

test('missing source, dirty checkout and canonical source-pointer mismatch fail closed', (t) => {
  const f = fixture(t);
  assert.throws(() => validateReleaseManifestGitAnchor(f.root, { ...f.manifest, sourceGitCommit: 'f'.repeat(40) }), /does not exist/);
  f.write('untracked.txt', 'unreviewed\n');
  assert.throws(() => validateReleaseManifestGitAnchor(f.root, f.manifest), /clean Git worktree/);
  fs.unlinkSync(path.join(f.root, 'untracked.txt'));
  f.write(manifestRelativePath, JSON.stringify({ ...f.manifest, sourceGitCommit: f.base }));
  f.commit('different source pointer');
  assert.throws(() => validateReleaseManifestGitAnchor(f.root, f.manifest), /no verified squash-equivalent anchor/);
});

test('later protected changes still fail and an exact reversion preserves source equivalence', (t) => {
  const f = fixture(t);
  f.write('src/refund.ts', 'export const outcome = "unreviewed";\n');
  f.commit('later protected change');
  assert.throws(() => validateReleaseManifestGitAnchor(f.root, f.manifest), /Protected refund release paths changed/);
  f.write('src/refund.ts', 'export const outcome = "reviewed";\n');
  f.commit('exact reversion');
  assert.equal(validateReleaseManifestGitAnchor(f.root, f.manifest).squashEquivalentAnchor, f.canonicalAnchor);
});

test('fresh main-only clone explicitly retrieves the pinned object then proves canonical equivalence', (t) => {
  const f = fixture(t);
  // GitHub retains the reviewed commit under its PR ref after deleting the branch.
  f.git('update-ref', 'refs/pull/1/head', f.reviewedAnchor);
  const clone = fs.mkdtempSync(path.join(os.tmpdir(), 'refund-fresh-clone-'));
  t.after(() => fs.rmSync(clone, { recursive: true, force: true }));
  execFileSync('git', ['clone', '--no-local', '--single-branch', '--branch', 'main', f.root, clone],
    { windowsHide: true, stdio: 'pipe' });
  assert.throws(() => validateReleaseManifestGitAnchor(clone, f.manifest), /does not exist/);
  const calls = [];
  const runGit = (args) => {
    calls.push(args);
    if (args[0] === 'remote') return { status: 0, stdout: 'https://github.com/ethtri/bloomjoy-hub.git\n' };
    return spawnSync('git', args, { cwd: clone, encoding: 'utf8', windowsHide: true });
  };
  assert.deepEqual(fetchReviewedReleaseSource(clone, f.manifest, { runGit }),
    { fetched: true, sourceGitCommit: f.source });
  assert.deepEqual(calls.find((args) => args[0] === 'fetch'),
    ['fetch', '--no-tags', '--no-write-fetch-head', 'origin', f.source]);
  assert.equal(validateReleaseManifestGitAnchor(clone, f.manifest).squashEquivalentAnchor, f.canonicalAnchor);
  assert.deepEqual(fetchReviewedReleaseSource(clone, f.manifest, { runGit }),
    { fetched: false, sourceGitCommit: f.source });
  assert.equal(calls.filter((args) => args[0] === 'fetch').length, 1);
  const wrongPointer = { ...f.manifest, sourceGitCommit: f.reviewedAnchor };
  assert.equal(fetchReviewedReleaseSource(clone, wrongPointer, { runGit }).fetched, true);
  assert.throws(() => validateReleaseManifestGitAnchor(clone, wrongPointer), /no verified squash-equivalent anchor/,
    'Fetching a real object with an identical final tree cannot substitute a different source pointer');
});

test('retrieval rejects wrong origin, malformed source, wrong project and unverifiable fetched object', () => {
  for (const manifest of [
    { ...baseManifest, sourceGitCommit: '--untrusted' },
    { ...baseManifest, projectRef: 'z'.repeat(20) },
  ]) {
    assert.throws(() => fetchReviewedReleaseSource('.', manifest, {
      runGit: () => assert.fail('Invalid manifest must not run Git'),
    }), /sourceGitCommit is invalid|exact production project/);
  }
  assert.throws(() => fetchReviewedReleaseSource('.', baseManifest, {
    runGit: (args) => {
      assert.equal(args[0], 'remote');
      return { status: 0, stdout: 'https://github.com/other/repository.git' };
    },
  }), /exact Bloomjoy GitHub origin/);
  for (const fetchStatus of [0, 1]) {
    assert.throws(() => fetchReviewedReleaseSource('.', baseManifest, {
      runGit: (args) => args[0] === 'remote'
        ? { status: 0, stdout: 'https://github.com/ethtri/bloomjoy-hub.git' }
        : { status: args[0] === 'fetch' ? fetchStatus : 1, stdout: '' },
    }), /Unable to retrieve the exact pinned reviewed source/);
  }
});
