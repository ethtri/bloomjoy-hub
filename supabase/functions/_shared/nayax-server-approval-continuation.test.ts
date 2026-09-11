import {
  drainNayaxServerApprovalContinuations,
  parseNayaxServerApprovalContinuationClaim,
} from "./nayax-server-approval-continuation.ts";

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};

const claim = (overrides: Record<string, unknown> = {}) => ({
  managerAction: {
    authorizationId: "11111111-1111-4111-8111-111111111111",
    caseId: "22222222-2222-4222-8222-222222222222",
    action: "nayax_execute",
    targetFunction: "nayax-card-refund",
    status: "consumed",
    stepUpIntentId: "33333333-3333-4333-8333-333333333333",
    authorizationMethod: "totp",
    verifiedTotpAt: "2026-09-10T20:00:00.000Z",
  },
  attempt: {
    attemptId: "44444444-4444-4444-8444-444444444444",
    status: "in_progress",
    providerOutcome: null,
    shouldExecute: true,
    reconciliationRequired: false,
    reportingAdjustmentPresent: false,
    caseFinalizationCommitted: false,
    executionPlan: "approval_continuation",
  },
  providerClaimToken: "x".repeat(64),
  idempotencyKey: `nayax-refund-${"a".repeat(64)}`,
  accountKey: "PRODUCTION_ACCOUNT",
  executionContext: {
    transactionId: "TX-123456",
    siteId: 7,
    originalAmountCents: 1099,
    currencyCode: "USD",
    machineAuthorizationTime: "2026-09-10T12:00:00Z",
    machineAuthorizationTimeWire: "2026-09-10T12:00:00Z",
    machineAuthorizationTimeSerializationMode: "exact_source",
    refundEmailListMode: "omit",
  },
  payloadRedacted: true,
  ...overrides,
});

Deno.test("parses only a frozen approval-only claim", () => {
  assert(
    parseNayaxServerApprovalContinuationClaim(claim()) !== null,
    "valid claim should parse",
  );
  assert(
    parseNayaxServerApprovalContinuationClaim(claim({
      attempt: { ...claim().attempt, executionPlan: "request_and_approve" },
    })) === null,
    "request-and-approve must be rejected",
  );
  assert(
    parseNayaxServerApprovalContinuationClaim(claim({
      executionContext: {
        ...claim().executionContext,
        machineAuthorizationTimeWire: "",
      },
    })) === null,
    "missing frozen wire value must be rejected",
  );
});

Deno.test("restart claim executes approval once and completes accounting", async () => {
  let providerCalls = 0;
  let settlementCalls = 0;
  let completionCalls = 0;
  const output = await drainNayaxServerApprovalContinuations({
    limit: 2,
    dependencies: {
      claimDue: () => Promise.resolve([claim()]),
      createApprovalProvider: () => ({
        mode: "synthetic",
        execute: (_request, plan) => {
          assert(plan === "approval_continuation", "only approval is allowed");
          providerCalls += 1;
          return Promise.resolve({
            kind: "success",
            providerStatus: "accepted",
          });
        },
      }),
      settleProviderOutcome: (input) => {
        settlementCalls += 1;
        return Promise.resolve({
          updateApplied: true,
          reportingAdjustmentPresent: true,
          attempt: {
            attemptId: input.attemptId,
            status: "succeeded",
            providerOutcome: "success",
            shouldExecute: false,
            reconciliationRequired: false,
            reportingAdjustmentPresent: true,
            caseFinalizationCommitted: true,
          },
        });
      },
      deliverCustomerCompletion: () => {
        completionCalls += 1;
        return Promise.resolve({
          status: "deferred",
          transport: null,
          managerCcCount: 0,
          originalThread: false,
          operationApplied: false,
          managerCompletionNoticeSent: false,
        });
      },
    },
  });
  assert(output.processedCount === 1, "one due continuation should process");
  assert(providerCalls === 1, "one provider approval should run");
  assert(settlementCalls === 1, "one settlement should run");
  assert(completionCalls === 1, "success should enter completion/accounting");
});

Deno.test("unknown approval outcome is settled once and never completed", async () => {
  let providerCalls = 0;
  let completionCalls = 0;
  const dependencies = {
    claimDue: (() => {
      let first = true;
      return () => {
        const claims = first ? [claim()] : [];
        first = false;
        return Promise.resolve(claims);
      };
    })(),
    createApprovalProvider: () => ({
      mode: "synthetic" as const,
      execute: () => {
        providerCalls += 1;
        return Promise.resolve({
          kind: "unknown" as const,
          errorCode: "transport_unknown",
        });
      },
    }),
    settleProviderOutcome: (input: { attemptId: string }) =>
      Promise.resolve({
        updateApplied: true,
        reportingAdjustmentPresent: false,
        attempt: {
          attemptId: input.attemptId,
          status: "ambiguous",
          providerOutcome: "unknown" as const,
          shouldExecute: false,
          reconciliationRequired: true,
          reportingAdjustmentPresent: false,
          caseFinalizationCommitted: false,
        },
      }),
    deliverCustomerCompletion: () => {
      completionCalls += 1;
      throw new Error("completion must not run");
    },
  };
  await drainNayaxServerApprovalContinuations({ limit: 1, dependencies });
  await drainNayaxServerApprovalContinuations({ limit: 1, dependencies });
  assert(providerCalls === 1, "unknown outcome must not be retried");
  assert(completionCalls === 0, "unknown outcome cannot complete");
});
