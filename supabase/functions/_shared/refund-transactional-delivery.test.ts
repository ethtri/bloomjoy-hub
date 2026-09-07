import {
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  parseRefundTransactionalDeliveryWebhook,
  sha256Hex,
} from "./refund-transactional-delivery.ts";

Deno.test("refund transactional delivery parser normalizes supported provider events", () => {
  assertEquals(parseRefundTransactionalDeliveryWebhook({
    type: "email.delivered",
    created_at: "2026-08-31T12:00:00Z",
    data: { email_id: "synthetic_delivery_123" },
  }), {
    providerMessageId: "synthetic_delivery_123",
    state: "delivered",
    eventAt: "2026-08-31T12:00:00.000Z",
  });
  assertEquals(parseRefundTransactionalDeliveryWebhook({
    type: "email.clicked",
    created_at: "2026-08-31T12:00:00Z",
    data: { email_id: "synthetic_delivery_123" },
  }), null);
});

Deno.test("refund transactional delivery parser rejects incomplete tracked evidence", async () => {
  await assertRejects(
    async () => parseRefundTransactionalDeliveryWebhook({
      type: "email.bounced",
      created_at: "not-a-time",
      data: {},
    }),
    Error,
    "webhook evidence is invalid",
  );
});

Deno.test("refund transactional delivery event keys are hashed before persistence", async () => {
  const digest = await sha256Hex("evt_synthetic_123");
  assertEquals(digest.length, 64);
  assertEquals(digest, await sha256Hex("evt_synthetic_123"));
  assertEquals(digest.includes("evt_synthetic_123"), false);
});
