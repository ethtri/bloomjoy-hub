import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import {
  createRefundStatusToken,
  hashRefundStatusValue,
  isRefundStatusToken,
  REFUND_STATUS_TOKEN_BYTES,
  requireCustomerRefundLifecycle,
} from "./refund-status-capability.ts";

Deno.test("refund status tokens contain 256 bits and use a URL-safe shape", () => {
  assertEquals(REFUND_STATUS_TOKEN_BYTES, 32);
  const first = createRefundStatusToken();
  const second = createRefundStatusToken();
  assertEquals(isRefundStatusToken(first), true);
  assertEquals(isRefundStatusToken(second), true);
  assertEquals(first === second, false);
});

Deno.test("refund status hashing is stable and one way", async () => {
  const token = createRefundStatusToken();
  const digest = await hashRefundStatusValue(token);
  assertEquals(digest.length, 64);
  assertEquals(digest.includes(token), false);
  assertEquals(await hashRefundStatusValue(token), digest);
});

Deno.test("customer lifecycle strips manager, lookup, operations, and provider fields", () => {
  const lifecycle = requireCustomerRefundLifecycle({
    schemaVersion: "refund_lifecycle_v1",
    stage: "needs_refund_operations",
    stageRank: 60,
    evidenceState: "operations_hold",
    lastUpdatedAt: "2026-08-26T17:00:00.000Z",
    publicCopyKey: "refund_confirmation_in_progress",
    managerNextAction: "refund_operations",
    terminal: false,
    refreshAfterSeconds: 5,
    lookup: { failureClass: "provider_secret" },
    operations: { nextStep: "Visit Nayax DTM" },
    providerReference: "must-not-pass",
    payloadRedacted: true,
  });
  assertEquals(Object.keys(lifecycle).sort(), [
    "lastUpdatedAt",
    "payloadRedacted",
    "publicCopyKey",
    "refreshAfterSeconds",
    "schemaVersion",
    "stage",
    "stageRank",
    "terminal",
  ]);
});

Deno.test("customer lifecycle accepts the canonical waiting-on-customer stage", () => {
  const lifecycle = requireCustomerRefundLifecycle({
    schemaVersion: "refund_lifecycle_v1",
    stage: "waiting_on_customer",
    stageRank: 15,
    lastUpdatedAt: "2026-08-30T18:00:00.000Z",
    publicCopyKey: "refund_waiting_on_customer",
    terminal: false,
    refreshAfterSeconds: 15,
    payloadRedacted: true,
  });
  assertEquals(lifecycle.stage, "waiting_on_customer");
});

Deno.test("unknown, unredacted, and over-polling lifecycle responses fail closed", async () => {
  for (const fixture of [
    { schemaVersion: "refund_lifecycle_v2", payloadRedacted: true },
    {
      schemaVersion: "refund_lifecycle_v1",
      stage: "matching",
      stageRank: 10,
      lastUpdatedAt: "2026-08-26T17:00:00.000Z",
      publicCopyKey: "refund_request_received",
      terminal: false,
      refreshAfterSeconds: 5,
      payloadRedacted: false,
    },
    {
      schemaVersion: "refund_lifecycle_v1",
      stage: "matching",
      stageRank: 10,
      lastUpdatedAt: "2026-08-26T17:00:00.000Z",
      publicCopyKey: "refund_request_received",
      terminal: false,
      refreshAfterSeconds: 16,
      payloadRedacted: true,
    },
  ]) {
    await assertRejects(
      async () => requireCustomerRefundLifecycle(fixture),
      Error,
      "Refund status is unavailable.",
    );
  }
});
