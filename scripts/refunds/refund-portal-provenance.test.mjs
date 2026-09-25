import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { buildMetadata, METADATA_PATH, safePublicPath, sha256, sourceIdentity, successfulProductionDeploymentSha, verifyServedPortal } from './refund-portal-provenance.mjs';

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

async function withServer(overrides, run) {
  const routes = new Map(files);
  routes.set('/refunds', files.get('/index.html'));
  routes.set(METADATA_PATH, Buffer.from(JSON.stringify(metadata)));
  for (const [key, value] of overrides) routes.set(key, value);
  const server = createServer((request, response) => {
    const value = routes.get(request.url);
    if (value === null || value === undefined) { response.writeHead(404).end(); return; }
    if (value === 'unavailable') { response.writeHead(503).end(); return; }
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
    assert.deepEqual(sourceIdentity(root, {}), { sourceSha: null, provenance: 'unsupported' });
    assert.deepEqual(sourceIdentity(root, { VERCEL_ENV: 'production', VERCEL_GIT_COMMIT_SHA: SHA }),
      { sourceSha: SHA, provenance: 'production_claimed' });
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
    await writeFile(path.join(root, 'source.txt'), 'changed');
    assert.equal(sourceIdentity(root, { VERCEL_ENV: 'production', VERCEL_GIT_COMMIT_SHA: sourceIdentity(root, {}).sourceSha }).provenance,
      'dirty');
  } finally { await rm(root, { recursive: true, force: true }); }
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

test('served canonical index and manifest assets verify against a successful Production SHA', async () => {
  await withServer([], async (origin) => {
    const result = await verifyServedPortal({ origin, expectedSha: SHA });
    assert.equal(result.sourceSha, SHA);
    assert.equal(result.verifiedAssetCount, 3);
    assert.equal(result.deploymentVerified, true);
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
    const result = await verifyServedPortal({ origin, expectedSha: SHA });
    assert.equal(result.servedIndexBuildPath, altPath);
    assert.equal(result.verifiedAssetCount, 3);
  });
});

test('missing metadata or assets and unavailable responses fail', async () => {
  for (const override of [
    [[METADATA_PATH, null]], [['/assets/app.js', null]], [['/assets/app.css', 'unavailable']],
  ]) await withServer(override, async (origin) => {
    await assert.rejects(verifyServedPortal({ origin, expectedSha: SHA }), /Unavailable or redirected/);
  });
});

test('tampered bytes and mixed old index with new assets fail', async () => {
  for (const override of [
    [['/assets/app.js', Buffer.from('tampered')]],
    [['/refunds', Buffer.from(html.replace('app.js', 'old.js'))]],
  ]) await withServer(override, async (origin) => {
    await assert.rejects(verifyServedPortal({ origin, expectedSha: SHA }), /digest mismatch/);
  });
});

test('wrong or unsupported source provenance cannot pass as production', async () => {
  await withServer([], async (origin) => {
    await assert.rejects(verifyServedPortal({ origin, expectedSha: 'b'.repeat(40) }), /source does not match/);
  });
  await withServer([[METADATA_PATH, Buffer.from(JSON.stringify({ ...metadata, provenance: 'local_clean' }))]],
    async (origin) => assert.rejects(verifyServedPortal({ origin, expectedSha: SHA }), /source does not match/));
});

test('unsafe, external, encoded, and traversal paths are rejected before asset fetch', async () => {
  for (const unsafe of ['https://evil.example/app.js', '//evil.example/app.js', '/assets/../admin',
    '/assets/%2e%2e/admin', '/assets/app.js?token=x', '/assets\\app.js']) {
    assert.throws(() => safePublicPath(unsafe), /Unsafe/);
    const malicious = { ...metadata, assets: [{ path: unsafe, sha256: '0'.repeat(64), size: 1 }, ...inventory] };
    await withServer([[METADATA_PATH, Buffer.from(JSON.stringify(malicious))]], async (origin) => {
      await assert.rejects(verifyServedPortal({ origin, expectedSha: SHA }), /Unsafe/);
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
    await assert.rejects(verifyServedPortal({ origin, expectedSha: SHA }), /Unsafe/);
  });
});
