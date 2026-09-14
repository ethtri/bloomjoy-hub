import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.1";

export type RefundOfficialAction = "approve" | "decline" | "cash_complete";
export type RefundOfficialActionTarget = "refund-case-admin-update";

export type RefundOfficialActionContext = {
  caseId: string;
  action: RefundOfficialAction;
  targetFunction: RefundOfficialActionTarget;
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
  nayaxDisagreementReason?: string | null;
};

export type RefundOfficialActionAuthorization = {
  authorizationId: string;
  action: RefundOfficialAction;
  expectedCaseVersion: number;
  authorityKind: "machine_manager" | "super_admin";
  authorityVersion: number;
  expiresAt: string;
};

export class RefundOfficialActionAuthorizationError extends Error {
  readonly status: number;
  readonly code: "configuration_missing" | "mapping_required" | "stale_case" |
    "authorization_failed";
  readonly action: RefundOfficialAction | null;
  readonly targetFunction: RefundOfficialActionTarget | null;

  constructor(message: string, status: number,
    code: RefundOfficialActionAuthorizationError["code"],
    details?: { action?: RefundOfficialAction | null;
      targetFunction?: RefundOfficialActionTarget | null }) {
    super(message);
    this.name = "RefundOfficialActionAuthorizationError";
    this.status = status;
    this.code = code;
    this.action = details?.action ?? null;
    this.targetFunction = details?.targetFunction ?? null;
  }
}

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const safeMessage = (value: unknown) => typeof value === "string" ? value : "";

export const normalizeRefundAuthorizationAuthority = (value: unknown): {
  authorityKind: "machine_manager" | "super_admin";
  authorityVersion: number;
} | null => {
  const receipt = value && typeof value === "object"
    ? value as Record<string, unknown>
    : {};
  const legacyVersion = Number(receipt.mappingVersion);
  const authorityKind = receipt.authorityKind === "super_admin"
    ? "super_admin"
    : receipt.authorityKind === "machine_manager" ||
        Number.isSafeInteger(legacyVersion) && legacyVersion > 0
    ? "machine_manager"
    : null;
  const authorityVersion = Number(
    receipt.authorityVersion ?? receipt.mappingVersion,
  );
  return authorityKind && Number.isSafeInteger(authorityVersion) && authorityVersion > 0
    ? { authorityKind, authorityVersion }
    : null;
};

const classifyError = (message: string) => {
  const normalized = message.toLowerCase();
  if (normalized.includes("changed since review") || normalized.includes("changed since authorization")) {
    return new RefundOfficialActionAuthorizationError(
      "This case changed during review. Reload it before taking an official action.",
      409, "stale_case");
  }
  if (normalized.includes("assigned manager") || normalized.includes("super-admin")) {
    return new RefundOfficialActionAuthorizationError(
      "Only the assigned Machine Manager or a Super-admin can take this action.",
      403, "mapping_required");
  }
  return new RefundOfficialActionAuthorizationError(
    "Unable to authorize this official refund action.", 400, "authorization_failed");
};

export const authorizeRefundOfficialAction = async ({
  supabaseUrl, supabaseAnonKey, accessToken, context,
}: {
  supabaseUrl: string | undefined;
  supabaseAnonKey: string | undefined;
  accessToken: string;
  context: RefundOfficialActionContext;
}): Promise<RefundOfficialActionAuthorization> => {
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new RefundOfficialActionAuthorizationError(
      "Refund action authorization is not configured.", 500, "configuration_missing");
  }
  if (!Number.isSafeInteger(context.expectedCaseVersion) || context.expectedCaseVersion <= 0) {
    throw new RefundOfficialActionAuthorizationError(
      "Reload this case before taking an official action.", 409, "stale_case");
  }
  const client = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false },
  });
  const { data, error } = await client.rpc("admin_authorize_refund_official_action", {
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
    p_matched_nayax_candidate_token: null,
    p_nayax_disagreement_reason: context.nayaxDisagreementReason ?? null,
  });
  if (error || !data || typeof data !== "object") {
    throw classifyError(safeMessage(error?.message));
  }
  const receipt = data as Partial<RefundOfficialActionAuthorization>;
  if (!UUID.test(receipt.authorizationId ?? "") ||
    !new Set(["approve", "decline", "cash_complete"]).has(receipt.action ?? "") ||
    !Number.isSafeInteger(Number(receipt.expectedCaseVersion)) ||
    !new Set(["machine_manager", "super_admin"]).has(receipt.authorityKind ?? "") ||
    !Number.isSafeInteger(Number(receipt.authorityVersion)) ||
    typeof receipt.expiresAt !== "string") {
    throw new RefundOfficialActionAuthorizationError(
      "Refund action authorization returned an invalid receipt.", 500,
      "authorization_failed");
  }
  return receipt as RefundOfficialActionAuthorization;
};
