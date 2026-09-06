import {
  assertEquals,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  RefundEmailContextUnavailableError,
  requireLinkedRefundEmailCase,
  requireLinkedRefundEmailThreadId,
} from "./refund-email-context.ts";

Deno.test("email-linked intake returns the original case", () => {
  const refundCase = { id: "synthetic-original-case" };
  assertEquals(
    requireLinkedRefundEmailCase("synthetic-private-token", refundCase),
    refundCase,
  );
});

Deno.test("expired, replayed, or mismatched email context fails closed", () => {
  const error = assertThrows(
    () => requireLinkedRefundEmailCase("synthetic-private-token", null),
    RefundEmailContextUnavailableError,
  );
  assertEquals(error.code, "refund_email_context_unavailable");
});

Deno.test("ordinary website intake may continue without an email context", () => {
  assertEquals(requireLinkedRefundEmailCase("", null), null);
  assertEquals(requireLinkedRefundEmailThreadId("", null), null);
});

Deno.test("email-linked intake keeps the exact returned Gmail thread binding", () => {
  const gmailThreadId = "79890000-0000-4000-8000-000000000001";
  assertEquals(
    requireLinkedRefundEmailThreadId("synthetic-private-token", {
      gmail_thread_id: gmailThreadId,
    }),
    gmailThreadId,
  );
});

Deno.test("email-linked intake fails closed without a valid returned Gmail thread", () => {
  for (
    const linkedRefundCase of [null, {}, { gmail_thread_id: "not-a-uuid" }]
  ) {
    assertThrows(
      () =>
        requireLinkedRefundEmailThreadId(
          "synthetic-private-token",
          linkedRefundCase,
        ),
      RefundEmailContextUnavailableError,
    );
  }
});
