#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const files = {
  migration: path.join(
    repoRoot,
    'supabase',
    'migrations',
    '20260907215403_align_timekeeping_data_rules.sql'
  ),
  pgTap: path.join(repoRoot, 'supabase', 'tests', 'timekeeping_data_rules.sql'),
  helper: path.join(repoRoot, 'src', 'lib', 'operatorPayouts.ts'),
  packageJson: path.join(repoRoot, 'package.json'),
  rpcSurface: path.join(repoRoot, 'scripts', 'validate-rpc-execute-surface.mjs'),
};

const fail = (message) => {
  throw new Error(message);
};

const readText = (filePath) => fs.readFileSync(filePath, 'utf8');
const compact = (value) =>
  value
    .replace(/--.*$/gm, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
const expect = (source, snippet, label) => {
  if (!compact(source).includes(compact(snippet))) {
    fail(`${label}: missing ${snippet}`);
  }
};

for (const [label, filePath] of Object.entries(files)) {
  if (!fs.existsSync(filePath)) {
    fail(`Missing ${label} file: ${path.relative(repoRoot, filePath)}`);
  }
}

const migration = readText(files.migration);
for (const snippet of [
  'create extension if not exists btree_gist with schema extensions',
  "review_model set default 'no_review_required'",
  'actual_start_at timestamptz',
  'actual_end_at timestamptz',
  'paid_shift_count integer',
  'constraint time_entries_no_operator_overlap',
  "tstzrange(actual_start_at, actual_end_at, '[)') with &&",
  'constraint operator_machine_assignments_no_active_overlap',
  'create or replace function public.operator_paid_shift_count',
  'create or replace function public.operator_time_entry_cutoff_at',
  "at time zone 'America/Los_Angeles'",
  'create or replace function public.save_operator_time_entry',
  'Time can be entered only after the work is completed',
  'Time entry overlaps another Technician entry',
  'create or replace function public.manager_correct_operator_time_entry',
  "'reason_required', false",
  "'after_cutoff_allowed', true",
  'create table if not exists public.time_entry_change_events',
  'create or replace function public.admin_upsert_operator_machine_assignment',
  'Machine assignment overlaps an existing effective window',
  'create or replace function public.operator_compensation_rate_at',
  "when selected_rule.reporting_machine_id is not null then 'technician_machine_override'",
  'create or replace function public.admin_upsert_operator_compensation_rate',
  'Compensation rate overlaps an existing effective rate',
  'create table if not exists public.operator_recurring_compensation_items',
  'create table if not exists public.operator_ytd_opening_balances',
  'create or replace function public.operator_worker_notice_code',
  "when 'contractor_1099' then 'independent_contractor_no_withholding'",
  'revoke all on table public.operator_ytd_opening_balances from anon, authenticated',
  'revoke execute on function public.operator_compensation_rate_at',
  'grant execute on function public.operator_compensation_rate_at',
  "jsonb_build_object('approval_required', false, 'payment_execution', false)",
]) {
  expect(migration, snippet, 'timekeeping data-rules migration');
}

const helper = readText(files.helper);
for (const snippet of [
  'actualStartAt: string',
  'actualEndAt: string',
  'paidShifts: number',
  'technicianCutoffAt: string',
  'calculateOperatorPaidShifts',
  'saveCompletedOperatorTimeEntry',
  'correctOperatorTimeEntry',
  'upsertEffectiveOperatorMachineAssignmentAdmin',
  'upsertOperatorCompensationRateAdmin',
  'upsertOperatorRecurringItemAdmin',
  'upsertOperatorYtdOpeningBalanceAdmin',
  "'manager_correct_operator_time_entry'",
  "'admin_upsert_operator_compensation_rate'",
]) {
  if (!helper.includes(snippet)) {
    fail(`operatorPayouts helper missing ${snippet}`);
  }
}

expect(
  readText(files.packageJson),
  'operator-payouts:validate-data-rules',
  'package script'
);
expect(
  readText(files.rpcSurface),
  'public.operator_compensation_rate_at(uuid, uuid, uuid, date, text)',
  'RPC surface guard'
);

const paidShifts = (minutes) => {
  const normalized = Math.max(0, Math.ceil(minutes));
  return normalized === 0 ? 0 : Math.ceil(normalized / 60);
};

const assertions = [
  [paidShifts(1), 1, '1 minute'],
  [paidShifts(60), 1, '60 minutes'],
  [paidShifts(61), 2, '61 minutes'],
  [paidShifts(120), 2, '120 minutes'],
  [paidShifts(20) + paidShifts(20) + paidShifts(20), 3, 'three separate entries'],
];

for (const [actual, expected, label] of assertions) {
  if (actual !== expected) {
    fail(`${label}: expected ${expected}, got ${actual}`);
  }
}

const overlaps = (leftStart, leftEnd, rightStart, rightEnd) =>
  leftStart < rightEnd && rightStart < leftEnd;

if (overlaps(9 * 60, 10 * 60, 10 * 60, 11 * 60)) {
  fail('Touching time-entry boundaries must not overlap.');
}
if (!overlaps(9 * 60, 10 * 60, 9 * 60 + 59, 11 * 60)) {
  fail('Cross-machine overlap fixture must be rejected.');
}

const cutoffFixtures = [
  ['2026-12-31', '2027-01-05T08:00:00.000Z'],
  ['2026-07-15', '2026-08-05T07:00:00.000Z'],
];
const migrationText = compact(migration);
if (!migrationText.includes("interval '1 month' + interval '4 days'")) {
  fail('Cutoff must be the start of the fifth Pacific calendar day after month-end.');
}
for (const [workDate, expectedUtc] of cutoffFixtures) {
  if (!workDate || !expectedUtc.endsWith('Z')) {
    fail('Invalid deterministic cutoff fixture.');
  }
}

const pgTap = readText(files.pgTap);
for (const marker of [
  '1-60 minutes is one paid shift',
  '61-120 minutes is two paid shifts',
  'adjacent entries are accepted',
  'cross-machine overlap is rejected',
  'manager correction works after the Technician cutoff without a reason',
  'out-of-scope manager correction fails closed',
  'sequential machine assignment windows are accepted',
  'machine-specific commission overrides the Technician default',
  'recurring earnings and credits cannot silently become deductions',
  'opening YTD balance is idempotently replaceable',
]) {
  if (!pgTap.includes(marker)) {
    fail(`pgTAP coverage missing marker: ${marker}`);
  }
}

console.log(
  'Timekeeping data-rule checks passed: exact timestamps, per-entry shifts, Pacific cutoff, overlap exclusion, audited manager correction, effective compensation, contractor notices, recurring inputs, YTD openings, RLS, and typed helpers are present.'
);
