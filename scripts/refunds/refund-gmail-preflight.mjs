#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const parseArgs = (argv) => {
  const result = { envFiles: [], projectRef: '', profile: 'supabase' };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    const next = argv[index + 1];
    if (value === '--env-file' && next) {
      result.envFiles.push(next);
      index += 1;
    } else if (value === '--project-ref' && next) {
      result.projectRef = next;
      index += 1;
    } else if (value === '--profile' && next) {
      result.profile = next;
      index += 1;
    }
  }
  if (result.envFiles.length === 0) result.envFiles = ['.env', '.env.local'];
  return result;
};

const parseEnv = (contents) => Object.fromEntries(
  contents
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && line.includes('='))
    .map((line) => {
      const delimiter = line.indexOf('=');
      const key = line.slice(0, delimiter).trim();
      let value = line.slice(delimiter + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      return [key, value];
    }),
);

const loadLocal = (envFiles) => {
  const values = {};
  const loaded = [];
  for (const envFile of envFiles) {
    const absolute = path.resolve(repoRoot, envFile);
    if (!fs.existsSync(absolute)) continue;
    Object.assign(values, parseEnv(fs.readFileSync(absolute, 'utf8')));
    loaded.push(envFile);
  }
  return { values: { ...values, ...process.env }, loaded };
};

const loadRemote = ({ projectRef, profile }) => {
  const args = ['secrets', 'list', '--project-ref', projectRef, '--output', 'json'];
  if (profile) args.push('--profile', profile);
  const output = execFileSync('supabase', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return Object.fromEntries(
    JSON.parse(output)
      .filter((entry) => entry && typeof entry.name === 'string')
      .map((entry) => [entry.name, '__remote_secret_present__']),
  );
};

const printList = (title, items) => {
  console.log(`\n${title}`);
  for (const item of items) console.log(`- ${item}`);
};

const run = () => {
  const args = parseArgs(process.argv.slice(2));
  const remote = Boolean(args.projectRef);
  let env = {};
  let loaded = [];
  try {
    if (remote) {
      env = loadRemote(args);
    } else {
      const local = loadLocal(args.envFiles);
      env = local.values;
      loaded = local.loaded;
    }
  } catch (error) {
    console.error('ERROR: Unable to inspect Supabase Gmail secret names.');
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  const required = [
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'GMAIL_SUPPORT_CLIENT_ID',
    'GMAIL_SUPPORT_CLIENT_SECRET',
    'GMAIL_SUPPORT_REFRESH_TOKEN',
    'GMAIL_SUPPORT_MAILBOX',
    'GMAIL_REFUND_LABEL_ID',
    'REFUND_GMAIL_SYNC_SECRET',
    'REFUND_GMAIL_ENABLED',
    'REFUND_GMAIL_FIRST_CONTACT_MODE',
  ];
  const errors = required
    .filter((key) => !env[key] || String(env[key]).trim() === '')
    .map((key) => `${key} is missing.`);
  const warnings = [];

  const exposedKeys = Object.keys(env).filter(
    (key) => key.startsWith('VITE_GMAIL_') || key.startsWith('VITE_REFUND_GMAIL_'),
  );
  if (exposedKeys.length > 0) {
    errors.push(`Gmail secrets must not use browser-exposed VITE_ names: ${exposedKeys.join(', ')}.`);
  }

  if (!remote) {
    const mailbox = String(env.GMAIL_SUPPORT_MAILBOX ?? '').trim();
    if (mailbox && !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(mailbox)) {
      errors.push('GMAIL_SUPPORT_MAILBOX must be one valid mailbox address.');
    }
    const sendAsAliases = String(env.GMAIL_SUPPORT_SEND_AS_ALIASES ?? '')
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean);
    if (sendAsAliases.length > 20 ||
      sendAsAliases.some((value) => !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value))) {
      errors.push('GMAIL_SUPPORT_SEND_AS_ALIASES must contain at most 20 valid comma-separated Gmail send-as addresses.');
    }
    const enabled = String(env.REFUND_GMAIL_ENABLED ?? '').trim().toLowerCase();
    if (enabled && !['true', 'false'].includes(enabled)) {
      errors.push('REFUND_GMAIL_ENABLED must be true or false.');
    } else if (enabled === 'true') {
      warnings.push('REFUND_GMAIL_ENABLED is true; confirm all approvals and synthetic shadow checks before continuing.');
    }
    const aliases = String(env.GMAIL_SUPPORT_SEND_AS_ALIASES ?? '')
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean);
    const invalidAliases = aliases.filter((value) => !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value));
    if (invalidAliases.length > 0) {
      errors.push('GMAIL_SUPPORT_SEND_AS_ALIASES must contain only valid comma-separated addresses.');
    }
    if (new Set(aliases).size !== aliases.length) {
      errors.push('GMAIL_SUPPORT_SEND_AS_ALIASES must not contain duplicate addresses.');
    }
    if (enabled === 'true' && aliases.length === 0) {
      errors.push('GMAIL_SUPPORT_SEND_AS_ALIASES must list every approved send-as alias before Gmail is enabled.');
    }
    if (env.GMAIL_REFUND_START_AT && !Number.isFinite(new Date(env.GMAIL_REFUND_START_AT).getTime())) {
      errors.push('GMAIL_REFUND_START_AT must be a valid ISO timestamp when provided.');
    }
    if (env.GMAIL_REFUND_MAX_THREADS_PER_RUN) {
      const maxThreads = Number(env.GMAIL_REFUND_MAX_THREADS_PER_RUN);
      if (!Number.isInteger(maxThreads) || maxThreads < 1 || maxThreads > 500) {
        errors.push('GMAIL_REFUND_MAX_THREADS_PER_RUN must be an integer from 1 to 500.');
      }
    }

    const firstContactMode = String(env.REFUND_GMAIL_FIRST_CONTACT_MODE ?? '').trim().toLowerCase();
    if (!['disabled', 'shadow', 'isolated_test', 'active'].includes(firstContactMode)) {
      errors.push('REFUND_GMAIL_FIRST_CONTACT_MODE must be disabled, shadow, isolated_test, or active.');
    }
    const cutoverAt = String(env.REFUND_GMAIL_FIRST_CONTACT_CUTOVER_AT ?? '').trim();
    const validCutoverAt = cutoverAt && Number.isFinite(new Date(cutoverAt).getTime());
    if (['isolated_test', 'active'].includes(firstContactMode) && !validCutoverAt) {
      errors.push('REFUND_GMAIL_FIRST_CONTACT_CUTOVER_AT must be a valid ISO timestamp before any send mode.');
    }
    if (firstContactMode === 'isolated_test' &&
      String(env.REFUND_GMAIL_FIRST_CONTACT_ISOLATED_CONFIRMED ?? '').trim().toLowerCase() !== 'true') {
      errors.push('Isolated first-contact sending requires REFUND_GMAIL_FIRST_CONTACT_ISOLATED_CONFIRMED=true.');
    }
    if (firstContactMode === 'isolated_test') {
      const currentLabel = String(env.GMAIL_REFUND_LABEL_ID ?? '').trim();
      const isolatedLabel = String(env.REFUND_GMAIL_FIRST_CONTACT_ISOLATED_LABEL_ID ?? '').trim();
      const productionLabel = String(env.REFUND_GMAIL_FIRST_CONTACT_PRODUCTION_LABEL_ID ?? '').trim();
      if (!isolatedLabel || !productionLabel || currentLabel !== isolatedLabel || isolatedLabel === productionLabel) {
        errors.push('Isolated first-contact sending requires a configured label distinct from the production refund label.');
      }
      const isolatedSenders = String(env.REFUND_GMAIL_FIRST_CONTACT_ISOLATED_SENDERS ?? '')
        .split(',')
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean);
      if (isolatedSenders.length < 1 || isolatedSenders.length > 20 ||
        isolatedSenders.some((value) => !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value))) {
        errors.push('Isolated first-contact sending requires 1-20 valid synthetic sender addresses.');
      }
    }
    if (firstContactMode === 'active') {
      if (String(env.GMAIL_REFUND_LABEL_ID ?? '').trim() !==
        String(env.REFUND_GMAIL_FIRST_CONTACT_PRODUCTION_LABEL_ID ?? '').trim()) {
        errors.push('Active first-contact sending requires the reviewed production refund label.');
      }
      if (String(env.REFUND_GMAIL_LEGACY_RESPONDER_DISABLED ?? '').trim().toLowerCase() !== 'true') {
        errors.push('Active first-contact sending requires REFUND_GMAIL_LEGACY_RESPONDER_DISABLED=true.');
      }
      if (String(env.REFUND_GMAIL_FIRST_CONTACT_CUTOVER_APPROVED ?? '').trim().toLowerCase() !== 'true') {
        errors.push('Active first-contact sending requires REFUND_GMAIL_FIRST_CONTACT_CUTOVER_APPROVED=true.');
      }
    } else if (firstContactMode === 'isolated_test') {
      warnings.push('First-contact isolated test mode is selected; use only a synthetic mailbox or label excluded from the legacy responder.');
    } else if (firstContactMode === 'shadow') {
      warnings.push('First-contact shadow mode records would-send operations but sends no acknowledgement.');
    }

    for (const key of [
      'REFUND_GMAIL_FIRST_CONTACT_REFUND_URL',
      'REFUND_GMAIL_FIRST_CONTACT_LEGACY_URL',
      'REFUND_GMAIL_FIRST_CONTACT_SUPPORT_URL',
    ]) {
      const value = String(env[key] ?? '').trim();
      if (!value) continue;
      try {
        const parsed = new URL(value);
        const allowedHosts = key === 'REFUND_GMAIL_FIRST_CONTACT_LEGACY_URL'
          ? new Set(['forms.gle', 'docs.google.com'])
          : new Set(['bloomjoyusa.com', 'www.bloomjoyusa.com']);
        if (parsed.protocol !== 'https:' || parsed.username || parsed.password ||
          !allowedHosts.has(parsed.hostname.toLowerCase())) {
          errors.push(`${key} must use an approved public HTTPS host without embedded credentials.`);
        }
      } catch {
        errors.push(`${key} must be a valid public HTTPS URL when provided.`);
      }
    }
  } else {
    warnings.push('Remote inspection confirms secret names only; verify mailbox, OAuth scopes, and fail-closed values separately.');
  }

  console.log(`INFO: Refund Gmail preflight source: ${remote ? `remote Supabase secrets (${args.projectRef})` : 'local environment'}`);
  if (loaded.length > 0) console.log(`INFO: Loaded env files: ${loaded.join(', ')}`);
  printList('Required Gmail controls', [
    'Exact designated mailbox and explicit refund label configured',
    'Approved send-as aliases inventoried for participant, first-contact, and CC boundaries',
    'OAuth client and refresh token kept server-only',
    'Dedicated scheduler secret configured',
    'Supabase service credentials available to the Edge Function',
    'Server-side enable switch explicitly configured',
    'First-contact mode explicitly configured and defaulted to disabled or shadow',
    'Active mode requires a timestamped legacy-disable and cutover approval gate',
  ]);
  if (warnings.length > 0) printList('Warnings', warnings);
  if (errors.length > 0) {
    printList('Errors', errors);
    process.exit(1);
  }
  console.log('\nRefund Gmail preflight checks passed without printing secret values.');
};

run();
