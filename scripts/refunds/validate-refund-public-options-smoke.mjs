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
const repoRoot = path.resolve(__dirname, '..', '..');
const wrapperSource = fs.readFileSync(path.join(__dirname, 'refund-public-options-smoke.mjs'), 'utf8');
const portfolioMigrationSource = fs.readFileSync(
  path.join(repoRoot, 'supabase', 'migrations', '202608020001_refund_portfolio_wide_intake.sql'),
  'utf8'
);
const intakeFunctionSource = fs.readFileSync(
  path.join(repoRoot, 'supabase', 'functions', 'refund-case-intake', 'index.ts'),
  'utf8'
);
const publicOptionsFunctionSource = portfolioMigrationSource.slice(
  portfolioMigrationSource.indexOf('create or replace function public.public_refund_machine_options()'),
  portfolioMigrationSource.indexOf(
    'create or replace function public.admin_set_reporting_machine_refund_intake_config('
  )
);

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
  active_portfolio_machine_count: 29,
  public_option_count: 29,
  missing_portfolio_option_count: 0,
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
  { missing_portfolio_option_count: 1, public_option_count: 28 },
  { active_portfolio_machine_count: 30 },
  { unsafe_internal_label_count: 1 },
  { atlanta_option_count: 0 },
  { dc_option_count: 0 },
  { seattle_option_count: 0 },
  { duplicate_machine_row_count: 1 },
  { duplicate_display_row_count: 1 },
  { active_portfolio_machine_count: 0, public_option_count: 0 },
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

assert.match(PUBLIC_OPTIONS_QUERY, /^with\s+eligible_portfolio\s+as/i);
assert.doesNotMatch(PUBLIC_OPTIONS_QUERY, /refund_intake_enabled/i);
assert.match(publicOptionsFunctionSource, /machine\.machine_type in \('commercial', 'mini'\)/);
assert.match(publicOptionsFunctionSource, /location\.status = 'active'/);
assert.match(publicOptionsFunctionSource, /refund_public_display_label/);
assert.doesNotMatch(publicOptionsFunctionSource, /refund_intake_enabled/i);
assert.doesNotMatch(intakeFunctionSource, /\.eq\("refund_intake_enabled", true\)/);
assert.equal(
  (intakeFunctionSource.match(/\.in\("machine_type", \["commercial", "mini"\]\)/g) ?? []).length,
  2,
  'QR claim and direct intake must share the supported portfolio machine types'
);
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
console.log('- full active-portfolio coverage gate');
console.log('- internal-label and duplicate fail-closed gates');
console.log('- Atlanta/DC/Seattle presence checks');
