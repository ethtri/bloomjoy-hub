export type RefundEmailFactExtraction = {
  locationOrMachine: string | null;
  incidentDate: string | null;
  incidentTime: string | null;
  paymentMethod: "card" | "cash" | null;
  cardWalletUsed: boolean | null;
  amountCents: number | null;
  cardLast4: string | null;
  manualReviewReason: "sensitive_or_escalated_content" | null;
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
  ["amount", "amount"],
  ["card last four", "cardLast4"],
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
    return { paymentMethod: "cash" as const, cardWalletUsed: false };
  }
  if (
    ["apple pay", "google pay", "mobile wallet", "wallet"].includes(normalized)
  ) {
    return { paymentMethod: "card" as const, cardWalletUsed: true };
  }
  if (["card", "credit card", "debit card", "tap card"].includes(normalized)) {
    return { paymentMethod: "card" as const, cardWalletUsed: false };
  }
  return { paymentMethod: null, cardWalletUsed: null };
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

export const extractLabeledRefundEmailFacts = (
  body: string,
): RefundEmailFactExtraction => {
  const reply = currentReplyOnly(body).slice(0, 10_000);
  const values = new Map<string, string>();
  for (const line of reply.split("\n")) {
    const match = line.match(/^\s*([^:]{2,60})\s*:\s*(.*?)\s*$/);
    if (!match) continue;
    const key = labelAliases.get(
      clean(match[1], 60).toLowerCase().replace(/\s*\([^)]*\)\s*$/, ""),
    );
    if (key && clean(match[2])) values.set(key, clean(match[2]));
  }
  const payment = paymentFacts(values.get("paymentMethod") ?? "");
  const last4 = values.get("cardLast4") ?? "";
  return {
    locationOrMachine: clean(values.get("locationOrMachine") ?? "") || null,
    incidentDate: validDate(values.get("incidentDate") ?? ""),
    incidentTime: normalizedTime(values.get("incidentTime") ?? ""),
    paymentMethod: payment.paymentMethod,
    cardWalletUsed: payment.cardWalletUsed,
    amountCents: amountCents(values.get("amount") ?? ""),
    cardLast4: payment.cardWalletUsed !== true && /^\d{4}$/.test(last4)
      ? last4
      : null,
    manualReviewReason: manualReviewPattern.test(reply)
      ? "sensitive_or_escalated_content"
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
