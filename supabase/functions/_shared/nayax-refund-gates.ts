export type NayaxRefundConfigBlock =
  | "kill_switch_active"
  | "feature_disabled"
  | "dry_run_active"
  | "per_refund_cap_missing"
  | "daily_amount_cap_missing"
  | "daily_count_cap_missing"
  | "idempotency_secret_missing"
  | "executor_assertion_missing"
  | "manager_contract_unconfirmed"
  | "approval_scope_unconfirmed";

export type NayaxRefundExecutionConfig = {
  blocks: NayaxRefundConfigBlock[];
  killSwitchActive: boolean;
  executionEnabled: boolean;
  dryRun: boolean;
  maxAmountCents: number | null;
  dailyAmountCapCents: number | null;
  dailyCountCap: number | null;
  idempotencySecret: string | null;
  executorAssertion: string | null;
  managerContractConfirmed: boolean;
  approvalScopeConfirmed: boolean;
};

export type NayaxRefundRolloutConfig = {
  broadReopenApproved: boolean;
  canaryEnabled: boolean;
  canaryCaseId: string | null;
};

export type NayaxRefundAvailabilityBlockReason =
  | "official_actions_disabled"
  | "kill_switch_active"
  | "configuration_missing";

export type NayaxRefundAvailability = {
  available: boolean;
  status: "available" | "unavailable";
  blockReason: NayaxRefundAvailabilityBlockReason | null;
  payloadRedacted: true;
};

// The normal card-refund function may reach the existing provider adapter, but
// only after the authenticated mapped-manager, immutable evidence, per-machine
// enablement, caps, kill-switch, dry-run, and idempotency checks all pass.
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

const secureSecret = (value: string | undefined) => {
  const normalized = value?.trim() ?? "";
  return /^[A-Za-z0-9_-]{43,256}$/.test(normalized) ? normalized : null;
};

const boundedInteger = (
  value: string | undefined,
  maximum: number,
) => {
  const normalized = value?.trim() ?? "";
  if (!/^[1-9][0-9]*$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) && parsed <= maximum ? parsed : null;
};

const exactFlag = (value: string | undefined, expected: string) =>
  value?.trim().toLowerCase() === expected;

const normalizedUuid = (value: string | undefined) => {
  const normalized = value?.trim().toLowerCase() ?? "";
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
      .test(normalized)
    ? normalized
    : null;
};

export const resolveNayaxRefundRolloutConfig = (
  readEnv: (name: string) => string | undefined,
): NayaxRefundRolloutConfig => ({
  broadReopenApproved: exactFlag(
    readEnv("NAYAX_REFUND_BROAD_REOPEN_APPROVED"),
    "true",
  ),
  canaryEnabled: exactFlag(readEnv("NAYAX_REFUND_CANARY_ENABLED"), "true"),
  canaryCaseId: normalizedUuid(readEnv("NAYAX_REFUND_CANARY_CASE_ID")),
});

const isExactCanaryCase = (
  rolloutConfig: NayaxRefundRolloutConfig,
  caseId: string,
) =>
  rolloutConfig.canaryEnabled &&
  rolloutConfig.canaryCaseId !== null &&
  rolloutConfig.canaryCaseId === caseId.trim().toLowerCase();

export const isNayaxRefundCaseReleaseAuthorized = ({
  rolloutConfig,
  caseId,
}: {
  rolloutConfig: NayaxRefundRolloutConfig;
  caseId: string;
}) =>
  rolloutConfig.broadReopenApproved || isExactCanaryCase(
    rolloutConfig,
    caseId,
  );

export const resolveNayaxRefundCaseExecutionConfig = ({
  executionConfig,
  rolloutConfig: _rolloutConfig,
  caseId: _caseId,
}: {
  executionConfig: NayaxRefundExecutionConfig;
  rolloutConfig: NayaxRefundRolloutConfig;
  caseId: string;
}): NayaxRefundExecutionConfig =>
  // A case allowlist can bound rollout, but it can never substitute for an
  // account-specific provider contract or approval-scope confirmation.
  executionConfig;

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
  const maxAmountCents = boundedInteger(
    readEnv("NAYAX_REFUND_MAX_AMOUNT_CENTS"),
    1_000_000,
  );
  const dailyAmountCapCents = boundedInteger(
    readEnv("NAYAX_REFUND_DAILY_AMOUNT_CAP_CENTS"),
    1_000_000,
  );
  const dailyCountCap = boundedInteger(
    readEnv("NAYAX_REFUND_DAILY_COUNT_CAP"),
    100,
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
    maxAmountCents === null ? "per_refund_cap_missing" : null,
    dailyAmountCapCents === null ? "daily_amount_cap_missing" : null,
    dailyCountCap === null ? "daily_count_cap_missing" : null,
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
    maxAmountCents,
    dailyAmountCapCents,
    dailyCountCap,
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
