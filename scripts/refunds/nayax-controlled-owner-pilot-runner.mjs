#!/usr/bin/env node

import { createNayaxControlledPilotClients } from './nayax-controlled-owner-pilot-runner-clients.mjs';
import {
  buildNayaxControlledPilotConfig,
  loadNayaxControlledPilotEnvironment,
  parseNayaxControlledPilotArgs,
} from './nayax-controlled-owner-pilot-runner-config.mjs';
import {
  NayaxControlledPilotRunnerError,
  executeNayaxControlledPilot,
  runNayaxControlledPilotWithTimeout,
  sanitizeNayaxControlledPilotError,
  selectNayaxControlledPilotFailureDetails,
} from './nayax-controlled-owner-pilot-runner-lib.mjs';

const log = (record, stream = process.stdout) => {
  stream.write(`${JSON.stringify(record)}\n`);
};

const controller = new AbortController();
let interrupted = false;
const interrupt = () => {
  interrupted = true;
  if (!controller.signal.aborted) {
    controller.abort(new NayaxControlledPilotRunnerError('pilot_interrupted'));
  }
};
process.on('SIGINT', interrupt);
process.on('SIGTERM', interrupt);

const readPrivateTotp = ({ signal } = {}) => new Promise((resolve, reject) => {
  if (!process.stdin.isTTY || !process.stderr.isTTY ||
      typeof process.stdin.setRawMode !== 'function') {
    reject(new NayaxControlledPilotRunnerError('private_totp_tty_required'));
    return;
  }
  let digits = '';
  let settled = false;
  const wasRaw = process.stdin.isRaw === true;
  const timer = setTimeout(() => finish(
    new NayaxControlledPilotRunnerError('private_totp_timeout'),
  ), 30_000);
  const onAbort = () => finish(
    signal?.reason instanceof Error
      ? signal.reason
      : new NayaxControlledPilotRunnerError('pilot_interrupted'),
  );
  const cleanup = () => {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
    process.stdin.removeListener('data', onData);
    if (!wasRaw) process.stdin.setRawMode(false);
    process.stderr.write('\n');
  };
  function finish(error) {
    if (settled) return;
    settled = true;
    cleanup();
    if (error) reject(error);
    else resolve(digits);
  }
  const onData = (chunk) => {
    for (const character of chunk.toString('utf8')) {
      if (character === '\u0003') {
        finish(new NayaxControlledPilotRunnerError('pilot_interrupted'));
        return;
      }
      if (character === '\r' || character === '\n') {
        finish(digits.length === 6
          ? null
          : new NayaxControlledPilotRunnerError('fresh_totp_invalid'));
        return;
      }
      if (character === '\b' || character === '\u007f') {
        digits = digits.slice(0, -1);
      } else if (/^\d$/u.test(character) && digits.length < 6) {
        digits += character;
      }
    }
  };
  if (signal?.aborted) {
    finish(signal.reason instanceof Error
      ? signal.reason
      : new NayaxControlledPilotRunnerError('pilot_interrupted'));
    return;
  }
  signal?.addEventListener('abort', onAbort, { once: true });
  process.stdin.on('data', onData);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stderr.write('Enter current owner TOTP (input hidden): ');
});

try {
  const args = parseNayaxControlledPilotArgs(process.argv.slice(2));
  const config = buildNayaxControlledPilotConfig({
    ...args,
    env: loadNayaxControlledPilotEnvironment(args.envFile),
  });
  const clients = createNayaxControlledPilotClients(config);
  const result = await runNayaxControlledPilotWithTimeout({
    timeoutMs: config.timeoutMs,
    signal: controller.signal,
    run: (signal) => executeNayaxControlledPilot({
      config, clients, logger: log, signal, readFreshTotp: readPrivateTotp,
    }),
  });
  log({
    phase: 'complete',
    ok: result.ok,
    mode: result.mode,
    ...(typeof result.effectsClassification === 'string'
      ? { effectsClassification: result.effectsClassification }
      : {}),
    ...(typeof result.gatesConclusivelyClosed === 'boolean'
      ? { gatesConclusivelyClosed: result.gatesConclusivelyClosed }
      : {}),
    ...(result.metadataReconciliationRequired === true
      ? { metadataReconciliationRequired: true }
      : {}),
    ...(result.vendorCredentialRoleReviewRequired === true
      ? { vendorCredentialRoleReviewRequired: true }
      : {}),
    ...(result.mode === 'recover'
      ? Object.fromEntries([
        'consumedAttemptCount', 'providerCallCount', 'providerCallCountStatus',
        'providerHold', 'manualReconciliationRequired',
      ].filter((key) => typeof result[key] === 'number' ||
        typeof result[key] === 'boolean' || typeof result[key] === 'string')
        .map((key) => [key, result[key]]))
      : {}),
    noReplay: true,
    payloadRedacted: true,
  });
  if (result.ok !== true) process.exitCode = 1;
} catch (error) {
  log({
    phase: 'failed_closed',
    ...sanitizeNayaxControlledPilotError(error),
    ...(error instanceof NayaxControlledPilotRunnerError &&
      typeof error.details?.effectsClassification === 'string'
      ? { effectsClassification: error.details.effectsClassification }
      : {}),
    ...(error instanceof NayaxControlledPilotRunnerError &&
      typeof error.details?.gatesConclusivelyClosed === 'boolean'
      ? { gatesConclusivelyClosed: error.details.gatesConclusivelyClosed }
      : {}),
    ...(error instanceof NayaxControlledPilotRunnerError &&
      error.details?.metadataReconciliationRequired === true
      ? { metadataReconciliationRequired: true }
      : {}),
    ...(error instanceof NayaxControlledPilotRunnerError
      ? selectNayaxControlledPilotFailureDetails(error.details)
      : {}),
  }, process.stderr);
  process.exitCode = interrupted ? 130 : 1;
} finally {
  process.removeListener('SIGINT', interrupt);
  process.removeListener('SIGTERM', interrupt);
}
