import fs from 'node:fs';
import path from 'node:path';
import { RefundGmailIntakeShadowRunnerError } from './refund-gmail-intake-shadow-runner-lib.mjs';

export const parseRefundGmailIntakeShadowArgs = (argv) => {
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
      throw new RefundGmailIntakeShadowRunnerError('unsupported_argument');
    }
  }
  if (!['dry-run', 'live'].includes(result.mode)) {
    throw new RefundGmailIntakeShadowRunnerError('mode_invalid');
  }
  if (!Number.isInteger(result.timeoutSeconds) ||
      result.timeoutSeconds < 30 || result.timeoutSeconds > 240) {
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
    if (!/^[A-Z][A-Z0-9_]+$/u.test(name)) {
      throw new RefundGmailIntakeShadowRunnerError('env_file_invalid');
    }
    values[name] = value;
  }
  return values;
};

export const loadRefundGmailIntakeShadowEnvironment = (envFile, parentEnv = process.env) => {
  if (!envFile) return { ...parentEnv };
  const absolutePath = path.resolve(process.cwd(), envFile);
  let parsed;
  try {
    parsed = parseRefundGmailIntakeShadowEnvFile(fs.readFileSync(absolutePath, 'utf8'));
  } catch (error) {
    if (error instanceof RefundGmailIntakeShadowRunnerError) throw error;
    throw new RefundGmailIntakeShadowRunnerError('env_file_unavailable');
  }
  return { ...parsed, ...parentEnv };
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
  ownerSenderDigest: env.REFUND_GMAIL_INTAKE_SHADOW_OWNER_SENDER_SHA256 ?? '',
  confirmOwnerSenderDigest:
    env.REFUND_GMAIL_INTAKE_SHADOW_CONFIRM_OWNER_SENDER_SHA256 ?? '',
  managementToken: env.REFUND_GMAIL_INTAKE_SHADOW_MANAGEMENT_TOKEN ?? '',
  syncSecret: env.REFUND_GMAIL_INTAKE_SHADOW_SYNC_SECRET ?? '',
  anonKey: env.REFUND_GMAIL_INTAKE_SHADOW_ANON_KEY ?? '',
  ownerUserJwt: env.REFUND_GMAIL_INTAKE_SHADOW_OWNER_USER_JWT ?? '',
  liveConfirmation: env.REFUND_GMAIL_INTAKE_SHADOW_LIVE_CONFIRMATION ?? '',
  cleanupCommitment: env.REFUND_GMAIL_INTAKE_SHADOW_CLEANUP_COMMITMENT ?? '',
});
