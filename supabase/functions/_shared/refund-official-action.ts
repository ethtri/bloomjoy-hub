import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.1";

export type RefundOfficialAction =
  | "approve"
  | "decline"
  | "cash_complete"
  | "nayax_execute";

export type RefundOfficialActionTarget =
  | "refund-case-admin-update"
  | "nayax-card-refund";

export type RefundOfficialActionContext = {
  caseId: string;
  action: RefundOfficialAction;
  targetFunction: RefundOfficialActionTarget;
  stepUpIntentId?: string | null;
  stepUpFactorProof?: string | null;
  expectedCaseVersion: number;
  targetStatus: string | null;
  targetDecision: string | null;
  assignedManagerEmail?: string | null;
  decisionReason?: string | null;
  internalNote?: string | null;
  refundAmountCents?: number | null;
  manualRefundReference?: string | null;
  cashPayoutSentAt?: string | null;
  cashPaymentConfirmed?: boolean;
  matchedNayaxCandidateToken?: string | null;
  nayaxDisagreementReason?: string | null;
  pilotAuthorizationId?: string | null;
  pilotExecutorAssertion?: string | null;
  pilotRunnerAssertionDigest?: string | null;
  pilotContractDigest?: string | null;
  pilotIdempotencyKey?: string | null;
  pilotWorkerLeaseId?: string | null;
};

export type RefundOfficialActionAuthorization = {
  authorizationId: string;
  action: RefundOfficialAction;
  expectedCaseVersion: number;
  mappingVersion: number;
  expiresAt: string;
  pilotReservation?: {
    attempt?: { attemptId?: string };
    providerClaimToken?: string;
  };
};

export class RefundOfficialActionAuthorizationError extends Error {
  readonly status: number;
  readonly code:
    | "configuration_missing"
    | "mapping_required"
    | "manager_step_up_required"
    | "manager_verification_required"
    | "official_actions_disabled"
    | "stale_case"
    | "authorization_failed";
  readonly stepUpIntentId: string | null;
  readonly stepUpExpiresAt: string | null;
  readonly action: RefundOfficialAction | null;
  readonly targetFunction: RefundOfficialActionTarget | null;

  constructor(
    message: string,
    status: number,
    code: RefundOfficialActionAuthorizationError["code"],
    details?: {
      stepUpIntentId?: string | null;
      stepUpExpiresAt?: string | null;
      action?: RefundOfficialAction | null;
      targetFunction?: RefundOfficialActionTarget | null;
    },
  ) {
    super(message);
    this.name = "RefundOfficialActionAuthorizationError";
    this.status = status;
    this.code = code;
    this.stepUpIntentId = details?.stepUpIntentId ?? null;
    this.stepUpExpiresAt = details?.stepUpExpiresAt ?? null;
    this.action = details?.action ?? null;
    this.targetFunction = details?.targetFunction ?? null;
  }
}

const safeErrorMessage = (value: unknown) =>
  typeof value === "string" ? value.trim().slice(0, 240) : "";

const classifyAuthorizationError = (message: string) => {
  const normalized = message.toLowerCase();
  if (normalized.includes("active machine manager mapping required")) {
    return new RefundOfficialActionAuthorizationError(
      "A currently mapped Machine Manager must perform this action.",
      403,
      "mapping_required",
    );
  }
  if (
    normalized.includes("changed since review") ||
    normalized.includes("changed since authorization")
  ) {
    return new RefundOfficialActionAuthorizationError(
      "This case changed during review. Reload it before taking an official action.",
      409,
      "stale_case",
    );
  }
  if (
    normalized.includes("fresh authenticator verification is required") ||
    normalized.includes("new authenticator code entered after reviewing") ||
    normalized.includes("authenticator verification proof is required")
  ) {
    return new RefundOfficialActionAuthorizationError(
      "Verify with your authenticator immediately before taking this official action.",
      403,
      "manager_verification_required",
    );
  }
  if (normalized.includes("official refund actions are disabled")) {
    return new RefundOfficialActionAuthorizationError(
      "Official refund actions remain disabled until manager step-up verification is deployed.",
      503,
      "official_actions_disabled",
    );
  }
  if (normalized.includes("authenticated machine manager session required")) {
    return new RefundOfficialActionAuthorizationError(
      "An authenticated Machine Manager session is required.",
      401,
      "authorization_failed",
    );
  }
  return new RefundOfficialActionAuthorizationError(
    "Unable to authorize this official refund action.",
    400,
    "authorization_failed",
  );
};

export const authorizeRefundOfficialAction = async ({
  supabaseUrl,
  supabaseAnonKey,
  accessToken,
  context,
}: {
  supabaseUrl: string | undefined;
  supabaseAnonKey: string | undefined;
  accessToken: string;
  context: RefundOfficialActionContext;
}): Promise<RefundOfficialActionAuthorization> => {
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new RefundOfficialActionAuthorizationError(
      "Refund action authorization is not configured.",
      500,
      "configuration_missing",
    );
  }

  if (
    !Number.isSafeInteger(context.expectedCaseVersion) ||
    context.expectedCaseVersion <= 0
  ) {
    throw new RefundOfficialActionAuthorizationError(
      "Reload this case before taking an official action.",
      409,
      "stale_case",
    );
  }

  const userClient = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });

  const rpcArguments = {
    p_case_id: context.caseId,
    p_action: context.action,
    p_target_function: context.targetFunction,
    p_expected_case_version: context.expectedCaseVersion,
    p_target_status: context.targetStatus,
    p_target_decision: context.targetDecision,
    p_assigned_manager_email: context.assignedManagerEmail ?? null,
    p_decision_reason: context.decisionReason ?? null,
    p_internal_note: context.internalNote ?? null,
    p_refund_amount_cents: context.refundAmountCents ?? null,
    p_manual_refund_reference: context.manualRefundReference ?? null,
    p_cash_payout_sent_at: context.cashPayoutSentAt ?? null,
    p_cash_payment_confirmed: context.cashPaymentConfirmed === true,
    p_matched_nayax_candidate_token: context.matchedNayaxCandidateToken ?? null,
    p_nayax_disagreement_reason: context.nayaxDisagreementReason ?? null,
  };

  const controlledPilot = typeof context.pilotAuthorizationId === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(context.pilotAuthorizationId);

  if (!context.stepUpIntentId) {
    if (controlledPilot) {
      throw new RefundOfficialActionAuthorizationError(
        "The reviewed controlled pilot verification request is required.",
        409,
        "authorization_failed",
      );
    }
    const { data, error } = await userClient.rpc(
      "admin_prepare_refund_action_step_up_intent",
      rpcArguments,
    );

    if (error || !data || typeof data !== "object") {
      throw classifyAuthorizationError(safeErrorMessage(error?.message));
    }

    const intent = data as Partial<{
      intentId: string;
      action: RefundOfficialAction;
      targetFunction: RefundOfficialActionTarget;
      expiresAt: string;
    }>;
    if (
      typeof intent.intentId !== "string" ||
      intent.action !== context.action ||
      intent.targetFunction !== context.targetFunction ||
      typeof intent.expiresAt !== "string"
    ) {
      throw new RefundOfficialActionAuthorizationError(
        "Refund action verification returned an invalid request.",
        500,
        "authorization_failed",
      );
    }

    throw new RefundOfficialActionAuthorizationError(
      "Enter a fresh authenticator code to personally authorize this exact action.",
      428,
      "manager_step_up_required",
      {
        stepUpIntentId: intent.intentId,
        stepUpExpiresAt: intent.expiresAt,
        action: intent.action,
        targetFunction: intent.targetFunction,
      },
    );
  }

  if (!/^[a-f0-9]{64}$/.test(context.stepUpFactorProof ?? "")) {
    throw new RefundOfficialActionAuthorizationError(
      "Verify with your authenticator immediately before taking this official action.",
      403,
      "manager_verification_required",
    );
  }

  const { data, error } = controlledPilot
    ? await userClient.rpc(
      "admin_consume_refund_nayax_controlled_pilot_intent",
      {
        p_pilot_authorization_id: context.pilotAuthorizationId,
        p_intent_id: context.stepUpIntentId,
        p_case_id: context.caseId,
        p_expected_case_version: context.expectedCaseVersion,
        p_refund_amount_cents: context.refundAmountCents,
        p_factor_verification_proof: context.stepUpFactorProof,
        p_executor_assertion: context.pilotExecutorAssertion,
        p_runner_assertion_digest: context.pilotRunnerAssertionDigest,
        p_contract_digest: context.pilotContractDigest,
        p_idempotency_key: context.pilotIdempotencyKey,
        p_worker_lease_id: context.pilotWorkerLeaseId,
      },
    )
    : await userClient.rpc(
      "admin_consume_refund_action_step_up_intent",
      {
        p_intent_id: context.stepUpIntentId,
        p_factor_verification_proof: context.stepUpFactorProof,
        ...rpcArguments,
      },
    );

  if (error || !data || typeof data !== "object") {
    throw classifyAuthorizationError(safeErrorMessage(error?.message));
  }

  const authorization = data as Partial<RefundOfficialActionAuthorization>;
  if (
    typeof authorization.authorizationId !== "string" ||
    authorization.action !== context.action ||
    !Number.isSafeInteger(Number(authorization.expectedCaseVersion)) ||
    !Number.isSafeInteger(Number(authorization.mappingVersion)) ||
    typeof authorization.expiresAt !== "string"
  ) {
    throw new RefundOfficialActionAuthorizationError(
      "Refund action authorization returned an invalid receipt.",
      500,
      "authorization_failed",
    );
  }
  const pilotReservation = controlledPilot
    ? (data as { pilotReservation?: RefundOfficialActionAuthorization["pilotReservation"] })
      .pilotReservation
    : undefined;
  if (controlledPilot &&
      (!pilotReservation ||
        typeof pilotReservation.attempt?.attemptId !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
          .test(pilotReservation.attempt.attemptId) ||
        typeof pilotReservation.providerClaimToken !== "string" ||
        pilotReservation.providerClaimToken.length < 43)) {
    throw new RefundOfficialActionAuthorizationError(
      "The controlled pilot reservation did not commit atomically.",
      500,
      "authorization_failed",
    );
  }

  return {
    authorizationId: authorization.authorizationId,
    action: authorization.action,
    expectedCaseVersion: Number(authorization.expectedCaseVersion),
    mappingVersion: Number(authorization.mappingVersion),
    expiresAt: authorization.expiresAt,
    ...(controlledPilot
      ? { pilotReservation }
      : {}),
  };
};
