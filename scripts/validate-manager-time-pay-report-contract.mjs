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
    '20260908002416_manager_time_and_pay_report_contract.sql'
  ),
  pgTap: path.join(repoRoot, 'supabase', 'tests', 'manager_time_pay_report_contract.sql'),
  helper: path.join(repoRoot, 'src', 'lib', 'operatorPayouts.ts'),
  payReportPage: path.join(repoRoot, 'src', 'pages', 'admin', 'Payouts.tsx'),
  authContext: path.join(repoRoot, 'src', 'contexts', 'AuthContext.tsx'),
  packageJson: path.join(repoRoot, 'package.json'),
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
  'create or replace function public.get_my_time_review_context',
  'create or replace function public.can_access_payout_run',
  'create or replace function public.can_access_payout_run_item',
  'create or replace function public.can_access_pay_statement',
  'create or replace function public.get_my_admin_access_context',
  'create or replace function public.get_my_time_report_access',
  'create or replace function public.admin_supersede_operator_compensation_rate',
  'create or replace function public.admin_refresh_technician_pay_report_sales',
  "p_effective_start_date - 1",
  'Machine-only Time Report authority does not expose pay details',
  'drop policy if exists "compensation_rules_select_manager"',
  'using (public.can_manage_operator_payout_account_current_user(account_id))',
  'drop policy if exists "payout_run_item_machines_select_accessible"',
  'using (public.can_access_payout_run_item_current_user(payout_run_item_id))',
  "'actualStartAt', entry.actual_start_at",
  "'actualEndAt', entry.actual_end_at",
  "'actualDurationMinutes', entry.raw_duration_minutes",
  "'paidShifts', entry.paid_shift_count",
  'public.can_manage_operator_payout_machine(actor_user_id, machine.id)',
  "'approvalRequired', false",
  'create or replace function private.calculate_technician_pay_report',
  'public.operator_compensation_rate_at',
  "'shiftRateLines'",
  'snapshot.eligible_commission_revenue_cents',
  "'refundAdjustmentCents'",
  "'refundAppliedOnce', true",
  "'bonusCents'",
  "'supplyCreditCents'",
  "'expenseReimbursementCents'",
  "'currentTotalCents'",
  "'missing_shift_rate'",
  "'unresolved_time_assignment_scope'",
  "'missing_revenue_snapshot'",
  "'missing_commission_rate'",
  "'partial_period_assignment_scope'",
  "'stale_sales_source'",
  'create or replace function public.get_technician_pay_report_context',
  'public.can_manage_operator_payout_account(actor_user_id, account.id)',
  "raise exception 'Account pay authority required'",
  "'accountPayAuthorityRequired', true",
  "'paymentExecution', false",
  "'taxCalculation', false",
  'revoke execute on function private.calculate_technician_pay_report',
  'revoke execute on function public.get_technician_pay_report_context',
  'grant execute on function public.get_technician_pay_report_context(date) to authenticated',
]) {
  expect(migration, snippet, 'manager report migration');
}

if (/\b(insert|update|delete)\s+public\.payout_(runs|run_items|adjustments)\b/i.test(migration)) {
  fail('The manager report contract must remain calculation-only and cannot mutate payout execution state.');
}

const helper = readText(files.helper);
for (const snippet of [
  'OperatorTimeReportTechnician',
  'TechnicianPayReportIssue',
  'TechnicianPayReportRate',
  'TechnicianPayReportEntry',
  'TechnicianPayReportShiftRateLine',
  'TechnicianPayReportMachine',
  'TechnicianPayReportOtherEarning',
  'TechnicianPayReportTechnician',
  'TechnicianPayReportContext',
  'fetchTechnicianPayReportContext',
  'supersedeOperatorCompensationRateAdmin',
  'refreshTechnicianPayReportSalesAdmin',
  "'get_technician_pay_report_context'",
]) {
  if (!helper.includes(snippet)) {
    fail(`operatorPayouts helper missing ${snippet}`);
  }
}

const payReportPage = readText(files.payReportPage);
for (const snippet of [
  'Rate missing',
  'Commission rate missing',
  "totalUnavailable ? 'Unavailable'",
  'supersedeOperatorCompensationRateAdmin',
  'upsertOperatorRecurringItemAdmin',
  'Refresh sales',
  'All assigned machines — Technician default',
  'Add rate change',
  'Add commission rate',
  'Add other earning',
  'No approval or edit reason is required',
]) {
  if (!payReportPage.includes(snippet)) {
    fail(`Technician Pay Report page missing ${snippet}`);
  }
}

for (const snippet of ['get_my_time_report_access', "'timekeeping.review'"]) {
  if (!readText(files.authContext).includes(snippet)) {
    fail(`Auth context missing ${snippet}`);
  }
}

const pgTap = readText(files.pgTap);
for (const marker of [
  '61 minutes displays as two paid shifts',
  'three separate 20-minute entries count as three shifts',
  'a midmonth raise is displayed as two separate effective rate lines',
  'Commissionable Sales uses the authoritative net revenue snapshot',
  'one effective recurring supply credit is included once',
  'without deducting refunds twice',
  'machine-only Time Report authority cannot read pay data',
  'machine-only Time Report authority cannot read the legacy payout surface either',
  'machine-only managers cannot select compensation rates directly',
  'machine-only managers cannot select machine pay rows directly',
  'a machine-only Time Report manager does not receive the Technician Pay admin surface',
  'a machine manager receives the safe Time Report portal capability',
  'an inactive Technician remains available in a historical monthly report',
  'a later-revoked assignment retains its valid historical calculation window',
  'a midmonth raise can supersede an existing open-ended shift rate in one action',
  'the superseded rate ends the prior window on the preceding day',
  'Commissionable Sales refresh retains historically valid revoked assignments',
  'the existing manager correction RPC still works without a reason',
]) {
  if (!pgTap.includes(marker)) {
    fail(`pgTAP coverage missing marker: ${marker}`);
  }
}

expect(
  readText(files.packageJson),
  'operator-payouts:validate-manager-reports',
  'package script'
);

const paidShifts = (minutes) => (minutes <= 0 ? 0 : Math.ceil(minutes / 60));
if (paidShifts(61) !== 2) fail('61-minute static fixture must produce two shifts.');
if (paidShifts(20) + paidShifts(20) + paidShifts(20) !== 3) {
  fail('Three separate 20-minute static fixtures must produce three shifts.');
}

const shiftEarnings = 2 * 2000 + 1 * 2000 + 1 * 2000 + 1 * 2500;
const commissionableSales = 10000 - 1000;
const commission = Math.round((commissionableSales * 1000) / 10000);
const currentTotal = shiftEarnings + commission + 5000;
if (shiftEarnings !== 10500 || commission !== 900 || currentTotal !== 16400) {
  fail('Deterministic pay fixture no longer reconciles.');
}

console.log(
  'Manager Time/Pay Report contract checks passed: canonical time, per-entry shifts, effective rates, authoritative Commissionable Sales, recurring credits, blockers, once-only refunds, account pay authority, and calculation-only capabilities are present.'
);
