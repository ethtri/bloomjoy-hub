import { handleAuthoritativeReceipt, isAuthoritativeReceiptMode } from "./refund-authoritative-receipt.ts";
const assert = (v: unknown, message = "assertion") => { if (!v) throw new Error(message); };
const request = () => ({ mode: "record_historical_owner_notice", caseId: "bd400000-0000-4000-8000-000000000001",
  receiptId: "bd500000-0000-4000-8000-000000000001", expectedCaseVersion: 2, completionCaseReference: "RF-HISTORICAL-1",
  completionOriginalTransactionId: "123456781", completionAmountCents: 700, currencyCode: "USD",
  providerMessageId: "abcdef0123456789", providerThreadId: "abcdef0123456790", originalSentAt: "2026-09-02T16:07:00Z",
  recipientEmail: "synthetic-customer@example.invalid", reviewedMessageDigest: "a".repeat(64), evidenceReference: "GMAIL-SENT:abcdef0123456789",
  reviewedOwnedMailboxSent: true, reviewedCustomerOnlyNoCc: true, reviewedExactCaseAmount: true });
const result = () => ({ status: "adopted", noticeSource: "historical_owner_mailbox", noticeVerification: "operator_observed",
  supportThread: false, managerCcVerified: false, customerMessageSent: false, payloadRedacted: true });
Deno.test("historical owner notice uses one authenticated evidence capability, derives identity server-side and redacts output", async () => {
  let count = 0;
  assert(isAuthoritativeReceiptMode("record_historical_owner_notice"));
  const response = await handleAuthoritativeReceipt(request(), (name, args) => {
    count++; assert(name === "admin_record_refund_historical_owner_notice");
    assert(args.p_provider_message_id === request().providerMessageId);
    assert(!Object.keys(args).some((key) => /sender|actor|support_verified|delivered/.test(key)));
    return Promise.resolve({ data: { ...result(), senderEmail: "private", rawBody: "private", providerMessageId: "private" }, error: null });
  });
  assert(response.status === 200 && count === 1);
  assert(!JSON.stringify(response).includes("private"));
});
for (const [key, value] of Object.entries({ senderEmail: "forged@example.invalid", actorUserId: "forged", sourceKind: "support_gmail",
  providerVerified: true, managerCcVerified: true, supportThread: true, customerCc: [],
  reviewedOwnedMailboxSent: false, reviewedCustomerOnlyNoCc: null, reviewedExactCaseAmount: false,
  originalSentAt: "2026-09-02T19:51:59Z", providerMessageId: "ABCDEF0123456789", providerThreadId: "RFC:<id>",
  recipientEmail: "a@example.invalid,b@example.invalid", reviewedMessageDigest: "bad", evidenceReference: "other",
  currencyCode: "usd", completionAmountCents: 0, expectedCaseVersion: null, receiptId: null })) {
  Deno.test(`historical notice rejects forged or invalid ${key} before RPC`, async () => {
    let calls = 0;
    const response = await handleAuthoritativeReceipt({ ...request(), [key]: value }, () => { calls++; return Promise.resolve({ data: result(), error: null }); });
    assert(response.status === 400 && calls === 0);
  });
}
for (const changed of [{ noticeVerification: "provider_verified" }, { supportThread: true }, { managerCcVerified: true },
  { customerMessageSent: true }, { payloadRedacted: false }, { noticeSource: "support_gmail" }]) {
  Deno.test(`historical notice refuses response upgrading ${Object.keys(changed)[0]}`, async () => {
    const response = await handleAuthoritativeReceipt(request(), () => Promise.resolve({ data: { ...result(), ...changed }, error: null }));
    assert(response.status === 409);
  });
}
Deno.test("historical notice database failure is generic and never falls through to a sender", async () => {
  let count = 0;
  const response = await handleAuthoritativeReceipt(request(), () => { count++; return Promise.resolve({ data: null, error: { detail: "private" } }); });
  assert(count === 1 && response.status === 409 && !JSON.stringify(response).includes("private"));
});
