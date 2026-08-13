#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSyntheticGmailProofClients } from './refund-synthetic-gmail-proof-runner-clients.mjs';
import {
  REFUND_PRODUCTION_PROJECT_REF,
  SyntheticGmailProofRunnerError,
  executeSyntheticGmailProof,
  runWithTimeout,
} from './refund-synthetic-gmail-proof-runner-lib.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');

const parseArgs = (argv) => {
  const result = { mode: 'dry-run', envFile: '', timeoutSeconds: 120 };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const next = argv[index + 1];
    if (argument === '--mode' && next) {
      result.mode = next.trim().toLowerCase();
      index += 1;
    } else if (argument === '--env-file' && next) {
      result.envFile = next;
      index += 1;
    } else if (argument === '--timeout-seconds' && next) {
      result.timeoutSeconds = Number(next);
      index += 1;
    } else {
      throw new SyntheticGmailProofRunnerError(
        'unsupported_argument',
        'Use only --mode, --env-file, and --timeout-seconds.',
      );
    }
  }
  if (!['dry-run', 'live'].includes(result.mode)) {
    throw new SyntheticGmailProofRunnerError('invalid_mode', 'Mode must be dry-run or live.');
  }
  if (
    !Number.isInteger(result.timeoutSeconds) ||
    result.timeoutSeconds < 30 ||
    result.timeoutSeconds > 240
  ) {
    throw new SyntheticGmailProofRunnerError(
      'invalid_timeout',
      'Timeout must be between 30 and 240 seconds.',
    );
  }
  return result;
};

const parseEnvFile = (contents) => {
  const values = {};
  for (const rawLine of contents.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const delimiter = line.indexOf('=');
    if (delimiter < 1) {
      throw new SyntheticGmailProofRunnerError('env_file_invalid');
    }
    const name = line.slice(0, delimiter).trim();
    let value = line.slice(delimiter + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!/^[A-Z][A-Z0-9_]+$/u.test(name)) {
      throw new SyntheticGmailProofRunnerError('env_file_invalid');
    }
    values[name] = value;
  }
  return values;
};

const loadEnvironment = (envFile) => {
  if (!envFile) return { ...process.env };
  const absolute = path.resolve(process.cwd(), envFile);
  let parsed;
  try {
    parsed = parseEnvFile(fs.readFileSync(absolute, 'utf8'));
  } catch (error) {
    if (error instanceof SyntheticGmailProofRunnerError) throw error;
    throw new SyntheticGmailProofRunnerError('env_file_unavailable');
  }
  return { ...parsed, ...process.env };
};

const buildConfig = ({ mode, timeoutSeconds, env }) => ({
  mode,
  timeoutMs: timeoutSeconds * 1000,
  projectRef: env.REFUND_SYNTHETIC_GMAIL_PROOF_PROJECT_REF ?? '',
  confirmProjectRef: env.REFUND_SYNTHETIC_GMAIL_PROOF_CONFIRM_PROJECT_REF ?? '',
  caseId: env.REFUND_SYNTHETIC_GMAIL_PROOF_CASE_ID ?? '',
  confirmCaseId: env.REFUND_SYNTHETIC_GMAIL_PROOF_CONFIRM_CASE_ID ?? '',
  databaseAdapter: env.REFUND_SYNTHETIC_GMAIL_PROOF_DATABASE_ADAPTER ?? 'direct-postgres',
  databaseUrl: env.REFUND_SYNTHETIC_GMAIL_PROOF_DATABASE_URL ?? '',
  managementToken: env.REFUND_SYNTHETIC_GMAIL_PROOF_MANAGEMENT_TOKEN ?? '',
  anonKey: env.REFUND_SYNTHETIC_GMAIL_PROOF_ANON_KEY ?? '',
  userAccessToken: env.REFUND_SYNTHETIC_GMAIL_PROOF_USER_ACCESS_TOKEN ?? '',
  liveConfirmation: env.REFUND_SYNTHETIC_GMAIL_PROOF_LIVE_CONFIRMATION ?? '',
});

const safeLogger = (record) => {
  process.stdout.write(`${JSON.stringify(record)}\n`);
};

const signalController = new AbortController();
let interrupted = false;
const interrupt = () => {
  interrupted = true;
  if (!signalController.signal.aborted) {
    signalController.abort(new SyntheticGmailProofRunnerError('proof_interrupted'));
  }
};
process.on('SIGINT', interrupt);
process.on('SIGTERM', interrupt);

let clients;
try {
  const args = parseArgs(process.argv.slice(2));
  const env = loadEnvironment(args.envFile);
  const config = buildConfig({ ...args, env });
  if (
    config.projectRef !== REFUND_PRODUCTION_PROJECT_REF ||
    config.confirmProjectRef !== REFUND_PRODUCTION_PROJECT_REF
  ) {
    throw new SyntheticGmailProofRunnerError('project_not_confirmed');
  }
  clients = createSyntheticGmailProofClients(config, { repoRoot });
  const result = await runWithTimeout({
    timeoutMs: config.timeoutMs,
    signal: signalController.signal,
    run: (signal) => executeSyntheticGmailProof({ config, clients, logger: safeLogger, signal }),
  });
  safeLogger({
    phase: 'complete',
    ok: result.ok,
    mode: result.mode,
    proofPassed: result.proofPassed,
    payloadRedacted: true,
  });
} catch (error) {
  const code = error instanceof SyntheticGmailProofRunnerError
    ? error.code
    : interrupted
    ? 'proof_interrupted'
    : 'proof_runner_failed';
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
  await clients?.database?.dispose?.();
}
