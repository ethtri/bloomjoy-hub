import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.1";
import { resolveSupabaseAccessToken } from "../_shared/auth.ts";
import { corsHeaders } from "../_shared/cors.ts";

const defaultNayaxBaseUrl = "https://lynx.nayax.com/operational/v1";
const defaultNayaxAccountKey = "TGPACI_USA_DB";

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const nayaxBaseUrl = (Deno.env.get("NAYAX_LYNX_BASE_URL") || defaultNayaxBaseUrl).replace(/\/+$/, "");

const supabase = supabaseUrl && supabaseServiceRoleKey
  ? createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: { persistSession: false },
    })
  : null;

const jsonResponse = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const sanitizeText = (value: unknown, maxLength = 300) =>
  typeof value === "string" || typeof value === "number" || typeof value === "boolean"
    ? String(value).trim().slice(0, maxLength)
    : "";

const isUuid = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

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

type NayaxProviderCandidate = {
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

type NayaxResponseCandidate = Omit<NayaxProviderCandidate, "transactionId" | "siteId"> & {
  candidateToken: string;
};

const extractNayaxRecords = (payload: unknown): unknown[] => {
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
}: {
  payload: unknown;
  requestAmountCents: number | null;
  requestCardLast4: string;
  cardWalletUsed: boolean;
  windowStart: Date;
  windowEnd: Date;
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
      const reasons = ["same Nayax machine", "+/- 1 hour incident window"];

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
        cardBrand: sanitizeText(record.CardBrand ?? record.cardBrand, 40),
        recognitionMethod: sanitizeText(record.RecognitionMethod ?? record.recognitionMethod, 80),
        paymentStatus: sanitizeText(record.PaymentMethod ?? record.Status ?? record.status, 80),
        matchConfidence: Math.max(0, Math.min(0.99, Number(matchConfidence.toFixed(2)))),
        matchReason: reasons.join("; "),
      };
    })
    .filter((candidate): candidate is NayaxProviderCandidate => Boolean(candidate))
    .sort((left, right) => right.matchConfidence - left.matchConfidence)
    .slice(0, 10);
};

const persistNayaxLookupCandidates = async ({
  caseId,
  actorUserId,
  candidates,
}: {
  caseId: string;
  actorUserId: string;
  candidates: NayaxProviderCandidate[];
}): Promise<NayaxResponseCandidate[]> => {
  if (!supabase || candidates.length === 0) return [];

  const nowIso = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  await supabase.from("refund_nayax_lookup_candidates").delete().lt("expires_at", nowIso);

  const tokenizedCandidates = candidates.map((candidate) => ({
    token: crypto.randomUUID(),
    candidate,
  }));

  const { error } = await supabase.from("refund_nayax_lookup_candidates").insert(
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
        card_brand_present: Boolean(candidate.cardBrand),
        recognition_method_present: Boolean(candidate.recognitionMethod),
        payment_status_present: Boolean(candidate.paymentStatus),
      },
      expires_at: expiresAt,
    })),
  );

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

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") {
      return jsonResponse({ error: "Method not allowed." }, 405);
    }

    if (!supabase) {
      return jsonResponse({ error: "Nayax lookup is not configured." }, 500);
    }

    const accessToken = resolveSupabaseAccessToken(req);
    if (!accessToken) {
      return jsonResponse({ error: "Unauthorized." }, 401);
    }

    const { data: authData, error: authError } = await supabase.auth.getUser(accessToken);
    const user = authData?.user;
    if (authError || !user) {
      return jsonResponse({ error: "Unauthorized." }, 401);
    }

    const body = await req.json();
    const caseId = sanitizeText(body?.caseId, 80);
    const incidentAt = parseIncidentAt(body?.incidentAt);
    const amountCents = sanitizeInputCents(body?.amountCents);
    const cardLast4 = extractLast4(body?.cardLast4);
    const cardWalletUsed = Boolean(body?.cardWalletUsed);

    if (!isUuid(caseId) || !incidentAt) {
      return jsonResponse({ error: "Refund case and incident time are required." }, 400);
    }

    const { data: canManageCase, error: accessError } = await supabase.rpc(
      "can_manage_refund_case",
      { p_user_id: user.id, p_refund_case_id: caseId },
    );

    if (accessError) {
      throw accessError;
    }

    if (!canManageCase) {
      return jsonResponse({ error: "Refund case access required." }, 403);
    }

    const { data: refundCase, error: refundCaseError } = await supabase
      .from("refund_cases")
      .select("id, reporting_machine_id")
      .eq("id", caseId)
      .maybeSingle();

    if (refundCaseError) {
      throw refundCaseError;
    }

    const machineId = sanitizeText(refundCase?.reporting_machine_id, 80);
    if (!isUuid(machineId)) {
      return jsonResponse({ error: "Refund case machine is not available." }, 400);
    }

    const { data: machine, error: machineError } = await supabase
      .from("reporting_machines")
      .select("id, machine_label, nayax_machine_id, nayax_account_key")
      .eq("id", machineId)
      .maybeSingle();

    if (machineError) {
      throw machineError;
    }

    const nayaxMachineId = sanitizeText(machine?.nayax_machine_id, 120);
    const accountKey = normalizeAccountKey(machine?.nayax_account_key);
    const nayaxApiToken = resolveNayaxToken(accountKey);

    if (!nayaxMachineId) {
      return jsonResponse({
        configured: false,
        candidates: [],
        message: "This machine needs a Nayax machine ID before card lookup can run.",
      });
    }

    if (!nayaxApiToken) {
      return jsonResponse({
        configured: false,
        candidates: [],
        message: "Nayax Lynx lookup is waiting on a server-only API token for this account.",
      });
    }

    const windowStart = new Date(incidentAt.getTime() - 60 * 60 * 1000);
    const windowEnd = new Date(incidentAt.getTime() + 60 * 60 * 1000);
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
      console.warn("nayax-transaction-lookup provider failure", {
        status: response.status,
        statusText: sanitizeText(response.statusText, 80) || "provider_error",
        accountKey,
      });
      return jsonResponse({ error: "Unable to look up Nayax transactions." }, 502);
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
    });
    const candidates = await persistNayaxLookupCandidates({
      caseId,
      actorUserId: user.id,
      candidates: providerCandidates,
    });

    return jsonResponse({
      configured: true,
      providerRecordCount,
      providerParseableRecordCount: providerSummary.parseableRecordCount,
      providerWindowRecordCount: providerSummary.windowRecordCount,
      candidates,
    });
  } catch (error) {
    console.error("nayax-transaction-lookup error", {
      errorType: error instanceof Error ? error.name : typeof error,
    });
    return jsonResponse({ error: "Unable to look up Nayax transactions." }, 500);
  }
});
