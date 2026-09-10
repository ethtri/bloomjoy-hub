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

const durableQueueHarness = () => {
  const scheduled = new Set<string>();
  const claimed = new Set<string>();
  let providerReads = 0;
  const enqueue = async (
    { caseId, factVersion }: { caseId: string; factVersion: number },
  ) => {
    const key = `${caseId}:v${factVersion}:r0:a0`;
    if (scheduled.has(key)) return { status: "deduplicated" as const };
    scheduled.add(key);
    return { status: "scheduled" as const };
  };
  const runSweep = async () => {
    const key = [...scheduled].find((candidate) => !claimed.has(candidate));
    if (!key) return "deduplicated" as const;
    claimed.add(key);
    providerReads += 1;
    return "completed" as const;
  };
  return {
    enqueue,
    runSweep,
    scheduled,
    get providerReads() {
      return providerReads;
    },
  };
};

Deno.test("not-ready card case creates no durable work", async () => {
  const queue = durableQueueHarness();
  const outcome = await coordinateAutomaticNayaxLookup({
    refundCase: { ...readyCase(), payment_amount_cents: null },
    source: "hosted_intake",
    dependencies: { enqueue: queue.enqueue },
  });
  assert(
    outcome.status === "not_ready",
    "incomplete facts must remain not ready",
  );
  assert(
    queue.scheduled.size === 0,
    "incomplete facts must not enqueue provider work",
  );
});

Deno.test("ready event enqueues once and unchanged repeats deduplicate", async () => {
  const queue = durableQueueHarness();
  const first = await coordinateAutomaticNayaxLookup({
    refundCase: readyCase(),
    source: "hosted_intake",
    dependencies: { enqueue: queue.enqueue },
  });
  const repeated = await coordinateAutomaticNayaxLookup({
    refundCase: readyCase(),
    source: "hosted_intake",
    dependencies: { enqueue: queue.enqueue },
  });
  assert(
    first.status === "scheduled",
    "ready transition must schedule durable work",
  );
  assert(
    repeated.status === "deduplicated",
    "unchanged event must deduplicate",
  );
  assert(
    queue.providerReads === 0,
    "event handler must never read the provider",
  );
});

Deno.test("material evidence version schedules one independent lookup", async () => {
  const queue = durableQueueHarness();
  for (const version of [1, 2, 2]) {
    await coordinateAutomaticNayaxLookup({
      refundCase: readyCase(version),
      source: "linked_customer_update",
      dependencies: { enqueue: queue.enqueue },
    });
  }
  assert(
    queue.scheduled.size === 2,
    "each fact version must have exactly one generation-zero row",
  );
});

Deno.test("customer reply completing facts schedules server work without provider access", async () => {
  const queue = durableQueueHarness();
  const outcome = await coordinateAutomaticNayaxLookup({
    refundCase: readyCase(2),
    source: "customer_reply_recheck",
    dependencies: { enqueue: queue.enqueue },
  });
  assert(
    outcome.status === "scheduled",
    "accepted customer facts must schedule a lookup",
  );
  assert(
    queue.providerReads === 0,
    "Gmail/event processing must not own the provider read",
  );
});

Deno.test("event plus concurrent and repeated sweeps produce one provider read", async () => {
  const queue = durableQueueHarness();
  await Promise.all(
    Array.from({ length: 8 }, () =>
      coordinateAutomaticNayaxLookup({
        refundCase: readyCase(),
        source: "hosted_intake",
        dependencies: { enqueue: queue.enqueue },
      })),
  );
  const outcomes = await Promise.all(
    Array.from({ length: 8 }, () => queue.runSweep()),
  );
  await queue.runSweep();
  assert(
    queue.scheduled.size === 1,
    "concurrent event delivery must create one queue row",
  );
  assert(
    queue.providerReads === 1,
    "only one claimed sweep may read the provider",
  );
  assert(
    outcomes.filter((outcome) => outcome === "completed").length === 1,
    "one sweep must own the exact attempt",
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
