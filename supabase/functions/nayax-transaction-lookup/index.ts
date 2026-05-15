import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.1";
import { resolveSupabaseAccessToken } from "../_shared/auth.ts";
import { corsHeaders } from "../_shared/cors.ts";
import {
  lookupNayaxCandidatesForRefundCase,
  NayaxLookupRequestError,
} from "../_shared/nayax-lookup.ts";

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

const sanitizeText = (value: unknown, maxLength = 300) =>
  typeof value === "string" || typeof value === "number" || typeof value === "boolean"
    ? String(value).trim().slice(0, maxLength)
    : "";

const isUuid = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") {
      return jsonResponse({ error: "Method not allowed." }, 405);
    }

    if (!supabase) {
      return jsonResponse({ error: "Nayax lookup is not configured." }, 500);
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

    const { data: canManageCase, error: accessError } = await supabase.rpc(
      "can_manage_refund_case",
      { p_user_id: user.id, p_refund_case_id: caseId },
    );

    if (accessError) {
      throw accessError;
    }

    if (!canManageCase) {
      return jsonResponse({ error: "Refund case access required." }, 403);
    }

    const result = await lookupNayaxCandidatesForRefundCase({
      supabase,
      caseId,
      actorUserId: user.id,
    });

    if (result.configured && result.candidates.length > 0) {
      await supabase.from("refund_cases")
        .update({
          status: "needs_review",
          correlation_status: "manual_review",
          correlation_source: "nayax",
          correlation_confidence: Math.max(0.01, result.candidates[0]?.matchConfidence ?? 0.01),
          correlation_summary:
            `Nayax lookup found ${result.candidates.length} candidate(s) inside +/- ${result.windowHours} hours. Manager must confirm the match.`,
          automation_state: "under_review",
        })
        .eq("id", caseId);

      await supabase.from("refund_case_events").insert({
        refund_case_id: caseId,
        actor_user_id: user.id,
        event_type: "nayax_lookup_candidates_found",
        message: "Nayax lookup found sanitized card-sale candidate evidence for manager review.",
        metadata: {
          candidate_count: result.candidates.length,
          window_hours: result.windowHours,
          provider_record_count: result.providerRecordCount ?? null,
          provider_window_record_count: result.providerWindowRecordCount ?? null,
          payload_redacted: true,
        },
      });
    }

    return jsonResponse({
      configured: result.configured,
      message: result.message,
      providerRecordCount: result.providerRecordCount,
      providerParseableRecordCount: result.providerParseableRecordCount,
      providerWindowRecordCount: result.providerWindowRecordCount,
      candidates: result.candidates,
      windowHours: result.windowHours,
    });
  } catch (error) {
    if (error instanceof NayaxLookupRequestError) {
      return jsonResponse({ error: error.message }, error.status);
    }

    console.error("nayax-transaction-lookup error", {
      errorType: error instanceof Error ? error.name : typeof error,
    });
    return jsonResponse({ error: "Unable to look up Nayax transactions." }, 500);
  }
});
