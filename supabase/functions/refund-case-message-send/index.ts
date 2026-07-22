import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.1";
import { resolveSupabaseAccessToken } from "../_shared/auth.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { sendTransactionalEmail } from "../_shared/internal-email.ts";
import { dispatchRefundCaseGmailReply } from "../_shared/refund-gmail-transport.ts";
import { RefundGmailError } from "../_shared/refund-gmail.ts";
import {
  buildEditableRefundCustomerEmail,
  buildRefundCustomerEmail,
  getRefundReplyToEmail,
  sanitizeRefundMessageType,
  type RefundCustomerMessageType,
} from "../_shared/refund-email.ts";
import { resolveRefundPublicLabels } from "../_shared/refund-location.ts";

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
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i.test(value);

type OneOrMany<T> = T | T[] | null | undefined;

type RefundCaseRow = {
  id: string;
  public_reference: string;
  customer_email: string;
  customer_name: string | null;
  payment_method: string | null;
  payment_amount_cents: number | null;
  refund_amount_cents: number | null;
  decision_reason: string | null;
  reporting_machines?: OneOrMany<{
    machine_label: string | null;
    refund_public_display_label: string | null;
  }>;
  reporting_locations?: OneOrMany<{ name: string | null }>;
};

const firstRelation = <T>(value: OneOrMany<T>) =>
  Array.isArray(value) ? value[0] ?? null : value ?? null;

const allowedPortalMessageTypes = new Set<RefundCustomerMessageType>([
  "more_info",
  "status_update",
  "approved",
  "denied",
  "completed",
]);

const selectCaseQuery = `
  id,
  public_reference,
  customer_email,
  customer_name,
  payment_method,
  payment_amount_cents,
  refund_amount_cents,
  decision_reason,
  reporting_machines(machine_label, refund_public_display_label),
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

const syncAutomationFields = async (
  refundCaseId: string,
  messageType: RefundCustomerMessageType,
) => {
  if (!supabase) return;

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

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") {
      return jsonResponse({ error: "Method not allowed." }, 405);
    }

    if (!supabase) {
      return jsonResponse({ error: "Refund messaging is not configured." }, 500);
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

    const messageType = sanitizeRefundMessageType(body?.messageType);
    if (!messageType || !allowedPortalMessageTypes.has(messageType)) {
      return jsonResponse({ error: "Choose an approved customer message template." }, 400);
    }

    const { data: canManageCase, error: accessError } = await supabase.rpc(
      "can_manage_refund_case",
      { p_user_id: user.id, p_refund_case_id: caseId },
    );

    if (accessError) throw accessError;
    if (!canManageCase) {
      return jsonResponse({ error: "Refund case access required." }, 403);
    }

    const refundCase = await getRefundCase(caseId);
    if (!refundCase) {
      return jsonResponse({ error: "Refund case not found." }, 404);
    }

    if (!refundCase.customer_email) {
      return jsonResponse({ error: "Customer email is missing for this refund case." }, 400);
    }

    const machine = firstRelation(refundCase.reporting_machines);
    const location = firstRelation(refundCase.reporting_locations);
    const publicLabels = resolveRefundPublicLabels({
      locationName: location?.name,
      publicMachineLabel: machine?.refund_public_display_label,
      machineLabel: machine?.machine_label,
    });
    const templateInput = {
      messageType,
      publicReference: refundCase.public_reference,
      customerName: refundCase.customer_name,
      customerEmail: refundCase.customer_email,
      machineLabel: publicLabels.machineLabel,
      locationName: publicLabels.locationName,
      refundAmountCents: refundCase.refund_amount_cents ?? refundCase.payment_amount_cents,
      paymentMethod: refundCase.payment_method,
      decisionReason: refundCase.decision_reason,
    };
    const defaultEmail = buildRefundCustomerEmail(templateInput);
    const requestedSubject = sanitizeText(body?.subject, 180);
    const requestedBody = sanitizeText(body?.body, 4000);
    const email = requestedBody || requestedSubject
      ? buildEditableRefundCustomerEmail({
          input: templateInput,
          subject: requestedSubject || defaultEmail.subject,
          body: requestedBody || defaultEmail.text,
        })
      : defaultEmail;

    const { data: messageRow, error: messageError } = await supabase
      .from("refund_case_messages")
      .insert({
        refund_case_id: refundCase.id,
        message_type: messageType,
        status: "pending",
        recipient_email: refundCase.customer_email,
        subject: email.subject,
        body: email.text,
        template_key: `refund_${messageType}_editable_v1`,
        created_by: user.id,
      })
      .select("id")
      .single();

    if (messageError) throw messageError;

    try {
      const gmailDelivery = await dispatchRefundCaseGmailReply({
        supabase,
        refundCaseId: refundCase.id,
        refundCaseMessageId: messageRow.id,
        recipientEmail: refundCase.customer_email,
        email,
      });
      if (!gmailDelivery.usedGmail) {
        await sendTransactionalEmail({
          to: [refundCase.customer_email],
          subject: email.subject,
          text: email.text,
          html: email.html,
          replyTo: getRefundReplyToEmail(),
        });
      }

      await supabase
        .from("refund_case_messages")
        .update({
          status: "sent",
          sent_at: new Date().toISOString(),
          subject: gmailDelivery.usedGmail ? gmailDelivery.subject : email.subject,
        })
        .eq("id", messageRow.id);

      await syncAutomationFields(refundCase.id, messageType);

      await supabase.from("refund_case_events").insert({
        refund_case_id: refundCase.id,
        actor_user_id: user.id,
        event_type: "customer_message_sent",
        message: gmailDelivery.usedGmail
          ? `Manager sent ${messageType.replaceAll("_", " ")} reply in the linked Gmail thread.`
          : `Manager sent ${messageType.replaceAll("_", " ")} email from the portal.`,
        metadata: {
          message_type: messageType,
          message_id: messageRow.id,
          transport: gmailDelivery.usedGmail ? "gmail_thread" : "transactional_email",
          payload_redacted: true,
        },
      });

      return jsonResponse({
        message: {
          id: messageRow.id,
          type: messageType,
          status: "sent",
          subject: email.subject,
          transport: gmailDelivery.usedGmail ? "gmail_thread" : "transactional_email",
        },
      });
    } catch (emailError) {
      const safeErrorCode = emailError instanceof RefundGmailError
        ? emailError.code
        : "customer_email_delivery_failed";
      console.error("refund-case-message-send customer email failed", {
        errorType: emailError instanceof Error ? emailError.name : typeof emailError,
        messageType,
        errorCode: safeErrorCode,
      });

      await supabase
        .from("refund_case_messages")
        .update({
          status: "failed",
          error_message: safeErrorCode,
        })
        .eq("id", messageRow.id);

      await supabase.from("refund_case_events").insert({
        refund_case_id: refundCase.id,
        actor_user_id: user.id,
        event_type: "customer_message_failed",
        message: "Portal customer email could not be sent.",
        metadata: {
          message_type: messageType,
          message_id: messageRow.id,
          payload_redacted: true,
        },
      });

      return jsonResponse({
        error: safeErrorCode === "gmail_network_unknown" || safeErrorCode === "gmail_delivery_record_failed"
          ? "Gmail delivery could not be confirmed. Check the original thread before retrying."
          : "Unable to send customer email.",
        errorCode: safeErrorCode,
      }, 502);
    }
  } catch (error) {
    console.error("refund-case-message-send error", {
      errorType: error instanceof Error ? error.name : typeof error,
    });
    return jsonResponse({ error: "Unable to send customer email." }, 500);
  }
});
