import {
  buildNayaxRecommendation,
  extractNayaxRecords,
  NAYAX_RECOMMENDATION_POLICY,
  toPublicNayaxCandidate,
} from "./nayax-recommendation.mjs";
import { buildNayaxMachineContext } from "./nayax-machine-context.mjs";
import { loadNayaxProviderClockContext } from "./nayax-provider-clock.mjs";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.48.1";

export { extractNayaxRecords, NAYAX_RECOMMENDATION_POLICY };

const defaultNayaxBaseUrl = "https://lynx.nayax.com/operational/v1";
const defaultNayaxAccountKey = "TGPACI_USA_DB";
const defaultLookupWindowHours = 6;
const defaultCandidateTtlHours = 24;
const defaultLookupTimeoutMs = 8_000;
const defaultLookupResponseBytes = 512 * 1024;
const defaultLookupRecordLimit = 200;

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

export const getNayaxLookupTimeoutMs = () =>
  parseNumberEnv(Deno.env.get("NAYAX_LOOKUP_TIMEOUT_MS"), defaultLookupTimeoutMs, 1_000, 15_000);

export const getNayaxLookupResponseByteLimit = () =>
  parseNumberEnv(
    Deno.env.get("NAYAX_LOOKUP_RESPONSE_BYTE_LIMIT"),
    defaultLookupResponseBytes,
    64 * 1024,
    2 * 1024 * 1024,
  );

export const getNayaxLookupRecordLimit = () =>
  parseNumberEnv(Deno.env.get("NAYAX_LOOKUP_RECORD_LIMIT"), defaultLookupRecordLimit, 10, 200);

export class NayaxLookupRequestError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "NayaxLookupRequestError";
    this.status = status;
  }
}

export class NayaxLookupEvidenceChangedError extends Error {
  constructor() {
    super("Refund case matching evidence changed during Nayax lookup.");
    this.name = "NayaxLookupEvidenceChangedError";
  }
}

export class NayaxLookupTimeoutError extends Error {
  constructor() {
    super("The bounded Nayax lookup timed out.");
    this.name = "NayaxLookupTimeoutError";
  }
}

export class NayaxLookupResponseLimitError extends Error {
  constructor(message = "The Nayax lookup exceeded its safe response limit.") {
    super(message);
    this.name = "NayaxLookupResponseLimitError";
  }
}

export class NayaxLookupMalformedResponseError extends Error {
  constructor() {
    super("Nayax returned an unreadable lookup response.");
    this.name = "NayaxLookupMalformedResponseError";
  }
}

export const readBoundedNayaxJsonResponse = async (
  response: Response,
  byteLimit: number,
) => {
  const advertisedBytes = Number(response.headers.get("content-length"));
  if (Number.isFinite(advertisedBytes) && advertisedBytes > byteLimit) {
    await response.body?.cancel();
    throw new NayaxLookupResponseLimitError();
  }
  if (!response.body) return null;

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let receivedBytes = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      receivedBytes += value.byteLength;
      if (receivedBytes > byteLimit) {
        await reader.cancel();
        throw new NayaxLookupResponseLimitError();
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } finally {
    reader.releaseLock();
  }

  try {
    return text ? JSON.parse(text) : null;
  } catch {
    throw new NayaxLookupMalformedResponseError();
  }
};

const fetchBoundedNayaxJson = async ({
  url,
  headers,
  byteLimit = getNayaxLookupResponseByteLimit(),
}: {
  url: string;
  headers: Record<string, string>;
  byteLimit?: number;
}) => {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(getNayaxLookupTimeoutMs()),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") {
      throw new NayaxLookupTimeoutError();
    }
    throw error;
  }
  if (!response.ok) {
    await response.body?.cancel();
    return { response, payload: null };
  }
  return {
    response,
    payload: await readBoundedNayaxJsonResponse(response, byteLimit),
  };
};

const assertProviderRecordLimit = (payloads: unknown[]) => {
  const count = payloads.reduce<number>(
    (total, payload) => total + extractNayaxRecords(payload).length,
    0,
  );
  if (count > getNayaxLookupRecordLimit()) {
    throw new NayaxLookupResponseLimitError(
      "Nayax returned more transaction records than the safe lookup limit.",
    );
  }
  return count;
};

const parseIncidentAt = (value: unknown) => {
  const raw = sanitizeText(value, 80);
  const date = raw ? new Date(raw) : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
};

const sanitizeInputCents = (value: unknown) => {
  if (value === null || value === undefined || value === "" || typeof value === "boolean") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? Math.round(numeric) : null;
};

const extractLast4 = (value: unknown) => {
  const digits = sanitizeText(value, 80).replace(/\D/g, "");
  return digits.length >= 4 ? digits.slice(-4) : "";
};

export const normalizeNayaxAccountKey = (value: unknown) => {
  const raw = sanitizeText(value, 80);
  if (!raw) return "";
  const normalized = raw.toUpperCase().replace(/[^A-Z0-9_]/g, "_");
  return normalized;
};

export const resolveNayaxTokenForAccount = (
  accountKey: string,
  readEnvironment: (name: string) => string | undefined = (name) => Deno.env.get(name),
) => {
  const normalized = normalizeNayaxAccountKey(accountKey);
  if (!normalized) return "";
  const scopedToken = readEnvironment(`NAYAX_LYNX_API_TOKEN_${normalized}`) || "";
  if (scopedToken) return scopedToken;
  if (normalized !== defaultNayaxAccountKey) return "";
  return readEnvironment("NAYAX_LYNX_API_TOKEN") || "";
};

export type NayaxRecommendationState =
  | "high_confidence"
  | "ambiguous"
  | "no_safe_match"
  | "manual_exception";

export type NayaxConfidenceClass =
  | "strong_card"
  | "unique_qr_time"
  | "evidence_aware_review"
  | "ambiguous_manual";

export type NayaxMatchFactor = {
  key: string;
  outcome: string;
  label: string;
};

export type NayaxProviderCandidate = {
  reportingMachineId?: string | null;
  machineDisplayLabel?: string | null;
  transactionId: string;
  siteId: number | null;
  providerMachineId: string;
  authorizedAt: string;
  machineAuthorizationTime: string;
  machineAuthorizationTimeRaw: string;
  machineTimeResolution: string;
  machineClockContext?: NayaxProviderClockContext | null;
  providerTimeResolution: string;
  providerTimeSource: string;
  customerRequestReceivedAt: string | null;
  customerRequestReceivedSource: string | null;
  requestTimeBoundaryState: string;
  transactionOccurrenceComparable: boolean;
  timeDeltaMinutes: number;
  qrTimeDeltaMinutes: number | null;
  amountCents: number | null;
  amountDeltaCents: number | null;
  currencyCode: string;
  cardLast4: string;
  cardBrand: string;
  cardNetwork?: string | null;
  recognitionMethod: string;
  paymentStatus: string;
  paymentStatusEvidence?: string;
  providerRefundState: string;
  duplicateProviderRecord?: boolean;
  productLabel: string;
  productCode: string;
  standardPriceCents: number | null;
  priceMatchesMachineConfiguration: boolean | null;
  machineStatus: {
    state: "online" | "attention" | "unknown";
    label: string;
    checkedAt: string;
  } | null;
  nearbyMachineAlerts: Array<{ category: string; occurredAt: string }>;
  rankingPoints: number;
  recommendationRank: number;
  isTopRanked: boolean;
  isRecommended: boolean;
  recommendationState: NayaxRecommendationState;
  confidenceClass: NayaxConfidenceClass;
  reasonCodes: string[];
  oneClickEligible: boolean;
  selectionAllowed: boolean;
  matchStrength: string;
  matchFactors: NayaxMatchFactor[];
  manualReviewReasons: string[];
  hardExclusions: string[];
  matchReason: string;
  policyVersion: string;
  identifierPolicyVersion: string;
  customerFactVersion: number | null;
  customerCredentialClass: string;
  providerIdentifierClass: string;
  cardLast4Comparison: string;
  cardNetworkComparison: string;
  paymentInteractionComparison: string;
  sameIdentifierEquivalenceProven: boolean;
  identifierReviewState: string;
  customerCorrectionFields: string[];
};

export type NayaxProviderClockContext = {
  reportingMachineId: string;
  timezone: string | null;
  source: string;
  observedAt: string | null;
};

export type NayaxResponseCandidate = Omit<
  NayaxProviderCandidate,
  "transactionId" | "siteId" | "providerMachineId" | "providerRefundState" | "rankingPoints" |
  "duplicateProviderRecord" |
  "machineAuthorizationTimeRaw" | "machineTimeResolution" | "machineClockContext" |
  "providerTimeSource" | "customerRequestReceivedAt" | "customerRequestReceivedSource" |
  "requestTimeBoundaryState" | "transactionOccurrenceComparable"
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
  confidenceClass: NayaxConfidenceClass;
  reasonCodes: string[];
  policyVersion: string;
  oneClickEligible: boolean;
  qrClaimEvidenceStatus: "verified" | "missing" | "invalid" | "replayed";
  qrClaimOpenedAt: string | null;
  maximumUniqueQrLagMinutes: number;
  lastCheckedAt: string;
  message?: string;
  providerRecordCount?: number;
  providerParseableRecordCount?: number;
  providerWindowRecordCount?: number;
  excludedAfterRequestCount?: number;
  uncertainRequestTimeCandidateCount?: number;
  providerClockContexts?: NayaxProviderClockContext[];
  candidateCount: number;
  candidates: NayaxResponseCandidate[];
  windowHours: number;
  summary: string;
  recommendedAction: string;
  setupIssueCode?:
    | "machine_mapping_missing"
    | "account_scope_missing"
    | "account_access_unavailable"
    | "grouped_mapping_incomplete";
  responsibleOwner?: "refund_operations";
  requiredAccountScope?: string;
  customerActionRequired?: false;
  resolvedMachineId?: string | null;
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
    incidentAt: string;
    customerRequestReceivedAt?: string | null;
    customerRequestReceivedSource?: string | null;
    incidentTimeResolution?: string;
    incidentTimeConfidence?: string;
    locationTimezone?: string;
    qrClaimOpenedAt: string | null;
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
  lookupGeneration,
  candidates,
  lookupScopes,
}: {
  supabase: SupabaseServiceClient;
  caseId: string;
  actorUserId: string | null;
  lookupGeneration: number;
  candidates: NayaxProviderCandidate[];
  lookupScopes: Array<{ reportingMachineId: string; accountKey: string; nayaxMachineId: string }>;
}): Promise<NayaxResponseCandidate[]> => {
  const nowIso = new Date().toISOString();
  const expiresAt = new Date(Date.now() + getNayaxCandidateTtlHours() * 60 * 60 * 1000).toISOString();

  const { error: cleanupError } = await supabase
    .from("refund_nayax_lookup_candidates")
    .delete()
    .lt("expires_at", nowIso);
  if (cleanupError) throw cleanupError;

  const { error: generationClearError } = await supabase
    .from("refund_nayax_lookup_candidates")
    .delete()
    .eq("refund_case_id", caseId)
    .eq("lookup_generation", lookupGeneration);
  if (generationClearError) throw generationClearError;
  if (candidates.length === 0) return [];

  const tokenizedCandidates = candidates.map((candidate) => {
    const scope = lookupScopes.find((value) => value.reportingMachineId === candidate.reportingMachineId);
    if (!scope) throw new NayaxLookupEvidenceChangedError();
    return { token: crypto.randomUUID(), candidate, scope };
  });
  const { error } = await supabase.from("refund_nayax_lookup_candidates").insert(
    tokenizedCandidates.map(({ token, candidate, scope }) => ({
      token,
      refund_case_id: caseId,
      lookup_generation: lookupGeneration,
      actor_user_id: actorUserId,
      reporting_machine_id: candidate.reportingMachineId ?? null,
      provider_transaction_id: candidate.transactionId,
      site_id: candidate.siteId,
      machine_authorization_time: candidate.machineAuthorizationTime,
      amount_cents: candidate.amountCents,
      card_last4: candidate.cardLast4 || null,
      currency_code: candidate.currencyCode || null,
      evidence_summary: {
        lookup_account_scope: scope.accountKey,
        lookup_provider_machine_id: scope.nayaxMachineId,
        provider_machine_id: candidate.providerMachineId,
        policy_version: candidate.policyVersion,
        identifier_policy_version: candidate.identifierPolicyVersion,
        customer_fact_version: candidate.customerFactVersion,
        customer_credential_class: candidate.customerCredentialClass,
        provider_identifier_class: candidate.providerIdentifierClass,
        card_last4_comparison: candidate.cardLast4Comparison,
        card_network_comparison: candidate.cardNetworkComparison,
        payment_interaction_comparison: candidate.paymentInteractionComparison,
        same_identifier_equivalence_proven: candidate.sameIdentifierEquivalenceProven,
        identifier_review_state: candidate.identifierReviewState,
        customer_correction_fields: candidate.customerCorrectionFields,
        ranking_points: candidate.rankingPoints,
        recommendation_rank: candidate.recommendationRank,
        recommendation_state: candidate.recommendationState,
        confidence_class: candidate.confidenceClass,
        reason_codes: candidate.reasonCodes,
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
        qr_time_delta_minutes: candidate.qrTimeDeltaMinutes,
        amount_delta_cents: candidate.amountDeltaCents,
        provider_time_resolution: candidate.providerTimeResolution,
        provider_time_source: candidate.providerTimeSource,
        authorized_at: candidate.authorizedAt,
        customer_request_received_at: candidate.customerRequestReceivedAt,
        customer_request_received_source: candidate.customerRequestReceivedSource,
        request_time_boundary: candidate.requestTimeBoundaryState,
        transaction_occurrence_comparable: candidate.transactionOccurrenceComparable,
        machine_authorization_time_raw: candidate.machineAuthorizationTimeRaw,
        machine_authorization_time_source: "MachineAuthorizationTime",
        machine_time_resolution: candidate.machineTimeResolution,
        machine_clock_context: candidate.machineClockContext ?? null,
        card_brand: candidate.cardBrand || null,
        card_network: candidate.cardNetwork || null,
        recognition_method: candidate.recognitionMethod || null,
        payment_status: candidate.paymentStatus || null,
        payment_status_evidence: candidate.paymentStatusEvidence || null,
        provider_refund_state: candidate.providerRefundState || null,
        duplicate_provider_record: Boolean(candidate.duplicateProviderRecord),
        product_label: candidate.productLabel || null,
        product_code: candidate.productCode || null,
        standard_price_cents: candidate.standardPriceCents,
        price_matches_machine_configuration: candidate.priceMatchesMachineConfiguration,
        machine_status: candidate.machineStatus,
        nearby_machine_alerts: candidate.nearbyMachineAlerts,
        machine_display_label: candidate.machineDisplayLabel ?? null,
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

export const rankGroupedNayaxCandidates = (groups: Array<{
  reportingMachineId: string;
  machineDisplayLabel: string;
  candidates: NayaxProviderCandidate[];
}>) => {
  const combinedCandidates = groups.flatMap((group) =>
    group.candidates.map((candidate) => ({
      ...candidate,
      reportingMachineId: group.reportingMachineId,
      machineDisplayLabel: group.machineDisplayLabel,
    }))
  ).sort((left, right) =>
    right.rankingPoints - left.rankingPoints ||
    left.timeDeltaMinutes - right.timeDeltaMinutes ||
    left.transactionId.localeCompare(right.transactionId)
  );
  const selectableCandidates = combinedCandidates.filter((candidate) => candidate.selectionAllowed);
  const uniqueCandidate = selectableCandidates.length === 1 ? selectableCandidates[0] : null;
  const recommendationState: NayaxRecommendationState = uniqueCandidate
    ? uniqueCandidate.recommendationState === "high_confidence"
      ? "high_confidence"
      : "manual_exception"
    : selectableCandidates.length > 1
    ? "ambiguous"
    : "no_safe_match";
  const oneClickEligible = recommendationState === "high_confidence" &&
    uniqueCandidate?.oneClickEligible === true;
  const candidates = combinedCandidates.map((candidate, index) => ({
    ...candidate,
    recommendationRank: index + 1,
    isTopRanked: index === 0,
    isRecommended: Boolean(uniqueCandidate && candidate.transactionId === uniqueCandidate.transactionId),
    recommendationState,
    confidenceClass: uniqueCandidate
      ? uniqueCandidate.confidenceClass
      : "ambiguous_manual" as NayaxConfidenceClass,
    oneClickEligible: Boolean(
      oneClickEligible && uniqueCandidate && candidate.transactionId === uniqueCandidate.transactionId
    ),
  }));

  return {
    candidates,
    selectableCandidates,
    uniqueCandidate,
    recommendationState,
    oneClickEligible,
  };
};

type GroupedRefundCase = {
  id: string;
  public_reference: string;
  status: string;
  reporting_location_id: string;
  intake_selection_key: string;
  intake_selection_kind: string;
  intake_selection_machine_ids: string[];
  incident_at: string;
  customer_request_received_at: string | null;
  customer_request_received_source: string | null;
  incident_time_resolution: string | null;
  incident_time_confidence: string | null;
  payment_method: string;
  payment_amount_cents: number | null;
  refund_amount_cents: number | null;
  card_last4: string | null;
  card_last4_provenance: string | null;
  card_last4_source: string | null;
  card_network: string | null;
  card_wallet_used: boolean | null;
  payment_interaction: string | null;
  wallet_device_kind: string | null;
  incident_time_source: string | null;
  nearby_attempt_count: string | null;
  customer_email: string;
  customer_name: string | null;
  deterministic_fact_version: number;
};

const lookupGroupedLivermoreCandidates = async ({
  supabase,
  refundCase,
  actorUserId,
  lookupGeneration,
  initialFactVersion,
  incidentAt,
  lastCheckedAt,
  nayaxBaseUrl,
  windowHours,
}: {
  supabase: SupabaseServiceClient;
  refundCase: GroupedRefundCase;
  actorUserId: string | null;
  lookupGeneration: number;
  initialFactVersion: number;
  incidentAt: Date;
  lastCheckedAt: string;
  nayaxBaseUrl: string;
  windowHours: number;
}): Promise<NayaxLookupResult> => {
  const { data: resolvedScope, error: scopeError } = await supabase.rpc(
    "service_resolve_refund_public_selection",
    { p_selection_key: refundCase.intake_selection_key },
  );
  const scopeMachineIds: string[] = Array.isArray(resolvedScope?.machineIds)
    ? resolvedScope.machineIds.map((value: unknown) => sanitizeText(value, 80))
    : [];
  if (
    scopeError ||
    resolvedScope?.selectionKind !== "livermore_pair" ||
    scopeMachineIds.length !== 2 ||
    JSON.stringify(scopeMachineIds) !== JSON.stringify(refundCase.intake_selection_machine_ids)
  ) {
    throw new NayaxLookupRequestError(
      "The grouped location changed and requires administrator review.",
      409,
    );
  }

  const { data: machines, error: machinesError } = await supabase
    .from("reporting_machines")
    .select("id, location_id, machine_label, nayax_machine_id, nayax_account_key")
    .in("id", scopeMachineIds);
  if (machinesError) throw machinesError;
  type ScopedMachine = {
    id: string;
    location_id: string;
    machine_label: string;
    nayax_machine_id: string | null;
    nayax_account_key: string | null;
  };
  const machineRows = (machines ?? []) as ScopedMachine[];
  const orderedMachines: Array<ScopedMachine | undefined> = scopeMachineIds.map((machineId: string) =>
    machineRows.find((machine: ScopedMachine) => sanitizeText(machine.id, 80) === machineId)
  );
  if (
    orderedMachines.some((machine: ScopedMachine | undefined) => !machine) ||
    orderedMachines.some((machine: ScopedMachine | undefined) =>
      sanitizeText(machine?.location_id, 80) !== refundCase.reporting_location_id
    )
  ) {
    throw new NayaxLookupRequestError(
      "The grouped location is incomplete and requires administrator review.",
      409,
    );
  }

  const { data: location, error: locationError } = await supabase
    .from("reporting_locations")
    .select("id, name, timezone")
    .eq("id", refundCase.reporting_location_id)
    .maybeSingle();
  if (locationError) throw locationError;
  if (!location) {
    throw new NayaxLookupRequestError("The grouped location is unavailable.", 409);
  }

  const caseSnapshot = {
    id: refundCase.id,
    publicReference: refundCase.public_reference,
    status: refundCase.status,
    customerEmail: refundCase.customer_email,
    customerName: refundCase.customer_name,
    paymentMethod: refundCase.payment_method,
    paymentAmountCents: sanitizeInputCents(refundCase.payment_amount_cents),
    refundAmountCents: sanitizeInputCents(refundCase.refund_amount_cents),
    machineLabel: "San Francisco Premium Outlets — Cotton candy",
    locationName: sanitizeText(location.name, 180) || null,
    incidentAt: incidentAt.toISOString(),
    customerRequestReceivedAt: refundCase.customer_request_received_at,
    customerRequestReceivedSource: refundCase.customer_request_received_source,
    incidentTimeResolution: sanitizeText(refundCase.incident_time_resolution, 40) || "legacy_absolute",
    incidentTimeConfidence: sanitizeText(refundCase.incident_time_confidence, 40) || "rough",
    locationTimezone: sanitizeText(location.timezone, 80),
    qrClaimOpenedAt: null,
  };
  const requiredAccountScope = `${sanitizeText(location.name, 140) || "Selected location"} Nayax account scope`;
  const setupResult = (
    message: string,
    setupIssueCode: NonNullable<NayaxLookupResult["setupIssueCode"]>,
  ): NayaxLookupResult => ({
    configured: false,
    lookupStatus: "setup_needed",
    recommendationState: "manual_exception",
    confidenceClass: "ambiguous_manual",
    reasonCodes: ["lookup_setup_incomplete"],
    policyVersion: NAYAX_RECOMMENDATION_POLICY.version,
    oneClickEligible: false,
    qrClaimEvidenceStatus: "missing",
    qrClaimOpenedAt: null,
    maximumUniqueQrLagMinutes: NAYAX_RECOMMENDATION_POLICY.maximumUniqueQrLagMinutes,
    lastCheckedAt,
    candidates: [],
    candidateCount: 0,
    windowHours,
    refundCase: caseSnapshot,
    message,
    summary: "Setup needed before Nayax can check this grouped card refund.",
    recommendedAction: "Refund Operations must repair the exact grouped machine/account mapping, then run one safe read-only retry. Do not ask the customer to repeat details Bloomjoy owns.",
    setupIssueCode,
    responsibleOwner: "refund_operations",
    requiredAccountScope,
    customerActionRequired: false,
  });

  const providerInputs = orderedMachines.map((machine: ScopedMachine | undefined, index: number) => {
    const nayaxMachineId = sanitizeText(machine?.nayax_machine_id, 120);
    const accountKey = normalizeNayaxAccountKey(machine?.nayax_account_key);
    const token = resolveNayaxTokenForAccount(accountKey);
    return {
      reportingMachineId: scopeMachineIds[index],
      machineDisplayLabel: `San Francisco Premium Outlets — Cotton candy machine ${index === 0 ? "A" : "B"}`,
      nayaxMachineId,
      accountKey,
      token,
    };
  });
  if (providerInputs.some((input: typeof providerInputs[number]) => !input.nayaxMachineId || !input.accountKey)) {
    return setupResult(
      "The reviewed grouped location is missing an exact Nayax machine or account mapping.",
      "grouped_mapping_incomplete",
    );
  }
  if (providerInputs.some((input: typeof providerInputs[number]) => !input.token)) {
    return setupResult(
      "The reviewed grouped location requires a separate server-only Nayax account connection.",
      "account_access_unavailable",
    );
  }

  const providerResults = await Promise.all(providerInputs.map(async (input: typeof providerInputs[number]) => {
    const providerClockContext = await loadNayaxProviderClockContext(supabase, input);
    const headers = {
      Authorization: `Bearer ${input.token}`,
      "Content-Type": "application/json",
    };
    const optionalPayload = async (endpointName: string) => {
      try {
        const { response, payload } = await fetchBoundedNayaxJson({
          url: `${nayaxBaseUrl}/machines/${encodeURIComponent(input.nayaxMachineId)}/${endpointName}`,
          headers,
          byteLimit: Math.min(getNayaxLookupResponseByteLimit(), 256 * 1024),
        });
        return response.ok ? payload : null;
      } catch {
        return null;
      }
    };
    const [salesResult, productsPayload, statusPayload, alertsPayload] = await Promise.all([
      fetchBoundedNayaxJson({
        url: `${nayaxBaseUrl}/machines/${encodeURIComponent(input.nayaxMachineId)}/lastSales`,
        headers,
      }),
      optionalPayload("machineProducts"),
      optionalPayload("status"),
      optionalPayload("lastAlerts"),
    ]);
    if (!salesResult.response.ok) {
      console.warn("grouped nayax lookup provider failure", {
        status: salesResult.response.status,
        accountKey: input.accountKey,
      });
      throw new NayaxLookupRequestError("Unable to look up both grouped Nayax machines.", 502);
    }
    const payload = salesResult.payload;
    const recommendationInput = {
      payload,
      incidentAt: incidentAt.toISOString(),
      customerRequestReceivedAt: refundCase.customer_request_received_at,
      customerRequestReceivedSource: refundCase.customer_request_received_source,
      incidentTimeResolution: sanitizeText(refundCase.incident_time_resolution, 40) || "legacy_absolute",
      expectedMachineId: input.nayaxMachineId,
      locationTimezone: sanitizeText(location.timezone, 80),
      providerClockContext,
      requestAmountCents: sanitizeInputCents(refundCase.payment_amount_cents),
      requestCardLast4: extractLast4(refundCase.card_last4),
      requestCardLast4Provenance: sanitizeText(refundCase.card_last4_provenance, 40),
      requestCardLast4Source: sanitizeText(refundCase.card_last4_source, 40),
      requestCardNetwork: sanitizeText(refundCase.card_network, 40),
      cardWalletUsed: Boolean(refundCase.card_wallet_used),
      paymentInteraction: sanitizeText(refundCase.payment_interaction, 40),
      walletDeviceKind: sanitizeText(refundCase.wallet_device_kind, 40),
      incidentTimeSource: sanitizeText(refundCase.incident_time_source, 40),
      nearbyAttemptCount: sanitizeText(refundCase.nearby_attempt_count, 40),
      customerFactVersion: initialFactVersion,
      incidentTimeConfidence: sanitizeText(refundCase.incident_time_confidence, 40) || "rough",
      machineContext: buildNayaxMachineContext({
        productsPayload,
        statusPayload,
        alertsPayload,
        checkedAt: lastCheckedAt,
      }),
      qrClaimOpenedAt: null,
      qrClaimEvidenceStatus: "missing" as const,
      providerContract: "nayax_machine_last_sales_v1" as const,
      windowHours,
    };
    const preliminary = buildNayaxRecommendation(recommendationInput) as {
      consideredTransactionIds: string[];
    };
    return { input, payload, recommendationInput, preliminary };
  }));
  const providerRecordCount = assertProviderRecordLimit(
    providerResults.map((result) => result.payload),
  );

  const transactionStates = await loadNayaxTransactionStates({
    supabase,
    caseId: refundCase.id,
    transactionIds: providerResults.flatMap((result) =>
      result.preliminary.consideredTransactionIds
    ),
  });
  const localRecommendations = providerResults.map((result) => ({
    ...result,
    recommendation: buildNayaxRecommendation({
      ...result.recommendationInput,
      transactionStates,
    }) as {
      candidates: NayaxProviderCandidate[];
      providerParseableRecordCount: number;
      providerWindowRecordCount: number;
      excludedAfterRequestCount: number;
      uncertainRequestTimeCandidateCount: number;
    },
  }));
  const {
    candidates: globallyRanked,
    selectableCandidates,
    uniqueCandidate,
    recommendationState,
    oneClickEligible,
  } = rankGroupedNayaxCandidates(localRecommendations.map((result) => ({
    reportingMachineId: result.input.reportingMachineId,
    machineDisplayLabel: result.input.machineDisplayLabel,
    candidates: result.recommendation.candidates,
  })));

  const { data: currentCase, error: currentCaseError } = await supabase
    .from("refund_cases")
    .select("deterministic_fact_version,intake_selection_key,intake_selection_machine_ids")
    .eq("id", refundCase.id)
    .maybeSingle();
  if (currentCaseError) throw currentCaseError;
  if (
    Number(currentCase?.deterministic_fact_version) !== initialFactVersion ||
    currentCase?.intake_selection_key !== refundCase.intake_selection_key ||
    JSON.stringify(currentCase?.intake_selection_machine_ids) !== JSON.stringify(scopeMachineIds)
  ) {
    throw new NayaxLookupEvidenceChangedError();
  }

  const candidates = await persistNayaxLookupCandidates({
    supabase,
    caseId: refundCase.id,
    actorUserId,
    lookupGeneration,
    candidates: globallyRanked,
    lookupScopes: providerInputs,
  });
  const summary = selectableCandidates.length === 0
    ? "No safe transaction matched across the two reviewed outlet machines."
    : selectableCandidates.length === 1
    ? "One safe transaction matched across the two reviewed outlet machines. Confirm it before any refund decision."
    : "More than one plausible transaction matched across the two reviewed outlet machines. A manager must choose the exact transaction.";
  const excludedAfterRequestCount = localRecommendations.reduce(
    (count, result) => count + result.recommendation.excludedAfterRequestCount,
    0,
  );
  const uncertainRequestTimeCandidateCount = globallyRanked.filter((candidate) =>
    candidate.requestTimeBoundaryState !== "before_or_at_request"
  ).length;
  const requestBoundaryNote = excludedAfterRequestCount > 0
    ? `${excludedAfterRequestCount} later transaction${excludedAfterRequestCount === 1 ? " was" : "s were"} excluded because ${excludedAfterRequestCount === 1 ? "it" : "they"} occurred after Bloomjoy received the customer request. `
    : "";
  return {
    configured: true,
    lookupStatus: recommendationToLookupStatus(recommendationState),
    recommendationState,
    confidenceClass: recommendationState === "high_confidence"
      ? uniqueCandidate?.confidenceClass ?? "strong_card"
      : "ambiguous_manual",
    reasonCodes: [...new Set([
      ...globallyRanked.flatMap((candidate) => candidate.reasonCodes),
      ...(excludedAfterRequestCount > 0 ? ["transaction_after_customer_request"] : []),
    ])],
    policyVersion: NAYAX_RECOMMENDATION_POLICY.version,
    oneClickEligible,
    qrClaimEvidenceStatus: "missing",
    qrClaimOpenedAt: null,
    maximumUniqueQrLagMinutes: NAYAX_RECOMMENDATION_POLICY.maximumUniqueQrLagMinutes,
    lastCheckedAt,
    providerRecordCount,
    providerClockContexts: providerResults.map((result) => result.recommendationInput.providerClockContext),
    providerParseableRecordCount: localRecommendations.reduce(
      (count, result) => count + result.recommendation.providerParseableRecordCount,
      0,
    ),
    providerWindowRecordCount: localRecommendations.reduce(
      (count, result) => count + result.recommendation.providerWindowRecordCount,
      0,
    ),
    excludedAfterRequestCount,
    uncertainRequestTimeCandidateCount,
    candidateCount: globallyRanked.length,
    candidates,
    windowHours,
    summary: `${requestBoundaryNote}${summary}`,
    recommendedAction: selectableCandidates.length === 1
      ? "Confirm the exact transaction, then review the refund separately."
      : "Review the bounded results and never guess or attempt both machines.",
    resolvedMachineId: uniqueCandidate?.reportingMachineId ?? null,
    refundCase: caseSnapshot,
  };
};

export const lookupNayaxCandidatesForRefundCase = async ({
  supabase,
  caseId,
  actorUserId,
  lookupGeneration,
  expectedFactVersion,
  nayaxBaseUrl = getNayaxBaseUrl(),
  windowHours = getNayaxLookupWindowHours(),
}: {
  supabase: SupabaseServiceClient;
  caseId: string;
  actorUserId: string | null;
  lookupGeneration: number;
  expectedFactVersion?: number;
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
      intake_selection_key,
      intake_selection_kind,
      intake_selection_machine_ids,
      refund_qr_claim_context_id,
      incident_at,
      customer_request_received_at,
      customer_request_received_source,
      incident_time_resolution,
      incident_time_confidence,
      payment_method,
      payment_amount_cents,
      refund_amount_cents,
      card_last4,
      card_last4_provenance,
      card_last4_source,
      card_network,
      card_wallet_used,
      payment_interaction,
      wallet_device_kind,
      incident_time_source,
      nearby_attempt_count,
      customer_email,
      customer_name,
      deterministic_fact_version
    `)
    .eq("id", caseId)
    .maybeSingle();
  if (refundCaseError) throw refundCaseError;
  const initialFactVersion = Number(refundCase?.deterministic_fact_version);
  if (
    !Number.isInteger(initialFactVersion) ||
    (expectedFactVersion !== undefined && initialFactVersion !== expectedFactVersion)
  ) {
    throw new NayaxLookupEvidenceChangedError();
  }
  if (refundCase?.payment_method !== "card") {
    throw new NayaxLookupRequestError("Nayax lookup is only available for card refund cases.", 400);
  }

  const incidentAt = parseIncidentAt(refundCase?.incident_at);
  if (!incidentAt) throw new NayaxLookupRequestError("Refund case incident time is required.", 400);
  const machineId = sanitizeText(refundCase?.reporting_machine_id, 80);
  if (!machineId) {
    const groupedMachineIds = Array.isArray(refundCase?.intake_selection_machine_ids)
      ? refundCase.intake_selection_machine_ids.map((value: unknown) => sanitizeText(value, 80))
      : [];
    if (
      refundCase?.intake_selection_kind !== "livermore_pair" ||
      !sanitizeText(refundCase?.intake_selection_key, 80) ||
      groupedMachineIds.length !== 2
    ) {
      throw new NayaxLookupRequestError("Refund case machine is not available.", 400);
    }
    return await lookupGroupedLivermoreCandidates({
      supabase,
      refundCase: {
        ...refundCase,
        intake_selection_key: sanitizeText(refundCase.intake_selection_key, 80),
        intake_selection_kind: "livermore_pair",
        intake_selection_machine_ids: groupedMachineIds,
      } as GroupedRefundCase,
      actorUserId,
      lookupGeneration,
      initialFactVersion,
      incidentAt,
      lastCheckedAt,
      nayaxBaseUrl,
      windowHours,
    });
  }

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

  let qrClaimEvidenceStatus: NayaxLookupResult["qrClaimEvidenceStatus"] = "missing";
  let qrClaimOpenedAt: string | null = null;
  const qrClaimContextId = sanitizeText(refundCase?.refund_qr_claim_context_id, 80);
  if (qrClaimContextId) {
    const { data: qrClaim, error: qrClaimError } = await supabase
      .from("refund_qr_claim_contexts")
      .select("reporting_machine_id, opened_at, consumed_at")
      .eq("id", qrClaimContextId)
      .maybeSingle();
    if (qrClaimError) throw qrClaimError;

    const openedAt = parseIncidentAt(qrClaim?.opened_at);
    const consumedAt = parseIncidentAt(qrClaim?.consumed_at);
    const machineMatches =
      sanitizeText(qrClaim?.reporting_machine_id, 80) === sanitizeText(refundCase?.reporting_machine_id, 80);
    if (openedAt && consumedAt && consumedAt.getTime() >= openedAt.getTime() && machineMatches) {
      qrClaimEvidenceStatus = "verified";
      qrClaimOpenedAt = openedAt.toISOString();
    } else {
      qrClaimEvidenceStatus = "invalid";
    }
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
    incidentAt: incidentAt.toISOString(),
    customerRequestReceivedAt: refundCase?.customer_request_received_at ?? null,
    customerRequestReceivedSource: refundCase?.customer_request_received_source ?? null,
    incidentTimeResolution: sanitizeText(refundCase.incident_time_resolution, 40) || "legacy_absolute",
    incidentTimeConfidence: sanitizeText(refundCase.incident_time_confidence, 40) || "rough",
    locationTimezone: sanitizeText(location?.timezone, 80),
    qrClaimOpenedAt,
  };

  const nayaxMachineId = sanitizeText(machine?.nayax_machine_id, 120);
  const accountKey = normalizeNayaxAccountKey(machine?.nayax_account_key);
  const nayaxApiToken = resolveNayaxTokenForAccount(accountKey);
  const requiredAccountScope = `${sanitizeText(location?.name, 140) || sanitizeText(machine?.machine_label, 140) || "Selected machine"} Nayax account scope`;
  const setupResult = (
    message: string,
    recommendedAction: string,
    setupIssueCode: NonNullable<NayaxLookupResult["setupIssueCode"]>,
  ): NayaxLookupResult => ({
    configured: false,
    lookupStatus: "setup_needed",
    recommendationState: "manual_exception",
    confidenceClass: "ambiguous_manual",
    reasonCodes: ["lookup_setup_incomplete"],
    policyVersion: NAYAX_RECOMMENDATION_POLICY.version,
    oneClickEligible: false,
    qrClaimEvidenceStatus,
    qrClaimOpenedAt,
    maximumUniqueQrLagMinutes: NAYAX_RECOMMENDATION_POLICY.maximumUniqueQrLagMinutes,
    lastCheckedAt,
    candidates: [],
    candidateCount: 0,
    windowHours,
    refundCase: caseSnapshot,
    message,
    summary: message,
    recommendedAction,
    setupIssueCode,
    responsibleOwner: "refund_operations",
    requiredAccountScope,
    customerActionRequired: false,
  });

  if (!nayaxMachineId) {
    return setupResult(
      "This machine needs a Nayax machine ID before card lookup can run.",
      "Refund Operations must add the exact Nayax machine mapping, then run one safe read-only retry. Do not ask the customer to repeat the selected machine or location.",
      "machine_mapping_missing",
    );
  }
  if (!accountKey) {
    return setupResult(
      "This machine needs an explicit Nayax account scope before card lookup can run.",
      "Refund Operations must map the exact Nayax account scope, then run one safe read-only retry. Do not ask the customer to repeat details Bloomjoy owns.",
      "account_scope_missing",
    );
  }
  if (!nayaxApiToken) {
    return setupResult(
      "This machine's separate Nayax account scope is not connected for read-only lookup.",
      "Refund Operations must connect the required account scope, then run one safe read-only retry or use the reviewed manual Nayax portal fallback. Do not ask the customer to repeat purchase details.",
      "account_access_unavailable",
    );
  }

  const providerClockContext = await loadNayaxProviderClockContext(supabase, {
    reportingMachineId: machineId, accountKey, nayaxMachineId,
  });
  const providerHeaders = {
    Authorization: `Bearer ${nayaxApiToken}`,
    "Content-Type": "application/json",
  };
  const optionalProviderPayload = async (endpointName: string) => {
    try {
      const { response: optionalResponse, payload } = await fetchBoundedNayaxJson({
        url: `${nayaxBaseUrl}/machines/${encodeURIComponent(nayaxMachineId)}/${endpointName}`,
        headers: providerHeaders,
        byteLimit: Math.min(getNayaxLookupResponseByteLimit(), 256 * 1024),
      });
      if (!optionalResponse.ok) {
        console.warn("optional nayax context unavailable", {
          endpoint: endpointName,
          status: optionalResponse.status,
        });
        return null;
      }
      return payload;
    } catch (error) {
      console.warn("optional nayax context failed", {
        endpoint: endpointName,
        errorType: error instanceof Error ? error.name : typeof error,
      });
      return null;
    }
  };
  const [salesResult, productsPayload, statusPayload, alertsPayload] = await Promise.all([
    fetchBoundedNayaxJson({
      url: `${nayaxBaseUrl}/machines/${encodeURIComponent(nayaxMachineId)}/lastSales`,
      headers: providerHeaders,
    }),
    optionalProviderPayload("machineProducts"),
    optionalProviderPayload("status"),
    optionalProviderPayload("lastAlerts"),
  ]);
  const response = salesResult.response;
  if (!response.ok) {
    console.warn("nayax lookup provider failure", {
      status: response.status,
      statusText: sanitizeText(response.statusText, 80) || "provider_error",
      accountKey,
    });
    throw new NayaxLookupRequestError("Unable to look up Nayax transactions.", 502);
  }

  const nayaxPayload = salesResult.payload;
  const providerRecordCount = assertProviderRecordLimit([nayaxPayload]);
  const machineContext = buildNayaxMachineContext({
    productsPayload,
    statusPayload,
    alertsPayload,
    checkedAt: lastCheckedAt,
  });
  const commonRecommendationInput = {
    payload: nayaxPayload,
    incidentAt: incidentAt.toISOString(),
    customerRequestReceivedAt: refundCase?.customer_request_received_at ?? null,
    customerRequestReceivedSource: refundCase?.customer_request_received_source ?? null,
    incidentTimeResolution: sanitizeText(refundCase?.incident_time_resolution, 40) || "legacy_absolute",
    expectedMachineId: nayaxMachineId,
    locationTimezone: sanitizeText(location?.timezone, 80),
    providerClockContext,
    requestAmountCents: sanitizeInputCents(refundCase?.payment_amount_cents),
    requestCardLast4: extractLast4(refundCase?.card_last4),
    requestCardLast4Provenance: sanitizeText(refundCase?.card_last4_provenance, 40),
    requestCardLast4Source: sanitizeText(refundCase?.card_last4_source, 40),
    requestCardNetwork: sanitizeText(refundCase?.card_network, 40),
    cardWalletUsed: Boolean(refundCase?.card_wallet_used),
    paymentInteraction: sanitizeText(refundCase?.payment_interaction, 40),
    walletDeviceKind: sanitizeText(refundCase?.wallet_device_kind, 40),
    incidentTimeSource: sanitizeText(refundCase?.incident_time_source, 40),
    nearbyAttemptCount: sanitizeText(refundCase?.nearby_attempt_count, 40),
    customerFactVersion: initialFactVersion,
    incidentTimeConfidence: sanitizeText(refundCase?.incident_time_confidence, 40) || "rough",
    machineContext,
    qrClaimOpenedAt,
    qrClaimEvidenceStatus,
    providerContract: "nayax_machine_last_sales_v1" as const,
    windowHours,
  };
  const preliminary = buildNayaxRecommendation(commonRecommendationInput) as {
    consideredTransactionIds: string[];
  };
  const transactionStates = await loadNayaxTransactionStates({
    supabase,
    caseId,
    transactionIds: preliminary.consideredTransactionIds,
  });
  const recommendation = buildNayaxRecommendation({
    ...commonRecommendationInput,
    transactionStates,
  }) as {
    policyVersion: string;
    recommendationState: NayaxRecommendationState;
    confidenceClass: NayaxConfidenceClass;
    reasonCodes: string[];
    oneClickEligible: boolean;
    qrClaimEvidenceStatus: NayaxLookupResult["qrClaimEvidenceStatus"];
    qrClaimOpenedAt: string | null;
    maximumUniqueQrLagMinutes: number;
    candidates: NayaxProviderCandidate[];
    candidateCount: number;
    providerParseableRecordCount: number;
    providerWindowRecordCount: number;
    excludedAfterRequestCount: number;
    uncertainRequestTimeCandidateCount: number;
    summary: string;
    recommendedAction: string;
  };
  const { data: currentCase, error: currentCaseError } = await supabase
    .from("refund_cases")
    .select("deterministic_fact_version")
    .eq("id", caseId)
    .maybeSingle();
  if (currentCaseError) throw currentCaseError;
  if (Number(currentCase?.deterministic_fact_version) !== initialFactVersion) {
    throw new NayaxLookupEvidenceChangedError();
  }
  const candidates = await persistNayaxLookupCandidates({
    supabase,
    caseId,
    actorUserId,
    lookupGeneration,
    candidates: recommendation.candidates.map((candidate) => ({
      ...candidate,
      reportingMachineId: machineId,
    })),
    lookupScopes: [{ reportingMachineId: machineId, accountKey, nayaxMachineId }],
  });

  return {
    configured: true,
    lookupStatus: recommendationToLookupStatus(recommendation.recommendationState),
    recommendationState: recommendation.recommendationState,
    confidenceClass: recommendation.confidenceClass,
    reasonCodes: recommendation.reasonCodes,
    policyVersion: recommendation.policyVersion,
    oneClickEligible: recommendation.oneClickEligible,
    qrClaimEvidenceStatus: recommendation.qrClaimEvidenceStatus,
    qrClaimOpenedAt: recommendation.qrClaimOpenedAt,
    maximumUniqueQrLagMinutes: recommendation.maximumUniqueQrLagMinutes,
    lastCheckedAt,
    providerRecordCount,
    providerParseableRecordCount: recommendation.providerParseableRecordCount,
    providerWindowRecordCount: recommendation.providerWindowRecordCount,
    excludedAfterRequestCount: recommendation.excludedAfterRequestCount,
    uncertainRequestTimeCandidateCount: recommendation.uncertainRequestTimeCandidateCount,
    providerClockContexts: [commonRecommendationInput.providerClockContext],
    candidateCount: recommendation.candidateCount,
    candidates,
    windowHours,
    summary: recommendation.summary,
    recommendedAction: recommendation.recommendedAction,
    refundCase: caseSnapshot,
  };
};
