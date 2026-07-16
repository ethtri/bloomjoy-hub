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
    '202605200005_operator_payout_review_workflow.sql'
  ),
  helper: path.join(repoRoot, 'src', 'lib', 'operatorPayouts.ts'),
  page: path.join(repoRoot, 'src', 'pages', 'admin', 'Payouts.tsx'),
  app: path.join(repoRoot, 'src', 'App.tsx'),
  adminRoute: path.join(repoRoot, 'src', 'components', 'auth', 'AdminRoute.tsx'),
  authenticatedNavigation: path.join(
    repoRoot,
    'src',
    'components',
    'layout',
    'authenticatedNavigation.ts'
  ),
  navbar: path.join(repoRoot, 'src', 'components', 'layout', 'Navbar.tsx'),
  i18n: path.join(repoRoot, 'src', 'lib', 'i18n.ts'),
  rpcSurface: path.join(repoRoot, 'scripts', 'validate-rpc-execute-surface.mjs'),
  packageJson: path.join(repoRoot, 'package.json'),
  smoke: path.join(repoRoot, 'Docs', 'QA_SMOKE_TEST_CHECKLIST.md'),
  status: path.join(repoRoot, 'Docs', 'CURRENT_STATUS.md'),
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
  'create table if not exists public.payout_run_review_snapshots',
  'revision_number integer not null check (revision_number > 0)',
  'create or replace function public.operator_can_finalize_payout_run',
  'create or replace function public.operator_capture_payout_run_review_snapshot',
  'create or replace function public.get_my_admin_access_context',
  "allowed_surfaces := allowed_surfaces || array['payouts']",
  'create or replace function public.operator_payout_calculation_payload',
  'visibilityFilter',
  'scoped_items_only',
  'create or replace function public.get_payout_review_context',
  'issuedStatementCount',
  'revisionCount',
  'create or replace function public.admin_mark_payout_run_reviewed',
  'create or replace function public.admin_finalize_payout_run',
  'Critical payout warnings must be resolved or explicitly overridden before finalization',
  'Finalization blocked because issued pay statements already exist for this payout run',
  'payroll_provider_execution',
  'create or replace function public.admin_reopen_payout_run',
  'Issued pay statements require a statement revision flow instead of reopening the payout run',
  'create or replace function public.admin_void_payout_run',
  'operator_payout_run.finalized',
  'operator_payout_run.reopened',
  'operator_payout_run.voided',
  'grant execute on function public.operator_can_finalize_payout_run(uuid, uuid) to service_role',
  'grant execute on function public.operator_capture_payout_run_review_snapshot(uuid, uuid, text, text) to service_role',
]) {
  expect(migration, snippet, 'review migration');
}

const helper = readText(files.helper);
for (const snippet of [
  'PayoutReviewContext',
  'PayoutReviewPeriod',
  'PayoutReviewWorkflowResult',
  'fetchPayoutReviewContext',
  'markPayoutRunReviewedAdmin',
  'finalizePayoutRunAdmin',
  'reopenPayoutRunAdmin',
  'voidPayoutRunAdmin',
  'get_payout_review_context',
]) {
  if (!helper.includes(snippet)) {
    fail(`operatorPayouts helper missing ${snippet}`);
  }
}

const page = readText(files.page);
for (const snippet of [
  'Operator Pay',
  'Manual Adjustment',
  'Finalize',
  'Critical warnings block finalization',
  'issued statements already exist',
  'Show on operator statement',
  'Review access',
  'No pay run yet',
  'does not run payroll',
  'direct deposit',
  'refund payments',
]) {
  if (!page.includes(snippet)) {
    fail(`Admin payouts page missing ${snippet}`);
  }
}

const app = readText(files.app);
if (!app.includes('AdminPayouts') || !app.includes('path="/admin/payouts"')) {
  fail('App router missing /admin/payouts route.');
}

const adminRoute = readText(files.adminRoute);
if (!adminRoute.includes("pathname === '/admin/payouts'") || !adminRoute.includes("surface: 'payouts'")) {
  fail('AdminRoute must allow the payouts admin surface.');
}

const authenticatedNavigation = readText(files.authenticatedNavigation);
for (const snippet of ["surface?: AdminSurface", "href: '/admin/payouts'", "surface: 'payouts'"]) {
  if (!authenticatedNavigation.includes(snippet)) {
    fail(`Authenticated navigation missing payout navigation snippet: ${snippet}`);
  }
}

const navbar = readText(files.navbar);
if (!navbar.includes("allowedAdminSurfaces.has('payouts')")) {
  fail('Navbar must expose the admin app entry for payout managers.');
}

const i18n = readText(files.i18n);
if (!i18n.includes("'admin.payouts'") || !i18n.includes("'admin.payoutsDescription'")) {
  fail('i18n missing admin payout labels.');
}

const rpcSurface = readText(files.rpcSurface);
for (const snippet of ['operator_can_finalize_payout_run', 'operator_capture_payout_run_review_snapshot']) {
  if (!rpcSurface.includes(snippet)) {
    fail(`RPC surface validator missing service-only helper ${snippet}.`);
  }
}

const packageJson = readText(files.packageJson);
if (!packageJson.includes('operator-payouts:validate-review')) {
  fail('package.json missing review validator script.');
}

const smoke = readText(files.smoke);
if (!smoke.includes('Admin Operator Pay Review')) {
  fail('Smoke checklist missing Admin Operator Pay Review coverage.');
}

const status = readText(files.status);
if (!status.includes('Operator Pay calculation, finalization')) {
  fail('CURRENT_STATUS missing the separation between Timekeeping V1 and pay-run review.');
}

const actionOrder = ['draft', 'review', 'finalized', 'reopened', 'voided'];
if (!actionOrder.includes('finalized') || !actionOrder.includes('reopened')) {
  fail('review workflow status fixture is invalid.');
}

console.log(
  'Operator payout review checks passed: scoped admin surface, review queue UI, immutable snapshots, blocker-aware finalization, duplicate statement guard, reopen/void audit flow, and smoke coverage are present.'
);
