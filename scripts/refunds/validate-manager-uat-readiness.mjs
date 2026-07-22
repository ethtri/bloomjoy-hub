#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildQuery,
  determineReadiness,
  parseArgs,
  validateAggregateRow,
} from './manager-uat-readiness.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const template = fs.readFileSync(path.join(__dirname, 'manager-uat-readiness.sql'), 'utf8');
const wrapperSource = fs.readFileSync(path.join(__dirname, 'manager-uat-readiness.mjs'), 'utf8');

const machineId = '11111111-1111-4111-8111-111111111111';
const secondMachineId = '22222222-2222-4222-8222-222222222222';

const emptyPilotQuery = buildQuery(template, []);
assert.match(emptyPilotQuery, /select null::uuid as machine_id where false/);
assert.doesNotMatch(emptyPilotQuery, /__PILOT_MACHINE_ROWS__/);

const selectedPilotQuery = buildQuery(template, [machineId, secondMachineId]);
assert.match(selectedPilotQuery, new RegExp(`'${machineId}'::uuid`));
assert.match(selectedPilotQuery, new RegExp(`'${secondMachineId}'::uuid`));
assert.doesNotMatch(selectedPilotQuery, /__PILOT_MACHINE_ROWS__/);

assert.deepEqual(
  parseArgs([
    '--project-ref',
    'exampleprojectref',
    '--confirm-project-ref',
    'exampleprojectref',
    '--pilot-machine-id',
    machineId,
    '--pilot-machine-id',
    machineId,
    '--allow-not-ready',
  ]),
  {
    projectRef: 'exampleprojectref',
    confirmProjectRef: 'exampleprojectref',
    pilotMachineIds: [machineId],
    allowNotReady: true,
    help: false,
  }
);
assert.throws(() => parseArgs(['--pilot-machine-id', 'not-a-uuid']), /must be UUIDs/);
assert.throws(() => parseArgs(['--unknown']), /Unknown or incomplete argument/);

const aggregateRow = {
  read_only: true,
  selected_pilot_machine_count: 0,
  active_manager_assignment_count: 12,
  active_manager_identity_count: 4,
  manager_only_identity_count: 1,
  manager_only_with_shadow_ready_assignment_count: 1,
  exact_pilot_eligible_identity_count: null,
  super_admin_overlap_count: 0,
  scoped_admin_overlap_count: 1,
  corporate_partner_overlap_count: 1,
  customer_account_membership_overlap_count: 1,
  reporting_entitlement_overlap_count: 0,
  plus_access_overlap_count: 0,
  training_access_overlap_count: 0,
  technician_access_overlap_count: 0,
  operator_profile_overlap_count: 0,
};

assert.equal(validateAggregateRow(aggregateRow), aggregateRow);
assert.deepEqual(determineReadiness(aggregateRow), {
  ready: true,
  label: 'CLEAN CANDIDATE EXISTS; PILOT COHORT SELECTION STILL REQUIRED',
});

assert.deepEqual(
  determineReadiness({
    ...aggregateRow,
    selected_pilot_machine_count: 1,
    exact_pilot_eligible_identity_count: 1,
  }),
  {
    ready: true,
    label: 'READY FOR OWNER-SELECTION AND LIVE BOUNDARY UAT',
  }
);
assert.equal(
  determineReadiness({
    ...aggregateRow,
    selected_pilot_machine_count: 1,
    exact_pilot_eligible_identity_count: 0,
  }).ready,
  false
);
assert.equal(
  determineReadiness({
    ...aggregateRow,
    manager_only_with_shadow_ready_assignment_count: 0,
  }).ready,
  false
);

assert.throws(
  () => validateAggregateRow({ ...aggregateRow, manager_email: 'must-not-print@example.test' }),
  /unexpected columns/
);
assert.throws(
  () => validateAggregateRow({ ...aggregateRow, read_only: false }),
  /did not affirm read-only/
);
assert.throws(
  () => validateAggregateRow({ ...aggregateRow, active_manager_identity_count: -1 }),
  /is invalid/
);

for (const forbidden of [
  'manager_email`)',
  'manager_user_id`)',
  'reporting_machine_id`)',
  'console.log(JSON.stringify(row',
  'writeFileSync',
]) {
  assert.equal(wrapperSource.includes(forbidden), false, `wrapper must not expose ${forbidden}`);
}

assert.match(template, /^\s*--[\s\S]*\bwith\b/i);
assert.doesNotMatch(
  template,
  /\b(insert|update|delete|merge|truncate|alter|create|drop|grant|revoke|call|copy)\b(?![^\n]*\bcounts?\b)/i
);
assert.doesNotMatch(template, /select\s+[^;]*(manager_email|manager_user_id|reporting_machine_id)\s+from\s+assessed_identities/i);

console.log('Manager-only UAT readiness validator passed.');
console.log('- exact project confirmation and UUID-only pilot scope');
console.log('- aggregate result allowlist and no local output');
console.log('- manager-only, shadow-ready, and exact-pilot readiness gates');
console.log('- reviewed SELECT-only SQL template');
