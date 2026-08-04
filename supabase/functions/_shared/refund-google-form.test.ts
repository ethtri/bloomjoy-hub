import {
  normalizeRefundGoogleFormResponse,
  parseRefundGoogleFormLocalDateTime,
  refundGoogleFormValuesToRows,
  validateRefundGoogleFormHeaders,
} from "./refund-google-form.ts";

const assertEquals = (actual: unknown, expected: unknown, message: string) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
};

const headers = [
  "Timestamp",
  "Your Name",
  "Email Address",
  "Location of Purchase",
  "Date and Time of Incident",
  "Incident Description",
  "Request Amount",
  "Payment Method",
  "Last 4 digits of the credit card used",
  "Refund Payment Preference",
  "Venmo/Zelle Payment ID",
];

Deno.test("validates the two-page legacy Google Form contract", () => {
  assertEquals(validateRefundGoogleFormHeaders([headers]).valid, true, "complete contract should pass");
  assertEquals(
    validateRefundGoogleFormHeaders([[...headers].slice(0, -1)]).missingHeaders,
    ["venmo_zelle_payment_id"],
    "missing second-page contact header should fail closed",
  );
  const withUnsupportedAttachment = validateRefundGoogleFormHeaders([
    [...headers, "Upload a receipt"],
  ]);
  assertEquals(withUnsupportedAttachment.valid, false, "unexpected attachment column should fail closed");
  assertEquals(
    withUnsupportedAttachment.unexpectedHeaders,
    ["upload_a_receipt"],
    "unexpected header remains explicit",
  );
});

Deno.test("normalizes a synthetic wallet response without inventing missing facts", () => {
  const rows = refundGoogleFormValuesToRows([
    headers,
    [
      46238.5,
      "Synthetic Customer",
      "refund-google-form@example.test",
      "Synthetic Location",
      "8/4/2026 12:45 PM",
      "Synthetic test issue only.",
      "$12.00",
      "Apple / Google Pay",
      "4242",
      "",
      "",
    ],
  ]);
  const normalized = normalizeRefundGoogleFormResponse(rows[0]);

  assertEquals(normalized.rowNumber, 2, "sheet row number should be stable");
  assertEquals(normalized.sourceSubmittedLocalDateTime, "2026-08-04T12:00:00", "serial timestamp");
  assertEquals(normalized.incidentLocalDateTime, "2026-08-04T12:45:00", "incident time");
  assertEquals(normalized.paymentMethod, "card", "wallet maps to card intake");
  assertEquals(normalized.cardWalletUsed, true, "wallet indicator is retained");
  assertEquals(normalized.paymentAmountCents, 1200, "amount is cents");
  assertEquals(normalized.cardLast4, "4242", "last four is normalized");
  assertEquals(normalized.missingFields, [], "complete wallet row has no missing facts");
  assertEquals(normalized.invalidFields, [], "complete wallet row has no invalid facts");
});

Deno.test("keeps incomplete cash rows draft-safe and preserves the legacy preference", () => {
  const rows = refundGoogleFormValuesToRows([
    headers,
    [
      "8/4/2026 9:30:00 AM",
      "Synthetic Cash Customer",
      "cash-google-form@example.test",
      "Synthetic Location",
      "",
      "Synthetic cash issue only.",
      "7",
      "Cash",
      "",
      "Venmo",
      "@synthetic-handle",
    ],
  ]);
  const normalized = normalizeRefundGoogleFormResponse(rows[0]);

  assertEquals(normalized.paymentMethod, "cash", "cash is preserved");
  assertEquals(normalized.cashPaymentPreference, "venmo", "legacy preference is retained as intake evidence");
  assertEquals(normalized.cashPaymentContact, "@synthetic-handle", "bounded payment contact is retained");
  assertEquals(normalized.missingFields, ["incident_datetime"], "missing incident time stays explicit");
});

Deno.test("rejects invalid money, email, and card evidence without coercion", () => {
  const rows = refundGoogleFormValuesToRows([
    headers,
    [
      "8/4/2026 10:00 AM",
      "Synthetic Invalid Customer",
      "not-an-email",
      "Synthetic Location",
      "8/4/2026 9:59 AM",
      "Synthetic invalid fixture.",
      "101.00",
      "Card",
      "42",
      "",
      "",
    ],
  ]);
  const normalized = normalizeRefundGoogleFormResponse(rows[0]);

  assertEquals(normalized.paymentAmountCents, null, "out-of-contract amount should not be imported");
  assertEquals(normalized.cardLast4, null, "invalid last four should not be imported");
  assertEquals(
    normalized.invalidFields,
    ["card_last4", "customer_email", "payment_amount"],
    "invalid fields remain explicit",
  );
});

Deno.test("rejects nonexistent local dates", () => {
  assertEquals(parseRefundGoogleFormLocalDateTime("2/30/2026 9:00 AM"), null, "invalid date");
  assertEquals(parseRefundGoogleFormLocalDateTime("2026-08-04T21:15:10"), "2026-08-04T21:15:10", "ISO local time");
});
