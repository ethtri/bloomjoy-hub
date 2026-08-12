#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertSupportedFunctionDeploymentInputs,
  buildUpdatedLocalManifest,
  buildPreDeploymentProductionBaseline,
  buildLocalReleaseState,
  calculateFunctionSource,
  calculateMigrationDigest,
  calculateMigrationVersionSetDigest,
  compareCaptureState,
  comparePreMigrationCompatibilityState,
  compareLocalState,
  compareProductionState,
  discoverRefundMigrationFiles,
  manifestPath,
  parseFunctionDeploymentConfig,
  prepareManifestForLocalRefresh,
  repoRoot,
  requiredFunctionSlugs,
  sanitizeProductionMetadata,
  validateManifestShape,
  validateReleaseManifestGitAnchorState,
} from './refund-release.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const productionRunbook = fs.readFileSync(path.join(repositoryRoot, 'Docs', 'PRODUCTION_RUNBOOK.md'), 'utf8');
const cutoverPacket = fs.readFileSync(
  path.join(repositoryRoot, 'Docs', 'REFUND_PRODUCTION_CUTOVER_PACKET.md'),
  'utf8'
);
const productionDriftCommand =
  'npm run refunds:release:check-production -- --project-ref <project-ref>';

assert.match(
  productionRunbook,
  new RegExp(productionDriftCommand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
  'The release runbook must call the production drift checker explicitly'
);
assert.match(
  productionRunbook,
  /PR `#760`[\s\S]*ten manifest-tracked Refund Operations functions[\s\S]*41 required refund\/Nayax migrations/,
  'The runbook must name the current production-readiness release shape'
);

const refundDeployStart = productionRunbook.indexOf('Before deploying Refund Operations functions');
const refundDeployEnd = productionRunbook.indexOf(
  'After deploying the ten manifest-tracked Refund Operations functions',
  refundDeployStart
);
assert(
  refundDeployStart >= 0 && refundDeployEnd > refundDeployStart,
  'The runbook must contain the reviewed Refund Operations deployment block'
);
const refundDeployBlock = productionRunbook.slice(refundDeployStart, refundDeployEnd);
let previousDeployIndex = -1;
for (const slug of requiredFunctionSlugs) {
  const deployIndex = refundDeployBlock.indexOf(`supabase functions deploy ${slug} --no-verify-jwt`);
  assert(
    deployIndex > previousDeployIndex,
    `Refund Operations deploy order is missing or out of order for ${slug}`
  );
  previousDeployIndex = deployIndex;
}

for (const requiredFailClosedControl of [
  'NAYAX_REFUND_EXECUTION_ENABLED=false',
  'NAYAX_REFUND_EXECUTION_DRY_RUN=true',
  'NAYAX_REFUND_EXECUTION_KILL_SWITCH=true',
  'NAYAX_REFUND_EXECUTION_PROVIDER_CONTRACT_CONFIRMED=false',
  'Do not set `NAYAX_REFUND_EXECUTION_SPONSOR_GO_NO_GO`',
  'REFUND_AUTOMATION_ENABLED=false',
  'REFUND_GMAIL_ENABLED=false',
  'REFUND_GPT_TRIAGE_ENABLED=false',
  'OPENAI_REFUND_TRIAGE_DATA_CONTROLS_APPROVED=false',
  'official-action database gate and production Nayax provider adapter remain statically disabled',
]) {
  assert(
    productionRunbook.includes(requiredFailClosedControl),
    `Release runbook is missing fail-closed control: ${requiredFailClosedControl}`
  );
}

assert.match(cutoverPacket, /all 41 current required refund\/Nayax migrations/);
assert.match(
  cutoverPacket,
  /all ten manifest-tracked Refund Operations functions/
);
assert.match(cutoverPacket, /historical `#629\/#716` five-migration bridge does not apply/);
const smokeOrder = cutoverPacket.indexOf('Use this exact post-deployment order:');
const routeSmoke = cutoverPacket.indexOf('refunds:smoke-routes', smokeOrder);
const publicOptionsSmoke = cutoverPacket.indexOf('refunds:smoke-public-options', routeSmoke);
const captureManifest = cutoverPacket.indexOf(
  'Capture production function metadata, update and independently review the manifest-only change',
  publicOptionsSmoke
);
const cleanDrift = cutoverPacket.indexOf(
  'require the standard production drift check to pass for all ten functions',
  captureManifest
);
assert(
  smokeOrder >= 0 &&
    routeSmoke > smokeOrder &&
    publicOptionsSmoke > routeSmoke &&
    captureManifest > publicOptionsSmoke &&
    cleanDrift > captureManifest,
  'The smoke order must be routes, public options, capture/review, then clean production drift'
);
assert.doesNotMatch(
  cutoverPacket,
  /Merge only the approved `#644` head/,
  'The current compatibility bridge must not retain the superseded main-only release instruction'
);

const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bloomjoy-refund-release-test-'));
const functionsRoot = path.join(fixtureRoot, 'supabase', 'functions');
const reviewedManagerSourceSha256 = {
  'refund-manager-action-step-up':
    '5f98adb0346837b1129271a9415091f064c4cc12cca0bb9ed6443bb33259938d',
  'refund-manager-totp-enrollment':
    'aba46b82064ab5b26f31cf02349f24db780797a8aff3970dea1ef6f8996a93ca',
};

try {
  assert.equal(requiredFunctionSlugs.length, 10, 'Refund release inventory must cover exactly ten functions');
  assert.deepEqual(
    requiredFunctionSlugs.slice(-2),
    ['refund-manager-action-step-up', 'refund-manager-totp-enrollment'],
    'Manager step-up and TOTP enrollment must be in the release inventory'
  );
  const repositoryManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  validateManifestShape(repositoryManifest);
  assert.match(
    repositoryManifest.sourceGitCommit,
    /^[a-f0-9]{40}$/,
    'Integrated release source commit must be a full immutable Git SHA'
  );
  const repositoryMigrations = discoverRefundMigrationFiles(repoRoot);
  assert.equal(
    repositoryMigrations.length,
    41,
    'Refund release inventory must cover exactly 41 discovered refund/Nayax migrations'
  );
  assert(
    repositoryMigrations.includes('202608040004_refund_nayax_provider_orchestration.sql'),
    'Provider orchestration migration must be in the discovered release inventory'
  );
  assert.deepEqual(
    repositoryManifest.requiredMigrations,
    repositoryMigrations,
    'Repository manifest must list every discovered refund/Nayax migration in order'
  );
  assert.equal(
    repositoryManifest.functions.length,
    10,
    'Repository release manifest must contain exactly ten functions'
  );
  const repositoryLocalState = buildLocalReleaseState(repoRoot, repositoryManifest);
  assert.deepEqual(
    compareLocalState(repositoryManifest, repositoryLocalState),
    [],
    'Repository function and migration digests must align with the anchored manifest'
  );
  for (const managerSlug of ['refund-manager-action-step-up', 'refund-manager-totp-enrollment']) {
    const localEntry = repositoryManifest.functions.find((entry) => entry.slug === managerSlug);
    const localStateEntry = repositoryLocalState.functions.find((entry) => entry.slug === managerSlug);
    assert(localStateEntry, `${managerSlug} must be present in the local release state`);
    assert.equal(
      localStateEntry.sourceSha256,
      reviewedManagerSourceSha256[managerSlug],
      `${managerSlug} local source must match its independently reviewed digest`
    );
    const baselineEntry = repositoryManifest.preDeploymentProduction.find(
      (entry) => entry.slug === managerSlug
    );
    const restoreEntry = repositoryManifest.approvedRestoreSource.functions.find(
      (entry) => entry.slug === managerSlug
    );
    assert.equal(localEntry.verifyJwt, false, `${managerSlug} must keep verify_jwt disabled`);
    assert.equal(
      localEntry.sourceSha256,
      reviewedManagerSourceSha256[managerSlug],
      `${managerSlug} manifest source must match its independently reviewed digest`
    );
    assert(
      localEntry.production &&
        Number.isInteger(localEntry.production.version) &&
        localEntry.production.version > 0 &&
        localEntry.production.sourceSha256 === reviewedManagerSourceSha256[managerSlug],
      `${managerSlug} must record its deployed production source pairing`
    );
    assert.deepEqual(
      baselineEntry,
      { slug: managerSlug, status: 'MISSING' },
      `${managerSlug} must retain an explicit missing pre-deployment baseline`
    );
    assert.deepEqual(
      restoreEntry,
      { slug: managerSlug, restoreAction: 'disable' },
      `${managerSlug} rollback must disable the newly introduced function`
    );
  }
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
  const fixtureManifestPath = 'scripts/refunds/refund-production-release.json';
  const validAnchorState = {
    manifest: shapeManifest,
    headGitCommit: 'c'.repeat(40),
    sourceCommitExists: true,
    sourceIsAncestor: true,
    worktreeIsClean: true,
    changedPaths: [fixtureManifestPath],
    manifestRelativePath: fixtureManifestPath,
  };
  assert.deepEqual(
    validateReleaseManifestGitAnchorState(validAnchorState),
    {
      sourceGitCommit: 'a'.repeat(40),
      anchorGitCommit: 'c'.repeat(40),
      changedPaths: [fixtureManifestPath],
    },
    'A final release anchor must be exactly one manifest-only commit after its source'
  );
  assert.throws(
    () => validateReleaseManifestGitAnchorState({
      ...validAnchorState,
      manifest: { ...shapeManifest, sourceGitCommit: 'pending' },
    }),
    /sourceGitCommit is invalid/,
    'A pending source commit must fail once the release is anchored'
  );
  assert.throws(
    () => validateReleaseManifestGitAnchorState({
      ...validAnchorState,
      headGitCommit: 'not-a-commit',
    }),
    /anchor Git commit is invalid/,
    'An invalid release-anchor commit must fail closed'
  );
  assert.throws(
    () => validateReleaseManifestGitAnchorState({
      ...validAnchorState,
      sourceCommitExists: false,
    }),
    /does not exist as a Git commit/,
    'A wrong or missing source commit must fail closed'
  );
  assert.throws(
    () => validateReleaseManifestGitAnchorState({
      ...validAnchorState,
      sourceIsAncestor: false,
    }),
    /not an ancestor/,
    'A stale source outside the current release ancestry must fail closed'
  );
  assert.throws(
    () => validateReleaseManifestGitAnchorState({
      ...validAnchorState,
      worktreeIsClean: false,
    }),
    /require a clean Git worktree/,
    'A dirty release anchor must fail before release validation'
  );
  assert.throws(
    () => validateReleaseManifestGitAnchorState({
      ...validAnchorState,
      headGitCommit: shapeManifest.sourceGitCommit,
      changedPaths: [],
    }),
    /Only the refund production release manifest may differ/,
    'The source commit cannot also serve as its own manifest anchor'
  );
  assert.throws(
    () => validateReleaseManifestGitAnchorState({
      ...validAnchorState,
      changedPaths: ['supabase/functions/refund-case-intake/index.ts'],
    }),
    /Only the refund production release manifest may differ/,
    'A wrong-path-only anchor must fail closed'
  );
  assert.throws(
    () => validateReleaseManifestGitAnchorState({
      ...validAnchorState,
      changedPaths: [fixtureManifestPath, 'supabase/functions/refund-case-intake/index.ts'],
    }),
    /Only the refund production release manifest may differ/,
    'Any source change between the approved source and manifest anchor must fail closed'
  );
  assert.throws(
    () => validateReleaseManifestGitAnchorState({
      ...validAnchorState,
      changedPaths: [],
    }),
    /Only the refund production release manifest may differ/,
    'A source commit without a separate manifest-only anchor must fail closed'
  );
  const refreshLocalStateManifest = prepareManifestForLocalRefresh(shapeManifest, {
    worktreeIsClean: true,
  });
  assert.equal(
    refreshLocalStateManifest.sourceGitCommit,
    'pending',
    'Manifest refresh may bypass only the stale approved-source comparison'
  );
  assert.deepEqual(
    Object.keys(shapeManifest).filter(
      (key) => JSON.stringify(shapeManifest[key]) !== JSON.stringify(refreshLocalStateManifest[key])
    ),
    ['sourceGitCommit'],
    'Manifest refresh must preserve inventory, configuration, and every existing digest input'
  );
  assert.throws(
    () => prepareManifestForLocalRefresh(shapeManifest, { worktreeIsClean: false }),
    /requires a clean source worktree/,
    'A dirty source worktree must never enter manifest refresh mode'
  );
  const fixtureLocalState = buildLocalReleaseState(fixtureRoot, refreshLocalStateManifest);
  assert.equal(fixtureLocalState.functions.length, requiredFunctionSlugs.length);
  const updatedLocalManifest = buildUpdatedLocalManifest(
    refreshLocalStateManifest,
    fixtureLocalState,
    'c'.repeat(40)
  );
  assert.equal(
    updatedLocalManifest.sourceGitCommit,
    'c'.repeat(40),
    'Local manifest refresh must bind the approved source to the current immutable commit'
  );
  validateManifestShape(updatedLocalManifest);
  assert.deepEqual(
    compareLocalState(updatedLocalManifest, fixtureLocalState),
    [],
    'A refreshed manifest must align every function and migration digest'
  );
  const staleDigestManifest = {
    ...updatedLocalManifest,
    migrationFilesSha256: 'd'.repeat(64),
  };
  assert.match(
    compareLocalState(staleDigestManifest, fixtureLocalState).join('\n'),
    /migration source differs/,
    'A stale migration source digest must fail local release alignment'
  );

  const disableOnlySlug = 'refund-gmail-sync';
  const disableOnlyIndex = requiredFunctionSlugs.indexOf(disableOnlySlug);
  assert.notEqual(disableOnlyIndex, -1, 'Gmail sync must be covered by the refund release allowlist');
  const disableOnlyRestoreManifest = structuredClone(shapeManifest);
  disableOnlyRestoreManifest.approvedRestoreSource.functions[disableOnlyIndex] = {
    slug: disableOnlySlug,
    restoreAction: 'disable',
  };
  validateManifestShape(disableOnlyRestoreManifest);

  for (const managerSlug of ['refund-manager-action-step-up', 'refund-manager-totp-enrollment']) {
    const managerIndex = requiredFunctionSlugs.indexOf(managerSlug);
    assert.notEqual(managerIndex, -1, `${managerSlug} must be covered by the refund release allowlist`);
    const managerDisableManifest = structuredClone(shapeManifest);
    managerDisableManifest.approvedRestoreSource.functions[managerIndex] = {
      slug: managerSlug,
      restoreAction: 'disable',
    };
    validateManifestShape(managerDisableManifest);
    assert.equal(
      managerDisableManifest.preDeploymentProduction[managerIndex].status,
      'MISSING',
      `${managerSlug} must retain an explicit missing pre-deployment baseline`
    );
  }

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
  const compatibilityManifest = structuredClone(manifest);
  compatibilityManifest.functions[0].sourceSha256 = 'd'.repeat(64);
  assert.deepEqual(
    comparePreMigrationCompatibilityState(
      compatibilityManifest,
      sanitized.map((entry) => ({ ...entry, version: entry.version + 1 })),
      manifest.functions.map((entry) => ({
        slug: entry.slug,
        sourceSha256: entry.production.sourceSha256,
      }))
    ),
    [],
    'Pinned pre-migration sources must tolerate version-only Edge restarts'
  );
  assert.match(
    comparePreMigrationCompatibilityState(
      compatibilityManifest,
      sanitized,
      manifest.functions.map((entry, index) => ({
        slug: entry.slug,
        sourceSha256: index === 0 ? 'e'.repeat(64) : entry.production.sourceSha256,
      }))
    ).join('\n'),
    /downloaded source differs from the approved pre-migration baseline/,
    'Pre-migration compatibility must reject unapproved production source'
  );
  assert.match(
    comparePreMigrationCompatibilityState(
      compatibilityManifest,
      sanitized.map((entry, index) =>
        index === 0 ? { ...entry, ezbrSha256: 'c'.repeat(64) } : entry
      ),
      manifest.functions.map((entry) => ({
        slug: entry.slug,
        sourceSha256: entry.production.sourceSha256,
      }))
    ).join('\n'),
    /production bundle differs from the approved pre-migration baseline/,
    'Pre-migration compatibility must reject unapproved production bundles'
  );
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
