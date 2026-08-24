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
  | "cap_exceeded"
  | "globally_paused"
  | "provider_unavailable";

export type RefundReadiness = {
  transactionConfirmed: boolean;
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
  "cap_exceeded",
  "globally_paused",
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
  dailyAmountUsedCents,
  dailyCountUsed,
}: {
  databaseReadiness: RefundReadiness;
  executionConfig: NayaxRefundExecutionConfig;
  officialActionsEnabled: boolean;
  providerCredentialAvailable: boolean;
  dailyAmountUsedCents: number | null;
  dailyCountUsed: number | null;
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
  } else if (
    databaseReadiness.refundAmountCents !== null &&
    executionConfig.maxAmountCents !== null &&
    databaseReadiness.refundAmountCents > executionConfig.maxAmountCents
  ) {
    blockReason = "cap_exceeded";
  } else if (
    executionConfig.blocks.length > 0 || !providerCredentialAvailable
  ) {
    blockReason = "provider_unavailable";
  } else if (
    dailyAmountUsedCents === null || dailyCountUsed === null ||
    executionConfig.dailyAmountCapCents === null ||
    executionConfig.dailyCountCap === null
  ) {
    blockReason = "provider_unavailable";
  } else if (
    dailyCountUsed + 1 > executionConfig.dailyCountCap ||
    databaseReadiness.refundAmountCents === null ||
    dailyAmountUsedCents + databaseReadiness.refundAmountCents >
      executionConfig.dailyAmountCapCents
  ) {
    blockReason = "cap_exceeded";
  }

  return {
    ...databaseReadiness,
    canIssueCardRefund: blockReason === null,
    blockReason,
  };
};
