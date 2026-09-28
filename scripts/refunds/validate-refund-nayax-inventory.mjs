#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (...parts) => fs.readFileSync(path.join(repoRoot, ...parts), 'utf8');
const migration = read('supabase', 'migrations', '20260821091000_refund_nayax_inventory.sql');
const recipientRouteV2 = read('supabase', 'migrations', '20260825231621_refund_manager_recipient_route_v2.sql');
const readerReplacement = read('supabase', 'migrations', '20260928050000_nayax_reader_replacement.sql');
const portfolioCorrection = read('supabase', 'migrations', '20260822190000_refund_portfolio_intake_inventory_correction.sql');
const edge = read('supabase', 'functions', 'refund-nayax-inventory-sync', 'index.ts');
const intake = read('supabase', 'functions', 'refund-case-intake', 'index.ts');
const workflow = read('.github', 'workflows', 'refund-nayax-inventory-sync.yml');
const runbook = read('Docs', 'REFUND_NAYAX_INVENTORY_RUNBOOK.md');
const machinesPage = read('src', 'pages', 'admin', 'Machines.tsx');
const refundOperations = read('src', 'lib', 'refundOperations.ts');

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
  ['publication requires one-to-four current manager routing',
    /public\.admin_reconcile_refund_nayax_machine\(uuid,text,text,uuid,text,text\)/i.test(recipientRouteV2)
      && /replace\(revised, '> 3', '> 4'\)/i.test(recipientRouteV2)
      && /Supports one to four distinct active managers/i.test(recipientRouteV2)],
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
  ['runbook is subordinate to the canonical workflow', /subordinate to[\s\S]*REFUND_WORKFLOW\.md/i.test(runbook)],
  ['runbook keeps inventory from becoming a case gate', /cannot add a customer[\s\S]*Manager approval[\s\S]*account-wide payment gate/i.test(runbook)],
  ['runbook retires pilot and activation ceremony', /Do not create a pilot cohort, owner ceremony, live-refund canary, or separate\s+Manager approval/i.test(runbook)],
  ['reader replacement is one audited atomic RPC',
    /create or replace function public\.admin_replace_refund_nayax_machine/i.test(readerReplacement)
      && /reporting_machine\.nayax_reader\.replaced/i.test(readerReplacement)],
  ['replacement candidates are constrained to active current unlinked same-account inventory',
    /candidate\.accountKey === inventoryMachine\.accountKey/i.test(machinesPage)
      && /candidate\.providerActive/i.test(machinesPage)
      && /candidate\.missingSuccessfulSnapshots === 0/i.test(machinesPage)
      && /!candidate\.reportingMachineId/i.test(machinesPage)],
  ['replacement preserves the existing authority boundary and historical rows',
    /preserved_authority_start := machine\.nayax_card_sales_started_on/i.test(readerReplacement)
      && /nayax_card_sales_started_on = preserved_authority_start/i.test(readerReplacement)
      && !/delete from public\.refund_/i.test(readerReplacement)],
  ['replacement preserves the existing customer intake setting',
    !/refund_intake_enabled/i.test(readerReplacement)],
  ['replacement validates ready state before commit',
    /Replacement mapping did not pass readiness verification/i.test(readerReplacement)],
  ['ordinary save timeout tells the operator that nothing was saved',
    /The change took too long and was not saved/i.test(refundOperations)
      && /role=\{saveNotice\.kind === 'error' \? 'alert' : 'status'\}/i.test(machinesPage)],
  ['replacement UI explains historical linkage',
    /old reader stays attached to its historical sales and refund records/i.test(machinesPage)],
  ['replacement UI shows the exact old and selected Nayax IDs before save',
    /Confirm Nayax ID change:[\s\S]*inventoryMachine\.nayaxMachineId[\s\S]*selectedReplacement\.nayaxMachineId/i.test(machinesPage)],
  ['machine refund setup links existing readers directly to focused replacement review',
    /Review reader replacement/i.test(machinesPage)
      && /inventory\?externalMachineId=\$\{encodeURIComponent\(refundManagerSetup\.nayaxMachineId\)\}/i.test(machinesPage)
      && /hardware swap that kept Nayax ID/i.test(machinesPage)],
  ['mapped readers keep the replacement path visible when provider inventory has no candidate',
    /No eligible replacement is in the latest inventory/i.test(machinesPage)
      && /const canReplace = inventoryMachine\.state === 'published'\s*&& Boolean\(inventoryMachine\.reportingMachineId\)/i.test(machinesPage)],
];

for (const [label, passed] of checks) {
  assert.equal(passed, true, label);
  console.log(`PASS ${label}`);
}

console.log(`Refund Nayax inventory validation passed (${checks.length} assertions).`);
