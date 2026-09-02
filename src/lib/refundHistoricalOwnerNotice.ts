import type { RefundReceiptOverview } from './refundAuthoritativeReceipt';
export const historicalOwnerNoticeCutoff = '2026-09-02T19:51:58Z';
export type HistoricalOwnerNoticeFields = {
  providerMessageId: string; providerThreadId: string; originalSentAt: string;
  recipientEmail: string; reviewedMessageDigest: string;
};
export const historicalOwnerNoticeSnapshot = (v: RefundReceiptOverview, fields: HistoricalOwnerNoticeFields) => JSON.stringify({ v, fields });
export function buildHistoricalOwnerNoticeRequest(v: RefundReceiptOverview, fields: HistoricalOwnerNoticeFields, reviewed: boolean) {
  const at = Date.parse(fields.originalSentAt);
  if (!v.receipt || v.receipt.noticeAdopted || v.historicalOwnerNoticeAvailable !== true || !reviewed ||
    v.historicalOwnerNoticeCutoff !== historicalOwnerNoticeCutoff ||
    !/^[a-f0-9]{8,64}$/.test(fields.providerMessageId) || !/^[a-f0-9]{8,64}$/.test(fields.providerThreadId) ||
    !/^[a-f0-9]{64}$/.test(fields.reviewedMessageDigest) || !Number.isFinite(at) || at > Date.parse(historicalOwnerNoticeCutoff) ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(fields.originalSentAt) ||
    new Date(at).toISOString().slice(0, 19) !== fields.originalSentAt.slice(0, 19) ||
    fields.recipientEmail.length > 320 || fields.recipientEmail !== fields.recipientEmail.toLowerCase() ||
    !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(fields.recipientEmail)) throw new Error('Review the exact historical message and current receipt.');
  return { mode: 'record_historical_owner_notice', caseId: v.caseId, receiptId: v.receipt.id,
    expectedCaseVersion: v.expectedCaseVersion, completionCaseReference: v.caseReference,
    completionOriginalTransactionId: v.originalTransactionId, completionAmountCents: v.originalAmountCents,
    currencyCode: v.currencyCode, ...fields, evidenceReference: `GMAIL-SENT:${fields.providerMessageId}`,
    reviewedOwnedMailboxSent: true, reviewedCustomerOnlyNoCc: true, reviewedExactCaseAmount: true };
}
