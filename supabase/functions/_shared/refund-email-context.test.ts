import {
  assertEquals,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  RefundEmailContextUnavailableError,
  RefundPurchaseTimeAfterRequestError,
  refundEmailCaseCreationError,
  requireLinkedRefundEmailCase,
  requireLinkedRefundEmailThreadId,
} from "./refund-email-context.ts";

Deno.test("only the exact purchase receipt boundary error becomes customer date validation", () => {
  const error = refundEmailCaseCreationError({
    code: "P4625",
    message: "The reported purchase time cannot be after Bloomjoy received the request",
  });
  assertEquals(error instanceof RefundPurchaseTimeAfterRequestError, true);
  assertEquals((error as RefundPurchaseTimeAfterRequestError).code, "refund_purchase_time_after_request");
  assertEquals(error.message.includes("If they are correct"), true);
});

Deno.test("other database failures never masquerade as unavailable private links", () => {
  for (const error of [
    { code: "P4625", message: "The original customer request receipt is immutable" },
    { code: "P4625", message: "Invalid customer request time evidence" },
    { code: "23505", message: "Private constraint detail" },
    { code: "PGRST202", message: "Internal function name" },
    { code: "XX000", message: "The reported purchase time cannot be after Bloomjoy received the request" },
  ]) {
    const mapped = refundEmailCaseCreationError(error);
    assertEquals(mapped instanceof RefundEmailContextUnavailableError, false);
    assertEquals(mapped instanceof RefundPurchaseTimeAfterRequestError, false);
    assertEquals(mapped.message, "Unable to create the email-linked refund request.");
    assertEquals(mapped.message.includes(error.message), false);
  }
});

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
