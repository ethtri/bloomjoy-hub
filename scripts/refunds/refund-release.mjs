#!/usr/bin/env node

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const scriptDirectory = path.dirname(scriptPath);
export const repoRoot = path.resolve(scriptDirectory, '..', '..');
export const manifestPath = path.join(scriptDirectory, 'refund-production-release.json');

// The pre-#427 evidence is immutable; additions belong only to the current inventory.
export const historicalFunctionSlugs = [
  'refund-case-intake',
  'nayax-transaction-lookup',
  'refund-case-admin-update',
  'refund-case-message-send',
  'refund-case-automation-sweep',
  'refund-gmail-sync',
  'refund-gpt-triage',
  'nayax-card-refund',
  'refund-manager-action-step-up',
  'refund-manager-totp-enrollment',
];
export const additionalFunctionSlugs = ['refund-nayax-outcome-resolve'];
export const requiredFunctionSlugs = [...historicalFunctionSlugs, ...additionalFunctionSlugs];

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const normalizeText = (value) => value.replace(/\r\n?/g, '\n');
const normalizePath = (value) => value.split(path.sep).join('/');
const projectRefPattern = /^[a-z0-9]{20}$/;
const digestPattern = /^[a-f0-9]{64}$/;
const gitCommitPattern = /^[a-f0-9]{40}$/;
const refundMigrationPattern = /^\d+_[a-z0-9_]*(?:refund|nayax)[a-z0-9_]*\.sql$/;
const unsupportedFunctionConfigKeys = new Set(['entrypoint', 'import_map', 'static_files']);
const unsupportedFunctionConfigFiles = new Set(['deno.json', 'deno.jsonc', 'import_map.json']);

export const canonicalFunctionEntrypointIdentity = (slug) =>
  `supabase/functions/${slug}/index.ts`;

export const normalizeProductionEntrypointIdentity = (rawEntrypointPath, slug) => {
  if (!requiredFunctionSlugs.includes(slug) || typeof rawEntrypointPath !== 'string') return null;
  if (
    rawEntrypointPath.length === 0 ||
    rawEntrypointPath !== rawEntrypointPath.trim() ||
    rawEntrypointPath.includes('\\') ||
    rawEntrypointPath.includes('?') ||
    rawEntrypointPath.includes('#') ||
    /[\u0000-\u001f\u007f]/.test(rawEntrypointPath)
  ) {
    return null;
  }

  let pathValue = rawEntrypointPath;
  if (pathValue.startsWith('file://')) {
    if (!pathValue.startsWith('file:///')) return null;
    pathValue = pathValue.slice('file://'.length);
  } else if (/^[a-z][a-z0-9+.-]*:/i.test(pathValue)) {
    return null;
  }

  const canonicalIdentity = canonicalFunctionEntrypointIdentity(slug);
  if (pathValue !== canonicalIdentity && !pathValue.startsWith('/')) return null;

  for (const segment of pathValue.split('/')) {
    let decodedSegment = segment;
    try {
      for (let decodePass = 0; decodePass < 16; decodePass += 1) {
        const nextDecodedSegment = decodeURIComponent(decodedSegment);
        if (nextDecodedSegment === decodedSegment) break;
        decodedSegment = nextDecodedSegment;
        if (decodePass === 15) return null;
      }
    } catch {
      return null;
    }
    if (
      decodedSegment === '.' ||
      decodedSegment === '..' ||
      decodedSegment.includes('/') ||
      decodedSegment.includes('\\') ||
      decodedSegment.includes('?') ||
      decodedSegment.includes('#') ||
      /[\u0000-\u001f\u007f]/.test(decodedSegment)
    ) {
      return null;
    }
  }

  return pathValue === canonicalIdentity || pathValue.endsWith(`/${canonicalIdentity}`)
    ? canonicalIdentity
    : null;
};

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, 'utf8'));

const relativeImportSpecifiers = (source) => {
  const specifiers = new Set();
  const staticPattern = /(?:import|export)\s+(?:type\s+)?(?:[^'";]+?\s+from\s+)?['"]([^'"]+)['"]/g;
  const dynamicPattern = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

  for (const pattern of [staticPattern, dynamicPattern]) {
    for (const match of source.matchAll(pattern)) {
      if (match[1].startsWith('.')) {
        specifiers.add(match[1]);
      }
    }
  }

  return [...specifiers];
};

const resolveRelativeImport = (fromFile, specifier) => {
  const unresolvedPath = path.resolve(path.dirname(fromFile), specifier);
  const candidates = path.extname(unresolvedPath)
    ? [unresolvedPath]
    : [
        unresolvedPath,
        `${unresolvedPath}.ts`,
        `${unresolvedPath}.tsx`,
        `${unresolvedPath}.js`,
        `${unresolvedPath}.mjs`,
        path.join(unresolvedPath, 'index.ts'),
      ];

  return candidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile()) ?? null;
};

export const calculateFunctionSource = (rootDirectory, slug) => {
  const functionsRoot = path.resolve(rootDirectory, 'supabase', 'functions');
  const entrypoint = path.join(functionsRoot, slug, 'index.ts');
  assert(fs.existsSync(entrypoint), `Missing Edge Function entrypoint: ${slug}`);

  const pending = [entrypoint];
  const visited = new Set();
  const sourceByPath = new Map();

  while (pending.length > 0) {
    const currentFile = path.resolve(pending.pop());
    if (visited.has(currentFile)) {
      continue;
    }

    const relativeToFunctions = path.relative(functionsRoot, currentFile);
    assert(
      relativeToFunctions && !relativeToFunctions.startsWith('..') && !path.isAbsolute(relativeToFunctions),
      `Relative import escapes supabase/functions for ${slug}`
    );

    const source = normalizeText(fs.readFileSync(currentFile, 'utf8'));
    visited.add(currentFile);
    sourceByPath.set(normalizePath(path.relative(rootDirectory, currentFile)), source);

    for (const specifier of relativeImportSpecifiers(source)) {
      const dependency = resolveRelativeImport(currentFile, specifier);
      assert(
        dependency,
        `Unresolved relative import ${specifier} in ${normalizePath(path.relative(rootDirectory, currentFile))}`
      );
      pending.push(dependency);
    }
  }

  const files = [...sourceByPath.keys()].sort();
  const digestPayload = files.map((file) => `${file}\0${sourceByPath.get(file)}\0`).join('');

  return {
    sourceSha256: sha256(digestPayload),
    files,
  };
};

const readGitFileAtCommit = (rootDirectory, commit, repositoryPath, sourceCache) => {
  const cacheKey = `${commit}:${repositoryPath}`;
  if (sourceCache?.has(cacheKey)) return sourceCache.get(cacheKey);
  const result = spawnSync('git', ['show', `${commit}:${repositoryPath}`], {
    cwd: rootDirectory,
    encoding: 'utf8',
    windowsHide: true,
  });
  const source = result.status === 0 ? normalizeText(result.stdout) : null;
  sourceCache?.set(cacheKey, source);
  return source;
};

export const calculateFunctionSourceAtGitCommit = (
  rootDirectory,
  commit,
  slug,
  { sourceCache = new Map() } = {}
) => {
  assert(gitCommitPattern.test(commit), 'Source Git commit must be a full 40-character SHA');
  const functionsRoot = 'supabase/functions';
  const entrypoint = `${functionsRoot}/${slug}/index.ts`;
  const pending = [entrypoint];
  const visited = new Set();
  const sourceByPath = new Map();

  while (pending.length > 0) {
    const currentFile = pending.pop();
    if (visited.has(currentFile)) continue;
    assert(
      currentFile.startsWith(`${functionsRoot}/`) && !currentFile.includes('/../'),
      `Relative import escapes supabase/functions for ${slug}`
    );

    const source = readGitFileAtCommit(rootDirectory, commit, currentFile, sourceCache);
    assert(source !== null, `Missing Edge Function source at ${commit.slice(0, 12)}: ${currentFile}`);
    visited.add(currentFile);
    sourceByPath.set(currentFile, source);

    for (const specifier of relativeImportSpecifiers(source)) {
      const unresolved = path.posix.normalize(path.posix.join(path.posix.dirname(currentFile), specifier));
      const candidates = path.posix.extname(unresolved)
        ? [unresolved]
        : [
            unresolved,
            `${unresolved}.ts`,
            `${unresolved}.tsx`,
            `${unresolved}.js`,
            `${unresolved}.mjs`,
            `${unresolved}/index.ts`,
          ];
      const dependency = candidates.find(
        (candidate) =>
          readGitFileAtCommit(rootDirectory, commit, candidate, sourceCache) !== null
      );
      assert(dependency, `Unresolved relative import ${specifier} at ${commit.slice(0, 12)} in ${currentFile}`);
      pending.push(dependency);
    }
  }

  const files = [...sourceByPath.keys()].sort();
  const digestPayload = files.map((file) => `${file}\0${sourceByPath.get(file)}\0`).join('');
  return { sourceSha256: sha256(digestPayload), files };
};

export const calculateMigrationDigest = (rootDirectory, requiredMigrations) => {
  const migrationsDirectory = path.join(rootDirectory, 'supabase', 'migrations');
  const records = requiredMigrations.map((fileName) => {
    assert(/^\d+_[a-z0-9_]+\.sql$/.test(fileName), `Invalid migration manifest entry: ${fileName}`);
    const filePath = path.join(migrationsDirectory, fileName);
    assert(fs.existsSync(filePath), `Missing required migration: ${fileName}`);
    return `${fileName}\0${normalizeText(fs.readFileSync(filePath, 'utf8'))}\0`;
  });

  return sha256(records.join(''));
};

export const discoverRefundMigrationFiles = (rootDirectory) => {
  const migrationsDirectory = path.join(rootDirectory, 'supabase', 'migrations');
  return fs.readdirSync(migrationsDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && refundMigrationPattern.test(entry.name))
    .map((entry) => entry.name)
    .sort();
};

export const calculateMigrationVersionSetDigest = (requiredMigrations) =>
  sha256([...requiredMigrations].sort().join('\n'));

export const assertSupportedFunctionDeploymentInputs = (rootDirectory) => {
  const functionsDirectory = path.join(rootDirectory, 'supabase', 'functions');
  const pending = [functionsDirectory];

  while (pending.length > 0) {
    const directory = pending.pop();
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) pending.push(entryPath);
      else if (unsupportedFunctionConfigFiles.has(entry.name)) {
        throw new Error(
          `Unsupported Edge Function deployment input ${normalizePath(path.relative(rootDirectory, entryPath))}`
        );
      }
    }
  }
};

export const parseFunctionDeploymentConfig = (rootDirectory) => {
  const config = fs.readFileSync(path.join(rootDirectory, 'supabase', 'config.toml'), 'utf8');
  const values = new Map();
  let activeSlug = null;

  for (const rawLine of config.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const section = line.match(/^\[functions\.([a-z0-9-]+)\]$/);
    if (section) {
      activeSlug = section[1];
      continue;
    }
    if (line.startsWith('[')) {
      activeSlug = null;
      continue;
    }

    const setting = line.match(/^([a-z_]+)\s*=\s*(.+)$/);
    if (activeSlug && requiredFunctionSlugs.includes(activeSlug) && setting) {
      const [, key, rawValue] = setting;
      if (unsupportedFunctionConfigKeys.has(key) || key !== 'verify_jwt') {
        throw new Error(`Unsupported Supabase config key ${key} for ${activeSlug}`);
      }
      assert(/^(true|false)$/.test(rawValue), `verify_jwt is invalid for ${activeSlug}`);
      assert(!values.has(activeSlug), `Duplicate verify_jwt config for ${activeSlug}`);
      values.set(activeSlug, rawValue === 'true');
    }
  }

  return values;
};

export const validateManifestShape = (manifest, { allowPending = false } = {}) => {
  assert(manifest?.schemaVersion === 3, 'Refund production manifest schemaVersion must be 3');
  assert(manifest?.environment === 'production', 'Refund production manifest environment must be production');
  assert(projectRefPattern.test(manifest?.projectRef ?? ''), 'Refund production manifest projectRef is invalid');
  assert(
    Array.isArray(manifest?.requiredMigrations) && manifest.requiredMigrations.length > 0,
    'Required migrations are missing'
  );
  assert(Array.isArray(manifest?.functions), 'Refund production manifest functions are missing');
  assert(
    gitCommitPattern.test(manifest?.sourceGitCommit ?? '') ||
      (allowPending && manifest?.sourceGitCommit === 'pending'),
    'Refund production sourceGitCommit is invalid'
  );

  const migrations = manifest.requiredMigrations;
  assert(new Set(migrations).size === migrations.length, 'Refund production manifest contains duplicate migrations');
  assert(
    JSON.stringify(migrations) === JSON.stringify([...migrations].sort()),
    'Refund production manifest migrations must be sorted'
  );

  const slugs = manifest.functions.map((entry) => entry.slug);
  assert(
    JSON.stringify(slugs) === JSON.stringify(requiredFunctionSlugs),
    'Refund production manifest function order or allowlist is invalid'
  );
  assert(new Set(slugs).size === slugs.length, 'Refund production manifest contains duplicate functions');

  for (const entry of manifest.functions) {
    assert(typeof entry.verifyJwt === 'boolean', `verifyJwt is invalid for ${entry.slug}`);
    assert(
      digestPattern.test(entry.sourceSha256) || (allowPending && entry.sourceSha256 === 'pending'),
      `sourceSha256 is invalid for ${entry.slug}`
    );
    if (entry.production !== null) {
      assert(
        Number.isInteger(entry.production.version) && entry.production.version > 0,
        `Production version is invalid for ${entry.slug}`
      );
      assert(digestPattern.test(entry.production.ezbrSha256), `Production bundle digest is invalid for ${entry.slug}`);
      assert(digestPattern.test(entry.production.sourceSha256), `Production source digest is invalid for ${entry.slug}`);
      assert(
        entry.production.entrypointIdentity === canonicalFunctionEntrypointIdentity(entry.slug),
        `Production entrypoint identity is invalid for ${entry.slug}`
      );
    }
  }

  assert(
    digestPattern.test(manifest.migrationFilesSha256) ||
      (allowPending && manifest.migrationFilesSha256 === 'pending'),
    'migrationFilesSha256 is invalid'
  );
  assert(
    digestPattern.test(manifest.migrationVersionSetSha256) ||
      (allowPending && manifest.migrationVersionSetSha256 === 'pending'),
    'migrationVersionSetSha256 is invalid'
  );

  if (manifest.preMigrationCompatibility !== undefined) {
    const compatibility = manifest.preMigrationCompatibility;
    assert(
      compatibility && typeof compatibility.releaseId === 'string',
      'preMigrationCompatibility releaseId is invalid'
    );
    assert(
      gitCommitPattern.test(compatibility.sourceGitCommit ?? ''),
      'preMigrationCompatibility sourceGitCommit is invalid'
    );
    assert(
      Array.isArray(compatibility.requiredMigrations) && compatibility.requiredMigrations.length > 0,
      'preMigrationCompatibility required migrations are missing'
    );
    assert(
      new Set(compatibility.requiredMigrations).size === compatibility.requiredMigrations.length,
      'preMigrationCompatibility contains duplicate migrations'
    );
    assert(
      JSON.stringify(compatibility.requiredMigrations) ===
        JSON.stringify([...compatibility.requiredMigrations].sort()),
      'preMigrationCompatibility migrations must be sorted'
    );
    assert(
      digestPattern.test(compatibility.migrationFilesSha256 ?? ''),
      'preMigrationCompatibility migration digest is invalid'
    );
    assert(
      digestPattern.test(compatibility.migrationVersionSetSha256 ?? ''),
      'preMigrationCompatibility migration version digest is invalid'
    );
  }

  const approvedRestoreSource = manifest.approvedRestoreSource;
  assert(approvedRestoreSource && typeof approvedRestoreSource.releaseId === 'string', 'approvedRestoreSource is missing');
  assert(gitCommitPattern.test(approvedRestoreSource.sourceGitCommit ?? ''), 'approvedRestoreSource sourceGitCommit is invalid');
  assert(digestPattern.test(approvedRestoreSource.migrationFilesSha256 ?? ''), 'approvedRestoreSource migration digest is invalid');
  assert(
    digestPattern.test(approvedRestoreSource.migrationVersionSetSha256 ?? ''),
    'approvedRestoreSource migration version digest is invalid'
  );
  assert(Array.isArray(approvedRestoreSource.functions), 'approvedRestoreSource functions are missing');
  assert(
    JSON.stringify(approvedRestoreSource.functions.map((entry) => entry.slug)) ===
      JSON.stringify(historicalFunctionSlugs),
    'approvedRestoreSource function allowlist is invalid'
  );
  for (const entry of approvedRestoreSource.functions) {
    if (entry.restoreAction === 'disable') {
      assert(
        entry.sourceSha256 === undefined,
        `approvedRestoreSource disable-only entry must not include a source digest for ${entry.slug}`
      );
      continue;
    }
    assert(
      entry.restoreAction === undefined || entry.restoreAction === 'redeploy',
      `approvedRestoreSource restore action is invalid for ${entry.slug}`
    );
    assert(digestPattern.test(entry.sourceSha256 ?? ''), `approvedRestoreSource source digest is invalid for ${entry.slug}`);
  }

  if (manifest.preDeploymentProduction === null) {
    assert(allowPending, 'preDeploymentProduction baseline is missing');
  } else {
    assert(
      typeof manifest.preDeploymentCapturedAt === 'string' &&
        Number.isFinite(Date.parse(manifest.preDeploymentCapturedAt)),
      'preDeploymentCapturedAt is invalid'
    );
    assert(Array.isArray(manifest.preDeploymentProduction), 'preDeploymentProduction baseline is invalid');
    assert(
      JSON.stringify(manifest.preDeploymentProduction.map((entry) => entry.slug)) ===
        JSON.stringify(historicalFunctionSlugs),
      'preDeploymentProduction function allowlist is invalid'
    );
    for (const entry of manifest.preDeploymentProduction) {
      assert(entry.status === 'ACTIVE' || entry.status === 'MISSING', `preDeploymentProduction status is invalid for ${entry.slug}`);
      if (entry.status === 'ACTIVE') {
        assert(Number.isInteger(entry.version) && entry.version > 0, `preDeploymentProduction version is invalid for ${entry.slug}`);
        assert(typeof entry.verifyJwt === 'boolean', `preDeploymentProduction verifyJwt is invalid for ${entry.slug}`);
        assert(typeof entry.importMap === 'boolean', `preDeploymentProduction importMap is invalid for ${entry.slug}`);
        assert(digestPattern.test(entry.ezbrSha256 ?? ''), `preDeploymentProduction bundle digest is invalid for ${entry.slug}`);
        assert(digestPattern.test(entry.sourceSha256 ?? ''), `preDeploymentProduction source digest is invalid for ${entry.slug}`);
        if (entry.entrypointIdentity !== undefined) {
          assert(
            entry.entrypointIdentity === canonicalFunctionEntrypointIdentity(entry.slug),
            `preDeploymentProduction entrypoint identity is invalid for ${entry.slug}`
          );
        }
      }
    }
  }
  assert(
    Array.isArray(manifest.additionalFunctionBaselines) &&
      JSON.stringify(manifest.additionalFunctionBaselines.map((entry) => entry.slug)) ===
        JSON.stringify(additionalFunctionSlugs),
    'additionalFunctionBaselines function allowlist is invalid'
  );
  for (const entry of manifest.additionalFunctionBaselines) {
    assert(Number.isFinite(Date.parse(entry.capturedAt)), `Additional baseline timestamp is invalid for ${entry.slug}`);
    assert(entry.status === 'ACTIVE', `Additional baseline must be ACTIVE for ${entry.slug}`);
    assert(Number.isInteger(entry.version) && entry.version > 0, `Additional baseline version is invalid for ${entry.slug}`);
    assert(
      entry.verifyJwt === manifest.functions.find((candidate) => candidate.slug === entry.slug).verifyJwt &&
        entry.importMap === false,
      `Additional baseline security pairing is invalid for ${entry.slug}`
    );
    assert(digestPattern.test(entry.ezbrSha256 ?? ''), `Additional baseline bundle digest is invalid for ${entry.slug}`);
    assert(digestPattern.test(entry.sourceSha256 ?? ''), `Additional baseline source digest is invalid for ${entry.slug}`);
    assert(
      entry.entrypointIdentity === canonicalFunctionEntrypointIdentity(entry.slug),
      `Additional baseline entrypoint identity is invalid for ${entry.slug}`
    );
    assert(gitCommitPattern.test(entry.restoreSourceGitCommit ?? ''), `Additional baseline restore commit is invalid for ${entry.slug}`);
  }
};

export const buildLocalReleaseState = (rootDirectory, manifest) => {
  validateManifestShape(manifest, { allowPending: true });
  assertSupportedFunctionDeploymentInputs(rootDirectory);
  const discoveredMigrations = discoverRefundMigrationFiles(rootDirectory);
  assert(
    JSON.stringify(manifest.requiredMigrations) === JSON.stringify(discoveredMigrations),
    'Required migrations do not match every refund/Nayax migration in the repository'
  );
  const verifyJwtConfig = parseFunctionDeploymentConfig(rootDirectory);
  const committedSourceCache = new Map();

  return {
    migrationFilesSha256: calculateMigrationDigest(rootDirectory, manifest.requiredMigrations),
    migrationVersionSetSha256: calculateMigrationVersionSetDigest(manifest.requiredMigrations),
    functions: manifest.functions.map((entry) => {
      assert(verifyJwtConfig.has(entry.slug), `Missing Supabase config section for ${entry.slug}`);
      assert(
        verifyJwtConfig.get(entry.slug) === entry.verifyJwt,
        `Supabase verify_jwt does not match manifest for ${entry.slug}`
      );
      const localSource = calculateFunctionSource(rootDirectory, entry.slug);
      if (rootDirectory === repoRoot && manifest.sourceGitCommit !== 'pending') {
        const committedSource = calculateFunctionSourceAtGitCommit(
          rootDirectory,
          manifest.sourceGitCommit,
          entry.slug,
          { sourceCache: committedSourceCache }
        );
        assert(
          committedSource.sourceSha256 === localSource.sourceSha256,
          `sourceGitCommit does not contain the approved source for ${entry.slug}`
        );
      }
      return {
        slug: entry.slug,
        verifyJwt: entry.verifyJwt,
        ...localSource,
      };
    }),
  };
};

export const validateApprovedRestoreSource = (rootDirectory, manifest) => {
  const committedSourceCache = new Map();
  for (const entry of manifest.approvedRestoreSource.functions) {
    if (entry.restoreAction === 'disable') continue;
    const committedSource = calculateFunctionSourceAtGitCommit(
      rootDirectory,
      manifest.approvedRestoreSource.sourceGitCommit,
      entry.slug,
      { sourceCache: committedSourceCache }
    );
    assert(
      committedSource.sourceSha256 === entry.sourceSha256,
      `approvedRestoreSource does not match ${entry.slug}`
    );
  }
  for (const entry of manifest.additionalFunctionBaselines) {
    const committedSource = calculateFunctionSourceAtGitCommit(
      rootDirectory, entry.restoreSourceGitCommit, entry.slug, { sourceCache: committedSourceCache }
    );
    assert(
      committedSource.sourceSha256 === entry.sourceSha256,
      `Additional baseline restore source does not match ${entry.slug}`
    );
  }
};

export const validateHistoricalPreMigrationCompatibilityEntries = ({
  functions,
  preDeploymentProduction,
  historicalSourceBySlug,
}) => {
  assert(
    JSON.stringify(functions.map((entry) => entry.slug)) ===
      JSON.stringify(requiredFunctionSlugs),
    'preMigrationCompatibility current function allowlist is invalid'
  );
  assert(
    JSON.stringify(preDeploymentProduction.map((entry) => entry.slug)) ===
      JSON.stringify(historicalFunctionSlugs),
    'preMigrationCompatibility historical baseline function allowlist is invalid'
  );
  assert(
    historicalSourceBySlug instanceof Map &&
      historicalSourceBySlug.size === historicalFunctionSlugs.length &&
      historicalFunctionSlugs.every((slug) =>
        digestPattern.test(historicalSourceBySlug.get(slug) ?? '')
      ),
    'preMigrationCompatibility historical source map is invalid'
  );

  for (const entry of functions.filter((candidate) => historicalFunctionSlugs.includes(candidate.slug))) {
    const historicalEntry = preDeploymentProduction.find(
      (candidate) => candidate.slug === entry.slug
    );
    assert(
      historicalEntry?.status === 'ACTIVE',
      `preMigrationCompatibility historical baseline must be ACTIVE for ${entry.slug}`
    );
    assert(
      historicalEntry.verifyJwt === entry.verifyJwt && historicalEntry.importMap === false,
      `preMigrationCompatibility historical security pairing does not match ${entry.slug}`
    );
    assert(
      historicalSourceBySlug.get(entry.slug) === historicalEntry.sourceSha256,
      `preMigrationCompatibility source commit does not match the historical baseline for ${entry.slug}`
    );
  }
};

export const validatePreMigrationCompatibilitySource = (rootDirectory, manifest) => {
  validateManifestShape(manifest);
  const compatibility = manifest.preMigrationCompatibility;
  assert(compatibility, 'preMigrationCompatibility is missing');
  assert(
    calculateMigrationDigest(rootDirectory, compatibility.requiredMigrations) ===
      compatibility.migrationFilesSha256,
    'preMigrationCompatibility migration source differs from the approved bridge'
  );
  assert(
    calculateMigrationVersionSetDigest(compatibility.requiredMigrations) ===
      compatibility.migrationVersionSetSha256,
    'preMigrationCompatibility migration set differs from the approved bridge'
  );

  const historicalSourceCache = new Map();
  const historicalSourceBySlug = new Map(
    manifest.functions.filter((entry) => historicalFunctionSlugs.includes(entry.slug)).map((entry) => [
      entry.slug,
      calculateFunctionSourceAtGitCommit(
        rootDirectory,
        compatibility.sourceGitCommit,
        entry.slug,
        { sourceCache: historicalSourceCache }
      ).sourceSha256,
    ])
  );
  validateHistoricalPreMigrationCompatibilityEntries({
    functions: manifest.functions,
    preDeploymentProduction: manifest.preDeploymentProduction,
    historicalSourceBySlug,
  });
};

export const compareLocalState = (manifest, localState) => {
  const failures = [];
  if (manifest.migrationFilesSha256 !== localState.migrationFilesSha256) {
    failures.push('Required migration source differs from the approved refund release manifest');
  }
  if (manifest.migrationVersionSetSha256 !== localState.migrationVersionSetSha256) {
    failures.push('Required migration version set differs from the approved refund release manifest');
  }

  const localBySlug = new Map(localState.functions.map((entry) => [entry.slug, entry]));
  for (const entry of manifest.functions) {
    const local = localBySlug.get(entry.slug);
    if (!local || local.sourceSha256 !== entry.sourceSha256) {
      failures.push(`${entry.slug}: repository source differs from the approved refund release manifest`);
    }
    if (!local || local.verifyJwt !== entry.verifyJwt) {
      failures.push(`${entry.slug}: verify_jwt differs from the approved refund release manifest`);
    }
  }

  return failures;
};

export const sanitizeProductionMetadata = (rawFunctions) => rawFunctions
  .filter((entry) => requiredFunctionSlugs.includes(entry.slug ?? entry.name))
  .map((entry) => {
    const slug = entry.slug ?? entry.name;
    return {
      slug,
      status: String(entry.status ?? ''),
      version: Number(entry.version),
      verifyJwt: Boolean(entry.verify_jwt),
      importMap: Boolean(entry.import_map),
      ezbrSha256: String(entry.ezbr_sha256 ?? ''),
      entrypointIdentity: normalizeProductionEntrypointIdentity(entry.entrypoint_path, slug),
    };
  })
  .sort(
    (left, right) => requiredFunctionSlugs.indexOf(left.slug) - requiredFunctionSlugs.indexOf(right.slug)
  );

export const compareProductionState = (manifest, productionFunctions) => {
  const failures = [];
  const productionBySlug = new Map(productionFunctions.map((entry) => [entry.slug, entry]));
  if (productionBySlug.size !== productionFunctions.length) {
    failures.push('Production metadata contains duplicate refund function slugs');
  }

  for (const expected of manifest.functions) {
    const actual = productionBySlug.get(expected.slug);
    if (!actual) {
      failures.push(`${expected.slug}: missing from production`);
      continue;
    }
    if (actual.status !== 'ACTIVE') failures.push(`${expected.slug}: production status is not ACTIVE`);
    if (!Number.isInteger(actual.version) || actual.version < 1) {
      failures.push(`${expected.slug}: production version is invalid`);
    }
    if (!digestPattern.test(actual.ezbrSha256)) {
      failures.push(`${expected.slug}: production bundle digest is invalid`);
    }
    if (actual.verifyJwt !== expected.verifyJwt) {
      failures.push(`${expected.slug}: production verify_jwt differs from the manifest`);
    }
    if (actual.importMap) failures.push(`${expected.slug}: unexpected production import map`);
    if (!expected.production) {
      failures.push(`${expected.slug}: approved production metadata has not been recorded`);
      continue;
    }
    if (expected.production.sourceSha256 !== expected.sourceSha256) {
      failures.push(`${expected.slug}: approved repository source has not been paired with production`);
    }
    if (actual.version < expected.production.version) {
      failures.push(`${expected.slug}: production version regressed below the approved bundle version`);
    }
    if (actual.ezbrSha256 !== expected.production.ezbrSha256) {
      failures.push(`${expected.slug}: production bundle digest differs from the manifest`);
    }
    if (actual.entrypointIdentity !== expected.production.entrypointIdentity) {
      failures.push(`${expected.slug}: production entrypoint identity differs from the manifest`);
    }
  }

  return failures;
};

export const compareCaptureState = (manifest, productionFunctions, productionSources) => {
  const failures = [];
  const productionBySlug = new Map(productionFunctions.map((entry) => [entry.slug, entry]));
  const sourceBySlug = new Map(productionSources.map((entry) => [entry.slug, entry.sourceSha256]));
  if (productionBySlug.size !== productionFunctions.length) {
    failures.push('Production metadata contains duplicate refund function slugs');
  }
  if (sourceBySlug.size !== productionSources.length) {
    failures.push('Downloaded production source contains duplicate refund function slugs');
  }

  for (const expected of manifest.functions) {
    const actual = productionBySlug.get(expected.slug);
    if (!actual) {
      failures.push(`${expected.slug}: missing from production`);
      continue;
    }
    if (actual.status !== 'ACTIVE') failures.push(`${expected.slug}: production status is not ACTIVE`);
    if (!Number.isInteger(actual.version) || actual.version < 1) {
      failures.push(`${expected.slug}: production version is invalid`);
    }
    if (!digestPattern.test(actual.ezbrSha256)) {
      failures.push(`${expected.slug}: production bundle digest is invalid`);
    }
    if (expected.production && actual.version < expected.production.version) {
      failures.push(`${expected.slug}: production version regressed below the approved bundle version`);
    }
    if (actual.verifyJwt !== expected.verifyJwt) {
      failures.push(`${expected.slug}: production verify_jwt differs from the manifest`);
    }
    if (actual.importMap) failures.push(`${expected.slug}: unexpected production import map`);
    if (!expected.production?.entrypointIdentity) {
      failures.push(`${expected.slug}: approved production entrypoint identity has not been recorded`);
    } else if (actual.entrypointIdentity !== expected.production.entrypointIdentity) {
      failures.push(`${expected.slug}: production entrypoint identity differs from the manifest`);
    }
    if (sourceBySlug.get(expected.slug) !== expected.sourceSha256) {
      failures.push(`${expected.slug}: downloaded production source does not match the approved repository source`);
    }
  }

  return failures;
};

export const buildProductionCaptureReceipt = (
  manifest,
  productionFunctions,
  productionSources,
  capturedAt
) => {
  assert(
    typeof capturedAt === 'string' && Number.isFinite(Date.parse(capturedAt)),
    'Production capture timestamp is invalid'
  );
  const captureFailures = compareCaptureState(
    manifest,
    productionFunctions,
    productionSources
  );
  assert(
    captureFailures.length === 0,
    `Production capture receipt is not aligned: ${captureFailures.join('; ')}`
  );

  const manifestBySlug = new Map(manifest.functions.map((entry) => [entry.slug, entry]));
  const sourceBySlug = new Map(
    productionSources.map((entry) => [entry.slug, entry.sourceSha256])
  );

  return {
    schemaVersion: 2,
    capturedAt,
    projectRef: manifest.projectRef,
    releaseId: manifest.releaseId,
    sourceGitCommit: manifest.sourceGitCommit,
    migrationFilesSha256: manifest.migrationFilesSha256,
    migrationVersionSetSha256: manifest.migrationVersionSetSha256,
    preDeploymentProduction: manifest.preDeploymentProduction,
    approvedRestoreSource: manifest.approvedRestoreSource,
    additionalFunctionBaselines: manifest.additionalFunctionBaselines,
    functions: productionFunctions.map((entry) => {
      const expected = manifestBySlug.get(entry.slug);
      const approved = expected.production;
      const sourceSha256 = sourceBySlug.get(entry.slug);
      const sameApprovedBundle = Boolean(
        approved &&
          entry.ezbrSha256 === approved.ezbrSha256 &&
          sourceSha256 === approved.sourceSha256 &&
          entry.entrypointIdentity === approved.entrypointIdentity
      );

      let versionRelation = 'new_bundle_candidate';
      if (sameApprovedBundle && entry.version === approved.version) {
        versionRelation = 'approved_bundle_version';
      } else if (sameApprovedBundle && entry.version > approved.version) {
        versionRelation = 'same_bundle_later_revision';
      }

      return {
        slug: entry.slug,
        status: entry.status,
        version: entry.version,
        approvedBundleVersion: approved?.version ?? null,
        versionRelation,
        verifyJwt: entry.verifyJwt,
        importMap: entry.importMap,
        entrypointIdentity: entry.entrypointIdentity,
        ezbrSha256: entry.ezbrSha256,
        sourceSha256,
      };
    }),
  };
};

export const comparePreMigrationCompatibilityState = (
  manifest,
  productionFunctions,
  productionSources
) => {
  const failures = [];
  const productionBySlug = new Map(productionFunctions.map((entry) => [entry.slug, entry]));
  const sourceBySlug = new Map(productionSources.map((entry) => [entry.slug, entry.sourceSha256]));
  if (productionBySlug.size !== productionFunctions.length) {
    failures.push('Production metadata contains duplicate refund function slugs');
  }
  if (sourceBySlug.size !== productionSources.length) {
    failures.push('Downloaded production source contains duplicate refund function slugs');
  }

  for (const expected of manifest.functions) {
    const actual = productionBySlug.get(expected.slug);
    if (!actual) {
      failures.push(`${expected.slug}: missing from production`);
      continue;
    }
    if (!expected.production) {
      failures.push(`${expected.slug}: approved pre-migration production baseline is missing`);
      continue;
    }
    if (actual.status !== 'ACTIVE') failures.push(`${expected.slug}: production status is not ACTIVE`);
    if (!Number.isInteger(actual.version) || actual.version < expected.production.version) {
      failures.push(`${expected.slug}: production version regressed below the approved pre-migration baseline`);
    }
    if (actual.verifyJwt !== expected.verifyJwt) {
      failures.push(`${expected.slug}: production verify_jwt differs from the manifest`);
    }
    if (actual.importMap) failures.push(`${expected.slug}: unexpected production import map`);
    if (actual.entrypointIdentity !== expected.production.entrypointIdentity) {
      failures.push(`${expected.slug}: production entrypoint identity differs from the approved pre-migration baseline`);
    }
    if (actual.ezbrSha256 !== expected.production.ezbrSha256) {
      failures.push(`${expected.slug}: production bundle differs from the approved pre-migration baseline`);
    }
    if (sourceBySlug.get(expected.slug) !== expected.production.sourceSha256) {
      failures.push(`${expected.slug}: downloaded source differs from the approved pre-migration baseline`);
    }
  }

  return failures;
};

export const buildPreDeploymentProductionBaseline = (productionFunctions, productionSources) => {
  const productionBySlug = new Map(productionFunctions.map((entry) => [entry.slug, entry]));
  const sourceBySlug = new Map(productionSources.map((entry) => [entry.slug, entry.sourceSha256]));
  assert(productionBySlug.size === productionFunctions.length, 'Production metadata contains duplicate refund function slugs');
  assert(sourceBySlug.size === productionSources.length, 'Downloaded production source contains duplicate refund function slugs');

  return requiredFunctionSlugs.map((slug) => {
    const actual = productionBySlug.get(slug);
    if (!actual) return { slug, status: 'MISSING' };
    assert(actual.status === 'ACTIVE', `${slug}: baseline production status is not ACTIVE`);
    assert(Number.isInteger(actual.version) && actual.version > 0, `${slug}: baseline production version is invalid`);
    assert(digestPattern.test(actual.ezbrSha256), `${slug}: baseline production bundle digest is invalid`);
    assert(digestPattern.test(sourceBySlug.get(slug) ?? ''), `${slug}: baseline production source digest is invalid`);
    assert(
      actual.entrypointIdentity === canonicalFunctionEntrypointIdentity(slug),
      `${slug}: baseline production entrypoint identity is invalid`
    );
    return {
      slug,
      status: actual.status,
      version: actual.version,
      verifyJwt: actual.verifyJwt,
      importMap: actual.importMap,
      entrypointIdentity: actual.entrypointIdentity,
      ezbrSha256: actual.ezbrSha256,
      sourceSha256: sourceBySlug.get(slug),
    };
  });
};

const runSupabaseCommand = (args, cwd, failureMessage) => {
  const command = process.platform === 'win32' ? 'supabase.exe' : 'supabase';
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    env: process.env,
    windowsHide: true,
  });

  if (result.status !== 0) {
    throw new Error(failureMessage);
  }

  return result.stdout;
};

const runSupabaseFunctionsList = (projectRef) => {
  assert(projectRefPattern.test(projectRef), 'Project ref must be a 20-character lowercase identifier');
  const output = runSupabaseCommand(
    ['functions', 'list', '--project-ref', projectRef, '--output', 'json'],
    repoRoot,
    'Unable to read Supabase Edge Function metadata. Confirm the read token and project reference.'
  );

  try {
    return JSON.parse(output);
  } catch {
    throw new Error('Supabase Edge Function metadata was not valid JSON.');
  }
};

const readProductionSourceState = (projectRef, slugs = requiredFunctionSlugs) => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bloomjoy-refund-release-capture-'));

  try {
    return slugs.map((slug) => {
      const functionWorkdir = path.join(temporaryRoot, slug);
      fs.mkdirSync(functionWorkdir, { recursive: true });
      runSupabaseCommand(
        ['init', '--workdir', functionWorkdir],
        repoRoot,
        `Unable to initialize the production source check for ${slug}`
      );
      runSupabaseCommand(
        [
          'functions',
          'download',
          slug,
          '--project-ref',
          projectRef,
          '--use-api',
          '--workdir',
          functionWorkdir,
        ],
        repoRoot,
        `Unable to download the production source for ${slug}`
      );

      assertSupportedFunctionDeploymentInputs(functionWorkdir);

      return {
        slug,
        sourceSha256: calculateFunctionSource(functionWorkdir, slug).sourceSha256,
      };
    });
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
};

const printFailures = (heading, failures) => {
  if (failures.length === 0) return;
  console.error(heading);
  for (const failure of failures) console.error(`- ${failure}`);
};

export const buildUpdatedLocalManifest = (manifest, localState, sourceGitCommit) => {
  assert(gitCommitPattern.test(sourceGitCommit), 'Current source Git commit is invalid');
  const localBySlug = new Map(localState.functions.map((entry) => [entry.slug, entry]));
  return {
    ...manifest,
    sourceGitCommit,
    migrationFilesSha256: localState.migrationFilesSha256,
    migrationVersionSetSha256: localState.migrationVersionSetSha256,
    functions: manifest.functions.map((entry) => ({
      ...entry,
      sourceSha256: localBySlug.get(entry.slug).sourceSha256,
    })),
  };
};

export const validateReleaseManifestGitAnchorState = ({
  manifest,
  headGitCommit,
  sourceCommitExists,
  sourceIsAncestor,
  worktreeIsClean,
  changedPaths,
  manifestRelativePath = 'scripts/refunds/refund-production-release.json',
}) => {
  validateManifestShape(manifest);
  assert(
    gitCommitPattern.test(headGitCommit ?? ''),
    'Current refund release anchor Git commit is invalid'
  );
  assert(
    sourceCommitExists,
    'Refund production sourceGitCommit does not exist as a Git commit'
  );
  assert(
    sourceIsAncestor,
    'Refund production sourceGitCommit is not an ancestor of the current release anchor'
  );
  assert(
    worktreeIsClean,
    'Refund release manifest operations require a clean Git worktree'
  );
  assert(Array.isArray(changedPaths), 'Refund release anchor changed-path evidence is invalid');

  const normalizedManifestPath = normalizePath(manifestRelativePath);
  const normalizedChangedPaths = changedPaths.map((entry) => normalizePath(String(entry)));
  assert(
    normalizedChangedPaths.length === 1 &&
      normalizedChangedPaths[0] === normalizedManifestPath,
    'Only the refund production release manifest may differ between sourceGitCommit and the current release anchor'
  );

  return {
    sourceGitCommit: manifest.sourceGitCommit,
    anchorGitCommit: headGitCommit,
    changedPaths: normalizedChangedPaths,
  };
};

export const assertReleaseGitWorktreeClean = (rootDirectory) => {
  const statusResult = spawnSync(
    'git',
    ['status', '--porcelain=v1', '--untracked-files=all'],
    {
      cwd: rootDirectory,
      encoding: 'utf8',
      windowsHide: true,
    }
  );
  assert(
    !statusResult.error && statusResult.status === 0,
    'Unable to inspect the refund release Git worktree'
  );
  assert(
    statusResult.stdout.trim() === '',
    'Refund release manifest operations require a clean Git worktree'
  );
  return true;
};

export const prepareManifestForLocalRefresh = (
  manifest,
  { worktreeIsClean = false } = {}
) => {
  validateManifestShape(manifest, { allowPending: true });
  assert(
    worktreeIsClean,
    'Refund release manifest refresh requires a clean source worktree'
  );
  return { ...manifest, sourceGitCommit: 'pending' };
};

export const validateReleaseManifestGitAnchor = (rootDirectory, manifest) => {
  validateManifestShape(manifest);

  const headResult = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: rootDirectory,
    encoding: 'utf8',
    windowsHide: true,
  });
  assert(
    !headResult.error && headResult.status === 0,
    'Unable to resolve the current refund release anchor Git commit'
  );
  const headGitCommit = headResult.stdout.trim();

  const sourceExistsResult = spawnSync(
    'git',
    ['cat-file', '-e', `${manifest.sourceGitCommit}^{commit}`],
    {
      cwd: rootDirectory,
      encoding: 'utf8',
      windowsHide: true,
    }
  );
  assert(!sourceExistsResult.error, 'Unable to inspect refund production sourceGitCommit');
  const sourceCommitExists = sourceExistsResult.status === 0;
  assert(
    sourceCommitExists,
    'Refund production sourceGitCommit does not exist as a Git commit'
  );

  const ancestorResult = spawnSync(
    'git',
    ['merge-base', '--is-ancestor', manifest.sourceGitCommit, headGitCommit],
    {
      cwd: rootDirectory,
      encoding: 'utf8',
      windowsHide: true,
    }
  );
  assert(!ancestorResult.error, 'Unable to inspect refund release Git ancestry');
  assert(
    ancestorResult.status === 0 || ancestorResult.status === 1,
    'Unable to determine refund release Git ancestry'
  );

  const diffResult = spawnSync(
    'git',
    ['diff', '--name-only', '--no-renames', `${manifest.sourceGitCommit}..${headGitCommit}`],
    {
      cwd: rootDirectory,
      encoding: 'utf8',
      windowsHide: true,
    }
  );
  assert(
    !diffResult.error && diffResult.status === 0,
    'Unable to inspect refund release anchor changed paths'
  );
  const changedPaths = diffResult.stdout
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter(Boolean);
  const manifestRelativePath = path.relative(rootDirectory, manifestPath);
  assert(
    manifestRelativePath &&
      !manifestRelativePath.startsWith('..') &&
      !path.isAbsolute(manifestRelativePath),
    'Refund production manifest is outside the release repository'
  );

  return validateReleaseManifestGitAnchorState({
    manifest,
    headGitCommit,
    sourceCommitExists,
    sourceIsAncestor: ancestorResult.status === 0,
    worktreeIsClean: assertReleaseGitWorktreeClean(rootDirectory),
    changedPaths,
    manifestRelativePath,
  });
};

const readCurrentGitCommit = () => {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: repoRoot,
    encoding: 'utf8',
    windowsHide: true,
  });
  assert(result.status === 0, 'Unable to resolve the current Git commit for the release manifest');
  const sourceGitCommit = result.stdout.trim();
  assert(gitCommitPattern.test(sourceGitCommit), 'Current source Git commit is invalid');
  return sourceGitCommit;
};

const writeLocalManifest = (manifest, localState) => {
  const updated = buildUpdatedLocalManifest(manifest, localState, readCurrentGitCommit());
  fs.writeFileSync(manifestPath, `${JSON.stringify(updated, null, 2)}\n`, 'utf8');
  return updated;
};

const parseArguments = (argv) => {
  const options = {
    mode: 'local',
    projectRef: '',
    confirmProjectRef: '',
    output: '',
    writeLocal: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--local') options.mode = 'local';
    else if (argument === '--production') options.mode = 'production';
    else if (argument === '--pre-migration-compatibility') options.mode = 'compatibility';
    else if (argument === '--capture-production') options.mode = 'capture';
    else if (argument === '--capture-predeployment') options.mode = 'baseline';
    else if (argument === '--write-local') options.writeLocal = true;
    else if (argument === '--project-ref') options.projectRef = argv[++index] ?? '';
    else if (argument === '--confirm-project-ref') options.confirmProjectRef = argv[++index] ?? '';
    else if (argument === '--output') options.output = argv[++index] ?? '';
    else throw new Error(`Unknown argument: ${argument}`);
  }

  return options;
};

const main = () => {
  const options = parseArguments(process.argv.slice(2));
  let manifest = readJson(manifestPath);

  if (options.mode === 'baseline') {
    validateManifestShape(manifest, { allowPending: true });
    const projectRef = options.projectRef || manifest.projectRef;
    assert(projectRef === manifest.projectRef, 'Project ref does not match the production release manifest');
    assert(options.confirmProjectRef === projectRef, 'Baseline capture requires an exact --confirm-project-ref');
    assert(options.output, 'Baseline capture requires --output under the gitignored output directory');
    const production = sanitizeProductionMetadata(runSupabaseFunctionsList(projectRef));
    const productionSources = readProductionSourceState(projectRef, production.map((entry) => entry.slug));
    const preDeploymentProduction = buildPreDeploymentProductionBaseline(production, productionSources);
    const outputPath = path.resolve(repoRoot, options.output);
    const allowedOutputRoot = path.resolve(repoRoot, 'output');
    assert(outputPath.startsWith(`${allowedOutputRoot}${path.sep}`), 'Capture output must be under output/');
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(
      outputPath,
      `${JSON.stringify({ projectRef, capturedAt: new Date().toISOString(), preDeploymentProduction }, null, 2)}\n`,
      'utf8'
    );
    console.log(`Captured the exact pre-deployment baseline for ${production.length} deployed refund functions.`);
    return;
  }

  let localStateManifest = manifest;
  if (options.writeLocal) {
    localStateManifest = prepareManifestForLocalRefresh(manifest, {
      worktreeIsClean: assertReleaseGitWorktreeClean(repoRoot),
    });
  } else {
    validateReleaseManifestGitAnchor(repoRoot, manifest);
  }
  const localState = buildLocalReleaseState(repoRoot, localStateManifest);

  if (options.writeLocal) {
    assert(options.mode === 'local', '--write-local may be used only with --local');
    manifest = writeLocalManifest(manifest, localState);
    console.log('Updated refund production manifest source digests.');
  }

  validateManifestShape(manifest);
  validateApprovedRestoreSource(repoRoot, manifest);
  const localFailures = compareLocalState(manifest, localState);
  printFailures('Refund release local alignment failed:', localFailures);
  if (localFailures.length > 0) process.exit(1);

  console.log(
    `Refund release local alignment passed for ${requiredFunctionSlugs.length} functions and ${manifest.requiredMigrations.length} migrations.`
  );
  if (options.mode === 'local') return;

  const projectRef = options.projectRef || manifest.projectRef;
  assert(projectRef === manifest.projectRef, 'Project ref does not match the production release manifest');
  const production = sanitizeProductionMetadata(runSupabaseFunctionsList(projectRef));

  if (options.mode === 'compatibility') {
    assert(
      options.confirmProjectRef === projectRef,
      'Pre-migration compatibility check requires an exact --confirm-project-ref'
    );
    validatePreMigrationCompatibilitySource(repoRoot, manifest);
    const productionSources = readProductionSourceState(projectRef);
    const compatibilityFailures = comparePreMigrationCompatibilityState(
      manifest,
      production,
      productionSources
    );
    printFailures('Refund pre-migration compatibility check failed:', compatibilityFailures);
    if (compatibilityFailures.length > 0) process.exit(1);

    for (const entry of production) {
      console.log(`${entry.slug}: COMPATIBLE v${entry.version} ${entry.ezbrSha256.slice(0, 12)}`);
    }
    console.log(
      `Approved historical pre-migration bridge covers exactly ${manifest.preMigrationCompatibility.requiredMigrations.length} pinned pre-deployment migrations. Standard production drift must pass before commerce deployment continues.`
    );
    return;
  }

  if (options.mode === 'capture') {
    assert(options.confirmProjectRef === projectRef, 'Capture requires an exact --confirm-project-ref');
    assert(options.output, 'Capture requires --output under the gitignored output directory');
    const productionSources = readProductionSourceState(projectRef);
    const captureFailures = compareCaptureState(manifest, production, productionSources);
    printFailures('Refund production capture rejected:', captureFailures);
    if (captureFailures.length > 0) process.exit(1);

    const outputPath = path.resolve(repoRoot, options.output);
    const allowedOutputRoot = path.resolve(repoRoot, 'output');
    assert(outputPath.startsWith(`${allowedOutputRoot}${path.sep}`), 'Capture output must be under output/');
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    const receipt = buildProductionCaptureReceipt(
      manifest,
      production,
      productionSources,
      new Date().toISOString()
    );
    fs.writeFileSync(outputPath, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
    console.log(`Captured verified production metadata for ${production.length} refund functions.`);
    return;
  }

  const productionFailures = compareProductionState(manifest, production);
  printFailures('Refund release production drift check failed:', productionFailures);
  if (productionFailures.length > 0) process.exit(1);

  const approvedBySlug = new Map(
    manifest.functions.map((entry) => [entry.slug, entry.production?.version ?? null])
  );
  for (const entry of production) {
    const approvedVersion = approvedBySlug.get(entry.slug);
    const versionNote = entry.version === approvedVersion
      ? 'approved bundle version'
      : `same approved bundle; captured at v${approvedVersion}`;
    console.log(
      `${entry.slug}: PASS live v${entry.version} ${entry.ezbrSha256.slice(0, 12)} (${versionNote})`
    );
  }
};

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  try {
    main();
  } catch (error) {
    console.error(
      `Refund release check failed: ${error instanceof Error ? error.message : 'unknown error'}`
    );
    process.exit(1);
  }
}
