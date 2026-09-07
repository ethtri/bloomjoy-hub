// This handler receives only the caller's authenticated RPC capability.
// An operator's observation of Sent is evidence of their attestation, not a
// transport delivery verification. No sender or payment capability is exposed.
type Rpc = (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
const uuid = (v: unknown) => typeof v === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v);
const positive = (v: unknown) => Number.isSafeInteger(v) && Number(v) > 0;
const digest = (v: unknown) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const email = (v: unknown) => typeof v === "string" && v.length <= 254 && v === v.toLowerCase() && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(v);
export const isOwnerNonrefundAdoptionMode = (mode: unknown) => mode === "adopt_owner_nonrefund_resolution";

export async function handleOwnerNonrefundAdoption(body: Record<string, unknown>, rpc: Rpc) {
  const keys = ["mode", "caseId", "intentId", "expectedCaseVersion", "expectedFactVersion", "caseReference",
    "providerMessageId", "providerThreadId", "originalSentAt", "recipientEmail", "reviewedMessageDigest",
    "expectedOwnerReviewBinding", "reasonCode", "reviewedOwnedMailboxSent", "reviewedExactCaseResolution"];
  if (!isOwnerNonrefundAdoptionMode(body.mode) || Object.keys(body).length !== keys.length ||
    !keys.every((key) => Object.hasOwn(body, key)) || !uuid(body.caseId) || !uuid(body.intentId) ||
    !positive(body.expectedCaseVersion) || !positive(body.expectedFactVersion) ||
    typeof body.caseReference !== "string" || !/^RF-[A-Z0-9-]{1,80}$/.test(body.caseReference) ||
    ![body.providerMessageId, body.providerThreadId].every((v) => typeof v === "string" && /^[a-f0-9]{8,64}$/.test(v)) ||
    typeof body.originalSentAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(body.originalSentAt) ||
    !Number.isFinite(Date.parse(body.originalSentAt)) || !email(body.recipientEmail) ||
    !digest(body.reviewedMessageDigest) || !digest(body.expectedOwnerReviewBinding) ||
    body.reasonCode !== "not_operated_by_bloomjoy" || body.reviewedOwnedMailboxSent !== true ||
    body.reviewedExactCaseResolution !== true) {
    return { status: 400, body: { errorCode: "invalid_owner_resolution", error: "Review the exact sent resolution and current case." } };
  }
  const args = { p_case_id: body.caseId, p_intent_id: body.intentId, p_expected_case_version: body.expectedCaseVersion,
    p_expected_fact_version: body.expectedFactVersion, p_case_reference: body.caseReference,
    p_provider_message_id: body.providerMessageId, p_provider_thread_id: body.providerThreadId,
    p_original_sent_at: body.originalSentAt, p_recipient_email: body.recipientEmail,
    p_reviewed_message_digest: body.reviewedMessageDigest, p_expected_owner_review_binding: body.expectedOwnerReviewBinding,
    p_reason_code: body.reasonCode, p_reviewed_owned_mailbox_sent: true, p_reviewed_exact_case_resolution: true };
  let response;
  try { response = await rpc("admin_adopt_refund_owner_nonrefund_resolution", args); }
  catch { response = { data: null, error: {} }; }
  if (response.error) {
    const code = (response.error as { code?: string })?.code;
    const status = code === "42501" ? 403 : code === "P4671" ? 409 : 503;
    return { status, body: { errorCode: status === 503 ? "owner_resolution_retryable" : "owner_resolution_not_committed",
      error: status === 503 ? "The result could not be confirmed. Retry this same saved action." : "Review the current case and exact sent resolution." } };
  }
  const r = response.data as Record<string, unknown> | null;
  if (!r || r.status !== "adopted" || !uuid(r.adoptionId) || r.noticeVerification !== "operator_observed" ||
    r.customerMessageSent !== false || r.paymentAction !== false || r.payloadRedacted !== true) {
    return { status: 409, body: { errorCode: "owner_resolution_result_unconfirmed", error: "Check the saved resolution before another action." } };
  }
  return { status: 200, body: { status: "adopted", adoptionId: r.adoptionId, noticeVerification: "operator_observed",
    customerMessageSent: false, paymentAction: false, payloadRedacted: true } };
}
