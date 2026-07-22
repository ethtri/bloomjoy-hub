import {
  buildNayaxRecommendation,
  extractNayaxRecords,
  NAYAX_RECOMMENDATION_POLICY,
  toPublicNayaxCandidate,
} from "./nayax-recommendation.mjs";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.48.1";

export { extractNayaxRecords };

const defaultNayaxBaseUrl = "https://lynx.nayax.com/operational/v1";
const defaultNayaxAccountKey = "TGPACI_USA_DB";
const defaultLookupWindowHours = 6;
const defaultCandidateTtlHours = 24;

type SupabaseServiceClient = SupabaseClient;

const sanitizeText = (value: unknown, maxLength = 300) =>
  typeof value === "string" || typeof value === "number" || typeof value === "boolean"
    ? String(value).trim().slice(0, maxLength)
    : "";

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

export type NayaxRecommendationState =
  | "high_confidence"
  | "ambiguous"
  | "no_safe_match"
  | "manual_exception";

export type NayaxMatchFactor = {
  key: string;
  outcome: string;
  label: string;
};

export type NayaxProviderCandidate = {
  transactionId: string;
  siteId: number | null;
  providerMachineId: string;
  authorizedAt: string;
  machineAuthorizationTime: string;
  providerTimeResolution: string;
  timeDeltaMinutes: number;
  amountCents: number | null;
  amountDeltaCents: number | null;
  currencyCode: string;
  cardLast4: string;
  cardBrand: string;
  recognitionMethod: string;
  paymentStatus: string;
  providerRefundState: string;
  rankingPoints: number;
  recommendationRank: number;
  isTopRanked: boolean;
  isRecommended: boolean;
  recommendationState: NayaxRecommendationState;
  oneClickEligible: boolean;
  selectionAllowed: boolean;
  matchStrength: string;
  matchFactors: NayaxMatchFactor[];
  manualReviewReasons: string[];
  hardExclusions: string[];
  matchReason: string;
  policyVersion: string;
};

export type NayaxResponseCandidate = Omit<
  NayaxProviderCandidate,
  "transactionId" | "siteId" | "providerMachineId" | "providerRefundState" | "rankingPoints"
> & {
  candidateToken: string;
};

export type NayaxLookupResult = {
  configured: boolean;
  lookupStatus:
    | "match_found"
    | "multiple_matches"
    | "no_match"
    | "manual_exception"
    | "setup_needed"
    | "lookup_failed";
  recommendationState: NayaxRecommendationState;
  policyVersion: string;
  oneClickEligible: boolean;
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

const loadNayaxTransactionStates = async ({
  supabase,
  caseId,
  transactionIds,
}: {
  supabase: SupabaseServiceClient;
  caseId: string;
  transactionIds: string[];
}) => {
  if (transactionIds.length === 0) return {} as Record<string, "clear" | "duplicate" | "already_refunded">;

  const { data, error } = await supabase
    .from("refund_cases")
    .select(
      "id, status, matched_nayax_transaction_id, reporting_adjustment_id, nayax_refund_execution_status",
    )
    .in("matched_nayax_transaction_id", transactionIds);

  if (error) throw error;

  const states: Record<string, "clear" | "duplicate" | "already_refunded"> = {};
  for (const row of data ?? []) {
    const transactionId = sanitizeText(row?.matched_nayax_transaction_id, 80);
    if (!transactionId) continue;
    const hasRefundEvidence =
      row?.status === "completed" ||
      Boolean(row?.reporting_adjustment_id) ||
      row?.nayax_refund_execution_status === "succeeded";
    if (hasRefundEvidence) {
      states[transactionId] = "already_refunded";
    } else if (row?.id !== caseId && states[transactionId] !== "already_refunded") {
      states[transactionId] = "duplicate";
    }
  }
  return states;
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

  const { error: cleanupError } = await supabase
    .from("refund_nayax_lookup_candidates")
    .delete()
    .lt("expires_at", nowIso);
  if (cleanupError) throw cleanupError;

  const { error: caseClearError } = await supabase
    .from("refund_nayax_lookup_candidates")
    .delete()
    .eq("refund_case_id", caseId);
  if (caseClearError) throw caseClearError;
  if (candidates.length === 0) return [];

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
        policy_version: candidate.policyVersion,
        ranking_points: candidate.rankingPoints,
        recommendation_rank: candidate.recommendationRank,
        recommendation_state: candidate.recommendationState,
        is_top_ranked: candidate.isTopRanked,
        is_recommended: candidate.isRecommended,
        one_click_eligible: candidate.oneClickEligible,
        selection_allowed: candidate.selectionAllowed,
        match_strength: candidate.matchStrength,
        match_reason: candidate.matchReason,
        match_factors: candidate.matchFactors,
        manual_review_reasons: candidate.manualReviewReasons,
        hard_exclusions: candidate.hardExclusions,
        time_delta_minutes: candidate.timeDeltaMinutes,
        amount_delta_cents: candidate.amountDeltaCents,
        provider_time_resolution: candidate.providerTimeResolution,
        card_brand: candidate.cardBrand || null,
        recognition_method: candidate.recognitionMethod || null,
        payment_status: candidate.paymentStatus || null,
        provider_payload_redacted: true,
      },
      expires_at: expiresAt,
    })),
  );
  if (error) throw error;

  return tokenizedCandidates.map(({ token, candidate }) =>
    toPublicNayaxCandidate(candidate, token) as NayaxResponseCandidate
  );
};

const recommendationToLookupStatus = (state: NayaxRecommendationState): NayaxLookupResult["lookupStatus"] => {
  if (state === "high_confidence") return "match_found";
  if (state === "ambiguous") return "multiple_matches";
  if (state === "manual_exception") return "manual_exception";
  return "no_match";
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
  const { data: refundCase, error: refundCaseError } = await supabase
    .from("refund_cases")
    .select(`
      id,
      public_reference,
      status,
      reporting_machine_id,
      reporting_location_id,
      incident_at,
      incident_time_resolution,
      payment_method,
      payment_amount_cents,
      refund_amount_cents,
      card_last4,
      card_wallet_used,
      customer_email,
      customer_name
    `)
    .eq("id", caseId)
    .maybeSingle();
  if (refundCaseError) throw refundCaseError;
  if (refundCase?.payment_method !== "card") {
    throw new NayaxLookupRequestError("Nayax lookup is only available for card refund cases.", 400);
  }

  const incidentAt = parseIncidentAt(refundCase?.incident_at);
  if (!incidentAt) throw new NayaxLookupRequestError("Refund case incident time is required.", 400);
  const machineId = sanitizeText(refundCase?.reporting_machine_id, 80);
  if (!machineId) throw new NayaxLookupRequestError("Refund case machine is not available.", 400);

  const { data: machine, error: machineError } = await supabase
    .from("reporting_machines")
    .select("id, location_id, machine_label, nayax_machine_id, nayax_account_key")
    .eq("id", machineId)
    .maybeSingle();
  if (machineError) throw machineError;

  const { data: location, error: locationError } = await supabase
    .from("reporting_locations")
    .select("id, name, timezone")
    .eq("id", sanitizeText(refundCase?.reporting_location_id, 80))
    .maybeSingle();
  if (locationError) throw locationError;
  if (
    sanitizeText(machine?.location_id, 80) !== sanitizeText(refundCase?.reporting_location_id, 80) ||
    sanitizeText(location?.id, 80) !== sanitizeText(refundCase?.reporting_location_id, 80)
  ) {
    throw new NayaxLookupRequestError(
      "Refund case machine/location mapping is inconsistent and requires administrator review.",
      409,
    );
  }

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
  const setupResult = (message: string, recommendedAction: string): NayaxLookupResult => ({
    configured: false,
    lookupStatus: "setup_needed",
    recommendationState: "manual_exception",
    policyVersion: NAYAX_RECOMMENDATION_POLICY.version,
    oneClickEligible: false,
    lastCheckedAt,
    candidates: [],
    candidateCount: 0,
    windowHours,
    refundCase: caseSnapshot,
    message,
    summary: "Setup needed before Nayax can check this card refund.",
    recommendedAction,
  });

  if (!nayaxMachineId) {
    return setupResult(
      "This machine needs a Nayax machine ID before card lookup can run.",
      "Ask an admin to add the Nayax machine ID in Admin > Machines before deciding this card case.",
    );
  }
  if (!nayaxApiToken) {
    return setupResult(
      "Nayax Lynx lookup is waiting on a server-only API token for this account.",
      "Ask an admin to verify the server-only Nayax token before deciding this card case.",
    );
  }

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
  const commonRecommendationInput = {
    payload: nayaxPayload,
    incidentAt: incidentAt.toISOString(),
    incidentTimeResolution: sanitizeText(refundCase?.incident_time_resolution, 40) || "legacy_absolute",
    expectedMachineId: nayaxMachineId,
    locationTimezone: sanitizeText(location?.timezone, 80),
    requestAmountCents: sanitizeInputCents(refundCase?.payment_amount_cents),
    requestCardLast4: extractLast4(refundCase?.card_last4),
    cardWalletUsed: Boolean(refundCase?.card_wallet_used),
    windowHours,
  };
  const preliminary = buildNayaxRecommendation(commonRecommendationInput) as {
    candidates: NayaxProviderCandidate[];
  };
  const transactionStates = await loadNayaxTransactionStates({
    supabase,
    caseId,
    transactionIds: preliminary.candidates.map((candidate) => candidate.transactionId),
  });
  const recommendation = buildNayaxRecommendation({
    ...commonRecommendationInput,
    transactionStates,
  }) as {
    policyVersion: string;
    recommendationState: NayaxRecommendationState;
    oneClickEligible: boolean;
    candidates: NayaxProviderCandidate[];
    candidateCount: number;
    providerParseableRecordCount: number;
    providerWindowRecordCount: number;
    summary: string;
    recommendedAction: string;
  };
  const candidates = await persistNayaxLookupCandidates({
    supabase,
    caseId,
    actorUserId,
    candidates: recommendation.candidates,
  });

  return {
    configured: true,
    lookupStatus: recommendationToLookupStatus(recommendation.recommendationState),
    recommendationState: recommendation.recommendationState,
    policyVersion: recommendation.policyVersion,
    oneClickEligible: recommendation.oneClickEligible,
    lastCheckedAt,
    providerRecordCount: extractNayaxRecords(nayaxPayload).length,
    providerParseableRecordCount: recommendation.providerParseableRecordCount,
    providerWindowRecordCount: recommendation.providerWindowRecordCount,
    candidateCount: recommendation.candidateCount,
    candidates,
    windowHours,
    summary: recommendation.summary,
    recommendedAction: recommendation.recommendedAction,
    refundCase: caseSnapshot,
  };
};
