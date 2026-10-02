import { assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { refundExceptionReviewReasons, refundGiftCardFaceValue, parseApprovedRefundAmount } from "./refund-exception-policy.ts";

Deno.test("gift face value rounds before the Manager threshold", () => {
  assertEquals(refundGiftCardFaceValue(2500), 2500);
  assertEquals(refundExceptionReviewReasons("other", refundGiftCardFaceValue(2500), false), []);
  assertEquals(refundExceptionReviewReasons("other", refundGiftCardFaceValue(2501), false), ["gift_value_over_25"]);
  assertEquals(refundGiftCardFaceValue(1000), 1000);
});
Deno.test("repeat and exception reasons share one decision", () => {
  assertEquals(refundExceptionReviewReasons("partial_items", 3000, true), ["partial_items", "gift_value_over_25", "repeat_within_12_months"]);
  assertEquals(refundExceptionReviewReasons("expected_cash_change", 9000, false), ["expected_cash_change", "gift_value_over_25"]);
});
Deno.test("edited currency never accepts fractional cents or a missing positive amount", () => {
  assertEquals(parseApprovedRefundAmount(null), null);
  assertEquals(parseApprovedRefundAmount(1000), 1000);
  for (const amount of [0, -1, 10.1, "1000", NaN]) assertThrows(() => parseApprovedRefundAmount(amount));
});
