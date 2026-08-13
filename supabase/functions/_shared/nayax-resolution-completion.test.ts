import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  deliverNayaxCompletionOnce,
  deliverPreparedNayaxCompletionOnce,
} from "./nayax-resolution-completion.ts";

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
