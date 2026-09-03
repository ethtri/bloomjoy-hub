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
  NAYAX_REFUND_IDEMPOTENCY_SECRET: "a".repeat(43),
  NAYAX_REFUND_EXECUTOR_ASSERTION: "b".repeat(43),
  NAYAX_REFUND_MANAGER_CONTRACT_CONFIRMED: "true",
  NAYAX_REFUND_APPROVAL_SCOPE_CONFIRMED: "true",
}[name]));

const databaseReady = parseDatabaseRefundReadiness({
  transactionConfirmed: true,
  canIssueCardRefund: true,
  blockReason: null,
  refundAmountCents: 700,
  machineLimitCents: 2000,
  caseVersion: 3,
});

Deno.test("confirmed database readiness needs no additional balance attestation", () => {
  assertEquals(
    mergeRuntimeRefundReadiness({
      databaseReadiness: databaseReady,
      executionConfig: readyConfig,
      officialActionsEnabled: true,
      providerCredentialAvailable: true,
    }),
    {
      ...databaseReady,
      canIssueCardRefund: true,
      blockReason: null,
    },
  );
});

Deno.test("a runtime pause has one stable manager-safe reason", () => {
  const paused = resolveNayaxRefundExecutionConfig((name) =>
    name === "NAYAX_REFUND_EXECUTION_KILL_SWITCH" ? "true" : ({
      NAYAX_REFUND_EXECUTION_ENABLED: "true",
      NAYAX_REFUND_EXECUTION_DRY_RUN: "false",
      NAYAX_REFUND_IDEMPOTENCY_SECRET: "a".repeat(43),
      NAYAX_REFUND_EXECUTOR_ASSERTION: "b".repeat(43),
      NAYAX_REFUND_MANAGER_CONTRACT_CONFIRMED: "true",
      NAYAX_REFUND_APPROVAL_SCOPE_CONFIRMED: "true",
    } as Record<string, string>)[name]
  );
  const result = mergeRuntimeRefundReadiness({
    databaseReadiness: databaseReady,
    executionConfig: paused,
    officialActionsEnabled: true,
    providerCredentialAvailable: true,
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
  });
  assertEquals(result.blockReason, "machine_not_enabled");
  assertEquals(result.transactionConfirmed, true);
});

Deno.test("a normal transaction amount needs no balance preflight or launch cap", () => {
  const result = mergeRuntimeRefundReadiness({
    databaseReadiness: {
      ...databaseReady,
      refundAmountCents: 32_100,
      machineLimitCents: null,
    },
    executionConfig: readyConfig,
    officialActionsEnabled: true,
    providerCredentialAvailable: true,
  });
  assertEquals(result.canIssueCardRefund, true);
  assertEquals(result.blockReason, null);
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
