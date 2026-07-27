import { sendTransactionalEmail } from "./internal-email.ts";

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};

Deno.test("transactional email uses a bounded idempotency key and redacts provider failures", async () => {
  const originalFetch = globalThis.fetch;
  const priorApiKey = Deno.env.get("RESEND_API_KEY");
  const priorFromEmail = Deno.env.get("INTERNAL_NOTIFICATION_FROM_EMAIL");
  const requests: Array<{ headers: Headers; body: Record<string, unknown> }> = [];

  Deno.env.set("RESEND_API_KEY", "synthetic-resend-key");
  Deno.env.set("INTERNAL_NOTIFICATION_FROM_EMAIL", "refunds@example.test");

  try {
    globalThis.fetch = ((_input: string | URL | Request, init?: RequestInit) => {
      requests.push({
        headers: new Headers(init?.headers),
        body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
      });
      return Promise.resolve(
        new Response(JSON.stringify({ id: "resend-message-123456" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    }) as typeof fetch;

    const result = await sendTransactionalEmail({
      to: ["customer@example.test"],
      subject: "Refund completed",
      text: "Synthetic completion message.",
      idempotencyKey:
        "refund-completed/customer/78500000-0000-4000-8000-000000000001",
    });

    assert(requests.length === 1, "Expected one provider request.");
    assert(
      requests[0].headers.get("Idempotency-Key") ===
        "refund-completed/customer/78500000-0000-4000-8000-000000000001",
      "Expected the deterministic Resend idempotency header.",
    );
    assert(
      result.providerMessageId === "resend-message-123456",
      "Expected a sanitized provider message ID.",
    );

    let invalidKeyRejected = false;
    try {
      await sendTransactionalEmail({
        to: ["customer@example.test"],
        subject: "Refund completed",
        text: "Synthetic completion message.",
        idempotencyKey: "invalid key with spaces",
      });
    } catch (error) {
      invalidKeyRejected =
        error instanceof Error &&
        error.message === "Invalid email idempotency key.";
    }
    assert(invalidKeyRejected, "Expected an unsafe idempotency key to fail closed.");
    assert(requests.length === 1, "An unsafe key must not reach the provider.");

    globalThis.fetch = (() =>
      Promise.resolve(
        new Response("private provider response body", { status: 422 }),
      )) as typeof fetch;

    let providerFailureWasRedacted = false;
    try {
      await sendTransactionalEmail({
        to: ["manager@example.test"],
        subject: "Refund completed",
        text: "Synthetic manager completion message.",
        idempotencyKey:
          "refund-completed/manager/78500000-0000-4000-8000-000000000001",
      });
    } catch (error) {
      providerFailureWasRedacted =
        error instanceof Error &&
        error.message === "Resend request failed (422)." &&
        !error.message.includes("private provider response body");
    }
    assert(providerFailureWasRedacted, "Provider failure details must stay redacted.");
  } finally {
    globalThis.fetch = originalFetch;
    if (priorApiKey === undefined) {
      Deno.env.delete("RESEND_API_KEY");
    } else {
      Deno.env.set("RESEND_API_KEY", priorApiKey);
    }
    if (priorFromEmail === undefined) {
      Deno.env.delete("INTERNAL_NOTIFICATION_FROM_EMAIL");
    } else {
      Deno.env.set("INTERNAL_NOTIFICATION_FROM_EMAIL", priorFromEmail);
    }
  }
});
