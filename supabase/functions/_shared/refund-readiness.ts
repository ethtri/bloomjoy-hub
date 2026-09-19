import type { NayaxRefundExecutionConfig } from "./nayax-refund-gates.ts";

export type RefundReadinessBlockReason =
  | "case_not_found"
  | "unauthorized"
  | "transaction_not_confirmed"
  | "already_refunded"
  | "reconciliation_hold"
  | "duplicate_transaction"
  | "case_not_refundable"
  | "system_finishing"
  | "globally_paused"
  | "provider_remaining_value_unverified"
  | "provider_unavailable";

export type RefundReadiness = {
  transactionConfirmed: boolean;
  canIssueCardRefund: boolean;
  blockReason: RefundReadinessBlockReason | null;
  refundAmountCents: number | null;
  machineLimitCents: number | null;
  caseVersion: number | null;
  approvalPendingExecution?: boolean;
};

const knownBlockReasons = new Set<RefundReadinessBlockReason>([
  "case_not_found",
  "unauthorized",
  "transaction_not_confirmed",
  "already_refunded",
  "reconciliation_hold",
  "duplicate_transaction",
  "case_not_refundable",
  "system_finishing",
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
    canIssueCardRefund: row.canIssueCardRefund === true && blockReason === null,
    blockReason,
    refundAmountCents: optionalInteger(row.refundAmountCents),
    machineLimitCents: optionalInteger(row.machineLimitCents),
    caseVersion: optionalInteger(row.caseVersion),
    approvalPendingExecution: row.approvalPendingExecution === true,
  };
};

export const mergeRuntimeRefundReadiness = ({
  databaseReadiness,
  executionConfig,
  providerCredentialAvailable,
}: {
  databaseReadiness: RefundReadiness;
  executionConfig: NayaxRefundExecutionConfig;
  providerCredentialAvailable: boolean;
}): RefundReadiness => {
  if (!databaseReadiness.canIssueCardRefund) return databaseReadiness;

  // Operational switches and the two deployment confirmations hold the
  // durable attempt in the System processor. They do not revoke a manager's
  // otherwise-valid decision. The concrete secrets, provider credentials,
  // production contract and journal remain required before approval is saved;
  // the processor independently rechecks every execution prerequisite before
  // claiming the attempt.
  const managerRequiredConfigMissing = executionConfig.blocks.some((block) =>
    block === "idempotency_secret_missing" ||
    block === "executor_assertion_missing"
  );
  const blockReason: RefundReadinessBlockReason | null =
    managerRequiredConfigMissing || !providerCredentialAvailable
      ? "provider_unavailable"
      : null;

  return {
    ...databaseReadiness,
    canIssueCardRefund: blockReason === null,
    blockReason,
  };
};
