import { resolveLocalDateTimeInZone } from "./timezone-resolution.mjs";
import { buildNayaxCandidateContext } from "./nayax-machine-context.mjs";

// Deterministic Nayax recommendation policy for Refund Operations.
//
// Ranking points are ordering evidence, not a calibrated probability. The UI and
// API expose advisory words (strong evidence, compare candidates, manual review)
// instead of presenting these points as a percentage.
export const NAYAX_RECOMMENDATION_POLICY = Object.freeze({
  version: "2026-08-26.v5",
  candidateLimit: 10,
  lookupWindowHours: 6,
  highConfidenceMinimumPoints: 80,
  maximumOneClickTimeDeltaMinutes: 60,
  maximumUniqueQrLagMinutes: 30,
  maximumUniqueQrIncidentDeltaMinutes: 180,
  weights: Object.freeze({
    exactMappedMachineAndLocation: 40,
    exactAmount: 25,
    nearAmount: 8,
    timeWithin15Minutes: 25,
    timeWithin60Minutes: 18,
    timeWithin3Hours: 8,
    timeWithinLookupWindow: 2,
    exactCardLast4: 20,
    exactCardNetwork: 4,
    physicalCardNetworkMismatch: -8,
    usdCurrency: 5,
    approvedProviderStatus: 5,
  }),
});

const sanitizeText = (value, maxLength = 300) =>
  typeof value === "string" || typeof value === "number" || typeof value === "boolean"
    ? String(value).trim().slice(0, maxLength)
    : "";

export const normalizeCardNetwork = (value) => {
  const normalized = sanitizeText(value, 80)
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return null;
  if (normalized.includes("visa")) return "visa";
  if (normalized.includes("mastercard") || normalized.includes("master card") || normalized === "mc") {
    return "mastercard";
  }
  if (normalized.includes("american express") || normalized.includes("amex")) return "american_express";
  if (normalized.includes("discover")) return "discover";
  if (["other", "unknown", "not sure", "other unknown"].includes(normalized)) return "other_unknown";
  return null;
};

const cardNetworkLabel = (network) => ({
  visa: "Visa",
  mastercard: "Mastercard",
  discover: "Discover",
  american_express: "American Express",
  other_unknown: "Other / Not sure",
})[network] ?? "Card";

const normalizeRecognitionMethod = (value) => {
  const normalized = sanitizeText(value, 80)
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return "";
  if (normalized.includes("apple") || normalized.includes("google") || normalized.includes("wallet")) return "wallet";
  if (normalized.includes("contactless") || normalized.includes("tap")) return "contactless";
  if (normalized.includes("chip") || normalized.includes("emv")) return "chip";
  if (normalized.includes("swipe") || normalized.includes("mag")) return "swipe";
  return "present";
};

const LAST_SALES_PROVIDER_CONTRACT = "nayax_machine_last_sales_v1";
const PAYMENT_STATUS_FIELDS = [
  "PaymentStatus",
  "paymentStatus",
  "payment_status",
  "TransactionStatus",
  "transactionStatus",
  "transaction_status",
  "Status",
  "status",
];

const normalizePaymentStatusValue = (value) => {
  const normalized = sanitizeText(value, 80)
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return "recorded";
  const statusTokens = new Set(normalized.split(" "));
  // Denial/reversal evidence must win over positive substrings. For example,
  // "not approved" contains "approved" and "successful reversal" contains
  // "successful"; checking positive tokens first would make both unsafe sales
  // eligible. Unknown or mixed status text remains fail-closed as "recorded".
  if (
    [
      "not approved",
      "not paid",
      "not successful",
      "not completed",
      "not settled",
    ].some((token) => normalized.includes(token))
    || ["unapproved", "unpaid", "unsuccessful", "incomplete", "unsettled", "declined", "denied", "failed", "reversal", "reversed"]
      .some((token) => statusTokens.has(token))
    || [...statusTokens].some((token) => token.startsWith("cancel") || token.startsWith("void"))
  ) {
    return "not approved";
  }
  if (["approved", "paid", "success", "successful", "completed", "settled", "sale"].some((token) => statusTokens.has(token))) {
    return "approved";
  }
  return "recorded";
};

const normalizePaymentStatus = (record, providerContract) => {
  const explicitStatuses = PAYMENT_STATUS_FIELDS
    .filter((field) => Object.prototype.hasOwnProperty.call(record, field))
    .map((field) => normalizePaymentStatusValue(record[field]));
  if (explicitStatuses.length === 0) {
    // Nayax's documented machine Last Sales response intentionally has no
    // separate status field. The refund API tells integrators to obtain the
    // refundable TransactionId/SiteId from this endpoint. Treat omission as
    // sale evidence only when the caller explicitly binds this trusted
    // contract. Every unverified payload remains closed.
    return providerContract === LAST_SALES_PROVIDER_CONTRACT
      ? { status: "approved", evidence: "last_sales_contract" }
      : { status: "recorded", evidence: "unconfirmed" };
  }
  // Evaluate every supported alias. A negative value wins over positive
  // evidence, while any blank/unknown value or contradiction stays closed.
  if (explicitStatuses.includes("not approved")) {
    return { status: "not approved", evidence: "explicit" };
  }
  if (explicitStatuses.some((status) => status !== "approved")) {
    return { status: "recorded", evidence: "unconfirmed" };
  }
  return { status: "approved", evidence: "explicit" };
};

const normalizeProviderRefundState = (record) => {
  if (record.IsRefunded === true || record.isRefunded === true || record.Refunded === true) return "already_refunded";
  const normalized = sanitizeText(
    record.RefundStatus ?? record.refundStatus ?? record.TransactionType ?? record.transactionType,
    80,
  ).toLowerCase();
  return /refund|reversal|reversed/.test(normalized) ? "already_refunded" : "clear";
};

const parseDateValue = (value) => {
  const raw = sanitizeText(value, 120);
  if (!raw) return null;

  const parseCandidates = [raw];
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(raw) && !/[zZ]$/.test(raw)) {
    // Nayax GMT fields have historically omitted the trailing Z. Interpret that
    // provider shape as UTC so host-machine timezone cannot change the result.
    parseCandidates.unshift(`${raw}Z`);
  }

  for (const candidate of parseCandidates) {
    const date = new Date(candidate);
    if (!Number.isNaN(date.getTime())) return date;
  }
  return null;
};

const parseProviderAuthorizationDate = (record, locationTimezone) => {
  const gmtValue = sanitizeText(record.AuthorizationDateTimeGMT ?? record.AuthorizationDateTimeGmt, 120);
  if (gmtValue) {
    const date = parseDateValue(gmtValue);
    return date ? { date, resolution: "exact" } : null;
  }

  const machineValue = sanitizeText(record.MachineAuthorizationTime, 120);
  if (!machineValue) return null;
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(machineValue)) {
    const date = parseDateValue(machineValue);
    return date ? { date, resolution: "exact" } : null;
  }

  const localMatch = machineValue.match(
    /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}(?::\d{2})?)(?:\.\d+)?$/,
  );
  if (!localMatch || !locationTimezone) return null;
  const resolved = resolveLocalDateTimeInZone({
    localDate: localMatch[1],
    localTime: localMatch[2],
    timeZone: locationTimezone,
  });
  const date = resolved.instant ? new Date(resolved.instant) : null;
  return date && !Number.isNaN(date.getTime())
    ? { date, resolution: resolved.resolution }
    : null;
};

const moneyToCents = (value) => {
  if (value === null || typeof value === "undefined") return null;
  const numeric = typeof value === "string" ? Number(value.replace(/[$,\s]/g, "")) : Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? Math.round(numeric * 100) : null;
};

const integerValue = (value) => {
  if (value === null || typeof value === "undefined" || (typeof value === "string" && !value.trim())) {
    return null;
  }
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric >= 0 ? numeric : null;
};

const extractLast4 = (value) => {
  const digits = sanitizeText(value, 80).replace(/\D/g, "");
  return digits.length >= 4 ? digits.slice(-4) : "";
};

const asNonNegativeCents = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? Math.round(numeric) : null;
};

const transactionStateFor = (transactionStates, transactionId) => {
  if (transactionStates instanceof Map) return transactionStates.get(transactionId) ?? "clear";
  return transactionStates?.[transactionId] ?? "clear";
};

const factor = (key, outcome, label) => ({ key, outcome, label });

const timePointsFor = (deltaMinutes, weights) => {
  if (deltaMinutes <= 15) return weights.timeWithin15Minutes;
  if (deltaMinutes <= 60) return weights.timeWithin60Minutes;
  if (deltaMinutes <= 180) return weights.timeWithin3Hours;
  return weights.timeWithinLookupWindow;
};

const timeLabelFor = (deltaMinutes) => {
  if (deltaMinutes === 0) return "Transaction time matches the customer-reported time";
  if (deltaMinutes === 1) return "Transaction is 1 minute from the customer-reported time";
  return `Transaction is ${deltaMinutes} minutes from the customer-reported time`;
};

const addReason = (target, reason) => {
  if (!target.includes(reason)) target.push(reason);
};

const qrTimeLabelFor = (deltaMinutes) => {
  if (deltaMinutes === null) return "No verified machine QR start time is available";
  if (deltaMinutes < 0) return "The transaction occurred after the machine QR form was opened";
  if (deltaMinutes === 0) return "The machine QR form opened in the same minute as the transaction";
  if (deltaMinutes === 1) return "The machine QR form opened 1 minute after the transaction";
  return `The machine QR form opened ${deltaMinutes} minutes after the transaction`;
};

const scoreCandidate = ({ candidate, request, transactionState, policy }) => {
  const weights = policy.weights;
  const matchFactors = [];
  const manualReviewReasons = [];
  const hardExclusions = [];
  const reasonCodes = [];
  let rankingPoints = 0;

  if (candidate.siteId === null) {
    addReason(manualReviewReasons, "missing_provider_site_id");
    addReason(reasonCodes, "missing_provider_site_id");
    matchFactors.push(factor("provider_site", "missing", "Nayax did not return the site identity required for guarded execution"));
  } else {
    addReason(reasonCodes, "provider_site_present");
  }

  if (candidate.duplicateProviderRecord) {
    addReason(manualReviewReasons, "duplicate_provider_record");
    addReason(reasonCodes, "duplicate_provider_record");
    matchFactors.push(factor("provider_record", "manual", "Nayax returned duplicate records for this transaction"));
  }

  if (request.incidentTimeResolution !== "exact") {
    addReason(manualReviewReasons, `incident_time_${request.incidentTimeResolution}`);
    addReason(reasonCodes, `incident_time_${request.incidentTimeResolution}`);
    matchFactors.push(factor("incident_time", "manual", "Reported local time needs manual time-zone review"));
  } else {
    addReason(reasonCodes, "incident_time_exact");
  }

  if (["within_1_hour", "rough"].includes(request.incidentTimeConfidence)) {
    addReason(manualReviewReasons, `customer_time_${request.incidentTimeConfidence}`);
    addReason(reasonCodes, `customer_time_${request.incidentTimeConfidence}`);
    matchFactors.push(factor(
      "customer_time_confidence",
      "manual",
      request.incidentTimeConfidence === "rough"
        ? "Customer said the purchase time is only a rough estimate"
        : "Customer said the purchase time may be off by about an hour",
    ));
  } else if (request.incidentTimeConfidence === "within_15_minutes") {
    addReason(reasonCodes, "customer_time_within_15_minutes");
    matchFactors.push(factor(
      "customer_time_confidence",
      "match",
      "Customer said the purchase time is within about 15 minutes",
    ));
  } else {
    addReason(reasonCodes, "customer_time_exact_or_legacy");
  }

  if (candidate.providerTimeResolution !== "exact") {
    addReason(manualReviewReasons, `provider_time_${candidate.providerTimeResolution}`);
    addReason(reasonCodes, `provider_time_${candidate.providerTimeResolution}`);
    matchFactors.push(factor("provider_time", "manual", "Nayax transaction time needs manual time-zone review"));
  } else {
    addReason(reasonCodes, "provider_time_exact");
  }

  if (!request.expectedMachineId) {
    addReason(manualReviewReasons, "missing_canonical_machine_mapping");
    addReason(reasonCodes, "missing_canonical_machine_mapping");
    matchFactors.push(factor("machine", "missing", "The refund request is missing its canonical Nayax machine mapping"));
  } else if (!candidate.providerMachineId) {
    addReason(manualReviewReasons, "missing_provider_machine_id");
    addReason(reasonCodes, "missing_provider_machine_id");
    matchFactors.push(factor("machine", "missing", "Nayax did not return machine identity evidence"));
  } else if (candidate.providerMachineId !== request.expectedMachineId) {
    hardExclusions.push("wrong_machine");
    addReason(manualReviewReasons, "provider_machine_mismatch");
    addReason(reasonCodes, "provider_machine_mismatch");
    matchFactors.push(factor("machine", "mismatch", "Nayax returned a different machine than the mapped request machine"));
  } else {
    rankingPoints += weights.exactMappedMachineAndLocation;
    addReason(reasonCodes, "machine_exact");
    matchFactors.push(factor("machine", "match", "Exact mapped machine and location"));
  }

  const amountDeltaCents = request.amountCents === null || candidate.amountCents === null
    ? null
    : Math.abs(candidate.amountCents - request.amountCents);
  if (amountDeltaCents === 0) {
    rankingPoints += weights.exactAmount;
    addReason(reasonCodes, "amount_exact");
    matchFactors.push(factor("amount", "match", "Transaction amount matches exactly"));
  } else if (amountDeltaCents !== null && amountDeltaCents <= 50) {
    rankingPoints += weights.nearAmount;
    addReason(manualReviewReasons, "amount_uncertain");
    addReason(reasonCodes, "amount_uncertain");
    matchFactors.push(factor("amount", "partial", `Transaction amount differs by ${amountDeltaCents} cents`));
  } else if (amountDeltaCents !== null) {
    addReason(manualReviewReasons, "amount_mismatch");
    addReason(reasonCodes, "amount_mismatch");
    matchFactors.push(factor("amount", "mismatch", `Transaction amount differs by ${amountDeltaCents} cents`));
  } else {
    addReason(manualReviewReasons, "missing_amount_evidence");
    addReason(reasonCodes, "missing_amount_evidence");
    matchFactors.push(factor("amount", "missing", "Amount evidence is incomplete"));
  }

  if (candidate.productLabel) {
    const productPriceLabel = candidate.standardPriceCents !== null
      ? ` at the configured $${(candidate.standardPriceCents / 100).toFixed(2)} price`
      : "";
    matchFactors.push(factor(
      "product",
      candidate.priceMatchesMachineConfiguration === false ? "partial" : "neutral",
      `Nayax recorded ${candidate.productLabel}${productPriceLabel}`,
    ));
  }

  rankingPoints += timePointsFor(candidate.timeDeltaMinutes, weights);
  if (candidate.timeDeltaMinutes <= policy.maximumOneClickTimeDeltaMinutes) {
    addReason(reasonCodes, "incident_time_within_60m");
  } else if (candidate.timeDeltaMinutes <= policy.maximumUniqueQrIncidentDeltaMinutes) {
    addReason(reasonCodes, "incident_time_within_3h");
  } else {
    addReason(manualReviewReasons, "incident_time_too_far");
    addReason(reasonCodes, "incident_time_too_far");
  }
  matchFactors.push(factor(
    "incident_time",
    candidate.timeDeltaMinutes <= policy.maximumOneClickTimeDeltaMinutes ? "match" : "partial",
    timeLabelFor(candidate.timeDeltaMinutes),
  ));

  if (request.qrClaimEvidenceStatus === "verified" && candidate.qrTimeDeltaMinutes !== null) {
    if (candidate.qrTimeDeltaMinutes < 0) {
      addReason(manualReviewReasons, "transaction_after_qr_open");
      addReason(reasonCodes, "transaction_after_qr_open");
      matchFactors.push(factor("qr_time", "mismatch", qrTimeLabelFor(candidate.qrTimeDeltaMinutes)));
    } else if (candidate.qrTimeDeltaMinutes <= policy.maximumUniqueQrLagMinutes) {
      addReason(reasonCodes, "qr_time_within_30m");
      matchFactors.push(factor("qr_time", "match", qrTimeLabelFor(candidate.qrTimeDeltaMinutes)));
    } else {
      addReason(manualReviewReasons, "qr_claim_late");
      addReason(reasonCodes, "qr_claim_late");
      matchFactors.push(factor("qr_time", "partial", qrTimeLabelFor(candidate.qrTimeDeltaMinutes)));
    }
  } else {
    const qrReason = request.qrClaimEvidenceStatus === "replayed"
      ? "qr_claim_replayed"
      : request.qrClaimEvidenceStatus === "invalid"
      ? "qr_claim_invalid"
      : "qr_claim_missing";
    addReason(manualReviewReasons, qrReason);
    addReason(reasonCodes, qrReason);
    matchFactors.push(factor(
      "qr_time",
      "missing",
      request.qrClaimEvidenceStatus === "replayed"
        ? "The QR claim was already used and cannot support this recommendation"
        : request.qrClaimEvidenceStatus === "invalid"
        ? "The QR claim could not be verified for this machine"
        : qrTimeLabelFor(null),
    ));
  }

  if (!request.cardLast4) {
    addReason(manualReviewReasons, "missing_customer_card_last4");
    addReason(reasonCodes, "missing_customer_card_last4");
    matchFactors.push(factor("card", "missing", "Customer card last four is missing"));
  } else if (!candidate.cardLast4) {
    addReason(manualReviewReasons, "missing_provider_card_last4");
    addReason(reasonCodes, "missing_provider_card_last4");
    matchFactors.push(factor("card", "missing", "Nayax did not return card last-four evidence"));
  } else if (request.cardLast4 === candidate.cardLast4) {
    rankingPoints += weights.exactCardLast4;
    addReason(reasonCodes, "card_last4_match");
    matchFactors.push(factor("card", "match", "Card last four matches"));
  } else if (
    request.cardWalletUsed ||
    candidate.recognitionMethod === "wallet" ||
    candidate.recognitionMethod === "contactless"
  ) {
    addReason(manualReviewReasons, "tokenized_last4_mismatch");
    addReason(reasonCodes, "tokenized_last4_noncorrelating");
    matchFactors.push(factor(
      "card",
      "manual",
      "Contactless or wallet last four did not correlate; it is treated as a clue, not proof",
    ));
  } else {
    hardExclusions.push("card_last4_mismatch");
    addReason(reasonCodes, "card_last4_mismatch");
    matchFactors.push(factor("card", "mismatch", "Card last four does not match"));
  }

  if (!request.cardNetwork || request.cardNetwork === "other_unknown") {
    addReason(reasonCodes, "customer_card_network_unknown");
    matchFactors.push(factor("card_network", "missing", "Customer card type is unknown"));
  } else if (!candidate.cardNetwork) {
    addReason(reasonCodes, "provider_card_network_unknown");
    matchFactors.push(factor("card_network", "missing", "Nayax did not return a recognized card type"));
  } else if (request.cardNetwork === candidate.cardNetwork) {
    rankingPoints += weights.exactCardNetwork;
    addReason(reasonCodes, "card_network_match");
    matchFactors.push(factor("card_network", "match", "Card type matches"));
  } else if (request.cardWalletUsed || candidate.recognitionMethod === "wallet") {
    addReason(reasonCodes, "wallet_card_network_mismatch");
    matchFactors.push(factor(
      "card_network",
      "manual",
      "Card type differs; wallet card details are supporting evidence only",
    ));
  } else {
    rankingPoints += weights.physicalCardNetworkMismatch;
    hardExclusions.push("card_network_mismatch");
    addReason(manualReviewReasons, "physical_card_network_mismatch");
    addReason(reasonCodes, "physical_card_network_mismatch");
    matchFactors.push(factor(
      "card_network",
      "mismatch",
      "Physical card type does not match the Nayax record",
    ));
  }

  if (request.cardWalletUsed || candidate.recognitionMethod === "wallet") {
    addReason(manualReviewReasons, "wallet_payment");
    addReason(reasonCodes, "wallet_payment");
    matchFactors.push(factor("wallet", "manual", "Wallet payments may be recommended, but remain manual in Nayax"));
  }

  if (candidate.currencyCode === "USD") {
    rankingPoints += weights.usdCurrency;
    addReason(reasonCodes, "currency_usd");
    matchFactors.push(factor("currency", "match", "Currency is USD"));
  } else if (candidate.currencyCode) {
    hardExclusions.push("currency_not_usd");
    addReason(reasonCodes, "currency_not_usd");
    matchFactors.push(factor("currency", "mismatch", "Currency is not USD"));
  } else {
    addReason(manualReviewReasons, "missing_currency_evidence");
    addReason(reasonCodes, "missing_currency_evidence");
    matchFactors.push(factor("currency", "missing", "Currency evidence is missing"));
  }

  if (candidate.paymentStatus === "approved") {
    rankingPoints += weights.approvedProviderStatus;
    if (candidate.paymentStatusEvidence === "last_sales_contract") {
      addReason(reasonCodes, "provider_last_sales_record");
      matchFactors.push(factor(
        "provider_status",
        "match",
        "Nayax returned this transaction from the machine's Last Sales feed",
      ));
    } else {
      addReason(reasonCodes, "provider_sale_approved");
      matchFactors.push(factor("provider_status", "match", "Nayax marks the sale approved"));
    }
  } else if (candidate.paymentStatus === "not approved") {
    hardExclusions.push("payment_not_approved");
    addReason(reasonCodes, "payment_not_approved");
    matchFactors.push(factor("provider_status", "mismatch", "Nayax does not mark this as an approved sale"));
  } else {
    addReason(manualReviewReasons, "provider_status_unconfirmed");
    addReason(reasonCodes, "provider_status_unconfirmed");
    matchFactors.push(factor("provider_status", "neutral", "Nayax returned a sale record without an explicit approval status"));
  }

  if (candidate.providerRefundState === "already_refunded" || transactionState === "already_refunded") {
    hardExclusions.push("already_refunded");
    addReason(manualReviewReasons, "already_refunded");
    addReason(reasonCodes, "already_refunded");
    matchFactors.push(factor("refund_state", "blocked", "This transaction already has refund evidence"));
  } else if (transactionState === "duplicate") {
    hardExclusions.push("duplicate_transaction");
    addReason(manualReviewReasons, "duplicate_transaction");
    addReason(reasonCodes, "duplicate_transaction");
    matchFactors.push(factor("refund_state", "blocked", "This transaction is already linked to another refund case"));
  }

  if (candidate.timeDeltaMinutes > policy.maximumOneClickTimeDeltaMinutes) {
    matchFactors.push(factor("one_click_window", "outside", "Transaction is outside the one-click time range"));
  }

  const selectionAllowed = hardExclusions.length === 0;
  const providerEvidenceComplete =
    candidate.siteId !== null &&
    candidate.providerTimeResolution === "exact" &&
    candidate.currencyCode === "USD" &&
    candidate.paymentStatus === "approved" &&
    !candidate.duplicateProviderRecord;
  const commonExactEvidence =
    selectionAllowed &&
    amountDeltaCents === 0 &&
    candidate.providerMachineId === request.expectedMachineId &&
    request.incidentTimeResolution === "exact" &&
    !["within_1_hour", "rough"].includes(request.incidentTimeConfidence) &&
    providerEvidenceComplete;
  const strongCardEligible =
    commonExactEvidence &&
    Boolean(request.cardLast4) &&
    Boolean(candidate.cardLast4) &&
    request.cardLast4 === candidate.cardLast4 &&
    candidate.timeDeltaMinutes <= policy.maximumOneClickTimeDeltaMinutes &&
    rankingPoints >= policy.highConfidenceMinimumPoints;
  const uniqueQrTimeEligible =
    commonExactEvidence &&
    request.qrClaimEvidenceStatus === "verified" &&
    candidate.qrTimeDeltaMinutes !== null &&
    candidate.qrTimeDeltaMinutes >= 0 &&
    candidate.qrTimeDeltaMinutes <= policy.maximumUniqueQrLagMinutes &&
    candidate.timeDeltaMinutes <= policy.maximumUniqueQrIncidentDeltaMinutes &&
    !hardExclusions.includes("card_last4_mismatch");

  return {
    ...candidate,
    rankingPoints,
    amountDeltaCents,
    matchFactors,
    manualReviewReasons,
    hardExclusions,
    reasonCodes,
    selectionAllowed,
    strongCardEligible,
    uniqueQrTimeEligible,
    oneClickEligible: false,
    isRecommended: false,
    isTopRanked: false,
    recommendationRank: 0,
    confidenceClass: "ambiguous_manual",
    matchStrength: manualReviewReasons.length > 0 || hardExclusions.length > 0 ? "manual_review" : "insufficient",
    matchReason: matchFactors.map((item) => item.label).join("; "),
  };
};

export const extractNayaxRecords = (payload) => {
  if (Array.isArray(payload)) return payload;
  const record = typeof payload === "object" && payload !== null ? payload : {};
  for (const key of ["data", "Data", "sales", "Sales", "result", "Result", "records", "Records"]) {
    if (Array.isArray(record[key])) return record[key];
  }
  return [];
};

/**
 * @param {{
 *   payload: unknown,
 *   incidentAt: string,
 *   expectedMachineId: string,
 *   locationTimezone: string,
 *   requestAmountCents: number | null,
 *   requestCardLast4: string,
 *   requestCardNetwork?: string | null,
 *   cardWalletUsed: boolean,
 *   incidentTimeConfidence?: string,
 *   incidentTimeResolution?: string,
 *   machineContext?: unknown,
 *   qrClaimOpenedAt?: string | null,
 *   qrClaimEvidenceStatus?: "verified" | "missing" | "invalid" | "replayed",
 *   transactionStates?: Map<string, string> | Record<string, string>,
 *   providerContract?: "nayax_machine_last_sales_v1" | "unverified",
 *   windowHours?: number,
 *   policy?: typeof NAYAX_RECOMMENDATION_POLICY,
 * }} input
 */
export const buildNayaxRecommendation = ({
  payload,
  incidentAt,
  expectedMachineId,
  locationTimezone,
  requestAmountCents,
  requestCardLast4,
  requestCardNetwork = null,
  cardWalletUsed,
  incidentTimeConfidence = "legacy_exact",
  incidentTimeResolution = "exact",
  machineContext = null,
  qrClaimOpenedAt = null,
  qrClaimEvidenceStatus,
  transactionStates = {},
  providerContract = "unverified",
  windowHours = NAYAX_RECOMMENDATION_POLICY.lookupWindowHours,
  policy = NAYAX_RECOMMENDATION_POLICY,
}) => {
  const incidentDate = parseDateValue(incidentAt);
  if (!incidentDate) throw new Error("A valid incident time is required for Nayax recommendation scoring.");
  const qrClaimOpenedDate = parseDateValue(qrClaimOpenedAt);
  const normalizedQrClaimStatus = ["verified", "missing", "invalid", "replayed"].includes(qrClaimEvidenceStatus)
    ? qrClaimEvidenceStatus
    : qrClaimOpenedDate
    ? "verified"
    : "missing";

  const request = {
    expectedMachineId: sanitizeText(expectedMachineId, 120),
    amountCents: asNonNegativeCents(requestAmountCents),
    cardLast4: extractLast4(requestCardLast4),
    cardNetwork: normalizeCardNetwork(requestCardNetwork),
    cardWalletUsed: Boolean(cardWalletUsed),
    incidentTimeConfidence: sanitizeText(incidentTimeConfidence, 40) || "legacy_exact",
    incidentTimeResolution: sanitizeText(incidentTimeResolution, 40) || "legacy_absolute",
    qrClaimEvidenceStatus: normalizedQrClaimStatus === "verified" && !qrClaimOpenedDate
      ? "invalid"
      : normalizedQrClaimStatus,
  };
  const windowMs = Math.max(1, Number(windowHours) || policy.lookupWindowHours) * 60 * 60 * 1000;
  const windowStartMs = incidentDate.getTime() - windowMs;
  const windowEndMs = incidentDate.getTime() + windowMs;
  const normalizedByTransaction = new Map();
  let parseableRecordCount = 0;
  let windowRecordCount = 0;

  for (const item of extractNayaxRecords(payload)) {
    const record = typeof item === "object" && item !== null ? item : {};
    const transactionId = sanitizeText(
      record.TransactionID ?? record.TransactionId ?? record.transactionId ?? record.transaction_id,
      80,
    );
    const providerTime = parseProviderAuthorizationDate(record, sanitizeText(locationTimezone, 80));
    const authorizationDate = providerTime?.date ?? null;
    if (!transactionId || !authorizationDate || !providerTime) continue;
    parseableRecordCount += 1;
    if (authorizationDate.getTime() < windowStartMs || authorizationDate.getTime() > windowEndMs) continue;
    windowRecordCount += 1;

    if (normalizedByTransaction.has(transactionId)) {
      // A duplicated provider ID is an anomaly even when the visible fields
      // appear identical. Keep one candidate for manager review, but never let
      // that provider ambiguity become a one-click recommendation.
      normalizedByTransaction.get(transactionId).duplicateProviderRecord = true;
      continue;
    }
    const machineAuthorizationDate = authorizationDate;
    const paymentStatus = normalizePaymentStatus(record, providerContract);
    normalizedByTransaction.set(transactionId, {
      transactionId,
      siteId: integerValue(record.SiteID ?? record.SiteId ?? record.siteId),
      providerMachineId: sanitizeText(record.MachineID ?? record.MachineId ?? record.machineId, 120),
      authorizedAt: authorizationDate.toISOString(),
      machineAuthorizationTime: machineAuthorizationDate.toISOString(),
      providerTimeResolution: providerTime.resolution,
      // Round outward so a transaction even one second beyond a safety boundary
      // cannot be admitted by display-oriented minute rounding.
      timeDeltaMinutes: Math.ceil(Math.abs(authorizationDate.getTime() - incidentDate.getTime()) / 60000),
      qrTimeDeltaMinutes: qrClaimOpenedDate
        ? (() => {
            const delta = (qrClaimOpenedDate.getTime() - authorizationDate.getTime()) / 60000;
            // Round away from zero so even a one-second boundary overrun fails
            // closed instead of appearing to fit the QR safety window.
            return delta >= 0 ? Math.ceil(delta) : Math.floor(delta);
          })()
        : null,
      amountCents: moneyToCents(record.AuthorizationValue ?? record.SettlementValue),
      currencyCode: sanitizeText(record.CurrencyCode ?? record.currencyCode, 3).toUpperCase(),
      cardLast4: extractLast4(record.CardNumber ?? record.cardNumber),
      cardNetwork: normalizeCardNetwork(
        record.CardBrand ?? record.cardBrand ?? record.CardType ?? record.cardType ??
          record.CardNetwork ?? record.cardNetwork,
      ),
      cardBrand: cardNetworkLabel(normalizeCardNetwork(
        record.CardBrand ?? record.cardBrand ?? record.CardType ?? record.cardType ??
          record.CardNetwork ?? record.cardNetwork,
      )),
      recognitionMethod: normalizeRecognitionMethod(record.RecognitionMethod ?? record.recognitionMethod),
      paymentStatus: paymentStatus.status,
      paymentStatusEvidence: paymentStatus.evidence,
      providerRefundState: normalizeProviderRefundState(record),
      duplicateProviderRecord: false,
      ...buildNayaxCandidateContext({
        record,
        machineContext,
        authorizedAt: authorizationDate.toISOString(),
      }),
    });
  }

  const candidates = [...normalizedByTransaction.values()]
    .map((candidate) =>
      scoreCandidate({
        candidate,
        request,
        transactionState: transactionStateFor(transactionStates, candidate.transactionId),
        policy,
      }))
    .sort((left, right) =>
      right.rankingPoints - left.rankingPoints ||
      (left.amountDeltaCents ?? Number.POSITIVE_INFINITY) -
        (right.amountDeltaCents ?? Number.POSITIVE_INFINITY) ||
      left.timeDeltaMinutes - right.timeDeltaMinutes ||
      left.authorizedAt.localeCompare(right.authorizedAt) ||
      left.transactionId.localeCompare(right.transactionId))
    .slice(0, policy.candidateLimit)
    .map((candidate, index) => ({ ...candidate, recommendationRank: index + 1, isTopRanked: index === 0 }));

  const topOverall = candidates[0] ?? null;
  const strongCardCandidates = candidates.filter((candidate) => candidate.strongCardEligible);
  const qrTimeCandidates = candidates.filter((candidate) => candidate.uniqueQrTimeEligible);
  let recommendationState = "no_safe_match";
  let confidenceClass = "ambiguous_manual";
  let recommendedTransactionId = null;
  let resultReasonCodes = [];

  if (strongCardCandidates.length === 1) {
    recommendationState = "high_confidence";
    confidenceClass = "strong_card";
    recommendedTransactionId = strongCardCandidates[0].transactionId;
    resultReasonCodes = [...strongCardCandidates[0].reasonCodes, "unique_strong_card_candidate"];
  } else if (strongCardCandidates.length > 1) {
    recommendationState = "ambiguous";
    resultReasonCodes = ["multiple_strong_card_candidates", "plausible_runner_up"];
  } else if (qrTimeCandidates.length === 1) {
    recommendationState = "high_confidence";
    confidenceClass = "unique_qr_time";
    recommendedTransactionId = qrTimeCandidates[0].transactionId;
    resultReasonCodes = [...qrTimeCandidates[0].reasonCodes, "unique_qr_time_candidate"];
  } else if (qrTimeCandidates.length > 1) {
    recommendationState = "ambiguous";
    resultReasonCodes = ["multiple_qr_time_candidates", "plausible_runner_up"];
  } else if (candidates.length > 0) {
    recommendationState = "manual_exception";
    resultReasonCodes = topOverall?.reasonCodes.length
      ? topOverall.reasonCodes
      : ["insufficient_evidence"];
  } else {
    resultReasonCodes = ["no_candidate_in_lookup_window"];
  }

  const finalizedCandidates = candidates.map((candidate) => {
    const isRecommended = Boolean(recommendedTransactionId && candidate.transactionId === recommendedTransactionId);
    const matchStrength = isRecommended
      ? "strong"
      : recommendationState === "ambiguous" && (candidate.strongCardEligible || candidate.uniqueQrTimeEligible)
        ? "compare"
        : candidate.manualReviewReasons.length > 0 || candidate.hardExclusions.length > 0
          ? "manual_review"
          : "insufficient";
    const oneClickEligible =
      isRecommended &&
      recommendationState === "high_confidence" &&
      confidenceClass === "strong_card" &&
      !request.cardWalletUsed &&
      candidate.recognitionMethod !== "wallet";
    return {
      ...candidate,
      policyVersion: policy.version,
      recommendationState,
      isRecommended,
      oneClickEligible,
      confidenceClass: isRecommended ? confidenceClass : "ambiguous_manual",
      matchStrength,
    };
  });

  const copy = {
    high_confidence: confidenceClass === "unique_qr_time"
      ? {
          summary: "Nayax found exactly one sale supported by the machine, amount, QR start, and timing.",
          recommendedAction: "Verify the sale in Nayax and use the manual portal path. QR/time evidence does not enable one-click refund.",
        }
      : {
          summary: "Nayax found exactly one sale with matching card, machine, amount, and reported time.",
          recommendedAction: request.cardWalletUsed
            ? "Verify the wallet sale in Nayax and use the manual portal path. One-click refund stays unavailable."
            : "Confirm the recommended sale. Only then may the separately guarded refund action become eligible.",
        },
    ambiguous: {
      summary: "Nayax found multiple plausible card sales that are too close to recommend safely.",
      recommendedAction: "Compare the alternatives and record why the manager chose a different sale. One-click refund stays unavailable.",
    },
    manual_exception: {
      summary: "Nayax found a possible sale, but one or more details still need a manager to compare them.",
      recommendedAction: "Compare the customer details with the possible sale before choosing the next step.",
    },
    no_safe_match: {
      summary: windowRecordCount > 0
        ? "Nayax found sales in the time window, but none met the safe recommendation rules."
        : "Nayax found no card sales in the configured incident window.",
      recommendedAction: "Ask the customer for another detail or continue with manual review. One-click refund stays unavailable.",
    },
  }[recommendationState];

  return {
    policyVersion: policy.version,
    recommendationState,
    confidenceClass,
    reasonCodes: resultReasonCodes,
    oneClickEligible: finalizedCandidates.some((candidate) => candidate.oneClickEligible),
    qrClaimEvidenceStatus: request.qrClaimEvidenceStatus,
    qrClaimOpenedAt: qrClaimOpenedDate?.toISOString() ?? null,
    maximumUniqueQrLagMinutes: policy.maximumUniqueQrLagMinutes,
    candidates: finalizedCandidates,
    candidateCount: finalizedCandidates.length,
    providerParseableRecordCount: parseableRecordCount,
    providerWindowRecordCount: windowRecordCount,
    summary: copy.summary,
    recommendedAction: copy.recommendedAction,
  };
};

export const toPublicNayaxCandidate = (candidate, candidateToken) => ({
  candidateToken,
  machineDisplayLabel: candidate.machineDisplayLabel ?? null,
  authorizedAt: candidate.authorizedAt,
  machineAuthorizationTime: candidate.machineAuthorizationTime,
  amountCents: candidate.amountCents,
  amountDeltaCents: candidate.amountDeltaCents,
  timeDeltaMinutes: candidate.timeDeltaMinutes,
  qrTimeDeltaMinutes: candidate.qrTimeDeltaMinutes,
  currencyCode: candidate.currencyCode,
  cardLast4: candidate.cardLast4,
  cardBrand: candidate.cardBrand,
  cardNetwork: candidate.cardNetwork,
  recognitionMethod: candidate.recognitionMethod,
  paymentStatus: candidate.paymentStatus,
  productLabel: candidate.productLabel,
  productCode: candidate.productCode,
  standardPriceCents: candidate.standardPriceCents,
  priceMatchesMachineConfiguration: candidate.priceMatchesMachineConfiguration,
  machineStatus: candidate.machineStatus,
  nearbyMachineAlerts: candidate.nearbyMachineAlerts,
  recommendationRank: candidate.recommendationRank,
  isTopRanked: candidate.isTopRanked,
  isRecommended: candidate.isRecommended,
  recommendationState: candidate.recommendationState,
  confidenceClass: candidate.confidenceClass,
  reasonCodes: candidate.reasonCodes,
  oneClickEligible: candidate.oneClickEligible,
  selectionAllowed: candidate.selectionAllowed,
  matchStrength: candidate.matchStrength,
  matchFactors: candidate.matchFactors,
  manualReviewReasons: candidate.manualReviewReasons,
  hardExclusions: candidate.hardExclusions,
  matchReason: candidate.matchReason,
  policyVersion: candidate.policyVersion,
});
