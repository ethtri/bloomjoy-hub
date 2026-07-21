import { resolveLocalDateTimeInZone } from "./timezone-resolution.mjs";

// Deterministic Nayax recommendation policy for Refund Operations.
//
// Ranking points are ordering evidence, not a calibrated probability. The UI and
// API expose advisory words (strong evidence, compare candidates, manual review)
// instead of presenting these points as a percentage.
export const NAYAX_RECOMMENDATION_POLICY = Object.freeze({
  version: "2026-07-21.v1",
  candidateLimit: 10,
  lookupWindowHours: 6,
  highConfidenceMinimumPoints: 80,
  ambiguityMarginPoints: 15,
  maximumOneClickTimeDeltaMinutes: 60,
  weights: Object.freeze({
    exactMappedMachineAndLocation: 40,
    exactAmount: 25,
    nearAmount: 8,
    timeWithin15Minutes: 25,
    timeWithin60Minutes: 18,
    timeWithin3Hours: 8,
    timeWithinLookupWindow: 2,
    exactCardLast4: 20,
    usdCurrency: 5,
    approvedProviderStatus: 5,
  }),
});

const sanitizeText = (value, maxLength = 300) =>
  typeof value === "string" || typeof value === "number" || typeof value === "boolean"
    ? String(value).trim().slice(0, maxLength)
    : "";

const normalizeCardBrand = (value) => {
  const normalized = sanitizeText(value, 80)
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return "";
  if (normalized.includes("visa")) return "Visa";
  if (normalized.includes("mastercard") || normalized.includes("master card") || normalized === "mc") {
    return "Mastercard";
  }
  if (normalized.includes("american express") || normalized.includes("amex")) return "American Express";
  if (normalized.includes("discover")) return "Discover";
  if (normalized.includes("debit")) return "Debit card";
  if (normalized.includes("credit")) return "Credit card";
  return "Card";
};

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

const normalizePaymentStatus = (record) => {
  const normalized = sanitizeText(
    record.PaymentStatus ?? record.TransactionStatus ?? record.Status ?? record.status,
    80,
  )
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return "recorded";
  if (["approved", "paid", "success", "successful", "completed", "settled", "sale"].some((token) => normalized.includes(token))) {
    return "approved";
  }
  if (["declined", "denied", "failed", "cancel", "void", "reversed"].some((token) => normalized.includes(token))) {
    return "not approved";
  }
  return "recorded";
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
  if (deltaMinutes === 0) return "Transaction time matches the reported time";
  if (deltaMinutes === 1) return "Transaction is 1 minute from the reported time";
  return `Transaction is ${deltaMinutes} minutes from the reported time`;
};

const addReason = (target, reason) => {
  if (!target.includes(reason)) target.push(reason);
};

const scoreCandidate = ({ candidate, request, transactionState, policy }) => {
  const weights = policy.weights;
  const matchFactors = [];
  const manualReviewReasons = [];
  const hardExclusions = [];
  let rankingPoints = 0;

  if (request.incidentTimeResolution !== "exact") {
    addReason(manualReviewReasons, `incident_time_${request.incidentTimeResolution}`);
    matchFactors.push(factor("incident_time", "manual", "Reported local time needs manual time-zone review"));
  }

  if (candidate.providerTimeResolution !== "exact") {
    addReason(manualReviewReasons, `provider_time_${candidate.providerTimeResolution}`);
    matchFactors.push(factor("provider_time", "manual", "Nayax transaction time needs manual time-zone review"));
  }

  if (!request.expectedMachineId) {
    addReason(manualReviewReasons, "missing_canonical_machine_mapping");
    matchFactors.push(factor("machine", "missing", "The refund request is missing its canonical Nayax machine mapping"));
  } else if (!candidate.providerMachineId) {
    addReason(manualReviewReasons, "missing_provider_machine_id");
    matchFactors.push(factor("machine", "missing", "Nayax did not return machine identity evidence"));
  } else if (candidate.providerMachineId !== request.expectedMachineId) {
    hardExclusions.push("wrong_machine");
    addReason(manualReviewReasons, "provider_machine_mismatch");
    matchFactors.push(factor("machine", "mismatch", "Nayax returned a different machine than the mapped request machine"));
  } else {
    rankingPoints += weights.exactMappedMachineAndLocation;
    matchFactors.push(factor("machine", "match", "Exact mapped machine and location"));
  }

  const amountDeltaCents = request.amountCents === null || candidate.amountCents === null
    ? null
    : Math.abs(candidate.amountCents - request.amountCents);
  if (amountDeltaCents === 0) {
    rankingPoints += weights.exactAmount;
    matchFactors.push(factor("amount", "match", "Transaction amount matches exactly"));
  } else if (amountDeltaCents !== null && amountDeltaCents <= 50) {
    rankingPoints += weights.nearAmount;
    matchFactors.push(factor("amount", "partial", `Transaction amount differs by ${amountDeltaCents} cents`));
  } else if (amountDeltaCents !== null) {
    matchFactors.push(factor("amount", "mismatch", `Transaction amount differs by ${amountDeltaCents} cents`));
  } else {
    addReason(manualReviewReasons, "missing_amount_evidence");
    matchFactors.push(factor("amount", "missing", "Amount evidence is incomplete"));
  }

  rankingPoints += timePointsFor(candidate.timeDeltaMinutes, weights);
  matchFactors.push(factor("time", candidate.timeDeltaMinutes <= 60 ? "match" : "partial", timeLabelFor(candidate.timeDeltaMinutes)));

  if (!request.cardLast4) {
    addReason(manualReviewReasons, "missing_customer_card_last4");
    matchFactors.push(factor("card", "missing", "Customer card last four is missing"));
  } else if (!candidate.cardLast4) {
    addReason(manualReviewReasons, "missing_provider_card_last4");
    matchFactors.push(factor("card", "missing", "Nayax did not return card last-four evidence"));
  } else if (request.cardLast4 === candidate.cardLast4) {
    rankingPoints += weights.exactCardLast4;
    matchFactors.push(factor("card", "match", "Card last four matches"));
  } else if (request.cardWalletUsed) {
    addReason(manualReviewReasons, "wallet_last4_mismatch");
    matchFactors.push(factor("card", "manual", "Wallet card last four differs and needs manual review"));
  } else {
    hardExclusions.push("card_last4_mismatch");
    matchFactors.push(factor("card", "mismatch", "Card last four does not match"));
  }

  if (request.cardWalletUsed || candidate.recognitionMethod === "wallet") {
    addReason(manualReviewReasons, "wallet_payment");
    matchFactors.push(factor("wallet", "manual", "Wallet payments remain on the manual refund path for this pilot"));
  }

  if (candidate.currencyCode === "USD") {
    rankingPoints += weights.usdCurrency;
    matchFactors.push(factor("currency", "match", "Currency is USD"));
  } else if (candidate.currencyCode) {
    hardExclusions.push("currency_not_usd");
    matchFactors.push(factor("currency", "mismatch", "Currency is not USD"));
  } else {
    addReason(manualReviewReasons, "missing_currency_evidence");
    matchFactors.push(factor("currency", "missing", "Currency evidence is missing"));
  }

  if (candidate.paymentStatus === "approved") {
    rankingPoints += weights.approvedProviderStatus;
    matchFactors.push(factor("provider_status", "match", "Nayax marks the sale approved"));
  } else if (candidate.paymentStatus === "not approved") {
    hardExclusions.push("payment_not_approved");
    matchFactors.push(factor("provider_status", "mismatch", "Nayax does not mark this as an approved sale"));
  } else {
    addReason(manualReviewReasons, "provider_status_unconfirmed");
    matchFactors.push(factor("provider_status", "neutral", "Nayax returned a sale record without an explicit approval status"));
  }

  if (candidate.providerRefundState === "already_refunded" || transactionState === "already_refunded") {
    hardExclusions.push("already_refunded");
    addReason(manualReviewReasons, "already_refunded");
    matchFactors.push(factor("refund_state", "blocked", "This transaction already has refund evidence"));
  } else if (transactionState === "duplicate") {
    hardExclusions.push("duplicate_transaction");
    addReason(manualReviewReasons, "duplicate_transaction");
    matchFactors.push(factor("refund_state", "blocked", "This transaction is already linked to another refund case"));
  }

  if (candidate.timeDeltaMinutes > policy.maximumOneClickTimeDeltaMinutes) {
    matchFactors.push(factor("one_click_window", "outside", "Transaction is outside the one-click time range"));
  }

  const selectionAllowed = hardExclusions.length === 0;
  const baseOneClickEligible =
    selectionAllowed &&
    manualReviewReasons.length === 0 &&
    amountDeltaCents === 0 &&
    candidate.timeDeltaMinutes <= policy.maximumOneClickTimeDeltaMinutes &&
    rankingPoints >= policy.highConfidenceMinimumPoints;

  return {
    ...candidate,
    rankingPoints,
    amountDeltaCents,
    matchFactors,
    manualReviewReasons,
    hardExclusions,
    selectionAllowed,
    baseOneClickEligible,
    oneClickEligible: false,
    isRecommended: false,
    isTopRanked: false,
    recommendationRank: 0,
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
 *   cardWalletUsed: boolean,
 *   incidentTimeResolution?: string,
 *   transactionStates?: Map<string, string> | Record<string, string>,
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
  cardWalletUsed,
  incidentTimeResolution = "exact",
  transactionStates = {},
  windowHours = NAYAX_RECOMMENDATION_POLICY.lookupWindowHours,
  policy = NAYAX_RECOMMENDATION_POLICY,
}) => {
  const incidentDate = parseDateValue(incidentAt);
  if (!incidentDate) throw new Error("A valid incident time is required for Nayax recommendation scoring.");

  const request = {
    expectedMachineId: sanitizeText(expectedMachineId, 120),
    amountCents: asNonNegativeCents(requestAmountCents),
    cardLast4: extractLast4(requestCardLast4),
    cardWalletUsed: Boolean(cardWalletUsed),
    incidentTimeResolution: sanitizeText(incidentTimeResolution, 40) || "legacy_absolute",
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

    if (normalizedByTransaction.has(transactionId)) continue;
    const machineAuthorizationDate = authorizationDate;
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
      amountCents: moneyToCents(record.AuthorizationValue ?? record.SettlementValue),
      currencyCode: sanitizeText(record.CurrencyCode ?? record.currencyCode, 3).toUpperCase(),
      cardLast4: extractLast4(record.CardNumber ?? record.cardNumber),
      cardBrand: normalizeCardBrand(record.CardBrand ?? record.cardBrand),
      recognitionMethod: normalizeRecognitionMethod(record.RecognitionMethod ?? record.recognitionMethod),
      paymentStatus: normalizePaymentStatus(record),
      providerRefundState: normalizeProviderRefundState(record),
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
  const eligibleCandidates = candidates.filter((candidate) => candidate.baseOneClickEligible);
  const topEligible = eligibleCandidates[0] ?? null;
  const secondEligible = eligibleCandidates[1] ?? null;
  let recommendationState = "no_safe_match";

  const topManualException = Boolean(
    topOverall &&
      (topOverall.manualReviewReasons.length > 0 ||
        topOverall.hardExclusions.some((reason) =>
          ["wrong_machine", "already_refunded", "duplicate_transaction", "payment_not_approved", "currency_not_usd"].includes(reason))),
  );

  if (topManualException && (!topEligible || topOverall.rankingPoints >= topEligible.rankingPoints)) {
    recommendationState = "manual_exception";
  } else if (topEligible) {
    const margin = secondEligible ? topEligible.rankingPoints - secondEligible.rankingPoints : Number.POSITIVE_INFINITY;
    recommendationState = margin < policy.ambiguityMarginPoints ? "ambiguous" : "high_confidence";
  } else if (candidates.some((candidate) => candidate.manualReviewReasons.length > 0)) {
    recommendationState = "manual_exception";
  }

  const recommendedTransactionId = recommendationState === "high_confidence" ? topEligible?.transactionId ?? null : null;
  const finalizedCandidates = candidates.map((candidate) => {
    const isRecommended = Boolean(recommendedTransactionId && candidate.transactionId === recommendedTransactionId);
    const matchStrength = isRecommended
      ? "strong"
      : recommendationState === "ambiguous" && candidate.baseOneClickEligible
        ? "compare"
        : candidate.manualReviewReasons.length > 0 || candidate.hardExclusions.length > 0
          ? "manual_review"
          : "insufficient";
    return {
      ...candidate,
      policyVersion: policy.version,
      recommendationState,
      isRecommended,
      oneClickEligible: isRecommended && recommendationState === "high_confidence",
      matchStrength,
    };
  });

  const copy = {
    high_confidence: {
      summary: "Nayax found one card sale with strong, clearly separated evidence.",
      recommendedAction: "Confirm the recommended sale. Only then may the guarded refund action become eligible.",
    },
    ambiguous: {
      summary: "Nayax found multiple plausible card sales that are too close to recommend safely.",
      recommendedAction: "Compare the alternatives and record why the manager chose a different sale. One-click refund stays unavailable.",
    },
    manual_exception: {
      summary: "Nayax found evidence that needs manual review because a safety exception is present.",
      recommendedAction: "Review the exception and use the manual path. One-click refund stays unavailable.",
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
    oneClickEligible: recommendationState === "high_confidence",
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
  authorizedAt: candidate.authorizedAt,
  machineAuthorizationTime: candidate.machineAuthorizationTime,
  amountCents: candidate.amountCents,
  amountDeltaCents: candidate.amountDeltaCents,
  timeDeltaMinutes: candidate.timeDeltaMinutes,
  currencyCode: candidate.currencyCode,
  cardLast4: candidate.cardLast4,
  cardBrand: candidate.cardBrand,
  recognitionMethod: candidate.recognitionMethod,
  paymentStatus: candidate.paymentStatus,
  recommendationRank: candidate.recommendationRank,
  isTopRanked: candidate.isTopRanked,
  isRecommended: candidate.isRecommended,
  recommendationState: candidate.recommendationState,
  oneClickEligible: candidate.oneClickEligible,
  selectionAllowed: candidate.selectionAllowed,
  matchStrength: candidate.matchStrength,
  matchFactors: candidate.matchFactors,
  manualReviewReasons: candidate.manualReviewReasons,
  hardExclusions: candidate.hardExclusions,
  matchReason: candidate.matchReason,
  policyVersion: candidate.policyVersion,
});
