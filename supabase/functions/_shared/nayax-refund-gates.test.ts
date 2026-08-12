import {
  buildNayaxRefundIdempotencyKey,
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
  NAYAX_REFUND_EXECUTION_SPONSOR_GO_NO_GO: "approved",
  NAYAX_REFUND_EXECUTION_PROVIDER_CONTRACT_CONFIRMED: "true",
  NAYAX_REFUND_MAX_AMOUNT_CENTS: "1000",
  NAYAX_REFUND_DAILY_AMOUNT_CAP_CENTS: "5000",
  NAYAX_REFUND_DAILY_COUNT_CAP: "10",
  NAYAX_REFUND_IDEMPOTENCY_SECRET: "i".repeat(64),
  NAYAX_REFUND_EXECUTOR_ASSERTION: "e".repeat(64),
};

Deno.test("default or missing rollout configuration reports every fail-closed gate", () => {
  const config = resolveNayaxRefundExecutionConfig(envReader({}));
  for (
    const block of [
      "kill_switch_active",
      "feature_disabled",
      "sponsor_approval_missing",
      "dry_run_active",
      "provider_contract_unconfirmed",
      "per_refund_cap_missing",
      "daily_amount_cap_missing",
      "daily_count_cap_missing",
      "idempotency_secret_missing",
      "executor_assertion_missing",
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
  assert(first === replay, "exact replay must retain one key");
  assert(first !== changed, "changed evidence must change the key");
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
