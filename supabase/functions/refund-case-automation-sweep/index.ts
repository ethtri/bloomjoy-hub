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
const reminderDelayDays = Number(Deno.env.get("REFUND_MORE_INFO_REMINDER_DAYS") || 2);
const escalationDays = Number(Deno.env.get("REFUND_ESCALATION_DAYS") || 5);

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
      await supabase
        ?.from("refund_case_messages")
        .update({ status: "sent", sent_at: new Date().toISOString() })
        .eq("id", messageId);
    }

    await supabase
      ?.from("refund_cases")
      .update({
        customer_last_contacted_at: new Date().toISOString(),
        last_customer_message_type: messageType,
        automation_follow_up_due_at:
          messageType === "more_info" || messageType === "reminder"
            ? new Date(Date.now() + reminderDelayDays * 24 * 60 * 60 * 1000).toISOString()
            : null,
      })
      .eq("id", refundCase.id);

    await supabase?.from("refund_case_events").insert({
      refund_case_id: refundCase.id,
      event_type: "automation_sweep_message",
      message: `Automated ${messageType.replaceAll("_", " ")} email sent.`,
      metadata: {
        message_type: messageType,
        message_id: messageId,
        payload_redacted: true,
      },
    });

    return "sent";
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

    return "failed";
  }
};

const escalateStaleCase = async (refundCase: RefundSweepCase) => {
  await supabase?.from("refund_cases")
    .update({
      automation_state: "escalated",
      automation_follow_up_due_at: null,
    })
    .eq("id", refundCase.id);

  await supabase?.from("refund_case_events").insert({
    refund_case_id: refundCase.id,
    event_type: "automation_escalated",
    message: "Refund case escalated by automation sweep.",
    metadata: {
      public_reference: refundCase.public_reference,
      status: refundCase.status,
      payload_redacted: true,
    },
  });

  try {
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
    return "sent";
  } catch (error) {
    console.error("refund-case-automation-sweep internal escalation failed", {
      errorType: error instanceof Error ? error.name : typeof error,
    });
    return "failed";
  }
};

const runCardNayaxLookupSweep = async () => {
  if (!supabase) {
    return {
      nayaxLookupsRun: 0,
      nayaxCandidatesFound: 0,
      nayaxNoMatchMovedToWaiting: 0,
      nayaxLookupFailures: 0,
      nayaxSetupNeeded: 0,
    };
  }

  const { data: lookupCases, error: lookupCasesError } = await supabase
    .from("refund_cases")
    .select(caseSelect)
    .eq("payment_method", "card")
    .eq("status", "needs_review")
    .in("correlation_status", ["not_started", "needs_nayax", "nayax_not_configured"])
    .limit(10);

  if (lookupCasesError) throw lookupCasesError;

  let nayaxLookupsRun = 0;
  let nayaxCandidatesFound = 0;
  let nayaxNoMatchMovedToWaiting = 0;
  let nayaxLookupFailures = 0;
  let nayaxSetupNeeded = 0;

  for (const rawRefundCase of (lookupCases ?? []) as unknown as RawRefundSweepCase[]) {
    const refundCase = normalizeRefundSweepCase(rawRefundCase);

    try {
      const lookupResult = await lookupNayaxCandidatesForRefundCase({
        supabase,
        caseId: refundCase.id,
        actorUserId: null,
      });

      nayaxLookupsRun += 1;

      if (!lookupResult.configured) {
        nayaxSetupNeeded += 1;
        await supabase.from("refund_cases")
          .update({
            correlation_status: "nayax_not_configured",
            correlation_source: "nayax",
            correlation_confidence: 0,
            correlation_summary: lookupResult.message || "Nayax lookup needs setup before card matching can run.",
            automation_state: "under_review",
          })
          .eq("id", refundCase.id);

        await supabase.from("refund_case_events").insert({
          refund_case_id: refundCase.id,
          event_type: "nayax_auto_lookup_setup_needed",
          message: "Automated Nayax lookup could not run because setup is incomplete.",
          metadata: {
            configured: false,
            payload_redacted: true,
          },
        });
        continue;
      }

      if (lookupResult.candidates.length > 0) {
        nayaxCandidatesFound += lookupResult.candidates.length;
        await supabase.from("refund_cases")
          .update({
            status: "needs_review",
            correlation_status: "manual_review",
            correlation_source: "nayax",
            correlation_confidence: Math.max(0.01, lookupResult.candidates[0]?.matchConfidence ?? 0.01),
            correlation_summary:
              `Nayax lookup found ${lookupResult.candidates.length} candidate(s) inside +/- ${lookupResult.windowHours} hours. Manager must confirm the match.`,
            automation_state: "under_review",
          })
          .eq("id", refundCase.id);

        await supabase.from("refund_case_events").insert({
          refund_case_id: refundCase.id,
          event_type: "nayax_auto_lookup_candidates_found",
          message: "Automated Nayax lookup found sanitized card-sale candidate evidence for manager review.",
          metadata: {
            candidate_count: lookupResult.candidates.length,
            window_hours: lookupResult.windowHours,
            provider_record_count: lookupResult.providerRecordCount ?? null,
            provider_window_record_count: lookupResult.providerWindowRecordCount ?? null,
            payload_redacted: true,
          },
        });
        continue;
      }

      const moreInfoResult = await sendCustomerSweepMessage(
        {
          ...refundCase,
          status: "waiting_on_customer",
          automation_state: "more_info_needed",
        },
        "more_info",
      );

      if (moreInfoResult === "sent") {
        await supabase.from("refund_cases")
          .update({
            status: "waiting_on_customer",
            correlation_status: "no_match",
            correlation_source: "nayax",
            correlation_confidence: 0,
            correlation_summary:
              `No Nayax card sale candidate was found inside +/- ${lookupResult.windowHours} hours. More information requested from the customer.`,
            automation_state: "more_info_needed",
            automation_follow_up_due_at: new Date(Date.now() + reminderDelayDays * 24 * 60 * 60 * 1000).toISOString(),
          })
          .eq("id", refundCase.id);

        nayaxNoMatchMovedToWaiting += 1;
        await supabase.from("refund_case_events").insert({
          refund_case_id: refundCase.id,
          event_type: "nayax_auto_lookup_no_match",
          message: "Automated Nayax lookup found no candidate, so the customer was asked for more information.",
          metadata: {
            window_hours: lookupResult.windowHours,
            provider_record_count: lookupResult.providerRecordCount ?? null,
            provider_window_record_count: lookupResult.providerWindowRecordCount ?? null,
            payload_redacted: true,
          },
        });
      } else {
        await supabase.from("refund_case_events").insert({
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
      }
    } catch (error) {
      nayaxLookupFailures += 1;
      console.error("refund-case-automation-sweep Nayax lookup failed", {
        errorType: error instanceof Error ? error.name : typeof error,
      });

      await supabase.from("refund_case_events").insert({
        refund_case_id: refundCase.id,
        event_type: "nayax_auto_lookup_failed",
        message: "Automated Nayax lookup failed and the case remains in manager review.",
        metadata: {
          error_type: error instanceof NayaxLookupRequestError ? error.name : error instanceof Error ? error.name : typeof error,
          payload_redacted: true,
        },
      });
    }
  }

  return {
    nayaxLookupsRun,
    nayaxCandidatesFound,
    nayaxNoMatchMovedToWaiting,
    nayaxLookupFailures,
    nayaxSetupNeeded,
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
      return jsonResponse({ error: "Refund automation sweep is not configured." }, 500);
    }

    if (!isAuthorized(req)) {
      return jsonResponse({ error: "Unauthorized." }, 401);
    }

    const dueCutoff = new Date().toISOString();
    const reminderCutoff = daysAgoIso(Number.isFinite(reminderDelayDays) ? reminderDelayDays : 2);
    const escalationCutoff = daysAgoIso(Number.isFinite(escalationDays) ? escalationDays : 5);
    const nayaxSweep = await runCardNayaxLookupSweep();

    const { data: reminderCases, error: reminderError } = await supabase
      .from("refund_cases")
      .select(caseSelect)
      .eq("status", "waiting_on_customer")
      .lte("automation_follow_up_due_at", dueCutoff)
      .limit(25);

    if (reminderError) throw reminderError;

    let remindersSent = 0;
    let remindersFailed = 0;
    for (const rawRefundCase of (reminderCases ?? []) as unknown as RawRefundSweepCase[]) {
      const refundCase = normalizeRefundSweepCase(rawRefundCase);
      if (
        refundCase.customer_last_contacted_at &&
        refundCase.customer_last_contacted_at > reminderCutoff
      ) {
        continue;
      }

      const result = await sendCustomerSweepMessage(refundCase, "reminder");
      if (result === "sent") remindersSent += 1;
      if (result === "failed") remindersFailed += 1;
    }

    const { data: staleCases, error: staleError } = await supabase
      .from("refund_cases")
      .select(caseSelect)
      .in("status", ["needs_review", "waiting_on_customer", "approved", "card_refund_pending", "cash_zelle_pending"])
      .lte("created_at", escalationCutoff)
      .neq("automation_state", "escalated")
      .limit(25);

    if (staleError) throw staleError;

    let escalationsSent = 0;
    let escalationsFailed = 0;
    for (const rawRefundCase of (staleCases ?? []) as unknown as RawRefundSweepCase[]) {
      const refundCase = normalizeRefundSweepCase(rawRefundCase);
      const result = await escalateStaleCase(refundCase);
      if (result === "sent") escalationsSent += 1;
      if (result === "failed") escalationsFailed += 1;
    }

    return jsonResponse({
      ...nayaxSweep,
      remindersSent,
      remindersFailed,
      escalationsSent,
      escalationsFailed,
      payloadRedacted: true,
    });
  } catch (error) {
    console.error("refund-case-automation-sweep error", {
      errorType: error instanceof Error ? error.name : typeof error,
    });
    return jsonResponse({ error: "Unable to run refund automation sweep." }, 500);
  }
});
