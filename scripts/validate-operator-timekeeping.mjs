#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const files = {
  migration: path.join(repoRoot, 'supabase', 'migrations', '202605200002_operator_timekeeping_flow.sql'),
  managerMigration: path.join(
    repoRoot,
    'supabase',
    'migrations',
    '202607160001_timekeeping_manager_review.sql'
  ),
  managerAuthorityMigration: path.join(
    repoRoot,
    'supabase',
    'migrations',
    '202607170001_timekeeping_manager_authority_fail_closed.sql'
  ),
  page: path.join(repoRoot, 'src', 'pages', 'portal', 'Time.tsx'),
  reviewPage: path.join(repoRoot, 'src', 'pages', 'portal', 'TimeReview.tsx'),
  app: path.join(repoRoot, 'src', 'App.tsx'),
  nav: path.join(repoRoot, 'src', 'components', 'portal', 'portalNavigation.ts'),
  helper: path.join(repoRoot, 'src', 'lib', 'operatorPayouts.ts'),
  uiHelper: path.join(repoRoot, 'src', 'lib', 'timekeepingUi.ts'),
  uiHelperTest: path.join(repoRoot, 'src', 'lib', 'timekeepingUi.test.ts'),
  accessHook: path.join(repoRoot, 'src', 'hooks', 'usePortalTimekeepingAccess.ts'),
  smoke: path.join(repoRoot, 'Docs', 'QA_SMOKE_TEST_CHECKLIST.md'),
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

const reject = (source, snippet, label) => {
  if (compact(source).includes(compact(snippet))) {
    fail(`${label}: found retired Technician UI concept ${snippet}`);
  }
};

for (const [label, filePath] of Object.entries(files)) {
  if (!fs.existsSync(filePath)) {
    fail(`Missing ${label} file: ${path.relative(repoRoot, filePath)}`);
  }
}

const migration = readText(files.migration);
for (const snippet of [
  'create or replace function public.ensure_operator_payout_period_for_date',
  'create or replace function public.get_my_operator_timekeeping_context',
  'create or replace function public.submit_operator_time_entry',
  'create or replace function public.update_operator_time_entry',
  'create or replace function public.void_operator_time_entry',
  'The current operator timekeeping UI supports monthly calendar payout policies',
  'Operator deleted unlocked shift',
  'operator_time_entry.voided',
  'grant execute on function public.get_my_operator_timekeeping_context',
  'grant execute on function public.submit_operator_time_entry',
  'select pg_notify',
]) {
  expect(migration, snippet, 'timekeeping migration');
}

const page = readText(files.page);
for (const snippet of [
  'PortalPageIntro',
  'useQueries',
  'fetchMyOperatorTimekeepingContext',
  'saveCompletedOperatorTimeEntry',
  'voidOperatorTimeEntry',
  'getWeekMonthAnchors',
  'combineDateAndTimeInTimekeepingZone',
  'isTechnicianWorkDateEditable',
  'calculateOperatorPaidShifts',
  'technicianEditable',
  'Add time',
  'This week',
  'Previous week',
  'Next week',
  'Pay preview',
  "paid ${",
  'Pay Stubs',
  'Save time',
  'No machine assignment for this day',
  'Technician editing is closed for this month',
  'Enter time only after the work has ended',
  'This exact time is already recorded',
  'Times may touch, but they cannot overlap',
  'overlaps',
  'Record completed work',
  'aria-label={`Edit ${entryLabel(entry)}`}',
  'aria-label={`Delete ${entryLabel(entry)}`}',
  'motion-reduce:transition-none',
  'min-h-11',
]) {
  if (!page.includes(snippet)) {
    fail(`Time page missing ${snippet}`);
  }
}

for (const retiredSnippet of [
  'Waiting for review',
  'Correction requested',
  'Included in pay',
  'Delete this submitted time entry',
  'submitOperatorTimeEntry',
  'updateOperatorTimeEntry',
  'Save this time entry anyway?',
  'editablePeriodStatuses',
  'currentPeriod.status',
]) {
  reject(page, retiredSnippet, 'Time page');
}

const uiHelper = readText(files.uiHelper);
for (const snippet of [
  "TIMEKEEPING_TIME_ZONE = 'America/Los_Angeles'",
  'getTodayInTimekeepingZone',
  'getWeekStart',
  'getWeekMonthAnchors',
  'combineDateAndTimeInTimekeepingZone',
  'getTechnicianCutoffDate',
  'isTechnicianWorkDateEditable',
  'getActualDurationMinutes',
  'timeDraftOverlapsEntry',
  'describeTimekeepingError',
]) {
  expect(uiHelper, snippet, 'timekeeping UI helper');
}

const uiHelperTest = readText(files.uiHelperTest);
for (const snippet of [
  'winter offset',
  'summer offset',
  'spring-forward gap',
  'spring-forward duration',
  'fall-back duration',
  '61-minute duration',
  'one second before Pacific cutoff',
  'at Pacific cutoff',
]) {
  expect(uiHelperTest, snippet, 'timekeeping UI helper tests');
}

const managerMigration = readText(files.managerMigration);
for (const snippet of [
  'manager_review_status',
  'create table if not exists public.time_entry_review_events',
  'create index if not exists time_entries_manager_review_queue_idx',
  'revoke insert, update, delete on table public.time_entries from anon, authenticated',
  'create or replace function public.validate_operator_time_entry_assignment',
  'Future work dates are not allowed',
  "new.manager_review_status := 'pending'",
  'create or replace function public.reset_operator_time_entry_manager_review',
  'Manager review fields can only be changed through the review action',
  "set_config('app.time_entry_review_rpc', 'true', true)",
  'create or replace function public.get_my_time_review_context',
  'create or replace function public.review_operator_time_entry',
  'public.can_manage_operator_payout_machine(actor_user_id, before_row.reporting_machine_id)',
  'A correction reason is required',
  "'payment_behavior_changed', false",
  'grant execute on function public.get_my_time_review_context',
  'grant execute on function public.review_operator_time_entry',
]) {
  expect(managerMigration, snippet, 'timekeeping manager-review migration');
}

const managerAuthorityMigration = readText(files.managerAuthorityMigration);
for (const snippet of [
  'create or replace function public.can_manage_operator_payout_machine',
  'select coalesce(',
  'false',
  'revoke execute on function public.can_manage_operator_payout_machine',
  'grant execute on function public.can_manage_operator_payout_machine',
]) {
  expect(managerAuthorityMigration, snippet, 'timekeeping manager-authority migration');
}

const reviewPage = readText(files.reviewPage);
for (const snippet of [
  'fetchMyTimeReviewContext',
  'correctOperatorTimeEntry',
  'Time Report',
  'All managed machines',
  'Paid shifts',
  'Actual time',
  'Edit time',
  'No approval is required',
  'No managed machines',
  'Your changes are still here',
  'aria-live="polite"',
  'aria-label={`Edit ${entryLabel(entry)}`',
]) {
  if (!reviewPage.includes(snippet)) {
    fail(`Time Review page missing ${snippet}`);
  }
}

expect(readText(files.app), 'path="/portal/time"', 'App route');
expect(readText(files.app), 'path="/portal/time/new"', 'App Add Time route');
expect(readText(files.app), 'path="/portal/time/:entryId/edit"', 'App Edit Time route');
expect(readText(files.app), 'path="/portal/time-review"', 'App Time Review route');
expect(readText(files.nav), "href: '/portal/time'", 'portal navigation');
expect(readText(files.nav), "href: '/portal/time-review'", 'portal review navigation');
expect(readText(files.helper), 'fetchMyOperatorTimekeepingContext', 'operator payout helper');
expect(readText(files.helper), 'fetchMyTimeReviewContext', 'time review context helper');
expect(readText(files.helper), 'correctOperatorTimeEntry', 'time correction action helper');
expect(
  readText(files.accessHook),
  'queryFn: () => fetchMyOperatorTimekeepingContext()',
  'timekeeping access query'
);
expect(readText(files.smoke), 'Technician Time (`/portal/time`)', 'smoke checklist');
expect(readText(files.smoke), 'Time Report (`/portal/time-review`)', 'review smoke checklist');

console.log(
  'Operator timekeeping static checks passed: weekly Technician entry, canonical shift previews, direct manager corrections, access guards, RPCs, UI states, and smoke coverage are present.'
);
