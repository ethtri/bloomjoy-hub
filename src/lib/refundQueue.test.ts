/// <reference lib="deno.ns" />

import { assertEquals } from "jsr:@std/assert@1";
import type {
  RefundLifecycleContract,
  RefundManagerQueueBucket,
} from "./refundLifecycle.ts";
import { getRefundManagerState } from "./refundManagerState.ts";
import { findRefundDeepLinkedCase, getRefundManagerQueueBucket, getRefundQueueFilterForCase } from "./refundQueue.ts";

const lifecycle = (
  stage: RefundLifecycleContract["stage"],
  bucket: RefundManagerQueueBucket,
  nextAction: string,
): RefundLifecycleContract => ({
  schemaVersion: "refund_lifecycle_v2",
  version: 1,
  stage,
  stageRank: stage === "waiting_on_customer" ? 15 : 30,
  reasonCode: `test_${stage}`,
  actor: "system",
  customerAction: {
    action: stage === "waiting_on_customer" ? "reply_in_existing_thread" : "none",
    required: stage === "waiting_on_customer",
    requestedFields: stage === "waiting_on_customer" ? ["incident_time"] : [],
    payloadRedacted: true,
  },
  managerAction: {
    action: nextAction,
    owner: bucket === "provider_hold" ? "Refund Operations" : "Machine Manager",
    safeRetryEligible: false,
    payloadRedacted: true,
  },
  paymentState: bucket === "provider_hold" ? "outcome_unknown" : "not_requested",
  messageState: {
    state: "none",
    messageType: null,
    lastUpdatedAt: null,
    payloadRedacted: true,
  },
  classification: "customer",
  evidenceState: stage,
  locationEvidence: {
    customerReported: {
      selectionKey: "test-selection", selectionKind: "exact_machine",
      machineIds: ["d3000000-0000-4000-8000-000000000001"], preserved: true,
      payloadRedacted: true,
    },
    normalized: {
      locationId: "d2000000-0000-4000-8000-000000000001",
      machineId: "d3000000-0000-4000-8000-000000000001",
      timezone: "America/Los_Angeles", providerAccountKey: "TEST",
      mappingSource: "nayax", mappingVersion: 1, confidence: 1,
      authoritative: true, payloadRedacted: true,
    },
    payloadRedacted: true,
  },
  lastUpdatedAt: "2026-08-30T18:00:00.000Z",
  publicCopyKey: `refund_${stage}`,
  managerNextAction: nextAction,
  terminal: bucket === "completed",
  refreshAfterSeconds: bucket === "completed" ? null : 5,
  managerQueue: {
    schemaVersion: "refund_manager_queue_v2",
    bucket,
    label: bucket,
    nextAction,
    safeRetryEligible: false,
    payloadRedacted: true,
  },
  lookup: {
    status: stage === "matching" ? "checking" : "match_found",
    safeRetryEligible: false,
    failureClass: null,
    lastUpdatedAt: "2026-08-30T18:00:00.000Z",
  },
  operations: {
    required: bucket === "provider_hold",
    queue: "Refund Operations",
    owner: "Refund Operations",
    slaMinutes: 60,
    ageMinutes: null,
    dueAt: null,
    slaBreached: false,
    safeStage: "synthetic",
    failureClass: null,
    nextStep: null,
  },
  payloadRedacted: true,
});

const cardCase = (contract: RefundLifecycleContract) => ({
  status:
    contract.stage === "waiting_on_customer"
      ? ("waiting_on_customer" as const)
      : ("needs_review" as const),
  paymentMethod: "card" as const,
  correlationStatus: "needs_nayax" as const,
  lifecycle: contract,
});

Deno.test('manager review buckets stay visible while archive deep links remain restricted', () => {
  const integrity = { id: 'integrity-case', ...cardCase(lifecycle('integrity_hold', 'integrity_hold', 'refund_operations')) };
  const accounting = { id: 'accounting-case', ...cardCase(lifecycle('refund_confirmed', 'accounting_review', 'review_accounting_date')) };
  const archived = { id: 'archived-case', ...cardCase(lifecycle('internal_test_archived', 'internal_archive', 'none')) };
  assertEquals(getRefundQueueFilterForCase(integrity, true), 'provider_hold');
  assertEquals(getRefundQueueFilterForCase(integrity, false), 'provider_hold');
  assertEquals(getRefundManagerQueueBucket(accounting), 'accounting_review');
  assertEquals(getRefundQueueFilterForCase(accounting, true), 'provider_hold');
  assertEquals(getRefundQueueFilterForCase(accounting, false), 'provider_hold');
  assertEquals(getRefundQueueFilterForCase(archived, true), 'internal_test');
  assertEquals(findRefundDeepLinkedCase('integrity-case', [integrity], []), integrity);
  assertEquals(findRefundDeepLinkedCase('archived-case', [integrity], [archived]), archived);
  assertEquals(findRefundDeepLinkedCase('archived-case', [integrity], []), undefined);
  assertEquals(findRefundDeepLinkedCase('missing-case', [integrity], [archived]), undefined);
});

Deno.test(
  "queue, detail badge, counter source, and next action agree on waiting",
  () => {
    const refundCase = cardCase(
      lifecycle(
        "waiting_on_customer",
        "waiting_on_customer",
        "wait_for_customer_reply",
      ),
    );
    const managerState = getRefundManagerState(refundCase);
    assertEquals(
      getRefundManagerQueueBucket(refundCase),
      "waiting_on_customer",
    );
    assertEquals(managerState.id, "waiting_on_customer");
    assertEquals(managerState.label, "Waiting on customer");
  },
);

Deno.test(
  "old v2 ready lifecycle cannot assert an undecided final money action",
  () => {
    const contract = lifecycle(
      "transaction_confirmed",
      "ready_to_pay",
      "refund",
    );
    const refundCase = {
      ...cardCase(contract),
      hasMatchedNayaxTransaction: true,
      refundReadiness: {
        transactionConfirmed: true,
        canIssueCardRefund: true,
        blockReason: null,
      },
    };
    assertEquals(getRefundManagerQueueBucket(refundCase), "provider_hold");
  assertEquals(getRefundManagerState(refundCase).label, "Refund action temporarily unavailable");
  contract.paymentState = "outcome_unknown";
  assertEquals(getRefundManagerQueueBucket(refundCase), "provider_hold");
  assertEquals(getRefundManagerState(refundCase).label, "Payment result needs review");
  },
);

Deno.test("old v2 approved actions preserve payment continuity without reapproval", () => {
  const approvedCash = {
    status: "cash_zelle_pending" as const,
    paymentMethod: "cash" as const,
    zellePaymentContact: "customer@example.test",
    paymentAmountCents: 800,
    decision: "approved" as const,
    lifecycle: lifecycle("transaction_confirmed", "ready_to_pay", "mark_external_refund"),
  };
  const approvedCard = {
    ...cardCase(lifecycle("transaction_confirmed", "ready_to_pay", "refund")),
    decision: "approved" as const,
  };
  assertEquals(getRefundManagerQueueBucket(approvedCash), "ready_to_pay");
  assertEquals(getRefundManagerQueueBucket(approvedCard), "provider_hold");
  assertEquals(getRefundManagerState({ ...approvedCard, status: "card_refund_pending" }).label,
    "Refund follow-up pending");
  const heldDuringFailedRead = {
    ...approvedCard,
    status: "card_refund_pending" as const,
    lifecycle: null,
    workflowProjectionUnavailable: true,
  };
  assertEquals(getRefundManagerQueueBucket(heldDuringFailedRead), "provider_hold");
  assertEquals(getRefundManagerState(heldDuringFailedRead).label, "Refund follow-up pending");
  approvedCard.lifecycle.paymentState = "submitted_pending";
  assertEquals(getRefundManagerQueueBucket(approvedCard), "in_progress");

  const settledCard = {
    ...approvedCard,
    status: "completed",
    lifecycle: lifecycle("customer_notified", "completed", "none"),
  };
  assertEquals(getRefundManagerQueueBucket(settledCard), "completed");
  const unsettledNotice = {
    ...settledCard,
    lifecycle: lifecycle("customer_notified", "needs_action", "review_customer_delivery"),
  };
  assertEquals(getRefundManagerQueueBucket(unsettledNotice), "provider_hold");
});

Deno.test("a prepared Manager action counts only for a current authorized viewer and version", () => {
  const contract = lifecycle("transaction_confirmed", "ready_to_pay", "refund");
  contract.nextWork = {
    schemaVersion: "refund_next_work_v1", isOpen: true, actor: "manager",
    actionCode: "approve_or_deny_request", actionLabel: "Review the prepared request",
    lastProgressAt: null, dueAt: null, blocker: null, payloadRedacted: true,
  };
  const preparedCase = {
    ...cardCase(contract), canPerformOfficialAction: true, officialActionVersion: 7,
  };
  assertEquals(getRefundManagerQueueBucket(preparedCase), "ready_to_pay");
  assertEquals(getRefundQueueFilterForCase(preparedCase), "ready_to_pay");
  assertEquals(getRefundManagerQueueBucket({ ...preparedCase, officialActionVersion: 0 }), "provider_hold");
  assertEquals(getRefundManagerQueueBucket({ ...preparedCase, canPerformOfficialAction: false }), "provider_hold");
  assertEquals(getRefundQueueFilterForCase({ ...preparedCase, canPerformOfficialAction: false }), "provider_hold");
});

Deno.test(
  "server queue projection wins over contradictory legacy case fields",
  () => {
    const refundCase = {
      ...cardCase(
        lifecycle(
          "waiting_on_customer",
          "waiting_on_customer",
          "wait_for_customer_reply",
        ),
      ),
      status: "needs_review" as const,
      paymentAmountCents: 1000,
    };
    assertEquals(
      getRefundManagerQueueBucket(refundCase),
      "waiting_on_customer",
    );
  },
);

Deno.test(
  "blocked authority and missing-version projections keep queue and detail out of ready",
  () => {
    const fixtures = [
      {
        reason: "manager authority",
        canPerformOfficialAction: false,
        officialActionVersion: 1,
        officialActionBlockReason: "manager_mapping_required",
        nextAction: "resolve_manager_access",
      },
      {
        reason: "missing official-action version",
        canPerformOfficialAction: true,
        officialActionVersion: 0,
        officialActionBlockReason: null,
        nextAction: "refresh_case",
      },
    ] as const;

    for (const fixture of fixtures) {
      const contract = lifecycle(
        "transaction_confirmed",
        "needs_action",
        fixture.nextAction,
      );
      const refundCase = {
        ...cardCase(contract),
        hasMatchedNayaxTransaction: true,
        canPerformOfficialAction: fixture.canPerformOfficialAction,
        officialActionVersion: fixture.officialActionVersion,
        officialActionBlockReason: fixture.officialActionBlockReason,
        refundReadiness: {
          transactionConfirmed: true,
          canIssueCardRefund: true,
          blockReason: null,
        },
      };

      assertEquals(
        getRefundManagerQueueBucket(refundCase),
        "needs_action",
        `${fixture.reason} queue`,
      );
      assertEquals(
        contract.managerQueue.label,
        "needs_action",
        `${fixture.reason} badge source`,
      );
      assertEquals(
        contract.managerQueue.nextAction,
        fixture.nextAction,
        `${fixture.reason} action`,
      );
      assertEquals(
        getRefundManagerState(refundCase).id,
        "transaction_confirmed",
        `${fixture.reason} detail`,
      );
    }
  },
);

Deno.test("cash and pre-case Gmail fallbacks are deterministic", () => {
  assertEquals(
    getRefundManagerQueueBucket({
      status: "needs_review",
      paymentMethod: "cash",
      paymentAmountCents: 800,
      zellePaymentContact: "cash-customer@example.test",
    }),
    "ready_to_pay",
  );
  assertEquals(
    getRefundManagerQueueBucket({
      status: "needs_review",
      paymentMethod: "cash",
      paymentAmountCents: 800,
      zellePaymentContact: null,
    }),
    "needs_action",
  );
  assertEquals(
    getRefundManagerQueueBucket({
      status: "draft",
      paymentMethod: "unknown",
    }),
    "needs_action",
  );
});

Deno.test(
  "wallet, internal, provider-hold, and terminal fixtures stay server-owned",
  () => {
    const fixtures: Array<{
      name: string;
      refundCase: ReturnType<typeof cardCase>;
      expected: RefundManagerQueueBucket;
    }> = [
      {
        name: "mobile wallet card transaction",
        refundCase: cardCase(
          lifecycle("needs_transaction_selection", "needs_action", "select_transaction"),
        ),
        expected: "needs_action",
      },
      {
        name: "internal synthetic case",
        refundCase: cardCase(lifecycle("matching", "needs_action", "wait")),
        expected: "needs_action",
      },
      {
        name: "provider hold",
        refundCase: cardCase(
          lifecycle("needs_refund_operations", "provider_hold", "refund_operations"),
        ),
        expected: "provider_hold",
      },
      {
        name: "terminal case",
        refundCase: cardCase(lifecycle("customer_notified", "completed", "none")),
        expected: "completed",
      },
    ];

    for (const fixture of fixtures) {
      assertEquals(
        getRefundManagerQueueBucket(fixture.refundCase),
        fixture.expected,
        fixture.name,
      );
    }
  },
);


// Search uses the same authorized population, independently of the selected queue.
import { searchRefundCases } from "./refundCaseSearch.ts";
const searchCase = (id: string, bucket: string) => ({
  id, bucket, publicReference: `RF-${id}`, customerEmail: `${id}@example.test`,
  customerName: `Customer ${id}`, machineLabel: 'Synthetic machine',
  locationName: 'Test location', issueSummary: 'Synthetic purchase',
});
const searchCases = [searchCase('ACTION', 'needs_action'), searchCase('WAIT', 'waiting'), searchCase('DONE', 'completed')];
const searchOptions = {
  customerCases: searchCases, internalCases: [searchCase('INTERNAL', 'internal_archive')],
  canViewInternal: false, internalView: false,
  matchesCurrentView: (item: typeof searchCases[number]) => item.bucket === 'needs_action',
};
Deno.test('cross-view search finds exact Waiting/Done references without changing cases or queue', () => {
  const before = JSON.stringify(searchCases);
  for (const id of ['WAIT', 'DONE']) assertEquals(searchRefundCases({ ...searchOptions, query: `  rf-${id.toLowerCase()}  ` }).map(c => c.id), [id]);
  assertEquals(searchRefundCases({ ...searchOptions, query: '' }).map(c => c.id), ['ACTION']);
  assertEquals(searchRefundCases({ ...searchOptions, query: '   ' }).map(c => c.id), ['ACTION']);
  assertEquals(JSON.stringify(searchCases), before);
});
Deno.test('customer, machine, location and no-result searches use the authorized population', () => {
  assertEquals(searchRefundCases({ ...searchOptions, query: 'wait@example.test' }).map(c => c.id), ['WAIT']);
  assertEquals(searchRefundCases({ ...searchOptions, query: 'Customer Done' }).map(c => c.id), ['DONE']);
  for (const query of ['Synthetic machine', 'TEST LOCATION']) assertEquals(searchRefundCases({ ...searchOptions, query }).length, 3);
  assertEquals(searchRefundCases({ ...searchOptions, query: 'unknown' }), []);
});
Deno.test('archive requires both explicit scope and current operations access; ordinary results never include it', () => {
  assertEquals(searchRefundCases({ ...searchOptions, query: 'INTERNAL' }), []);
  assertEquals(searchRefundCases({ ...searchOptions, canViewInternal: true, query: 'INTERNAL' }), []);
  assertEquals(searchRefundCases({ ...searchOptions, internalView: true, query: 'INTERNAL' }), []);
  assertEquals(searchRefundCases({ ...searchOptions, canViewInternal: true, internalView: true, query: 'INTERNAL' }).map(c => c.id), ['INTERNAL']);
});
Deno.test('access removal immediately removes prior matches; search has no cached population', () => {
  assertEquals(searchRefundCases({ ...searchOptions, customerCases: [], query: 'RF-WAIT' }), []);
  assertEquals(searchRefundCases({ ...searchOptions, canViewInternal: false, internalView: true, query: '' }), []);
});
