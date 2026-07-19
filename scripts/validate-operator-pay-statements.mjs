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
    '202605200006_operator_pay_statements.sql'
  ),
  helper: path.join(repoRoot, 'src', 'lib', 'operatorPayouts.ts'),
  adminPage: path.join(repoRoot, 'src', 'pages', 'admin', 'Payouts.tsx'),
  portalTime: path.join(repoRoot, 'src', 'pages', 'portal', 'Time.tsx'),
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
  'add column if not exists statement_payload jsonb',
  'pay_statements_artifact_present_when_issued',
  'portal_published',
  'create or replace function public.operator_pay_statement_payload_for_item',
  'rawProviderPayloadsIncluded',
  'taxComplianceEngine',
  'payrollProviderExecution',
  'create or replace function public.admin_preview_pay_statements',
  'previewOnly',
  'create or replace function public.admin_issue_pay_statements',
  'Revision reason is required when issued pay statements already exist',
  'operator_pay_statements.issued',
  'create or replace function public.get_my_operator_pay_statement_context',
  'select distinct on (statement.payout_run_item_id)',
  'create or replace function public.get_pay_statement_artifact',
  'Only issued pay statements can be downloaded',
  'grant execute on function public.operator_pay_statement_payload_for_item(uuid, text, integer, text, uuid, text) to service_role',
  'grant execute on function public.admin_issue_pay_statements(uuid, text, text) to authenticated',
]) {
  expect(migration, snippet, 'pay statements migration');
}

const helper = readText(files.helper);
for (const snippet of [
  'OperatorPayStatementSummary',
  'OperatorPayStatementPayload',
  'fetchMyOperatorPayStatementContext',
  'fetchPayStatementArtifact',
  'previewPayStatementsAdmin',
  'issuePayStatementsAdmin',
  'buildOperatorPayStatementHtml',
  'downloadOperatorPayStatementHtml',
  'get_my_operator_pay_statement_context',
  'get_pay_statement_artifact',
]) {
  if (!helper.includes(snippet)) {
    fail(`operatorPayouts helper missing ${snippet}`);
  }
}

const adminPage = readText(files.adminPage);
for (const snippet of [
  'Pay Statements',
  'previewStatements',
  'issueStatements',
  'Revision reason',
  'Preview rows are not visible to Technicians until issued.',
  'Eligible now',
]) {
  if (!adminPage.includes(snippet)) {
    fail(`Admin payouts page missing ${snippet}`);
  }
}

const portalTime = readText(files.portalTime);
for (const snippet of [
  'PayStatementsPanel',
  'downloadStatement',
  'Download issued pay statements',
  'No pay statements yet.',
  'fetchPayStatementArtifact',
  'downloadOperatorPayStatementHtml',
]) {
  if (!portalTime.includes(snippet)) {
    fail(`Portal time page missing ${snippet}`);
  }
}

const rpcSurface = readText(files.rpcSurface);
if (!rpcSurface.includes('operator_pay_statement_payload_for_item')) {
  fail('RPC surface validator missing operator_pay_statement_payload_for_item.');
}

const packageJson = readText(files.packageJson);
if (!packageJson.includes('operator-payouts:validate-statements')) {
  fail('package.json missing pay statements validator script.');
}

const smoke = readText(files.smoke);
for (const snippet of [
  'Technician Pay Statements',
  'Technicians see only latest issued pay statements',
  'Managers can preview pay statements before issuance',
]) {
  if (!smoke.includes(snippet)) {
    fail(`Smoke checklist missing ${snippet}`);
  }
}

const status = readText(files.status);
if (!status.includes('Operator pay statements slice `#449`')) {
  fail('CURRENT_STATUS missing #449 operator pay statements update.');
}

console.log(
  'Technician pay statement checks passed: versioned statement payloads, manager preview/issuance, Technician-only latest statements, artifact downloads, portal publication tracking, and smoke coverage are present.'
);
