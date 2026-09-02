import {
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  claimRefundManualMessageDeliveries,
  drainRefundManualMessageOutbox,
} from "./refund-manual-message-outbox.ts";

const messageId = "b2000000-0000-4000-8000-000000000001";
const claimToken = "b2100000-0000-4000-8000-000000000001";

Deno.test("manual-message outbox claims a bounded exact message contract", async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const supabase = {
    rpc: (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      return Promise.resolve({
        data: [{
          refund_case_message_id: messageId,
          claim_token: claimToken,
        }],
        error: null,
      });
    },
  };

  const claims = await claimRefundManualMessageDeliveries({
    supabase: supabase as never,
    messageId,
    limit: 100,
  });

  assertEquals(claims, [{ messageId, claimToken }]);
  assertEquals(calls, [{
    name: "service_claim_refund_manual_message_deliveries",
    args: {
      p_refund_case_message_id: messageId,
      p_limit: 25,
    },
  }]);
});

Deno.test("manual-message outbox rejects an invalid message identity before database access", async () => {
  let called = false;
  await assertRejects(
    () =>
      claimRefundManualMessageDeliveries({
        supabase: {
          rpc: () => {
            called = true;
            return Promise.resolve({ data: [], error: null });
          },
        } as never,
        messageId: "not-a-message-id",
      }),
    Error,
    "requires a valid message id",
  );
  assertEquals(called, false);
});

Deno.test("manual-message outbox fails closed on malformed claim evidence", async () => {
  await assertRejects(
    () =>
      claimRefundManualMessageDeliveries({
        supabase: {
          rpc: () =>
            Promise.resolve({
              data: [{
                refund_case_message_id: messageId,
                claim_token: "not-a-claim-token",
              }],
              error: null,
            }),
        } as never,
      }),
    Error,
    "claim contract is invalid",
  );
});

Deno.test("manual-message incident stop leaves queued work unclaimed", async () => {
  const original = Deno.env.get("REFUND_MANUAL_MESSAGE_OUTBOX_ENABLED");
  Deno.env.set("REFUND_MANUAL_MESSAGE_OUTBOX_ENABLED", "false");
  let called = false;
  try {
    const results = await drainRefundManualMessageOutbox({
      supabase: {
        rpc: () => {
          called = true;
          return Promise.resolve({ data: [], error: null });
        },
      } as never,
    });
    assertEquals(results, []);
    assertEquals(called, false);
  } finally {
    if (original === undefined) {
      Deno.env.delete("REFUND_MANUAL_MESSAGE_OUTBOX_ENABLED");
    } else {
      Deno.env.set("REFUND_MANUAL_MESSAGE_OUTBOX_ENABLED", original);
    }
  }
});
