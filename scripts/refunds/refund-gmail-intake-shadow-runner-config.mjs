import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RefundGmailIntakeShadowRunnerError } from './refund-gmail-intake-shadow-runner-lib.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PRIVATE_PACKET_NAMES = new Set([
  'REFUND_GMAIL_INTAKE_SHADOW_PROJECT_REF',
  'REFUND_GMAIL_INTAKE_SHADOW_CONFIRM_PROJECT_REF',
  'REFUND_GMAIL_INTAKE_SHADOW_RETENTION_POLICY_VERSION',
  'REFUND_GMAIL_INTAKE_SHADOW_LABEL_SHA256',
  'REFUND_GMAIL_INTAKE_SHADOW_CONFIRM_LABEL_SHA256',
  'REFUND_GMAIL_INTAKE_SHADOW_INITIAL_LABEL_ID',
  'REFUND_GMAIL_INTAKE_SHADOW_OWNER_SENDER_SHA256',
  'REFUND_GMAIL_INTAKE_SHADOW_CONFIRM_OWNER_SENDER_SHA256',
  'REFUND_GMAIL_INTAKE_SHADOW_MANAGEMENT_TOKEN',
  'REFUND_GMAIL_INTAKE_SHADOW_SYNC_SECRET',
  'REFUND_GMAIL_INTAKE_SHADOW_ANON_KEY',
  'REFUND_GMAIL_INTAKE_SHADOW_OWNER_USER_JWT',
  'REFUND_GMAIL_INTAKE_SHADOW_LIVE_CONFIRMATION',
  'REFUND_GMAIL_INTAKE_SHADOW_INITIALIZE_CONFIRMATION',
  'REFUND_GMAIL_INTAKE_SHADOW_CLEANUP_COMMITMENT',
  'REFUND_GMAIL_INTAKE_SHADOW_CLEANUP_TASK_HANDLE',
]);

export const parseRefundGmailIntakeShadowArgs = (argv) => {
  const result = { mode: 'dry-run', envFile: '', timeoutSeconds: 600 };
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
      throw new RefundGmailIntakeShadowRunnerError('unsupported_argument');
    }
  }
  if (!['initialize', 'recover-expired', 'cleanup-verify', 'dry-run', 'live'].includes(result.mode)) {
    throw new RefundGmailIntakeShadowRunnerError('mode_invalid');
  }
  if (!Number.isInteger(result.timeoutSeconds) ||
      result.timeoutSeconds < 450 || result.timeoutSeconds > 600) {
    throw new RefundGmailIntakeShadowRunnerError('timeout_invalid');
  }
  return result;
};

export const parseRefundGmailIntakeShadowEnvFile = (contents) => {
  const values = {};
  for (const rawLine of contents.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const delimiter = line.indexOf('=');
    if (delimiter < 1) throw new RefundGmailIntakeShadowRunnerError('env_file_invalid');
    const name = line.slice(0, delimiter).trim();
    let value = line.slice(delimiter + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!PRIVATE_PACKET_NAMES.has(name) || Object.hasOwn(values, name)) {
      throw new RefundGmailIntakeShadowRunnerError('env_file_invalid');
    }
    values[name] = value;
  }
  return values;
};

export const loadRefundGmailIntakeShadowEnvironment = (envFile, parentEnv = process.env) => {
  if (!envFile) {
    throw new RefundGmailIntakeShadowRunnerError('env_file_path_invalid');
  }
  if (!path.isAbsolute(envFile)) {
    throw new RefundGmailIntakeShadowRunnerError('env_file_path_invalid');
  }
  const absolutePath = path.resolve(envFile);
  const lexicalRelativeToRepo = path.relative(repoRoot, absolutePath);
  if (
    lexicalRelativeToRepo === '' ||
    (!lexicalRelativeToRepo.startsWith(`..${path.sep}`) &&
      lexicalRelativeToRepo !== '..' &&
      !path.isAbsolute(lexicalRelativeToRepo))
  ) {
    throw new RefundGmailIntakeShadowRunnerError('env_file_path_invalid');
  }
  let canonicalRepoRoot;
  let canonicalPacketPath;
  try {
    canonicalRepoRoot = fs.realpathSync(repoRoot);
    canonicalPacketPath = fs.realpathSync(absolutePath);
  } catch {
    throw new RefundGmailIntakeShadowRunnerError('env_file_unavailable');
  }
  const relativeToRepo = path.relative(canonicalRepoRoot, canonicalPacketPath);
  if (
    relativeToRepo === '' ||
    (!relativeToRepo.startsWith(`..${path.sep}`) && relativeToRepo !== '..' &&
      !path.isAbsolute(relativeToRepo))
  ) {
    throw new RefundGmailIntakeShadowRunnerError('env_file_path_invalid');
  }
  let parsed;
  try {
    parsed = parseRefundGmailIntakeShadowEnvFile(
      fs.readFileSync(canonicalPacketPath, 'utf8'),
    );
  } catch (error) {
    if (error instanceof RefundGmailIntakeShadowRunnerError) throw error;
    throw new RefundGmailIntakeShadowRunnerError('env_file_unavailable');
  }
  // The reviewed private packet is the only authority. Ambient process values
  // are deliberately ignored so stale credentials or confirmations cannot
  // silently complete a partial packet.
  void parentEnv;
  return parsed;
};

export const buildRefundGmailIntakeShadowConfig = ({ mode, timeoutSeconds, env }) => ({
  mode,
  timeoutMs: timeoutSeconds * 1000,
  projectRef: env.REFUND_GMAIL_INTAKE_SHADOW_PROJECT_REF ?? '',
  confirmProjectRef: env.REFUND_GMAIL_INTAKE_SHADOW_CONFIRM_PROJECT_REF ?? '',
  retentionPolicyVersion:
    env.REFUND_GMAIL_INTAKE_SHADOW_RETENTION_POLICY_VERSION ?? '',
  expectedShadowLabelDigest: env.REFUND_GMAIL_INTAKE_SHADOW_LABEL_SHA256 ?? '',
  confirmShadowLabelDigest: env.REFUND_GMAIL_INTAKE_SHADOW_CONFIRM_LABEL_SHA256 ?? '',
  initialShadowLabelId: env.REFUND_GMAIL_INTAKE_SHADOW_INITIAL_LABEL_ID ?? '',
  ownerSenderDigest: env.REFUND_GMAIL_INTAKE_SHADOW_OWNER_SENDER_SHA256 ?? '',
  confirmOwnerSenderDigest:
    env.REFUND_GMAIL_INTAKE_SHADOW_CONFIRM_OWNER_SENDER_SHA256 ?? '',
  managementToken: env.REFUND_GMAIL_INTAKE_SHADOW_MANAGEMENT_TOKEN ?? '',
  syncSecret: env.REFUND_GMAIL_INTAKE_SHADOW_SYNC_SECRET ?? '',
  anonKey: env.REFUND_GMAIL_INTAKE_SHADOW_ANON_KEY ?? '',
  ownerUserJwt: env.REFUND_GMAIL_INTAKE_SHADOW_OWNER_USER_JWT ?? '',
  liveConfirmation: env.REFUND_GMAIL_INTAKE_SHADOW_LIVE_CONFIRMATION ?? '',
  initializeConfirmation:
    env.REFUND_GMAIL_INTAKE_SHADOW_INITIALIZE_CONFIRMATION ?? '',
  cleanupCommitment: env.REFUND_GMAIL_INTAKE_SHADOW_CLEANUP_COMMITMENT ?? '',
  cleanupTaskHandle: env.REFUND_GMAIL_INTAKE_SHADOW_CLEANUP_TASK_HANDLE ?? '',
});
