import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.48.1";
import type { NayaxLookupResult } from "./nayax-lookup.ts";

type LookupTrigger = "automatic" | "manual";

export const persistNayaxLookupResult = async ({
  supabase,
  caseId,
  actorUserId,
  result,
  trigger,
  expectedFactVersion,
}: {
  supabase: SupabaseClient;
  caseId: string;
  actorUserId: string | null;
  result: NayaxLookupResult;
  trigger: LookupTrigger;
  expectedFactVersion?: number;
}) => {
  const correlationStatus = !result.configured
    ? "nayax_not_configured"
    : result.recommendationState === "ambiguous"
    ? "multiple_candidates"
    : result.recommendationState === "no_safe_match"
    ? "no_match"
    : "manual_review";
  const resolvedMachineId = typeof result.resolvedMachineId === "string" &&
      result.resolvedMachineId.trim()
    ? result.resolvedMachineId.trim()
    : null;

  let update = supabase.from("refund_cases")
    .update({
      ...(resolvedMachineId ? { reporting_machine_id: resolvedMachineId } : {}),
      status: "needs_review",
      correlation_status: correlationStatus,
      correlation_source: "nayax",
      correlation_confidence: 0,
      correlation_summary: result.configured
        ? result.summary
        : result.message || result.summary,
      automation_state: result.configured &&
          result.recommendationState === "no_safe_match"
        ? "more_info_needed"
        : "under_review",
      nayax_recommendation_state: result.recommendationState,
      nayax_recommendation_policy_version: result.policyVersion,
      nayax_recommendation_evaluated_at: result.lastCheckedAt,
      nayax_match_execution_eligible: false,
    })
    .eq("id", caseId);
  if (expectedFactVersion !== undefined) {
    update = update.eq("deterministic_fact_version", expectedFactVersion);
  }
  const { data: updatedRows, error: updateError } = await update.select("id");
  if (updateError) throw updateError;
  if (expectedFactVersion !== undefined && (updatedRows?.length ?? 0) !== 1) {
    throw new Error(
      "Refund case matching evidence changed during Nayax lookup.",
    );
  }

  const eventType = result.configured
    ? trigger === "automatic"
      ? "nayax_auto_recommendation_evaluated"
      : "nayax_recommendation_evaluated"
    : trigger === "automatic"
    ? "nayax_auto_lookup_setup_needed"
    : "nayax_lookup_setup_needed";
  const { error: eventError } = await supabase.from("refund_case_events")
    .insert({
      refund_case_id: caseId,
      actor_user_id: actorUserId,
      event_type: eventType,
      message: result.configured
        ? `${
          trigger === "automatic" ? "Automatic Nayax lookup" : "Nayax"
        } evaluated sanitized card-sale evidence for manager review.`
        : `${
          trigger === "automatic" ? "Automatic Nayax lookup" : "Nayax lookup"
        } could not run because setup is incomplete.`,
      metadata: {
        lookup_status: result.lookupStatus,
        recommendation_state: result.recommendationState,
        confidence_class: result.confidenceClass,
        reason_codes: result.reasonCodes,
        policy_version: result.policyVersion,
        candidate_count: result.candidates.length,
        recommended_rank: result.recommendationState === "high_confidence"
          ? 1
          : null,
        one_click_base_eligible: result.oneClickEligible,
        window_hours: result.windowHours,
        provider_record_count: result.providerRecordCount ?? null,
        provider_window_record_count: result.providerWindowRecordCount ?? null,
        qr_claim_evidence_status: result.qrClaimEvidenceStatus,
        deterministic_fact_version: expectedFactVersion ?? null,
        exact_machine_resolved_from_selection_scope: Boolean(resolvedMachineId),
        payload_redacted: true,
      },
    });
  if (eventError) throw eventError;
};
