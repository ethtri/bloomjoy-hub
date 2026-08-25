export type RefundManagerStateId =
  | 'needs_information'
  | 'checking_nayax'
  | 'ready_for_review'
  | 'match_attention'
  | 'transaction_confirmed'
  | 'ready_to_refund'
  | 'refund_unavailable'
  | 'refunding'
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
      | 'lookup_failed';
    recommendationState?: 'high_confidence' | 'ambiguous' | 'no_safe_match' | 'manual_exception';
  } | null;
};

const state = (
  id: RefundManagerStateId,
  label: string,
  explanation: string,
  nextStep: string,
  tone: RefundManagerStateTone
): RefundManagerState => ({ id, label, explanation, nextStep, tone });

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
    case 'cap_exceeded':
      return 'This refund is over the current limit, or today\'s refund limit has been reached. Operations needs to review it.';
    case 'globally_paused':
      return 'Card refunds are temporarily paused. Operations needs to resume the service.';
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

  if (options.isRefunding) {
    return state(
      'refunding',
      'Refunding',
      'Bloomjoy is sending the approved card refund.',
      'Wait for the result. Do not try again while this is processing.',
      'info'
    );
  }

  if (refundCase.providerHold || refundCase.providerOutcome === 'unconfirmed') {
    if (options.canResolveHeldResult) {
      return state(
        'check_nayax_result',
        'Provider confirmation ready',
        'The payment provider has an authoritative result for this refund.',
        'Record the result below. This step cannot send another refund.',
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
  if (refundCase.status === 'completed' || refundCase.providerOutcome === 'succeeded') return 'Refunded';
  if (options.isRefunding) return 'Refunding';
  if (refundCase.providerHold || refundCase.providerOutcome === 'unconfirmed') return 'Result unclear';
  if (refundCase.providerOutcome === 'rejected') return 'Rejected';
  return 'Not issued';
};
