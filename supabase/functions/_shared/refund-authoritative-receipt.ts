// Evidence-only handlers intentionally receive only an authenticated RPC
// capability. They cannot reach a mail sender, provider executor, or service key.
type ReceiptRpc = (name: string, args: Record<string, unknown>) => PromiseLike<{
  data: unknown;
  error: unknown;
}>;

const uuid = (value: unknown) => typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const text = (value: unknown, length: number) => typeof value === "string" &&
  value.length > 0 && value.length <= length && value.trim() === value;
const positiveInteger = (value: unknown) => Number.isSafeInteger(value) && Number(value) > 0;
const exactKeys = (body: Record<string, unknown>, keys: string[]) =>
  Object.keys(body).length === keys.length && keys.every((key) => Object.hasOwn(body, key));

export const isAuthoritativeReceiptMode = (mode: unknown) =>
  mode === "record_authoritative_receipt" || mode === "adopt_completion_notice" ||
  mode === "correct_legacy_machine_and_record_observation";

export async function handleAuthoritativeReceipt(
  body: Record<string, unknown>,
  rpc: ReceiptRpc,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const invalid = { status: 400, body: { errorCode: "invalid_receipt_evidence", error: "Review the exact evidence again." } };
  if (!uuid(body.caseId) || !positiveInteger(body.expectedCaseVersion)) return invalid;
  let name: string;
  let args: Record<string, unknown>;
  const correctingMachine = body.mode === "correct_legacy_machine_and_record_observation";
  if (body.mode === "record_authoritative_receipt" || correctingMachine) {
    if (!exactKeys(body, ["mode", "caseId", "attemptId", "expectedCaseVersion", "accountScope",
      "providerMachineId", "originalTransactionId", "originalAmountCents", "refundedAmountCents",
      "currencyCode", "providerStatus", "evidenceReference", "reviewedCurrentProviderObservation",
      ...(correctingMachine ? ["expectedOldMachineId", "targetMachineId", "inventoryId", "inventoryEvidenceDigest", "machineNumber"] : [])]) ||
      body.reviewedCurrentProviderObservation !== true ||
      (body.attemptId !== null && !uuid(body.attemptId)) ||
      !text(body.accountScope, 100) || !text(body.providerMachineId, 120) ||
      !text(body.originalTransactionId, 120) || !positiveInteger(body.originalAmountCents) ||
      body.refundedAmountCents !== body.originalAmountCents || body.providerStatus !== 62 ||
      typeof body.currencyCode !== "string" || !/^[A-Z]{3}$/.test(body.currencyCode) ||
      body.evidenceReference !== `DTM:NAYAX-${body.originalTransactionId}`) return invalid;
    if (correctingMachine && (!uuid(body.attemptId) || !uuid(body.expectedOldMachineId) ||
      !uuid(body.targetMachineId) || body.targetMachineId === body.expectedOldMachineId ||
      !uuid(body.inventoryId) || typeof body.machineNumber !== "string" || !/^[0-9]{1,120}$/.test(body.machineNumber) ||
      typeof body.inventoryEvidenceDigest !== "string" || !/^[a-f0-9]{64}$/.test(body.inventoryEvidenceDigest))) return invalid;
    name = "admin_record_refund_authoritative_receipt";
    args = {
      p_case_id: body.caseId, p_attempt_id: body.attemptId, p_expected_case_version: body.expectedCaseVersion,
      p_account_scope: body.accountScope, p_provider_machine_id: body.providerMachineId,
      p_original_transaction_id: body.originalTransactionId, p_original_amount_cents: body.originalAmountCents,
      p_refunded_amount_cents: body.refundedAmountCents, p_currency_code: body.currencyCode,
      p_provider_status: body.providerStatus, p_evidence_reference: body.evidenceReference,
      p_reviewed_current_provider_observation: true,
    };
    if (correctingMachine) {
      name = "admin_correct_legacy_refund_machine_and_record_observation";
      Object.assign(args, { p_expected_old_machine_id: body.expectedOldMachineId,
        p_target_machine_id: body.targetMachineId, p_inventory_id: body.inventoryId,
        p_inventory_evidence_digest: body.inventoryEvidenceDigest, p_machine_number: body.machineNumber });
    }
  } else if (body.mode === "adopt_completion_notice") {
    if (!exactKeys(body, ["mode", "caseId", "receiptId", "gmailMessageId", "expectedCaseVersion",
      "completionCaseReference", "completionOriginalTransactionId", "completionAmountCents",
      "reviewedFullRefundNotice"]) || !uuid(body.receiptId) || !uuid(body.gmailMessageId) ||
      !text(body.completionCaseReference, 120) || !text(body.completionOriginalTransactionId, 120) ||
      !positiveInteger(body.completionAmountCents) || body.reviewedFullRefundNotice !== true) return invalid;
    name = "admin_adopt_refund_completion_notice";
    args = {
      p_case_id: body.caseId, p_receipt_id: body.receiptId, p_gmail_message_id: body.gmailMessageId,
      p_expected_case_version: body.expectedCaseVersion, p_completion_case_reference: body.completionCaseReference,
      p_completion_original_transaction_id: body.completionOriginalTransactionId,
      p_completion_amount_cents: body.completionAmountCents, p_reviewed_full_refund_notice: true,
    };
  } else return invalid;
  const { data, error } = await rpc(name, args);
  if (error || !data || typeof data !== "object" || Array.isArray(data)) {
    return { status: 409, body: { errorCode: "receipt_evidence_not_committed", error: "Evidence was not saved. Review the current case and source proof." } };
  }
  // Whitelist response fields; raw database errors, identities, content and
  // provider references never cross this handler boundary.
  const result = data as Record<string, unknown>;
  const allowedStatuses = correctingMachine ? ["recorded"] : body.mode === "record_authoritative_receipt"
    ? ["recorded", "already_recorded"] : ["adopted", "already_adopted"];
  if (!allowedStatuses.includes(String(result.status)) || result.customerMessageSent !== false || result.payloadRedacted !== true) {
    return { status: 409, body: { errorCode: "receipt_response_invalid", error: "Check the saved evidence before any further action." } };
  }
  const safe: Record<string, unknown> = { status: result.status, customerMessageSent: false, payloadRedacted: true };
  if (body.mode === "record_authoritative_receipt" || correctingMachine) {
    if (!uuid(result.receiptId) || result.settlementTimePrecision !== "unknown" ||
      result.paymentConfirmed !== true || result.accountingPending !== true) {
      return { status: 409, body: { errorCode: "receipt_response_invalid", error: "Check the saved evidence before any further action." } };
    }
    Object.assign(safe, { receiptId: result.receiptId, paymentConfirmed: true, accountingPending: true, settlementTimePrecision: "unknown" });
    if (correctingMachine) {
      if (!uuid(result.correctionId) || result.machineCorrected !== true) {
        return { status: 409, body: { errorCode: "receipt_response_invalid", error: "Check the saved evidence before any further action." } };
      }
      Object.assign(safe, { correctionId: result.correctionId, machineCorrected: true });
    }
  } else if (typeof result.managerCcVerified === "boolean") safe.managerCcVerified = result.managerCcVerified;
  return { status: 200, body: safe };
}
