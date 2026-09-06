import { resolveLocalDateTimeInZone } from "./timezone-resolution.mjs";
import { buildNayaxCandidateContext } from "./nayax-machine-context.mjs";
import { classifyRefundRequestTimeBoundary } from "./refund-request-time-boundary.mjs";
import {
  classifyNayaxIdentifierEvidence,
  NAYAX_IDENTIFIER_POLICY_VERSION,
} from "./nayax-identifier-evidence.mjs";

// Deterministic Nayax recommendation policy for Refund Operations.
//
// Ranking points are ordering evidence, not a calibrated probability. The UI and
// API expose advisory words (strong evidence, compare candidates, manual review)
// instead of presenting these points as a percentage.
export const NAYAX_RECOMMENDATION_POLICY = Object.freeze({
  version: "2026-09-05.v11",
  candidateLimit: 10,
  lookupWindowHours: 6,
  highConfidenceMinimumPoints: 80,
  maximumOneClickTimeDeltaMinutes: 60,
  maximumStrongCardAmountDeltaCents: 300,
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
    last4MismatchNegativeEvidence: -12,
    cardNetworkMismatchNegativeEvidence: -4,
    paymentInteractionConflict: -8,
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

const parseProviderMachineAuthorizationDate = (record, machineTimezone, machineClockVerified) => {
  // Retain only a bounded date-time, verbatim. The provider's machine clock is
  // distinct from AuthorizationDateTimeGMT and is not reconstructed from it.
  const raw = record.MachineAuthorizationTime;
  if (typeof raw !== "string" || raw.length > 80) return null;
  const localMatch = raw.match(
    /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})?$/i,
  );
  if (!localMatch) return null;
  const calendar = resolveLocalDateTimeInZone({
    localDate: localMatch[1], localTime: localMatch[2], timeZone: "UTC",
  });
  if (calendar.resolution !== "exact") return null;
  if (localMatch[4]) {
    const date = new Date(raw.replace(" ", "T"));
    return Number.isFinite(date.getTime())
      ? { date, resolution: "exact", raw, source: "machine_authorization_offset" }
      : null;
  }
  if (!machineTimezone) return null;
  const resolved = resolveLocalDateTimeInZone({
    localDate: localMatch[1],
    localTime: localMatch[2],
    timeZone: machineTimezone,
  });
  if (!["exact", "ambiguous"].includes(resolved.resolution)) return null;
  // Date stores milliseconds only. Keep all original fractional digits in raw;
  // this derived instant is for comparison/display, not payment serialization.
  const milliseconds = Number((localMatch[3] ?? "").padEnd(3, "0").slice(0, 3));
  const date = resolved.instant ? new Date(Date.parse(resolved.instant) + milliseconds) : null;
  return date && !Number.isNaN(date.getTime())
    ? {
        date,
        resolution: resolved.resolution,
        raw,
        source: machineClockVerified ? "verified_machine_clock" : "unverified_location_clock",
      }
    : null;
};

const parseProviderAuthorizationDate = (record, machineTime) => {
  const gmtValue = sanitizeText(record.AuthorizationDateTimeGMT ?? record.AuthorizationDateTimeGmt, 120);
  if (gmtValue) {
    const date = parseDateValue(gmtValue);
    return date ? { date, resolution: "exact", source: "authorization_gmt" } : null;
  }
  return machineTime;
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
  if (value === null || value === undefined || value === "" || typeof value === "boolean") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? Math.round(numeric) : null;
};

const transactionStateFor = (transactionStates, transactionId) => {
  if (transactionStates instanceof Map) return transactionStates.get(transactionId) ?? "clear";
  return transactionStates?.[transactionId] ?? "clear";
};

const factor = (key, outcome, label) => ({ key, outcome, label });

const timePointsFor = (deltaMinutes, weights) => {
  if (!Number.isFinite(deltaMinutes)) return 0;
  if (deltaMinutes <= 15) return weights.timeWithin15Minutes;
  if (deltaMinutes <= 60) return weights.timeWithin60Minutes;
  if (deltaMinutes <= 180) return weights.timeWithin3Hours;
  return weights.timeWithinLookupWindow;
};

const timeLabelFor = (deltaMinutes) => {
  if (!Number.isFinite(deltaMinutes)) {
    return "Customer-reported purchase time cannot be compared with this provider processing timestamp";
  }
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
  const identifierEvidence = classifyNayaxIdentifierEvidence({
    customerLast4: request.cardLast4,
    providerLast4: candidate.cardLast4,
    paymentInteraction: request.paymentInteraction,
    cardLast4Source: request.cardLast4Source,
    cardLast4Provenance: request.cardLast4Provenance,
    walletDeviceKind: request.walletDeviceKind,
    customerNetwork: request.cardNetwork,
    providerNetwork: candidate.cardNetwork,
    providerRecognitionMethod: candidate.recognitionMethod,
  });

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

  if (request.incidentTimeConfidence === "rough") {
    addReason(manualReviewReasons, `customer_time_${request.incidentTimeConfidence}`);
    addReason(reasonCodes, `customer_time_${request.incidentTimeConfidence}`);
    matchFactors.push(factor(
      "customer_time_confidence",
      "manual",
      "Customer said the purchase time is only a rough estimate",
    ));
  } else if (request.incidentTimeConfidence === "within_1_hour") {
    addReason(reasonCodes, "customer_time_within_1_hour");
    matchFactors.push(factor(
      "customer_time_confidence",
      "partial",
      "Customer estimated the purchase time within about an hour",
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

  if (candidate.machineTimeResolution !== "exact") {
    addReason(manualReviewReasons, "machine_authorization_time_unverified");
    addReason(reasonCodes, "machine_authorization_time_unverified");
    matchFactors.push(factor("machine_time", "manual", "Nayax machine time needs time-zone review"));
  }

  if (candidate.requestTimeBoundaryState === "request_time_unknown") {
    addReason(manualReviewReasons, "customer_request_time_unknown");
    addReason(reasonCodes, "customer_request_time_unknown");
    matchFactors.push(factor(
      "request_time",
      "manual",
      "Bloomjoy does not have a reliable original request receipt time for this case; compare the transaction manually",
    ));
  } else if (candidate.requestTimeBoundaryState === "occurrence_time_uncertain") {
    addReason(manualReviewReasons, "transaction_occurrence_time_uncertain");
    addReason(reasonCodes, "transaction_occurrence_time_uncertain");
    matchFactors.push(factor(
      "request_time",
      "manual",
      "This Nayax timestamp may reflect online authorization, delayed synchronization, or provider posting. Use it as supporting evidence, not proof that the purchase happened after the request",
    ));
  } else {
    addReason(reasonCodes, "transaction_before_or_at_customer_request");
    matchFactors.push(factor(
      "request_time",
      "match",
      "Transaction occurred before Bloomjoy received the customer request",
    ));
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
  } else if (amountDeltaCents !== null && amountDeltaCents <= policy.maximumStrongCardAmountDeltaCents) {
    rankingPoints += weights.nearAmount;
    addReason(reasonCodes, "amount_within_tolerance");
    matchFactors.push(factor("amount", "partial", `Transaction amount differs by $${(amountDeltaCents / 100).toFixed(2)}; this may reflect tax or rounding`));
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
  if (!Number.isFinite(candidate.timeDeltaMinutes)) {
    addReason(manualReviewReasons, "transaction_occurrence_time_uncertain");
    addReason(reasonCodes, "transaction_occurrence_time_uncertain");
  } else if (candidate.timeDeltaMinutes <= policy.maximumOneClickTimeDeltaMinutes) {
    addReason(reasonCodes, "incident_time_within_60m");
  } else if (candidate.timeDeltaMinutes <= policy.maximumUniqueQrIncidentDeltaMinutes) {
    addReason(reasonCodes, "incident_time_within_3h");
  } else {
    addReason(manualReviewReasons, "incident_time_too_far");
    addReason(reasonCodes, "incident_time_too_far");
  }
  matchFactors.push(factor(
    "incident_time",
    Number.isFinite(candidate.timeDeltaMinutes) &&
      candidate.timeDeltaMinutes <= policy.maximumOneClickTimeDeltaMinutes ? "match" : "manual",
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

  if (request.cardLast4 && !request.cardLast4Source && !request.cardLast4Provenance) {
    addReason(manualReviewReasons, "customer_card_last4_source_unknown");
    addReason(reasonCodes, "customer_card_last4_source_unknown");
    matchFactors.push(factor("card_source", "manual", "Where the customer found the last four digits is not known"));
  }

  if (!request.cardLast4) {
    addReason(manualReviewReasons, "missing_customer_card_last4");
    addReason(reasonCodes, "missing_customer_card_last4");
    matchFactors.push(factor("card", "missing", "Customer card last four is missing"));
  } else if (!candidate.cardLast4) {
    addReason(manualReviewReasons, "missing_provider_card_last4");
    addReason(reasonCodes, "missing_provider_card_last4");
    matchFactors.push(factor("card", "missing", "Nayax did not return card last-four evidence"));
  } else if (identifierEvidence.cardLast4Comparison === "exact_support") {
    rankingPoints += weights.exactCardLast4;
    addReason(reasonCodes, "card_last4_match");
    matchFactors.push(factor("card", "match", "Card last four matches"));
  } else {
    if (identifierEvidence.cardLast4Comparison === "mismatch_negative_unproven_equivalence") {
      rankingPoints += weights.last4MismatchNegativeEvidence;
      addReason(reasonCodes, "card_last4_mismatch_negative_unproven_equivalence");
    } else {
      addReason(reasonCodes, "card_last4_mismatch_neutral_unproven_scope");
    }
    addReason(manualReviewReasons, "card_last4_mismatch_reviewable");
    addReason(reasonCodes, "card_last4_mismatch");
    matchFactors.push(factor(
      "card",
      "manual",
      identifierEvidence.cardLast4Comparison === "mismatch_negative_unproven_equivalence"
        ? "Card digits differ and weigh against this sale, but Nayax has not proved the two fields represent the same identifier"
        : "Card digits differ; contactless, wallet, bank-record, or unknown-source digits may represent a different identifier",
    ));
  }

  if (!request.cardNetwork || request.cardNetwork === "other_unknown") {
    addReason(reasonCodes, "customer_card_network_unknown");
    matchFactors.push(factor("card_network", "missing", "Customer card type is unknown"));
  } else if (!candidate.cardNetwork) {
    addReason(reasonCodes, "provider_card_network_unknown");
    matchFactors.push(factor("card_network", "missing", "Nayax did not return a recognized card type"));
  } else if (identifierEvidence.cardNetworkComparison === "exact_support") {
    rankingPoints += weights.exactCardNetwork;
    addReason(reasonCodes, "card_network_match");
    matchFactors.push(factor("card_network", "match", "Card type matches"));
  } else {
    if (identifierEvidence.cardNetworkComparison === "mismatch_negative_unproven_equivalence") {
      rankingPoints += weights.cardNetworkMismatchNegativeEvidence;
      addReason(reasonCodes, "card_network_mismatch_negative_unproven_equivalence");
    } else {
      addReason(reasonCodes, "card_network_mismatch_neutral_unproven_scope");
    }
    addReason(manualReviewReasons, "card_network_mismatch_reviewable");
    addReason(reasonCodes, "card_network_mismatch");
    matchFactors.push(factor(
      "card_network",
      "manual",
      "Card type differs, but Nayax has not proved this field has the same meaning for every card and wallet interaction",
    ));
  }

  if (identifierEvidence.paymentInteractionComparison === "conflict_unverified_provider_semantics") {
    rankingPoints += weights.paymentInteractionConflict;
    addReason(manualReviewReasons, "payment_interaction_conflict_reviewable");
    addReason(reasonCodes, "payment_interaction_conflict_unverified_provider_semantics");
    matchFactors.push(factor(
      "payment_interaction",
      "manual",
      "Customer and Nayax interaction labels differ; Nayax recognition-method semantics remain unverified",
    ));
  } else if (identifierEvidence.paymentInteractionComparison === "supporting") {
    addReason(reasonCodes, "payment_interaction_supporting");
    matchFactors.push(factor("payment_interaction", "match", "Customer and Nayax interaction details are consistent"));
  }

  if (request.cardWalletUsed || candidate.recognitionMethod === "wallet") {
    addReason(manualReviewReasons, "wallet_payment");
    addReason(reasonCodes, "wallet_payment");
    matchFactors.push(factor(
      "wallet",
      "manual",
      "Wallet identifiers need manager review before the exact provider transaction can be refunded",
    ));
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

  if (Number.isFinite(candidate.timeDeltaMinutes) &&
    candidate.timeDeltaMinutes > policy.maximumOneClickTimeDeltaMinutes) {
    matchFactors.push(factor("one_click_window", "outside", "Transaction is outside the one-click time range"));
  }

  const mismatchPresent = [
    identifierEvidence.cardLast4Comparison,
    identifierEvidence.cardNetworkComparison,
  ].some((comparison) => comparison.startsWith("mismatch_"));
  const providerEvidenceComplete =
    candidate.amountCents > 0 &&
    candidate.siteId !== null &&
    candidate.providerTimeResolution === "exact" &&
    candidate.machineTimeResolution === "exact" &&
    Boolean(candidate.machineAuthorizationTimeRaw) &&
    candidate.currencyCode === "USD" &&
    candidate.paymentStatus === "approved" &&
    !candidate.duplicateProviderRecord;
  const commonProviderEvidence =
    hardExclusions.length === 0 &&
    candidate.providerMachineId === request.expectedMachineId &&
    request.incidentTimeResolution === "exact" &&
    request.incidentTimeConfidence !== "rough" &&
    providerEvidenceComplete;
  const exactCustomerOccurrenceEvidence =
    request.incidentTimeSource === "transaction_alert_or_receipt" &&
    ["exact", "within_15_minutes"].includes(request.incidentTimeConfidence) &&
    request.nearbyAttemptCount === "one";
  const corroboratedMismatchReviewEligible =
    commonProviderEvidence &&
    exactCustomerOccurrenceEvidence &&
    mismatchPresent &&
    (!Number.isFinite(candidate.timeDeltaMinutes) ||
      candidate.timeDeltaMinutes <= policy.maximumOneClickTimeDeltaMinutes);
  const neutralPhysicalContactlessMismatch =
    identifierEvidence.customerCredentialClass === "customer_physical_contactless_pan" &&
    identifierEvidence.cardLast4Comparison === "mismatch_neutral_unproven_scope" &&
    identifierEvidence.cardNetworkComparison !== "mismatch_negative_unproven_equivalence";
  const managerSelectionSafetyCore =
    hardExclusions.length === 0 &&
    candidate.providerMachineId === request.expectedMachineId &&
    request.amountCents > 0 &&
    candidate.amountCents > 0 &&
    amountDeltaCents !== null &&
    candidate.siteId !== null &&
    candidate.providerTimeResolution === "exact" &&
    candidate.machineTimeResolution === "exact" &&
    Boolean(candidate.machineAuthorizationTimeRaw) &&
    candidate.currencyCode === "USD" &&
    candidate.paymentStatus === "approved" &&
    ["explicit", "last_sales_contract"].includes(candidate.paymentStatusEvidence) &&
    candidate.providerRefundState === "clear" &&
    candidate.requestTimeBoundaryState !== "after_request" &&
    !candidate.duplicateProviderRecord;
  const customerTimeSupportsSelection =
    ["exact", "legacy_absolute"].includes(request.incidentTimeResolution) &&
    request.incidentTimeConfidence !== "rough";
  const exactCardSupportsSelection =
    identifierEvidence.cardLast4Comparison === "exact_support";
  const managerSelectionCore = managerSelectionSafetyCore &&
    (customerTimeSupportsSelection || exactCardSupportsSelection);
  const evidenceAwareReviewEligible =
    corroboratedMismatchReviewEligible ||
    (managerSelectionCore && neutralPhysicalContactlessMismatch);
  const softTimeNeedsDistinguishingEvidence =
    managerSelectionSafetyCore &&
    !customerTimeSupportsSelection &&
    !exactCardSupportsSelection;
  const identifierReviewState = hardExclusions.length > 0
    ? "blocked_safety"
    : evidenceAwareReviewEligible
    ? "reviewable_uncertainty"
    : mismatchPresent
    ? "needs_corroboration"
    : softTimeNeedsDistinguishingEvidence
    ? "needs_corroboration"
    : identifierEvidence.cardLast4Comparison === "exact_support"
    ? "exact_support"
    : "no_identifier_conflict";
  const cardLast4SourceKnown =
    ["physical_card", "wallet_device", "bank_record"].includes(request.cardLast4Source) ||
    ["physical_card", "wallet_device_token"].includes(request.cardLast4Provenance);
  const customerCorrectionFields = softTimeNeedsDistinguishingEvidence
    ? ["incident_time"]
    : identifierReviewState === "needs_corroboration"
    ? [
        amountDeltaCents !== 0 && "amount",
        (Number.isFinite(candidate.timeDeltaMinutes) &&
          candidate.timeDeltaMinutes > policy.maximumOneClickTimeDeltaMinutes ||
          request.incidentTimeResolution !== "exact" ||
          !["exact", "within_15_minutes"].includes(request.incidentTimeConfidence) ||
          request.nearbyAttemptCount === "multiple") && "incident_time",
        (!request.paymentInteraction || ["unsure", "insert_or_swipe"].includes(request.paymentInteraction)) && "payment_interaction",
        !cardLast4SourceKnown && "card_last4_source",
        (!request.cardNetwork || request.cardNetwork === "other_unknown") && "card_network",
        request.paymentInteraction === "phone_watch_wallet" &&
          (!request.walletDeviceKind || request.walletDeviceKind === "unknown") && "wallet_device_kind",
        request.incidentTimeSource !== "transaction_alert_or_receipt" && "incident_time_source",
        request.nearbyAttemptCount !== "one" && "nearby_attempt_count",
      ].filter(Boolean)
    : [];
  const selectionAllowed = managerSelectionCore &&
    (!mismatchPresent || evidenceAwareReviewEligible);
  const strongCardEligible =
    commonProviderEvidence &&
    candidate.requestTimeBoundaryState === "before_or_at_request" &&
    !mismatchPresent &&
    request.amountCents > 0 &&
    amountDeltaCents !== null &&
    amountDeltaCents <= policy.maximumStrongCardAmountDeltaCents &&
    Boolean(request.cardLast4) &&
    Boolean(request.cardLast4Provenance) &&
    Boolean(candidate.cardLast4) &&
    request.cardLast4 === candidate.cardLast4 &&
    candidate.timeDeltaMinutes !== null &&
    candidate.timeDeltaMinutes <= policy.maximumOneClickTimeDeltaMinutes &&
    rankingPoints >= policy.highConfidenceMinimumPoints;
  const uniqueQrTimeEligible =
    commonProviderEvidence &&
    candidate.requestTimeBoundaryState === "before_or_at_request" &&
    amountDeltaCents === 0 &&
    request.incidentTimeConfidence !== "within_1_hour" &&
    request.qrClaimEvidenceStatus === "verified" &&
    candidate.qrTimeDeltaMinutes !== null &&
    candidate.qrTimeDeltaMinutes >= 0 &&
    candidate.qrTimeDeltaMinutes <= policy.maximumUniqueQrLagMinutes &&
    candidate.timeDeltaMinutes !== null &&
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
    identifierPolicyVersion: identifierEvidence.policyVersion,
    customerFactVersion: request.customerFactVersion,
    ...identifierEvidence,
    identifierReviewState,
    customerCorrectionFields,
    evidenceAwareReviewEligible,
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
 *   customerRequestReceivedAt?: string | null,
 *   customerRequestReceivedSource?: string | null,
 *   expectedMachineId: string,
 *   locationTimezone: string,
 *   providerClockContext?: { reportingMachineId: string, timezone: string | null, source: string, observedAt: string | null } | null,
 *   requestAmountCents: number | null,
 *   requestCardLast4: string,
 *   requestCardLast4Provenance?: string | null,
 *   requestCardLast4Source?: string | null,
 *   requestCardNetwork?: string | null,
 *   cardWalletUsed: boolean,
 *   paymentInteraction?: string | null,
 *   walletDeviceKind?: string | null,
 *   incidentTimeSource?: string | null,
 *   nearbyAttemptCount?: string | number | null,
 *   customerFactVersion?: number | null,
 *   incidentTimeConfidence?: string,
 *   incidentTimeResolution?: string,
 *   machineContext?: unknown,
 *   qrClaimOpenedAt?: string | null,
 *   qrClaimEvidenceStatus?: "verified" | "missing" | "invalid" | "replayed",
 *   transactionStates?: Map<string, string> | Record<string, string>,
 *   providerContract?: "nayax_machine_last_sales_v1" | "unverified",
 *   purchaseOccurrenceProof?: {
 *     semantics: "online_purchase_occurrence",
 *     source: "verified_provider_purchase_occurrence_v1",
 *     timestampSource: "authorization_gmt" | "machine_authorization_offset" | "verified_machine_clock",
 *     timezoneBasis: "utc" | "embedded_offset" | "verified_machine_timezone",
 *     transactionPrecisionMs: number,
 *     transactionClockErrorMs: number,
 *     requestReceiptPrecisionMs: number,
 *     requestReceiptClockErrorMs: number,
 *   } | null,
 *   windowHours?: number,
 *   policy?: typeof NAYAX_RECOMMENDATION_POLICY,
 * }} input
 */
export const buildNayaxRecommendation = ({
  payload,
  incidentAt,
  customerRequestReceivedAt = null,
  customerRequestReceivedSource = null,
  expectedMachineId,
  locationTimezone,
  providerClockContext = null,
  requestAmountCents,
  requestCardLast4,
  requestCardLast4Provenance = null,
  requestCardLast4Source = null,
  requestCardNetwork = null,
  cardWalletUsed,
  paymentInteraction = null,
  walletDeviceKind = null,
  incidentTimeSource = null,
  nearbyAttemptCount = null,
  customerFactVersion = null,
  incidentTimeConfidence = "legacy_exact",
  incidentTimeResolution = "exact",
  machineContext = null,
  qrClaimOpenedAt = null,
  qrClaimEvidenceStatus,
  transactionStates = {},
  providerContract = "unverified",
  purchaseOccurrenceProof = null,
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
    cardLast4Provenance: ["physical_card", "wallet_device_token"].includes(requestCardLast4Provenance)
      ? requestCardLast4Provenance
      : null,
    cardLast4Source: ["physical_card", "wallet_device", "bank_record", "unknown"].includes(requestCardLast4Source)
      ? requestCardLast4Source
      : null,
    cardNetwork: normalizeCardNetwork(requestCardNetwork),
    cardWalletUsed: Boolean(cardWalletUsed),
    paymentInteraction: ["phone_watch_wallet", "tap_card", "insert_card", "swipe_card", "insert_or_swipe", "unsure"]
      .includes(paymentInteraction) ? paymentInteraction : cardWalletUsed ? "phone_watch_wallet" : null,
    walletDeviceKind: ["phone", "watch", "unknown"].includes(walletDeviceKind) ? walletDeviceKind : null,
    incidentTimeSource: ["transaction_alert_or_receipt", "memory", "unknown"].includes(incidentTimeSource)
      ? incidentTimeSource : null,
    nearbyAttemptCount: ["one", "multiple", "unknown"].includes(nearbyAttemptCount)
      ? nearbyAttemptCount : null,
    customerFactVersion: Number.isInteger(Number(customerFactVersion)) && Number(customerFactVersion) > 0
      ? Number(customerFactVersion) : null,
    incidentTimeConfidence: sanitizeText(incidentTimeConfidence, 40) || "legacy_exact",
    incidentTimeResolution: sanitizeText(incidentTimeResolution, 40) || "legacy_absolute",
    customerRequestReceivedAt: sanitizeText(customerRequestReceivedAt, 80) || null,
    customerRequestReceivedSource: sanitizeText(customerRequestReceivedSource, 80) || null,
    qrClaimEvidenceStatus: normalizedQrClaimStatus === "verified" && !qrClaimOpenedDate
      ? "invalid"
      : normalizedQrClaimStatus,
  };
  const windowMs = Math.max(1, Number(windowHours) || policy.lookupWindowHours) * 60 * 60 * 1000;
  const windowStartMs = incidentDate.getTime() - windowMs;
  const windowEndMs = incidentDate.getTime() + windowMs;
  const normalizedByTransaction = new Map();
  const seenTransactionIds = new Set();
  let parseableRecordCount = 0;
  let windowRecordCount = 0;
  let excludedAfterRequestCount = 0;

  const boundedUncertainty = (value) =>
    typeof value === "number" && Number.isFinite(value) &&
      value >= 0 && value <= 24 * 60 * 60 * 1000 ? value : null;
  const purchaseOccurrenceClockBasis = {
    authorization_gmt: "utc",
    machine_authorization_offset: "embedded_offset",
    verified_machine_clock: "verified_machine_timezone",
  };
  const occurrenceProof = purchaseOccurrenceProof?.semantics === "online_purchase_occurrence"
    && purchaseOccurrenceProof?.source === "verified_provider_purchase_occurrence_v1"
    && Object.hasOwn(purchaseOccurrenceClockBasis, purchaseOccurrenceProof?.timestampSource)
    && purchaseOccurrenceProof?.timezoneBasis ===
      purchaseOccurrenceClockBasis[purchaseOccurrenceProof.timestampSource]
    && boundedUncertainty(purchaseOccurrenceProof?.transactionPrecisionMs) !== null
    && boundedUncertainty(purchaseOccurrenceProof?.transactionClockErrorMs) !== null
    && boundedUncertainty(purchaseOccurrenceProof?.requestReceiptPrecisionMs) !== null
    && boundedUncertainty(purchaseOccurrenceProof?.requestReceiptClockErrorMs) !== null
    ? {
        semantics: "online_purchase_occurrence",
        source: purchaseOccurrenceProof.source,
        timestampSource: purchaseOccurrenceProof.timestampSource,
        timezoneBasis: purchaseOccurrenceProof.timezoneBasis,
        transactionPrecisionMs: boundedUncertainty(purchaseOccurrenceProof.transactionPrecisionMs),
        transactionClockErrorMs: boundedUncertainty(purchaseOccurrenceProof.transactionClockErrorMs),
        requestReceiptPrecisionMs: boundedUncertainty(purchaseOccurrenceProof.requestReceiptPrecisionMs),
        requestReceiptClockErrorMs: boundedUncertainty(purchaseOccurrenceProof.requestReceiptClockErrorMs),
      }
    : null;

  for (const item of extractNayaxRecords(payload)) {
    const record = typeof item === "object" && item !== null ? item : {};
    const transactionId = sanitizeText(
      record.TransactionID ?? record.TransactionId ?? record.transactionId ?? record.transaction_id,
      80,
    );
    // Known native provider clock governs only an offsetless machine timestamp.
    // Explicit GMT/offsets and the raw request-binding value remain unchanged.
    // Unknown clocks retain the legacy location fallback, labelled as unknown.
    const machineTimezone = providerClockContext?.source === "native_machine_configuration"
      ? sanitizeText(providerClockContext.timezone, 80)
      : sanitizeText(locationTimezone, 80);
    const machineTime = parseProviderMachineAuthorizationDate(
      record,
      machineTimezone,
      providerClockContext?.source === "native_machine_configuration",
    );
    const providerTime = parseProviderAuthorizationDate(record, machineTime);
    const authorizationDate = providerTime?.date ?? null;
    if (!transactionId || !authorizationDate || !providerTime) continue;
    parseableRecordCount += 1;
    const requestReceivedDate = parseDateValue(request.customerRequestReceivedAt);
    const comparableProof = occurrenceProof && requestReceivedDate
      && occurrenceProof.timestampSource === providerTime.source ? occurrenceProof : null;
    // A provider authorization, sync, or posting timestamp is not the customer
    // purchase occurrence. Apply the customer-time lookup window only when the
    // explicit occurrence contract proves those clocks are comparable.
    if (comparableProof &&
      (authorizationDate.getTime() < windowStartMs || authorizationDate.getTime() > windowEndMs)) continue;
    windowRecordCount += 1;
    const transactionOccurrenceLowerBoundAt = comparableProof
      ? new Date(authorizationDate.getTime() - comparableProof.transactionClockErrorMs).toISOString()
      : null;
    const transactionOccurrenceUpperBoundAt = comparableProof
      ? new Date(authorizationDate.getTime() + comparableProof.transactionClockErrorMs + comparableProof.transactionPrecisionMs).toISOString()
      : null;
    const requestReceiptLowerBoundAt = comparableProof
      ? new Date(requestReceivedDate.getTime() - comparableProof.requestReceiptClockErrorMs).toISOString()
      : null;
    const requestReceiptUpperBoundAt = comparableProof
      ? new Date(requestReceivedDate.getTime() + comparableProof.requestReceiptClockErrorMs + comparableProof.requestReceiptPrecisionMs).toISOString()
      : null;
    const requestTimeBoundary = classifyRefundRequestTimeBoundary({
      customerRequestReceivedAt: request.customerRequestReceivedAt,
      customerRequestReceivedSource: request.customerRequestReceivedSource,
      transactionOccurredAt: authorizationDate.toISOString(),
      transactionOccurrenceSource: providerTime.source,
      transactionTimeResolution: providerTime.resolution,
      transactionOccurrenceSemantics: comparableProof?.semantics ?? "unknown",
      transactionOccurrenceTimestampSource: comparableProof?.timestampSource ?? null,
      transactionOccurrenceTimezoneBasis: comparableProof?.timezoneBasis ?? null,
      transactionOccurrenceLowerBoundAt,
      transactionOccurrenceUpperBoundAt,
      requestReceiptLowerBoundAt,
      requestReceiptUpperBoundAt,
    });
    if (requestTimeBoundary.transactionAfterRequest) {
      excludedAfterRequestCount += 1;
      continue;
    }

    // Exclude a provably later event before duplicate bookkeeping. A later
    // provider copy cannot make an otherwise valid earlier occurrence
    // ambiguous, regardless of the provider's record order.
    const duplicateProviderRecord = seenTransactionIds.has(transactionId);
    seenTransactionIds.add(transactionId);

    if (normalizedByTransaction.has(transactionId)) {
      // A duplicated provider ID is an anomaly even when the visible fields
      // appear identical. Keep one candidate for manager review, but never let
      // that provider ambiguity become a one-click recommendation.
      normalizedByTransaction.get(transactionId).duplicateProviderRecord = true;
      continue;
    }
    // Count duplicate IDs before omitting unresolvable machine evidence, so a
    // malformed copy cannot turn an ambiguous provider result into a safe match.
    if (!machineTime) continue;
    const paymentStatus = normalizePaymentStatus(record, providerContract);
    normalizedByTransaction.set(transactionId, {
      transactionId,
      siteId: integerValue(record.SiteID ?? record.SiteId ?? record.siteId),
      providerMachineId: sanitizeText(record.MachineID ?? record.MachineId ?? record.machineId, 120),
      authorizedAt: authorizationDate.toISOString(),
      machineAuthorizationTime: machineTime.date.toISOString(),
      machineAuthorizationTimeRaw: machineTime.raw,
      machineTimeResolution: machineTime.resolution,
      machineClockContext: providerClockContext,
      providerTimeResolution: providerTime.resolution,
      providerTimeSource: providerTime.source,
      customerRequestReceivedAt: request.customerRequestReceivedAt,
      customerRequestReceivedSource: request.customerRequestReceivedSource,
      requestTimeBoundaryState: requestTimeBoundary.state,
      transactionOccurrenceComparable: requestTimeBoundary.occurrenceComparable,
      transactionOccurrenceSemantics: comparableProof?.semantics ?? "unknown",
      transactionOccurrenceProofSource: comparableProof?.source ?? null,
      transactionOccurrenceTimestampSource: comparableProof?.timestampSource ?? null,
      transactionOccurrenceTimezoneBasis: comparableProof?.timezoneBasis ?? null,
      transactionOccurrenceLowerBoundAt,
      transactionOccurrenceUpperBoundAt,
      requestReceiptLowerBoundAt,
      requestReceiptUpperBoundAt,
      // Round outward so a transaction even one second beyond a safety boundary
      // cannot be admitted by display-oriented minute rounding.
      timeDeltaMinutes: comparableProof
        ? Math.ceil(Math.abs(authorizationDate.getTime() - incidentDate.getTime()) / 60000)
        : null,
      providerProcessingTimeDeltaMinutes:
        Math.ceil(Math.abs(authorizationDate.getTime() - incidentDate.getTime()) / 60000),
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
      duplicateProviderRecord,
      ...buildNayaxCandidateContext({
        record,
        machineContext,
        authorizedAt: authorizationDate.toISOString(),
      }),
    });
  }

  let candidates = [...normalizedByTransaction.values()]
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
      (left.timeDeltaMinutes ?? Number.POSITIVE_INFINITY) -
        (right.timeDeltaMinutes ?? Number.POSITIVE_INFINITY) ||
      left.providerProcessingTimeDeltaMinutes - right.providerProcessingTimeDeltaMinutes ||
      left.authorizedAt.localeCompare(right.authorizedAt) ||
      left.transactionId.localeCompare(right.transactionId))
    .map((candidate, index) => ({ ...candidate, recommendationRank: index + 1, isTopRanked: index === 0 }));

  const customerTimeSupportsManagerSelection =
    ["exact", "legacy_absolute"].includes(request.incidentTimeResolution) &&
    request.incidentTimeConfidence !== "rough";
  const selectableWithoutPreciseTime = candidates.filter((candidate) => candidate.selectionAllowed);
  const competingPurchaseCounts = new Map();
  for (const candidate of selectableWithoutPreciseTime) {
    if (!candidate.cardLast4) continue;
    const key = [candidate.cardLast4, candidate.amountCents, candidate.currencyCode].join(":");
    competingPurchaseCounts.set(key, (competingPurchaseCounts.get(key) ?? 0) + 1);
  }
  const competingPurchaseKeys = new Set(
    [...competingPurchaseCounts.entries()].filter(([, count]) => count > 1).map(([key]) => key),
  );
  if (!customerTimeSupportsManagerSelection && competingPurchaseKeys.size > 0) {
    candidates = candidates.map((candidate) => {
      const key = [candidate.cardLast4, candidate.amountCents, candidate.currencyCode].join(":");
      return candidate.selectionAllowed && candidate.cardLast4 && competingPurchaseKeys.has(key)
      ? {
          ...candidate,
          evidenceAwareReviewEligible: false,
          selectionAllowed: false,
          identifierReviewState: "needs_corroboration",
          customerCorrectionFields: ["incident_time"],
          manualReviewReasons: [
            ...new Set([
              ...candidate.manualReviewReasons,
              "multiple_candidates_need_distinguishing_time",
            ]),
          ],
          reasonCodes: [
            ...new Set([
              ...candidate.reasonCodes,
              "multiple_candidates_need_distinguishing_time",
            ]),
          ],
        }
      : candidate;
    });
  }

  const topOverall = candidates[0] ?? null;
  const strongCardCandidates = candidates.filter((candidate) => candidate.strongCardEligible);
  const qrTimeCandidates = candidates.filter((candidate) => candidate.uniqueQrTimeEligible);
  const evidenceAwareCandidates = candidates.filter((candidate) => candidate.evidenceAwareReviewEligible);
  const managerSelectableCandidates = candidates.filter((candidate) => candidate.selectionAllowed);
  const candidatesNeedingOneDistinguishingFact = candidates.filter((candidate) =>
    candidate.hardExclusions.length === 0 &&
    candidate.selectionAllowed === false &&
    candidate.customerCorrectionFields.length === 1
  );
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
  } else if (evidenceAwareCandidates.length === 1) {
    recommendationState = "manual_exception";
    confidenceClass = "evidence_aware_review";
    recommendedTransactionId = evidenceAwareCandidates[0].transactionId;
    resultReasonCodes = [...evidenceAwareCandidates[0].reasonCodes, "unique_evidence_aware_review_candidate"];
  } else if (evidenceAwareCandidates.length > 1) {
    recommendationState = "ambiguous";
    resultReasonCodes = ["multiple_evidence_aware_review_candidates", "plausible_runner_up"];
  } else if (managerSelectableCandidates.length === 1) {
    recommendationState = "manual_exception";
    recommendedTransactionId = managerSelectableCandidates[0].transactionId;
    resultReasonCodes = [
      ...managerSelectableCandidates[0].reasonCodes,
      "unique_manager_selectable_candidate",
    ];
  } else if (managerSelectableCandidates.length > 1) {
    recommendationState = "ambiguous";
    resultReasonCodes = ["multiple_manager_selectable_candidates", "plausible_runner_up"];
  } else if (candidatesNeedingOneDistinguishingFact.length > 1) {
    recommendationState = "ambiguous";
    resultReasonCodes = ["multiple_candidates_need_distinguishing_fact", "plausible_runner_up"];
  } else if (candidates.length > 0) {
    recommendationState = "manual_exception";
    resultReasonCodes = topOverall?.reasonCodes.length
      ? topOverall.reasonCodes
      : ["insufficient_evidence"];
  } else {
    resultReasonCodes = excludedAfterRequestCount > 0
      ? ["transaction_after_customer_request"]
      : ["no_candidate_in_lookup_window"];
  }
  if (excludedAfterRequestCount > 0 && !resultReasonCodes.includes("transaction_after_customer_request")) {
    resultReasonCodes.push("transaction_after_customer_request");
  }

  const finalizedCandidates = candidates.map((candidate) => {
    const isRecommended = Boolean(recommendedTransactionId && candidate.transactionId === recommendedTransactionId);
    const matchStrength = isRecommended
      ? "strong"
      : recommendationState === "ambiguous" && candidate.selectionAllowed
        ? "compare"
        : candidate.manualReviewReasons.length > 0 || candidate.hardExclusions.length > 0
          ? "manual_review"
          : "insufficient";
    const oneClickEligible =
      isRecommended &&
      candidate.selectionAllowed &&
      recommendationState === "high_confidence" &&
      confidenceClass === "strong_card" &&
      !request.cardWalletUsed &&
      candidate.recognitionMethod !== "wallet" &&
      candidate.recognitionMethod !== "contactless";
    return {
      ...candidate,
      policyVersion: policy.version,
      recommendationState,
      isRecommended,
      oneClickEligible,
      confidenceClass: isRecommended ? confidenceClass : "ambiguous_manual",
      matchStrength,
    };
  })
    // Determine uniqueness across every in-window sale before limiting display.
    // Keep a uniquely recommended sale visible even when blocked rows score higher.
    .sort((left, right) => Number(right.isRecommended) - Number(left.isRecommended) ||
      Number(right.matchStrength === "compare") - Number(left.matchStrength === "compare") ||
      left.recommendationRank - right.recommendationRank)
    .slice(0, policy.candidateLimit);

  const copy = {
    high_confidence: confidenceClass === "unique_qr_time"
      ? {
          summary: "Nayax found exactly one sale supported by the machine, amount, QR start, and timing.",
          recommendedAction: "Review and select the exact sale. The normal guarded refund action becomes available after manager selection.",
        }
      : {
          summary: `Nayax found one sale with matching card digits on this machine, within ${policy.maximumOneClickTimeDeltaMinutes} minutes and $${(policy.maximumStrongCardAmountDeltaCents / 100).toFixed(2)} of the reported purchase.`,
          recommendedAction: request.cardWalletUsed
            ? "Review and select the exact wallet sale. The normal guarded refund action becomes available after manager selection."
            : "Confirm the recommended sale. Only then may the separately guarded refund action become eligible.",
        },
    ambiguous: {
      summary: "Nayax found multiple plausible card sales that are too close to recommend safely.",
      recommendedAction: "Compare the alternatives and record why the manager chose a different sale. One-click refund stays unavailable.",
    },
    manual_exception: {
      summary: confidenceClass === "evidence_aware_review"
        ? "Nayax found one sale on the matching machine. The customer and provider amounts are shown for comparison. The card details differ, and Nayax has not proved those fields use the same identifier for this payment interaction. Transaction timing is shown separately and may be unproved."
        : "Nayax found a possible sale, but one or more details still need a manager to compare them.",
      recommendedAction: confidenceClass === "evidence_aware_review"
        ? "Review this sale once and confirm it only if the machine, amount comparison, and available customer and payment evidence identify the same purchase. The refund uses the selected provider transaction's full amount. One-click refund stays unavailable."
        : "Compare the customer details with the possible sale before choosing the next step.",
    },
    no_safe_match: {
      summary: windowRecordCount > 0
        ? "Nayax found sales in the time window, but none met the safe recommendation rules."
        : "The returned recent sales contain no usable transactions in the purchase time window. Historical coverage is unknown.",
      recommendedAction: windowRecordCount > 0
        ? "Compare the existing purchase details and transaction evidence before choosing the next step."
        : "Refund Operations should review transaction coverage and machine/time evidence. Do not ask the customer to repeat details already provided.",
    },
  }[recommendationState];
  const requestBoundaryNote = excludedAfterRequestCount > 0
    ? `${excludedAfterRequestCount} later transaction${excludedAfterRequestCount === 1 ? " was" : "s were"} excluded because ${excludedAfterRequestCount === 1 ? "it" : "they"} occurred after Bloomjoy received the customer request.`
    : "";

  return {
    policyVersion: policy.version,
    // Private lookup input for checking every original, independent of UI limits.
    consideredTransactionIds: [...normalizedByTransaction.keys()],
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
    excludedAfterRequestCount,
    uncertainRequestTimeCandidateCount: candidates.filter((candidate) =>
      candidate.requestTimeBoundaryState !== "before_or_at_request"
    ).length,
    summary: [requestBoundaryNote, copy.summary].filter(Boolean).join(" "),
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
  providerProcessingTimeDeltaMinutes: candidate.providerProcessingTimeDeltaMinutes,
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
  identifierPolicyVersion: candidate.identifierPolicyVersion ?? NAYAX_IDENTIFIER_POLICY_VERSION,
  customerFactVersion: candidate.customerFactVersion ?? null,
  customerCredentialClass: candidate.customerCredentialClass,
  providerIdentifierClass: candidate.providerIdentifierClass,
  cardLast4Comparison: candidate.cardLast4Comparison,
  cardNetworkComparison: candidate.cardNetworkComparison,
  paymentInteractionComparison: candidate.paymentInteractionComparison,
  sameIdentifierEquivalenceProven: candidate.sameIdentifierEquivalenceProven,
  identifierReviewState: candidate.identifierReviewState,
  customerCorrectionFields: candidate.customerCorrectionFields,
});
