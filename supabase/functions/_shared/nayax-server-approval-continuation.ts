import {
  type NayaxAttemptReservation,
  type NayaxAttemptSettlement,
  type NayaxCompletionDelivery,
  type NayaxExecutionRequest,
  type NayaxProviderAdapter,
  type NayaxRefundOrchestrationResult,
  orchestrateNayaxRefund,
} from "./nayax-refund-orchestration.ts";

export type NayaxServerApprovalContinuationClaim = {
  reservation: NayaxAttemptReservation;
  request: NayaxExecutionRequest;
  accountKey: string;
  transactionId: string;
  siteId: number;
  machineAuthorizationTimeWire: string;
  machineAuthorizationTimeMode: "exact_source" | "source_with_bound_offset";
  refundEmailListMode: "omit" | "empty_string";
};

type RawClaim = Record<string, unknown>;

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const objectValue = (value: unknown): RawClaim | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? value as RawClaim
    : null;

export const parseNayaxServerApprovalContinuationClaim = (
  value: unknown,
): NayaxServerApprovalContinuationClaim | null => {
  const root = objectValue(value);
  const attempt = objectValue(root?.attempt);
  const managerAction = objectValue(root?.managerAction);
  const context = objectValue(root?.executionContext);
  const caseId = typeof managerAction?.caseId === "string"
    ? managerAction.caseId
    : "";
  const attemptId = typeof attempt?.attemptId === "string"
    ? attempt.attemptId
    : "";
  const authorizationId = typeof managerAction?.authorizationId === "string"
    ? managerAction.authorizationId
    : "";
  const idempotencyKey = typeof attempt?.idempotencyKey === "string"
    ? attempt.idempotencyKey
    : typeof root?.idempotencyKey === "string"
    ? root.idempotencyKey
    : "";
  const amountCents = Number(context?.originalAmountCents);
  const siteId = Number(context?.siteId);
  const accountKey = typeof root?.accountKey === "string"
    ? root.accountKey.trim()
    : "";
  const transactionId = typeof context?.transactionId === "string"
    ? context.transactionId
    : "";
  const machineAuthorizationTimeWire =
    typeof context?.machineAuthorizationTimeWire === "string"
      ? context.machineAuthorizationTimeWire
      : typeof context?.machineAuthorizationTime === "string"
      ? context.machineAuthorizationTime
      : "";
  const machineAuthorizationTimeMode = context
    ?.machineAuthorizationTimeSerializationMode;
  const refundEmailListMode = context?.refundEmailListMode ?? "omit";
  const providerClaimToken = typeof root?.providerClaimToken === "string"
    ? root.providerClaimToken
    : "";

  if (
    root?.payloadRedacted !== true || !UUID.test(caseId) ||
    !UUID.test(attemptId) || !UUID.test(authorizationId) ||
    attempt?.shouldExecute !== true ||
    attempt?.executionPlan !== "approval_continuation" ||
    !/^nayax-refund-[a-f0-9]{64}$/.test(idempotencyKey) ||
    !Number.isInteger(amountCents) || amountCents <= 0 ||
    context?.currencyCode !== "USD" || !Number.isInteger(siteId) ||
    siteId < 0 || !accountKey || !transactionId ||
    !machineAuthorizationTimeWire || providerClaimToken.length < 43 ||
    (machineAuthorizationTimeMode !== "exact_source" &&
      machineAuthorizationTimeMode !== "source_with_bound_offset") ||
    (refundEmailListMode !== "omit" && refundEmailListMode !== "empty_string")
  ) return null;

  return {
    reservation: {
      managerAction: managerAction as NayaxAttemptReservation["managerAction"],
      attempt: attempt as NayaxAttemptReservation["attempt"],
      providerClaimToken,
    },
    request: { caseId, idempotencyKey, amountCents, currencyCode: "USD" },
    accountKey,
    transactionId,
    siteId,
    machineAuthorizationTimeWire,
    machineAuthorizationTimeMode,
    refundEmailListMode,
  };
};

export type NayaxServerApprovalContinuationDependencies = {
  claimDue: (limit: number) => Promise<unknown[]>;
  createApprovalProvider: (
    claim: NayaxServerApprovalContinuationClaim,
  ) => NayaxProviderAdapter;
  settleProviderOutcome: (input: {
    attemptId: string;
    authorizationId: string;
    providerClaimToken: string;
    request: NayaxExecutionRequest;
    outcome: {
      kind: "success" | "rejected" | "timeout" | "unknown";
      providerReference?: string | null;
      providerStatus?: string | null;
      errorCode?: string | null;
    };
  }) => Promise<NayaxAttemptSettlement>;
  deliverCustomerCompletion: (
    attemptId: string,
    caseId: string,
  ) => Promise<NayaxCompletionDelivery>;
};

export type NayaxServerApprovalContinuationDrainResult = {
  claimedCount: number;
  processedCount: number;
  invalidCount: number;
  results: NayaxRefundOrchestrationResult[];
};

export const drainNayaxServerApprovalContinuations = async ({
  limit,
  dependencies,
}: {
  limit: number;
  dependencies: NayaxServerApprovalContinuationDependencies;
}): Promise<NayaxServerApprovalContinuationDrainResult> => {
  if (!Number.isInteger(limit) || limit < 1 || limit > 5) {
    throw new Error("nayax_server_continuation_limit_invalid");
  }
  const rawClaims = await dependencies.claimDue(limit);
  const results: NayaxRefundOrchestrationResult[] = [];
  let invalidCount = 0;
  for (const rawClaim of rawClaims.slice(0, limit)) {
    const claim = parseNayaxServerApprovalContinuationClaim(rawClaim);
    if (!claim) {
      invalidCount += 1;
      continue;
    }
    const provider = dependencies.createApprovalProvider(claim);
    if (provider.mode === "disabled") {
      throw new Error(
        "nayax_server_continuation_provider_disabled_after_claim",
      );
    }
    results.push(
      await orchestrateNayaxRefund({
        request: claim.request,
        dependencies: {
          provider: {
            mode: provider.mode,
            execute: (request, executionPlan) => {
              if (executionPlan !== "approval_continuation") {
                throw new Error("nayax_server_continuation_request_forbidden");
              }
              return provider.execute(request, "approval_continuation");
            },
          },
          reserveAndConsumeAttempt: () => Promise.resolve(claim.reservation),
          settleProviderOutcome: dependencies.settleProviderOutcome,
          deliverCustomerCompletion: (attemptId) =>
            dependencies.deliverCustomerCompletion(
              attemptId,
              claim.request.caseId,
            ),
        },
      }),
    );
  }
  return {
    claimedCount: rawClaims.length,
    processedCount: results.length,
    invalidCount,
    results,
  };
};
