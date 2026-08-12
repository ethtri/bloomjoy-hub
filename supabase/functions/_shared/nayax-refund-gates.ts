export type NayaxRefundConfigBlock =
  | "kill_switch_active"
  | "feature_disabled"
  | "sponsor_approval_missing"
  | "dry_run_active"
  | "provider_contract_unconfirmed"
  | "per_refund_cap_missing"
  | "daily_amount_cap_missing"
  | "daily_count_cap_missing"
  | "idempotency_secret_missing"
  | "executor_assertion_missing";

export type NayaxRefundExecutionConfig = {
  blocks: NayaxRefundConfigBlock[];
  killSwitchActive: boolean;
  executionEnabled: boolean;
  dryRun: boolean;
  sponsorApproved: boolean;
  providerContractConfirmed: boolean;
  maxAmountCents: number | null;
  dailyAmountCapCents: number | null;
  dailyCountCap: number | null;
  idempotencySecret: string | null;
  executorAssertion: string | null;
};

export type NayaxRefundAvailabilityBlockReason =
  | "official_actions_disabled"
  | "kill_switch_active"
  | "configuration_missing"
  | "contract_unconfirmed";

export type NayaxRefundAvailability = {
  available: boolean;
  status: "available" | "unavailable";
  blockReason: NayaxRefundAvailabilityBlockReason | null;
  payloadRedacted: true;
};

// The Nayax execution and availability paths share this hard-off gate. A
// future enablement must also change the independent database official-action
// gate in a separately reviewed rollout.
export const NAYAX_REFUND_OFFICIAL_ACTIONS_ENABLED = false;

export type NayaxRefundIdempotencyEvidence = {
  caseId: string;
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
  const sponsorApproved = exactFlag(
    readEnv("NAYAX_REFUND_EXECUTION_SPONSOR_GO_NO_GO"),
    "approved",
  );
  const providerContractConfirmed = exactFlag(
    readEnv("NAYAX_REFUND_EXECUTION_PROVIDER_CONTRACT_CONFIRMED"),
    "true",
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

  const blocks = [
    killSwitchActive ? "kill_switch_active" : null,
    executionEnabled ? null : "feature_disabled",
    sponsorApproved ? null : "sponsor_approval_missing",
    dryRun ? "dry_run_active" : null,
    providerContractConfirmed ? null : "provider_contract_unconfirmed",
    maxAmountCents === null ? "per_refund_cap_missing" : null,
    dailyAmountCapCents === null ? "daily_amount_cap_missing" : null,
    dailyCountCap === null ? "daily_count_cap_missing" : null,
    idempotencySecret === null ? "idempotency_secret_missing" : null,
    executorAssertion === null ? "executor_assertion_missing" : null,
  ].filter((block): block is NayaxRefundConfigBlock => block !== null);

  return {
    blocks,
    killSwitchActive,
    executionEnabled,
    dryRun,
    sponsorApproved,
    providerContractConfirmed,
    maxAmountCents,
    dailyAmountCapCents,
    dailyCountCap,
    idempotencySecret,
    executorAssertion,
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
    executionConfig.blocks.includes("provider_contract_unconfirmed")
  ) {
    blockReason = "contract_unconfirmed";
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
    evidence.transactionId,
    evidence.siteId,
    evidence.machineAuthorizationTime,
    evidence.amountCents,
    evidence.currencyCode,
  ].join("|");

  return `nayax-refund-${await hmacSha256Hex(secret!, fingerprint)}`;
};
