import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.48.1";
import type { NayaxLookupResult } from "./nayax-lookup.ts";
import { withNayaxProviderClockDiagnostics } from "./nayax-provider-clock.mjs";

export type LookupTrigger = "automatic" | "manual" | "wallet_correction" | "scheduled";

const textValue = (value: unknown) =>
  typeof value === "string" ? value.trim() : "";

// Counts describe the returned recent-sales response, never historical coverage.
// No provider row, card detail, credential or customer text enters this record.
export const buildNayaxLookupDiagnostics = (result: NayaxLookupResult) => {
  const incident = Date.parse(result.refundCase?.incidentAt ?? "");
  const windowHours = result.windowHours;
  if (!Number.isFinite(incident) || !Number.isFinite(windowHours) || windowHours < 1 || windowHours > 24) {
    return null;
  }
  const count = (value: unknown) => Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : null;
  return withNayaxProviderClockDiagnostics({
    schemaVersion: "nayax_lookup_diagnostics_v1",
    endpoint: "machine_last_sales",
    historicalCoverage: "unknown",
    providerRecordCount: count(result.providerRecordCount),
    providerParseableRecordCount: count(result.providerParseableRecordCount),
    providerWindowRecordCount: count(result.providerWindowRecordCount),
    windowHours,
    incidentAt: new Date(incident).toISOString(),
    windowStart: new Date(incident - windowHours * 3600000).toISOString(),
    windowEnd: new Date(incident + windowHours * 3600000).toISOString(),
    incidentTimeResolution: result.refundCase?.incidentTimeResolution ?? "unknown",
    incidentTimeConfidence: result.refundCase?.incidentTimeConfidence ?? "unknown",
    locationTimezone: result.refundCase?.locationTimezone || null,
    providerTimePolicy: "authorization_gmt_else_mapped_machine_clock",
    machineTimezoneSource: "configured_location_not_verified_provider_clock",
    providerPayloadRedacted: true,
  }, result.providerClockContexts);
};

export const beginNayaxLookup = async ({
  supabase,
  caseId,
  actorUserId,
  expectedFactVersion,
  trigger,
}: {
  supabase: SupabaseClient;
  caseId: string;
  actorUserId: string | null;
  expectedFactVersion: number;
  trigger: LookupTrigger;
}) => {
  const { data, error } = await supabase.rpc("service_begin_refund_nayax_lookup", {
    p_refund_case_id: caseId,
    p_expected_fact_version: expectedFactVersion,
    p_trigger_source: trigger,
    p_actor_user_id: actorUserId,
  });
  if (error) throw error;
  const lookupGeneration = Number(data?.lookupGeneration);
  if (!Number.isInteger(lookupGeneration) || lookupGeneration < 1) {
    throw new Error("Nayax lookup generation claim failed.");
  }
  return lookupGeneration;
};

export const persistNayaxLookupResult = async ({
  supabase,
  caseId,
  actorUserId,
  result,
  trigger,
  expectedFactVersion,
  lookupGeneration,
}: {
  supabase: SupabaseClient;
  caseId: string;
  actorUserId: string | null;
  result: NayaxLookupResult;
  trigger: LookupTrigger;
  expectedFactVersion: number;
  lookupGeneration: number;
}) => {
  const { data, error } = await supabase.rpc("service_commit_refund_nayax_lookup_with_diagnostics", {
    p_refund_case_id: caseId,
    p_lookup_generation: lookupGeneration,
    p_expected_fact_version: expectedFactVersion,
    p_lookup_status: result.lookupStatus,
    p_recommendation_state: result.recommendationState,
    p_policy_version: result.policyVersion,
    p_last_checked_at: result.lastCheckedAt,
    p_summary: result.configured ? result.summary : result.message || result.summary,
    p_resolved_machine_id: textValue(result.resolvedMachineId) || null,
    p_candidate_count: result.candidateCount,
    p_trigger_source: trigger,
    p_actor_user_id: actorUserId,
    p_diagnostics: buildNayaxLookupDiagnostics(result),
  });
  if (error) throw error;
  if (data?.applied !== true) {
    throw new Error("Refund case matching evidence changed during Nayax lookup.");
  }
};

export const classifyNayaxLookupFailure = (error: unknown) => {
  const name = error instanceof Error ? error.name : typeof error;
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (name === "NayaxLookupTimeoutError" || name === "TimeoutError") {
    return { failureClass: "timeout", safeRetryEligible: true } as const;
  }
  if (name === "NayaxLookupResponseLimitError") {
    return { failureClass: "response_limit", safeRetryEligible: false } as const;
  }
  if (name === "NayaxLookupMalformedResponseError") {
    return { failureClass: "malformed_response", safeRetryEligible: true } as const;
  }
  if (name === "NayaxLookupEvidenceChangedError" || message.includes("evidence changed")) {
    return { failureClass: "evidence_changed", safeRetryEligible: false } as const;
  }
  if (name === "NayaxLookupRequestError") {
    const status = typeof (error as { status?: unknown })?.status === "number"
      ? (error as { status: number }).status
      : null;
    return {
      failureClass: "provider_error",
      safeRetryEligible: status === null || status >= 500,
    } as const;
  }
  return { failureClass: "transport_error", safeRetryEligible: true } as const;
};

export const failNayaxLookup = async ({
  supabase,
  caseId,
  actorUserId,
  expectedFactVersion,
  lookupGeneration,
  trigger,
  error: lookupError,
}: {
  supabase: SupabaseClient;
  caseId: string;
  actorUserId: string | null;
  expectedFactVersion: number;
  lookupGeneration: number;
  trigger: LookupTrigger;
  error: unknown;
}) => {
  const classification = classifyNayaxLookupFailure(lookupError);
  const { data, error } = await supabase.rpc("service_fail_refund_nayax_lookup", {
    p_refund_case_id: caseId,
    p_lookup_generation: lookupGeneration,
    p_expected_fact_version: expectedFactVersion,
    p_failure_class: classification.failureClass,
    p_safe_retry_eligible: classification.safeRetryEligible,
    p_trigger_source: trigger,
    p_actor_user_id: actorUserId,
  });
  if (error) throw error;
  return { ...classification, applied: data?.applied === true };
};
