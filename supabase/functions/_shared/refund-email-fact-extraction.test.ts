import {
  extractLabeledRefundEmailFacts,
  requirePublicEligibilityForUnverifiedMachineFact,
  resolveExactRefundMachineFact,
} from "./refund-email-fact-extraction.ts";
import { buildRefundCustomerEmail } from "./refund-email.ts";
import type { RefundMissingField } from "./refund-deterministic-follow-up.ts";

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};

// Take the actual copyable line from the real renderer, not a parallel fixture
// label dictionary. This test has no send/provider/database capability.
const spanishReply = (field: RefundMissingField, value: string) => {
  const email = buildRefundCustomerEmail({
    messageType: "more_info",
    customerLocale: "es",
    customerEmail: "synthetic@example.test",
    publicReference: "RF-SPANISH-UAT",
    paymentMethod: field === "zelle_payment_contact" ? "cash" : "card",
    missingFields: [field],
  });
  const spanish = email.text.split("Información en español")[1];
  const label = spanish?.split("\n").map((line) => line.trim()).find((line) =>
    line.endsWith(":") && !line.startsWith("Copie esta línea")
  );
  if (!label) throw new Error(`Missing real Spanish reply line for ${field}`);
  assert(email.html.includes(label), "HTML and text must contain the same reply label");
  return `${label} ${value}`;
};

Deno.test("all canonical Spanish email reply labels round-trip through the actual parser", () => {
  const examples: Array<[RefundMissingField, string, string, unknown]> = [
    ["location_or_machine", "Synthetic Lobby", "locationOrMachine", "Synthetic Lobby"],
    ["incident_date", "2026-08-30", "incidentDate", "2026-08-30"],
    ["incident_time", "1:42 p. m.", "incidentTime", "13:42"],
    ["payment_method", "efectivo", "paymentMethod", "cash"],
    ["payment_interaction", "acerqué la tarjeta", "paymentInteraction", "tap_card"],
    ["wallet_provider", "Apple Pay", "walletProvider", "apple_pay"],
    ["amount", "7,25", "amountCents", 725],
    ["card_last4", "4242", "cardLast4", "4242"],
    ["card_network", "Visa", "cardNetwork", "visa"],
    ["zelle_payment_contact", "synthetic@example.test", "zellePaymentContact", "synthetic@example.test"],
  ];
  for (const [field, value, property, expected] of examples) {
    const reply = spanishReply(field, value) + (field === "card_last4"
      ? `\n${spanishReply("payment_interaction", "acerqué la tarjeta")}` : "");
    const facts = extractLabeledRefundEmailFacts(reply);
    assert(Reflect.get(facts, property) === expected, `${field} must round-trip`);
    assert(facts.manualReviewReason === null, `${field} must be unambiguous`);
  }
});

Deno.test("Spanish replies preserve deterministic values and physical-card provenance", () => {
  for (const [value, expected] of [
    ["tarjeta", "card"], ["tarjeta física", "card"], ["tarjeta de crédito", "card"],
    ["tarjeta de débito", "card"], ["Apple Pay", "card"], ["Google Pay", "card"],
    ["efectivo", "cash"],
  ]) {
    assert(extractLabeledRefundEmailFacts(spanishReply("payment_method", value)).paymentMethod === expected,
      `Explicit payment answer ${value}`);
  }
  const wallet = extractLabeledRefundEmailFacts([
    spanishReply("payment_interaction", "billetera del teléfono o reloj"),
    spanishReply("wallet_provider", "Google Pay"),
    spanishReply("card_last4", "4242"),
  ].join("\n"));
  assert(wallet.cardWalletUsed === true, "wallet use remains explicit");
  assert(wallet.cardLast4 === null, "emailed wallet digits never become physical card evidence");
  assert(wallet.cardLast4Provenance === "wallet_device_token", "wallet provenance is retained");
  const unsupported = extractLabeledRefundEmailFacts(spanishReply("payment_method", "creo que pagué con algo"));
  assert(unsupported.manualReviewReason === "ambiguous_customer_facts", "prose is not a payment enum");
  assert(extractLabeledRefundEmailFacts(spanishReply("card_network", "no sé")).cardNetwork === "other_unknown",
    "Explicit uncertainty is not a guessed network");
});

Deno.test("Spanish decimal commas are exact and ambiguous formats fail closed", () => {
  for (const [value, expected] of [["7,25", 725], ["7,5", 750], ["$7.25", 725], ["7", 700]] as const) {
    assert(extractLabeledRefundEmailFacts(spanishReply("amount", value)).amountCents === expected,
      `Exact decimal amount ${value}`);
  }
  for (const value of ["7,000", "1.234,56", "1,234.56", "7,2,5", "gratis"]) {
    const facts = extractLabeledRefundEmailFacts(spanishReply("amount", value));
    assert(facts.amountCents === null && facts.ambiguousFields.includes("amount"),
      `Never guess an ambiguous Spanish amount ${value}`);
  }
  assert(extractLabeledRefundEmailFacts("Amount: $1,234.56").amountCents === 123456,
    "Existing well-formed English grouping remains supported");
  assert(extractLabeledRefundEmailFacts("Amount: 7,25").amountCents === null,
    "Malformed English grouping is not multiplied by one hundred");
});

Deno.test("Spanish quote boundaries and bilingual conflicts cannot replace the current reply", () => {
  for (const boundary of [
    "El dom, 30 ago 2026, Bloomjoy escribió:", "escribió:", "De: Bloomjoy",
    "-----Mensaje original-----", "On Sun, Bloomjoy wrote:",
  ]) {
    const facts = extractLabeledRefundEmailFacts([
      spanishReply("card_network", "Visa"), boundary, "Tipo de tarjeta: Mastercard",
    ].join("\n"));
    assert(facts.cardNetwork === "visa" && facts.manualReviewReason === null,
      `Quoted facts stop at ${boundary}`);
  }
  const conflict = extractLabeledRefundEmailFacts("Card type: Visa\nTipo de tarjeta: Mastercard");
  assert(conflict.manualReviewReason === "ambiguous_customer_facts" && conflict.ambiguousFields.includes("cardNetwork"),
    "Contradictory English/Spanish values share one conflict boundary");
  const repeated = extractLabeledRefundEmailFacts("Card type: Visa\nTipo de tarjeta: Visa");
  assert(repeated.cardNetwork === "visa" && repeated.manualReviewReason === null, "Exact bilingual replay is safe");
  assert(extractLabeledRefundEmailFacts("> Tipo de tarjeta: Mastercard\nTipo de tarjeta: Visa").cardNetwork === "visa",
    "Quoted-line prefix cannot become current facts");
  for (const [field, value] of [["incident_date", "30/08/2026"], ["incident_time", "13:30 p. m."]] as const) {
    assert(extractLabeledRefundEmailFacts(spanishReply(field, value)).manualReviewReason === "ambiguous_customer_facts",
      "Noncanonical date/time is reviewed, not guessed");
  }
});

Deno.test("Spanish sensitive or escalated replies remain manager-owned", () => {
  for (const signal of ["contraseña", "código de seguridad", "abogado", "contracargo", "lesión"]) {
    const facts = extractLabeledRefundEmailFacts(`Tipo de tarjeta: Visa\n${signal}`);
    assert(facts.manualReviewReason === "sensitive_or_escalated_content", "Do not automate an escalated reply");
  }
});

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

Deno.test("unverified machine facts require the public intake eligibility boundary", async () => {
  const candidate = {
    machineId: "valley-machine",
    locationId: "valley-location",
    timezone: "America/New_York",
    machineLabel: "Preit1085-Valley mall",
    publicMachineLabel: "Valley Mall — product type unverified",
    locationName: "Valley Mall",
  };
  let eligibilityChecks = 0;
  const rejected = await requirePublicEligibilityForUnverifiedMachineFact(
    candidate,
    new Map([[candidate.machineId, "unknown"]]),
    async () => {
      eligibilityChecks += 1;
      return false;
    },
  );
  assert(rejected === null, "an unpublished unknown-product machine must not resolve");
  assert(eligibilityChecks === 1, "unknown-product resolution must check public eligibility once");

  const accepted = await requirePublicEligibilityForUnverifiedMachineFact(
    candidate,
    new Map([[candidate.machineId, "unknown"]]),
    async () => true,
  );
  assert(accepted?.machineId === candidate.machineId, "a published unknown-product machine may resolve");

  eligibilityChecks = 0;
  const ordinary = await requirePublicEligibilityForUnverifiedMachineFact(
    candidate,
    new Map([[candidate.machineId, "commercial"]]),
    async () => {
      eligibilityChecks += 1;
      return false;
    },
  );
  assert(ordinary?.machineId === candidate.machineId, "ordinary machine resolution stays unchanged");
  assert(eligibilityChecks === 0, "ordinary machine resolution does not add a public eligibility call");
});
