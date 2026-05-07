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

const serviceRoleOnlyFunctions = [
  {
    signature: 'public.can_access_partner_dashboard(uuid, uuid, date, date)',
    name: 'can_access_partner_dashboard',
  },
  {
    signature: 'public.admin_grant_machine_report_access(text, uuid, uuid, uuid, text, text)',
    name: 'admin_grant_machine_report_access',
  },
  {
    signature: 'public.create_report_export(uuid, jsonb)',
    name: 'create_report_export',
  },
  {
    signature: 'public.admin_list_reporting_sync_runs(integer)',
    name: 'admin_list_reporting_sync_runs',
  },
  {
    signature: 'public.admin_reconcile_technician_entitlements(text)',
    name: 'admin_reconcile_technician_entitlements',
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

const expectMigrationStatement = (sql, snippet) => {
  if (!compactSql(sql).includes(compactSql(snippet))) {
    fail(`${hardeningMigrationName}: missing statement: ${snippet}`);
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

const assertIssueMigration = () => {
  if (!fs.existsSync(hardeningMigrationPath)) {
    fail(`Missing migration ${hardeningMigrationName}.`);
  }

  const sql = readText(hardeningMigrationPath);

  for (const fn of serviceRoleOnlyFunctions) {
    expectMigrationStatement(
      sql,
      `revoke execute on function ${fn.signature} from public, anon, authenticated`
    );
    expectMigrationStatement(sql, `grant execute on function ${fn.signature} to service_role`);
    expectMigrationStatement(sql, `comment on function ${fn.signature} is`);
  }

  for (const signature of protectedAuthenticatedFunctions) {
    if (statementMentionsAuthenticated(sql, 'revoke', signature)) {
      fail(`${hardeningMigrationName} revokes authenticated execute from protected ${signature}.`);
    }
  }
};

const assertNoLaterAuthenticatedRegrant = () => {
  const migrations = getMigrationFiles();
  const hardeningIndex = migrations.indexOf(hardeningMigrationName);
  if (hardeningIndex === -1) {
    fail(`Unable to locate ${hardeningMigrationName} in migration order.`);
  }

  for (const migrationName of migrations.slice(hardeningIndex + 1)) {
    const sql = readText(path.join(migrationsDir, migrationName));
    for (const fn of serviceRoleOnlyFunctions) {
      if (statementMentionsAuthenticated(sql, 'grant', fn.signature)) {
        fail(`${migrationName} re-grants authenticated execute on service-role-only ${fn.signature}.`);
      }
    }
  }
};

const main = () => {
  assertIssueMigration();
  assertNoLaterAuthenticatedRegrant();
  assertBrowserDoesNotCallServiceOnlyFunctions();

  console.log(
    `RPC execute surface static checks passed: ${serviceRoleOnlyFunctions.length} service-role-only helper RPCs remain blocked from browser use.`
  );
};

main();
