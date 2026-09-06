import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  buildNayaxRecommendation,
  NAYAX_RECOMMENDATION_POLICY,
  toPublicNayaxCandidate,
} from "../../supabase/functions/_shared/nayax-recommendation.mjs";
import { resolveLocalDateTimeInZone } from "../../supabase/functions/_shared/timezone-resolution.mjs";

const incidentAt = "2026-07-21T19:00:00.000Z";
const expectedMachineId = "machine-101";

const sale = ({
  id,
  at = incidentAt,
  amount = 7,
  machineId = expectedMachineId,
  last4 = "4242",
  currency = "USD",
  status = "Approved",
  recognitionMethod = "Chip",
  cardBrand = "Visa",
  siteId = 501,
  extra = {},
}) => ({
  TransactionID: id,
  MachineID: machineId,
  SiteID: siteId,
  AuthorizationDateTimeGMT: at,
  MachineAuthorizationTime: at,
  AuthorizationValue: amount,
  CurrencyCode: currency,
  CardNumber: last4 ? `************${last4}` : "",
  PaymentStatus: status,
  RecognitionMethod: recognitionMethod,
  CardBrand: cardBrand,
  ...extra,
});

const recommend = (records, overrides = {}) => {
  const effectiveIncidentAt = overrides.incidentAt ?? incidentAt;
  const defaultRequestReceivedAt = new Date(Date.parse(effectiveIncidentAt) + 24 * 60 * 60 * 1000).toISOString();
  return buildNayaxRecommendation({
    payload: records,
    incidentAt: effectiveIncidentAt,
    incidentTimeResolution: "exact",
    expectedMachineId,
    locationTimezone: "America/Los_Angeles",
    requestAmountCents: 700,
    requestCardLast4: "4242",
    requestCardLast4Provenance: "physical_card",
    requestCardLast4Source: "physical_card",
    paymentInteraction: "insert_card",
    incidentTimeSource: "transaction_alert_or_receipt",
    nearbyAttemptCount: "one",
    incidentTimeConfidence: "within_15_minutes",
    customerFactVersion: 4,
    cardWalletUsed: false,
    customerRequestReceivedAt: defaultRequestReceivedAt,
    customerRequestReceivedSource: "hosted_refund_intake",
    providerContract: "nayax_machine_last_sales_v1",
    purchaseOccurrenceProof: {
      semantics: "online_purchase_occurrence",
      source: "verified_provider_purchase_occurrence_v1",
      timestampSource: "authorization_gmt",
      timezoneBasis: "utc",
      transactionPrecisionMs: 0,
      transactionClockErrorMs: 0,
      requestReceiptPrecisionMs: 0,
      requestReceiptClockErrorMs: 0,
    },
    ...overrides,
  });
};

const exact = recommend([
  sale({ id: "exact" }),
  sale({ id: "exact-distractor", at: "2026-07-21T19:02:00.000Z", amount: 8.5, last4: "9999" }),
]);
assert.equal(exact.recommendationState, "high_confidence");
assert.equal(exact.confidenceClass, "strong_card");
assert.equal(exact.candidates[0].transactionId, "exact");
assert.equal(exact.candidates[0].oneClickEligible, true);

const exactNetwork = recommend([sale({ id: "exact-network", cardBrand: "MasterCard" })], {
  requestCardNetwork: "mastercard",
});
assert.equal(exactNetwork.candidates[0].cardNetwork, "mastercard");
assert.ok(exactNetwork.candidates[0].reasonCodes.includes("card_network_match"));
assert.equal(
  exactNetwork.candidates[0].matchFactors.some(
    (factor) => factor.key === "card_network" && factor.outcome === "match",
  ),
  true,
);

const physicalNetworkMismatch = recommend(
  [sale({ id: "physical-network-mismatch", cardBrand: "Visa" })],
  { requestCardNetwork: "american_express" },
);
assert.ok(physicalNetworkMismatch.candidates[0].reasonCodes.includes("card_network_mismatch"));
assert.equal(physicalNetworkMismatch.recommendationState, "manual_exception");
assert.equal(physicalNetworkMismatch.confidenceClass, "evidence_aware_review");
assert.equal(physicalNetworkMismatch.candidates[0].selectionAllowed, true);
assert.equal(physicalNetworkMismatch.candidates[0].oneClickEligible, false);
assert.equal(physicalNetworkMismatch.candidates[0].hardExclusions.length, 0);

const productionShapedTapMismatch = recommend([
  sale({ id: "great-mall-tap-mismatch", at: "2026-07-21T19:15:00.000Z", amount: 10.9,
    last4: "3760", recognitionMethod: "Contactless" }),
], { requestAmountCents: 1090, requestCardLast4: "6768", requestCardNetwork: null,
  paymentInteraction: "tap_card", requestCardLast4Source: null,
  incidentTimeSource: null, nearbyAttemptCount: null, incidentTimeConfidence: "exact",
  customerRequestReceivedAt: null, customerRequestReceivedSource: null,
  purchaseOccurrenceProof: null });
assert.equal(productionShapedTapMismatch.recommendationState, "manual_exception");
assert.equal(productionShapedTapMismatch.confidenceClass, "evidence_aware_review");
assert.equal(productionShapedTapMismatch.candidates[0].selectionAllowed, true);
assert.equal(productionShapedTapMismatch.candidates[0].isRecommended, true);
assert.equal(productionShapedTapMismatch.candidates[0].oneClickEligible, false);
assert.equal(productionShapedTapMismatch.candidates[0].identifierReviewState, "reviewable_uncertainty");
assert.equal(productionShapedTapMismatch.candidates[0].cardLast4Comparison, "mismatch_neutral_unproven_scope");
assert.equal(productionShapedTapMismatch.candidates[0].sameIdentifierEquivalenceProven, false);
assert.equal(productionShapedTapMismatch.candidates[0].customerCorrectionFields.includes("card_last4_source"), false);
assert.deepEqual(productionShapedTapMismatch.candidates[0].hardExclusions, []);

const delayedProviderTapMismatch = recommend([
  sale({ id: "delayed-provider-tap-mismatch", at: "2026-07-21T22:15:00.000Z", amount: 10.9,
    last4: "3760", recognitionMethod: "Swipe" }),
], { requestAmountCents: 1090, requestCardLast4: "6768", requestCardNetwork: null,
  paymentInteraction: "tap_card", requestCardLast4Source: "physical_card",
  incidentTimeSource: null, nearbyAttemptCount: null, incidentTimeConfidence: "exact",
  customerRequestReceivedAt: null, customerRequestReceivedSource: null,
  purchaseOccurrenceProof: null });
assert.equal(delayedProviderTapMismatch.candidates[0].timeDeltaMinutes, null);
assert.equal(delayedProviderTapMismatch.candidates[0].providerProcessingTimeDeltaMinutes, 195);
assert.equal(delayedProviderTapMismatch.candidates[0].selectionAllowed, true);
assert.equal(delayedProviderTapMismatch.candidates[0].identifierReviewState, "reviewable_uncertainty");
assert.equal(
  delayedProviderTapMismatch.candidates[0].paymentInteractionComparison,
  "conflict_unverified_provider_semantics",
);
assert.equal(delayedProviderTapMismatch.candidates[0].customerCorrectionFields.includes("payment_interaction"), false);
assert.equal(delayedProviderTapMismatch.candidates[0].oneClickEligible, false);
assert.match(delayedProviderTapMismatch.summary, /amounts are shown for comparison/i);
assert.match(delayedProviderTapMismatch.summary, /timing is shown separately and may be unproved/i);
assert.doesNotMatch(delayedProviderTapMismatch.summary, /close timing/i);
assert.doesNotMatch(delayedProviderTapMismatch.recommendedAction, /amount, time/i);

const oneCentDifferentTapMismatch = recommend([
  sale({ id: "one-cent-different-tap-mismatch", at: "2026-07-21T19:15:00.000Z", amount: 10.91,
    last4: "3760", recognitionMethod: "Contactless" }),
], { requestAmountCents: 1090, requestCardLast4: "6768", requestCardNetwork: null,
  paymentInteraction: "tap_card", requestCardLast4Source: "physical_card",
  incidentTimeSource: null, nearbyAttemptCount: null, incidentTimeConfidence: "exact",
  customerRequestReceivedAt: null, customerRequestReceivedSource: null,
  purchaseOccurrenceProof: null });
assert.equal(oneCentDifferentTapMismatch.candidates[0].amountDeltaCents, 1);
assert.equal(oneCentDifferentTapMismatch.candidates[0].selectionAllowed, true);
assert.equal(oneCentDifferentTapMismatch.candidates[0].identifierReviewState, "reviewable_uncertainty");
assert.deepEqual(oneCentDifferentTapMismatch.candidates[0].customerCorrectionFields, []);
assert.equal(oneCentDifferentTapMismatch.candidates[0].oneClickEligible, false);

const largeAmountDifferenceTapMismatch = recommend([
  sale({ id: "large-difference-tap-mismatch", at: "2026-07-21T23:15:00.000Z", amount: 25.9,
    last4: "3760", recognitionMethod: "Contactless" }),
], { requestAmountCents: 1090, requestCardLast4: "6768", requestCardNetwork: null,
  paymentInteraction: "tap_card", requestCardLast4Source: "physical_card",
  incidentTimeSource: null, nearbyAttemptCount: null, incidentTimeConfidence: "exact",
  customerRequestReceivedAt: null, customerRequestReceivedSource: null,
  purchaseOccurrenceProof: null });
assert.equal(largeAmountDifferenceTapMismatch.candidates[0].amountDeltaCents, 1500);
assert.equal(largeAmountDifferenceTapMismatch.candidates[0].selectionAllowed, true);
assert.equal(largeAmountDifferenceTapMismatch.candidates[0].identifierReviewState, "reviewable_uncertainty");
assert.equal(largeAmountDifferenceTapMismatch.candidates[0].oneClickEligible, false);
assert.match(largeAmountDifferenceTapMismatch.recommendedAction, /full amount/i);

const largeAmountDifferenceExactSuffix = recommend([
  sale({ id: "large-difference-exact-suffix", at: "2026-07-21T19:15:00.000Z", amount: 25.9,
    last4: "6768", recognitionMethod: "Swipe" }),
], { requestAmountCents: 1090, requestCardLast4: "6768", requestCardNetwork: null,
  paymentInteraction: "swipe_card", requestCardLast4Source: "physical_card" });
assert.equal(largeAmountDifferenceExactSuffix.candidates[0].selectionAllowed, true);
assert.equal(largeAmountDifferenceExactSuffix.candidates[0].oneClickEligible, false);

const distantExactSuffixBeforeRequest = recommend([
  sale({ id: "distant-exact-suffix-before-request", at: "2026-07-21T23:00:00.000Z", amount: 10.9,
    last4: "6768", recognitionMethod: "Swipe" }),
], { requestAmountCents: 1090, requestCardLast4: "6768", requestCardNetwork: null,
  paymentInteraction: "swipe_card", requestCardLast4Source: "physical_card",
  customerRequestReceivedAt: "2026-07-22T00:00:00.000Z",
  customerRequestReceivedSource: "hosted_refund_intake",
  purchaseOccurrenceProof: {
    semantics: "online_purchase_occurrence",
    source: "verified_provider_purchase_occurrence_v1",
    timestampSource: "authorization_gmt",
    timezoneBasis: "utc",
    transactionPrecisionMs: 0,
    transactionClockErrorMs: 0,
    requestReceiptPrecisionMs: 0,
    requestReceiptClockErrorMs: 0,
  } });
assert.equal(distantExactSuffixBeforeRequest.candidates[0].timeDeltaMinutes, 240);
assert.equal(distantExactSuffixBeforeRequest.candidates[0].requestTimeBoundaryState, "before_or_at_request");
assert.equal(distantExactSuffixBeforeRequest.candidates[0].selectionAllowed, true);
assert.equal(distantExactSuffixBeforeRequest.candidates[0].oneClickEligible, false);

const largeAmountDifferenceCorroboratedMismatch = recommend([
  sale({ id: "large-difference-corroborated", at: "2026-07-21T19:15:00.000Z", amount: 25.9,
    last4: "3760", recognitionMethod: "Swipe" }),
], { requestAmountCents: 1090, requestCardLast4: "6768", requestCardNetwork: null,
  paymentInteraction: "swipe_card", requestCardLast4Source: "physical_card",
  incidentTimeSource: "transaction_alert_or_receipt", nearbyAttemptCount: "one",
  incidentTimeConfidence: "exact" });
assert.equal(largeAmountDifferenceCorroboratedMismatch.candidates[0].selectionAllowed, true);
assert.equal(largeAmountDifferenceCorroboratedMismatch.candidates[0].identifierReviewState, "reviewable_uncertainty");
assert.equal(largeAmountDifferenceCorroboratedMismatch.candidates[0].oneClickEligible, false);

const ambiguousTapMismatches = recommend([
  sale({ id: "great-mall-tap-a", at: "2026-07-21T19:14:00.000Z", amount: 10.9,
    last4: "3760", recognitionMethod: "Contactless" }),
  sale({ id: "great-mall-tap-b", at: "2026-07-21T19:16:00.000Z", amount: 10.9,
    last4: "4488", recognitionMethod: "Contactless" }),
], { requestAmountCents: 1090, requestCardLast4: "6768", requestCardNetwork: null,
  paymentInteraction: "tap_card", requestCardLast4Source: "physical_card", nearbyAttemptCount: "one" });
assert.equal(ambiguousTapMismatches.recommendationState, "ambiguous");
assert.equal(ambiguousTapMismatches.candidates.every((candidate) => candidate.selectionAllowed), true);
assert.equal(ambiguousTapMismatches.candidates.some((candidate) => candidate.isRecommended), false);
assert.equal(ambiguousTapMismatches.oneClickEligible, false);

const sameInterfaceMismatchWithoutCorroboration = recommend([
  sale({ id: "same-interface-mismatch", at: "2026-07-21T19:15:00.000Z", amount: 10.9,
    last4: "3760", recognitionMethod: "Swipe" }),
], { requestAmountCents: 1090, requestCardLast4: "6768", requestCardNetwork: null,
  paymentInteraction: "swipe_card", requestCardLast4Source: null,
  incidentTimeSource: null, nearbyAttemptCount: null, incidentTimeConfidence: "exact" });
assert.equal(sameInterfaceMismatchWithoutCorroboration.recommendationState, "manual_exception");
assert.equal(sameInterfaceMismatchWithoutCorroboration.candidates[0].selectionAllowed, false);
assert.equal(sameInterfaceMismatchWithoutCorroboration.candidates[0].identifierReviewState, "needs_corroboration");
assert.equal(sameInterfaceMismatchWithoutCorroboration.candidates[0].cardLast4Comparison, "mismatch_negative_unproven_equivalence");
assert.equal(sameInterfaceMismatchWithoutCorroboration.candidates[0].customerCorrectionFields.includes("card_last4_source"), false);
assert.ok(sameInterfaceMismatchWithoutCorroboration.candidates[0].customerCorrectionFields.includes("incident_time_source"));
assert.ok(sameInterfaceMismatchWithoutCorroboration.candidates[0].customerCorrectionFields.includes("nearby_attempt_count"));

const rememberedMultipleAttempts = recommend([
  sale({ id: "remembered-multiple-attempts", at: "2026-07-21T19:15:00.000Z", amount: 10.9,
    last4: "3760", recognitionMethod: "Chip" }),
], { requestAmountCents: 1090, requestCardLast4: "6768", requestCardNetwork: null,
  paymentInteraction: "insert_card", requestCardLast4Source: "physical_card",
  incidentTimeSource: "memory", nearbyAttemptCount: "multiple", incidentTimeConfidence: "within_1_hour" });
assert.equal(rememberedMultipleAttempts.recommendationState, "manual_exception");
assert.equal(rememberedMultipleAttempts.candidates[0].selectionAllowed, false);
assert.equal(rememberedMultipleAttempts.candidates[0].identifierReviewState, "needs_corroboration");
assert.ok(rememberedMultipleAttempts.candidates[0].customerCorrectionFields.includes("incident_time"));
assert.ok(rememberedMultipleAttempts.candidates[0].customerCorrectionFields.includes("incident_time_source"));
assert.ok(rememberedMultipleAttempts.candidates[0].customerCorrectionFields.includes("nearby_attempt_count"));

const distantMismatch = recommend([
  sale({ id: "distant-mismatch", at: "2026-07-21T22:01:00.000Z", amount: 10.9, last4: "3760" }),
], { requestAmountCents: 1090, requestCardLast4: "6768", requestCardNetwork: null,
  paymentInteraction: "tap_card", requestCardLast4Source: "physical_card" });
assert.equal(distantMismatch.candidates[0].selectionAllowed, true);
assert.equal(distantMismatch.candidates[0].identifierReviewState, "reviewable_uncertainty");
assert.deepEqual(distantMismatch.candidates[0].customerCorrectionFields, []);

const duplicateContactlessMismatch = recommend([
  sale({ id: "duplicate-contactless-mismatch", at: "2026-07-21T19:15:00.000Z", amount: 10.9,
    last4: "3760", recognitionMethod: "Contactless" }),
], { requestAmountCents: 1090, requestCardLast4: "6768", requestCardNetwork: null,
  paymentInteraction: "tap_card", requestCardLast4Source: null,
  incidentTimeSource: null, nearbyAttemptCount: null, incidentTimeConfidence: "exact",
  transactionStates: { "duplicate-contactless-mismatch": "duplicate" } });
assert.equal(duplicateContactlessMismatch.candidates[0].selectionAllowed, false);
assert.equal(duplicateContactlessMismatch.candidates[0].identifierReviewState, "blocked_safety");
assert.ok(duplicateContactlessMismatch.candidates[0].hardExclusions.includes("duplicate_transaction"));

const walletNetworkMismatch = recommend(
  [sale({ id: "wallet-network-mismatch", cardBrand: "Amex", recognitionMethod: "Apple Pay" })],
  { requestCardNetwork: "visa", cardWalletUsed: true },
);
assert.ok(walletNetworkMismatch.candidates[0].reasonCodes.includes("card_network_mismatch"));
assert.equal(walletNetworkMismatch.candidates[0].oneClickEligible, false);

const walletDifferentAmount = recommend(
  [sale({ id: "wallet-different-amount", amount: 9, cardBrand: "Discover", recognitionMethod: "Apple Pay" })],
  { requestCardNetwork: "discover", cardWalletUsed: true },
);
assert.equal(walletDifferentAmount.recommendationState, "high_confidence");
assert.equal(walletDifferentAmount.candidates[0].oneClickEligible, false);

const networkOnlyBaseline = recommend(
  [sale({ id: "network-only-baseline", amount: 9, last4: "" })],
  { requestCardLast4: "", requestCardNetwork: null },
);
const networkOnlyMatch = recommend(
  [sale({ id: "network-only-match", amount: 9, last4: "", cardBrand: "Visa" })],
  { requestCardLast4: "", requestCardNetwork: "visa" },
);
assert.equal(networkOnlyMatch.recommendationState, networkOnlyBaseline.recommendationState);
assert.equal(networkOnlyMatch.candidates[0].selectionAllowed, networkOnlyBaseline.candidates[0].selectionAllowed);
assert.equal(networkOnlyMatch.candidates[0].oneClickEligible, false);

const nearTime = recommend([sale({ id: "near", at: "2026-07-21T19:45:00.000Z" })]);
assert.equal(nearTime.recommendationState, "high_confidence");
assert.equal(nearTime.candidates[0].timeDeltaMinutes, 45);
assert.equal(nearTime.candidates[0].oneClickEligible, true);

const customerTimeWithin15Minutes = recommend([sale({ id: "time-within-15" })], {
  incidentTimeConfidence: "within_15_minutes",
});
assert.equal(customerTimeWithin15Minutes.recommendationState, "high_confidence");
assert.ok(customerTimeWithin15Minutes.reasonCodes.includes("customer_time_within_15_minutes"));

const customerTimeWithinHour = recommend([sale({ id: "time-within-hour" })], {
  incidentTimeConfidence: "within_1_hour",
});
assert.equal(customerTimeWithinHour.recommendationState, "high_confidence");
assert.equal(customerTimeWithinHour.oneClickEligible, true);
assert.ok(customerTimeWithinHour.reasonCodes.includes("customer_time_within_1_hour"));

const customerTimeRough = recommend([sale({ id: "time-rough" })], {
  incidentTimeConfidence: "rough",
});
assert.equal(customerTimeRough.recommendationState, "manual_exception");
assert.equal(customerTimeRough.oneClickEligible, false);
assert.equal(customerTimeRough.candidates[0].selectionAllowed, true);
assert.equal(customerTimeRough.candidates[0].isRecommended, true);
assert.ok(customerTimeRough.reasonCodes.includes("customer_time_rough"));

const independentlyIdentifiedUncertainTime = recommend([sale({ id: "uncertain-time-exact-card" })], {
  incidentTimeConfidence: "rough",
  incidentTimeResolution: "ambiguous",
});
assert.equal(independentlyIdentifiedUncertainTime.recommendationState, "manual_exception");
assert.equal(independentlyIdentifiedUncertainTime.oneClickEligible, false);
assert.equal(independentlyIdentifiedUncertainTime.candidates[0].selectionAllowed, true);
assert.equal(independentlyIdentifiedUncertainTime.candidates[0].isRecommended, true);
assert.equal(independentlyIdentifiedUncertainTime.candidates[0].cardLast4Comparison, "exact_support");

const roughCompetingPurchases = recommend([
  sale({ id: "rough-collision-a", at: "2026-07-21T18:55:00.000Z" }),
  sale({ id: "rough-collision-b", at: "2026-07-21T19:05:00.000Z" }),
], {
  incidentTimeConfidence: "rough",
  incidentTimeResolution: "ambiguous",
  requestCardLast4: null,
  requestCardLast4Provenance: null,
  requestCardLast4Source: null,
});
assert.equal(roughCompetingPurchases.recommendationState, "ambiguous");
assert.equal(roughCompetingPurchases.candidates.every((candidate) => candidate.selectionAllowed === false), true);
assert.deepEqual(
  roughCompetingPurchases.candidates.map((candidate) => candidate.customerCorrectionFields),
  [["card_last4"], ["card_last4"]],
);
assert.equal(roughCompetingPurchases.candidates.some((candidate) => candidate.isRecommended), false);

const roughSameCardCompetingPurchases = recommend([
  sale({ id: "rough-same-card-collision-a", at: "2026-07-21T18:55:00.000Z" }),
  sale({ id: "rough-same-card-collision-b", at: "2026-07-21T19:05:00.000Z" }),
], {
  incidentTimeConfidence: "rough",
  incidentTimeResolution: "ambiguous",
});
assert.equal(roughSameCardCompetingPurchases.recommendationState, "ambiguous");
assert.equal(
  roughSameCardCompetingPurchases.candidates.every((candidate) => candidate.selectionAllowed === false),
  true,
);
assert.deepEqual(
  roughSameCardCompetingPurchases.candidates.map((candidate) => candidate.customerCorrectionFields),
  [["incident_time"], ["incident_time"]],
);
assert.equal(roughSameCardCompetingPurchases.candidates.some((candidate) => candidate.isRecommended), false);

const wrongAmount = recommend([sale({ id: "wrong-amount", amount: 10.01 })]);
assert.equal(wrongAmount.recommendationState, "manual_exception");
assert.equal(wrongAmount.oneClickEligible, false);
assert.equal(wrongAmount.candidates[0].selectionAllowed, true);
assert.equal(wrongAmount.candidates.length, 1);

const nearAmount = recommend([sale({ id: "near-amount", amount: 9.99 })]);
assert.equal(nearAmount.candidates[0].amountDeltaCents, 299);
assert.equal(nearAmount.candidates[0].selectionAllowed, true);

const wrongMachine = recommend([sale({ id: "wrong-machine", machineId: "machine-999" })]);
assert.equal(wrongMachine.recommendationState, "manual_exception");
assert.equal(wrongMachine.candidates[0].selectionAllowed, false);

const collision = recommend([
  sale({ id: "collision-a", at: "2026-07-21T18:55:00.000Z" }),
  sale({ id: "collision-b", at: "2026-07-21T19:05:00.000Z" }),
]);
assert.equal(collision.recommendationState, "ambiguous");
assert.equal(collision.candidates.some((candidate) => candidate.oneClickEligible), false);
assert.equal(collision.candidates.some((candidate) => candidate.isRecommended), false);

const requestBoundary = recommend([
  sale({ id: "before-request", at: "2026-07-21T19:00:00.000Z" }),
  sale({ id: "after-request", at: "2026-07-21T19:05:00.000Z" }),
], {
  customerRequestReceivedAt: "2026-07-21T19:03:00.000Z",
});
assert.equal(requestBoundary.recommendationState, "high_confidence");
assert.deepEqual(requestBoundary.consideredTransactionIds, ["before-request"]);
assert.equal(requestBoundary.excludedAfterRequestCount, 1);
assert.ok(requestBoundary.reasonCodes.includes("transaction_after_customer_request"));

for (const records of [
  [
    sale({ id: "request-boundary-duplicate", at: "2026-07-21T19:05:00.000Z" }),
    sale({ id: "request-boundary-duplicate", at: "2026-07-21T19:00:00.000Z" }),
  ],
  [
    sale({ id: "request-boundary-duplicate", at: "2026-07-21T19:00:00.000Z" }),
    sale({ id: "request-boundary-duplicate", at: "2026-07-21T19:05:00.000Z" }),
  ],
]) {
  const result = recommend(records, {
    customerRequestReceivedAt: "2026-07-21T19:03:00.000Z",
  });
  assert.equal(result.candidateCount, 1);
  assert.equal(result.excludedAfterRequestCount, 1);
  assert.equal(result.candidates[0].duplicateProviderRecord, false);
  assert.equal(result.candidates[0].oneClickEligible, true);
}

const equalRequestBoundary = recommend([sale({ id: "equal-request" })], {
  customerRequestReceivedAt: incidentAt,
});
assert.equal(equalRequestBoundary.candidates[0].requestTimeBoundaryState, "before_or_at_request");

const unknownRequestBoundary = recommend([sale({ id: "unknown-request" })], {
  customerRequestReceivedAt: null,
  customerRequestReceivedSource: null,
});
assert.equal(unknownRequestBoundary.candidates[0].selectionAllowed, true);
assert.equal(unknownRequestBoundary.oneClickEligible, false);
assert.equal(unknownRequestBoundary.candidates.length, 1);
assert.ok(unknownRequestBoundary.candidates[0].manualReviewReasons.includes("customer_request_time_unknown"));

const unknownRequestMismatch = recommend([sale({
  id: "unknown-request-mismatch",
  last4: "9999",
})], {
  customerRequestReceivedAt: null,
  customerRequestReceivedSource: null,
  requestCardNetwork: "visa",
});
assert.equal(unknownRequestMismatch.candidates.length, 1);
assert.equal(unknownRequestMismatch.candidates[0].selectionAllowed, true);
assert.equal(unknownRequestMismatch.candidates[0].oneClickEligible, false);
assert.equal(unknownRequestMismatch.candidates[0].identifierReviewState, "reviewable_uncertainty");
assert.deepEqual(unknownRequestMismatch.candidates[0].customerCorrectionFields, []);
assert.ok(unknownRequestMismatch.candidates[0].reasonCodes.includes("customer_request_time_unknown"));

const uncertainOccurrenceBoundary = recommend([sale({
  id: "uncertain-occurrence",
  extra: { AuthorizationDateTimeGMT: undefined, MachineAuthorizationTime: "2026-07-21T12:00:00" },
})], {
  customerRequestReceivedAt: "2026-07-21T20:00:00.000Z",
  providerClockContext: { source: "unknown", timezone: null },
});
assert.equal(uncertainOccurrenceBoundary.candidates[0].selectionAllowed, true);
assert.equal(uncertainOccurrenceBoundary.oneClickEligible, false);
assert.equal(uncertainOccurrenceBoundary.candidates.length, 1);
assert.ok(uncertainOccurrenceBoundary.candidates[0].manualReviewReasons.includes("transaction_occurrence_time_uncertain"));

const delayedEarlierAuthorization = recommend([sale({
  id: "delayed-earlier-authorization",
  at: "2026-07-21T18:59:59.000Z",
  extra: { ProviderRecordArrivedAt: "2026-07-23T12:00:00.000Z" },
})], {
  customerRequestReceivedAt: "2026-07-21T19:00:00.000Z",
});
assert.equal(delayedEarlierAuthorization.candidateCount, 1);
assert.equal(delayedEarlierAuthorization.excludedAfterRequestCount, 0);

const offlineVendBeforeFormWithLaterAuthorization = recommend([sale({
  id: "offline-vend-later-sync",
  at: "2026-07-21T19:05:00.000Z",
  extra: {
    OfflinePayment: true,
    ProviderRecordArrivedAt: "2026-07-21T19:10:00.000Z",
    SettlementDateTimeGMT: "2026-07-21T19:15:00.000Z",
  },
})], {
  customerRequestReceivedAt: "2026-07-21T19:03:00.000Z",
  purchaseOccurrenceProof: null,
});
assert.equal(offlineVendBeforeFormWithLaterAuthorization.excludedAfterRequestCount, 0);
assert.equal(offlineVendBeforeFormWithLaterAuthorization.candidateCount, 1);
assert.equal(offlineVendBeforeFormWithLaterAuthorization.candidates[0].requestTimeBoundaryState, "occurrence_time_uncertain");
assert.equal(offlineVendBeforeFormWithLaterAuthorization.candidates[0].selectionAllowed, true);
assert.equal(offlineVendBeforeFormWithLaterAuthorization.candidates[0].oneClickEligible, false);
assert.equal(offlineVendBeforeFormWithLaterAuthorization.candidates[0].timeDeltaMinutes, null);
assert.equal(offlineVendBeforeFormWithLaterAuthorization.candidates[0].providerProcessingTimeDeltaMinutes, 5);
assert.ok(offlineVendBeforeFormWithLaterAuthorization.candidates[0].manualReviewReasons.includes("transaction_occurrence_time_uncertain"));

for (const delayHours of [4, 8]) {
  const delayedOffline = recommend([sale({
    id: `offline-delay-${delayHours}h`,
    at: new Date(Date.parse(incidentAt) + delayHours * 60 * 60 * 1000).toISOString(),
    extra: { OfflinePayment: true },
  })], { purchaseOccurrenceProof: null });
  assert.equal(delayedOffline.candidateCount, 1);
  assert.equal(delayedOffline.providerWindowRecordCount, 1);
  assert.equal(delayedOffline.candidates[0].selectionAllowed, true);
  assert.equal(delayedOffline.candidates[0].oneClickEligible, false);
  assert.equal(delayedOffline.candidates[0].timeDeltaMinutes, null);
  assert.equal(delayedOffline.candidates[0].providerProcessingTimeDeltaMinutes, delayHours * 60);
  assert.deepEqual(delayedOffline.candidates[0].customerCorrectionFields, []);
}

const nullClockBoundsDoNotProveOccurrence = recommend([sale({ id: "null-proof-bounds" })], {
  purchaseOccurrenceProof: {
    semantics: "online_purchase_occurrence",
    source: "invalid_null_bound_fixture",
    timestampSource: "authorization_gmt",
    timezoneBasis: "utc",
    transactionPrecisionMs: null,
    transactionClockErrorMs: null,
    requestReceiptPrecisionMs: null,
    requestReceiptClockErrorMs: null,
  },
});
assert.equal(nullClockBoundsDoNotProveOccurrence.candidates[0].transactionOccurrenceComparable, false);
assert.equal(nullClockBoundsDoNotProveOccurrence.candidates[0].requestTimeBoundaryState, "occurrence_time_uncertain");
assert.equal(nullClockBoundsDoNotProveOccurrence.candidates[0].timeDeltaMinutes, null);
assert.equal(nullClockBoundsDoNotProveOccurrence.oneClickEligible, false);

const incoherentClockBasisDoesNotProveOccurrence = recommend([sale({ id: "incoherent-proof-clock" })], {
  purchaseOccurrenceProof: {
    semantics: "online_purchase_occurrence",
    source: "verified_provider_purchase_occurrence_v1",
    timestampSource: "authorization_gmt",
    timezoneBasis: "verified_machine_timezone",
    transactionPrecisionMs: 0,
    transactionClockErrorMs: 0,
    requestReceiptPrecisionMs: 0,
    requestReceiptClockErrorMs: 0,
  },
});
assert.equal(incoherentClockBasisDoesNotProveOccurrence.candidates[0].transactionOccurrenceComparable, false);
assert.equal(incoherentClockBasisDoesNotProveOccurrence.candidates[0].selectionAllowed, true);
assert.equal(incoherentClockBasisDoesNotProveOccurrence.candidates[0].oneClickEligible, false);

// Customer estimates may omit tax or round the total. The provider amount is retained.
for (const deltaCents of [-301, -300, -100, -10, 0, 10, 100, 300, 301]) {
  for (const deltaMinutes of [-61, -60, -25, 25, 60, 61]) {
    const amount = (700 + deltaCents) / 100;
    const at = new Date(Date.parse(incidentAt) + deltaMinutes * 60_000).toISOString();
    const result = recommend([sale({ id: "estimated-total", amount, at })], {
      incidentTimeConfidence: "within_1_hour",
    });
    const eligible = Math.abs(deltaCents) <= 300 && Math.abs(deltaMinutes) <= 60;
    assert.equal(result.recommendationState, eligible ? "high_confidence" : "manual_exception");
    assert.equal(result.oneClickEligible, eligible);
    assert.equal(result.candidates[0].amountCents, 700 + deltaCents);
    assert.equal(result.candidates[0].amountDeltaCents, Math.abs(deltaCents));
    if (eligible && deltaCents !== 0) {
      assert.ok(result.reasonCodes.includes("amount_within_tolerance"));
      assert.ok(!result.candidates[0].manualReviewReasons.includes("amount_uncertain"));
      assert.match(result.candidates[0].matchReason, /may reflect tax or rounding/);
    }
  }
}

const similarPurchases = [
  sale({ id: "same-card-exact" }),
  sale({ id: "same-card-near", at: "2026-07-21T19:25:00.000Z", amount: 7.1 }),
];
for (const candidateLimit of [1, 10]) {
  const result = recommend(similarPurchases, {
    policy: { ...NAYAX_RECOMMENDATION_POLICY, candidateLimit },
  });
  assert.equal(result.recommendationState, "ambiguous", "display limits cannot hide a competing purchase");
  assert.equal(result.oneClickEligible, false);
  assert.equal(result.candidates.some((candidate) => candidate.isRecommended), false);
}

const midnightEstimate = recommend([sale({
  id: "midnight-estimate", at: "2026-07-22T06:50:00Z", amount: 7.1,
  extra: { MachineAuthorizationTime: "2026-07-21T23:50:00" },
})], { incidentAt: "2026-07-22T07:15:00Z", incidentTimeConfidence: "within_1_hour" });
assert.equal(midnightEstimate.recommendationState, "high_confidence");
assert.equal(midnightEstimate.candidates[0].timeDeltaMinutes, 25);

const walletMismatch = recommend(
  [sale({ id: "wallet", last4: "9999", recognitionMethod: "Apple Pay" })],
  { cardWalletUsed: true },
);
assert.equal(walletMismatch.recommendationState, "manual_exception");
assert.equal(walletMismatch.oneClickEligible, false);
assert.equal(walletMismatch.candidates[0].selectionAllowed, true);

const exactWallet = recommend(
  [sale({ id: "exact-wallet", recognitionMethod: "Apple Pay" })],
  { cardWalletUsed: true },
);
assert.equal(exactWallet.recommendationState, "high_confidence");
assert.equal(exactWallet.confidenceClass, "strong_card");
assert.equal(exactWallet.oneClickEligible, false);
assert.equal(exactWallet.candidates[0].selectionAllowed, true);
assert.match(
  exactWallet.recommendedAction,
  /normal guarded refund action becomes available after manager selection/i,
);

const uniqueQrWallet = recommend(
  [sale({
    id: "unique-qr-wallet",
    at: "2026-07-21T19:03:00.000Z",
    last4: "9999",
    recognitionMethod: "Apple Pay",
  })],
  {
    cardWalletUsed: true,
    qrClaimOpenedAt: "2026-07-21T19:08:00.000Z",
    qrClaimEvidenceStatus: "verified",
  },
);
assert.equal(uniqueQrWallet.recommendationState, "high_confidence");
assert.equal(uniqueQrWallet.confidenceClass, "unique_qr_time");
assert.equal(uniqueQrWallet.oneClickEligible, false);
assert.equal(uniqueQrWallet.candidates[0].qrTimeDeltaMinutes, 5);
assert.ok(uniqueQrWallet.reasonCodes.includes("unique_qr_time_candidate"));
assert.match(
  uniqueQrWallet.recommendedAction,
  /normal guarded refund action becomes available after manager selection/i,
);

const uniqueQrContactlessCard = recommend(
  [sale({
    id: "unique-qr-contactless-card",
    at: "2026-07-21T19:03:00.000Z",
    last4: "9999",
    recognitionMethod: "Contactless",
  })],
  {
    cardWalletUsed: false,
    qrClaimOpenedAt: "2026-07-21T19:08:00.000Z",
    qrClaimEvidenceStatus: "verified",
  },
);
assert.equal(uniqueQrContactlessCard.recommendationState, "high_confidence");
assert.equal(uniqueQrContactlessCard.confidenceClass, "unique_qr_time");
assert.equal(uniqueQrContactlessCard.oneClickEligible, false);
assert.ok(uniqueQrContactlessCard.reasonCodes.includes("card_last4_mismatch"));

const uniqueQrWithoutLast4 = recommend(
  [sale({ id: "unique-qr-no-last4", at: "2026-07-21T19:04:00.000Z", last4: "" })],
  {
    requestCardLast4: "",
    qrClaimOpenedAt: "2026-07-21T19:09:00.000Z",
    qrClaimEvidenceStatus: "verified",
  },
);
assert.equal(uniqueQrWithoutLast4.recommendationState, "high_confidence");
assert.equal(uniqueQrWithoutLast4.confidenceClass, "unique_qr_time");
assert.equal(uniqueQrWithoutLast4.oneClickEligible, false);

const closeQrTransactions = recommend(
  [
    sale({
      id: "close-qr-a",
      at: "2026-07-21T19:03:00.000Z",
      last4: "9999",
      recognitionMethod: "Apple Pay",
    }),
    sale({
      id: "close-qr-b",
      at: "2026-07-21T19:05:00.000Z",
      last4: "8888",
      recognitionMethod: "Apple Pay",
    }),
  ],
  {
    cardWalletUsed: true,
    qrClaimOpenedAt: "2026-07-21T19:08:00.000Z",
    qrClaimEvidenceStatus: "verified",
  },
);
assert.equal(closeQrTransactions.recommendationState, "ambiguous");
assert.equal(closeQrTransactions.confidenceClass, "ambiguous_manual");
assert.equal(closeQrTransactions.candidates.some((candidate) => candidate.isRecommended), false);
assert.ok(closeQrTransactions.reasonCodes.includes("plausible_runner_up"));

const lateQrScan = recommend(
  [sale({
    id: "late-qr",
    last4: "9999",
    recognitionMethod: "Apple Pay",
  })],
  {
    cardWalletUsed: true,
    qrClaimOpenedAt: "2026-07-21T20:00:00.000Z",
    qrClaimEvidenceStatus: "verified",
  },
);
assert.equal(lateQrScan.recommendationState, "manual_exception");
assert.ok(lateQrScan.reasonCodes.includes("qr_claim_late"));
assert.equal(lateQrScan.oneClickEligible, false);

const justOutsideQrWindow = recommend(
  [sale({
    id: "outside-qr-window",
    last4: "9999",
    recognitionMethod: "Apple Pay",
  })],
  {
    cardWalletUsed: true,
    qrClaimOpenedAt: "2026-07-21T19:30:01.000Z",
    qrClaimEvidenceStatus: "verified",
  },
);
assert.equal(justOutsideQrWindow.candidates[0].qrTimeDeltaMinutes, 31);
assert.equal(justOutsideQrWindow.recommendationState, "manual_exception");
assert.equal(justOutsideQrWindow.oneClickEligible, false);

const replayedQrClaim = recommend(
  [sale({
    id: "replayed-qr",
    last4: "9999",
    recognitionMethod: "Apple Pay",
  })],
  {
    cardWalletUsed: true,
    qrClaimOpenedAt: "2026-07-21T19:05:00.000Z",
    qrClaimEvidenceStatus: "replayed",
  },
);
assert.equal(replayedQrClaim.recommendationState, "manual_exception");
assert.ok(replayedQrClaim.reasonCodes.includes("qr_claim_replayed"));
assert.equal(replayedQrClaim.oneClickEligible, false);

const missingMachineEvidence = recommend([sale({ id: "missing-machine", machineId: "" })]);
assert.equal(missingMachineEvidence.recommendationState, "manual_exception");
assert.equal(missingMachineEvidence.candidates[0].oneClickEligible, false);

const justOutsideOneClickWindow = recommend([
  sale({ id: "outside-one-click", at: "2026-07-21T20:00:01.000Z" }),
]);
assert.equal(justOutsideOneClickWindow.candidates[0].timeDeltaMinutes, 61);
assert.equal(justOutsideOneClickWindow.oneClickEligible, false);

const missingProviderLast4 = recommend([sale({ id: "missing-last4", last4: "" })]);
assert.equal(missingProviderLast4.recommendationState, "manual_exception");

const failedProviderStatus = recommend([sale({ id: "failed", status: "Declined" })]);
assert.equal(failedProviderStatus.recommendationState, "manual_exception");
assert.equal(failedProviderStatus.candidates[0].selectionAllowed, false);

const negatedApprovedProviderStatus = recommend([sale({ id: "not-approved", status: "Not Approved" })]);
assert.equal(negatedApprovedProviderStatus.recommendationState, "manual_exception");
assert.equal(negatedApprovedProviderStatus.candidates[0].selectionAllowed, false);

const mixedReversalProviderStatus = recommend([
  sale({ id: "successful-reversal", status: "Successful Reversal" }),
]);
assert.equal(mixedReversalProviderStatus.recommendationState, "manual_exception");
assert.equal(mixedReversalProviderStatus.candidates[0].selectionAllowed, false);

const unsuccessfulProviderStatus = recommend([sale({ id: "unsuccessful", status: "Unsuccessful" })]);
assert.equal(unsuccessfulProviderStatus.recommendationState, "manual_exception");
assert.equal(unsuccessfulProviderStatus.candidates[0].selectionAllowed, false);

const unconfirmedProviderStatus = recommend([sale({ id: "unconfirmed", status: "" })]);
assert.equal(unconfirmedProviderStatus.recommendationState, "manual_exception");
assert.equal(unconfirmedProviderStatus.oneClickEligible, false);

const documentedLastSale = sale({ id: "documented-last-sale" });
delete documentedLastSale.PaymentStatus;
const documentedLastSalesStatus = recommend([documentedLastSale]);
assert.equal(documentedLastSalesStatus.recommendationState, "high_confidence");
assert.equal(documentedLastSalesStatus.oneClickEligible, true);
assert.equal(documentedLastSalesStatus.candidates[0].paymentStatus, "approved");
assert.ok(documentedLastSalesStatus.candidates[0].reasonCodes.includes("provider_last_sales_record"));

const unverifiedMissingStatus = recommend([documentedLastSale], { providerContract: "unverified" });
assert.equal(unverifiedMissingStatus.recommendationState, "manual_exception");
assert.equal(unverifiedMissingStatus.oneClickEligible, false);
assert.equal(unverifiedMissingStatus.candidates[0].selectionAllowed, false);
assert.equal(unverifiedMissingStatus.candidates.length, 1);

const declinedCamelStatus = { ...documentedLastSale, paymentStatus: "Declined" };
const declinedCamelResult = recommend([declinedCamelStatus]);
assert.equal(declinedCamelResult.recommendationState, "manual_exception");
assert.equal(declinedCamelResult.candidates[0].selectionAllowed, false);

const unknownSnakeStatus = { ...documentedLastSale, payment_status: "Processing" };
const unknownSnakeResult = recommend([unknownSnakeStatus]);
assert.equal(unknownSnakeResult.recommendationState, "manual_exception");
assert.equal(unknownSnakeResult.oneClickEligible, false);

const contradictoryStatuses = sale({
  id: "contradictory-statuses",
  status: "Approved",
  extra: { TransactionStatus: "Declined" },
});
const contradictoryStatusResult = recommend([contradictoryStatuses]);
assert.equal(contradictoryStatusResult.recommendationState, "manual_exception");
assert.equal(contradictoryStatusResult.candidates[0].selectionAllowed, false);

const missingProviderSite = recommend([sale({ id: "missing-site", siteId: null })]);
assert.equal(missingProviderSite.recommendationState, "manual_exception");
assert.equal(missingProviderSite.oneClickEligible, false);
assert.equal(missingProviderSite.candidates[0].selectionAllowed, false);
assert.equal(missingProviderSite.candidates.length, 1);

const duplicateProviderRecord = recommend([
  sale({ id: "provider-duplicate" }),
  sale({ id: "provider-duplicate" }),
]);
assert.equal(duplicateProviderRecord.recommendationState, "manual_exception");
assert.equal(duplicateProviderRecord.oneClickEligible, false);

const duplicate = recommend([sale({ id: "duplicate" })], {
  transactionStates: { duplicate: "duplicate" },
});
assert.equal(duplicate.recommendationState, "manual_exception");
assert.equal(duplicate.candidates[0].oneClickEligible, false);
assert.equal(duplicate.candidates[0].selectionAllowed, false);

const alreadyRefunded = recommend([sale({ id: "already-refunded" })], {
  transactionStates: { "already-refunded": "already_refunded" },
});
assert.equal(alreadyRefunded.recommendationState, "manual_exception");
assert.equal(alreadyRefunded.candidates[0].oneClickEligible, false);

const noMatch = recommend([sale({ id: "outside", at: "2026-07-22T08:00:00.000Z" })]);
assert.equal(noMatch.recommendationState, "no_safe_match");
assert.equal(noMatch.candidates.length, 0);

const exactLocal = resolveLocalDateTimeInZone({
  localDate: "2026-07-21",
  localTime: "12:00",
  timeZone: "America/Los_Angeles",
});
assert.deepEqual(exactLocal, {
  instant: incidentAt,
  resolution: "exact",
  possibleInstantCount: 1,
});

const timezoneHelperUrl = new URL(
  "../../supabase/functions/_shared/timezone-resolution.mjs",
  import.meta.url,
).href;
const resolveFromHostTimezone = (hostTimezone) =>
  execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `import { resolveLocalDateTimeInZone } from ${JSON.stringify(timezoneHelperUrl)}; console.log(JSON.stringify(resolveLocalDateTimeInZone({ localDate: "2026-07-21", localTime: "12:00", timeZone: "America/Los_Angeles" })));`,
    ],
    { env: { ...process.env, TZ: hostTimezone }, encoding: "utf8" },
  ).trim();
assert.equal(
  resolveFromHostTimezone("Pacific/Honolulu"),
  resolveFromHostTimezone("Europe/London"),
  "canonical location-time resolution must not depend on the customer's browser/host timezone",
);

const springGap = resolveLocalDateTimeInZone({
  localDate: "2026-03-08",
  localTime: "02:30",
  timeZone: "America/Los_Angeles",
});
assert.equal(springGap.resolution, "nonexistent");

const fallFold = resolveLocalDateTimeInZone({
  localDate: "2026-11-01",
  localTime: "01:30",
  timeZone: "America/Los_Angeles",
});
assert.equal(fallFold.resolution, "ambiguous");
assert.equal(fallFold.possibleInstantCount, 2);

const providerLocalDst = recommend(
  [
    sale({
      id: "local-dst",
      at: undefined,
      extra: {
        AuthorizationDateTimeGMT: undefined,
        MachineAuthorizationTime: "2026-07-21 12:00:00",
      },
    }),
  ],
  {
    providerClockContext: {
      timezone: "America/Los_Angeles",
      source: "native_machine_configuration",
      observedAt: "2026-09-04T15:44:13.963271Z",
    },
    purchaseOccurrenceProof: {
      semantics: "online_purchase_occurrence",
      source: "verified_provider_purchase_occurrence_v1",
      timestampSource: "verified_machine_clock",
      timezoneBasis: "verified_machine_timezone",
      transactionPrecisionMs: 0,
      transactionClockErrorMs: 0,
      requestReceiptPrecisionMs: 0,
      requestReceiptClockErrorMs: 0,
    },
  },
);

const unknownLast4SourceMismatch = recommend(
  [sale({ id: "unknown-source-mismatch", last4: "9999", cardBrand: "MasterCard" })],
  { requestCardLast4Provenance: null, requestCardLast4Source: null, requestCardNetwork: "visa" },
);
assert.equal(unknownLast4SourceMismatch.candidates[0].selectionAllowed, true);
assert.equal(unknownLast4SourceMismatch.oneClickEligible, false);
assert.ok(unknownLast4SourceMismatch.candidates[0].manualReviewReasons.includes("customer_card_last4_source_unknown"));

const unknownLast4SourceExact = recommend([sale({ id: "unknown-source-exact" })], {
  requestCardLast4Provenance: null,
  requestCardLast4Source: null,
});
assert.equal(unknownLast4SourceExact.recommendationState, "manual_exception");
assert.equal(unknownLast4SourceExact.candidates[0].selectionAllowed, true);
assert.equal(unknownLast4SourceExact.oneClickEligible, false);
assert.ok(unknownLast4SourceExact.candidates[0].manualReviewReasons.includes("customer_card_last4_source_unknown"));
assert.equal(providerLocalDst.recommendationState, "high_confidence");
assert.equal(providerLocalDst.candidates[0].authorizedAt, incidentAt);

// Synthetic source values deliberately have different machine/GMT seconds.
const separateMachineClock = recommend([sale({
  id: "separate-machine-clock",
  extra: { MachineAuthorizationTime: "2026-07-21T11:59:58.810" },
})]);
assert.equal(separateMachineClock.candidates[0].authorizedAt, incidentAt);
assert.equal(separateMachineClock.candidates[0].timeDeltaMinutes, 0);
assert.equal(separateMachineClock.candidates[0].machineAuthorizationTime, "2026-07-21T18:59:58.810Z");
assert.equal(separateMachineClock.candidates[0].machineAuthorizationTimeRaw, "2026-07-21T11:59:58.810");
assert.equal(NAYAX_RECOMMENDATION_POLICY.version, "2026-09-05.v11");

for (const raw of ["2026-07-21T12:00:00.1234567", "2026-07-21T12:00:00.1234567-07:00"]) {
  const result = recommend([sale({ id: "fractional-machine-clock", extra: {
    AuthorizationDateTimeGMT: undefined, MachineAuthorizationTime: raw,
  } })]);
  assert.equal(result.candidates[0].authorizedAt, "2026-07-21T19:00:00.123Z");
  assert.equal(result.candidates[0].machineAuthorizationTime, "2026-07-21T19:00:00.123Z");
  assert.equal(result.candidates[0].machineAuthorizationTimeRaw, raw);
  assert.equal(result.candidates[0].machineTimeResolution, "exact");
}

for (const raw of [undefined, null, 123, "", "2026-02-30T12:00:00Z", "2026-07-21T25:00:00", "bad identity", "x".repeat(81)]) {
  const result = recommend([sale({ id: "missing-machine-clock", extra: { MachineAuthorizationTime: raw } })]);
  assert.equal(result.candidateCount, 0, "GMT cannot supply a missing/malformed machine identity");
  assert.equal(result.providerWindowRecordCount, 1, "the readable GMT record is still counted");
  assert.equal(result.oneClickEligible, false);
}

for (const raw of [undefined, "invalid machine clock"]) {
  const valid = sale({ id: "mixed-source-duplicate" });
  const invalid = sale({ id: "mixed-source-duplicate", extra: { MachineAuthorizationTime: raw } });
  for (const records of [[valid, invalid], [invalid, valid]]) {
    const result = recommend(records);
    assert.equal(result.candidateCount, 1);
    assert.equal(result.candidates[0].duplicateProviderRecord, true);
    assert.ok(result.candidates[0].manualReviewReasons.includes("duplicate_provider_record"));
    assert.equal(result.oneClickEligible, false);
  }
}

const invalidMachineZone = recommend([sale({ id: "invalid-machine-zone", extra: {
  MachineAuthorizationTime: "2026-07-21T12:00:00.810",
} })], { locationTimezone: "not/a-zone" });
assert.equal(invalidMachineZone.candidateCount, 0);
const nonexistentMachineClock = recommend([sale({
  id: "nonexistent-machine-clock", at: "2026-03-08T10:30:00Z",
  extra: { MachineAuthorizationTime: "2026-03-08T02:30:00.810" },
})], { incidentAt: "2026-03-08T10:30:00Z" });
assert.equal(nonexistentMachineClock.candidateCount, 0);

const ambiguousMachineClock = recommend([sale({
  id: "ambiguous-machine-clock", at: "2026-11-01T08:30:00Z",
  extra: { MachineAuthorizationTime: "2026-11-01T01:30:00.810" },
})], { incidentAt: "2026-11-01T08:30:00Z" });
assert.equal(ambiguousMachineClock.candidateCount, 1);
assert.equal(ambiguousMachineClock.candidates[0].machineTimeResolution, "ambiguous");
assert.equal(ambiguousMachineClock.candidates[0].machineAuthorizationTimeRaw, "2026-11-01T01:30:00.810");
assert.equal(ambiguousMachineClock.oneClickEligible, false, "an exact GMT field cannot resolve a machine DST fold");

const recommendationUrl = new URL("../../supabase/functions/_shared/nayax-recommendation.mjs", import.meta.url).href;
const clockInput = {
  payload: [sale({ id: "host-independent-clock", extra: { MachineAuthorizationTime: "2026-07-21T11:59:58.810" } })],
  incidentAt, expectedMachineId, locationTimezone: "America/Los_Angeles", requestAmountCents: 700,
  requestCardLast4: "4242", cardWalletUsed: false, providerContract: "nayax_machine_last_sales_v1",
};
const machineClockFromHost = (hostTimezone) => execFileSync(process.execPath, ["--input-type=module", "--eval",
  `import { buildNayaxRecommendation } from ${JSON.stringify(recommendationUrl)}; console.log(JSON.stringify(buildNayaxRecommendation(${JSON.stringify(clockInput)})));`,
], { env: { ...process.env, TZ: hostTimezone }, encoding: "utf8" }).trim();
assert.equal(machineClockFromHost("Pacific/Honolulu"), machineClockFromHost("Europe/London"));

const ambiguousIncident = recommend([sale({ id: "ambiguous-incident" })], {
  incidentTimeResolution: "ambiguous",
});
assert.equal(ambiguousIncident.recommendationState, "manual_exception");
assert.equal(ambiguousIncident.oneClickEligible, false);

const publicCandidate = toPublicNayaxCandidate(exact.candidates[0], "opaque-token");
for (const missing of [null, undefined, "", false, 0]) {
  const result = recommend([sale({ id: "small-sale", amount: 2.5 })], { requestAmountCents: missing });
  assert.equal(result.oneClickEligible, false, "absent or zero reported amount is not a matching estimate");
  assert.notEqual(result.recommendationState, "high_confidence");
}
assert.equal(recommend([sale({ id: "zero-sale", amount: 0 })], { requestAmountCents: 300 }).oneClickEligible, false);

const blockedRows = Array.from({ length: 10 }, (_, i) => sale({ id: `blocked-${i}` }));
const blockedStates = Object.fromEntries(blockedRows.map((row) => [row.TransactionID, "already_refunded"]));
const hiddenRows = [...blockedRows, sale({ id: "hidden-original", amount: 7.1, at: "2026-07-21T19:25:00Z" })];
const preliminary = recommend(hiddenRows);
assert.equal(preliminary.candidates.length, 10);
assert.equal(preliminary.consideredTransactionIds.length, 11, "private state lookup must include originals outside the display limit");
const checkedStates = Object.fromEntries(preliminary.consideredTransactionIds.map((id) => [id, "already_refunded"]));
assert.equal(recommend(hiddenRows, { transactionStates: checkedStates }).oneClickEligible, false,
  "second-pass ranking cannot expose an unchecked refunded original");
const visibleAlternatives = recommend([...hiddenRows, sale({ id: "second-alternative", amount: 7.2, at: "2026-07-21T19:26:00Z" })], {
  transactionStates: blockedStates,
});
assert.equal(visibleAlternatives.recommendationState, "ambiguous");
assert.equal(visibleAlternatives.candidates.filter((row) => row.matchStrength === "compare").length, 2,
  "blocked higher-scoring rows cannot hide the transactions managers need to compare");
const publicJson = JSON.stringify(publicCandidate);
assert.equal("transactionId" in publicCandidate, false, "raw transaction ID must not reach the browser");
assert.equal(publicJson.includes("rankingPoints"), false, "internal points must not look like probability");
assert.equal(publicJson.includes("providerMachineId"), false);
assert.equal("machineAuthorizationTimeRaw" in publicCandidate, false, "raw provider identity stays private");
assert.equal("machineTimeResolution" in publicCandidate, false);
assert.equal(publicCandidate.matchStrength, "strong");
assert.equal(publicCandidate.confidenceClass, "strong_card");
assert.equal(publicCandidate.candidateToken, "opaque-token");

console.log("Nayax recommendation fixtures passed: amount/time boundaries, full-window ambiguity and refund checks, missing amounts, machine identity, DST and privacy.");
