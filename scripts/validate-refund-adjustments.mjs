#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  buildSanitizedRefundPayload,
  buildMachineProfiles,
  buildGlobalUniqueRefundScopeLabelMap,
  calculatePartnerSettlementTotals,
  countPartnerScopedRefundReviewRows,
  extractRefundInput,
  makeSourceRowHash,
  matchRefundToMachine,
  parseCsv,
  parseSheetValues,
  refundReviewRowAppliesToPartnerScope,
} from './refunds/refund-adjustment-utils.mjs';

const machines = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    location_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    machine_label: 'Lobby North',
    location_name: 'North Lobby',
    external_machine_id: 'MACH-NORTH',
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    location_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    machine_label: 'Main Desk',
    location_name: 'Main Desk',
    external_machine_id: 'MACH-DESK',
  },
  {
    id: '33333333-3333-4333-8333-333333333333',
    location_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    machine_label: 'Main Desk Annex',
    location_name: 'Annex Desk',
    external_machine_id: 'MACH-ANNEX',
  },
  {
    id: '44444444-4444-4444-8444-444444444444',
    location_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    machine_label: 'Warehouse',
    location_name: 'Warehouse',
    external_machine_id: 'MACH-WH',
  },
];

const aliases = [
  {
    reporting_machine_id: machines[0].id,
    alias: 'North entrance kiosk',
  },
  {
    reporting_machine_id: machines[1].id,
    alias: 'Desk',
  },
  {
    reporting_machine_id: machines[2].id,
    alias: 'Desk',
  },
];

const profiles = buildMachineProfiles({ machines, aliases });
const partnershipId = '55555555-5555-4555-8555-555555555555';
const otherPartnershipId = '66666666-6666-4666-8666-666666666666';
const assignments = [
  {
    partnership_id: partnershipId,
    machine_id: machines[0].id,
    assignment_role: 'primary_reporting',
    status: 'active',
    effective_start_date: '2026-04-01',
    effective_end_date: null,
  },
  {
    partnership_id: partnershipId,
    machine_id: machines[1].id,
    assignment_role: 'primary_reporting',
    status: 'active',
    effective_start_date: '2026-04-01',
    effective_end_date: null,
  },
  {
    partnership_id: otherPartnershipId,
    machine_id: machines[3].id,
    assignment_role: 'primary_reporting',
    status: 'active',
    effective_start_date: '2026-04-01',
    effective_end_date: null,
  },
];
const uniqueRefundScopeLabels = buildGlobalUniqueRefundScopeLabelMap({ machines, aliases });

const matchRow = (row) => {
  const input = extractRefundInput(row, 'fixture-row');
  return matchRefundToMachine(input, profiles);
};

const exactMatch = matchRow({
  location: 'North Lobby',
  refund_date: '2026-04-06',
  refund_amount_usd: '12.50',
  status: 'Closed',
  decision: 'Approve',
});
assert.equal(exactMatch.matchStatus, 'matched');
assert.equal(exactMatch.matchConfidence, 1);
assert.equal(exactMatch.matchedMachine?.id, machines[0].id);

const fuzzyMatch = matchRow({
  location: 'North entrance kiosk - manual refund',
  refund_date: '2026-04-07',
  refund_amount_usd: '6.00',
  status: 'Closed',
  decision: 'Approve',
});
assert.equal(fuzzyMatch.matchStatus, 'matched');
assert.equal(fuzzyMatch.matchReason, 'single_alias_containment_match');
assert.equal(fuzzyMatch.matchedMachine?.id, machines[0].id);

const ambiguousMatch = matchRow({
  location: 'Desk',
  refund_date: '2026-04-08',
  refund_amount_usd: '4.00',
  status: 'Closed',
  decision: 'Approve',
});
assert.equal(ambiguousMatch.matchStatus, 'ambiguous');
assert.deepEqual(
  [...ambiguousMatch.candidateMachineIds].sort(),
  [machines[1].id, machines[2].id].sort()
);

const unmatched = matchRow({
  location: 'Unknown venue',
  refund_date: '2026-04-09',
  refund_amount_usd: '3.00',
  status: 'Closed',
  decision: 'Approve',
});
assert.equal(unmatched.matchStatus, 'unmatched');

const statusReview = matchRow({
  location: 'Warehouse',
  refund_date: '2026-04-10',
  refund_amount_usd: '3.00',
  status: '',
});
assert.equal(statusReview.matchStatus, 'needs_review');
assert.equal(statusReview.matchReason, 'missing_source_status');

const currentFormContractInput = extractRefundInput(
  {
    location_of_purchase: 'North Lobby',
    decision_date: '2026-04-11',
    date_and_time_of_incident: '2026-04-10 10:30 AM',
    refund_amount: '7.25',
    status: 'Closed',
    decision: 'Approve',
    request_id: 'SANITIZED-REQ-1',
    incident_description: 'Sanitized fixture reason',
  },
  'current-form-contract-fixture'
);
assert.equal(currentFormContractInput.sourceRowReference, 'SANITIZED-REQ-1');
assert.equal(currentFormContractInput.refundDate, '2026-04-11');
assert.equal(currentFormContractInput.originalOrderDate, '2026-04-10');
assert.equal(currentFormContractInput.amountCents, 725);
const currentFormContractMatch = matchRefundToMachine(currentFormContractInput, profiles);
assert.equal(currentFormContractMatch.matchStatus, 'matched');
assert.equal(currentFormContractMatch.matchedMachine?.id, machines[0].id);

const approvedRequestAmountFallbackInput = extractRefundInput(
  {
    location_of_purchase: 'North Lobby',
    decision_date: '2026-04-11',
    request_amount: '9.75',
    refund_amount: '',
    status: 'Closed',
    decision: 'Approve',
    request_id: 'SANITIZED-REQ-FALLBACK',
  },
  'approved-request-amount-fallback'
);
assert.equal(approvedRequestAmountFallbackInput.amountCents, 975);
assert.equal(approvedRequestAmountFallbackInput.amountSource, 'request_amount');
const approvedRequestAmountFallbackMatch = matchRefundToMachine(
  approvedRequestAmountFallbackInput,
  profiles
);
assert.equal(approvedRequestAmountFallbackMatch.matchStatus, 'matched');

const openRequestAmountFallbackInput = extractRefundInput(
  {
    location_of_purchase: 'North Lobby',
    decision_date: '2026-04-11',
    request_amount: '9.75',
    refund_amount: '',
    status: 'Open',
    decision: 'Approve',
  },
  'open-request-amount-fallback'
);
assert.equal(openRequestAmountFallbackInput.amountCents, 0);
const openRequestAmountFallbackMatch = matchRefundToMachine(openRequestAmountFallbackInput, profiles);
assert.equal(openRequestAmountFallbackMatch.matchStatus, 'invalid');

const openFormContractMatch = matchRow({
  location_of_purchase: 'North Lobby',
  decision_date: '2026-04-11',
  refund_amount: '7.25',
  status: 'Open',
  decision: 'Approve',
});
assert.equal(openFormContractMatch.matchStatus, 'needs_review');
assert.equal(openFormContractMatch.matchReason, 'source_status_requires_review');

const deniedFormContractMatch = matchRow({
  location_of_purchase: 'North Lobby',
  decision_date: '2026-04-11',
  refund_amount: '7.25',
  status: 'Closed',
  decision: 'Deny',
});
assert.equal(deniedFormContractMatch.matchStatus, 'needs_review');
assert.equal(deniedFormContractMatch.matchReason, 'source_decision_requires_review');

const missingDecisionFormContractMatch = matchRow({
  location_of_purchase: 'North Lobby',
  decision_date: '2026-04-11',
  refund_amount: '7.25',
  status: 'Closed',
  decision: '',
});
assert.equal(missingDecisionFormContractMatch.matchStatus, 'needs_review');
assert.equal(missingDecisionFormContractMatch.matchReason, 'missing_source_decision');

const invalidFormContractMatch = matchRow({
  location_of_purchase: '',
  decision_date: '',
  refund_amount: '',
  status: 'Closed',
  decision: 'Approve',
});
assert.equal(invalidFormContractMatch.matchStatus, 'invalid');
assert.equal(invalidFormContractMatch.matchReason, 'missing_required_refund_fields');

const duplicateInput = extractRefundInput(
  {
    location: 'North Lobby',
    refund_date: '2026-04-06',
    refund_amount_usd: '12.50',
    status: 'Closed',
    decision: 'Approve',
    request_id: 'SANITIZED-DUPLICATE-REQ',
  },
  'duplicate-fixture'
);
const seenHashes = new Set();
const firstHash = makeSourceRowHash(duplicateInput);
const duplicateHash = makeSourceRowHash(duplicateInput);
assert.equal(seenHashes.has(firstHash), false);
seenHashes.add(firstHash);
assert.equal(seenHashes.has(duplicateHash), true);

const sameContentDifferentRequestInput = extractRefundInput(
  {
    location: 'North Lobby',
    refund_date: '2026-04-06',
    refund_amount_usd: '12.50',
    status: 'Closed',
    decision: 'Approve',
    request_id: 'SANITIZED-DIFFERENT-REQ',
  },
  'different-request-fixture'
);
assert.notEqual(firstHash, makeSourceRowHash(sameContentDifferentRequestInput));

const parsed = parseCsv(
  'Location,Refund Date,Refund Amount USD,Status,Decision\nNorth Lobby,2026-04-06,12.50,Closed,Approve\n'
);
assert.equal(parsed.length, 1);
assert.equal(parsed[0].row.refund_amount_usd, '12.50');

const sheetRows = parseSheetValues([
  [
    'Timestamp',
    'Your Name',
    'Email Address',
    'Location of Purchase',
    'Date and Time of Incident',
    'Incident Description',
    'Venmo/Zelle Payment ID',
    'Last 4 digits of your card',
    'Request ID',
    'Status',
    'Request Amount',
    'Refund Amount',
    'Decision',
    'Decision Date',
  ],
  [
    '2026-04-11 09:00:00',
    'Customer Name',
    'customer@example.com',
    'North Lobby',
    '2026-04-10 10:30 AM',
    'Private fixture detail',
    'private-payment-id',
    '1234',
    'SANITIZED-REQ-2',
    'Closed',
    '8.50',
    '8.50',
    'Approve',
    '2026-04-11',
  ],
]);
assert.equal(sheetRows.length, 1);
assert.equal(sheetRows[0].row.location_of_purchase, 'North Lobby');
assert.equal(sheetRows[0].row.source_sheet_row_number, '2');

const sheetInput = extractRefundInput(sheetRows[0].row, 'sheet-row-2');
const sheetMatch = matchRefundToMachine(sheetInput, profiles);
assert.equal(sheetMatch.matchStatus, 'matched');
const sanitizedPayload = buildSanitizedRefundPayload({
  input: sheetInput,
  sourceReference: 'sanitized-source',
  sourceRowHash: makeSourceRowHash(sheetInput),
  sourceRowNumber: sheetRows[0].row.source_sheet_row_number,
  match: sheetMatch,
});
assert.equal(sanitizedPayload.source_row_reference, 'SANITIZED-REQ-2');
assert.equal(sanitizedPayload.source_location, 'North Lobby');
assert.equal(sanitizedPayload.amount_cents, 850);
assert.equal(sanitizedPayload.amount_source, 'refund_amount');
assert.equal(Object.prototype.hasOwnProperty.call(sanitizedPayload, 'email_address'), false);
assert.equal(Object.prototype.hasOwnProperty.call(sanitizedPayload, 'venmo_zelle_payment_id'), false);
assert.equal(Object.prototype.hasOwnProperty.call(sanitizedPayload, 'last_4_digits_of_your_card'), false);
assert.equal(Object.prototype.hasOwnProperty.call(sanitizedPayload, 'incident_description'), false);
const sanitizedPayloadText = JSON.stringify(sanitizedPayload);
for (const privateValue of [
  'Customer Name',
  'customer@example.com',
  'private-payment-id',
  '1234',
  'Private fixture detail',
]) {
  assert.equal(sanitizedPayloadText.includes(privateValue), false);
}

const scopeArgs = {
  partnershipId,
  dateFrom: '2026-04-01',
  dateTo: '2026-04-30',
  assignments,
  uniqueLabelMap: uniqueRefundScopeLabels,
};
const matchedMachineReviewWarns = refundReviewRowAppliesToPartnerScope({
  ...scopeArgs,
  row: {
    refund_date: '2026-04-12',
    resolution_status: 'unresolved',
    match_status: 'matched',
    matched_machine_id: machines[0].id,
    source_location: 'North Lobby',
  },
});
assert.equal(matchedMachineReviewWarns, true);

const singleCandidateReviewWarns = refundReviewRowAppliesToPartnerScope({
  ...scopeArgs,
  row: {
    refund_date: '2026-04-12',
    resolution_status: 'unresolved',
    match_status: 'ambiguous',
    candidate_machine_ids: [machines[1].id],
    source_location: 'Manual desk correction',
  },
});
assert.equal(singleCandidateReviewWarns, true);

const exactUniqueAliasReviewWarns = refundReviewRowAppliesToPartnerScope({
  ...scopeArgs,
  row: {
    refund_date: '2026-04-12',
    resolution_status: 'unresolved',
    match_status: 'unmatched',
    source_location: 'North entrance kiosk',
  },
});
assert.equal(exactUniqueAliasReviewWarns, true);

const otherPartnerMachineDoesNotWarn = refundReviewRowAppliesToPartnerScope({
  ...scopeArgs,
  row: {
    refund_date: '2026-04-12',
    resolution_status: 'unresolved',
    match_status: 'needs_review',
    matched_machine_id: machines[3].id,
    source_location: 'Warehouse',
  },
});
assert.equal(otherPartnerMachineDoesNotWarn, false);

const outOfScopePhoneCaseDoesNotWarn = refundReviewRowAppliesToPartnerScope({
  ...scopeArgs,
  row: {
    refund_date: '2026-04-12',
    resolution_status: 'unresolved',
    match_status: 'unmatched',
    source_location: 'Phone Case Kiosk',
  },
});
assert.equal(outOfScopePhoneCaseDoesNotWarn, false);

const ambiguousLabelDoesNotWarn = refundReviewRowAppliesToPartnerScope({
  ...scopeArgs,
  row: {
    refund_date: '2026-04-12',
    resolution_status: 'unresolved',
    match_status: 'unmatched',
    source_location: 'Desk',
  },
});
assert.equal(ambiguousLabelDoesNotWarn, false);

assert.equal(
  countPartnerScopedRefundReviewRows({
    rows: [
      {
        refund_date: '2026-04-12',
        resolution_status: 'unresolved',
        match_status: 'needs_review',
        matched_machine_id: machines[0].id,
      },
      {
        refund_date: '2026-04-12',
        resolution_status: 'unresolved',
        match_status: 'unmatched',
        source_location: 'Phone Case Kiosk',
      },
      {
        refund_date: '2026-04-12',
        resolution_status: 'approved',
        match_status: 'applied',
        matched_machine_id: machines[0].id,
      },
    ],
    partnershipId,
    dateFrom: '2026-04-01',
    dateTo: '2026-04-30',
    assignments,
    machines,
    aliases,
  }),
  1
);

const withoutRefund = calculatePartnerSettlementTotals({
  grossSalesCents: 10000,
  taxCents: 800,
  feeCents: 500,
  costCents: 1000,
  refundAmountCents: 0,
  splitBase: 'net_sales',
  partnerShareBasisPoints: 5000,
});
const withRefund = calculatePartnerSettlementTotals({
  grossSalesCents: 10000,
  taxCents: 800,
  feeCents: 500,
  costCents: 1000,
  refundAmountCents: 2000,
  splitBase: 'net_sales',
  partnerShareBasisPoints: 5000,
});
assert.equal(withoutRefund.netSalesCents, 8700);
assert.equal(withRefund.refundAmountCents, 2000);
assert.equal(withRefund.netSalesCents, 6700);
assert.equal(withRefund.splitBaseCents, 6700);
assert.equal(withoutRefund.amountOwedCents - withRefund.amountOwedCents, 1000);

const grossSplit = calculatePartnerSettlementTotals({
  grossSalesCents: 10000,
  refundAmountCents: 2000,
  splitBase: 'gross_sales',
  partnerShareBasisPoints: 5000,
});
assert.equal(grossSplit.splitBaseCents, 8000);
assert.equal(grossSplit.amountOwedCents, 4000);

console.log(
  JSON.stringify({
    status: 'ok',
    fixtures: {
      exactLocationMatch: exactMatch.matchStatus,
      fuzzyAliasMatch: fuzzyMatch.matchStatus,
      ambiguousMatch: ambiguousMatch.matchStatus,
      unmatchedRefund: unmatched.matchStatus,
      currentFormContract: currentFormContractMatch.matchStatus,
      approvedRequestAmountFallback: approvedRequestAmountFallbackMatch.matchStatus,
      openRequestAmountFallback: openRequestAmountFallbackMatch.matchStatus,
      openStatusReviewOnly: openFormContractMatch.matchStatus,
      deniedDecisionReviewOnly: deniedFormContractMatch.matchStatus,
      missingDecisionReviewOnly: missingDecisionFormContractMatch.matchStatus,
      invalidRefundRow: invalidFormContractMatch.matchStatus,
      duplicateHashDetected: true,
      sameContentDifferentRequestNotDuplicate: true,
      liveSheetValuesParsed: true,
      sanitizedPayloadExcludesPrivateFields: true,
      partnerScopedMatchedMachineReview: matchedMachineReviewWarns,
      partnerScopedSingleCandidateReview: singleCandidateReviewWarns,
      partnerScopedExactAliasReview: exactUniqueAliasReviewWarns,
      partnerScopedOtherPartnerSuppressed: !otherPartnerMachineDoesNotWarn,
      partnerScopedOutOfScopeSuppressed: !outOfScopePhoneCaseDoesNotWarn,
      partnerScopedAmbiguousLabelSuppressed: !ambiguousLabelDoesNotWarn,
      refundReducesPartnerSettlement: true,
    },
  })
);
