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
    schemaVersion: "refund_lifecycle_v2",
    version: 4,
    stage: "needs_refund_operations",
    stageRank: 60,
    reasonCode: "provider_outcome_unknown",
    customerAction: {
      action: "none",
      required: false,
      requestedFields: [],
      payloadRedacted: true,
    },
    paymentState: "outcome_unknown",
    messageState: { state: "none", payloadRedacted: true },
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
    "customerAction",
    "lastUpdatedAt",
    "messageState",
    "payloadRedacted",
    "paymentState",
    "publicCopyKey",
    "reasonCode",
    "refreshAfterSeconds",
    "schemaVersion",
    "stage",
    "stageRank",
    "terminal",
    "version",
  ]);
  assertEquals(lifecycle.customerAction, {
    action: "none",
    required: false,
    requestedFields: [],
    payloadRedacted: true,
  });
  assertEquals(lifecycle.messageState, {
    state: "none",
    payloadRedacted: true,
  });
});

Deno.test("customer lifecycle accepts the canonical waiting-on-customer stage", () => {
  const lifecycle = requireCustomerRefundLifecycle({
    schemaVersion: "refund_lifecycle_v2",
    version: 5,
    stage: "waiting_on_customer",
    stageRank: 15,
    reasonCode: "waiting_for_purchase_evidence",
    customerAction: {
      action: "reply_in_existing_thread",
      required: true,
      requestedFields: ["incident_time"],
      payloadRedacted: true,
    },
    paymentState: "not_requested",
    messageState: { state: "sent", payloadRedacted: true },
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
    { schemaVersion: "refund_lifecycle_v3", payloadRedacted: true },
    {
      schemaVersion: "refund_lifecycle_v2",
      version: 1,
      stage: "matching",
      stageRank: 10,
      reasonCode: "lookup_in_progress",
      customerAction: { action: "none", required: false, requestedFields: [], payloadRedacted: true },
      paymentState: "not_requested",
      messageState: { state: "none", payloadRedacted: true },
      lastUpdatedAt: "2026-08-26T17:00:00.000Z",
      publicCopyKey: "refund_request_received",
      terminal: false,
      refreshAfterSeconds: 5,
      payloadRedacted: false,
    },
    {
      schemaVersion: "refund_lifecycle_v2",
      version: 1,
      stage: "matching",
      stageRank: 10,
      reasonCode: "lookup_in_progress",
      customerAction: { action: "none", required: false, requestedFields: [], payloadRedacted: true },
      paymentState: "not_requested",
      messageState: { state: "none", payloadRedacted: true },
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

Deno.test("nested lifecycle objects and bounded public values fail closed on extra or malformed data", async () => {
  const base = {
    schemaVersion: "refund_lifecycle_v2",
    version: 7,
    stage: "waiting_on_customer",
    stageRank: 15,
    reasonCode: "waiting_for_payout_destination",
    customerAction: {
      action: "reply_in_existing_thread",
      required: true,
      requestedFields: ["zelle_payment_contact"],
      payloadRedacted: true,
    },
    paymentState: "not_requested",
    messageState: { state: "sent", payloadRedacted: true },
    lastUpdatedAt: "2026-09-02T03:00:00.000Z",
    publicCopyKey: "refund_waiting_on_customer",
    terminal: false,
    refreshAfterSeconds: 15,
    payloadRedacted: true,
  };
  const fixtures: unknown[] = [];
  const add = (mutate: (fixture: Record<string, unknown>) => void) => {
    const fixture = structuredClone(base) as Record<string, unknown>;
    mutate(fixture);
    fixtures.push(fixture);
  };
  const customerAction = (fixture: Record<string, unknown>) =>
    fixture.customerAction as Record<string, unknown>;
  const messageState = (fixture: Record<string, unknown>) =>
    fixture.messageState as Record<string, unknown>;
  add((fixture) => customerAction(fixture).providerReference = "private");
  add((fixture) => customerAction(fixture).action = "send_provider_account");
  add((fixture) => customerAction(fixture).required = "true");
  add((fixture) => customerAction(fixture).payloadRedacted = false);
  add((fixture) => customerAction(fixture).requestedFields = [7]);
  add((fixture) => customerAction(fixture).requestedFields = [
    "zelle_payment_contact",
    "zelle_payment_contact",
  ]);
  add((fixture) => customerAction(fixture).requestedFields = ["provider_account"]);
  add((fixture) => messageState(fixture).providerReference = "private");
  add((fixture) => messageState(fixture).state = "provider_message_sent");
  add((fixture) => messageState(fixture).state = 7);
  add((fixture) => messageState(fixture).payloadRedacted = false);
  add((fixture) => fixture.reasonCode = "r".repeat(81));
  add((fixture) => fixture.reasonCode = "provider_account_identifier");
  add((fixture) => fixture.paymentState = "provider secret");
  add((fixture) => fixture.paymentState = "provider_account_linked");
  add((fixture) => fixture.publicCopyKey = "p".repeat(121));
  add((fixture) => fixture.publicCopyKey = "refund_provider_account_reference");

  for (const fixture of fixtures) {
    await assertRejects(
      async () => requireCustomerRefundLifecycle(fixture),
      Error,
      "Refund status is unavailable.",
    );
  }
});
