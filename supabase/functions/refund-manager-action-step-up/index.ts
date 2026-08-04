import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.1";
import { resolveSupabaseAccessToken } from "../_shared/auth.ts";
import { corsHeaders } from "../_shared/cors.ts";
import {
  RefundManagerTotpError,
  verifyRefundManagerTotp,
} from "../_shared/refund-manager-totp.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

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

    if (!isUuid(intentId) || !allowedTargets.has(targetFunction) || !frozenPayload) {
      return jsonResponse({
        error: "Review the official action again before verifying it.",
        errorCode: "verification_failed",
      }, 400);
    }

    const originalUserClient = userClientFor(originalAccessToken);
    if (!originalUserClient) {
      return jsonResponse({ error: "Manager verification is unavailable." }, 500);
    }
    const { data: intent, error: intentError } = await originalUserClient.rpc(
      "admin_get_refund_action_step_up_intent",
      { p_intent_id: intentId },
    );
    if (
      intentError ||
      !intent ||
      typeof intent !== "object" ||
      (intent as { targetFunction?: unknown }).targetFunction !== targetFunction
    ) {
      return jsonResponse({
        error: "This verification request expired or changed. Review the action again.",
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
      return jsonResponse({ error: "Manager verification is unavailable." }, 500);
    }
    const { data: factorApproved, error: factorApprovalError } = await verifiedUserClient.rpc(
      "admin_refund_manager_step_up_factor_is_approved",
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

    const { data: proofMarker, error: proofMarkerError } = await serviceClient.rpc(
      "service_mark_refund_manager_step_up_factor_verified",
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
