import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.1";
import { resolveSupabaseAccessToken } from "../_shared/auth.ts";
import { corsHeaders } from "../_shared/cors.ts";
import {
  buildNayaxRefundApprovalBody,
  buildNayaxRefundRequestBody,
  executeNayaxRefundProvider,
  parseNayaxRefundProviderContract,
} from "../_shared/nayax-refund-provider.mjs";

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

const envFlag = (name: string, expected = "true") =>
  sanitizeText(Deno.env.get(name), 40).toLowerCase() === expected;

const envInt = (name: string, fallback: number) => {
  const numeric = Number(Deno.env.get(name));
  return Number.isInteger(numeric) && numeric >= 0 ? numeric : fallback;
};

type RefundCaseForExecution = {
  id: string;
  public_reference: string;
  status: string;
  decision: string | null;
  payment_method: string;
  payment_amount_cents: number | null;
  refund_amount_cents: number | null;
  card_last4: string | null;
  card_wallet_used: boolean;
  correlation_status: string;
  correlation_source: string | null;
  nayax_recommendation_state: string | null;
  nayax_match_execution_eligible: boolean;
  matched_nayax_transaction_id: string | null;
  matched_nayax_site_id: number | null;
  matched_nayax_machine_auth_time: string | null;
  matched_nayax_amount_cents: number | null;
  matched_nayax_currency_code: string | null;
  reporting_adjustment_id: string | null;
  reporting_machines?: {
    id: string;
    machine_label: string | null;
    status: string | null;
    nayax_machine_id: string | null;
    nayax_account_key: string | null;
    nayax_refunds_enabled: boolean | null;
    nayax_refund_max_amount_cents: number | null;
  } | null;
};

type ProviderStageResult = {
  stage: "request" | "approve";
  outcome: string;
  httpStatus: number | null;
  result: string | null;
  status: string | null;
  failureType?: string;
  payloadRedacted: true;
};

type ClaimResult = {
  claimed?: boolean;
  attemptId?: string | null;
  status?: string | null;
  errorCode?: string | null;
  providerReference?: string | null;
};

const getRefundCase = async (caseId: string): Promise<RefundCaseForExecution | null> => {
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("refund_cases")
    .select(`
      id,
      public_reference,
      status,
      decision,
      payment_method,
      payment_amount_cents,
      refund_amount_cents,
      card_last4,
      card_wallet_used,
      correlation_status,
      correlation_source,
      nayax_recommendation_state,
      nayax_match_execution_eligible,
      matched_nayax_transaction_id,
      matched_nayax_site_id,
      matched_nayax_machine_auth_time,
      matched_nayax_amount_cents,
      matched_nayax_currency_code,
      reporting_adjustment_id,
      reporting_machines(
        id,
        machine_label,
        status,
        nayax_machine_id,
        nayax_account_key,
        nayax_refunds_enabled,
        nayax_refund_max_amount_cents
      )
    `)
    .eq("id", caseId)
    .maybeSingle();

  if (error) throw error;
  return data as RefundCaseForExecution | null;
};

const safeNayaxReference = (value: string | null | undefined) =>
  Boolean(value && /^[A-Za-z0-9][A-Za-z0-9._:-]{5,79}$/.test(value));

const resolveRefundAmountCents = (refundCase: RefundCaseForExecution) =>
  refundCase.refund_amount_cents ?? 0;

const sha256Hex = async (value: string) => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
};

const hmacSha256Hex = async (secret: string, value: string) => {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
};

const buildExecutionFingerprint = (refundCase: RefundCaseForExecution) => [
  refundCase.id,
  refundCase.matched_nayax_transaction_id ?? "",
  refundCase.matched_nayax_site_id ?? "",
  refundCase.matched_nayax_machine_auth_time ?? "",
  resolveRefundAmountCents(refundCase),
  refundCase.matched_nayax_currency_code ?? "",
].join("|");

const buildIdempotencyKeys = async (refundCase: RefundCaseForExecution) => {
  const secret = Deno.env.get("NAYAX_REFUND_IDEMPOTENCY_SECRET") ||
    supabaseServiceRoleKey ||
    "local-dev";
  const digest = await hmacSha256Hex(secret, buildExecutionFingerprint(refundCase));
  return {
    execution: `nayax-refund-execute-${digest}`,
    preflight: `nayax-refund-preflight-${digest}`,
  };
};

const getPreflightBlocks = ({
  refundCase,
  actorCanManageCase,
}: {
  refundCase: RefundCaseForExecution;
  actorCanManageCase: boolean;
}) => {
  const blocks: string[] = [];
  const machine = refundCase.reporting_machines;
  const amountCents = resolveRefundAmountCents(refundCase);
  const globalMax = envInt("NAYAX_REFUND_MAX_AMOUNT_CENTS", 1000);

  if (!actorCanManageCase) blocks.push("authorization_failed");
  if (refundCase.status !== "card_refund_pending") blocks.push("validation_rejected");
  if (refundCase.decision !== "approved") blocks.push("validation_rejected");
  if (refundCase.payment_method !== "card") blocks.push("validation_rejected");
  if (refundCase.card_wallet_used) blocks.push("manual_review");
  if (refundCase.correlation_status !== "matched") blocks.push("validation_rejected");
  if (refundCase.correlation_source !== "nayax") blocks.push("validation_rejected");
  if (refundCase.nayax_recommendation_state !== "high_confidence") blocks.push("manual_review");
  if (!refundCase.nayax_match_execution_eligible) blocks.push("manual_review");
  if (!safeNayaxReference(refundCase.matched_nayax_transaction_id)) {
    blocks.push("validation_rejected");
  }
  if (refundCase.matched_nayax_site_id === null) blocks.push("validation_rejected");
  if (!refundCase.matched_nayax_machine_auth_time) blocks.push("validation_rejected");
  if (refundCase.matched_nayax_currency_code !== "USD") blocks.push("validation_rejected");
  if (amountCents <= 0) blocks.push("validation_rejected");
  if (refundCase.payment_amount_cents !== amountCents) blocks.push("validation_rejected");
  if (refundCase.matched_nayax_amount_cents !== amountCents) blocks.push("validation_rejected");
  if (globalMax > 0 && amountCents > globalMax) blocks.push("amount_cap_exceeded");
  if (refundCase.reporting_adjustment_id) blocks.push("already_refunded");
  if (!machine || machine.status !== "active") blocks.push("configuration_missing");
  if (!machine?.nayax_machine_id) blocks.push("configuration_missing");
  if (!machine?.nayax_refunds_enabled) blocks.push("feature_disabled");
  if (
    machine?.nayax_refund_max_amount_cents &&
    amountCents > machine.nayax_refund_max_amount_cents
  ) {
    blocks.push("amount_cap_exceeded");
  }

  return Array.from(new Set(blocks));
};

const getDuplicateTransactionBlocks = async (refundCase: RefundCaseForExecution) => {
  if (!supabase || !safeNayaxReference(refundCase.matched_nayax_transaction_id)) return [];
  const { data, error } = await supabase
    .from("refund_cases")
    .select("id")
    .eq("matched_nayax_transaction_id", refundCase.matched_nayax_transaction_id)
    .neq("id", refundCase.id)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data?.id ? ["duplicate_transaction"] : [];
};

const recordPreflightAttempt = async ({
  refundCase,
  actorUserId,
  status,
  errorCode,
  idempotencyKey,
}: {
  refundCase: RefundCaseForExecution;
  actorUserId: string;
  status: string;
  errorCode: string | null;
  idempotencyKey: string;
}) => {
  if (!supabase) return null;

  const amountCents = resolveRefundAmountCents(refundCase);
  const machine = refundCase.reporting_machines;
  const requestFingerprint = await sha256Hex(buildExecutionFingerprint(refundCase));
  const { data, error } = await supabase
    .from("refund_case_nayax_refund_attempts")
    .upsert({
      refund_case_id: refundCase.id,
      actor_user_id: actorUserId,
      execution_mode: "preflight",
      status,
      idempotency_key: idempotencyKey,
      amount_cents: amountCents,
      transaction_id_present: safeNayaxReference(refundCase.matched_nayax_transaction_id),
      site_id_present: refundCase.matched_nayax_site_id !== null,
      machine_auth_time_present: Boolean(refundCase.matched_nayax_machine_auth_time),
      error_code: errorCode,
      sanitized_request: {
        request_fingerprint: requestFingerprint,
        refund_case_reference: refundCase.public_reference,
        amount_cents: amountCents,
        currency_code: refundCase.matched_nayax_currency_code,
        account_key_present: Boolean(machine?.nayax_account_key),
        nayax_machine_id_present: Boolean(machine?.nayax_machine_id),
        payload_redacted: true,
      },
      sanitized_response: {},
    }, { onConflict: "idempotency_key" })
    .select("id, status, error_code")
    .single();

  if (error) throw error;
  return data;
};

const normalizeAccountKey = (value: string | null | undefined) =>
  sanitizeText(value, 100).toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");

const resolveNayaxToken = (accountKey: string | null | undefined) => {
  const normalizedAccountKey = normalizeAccountKey(accountKey);
  return (
    (normalizedAccountKey
      ? Deno.env.get(`NAYAX_LYNX_API_TOKEN_${normalizedAccountKey}`)
      : null) ||
    Deno.env.get("NAYAX_LYNX_API_TOKEN_TGPACI_USA_DB") ||
    Deno.env.get("NAYAX_LYNX_API_TOKEN") ||
    ""
  );
};

const resolveProviderConfiguration = (refundCase: RefundCaseForExecution) => {
  const rawContract = Deno.env.get("NAYAX_REFUND_PROVIDER_CONTRACT_JSON");
  const token = resolveNayaxToken(refundCase.reporting_machines?.nayax_account_key);
  if (!rawContract || !token) {
    throw new Error("Nayax refund provider configuration is incomplete.");
  }
  const contract = parseNayaxRefundProviderContract(rawContract);
  buildNayaxRefundRequestBody({
    contract,
    amountCents: resolveRefundAmountCents(refundCase),
    transactionId: refundCase.matched_nayax_transaction_id,
    siteId: refundCase.matched_nayax_site_id,
    machineAuthorizationTime: refundCase.matched_nayax_machine_auth_time,
  });
  buildNayaxRefundApprovalBody({
    transactionId: refundCase.matched_nayax_transaction_id,
    siteId: refundCase.matched_nayax_site_id,
    machineAuthorizationTime: refundCase.matched_nayax_machine_auth_time,
  });
  return {
    contract,
    token,
    timeoutMs: envInt("NAYAX_REFUND_PROVIDER_TIMEOUT_MS", 10_000),
  };
};

const updateAttemptAndCase = async ({
  attemptId,
  refundCaseId,
  attemptStatus,
  caseStatus,
  errorCode,
  stageResult,
  priorStageResult,
}: {
  attemptId: string;
  refundCaseId: string;
  attemptStatus: string;
  caseStatus: string;
  errorCode: string | null;
  stageResult: ProviderStageResult;
  priorStageResult?: ProviderStageResult | null;
}) => {
  if (!supabase) throw new Error("Nayax refund database client is unavailable.");

  const providerStatus = [
    stageResult.stage,
    stageResult.result ?? "none",
    stageResult.status ?? "none",
  ].join(":").slice(0, 200);
  const sanitizeStageResult = (result: ProviderStageResult) => ({
    outcome: result.outcome,
    http_status: result.httpStatus,
    result: result.result,
    status: result.status,
    failure_type: result.failureType ?? null,
    payload_redacted: true,
  });
  const sanitizedResponse = stageResult.stage === "approve"
    ? {
      request: priorStageResult ? sanitizeStageResult(priorStageResult) : null,
      approve: sanitizeStageResult(stageResult),
      payload_redacted: true,
    }
    : {
      request: sanitizeStageResult(stageResult),
      payload_redacted: true,
    };
  const { data: updatedAttempt, error: attemptError } = await supabase
    .from("refund_case_nayax_refund_attempts")
    .update({
      status: attemptStatus,
      provider_status: providerStatus,
      error_code: errorCode,
      sanitized_response: sanitizedResponse,
    })
    .eq("id", attemptId)
    .select("id")
    .maybeSingle();
  if (attemptError || !updatedAttempt) {
    throw attemptError ?? new Error("Nayax refund attempt update was not recorded.");
  }

  const { data: updatedCase, error: caseError } = await supabase
    .from("refund_cases")
    .update({ nayax_refund_execution_status: caseStatus })
    .eq("id", refundCaseId)
    .select("id")
    .maybeSingle();
  if (caseError || !updatedCase) {
    throw caseError ?? new Error("Nayax refund case status update was not recorded.");
  }
};

const providerStageState = (result: ProviderStageResult) => {
  if (result.stage === "request") {
    if (result.outcome === "accepted") {
      return { attemptStatus: "requested", caseStatus: "requested", errorCode: null };
    }
    if (result.outcome === "rejected") {
      return {
        attemptStatus: "failed",
        caseStatus: "failed",
        errorCode: "provider_request_rejected",
      };
    }
  } else {
    if (result.outcome === "succeeded") {
      return { attemptStatus: "succeeded", caseStatus: "approved", errorCode: null };
    }
    if (result.outcome === "rejected") {
      return {
        attemptStatus: "failed",
        caseStatus: "failed",
        errorCode: "provider_approval_rejected",
      };
    }
  }

  if (result.outcome === "duplicate") {
    return {
      attemptStatus: "manual_review",
      caseStatus: "manual_review",
      errorCode: "provider_duplicate",
    };
  }
  if (result.outcome === "already_refunded") {
    return {
      attemptStatus: "manual_review",
      caseStatus: "manual_review",
      errorCode: "provider_already_refunded",
    };
  }
  return {
    attemptStatus: "ambiguous",
    caseStatus: "ambiguous",
    errorCode: "provider_outcome_unconfirmed",
  };
};

const markAmbiguousAfterProviderStart = async (attemptId: string, refundCaseId: string) => {
  if (!supabase) return;
  const sanitizedResponse = {
    stage: "internal_recording",
    outcome: "unknown",
    payload_redacted: true,
  };
  await Promise.allSettled([
    supabase
      .from("refund_case_nayax_refund_attempts")
      .update({
        status: "ambiguous",
        error_code: "provider_outcome_unconfirmed",
        sanitized_response: sanitizedResponse,
      })
      .eq("id", attemptId),
    supabase
      .from("refund_cases")
      .update({ nayax_refund_execution_status: "ambiguous" })
      .eq("id", refundCaseId),
  ]);
};

const claimProviderExecution = async ({
  refundCase,
  actorUserId,
  idempotencyKey,
  requestFingerprint,
  contractVersion,
}: {
  refundCase: RefundCaseForExecution;
  actorUserId: string;
  idempotencyKey: string;
  requestFingerprint: string;
  contractVersion: string;
}): Promise<ClaimResult> => {
  if (!supabase) throw new Error("Nayax refund database client is unavailable.");
  const { data, error } = await supabase.rpc("service_claim_nayax_refund_execution", {
    p_actor_user_id: actorUserId,
    p_refund_case_id: refundCase.id,
    p_idempotency_key: idempotencyKey,
    p_daily_amount_cap_cents: envInt("NAYAX_REFUND_DAILY_AMOUNT_CAP_CENTS", 0),
    p_daily_count_cap: envInt("NAYAX_REFUND_DAILY_COUNT_CAP", 0),
    p_request_fingerprint: requestFingerprint,
    p_provider_contract_version: contractVersion,
  });
  if (error) throw error;
  return (data ?? {}) as ClaimResult;
};

const existingClaimResponse = (claim: ClaimResult) => {
  if (claim.status === "succeeded") {
    return jsonResponse({
      executed: true,
      status: "succeeded",
      providerReference: claim.providerReference ?? null,
      message: "This approved Nayax refund was already completed.",
    });
  }

  const outcomeUnknown = [
    "in_progress",
    "requested",
    "approved",
    "ambiguous",
    "manual_review",
  ].includes(claim.status ?? "");
  const errorCode = outcomeUnknown
    ? (claim.errorCode || "provider_outcome_unconfirmed")
    : (claim.errorCode || "validation_rejected");
  return jsonResponse({
    executed: false,
    status: claim.status ?? "preflight_blocked",
    errorCode,
    message: outcomeUnknown
      ? "A Nayax refund attempt already exists. Do not retry it until the transaction is reconciled in Nayax."
      : "This refund could not obtain a safe, single-use Nayax execution claim.",
  }, 409);
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
      return jsonResponse({ error: "Nayax refund execution is not configured." }, 500);
    }

    const accessToken = resolveSupabaseAccessToken(req);
    if (!accessToken) return jsonResponse({ error: "Unauthorized." }, 401);

    const { data: authData, error: authError } = await supabase.auth.getUser(accessToken);
    const user = authData?.user;
    if (authError || !user) return jsonResponse({ error: "Unauthorized." }, 401);

    const body = await req.json();
    const caseId = sanitizeText(body?.caseId, 80);
    if (!isUuid(caseId)) {
      return jsonResponse({ error: "Refund case is required." }, 400);
    }

    const refundCase = await getRefundCase(caseId);
    if (!refundCase) return jsonResponse({ error: "Refund case not found." }, 404);
    const { data: actorCanManageCase, error: accessError } = await supabase.rpc(
      "can_manage_refund_case",
      { p_user_id: user.id, p_refund_case_id: refundCase.id },
    );
    if (accessError) throw accessError;

    const idempotencyKeys = await buildIdempotencyKeys(refundCase);
    const preflightBlocks = getPreflightBlocks({
      refundCase,
      actorCanManageCase: Boolean(actorCanManageCase),
    });
    const duplicateTransactionBlocks = await getDuplicateTransactionBlocks(refundCase);

    const killSwitchActive = !envFlag("NAYAX_REFUND_EXECUTION_KILL_SWITCH", "false");
    const executionEnabled = envFlag("NAYAX_REFUND_EXECUTION_ENABLED");
    const dryRun = !envFlag("NAYAX_REFUND_EXECUTION_DRY_RUN", "false");
    const sponsorGoNoGo = envFlag("NAYAX_REFUND_EXECUTION_SPONSOR_GO_NO_GO", "approved");
    const providerContractConfirmed = envFlag(
      "NAYAX_REFUND_EXECUTION_PROVIDER_CONTRACT_CONFIRMED",
    );
    const configBlocks = [
      killSwitchActive ? "kill_switch_active" : null,
      executionEnabled ? null : "feature_disabled",
      sponsorGoNoGo ? null : "configuration_missing",
      dryRun ? "feature_disabled" : null,
    ].filter(Boolean) as string[];

    const allBlocks = Array.from(
      new Set([...preflightBlocks, ...duplicateTransactionBlocks, ...configBlocks]),
    );
    if (allBlocks.length > 0) {
      const preferredError =
        allBlocks.includes("kill_switch_active") ? "kill_switch_active" :
        allBlocks.includes("authorization_failed") ? "authorization_failed" :
        allBlocks.includes("already_refunded") ? "already_refunded" :
        allBlocks.includes("amount_cap_exceeded") ? "amount_cap_exceeded" :
        allBlocks.includes("duplicate_transaction") ? "manual_review" :
        allBlocks.includes("manual_review") ? "manual_review" :
        allBlocks.includes("configuration_missing") ? "configuration_missing" :
        allBlocks.includes("feature_disabled") ? "feature_disabled" :
        "validation_rejected";
      const attempt = await recordPreflightAttempt({
        refundCase,
        actorUserId: user.id,
        status: preferredError === "manual_review" ? "manual_review" : "preflight_blocked",
        errorCode: preferredError,
        idempotencyKey: idempotencyKeys.preflight,
      });

      return jsonResponse({
        executed: false,
        status: attempt?.status ?? "preflight_blocked",
        errorCode: preferredError,
        blocks: allBlocks,
        dryRun,
        killSwitchActive,
      }, 409);
    }

    if (!providerContractConfirmed) {
      const attempt = await recordPreflightAttempt({
        refundCase,
        actorUserId: user.id,
        status: "manual_review",
        errorCode: "provider_contract_unconfirmed",
        idempotencyKey: idempotencyKeys.preflight,
      });

      return jsonResponse({
        executed: false,
        status: attempt?.status ?? "manual_review",
        errorCode: "provider_contract_unconfirmed",
        message: "Bloomjoy must confirm the account-specific Nayax refund responses before this can run.",
      }, 409);
    }

    let providerConfiguration;
    try {
      providerConfiguration = resolveProviderConfiguration(refundCase);
    } catch {
      const attempt = await recordPreflightAttempt({
        refundCase,
        actorUserId: user.id,
        status: "preflight_blocked",
        errorCode: "provider_configuration_invalid",
        idempotencyKey: idempotencyKeys.preflight,
      });
      return jsonResponse({
        executed: false,
        status: attempt?.status ?? "preflight_blocked",
        errorCode: "provider_configuration_invalid",
        message: "The Nayax refund connection is incomplete or does not match the approved contract.",
      }, 409);
    }

    const requestFingerprint = await sha256Hex(buildExecutionFingerprint(refundCase));
    const claim = await claimProviderExecution({
      refundCase,
      actorUserId: user.id,
      idempotencyKey: idempotencyKeys.execution,
      requestFingerprint,
      contractVersion: providerConfiguration.contract.contractVersion,
    });
    if (!claim.claimed || !claim.attemptId) {
      return existingClaimResponse(claim);
    }

    try {
      let requestStageResult: ProviderStageResult | null = null;
      const result = await executeNayaxRefundProvider({
        contract: providerConfiguration.contract,
        token: providerConfiguration.token,
        amountCents: resolveRefundAmountCents(refundCase),
        transactionId: refundCase.matched_nayax_transaction_id,
        siteId: refundCase.matched_nayax_site_id,
        machineAuthorizationTime: refundCase.matched_nayax_machine_auth_time,
        timeoutMs: providerConfiguration.timeoutMs,
        onStage: async (stageResult: ProviderStageResult) => {
          const priorStageResult = requestStageResult;
          if (stageResult.stage === "request") {
            requestStageResult = stageResult;
          }
          const state = providerStageState(stageResult);
          await updateAttemptAndCase({
            attemptId: claim.attemptId as string,
            refundCaseId: refundCase.id,
            ...state,
            stageResult,
            priorStageResult,
          });
        },
      });

      if (result.executed) {
        return jsonResponse({
          executed: true,
          status: "succeeded",
          refundReference: refundCase.public_reference,
          message: "The Nayax card refund was approved.",
        });
      }

      const finalStage = (result.approve ?? result.request) as ProviderStageResult;
      const finalState = providerStageState(finalStage);
      return jsonResponse({
        executed: false,
        status: finalState.attemptStatus,
        errorCode: finalState.errorCode,
        message: finalState.errorCode === "provider_outcome_unconfirmed"
          ? "Nayax did not return a confirmed outcome. Do not retry; reconcile this transaction in Nayax."
          : "Nayax did not complete this refund. Review the recorded provider outcome before taking another action.",
      }, 409);
    } catch {
      await markAmbiguousAfterProviderStart(claim.attemptId, refundCase.id);
      return jsonResponse({
        executed: false,
        status: "ambiguous",
        errorCode: "provider_outcome_unconfirmed",
        message: "The Nayax outcome could not be confirmed. Do not retry; reconcile this transaction in Nayax.",
      }, 502);
    }
  } catch (error) {
    console.error("nayax-card-refund error", {
      errorType: error instanceof Error ? error.name : typeof error,
    });
    return jsonResponse({ error: "Unable to prepare Nayax refund execution." }, 500);
  }
});
