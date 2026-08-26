import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.1";
import { resolveSupabaseAccessToken } from "../_shared/auth.ts";
import { corsHeaders } from "../_shared/cors.ts";
import {
  lookupNayaxCandidatesForRefundCase,
  NayaxLookupRequestError,
} from "../_shared/nayax-lookup.ts";
import {
  beginNayaxLookup,
  failNayaxLookup,
  persistNayaxLookupResult,
} from "../_shared/nayax-lookup-persistence.ts";

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
  typeof value === "string" || typeof value === "number" ||
    typeof value === "boolean"
    ? String(value).trim().slice(0, maxLength)
    : "";

const isUuid = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(value);

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  let caseIdForAudit = "";
  let actorUserIdForAudit = "";
  let expectedFactVersionForAudit: number | null = null;
  let lookupGenerationForAudit: number | null = null;

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

    const { data: authData, error: authError } = await supabase.auth.getUser(
      accessToken,
    );
    const user = authData?.user;
    if (authError || !user) {
      return jsonResponse({ error: "Unauthorized." }, 401);
    }
    actorUserIdForAudit = user.id;

    const body = await req.json();
    const caseId = sanitizeText(body?.caseId, 80);
    caseIdForAudit = caseId;

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

    const { data: lookupCase, error: lookupCaseError } = await supabase
      .from("refund_cases")
      .select("deterministic_fact_version")
      .eq("id", caseId)
      .single();
    if (lookupCaseError) throw lookupCaseError;
    const expectedFactVersion = Number(lookupCase.deterministic_fact_version);
    if (!Number.isInteger(expectedFactVersion)) {
      throw new Error("Refund case matching evidence version is unavailable.");
    }
    expectedFactVersionForAudit = expectedFactVersion;
    const lookupGeneration = await beginNayaxLookup({
      supabase,
      caseId,
      actorUserId: user.id,
      expectedFactVersion,
      trigger: "manual",
    });
    lookupGenerationForAudit = lookupGeneration;

    const result = await lookupNayaxCandidatesForRefundCase({
      supabase,
      caseId,
      actorUserId: user.id,
      lookupGeneration,
      expectedFactVersion,
    });

    await persistNayaxLookupResult({
      supabase,
      caseId,
      actorUserId: user.id,
      result,
      trigger: "manual",
      expectedFactVersion,
      lookupGeneration,
    });

    const { data: caseVersion, error: caseVersionError } = await supabase
      .from("refund_cases")
      .select("official_action_version")
      .eq("id", caseId)
      .single();
    if (caseVersionError) throw caseVersionError;

    return jsonResponse({
      configured: result.configured,
      lookupStatus: result.lookupStatus,
      recommendationState: result.recommendationState,
      confidenceClass: result.confidenceClass,
      reasonCodes: result.reasonCodes,
      policyVersion: result.policyVersion,
      oneClickEligible: result.oneClickEligible,
      incidentAt: result.refundCase?.incidentAt ?? null,
      qrClaimOpenedAt: result.qrClaimOpenedAt,
      qrClaimEvidenceStatus: result.qrClaimEvidenceStatus,
      maximumUniqueQrLagMinutes: result.maximumUniqueQrLagMinutes,
      message: result.message,
      lastCheckedAt: result.lastCheckedAt,
      providerRecordCount: result.providerRecordCount,
      providerParseableRecordCount: result.providerParseableRecordCount,
      providerWindowRecordCount: result.providerWindowRecordCount,
      candidateCount: result.candidateCount,
      candidates: result.candidates,
      windowHours: result.windowHours,
      summary: result.summary,
      recommendedAction: result.recommendedAction,
      officialActionVersion: caseVersion.official_action_version,
    });
  } catch (error) {
    if (
      supabase && isUuid(caseIdForAudit) &&
      expectedFactVersionForAudit !== null &&
      lookupGenerationForAudit !== null
    ) {
      try {
        await failNayaxLookup({
          supabase,
          caseId: caseIdForAudit,
          actorUserId: actorUserIdForAudit || null,
          expectedFactVersion: expectedFactVersionForAudit,
          lookupGeneration: lookupGenerationForAudit,
          trigger: "manual",
          error,
        });
      } catch (auditError) {
        console.error("nayax-transaction-lookup audit insert failed", {
          errorType: auditError instanceof Error
            ? auditError.name
            : typeof auditError,
        });
      }
    }

    if (error instanceof NayaxLookupRequestError) {
      return jsonResponse({ error: error.message }, error.status);
    }

    console.error("nayax-transaction-lookup error", {
      errorType: error instanceof Error ? error.name : typeof error,
    });
    return jsonResponse(
      { error: "Unable to look up Nayax transactions." },
      500,
    );
  }
});
