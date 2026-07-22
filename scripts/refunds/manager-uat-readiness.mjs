#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');
const linkedProjectRefPath = path.join(repoRoot, 'supabase', '.temp', 'project-ref');
const queryTemplatePath = path.join(__dirname, 'manager-uat-readiness.sql');
const PILOT_MARKER = '/*__PILOT_MACHINE_ROWS__*/';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const RESULT_KEYS = [
  'read_only',
  'selected_pilot_machine_count',
  'active_manager_assignment_count',
  'active_manager_identity_count',
  'manager_only_identity_count',
  'manager_only_with_shadow_ready_assignment_count',
  'exact_pilot_eligible_identity_count',
  'super_admin_overlap_count',
  'scoped_admin_overlap_count',
  'corporate_partner_overlap_count',
  'customer_account_membership_overlap_count',
  'reporting_entitlement_overlap_count',
  'plus_access_overlap_count',
  'training_access_overlap_count',
  'technician_access_overlap_count',
  'operator_profile_overlap_count',
];

export function parseArgs(argv) {
  const args = {
    projectRef: '',
    confirmProjectRef: '',
    pilotMachineIds: [],
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

    if (arg === '--pilot-machine-id' && next) {
      args.pilotMachineIds.push(next.trim());
      index += 1;
      continue;
    }

    if (arg === '--allow-not-ready') {
      args.allowNotReady = true;
      continue;
    }

    throw new Error(`Unknown or incomplete argument: ${arg}`);
  }

  args.pilotMachineIds = [...new Set(args.pilotMachineIds)];
  for (const machineId of args.pilotMachineIds) {
    if (!UUID_PATTERN.test(machineId)) {
      throw new Error('--pilot-machine-id values must be UUIDs.');
    }
  }

  return args;
}

function printHelp() {
  console.log(`Clean Machine Manager UAT account readiness (aggregate-only)

Discover whether any current manager-only account can be prepared for shadow UAT:
  npm run refunds:manager-uat-readiness -- --project-ref <ref> --confirm-project-ref <ref>

Gate an owner-selected pilot cohort (repeat --pilot-machine-id for each selected machine):
  npm run refunds:manager-uat-readiness -- --project-ref <ref> --confirm-project-ref <ref> --pilot-machine-id <uuid>

The query is read-only and prints counts only. It never prints or writes names, emails,
user IDs, machine IDs, or case data. --allow-not-ready keeps discovery runs at exit 0.`);
}

export function buildQuery(template, pilotMachineIds) {
  const markerCount = template.split(PILOT_MARKER).length - 1;
  if (markerCount !== 1) {
    throw new Error('Manager UAT query template must contain exactly one pilot-machine marker.');
  }

  const rows = pilotMachineIds.length
    ? `values ${pilotMachineIds.map((machineId) => `('${machineId}'::uuid)`).join(', ')}`
    : 'select null::uuid as machine_id where false';

  return template.replace(PILOT_MARKER, rows);
}

export function validateAggregateRow(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) {
    throw new Error('Manager UAT query did not return one aggregate object.');
  }

  const actualKeys = Object.keys(row).sort();
  const expectedKeys = [...RESULT_KEYS].sort();
  if (JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys)) {
    throw new Error('Manager UAT query returned unexpected columns; refusing to print them.');
  }

  if (row.read_only !== true) {
    throw new Error('Manager UAT query did not affirm read-only mode.');
  }

  for (const key of RESULT_KEYS.filter((key) => key !== 'read_only')) {
    const value = row[key];
    if (value !== null && (!Number.isInteger(value) || value < 0)) {
      throw new Error(`Manager UAT aggregate ${key} is invalid.`);
    }
  }

  return row;
}

export function determineReadiness(row) {
  if (row.selected_pilot_machine_count > 0) {
    return {
      ready: row.exact_pilot_eligible_identity_count > 0,
      label:
        row.exact_pilot_eligible_identity_count > 0
          ? 'READY FOR OWNER-SELECTION AND LIVE BOUNDARY UAT'
          : 'OWNER ACCOUNT/ASSIGNMENT SETUP REQUIRED',
    };
  }

  return {
    ready: row.manager_only_with_shadow_ready_assignment_count > 0,
    label:
      row.manager_only_with_shadow_ready_assignment_count > 0
        ? 'CLEAN CANDIDATE EXISTS; PILOT COHORT SELECTION STILL REQUIRED'
        : 'OWNER ACCOUNT/ASSIGNMENT SETUP REQUIRED',
  };
}

function printAggregate(row, projectRef) {
  const readiness = determineReadiness(row);
  console.log('Clean Machine Manager UAT readiness audit');
  console.log(`Project ref: ${projectRef}`);
  console.log('Read-only query: yes');
  console.log(`Selected pilot machines: ${row.selected_pilot_machine_count}`);
  console.log(`Active Machine Manager assignments: ${row.active_manager_assignment_count}`);
  console.log(`Active Machine Manager identities: ${row.active_manager_identity_count}`);
  console.log(`Manager-only identities: ${row.manager_only_identity_count}`);
  console.log(
    `Manager-only identities with a shadow-ready assignment: ${row.manager_only_with_shadow_ready_assignment_count}`
  );
  if (row.exact_pilot_eligible_identity_count !== null) {
    console.log(`Exact-pilot eligible identities: ${row.exact_pilot_eligible_identity_count}`);
  }
  console.log('Overlapping access counts (categories may overlap):');
  console.log(`- Super Admin: ${row.super_admin_overlap_count}`);
  console.log(`- Scoped Admin: ${row.scoped_admin_overlap_count}`);
  console.log(`- Corporate Partner: ${row.corporate_partner_overlap_count}`);
  console.log(`- Customer account membership: ${row.customer_account_membership_overlap_count}`);
  console.log(`- Reporting entitlement: ${row.reporting_entitlement_overlap_count}`);
  console.log(`- Plus access: ${row.plus_access_overlap_count}`);
  console.log(`- Training access: ${row.training_access_overlap_count}`);
  console.log(`- Technician access: ${row.technician_access_overlap_count}`);
  console.log(`- Operator profile: ${row.operator_profile_overlap_count}`);
  console.log(`Overall: ${readiness.label}`);
  console.log('No identities or machine identifiers were printed or written.');
  return readiness;
}

function runLinkedQuery(query) {
  const result = spawnSync(
    'supabase',
    ['db', 'query', '--linked', '--output', 'json', '--agent=yes', '--', query],
    {
      cwd: repoRoot,
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: 10 * 1024 * 1024,
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

  const template = fs.readFileSync(queryTemplatePath, 'utf8');
  const query = buildQuery(template, args.pilotMachineIds);
  const row = runLinkedQuery(query);
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
