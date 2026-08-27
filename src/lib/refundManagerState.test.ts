/// <reference lib="deno.ns" />

import { getRefundManagerState, getRefundPaymentStateLabel } from './refundManagerState.ts';
import type { RefundLifecycleContract, RefundLifecycleStage } from './refundLifecycle.ts';

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

const lifecycle = (
  stage: RefundLifecycleStage,
  stageRank: number,
  managerNextAction = 'wait'
): RefundLifecycleContract => ({
  schemaVersion: 'refund_lifecycle_v1',
  stage,
  stageRank,
  evidenceState: 'synthetic',
  lastUpdatedAt: '2026-08-26T20:00:00.000Z',
  publicCopyKey: `refund_${stage}`,
  managerNextAction,
  terminal: stage === 'customer_notified' || stage === 'denied',
  refreshAfterSeconds:
    stage === 'customer_notified' || stage === 'denied' ? null : 5,
  lookup: {
    status: stage === 'matching' ? 'checking' : 'match_found',
    safeRetryEligible: false,
    failureClass: null,
    lastUpdatedAt: '2026-08-26T19:59:55.000Z',
  },
  operations: {
    required: stage === 'needs_refund_operations',
    queue: 'Refund Operations',
    owner: 'Refund Operations',
    slaMinutes: 60,
    ageMinutes: stage === 'needs_refund_operations' ? 12 : null,
    dueAt: null,
    slaBreached: false,
    safeStage: 'synthetic',
    failureClass: null,
    nextStep: stage === 'needs_refund_operations'
      ? 'Confirm the authoritative Nayax result. Do not retry.'
      : null,
  },
  payloadRedacted: true,
});

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
  assertEquals(getRefundManagerState(baseCase, { isRefunding: true }).label, 'Refund initiated', 'in-flight label');
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
    'Evidence can be recorded',
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

Deno.test('authoritative no-refund rejection restores the normal manager action', () => {
  const releasedLifecycle = lifecycle('transaction_confirmed', 30, 'issue_refund');
  releasedLifecycle.definitiveNoRefund = true;
  releasedLifecycle.safeRetryEligible = true;
  releasedLifecycle.operations.required = false;
  releasedLifecycle.operations.safeStage = 'released_no_refund';
  releasedLifecycle.operations.failureClass = 'provider_rejected';

  const releasedCase = {
    ...baseCase,
    providerOutcome: 'rejected' as const,
    providerHold: false,
    hasMatchedNayaxTransaction: true,
    refundReadiness: {
      transactionConfirmed: true,
      canIssueCardRefund: true,
      blockReason: null,
    },
    lifecycle: releasedLifecycle,
  };

  assertEquals(getRefundManagerState(releasedCase).label, 'Ready to refund', 'released rejection label');
  assertEquals(getRefundPaymentStateLabel(releasedCase), 'Not issued', 'released rejection payment label');
});

Deno.test('manager state consumes the canonical lifecycle for automatic progress', () => {
  const expected = [
    ['matching', 10, 'Checking transactions'],
    ['needs_transaction_selection', 20, 'Review transactions'],
    ['refund_initiated', 40, 'Refund initiated'],
    ['confirming_with_nayax', 50, 'Confirming refund'],
    ['refund_confirmed', 70, 'Refund confirmed'],
    ['customer_notified', 80, 'Completed'],
  ] as const;

  for (const [stage, stageRank, label] of expected) {
    const result = getRefundManagerState({
      ...baseCase,
      lifecycle: lifecycle(stage, stageRank),
    });
    assertEquals(result.label, label, `${stage} label`);
  }
});

Deno.test('canonical operations hold gives routine managers no technical action', () => {
  const heldCase = {
    ...baseCase,
    lifecycle: lifecycle('needs_refund_operations', 60, 'refund_operations'),
  };
  const routine = getRefundManagerState(heldCase);
  const operations = getRefundManagerState(heldCase, { canResolveHeldResult: true });

  assertEquals(routine.id, 'needs_refund_operations', 'routine hold state');
  assertEquals(
    routine.nextStep,
    'Refund Operations owns the next step. No action is needed, and the payment will not be tried again.',
    'routine guidance'
  );
  assertEquals(
    operations.nextStep,
    'Use the Refund Operations panel below to record authoritative evidence. Never retry the payment.',
    'operations guidance'
  );
});

Deno.test('canonical lookup failure exposes only the read-only refresh action', () => {
  const failedLifecycle = lifecycle('matching', 10);
  failedLifecycle.lookup.status = 'lookup_timed_out';
  failedLifecycle.lookup.safeRetryEligible = true;
  const result = getRefundManagerState({
    ...baseCase,
    lifecycle: failedLifecycle,
  });

  assertEquals(result.id, 'match_attention', 'failed lookup state');
  assertEquals(
    result.nextStep,
    'Select Refresh transactions. No refund has been issued.',
    'safe retry copy'
  );
});

Deno.test('account reconciliation hold explains the account-level circuit breaker', () => {
  const result = getRefundManagerState({
    ...baseCase,
    hasMatchedNayaxTransaction: true,
    refundReadiness: {
      transactionConfirmed: true,
      canIssueCardRefund: false,
      blockReason: 'account_reconciliation_hold',
    },
  });

  assertEquals(result.id, 'refund_unavailable', 'account hold state');
  assertEquals(
    result.nextStep,
    'Card refunds for this payment account are paused because an earlier result still needs review.',
    'account hold guidance'
  );
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

Deno.test('confirmed transaction takes precedence over an older manual-review recommendation', () => {
  const result = getRefundManagerState({
    ...baseCase,
    hasMatchedNayaxTransaction: true,
    nayaxRecommendationState: 'manual_exception',
    nayaxLookupSummary: {
      lookupStatus: 'manual_exception',
      recommendationState: 'manual_exception',
    },
    refundReadiness: {
      transactionConfirmed: true,
      canIssueCardRefund: true,
      blockReason: null,
    },
  });

  assertEquals(result.id, 'ready_to_refund', 'confirmed state');
  assertEquals(result.label, 'Ready to refund', 'confirmed label');
  assertEquals(result.explanation, 'Transaction confirmed. Payment: Not issued.', 'payment clarity');
});

Deno.test('confirmed transaction shows the exact safe reason when refunding is unavailable', () => {
  const result = getRefundManagerState({
    ...baseCase,
    hasMatchedNayaxTransaction: true,
    refundReadiness: {
      transactionConfirmed: true,
      canIssueCardRefund: false,
      blockReason: 'machine_not_enabled',
    },
  });

  assertEquals(result.id, 'refund_unavailable', 'blocked confirmed state');
  assertEquals(result.label, 'Transaction confirmed', 'blocked confirmed label');
  assertEquals(
    result.nextStep,
    'Card refunds are not enabled for this machine. An administrator needs to enable them.',
    'specific safe reason'
  );
});

Deno.test('cash cases with an amount are ready to mark refunded without a transaction match', () => {
  const result = getRefundManagerState({
    ...baseCase,
    paymentMethod: 'cash',
    paymentAmountCents: 800,
    correlationStatus: 'no_match',
    nayaxRecommendationState: null,
  });

  assertEquals(result.id, 'ready_to_refund', 'cash completion state');
  assertEquals(result.label, 'Ready to mark refunded', 'cash completion label');
  assertEquals(
    result.nextStep,
    'After sending it through Zelle or Venmo, select Mark refunded.',
    'cash completion next step'
  );
});

Deno.test('cash cases without an amount route to customer follow-up', () => {
  const result = getRefundManagerState({
    ...baseCase,
    paymentMethod: 'cash',
    paymentAmountCents: null,
    correlationStatus: 'no_match',
    nayaxRecommendationState: null,
  });

  assertEquals(result.id, 'needs_information', 'missing cash amount state');
  assertEquals(result.label, 'Needs payment amount', 'missing cash amount label');
});
