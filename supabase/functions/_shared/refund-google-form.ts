export const REFUND_GOOGLE_FORM_CONTRACT_VERSION = "2026-08-04.v1";

export const REFUND_GOOGLE_FORM_EXPECTED_HEADERS = [
  "Timestamp",
  "Your Name",
  "Email Address",
  "Location of Purchase",
  "Date and Time of Incident",
  "Incident Description",
  "Request Amount",
  "Payment Method",
  "Last 4 digits of the credit card used",
  "Refund Payment Preference",
  "Venmo/Zelle Payment ID",
] as const;

export type RefundGoogleFormPaymentMethod = "card" | "cash" | null;
export type RefundGoogleFormCashPreference = "venmo" | "zelle" | "no_refund_requested" | null;

export type RefundGoogleFormRow = {
  rowNumber: number;
  values: Record<string, unknown>;
};

export type NormalizedRefundGoogleFormResponse = {
  rowNumber: number;
  sourceSubmittedLocalDateTime: string | null;
  customerName: string;
  customerEmail: string;
  sourceLocation: string;
  incidentLocalDateTime: string | null;
  issueSummary: string;
  paymentAmountCents: number | null;
  paymentMethod: RefundGoogleFormPaymentMethod;
  cardLast4: string | null;
  cardWalletUsed: boolean;
  cashPaymentPreference: RefundGoogleFormCashPreference;
  cashPaymentContact: string | null;
  missingFields: string[];
  invalidFields: string[];
  fingerprintMaterial: string;
};

const HEADER_ALIASES: Record<string, string[]> = {
  timestamp: ["timestamp"],
  customer_name: ["your_name", "name", "customer_name"],
  customer_email: ["email_address", "email", "customer_email"],
  source_location: ["location_of_purchase", "location", "purchase_location"],
  incident_datetime: ["date_and_time_of_incident", "incident_date_and_time", "incident_datetime"],
  issue_summary: ["incident_description", "issue_description", "description"],
  payment_amount: ["request_amount", "refund_amount", "amount"],
  payment_method: ["payment_method"],
  card_last4: ["last_4_digits_of_the_credit_card_used", "last_4_digits", "card_last4"],
  cash_payment_preference: ["refund_payment_preference", "cash_refund_preference"],
  cash_payment_contact: ["venmo_zelle_payment_id", "venmo_or_zelle_payment_id", "payment_id"],
};

const cleanText = (value: unknown, maxLength: number) =>
  String(value ?? "")
    .replace(/[\p{Cc}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);

export const normalizeRefundGoogleFormHeader = (value: unknown) =>
  cleanText(value, 240)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

const pickValue = (values: Record<string, unknown>, aliases: string[]) => {
  for (const alias of aliases) {
    const value = values[alias];
    if (value !== undefined && value !== null && String(value).trim() !== "") return value;
  }
  return null;
};

const pad2 = (value: number) => String(value).padStart(2, "0");

const localDateTime = (
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second = 0,
) => {
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day ||
    date.getUTCHours() !== hour ||
    date.getUTCMinutes() !== minute ||
    date.getUTCSeconds() !== second
  ) return null;

  return `${year}-${pad2(month)}-${pad2(day)}T${pad2(hour)}:${pad2(minute)}:${pad2(second)}`;
};

export const parseRefundGoogleFormLocalDateTime = (value: unknown) => {
  if (typeof value === "number" && Number.isFinite(value)) {
    const milliseconds = Math.round((value - 25569) * 86400000);
    const date = new Date(milliseconds);
    if (!Number.isFinite(date.getTime())) return null;
    return localDateTime(
      date.getUTCFullYear(),
      date.getUTCMonth() + 1,
      date.getUTCDate(),
      date.getUTCHours(),
      date.getUTCMinutes(),
      date.getUTCSeconds(),
    );
  }

  const text = cleanText(value, 120);
  if (!text) return null;

  const isoMatch = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (isoMatch) {
    return localDateTime(
      Number(isoMatch[1]),
      Number(isoMatch[2]),
      Number(isoMatch[3]),
      Number(isoMatch[4]),
      Number(isoMatch[5]),
      Number(isoMatch[6] ?? 0),
    );
  }

  const usMatch = text.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*([ap]m))?$/i,
  );
  if (!usMatch) return null;

  let hour = Number(usMatch[4]);
  const meridiem = (usMatch[7] ?? "").toLowerCase();
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    if (meridiem === "am") hour = hour === 12 ? 0 : hour;
    if (meridiem === "pm") hour = hour === 12 ? 12 : hour + 12;
  }

  return localDateTime(
    Number(usMatch[3]),
    Number(usMatch[1]),
    Number(usMatch[2]),
    hour,
    Number(usMatch[5]),
    Number(usMatch[6] ?? 0),
  );
};

const normalizeEmail = (value: unknown) => cleanText(value, 320).toLowerCase();

const validEmail = (value: string) =>
  value.length >= 3 && value.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

const normalizePayment = (value: unknown) => {
  const normalized = cleanText(value, 80).toLowerCase();
  if (normalized === "card" || normalized === "credit card") {
    return { paymentMethod: "card" as const, cardWalletUsed: false };
  }
  if (
    normalized === "apple / google pay" ||
    normalized === "apple/google pay" ||
    normalized.includes("apple pay") ||
    normalized.includes("google pay") ||
    normalized.includes("mobile wallet")
  ) {
    return { paymentMethod: "card" as const, cardWalletUsed: true };
  }
  if (normalized === "cash") {
    return { paymentMethod: "cash" as const, cardWalletUsed: false };
  }
  return { paymentMethod: null, cardWalletUsed: false };
};

const normalizeCashPreference = (value: unknown): RefundGoogleFormCashPreference => {
  const normalized = cleanText(value, 80).toLowerCase();
  if (normalized === "venmo") return "venmo";
  if (normalized === "zelle") return "zelle";
  if (normalized === "no refund requested") return "no_refund_requested";
  return null;
};

const parseAmountCents = (value: unknown) => {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const normalized = typeof value === "number"
    ? value
    : Number(String(value).replace(/[$,\s]/g, ""));
  if (!Number.isFinite(normalized) || normalized < 0 || normalized > 100) return null;
  return Math.round((normalized + Number.EPSILON) * 100);
};

const normalizeLast4 = (value: unknown) => {
  const digits = cleanText(value, 32).replace(/\D/g, "");
  return digits.length === 4 ? digits : null;
};

export const refundGoogleFormValuesToRows = (values: unknown[][]) => {
  if (!Array.isArray(values) || values.length === 0) return [] as RefundGoogleFormRow[];
  const headers = (values[0] ?? []).map(normalizeRefundGoogleFormHeader);
  return values
    .slice(1)
    .map((cells, index) => ({
      rowNumber: index + 2,
      values: Object.fromEntries(
        headers.map((header, cellIndex) => [header, (cells ?? [])[cellIndex] ?? null]),
      ),
    }))
    .filter((row) => Object.values(row.values).some((value) => cleanText(value, 10) !== ""));
};

export const validateRefundGoogleFormHeaders = (values: unknown[][]) => {
  const normalizedHeaderList = (values[0] ?? [])
    .map(normalizeRefundGoogleFormHeader)
    .filter(Boolean);
  const normalizedHeaders = new Set(normalizedHeaderList);
  const expectedHeaders = new Set(REFUND_GOOGLE_FORM_EXPECTED_HEADERS.map(normalizeRefundGoogleFormHeader));
  const missingHeaders = REFUND_GOOGLE_FORM_EXPECTED_HEADERS
    .map(normalizeRefundGoogleFormHeader)
    .filter((header) => !normalizedHeaders.has(header));
  const unexpectedHeaders = [...normalizedHeaders].filter((header) => !expectedHeaders.has(header));
  const duplicateHeaders = [...normalizedHeaders].filter(
    (header) => normalizedHeaderList.filter((candidate) => candidate === header).length > 1,
  );
  return {
    valid: missingHeaders.length === 0 && unexpectedHeaders.length === 0 && duplicateHeaders.length === 0,
    missingHeaders,
    unexpectedHeaders,
    duplicateHeaders,
  };
};

export const normalizeRefundGoogleFormResponse = (
  row: RefundGoogleFormRow,
): NormalizedRefundGoogleFormResponse => {
  const valueFor = (key: keyof typeof HEADER_ALIASES) => pickValue(row.values, HEADER_ALIASES[key]);
  const customerName = cleanText(valueFor("customer_name"), 160);
  const customerEmail = normalizeEmail(valueFor("customer_email"));
  const sourceLocation = cleanText(valueFor("source_location"), 240);
  const issueSummary = cleanText(valueFor("issue_summary"), 4000);
  const sourceSubmittedLocalDateTime = parseRefundGoogleFormLocalDateTime(valueFor("timestamp"));
  const incidentLocalDateTime = parseRefundGoogleFormLocalDateTime(valueFor("incident_datetime"));
  const payment = normalizePayment(valueFor("payment_method"));
  const rawAmount = valueFor("payment_amount");
  const paymentAmountCents = parseAmountCents(rawAmount);
  const rawLast4 = valueFor("card_last4");
  const cardLast4 = normalizeLast4(rawLast4);
  const cashPaymentPreference = normalizeCashPreference(valueFor("cash_payment_preference"));
  const cashPaymentContact = cleanText(valueFor("cash_payment_contact"), 320) || null;
  const missingFields: string[] = [];
  const invalidFields: string[] = [];

  if (!customerName) missingFields.push("customer_name");
  if (!customerEmail) missingFields.push("customer_email");
  else if (!validEmail(customerEmail)) invalidFields.push("customer_email");
  if (!sourceLocation) missingFields.push("location");
  if (!issueSummary) missingFields.push("issue_summary");
  if (!sourceSubmittedLocalDateTime) invalidFields.push("source_timestamp");
  if (!incidentLocalDateTime) missingFields.push("incident_datetime");
  if (!payment.paymentMethod) missingFields.push("payment_method");
  if (rawAmount === null || rawAmount === undefined || String(rawAmount).trim() === "") {
    missingFields.push("payment_amount");
  } else if (paymentAmountCents === null) {
    invalidFields.push("payment_amount");
  }
  if (payment.paymentMethod === "card" && !cardLast4) {
    if (rawLast4 === null || rawLast4 === undefined || String(rawLast4).trim() === "") {
      missingFields.push("card_last4");
    } else {
      invalidFields.push("card_last4");
    }
  }
  if (payment.paymentMethod === "cash") {
    if (!cashPaymentPreference) missingFields.push("cash_payment_preference");
    if (cashPaymentPreference !== "no_refund_requested" && !cashPaymentContact) {
      missingFields.push("cash_payment_contact");
    }
  }

  const fingerprintMaterial = JSON.stringify({
    sourceSubmittedLocalDateTime,
    customerEmail,
    customerName,
    sourceLocation,
    incidentLocalDateTime,
    issueSummary,
    paymentAmountCents,
    paymentMethod: payment.paymentMethod,
    cardLast4,
    cardWalletUsed: payment.cardWalletUsed,
    cashPaymentPreference,
    cashPaymentContact,
  });

  return {
    rowNumber: row.rowNumber,
    sourceSubmittedLocalDateTime,
    customerName,
    customerEmail,
    sourceLocation,
    incidentLocalDateTime,
    issueSummary,
    paymentAmountCents,
    paymentMethod: payment.paymentMethod,
    cardLast4,
    cardWalletUsed: payment.cardWalletUsed,
    cashPaymentPreference,
    cashPaymentContact,
    missingFields: [...new Set(missingFields)].sort(),
    invalidFields: [...new Set(invalidFields)].sort(),
    fingerprintMaterial,
  };
};
