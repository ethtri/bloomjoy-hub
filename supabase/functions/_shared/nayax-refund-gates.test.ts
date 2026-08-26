import {
  buildNayaxRefundIdempotencyKey,
  isNayaxRefundCaseReleaseAuthorized,
  readNayaxRefundAvailability,
  resolveNayaxRefundCaseExecutionConfig,
  resolveNayaxRefundAvailability,
  resolveNayaxRefundExecutionConfig,
  resolveNayaxRefundRolloutConfig,
} from "./nayax-refund-gates.ts";

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};

const envReader = (values: Record<string, string>) => (name: string) =>
  values[name];

const enabledConfig = {
  NAYAX_REFUND_EXECUTION_KILL_SWITCH: "false",
  NAYAX_REFUND_EXECUTION_ENABLED: "true",
  NAYAX_REFUND_EXECUTION_DRY_RUN: "false",
  NAYAX_REFUND_MAX_AMOUNT_CENTS: "1000",
  NAYAX_REFUND_DAILY_AMOUNT_CAP_CENTS: "5000",
  NAYAX_REFUND_DAILY_COUNT_CAP: "10",
  NAYAX_REFUND_IDEMPOTENCY_SECRET: "i".repeat(64),
  NAYAX_REFUND_EXECUTOR_ASSERTION: "e".repeat(64),
  NAYAX_REFUND_MANAGER_CONTRACT_CONFIRMED: "true",
  NAYAX_REFUND_APPROVAL_SCOPE_CONFIRMED: "true",
};

const canaryCaseId = "76000000-0000-4000-8000-000000000001";

const calibrationRollout = {
  NAYAX_REFUND_BROAD_REOPEN_APPROVED: "false",
  NAYAX_REFUND_CANARY_ENABLED: "true",
  NAYAX_REFUND_CANARY_CASE_ID: canaryCaseId,
  NAYAX_REFUND_CANARY_UNPROVEN_PROVIDER_APPROVED: "true",
};

Deno.test("default or missing rollout configuration reports every fail-closed gate", () => {
  const config = resolveNayaxRefundExecutionConfig(envReader({}));
  for (
    const block of [
      "kill_switch_active",
      "feature_disabled",
      "dry_run_active",
      "per_refund_cap_missing",
      "daily_amount_cap_missing",
      "daily_count_cap_missing",
      "idempotency_secret_missing",
      "executor_assertion_missing",
      "manager_contract_unconfirmed",
      "approval_scope_unconfirmed",
    ]
  ) {
    assert(config.blocks.includes(block as never), `${block} must block`);
  }
});

Deno.test("a complete bounded configuration has no rollout block", () => {
  const config = resolveNayaxRefundExecutionConfig(envReader(enabledConfig));
  assert(config.blocks.length === 0, "complete config should pass gates");
  assert(config.dailyCountCap === 10, "daily count must be preserved");
  assert(
    config.dailyAmountCapCents === 5000,
    "daily amount must be preserved",
  );
});

Deno.test("owner-approved calibration removes only the two unproven facts for the exact canary", () => {
  const baseConfig = resolveNayaxRefundExecutionConfig(envReader({
    ...enabledConfig,
    NAYAX_REFUND_EXECUTION_KILL_SWITCH: "true",
    NAYAX_REFUND_IDEMPOTENCY_SECRET: "invalid",
    NAYAX_REFUND_MANAGER_CONTRACT_CONFIRMED: "false",
    NAYAX_REFUND_APPROVAL_SCOPE_CONFIRMED: "false",
  }));
  const rolloutConfig = resolveNayaxRefundRolloutConfig(
    envReader(calibrationRollout),
  );
  const caseConfig = resolveNayaxRefundCaseExecutionConfig({
    executionConfig: baseConfig,
    rolloutConfig,
    caseId: canaryCaseId.toUpperCase(),
  });

  assert(
    !caseConfig.blocks.includes("manager_contract_unconfirmed"),
    "the exact canary may calibrate the manager response contract",
  );
  assert(
    !caseConfig.blocks.includes("approval_scope_unconfirmed"),
    "the exact canary may calibrate approval scope",
  );
  assert(
    caseConfig.blocks.includes("kill_switch_active"),
    "the calibration must not bypass the kill switch",
  );
  assert(
    caseConfig.blocks.includes("idempotency_secret_missing"),
    "the calibration must not bypass idempotency",
  );
  assert(
    baseConfig.blocks.includes("manager_contract_unconfirmed") &&
      baseConfig.blocks.includes("approval_scope_unconfirmed"),
    "case calibration must not mutate the global configuration",
  );
});

Deno.test("calibration cannot authorize another case or broad reopening", () => {
  const baseConfig = resolveNayaxRefundExecutionConfig(envReader({
    ...enabledConfig,
    NAYAX_REFUND_MANAGER_CONTRACT_CONFIRMED: "false",
    NAYAX_REFUND_APPROVAL_SCOPE_CONFIRMED: "false",
  }));
  const anotherCase = "76000000-0000-4000-8000-000000000002";
  const calibration = resolveNayaxRefundRolloutConfig(
    envReader(calibrationRollout),
  );
  const otherCaseConfig = resolveNayaxRefundCaseExecutionConfig({
    executionConfig: baseConfig,
    rolloutConfig: calibration,
    caseId: anotherCase,
  });
  assert(
    otherCaseConfig.blocks.includes("manager_contract_unconfirmed") &&
      otherCaseConfig.blocks.includes("approval_scope_unconfirmed"),
    "a non-canary case must remain blocked",
  );
  assert(
    !isNayaxRefundCaseReleaseAuthorized({
      rolloutConfig: calibration,
      caseId: anotherCase,
    }),
    "a non-canary case must not be release-authorized",
  );

  const broadRollout = resolveNayaxRefundRolloutConfig(envReader({
    ...calibrationRollout,
    NAYAX_REFUND_BROAD_REOPEN_APPROVED: "true",
  }));
  const broadConfig = resolveNayaxRefundCaseExecutionConfig({
    executionConfig: baseConfig,
    rolloutConfig: broadRollout,
    caseId: canaryCaseId,
  });
  assert(
    broadConfig.blocks.includes("manager_contract_unconfirmed") &&
      broadConfig.blocks.includes("approval_scope_unconfirmed"),
    "broad reopening must require independent contract and scope confirmation",
  );
});

Deno.test("calibration defaults closed and rejects a malformed canary identifier", () => {
  const baseConfig = resolveNayaxRefundExecutionConfig(envReader({
    ...enabledConfig,
    NAYAX_REFUND_MANAGER_CONTRACT_CONFIRMED: "false",
    NAYAX_REFUND_APPROVAL_SCOPE_CONFIRMED: "false",
  }));
  for (const rolloutValues of [
    {
      ...calibrationRollout,
      NAYAX_REFUND_CANARY_UNPROVEN_PROVIDER_APPROVED: "false",
    },
    {
      ...calibrationRollout,
      NAYAX_REFUND_CANARY_CASE_ID: "not-a-case-id",
    },
  ]) {
    const rolloutConfig = resolveNayaxRefundRolloutConfig(
      envReader(rolloutValues),
    );
    const caseConfig = resolveNayaxRefundCaseExecutionConfig({
      executionConfig: baseConfig,
      rolloutConfig,
      caseId: canaryCaseId,
    });
    assert(
      caseConfig.blocks.includes("manager_contract_unconfirmed") &&
        caseConfig.blocks.includes("approval_scope_unconfirmed"),
      "disabled or malformed calibration must fail closed",
    );
  }
});

Deno.test("weak or unbounded execution inputs fail closed", () => {
  const config = resolveNayaxRefundExecutionConfig(envReader({
    ...enabledConfig,
    NAYAX_REFUND_MAX_AMOUNT_CENTS: "1000001",
    NAYAX_REFUND_DAILY_AMOUNT_CAP_CENTS: "0",
    NAYAX_REFUND_DAILY_COUNT_CAP: "101",
    NAYAX_REFUND_IDEMPOTENCY_SECRET: "local-dev",
    NAYAX_REFUND_EXECUTOR_ASSERTION: "service-role-fallback",
  }));
  assert(
    config.blocks.includes("per_refund_cap_missing"),
    "per-refund cap must be bounded",
  );
  assert(
    config.blocks.includes("daily_amount_cap_missing"),
    "daily amount cap must be bounded",
  );
  assert(
    config.blocks.includes("daily_count_cap_missing"),
    "daily count cap must be bounded",
  );
  assert(
    config.blocks.includes("idempotency_secret_missing"),
    "weak idempotency secret must fail",
  );
  assert(
    config.blocks.includes("executor_assertion_missing"),
    "weak executor assertion must fail",
  );
});

Deno.test("idempotency is deterministic for an exact replay and changes with immutable evidence", async () => {
  const secret = "s".repeat(64);
  const evidence = {
    caseId: "76000000-0000-4000-8000-000000000001",
    attemptGeneration: 0,
    transactionId: "123456789",
    siteId: 42,
    machineAuthorizationTime: "2026-07-22T17:30:00Z",
    amountCents: 700,
    currencyCode: "USD" as const,
  };
  const first = await buildNayaxRefundIdempotencyKey(secret, evidence);
  const replay = await buildNayaxRefundIdempotencyKey(secret, evidence);
  const changed = await buildNayaxRefundIdempotencyKey(secret, {
    ...evidence,
    amountCents: 701,
  });
  const retryGeneration = await buildNayaxRefundIdempotencyKey(secret, {
    ...evidence,
    attemptGeneration: 1,
  });
  assert(first === replay, "exact replay must retain one key");
  assert(first !== changed, "changed evidence must change the key");
  assert(
    first !== retryGeneration,
    "a support-approved retry generation must create a fresh key",
  );
  assert(
    /^nayax-refund-[a-f0-9]{64}$/.test(first),
    "key must match the database contract",
  );
});

Deno.test("idempotency never falls back to a service key or local default", async () => {
  let failed = false;
  try {
    await buildNayaxRefundIdempotencyKey(null, {
      caseId: "76000000-0000-4000-8000-000000000001",
      attemptGeneration: 0,
      transactionId: "123456789",
      siteId: 42,
      machineAuthorizationTime: "2026-07-22T17:30:00Z",
      amountCents: 700,
      currencyCode: "USD",
    });
  } catch (error) {
    failed = error instanceof Error &&
      error.message.includes("dedicated Nayax refund idempotency secret");
  }
  assert(failed, "missing dedicated secret must fail before HMAC");
});

Deno.test("availability returns only the redacted safe contract", () => {
  const result = resolveNayaxRefundAvailability({
    executionConfig: resolveNayaxRefundExecutionConfig(
      envReader(enabledConfig),
    ),
    officialActionsEnabled: true,
  });
  assert(result.available, "complete config must be available");
  assert(result.status === "available", "status must be available");
  assert(result.blockReason === null, "available must have no reason");
  assert(result.payloadRedacted === true, "payload must be redacted");
  assert(
    Object.keys(result).sort().join("|") ===
      "available|blockReason|payloadRedacted|status",
    "availability must expose only the approved fields",
  );
  assert(
    !JSON.stringify(result).includes(
      enabledConfig.NAYAX_REFUND_IDEMPOTENCY_SECRET,
    ),
    "availability must not expose secret values",
  );
});

Deno.test("availability fail-closes to the bounded reason precedence", () => {
  const defaultConfig = resolveNayaxRefundExecutionConfig(envReader({}));
  const enabled = resolveNayaxRefundExecutionConfig(envReader(enabledConfig));
  const cases = [
    {
      officialActionsEnabled: false,
      config: defaultConfig,
      reason: "official_actions_disabled",
    },
    {
      officialActionsEnabled: true,
      config: resolveNayaxRefundExecutionConfig(envReader({
        ...enabledConfig,
        NAYAX_REFUND_EXECUTION_KILL_SWITCH: "true",
      })),
      reason: "kill_switch_active",
    },
    {
      officialActionsEnabled: true,
      config: defaultConfig,
      reason: "kill_switch_active",
    },
  ];
  for (const fixture of cases) {
    const result = resolveNayaxRefundAvailability({
      executionConfig: fixture.config,
      officialActionsEnabled: fixture.officialActionsEnabled,
    });
    assert(!result.available, `${fixture.reason} must be unavailable`);
    assert(
      result.blockReason === fixture.reason,
      `${fixture.reason} must be the safe reason`,
    );
    assert(result.payloadRedacted, "every blocked result must be redacted");
  }
});

Deno.test("availability reads gates only and performs zero execution side effects", async () => {
  const providerCalls = 0;
  const reservations = 0;
  const mutations = 0;
  const result = await readNayaxRefundAvailability({
    readEnv: envReader(enabledConfig),
    officialActionsEnabled: true,
  });
  // Provider, reservation, and mutation dependencies are intentionally absent
  // from the read-only operation's type and therefore cannot be invoked.
  assert(result.available, "bounded gates should report available");
  assert(providerCalls === 0, "availability must not call a provider");
  assert(reservations === 0, "availability must not reserve an attempt");
  assert(mutations === 0, "availability must not mutate a case");
});
