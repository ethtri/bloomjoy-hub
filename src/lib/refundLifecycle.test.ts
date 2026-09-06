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

Deno.test("the lifecycle parser accepts optional receipt accounting separation", () => {
  const receiptLifecycle = {
    ...fixture,
    stage: "refund_confirmed",
    stageRank: 70,
    reasonCode: "settlement_time_unknown",
    paymentState: "confirmed",
    paymentWorkComplete: true,
    safeRetryEligible: false,
    managerNextAction: "review_accounting_date",
    managerAction: {
      action: "review_accounting_date",
      owner: "Refund Operations",
      safeRetryEligible: false,
      payloadRedacted: true,
    },
    managerQueue: {
      ...fixture.managerQueue,
      bucket: "accounting_review",
      label: "Refund confirmed · accounting review",
      nextAction: "review_accounting_date",
      safeRetryEligible: false,
      customerActionFields: [],
    },
    operations: {
      ...fixture.operations,
      required: true,
      safeStage: "payment_confirmed_accounting_pending",
      failureClass: "settlement_time_unknown",
    },
    accountingState: {
      state: "pending",
      owner: "Refund Operations",
      settlementTimePrecision: "unknown",
      settledAt: null,
      blocksPaymentCompletion: false,
      blocksCustomerNotice: false,
      payloadRedacted: true,
    },
  };
  assert(isRefundLifecycleContract(receiptLifecycle), "receipt accounting state should parse");
  assert(
    requireRefundLifecycleContract(receiptLifecycle).accountingState?.blocksCustomerNotice === false,
    "receipt accounting must remain separate from customer notice delivery",
  );
  const sentReceiptLifecycle = {
    ...receiptLifecycle,
    stage: "customer_notified",
    messageState: { ...receiptLifecycle.messageState, state: "sent" },
    terminal: true,
    refreshAfterSeconds: null,
  };
  assert(
    isRefundLifecycleContract(sentReceiptLifecycle),
    "sent canonical receipt accounting should stop polling and parse",
  );
  assert(
    !isRefundLifecycleContract({ ...sentReceiptLifecycle, terminal: false }),
    "sent canonical receipt accounting cannot remain nonterminal",
  );
  assert(
    !isRefundLifecycleContract({ ...sentReceiptLifecycle, refreshAfterSeconds: 5 }),
    "sent canonical receipt accounting cannot keep polling",
  );
  assert(
    !isRefundLifecycleContract({ ...fixture, paymentWorkComplete: true }),
    "payment completion without accounting state must fail closed",
  );
  assert(
    isRefundLifecycleContract(fixture),
    "lifecycles without receipt accounting fields remain backward compatible",
  );
  const {
    paymentWorkComplete: _paymentWorkComplete,
    accountingState: _accountingState,
    ...receiptWithoutInternalAccounting
  } = receiptLifecycle;
  const restrictedManagerLifecycle = {
    ...receiptWithoutInternalAccounting,
    managerVisibility: "restricted",
    reasonCode: "customer_notification_pending",
    managerNextAction: "wait",
    managerAction: {
      action: "wait",
      owner: "System",
      safeRetryEligible: false,
      payloadRedacted: true,
    },
    managerQueue: {
      schemaVersion: "refund_manager_queue_v2",
      bucket: "in_progress",
      label: "Refund confirmed · customer notice pending",
      nextAction: "wait",
      safeRetryEligible: false,
      customerActionFields: [],
      payloadRedacted: true,
    },
    operations: {
      required: false,
      queue: "System",
      owner: "System",
      slaMinutes: 60,
      ageMinutes: null,
      dueAt: null,
      slaBreached: false,
      safeStage: "customer_notice_pending",
      failureClass: null,
      nextStep: null,
    },
    terminal: false,
    refreshAfterSeconds: 5,
  };
  assert(
    isRefundLifecycleContract(restrictedManagerLifecycle),
    "an exact ordinary-manager receipt projection should parse",
  );
  const restrictedPayload = JSON.stringify(restrictedManagerLifecycle);
  for (const internalValue of [
    "accountingState",
    "accounting_review",
    "Refund Operations",
    "Needs Refund Operations",
    "review_accounting_date",
    "settlement_time_unknown",
  ]) {
    assert(
      !restrictedPayload.includes(internalValue),
      `ordinary-manager lifecycle must exclude ${internalValue}`,
    );
  }
  const sentRestrictedManagerLifecycle = {
    ...restrictedManagerLifecycle,
    stage: "customer_notified",
    reasonCode: "completion_sent",
    messageState: { ...restrictedManagerLifecycle.messageState, state: "sent" },
    managerNextAction: "none",
    managerAction: { ...restrictedManagerLifecycle.managerAction, action: "none" },
    managerQueue: {
      ...restrictedManagerLifecycle.managerQueue,
      bucket: "completed",
      label: "Refund confirmed · customer notified",
      nextAction: "none",
    },
    operations: {
      ...restrictedManagerLifecycle.operations,
      safeStage: "customer_notice_complete",
    },
    terminal: true,
    refreshAfterSeconds: null,
  };
  assert(
    isRefundLifecycleContract(sentRestrictedManagerLifecycle),
    "a sent ordinary-manager receipt projection should be completed and parse",
  );
  assert(
    !isRefundLifecycleContract({
      ...restrictedManagerLifecycle,
      managerQueue: { ...restrictedManagerLifecycle.managerQueue, bucket: "accounting_review" },
    }),
    "a restricted manager projection cannot expose the accounting queue",
  );
  const incoherentReceiptContracts: Array<[string, unknown]> = [
    ["payment work marker", { ...receiptLifecycle, paymentWorkComplete: false }],
    ["reason code", { ...receiptLifecycle, reasonCode: "provider_outcome_unknown" }],
    ["payment state", { ...receiptLifecycle, paymentState: "not_requested" }],
    ["confirmed stage", { ...receiptLifecycle, stage: "needs_refund_operations" }],
    ["top-level retry", { ...receiptLifecycle, safeRetryEligible: true }],
    ["manager next action", { ...receiptLifecycle, managerNextAction: "refund_operations" }],
    ["terminal state", { ...receiptLifecycle, terminal: true }],
    ["refresh interval", { ...receiptLifecycle, refreshAfterSeconds: null }],
    ["manager action", {
      ...receiptLifecycle,
      managerAction: { ...receiptLifecycle.managerAction, action: "refund_operations" },
    }],
    ["manager owner", {
      ...receiptLifecycle,
      managerAction: { ...receiptLifecycle.managerAction, owner: "Machine Manager" },
    }],
    ["manager retry", {
      ...receiptLifecycle,
      managerAction: { ...receiptLifecycle.managerAction, safeRetryEligible: true },
    }],
    ["manager action redaction", {
      ...receiptLifecycle,
      managerAction: { ...receiptLifecycle.managerAction, payloadRedacted: false },
    }],
    ["manager action keys", {
      ...receiptLifecycle,
      managerAction: { ...receiptLifecycle.managerAction, providerReference: "private" },
    }],
    ["manager queue schema", {
      ...receiptLifecycle,
      managerQueue: { ...receiptLifecycle.managerQueue, schemaVersion: "refund_manager_queue_v1" },
    }],
    ["manager queue bucket", {
      ...receiptLifecycle,
      managerQueue: { ...receiptLifecycle.managerQueue, bucket: "provider_hold" },
    }],
    ["manager queue label", {
      ...receiptLifecycle,
      managerQueue: { ...receiptLifecycle.managerQueue, label: "Needs Refund Operations" },
    }],
    ["manager queue next action", {
      ...receiptLifecycle,
      managerQueue: { ...receiptLifecycle.managerQueue, nextAction: "refund_operations" },
    }],
    ["manager queue retry", {
      ...receiptLifecycle,
      managerQueue: { ...receiptLifecycle.managerQueue, safeRetryEligible: true },
    }],
    ["manager queue redaction", {
      ...receiptLifecycle,
      managerQueue: { ...receiptLifecycle.managerQueue, payloadRedacted: false },
    }],
    ["manager queue customer fields", {
      ...receiptLifecycle,
      managerQueue: { ...receiptLifecycle.managerQueue, customerActionFields: ["incident_time"] },
    }],
    ["manager queue keys", {
      ...receiptLifecycle,
      managerQueue: { ...receiptLifecycle.managerQueue, owner: "Refund Operations" },
    }],
    ["lookup retry", {
      ...receiptLifecycle,
      lookup: { ...receiptLifecycle.lookup, safeRetryEligible: true },
    }],
    ["operations required", {
      ...receiptLifecycle,
      operations: { ...receiptLifecycle.operations, required: false },
    }],
    ["operations queue", {
      ...receiptLifecycle,
      operations: { ...receiptLifecycle.operations, queue: "Machine Manager" },
    }],
    ["operations owner", {
      ...receiptLifecycle,
      operations: { ...receiptLifecycle.operations, owner: "Machine Manager" },
    }],
    ["operations safe stage", {
      ...receiptLifecycle,
      operations: { ...receiptLifecycle.operations, safeStage: "confirmation_hold" },
    }],
    ["operations failure class", {
      ...receiptLifecycle,
      operations: { ...receiptLifecycle.operations, failureClass: "provider_outcome_unknown" },
    }],
    ["accounting state", {
      ...receiptLifecycle,
      accountingState: { ...receiptLifecycle.accountingState, state: "completed" },
    }],
    ["accounting owner", {
      ...receiptLifecycle,
      accountingState: { ...receiptLifecycle.accountingState, owner: "Machine Manager" },
    }],
    ["accounting precision", {
      ...receiptLifecycle,
      accountingState: { ...receiptLifecycle.accountingState, settlementTimePrecision: "exact" },
    }],
    ["accounting settlement date", {
      ...receiptLifecycle,
      accountingState: { ...receiptLifecycle.accountingState, settledAt: "2026-09-06T00:00:00Z" },
    }],
    ["accounting payment block", {
      ...receiptLifecycle,
      accountingState: { ...receiptLifecycle.accountingState, blocksPaymentCompletion: true },
    }],
    ["accounting notice block", {
      ...receiptLifecycle,
      accountingState: { ...receiptLifecycle.accountingState, blocksCustomerNotice: true },
    }],
    ["accounting redaction", {
      ...receiptLifecycle,
      accountingState: { ...receiptLifecycle.accountingState, payloadRedacted: false },
    }],
    ["accounting keys", {
      ...receiptLifecycle,
      accountingState: { ...receiptLifecycle.accountingState, providerReference: "private" },
    }],
  ];
  for (const [mismatch, contract] of incoherentReceiptContracts) {
    assert(!isRefundLifecycleContract(contract), `receipt ${mismatch} mismatch must fail closed`);
  }
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
