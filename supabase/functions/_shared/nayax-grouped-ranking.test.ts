import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  type NayaxLookupResult,
  type NayaxProviderCandidate,
  persistNayaxLookupCandidates,
  rankGroupedNayaxCandidates,
  recommendationToLookupStatus,
} from "./nayax-lookup.ts";
import { persistNayaxLookupResult } from "./nayax-lookup-persistence.ts";
import { deriveNayaxCustomerCorrectionFields } from "./refund-nayax-customer-correction.ts";

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
  transactionOccurrenceSemantics: "online_purchase_occurrence",
  transactionOccurrenceProofSource: "synthetic_grouped_fixture",
  transactionOccurrenceTimestampSource: "authorization_gmt",
  transactionOccurrenceTimezoneBasis: "utc",
  transactionOccurrenceLowerBoundAt: "2026-08-23T10:00:00.000Z",
  transactionOccurrenceUpperBoundAt: "2026-08-23T10:00:00.000Z",
  requestReceiptLowerBoundAt: "2026-08-23T10:05:00.000Z",
  requestReceiptUpperBoundAt: "2026-08-23T10:05:00.000Z",
  timeDeltaMinutes: 2,
  providerProcessingTimeDeltaMinutes: 2,
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
  identifierPolicyVersion: "2026-09-05.identifier.v2",
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
  ], {
    incidentTimeResolution: "exact",
    incidentTimeConfidence: "exact",
  });

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
  assertEquals(recommendationToLookupStatus(result.recommendationState, result.candidates.length), "manual_exception");
  assertEquals(recommendationToLookupStatus(result.recommendationState, 0), "no_match");
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

Deno.test("rough-time same-card collision across grouped machines requires incident time", () => {
  const result = rankGroupedNayaxCandidates([
    { reportingMachineId: "machine-a", machineDisplayLabel: "Cotton candy machine A", candidates: [candidate("txn-a")] },
    { reportingMachineId: "machine-b", machineDisplayLabel: "Cotton candy machine B", candidates: [candidate("txn-b")] },
  ], {
    incidentTimeResolution: "time_window",
    incidentTimeConfidence: "rough",
  });
  assertEquals(result.recommendationState, "ambiguous");
  assertEquals(result.uniqueCandidate, null);
  assertEquals(result.selectableCandidates, []);
  assertEquals(result.candidates.map((item) => item.selectionAllowed), [false, false]);
  assertEquals(result.candidates.map((item) => item.identifierReviewState), [
    "needs_corroboration",
    "needs_corroboration",
  ]);
  assertEquals(result.candidates.map((item) => item.customerCorrectionFields), [
    ["incident_time"],
    ["incident_time"],
  ]);
  assertEquals(result.candidates.every((item) =>
    item.reasonCodes.includes("multiple_candidates_need_distinguishing_time")
  ), true);
});

Deno.test("rough-time grouped candidates with distinct card endings remain manager-reviewable", () => {
  const result = rankGroupedNayaxCandidates([
    { reportingMachineId: "machine-a", machineDisplayLabel: "Cotton candy machine A", candidates: [candidate("txn-a")] },
    { reportingMachineId: "machine-b", machineDisplayLabel: "Cotton candy machine B", candidates: [candidate("txn-b", { cardLast4: "9999" })] },
  ], {
    incidentTimeResolution: "time_window",
    incidentTimeConfidence: "rough",
  });
  assertEquals(result.recommendationState, "ambiguous");
  assertEquals(result.candidates.map((item) => item.selectionAllowed), [true, true]);
  assertEquals(result.candidates.every((item) =>
    !item.reasonCodes.includes("multiple_candidates_need_distinguishing_time")
  ), true);
});

Deno.test("a grouped selectable sale joins an existing same-card rough-time hold", () => {
  const held = (transactionId: string) => candidate(transactionId, {
    selectionAllowed: false,
    oneClickEligible: false,
    identifierReviewState: "needs_corroboration",
    customerCorrectionFields: ["incident_time"],
    reasonCodes: ["multiple_candidates_need_distinguishing_time"],
    manualReviewReasons: ["multiple_candidates_need_distinguishing_time"],
  });
  const result = rankGroupedNayaxCandidates([
    {
      reportingMachineId: "machine-a",
      machineDisplayLabel: "Cotton candy machine A",
      candidates: [held("txn-a1"), held("txn-a2")],
    },
    {
      reportingMachineId: "machine-b",
      machineDisplayLabel: "Cotton candy machine B",
      candidates: [candidate("txn-b")],
    },
  ], {
    incidentTimeResolution: "time_window",
    incidentTimeConfidence: "rough",
  });
  assertEquals(result.recommendationState, "ambiguous");
  assertEquals(result.selectableCandidates, []);
  assertEquals(result.candidates.map((item) => item.selectionAllowed), [false, false, false]);
  assertEquals(result.candidates.every((item) =>
    item.customerCorrectionFields.length === 1 && item.customerCorrectionFields[0] === "incident_time"
  ), true);
});

Deno.test("global ranking is deterministic across repeated input", () => {
  const machineA = [candidate("txn-z", { rankingPoints: 90, timeDeltaMinutes: 1 })];
  const machineB = [candidate("txn-a", { rankingPoints: 90, timeDeltaMinutes: 1 })];
  const first = rank(machineA, machineB).candidates.map((item) => item.transactionId);
  const retry = rank(machineA, machineB).candidates.map((item) => item.transactionId);
  assertEquals(first, ["txn-a", "txn-z"]);
  assertEquals(retry, first);
});

Deno.test("retained correction evidence commits a reviewable lifecycle with exact fields", async () => {
  const correctionFields = ["incident_time_source", "nearby_attempt_count"];
  const ranked = rank(
    [candidate("txn-correction", {
      selectionAllowed: false,
      oneClickEligible: false,
      identifierReviewState: "needs_corroboration",
      customerCorrectionFields: correctionFields,
      reasonCodes: ["card_last4_mismatch", "customer_occurrence_evidence_missing"],
      manualReviewReasons: ["customer_occurrence_evidence_missing"],
      hardExclusions: ["card_last4_mismatch"],
    })],
    [],
  );
  const lookupStatus = recommendationToLookupStatus(
    ranked.recommendationState,
    ranked.candidates.length,
  );
  assertEquals(ranked.recommendationState, "no_safe_match");
  assertEquals(lookupStatus, "manual_exception");

  let insertedRows: Array<Record<string, unknown>> = [];
  const candidateStore = {
    from: (table: string) => {
      if (table !== "refund_nayax_lookup_candidates") throw new Error(`Unexpected table ${table}`);
      return {
        delete: () => ({
          lt: async () => ({ error: null }),
          eq: () => ({ eq: async () => ({ error: null }) }),
        }),
        insert: async (rows: Array<Record<string, unknown>>) => {
          insertedRows = rows;
          return { error: null };
        },
      };
    },
  };
  await persistNayaxLookupCandidates({
    supabase: candidateStore as never,
    caseId: "case-correction",
    actorUserId: null,
    lookupGeneration: 4,
    candidates: ranked.candidates,
    lookupScopes: [{
      reportingMachineId: "machine-a",
      accountKey: "TGPACI_USA_DB",
      nayaxMachineId: "provider-machine",
    }],
  });
  assertEquals(
    (insertedRows[0].evidence_summary as Record<string, unknown>).customer_correction_fields,
    correctionFields,
  );
  assertEquals(
    (insertedRows[0].evidence_summary as Record<string, unknown>).machine_authorization_at,
    ranked.candidates[0].machineAuthorizationTime,
  );

  const commitCalls: Array<Record<string, unknown>> = [];
  const resultStore = {
    rpc: async (name: string, params: Record<string, unknown>) => {
      assertEquals(name, "service_commit_refund_nayax_lookup_with_diagnostics");
      commitCalls.push(params);
      return { data: { applied: true }, error: null };
    },
  };
  await persistNayaxLookupResult({
    supabase: resultStore as never,
    caseId: "case-correction",
    actorUserId: null,
    result: {
      configured: true,
      lookupStatus,
      recommendationState: ranked.recommendationState,
      confidenceClass: "ambiguous_manual",
      reasonCodes: ["customer_occurrence_evidence_missing"],
      policyVersion: ranked.candidates[0].policyVersion,
      oneClickEligible: false,
      qrClaimEvidenceStatus: "missing",
      qrClaimOpenedAt: null,
      maximumUniqueQrLagMinutes: 10,
      lastCheckedAt: "2026-08-23T10:06:00.000Z",
      candidateCount: ranked.candidates.length,
      candidates: [],
      windowHours: 6,
      providerClockContexts: [],
      providerRecordCount: 1,
      providerParseableRecordCount: 1,
      providerWindowRecordCount: 1,
      excludedAfterRequestCount: 0,
      uncertainRequestTimeCandidateCount: 0,
      summary: "One retained candidate needs customer occurrence evidence.",
      recommendedAction: "Ask only for the missing occurrence details.",
      resolvedMachineId: null,
      refundCase: {
        id: "case-correction",
        publicReference: "RF-TEST",
        status: "needs_review",
        customerEmail: "customer@example.invalid",
        customerName: null,
        paymentMethod: "card",
        paymentAmountCents: 550,
        refundAmountCents: 550,
        machineLabel: "Cotton candy machine A",
        locationName: "Test location",
        incidentAt: "2026-08-23T10:00:00.000Z",
        incidentTimeResolution: "exact",
        incidentTimeConfidence: "exact",
        locationTimezone: "America/Los_Angeles",
        customerRequestReceivedAt: "2026-08-23T10:05:00.000Z",
        customerRequestReceivedSource: "hosted_refund_intake",
        qrClaimOpenedAt: null,
      },
    } as NayaxLookupResult,
    trigger: "automatic",
    expectedFactVersion: 1,
    lookupGeneration: 4,
  });
  assertEquals(commitCalls[0].p_lookup_status, "manual_exception");
  assertEquals(commitCalls[0].p_recommendation_state, "no_safe_match");
  assertEquals(commitCalls[0].p_candidate_count, 1);
  assertEquals(
    deriveNayaxCustomerCorrectionFields({
      recommendationState: ranked.recommendationState,
      paymentInteraction: "tap_card",
      cardLast4Source: "physical_card",
      cardNetwork: "visa",
      incidentTimeSource: null,
      candidates: ranked.candidates,
    }),
    correctionFields,
  );
});

Deno.test("provider-only and manager-reviewable evidence remain customer-silent", () => {
  const providerOnly = rank(
    [candidate("txn-provider", {
      selectionAllowed: false,
      oneClickEligible: false,
      identifierReviewState: "needs_corroboration",
      customerCorrectionFields: [],
      reasonCodes: ["missing_provider_site_id"],
      manualReviewReasons: ["missing_provider_site_id"],
      hardExclusions: ["missing_provider_site_id"],
    })],
    [],
  );
  assertEquals(
    recommendationToLookupStatus(providerOnly.recommendationState, providerOnly.candidates.length),
    "manual_exception",
  );
  assertEquals(
    deriveNayaxCustomerCorrectionFields({
      recommendationState: providerOnly.recommendationState,
      candidates: providerOnly.candidates,
    }),
    [],
  );

  const managerReview = rank(
    [candidate("txn-manager", {
      recommendationState: "manual_exception",
      oneClickEligible: false,
      identifierReviewState: "reviewable_uncertainty",
      customerCorrectionFields: [],
      reasonCodes: ["card_last4_mismatch"],
      manualReviewReasons: ["identifier_mismatch_reviewable"],
      hardExclusions: [],
    })],
    [],
  );
  assertEquals(managerReview.recommendationState, "manual_exception");
  assertEquals(
    recommendationToLookupStatus(managerReview.recommendationState, managerReview.candidates.length),
    "manual_exception",
  );
  assertEquals(
    deriveNayaxCustomerCorrectionFields({
      recommendationState: managerReview.recommendationState,
      candidates: managerReview.candidates,
    }),
    [],
  );
});
