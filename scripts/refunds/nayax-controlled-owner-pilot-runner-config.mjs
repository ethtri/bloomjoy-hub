import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NayaxControlledPilotRunnerError } from './nayax-controlled-owner-pilot-runner-lib.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PRIVATE_NAMES = new Set([
  'REFUND_NAYAX_PILOT_PROJECT_REF',
  'REFUND_NAYAX_PILOT_CONFIRM_PROJECT_REF',
  'REFUND_NAYAX_PILOT_MANAGEMENT_TOKEN',
  'REFUND_NAYAX_PILOT_ANON_KEY',
  'REFUND_NAYAX_PILOT_OWNER_USER_JWT',
  'REFUND_NAYAX_PILOT_OWNER_EMAIL_SHA256',
  'REFUND_NAYAX_PILOT_CASE_ID',
  'REFUND_NAYAX_PILOT_OWNER_CASE_EVIDENCE_SHA256',
  'REFUND_NAYAX_PILOT_SELF_CASE_ATTESTATION_SHA256',
  'REFUND_NAYAX_PILOT_EXPECTED_MACHINE_SHA256',
  'REFUND_NAYAX_PILOT_EXPECTED_AMOUNT_CENTS',
  'REFUND_NAYAX_PILOT_RUNNER_ASSERTION',
  'REFUND_NAYAX_PILOT_ACCOUNT_KEY',
  'REFUND_NAYAX_PILOT_REQUEST_WRITE_TOKEN',
  'REFUND_NAYAX_PILOT_APPROVE_WRITE_TOKEN',
  'REFUND_NAYAX_PILOT_REQUEST_WRITE_TOKEN_SHA256',
  'REFUND_NAYAX_PILOT_APPROVE_WRITE_TOKEN_SHA256',
  'REFUND_NAYAX_PILOT_IDEMPOTENCY_SECRET_SHA256',
  'REFUND_NAYAX_PILOT_EXECUTOR_ASSERTION_SHA256',
  'REFUND_NAYAX_PILOT_EXECUTOR_ASSERTION',
  'REFUND_NAYAX_PILOT_PROVIDER_CONTRACT_JSON',
  'REFUND_NAYAX_PILOT_WRITTEN_CONTRACT_SHA256',
  'REFUND_NAYAX_PILOT_DTM_OWNER_OPERATOR_PROOF_SHA256',
  'REFUND_NAYAX_PILOT_SPONSOR_PROOF_SHA256',
  'REFUND_NAYAX_PILOT_EXACT_CAPS_CONFIRMED',
  'REFUND_NAYAX_PILOT_PROVIDER_ONLY_CONFIRMED',
  'REFUND_NAYAX_PILOT_NO_RETRY_CONFIRMED',
  'REFUND_NAYAX_PILOT_INITIALIZE_CONFIRMATION',
  'REFUND_NAYAX_PILOT_RETIRE_CONFIRMATION',
  'REFUND_NAYAX_PILOT_RECOVERY_CONFIRMATION',
  'REFUND_NAYAX_PILOT_LIVE_CONFIRMATION',
]);

export const parseNayaxControlledPilotArgs = (argv) => {
  const parsed = { mode: 'dry-run', envFile: '', timeoutSeconds: 600 };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === '--mode' && next) {
      parsed.mode = next.trim().toLowerCase();
      index += 1;
    } else if (arg === '--env-file' && next) {
      parsed.envFile = next;
      index += 1;
    } else if (arg === '--timeout-seconds' && next) {
      parsed.timeoutSeconds = Number(next);
      index += 1;
    } else {
      throw new NayaxControlledPilotRunnerError('unsupported_argument');
    }
  }
  if (!['initialize', 'dry-run', 'live', 'recover', 'retire'].includes(parsed.mode)) {
    throw new NayaxControlledPilotRunnerError('mode_invalid');
  }
  if (!Number.isInteger(parsed.timeoutSeconds) ||
      parsed.timeoutSeconds < 450 || parsed.timeoutSeconds > 600) {
    throw new NayaxControlledPilotRunnerError('timeout_invalid');
  }
  return parsed;
};

export const parseNayaxControlledPilotEnvFile = (contents) => {
  const parsed = {};
  for (const rawLine of contents.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const delimiter = line.indexOf('=');
    if (delimiter < 1) throw new NayaxControlledPilotRunnerError('env_file_invalid');
    const name = line.slice(0, delimiter).trim();
    let value = line.slice(delimiter + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!PRIVATE_NAMES.has(name) || Object.hasOwn(parsed, name)) {
      throw new NayaxControlledPilotRunnerError('env_file_invalid');
    }
    parsed[name] = value;
  }
  return parsed;
};

export const loadNayaxControlledPilotEnvironment = (envFile) => {
  if (!envFile || !path.isAbsolute(envFile)) {
    throw new NayaxControlledPilotRunnerError('env_file_path_invalid');
  }
  let canonicalRepoRoot;
  let canonicalPacket;
  try {
    canonicalRepoRoot = fs.realpathSync(repoRoot);
    canonicalPacket = fs.realpathSync(path.resolve(envFile));
  } catch {
    throw new NayaxControlledPilotRunnerError('env_file_unavailable');
  }
  const relative = path.relative(canonicalRepoRoot, canonicalPacket);
  if (relative === '' || (!relative.startsWith(`..${path.sep}`) &&
      relative !== '..' && !path.isAbsolute(relative))) {
    throw new NayaxControlledPilotRunnerError('env_file_path_invalid');
  }
  try {
    return parseNayaxControlledPilotEnvFile(fs.readFileSync(canonicalPacket, 'utf8'));
  } catch (error) {
    if (error instanceof NayaxControlledPilotRunnerError) throw error;
    throw new NayaxControlledPilotRunnerError('env_file_unavailable');
  }
};

export const buildNayaxControlledPilotConfig = ({ mode, timeoutSeconds, env }) => ({
  mode,
  timeoutMs: timeoutSeconds * 1000,
  projectRef: env.REFUND_NAYAX_PILOT_PROJECT_REF ?? '',
  confirmProjectRef: env.REFUND_NAYAX_PILOT_CONFIRM_PROJECT_REF ?? '',
  managementToken: env.REFUND_NAYAX_PILOT_MANAGEMENT_TOKEN ?? '',
  anonKey: env.REFUND_NAYAX_PILOT_ANON_KEY ?? '',
  ownerUserJwt: env.REFUND_NAYAX_PILOT_OWNER_USER_JWT ?? '',
  ownerEmailDigest: env.REFUND_NAYAX_PILOT_OWNER_EMAIL_SHA256 ?? '',
  caseId: env.REFUND_NAYAX_PILOT_CASE_ID ?? '',
  ownerCaseEvidenceDigest: env.REFUND_NAYAX_PILOT_OWNER_CASE_EVIDENCE_SHA256 ?? '',
  selfCaseAttestationDigest:
    env.REFUND_NAYAX_PILOT_SELF_CASE_ATTESTATION_SHA256 ?? '',
  expectedMachineDigest: env.REFUND_NAYAX_PILOT_EXPECTED_MACHINE_SHA256 ?? '',
  expectedAmountCents: Number(env.REFUND_NAYAX_PILOT_EXPECTED_AMOUNT_CENTS),
  runnerAssertion: env.REFUND_NAYAX_PILOT_RUNNER_ASSERTION ?? '',
  accountKey: env.REFUND_NAYAX_PILOT_ACCOUNT_KEY ?? '',
  requestWriteToken: env.REFUND_NAYAX_PILOT_REQUEST_WRITE_TOKEN ?? '',
  approveWriteToken: env.REFUND_NAYAX_PILOT_APPROVE_WRITE_TOKEN ?? '',
  requestWriteTokenDigest:
    env.REFUND_NAYAX_PILOT_REQUEST_WRITE_TOKEN_SHA256 ?? '',
  approveWriteTokenDigest:
    env.REFUND_NAYAX_PILOT_APPROVE_WRITE_TOKEN_SHA256 ?? '',
  idempotencySecretDigest:
    env.REFUND_NAYAX_PILOT_IDEMPOTENCY_SECRET_SHA256 ?? '',
  executorAssertionDigest:
    env.REFUND_NAYAX_PILOT_EXECUTOR_ASSERTION_SHA256 ?? '',
  executorAssertion: env.REFUND_NAYAX_PILOT_EXECUTOR_ASSERTION ?? '',
  providerContractJson: env.REFUND_NAYAX_PILOT_PROVIDER_CONTRACT_JSON ?? '',
  writtenContractDigest: env.REFUND_NAYAX_PILOT_WRITTEN_CONTRACT_SHA256 ?? '',
  dtmOwnerOperatorProofDigest:
    env.REFUND_NAYAX_PILOT_DTM_OWNER_OPERATOR_PROOF_SHA256 ?? '',
  sponsorProofDigest: env.REFUND_NAYAX_PILOT_SPONSOR_PROOF_SHA256 ?? '',
  exactCapsConfirmed: env.REFUND_NAYAX_PILOT_EXACT_CAPS_CONFIRMED ?? '',
  providerOnlyConfirmed: env.REFUND_NAYAX_PILOT_PROVIDER_ONLY_CONFIRMED ?? '',
  noRetryConfirmed: env.REFUND_NAYAX_PILOT_NO_RETRY_CONFIRMED ?? '',
  initializeConfirmation: env.REFUND_NAYAX_PILOT_INITIALIZE_CONFIRMATION ?? '',
  retireConfirmation: env.REFUND_NAYAX_PILOT_RETIRE_CONFIRMATION ?? '',
  recoveryConfirmation: env.REFUND_NAYAX_PILOT_RECOVERY_CONFIRMATION ?? '',
  liveConfirmation: env.REFUND_NAYAX_PILOT_LIVE_CONFIRMATION ?? '',
});
