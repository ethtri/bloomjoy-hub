/// <reference lib="deno.ns" />
import { parseRefundReceiptOverview, type RefundReceiptOverview } from './refundAuthoritativeReceipt.ts';
import { buildHistoricalOwnerNoticeRequest, historicalOwnerNoticeSnapshot } from './refundHistoricalOwnerNotice.ts';
const assert = (v: unknown) => { if (!v) throw new Error('assertion'); };
const fail = (fn: () => unknown) => { let threw = false; try { fn(); } catch { threw = true; } assert(threw); };
const overview = (): RefundReceiptOverview => ({ schemaVersion: 'refund_receipt_overview_v1', visible: true,
  caseId: 'bd400000-0000-4000-8000-000000000001', caseReference: 'RF-HISTORICAL-1', expectedCaseVersion: 2,
  canRecord: false, attemptId: null, attemptBindingKind: 'no_attempt_integrity_hold', accountScope: 'SYNTHETIC',
  providerMachineId: 'SYNTHETIC-MACHINE', originalTransactionId: '123456781', originalAmountCents: 700, currencyCode: 'USD',
  receipt: { id: 'bd500000-0000-4000-8000-000000000001', observedAt: '2026-09-02T19:00:00Z', settlementTimePrecision: 'unknown',
    noticeAdopted: false, noticeSentAt: null, managerCcVerified: null, noticeSource: null, noticeVerification: null, supportThread: null },
  noticeChoices: [], historicalOwnerNoticeAvailable: true, historicalOwnerNoticeCutoff: '2026-09-02T19:51:58Z', historicalOwnerReviewBinding: 'f'.repeat(64) });
const fields = () => ({ providerMessageId: 'abcdef0123456789', providerThreadId: 'abcdef0123456790',
  originalSentAt: '2026-09-02T16:07:00Z', recipientEmail: 'synthetic-customer@example.invalid', reviewedMessageDigest: 'a'.repeat(64) });
Deno.test('owner-notice form binds only case and amount to confirmed receipt without caller sender or provider certainty', () => {
  const v = overview(), f = fields();
  const req = buildHistoricalOwnerNoticeRequest(v, f, true);
  assert(req.completionOriginalTransactionId === v.originalTransactionId && req.reviewedExactCaseAmount);
  assert(!('senderEmail' in req) && !('providerVerified' in req));
  fail(() => buildHistoricalOwnerNoticeRequest(v, f, false));
  fail(() => buildHistoricalOwnerNoticeRequest({ ...v, receipt: null }, f, true));
  fail(() => buildHistoricalOwnerNoticeRequest({ ...v, historicalOwnerNoticeAvailable: false }, f, true));
  fail(() => buildHistoricalOwnerNoticeRequest(v, { ...f, originalSentAt: '2026-09-02T19:51:59Z' }, true));
  fail(() => buildHistoricalOwnerNoticeRequest(v, { ...f, originalSentAt: '2026-02-30T16:07:00Z' }, true));
  fail(() => buildHistoricalOwnerNoticeRequest(v, { ...f, providerMessageId: f.providerMessageId.toUpperCase() }, true));
});
Deno.test('case version and every reviewed evidence field invalidate a saved historical attestation', () => {
  const v = overview(), f = fields(), before = historicalOwnerNoticeSnapshot(v, f);
  assert(before !== historicalOwnerNoticeSnapshot({ ...v, expectedCaseVersion: 3 }, f));
  assert(before !== historicalOwnerNoticeSnapshot({ ...v, historicalOwnerReviewBinding: 'e'.repeat(64) }, f));
  for (const key of Object.keys(f)) assert(before !== historicalOwnerNoticeSnapshot(v, { ...f, [key]: 'changed' }));
});
Deno.test('saved historical notice projection preserves operator/no-CC provenance and strips private identities', () => {
  const v = overview();
  const saved = { ...v, historicalOwnerNoticeAvailable: false, historicalOwnerReviewBinding: null, senderEmail: 'private', receipt: { ...v.receipt,
    noticeAdopted: true, noticeSentAt: '2026-09-02T16:07:00Z', managerCcVerified: false, noticeSource: 'historical_owner_mailbox',
    noticeVerification: 'operator_observed', supportThread: false, providerMessageId: 'private' } };
  const parsed = parseRefundReceiptOverview(saved)!;
  assert(parsed.receipt?.noticeSource === 'historical_owner_mailbox' && !JSON.stringify(parsed).includes('private'));
  for (const changed of [{ noticeVerification: 'provider_verified' }, { supportThread: true }, { managerCcVerified: true },
    { noticeSentAt: null }, { noticeSource: null }]) fail(() => parseRefundReceiptOverview({ ...saved, receipt: { ...saved.receipt, ...changed } }));
});
