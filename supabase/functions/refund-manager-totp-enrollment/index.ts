import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.1";
import { resolveSupabaseAccessToken } from "../_shared/auth.ts";
import { corsHeaders } from "../_shared/cors.ts";
import {
  beginRefundManagerTotpEnrollment,
  bestEffortCompensateRefundManagerTotpEnrollment,
  cancelRefundManagerTotpEnrollment,
  RefundManagerTotpError,
  verifyRefundManagerTotpEnrollment,
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

type VerifiedEnrollment = Awaited<ReturnType<typeof verifyRefundManagerTotpEnrollment>>;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") {
      return jsonResponse({ error: "Method not allowed." }, 405);
    }
    if (!serviceClient || !supabaseUrl || !supabaseAnonKey) {
      return jsonResponse({ error: "Authenticator enrollment is unavailable." }, 500);
    }

    const accessToken = resolveSupabaseAccessToken(req);
    if (!accessToken) return jsonResponse({ error: "Unauthorized." }, 401);
    const { data: authData, error: authError } = await serviceClient.auth
      .getUser(accessToken);
    if (authError || !authData.user) {
      return jsonResponse({ error: "Unauthorized." }, 401);
    }

    const userClient = userClientFor(accessToken);
    if (!userClient) return jsonResponse({ error: "Enrollment is unavailable." }, 500);

    const body = await req.json();
    const operation = typeof body?.operation === "string"
      ? body.operation.trim().toLowerCase()
      : "";
    if (operation === "cancel") {
      const result = await cancelRefundManagerTotpEnrollment({
        supabaseUrl,
        supabaseAnonKey,
        accessToken,
      });
      return jsonResponse(result);
    }

    const { data: allowed, error: allowedError } = await userClient.rpc(
      "can_enroll_refund_manager_totp_current_user",
    );
    if (allowedError || allowed !== true) {
      return jsonResponse({
        error:
          "The owner-controlled enrollment window is closed. Schedule a supervised, human-only enrollment session.",
        errorCode: "enrollment_closed",
      }, 403);
    }
    if (operation === "start") {
      const enrollment = await beginRefundManagerTotpEnrollment({
        supabaseUrl,
        supabaseAnonKey,
        accessToken,
      });
      return jsonResponse({
        qrCode: enrollment.qrCode,
        instructions:
          "Scan this once in your authenticator. Never screenshot, copy, email, or share this QR code.",
      });
    }
    if (operation === "verify") {
      const code = typeof body?.code === "string" ? body.code.trim() : "";
      let verification: VerifiedEnrollment | null = null;
      try {
        verification = await verifyRefundManagerTotpEnrollment({
          supabaseUrl,
          supabaseAnonKey,
          accessToken,
          code,
        });
        const { data: recorded, error: recordingError } = await serviceClient.rpc(
          "service_record_refund_manager_totp_enrollment",
          {
            p_actor_user_id: authData.user.id,
            p_factor_binding_hash: verification.factorBindingHash,
          },
        );
        if (
          recordingError ||
          !recorded ||
          typeof recorded !== "object" ||
          (recorded as { recorded?: unknown }).recorded !== true
        ) {
          throw new Error("Durable refund authenticator enrollment was not recorded");
        }
      } catch (error) {
        if (!verification && error instanceof RefundManagerTotpError) throw error;
        if (verification) {
          await bestEffortCompensateRefundManagerTotpEnrollment({
            supabaseUrl,
            supabaseAnonKey,
            verifiedAccessToken: verification.accessToken,
            factorId: verification.factorId,
            factorBindingHash: verification.factorBindingHash,
            compensateDurableState: async (factorBindingHash) => {
              const { error: compensationError } = await serviceClient.rpc(
                "service_compensate_refund_manager_totp_enrollment",
                {
                  p_actor_user_id: authData.user.id,
                  p_factor_binding_hash: factorBindingHash,
                },
              );
              if (compensationError) throw compensationError;
            },
          });
        }
        return jsonResponse({
          error:
            "Enrollment could not be safely completed. The new authenticator was removed when possible; ask the owner to reopen enrollment.",
          errorCode: "verification_failed",
        }, 409);
      }
      return jsonResponse({ enrolled: true });
    }
    return jsonResponse({ error: "Choose a valid enrollment step." }, 400);
  } catch (error) {
    if (error instanceof RefundManagerTotpError) {
      return jsonResponse(
        { error: error.message, errorCode: error.code },
        error.status,
      );
    }
    console.error("refund-manager-totp-enrollment error", {
      errorType: error instanceof Error ? error.name : typeof error,
    });
    return jsonResponse({
      error: "Unable to complete supervised authenticator enrollment.",
    }, 500);
  }
});
