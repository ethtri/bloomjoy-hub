import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.1";
import { resolveSupabaseAccessToken } from "../_shared/auth.ts";
import { parseNayaxRefundExecutionContext } from "../_shared/nayax-refund-context.ts";
import { corsHeaders } from "../_shared/cors.ts";
import {
  authorizeRefundOfficialAction,
  RefundOfficialActionAuthorizationError,
} from "../_shared/refund-official-action.ts";
import {
  buildNayaxRefundIdempotencyKey,
  NAYAX_REFUND_OFFICIAL_ACTIONS_ENABLED,
  resolveNormalNayaxRefundAmountCents,
  resolveNayaxRefundAvailability,
  resolveNayaxRefundExecutionConfig,
} from "../_shared/nayax-refund-gates.ts";
import {
  type NayaxAttemptReservation,
  type NayaxAttemptSettlement,
  type NayaxCompletionDelivery,
  orchestrateNayaxRefund,
} from "../_shared/nayax-refund-orchestration.ts";
// @deno-types="../_shared/nayax-refund-provider.d.ts"
import {
  areNayaxRefundWriteCredentialsReady,
  buildRedactedNayaxStageDigest,
  createNayaxRefundProviderAdapter,
  executeNayaxRefundApprovalOnly,
  mapNayaxRefundExecutionOutcome,
  NAYAX_REFUND_PRODUCTION_BASE_URL,
  type NayaxControlledPilotStageEvent,
  parseNayaxRefundApprovalContract,
  parseNayaxRefundProviderContract,
} from "../_shared/nayax-refund-provider.mjs";
import { dispatchRefundCaseGmailReply } from "../_shared/refund-gmail-transport.ts";
import { RefundGmailError } from "../_shared/refund-gmail.ts";
import { deliverNayaxCompletionOnce } from "../_shared/nayax-resolution-completion.ts";
import { buildRefundStoredTextWithStatus } from "../_shared/refund-email.ts";
import { tryIssueRefundStatusCapabilityForMessage } from "../_shared/refund-status-capability.ts";
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
// Journal v3 cannot authorize a standalone approval from legacy incomplete
// response evidence. Keep the historical operation fail-closed until a new
// recovery contract can prove the original request outcome authoritatively.
const NAYAX_REFUND_PENDING_APPROVAL_RECOVERY_SUPPORTED = false;

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

const normalizeAccountKey = (value: string) =>
  value.trim().toUpperCase().replace(/[^A-Z0-9_]/g, "_");

const exactEnvFlag = (name: string) =>
  Deno.env.get(name)?.trim().toLowerCase() === "true";

const resolveNormalWriteCredentials = (accountKey: string) => ({
  requestToken: accountKey
    ? Deno.env.get(`NAYAX_REFUND_REQUEST_WRITE_TOKEN_${accountKey}`)?.trim() ?? ""
    : "",
  approveToken: accountKey
    ? Deno.env.get(`NAYAX_REFUND_APPROVE_WRITE_TOKEN_${accountKey}`)?.trim() ?? ""
    : "",
});

const parseConfiguredManagerContract = () => {
  const raw = Deno.env.get("NAYAX_REFUND_MANAGER_CONTRACT_JSON")?.trim() ?? "";
  if (!raw) return null;
  try {
    return parseNayaxRefundProviderContract(raw);
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
    supported.includes(providerContractVersion) &&
    capability.providerContractConfirmationRequired === true &&
    capability.payloadRedacted === true;
};

const securePilotAssertion = (value: string | undefined) => {
  const normalized = value?.trim() ?? "";
  return /^[A-Za-z0-9_-]{32,200}$/.test(normalized) ? normalized : null;
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

  const accountKey = normalizeAccountKey(
    refundCase.reporting_machines?.nayax_account_key ?? "",
  );
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
    officialActionsEnabled: NAYAX_REFUND_OFFICIAL_ACTIONS_ENABLED,
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

const resolveRefundAmountCents = (refundCase: RefundCaseForExecution) =>
  resolveNormalNayaxRefundAmountCents({
    matchedTransactionAmountCents: refundCase.matched_nayax_amount_cents,
  }) ?? 0;

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
  if (!refundCase.executionContext) blocks.push("transaction_not_confirmed");

  if (!actorCanManageCase) blocks.push("authorization_failed");
  if (
    !new Set([
      "needs_review",
      "correlated",
      "approved",
      "card_refund_pending",
    ]).has(refundCase.status)
  ) {
    blocks.push("validation_rejected");
  }
  if (refundCase.decision !== null && refundCase.decision !== "approved") {
    blocks.push("validation_rejected");
  }
  if (refundCase.payment_method !== "card") blocks.push("validation_rejected");
  if (refundCase.correlation_status !== "matched") {
    blocks.push("validation_rejected");
  }
  if (refundCase.correlation_source !== "nayax") {
    blocks.push("validation_rejected");
  }
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
  if (refundCase.matched_nayax_amount_cents !== amountCents) {
    blocks.push("validation_rejected");
  }
  if (refundCase.reporting_adjustment_id) blocks.push("already_refunded");
  if (!machine || machine.status !== "active") {
    blocks.push("configuration_missing");
  }
  if (!machine?.nayax_machine_id) blocks.push("configuration_missing");
  if (!machine?.nayax_refunds_enabled) blocks.push("feature_disabled");

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
    const operation = sanitizeText(body?.operation, 40) || "execute";
    if (
      !new Set([
        "execute",
        "availability",
        // Preserve the retired forensic route so a legacy pending request
        // receives its explicit fail-closed recovery result instead of being
        // mistaken for an unknown operation. The support flag and revoked RPC
        // grants below still prevent any provider write.
        "approve_pending_request",
      ]).has(operation)
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
    const { data: actorCanPerformOfficialAction, error: accessError } =
      await supabase.rpc(
        "can_perform_refund_official_action",
        { p_user_id: user.id, p_refund_case_id: refundCase.id },
      );
    if (accessError) throw accessError;
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

    if (operation !== "approve_pending_request" && executionConfig.executorAssertion) {
      const { data: verificationData, error: verificationError } = await supabase.rpc(
        "service_get_refund_nayax_execution_context", {
          p_executor_assertion: executionConfig.executorAssertion,
          p_actor_user_id: user.id, p_case_id: refundCase.id,
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
        });
      }
    }

    if (operation === "availability") {
      const readiness = await resolveCaseRefundReadiness({
        refundCase,
        actorUserId: user.id,
        executionConfig: executionConfig,
      });
      return jsonResponse({
        available: readiness.canIssueCardRefund,
        status: readiness.canIssueCardRefund ? "available" : "unavailable",
        caseId,
        ...readiness,
        payloadRedacted: true,
      });
    }

    if (operation === "approve_pending_request") {
      const attemptId = sanitizeText(body?.attemptId, 80);
      const evidenceReference = sanitizeText(body?.evidenceReference, 200);
      const expectedOfficialActionVersion = Number(
        body?.expectedOfficialActionVersion,
      );
      const accountKey = normalizeAccountKey(
        refundCase.reporting_machines?.nayax_account_key ?? "",
      );
      const approveToken = accountKey
        ? Deno.env.get(`NAYAX_REFUND_APPROVE_WRITE_TOKEN_${accountKey}`)
          ?.trim() || ""
        : "";
      const managerContract = parseConfiguredManagerContract();
      const rawApprovalContract = Deno.env.get(
        "NAYAX_REFUND_PENDING_APPROVAL_CONTRACT_JSON",
      )?.trim() ?? "";
      let approvalContract:
        | ReturnType<typeof parseNayaxRefundApprovalContract>
        | null = null;
      if (rawApprovalContract) {
        try {
          approvalContract = parseNayaxRefundApprovalContract(
            rawApprovalContract,
          );
        } catch {
          approvalContract = null;
        }
      }
      const recoveryBlocks = [
        !NAYAX_REFUND_PENDING_APPROVAL_RECOVERY_SUPPORTED
          ? "pending_approval_recovery_retired"
          : null,
        !NAYAX_REFUND_OFFICIAL_ACTIONS_ENABLED
          ? "official_actions_disabled"
          : null,
        ...executionConfig.blocks,
        Deno.env.get("NAYAX_REFUND_PENDING_APPROVAL_RECOVERY_ENABLED")?.trim()
            .toLowerCase() !== "true"
          ? "pending_approval_recovery_disabled"
          : null,
        !executionConfig.executorAssertion
          ? "executor_assertion_missing"
          : null,
        !executionConfig.idempotencySecret
          ? "stage_journal_secret_missing"
          : null,
        !isUuid(attemptId) ? "attempt_missing" : null,
        !Number.isSafeInteger(expectedOfficialActionVersion) ||
          expectedOfficialActionVersion < 0
          ? "case_version_missing"
          : null,
        !/^[A-Za-z0-9][A-Za-z0-9._:/-]{5,199}$/.test(evidenceReference)
          ? "dtm_evidence_missing"
          : null,
        !accountKey ? "machine_account_key_missing" : null,
        !approveToken ? "provider_credential_missing" : null,
        !managerContract ? "provider_contract_invalid" : null,
        managerContract &&
            managerContract.contractVersion !==
              NAYAX_REFUND_PROVIDER_CONTRACT_VERSION
          ? "provider_contract_version_invalid"
          : null,
        !rawApprovalContract ? "approval_contract_missing" : null,
        rawApprovalContract && !approvalContract
          ? "approval_contract_invalid"
          : null,
        approvalContract &&
            approvalContract.contractVersion !==
              NAYAX_REFUND_PROVIDER_CONTRACT_VERSION
          ? "approval_contract_version_invalid"
          : null,
        approvalContract &&
          approvalContract.baseUrl !== "https://lynx.nayax.com/operational/v1"
          ? "approval_contract_host_invalid"
          : null,
      ].filter((block): block is string => block !== null);
      if (recoveryBlocks.length > 0) {
        return jsonResponse({
          executed: false,
          status: "preflight_blocked",
          errorCode: "pending_approval_recovery_not_ready",
          blocks: recoveryBlocks,
          providerAttempted: false,
          customerCompletionAttempted: false,
        }, 409);
      }

      const { data: reservationData, error: reservationError } = await supabase
        .rpc(
          "service_reserve_nayax_pending_approval_recovery",
          {
            p_executor_assertion: executionConfig.executorAssertion,
            p_actor_user_id: user.id,
            p_case_id: refundCase.id,
            p_attempt_id: attemptId,
            p_expected_case_version: expectedOfficialActionVersion,
            p_evidence_reference: evidenceReference,
          },
        );
      const reservation = reservationData && typeof reservationData === "object"
        ? reservationData as Record<string, unknown>
        : null;
      const recovery = reservation?.recovery &&
          typeof reservation.recovery === "object"
        ? reservation.recovery as Record<string, unknown>
        : null;
      if (reservationError || !reservation || !recovery) {
        return jsonResponse({
          executed: false,
          status: "preflight_blocked",
          errorCode: "pending_approval_recovery_not_eligible",
          providerAttempted: false,
          customerCompletionAttempted: false,
        }, 409);
      }
      if (recovery.shouldExecute !== true) {
        return jsonResponse({
          executed: false,
          status: sanitizeText(recovery.status, 40) || "provider_hold",
          errorCode: sanitizeText(recovery.errorCode, 80) ||
            "pending_approval_recovery_already_reserved",
          providerAttempted: false,
          replayed: true,
          customerCompletionAttempted: false,
          payloadRedacted: true,
        }, 409);
      }

      const recoveryId = sanitizeText(recovery.recoveryId, 80);
      const providerClaimToken = sanitizeText(
        reservation.providerClaimToken,
        200,
      );
      const evidence = reservation.evidence &&
          typeof reservation.evidence === "object"
        ? reservation.evidence as Record<string, unknown>
        : null;
      if (
        !isUuid(recoveryId) || providerClaimToken.length < 43 || !evidence ||
        evidence.caseId !== refundCase.id ||
        evidence.transactionId !== refundCase.matched_nayax_transaction_id ||
        evidence.siteId !== refundCase.matched_nayax_site_id ||
        evidence.machineAuthorizationTime !==
          refundCase.matched_nayax_machine_auth_time
      ) {
        throw new Error("pending_approval_recovery_reservation_invalid");
      }

      const onStageEvent = async (
        stageEvent: NayaxControlledPilotStageEvent,
      ) => {
        const result = "result" in stageEvent
          ? stageEvent.result as unknown as Record<string, unknown>
          : {};
        const classificationDigest = await buildRedactedNayaxStageDigest({
          journalSecret: executionConfig.idempotencySecret!,
          attemptId,
          contractVersion: approvalContract!.contractVersion,
          stageEvent,
        });
        const { data, error } = await supabase.rpc(
          "service_record_nayax_refund_provider_stage",
          {
            p_executor_assertion: executionConfig.executorAssertion,
            p_attempt_id: attemptId,
            p_pending_approval_recovery_id: recoveryId,
            p_provider_claim_token: providerClaimToken,
            p_stage: stageEvent.stage,
            p_event: stageEvent.event,
            p_http_status: Number.isInteger(result.httpStatus)
              ? result.httpStatus
              : null,
            p_outcome: sanitizeText(result.outcome, 40) || null,
            p_contract_matched: stageEvent.event === "result"
              ? result.contractMatched === true
              : null,
            p_failure_type: sanitizeText(result.failureType, 20) || null,
            p_classification_digest: classificationDigest,
          },
        );
        if (error || !data || typeof data !== "object") {
          throw new Error("pending_approval_recovery_stage_journal_failed");
        }
      };

      let providerOutcome: Awaited<
        ReturnType<typeof mapNayaxRefundExecutionOutcome>
      >;
      try {
        const providerResult = await executeNayaxRefundApprovalOnly({
          contract: approvalContract!,
          approveToken,
          transactionId: String(evidence.transactionId ?? ""),
          siteId: Number(evidence.siteId),
          machineAuthorizationTime: String(
            evidence.machineAuthorizationTime ?? "",
          ),
          onStageEvent,
        });
        const recoveryIdempotencyKey = `nayax-refund-${await sha256Hex(
          `pending-approval-recovery-v1|${recoveryId}`,
        )}`;
        providerOutcome = await mapNayaxRefundExecutionOutcome(
          providerResult,
          approvalContract!.contractVersion,
          recoveryIdempotencyKey,
        );
      } catch {
        providerOutcome = {
          kind: "unknown",
          providerReference: null,
          providerStatus: null,
          errorCode: "provider_stage_or_transport_unknown",
        };
      }

      const { data: settlementData, error: settlementError } = await supabase
        .rpc(
          "service_settle_nayax_pending_approval_recovery",
          {
            p_executor_assertion: executionConfig.executorAssertion,
            p_recovery_id: recoveryId,
            p_attempt_id: attemptId,
            p_case_id: refundCase.id,
            p_provider_claim_token: providerClaimToken,
            p_provider_outcome: providerOutcome.kind,
            p_provider_reference: providerOutcome.providerReference ?? null,
            p_provider_status: providerOutcome.providerStatus ?? null,
            p_error_code: providerOutcome.errorCode ?? null,
          },
        );
      if (
        settlementError || !settlementData || typeof settlementData !== "object"
      ) {
        throw new Error("pending_approval_recovery_requires_reconciliation");
      }
      const approvalAccepted = providerOutcome.kind === "success";
      return jsonResponse({
        executed: false,
        approvalAccepted,
        status: approvalAccepted
          ? "awaiting_dtm_confirmation"
          : "provider_hold",
        errorCode: approvalAccepted ? null : providerOutcome.errorCode ??
          "pending_approval_recovery_unknown",
        providerAttempted: true,
        reconciliationRequired: true,
        fallbackIssued: false,
        customerCompletionAttempted: false,
        payloadRedacted: true,
      }, approvalAccepted ? 202 : 409);
    }

    const preflightBlocks = getPreflightBlocks({
      refundCase,
      actorCanManageCase: true,
    });
    const duplicateTransactionBlocks = await getDuplicateTransactionBlocks(
      refundCase,
    );

    if (operation === "controlled_owner_pilot") {
      const suppliedRunnerAssertion = securePilotAssertion(
        req.headers.get("x-bloomjoy-nayax-pilot-assertion") ?? undefined,
      );
      const configuredRunnerAssertion = securePilotAssertion(
        Deno.env.get("NAYAX_REFUND_CONTROLLED_PILOT_RUNNER_ASSERTION"),
      );
      const pilotAuthorizationId = sanitizeText(
        body?.pilotAuthorizationId,
        80,
      );
      const amountCents = refundCase.payment_amount_cents ?? 0;
      const machine = refundCase.reporting_machines;
      const accountKey = normalizeAccountKey(machine?.nayax_account_key ?? "");
      const rawContract = Deno.env.get(
        "NAYAX_REFUND_CONTROLLED_PILOT_CONTRACT_JSON",
      )?.trim() ?? "";
      let parsedPilotContract:
        | ReturnType<typeof parseNayaxRefundProviderContract>
        | null = null;
      if (rawContract) {
        try {
          parsedPilotContract = parseNayaxRefundProviderContract(rawContract);
        } catch {
          parsedPilotContract = null;
        }
      }
      const requestWriteToken = accountKey
        ? Deno.env.get(`NAYAX_REFUND_REQUEST_WRITE_TOKEN_${accountKey}`)
          ?.trim() ?? ""
        : "";
      const approveWriteToken = accountKey
        ? Deno.env.get(`NAYAX_REFUND_APPROVE_WRITE_TOKEN_${accountKey}`)
          ?.trim() ?? ""
        : "";
      const pilotCandidateBlocks = [
        refundCase.status !== "correlated" || refundCase.decision !== null
          ? "pilot_case_not_correlated"
          : null,
        refundCase.payment_method !== "card" || refundCase.card_wallet_used
          ? "pilot_payment_not_exact_card"
          : null,
        refundCase.correlation_status !== "matched" ||
          refundCase.correlation_source !== "nayax" ||
          refundCase.nayax_recommendation_state !== "high_confidence" ||
          !refundCase.nayax_match_execution_eligible
          ? "pilot_match_not_execution_eligible"
          : null,
        !/^[1-9][0-9]{0,18}$/.test(
            refundCase.matched_nayax_transaction_id ?? "",
          ) ||
          refundCase.matched_nayax_site_id === null ||
          !refundCase.matched_nayax_machine_auth_time ||
          refundCase.matched_nayax_currency_code !== "USD" ||
          amountCents <= 0 ||
          refundCase.matched_nayax_amount_cents !== amountCents
          ? "pilot_transaction_evidence_invalid"
          : null,
        refundCase.reporting_adjustment_id ? "pilot_already_refunded" : null,
        !machine || machine.status !== "active" ||
          machine.nayax_refunds_enabled !== true ||
          machine.nayax_refund_max_amount_cents !== amountCents
          ? "pilot_machine_not_exactly_armed"
          : null,
      ];

      const pilotBlocks = [
        NAYAX_REFUND_OFFICIAL_ACTIONS_ENABLED
          ? "global_official_actions_not_closed"
          : null,
        executionConfig.executionEnabled ? "global_execution_not_closed" : null,
        !executionConfig.dryRun ? "global_dry_run_not_closed" : null,
        !executionConfig.killSwitchActive
          ? "global_kill_switch_not_closed"
          : null,
        // The broad production confirmations remain false. Exact sponsor and
        // written-contract evidence is bound to the one database authorization
        // by private SHA-256 digests instead of enabling shared provider gates.
        "controlled_pilot_retired",
        !executionConfig.idempotencySecret
          ? "idempotency_secret_missing"
          : null,
        !executionConfig.executorAssertion
          ? "executor_assertion_missing"
          : null,
        !suppliedRunnerAssertion || !configuredRunnerAssertion
          ? "runner_assertion_missing"
          : null,
        !isUuid(pilotAuthorizationId) ? "pilot_authorization_missing" : null,
        !rawContract ? "provider_contract_missing" : null,
        rawContract && !parsedPilotContract
          ? "provider_contract_invalid"
          : null,
        parsedPilotContract &&
          parsedPilotContract.baseUrl !== "https://lynx.nayax.com/operational/v1"
          ? "provider_contract_host_invalid"
          : null,
        !requestWriteToken ? "request_write_credential_missing" : null,
        !approveWriteToken ? "approve_write_credential_missing" : null,
        !accountKey ? "machine_account_key_missing" : null,
        ...pilotCandidateBlocks,
        ...duplicateTransactionBlocks,
      ].filter((block): block is string => block !== null);
      if (
        suppliedRunnerAssertion && configuredRunnerAssertion &&
        await sha256Hex(suppliedRunnerAssertion) !==
          await sha256Hex(configuredRunnerAssertion)
      ) {
        pilotBlocks.push("runner_assertion_invalid");
      }
      if (pilotBlocks.length > 0) {
        return jsonResponse({
          executed: false,
          status: "preflight_blocked",
          errorCode: "controlled_pilot_not_ready",
          blocks: Array.from(new Set(pilotBlocks)),
          providerAttempted: false,
          customerCompletionAttempted: false,
        }, 409);
      }

      const runnerAssertionDigest = await sha256Hex(suppliedRunnerAssertion!);
      const contractDigest = await sha256Hex(rawContract);
      const { data: postArmData, error: postArmError } = await supabase.rpc(
        "service_validate_nayax_controlled_pilot_postarm",
        {
          p_executor_assertion: executionConfig.executorAssertion,
          p_pilot_authorization_id: pilotAuthorizationId,
          p_case_id: refundCase.id,
          p_amount_cents: amountCents,
          p_runner_assertion_digest: runnerAssertionDigest,
          p_contract_digest: contractDigest,
        },
      );
      const postArm = postArmData as Record<string, unknown> | null;
      if (
        postArmError || postArm?.ready !== true ||
        postArm?.authorizationBound !== true ||
        postArm?.machineArmed !== true || postArm?.amountCapExact !== true ||
        postArm?.payloadRedacted !== true
      ) {
        return jsonResponse({
          executed: false,
          status: "preflight_blocked",
          errorCode: "controlled_pilot_not_ready",
          blocks: ["pilot_postarm_authorization_invalid"],
          providerAttempted: false,
          customerCompletionAttempted: false,
        }, 409);
      }

      // Parse the exact contract, both dedicated write credentials, and the
      // immutable provider evidence before TOTP consumption or reservation.
      // The callback is installed now but cannot run until the attempt handle
      // is filled after the atomic database reservation.
      let pilotAttemptId = "";
      const workerLeaseId = crypto.randomUUID();
      const provider = createNayaxRefundProviderAdapter({
        contract: rawContract,
        requestToken: requestWriteToken,
        approveToken: approveWriteToken,
        evidence: {
          caseId: refundCase.id,
          amountCents,
          currencyCode: "USD",
          transactionId: refundCase.matched_nayax_transaction_id,
          siteId: refundCase.matched_nayax_site_id,
          machineAuthorizationTime: refundCase.matched_nayax_machine_auth_time,
        },
        onStageEvent: async (stageEvent) => {
          if (!isUuid(pilotAttemptId)) {
            throw new Error("controlled_pilot_attempt_not_reserved");
          }
          const result = "result" in stageEvent &&
              stageEvent.result && typeof stageEvent.result === "object"
            ? stageEvent.result as unknown as Record<string, unknown>
            : {};
          const stage = sanitizeText(stageEvent.stage, 20);
          const event = sanitizeText(stageEvent.event, 20);
          const outcome = sanitizeText(result.outcome, 40) || null;
          const failureType = sanitizeText(result.failureType, 20) || null;
          const contractMatched = result.contractMatched === true;
          const responseClass = failureType
            ? `transport_${failureType}`
            : Number.isInteger(result.httpStatus) &&
                Number(result.httpStatus) >= 200 &&
                Number(result.httpStatus) < 300
            ? "http_success"
            : "http_failure";
          const classificationDigest = "result" in stageEvent
            ? await sha256Hex([
              "controlled-pilot-provider-classification-v1",
              stage,
              outcome ?? "none",
              Number.isInteger(result.httpStatus)
                ? String(result.httpStatus)
                : "none",
              contractMatched ? "contract_match" : "contract_mismatch",
              responseClass,
            ].join("|"))
            : null;
          const { data, error } = await supabase.rpc(
            "service_record_nayax_controlled_pilot_stage",
            {
              p_executor_assertion: executionConfig.executorAssertion,
              p_pilot_authorization_id: pilotAuthorizationId,
              p_attempt_id: pilotAttemptId,
              p_worker_lease_id: workerLeaseId,
              p_stage_event: `${stage}_${event}`,
              p_outcome: outcome,
              p_http_status: Number.isInteger(result.httpStatus)
                ? result.httpStatus
                : null,
              p_provider_result: "result" in stageEvent
                ? contractMatched ? "contract_match" : "contract_mismatch"
                : null,
              p_provider_status: "result" in stageEvent ? responseClass : null,
              p_failure_type: failureType,
              p_contract_matched: "result" in stageEvent
                ? contractMatched
                : null,
              p_classification_digest: classificationDigest,
            },
          );
          if (error || !data || typeof data !== "object") {
            throw new Error("controlled_pilot_stage_journal_failed");
          }
        },
      });

      const idempotencyKey = await buildNayaxRefundIdempotencyKey(
        executionConfig.idempotencySecret,
        {
          caseId: refundCase.id,
          attemptGeneration: refundCase.nayax_refund_attempt_generation,
          transactionId: refundCase.matched_nayax_transaction_id!,
          siteId: refundCase.matched_nayax_site_id!,
          machineAuthorizationTime: refundCase.matched_nayax_machine_auth_time!,
          amountCents,
          currencyCode: "USD",
        },
      );
      const expectedOfficialActionVersion = Number(
        body?.expectedOfficialActionVersion,
      );
      const stepUpIntentId = sanitizeText(body?.stepUpIntentId, 80) || null;
      const stepUpFactorProof = sanitizeText(body?.stepUpFactorProof, 80) ||
        null;
      const authorization = await authorizeRefundOfficialAction({
        supabaseUrl,
        supabaseAnonKey,
        accessToken,
        context: {
          caseId: refundCase.id,
          action: "nayax_execute",
          targetFunction: "nayax-card-refund",
          pilotAuthorizationId,
          pilotExecutorAssertion: executionConfig.executorAssertion,
          pilotRunnerAssertionDigest: runnerAssertionDigest,
          pilotContractDigest: contractDigest,
          pilotIdempotencyKey: idempotencyKey,
          pilotWorkerLeaseId: workerLeaseId,
          stepUpIntentId,
          stepUpFactorProof,
          expectedCaseVersion: expectedOfficialActionVersion,
          targetStatus: "card_refund_pending",
          targetDecision: "approved",
          refundAmountCents: amountCents,
        },
      });
      const reservation = authorization.pilotReservation as
        | NayaxAttemptReservation
        | undefined;
      if (!reservation) throw new Error("controlled_pilot_reservation_failed");
      const attemptId = reservation.attempt?.attemptId ?? "";
      const providerClaimToken = reservation.providerClaimToken ?? "";
      if (!isUuid(attemptId) || providerClaimToken.length < 43) {
        throw new Error("controlled_pilot_reservation_invalid");
      }
      pilotAttemptId = attemptId;

      let providerOutcome;
      try {
        providerOutcome = await provider.execute({
          caseId: refundCase.id,
          idempotencyKey,
          amountCents,
          currencyCode: "USD",
        });
      } catch {
        providerOutcome = {
          kind: "unknown",
          providerReference: null,
          providerStatus: null,
          errorCode: "provider_stage_or_transport_unknown",
        };
      }

      const { data: settlementData, error: settlementError } = await supabase
        .rpc(
          "service_settle_nayax_controlled_pilot_attempt",
          {
            p_executor_assertion: executionConfig.executorAssertion,
            p_pilot_authorization_id: pilotAuthorizationId,
            p_attempt_id: attemptId,
            p_authorization_id: authorization.authorizationId,
            p_case_id: refundCase.id,
            p_idempotency_key: idempotencyKey,
            p_amount_cents: amountCents,
            p_currency_code: "USD",
            p_provider_claim_token: providerClaimToken,
            p_provider_outcome: providerOutcome.kind,
            p_worker_lease_id: workerLeaseId,
            p_evidence_reference: providerOutcome.providerReference ?? null,
            p_provider_status: providerOutcome.providerStatus ?? null,
            p_error_code: providerOutcome.errorCode ?? null,
          },
        );
      if (
        settlementError || !settlementData || typeof settlementData !== "object"
      ) {
        throw new Error("controlled_pilot_settlement_requires_reconciliation");
      }
      const settlement = settlementData as NayaxAttemptSettlement & {
        pilotProviderOnly?: boolean;
      };
      const succeeded = settlement.attempt?.providerOutcome === "success" &&
        settlement.attempt?.status === "succeeded" &&
        settlement.reportingAdjustmentPresent === true;
      return jsonResponse({
        executed: succeeded,
        status: succeeded
          ? "succeeded"
          : settlement.attempt?.status ?? "provider_hold",
        errorCode: succeeded
          ? null
          : providerOutcome.errorCode ?? "provider_hold",
        providerAttempted: true,
        reconciliationRequired: !succeeded &&
          settlement.attempt?.providerOutcome !== "rejected",
        fallbackIssued: false,
        providerOnly: true,
        customerCompletionAttempted: false,
        payloadRedacted: true,
      }, succeeded ? 200 : 409);
    }

    const normalAccountKey = normalizeAccountKey(
      refundCase.reporting_machines?.nayax_account_key ?? "",
    );
    const normalWriteCredentials = resolveNormalWriteCredentials(
      normalAccountKey,
    );
    const managerContract = parseConfiguredManagerContract();
    const normalCredentialsPresent = Boolean(
      normalWriteCredentials.requestToken && normalWriteCredentials.approveToken,
    );
    const normalCredentialsValid = Boolean(
      managerContract && normalCredentialsPresent &&
        areNayaxRefundWriteCredentialsReady({
          contract: managerContract,
          requestToken: normalWriteCredentials.requestToken,
          approveToken: normalWriteCredentials.approveToken,
        }),
    );
    const journalCompatible = await providerJournalCompatible(
      executionConfig.executorAssertion,
      managerContract?.contractVersion ?? null,
    );
    const preExecutionBlocks = Array.from(
      new Set([
        ...(NAYAX_REFUND_OFFICIAL_ACTIONS_ENABLED
          ? []
          : ["official_actions_disabled"]),
        ...preflightBlocks,
        ...duplicateTransactionBlocks,
        ...executionConfig.blocks,
        ...(!normalAccountKey ? ["machine_account_key_missing"] : []),
        ...(!normalWriteCredentials.requestToken
          ? ["provider_request_credential_missing"]
          : []),
        ...(!normalWriteCredentials.approveToken
          ? ["provider_approval_credential_missing"]
          : []),
        ...(!managerContract
          ? ["provider_contract_invalid"]
          : []),
        ...(managerContract &&
            managerContract.baseUrl !== NAYAX_REFUND_PRODUCTION_BASE_URL
          ? ["provider_contract_host_invalid"]
          : []),
        ...(managerContract && normalCredentialsPresent && !normalCredentialsValid
          ? ["provider_credentials_invalid"]
          : []),
        ...(!journalCompatible ? ["provider_journal_version_mismatch"] : []),
      ]),
    );
    if (preExecutionBlocks.length > 0) {
      const preferredError = preExecutionBlocks.includes("authorization_failed")
        ? "authorization_failed"
        : preExecutionBlocks.includes("official_actions_disabled")
        ? "official_actions_disabled"
        : preExecutionBlocks.includes("already_refunded")
        ? "already_refunded"
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
        : executionConfig.blocks.length > 0 ||
            preExecutionBlocks.includes("machine_account_key_missing") ||
            preExecutionBlocks.includes("provider_request_credential_missing") ||
            preExecutionBlocks.includes("provider_approval_credential_missing") ||
            preExecutionBlocks.includes("provider_journal_version_mismatch")
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
        attemptGeneration: refundCase.nayax_refund_attempt_generation,
        transactionId: refundCase.matched_nayax_transaction_id!,
        siteId: refundCase.matched_nayax_site_id!,
        machineAuthorizationTime: refundCase.executionContext!.machineAuthorizationTime,
        amountCents: resolveRefundAmountCents(refundCase),
        currencyCode: "USD",
      },
    );

    let normalAttemptId = "";
    let normalProviderClaimToken = "";
    const provider = createNayaxRefundProviderAdapter({
      contract: managerContract!,
      requestToken: normalWriteCredentials.requestToken,
      approveToken: normalWriteCredentials.approveToken,
      evidence: {
        caseId: refundCase.id,
        amountCents: resolveRefundAmountCents(refundCase),
        currencyCode: "USD",
        transactionId: refundCase.matched_nayax_transaction_id,
        siteId: refundCase.matched_nayax_site_id,
        machineAuthorizationTime: refundCase.executionContext!.machineAuthorizationTime,
      },
      onStageEvent: async (stageEvent) => {
        if (!isUuid(normalAttemptId) || normalProviderClaimToken.length < 43) {
          throw new Error("normal_refund_attempt_not_reserved");
        }
        const result = "result" in stageEvent && stageEvent.result
          ? stageEvent.result as unknown as Record<string, unknown>
          : {};
        const classificationDigest = await buildRedactedNayaxStageDigest({
          journalSecret: executionConfig.idempotencySecret!,
          attemptId: normalAttemptId,
          contractVersion: managerContract!.contractVersion,
          stageEvent,
        });
        const { data, error } = await supabase.rpc(
          "service_record_nayax_refund_provider_stage_v3",
          {
            p_executor_assertion: executionConfig.executorAssertion,
            p_attempt_id: normalAttemptId,
            p_provider_claim_token: normalProviderClaimToken,
            p_stage: stageEvent.stage,
            p_event: stageEvent.event,
            p_http_status: Number.isInteger(result.httpStatus)
              ? result.httpStatus
              : null,
            p_outcome: sanitizeText(result.outcome, 40) || null,
            p_contract_matched: typeof result.contractMatched === "boolean"
              ? result.contractMatched
              : null,
            p_failure_type: sanitizeText(result.failureType, 20) || null,
            p_classification_digest: classificationDigest,
            p_provider_contract_version: managerContract!.contractVersion,
            p_journal_contract_version: NAYAX_REFUND_JOURNAL_CONTRACT_VERSION,
            p_http_accepted: typeof result.httpAccepted === "boolean"
              ? result.httpAccepted
              : null,
            p_media_type_class: sanitizeText(result.mediaTypeClass, 40) || null,
            p_body_kind: sanitizeText(result.bodyKind, 40) || null,
            p_body_length_bucket:
              sanitizeText(result.bodyLengthBucket, 40) || null,
            p_json_parsed: typeof result.jsonParsed === "boolean"
              ? result.jsonParsed
              : null,
            p_json_object: typeof result.jsonObject === "boolean"
              ? result.jsonObject
              : null,
            p_schema_matched: typeof result.schemaMatched === "boolean"
              ? result.schemaMatched
              : null,
            p_result_key_present:
              typeof result.resultKeyPresent === "boolean"
                ? result.resultKeyPresent
                : null,
            p_status_key_present:
              typeof result.statusKeyPresent === "boolean"
                ? result.statusKeyPresent
                : null,
            p_result_value_type:
              sanitizeText(result.resultValueType, 40) || null,
            p_status_value_type:
              sanitizeText(result.statusValueType, 40) || null,
            p_semantic_pair_matched:
              typeof result.semanticPairMatched === "boolean"
                ? result.semanticPairMatched
                : null,
          },
        );
        if (error || !data || typeof data !== "object") {
          throw new Error(
            error?.code === "P4611"
              ? "provider_journal_version_mismatch"
              : `stage_journal_${stageEvent.stage}_${stageEvent.event}_rejected`,
          );
        }
        const decision = data as Record<string, unknown>;
        if (
          decision.recorded !== true ||
          decision.journalContractVersion !==
            NAYAX_REFUND_JOURNAL_CONTRACT_VERSION ||
          decision.providerContractVersion !== managerContract!.contractVersion ||
          decision.approvalPolicyVersion !==
            NAYAX_REFUND_APPROVAL_POLICY_VERSION ||
          decision.responseEnvelopeVersion !==
            NAYAX_REFUND_RESPONSE_ENVELOPE_VERSION ||
          decision.payloadRedacted !== true
        ) {
          throw new Error("provider_journal_version_mismatch");
        }
        return {
          approvalAuthorized: decision.approvalAuthorized === true,
          approvalPolicyVersion: NAYAX_REFUND_APPROVAL_POLICY_VERSION,
          responseEnvelopeVersion: NAYAX_REFUND_RESPONSE_ENVELOPE_VERSION,
          journalContractVersion: NAYAX_REFUND_JOURNAL_CONTRACT_VERSION,
          providerContractVersion: managerContract!.contractVersion,
          payloadRedacted: true as const,
        };
      },
    });

    const expectedOfficialActionVersion = Number(
      body?.expectedOfficialActionVersion,
    );
    const result = await orchestrateNayaxRefund({
      request: {
        caseId: refundCase.id,
        idempotencyKey,
        amountCents: resolveRefundAmountCents(refundCase),
        currencyCode: "USD",
      },
      dependencies: {
        provider,
        reserveAndConsumeAttempt: async (request) => {
          const { data, error } = await supabase.rpc(
            "service_reserve_nayax_refund_manager_action_v3",
            {
              p_execution_context_hash: refundCase.executionContext!.contextHash,
              p_executor_assertion: executionConfig.executorAssertion,
              p_actor_user_id: user.id,
              p_case_id: request.caseId,
              p_expected_case_version: expectedOfficialActionVersion,
              p_idempotency_key: request.idempotencyKey,
              p_amount_cents: request.amountCents,
              p_daily_amount_cap_cents: null,
              p_daily_count_cap: null,
              p_currency_code: request.currencyCode,
              p_provider_contract_version: managerContract!.contractVersion,
              p_journal_contract_version: NAYAX_REFUND_JOURNAL_CONTRACT_VERSION,
            },
          );
          if (error || !data || typeof data !== "object") {
            throw new Error("Unable to reserve this Nayax refund safely.");
          }
          const reservation = data as NayaxAttemptReservation;
          if (reservation.attempt?.shouldExecute) {
            normalAttemptId = reservation.attempt.attemptId;
            normalProviderClaimToken = reservation.providerClaimToken ?? "";
          }
          return reservation;
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
        deliverCustomerCompletion: async (attemptId) => {
          const { data: claimData, error: claimError } = await supabase.rpc(
            "service_claim_nayax_refund_completion",
            {
              p_executor_assertion: executionConfig.executorAssertion,
              p_attempt_id: attemptId,
            },
          );
          const claim = claimData && typeof claimData === "object"
            ? claimData as Record<string, unknown>
            : null;
          if (
            claimError || !claim ||
            typeof claim.refundCaseId !== "string" ||
            typeof claim.refundCaseMessageId !== "string" ||
            typeof claim.gmailThreadId !== "string" ||
            typeof claim.recipientEmail !== "string" ||
            typeof claim.subject !== "string" ||
            typeof claim.body !== "string" ||
            !isUuid(claim.refundCaseId) ||
            !isUuid(claim.refundCaseMessageId) ||
            !isUuid(claim.gmailThreadId)
          ) {
            throw new Error("Nayax completion message could not be prepared.");
          }

          const messageBody = claim.body;
          return await deliverNayaxCompletionOnce({
            deliver: async () => {
              const statusCapability = await tryIssueRefundStatusCapabilityForMessage({
                supabase,
                refundCaseId: claim.refundCaseId as string,
                refundCaseMessageId: claim.refundCaseMessageId as string,
              });
              const completionEmail = buildRefundStoredTextWithStatus({
                headline: "Your refund is on its way",
                text: messageBody,
                statusUrl: statusCapability?.url ?? null,
              });
              const gmailDelivery = await dispatchRefundCaseGmailReply({
                supabase,
                refundCaseId: claim.refundCaseId as string,
                refundCaseMessageId: claim.refundCaseMessageId as string,
                recipientEmail: claim.recipientEmail as string,
                email: {
                  subject: claim.subject as string,
                  text: completionEmail.text,
                  html: completionEmail.html,
                },
                deliveryKind: "automatic",
                gmailThreadId: claim.gmailThreadId as string,
              });
              return gmailDelivery.usedGmail;
            },
            finish: async (status) => {
              const { data, error } = await supabase.rpc(
                "service_finish_nayax_refund_completion",
                {
                  p_executor_assertion: executionConfig.executorAssertion,
                  p_attempt_id: attemptId,
                  p_delivery_status: status,
                },
              );
              if (error || !data || typeof data !== "object") {
                throw new Error(
                  "Nayax completion status could not be recorded.",
                );
              }
              return data as NayaxCompletionDelivery;
            },
            isDeliveryUncertain: (error) =>
              error instanceof RefundGmailError && error.deliveryUncertain,
          }) as NayaxCompletionDelivery;
        },
      },
    });

    return jsonResponse({
      ...result,
      blocks: executionConfig.blocks,
      dryRun: executionConfig.dryRun,
      killSwitchActive: executionConfig.killSwitchActive,
    }, result.executed ? 200 : 409);
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
