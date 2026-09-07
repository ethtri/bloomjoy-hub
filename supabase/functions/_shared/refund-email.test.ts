import {
  buildEditableRefundCustomerEmail,
  buildRefundCustomerEmail,
  buildRefundStoredTextWithStatus,
  describeRefundMissingFields,
  redactRefundStatusLinksForStorage,
  REFUND_DETERMINISTIC_FOLLOW_UP_VERSION,
  sanitizeRefundMissingFields,
} from "./refund-email.ts";

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};

const assertIncludes = (value: string, expected: string, message: string) =>
  assert(
    value.includes(expected),
    `${message}: expected ${JSON.stringify(expected)}`,
  );

const assertNotIncludes = (value: string, expected: string, message: string) =>
  assert(
    !value.includes(expected),
    `${message}: did not expect ${JSON.stringify(expected)}`,
  );

Deno.test("missing-information templates request every approved missing field and nothing generic", () => {
  const email = buildRefundCustomerEmail({
    messageType: "more_info",
    publicReference: "RF-EXACT01",
    customerEmail: "customer@example.com",
    missingFields: ["incident_time", "amount", "incident_time"],
  });

  assertIncludes(
    email.text,
    "the approximate purchase time, including AM or PM",
    "time request",
  );
  assertIncludes(email.text, "the exact amount charged", "amount request");
  assertIncludes(
    email.text,
    "Approximate purchase time (include AM or PM):",
    "reply template includes only the missing time field",
  );
  assertIncludes(
    email.text,
    "Amount (for example, $7.25):",
    "reply template includes only the missing amount field",
  );
  assertNotIncludes(
    email.text,
    "Machine or location:",
    "reply template does not repeat a known location",
  );
  assertIncludes(
    email.html,
    "Approximate purchase time (include AM or PM):<br />Amount (for example, $7.25):",
    "HTML reply template keeps one field per line",
  );
  assertNotIncludes(
    email.text,
    "the machine or Bloomjoy location",
    "present location is not requested",
  );
  assertNotIncludes(
    email.text,
    "payment-screen photo",
    "unnecessary photo request",
  );
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
  assert(
    describeRefundMissingFields(fields).length === 2,
    "two safe descriptions expected",
  );
  assert(
    REFUND_DETERMINISTIC_FOLLOW_UP_VERSION === "refund_follow_up_v2",
    "version is immutable",
  );
});

Deno.test("cash payout request asks for one protected destination in English and Spanish", () => {
  const email = buildRefundCustomerEmail({
    messageType: "more_info",
    publicReference: "RF-PAYOUT1",
    customerEmail: "customer@example.com",
    paymentMethod: "cash",
    customerLocale: "es",
    missingFields: ["zelle_payment_contact"],
  });
  assertIncludes(email.text, "Zelle email or phone number:", "English reply line");
  assertIncludes(
    email.text,
    "Correo electrónico o número de teléfono de Zelle:",
    "Spanish reply line",
  );
  assertNotIncludes(email.text, "Approximate purchase time", "no purchase-time request");
  assertNotIncludes(email.text, "Card last four", "no card request");
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

  assertIncludes(
    email.text,
    "This does not mean you did anything wrong",
    "non-blaming copy",
  );
  assertIncludes(
    email.text,
    "could not identify one transaction",
    "safe-match explanation",
  );
  assertIncludes(email.text, "Please reply only if", "one next step");
  assertIncludes(
    email.text,
    "Reported purchase time: 2026-08-03 2:15 PM",
    "safe fact restatement",
  );
  assertIncludes(
    email.text,
    "Reported amount: $7.25",
    "pre-decision amount label",
  );
  assertNotIncludes(
    email.text.toLowerCase(),
    "inside the wallet",
    "wallet digits are not requested by email",
  );
  assertNotIncludes(
    email.text.toLowerCase(),
    "your refund was approved",
    "approval promise",
  );
  assertNotIncludes(
    email.text.toLowerCase(),
    "refund has been sent",
    "completion promise",
  );
});

Deno.test("cash no-safe-match and receipt copy never claim a card transaction review", () => {
  const noMatch = buildRefundCustomerEmail({
    messageType: "no_safe_match",
    publicReference: "RF-CASH-NOMATCH",
    customerEmail: "customer@example.com",
    paymentMethod: "cash",
    refundAmountCents: 800,
  });
  const reminder = buildRefundCustomerEmail({
    messageType: "reminder",
    publicReference: "RF-CASH-REMINDER",
    customerEmail: "customer@example.com",
    paymentMethod: "cash",
    followUpReason: "no_safe_match",
  });
  const received = buildRefundCustomerEmail({
    messageType: "information_received",
    publicReference: "RF-CASH-RECEIVED",
    customerEmail: "customer@example.com",
    paymentMethod: "cash",
  });

  for (const email of [noMatch, reminder, received]) {
    assertNotIncludes(email.text.toLowerCase(), "transaction records", "cash copy avoids card-transaction claims");
    assertNotIncludes(email.text.toLowerCase(), "card details", "cash copy avoids requesting card details");
  }
  assertIncludes(noMatch.text, "matching cash purchase", "cash-specific verification wording");
  assertIncludes(received.text, "updated purchase details", "cash receipt wording");
});

Deno.test("provider delay and SLA-at-risk updates are customer-safe and require no action", () => {
  const providerDelay = buildRefundCustomerEmail({
    messageType: "status_update",
    publicReference: "RF-PROVIDER-DELAY",
    customerEmail: "customer@example.com",
    paymentMethod: "card",
    statusUpdateReason: "provider_delay",
  });
  const slaAtRisk = buildRefundCustomerEmail({
    messageType: "status_update",
    publicReference: "RF-SLA-RISK",
    customerEmail: "customer@example.com",
    statusUpdateReason: "sla_at_risk",
  });

  assertIncludes(providerDelay.text, "waiting for confirmation from the payment provider", "provider-neutral delay reason");
  assertIncludes(providerDelay.text, "do not need to submit another request", "no duplicate request guidance");
  assertNotIncludes(providerDelay.text.toLowerCase(), "nayax", "provider name remains private");
  assertNotIncludes(providerDelay.text.toLowerCase(), "retry", "customer is not asked to retry");
  assertIncludes(slaAtRisk.text, "taking longer than our usual target", "truthful SLA wording");
  assertIncludes(slaAtRisk.text, "a person is now following it directly", "human ownership");
});

Deno.test("more-information headline does not minimize the customer effort", () => {
  const email = buildRefundCustomerEmail({
    messageType: "more_info",
    publicReference: "RF-TONE",
    customerEmail: "customer@example.com",
    missingFields: ["amount"],
  });
  assertIncludes(email.html, "One more detail to continue your refund review", "neutral headline");
  assertNotIncludes(email.html, "tiny bit", "minimizing phrase removed");
});

Deno.test("Spanish-locale cases receive useful bilingual lifecycle copy", () => {
  const confirmation = buildRefundCustomerEmail({
    messageType: "confirmation",
    publicReference: "RF-ES-CONFIRM",
    customerEmail: "customer@example.com",
    paymentMethod: "cash",
    customerLocale: "es",
  });
  const delay = buildRefundCustomerEmail({
    messageType: "status_update",
    publicReference: "RF-ES-DELAY",
    customerEmail: "customer@example.com",
    paymentMethod: "card",
    customerLocale: "es",
    statusUpdateReason: "provider_delay",
  });

  assertIncludes(confirmation.subject, "[Español / English]", "bilingual subject label");
  assertIncludes(confirmation.text, "Información en español", "Spanish section heading");
  assertIncludes(confirmation.text, "Recibimos su solicitud de reembolso", "Spanish confirmation");
  assertIncludes(confirmation.text, "datos de la compra", "cash-specific Spanish copy");
  assertIncludes(delay.text, "esperando una confirmación del proveedor de pago", "Spanish provider-delay copy");
  assertIncludes(delay.text, "No necesita enviar otra solicitud", "Spanish no-duplicate guidance");
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
  const editedStatus = buildEditableRefundCustomerEmail({
    input: {
      messageType: "status_update",
      publicReference: "RF-EDITED-STATUS",
      customerEmail: "customer@example.com",
      refundAmountCents: 725,
    },
    subject: "We are still reviewing your request",
    body: "Thank you for your patience while we check the available records.",
  });

  assertIncludes(
    approved.text,
    "Refund amount: $7.25",
    "post-decision amount label",
  );
  assertIncludes(
    status.text,
    "Reported amount: $7.25",
    "pre-decision amount label",
  );
  assertIncludes(
    editedStatus.text,
    "Reported amount: $7.25",
    "edited pre-decision amount label",
  );
  assertNotIncludes(
    editedStatus.text,
    "Refund amount: $7.25",
    "edited pre-decision copy must not imply approval",
  );
});

Deno.test("completed card copy is a truthful receipt with masked destination and timing", () => {
  const completed = buildRefundCustomerEmail({
    messageType: "completed",
    publicReference: "RF-COMPLETE",
    customerEmail: "customer@example.com",
    refundAmountCents: 725,
    paymentMethod: "card",
    cardLast4: "1234",
  });

  assertIncludes(
    completed.text,
    "The approved refund for $7.25 to the card ending in 1234",
    "confirmed refund receipt",
  );
  assertIncludes(
    completed.text,
    "Nayax has approved your refund. Your bank may take up to 4 business days to show it on your account.",
    "required completion opening",
  );
  assertIncludes(
    completed.text,
    "up to 4 business days",
    "provider display timeline",
  );
  assertNotIncludes(
    completed.text,
    "marked complete",
    "internal workflow wording",
  );
});

Deno.test("cash completion copy is channel-neutral and contains no payout details", () => {
  const completed = buildRefundCustomerEmail({
    messageType: "completed",
    publicReference: "RF-CASH-COMPLETE",
    customerEmail: "customer@example.com",
    refundAmountCents: 800,
    paymentMethod: "cash",
  });

  assertIncludes(
    completed.text,
    "We issued your refund for $8.00 using the payment method arranged with you.",
    "channel-neutral completion receipt",
  );
  assertIncludes(
    completed.text,
    "refund request was approved and completed",
    "durable completion state",
  );
  for (const prohibited of [
    "Zelle",
    "Venmo",
    "payout handle",
    "manual_external",
    "transaction reference",
    "gift card",
  ]) {
    assertNotIncludes(completed.text, prohibited, `cash receipt excludes ${prohibited}`);
  }
});

Deno.test("denial copy gives a customer-safe reason and supports a reply appeal", () => {
  const denied = buildRefundCustomerEmail({
    messageType: "denied",
    publicReference: "RF-DENIED",
    customerEmail: "customer@example.com",
    decisionReason:
      "We could not confirm a matching purchase at the machine and time provided",
  });

  assertIncludes(
    denied.text,
    "could not confirm a matching purchase",
    "customer-safe reason",
  );
  assertIncludes(
    denied.text,
    "reply in this same conversation",
    "reply appeal",
  );
  assertIncludes(denied.html, "same conversation", "HTML appeal path");
});

Deno.test("denial copy fails closed instead of exposing an internal manager note", () => {
  let failed = false;
  try {
    buildRefundCustomerEmail({
      messageType: "denied",
      publicReference: "RF-DENIED-INTERNAL",
      customerEmail: "customer@example.com",
      decisionReason: "INTERNAL: suspected duplicate risk score 91",
    });
  } catch {
    failed = true;
  }
  assert(failed, "internal denial reasons must be rejected");
});

Deno.test("appeal receipt reopens the same case without promising a payment", () => {
  const appeal = buildRefundCustomerEmail({
    messageType: "appeal_received",
    publicReference: "RF-APPEAL1",
    customerName: "Jules",
    customerEmail: "customer@example.com",
  });

  assertIncludes(appeal.text, "same refund request", "same-case boundary");
  assertIncludes(
    appeal.text,
    "do not need to submit another form",
    "one-form boundary",
  );
  assertIncludes(
    appeal.text,
    "not a refund approval and cannot issue a payment",
    "payment boundary",
  );
  assertIncludes(appeal.text, "reply", "continued conversation");
});

Deno.test("customer templates share the branded, email-safe renderer", () => {
  const samples = [
    buildRefundCustomerEmail({
      messageType: "confirmation",
      publicReference: "RF-BRAND01",
      customerEmail: "customer@example.com",
    }),
    buildRefundCustomerEmail({
      messageType: "denied",
      publicReference: "RF-BRAND02",
      customerEmail: "customer@example.com",
      decisionReason: "We could not confirm the purchase details provided",
    }),
    buildRefundCustomerEmail({
      messageType: "completed",
      publicReference: "RF-BRAND03",
      customerEmail: "customer@example.com",
      refundAmountCents: 725,
      paymentMethod: "card",
      cardLast4: "1234",
    }),
  ];

  for (const sample of samples) {
    assertIncludes(
      sample.html,
      '<table role="presentation"',
      "email-safe table layout",
    );
    assertIncludes(sample.html, "#b83d64", "Bloomjoy plum accent");
    assertIncludes(sample.html, "Georgia", "branded headline typography");
    assertIncludes(
      sample.html,
      "Bloomjoy Sweets customer care",
      "branded footer",
    );
    assertNotIncludes(sample.html, "/refunds?case=", "no internal case link");
    assertNotIncludes(
      sample.text.toLowerCase(),
      "risk score",
      "no internal scoring",
    );
  }
});

Deno.test("no-safe-match reminder is bounded and never solicits wallet digits", () => {
  const email = buildRefundCustomerEmail({
    messageType: "reminder",
    followUpReason: "no_safe_match",
    publicReference: "RF-NOMATCH2",
    customerEmail: "customer@example.com",
  });
  assertIncludes(email.text, "checking in once", "one reminder boundary");
  assertIncludes(
    email.text,
    "no action is needed",
    "customer may wait for human review",
  );
  assertNotIncludes(
    email.text.toLowerCase(),
    "inside your mobile wallet",
    "wallet digits are not requested",
  );
});

Deno.test("information-received copy confirms receipt without a decision or completion claim", () => {
  const email = buildRefundCustomerEmail({
    messageType: "information_received",
    publicReference: "RF-RECEIVED",
    customerEmail: "customer@example.com",
  });

  assertIncludes(
    email.text,
    "you do not need to resend it",
    "bounded acknowledgement",
  );
  assertIncludes(email.text, "confirms receipt only", "receipt-only boundary");
  assertIncludes(email.text, "not yet a refund decision", "decision boundary");
  assertIncludes(
    email.text,
    "not a promise that a payment has been completed",
    "payment boundary",
  );
});

Deno.test("eligible customer email carries one opaque fragment status link", () => {
  const token = "A".repeat(43);
  const email = buildRefundCustomerEmail({
    messageType: "confirmation",
    publicReference: "RF-STATUS-1",
    customerEmail: "customer@example.com",
    statusUrl: `https://app.bloomjoyusa.com/refunds/status#token=${token}`,
  });
  assertIncludes(email.text, "Check refund status:", "status text label");
  assertIncludes(
    email.text,
    `/refunds/status#token=${token}`,
    "opaque fragment link",
  );
  assertIncludes(email.html, "Check refund status", "status email action");
  assert(
    email.text.match(/refunds\/status/gu)?.length === 1,
    "status link appears once",
  );
});

Deno.test("status tokens are delivered but redacted from stored message evidence", () => {
  const token = "A".repeat(43);
  const statusUrl = `https://app.bloomjoyusa.com/refunds/status#token=${token}`;
  const delivery = buildRefundStoredTextWithStatus({
    headline: "Refund confirmed",
    text: "Nayax approved the refund.",
    statusUrl,
  });
  assertIncludes(delivery.text, statusUrl, "delivery has the status link");
  assertIncludes(delivery.html, "Check refund status", "delivery has one action");
  const stored = redactRefundStatusLinksForStorage(delivery.text);
  assertNotIncludes(stored, token, "stored body has no raw token");
  assertIncludes(
    stored,
    "[Secure refund status link included at delivery]",
    "stored body retains privacy-safe audit evidence",
  );
});

Deno.test("status links reject query tokens and unapproved hosts", () => {
  for (const statusUrl of [
    `https://app.bloomjoyusa.com/refunds/status?token=${"A".repeat(43)}`,
    `https://example.com/refunds/status#token=${"A".repeat(43)}`,
  ]) {
    const email = buildRefundCustomerEmail({
      messageType: "confirmation",
      publicReference: "RF-STATUS-2",
      customerEmail: "customer@example.com",
      statusUrl,
    });
    assertNotIncludes(email.text, "Check refund status", "unsafe status URL");
  }
});

Deno.test("confirmed card copy names approval without claiming bank posting", () => {
  const email = buildRefundCustomerEmail({
    messageType: "completed",
    publicReference: "RF-CONFIRMED-1",
    customerEmail: "customer@example.com",
    paymentMethod: "card",
    refundAmountCents: 700,
  });
  assertIncludes(
    email.text,
    "Nayax has approved your refund. Your bank may take up to 4 business days to show it on your account.",
    "truthful card confirmation",
  );
  assertNotIncludes(
    email.text.toLowerCase(),
    "already in your account",
    "no false bank-posting claim",
  );
});
