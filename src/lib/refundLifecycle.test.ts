/// <reference lib="deno.ns" />

import {
  isRefundLifecycleContract,
  REFUND_LIFECYCLE_SCHEMA_VERSION,
  requireRefundLifecycleContract,
} from "./refundLifecycle.ts";

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};

const fixture = {
  schemaVersion: REFUND_LIFECYCLE_SCHEMA_VERSION,
  stage: "needs_refund_operations",
  stageRank: 60,
  evidenceState: "operations_hold",
  lastUpdatedAt: "2026-08-26T17:00:00.000Z",
  publicCopyKey: "refund_confirmation_in_progress",
  managerNextAction: "refund_operations",
  terminal: false,
  refreshAfterSeconds: 5,
  lookup: {
    status: "match_found",
    safeRetryEligible: false,
    failureClass: null,
    lastUpdatedAt: "2026-08-26T16:59:00.000Z",
  },
  operations: {
    required: true,
    queue: "Refund Operations",
    owner: "Refund Operations",
    slaMinutes: 60,
    ageMinutes: 12,
    dueAt: "2026-08-26T17:48:00.000Z",
    slaBreached: false,
    safeStage: "confirmation_hold",
    failureClass: "interrupted_after_transport",
    nextStep: "Confirm the authoritative Nayax result. Do not retry.",
  },
  payloadRedacted: true,
};

Deno.test("the versioned lifecycle parser accepts the redacted operations contract", () => {
  assert(isRefundLifecycleContract(fixture), "valid contract should parse");
  assert(
    requireRefundLifecycleContract(fixture).operations.slaMinutes === 60,
    "the parsed queue must retain its SLA",
  );
});

Deno.test("the lifecycle parser accepts only boolean definitive no-refund markers", () => {
  assert(
    isRefundLifecycleContract({
      ...fixture,
      definitiveNoRefund: true,
      safeRetryEligible: true,
      operations: {
        ...fixture.operations,
        required: false,
        safeStage: "released_no_refund",
      },
    }),
    "an exact released no-refund contract should parse",
  );
  assert(
    !isRefundLifecycleContract({ ...fixture, definitiveNoRefund: "yes" }),
    "non-boolean definitive markers must fail closed",
  );
  assert(
    !isRefundLifecycleContract({ ...fixture, safeRetryEligible: 1 }),
    "non-boolean safe retry markers must fail closed",
  );
});

Deno.test("unknown lifecycle versions and provider-shaped payloads fail closed", () => {
  assert(
    !isRefundLifecycleContract({ ...fixture, schemaVersion: "refund_lifecycle_v2" }),
    "unknown versions must fail closed",
  );
  assert(
    !isRefundLifecycleContract({
      ...fixture,
      operations: { ...fixture.operations, providerTransactionId: "secret" },
      payloadRedacted: false,
    }),
    "non-redacted payloads must fail closed",
  );
});
