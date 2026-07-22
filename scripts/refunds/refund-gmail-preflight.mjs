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
  ];
  const errors = required
    .filter((key) => !env[key] || String(env[key]).trim() === '')
    .map((key) => `${key} is missing.`);
  const warnings = [];

  const exposedKeys = Object.keys(env).filter(
    (key) => key.startsWith('VITE_GMAIL_') || key === 'VITE_REFUND_GMAIL_SYNC_SECRET',
  );
  if (exposedKeys.length > 0) {
    errors.push(`Gmail secrets must not use browser-exposed VITE_ names: ${exposedKeys.join(', ')}.`);
  }

  if (!remote) {
    const mailbox = String(env.GMAIL_SUPPORT_MAILBOX ?? '').trim();
    if (mailbox && !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(mailbox)) {
      errors.push('GMAIL_SUPPORT_MAILBOX must be one valid mailbox address.');
    }
    const enabled = String(env.REFUND_GMAIL_ENABLED ?? '').trim().toLowerCase();
    if (enabled && !['true', 'false'].includes(enabled)) {
      errors.push('REFUND_GMAIL_ENABLED must be true or false.');
    } else if (enabled === 'true') {
      warnings.push('REFUND_GMAIL_ENABLED is true; confirm all approvals and synthetic shadow checks before continuing.');
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
  } else {
    warnings.push('Remote inspection confirms secret names only; verify mailbox, OAuth scopes, and fail-closed values separately.');
  }

  console.log(`INFO: Refund Gmail preflight source: ${remote ? `remote Supabase secrets (${args.projectRef})` : 'local environment'}`);
  if (loaded.length > 0) console.log(`INFO: Loaded env files: ${loaded.join(', ')}`);
  printList('Required Gmail controls', [
    'Exact designated mailbox and explicit refund label configured',
    'OAuth client and refresh token kept server-only',
    'Dedicated scheduler secret configured',
    'Supabase service credentials available to the Edge Function',
    'Server-side enable switch explicitly configured',
  ]);
  if (warnings.length > 0) printList('Warnings', warnings);
  if (errors.length > 0) {
    printList('Errors', errors);
    process.exit(1);
  }
  console.log('\nRefund Gmail preflight checks passed without printing secret values.');
};

run();
