/// <reference lib="deno.ns" />
import { assertEquals, assertThrows } from 'jsr:@std/assert@1';
import { QueryClient, QueryObserver } from 'npm:@tanstack/query-core@5.83.0';
import { buildReceiptAdoptionRequest, buildReceiptRecordRequest, buildReceiptCompletionRequest, parseRefundReceiptOverview, refreshRefundReceiptViews, refundReceiptReviewSnapshot,
  buildRefundMachineCorrectionRequest, parseRefundMachineCorrectionOptions, parseRefundMachineCorrectionEvidence, refundMachineCorrectionReviewSnapshot } from './refundAuthoritativeReceipt.ts';

const overview = () => ({ schemaVersion: 'refund_receipt_overview_v1', visible: true,
  caseId: 'ad400000-0000-4000-8000-000000000001', caseReference: 'RF-RECEIPT-TEST', expectedCaseVersion: 4,
  canRecord: true, attemptId: null, attemptBindingKind: 'no_attempt_integrity_hold', accountScope: 'SYNTHETIC', providerMachineId: 'SYNTHETIC-MACHINE',
  originalTransactionId: '123456781', originalAmountCents: 700, currencyCode: 'USD', receipt: null, noticeChoices: [] });

const completionOverview = () => ({ ...overview(), canRecord: false,
  receipt: { id: 'ad900000-0000-4000-8000-000000000001', observedAt: '2026-09-03T15:00:00Z',
    settlementTimePrecision: 'unknown', noticeAdopted: false, noticeSentAt: null, managerCcVerified: null },
  completionNotice: { schemaVersion: 'refund_receipt_completion_v1', receiptId: 'ad900000-0000-4000-8000-000000000001',
    canQueue: true, messageId: null, state: 'not_queued', subject: 'Your refund is confirmed',
    body: 'Your $7.00 USD refund for RF-RECEIPT-TEST is confirmed.', recipientEmail: 'synthetic@example.invalid',
    reviewBinding: 'a'.repeat(64), deliveryState: 'unknown', payloadRedacted: true },
});
Deno.test('receipt completion binds reviewed preview and cannot specify payment or accounting values', () => {
  const v = parseRefundReceiptOverview(completionOverview())!;
  const intent = 'ad700000-0000-4000-8000-000000000001';
  assertThrows(() => buildReceiptCompletionRequest(v, intent, false));
  const request = buildReceiptCompletionRequest(v, intent, true);
  assertEquals(request, { p_case_id: v.caseId, p_receipt_id: v.receipt!.id, p_expected_case_version: v.expectedCaseVersion,
    p_intent_id: intent, p_reviewed_no_existing_notice: true, p_expected_review_binding: 'a'.repeat(64) });
  assertEquals(Object.hasOwn(request, 'body'), false);
  assertEquals(Object.hasOwn(request, 'settledAt'), false);
  assertEquals(refundReceiptReviewSnapshot(v) === refundReceiptReviewSnapshot({ ...v,
    completionNotice: { ...v.completionNotice!, body: 'Changed preview', reviewBinding: 'b'.repeat(64) } }), false);
});
Deno.test('receipt completion parser rejects mismatched identity and strips private fields', () => {
  const base = completionOverview();
  assertThrows(() => parseRefundReceiptOverview({ ...base, completionNotice: { ...base.completionNotice, receiptId: 'another-receipt' } }));
  assertThrows(() => parseRefundReceiptOverview({ ...base, completionNotice: { ...base.completionNotice, reviewBinding: '' } }));
  assertThrows(() => parseRefundReceiptOverview({ ...base, completionNotice: { ...base.completionNotice, state: 'sent' } }));
  const v = parseRefundReceiptOverview({ ...base, completionNotice: { ...base.completionNotice, providerMessageId: 'private' } })!;
  assertEquals(Object.hasOwn(v.completionNotice!, 'providerMessageId'), false);
});
Deno.test('queued, sent and unknown completion states cannot authorize another message or adoption', () => {
  const base = completionOverview();
  for (const state of ['queued', 'claimed', 'sent', 'failed', 'delivery_unknown']) {
    const v = parseRefundReceiptOverview({ ...base, completionNotice: { ...base.completionNotice,
      canQueue: false, messageId: 'ad700000-0000-4000-8000-000000000001', state } })!;
    assertThrows(() => buildReceiptCompletionRequest(v, 'ad700000-0000-4000-8000-000000000002', true));
    assertThrows(() => buildReceiptAdoptionRequest(v, 'ad800000-0000-4000-8000-000000000001', true));
  }
});

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
Deno.test('verified API receipt uses the same evidence-only request without caller-assigned provenance', () => {
  const v = parseRefundReceiptOverview({ ...overview(), attemptId: 'ad600000-0000-4000-8000-000000000001',
    attemptBindingKind: 'verified_authorized_api' })!;
  const request = buildReceiptRecordRequest(v, 'DTM:NAYAX-123456781', true);
  assertEquals(request.mode, 'record_authoritative_receipt');
  assertEquals(request.attemptId, v.attemptId);
  assertEquals(Object.hasOwn(request, 'attemptBindingKind'), false);
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

const correctionOptions = () => ({ schemaVersion: 'refund_legacy_machine_correction_options_v1', caseId: overview().caseId,
  expectedCaseVersion: 4, oldMachineId: 'ad100000-0000-4000-8000-000000000001', payloadRedacted: true,
  targets: [{ inventoryId: 'ad200000-0000-4000-8000-000000000001', inventoryEvidenceDigest: 'a'.repeat(64),
    reportingMachineId: 'ad100000-0000-4000-8000-000000000002', machineLabel: 'Synthetic verified machine',
    accountScope: 'SYNTHETIC', providerMachineId: 'SYNTHETIC-TARGET', machineNumber: '00123' }] });
const legacyOverview = () => parseRefundReceiptOverview({ ...overview(), attemptId: 'ad300000-0000-4000-8000-000000000001',
  attemptBindingKind: 'legacy_manual_portal_observation' })!;

Deno.test('correction options are strict, redacted and preserve numeric leading zeroes', () => {
  const options = parseRefundMachineCorrectionOptions({ ...correctionOptions(), secret: 'private',
    targets: [{ ...correctionOptions().targets[0], privatePayload: 'private' }] });
  assertEquals(Object.hasOwn(options, 'secret'), false);
  assertEquals(Object.hasOwn(options.targets[0], 'privatePayload'), false);
  assertEquals(options.targets[0].machineNumber, '00123');
  assertEquals(parseRefundMachineCorrectionOptions({ ...correctionOptions(), targets: [] }).targets, []);
});
for (const patch of [{ machineNumber: 'label' }, { machineNumber: '１２３' }, { machineNumber: 123 },
  { machineNumber: '' }, { inventoryEvidenceDigest: null }, { inventoryEvidenceDigest: 'a'.repeat(63) },
  { inventoryId: 'not-an-id' }, { reportingMachineId: correctionOptions().oldMachineId }, { accountScope: '' }]) {
  Deno.test(`correction options reject malformed ${Object.keys(patch)[0]} ${JSON.stringify(Object.values(patch)[0])}`, () => {
    assertThrows(() => parseRefundMachineCorrectionOptions({ ...correctionOptions(), targets: [{ ...correctionOptions().targets[0], ...patch }] }));
  });
}
Deno.test('correction options reject duplicate inventory and mismatched envelope', () => {
  assertThrows(() => parseRefundMachineCorrectionOptions({ ...correctionOptions(), targets: [...correctionOptions().targets, ...correctionOptions().targets] }));
  for (const patch of [{ expectedCaseVersion: null }, { oldMachineId: '' }, { payloadRedacted: false }, { targets: null }]) {
    assertThrows(() => parseRefundMachineCorrectionOptions({ ...correctionOptions(), ...patch }));
  }
});
Deno.test('correction request binds exact selected inventory without customer or historical claims', () => {
  const options = parseRefundMachineCorrectionOptions(correctionOptions());
  const request = buildRefundMachineCorrectionRequest(legacyOverview(), options, options.targets[0].inventoryId, '00123', 'DTM:NAYAX-123456781', true, 4);
  assertEquals(request.mode, 'correct_legacy_machine_and_record_observation');
  assertEquals(request.expectedOldMachineId, options.oldMachineId);
  assertEquals(request.targetMachineId, options.targets[0].reportingMachineId);
  assertEquals(request.providerMachineId, 'SYNTHETIC-TARGET');
  assertEquals(request.machineNumber, '00123');
  assertEquals(request.inventoryEvidenceDigest, 'a'.repeat(64));
  assertEquals(request.refundedAmountCents, 700);
  assertEquals(request.providerStatus, 62);
  for (const key of ['actorId', 'observedAt', 'settledAt', 'customerConfirmedMachine', 'attemptBindingKind']) assertEquals(Object.hasOwn(request, key), false);
});
Deno.test('correction request refuses stale, unreviewed, unrelated or unsupported selections', () => {
  const v = legacyOverview(); const o = parseRefundMachineCorrectionOptions(correctionOptions()); const id = o.targets[0].inventoryId;
  const build = (caseValue = v, options = o, inventoryId = id, number = '00123', reference = 'DTM:NAYAX-123456781', reviewed = true, version: number | undefined = 4) =>
    buildRefundMachineCorrectionRequest(caseValue, options, inventoryId, number, reference, reviewed, version);
  assertThrows(() => build(v, o, id, '123'));
  assertThrows(() => build(v, o, id, '00123', 'DTM:NAYAX-OTHER'));
  assertThrows(() => build(v, o, id, '00123', 'DTM:NAYAX-123456781', false));
  assertThrows(() => build(v, o, id, '00123', 'DTM:NAYAX-123456781', true, 5));
  assertThrows(() => build(v, { ...o, expectedCaseVersion: 5 }));
  assertThrows(() => build(v, { ...o, caseId: o.oldMachineId }));
  assertThrows(() => build(v, { ...o, targets: [{ ...o.targets[0], accountScope: 'OTHER' }] }));
  assertThrows(() => build(v, o, o.oldMachineId));
  assertThrows(() => build({ ...v, canRecord: false }));
  assertThrows(() => build({ ...v, attemptId: null }));
  for (const attemptBindingKind of ['modern_authorized_manual', 'no_attempt_integrity_hold', 'unverified_attempt'] as const) assertThrows(() => build({ ...v, attemptBindingKind }));
});
Deno.test('correction review cannot survive changed inventory, case, parent view, target or typed proof', () => {
  const v = legacyOverview(); const o = parseRefundMachineCorrectionOptions(correctionOptions()); const id = o.targets[0].inventoryId;
  const context = { machineLabel: 'Old machine', locationName: 'Synthetic location', expectedCaseVersion: 4 };
  const snapshot = refundMachineCorrectionReviewSnapshot(v, o, id, context, 'DTM:NAYAX-123456781', '00123');
  const changed = [
    refundMachineCorrectionReviewSnapshot({ ...v, expectedCaseVersion: 5 }, o, id, context, 'DTM:NAYAX-123456781', '00123'),
    refundMachineCorrectionReviewSnapshot(v, { ...o, targets: [{ ...o.targets[0], inventoryEvidenceDigest: 'b'.repeat(64) }] }, id, context, 'DTM:NAYAX-123456781', '00123'),
    refundMachineCorrectionReviewSnapshot(v, o, id, { ...context, machineLabel: 'Changed' }, 'DTM:NAYAX-123456781', '00123'),
    refundMachineCorrectionReviewSnapshot(v, o, o.oldMachineId, context, 'DTM:NAYAX-123456781', '00123'),
    refundMachineCorrectionReviewSnapshot(v, o, id, context, 'OTHER', '00123'),
    refundMachineCorrectionReviewSnapshot(v, o, id, context, 'DTM:NAYAX-123456781', '123'),
  ];
  for (const value of changed) assertEquals(value === snapshot, false);
});
Deno.test('saved correction evidence is explicit and private audit fields are never projected', () => {
  const evidence = { schemaVersion: 'refund_legacy_machine_correction_v1', correctionId: 'ad500000-0000-4000-8000-000000000001',
    receiptId: 'ad900000-0000-4000-8000-000000000001', recordedAt: '2026-09-02T16:00:00Z', historicalEvidencePreserved: true, payloadRedacted: true };
  assertEquals(parseRefundMachineCorrectionEvidence({ ...evidence, historicalAttemptDigest: 'private' }), evidence);
  assertEquals(parseRefundMachineCorrectionEvidence(undefined), null);
  assertThrows(() => parseRefundMachineCorrectionEvidence({ ...evidence, historicalEvidencePreserved: false }));
  assertThrows(() => parseRefundMachineCorrectionEvidence({ ...evidence, receiptId: null }));
});
