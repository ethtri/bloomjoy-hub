#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const DEFAULTS = {
  envFiles: ['.env', '.env.local'],
  projectRef: '',
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

async function run() {
  const args = parseArgs(process.argv.slice(2));
  const { merged, loadedFiles } = loadEnvFiles(args.envFiles);
  const env = { ...merged, ...process.env };
  const errors = [];
  const warnings = [];

  const supabaseUrl = env.VITE_SUPABASE_URL || env.SUPABASE_URL;
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl) {
    errors.push('Missing VITE_SUPABASE_URL or SUPABASE_URL.');
  }

  if (!serviceRoleKey) {
    errors.push('Missing SUPABASE_SERVICE_ROLE_KEY.');
  }

  let projectRefFromUrl = '';
  if (supabaseUrl) {
    try {
      projectRefFromUrl = new URL(supabaseUrl).host.split('.')[0];
    } catch {
      errors.push('Supabase URL must be a valid absolute URL.');
    }
  }

  if (
    args.projectRef &&
    projectRefFromUrl &&
    args.projectRef !== projectRefFromUrl
  ) {
    warnings.push(
      `Requested project ref ${args.projectRef} does not match the configured Supabase URL (${projectRefFromUrl}).`
    );
  }

  if (errors.length > 0) {
    console.error('Submission preflight failed before connecting:');
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  const checks = [];

  const columnChecks = [
    {
      label: 'lead_submissions.internal_notification_sent_at',
      table: 'lead_submissions',
      columns: 'id, internal_notification_sent_at',
    },
    {
      label: 'mini_waitlist_submissions.internal_notification_sent_at',
      table: 'mini_waitlist_submissions',
      columns: 'id, internal_notification_sent_at',
    },
  ];

  for (const check of columnChecks) {
    const { error } = await supabase.from(check.table).select(check.columns).limit(1);
    checks.push({
      label: check.label,
      ok: !error,
      detail: error?.message ?? 'OK',
    });
  }

  const dispatchTypes = [
    'lead_submission',
    'mini_waitlist',
    'order_checkout',
    'plus_subscription_activated',
  ];

  for (const dispatchType of dispatchTypes) {
    const eventKey = `submission_preflight:${dispatchType}:${crypto.randomUUID()}`;
    const insertResult = await supabase.from('internal_notification_dispatches').insert({
      event_key: eventKey,
      dispatch_type: dispatchType,
      source_table: 'submission_preflight',
      source_id: eventKey,
      meta: {
        preflight: true,
      },
    });

    if (insertResult.error) {
      checks.push({
        label: `dispatch_type:${dispatchType}`,
        ok: false,
        detail: insertResult.error.message,
      });
      continue;
    }

    const deleteResult = await supabase
      .from('internal_notification_dispatches')
      .delete()
      .eq('event_key', eventKey);

    checks.push({
      label: `dispatch_type:${dispatchType}`,
      ok: !deleteResult.error,
      detail: deleteResult.error?.message ?? 'OK',
    });
  }

  console.log(
    `INFO: Submission preflight against ${projectRefFromUrl || 'configured Supabase project'}`
  );
  if (loadedFiles.length > 0) {
    console.log(`INFO: Loaded env files: ${loadedFiles.join(', ')}`);
  }

  for (const check of checks) {
    const status = check.ok ? 'PASS' : 'FAIL';
    console.log(`- ${status}: ${check.label} -> ${check.detail}`);
  }

  if (warnings.length > 0) {
    console.log('\nWarnings');
    for (const warning of warnings) {
      console.log(`- ${warning}`);
    }
  }

  const failedChecks = checks.filter((check) => !check.ok);
  if (failedChecks.length > 0) {
    process.exit(1);
  }

  console.log('\nSubmission preflight checks passed.');
}

run().catch((error) => {
  console.error('Submission preflight crashed.');
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
