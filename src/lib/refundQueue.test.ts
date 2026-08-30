/// <reference lib="deno.ns" />

import { assertEquals } from "jsr:@std/assert@1";
import type {
  RefundLifecycleContract,
  RefundManagerQueueBucket,
} from "./refundLifecycle.ts";
import { getRefundManagerState } from "./refundManagerState.ts";
import { getRefundManagerQueueBucket } from "./refundQueue.ts";

const lifecycle = (
  stage: RefundLifecycleContract["stage"],
  bucket: RefundManagerQueueBucket,
  nextAction: string,
): RefundLifecycleContract => ({
  schemaVersion: "refund_lifecycle_v1",
  stage,
  stageRank: stage === "waiting_on_customer" ? 15 : 30,
  evidenceState: stage,
  lastUpdatedAt: "2026-08-30T18:00:00.000Z",
  publicCopyKey: `refund_${stage}`,
  managerNextAction: nextAction,
  terminal: bucket === "completed",
  refreshAfterSeconds: bucket === "completed" ? null : 5,
  managerQueue: {
    schemaVersion: "refund_manager_queue_v1",
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
  "ready lifecycle remains ready without selecting or opening the case",
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
    assertEquals(getRefundManagerQueueBucket(refundCase), "ready_to_pay");
    assertEquals(getRefundManagerState(refundCase).id, "ready_to_refund");
  },
);

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

Deno.test("cash and pre-case Gmail fallbacks are deterministic", () => {
  assertEquals(
    getRefundManagerQueueBucket({
      status: "needs_review",
      paymentMethod: "cash",
      paymentAmountCents: 800,
    }),
    "ready_to_pay",
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
