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
  'active_inventory_machine_count',
  'published_inventory_count',
  'needs_setup_inventory_count',
  'excluded_inventory_count',
  'unaccounted_active_count',
  'public_option_count',
  'published_missing_public_option_count',
  'stale_published_count',
  'unsafe_internal_label_count',
  'snapcase_category_count',
  'duplicate_machine_row_count',
  'duplicate_display_row_count',
];

export const PUBLIC_OPTIONS_QUERY = `
with active_inventory as (
  select inventory.*
  from public.refund_nayax_machine_inventory inventory
  where inventory.provider_is_active
),
options as (
  select *
  from public.public_refund_machine_options()
)
select
  true as read_only,
  (select count(*)::integer from active_inventory) as active_inventory_machine_count,
  (select count(*)::integer from active_inventory where reconciliation_state = 'published') as published_inventory_count,
  (select count(*)::integer from active_inventory where reconciliation_state = 'needs_setup') as needs_setup_inventory_count,
  (select count(*)::integer from active_inventory where reconciliation_state = 'excluded') as excluded_inventory_count,
  (
    select count(*)::integer from active_inventory
    where reconciliation_state not in ('published', 'needs_setup', 'excluded')
  ) as unaccounted_active_count,
  count(*)::integer as public_option_count,
  (
    select count(*)::integer
    from active_inventory inventory
    left join options option on option.machine_id = inventory.reporting_machine_id
    where inventory.reconciliation_state = 'published'
      and option.machine_id is null
  ) as published_missing_public_option_count,
  (
    select count(*)::integer
    from public.refund_nayax_machine_inventory inventory
    left join options option on option.machine_id = inventory.reporting_machine_id
    where inventory.reconciliation_state = 'published'
      and (not inventory.provider_is_active or option.machine_id is null)
  ) as stale_published_count,
  count(*) filter (
    where lower(coalesce(machine_label, '') || ' ' || coalesce(location_name, ''))
      ~ '(unmapped|unknown)'
  )::integer as unsafe_internal_label_count,
  (select count(*)::integer from active_inventory where refund_category = 'snapcase') as snapcase_category_count,
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

Run after deploying the approved portfolio-intake migration and intake function:
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
    hasPublicOptions: row.public_option_count >= 1,
    everyActiveMachineAccounted:
      row.unaccounted_active_count === 0 &&
      row.active_inventory_machine_count ===
        row.published_inventory_count + row.needs_setup_inventory_count + row.excluded_inventory_count,
    noSetupWorkRemaining: row.needs_setup_inventory_count === 0,
    everyPublishedMachinePublic:
      row.published_missing_public_option_count === 0 &&
      row.stale_published_count === 0,
    noInternalLabels: row.unsafe_internal_label_count === 0,
    snapcaseAccounted: row.snapcase_category_count >= 3,
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
  console.log(`Active Nayax inventory machines: ${row.active_inventory_machine_count}`);
  console.log(`Published inventory machines: ${row.published_inventory_count}`);
  console.log(`Needs setup: ${row.needs_setup_inventory_count}`);
  console.log(`Explicitly excluded: ${row.excluded_inventory_count}`);
  console.log(`Unaccounted active machines: ${row.unaccounted_active_count}`);
  console.log(`Public options: ${row.public_option_count}`);
  console.log(`Published but missing from public options: ${row.published_missing_public_option_count}`);
  console.log(`Stale published machines: ${row.stale_published_count}`);
  console.log(`Unsafe internal labels: ${row.unsafe_internal_label_count}`);
  console.log(`Explicit Snapcase categories: ${row.snapcase_category_count}`);
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
