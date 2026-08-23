import {
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { sendRefundTransactionalEmail } from "./refund-email.ts";

const restoreEnv = (name: string, value: string | undefined) => {
  if (value === undefined) Deno.env.delete(name);
  else Deno.env.set(name, value);
};

Deno.test("transactional refund mail uses the verified sender with the monitored Reply-To", async () => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = Deno.env.get("RESEND_API_KEY");
  const originalFrom = Deno.env.get("INTERNAL_NOTIFICATION_FROM_EMAIL");
  const originalReplyTo = Deno.env.get("REFUND_REPLY_TO_EMAIL");
  let payload: Record<string, unknown> = {};
  let fetchCount = 0;

  Deno.env.set("RESEND_API_KEY", "synthetic-resend-key");
  Deno.env.set(
    "INTERNAL_NOTIFICATION_FROM_EMAIL",
    "Bloomjoy Info <info@bloomjoyusa.com>",
  );
  Deno.env.set("REFUND_REPLY_TO_EMAIL", "info@bloomjoysweets.com");
  globalThis.fetch = async (_input, init) => {
    fetchCount += 1;
    const requestBody = (init as { body?: unknown } | undefined)?.body;
    payload = JSON.parse(String(requestBody ?? "{}"));
    return new Response(JSON.stringify({ id: "synthetic-message" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    await sendRefundTransactionalEmail({
      to: ["customer@example.test"],
      cc: ["manager@example.test"],
      subject: "A Bloomjoy refund update",
      text: "Thank you for your patience.",
    });
    assertEquals(fetchCount, 1);
    assertEquals(
      payload.from,
      "Bloomjoy Refunds <info@bloomjoyusa.com>",
    );
    assertEquals(payload.reply_to, "info@bloomjoysweets.com");
    assertEquals(payload.to, ["customer@example.test"]);
    assertEquals(payload.cc, ["manager@example.test"]);

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
