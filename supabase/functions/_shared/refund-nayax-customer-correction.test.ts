import {
  buildNayaxCustomerCorrectionEmail,
  deriveNayaxCustomerCorrectionFields,
} from "./refund-nayax-customer-correction.ts";

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};

const assertIncludes = (value: string, expected: string, label: string) =>
  assert(value.includes(expected), `${label} must include ${expected}`);

Deno.test("physical-card conflicts request the smallest customer-correctable facts", () => {
  const fields = deriveNayaxCustomerCorrectionFields({
    recommendationState: "manual_exception",
    cardWalletUsed: false,
    candidates: [{
      isTopRanked: true,
      reasonCodes: [
        "machine_exact",
        "amount_exact",
        "incident_time_within_60m",
        "card_last4_mismatch",
        "qr_claim_missing",
      ],
      manualReviewReasons: ["qr_claim_missing"],
      hardExclusions: ["card_last4_mismatch"],
    }, {
      isTopRanked: false,
      reasonCodes: [
        "machine_exact",
        "amount_exact",
        "incident_time_within_60m",
        "card_last4_mismatch",
      ],
      hardExclusions: ["card_last4_mismatch"],
    }],
  });
  assert(
    JSON.stringify(fields) === JSON.stringify([
      "incident_time",
      "payment_method",
      "amount",
      "card_last4",
    ]),
    "a physical-card mismatch should confirm only time, payment method, amount, and physical-card last four",
  );
});

Deno.test("provider, duplicate, and wallet exceptions never become customer email work", () => {
  for (
    const reason of [
      "already_refunded",
      "duplicate_transaction",
      "provider_machine_mismatch",
      "payment_not_approved",
    ]
  ) {
    const fields = deriveNayaxCustomerCorrectionFields({
      recommendationState: "manual_exception",
      cardWalletUsed: false,
      candidates: [{
        isTopRanked: true,
        reasonCodes: ["card_last4_mismatch", reason],
        hardExclusions: ["card_last4_mismatch", reason],
      }],
    });
    assert(fields.length === 0, `${reason} must remain manager-only`);
  }

  const wallet = deriveNayaxCustomerCorrectionFields({
    recommendationState: "manual_exception",
    cardWalletUsed: true,
    candidates: [{
      isTopRanked: true,
      reasonCodes: ["tokenized_last4_noncorrelating", "wallet_payment"],
    }],
  });
  assert(
    wallet.length === 0,
    "wallet corrections must keep using the secure flow",
  );
});

Deno.test("physical-card conflict email is branded, targeted, and reply-safe", () => {
  const email = buildNayaxCustomerCorrectionEmail({
    messageType: "no_safe_match",
    followUpReason: "no_safe_match",
    publicReference: "RF-CARD-CHECK",
    customerEmail: "customer@example.com",
    machineLabel: "Cotton Candy",
    locationName: "Example venue",
    paymentMethod: "card",
    refundAmountCents: 1090,
    missingFields: [
      "incident_time",
      "payment_method",
      "amount",
      "card_last4",
    ],
  });

  assertIncludes(email.text, "Card last four:", "reply parser label");
  assertIncludes(
    email.text,
    "exact physical card you tapped",
    "physical card safety",
  );
  assertIncludes(email.text, "Visa, Mastercard, Discover", "card type request");
  assertIncludes(
    email.text,
    "do not need to submit another form",
    "same-case guidance",
  );
  assertIncludes(
    email.text,
    "recheck this same request",
    "automatic recheck guidance",
  );
  assert(
    !email.text.toLowerCase().includes("nayax"),
    "provider detail remains internal",
  );
  assertIncludes(email.html, "Bloomjoy refund request", "branded HTML");
});
