#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');
const linkedProjectRefPath = path.join(repoRoot, 'supabase', '.temp', 'project-ref');

const RESULT_KEYS = [
  'read_only',
  'public_option_count',
  'unsafe_internal_label_count',
  'atlanta_option_count',
  'dc_option_count',
  'seattle_option_count',
  'duplicate_machine_row_count',
  'duplicate_display_row_count',
];

export const PUBLIC_OPTIONS_QUERY = `
with options as (
  select *
  from public.public_refund_machine_options()
)
select
  true as read_only,
  count(*)::integer as public_option_count,
  count(*) filter (
    where lower(coalesce(machine_label, '') || ' ' || coalesce(location_name, ''))
      ~ '(unmapped|unknown)'
  )::integer as unsafe_internal_label_count,
  count(*) filter (
    where lower(coalesce(machine_label, '') || ' ' || coalesce(location_name, '')) like '%atlanta%'
  )::integer as atlanta_option_count,
  count(*) filter (
    where lower(coalesce(machine_label, '') || ' ' || coalesce(location_name, ''))
      ~ '(^|[^a-z])(dc|washington)([^a-z]|$)'
  )::integer as dc_option_count,
  count(*) filter (
    where lower(coalesce(machine_label, '') || ' ' || coalesce(location_name, '')) like '%seattle%'
  )::integer as seattle_option_count,
  (count(*) - count(distinct machine_id))::integer as duplicate_machine_row_count,
  (
    count(*)
    - count(distinct lower(coalesce(machine_label, '')) || '|' || lower(coalesce(location_name, '')))
  )::integer as duplicate_display_row_count
from options;
`.trim();

export function parseArgs(argv) {
  const args = {
    projectRef: '',
    confirmProjectRef: '',
    allowNotReady: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === '--help' || arg === '-h') {
      args.help = true;
      continue;
    }

    if (arg === '--project-ref' && next) {
      args.projectRef = next.trim();
      index += 1;
      continue;
    }

    if (arg === '--confirm-project-ref' && next) {
      args.confirmProjectRef = next.trim();
      index += 1;
      continue;
    }

    if (arg === '--allow-not-ready') {
      args.allowNotReady = true;
      continue;
    }

    throw new Error(`Unknown or incomplete argument: ${arg}`);
  }

  return args;
}

function printHelp() {
  console.log(`Refund public-options production smoke (aggregate-only)

Run after deploying the approved public-label migration:
  npm run refunds:smoke-public-options -- --project-ref <ref> --confirm-project-ref <ref>

Use --allow-not-ready only to capture a pre-deployment baseline. The query is
read-only and prints counts only; it never prints machine or location identifiers.`);
}

export function validateAggregateRow(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) {
    throw new Error('Public-options smoke did not return one aggregate object.');
  }

  const actualKeys = Object.keys(row).sort();
  const expectedKeys = [...RESULT_KEYS].sort();
  if (JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys)) {
    throw new Error('Public-options smoke returned unexpected columns; refusing to print them.');
  }

  if (row.read_only !== true) {
    throw new Error('Public-options smoke did not affirm read-only mode.');
  }

  for (const key of RESULT_KEYS.filter((key) => key !== 'read_only')) {
    const value = row[key];
    if (!Number.isInteger(value) || value < 0) {
      throw new Error(`Public-options aggregate ${key} is invalid.`);
    }
  }

  return row;
}

export function determineReadiness(row) {
  const checks = {
    hasPublicOptions: row.public_option_count >= 3,
    noInternalLabels: row.unsafe_internal_label_count === 0,
    atlantaPresent: row.atlanta_option_count >= 1,
    dcPresent: row.dc_option_count >= 1,
    seattlePresent: row.seattle_option_count >= 1,
    noDuplicateMachineRows: row.duplicate_machine_row_count === 0,
    noDuplicateDisplayRows: row.duplicate_display_row_count === 0,
  };

  return {
    ready: Object.values(checks).every(Boolean),
    checks,
  };
}

function runLinkedQuery(query) {
  const result = spawnSync(
    'supabase',
    ['db', 'query', '--linked', '--output', 'json', '--agent=yes', '--', query],
    {
      cwd: repoRoot,
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: 2 * 1024 * 1024,
    }
  );

  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = String(result.stderr || '').trim();
    throw new Error(detail ? `Linked read-only query failed: ${detail}` : 'Linked read-only query failed.');
  }

  let payload;
  try {
    payload = JSON.parse(result.stdout);
  } catch {
    throw new Error('Linked read-only query returned invalid JSON.');
  }

  if (!Array.isArray(payload.rows) || payload.rows.length !== 1) {
    throw new Error('Linked read-only query must return exactly one aggregate row.');
  }

  return validateAggregateRow(payload.rows[0]);
}

function printAggregate(row, projectRef) {
  const readiness = determineReadiness(row);
  console.log('Refund public-options production smoke');
  console.log(`Project ref: ${projectRef}`);
  console.log('Read-only query: yes');
  console.log(`Public options: ${row.public_option_count}`);
  console.log(`Unsafe internal labels: ${row.unsafe_internal_label_count}`);
  console.log(`Atlanta options: ${row.atlanta_option_count}`);
  console.log(`DC options: ${row.dc_option_count}`);
  console.log(`Seattle options: ${row.seattle_option_count}`);
  console.log(`Duplicate machine rows: ${row.duplicate_machine_row_count}`);
  console.log(`Duplicate display rows: ${row.duplicate_display_row_count}`);
  console.log(`Overall: ${readiness.ready ? 'PASS' : 'NOT READY'}`);
  console.log('No machine or location identifiers were printed or written.');
  return readiness;
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  if (!args.projectRef || !args.confirmProjectRef) {
    throw new Error('--project-ref and --confirm-project-ref are both required.');
  }

  if (args.projectRef !== args.confirmProjectRef) {
    throw new Error('--confirm-project-ref must exactly match --project-ref.');
  }

  if (!fs.existsSync(linkedProjectRefPath)) {
    throw new Error('No linked Supabase project was found in this worktree.');
  }

  const linkedProjectRef = fs.readFileSync(linkedProjectRefPath, 'utf8').trim();
  if (linkedProjectRef !== args.projectRef) {
    throw new Error(`Linked project ref does not match --project-ref ${args.projectRef}.`);
  }

  const row = runLinkedQuery(PUBLIC_OPTIONS_QUERY);
  const readiness = printAggregate(row, args.projectRef);
  if (!readiness.ready && !args.allowNotReady) process.exitCode = 2;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === __filename;
if (isMain) {
  run().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`ERROR: ${message}`);
    process.exit(1);
  });
}
