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
    "Amount (for example, $7.25): $7.25",
    "Card last four: 4242",
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
