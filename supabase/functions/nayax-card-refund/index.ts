import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.1";
import { resolveSupabaseAccessToken } from "../_shared/auth.ts";
import { corsHeaders } from "../_shared/cors.ts";
import {
  authorizeRefundOfficialAction,
  RefundOfficialActionAuthorizationError,
} from "../_shared/refund-official-action.ts";
import {
  buildNayaxRefundIdempotencyKey,
  resolveNayaxRefundExecutionConfig,
} from "../_shared/nayax-refund-gates.ts";
import {
  disabledNayaxProviderAdapter,
  type NayaxAttemptReservation,
  type NayaxAttemptSettlement,
  orchestrateNayaxRefund,
} from "../_shared/nayax-refund-orchestration.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
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
  official_action_version: number;
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

const getRefundCase = async (
  caseId: string,
): Promise<RefundCaseForExecution | null> => {
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
      official_action_version,
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

const getPreflightBlocks = ({
  refundCase,
  actorCanManageCase,
  globalMaxAmountCents,
}: {
  refundCase: RefundCaseForExecution;
  actorCanManageCase: boolean;
  globalMaxAmountCents: number;
}) => {
  const blocks: string[] = [];
  const machine = refundCase.reporting_machines;
  const amountCents = resolveRefundAmountCents(refundCase);

  if (!actorCanManageCase) blocks.push("authorization_failed");
  if (refundCase.status !== "card_refund_pending") {
    blocks.push("validation_rejected");
  }
  if (refundCase.decision !== "approved") blocks.push("validation_rejected");
  if (refundCase.payment_method !== "card") blocks.push("validation_rejected");
  if (refundCase.card_wallet_used) blocks.push("manual_review");
  if (refundCase.correlation_status !== "matched") {
    blocks.push("validation_rejected");
  }
  if (refundCase.correlation_source !== "nayax") {
    blocks.push("validation_rejected");
  }
  if (refundCase.nayax_recommendation_state !== "high_confidence") {
    blocks.push("manual_review");
  }
  if (!refundCase.nayax_match_execution_eligible) blocks.push("manual_review");
  if (!safeNayaxReference(refundCase.matched_nayax_transaction_id)) {
    blocks.push("validation_rejected");
  }
  if (refundCase.matched_nayax_site_id === null) {
    blocks.push("validation_rejected");
  }
  if (!refundCase.matched_nayax_machine_auth_time) {
    blocks.push("validation_rejected");
  }
  if (refundCase.matched_nayax_currency_code !== "USD") {
    blocks.push("validation_rejected");
  }
  if (amountCents <= 0) blocks.push("validation_rejected");
  if (refundCase.payment_amount_cents !== amountCents) {
    blocks.push("validation_rejected");
  }
  if (refundCase.matched_nayax_amount_cents !== amountCents) {
    blocks.push("validation_rejected");
  }
  if (amountCents > globalMaxAmountCents) {
    blocks.push("amount_cap_exceeded");
  }
  if (refundCase.reporting_adjustment_id) blocks.push("already_refunded");
  if (!machine || machine.status !== "active") {
    blocks.push("configuration_missing");
  }
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

const getDuplicateTransactionBlocks = async (
  refundCase: RefundCaseForExecution,
) => {
  if (
    !supabase || !safeNayaxReference(refundCase.matched_nayax_transaction_id)
  ) return [];
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

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") {
      return jsonResponse({ error: "Method not allowed." }, 405);
    }

    if (!supabase) {
      return jsonResponse({
        error: "Nayax refund execution is not configured.",
      }, 500);
    }

    const accessToken = resolveSupabaseAccessToken(req);
    if (!accessToken) return jsonResponse({ error: "Unauthorized." }, 401);

    const { data: authData, error: authError } = await supabase.auth.getUser(
      accessToken,
    );
    const user = authData?.user;
    if (authError || !user) {
      return jsonResponse({ error: "Unauthorized." }, 401);
    }

    const body = await req.json();
    const caseId = sanitizeText(body?.caseId, 80);
    if (!isUuid(caseId)) {
      return jsonResponse({ error: "Refund case is required." }, 400);
    }

    const refundCase = await getRefundCase(caseId);
    if (!refundCase) {
      return jsonResponse({ error: "Refund case not found." }, 404);
    }
    const { data: actorCanPerformOfficialAction, error: accessError } =
      await supabase.rpc(
        "can_perform_refund_official_action",
        { p_user_id: user.id, p_refund_case_id: refundCase.id },
      );
    if (accessError) throw accessError;
    if (!actorCanPerformOfficialAction) {
      return jsonResponse({
        executed: false,
        status: "preflight_blocked",
        errorCode: "authorization_failed",
        blocks: ["authorization_failed"],
      }, 403);
    }

    const executionConfig = resolveNayaxRefundExecutionConfig((name) =>
      Deno.env.get(name)
    );
    const preflightBlocks = getPreflightBlocks({
      refundCase,
      actorCanManageCase: true,
      globalMaxAmountCents: executionConfig.maxAmountCents ??
        Number.MAX_SAFE_INTEGER,
    });
    const duplicateTransactionBlocks = await getDuplicateTransactionBlocks(
      refundCase,
    );

    const preExecutionBlocks = Array.from(
      new Set([
        ...preflightBlocks,
        ...duplicateTransactionBlocks,
        ...executionConfig.blocks,
      ]),
    );
    if (preExecutionBlocks.length > 0) {
      const preferredError = preExecutionBlocks.includes("authorization_failed")
        ? "authorization_failed"
        : preExecutionBlocks.includes("already_refunded")
        ? "already_refunded"
        : preExecutionBlocks.includes("amount_cap_exceeded")
        ? "amount_cap_exceeded"
        : preExecutionBlocks.includes("duplicate_transaction")
        ? "manual_review"
        : preExecutionBlocks.includes("manual_review")
        ? "manual_review"
        : preExecutionBlocks.some((block) =>
            [
              "kill_switch_active",
              "feature_disabled",
              "dry_run_active",
            ].includes(block)
          )
        ? "feature_disabled"
        : executionConfig.blocks.length > 0
        ? "configuration_missing"
        : "validation_rejected";

      return jsonResponse({
        executed: false,
        status: preferredError === "manual_review"
          ? "manual_review"
          : "preflight_blocked",
        errorCode: preferredError,
        blocks: preExecutionBlocks,
        dryRun: executionConfig.dryRun,
        killSwitchActive: executionConfig.killSwitchActive,
      }, 409);
    }

    const idempotencyKey = await buildNayaxRefundIdempotencyKey(
      executionConfig.idempotencySecret,
      {
        caseId: refundCase.id,
        transactionId: refundCase.matched_nayax_transaction_id!,
        siteId: refundCase.matched_nayax_site_id!,
        machineAuthorizationTime: refundCase.matched_nayax_machine_auth_time!,
        amountCents: resolveRefundAmountCents(refundCase),
        currencyCode: "USD",
      },
    );

    const expectedOfficialActionVersion = Number(
      body?.expectedOfficialActionVersion,
    );
    const stepUpIntentId = sanitizeText(body?.stepUpIntentId, 80) || null;
    const stepUpFactorProof = sanitizeText(body?.stepUpFactorProof, 80) || null;
    let authorizationPromise:
      | ReturnType<
        typeof authorizeRefundOfficialAction
      >
      | null = null;
    const getOfficialAuthorization = () => {
      authorizationPromise ??= authorizeRefundOfficialAction({
        supabaseUrl,
        supabaseAnonKey,
        accessToken,
        context: {
          caseId: refundCase.id,
          action: "nayax_execute",
          targetFunction: "nayax-card-refund",
          stepUpIntentId,
          stepUpFactorProof,
          expectedCaseVersion: expectedOfficialActionVersion,
          targetStatus: "card_refund_pending",
          targetDecision: "approved",
          refundAmountCents: resolveRefundAmountCents(refundCase),
        },
      });
      return authorizationPromise;
    };

    // There is deliberately no environment, request-body, or user-selectable
    // adapter switch. The production handler still imports only the disabled
    // adapter, so these database dependencies remain unreachable until a
    // separately reviewed provider-contract change selects a live adapter.
    const result = await orchestrateNayaxRefund({
      request: {
        caseId: refundCase.id,
        idempotencyKey,
        amountCents: resolveRefundAmountCents(refundCase),
        currencyCode: "USD",
      },
      dependencies: {
        provider: disabledNayaxProviderAdapter,
        reserveAndConsumeAttempt: async (request) => {
          const authorization = await getOfficialAuthorization();
          const { data, error } = await supabase.rpc(
            "service_reserve_and_consume_nayax_refund_attempt_v2",
            {
              p_executor_assertion: executionConfig.executorAssertion,
              p_authorization_id: authorization.authorizationId,
              p_case_id: request.caseId,
              p_idempotency_key: request.idempotencyKey,
              p_amount_cents: request.amountCents,
              p_daily_amount_cap_cents: executionConfig.dailyAmountCapCents,
              p_daily_count_cap: executionConfig.dailyCountCap,
              p_currency_code: request.currencyCode,
            },
          );
          if (error || !data || typeof data !== "object") {
            throw new Error("Unable to reserve the bounded Nayax attempt.");
          }
          return data as NayaxAttemptReservation;
        },
        settleProviderOutcome: async (input) => {
          const { data, error } = await supabase.rpc(
            "service_settle_nayax_refund_attempt",
            {
              p_executor_assertion: executionConfig.executorAssertion,
              p_attempt_id: input.attemptId,
              p_authorization_id: input.authorizationId,
              p_case_id: input.request.caseId,
              p_idempotency_key: input.request.idempotencyKey,
              p_amount_cents: input.request.amountCents,
              p_currency_code: input.request.currencyCode,
              p_provider_claim_token: input.providerClaimToken,
              p_provider_outcome: input.outcome.kind,
              p_provider_reference: input.outcome.providerReference ?? null,
              p_provider_status: input.outcome.providerStatus ?? null,
              p_error_code: input.outcome.errorCode ?? null,
            },
          );
          if (error || !data || typeof data !== "object") {
            throw new Error("Unable to settle the bounded Nayax attempt.");
          }
          return data as NayaxAttemptSettlement;
        },
        deliverCustomerCompletion: () => {
          throw new Error(
            "Nayax customer completion remains disabled pending the controlled Gmail pilot.",
          );
        },
      },
    });

    return jsonResponse({
      ...result,
      blocks: executionConfig.blocks,
      dryRun: executionConfig.dryRun,
      killSwitchActive: executionConfig.killSwitchActive,
    }, 409);
  } catch (error) {
    if (error instanceof RefundOfficialActionAuthorizationError) {
      return jsonResponse({
        error: error.message,
        errorCode: error.code,
        stepUpIntentId: error.stepUpIntentId,
        stepUpExpiresAt: error.stepUpExpiresAt,
        officialAction: error.action,
        targetFunction: error.targetFunction,
      }, error.status);
    }
    console.error("nayax-card-refund error", {
      errorType: error instanceof Error ? error.name : typeof error,
    });
    return jsonResponse(
      { error: "Unable to prepare Nayax refund execution." },
      500,
    );
  }
});
