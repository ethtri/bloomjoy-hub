#!/usr/bin/env node

import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  EXPECTED_MACHINE_READABLE_ARTIFACTS,
  EXPECTED_SCREENSHOTS,
  buildEvidence,
  parseArgs,
  validateMachineReadableEvidence,
} from './refund-uat-evidence.mjs';
import {
  DATABASE_EVIDENCE_FILENAME,
  buildDatabaseEvidence,
  getDatabaseEvidenceExpectations,
  parseArgs as parseDatabaseArgs,
  parseDatabaseTestSummary,
} from '../validate-supabase-migrations.mjs';

const PNG_FIXTURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const sourceCommit = 'a'.repeat(40);
const freshAfter = '2026-07-21T00:00:00.000Z';
const generatedAt = '2026-07-22T00:00:00.000Z';
const tempDir = await mkdtemp(path.join(os.tmpdir(), 'refund-uat-evidence-'));
const databaseExpectations = getDatabaseEvidenceExpectations();

const machineFixtures = {
  'refund-portal-assertions.json': {
    schemaVersion: 1,
    evidenceType: 'portal_assertions',
    evidenceMode: 'synthetic_browser_mocks',
    passed: true,
    assertionCount: 120,
    failedAssertionCount: 0,
    navigationProviderCallCount: 0,
    navigationOfficialActionCallCount: 0,
    navigationLookupCallCount: 0,
    navigationNayaxCardRefundCallCount: 0,
    navigationAdminUpdateCallCount: 0,
    navigationCustomerMessageCallCount: 0,
    navigationStepUpCallCount: 0,
    navigationMutatingRpcCallCount: 0,
    primaryCheckLookupCallCountBefore: 0,
    primaryCheckLookupCallCountAfter: 1,
    providerSuccessStateCount: 1,
    providerNonSuccessStateCount: 3,
    intakeAvailable: true,
    portalAvailable: true,
  },
  'refund-database-counts.json': {
    schemaVersion: 1,
    evidenceType: 'database_counts',
    evidenceMode: 'disposable_local_database',
    passed: true,
    migrationCount: databaseExpectations.migrationCount,
    testFileCount: databaseExpectations.testFileCount,
    assertionCount: 852,
    failedAssertionCount: 0,
  },
  'refund-gmail-mime-roles.json': {
    schemaVersion: 1,
    evidenceType: 'gmail_mime_roles',
    evidenceMode: 'synthetic_unit_tests',
    passed: true,
    roleCounts: {
      customerTo: 1,
      managerCc: 2,
      mailboxTo: 0,
      unrelatedTo: 0,
      unrelatedCc: 0,
    },
    sourceThreadPinned: true,
    duplicateMessageCount: 0,
    replyHeadersPresent: true,
    automaticHeadersPresent: true,
    internalLinkCount: 0,
    providerSendCount: 1,
  },
  'refund-kill-switches.json': {
    schemaVersion: 1,
    evidenceType: 'kill_switches',
    evidenceMode: 'synthetic_fake_transport',
    passed: true,
    switches: {
      gmailOutbound: {
        disabled: true,
        deliveryClaimCount: 0,
        providerFetchCount: 0,
        providerSendCount: 0,
      },
      customerContact: {
        disabled: true,
        deliveryClaimCount: 0,
        providerFetchCount: 0,
        providerSendCount: 0,
      },
      managerAging: {
        disabled: true,
        deliveryClaimCount: 0,
        providerFetchCount: 0,
        providerSendCount: 0,
      },
    },
    intakeAvailable: true,
    portalAvailable: true,
  },
  'refund-provider-outcomes.json': {
    schemaVersion: 1,
    evidenceType: 'provider_outcomes',
    evidenceMode: 'local_injected_provider_adapter',
    passed: true,
    successCount: 1,
    rejectionCount: 1,
    timeoutCount: 1,
    unknownCount: 1,
    totalProviderAttempts: 4,
    replayProviderAttempts: 0,
    caseReportingCompletionCount: 1,
    originalThreadCompletionCount: 1,
    fallbackNoticeCount: 0,
    managerCompletionNoticeCount: 0,
  },
};

const writeCanonicalJson = (filePath, value) =>
  writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');

try {
  assert.equal(EXPECTED_SCREENSHOTS.length, 34, 'Evidence must enumerate all 34 reviewed screenshots');
  assert.deepEqual(
    EXPECTED_MACHINE_READABLE_ARTIFACTS,
    Object.keys(machineFixtures),
    'Evidence must enumerate the five strict machine-readable artifacts in canonical order'
  );
  assert.equal(DATABASE_EVIDENCE_FILENAME, 'refund-database-counts.json');
  const databaseArgs = parseDatabaseArgs(['--evidence-dir', tempDir]);
  assert.equal(databaseArgs.evidenceDir, tempDir);
  assert.throws(
    () => parseDatabaseArgs(['--evidence-dir']),
    /requires a path/,
    'Database evidence output requires an explicit directory'
  );
  const databaseSummary = parseDatabaseTestSummary(
    `All tests successful.\nFiles=${databaseExpectations.testFileCount}, Tests=852, 29 wallclock secs`
  );
  assert.deepEqual(databaseSummary, {
    testFileCount: databaseExpectations.testFileCount,
    assertionCount: 852,
  });
  assert.throws(
    () => parseDatabaseTestSummary('All tests successful.'),
    /exactly one aggregate/,
    'Database evidence fails if the pgTAP aggregate summary is absent'
  );
  assert.throws(
    () =>
      buildDatabaseEvidence({
        migrationCount: databaseExpectations.migrationCount,
        discoveredTestFileCount: databaseExpectations.testFileCount - 1,
        testSummary: databaseSummary,
      }),
    /SQL test file\(s\) were discovered/,
    'Database evidence fails if the executed and discovered test-file counts differ'
  );
  assert.deepEqual(
    buildDatabaseEvidence({
      migrationCount: databaseExpectations.migrationCount,
      discoveredTestFileCount: databaseExpectations.testFileCount,
      testSummary: databaseSummary,
    }),
    machineFixtures['refund-database-counts.json'],
    'Database evidence producer and strict manifest fixture must stay aligned'
  );

  const parsed = parseArgs([
    '--artifact-dir',
    tempDir,
    '--source-commit',
    sourceCommit,
    '--fresh-after',
    freshAfter,
  ]);
  assert.equal(parsed.artifactDir, path.resolve(tempDir));
  assert.equal(parsed.output, path.join(path.resolve(tempDir), 'refund-uat-evidence.json'));
  assert.equal(parsed.sourceCommit, sourceCommit);
  assert.equal(parsed.freshAfter, freshAfter);
  assert.throws(() => parseArgs(['--unknown']), /Unknown or incomplete argument/);
  await assert.rejects(
    buildEvidence({
      artifactDir: tempDir,
      output: path.join(tempDir, 'invalid.json'),
      sourceCommit: 'person@example.test',
      generatedAt,
    }),
    /Source commit must be a Git SHA/
  );

  for (const name of EXPECTED_SCREENSHOTS) {
    await writeFile(path.join(tempDir, name), PNG_FIXTURE);
  }
  for (const [name, payload] of Object.entries(machineFixtures)) {
    await writeCanonicalJson(path.join(tempDir, name), payload);
  }

  const output = path.join(tempDir, 'manifest.json');
  const manifest = await buildEvidence({
    artifactDir: tempDir,
    output,
    sourceCommit,
    freshAfter,
    generatedAt,
  });

  assert.deepEqual(Object.keys(manifest), [
    'schemaVersion',
    'generatedAt',
    'evidenceRunStartedAt',
    'sourceCommit',
    'evidenceMode',
    'containsProductionData',
    'screenshotCount',
    'screenshots',
    'machineReadableArtifactCount',
    'machineReadableArtifacts',
  ]);
  assert.equal(manifest.schemaVersion, 2);
  assert.equal(manifest.generatedAt, generatedAt);
  assert.equal(manifest.evidenceRunStartedAt, freshAfter);
  assert.equal(manifest.sourceCommit, sourceCommit);
  assert.equal(manifest.evidenceMode, 'synthetic_and_disposable_local_only');
  assert.equal(manifest.containsProductionData, false);
  assert.equal(manifest.screenshotCount, EXPECTED_SCREENSHOTS.length);
  assert.deepEqual(
    manifest.screenshots.map((screenshot) => screenshot.name),
    EXPECTED_SCREENSHOTS
  );
  assert.ok(manifest.screenshots.every((screenshot) => screenshot.bytes === PNG_FIXTURE.length));
  assert.ok(manifest.screenshots.every((screenshot) => /^[a-f0-9]{64}$/.test(screenshot.sha256)));
  assert.equal(manifest.machineReadableArtifactCount, EXPECTED_MACHINE_READABLE_ARTIFACTS.length);
  assert.deepEqual(
    manifest.machineReadableArtifacts.map((artifact) => artifact.name),
    EXPECTED_MACHINE_READABLE_ARTIFACTS
  );
  assert.ok(manifest.machineReadableArtifacts.every((artifact) => artifact.schemaVersion === 1));
  assert.ok(manifest.machineReadableArtifacts.every((artifact) => /^[a-f0-9]{64}$/.test(artifact.sha256)));

  const writtenManifest = JSON.parse(await readFile(output, 'utf8'));
  assert.deepEqual(writtenManifest, manifest);
  assert.equal(JSON.stringify(writtenManifest).includes('@'), false);

  await rm(path.join(tempDir, EXPECTED_SCREENSHOTS[0]));
  await assert.rejects(
    buildEvidence({ artifactDir: tempDir, output, sourceCommit, generatedAt }),
    /Missing expected synthetic UAT screenshots/
  );
  await writeFile(path.join(tempDir, EXPECTED_SCREENSHOTS[0]), Buffer.from('not a png'));
  await assert.rejects(
    buildEvidence({ artifactDir: tempDir, output, sourceCommit, generatedAt }),
    /valid PNG signature/
  );
  await writeFile(path.join(tempDir, EXPECTED_SCREENSHOTS[0]), PNG_FIXTURE);

  await writeFile(path.join(tempDir, 'unreviewed-state.png'), PNG_FIXTURE);
  await assert.rejects(
    buildEvidence({ artifactDir: tempDir, output, sourceCommit, generatedAt }),
    /Unreviewed UAT screenshots/
  );
  await rm(path.join(tempDir, 'unreviewed-state.png'));

  const missingMachineName = EXPECTED_MACHINE_READABLE_ARTIFACTS[0];
  await rm(path.join(tempDir, missingMachineName));
  await assert.rejects(
    buildEvidence({ artifactDir: tempDir, output, sourceCommit, generatedAt }),
    /Missing expected machine-readable UAT evidence/
  );
  await writeCanonicalJson(path.join(tempDir, missingMachineName), machineFixtures[missingMachineName]);

  const portalWithFreeText = {
    ...machineFixtures['refund-portal-assertions.json'],
    note: 'human-authored explanation',
  };
  assert.throws(
    () => validateMachineReadableEvidence('refund-portal-assertions.json', portalWithFreeText),
    /unsupported or missing fields/,
    'Free-text fields must fail the exact portal schema'
  );
  const portalWithProviderId = {
    ...machineFixtures['refund-portal-assertions.json'],
    providerTransactionId: 'provider-123',
  };
  assert.throws(
    () => validateMachineReadableEvidence('refund-portal-assertions.json', portalWithProviderId),
    /unsupported or missing fields/,
    'Provider identifiers must fail the exact portal schema'
  );
  const invalidMimeRoles = structuredClone(machineFixtures['refund-gmail-mime-roles.json']);
  invalidMimeRoles.roleCounts.managerCc = 1;
  assert.throws(
    () => validateMachineReadableEvidence('refund-gmail-mime-roles.json', invalidMimeRoles),
    /role count is invalid/,
    'MIME evidence must prove the exact two-manager #409 fixture'
  );
  const replayedProviderOutcome = {
    ...machineFixtures['refund-provider-outcomes.json'],
    replayProviderAttempts: 1,
  };
  assert.throws(
    () => validateMachineReadableEvidence('refund-provider-outcomes.json', replayedProviderOutcome),
    /replay-attempt count is invalid/,
    'Provider-outcome evidence must prove zero replay attempts'
  );

  await writeFile(
    path.join(tempDir, 'refund-kill-switches.json'),
    JSON.stringify(machineFixtures['refund-kill-switches.json']),
    'utf8'
  );
  await assert.rejects(
    buildEvidence({ artifactDir: tempDir, output, sourceCommit, generatedAt }),
    /canonical pretty-printed JSON/
  );
  await writeCanonicalJson(
    path.join(tempDir, 'refund-kill-switches.json'),
    machineFixtures['refund-kill-switches.json']
  );

  await writeCanonicalJson(path.join(tempDir, 'unreviewed-details.json'), { schemaVersion: 1 });
  await assert.rejects(
    buildEvidence({ artifactDir: tempDir, output, sourceCommit, generatedAt }),
    /Unreviewed UAT artifacts/
  );
  await rm(path.join(tempDir, 'unreviewed-details.json'));
  await assert.rejects(
    buildEvidence({
      artifactDir: tempDir,
      output,
      sourceCommit,
      freshAfter: 'not-an-iso-timestamp',
      generatedAt,
    }),
    /freshness boundary/,
    'Invalid evidence freshness boundaries must fail closed'
  );
  await assert.rejects(
    buildEvidence({
      artifactDir: tempDir,
      output,
      sourceCommit,
      freshAfter: '2999-01-01T00:00:00.000Z',
      generatedAt,
    }),
    /not freshly generated in this run/,
    'Artifacts older than the run boundary must fail closed'
  );
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

console.log('Refund UAT evidence validator passed.');
console.log(`- ${EXPECTED_SCREENSHOTS.length} required synthetic state screenshots`);
console.log(`- ${EXPECTED_MACHINE_READABLE_ARTIFACTS.length} strict machine-readable artifacts`);
console.log('- PNG/JSON schema, canonical encoding, and SHA-256 manifest checks');
console.log('- missing, corrupt, free-text, identity, and provider-ID evidence fails closed');
console.log('- manifest excludes production and identity data');
