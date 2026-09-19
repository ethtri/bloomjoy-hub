export type NayaxRefundConfigBlock =
  | "kill_switch_active"
  | "feature_disabled"
  | "dry_run_active"
  | "idempotency_secret_missing"
  | "executor_assertion_missing"
  | "manager_contract_unconfirmed"
  | "approval_scope_unconfirmed";

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
  | "configuration_missing"
  | "system_attempt_queue_disabled"
  | "system_attempt_queue_not_ready";

export type NayaxRefundAttemptQueueReadiness = {
  enabled: boolean;
  ready: boolean;
  blockReason:
    | "system_attempt_queue_disabled"
    | "system_attempt_queue_not_ready"
    | null;
  accountConfigured: boolean;
  accountMatches: boolean;
};

export type NayaxRefundAvailability = {
  available: boolean;
  status: "available" | "unavailable";
  blockReason: NayaxRefundAvailabilityBlockReason | null;
  payloadRedacted: true;
};

// Nayax enforces the original transaction total. Local authority, original
// identity, amount, duplicate, claim and outcome checks remain mandatory.
export const NAYAX_REFUND_OFFICIAL_ACTIONS_ENABLED = true;

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
}: {
  matchedTransactionAmountCents: number | null;
}) => {
  if (
    !Number.isSafeInteger(matchedTransactionAmountCents) ||
    Number(matchedTransactionAmountCents) <= 0
  ) {
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

export const normalizeNayaxRefundAccountKey = (value: string | undefined) =>
  (value ?? "").trim().toUpperCase().replace(/[^A-Z0-9_]/g, "_");

export const resolveNayaxRefundAttemptQueueReadiness = ({
  readEnv,
  requiredAccountKey,
}: {
  readEnv: (name: string) => string | undefined;
  requiredAccountKey?: string | null;
}): NayaxRefundAttemptQueueReadiness => {
  const enabled = exactFlag(readEnv("REFUND_AUTOMATION_ENABLED"), "true") &&
    exactFlag(readEnv("NAYAX_REFUND_ATTEMPT_QUEUE_ENABLED"), "true");
  const configuredAccountKey = normalizeNayaxRefundAccountKey(
    readEnv("NAYAX_REFUND_ATTEMPT_QUEUE_ACCOUNT_KEY"),
  );
  const normalizedRequiredAccountKey = normalizeNayaxRefundAccountKey(
    requiredAccountKey ?? undefined,
  );
  const accountConfigured = configuredAccountKey.length > 0;
  const accountMatches = !normalizedRequiredAccountKey ||
    configuredAccountKey === normalizedRequiredAccountKey;
  const blockReason = !enabled
    ? "system_attempt_queue_disabled" as const
    : !accountConfigured || !accountMatches
    ? "system_attempt_queue_not_ready" as const
    : null;

  return {
    enabled,
    ready: blockReason === null,
    blockReason,
    accountConfigured,
    accountMatches,
  };
};

export const resolveNayaxRefundExecutionConfig = (
  readEnv: (name: string) => string | undefined,
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
  attemptQueueReadiness,
}: {
  executionConfig: NayaxRefundExecutionConfig;
  officialActionsEnabled: boolean;
  attemptQueueReadiness: NayaxRefundAttemptQueueReadiness;
}): NayaxRefundAvailability => {
  let blockReason: NayaxRefundAvailabilityBlockReason | null = null;
  if (!officialActionsEnabled) {
    blockReason = "official_actions_disabled";
  } else if (executionConfig.blocks.includes("kill_switch_active")) {
    blockReason = "kill_switch_active";
  } else if (executionConfig.blocks.length > 0) {
    blockReason = "configuration_missing";
  } else if (!attemptQueueReadiness.ready) {
    blockReason = attemptQueueReadiness.blockReason;
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
  const attemptQueueReadiness = resolveNayaxRefundAttemptQueueReadiness({
    readEnv,
  });
  return resolveNayaxRefundAvailability({
    executionConfig,
    officialActionsEnabled,
    attemptQueueReadiness,
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
