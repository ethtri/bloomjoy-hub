/// <reference lib="deno.ns" />
import { assertEquals, assertThrows } from 'jsr:@std/assert@1';
import { buildReceiptAdoptionRequest, buildReceiptRecordRequest, parseRefundReceiptOverview } from './refundAuthoritativeReceipt.ts';

const overview = () => ({ schemaVersion: 'refund_receipt_overview_v1', visible: true,
  caseId: 'ad400000-0000-4000-8000-000000000001', caseReference: 'RF-RECEIPT-TEST', expectedCaseVersion: 4,
  canRecord: true, attemptId: null, accountScope: 'SYNTHETIC', providerMachineId: 'SYNTHETIC-MACHINE',
  originalTransactionId: '123456781', originalAmountCents: 700, currencyCode: 'USD', receipt: null, noticeChoices: [] });

Deno.test('authorized overview is explicit and strips unrelated private fields', () => {
  const v = parseRefundReceiptOverview({ ...overview(), providerMessageId: 'not-visible', secret: 'not-visible' });
  assertEquals(Object.hasOwn(v!, 'secret'), false);
  assertEquals(Object.hasOwn(v!, 'providerMessageId'), false);
  assertEquals(parseRefundReceiptOverview({ schemaVersion: 'refund_receipt_overview_v1', visible: false }), null);
  assertThrows(() => parseRefundReceiptOverview({ ...overview(), expectedCaseVersion: null }));
  assertThrows(() => parseRefundReceiptOverview({ ...overview(), currencyCode: null }));
});
Deno.test('UI receipt request uses exact selected fields and cannot supply a settlement time', () => {
  const v = parseRefundReceiptOverview(overview())!;
  assertThrows(() => buildReceiptRecordRequest(v, 'DTM:NAYAX-123456782', true));
  assertThrows(() => buildReceiptRecordRequest(v, 'DTM:NAYAX-123456781', false));
  const request = buildReceiptRecordRequest(v, 'DTM:NAYAX-123456781', true);
  assertEquals(request.attemptId, null);
  assertEquals(request.refundedAmountCents, 700);
  assertEquals(Object.hasOwn(request, 'observedAt'), false);
  assertEquals(Object.hasOwn(request, 'settledAt'), false);
});
Deno.test('refresh recovers receipt and exact sent choice without allowing a second-case adoption', () => {
  const v = parseRefundReceiptOverview({ ...overview(), canRecord: false,
    receipt: { id: 'ad900000-0000-4000-8000-000000000001', observedAt: '2026-09-02T16:00:00Z',
      settlementTimePrecision: 'unknown', noticeAdopted: false, noticeSentAt: null, managerCcVerified: null },
    noticeChoices: [{ id: 'ad800000-0000-4000-8000-000000000001', sentAt: '2026-09-02T15:00:00Z',
      subject: 'Synthetic notice', plainBody: 'This claim is refunded; another claim remains pending.', providerMessageId: 'private' }] })!;
  assertThrows(() => buildReceiptRecordRequest(v, 'DTM:NAYAX-123456781', true));
  assertThrows(() => buildReceiptAdoptionRequest(v, 'ad800000-0000-4000-8000-000000000099', true));
  assertThrows(() => buildReceiptAdoptionRequest(v, v.noticeChoices[0].id, false));
  const request = buildReceiptAdoptionRequest(v, v.noticeChoices[0].id, true);
  assertEquals(request.caseId, v.caseId); assertEquals(request.completionOriginalTransactionId, '123456781');
  assertEquals(Object.hasOwn(v.noticeChoices[0], 'providerMessageId'), false);
  assertThrows(() => buildReceiptAdoptionRequest({ ...v, receipt: { ...v.receipt!, noticeAdopted: true } }, v.noticeChoices[0].id, true));
});
