export type RefundManagerStateId =
  | 'needs_information'
  | 'checking_nayax'
  | 'ready_for_review'
  | 'match_attention'
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

export const getRefundManagerState = (
  refundCase: RefundManagerCaseFacts,
  options: { isRefunding?: boolean } = {}
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
      'This legacy case is closed without claiming a new payment result.',
      'Review the case history only if the customer follows up.',
      'neutral'
    );
  }

  if (options.isRefunding) {
    return state(
      'refunding',
      'Refunding',
      'Bloomjoy is sending the approved refund to Nayax.',
      'Wait for the result. Do not click again or open Nayax separately.',
      'info'
    );
  }

  if (refundCase.providerHold || refundCase.providerOutcome === 'unconfirmed') {
    return state(
      'check_nayax_result',
      'Check Nayax result',
      'Nayax has not confirmed whether the refund completed.',
      'Do not submit another refund. Use the payment-support review to confirm the result.',
      'warning'
    );
  }

  if (refundCase.providerOutcome === 'rejected') {
    return state(
      'refund_rejected',
      'Refund rejected',
      'Nayax rejected the refund, so no refund was confirmed.',
      'Keep the case open and ask payment support to review the rejection.',
      'danger'
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
      'Checking Nayax automatically',
      'Bloomjoy is checking recent transactions using the customer details.',
      'Wait for the recommendation. No manager click is needed.',
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
    return state(
      'match_attention',
      'Multiple or no safe match',
      'Bloomjoy cannot safely identify one transaction from the available evidence.',
      lookupStatus === 'lookup_failed'
        ? 'Use Refresh transaction results. Keep the case open until one safe match is available.'
        : 'Review the evidence or collect a missing detail. Do not guess a transaction.',
      'warning'
    );
  }

  return state(
    'ready_for_review',
    'Ready for review',
    'The customer request and transaction evidence are ready for a manager decision.',
    refundCase.paymentMethod === 'card'
      ? 'Confirm the transaction and amount, then choose Refund or deny the request.'
      : 'Review the evidence and complete the available manager action.',
    'success'
  );
};

export const getRefundPaymentStateLabel = (
  refundCase: RefundManagerCaseFacts,
  options: { isRefunding?: boolean } = {}
) => {
  if (refundCase.status === 'completed' || refundCase.providerOutcome === 'succeeded') return 'Refunded';
  if (options.isRefunding) return 'Refunding';
  if (refundCase.providerHold || refundCase.providerOutcome === 'unconfirmed') return 'Check required';
  if (refundCase.providerOutcome === 'rejected') return 'Rejected';
  return 'Not issued';
};
