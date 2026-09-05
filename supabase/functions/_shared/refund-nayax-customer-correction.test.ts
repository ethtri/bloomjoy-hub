import {
  buildNayaxCustomerCorrectionEmail,
  deriveNayaxCustomerCorrectionFields,
} from "./refund-nayax-customer-correction.ts";

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};

const assertIncludes = (value: string, expected: string, label: string) =>
  assert(value.includes(expected), `${label} must include ${expected}`);

Deno.test("last-four conflicts bundle unresolved payment context and nearby attempts", () => {
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
    JSON.stringify(fields) === JSON.stringify(["payment_interaction", "card_last4", "card_last4_source", "card_network", "nearby_attempt_count"]),
    "a mismatch must not ask for digits alone when their source and interaction are unknown",
  );
  const knownContext = deriveNayaxCustomerCorrectionFields({
    recommendationState: "manual_exception", paymentInteraction: "tap_card",
    cardLast4Source: "physical_card", cardNetwork: "visa",
    candidates: [{isTopRanked:true,reasonCodes:["card_last4_mismatch"],hardExclusions:["card_last4_mismatch"]}],
  });
  assert(JSON.stringify(knownContext) === JSON.stringify(["card_last4"]), "settled context should not be requested again");
});

Deno.test("v9 mismatch evidence chooses manager review or one targeted same-case correction", () => {
  const selectable = deriveNayaxCustomerCorrectionFields({
    recommendationState: "manual_exception",
    paymentInteraction: "tap_card",
    cardLast4Source: "physical_card",
    cardNetwork: "visa",
    candidates: [{
      isTopRanked: true,
      selectionAllowed: true,
      selectionBlockReason: null,
      customerNearbyAttemptCount: "one",
      reasonCodes: ["card_last4_mismatch_negative", "card_network_match"],
      hardExclusions: [],
    }],
  });
  assert(selectable.length === 0, "a selectable exact transaction must remain manager review, not customer outreach");

  const needsCorroboration = deriveNayaxCustomerCorrectionFields({
    recommendationState: "manual_exception",
    paymentInteraction: "tap_card",
    cardLast4Source: "physical_card",
    cardNetwork: "visa",
    candidates: [{
      isTopRanked: true,
      selectionAllowed: false,
      selectionBlockReason: "independent_corroboration_required",
      customerNearbyAttemptCount: "unknown",
      reasonCodes: ["card_last4_mismatch_negative"],
      hardExclusions: [],
    }],
  });
  assert(
    JSON.stringify(needsCorroboration) === JSON.stringify(["card_last4", "nearby_attempt_count"]),
    "a disabled v9 mismatch must request only the disputed digits and useful attempt-count corroboration",
  );

  const networkConflict = deriveNayaxCustomerCorrectionFields({
    recommendationState: "manual_exception",
    paymentInteraction: "tap_card",
    cardLast4Source: "physical_card",
    cardNetwork: "visa",
    candidates: [{
      isTopRanked: true,
      selectionAllowed: false,
      reasonCodes: ["card_network_mismatch_negative"],
      hardExclusions: [],
    }],
  });
  assert(JSON.stringify(networkConflict) === JSON.stringify(["card_network"]), "a network conflict requests only card type");
});

Deno.test("amount and time conflicts each request only their disputed fact", () => {
  const amountFields = deriveNayaxCustomerCorrectionFields({
    recommendationState: "manual_exception",
    cardWalletUsed: false,
    candidates: [{
      isTopRanked: true,
      reasonCodes: [
        "machine_exact",
        "amount_mismatch",
        "incident_time_within_60m",
      ],
    }],
  });
  assert(
    JSON.stringify(amountFields) === JSON.stringify(["amount"]),
    "an amount conflict should ask only for the reported amount",
  );

  const timeFields = deriveNayaxCustomerCorrectionFields({
    recommendationState: "manual_exception",
    cardWalletUsed: false,
    candidates: [{
      isTopRanked: true,
      reasonCodes: ["machine_exact", "amount_exact", "incident_time_too_far"],
    }],
  });
  assert(
    JSON.stringify(timeFields) === JSON.stringify(["incident_time", "incident_time_source"]),
    "a time conflict should include how the customer found the time",
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

Deno.test("accepted price and time estimates do not ask the customer to repeat facts", () => {
  for (const recommendationState of ["high_confidence", "manual_exception"]) {
    const fields = deriveNayaxCustomerCorrectionFields({
      recommendationState,
      cardWalletUsed: false,
      candidates: [{
        isTopRanked: true,
        reasonCodes: ["machine_exact", "card_last4_exact", "amount_within_tolerance",
          "incident_time_within_60m", "customer_time_within_1_hour"],
        manualReviewReasons: [],
        hardExclusions: [],
      }],
    });
    assert(fields.length === 0, `${recommendationState} must not turn accepted estimates into customer work`);
  }
});

Deno.test("an empty production lookup gives the customer no correction task", () => {
  assert(deriveNayaxCustomerCorrectionFields({
    recommendationState: "no_safe_match",
    cardWalletUsed: false,
    candidates: [],
  }).length === 0, "no provider results are internal work, not evidence that customer facts are wrong");
});

Deno.test("persisted targeted conflicts retain the same field after status normalization", () => {
  const fields = deriveNayaxCustomerCorrectionFields({
    recommendationState: "no_safe_match",
    paymentInteraction: "tap_card", cardLast4Source: "physical_card", cardNetwork: "visa",
    candidates: [{ isTopRanked: true, reasonCodes: ["card_last4_mismatch"], hardExclusions: ["card_last4_mismatch"] }],
  });
  assert(JSON.stringify(fields) === JSON.stringify(["card_last4"]), "a reminder must retain the actual supported correction without repeating settled context");
  assert(deriveNayaxCustomerCorrectionFields({
    recommendationState: "no_safe_match",
    cardWalletUsed: false,
    candidates: [{ isTopRanked: true, reasonCodes: ["card_last4_mismatch", "missing_canonical_machine_mapping"] }],
  }).length === 0, "provider mapping remains internal after status normalization");
});

Deno.test("correction fallback email stays on the same case and accepts structured context", () => {
  const email = buildNayaxCustomerCorrectionEmail({
    messageType: "no_safe_match",
    followUpReason: "no_safe_match",
    publicReference: "RF-CARD-CHECK",
    customerEmail: "customer@example.com",
    machineLabel: "Cotton Candy",
    locationName: "Example venue",
    paymentMethod: "card",
    refundAmountCents: 1090,
    missingFields: ["card_last4", "card_last4_source", "payment_interaction"],
  });

  assertIncludes(email.text, "Card last four:", "reply parser label");
  assertIncludes(
    email.text,
    "Last-four source",
    "last-four provenance label",
  );
  assertIncludes(
    email.text,
    "add only the requested detail",
    "requested-details instruction",
  );
  assertIncludes(
    email.text,
    "full card number",
    "card safety",
  );
  for (
    const repeatedField of [
      "Approximate purchase time",
      "Payment method",
      "Wallet provider",
      "Amount (for example",
      "Card type (Visa",
    ]
  ) {
    assert(
      !email.text.includes(repeatedField),
      `targeted correction must not request ${repeatedField}`,
    );
  }
  assertIncludes(
    email.text,
    "do not need to submit another request",
    "same-case guidance",
  );
  assertIncludes(
    email.text,
    "keep working on this same one",
    "same-case guidance",
  );
  assert(
    !email.text.toLowerCase().includes("nayax"),
    "provider detail remains internal",
  );
  assertIncludes(email.html, "Bloomjoy refund request", "branded HTML");
});
