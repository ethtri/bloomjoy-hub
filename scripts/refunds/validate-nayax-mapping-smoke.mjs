#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  NAYAX_MAPPING_QUERY,
  determineReadiness,
  parseArgs,
  validateAggregateRow,
} from './nayax-mapping-smoke.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const smokeSource = fs.readFileSync(path.join(__dirname, 'nayax-mapping-smoke.mjs'), 'utf8');

const readyRow = {
  read_only: true,
  active_refund_machine_count: 6,
  configured_nayax_mapping_count: 6,
  missing_nayax_mapping_count: 0,
  missing_nayax_account_count: 0,
  duplicate_nayax_mapping_count: 0,
  distinct_nayax_account_count: 1,
  machine_with_active_manager_count: 6,
  machine_with_timezone_count: 6,
  shadow_ready_mapping_count: 6,
  live_refund_enabled_machine_count: 0,
};

assert.deepEqual(parseArgs(['--project-ref', 'abc', '--confirm-project-ref', 'abc']), {
  projectRef: 'abc',
  confirmProjectRef: 'abc',
  allowNotReady: false,
  help: false,
});
assert.equal(determineReadiness(validateAggregateRow(readyRow)).ready, true);

for (const [field, value] of [
  ['active_refund_machine_count', 2],
  ['configured_nayax_mapping_count', 5],
  ['missing_nayax_mapping_count', 1],
  ['missing_nayax_account_count', 1],
  ['duplicate_nayax_mapping_count', 1],
  ['machine_with_active_manager_count', 5],
  ['machine_with_timezone_count', 5],
  ['shadow_ready_mapping_count', 5],
  ['live_refund_enabled_machine_count', 1],
]) {
  const result = determineReadiness({ ...readyRow, [field]: value });
  assert.equal(result.ready, false, `${field} must fail readiness`);
}

assert.throws(
  () => validateAggregateRow({ ...readyRow, reporting_machine_id: 'must-not-escape' }),
  /unexpected columns/
);
assert.throws(
  () => validateAggregateRow({ ...readyRow, read_only: false }),
  /read-only mode/
);
assert.throws(
  () => validateAggregateRow({ ...readyRow, missing_nayax_mapping_count: -1 }),
  /is invalid/
);

const normalizedQuery = NAYAX_MAPPING_QUERY
  .replace(/--.*$/gm, '')
  .replace(/\s+/g, ' ')
  .trim()
  .toLowerCase();
for (const forbidden of [' insert ', ' update ', ' delete ', ' merge ', ' truncate ', ' alter ', ' drop ', ' create ']) {
  assert.equal(normalizedQuery.includes(forbidden), false, `query must not contain ${forbidden.trim()}`);
}
assert.match(normalizedQuery, /^with /);
assert.match(normalizedQuery, /select true as read_only/);

for (const required of [
  '--project-ref and --confirm-project-ref are both required',
  '--confirm-project-ref must exactly match --project-ref',
  'Linked project ref does not match',
  'returned unexpected columns; refusing to print them',
  'No identifiers or production records were printed or written',
]) {
  assert.ok(smokeSource.includes(required), `missing fail-closed guard: ${required}`);
}

for (const forbiddenOutput of [
  'reporting_machine_id:',
  'nayax_machine_id:',
  'location_name:',
  'manager_email:',
  'case_id:',
  'card_last_four:',
]) {
  assert.equal(smokeSource.includes(forbiddenOutput), false, `unsafe output label found: ${forbiddenOutput}`);
}

console.log('Refund Nayax mapping smoke validation passed.');
console.log('- exact linked-project confirmation');
console.log('- SELECT-only aggregate query and strict result allowlist');
console.log('- mapping, manager, timezone, duplicate, and live-execution gates');
console.log('- no identifier or production-record output');
