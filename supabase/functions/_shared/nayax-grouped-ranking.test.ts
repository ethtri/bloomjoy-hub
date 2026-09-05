import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  type NayaxProviderCandidate,
  rankGroupedNayaxCandidates,
} from "./nayax-lookup.ts";

const candidate = (
  transactionId: string,
  options: Partial<NayaxProviderCandidate> = {},
): NayaxProviderCandidate => ({
  transactionId,
  siteId: 1,
  providerMachineId: "provider-machine",
  authorizedAt: "2026-08-23T10:00:00.000Z",
  machineAuthorizationTime: "2026-08-23T10:00:00.000Z",
  machineAuthorizationTimeRaw: "2026-08-23T10:00:00.000Z",
  machineTimeResolution: "exact",
  providerTimeResolution: "exact",
  providerTimeSource: "authorization_gmt",
  customerRequestReceivedAt: "2026-08-23T10:05:00.000Z",
  customerRequestReceivedSource: "hosted_refund_intake",
  requestTimeBoundaryState: "before_or_at_request",
  transactionOccurrenceComparable: true,
  timeDeltaMinutes: 2,
  qrTimeDeltaMinutes: null,
  amountCents: 550,
  amountDeltaCents: 0,
  currencyCode: "USD",
  cardLast4: "4242",
  cardBrand: "visa",
  recognitionMethod: "card",
  paymentStatus: "approved",
  providerRefundState: "clear",
  productLabel: "Cotton candy",
  productCode: "cotton-candy",
  standardPriceCents: 550,
  priceMatchesMachineConfiguration: true,
  machineStatus: null,
  nearbyMachineAlerts: [],
  rankingPoints: 100,
  recommendationRank: 1,
  isTopRanked: true,
  isRecommended: true,
  recommendationState: "high_confidence",
  confidenceClass: "strong_card",
  reasonCodes: ["exact_amount", "card_last4_match"],
  oneClickEligible: true,
  selectionAllowed: true,
  matchStrength: "strong",
  matchFactors: [],
  manualReviewReasons: [],
  hardExclusions: [],
  matchReason: "Exact deterministic card match",
  policyVersion: "refund-nayax-recommendation.v4",
  identifierPolicyVersion: "2026-09-05.identifier.v1",
  customerFactVersion: 1,
  customerCredentialClass: "customer_physical_contact_chip_pan",
  providerIdentifierClass: "last_sales_chip_identifier_unverified",
  cardLast4Comparison: "exact_support",
  cardNetworkComparison: "exact_support",
  paymentInteractionComparison: "supporting",
  sameIdentifierEquivalenceProven: false,
  identifierReviewState: "exact_support",
  customerCorrectionFields: [],
  ...options,
});

const rank = (machineA: NayaxProviderCandidate[], machineB: NayaxProviderCandidate[]) =>
  rankGroupedNayaxCandidates([
    { reportingMachineId: "machine-a", machineDisplayLabel: "Cotton candy machine A", candidates: machineA },
    { reportingMachineId: "machine-b", machineDisplayLabel: "Cotton candy machine B", candidates: machineB },
  ]);

Deno.test("one safe match on machine A binds only machine A", () => {
  const result = rank([candidate("txn-a")], []);
  assertEquals(result.recommendationState, "high_confidence");
  assertEquals(result.uniqueCandidate?.reportingMachineId, "machine-a");
  assertEquals(result.candidates[0].machineDisplayLabel, "Cotton candy machine A");
});

Deno.test("one safe match on machine B binds only machine B", () => {
  const result = rank([], [candidate("txn-b")]);
  assertEquals(result.recommendationState, "high_confidence");
  assertEquals(result.uniqueCandidate?.reportingMachineId, "machine-b");
});

Deno.test("zero safe matches never invents an exact machine", () => {
  const result = rank(
    [candidate("txn-a", { selectionAllowed: false, oneClickEligible: false })],
    [],
  );
  assertEquals(result.recommendationState, "no_safe_match");
  assertEquals(result.uniqueCandidate, null);
  assertEquals(result.oneClickEligible, false);
});

Deno.test("same-machine ambiguity requires explicit transaction confirmation", () => {
  const result = rank([candidate("txn-a1"), candidate("txn-a2")], []);
  assertEquals(result.recommendationState, "ambiguous");
  assertEquals(result.uniqueCandidate, null);
  assertEquals(result.candidates.every((item) => !item.isRecommended), true);
});

Deno.test("cross-machine ambiguity never attempts or guesses both machines", () => {
  const result = rank([candidate("txn-a")], [candidate("txn-b")]);
  assertEquals(result.recommendationState, "ambiguous");
  assertEquals(result.uniqueCandidate, null);
  assertEquals(result.oneClickEligible, false);
});

Deno.test("global ranking is deterministic across repeated input", () => {
  const machineA = [candidate("txn-z", { rankingPoints: 90, timeDeltaMinutes: 1 })];
  const machineB = [candidate("txn-a", { rankingPoints: 90, timeDeltaMinutes: 1 })];
  const first = rank(machineA, machineB).candidates.map((item) => item.transactionId);
  const retry = rank(machineA, machineB).candidates.map((item) => item.transactionId);
  assertEquals(first, ["txn-a", "txn-z"]);
  assertEquals(retry, first);
});
