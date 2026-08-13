#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const migration = read(
  'supabase/migrations/202608130001_refund_nayax_outcome_resolution.sql'
);
const databaseTests = read('supabase/tests/refund_nayax_outcome_resolution.sql');
const concurrencyTests = read(
  'supabase/tests/refund_nayax_outcome_resolution_concurrency.sql'
);
const stepUpEdge = read('supabase/functions/refund-manager-action-step-up/index.ts');
const operations = read('src/lib/refundOperations.ts');
const portal = read('src/pages/admin/Refunds.tsx');
const portalUat = read('scripts/refunds/validate-refund-portal-uat.mjs');
const evidenceManifest = read('scripts/refunds/refund-uat-evidence.mjs');
const currentStatus = read('Docs/CURRENT_STATUS.md');
const decisions = read('Docs/DECISIONS.md');
const runbook = read('Docs/PRODUCTION_RUNBOOK.md');
const smoke = read('Docs/QA_SMOKE_TEST_CHECKLIST.md');
const providerNotes = read('Docs/NAYAX_LYNX_API.md');

const consumeStart = migration.indexOf(
  'create or replace function public.admin_consume_refund_nayax_resolution_intent('
);
const consumeEnd = migration.indexOf(
  'revoke execute on function public.refund_nayax_outcome_resolution_enabled()',
  consumeStart
);
const consume = migration.slice(consumeStart, consumeEnd);

assert(
  migration.includes('create or replace function public.refund_nayax_outcome_resolution_enabled()') &&
    migration.includes('select false;') &&
    migration.includes('refund_nayax_resolution_operators') &&
    !/insert into public\.refund_nayax_resolution_operators[\s\S]*values\s*\(/i.test(migration) &&
    !migration.includes('grant execute on function public.refund_nayax_outcome_resolution_enabled'),
  'Payment-support resolution must be hard off with no seeded operator or runtime setter.'
);

assert(
  migration.includes('alter table public.refund_nayax_resolution_operators enable row level security') &&
    migration.includes('alter table public.refund_nayax_resolution_intents enable row level security') &&
    migration.includes('alter table public.refund_nayax_outcome_resolutions enable row level security') &&
    migration.includes('refund_nayax_outcome_resolution_immutable') &&
    migration.includes('before update or delete on public.refund_nayax_outcome_resolutions') &&
    migration.includes("capability = 'payment_support_resolution'") &&
    migration.includes('user_is_active_refund_manager_only(p_user_id)'),
  'Private authorization, intent, and immutable evidence tables must stay privilege-locked and mapping-bound.'
);

assert(
  consumeStart >= 0 && consumeEnd > consumeStart &&
    consume.includes("pg_advisory_xact_lock(hashtextextended(current_actor_user_id::text, 767))") &&
    migration.includes('and current_user = database_owner') &&
    migration.includes('and current_user = resolver_owner') &&
    consume.includes("'provider_confirmed_success'") &&
    consume.includes("'documented_manual_completion'") &&
    consume.includes("normalized_result = 'provider_confirmed_retry_safe'") &&
    consume.includes("'providerCallMade', false") &&
    consume.includes("'customerMessageCreated', false") &&
    !consume.includes('http_post') &&
    !consume.includes('net.http') &&
    !consume.includes('fetch(') &&
    !consume.includes('gmail'),
  'Consume must use exact function-owner/actor serialization and commit no provider or customer side effect.'
);

assert(
  migration.includes("resolution_result = 'provider_confirmed_success'") &&
    migration.includes("evidence_type = 'nayax_dtm_transaction' and reason_code = 'nayax_dtm_settled'") &&
    migration.includes("evidence_type = 'nayax_support_ticket'") &&
    migration.includes("reason_code = 'nayax_support_confirmed_success'") &&
    migration.includes("resolution_result = 'provider_confirmed_retry_safe'") &&
    migration.includes("reason_code = 'nayax_support_retry_safe'") &&
    migration.includes("resolution_result = 'documented_manual_completion'") &&
    migration.includes("evidence_type = 'documented_manual_refund'") &&
    migration.includes("resolution_result = 'remain_on_hold'") &&
    migration.includes("evidence_reference ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{7,119}$'") &&
    migration.includes('attempt_evidence_hash'),
  'Only four exact evidence/result pairs and one bounded reference may be authorized.'
);

assert(
  databaseTests.includes('select plan(47)') &&
    databaseTests.includes('The default-off gate blocks preparation before any write') &&
    databaseTests.includes('A generic AAL2 token cannot replace the trusted exact-factor proof') &&
    databaseTests.includes('A session-local resolution ID cannot bypass the provider hold') &&
    databaseTests.includes('Success commits one reporting fact before any separately controlled customer message') &&
    databaseTests.includes('Documented manual completion commits the exact reference and one reporting fact') &&
    databaseTests.includes('Manual completion preserves the original rejected outcome and exact evidence classification'),
  'pgTAP must prove the default-off, factor-bound, immutable, zero-side-effect resolution boundary.'
);

assert(
  concurrencyTests.includes('select plan(9)') &&
    concurrencyTests.includes('dblink_send_query') &&
    concurrencyTests.includes('Exactly one database session can consume the same verified resolution intent') &&
    concurrencyTests.includes('The race commits exactly one immutable support-resolution record') &&
    concurrencyTests.includes('Concurrency creates one adjustment, no message, and no additional provider attempt') &&
    concurrencyTests.includes('Concurrent regression restores the production hard-off gate'),
  'Two-session pgTAP must prove one winner, one immutable result, and zero duplicate action.'
);

assert(
  stepUpEdge.includes('targetFunction === "refund-nayax-outcome-resolve"') &&
    stepUpEdge.includes('admin_get_refund_nayax_resolution_intent') &&
    stepUpEdge.includes('admin_refund_nayax_resolution_factor_is_approved') &&
    stepUpEdge.includes('service_mark_refund_nayax_resolution_factor_verified') &&
    stepUpEdge.includes('admin_consume_refund_nayax_resolution_intent') &&
    stepUpEdge.includes('The payment-support resolution could not be committed. The provider hold remains in place.'),
  'The shared step-up endpoint must use the dedicated frozen resolution and exact-factor RPC chain.'
);

assert(
  operations.includes("| 'nayax_resolve'") &&
    operations.includes("targetFunction: 'refund-nayax-outcome-resolve'") &&
    operations.includes("'admin_prepare_refund_nayax_resolution_intent'") &&
    portal.includes('data-testid="refund-nayax-resolution-panel"') &&
    portal.includes('data-testid="refund-nayax-resolution-result"') &&
    portal.includes('data-testid="refund-nayax-resolution-evidence-type"') &&
    portal.includes('data-testid="refund-nayax-resolution-reason"') &&
    portal.includes('data-testid="refund-nayax-resolution-reference"') &&
    portal.includes('It never calls Nayax,') &&
    portal.includes('retries a payment, or emails the customer.') &&
    !portal.includes('refund-nayax-resolution-recipient') &&
    !portal.includes('refund-nayax-resolution-body') &&
    !portal.includes('refund-nayax-resolution-retry'),
  'The manager surface must expose only structured evidence fields and no recipient, copy, retry, or provider control.'
);

assert(
  portalUat.includes("if (arg === '--nayax-resolution-only')") &&
    portalUat.includes('runNayaxResolutionChecks') &&
    portalUat.includes('Payment support sees exactly four structured outcomes and no arbitrary communication controls') &&
    portalUat.includes('Verified ${scenario.result} submits one frozen result with zero provider or customer calls') &&
    portalUat.includes('Payment-support verification remains usable without mobile horizontal overflow') &&
    evidenceManifest.includes("'refund-nayax-support-resolution-desktop.png'") &&
    evidenceManifest.includes("'refund-nayax-support-resolution-mobile.png'"),
  'Synthetic desktop/mobile UAT must prove structured support review and zero provider/customer side effects.'
);

assert(
  currentStatus.includes('P0 `#767` now has a default-off audited outcome-resolution candidate') &&
    decisions.includes('Uncertain Nayax outcomes require a separate immutable support decision (`#767`)') &&
    runbook.includes('Default-off Nayax outcome resolution (`#767`)') &&
    smoke.includes('npm run refunds:validate-nayax-resolution') &&
    providerNotes.includes('Transaction Status ID `12` as **Approved**') &&
    providerNotes.includes('do not remove the account-specific contract blocker'),
  'Status, decision, provider-contract, runbook, and QA docs must preserve the default-off launch boundary.'
);

console.log('Refund Nayax outcome-resolution boundary validated.');
