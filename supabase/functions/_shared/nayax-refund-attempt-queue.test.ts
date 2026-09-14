import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  drainNayaxQueuedRefunds,
  extractNayaxQueuedRefundAttemptId,
  parseNayaxQueuedRefundClaim,
} from "./nayax-refund-attempt-queue.ts";

const id = (digit: string) => `${digit.repeat(8)}-${digit.repeat(4)}-4${digit.repeat(3)}-8${digit.repeat(3)}-${digit.repeat(12)}`;
const claim = () => ({
  attemptId: id("3"),
  authorization: {
    authorityType: "manager_approval",
    authorizationId: id("1"),
    caseId: id("2"),
    authorityKind: "machine_manager",
  },
  attempt: { attemptId: id("3"), shouldExecute: true },
  providerClaimToken: "x".repeat(43),
  providerWireContext: {
    caseId: id("2"), caseVersion: 2, attemptGeneration: 0,
    providerExecutionGeneration: 1, executionPlan: "request_and_approve",
    idempotencyKey: `nayax-refund-${"a".repeat(64)}`,
    providerContractVersion: "nayax-production-account-contract-v2",
    journalContractVersion: "nayax-provider-journal-v3",
    executionContextHash: "b".repeat(64), accountScopeDigest: "c".repeat(64),
    providerMachineId: "machine-1", transactionId: "transaction-1", siteId: 7,
    machineAuthorizationTime: "2026-09-05T18:15:00Z",
    machineAuthorizationTimeInstant: "2026-09-05T18:15:00Z",
    machineAuthorizationTimeWire: "2026-09-05T18:15:00Z",
    machineAuthorizationTimeSerializationMode: "exact_source",
    refundEmailListMode: "empty_string", originalAmountCents: 1090,
    currencyCode: "USD",
  },
  payloadRedacted: true,
});

Deno.test("parses one frozen System-owned attempt claim", () => {
  assertEquals(parseNayaxQueuedRefundClaim(claim())?.wire.originalAmountCents, 1090);
  assertEquals(parseNayaxQueuedRefundClaim({ ...claim(), accountKey: "secret" }), null);
});

Deno.test("one claim executes and settles once", async () => {
  let claimed = false;
  let executions = 0;
  let settlements = 0;
  const result = await drainNayaxQueuedRefunds({
    limit: 2,
    claimOne: () => {
      if (claimed) return Promise.resolve(null);
      claimed = true;
      return Promise.resolve(claim());
    },
    executeProvider: () => {
      executions += 1;
      return Promise.resolve({ kind: "unknown" });
    },
    settle: () => {
      settlements += 1;
      return Promise.resolve({ succeeded: false });
    },
    hold: () => Promise.resolve(),
    deliverCompletion: () => Promise.resolve(),
  });
  assertEquals({ executions, settlements }, { executions: 1, settlements: 1 });
  assertEquals(result, {
    claimedCount: 1, processedCount: 1, invalidCount: 0,
    results: [{ caseId: id("2"), executed: false, errorCode: null, completionErrorCode: null }],
  });
});

Deno.test("settlement failure retries only settlement then holds the same attempt", async () => {
  let claimed = false;
  let executions = 0;
  let settlements = 0;
  const held: string[] = [];
  const result = await drainNayaxQueuedRefunds({
    limit: 1,
    claimOne: () => Promise.resolve(claimed ? null : (claimed = true, claim())),
    executeProvider: () => {
      executions += 1;
      return Promise.resolve({ kind: "success", providerReference: "NAYAX-123456",
        providerStatus: "approve_succeeded_contract_match" });
    },
    settle: () => {
      settlements += 1;
      return Promise.reject(new Error("settlement_unavailable"));
    },
    hold: (attemptId) => { held.push(attemptId); return Promise.resolve(); },
    deliverCompletion: () => Promise.resolve(),
  });
  assertEquals({ executions, settlements, held }, {
    executions: 1, settlements: 2, held: [id("3")],
  });
  assertEquals(result.results[0]?.errorCode, "settlement_unavailable");
});

Deno.test("malformed identifiable claim never reaches provider and remains reclaimable", async () => {
  const malformed = { ...claim(), providerWireContext: null };
  let executions = 0;
  const held: string[] = [];
  assertEquals(extractNayaxQueuedRefundAttemptId(malformed), id("3"));
  const result = await drainNayaxQueuedRefunds({
    limit: 1,
    claimOne: () => Promise.resolve(malformed),
    executeProvider: () => { executions += 1; return Promise.resolve({ kind: "unknown" }); },
    settle: () => Promise.resolve({ succeeded: false }),
    hold: (attemptId) => { held.push(attemptId); return Promise.resolve(); },
    deliverCompletion: () => Promise.resolve(),
  });
  assertEquals({ executions, held, invalidCount: result.invalidCount },
    { executions: 0, held: [], invalidCount: 1 });
});

Deno.test("a transient hold failure retries only the hold", async () => {
  let holdCalls = 0;
  let executions = 0;
  await drainNayaxQueuedRefunds({
    limit: 1,
    claimOne: () => Promise.resolve(claim()),
    executeProvider: () => {
      executions += 1;
      return Promise.reject(new Error("provider_boundary_failed"));
    },
    settle: () => Promise.resolve({ succeeded: false }),
    hold: () => {
      holdCalls += 1;
      return holdCalls === 1 ? Promise.reject(new Error("hold_unavailable")) : Promise.resolve();
    },
    deliverCompletion: () => Promise.resolve(),
  });
  assertEquals({ executions, holdCalls }, { executions: 1, holdCalls: 2 });
});

Deno.test("an unidentifiable malformed value never reaches provider or settlement", async () => {
  let executions = 0;
  let settlements = 0;
  let holds = 0;
  const result = await drainNayaxQueuedRefunds({
    limit: 1,
    claimOne: () => Promise.resolve({ payloadRedacted: true }),
    executeProvider: () => { executions += 1; return Promise.resolve({ kind: "unknown" }); },
    settle: () => { settlements += 1; return Promise.resolve({ succeeded: false }); },
    hold: () => { holds += 1; return Promise.resolve(); },
    deliverCompletion: () => Promise.resolve(),
  });
  assertEquals({ executions, settlements, holds, invalidCount: result.invalidCount },
    { executions: 0, settlements: 0, holds: 0, invalidCount: 1 });
});
