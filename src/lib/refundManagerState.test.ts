/// <reference lib="deno.ns" />

import { getRefundManagerState, getRefundPaymentStateLabel } from './refundManagerState.ts';

const assertEquals = (actual: unknown, expected: unknown, message: string) => {
  if (actual !== expected) throw new Error(`${message}: expected ${expected}, received ${actual}`);
};

const baseCase = {
  status: 'needs_review' as const,
  paymentMethod: 'card' as const,
  correlationStatus: 'matched' as const,
  providerOutcome: 'not_attempted' as const,
  nayaxRecommendationState: 'high_confidence' as const,
};

Deno.test('manager state presents the normal card case as ready for review', () => {
  assertEquals(getRefundManagerState(baseCase).label, 'Ready for review', 'ready label');
  assertEquals(getRefundPaymentStateLabel(baseCase), 'Not issued', 'separate payment label');
});

Deno.test('manager state distinguishes missing facts and automatic lookup', () => {
  assertEquals(
    getRefundManagerState({ ...baseCase, status: 'waiting_on_customer', missingInformation: true }).label,
    'Needs information',
    'missing-information label'
  );
  assertEquals(
    getRefundManagerState({ ...baseCase, correlationStatus: 'needs_nayax' }).label,
    'Checking',
    'automatic lookup label'
  );
});

Deno.test('manager state keeps ambiguous, unmatched, and failed lookup results out of ready state', () => {
  const expectedLabels = {
    multiple_matches: 'More than one possible match',
    no_match: 'No matching transaction',
    lookup_failed: 'Transaction check failed',
  } as const;

  for (const lookupStatus of ['multiple_matches', 'no_match', 'lookup_failed'] as const) {
    const result = getRefundManagerState({
      ...baseCase,
      correlationStatus: lookupStatus === 'multiple_matches' ? 'multiple_candidates' : 'no_match',
      nayaxLookupSummary: { lookupStatus },
    });
    assertEquals(result.id, 'match_attention', `${lookupStatus} state`);
    assertEquals(result.label, expectedLabels[lookupStatus], `${lookupStatus} manager label`);
  }

  const setupResult = getRefundManagerState({
    ...baseCase,
    correlationStatus: 'needs_nayax',
    nayaxLookupSummary: { lookupStatus: 'setup_needed' },
  });
  assertEquals(setupResult.id, 'match_attention', 'fresh setup result overrides older pending correlation');
  assertEquals(setupResult.label, 'Transaction search unavailable', 'setup manager label');
});

Deno.test('manager state distinguishes in-flight, uncertain, rejected, completed, and denied payments', () => {
  assertEquals(getRefundManagerState(baseCase, { isRefunding: true }).label, 'Refunding', 'in-flight label');
  assertEquals(
    getRefundManagerState({ ...baseCase, providerHold: true, providerOutcome: 'unconfirmed' }).label,
    'Refund result is being checked',
    'uncertain label'
  );
  assertEquals(
    getRefundManagerState(
      { ...baseCase, providerHold: true, providerOutcome: 'unconfirmed' },
      { canResolveHeldResult: true }
    ).label,
    'Provider confirmation ready',
    'actionable held-result label'
  );
  assertEquals(
    getRefundManagerState({ ...baseCase, providerOutcome: 'rejected' }).label,
    'Refund rejected',
    'rejected label'
  );
  assertEquals(
    getRefundManagerState({ ...baseCase, status: 'completed', providerOutcome: 'succeeded' }).label,
    'Completed',
    'completed label'
  );
  assertEquals(getRefundManagerState({ ...baseCase, status: 'denied' }).label, 'Denied', 'denied label');
});

Deno.test('uncertain provider result blocks a second action even when old status looks ready', () => {
  const result = getRefundManagerState({
    ...baseCase,
    status: 'card_refund_pending',
    providerHold: true,
    providerOutcome: 'unconfirmed',
  });
  assertEquals(result.id, 'check_nayax_result', 'provider hold precedence');
  assertEquals(getRefundPaymentStateLabel({ ...baseCase, providerHold: true }), 'Result unclear', 'payment label');
});
