import {
  extractLabeledRefundEmailFacts,
  resolveExactRefundMachineFact,
} from "./refund-email-fact-extraction.ts";

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};

Deno.test("extracts only explicit labeled routine refund facts", () => {
  const result = extractLabeledRefundEmailFacts([
    "Machine or location: Main Street Lobby",
    "Purchase date (YYYY-MM-DD): 2026-08-14",
    "Approximate purchase time (include AM or PM): 3:42 PM",
    "Payment method (card, Apple Pay, Google Pay, or cash): card",
    "Payment interaction (tap card, insert or swipe, phone or watch wallet, or not sure): tap card",
    "Amount (for example, $7.25): $7.25",
    "Card last four: 4242",
    "Card last four source (physical card only): physical card",
    "Card type (Visa, Mastercard, Discover, American Express, or not sure): MasterCard",
  ].join("\n"));
  assert(
    result.locationOrMachine === "Main Street Lobby",
    "location should be exact",
  );
  assert(result.incidentDate === "2026-08-14", "date should be validated");
  assert(
    result.incidentTime === "15:42",
    "time should normalize to 24-hour form",
  );
  assert(result.paymentMethod === "card", "payment method should be explicit");
  assert(
    result.cardWalletUsed === false,
    "physical card should be distinguished",
  );
  assert(result.amountCents === 725, "amount should use integer cents");
  assert(result.cardLast4 === "4242", "only four digits should be accepted");
  assert(result.cardLast4Provenance === "physical_card", "last-four source should persist");
  assert(result.cardNetwork === "mastercard", "card-network aliases should normalize");
  assert(result.paymentInteraction === "tap_card", "payment interaction should normalize");
  assert(result.ambiguousFields.length === 0, "consistent labeled facts should be safe");
});

Deno.test("ignores prose, invalid values, and quoted earlier messages", () => {
  const result = extractLabeledRefundEmailFacts([
    "I think it was around seven dollars yesterday.",
    "Amount: free",
    "Card last four: 424242",
    "On Thu, Bloomjoy wrote:",
    "Amount: $7.25",
  ].join("\n"));
  assert(result.amountCents === null, "invalid amount must not be guessed");
  assert(
    result.cardLast4 === null,
    "non-masked card data must not be accepted",
  );
});

Deno.test("extracts only a labeled valid payout destination", () => {
  const english = extractLabeledRefundEmailFacts(
    "Zelle email or phone number: payout.customer@example.com",
  );
  assert(
    english.zellePaymentContact === "payout.customer@example.com",
    "labeled Zelle email should be accepted",
  );
  assert(english.ambiguousFields.length === 0, "valid destination is unambiguous");

  const spanish = extractLabeledRefundEmailFacts(
    "Correo electrónico o número de teléfono de Zelle: +1 (415) 555-0123",
  );
  assert(
    spanish.zellePaymentContact === "+1 (415) 555-0123",
    "Spanish labeled phone should be accepted",
  );

  const invalid = extractLabeledRefundEmailFacts(
    "Zelle email or phone number: send it to my usual account",
  );
  assert(invalid.zellePaymentContact === null, "free-form destination must be rejected");
  assert(
    invalid.manualReviewReason === "ambiguous_customer_facts",
    "invalid payout contact must route to manager review",
  );
});

Deno.test("wallet answers never treat emailed digits as safe physical-card evidence", () => {
  const result = extractLabeledRefundEmailFacts([
    "Payment method: Apple Pay",
    "Card last four: 1234",
  ].join("\n"));
  assert(result.paymentMethod === "card", "wallet is still a card payment");
  assert(
    result.cardWalletUsed === true,
    "wallet use should open the secure correction path",
  );
  assert(
    result.cardLast4 === null,
    "wallet digits must not become matching evidence",
  );
  assert(result.walletProvider === "apple_pay", "wallet provider should normalize");
  assert(
    result.cardLast4Provenance === "wallet_device_token",
    "wallet digit provenance should remain explicit even when email digits are rejected",
  );
});

Deno.test("conflicting or unknown labeled card facts route to manager review", () => {
  const conflicting = extractLabeledRefundEmailFacts([
    "Payment method: card",
    "Payment interaction: tap card",
    "Wallet provider: Apple Pay",
    "Card type: Diners Club",
    "Card type: Visa",
    "Card last four: 4242",
    "Card last four source: physical card",
  ].join("\n"));
  assert(
    conflicting.manualReviewReason === "ambiguous_customer_facts",
    "conflicts must not overwrite trusted structured facts",
  );
  assert(conflicting.ambiguousFields.includes("walletProvider"), "wallet conflict should be named");
  assert(conflicting.ambiguousFields.includes("cardNetwork"), "network conflict should be named");
});

Deno.test("an unsure provider does not invent wallet use", () => {
  const physical = extractLabeledRefundEmailFacts([
    "Payment method: card",
    "Payment interaction: tap card",
    "Wallet provider: not sure",
  ].join("\n"));
  assert(physical.manualReviewReason === null, "an unsure provider is not a contradiction");
  assert(physical.cardWalletUsed === false, "physical-card interaction remains authoritative");
  assert(physical.walletProvider === null, "an inapplicable unsure provider is discarded");

  const wallet = extractLabeledRefundEmailFacts([
    "Payment interaction: phone or watch wallet",
    "Wallet provider: not sure",
  ].join("\n"));
  assert(wallet.cardWalletUsed === true, "explicit wallet interaction remains authoritative");
  assert(wallet.walletProvider === "unsure", "wallet-provider uncertainty is preserved");
});

Deno.test("escalated or sensitive content routes to manual review", () => {
  const result = extractLabeledRefundEmailFacts(
    "I started a chargeback and will contact my lawyer.",
  );
  assert(
    result.manualReviewReason === "sensitive_or_escalated_content",
    "unsafe routine automation should stop",
  );
});

Deno.test("machine resolution requires one exact active-label match", () => {
  const candidates = [
    {
      machineId: "machine-1",
      locationId: "location-1",
      timezone: "America/Los_Angeles",
      machineLabel: "Machine A",
      publicMachineLabel: "Main Street Lobby",
      locationName: "Main Street",
    },
    {
      machineId: "machine-2",
      locationId: "location-2",
      timezone: "America/Los_Angeles",
      machineLabel: "Machine B",
      publicMachineLabel: "Second Street Lobby",
      locationName: "Main Street",
    },
  ];
  assert(
    resolveExactRefundMachineFact("Main Street Lobby", candidates)
      ?.machineId === "machine-1",
    "one exact public label should resolve",
  );
  assert(
    resolveExactRefundMachineFact("Main Street", candidates) === null,
    "ambiguous location must not select a machine",
  );
});
