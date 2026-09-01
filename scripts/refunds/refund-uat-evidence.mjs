#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { getDatabaseEvidenceExpectations } from '../validate-supabase-migrations.mjs';

const __filename = fileURLToPath(import.meta.url);

export const EXPECTED_SCREENSHOTS = [
  'admin-machines-machine-managers.png',
  'machine-refunds-globally-paused-mobile.png',
  'machine-refunds-machine-disabled-mobile.png',
  'machine-refunds-manual-portal-only-desktop.png',
  'machine-refunds-ready-desktop.png',
  'machine-refunds-ready-to-activate-desktop.png',
  'machine-refunds-setup-needed-desktop.png',
  'refund-direct-intake-card-type-desktop.png',
  'refund-direct-intake-cash-desktop.png',
  'refund-direct-intake-desktop.png',
  'refund-acknowledgement-recovery-mobile.png',
  'refund-acknowledgement-recovery-resolved.png',
  'refund-customer-locale-correction-mobile.png',
  'refund-customer-locale-correction-saved.png',
  'refund-internal-test-disposition-mobile.png',
  'refund-internal-test-confirmation-desktop.png',
  'refund-internal-test-archive-desktop.png',
  'refund-internal-test-archive-mobile.png',
  'refund-transactional-delivery-desktop.png',
  'refund-transactional-delivery-mobile.png',
  'refund-automatic-nayax-ready-desktop.png',
  'refund-automatic-nayax-ready-mobile.png',
  'refund-email-pilot-duplicate-review-desktop.png',
  'refund-email-pilot-duplicate-review-mobile.png',
  'refund-email-pilot-hosted-form-desktop.png',
  'refund-email-pilot-hosted-form-mobile.png',
  'refund-email-pilot-source-badges-mobile.png',
  'refund-evidence-selection-desktop.png',
  'refund-evidence-selection-mobile.png',
  'refund-manager-confirmed-blocked-desktop.png',
  'refund-manager-confirmed-blocked-mobile.png',
  'refund-manager-confirmed-ready-desktop.png',
  'refund-manager-confirmed-ready-mobile.png',
  'refund-manager-stale-evidence-recovery-desktop.png',
  'refund-manager-stale-evidence-recovery-mobile.png',
  'refund-nayax-support-resolution-desktop.png',
  'refund-nayax-support-resolution-mobile.png',
  'refund-nayax-evidence-only-reconciliation.png',
  'refund-portal-demo-fallback.png',
  'refund-portal-gmail-draft-desktop.png',
  'refund-portal-gmail-draft-mobile.png',
  'refund-portal-uat-cash-confirmation.png',
  'refund-portal-uat-cash-desktop.png',
  'refund-portal-uat-cash-mobile.png',
  'refund-portal-uat-cash-success.png',
  'refund-portal-uat-confirmation.png',
  'refund-portal-uat-desktop.png',
  'refund-portal-uat-lookup-failed.png',
  'refund-portal-uat-mapped-scoped-admin-mapped-manager-session.png',
  'refund-portal-uat-mapped-super-admin-mapped-manager-session.png',
  'refund-portal-uat-mobile.png',
  'refund-portal-uat-multiple-candidates.png',
  'refund-portal-uat-nc-manual-desktop.png',
  'refund-portal-uat-nc-manual-mobile.png',
  'refund-portal-uat-no-match.png',
  'refund-portal-uat-processing.png',
  'refund-portal-uat-routine-manager-desktop.png',
  'refund-portal-uat-routine-manager-mobile.png',
  'refund-selected-nayax-transaction-desktop.png',
  'refund-selected-nayax-transaction-mobile.png',
  'refund-portal-uat-sanitized-simple-card-refund-journey.png',
  'refund-portal-uat-physical-card-mismatch.png',
  'refund-portal-uat-setup-needed.png',
  'refund-nayax-account-scope-mobile.png',
  'refund-simple-journey-machine-disabled-desktop.png',
  'refund-simple-journey-ready-desktop.png',
  'refund-simple-journey-ready-mobile.png',
  'refund-simple-journey-success-desktop.png',
  'refund-portal-uat-unique-qr-wallet-recommendation.png',
  'refund-portal-uat-wallet-waiting-on-customer.png',
  'refund-provider-rejected.png',
  'refund-provider-config-blocked.png',
  'refund-provider-pending.png',
  'refund-provider-success.png',
  'refund-provider-timeout.png',
  'refund-provider-unknown.png',
  'refund-qr-intake-desktop.png',
  'refund-qr-intake-cash-mobile.png',
  'refund-qr-intake-mobile.png',
  'refund-qr-intake-mobile-wallet.png',
  'refund-qr-intake-retired.png',
];

export const EXPECTED_MACHINE_READABLE_ARTIFACTS = [
  'refund-portal-assertions.json',
  'refund-database-counts.json',
  'refund-gmail-mime-roles.json',
  'refund-kill-switches.json',
  'refund-provider-outcomes.json',
];

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MIN_PNG_BYTES = 4 * 1024;
const MIN_SCREENSHOT_WIDTH = 320;
const MIN_SCREENSHOT_HEIGHT = 240;
const MAX_SCREENSHOT_DIMENSION = 16_384;
const MAX_MACHINE_ARTIFACT_BYTES = 16 * 1024;

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

export function validateSyntheticScreenshotPng(buffer, name) {
  if (buffer.length < MIN_PNG_BYTES) {
    throw new Error(`${name} is too small to be a reviewed synthetic screenshot.`);
  }
  if (!buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    throw new Error(`Expected a valid PNG signature for ${name}.`);
  }

  let offset = PNG_SIGNATURE.length;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = -1;
  let interlace = -1;
  let sawIhdr = false;
  let sawIend = false;
  const idatChunks = [];
  while (offset < buffer.length) {
    if (offset + 12 > buffer.length) throw new Error(`${name} has a truncated PNG chunk.`);
    const dataLength = buffer.readUInt32BE(offset);
    const typeStart = offset + 4;
    const dataStart = offset + 8;
    const dataEnd = dataStart + dataLength;
    const chunkEnd = dataEnd + 4;
    if (chunkEnd > buffer.length) throw new Error(`${name} has a truncated PNG chunk.`);
    const typeBytes = buffer.subarray(typeStart, dataStart);
    const type = typeBytes.toString('ascii');
    const expectedCrc = buffer.readUInt32BE(dataEnd);
    const actualCrc = pngCrc32(buffer.subarray(typeStart, dataEnd));
    if (actualCrc !== expectedCrc) throw new Error(`${name} has an invalid ${type} chunk CRC.`);

    if (!sawIhdr && type !== 'IHDR') throw new Error(`${name} must begin with an IHDR chunk.`);
    if (type === 'IHDR') {
      if (sawIhdr || dataLength !== 13) throw new Error(`${name} has an invalid IHDR chunk.`);
      sawIhdr = true;
      width = buffer.readUInt32BE(dataStart);
      height = buffer.readUInt32BE(dataStart + 4);
      bitDepth = buffer[dataStart + 8];
      colorType = buffer[dataStart + 9];
      if (buffer[dataStart + 10] !== 0 || buffer[dataStart + 11] !== 0) {
        throw new Error(`${name} uses unsupported PNG compression or filtering.`);
      }
      interlace = buffer[dataStart + 12];
    } else if (type === 'IDAT') {
      idatChunks.push(buffer.subarray(dataStart, dataEnd));
    } else if (type === 'IEND') {
      if (sawIend || dataLength !== 0 || chunkEnd !== buffer.length) {
        throw new Error(`${name} has an invalid IEND boundary.`);
      }
      sawIend = true;
    }
    offset = chunkEnd;
  }

  if (!sawIhdr || !sawIend || idatChunks.length === 0) {
    throw new Error(`${name} must contain IHDR, IDAT, and IEND chunks.`);
  }
  if (
    width < MIN_SCREENSHOT_WIDTH ||
    height < MIN_SCREENSHOT_HEIGHT ||
    width > MAX_SCREENSHOT_DIMENSION ||
    height > MAX_SCREENSHOT_DIMENSION
  ) {
    throw new Error(`${name} has implausible synthetic screenshot dimensions.`);
  }
  if (bitDepth !== 8 || ![2, 6].includes(colorType) || interlace !== 0) {
    throw new Error(`${name} uses an unsupported PNG color or interlace mode.`);
  }
  const channels = colorType === 2 ? 3 : 4;
  const rowBytes = width * channels;
  const expectedInflatedBytes = (rowBytes + 1) * height;
  let inflated;
  try {
    inflated = inflateSync(Buffer.concat(idatChunks));
  } catch {
    throw new Error(`${name} contains invalid compressed PNG image data.`);
  }
  if (inflated.length !== expectedInflatedBytes) {
    throw new Error(`${name} contains incomplete PNG scanline data.`);
  }
  const decodedPixels = Buffer.alloc(rowBytes * height);
  const paeth = (left, above, upperLeft) => {
    const prediction = left + above - upperLeft;
    const leftDistance = Math.abs(prediction - left);
    const aboveDistance = Math.abs(prediction - above);
    const upperLeftDistance = Math.abs(prediction - upperLeft);
    if (leftDistance <= aboveDistance && leftDistance <= upperLeftDistance) return left;
    return aboveDistance <= upperLeftDistance ? above : upperLeft;
  };
  for (let row = 0; row < height; row += 1) {
    const sourceRowStart = row * (rowBytes + 1);
    const targetRowStart = row * rowBytes;
    const filter = inflated[sourceRowStart];
    if (filter > 4) throw new Error(`${name} contains an invalid PNG scanline filter.`);
    for (let column = 0; column < rowBytes; column += 1) {
      const encoded = inflated[sourceRowStart + 1 + column];
      const left = column >= channels ? decodedPixels[targetRowStart + column - channels] : 0;
      const above = row > 0 ? decodedPixels[targetRowStart - rowBytes + column] : 0;
      const upperLeft =
        row > 0 && column >= channels
          ? decodedPixels[targetRowStart - rowBytes + column - channels]
          : 0;
      const predictor =
        filter === 0
          ? 0
          : filter === 1
            ? left
            : filter === 2
              ? above
              : filter === 3
                ? Math.floor((left + above) / 2)
                : paeth(left, above, upperLeft);
      decodedPixels[targetRowStart + column] = (encoded + predictor) & 0xff;
    }
  }
  const pixelSha256 = createHash('sha256')
    .update(JSON.stringify({ width, height, colorType }))
    .update(decodedPixels)
    .digest('hex');
  return { width, height, pixelSha256 };
}

const isPlainObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const assertExactKeys = (value, expectedKeys, label) => {
  if (!isPlainObject(value)) {
    throw new Error(`${label} must be an object.`);
  }
  const actualKeys = Object.keys(value).sort();
  const sortedExpected = [...expectedKeys].sort();
  if (JSON.stringify(actualKeys) !== JSON.stringify(sortedExpected)) {
    throw new Error(`${label} contains unsupported or missing fields.`);
  }
};

const assertLiteral = (actual, expected, label) => {
  if (actual !== expected) throw new Error(`${label} is invalid.`);
};

const assertCount = (value, label, { min = 0, max = 1_000_000 } = {}) => {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${label} must be a bounded aggregate count.`);
  }
};

const validatePortalAssertions = (payload) => {
  assertExactKeys(payload, [
    'schemaVersion',
    'evidenceType',
    'evidenceMode',
    'passed',
    'assertionCount',
    'failedAssertionCount',
    'navigationProviderCallCount',
    'navigationOfficialActionCallCount',
    'navigationLookupCallCount',
    'navigationNayaxCardRefundCallCount',
    'navigationAdminUpdateCallCount',
    'navigationCustomerMessageCallCount',
    'navigationStepUpCallCount',
    'navigationMutatingRpcCallCount',
    'primaryCheckLookupCallCountBefore',
    'primaryCheckLookupCallCountAfter',
    'providerSuccessStateCount',
    'providerNonSuccessStateCount',
    'intakeAvailable',
    'portalAvailable',
  ], 'Portal assertion evidence');
  assertLiteral(payload.schemaVersion, 1, 'Portal assertion schemaVersion');
  assertLiteral(payload.evidenceType, 'portal_assertions', 'Portal assertion evidenceType');
  assertLiteral(payload.evidenceMode, 'synthetic_browser_mocks', 'Portal assertion evidenceMode');
  assertLiteral(payload.passed, true, 'Portal assertion passed flag');
  assertCount(payload.assertionCount, 'Portal assertion count', { min: 101 });
  assertLiteral(payload.failedAssertionCount, 0, 'Portal failed assertion count');
  assertLiteral(payload.navigationProviderCallCount, 0, 'Portal navigation provider call count');
  assertLiteral(payload.navigationOfficialActionCallCount, 0, 'Portal navigation official-action call count');
  assertLiteral(payload.navigationLookupCallCount, 0, 'Portal navigation lookup-call count');
  assertLiteral(
    payload.navigationNayaxCardRefundCallCount,
    0,
    'Portal navigation Nayax-refund call count'
  );
  assertLiteral(payload.navigationAdminUpdateCallCount, 0, 'Portal navigation admin-update call count');
  assertLiteral(
    payload.navigationCustomerMessageCallCount,
    0,
    'Portal navigation customer-message call count'
  );
  assertLiteral(payload.navigationStepUpCallCount, 0, 'Portal navigation step-up call count');
  assertLiteral(
    payload.navigationMutatingRpcCallCount,
    0,
    'Portal navigation mutating-RPC call count'
  );
  assertLiteral(
    payload.primaryCheckLookupCallCountBefore,
    0,
    'Portal primary-check pre-action lookup call count'
  );
  assertLiteral(
    payload.primaryCheckLookupCallCountAfter,
    1,
    'Portal primary-check post-action lookup call count'
  );
  assertLiteral(payload.providerSuccessStateCount, 1, 'Portal provider success-state count');
  assertLiteral(payload.providerNonSuccessStateCount, 5, 'Portal provider non-success-state count');
  assertLiteral(payload.intakeAvailable, true, 'Portal intake-availability assertion');
  assertLiteral(payload.portalAvailable, true, 'Portal availability assertion');
};

const validateDatabaseCounts = (payload) => {
  assertExactKeys(payload, [
    'schemaVersion',
    'evidenceType',
    'evidenceMode',
    'passed',
    'migrationCount',
    'testFileCount',
    'assertionCount',
    'failedAssertionCount',
  ], 'Database count evidence');
  assertLiteral(payload.schemaVersion, 1, 'Database count schemaVersion');
  assertLiteral(payload.evidenceType, 'database_counts', 'Database count evidenceType');
  assertLiteral(payload.evidenceMode, 'disposable_local_database', 'Database count evidenceMode');
  assertLiteral(payload.passed, true, 'Database count passed flag');
  const expected = getDatabaseEvidenceExpectations();
  assertLiteral(payload.migrationCount, expected.migrationCount, 'Migration count');
  assertLiteral(payload.testFileCount, expected.testFileCount, 'Database test-file count');
  assertCount(payload.assertionCount, 'Database assertion count', { min: 850 });
  assertLiteral(payload.failedAssertionCount, 0, 'Database failed assertion count');
};

const validateMimeRoles = (payload) => {
  assertExactKeys(payload, [
    'schemaVersion',
    'evidenceType',
    'evidenceMode',
    'firstContactRoleCounts',
    'firstContactManagerCcCount',
    'caseSpecificRoleCounts',
    'caseSpecificManagerCcCount',
    'partialManagerRouteRejected',
    'sourceThreadPinned',
    'caseSpecificSourceThreadPinned',
    'replyHeadersPresent',
    'caseSpecificReplyHeadersPresent',
    'automaticHeadersPresent',
    'caseSpecificAutomaticHeadersAbsent',
    'internalLinkCount',
    'providerFetchCount',
    'providerSendCount',
    'caseSpecificOutboundCount',
    'firstContactOperationCount',
    'firstContactPrepareCount',
    'firstContactFinalizeCount',
    'sentOutboundCount',
    'duplicateMessageCount',
    'replaySuppressed',
    'laterReplySuppressed',
    'passed',
  ], 'Gmail MIME-role evidence');
  assertLiteral(payload.schemaVersion, 4, 'Gmail MIME-role schemaVersion');
  assertLiteral(payload.evidenceType, 'gmail_mime_roles', 'Gmail MIME-role evidenceType');
  assertLiteral(
    payload.evidenceMode,
    'synthetic_executable_email_pilot',
    'Gmail MIME-role evidenceMode'
  );
  assertLiteral(payload.passed, true, 'Gmail MIME-role passed flag');
  assertExactKeys(payload.firstContactRoleCounts, [
    'customerTo',
    'managerCc',
    'mailboxTo',
    'unrelatedTo',
    'unrelatedCc',
  ], 'Gmail first-contact MIME role counts');
  assertLiteral(payload.firstContactRoleCounts.customerTo, 1, 'Gmail first-contact customer To role count');
  assertLiteral(payload.firstContactRoleCounts.managerCc, 0, 'Gmail first-contact manager CC role count');
  assertLiteral(payload.firstContactRoleCounts.mailboxTo, 0, 'Gmail first-contact mailbox To role count');
  assertLiteral(payload.firstContactRoleCounts.unrelatedTo, 0, 'Gmail first-contact unrelated To role count');
  assertLiteral(payload.firstContactRoleCounts.unrelatedCc, 0, 'Gmail first-contact unrelated CC role count');
  assertLiteral(payload.firstContactManagerCcCount, 0, 'Gmail first-contact manager CC count');
  assertExactKeys(payload.caseSpecificRoleCounts, [
    'customerTo',
    'managerCc',
    'mailboxTo',
    'unrelatedTo',
    'unrelatedCc',
  ], 'Gmail case-specific MIME role counts');
  assertLiteral(payload.caseSpecificRoleCounts.customerTo, 1, 'Gmail case-specific customer To role count');
  assertLiteral(payload.caseSpecificRoleCounts.managerCc, 2, 'Gmail case-specific manager CC role count');
  assertLiteral(payload.caseSpecificRoleCounts.mailboxTo, 0, 'Gmail case-specific mailbox To role count');
  assertLiteral(payload.caseSpecificRoleCounts.unrelatedTo, 0, 'Gmail case-specific unrelated To role count');
  assertLiteral(payload.caseSpecificRoleCounts.unrelatedCc, 0, 'Gmail case-specific unrelated CC role count');
  assertLiteral(payload.caseSpecificManagerCcCount, 2, 'Gmail case-specific manager CC count');
  assertLiteral(
    payload.partialManagerRouteRejected,
    true,
    'Gmail partial-manager route rejection'
  );
  assertLiteral(payload.sourceThreadPinned, true, 'Gmail source-thread pin');
  assertLiteral(payload.caseSpecificSourceThreadPinned, true, 'Gmail case-specific source-thread pin');
  assertLiteral(payload.replyHeadersPresent, true, 'Gmail reply-header assertion');
  assertLiteral(payload.caseSpecificReplyHeadersPresent, true, 'Gmail case-specific reply-header assertion');
  assertLiteral(payload.automaticHeadersPresent, true, 'Gmail automatic-header assertion');
  assertLiteral(payload.caseSpecificAutomaticHeadersAbsent, true, 'Gmail case-specific manual-header assertion');
  assertLiteral(payload.internalLinkCount, 0, 'Gmail internal-link count');
  assertLiteral(payload.providerFetchCount, 3, 'Gmail provider-fetch count');
  assertLiteral(payload.providerSendCount, 2, 'Gmail provider-send count');
  assertLiteral(payload.caseSpecificOutboundCount, 1, 'Gmail case-specific outbound count');
  assertLiteral(payload.firstContactOperationCount, 1, 'Gmail first-contact operation count');
  assertLiteral(payload.firstContactPrepareCount, 1, 'Gmail first-contact prepare count');
  assertLiteral(payload.firstContactFinalizeCount, 1, 'Gmail first-contact finalize count');
  assertLiteral(payload.sentOutboundCount, 1, 'Gmail sent-outbound count');
  assertLiteral(payload.duplicateMessageCount, 0, 'Gmail duplicate-message count');
  assertLiteral(payload.replaySuppressed, true, 'Gmail replay-suppression assertion');
  assertLiteral(payload.laterReplySuppressed, true, 'Gmail later-reply suppression assertion');
};

const validateGmailOutboundKillSwitchCounts = (value, label) => {
  assertExactKeys(value, [
    'disabled',
    'deliveryClaimCount',
    'firstContactClaimCount',
    'providerFetchCount',
    'providerSendCount',
  ], label);
  assertLiteral(value.disabled, true, `${label} disabled flag`);
  assertLiteral(value.deliveryClaimCount, 0, `${label} delivery-claim count`);
  assertLiteral(value.firstContactClaimCount, 0, `${label} first-contact claim count`);
  assertLiteral(value.providerFetchCount, 0, `${label} provider-fetch count`);
  assertLiteral(value.providerSendCount, 0, `${label} provider-send count`);
};

const validateCustomerContactKillSwitchCounts = (value, label) => {
  assertExactKeys(value, [
    'disabled',
    'deliveryClaimCount',
    'providerFetchCount',
    'providerSendCount',
  ], label);
  assertLiteral(value.disabled, true, `${label} disabled flag`);
  assertLiteral(value.deliveryClaimCount, 0, `${label} delivery-claim count`);
  assertLiteral(value.providerFetchCount, 0, `${label} provider-fetch count`);
  assertLiteral(value.providerSendCount, 0, `${label} provider-send count`);
};

const validateManagerAgingKillSwitchCounts = (value, label) => {
  assertExactKeys(value, [
    'disabled',
    'fetchCallCount',
    'claimCallCount',
    'reservationCallCount',
    'sendCallCount',
  ], label);
  assertLiteral(value.disabled, true, `${label} disabled flag`);
  assertLiteral(value.fetchCallCount, 0, `${label} fetch-call count`);
  assertLiteral(value.claimCallCount, 0, `${label} claim-call count`);
  assertLiteral(value.reservationCallCount, 0, `${label} reservation-call count`);
  assertLiteral(value.sendCallCount, 0, `${label} send-call count`);
};

const validateKillSwitches = (payload) => {
  assertExactKeys(payload, [
    'schemaVersion',
    'evidenceType',
    'evidenceMode',
    'passed',
    'executableCoverage',
    'switches',
    'intakeAvailable',
    'portalAvailable',
  ], 'Kill-switch evidence');
  assertLiteral(payload.schemaVersion, 2, 'Kill-switch schemaVersion');
  assertLiteral(payload.evidenceType, 'kill_switches', 'Kill-switch evidenceType');
  assertLiteral(
    payload.evidenceMode,
    'synthetic_executable_integration',
    'Kill-switch evidenceMode'
  );
  assertLiteral(payload.passed, true, 'Kill-switch passed flag');
  assertExactKeys(payload.executableCoverage, [
    'gmailOutbound',
    'customerContact',
    'managerAging',
    'intakeAvailability',
    'portalAvailability',
  ], 'Kill-switch executable coverage');
  for (const [name, covered] of Object.entries(payload.executableCoverage)) {
    assertLiteral(covered, true, `Kill-switch ${name} executable coverage`);
  }
  assertExactKeys(payload.switches, [
    'gmailOutbound',
    'customerContact',
    'managerAging',
  ], 'Kill-switch count groups');
  validateGmailOutboundKillSwitchCounts(
    payload.switches.gmailOutbound,
    'Gmail outbound kill switch'
  );
  validateCustomerContactKillSwitchCounts(
    payload.switches.customerContact,
    'Customer-contact kill switch'
  );
  validateManagerAgingKillSwitchCounts(
    payload.switches.managerAging,
    'Manager-aging kill switch'
  );
  assertLiteral(payload.intakeAvailable, true, 'Kill-switch intake availability');
  assertLiteral(payload.portalAvailable, true, 'Kill-switch portal availability');
};

const validateProviderOutcomes = (payload) => {
  assertExactKeys(payload, [
    'schemaVersion',
    'evidenceType',
    'evidenceMode',
    'passed',
    'successCount',
    'rejectionCount',
    'timeoutCount',
    'unknownCount',
    'totalProviderAttempts',
    'replayProviderAttempts',
    'caseReportingCompletionCount',
    'originalThreadCompletionCount',
    'fallbackNoticeCount',
    'managerCompletionNoticeCount',
  ], 'Provider-outcome evidence');
  assertLiteral(payload.schemaVersion, 1, 'Provider-outcome schemaVersion');
  assertLiteral(payload.evidenceType, 'provider_outcomes', 'Provider-outcome evidenceType');
  assertLiteral(
    payload.evidenceMode,
    'local_injected_provider_adapter',
    'Provider-outcome evidenceMode'
  );
  assertLiteral(payload.passed, true, 'Provider-outcome passed flag');
  assertLiteral(payload.successCount, 1, 'Provider success count');
  assertLiteral(payload.rejectionCount, 1, 'Provider rejection count');
  assertLiteral(payload.timeoutCount, 1, 'Provider timeout count');
  assertLiteral(payload.unknownCount, 1, 'Provider unknown count');
  assertLiteral(payload.totalProviderAttempts, 4, 'Provider total-attempt count');
  assertLiteral(payload.replayProviderAttempts, 0, 'Provider replay-attempt count');
  assertLiteral(
    payload.caseReportingCompletionCount,
    1,
    'Provider case/reporting completion count'
  );
  assertLiteral(
    payload.originalThreadCompletionCount,
    1,
    'Provider original-thread completion count'
  );
  assertLiteral(payload.fallbackNoticeCount, 0, 'Provider fallback-notice count');
  assertLiteral(
    payload.managerCompletionNoticeCount,
    0,
    'Provider manager-completion notice count'
  );
};

const machineArtifactValidators = new Map([
  ['refund-portal-assertions.json', validatePortalAssertions],
  ['refund-database-counts.json', validateDatabaseCounts],
  ['refund-gmail-mime-roles.json', validateMimeRoles],
  ['refund-kill-switches.json', validateKillSwitches],
  ['refund-provider-outcomes.json', validateProviderOutcomes],
]);

export function validateMachineReadableEvidence(name, payload) {
  const validate = machineArtifactValidators.get(name);
  if (!validate) throw new Error(`Unsupported machine-readable evidence artifact: ${name}`);
  validate(payload);
  const serialized = JSON.stringify(payload);
  if (
    serialized.includes('@') ||
    /\b(?:https?:\/\/|[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})\b/i.test(serialized) ||
    /\b\d{12,19}\b/.test(serialized)
  ) {
    throw new Error(`${name} contains identity, provider, or payment-like data.`);
  }
  return payload.evidenceType;
}

export function parseArgs(argv) {
  const args = {
    artifactDir: 'output/refund-uat-evidence',
    output: '',
    sourceCommit: process.env.GITHUB_SHA || 'local',
    freshAfter: process.env.REFUND_UAT_EVIDENCE_STARTED_AT || null,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === '--help' || arg === '-h') {
      args.help = true;
      continue;
    }

    if (arg === '--artifact-dir' && next) {
      args.artifactDir = next;
      index += 1;
      continue;
    }

    if (arg === '--output' && next) {
      args.output = next;
      index += 1;
      continue;
    }

    if (arg === '--source-commit' && next) {
      args.sourceCommit = next.trim();
      index += 1;
      continue;
    }

    if (arg === '--fresh-after' && next) {
      args.freshAfter = next.trim();
      index += 1;
      continue;
    }

    throw new Error(`Unknown or incomplete argument: ${arg}`);
  }

  args.artifactDir = path.resolve(process.cwd(), args.artifactDir);
  args.output = path.resolve(
    process.cwd(),
    args.output || path.join(args.artifactDir, 'refund-uat-evidence.json')
  );
  return args;
}

function printHelp() {
  console.log(`Build sanitized Refund Operations UAT evidence

Usage:
  npm run refunds:build-uat-evidence -- --artifact-dir output/refund-uat-evidence --source-commit <sha> --fresh-after <ISO timestamp>

The input directory must contain every expected synthetic screenshot and all
five strict machine-readable evidence files. The output manifest contains only
filenames, evidence types, sizes, SHA-256 digests, and no customer data.`);
}

export async function buildEvidence({
  artifactDir,
  output,
  sourceCommit,
  freshAfter = null,
  generatedAt = new Date().toISOString(),
}) {
  if (!/^(?:[a-f0-9]{7,40}|local|working-tree)$/.test(sourceCommit)) {
    throw new Error('Source commit must be a Git SHA or the explicit local/working-tree marker.');
  }
  const freshAfterMs = freshAfter === null ? null : Date.parse(freshAfter);
  if (freshAfter !== null && !Number.isFinite(freshAfterMs)) {
    throw new Error('Evidence freshness boundary must be a valid ISO timestamp.');
  }

  const directoryEntries = await readdir(artifactDir, { withFileTypes: true });
  const availableFiles = new Set(
    directoryEntries.filter((entry) => entry.isFile()).map((entry) => entry.name)
  );
  const missingScreenshots = EXPECTED_SCREENSHOTS.filter((name) => !availableFiles.has(name));
  const missingMachineArtifacts = EXPECTED_MACHINE_READABLE_ARTIFACTS.filter(
    (name) => !availableFiles.has(name)
  );
  const unexpectedPngs = [...availableFiles].filter(
    (name) => name.toLowerCase().endsWith('.png') && !EXPECTED_SCREENSHOTS.includes(name)
  );

  if (missingScreenshots.length > 0) {
    throw new Error(`Missing expected synthetic UAT screenshots: ${missingScreenshots.join(', ')}`);
  }
  if (missingMachineArtifacts.length > 0) {
    throw new Error(`Missing expected machine-readable UAT evidence: ${missingMachineArtifacts.join(', ')}`);
  }
  if (unexpectedPngs.length > 0) {
    throw new Error(`Unreviewed UAT screenshots are not included in the manifest: ${unexpectedPngs.join(', ')}`);
  }

  const outputIsInArtifactDirectory = path.dirname(output) === artifactDir;
  const allowedFiles = new Set([
    ...EXPECTED_SCREENSHOTS,
    ...EXPECTED_MACHINE_READABLE_ARTIFACTS,
    ...(outputIsInArtifactDirectory ? [path.basename(output)] : []),
  ]);
  const unexpectedEntries = directoryEntries
    .filter((entry) => !entry.isFile() || !allowedFiles.has(entry.name))
    .map((entry) => entry.name);
  if (unexpectedEntries.length > 0) {
    throw new Error(`Unreviewed UAT artifacts are not included in the manifest: ${unexpectedEntries.join(', ')}`);
  }

  if (freshAfterMs !== null) {
    const staleFiles = [];
    for (const name of [...EXPECTED_SCREENSHOTS, ...EXPECTED_MACHINE_READABLE_ARTIFACTS]) {
      const fileStat = await stat(path.join(artifactDir, name));
      if (fileStat.mtimeMs < freshAfterMs) staleFiles.push(name);
    }
    if (staleFiles.length > 0) {
      throw new Error(`UAT artifacts were not freshly generated in this run: ${staleFiles.join(', ')}`);
    }
  }

  const screenshots = [];
  const screenshotPixelDigests = new Set();
  for (const name of EXPECTED_SCREENSHOTS) {
    const contents = await readFile(path.join(artifactDir, name));
    const { pixelSha256 } = validateSyntheticScreenshotPng(contents, name);
    const sha256 = createHash('sha256').update(contents).digest('hex');
    if (screenshotPixelDigests.has(pixelSha256)) {
      throw new Error(
        `Synthetic UAT screenshots must have distinct decoded pixels; duplicate content found at ${name}.`
      );
    }
    screenshotPixelDigests.add(pixelSha256);
    screenshots.push({
      name,
      bytes: contents.length,
      sha256,
    });
  }

  const machineReadableArtifacts = [];
  for (const name of EXPECTED_MACHINE_READABLE_ARTIFACTS) {
    const contents = await readFile(path.join(artifactDir, name));
    if (contents.length === 0 || contents.length > MAX_MACHINE_ARTIFACT_BYTES) {
      throw new Error(`${name} must be a nonempty bounded JSON artifact.`);
    }
    let payload;
    try {
      payload = JSON.parse(contents.toString('utf8'));
    } catch {
      throw new Error(`${name} must contain valid JSON.`);
    }
    const evidenceType = validateMachineReadableEvidence(name, payload);
    const canonical = `${JSON.stringify(payload, null, 2)}\n`;
    if (contents.toString('utf8') !== canonical) {
      throw new Error(`${name} must use canonical pretty-printed JSON with one trailing newline.`);
    }
    machineReadableArtifacts.push({
      name,
      evidenceType,
      schemaVersion: payload.schemaVersion,
      bytes: contents.length,
      sha256: createHash('sha256').update(contents).digest('hex'),
    });
  }

  const manifest = {
    schemaVersion: 2,
    generatedAt,
    evidenceRunStartedAt: freshAfter,
    sourceCommit,
    evidenceMode: 'synthetic_and_disposable_local_only',
    containsProductionData: false,
    screenshotCount: screenshots.length,
    screenshots,
    machineReadableArtifactCount: machineReadableArtifacts.length,
    machineReadableArtifacts,
  };

  await writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return manifest;
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const manifest = await buildEvidence(args);
  console.log('Refund UAT evidence manifest built.');
  console.log(`- Synthetic screenshots: ${manifest.screenshotCount}`);
  console.log(`- Machine-readable artifacts: ${manifest.machineReadableArtifactCount}`);
  console.log(`- Contains production data: ${manifest.containsProductionData ? 'yes' : 'no'}`);
  console.log(`- Source commit: ${manifest.sourceCommit}`);
  console.log(`- Manifest: ${args.output}`);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === __filename;
if (isMain) {
  run().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`ERROR: ${message}`);
    process.exit(1);
  });
}
