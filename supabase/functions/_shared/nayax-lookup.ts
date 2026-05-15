const defaultNayaxBaseUrl = "https://lynx.nayax.com/operational/v1";
const defaultNayaxAccountKey = "TGPACI_USA_DB";
const defaultLookupWindowHours = 6;
const defaultCandidateTtlHours = 24;

type SupabaseServiceClient = {
  from: (table: string) => {
    select: (columns: string) => unknown;
    delete: () => unknown;
    insert: (rows: unknown[]) => unknown;
  };
};

const sanitizeText = (value: unknown, maxLength = 300) =>
  typeof value === "string" || typeof value === "number" || typeof value === "boolean"
    ? String(value).trim().slice(0, maxLength)
    : "";

const normalizeCardBrand = (value: unknown) => {
  const normalized = sanitizeText(value, 80).toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  if (normalized.includes("visa")) return "Visa";
  if (normalized.includes("mastercard") || normalized.includes("master card") || normalized === "mc") return "Mastercard";
  if (normalized.includes("american express") || normalized.includes("amex")) return "American Express";
  if (normalized.includes("discover")) return "Discover";
  if (normalized.includes("debit")) return "Debit card";
  if (normalized.includes("credit")) return "Credit card";
  return "Card";
};

const normalizeRecognitionMethod = (value: unknown) => {
  const normalized = sanitizeText(value, 80).toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  if (normalized.includes("apple") || normalized.includes("google") || normalized.includes("wallet")) return "wallet";
  if (normalized.includes("contactless") || normalized.includes("tap")) return "contactless";
  if (normalized.includes("chip") || normalized.includes("emv")) return "chip";
  if (normalized.includes("swipe") || normalized.includes("mag")) return "swipe";
  return "present";
};

const normalizePaymentStatus = (value: unknown) => {
  const normalized = sanitizeText(value, 80).toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  if (["approved", "paid", "success", "successful", "completed", "settled", "sale"].some((token) => normalized.includes(token))) {
    return "approved";
  }
  if (["declined", "denied", "failed", "cancel", "void"].some((token) => normalized.includes(token))) {
    return "not approved";
  }
  return "recorded";
};

const parseNumberEnv = (value: string | undefined | null, fallback: number, minimum: number, maximum: number) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, parsed));
};

export const getNayaxBaseUrl = () =>
  (Deno.env.get("NAYAX_LYNX_BASE_URL") || defaultNayaxBaseUrl).replace(/\/+$/, "");

export const getNayaxLookupWindowHours = () =>
  parseNumberEnv(Deno.env.get("NAYAX_LOOKUP_WINDOW_HOURS"), defaultLookupWindowHours, 1, 24);

const getNayaxCandidateTtlHours = () =>
  parseNumberEnv(Deno.env.get("REFUND_NAYAX_CANDIDATE_TTL_HOURS"), defaultCandidateTtlHours, 1, 72);

export class NayaxLookupRequestError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "NayaxLookupRequestError";
    this.status = status;
  }
}

const parseIncidentAt = (value: unknown) => {
  const raw = sanitizeText(value, 80);
  const date = raw ? new Date(raw) : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
};

const sanitizeInputCents = (value: unknown) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? Math.round(numeric) : null;
};

const moneyToCents = (value: unknown) => {
  if (value === null || typeof value === "undefined") return null;

  const numeric = typeof value === "string"
    ? Number(value.replace(/[$,\s]/g, ""))
    : Number(value);

  return Number.isFinite(numeric) && numeric >= 0 ? Math.round(numeric * 100) : null;
};

const integerValue = (value: unknown) => {
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric >= 0 ? numeric : null;
};

const parseDateValue = (value: unknown) => {
  const raw = sanitizeText(value, 120);
  if (!raw) return null;

  const parseCandidates = [raw];
  if (
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(raw) &&
    !/[zZ]$/.test(raw)
  ) {
    parseCandidates.unshift(`${raw}Z`);
  }

  for (const candidate of parseCandidates) {
    const date = new Date(candidate);
    if (!Number.isNaN(date.getTime())) return date;
  }

  return null;
};

const extractLast4 = (value: unknown) => {
  const digits = sanitizeText(value, 80).replace(/\D/g, "");
  return digits.length >= 4 ? digits.slice(-4) : "";
};

const normalizeAccountKey = (value: unknown) => {
  const raw = sanitizeText(value, 80) || defaultNayaxAccountKey;
  const normalized = raw.toUpperCase().replace(/[^A-Z0-9_]/g, "_");
  return normalized || defaultNayaxAccountKey;
};

const resolveNayaxToken = (accountKey: string) =>
  Deno.env.get(`NAYAX_LYNX_API_TOKEN_${normalizeAccountKey(accountKey)}`) ||
  Deno.env.get("NAYAX_LYNX_API_TOKEN_TGPACI_USA_DB") ||
  Deno.env.get("NAYAX_LYNX_API_TOKEN") ||
  "";

export type NayaxProviderCandidate = {
  transactionId: string;
  siteId: number | null;
  authorizedAt: string;
  machineAuthorizationTime: string;
  amountCents: number | null;
  currencyCode: string;
  cardLast4: string;
  cardBrand: string;
  recognitionMethod: string;
  paymentStatus: string;
  matchConfidence: number;
  matchReason: string;
};

export type NayaxResponseCandidate = Omit<NayaxProviderCandidate, "transactionId" | "siteId"> & {
  candidateToken: string;
};

export type NayaxLookupResult = {
  configured: boolean;
  lookupStatus: "match_found" | "multiple_matches" | "no_match" | "setup_needed" | "lookup_failed";
  lastCheckedAt: string;
  message?: string;
  providerRecordCount?: number;
  providerParseableRecordCount?: number;
  providerWindowRecordCount?: number;
  candidateCount: number;
  candidates: NayaxResponseCandidate[];
  windowHours: number;
  summary: string;
  recommendedAction: string;
  refundCase?: {
    id: string;
    publicReference: string;
    status: string;
    customerEmail: string;
    customerName: string | null;
    paymentMethod: string;
    paymentAmountCents: number | null;
    refundAmountCents: number | null;
    machineLabel: string | null;
    locationName: string | null;
  };
};

export const extractNayaxRecords = (payload: unknown): unknown[] => {
  if (Array.isArray(payload)) return payload;

  const record = typeof payload === "object" && payload !== null
    ? payload as Record<string, unknown>
    : {};

  for (const key of ["data", "Data", "sales", "Sales", "result", "Result", "records", "Records"]) {
    const value = record[key];
    if (Array.isArray(value)) return value;
  }

  return [];
};

const normalizeNayaxSales = ({
  payload,
  requestAmountCents,
  requestCardLast4,
  cardWalletUsed,
  windowStart,
  windowEnd,
  windowHours,
}: {
  payload: unknown;
  requestAmountCents: number | null;
  requestCardLast4: string;
  cardWalletUsed: boolean;
  windowStart: Date;
  windowEnd: Date;
  windowHours: number;
}): NayaxProviderCandidate[] => {
  const records = extractNayaxRecords(payload);

  return records
    .map((item) => {
      const record = typeof item === "object" && item !== null
        ? item as Record<string, unknown>
        : {};

      const transactionId = sanitizeText(
        record.TransactionID ??
          record.TransactionId ??
          record.transactionId ??
          record.transaction_id,
        80
      );
      const authorizationDate =
        parseDateValue(record.AuthorizationDateTimeGMT ?? record.AuthorizationDateTimeGmt) ??
        parseDateValue(record.MachineAuthorizationTime);
      const machineAuthorizationDate = parseDateValue(record.MachineAuthorizationTime) ?? authorizationDate;

      if (!transactionId || !authorizationDate) {
        return null;
      }

      if (authorizationDate < windowStart || authorizationDate > windowEnd) {
        return null;
      }

      const amountCents = moneyToCents(record.AuthorizationValue ?? record.SettlementValue);
      const cardLast4 = extractLast4(record.CardNumber ?? record.cardNumber);
      const amountMatches =
        requestAmountCents === null || amountCents === null || requestAmountCents === amountCents;
      const last4Matches =
        !requestCardLast4 || !cardLast4 || requestCardLast4 === cardLast4;
      const walletLast4Mismatch =
        Boolean(requestCardLast4 && cardLast4 && requestCardLast4 !== cardLast4 && cardWalletUsed);

      let matchConfidence = 0.72;
      const reasons = ["same Nayax machine", `+/- ${windowHours} hour incident window`];

      if (amountMatches && requestAmountCents !== null && amountCents !== null) {
        matchConfidence += 0.12;
        reasons.push("amount matches");
      } else if (requestAmountCents !== null && amountCents !== null) {
        matchConfidence -= 0.18;
        reasons.push("amount differs");
      }

      if (last4Matches && requestCardLast4 && cardLast4) {
        matchConfidence += 0.16;
        reasons.push("last 4 matches");
      } else if (walletLast4Mismatch) {
        matchConfidence -= 0.05;
        reasons.push("wallet last 4 differs");
      } else if (requestCardLast4 && cardLast4) {
        matchConfidence -= 0.25;
        reasons.push("last 4 differs");
      }

      return {
        transactionId,
        siteId: integerValue(record.SiteID ?? record.SiteId ?? record.siteId),
        authorizedAt: authorizationDate.toISOString(),
        machineAuthorizationTime: machineAuthorizationDate?.toISOString() ?? authorizationDate.toISOString(),
        amountCents,
        currencyCode: sanitizeText(record.CurrencyCode ?? record.currencyCode, 3).toUpperCase(),
        cardLast4,
        cardBrand: normalizeCardBrand(record.CardBrand ?? record.cardBrand),
        recognitionMethod: normalizeRecognitionMethod(record.RecognitionMethod ?? record.recognitionMethod),
        paymentStatus: normalizePaymentStatus(record.PaymentMethod ?? record.Status ?? record.status),
        matchConfidence: Math.max(0, Math.min(0.99, Number(matchConfidence.toFixed(2)))),
        matchReason: reasons.join("; "),
      };
    })
    .filter((candidate): candidate is NayaxProviderCandidate => Boolean(candidate))
    .sort((left, right) => right.matchConfidence - left.matchConfidence)
    .slice(0, 10);
};

const summarizeNayaxRecords = ({
  payload,
  windowStart,
  windowEnd,
}: {
  payload: unknown;
  windowStart: Date;
  windowEnd: Date;
}) => {
  let parseableRecordCount = 0;
  let windowRecordCount = 0;

  for (const item of extractNayaxRecords(payload)) {
    const record = typeof item === "object" && item !== null
      ? item as Record<string, unknown>
      : {};
    const transactionId = sanitizeText(
      record.TransactionID ??
        record.TransactionId ??
        record.transactionId ??
        record.transaction_id,
      80
    );
    const authorizationDate =
      parseDateValue(record.AuthorizationDateTimeGMT ?? record.AuthorizationDateTimeGmt) ??
      parseDateValue(record.MachineAuthorizationTime);

    if (!transactionId || !authorizationDate) continue;

    parseableRecordCount += 1;
    if (authorizationDate >= windowStart && authorizationDate <= windowEnd) {
      windowRecordCount += 1;
    }
  }

  return {
    parseableRecordCount,
    windowRecordCount,
  };
};

const persistNayaxLookupCandidates = async ({
  supabase,
  caseId,
  actorUserId,
  candidates,
}: {
  supabase: SupabaseServiceClient;
  caseId: string;
  actorUserId: string | null;
  candidates: NayaxProviderCandidate[];
}): Promise<NayaxResponseCandidate[]> => {
  const nowIso = new Date().toISOString();
  const expiresAt = new Date(Date.now() + getNayaxCandidateTtlHours() * 60 * 60 * 1000).toISOString();

  const { error: cleanupError } = await ((supabase.from("refund_nayax_lookup_candidates").delete() as {
    lt: (column: string, value: string) => Promise<{ error?: Error | null }>;
  }).lt("expires_at", nowIso));

  if (cleanupError) {
    throw cleanupError;
  }

  const { error: caseClearError } = await ((supabase.from("refund_nayax_lookup_candidates").delete() as {
    eq: (column: string, value: string) => Promise<{ error?: Error | null }>;
  }).eq("refund_case_id", caseId));

  if (caseClearError) {
    throw caseClearError;
  }

  if (candidates.length === 0) return [];

  const tokenizedCandidates = candidates.map((candidate) => ({
    token: crypto.randomUUID(),
    candidate,
  }));

  const { error } = await (supabase.from("refund_nayax_lookup_candidates").insert(
    tokenizedCandidates.map(({ token, candidate }) => ({
      token,
      refund_case_id: caseId,
      actor_user_id: actorUserId,
      provider_transaction_id: candidate.transactionId,
      site_id: candidate.siteId,
      machine_authorization_time: candidate.machineAuthorizationTime,
      amount_cents: candidate.amountCents,
      card_last4: candidate.cardLast4 || null,
      currency_code: candidate.currencyCode || null,
      evidence_summary: {
        match_confidence: candidate.matchConfidence,
        match_reason: candidate.matchReason,
        card_brand: candidate.cardBrand || null,
        recognition_method: candidate.recognitionMethod || null,
        payment_status: candidate.paymentStatus || null,
        card_brand_present: Boolean(candidate.cardBrand),
        recognition_method_present: Boolean(candidate.recognitionMethod),
        payment_status_present: Boolean(candidate.paymentStatus),
        provider_payload_redacted: true,
      },
      expires_at: expiresAt,
    })),
  ) as Promise<{ error?: Error | null }>);

  if (error) {
    throw error;
  }

  return tokenizedCandidates.map(({ token, candidate }) => ({
    candidateToken: token,
    authorizedAt: candidate.authorizedAt,
    machineAuthorizationTime: candidate.machineAuthorizationTime,
    amountCents: candidate.amountCents,
    currencyCode: candidate.currencyCode,
    cardLast4: candidate.cardLast4,
    cardBrand: candidate.cardBrand,
    recognitionMethod: candidate.recognitionMethod,
    paymentStatus: candidate.paymentStatus,
    matchConfidence: candidate.matchConfidence,
    matchReason: candidate.matchReason,
  }));
};

export const lookupNayaxCandidatesForRefundCase = async ({
  supabase,
  caseId,
  actorUserId,
  nayaxBaseUrl = getNayaxBaseUrl(),
  windowHours = getNayaxLookupWindowHours(),
}: {
  supabase: SupabaseServiceClient;
  caseId: string;
  actorUserId: string | null;
  nayaxBaseUrl?: string;
  windowHours?: number;
}): Promise<NayaxLookupResult> => {
  const lastCheckedAt = new Date().toISOString();
  const { data: refundCase, error: refundCaseError } = await (supabase
    .from("refund_cases")
    .select(
      `
        id,
        public_reference,
        status,
        reporting_machine_id,
        reporting_location_id,
        incident_at,
        payment_method,
        payment_amount_cents,
        refund_amount_cents,
        card_last4,
        card_wallet_used,
        customer_email,
        customer_name
      `,
    ) as {
      eq: (column: string, value: string) => {
        maybeSingle: () => Promise<{ data?: Record<string, unknown> | null; error?: Error | null }>;
      };
    }).eq("id", caseId).maybeSingle();

  if (refundCaseError) throw refundCaseError;

  if (refundCase?.payment_method !== "card") {
    throw new NayaxLookupRequestError("Nayax lookup is only available for card refund cases.", 400);
  }

  const incidentAt = parseIncidentAt(refundCase?.incident_at);
  const amountCents = sanitizeInputCents(refundCase?.payment_amount_cents);
  const cardLast4 = extractLast4(refundCase?.card_last4);
  const cardWalletUsed = Boolean(refundCase?.card_wallet_used);

  if (!incidentAt) {
    throw new NayaxLookupRequestError("Refund case incident time is required.", 400);
  }

  const machineId = sanitizeText(refundCase?.reporting_machine_id, 80);
  if (!machineId) {
    throw new NayaxLookupRequestError("Refund case machine is not available.", 400);
  }

  const { data: machine, error: machineError } = await (supabase
    .from("reporting_machines")
    .select("id, machine_label, nayax_machine_id, nayax_account_key") as {
      eq: (column: string, value: string) => {
        maybeSingle: () => Promise<{ data?: Record<string, unknown> | null; error?: Error | null }>;
      };
    }).eq("id", machineId).maybeSingle();

  if (machineError) throw machineError;

  const { data: location, error: locationError } = await (supabase
    .from("reporting_locations")
    .select("id, name") as {
      eq: (column: string, value: string) => {
        maybeSingle: () => Promise<{ data?: Record<string, unknown> | null; error?: Error | null }>;
      };
    }).eq("id", sanitizeText(refundCase?.reporting_location_id, 80)).maybeSingle();

  if (locationError) throw locationError;

  const caseSnapshot = {
    id: sanitizeText(refundCase.id, 80),
    publicReference: sanitizeText(refundCase.public_reference, 80),
    status: sanitizeText(refundCase.status, 80),
    customerEmail: sanitizeText(refundCase.customer_email, 320),
    customerName: sanitizeText(refundCase.customer_name, 160) || null,
    paymentMethod: sanitizeText(refundCase.payment_method, 40),
    paymentAmountCents: sanitizeInputCents(refundCase.payment_amount_cents),
    refundAmountCents: sanitizeInputCents(refundCase.refund_amount_cents),
    machineLabel: sanitizeText(machine?.machine_label, 180) || null,
    locationName: sanitizeText(location?.name, 180) || null,
  };

  const nayaxMachineId = sanitizeText(machine?.nayax_machine_id, 120);
  const accountKey = normalizeAccountKey(machine?.nayax_account_key);
  const nayaxApiToken = resolveNayaxToken(accountKey);

  if (!nayaxMachineId) {
    return {
      configured: false,
      lookupStatus: "setup_needed",
      lastCheckedAt,
      candidates: [],
      candidateCount: 0,
      windowHours,
      refundCase: caseSnapshot,
      message: "This machine needs a Nayax machine ID before card lookup can run.",
      summary: "Setup needed before Nayax can check this card refund.",
      recommendedAction: "Ask an admin to add the Nayax machine ID in Admin > Machines before deciding this card case.",
    };
  }

  if (!nayaxApiToken) {
    return {
      configured: false,
      lookupStatus: "setup_needed",
      lastCheckedAt,
      candidates: [],
      candidateCount: 0,
      windowHours,
      refundCase: caseSnapshot,
      message: "Nayax Lynx lookup is waiting on a server-only API token for this account.",
      summary: "Setup needed before Nayax can check this card refund.",
      recommendedAction: "Ask an admin to verify the server-only Nayax token before deciding this card case.",
    };
  }

  const lookupWindowMs = windowHours * 60 * 60 * 1000;
  const windowStart = new Date(incidentAt.getTime() - lookupWindowMs);
  const windowEnd = new Date(incidentAt.getTime() + lookupWindowMs);
  const response = await fetch(
    `${nayaxBaseUrl}/machines/${encodeURIComponent(nayaxMachineId)}/lastSales`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${nayaxApiToken}`,
        "Content-Type": "application/json",
      },
    },
  );

  if (!response.ok) {
    console.warn("nayax lookup provider failure", {
      status: response.status,
      statusText: sanitizeText(response.statusText, 80) || "provider_error",
      accountKey,
    });
    throw new NayaxLookupRequestError("Unable to look up Nayax transactions.", 502);
  }

  const nayaxPayload = await response.json();
  const providerRecordCount = extractNayaxRecords(nayaxPayload).length;
  const providerSummary = summarizeNayaxRecords({
    payload: nayaxPayload,
    windowStart,
    windowEnd,
  });
  const providerCandidates = normalizeNayaxSales({
    payload: nayaxPayload,
    requestAmountCents: amountCents,
    requestCardLast4: cardLast4,
    cardWalletUsed,
    windowStart,
    windowEnd,
    windowHours,
  });
  const candidates = await persistNayaxLookupCandidates({
    supabase,
    caseId,
    actorUserId,
    candidates: providerCandidates,
  });
  const lookupStatus = candidates.length > 1
    ? "multiple_matches"
    : candidates.length === 1
      ? "match_found"
      : "no_match";
  const summary = candidates.length > 0
    ? `Nayax found ${candidates.length} possible card sale${candidates.length === 1 ? "" : "s"} in the +/- ${windowHours} hour window.`
    : providerSummary.windowRecordCount > 0
      ? `Nayax found ${providerSummary.windowRecordCount} sale record${providerSummary.windowRecordCount === 1 ? "" : "s"} in the +/- ${windowHours} hour window, but none matched the submitted details closely enough.`
      : `Nayax found no card sales in the +/- ${windowHours} hour window.`;
  const recommendedAction = candidates.length > 0
    ? "Review the recommended card sale and confirm the matching transaction before completion."
    : "Ask the customer for one more detail before deciding this card case.";

  return {
    configured: true,
    lookupStatus,
    lastCheckedAt,
    providerRecordCount,
    providerParseableRecordCount: providerSummary.parseableRecordCount,
    providerWindowRecordCount: providerSummary.windowRecordCount,
    candidateCount: candidates.length,
    candidates,
    windowHours,
    summary,
    recommendedAction,
    refundCase: caseSnapshot,
  };
};
