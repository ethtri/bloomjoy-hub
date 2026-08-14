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
    ...(result.mode === 'live' ? {
      classification: result.classification,
      messagesSeen: result.messagesSeen,
      mailboxAcknowledgementObserved: result.mailboxAcknowledgementObserved,
      managerNoticeShadowed: result.managerNoticeShadowed,
      routeClass: result.routeClass,
      ownerManageableCaseCount: result.ownerManageableCaseCount,
      ownerManageableCase: result.ownerManageableCase,
      earliestRetentionDueAt: result.earliestRetentionDueAt,
      latestRetentionDueAt: result.latestRetentionDueAt,
      retentionCleanupObligation: result.retentionCleanupObligation,
      cleanupCommitment: result.cleanupCommitment,
      durableStateRequiresManualReconciliation:
        result.durableStateRequiresManualReconciliation,
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
    payloadRedacted: true,
  })}\n`);
  process.exitCode = interrupted ? 130 : 1;
} finally {
  process.removeListener('SIGINT', interrupt);
  process.removeListener('SIGTERM', interrupt);
}
