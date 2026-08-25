import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.1";
import { resolveSupabaseAccessToken } from "../_shared/auth.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { sendRefundTransactionalEmail } from "../_shared/refund-email.ts";
import { dispatchRefundCaseGmailReply } from "../_shared/refund-gmail-transport.ts";
import {
  getRefundGmailMailboxIdentities,
  RefundGmailError,
} from "../_shared/refund-gmail.ts";
import { deliverPreparedNayaxCompletionOnce } from "../_shared/nayax-resolution-completion.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const nayaxExecutorAssertion = Deno.env.get("NAYAX_REFUND_EXECUTOR_ASSERTION")
  ?.trim() ?? "";

const serviceClient = supabaseUrl && supabaseServiceRoleKey
  ? createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  : null;

const jsonResponse = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });

const escapeHtml = (value: string) => value
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");

const isUuid = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(value);

const isSafeText = (value: unknown, maxLength: number): value is string =>
  typeof value === "string" && value.trim().length > 0 &&
    value.trim().length <= maxLength;

const EMAIL_PATTERN = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

class TransactionalCompletionDeliveryUncertainError extends Error {}

const allowedResults = new Set([
  "provider_confirmed_success",
  "provider_confirmed_retry_safe",
  "documented_manual_completion",
  "remain_on_hold",
]);

const allowedEvidenceTypes = new Set([
  "nayax_dtm_transaction",
  "nayax_support_ticket",
  "documented_manual_refund",
]);

const allowedReasons = new Set([
  "nayax_dtm_settled",
  "nayax_support_confirmed_success",
  "nayax_dtm_not_refunded",
  "nayax_support_retry_safe",
  "manual_nayax_completion",
  "evidence_incomplete",
  "provider_still_pending",
  "evidence_conflict",
]);

const userClientFor = (accessToken: string) => {
  if (!supabaseUrl || !supabaseAnonKey) return null;
  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") {
      return jsonResponse({ error: "Method not allowed." }, 405);
    }
    if (!serviceClient || !supabaseUrl || !supabaseAnonKey) {
      return jsonResponse({
        error: "Payment result confirmation is not configured.",
        errorCode: "configuration_missing",
      }, 500);
    }

    const accessToken = resolveSupabaseAccessToken(req);
    if (!accessToken) return jsonResponse({ error: "Unauthorized." }, 401);

    const { data: authData, error: authError } = await serviceClient.auth
      .getUser(accessToken);
    if (authError || !authData.user || authData.user.is_anonymous) {
      return jsonResponse({ error: "Unauthorized." }, 401);
    }

    const body = await req.json();
    const caseId = body?.caseId;
    const attemptId = body?.attemptId;
    const resolutionResult = typeof body?.resolutionResult === "string"
      ? body.resolutionResult.trim()
      : "";
    const evidenceType = typeof body?.evidenceType === "string"
      ? body.evidenceType.trim()
      : "";
    const evidenceReference = typeof body?.evidenceReference === "string"
      ? body.evidenceReference.trim()
      : "";
    const evidenceOccurredAt = typeof body?.evidenceOccurredAt === "string" &&
        body.evidenceOccurredAt.trim()
      ? body.evidenceOccurredAt.trim()
      : null;
    const reasonCode = typeof body?.reasonCode === "string"
      ? body.reasonCode.trim()
      : "";
    const expectedCaseVersion = Number(body?.expectedCaseVersion);

    if (
      !isUuid(caseId) || !isUuid(attemptId) ||
      !allowedResults.has(resolutionResult) ||
      !allowedEvidenceTypes.has(evidenceType) ||
      !allowedReasons.has(reasonCode) ||
      !isSafeText(evidenceReference, 120) ||
      !Number.isSafeInteger(expectedCaseVersion) || expectedCaseVersion <= 0 ||
      (evidenceOccurredAt !== null &&
        Number.isNaN(new Date(evidenceOccurredAt).getTime()))
    ) {
      return jsonResponse({
        error: "Review the exact payment result again.",
        errorCode: "invalid_request",
      }, 400);
    }

    const completedResult = [
      "provider_confirmed_success",
      "documented_manual_completion",
    ].includes(resolutionResult);
    if (
      completedResult &&
      !/^[A-Za-z0-9_-]{32,200}$/.test(nayaxExecutorAssertion)
    ) {
      return jsonResponse({
        error: "Customer completion delivery is not configured. No change was made.",
        errorCode: "configuration_missing",
      }, 503);
    }

    const userClient = userClientFor(accessToken);
    if (!userClient) {
      return jsonResponse({ error: "Payment result confirmation is unavailable." }, 500);
    }

    const { data: resolution, error: resolutionError } = await userClient.rpc(
      "admin_resolve_refund_nayax_outcome_manager_session",
      {
        p_case_id: caseId,
        p_attempt_id: attemptId,
        p_resolution_result: resolutionResult,
        p_evidence_type: evidenceType,
        p_evidence_reference: evidenceReference,
        p_evidence_occurred_at: evidenceOccurredAt,
        p_reason_code: reasonCode,
        p_expected_case_version: expectedCaseVersion,
      },
    );

    if (resolutionError || !resolution || typeof resolution !== "object") {
      return jsonResponse({
        error: "The payment result could not be saved. The hold remains in place.",
        errorCode: "resolution_failed",
      }, 409);
    }

    const resolutionBody = resolution as Record<string, unknown>;
    if (!completedResult) return jsonResponse(resolutionBody);

    const completionMessageId = typeof resolutionBody.customerCompletionMessageId === "string"
      ? resolutionBody.customerCompletionMessageId
      : "";
    let customerCompletion: Record<string, unknown> = {
      status: "pending",
      transport: "gmail_thread",
      managerCcCount: 0,
      originalThread: true,
      operationApplied: false,
      managerCompletionNoticeSent: false,
    };

    let completionTransport: "gmail_thread" | "transactional_email" =
      "gmail_thread";
    let formManagerCcCount = 0;
    let formManagerRecipientOverlap = false;
    const finishCompletion = async (
      status: "sent" | "failed" | "delivery_unknown",
    ) => {
      const { data: finished, error: finishError } = await serviceClient.rpc(
        completionTransport === "gmail_thread"
          ? "service_finish_nayax_refund_completion"
          : "service_finish_nayax_refund_form_completion",
        {
          p_executor_assertion: nayaxExecutorAssertion,
          p_attempt_id: attemptId,
          p_delivery_status: status,
          ...(completionTransport === "transactional_email"
            ? {
              p_manager_cc_count: formManagerCcCount,
              p_manager_recipient_overlap: formManagerRecipientOverlap,
            }
            : {}),
        },
      );
      if (finishError || !finished || typeof finished !== "object") {
        throw new Error("completion_settlement_failed");
      }
      return finished as Record<string, unknown> & {
        status: "sent" | "failed" | "delivery_unknown" | "already_sent";
      };
    };

    customerCompletion = await deliverPreparedNayaxCompletionOnce({
      load: async () => {
        if (!isUuid(completionMessageId)) {
          throw new Error("completion_message_invalid");
        }
        const { data: loaded, error: loadError } = await serviceClient.rpc(
          "service_load_nayax_refund_completion",
          { p_attempt_id: attemptId },
        );
        const loadedBody = loaded && typeof loaded === "object"
          ? loaded as Record<string, unknown>
          : null;
        const loadedMessage = loadedBody?.message &&
            typeof loadedBody.message === "object"
          ? loadedBody.message as Record<string, unknown>
          : null;
        const gmailThreadId = loadedBody?.gmailThreadId;
        const message = loadedMessage
          ? {
            id: loadedMessage.id,
            refund_case_id: loadedMessage.refundCaseId,
            recipient_email: loadedMessage.recipientEmail,
            subject: loadedMessage.subject,
            body: loadedMessage.body,
          }
          : null;
        const attempt = { completion_gmail_thread_id: gmailThreadId };
        if (
          loadError || !message || loadedBody?.payloadRedacted !== true ||
          !["gmail_thread", "transactional_email"].includes(
            typeof loadedBody?.transport === "string"
              ? loadedBody.transport
              : "",
          ) ||
          message.id !== completionMessageId ||
          !isUuid(message.refund_case_id) ||
          (attempt.completion_gmail_thread_id !== null &&
            attempt.completion_gmail_thread_id !== undefined &&
            !isUuid(attempt.completion_gmail_thread_id)) ||
          typeof message.recipient_email !== "string" ||
          typeof message.subject !== "string" ||
          typeof message.body !== "string"
        ) {
          throw new Error("completion_lookup_failed");
        }
        completionTransport = isUuid(attempt.completion_gmail_thread_id)
          ? "gmail_thread"
          : "transactional_email";
        return { message, attempt };
      },
      deliverLoaded: async ({ message, attempt }) => {
        const messageBody = message.body as string;
        const email = {
          subject: message.subject,
          text: messageBody,
          html: messageBody.split("\n").map((line: string) =>
            line ? `<p>${escapeHtml(line)}</p>` : "<br>"
          ).join(""),
        };
        if (attempt.completion_gmail_thread_id) {
          const gmailDelivery = await dispatchRefundCaseGmailReply({
            supabase: serviceClient,
            refundCaseId: message.refund_case_id,
            refundCaseMessageId: message.id,
            recipientEmail: message.recipient_email,
            email,
            deliveryKind: "manual",
            gmailThreadId: attempt.completion_gmail_thread_id,
          });
          return gmailDelivery.usedGmail;
        }

        const { data: route, error: routeError } = await serviceClient.rpc(
          "service_authorize_nayax_refund_form_completion",
          {
            p_executor_assertion: nayaxExecutorAssertion,
            p_attempt_id: attemptId,
            p_mailbox_identities: getRefundGmailMailboxIdentities(),
          },
        );
        const routeBody = route && typeof route === "object"
          ? route as Record<string, unknown>
          : null;
        const managerCcEmails = Array.isArray(routeBody?.managerCcEmails)
          ? routeBody.managerCcEmails.filter((value): value is string =>
            typeof value === "string"
          ).map((value) => value.trim().toLowerCase())
          : [];
        const normalizedRecipient = message.recipient_email.trim().toLowerCase();
        formManagerRecipientOverlap =
          routeBody?.managerRecipientOverlap === true;
        formManagerCcCount = Number(routeBody?.managerCcCount);
        if (
          routeError || routeBody?.status !== "resolved" ||
          routeBody?.recipientEmail !== normalizedRecipient ||
          !EMAIL_PATTERN.test(normalizedRecipient) ||
          !Number.isSafeInteger(formManagerCcCount) ||
          formManagerCcCount !== managerCcEmails.length ||
          formManagerCcCount < 0 || formManagerCcCount > 4 ||
          new Set(managerCcEmails).size !== managerCcEmails.length ||
          managerCcEmails.some((value) =>
            !EMAIL_PATTERN.test(value) || value === normalizedRecipient
          ) ||
          (formManagerCcCount === 0 && !formManagerRecipientOverlap)
        ) {
          throw new Error("form_completion_route_invalid");
        }

        try {
          await sendRefundTransactionalEmail({
            to: [message.recipient_email],
            cc: managerCcEmails,
            subject: email.subject,
            text: email.text,
            html: email.html,
          });
        } catch (error) {
          if (
            error instanceof Error &&
            error.message.startsWith("Resend request failed (")
          ) {
            throw error;
          }
          throw new TransactionalCompletionDeliveryUncertainError();
        }
        return true;
      },
      finish: finishCompletion,
      isDeliveryUncertain: (error) =>
        error instanceof TransactionalCompletionDeliveryUncertainError ||
        (error instanceof RefundGmailError && error.deliveryUncertain),
    });

    const safeResolution = { ...resolutionBody };
    delete safeResolution.customerCompletionMessageId;
    return jsonResponse({ ...safeResolution, customerCompletion });
  } catch (error) {
    console.error("refund-nayax-outcome-resolve error", {
      errorType: error instanceof Error ? error.name : typeof error,
    });
    return jsonResponse({
      error: "Unable to confirm the payment result. The hold remains in place.",
      errorCode: "resolution_failed",
    }, 500);
  }
});
