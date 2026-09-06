import { strict as assert } from "node:assert";
import { buildNayaxProviderClockContext, loadNayaxProviderClockContext, withNayaxProviderClockDiagnostics } from "./nayax-provider-clock.mjs";
import { buildNayaxRecommendation, toPublicNayaxCandidate } from "./nayax-recommendation.mjs";

const reportingMachineId = "00000000-0000-4000-8000-000000000023";
const inventory = (timezone = "America/Los_Angeles") => ({
  provider_clock_timezone: timezone,
  provider_clock_source: "native_machine_configuration",
  provider_clock_observed_at: "2026-09-04T15:44:13.963271Z",
  provider_clock_daylight_saving: true,
});
const sale = (raw: string, gmt?: string) => ({
  TransactionID: "12345", MachineID: "938197833", SiteID: 4,
  MachineAuthorizationTime: raw, ...(gmt ? { AuthorizationDateTimeGMT: gmt } : {}),
  AuthorizationValue: 10, CurrencyCode: "USD", CardNumber: "************4242",
  PaymentStatus: "Approved", RecognitionMethod: "Chip", CardBrand: "Visa",
});
const recommend = (record: object, incidentAt: string, context = buildNayaxProviderClockContext(reportingMachineId, inventory())) =>
  buildNayaxRecommendation({ payload: [record], incidentAt, expectedMachineId: "938197833",
    locationTimezone: "America/New_York", providerClockContext: context,
    requestAmountCents: 1000, requestCardLast4: "4242", cardWalletUsed: false,
    incidentTimeResolution: "exact", incidentTimeConfidence: "exact", providerContract: "nayax_machine_last_sales_v1" });

Deno.test("verified Pacific machine clock is distinct from physical Eastern purchase zone and preserves raw binding", () => {
  const raw = "2026-08-29T13:10:00.1234567";
  const result = recommend(sale(raw), "2026-08-29T20:10:00.123Z");
  assert.equal(result.providerWindowRecordCount, 1);
  const candidate = result.candidates[0];
  assert.equal(candidate.authorizedAt, "2026-08-29T20:10:00.123Z");
  assert.equal(candidate.machineAuthorizationTimeRaw, raw);
  assert.equal(candidate.machineAuthorizationTime, "2026-08-29T20:10:00.123Z");
  assert.equal(candidate.machineClockContext.timezone, "America/Los_Angeles");
  assert.equal(candidate.timeDeltaMinutes, null);
  assert.equal(candidate.providerProcessingTimeDeltaMinutes, 0);
  const publicCandidate = toPublicNayaxCandidate(candidate, "synthetic-token");
  assert.equal("machineClockContext" in publicCandidate, false);
  assert.equal("machineAuthorizationTimeRaw" in publicCandidate, false);
});

Deno.test("explicit GMT remains authoritative and explicit machine offset is never reinterpreted", () => {
  const result = recommend(sale("2026-08-29T13:10:00-04:00", "2026-08-29T21:10:00"), "2026-08-29T21:10:00Z");
  assert.equal(result.candidates[0].authorizedAt, "2026-08-29T21:10:00.000Z");
  assert.equal(result.candidates[0].machineAuthorizationTime, "2026-08-29T17:10:00.000Z");
  assert.equal(result.candidates[0].machineAuthorizationTimeRaw, "2026-08-29T13:10:00-04:00");
});

Deno.test("unknown provider clock retains explicit unknown provenance and compatible location fallback", () => {
  const context = buildNayaxProviderClockContext(reportingMachineId, null);
  const result = recommend(sale("2026-08-29T13:10:00"), "2026-08-29T17:10:00Z", context);
  assert.equal(result.candidates[0].authorizedAt, "2026-08-29T17:10:00.000Z");
  assert.deepEqual(result.candidates[0].machineClockContext, { reportingMachineId, timezone: null, source: "unknown", observedAt: null });
});

Deno.test("DST gap/overlap follows verified provider clock; ambiguous evidence does not become exact", () => {
  const gap = recommend(sale("2026-03-08T02:30:00"), "2026-03-08T10:30:00Z");
  assert.equal(gap.candidates.length, 0);
  const overlap = recommend(sale("2026-11-01T01:30:00"), "2026-11-01T08:30:00Z");
  assert.equal(overlap.candidates[0].machineTimeResolution, "ambiguous");
  assert.equal(overlap.candidates[0].oneClickEligible, false);
  const indiana = buildNayaxProviderClockContext(reportingMachineId, inventory("America/Indiana/Indianapolis"));
  assert.equal(recommend(sale("2026-08-29T13:10:00"), "2026-08-29T17:10:00Z", indiana).candidates[0].authorizedAt, "2026-08-29T17:10:00.000Z");
});

Deno.test("clock loader reads only the exact account/provider/reporting mapping and rejects malformed verified evidence", async () => {
  const calls: unknown[] = [];
  const query = { select: (v: string) => { calls.push(["select", v]); return query; },
    eq: (k: string, v: string) => { calls.push([k, v]); return query; },
    maybeSingle: () => Promise.resolve({ data: inventory(), error: null }) };
  const client = { from: (v: string) => { calls.push(["from", v]); return query; } };
  await loadNayaxProviderClockContext(client, { reportingMachineId, accountKey: "TGPACI_USA_DB", nayaxMachineId: "938197833" });
  assert.deepEqual(calls.slice(2), [["account_key", "TGPACI_USA_DB"], ["nayax_machine_id", "938197833"], ["reporting_machine_id", reportingMachineId]]);
  assert.throws(() => buildNayaxProviderClockContext(reportingMachineId, { ...inventory(), provider_clock_daylight_saving: false }), /incomplete/);
  assert.throws(() => buildNayaxProviderClockContext(reportingMachineId, inventory("not/a/zone")), /invalid/);
});

Deno.test("v2 diagnostics explicitly extends v1 with only bounded clock fields; old caller stays v1", () => {
  const original = { schemaVersion: "nayax_lookup_diagnostics_v1", machineTimezoneSource: "configured_location_not_verified_provider_clock", historicalCoverage: "unknown" };
  assert.equal(withNayaxProviderClockDiagnostics(original, undefined), original);
  assert.equal(withNayaxProviderClockDiagnostics(null, []), null);
  const clock = buildNayaxProviderClockContext(reportingMachineId, inventory());
  const upgraded = withNayaxProviderClockDiagnostics(original, [{ ...clock, rawProviderPayload: "not-persisted" }]);
  assert.equal(upgraded.schemaVersion, "nayax_lookup_diagnostics_v2");
  assert.equal(upgraded.historicalCoverage, "unknown");
  assert.deepEqual(upgraded.providerClockContexts, [clock]);
  assert.equal(JSON.stringify(upgraded).includes("not-persisted"), false);
  assert.equal(original.schemaVersion, "nayax_lookup_diagnostics_v1");
});
