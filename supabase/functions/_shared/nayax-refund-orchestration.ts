export type NayaxProviderOutcomeKind =
  | "success"
  | "rejected"
  | "timeout"
  | "unknown";

export type NayaxProviderOutcome = {
  kind: NayaxProviderOutcomeKind;
  providerReference?: string | null;
  providerStatus?: string | null;
  errorCode?: string | null;
};

export type ConsumedNayaxManagerAction = {
  authorizationId: string;
  caseId: string;
  action: "nayax_execute";
  targetFunction: "nayax-card-refund";
  status: "consumed";
  stepUpIntentId: string;
  verifiedTotpAt: string;
};

export type NayaxExecutionRequest = {
  caseId: string;
  idempotencyKey: string;
  amountCents: number;
  currencyCode: "USD";
};

export type NayaxAttemptSnapshot = {
  attemptId: string;
  status: string;
  providerOutcome: NayaxProviderOutcomeKind | null;
  shouldExecute: boolean;
  reconciliationRequired: boolean;
  reportingAdjustmentPresent: boolean;
  caseFinalizationCommitted: boolean;
};

export type NayaxAttemptReservation = {
  managerAction: ConsumedNayaxManagerAction;
  attempt: NayaxAttemptSnapshot;
  providerClaimToken: string | null;
};

export type NayaxAttemptSettlement = {
  attempt: NayaxAttemptSnapshot;
  updateApplied: boolean;
  reportingAdjustmentPresent: boolean;
};

export type NayaxCompletionDelivery = {
  status: "sent" | "failed" | "delivery_unknown" | "already_sent";
  transport: "gmail_thread" | null;
  managerCcCount: number;
  originalThread: boolean;
  operationApplied: boolean;
  managerCompletionNoticeSent: false;
};

export type NayaxProviderAdapter = {
  mode: "disabled" | "synthetic";
  execute: (request: NayaxExecutionRequest) => Promise<NayaxProviderOutcome>;
};

export type NayaxRefundOrchestrationDependencies = {
  provider: NayaxProviderAdapter;
  reserveAndConsumeAttempt: (
    request: NayaxExecutionRequest,
  ) => Promise<NayaxAttemptReservation>;
  settleProviderOutcome: (input: {
    attemptId: string;
    authorizationId: string;
    providerClaimToken: string;
    request: NayaxExecutionRequest;
    outcome: NayaxProviderOutcome;
  }) => Promise<NayaxAttemptSettlement>;
  deliverCustomerCompletion: (
    attemptId: string,
  ) => Promise<NayaxCompletionDelivery>;
};

export type NayaxRefundOrchestrationResult = {
  executed: boolean;
  status: string;
  errorCode: string | null;
  providerAttempted: boolean;
  replayed: boolean;
  reconciliationRequired: boolean;
  fallbackIssued: false;
  reportingAdjustmentPresent: boolean;
  customerCompletion: NayaxCompletionDelivery | null;
  message: string;
};

const disabledResult = (): NayaxRefundOrchestrationResult => ({
  executed: false,
  status: "manual_review",
  errorCode: "provider_execution_not_yet_enabled",
  providerAttempted: false,
  replayed: false,
  reconciliationRequired: false,
  fallbackIssued: false,
  reportingAdjustmentPresent: false,
  customerCompletion: null,
  message:
    "Provider execution is intentionally stopped before a live Nayax refund call in this release slice.",
});

const assertConsumedManagerAction = (
  action: ConsumedNayaxManagerAction,
  request: NayaxExecutionRequest,
) => {
  if (
    !action.authorizationId ||
    action.caseId !== request.caseId ||
    action.action !== "nayax_execute" ||
    action.targetFunction !== "nayax-card-refund" ||
    action.status !== "consumed" ||
    !action.stepUpIntentId ||
    !action.verifiedTotpAt ||
    !Number.isFinite(Date.parse(action.verifiedTotpAt))
  ) {
    throw new Error(
      "Consumed manager action with exact TOTP evidence is required before provider execution.",
    );
  }
};

const assertProviderClaimToken = (token: string | null) => {
  // The database issues 256 random bits and stores only a digest. This guard
  // prevents a malformed reservation from reaching even a synthetic adapter.
  if (!token || token.length < 43) {
    throw new Error(
      "An attempt-scoped provider claim is required before provider execution.",
    );
  }
};

const errorCodeForOutcome = (outcome: NayaxProviderOutcomeKind) => {
  if (outcome === "rejected") return "provider_rejected";
  if (outcome === "timeout") return "provider_timeout";
  if (outcome === "unknown") return "provider_outcome_unknown";
  return null;
};

const statusForOutcome = (outcome: NayaxProviderOutcomeKind) => {
  if (outcome === "rejected") return "declined";
  if (outcome === "timeout" || outcome === "unknown") return "ambiguous";
  return "approved";
};

const incompleteResult = ({
  attempt,
  providerAttempted,
  replayed,
}: {
  attempt: NayaxAttemptSnapshot;
  providerAttempted: boolean;
  replayed: boolean;
}): NayaxRefundOrchestrationResult => {
  const outcome = attempt.providerOutcome ?? "unknown";
  const reconciliationRequired = outcome === "timeout" || outcome === "unknown" ||
    attempt.reconciliationRequired;
  return {
    executed: false,
    status: statusForOutcome(outcome),
    errorCode: errorCodeForOutcome(outcome),
    providerAttempted,
    replayed,
    reconciliationRequired,
    fallbackIssued: false,
    reportingAdjustmentPresent: false,
    customerCompletion: null,
    message: outcome === "rejected"
      ? "Nayax did not accept the refund. The case remains open for manager review."
      : "The Nayax outcome is not confirmed. The case is held for reconciliation and must not be retried.",
  };
};

const incompleteSuccessResult = ({
  providerAttempted,
  replayed,
}: {
  providerAttempted: boolean;
  replayed: boolean;
}): NayaxRefundOrchestrationResult => ({
  executed: false,
  status: "ambiguous",
  errorCode: "success_finalization_incomplete",
  providerAttempted,
  replayed,
  reconciliationRequired: true,
  fallbackIssued: false,
  reportingAdjustmentPresent: false,
  customerCompletion: null,
  message:
    "Provider success lacks committed case/reporting evidence. Customer contact is held for reconciliation.",
});

const isCommittedSuccess = (attempt: NayaxAttemptSnapshot) =>
  attempt.providerOutcome === "success" &&
  attempt.status === "succeeded" &&
  attempt.reportingAdjustmentPresent === true &&
  attempt.caseFinalizationCommitted === true &&
  attempt.reconciliationRequired === false;

const deliverCommittedCompletion = async (
  dependencies: NayaxRefundOrchestrationDependencies,
  attemptId: string,
): Promise<NayaxCompletionDelivery> => {
  try {
    return await dependencies.deliverCustomerCompletion(attemptId);
  } catch {
    // Payment/case/reporting success is already committed. A transport failure
    // can require email reconciliation, but must never reclassify the payment
    // as uncertain or invite another provider attempt.
    return {
      status: "delivery_unknown",
      transport: null,
      managerCcCount: 0,
      originalThread: false,
      operationApplied: false,
      managerCompletionNoticeSent: false,
    };
  }
};

export const disabledNayaxProviderAdapter: NayaxProviderAdapter = {
  mode: "disabled",
  execute: () => Promise.resolve({
    kind: "unknown",
    errorCode: "provider_execution_not_yet_enabled",
  }),
};

export const orchestrateNayaxRefund = async ({
  request,
  dependencies,
}: {
  request: NayaxExecutionRequest;
  dependencies: NayaxRefundOrchestrationDependencies;
}): Promise<NayaxRefundOrchestrationResult> => {
  // The HTTP handler imports this adapter directly. There is intentionally no
  // environment or request-body switch that can select the synthetic lane.
  if (dependencies.provider.mode === "disabled") return disabledResult();

  const reservation = await dependencies.reserveAndConsumeAttempt(request);
  assertConsumedManagerAction(reservation.managerAction, request);

  const attempt = reservation.attempt;
  if (!attempt.shouldExecute) {
    if (attempt.providerOutcome === "success") {
      if (!isCommittedSuccess(attempt)) {
        return incompleteSuccessResult({
          providerAttempted: false,
          replayed: true,
        });
      }
      const customerCompletion = await deliverCommittedCompletion(
        dependencies,
        attempt.attemptId,
      );
      return {
        executed: true,
        status: "succeeded",
        errorCode: null,
        providerAttempted: false,
        replayed: true,
        reconciliationRequired: false,
        fallbackIssued: false,
        reportingAdjustmentPresent: attempt.reportingAdjustmentPresent,
        customerCompletion,
        message: "The already-confirmed refund was reconciled without another provider call.",
      };
    }

    return incompleteResult({
      attempt: attempt.providerOutcome
        ? attempt
        : {
          ...attempt,
          status: "ambiguous",
          providerOutcome: "unknown",
          reconciliationRequired: true,
        },
      providerAttempted: false,
      replayed: true,
    });
  }

  assertProviderClaimToken(reservation.providerClaimToken);

  let providerOutcome: NayaxProviderOutcome;
  try {
    providerOutcome = await dependencies.provider.execute(request);
  } catch {
    providerOutcome = {
      kind: "unknown",
      errorCode: "provider_transport_exception",
    };
  }

  const settlement = await dependencies.settleProviderOutcome({
    attemptId: attempt.attemptId,
    authorizationId: reservation.managerAction.authorizationId,
    providerClaimToken: reservation.providerClaimToken!,
    request,
    outcome: providerOutcome,
  });
  const settledAttempt = settlement.attempt;

  if (settledAttempt.providerOutcome !== "success") {
    return incompleteResult({
      attempt: settledAttempt,
      providerAttempted: true,
      replayed: false,
    });
  }

  if (
    !isCommittedSuccess(settledAttempt) ||
    !settlement.reportingAdjustmentPresent
  ) {
    return incompleteSuccessResult({
      providerAttempted: true,
      replayed: false,
    });
  }

  const customerCompletion = await deliverCommittedCompletion(
    dependencies,
    attempt.attemptId,
  );

  return {
    executed: true,
    status: "succeeded",
    errorCode: null,
    providerAttempted: true,
    replayed: false,
    reconciliationRequired: false,
    fallbackIssued: false,
    reportingAdjustmentPresent: settlement.reportingAdjustmentPresent,
    customerCompletion,
    message: customerCompletion.status === "sent" ||
        customerCompletion.status === "already_sent"
      ? "Card refund completed and the customer was notified in the original Gmail thread."
      : "Card refund completed, but the customer completion message needs reconciliation.",
  };
};
