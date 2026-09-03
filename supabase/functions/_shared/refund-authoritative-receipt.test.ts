import { assertEquals, assertFalse } from "jsr:@std/assert@1";
import { handleAuthoritativeReceipt } from "./refund-authoritative-receipt.ts";

const id = "a4000000-0000-4000-8000-000000000001";
const request = () => ({
  mode: "record_authoritative_receipt", caseId: id, attemptId: null, expectedCaseVersion: 2,
  accountScope: "FIXTURE", providerMachineId: "fixture-machine", originalTransactionId: "123456789",
  originalAmountCents: 700, refundedAmountCents: 700, currencyCode: "USD", providerStatus: 62,
  evidenceReference: "DTM:NAYAX-123456789", reviewedCurrentProviderObservation: true,
});
const response = { receiptId: id, status: "recorded", paymentConfirmed: true, accountingPending: true,
  settlementTimePrecision: "unknown", customerMessageSent: false, payloadRedacted: true };

const correctionRequest = () => ({ ...request(), mode: "correct_legacy_machine_and_record_observation",
  attemptId: id, expectedOldMachineId: id, targetMachineId: "a4000000-0000-4000-8000-000000000002",
  inventoryId: id, inventoryEvidenceDigest: "a".repeat(64), machineNumber: "555000002" });
Deno.test("legacy machine correction uses exactly one authenticated evidence capability", async () => {
  let calls = 0;
  const result = await handleAuthoritativeReceipt(correctionRequest(), (name, args) => {
    calls++;
    assertEquals(name, "admin_correct_legacy_refund_machine_and_record_observation");
    assertEquals(args.p_machine_number, "555000002");
    assertEquals(args.p_inventory_evidence_digest, "a".repeat(64));
    assertEquals(args.p_expected_old_machine_id, id);
    return Promise.resolve({ data: { ...response, correctionId: id, machineCorrected: true,
      rawHistoricalEvidence: "not-for-browser" }, error: null });
  });
  assertEquals(result.status, 200);
  assertEquals(calls, 1);
  assertEquals(result.body.machineCorrected, true);
  assertFalse(Object.hasOwn(result.body, "rawHistoricalEvidence"));
});
for (const change of [
  { attemptId: null }, { expectedOldMachineId: null }, { targetMachineId: id },
  { inventoryId: null }, { inventoryEvidenceDigest: "wrong" }, { machineNumber: "" },
  { machineNumber: "CORRECTION-MACHINE-2" }, { machineNumber: "１２３４" },
  { reviewedCurrentProviderObservation: false }, { providerStatus: 63 }, { refundedAmountCents: 699 },
  { actorId: id }, { observedAt: "2026-09-02T00:00:00Z" }, { customerConfirmedMachine: true },
]) Deno.test(`legacy correction rejects ${Object.keys(change)[0]} without a write`, async () => {
  const result = await handleAuthoritativeReceipt({ ...correctionRequest(), ...change }, () => {
    throw new Error("Invalid input must not reach any capability");
  });
  assertEquals(result.status, 400);
});
Deno.test("legacy correction never treats an incomplete or replay response as success", async () => {
  for (const data of [response, { ...response, status: "already_recorded", correctionId: id, machineCorrected: true },
    { ...response, correctionId: id, machineCorrected: false }]) {
    const result = await handleAuthoritativeReceipt(correctionRequest(), () => Promise.resolve({ data, error: null }));
    assertEquals(result.status, 409);
  }
});
Deno.test("numeric provider machine numbers remain exact text including leading zeroes", async () => {
  const result = await handleAuthoritativeReceipt({ ...correctionRequest(), machineNumber: "00555000002" }, (_name, args) => {
    assertEquals(args.p_machine_number, "00555000002");
    return Promise.resolve({ data: { ...response, correctionId: id, machineCorrected: true }, error: null });
  });
  assertEquals(result.status, 200);
});

Deno.test("unknown settlement receipt performs one authenticated evidence RPC and strips unexpected output", async () => {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const result = await handleAuthoritativeReceipt(request(), (name, args) => {
    calls.push({ name, args });
    return Promise.resolve({ data: { ...response, secret: "must-not-escape" }, error: null });
  });
  assertEquals(result.status, 200);
  assertEquals(calls.length, 1);
  assertEquals(calls[0].name, "admin_record_refund_authoritative_receipt");
  assertEquals(calls[0].args.p_reviewed_current_provider_observation, true);
  assertFalse(Object.hasOwn(calls[0].args, "p_evidence_occurred_at"));
  assertFalse(Object.hasOwn(calls[0].args, "p_observed_at"));
  assertFalse(Object.hasOwn(result.body, "secret"));
  assertEquals(result.body.customerMessageSent, false);
});

for (const change of [
  { settledAt: "2026-09-01T00:00:00Z" }, { observedAt: "2026-09-01T00:00:00Z" },
  { evidenceOccurredAt: "2026-09-01T00:00:00Z" }, { refundedAmountCents: 699 },
  { providerStatus: 61 }, { originalAmountCents: 0 }, { currencyCode: "usd" },
  { evidenceReference: "DTM:NAYAX-987654321" }, { attemptId: "not-an-id" },
  { reviewedCurrentProviderObservation: false }, { reviewedCurrentProviderObservation: null },
  { attemptBindingKind: 'legacy_manual_portal_observation' }, { providerStatus: 63 },
]) Deno.test(`receipt rejects invalid/extra evidence ${Object.keys(change)[0]} without any effect`, async () => {
  let calls = 0;
  const result = await handleAuthoritativeReceipt({ ...request(), ...change }, () => {
    calls++; return Promise.resolve({ data: response, error: null });
  });
  assertEquals(result.status, 400);
  assertEquals(calls, 0);
});

Deno.test("prior-notice adoption is exact-case scoped and never falls into completion dispatch", async () => {
  const body = { mode: "adopt_completion_notice", caseId: id, receiptId: id, gmailMessageId: id,
    expectedCaseVersion: 3, completionCaseReference: "RF-FIXTURE-ONE",
    completionOriginalTransactionId: "123456789", completionAmountCents: 700, reviewedFullRefundNotice: true };
  let calls = 0;
  const result = await handleAuthoritativeReceipt(body, (name, args) => {
    calls++;
    assertEquals(name, "admin_adopt_refund_completion_notice");
    assertEquals(args.p_completion_case_reference, "RF-FIXTURE-ONE");
    assertEquals(args.p_completion_original_transaction_id, "123456789");
    return Promise.resolve({ data: { status: "adopted", managerCcVerified: false,
      customerMessageSent: false, payloadRedacted: true }, error: null });
  });
  assertEquals(calls, 1);
  assertEquals(result.body.managerCcVerified, false);
  const rejected = await handleAuthoritativeReceipt({ ...body, reviewedFullRefundNotice: false }, () => {
    throw new Error("unreviewed notice must not reach the database");
  });
  assertEquals(rejected.status, 400);
});

Deno.test("RPC conflicts and invalid results never leak provider data or retry another path", async () => {
  for (const answer of [
    { data: null, error: "private-provider-reference" },
    { data: { ...response, customerMessageSent: true }, error: null },
    { data: { ...response, settlementTimePrecision: "exact" }, error: null },
  ]) {
    let calls = 0;
    const result = await handleAuthoritativeReceipt(request(), () => {
      calls++; return Promise.resolve(answer);
    });
    assertEquals(calls, 1);
    assertEquals(result.status, 409);
    assertFalse(JSON.stringify(result).includes("private-provider-reference"));
  }
});
