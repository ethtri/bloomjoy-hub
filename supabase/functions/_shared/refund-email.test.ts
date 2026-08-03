import {
  buildRefundCustomerEmail,
  describeRefundMissingFields,
  REFUND_DETERMINISTIC_FOLLOW_UP_VERSION,
  sanitizeRefundMissingFields,
} from "./refund-email.ts";

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};

const assertIncludes = (value: string, expected: string, message: string) =>
  assert(value.includes(expected), `${message}: expected ${JSON.stringify(expected)}`);

const assertNotIncludes = (value: string, expected: string, message: string) =>
  assert(!value.includes(expected), `${message}: did not expect ${JSON.stringify(expected)}`);

Deno.test("missing-information templates request every approved missing field and nothing generic", () => {
  const email = buildRefundCustomerEmail({
    messageType: "more_info",
    publicReference: "RF-EXACT01",
    customerEmail: "customer@example.com",
    missingFields: ["incident_time", "amount", "incident_time"],
  });

  assertIncludes(email.text, "the approximate purchase time, including AM or PM", "time request");
  assertIncludes(email.text, "the exact amount charged", "amount request");
  assertNotIncludes(email.text, "the machine or Bloomjoy location", "present location is not requested");
  assertNotIncludes(email.text, "payment-screen photo", "unnecessary photo request");
  assertNotIncludes(email.text, "anything that may help", "generic request");
});

Deno.test("missing-field normalization is allowlisted, ordered, and deduplicated", () => {
  const fields = sanitizeRefundMissingFields([
    "card_last4",
    "unsupported",
    "incident_date",
    "card_last4",
  ]);
  assert(
    JSON.stringify(fields) === JSON.stringify(["incident_date", "card_last4"]),
    "missing fields should use canonical order",
  );
  assert(describeRefundMissingFields(fields).length === 2, "two safe descriptions expected");
  assert(REFUND_DETERMINISTIC_FOLLOW_UP_VERSION === "refund_follow_up_v1", "version is immutable");
});

Deno.test("missing-information templates fail closed without an exact field list", () => {
  let failed = false;
  try {
    buildRefundCustomerEmail({
      messageType: "more_info",
      publicReference: "RF-NOFIELDS",
      customerEmail: "customer@example.com",
    });
  } catch {
    failed = true;
  }
  assert(failed, "generic more-information email should be rejected");
});

Deno.test("no-safe-match copy is humble, correction-focused, and makes no refund promise", () => {
  const email = buildRefundCustomerEmail({
    messageType: "no_safe_match",
    publicReference: "RF-NOMATCH",
    customerEmail: "customer@example.com",
    machineLabel: "Lobby machine",
    locationName: "Example venue",
    paymentMethod: "card",
    refundAmountCents: 725,
    incidentLocalDateTime: "2026-08-03 2:15 PM",
  });

  assertIncludes(email.text, "This does not mean you did anything wrong", "non-blaming copy");
  assertIncludes(email.text, "could not identify one transaction", "safe-match explanation");
  assertIncludes(email.text, "Please reply only if", "one next step");
  assertIncludes(email.text, "Reported purchase time: 2026-08-03 2:15 PM", "safe fact restatement");
  assertIncludes(email.text, "Reported amount: $7.25", "pre-decision amount label");
  assertNotIncludes(email.text.toLowerCase(), "inside the wallet", "wallet digits are not requested by email");
  assertNotIncludes(email.text.toLowerCase(), "your refund was approved", "approval promise");
  assertNotIncludes(email.text.toLowerCase(), "refund has been sent", "completion promise");
});

Deno.test("mobile-wallet last-four requests fail closed outside the secure correction flow", () => {
  let failed = false;
  try {
    buildRefundCustomerEmail({
      messageType: "more_info",
      publicReference: "RF-WALLET",
      customerEmail: "customer@example.com",
      missingFields: ["card_last4"],
      cardWalletUsed: true,
    });
  } catch {
    failed = true;
  }
  assert(failed, "wallet last-four requests must use the secure link");
});

Deno.test("approved and completed copy labels only the confirmed refund amount", () => {
  const approved = buildRefundCustomerEmail({
    messageType: "approved",
    publicReference: "RF-APPROVED",
    customerEmail: "customer@example.com",
    refundAmountCents: 725,
  });
  const status = buildRefundCustomerEmail({
    messageType: "status_update",
    publicReference: "RF-STATUS",
    customerEmail: "customer@example.com",
    refundAmountCents: 725,
  });

  assertIncludes(approved.text, "Refund amount: $7.25", "post-decision amount label");
  assertIncludes(status.text, "Reported amount: $7.25", "pre-decision amount label");
});

Deno.test("no-safe-match reminder is bounded and never solicits wallet digits", () => {
  const email = buildRefundCustomerEmail({
    messageType: "reminder",
    followUpReason: "no_safe_match",
    publicReference: "RF-NOMATCH2",
    customerEmail: "customer@example.com",
  });
  assertIncludes(email.text, "checking in once", "one reminder boundary");
  assertIncludes(email.text, "no action is needed", "customer may wait for human review");
  assertNotIncludes(email.text.toLowerCase(), "inside your mobile wallet", "wallet digits are not requested");
});

Deno.test("information-received copy confirms receipt without a decision or completion claim", () => {
  const email = buildRefundCustomerEmail({
    messageType: "information_received",
    publicReference: "RF-RECEIVED",
    customerEmail: "customer@example.com",
  });

  assertIncludes(email.text, "you do not need to resend it", "bounded acknowledgement");
  assertIncludes(email.text, "confirms receipt only", "receipt-only boundary");
  assertIncludes(email.text, "not yet a refund decision", "decision boundary");
  assertIncludes(email.text, "not a promise that a payment has been completed", "payment boundary");
});
