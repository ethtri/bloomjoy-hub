import {
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  parseRefundTransactionalDeliveryRefresh,
  parseRefundTransactionalDeliveryWebhook,
  retrieveRefundTransactionalDelivery,
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

Deno.test("refund transactional delivery refresh maps exact provider state without returning message content", () => {
  assertEquals(parseRefundTransactionalDeliveryRefresh({
    id: "synthetic_delivery_123",
    last_event: "opened",
    to: ["private@example.test"],
    subject: "private subject",
    html: "private body",
  }, "synthetic_delivery_123"), {
    providerMessageId: "synthetic_delivery_123",
    state: "delivered",
    terminal: true,
    payloadRedacted: true,
  });
  assertEquals(parseRefundTransactionalDeliveryRefresh({
    id: "synthetic_delivery_123",
    last_event: "sent",
  }, "synthetic_delivery_123"), {
    providerMessageId: "synthetic_delivery_123",
    state: "accepted",
    terminal: false,
    payloadRedacted: true,
  });
});

Deno.test("refund transactional delivery refresh uses one GET and rejects mismatched evidence", async () => {
  let requestMethod = "";
  let requestUrl = "";
  const result = await retrieveRefundTransactionalDelivery({
    providerMessageId: "synthetic_delivery_123",
    apiKey: "synthetic-resend-key",
    fetchImpl: (input, init) => {
      requestUrl = String(input);
      requestMethod = (init as { method?: string } | undefined)?.method ?? "";
      return Promise.resolve(new Response(JSON.stringify({
        id: "synthetic_delivery_123",
        last_event: "bounced",
        to: ["private@example.test"],
      }), { status: 200, headers: { "content-type": "application/json" } }));
    },
  });
  assertEquals(requestMethod, "GET");
  assertEquals(requestUrl, "https://api.resend.com/emails/synthetic_delivery_123");
  assertEquals(result, {
    providerMessageId: "synthetic_delivery_123",
    state: "bounced",
    terminal: true,
    payloadRedacted: true,
  });

  await assertRejects(
    async () => parseRefundTransactionalDeliveryRefresh({
      id: "different_delivery_456",
      last_event: "delivered",
    }, "synthetic_delivery_123"),
    Error,
    "delivery evidence is invalid",
  );
});
