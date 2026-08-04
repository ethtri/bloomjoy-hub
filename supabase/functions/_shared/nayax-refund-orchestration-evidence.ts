import {
  orchestrateNayaxRefund,
  type NayaxAttemptSnapshot,
  type NayaxProviderOutcomeKind,
  type NayaxRefundOrchestrationResult,
} from "./nayax-refund-orchestration.ts";
import { createAuthenticatedEvidenceFragment } from
  "../../../scripts/refunds/refund-uat-fragment-provenance.mjs";

const parseArgs = () => {
  let outputDir = "output/refund-uat-fragments";
  for (let index = 0; index < Deno.args.length; index += 1) {
    const argument = Deno.args[index];
    if (argument === "--output-dir") {
      outputDir = Deno.args[index + 1] ?? outputDir;
      index += 1;
    } else if (argument.startsWith("--output-dir=")) {
      outputDir = argument.slice("--output-dir=".length) || outputDir;
    }
  }
  return { outputDir: outputDir.replace(/[\\/]+$/, "") };
};

const outcomeKinds: NayaxProviderOutcomeKind[] = [
  "success",
  "rejected",
  "timeout",
  "unknown",
];

let totalProviderAttempts = 0;
let replayProviderAttempts = 0;
let caseReportingCompletionCount = 0;
let originalThreadCompletionCount = 0;
let fallbackNoticeCount = 0;
let managerCompletionNoticeCount = 0;
const firstResults: NayaxRefundOrchestrationResult[] = [];
const replayResults: NayaxRefundOrchestrationResult[] = [];

for (const [index, outcomeKind] of outcomeKinds.entries()) {
  const ordinal = index + 1;
  const suffix = ordinal.toString().padStart(12, "0");
  const attemptId = `b1000000-0000-4000-8000-${suffix}`;
  const request = {
    caseId: `b2000000-0000-4000-8000-${suffix}`,
    idempotencyKey: `nayax-refund-${ordinal.toString().repeat(64)}`,
    amountCents: 700,
    currencyCode: "USD" as const,
  };
  let terminalAttempt: NayaxAttemptSnapshot | null = null;
  let completionDelivered = false;

  const dependencies = {
    provider: {
      mode: "synthetic" as const,
      execute: () => {
        totalProviderAttempts += 1;
        return Promise.resolve({
          kind: outcomeKind,
          providerReference: outcomeKind === "success"
            ? "SYNTHETIC-REFUND-SUCCESS"
            : null,
        });
      },
    },
    reserveAndConsumeAttempt: () => Promise.resolve({
      managerAction: {
        authorizationId: `b3000000-0000-4000-8000-${suffix}`,
        caseId: request.caseId,
        action: "nayax_execute" as const,
        targetFunction: "nayax-card-refund" as const,
        status: "consumed" as const,
        stepUpIntentId: `b4000000-0000-4000-8000-${suffix}`,
        verifiedTotpAt: "2026-08-03T12:00:00.000Z",
      },
      attempt: terminalAttempt ?? {
        attemptId,
        status: "in_progress",
        providerOutcome: null,
        shouldExecute: true,
        reconciliationRequired: false,
        reportingAdjustmentPresent: false,
        caseFinalizationCommitted: false,
      },
      providerClaimToken: terminalAttempt ? null : "a".repeat(64),
    }),
    settleProviderOutcome: ({ outcome }: { outcome: { kind: NayaxProviderOutcomeKind } }) => {
      const success = outcome.kind === "success";
      if (success) caseReportingCompletionCount += 1;
      terminalAttempt = {
        attemptId,
        status: success
          ? "succeeded"
          : outcome.kind === "rejected"
          ? "declined"
          : "ambiguous",
        providerOutcome: outcome.kind,
        shouldExecute: false,
        reconciliationRequired: outcome.kind === "timeout" ||
          outcome.kind === "unknown",
        reportingAdjustmentPresent: success,
        caseFinalizationCommitted: success,
      };
      return Promise.resolve({
        attempt: terminalAttempt,
        updateApplied: success,
        reportingAdjustmentPresent: success,
      });
    },
    deliverCustomerCompletion: () => {
      if (!completionDelivered) {
        completionDelivered = true;
        originalThreadCompletionCount += 1;
        return Promise.resolve({
          status: "sent" as const,
          transport: "gmail_thread" as const,
          managerCcCount: 2,
          originalThread: true,
          operationApplied: true,
          managerCompletionNoticeSent: false as const,
        });
      }
      return Promise.resolve({
        status: "already_sent" as const,
        transport: "gmail_thread" as const,
        managerCcCount: 2,
        originalThread: true,
        operationApplied: false,
        managerCompletionNoticeSent: false as const,
      });
    },
  };

  const firstResult = await orchestrateNayaxRefund({ request, dependencies });
  const providerCallsBeforeReplay = totalProviderAttempts;
  const replayResult = await orchestrateNayaxRefund({ request, dependencies });
  replayProviderAttempts += totalProviderAttempts - providerCallsBeforeReplay;

  for (const result of [firstResult, replayResult]) {
    if (result.fallbackIssued) fallbackNoticeCount += 1;
    if (result.customerCompletion?.managerCompletionNoticeSent) {
      managerCompletionNoticeCount += 1;
    }
  }
  firstResults.push(firstResult);
  replayResults.push(replayResult);
}

const counts: Record<NayaxProviderOutcomeKind, number> = {
  success: firstResults.filter((result) =>
    result.executed && result.status === "succeeded"
  ).length,
  rejected: firstResults.filter((result) =>
    result.errorCode === "provider_rejected"
  ).length,
  timeout: firstResults.filter((result) =>
    result.errorCode === "provider_timeout"
  ).length,
  unknown: firstResults.filter((result) =>
    result.errorCode === "provider_outcome_unknown"
  ).length,
};

const passed = outcomeKinds.every((kind) => counts[kind] === 1) &&
  replayResults.every((result) =>
    result.replayed === true && result.providerAttempted === false
  ) &&
  totalProviderAttempts === 4 &&
  replayProviderAttempts === 0 &&
  caseReportingCompletionCount === 1 &&
  originalThreadCompletionCount === 1 &&
  fallbackNoticeCount === 0 &&
  managerCompletionNoticeCount === 0;

if (!passed) throw new Error("Injected provider outcome evidence did not pass.");

const evidence = {
  schemaVersion: 1,
  evidenceType: "provider_outcomes",
  evidenceMode: "local_injected_provider_adapter",
  passed: true,
  successCount: counts.success,
  rejectionCount: counts.rejected,
  timeoutCount: counts.timeout,
  unknownCount: counts.unknown,
  totalProviderAttempts,
  replayProviderAttempts,
  caseReportingCompletionCount,
  originalThreadCompletionCount,
  fallbackNoticeCount,
  managerCompletionNoticeCount,
};

const { outputDir } = parseArgs();
const envelope = createAuthenticatedEvidenceFragment({
  filename: "refund-provider-outcomes.json",
  evidence,
  runToken: Deno.env.get("REFUND_UAT_EVIDENCE_RUN_TOKEN") ?? "",
});

await Deno.mkdir(outputDir, { recursive: true });
await Deno.writeTextFile(
  `${outputDir}/refund-provider-outcomes.json`,
  `${JSON.stringify(envelope, null, 2)}\n`,
  { createNew: true },
);
console.log(`Provider outcome evidence written to ${outputDir}`);
