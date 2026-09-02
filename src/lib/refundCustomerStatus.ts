export const REFUND_CUSTOMER_LIFECYCLE_SCHEMA_VERSION = 'refund_lifecycle_v2' as const;

export const refundCustomerLifecycleStages = [
  'matching',
  'waiting_on_customer',
  'needs_transaction_selection',
  'transaction_confirmed',
  'awaiting_payout',
  'refund_initiated',
  'confirming_with_nayax',
  'refund_confirmed',
  'customer_notified',
  'needs_refund_operations',
  'integrity_hold',
  'denied',
  'unable_to_complete',
] as const;

export type RefundCustomerLifecycleStage = typeof refundCustomerLifecycleStages[number];

export const refundCustomerActions = ['none', 'reply_in_existing_thread'] as const;
export type RefundCustomerAction = typeof refundCustomerActions[number];
export const refundCustomerPaymentStates = [
  'integrity_unknown',
  'confirmed',
  'outcome_unknown',
  'submitted_pending',
  'external_payment_required',
  'not_issued',
  'not_requested',
] as const;
export type RefundCustomerPaymentState = typeof refundCustomerPaymentStates[number];
export const refundCustomerMessageStates = [
  'none',
  'pending',
  'delivered',
  'deferred',
  'failed',
  'bounced',
  'complained',
  'skipped',
  'delivery_unconfirmed',
  'sent',
] as const;
export type RefundCustomerMessageState = typeof refundCustomerMessageStates[number];
export const refundCustomerReasonCodes = [
  'card_payment_state_without_attempt',
  'refund_denied',
  'closed_without_denial',
  'completion_delivery_unconfirmed',
  'completion_sent',
  'completion_delivery_failed',
  'customer_notification_pending',
  'interrupted_before_transport',
  'interrupted_after_transport',
  'provider_timeout',
  'provider_network',
  'provider_rejected',
  'provider_unknown',
  'provider_http_error',
  'provider_response_invalid',
  'provider_semantic_mismatch',
  'contract_mismatch',
  'settlement_failure',
  'provider_outcome_unknown',
  'waiting_for_payout_destination',
  'waiting_for_purchase_evidence',
  'payment_attempt_started',
  'provider_confirmation_pending',
  'payout_destination_missing',
  'external_payment_ready',
  'exact_transaction_confirmed',
  'candidate_review_required',
  'internal_mapping_required',
  'lookup_failed',
  'lookup_timed_out',
  'lookup_response_limited',
  'no_safe_match',
  'lookup_in_progress',
] as const;
export type RefundCustomerReasonCode = typeof refundCustomerReasonCodes[number];
export const refundCustomerPublicCopyKeys = [
  'refund_request_received',
  'refund_waiting_on_customer',
  'refund_reviewing_purchase',
  'refund_transaction_confirmed',
  'refund_manual_payment_review',
  'refund_initiated',
  'refund_confirming',
  'refund_confirmation_in_progress',
  'refund_confirmed_bank_pending',
  'refund_customer_notified',
  'refund_denied',
  'refund_unable_to_complete',
] as const;
export type RefundCustomerPublicCopyKey = typeof refundCustomerPublicCopyKeys[number];
export const refundCustomerRequestedFields = [
  'location_or_machine',
  'incident_date',
  'incident_time',
  'payment_method',
  'payment_interaction',
  'wallet_provider',
  'amount',
  'card_last4',
  'card_network',
  'zelle_payment_contact',
] as const;
export type RefundCustomerRequestedField = typeof refundCustomerRequestedFields[number];

export type RefundCustomerLifecycle = {
  schemaVersion: typeof REFUND_CUSTOMER_LIFECYCLE_SCHEMA_VERSION;
  version: number;
  stage: RefundCustomerLifecycleStage;
  stageRank: number;
  reasonCode: RefundCustomerReasonCode;
  customerAction: {
    action: RefundCustomerAction;
    required: boolean;
    requestedFields: RefundCustomerRequestedField[];
    payloadRedacted: true;
  };
  paymentState: RefundCustomerPaymentState;
  messageState: {
    state: RefundCustomerMessageState;
    payloadRedacted: true;
  };
  lastUpdatedAt: string;
  publicCopyKey: RefundCustomerPublicCopyKey;
  terminal: boolean;
  refreshAfterSeconds: number | null;
  payloadRedacted: true;
};

export type RefundCustomerStatusCopy = {
  title: string;
  detail: string;
  nextExpectation: string;
  milestone: 'received' | 'reviewing' | 'initiated' | 'confirming' | 'confirmed' | 'denied';
};

const stageSet = new Set<string>(refundCustomerLifecycleStages);
const actionSet = new Set<string>(refundCustomerActions);
const paymentStateSet = new Set<string>(refundCustomerPaymentStates);
const messageStateSet = new Set<string>(refundCustomerMessageStates);
const reasonCodeSet = new Set<string>(refundCustomerReasonCodes);
const publicCopyKeySet = new Set<string>(refundCustomerPublicCopyKeys);
const requestedFieldSet = new Set<string>(refundCustomerRequestedFields);
const exactObjectKeys = (value: Record<string, unknown>, expected: string[]) => {
  const actual = Object.keys(value).sort();
  return actual.length === expected.length &&
    actual.every((key, index) => key === expected[index]);
};

export const requireRefundCustomerLifecycle = (value: unknown): RefundCustomerLifecycle => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('This secure refund status link is not available.');
  }
  const lifecycle = value as Record<string, unknown>;
  const customerAction = lifecycle.customerAction &&
      typeof lifecycle.customerAction === 'object' &&
      !Array.isArray(lifecycle.customerAction)
    ? lifecycle.customerAction as Record<string, unknown>
    : null;
  const messageState = lifecycle.messageState &&
      typeof lifecycle.messageState === 'object' &&
      !Array.isArray(lifecycle.messageState)
    ? lifecycle.messageState as Record<string, unknown>
    : null;
  const requestedFields = customerAction && Array.isArray(customerAction.requestedFields)
    ? customerAction.requestedFields
    : null;
  const requestedFieldStrings = requestedFields?.every((field) =>
    typeof field === 'string' && requestedFieldSet.has(field)
  ) === true
    ? requestedFields as RefundCustomerRequestedField[]
    : null;
  if (
    lifecycle.schemaVersion !== REFUND_CUSTOMER_LIFECYCLE_SCHEMA_VERSION ||
    lifecycle.payloadRedacted !== true ||
    typeof lifecycle.version !== 'number' ||
    !Number.isSafeInteger(lifecycle.version) ||
    lifecycle.version < 1 ||
    typeof lifecycle.stage !== 'string' ||
    !stageSet.has(lifecycle.stage) ||
    typeof lifecycle.stageRank !== 'number' ||
    !Number.isFinite(lifecycle.stageRank) ||
    typeof lifecycle.reasonCode !== 'string' ||
    !reasonCodeSet.has(lifecycle.reasonCode) ||
    !customerAction ||
    !exactObjectKeys(customerAction, ['action', 'payloadRedacted', 'requestedFields', 'required']) ||
    typeof customerAction.action !== 'string' ||
    !actionSet.has(customerAction.action) ||
    typeof customerAction.required !== 'boolean' ||
    customerAction.payloadRedacted !== true ||
    !requestedFieldStrings ||
    requestedFieldStrings.length > refundCustomerRequestedFields.length ||
    new Set(requestedFieldStrings).size !== requestedFieldStrings.length ||
    !messageState ||
    !exactObjectKeys(messageState, ['payloadRedacted', 'state']) ||
    typeof messageState.state !== 'string' ||
    !messageStateSet.has(messageState.state) ||
    messageState.payloadRedacted !== true ||
    typeof lifecycle.paymentState !== 'string' ||
    !paymentStateSet.has(lifecycle.paymentState) ||
    typeof lifecycle.lastUpdatedAt !== 'string' ||
    Number.isNaN(Date.parse(lifecycle.lastUpdatedAt)) ||
    typeof lifecycle.publicCopyKey !== 'string' ||
    !publicCopyKeySet.has(lifecycle.publicCopyKey) ||
    typeof lifecycle.terminal !== 'boolean' ||
    !(
      lifecycle.refreshAfterSeconds === null ||
      (typeof lifecycle.refreshAfterSeconds === 'number' &&
        Number.isFinite(lifecycle.refreshAfterSeconds) &&
        lifecycle.refreshAfterSeconds >= 1 &&
        lifecycle.refreshAfterSeconds <= 15)
    )
  ) {
    throw new Error('This secure refund status link is not available.');
  }
  return {
    schemaVersion: REFUND_CUSTOMER_LIFECYCLE_SCHEMA_VERSION,
    version: lifecycle.version,
    stage: lifecycle.stage as RefundCustomerLifecycleStage,
    stageRank: lifecycle.stageRank,
    reasonCode: lifecycle.reasonCode as RefundCustomerReasonCode,
    customerAction: {
      action: customerAction.action as RefundCustomerAction,
      required: customerAction.required,
      requestedFields: [...requestedFieldStrings],
      payloadRedacted: true,
    },
    paymentState: lifecycle.paymentState as RefundCustomerPaymentState,
    messageState: {
      state: messageState.state as RefundCustomerMessageState,
      payloadRedacted: true,
    },
    lastUpdatedAt: lifecycle.lastUpdatedAt,
    publicCopyKey: lifecycle.publicCopyKey as RefundCustomerPublicCopyKey,
    terminal: lifecycle.terminal,
    refreshAfterSeconds: lifecycle.refreshAfterSeconds as number | null,
    payloadRedacted: true,
  };
};

export const getRefundCustomerStatusCopy = (
  lifecycle: RefundCustomerLifecycle,
): RefundCustomerStatusCopy => {
  switch (lifecycle.stage) {
    case 'waiting_on_customer':
      if (lifecycle.customerAction.requestedFields.includes('zelle_payment_contact')) {
        return {
          title: 'Waiting for your payment details',
          detail: 'We need the email address or phone number connected to Zelle for your approved reimbursement.',
          nextExpectation: 'Please reply to the existing Bloomjoy email with only that Zelle detail. You do not need to submit another form.',
          milestone: 'received',
        };
      }
      return {
        title: 'Waiting for your reply',
        detail: 'We need one more purchase detail before we can finish matching your transaction.',
        nextExpectation: 'Please reply to the existing Bloomjoy email. You do not need to submit another form.',
        milestone: 'received',
      };
    case 'needs_transaction_selection':
    case 'transaction_confirmed':
      return {
        title: 'Reviewing your purchase',
        detail: 'We are comparing your request with the machine’s payment records.',
        nextExpectation: 'A Bloomjoy manager will review the matching purchase. No action is needed from you.',
        milestone: 'reviewing',
      };
    case 'awaiting_payout':
      return {
        title: lifecycle.reasonCode === 'payout_destination_missing'
          ? 'Waiting for payment details'
          : 'Preparing your reimbursement',
        detail: lifecycle.reasonCode === 'payout_destination_missing'
          ? 'We need one approved payment destination before we can send the reimbursement.'
          : 'A Bloomjoy manager is preparing the approved reimbursement.',
        nextExpectation: lifecycle.reasonCode === 'payout_destination_missing'
          ? 'Please reply to the existing Bloomjoy email. You do not need to submit another form.'
          : 'No action is needed from you.',
        milestone: 'reviewing',
      };
    case 'refund_initiated':
      return {
        title: 'Refund initiated',
        detail: 'Bloomjoy sent the refund request for the confirmed purchase.',
        nextExpectation: 'We are confirming the result. Please do not submit another request.',
        milestone: 'initiated',
      };
    case 'confirming_with_nayax':
    case 'needs_refund_operations':
    case 'integrity_hold':
      return {
        title: 'Confirming the refund',
        detail: 'Bloomjoy is confirming the refund result safely.',
        nextExpectation: 'You do not need to retry or contact the payment provider. We own the next check.',
        milestone: 'confirming',
      };
    case 'refund_confirmed':
    case 'customer_notified':
      return {
        title: 'Refund confirmed',
        detail: 'Nayax has approved your refund. Your bank may take up to 4 business days to show it on your account.',
        nextExpectation: 'If the credit is not visible after 4 business days, reply to your Bloomjoy email for help.',
        milestone: 'confirmed',
      };
    case 'denied':
      return {
        title: 'Review complete',
        detail: 'We could not approve this refund request.',
        nextExpectation: 'Please reply to your Bloomjoy email if we missed or misunderstood something. We will keep the same request open for review.',
        milestone: 'denied',
      };
    case 'unable_to_complete':
      return {
        title: 'We could not complete the refund',
        detail: 'The request was reviewed, but Bloomjoy could not complete a payment from the available evidence.',
        nextExpectation: 'Reply to your existing Bloomjoy email if you have new information. Do not submit a second form.',
        milestone: 'denied',
      };
    case 'matching':
    default:
      return {
        title: 'Request received',
        detail: 'We received your refund request and are checking the purchase details.',
        nextExpectation: 'We will compare your details with the machine’s payment records. No second form is needed.',
        milestone: 'received',
      };
  }
};

export const getRefundCustomerRefreshMs = (lifecycle: RefundCustomerLifecycle) => {
  if (lifecycle.terminal) return false as const;
  return Math.min(15_000, Math.max(1_000, (lifecycle.refreshAfterSeconds ?? 5) * 1_000));
};
