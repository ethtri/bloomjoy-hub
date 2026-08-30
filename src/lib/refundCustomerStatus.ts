export const REFUND_CUSTOMER_LIFECYCLE_SCHEMA_VERSION = 'refund_lifecycle_v1' as const;

export const refundCustomerLifecycleStages = [
  'matching',
  'waiting_on_customer',
  'needs_transaction_selection',
  'transaction_confirmed',
  'refund_initiated',
  'confirming_with_nayax',
  'refund_confirmed',
  'customer_notified',
  'needs_refund_operations',
  'denied',
] as const;

export type RefundCustomerLifecycleStage = typeof refundCustomerLifecycleStages[number];

export type RefundCustomerLifecycle = {
  schemaVersion: typeof REFUND_CUSTOMER_LIFECYCLE_SCHEMA_VERSION;
  stage: RefundCustomerLifecycleStage;
  stageRank: number;
  lastUpdatedAt: string;
  publicCopyKey: string;
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

export const requireRefundCustomerLifecycle = (value: unknown): RefundCustomerLifecycle => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('This secure refund status link is not available.');
  }
  const lifecycle = value as Record<string, unknown>;
  if (
    lifecycle.schemaVersion !== REFUND_CUSTOMER_LIFECYCLE_SCHEMA_VERSION ||
    lifecycle.payloadRedacted !== true ||
    typeof lifecycle.stage !== 'string' ||
    !stageSet.has(lifecycle.stage) ||
    typeof lifecycle.stageRank !== 'number' ||
    !Number.isFinite(lifecycle.stageRank) ||
    typeof lifecycle.lastUpdatedAt !== 'string' ||
    Number.isNaN(Date.parse(lifecycle.lastUpdatedAt)) ||
    typeof lifecycle.publicCopyKey !== 'string' ||
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
  return lifecycle as RefundCustomerLifecycle;
};

export const getRefundCustomerStatusCopy = (
  lifecycle: RefundCustomerLifecycle,
): RefundCustomerStatusCopy => {
  switch (lifecycle.stage) {
    case 'waiting_on_customer':
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
    case 'refund_initiated':
      return {
        title: 'Refund initiated',
        detail: 'Bloomjoy sent the refund request for the confirmed purchase.',
        nextExpectation: 'We are confirming the result. Please do not submit another request.',
        milestone: 'initiated',
      };
    case 'confirming_with_nayax':
    case 'needs_refund_operations':
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
