import {
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { sendRefundTransactionalEmail } from "./refund-email.ts";
import { markRefundTransactionalDeliveryAttempt } from "./refund-transactional-delivery.ts";
import {
  TransactionalEmailDeliveryUnknownError,
} from "./internal-email.ts";

const restoreEnv = (name: string, value: string | undefined) => {
  if (value === undefined) Deno.env.delete(name);
  else Deno.env.set(name, value);
};

Deno.test("bounced original request mark rejection stops actual Resend transport before provider access", async () => {
  const originalFetch = globalThis.fetch;
  let markCalls = 0;
  let providerCalls = 0;
  globalThis.fetch = async () => {
    providerCalls += 1;
    throw new Error("Bounced original must never reach Resend");
  };
  try {
    await assertRejects(async () => {
      await markRefundTransactionalDeliveryAttempt({
        refundCaseMessageId: "79860000-0000-4000-8000-000000000042",
        supabase: { rpc: async (name) => {
          assertEquals(name, "service_mark_refund_transactional_delivery_attempt");
          markCalls += 1;
          return { data: null, error: { name: "23514" } };
        } },
      });
      await sendRefundTransactionalEmail({
        to: ["customer@example.test"], cc: ["manager@example.test"],
        subject: "Synthetic reminder", text: "Synthetic reminder only",
        idempotencyKey: "synthetic-reminder-bounced-request",
      });
    }, Error, "Transactional delivery attempt could not be recorded");
    assertEquals(markCalls, 1);
    assertEquals(providerCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("transactional refund mail uses the verified sender with the monitored Reply-To", async () => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = Deno.env.get("RESEND_API_KEY");
  const originalFrom = Deno.env.get("INTERNAL_NOTIFICATION_FROM_EMAIL");
  const originalReplyTo = Deno.env.get("REFUND_REPLY_TO_EMAIL");
  let payload: Record<string, unknown> = {};
  let fetchCount = 0;
  let requestHeaders = new Headers();

  Deno.env.set("RESEND_API_KEY", "synthetic-resend-key");
  Deno.env.set(
    "INTERNAL_NOTIFICATION_FROM_EMAIL",
    "Bloomjoy Info <info@bloomjoyusa.com>",
  );
  Deno.env.set("REFUND_REPLY_TO_EMAIL", "info@bloomjoysweets.com");
  globalThis.fetch = async (_input, init) => {
    fetchCount += 1;
    const requestInit = init as {
      body?: unknown;
      headers?: HeadersInit;
    } | undefined;
    const requestBody = requestInit?.body;
    payload = JSON.parse(String(requestBody ?? "{}"));
    requestHeaders = new Headers(requestInit?.headers);
    return new Response(JSON.stringify({ id: "synthetic-message" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    const receipt = await sendRefundTransactionalEmail({
      to: ["customer@example.test"],
      cc: ["manager@example.test"],
      subject: "A Bloomjoy refund update",
      text: "Thank you for your patience.",
      idempotencyKey: "refund-message-transport-test",
    });
    assertEquals(fetchCount, 1);
    assertEquals(
      payload.from,
      "Bloomjoy Refunds <info@bloomjoyusa.com>",
    );
    assertEquals(payload.reply_to, "info@bloomjoysweets.com");
    assertEquals(payload.to, ["customer@example.test"]);
    assertEquals(payload.cc, ["manager@example.test"]);
    assertEquals(requestHeaders.get("idempotency-key"), "refund-message-transport-test");
    assertEquals(receipt, {
      provider: "resend",
      providerMessageId: "synthetic-message",
      acceptedAt: receipt.acceptedAt,
    });

    Deno.env.set("REFUND_REPLY_TO_EMAIL", "info@bloomjoyusa.com");
    await assertRejects(
      () =>
        sendRefundTransactionalEmail({
          to: ["customer@example.test"],
          subject: "Blocked route",
          text: "This must not send.",
        }),
      Error,
      "monitored support mailbox",
    );
    assertEquals(
      fetchCount,
      1,
      "invalid Reply-To must fail before provider access",
    );
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv("RESEND_API_KEY", originalApiKey);
    restoreEnv("INTERNAL_NOTIFICATION_FROM_EMAIL", originalFrom);
    restoreEnv("REFUND_REPLY_TO_EMAIL", originalReplyTo);
  }
});

Deno.test("transactional refund mail treats a successful response without a provider id as delivery unknown", async () => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = Deno.env.get("RESEND_API_KEY");
  const originalFrom = Deno.env.get("INTERNAL_NOTIFICATION_FROM_EMAIL");
  const originalReplyTo = Deno.env.get("REFUND_REPLY_TO_EMAIL");
  Deno.env.set("RESEND_API_KEY", "synthetic-resend-key");
  Deno.env.set("INTERNAL_NOTIFICATION_FROM_EMAIL", "info@bloomjoyusa.com");
  Deno.env.set("REFUND_REPLY_TO_EMAIL", "info@bloomjoysweets.com");
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ accepted: true }), { status: 200 });

  try {
    await assertRejects(
      () => sendRefundTransactionalEmail({
        to: ["customer@example.test"],
        subject: "Synthetic refund status",
        text: "Synthetic body.",
      }),
      TransactionalEmailDeliveryUnknownError,
      "acceptance could not be confirmed",
    );
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv("RESEND_API_KEY", originalApiKey);
    restoreEnv("INTERNAL_NOTIFICATION_FROM_EMAIL", originalFrom);
    restoreEnv("REFUND_REPLY_TO_EMAIL", originalReplyTo);
  }
});

Deno.test("transactional refund mail rejects an unsafe idempotency key before provider access", async () => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = Deno.env.get("RESEND_API_KEY");
  const originalFrom = Deno.env.get("INTERNAL_NOTIFICATION_FROM_EMAIL");
  const originalReplyTo = Deno.env.get("REFUND_REPLY_TO_EMAIL");
  let fetchCount = 0;
  Deno.env.set("RESEND_API_KEY", "synthetic-resend-key");
  Deno.env.set("INTERNAL_NOTIFICATION_FROM_EMAIL", "info@bloomjoyusa.com");
  Deno.env.set("REFUND_REPLY_TO_EMAIL", "info@bloomjoysweets.com");
  globalThis.fetch = async () => {
    fetchCount += 1;
    return new Response(JSON.stringify({ id: "synthetic-message" }), {
      status: 200,
    });
  };

  try {
    await assertRejects(
      () => sendRefundTransactionalEmail({
        to: ["customer@example.test"],
        subject: "Synthetic refund status",
        text: "Synthetic body.",
        idempotencyKey: "unsafe key with spaces",
      }),
      Error,
      "idempotency key is invalid",
    );
    assertEquals(fetchCount, 0);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv("RESEND_API_KEY", originalApiKey);
    restoreEnv("INTERNAL_NOTIFICATION_FROM_EMAIL", originalFrom);
    restoreEnv("REFUND_REPLY_TO_EMAIL", originalReplyTo);
  }
});
