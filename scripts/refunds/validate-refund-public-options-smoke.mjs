#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PUBLIC_OPTIONS_QUERY,
  determineReadiness,
  parseArgs,
  validateAggregateRow,
} from './refund-public-options-smoke.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const wrapperSource = fs.readFileSync(path.join(__dirname, 'refund-public-options-smoke.mjs'), 'utf8');

assert.deepEqual(
  parseArgs([
    '--project-ref',
    'exampleprojectref',
    '--confirm-project-ref',
    'exampleprojectref',
    '--allow-not-ready',
  ]),
  {
    projectRef: 'exampleprojectref',
    confirmProjectRef: 'exampleprojectref',
    allowNotReady: true,
    help: false,
  }
);
assert.throws(() => parseArgs(['--unknown']), /Unknown or incomplete argument/);

const readyRow = {
  read_only: true,
  public_option_count: 6,
  unsafe_internal_label_count: 0,
  atlanta_option_count: 1,
  dc_option_count: 1,
  seattle_option_count: 1,
  duplicate_machine_row_count: 0,
  duplicate_display_row_count: 0,
};

assert.equal(validateAggregateRow(readyRow), readyRow);
assert.equal(determineReadiness(readyRow).ready, true);

for (const patch of [
  { unsafe_internal_label_count: 1 },
  { atlanta_option_count: 0 },
  { dc_option_count: 0 },
  { seattle_option_count: 0 },
  { duplicate_machine_row_count: 1 },
  { duplicate_display_row_count: 1 },
  { public_option_count: 2 },
]) {
  assert.equal(determineReadiness({ ...readyRow, ...patch }).ready, false);
}

assert.throws(
  () => validateAggregateRow({ ...readyRow, machine_id: 'must-not-print' }),
  /unexpected columns/
);
assert.throws(
  () => validateAggregateRow({ ...readyRow, read_only: false }),
  /did not affirm read-only/
);
assert.throws(
  () => validateAggregateRow({ ...readyRow, public_option_count: -1 }),
  /is invalid/
);

assert.match(PUBLIC_OPTIONS_QUERY, /^with\s+options\s+as/i);
assert.match(PUBLIC_OPTIONS_QUERY, /\(dc\|washington\)/);
assert.doesNotMatch(
  PUBLIC_OPTIONS_QUERY,
  /\b(insert|update|delete|merge|truncate|alter|create|drop|grant|revoke|call|copy)\b/i
);
assert.doesNotMatch(PUBLIC_OPTIONS_QUERY, /select\s+[^;]*(machine_id|location_id)\s+from\s+options/i);
assert.equal(wrapperSource.includes('writeFileSync'), false);
assert.equal(wrapperSource.includes('console.log(row'), false);

console.log('Refund public-options smoke validator passed.');
console.log('- exact linked-project confirmation');
console.log('- aggregate-only result allowlist');
console.log('- internal-label and duplicate fail-closed gates');
console.log('- Atlanta/DC/Seattle presence checks');
