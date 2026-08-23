import {
  assertEquals,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  formatRefundCustomerSender,
  REFUND_CUSTOMER_SENDER_NAME,
  REFUND_MONITORED_REPLY_TO_EMAIL,
} from "./refund-customer-transport.ts";

Deno.test("refund customer sender keeps the verified address and standardizes the display name", () => {
  assertEquals(REFUND_CUSTOMER_SENDER_NAME, "Bloomjoy Refunds");
  assertEquals(
    formatRefundCustomerSender("Bloomjoy Info <info@bloomjoyusa.com>"),
    "Bloomjoy Refunds <info@bloomjoyusa.com>",
  );
  assertEquals(
    formatRefundCustomerSender("info@bloomjoysweets.com"),
    "Bloomjoy Refunds <info@bloomjoysweets.com>",
  );
  assertEquals(REFUND_MONITORED_REPLY_TO_EMAIL, "info@bloomjoysweets.com");
});

Deno.test("refund customer sender rejects malformed or injected addresses", () => {
  assertThrows(() => formatRefundCustomerSender("not-an-email"));
  assertThrows(() =>
    formatRefundCustomerSender(
      "Info <info@bloomjoysweets.com>\r\nBcc: outsider@example.test",
    )
  );
});
