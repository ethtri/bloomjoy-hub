import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.1";
import { resolveSupabaseAccessToken } from "../_shared/auth.ts";
import { corsHeaders } from "../_shared/cors.ts";
import {
  disabledNayaxProviderAdapter,
  orchestrateNayaxRefund,
} from "../_shared/nayax-refund-orchestration.ts";

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

const hmacSha256Hex = async (secret: string, value: string) => {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
};

const buildIdempotencyKey = async (refundCase: RefundCaseForExecution) => {
  const secret = Deno.env.get("NAYAX_REFUND_IDEMPOTENCY_SECRET") ||
    supabaseServiceRoleKey || "local-dev";
  const amountCents = resolveRefundAmountCents(refundCase);
  const fingerprint = [
    refundCase.id,
    refundCase.matched_nayax_transaction_id ?? "",
    refundCase.matched_nayax_site_id ?? "",
    refundCase.matched_nayax_machine_auth_time ?? "",
    amountCents,
    refundCase.matched_nayax_currency_code ?? "",
  ].join("|");

  return `nayax-refund-${await hmacSha256Hex(secret, fingerprint)}`;
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
  if (globalMax > 0 && amountCents > globalMax) {
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

    const idempotencyKey = await buildIdempotencyKey(refundCase);
    const preflightBlocks = getPreflightBlocks({
      refundCase,
      actorCanManageCase: Boolean(actorCanPerformOfficialAction),
    });
    const duplicateTransactionBlocks = await getDuplicateTransactionBlocks(
      refundCase,
    );

    const killSwitchActive = !envFlag(
      "NAYAX_REFUND_EXECUTION_KILL_SWITCH",
      "false",
    );
    const executionEnabled = envFlag("NAYAX_REFUND_EXECUTION_ENABLED");
    const dryRun = !envFlag("NAYAX_REFUND_EXECUTION_DRY_RUN", "false");
    const sponsorGoNoGo = envFlag(
      "NAYAX_REFUND_EXECUTION_SPONSOR_GO_NO_GO",
      "approved",
    );
    const providerContractConfirmed = envFlag(
      "NAYAX_REFUND_EXECUTION_PROVIDER_CONTRACT_CONFIRMED",
    );
    const configBlocks = [
      killSwitchActive ? "kill_switch_active" : null,
      executionEnabled ? null : "feature_disabled",
      sponsorGoNoGo ? null : "configuration_missing",
      dryRun ? "feature_disabled" : null,
    ].filter(Boolean) as string[];

    const preExecutionBlocks = Array.from(
      new Set([
        ...preflightBlocks,
        ...duplicateTransactionBlocks,
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
        : "validation_rejected";

      return jsonResponse({
        executed: false,
        status: preferredError === "manual_review"
          ? "manual_review"
          : "preflight_blocked",
        errorCode: preferredError,
        blocks: preExecutionBlocks,
        dryRun,
        killSwitchActive,
      }, 409);
    }

    // There is deliberately no environment, request-body, or user-selectable
    // adapter switch. Even if every legacy rollout flag is set, the real HTTP
    // function imports the disabled adapter and stops before consuming manager
    // evidence, reserving an attempt, or making a provider call.
    const result = await orchestrateNayaxRefund({
      request: {
        caseId: refundCase.id,
        idempotencyKey,
        amountCents: resolveRefundAmountCents(refundCase),
        currencyCode: "USD",
      },
      dependencies: {
        provider: disabledNayaxProviderAdapter,
        reserveAndConsumeAttempt: () => {
          throw new Error("Disabled production adapter cannot reserve an attempt.");
        },
        settleProviderOutcome: () => {
          throw new Error("Disabled production adapter cannot settle an attempt.");
        },
        deliverCustomerCompletion: () => {
          throw new Error("Disabled production adapter cannot contact a customer.");
        },
      },
    });

    return jsonResponse({
      ...result,
      blocks: [
        ...configBlocks,
        providerContractConfirmed ? null : "provider_contract_unconfirmed",
      ].filter(Boolean),
      dryRun,
      killSwitchActive,
    }, 409);
  } catch (error) {
    console.error("nayax-card-refund error", {
      errorType: error instanceof Error ? error.name : typeof error,
    });
    return jsonResponse(
      { error: "Unable to prepare Nayax refund execution." },
      500,
    );
  }
});
