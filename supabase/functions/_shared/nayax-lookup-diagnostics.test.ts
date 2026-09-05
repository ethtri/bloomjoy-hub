import { assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildNayaxLookupDiagnostics, persistNayaxLookupResult } from "./nayax-lookup-persistence.ts";
import type { NayaxLookupResult } from "./nayax-lookup.ts";
import { buildNayaxRecommendation } from "./nayax-recommendation.mjs";

const result = {
  configured: true, lookupStatus: "no_match", recommendationState: "no_safe_match",
  policyVersion: "2026-09-05.v8", lastCheckedAt: "2026-09-04T15:30:40Z",
  providerRecordCount: 12, providerParseableRecordCount: 11, providerWindowRecordCount: 0,
  excludedAfterRequestCount: 0, uncertainRequestTimeCandidateCount: 0,
  candidateCount: 0, candidates: [], windowHours: 6, summary: "Recent coverage unknown",
  refundCase: { incidentAt: "2026-08-29T20:10:00Z", incidentTimeResolution: "exact",
    incidentTimeConfidence: "rough", locationTimezone: "America/New_York",
    customerRequestReceivedAt: "2026-08-29T20:20:00Z",
    customerRequestReceivedSource: "hosted_refund_intake",
    customerEmail: "not-persisted@example.invalid", cardLast4: "4242" },
} as unknown as NayaxLookupResult;

Deno.test("existing response counts distinguish no local-window rows from provider-empty without private fields", () => {
  const diagnostic = buildNayaxLookupDiagnostics(result)!;
  assertEquals(diagnostic.providerRecordCount, 12);
  assertEquals(diagnostic.providerParseableRecordCount, 11);
  assertEquals(diagnostic.providerWindowRecordCount, 0);
  assertEquals(diagnostic.windowStart, "2026-08-29T14:10:00.000Z");
  assertEquals(diagnostic.windowEnd, "2026-08-30T02:10:00.000Z");
  assertEquals(diagnostic.incidentTimeResolution, "exact");
  assertEquals(diagnostic.incidentTimeConfidence, "rough");
  assertEquals(diagnostic.historicalCoverage, "unknown");
  assertEquals(JSON.stringify(diagnostic).includes("4242"), false);
  assertEquals(JSON.stringify(diagnostic).includes("@"), false);
  assertEquals(diagnostic.machineTimezoneSource, "configured_location_not_verified_provider_clock");
  assertEquals(diagnostic.schemaVersion, "nayax_lookup_diagnostics_v3");
  assertEquals(diagnostic.customerRequestReceivedAt, "2026-08-29T20:20:00.000Z");
  assertEquals(diagnostic.customerRequestReceivedSource, "hosted_refund_intake");
  assertEquals(diagnostic.excludedAfterRequestCount, 0);
  assertEquals(diagnostic.uncertainRequestTimeCandidateCount, 0);
  assertEquals(buildNayaxLookupDiagnostics({ ...result, windowHours: 0 }), null);
  for (const resolution of ["invalid_local_time", "invalid_timezone"]) {
    assertEquals(buildNayaxLookupDiagnostics({ ...result,
      refundCase: { ...result.refundCase!, incidentTimeResolution: resolution } })?.incidentTimeResolution, resolution);
  }
  for (const confidence of ["exact", "within_15_minutes", "within_1_hour", "rough"]) {
    assertEquals(buildNayaxLookupDiagnostics({ ...result,
      refundCase: { ...result.refundCase!, incidentTimeConfidence: confidence } })?.incidentTimeConfidence, confidence);
  }
});

Deno.test("actual persistence sends one existing result through scoped diagnostic wrapper; stale result is not success", async () => {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const supabase = { rpc(name: string, args: Record<string, unknown>) {
    calls.push({ name, args }); return Promise.resolve({ data: { applied: calls.length === 1 }, error: null });
  } } as unknown as Parameters<typeof persistNayaxLookupResult>[0]["supabase"];
  const input = { supabase, caseId: "case-fixture", actorUserId: "actor-fixture", result,
    trigger: "manual" as const, expectedFactVersion: 1, lookupGeneration: 3 };
  await persistNayaxLookupResult(input);
  assertEquals(calls.length, 1);
  assertEquals(calls[0].name, "service_commit_refund_nayax_lookup_with_diagnostics");
  assertEquals(calls[0].args.p_diagnostics, buildNayaxLookupDiagnostics(result));
  await assertRejects(() => persistNayaxLookupResult(input), Error, "matching evidence changed");
  assertEquals(calls.length, 2, "No automatic retry or fallback commit");
});

Deno.test("empty and outside-window recent payloads preserve matching outcome and describe coverage honestly", () => {
  const input = { incidentAt: "2026-08-29T20:10:00Z", expectedMachineId: "1",
    locationTimezone: "America/New_York", requestAmountCents: 963, requestCardLast4: "4242", cardWalletUsed: false, windowHours: 6 };
  const empty = buildNayaxRecommendation({ ...input, payload: [] });
  const outside = buildNayaxRecommendation({ ...input, payload: [{ TransactionID: "fixture-1", MachineID: "1",
    MachineAuthorizationTime: "2026-09-04T10:00:00", AuthorizationDateTimeGMT: "2026-09-04T14:00:00Z" }] });
  assertEquals(empty.providerParseableRecordCount, 0);
  assertEquals(outside.providerParseableRecordCount, 1);
  for (const recommendation of [empty, outside]) {
    assertEquals(recommendation.providerWindowRecordCount, 0);
    assertEquals(recommendation.recommendationState, "no_safe_match");
    assertEquals(recommendation.candidates.length, 0);
    assertEquals(recommendation.summary.includes("Historical coverage is unknown"), true);
  }
});

Deno.test("actual persistence emits bounded v3 clock and request contexts without changing the customer window or retrying", async () => {
  const contexts = [{ reportingMachineId: "fc440000-0000-4000-8000-000000000001",
    timezone: "America/Los_Angeles", source: "native_machine_configuration",
    observedAt: "2026-09-04T15:44:13.963271+00:00", rawPayload: "must-not-persist" },
  { reportingMachineId: "fc440000-0000-4000-8000-000000000002",
    timezone: null, source: "unknown", observedAt: null }];
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const supabase = { rpc(name: string, args: Record<string, unknown>) {
    calls.push({ name, args }); return Promise.resolve({ data: { applied: true }, error: null });
  } } as unknown as Parameters<typeof persistNayaxLookupResult>[0]["supabase"];
  await persistNayaxLookupResult({ supabase, caseId: "case-fixture", actorUserId: "actor-fixture",
    result: { ...result, providerClockContexts: contexts }, trigger: "manual", expectedFactVersion: 1, lookupGeneration: 3 });
  assertEquals(calls.length, 1);
  assertEquals(calls[0].name, "service_commit_refund_nayax_lookup_with_diagnostics");
  const diagnostic = calls[0].args.p_diagnostics as Record<string, unknown>;
  assertEquals(Object.keys(diagnostic).length, 21);
  assertEquals(diagnostic.schemaVersion, "nayax_lookup_diagnostics_v3");
  assertEquals(diagnostic.providerClockContexts, contexts.map(({ rawPayload: _raw, ...context }) => context));
  assertEquals(diagnostic.locationTimezone, "America/New_York");
  assertEquals(diagnostic.windowStart, "2026-08-29T14:10:00.000Z");
  assertEquals(diagnostic.historicalCoverage, "unknown");
  assertEquals(JSON.stringify(diagnostic).includes("must-not-persist"), false);
  assertEquals(buildNayaxLookupDiagnostics(result)?.schemaVersion, "nayax_lookup_diagnostics_v3");
  const unknownAnchor = buildNayaxLookupDiagnostics({ ...result, refundCase: {
    ...result.refundCase!, customerRequestReceivedAt: null, customerRequestReceivedSource: null,
  } });
  assertEquals(unknownAnchor?.customerRequestReceivedAt, null);
  assertEquals(unknownAnchor?.customerRequestReceivedSource, null);
});
