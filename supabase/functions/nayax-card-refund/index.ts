import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.1";
import { resolveSupabaseAccessToken } from "../_shared/auth.ts";
import { parseNayaxRefundExecutionContext } from "../_shared/nayax-refund-context.ts";
import {
  parseReviewedFinalDecisionReceipt,
  parseReviewedFinalDecisionRequest,
} from "../_shared/nayax-reviewed-final-decision.ts";
import { corsHeaders } from "../_shared/cors.ts";
import {
  NAYAX_REFUND_OFFICIAL_ACTIONS_ENABLED,
  normalizeNayaxRefundAccountKey,
  resolveNayaxRefundAttemptQueueReadiness,
  resolveNayaxRefundAvailability,
  resolveNayaxRefundExecutionConfig,
} from "../_shared/nayax-refund-gates.ts";
// @deno-types="../_shared/nayax-refund-provider.d.ts"
import {
  areNayaxRefundWriteCredentialsReady,
  NAYAX_REFUND_PRODUCTION_BASE_URL,
  parseNayaxRefundProviderContract,
} from "../_shared/nayax-refund-provider.mjs";
import {
  mergeRuntimeRefundReadiness,
  parseDatabaseRefundReadiness,
  type RefundReadiness,
} from "../_shared/refund-readiness.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

const supabase = supabaseUrl && supabaseServiceRoleKey
  ? createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { persistSession: false },
  })
  : null;

const NAYAX_REFUND_JOURNAL_CONTRACT_VERSION = "nayax-provider-journal-v3";
const NAYAX_REFUND_PROVIDER_CONTRACT_VERSION =
  "nayax-production-account-contract-v2";
const NAYAX_REFUND_APPROVAL_POLICY_VERSION =
  "db-authoritative-exact-200-json-v1";
const NAYAX_REFUND_RESPONSE_ENVELOPE_VERSION =
  "nayax-response-envelope-v1";

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

const sha256Hex = async (value: string) => {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
};

const resolveNormalWriteCredentials = (accountKey: string) => ({
  requestToken: accountKey
    ? Deno.env.get(`NAYAX_REFUND_REQUEST_WRITE_TOKEN_${accountKey}`)?.trim() ?? ""
    : "",
  approveToken: accountKey
    ? Deno.env.get(`NAYAX_REFUND_APPROVE_WRITE_TOKEN_${accountKey}`)?.trim() ?? ""
    : "",
});

const resolveMachineAuthorizationTimeMode = () => {
  const value = Deno.env.get("NAYAX_REFUND_MACHINE_AUTHORIZATION_TIME_MODE")
    ?.trim() ?? "";
  if (!value || value === "exact_source") return "exact_source" as const;
  if (value === "source_with_bound_offset") {
    return "source_with_bound_offset" as const;
  }
  return null;
};

const parseConfiguredManagerContract = () => {
  const raw = Deno.env.get("NAYAX_REFUND_MANAGER_CONTRACT_JSON")?.trim() ?? "";
  if (!raw) return null;
  try {
    const contract = parseNayaxRefundProviderContract(raw);
    const machineAuthorizationTimeMode = resolveMachineAuthorizationTimeMode();
    const configuredEmailMode = Deno.env.get("NAYAX_REFUND_EMAIL_LIST_MODE")?.trim() ?? "";
    const refundEmailListMode = configuredEmailMode || contract.refundEmailListMode;
    return machineAuthorizationTimeMode &&
        (refundEmailListMode === "omit" || refundEmailListMode === "empty_string")
      ? { ...contract, machineAuthorizationTimeMode, refundEmailListMode }
      : null;
  } catch {
    return null;
  }
};

const providerJournalCompatible = async (
  executorAssertion: string | null,
  providerContractVersion: string | null,
) => {
  if (!supabase || !executorAssertion || !providerContractVersion) return false;
  const { data, error } = await supabase.rpc(
    "service_get_nayax_refund_provider_journal_capability_v3",
    { p_executor_assertion: executorAssertion },
  );
  if (error || !data || typeof data !== "object") return false;
  const capability = data as Record<string, unknown>;
  const supported = Array.isArray(capability.supportedProviderContractVersions)
    ? capability.supportedProviderContractVersions
    : [];
  return capability.journalContractVersion === NAYAX_REFUND_JOURNAL_CONTRACT_VERSION &&
    capability.approvalPolicyVersion === NAYAX_REFUND_APPROVAL_POLICY_VERSION &&
    capability.responseEnvelopeVersion ===
      NAYAX_REFUND_RESPONSE_ENVELOPE_VERSION &&
    capability.businessOutcomeRecordVersion === "nayax-business-outcome-v2" &&
    supported.includes(providerContractVersion) &&
    capability.providerContractConfirmationRequired === true &&
    capability.payloadRedacted === true;
};

type RefundCaseForExecution = {
  executionContext?: import('../_shared/nayax-refund-context.ts').NayaxRefundExecutionContext | null;
  id: string;
  case_population: string;
  nayax_refund_attempt_generation: number;
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
    nayax_machine_id: string | null;
    nayax_account_key: string | null;
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
      case_population,
      nayax_refund_attempt_generation,
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
        nayax_machine_id,
        nayax_account_key,
        nayax_refund_max_amount_cents
      )
    `)
    .eq("id", caseId)
    .maybeSingle();

  if (error) throw error;
  return data as RefundCaseForExecution | null;
};

const resolveCaseRefundReadiness = async ({
  refundCase,
  actorUserId,
  executionConfig,
}: {
  refundCase: RefundCaseForExecution;
  actorUserId: string;
  executionConfig: ReturnType<typeof resolveNayaxRefundExecutionConfig>;
}): Promise<RefundReadiness> => {
  if (!supabase) throw new Error("Refund readiness is unavailable.");

  const { data: databaseValue, error: readinessError } = await supabase.rpc(
    "refund_case_nayax_manager_readiness",
    { p_user_id: actorUserId, p_refund_case_id: refundCase.id },
  );
  if (readinessError) throw readinessError;

  const databaseReadiness = parseDatabaseRefundReadiness(databaseValue);
  if (!databaseReadiness.canIssueCardRefund) return databaseReadiness;

  const accountKey = normalizeNayaxRefundAccountKey(
    refundCase.reporting_machines?.nayax_account_key ?? "",
  );
  const attemptQueueReadiness = resolveNayaxRefundAttemptQueueReadiness({
    readEnv: (name) => Deno.env.get(name),
    requiredAccountKey: accountKey,
  });
  const credentials = resolveNormalWriteCredentials(accountKey);
  const managerContract = parseConfiguredManagerContract();
  const writeCredentialsReady = Boolean(
    managerContract &&
      managerContract.baseUrl === NAYAX_REFUND_PRODUCTION_BASE_URL &&
      areNayaxRefundWriteCredentialsReady({
        contract: managerContract,
        requestToken: credentials.requestToken,
        approveToken: credentials.approveToken,
      }),
  );
  const journalCompatible = await providerJournalCompatible(
    executionConfig.executorAssertion,
    managerContract?.contractVersion ?? null,
  );
  const providerCredentialAvailable = Boolean(
    accountKey && writeCredentialsReady && managerContract && journalCompatible,
  );
  const readiness = mergeRuntimeRefundReadiness({
    databaseReadiness,
    executionConfig,
    providerCredentialAvailable,
  });
  console.info(JSON.stringify({
    event: "nayax_refund_availability_runtime",
    caseIdDigest: await sha256Hex(refundCase.id),
    blockReason: readiness.blockReason,
    configReady: executionConfig.blocks.length === 0,
    accountKeyPresent: Boolean(accountKey),
    managerContractPresent: Boolean(managerContract),
    providerHostValid: managerContract?.baseUrl ===
      NAYAX_REFUND_PRODUCTION_BASE_URL,
    writeCredentialsReady,
    journalCompatible,
    attemptQueueEnabled: attemptQueueReadiness.enabled,
    attemptQueueAccountConfigured: attemptQueueReadiness.accountConfigured,
    attemptQueueAccountMatches: attemptQueueReadiness.accountMatches,
    productionScope: "manager_approved_original_transaction",
    payloadRedacted: true,
  }));
  if (readiness.canIssueCardRefund && !refundCase.executionContext) {
    return { ...readiness, canIssueCardRefund: false, blockReason: "transaction_not_confirmed" as const };
  }
  return readiness;
};

const safeNayaxReference = (value: string | null | undefined) =>
  Boolean(value && /^[A-Za-z0-9][A-Za-z0-9._:-]{5,79}$/.test(value));

type NayaxTransactionPreflight = {
  blocks: string[];
  reason: string | null;
  resolutionAction: string | null;
};

const getDuplicateTransactionBlocks = async ({
  refundCase,
  actorUserId,
  expectedCaseVersion,
  executorAssertion,
}: {
  refundCase: RefundCaseForExecution;
  actorUserId: string;
  expectedCaseVersion: number;
  executorAssertion: string | null;
}): Promise<NayaxTransactionPreflight> => {
  if (
    !supabase || !executorAssertion || !refundCase.executionContext ||
    !safeNayaxReference(refundCase.matched_nayax_transaction_id)
  ) return { blocks: [], reason: null, resolutionAction: null };
  const { data, error } = await supabase.rpc(
    "service_get_refund_nayax_transaction_preflight",
    {
      p_executor_assertion: executorAssertion,
      p_actor_user_id: actorUserId,
      p_case_id: refundCase.id,
      p_expected_case_version: expectedCaseVersion,
      p_execution_context_hash: refundCase.executionContext.contextHash,
    },
  );
  if (error || !data || typeof data !== "object") throw error ?? new Error("transaction_preflight_unavailable");
  const result = data as Record<string, unknown>;
  const reason = sanitizeText(result.reason, 80) || null;
  return {
    blocks: result.blocked === true
      ? [reason === "payment_already_confirmed" ? "already_refunded" : "duplicate_transaction"]
      : [],
    reason,
    resolutionAction: sanitizeText(result.resolutionAction, 80) || null,
  };
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
    if (!supabaseUrl || !supabaseAnonKey) {
      return jsonResponse({ error: "Nayax refund execution is not configured." }, 500);
    }
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    });

    const body = await req.json();
    const operation = sanitizeText(body?.operation, 40) || "execute";
    if (
      !new Set(["execute", "availability", "approve_reviewed"]).has(operation)
    ) {
      return jsonResponse({ error: "Unsupported operation." }, 400);
    }

    const executionConfig = resolveNayaxRefundExecutionConfig((name) =>
      Deno.env.get(name)
    );
    const requestedCaseId = sanitizeText(body?.caseId, 80);
    if (operation === "availability" && !requestedCaseId) {
      return jsonResponse(resolveNayaxRefundAvailability({
        executionConfig,
        officialActionsEnabled: NAYAX_REFUND_OFFICIAL_ACTIONS_ENABLED,
      }));
    }

    const caseId = requestedCaseId;
    if (!isUuid(caseId)) {
      return jsonResponse({ error: "Refund case is required." }, 400);
    }

    const refundCase = await getRefundCase(caseId);
    if (!refundCase) {
      return jsonResponse({ error: "Refund case not found." }, 404);
    }
    const { data: actorCanViewCaseStatus, error: accessError } =
      await userClient.rpc(
        "can_manage_refund_case_current_user",
        { p_refund_case_id: refundCase.id },
      );
    if (accessError) throw accessError;
    if (!actorCanViewCaseStatus) {
      if (operation === "availability") {
        return jsonResponse({
          available: false,
          status: "unavailable",
          blockReason: "unauthorized",
          caseId,
          transactionConfirmed: refundCase.matched_nayax_transaction_id !== null,
          canIssueCardRefund: false,
          refundAmountCents: refundCase.matched_nayax_amount_cents,
          machineLimitCents: null,
          caseVersion: refundCase.official_action_version,
          payloadRedacted: true,
        });
      }
      return jsonResponse({
        executed: false,
        status: "preflight_blocked",
        errorCode: "authorization_failed",
        blocks: ["authorization_failed"],
      }, 403);
    }

    // A lost response must be readable after the protected attempt succeeds:
    // the general fresh-action capability intentionally closes on a receipt.
    // This RPC separately requires the same authenticated actor, current
    // machine mapping and immutable final-decision receipt before replaying.
    if (operation === "approve_reviewed") {
      const decision = parseReviewedFinalDecisionRequest(body);
      if (!decision) {
        return jsonResponse({
          approved: false,
          status: "preflight_blocked",
          errorCode: "reviewed_decision_context_missing",
          providerAttempted: false,
          customerCompletionAttempted: false,
          payloadRedacted: true,
        }, 409);
      }
      // The authenticated SQL writer rechecks the completed lookup, current
      // candidate set, Manager mapping, case/fact version and existing effects
      // under one lock. It queues the already-supported protected attempt but
      // never contacts Nayax or sends a customer message in this request.
      const { data, error } = await userClient.rpc(
        "admin_approve_reviewed_nayax_candidate_v1",
        {
          p_case_id: refundCase.id,
          p_expected_case_version: decision.expectedOfficialActionVersion,
          p_preparation_proof_id: decision.preparationProofId,
          p_candidate_token: decision.candidateToken,
        },
      );
      const result = !error
        ? parseReviewedFinalDecisionReceipt(data, refundCase.id)
        : null;
      if (!result) {
        return jsonResponse({
          approved: false,
          status: "preflight_blocked",
          errorCode: error?.code === "42501"
            ? "authorization_failed"
            : "reviewed_decision_changed",
          providerAttempted: false,
          customerCompletionAttempted: false,
          payloadRedacted: true,
        }, error?.code === "42501" ? 403 : 409);
      }
      return jsonResponse({
        approved: true,
        executed: false,
        status: result.status,
        replayed: result.replayed,
        providerAttempted: false,
        customerCompletionAttempted: false,
        message: result.status === "completed"
          ? "The approved refund is complete. No second payment was attempted."
          : result.status === "provider_hold"
          ? "The earlier refund result needs reconciliation. Do not try it again."
          : "One reviewed purchase was approved. Bloomjoy is finishing the protected refund automatically.",
        payloadRedacted: true,
      }, result.status === "completed" ? 200 : 202);
    }

    if (
      operation === "execute" && refundCase.payment_method === "card" &&
      refundCase.status === "card_refund_pending" &&
      refundCase.decision === "approved"
    ) {
      const { data: approvedReadState, error: approvedReadStateError } =
        await supabase.rpc("refund_nayax_approved_card_read_state_v1", {
          p_case_id: refundCase.id,
        });
      if (approvedReadStateError) throw approvedReadStateError;
      if (approvedReadState === "provider_hold") {
        return jsonResponse({
          executed: false,
          status: "provider_hold",
          errorCode: "provider_outcome_requires_reconciliation",
          providerAttempted: false,
          customerCompletionAttempted: false,
          message:
            "The refund result is unknown. Do not retry it. Check this exact transaction in Nayax and record what happened.",
          payloadRedacted: true,
        }, 409);
      }
      return jsonResponse({
        executed: false,
        status: "system_finishing",
        errorCode: null,
        providerAttempted: false,
        customerCompletionAttempted: false,
        message:
          "System is finishing this approved refund. No action is needed. Do not try the refund again.",
        payloadRedacted: true,
      }, 202);
    }

    const { data: actorCanPerformOfficialAction, error: authorityError } =
      await supabase.rpc(
        "can_perform_refund_official_action",
        { p_user_id: user.id, p_refund_case_id: refundCase.id },
      );
    if (authorityError) throw authorityError;
    if (!actorCanPerformOfficialAction) {
      if (operation === "availability") {
        return jsonResponse({
          available: false,
          status: "unavailable",
          blockReason: "unauthorized",
          caseId,
          transactionConfirmed: refundCase.matched_nayax_transaction_id !== null,
          canIssueCardRefund: false,
          refundAmountCents: refundCase.matched_nayax_amount_cents,
          machineLimitCents: null,
          caseVersion: refundCase.official_action_version,
          payloadRedacted: true,
        });
      }
      return jsonResponse({
        executed: false,
        status: "preflight_blocked",
        errorCode: "authorization_failed",
        blocks: ["authorization_failed"],
      }, 403);
    }

    if (refundCase.case_population === "internal_test") {
      if (operation === "availability") {
        return jsonResponse({
          available: false,
          status: "unavailable",
          blockReason: "case_not_refundable",
          caseId,
          transactionConfirmed: false,
          canIssueCardRefund: false,
          refundAmountCents: null,
          machineLimitCents: null,
          caseVersion: refundCase.official_action_version,
          payloadRedacted: true,
        });
      }
      return jsonResponse({
        executed: false,
        status: "preflight_blocked",
        errorCode: "internal_test_refund_suppressed",
        blocks: ["case_not_refundable"],
      }, 409);
    }

    const managerContract = parseConfiguredManagerContract();
    if (executionConfig.executorAssertion) {
      const { data: verificationData, error: verificationError } = await supabase.rpc(
        "service_get_refund_nayax_execution_context_v3", {
          p_executor_assertion: executionConfig.executorAssertion,
          p_actor_user_id: user.id, p_case_id: refundCase.id,
          p_serialization_mode:
            managerContract?.machineAuthorizationTimeMode ??
              "exact_source",
          p_refund_email_list_mode: managerContract?.refundEmailListMode ?? "omit",
        },
      );
      if (!verificationError) {
        refundCase.executionContext = parseNayaxRefundExecutionContext(verificationData, {
          caseId: refundCase.id, caseVersion: refundCase.official_action_version,
          attemptGeneration: refundCase.nayax_refund_attempt_generation,
          transactionId: refundCase.matched_nayax_transaction_id,
          siteId: refundCase.matched_nayax_site_id, amountCents: refundCase.matched_nayax_amount_cents,
          accountScope: refundCase.reporting_machines?.nayax_account_key ?? null,
          providerMachineId: refundCase.reporting_machines?.nayax_machine_id ?? null,
          machineAuthorizationInstant:
            refundCase.matched_nayax_machine_auth_time,
        });
      }
    }

    if (operation === "availability") {
      const readiness = await resolveCaseRefundReadiness({
        refundCase,
        actorUserId: user.id,
        executionConfig: executionConfig,
      });
      const transactionPreflight = await getDuplicateTransactionBlocks({
        refundCase,
        actorUserId: user.id,
        expectedCaseVersion: refundCase.official_action_version,
        executorAssertion: executionConfig.executorAssertion,
      });
      const exactTransactionBlocked = transactionPreflight.blocks.length > 0;
      return jsonResponse({
        available: readiness.canIssueCardRefund && !exactTransactionBlocked,
        status: readiness.canIssueCardRefund && !exactTransactionBlocked
          ? "available"
          : "unavailable",
        caseId,
        ...readiness,
        canIssueCardRefund: readiness.canIssueCardRefund && !exactTransactionBlocked,
        blockReason: exactTransactionBlocked
          ? transactionPreflight.blocks[0]
          : readiness.blockReason,
        conflictReason: transactionPreflight.reason,
        resolutionAction: transactionPreflight.resolutionAction,
        payloadRedacted: true,
      });
    }
    const expectedOfficialActionVersion = Number(body?.expectedOfficialActionVersion);
    if (!Number.isSafeInteger(expectedOfficialActionVersion) ||
      expectedOfficialActionVersion <= 0) {
      return jsonResponse({
        executed: false,
        status: "preflight_blocked",
        errorCode: "case_version_missing",
        providerAttempted: false,
        customerCompletionAttempted: false,
      }, 409);
    }
    const executionReadiness = await resolveCaseRefundReadiness({
      refundCase,
      actorUserId: user.id,
      executionConfig,
    });
    const executionTransactionPreflight = await getDuplicateTransactionBlocks({
      refundCase,
      actorUserId: user.id,
      expectedCaseVersion: expectedOfficialActionVersion,
      executorAssertion: executionConfig.executorAssertion,
    });
    const executionBlockReason = executionTransactionPreflight.blocks[0] ??
      executionReadiness.blockReason;
    if (!executionReadiness.canIssueCardRefund || executionBlockReason) {
      return jsonResponse({
        executed: false,
        status: "preflight_blocked",
        errorCode: executionBlockReason ?? "provider_unavailable",
        blocks: [executionBlockReason ?? "provider_unavailable"],
        conflictReason: executionTransactionPreflight.reason,
        resolutionAction: executionTransactionPreflight.resolutionAction,
        providerAttempted: false,
        customerCompletionAttempted: false,
        payloadRedacted: true,
      }, 409);
    }
    if (!supabaseAnonKey) {
      throw new Error("authenticated_refund_approval_not_configured");
    }

    const actorSupabase = createClient(supabaseUrl!, supabaseAnonKey, {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
      auth: { persistSession: false },
    });
    const { data: approvalData, error: approvalError } = await actorSupabase.rpc(
      "admin_approve_selected_nayax_refund_for_system_v1",
      {
        p_case_id: refundCase.id,
        p_expected_case_version: expectedOfficialActionVersion,
      },
    );
    const approval = !approvalError && approvalData &&
        typeof approvalData === "object"
      ? approvalData as Record<string, unknown>
      : null;
    if (!approval || approval.approved !== true ||
      approval.status !== "system_finishing" ||
      approval.providerCallMade !== false ||
      approval.customerMessageCreated !== false ||
      approval.payloadRedacted !== true) {
      return jsonResponse({
        executed: false,
        status: "preflight_blocked",
        errorCode: approvalError?.code === "42501"
          ? "authorization_failed"
          : "approval_not_recorded",
        providerAttempted: false,
        customerCompletionAttempted: false,
        message: approvalError?.code === "42501"
          ? "Only the assigned machine Manager or a Super-admin can approve this refund."
          : "The approval was not saved. Reload the case and try again.",
        payloadRedacted: true,
      }, approvalError?.code === "42501" ? 403 : 409);
    }

    return jsonResponse({
      executed: false,
      approved: true,
      status: "system_finishing",
      errorCode: null,
      providerAttempted: false,
      customerCompletionAttempted: false,
      message:
        "Refund approved. Bloomjoy is finishing it automatically. Do not try it again.",
      payloadRedacted: true,
    }, 202);
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
