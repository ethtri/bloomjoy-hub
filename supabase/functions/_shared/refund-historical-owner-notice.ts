type Rpc = (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
export const HISTORICAL_OWNER_NOTICE_CUTOFF = "2026-09-02T19:51:58Z";
const uuid = (v: unknown) => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
const text = (v: unknown, max: number) => typeof v === "string" && v.length > 0 && v.length <= max && v.trim() === v;
const hex = (v: unknown) => typeof v === "string" && /^[a-f0-9]{8,64}$/.test(v);
export async function handleHistoricalOwnerNotice(body: Record<string, unknown>, rpc: Rpc) {
  const keys = ["mode", "caseId", "receiptId", "expectedCaseVersion", "completionCaseReference",
    "completionOriginalTransactionId", "completionAmountCents", "currencyCode", "providerMessageId",
    "providerThreadId", "originalSentAt", "recipientEmail", "reviewedMessageDigest", "evidenceReference",
    "reviewedOwnedMailboxSent", "reviewedCustomerOnlyNoCc", "reviewedExactCaseAmount"];
  const at = typeof body.originalSentAt === "string" ? Date.parse(body.originalSentAt) : NaN;
  if (Object.keys(body).length !== keys.length || !keys.every((k) => Object.hasOwn(body, k)) ||
    !uuid(body.caseId) || !uuid(body.receiptId) || !Number.isSafeInteger(body.expectedCaseVersion) || Number(body.expectedCaseVersion) < 1 ||
    !text(body.completionCaseReference, 120) || !text(body.completionOriginalTransactionId, 120) ||
    !Number.isSafeInteger(body.completionAmountCents) || Number(body.completionAmountCents) <= 0 ||
    typeof body.currencyCode !== "string" || !/^[A-Z]{3}$/.test(body.currencyCode) ||
    !hex(body.providerMessageId) || !hex(body.providerThreadId) || !Number.isFinite(at) || at > Date.parse(HISTORICAL_OWNER_NOTICE_CUTOFF) ||
    typeof body.originalSentAt !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(body.originalSentAt) ||
    new Date(at).toISOString().slice(0, 19) !== body.originalSentAt.slice(0, 19) ||
    !text(body.recipientEmail, 320) || typeof body.recipientEmail !== "string" || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(body.recipientEmail) ||
    body.recipientEmail !== body.recipientEmail.toLowerCase() || typeof body.reviewedMessageDigest !== "string" || !/^[a-f0-9]{64}$/.test(body.reviewedMessageDigest) ||
    body.evidenceReference !== `GMAIL-SENT:${body.providerMessageId}` || body.reviewedOwnedMailboxSent !== true ||
    body.reviewedCustomerOnlyNoCc !== true || body.reviewedExactCaseAmount !== true) {
    return { status: 400, body: { errorCode: "invalid_historical_notice_evidence", error: "Review this historical message and current receipt again." } };
  }
  const { data, error } = await rpc("admin_record_refund_historical_owner_notice", {
    p_case_id: body.caseId, p_receipt_id: body.receiptId, p_expected_case_version: body.expectedCaseVersion,
    p_completion_case_reference: body.completionCaseReference, p_completion_original_transaction_id: body.completionOriginalTransactionId,
    p_completion_amount_cents: body.completionAmountCents, p_currency_code: body.currencyCode,
    p_provider_message_id: body.providerMessageId, p_provider_thread_id: body.providerThreadId,
    p_original_sent_at: body.originalSentAt, p_recipient_email: body.recipientEmail,
    p_reviewed_message_digest: body.reviewedMessageDigest, p_evidence_reference: body.evidenceReference,
    p_reviewed_owned_mailbox_sent: true, p_reviewed_customer_only_no_cc: true, p_reviewed_exact_case_amount: true,
  });
  const result = data && typeof data === "object" && !Array.isArray(data) ? data as Record<string, unknown> : {};
  if (error || !["adopted", "already_adopted"].includes(String(result.status)) || result.noticeSource !== "historical_owner_mailbox" ||
    result.noticeVerification !== "operator_observed" || result.supportThread !== false || result.managerCcVerified !== false ||
    result.customerMessageSent !== false || result.payloadRedacted !== true) {
    return { status: 409, body: { errorCode: "historical_notice_not_confirmed", error: "Reload the saved evidence before another action." } };
  }
  return { status: 200, body: { status: result.status, noticeSource: "historical_owner_mailbox", noticeVerification: "operator_observed",
    supportThread: false, managerCcVerified: false, customerMessageSent: false, payloadRedacted: true } };
}
