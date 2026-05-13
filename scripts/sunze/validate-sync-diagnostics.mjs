#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  buildFailureDiagnostic,
  buildSanitizedFailureError,
  isRetryableProviderExportError,
  sanitizeDiagnosticMessage,
  sanitizeUiSummaryForDiagnostic,
  summarizeRowsByDateForLog,
} from './sync-diagnostics.mjs';

const rawFailure =
  'Provider export mismatch for ethan@example.com. Task No.: ABCD1234EFGH5678. Machine 17525706476037914545569 returned raw order 987654321 and token abcdef1234567890abcdef.';

const sanitizedMessage = sanitizeDiagnosticMessage(rawFailure);
assert.equal(
  sanitizedMessage,
  'Provider export mismatch for [email]. Task No.:[id]. Machine [id] returned raw order [number] and token [id].'
);

const uiSummary = sanitizeUiSummaryForDiagnostic({
  uiWindowStart: '2026-05-06',
  uiWindowEnd: '2026-05-12',
  uiWindowSource: 'preset',
  selectedPreset: 'Last 7 Days',
  uiRecordCount: 1422,
  uiRecordCountTrusted: false,
  uiRecordCountSource: 'weak_page_text',
  uiRecordCountSourceText: 'Total 1422 orders',
  uiRecordCountCandidates: [1422],
  uiRevenueCents: 9700,
  uiRevenueCandidatesCents: [800, 9700],
  uiRevenueTrusted: false,
  uiRevenueSource: 'weak_page_text',
});

assert.deepEqual(uiSummary, {
  uiWindowStart: '2026-05-06',
  uiWindowEnd: '2026-05-12',
  uiWindowSource: 'preset',
  selectedPreset: 'Last 7 Days',
  uiRecordCount: 1422,
  uiRecordCountTrusted: false,
  uiRecordCountSource: 'weak_page_text',
  uiRecordCountCandidates: [1422],
  uiRevenueCents: 9700,
  uiRevenueCandidatesCents: [800, 9700],
  uiRevenueTrusted: false,
  uiRevenueSource: 'weak_page_text',
});

const diagnostic = buildFailureDiagnostic({
  generatedAt: '2026-05-12T23:30:00.000Z',
  error: new Error(rawFailure),
  diagnostic: {
    worker: 'scripts/sunze/sync-orders.mjs',
    githubRunId: '25767486019',
    datePreset: 'Last 7 Days',
    uiSummary,
    machineCoverage: {
      visibleSourceMachineCount: 0,
      verified: false,
      issue: 'missing_visible_machine_codes',
    },
  },
});

assert.deepEqual(diagnostic, {
  worker: 'scripts/sunze/sync-orders.mjs',
  githubRunId: '25767486019',
  datePreset: 'Last 7 Days',
  uiSummary,
  machineCoverage: {
    visibleSourceMachineCount: 0,
    verified: false,
    issue: 'missing_visible_machine_codes',
  },
  ok: false,
  generatedAt: '2026-05-12T23:30:00.000Z',
  failure: {
    name: 'Error',
    message:
      'Provider export mismatch for [email]. Task No.:[id]. Machine [id] returned raw order [number] and token [id].',
  },
});

const serialized = JSON.stringify(diagnostic);
assert.equal(serialized.includes('ethan@example.com'), false);
assert.equal(serialized.includes('17525706476037914545569'), false);
assert.equal(serialized.includes('987654321'), false);
assert.equal(serialized.includes('abcdef1234567890abcdef'), false);

const rawError = new Error(rawFailure);
rawError.details = {
  email: 'ethan@example.com',
  machineCode: '17525706476037914545569',
  rawOrderNumber: '987654321',
};
const safeError = buildSanitizedFailureError(rawError);
assert.equal(safeError.name, 'Error');
assert.equal(safeError.message, sanitizedMessage);
assert.equal('details' in safeError, false);
assert.equal(String(safeError).includes('17525706476037914545569'), false);
assert.equal(JSON.stringify(safeError).includes('17525706476037914545569'), false);

const rowsByDate = summarizeRowsByDateForLog(
  [
    { saleDate: '2026-05-12', machineCode: '17525706476037914545569' },
    { saleDate: '2026-05-12', machineCode: '17525706476037914545569' },
    { saleDate: '2026-05-12', machineCode: 'abcdef1234567890abcdef' },
    { saleDate: '2026-05-13', machineCode: 'untracked-machine-code' },
  ],
  ['17525706476037914545569', 'abcdef1234567890abcdef']
);
assert.deepEqual(rowsByDate, [
  {
    date: '2026-05-12',
    rowCount: 3,
    machineCounts: {
      summaryMachine1: 2,
      summaryMachine2: 1,
    },
  },
  {
    date: '2026-05-13',
    rowCount: 1,
    machineCounts: {
      summaryMachine1: 0,
      summaryMachine2: 0,
    },
  },
]);
const rowsByDateSerialized = JSON.stringify(rowsByDate);
assert.equal(rowsByDateSerialized.includes('17525706476037914545569'), false);
assert.equal(rowsByDateSerialized.includes('abcdef1234567890abcdef'), false);

assert.equal(
  isRetryableProviderExportError(
    new Error(
      'Provider export task did not complete within 300000ms after 54 poll(s); requestedAt 2026-05-13T16:04:59.000Z; pinnedTask none.'
    )
  ),
  true
);
assert.equal(
  isRetryableProviderExportError(new Error('Provider export task download did not start within 120000ms.')),
  true
);
assert.equal(isRetryableProviderExportError(new Error('Missing required environment variable: REPORTING_INGEST_URL')), false);

console.log(
  JSON.stringify(
    {
      ok: true,
      cases: [
        'failure message redaction',
        'ui summary allowlist',
        'sanitized rethrow',
        'summary machine log redaction',
        'export task timeout retry classification',
      ],
    },
    null,
    2
  )
);
