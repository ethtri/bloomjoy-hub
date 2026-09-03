export type NayaxRefundConfigBlock =
  | "kill_switch_active"
  | "feature_disabled"
  | "dry_run_active"
  | "idempotency_secret_missing"
  | "executor_assertion_missing"
  | "manager_contract_unconfirmed"
  | "approval_scope_unconfirmed"
  | "provider_remaining_value_unverified";

export type NayaxRefundExecutionConfig = {
  blocks: NayaxRefundConfigBlock[];
  killSwitchActive: boolean;
  executionEnabled: boolean;
  dryRun: boolean;
  idempotencySecret: string | null;
  executorAssertion: string | null;
  managerContractConfirmed: boolean;
  approvalScopeConfirmed: boolean;
};

export type NayaxRefundAvailabilityBlockReason =
  | "official_actions_disabled"
  | "kill_switch_active"
  | "provider_remaining_value_unverified"
  | "configuration_missing";

export type NayaxRefundAvailability = {
  available: boolean;
  status: "available" | "unavailable";
  blockReason: NayaxRefundAvailabilityBlockReason | null;
  payloadRedacted: true;
};

// Runtime flags cannot establish a balance. Only a fresh, exact-case database
// verification may satisfy this guard; reservation and both stages recheck it.
export const NAYAX_REFUND_OFFICIAL_ACTIONS_ENABLED = true;
export const NAYAX_REFUND_EXTERNAL_PARTIAL_GUARD_SUPPORTED = true;

export type NayaxRefundIdempotencyEvidence = {
  caseId: string;
  attemptGeneration: number;
  transactionId: string;
  siteId: number;
  machineAuthorizationTime: string;
  amountCents: number;
  currencyCode: "USD";
};

export const resolveNormalNayaxRefundAmountCents = ({
  matchedTransactionAmountCents,
  remainingRefundableAmountCents,
}: {
  matchedTransactionAmountCents: number | null;
  remainingRefundableAmountCents?: number | null;
}) => {
  if (
    !Number.isSafeInteger(matchedTransactionAmountCents) ||
    Number(matchedTransactionAmountCents) <= 0
  ) {
    return null;
  }
  if (
    !Number.isSafeInteger(remainingRefundableAmountCents) ||
    Number(remainingRefundableAmountCents) <= 0 ||
    remainingRefundableAmountCents !== matchedTransactionAmountCents
  ) {
    // The normal manager action is full-transaction only. A provider-reported
    // partial remainder needs a separately reviewed exception workflow.
    return null;
  }
  return Number(matchedTransactionAmountCents);
};

const secureSecret = (value: string | undefined) => {
  const normalized = value?.trim() ?? "";
  return /^[A-Za-z0-9_-]{43,256}$/.test(normalized) ? normalized : null;
};

const exactFlag = (value: string | undefined, expected: string) =>
  value?.trim().toLowerCase() === expected;

export const resolveNayaxRefundExecutionConfig = (
  readEnv: (name: string) => string | undefined,
  { remainingValueVerified = false }: { remainingValueVerified?: boolean } = {},
): NayaxRefundExecutionConfig => {
  const killSwitchActive = !exactFlag(
    readEnv("NAYAX_REFUND_EXECUTION_KILL_SWITCH"),
    "false",
  );
  const executionEnabled = exactFlag(
    readEnv("NAYAX_REFUND_EXECUTION_ENABLED"),
    "true",
  );
  const dryRun = !exactFlag(
    readEnv("NAYAX_REFUND_EXECUTION_DRY_RUN"),
    "false",
  );
  const idempotencySecret = secureSecret(
    readEnv("NAYAX_REFUND_IDEMPOTENCY_SECRET"),
  );
  const executorAssertion = secureSecret(
    readEnv("NAYAX_REFUND_EXECUTOR_ASSERTION"),
  );
  const managerContractConfirmed = exactFlag(
    readEnv("NAYAX_REFUND_MANAGER_CONTRACT_CONFIRMED"),
    "true",
  );
  const approvalScopeConfirmed = exactFlag(
    readEnv("NAYAX_REFUND_APPROVAL_SCOPE_CONFIRMED"),
    "true",
  );

  const blocks = [
    killSwitchActive ? "kill_switch_active" : null,
    executionEnabled ? null : "feature_disabled",
    dryRun ? "dry_run_active" : null,
    idempotencySecret === null ? "idempotency_secret_missing" : null,
    executorAssertion === null ? "executor_assertion_missing" : null,
    managerContractConfirmed ? null : "manager_contract_unconfirmed",
    approvalScopeConfirmed ? null : "approval_scope_unconfirmed",
    NAYAX_REFUND_EXTERNAL_PARTIAL_GUARD_SUPPORTED && remainingValueVerified
      ? null
      : "provider_remaining_value_unverified",
  ].filter((block): block is NayaxRefundConfigBlock => block !== null);

  return {
    blocks,
    killSwitchActive,
    executionEnabled,
    dryRun,
    idempotencySecret,
    executorAssertion,
    managerContractConfirmed,
    approvalScopeConfirmed,
  };
};

export const resolveNayaxRefundAvailability = ({
  executionConfig,
  officialActionsEnabled,
}: {
  executionConfig: NayaxRefundExecutionConfig;
  officialActionsEnabled: boolean;
}): NayaxRefundAvailability => {
  let blockReason: NayaxRefundAvailabilityBlockReason | null = null;
  if (!officialActionsEnabled) {
    blockReason = "official_actions_disabled";
  } else if (executionConfig.blocks.includes("kill_switch_active")) {
    blockReason = "kill_switch_active";
  } else if (
    executionConfig.blocks.includes("provider_remaining_value_unverified")
  ) {
    blockReason = "provider_remaining_value_unverified";
  } else if (executionConfig.blocks.length > 0) {
    blockReason = "configuration_missing";
  }

  return {
    available: blockReason === null,
    status: blockReason === null ? "available" : "unavailable",
    blockReason,
    payloadRedacted: true,
  };
};

export const readNayaxRefundAvailability = async ({
  readEnv,
  officialActionsEnabled,
}: {
  readEnv: (name: string) => string | undefined;
  officialActionsEnabled: boolean;
}) => {
  const executionConfig = resolveNayaxRefundExecutionConfig(readEnv);
  return resolveNayaxRefundAvailability({
    executionConfig,
    officialActionsEnabled,
  });
};

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

export const buildNayaxRefundIdempotencyKey = async (
  secret: string | null,
  evidence: NayaxRefundIdempotencyEvidence,
) => {
  if (!secureSecret(secret ?? undefined)) {
    throw new Error(
      "A dedicated Nayax refund idempotency secret is required.",
    );
  }
  if (
    !evidence.caseId ||
    !Number.isSafeInteger(evidence.attemptGeneration) ||
    evidence.attemptGeneration < 0 ||
    evidence.attemptGeneration > 1000 ||
    !evidence.transactionId ||
    !Number.isSafeInteger(evidence.siteId) ||
    evidence.siteId <= 0 ||
    !evidence.machineAuthorizationTime ||
    !Number.isSafeInteger(evidence.amountCents) ||
    evidence.amountCents <= 0 ||
    evidence.currencyCode !== "USD"
  ) {
    throw new Error("Exact Nayax refund evidence is required.");
  }

  const fingerprint = [
    evidence.caseId,
    evidence.attemptGeneration,
    evidence.transactionId,
    evidence.siteId,
    evidence.machineAuthorizationTime,
    evidence.amountCents,
    evidence.currencyCode,
  ].join("|");

  return `nayax-refund-${await hmacSha256Hex(secret!, fingerprint)}`;
};
