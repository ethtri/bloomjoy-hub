import {
  classifyCustomerCredential,
  classifyNayaxIdentifierEvidence,
  classifyProviderIdentifier,
} from "./nayax-identifier-evidence.mjs";

const assertEquals = (actual: unknown, expected: unknown, label: string) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${label}: expected ${JSON.stringify(expected)}, received ${
        JSON.stringify(actual)
      }`,
    );
  }
};

Deno.test("customer credential classes preserve physical interfaces, wallet devices, bank records, and unknowns", () => {
  assertEquals(
    classifyCustomerCredential({
      paymentInteraction: "swipe_card",
      cardLast4Source: "physical_card",
    }),
    "customer_physical_swipe_pan",
    "physical swipe",
  );
  assertEquals(
    classifyCustomerCredential({
      paymentInteraction: "insert_card",
      cardLast4Source: "physical_card",
    }),
    "customer_physical_contact_chip_pan",
    "physical chip",
  );
  assertEquals(
    classifyCustomerCredential({
      paymentInteraction: "tap_card",
      cardLast4Source: "physical_card",
    }),
    "customer_physical_contactless_pan",
    "physical tap",
  );
  assertEquals(
    classifyCustomerCredential({
      paymentInteraction: "phone_watch_wallet",
      cardLast4Source: "wallet_device",
      walletDeviceKind: "phone",
    }),
    "customer_phone_wallet_token",
    "phone wallet",
  );
  assertEquals(
    classifyCustomerCredential({
      paymentInteraction: "phone_watch_wallet",
      cardLast4Source: "wallet_device",
      walletDeviceKind: "watch",
    }),
    "customer_watch_wallet_token",
    "watch wallet",
  );
  assertEquals(
    classifyCustomerCredential({
      paymentInteraction: "unsure",
      cardLast4Source: "bank_record",
    }),
    "customer_bank_record_identifier",
    "bank record",
  );
  assertEquals(
    classifyCustomerCredential({}),
    "customer_identifier_unknown",
    "unknown source",
  );
});

Deno.test("provider classes label every current Last Sales interpretation as unverified", () => {
  assertEquals(
    classifyProviderIdentifier("swipe"),
    "last_sales_swipe_identifier_unverified",
    "swipe",
  );
  assertEquals(
    classifyProviderIdentifier("chip"),
    "last_sales_chip_identifier_unverified",
    "chip",
  );
  assertEquals(
    classifyProviderIdentifier("contactless"),
    "last_sales_contactless_identifier_unverified",
    "tap",
  );
  assertEquals(
    classifyProviderIdentifier("wallet"),
    "last_sales_wallet_identifier_unverified",
    "wallet",
  );
  assertEquals(
    classifyProviderIdentifier("present"),
    "last_sales_present_identifier_unverified",
    "present",
  );
  assertEquals(
    classifyProviderIdentifier(""),
    "last_sales_identifier_unknown",
    "unknown",
  );
});

Deno.test("exact suffixes support a match without claiming provider equivalence", () => {
  const result = classifyNayaxIdentifierEvidence({
    customerLast4: "4242",
    providerLast4: "4242",
    paymentInteraction: "swipe_card",
    cardLast4Source: "physical_card",
    cardLast4Provenance: "physical_card",
    customerNetwork: "visa",
    providerNetwork: "visa",
    providerRecognitionMethod: "swipe",
  });
  assertEquals(
    result.cardLast4Comparison,
    "exact_support",
    "suffix comparison",
  );
  assertEquals(
    result.cardNetworkComparison,
    "exact_support",
    "network comparison",
  );
  assertEquals(
    result.paymentInteractionComparison,
    "supporting",
    "interaction comparison",
  );
  assertEquals(
    result.sameIdentifierEquivalenceProven,
    false,
    "provider equivalence remains unproved",
  );
});

Deno.test("physical swipe mismatch is negative evidence and never a proved same-identifier veto", () => {
  const result = classifyNayaxIdentifierEvidence({
    customerLast4: "4242",
    providerLast4: "3760",
    paymentInteraction: "swipe_card",
    cardLast4Source: "physical_card",
    cardLast4Provenance: "physical_card",
    customerNetwork: "visa",
    providerNetwork: "mastercard",
    providerRecognitionMethod: "swipe",
  });
  assertEquals(
    result.cardLast4Comparison,
    "mismatch_negative_unproven_equivalence",
    "suffix mismatch",
  );
  assertEquals(
    result.cardNetworkComparison,
    "mismatch_negative_unproven_equivalence",
    "network mismatch",
  );
  assertEquals(
    result.sameIdentifierEquivalenceProven,
    false,
    "no hard equivalence claim",
  );
});

Deno.test("contactless, wallet, bank-record, and unknown-source mismatches remain neutral", () => {
  for (
    const fixture of [
      {
        paymentInteraction: "tap_card",
        cardLast4Source: "physical_card",
        providerRecognitionMethod: "contactless",
      },
      {
        paymentInteraction: "phone_watch_wallet",
        cardLast4Source: "wallet_device",
        providerRecognitionMethod: "wallet",
      },
      {
        paymentInteraction: "unsure",
        cardLast4Source: "bank_record",
        providerRecognitionMethod: "swipe",
      },
      {
        paymentInteraction: "unsure",
        cardLast4Source: "unknown",
        providerRecognitionMethod: "present",
      },
    ]
  ) {
    const result = classifyNayaxIdentifierEvidence({
      ...fixture,
      customerLast4: "4242",
      providerLast4: "3760",
      customerNetwork: "visa",
      providerNetwork: "mastercard",
    });
    assertEquals(
      result.cardLast4Comparison,
      "mismatch_neutral_unproven_scope",
      JSON.stringify(fixture),
    );
    assertEquals(
      result.cardNetworkComparison,
      "mismatch_neutral_unproven_scope",
      JSON.stringify(fixture),
    );
  }
});
