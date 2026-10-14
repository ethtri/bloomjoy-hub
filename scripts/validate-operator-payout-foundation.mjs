#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const migrationName = '202605200001_operator_payout_foundation.sql';
const migrationPath = path.join(repoRoot, 'supabase', 'migrations', migrationName);
const helperPath = path.join(repoRoot, 'src', 'lib', 'operatorPayouts.ts');
const decisionsPath = path.join(repoRoot, 'Docs', 'DECISIONS.md');

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

const expect = (text, snippet, label) => {
  if (!compact(text).includes(compact(snippet))) {
    fail(`${label}: missing ${snippet}`);
  }
};

const assertMigration = () => {
  if (!fs.existsSync(migrationPath)) {
    fail(`Missing migration ${migrationName}.`);
  }

  const sql = readText(migrationPath);

  for (const tableName of [
    'payout_policies',
    'operator_payout_profiles',
    'operator_machine_assignments',
    'payout_periods',
    'time_entries',
    'compensation_rules',
    'payout_runs',
    'payout_run_items',
    'payout_run_item_machines',
    'payout_adjustments',
    'pay_statements',
    'payroll_provider_sync_records',
  ]) {
    expect(sql, `create table if not exists public.${tableName}`, migrationName);
    expect(sql, `alter table public.${tableName} enable row level security`, migrationName);
  }

  for (const snippet of [
    "default_worker_type text not null default 'contractor_1099'",
    "default_pay_statement_label text not null default 'Pay Statement'",
    "rounding_rule text not null default 'round_up_60_minutes'",
    "review_model text not null default 'final_review_only'",
    'raw_duration_minutes integer not null default 0',
    'rounded_paid_minutes integer not null default 0',
    'hourly_rate_cents integer',
    'commission_basis_points integer',
    "storage_bucket text not null default 'operator-pay-statements'",
    'create or replace function public.round_operator_payout_minutes',
    'create or replace function public.can_manage_operator_payout_machine',
    'create or replace function public.can_submit_operator_time_entry',
    'create or replace function public.admin_upsert_operator_payout_profile',
    'create or replace function public.admin_set_operator_machine_assignments',
    'create or replace function public.get_my_operator_payout_context',
    "insert into public.admin_audit_log",
    "tax_compliance_engine', false",
    'revoke insert, update, delete on public.compensation_rules from anon, authenticated',
    'revoke insert, update, delete on public.pay_statements from anon, authenticated',
    'create policy "operator_pay_statement_objects_read_accessible"',
    'select pg_notify',
  ]) {
    expect(sql, snippet, migrationName);
  }

  if (compact(sql).includes('direct_deposit') || compact(sql).includes('tax_withholding_cents')) {
    fail(`${migrationName}: foundation must not introduce direct deposit or tax withholding fields.`);
  }
};

const assertHelper = () => {
  if (!fs.existsSync(helperPath)) {
    fail('Missing operator payout TypeScript helper.');
  }

  const source = readText(helperPath);

  for (const snippet of [
    'OperatorWorkerType',
    'calculateOperatorPaidShifts',
    'fetchMyOperatorTimekeepingContext',
    'setupTimekeepingTechnicianAdmin',
    'upsertEffectiveOperatorMachineAssignmentAdmin',
    "round_up_60_minutes",
    'admin_setup_timekeeping_for_payer_with_contact',
    'admin_upsert_operator_machine_assignment',
  ]) {
    if (!source.includes(snippet)) {
      fail(`operatorPayouts.ts missing ${snippet}`);
    }
  }
};

const assertDocs = () => {
  if (!fs.existsSync(decisionsPath)) {
    fail('Missing Docs/DECISIONS.md.');
  }

  const decisions = readText(decisionsPath);

  for (const snippet of [
    'Timekeeping V1 is shift entry and machine-manager review',
    'does not calculate withholding',
    'Pay Statement',
    'Removing individual approvals keeps routine timekeeping simple',
  ]) {
    if (!decisions.includes(snippet)) {
      fail(`Docs/DECISIONS.md missing ${snippet}`);
    }
  }
};

const main = () => {
  assertMigration();
  assertHelper();
  assertDocs();

  console.log(
    'Operator payout foundation static checks passed: schema, RLS, audit hooks, right-sized defaults, and typed helpers are present.'
  );
};

main();
