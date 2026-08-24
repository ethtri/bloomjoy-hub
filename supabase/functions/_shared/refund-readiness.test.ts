import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { resolveNayaxRefundExecutionConfig } from "./nayax-refund-gates.ts";
import {
  mergeRuntimeRefundReadiness,
  parseDatabaseRefundReadiness,
} from "./refund-readiness.ts";

const readyConfig = resolveNayaxRefundExecutionConfig((name) => ({
  NAYAX_REFUND_EXECUTION_KILL_SWITCH: "false",
  NAYAX_REFUND_EXECUTION_ENABLED: "true",
  NAYAX_REFUND_EXECUTION_DRY_RUN: "false",
  NAYAX_REFUND_MAX_AMOUNT_CENTS: "5000",
  NAYAX_REFUND_DAILY_AMOUNT_CAP_CENTS: "10000",
  NAYAX_REFUND_DAILY_COUNT_CAP: "10",
  NAYAX_REFUND_IDEMPOTENCY_SECRET: "a".repeat(43),
  NAYAX_REFUND_EXECUTOR_ASSERTION: "b".repeat(43),
}[name]));

const databaseReady = parseDatabaseRefundReadiness({
  transactionConfirmed: true,
  canIssueCardRefund: true,
  blockReason: null,
  refundAmountCents: 700,
  machineLimitCents: 2000,
  caseVersion: 3,
});

Deno.test("confirmed database readiness stays ready when runtime and provider pass", () => {
  assertEquals(
    mergeRuntimeRefundReadiness({
      databaseReadiness: databaseReady,
      executionConfig: readyConfig,
      officialActionsEnabled: true,
      providerCredentialAvailable: true,
      dailyAmountUsedCents: 0,
      dailyCountUsed: 0,
    }),
    databaseReady,
  );
});

Deno.test("a runtime pause has one stable manager-safe reason", () => {
  const paused = resolveNayaxRefundExecutionConfig((name) =>
    name === "NAYAX_REFUND_EXECUTION_KILL_SWITCH" ? "true" : ({
      NAYAX_REFUND_EXECUTION_ENABLED: "true",
      NAYAX_REFUND_EXECUTION_DRY_RUN: "false",
      NAYAX_REFUND_MAX_AMOUNT_CENTS: "5000",
      NAYAX_REFUND_DAILY_AMOUNT_CAP_CENTS: "10000",
      NAYAX_REFUND_DAILY_COUNT_CAP: "10",
      NAYAX_REFUND_IDEMPOTENCY_SECRET: "a".repeat(43),
      NAYAX_REFUND_EXECUTOR_ASSERTION: "b".repeat(43),
    } as Record<string, string>)[name]
  );
  const result = mergeRuntimeRefundReadiness({
    databaseReadiness: databaseReady,
    executionConfig: paused,
    officialActionsEnabled: true,
    providerCredentialAvailable: true,
    dailyAmountUsedCents: 0,
    dailyCountUsed: 0,
  });
  assertEquals(result.canIssueCardRefund, false);
  assertEquals(result.blockReason, "globally_paused");
  assertEquals(result.transactionConfirmed, true);
});

Deno.test("provider configuration never hides a database safety block", () => {
  const machineDisabled = parseDatabaseRefundReadiness({
    ...databaseReady,
    canIssueCardRefund: false,
    blockReason: "machine_not_enabled",
  });
  const result = mergeRuntimeRefundReadiness({
    databaseReadiness: machineDisabled,
    executionConfig: readyConfig,
    officialActionsEnabled: true,
    providerCredentialAvailable: false,
    dailyAmountUsedCents: 0,
    dailyCountUsed: 0,
  });
  assertEquals(result.blockReason, "machine_not_enabled");
  assertEquals(result.transactionConfirmed, true);
});

Deno.test("current daily usage is included in the server-owned cap answer", () => {
  const result = mergeRuntimeRefundReadiness({
    databaseReadiness: databaseReady,
    executionConfig: readyConfig,
    officialActionsEnabled: true,
    providerCredentialAvailable: true,
    dailyAmountUsedCents: 9_500,
    dailyCountUsed: 2,
  });
  assertEquals(result.canIssueCardRefund, false);
  assertEquals(result.blockReason, "cap_exceeded");
});

Deno.test("unknown database values fail closed without leaking internals", () => {
  assertEquals(
    parseDatabaseRefundReadiness({
      transactionConfirmed: true,
      canIssueCardRefund: true,
      blockReason: "raw_provider_exception",
      refundAmountCents: 700,
    }),
    {
      transactionConfirmed: true,
      canIssueCardRefund: false,
      blockReason: "provider_unavailable",
      refundAmountCents: 700,
      machineLimitCents: null,
      caseVersion: null,
    },
  );
});
