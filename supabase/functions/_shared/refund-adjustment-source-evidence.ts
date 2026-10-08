type OriginalTender = "credit" | "cash";

/** The persisted importer hash contract deliberately excludes added evidence. */
export const buildRefundFinancialHashPayload = (input: {
  sourceRowReference: string; normalizedLocation: string; refundDate: string;
  originalOrderDate: string; amountCents: number; normalizedSourceStatus: string;
  normalizedSourceDecision: string; adjustmentType: string;
  hasSourceReportingMachineId: boolean; sourceReportingMachineId: string;
}) => {
  const payload: Record<string, unknown> = {
    sourceRowReference: input.sourceRowReference,
    sourceLocation: input.normalizedLocation,
    refundDate: input.refundDate,
    originalOrderDate: input.originalOrderDate,
    amountCents: input.amountCents,
    sourceStatus: input.normalizedSourceStatus,
    sourceDecision: input.normalizedSourceDecision,
    adjustmentType: input.adjustmentType,
  };
  if (input.hasSourceReportingMachineId) payload.sourceReportingMachineId = input.sourceReportingMachineId || null;
  return payload;
};

const originalTenderKeys = new Set([
  "payment_method", "paymentmethod", "original_payment_method", "originalpaymentmethod",
  "purchase_payment_method", "purchasepaymentmethod",
]);

const normalizeKey = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
const normalizeTender = (value: unknown): OriginalTender | null => {
  const text = String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
  if (["card", "credit", "creditcard", "debitcard", "applegooglepay", "applepay", "googlepay"].includes(text)) return "credit";
  return text === "cash" ? "cash" : null;
};

/** Original purchase tender is distinct from the customer's payout preference. */
export const extractOriginalRefundTender = (row: Record<string, unknown>): OriginalTender | null => {
  const values = Object.entries(row).filter(([key, value]) =>
    originalTenderKeys.has(normalizeKey(key)) && String(value ?? "").trim() !== ""
  ).map(([, value]) => normalizeTender(value));
  if (!values.length || values.some((value) => value === null)) return null;
  return new Set(values).size === 1 ? values[0] : null;
};

/** Add evidence outside the immutable financial source-row hash. */
export const buildRefundSourceEvidence = (
  originalTender: OriginalTender | null,
  amountSource: string | null,
  approvedRequestFallback = false,
) => {
  if (!originalTender || !["refund_amount", "refund_amount_cents", "request_amount", "request_amount_cents"].includes(amountSource ?? "")) return {};
  if (amountSource?.startsWith("request_") && !approvedRequestFallback) return {};
  return {
    payment_method: originalTender,
    payment_method_source: "original_source_payment_method",
    amountBasis: "gross_customer_charge_minor",
    source_evidence: {
      schema: "original_refund_payment.v1",
      tender_source: "original_payment_method",
      amount_source: amountSource,
    },
  };
};
