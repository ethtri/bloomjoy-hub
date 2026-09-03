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
const portfolioCorrectionSource = fs.readFileSync(
  path.join(repoRoot, 'supabase', 'migrations', '20260822190000_refund_portfolio_intake_inventory_correction.sql'),
  'utf8'
);
const intakeFunctionSource = fs.readFileSync(
  path.join(repoRoot, 'supabase', 'functions', 'refund-case-intake', 'index.ts'),
  'utf8'
);
const locationSelectionSource = fs.readFileSync(
  path.join(repoRoot, 'supabase', 'migrations', '20260823110000_refund_public_location_selections.sql'),
  'utf8'
);
const placeholderSelectionRepairSource = fs.readFileSync(
  path.join(repoRoot, 'supabase', 'migrations', '20260823203839_repair_refund_placeholder_location_selections.sql'),
  'utf8'
);
const locationSelectionTestSource = fs.readFileSync(
  path.join(repoRoot, 'supabase', 'tests', 'refund_public_location_selections.sql'),
  'utf8'
);
const publicOptionsFunctionSource = portfolioCorrectionSource.slice(
  portfolioCorrectionSource.indexOf('create or replace function public.public_refund_machine_options()'),
  portfolioCorrectionSource.indexOf('create or replace function public.service_refund_machine_is_public(')
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
  active_inventory_machine_count: 39,
  published_inventory_count: 35,
  needs_setup_inventory_count: 0,
  excluded_inventory_count: 4,
  unaccounted_active_count: 0,
  public_option_count: 35,
  public_selection_count: 34,
  selection_covered_machine_count: 35,
  published_missing_public_option_count: 0,
  stale_published_count: 0,
  unsafe_internal_label_count: 0,
  snapcase_category_count: 3,
  duplicate_machine_row_count: 0,
  duplicate_display_row_count: 0,
};

assert.equal(validateAggregateRow(readyRow), readyRow);
assert.equal(determineReadiness(readyRow).ready, true);
assert.equal(determineReadiness({
  ...readyRow,
  public_option_count: 39,
  public_selection_count: 38,
  selection_covered_machine_count: 39,
}).ready, true,
  'customer intake may include setup-pending portfolio machines beyond the automatic-payment cohort');

for (const patch of [
  { published_missing_public_option_count: 1, public_option_count: 34 },
  { public_selection_count: 0 },
  { selection_covered_machine_count: 34 },
  { stale_published_count: 1 },
  { active_inventory_machine_count: 40 },
  { needs_setup_inventory_count: 1, published_inventory_count: 34 },
  { unaccounted_active_count: 1 },
  { unsafe_internal_label_count: 1 },
  { snapcase_category_count: 2 },
  { duplicate_machine_row_count: 1 },
  { duplicate_display_row_count: 1 },
  { active_inventory_machine_count: 0, published_inventory_count: 0, excluded_inventory_count: 0, public_option_count: 0 },
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

assert.match(PUBLIC_OPTIONS_QUERY, /^with\s+active_inventory\s+as/i);
assert.match(PUBLIC_OPTIONS_QUERY, /refund_nayax_machine_inventory/);
assert.match(PUBLIC_OPTIONS_QUERY, /public_refund_selections/);
assert.match(PUBLIC_OPTIONS_QUERY, /service_resolve_refund_public_selection/);
assert.match(PUBLIC_OPTIONS_QUERY, /selection_covered_machine_count/);
assert.match(PUBLIC_OPTIONS_QUERY, /needs_setup_inventory_count/);
assert.match(PUBLIC_OPTIONS_QUERY, /snapcase_category_count/);
assert.match(publicOptionsFunctionSource, /machine\.machine_type in \('commercial', 'mini'\)/);
assert.match(publicOptionsFunctionSource, /location\.status = 'active'/);
assert.match(publicOptionsFunctionSource, /refund_public_display_label/);
assert.doesNotMatch(publicOptionsFunctionSource, /refund_intake_enabled/);
assert.match(publicOptionsFunctionSource, /inventory\.refund_category = 'snapcase'/);
assert.match(publicOptionsFunctionSource, /inventory\.reconciliation_state <> 'excluded'/);
assert.doesNotMatch(intakeFunctionSource, /\.eq\("refund_intake_enabled", true\)/);
assert.match(locationSelectionSource, /San Francisco Premium Outlets — Cotton candy/);
assert.match(
  locationSelectionSource,
  /public_refund_selections\(\)\s*returns table \(\s*selection_key text,\s*display_label text,\s*selection_kind text,\s*location_timezone text\s*\)/s
);
assert.match(locationSelectionSource, /when 'cotton_candy' then 'Cotton candy'/);
assert.match(locationSelectionSource, /when 'snapcase' then 'Phone cases \(SnapCase\)'/);
assert.match(locationSelectionTestSource, /where display_label = 'Capital City Mall'/);
assert.match(locationSelectionTestSource, /South Hills Village — Cotton candy/);
assert.match(locationSelectionTestSource, /South Hills Village — Phone cases \(SnapCase\)/);
assert.match(placeholderSelectionRepairSource, /partition by location_id, btrim\(location_name\)/);
assert.match(
  placeholderSelectionRepairSource,
  /partition by location_id, btrim\(location_name\), refund_category/
);
assert.doesNotMatch(placeholderSelectionRepairSource, /partition by location_id\)/);
assert.match(locationSelectionTestSource, /Bubble Planet - Atlanta/);
assert.match(locationSelectionTestSource, /Bubble Planet DC/);
assert.match(locationSelectionTestSource, /Bubble Planet Seattle/);
assert.match(locationSelectionTestSource, /Carolina Place/);
assert.match(locationSelectionTestSource, /Columbiana Centre/);
assert.match(locationSelectionSource, /refund_livermore_selection_machine_ids\(\)/);
assert.match(locationSelectionSource, /cardinality\(intake_selection_machine_ids\) = 2/);
assert.equal((intakeFunctionSource.match(/service_refund_machine_is_public/g) ?? []).length, 2,
  'QR claim and direct form intake must share the explicit inventory eligibility RPC');
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
console.log('- every active Nayax machine is published, setup work, or explicitly excluded');
console.log('- no setup or stale-published work remains at launch');
console.log('- customer intake stays independent of automatic Nayax payment readiness');
console.log('- opaque customer selections cover every public machine exactly once');
console.log('- customer-safe placeholder labels remain separate exact-machine choices');
console.log('- Livermore is one reviewed two-machine selection; mixed locations stay category-specific');
console.log('- explicit Snapcase category and duplicate fail-closed gates');
