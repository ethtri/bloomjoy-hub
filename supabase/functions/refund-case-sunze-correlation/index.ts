import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.1";
import { resolveSupabaseAccessToken } from "../_shared/auth.ts";
import { corsHeaders } from "../_shared/cors.ts";

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
      "Cache-Control": "private, no-store, max-age=0",
    },
  });

const isUuid = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

const positiveInteger = (value: unknown): number | null => {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
};

const nonNegativeInteger = (value: unknown): number | null => {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
};

const statusForDatabaseError = (code: string | undefined) =>
  code === "42501" ? 403 : code === "40001" || code === "23505" ? 409 : 502;

const safeCorrelationError = (code: string | undefined) => {
  if (code === "42501") return { error: "You do not have access to this cash refund case.", errorCode: "unauthorized" };
  if (code === "40001") return { error: "The cash evidence changed. Refresh the case before continuing.", errorCode: "stale_cash_evidence" };
  if (code === "23505") return { error: "That sale is already linked to another refund case.", errorCode: "cash_sale_already_linked" };
  return { error: "Cash sales history is temporarily unavailable. Refresh and try again.", errorCode: "cash_correlation_unavailable" };
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed." }, 405);
  if (!serviceClient || !supabaseUrl || !supabaseAnonKey) {
    return jsonResponse({ error: "Cash sales history is not configured.", errorCode: "configuration_missing" }, 500);
  }

  const accessToken = resolveSupabaseAccessToken(req);
  if (!accessToken) return jsonResponse({ error: "Unauthorized." }, 401);

  const { data: authData, error: authError } = await serviceClient.auth.getUser(accessToken);
  if (authError || !authData.user || authData.user.is_anonymous) {
    return jsonResponse({ error: "Unauthorized." }, 401);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "A valid request body is required." }, 400);
  }

  const caseId = body.caseId;
  if (!isUuid(caseId)) return jsonResponse({ error: "A valid refund case is required." }, 400);
  const operation = body.operation === undefined || body.operation === "read"
    ? "read"
    : body.operation === "select"
    ? "select"
    : null;
  if (!operation) {
    return jsonResponse({ error: "A supported cash-evidence operation is required.", errorCode: "invalid_operation" }, 400);
  }

  if (operation === "read") {
    const candidateLimit = Math.min(8, positiveInteger(body.candidateLimit) ?? 8);
    const { data: preparation, error: preparationError } = await serviceClient.rpc(
      "service_prepare_legacy_cash_case_for_correlation",
      {
        p_refund_case_id: caseId,
        p_actor_user_id: authData.user.id,
      },
    );
    if (preparationError) {
      const safeError = safeCorrelationError(preparationError.code);
      return jsonResponse(safeError, statusForDatabaseError(preparationError.code));
    }
    const { data, error } = await serviceClient.rpc("service_get_sunze_cash_correlation", {
      p_refund_case_id: caseId,
      p_actor_user_id: authData.user.id,
      p_candidate_limit: candidateLimit,
    });
    if (error) {
      const safeError = safeCorrelationError(error.code);
      return jsonResponse(safeError, statusForDatabaseError(error.code));
    }
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      return jsonResponse({ error: "Cash sales history returned an invalid response.", errorCode: "invalid_cash_correlation" }, 502);
    }
    return jsonResponse({ correlation: data, payloadRedacted: true });
  }

  const attemptId = body.attemptId;
  const salesFactId = body.salesFactId;
  const caseFactVersion = positiveInteger(body.caseFactVersion);
  const expectedLinkVersion = nonNegativeInteger(body.expectedLinkVersion);
  if (!isUuid(attemptId) || !isUuid(salesFactId) || caseFactVersion === null || expectedLinkVersion === null) {
    return jsonResponse({ error: "Current cash evidence is required to select a sale.", errorCode: "cash_evidence_required" }, 400);
  }

  const { data, error } = await serviceClient.rpc("service_select_sunze_cash_candidate", {
    p_refund_case_id: caseId,
    p_attempt_id: attemptId,
    p_sales_fact_id: salesFactId,
    p_expected_fact_version: caseFactVersion,
    p_expected_link_version: expectedLinkVersion,
    p_actor_user_id: authData.user.id,
  });
  if (error) {
    const safeError = safeCorrelationError(error.code);
    return jsonResponse(safeError, statusForDatabaseError(error.code));
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return jsonResponse({ error: "Cash sale selection returned an invalid response.", errorCode: "invalid_cash_selection" }, 502);
  }
  return jsonResponse({ selection: data, payloadRedacted: true });
});
