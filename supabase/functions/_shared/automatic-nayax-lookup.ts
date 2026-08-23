import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.48.1";
import { deriveRefundMissingFields } from "./refund-deterministic-follow-up.ts";
import {
  lookupNayaxCandidatesForRefundCase,
  NAYAX_RECOMMENDATION_POLICY,
  type NayaxLookupResult,
} from "./nayax-lookup.ts";
import { persistNayaxLookupResult } from "./nayax-lookup-persistence.ts";

export type AutomaticNayaxLookupSource =
  | "hosted_intake"
  | "linked_customer_update"
  | "customer_reply_recheck";

export type AutomaticNayaxLookupCase = {
  id: string;
  status: string;
  decision: string | null;
  reporting_machine_id: string | null;
  reporting_location_id: string | null;
  intake_selection_key?: string | null;
  intake_selection_kind?: string | null;
  intake_selection_machine_ids?: string[] | null;
  incident_at: string | null;
  incident_time_resolution: string | null;
  payment_method: string | null;
  payment_amount_cents: number | null;
  card_last4: string | null;
  card_network: string | null;
  card_wallet_used: boolean | null;
  deterministic_fact_version: number;
};

type AutomaticLookupDependencies = {
  claim: (input: {
    caseId: string;
    factVersion: number;
    source: AutomaticNayaxLookupSource;
  }) => Promise<
    { claimed: boolean; runId: string | null; actionId: string | null }
  >;
  markPending: (refundCase: AutomaticNayaxLookupCase) => Promise<void>;
  lookup: (refundCase: AutomaticNayaxLookupCase) => Promise<NayaxLookupResult>;
  persist: (
    refundCase: AutomaticNayaxLookupCase,
    result: NayaxLookupResult,
  ) => Promise<void>;
  fail: (refundCase: AutomaticNayaxLookupCase, error: unknown) => Promise<void>;
  finish: (input: {
    runId: string;
    actionId: string;
    succeeded: boolean;
    reason: string;
  }) => Promise<void>;
};

const terminalStatuses = new Set(["approved", "denied", "completed", "closed"]);

export const isRefundCaseReadyForAutomaticNayaxLookup = (
  refundCase: AutomaticNayaxLookupCase,
) => {
  const hasExactLivermoreScope =
    refundCase.intake_selection_kind === "livermore_pair" &&
    Boolean(refundCase.intake_selection_key) &&
    Array.isArray(refundCase.intake_selection_machine_ids) &&
    refundCase.intake_selection_machine_ids.length === 2;
  if (
    refundCase.payment_method !== "card" ||
    refundCase.decision !== null ||
    terminalStatuses.has(refundCase.status) ||
    refundCase.status === "draft" ||
    refundCase.status === "waiting_on_customer" ||
    (!refundCase.reporting_machine_id && !hasExactLivermoreScope) ||
    !refundCase.reporting_location_id
  ) return false;

  return deriveRefundMissingFields({
    reportingMachineId: refundCase.reporting_machine_id ??
      (hasExactLivermoreScope ? "server-owned-grouped-selection" : null),
    reportingLocationId: refundCase.reporting_location_id,
    incidentAt: refundCase.incident_at,
    incidentTimeResolution: refundCase.incident_time_resolution,
    paymentMethod: refundCase.payment_method,
    paymentAmountCents: refundCase.payment_amount_cents,
    cardLast4: refundCase.card_last4,
    cardWalletUsed: refundCase.card_wallet_used,
  }).missingFields.length === 0;
};

export const coordinateAutomaticNayaxLookup = async ({
  refundCase,
  source,
  dependencies,
}: {
  refundCase: AutomaticNayaxLookupCase;
  source: AutomaticNayaxLookupSource;
  dependencies: AutomaticLookupDependencies;
}) => {
  if (!isRefundCaseReadyForAutomaticNayaxLookup(refundCase)) {
    return { status: "not_ready" as const };
  }

  const claim = await dependencies.claim({
    caseId: refundCase.id,
    factVersion: refundCase.deterministic_fact_version,
    source,
  });
  if (!claim.claimed || !claim.runId || !claim.actionId) {
    return { status: "deduplicated" as const };
  }

  try {
    await dependencies.markPending(refundCase);
    const result = await dependencies.lookup(refundCase);
    await dependencies.persist(refundCase, result);
    await dependencies.finish({
      runId: claim.runId,
      actionId: claim.actionId,
      succeeded: true,
      reason: result.configured ? "nayax_review_ready" : "nayax_setup_needed",
    });
    return { status: "completed" as const, result };
  } catch (error) {
    try {
      await dependencies.fail(refundCase, error);
    } catch (failureRecordingError) {
      console.error(
        "automatic Nayax lookup failure state could not be recorded",
        {
          errorType: failureRecordingError instanceof Error
            ? failureRecordingError.name
            : typeof failureRecordingError,
        },
      );
    }
    await dependencies.finish({
      runId: claim.runId,
      actionId: claim.actionId,
      succeeded: false,
      reason:
        error instanceof Error && error.message.includes("evidence changed")
          ? "nayax_evidence_changed"
          : "nayax_lookup_failed",
    });
    return { status: "failed" as const };
  }
};

const textValue = (value: unknown) =>
  typeof value === "string" ? value.trim() : "";

export const runAutomaticNayaxLookupIfReady = async ({
  supabase,
  caseId,
  source,
}: {
  supabase: SupabaseClient;
  caseId: string;
  source: AutomaticNayaxLookupSource;
}) => {
  const { data, error } = await supabase.from("refund_cases").select(`
    id,status,decision,reporting_machine_id,reporting_location_id,
    intake_selection_key,intake_selection_kind,intake_selection_machine_ids,incident_at,
    incident_time_resolution,payment_method,payment_amount_cents,card_last4,card_network,
    card_wallet_used,deterministic_fact_version
  `).eq("id", caseId).maybeSingle();
  if (error) throw error;
  if (!data) return { status: "not_ready" as const };
  const refundCase = data as AutomaticNayaxLookupCase;

  return await coordinateAutomaticNayaxLookup({
    refundCase,
    source,
    dependencies: {
      claim: async (
        { caseId: claimedCaseId, factVersion, source: claimSource },
      ) => {
        const runKey = `nayax_event:${claimedCaseId}:v${factVersion}`;
        const { data: runData, error: runError } = await supabase.rpc(
          "service_start_refund_automation_run",
          {
            p_run_key: runKey,
            p_trigger_source: "event",
            p_scheduled_for: null,
          },
        );
        if (runError) throw runError;
        const runId = textValue(runData?.runId ?? runData?.run_id);
        if (!runId) throw new Error("Automatic Nayax lookup run claim failed.");
        const { data: actionData, error: actionError } = await supabase.rpc(
          "service_claim_refund_automation_action",
          {
            p_run_id: runId,
            p_refund_case_id: claimedCaseId,
            p_action_key: `nayax_lookup:${claimedCaseId}:v${factVersion}`,
            p_action_type: "nayax_lookup",
            p_case_state: `ready:${claimSource}:v${factVersion}`,
            p_policy_window_start: null,
          },
        );
        if (actionError) throw actionError;
        return {
          claimed: actionData?.claimed === true,
          runId,
          actionId: textValue(actionData?.actionId ?? actionData?.action_id) ||
            null,
        };
      },
      markPending: async (currentCase) => {
        const { error: candidateError } = await supabase
          .from("refund_nayax_lookup_candidates")
          .delete()
          .eq("refund_case_id", currentCase.id);
        if (candidateError) throw candidateError;
        const { error: pendingError } = await supabase.from("refund_cases")
          .update({
            correlation_status: "needs_nayax",
            correlation_source: "nayax",
            correlation_confidence: 0,
            correlation_summary:
              "Bloomjoy is automatically checking recent Nayax sales for this case.",
            nayax_recommendation_state: null,
            nayax_recommendation_policy_version: null,
            nayax_recommendation_evaluated_at: null,
            nayax_match_execution_eligible: false,
          }).eq("id", currentCase.id)
          .eq(
            "deterministic_fact_version",
            currentCase.deterministic_fact_version,
          );
        if (pendingError) throw pendingError;
        const { error: eventError } = await supabase.from("refund_case_events")
          .insert({
            refund_case_id: currentCase.id,
            event_type: "nayax_auto_lookup_started",
            message:
              "Bloomjoy automatically started the read-only Nayax transaction lookup.",
            metadata: {
              deterministic_fact_version:
                currentCase.deterministic_fact_version,
              trigger_source: source,
              payload_redacted: true,
            },
          });
        if (eventError) throw eventError;
      },
      lookup: async (currentCase) =>
        await lookupNayaxCandidatesForRefundCase({
          supabase,
          caseId: currentCase.id,
          actorUserId: null,
          expectedFactVersion: currentCase.deterministic_fact_version,
        }),
      persist: async (currentCase, result) =>
        await persistNayaxLookupResult({
          supabase,
          caseId: currentCase.id,
          actorUserId: null,
          result,
          trigger: "automatic",
          expectedFactVersion: currentCase.deterministic_fact_version,
        }),
      fail: async (currentCase, lookupError) => {
        const evidenceChanged = lookupError instanceof Error &&
          lookupError.message.includes("evidence changed");
        if (!evidenceChanged) {
          const { error: failureUpdateError } = await supabase.from(
            "refund_cases",
          ).update({
            correlation_status: "needs_nayax",
            correlation_source: "nayax",
            correlation_confidence: 0,
            correlation_summary:
              "The automatic Nayax check failed. A manager can retry with Refresh transaction results.",
            nayax_recommendation_state: null,
            nayax_recommendation_policy_version: null,
            nayax_recommendation_evaluated_at: null,
            nayax_match_execution_eligible: false,
          }).eq("id", currentCase.id)
            .eq(
              "deterministic_fact_version",
              currentCase.deterministic_fact_version,
            );
          if (failureUpdateError) throw failureUpdateError;
        }
        await supabase.from("refund_case_events").insert({
          refund_case_id: currentCase.id,
          event_type: evidenceChanged
            ? "nayax_auto_lookup_evidence_changed"
            : "nayax_auto_lookup_failed",
          message: evidenceChanged
            ? "Matching evidence changed during the automatic lookup; the new evidence version may run once."
            : "Automatic Nayax lookup failed and the case remains open with a manager retry action.",
          metadata: {
            error_type: lookupError instanceof Error
              ? lookupError.name
              : typeof lookupError,
            policy_version: NAYAX_RECOMMENDATION_POLICY.version,
            reason_codes: [
              evidenceChanged ? "evidence_changed" : "lookup_failed",
            ],
            deterministic_fact_version: currentCase.deterministic_fact_version,
            payload_redacted: true,
          },
        });
      },
      finish: async ({ runId, actionId, succeeded, reason }) => {
        await supabase.rpc("service_finish_refund_automation_action", {
          p_action_id: actionId,
          p_status: succeeded ? "completed" : "failed",
          p_reason_category: reason,
          p_message_id: null,
        });
        await supabase.rpc("service_finish_refund_automation_run", {
          p_run_id: runId,
          p_status: succeeded ? "succeeded" : "failed",
          p_cases_evaluated: 1,
          p_actions_attempted: 1,
          p_actions_succeeded: succeeded ? 1 : 0,
          p_actions_failed: succeeded ? 0 : 1,
          p_actions_suppressed: 0,
          p_reason_counts: { [reason]: 1 },
          p_failure_category: succeeded ? null : reason,
          p_alert_status: "not_needed",
        });
      },
    },
  });
};
