export const NAYAX_IDENTIFIER_POLICY_VERSION = "2026-09-05.identifier.v2";

const valueIn = (value, allowed) => allowed.includes(value) ? value : null;

/**
 * @param {{ paymentInteraction?: string | null, cardLast4Source?: string | null, cardLast4Provenance?: string | null, walletDeviceKind?: string | null }} input
 */
export const classifyCustomerCredential = ({
  paymentInteraction = null,
  cardLast4Source = null,
  cardLast4Provenance = null,
  walletDeviceKind = null,
}) => {
  const interaction = valueIn(paymentInteraction, [
    "phone_watch_wallet",
    "tap_card",
    "insert_card",
    "swipe_card",
    "insert_or_swipe",
    "unsure",
  ]);
  const source = valueIn(cardLast4Source, [
    "physical_card",
    "wallet_device",
    "bank_record",
    "unknown",
  ]);
  const provenance = valueIn(cardLast4Provenance, [
    "physical_card",
    "wallet_device_token",
  ]);
  const device = valueIn(walletDeviceKind, ["phone", "watch", "unknown"]);

  if (
    interaction === "phone_watch_wallet" ||
    source === "wallet_device" ||
    provenance === "wallet_device_token"
  ) {
    return device === "phone"
      ? "customer_phone_wallet_token"
      : device === "watch"
      ? "customer_watch_wallet_token"
      : "customer_wallet_device_token";
  }
  if (source === "bank_record") return "customer_bank_record_identifier";
  if (source === "physical_card" || provenance === "physical_card") {
    if (interaction === "swipe_card") return "customer_physical_swipe_pan";
    if (interaction === "insert_card") {
      return "customer_physical_contact_chip_pan";
    }
    if (interaction === "tap_card") return "customer_physical_contactless_pan";
    return "customer_physical_card_interface_unknown";
  }
  return "customer_identifier_unknown";
};

export const classifyProviderIdentifier = (recognitionMethod) => ({
  swipe: "last_sales_swipe_identifier_unverified",
  chip: "last_sales_chip_identifier_unverified",
  contactless: "last_sales_contactless_identifier_unverified",
  wallet: "last_sales_wallet_identifier_unverified",
  present: "last_sales_present_identifier_unverified",
}[recognitionMethod] ?? "last_sales_identifier_unknown");

const differentIdentifierScope = (
  customerCredentialClass,
  providerRecognitionMethod,
) =>
  customerCredentialClass.includes("wallet") ||
  customerCredentialClass === "customer_bank_record_identifier" ||
  customerCredentialClass === "customer_identifier_unknown" ||
  customerCredentialClass === "customer_physical_contactless_pan" ||
  ["wallet", "contactless", ""].includes(providerRecognitionMethod);

const compareLastFour = ({
  customerLast4,
  providerLast4,
  customerCredentialClass,
  providerRecognitionMethod,
}) => {
  if (!customerLast4 || !providerLast4) return "missing";
  if (customerLast4 === providerLast4) return "exact_support";
  return differentIdentifierScope(
      customerCredentialClass,
      providerRecognitionMethod,
    )
    ? "mismatch_neutral_unproven_scope"
    : "mismatch_negative_unproven_equivalence";
};

const compareNetwork = (
  {
    customerNetwork,
    providerNetwork,
    customerCredentialClass,
    providerRecognitionMethod,
  },
) => {
  if (
    !customerNetwork || customerNetwork === "other_unknown" || !providerNetwork
  ) return "missing";
  if (customerNetwork === providerNetwork) return "exact_support";
  return differentIdentifierScope(
      customerCredentialClass,
      providerRecognitionMethod,
    )
    ? "mismatch_neutral_unproven_scope"
    : "mismatch_negative_unproven_equivalence";
};

const compareInteraction = (paymentInteraction, providerRecognitionMethod) => {
  if (
    !paymentInteraction || paymentInteraction === "unsure" ||
    !providerRecognitionMethod
  ) return "unknown";
  if (
    (paymentInteraction === "swipe_card" &&
      providerRecognitionMethod === "swipe") ||
    (paymentInteraction === "insert_card" &&
      providerRecognitionMethod === "chip") ||
    (paymentInteraction === "tap_card" &&
      providerRecognitionMethod === "contactless") ||
    (paymentInteraction === "insert_or_swipe" &&
      ["chip", "swipe"].includes(providerRecognitionMethod)) ||
    (paymentInteraction === "phone_watch_wallet" &&
      ["wallet", "contactless"].includes(providerRecognitionMethod))
  ) return "supporting";
  if (providerRecognitionMethod === "present") return "unknown";
  return "conflict_unverified_provider_semantics";
};

/**
 * @param {{
 *   customerLast4?: string | null,
 *   providerLast4?: string | null,
 *   paymentInteraction?: string | null,
 *   cardLast4Source?: string | null,
 *   cardLast4Provenance?: string | null,
 *   walletDeviceKind?: string | null,
 *   customerNetwork?: string | null,
 *   providerNetwork?: string | null,
 *   providerRecognitionMethod?: string | null,
 * }} input
 */
export const classifyNayaxIdentifierEvidence = ({
  customerLast4 = null,
  providerLast4 = null,
  paymentInteraction = null,
  cardLast4Source = null,
  cardLast4Provenance = null,
  walletDeviceKind = null,
  customerNetwork = null,
  providerNetwork = null,
  providerRecognitionMethod = null,
}) => {
  const customerCredentialClass = classifyCustomerCredential({
    paymentInteraction,
    cardLast4Source,
    cardLast4Provenance,
    walletDeviceKind,
  });
  const providerIdentifierClass = classifyProviderIdentifier(
    providerRecognitionMethod,
  );
  return {
    policyVersion: NAYAX_IDENTIFIER_POLICY_VERSION,
    customerCredentialClass,
    providerIdentifierClass,
    cardLast4Comparison: compareLastFour({
      customerLast4,
      providerLast4,
      customerCredentialClass,
      providerRecognitionMethod,
    }),
    cardNetworkComparison: compareNetwork({
      customerNetwork,
      providerNetwork,
      customerCredentialClass,
      providerRecognitionMethod,
    }),
    paymentInteractionComparison: compareInteraction(
      paymentInteraction,
      providerRecognitionMethod,
    ),
    sameIdentifierEquivalenceProven: false,
  };
};
