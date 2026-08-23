export const REFUND_DETERMINISTIC_FOLLOW_UP_VERSION = "refund_follow_up_v2";
export const REFUND_SUPPORTED_FOLLOW_UP_VERSIONS = new Set([
  "refund_follow_up_v1",
  REFUND_DETERMINISTIC_FOLLOW_UP_VERSION,
]);

export const REFUND_AUTOMATIC_CUSTOMER_CONTACT_ENV =
  "REFUND_AUTOMATIC_CUSTOMER_CONTACT_ENABLED";

export type RefundFollowUpReason = "missing_information" | "no_safe_match";

export type RefundFollowUpMessageClass =
  | "request"
  | "reminder"
  | "information_received";

export type RefundMissingField =
  | "location_or_machine"
  | "incident_date"
  | "incident_time"
  | "payment_method"
  | "amount"
  | "card_last4";

export type RefundFollowUpFacts = {
  reportingMachineId?: string | null;
  reportingLocationId?: string | null;
  incidentAt?: string | null;
  incidentTimeResolution?: string | null;
  paymentMethod?: string | null;
  paymentAmountCents?: number | null;
  cardLast4?: string | null;
  cardWalletUsed?: boolean | null;
};

export type NayaxCustomerCorrectionCandidateEvidence = {
  isTopRanked?: boolean | null;
  reasonCodes?: string[] | null;
  manualReviewReasons?: string[] | null;
  hardExclusions?: string[] | null;
};

const missingFieldOrder: RefundMissingField[] = [
  "location_or_machine",
  "incident_date",
  "incident_time",
  "payment_method",
  "amount",
  "card_last4",
];

const nonBlank = (value: unknown) => typeof value === "string" && value.trim().length > 0;

export const automaticRefundCustomerContactEnabled = (
  value = Deno.env.get(REFUND_AUTOMATIC_CUSTOMER_CONTACT_ENV),
) => (value ?? "false").trim().toLowerCase() === "true";

export const sanitizeRefundMissingFields = (value: unknown): RefundMissingField[] => {
  if (!Array.isArray(value)) return [];
  const supplied = new Set(value.filter((entry): entry is string => typeof entry === "string"));
  return missingFieldOrder.filter((field) => supplied.has(field));
};

export const deriveRefundMissingFields = (
  facts: RefundFollowUpFacts,
): { missingFields: RefundMissingField[]; requiresSecureWalletCorrection: boolean } => {
  const fields: RefundMissingField[] = [];
  if (!nonBlank(facts.reportingMachineId) && !nonBlank(facts.reportingLocationId)) {
    fields.push("location_or_machine");
  }
  if (!nonBlank(facts.incidentAt)) {
    fields.push("incident_date");
  }
  if (
    !nonBlank(facts.incidentAt) ||
    !["exact", "legacy_absolute"].includes(
      (facts.incidentTimeResolution ?? "").trim().toLowerCase(),
    )
  ) {
    fields.push("incident_time");
  }

  const paymentMethod = typeof facts.paymentMethod === "string"
    ? facts.paymentMethod.trim().toLowerCase()
    : "";
  if (paymentMethod !== "card" && paymentMethod !== "cash") {
    fields.push("payment_method");
  }
  if (
    !Number.isInteger(facts.paymentAmountCents) ||
    Number(facts.paymentAmountCents) <= 0
  ) {
    fields.push("amount");
  }

  const cardLast4Present = /^[0-9]{4}$/.test((facts.cardLast4 ?? "").trim());
  const requiresSecureWalletCorrection =
    paymentMethod === "card" && facts.cardWalletUsed === true;
  if (paymentMethod === "card" && !cardLast4Present && !requiresSecureWalletCorrection) {
    fields.push("card_last4");
  }

  return {
    missingFields: sanitizeRefundMissingFields(fields),
    requiresSecureWalletCorrection,
  };
};

const nayaxProviderOrSafetyReasons = new Set([
  "already_refunded",
  "currency_not_usd",
  "duplicate_provider_record",
  "duplicate_transaction",
  "missing_amount_evidence",
  "missing_canonical_machine_mapping",
  "missing_currency_evidence",
  "missing_provider_card_last4",
  "missing_provider_machine_id",
  "missing_provider_site_id",
  "payment_not_approved",
  "provider_machine_mismatch",
  "provider_status_unconfirmed",
]);

const asReasonSet = (values: Array<string[] | null | undefined>) =>
  new Set(
    values.flatMap((value) => Array.isArray(value) ? value : [])
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  );

export const deriveNayaxCustomerCorrectionFields = ({
  recommendationState,
  cardWalletUsed,
  candidates,
}: {
  recommendationState: string | null | undefined;
  cardWalletUsed: boolean | null | undefined;
  candidates: NayaxCustomerCorrectionCandidateEvidence[];
}): RefundMissingField[] => {
  if (recommendationState !== "manual_exception" || cardWalletUsed) return [];

  const topCandidate = candidates.find((candidate) => candidate.isTopRanked) ??
    candidates[0];
  if (!topCandidate) return [];

  const reasons = asReasonSet([
    topCandidate.reasonCodes,
    topCandidate.manualReviewReasons,
    topCandidate.hardExclusions,
  ]);
  if ([...reasons].some((reason) => nayaxProviderOrSafetyReasons.has(reason))) {
    return [];
  }

  const nonCustomerHardExclusions = (topCandidate.hardExclusions ?? [])
    .map((reason) => reason.trim().toLowerCase())
    .filter((reason) => reason && reason !== "card_last4_mismatch");
  if (nonCustomerHardExclusions.length > 0) return [];

  if (reasons.has("card_last4_mismatch")) {
    return sanitizeRefundMissingFields([
      "incident_time",
      "payment_method",
      "amount",
      "card_last4",
    ]);
  }
  if (reasons.has("amount_mismatch") || reasons.has("amount_uncertain")) {
    return sanitizeRefundMissingFields(["incident_time", "amount", "card_last4"]);
  }
  if (
    reasons.has("incident_time_too_far") ||
    reasons.has("customer_time_within_1_hour") ||
    reasons.has("customer_time_rough")
  ) {
    return sanitizeRefundMissingFields(["incident_time", "amount", "card_last4"]);
  }

  return [];
};

export const refundFollowUpTemplateKey = (
  reason: RefundFollowUpReason,
  messageClass: RefundFollowUpMessageClass,
  templateVersion = REFUND_DETERMINISTIC_FOLLOW_UP_VERSION,
) => {
  if (messageClass === "information_received") {
    return `refund_information_received_${templateVersion}`;
  }
  if (messageClass === "reminder") {
    return `refund_${reason}_reminder_${templateVersion}`;
  }
  return `refund_${reason}_${templateVersion}`;
};

const sha256Hex = async (value: string) => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
};

export const buildRefundFollowUpTriggerFingerprint = async ({
  refundCaseId,
  reason,
  requestedFields,
  caseFactVersion,
  sourceCustomerMessageId,
}: {
  refundCaseId: string;
  reason: RefundFollowUpReason;
  requestedFields: RefundMissingField[];
  caseFactVersion: number;
  sourceCustomerMessageId?: string | null;
}) =>
  await sha256Hex([
    refundCaseId.trim().toLowerCase(),
    reason,
    sanitizeRefundMissingFields(requestedFields).join(","),
    Number.isInteger(caseFactVersion) && caseFactVersion > 0 ? String(caseFactVersion) : "invalid",
    (sourceCustomerMessageId ?? "initial").trim().toLowerCase(),
    REFUND_DETERMINISTIC_FOLLOW_UP_VERSION,
  ].join("|"));
