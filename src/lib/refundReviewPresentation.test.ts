/// <reference lib="deno.ns" />

import {
  getRefundCardNetworkLabel,
  getRefundMachineContextPresentation,
  getRefundReviewEvidence,
  getRefundSearchCoveragePresentation,
  getRefundSelectionPresentation,
  type RefundReviewCandidateEvidence,
} from './refundReviewPresentation.ts';

const equal = (actual: unknown, expected: unknown) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
};
const includes = (actual: string, expected: string) => {
  if (!actual.includes(expected)) throw new Error(`Expected ${actual} to include ${expected}`);
};
const candidate = (): RefundReviewCandidateEvidence => ({
  amountCents: 1060, currencyCode: 'USD', cardLast4: '1111', cardNetwork: 'visa', timeDeltaMinutes: 1,
  timeEvidence: {
    schemaVersion: 'refund_candidate_time_v1', providerTimestampSource: 'authorization_gmt',
    providerTimeResolution: 'exact', machineTimeResolution: 'exact', machineClockTimezone: 'America/Los_Angeles',
    machineClockSource: 'native_machine_configuration', occurrenceComparable: false,
    occurrenceSemantics: 'unknown', occurrenceTimezoneBasis: null, payloadRedacted: true,
  },
  matchFactors: [
    { key: 'customer_time_confidence', outcome: 'match', label: 'Rough customer time' },
    { key: 'request_time', outcome: 'manual', label: 'Provider time caveat; purchase after request is not proof' },
    { key: 'machine', outcome: 'match', label: 'Exact mapped machine and location' },
    { key: 'amount', outcome: 'match', label: 'Amount differs by tax' },
    { key: 'incident_time', outcome: 'match', label: 'One minute apart' },
    { key: 'card', outcome: 'manual', label: 'Different wallet digits' },
    { key: 'card_network', outcome: 'missing', label: 'Customer card type unknown' },
    { key: 'provider_status', outcome: 'match', label: 'Nayax marks sale approved' },
  ],
});

Deno.test('reviewed case retains all material factors and does not promote caveats into support', () => {
  const model = getRefundReviewEvidence({
    candidate: candidate(),
    customer: { paymentAmountCents: 1000, cardLast4: '2222', cardNetwork: 'other_unknown', incidentTimeConfidence: 'rough' },
  });
  equal(model.supporting.map((factor) => factor.key), ['machine', 'provider_status']);
  equal(model.uncertainties.map((factor) => factor.key),
    ['customer_time_confidence', 'request_time', 'amount', 'incident_time', 'card', 'card_network']);
  equal(model.supporting.length + model.conflicts.length + model.uncertainties.length, 8);
  includes(model.uncertainties.find((factor) => factor.key === 'amount')!.label, '$0.60');
  includes(model.uncertainties.find((factor) => factor.key === 'amount')!.label, 'may explain it');
  includes(model.uncertainties.find((factor) => factor.key === 'incident_time')!.label, 'purchase timing remains uncertain');
});

Deno.test('explicit conflicts stay visible and amount differences do not create an eligibility gate', () => {
  const input = candidate();
  input.cardLast4Comparison = 'mismatch_negative_unproven_equivalence';
  input.matchFactors = [
    { key: 'amount', outcome: 'mismatch', label: 'Amount mismatch' },
    { key: 'card', outcome: 'manual', label: 'Digits differ' },
    { key: 'refund_state', outcome: 'blocked', label: 'Already refunded' },
  ];
  const model = getRefundReviewEvidence({ candidate: input, customer: { paymentAmountCents: 1000, cardLast4: '2222' } });
  equal(model.conflicts.map((factor) => factor.key), ['amount', 'card', 'refund_state']);
  equal(Object.keys(model), ['supporting', 'conflicts', 'uncertainties']);
});

Deno.test('request timing stays context and preserves missing receipt evidence', () => {
  const input = candidate();
  const missing = 'Original customer request receipt time is unavailable';
  input.matchFactors = [{ key: 'request_time', outcome: 'manual', label: missing }];
  const unknown = getRefundReviewEvidence({ candidate: input });
  equal(unknown.uncertainties.find((factor) => factor.key === 'request_time')?.label, missing);
  input.matchFactors = [{ key: 'request_time', outcome: 'match', label: 'Record predates the request' }];
  const before = getRefundReviewEvidence({ candidate: input });
  equal(before.supporting.some((factor) => factor.key === 'request_time'), false);
  equal(before.uncertainties.some((factor) => factor.key === 'request_time'), true);
});

Deno.test('reported wallet digits are not explained away as physical card digits', () => {
  const model = getRefundReviewEvidence({ candidate: candidate(), customer: {
    cardLast4: '2222', cardLast4Source: 'wallet_device', cardLast4Provenance: 'wallet_device_token',
  } });
  includes(model.uncertainties.find((factor) => factor.key === 'card')!.label, 'equivalence is unverified');
});

Deno.test('known network mismatch is a visible difference; omitted and Other/unsure are distinct', () => {
  equal(getRefundCardNetworkLabel(null), 'Not provided');
  equal(getRefundCardNetworkLabel('other_unknown'), 'Other / customer unsure');
  const known = getRefundReviewEvidence({ candidate: candidate(), customer: { cardNetwork: 'mastercard' } });
  includes(known.conflicts.find((factor) => factor.key === 'card_network')!.label, 'customer Mastercard, Nayax Visa');
  const missing = getRefundReviewEvidence({ candidate: candidate(), customer: { cardNetwork: null } });
  includes(missing.uncertainties.find((factor) => factor.key === 'card_network')!.label, 'not provided');
  const unsure = getRefundReviewEvidence({ candidate: candidate(), customer: { cardNetwork: 'other_unknown' } });
  includes(unsure.uncertainties.find((factor) => factor.key === 'card_network')!.label, 'unknown (Other / unsure)');
});

Deno.test('a comparable purchase time supports an exact customer time, but estimates remain qualified', () => {
  const input = candidate();
  input.timeEvidence = { ...input.timeEvidence!, occurrenceComparable: true };
  const exact = getRefundReviewEvidence({ candidate: input, customer: { incidentTimeConfidence: 'exact' } });
  equal(exact.supporting.some((factor) => factor.key === 'incident_time'), true);
  const estimate = getRefundReviewEvidence({ candidate: input, customer: { incidentTimeConfidence: 'within_15_minutes' } });
  includes(estimate.uncertainties.find((factor) => factor.key === 'incident_time')!.label, 'customer estimate');
});

Deno.test('an explicit provider brand supplies the comparison when its network field is absent', () => {
  const input = { ...candidate(), cardNetwork: null, cardBrand: 'Visa' };
  const model = getRefundReviewEvidence({ candidate: input, customer: { cardNetwork: 'visa' } });
  equal(model.supporting.find((factor) => factor.key === 'card_network')?.label, 'Card network matches (Visa).');
  equal(model.uncertainties.some((factor) => factor.key === 'card_network'), false);
});

Deno.test('saved selected evidence remains reviewable without a current candidate or processing-time delta', () => {
  const input = candidate();
  const model = getRefundReviewEvidence({
    candidate: null,
    selected: { matchFactors: input.matchFactors, timeEvidence: input.timeEvidence, saleAmountCents: 1060, currencyCode: 'USD', cardLast4: '1111', cardNetwork: 'visa' },
    customer: { paymentAmountCents: 1000, cardLast4: '2222', incidentTimeConfidence: 'rough' },
  });
  includes(model.uncertainties.find((factor) => factor.key === 'incident_time')!.label, 'purchase timing remains uncertain');
  includes(model.uncertainties.find((factor) => factor.key === 'amount')!.label, '$0.60');
  equal(model.supporting.length + model.conflicts.length + model.uncertainties.length, 8);
  equal(getRefundReviewEvidence({ candidate: null, selected: null }), { supporting: [], conflicts: [], uncertainties: [] });
});

Deno.test('amount differences retain provider currency and never invent USD for missing currency', () => {
  const input = candidate();
  input.currencyCode = 'EUR';
  const euros = getRefundReviewEvidence({ candidate: input, customer: { paymentAmountCents: 1000 } });
  includes(euros.uncertainties.find((factor) => factor.key === 'amount')!.label, '€0.60');
  input.currencyCode = null;
  const unknown = getRefundReviewEvidence({ candidate: input, customer: { paymentAmountCents: 1000 } });
  includes(unknown.uncertainties.find((factor) => factor.key === 'amount')!.label, 'currency unavailable');
});

Deno.test('selection events remain unbound history and never identify a current manager or rationale', () => {
  const model = getRefundSelectionPresentation({
    evidenceSource: 'nayax_last_sales', recommendationState: 'manager_confirmed', events: [
      { id: 'new', eventType: 'nayax_match_selected', message: 'Machine Manager confirmed an alternate Nayax transaction after review.', createdAt: '2026-09-30T15:00:00Z' },
      { id: 'old', eventType: 'nayax_match_preselected', message: 'One clear transaction', createdAt: '2026-09-29T15:00:00Z' },
      { id: 'invalid', eventType: 'nayax_match_selected', message: null, createdAt: 'not a date' },
    ],
  });
  equal(model.title, 'Selected for review');
  equal(model.sourceLabel, 'Saved Nayax Last Sales evidence');
  equal(model.history?.eventId, 'new');
  includes(model.history!.label, 'purchase link unavailable');
  equal(model.rationale, null);
  includes(model.rationaleHint, 'unavailable');
  equal('recordedAt' in model, false);
  equal(getRefundSelectionPresentation({ recommendationState: 'high_confidence' }).history, null);
});

Deno.test('unknown machine status without alerts is hidden; present status and alerts retain their different meanings', () => {
  equal(getRefundMachineContextPresentation({ machineStatus: { state: 'unknown', label: 'Unknown', checkedAt: '2026-10-03T12:00:00Z' } }), null);
  const model = getRefundMachineContextPresentation({
    machineStatus: { state: 'online', label: 'Online', checkedAt: '2026-10-03T12:00:00Z' },
    nearbyMachineAlerts: [{ category: 'dispense', occurredAt: '2026-09-26T12:00:00Z' }],
  })!;
  equal(model.status!.checkedAt, '2026-10-03T12:00:00Z');
  equal(model.alerts[0].occurredAt, '2026-09-26T12:00:00Z');
  includes(model.statusNote, 'lookup time');
  includes(model.alertsNote, 'do not prove this purchase failed');
  equal(getRefundMachineContextPresentation({ nearbyMachineAlerts: model.alerts })!.status, null);
});

Deno.test('coverage labels distinguish returned candidates, window records, and unknown history', () => {
  const model = getRefundSearchCoveragePresentation({ candidateCount: 1, providerRecordCount: 100, providerWindowRecordCount: 3,
    windowHours: 24, historicalCoverage: 'unknown', lastCheckedAt: '2026-10-03T12:00:00Z' });
  equal(model.resultCountLabel, '1 candidate returned for review');
  equal(model.providerRecordCountLabel, '3 provider records in the reported search window');
  includes(model.coverageLabel, 'other plausible purchases may be missing');
  equal(model.freshnessAt, '2026-10-03T12:00:00Z');
  const missing = getRefundSearchCoveragePresentation({ candidateCount: -1, providerRecordCount: Number.NaN, lastCheckedAt: 'invalid' });
  equal(missing.resultCountLabel, 'Returned candidate count unavailable');
  equal(missing.providerRecordCountLabel, 'Provider record count unavailable');
  equal(missing.freshnessAt, null);
  includes(getRefundSearchCoveragePresentation({ historicalCoverage: 'complete' }).coverageLabel, 'Nayax reports complete');
});
