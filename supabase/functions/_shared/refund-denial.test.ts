import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  isRefundCustomerSafeDenialReason,
  REFUND_CUSTOMER_SAFE_DENIAL_REASONS,
} from "./refund-denial.ts";

Deno.test("refund denial reasons are bounded and customer-safe", () => {
  assertEquals(REFUND_CUSTOMER_SAFE_DENIAL_REASONS.length, 4);
  for (const reason of REFUND_CUSTOMER_SAFE_DENIAL_REASONS) {
    assert(isRefundCustomerSafeDenialReason(reason));
    assert(reason.startsWith("We’re sorry"));
    assert(!/card number|security code|expiration|provider id/i.test(reason));
  }
});

Deno.test("refund denial reason validation rejects manager-authored text", () => {
  assert(!isRefundCustomerSafeDenialReason(null));
  assert(!isRefundCustomerSafeDenialReason(""));
  assert(!isRefundCustomerSafeDenialReason("Internal note"));
  assert(!isRefundCustomerSafeDenialReason("Customer was rude"));
});
