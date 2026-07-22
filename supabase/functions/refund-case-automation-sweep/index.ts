import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.1";
import { corsHeaders } from "../_shared/cors.ts";
import { sendInternalEmail } from "../_shared/internal-email.ts";
import {
  lookupNayaxCandidatesForRefundCase,
  NayaxLookupRequestError,
} from "../_shared/nayax-lookup.ts";
import {
  buildRefundCustomerEmail,
  sendRefundCustomerEmail,
  type RefundCustomerMessageType,
} from "../_shared/refund-email.ts";
import { resolveRefundPublicLabels } from "../_shared/refund-location.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const sweepSecret = Deno.env.get("REFUND_AUTOMATION_SWEEP_SECRET") || Deno.env.get("REPORT_SCHEDULER_SECRET");
const automationEnabled = (Deno.env.get("REFUND_AUTOMATION_ENABLED") || "false").toLowerCase() === "true";
const reminderDelayDays = Number(Deno.env.get("REFUND_MORE_INFO_REMINDER_DAYS") || 2);
const escalationDays = Number(Deno.env.get("REFUND_ESCALATION_DAYS") || 5);
const automationTimezone = Deno.env.get("REFUND_AUTOMATION_TIMEZONE") || "America/Los_Angeles";
const policyStartHour = Number(Deno.env.get("REFUND_AUTOMATION_START_HOUR") || 8);
const policyEndHour = Number(Deno.env.get("REFUND_AUTOMATION_END_HOUR") || 20);

class RefundAutomationActionFailure extends Error {
  constructor() {
    super("One or more refund automation actions failed.");
    this.name = "RefundAutomationActionFailure";
  }
}

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

const parseBearerToken = (authorizationHeader: string | null) => {
  const match = authorizationHeader?.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? "";
};

const isAuthorized = (req: Request) => {
  const provided = parseBearerToken(req.headers.get("Authorization")) ||
    req.headers.get("x-scheduler-secret")?.trim();
  return Boolean(sweepSecret && provided && provided === sweepSecret);
};

const daysAgoIso = (days: number) =>
  new Date(Date.now() - Math.max(0, days) * 24 * 60 * 60 * 1000).toISOString();

const safeInteger = (value: number, fallback: number, minimum: number, maximum: number) =>
  Number.isFinite(value) ? Math.min(maximum, Math.max(minimum, Math.floor(value))) : fallback;

const normalizeRunKey = (value: unknown) => {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length >= 8 && normalized.length <= 160 && /^[A-Za-z0-9:_-]+$/.test(normalized)
    ? normalized
    : null;
};

const schedulerWindowStart = (value: Date) => {
  const intervalMs = 15 * 60 * 1000;
  return new Date(Math.floor(value.getTime() / intervalMs) * intervalMs);
};

const buildDefaultRunKey = (triggerSource: "scheduled" | "manual", now: Date) => {
  const bucket = schedulerWindowStart(now).toISOString().replace(/[.]/g, "-");
  return `${triggerSource}:${bucket}`;
};

const keyTimestamp = (value: string | null | undefined, fallback: string) => {
  if (!value) return fallback;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString().replace(/[.]/g, "-") : fallback;
};

const getLocalHour = (date: Date, timeZone: string) => {
  try {
    const hour = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "2-digit",
      hour12: false,
    }).formatToParts(date).find((part) => part.type === "hour")?.value;
    const numericHour = Number(hour);
    return Number.isFinite(numericHour) ? numericHour % 24 : null;
  } catch {
    return null;
  }
};

const policyWindowIsOpen = (date: Date) => {
  const localHour = getLocalHour(date, automationTimezone);
  if (localHour === null) return false;
  const startHour = safeInteger(policyStartHour, 8, 0, 23);
  const endHour = safeInteger(policyEndHour, 20, 0, 23);
  if (startHour === endHour) return true;
  return startHour < endHour
    ? localHour >= startHour && localHour < endHour
    : localHour >= startHour || localHour < endHour;
};

const sanitizeFailureCategory = (error: unknown) => {
  if (error instanceof RefundAutomationActionFailure) return "action_failure";
  if (error instanceof NayaxLookupRequestError) return "nayax_provider_failure";
  if (error && typeof error === "object" && "code" in error) return "database_failure";
  if (error instanceof TypeError) return "network_or_contract_failure";
  return "unexpected_failure";
};

type RefundSweepCase = {
  id: string;
  public_reference: string;
  status: string;
  automation_state: string;
  automation_follow_up_due_at: string | null;
  customer_last_contacted_at: string | null;
  customer_email: string;
  customer_name: string | null;
  payment_method: string;
  payment_amount_cents: number | null;
  refund_amount_cents: number | null;
  created_at: string;
  reporting_machines?: {
    machine_label: string | null;
    refund_public_display_label: string | null;
  } | null;
  reporting_locations?: { name: string | null } | null;
};

type OneOrMany<T> = T | T[] | null | undefined;

type RawRefundSweepCase = Omit<RefundSweepCase, "reporting_machines" | "reporting_locations"> & {
  reporting_machines?: OneOrMany<{
    machine_label: string | null;
    refund_public_display_label: string | null;
  }>;
  reporting_locations?: OneOrMany<{ name: string | null }>;
};

type SweepCounters = {
  evaluatedCaseIds: Set<string>;
  actionsAttempted: number;
  actionsSucceeded: number;
  actionsFailed: number;
  actionsSuppressed: number;
  reasonCounts: Record<string, number>;
  nayaxLookupsRun: number;
  nayaxCandidatesFound: number;
  nayaxNoMatchMovedToWaiting: number;
  nayaxLookupFailures: number;
  nayaxSetupNeeded: number;
  remindersSent: number;
  remindersFailed: number;
  escalationsSent: number;
  escalationsFailed: number;
};

type ClaimedAction = {
  actionId: string | null;
  claimed: boolean;
};

type RefundAutomationHealth = {
  status?: string;
  lastRunAt?: string | null;
  lastSuccessAt?: string | null;
  consecutiveFailures?: number;
};

const createCounters = (): SweepCounters => ({
  evaluatedCaseIds: new Set<string>(),
  actionsAttempted: 0,
  actionsSucceeded: 0,
  actionsFailed: 0,
  actionsSuppressed: 0,
  reasonCounts: {},
  nayaxLookupsRun: 0,
  nayaxCandidatesFound: 0,
  nayaxNoMatchMovedToWaiting: 0,
  nayaxLookupFailures: 0,
  nayaxSetupNeeded: 0,
  remindersSent: 0,
  remindersFailed: 0,
  escalationsSent: 0,
  escalationsFailed: 0,
});

const addReason = (counters: SweepCounters, reason: string, count = 1) => {
  counters.reasonCounts[reason] = (counters.reasonCounts[reason] ?? 0) + count;
};

const redactedSummary = (counters: SweepCounters) => ({
  casesEvaluated: counters.evaluatedCaseIds.size,
  actionsAttempted: counters.actionsAttempted,
  actionsSucceeded: counters.actionsSucceeded,
  actionsFailed: counters.actionsFailed,
  actionsSuppressed: counters.actionsSuppressed,
  reasonCounts: counters.reasonCounts,
  nayaxLookupsRun: counters.nayaxLookupsRun,
  nayaxCandidatesFound: counters.nayaxCandidatesFound,
  nayaxNoMatchMovedToWaiting: counters.nayaxNoMatchMovedToWaiting,
  nayaxLookupFailures: counters.nayaxLookupFailures,
  nayaxSetupNeeded: counters.nayaxSetupNeeded,
  remindersSent: counters.remindersSent,
  remindersFailed: counters.remindersFailed,
  escalationsSent: counters.escalationsSent,
  escalationsFailed: counters.escalationsFailed,
  payloadRedacted: true,
});

const firstRelation = <T>(value: OneOrMany<T>) =>
  Array.isArray(value) ? value[0] ?? null : value ?? null;

const normalizeRefundSweepCase = (refundCase: RawRefundSweepCase): RefundSweepCase => ({
  ...refundCase,
  reporting_machines: firstRelation(refundCase.reporting_machines),
  reporting_locations: firstRelation(refundCase.reporting_locations),
});

const caseSelect = `
  id,
  public_reference,
  status,
  automation_state,
  automation_follow_up_due_at,
  customer_last_contacted_at,
  customer_email,
  customer_name,
  payment_method,
  payment_amount_cents,
  refund_amount_cents,
  created_at,
  reporting_machines(machine_label, refund_public_display_label),
  reporting_locations(name)
`;

const startRun = async (
  runKey: string,
  triggerSource: "scheduled" | "manual" | "health_check" | "failure_test",
  scheduledFor: string,
) => {
  if (!supabase) throw new Error("Refund automation is not configured.");
  const { data, error } = await supabase.rpc("service_start_refund_automation_run", {
    p_run_key: runKey,
    p_trigger_source: triggerSource,
    p_scheduled_for: scheduledFor,
  });
  if (error) throw error;
  return data as { runId?: string; claimed?: boolean; status?: string };
};

const claimAction = async (
  runId: string,
  refundCaseId: string | null,
  actionKey: string,
  actionType: "nayax_lookup" | "customer_reminder" | "customer_more_info" | "internal_escalation" | "ops_alert",
  caseState: string | null,
  policyWindowStart: string,
  counters: SweepCounters,
): Promise<ClaimedAction> => {
  if (!supabase) throw new Error("Refund automation is not configured.");
  const { data, error } = await supabase.rpc("service_claim_refund_automation_action", {
    p_run_id: runId,
    p_refund_case_id: refundCaseId,
    p_action_key: actionKey,
    p_action_type: actionType,
    p_case_state: caseState,
    p_policy_window_start: policyWindowStart,
  });
  if (error) throw error;
  const result = data as { actionId?: string; claimed?: boolean };
  if (result.claimed === true) {
    counters.actionsAttempted += 1;
  } else {
    counters.actionsSuppressed += 1;
    addReason(counters, "duplicate_action");
  }
  return {
    actionId: typeof result.actionId === "string" ? result.actionId : null,
    claimed: result.claimed === true,
  };
};

const finishAction = async (
  action: ClaimedAction,
  status: "completed" | "failed" | "suppressed",
  reasonCategory: string,
  messageId: string | null,
  counters: SweepCounters,
) => {
  if (!supabase || !action.actionId || !action.claimed) return;
  const { data, error } = await supabase.rpc("service_finish_refund_automation_action", {
    p_action_id: action.actionId,
    p_status: status,
    p_reason_category: reasonCategory,
    p_message_id: messageId,
  });
  if (error) throw error;
  if (data !== true) throw new Error("Refund automation action could not be finalized.");
  if (status === "completed") counters.actionsSucceeded += 1;
  if (status === "failed") counters.actionsFailed += 1;
  if (status === "suppressed") counters.actionsSuppressed += 1;
  addReason(counters, reasonCategory);
};

const finishRun = async (
  runId: string,
  status: "succeeded" | "failed" | "suppressed",
  counters: SweepCounters,
  failureCategory: string | null = null,
  alertStatus: "not_needed" | "pending" | "sent" | "failed" | "suppressed" = "not_needed",
) => {
  if (!supabase) throw new Error("Refund automation is not configured.");
  const { data, error } = await supabase.rpc("service_finish_refund_automation_run", {
    p_run_id: runId,
    p_status: status,
    p_cases_evaluated: counters.evaluatedCaseIds.size,
    p_actions_attempted: counters.actionsAttempted,
    p_actions_succeeded: counters.actionsSucceeded,
    p_actions_failed: counters.actionsFailed,
    p_actions_suppressed: counters.actionsSuppressed,
    p_reason_counts: counters.reasonCounts,
    p_failure_category: failureCategory,
    p_alert_status: alertStatus,
  });
  if (error) throw error;
  if (data !== true) throw new Error("Refund automation run could not be finalized.");
};

const getAutomationHealth = async (): Promise<RefundAutomationHealth> => {
  if (!supabase) throw new Error("Refund automation is not configured.");
  const { data, error } = await supabase.rpc("service_get_refund_automation_health");
  if (error) throw error;
  return (data ?? {}) as RefundAutomationHealth;
};

const logMessage = async (
  refundCase: RefundSweepCase,
  messageType: RefundCustomerMessageType,
  status: "pending" | "sent" | "failed" | "skipped",
  errorMessage?: string | null,
) => {
  if (!supabase) return null;
  const publicLabels = resolveRefundPublicLabels({
    locationName: refundCase.reporting_locations?.name,
    publicMachineLabel: refundCase.reporting_machines?.refund_public_display_label,
    machineLabel: refundCase.reporting_machines?.machine_label,
  });
  const email = buildRefundCustomerEmail({
    messageType,
    publicReference: refundCase.public_reference,
    customerName: refundCase.customer_name,
    customerEmail: refundCase.customer_email,
    machineLabel: publicLabels.machineLabel,
    locationName: publicLabels.locationName,
    refundAmountCents: refundCase.refund_amount_cents ?? refundCase.payment_amount_cents,
    paymentMethod: refundCase.payment_method,
  });

  const { data, error } = await supabase
    .from("refund_case_messages")
    .insert({
      refund_case_id: refundCase.id,
      message_type: messageType,
      status,
      recipient_email: refundCase.customer_email,
      subject: email.subject,
      body: email.text,
      template_key: `refund_${messageType}_v1`,
      sent_at: status === "sent" ? new Date().toISOString() : null,
      error_message: errorMessage ?? null,
    })
    .select("id")
    .single();

  if (error) throw error;
  return data?.id ?? null;
};

const sendCustomerSweepMessage = async (
  refundCase: RefundSweepCase,
  messageType: RefundCustomerMessageType,
) => {
  const messageId = await logMessage(refundCase, messageType, "pending");
  const publicLabels = resolveRefundPublicLabels({
    locationName: refundCase.reporting_locations?.name,
    publicMachineLabel: refundCase.reporting_machines?.refund_public_display_label,
    machineLabel: refundCase.reporting_machines?.machine_label,
  });

  try {
    await sendRefundCustomerEmail({
      messageType,
      publicReference: refundCase.public_reference,
      customerName: refundCase.customer_name,
      customerEmail: refundCase.customer_email,
      machineLabel: publicLabels.machineLabel,
      locationName: publicLabels.locationName,
      refundAmountCents: refundCase.refund_amount_cents ?? refundCase.payment_amount_cents,
      paymentMethod: refundCase.payment_method,
    });

    if (messageId) {
      const { error: messageUpdateError } = await supabase
        ?.from("refund_case_messages")
        .update({ status: "sent", sent_at: new Date().toISOString() })
        .eq("id", messageId) ?? { error: null };
      if (messageUpdateError) throw messageUpdateError;
    }

    const { error: caseUpdateError } = await supabase
      ?.from("refund_cases")
      .update({
        customer_last_contacted_at: new Date().toISOString(),
        last_customer_message_type: messageType,
        automation_follow_up_due_at:
          messageType === "more_info" || messageType === "reminder"
            ? new Date(Date.now() + reminderDelayDays * 24 * 60 * 60 * 1000).toISOString()
            : null,
      })
      .eq("id", refundCase.id) ?? { error: null };
    if (caseUpdateError) throw caseUpdateError;

    const { error: eventError } = await supabase?.from("refund_case_events").insert({
      refund_case_id: refundCase.id,
      event_type: "automation_sweep_message",
      message: `Automated ${messageType.replaceAll("_", " ")} email sent.`,
      metadata: {
        message_type: messageType,
        message_id: messageId,
        payload_redacted: true,
      },
    }) ?? { error: null };
    if (eventError) throw eventError;

    return { status: "sent" as const, messageId };
  } catch (error) {
    console.error("refund-case-automation-sweep customer email failed", {
      errorType: error instanceof Error ? error.name : typeof error,
      messageType,
    });

    if (messageId) {
      await supabase
        ?.from("refund_case_messages")
        .update({
          status: "failed",
          error_message: "customer_email_delivery_failed",
        })
        .eq("id", messageId);
    }

    return { status: "failed" as const, messageId };
  }
};

const escalateStaleCase = async (refundCase: RefundSweepCase) => {
  const publicLabels = resolveRefundPublicLabels({
    locationName: refundCase.reporting_locations?.name,
    publicMachineLabel: refundCase.reporting_machines?.refund_public_display_label,
    machineLabel: refundCase.reporting_machines?.machine_label,
  });
  await sendInternalEmail({
    subject: `Refund case needs attention: ${refundCase.public_reference}`,
    text: [
      "A Bloomjoy refund case needs attention.",
      "",
      `Reference: ${refundCase.public_reference}`,
      `Status: ${refundCase.status}`,
      `Machine: ${publicLabels.machineLabel}`,
      `Location: ${publicLabels.locationName}`,
      "",
      "Customer PII, payment details, complaint text, and provider payloads are intentionally omitted from this alert.",
    ].join("\n"),
  });

  const { error: caseUpdateError } = await supabase?.from("refund_cases")
    .update({
      automation_state: "escalated",
      automation_follow_up_due_at: null,
    })
    .eq("id", refundCase.id) ?? { error: null };
  if (caseUpdateError) throw caseUpdateError;

  const { error: eventError } = await supabase?.from("refund_case_events").insert({
    refund_case_id: refundCase.id,
    event_type: "automation_escalated",
    message: "Refund case escalated by automation sweep.",
    metadata: {
      public_reference: refundCase.public_reference,
      status: refundCase.status,
      payload_redacted: true,
    },
  }) ?? { error: null };
  if (eventError) throw eventError;
};

const sendAutomationHealthAlert = async (
  alertKind: "stale" | "repeated_failure" | "failure_test",
  health: RefundAutomationHealth,
) => {
  const label = alertKind === "failure_test"
    ? "failure-test alert"
    : alertKind === "stale"
      ? "stale scheduler"
      : "repeated scheduler failures";
  await sendInternalEmail({
    subject: `[Action needed] Refund automation ${label}`,
    text: [
      "Bloomjoy Refund Operations automation needs attention.",
      "",
      `Alert category: ${label}`,
      `Health state: ${health.status ?? "unknown"}`,
      `Last run: ${health.lastRunAt ?? "not recorded"}`,
      `Last successful run: ${health.lastSuccessAt ?? "not recorded"}`,
      `Consecutive failures: ${health.consecutiveFailures ?? 0}`,
      "",
      "No customer names, email addresses, payment details, complaint text, or provider payloads are included.",
      "The core refund case workflow remains available. Check the Refunds health banner and the scheduled GitHub workflow before re-enabling automation.",
    ].join("\n"),
  });
};

const runCardNayaxLookupSweep = async (
  runId: string,
  counters: SweepCounters,
  policyWindowStart: string,
) => {
  if (!supabase) return;
  const { data: lookupCases, error: lookupCasesError } = await supabase
    .from("refund_cases")
    .select(caseSelect)
    .eq("payment_method", "card")
    .eq("status", "needs_review")
    .in("correlation_status", ["not_started", "needs_nayax", "nayax_not_configured"])
    .limit(10);

  if (lookupCasesError) throw lookupCasesError;

  for (const rawRefundCase of (lookupCases ?? []) as unknown as RawRefundSweepCase[]) {
    const refundCase = normalizeRefundSweepCase(rawRefundCase);
    counters.evaluatedCaseIds.add(refundCase.id);
    const action = await claimAction(
      runId,
      refundCase.id,
      `nayax_lookup:${refundCase.id}:${new Date().toISOString().slice(0, 10)}`,
      "nayax_lookup",
      refundCase.status,
      policyWindowStart,
      counters,
    );
    if (!action.claimed) continue;

    try {
      const lookupResult = await lookupNayaxCandidatesForRefundCase({
        supabase,
        caseId: refundCase.id,
        actorUserId: null,
      });
      counters.nayaxLookupsRun += 1;

      if (!lookupResult.configured) {
        counters.nayaxSetupNeeded += 1;
        const { error: updateError } = await supabase.from("refund_cases")
          .update({
            correlation_status: "nayax_not_configured",
            correlation_source: "nayax",
            correlation_confidence: 0,
            correlation_summary: lookupResult.message || "Nayax lookup needs setup before card matching can run.",
            automation_state: "under_review",
            nayax_recommendation_state: "manual_exception",
            nayax_recommendation_policy_version: lookupResult.policyVersion,
            nayax_recommendation_evaluated_at: lookupResult.lastCheckedAt,
            nayax_match_execution_eligible: false,
          })
          .eq("id", refundCase.id);
        if (updateError) throw updateError;

        const { error: eventError } = await supabase.from("refund_case_events").insert({
          refund_case_id: refundCase.id,
          event_type: "nayax_auto_lookup_setup_needed",
          message: "Automated Nayax lookup could not run because setup is incomplete.",
          metadata: { configured: false, payload_redacted: true },
        });
        if (eventError) throw eventError;
        await finishAction(action, "completed", "nayax_setup_needed", null, counters);
        continue;
      }

      if (lookupResult.recommendationState !== "no_safe_match") {
        counters.nayaxCandidatesFound += lookupResult.candidates.length;
        const correlationStatus = lookupResult.recommendationState === "ambiguous"
          ? "multiple_candidates"
          : "manual_review";
        const { error: updateError } = await supabase.from("refund_cases")
          .update({
            status: "needs_review",
            correlation_status: correlationStatus,
            correlation_source: "nayax",
            correlation_confidence: 0,
            correlation_summary: lookupResult.summary,
            automation_state: "under_review",
            nayax_recommendation_state: lookupResult.recommendationState,
            nayax_recommendation_policy_version: lookupResult.policyVersion,
            nayax_recommendation_evaluated_at: lookupResult.lastCheckedAt,
            nayax_match_execution_eligible: false,
          })
          .eq("id", refundCase.id);
        if (updateError) throw updateError;

        const { error: eventError } = await supabase.from("refund_case_events").insert({
          refund_case_id: refundCase.id,
          event_type: "nayax_auto_recommendation_evaluated",
          message: "Automated Nayax lookup evaluated sanitized card-sale evidence for manager review.",
          metadata: {
            recommendation_state: lookupResult.recommendationState,
            policy_version: lookupResult.policyVersion,
            candidate_count: lookupResult.candidates.length,
            recommended_rank: lookupResult.recommendationState === "high_confidence" ? 1 : null,
            one_click_base_eligible: lookupResult.oneClickEligible,
            window_hours: lookupResult.windowHours,
            provider_record_count: lookupResult.providerRecordCount ?? null,
            provider_window_record_count: lookupResult.providerWindowRecordCount ?? null,
            payload_redacted: true,
          },
        });
        if (eventError) throw eventError;
        await finishAction(action, "completed", "nayax_review_ready", null, counters);
        continue;
      }

      const moreInfoResult = await sendCustomerSweepMessage(
        { ...refundCase, status: "waiting_on_customer", automation_state: "more_info_needed" },
        "more_info",
      );

      if (moreInfoResult.status === "sent") {
        const { error: updateError } = await supabase.from("refund_cases")
          .update({
            status: "waiting_on_customer",
            correlation_status: "no_match",
            correlation_source: "nayax",
            correlation_confidence: 0,
            correlation_summary: `${lookupResult.summary} More information requested from the customer.`,
            automation_state: "more_info_needed",
            nayax_recommendation_state: lookupResult.recommendationState,
            nayax_recommendation_policy_version: lookupResult.policyVersion,
            nayax_recommendation_evaluated_at: lookupResult.lastCheckedAt,
            nayax_match_execution_eligible: false,
            automation_follow_up_due_at: new Date(Date.now() + reminderDelayDays * 24 * 60 * 60 * 1000).toISOString(),
          })
          .eq("id", refundCase.id);
        if (updateError) throw updateError;
        counters.nayaxNoMatchMovedToWaiting += 1;

        const { error: eventError } = await supabase.from("refund_case_events").insert({
          refund_case_id: refundCase.id,
          event_type: "nayax_auto_lookup_no_match",
          message: "Automated Nayax lookup found no candidate, so the customer was asked for more information.",
          metadata: {
            window_hours: lookupResult.windowHours,
            candidate_count: lookupResult.candidates.length,
            recommendation_state: lookupResult.recommendationState,
            policy_version: lookupResult.policyVersion,
            provider_record_count: lookupResult.providerRecordCount ?? null,
            provider_window_record_count: lookupResult.providerWindowRecordCount ?? null,
            payload_redacted: true,
          },
        });
        if (eventError) throw eventError;
        await finishAction(action, "completed", "nayax_no_match_customer_contacted", moreInfoResult.messageId, counters);
      } else {
        const { error: eventError } = await supabase.from("refund_case_events").insert({
          refund_case_id: refundCase.id,
          event_type: "nayax_auto_lookup_no_match_message_failed",
          message: "Automated Nayax lookup found no candidate, but customer email failed so the case remains in manager review.",
          metadata: {
            window_hours: lookupResult.windowHours,
            provider_record_count: lookupResult.providerRecordCount ?? null,
            provider_window_record_count: lookupResult.providerWindowRecordCount ?? null,
            payload_redacted: true,
          },
        });
        if (eventError) throw eventError;
        await finishAction(action, "failed", "customer_email_failed", moreInfoResult.messageId, counters);
      }
    } catch (error) {
      counters.nayaxLookupFailures += 1;
      console.error("refund-case-automation-sweep Nayax lookup failed", {
        errorType: error instanceof Error ? error.name : typeof error,
      });
      await supabase.from("refund_case_events").insert({
        refund_case_id: refundCase.id,
        event_type: "nayax_auto_lookup_failed",
        message: "Automated Nayax lookup failed and the case remains in manager review.",
        metadata: {
          error_type: sanitizeFailureCategory(error),
          payload_redacted: true,
        },
      });
      await finishAction(action, "failed", sanitizeFailureCategory(error), null, counters);
    }
  }
};

const runReminderSweep = async (
  runId: string,
  counters: SweepCounters,
  policyWindowStart: string,
) => {
  if (!supabase) return;
  const dueCutoff = new Date().toISOString();
  const reminderCutoff = daysAgoIso(Number.isFinite(reminderDelayDays) ? reminderDelayDays : 2);
  const { data: reminderCases, error: reminderError } = await supabase
    .from("refund_cases")
    .select(caseSelect)
    .eq("status", "waiting_on_customer")
    .lte("automation_follow_up_due_at", dueCutoff)
    .limit(25);
  if (reminderError) throw reminderError;

  for (const rawRefundCase of (reminderCases ?? []) as unknown as RawRefundSweepCase[]) {
    const refundCase = normalizeRefundSweepCase(rawRefundCase);
    counters.evaluatedCaseIds.add(refundCase.id);
    if (refundCase.customer_last_contacted_at && refundCase.customer_last_contacted_at > reminderCutoff) {
      counters.actionsSuppressed += 1;
      addReason(counters, "customer_contact_not_due");
      continue;
    }

    const action = await claimAction(
      runId,
      refundCase.id,
      `reminder:${refundCase.id}:${keyTimestamp(refundCase.automation_follow_up_due_at, "due")}`,
      "customer_reminder",
      refundCase.status,
      policyWindowStart,
      counters,
    );
    if (!action.claimed) continue;

    const result = await sendCustomerSweepMessage(refundCase, "reminder");
    if (result.status === "sent") {
      counters.remindersSent += 1;
      await finishAction(action, "completed", "reminder_sent", result.messageId, counters);
    } else {
      counters.remindersFailed += 1;
      await finishAction(action, "failed", "customer_email_failed", result.messageId, counters);
    }
  }
};

const runEscalationSweep = async (
  runId: string,
  counters: SweepCounters,
  policyWindowStart: string,
) => {
  if (!supabase) return;
  const escalationCutoff = daysAgoIso(Number.isFinite(escalationDays) ? escalationDays : 5);
  const { data: staleCases, error: staleError } = await supabase
    .from("refund_cases")
    .select(caseSelect)
    .in("status", ["needs_review", "waiting_on_customer", "approved", "card_refund_pending", "cash_zelle_pending"])
    .lte("created_at", escalationCutoff)
    .neq("automation_state", "escalated")
    .limit(25);
  if (staleError) throw staleError;

  for (const rawRefundCase of (staleCases ?? []) as unknown as RawRefundSweepCase[]) {
    const refundCase = normalizeRefundSweepCase(rawRefundCase);
    counters.evaluatedCaseIds.add(refundCase.id);
    const action = await claimAction(
      runId,
      refundCase.id,
      `escalation:${refundCase.id}:${keyTimestamp(refundCase.created_at, "created")}`,
      "internal_escalation",
      refundCase.status,
      policyWindowStart,
      counters,
    );
    if (!action.claimed) continue;

    try {
      await escalateStaleCase(refundCase);
      counters.escalationsSent += 1;
      await finishAction(action, "completed", "escalation_sent", null, counters);
    } catch (error) {
      counters.escalationsFailed += 1;
      console.error("refund-case-automation-sweep internal escalation failed", {
        errorType: error instanceof Error ? error.name : typeof error,
      });
      await finishAction(action, "failed", sanitizeFailureCategory(error), null, counters);
    }
  }
};

const runHealthCheck = async (
  runId: string,
  runKey: string,
  counters: SweepCounters,
  policyWindowStart: string,
) => {
  const health = await getAutomationHealth();
  const alertKind = health.status === "stale"
    ? "stale"
    : health.status === "failing" && (health.consecutiveFailures ?? 0) >= 2
      ? "repeated_failure"
      : null;

  if (!alertKind) {
    await finishRun(runId, "succeeded", counters);
    return { health, alertStatus: "not_needed" };
  }

  const healthFingerprint = keyTimestamp(health.lastSuccessAt ?? health.lastRunAt, "never").slice(0, 19);
  const action = await claimAction(
    runId,
    null,
    `ops_alert:${alertKind}:${healthFingerprint}`,
    "ops_alert",
    null,
    policyWindowStart,
    counters,
  );

  if (!action.claimed) {
    await finishRun(runId, "succeeded", counters, null, "suppressed");
    return { health, alertStatus: "suppressed" };
  }

  try {
    await sendAutomationHealthAlert(alertKind, health);
    await finishAction(action, "completed", `${alertKind}_alert_sent`, null, counters);
    await finishRun(runId, "succeeded", counters, null, "sent");
    return { health, alertStatus: "sent" };
  } catch (error) {
    console.error("refund-case-automation-sweep health alert failed", {
      errorType: error instanceof Error ? error.name : typeof error,
      runKey,
    });
    await finishAction(action, "failed", "ops_alert_delivery_failed", null, counters);
    await finishRun(runId, "failed", counters, "ops_alert_delivery_failed", "failed");
    return { health, alertStatus: "failed" };
  }
};

const runFailureTest = async (
  runId: string,
  runKey: string,
  counters: SweepCounters,
  policyWindowStart: string,
) => {
  const action = await claimAction(
    runId,
    null,
    `ops_alert:failure_test:${runKey}`,
    "ops_alert",
    null,
    policyWindowStart,
    counters,
  );
  const health = await getAutomationHealth();
  let alertStatus: "sent" | "failed" | "suppressed" = "suppressed";

  if (action.claimed) {
    try {
      await sendAutomationHealthAlert("failure_test", health);
      await finishAction(action, "completed", "failure_test_alert_sent", null, counters);
      alertStatus = "sent";
    } catch (error) {
      console.error("refund-case-automation-sweep failure-test alert failed", {
        errorType: error instanceof Error ? error.name : typeof error,
      });
      await finishAction(action, "failed", "ops_alert_delivery_failed", null, counters);
      alertStatus = "failed";
    }
  }

  await finishRun(runId, "failed", counters, "synthetic_failure_test", alertStatus);
  return alertStatus;
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  let runId: string | null = null;
  let runKey: string | null = null;
  const counters = createCounters();

  try {
    if (req.method !== "POST") {
      return jsonResponse({ error: "Method not allowed." }, 405);
    }
    if (!supabase) {
      return jsonResponse({ error: "Refund automation sweep is not configured." }, 500);
    }
    if (!isAuthorized(req)) {
      return jsonResponse({ error: "Unauthorized." }, 401);
    }

    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const mode = body?.mode === "health_check" || body?.mode === "failure_test" ? body.mode : "run";
    const now = new Date();
    const scheduledAtCandidate = typeof body?.scheduledAt === "string" ? new Date(body.scheduledAt) : now;
    const scheduledAt = Number.isFinite(scheduledAtCandidate.getTime()) ? scheduledAtCandidate : now;
    const triggerSource = mode === "health_check"
      ? "health_check"
      : mode === "failure_test"
        ? "failure_test"
        : body?.triggerSource === "manual"
          ? "manual"
          : "scheduled";
    const suppliedRunKey = normalizeRunKey(body?.runKey);
    const defaultRunKey = triggerSource === "scheduled" || triggerSource === "manual"
      ? buildDefaultRunKey(triggerSource, scheduledAt)
      : `${triggerSource}:${schedulerWindowStart(scheduledAt).toISOString().replace(/[.]/g, "-")}`;
    runKey = suppliedRunKey ?? defaultRunKey;

    const startedRun = await startRun(runKey, triggerSource, scheduledAt.toISOString());
    runId = typeof startedRun.runId === "string" ? startedRun.runId : null;
    if (!runId) throw new Error("Refund automation run could not be started.");
    if (startedRun.claimed !== true) {
      counters.actionsSuppressed += 1;
      addReason(counters, "duplicate_run");
      return jsonResponse({
        status: "duplicate_suppressed",
        runKey,
        existingRunStatus: startedRun.status ?? "unknown",
        ...redactedSummary(counters),
      });
    }

    const policyWindowStart = schedulerWindowStart(scheduledAt).toISOString();

    if (mode === "health_check") {
      const result = await runHealthCheck(runId, runKey, counters, policyWindowStart);
      return jsonResponse({
        status: result.alertStatus === "failed" ? "failed" : "health_checked",
        runKey,
        healthStatus: result.health.status ?? "unknown",
        lastSuccessAt: result.health.lastSuccessAt ?? null,
        alertStatus: result.alertStatus,
        ...redactedSummary(counters),
      }, result.alertStatus === "failed" ? 502 : 200);
    }

    if (mode === "failure_test") {
      const alertStatus = await runFailureTest(runId, runKey, counters, policyWindowStart);
      return jsonResponse({
        status: alertStatus === "sent" ? "failure_test_recorded" : "failure_test_alert_failed",
        runKey,
        alertStatus,
        ...redactedSummary(counters),
      }, alertStatus === "sent" ? 200 : 502);
    }

    if (!automationEnabled) {
      counters.actionsSuppressed += 1;
      addReason(counters, "automation_disabled");
      await finishRun(runId, "suppressed", counters, "automation_disabled", "suppressed");
      return jsonResponse({
        status: "disabled",
        runKey,
        ...redactedSummary(counters),
      });
    }

    if (!policyWindowIsOpen(scheduledAt)) {
      counters.actionsSuppressed += 1;
      addReason(counters, "outside_policy_window");
      await finishRun(runId, "succeeded", counters);
      return jsonResponse({
        status: "outside_policy_window",
        runKey,
        timezone: automationTimezone,
        ...redactedSummary(counters),
      });
    }

    await runCardNayaxLookupSweep(runId, counters, policyWindowStart);
    await runReminderSweep(runId, counters, policyWindowStart);
    await runEscalationSweep(runId, counters, policyWindowStart);
    if (counters.actionsFailed > 0) {
      throw new RefundAutomationActionFailure();
    }
    await finishRun(runId, "succeeded", counters);

    return jsonResponse({
      status: "succeeded",
      runKey,
      ...redactedSummary(counters),
    });
  } catch (error) {
    const failureCategory = sanitizeFailureCategory(error);
    console.error("refund-case-automation-sweep error", {
      errorType: error instanceof Error ? error.name : typeof error,
      failureCategory,
    });

    if (supabase && runId) {
      let alertStatus: "not_needed" | "pending" | "sent" | "failed" = "not_needed";
      try {
        const priorHealth = await getAutomationHealth();
        const shouldAlert = (priorHealth.consecutiveFailures ?? 0) >= 1;
        let alertAction: ClaimedAction | null = null;
        if (shouldAlert) {
          alertAction = await claimAction(
            runId,
            null,
            `ops_alert:repeated_failure:${keyTimestamp(priorHealth.lastSuccessAt, "never").slice(0, 19)}`,
            "ops_alert",
            null,
            schedulerWindowStart(new Date()).toISOString(),
            counters,
          );
          alertStatus = alertAction.claimed ? "pending" : "not_needed";
        }

        if (alertAction?.claimed) {
          try {
            await sendAutomationHealthAlert("repeated_failure", {
              ...priorHealth,
              status: "failing",
              consecutiveFailures: (priorHealth.consecutiveFailures ?? 0) + 1,
              lastRunAt: new Date().toISOString(),
            });
            await finishAction(alertAction, "completed", "repeated_failure_alert_sent", null, counters);
            alertStatus = "sent";
          } catch (alertError) {
            console.error("refund-case-automation-sweep repeated-failure alert failed", {
              errorType: alertError instanceof Error ? alertError.name : typeof alertError,
            });
            await finishAction(alertAction, "failed", "ops_alert_delivery_failed", null, counters);
            alertStatus = "failed";
          }
        }

        await finishRun(runId, "failed", counters, failureCategory, alertStatus);
      } catch (recordError) {
        console.error("refund-case-automation-sweep failure recording failed", {
          errorType: recordError instanceof Error ? recordError.name : typeof recordError,
        });
      }
    }

    return jsonResponse({
      error: "Unable to run refund automation sweep.",
      failureCategory,
      payloadRedacted: true,
    }, 500);
  }
});
