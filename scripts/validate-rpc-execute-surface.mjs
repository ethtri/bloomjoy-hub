#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const migrationsDir = path.join(repoRoot, 'supabase', 'migrations');
const hardeningMigrationName = '202605060004_reduce_authenticated_rpc_advisor_surface.sql';
const hardeningMigrationPath = path.join(migrationsDir, hardeningMigrationName);
const refundOperationsMigrationName = '202605090001_refund_operations_mvp.sql';
const refundOperationsMigrationPath = path.join(migrationsDir, refundOperationsMigrationName);
const nayaxLookupFunctionPath = path.join(
  repoRoot,
  'supabase',
  'functions',
  'nayax-transaction-lookup',
  'index.ts'
);
const nayaxLookupSharedPath = path.join(
  repoRoot,
  'supabase',
  'functions',
  '_shared',
  'nayax-lookup.ts'
);

const serviceRoleOnlyFunctions = [
  {
    signature: 'public.can_access_partner_dashboard(uuid, uuid, date, date)',
    name: 'can_access_partner_dashboard',
    migrationName: hardeningMigrationName,
  },
  {
    signature: 'public.admin_grant_machine_report_access(text, uuid, uuid, uuid, text, text)',
    name: 'admin_grant_machine_report_access',
    migrationName: hardeningMigrationName,
  },
  {
    signature: 'public.create_report_export(uuid, jsonb)',
    name: 'create_report_export',
    migrationName: hardeningMigrationName,
  },
  {
    signature: 'public.admin_list_reporting_sync_runs(integer)',
    name: 'admin_list_reporting_sync_runs',
    migrationName: hardeningMigrationName,
  },
  {
    signature: 'public.admin_reconcile_technician_entitlements(text)',
    name: 'admin_reconcile_technician_entitlements',
    migrationName: hardeningMigrationName,
  },
  {
    signature: 'public.partner_report_scheduler_preview_partner_period_report(uuid, date, date, text)',
    name: 'partner_report_scheduler_preview_partner_period_report',
    migrationName: '202605070001_partner_report_scheduler_pdf_export.sql',
  },
  {
    signature: 'public.can_prepare_nayax_refund_execution(uuid, uuid)',
    name: 'can_prepare_nayax_refund_execution',
    migrationName: '202605120002_refund_full_automation_foundation.sql',
  },
  {
    signature: 'public.admin_update_refund_case(uuid, text, text, text, text, text, integer, text, boolean, text, integer, timestamp with time zone, integer, text, text)',
    name: 'admin_update_refund_case',
    migrationName: '202605120002_refund_full_automation_foundation.sql',
  },
  {
    signature: 'public.service_update_refund_case_as_actor(uuid, uuid, text, text, text, text, text, integer, text, boolean, text, integer, timestamp with time zone, integer, text, text)',
    name: 'service_update_refund_case_as_actor',
    migrationName: '202605120002_refund_full_automation_foundation.sql',
  },
  {
    signature: 'public.operator_can_access_payout_revenue_snapshot_row(uuid, uuid, uuid, date, date)',
    name: 'operator_can_access_payout_revenue_snapshot_row',
    migrationName: '202605200003_operator_revenue_snapshots.sql',
  },
  {
    signature: 'public.operator_revenue_snapshot_source_values(uuid, uuid)',
    name: 'operator_revenue_snapshot_source_values',
    migrationName: '202605200003_operator_revenue_snapshots.sql',
  },
];

const protectedAuthenticatedFunctions = [
  'public.is_super_admin(uuid)',
  'public.has_reporting_machine_access(uuid, uuid)',
  'public.is_reporting_account_member(uuid, uuid)',
  'public.can_access_technician_grant(uuid, uuid)',
  'public.can_access_members_only_training()',
  'public.has_my_active_customer_account_membership(uuid)',
  'public.is_my_partner_on_customer_account(uuid)',
  'public.get_my_admin_access_context()',
  'public.get_my_portal_access_context()',
  'public.get_my_reporting_access_context()',
  'public.get_sales_report(date, date, text, uuid[], uuid[], text[])',
];

const fail = (message) => {
  throw new Error(message);
};

const readText = (filePath) => fs.readFileSync(filePath, 'utf8');

const compactSql = (value) =>
  value
    .replace(/--.*$/gm, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const statementMentionsAuthenticated = (sql, verb, signature) => {
  const pattern = new RegExp(
    `${verb} execute on function ${escapeRegExp(signature.toLowerCase())} (?:from|to) [^;]*\\bauthenticated\\b`
  );
  return pattern.test(compactSql(sql));
};

const expectMigrationStatement = (migrationName, sql, snippet) => {
  if (!compactSql(sql).includes(compactSql(snippet))) {
    fail(`${migrationName}: missing statement: ${snippet}`);
  }
};

const getMigrationFiles = () =>
  fs
    .readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
    .map((entry) => entry.name)
    .sort();

const walkFiles = (dir, predicate, results = []) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const filePath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!['node_modules', '.git', 'dist'].includes(entry.name)) {
        walkFiles(filePath, predicate, results);
      }
      continue;
    }

    if (predicate(filePath)) {
      results.push(filePath);
    }
  }

  return results;
};

const assertBrowserDoesNotCallServiceOnlyFunctions = () => {
  const srcDir = path.join(repoRoot, 'src');
  const sourceFiles = fs.existsSync(srcDir)
    ? walkFiles(srcDir, (filePath) => /\.(ts|tsx|js|jsx)$/.test(filePath))
    : [];

  for (const filePath of sourceFiles) {
    const content = readText(filePath);
    for (const fn of serviceRoleOnlyFunctions) {
      const rpcCall = new RegExp(`\\.rpc(?:<[^>]+>)?\\(\\s*['"\`]${escapeRegExp(fn.name)}['"\`]`);
      if (rpcCall.test(content)) {
        fail(
          `${path.relative(repoRoot, filePath)} still calls service-role-only RPC ${fn.name} from browser code.`
        );
      }
    }
  }
};

const assertBrowserDoesNotDirectlyUpdateRefundCases = () => {
  const srcDir = path.join(repoRoot, 'src');
  const sourceFiles = fs.existsSync(srcDir)
    ? walkFiles(srcDir, (filePath) => /\.(ts|tsx|js|jsx)$/.test(filePath))
    : [];
  const directRefundUpdatePattern =
    /\.from(?:<[^>]+>)?\(\s*['"`]refund_cases['"`]\s*\)[\s\S]{0,160}?\.update\s*\(/m;

  for (const filePath of sourceFiles) {
    const content = readText(filePath);
    if (directRefundUpdatePattern.test(content)) {
      fail(
        `${path.relative(repoRoot, filePath)} directly updates refund_cases from browser code; use refund-case-admin-update instead.`
      );
    }
  }
};

const assertRefundOperationsSafety = () => {
  if (!fs.existsSync(refundOperationsMigrationPath)) {
    fail(`Missing migration ${refundOperationsMigrationName}.`);
  }

  const sql = readText(refundOperationsMigrationPath);
  const compact = compactSql(sql);

  expectMigrationStatement(
    refundOperationsMigrationName,
    sql,
    'drop policy if exists "refund_cases_update_accessible" on public.refund_cases'
  );
  expectMigrationStatement(
    refundOperationsMigrationName,
    sql,
    'revoke update on public.refund_cases from anon, authenticated'
  );

  if (/create\s+policy\s+"refund_cases_update_accessible"/i.test(sql)) {
    fail(`${refundOperationsMigrationName}: direct browser update policy for refund_cases must not be recreated.`);
  }

  expectMigrationStatement(
    refundOperationsMigrationName,
    sql,
    'create or replace function public.is_review_safe_nayax_transaction_reference'
  );
  expectMigrationStatement(
    refundOperationsMigrationName,
    sql,
    'Completed refund cases cannot move away from completed/approved through this RPC'
  );
  expectMigrationStatement(
    refundOperationsMigrationName,
    sql,
    'Completed card refund cases require reviewed Nayax correlation plus a manual refund reference'
  );
  expectMigrationStatement(
    refundOperationsMigrationName,
    sql,
    'Completed refund cases require a manual refund reference'
  );
  expectMigrationStatement(
    refundOperationsMigrationName,
    sql,
    'p_clear_nayax_match boolean default false'
  );
  expectMigrationStatement(
    refundOperationsMigrationName,
    sql,
    'Manager cleared Nayax transaction evidence for review.'
  );
  expectMigrationStatement(
    refundOperationsMigrationName,
    sql,
    'Denied refund cases require a friendly decision reason'
  );
  expectMigrationStatement(
    refundOperationsMigrationName,
    sql,
    "'audit_payload_redacted', true"
  );

  if (compact.includes("'matched_nayax_transaction_id', after_row.matched_nayax_transaction_id")) {
    fail(`${refundOperationsMigrationName}: refund_case reporting payload still includes raw Nayax transaction identifiers.`);
  }

  if (compact.includes("'matched_sales_fact_id', after_row.matched_sales_fact_id")) {
    fail(`${refundOperationsMigrationName}: refund_case reporting payload still includes raw matched sales fact IDs.`);
  }

  if (compact.includes('or after_row.matched_nayax_site_id is null')) {
    fail(`${refundOperationsMigrationName}: card completion should not require Nayax SiteID because Last Sales may omit it.`);
  }

  if (compact.includes('or refund_case_row.matched_nayax_site_id is null')) {
    fail(`${refundOperationsMigrationName}: refund_case settlement write-through should not require Nayax SiteID because Last Sales may omit it.`);
  }

  if (/'refund_case'\s*,\s*after_row\.id::text\s*,\s*to_jsonb\(before_row\)\s*,\s*to_jsonb\(after_row\)/i.test(compact)) {
    fail(`${refundOperationsMigrationName}: refund_case audit payload must be redacted, not full before/after rows.`);
  }
};

const assertNayaxLookupLogsAreSanitized = () => {
  if (!fs.existsSync(nayaxLookupFunctionPath)) {
    fail('Missing nayax-transaction-lookup Edge Function.');
  }
  if (!fs.existsSync(nayaxLookupSharedPath)) {
    fail('Missing shared Nayax lookup helper.');
  }

  const source = `${readText(nayaxLookupFunctionPath)}\n${readText(nayaxLookupSharedPath)}`;
  if (source.includes('response.text()') || source.includes('errorBody')) {
    fail('nayax-transaction-lookup must not read or log raw provider failure bodies.');
  }

  if (source.includes('console.error("nayax-transaction-lookup error", error)')) {
    fail('nayax-transaction-lookup must not log raw error objects.');
  }

  if (!source.includes('"nayax lookup provider failure"') || !source.includes('status: response.status')) {
    fail('nayax-transaction-lookup should log sanitized provider status context on lookup failure.');
  }

  if (!source.includes('[89ab][0-9a-f]{3}-[0-9a-f]{12}')) {
    fail('nayax-transaction-lookup UUID validation must accept standard reporting_machines UUIDs.');
  }

  if (
    source.includes('parseIncidentAt(body?.incidentAt)') ||
    source.includes('sanitizeInputCents(body?.amountCents)') ||
    source.includes('extractLast4(body?.cardLast4)')
  ) {
    fail('nayax-transaction-lookup must derive lookup inputs from the persisted refund case, not caller-supplied fields.');
  }

  for (const requiredCaseField of [
    'incident_at',
    'payment_method',
    'payment_amount_cents',
    'card_last4',
    'card_wallet_used',
  ]) {
    if (!source.includes(requiredCaseField)) {
      fail(`nayax-transaction-lookup must load refund case field ${requiredCaseField} server-side.`);
    }
  }
};

const assertServiceOnlyMigrations = () => {
  if (!fs.existsSync(hardeningMigrationPath)) {
    fail(`Missing migration ${hardeningMigrationName}.`);
  }

  for (const fn of serviceRoleOnlyFunctions) {
    const migrationPath = path.join(migrationsDir, fn.migrationName);
    if (!fs.existsSync(migrationPath)) {
      fail(`Missing migration ${fn.migrationName} for ${fn.signature}.`);
    }

    const sql = readText(migrationPath);
    expectMigrationStatement(
      fn.migrationName,
      sql,
      `revoke execute on function ${fn.signature} from public, anon, authenticated`
    );
    expectMigrationStatement(
      fn.migrationName,
      sql,
      `grant execute on function ${fn.signature} to service_role`
    );
    expectMigrationStatement(fn.migrationName, sql, `comment on function ${fn.signature} is`);
  }

  const sql = readText(hardeningMigrationPath);

  for (const signature of protectedAuthenticatedFunctions) {
    if (statementMentionsAuthenticated(sql, 'revoke', signature)) {
      fail(`${hardeningMigrationName} revokes authenticated execute from protected ${signature}.`);
    }
  }
};

const assertNoLaterAuthenticatedRegrant = () => {
  const migrations = getMigrationFiles();
  for (const fn of serviceRoleOnlyFunctions) {
    const migrationIndex = migrations.indexOf(fn.migrationName);
    if (migrationIndex === -1) {
      fail(`Unable to locate ${fn.migrationName} in migration order.`);
    }

    for (const migrationName of migrations.slice(migrationIndex + 1)) {
      const sql = readText(path.join(migrationsDir, migrationName));
      if (statementMentionsAuthenticated(sql, 'grant', fn.signature)) {
        fail(`${migrationName} re-grants authenticated execute on service-role-only ${fn.signature}.`);
      }
    }
  }
};

const main = () => {
  assertServiceOnlyMigrations();
  assertNoLaterAuthenticatedRegrant();
  assertBrowserDoesNotCallServiceOnlyFunctions();
  assertBrowserDoesNotDirectlyUpdateRefundCases();
  assertRefundOperationsSafety();
  assertNayaxLookupLogsAreSanitized();

  console.log(
    `RPC execute surface static checks passed: ${serviceRoleOnlyFunctions.length} service-role-only helper RPCs remain blocked from browser use, and refund case mutations remain RPC-gated.`
  );
};

main();
