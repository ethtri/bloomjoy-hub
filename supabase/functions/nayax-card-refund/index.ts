import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.1";
import { resolveSupabaseAccessToken } from "../_shared/auth.ts";
import { corsHeaders } from "../_shared/cors.ts";

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
  refundCase.refund_amount_cents ?? refundCase.payment_amount_cents ?? 0;

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

const buildIdempotencyKey = async (refundCase: RefundCaseForExecution) => {
  const secret = Deno.env.get("NAYAX_REFUND_IDEMPOTENCY_SECRET") || supabaseServiceRoleKey || "local-dev";
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
  actorIsSuperAdmin,
}: {
  refundCase: RefundCaseForExecution;
  actorIsSuperAdmin: boolean;
}) => {
  const blocks: string[] = [];
  const machine = refundCase.reporting_machines;
  const amountCents = resolveRefundAmountCents(refundCase);
  const globalMax = envInt("NAYAX_REFUND_MAX_AMOUNT_CENTS", 1000);

  if (!actorIsSuperAdmin) blocks.push("authorization_failed");
  if (refundCase.status !== "card_refund_pending") blocks.push("validation_rejected");
  if (refundCase.decision !== "approved") blocks.push("validation_rejected");
  if (refundCase.payment_method !== "card") blocks.push("validation_rejected");
  if (refundCase.card_wallet_used) blocks.push("manual_review");
  if (refundCase.correlation_status !== "matched") blocks.push("validation_rejected");
  if (refundCase.correlation_source !== "nayax") blocks.push("validation_rejected");
  if (!safeNayaxReference(refundCase.matched_nayax_transaction_id)) blocks.push("validation_rejected");
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

const getDailyCapBlocks = async (amountCents: number) => {
  const blocks: string[] = [];
  const dailyAmountCap = envInt("NAYAX_REFUND_DAILY_AMOUNT_CAP_CENTS", 0);
  const dailyCountCap = envInt("NAYAX_REFUND_DAILY_COUNT_CAP", 0);

  if (dailyAmountCap <= 0 && dailyCountCap <= 0) return blocks;
  if (!supabase) return blocks;

  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);

  const { data, error } = await supabase
    .from("refund_case_nayax_refund_attempts")
    .select("amount_cents,status")
    .gte("created_at", dayStart.toISOString())
    .in("status", ["in_progress", "requested", "approved", "succeeded"]);

  if (error) throw error;

  const attempts = (data ?? []) as Array<{ amount_cents: number | null; status: string | null }>;
  if (dailyCountCap > 0 && attempts.length + 1 > dailyCountCap) {
    blocks.push("daily_count_cap_exceeded");
  }

  const committedAmountCents = attempts.reduce(
    (total, attempt) => total + Math.max(0, Number(attempt.amount_cents ?? 0)),
    0,
  );
  if (dailyAmountCap > 0 && committedAmountCents + amountCents > dailyAmountCap) {
    blocks.push("daily_amount_cap_exceeded");
  }

  return blocks;
};

const recordAttempt = async ({
  refundCase,
  actorUserId,
  status,
  errorCode,
  idempotencyKey,
  executionMode,
}: {
  refundCase: RefundCaseForExecution;
  actorUserId: string;
  status: string;
  errorCode: string | null;
  idempotencyKey: string;
  executionMode: string;
}) => {
  if (!supabase) return null;

  const amountCents = resolveRefundAmountCents(refundCase);
  const machine = refundCase.reporting_machines;
  const requestFingerprint = await sha256Hex([
    refundCase.id,
    refundCase.matched_nayax_transaction_id ?? "",
    amountCents,
    refundCase.matched_nayax_currency_code ?? "",
  ].join("|"));

  const { data, error } = await supabase
    .from("refund_case_nayax_refund_attempts")
    .upsert({
      refund_case_id: refundCase.id,
      actor_user_id: actorUserId,
      execution_mode: executionMode,
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

    const { data: actorIsSuperAdmin, error: adminError } = await supabase.rpc(
      "is_super_admin",
      { p_user_id: user.id },
    );
    if (adminError) throw adminError;

    const idempotencyKey = await buildIdempotencyKey(refundCase);
    const preflightBlocks = getPreflightBlocks({
      refundCase,
      actorIsSuperAdmin: Boolean(actorIsSuperAdmin),
    });
    const dailyCapBlocks = await getDailyCapBlocks(resolveRefundAmountCents(refundCase));

    const killSwitchActive = !envFlag("NAYAX_REFUND_EXECUTION_KILL_SWITCH", "false");
    const executionEnabled = envFlag("NAYAX_REFUND_EXECUTION_ENABLED");
    const dryRun = !envFlag("NAYAX_REFUND_EXECUTION_DRY_RUN", "false");
    const sponsorGoNoGo = envFlag("NAYAX_REFUND_EXECUTION_SPONSOR_GO_NO_GO", "approved");
    const providerContractConfirmed = envFlag("NAYAX_REFUND_EXECUTION_PROVIDER_CONTRACT_CONFIRMED");
    const configBlocks = [
      killSwitchActive ? "kill_switch_active" : null,
      executionEnabled ? null : "feature_disabled",
      sponsorGoNoGo ? null : "configuration_missing",
      dryRun ? "feature_disabled" : null,
    ].filter(Boolean) as string[];

    const allBlocks = Array.from(new Set([...preflightBlocks, ...dailyCapBlocks, ...configBlocks]));
    if (allBlocks.length > 0) {
      const preferredError =
        allBlocks.includes("kill_switch_active") ? "kill_switch_active" :
        allBlocks.includes("authorization_failed") ? "authorization_failed" :
        allBlocks.includes("already_refunded") ? "already_refunded" :
        allBlocks.includes("amount_cap_exceeded") ? "amount_cap_exceeded" :
        allBlocks.includes("daily_amount_cap_exceeded") ? "amount_cap_exceeded" :
        allBlocks.includes("daily_count_cap_exceeded") ? "amount_cap_exceeded" :
        allBlocks.includes("manual_review") ? "manual_review" :
        allBlocks.includes("configuration_missing") ? "configuration_missing" :
        allBlocks.includes("feature_disabled") ? "feature_disabled" :
        "validation_rejected";
      const attempt = await recordAttempt({
        refundCase,
        actorUserId: user.id,
        status: preferredError === "manual_review" ? "manual_review" : "preflight_blocked",
        errorCode: preferredError,
        idempotencyKey,
        executionMode: "preflight",
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
      const attempt = await recordAttempt({
        refundCase,
        actorUserId: user.id,
        status: "manual_review",
        errorCode: "provider_contract_unconfirmed",
        idempotencyKey,
        executionMode: "preflight",
      });

      return jsonResponse({
        executed: false,
        status: attempt?.status ?? "manual_review",
        errorCode: "provider_contract_unconfirmed",
        message: "Nayax refund execution is gated until Bloomjoy validates the live provider contract.",
      }, 409);
    }

    const attempt = await recordAttempt({
      refundCase,
      actorUserId: user.id,
      status: "manual_review",
      errorCode: "provider_execution_not_yet_enabled",
      idempotencyKey,
      executionMode: "request_and_approve",
    });

    return jsonResponse({
      executed: false,
      status: attempt?.status ?? "manual_review",
      errorCode: "provider_execution_not_yet_enabled",
      message: "Provider execution is intentionally stopped before a live Nayax refund call in this release slice.",
    }, 409);
  } catch (error) {
    console.error("nayax-card-refund error", {
      errorType: error instanceof Error ? error.name : typeof error,
    });
    return jsonResponse({ error: "Unable to prepare Nayax refund execution." }, 500);
  }
});
