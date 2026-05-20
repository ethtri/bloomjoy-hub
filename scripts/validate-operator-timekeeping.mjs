#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const files = {
  migration: path.join(repoRoot, 'supabase', 'migrations', '202605200002_operator_timekeeping_flow.sql'),
  page: path.join(repoRoot, 'src', 'pages', 'portal', 'Time.tsx'),
  app: path.join(repoRoot, 'src', 'App.tsx'),
  nav: path.join(repoRoot, 'src', 'components', 'portal', 'portalNavigation.ts'),
  helper: path.join(repoRoot, 'src', 'lib', 'operatorPayouts.ts'),
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
  'fetchMyOperatorTimekeepingContext',
  'submitOperatorTimeEntry',
  'updateOperatorTimeEntry',
  'voidOperatorTimeEntry',
  'assigned machine',
  'overlaps',
  '10+ hours',
  'End time must be after start time',
  'Delete this submitted time entry',
  'duplicate of an existing shift',
  'Past shifts are view-only here',
]) {
  if (!page.includes(snippet)) {
    fail(`Time page missing ${snippet}`);
  }
}

expect(readText(files.app), 'path="/portal/time"', 'App route');
expect(readText(files.app), 'path="/portal/time/new"', 'App Add Time route');
expect(readText(files.app), 'path="/portal/time/:entryId/edit"', 'App Edit Time route');
expect(readText(files.nav), "href: '/portal/time'", 'portal navigation');
expect(readText(files.helper), 'fetchMyOperatorTimekeepingContext', 'operator payout helper');
expect(readText(files.smoke), 'Operator Time (`/portal/time`)', 'smoke checklist');

console.log(
  'Operator timekeeping static checks passed: route, RPCs, UI warnings, helper methods, and smoke checklist coverage are present.'
);
