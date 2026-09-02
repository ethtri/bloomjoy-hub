import type { RefundLifecycleContract, RefundLifecycleStage } from './refundLifecycle.ts';

export const refundLifecycleStageLabels: Record<RefundLifecycleStage, string> = {
  matching: 'Matching the purchase',
  waiting_on_customer: 'Waiting for customer reply',
  needs_transaction_selection: 'Waiting for transaction confirmation',
  transaction_confirmed: 'Transaction confirmed',
  awaiting_payout: 'Preparing the reimbursement',
  refund_initiated: 'Refund initiated',
  confirming_with_nayax: 'Confirming the refund',
  refund_confirmed: 'Refund confirmed',
  customer_notified: 'Customer updated',
  needs_refund_operations: 'Refund Operations review',
  integrity_hold: 'Payment status needs review',
  denied: 'Request denied',
  unable_to_complete: 'Unable to complete the refund',
  internal_test_archived: 'Internal/test archived',
};

const nonPaymentProgressNotes: Partial<Record<RefundLifecycleStage, string>> = {
  denied: 'No refund was issued.',
  unable_to_complete: 'Closed without a completed refund.',
  internal_test_archived: 'Customer contact and refund actions are suppressed.',
  integrity_hold: 'Refund Operations must reconcile the payment evidence. Do not retry the refund.',
};

export const getRefundLifecycleProgressPresentation = (
  lifecycle: Pick<RefundLifecycleContract, 'stage'>,
) => ({
  label: refundLifecycleStageLabels[lifecycle.stage],
  note: nonPaymentProgressNotes[lifecycle.stage] ?? null,
  showMilestones: !nonPaymentProgressNotes[lifecycle.stage],
});
