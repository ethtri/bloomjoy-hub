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
const statusPath = path.join(repoRoot, 'Docs', 'CURRENT_STATUS.md');

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
    "default_pay_statement_label text not null default 'Pay Stub'",
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
    'roundOperatorPaidMinutes',
    'fetchMyOperatorPayoutContext',
    'upsertOperatorPayoutProfileAdmin',
    'setOperatorMachineAssignmentsAdmin',
    "round_up_60_minutes",
    "admin_upsert_operator_payout_profile",
    "admin_set_operator_machine_assignments",
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
  if (!fs.existsSync(statusPath)) {
    fail('Missing Docs/CURRENT_STATUS.md.');
  }

  const decisions = readText(decisionsPath);
  const status = readText(statusPath);

  for (const snippet of [
    'Right-sized operator payouts and payroll automation',
    'does not calculate withholding',
    'Pay Statement',
  ]) {
    if (!decisions.includes(snippet)) {
      fail(`Docs/DECISIONS.md missing ${snippet}`);
    }
  }

  if (!status.includes('Operator payouts foundation sprint')) {
    fail('Docs/CURRENT_STATUS.md missing operator payouts sprint status.');
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
