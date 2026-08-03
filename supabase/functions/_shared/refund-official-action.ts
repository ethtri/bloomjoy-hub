import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.1";

export type RefundOfficialAction =
  | "approve"
  | "decline"
  | "cash_complete"
  | "nayax_execute";

export type RefundOfficialActionContext = {
  caseId: string;
  action: RefundOfficialAction;
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
};

export type RefundOfficialActionAuthorization = {
  authorizationId: string;
  action: RefundOfficialAction;
  expectedCaseVersion: number;
  mappingVersion: number;
  expiresAt: string;
};

export class RefundOfficialActionAuthorizationError extends Error {
  readonly status: number;
  readonly code:
    | "configuration_missing"
    | "mapping_required"
    | "manager_verification_required"
    | "official_actions_disabled"
    | "stale_case"
    | "authorization_failed";

  constructor(
    message: string,
    status: number,
    code: RefundOfficialActionAuthorizationError["code"],
  ) {
    super(message);
    this.name = "RefundOfficialActionAuthorizationError";
    this.status = status;
    this.code = code;
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
  if (normalized.includes("fresh authenticator verification is required")) {
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

  const { data, error } = await userClient.rpc(
    "admin_authorize_refund_official_action",
    {
      p_case_id: context.caseId,
      p_action: context.action,
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
      p_matched_nayax_candidate_token: context.matchedNayaxCandidateToken ??
        null,
      p_nayax_disagreement_reason: context.nayaxDisagreementReason ?? null,
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

  return {
    authorizationId: authorization.authorizationId,
    action: authorization.action,
    expectedCaseVersion: Number(authorization.expectedCaseVersion),
    mappingVersion: Number(authorization.mappingVersion),
    expiresAt: authorization.expiresAt,
  };
};
