import {
  automaticRefundCustomerContactEnabled,
  buildRefundFollowUpTriggerFingerprint,
  deriveRefundMissingFields,
  refundFollowUpTemplateKey,
  REFUND_DETERMINISTIC_FOLLOW_UP_VERSION,
  sanitizeRefundMissingFields,
} from "./refund-deterministic-follow-up.ts";

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};

Deno.test("automatic customer contact is off unless explicitly enabled", () => {
  assert(!automaticRefundCustomerContactEnabled(""), "missing flag must be disabled");
  assert(!automaticRefundCustomerContactEnabled("false"), "false flag must be disabled");
  assert(!automaticRefundCustomerContactEnabled("yes"), "non-exact true must be disabled");
  assert(automaticRefundCustomerContactEnabled(" TRUE "), "explicit true may pass the edge gate");
});

Deno.test("missing fields are exact, ordered, and never request wallet digits by email", () => {
  const incomplete = deriveRefundMissingFields({
    reportingMachineId: null,
    reportingLocationId: null,
    incidentAt: null,
    paymentMethod: "card",
    paymentAmountCents: null,
    cardLast4: null,
    cardWalletUsed: false,
  });
  assert(
    JSON.stringify(incomplete.missingFields) === JSON.stringify([
      "location_or_machine",
      "incident_date",
      "incident_time",
      "amount",
      "card_last4",
    ]),
    "only absent required fields should be requested",
  );

  const wallet = deriveRefundMissingFields({
    reportingMachineId: "machine",
    reportingLocationId: "location",
    incidentAt: "2026-08-03T12:00:00Z",
    incidentTimeResolution: "exact",
    paymentMethod: "card",
    paymentAmountCents: 725,
    cardLast4: null,
    cardWalletUsed: true,
  });
  assert(wallet.requiresSecureWalletCorrection, "wallet mismatch must use the secure flow");
  assert(!wallet.missingFields.includes("card_last4"), "wallet digits must not be requested by email");

  const approximateTime = deriveRefundMissingFields({
    reportingMachineId: "machine",
    reportingLocationId: "location",
    incidentAt: "2026-08-03T12:00:00Z",
    incidentTimeResolution: "date_only",
    paymentMethod: "cash",
    paymentAmountCents: 725,
  });
  assert(
    JSON.stringify(approximateTime.missingFields) === JSON.stringify(["incident_time"]),
    "a stored date without a resolved purchase time must still request the time",
  );

  const locationOnly = deriveRefundMissingFields({
    reportingMachineId: null,
    reportingLocationId: "location",
    incidentAt: "2026-08-03T12:00:00Z",
    incidentTimeResolution: "exact",
    paymentMethod: "cash",
    paymentAmountCents: 725,
  });
  assert(
    !locationOnly.missingFields.includes("location_or_machine"),
    "a known machine or a known Bloomjoy location must satisfy the customer-facing location fact",
  );
});

Deno.test("complete facts have no missing-field request", () => {
  const complete = deriveRefundMissingFields({
    reportingMachineId: "machine",
    reportingLocationId: "location",
    incidentAt: "2026-08-03T12:00:00Z",
    incidentTimeResolution: "exact",
    paymentMethod: "card",
    paymentAmountCents: 725,
    cardLast4: "4242",
    cardWalletUsed: false,
  });
  assert(complete.missingFields.length === 0, "complete case must not ask for known facts");
  assert(!complete.requiresSecureWalletCorrection, "physical card does not use wallet correction");
});

Deno.test("template identities are deterministic and versioned", () => {
  assert(
    refundFollowUpTemplateKey("missing_information", "request") ===
      `refund_missing_information_${REFUND_DETERMINISTIC_FOLLOW_UP_VERSION}`,
    "request template should be versioned",
  );
  assert(
    refundFollowUpTemplateKey("no_safe_match", "reminder") ===
      `refund_no_safe_match_reminder_${REFUND_DETERMINISTIC_FOLLOW_UP_VERSION}`,
    "reminder template should be versioned",
  );
  assert(
    refundFollowUpTemplateKey("missing_information", "request", "refund_follow_up_v1") ===
      "refund_missing_information_refund_follow_up_v1",
    "historical cycles should preserve their original template identity",
  );
});

Deno.test("cycle fingerprints are stable and change with facts or source message", async () => {
  const base = {
    refundCaseId: "78740000-0000-4000-8000-000000000001",
    reason: "missing_information" as const,
    requestedFields: sanitizeRefundMissingFields(["amount", "incident_time"]),
    caseFactVersion: 1,
  };
  const first = await buildRefundFollowUpTriggerFingerprint(base);
  const duplicate = await buildRefundFollowUpTriggerFingerprint({
    ...base,
    requestedFields: ["incident_time", "amount"],
  });
  const changed = await buildRefundFollowUpTriggerFingerprint({ ...base, caseFactVersion: 2 });
  const reply = await buildRefundFollowUpTriggerFingerprint({
    ...base,
    sourceCustomerMessageId: "78750000-0000-4000-8000-000000000001",
  });
  assert(first === duplicate, "equivalent triggers should deduplicate");
  assert(first !== changed, "fact-version change should permit a distinct evaluated cycle");
  assert(first !== reply, "a verified reply should bind a distinct re-evaluation trigger");
  assert(/^[a-f0-9]{64}$/.test(first), "fingerprint should contain no raw values");
});
