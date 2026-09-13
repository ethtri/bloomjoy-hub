import { buildNayaxMachineAuthorizationTimeWireValue } from "./nayax-machine-authorization-time.mjs";

export type NayaxSystemSavedApprovalOutcome = {
  kind: "success" | "rejected" | "timeout" | "unknown";
  providerReference?: string | null;
  providerStatus?: string | null;
  errorCode?: string | null;
};

export type NayaxSystemSavedApprovalClaim = {
  receiptId: string;
  sourceApprovalId: string;
  caseId: string;
  originalAuthorityKind: "machine_manager" | "super_admin";
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

export const parseNayaxSystemSavedApprovalClaim = (
  value: unknown,
): NayaxSystemSavedApprovalClaim | null => {
  const root = objectValue(value);
  const authority = objectValue(root?.systemSavedApproval);
  const attempt = objectValue(root?.attempt);
  const wire = objectValue(root?.providerWireContext);
  const receiptId = typeof authority?.systemSavedApprovalReceiptId === "string"
    ? authority.systemSavedApprovalReceiptId
    : "";
  const sourceApprovalId =
    typeof authority?.sourceApprovalAuthorizationId === "string"
      ? authority.sourceApprovalAuthorizationId
      : "";
  const caseId = typeof authority?.caseId === "string" ? authority.caseId : "";
  const attemptId = typeof attempt?.attemptId === "string"
    ? attempt.attemptId
    : "";
  const providerClaimToken = typeof root?.providerClaimToken === "string"
    ? root.providerClaimToken
    : "";
  const caseVersion = Number(wire?.caseVersion);
  const attemptGeneration = Number(wire?.attemptGeneration);
  const siteId = Number(wire?.siteId);
  const amountCents = Number(wire?.originalAmountCents);
  const machineAuthorizationTime =
    typeof wire?.machineAuthorizationTime === "string"
      ? wire.machineAuthorizationTime
      : "";
  const machineAuthorizationTimeInstant =
    typeof wire?.machineAuthorizationTimeInstant === "string"
      ? wire.machineAuthorizationTimeInstant
      : "";
  const serializationMode = String(
    wire?.machineAuthorizationTimeSerializationMode,
  );
  let expectedMachineAuthorizationTimeWire = "";
  try {
    expectedMachineAuthorizationTimeWire =
      buildNayaxMachineAuthorizationTimeWireValue({
        rawValue: machineAuthorizationTime,
        normalizedInstant: machineAuthorizationTimeInstant,
        mode: serializationMode,
      });
  } catch {
    return null;
  }
  if (
    root?.payloadRedacted !== true || root.accountKey !== undefined ||
    root.nayax_account_key !== undefined ||
    authority?.authorityType !== "system_saved_approval" ||
    !UUID.test(receiptId) || !UUID.test(sourceApprovalId) ||
    !UUID.test(caseId) ||
    !UUID.test(attemptId) || attempt?.shouldExecute !== true ||
    providerClaimToken.length < 43 ||
    wire?.caseId !== caseId || !Number.isInteger(caseVersion) ||
    caseVersion < 1 ||
    !Number.isInteger(attemptGeneration) || attemptGeneration < 0 ||
    typeof wire?.idempotencyKey !== "string" ||
    !/^nayax-refund-[a-f0-9]{64}$/.test(wire.idempotencyKey) ||
    wire?.providerContractVersion !== "nayax-production-account-contract-v2" ||
    wire?.journalContractVersion !== "nayax-provider-journal-v3" ||
    typeof wire?.executionContextHash !== "string" ||
    !DIGEST.test(wire.executionContextHash) ||
    typeof wire?.accountScopeDigest !== "string" ||
    !DIGEST.test(wire.accountScopeDigest) ||
    typeof wire?.providerMachineId !== "string" || !wire.providerMachineId ||
    typeof wire?.transactionId !== "string" || !wire.transactionId ||
    !Number.isInteger(siteId) || siteId < 0 ||
    !machineAuthorizationTime || !machineAuthorizationTimeInstant ||
    !Number.isFinite(Date.parse(machineAuthorizationTimeInstant)) ||
    typeof wire?.machineAuthorizationTimeWire !== "string" ||
    !wire.machineAuthorizationTimeWire ||
    wire.machineAuthorizationTimeWire !==
      expectedMachineAuthorizationTimeWire ||
    !new Set(["exact_source", "source_with_bound_offset"]).has(
      serializationMode,
    ) ||
    !new Set(["omit", "empty_string"]).has(String(wire?.refundEmailListMode)) ||
    !Number.isInteger(amountCents) || amountCents <= 0 ||
    wire?.currencyCode !== "USD" ||
    !new Set(["machine_manager", "super_admin"]).has(
      String(authority?.originalAuthorityKind),
    )
  ) return null;
  return {
    receiptId,
    sourceApprovalId,
    caseId,
    originalAuthorityKind: authority.originalAuthorityKind as
      | "machine_manager"
      | "super_admin",
    attemptId,
    providerClaimToken,
    wire: {
      caseVersion,
      attemptGeneration,
      idempotencyKey: wire.idempotencyKey,
      providerContractVersion: wire.providerContractVersion,
      journalContractVersion: wire.journalContractVersion,
      executionContextHash: wire.executionContextHash,
      accountScopeDigest: wire.accountScopeDigest,
      providerMachineId: wire.providerMachineId,
      transactionId: wire.transactionId,
      siteId,
      machineAuthorizationTime,
      machineAuthorizationTimeInstant,
      machineAuthorizationTimeWire: wire.machineAuthorizationTimeWire,
      machineAuthorizationTimeSerializationMode: wire
        .machineAuthorizationTimeSerializationMode as
          | "exact_source"
          | "source_with_bound_offset",
      refundEmailListMode: wire.refundEmailListMode as "omit" | "empty_string",
      originalAmountCents: amountCents,
      currencyCode: "USD",
    },
  };
};

export const drainNayaxSystemSavedApprovals = async ({
  limit,
  claimOne,
  executeProvider,
  settle,
  deliverCompletion,
}: {
  limit: number;
  claimOne: () => Promise<unknown | null>;
  executeProvider: (
    claim: NayaxSystemSavedApprovalClaim,
  ) => Promise<NayaxSystemSavedApprovalOutcome>;
  settle: (
    claim: NayaxSystemSavedApprovalClaim,
    outcome: NayaxSystemSavedApprovalOutcome,
  ) => Promise<{ succeeded: boolean }>;
  deliverCompletion: (claim: NayaxSystemSavedApprovalClaim) => Promise<void>;
}) => {
  if (!Number.isInteger(limit) || limit < 1 || limit > 5) {
    throw new Error("nayax_system_saved_approval_limit_invalid");
  }
  const results: Array<{
    caseId: string;
    executed: boolean;
    errorCode: string | null;
    completionErrorCode: string | null;
  }> = [];
  let invalidCount = 0;
  for (let index = 0; index < limit; index += 1) {
    const raw = await claimOne();
    if (raw === null) break;
    const claim = parseNayaxSystemSavedApprovalClaim(raw);
    if (!claim) {
      invalidCount += 1;
      continue;
    }
    try {
      const outcome = await executeProvider(claim);
      const settlement = await settle(claim, outcome);
      let completionErrorCode: string | null = null;
      if (settlement.succeeded) {
        try {
          await deliverCompletion(claim);
        } catch (error) {
          completionErrorCode = error instanceof Error
            ? error.message
            : "nayax_system_saved_approval_completion_failed";
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
        errorCode: error instanceof Error
          ? error.message
          : "nayax_system_saved_approval_failed",
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
