export type RefundEmailFactExtraction = {
  locationOrMachine: string | null;
  incidentDate: string | null;
  incidentTime: string | null;
  paymentMethod: "card" | "cash" | null;
  cardWalletUsed: boolean | null;
  paymentInteraction:
    | "phone_watch_wallet"
    | "tap_card"
    | "insert_or_swipe"
    | "cash"
    | "unsure"
    | null;
  walletProvider: "apple_pay" | "google_wallet" | "other" | "unsure" | null;
  amountCents: number | null;
  cardLast4: string | null;
  cardLast4Provenance: "physical_card" | "wallet_device_token" | null;
  cardNetwork:
    | "visa"
    | "mastercard"
    | "discover"
    | "american_express"
    | "other_unknown"
    | null;
  zellePaymentContact: string | null;
  ambiguousFields: string[];
  manualReviewReason:
    | "sensitive_or_escalated_content"
    | "ambiguous_customer_facts"
    | null;
};

export type RefundMachineFactCandidate = {
  machineId: string;
  locationId: string;
  timezone: string;
  machineLabel: string;
  publicMachineLabel?: string | null;
  locationName: string;
};

const labelAliases = new Map([
  ["machine or location", "locationOrMachine"],
  ["purchase date", "incidentDate"],
  ["approximate purchase time", "incidentTime"],
  ["payment method", "paymentMethod"],
  ["payment interaction", "paymentInteraction"],
  ["wallet provider", "walletProvider"],
  ["amount", "amount"],
  ["card last four", "cardLast4"],
  ["card last four source", "cardLast4Provenance"],
  ["card type", "cardNetwork"],
  ["zelle email or phone number", "zellePaymentContact"],
  ["correo electrónico o número de teléfono de zelle", "zellePaymentContact"],
]);

const manualReviewPattern =
  /\b(attorney|lawyer|lawsuit|legal action|regulator|chargeback|charge back|bank dispute|injury|injured|hospital|fire|burned|burnt|electric shock|unsafe|medical|threat|threaten|kill|hurt you|password|security code|cvv|pin)\b/i;

const clean = (value: string, maxLength = 160) =>
  value.replace(/\s+/g, " ").trim().slice(0, maxLength);

const currentReplyOnly = (body: string) => {
  const lines = body.replace(/\r\n?/g, "\n").split("\n");
  const boundary = lines.findIndex((line) =>
    /^\s*(on .+wrote:|from:|-----original message-----)/i.test(line)
  );
  return lines.slice(0, boundary >= 0 ? boundary : lines.length).join("\n");
};

const validDate = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 &&
      date.getUTCDate() === day
    ? value
    : null;
};

const normalizedTime = (value: string) => {
  const match = value.trim().match(/^(\d{1,2}):(\d{2})(?:\s*([ap])\.?m\.?)?$/i);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2]);
  const meridiem = match[3]?.toLowerCase();
  if (minute > 59 || (meridiem ? hour < 1 || hour > 12 : hour > 23)) {
    return null;
  }
  if (meridiem === "a" && hour === 12) hour = 0;
  if (meridiem === "p" && hour !== 12) hour += 12;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
};

const paymentFacts = (value: string) => {
  const normalized = clean(value, 80).toLowerCase();
  if (["cash"].includes(normalized)) {
    return {
      paymentMethod: "cash" as const,
      cardWalletUsed: false,
      paymentInteraction: "cash" as const,
      walletProvider: null,
    };
  }
  if (
    [
      "apple pay",
      "google pay",
      "google wallet",
      "mobile wallet",
      "phone wallet",
      "watch wallet",
      "wallet",
    ].includes(normalized)
  ) {
    return {
      paymentMethod: "card" as const,
      cardWalletUsed: true,
      paymentInteraction: "phone_watch_wallet" as const,
      walletProvider: normalized === "apple pay"
        ? "apple_pay" as const
        : ["google pay", "google wallet"].includes(normalized)
        ? "google_wallet" as const
        : null,
    };
  }
  if (["tap card", "tapped card", "tapped a card"].includes(normalized)) {
    return {
      paymentMethod: "card" as const,
      cardWalletUsed: false,
      paymentInteraction: "tap_card" as const,
      walletProvider: null,
    };
  }
  if (["insert card", "inserted card", "swipe card", "swiped card"].includes(normalized)) {
    return {
      paymentMethod: "card" as const,
      cardWalletUsed: false,
      paymentInteraction: "insert_or_swipe" as const,
      walletProvider: null,
    };
  }
  if (["card", "credit card", "debit card", "physical card"].includes(normalized)) {
    return {
      paymentMethod: "card" as const,
      cardWalletUsed: normalized === "physical card" ? false : null,
      paymentInteraction: null,
      walletProvider: null,
    };
  }
  return {
    paymentMethod: null,
    cardWalletUsed: null,
    paymentInteraction: null,
    walletProvider: null,
  };
};

const paymentInteraction = (value: string) => {
  const normalized = clean(value, 80).toLowerCase();
  if (["phone or watch wallet", "phone/watch wallet", "mobile wallet", "wallet"].includes(normalized)) {
    return "phone_watch_wallet" as const;
  }
  if (["tap card", "tapped card", "tapped a card", "tapped the card"].includes(normalized)) {
    return "tap_card" as const;
  }
  if (["insert or swipe", "inserted or swiped", "inserted card", "swiped card"].includes(normalized)) {
    return "insert_or_swipe" as const;
  }
  if (normalized === "cash") return "cash" as const;
  if (["unsure", "not sure", "unknown"].includes(normalized)) return "unsure" as const;
  return null;
};

const walletProvider = (value: string) => {
  const normalized = clean(value, 80).toLowerCase();
  if (["apple pay", "applepay"].includes(normalized)) return "apple_pay" as const;
  if (["google pay", "google wallet", "googlepay"].includes(normalized)) {
    return "google_wallet" as const;
  }
  if (["other", "other wallet", "another wallet"].includes(normalized)) return "other" as const;
  if (["unsure", "not sure", "unknown"].includes(normalized)) return "unsure" as const;
  return null;
};

const cardNetwork = (value: string) => {
  const normalized = clean(value, 80).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (normalized === "visa") return "visa" as const;
  if (["mastercard", "master card", "mc"].includes(normalized)) return "mastercard" as const;
  if (normalized === "discover") return "discover" as const;
  if (["american express", "amex"].includes(normalized)) return "american_express" as const;
  if (["other", "not sure", "unsure", "unknown", "other unknown"].includes(normalized)) {
    return "other_unknown" as const;
  }
  return null;
};

const cardLast4Provenance = (value: string) => {
  const normalized = clean(value, 80).toLowerCase();
  if (["physical card", "printed physical card", "card"].includes(normalized)) {
    return "physical_card" as const;
  }
  if (["wallet", "wallet device token", "device token", "virtual card"].includes(normalized)) {
    return "wallet_device_token" as const;
  }
  return null;
};

const amountCents = (value: string) => {
  const normalized = value.trim().replace(/^\$/, "").replaceAll(",", "");
  if (!/^\d{1,4}(?:\.\d{1,2})?$/.test(normalized)) return null;
  const [whole, fraction = ""] = normalized.split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(cents) && cents > 0 && cents <= 1_000_000
    ? cents
    : null;
};

const zellePaymentContact = (value: string) => {
  const normalized = clean(value, 320);
  if (/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/u.test(normalized)) {
    return normalized.toLowerCase();
  }
  const compactPhone = normalized.replace(/[\s().-]/gu, "");
  if (/^\+?[0-9]{10,15}$/u.test(compactPhone)) return normalized;
  return null;
};

export const extractLabeledRefundEmailFacts = (
  body: string,
): RefundEmailFactExtraction => {
  const reply = currentReplyOnly(body).slice(0, 10_000);
  const values = new Map<string, string>();
  const ambiguousFields = new Set<string>();
  for (const line of reply.split("\n")) {
    const match = line.match(/^\s*([^:]{2,120})\s*:\s*(.*?)\s*$/);
    if (!match) continue;
    const key = labelAliases.get(
      clean(match[1], 120).toLowerCase().replace(/\s*\([^)]*\)\s*$/, ""),
    );
    const value = clean(match[2]);
    if (!key || !value) continue;
    const previous = values.get(key);
    if (previous && previous.toLowerCase() !== value.toLowerCase()) {
      ambiguousFields.add(key);
      continue;
    }
    values.set(key, value);
  }
  const payment = paymentFacts(values.get("paymentMethod") ?? "");
  const explicitInteraction = paymentInteraction(values.get("paymentInteraction") ?? "");
  const explicitWalletProvider = walletProvider(values.get("walletProvider") ?? "");
  const explicitNetwork = cardNetwork(values.get("cardNetwork") ?? "");
  const explicitProvenance = cardLast4Provenance(values.get("cardLast4Provenance") ?? "");
  const explicitZellePaymentContact = zellePaymentContact(
    values.get("zellePaymentContact") ?? "",
  );
  if (values.has("paymentMethod") && payment.paymentMethod === null) ambiguousFields.add("paymentMethod");
  if (values.has("paymentInteraction") && explicitInteraction === null) ambiguousFields.add("paymentInteraction");
  if (values.has("walletProvider") && explicitWalletProvider === null) ambiguousFields.add("walletProvider");
  if (values.has("cardNetwork") && explicitNetwork === null) ambiguousFields.add("cardNetwork");
  if (values.has("cardLast4Provenance") && explicitProvenance === null) {
    ambiguousFields.add("cardLast4Provenance");
  }
  if (values.has("zellePaymentContact") && explicitZellePaymentContact === null) {
    ambiguousFields.add("zellePaymentContact");
  }

  let resolvedInteraction = explicitInteraction ?? payment.paymentInteraction;
  let resolvedWalletProvider = explicitWalletProvider ?? payment.walletProvider;
  if (resolvedWalletProvider && resolvedWalletProvider !== "unsure") {
    if (resolvedInteraction && resolvedInteraction !== "phone_watch_wallet") {
      ambiguousFields.add("walletProvider");
      ambiguousFields.add("paymentInteraction");
    } else {
      resolvedInteraction = "phone_watch_wallet";
    }
  }
  if (
    payment.paymentInteraction && explicitInteraction &&
    payment.paymentInteraction !== explicitInteraction
  ) {
    ambiguousFields.add("paymentMethod");
    ambiguousFields.add("paymentInteraction");
  }
  if (payment.paymentMethod === "cash" && resolvedInteraction !== "cash") {
    ambiguousFields.add("paymentMethod");
    ambiguousFields.add("paymentInteraction");
  }
  if (resolvedInteraction !== "phone_watch_wallet") resolvedWalletProvider = null;

  const last4 = values.get("cardLast4") ?? "";
  let resolvedProvenance = explicitProvenance;
  if (!resolvedProvenance && resolvedInteraction === "phone_watch_wallet") {
    resolvedProvenance = "wallet_device_token";
  }
  if (!resolvedProvenance && ["tap_card", "insert_or_swipe"].includes(resolvedInteraction ?? "")) {
    resolvedProvenance = "physical_card";
  }
  if (values.has("cardLast4") && !/^\d{4}$/.test(last4)) ambiguousFields.add("cardLast4");
  if (
    values.has("cardLast4") && /^\d{4}$/.test(last4) &&
    !resolvedProvenance
  ) {
    ambiguousFields.add("cardLast4Provenance");
  }
  const resolvedWalletUsed = resolvedInteraction === "phone_watch_wallet"
    ? true
    : ["tap_card", "insert_or_swipe"].includes(resolvedInteraction ?? "")
    ? false
    : resolvedProvenance === "physical_card"
    ? false
    : payment.cardWalletUsed;
  if (payment.paymentMethod === "cash" && (values.has("cardNetwork") || values.has("cardLast4"))) {
    ambiguousFields.add("paymentMethod");
  }
  const ambiguousFieldList = [...ambiguousFields].sort();
  return {
    locationOrMachine: clean(values.get("locationOrMachine") ?? "") || null,
    incidentDate: validDate(values.get("incidentDate") ?? ""),
    incidentTime: normalizedTime(values.get("incidentTime") ?? ""),
    paymentMethod: payment.paymentMethod,
    cardWalletUsed: resolvedWalletUsed,
    paymentInteraction: resolvedInteraction,
    walletProvider: resolvedWalletProvider,
    amountCents: amountCents(values.get("amount") ?? ""),
    cardLast4: resolvedWalletUsed !== true && resolvedProvenance === "physical_card" && /^\d{4}$/.test(last4)
      ? last4
      : null,
    cardLast4Provenance: resolvedProvenance,
    cardNetwork: explicitNetwork,
    zellePaymentContact: explicitZellePaymentContact,
    ambiguousFields: ambiguousFieldList,
    manualReviewReason: manualReviewPattern.test(reply)
      ? "sensitive_or_escalated_content"
      : ambiguousFieldList.length > 0
      ? "ambiguous_customer_facts"
      : null,
  };
};

const normalizedLabel = (value: string) => clean(value).toLowerCase();

export const resolveExactRefundMachineFact = (
  suppliedLabel: string,
  candidates: RefundMachineFactCandidate[],
) => {
  const requested = normalizedLabel(suppliedLabel);
  if (!requested) return null;
  const matches = candidates.filter((candidate) =>
    [
      candidate.machineLabel,
      candidate.publicMachineLabel ?? "",
      candidate.locationName,
    ]
      .some((label) => normalizedLabel(label) === requested)
  );
  return matches.length === 1 ? matches[0] : null;
};
