import {
  type AutomaticNayaxLookupCase,
  type AutomaticNayaxLookupSource,
  coordinateAutomaticNayaxLookup,
} from "./automatic-nayax-lookup.ts";
import type { NayaxLookupResult } from "./nayax-lookup.ts";

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};

const readyCase = (version = 1): AutomaticNayaxLookupCase => ({
  id: "63000000-0000-4000-8000-000000000001",
  status: "needs_review",
  decision: null,
  reporting_machine_id: "63000000-0000-4000-8000-000000000002",
  reporting_location_id: "63000000-0000-4000-8000-000000000003",
  incident_at: "2026-08-15T16:00:00.000Z",
  incident_time_resolution: "exact",
  payment_method: "card",
  payment_amount_cents: 750,
  card_last4: "4242",
  card_network: "visa",
  card_wallet_used: false,
  deterministic_fact_version: version,
});

const result = (
  recommendationState: NayaxLookupResult["recommendationState"] =
    "high_confidence",
): NayaxLookupResult => ({
  configured: true,
  lookupStatus: recommendationState === "high_confidence"
    ? "match_found"
    : recommendationState === "ambiguous"
    ? "multiple_matches"
    : "no_match",
  recommendationState,
  confidenceClass: recommendationState === "high_confidence"
    ? "strong_card"
    : "ambiguous_manual",
  reasonCodes: recommendationState === "high_confidence"
    ? ["exact_amount", "card_last4_match"]
    : ["multiple_plausible_candidates"],
  policyVersion: "nayax_deterministic_v1",
  oneClickEligible: recommendationState === "high_confidence",
  qrClaimEvidenceStatus: "missing",
  qrClaimOpenedAt: null,
  maximumUniqueQrLagMinutes: 30,
  lastCheckedAt: "2026-08-15T16:01:00.000Z",
  providerRecordCount: 2,
  providerWindowRecordCount: 2,
  candidateCount: recommendationState === "no_safe_match" ? 0 : 1,
  candidates: recommendationState === "no_safe_match" ? [] : [{
    candidateToken: "63000000-0000-4000-8000-000000000004",
    authorizedAt: "2026-08-15T16:00:00.000Z",
    machineAuthorizationTime: "2026-08-15T16:00:00.000Z",
    providerTimeResolution: "exact",
    timeDeltaMinutes: 0,
    qrTimeDeltaMinutes: null,
    amountCents: 750,
    amountDeltaCents: 0,
    currencyCode: "USD",
    cardLast4: "4242",
    cardBrand: "Visa",
    recognitionMethod: "card",
    paymentStatus: "settled",
    productLabel: "Cotton candy",
    productCode: "CC",
    standardPriceCents: 750,
    priceMatchesMachineConfiguration: true,
    machineStatus: null,
    nearbyMachineAlerts: [],
    recommendationRank: 1,
    isTopRanked: true,
    isRecommended: recommendationState === "high_confidence",
    recommendationState,
    confidenceClass: recommendationState === "high_confidence"
      ? "strong_card"
      : "ambiguous_manual",
    reasonCodes: ["exact_amount"],
    oneClickEligible: recommendationState === "high_confidence",
    selectionAllowed: true,
    matchStrength: recommendationState === "high_confidence"
      ? "strong"
      : "review",
    matchFactors: [],
    manualReviewReasons: [],
    hardExclusions: [],
    matchReason: "The amount, card ending, machine, and time agree.",
    policyVersion: "nayax_deterministic_v1",
  }],
  windowHours: 6,
  summary: "Deterministic transaction recommendation complete.",
  recommendedAction: "Review the likely transaction.",
});

const harness = ({
  lookupResult = result(),
  failLookup = false,
}: {
  lookupResult?: NayaxLookupResult;
  failLookup?: boolean;
} = {}) => {
  const claims = new Set<string>();
  const calls = {
    lookup: 0,
    pending: 0,
    persisted: [] as NayaxLookupResult[],
    failed: 0,
    finished: [] as Array<{ succeeded: boolean; reason: string }>,
  };
  const dependencies = {
    claim: async (
      { caseId, factVersion }: {
        caseId: string;
        factVersion: number;
        source: AutomaticNayaxLookupSource;
      },
    ) => {
      const key = `${caseId}:v${factVersion}`;
      if (claims.has(key)) {
        return { claimed: false, runId: "run", actionId: "action" };
      }
      claims.add(key);
      return {
        claimed: true,
        runId: `run-${factVersion}`,
        actionId: `action-${factVersion}`,
      };
    },
    markPending: async () => {
      calls.pending += 1;
      return calls.pending;
    },
    lookup: async () => {
      calls.lookup += 1;
      if (failLookup) throw new Error("provider unavailable");
      return lookupResult;
    },
    persist: async (
      _refundCase: AutomaticNayaxLookupCase,
      lookupResultToPersist: NayaxLookupResult,
    ) => {
      calls.persisted.push(lookupResultToPersist);
    },
    fail: async () => {
      calls.failed += 1;
    },
    finish: async (
      { succeeded, reason }: { succeeded: boolean; reason: string },
    ) => {
      calls.finished.push({ succeeded, reason });
    },
  };
  return { calls, dependencies };
};

Deno.test("not-ready card case runs zero automatic lookups", async () => {
  const test = harness();
  const outcome = await coordinateAutomaticNayaxLookup({
    refundCase: { ...readyCase(), payment_amount_cents: null },
    source: "hosted_intake",
    dependencies: test.dependencies,
  });
  assert(
    outcome.status === "not_ready",
    "incomplete facts must remain not ready",
  );
  assert(test.calls.lookup === 0, "not-ready case must not call Nayax");
});

Deno.test("ready transition runs once and unchanged repeats deduplicate", async () => {
  const test = harness();
  const first = await coordinateAutomaticNayaxLookup({
    refundCase: readyCase(),
    source: "hosted_intake",
    dependencies: test.dependencies,
  });
  const repeated = await coordinateAutomaticNayaxLookup({
    refundCase: readyCase(),
    source: "hosted_intake",
    dependencies: test.dependencies,
  });
  assert(
    first.status === "completed",
    "ready transition should complete lookup",
  );
  assert(
    repeated.status === "deduplicated",
    "unchanged reopen/update must deduplicate",
  );
  assert(test.calls.lookup === 1, "one evidence version must run exactly once");
});

Deno.test("material evidence version permits one refreshed lookup", async () => {
  const test = harness();
  await coordinateAutomaticNayaxLookup({
    refundCase: readyCase(1),
    source: "hosted_intake",
    dependencies: test.dependencies,
  });
  await coordinateAutomaticNayaxLookup({
    refundCase: { ...readyCase(2), payment_amount_cents: 800 },
    source: "linked_customer_update",
    dependencies: test.dependencies,
  });
  await coordinateAutomaticNayaxLookup({
    refundCase: { ...readyCase(2), payment_amount_cents: 800 },
    source: "linked_customer_update",
    dependencies: test.dependencies,
  });
  assert(
    test.calls.lookup === 2,
    "new fact version should run once, then deduplicate",
  );
});

Deno.test("customer reply completing facts triggers lookup", async () => {
  const test = harness();
  const outcome = await coordinateAutomaticNayaxLookup({
    refundCase: readyCase(2),
    source: "customer_reply_recheck",
    dependencies: test.dependencies,
  });
  assert(
    outcome.status === "completed",
    "ready customer reply must trigger lookup",
  );
  assert(
    test.calls.lookup === 1,
    "customer reply should call existing lookup once",
  );
});

Deno.test("concurrent repeated triggers share one evidence-version claim", async () => {
  const test = harness();
  const outcomes = await Promise.all(
    Array.from({ length: 8 }, () =>
      coordinateAutomaticNayaxLookup({
        refundCase: readyCase(),
        source: "hosted_intake",
        dependencies: test.dependencies,
      })),
  );
  assert(
    test.calls.lookup === 1,
    "concurrent triggers must not overlap provider lookup",
  );
  assert(
    outcomes.filter((outcome) => outcome.status === "completed").length === 1,
    "one trigger owns the lookup",
  );
});

Deno.test("matched recommendation is persisted without selecting a transaction", async () => {
  const test = harness({ lookupResult: result("high_confidence") });
  await coordinateAutomaticNayaxLookup({
    refundCase: readyCase(),
    source: "hosted_intake",
    dependencies: test.dependencies,
  });
  assert(
    test.calls.persisted[0]?.recommendationState === "high_confidence",
    "existing match recommendation must persist",
  );
  assert(
    test.calls.persisted[0]?.candidates[0]?.matchReason.includes("amount"),
    "plain-language match reason must remain available",
  );
  assert(
    !("matchedNayaxTransactionId" in test.calls.persisted[0]),
    "automatic lookup must not select a transaction",
  );
});

Deno.test("ambiguous and unmatched results persist without automatic selection", async () => {
  for (const state of ["ambiguous", "no_safe_match"] as const) {
    const test = harness({ lookupResult: result(state) });
    await coordinateAutomaticNayaxLookup({
      refundCase: readyCase(),
      source: "hosted_intake",
      dependencies: test.dependencies,
    });
    assert(
      test.calls.persisted[0]?.recommendationState === state,
      `${state} result must remain visible`,
    );
    assert(
      !("matchedNayaxTransactionId" in test.calls.persisted[0]),
      `${state} must not select a transaction`,
    );
  }
});

Deno.test("lookup failure records retry state and never invokes a refund path", async () => {
  const test = harness({ failLookup: true });
  const outcome = await coordinateAutomaticNayaxLookup({
    refundCase: readyCase(),
    source: "hosted_intake",
    dependencies: test.dependencies,
  });
  assert(outcome.status === "failed", "provider failure should be contained");
  assert(test.calls.failed === 1, "failure state must be recorded once");
  assert(
    test.calls.finished[0]?.reason === "nayax_lookup_failed",
    "retry reason must be actionable",
  );
  assert(
    test.calls.persisted.length === 0,
    "failure must not persist a guessed result or refund attempt",
  );
});
