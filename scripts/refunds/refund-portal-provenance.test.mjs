import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { buildMetadata, independentArtifactComparison, METADATA_PATH, safePublicPath, sha256,
  sourceIdentity, successfulMainBuildRun, successfulProductionDeploymentSha,
  verifiedVercelAliasDeployment, verifyServedPortal } from './refund-portal-provenance.mjs';

const SHA = 'a'.repeat(40);
const html = '<html><head><link rel="stylesheet" href="/assets/app.css"></head><body><script type="module" src="/assets/app.js"></script></body></html>';
const files = new Map([
  ['/index.html', Buffer.from(html)],
  ['/assets/app.css', Buffer.from('body { color: pink }')],
  ['/assets/app.js', Buffer.from('console.log("portal")')],
]);
const inventory = [...files].map(([file, bytes]) => ({ path: file, sha256: sha256(bytes), size: bytes.length }))
  .sort((a, b) => a.path.localeCompare(b.path, 'en'));
const metadata = {
  schemaVersion: 1, sourceSha: SHA, provenance: 'production_claimed',
  portalIndexAssets: ['/index.html'],
  entryAssets: ['/assets/app.css', '/assets/app.js'],
  manifestAssets: ['/assets/app.css', '/assets/app.js'], assets: inventory,
};
const trustedBuild = { ...metadata, provenance: 'local_clean' };

async function withServer(overrides, run) {
  const routes = new Map(files);
  routes.set('/refunds', files.get('/index.html'));
  routes.set(METADATA_PATH, Buffer.from(JSON.stringify(metadata)));
  for (const [key, value] of overrides) routes.set(key, value);
  const server = createServer((request, response) => {
    const value = routes.get(request.url);
    if (value === null || value === undefined) { response.writeHead(404).end(); return; }
    if (value === 'unavailable') { response.writeHead(503).end(); return; }
    if (value?.redirect) { response.writeHead(302, { location: value.redirect }).end(); return; }
    response.writeHead(200).end(value);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try { return await run(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise((resolve) => server.close(resolve)); }
}

test('final build inventory is deterministic and excludes private Vite manifest and metadata self-hash', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'refund-portal-build-'));
  try {
    const dist = path.join(root, 'dist');
    await mkdir(path.join(dist, 'assets'), { recursive: true });
    await mkdir(path.join(dist, '.vite'));
    for (const [file, bytes] of files) await writeFile(path.join(dist, file.slice(1)), bytes);
    await writeFile(path.join(dist, '.vite', 'manifest.json'), JSON.stringify({
      'index.html': { file: 'assets/app.js', css: ['assets/app.css'], isEntry: true },
    }));
    await writeFile(path.join(dist, METADATA_PATH.slice(1)), 'old metadata');
    const first = await buildMetadata({ root, dist, env: {} });
    const second = await buildMetadata({ root, dist, env: {} });
    assert.deepEqual(first, second);
    assert.equal(first.provenance, 'unsupported');
    assert.deepEqual(first.assets, inventory);
    assert.equal(first.assets.some(({ path: file }) => file.includes('.vite') || file === METADATA_PATH), false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('a platform production SHA is a claim while local or missing identity stays explicit', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'refund-portal-no-git-'));
  try {
    assert.deepEqual(sourceIdentity(root, {}),
      { sourceSha: null, provenance: 'unsupported', trackedSourceClean: null,
        trackedSourceEquivalent: null });
    assert.deepEqual(sourceIdentity(root, { VERCEL_ENV: 'production', VERCEL_GIT_COMMIT_SHA: SHA }),
      { sourceSha: SHA, provenance: 'production_claimed', trackedSourceClean: null,
        trackedSourceEquivalent: null });
    assert.equal(sourceIdentity(root, { VERCEL_ENV: 'production', VERCEL_GIT_COMMIT_SHA: 'short' }).provenance,
      'unsupported');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('a clean local checkout and dirty source cannot be labeled as a verified Production build', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'refund-portal-git-'));
  const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'ignore' });
  try {
    git('init', '-q');
    git('config', 'user.email', 'fixture@example.invalid');
    git('config', 'user.name', 'Fixture');
    await writeFile(path.join(root, 'source.txt'), 'first');
    git('add', 'source.txt');
    git('commit', '-qm', 'fixture');
    assert.equal(sourceIdentity(root, {}).provenance, 'local_clean');
    assert.equal(sourceIdentity(root, {}).trackedSourceClean, true);
    assert.equal(sourceIdentity(root, {}).trackedSourceEquivalent, true);
    const cleanSha = sourceIdentity(root, {}).sourceSha;
    assert.equal(sourceIdentity(root, { VERCEL_ENV: 'production',
      VERCEL_GIT_COMMIT_SHA: cleanSha }).provenance, 'production_claimed');
    await writeFile(path.join(root, 'generated-untracked.txt'), 'generated');
    assert.equal(sourceIdentity(root, {}).provenance, 'dirty');
    assert.equal(sourceIdentity(root, {}).trackedSourceClean, true);
    assert.equal(sourceIdentity(root, {}).trackedSourceEquivalent, false);
    await writeFile(path.join(root, 'source.txt'), 'changed');
    assert.equal(sourceIdentity(root, { VERCEL_ENV: 'production', VERCEL_GIT_COMMIT_SHA: sourceIdentity(root, {}).sourceSha }).provenance,
      'dirty');
    assert.equal(sourceIdentity(root, {}).trackedSourceClean, false);
    assert.equal(sourceIdentity(root, {}).trackedSourceEquivalent, false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('sole Vercel config formatting drift is equivalent but remains byte-dirty', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'refund-portal-vercel-config-'));
  const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'ignore' });
  try {
    git('init', '-q');
    git('config', 'user.email', 'fixture@example.invalid');
    git('config', 'user.name', 'Fixture');
    await writeFile(path.join(root, 'vercel.json'), '{\n  "installCommand": "npm ci",\n  "routes": []\n}\n');
    await writeFile(path.join(root, 'source.txt'), 'same');
    git('add', '.');
    git('commit', '-qm', 'fixture');
    await writeFile(path.join(root, 'vercel.json'), '{"routes":[],"installCommand":"npm ci"}\n');
    assert.equal(sourceIdentity(root, {}).trackedSourceClean, false);
    assert.equal(sourceIdentity(root, {}).trackedSourceEquivalent, true);
    await writeFile(path.join(root, 'vercel.json'), '{"routes":[],"installCommand":"npm install"}\n');
    assert.equal(sourceIdentity(root, {}).trackedSourceEquivalent, false);
    await writeFile(path.join(root, 'vercel.json'), '{"routes":[],"installCommand":"npm ci"}\n');
    await writeFile(path.join(root, 'source.txt'), 'changed');
    assert.equal(sourceIdentity(root, {}).trackedSourceEquivalent, false);
    await writeFile(path.join(root, 'source.txt'), 'same');
    await writeFile(path.join(root, 'extra.txt'), 'untracked input');
    assert.equal(sourceIdentity(root, {}).trackedSourceEquivalent, false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('independent CI-byte equality is reported separately from served-byte checks', async () => {
  await withServer([], async (origin) => {
    const noArtifact = await verifyServedPortal({ origin, expectedSha: SHA });
    assert.equal(noArtifact.servedAssetsConsistent, true);
    assert.equal(noArtifact.ciArtifactMatch, false);
    assert.equal(noArtifact.sourceEvidenceVerified, false);
    assert.match(noArtifact.sourceEvidenceReason, /Neither equivalent complete build inputs/);
    const changed = { ...trustedBuild, assets: trustedBuild.assets.map((asset) =>
      asset.path === '/assets/app.js' ? { ...asset, sha256: '0'.repeat(64) } : asset) };
    const compared = await verifyServedPortal({ origin, expectedSha: SHA, trustedBuild: changed });
    assert.equal(compared.ciArtifactMatch, false);
    assert.equal(compared.sourceEvidenceVerified, false);
    assert.match(compared.ciArtifactReason, /Different build output/);
    assert.equal(independentArtifactComparison(trustedBuild, metadata, SHA).ciArtifactMatch, true);
  });
});

test('equivalent tracked inputs verify source evidence when independent build bytes differ', async () => {
  const served = { ...metadata, trackedSourceClean: false, trackedSourceEquivalent: true };
  const differentBuild = { ...trustedBuild, assets: trustedBuild.assets.map((asset) =>
    asset.path === '/assets/app.js' ? { ...asset, sha256: '0'.repeat(64) } : asset) };
  await withServer([[METADATA_PATH, Buffer.from(JSON.stringify(served))]], async (origin) => {
    const result = await verifyServedPortal({ origin, expectedSha: SHA, trustedBuild: differentBuild });
    assert.equal(result.servedAssetsConsistent, true);
    assert.equal(result.ciArtifactMatch, false);
    assert.equal(result.trackedSourceClean, false);
    assert.equal(result.trackedSourceEquivalent, true);
    assert.equal(result.sourceEvidenceVerified, true);
  });
});

test('tracked-clean metadata cannot verify source if untracked inputs remain', async () => {
  const served = { ...metadata, trackedSourceClean: true, trackedSourceEquivalent: false };
  const differentBuild = { ...trustedBuild, assets: trustedBuild.assets.map((asset) =>
    asset.path === '/assets/app.js' ? { ...asset, sha256: '0'.repeat(64) } : asset) };
  await withServer([[METADATA_PATH, Buffer.from(JSON.stringify(served))]], async (origin) => {
    const result = await verifyServedPortal({ origin, expectedSha: SHA, trustedBuild: differentBuild });
    assert.equal(result.servedAssetsConsistent, true);
    assert.equal(result.trackedSourceClean, true);
    assert.equal(result.trackedSourceEquivalent, false);
    assert.equal(result.ciArtifactMatch, false);
    assert.equal(result.sourceEvidenceVerified, false);
  });
});

test('external canonical redirect is rejected without fetching its Location', async () => {
  await withServer([['/refunds', { redirect: 'https://example.invalid/private' }]],
    async (origin) => {
      const requested = [];
      await assert.rejects(verifyServedPortal({ origin, expectedSha: SHA, trustedBuild,
        fetchImpl: (url, options) => {
          requested.push(url.href);
          return fetch(url, options);
        } }), /Unavailable or redirected/);
      assert.equal(requested.some((url) => url.startsWith('https://example.invalid/')), false);
    });
});

test('GitHub source identity requires the exact latest successful Production deployment', () => {
  const deployment = { id: 123, environment: 'Production', sha: SHA };
  const statuses = [{ state: 'success', environment: 'Production' }];
  assert.equal(successfulProductionDeploymentSha(deployment, statuses, 123), SHA);
  for (const [record, history, id] of [
    [deployment, [{ state: 'failure', environment: 'Production' }], 123],
    [{ ...deployment, environment: 'Preview' }, statuses, 123],
    [deployment, statuses, 456],
    [{ ...deployment, sha: 'short' }, statuses, 123],
  ]) assert.throws(() => successfulProductionDeploymentSha(record, history, id), /successful GitHub Production/);
});

test('Vercel alias, project, READY deployment and GitHub target bind the canonical identity', () => {
  const projectId = 'prj_expected';
  const aliasName = 'app.bloomjoyusa.com';
  const deployment = { id: 'dpl_expected', projectId, url: 'expected.vercel.app',
    target: 'production', readyState: 'READY', source: 'git',
    meta: { githubCommitSha: SHA, githubCommitRef: 'main' } };
  const alias = { alias: aliasName, projectId, deploymentId: deployment.id,
    deployment: { id: deployment.id, url: deployment.url } };
  const expected = { aliasName, projectId, expectedSha: SHA,
    githubStatusUrl: `https://${deployment.url}` };
  assert.equal(verifiedVercelAliasDeployment(alias, deployment, expected).deploymentId,
    deployment.id);
  for (const [a, d, args] of [
    [{ ...alias, alias: 'other.example.com' }, deployment, expected],
    [{ ...alias, projectId: 'prj_other' }, deployment, expected],
    [{ ...alias, deploymentId: 'dpl_old' }, deployment, expected],
    [alias, { ...deployment, readyState: 'ERROR' }, expected],
    [alias, { ...deployment, meta: { ...deployment.meta, githubCommitSha: 'b'.repeat(40) } }, expected],
    [alias, { ...deployment, projectId: 'prj_other' }, expected],
    [alias, deployment, { ...expected, githubStatusUrl: 'https://old.vercel.app' }],
  ]) assert.throws(() => verifiedVercelAliasDeployment(a, d, args), /Canonical alias/);
});

test('independent build anchor accepts only a successful main push at the exact SHA', () => {
  const valid = { databaseId: 17, headSha: SHA, headBranch: 'main', event: 'push', conclusion: 'success' };
  assert.deepEqual(successfulMainBuildRun([valid], SHA), valid);
  for (const changed of [
    { headSha: 'b'.repeat(40) }, { headBranch: 'feature' }, { event: 'pull_request' },
    { conclusion: 'failure' }, { databaseId: 0 },
  ]) assert.throws(() => successfulMainBuildRun([{ ...valid, ...changed }], SHA),
    /No successful independent CI build/);
});

test('served canonical index and manifest assets verify against a successful Production SHA', async () => {
  await withServer([], async (origin) => {
    const result = await verifyServedPortal({ origin, expectedSha: SHA, trustedBuild });
    assert.equal(result.sourceSha, SHA);
    assert.equal(result.verifiedAssetCount, 3);
    assert.equal(result.servedAssetsConsistent, true);
    assert.equal(result.ciArtifactMatch, true);
    assert.equal(result.sourceEvidenceVerified, true);
    assert.equal(result.servedIndexBuildPath, '/index.html');
    assert.deepEqual(result.verifiedAssetDigests,
      [{ path: '/refunds', sha256: sha256(files.get('/index.html')) },
        ...inventory.filter(({ path: file }) => file !== '/index.html')
          .map(({ path: file, sha256: digest }) => ({ path: file, sha256: digest }))]);
  });
});

test('canonical refund route may serve an emitted prerendered index with the same entry assets', async () => {
  const prerendered = html.replace('<head>', '<head><meta name="robots" content="noindex">');
  const altPath = '/refunds/index.html';
  const alt = { path: altPath, sha256: sha256(Buffer.from(prerendered)), size: Buffer.byteLength(prerendered) };
  const changed = { ...metadata, portalIndexAssets: ['/index.html', altPath],
    assets: [...inventory, alt].sort((a, b) => a.path.localeCompare(b.path, 'en')) };
  await withServer([
    ['/refunds', Buffer.from(prerendered)],
    [METADATA_PATH, Buffer.from(JSON.stringify(changed))],
  ], async (origin) => {
    const result = await verifyServedPortal({ origin, expectedSha: SHA,
      trustedBuild: { ...changed, provenance: 'local_clean' } });
    assert.equal(result.servedIndexBuildPath, altPath);
    assert.equal(result.verifiedAssetCount, 3);
  });
});

test('missing metadata or assets and unavailable responses fail', async () => {
  for (const override of [
    [[METADATA_PATH, null]], [['/assets/app.js', null]], [['/assets/app.css', 'unavailable']],
  ]) await withServer(override, async (origin) => {
    await assert.rejects(verifyServedPortal({ origin, expectedSha: SHA, trustedBuild }), /Unavailable or redirected/);
  });
});

test('tampered bytes and mixed old index with new assets fail', async () => {
  for (const override of [
    [['/assets/app.js', Buffer.from('tampered')]],
    [['/refunds', Buffer.from(html.replace('app.js', 'old.js'))]],
  ]) await withServer(override, async (origin) => {
    await assert.rejects(verifyServedPortal({ origin, expectedSha: SHA, trustedBuild }), /digest mismatch/);
  });
});

test('wrong or unsupported source provenance cannot pass as production', async () => {
  await withServer([], async (origin) => {
    await assert.rejects(verifyServedPortal({ origin, expectedSha: 'b'.repeat(40), trustedBuild }), /source does not match/);
  });
  await withServer([[METADATA_PATH, Buffer.from(JSON.stringify({ ...metadata, provenance: 'local_clean' }))]],
    async (origin) => assert.rejects(verifyServedPortal({ origin, expectedSha: SHA, trustedBuild }), /source does not match/));
});

test('dirty tracked-source evidence remains explicit while independent identity can be checked', async () => {
  const changed = { ...metadata, provenance: 'dirty', trackedSourceClean: false };
  await withServer([[METADATA_PATH, Buffer.from(JSON.stringify(changed))]],
    async (origin) => {
      const result = await verifyServedPortal({ origin, expectedSha: SHA, trustedBuild });
      assert.equal(result.servedAssetsConsistent, true);
      assert.equal(result.claimedBuildProvenance, 'dirty');
      assert.equal(result.trackedSourceClean, false);
      assert.equal(result.ciArtifactMatch, true);
      assert.equal(result.sourceEvidenceVerified, true);
    });
});

test('unsafe, external, encoded, and traversal paths are rejected before asset fetch', async () => {
  for (const unsafe of ['https://evil.example/app.js', '//evil.example/app.js', '/assets/../admin',
    '/assets/%2e%2e/admin', '/assets/app.js?token=x', '/assets\\app.js']) {
    assert.throws(() => safePublicPath(unsafe), /Unsafe/);
    const malicious = { ...metadata, assets: [{ path: unsafe, sha256: '0'.repeat(64), size: 1 }, ...inventory] };
    await withServer([[METADATA_PATH, Buffer.from(JSON.stringify(malicious))]], async (origin) => {
      await assert.rejects(verifyServedPortal({ origin, expectedSha: SHA, trustedBuild }), /Unsafe/);
    });
  }
});

test('a metadata-consistent external entry URL still fails the index relationship check', async () => {
  const unsafeHtml = html.replace('/assets/app.js', 'https://evil.example/app.js');
  const changed = { ...metadata, assets: inventory.map((asset) => asset.path === '/index.html'
    ? { ...asset, sha256: sha256(Buffer.from(unsafeHtml)), size: Buffer.byteLength(unsafeHtml) }
    : asset) };
  await withServer([
    ['/refunds', Buffer.from(unsafeHtml)],
    [METADATA_PATH, Buffer.from(JSON.stringify(changed))],
  ], async (origin) => {
    await assert.rejects(verifyServedPortal({ origin, expectedSha: SHA,
      trustedBuild: { ...changed, provenance: 'local_clean' } }), /Unsafe/);
  });
});
