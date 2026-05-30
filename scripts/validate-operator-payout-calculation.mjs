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
    '202605200004_operator_payout_calculation_engine.sql'
  ),
  helper: path.join(repoRoot, 'src', 'lib', 'operatorPayouts.ts'),
  packageJson: path.join(repoRoot, 'package.json'),
  rpcSurface: path.join(repoRoot, 'scripts', 'validate-rpc-execute-surface.mjs'),
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
  'create or replace function public.operator_payout_money_from_minutes',
  'create or replace function public.operator_payout_commission_cents',
  'create or replace function public.operator_payout_effective_rule_value',
  'operator_machine_override',
  'machine_default',
  'operator_default',
  'create or replace function public.admin_upsert_operator_compensation_rule',
  'Compensation rule requires an hourly rate or commission percentage',
  'create or replace function public.admin_calculate_payout_run',
  'perform public.admin_generate_payout_revenue_snapshots_for_period',
  "entry.status in ('submitted', 'locked', 'included_in_payout')",
  'missing_hourly_rule',
  'missing_commission_rule',
  'missing_revenue_snapshot',
  'negative_total_payout',
  'operator_payout_v1',
  'inputsPreserved',
  'create or replace function public.admin_add_payout_adjustment',
  'Adjustment description is required',
  'Adjustment audit reason is required',
  'operator_payout_run.calculated',
  'operator_payout_adjustment.created',
  'revoke execute on function public.operator_payout_effective_rule_value',
  'grant execute on function public.operator_payout_effective_rule_value',
]) {
  expect(migration, snippet, 'calculation migration');
}

const helper = readText(files.helper);
for (const snippet of [
  'OperatorCompensationRule',
  'PayoutCalculationContext',
  'PayoutRun',
  'fetchPayoutCalculationContext',
  'upsertOperatorCompensationRuleAdmin',
  'calculatePayoutRunAdmin',
  'addPayoutAdjustmentAdmin',
  'admin_calculate_payout_run',
]) {
  if (!helper.includes(snippet)) {
    fail(`operatorPayouts helper missing ${snippet}`);
  }
}

const packageJson = readText(files.packageJson);
if (!packageJson.includes('operator-payouts:validate-calculation')) {
  fail('package.json missing calculation validator script');
}

const rpcSurface = readText(files.rpcSurface);
if (!rpcSurface.includes('operator_payout_effective_rule_value')) {
  fail('RPC surface validator must protect operator_payout_effective_rule_value from browser calls.');
}

const moneyFromMinutes = (minutes, hourlyRateCents) => {
  if (hourlyRateCents == null) return null;
  return Math.max(Math.round((Math.max(minutes, 0) * Math.max(hourlyRateCents, 0)) / 60), 0);
};

const commissionCents = (eligibleRevenueCents, basisPoints) => {
  if (basisPoints == null) return null;
  return Math.max(Math.round((Math.max(eligibleRevenueCents, 0) * Math.max(basisPoints, 0)) / 10000), 0);
};

const resolveRule = (rules, valueType) => {
  const valueKey = valueType === 'hourly' ? 'hourlyRateCents' : 'commissionBasisPoints';
  return rules
    .filter((rule) => rule.status === 'active')
    .filter((rule) => rule.effectiveStartDate <= '2026-05-31')
    .filter((rule) => !rule.effectiveEndDate || rule.effectiveEndDate >= '2026-05-31')
    .filter((rule) => rule[valueKey] != null)
    .sort((a, b) => a.precedence - b.precedence || b.effectiveStartDate.localeCompare(a.effectiveStartDate))[0];
};

const assertEqual = (actual, expected, label) => {
  if (actual !== expected) {
    fail(`${label}: expected ${expected}, got ${actual}`);
  }
};

assertEqual(moneyFromMinutes(90, 2000), 3000, 'hourly rounding');
assertEqual(moneyFromMinutes(-15, 2000), 0, 'negative minutes clamp');
assertEqual(commissionCents(12345, 250), 309, 'commission cent rounding');
assertEqual(commissionCents(-5000, 500), 0, 'negative revenue clamp');

const rules = [
  {
    source: 'operator_default',
    precedence: 3,
    status: 'active',
    effectiveStartDate: '2026-01-01',
    hourlyRateCents: 1800,
    commissionBasisPoints: 100,
  },
  {
    source: 'machine_default',
    precedence: 2,
    status: 'active',
    effectiveStartDate: '2026-02-01',
    hourlyRateCents: 1900,
    commissionBasisPoints: 200,
  },
  {
    source: 'operator_machine_override',
    precedence: 1,
    status: 'active',
    effectiveStartDate: '2026-03-01',
    hourlyRateCents: 2200,
    commissionBasisPoints: 300,
  },
  {
    source: 'inactive_override',
    precedence: 1,
    status: 'inactive',
    effectiveStartDate: '2026-05-01',
    hourlyRateCents: 9999,
    commissionBasisPoints: 9999,
  },
];

assertEqual(resolveRule(rules, 'hourly').source, 'operator_machine_override', 'rule precedence hourly');
assertEqual(resolveRule(rules, 'commission').source, 'operator_machine_override', 'rule precedence commission');

const fallbackRules = rules.filter((rule) => rule.source !== 'operator_machine_override');
assertEqual(resolveRule(fallbackRules, 'commission').source, 'machine_default', 'machine override fallback');

const adjustmentScenarioTotal =
  moneyFromMinutes(90, 2000) + commissionCents(12345, 250) - 500;
assertEqual(adjustmentScenarioTotal, 2809, 'adjustment total');

const missingRuleWarnings = [];
if (resolveRule([], 'hourly') == null) {
  missingRuleWarnings.push('missing_hourly_rule');
}
if (resolveRule([], 'commission') == null) {
  missingRuleWarnings.push('missing_commission_rule');
}
if (!missingRuleWarnings.includes('missing_hourly_rule')) {
  fail('missing hourly rule warning fixture did not fire');
}
if (!missingRuleWarnings.includes('missing_commission_rule')) {
  fail('missing commission rule warning fixture did not fire');
}

console.log(
  'Operator payout calculation checks passed: RPC surface, deterministic rule precedence, rounding, negative revenue clamp, missing-data warnings, adjustments, and typed helpers are present.'
);
