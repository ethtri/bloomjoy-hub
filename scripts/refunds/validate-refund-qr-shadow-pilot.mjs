#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildNayaxRecommendation } from '../../supabase/functions/_shared/nayax-recommendation.mjs';
import {
  aggregatePilotEvidence,
  parsePilotArgs,
  validateCohort,
  validateObservations,
} from './refund-qr-shadow-pilot-report.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const source = fs.readFileSync(path.join(__dirname, 'refund-qr-shadow-pilot-report.mjs'), 'utf8');
const incidentAt = '2026-07-26T19:00:00.000Z';
const machineId = 'machine-101';

const sale = ({
  id,
  at = incidentAt,
  amount = 7,
  last4 = '4242',
  recognitionMethod = 'Chip',
}) => ({
  TransactionID: id,
  MachineID: machineId,
  SiteID: 501,
  AuthorizationDateTimeGMT: at,
  AuthorizationValue: amount,
  CurrencyCode: 'USD',
  CardNumber: last4 ? `************${last4}` : '',
  PaymentStatus: 'Approved',
  RecognitionMethod: recognitionMethod,
});

const recommend = (payload, overrides = {}) =>
  buildNayaxRecommendation({
    payload,
    incidentAt,
    incidentTimeResolution: 'exact',
    expectedMachineId: machineId,
    locationTimezone: 'America/Los_Angeles',
    requestAmountCents: 700,
    requestCardLast4: '4242',
    cardWalletUsed: false,
    ...overrides,
  });

const fixtures = [
  {
    name: 'ordinary physical card',
    expectedId: 'ordinary',
    result: recommend([sale({ id: 'ordinary' })]),
    expectedState: 'high_confidence',
    expectedClass: 'strong_card',
  },
  {
    name: 'wallet virtual-last-four mismatch with unique QR/time',
    expectedId: 'wallet',
    result: recommend(
      [sale({ id: 'wallet', at: '2026-07-26T19:03:00.000Z', last4: '9999', recognitionMethod: 'Apple Pay' })],
      {
        cardWalletUsed: true,
        qrClaimOpenedAt: '2026-07-26T19:08:00.000Z',
        qrClaimEvidenceStatus: 'verified',
      },
    ),
    expectedState: 'high_confidence',
    expectedClass: 'unique_qr_time',
  },
  {
    name: 'single contactless transaction with unique QR/time',
    expectedId: 'unique-qr',
    result: recommend(
      [sale({ id: 'unique-qr', at: '2026-07-26T19:04:00.000Z', last4: '9999', recognitionMethod: 'Contactless' })],
      {
        qrClaimOpenedAt: '2026-07-26T19:09:00.000Z',
        qrClaimEvidenceStatus: 'verified',
      },
    ),
    expectedState: 'high_confidence',
    expectedClass: 'unique_qr_time',
  },
  {
    name: 'two same-amount transactions close together',
    expectedId: null,
    result: recommend(
      [
        sale({ id: 'close-a', at: '2026-07-26T19:03:00.000Z', last4: '9999', recognitionMethod: 'Apple Pay' }),
        sale({ id: 'close-b', at: '2026-07-26T19:05:00.000Z', last4: '8888', recognitionMethod: 'Apple Pay' }),
      ],
      {
        cardWalletUsed: true,
        qrClaimOpenedAt: '2026-07-26T19:08:00.000Z',
        qrClaimEvidenceStatus: 'verified',
      },
    ),
    expectedState: 'ambiguous',
    expectedClass: 'ambiguous_manual',
  },
  {
    name: 'wrong amount',
    expectedId: null,
    result: recommend(
      [sale({ id: 'wrong-amount', amount: 9 })],
      {
        qrClaimOpenedAt: '2026-07-26T19:05:00.000Z',
        qrClaimEvidenceStatus: 'verified',
      },
    ),
    expectedState: 'manual_exception',
    expectedClass: 'ambiguous_manual',
  },
  {
    name: 'late QR scan',
    expectedId: null,
    result: recommend(
      [sale({ id: 'late', last4: '9999', recognitionMethod: 'Apple Pay' })],
      {
        cardWalletUsed: true,
        qrClaimOpenedAt: '2026-07-26T20:00:00.000Z',
        qrClaimEvidenceStatus: 'verified',
      },
    ),
    expectedState: 'manual_exception',
    expectedClass: 'ambiguous_manual',
  },
  {
    name: 'missing QR evidence',
    expectedId: null,
    result: recommend(
      [sale({ id: 'missing-qr', last4: '9999', recognitionMethod: 'Apple Pay' })],
      { cardWalletUsed: true, qrClaimEvidenceStatus: 'missing' },
    ),
    expectedState: 'manual_exception',
    expectedClass: 'ambiguous_manual',
  },
  {
    name: 'direct-form intake',
    expectedId: null,
    result: recommend(
      [sale({ id: 'direct', last4: '9999', recognitionMethod: 'Contactless' })],
      { qrClaimOpenedAt: null, qrClaimEvidenceStatus: 'missing' },
    ),
    expectedState: 'manual_exception',
    expectedClass: 'ambiguous_manual',
  },
];

let controlledFalsePositives = 0;
for (const fixture of fixtures) {
  assert.equal(fixture.result.recommendationState, fixture.expectedState, fixture.name);
  assert.equal(fixture.result.confidenceClass, fixture.expectedClass, fixture.name);
  const recommended = fixture.result.candidates.find((candidate) => candidate.isRecommended) ?? null;
  if (fixture.expectedId) {
    assert.equal(recommended?.transactionId, fixture.expectedId, fixture.name);
  } else {
    assert.equal(recommended, null, fixture.name);
  }
  if (recommended && recommended.transactionId !== fixture.expectedId) controlledFalsePositives += 1;
  if (fixture.expectedClass === 'unique_qr_time') assert.equal(fixture.result.oneClickEligible, false);
}
assert.equal(controlledFalsePositives, 0);

const machineIds = Array.from(
  { length: 6 },
  (_, index) => `${String(index + 1).repeat(8)}-${String(index + 1).repeat(4)}-4${String(index + 1).repeat(3)}-8${String(index + 1).repeat(3)}-${String(index + 1).repeat(12)}`,
);
const cohort = validateCohort({
  schemaVersion: '2026-07-26.v1',
  sponsorApprovedPilotCohort: true,
  machineIds,
});
assert.equal(cohort.machineIds.length, 6);
assert.throws(
  () => validateCohort({ schemaVersion: '2026-07-26.v1', sponsorApprovedPilotCohort: false, machineIds }),
  /sponsorApprovedPilotCohort/,
);

const observations = validateObservations({
  schemaVersion: '2026-07-26.v1',
  physicalMachineChecks: { expected: 6, passed: 6, failed: 0 },
  controlledFixtures: {
    expected: fixtures.length + 1,
    passed: fixtures.length + 1,
    failed: 0,
    knownFalsePositiveHighConfidence: controlledFalsePositives,
  },
  operations: {
    managerFrictionCount: 1,
    customerFrictionCount: 0,
    qrDamageOrReplacementCount: 0,
    fallbackRequiredCount: 2,
  },
  rollback: {
    qrIdentifiersDisabled: true,
    recommendationsDisabled: true,
    directIntakeOperational: true,
    managerQueueOperational: true,
  },
  stopConditionTriggered: false,
});

const caseId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const claimId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const evidence = aggregatePilotEvidence({
  cases: [
    {
      id: caseId,
      reporting_machine_id: machineIds[0],
      refund_qr_claim_context_id: claimId,
      incident_at: incidentAt,
      payment_method: 'card',
      card_wallet_used: true,
      nayax_recommendation_state: 'high_confidence',
      nayax_recommendation_policy_version: '2026-07-26.v2',
    },
  ],
  qrClaims: [
    {
      id: claimId,
      reporting_machine_id: machineIds[0],
      opened_at: '2026-07-26T19:08:00.000Z',
      consumed_at: '2026-07-26T19:10:00.000Z',
    },
  ],
  events: [
    {
      refund_case_id: caseId,
      event_type: 'nayax_recommendation_evaluated',
      created_at: '2026-07-26T19:11:00.000Z',
      metadata: {
        recommendation_state: 'high_confidence',
        confidence_class: 'unique_qr_time',
        reason_codes: ['unique_qr_time_candidate'],
        policy_version: '2026-07-26.v2',
      },
    },
    {
      refund_case_id: caseId,
      event_type: 'nayax_match_selected',
      created_at: '2026-07-26T19:12:00.000Z',
      metadata: { selected_recommended: true },
    },
    {
      refund_case_id: caseId,
      event_type: 'nayax_lookup_failed',
      created_at: '2026-07-26T19:12:00.000Z',
      metadata: { payload_redacted: true },
    },
  ],
  observations,
  projectRefMatches: true,
  pilotWindow: {
    start: '2026-07-26T00:00:00.000Z',
    end: '2026-07-27T00:00:00.000Z',
  },
});

assert.equal(evidence.totalCases, 1);
assert.equal(evidence.highConfidenceByClass.unique_qr_time, 1);
assert.equal(evidence.recommendationStates.high_confidence, 1);
assert.equal(evidence.managerSelections.acceptedRecommended, 1);
assert.equal(evidence.qrClaimEvidence.verified, 1);
assert.equal(evidence.qrToReportedTimeDistribution['6_to_15_minutes_after'], 1);
assert.equal(evidence.lookupFailureCaseCount, 1);
assert.equal(evidence.policyVersions['2026-07-26.v2'], 1);
assert.equal(evidence.gates.hasObservedCases, true);
assert.equal(evidence.gates.policyVersionCurrent, true);
assert.equal(evidence.gates.evidenceReadyForSponsorReview, true);
assert.equal(evidence.gates.sponsorDecisionStillRequired, true);
assert.equal(evidence.rawIdentifiersEmitted, false);
assert.equal(evidence.customerDataEmitted, false);
assert.equal(evidence.providerWriteAttempted, false);
assert.equal(evidence.productionDataWritten, false);
const serialized = JSON.stringify(evidence);
for (const privateIdentifier of [...machineIds, caseId, claimId]) {
  assert.equal(serialized.includes(privateIdentifier), false);
}

assert.equal(
  parsePilotArgs([
    '--project-ref',
    'project',
    '--cohort-file',
    'cohort.json',
    '--observations-file',
    'observations.json',
    '--start',
    '2026-07-01T00:00:00Z',
    '--end',
    '2026-07-02T00:00:00Z',
  ]).start,
  '2026-07-01T00:00:00.000Z',
);
assert.throws(
  () =>
    parsePilotArgs([
      '--project-ref',
      'project',
      '--cohort-file',
      'cohort.json',
      '--observations-file',
      'observations.json',
      '--start',
      '2026-07-01',
      '--end',
      '2026-08-15',
    ]),
  /no longer than 31 days/,
);

assert.equal(source.includes('.insert('), false);
assert.equal(source.includes('.update('), false);
assert.equal(source.includes('.upsert('), false);
assert.equal(source.includes('.delete('), false);
assert.equal(source.includes('lastSales'), false);
assert.match(source, /range\(from, to\)/);
assert.match(source, /MAX_ROWS_PER_TABLE/);
assert.match(source, /rawIdentifiersEmitted: false/);
assert.match(source, /sponsorDecisionStillRequired: true/);

console.log(
  `QR shadow pilot validator passed (${fixtures.length + 1} required scenarios, zero controlled false positives).`,
);
