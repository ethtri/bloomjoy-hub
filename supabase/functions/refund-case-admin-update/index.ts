import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.1";
import { resolveSupabaseAccessToken } from "../_shared/auth.ts";
import { corsHeaders } from "../_shared/cors.ts";
import {
  buildRefundCustomerEmail,
  sendRefundCustomerEmail,
  type RefundCustomerMessageType,
} from "../_shared/refund-email.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

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

const sanitizeText = (value: unknown, maxLength = 800) =>
  typeof value === "string" || typeof value === "number" || typeof value === "boolean"
    ? String(value).trim().slice(0, maxLength)
    : "";

const isUuid = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

const centsFromInput = (value: unknown): number | null => {
  if (value === null || typeof value === "undefined") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? Math.round(numeric) : null;
};

type RefundCaseRow = {
  id: string;
  public_reference: string;
  status: string;
  decision: string | null;
  decision_reason: string | null;
  customer_email: string;
  customer_name: string | null;
  payment_method: string;
  refund_amount_cents: number | null;
  payment_amount_cents: number | null;
  reporting_machine_id: string;
  reporting_location_id: string;
  reporting_machines?: { machine_label: string | null } | null;
  reporting_locations?: { name: string | null } | null;
};

const selectCaseQuery = `
  id,
  public_reference,
  status,
  decision,
  decision_reason,
  customer_email,
  customer_name,
  payment_method,
  refund_amount_cents,
  payment_amount_cents,
  reporting_machine_id,
  reporting_location_id,
  reporting_machines(machine_label),
  reporting_locations(name)
`;

const getRefundCase = async (caseId: string): Promise<RefundCaseRow | null> => {
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("refund_cases")
    .select(selectCaseQuery)
    .eq("id", caseId)
    .maybeSingle();

  if (error) throw error;
  return data as RefundCaseRow | null;
};

const resolveMessageType = (
  beforeRow: RefundCaseRow,
  afterRow: RefundCaseRow,
): RefundCustomerMessageType | null => {
  if (afterRow.status === "waiting_on_customer" && beforeRow.status !== "waiting_on_customer") {
    return "more_info";
  }

  if (afterRow.status === "denied" && beforeRow.status !== "denied") {
    return "denied";
  }

  if (afterRow.status === "completed" && beforeRow.status !== "completed") {
    return "completed";
  }

  if (
    afterRow.decision === "approved" &&
    beforeRow.decision !== "approved" &&
    ["approved", "card_refund_pending", "cash_zelle_pending"].includes(afterRow.status)
  ) {
    return "approved";
  }

  return null;
};

const syncAutomationState = async (
  refundCaseId: string,
  messageType: RefundCustomerMessageType | null,
) => {
  if (!supabase || !messageType) return;

  const nextAutomationState = {
    more_info: "more_info_needed",
    reminder: "more_info_needed",
    approved: "approved",
    denied: "denied",
    completed: "completed",
    confirmation: "submitted",
    status_update: "under_review",
  }[messageType];

  await supabase
    .from("refund_cases")
    .update({
      automation_state: nextAutomationState,
      customer_last_contacted_at: new Date().toISOString(),
      last_customer_message_type: messageType,
      automation_follow_up_due_at: messageType === "more_info"
        ? new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString()
        : null,
    })
    .eq("id", refundCaseId);
};

const logCustomerMessage = async ({
  refundCase,
  messageType,
  status,
  errorMessage,
}: {
  refundCase: RefundCaseRow;
  messageType: RefundCustomerMessageType;
  status: "pending" | "sent" | "failed" | "skipped";
  errorMessage?: string | null;
}) => {
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
    decisionReason: refundCase.decision_reason,
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

const sendAndLogCustomerMessage = async (
  refundCase: RefundCaseRow,
  messageType: RefundCustomerMessageType,
) => {
  if (!refundCase.customer_email) {
    await logCustomerMessage({
      refundCase,
      messageType,
      status: "skipped",
      errorMessage: "missing_customer_email",
    });
    return { type: messageType, status: "skipped" };
  }

  const messageId = await logCustomerMessage({
    refundCase,
    messageType,
    status: "pending",
  });

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
      decisionReason: refundCase.decision_reason,
    });

    if (messageId) {
      await supabase
        ?.from("refund_case_messages")
        .update({ status: "sent", sent_at: new Date().toISOString() })
        .eq("id", messageId);
    }

    await syncAutomationState(refundCase.id, messageType);

    await supabase?.from("refund_case_events").insert({
      refund_case_id: refundCase.id,
      event_type: "customer_message_sent",
      message: `Automated ${messageType.replaceAll("_", " ")} email sent.`,
      metadata: {
        message_type: messageType,
        message_id: messageId,
        payload_redacted: true,
      },
    });

    return { type: messageType, status: "sent" };
  } catch (emailError) {
    console.error("refund-case-admin-update customer email failed", {
      errorType: emailError instanceof Error ? emailError.name : typeof emailError,
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

    return { type: messageType, status: "failed" };
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
      return jsonResponse({ error: "Refund update automation is not configured." }, 500);
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
    if (!isUuid(caseId)) {
      return jsonResponse({ error: "Refund case is required." }, 400);
    }

    const beforeRow = await getRefundCase(caseId);
    if (!beforeRow) {
      return jsonResponse({ error: "Refund case not found." }, 404);
    }

    const { data: canManageCase, error: accessError } = await supabase.rpc(
      "can_manage_refund_case",
      { p_user_id: user.id, p_refund_case_id: caseId },
    );

    if (accessError) throw accessError;
    if (!canManageCase) {
      return jsonResponse({ error: "Refund case access required." }, 403);
    }

    const { data: updatedCase, error: updateError } = await supabase.rpc(
      "service_update_refund_case_as_actor",
      {
        p_actor_user_id: user.id,
        p_case_id: caseId,
        p_status: sanitizeText(body?.status, 80) || null,
        p_assigned_manager_email: sanitizeText(body?.assignedManagerEmail, 320) || null,
        p_decision: sanitizeText(body?.decision, 80) || null,
        p_decision_reason: sanitizeText(body?.decisionReason, 900) || null,
        p_internal_note: sanitizeText(body?.internalNote, 1200) || null,
        p_refund_amount_cents: centsFromInput(body?.refundAmountCents),
        p_manual_refund_reference: sanitizeText(body?.manualRefundReference, 160) || null,
        p_clear_nayax_match: Boolean(body?.clearNayaxMatch),
        p_matched_nayax_transaction_id: sanitizeText(body?.matchedNayaxTransactionId, 120) || null,
        p_matched_nayax_site_id: centsFromInput(body?.matchedNayaxSiteId),
        p_matched_nayax_machine_auth_time: sanitizeText(body?.matchedNayaxMachineAuthTime, 120) || null,
        p_matched_nayax_amount_cents: centsFromInput(body?.matchedNayaxAmountCents),
        p_matched_nayax_card_last4: sanitizeText(body?.matchedNayaxCardLast4, 4) || null,
        p_matched_nayax_currency_code: sanitizeText(body?.matchedNayaxCurrencyCode, 3).toUpperCase() || null,
      },
    );

    if (updateError) {
      const safeMessage =
        typeof updateError.message === "string" && updateError.message.trim()
          ? updateError.message.slice(0, 240)
          : "Unable to update refund case.";
      return jsonResponse({ error: safeMessage }, 400);
    }

    const afterRow = await getRefundCase(caseId);
    if (!afterRow) {
      return jsonResponse({ error: "Refund case was updated but could not be reloaded." }, 500);
    }

    const messageType = resolveMessageType(beforeRow, afterRow);
    const customerMessage = messageType
      ? await sendAndLogCustomerMessage(afterRow, messageType)
      : null;

    return jsonResponse({
      refundCase: {
        id: afterRow.id,
        publicReference: afterRow.public_reference,
        status: afterRow.status,
        decision: afterRow.decision,
      },
      customerMessage,
      updateApplied: Boolean(updatedCase),
    });
  } catch (error) {
    console.error("refund-case-admin-update error", {
      errorType: error instanceof Error ? error.name : typeof error,
    });
    return jsonResponse({ error: "Unable to update refund case." }, 500);
  }
});
