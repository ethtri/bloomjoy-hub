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
    '202605200003_operator_revenue_snapshots.sql'
  ),
  helper: path.join(repoRoot, 'src', 'lib', 'operatorPayouts.ts'),
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
  'create table if not exists public.payout_period_machine_revenue_snapshots',
  'payout_revenue_snapshots_period_machine_idx',
  'operator_revenue_snapshot_source_values',
  'admin_generate_payout_revenue_snapshot',
  'admin_generate_payout_revenue_snapshots_for_period',
  'admin_override_payout_revenue_snapshot',
  'get_payout_revenue_snapshot_context',
  'rawProviderPayloadsIncluded',
  'sourceRowHashesIncluded',
  'missing_sales_source',
  'stale_sales_source',
  'negative_net_revenue_clamped',
  'manual_revenue_override',
  'Regeneration reason is required',
  'Manual revenue snapshot override reason is required',
  "adjustment.adjustment_type in ('refund', 'complaint_refund')",
  'eligible_commission_revenue_cents := greatest(net_revenue_cents, 0)',
  'revoke insert, update, delete on public.payout_period_machine_revenue_snapshots',
]) {
  expect(migration, snippet, 'revenue snapshot migration');
}

const helper = readText(files.helper);
for (const snippet of [
  'PayoutRevenueSnapshot',
  'fetchPayoutRevenueSnapshotContext',
  'generatePayoutRevenueSnapshotAdmin',
  'generatePayoutRevenueSnapshotsForPeriodAdmin',
  'overridePayoutRevenueSnapshotAdmin',
  'eligibleCommissionRevenueCents',
]) {
  if (!helper.includes(snippet)) {
    fail(`operatorPayouts helper missing ${snippet}`);
  }
}

const packageJson = readText(files.packageJson);
if (!packageJson.includes('operator-payouts:validate-revenue-snapshots')) {
  fail('package.json missing revenue snapshot validator script');
}

console.log(
  'Operator revenue snapshot static checks passed: sanitized snapshot schema, idempotent generation, manual override, warning metadata, and typed helpers are present.'
);
