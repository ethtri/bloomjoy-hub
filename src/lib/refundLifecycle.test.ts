/// <reference lib="deno.ns" />

import {
  isRefundLifecycleContract,
  REFUND_LIFECYCLE_SCHEMA_VERSION,
  requireRefundLifecycleContract,
  refundLifecycleStages,
} from "./refundLifecycle.ts";
import { getRefundLifecycleProgressPresentation } from './refundLifecyclePresentation.ts';

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};

Deno.test('every v2 lifecycle has an explicit progress label and nonpayment states have no payment milestones', () => {
  for (const stage of refundLifecycleStages) {
    const presentation = getRefundLifecycleProgressPresentation({ stage });
    assert(Boolean(presentation.label?.trim()), `${stage} has a readable label`);
    const nonPayment = ['denied', 'unable_to_complete', 'internal_test_archived', 'integrity_hold'].includes(stage);
    assert(presentation.showMilestones === !nonPayment, `${stage} milestone visibility`);
    if (nonPayment) assert(Boolean(presentation.note), `${stage} has explicit nonpayment copy`);
  }
});

const fixture = {
  schemaVersion: REFUND_LIFECYCLE_SCHEMA_VERSION,
  version: 7,
  stage: "needs_refund_operations",
  stageRank: 60,
  reasonCode: "provider_outcome_unknown",
  actor: "system",
  customerAction: {
    action: "none",
    required: false,
    requestedFields: [],
    payloadRedacted: true,
  },
  managerAction: {
    action: "refund_operations",
    owner: "Refund Operations",
    safeRetryEligible: false,
    payloadRedacted: true,
  },
  paymentState: "outcome_unknown",
  messageState: {
    state: "none",
    messageType: null,
    lastUpdatedAt: null,
    payloadRedacted: true,
  },
  classification: "customer",
  evidenceState: "operations_hold",
  locationEvidence: {
    customerReported: {
      selectionKey: "test-selection", selectionKind: "exact_machine",
      machineIds: ["a3000000-0000-4000-8000-000000000001"], preserved: true,
      payloadRedacted: true,
    },
    normalized: {
      locationId: "a2000000-0000-4000-8000-000000000001",
      machineId: "a3000000-0000-4000-8000-000000000001",
      timezone: "America/Los_Angeles", providerAccountKey: "TEST",
      mappingSource: "nayax", mappingVersion: 1, confidence: 1,
      authoritative: true, payloadRedacted: true,
    },
    payloadRedacted: true,
  },
  lastUpdatedAt: "2026-08-26T17:00:00.000Z",
  publicCopyKey: "refund_confirmation_in_progress",
  managerNextAction: "refund_operations",
  terminal: false,
  refreshAfterSeconds: 5,
  managerQueue: {
    schemaVersion: "refund_manager_queue_v2",
    bucket: "provider_hold",
    label: "Needs Refund Operations",
    nextAction: "refund_operations",
    safeRetryEligible: false,
    payloadRedacted: true,
  },
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
    !isRefundLifecycleContract({ ...fixture, schemaVersion: "refund_lifecycle_v3" }),
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

Deno.test("manager queue projection is required and fails closed", () => {
  const { managerQueue: _managerQueue, ...missingQueue } = fixture;
  assert(!isRefundLifecycleContract(missingQueue), "missing queue must fail closed");
  assert(
    !isRefundLifecycleContract({
      ...fixture,
      managerQueue: { ...fixture.managerQueue, bucket: "mystery" },
    }),
    "unknown manager queue buckets must fail closed",
  );
});

Deno.test("manager queue customer action fields are string-only", () => {
  const withFields = {
    ...fixture,
    managerQueue: {
      ...fixture.managerQueue,
      customerActionFields: ["incident_time", "card_last4"],
    },
  };
  assert(isRefundLifecycleContract(withFields), "string action fields should parse");
  assert(
    !isRefundLifecycleContract({
      ...withFields,
      managerQueue: {
        ...withFields.managerQueue,
        customerActionFields: ["incident_time", 4],
      },
    }),
    "non-string action fields should fail closed",
  );
});
