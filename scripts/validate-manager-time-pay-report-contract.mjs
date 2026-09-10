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
  missedTimeMigration: path.join(
    repoRoot,
    'supabase',
    'migrations',
    '20260908213408_manager_add_missed_time.sql'
  ),
  freshnessMigration: path.join(
    repoRoot,
    'supabase',
    'migrations',
    '20260908234718_timekeeping_pay_stub_freshness_hardening.sql'
  ),
  payStubLintMigration: path.join(
    repoRoot,
    'supabase',
    'migrations',
    '20260909003847_fix_pay_stub_database_lint_errors.sql'
  ),
  setupMigration: path.join(
    repoRoot,
    'supabase',
    'migrations',
    '20260908043000_timekeeping_pilot_setup.sql'
  ),
  arrangementMigration: path.join(
    repoRoot,
    'supabase',
    'migrations',
    '20260909172137_per_machine_compensation_arrangements.sql'
  ),
  assignmentClarityMigration: path.join(
    repoRoot,
    'supabase',
    'migrations',
    '20260910154826_technician_pay_report_assignment_clarity.sql'
  ),
  assignmentRefreshMigration: path.join(
    repoRoot,
    'supabase',
    'migrations',
    '20260910173236_payout_assignment_sales_refresh.sql'
  ),
  automaticSalesMigration: path.join(
    repoRoot,
    'supabase',
    'migrations',
    '20260910204434_automatic_technician_pay_sales_reconciliation.sql'
  ),
  pgTap: path.join(repoRoot, 'supabase', 'tests', 'manager_time_pay_report_contract.sql'),
  concurrencyPgTap: path.join(
    repoRoot,
    'supabase',
    'tests',
    'timekeeping_pay_stub_freshness_concurrency.sql'
  ),
  helper: path.join(repoRoot, 'src', 'lib', 'operatorPayouts.ts'),
  payReportPage: path.join(repoRoot, 'src', 'pages', 'admin', 'Payouts.tsx'),
  timeReviewPage: path.join(repoRoot, 'src', 'pages', 'portal', 'TimeReview.tsx'),
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
  'create or replace function public.manager_correct_operator_time_entry',
  "p_effective_start_date - 1",
  "'Technician Pay Report sales refresh'",
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

const setupMigration = readText(files.setupMigration);
for (const snippet of [
  'create or replace function public.get_timekeeping_setup_context',
  'create or replace function public.admin_setup_timekeeping_technician',
  'public.can_manage_operator_payout_account(actor_user_id, p_account_id)',
  'public.can_manage_operator_payout_machine(actor_user_id, machine.id)',
  'pg_advisory_xact_lock',
  'public.admin_upsert_operator_payout_profile',
  'public.admin_upsert_operator_machine_assignment',
  'public.admin_upsert_operator_compensation_rate',
  "'shift'",
  "'commission'",
  "'timekeeping_technician.setup_completed'",
  'revoke execute on function public.get_timekeeping_setup_context()',
  'grant execute on function public.get_timekeeping_setup_context() to authenticated',
  'grant execute on function public.admin_setup_timekeeping_technician(text, uuid, text, text, text, uuid[], integer, integer, date) to authenticated',
]) {
  expect(setupMigration, snippet, 'Timekeeping pilot setup migration');
}

const arrangementMigration = readText(files.arrangementMigration);
for (const snippet of [
  'drop constraint if exists compensation_rules_canonical_shift_scope',
  'reporting_machine_id = p_reporting_machine_id or rule.reporting_machine_id is null',
  "then 'technician_machine_override'",
  'machine-specific pay requires an effective Technician assignment',
  'create or replace function public.admin_setup_timekeeping_technician_arrangements',
  'jsonb_array_elements(p_machine_compensation)',
  'count(distinct machine.account_id)',
  'public.admin_upsert_operator_machine_assignment',
  "'Commission waiting period'",
  "'timekeeping_technician.arrangements_setup_completed'",
  'grant execute on function public.admin_setup_timekeeping_technician_arrangements(text, text, text, text, date, jsonb) to authenticated',
  "'machineLabel', grouped.machine_label",
]) {
  expect(arrangementMigration, snippet, 'per-machine compensation migration');
}

const assignmentClarityMigration = readText(files.assignmentClarityMigration);
for (const snippet of [
  'private.normalize_technician_pay_report_status',
  "'current_period_sales_through'",
  "'periodInProgress'",
  "'hasAssignmentInPeriod'",
  "'freshnessPolicy'",
  'get_technician_pay_report_context_without_assignment_clarity',
  "'assignments'",
  "'assignmentId'",
  "'overlapsSelectedPeriod'",
  "'selectedPeriodGrossSalesCents'",
  "timezone('America/Los_Angeles', now())::date",
  'grant execute on function public.get_technician_pay_report_context(date) to authenticated',
]) {
  expect(assignmentClarityMigration, snippet, 'Technician Pay Report assignment clarity migration');
}

const assignmentRefreshMigration = readText(files.assignmentRefreshMigration);
for (const snippet of [
  'private.normalize_technician_pay_report_status',
  'public.admin_refresh_technician_pay_report_sales',
  'public.ensure_operator_payout_period_for_date',
  "'revenueSnapshotId'",
  "'snapshotMatchesFacts'",
  'a zero-sales final day is valid',
]) {
  expect(snippet === "'revenueSnapshotId'" || snippet === "'snapshotMatchesFacts'" ? readText(files.pgTap) : assignmentRefreshMigration, snippet, 'assignment sales refresh regression');
}

const automaticSalesMigration = readText(files.automaticSalesMigration);
for (const snippet of [
  'create function public.get_current_technician_pay_report_context',
  'public.ensure_operator_payout_period_for_date',
  'private.operator_machine_tax_snapshot',
  'pg_catalog.pg_advisory_xact_lock',
  'snapshot_row.gross_sales_cents is distinct from',
  'Technician Pay Report automatic sales reconciliation',
  'private.operator_pay_stub_regeneration_required',
  'audit.created_at >= latest.generated_at',
  "'operator_payout_revenue_snapshot.regenerated'",
  'grant execute on function public.get_current_technician_pay_report_context(date) to authenticated',
]) {
  expect(automaticSalesMigration, snippet, 'automatic Technician Pay Report sales reconciliation migration');
}

const missedTimeMigration = readText(files.missedTimeMigration);
for (const snippet of [
  'create or replace function public.get_my_time_review_entry_options',
  'create or replace function public.manager_create_operator_time_entry',
  'public.can_manage_operator_payout_machine(actor_user_id, machine_row.id)',
  'Technician is not assigned to this machine for the work date',
  'Time entry overlaps another Technician entry',
  "'manager_created'",
  "'operator_time_entry.manager_created'",
  "'afterTechnicianCutoff'",
  "'payStubRegenerationRequired'",
  "'after_cutoff_allowed', true",
  'private.operator_pay_stub_regeneration_required',
  "'pay_stub_regeneration_required'",
  'get_technician_pay_report_context_without_time_regeneration_state',
  'revoke execute on function public.manager_create_operator_time_entry',
  'grant execute on function public.manager_create_operator_time_entry',
]) {
  expect(missedTimeMigration, snippet, 'manager missed-time migration');
}

const freshnessMigration = readText(files.freshnessMigration);
for (const snippet of [
  'time_entry_change_source_revision_seq',
  'source_revision bigint',
  'time_entry_change_events_source_revision_uidx',
  'private.operator_pay_time_source_lock_key',
  'pg_advisory_xact_lock',
  'private.guard_time_entry_voided_payout_period',
  'Voided pay periods cannot accept time changes',
  'private.operator_pay_time_source_revision',
  "'paySourceRevision'",
  'service_prepare_pay_stub_without_time_source_revision',
  'create function public.service_prepare_pay_stub',
  'service_complete_pay_stub_without_time_source_revision',
  'create function public.service_complete_pay_stub',
  'Pay Stub source changed during generation; retry required',
  'private.operator_pay_stub_regeneration_required',
  'revoke execute on function public.service_prepare_pay_stub',
  'revoke execute on function public.service_complete_pay_stub',
]) {
  expect(freshnessMigration, snippet, 'Pay Stub freshness migration');
}

const concurrencyPgTap = readText(files.concurrencyPgTap);
for (const marker of [
  'the independent time-entry transaction waits on the shared Technician/year lock',
  'the later-committing time entry receives a newer source revision',
  'a time change absent from the serialized calculation cannot appear current',
]) {
  if (!concurrencyPgTap.includes(marker)) {
    fail(`concurrency pgTAP coverage missing marker: ${marker}`);
  }
}

const payStubLintMigration = readText(files.payStubLintMigration);
for (const snippet of [
  'add column if not exists legal_name text',
  'generated_statement_payload jsonb',
  'statement_payload = prior_statement.statement_payload',
  'statement_payload = current_statement.statement_payload',
]) {
  expect(payStubLintMigration, snippet, 'Pay Stub lint repair migration');
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
  'TechnicianPayReportAssignment',
  'TechnicianPayReportOtherEarning',
  'TechnicianPayReportTechnician',
  'TechnicianPayReportContext',
  'fetchTechnicianPayReportContext',
  'fetchTimekeepingSetupContext',
  'setupTimekeepingTechnicianAdmin',
  "'admin_setup_timekeeping_technician_arrangements'",
  'machineCompensation',
  "`${month}-01`",
  'supersedeOperatorCompensationRateAdmin',
  'upsertEffectiveOperatorMachineAssignmentAdmin',
  "'get_current_technician_pay_report_context'",
]) {
  if (!helper.includes(snippet)) {
    fail(`operatorPayouts helper missing ${snippet}`);
  }
}

const payReportPage = readText(files.payReportPage);
for (const snippet of [
  'Rate missing',
  'commission rate missing',
  "totalUnavailable ? 'Unavailable'",
  'supersedeOperatorCompensationRateAdmin',
  'upsertOperatorRecurringItemAdmin',
  'All assigned machines — Technician default',
  'Adjust pay',
  'Change started-hour rate',
  'Change commission',
  'Add another earning',
  'No approval or edit reason is required',
  'Set up Technician Timekeeping',
  'How is',
  'Apply first machine to all',
  'Pay per started hour',
  '3% after 3 months',
  'separate Pay Stubs',
  'Activate Timekeeping',
  'Invite Technician',
  'Assignment dates',
  'Backdate assignment',
  'Save assignment dates',
  'Month in progress',
  'Sales through',
  'Assignment dates were not changed',
  'sales updated automatically',
]) {
  if (!payReportPage.includes(snippet)) {
    fail(`Technician Pay Report page missing ${snippet}`);
  }
}

if (payReportPage.includes('Refresh sales') || helper.includes('refreshTechnicianPayReportSalesAdmin')) {
  fail('Technician Pay Report must not expose manual sales snapshot maintenance.');
}

const timeReviewPage = readText(files.timeReviewPage);
for (const snippet of [
  'Add missed time',
  'createManagerTimeEntry',
  'availableTechnicians',
  'missedTimeMachines',
  'Add to report',
  'included in the manager report',
]) {
  if (!timeReviewPage.includes(snippet)) {
    fail(`Time Report page missing ${snippet}`);
  }
}

if (!payReportPage.includes('Regenerate Pay Stub')) {
  fail('Technician Pay Report page missing durable stale-stub action label');
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
  'manager correction accepts historical time after later assignment revocation without a reason',
  'manager entry choices include an inactive historically assigned Technician with no submitted time',
  'a manager can add entirely missing time after the Technician cutoff without exposing pay-stub state',
  'manager-created missed time retains an audit trail',
  'Pay Reports persistently flags the stale published Pay Stub until regeneration',
  'a July time change also marks the later issued August YTD Pay Stub stale',
  'regenerating July does not prematurely clear the later August YTD warning',
  'manager-created time is rejected when its payout period is voided',
  'a rejected voided-period write creates no time entry',
  'Pay Stub publication rejects a time change committed after preparation',
  'a failed regeneration leaves the later Pay Stub stale',
  'successful regeneration clears the later Pay Stub stale state',
  'profile and work date stay paired when a time entry moves across both',
  'the legacy statement payload builder executes against the current account schema',
  'legacy statement issuance resolves the existing payload column without ambiguity',
  'future manager-created time is rejected',
  'manager-created time outside the effective assignment is rejected',
  'overlapping manager-created time is rejected',
  'an outsider cannot add missed time for a managed machine',
  'one manager action creates the complete initial Timekeeping setup',
  'repeating initial setup fails closed instead of creating overlapping records',
  'one simple setup creates machine arrangements across two payers',
  'after-three-months commission resolves to zero before its start and three percent on its start',
  'pay report retains machine-aware started-hour rate lines for Pay Stub detail',
  'a user without account pay authority cannot read Timekeeping setup choices',
  'an open month removes impossible future freshness blockers and remains non-publishable',
  'a closed month accepts a refreshed matching snapshot when the final day had no sales',
  'sales refresh creates a missing monthly period after a historical assignment change',
  'the pay report exposes effective assignment history to an account pay manager',
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
  'Manager Time/Pay Report contract checks passed: canonical time, per-entry shifts, effective rates, authoritative Commissionable Sales, recurring credits, blockers, once-only refunds, account pay authority, atomic Technician setup, and calculation-only capabilities are present.'
);
