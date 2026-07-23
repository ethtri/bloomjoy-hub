#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseNayaxRefundProviderContract } from '../supabase/functions/_shared/nayax-refund-provider.mjs';

const DEFAULTS = {
  envFiles: ['.env', '.env.local'],
  projectRef: '',
  profile: 'supabase',
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const parsed = { ...DEFAULTS, envFiles: [] };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === '--env-file' && next) {
      parsed.envFiles.push(next);
      index += 1;
      continue;
    }

    if (arg === '--project-ref' && next) {
      parsed.projectRef = next;
      index += 1;
      continue;
    }

    if (arg === '--profile' && next) {
      parsed.profile = next;
      index += 1;
      continue;
    }

    if (arg === '--include-refunds' || arg === '--refunds') {
      parsed.includeRefunds = true;
      continue;
    }
  }

  if (parsed.envFiles.length === 0) {
    parsed.envFiles = [...DEFAULTS.envFiles];
  }

  return parsed;
}

function parseEnvFile(contents) {
  const result = {};

  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    const eqIndex = line.indexOf('=');
    if (eqIndex <= 0) {
      continue;
    }

    const key = line.slice(0, eqIndex).trim();
    let value = line.slice(eqIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    result[key] = value;
  }

  return result;
}

function loadEnvFiles(envFiles) {
  const merged = {};
  const loadedFiles = [];

  for (const envFile of envFiles) {
    const absolutePath = path.resolve(repoRoot, envFile);
    if (!fs.existsSync(absolutePath)) {
      continue;
    }

    Object.assign(merged, parseEnvFile(fs.readFileSync(absolutePath, 'utf8')));
    loadedFiles.push(envFile);
  }

  return {
    merged,
    loadedFiles,
  };
}

function loadRemoteSecrets({ projectRef, profile }) {
  const args = ['secrets', 'list', '--project-ref', projectRef, '--output', 'json'];

  if (profile) {
    args.push('--profile', profile);
  }

  const stdout = execFileSync('supabase', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const parsed = JSON.parse(stdout);
  return Object.fromEntries(
    parsed
      .filter((entry) => entry && typeof entry.name === 'string')
      .map((entry) => [entry.name, '__remote_secret_present__'])
  );
}

function parseRecipients(value) {
  return String(value || '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

function isLikelyEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function isValidUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function printList(title, values) {
  console.log(`\n${title}`);
  for (const value of values) {
    console.log(`- ${value}`);
  }
}

function run() {
  const args = parseArgs(process.argv.slice(2));
  const warnings = [];
  const errors = [];

  let sourceLabel = 'local env files';
  let isRemoteSource = false;
  let loadedFiles = [];
  let env = {};

  if (args.projectRef) {
    sourceLabel = `remote Supabase secrets (${args.projectRef})`;
    isRemoteSource = true;
    try {
      env = loadRemoteSecrets(args);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`ERROR: Unable to read Supabase secrets for ${args.projectRef}.`);
      console.error(message);
      process.exit(1);
    }
  } else {
    const loaded = loadEnvFiles(args.envFiles);
    loadedFiles = loaded.loadedFiles;
    env = {
      ...loaded.merged,
      ...process.env,
    };
  }

  const requiredKeys = [
    'STRIPE_SECRET_KEY',
    'STRIPE_STICKS_PRICE_ID',
    'STRIPE_PLUS_PRICE_ID',
    'STRIPE_WEBHOOK_SECRET',
    'SUPABASE_URL',
    'SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
    'RESEND_API_KEY',
    'INTERNAL_NOTIFICATION_FROM_EMAIL',
    'STRIPE_SUGAR_NON_MEMBER_PRICE_ID',
    'STRIPE_STICKS_MEMBER_PRICE_ID',
    'WECOM_CORP_ID',
    'WECOM_AGENT_ID',
    'WECOM_AGENT_SECRET',
    'WECOM_ALERT_TO_USERIDS',
  ];

  if (args.includeRefunds) {
    requiredKeys.push(
      'PUBLIC_INTAKE_ABUSE_HASH_SALT',
      'NAYAX_LYNX_BASE_URL',
      'NAYAX_REFUND_EXECUTION_ENABLED',
      'NAYAX_REFUND_EXECUTION_DRY_RUN',
      'NAYAX_REFUND_EXECUTION_KILL_SWITCH',
      'NAYAX_REFUND_EXECUTION_PROVIDER_CONTRACT_CONFIRMED',
      'NAYAX_REFUND_MAX_AMOUNT_CENTS',
      'NAYAX_REFUND_DAILY_AMOUNT_CAP_CENTS',
      'NAYAX_REFUND_DAILY_COUNT_CAP',
      'NAYAX_REFUND_IDEMPOTENCY_SECRET'
    );
  }

  for (const key of requiredKeys) {
    if (!env[key] || String(env[key]).trim() === '') {
      errors.push(`${key} is missing.`);
    }
  }

  if (!env.STRIPE_SUGAR_MEMBER_PRICE_ID && !env.STRIPE_SUGAR_PRICE_ID) {
    errors.push(
      'Missing member sugar price. Set STRIPE_SUGAR_MEMBER_PRICE_ID (preferred) or legacy STRIPE_SUGAR_PRICE_ID.'
    );
  }

  if (env.STRIPE_SUGAR_PRICE_ID && !env.STRIPE_SUGAR_MEMBER_PRICE_ID) {
    warnings.push(
      'Using legacy STRIPE_SUGAR_PRICE_ID as the member-price fallback. Set STRIPE_SUGAR_MEMBER_PRICE_ID to complete the migration.'
    );
  }

  if (
    args.includeRefunds &&
    !env.NAYAX_LYNX_API_TOKEN_TGPACI_USA_DB &&
    !env.NAYAX_LYNX_API_TOKEN
  ) {
    errors.push(
      'Missing Nayax token. Set NAYAX_LYNX_API_TOKEN_TGPACI_USA_DB or fallback NAYAX_LYNX_API_TOKEN.'
    );
  }

  if (
    args.includeRefunds &&
    !env.REFUND_AUTOMATION_SWEEP_SECRET &&
    !env.REPORT_SCHEDULER_SECRET
  ) {
    errors.push(
      'Missing refund automation scheduler secret. Set REFUND_AUTOMATION_SWEEP_SECRET or fallback REPORT_SCHEDULER_SECRET.'
    );
  }

  if (!isRemoteSource && env.SUPABASE_URL && !isValidUrl(env.SUPABASE_URL)) {
    errors.push('SUPABASE_URL must be a valid absolute URL.');
  }

  if (!isRemoteSource && args.includeRefunds && env.NAYAX_LYNX_BASE_URL) {
    if (!isValidUrl(env.NAYAX_LYNX_BASE_URL)) {
      errors.push('NAYAX_LYNX_BASE_URL must be a valid absolute URL.');
    } else if (
      String(env.NAYAX_LYNX_BASE_URL).replace(/\/+$/, '') !==
      'https://lynx.nayax.com/operational/v1'
    ) {
      warnings.push(
        'NAYAX_LYNX_BASE_URL differs from the expected live Last Sales endpoint.'
      );
    }
  }

  if (!isRemoteSource && args.includeRefunds) {
    const booleanKeys = [
      'NAYAX_REFUND_EXECUTION_ENABLED',
      'NAYAX_REFUND_EXECUTION_DRY_RUN',
      'NAYAX_REFUND_EXECUTION_KILL_SWITCH',
      'NAYAX_REFUND_EXECUTION_PROVIDER_CONTRACT_CONFIRMED',
    ];
    for (const key of booleanKeys) {
      if (env[key] && !['true', 'false'].includes(String(env[key]).trim().toLowerCase())) {
        errors.push(`${key} must be true or false.`);
      }
    }

    if (String(env.NAYAX_REFUND_EXECUTION_KILL_SWITCH || '').trim().toLowerCase() !== 'true') {
      warnings.push(
        'NAYAX_REFUND_EXECUTION_KILL_SWITCH is not true. Live card refund execution must stay disabled until explicit go/no-go.'
      );
    }

    const executionEnabled =
      String(env.NAYAX_REFUND_EXECUTION_ENABLED || '').trim().toLowerCase() === 'true';
    const providerContractConfirmed =
      String(env.NAYAX_REFUND_EXECUTION_PROVIDER_CONTRACT_CONFIRMED || '')
        .trim()
        .toLowerCase() === 'true';
    const refundWriteTokenKeys = Object.keys(env).filter(
      (key) =>
        /^NAYAX_REFUND_API_TOKEN_[A-Z0-9_]+$/.test(key) &&
        String(env[key] || '').trim() !== ''
    );
    const providerContractJson = String(env.NAYAX_REFUND_PROVIDER_CONTRACT_JSON || '').trim();
    if ((executionEnabled || providerContractConfirmed) && refundWriteTokenKeys.length === 0) {
      errors.push(
        'An account-scoped NAYAX_REFUND_API_TOKEN_<ACCOUNT_KEY> write credential is required before Nayax refund execution or provider-contract confirmation can be enabled.'
      );
    }
    if ((executionEnabled || providerContractConfirmed) && !providerContractJson) {
      errors.push(
        'NAYAX_REFUND_PROVIDER_CONTRACT_JSON is required before Nayax refund execution or provider-contract confirmation can be enabled.'
      );
    }
    if (providerContractJson) {
      try {
        parseNayaxRefundProviderContract(providerContractJson);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(`NAYAX_REFUND_PROVIDER_CONTRACT_JSON is invalid: ${message}`);
      }
    }

    if (env.NAYAX_REFUND_PROVIDER_TIMEOUT_MS) {
      const timeoutMs = Number(env.NAYAX_REFUND_PROVIDER_TIMEOUT_MS);
      if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 20000) {
        errors.push('NAYAX_REFUND_PROVIDER_TIMEOUT_MS must be an integer from 1000 to 20000.');
      }
    }
  }

  if (
    !isRemoteSource &&
    env.INTERNAL_NOTIFICATION_FROM_EMAIL &&
    !String(env.INTERNAL_NOTIFICATION_FROM_EMAIL).includes('@')
  ) {
    errors.push('INTERNAL_NOTIFICATION_FROM_EMAIL must be a valid sender email address.');
  }

  if (!isRemoteSource && env.WECOM_AGENT_ID && !/^\d+$/.test(String(env.WECOM_AGENT_ID).trim())) {
    errors.push('WECOM_AGENT_ID must be numeric.');
  }

  if (!isRemoteSource) {
    const recipients = parseRecipients(env.INTERNAL_NOTIFICATION_RECIPIENTS);
    if (env.INTERNAL_NOTIFICATION_RECIPIENTS && recipients.length === 0) {
      errors.push('INTERNAL_NOTIFICATION_RECIPIENTS must include at least one recipient.');
    }

    for (const recipient of recipients) {
      if (!isLikelyEmail(recipient)) {
        errors.push(`INTERNAL_NOTIFICATION_RECIPIENTS contains an invalid email: ${recipient}.`);
      }
    }
  } else {
    warnings.push(
      'Remote secret inspection validates presence only; recipient values and sender formatting must be verified separately.'
    );
  }

  console.log(`INFO: Commerce preflight source: ${sourceLabel}`);
  if (loadedFiles.length > 0) {
    console.log(`INFO: Loaded env files: ${loadedFiles.join(', ')}`);
  }

  printList('Required commerce checks', [
    'Webhook secret present',
    'Member and non-member sugar price IDs configured',
    'Internal email sender configured; Ethan/Ian are default admin recipients',
    'WeCom alert secrets configured',
    'Supabase service-role and anon keys configured',
  ]);

  if (args.includeRefunds) {
    printList('Required refund operations checks', [
      'Public intake abuse-control salt configured',
      'Nayax Lynx base URL configured',
      'Nayax account-specific token or fallback token configured',
      'Nayax refund execution flags, caps, and idempotency secret configured fail-closed',
      'Refund reminder/escalation scheduler secret configured',
      'Resend sender and API key configured for refund-case-intake',
      'Supabase service-role key configured for refund Edge Functions',
    ]);
  }

  if (warnings.length > 0) {
    printList('Warnings', warnings);
  }

  if (errors.length > 0) {
    printList('Errors', errors);
    process.exit(1);
  }

  console.log(args.includeRefunds
    ? '\nCommerce and refund operations preflight checks passed.'
    : '\nCommerce preflight checks passed.');
}

run();
