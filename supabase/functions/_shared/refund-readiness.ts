import type { NayaxRefundExecutionConfig } from "./nayax-refund-gates.ts";

export type RefundReadinessBlockReason =
  | "case_not_found"
  | "unauthorized"
  | "transaction_not_confirmed"
  | "already_refunded"
  | "reconciliation_hold"
  | "duplicate_transaction"
  | "case_not_refundable"
  | "machine_not_enabled"
  | "globally_paused"
  | "provider_remaining_value_unverified"
  | "provider_unavailable";

export type RefundReadiness = {
  transactionConfirmed: boolean;
  approvalContinuationReady: boolean;
  canIssueCardRefund: boolean;
  blockReason: RefundReadinessBlockReason | null;
  refundAmountCents: number | null;
  machineLimitCents: number | null;
  caseVersion: number | null;
};

const knownBlockReasons = new Set<RefundReadinessBlockReason>([
  "case_not_found",
  "unauthorized",
  "transaction_not_confirmed",
  "already_refunded",
  "reconciliation_hold",
  "duplicate_transaction",
  "case_not_refundable",
  "machine_not_enabled",
  "globally_paused",
  "provider_remaining_value_unverified",
  "provider_unavailable",
]);

const optionalInteger = (value: unknown) =>
  Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : null;

export const parseDatabaseRefundReadiness = (
  value: unknown,
): RefundReadiness => {
  const row = value && typeof value === "object"
    ? value as Record<string, unknown>
    : {};
  const transactionConfirmed = row.transactionConfirmed === true;
  const rawReason = typeof row.blockReason === "string"
    ? row.blockReason
    : null;
  const blockReason = rawReason === null
    ? null
    : knownBlockReasons.has(rawReason as RefundReadinessBlockReason)
    ? rawReason as RefundReadinessBlockReason
    : "provider_unavailable";

  return {
    transactionConfirmed,
    approvalContinuationReady: row.approvalContinuationReady === true,
    canIssueCardRefund: row.canIssueCardRefund === true && blockReason === null,
    blockReason,
    refundAmountCents: optionalInteger(row.refundAmountCents),
    machineLimitCents: optionalInteger(row.machineLimitCents),
    caseVersion: optionalInteger(row.caseVersion),
  };
};

export const mergeRuntimeRefundReadiness = ({
  databaseReadiness,
  executionConfig,
  officialActionsEnabled,
  providerCredentialAvailable,
}: {
  databaseReadiness: RefundReadiness;
  executionConfig: NayaxRefundExecutionConfig;
  officialActionsEnabled: boolean;
  providerCredentialAvailable: boolean;
}): RefundReadiness => {
  if (!databaseReadiness.canIssueCardRefund) return databaseReadiness;

  let blockReason: RefundReadinessBlockReason | null = null;
  if (
    !officialActionsEnabled ||
    executionConfig.blocks.includes("kill_switch_active") ||
    executionConfig.blocks.includes("feature_disabled") ||
    executionConfig.blocks.includes("dry_run_active")
  ) {
    blockReason = "globally_paused";
  } else if (executionConfig.blocks.length > 0 || !providerCredentialAvailable) {
    blockReason = "provider_unavailable";
  }

  return {
    ...databaseReadiness,
    canIssueCardRefund: blockReason === null,
    blockReason,
  };
};
