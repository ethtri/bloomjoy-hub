import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.1";
import { resolveSupabaseAccessToken } from "../_shared/auth.ts";
import { corsHeaders } from "../_shared/cors.ts";
import {
  RefundManagerTotpError,
  verifyRefundManagerTotp,
} from "../_shared/refund-manager-totp.ts";
import { dispatchRefundCaseGmailReply } from "../_shared/refund-gmail-transport.ts";
import { RefundGmailError } from "../_shared/refund-gmail.ts";
import { deliverNayaxCompletionOnce } from "../_shared/nayax-resolution-completion.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const nayaxExecutorAssertion = Deno.env.get("NAYAX_REFUND_EXECUTOR_ASSERTION")
  ?.trim() ?? "";

const escapeHtml = (value: string) => value
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");

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

const isUuid = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(value);

const allowedTargets = new Set([
  "refund-case-admin-update",
  "nayax-card-refund",
  "refund-nayax-outcome-resolve",
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
        error: "Manager authenticator verification is not configured.",
        errorCode: "configuration_missing",
      }, 500);
    }

    const originalAccessToken = resolveSupabaseAccessToken(req);
    if (!originalAccessToken) {
      return jsonResponse({ error: "Unauthorized." }, 401);
    }
    const { data: authData, error: authError } = await serviceClient.auth
      .getUser(originalAccessToken);
    if (authError || !authData.user) {
      return jsonResponse({ error: "Unauthorized." }, 401);
    }

    const body = await req.json();
    const intentId = typeof body?.intentId === "string"
      ? body.intentId.trim()
      : "";
    const targetFunction = typeof body?.targetFunction === "string"
      ? body.targetFunction.trim()
      : "";
    const code = typeof body?.code === "string" ? body.code.trim() : "";
    const frozenPayload = body?.frozenPayload &&
        typeof body.frozenPayload === "object" &&
        !Array.isArray(body.frozenPayload)
      ? body.frozenPayload as Record<string, unknown>
      : null;

    if (
      !isUuid(intentId) || !allowedTargets.has(targetFunction) || !frozenPayload
    ) {
      return jsonResponse({
        error: "Review the official action again before verifying it.",
        errorCode: "verification_failed",
      }, 400);
    }

    const originalUserClient = userClientFor(originalAccessToken);
    if (!originalUserClient) {
      return jsonResponse(
        { error: "Manager verification is unavailable." },
        500,
      );
    }
    const resolutionTarget = targetFunction === "refund-nayax-outcome-resolve";
    const completedResolution = resolutionTarget && [
      "provider_confirmed_success",
      "documented_manual_completion",
    ].includes(String(frozenPayload.resolutionResult ?? ""));
    if (
      completedResolution &&
      (!/^[A-Za-z0-9_-]{32,200}$/.test(nayaxExecutorAssertion))
    ) {
      return jsonResponse({
        error:
          "Customer completion delivery is not configured. The provider hold remains in place.",
        errorCode: "configuration_missing",
      }, 503);
    }
    const { data: intent, error: intentError } = await originalUserClient.rpc(
      resolutionTarget
        ? "admin_get_refund_nayax_resolution_intent"
        : "admin_get_refund_action_step_up_intent",
      { p_intent_id: intentId },
    );
    if (
      intentError ||
      !intent ||
      typeof intent !== "object" ||
      (intent as { targetFunction?: unknown }).targetFunction !== targetFunction
    ) {
      return jsonResponse({
        error:
          "This verification request expired or changed. Review the action again.",
        errorCode: "verification_failed",
      }, 409);
    }

    const verification = await verifyRefundManagerTotp({
      supabaseUrl,
      supabaseAnonKey,
      accessToken: originalAccessToken,
      code,
    });

    const verifiedUserClient = userClientFor(verification.accessToken);
    if (!verifiedUserClient) {
      return jsonResponse(
        { error: "Manager verification is unavailable." },
        500,
      );
    }
    const { data: factorApproved, error: factorApprovalError } =
      await verifiedUserClient.rpc(
        resolutionTarget
          ? "admin_refund_nayax_resolution_factor_is_approved"
          : "admin_refund_manager_step_up_factor_is_approved",
        {
          p_intent_id: intentId,
          p_factor_binding_hash: verification.factorBindingHash,
        },
      );
    if (factorApprovalError || factorApproved !== true) {
      throw new RefundManagerTotpError(
        "This authenticator is not the refund-specific factor approved by the owner.",
        409,
        "factor_required",
      );
    }

    const { data: proofMarker, error: proofMarkerError } = await serviceClient
      .rpc(
        resolutionTarget
          ? "service_mark_refund_nayax_resolution_factor_verified"
          : "service_mark_refund_manager_step_up_factor_verified",
        {
          p_actor_user_id: authData.user.id,
          p_intent_id: intentId,
          p_factor_binding_hash: verification.factorBindingHash,
        },
      );
    const stepUpFactorProof = proofMarker && typeof proofMarker === "object" &&
        typeof (proofMarker as { factorVerificationProof?: unknown })
            .factorVerificationProof === "string"
      ? (proofMarker as { factorVerificationProof: string })
        .factorVerificationProof
      : "";
    if (proofMarkerError || !/^[a-f0-9]{64}$/.test(stepUpFactorProof)) {
      throw new RefundManagerTotpError(
        "The verified action could not be bound to this authenticator challenge. Review it and try again.",
        409,
        "verification_failed",
      );
    }

    if (resolutionTarget) {
      const { data: resolution, error: resolutionError } =
        await verifiedUserClient.rpc(
          "admin_consume_refund_nayax_resolution_intent",
          {
            p_intent_id: intentId,
            p_case_id: frozenPayload.caseId,
            p_attempt_id: frozenPayload.attemptId,
            p_resolution_result: frozenPayload.resolutionResult,
            p_evidence_type: frozenPayload.evidenceType,
            p_evidence_reference: frozenPayload.evidenceReference,
            p_evidence_occurred_at: frozenPayload.evidenceOccurredAt,
            p_reason_code: frozenPayload.reasonCode,
            p_factor_verification_proof: stepUpFactorProof,
          },
        );
      if (resolutionError || !resolution || typeof resolution !== "object") {
        return jsonResponse({
          error:
            "The payment-support resolution could not be committed. The provider hold remains in place.",
          errorCode: "resolution_failed",
        }, 409);
      }
      const resolutionBody = resolution as Record<string, unknown>;
      if (!completedResolution) {
        return jsonResponse(resolutionBody);
      }

      const completionMessageId = typeof resolutionBody.customerCompletionMessageId === "string"
        ? resolutionBody.customerCompletionMessageId
        : "";
      const attemptId = typeof frozenPayload.attemptId === "string"
        ? frozenPayload.attemptId
        : "";
      let customerCompletion: Record<string, unknown> = {
        status: "delivery_unknown",
        transport: "gmail_thread",
        managerCcCount: 0,
        originalThread: true,
        operationApplied: false,
        managerCompletionNoticeSent: false,
      };
      if (isUuid(completionMessageId) && isUuid(attemptId)) {
        const [{ data: message }, { data: attempt }] = await Promise.all([
          serviceClient.from("refund_case_messages")
            .select("id,refund_case_id,recipient_email,subject,body")
            .eq("id", completionMessageId)
            .eq("nayax_refund_attempt_id", attemptId)
            .single(),
          serviceClient.from("refund_case_nayax_refund_attempts")
            .select("completion_gmail_thread_id")
            .eq("id", attemptId)
            .single(),
        ]);
        if (
          message && attempt && isUuid(message.refund_case_id) &&
          isUuid(attempt.completion_gmail_thread_id) &&
          typeof message.recipient_email === "string" &&
          typeof message.subject === "string" &&
          typeof message.body === "string"
        ) {
          const messageBody = message.body as string;
          customerCompletion = await deliverNayaxCompletionOnce({
            deliver: async () => {
              const gmailDelivery = await dispatchRefundCaseGmailReply({
                supabase: serviceClient,
                refundCaseId: message.refund_case_id,
                refundCaseMessageId: message.id,
                recipientEmail: message.recipient_email,
                email: {
                  subject: message.subject,
                  text: messageBody,
                  html: messageBody.split("\n").map((line: string) =>
                    line ? `<p>${escapeHtml(line)}</p>` : "<br>"
                  ).join(""),
                },
                deliveryKind: "manual",
                gmailThreadId: attempt.completion_gmail_thread_id,
              });
              return gmailDelivery.usedGmail;
            },
            finish: async (status) => {
              const { data: finished, error: finishError } = await serviceClient.rpc(
                "service_finish_nayax_refund_completion",
                {
                  p_executor_assertion: nayaxExecutorAssertion,
                  p_attempt_id: attemptId,
                  p_delivery_status: status,
                },
              );
              if (finishError || !finished || typeof finished !== "object") {
                throw new Error("completion_settlement_failed");
              }
              return finished as Record<string, unknown> & {
                status: "sent" | "failed" | "delivery_unknown" | "already_sent";
              };
            },
            isDeliveryUncertain: (error) =>
              error instanceof RefundGmailError && error.deliveryUncertain,
          });
        }
      }

      const safeResolution = { ...resolutionBody };
      delete safeResolution.customerCompletionMessageId;
      return jsonResponse({ ...safeResolution, customerCompletion });
    }

    const targetResponse = await fetch(
      `${supabaseUrl}/functions/v1/${targetFunction}`,
      {
        method: "POST",
        headers: {
          apikey: supabaseAnonKey,
          Authorization: `Bearer ${supabaseAnonKey}`,
          "x-supabase-auth-token": verification.accessToken,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...frozenPayload,
          stepUpIntentId: intentId,
          stepUpFactorProof,
        }),
      },
    );

    let targetBody: Record<string, unknown> = {};
    try {
      const parsed = await targetResponse.json();
      if (parsed && typeof parsed === "object") {
        targetBody = parsed as Record<string, unknown>;
      }
    } catch {
      targetBody = {};
    }

    if (Object.keys(targetBody).length === 0) {
      return jsonResponse({
        error: "The verified action did not return a valid result.",
        errorCode: "verification_failed",
      }, 502);
    }
    return jsonResponse(targetBody, targetResponse.status);
  } catch (error) {
    if (error instanceof RefundManagerTotpError) {
      return jsonResponse(
        { error: error.message, errorCode: error.code },
        error.status,
      );
    }
    console.error("refund-manager-action-step-up error", {
      errorType: error instanceof Error ? error.name : typeof error,
    });
    return jsonResponse({
      error: "Unable to verify this official action. No action was taken.",
      errorCode: "verification_failed",
    }, 500);
  }
});
