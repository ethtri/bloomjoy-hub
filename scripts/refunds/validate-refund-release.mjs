#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  assertSupportedFunctionDeploymentInputs,
  buildPreDeploymentProductionBaseline,
  buildLocalReleaseState,
  calculateFunctionSource,
  calculateMigrationDigest,
  calculateMigrationVersionSetDigest,
  compareCaptureState,
  compareProductionState,
  discoverRefundMigrationFiles,
  parseFunctionDeploymentConfig,
  requiredFunctionSlugs,
  sanitizeProductionMetadata,
  validateManifestShape,
} from './refund-release.mjs';

const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bloomjoy-refund-release-test-'));
const functionsRoot = path.join(fixtureRoot, 'supabase', 'functions');

try {
  fs.mkdirSync(path.join(functionsRoot, 'example'), { recursive: true });
  fs.mkdirSync(path.join(functionsRoot, '_shared'), { recursive: true });
  fs.writeFileSync(
    path.join(functionsRoot, 'example', 'index.ts'),
    'import { helper } from "../_shared/helper.ts";\nhelper();\n',
    'utf8'
  );
  fs.writeFileSync(path.join(functionsRoot, '_shared', 'helper.ts'), 'export const helper = () => true;\n', 'utf8');

  const baseline = calculateFunctionSource(fixtureRoot, 'example');
  fs.writeFileSync(path.join(functionsRoot, '_shared', 'helper.ts'), 'export const helper = () => false;\n', 'utf8');
  const changedDependency = calculateFunctionSource(fixtureRoot, 'example');
  assert.notEqual(changedDependency.sourceSha256, baseline.sourceSha256, 'Shared dependency changes must alter the digest');

  fs.writeFileSync(path.join(functionsRoot, '_shared', 'helper.ts'), 'export const helper = () => true;\r\n', 'utf8');
  const crlf = calculateFunctionSource(fixtureRoot, 'example');
  assert.equal(crlf.sourceSha256, baseline.sourceSha256, 'CRLF and LF source must hash identically');

  fs.writeFileSync(path.join(functionsRoot, 'example', 'index.ts'), 'import "../_shared/missing.ts";\n', 'utf8');
  assert.throws(
    () => calculateFunctionSource(fixtureRoot, 'example'),
    /Unresolved relative import/,
    'Missing relative imports must fail closed'
  );

  const migrationsRoot = path.join(fixtureRoot, 'supabase', 'migrations');
  fs.mkdirSync(migrationsRoot, { recursive: true });
  const migrationFiles = [
    '202601010001_refund_first.sql',
    '202601010002_nayax_second.sql',
  ];
  for (const fileName of migrationFiles) {
    fs.writeFileSync(path.join(migrationsRoot, fileName), `select '${fileName}';\n`, 'utf8');
  }
  fs.writeFileSync(path.join(migrationsRoot, '202601010003_unrelated.sql'), 'select true;\n', 'utf8');
  assert.deepEqual(
    discoverRefundMigrationFiles(fixtureRoot),
    migrationFiles,
    'Every refund/Nayax migration and no unrelated migration must be discovered'
  );

  const configLines = requiredFunctionSlugs.flatMap((slug) => [
    `[functions.${slug}]`,
    'verify_jwt = false',
    '',
  ]);
  fs.writeFileSync(path.join(fixtureRoot, 'supabase', 'config.toml'), `${configLines.join('\n')}\n`, 'utf8');
  for (const slug of requiredFunctionSlugs) {
    fs.mkdirSync(path.join(functionsRoot, slug), { recursive: true });
    fs.writeFileSync(path.join(functionsRoot, slug, 'index.ts'), `export const slug = '${slug}';\n`, 'utf8');
  }

  const localFunctions = requiredFunctionSlugs.map((slug) => ({
    slug,
    verifyJwt: false,
    ...calculateFunctionSource(fixtureRoot, slug),
    production: null,
  }));
  const previousFunctions = localFunctions.map(({ slug, sourceSha256 }) => ({ slug, sourceSha256 }));
  const shapeManifest = {
    schemaVersion: 2,
    environment: 'production',
    projectRef: 'a'.repeat(20),
    releaseId: 'fixture-release',
    sourceGitCommit: 'a'.repeat(40),
    requiredMigrations: migrationFiles,
    migrationFilesSha256: calculateMigrationDigest(fixtureRoot, migrationFiles),
    migrationVersionSetSha256: calculateMigrationVersionSetDigest(migrationFiles),
    functions: localFunctions,
    preDeploymentCapturedAt: '2026-01-01T00:00:00.000Z',
    preDeploymentProduction: requiredFunctionSlugs.map((slug) => ({ slug, status: 'MISSING' })),
    approvedRestoreSource: {
      releaseId: 'fixture-restore',
      sourceGitCommit: 'b'.repeat(40),
      migrationFilesSha256: calculateMigrationDigest(fixtureRoot, migrationFiles),
      migrationVersionSetSha256: calculateMigrationVersionSetDigest(migrationFiles),
      functions: previousFunctions,
    },
  };
  validateManifestShape(shapeManifest);
  assert.equal(buildLocalReleaseState(fixtureRoot, shapeManifest).functions.length, requiredFunctionSlugs.length);

  const disableOnlySlug = 'refund-gmail-sync';
  const disableOnlyIndex = requiredFunctionSlugs.indexOf(disableOnlySlug);
  assert.notEqual(disableOnlyIndex, -1, 'Gmail sync must be covered by the refund release allowlist');
  const disableOnlyRestoreManifest = structuredClone(shapeManifest);
  disableOnlyRestoreManifest.approvedRestoreSource.functions[disableOnlyIndex] = {
    slug: disableOnlySlug,
    restoreAction: 'disable',
  };
  validateManifestShape(disableOnlyRestoreManifest);

  const invalidDisableRestoreManifest = structuredClone(disableOnlyRestoreManifest);
  invalidDisableRestoreManifest.approvedRestoreSource.functions[disableOnlyIndex].sourceSha256 =
    'a'.repeat(64);
  assert.throws(
    () => validateManifestShape(invalidDisableRestoreManifest),
    /disable-only entry must not include a source digest/,
    'Disable-only restore entries must not pretend a previous function source existed'
  );

  fs.writeFileSync(path.join(migrationsRoot, '202601010004_refund_unlisted.sql'), 'select true;\n', 'utf8');
  assert.throws(
    () => buildLocalReleaseState(fixtureRoot, shapeManifest),
    /do not match every refund\/Nayax migration/,
    'A newly added in-scope migration must fail until the manifest includes it'
  );
  fs.rmSync(path.join(migrationsRoot, '202601010004_refund_unlisted.sql'));

  fs.appendFileSync(
    path.join(fixtureRoot, 'supabase', 'config.toml'),
    `[functions.${requiredFunctionSlugs[0]}]\nentrypoint = './custom.ts'\n`,
    'utf8'
  );
  assert.throws(
    () => parseFunctionDeploymentConfig(fixtureRoot),
    /Unsupported Supabase config key entrypoint/,
    'Custom entrypoints must fail closed'
  );
  fs.writeFileSync(path.join(fixtureRoot, 'supabase', 'config.toml'), `${configLines.join('\n')}\n`, 'utf8');

  const importMapPath = path.join(functionsRoot, requiredFunctionSlugs[0], 'import_map.json');
  fs.writeFileSync(importMapPath, '{}\n', 'utf8');
  assert.throws(
    () => assertSupportedFunctionDeploymentInputs(fixtureRoot),
    /Unsupported Edge Function deployment input/,
    'Untracked deployment configuration files must fail closed'
  );
  fs.rmSync(importMapPath);

  assert.throws(
    () => validateManifestShape({ ...shapeManifest, schemaVersion: 1 }),
    /schemaVersion must be 2/,
    'Stale manifest schema versions must fail'
  );
  assert.throws(
    () => validateManifestShape({
      ...shapeManifest,
      requiredMigrations: [migrationFiles[0], migrationFiles[0]],
    }),
    /duplicate migrations/,
    'Duplicate migration entries must fail'
  );

  const manifest = {
    functions: requiredFunctionSlugs.map((slug, index) => ({
      slug,
      verifyJwt: false,
      sourceSha256: String(index).padStart(64, 'a'),
      production: {
        sourceSha256: String(index).padStart(64, 'a'),
        version: index + 2,
        ezbrSha256: String(index).padStart(64, 'b'),
      },
    })),
  };
  const rawProduction = manifest.functions.map((entry) => ({
    slug: entry.slug,
    status: 'ACTIVE',
    version: entry.production.version,
    verify_jwt: false,
    import_map: false,
    ezbr_sha256: entry.production.ezbrSha256,
    entrypoint_path: 'must-not-survive-sanitization',
    id: 'must-not-survive-sanitization',
  }));
  rawProduction.push({ slug: 'unrelated-function', status: 'ACTIVE', version: 99 });

  const sanitized = sanitizeProductionMetadata(rawProduction);
  assert.equal(sanitized.length, requiredFunctionSlugs.length, 'Unrelated production functions must be ignored');
  assert.equal('entrypoint_path' in sanitized[0], false, 'Entrypoint paths must be removed');
  assert.deepEqual(compareProductionState(manifest, sanitized), [], 'Matching production metadata must pass');

  const productionSources = manifest.functions.map((entry) => ({
    slug: entry.slug,
    sourceSha256: entry.sourceSha256,
  }));
  assert.equal(
    buildPreDeploymentProductionBaseline(sanitized.slice(1), productionSources.slice(1))[0].status,
    'MISSING',
    'An absent pre-deployment function must be recorded explicitly'
  );
  assert.throws(
    () => buildPreDeploymentProductionBaseline(
      sanitized.map((entry, index) => index === 0 ? { ...entry, version: 0 } : entry),
      productionSources
    ),
    /baseline production version is invalid/,
    'Invalid pre-deployment metadata must fail closed'
  );
  assert.deepEqual(
    compareCaptureState(manifest, sanitized, productionSources),
    [],
    'Capture must pass only when downloaded production source matches the approved source'
  );
  assert.match(
    compareCaptureState(
      manifest,
      sanitized,
      productionSources.map((entry, index) =>
        index === 0 ? { ...entry, sourceSha256: 'e'.repeat(64) } : entry
      )
    ).join('\n'),
    /downloaded production source does not match/,
    'Capture must reject stale production source even when metadata is active'
  );
  assert.match(
    compareCaptureState(
      manifest,
      sanitized.map((entry, index) => index === 0 ? { ...entry, version: 0 } : entry),
      productionSources
    ).join('\n'),
    /production version is invalid/,
    'Capture must reject invalid production versions'
  );
  assert.match(
    compareCaptureState(
      manifest,
      sanitized.map((entry, index) => index === 0 ? { ...entry, ezbrSha256: '' } : entry),
      productionSources
    ).join('\n'),
    /production bundle digest is invalid/,
    'Capture must reject invalid production bundle digests'
  );

  assert.match(
    compareProductionState(manifest, sanitized.slice(1)).join('\n'),
    /missing from production/,
    'Missing production functions must fail'
  );
  assert.match(
    compareProductionState(manifest, sanitized.map((entry, index) => index === 0 ? { ...entry, status: 'FAILED' } : entry)).join('\n'),
    /status is not ACTIVE/,
    'Inactive production functions must fail'
  );
  assert.match(
    compareProductionState(manifest, sanitized.map((entry, index) => index === 0 ? { ...entry, version: 999 } : entry)).join('\n'),
    /version differs/,
    'Unexpected production versions must fail'
  );
  assert.match(
    compareProductionState(manifest, sanitized.map((entry, index) => index === 0 ? { ...entry, verifyJwt: true } : entry)).join('\n'),
    /verify_jwt differs/,
    'Unexpected production JWT settings must fail'
  );
  assert.match(
    compareProductionState(manifest, sanitized.map((entry, index) => index === 0 ? { ...entry, importMap: true } : entry)).join('\n'),
    /unexpected production import map/,
    'Unexpected production import maps must fail'
  );
  assert.match(
    compareProductionState(manifest, [...sanitized, sanitized[0]]).join('\n'),
    /duplicate refund function slugs/,
    'Duplicate production metadata must fail'
  );
  assert.match(
    compareProductionState(manifest, sanitized.map((entry, index) => index === 0 ? { ...entry, ezbrSha256: 'c'.repeat(64) } : entry)).join('\n'),
    /bundle digest differs/,
    'Unexpected production bundles must fail'
  );

  const unpairedManifest = structuredClone(manifest);
  unpairedManifest.functions[0].sourceSha256 = 'd'.repeat(64);
  assert.match(
    compareProductionState(unpairedManifest, sanitized).join('\n'),
    /has not been paired with production/,
    'Approved source changes must require a new production capture'
  );

  console.log('Refund release tooling validated.');
} finally {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
}
