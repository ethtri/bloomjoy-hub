import { buildNayaxMachineAuthorizationTimeWireValue } from "./nayax-machine-authorization-time.mjs";

export type NayaxQueuedRefundOutcome = {
  kind: "success" | "rejected" | "timeout" | "unknown";
  providerReference?: string | null;
  providerStatus?: string | null;
  errorCode?: string | null;
};

export type NayaxQueuedRefundClaim = {
  sourceApprovalId: string;
  caseId: string;
  authorityKind: "machine_manager" | "super_admin";
  attemptId: string;
  providerClaimToken: string;
  wire: {
    caseVersion: number;
    attemptGeneration: number;
    idempotencyKey: string;
    providerContractVersion: string;
    journalContractVersion: string;
    executionContextHash: string;
    accountScopeDigest: string;
    providerMachineId: string;
    transactionId: string;
    siteId: number;
    machineAuthorizationTime: string;
    machineAuthorizationTimeInstant: string;
    machineAuthorizationTimeWire: string;
    machineAuthorizationTimeSerializationMode:
      | "exact_source"
      | "source_with_bound_offset";
    refundEmailListMode: "omit" | "empty_string";
    originalAmountCents: number;
    currencyCode: "USD";
  };
};

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIGEST = /^[a-f0-9]{64}$/;
const objectValue = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;

export const parseNayaxQueuedRefundClaim = (
  value: unknown,
): NayaxQueuedRefundClaim | null => {
  const root = objectValue(value);
  const authorization = objectValue(root?.authorization);
  const attempt = objectValue(root?.attempt);
  const wire = objectValue(root?.providerWireContext);
  const sourceApprovalId = typeof authorization?.authorizationId === "string"
    ? authorization.authorizationId
    : "";
  const caseId = typeof authorization?.caseId === "string"
    ? authorization.caseId
    : "";
  const attemptId = typeof attempt?.attemptId === "string"
    ? attempt.attemptId
    : "";
  const rootAttemptId = typeof root?.attemptId === "string" ? root.attemptId : "";
  const providerClaimToken = typeof root?.providerClaimToken === "string"
    ? root.providerClaimToken
    : "";
  const caseVersion = Number(wire?.caseVersion);
  const attemptGeneration = Number(wire?.attemptGeneration);
  const siteId = Number(wire?.siteId);
  const amountCents = Number(wire?.originalAmountCents);
  const rawTime = typeof wire?.machineAuthorizationTime === "string"
    ? wire.machineAuthorizationTime
    : "";
  const instant = typeof wire?.machineAuthorizationTimeInstant === "string"
    ? wire.machineAuthorizationTimeInstant
    : "";
  const mode = String(wire?.machineAuthorizationTimeSerializationMode);
  let expectedWire = "";
  try {
    expectedWire = buildNayaxMachineAuthorizationTimeWireValue({
      rawValue: rawTime,
      normalizedInstant: instant,
      mode,
    });
  } catch {
    return null;
  }
  if (
    root?.payloadRedacted !== true || root.accountKey !== undefined ||
    authorization?.authorityType !== "manager_approval" ||
    !UUID.test(sourceApprovalId) || !UUID.test(caseId) || !UUID.test(attemptId) ||
    rootAttemptId !== attemptId ||
    attempt?.shouldExecute !== true || providerClaimToken.length < 43 ||
    wire?.caseId !== caseId || !Number.isInteger(caseVersion) || caseVersion < 1 ||
    !Number.isInteger(attemptGeneration) || attemptGeneration < 0 ||
    typeof wire?.idempotencyKey !== "string" ||
    !/^nayax-refund-[a-f0-9]{64}$/.test(wire.idempotencyKey) ||
    wire?.providerContractVersion !== "nayax-production-account-contract-v2" ||
    wire?.journalContractVersion !== "nayax-provider-journal-v3" ||
    typeof wire?.executionContextHash !== "string" || !DIGEST.test(wire.executionContextHash) ||
    typeof wire?.accountScopeDigest !== "string" || !DIGEST.test(wire.accountScopeDigest) ||
    typeof wire?.providerMachineId !== "string" || !wire.providerMachineId ||
    typeof wire?.transactionId !== "string" || !wire.transactionId ||
    !Number.isInteger(siteId) || siteId < 0 || !rawTime || !instant ||
    !Number.isFinite(Date.parse(instant)) ||
    typeof wire?.machineAuthorizationTimeWire !== "string" ||
    wire.machineAuthorizationTimeWire !== expectedWire ||
    !new Set(["exact_source", "source_with_bound_offset"]).has(mode) ||
    !new Set(["omit", "empty_string"]).has(String(wire?.refundEmailListMode)) ||
    !Number.isInteger(amountCents) || amountCents <= 0 || wire?.currencyCode !== "USD" ||
    !new Set(["machine_manager", "super_admin"]).has(String(authorization?.authorityKind))
  ) return null;
  return {
    sourceApprovalId,
    caseId,
    authorityKind: authorization!.authorityKind as "machine_manager" | "super_admin",
    attemptId,
    providerClaimToken,
    wire: {
      caseVersion,
      attemptGeneration,
      idempotencyKey: wire!.idempotencyKey as string,
      providerContractVersion: wire!.providerContractVersion as string,
      journalContractVersion: wire!.journalContractVersion as string,
      executionContextHash: wire!.executionContextHash as string,
      accountScopeDigest: wire!.accountScopeDigest as string,
      providerMachineId: wire!.providerMachineId as string,
      transactionId: wire!.transactionId as string,
      siteId,
      machineAuthorizationTime: rawTime,
      machineAuthorizationTimeInstant: instant,
      machineAuthorizationTimeWire: expectedWire,
      machineAuthorizationTimeSerializationMode: mode as "exact_source" | "source_with_bound_offset",
      refundEmailListMode: wire!.refundEmailListMode as "omit" | "empty_string",
      originalAmountCents: amountCents,
      currencyCode: "USD",
    },
  };
};

export const extractNayaxQueuedRefundAttemptId = (value: unknown) => {
  const root = objectValue(value);
  const attemptId = root?.attemptId ?? objectValue(root?.attempt)?.attemptId;
  return typeof attemptId === "string" && UUID.test(attemptId) ? attemptId : null;
};

export const drainNayaxQueuedRefunds = async ({
  limit,
  claimOne,
  executeProvider,
  settle,
  hold,
  deliverCompletion,
}: {
  limit: number;
  claimOne: () => Promise<unknown | null>;
  executeProvider: (claim: NayaxQueuedRefundClaim) => Promise<NayaxQueuedRefundOutcome>;
  settle: (
    claim: NayaxQueuedRefundClaim,
    outcome: NayaxQueuedRefundOutcome,
  ) => Promise<{ succeeded: boolean }>;
  hold: (attemptId: string, errorCode: string) => Promise<void>;
  deliverCompletion: (claim: NayaxQueuedRefundClaim) => Promise<void>;
}) => {
  if (!Number.isInteger(limit) || limit < 1 || limit > 5) {
    throw new Error("nayax_refund_attempt_queue_limit_invalid");
  }
  const results: Array<{
    caseId: string;
    executed: boolean;
    errorCode: string | null;
    completionErrorCode: string | null;
  }> = [];
  let invalidCount = 0;
  const durablyHold = async (attemptId: string, errorCode: string) => {
    let lastError: unknown = null;
    for (let holdTry = 0; holdTry < 2; holdTry += 1) {
      try {
        await hold(attemptId, errorCode);
        return;
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError ?? new Error("nayax_refund_attempt_hold_failed");
  };
  for (let index = 0; index < limit; index += 1) {
    const raw = await claimOne();
    if (raw === null) break;
    const claim = parseNayaxQueuedRefundClaim(raw);
    if (!claim) {
      invalidCount += 1;
      // Parsing happens before the provider boundary. Leave this same leased row
      // for the no-call reclaimer; a malformed payload is not evidence that a
      // provider call began and must not create a permanent hold by itself.
      continue;
    }
    try {
      let outcome: NayaxQueuedRefundOutcome;
      try {
        outcome = await executeProvider(claim);
      } catch (error) {
        const errorCode = error instanceof Error
          ? error.message
          : "nayax_refund_provider_execution_failed";
        await durablyHold(claim.attemptId, errorCode);
        results.push({ caseId: claim.caseId, executed: false, errorCode,
          completionErrorCode: null });
        continue;
      }
      let settlement: { succeeded: boolean } | null = null;
      let settlementError: unknown = null;
      for (let settlementTry = 0; settlementTry < 2; settlementTry += 1) {
        try {
          settlement = await settle(claim, outcome);
          settlementError = null;
          break;
        } catch (error) {
          settlementError = error;
        }
      }
      if (!settlement) {
        const errorCode = settlementError instanceof Error
          ? settlementError.message
          : "nayax_refund_attempt_settlement_failed";
        await durablyHold(claim.attemptId, errorCode);
        results.push({ caseId: claim.caseId, executed: false, errorCode,
          completionErrorCode: null });
        continue;
      }
      let completionErrorCode: string | null = null;
      if (settlement.succeeded) {
        try {
          await deliverCompletion(claim);
        } catch (error) {
          completionErrorCode = error instanceof Error
            ? error.message
            : "nayax_refund_completion_failed";
        }
      }
      results.push({
        caseId: claim.caseId,
        executed: settlement.succeeded,
        errorCode: outcome.errorCode ?? null,
        completionErrorCode,
      });
    } catch (error) {
      results.push({
        caseId: claim.caseId,
        executed: false,
        errorCode: error instanceof Error ? error.message : "nayax_refund_attempt_failed",
        completionErrorCode: null,
      });
    }
  }
  return {
    claimedCount: results.length + invalidCount,
    processedCount: results.length,
    invalidCount,
    results,
  };
};
