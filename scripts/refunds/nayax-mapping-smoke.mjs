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
  'active_refund_machine_count',
  'configured_nayax_mapping_count',
  'missing_nayax_mapping_count',
  'missing_nayax_account_count',
  'duplicate_nayax_mapping_count',
  'distinct_nayax_account_count',
  'machine_with_active_manager_count',
  'machine_with_timezone_count',
  'shadow_ready_mapping_count',
  'live_refund_enabled_machine_count',
];

export const NAYAX_MAPPING_QUERY = `
with active_refund_machines as (
  select
    machine.id,
    trim(coalesce(machine.nayax_machine_id, '')) as nayax_machine_id,
    upper(trim(coalesce(machine.nayax_account_key, ''))) as nayax_account_key,
    coalesce(machine.nayax_refunds_enabled, false) as nayax_refunds_enabled,
    machine.location_id
  from public.reporting_machines machine
  where machine.status = 'active'
    and machine.refund_intake_enabled is true
),
manager_counts as (
  select
    manager.reporting_machine_id,
    count(*)::integer as manager_count
  from public.reporting_machine_refund_managers manager
  where manager.status = 'active'
    and manager.revoked_at is null
  group by manager.reporting_machine_id
),
mapping_rows as (
  select
    machine.id,
    machine.nayax_machine_id,
    machine.nayax_account_key,
    machine.nayax_refunds_enabled,
    coalesce(manager.manager_count, 0) as manager_count,
    trim(coalesce(location.timezone, '')) as location_timezone
  from active_refund_machines machine
  left join manager_counts manager
    on manager.reporting_machine_id = machine.id
  left join public.reporting_locations location
    on location.id = machine.location_id
    and location.status = 'active'
),
duplicate_rows as (
  select greatest(count(*) - 1, 0)::integer as duplicate_count
  from mapping_rows
  where nayax_machine_id <> ''
    and nayax_account_key <> ''
  group by nayax_account_key, nayax_machine_id
  having count(*) > 1
)
select
  true as read_only,
  count(*)::integer as active_refund_machine_count,
  count(*) filter (where nayax_machine_id <> '')::integer as configured_nayax_mapping_count,
  count(*) filter (where nayax_machine_id = '')::integer as missing_nayax_mapping_count,
  count(*) filter (where nayax_account_key = '')::integer as missing_nayax_account_count,
  coalesce((select sum(duplicate_count) from duplicate_rows), 0)::integer as duplicate_nayax_mapping_count,
  count(distinct nayax_account_key) filter (where nayax_account_key <> '')::integer
    as distinct_nayax_account_count,
  count(*) filter (where manager_count between 1 and 3)::integer
    as machine_with_active_manager_count,
  count(*) filter (where location_timezone <> '')::integer as machine_with_timezone_count,
  count(*) filter (
    where nayax_machine_id <> ''
      and nayax_account_key <> ''
      and manager_count between 1 and 3
      and location_timezone <> ''
  )::integer as shadow_ready_mapping_count,
  count(*) filter (where nayax_refunds_enabled is true)::integer
    as live_refund_enabled_machine_count
from mapping_rows;
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
  console.log(`Refund Nayax production mapping smoke (aggregate-only)

Run against the exact linked production project:
  npm run refunds:smoke-nayax-mapping -- --project-ref <ref> --confirm-project-ref <ref>

The query is SELECT-only and prints counts only. It never prints or writes machine,
location, manager, case, customer, card, or provider identifiers. It does not call
Nayax and does not test live refund execution. Use --allow-not-ready only for discovery.`);
}

export function validateAggregateRow(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) {
    throw new Error('Nayax mapping smoke did not return one aggregate object.');
  }

  const actualKeys = Object.keys(row).sort();
  const expectedKeys = [...RESULT_KEYS].sort();
  if (JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys)) {
    throw new Error('Nayax mapping smoke returned unexpected columns; refusing to print them.');
  }

  if (row.read_only !== true) {
    throw new Error('Nayax mapping smoke did not affirm read-only mode.');
  }

  for (const key of RESULT_KEYS.filter((key) => key !== 'read_only')) {
    const value = row[key];
    if (!Number.isInteger(value) || value < 0) {
      throw new Error(`Nayax mapping aggregate ${key} is invalid.`);
    }
  }

  return row;
}

export function determineReadiness(row) {
  const checks = {
    hasPilotMachines: row.active_refund_machine_count >= 3,
    everyMachineMapped:
      row.configured_nayax_mapping_count === row.active_refund_machine_count &&
      row.missing_nayax_mapping_count === 0,
    everyMappingHasAccount: row.missing_nayax_account_count === 0,
    noDuplicateMappings: row.duplicate_nayax_mapping_count === 0,
    everyMachineHasManager:
      row.machine_with_active_manager_count === row.active_refund_machine_count,
    everyMachineHasTimezone:
      row.machine_with_timezone_count === row.active_refund_machine_count,
    everyMappingShadowReady:
      row.shadow_ready_mapping_count === row.active_refund_machine_count,
    liveExecutionOff: row.live_refund_enabled_machine_count === 0,
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
  console.log('Refund Nayax production mapping smoke');
  console.log(`Project ref: ${projectRef}`);
  console.log('Read-only query: yes');
  console.log(`Active refund-intake machines: ${row.active_refund_machine_count}`);
  console.log(`Configured Nayax mappings: ${row.configured_nayax_mapping_count}`);
  console.log(`Missing Nayax mappings: ${row.missing_nayax_mapping_count}`);
  console.log(`Mappings missing account: ${row.missing_nayax_account_count}`);
  console.log(`Duplicate Nayax mappings: ${row.duplicate_nayax_mapping_count}`);
  console.log(`Distinct Nayax accounts: ${row.distinct_nayax_account_count}`);
  console.log(`Machines with 1-3 active managers: ${row.machine_with_active_manager_count}`);
  console.log(`Machines with a location timezone: ${row.machine_with_timezone_count}`);
  console.log(`Shadow-ready mappings: ${row.shadow_ready_mapping_count}`);
  console.log(`Machines with live refund execution enabled: ${row.live_refund_enabled_machine_count}`);
  console.log(`Overall: ${readiness.ready ? 'PASS' : 'NOT READY'}`);
  console.log('No identifiers or production records were printed or written.');
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

  const row = runLinkedQuery(NAYAX_MAPPING_QUERY);
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
