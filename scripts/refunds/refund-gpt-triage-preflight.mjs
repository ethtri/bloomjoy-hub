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
    console.error('ERROR: Unable to inspect Supabase/OpenAI refund triage secret names.');
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  const required = [
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'OPENAI_API_KEY',
    'OPENAI_REFUND_TRIAGE_SAFETY_SALT',
    'REFUND_GPT_TRIAGE_SYNC_SECRET',
    'REFUND_GPT_TRIAGE_ENABLED',
  ];
  const errors = required
    .filter((key) => !env[key] || String(env[key]).trim() === '')
    .map((key) => `${key} is missing.`);
  const warnings = [];

  const exposedKeys = Object.keys(env).filter(
    (key) => key.startsWith('VITE_OPENAI_') || key.startsWith('VITE_REFUND_GPT_'),
  );
  if (exposedKeys.length > 0) {
    errors.push(`OpenAI/refund GPT secrets must not use browser-exposed VITE_ names: ${exposedKeys.join(', ')}.`);
  }

  if (!remote) {
    const enabled = String(env.REFUND_GPT_TRIAGE_ENABLED ?? '').trim().toLowerCase();
    if (enabled && !['true', 'false'].includes(enabled)) {
      errors.push('REFUND_GPT_TRIAGE_ENABLED must be true or false.');
    } else if (enabled === 'true') {
      warnings.push('REFUND_GPT_TRIAGE_ENABLED is true; confirm privacy approval and sanitized evaluation before continuing.');
    }
    const model = String(env.OPENAI_REFUND_TRIAGE_MODEL ?? 'gpt-5.6-terra').trim();
    if (!/^gpt-5\.6-(?:sol|terra|luna)$/.test(model)) {
      errors.push('OPENAI_REFUND_TRIAGE_MODEL must be gpt-5.6-sol, gpt-5.6-terra, or gpt-5.6-luna.');
    }
    if (env.OPENAI_REFUND_TRIAGE_SAFETY_SALT && String(env.OPENAI_REFUND_TRIAGE_SAFETY_SALT).trim().length < 32) {
      errors.push('OPENAI_REFUND_TRIAGE_SAFETY_SALT must contain at least 32 characters.');
    }
    if (env.REFUND_GPT_TRIAGE_MAX_JOBS_PER_RUN) {
      const limit = Number(env.REFUND_GPT_TRIAGE_MAX_JOBS_PER_RUN);
      if (!Number.isInteger(limit) || limit < 1 || limit > 10) {
        errors.push('REFUND_GPT_TRIAGE_MAX_JOBS_PER_RUN must be an integer from 1 to 10.');
      }
    }
  } else {
    warnings.push('Remote inspection confirms secret names only; separately verify both enable switches remain false before deployment.');
  }

  console.log(`INFO: Refund GPT triage preflight source: ${remote ? `remote Supabase secrets (${args.projectRef})` : 'local environment'}`);
  if (loaded.length > 0) console.log(`INFO: Loaded env files: ${loaded.join(', ')}`);
  printList('Required GPT triage controls', [
    'OpenAI credential and safety-identifier salt stay server-only',
    'Dedicated scheduler secret configured',
    'Supabase service credentials available to the Edge Function',
    'Edge and database enable switches remain independently fail-closed',
    'Strict schema, human review, no auto-send, and store:false remain enforced',
  ]);
  if (warnings.length > 0) printList('Warnings', warnings);
  if (errors.length > 0) {
    printList('Errors', errors);
    process.exit(1);
  }
  console.log('\nRefund GPT triage preflight checks passed without printing secret values.');
};

run();
