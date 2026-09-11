import {
  type AutomaticNayaxLookupCase,
  coordinateAutomaticNayaxLookup,
} from "./automatic-nayax-lookup.ts";
import { classifyNayaxLookupFailure } from "./nayax-lookup-persistence.ts";

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

Deno.test("not-ready card case is not due", () => {
  const outcome = coordinateAutomaticNayaxLookup({
    refundCase: { ...readyCase(), payment_amount_cents: null },
    source: "hosted_intake",
  });
  assert(
    outcome.status === "not_ready",
    "incomplete facts must remain not ready",
  );
});

Deno.test("ready case is due and active lookup deduplicates", () => {
  const first = coordinateAutomaticNayaxLookup({
    refundCase: readyCase(),
    source: "hosted_intake",
  });
  const repeated = coordinateAutomaticNayaxLookup({
    refundCase: { ...readyCase(), nayax_lookup_status: "checking" },
    source: "hosted_intake",
  });
  assert(
    first.status === "scheduled",
    "ready case must be due",
  );
  assert(
    repeated.status === "deduplicated",
    "active case work must deduplicate",
  );
});

Deno.test("customer reply completing facts makes the case due", () => {
  const outcome = coordinateAutomaticNayaxLookup({
    refundCase: readyCase(2),
    source: "customer_reply_recheck",
  });
  assert(
    outcome.status === "scheduled",
    "accepted customer facts must schedule a lookup",
  );
});

Deno.test("only proved-safe read failures enter automatic recovery", () => {
  for (
    const error of [
      Object.assign(new Error("timed out"), {
        name: "NayaxLookupTimeoutError",
      }),
      Object.assign(new Error("malformed"), {
        name: "NayaxLookupMalformedResponseError",
      }),
      Object.assign(new Error("unavailable"), {
        name: "NayaxLookupRequestError",
        status: 503,
      }),
      new Error("transport interrupted"),
    ]
  ) {
    assert(
      classifyNayaxLookupFailure(error).safeRetryEligible,
      `${error.name} must be safe for one read-only retry`,
    );
  }
});

Deno.test("response limits, stale evidence, and nonretryable provider responses go to operations", () => {
  for (
    const error of [
      Object.assign(new Error("response too large"), {
        name: "NayaxLookupResponseLimitError",
      }),
      Object.assign(new Error("evidence changed"), {
        name: "NayaxLookupEvidenceChangedError",
      }),
      Object.assign(new Error("forbidden"), {
        name: "NayaxLookupRequestError",
        status: 403,
      }),
    ]
  ) {
    assert(
      !classifyNayaxLookupFailure(error).safeRetryEligible,
      `${error.name} must never enter automatic retry`,
    );
  }
});
