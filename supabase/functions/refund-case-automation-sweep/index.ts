import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.1";
import { corsHeaders } from "../_shared/cors.ts";
import { sendInternalEmail } from "../_shared/internal-email.ts";
import {
  buildRefundCustomerEmail,
  sendRefundCustomerEmail,
  type RefundCustomerMessageType,
} from "../_shared/refund-email.ts";

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
  reporting_machines?: { machine_label: string | null } | null;
  reporting_locations?: { name: string | null } | null;
};

type OneOrMany<T> = T | T[] | null | undefined;

type RawRefundSweepCase = Omit<RefundSweepCase, "reporting_machines" | "reporting_locations"> & {
  reporting_machines?: OneOrMany<{ machine_label: string | null }>;
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
  reporting_machines(machine_label),
  reporting_locations(name)
`;

const logMessage = async (
  refundCase: RefundSweepCase,
  messageType: RefundCustomerMessageType,
  status: "pending" | "sent" | "failed" | "skipped",
  errorMessage?: string | null,
) => {
  if (!supabase) return null;
  const email = buildRefundCustomerEmail({
    messageType,
    publicReference: refundCase.public_reference,
    customerName: refundCase.customer_name,
    customerEmail: refundCase.customer_email,
    machineLabel: refundCase.reporting_machines?.machine_label,
    locationName: refundCase.reporting_locations?.name,
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

  try {
    await sendRefundCustomerEmail({
      messageType,
      publicReference: refundCase.public_reference,
      customerName: refundCase.customer_name,
      customerEmail: refundCase.customer_email,
      machineLabel: refundCase.reporting_machines?.machine_label,
      locationName: refundCase.reporting_locations?.name,
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
          messageType === "reminder"
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
    await sendInternalEmail({
      subject: `Refund case needs attention: ${refundCase.public_reference}`,
      text: [
        "A Bloomjoy refund case needs attention.",
        "",
        `Reference: ${refundCase.public_reference}`,
        `Status: ${refundCase.status}`,
        `Machine: ${refundCase.reporting_machines?.machine_label ?? "n/a"}`,
        `Location: ${refundCase.reporting_locations?.name ?? "n/a"}`,
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
