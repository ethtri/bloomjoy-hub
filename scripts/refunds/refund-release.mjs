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

export const requiredFunctionSlugs = [
  'refund-case-intake',
  'nayax-transaction-lookup',
  'refund-case-admin-update',
  'refund-case-message-send',
  'refund-case-automation-sweep',
  'refund-gmail-sync',
  'nayax-card-refund',
];

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const normalizeText = (value) => value.replace(/\r\n?/g, '\n');
const normalizePath = (value) => value.split(path.sep).join('/');
const projectRefPattern = /^[a-z0-9]{20}$/;
const digestPattern = /^[a-f0-9]{64}$/;
const gitCommitPattern = /^[a-f0-9]{40}$/;
const refundMigrationPattern = /^\d+_[a-z0-9_]*(?:refund|nayax)[a-z0-9_]*\.sql$/;
const unsupportedFunctionConfigKeys = new Set(['entrypoint', 'import_map', 'static_files']);
const unsupportedFunctionConfigFiles = new Set(['deno.json', 'deno.jsonc', 'import_map.json']);

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

const readGitFileAtCommit = (rootDirectory, commit, repositoryPath) => {
  const result = spawnSync('git', ['show', `${commit}:${repositoryPath}`], {
    cwd: rootDirectory,
    encoding: 'utf8',
    windowsHide: true,
  });
  return result.status === 0 ? normalizeText(result.stdout) : null;
};

export const calculateFunctionSourceAtGitCommit = (rootDirectory, commit, slug) => {
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

    const source = readGitFileAtCommit(rootDirectory, commit, currentFile);
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
        (candidate) => readGitFileAtCommit(rootDirectory, commit, candidate) !== null
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
  assert(manifest?.schemaVersion === 2, 'Refund production manifest schemaVersion must be 2');
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
      JSON.stringify(requiredFunctionSlugs),
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
        JSON.stringify(requiredFunctionSlugs),
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
      }
    }
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
          entry.slug
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
  for (const entry of manifest.approvedRestoreSource.functions) {
    if (entry.restoreAction === 'disable') continue;
    const committedSource = calculateFunctionSourceAtGitCommit(
      rootDirectory,
      manifest.approvedRestoreSource.sourceGitCommit,
      entry.slug
    );
    assert(
      committedSource.sourceSha256 === entry.sourceSha256,
      `approvedRestoreSource does not match ${entry.slug}`
    );
  }
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
  .map((entry) => ({
    slug: entry.slug ?? entry.name,
    status: String(entry.status ?? ''),
    version: Number(entry.version),
    verifyJwt: Boolean(entry.verify_jwt),
    importMap: Boolean(entry.import_map),
    ezbrSha256: String(entry.ezbr_sha256 ?? ''),
  }))
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
    if (actual.version !== expected.production.version) {
      failures.push(`${expected.slug}: production version differs from the manifest`);
    }
    if (actual.ezbrSha256 !== expected.production.ezbrSha256) {
      failures.push(`${expected.slug}: production bundle digest differs from the manifest`);
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
    if (actual.verifyJwt !== expected.verifyJwt) {
      failures.push(`${expected.slug}: production verify_jwt differs from the manifest`);
    }
    if (actual.importMap) failures.push(`${expected.slug}: unexpected production import map`);
    if (sourceBySlug.get(expected.slug) !== expected.sourceSha256) {
      failures.push(`${expected.slug}: downloaded production source does not match the approved repository source`);
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
    return {
      slug,
      status: actual.status,
      version: actual.version,
      verifyJwt: actual.verifyJwt,
      importMap: actual.importMap,
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

  const localState = buildLocalReleaseState(repoRoot, manifest);

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
    fs.writeFileSync(
      outputPath,
      `${JSON.stringify(
        {
          projectRef,
          releaseId: manifest.releaseId,
          sourceGitCommit: manifest.sourceGitCommit,
          migrationFilesSha256: manifest.migrationFilesSha256,
          migrationVersionSetSha256: manifest.migrationVersionSetSha256,
          preDeploymentProduction: manifest.preDeploymentProduction,
          approvedRestoreSource: manifest.approvedRestoreSource,
          functions: production.map((entry) => ({
            slug: entry.slug,
            status: entry.status,
            version: entry.version,
            verifyJwt: entry.verifyJwt,
            importMap: entry.importMap,
            ezbrSha256: entry.ezbrSha256,
            sourceSha256:
              manifest.functions.find((item) => item.slug === entry.slug)?.sourceSha256 ?? null,
          })),
        },
        null,
        2
      )}\n`,
      'utf8'
    );
    console.log(`Captured verified production metadata for ${production.length} refund functions.`);
    return;
  }

  const productionFailures = compareProductionState(manifest, production);
  printFailures('Refund release production drift check failed:', productionFailures);
  if (productionFailures.length > 0) process.exit(1);

  for (const entry of production) {
    console.log(`${entry.slug}: PASS v${entry.version} ${entry.ezbrSha256.slice(0, 12)}`);
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
