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
    '20260626135851_operator_payout_register_export.sql'
  ),
  helper: path.join(repoRoot, 'src', 'lib', 'operatorPayouts.ts'),
  adminPage: path.join(repoRoot, 'src', 'pages', 'admin', 'Payouts.tsx'),
  uatScript: path.join(repoRoot, 'scripts', 'validate-operator-payout-register-export-uat.mjs'),
  packageJson: path.join(repoRoot, 'package.json'),
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
  'create or replace function public.admin_get_payout_register_export',
  "run_row.status not in ('finalized', 'issued', 'closed')",
  'Payout register export is available only for finalized or issued payout runs',
  'public.operator_can_finalize_payout_run(actor_user_id, run_row.id)',
  'Payout register export access required',
  'from public.pay_statements statement',
  "statement.status in ('issued', 'revised')",
  'operatorDisplayName',
  'statementNumber',
  'eligibleNetRevenueCents',
  'commissionBasisPoints',
  'adjustmentsTotalCents',
  'totalPayoutCents',
  'ssnIncluded',
  'bankDataIncluded',
  'payrollProviderExecution',
  'directDepositExecution',
  'revoke execute on function public.admin_get_payout_register_export(uuid) from public, anon',
  'grant execute on function public.admin_get_payout_register_export(uuid) to authenticated',
]) {
  expect(migration, snippet, 'register export migration');
}

const helper = readText(files.helper);
for (const snippet of [
  'PayoutRegisterExport',
  'PayoutRegisterExportRow',
  'fetchPayoutRegisterExportAdmin',
  'admin_get_payout_register_export',
  'buildPayoutRegisterCsv',
  'downloadPayoutRegisterCsv',
  'getPayoutRegisterCsvFileName',
  'external_payroll_boundary',
]) {
  if (!helper.includes(snippet)) {
    fail(`operatorPayouts helper missing ${snippet}`);
  }
}

const adminPage = readText(files.adminPage);
for (const snippet of [
  'Payout Register',
  'Export Register',
  'canExportPayoutRegister',
  'fetchPayoutRegisterExportAdmin',
  'downloadPayoutRegisterCsv',
  'Bloomjoy Hub does not run payroll, taxes',
  'direct deposit, or filings.',
]) {
  if (!adminPage.includes(snippet)) {
    fail(`Admin payouts page missing ${snippet}`);
  }
}

const packageJson = readText(files.packageJson);
if (!packageJson.includes('operator-payouts:validate-register-export')) {
  fail('package.json missing register export validator script.');
}
if (!packageJson.includes('operator-payouts:validate-register-export-uat')) {
  fail('package.json missing register export UAT validator script.');
}

const uatScript = readText(files.uatScript);
for (const snippet of [
  'admin_get_payout_register_export',
  'Export Register',
  'payout-register-bloomjoy-uat-2026-05-01-2026-05-31.csv',
  'admin-payout-register-export-desktop.png',
  'admin-payout-register-export-mobile.png',
]) {
  if (!uatScript.includes(snippet)) {
    fail(`Register export UAT script missing ${snippet}`);
  }
}

const smoke = readText(files.smoke);
for (const snippet of [
  'Admin Operator Payout Register Export',
  'Export Register',
  'finalized or issued payout run',
  'operator-payouts:validate-register-export-uat',
  'external payroll or payment execution',
]) {
  if (!smoke.includes(snippet)) {
    fail(`Smoke checklist missing ${snippet}`);
  }
}

console.log(
  'Operator payout register export checks passed: finalized or issued status guard, scoped manager access guard, CSV helper, admin UI action, payroll-boundary copy, and smoke coverage are present.'
);
