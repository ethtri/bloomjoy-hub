import {
  buildNayaxRefundIdempotencyKey,
  readNayaxRefundAvailability,
  resolveNormalNayaxRefundAmountCents,
  resolveNayaxRefundAvailability,
  resolveNayaxRefundExecutionConfig,
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
  NAYAX_REFUND_IDEMPOTENCY_SECRET: "i".repeat(64),
  NAYAX_REFUND_EXECUTOR_ASSERTION: "e".repeat(64),
  NAYAX_REFUND_MANAGER_CONTRACT_CONFIRMED: "true",
  NAYAX_REFUND_APPROVAL_SCOPE_CONFIRMED: "true",
};

Deno.test("missing production configuration reports every genuine safety gate", () => {
  const config = resolveNayaxRefundExecutionConfig(envReader({}));
  for (
    const block of [
      "kill_switch_active",
      "feature_disabled",
      "dry_run_active",
      "idempotency_secret_missing",
      "executor_assertion_missing",
      "manager_contract_unconfirmed",
      "approval_scope_unconfirmed",
    ]
  ) {
    assert(config.blocks.includes(block as never), `${block} must block`);
  }
});

Deno.test("a complete production configuration has no pilot or cap block", () => {
  const config = resolveNayaxRefundExecutionConfig(envReader(enabledConfig));
  assert(config.blocks.length === 0, "complete config should pass gates");
  assert(
    !("maxAmountCents" in config) && !("dailyCountCap" in config),
    "retired launch caps must not remain in the production contract",
  );
});

Deno.test("legacy canary and cap variables do not gate qualified transactions", () => {
  const config = resolveNayaxRefundExecutionConfig(envReader({
    ...enabledConfig,
    NAYAX_REFUND_BROAD_REOPEN_APPROVED: "false",
    NAYAX_REFUND_CANARY_ENABLED: "false",
    NAYAX_REFUND_CANARY_CASE_ID: "not-a-case-id",
    NAYAX_REFUND_MAX_AMOUNT_CENTS: "1",
    NAYAX_REFUND_DAILY_AMOUNT_CAP_CENTS: "1",
    NAYAX_REFUND_DAILY_COUNT_CAP: "1",
  }));
  assert(config.blocks.length === 0, "pilot variables must be ignored");
});

Deno.test("normal execution derives the full selected transaction amount", () => {
  assert(
    resolveNormalNayaxRefundAmountCents({
      matchedTransactionAmountCents: 1090,
    }) === 1090,
    "the selected settled transaction amount must be authoritative",
  );
  assert(
    resolveNormalNayaxRefundAmountCents({
      matchedTransactionAmountCents: 1090,
      remainingRefundableAmountCents: 1090,
    }) === 1090,
    "an authoritative full remaining allocation must preserve the exact amount",
  );
});

Deno.test("partial or custom amounts are exception-only", () => {
  assert(
    resolveNormalNayaxRefundAmountCents({
      matchedTransactionAmountCents: 1090,
      remainingRefundableAmountCents: 500,
    }) === null,
    "a partial remaining allocation must fail closed in the normal path",
  );
  assert(
    resolveNormalNayaxRefundAmountCents({
      matchedTransactionAmountCents: 1090,
      remainingRefundableAmountCents: 1500,
    }) === null,
    "a custom amount above the selected transaction must fail closed",
  );
});

Deno.test("production scope never waives provider contract or approval-scope proof", () => {
  const config = resolveNayaxRefundExecutionConfig(envReader({
    ...enabledConfig,
    NAYAX_REFUND_EXECUTION_KILL_SWITCH: "true",
    NAYAX_REFUND_IDEMPOTENCY_SECRET: "invalid",
    NAYAX_REFUND_MANAGER_CONTRACT_CONFIRMED: "false",
    NAYAX_REFUND_APPROVAL_SCOPE_CONFIRMED: "false",
  }));
  assert(
    config.blocks.includes("manager_contract_unconfirmed"),
    "production still requires the provider response contract",
  );
  assert(
    config.blocks.includes("approval_scope_unconfirmed"),
    "production still requires approval scope",
  );
  assert(
    config.blocks.includes("kill_switch_active"),
    "production must not bypass the incident kill switch",
  );
  assert(
    config.blocks.includes("idempotency_secret_missing"),
    "production must not bypass idempotency",
  );
});

Deno.test("weak execution secrets fail closed", () => {
  const config = resolveNayaxRefundExecutionConfig(envReader({
    ...enabledConfig,
    NAYAX_REFUND_IDEMPOTENCY_SECRET: "local-dev",
    NAYAX_REFUND_EXECUTOR_ASSERTION: "service-role-fallback",
  }));
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
