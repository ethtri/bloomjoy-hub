import {
  assertEquals,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  RefundEmailContextUnavailableError,
  requireLinkedRefundEmailCase,
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
});
