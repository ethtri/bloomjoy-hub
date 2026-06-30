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
    '20260626142851_operator_employee_provisioning.sql'
  ),
  provisionFunction: path.join(
    repoRoot,
    'supabase',
    'functions',
    'operator-payout-provision',
    'index.ts'
  ),
  accessInviteFunction: path.join(repoRoot, 'supabase', 'functions', 'access-invite', 'index.ts'),
  config: path.join(repoRoot, 'supabase', 'config.toml'),
  helper: path.join(repoRoot, 'src', 'lib', 'operatorPayouts.ts'),
  accessInvites: path.join(repoRoot, 'src', 'lib', 'accessInvites.ts'),
  loginUrls: path.join(repoRoot, 'src', 'lib', 'accessInviteLoginUrls.ts'),
  page: path.join(repoRoot, 'src', 'pages', 'admin', 'Payouts.tsx'),
  rpcSurface: path.join(repoRoot, 'scripts', 'validate-rpc-execute-surface.mjs'),
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
  "check (invite_type in ('corporate_partner', 'technician', 'machine_manager', 'operator_payout'))",
  "'operator_payout_profile'",
  'create or replace function public.admin_find_auth_user_by_email',
  'create or replace function public.get_operator_payout_setup_context',
  'create or replace function public.admin_provision_operator_payout_for_user',
  'create or replace function public.admin_deactivate_operator_payout_profile_for_user',
  'create or replace function public.can_send_operator_payout_invite_current_user',
  'operator_employee_access.provisioned',
  'operator_employee_access.deactivated',
  'access_invite_deliveries_select_operator_payout_managers',
  'grant execute on function public.get_operator_payout_setup_context() to authenticated',
  'grant execute on function public.admin_find_auth_user_by_email(text) to service_role',
  'grant execute on function public.admin_provision_operator_payout_for_user(uuid, uuid, text, uuid, text, text, uuid, uuid[], text) to service_role',
  'grant execute on function public.admin_deactivate_operator_payout_profile_for_user(uuid, uuid, text) to service_role',
  'tax_compliance_engine',
  'payroll_provider_execution',
]) {
  expect(migration, snippet, 'operator provisioning migration');
}

for (const forbidden of [
  'grant execute on function public.admin_find_auth_user_by_email(text) to authenticated',
  'grant execute on function public.admin_provision_operator_payout_for_user(uuid, uuid, text, uuid, text, text, uuid, uuid[], text) to authenticated',
  'grant execute on function public.admin_deactivate_operator_payout_profile_for_user(uuid, uuid, text) to authenticated',
]) {
  if (compact(migration).includes(compact(forbidden))) {
    fail(`operator provisioning migration must not expose service-only helper: ${forbidden}`);
  }
}

const provisionFunction = readText(files.provisionFunction);
for (const snippet of [
  'resolveSupabaseAccessToken',
  'supabase.auth.getUser',
  'supabase.auth.admin.createUser',
  'email_confirm: true',
  'admin_find_auth_user_by_email',
  'admin_provision_operator_payout_for_user',
  'admin_deactivate_operator_payout_profile_for_user',
  'machineIds.length === 0',
  'authUserCreated',
]) {
  if (!provisionFunction.includes(snippet)) {
    fail(`operator-payout-provision function missing ${snippet}`);
  }
}

const accessInviteFunction = readText(files.accessInviteFunction);
for (const snippet of [
  'operator_payout',
  'operator_payout_profile',
  'getOperatorPayoutSource',
  'canSendOperatorPayoutInvite',
  'admin_find_auth_user_by_email',
  'Your Bloomjoy Operator invitation',
]) {
  if (!accessInviteFunction.includes(snippet)) {
    fail(`access-invite function missing operator payout snippet: ${snippet}`);
  }
}

const config = readText(files.config);
expect(config, '[functions.operator-payout-provision]', 'Supabase config');
expect(config, 'verify_jwt = false', 'Supabase config');

const helper = readText(files.helper);
for (const snippet of [
  'OperatorPayoutSetupContext',
  'fetchOperatorPayoutSetupContext',
  'provisionOperatorPayoutAccessAdmin',
  'deactivateOperatorPayoutProfileAdmin',
  'operator-payout-provision',
  'get_operator_payout_setup_context',
]) {
  if (!helper.includes(snippet)) {
    fail(`operatorPayouts helper missing ${snippet}`);
  }
}

const accessInvites = readText(files.accessInvites);
for (const snippet of ["'operator_payout'", "'operator_payout_profile'"]) {
  if (!accessInvites.includes(snippet)) {
    fail(`accessInvites helper missing ${snippet}`);
  }
}

const loginUrls = readText(files.loginUrls);
if (!loginUrls.includes("'operator_payout'")) {
  fail('accessInviteLoginUrls missing operator_payout login intent.');
}

const page = readText(files.page);
for (const snippet of [
  'Operator Setup',
  'Save Operator and Send Invite',
  'Operator Access',
  'Deactivate Access',
  'resendOperatorInvite',
  'copyOperatorLoginUrl',
  'deactivateOperator',
  "sendAccessInvite({",
  "inviteType: 'operator_payout'",
]) {
  if (!page.includes(snippet)) {
    fail(`Admin payouts page missing operator setup snippet: ${snippet}`);
  }
}

const rpcSurface = readText(files.rpcSurface);
for (const snippet of [
  'admin_find_auth_user_by_email',
  'admin_provision_operator_payout_for_user',
  'admin_deactivate_operator_payout_profile_for_user',
]) {
  if (!rpcSurface.includes(snippet)) {
    fail(`RPC surface validator missing ${snippet}.`);
  }
}

const packageJson = readText(files.packageJson);
if (!packageJson.includes('operator-payouts:validate-employee-provisioning')) {
  fail('package.json missing employee provisioning validator script.');
}

const smoke = readText(files.smoke);
for (const snippet of [
  'Admin Operator Setup',
  'never-authenticated employee operator',
  'operator_payout',
  'saved-but-invite-failed',
  'prevents future `/portal/time` entry',
]) {
  if (!smoke.includes(snippet)) {
    fail(`Smoke checklist missing ${snippet}`);
  }
}

console.log(
  'Operator employee provisioning checks passed: service-role Auth provisioning, setup context, scoped machine assignment, operator invites, deactivation, UI, and smoke coverage are present.'
);
