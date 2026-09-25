import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const METADATA_PATH = '/refund-portal-build.json';
export const PORTAL_INDEX_PATH = '/refunds';
const SHA = /^[a-f0-9]{40}$/;
const DIGEST = /^[a-f0-9]{64}$/;

export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

export function successfulProductionDeploymentSha(deployment, statuses, requestedId) {
  if (deployment?.id !== requestedId || deployment.environment !== 'Production' ||
      !SHA.test(deployment.sha ?? '') || !Array.isArray(statuses) ||
      statuses[0]?.state !== 'success' || statuses[0]?.environment !== 'Production')
    throw new Error('Deployment is not the requested successful GitHub Production deployment');
  return deployment.sha;
}

export function successfulMainBuildRun(runs, expectedSha) {
  const run = Array.isArray(runs) && runs.find((candidate) =>
    candidate.headSha === expectedSha && candidate.headBranch === 'main' &&
    candidate.event === 'push' && candidate.conclusion === 'success' &&
    Number.isSafeInteger(candidate.databaseId) && candidate.databaseId > 0);
  if (!run) throw new Error('No successful independent CI build on main for deployment SHA');
  return run;
}

export function safePublicPath(value) {
  const isFile = typeof value === 'string' &&
    /\.(?:html|js|css|ico|jpe?g|png|svg|webp|mp4|txt|xml|json|webmanifest|woff2?|pdf)$/.test(value);
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') ||
      value.includes('\\') || /[%?#\u0000-\u001f]/.test(value) ||
      value.split('/').slice(1).some((segment) => !segment || segment.startsWith('.') || segment === 'api' || segment.startsWith('_')) ||
      (!isFile && value !== PORTAL_INDEX_PATH) ||
      value === METADATA_PATH) throw new Error(`Unsafe public asset path: ${String(value)}`);
  return value;
}

function git(root, args) {
  try { return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch { return null; }
}

const canonicalJson = (value) => value && typeof value === 'object'
  ? Array.isArray(value)
    ? value.map(canonicalJson)
    : Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalJson(value[key])]))
  : value;

export function semanticallyUnchangedVercelConfig(root) {
  try {
    const committed = JSON.parse(execFileSync('git', ['show', 'HEAD:vercel.json'],
      { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
    const checkout = JSON.parse(readFileSync(path.join(root, 'vercel.json'), 'utf8'));
    return JSON.stringify(canonicalJson(committed)) === JSON.stringify(canonicalJson(checkout));
  } catch { return false; }
}

// Build-log diagnostics only. Tracked paths are already public repository
// inputs; untracked names may be private, so report their digest and safe
// top-level category without writing names, contents, or environment values.
export function sourceBuildDiagnostics(root) {
  let porcelain;
  try {
    porcelain = execFileSync('git', ['status', '--porcelain=v1', '--untracked-files=normal'],
      { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return { gitAvailable: false, tracked: [], untracked: [], vercelConfigEquivalent: false };
  }
  const tracked = [];
  const untracked = [];
  for (const line of porcelain.split(/\r?\n/).filter(Boolean)) {
    const status = line.slice(0, 2).replaceAll(' ', '_');
    const rawPath = line.slice(3);
    if (status === '??') {
      const rootSegment = rawPath.split('/')[0];
      untracked.push({ status, category: ['.vercel', 'dist', 'public', 'scripts', 'src',
        'supabase'].includes(rootSegment) ? rootSegment : 'other', pathDigest: sha256(rawPath) });
    } else {
      const safePath = /^[A-Za-z0-9._/-]+$/.test(rawPath) &&
        !rawPath.split('/').some((segment) => segment.startsWith('.env'));
      tracked.push({ status, path: safePath ? rawPath : '[redacted]',
        ...(!safePath ? { pathDigest: sha256(rawPath) } : {}) });
    }
  }
  return { gitAvailable: true, tracked, untracked,
    vercelConfigEquivalent: semanticallyUnchangedVercelConfig(root) };
}

export function sourceIdentity(root, env = process.env) {
  const head = git(root, ['rev-parse', 'HEAD']);
  const dirty = git(root, ['status', '--porcelain', '--untracked-files=normal']);
  const trackedDirty = git(root, ['status', '--porcelain', '--untracked-files=no']);
  const deploySha = env.VERCEL_GIT_COMMIT_SHA?.toLowerCase();
  const sourceSha = deploySha || head?.toLowerCase() || null;
  const trackedSourceClean = trackedDirty === null ? null : trackedDirty.length === 0;
  // Vercel's Git checkout reserializes only vercel.json into one-line JSON.
  // Keep literal byte cleanliness false, but separately attest equivalent
  // build inputs only if there are no other tracked or untracked changes.
  const trackedSourceEquivalent = dirty === null ? null :
    dirty.length === 0 || (dirty === 'M vercel.json' && semanticallyUnchangedVercelConfig(root));
  if (!SHA.test(sourceSha ?? '') || (deploySha && head && deploySha !== head.toLowerCase()))
    return { sourceSha: SHA.test(sourceSha ?? '') ? sourceSha : null,
      provenance: 'unsupported', trackedSourceClean, trackedSourceEquivalent };
  if (dirty === null && !head && env.VERCEL_ENV === 'production' && deploySha)
    return { sourceSha, provenance: 'production_claimed', trackedSourceClean, trackedSourceEquivalent };
  if (dirty === null || dirty.length) return { sourceSha,
    provenance: dirty === null ? 'unsupported' : 'dirty', trackedSourceClean, trackedSourceEquivalent };
  if (env.VERCEL_ENV === 'production' && deploySha)
    return { sourceSha, provenance: 'production_claimed', trackedSourceClean, trackedSourceEquivalent };
  if (env.VERCEL_ENV === 'production')
    return { sourceSha, provenance: 'unsupported', trackedSourceClean, trackedSourceEquivalent };
  return { sourceSha, provenance: 'local_clean', trackedSourceClean, trackedSourceEquivalent };
}

export function verifiedVercelAliasDeployment(alias, deployment, {
  aliasName, projectId, expectedSha, githubStatusUrl,
}) {
  const url = deployment?.url && `https://${deployment.url}`;
  if (alias?.alias !== aliasName || alias?.projectId !== projectId ||
      alias?.deploymentId !== deployment?.id ||
      alias?.deployment?.id !== deployment?.id ||
      alias?.deployment?.url !== deployment?.url ||
      deployment?.projectId !== projectId || deployment?.target !== 'production' ||
      deployment?.readyState !== 'READY' || deployment?.source !== 'git' ||
      deployment?.meta?.githubCommitSha !== expectedSha ||
      deployment?.meta?.githubCommitRef !== 'main' ||
      !/^[a-z0-9-]+\.vercel\.app$/.test(deployment?.url ?? '') ||
      githubStatusUrl !== url)
    throw new Error('Canonical alias is not the expected READY Production deployment');
  return { deploymentId: deployment.id, deploymentUrl: url,
    projectId, sourceSha: expectedSha };
}

async function publicFiles(root, relative = '') {
  const entries = await readdir(path.join(root, relative), { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const child = path.posix.join(relative.replaceAll('\\', '/'), entry.name);
    if (child === '.vite' || child === METADATA_PATH.slice(1)) continue;
    if (entry.isSymbolicLink()) throw new Error(`Build output contains a symlink: ${child}`);
    if (entry.isDirectory()) files.push(...await publicFiles(root, child));
    else if (entry.isFile()) files.push(child);
  }
  return files;
}

export function manifestPaths(manifest) {
  const files = new Set();
  for (const entry of Object.values(manifest)) {
    for (const file of [entry.file, ...(entry.css ?? []), ...(entry.assets ?? [])]) {
      if (file) files.add(safePublicPath(`/${file}`));
    }
  }
  const index = manifest['index.html'];
  if (!index?.isEntry || !index.file) throw new Error('Vite index entry is missing');
  const imports = (index.imports ?? []).map((key) => {
    if (!manifest[key]?.file) throw new Error('Vite index import is missing from manifest');
    return manifest[key].file;
  });
  return { manifestAssets: [...files].sort(),
    entryAssets: [index.file, ...(index.css ?? []), ...imports]
      .map((item) => safePublicPath(`/${item}`)).sort() };
}

export function indexEntryPaths(html) {
  const paths = new Set();
  for (const tag of html.match(/<(?:script|link)\b[^>]*>/gi) ?? []) {
    const isEntry = /^<script\b/i.test(tag) || /\brel=["'](?:stylesheet|modulepreload)["']/i.test(tag);
    if (!isEntry) continue;
    const match = tag.match(/\b(?:src|href)=["']([^"']+)["']/i);
    if (match) paths.add(safePublicPath(match[1]));
  }
  return [...paths].sort();
}

export async function buildMetadata({ root, dist, env = process.env }) {
  const manifest = JSON.parse(await readFile(path.join(dist, '.vite', 'manifest.json'), 'utf8'));
  const { manifestAssets, entryAssets } = manifestPaths(manifest);
  const paths = (await publicFiles(dist)).map((file) => safePublicPath(`/${file}`)).sort();
  const assetSet = new Set(paths);
  if (!assetSet.has('/index.html') || manifestAssets.some((file) => !assetSet.has(file)))
    throw new Error('Vite manifest references a missing public asset');
  const portalIndexAssets = ['/index.html', '/refunds.html', '/refunds/index.html']
    .filter((file) => assetSet.has(file)).sort();
  for (const indexPath of portalIndexAssets) {
    const indexHtml = await readFile(path.join(dist, indexPath.slice(1)), 'utf8');
    if (JSON.stringify(indexEntryPaths(indexHtml)) !== JSON.stringify(entryAssets))
      throw new Error(`Final portal index does not reference the Vite entry assets: ${indexPath}`);
  }
  const assets = [];
  for (const publicPath of paths) {
    const bytes = await readFile(path.join(dist, publicPath.slice(1)));
    assets.push({ path: publicPath, sha256: sha256(bytes), size: bytes.length });
  }
  return { schemaVersion: 1, ...sourceIdentity(root, env), portalIndexAssets, entryAssets, manifestAssets, assets };
}

export async function emitMetadata(options) {
  const metadata = await buildMetadata(options);
  await writeFile(path.join(options.dist, METADATA_PATH.slice(1)), `${JSON.stringify(metadata)}\n`);
  return metadata;
}

export function validateMetadata(metadata, expectedSha) {
  if (metadata?.schemaVersion !== 1 ||
      !['production_claimed', 'dirty'].includes(metadata.provenance) ||
      !SHA.test(metadata.sourceSha ?? '') || metadata.sourceSha !== expectedSha)
    throw new Error('Portal source does not match the successful Production deployment');
  if (metadata.trackedSourceClean !== undefined &&
      metadata.trackedSourceClean !== null &&
      typeof metadata.trackedSourceClean !== 'boolean')
    throw new Error('Invalid tracked-source cleanliness attestation');
  if (metadata.trackedSourceEquivalent !== undefined &&
      metadata.trackedSourceEquivalent !== null &&
      typeof metadata.trackedSourceEquivalent !== 'boolean')
    throw new Error('Invalid tracked-source equivalence attestation');
  if (!Array.isArray(metadata.assets) || !Array.isArray(metadata.manifestAssets) ||
      !Array.isArray(metadata.entryAssets) || !Array.isArray(metadata.portalIndexAssets) ||
      metadata.assets.length > 2000 || metadata.manifestAssets.length > 1000)
    throw new Error('Invalid portal asset inventory');
  const paths = metadata.assets.map((asset) => safePublicPath(asset.path));
  if (JSON.stringify(paths) !== JSON.stringify([...new Set(paths)].sort()) || !paths.includes('/index.html'))
    throw new Error('Portal asset inventory is missing, duplicated, or unordered');
  let totalSize = 0;
  for (const asset of metadata.assets) {
    if (!DIGEST.test(asset.sha256) || !Number.isSafeInteger(asset.size) || asset.size < 0 || asset.size > 50_000_000)
      throw new Error(`Invalid digest or size for ${asset.path}`);
    totalSize += asset.size;
  }
  if (totalSize > 200_000_000) throw new Error('Portal asset inventory exceeds size limit');
  for (const group of [metadata.manifestAssets, metadata.entryAssets]) {
    if (JSON.stringify(group) !== JSON.stringify([...new Set(group)].sort()) ||
        group.some((item) => !item.startsWith('/assets/') || !paths.includes(safePublicPath(item))))
      throw new Error('Invalid Vite asset relationship');
  }
  if (!metadata.portalIndexAssets.includes('/index.html') ||
      JSON.stringify(metadata.portalIndexAssets) !== JSON.stringify([...new Set(metadata.portalIndexAssets)].sort()) ||
      metadata.portalIndexAssets.some((item) => !item.endsWith('.html') || !paths.includes(safePublicPath(item))))
    throw new Error('Invalid portal index inventory');
  if (metadata.entryAssets.length === 0 || metadata.entryAssets.some((item) => !metadata.manifestAssets.includes(item)))
    throw new Error('Index entry is not in the Vite manifest inventory');
}

export function independentArtifactComparison(trustedBuild, servedMetadata, expectedSha) {
  if (trustedBuild?.sourceSha !== expectedSha ||
      trustedBuild.provenance !== 'local_clean' ||
      servedMetadata?.sourceSha !== expectedSha)
    return { ciArtifactMatch: false, ciArtifactReason: 'Independent main build source unavailable or mismatched' };
  const fields = ['portalIndexAssets', 'entryAssets', 'manifestAssets', 'assets'];
  const changed = fields.filter((field) =>
    JSON.stringify(trustedBuild[field]) !== JSON.stringify(servedMetadata[field]));
  return { ciArtifactMatch: changed.length === 0,
    ciArtifactReason: changed.length ? `Different build output: ${changed.join(', ')}` : null };
}

async function fetchBytes(origin, publicPath, fetchImpl, maxBytes) {
  const url = new URL(publicPath === METADATA_PATH ? METADATA_PATH : safePublicPath(publicPath), origin);
  if (url.origin !== origin) throw new Error(`Asset escapes canonical origin: ${publicPath}`);
  const response = await fetchImpl(url, { redirect: 'manual', signal: AbortSignal.timeout(15000), cache: 'no-store' });
  if (!response.ok || response.redirected || response.url !== url.href)
    throw new Error(`Unavailable or redirected public asset: ${publicPath} (${response.status})`);
  if (!response.body) throw new Error(`Empty public asset response: ${publicPath}`);
  const chunks = [];
  let received = 0;
  for await (const chunk of response.body) {
    received += chunk.length;
    if (received > maxBytes) throw new Error(`Oversized public asset response: ${publicPath}`);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export async function verifyServedPortal({ origin, expectedSha, trustedBuild, fetchImpl = fetch }) {
  const canonical = new URL(origin);
  if (canonical.protocol !== 'https:' && canonical.hostname !== '127.0.0.1' && canonical.hostname !== 'localhost')
    throw new Error('Portal origin must use HTTPS');
  if (canonical.origin !== origin || canonical.pathname !== '/' || canonical.search || canonical.hash)
    throw new Error('Expected an exact canonical origin');
  if (!SHA.test(expectedSha ?? '')) throw new Error('Expected deployment SHA must be full length');
  const metadataBytes = await fetchBytes(origin, METADATA_PATH, fetchImpl, 2_000_000);
  const metadata = JSON.parse(metadataBytes.toString('utf8'));
  validateMetadata(metadata, expectedSha);
  const artifactComparison = independentArtifactComparison(trustedBuild, metadata, expectedSha);
  const sourceEvidenceVerified = metadata.trackedSourceEquivalent === true ||
    artifactComparison.ciArtifactMatch;
  const inventory = new Map(metadata.assets.map((asset) => [asset.path, asset]));
  const servedIndex = await fetchBytes(origin, PORTAL_INDEX_PATH, fetchImpl, 5_000_000);
  const indexDigest = sha256(servedIndex);
  const servedIndexBuildPath = metadata.portalIndexAssets.find((file) => {
    const expected = inventory.get(file);
    return expected.size === servedIndex.length && expected.sha256 === indexDigest;
  });
  if (!servedIndexBuildPath) throw new Error('Served portal index digest mismatch');
  const entryAssets = indexEntryPaths(servedIndex.toString('utf8'));
  if (JSON.stringify(entryAssets) !== JSON.stringify(metadata.entryAssets))
    throw new Error('Served index references different entry assets');
  const verifiedAssets = [{ path: PORTAL_INDEX_PATH, sha256: indexDigest }];
  const checkedPaths = new Set(metadata.manifestAssets);
  for (const asset of metadata.assets.filter((item) => checkedPaths.has(item.path))) {
    const bytes = await fetchBytes(origin, asset.path, fetchImpl, asset.size);
    if (bytes.length !== asset.size || sha256(bytes) !== asset.sha256)
      throw new Error(`Served asset digest mismatch: ${asset.path}`);
    verifiedAssets.push({ path: asset.path, sha256: asset.sha256 });
  }
  return { canonicalUrl: `${origin}${PORTAL_INDEX_PATH}`, observedAt: new Date().toISOString(), sourceSha: expectedSha,
    servedAssetsConsistent: true, claimedBuildProvenance: metadata.provenance,
    trackedSourceClean: metadata.trackedSourceClean ?? null,
    trackedSourceEquivalent: metadata.trackedSourceEquivalent ?? null,
    sourceEvidenceVerified,
    sourceEvidenceReason: sourceEvidenceVerified ? null :
      'Neither equivalent complete build inputs nor identical independent CI bytes are proven',
    ...artifactComparison,
    servedIndexBuildPath, inventoryAssetCount: metadata.assets.length,
    verifiedAssetCount: verifiedAssets.length, verifiedAssetDigests: verifiedAssets };
}
