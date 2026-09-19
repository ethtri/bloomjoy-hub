import {
  assertEquals,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  formatRefundCustomerSender,
  REFUND_CUSTOMER_FROM_EMAIL,
  REFUND_CUSTOMER_SENDER_NAME,
  REFUND_MONITORED_REPLY_TO_EMAIL,
} from "./refund-customer-transport.ts";

Deno.test("refund customer sender keeps the verified address and standardizes the display name", () => {
  assertEquals(REFUND_CUSTOMER_SENDER_NAME, "Bloomjoy Refunds");
  assertEquals(REFUND_CUSTOMER_FROM_EMAIL, "refunds@bloomjoysweets.com");
  assertEquals(
    formatRefundCustomerSender("refunds@bloomjoysweets.com"),
    "Bloomjoy Refunds <refunds@bloomjoysweets.com>",
  );
  assertEquals(REFUND_MONITORED_REPLY_TO_EMAIL, "refunds@bloomjoysweets.com");
});

Deno.test("refund customer sender rejects malformed or injected addresses", () => {
  assertThrows(() =>
    formatRefundCustomerSender("Bloomjoy Info <info@bloomjoyusa.com>")
  );
  assertThrows(() => formatRefundCustomerSender("Personal <person@example.test>"));
  assertThrows(() => formatRefundCustomerSender("not-an-email"));
  assertThrows(() =>
    formatRefundCustomerSender(
      "Refunds <refunds@bloomjoysweets.com>\r\nBcc: outsider@example.test",
    )
  );
});
