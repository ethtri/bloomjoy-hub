/// <reference lib="deno.ns" />
import { assertEquals, assertThrows } from 'jsr:@std/assert@1';
import { QueryClient, QueryObserver } from 'npm:@tanstack/query-core@5.83.0';
import { buildReceiptAdoptionRequest, buildReceiptRecordRequest, parseRefundReceiptOverview, refreshRefundReceiptViews, refundReceiptReviewSnapshot } from './refundAuthoritativeReceipt.ts';

const overview = () => ({ schemaVersion: 'refund_receipt_overview_v1', visible: true,
  caseId: 'ad400000-0000-4000-8000-000000000001', caseReference: 'RF-RECEIPT-TEST', expectedCaseVersion: 4,
  canRecord: true, attemptId: null, attemptBindingKind: 'no_attempt_integrity_hold', accountScope: 'SYNTHETIC', providerMachineId: 'SYNTHETIC-MACHINE',
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
  assertEquals(request.reviewedCurrentProviderObservation, true);
  assertEquals(Object.hasOwn(request, 'attemptBindingKind'), false);
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

Deno.test('record and adoption refresh the real parent overview, availability, and receipt query keys', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  let stage = 'provider_confirmation_pending';
  let rank = 60;
  let canRefund = true;
  let receipt: { id: string; noticeAdopted: boolean } | null = null;
  const overviewKey = ['admin-refund-operations-overview'];
  const availabilityKey = ['nayax-card-refund-availability', overview().caseId];
  const receiptKey = ['refund-authoritative-receipt', overview().caseId];
  const observers = [
    new QueryObserver(client, { queryKey: overviewKey, queryFn: () => ({ stage, rank }) }),
    new QueryObserver(client, { queryKey: availabilityKey, queryFn: () => ({ canRefund }) }),
    new QueryObserver(client, { queryKey: receiptKey, queryFn: () => ({ receipt }) }),
  ];
  const unsubscribe = observers.map((observer) => observer.subscribe(() => {}));
  const refresh = () => refreshRefundReceiptViews((queryKey) => client.invalidateQueries({ queryKey }));
  try {
    await Promise.all(observers.map((observer) => observer.refetch()));
    assertEquals(client.getQueryData(overviewKey), { stage: 'provider_confirmation_pending', rank: 60 });
    assertEquals(client.getQueryData(availabilityKey), { canRefund: true });
    stage = 'refund_confirmed'; rank = 70; canRefund = false;
    receipt = { id: 'ad900000-0000-4000-8000-000000000001', noticeAdopted: false };
    await refresh();
    assertEquals(client.getQueryData(overviewKey), { stage: 'refund_confirmed', rank: 70 });
    assertEquals(client.getQueryData(availabilityKey), { canRefund: false });
    assertEquals(client.getQueryData(receiptKey), { receipt });
    stage = 'customer_notified'; rank = 80;
    receipt = { ...receipt, noticeAdopted: true };
    await refresh();
    assertEquals(client.getQueryData(overviewKey), { stage: 'customer_notified', rank: 80 });
    assertEquals(client.getQueryData(availabilityKey), { canRefund: false });
    assertEquals(client.getQueryData(receiptKey), { receipt });
  } finally {
    unsubscribe.forEach((stop) => stop());
    client.clear();
  }
});

Deno.test('same-case refresh cannot rebase payment or notice review onto changed evidence', () => {
  const v = parseRefundReceiptOverview(overview())!;
  const reviewed = refundReceiptReviewSnapshot(v);
  assertEquals(reviewed, refundReceiptReviewSnapshot({ ...v }));
  for (const change of [{ expectedCaseVersion: 5 }, { accountScope: 'CHANGED' }, { providerMachineId: 'CHANGED' },
    { originalAmountCents: 800 }, { originalTransactionId: '123456799' },
    { noticeChoices: [{ id: 'ad800000-0000-4000-8000-000000000001', sentAt: '2026-09-02T15:00:00Z', subject: 'Changed', plainBody: 'Different claim' }] }]) {
    assertEquals(reviewed === refundReceiptReviewSnapshot({ ...v, ...change }), false);
  }
});
