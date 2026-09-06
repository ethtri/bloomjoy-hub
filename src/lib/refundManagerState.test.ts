/// <reference lib="deno.ns" />

import { getRefundManagerState, getRefundPaymentStateLabel, hasUnpaidRefundReview } from './refundManagerState.ts';
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
  schemaVersion: 'refund_lifecycle_v2',
  version: 1,
  stage,
  stageRank,
  reasonCode: `test_${stage}`,
  actor: 'system',
  customerAction: {
    action: stage === 'waiting_on_customer' ? 'reply_in_existing_thread' : 'none',
    required: stage === 'waiting_on_customer',
    requestedFields: stage === 'waiting_on_customer' ? ['incident_time'] : [],
    payloadRedacted: true,
  },
  managerAction: {
    action: managerNextAction,
    owner: stage === 'needs_refund_operations' ? 'Refund Operations' : 'Machine Manager',
    safeRetryEligible: false,
    payloadRedacted: true,
  },
  paymentState: stage === 'needs_refund_operations' ? 'outcome_unknown' : 'not_requested',
  messageState: {
    state: 'none',
    messageType: null,
    lastUpdatedAt: null,
    payloadRedacted: true,
  },
  classification: 'customer',
  evidenceState: 'synthetic',
  locationEvidence: {
    customerReported: {
      selectionKey: 'test-selection', selectionKind: 'exact_machine',
      machineIds: ['b3000000-0000-4000-8000-000000000001'], preserved: true,
      payloadRedacted: true,
    },
    normalized: {
      locationId: 'b2000000-0000-4000-8000-000000000001',
      machineId: 'b3000000-0000-4000-8000-000000000001',
      timezone: 'America/Los_Angeles', providerAccountKey: 'TEST',
      mappingSource: 'nayax', mappingVersion: 1, confidence: 1,
      authoritative: true, payloadRedacted: true,
    },
    payloadRedacted: true,
  },
  lastUpdatedAt: '2026-08-26T20:00:00.000Z',
  publicCopyKey: `refund_${stage}`,
  managerNextAction,
  terminal: stage === 'customer_notified' || stage === 'denied',
  refreshAfterSeconds:
    stage === 'customer_notified' || stage === 'denied' ? null : 5,
  managerQueue: {
    schemaVersion: 'refund_manager_queue_v2',
    bucket: stage === 'waiting_on_customer'
      ? 'waiting_on_customer'
      : stage === 'needs_refund_operations'
        ? 'provider_hold'
        : stage === 'customer_notified' || stage === 'denied'
          ? 'completed'
          : stage === 'transaction_confirmed'
            ? 'ready_to_pay'
            : ['refund_initiated', 'confirming_with_nayax', 'refund_confirmed'].includes(stage)
              ? 'in_progress'
              : 'needs_action',
    label: 'Synthetic queue',
    nextAction: managerNextAction,
    safeRetryEligible: false,
    payloadRedacted: true,
  },
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

Deno.test('v2-only payout, integrity, closure, and internal/test states stay explicit', () => {
  const fixtures = [
    ['awaiting_payout', 'awaiting_payout', 'Ready to reimburse'],
    ['integrity_hold', 'integrity_hold', 'Lifecycle evidence needs review'],
    ['unable_to_complete', 'closed', 'Unable to complete'],
    ['internal_test_archived', 'internal_test_archived', 'Internal/test archived'],
  ] as const;
  for (const [stage, expectedId, expectedLabel] of fixtures) {
    const contract = lifecycle(
      stage,
      stage === 'internal_test_archived' ? 100 : 60,
      stage === 'awaiting_payout' ? 'mark_external_refund' : 'none',
    );
    if (stage === 'integrity_hold') {
      contract.managerAction.action = 'reconcile_lifecycle_integrity';
      contract.managerAction.owner = 'Refund Operations';
      contract.managerQueue.bucket = 'integrity_hold';
    }
    if (stage === 'internal_test_archived') {
      contract.classification = 'internal_test';
      contract.managerQueue.bucket = 'internal_archive';
    }
    const result = getRefundManagerState({ ...baseCase, lifecycle: contract });
    assertEquals(result.id, expectedId, `${stage} id`);
    assertEquals(result.label, expectedLabel, `${stage} label`);
  }
});

Deno.test('manager state presents the normal card case as ready for review', () => {
  assertEquals(getRefundManagerState(baseCase).label, 'Ready for review', 'ready label');
  assertEquals(getRefundPaymentStateLabel(baseCase), 'Not issued', 'separate payment label');
});

Deno.test('manager state surfaces a direct-email bounce without changing payment truth', () => {
  const result = getRefundManagerState({
    ...baseCase,
    providerOutcome: 'succeeded',
    customerDeliveryException: {
      state: 'bounced',
      messageType: 'completed',
      recoveryOwner: 'refund_operations',
      nextAction: 'review_delivery_no_resend',
      customerMessageReplayAllowed: false,
      paymentReplayAllowed: false,
    },
  });
  assertEquals(result.label, 'Delivery needs review', 'delivery exception label');
  assertEquals(
    result.explanation,
    'The customer address bounced. The refund and payment state have not been changed.',
    'payment truth remains separate'
  );
});

Deno.test('confirmed receipt stays explicit alongside historical and current message exceptions', () => {
  for (const messageType of ['status_update', 'completed']) {
    for (const deliveryState of ['unknown', 'deferred', 'failed', 'bounced', 'complained'] as const) {
      const confirmed = lifecycle('refund_confirmed', 70, 'review_accounting_date');
      confirmed.paymentState = 'confirmed';
      confirmed.reasonCode = 'settlement_time_unknown';
      const result = getRefundManagerState({
        ...baseCase,
        status: 'card_refund_pending',
        providerOutcome: 'unconfirmed',
        lifecycle: confirmed,
        customerDeliveryException: {
          state: deliveryState, messageType, recoveryOwner: 'refund_operations',
          nextAction: 'review_delivery_no_resend', customerMessageReplayAllowed: false,
          paymentReplayAllowed: false,
        },
      });
      assertEquals(result.label, 'Refund confirmed · delivery review', `${messageType}/${deliveryState} label`);
      assertEquals(result.explanation.startsWith('The payment provider confirmed the full refund.'), true, 'Payment evidence stays first');
      assertEquals(result.nextStep.includes('message-delivery and accounting-date review'), true, 'Both internal reviews remain visible');
      assertEquals(result.nextStep.includes('Do not retry payment or resend'), true, 'No new financial or message action');
      assertEquals(result.tone, 'warning', 'Delivery exception is not hidden');
    }
  }
});

Deno.test('a completion delivery failure after customer notification retains confirmed payment', () => {
  const notified = lifecycle('customer_notified', 80);
  notified.paymentState = 'confirmed';
  const result = getRefundManagerState({ ...baseCase, lifecycle: notified,
    customerDeliveryException: { state: 'bounced', messageType: 'completed',
      recoveryOwner: 'refund_operations', nextAction: 'review_delivery_no_resend',
      customerMessageReplayAllowed: false, paymentReplayAllowed: false } });
  assertEquals(result.label, 'Refund confirmed · delivery review', 'Confirmed payment remains explicit');
  assertEquals(result.explanation.includes('The customer address bounced.'), true, 'Current completion failure remains explicit');
  assertEquals(result.nextStep.includes('accounting-date'), false, 'No invented accounting exception');
});

Deno.test('an active money action remains more urgent than an earlier delivery exception', () => {
  const result = getRefundManagerState(
    {
      ...baseCase,
      customerDeliveryException: {
        state: 'unknown',
        messageType: 'status_update',
        recoveryOwner: 'refund_operations',
        nextAction: 'review_delivery_no_resend',
        customerMessageReplayAllowed: false,
        paymentReplayAllowed: false,
      },
    },
    { isRefunding: true }
  );
  assertEquals(result.id, 'refunding', 'active refund state');
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

Deno.test('adopted unknown-date receipt keeps accounting internal without implying another customer send', () => {
  const result = getRefundManagerState({ ...baseCase, lifecycle: {
    ...lifecycle('customer_notified', 80, 'review_accounting_date'),
    reasonCode: 'settlement_time_unknown', paymentState: 'confirmed', terminal: false,
    messageState: { state: 'sent', messageType: 'completed', lastUpdatedAt: '2026-08-26T20:00:00.000Z', payloadRedacted: true },
  } });
  assertEquals(result.label, 'Refund confirmed · customer updated', 'Adopted notice is visible');
  assertEquals(result.nextStep.includes('Do not retry payment or resend'), true, 'No second payment or send');
  assertEquals(result.explanation.includes('settlement date remains unknown'), true, 'Accounting date remains unknown');
});

Deno.test('receipt manager state keeps every customer-notice outcome observable without reopening payment', () => {
  const fixtures = [
    ['none', 'Refund confirmed · notice not recorded'],
    ['pending', 'Refund confirmed · customer notice queued'],
    ['failed', 'Refund confirmed · delivery review'],
    ['delivery_unconfirmed', 'Refund confirmed · delivery review'],
    ['sent', 'Refund confirmed · customer updated'],
    ['delivered', 'Refund confirmed · customer updated'],
  ] as const;
  for (const [messageState, label] of fixtures) {
    const contract = lifecycle(
      ['sent', 'delivered'].includes(messageState) ? 'customer_notified' : 'refund_confirmed',
      ['sent', 'delivered'].includes(messageState) ? 80 : 70,
      'review_accounting_date',
    );
    contract.reasonCode = 'settlement_time_unknown';
    contract.paymentState = 'confirmed';
    contract.paymentWorkComplete = true;
    contract.safeRetryEligible = false;
    contract.managerAction.owner = 'Refund Operations';
    contract.managerQueue = {
      schemaVersion: 'refund_manager_queue_v2', bucket: 'accounting_review',
      label: 'Refund confirmed · accounting review', nextAction: 'review_accounting_date',
      safeRetryEligible: false, customerActionFields: [], payloadRedacted: true,
    };
    contract.messageState = {
      state: messageState, messageType: 'completed',
      lastUpdatedAt: '2026-08-26T20:00:00.000Z', payloadRedacted: true,
    };
    const result = getRefundManagerState({ ...baseCase, lifecycle: contract });
    assertEquals(result.label, label, `${messageState} label`);
    assertEquals(result.nextStep.includes('Refund Operations'), true, `${messageState} operations owner`);
    assertEquals(result.nextStep.includes('Do not retry payment'), true, `${messageState} payment remains closed`);
  }
});

Deno.test('legacy receipt presentation treats an absent message state as missing notice evidence', () => {
  const contract = lifecycle('refund_confirmed', 70, 'review_accounting_date');
  contract.reasonCode = 'settlement_time_unknown';
  contract.paymentState = 'confirmed';
  contract.paymentWorkComplete = true;
  const { messageState: _messageState, ...legacyReceipt } = contract;
  const result = getRefundManagerState({
    ...baseCase,
    lifecycle: legacyReceipt as RefundLifecycleContract,
  });
  assertEquals(result.label, 'Refund confirmed · notice not recorded', 'missing notice remains explicit');
  assertEquals(result.nextStep.includes('Do not retry payment'), true, 'payment remains closed');

  const notifiedResult = getRefundManagerState({
    ...baseCase,
    lifecycle: { ...legacyReceipt, stage: 'customer_notified', stageRank: 80 } as RefundLifecycleContract,
  });
  assertEquals(notifiedResult.label, 'Refund confirmed · customer updated', 'legacy notified stage remains evidence');
});

Deno.test('canonical waiting-on-customer stage wins over matching facts', () => {
  for (const paymentMethod of ['card', 'cash'] as const) {
    const result = getRefundManagerState({
      ...baseCase,
      paymentMethod,
      paymentAmountCents: 500,
      status: 'waiting_on_customer',
      missingInformation: true,
      lifecycle: lifecycle('waiting_on_customer', 15, 'wait_for_customer_reply'),
    });
    assertEquals(result.id, 'waiting_on_customer', `${paymentMethod} waiting state id`);
    assertEquals(result.label, 'Waiting on customer', `${paymentMethod} waiting label`);
    assertEquals(
      result.nextStep,
      'Wait for the customer to reply to the existing email. Do not start another transaction check yet.',
      `${paymentMethod} waiting next action`
    );
  }
});

Deno.test('canonical waiting state names the exact customer-correctable fields', () => {
  const waitingLifecycle = lifecycle('waiting_on_customer', 15, 'wait_for_customer_reply');
  waitingLifecycle.managerQueue.customerActionFields = ['incident_time', 'card_last4'];
  const result = getRefundManagerState({
    ...baseCase,
    status: 'waiting_on_customer',
    lifecycle: waitingLifecycle,
  });

  assertEquals(
    result.explanation,
    'Bloomjoy sent a request for: purchase time, physical-card last four.',
    'waiting explanation names the exact requested fields'
  );
  assertEquals(
    result.nextStep,
    'Wait for the customer to reply with purchase time, physical-card last four in the existing email thread.',
    'waiting next step uses the same field contract'
  );
});

Deno.test('transaction-confirmed detail cannot overrule blocked canonical queue authority', () => {
  const fixtures = [
    {
      block: 'manager authority',
      canPerformOfficialAction: false,
      officialActionVersion: 1,
      officialActionBlockReason: 'manager_mapping_required',
      nextAction: 'resolve_manager_access',
      expectedNextStep:
        'Ask an administrator to restore your Machine Manager access before taking action.',
    },
    {
      block: 'missing official-action version',
      canPerformOfficialAction: true,
      officialActionVersion: 0,
      officialActionBlockReason: null,
      nextAction: 'refresh_case',
      expectedNextStep:
        'Refresh the case to load the current refund authorization. Do not issue a refund from stale details.',
    },
  ] as const;

  for (const fixture of fixtures) {
    const blockedLifecycle = lifecycle('transaction_confirmed', 30, fixture.nextAction);
    blockedLifecycle.managerQueue = {
      ...blockedLifecycle.managerQueue,
      bucket: 'needs_action',
      label: 'Action needed',
      nextAction: fixture.nextAction,
    };
    const blockedCase = {
      ...baseCase,
      hasMatchedNayaxTransaction: true,
      canPerformOfficialAction: fixture.canPerformOfficialAction,
      officialActionVersion: fixture.officialActionVersion,
      officialActionBlockReason: fixture.officialActionBlockReason,
      refundReadiness: {
        transactionConfirmed: true,
        canIssueCardRefund: true,
        blockReason: null,
      },
      lifecycle: blockedLifecycle,
    };
    const result = getRefundManagerState(blockedCase);

    assertEquals(result.id, 'transaction_confirmed', `${fixture.block} detail state`);
    assertEquals(result.label, 'Transaction confirmed', `${fixture.block} detail label`);
    assertEquals(
      blockedLifecycle.managerQueue.nextAction,
      fixture.nextAction,
      `${fixture.block} canonical action`
    );
    assertEquals(result.nextStep, fixture.expectedNextStep, `${fixture.block} exact guidance`);
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

Deno.test('canonical matching lifecycle preserves a completed no-match result', () => {
  const noMatchLifecycle = lifecycle('matching', 10);
  noMatchLifecycle.lookup.status = 'no_match';
  const result = getRefundManagerState({
    ...baseCase,
    correlationStatus: 'no_match',
    lifecycle: noMatchLifecycle,
  });

  assertEquals(result.id, 'match_attention', 'no-match state');
  assertEquals(result.label, 'No matching transaction', 'no-match label');
  assertEquals(
    result.nextStep,
    'Keep the case open. Do not select a transaction unless you can clearly identify it.',
    'no-match next step'
  );
});

Deno.test('canonical selection lifecycle preserves ambiguous comparison guidance', () => {
  const result = getRefundManagerState({
    ...baseCase,
    correlationStatus: 'multiple_candidates',
    lifecycle: lifecycle('needs_transaction_selection', 20, 'select_transaction'),
    nayaxLookupSummary: {
      lookupStatus: 'multiple_matches',
      recommendationState: 'ambiguous',
    },
  });

  assertEquals(result.id, 'match_attention', 'ambiguous state');
  assertEquals(result.label, 'More than one possible match', 'ambiguous label');
  assertEquals(
    result.nextStep,
    'Compare the details. Select one only if it is clearly the customer\'s purchase.',
    'ambiguous next step'
  );
});

Deno.test('canonical matching lifecycle keeps non-selectable results in review', () => {
  const reviewLifecycle = lifecycle('matching', 10, 'review_case');
  reviewLifecycle.lookup.status = 'manual_exception';
  const result = getRefundManagerState({
    ...baseCase,
    correlationStatus: 'manual_review',
    lifecycle: reviewLifecycle,
    nayaxLookupSummary: {
      lookupStatus: 'manual_exception',
      recommendationState: 'manual_exception',
    },
  });

  assertEquals(result.id, 'match_attention', 'manual-review state');
  assertEquals(result.label, 'Manager review needed', 'manual-review label');
  assertEquals(
    result.nextStep,
    'Review the case details before choosing the next step.',
    'manual-review next step'
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

Deno.test('retired remaining-value reason asks for a current availability refresh', () => {
  const result = getRefundManagerState({
    ...baseCase,
    hasMatchedNayaxTransaction: true,
    refundReadiness: {
      transactionConfirmed: true,
      canIssueCardRefund: false,
      blockReason: 'provider_remaining_value_unverified',
    },
  });

  assertEquals(result.id, 'refund_unavailable', 'guarded confirmed state');
  assertEquals(
    result.nextStep,
    'Refresh the case to load the current refund availability.',
    'manual portal fallback guidance'
  );
});

Deno.test('cash cases require both an amount and payout destination', () => {
  const missingDestination = getRefundManagerState({
    ...baseCase,
    paymentMethod: 'cash',
    paymentAmountCents: 800,
    correlationStatus: 'no_match',
    nayaxRecommendationState: null,
  });
  assertEquals(missingDestination.id, 'needs_information', 'cash destination gate');
  assertEquals(
    missingDestination.label,
    'Needs payout destination',
    'cash destination label'
  );

  const result = getRefundManagerState({
    ...baseCase,
    paymentMethod: 'cash',
    paymentAmountCents: 800,
    zellePaymentContact: 'cash-customer@example.test',
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


Deno.test('historical delivery failures do not replace current unpaid matching, selection or refund readiness', () => {
  for (const deliveryState of ['unknown','deferred','failed','bounced','complained'] as const) {
    for (const stage of ['matching','needs_transaction_selection','transaction_confirmed','waiting_on_customer'] as const) {
      const contract=lifecycle(stage,20);
      const current={...baseCase,lifecycle:contract};
      const result=getRefundManagerState({...current,customerDeliveryException:{state:deliveryState,messageType:'confirmation',recoveryOwner:'refund_operations',nextAction:'review_delivery_no_resend',customerMessageReplayAllowed:false,paymentReplayAllowed:false}});
      assertEquals(result.label,getRefundManagerState(current).label,`${deliveryState}/${stage}`);
      assertEquals(result.nextStep,getRefundManagerState(current).nextStep,`${deliveryState}/${stage} next step`);
    }
  }
});
Deno.test('canonical pending and uncertain payment truth stays ahead of unrelated delivery review',()=>{
 for(const stage of ['refund_initiated','confirming_with_nayax','needs_refund_operations','integrity_hold','denied'] as const){
  const current={...baseCase,lifecycle:lifecycle(stage,60)};
  const result=getRefundManagerState({...current,customerDeliveryException:{state:'bounced',messageType:'status_update',recoveryOwner:'refund_operations',nextAction:'review_delivery_no_resend',customerMessageReplayAllowed:false,paymentReplayAllowed:false}});
  assertEquals(result.id,getRefundManagerState(current).id,stage);
  assertEquals(result.nextStep,getRefundManagerState(current).nextStep,`${stage} next step`);
 }
});

Deno.test('explicit released-no-refund evidence permits review with delivery-only operations, never a payment hold',()=>{
 const contract=lifecycle('transaction_confirmed',30,'refund');
 contract.definitiveNoRefund=true;contract.safeRetryEligible=true;
 contract.operations={...contract.operations,required:true,safeStage:'released_no_refund',failureClass:'customer_delivery_exception'};
 const released={...baseCase,providerOutcome:'rejected' as const,lifecycle:contract};
 assertEquals(hasUnpaidRefundReview(released),true,'Delivery-only review does not revoke an explicit safe release');
 for(const failureClass of ['provider_outcome_unknown','integrity_hold',null]) {
  assertEquals(hasUnpaidRefundReview({...released,lifecycle:{...contract,operations:{...contract.operations,failureClass}}}),false,'A payment review is not a delivery-only release');
 }
 assertEquals(hasUnpaidRefundReview({...released,providerHold:true}),false,'Explicit current provider hold wins');
 assertEquals(hasUnpaidRefundReview({...released,lifecycle:{...contract,safeRetryEligible:false}}),false,'No safe retry means no review continuation');
});
