import type { RefundLifecycleContract } from './refundLifecycle.ts';

export type RefundManagerStateId =
  | 'needs_information'
  | 'waiting_on_customer'
  | 'checking_nayax'
  | 'ready_for_review'
  | 'match_attention'
  | 'transaction_confirmed'
  | 'ready_to_refund'
  | 'refund_unavailable'
  | 'refunding'
  | 'refund_confirmed'
  | 'needs_refund_operations'
  | 'awaiting_payout'
  | 'integrity_hold'
  | 'internal_test_archived'
  | 'completed'
  | 'refund_rejected'
  | 'check_nayax_result'
  | 'denied'
  | 'closed';

export type RefundManagerStateTone = 'neutral' | 'info' | 'warning' | 'success' | 'danger';

export type RefundManagerState = {
  id: RefundManagerStateId;
  label: string;
  explanation: string;
  nextStep: string;
  tone: RefundManagerStateTone;
};

type RefundManagerCaseFacts = {
  status:
    | 'draft'
    | 'submitted'
    | 'needs_review'
    | 'waiting_on_customer'
    | 'correlated'
    | 'approved'
    | 'denied'
    | 'card_refund_pending'
    | 'cash_zelle_pending'
    | 'completed'
    | 'closed';
  paymentMethod: 'card' | 'cash' | 'unknown';
  paymentAmountCents?: number | null;
  zellePaymentContact?: string | null;
  correlationStatus:
    | 'not_started'
    | 'matched'
    | 'no_match'
    | 'multiple_candidates'
    | 'needs_nayax'
    | 'nayax_not_configured'
    | 'manual_review';
  missingInformation?: boolean;
  providerHold?: boolean;
  providerOutcome?: 'not_attempted' | 'unconfirmed' | 'rejected' | 'succeeded';
  legacyStateReviewRequired?: boolean;
  hasMatchedNayaxTransaction?: boolean;
  refundReadiness?: {
    transactionConfirmed: boolean;
    canIssueCardRefund: boolean;
    blockReason: string | null;
  } | null;
  nayaxRecommendationState?: 'high_confidence' | 'ambiguous' | 'no_safe_match' | 'manual_exception' | null;
  nayaxLookupSummary?: {
    lookupStatus:
      | 'not_applicable'
      | 'not_started'
      | 'checking'
      | 'match_found'
      | 'multiple_matches'
      | 'no_match'
      | 'manual_exception'
      | 'setup_needed'
      | 'lookup_failed'
      | 'lookup_timed_out'
      | 'response_limited';
    recommendationState?: 'high_confidence' | 'ambiguous' | 'no_safe_match' | 'manual_exception';
  } | null;
  lifecycle?: RefundLifecycleContract | null;
  customerDeliveryException?: {
    state: 'unknown' | 'deferred' | 'failed' | 'bounced' | 'complained';
    messageType: string;
    recoveryOwner: 'refund_operations';
    nextAction: 'review_delivery_no_resend';
    customerMessageReplayAllowed: false;
    paymentReplayAllowed: false;
  } | null;
};

export const isDefinitiveNoRefundRetryReady = (
  refundCase: Pick<
    RefundManagerCaseFacts,
    'paymentMethod' | 'providerOutcome' | 'providerHold' | 'lifecycle'
  >
) =>
  refundCase.paymentMethod === 'card' &&
  refundCase.providerOutcome === 'rejected' &&
  refundCase.providerHold !== true &&
  refundCase.lifecycle?.stage === 'transaction_confirmed' &&
  refundCase.lifecycle.definitiveNoRefund === true &&
  refundCase.lifecycle.safeRetryEligible === true &&
  refundCase.lifecycle.operations.required === false &&
  refundCase.lifecycle.operations.safeStage === 'released_no_refund';

const state = (
  id: RefundManagerStateId,
  label: string,
  explanation: string,
  nextStep: string,
  tone: RefundManagerStateTone
): RefundManagerState => ({ id, label, explanation, nextStep, tone });

const customerActionFieldLabels: Record<string, string> = {
  location_or_machine: 'machine or location',
  incident_date: 'purchase date',
  incident_time: 'purchase time',
  payment_method: 'payment method',
  payment_interaction: 'card or wallet interaction',
  wallet_provider: 'wallet provider',
  amount: 'purchase amount',
  card_last4: 'physical-card last four',
  card_network: 'card type',
};

const waitingCustomerFieldSummary = (lifecycle: RefundLifecycleContract) =>
  (lifecycle.managerQueue.customerActionFields ?? [])
    .map((field) => customerActionFieldLabels[field] ?? field.replaceAll('_', ' '))
    .join(', ');

export const refundReadinessBlockMessage = (blockReason: string | null | undefined) => {
  switch (blockReason) {
    case 'unauthorized':
      return 'Only an assigned Machine Manager can issue this refund.';
    case 'already_refunded':
      return 'This transaction has already been refunded. Do not refund it again.';
    case 'reconciliation_hold':
      return 'A previous refund result still needs to be confirmed. Do not refund again.';
    case 'duplicate_transaction':
      return 'This transaction is linked to another refund case. Review the original case first.';
    case 'case_not_refundable':
      return 'This case is not currently eligible for a refund. Review the case status.';
    case 'machine_not_enabled':
      return 'Card refunds are not enabled for this machine. An administrator needs to enable them.';
    case 'globally_paused':
      return 'Card refunds are temporarily paused. Operations needs to resume the service.';
    case 'provider_remaining_value_unverified':
      return 'Direct card refunds are unavailable until Nayax remaining refundable value can be verified. Use the reviewed Nayax portal fallback.';
    case 'provider_unavailable':
      return 'The payment connection is temporarily unavailable. Try again later or contact Operations.';
    case 'transaction_not_confirmed':
      return 'Confirm the customer\'s transaction before issuing a refund.';
    case 'case_not_found':
      return 'This refund case could not be loaded. Refresh the page and try again.';
    default:
      return 'Refund availability could not be confirmed. Refresh the page or contact Operations.';
  }
};

export const getRefundManagerState = (
  refundCase: RefundManagerCaseFacts,
  options: { isRefunding?: boolean; canResolveHeldResult?: boolean } = {}
): RefundManagerState => {
  if (options.isRefunding) {
    return state(
      'refunding',
      'Refund initiated',
      'Bloomjoy accepted the refund action and is processing it.',
      'Wait for confirmation. Do not try the refund again.',
      'info'
    );
  }

  if (refundCase.customerDeliveryException) {
    const deliveryLabel = {
      unknown: 'Delivery is unconfirmed',
      deferred: 'The provider delayed delivery',
      failed: 'The provider could not deliver the message',
      bounced: 'The customer address bounced',
      complained: 'The provider recorded a complaint',
    }[refundCase.customerDeliveryException.state];
    return state(
      'needs_refund_operations',
      'Delivery needs review',
      `${deliveryLabel}. The refund and payment state have not been changed.`,
      'Refund Operations must review provider evidence and choose a safe disposition. Do not resend the message or retry a payment blindly.',
      'warning'
    );
  }

  if (refundCase.lifecycle?.stage === 'waiting_on_customer') {
    const fieldSummary = waitingCustomerFieldSummary(refundCase.lifecycle);
    return state(
      'waiting_on_customer',
      'Waiting on customer',
      fieldSummary
        ? `Bloomjoy sent a request for: ${fieldSummary}.`
        : 'Bloomjoy needs one specific purchase detail before matching can continue.',
      fieldSummary
        ? `Wait for the customer to reply with ${fieldSummary} in the existing email thread.`
        : 'Wait for the customer to reply to the existing email. Do not start another transaction check yet.',
      'warning'
    );
  }

  if (refundCase.paymentMethod === 'card' && refundCase.lifecycle) {
    const lifecycle = refundCase.lifecycle;
    switch (lifecycle.stage) {
      case 'waiting_on_customer': {
        const fieldSummary = waitingCustomerFieldSummary(lifecycle);
        return state(
          'waiting_on_customer',
          'Waiting on customer',
          fieldSummary
            ? `Bloomjoy sent a request for: ${fieldSummary}.`
            : 'Bloomjoy needs one specific purchase detail before matching can continue.',
          fieldSummary
            ? `Wait for the customer to reply with ${fieldSummary} in the existing email thread.`
            : 'Wait for the customer to reply to the existing email. Do not start another transaction check yet.',
          'warning'
        );
      }
      case 'matching':
        if (
          refundCase.nayaxLookupSummary?.lookupStatus === 'no_match' ||
          lifecycle.lookup.status === 'no_match'
        ) {
          return state(
            'match_attention',
            'No matching transaction',
            'No transaction matched the customer details closely enough.',
            'Keep the case open. Do not select a transaction unless you can clearly identify it.',
            'warning'
          );
        }
        if (
          refundCase.nayaxLookupSummary?.lookupStatus === 'setup_needed' ||
          lifecycle.lookup.status === 'setup_needed'
        ) {
          return state(
            'match_attention',
            'Transaction search unavailable',
            'Bloomjoy cannot check this machine\'s transactions right now.',
            'Keep the case open and try again later.',
            'warning'
          );
        }
        if (
          refundCase.nayaxLookupSummary?.lookupStatus === 'lookup_failed' ||
          lifecycle.lookup.status === 'lookup_failed'
        ) {
          return state(
            'match_attention',
            'Transaction check failed',
            'Bloomjoy could not finish checking transactions.',
            'Select Refresh transaction results. No refund has been issued.',
            'warning'
          );
        }
        if (
          refundCase.nayaxLookupSummary?.lookupStatus === 'manual_exception' ||
          refundCase.nayaxLookupSummary?.recommendationState === 'manual_exception' ||
          lifecycle.lookup.status === 'manual_exception'
        ) {
          return state(
            'match_attention',
            'Manager review needed',
            'Bloomjoy could not recommend one transaction.',
            'Review the case details before choosing the next step.',
            'warning'
          );
        }
        return lifecycle.lookup.safeRetryEligible
          ? state(
              'match_attention',
              'Transaction check needs attention',
              'Bloomjoy could not finish the read-only transaction check.',
              'Select Refresh transactions. No refund has been issued.',
              'warning'
            )
          : state(
              'checking_nayax',
              'Checking transactions',
              'Bloomjoy is comparing the customer details with recent machine transactions.',
              'Wait for the results. No refund has been issued.',
              'info'
            );
      case 'needs_transaction_selection':
        if (
          refundCase.nayaxLookupSummary?.lookupStatus === 'multiple_matches' ||
          refundCase.nayaxLookupSummary?.recommendationState === 'ambiguous'
        ) {
          return state(
            'match_attention',
            'More than one possible match',
            'Two or more transactions could be this purchase.',
            'Compare the details. Select one only if it is clearly the customer\'s purchase.',
            'warning'
          );
        }
        return state(
          'ready_for_review',
          'Review transactions',
          'The available transactions are ready to compare with the customer request.',
          'Select the exact transaction, then confirm it.',
          'info'
        );
      case 'transaction_confirmed':
        if (lifecycle.managerQueue.bucket === 'ready_to_pay') {
          return state(
            'ready_to_refund',
            'Ready to refund',
            'Transaction confirmed. Payment: Not issued.',
            'Select Refund once to issue the exact amount.',
            'success'
          );
        }
        if (lifecycle.managerQueue.nextAction === 'resolve_manager_access') {
          return state(
            'transaction_confirmed',
            'Transaction confirmed',
            'Payment: Not issued.',
            'Ask an administrator to restore your Machine Manager access before taking action.',
            'warning'
          );
        }
        if (lifecycle.managerQueue.nextAction === 'refresh_case') {
          return state(
            'transaction_confirmed',
            'Transaction confirmed',
            'Payment: Not issued.',
            'Refresh the case to load the current refund authorization. Do not issue a refund from stale details.',
            'warning'
          );
        }
        return state(
          refundCase.refundReadiness?.blockReason ? 'refund_unavailable' : 'transaction_confirmed',
          'Transaction confirmed',
          'Payment: Not issued.',
          refundCase.refundReadiness?.blockReason
            ? refundReadinessBlockMessage(refundCase.refundReadiness.blockReason)
            : 'Bloomjoy is checking current refund availability.',
          refundCase.refundReadiness?.blockReason ? 'warning' : 'info'
        );
      case 'awaiting_payout':
        return lifecycle.managerAction.action === 'mark_external_refund'
          ? state(
              'awaiting_payout',
              'Ready to reimburse',
              'The reimbursement destination and amount are recorded. Payment: Not issued.',
              'Send the exact reimbursement outside Bloomjoy Hub, then record the payment proof once.',
              'success'
            )
          : state(
              'awaiting_payout',
              'Payout details needed',
              'The reimbursement cannot be sent until the missing payout destination is recorded.',
              lifecycle.managerAction.action === 'request_payout_destination'
                ? 'Request only the payout destination in the existing customer thread.'
                : 'Resolve manager access before taking a payment action.',
              'warning'
            );
      case 'refund_initiated':
        return state(
          'refunding',
          'Refund initiated',
          'Bloomjoy recorded the one approved refund action.',
          'Wait for confirmation. Do not try the refund again.',
          'info'
        );
      case 'confirming_with_nayax':
        return state(
          'refunding',
          'Confirming refund',
          'Bloomjoy is confirming the final result with the payment provider.',
          'No action is needed. The refund will not be tried again while confirmation is pending.',
          'info'
        );
        case 'refund_confirmed':
        if (lifecycle.reasonCode === 'settlement_time_unknown') return state(
          'refund_confirmed',
          'Refund confirmed · accounting review',
          'Nayax confirms the full refund. Its settlement date is unknown, so no dated reporting adjustment has been applied.',
          'Refund Operations owns the accounting-date review. Do not retry payment or resend the customer completion notice.',
          'warning'
        );
        return state(
          'refund_confirmed',
          'Refund confirmed',
          'The payment provider confirmed the refund.',
          'Bloomjoy is recording the receipt and customer update. The bank may take time to post it.',
          'success'
        );
        case 'customer_notified':
          if (lifecycle.reasonCode === 'settlement_time_unknown') return state(
            'refund_confirmed', 'Refund confirmed · customer updated',
            'The existing customer notice is recorded for this claim. The settlement date remains unknown and no dated reporting adjustment has been applied.',
            'Refund Operations owns the accounting-date review. Do not retry payment or resend the customer notice.', 'warning'
          );
        return state(
          'completed',
          'Completed',
          'The refund is confirmed and the customer update is recorded.',
          'No payment action is needed.',
          'success'
        );
      case 'needs_refund_operations':
        return state(
          'needs_refund_operations',
          'Needs Refund Operations',
          'The final payment result needs a specialist review.',
          options.canResolveHeldResult
            ? 'Use the Refund Operations panel below to record authoritative evidence. Never retry the payment.'
            : 'Refund Operations owns the next step. No action is needed, and the payment will not be tried again.',
          'warning'
        );
      case 'integrity_hold':
        return state(
          'integrity_hold',
          'Lifecycle evidence needs review',
          'The case payment state does not have the durable attempt evidence required to prove what happened.',
          'Refund Operations must reconcile the existing evidence. Do not retry payment or contact the customer from a separate thread.',
          'danger'
        );
      case 'unable_to_complete':
        return state(
          'closed',
          'Unable to complete',
          'The case ended without a recorded refund or denial.',
          'Review the history only if new evidence arrives; do not describe this as denied.',
          'neutral'
        );
      case 'internal_test_archived':
        return state(
          'internal_test_archived',
          'Internal/test archived',
          'This record is excluded from customer contact, refund counts, and active manager work.',
          'No customer or payment action is allowed.',
          'neutral'
        );
      case 'denied':
        return state(
          'denied',
          'Denied',
          'The manager declined this refund request.',
          'Review the case history only if the customer follows up.',
          'neutral'
        );
    }
  }

  if (refundCase.status === 'completed') {
    return state(
      'completed',
      'Completed',
      'The refund is recorded as complete.',
      'No payment action is needed. Follow up only if the customer message needs attention.',
      'success'
    );
  }

  if (refundCase.status === 'denied') {
    return state(
      'denied',
      'Denied',
      'The manager declined this refund request.',
      'Review the case history only if the customer follows up.',
      'neutral'
    );
  }

  if (refundCase.status === 'closed') {
    return state(
      'closed',
      'Closed',
      'This case is closed and no refund was recorded.',
      'Review the case history only if the customer follows up.',
      'neutral'
    );
  }

  if (refundCase.providerHold || refundCase.providerOutcome === 'unconfirmed') {
    if (options.canResolveHeldResult) {
      return state(
        'check_nayax_result',
        'Evidence can be recorded',
        'Bloomjoy still does not know whether this refund completed.',
        'Record authoritative Nayax evidence below. This step cannot send another refund.',
        'info'
      );
    }
    return state(
      'check_nayax_result',
      'Refund result is being checked',
      'The payment provider has not confirmed the final result yet.',
      'Do not refund again. Payment support owns the next step.',
      'neutral'
    );
  }

  if (refundCase.providerOutcome === 'rejected') {
    return state(
      'refund_rejected',
      'Refund rejected',
      'The payment service rejected the refund, so no refund was confirmed.',
      'Keep the case open and ask payment support to review the rejection.',
      'danger'
    );
  }

  if (refundCase.paymentMethod === 'cash') {
    if (typeof refundCase.paymentAmountCents !== 'number' || refundCase.paymentAmountCents <= 0) {
      return state(
        'needs_information',
        'Needs payment amount',
        'The customer payment amount is missing.',
        'Ask the customer for the amount paid before recording an external refund.',
        'warning'
      );
    }

    if (!refundCase.zellePaymentContact?.trim()) {
      return state(
        'needs_information',
        'Needs payout destination',
        'The customer payout destination is missing.',
        'Request only the payout destination in the existing customer thread.',
        'warning'
      );
    }

    return state(
      'ready_to_refund',
      'Ready to mark refunded',
      'The manager sends this cash reimbursement outside Bloomjoy Hub.',
      'After sending it through Zelle or Venmo, select Mark refunded.',
      'success'
    );
  }

  const transactionConfirmed =
    refundCase.refundReadiness?.transactionConfirmed === true ||
    refundCase.hasMatchedNayaxTransaction === true;
  if (transactionConfirmed) {
    if (refundCase.refundReadiness?.canIssueCardRefund === true) {
      return state(
        'ready_to_refund',
        'Ready to refund',
        'Transaction confirmed. Payment: Not issued.',
        'Select Refund to issue the card refund.',
        'success'
      );
    }
    if (refundCase.refundReadiness?.blockReason) {
      return state(
        'refund_unavailable',
        'Transaction confirmed',
        'Payment: Not issued.',
        refundReadinessBlockMessage(refundCase.refundReadiness.blockReason),
        'warning'
      );
    }
    return state(
      'transaction_confirmed',
      'Transaction confirmed',
      'Payment: Not issued.',
      'Checking whether this refund can be issued now.',
      'info'
    );
  }

  if (
    refundCase.status === 'draft' ||
    refundCase.status === 'waiting_on_customer' ||
    refundCase.missingInformation === true
  ) {
    return state(
      'needs_information',
      'Needs information',
      'Bloomjoy is waiting for a specific purchase detail from the customer.',
      'Wait for the reply, or review the original thread if the customer message needs attention.',
      'warning'
    );
  }

  const recommendationState =
    refundCase.nayaxLookupSummary?.recommendationState ?? refundCase.nayaxRecommendationState;
  const lookupStatus = refundCase.nayaxLookupSummary?.lookupStatus;
  if (
    lookupStatus === 'checking' ||
    (
      refundCase.correlationStatus === 'needs_nayax' &&
      (!lookupStatus || lookupStatus === 'not_started')
    )
  ) {
    return state(
      'checking_nayax',
      'Checking',
      'Bloomjoy is comparing the customer details with recent machine transactions.',
      'Wait for the result.',
      'info'
    );
  }

  if (
    refundCase.legacyStateReviewRequired ||
    recommendationState === 'ambiguous' ||
    recommendationState === 'no_safe_match' ||
    recommendationState === 'manual_exception' ||
    refundCase.correlationStatus === 'no_match' ||
    refundCase.correlationStatus === 'multiple_candidates' ||
    refundCase.correlationStatus === 'nayax_not_configured' ||
    refundCase.correlationStatus === 'manual_review' ||
    lookupStatus === 'multiple_matches' ||
    lookupStatus === 'no_match' ||
    lookupStatus === 'manual_exception' ||
    lookupStatus === 'setup_needed' ||
    lookupStatus === 'lookup_failed'
  ) {
    if (lookupStatus === 'lookup_failed') {
      return state(
        'match_attention',
        'Transaction check failed',
        'Bloomjoy could not finish checking transactions.',
        'Select Refresh transaction results. No refund has been issued.',
        'warning'
      );
    }

    if (lookupStatus === 'setup_needed' || refundCase.correlationStatus === 'nayax_not_configured') {
      return state(
        'match_attention',
        'Transaction search unavailable',
        'Bloomjoy cannot check this machine\'s transactions right now.',
        'Keep the case open and try again later.',
        'warning'
      );
    }

    if (
      recommendationState === 'ambiguous' ||
      refundCase.correlationStatus === 'multiple_candidates' ||
      lookupStatus === 'multiple_matches'
    ) {
      return state(
        'match_attention',
        'More than one possible match',
        'Two or more transactions could be this purchase.',
        'Compare the details. Select one only if it is clearly the customer\'s purchase.',
        'warning'
      );
    }

    if (
      recommendationState === 'no_safe_match' ||
      refundCase.correlationStatus === 'no_match' ||
      lookupStatus === 'no_match'
    ) {
      return state(
        'match_attention',
        'No matching transaction',
        'No transaction matched the customer details closely enough.',
        'Keep the case open. Do not select a transaction unless you can clearly identify it.',
        'warning'
      );
    }

    return state(
      'match_attention',
      'Manager review needed',
      'Bloomjoy could not recommend one transaction.',
      'Review the case details before choosing the next step.',
      'warning'
    );
  }

  return state(
    'ready_for_review',
    'Ready for review',
    'The customer request and likely transaction are ready for your decision.',
    refundCase.paymentMethod === 'card'
      ? 'Confirm the transaction and amount, then choose Refund or deny the request.'
      : 'Review the case details and choose the next step.',
    'success'
  );
};

export const getRefundPaymentStateLabel = (
  refundCase: RefundManagerCaseFacts,
  options: { isRefunding?: boolean } = {}
) => {
  if (refundCase.paymentMethod === 'card' && refundCase.lifecycle) {
    if (['refund_confirmed', 'customer_notified'].includes(refundCase.lifecycle.stage)) {
      return 'Refunded';
    }
    if (['refund_initiated', 'confirming_with_nayax'].includes(refundCase.lifecycle.stage)) {
      return 'In progress';
    }
    if (refundCase.lifecycle.stage === 'needs_refund_operations') {
      return 'Being confirmed';
    }
    if (refundCase.lifecycle.stage === 'integrity_hold') return 'Evidence required';
    if (refundCase.lifecycle.stage === 'internal_test_archived') return 'Suppressed';
    return 'Not issued';
  }
  if (refundCase.status === 'completed' || refundCase.providerOutcome === 'succeeded') return 'Refunded';
  if (options.isRefunding) return 'Refunding';
  if (refundCase.providerHold || refundCase.providerOutcome === 'unconfirmed') return 'Result unclear';
  if (refundCase.providerOutcome === 'rejected') return 'Rejected';
  return 'Not issued';
};
