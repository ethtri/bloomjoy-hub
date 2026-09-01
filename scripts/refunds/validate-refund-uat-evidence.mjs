#!/usr/bin/env node

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { deflateSync } from 'node:zlib';
import {
  EXPECTED_MACHINE_READABLE_ARTIFACTS,
  EXPECTED_SCREENSHOTS,
  buildEvidence,
  parseArgs,
  validateMachineReadableEvidence,
} from './refund-uat-evidence.mjs';
import {
  EXPECTED_FRAGMENT_ARTIFACTS,
  composeKillSwitchEvidence,
  finalizeRefundUatEvidence,
  parseFinalizeArgs,
  validateManagerAgingKillFragment,
} from './finalize-refund-uat-evidence.mjs';
import {
  createAuthenticatedEvidenceFragment,
  verifyAuthenticatedEvidenceFragment,
} from './refund-uat-fragment-provenance.mjs';
import {
  DATABASE_EVIDENCE_FILENAME,
  buildDatabaseEvidence,
  getDatabaseEvidenceExpectations,
  parseArgs as parseDatabaseArgs,
  parseDatabaseTestSummary,
  writeDatabaseEvidence,
} from '../validate-supabase-migrations.mjs';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) !== 0 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});
const pngCrc32 = (buffer) => {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = PNG_CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
};
const pngChunk = (type, data) => {
  const typeBytes = Buffer.from(type, 'ascii');
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  typeBytes.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(pngCrc32(Buffer.concat([typeBytes, data])), 8 + data.length);
  return chunk;
};
const buildPngFixture = (seed, ancillaryText = '', filterByte = 0) => {
  const width = 320;
  const height = 240;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const raw = Buffer.alloc((width * 3 + 1) * height);
  let state = (seed * 0x9e3779b1) >>> 0;
  for (let row = 0; row < height; row += 1) {
    const rowStart = row * (width * 3 + 1);
    raw[rowStart] = filterByte;
    for (let offset = rowStart + 1; offset < rowStart + width * 3 + 1; offset += 1) {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      raw[offset] = state & 0xff;
    }
  }
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', ihdr),
    ...(ancillaryText ? [pngChunk('tEXt', Buffer.from(`Comment\0${ancillaryText}`))] : []),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
};
const sourceCommit = 'a'.repeat(40);
const freshAfter = '2026-07-21T00:00:00.000Z';
const generatedAt = '2026-07-22T00:00:00.000Z';
const runToken = 'a'.repeat(64);
const alternateRunToken = 'b'.repeat(64);
const tempDir = await mkdtemp(path.join(os.tmpdir(), 'refund-uat-evidence-'));
const fragmentDir = path.join(tempDir, 'fragments');
const artifactDir = path.join(tempDir, 'final');
const databaseExpectations = getDatabaseEvidenceExpectations();
const screenshotFixtures = Object.fromEntries(
  EXPECTED_SCREENSHOTS.map((name, index) => [name, buildPngFixture(index + 1)])
);

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
    providerNonSuccessStateCount: 5,
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
    schemaVersion: 4,
    evidenceType: 'gmail_mime_roles',
    evidenceMode: 'synthetic_executable_email_pilot',
    firstContactRoleCounts: {
      customerTo: 1,
      managerCc: 0,
      mailboxTo: 0,
      unrelatedTo: 0,
      unrelatedCc: 0,
    },
    firstContactManagerCcCount: 0,
    caseSpecificRoleCounts: {
      customerTo: 1,
      managerCc: 2,
      mailboxTo: 0,
      unrelatedTo: 0,
      unrelatedCc: 0,
    },
    caseSpecificManagerCcCount: 2,
    partialManagerRouteRejected: true,
    sourceThreadPinned: true,
    caseSpecificSourceThreadPinned: true,
    replyHeadersPresent: true,
    caseSpecificReplyHeadersPresent: true,
    automaticHeadersPresent: true,
    caseSpecificAutomaticHeadersAbsent: true,
    internalLinkCount: 0,
    providerFetchCount: 3,
    providerSendCount: 2,
    caseSpecificOutboundCount: 1,
    firstContactOperationCount: 1,
    firstContactPrepareCount: 1,
    firstContactFinalizeCount: 1,
    sentOutboundCount: 1,
    duplicateMessageCount: 0,
    replaySuppressed: true,
    laterReplySuppressed: true,
    passed: true,
  },
  'refund-kill-switches.json': {
    schemaVersion: 2,
    evidenceType: 'kill_switches',
    evidenceMode: 'synthetic_executable_integration',
    passed: true,
    executableCoverage: {
      gmailOutbound: true,
      customerContact: true,
      managerAging: true,
      intakeAvailability: true,
      portalAvailability: true,
    },
    switches: {
      gmailOutbound: {
        disabled: true,
        deliveryClaimCount: 0,
        firstContactClaimCount: 0,
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
        fetchCallCount: 0,
        claimCallCount: 0,
        reservationCallCount: 0,
        sendCallCount: 0,
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

const rawFragmentFixtures = {
  'refund-portal-assertions.json': machineFixtures['refund-portal-assertions.json'],
  'refund-database-counts.json': machineFixtures['refund-database-counts.json'],
  'refund-gmail-mime-roles.json': machineFixtures['refund-gmail-mime-roles.json'],
  'refund-gmail-kill-fragment.json': {
    schemaVersion: 2,
    evidenceType: 'gmail_kill_switch_fragment',
    evidenceMode: 'synthetic_executable_transport',
    executableCoverage: {
      gmailOutbound: true,
      customerContact: true,
      managerAging: false,
      intakeAvailability: false,
      portalAvailability: false,
    },
    switches: {
      gmailOutbound: {
        disabled: true,
        deliveryClaimCount: 0,
        firstContactClaimCount: 0,
        providerFetchCount: 0,
        providerSendCount: 0,
      },
      customerContact: {
        disabled: true,
        deliveryClaimCount: 0,
        providerFetchCount: 0,
        providerSendCount: 0,
      },
    },
    requiresIntegrationAggregation: true,
    passed: true,
  },
  'refund-manager-aging-kill-fragment.json': {
    schemaVersion: 1,
    evidenceType: 'manager_aging_kill_fragment',
    evidenceMode: 'synthetic_dependency_injection',
    passed: true,
    disabled: true,
    fetchCallCount: 0,
    claimCallCount: 0,
    reservationCallCount: 0,
    sendCallCount: 0,
  },
  'refund-provider-outcomes.json': machineFixtures['refund-provider-outcomes.json'],
};

const fragmentFixtures = Object.fromEntries(
  Object.entries(rawFragmentFixtures).map(([filename, evidence]) => [
    filename,
    createAuthenticatedEvidenceFragment({
      filename,
      evidence,
      runToken,
      generatedAt,
    }),
  ])
);

const writeCanonicalJson = (filePath, value) =>
  writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');

try {
  await mkdir(fragmentDir, { recursive: true });
  await mkdir(artifactDir, { recursive: true });
  const workflowSource = await readFile(
    new URL('../../.github/workflows/refund-uat-evidence.yml', import.meta.url),
    'utf8'
  );
  assert.match(workflowSource, /denoland\/setup-deno@v2/);
  assert.match(workflowSource, /deno-version: v2\.6\.3/);
  assert.match(workflowSource, /crypto\.randomBytes\(32\)/);
  assert.match(workflowSource, /::add-mask::/);
  assert.match(workflowSource, /REFUND_UAT_EVIDENCE_RUN_TOKEN/);
  assert.match(
    workflowSource,
    /manifest\.screenshotCount/,
    'The job summary must read its screenshot count from the signed evidence manifest'
  );
  assert.match(
    workflowSource,
    /manifest\.machineReadableArtifactCount/,
    'The job summary must read its machine-readable count from the signed evidence manifest'
  );
  assert.doesNotMatch(
    workflowSource,
    /Screenshots: \d+ synthetic states/,
    'The job summary must not drift from the manifest through a hard-coded screenshot count'
  );
  assert.doesNotMatch(
    workflowSource,
    /Machine-readable evidence: \d+ strict/,
    'The job summary must not drift from the manifest through a hard-coded artifact count'
  );
  assert.doesNotMatch(
    workflowSource,
    /--run-token/,
    'The per-run HMAC token must remain environment-only and masked'
  );
  assert.equal(EXPECTED_SCREENSHOTS.length, 81, 'Evidence must enumerate all 81 reviewed screenshots');
  assert(
    EXPECTED_SCREENSHOTS.includes('refund-transactional-delivery-desktop.png') &&
      EXPECTED_SCREENSHOTS.includes('refund-transactional-delivery-mobile.png'),
    'Evidence must include reviewed desktop and mobile transactional-delivery truth states'
  );
  assert(
    EXPECTED_SCREENSHOTS.includes('refund-nayax-account-scope-mobile.png'),
    'Evidence must include the mobile internal Nayax account-scope recovery state'
  );
  assert(
    EXPECTED_SCREENSHOTS.includes('refund-acknowledgement-recovery-mobile.png') &&
      EXPECTED_SCREENSHOTS.includes('refund-acknowledgement-recovery-resolved.png'),
    'Evidence must include both reviewed acknowledgement-recovery states'
  );
  assert(
    EXPECTED_SCREENSHOTS.includes('refund-customer-locale-correction-mobile.png') &&
      EXPECTED_SCREENSHOTS.includes('refund-customer-locale-correction-saved.png'),
    'Evidence must include both reviewed customer-locale correction states'
  );
  assert(
    EXPECTED_SCREENSHOTS.includes('refund-internal-test-disposition-mobile.png') &&
      EXPECTED_SCREENSHOTS.includes('refund-internal-test-confirmation-desktop.png') &&
      EXPECTED_SCREENSHOTS.includes('refund-internal-test-archive-desktop.png') &&
      EXPECTED_SCREENSHOTS.includes('refund-internal-test-archive-mobile.png'),
    'Evidence must include the reviewed Internal/test disposition and restricted archive states'
  );
  assert(
    EXPECTED_SCREENSHOTS.includes('refund-selected-nayax-transaction-desktop.png') &&
      EXPECTED_SCREENSHOTS.includes('refund-selected-nayax-transaction-mobile.png'),
    'Evidence must include the reviewed selected Nayax transaction identity on desktop and mobile'
  );
  assert(
    EXPECTED_SCREENSHOTS.includes('refund-direct-intake-cash-desktop.png') &&
      EXPECTED_SCREENSHOTS.includes('refund-qr-intake-cash-mobile.png'),
    'Evidence must include reviewed desktop and mobile cash-intake states'
  );
  assert.equal(
    EXPECTED_SCREENSHOTS.filter((name) => name.startsWith('refund-manager-')).length,
    6,
    'Evidence must include confirmed ready/blocked and stale-evidence manager states on desktop and mobile'
  );
  assert.equal(
    EXPECTED_SCREENSHOTS.filter((name) => name.startsWith('machine-refunds-')).length,
    6,
    'Evidence must include ready, ready-to-activate, setup-needed, manual-portal-only, machine-disabled, and global-pause Admin states'
  );
  assert.equal(
    EXPECTED_SCREENSHOTS.filter((name) => name.startsWith('refund-simple-journey-')).length,
    4,
    'Evidence must include disabled, ready desktop/mobile, and success states for the simple journey'
  );
  assert(
    EXPECTED_SCREENSHOTS.includes('refund-portal-uat-sanitized-simple-card-refund-journey.png'),
    'Evidence must include the reviewed selectable-candidate state for the sanitized simple journey'
  );
  assert(
    EXPECTED_SCREENSHOTS.includes('refund-email-pilot-source-badges-mobile.png'),
    'Evidence must include the reviewed mobile source-badge state'
  );
  assert.equal(
    EXPECTED_SCREENSHOTS.filter((name) =>
      name.startsWith('refund-nayax-support-resolution-')
    ).length,
    2,
    'Evidence must include exactly one desktop and one mobile support-resolution state'
  );
  assert.equal(
    EXPECTED_SCREENSHOTS.filter((name) => name.includes('totp') || name.includes('step-up')).length,
    0,
    'The evidence allowlist must not preserve retired TOTP or step-up ceremony'
  );
  const portalUatSource = await readFile(
    new URL('./validate-refund-portal-uat.mjs', import.meta.url),
    'utf8'
  );
  assert.equal(
    EXPECTED_SCREENSHOTS.filter((name) => name.endsWith('mapped-manager-session.png')).length,
    2,
    'The evidence must show both mapped-manager session paths without a second factor'
  );
  assert.equal(
    EXPECTED_SCREENSHOTS.filter((name) => name.startsWith('refund-portal-uat-nc-manual-')).length,
    2,
    'The evidence must show the temporary NC manual path on desktop and mobile'
  );
  const supportPanelAssertionIndex = portalUatSource.indexOf(
    "'Managers see exactly four structured outcomes and no arbitrary communication controls'"
  );
  const supportDesktopScreenshotIndex = portalUatSource.indexOf(
    "path.join(artifactDir, 'refund-nayax-support-resolution-desktop.png')"
  );
  const supportMobileScreenshotIndex = portalUatSource.indexOf(
    "path.join(artifactDir, 'refund-nayax-support-resolution-mobile.png')"
  );
  const supportSubmitIndex = portalUatSource.indexOf(
    "await panel.getByTestId('refund-nayax-resolution-prepare').click();",
    supportMobileScreenshotIndex
  );
  const supportManagerSessionAssertionIndex = portalUatSource.indexOf(
    '`Manager-session ${scenario.result} submits one result with no provider or separate message endpoint`',
    supportSubmitIndex
  );
  assert(
    supportPanelAssertionIndex >= 0 &&
      supportDesktopScreenshotIndex > supportPanelAssertionIndex &&
      supportMobileScreenshotIndex > supportDesktopScreenshotIndex &&
      supportSubmitIndex > supportMobileScreenshotIndex &&
      supportManagerSessionAssertionIndex > supportSubmitIndex,
    'Support-resolution evidence must show structured desktop and mobile pre-action states before the mapped-manager submission'
  );
  const providerReceiptAssertionIndex = portalUatSource.indexOf(
    '`Synthetic browser ${scenario.name} renders the settled domain outcome`'
  );
  const providerScreenshotExpression =
    'page.screenshot({ path: path.join(artifactDir, scenario.screenshot), fullPage: true })';
  const providerScreenshotIndexes = [...portalUatSource.matchAll(
    /page\.screenshot\(\{ path: path\.join\(artifactDir, scenario\.screenshot\), fullPage: true \}\)/g
  )].map((match) => match.index);
  const providerPersistenceIndex = portalUatSource.indexOf(
    "if (scenario.name === 'success') {",
    providerReceiptAssertionIndex
  );
  assert.equal(
    providerScreenshotIndexes.length,
    1,
    'Each provider scenario must have exactly one reviewed screenshot capture'
  );
  assert(
    providerReceiptAssertionIndex >= 0 &&
      portalUatSource.indexOf('page.getByText(scenario.expectedTitle, { exact: true }).isVisible()', providerReceiptAssertionIndex) <
        providerScreenshotIndexes[0] &&
      providerScreenshotIndexes[0] < providerPersistenceIndex,
    `Provider screenshots must capture the asserted scenario-specific receipt before normalized persistence checks: ${providerScreenshotExpression}`
  );
  assert.deepEqual(
    EXPECTED_MACHINE_READABLE_ARTIFACTS,
    Object.keys(machineFixtures),
    'Evidence must enumerate the five strict machine-readable artifacts in canonical order'
  );
  assert.deepEqual(
    EXPECTED_FRAGMENT_ARTIFACTS,
    Object.keys(fragmentFixtures),
    'Finalization must enumerate exactly the six reviewed producer fragments'
  );
  assert.equal(DATABASE_EVIDENCE_FILENAME, 'refund-database-counts.json');
  const databaseArgs = parseDatabaseArgs(['--evidence-dir', fragmentDir]);
  assert.equal(databaseArgs.evidenceDir, fragmentDir);
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
  const databaseWriterDir = path.join(tempDir, 'database-writer');
  const databaseEvidencePath = writeDatabaseEvidence(
    databaseWriterDir,
    machineFixtures['refund-database-counts.json'],
    runToken,
    generatedAt
  );
  assert.equal(
    JSON.parse(await readFile(databaseEvidencePath, 'utf8')).evidence.assertionCount,
    machineFixtures['refund-database-counts.json'].assertionCount
  );
  assert.throws(
    () =>
      writeDatabaseEvidence(
        databaseWriterDir,
        machineFixtures['refund-database-counts.json'],
        runToken,
        generatedAt
      ),
    /EEXIST/,
    'Database evidence producer refuses to overwrite a prior run fragment'
  );

  const parsed = parseArgs([
    '--artifact-dir',
    artifactDir,
    '--source-commit',
    sourceCommit,
    '--fresh-after',
    freshAfter,
  ]);
  assert.equal(parsed.artifactDir, path.resolve(artifactDir));
  assert.equal(parsed.output, path.join(path.resolve(artifactDir), 'refund-uat-evidence.json'));
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
    await writeFile(path.join(artifactDir, name), screenshotFixtures[name]);
  }
  for (const [name, payload] of Object.entries(fragmentFixtures)) {
    await writeCanonicalJson(path.join(fragmentDir, name), payload);
  }

  const finalizedArgs = parseFinalizeArgs([
    '--fragment-dir',
    fragmentDir,
    '--artifact-dir',
    artifactDir,
    '--fresh-after',
    freshAfter,
  ]);
  assert.equal(finalizedArgs.fragmentDir, path.resolve(fragmentDir));
  assert.equal(finalizedArgs.artifactDir, path.resolve(artifactDir));
  assert.equal(finalizedArgs.freshAfter, freshAfter);
  assert.throws(
    () => parseFinalizeArgs(['--fragment-dir', fragmentDir]),
    /are required/,
    'Finalization requires explicit isolated directories and a freshness boundary'
  );
  const invalidAgingFragment = {
    ...rawFragmentFixtures['refund-manager-aging-kill-fragment.json'],
    fetchCallCount: 1,
  };
  assert.throws(
    () => validateManagerAgingKillFragment(invalidAgingFragment),
    /fetch-call count is invalid/,
    'Manager-aging evidence must prove shutdown before its first fetch'
  );
  const forgedPortalFragment = structuredClone(
    fragmentFixtures['refund-portal-assertions.json']
  );
  forgedPortalFragment.evidence.assertionCount += 1;
  assert.throws(
    () =>
      verifyAuthenticatedEvidenceFragment({
        filename: 'refund-portal-assertions.json',
        fragment: forgedPortalFragment,
        runToken,
        freshAfter,
      }),
    /HMAC does not match/,
    'Changed evidence cannot reuse a producer HMAC'
  );
  assert.throws(
    () =>
      verifyAuthenticatedEvidenceFragment({
        filename: 'refund-portal-assertions.json',
        fragment: rawFragmentFixtures['refund-portal-assertions.json'],
        runToken,
        freshAfter,
      }),
    /authenticated envelope contains unsupported or missing fields/,
    'Fresh hand-written payloads are not accepted without producer provenance'
  );
  assert.throws(
    () =>
      createAuthenticatedEvidenceFragment({
        filename: 'refund-portal-assertions.json',
        evidence: rawFragmentFixtures['refund-portal-assertions.json'],
        runToken: '',
        generatedAt,
      }),
    /run token/,
    'Producers fail closed without the environment-owned run token'
  );
  const stalePortalFragment = createAuthenticatedEvidenceFragment({
    filename: 'refund-portal-assertions.json',
    evidence: rawFragmentFixtures['refund-portal-assertions.json'],
    runToken,
    generatedAt: '2026-07-20T23:59:59.000Z',
  });
  assert.throws(
    () =>
      verifyAuthenticatedEvidenceFragment({
        filename: 'refund-portal-assertions.json',
        fragment: stalePortalFragment,
        runToken,
        freshAfter,
      }),
    /predates this evidence run/,
    'Authenticated fragments still must be generated after this run started'
  );
  assert.throws(
    () =>
      verifyAuthenticatedEvidenceFragment({
        filename: 'refund-portal-assertions.json',
        fragment: fragmentFixtures['refund-provider-outcomes.json'],
        runToken,
        freshAfter,
      }),
    /producer is invalid/,
    'A valid fragment from one producer cannot be substituted for another filename'
  );
  const mixedRunPortalFragment = createAuthenticatedEvidenceFragment({
    filename: 'refund-portal-assertions.json',
    evidence: rawFragmentFixtures['refund-portal-assertions.json'],
    runToken: alternateRunToken,
    generatedAt,
  });
  assert.throws(
    () =>
      verifyAuthenticatedEvidenceFragment({
        filename: 'refund-portal-assertions.json',
        fragment: mixedRunPortalFragment,
        runToken,
        freshAfter,
      }),
    /current run/,
    'Fragments authenticated by another run token cannot be mixed into this run'
  );
  await assert.rejects(
    finalizeRefundUatEvidence({
      fragmentDir,
      artifactDir,
      freshAfter: '2999-01-01T00:00:00.000Z',
      runToken,
    }),
    /was not freshly generated/,
    'Finalization rejects producer evidence from before the workflow boundary'
  );
  const finalized = await finalizeRefundUatEvidence({ ...finalizedArgs, runToken });
  assert.deepEqual(finalized, machineFixtures);
  assert.deepEqual(
    composeKillSwitchEvidence({
      gmail: rawFragmentFixtures['refund-gmail-kill-fragment.json'],
      managerAging: rawFragmentFixtures['refund-manager-aging-kill-fragment.json'],
      portal: rawFragmentFixtures['refund-portal-assertions.json'],
    }),
    machineFixtures['refund-kill-switches.json']
  );
  await assert.rejects(
    finalizeRefundUatEvidence({ ...finalizedArgs, runToken }),
    /Refusing to overwrite an existing final evidence file/,
    'Finalization uses create-new output semantics'
  );

  const output = path.join(artifactDir, 'manifest.json');
  const manifest = await buildEvidence({
    artifactDir,
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
  assert.ok(manifest.screenshots.every((screenshot) => screenshot.bytes >= 4 * 1024));
  assert.ok(manifest.screenshots.every((screenshot) => /^[a-f0-9]{64}$/.test(screenshot.sha256)));
  assert.equal(
    new Set(manifest.screenshots.map((screenshot) => screenshot.sha256)).size,
    EXPECTED_SCREENSHOTS.length
  );
  assert.equal(manifest.machineReadableArtifactCount, EXPECTED_MACHINE_READABLE_ARTIFACTS.length);
  assert.deepEqual(
    manifest.machineReadableArtifacts.map((artifact) => artifact.name),
    EXPECTED_MACHINE_READABLE_ARTIFACTS
  );
  assert.deepEqual(
    manifest.machineReadableArtifacts.map((artifact) => artifact.schemaVersion),
    [1, 1, 4, 2, 1]
  );
  assert.ok(manifest.machineReadableArtifacts.every((artifact) => /^[a-f0-9]{64}$/.test(artifact.sha256)));

  const writtenManifest = JSON.parse(await readFile(output, 'utf8'));
  assert.deepEqual(writtenManifest, manifest);
  assert.equal(JSON.stringify(writtenManifest).includes('@'), false);

  await rm(path.join(artifactDir, EXPECTED_SCREENSHOTS[0]));
  await assert.rejects(
    buildEvidence({ artifactDir, output, sourceCommit, generatedAt }),
    /Missing expected synthetic UAT screenshots/
  );
  await writeFile(path.join(artifactDir, EXPECTED_SCREENSHOTS[0]), PNG_SIGNATURE);
  await assert.rejects(
    buildEvidence({ artifactDir, output, sourceCommit, generatedAt }),
    /too small/,
    'Signature-only screenshots must fail the minimum-size check'
  );
  await writeFile(
    path.join(artifactDir, EXPECTED_SCREENSHOTS[0]),
    Buffer.alloc(screenshotFixtures[EXPECTED_SCREENSHOTS[0]].length)
  );
  await assert.rejects(
    buildEvidence({ artifactDir, output, sourceCommit, generatedAt }),
    /valid PNG signature/
  );
  await writeFile(
    path.join(artifactDir, EXPECTED_SCREENSHOTS[0]),
    screenshotFixtures[EXPECTED_SCREENSHOTS[0]].subarray(
      0,
      screenshotFixtures[EXPECTED_SCREENSHOTS[0]].length - 6
    )
  );
  await assert.rejects(
    buildEvidence({ artifactDir, output, sourceCommit, generatedAt }),
    /truncated PNG chunk/,
    'Truncated screenshots must fail structural validation'
  );
  await writeFile(
    path.join(artifactDir, EXPECTED_SCREENSHOTS[0]),
    buildPngFixture(1, '', 5)
  );
  await assert.rejects(
    buildEvidence({ artifactDir, output, sourceCommit, generatedAt }),
    /invalid PNG scanline filter/,
    'Invalid PNG scanline filters must fail before pixel comparison'
  );
  await writeFile(
    path.join(artifactDir, EXPECTED_SCREENSHOTS[0]),
    screenshotFixtures[EXPECTED_SCREENSHOTS[0]]
  );
  await writeFile(
    path.join(artifactDir, EXPECTED_SCREENSHOTS[1]),
    buildPngFixture(1, 'alternate-metadata')
  );
  assert.notDeepEqual(
    screenshotFixtures[EXPECTED_SCREENSHOTS[0]],
    buildPngFixture(1, 'alternate-metadata'),
    'The duplicate-pixel fixture must use a different PNG byte encoding'
  );
  await assert.rejects(
    buildEvidence({ artifactDir, output, sourceCommit, generatedAt }),
    /distinct decoded pixels/,
    'Pixel-identical state screenshots must fail even when PNG bytes differ'
  );
  await writeFile(
    path.join(artifactDir, EXPECTED_SCREENSHOTS[1]),
    screenshotFixtures[EXPECTED_SCREENSHOTS[1]]
  );

  await writeFile(path.join(artifactDir, 'unreviewed-state.png'), buildPngFixture(999));
  await assert.rejects(
    buildEvidence({ artifactDir, output, sourceCommit, generatedAt }),
    /Unreviewed UAT screenshots/
  );
  await rm(path.join(artifactDir, 'unreviewed-state.png'));

  const missingMachineName = EXPECTED_MACHINE_READABLE_ARTIFACTS[0];
  await rm(path.join(artifactDir, missingMachineName));
  await assert.rejects(
    buildEvidence({ artifactDir, output, sourceCommit, generatedAt }),
    /Missing expected machine-readable UAT evidence/
  );
  await writeCanonicalJson(
    path.join(artifactDir, missingMachineName),
    machineFixtures[missingMachineName]
  );

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
  invalidMimeRoles.caseSpecificRoleCounts.managerCc = 1;
  assert.throws(
    () => validateMachineReadableEvidence('refund-gmail-mime-roles.json', invalidMimeRoles),
    /role count is invalid/,
    'MIME evidence must prove the exact two-manager #409 fixture'
  );
  const partialRouteAccepted = structuredClone(machineFixtures['refund-gmail-mime-roles.json']);
  partialRouteAccepted.partialManagerRouteRejected = false;
  assert.throws(
    () => validateMachineReadableEvidence('refund-gmail-mime-roles.json', partialRouteAccepted),
    /partial-manager route rejection is invalid/,
    'MIME evidence must prove partial current-manager routes fail before provider access'
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
    path.join(artifactDir, 'refund-kill-switches.json'),
    JSON.stringify(machineFixtures['refund-kill-switches.json']),
    'utf8'
  );
  await assert.rejects(
    buildEvidence({ artifactDir, output, sourceCommit, generatedAt }),
    /canonical pretty-printed JSON/
  );
  await writeCanonicalJson(
    path.join(artifactDir, 'refund-kill-switches.json'),
    machineFixtures['refund-kill-switches.json']
  );

  await writeCanonicalJson(path.join(artifactDir, 'unreviewed-details.json'), { schemaVersion: 1 });
  await assert.rejects(
    buildEvidence({ artifactDir, output, sourceCommit, generatedAt }),
    /Unreviewed UAT artifacts/
  );
  await rm(path.join(artifactDir, 'unreviewed-details.json'));
  await assert.rejects(
    buildEvidence({
      artifactDir,
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
      artifactDir,
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
console.log('- PNG structure, decoded-pixel uniqueness, JSON schema, and SHA-256 manifest checks');
console.log('- six masked-run HMAC producer envelopes are verified and stripped before upload');
console.log('- missing, stale, forged, corrupt, free-text, identity, and provider-ID evidence fails closed');
console.log('- manifest excludes production and identity data');
