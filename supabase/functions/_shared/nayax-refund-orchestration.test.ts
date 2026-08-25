import {
  disabledNayaxProviderAdapter,
  type NayaxAttemptSnapshot,
  type NayaxCompletionDelivery,
  type NayaxProviderAdapter,
  type NayaxRefundOrchestrationDependencies,
  orchestrateNayaxRefund,
} from "./nayax-refund-orchestration.ts";

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};

const request = {
  caseId: "76000000-0000-4000-8000-000000000001",
  idempotencyKey: `nayax-refund-${"a".repeat(64)}`,
  amountCents: 700,
  currencyCode: "USD" as const,
};

const managerAction = {
  authorizationId: "76100000-0000-4000-8000-000000000001",
  caseId: request.caseId,
  action: "nayax_execute" as const,
  targetFunction: "nayax-card-refund" as const,
  status: "consumed" as const,
  stepUpIntentId: "76200000-0000-4000-8000-000000000001",
  verifiedTotpAt: "2026-08-03T18:00:01.000Z",
};

const makeHarness = (provider: NayaxProviderAdapter) => {
  let providerAttempts = 0;
  let persisted: NayaxAttemptSnapshot | null = null;
  let finalizationOperations = 0;
  let customerOperations = 0;
  let caseOpen = true;
  let reportingAdjustmentPresent = false;
  let completionSent = false;
  const providerClaimToken = "provider-claim-" + "c".repeat(64);
  let providerClaimUsed = false;

  const wrappedProvider: NayaxProviderAdapter = {
    mode: provider.mode,
    execute: async (input) => {
      providerAttempts += 1;
      return await provider.execute(input);
    },
  };

  const dependencies: NayaxRefundOrchestrationDependencies = {
    provider: wrappedProvider,
    reserveAndConsumeAttempt: (_request) => {
      if (persisted) {
        if (!persisted.providerOutcome) {
          persisted = {
            ...persisted,
            status: "ambiguous",
            providerOutcome: "unknown",
            reconciliationRequired: true,
          };
        }
        return Promise.resolve({
          managerAction,
          attempt: { ...persisted, shouldExecute: false },
          providerClaimToken: null,
        });
      }
      persisted = {
        attemptId: "76300000-0000-4000-8000-000000000001",
        status: "in_progress",
        providerOutcome: null,
        shouldExecute: true,
        reconciliationRequired: false,
        reportingAdjustmentPresent: false,
        caseFinalizationCommitted: false,
      };
      return Promise.resolve({
        managerAction,
        attempt: { ...persisted },
        providerClaimToken,
      });
    },
    settleProviderOutcome: (input) => {
      if (!persisted) throw new Error("attempt required");
      if (
        providerClaimUsed || input.providerClaimToken !== providerClaimToken ||
        input.authorizationId !== managerAction.authorizationId ||
        input.request.caseId !== request.caseId ||
        input.request.idempotencyKey !== request.idempotencyKey
      ) {
        throw new Error("valid unused provider claim required");
      }
      providerClaimUsed = true;
      const ambiguous = input.outcome.kind === "timeout" ||
        input.outcome.kind === "unknown";
      if (input.outcome.kind === "success") {
        finalizationOperations += 1;
        caseOpen = false;
        reportingAdjustmentPresent = true;
      }
      persisted = {
        ...persisted,
        status: input.outcome.kind === "success"
          ? "succeeded"
          : input.outcome.kind === "rejected"
          ? "declined"
          : "ambiguous",
        providerOutcome: input.outcome.kind,
        providerStatus: input.outcome.providerStatus ?? null,
        errorCode: input.outcome.errorCode ?? null,
        shouldExecute: false,
        reconciliationRequired: ambiguous,
        reportingAdjustmentPresent,
        caseFinalizationCommitted: input.outcome.kind === "success",
      };
      return Promise.resolve({
        attempt: { ...persisted },
        updateApplied: input.outcome.kind === "success",
        reportingAdjustmentPresent,
      });
    },
    deliverCustomerCompletion: () => {
      if (caseOpen || !reportingAdjustmentPresent) {
        throw new Error("case finalization required");
      }
      const operationApplied = !completionSent;
      if (operationApplied) {
        customerOperations += 1;
        completionSent = true;
      }
      const delivery: NayaxCompletionDelivery = {
        status: operationApplied ? "sent" : "already_sent",
        transport: "gmail_thread",
        managerCcCount: 2,
        originalThread: true,
        operationApplied,
        managerCompletionNoticeSent: false,
      };
      return Promise.resolve(delivery);
    },
  };

  return {
    dependencies,
    state: () => ({
      providerAttempts,
      finalizationOperations,
      customerOperations,
      caseOpen,
      reportingAdjustmentPresent,
      providerOutcome: persisted?.providerOutcome ?? null,
      reconciliationRequired: persisted?.reconciliationRequired ?? false,
    }),
  };
};

Deno.test("production adapter is hard-disabled before manager action or attempt reservation", async () => {
  let atomicReservations = 0;
  const result = await orchestrateNayaxRefund({
    request,
    dependencies: {
      provider: disabledNayaxProviderAdapter,
      reserveAndConsumeAttempt: () => {
        atomicReservations += 1;
        throw new Error("must stay unreachable");
      },
      settleProviderOutcome: () => {
        throw new Error("must stay unreachable");
      },
      deliverCustomerCompletion: () => {
        throw new Error("must stay unreachable");
      },
    },
  });
  assert(
    result.errorCode === "provider_execution_not_yet_enabled",
    "hard-off code required",
  );
  assert(
    !result.providerAttempted,
    "disabled adapter must make no provider attempt",
  );
  assert(
    atomicReservations === 0,
    "disabled lane must not consume manager evidence",
  );
});

Deno.test("fresh exact manager TOTP drives one success attempt, one finalization, and one original-thread customer operation", async () => {
  const harness = makeHarness({
    mode: "synthetic",
    execute: () =>
      Promise.resolve({
        kind: "success",
        providerReference: "SYNTHETIC-NAYAX-SUCCESS-1",
        providerStatus: "approved",
      }),
  });

  const first = await orchestrateNayaxRefund({
    request,
    dependencies: harness.dependencies,
  });
  const replay = await orchestrateNayaxRefund({
    request,
    dependencies: harness.dependencies,
  });
  const state = harness.state();

  assert(
    first.executed && first.status === "succeeded",
    "success must finalize",
  );
  assert(first.reportingAdjustmentPresent, "success must write reporting");
  assert(
    first.customerCompletion?.status === "sent",
    "customer completion must send",
  );
  assert(
    first.customerCompletion?.transport === "gmail_thread",
    "Gmail thread transport required",
  );
  assert(
    first.customerCompletion?.originalThread === true,
    "original thread required",
  );
  assert(
    (first.customerCompletion?.managerCcCount ?? 0) > 0,
    "current managers must be copied",
  );
  assert(
    first.customerCompletion?.managerCompletionNoticeSent === false,
    "no manager completion notice allowed",
  );
  assert(
    replay.executed && replay.replayed && !replay.providerAttempted,
    "replay must reconcile without provider",
  );
  assert(
    state.providerAttempts === 1,
    "provider must be attempted exactly once",
  );
  assert(
    state.finalizationOperations === 1,
    "case/reporting finalization must apply exactly once",
  );
  assert(
    state.customerOperations === 1,
    "customer completion must apply exactly once",
  );
});

Deno.test("authenticated manager-session authorization can drive the same bounded provider attempt", async () => {
  const harness = makeHarness({
    mode: "synthetic",
    execute: () => Promise.resolve({ kind: "success" }),
  });
  const originalReserve = harness.dependencies.reserveAndConsumeAttempt;
  harness.dependencies.reserveAndConsumeAttempt = async (input) => {
    const reservation = await originalReserve(input);
    return {
      ...reservation,
      managerAction: {
        ...reservation.managerAction,
        authorizationMethod: "manager_session",
        authorizedAt: "2026-08-16T18:00:01.000Z",
        verifiedTotpAt: null,
      },
    };
  };

  const result = await orchestrateNayaxRefund({
    request,
    dependencies: harness.dependencies,
  });

  assert(result.executed && result.status === "succeeded", "manager session must be accepted");
  assert(harness.state().providerAttempts === 1, "manager session must still produce exactly one provider attempt");
});

Deno.test("committed success stays successful when customer delivery throws", async () => {
  const harness = makeHarness({
    mode: "synthetic",
    execute: () =>
      Promise.resolve({
        kind: "success",
        providerReference: "SYNTHETIC-SUCCESS-DELIVERY-UNKNOWN",
      }),
  });
  harness.dependencies.deliverCustomerCompletion = () => {
    throw new Error("synthetic transport crash");
  };

  const result = await orchestrateNayaxRefund({
    request,
    dependencies: harness.dependencies,
  });
  const replay = await orchestrateNayaxRefund({
    request,
    dependencies: harness.dependencies,
  });
  const state = harness.state();

  assert(
    result.executed && result.status === "succeeded",
    "committed payment must remain successful",
  );
  assert(
    result.reportingAdjustmentPresent,
    "reporting completion must remain visible",
  );
  assert(
    result.customerCompletion?.status === "delivery_unknown",
    "email-only uncertainty required",
  );
  assert(
    result.errorCode === "customer_completion_delivery_failure" &&
      result.reconciliationRequired,
    "delivery-only failure must be classified without changing payment success",
  );
  assert(
    replay.executed && replay.replayed && !replay.providerAttempted,
    "replay must not call provider",
  );
  assert(
    state.providerAttempts === 1,
    "delivery failure must never cause a second provider attempt",
  );
  assert(
    state.finalizationOperations === 1,
    "case/reporting finalization remains exactly once",
  );
});

Deno.test("journal failure classification survives settlement and never reaches success", async () => {
  const harness = makeHarness({
    mode: "live",
    execute: () => {
      throw new Error("stage_journal_request_result_rejected");
    },
  });
  const result = await orchestrateNayaxRefund({
    request,
    dependencies: harness.dependencies,
  });
  assert(!result.executed && result.status === "ambiguous", "journal failure must hold");
  assert(
    result.errorCode === "stage_journal_request_result_rejected",
    "the actionable journal failure code must be retained",
  );
  assert(
    harness.state().providerAttempts === 1 && result.reconciliationRequired,
    "journal ambiguity must never invite a retry",
  );
});

for (const kind of ["success", "rejected"] as const) {
  Deno.test(`settlement failure after provider ${kind} is held without downstream effects`, async () => {
    const harness = makeHarness({
      mode: "synthetic",
      execute: () => Promise.resolve({ kind }),
    });
    harness.dependencies.settleProviderOutcome = () => {
      throw new Error("synthetic database outage");
    };
    const result = await orchestrateNayaxRefund({
      request,
      dependencies: harness.dependencies,
    });
    assert(!result.executed && result.status === "ambiguous", "settlement failure must hold");
    assert(
      result.errorCode === (kind === "success"
        ? "settlement_failure_after_provider_success"
        : "settlement_failure_after_provider_result"),
      "settlement failure must retain its exact phase classification",
    );
    assert(
      result.providerAttempted && result.reconciliationRequired &&
        result.customerCompletion === null && !result.reportingAdjustmentPresent,
      "settlement failure must stop all downstream effects",
    );
  });
}

for (
  const scenario of [
    { kind: "rejected" as const, status: "declined", reconciliation: false },
    { kind: "timeout" as const, status: "ambiguous", reconciliation: true },
    { kind: "unknown" as const, status: "ambiguous", reconciliation: true },
  ]
) {
  Deno.test(`${scenario.kind} keeps the case open, suppresses success mail/fallback, and never blindly retries`, async () => {
    const harness = makeHarness({
      mode: "synthetic",
      execute: () =>
        Promise.resolve({
          kind: scenario.kind,
          errorCode: `synthetic_${scenario.kind}`,
        }),
    });

    const first = await orchestrateNayaxRefund({
      request,
      dependencies: harness.dependencies,
    });
    const replay = await orchestrateNayaxRefund({
      request,
      dependencies: harness.dependencies,
    });
    const state = harness.state();

    assert(
      !first.executed && first.status === scenario.status,
      "case must stay incomplete",
    );
    assert(
      first.customerCompletion === null && first.fallbackIssued === false,
      "no success mail or fallback",
    );
    assert(
      first.reconciliationRequired === scenario.reconciliation,
      "hold classification must match outcome",
    );
    assert(
      replay.replayed && !replay.providerAttempted,
      "replay must not call provider",
    );
    assert(
      state.providerAttempts === 1,
      "provider attempt must remain exactly one",
    );
    assert(state.caseOpen, "case must remain open");
    assert(
      state.finalizationOperations === 0 && state.customerOperations === 0,
      "no success side effects allowed",
    );
  });
}

Deno.test("missing manager authorization timestamp fails before provider execution", async () => {
  const harness = makeHarness({
    mode: "synthetic",
    execute: () => Promise.resolve({ kind: "success" }),
  });
  harness.dependencies.reserveAndConsumeAttempt = () =>
    Promise.resolve({
      managerAction: {
        ...managerAction,
        verifiedTotpAt: "",
      },
      attempt: {
        attemptId: "76300000-0000-4000-8000-000000000002",
        status: "in_progress",
        providerOutcome: null,
        shouldExecute: true,
        reconciliationRequired: false,
        reportingAdjustmentPresent: false,
        caseFinalizationCommitted: false,
      },
      providerClaimToken: "provider-claim-" + "d".repeat(64),
    });

  let rejected = false;
  try {
    await orchestrateNayaxRefund({
      request,
      dependencies: harness.dependencies,
    });
  } catch (error) {
    rejected = error instanceof Error &&
      error.message.includes("Consumed manager authorization");
  }
  assert(rejected, "missing manager authorization must fail closed");
  assert(
    harness.state().providerAttempts === 0,
    "provider must remain untouched",
  );
});

Deno.test("missing attempt-scoped provider claim fails before provider execution", async () => {
  const harness = makeHarness({
    mode: "synthetic",
    execute: () => Promise.resolve({ kind: "success" }),
  });
  const originalReserve = harness.dependencies.reserveAndConsumeAttempt;
  harness.dependencies.reserveAndConsumeAttempt = async (input) => ({
    ...(await originalReserve(input)),
    providerClaimToken: null,
  });

  let rejected = false;
  try {
    await orchestrateNayaxRefund({
      request,
      dependencies: harness.dependencies,
    });
  } catch (error) {
    rejected = error instanceof Error &&
      error.message.includes("provider claim");
  }
  assert(rejected, "missing provider claim must fail closed");
  assert(
    harness.state().providerAttempts === 0,
    "provider must remain untouched",
  );
});

Deno.test("replaying an unsettled reservation becomes an unknown hold without a provider retry", async () => {
  const harness = makeHarness({
    mode: "synthetic",
    execute: () => Promise.resolve({ kind: "success" }),
  });
  await harness.dependencies.reserveAndConsumeAttempt(request);

  const replay = await orchestrateNayaxRefund({
    request,
    dependencies: harness.dependencies,
  });
  const state = harness.state();
  assert(
    replay.replayed && !replay.providerAttempted,
    "crash replay must not call provider",
  );
  assert(
    replay.status === "ambiguous" && replay.reconciliationRequired,
    "crash replay must hold unknown",
  );
  assert(
    state.providerAttempts === 0,
    "provider must never be called after reservation replay",
  );
  assert(
    state.finalizationOperations === 0 && state.customerOperations === 0,
    "no success effects allowed",
  );
});

for (const phase of ["replay", "settlement"] as const) {
  Deno.test(`${phase} success without committed finalization/reporting is held without customer mail`, async () => {
    let customerOperations = 0;
    const shouldExecute = phase === "settlement";
    const result = await orchestrateNayaxRefund({
      request,
      dependencies: {
        provider: {
          mode: "synthetic",
          execute: () => Promise.resolve({ kind: "success" }),
        },
        reserveAndConsumeAttempt: () =>
          Promise.resolve({
            managerAction,
            providerClaimToken: shouldExecute
              ? "provider-claim-" + "e".repeat(64)
              : null,
            attempt: {
              attemptId: "76300000-0000-4000-8000-000000000099",
              status: shouldExecute ? "in_progress" : "approved",
              providerOutcome: shouldExecute ? null : "success",
              shouldExecute,
              reconciliationRequired: false,
              reportingAdjustmentPresent: phase === "replay",
              caseFinalizationCommitted: false,
            },
          }),
        settleProviderOutcome: () =>
          Promise.resolve({
            attempt: {
              attemptId: "76300000-0000-4000-8000-000000000099",
              status: "succeeded",
              providerOutcome: "success",
              shouldExecute: false,
              reconciliationRequired: false,
              reportingAdjustmentPresent: false,
              caseFinalizationCommitted: false,
            },
            updateApplied: false,
            reportingAdjustmentPresent: false,
          }),
        deliverCustomerCompletion: () => {
          customerOperations += 1;
          throw new Error("must stay unreachable");
        },
      },
    });
    assert(
      !result.executed && result.reconciliationRequired,
      "partial success must be held",
    );
    assert(
      result.errorCode === "success_finalization_incomplete",
      "explicit invariant error required",
    );
    assert(
      result.customerCompletion === null && customerOperations === 0,
      "customer mail must stay suppressed",
    );
  });
}
