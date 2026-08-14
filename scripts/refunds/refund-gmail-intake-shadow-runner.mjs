#!/usr/bin/env node

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRefundGmailIntakeShadowClients } from './refund-gmail-intake-shadow-runner-clients.mjs';
import {
  buildRefundGmailIntakeShadowConfig,
  loadRefundGmailIntakeShadowEnvironment,
  parseRefundGmailIntakeShadowArgs,
} from './refund-gmail-intake-shadow-runner-config.mjs';
import {
  REFUND_INTAKE_SHADOW_PROJECT_REF,
  RefundGmailIntakeShadowRunnerError,
  executeRefundGmailIntakeShadow,
  runWithTimeout,
} from './refund-gmail-intake-shadow-runner-lib.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const safeLogger = (record) => {
  process.stdout.write(`${JSON.stringify(record)}\n`);
};

const signalController = new AbortController();
let interrupted = false;
const interrupt = () => {
  interrupted = true;
  if (!signalController.signal.aborted) {
    signalController.abort(new RefundGmailIntakeShadowRunnerError('intake_interrupted'));
  }
};
process.on('SIGINT', interrupt);
process.on('SIGTERM', interrupt);

try {
  const args = parseRefundGmailIntakeShadowArgs(process.argv.slice(2));
  const config = buildRefundGmailIntakeShadowConfig({
    ...args,
    env: loadRefundGmailIntakeShadowEnvironment(args.envFile),
  });
  if (config.projectRef !== REFUND_INTAKE_SHADOW_PROJECT_REF ||
      config.confirmProjectRef !== REFUND_INTAKE_SHADOW_PROJECT_REF) {
    throw new RefundGmailIntakeShadowRunnerError('project_not_confirmed');
  }
  const clients = createRefundGmailIntakeShadowClients(config, { repoRoot });
  const result = await runWithTimeout({
    timeoutMs: config.timeoutMs,
    signal: signalController.signal,
    run: (signal) => executeRefundGmailIntakeShadow({
      config,
      clients,
      logger: safeLogger,
      signal,
    }),
  });
  safeLogger({
    phase: 'complete',
    ok: result.ok,
    mode: result.mode,
    ...(result.mode === 'initialize' ? {
      metadataReconciliationRequired: result.metadataReconciliationRequired,
      closedStateVerified: result.closedStateVerified,
    } : {}),
    ...(result.mode === 'cleanup-verify' ? {
      completedNow: result.completedNow,
      assignedOverdue: result.assignedOverdue,
      assignedOutstanding: result.assignedOutstanding,
      taskFound: result.taskFound,
      taskStatus: result.taskStatus,
    } : {}),
    ...(result.mode === 'recover-expired' ? {
      recoveredExpiredCount: result.recoveredExpiredCount,
      armedAuthorizationCount: result.armedAuthorizationCount,
      consumedRunningCount: result.consumedRunningCount,
    } : {}),
    ...(result.mode === 'live' ? {
      effectsClassification: result.effectsClassification,
      gatesConclusivelyClosed: result.gatesConclusivelyClosed,
      gateState: result.gateState,
      messagesSeen: result.messagesSeen,
      mailboxAcknowledgementObserved: result.mailboxAcknowledgementObserved,
      managerNoticeShadowed: result.managerNoticeShadowed,
      routeClass: result.routeClass,
      ownerManageableCaseCount: result.ownerManageableCaseCount,
      ownerManageableCase: result.ownerManageableCase,
      earliestRetentionDueAt: result.earliestRetentionDueAt,
      latestRetentionDueAt: result.latestRetentionDueAt,
      cleanupTaskHandle: result.cleanupTaskHandle,
      retentionCleanupObligation: result.retentionCleanupObligation,
      cleanupCommitment: result.cleanupCommitment,
      durableStateRequiresManualReconciliation:
        result.durableStateRequiresManualReconciliation,
      durableStateStatus: result.durableStateStatus,
      retentionCleanupStatus: result.retentionCleanupStatus,
      emergencyIndependentGateVerificationRequired:
        result.emergencyIndependentGateVerificationRequired,
      replayAllowed: result.replayAllowed,
    } : {}),
    payloadRedacted: true,
  });
} catch (error) {
  const code = error instanceof RefundGmailIntakeShadowRunnerError
    ? error.code
    : interrupted
    ? 'intake_interrupted'
    : 'intake_runner_failed';
  process.stderr.write(`${JSON.stringify({
    phase: 'failed_closed',
    ok: false,
    code,
    ...(error instanceof RefundGmailIntakeShadowRunnerError &&
      error.safeDetails.metadataReconciliationRequired === true
      ? { metadataReconciliationRequired: true }
      : {}),
    ...(error instanceof RefundGmailIntakeShadowRunnerError &&
      typeof error.safeDetails.closedStateVerified === 'boolean'
      ? { closedStateVerified: error.safeDetails.closedStateVerified }
      : {}),
    ...(error instanceof RefundGmailIntakeShadowRunnerError &&
      error.safeDetails.emergencyIndependentClosedStateVerificationRequired === true
      ? { emergencyIndependentClosedStateVerificationRequired: true }
      : {}),
    ...(error instanceof RefundGmailIntakeShadowRunnerError &&
      typeof error.safeDetails.cleanupTaskHandle === 'string'
      ? { cleanupTaskHandle: error.safeDetails.cleanupTaskHandle }
      : {}),
    payloadRedacted: true,
  })}\n`);
  process.exitCode = interrupted ? 130 : 1;
} finally {
  process.removeListener('SIGINT', interrupt);
  process.removeListener('SIGTERM', interrupt);
}
