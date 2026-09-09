import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  deliverNayaxFormReceiptCompletion,
  deliverNayaxCompletionOnce,
  deliverNayaxCompletionWithDefiniteRetry,
  deliverPreparedNayaxCompletionOnce,
  parseNayaxFormReceiptClaim,
} from "./nayax-resolution-completion.ts";
import {
  assertOpenNayaxCompletionMessageLane,
  RefundNayaxCompletionMessageLaneBlockedError,
} from "./nayax-resolution-message-lane.ts";

const runScenario = async ({
  deliveryError,
  deliveryUsedGmail = true,
  failedFinishStatuses = [],
}: {
  deliveryError?: Error & { deliveryUncertain?: boolean };
  deliveryUsedGmail?: boolean;
  failedFinishStatuses?: string[];
}) => {
  let deliveryCalls = 0;
  const finishCalls: string[] = [];
  const result = await deliverNayaxCompletionOnce({
    deliver: async () => {
      deliveryCalls += 1;
      if (deliveryError) throw deliveryError;
      return deliveryUsedGmail;
    },
    finish: async (status) => {
      finishCalls.push(status);
      if (failedFinishStatuses.includes(status)) {
        throw new Error("fixed_finish_failure");
      }
      return {
        status,
        transport: "gmail_thread",
        originalThread: true,
        managerCcCount: status === "sent" ? 1 : 0,
        operationApplied: true,
        managerCompletionNoticeSent: false,
      };
    },
    isDeliveryUncertain: (error) =>
      Boolean(
        error && typeof error === "object" &&
          "deliveryUncertain" in error && error.deliveryUncertain === true,
      ),
  });
  return { deliveryCalls, finishCalls, result };
};

Deno.test("completion sends once and settles sent once", async () => {
  const scenario = await runScenario({});
  assertEquals(scenario.deliveryCalls, 1);
  assertEquals(scenario.finishCalls, ["sent"]);
  assertEquals(scenario.result.status, "sent");
});

Deno.test("form completion drains the exact receipt message through the outbox once", async () => {
  const drained: string[] = [];
  const result = await deliverNayaxFormReceiptCompletion({
    claim: {
      refundCaseMessageId: "ca710000-0000-4000-8000-000000000007",
      status: "queued",
    },
    drain: async (messageId) => {
      drained.push(messageId);
      return [{
        messageId,
        outcome: "sent",
        transport: "transactional_email",
        managerCcCount: 1,
      }];
    },
  });
  assertEquals(drained, ["ca710000-0000-4000-8000-000000000007"]);
  assertEquals(result, {
    status: "sent",
    transport: "transactional_email",
    managerCcCount: 1,
    originalThread: false,
    operationApplied: true,
    managerCompletionNoticeSent: false,
  });
});

Deno.test("form completion claim contention does not start a second transport", async () => {
  let transportCalls = 0;
  const result = await deliverNayaxFormReceiptCompletion({
    claim: {
      refundCaseMessageId: "ca710000-0000-4000-8000-000000000007",
      status: "queued",
    },
    drain: async () => {
      transportCalls += 1;
      return [];
    },
  });
  assertEquals(transportCalls, 1);
  assertEquals(result.status, "delivery_unknown");
  assertEquals(result.operationApplied, false);
});

Deno.test("deferred form completion has no transport call", async () => {
  let transportCalls = 0;
  const result = await deliverNayaxFormReceiptCompletion({
    claim: { refundCaseMessageId: null, status: "notice_deferred" },
    drain: async () => {
      transportCalls += 1;
      return [];
    },
  });
  assertEquals(transportCalls, 0);
  assertEquals(result.status, "deferred");
  assertEquals(result.originalThread, false);
});

Deno.test("form completion claim is bound to the expected case and transport", () => {
  const messageId = "ca710000-0000-4000-8000-000000000007";
  const valid = {
    refundCaseId: "ca500000-0000-4000-8000-000000000007",
    refundCaseMessageId: messageId,
    status: "queued",
    transport: "transactional_email",
    originalThread: false,
    payloadRedacted: true,
  };
  assertEquals(
    parseNayaxFormReceiptClaim(valid, valid.refundCaseId),
    { refundCaseMessageId: messageId, status: "queued" },
  );
  assertEquals(
    parseNayaxFormReceiptClaim(
      { ...valid, refundCaseId: "ca500000-0000-4000-8000-000000000006" },
      valid.refundCaseId,
    ),
    null,
  );
  assertEquals(
    parseNayaxFormReceiptClaim(
      { ...valid, transport: "gmail_thread" },
      valid.refundCaseId,
    ),
    null,
  );
});

Deno.test("safe pre-provider failure records failed without retry", async () => {
  const scenario = await runScenario({
    deliveryError: new Error("fixed_safe_failure"),
  });
  assertEquals(scenario.deliveryCalls, 1);
  assertEquals(scenario.finishCalls, ["failed"]);
  assertEquals(scenario.result.status, "failed");
});

Deno.test("uncertain provider failure records delivery unknown without retry", async () => {
  const deliveryError = new Error("fixed_uncertain_failure") as Error & {
    deliveryUncertain?: boolean;
  };
  deliveryError.deliveryUncertain = true;
  const scenario = await runScenario({ deliveryError });
  assertEquals(scenario.deliveryCalls, 1);
  assertEquals(scenario.finishCalls, ["delivery_unknown"]);
  assertEquals(scenario.result.status, "delivery_unknown");
});

Deno.test("post-send settlement failure cannot be downgraded to safe failure", async () => {
  const scenario = await runScenario({ failedFinishStatuses: ["sent"] });
  assertEquals(scenario.deliveryCalls, 1);
  assertEquals(scenario.finishCalls, ["sent", "delivery_unknown"]);
  assertEquals(scenario.result.status, "delivery_unknown");
});

Deno.test("failed uncertainty settlement returns a fixed aggregate result", async () => {
  const scenario = await runScenario({
    failedFinishStatuses: ["sent", "delivery_unknown"],
  });
  assertEquals(scenario.deliveryCalls, 1);
  assertEquals(scenario.finishCalls, ["sent", "delivery_unknown"]);
  assertEquals(scenario.result, {
    status: "delivery_unknown",
    transport: "gmail_thread",
    managerCcCount: 0,
    originalThread: true,
    operationApplied: false,
    managerCompletionNoticeSent: false,
  });
});

Deno.test("post-commit lookup failure settles failed before any Gmail call", async () => {
  let gmailCalls = 0;
  const finishCalls: string[] = [];
  const result = await deliverPreparedNayaxCompletionOnce({
    load: async () => {
      throw new Error("fixed_lookup_failure");
    },
    deliverLoaded: async () => {
      gmailCalls += 1;
      return true;
    },
    finish: async (status) => {
      finishCalls.push(status);
      return {
        status,
        transport: "gmail_thread",
        originalThread: true,
        managerCcCount: 0,
        operationApplied: true,
        managerCompletionNoticeSent: false,
      };
    },
    isDeliveryUncertain: () => false,
  });
  assertEquals(gmailCalls, 0);
  assertEquals(finishCalls, ["failed"]);
  assertEquals(result.status, "failed");
});

Deno.test("definite pre-send failure retries the same completion once", async () => {
  let deliveryCalls = 0;
  let prepareCalls = 0;
  const finishCalls: string[] = [];
  const result = await deliverNayaxCompletionWithDefiniteRetry({
    deliver: async () => {
      deliveryCalls += 1;
      if (deliveryCalls === 1) throw new Error("fixed_pre_send_failure");
      return true;
    },
    finish: async (status) => {
      finishCalls.push(status);
      return {
        status,
        transport: "gmail_thread",
        originalThread: true,
        managerCcCount: status === "sent" ? 1 : 0,
        operationApplied: true,
        managerCompletionNoticeSent: false,
      };
    },
    isDeliveryUncertain: () => false,
    prepareSameMessageRetry: async () => {
      prepareCalls += 1;
      return true;
    },
  });
  assertEquals(deliveryCalls, 2);
  assertEquals(prepareCalls, 1);
  assertEquals(finishCalls, ["failed", "sent"]);
  assertEquals(result.status, "sent");
});

Deno.test("successful first completion send does not prepare a retry", async () => {
  let deliveryCalls = 0;
  let prepareCalls = 0;
  const finishCalls: string[] = [];
  const result = await deliverNayaxCompletionWithDefiniteRetry({
    deliver: async () => {
      deliveryCalls += 1;
      return true;
    },
    finish: async (status) => {
      finishCalls.push(status);
      return { status };
    },
    isDeliveryUncertain: () => false,
    prepareSameMessageRetry: async () => {
      prepareCalls += 1;
      return true;
    },
  });
  assertEquals(deliveryCalls, 1);
  assertEquals(prepareCalls, 0);
  assertEquals(finishCalls, ["sent"]);
  assertEquals(result.status, "sent");
});

Deno.test("second definite completion failure stops after one retry", async () => {
  let deliveryCalls = 0;
  let prepareCalls = 0;
  const finishCalls: string[] = [];
  const result = await deliverNayaxCompletionWithDefiniteRetry({
    deliver: async () => {
      deliveryCalls += 1;
      throw new Error("fixed_pre_send_failure");
    },
    finish: async (status) => {
      finishCalls.push(status);
      return { status };
    },
    isDeliveryUncertain: () => false,
    prepareSameMessageRetry: async () => {
      prepareCalls += 1;
      return true;
    },
  });
  assertEquals(deliveryCalls, 2);
  assertEquals(prepareCalls, 1);
  assertEquals(finishCalls, ["failed", "failed"]);
  assertEquals(result.status, "failed");
});

Deno.test("uncertain completion is held without an automatic retry", async () => {
  let prepareCalls = 0;
  const uncertain = new Error("fixed_uncertain_failure") as Error & {
    deliveryUncertain?: boolean;
  };
  uncertain.deliveryUncertain = true;
  const result = await deliverNayaxCompletionWithDefiniteRetry({
    deliver: async () => {
      throw uncertain;
    },
    finish: async (status) => ({ status }),
    isDeliveryUncertain: (error) =>
      error === uncertain && uncertain.deliveryUncertain === true,
    prepareSameMessageRetry: async () => {
      prepareCalls += 1;
      return true;
    },
  });
  assertEquals(prepareCalls, 0);
  assertEquals(result.status, "delivery_unknown");
});

Deno.test("failed retry preparation leaves the first failure observable", async () => {
  let deliveryCalls = 0;
  const result = await deliverNayaxCompletionWithDefiniteRetry({
    deliver: async () => {
      deliveryCalls += 1;
      throw new Error("fixed_pre_send_failure");
    },
    finish: async (status) => ({ status }),
    isDeliveryUncertain: () => false,
    prepareSameMessageRetry: async () => {
      throw new Error("fixed_retry_prepare_failure");
    },
  });
  assertEquals(deliveryCalls, 1);
  assertEquals(result.status, "failed");
});

Deno.test("unresolved completion blocks generic message, outbound, and Gmail work", async () => {
  let messageInsertCalls = 0;
  let outboundClaimCalls = 0;
  let gmailCalls = 0;
  let blocked = false;

  try {
    await assertOpenNayaxCompletionMessageLane({
      checkOpen: async () => false,
    });
    messageInsertCalls += 1;
    outboundClaimCalls += 1;
    gmailCalls += 1;
  } catch (error) {
    blocked = error instanceof RefundNayaxCompletionMessageLaneBlockedError;
  }

  assertEquals(blocked, true);
  assertEquals(messageInsertCalls, 0);
  assertEquals(outboundClaimCalls, 0);
  assertEquals(gmailCalls, 0);
});
