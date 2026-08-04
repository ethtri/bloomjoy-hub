import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.1";
import { corsHeaders } from "../_shared/cors.ts";
import { sendInternalEmail } from "../_shared/internal-email.ts";
import {
  resolveRefundManagerActionNoticeRouting,
  sendRefundManagerActionNotice,
} from "../_shared/refund-manager-notification.ts";
import {
  lookupNayaxCandidatesForRefundCase,
  NayaxLookupRequestError,
} from "../_shared/nayax-lookup.ts";
import {
  buildRefundCustomerEmail,
  buildRefundWalletCorrectionEmail,
  sendRefundCustomerEmail,
  sendRefundWalletCorrectionEmail,
  type RefundCustomerMessageType,
} from "../_shared/refund-email.ts";
import {
  automaticRefundCustomerContactEnabled,
  buildRefundFollowUpTriggerFingerprint,
  deriveRefundMissingFields,
  refundFollowUpTemplateKey,
  REFUND_DETERMINISTIC_FOLLOW_UP_VERSION,
  sanitizeRefundMissingFields,
  type RefundFollowUpMessageClass,
  type RefundFollowUpReason,
  type RefundMissingField,
} from "../_shared/refund-deterministic-follow-up.ts";
import {
  buildRefundManagerAgingNotice,
  refundBusinessDaysElapsed,
  REFUND_MANAGER_AGING_TEMPLATE_VERSION,
  type RefundManagerAgingMilestone,
} from "../_shared/refund-manager-aging.ts";
import { resolveRefundPublicLabels } from "../_shared/refund-location.ts";
import {
  createRefundWalletCorrectionToken,
  getRefundWalletCorrectionExpiry,
  hashRefundWalletCorrectionToken,
} from "../_shared/refund-wallet-correction.ts";
import { dispatchRefundCaseGmailReply } from "../_shared/refund-gmail-transport.ts";
import { RefundGmailError } from "../_shared/refund-gmail.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const sweepSecret = Deno.env.get("REFUND_AUTOMATION_SWEEP_SECRET") || Deno.env.get("REPORT_SCHEDULER_SECRET");
const automationEnabled = (Deno.env.get("REFUND_AUTOMATION_ENABLED") || "false").toLowerCase() === "true";
const automaticCustomerContactEnabled = automaticRefundCustomerContactEnabled();
const managerAgingNoticesEnabled =
  (Deno.env.get("REFUND_MANAGER_AGING_NOTICES_ENABLED") || "false")
    .toLowerCase() === "true";
const managerReminderBusinessDays = Number(
  Deno.env.get("REFUND_MANAGER_REMINDER_BUSINESS_DAYS") || 2,
);
const managerEscalationBusinessDays = Number(
  Deno.env.get("REFUND_MANAGER_ESCALATION_BUSINESS_DAYS") || 5,
);
const followUpClaimStaleMinutes = Math.min(
  Math.max(Number(Deno.env.get("REFUND_FOLLOW_UP_CLAIM_STALE_MINUTES") || 30), 10),
  24 * 60,
);
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

const automaticCustomerContactAllowed = async () => {
  if (!automaticCustomerContactEnabled || !supabase) return false;
  const { data, error } = await supabase
    .from("refund_customer_contact_settings")
    .select("automatic_customer_contact_enabled")
    .eq("singleton", true)
    .maybeSingle();
  if (error) {
    console.error("refund automatic customer-contact gate unavailable", {
      errorType: typeof error.code === "string" ? error.code : "database_error",
    });
    return false;
  }
  return data?.automatic_customer_contact_enabled === true;
};

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
  reporting_machine_id: string | null;
  reporting_location_id: string | null;
  status: string;
  intake_source: string;
  correlation_status: string;
  correlation_source: string | null;
  automation_state: string;
  automation_follow_up_due_at: string | null;
  deterministic_fact_version: number;
  customer_last_contacted_at: string | null;
  customer_email: string;
  customer_name: string | null;
  payment_method: string | null;
  card_wallet_used: boolean;
  card_last4: string | null;
  payment_amount_cents: number | null;
  refund_amount_cents: number | null;
  incident_at: string | null;
  incident_local_datetime: string | null;
  incident_time_resolution: string | null;
  created_at: string;
  wallet_correction_state: string;
  wallet_correction_version: number;
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
  missingInformationRequestsSent: number;
  noSafeMatchRequestsSent: number;
  informationReceivedSent: number;
  providerExceptionsSent: number;
  escalationsSent: number;
  escalationsFailed: number;
  managerRemindersSent: number;
  managerRoutingExceptionsSent: number;
  managerNoticesFailed: number;
};

type ClaimedAction = {
  actionId: string | null;
  claimed: boolean;
  status: string | null;
};

type RefundAutomationHealth = {
  status?: string;
  lastRunAt?: string | null;
  lastSuccessAt?: string | null;
  consecutiveFailures?: number;
};

type RefundManagerAttentionState = {
  refund_case_id: string;
  attention_version: number;
  attention_started_at: string;
  reminder_sent_at: string | null;
  escalation_sent_at: string | null;
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
  missingInformationRequestsSent: 0,
  noSafeMatchRequestsSent: 0,
  informationReceivedSent: 0,
  providerExceptionsSent: 0,
  escalationsSent: 0,
  escalationsFailed: 0,
  managerRemindersSent: 0,
  managerRoutingExceptionsSent: 0,
  managerNoticesFailed: 0,
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
  missingInformationRequestsSent: counters.missingInformationRequestsSent,
  noSafeMatchRequestsSent: counters.noSafeMatchRequestsSent,
  informationReceivedSent: counters.informationReceivedSent,
  providerExceptionsSent: counters.providerExceptionsSent,
  escalationsSent: counters.escalationsSent,
  escalationsFailed: counters.escalationsFailed,
  managerRemindersSent: counters.managerRemindersSent,
  managerRoutingExceptionsSent: counters.managerRoutingExceptionsSent,
  managerNoticesFailed: counters.managerNoticesFailed,
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
  reporting_machine_id,
  reporting_location_id,
  status,
  intake_source,
  correlation_status,
  correlation_source,
  automation_state,
  automation_follow_up_due_at,
  deterministic_fact_version,
  customer_last_contacted_at,
  customer_email,
  customer_name,
  payment_method,
  card_wallet_used,
  card_last4,
  payment_amount_cents,
  refund_amount_cents,
  incident_at,
  incident_local_datetime,
  incident_time_resolution,
  created_at,
  wallet_correction_state,
  wallet_correction_version,
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
  actionType:
    | "nayax_lookup"
    | "customer_reminder"
    | "customer_more_info"
    | "customer_information_received"
    | "customer_reply_recheck"
    | "wallet_correction_request"
    | "wallet_correction_reminder"
    | "provider_exception"
    | "manager_reminder"
    | "manager_escalation"
    | "internal_escalation"
    | "ops_alert",
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
  const result = data as { actionId?: string; claimed?: boolean; status?: string };
  if (result.claimed === true) {
    counters.actionsAttempted += 1;
  } else {
    counters.actionsSuppressed += 1;
    addReason(counters, "duplicate_action");
  }
  return {
    actionId: typeof result.actionId === "string" ? result.actionId : null,
    claimed: result.claimed === true,
    status: typeof result.status === "string" ? result.status : null,
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

type RefundFollowUpCycleContext = {
  id: string;
  refundCaseId: string;
  cycleNumber: number;
  reasonCode: RefundFollowUpReason;
  requestedFields: RefundMissingField[];
  templateVersion: string;
  caseFactVersion: number;
  status: string;
  sourceCustomerMessageId: string | null;
  requestMessageId: string | null;
  replyCustomerMessageId: string | null;
  reminderDueAt: string | null;
};

type RefundFollowUpCycleClaim = {
  enabled?: boolean;
  claimed?: boolean;
  reason?: string;
  cycle?: Record<string, unknown> | null;
};

type RefundFollowUpCustomerReplyClaim = {
  enabled?: boolean;
  claimed?: boolean;
  reason?: string;
  cycleId?: string;
  refundCaseId?: string;
  sourceMessageId?: string;
  sourceReceivedAt?: string;
  factsChanged?: boolean;
  caseFactVersion?: number;
  cycleFactVersion?: number;
  reasonCode?: RefundFollowUpReason;
  requestedFields?: RefundMissingField[];
  templateVersion?: string;
  nextAction?: string;
};

const textValue = (value: unknown) => typeof value === "string" ? value.trim() : "";
const integerValue = (value: unknown, fallback = 0) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : fallback;
};

const normalizeFollowUpCycle = (
  value: Record<string, unknown> | null | undefined,
): RefundFollowUpCycleContext | null => {
  if (!value) return null;
  const id = textValue(value.id ?? value.cycleId ?? value.cycle_id);
  const refundCaseId = textValue(
    value.refundCaseId ?? value.refund_case_id,
  );
  const reasonCode = textValue(
    value.reasonCode ?? value.reason_code,
  ) as RefundFollowUpReason;
  const templateVersion = textValue(
    value.templateVersion ?? value.template_version,
  );
  const caseFactVersion = integerValue(
    value.caseFactVersion ?? value.case_fact_version,
  );
  const cycleNumber = integerValue(value.cycleNumber ?? value.cycle_number);
  if (
    !id || !refundCaseId ||
    !["missing_information", "no_safe_match"].includes(reasonCode) ||
    templateVersion !== REFUND_DETERMINISTIC_FOLLOW_UP_VERSION ||
    caseFactVersion < 1 || cycleNumber < 1 || cycleNumber > 2
  ) {
    return null;
  }
  return {
    id,
    refundCaseId,
    cycleNumber,
    reasonCode,
    requestedFields: sanitizeRefundMissingFields(
      value.requestedFields ?? value.requested_fields,
    ),
    templateVersion,
    caseFactVersion,
    status: textValue(value.status) || "claimed",
    sourceCustomerMessageId: textValue(
      value.sourceCustomerMessageId ?? value.source_customer_message_id,
    ) || null,
    requestMessageId: textValue(
      value.requestMessageId ?? value.request_message_id,
    ) || null,
    replyCustomerMessageId: textValue(
      value.replyCustomerMessageId ?? value.reply_customer_message_id,
    ) || null,
    reminderDueAt: textValue(value.reminderDueAt ?? value.reminder_due_at) || null,
  };
};

const messageTypeForFollowUp = (
  cycle: RefundFollowUpCycleContext,
  messageClass: RefundFollowUpMessageClass,
): RefundCustomerMessageType => {
  if (messageClass === "information_received") return "information_received";
  if (messageClass === "reminder") return "reminder";
  return cycle.reasonCode === "missing_information" ? "more_info" : "no_safe_match";
};

const buildFollowUpEmailInput = (
  refundCase: RefundSweepCase,
  cycle: RefundFollowUpCycleContext,
  messageClass: RefundFollowUpMessageClass,
) => {
  const publicLabels = resolveRefundPublicLabels({
    locationName: refundCase.reporting_locations?.name,
    publicMachineLabel: refundCase.reporting_machines?.refund_public_display_label,
    machineLabel: refundCase.reporting_machines?.machine_label,
  });
  return {
    messageType: messageTypeForFollowUp(cycle, messageClass),
    publicReference: refundCase.public_reference,
    customerName: refundCase.customer_name,
    customerEmail: refundCase.customer_email,
    machineLabel: publicLabels.machineLabel,
    locationName: publicLabels.locationName,
    refundAmountCents: refundCase.refund_amount_cents ?? refundCase.payment_amount_cents,
    paymentMethod: refundCase.payment_method,
    cardWalletUsed: refundCase.card_wallet_used,
    incidentLocalDateTime: refundCase.incident_local_datetime,
    missingFields: cycle.requestedFields,
    followUpReason: cycle.reasonCode,
  };
};

const logDeterministicFollowUpMessage = async (
  refundCase: RefundSweepCase,
  cycle: RefundFollowUpCycleContext,
  messageClass: RefundFollowUpMessageClass,
) => {
  if (!supabase) return null;
  const emailInput = buildFollowUpEmailInput(refundCase, cycle, messageClass);
  const email = buildRefundCustomerEmail(emailInput);
  const messageType = messageTypeForFollowUp(cycle, messageClass);

  const { data, error } = await supabase
    .from("refund_case_messages")
    .insert({
      refund_case_id: refundCase.id,
      message_type: messageType,
      status: "pending",
      recipient_email: refundCase.customer_email,
      subject: email.subject,
      body: email.text,
      template_key: refundFollowUpTemplateKey(cycle.reasonCode, messageClass),
      content_source: "deterministic_template",
      delivery_kind: "automatic",
      reason_code: cycle.reasonCode,
      template_version: cycle.templateVersion,
      follow_up_cycle_id: cycle.id,
      requested_fields: cycle.requestedFields,
    })
    .select("id")
    .single();

  if (error) throw error;
  return data?.id ?? null;
};

const sendDeterministicFollowUpMessage = async (
  refundCase: RefundSweepCase,
  cycle: RefundFollowUpCycleContext,
  messageClass: RefundFollowUpMessageClass,
) => {
  if (!(await automaticCustomerContactAllowed())) {
    return { status: "suppressed" as const, messageId: null };
  }
  const messageType = messageTypeForFollowUp(cycle, messageClass);
  const emailInput = buildFollowUpEmailInput(refundCase, cycle, messageClass);
  const email = buildRefundCustomerEmail(emailInput);
  const gmailThreadId = await resolveFollowUpGmailThreadId(cycle, messageClass);
  let messageId: string | null = null;

  try {
    messageId = await logDeterministicFollowUpMessage(
      refundCase,
      cycle,
      messageClass,
    );
    if (!messageId) throw new Error("Refund customer message record is required.");
    const gmailDelivery = await dispatchRefundCaseGmailReply({
      supabase: supabase!,
      refundCaseId: refundCase.id,
      refundCaseMessageId: messageId,
      recipientEmail: refundCase.customer_email,
      email,
      deliveryKind: "automatic",
      gmailThreadId,
    });
    if (!gmailDelivery.usedGmail) {
      if (!(await automaticCustomerContactAllowed())) {
        throw new RefundGmailError(
          "automatic_contact_disabled",
          "Automatic customer contact was disabled before provider delivery.",
        );
      }
      await sendRefundCustomerEmail({
        ...emailInput,
        managerCcEmails: gmailDelivery.managerCcEmails,
      });
    }

    if (messageId) {
      const { error: messageUpdateError } = await supabase
        ?.from("refund_case_messages")
        .update({
          status: "sent",
          sent_at: new Date().toISOString(),
          subject: gmailDelivery.usedGmail ? gmailDelivery.subject : email.subject,
        })
        .eq("id", messageId) ?? { error: null };
      if (messageUpdateError) throw messageUpdateError;
    }

    const { data: refreshedCycle, error: refreshedCycleError } = await supabase
      ?.from("refund_follow_up_cycles")
      .select("reminder_due_at")
      .eq("id", cycle.id)
      .maybeSingle() ?? { data: null, error: null };
    if (refreshedCycleError) throw refreshedCycleError;
    const reminderDueAt = textValue(refreshedCycle?.reminder_due_at) || null;

    const { error: eventError } = await supabase?.from("refund_case_events").insert({
      refund_case_id: refundCase.id,
      event_type: "automation_sweep_message",
      message: `Automated ${messageType.replaceAll("_", " ")} email sent.`,
      metadata: {
        message_type: messageType,
        message_id: messageId,
        follow_up_cycle_id: cycle.id,
        follow_up_cycle_number: cycle.cycleNumber,
        follow_up_reason: cycle.reasonCode,
        template_version: cycle.templateVersion,
        requested_fields: cycle.requestedFields,
        transport: gmailDelivery.usedGmail ? "gmail_thread" : "transactional_email",
        manager_cc_count: gmailDelivery.managerCcCount,
        recipient_resolution_status: gmailDelivery.recipientResolutionStatus,
        payload_redacted: true,
      },
    }) ?? { error: null };
    if (eventError) throw eventError;

    return { status: "sent" as const, messageId, reminderDueAt };
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
          error_message: error instanceof RefundGmailError
            ? error.code
            : "customer_email_delivery_failed",
        })
        .eq("id", messageId);
    }

    return { status: "failed" as const, messageId };
  }
};

const getSweepCase = async (refundCaseId: string) => {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("refund_cases")
    .select(caseSelect)
    .eq("id", refundCaseId)
    .maybeSingle();
  if (error) throw error;
  return data
    ? normalizeRefundSweepCase(data as unknown as RawRefundSweepCase)
    : null;
};

const getLatestVerifiedCustomerMessage = async (refundCaseId: string) => {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("refund_gmail_messages")
    .select("id,gmail_thread_id")
    .eq("refund_case_id", refundCaseId)
    .eq("direction", "inbound")
    .eq("participant_role", "customer")
    .eq("participant_trust", "verified")
    .eq("status", "received")
    .is("content_deleted_at", null)
    .order("received_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  const id = textValue(data?.id);
  const gmailThreadId = textValue(data?.gmail_thread_id);
  return id && gmailThreadId ? { id, gmailThreadId } : null;
};

const getLatestVerifiedCustomerMessageId = async (refundCaseId: string) =>
  (await getLatestVerifiedCustomerMessage(refundCaseId))?.id ?? null;

const getGmailThreadIdForMessage = async (gmailMessageId: string | null) => {
  if (!supabase || !gmailMessageId) return null;
  const { data, error } = await supabase
    .from("refund_gmail_messages")
    .select("gmail_thread_id")
    .eq("id", gmailMessageId)
    .maybeSingle();
  if (error) throw error;
  return textValue(data?.gmail_thread_id) || null;
};

const getGmailThreadIdForCaseMessage = async (
  refundCaseMessageId: string | null,
) => {
  if (!supabase || !refundCaseMessageId) return null;
  const { data, error } = await supabase
    .from("refund_gmail_messages")
    .select("gmail_thread_id")
    .eq("refund_case_message_id", refundCaseMessageId)
    .eq("direction", "outbound")
    .order("received_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return textValue(data?.gmail_thread_id) || null;
};

const resolveFollowUpGmailThreadId = async (
  cycle: RefundFollowUpCycleContext,
  messageClass: RefundFollowUpMessageClass,
) => {
  if (messageClass === "request") {
    return getGmailThreadIdForMessage(cycle.sourceCustomerMessageId);
  }
  if (messageClass === "reminder") {
    return getGmailThreadIdForCaseMessage(cycle.requestMessageId);
  }
  return getGmailThreadIdForMessage(cycle.replyCustomerMessageId);
};

const claimFollowUpCycle = async ({
  refundCase,
  reasonCode,
  sourceCustomerMessageId,
  requestedFields,
}: {
  refundCase: RefundSweepCase;
  reasonCode: RefundFollowUpReason;
  sourceCustomerMessageId: string | null;
  requestedFields: RefundMissingField[];
}) => {
  if (!supabase || !automaticCustomerContactEnabled) {
    return {
      enabled: false,
      claimed: false,
      reason: "automatic_customer_contact_disabled",
      cycle: null,
    };
  }
  const triggerFingerprint = await buildRefundFollowUpTriggerFingerprint({
    refundCaseId: refundCase.id,
    reason: reasonCode,
    requestedFields,
    caseFactVersion: refundCase.deterministic_fact_version,
    sourceCustomerMessageId,
  });
  const { data, error } = await supabase.rpc(
    "service_claim_refund_follow_up_cycle",
    {
      p_refund_case_id: refundCase.id,
      p_reason_code: reasonCode,
      p_template_version: REFUND_DETERMINISTIC_FOLLOW_UP_VERSION,
      p_trigger_fingerprint: triggerFingerprint,
      p_source_customer_message_id: sourceCustomerMessageId,
    },
  );
  if (error) throw error;
  const claim = (data ?? {}) as RefundFollowUpCycleClaim;
  const cycle = normalizeFollowUpCycle(claim.cycle);
  if (claim.claimed === true && !cycle) {
    throw new Error("Refund follow-up claim returned an invalid cycle contract.");
  }
  return {
    enabled: claim.enabled === true,
    claimed: claim.claimed === true,
    reason: textValue(claim.reason) || null,
    cycle,
  };
};

const sendFollowUpManagerNotice = async ({
  refundCase,
  noticeKind,
}: {
  refundCase: RefundSweepCase;
  noticeKind: "provider_setup" | "provider_outage" | "provider_rejection" |
    "provider_timeout" | "provider_unknown" | "follow_up_manual_review" |
    "customer_reply_review";
}) => {
  if (!supabase) throw new Error("Refund automation is not configured.");
  const noticeLabels: Record<typeof noticeKind, string> = {
    provider_setup: "Payment-provider setup needs attention",
    provider_outage: "Payment-provider lookup is temporarily unavailable",
    provider_rejection: "Payment-provider lookup was rejected",
    provider_timeout: "Payment-provider lookup timed out",
    provider_unknown: "Payment-provider result needs a person to verify it",
    follow_up_manual_review: "Automatic customer follow-up reached a safe stopping point",
    customer_reply_review: "The customer replied and the case needs a person to review the new information",
  };
  const summary = noticeLabels[noticeKind];
  const notice = await sendRefundManagerActionNotice({
    supabase,
    refundCaseId: refundCase.id,
    customerEmail: refundCase.customer_email,
    subject: `Refund case needs attention: ${refundCase.public_reference}`,
    summaryText: [
      summary,
      "",
      `Reference: ${refundCase.public_reference}`,
      `Status: ${refundCase.status}`,
      "Please open the case and decide the next safe step. No customer or payment action was taken by this notice.",
    ].join("\n"),
  });
  const { error: eventError } = await supabase.from("refund_case_events").insert({
    refund_case_id: refundCase.id,
    event_type: noticeKind.startsWith("provider_")
      ? "refund_provider_exception_notice_sent"
      : "refund_follow_up_manager_notice_sent",
    message: summary,
    metadata: {
      notice_kind: noticeKind,
      recipient_count: notice.recipientCount,
      machine_manager_recipient_count: notice.managerRecipientCount,
      manager_resolution_status: notice.resolutionStatus,
      used_ops_fallback: notice.usedOpsFallback,
      payload_redacted: true,
    },
  });
  if (eventError) throw eventError;
  return notice;
};

const settleStaleFollowUpClaims = async (counters: SweepCounters) => {
  if (!supabase || !Number.isFinite(followUpClaimStaleMinutes)) return;
  const staleBefore = new Date(
    Date.now() - followUpClaimStaleMinutes * 60 * 1000,
  ).toISOString();
  const { data, error } = await supabase.rpc(
    "service_settle_stale_refund_follow_up_claims",
    { p_stale_before: staleBefore, p_limit: 25 },
  );
  if (error) throw error;
  const result = data && typeof data === "object"
    ? data as Record<string, unknown>
    : {};
  const caseIds = Array.isArray(result.caseIds)
    ? result.caseIds.map(textValue).filter(Boolean)
    : [];
  const settledCount = integerValue(result.settledCount);
  const reconciledCount = integerValue(result.reconciledCount);
  const deliveryUnknownCount = integerValue(result.deliveryUnknownCount);
  if (settledCount > 0) {
    addReason(counters, "stale_follow_up_claim_settled", settledCount);
  }
  if (deliveryUnknownCount > 0) {
    addReason(counters, "follow_up_delivery_unknown", deliveryUnknownCount);
  }
  if (reconciledCount > 0) {
    addReason(counters, "known_gmail_delivery_reconciled", reconciledCount);
  }
  for (const refundCaseId of caseIds) {
    const refundCase = await getSweepCase(refundCaseId);
    if (!refundCase) continue;
    counters.evaluatedCaseIds.add(refundCase.id);
    try {
      await sendFollowUpManagerNotice({
        refundCase,
        noticeKind: "follow_up_manual_review",
      });
      counters.actionsSucceeded += 1;
    } catch (noticeError) {
      counters.actionsFailed += 1;
      addReason(counters, "stale_follow_up_manager_notice_failed");
      console.error("refund-case-automation-sweep stale-claim notice failed", {
        errorType: noticeError instanceof Error ? noticeError.name : typeof noticeError,
      });
    }
  }
};

const classifyProviderException = (
  error: unknown,
): "provider_outage" | "provider_rejection" | "provider_timeout" | "provider_unknown" => {
  const detail = `${
    error instanceof Error ? `${error.name} ${error.message}` : typeof error
  } ${error && typeof error === "object" && "code" in error ? String(error.code) : ""}`
    .toLowerCase();
  if (detail.includes("timeout") || detail.includes("timed out")) return "provider_timeout";
  if (
    detail.includes("401") || detail.includes("403") ||
    detail.includes("unauthorized") || detail.includes("forbidden") ||
    detail.includes("reject")
  ) return "provider_rejection";
  if (
    detail.includes("network") || detail.includes("unavailable") ||
    detail.includes("connection") || detail.includes("502") ||
    detail.includes("503") || detail.includes("504")
  ) return "provider_outage";
  return "provider_unknown";
};

const routeProviderException = async ({
  runId,
  refundCase,
  reasonCategory,
  counters,
}: {
  runId: string;
  refundCase: RefundSweepCase;
  reasonCategory: "provider_setup" | "provider_outage" | "provider_rejection" |
    "provider_timeout" | "provider_unknown";
  counters: SweepCounters;
}) => {
  if (!supabase) return;
  const actionKey = `provider_exception:${refundCase.id}:${reasonCategory}:${refundCase.deterministic_fact_version}`;
  const { data, error } = await supabase.rpc(
    "service_claim_refund_provider_exception_action",
    {
      p_run_id: runId,
      p_refund_case_id: refundCase.id,
      p_action_key: actionKey,
      p_reason_category: reasonCategory,
    },
  );
  if (error) throw error;
  const result = data && typeof data === "object"
    ? data as Record<string, unknown>
    : {};
  const action: ClaimedAction = {
    actionId: textValue(result.actionId ?? result.action_id) || null,
    claimed: result.claimed === true,
    status: textValue(result.status) || null,
  };
  if (!action.claimed) {
    counters.actionsSuppressed += 1;
    addReason(counters, "provider_exception_already_routed");
    return;
  }
  counters.actionsAttempted += 1;
  try {
    await sendFollowUpManagerNotice({ refundCase, noticeKind: reasonCategory });
    counters.providerExceptionsSent += 1;
    await finishAction(action, "completed", reasonCategory, null, counters);
  } catch (noticeError) {
    await finishAction(action, "failed", "provider_exception_notice_failed", null, counters);
    throw noticeError;
  }
};

const routeFollowUpManualReview = async ({
  runId,
  refundCase,
  actionKeySuffix,
  noticeKind,
  policyWindowStart,
  counters,
}: {
  runId: string;
  refundCase: RefundSweepCase;
  actionKeySuffix: string;
  noticeKind: "follow_up_manual_review" | "customer_reply_review";
  policyWindowStart: string;
  counters: SweepCounters;
}) => {
  const action = await claimAction(
    runId,
    refundCase.id,
    `follow_up_review:${refundCase.id}:${actionKeySuffix}`,
    "internal_escalation",
    refundCase.status,
    policyWindowStart,
    counters,
  );
  if (!action.claimed) return;
  try {
    await sendFollowUpManagerNotice({ refundCase, noticeKind });
    await finishAction(action, "completed", noticeKind, null, counters);
  } catch (error) {
    await finishAction(action, "failed", "manager_notice_failed", null, counters);
    throw error;
  }
};

const getPortalBaseUrl = () =>
  (
    Deno.env.get("BLOOMJOY_APP_URL") ||
    Deno.env.get("PUBLIC_APP_URL") ||
    "https://app.bloomjoyusa.com"
  ).replace(/\/+$/, "");

const resolveWalletCorrectionGmailThreadId = async (
  refundCaseId: string,
  reminder: boolean,
) => {
  if (!supabase) return null;
  if (!reminder) {
    return (await getLatestVerifiedCustomerMessage(refundCaseId))?.gmailThreadId ?? null;
  }
  const { data: originalMessage, error } = await supabase
    .from("refund_case_messages")
    .select("id")
    .eq("refund_case_id", refundCaseId)
    .eq("message_type", "wallet_correction")
    .eq("status", "sent")
    .order("sent_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return getGmailThreadIdForCaseMessage(textValue(originalMessage?.id) || null);
};

const sendWalletCorrectionMessage = async (
  refundCase: RefundSweepCase,
  reminder: boolean,
) => {
  if (!supabase) {
    throw new Error("Refund automation is not configured.");
  }
  if (!(await automaticCustomerContactAllowed())) {
    return { status: "suppressed" as const, messageId: null };
  }

  const token = createRefundWalletCorrectionToken();
  const tokenHash = await hashRefundWalletCorrectionToken(token);
  const expiresAt = getRefundWalletCorrectionExpiry();
  const correctionUrl =
    `${getPortalBaseUrl()}/refunds/correct-wallet?token=${encodeURIComponent(token)}`;
  const publicLabels = resolveRefundPublicLabels({
    locationName: refundCase.reporting_locations?.name,
    publicMachineLabel:
      refundCase.reporting_machines?.refund_public_display_label,
    machineLabel: refundCase.reporting_machines?.machine_label,
  });
  const emailInput = {
    publicReference: refundCase.public_reference,
    customerName: refundCase.customer_name,
    customerEmail: refundCase.customer_email,
    machineLabel: publicLabels.machineLabel,
    locationName: publicLabels.locationName,
    correctionUrl,
    reminder,
  };
  const email = buildRefundWalletCorrectionEmail(emailInput);
  const gmailThreadId = await resolveWalletCorrectionGmailThreadId(
    refundCase.id,
    reminder,
  );

  const { error: issueError } = await supabase.rpc(
    "service_issue_refund_wallet_correction",
    {
      p_refund_case_id: refundCase.id,
      p_token_hash: tokenHash,
      p_expires_at: expiresAt.toISOString(),
    },
  );
  if (issueError) throw issueError;

  let messageId: string | null = null;
  try {
    const messageType = reminder
      ? "wallet_correction_reminder"
      : "wallet_correction";
    const { data: messageRow, error: messageError } = await supabase
      .from("refund_case_messages")
      .insert({
        refund_case_id: refundCase.id,
        message_type: messageType,
        status: "pending",
        recipient_email: refundCase.customer_email,
        subject: email.subject,
        body: email.text.replace(
          correctionUrl,
          "[secure single-use correction link omitted from audit log]",
        ),
        template_key: reminder
          ? "refund_wallet_correction_reminder_v1"
          : "refund_wallet_correction_v1",
        content_source: "deterministic_template",
        delivery_kind: "automatic",
        reason_code: null,
        template_version: reminder
          ? "refund_wallet_correction_reminder_v1"
          : "refund_wallet_correction_v1",
        follow_up_cycle_id: null,
        requested_fields: [],
      })
      .select("id")
      .single();
    if (messageError) throw messageError;
    messageId = messageRow?.id ?? null;

    if (!messageId) throw new Error("Refund wallet-correction message record is required.");
    const gmailDelivery = await dispatchRefundCaseGmailReply({
      supabase,
      refundCaseId: refundCase.id,
      refundCaseMessageId: messageId,
      recipientEmail: refundCase.customer_email,
      email,
      deliveryKind: "automatic",
      gmailThreadId,
    });
    if (!gmailDelivery.usedGmail) {
      if (!(await automaticCustomerContactAllowed())) {
        throw new RefundGmailError(
          "automatic_contact_disabled",
          "Automatic customer contact was disabled before provider delivery.",
        );
      }
      await sendRefundWalletCorrectionEmail({
        ...emailInput,
        managerCcEmails: gmailDelivery.managerCcEmails,
      });
    }

    if (messageId) {
      const { error: messageUpdateError } = await supabase
        .from("refund_case_messages")
        .update({
          status: "sent",
          sent_at: new Date().toISOString(),
          subject: gmailDelivery.usedGmail ? gmailDelivery.subject : email.subject,
        })
        .eq("id", messageId);
      if (messageUpdateError) throw messageUpdateError;
    }

    const { error: caseUpdateError } = await supabase
      .from("refund_cases")
      .update({
        customer_last_contacted_at: new Date().toISOString(),
        last_customer_message_type: messageType,
      })
      .eq("id", refundCase.id);
    if (caseUpdateError) throw caseUpdateError;

    return { status: "sent" as const, messageId };
  } catch (error) {
    if (messageId) {
      await supabase
        .from("refund_case_messages")
        .update({
          status: "failed",
          error_message: error instanceof RefundGmailError
            ? error.code
            : "customer_email_delivery_failed",
        })
        .eq("id", messageId);
    }
    await supabase.rpc("service_cancel_refund_wallet_correction", {
      p_token_hash: tokenHash,
    });
    console.error("refund wallet correction email failed", {
      errorType: error instanceof Error ? error.name : typeof error,
      reminder,
    });
    return { status: "failed" as const, messageId };
  }
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

const getFollowUpCycle = async (cycleId: string) => {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("refund_follow_up_cycles")
    .select(
      "id,refund_case_id,cycle_number,reason_code,requested_fields,template_version,case_fact_version,status,source_customer_message_id,request_message_id,reply_customer_message_id,reminder_due_at",
    )
    .eq("id", cycleId)
    .maybeSingle();
  if (error) throw error;
  return data ? normalizeFollowUpCycle(data as Record<string, unknown>) : null;
};

const runMissingInformationSweep = async (
  runId: string,
  counters: SweepCounters,
  policyWindowStart: string,
) => {
  if (!supabase || !automaticCustomerContactEnabled) return;
  const { data, error } = await supabase
    .from("refund_cases")
    .select(caseSelect)
    .eq("status", "draft")
    .eq("intake_source", "gmail")
    .in("automation_state", ["customer_replied", "submitted", "under_review"])
    .limit(25);
  if (error) throw error;

  for (const rawCase of (data ?? []) as unknown as RawRefundSweepCase[]) {
    const refundCase = normalizeRefundSweepCase(rawCase);
    counters.evaluatedCaseIds.add(refundCase.id);
    const derived = deriveRefundMissingFields({
      reportingMachineId: refundCase.reporting_machine_id,
      reportingLocationId: refundCase.reporting_location_id,
      incidentAt: refundCase.incident_at,
      incidentTimeResolution: refundCase.incident_time_resolution,
      paymentMethod: refundCase.payment_method,
      paymentAmountCents: refundCase.payment_amount_cents,
      cardLast4: refundCase.card_last4,
      cardWalletUsed: refundCase.card_wallet_used,
    });

    if (derived.requiresSecureWalletCorrection) {
      if (derived.missingFields.length === 0) {
        const { error: walletReadyError } = await supabase.from("refund_cases")
          .update({
            status: "needs_review",
            automation_state: "wallet_correction_needed",
            automation_follow_up_due_at: null,
          })
          .eq("id", refundCase.id)
          .eq("status", "draft");
        if (walletReadyError) throw walletReadyError;
        continue;
      }
      await routeFollowUpManualReview({
        runId,
        refundCase,
        actionKeySuffix: `wallet-required:${refundCase.deterministic_fact_version}`,
        noticeKind: "follow_up_manual_review",
        policyWindowStart,
        counters,
      });
      continue;
    }

    if (derived.missingFields.length === 0) {
      if (!refundCase.reporting_machine_id || !refundCase.reporting_location_id) {
        await routeFollowUpManualReview({
          runId,
          refundCase,
          actionKeySuffix: `mapping-resolution:${refundCase.deterministic_fact_version}`,
          noticeKind: "follow_up_manual_review",
          policyWindowStart,
          counters,
        });
        continue;
      }
      const { error: completeError } = await supabase.from("refund_cases")
        .update({ status: "needs_review", automation_state: "under_review" })
        .eq("id", refundCase.id)
        .eq("status", "draft");
      if (completeError) throw completeError;
      await routeFollowUpManualReview({
        runId,
        refundCase: { ...refundCase, status: "needs_review", automation_state: "under_review" },
        actionKeySuffix: `complete-draft:${refundCase.deterministic_fact_version}`,
        noticeKind: "follow_up_manual_review",
        policyWindowStart,
        counters,
      });
      continue;
    }

    const sourceCustomerMessageId = await getLatestVerifiedCustomerMessageId(refundCase.id);
    if (!sourceCustomerMessageId) {
      counters.actionsSuppressed += 1;
      addReason(counters, "missing_verified_customer_source");
      continue;
    }
    const cycleClaim = await claimFollowUpCycle({
      refundCase,
      reasonCode: "missing_information",
      sourceCustomerMessageId,
      requestedFields: derived.missingFields,
    });
    if (!cycleClaim.claimed || !cycleClaim.cycle) {
      if (["contact_limit_reached", "active_cycle_exists", "manual_review", "no_material_fact_progress"].includes(cycleClaim.reason ?? "")) {
        await routeFollowUpManualReview({
          runId,
          refundCase,
          actionKeySuffix: `missing:${refundCase.deterministic_fact_version}:${cycleClaim.reason}`,
          noticeKind: "follow_up_manual_review",
          policyWindowStart,
          counters,
        });
      } else {
        counters.actionsSuppressed += 1;
        addReason(counters, cycleClaim.reason ?? "missing_information_cycle_not_claimed");
      }
      continue;
    }
    if (
      JSON.stringify(cycleClaim.cycle.requestedFields) !==
        JSON.stringify(derived.missingFields)
    ) {
      await routeFollowUpManualReview({
        runId,
        refundCase,
        actionKeySuffix: `field-contract:${cycleClaim.cycle.id}`,
        noticeKind: "follow_up_manual_review",
        policyWindowStart,
        counters,
      });
      continue;
    }

    counters.actionsAttempted += 1;
    const result = await sendDeterministicFollowUpMessage(
      refundCase,
      cycleClaim.cycle,
      "request",
    );
    if (result.status === "sent") {
      counters.actionsSucceeded += 1;
      counters.missingInformationRequestsSent += 1;
      addReason(counters, "missing_information_requested");
    } else {
      counters.actionsFailed += 1;
      addReason(counters, result.status === "suppressed"
        ? "automatic_customer_contact_disabled"
        : "customer_email_failed");
    }
  }
};

const runCashNoSafeMatchSweep = async (
  runId: string,
  counters: SweepCounters,
  policyWindowStart: string,
) => {
  if (!supabase || !automaticCustomerContactEnabled) return;
  const { data, error } = await supabase
    .from("refund_cases")
    .select(caseSelect)
    .eq("payment_method", "cash")
    .eq("status", "needs_review")
    .eq("correlation_status", "no_match")
    .eq("correlation_source", "sunze")
    .limit(25);
  if (error) throw error;

  for (const rawCase of (data ?? []) as unknown as RawRefundSweepCase[]) {
    const refundCase = normalizeRefundSweepCase(rawCase);
    counters.evaluatedCaseIds.add(refundCase.id);
    const derived = deriveRefundMissingFields({
      reportingMachineId: refundCase.reporting_machine_id,
      reportingLocationId: refundCase.reporting_location_id,
      incidentAt: refundCase.incident_at,
      incidentTimeResolution: refundCase.incident_time_resolution,
      paymentMethod: refundCase.payment_method,
      paymentAmountCents: refundCase.payment_amount_cents,
      cardLast4: refundCase.card_last4,
      cardWalletUsed: refundCase.card_wallet_used,
    });
    if (derived.missingFields.length > 0 || derived.requiresSecureWalletCorrection) {
      await routeFollowUpManualReview({
        runId,
        refundCase,
        actionKeySuffix: `cash-no-match-incomplete:${refundCase.deterministic_fact_version}`,
        noticeKind: "follow_up_manual_review",
        policyWindowStart,
        counters,
      });
      continue;
    }
    const sourceCustomerMessageId = await getLatestVerifiedCustomerMessageId(
      refundCase.id,
    );
    const cycleClaim = await claimFollowUpCycle({
      refundCase,
      reasonCode: "no_safe_match",
      sourceCustomerMessageId,
      requestedFields: [],
    });
    if (!cycleClaim.claimed || !cycleClaim.cycle) {
      if (["contact_limit_reached", "active_cycle_exists", "manual_review", "no_material_fact_progress"].includes(cycleClaim.reason ?? "")) {
        await routeFollowUpManualReview({
          runId,
          refundCase,
          actionKeySuffix: `cash-no-match:${refundCase.deterministic_fact_version}:${cycleClaim.reason}`,
          noticeKind: "follow_up_manual_review",
          policyWindowStart,
          counters,
        });
      } else {
        counters.actionsSuppressed += 1;
        addReason(counters, cycleClaim.reason ?? "cash_no_safe_match_cycle_not_claimed");
      }
      continue;
    }
    counters.actionsAttempted += 1;
    const result = await sendDeterministicFollowUpMessage(
      refundCase,
      cycleClaim.cycle,
      "request",
    );
    if (result.status === "sent") {
      counters.actionsSucceeded += 1;
      counters.noSafeMatchRequestsSent += 1;
      addReason(counters, "cash_no_safe_match_customer_contacted");
    } else {
      counters.actionsFailed += 1;
      addReason(counters, result.status === "suppressed"
        ? "automatic_customer_contact_disabled"
        : "customer_email_failed");
    }
  }
};

const runCustomerReplyFollowUpSweep = async (
  runId: string,
  counters: SweepCounters,
  policyWindowStart: string,
) => {
  if (!supabase) return;
  const { data, error } = await supabase
    .from("refund_follow_up_cycles")
    .select("id,refund_case_id")
    .in("status", ["waiting", "customer_replied"])
    .not("request_sent_at", "is", null)
    .is("recheck_claimed_at", null)
    .order("request_sent_at", { ascending: true })
    .limit(25);
  if (error) throw error;

  for (const candidate of data ?? []) {
    const cycleId = textValue(candidate.id);
    const refundCaseId = textValue(candidate.refund_case_id);
    if (!cycleId || !refundCaseId) continue;
    const { data: claimedData, error: claimError } = await supabase.rpc(
      "service_claim_refund_follow_up_customer_reply",
      {
        p_refund_case_id: refundCaseId,
        p_follow_up_cycle_id: cycleId,
      },
    );
    if (claimError) throw claimError;
    const claim = (claimedData ?? {}) as RefundFollowUpCustomerReplyClaim;
    if (claim.claimed !== true) continue;

    const sourceMessageId = textValue(claim.sourceMessageId);
    const cycle = await getFollowUpCycle(cycleId);
    const refundCase = await getSweepCase(refundCaseId);
    if (!sourceMessageId || !cycle || !refundCase) {
      counters.actionsFailed += 1;
      addReason(counters, "customer_reply_contract_invalid");
      continue;
    }
    counters.evaluatedCaseIds.add(refundCase.id);

    const receiptAction = await claimAction(
      runId,
      refundCase.id,
      `information_received:${cycle.id}:${sourceMessageId}`,
      "customer_information_received",
      refundCase.status,
      policyWindowStart,
      counters,
    );
    let receiptOutcome: "sent" | "settled_without_send" | "in_progress" =
      receiptAction.status === "completed"
        ? "sent"
        : ["failed", "suppressed"].includes(receiptAction.status ?? "")
        ? "settled_without_send"
        : "in_progress";
    if (receiptAction.claimed) {
      const receipt = await sendDeterministicFollowUpMessage(
        refundCase,
        cycle,
        "information_received",
      );
      if (receipt.status === "sent") {
        receiptOutcome = "sent";
        counters.informationReceivedSent += 1;
        await finishAction(
          receiptAction,
          "completed",
          "information_received_sent",
          receipt.messageId,
          counters,
        );
      } else {
        receiptOutcome = "settled_without_send";
        await finishAction(
          receiptAction,
          receipt.status === "suppressed" ? "suppressed" : "failed",
          receipt.status === "suppressed"
            ? "automatic_customer_contact_disabled"
            : "customer_email_failed",
          receipt.messageId,
          counters,
        );
      }
    }

    if (!receiptAction.claimed && receiptAction.status === "claimed") {
      // Another worker owns the receipt delivery. Do not complete the recheck
      // first: its immutable sent/failed result will make this cycle eligible
      // for a later, unambiguous pass.
      addReason(counters, "information_received_delivery_in_progress");
      continue;
    }

    const recheckAction = await claimAction(
      runId,
      refundCase.id,
      `customer_reply_recheck:${cycle.id}:${sourceMessageId}`,
      "customer_reply_recheck",
      refundCase.status,
      policyWindowStart,
      counters,
    );
    if (!recheckAction.claimed) {
      if (
        ["completed", "failed", "suppressed"].includes(recheckAction.status ?? "")
        && receiptOutcome !== "in_progress"
      ) {
        const recheckCompleted = recheckAction.status === "completed";
        const settledAt = new Date().toISOString();
        const { error: closeError } = await supabase.from("refund_follow_up_cycles")
          .update({
            recheck_claimed_at: settledAt,
            status: recheckCompleted && receiptOutcome === "sent"
              ? "closed"
              : "manual_review",
            failed_at: recheckCompleted && receiptOutcome === "sent"
              ? null
              : settledAt,
            failure_code: recheckCompleted && receiptOutcome === "sent"
              ? null
              : recheckCompleted
              ? "information_receipt_not_sent"
              : "customer_reply_recheck_failed",
          })
          .eq("id", cycle.id)
          .is("recheck_claimed_at", null);
        if (closeError) throw closeError;
      }
      continue;
    }
    try {
      const factsChanged = claim.factsChanged === true;
      const currentMissing = deriveRefundMissingFields({
        reportingMachineId: refundCase.reporting_machine_id,
        reportingLocationId: refundCase.reporting_location_id,
        incidentAt: refundCase.incident_at,
        incidentTimeResolution: refundCase.incident_time_resolution,
        paymentMethod: refundCase.payment_method,
        paymentAmountCents: refundCase.payment_amount_cents,
        cardLast4: refundCase.card_last4,
        cardWalletUsed: refundCase.card_wallet_used,
      });
      if (
        factsChanged
        && currentMissing.missingFields.length === 0
        && refundCase.reporting_machine_id
        && refundCase.reporting_location_id
      ) {
        const { error: updateError } = await supabase.from("refund_cases")
          .update({
            status: "needs_review",
            automation_state: currentMissing.requiresSecureWalletCorrection
              ? "wallet_correction_needed"
              : "under_review",
            automation_follow_up_due_at: null,
          })
          .eq("id", refundCase.id);
        if (updateError) throw updateError;
      } else {
        await sendFollowUpManagerNotice({
          refundCase,
          noticeKind: "customer_reply_review",
        });
      }
      const { error: eventError } = await supabase.from("refund_case_events").insert({
        refund_case_id: refundCase.id,
        event_type: "refund_customer_reply_rechecked",
        message: factsChanged
          ? "The verified customer reply triggered one deterministic fact-version recheck."
          : "The verified customer reply was acknowledged and routed to a person because no structured case fact changed.",
        metadata: {
          follow_up_cycle_id: cycle.id,
          source_message_id: sourceMessageId,
          facts_changed: factsChanged,
          case_fact_version: integerValue(claim.caseFactVersion),
          cycle_fact_version: integerValue(claim.cycleFactVersion),
          next_action: textValue(claim.nextAction) || "manual_review",
          payload_redacted: true,
        },
      });
      if (eventError) throw eventError;
      await finishAction(
        recheckAction,
        "completed",
        factsChanged ? "structured_facts_rechecked" : "customer_reply_manual_review",
        null,
        counters,
      );
      const { error: closeError } = await supabase.from("refund_follow_up_cycles")
        .update({
          recheck_claimed_at: new Date().toISOString(),
          status: receiptOutcome === "sent"
            ? "closed"
            : receiptOutcome === "settled_without_send"
            ? "manual_review"
            : "customer_replied",
        })
        .eq("id", cycle.id)
        .is("recheck_claimed_at", null);
      if (closeError) throw closeError;
    } catch (recheckError) {
      await finishAction(recheckAction, "failed", "customer_reply_recheck_failed", null, counters);
      const failedAt = new Date().toISOString();
      const { error: settleError } = await supabase.from("refund_follow_up_cycles")
        .update({
          recheck_claimed_at: failedAt,
          status: "manual_review",
          failed_at: failedAt,
          failure_code: "customer_reply_recheck_failed",
        })
        .eq("id", cycle.id)
        .is("recheck_claimed_at", null);
      if (settleError) throw settleError;
      await supabase.from("refund_case_events").insert({
        refund_case_id: refundCase.id,
        event_type: "refund_customer_reply_recheck_failed",
        message: "The verified customer reply recheck failed closed and requires manager review.",
        metadata: {
          follow_up_cycle_id: cycle.id,
          source_message_id: sourceMessageId,
          payload_redacted: true,
        },
      });
      await sendFollowUpManagerNotice({
        refundCase,
        noticeKind: "customer_reply_review",
      });
      throw recheckError;
    }
  }
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
          metadata: {
            configured: false,
            policy_version: lookupResult.policyVersion,
            confidence_class: lookupResult.confidenceClass,
            reason_codes: lookupResult.reasonCodes,
            payload_redacted: true,
          },
        });
        if (eventError) throw eventError;
        await routeProviderException({
          runId,
          refundCase,
          reasonCategory: "provider_setup",
          counters,
        });
        await finishAction(action, "completed", "nayax_setup_needed", null, counters);
        continue;
      }

      const walletCorrectionUseful =
        lookupResult.recommendationState !== "high_confidence" &&
        (
          refundCase.card_wallet_used ||
          lookupResult.reasonCodes.some((reasonCode) =>
            [
              "tokenized_last4_noncorrelating",
              "wallet_payment",
              "missing_customer_card_last4",
            ].includes(reasonCode)
          )
        );

      if (walletCorrectionUseful && !refundCase.card_wallet_used) {
        const { error: walletDetectionError } = await supabase
          .from("refund_cases")
          .update({ card_wallet_used: true })
          .eq("id", refundCase.id);
        if (walletDetectionError) throw walletDetectionError;
        const { error: walletDetectionEventError } = await supabase
          .from("refund_case_events")
          .insert({
            refund_case_id: refundCase.id,
            event_type: "wallet_payment_detected_from_provider_evidence",
            message:
              "Nayax evidence indicated a tokenized wallet payment, so the automated wallet-detail correction path was opened.",
            metadata: {
              reason_codes: lookupResult.reasonCodes,
              payload_redacted: true,
            },
          });
        if (walletDetectionEventError) throw walletDetectionEventError;
      }

      if (
        lookupResult.recommendationState !== "no_safe_match" &&
        !walletCorrectionUseful
      ) {
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
            confidence_class: lookupResult.confidenceClass,
            reason_codes: lookupResult.reasonCodes,
            policy_version: lookupResult.policyVersion,
            candidate_count: lookupResult.candidates.length,
            recommended_rank: lookupResult.recommendationState === "high_confidence" ? 1 : null,
            one_click_base_eligible: lookupResult.oneClickEligible,
            window_hours: lookupResult.windowHours,
            provider_record_count: lookupResult.providerRecordCount ?? null,
            provider_window_record_count: lookupResult.providerWindowRecordCount ?? null,
            qr_claim_evidence_status: lookupResult.qrClaimEvidenceStatus,
            payload_redacted: true,
          },
        });
        if (eventError) throw eventError;
        await finishAction(action, "completed", "nayax_review_ready", null, counters);
        continue;
      }

      if (
        walletCorrectionUseful &&
        !["sent", "received", "fallback_eligible"].includes(
          refundCase.wallet_correction_state,
        )
      ) {
        if (!(await automaticCustomerContactAllowed())) {
          await routeFollowUpManualReview({
            runId,
            refundCase,
            actionKeySuffix: `wallet-contact-disabled:${refundCase.wallet_correction_version}`,
            noticeKind: "follow_up_manual_review",
            policyWindowStart,
            counters,
          });
          await finishAction(
            action,
            "completed",
            "automatic_customer_contact_disabled",
            null,
            counters,
          );
          continue;
        }
        const correctionAction = await claimAction(
          runId,
          refundCase.id,
          `wallet_correction:${refundCase.id}:${refundCase.wallet_correction_version + 1}`,
          "wallet_correction_request",
          refundCase.status,
          policyWindowStart,
          counters,
        );
        if (!correctionAction.claimed) {
          await finishAction(
            action,
            "suppressed",
            "wallet_correction_already_requested",
            null,
            counters,
          );
          continue;
        }

        const correctionResult = await sendWalletCorrectionMessage(
          refundCase,
          false,
        );
        if (correctionResult.status === "sent") {
          const { error: updateError } = await supabase.from("refund_cases")
            .update({
              correlation_status: "no_match",
              correlation_source: "nayax",
              correlation_confidence: 0,
              correlation_summary:
                `${lookupResult.summary} A secure wallet-detail correction was requested automatically.`,
              nayax_recommendation_state: lookupResult.recommendationState,
              nayax_recommendation_policy_version: lookupResult.policyVersion,
              nayax_recommendation_evaluated_at: lookupResult.lastCheckedAt,
              nayax_match_execution_eligible: false,
            })
            .eq("id", refundCase.id);
          if (updateError) throw updateError;

          await finishAction(
            correctionAction,
            "completed",
            "wallet_correction_sent",
            correctionResult.messageId,
            counters,
          );
          await finishAction(
            action,
            "completed",
            "nayax_no_match_wallet_correction_sent",
            correctionResult.messageId,
            counters,
          );
        } else if (correctionResult.status === "suppressed") {
          await finishAction(
            correctionAction,
            "suppressed",
            "automatic_customer_contact_disabled",
            null,
            counters,
          );
          await routeFollowUpManualReview({
            runId,
            refundCase,
            actionKeySuffix: `wallet-contact-disabled:${refundCase.wallet_correction_version}`,
            noticeKind: "follow_up_manual_review",
            policyWindowStart,
            counters,
          });
          await finishAction(
            action,
            "completed",
            "automatic_customer_contact_disabled",
            null,
            counters,
          );
        } else {
          await finishAction(
            correctionAction,
            "failed",
            "customer_email_failed",
            correctionResult.messageId,
            counters,
          );
          await finishAction(
            action,
            "failed",
            "wallet_correction_email_failed",
            correctionResult.messageId,
            counters,
          );
        }
        continue;
      }

      if (walletCorrectionUseful) {
        await routeFollowUpManualReview({
          runId,
          refundCase,
          actionKeySuffix: `wallet:${refundCase.wallet_correction_version}`,
          noticeKind: "follow_up_manual_review",
          policyWindowStart,
          counters,
        });
        await finishAction(action, "completed", "wallet_correction_pending_or_exhausted", null, counters);
        continue;
      }

      const { error: noMatchUpdateError } = await supabase.from("refund_cases")
        .update({
          status: "needs_review",
          correlation_status: "no_match",
          correlation_source: "nayax",
          correlation_confidence: 0,
          correlation_summary: `${lookupResult.summary} No deterministic customer correction has been assumed.`,
          automation_state: "under_review",
          nayax_recommendation_state: lookupResult.recommendationState,
          nayax_recommendation_policy_version: lookupResult.policyVersion,
          nayax_recommendation_evaluated_at: lookupResult.lastCheckedAt,
          nayax_match_execution_eligible: false,
          automation_follow_up_due_at: null,
        })
        .eq("id", refundCase.id);
      if (noMatchUpdateError) throw noMatchUpdateError;

      const noMatchCase = {
        ...refundCase,
        status: "needs_review",
        automation_state: "under_review",
      };
      const sourceCustomerMessageId = await getLatestVerifiedCustomerMessageId(
        refundCase.id,
      );
      const cycleClaim = await claimFollowUpCycle({
        refundCase: noMatchCase,
        reasonCode: "no_safe_match",
        sourceCustomerMessageId,
        requestedFields: [],
      });

      if (!cycleClaim.claimed || !cycleClaim.cycle) {
        await routeFollowUpManualReview({
          runId,
          refundCase: noMatchCase,
          actionKeySuffix: `no-safe-match:${refundCase.deterministic_fact_version}:${cycleClaim.reason ?? "not-claimed"}`,
          noticeKind: "follow_up_manual_review",
          policyWindowStart,
          counters,
        });
        await finishAction(
          action,
          "completed",
          cycleClaim.reason ?? "no_safe_match_manual_review",
          null,
          counters,
        );
        continue;
      }

      const noMatchResult = await sendDeterministicFollowUpMessage(
        noMatchCase,
        cycleClaim.cycle,
        "request",
      );
      if (noMatchResult.status === "sent") {
        counters.nayaxNoMatchMovedToWaiting += 1;
        counters.noSafeMatchRequestsSent += 1;
        const { error: eventError } = await supabase.from("refund_case_events").insert({
          refund_case_id: refundCase.id,
          event_type: "nayax_auto_lookup_no_safe_match_contacted",
          message: "A confirmed provider no-safe-match result triggered one versioned correction-focused customer message.",
          metadata: {
            follow_up_cycle_id: cycleClaim.cycle.id,
            template_version: cycleClaim.cycle.templateVersion,
            window_hours: lookupResult.windowHours,
            candidate_count: lookupResult.candidates.length,
            recommendation_state: lookupResult.recommendationState,
            confidence_class: lookupResult.confidenceClass,
            reason_codes: lookupResult.reasonCodes,
            policy_version: lookupResult.policyVersion,
            provider_record_count: lookupResult.providerRecordCount ?? null,
            provider_window_record_count: lookupResult.providerWindowRecordCount ?? null,
            qr_claim_evidence_status: lookupResult.qrClaimEvidenceStatus,
            payload_redacted: true,
          },
        });
        if (eventError) throw eventError;
        await finishAction(
          action,
          "completed",
          "nayax_no_safe_match_customer_contacted",
          noMatchResult.messageId,
          counters,
        );
      } else {
        await finishAction(
          action,
          "failed",
          noMatchResult.status === "suppressed"
            ? "automatic_customer_contact_disabled"
            : "customer_email_failed",
          noMatchResult.messageId,
          counters,
        );
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
      try {
        await routeProviderException({
          runId,
          refundCase,
          reasonCategory: classifyProviderException(error),
          counters,
        });
      } catch (noticeError) {
        console.error("refund provider exception notice failed", {
          errorType: noticeError instanceof Error ? noticeError.name : typeof noticeError,
        });
      }
      await finishAction(action, "failed", sanitizeFailureCategory(error), null, counters);
    }
  }
};

const runWalletCorrectionExpirySweep = async (
  runId: string,
  counters: SweepCounters,
  policyWindowStart: string,
) => {
  if (!supabase) return;
  const customerContactAllowed = await automaticCustomerContactAllowed();
  if (!customerContactAllowed) {
    addReason(counters, "automatic_customer_contact_disabled");
  }
  const { data: dueCases, error: dueError } = await supabase
    .from("refund_cases")
    .select(caseSelect)
    .eq("payment_method", "card")
    .eq("card_wallet_used", true)
    .eq("status", "waiting_on_customer")
    .in("wallet_correction_state", ["sent", "expired"])
    .lte("automation_follow_up_due_at", new Date().toISOString())
    .limit(25);
  if (dueError) throw dueError;

  for (
    const rawRefundCase of (dueCases ?? []) as unknown as RawRefundSweepCase[]
  ) {
    const refundCase = normalizeRefundSweepCase(rawRefundCase);
    counters.evaluatedCaseIds.add(refundCase.id);

    if (refundCase.wallet_correction_version >= 2) {
      const { error: contextError } = await supabase
        .from("refund_wallet_correction_contexts")
        .update({
          status: "expired",
          updated_at: new Date().toISOString(),
        })
        .eq("refund_case_id", refundCase.id)
        .eq("status", "pending")
        .lte("expires_at", new Date().toISOString());
      if (contextError) throw contextError;

      const { error: caseError } = await supabase
        .from("refund_cases")
        .update({
          status: "needs_review",
          automation_state: "fallback_eligible",
          automation_follow_up_due_at: null,
          wallet_correction_state: "fallback_eligible",
        })
        .eq("id", refundCase.id);
      if (caseError) throw caseError;

      const { error: eventError } = await supabase
        .from("refund_case_events")
        .insert({
          refund_case_id: refundCase.id,
          event_type: "wallet_correction_contact_limit_reached",
          message:
            "The secure wallet-detail link and one reminder expired; the case is eligible for the approved fallback route.",
          metadata: {
            link_count: refundCase.wallet_correction_version,
            fallback_method: "tbd",
            payload_redacted: true,
          },
        });
      if (eventError) throw eventError;
      addReason(counters, "wallet_correction_fallback_eligible");
      continue;
    }

    if (!customerContactAllowed) {
      await routeFollowUpManualReview({
        runId,
        refundCase,
        actionKeySuffix: `wallet-reminder-contact-disabled:${refundCase.wallet_correction_version}`,
        noticeKind: "follow_up_manual_review",
        policyWindowStart,
        counters,
      });
      continue;
    }

    const action = await claimAction(
      runId,
      refundCase.id,
      `wallet_correction_reminder:${refundCase.id}:${refundCase.wallet_correction_version + 1}`,
      "wallet_correction_reminder",
      refundCase.status,
      policyWindowStart,
      counters,
    );
    if (!action.claimed) continue;

    const result = await sendWalletCorrectionMessage(refundCase, true);
    if (result.status === "sent") {
      counters.remindersSent += 1;
      await finishAction(
        action,
        "completed",
        "wallet_correction_reminder_sent",
        result.messageId,
        counters,
      );
    } else {
      counters.remindersFailed += 1;
      await finishAction(
        action,
        "failed",
        "customer_email_failed",
        result.messageId,
        counters,
      );
    }
  }
};

const runReminderSweep = async (
  runId: string,
  counters: SweepCounters,
  policyWindowStart: string,
) => {
  if (!supabase || !automaticCustomerContactEnabled) return;
  const { data, error } = await supabase.rpc(
    "service_claim_due_refund_follow_up_reminders",
    { p_limit: 25 },
  );
  if (error) throw error;
  const claim = data && typeof data === "object" && !Array.isArray(data)
    ? data as Record<string, unknown>
    : {};
  if (claim.enabled !== true) {
    addReason(counters, "automatic_customer_contact_disabled");
    return;
  }
  const jobs = Array.isArray(claim.reminders) ? claim.reminders : [];

  for (const rawJob of jobs) {
    const job = rawJob && typeof rawJob === "object"
      ? rawJob as Record<string, unknown>
      : {};
    const cycleId = textValue(job.cycleId ?? job.cycle_id ?? job.id);
    const refundCaseId = textValue(job.refundCaseId ?? job.refund_case_id);
    if (!cycleId || !refundCaseId) {
      counters.actionsFailed += 1;
      addReason(counters, "reminder_contract_invalid");
      continue;
    }
    const cycle = normalizeFollowUpCycle({ ...job, id: cycleId, refundCaseId }) ??
      await getFollowUpCycle(cycleId);
    const refundCase = await getSweepCase(refundCaseId);
    if (!cycle || !refundCase) {
      counters.actionsFailed += 1;
      addReason(counters, "reminder_contract_invalid");
      continue;
    }
    counters.evaluatedCaseIds.add(refundCase.id);

    const action = await claimAction(
      runId,
      refundCase.id,
      `reminder:${cycle.id}`,
      "customer_reminder",
      refundCase.status,
      policyWindowStart,
      counters,
    );
    if (!action.claimed) continue;

    const result = await sendDeterministicFollowUpMessage(
      refundCase,
      cycle,
      "reminder",
    );
    if (result.status === "sent") {
      counters.remindersSent += 1;
      await finishAction(action, "completed", "reminder_sent", result.messageId, counters);
    } else if (result.status === "suppressed") {
      await finishAction(
        action,
        "suppressed",
        "automatic_customer_contact_disabled",
        result.messageId,
        counters,
      );
    } else {
      counters.remindersFailed += 1;
      await finishAction(
        action,
        "failed",
        "customer_email_failed",
        result.messageId,
        counters,
      );
    }
  }
};

const runManagerAgingSweep = async (
  runId: string,
  counters: SweepCounters,
  policyWindowStart: string,
) => {
  if (!supabase) return;
  if (!managerAgingNoticesEnabled) {
    addReason(counters, "manager_aging_notices_disabled");
    return;
  }
  if (
    !Number.isInteger(managerReminderBusinessDays) ||
    managerReminderBusinessDays < 1 || managerReminderBusinessDays > 10 ||
    !Number.isInteger(managerEscalationBusinessDays) ||
    managerEscalationBusinessDays < 2 || managerEscalationBusinessDays > 20 ||
    managerEscalationBusinessDays <= managerReminderBusinessDays
  ) {
    counters.actionsFailed += 1;
    addReason(counters, "manager_aging_config_invalid");
    return;
  }

  const { data: attentionStates, error: attentionError } = await supabase
    .from("refund_manager_attention_states")
    .select(
      "refund_case_id,attention_version,attention_started_at,reminder_sent_at,escalation_sent_at",
    )
    .not("attention_started_at", "is", null)
    .is("delivery_review_required_at", null)
    .order("attention_started_at", { ascending: true })
    .limit(100);
  if (attentionError) throw attentionError;

  for (const state of (attentionStates ?? []) as RefundManagerAttentionState[]) {
    const attentionStartedAt = new Date(state.attention_started_at);
    const attentionVersion = integerValue(state.attention_version);
    if (!Number.isFinite(attentionStartedAt.getTime()) || attentionVersion < 1) {
      counters.actionsFailed += 1;
      addReason(counters, "manager_attention_contract_invalid");
      continue;
    }
    const observedAt = new Date();
    const businessDayAge = refundBusinessDaysElapsed({
      startedAt: attentionStartedAt,
      observedAt,
      timeZone: automationTimezone,
    });
    const milestone: RefundManagerAgingMilestone | null =
      businessDayAge >= managerEscalationBusinessDays &&
        !state.escalation_sent_at
        ? "escalation"
        : businessDayAge >= managerReminderBusinessDays &&
            !state.reminder_sent_at && !state.escalation_sent_at
          ? "reminder"
          : null;
    if (!milestone) continue;

    const authorizeNotice = async () => {
      const { data, error } = await supabase.rpc(
        "service_authorize_refund_manager_aging_notice",
        {
          p_refund_case_id: state.refund_case_id,
          p_attention_version: attentionVersion,
          p_milestone: milestone,
          p_observed_at: new Date().toISOString(),
          p_timezone: automationTimezone,
          p_reminder_business_days: managerReminderBusinessDays,
          p_escalation_business_days: managerEscalationBusinessDays,
          p_template_version: REFUND_MANAGER_AGING_TEMPLATE_VERSION,
        },
      );
      if (error) throw error;
      return data && typeof data === "object"
        ? data as Record<string, unknown>
        : {};
    };

    const preauthorization = await authorizeNotice();
    if (preauthorization.authorized !== true) {
      addReason(
        counters,
        `manager_notice_${textValue(preauthorization.reason) || "suppressed"}`,
      );
      continue;
    }

    const refundCase = await getSweepCase(state.refund_case_id);
    if (!refundCase) {
      counters.actionsFailed += 1;
      addReason(counters, "manager_notice_case_missing");
      continue;
    }
    counters.evaluatedCaseIds.add(refundCase.id);
    const action = await claimAction(
      runId,
      refundCase.id,
      `manager_aging:${milestone}:${refundCase.id}:v${attentionVersion}`,
      milestone === "reminder" ? "manager_reminder" : "manager_escalation",
      refundCase.status,
      policyWindowStart,
      counters,
    );
    if (!action.claimed) continue;

    try {
      // Bind recipients from the current mapping immediately before the final
      // case authorization. The bound routing is then used for this send only.
      const resolvedRouting = await resolveRefundManagerActionNoticeRouting({
        supabase,
        refundCaseId: refundCase.id,
        customerEmail: refundCase.customer_email,
      });
      const authorization = await authorizeNotice();
      if (authorization.authorized !== true) {
        await finishAction(
          action,
          "suppressed",
          `manager_notice_${textValue(authorization.reason) || "stale"}`,
          null,
          counters,
        );
        continue;
      }
      const authorizedBusinessAge = integerValue(
        authorization.businessDayAge ?? authorization.business_day_age,
      );
      const publicLabels = resolveRefundPublicLabels({
        locationName: refundCase.reporting_locations?.name,
        publicMachineLabel:
          refundCase.reporting_machines?.refund_public_display_label,
        machineLabel: refundCase.reporting_machines?.machine_label,
      });
      const message = buildRefundManagerAgingNotice({
        milestone,
        publicReference: refundCase.public_reference,
        machineLabel: publicLabels.machineLabel,
        locationName: publicLabels.locationName,
        businessDayAge: authorizedBusinessAge,
        status: textValue(authorization.caseStatus) || refundCase.status,
      });
      const notice = await sendRefundManagerActionNotice({
        supabase,
        refundCaseId: refundCase.id,
        customerEmail: refundCase.customer_email,
        subject: message.subject,
        summaryText: message.summaryText,
        resolvedRouting,
      });
      const outcome = notice.usedOpsFallback
        ? "operations_exception"
        : "delivered";
      const { data: completed, error: completionError } = await supabase.rpc(
        "service_complete_refund_manager_aging_notice",
        {
          p_refund_case_id: refundCase.id,
          p_attention_version: attentionVersion,
          p_milestone: milestone,
          p_outcome: outcome,
          p_template_version: message.templateVersion,
          p_business_day_age: authorizedBusinessAge,
          p_manager_recipient_count: notice.managerRecipientCount,
          p_recipient_count: notice.recipientCount,
          p_resolution_status: notice.resolutionStatus,
        },
      );
      if (completionError) throw completionError;
      if (completed !== true) {
        await finishAction(
          action,
          "completed",
          "manager_notice_sent_state_changed",
          null,
          counters,
        );
        continue;
      }
      if (milestone === "reminder") counters.managerRemindersSent += 1;
      if (milestone === "escalation") counters.escalationsSent += 1;
      if (notice.usedOpsFallback) counters.managerRoutingExceptionsSent += 1;
      await finishAction(
        action,
        "completed",
        notice.usedOpsFallback
          ? "manager_routing_exception_sent"
          : `manager_${milestone}_sent`,
        null,
        counters,
      );
    } catch (error) {
      counters.managerNoticesFailed += 1;
      if (milestone === "escalation") counters.escalationsFailed += 1;
      try {
        const { error: deliveryReviewError } = await supabase.rpc(
          "service_complete_refund_manager_aging_notice",
          {
          p_refund_case_id: refundCase.id,
          p_attention_version: attentionVersion,
          p_milestone: milestone,
          p_outcome: "delivery_unknown",
          p_template_version: REFUND_MANAGER_AGING_TEMPLATE_VERSION,
          p_business_day_age: businessDayAge,
          p_manager_recipient_count: 0,
          p_recipient_count: 0,
          p_resolution_status: "delivery_unknown",
          },
        );
        if (deliveryReviewError) throw deliveryReviewError;
      } catch {
        // The once-only automation action still blocks a blind retry if durable
        // delivery-review settlement is itself unavailable.
      }
      console.error("refund-case-automation-sweep manager aging notice failed", {
        errorType: error instanceof Error ? error.name : typeof error,
      });
      await finishAction(
        action,
        "failed",
        "manager_notice_delivery_unknown",
        null,
        counters,
      );
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

    if (!automaticCustomerContactEnabled) {
      addReason(counters, "automatic_customer_contact_disabled");
    }
    await settleStaleFollowUpClaims(counters);
    await runCustomerReplyFollowUpSweep(runId, counters, policyWindowStart);
    await runMissingInformationSweep(runId, counters, policyWindowStart);
    await runCashNoSafeMatchSweep(runId, counters, policyWindowStart);
    await runCardNayaxLookupSweep(runId, counters, policyWindowStart);
    await runWalletCorrectionExpirySweep(
      runId,
      counters,
      policyWindowStart,
    );
    await runReminderSweep(runId, counters, policyWindowStart);
    await runManagerAgingSweep(runId, counters, policyWindowStart);
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
