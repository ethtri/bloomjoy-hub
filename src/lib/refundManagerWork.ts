export const REFUND_MANAGER_WORK_SCHEMA_VERSION = 'refund_manager_work_v1' as const;
export const refundManagerWorkBuckets = ['needs_action', 'ready_to_pay', 'in_progress', 'provider_hold', 'waiting_on_customer', 'completed'] as const;
export type RefundManagerWorkBucket = typeof refundManagerWorkBuckets[number];
export type RefundManagerWorkItem = {
  caseId: string; publicReference: string; amountCents: number | null; currencyCode: string | null;
  machineLabel: string; locationName: string; ageMinutes: number; queueBucket: RefundManagerWorkBucket;
  queueLabel: string; actionCode: string; actionOwner: string; lifecycleActor: string; whatChanged: string;
  noticeReason: 'customer_reply' | 'manager_reminder' | null; attentionVersion: number; digestEligible: boolean;
  urgentNoticeState: 'none' | 'immediate_sent' | 'immediate_unresolved'; payloadRedacted: true;
};
export type RefundManagerWorkProjection = {
  schemaVersion: typeof REFUND_MANAGER_WORK_SCHEMA_VERSION; observedAt: string;
  bucketCounts: Record<RefundManagerWorkBucket, number>;
  digestCounts: { needsDecision: number; newInformation: number; aging: number; exceptionsBeingHandled: number };
  oldestActionableAgeMinutes: number | null; recentMaterialChangeCount: number; items: RefundManagerWorkItem[];
  metrics: { emailsSentToday: number; digestEligibleCount: number; duplicatesSuppressedToday: number; oldestActionableAgeMinutes: number | null; oldestDecisionAgeMinutes: number | null; payloadRedacted: true };
  payloadRedacted: true;
};

const objectValue = (value: unknown) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Unsupported refund manager work response.');
  return value as Record<string, unknown>;
};
const countValue = (value: unknown) => {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error('Unsupported refund manager work response.');
  return value as number;
};
const stringValue = (value: unknown) => {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Unsupported refund manager work response.');
  return value;
};
export const parseRefundManagerWorkProjection = (value: unknown): RefundManagerWorkProjection => {
  const root = objectValue(value);
  if (root.schemaVersion !== REFUND_MANAGER_WORK_SCHEMA_VERSION || root.payloadRedacted !== true || !Array.isArray(root.items)) throw new Error('Unsupported refund manager work response.');
  const buckets = objectValue(root.bucketCounts); const digest = objectValue(root.digestCounts); const metrics = objectValue(root.metrics);
  const bucketCounts = Object.fromEntries(refundManagerWorkBuckets.map((bucket) => [bucket, countValue(buckets[bucket])])) as Record<RefundManagerWorkBucket, number>;
  const items = root.items.map((raw): RefundManagerWorkItem => {
    const item = objectValue(raw);
    if (!refundManagerWorkBuckets.includes(item.queueBucket as RefundManagerWorkBucket) || item.payloadRedacted !== true || typeof item.digestEligible !== 'boolean') throw new Error('Unsupported refund manager work response.');
    if (![null, 'customer_reply', 'manager_reminder'].includes(item.noticeReason as string | null) || !['none', 'immediate_sent', 'immediate_unresolved'].includes(item.urgentNoticeState as string)) throw new Error('Unsupported refund manager work response.');
    return { caseId: stringValue(item.caseId), publicReference: stringValue(item.publicReference), amountCents: item.amountCents === null ? null : countValue(item.amountCents), currencyCode: item.currencyCode === null ? null : stringValue(item.currencyCode), machineLabel: stringValue(item.machineLabel), locationName: stringValue(item.locationName), ageMinutes: countValue(item.ageMinutes), queueBucket: item.queueBucket as RefundManagerWorkBucket, queueLabel: stringValue(item.queueLabel), actionCode: stringValue(item.actionCode), actionOwner: stringValue(item.actionOwner), lifecycleActor: stringValue(item.lifecycleActor), whatChanged: stringValue(item.whatChanged), noticeReason: item.noticeReason as RefundManagerWorkItem['noticeReason'], attentionVersion: countValue(item.attentionVersion), digestEligible: item.digestEligible, urgentNoticeState: item.urgentNoticeState as RefundManagerWorkItem['urgentNoticeState'], payloadRedacted: true };
  });
  return { schemaVersion: REFUND_MANAGER_WORK_SCHEMA_VERSION, observedAt: stringValue(root.observedAt), bucketCounts,
    digestCounts: { needsDecision: countValue(digest.needsDecision), newInformation: countValue(digest.newInformation), aging: countValue(digest.aging), exceptionsBeingHandled: countValue(digest.exceptionsBeingHandled) },
    oldestActionableAgeMinutes: root.oldestActionableAgeMinutes === null ? null : countValue(root.oldestActionableAgeMinutes), recentMaterialChangeCount: countValue(root.recentMaterialChangeCount), items,
    metrics: { emailsSentToday: countValue(metrics.emailsSentToday), digestEligibleCount: countValue(metrics.digestEligibleCount), duplicatesSuppressedToday: countValue(metrics.duplicatesSuppressedToday), oldestActionableAgeMinutes: metrics.oldestActionableAgeMinutes === null ? null : countValue(metrics.oldestActionableAgeMinutes), oldestDecisionAgeMinutes: metrics.oldestDecisionAgeMinutes === null ? null : countValue(metrics.oldestDecisionAgeMinutes), payloadRedacted: metrics.payloadRedacted === true ? true : (() => { throw new Error('Unsupported refund manager work response.'); })() }, payloadRedacted: true };
};

export const refundManagerNextActionCopy = (actionCode: string) => ({
  refund: 'Review the confirmed transaction and choose the official refund action in the portal.',
  mark_external_refund: 'Complete the approved external payment workflow, then record completion in the portal.',
  select_transaction: 'Review the current candidates and select the supported transaction in the portal.',
  retry_read_only_lookup: "Review the case, then use the portal's read-only lookup retry if it is still offered.",
  review_inbound_case_link: 'Review the proposed inbound-message case link in the portal.',
  review_delivery_no_resend: 'Review delivery evidence in the portal. Do not resend or repeat payment from this email.',
  recover_customer_delivery: 'Review customer delivery evidence in the portal before choosing a recovery step.',
  refund_operations: 'Refund Operations should review the provider evidence in the portal. Do not retry payment.',
  reconcile_lifecycle_integrity: 'Refund Operations should reconcile the durable case evidence. Do not retry payment.',
  request_payout_destination: 'Review the case and request the missing payout destination through the approved portal flow.',
  resolve_manager_access: 'Resolve the current Machine Manager assignment before any official refund action.',
  wait_for_customer_reply: 'No manager action is due now; review the current waiting state in the portal.',
  wait_for_customer_notification: 'No payment action is due; review the pending customer notification state in the portal.',
  wait: 'Review the current state in the portal; do not repeat an in-progress action.',
  none: 'Review the current case record in the portal; no official refund action is due.',
} as Record<string, string>)[actionCode] ?? 'Open the case and follow the current server-owned action shown in the portal.';
