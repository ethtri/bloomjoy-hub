#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (...parts) => fs.readFileSync(path.join(repoRoot, ...parts), 'utf8');
const migration = read('supabase', 'migrations', '20260821091000_refund_nayax_inventory.sql');
const portfolioCorrection = read('supabase', 'migrations', '20260822190000_refund_portfolio_intake_inventory_correction.sql');
const edge = read('supabase', 'functions', 'refund-nayax-inventory-sync', 'index.ts');
const intake = read('supabase', 'functions', 'refund-case-intake', 'index.ts');
const workflow = read('.github', 'workflows', 'refund-nayax-inventory-sync.yml');
const runbook = read('Docs', 'REFUND_NAYAX_INVENTORY_RUNBOOK.md');

const checks = [
  ['inventory is keyed by account plus immutable ID', /unique \(account_key, nayax_machine_id\)/i.test(migration)],
  ['three explicit reconciliation states are constrained', /reconciliation_state in \('published', 'needs_setup', 'excluded'\)/i.test(migration)],
  ['explicit exclusions require a reason', /refund_nayax_inventory_exclusion_reason_check/i.test(migration)],
  ['browser roles cannot execute inventory sync', /revoke execute on function public\.service_sync_refund_nayax_inventory[\s\S]*from public, anon, authenticated/i.test(migration)],
  ['only service role receives inventory sync', /grant execute on function public\.service_sync_refund_nayax_inventory[\s\S]*to service_role/i.test(migration)],
  ['run keys are unique and replayed', /run_key text not null unique/i.test(migration) && /'replayed', true/i.test(migration)],
  ['failed sync is recorded before snapshot processing', migration.indexOf('if not coalesce(p_succeeded, false)') < migration.indexOf('create temporary table')],
  ['two successful misses are required for inactive state', /missing_successful_snapshots \+ 1 >= 2/i.test(migration)],
  ['public intake remains independent of automatic Nayax readiness', !/refund_intake_enabled/i.test(
    portfolioCorrection.slice(
      portfolioCorrection.indexOf('create or replace function public.public_refund_machine_options()'),
      portfolioCorrection.indexOf('create or replace function public.service_refund_machine_is_public(')
    )
  )],
  ['cotton candy and Snapcase share the public path', /inventory\.refund_category in \('cotton_candy', 'snapcase'\)/i.test(migration)],
  ['Snapcase eligibility stays explicit while the Commercial Mini portfolio remains visible',
    /machine\.machine_type in \('commercial', 'mini'\)/i.test(portfolioCorrection)
      && /inventory\.refund_category = 'snapcase'/i.test(portfolioCorrection)],
  ['mapping gaps are corrected to needs setup instead of exclusions',
    /reconciliation_state = 'needs_setup'/i.test(portfolioCorrection)
      && /setup gaps are not exclusions/i.test(portfolioCorrection)],
  ['publication requires current manager routing', /One to three current Machine Managers are required before publishing/i.test(migration)],
  ['direct and QR intake share server eligibility', (intake.match(/service_refund_machine_is_public/g) ?? []).length === 2],
  ['Edge inventory has an independent default-off switch', /REFUND_NAYAX_INVENTORY_SYNC_ENABLED.*=== "true"/i.test(edge)],
  ['disabled Edge path reports zero writes', /status: "disabled"[\s\S]*writesApplied: 0/i.test(edge)],
  ['provider fetch occurs after the disabled gate', edge.indexOf('if (!enabled)') < edge.indexOf('await fetch(`${baseUrl}/machines')],
  ['every configured account uses a server token suffix', /NAYAX_LYNX_API_TOKEN_\$\{accountKey\}/.test(edge)],
  ['empty and duplicate snapshots fail closed', /empty_snapshot/.test(edge) && /duplicate_machine_id/.test(edge)],
  ['provider failures are durably recorded', /recordFailure\(runKey, accountKey, errorCode\)/.test(edge)],
  ['scheduled workflow is disabled by default', /SYNC_ENABLED:.*\|\| 'false'/.test(workflow)],
  ['large drops fail the workflow visibly', /largeDrop == true/.test(workflow) && /dropped by more than 20%/.test(workflow)],
  ['workflow logs only aggregate result fields', /\{accountKey,status,discoveredCount,activeCount,needsSetupCount,publishedCount,excludedCount,largeDrop,replayed,errorCode\}/.test(workflow)],
  ['runbook keeps Snapcase reporting provenance separate', /Keep their reporting\/payment source separate from Sunze/i.test(runbook)],
  ['runbook keeps production activation separate', /enable the hourly GitHub schedule as a separate production activation/i.test(runbook)],
  ['pilot exclusions remain explicit', /does not require TOTP, temporary operators, GPT, QR codes, Kexiazhan reporting, cash fallback, or a new SMS platform/i.test(runbook)],
];

for (const [label, passed] of checks) {
  assert.equal(passed, true, label);
  console.log(`PASS ${label}`);
}

console.log(`Refund Nayax inventory validation passed (${checks.length} assertions).`);
