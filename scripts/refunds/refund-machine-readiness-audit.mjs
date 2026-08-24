#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');
const linkedProjectRefPath = path.join(repoRoot, 'supabase', '.temp', 'project-ref');

export const RESULT_KEYS = [
  'read_only',
  'active_customer_machine_count',
  'ready_to_refund_count',
  'ready_to_activate_count',
  'setup_needed_count',
  'approved_exception_count',
  'unexplained_disabled_count',
  'over_standard_cap_count',
  'tulsa_machine_count',
  'tulsa_ready_to_refund_count',
  'tulsa_reviewed_blocker_count',
  'tulsa_unexplained_count',
  'nonterminal_confirmed_case_count',
  'confirmed_case_ready_count',
  'confirmed_case_blocked_count',
  'confirmed_case_unknown_count'
];

export const MACHINE_READINESS_QUERY = `
with active_customer_machines as (
  select
    machine.id,
    location.name as location_name,
    coalesce(nullif(trim(machine.refund_public_display_label), ''), machine.machine_label) as display_label,
    machine.refund_intake_enabled,
    machine.nayax_refunds_enabled,
    machine.nayax_refund_max_amount_cents,
    machine.nayax_refunds_disabled_reason,
    (
      nullif(trim(machine.nayax_machine_id), '') is not null
      and exists (
        select 1
        from public.refund_nayax_machine_inventory inventory
        where inventory.reporting_machine_id = machine.id
          and inventory.account_key = upper(coalesce(machine.nayax_account_key, 'TGPACI_USA_DB'))
          and inventory.nayax_machine_id = trim(machine.nayax_machine_id)
          and inventory.provider_is_active
          and inventory.missing_successful_snapshots < 2
          and inventory.reconciliation_state = 'published'
          and inventory.refund_category in ('cotton_candy', 'snapcase')
      )
      and exists (
        select 1
        from public.reporting_machine_refund_managers manager
        where manager.reporting_machine_id = machine.id
          and manager.status = 'active'
          and manager.revoked_at is null
      )
    ) as activation_prerequisites_ready
  from public.reporting_machines machine
  join public.reporting_locations location on location.id = machine.location_id
  where machine.status = 'active'
    and location.status = 'active'
    and machine.refund_intake_enabled = true
),
machine_states as (
  select
    machine.*,
    (
      machine.activation_prerequisites_ready
      and machine.nayax_refunds_enabled
      and machine.nayax_refund_max_amount_cents between 1 and 5000
    ) as ready_to_refund,
    (
      machine.activation_prerequisites_ready
      and not machine.nayax_refunds_enabled
      and machine.nayax_refunds_disabled_reason = 'awaiting_reviewed_activation'
    ) as ready_to_activate,
    (
      not machine.nayax_refunds_enabled
      and machine.nayax_refunds_disabled_reason in (
        'owner_pause', 'provider_support', 'machine_maintenance', 'commercial_exception'
      )
    ) as approved_exception,
    (
      machine.activation_prerequisites_ready
      and not machine.nayax_refunds_enabled
      and machine.nayax_refunds_disabled_reason is null
    ) as unexplained_disabled,
    (
      machine.nayax_refunds_enabled
      and coalesce(machine.nayax_refund_max_amount_cents, 0) > 5000
    ) as over_standard_cap,
    (
      lower(trim(machine.location_name)) = lower('Tulsa Premium Outlets')
      and lower(machine.display_label) like '%cotton candy%'
    ) as is_tulsa_cotton_candy
  from active_customer_machines machine
),
confirmed_cases as (
  select
    refund_case.id,
    public.refund_case_card_refund_readiness(refund_case.id) as readiness
  from public.refund_cases refund_case
  where refund_case.status not in ('completed', 'denied')
    and refund_case.correlation_status = 'matched'
    and public.is_review_safe_nayax_transaction_reference(refund_case.matched_nayax_transaction_id)
),
case_states as (
  select
    confirmed.id,
    coalesce((confirmed.readiness ->> 'canIssueCardRefund')::boolean, false) as ready,
    nullif(trim(confirmed.readiness ->> 'blockReason'), '') as block_reason
  from confirmed_cases confirmed
)
select
  true as read_only,
  (select count(*)::integer from machine_states) as active_customer_machine_count,
  (select count(*)::integer from machine_states where ready_to_refund) as ready_to_refund_count,
  (select count(*)::integer from machine_states where ready_to_activate) as ready_to_activate_count,
  (
    select count(*)::integer from machine_states
    where not activation_prerequisites_ready
      and not approved_exception
  ) as setup_needed_count,
  (select count(*)::integer from machine_states where approved_exception) as approved_exception_count,
  (select count(*)::integer from machine_states where unexplained_disabled) as unexplained_disabled_count,
  (select count(*)::integer from machine_states where over_standard_cap) as over_standard_cap_count,
  (select count(*)::integer from machine_states where is_tulsa_cotton_candy) as tulsa_machine_count,
  (
    select count(*)::integer from machine_states
    where is_tulsa_cotton_candy and ready_to_refund
  ) as tulsa_ready_to_refund_count,
  (
    select count(*)::integer from machine_states
    where is_tulsa_cotton_candy
      and (ready_to_activate or approved_exception or not activation_prerequisites_ready)
  ) as tulsa_reviewed_blocker_count,
  (
    select count(*)::integer from machine_states
    where is_tulsa_cotton_candy
      and not ready_to_refund
      and not ready_to_activate
      and not approved_exception
      and activation_prerequisites_ready
  ) as tulsa_unexplained_count,
  (select count(*)::integer from case_states) as nonterminal_confirmed_case_count,
  (select count(*)::integer from case_states where ready) as confirmed_case_ready_count,
  (
    select count(*)::integer from case_states
    where not ready and block_reason is not null
  ) as confirmed_case_blocked_count,
  (
    select count(*)::integer from case_states
    where not ready and block_reason is null
  ) as confirmed_case_unknown_count;
`.trim();

export function parseArgs(argv) {
  const args = { projectRef: '', confirmProjectRef: '', allowNotReady: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === '--help' || arg === '-h') args.help = true;
    else if (arg === '--project-ref' && next) {
      args.projectRef = next.trim();
      index += 1;
    } else if (arg === '--confirm-project-ref' && next) {
      args.confirmProjectRef = next.trim();
      index += 1;
    } else if (arg === '--allow-not-ready') args.allowNotReady = true;
    else throw new Error(`Unknown or incomplete argument: ${arg}`);
  }
  return args;
}

export function validateAggregateRow(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) {
    throw new Error('Machine readiness audit did not return one aggregate object.');
  }
  if (JSON.stringify(Object.keys(row).sort()) !== JSON.stringify([...RESULT_KEYS].sort())) {
    throw new Error('Machine readiness audit returned unexpected columns; refusing to print them.');
  }
  if (row.read_only !== true) throw new Error('Machine readiness audit did not affirm read-only mode.');
  for (const key of RESULT_KEYS.filter((key) => key !== 'read_only')) {
    if (!Number.isInteger(row[key]) || row[key] < 0) {
      throw new Error(`Machine readiness aggregate ${key} is invalid.`);
    }
  }
  return row;
}

export function determineReadiness(row) {
  const accountedMachineCount = row.ready_to_refund_count + row.ready_to_activate_count
    + row.setup_needed_count + row.approved_exception_count;
  const tulsaReviewed = row.tulsa_machine_count === 1
    && row.tulsa_unexplained_count === 0
    && row.tulsa_ready_to_refund_count + row.tulsa_reviewed_blocker_count === 1;
  const casesAccounted = row.nonterminal_confirmed_case_count
    === row.confirmed_case_ready_count + row.confirmed_case_blocked_count;
  const ready = accountedMachineCount === row.active_customer_machine_count
    && row.ready_to_activate_count === 0
    && row.unexplained_disabled_count === 0
    && row.over_standard_cap_count === 0
    && tulsaReviewed
    && casesAccounted
    && row.confirmed_case_unknown_count === 0;
  return { ready, accountedMachineCount, tulsaReviewed, casesAccounted };
}

function printHelp() {
  console.log(`Refund machine and confirmed-case readiness audit (aggregate-only)

Postdeploy owner audit:
  npm run refunds:machine-readiness-audit -- --project-ref <ref> --confirm-project-ref <ref>

Use --allow-not-ready for a read-only baseline before reviewed activation. The command
prints counts only and never prints machine IDs, provider IDs, case IDs, or customer data.`);
}

function runLinkedQuery(query) {
  const result = spawnSync(
    'supabase',
    ['db', 'query', '--linked', '--output', 'json', '--agent=yes', '--', query],
    { cwd: repoRoot, encoding: 'utf8', windowsHide: true, maxBuffer: 10 * 1024 * 1024 }
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = String(result.stderr || '').trim();
    throw new Error(detail ? `Linked read-only audit failed: ${detail}` : 'Linked read-only audit failed.');
  }
  let payload;
  try {
    payload = JSON.parse(result.stdout);
  } catch {
    throw new Error('Linked read-only audit returned invalid JSON.');
  }
  if (!Array.isArray(payload.rows) || payload.rows.length !== 1) {
    throw new Error('Linked read-only audit must return exactly one aggregate row.');
  }
  return validateAggregateRow(payload.rows[0]);
}

function printAggregate(row, projectRef) {
  const result = determineReadiness(row);
  console.log('Refund machine and confirmed-case readiness audit');
  console.log(`Project ref: ${projectRef}`);
  console.log('Read-only query: yes');
  console.log(`Active customer-facing machines: ${row.active_customer_machine_count}`);
  console.log(`- Ready to refund: ${row.ready_to_refund_count}`);
  console.log(`- Ready to activate: ${row.ready_to_activate_count}`);
  console.log(`- Setup needed: ${row.setup_needed_count}`);
  console.log(`- Approved exceptions: ${row.approved_exception_count}`);
  console.log(`- Unexplained disabled: ${row.unexplained_disabled_count}`);
  console.log(`- Above standard $50 cap: ${row.over_standard_cap_count}`);
  console.log(`Tulsa machine count: ${row.tulsa_machine_count}`);
  console.log(`Tulsa ready: ${row.tulsa_ready_to_refund_count}`);
  console.log(`Tulsa reviewed blocker: ${row.tulsa_reviewed_blocker_count}`);
  console.log(`Tulsa unexplained: ${row.tulsa_unexplained_count}`);
  console.log(`Nonterminal confirmed cases: ${row.nonterminal_confirmed_case_count}`);
  console.log(`- Ready: ${row.confirmed_case_ready_count}`);
  console.log(`- Exact blocker: ${row.confirmed_case_blocked_count}`);
  console.log(`- Unknown next action: ${row.confirmed_case_unknown_count}`);
  console.log(`Overall: ${result.ready ? 'READY FOR OWNER UAT DECISION' : 'HOLD'}`);
  console.log('No machine, provider, case, manager, or customer identifiers were printed or written.');
  return result;
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return printHelp();
  if (!args.projectRef || !args.confirmProjectRef) {
    throw new Error('--project-ref and --confirm-project-ref are both required.');
  }
  if (args.projectRef !== args.confirmProjectRef) {
    throw new Error('--confirm-project-ref must exactly match --project-ref.');
  }
  if (!fs.existsSync(linkedProjectRefPath)) throw new Error('No linked Supabase project was found.');
  const linkedProjectRef = fs.readFileSync(linkedProjectRefPath, 'utf8').trim();
  if (linkedProjectRef !== args.projectRef) {
    throw new Error(`Linked project ref does not match --project-ref ${args.projectRef}.`);
  }
  const row = runLinkedQuery(MACHINE_READINESS_QUERY);
  const readiness = printAggregate(row, args.projectRef);
  if (!readiness.ready && !args.allowNotReady) process.exitCode = 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  run().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
