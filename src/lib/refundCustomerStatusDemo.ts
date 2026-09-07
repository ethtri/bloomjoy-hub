import {
  refundCustomerLifecycleStages,
  requireRefundCustomerLifecycle,
  type RefundCustomerLifecycle,
  type RefundCustomerLifecycleStage,
} from './refundCustomerStatus.ts';

type StageFacts = Pick<RefundCustomerLifecycle,
  'stageRank' | 'reasonCode' | 'publicCopyKey' | 'paymentState'>;

const stageFacts: Record<RefundCustomerLifecycleStage, StageFacts> = {
  matching: { stageRank: 10, reasonCode: 'lookup_in_progress', publicCopyKey: 'refund_request_received', paymentState: 'not_requested' },
  waiting_on_customer: { stageRank: 15, reasonCode: 'waiting_for_purchase_evidence', publicCopyKey: 'refund_waiting_on_customer', paymentState: 'not_requested' },
  needs_transaction_selection: { stageRank: 20, reasonCode: 'candidate_review_required', publicCopyKey: 'refund_reviewing_purchase', paymentState: 'not_requested' },
  transaction_confirmed: { stageRank: 30, reasonCode: 'exact_transaction_confirmed', publicCopyKey: 'refund_transaction_confirmed', paymentState: 'not_requested' },
  awaiting_payout: { stageRank: 30, reasonCode: 'external_payment_ready', publicCopyKey: 'refund_manual_payment_review', paymentState: 'external_payment_required' },
  refund_initiated: { stageRank: 40, reasonCode: 'payment_attempt_started', publicCopyKey: 'refund_initiated', paymentState: 'submitted_pending' },
  confirming_with_nayax: { stageRank: 50, reasonCode: 'provider_confirmation_pending', publicCopyKey: 'refund_confirming', paymentState: 'submitted_pending' },
  refund_confirmed: { stageRank: 70, reasonCode: 'customer_notification_pending', publicCopyKey: 'refund_confirmed_bank_pending', paymentState: 'confirmed' },
  customer_notified: { stageRank: 80, reasonCode: 'completion_sent', publicCopyKey: 'refund_customer_notified', paymentState: 'confirmed' },
  needs_refund_operations: { stageRank: 60, reasonCode: 'provider_outcome_unknown', publicCopyKey: 'refund_confirmation_in_progress', paymentState: 'outcome_unknown' },
  integrity_hold: { stageRank: 60, reasonCode: 'card_payment_state_without_attempt', publicCopyKey: 'refund_confirmation_in_progress', paymentState: 'integrity_unknown' },
  denied: { stageRank: 90, reasonCode: 'refund_denied', publicCopyKey: 'refund_denied', paymentState: 'not_issued' },
  unable_to_complete: { stageRank: 90, reasonCode: 'closed_without_denial', publicCopyKey: 'refund_unable_to_complete', paymentState: 'not_issued' },
};

/** Synthetic presentation only; validate against the same customer allowlist. */
export const buildRefundCustomerStatusDemo = (
  requestedStage: string | null,
  lastUpdatedAt = new Date().toISOString(),
): RefundCustomerLifecycle => {
  const stage = refundCustomerLifecycleStages.includes(requestedStage as RefundCustomerLifecycleStage)
    ? requestedStage as RefundCustomerLifecycleStage : 'matching';
  const waiting = stage === 'waiting_on_customer';
  const terminal = ['customer_notified', 'denied', 'unable_to_complete'].includes(stage);
  return requireRefundCustomerLifecycle({
    schemaVersion: 'refund_lifecycle_v2', version: 1, stage, ...stageFacts[stage],
    customerAction: {
      action: waiting || stage === 'denied' ? 'reply_in_existing_thread' : 'none',
      required: waiting, requestedFields: waiting ? ['incident_time'] : [], payloadRedacted: true,
    },
    messageState: { state: stage === 'customer_notified' ? 'delivered' : 'none', payloadRedacted: true },
    lastUpdatedAt, terminal, refreshAfterSeconds: terminal ? null : 5, payloadRedacted: true,
  });
};
