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
  | "payment_interaction"
  | "wallet_provider"
  | "amount"
  | "card_last4"
  | "card_network"
  | "zelle_payment_contact";

export type RefundFollowUpFacts = {
  reportingMachineId?: string | null;
  reportingLocationId?: string | null;
  incidentAt?: string | null;
  incidentTimeResolution?: string | null;
  paymentMethod?: string | null;
  paymentAmountCents?: number | null;
  cardLast4?: string | null;
  cardWalletUsed?: boolean | null;
  zellePaymentContact?: string | null;
  cashPayoutDestinationRequired?: boolean;
};

const missingFieldOrder: RefundMissingField[] = [
  "location_or_machine",
  "incident_date",
  "incident_time",
  "payment_method",
  "payment_interaction",
  "wallet_provider",
  "amount",
  "card_last4",
  "card_network",
  "zelle_payment_contact",
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
  if (
    paymentMethod === "cash" &&
    facts.cashPayoutDestinationRequired === true &&
    !nonBlank(facts.zellePaymentContact)
  ) {
    fields.push("zelle_payment_contact");
  }

  return {
    missingFields: sanitizeRefundMissingFields(fields),
    requiresSecureWalletCorrection,
  };
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
