import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

const [
  lookup,
  recommendation,
  cardRefund,
  adminUpdate,
  managerPage,
  managerState,
  migration,
  workflow,
  providerContract,
] = await Promise.all([
  read('supabase/functions/_shared/nayax-lookup.ts'),
  read('supabase/functions/_shared/nayax-recommendation.mjs'),
  read('supabase/functions/nayax-card-refund/index.ts'),
  read('supabase/functions/refund-case-admin-update/index.ts'),
  read('src/pages/admin/Refunds.tsx'),
  read('src/lib/refundManagerState.ts'),
  read('supabase/migrations/20260928173542_remove_redundant_nayax_cross_case_guard.sql'),
  read('Docs/REFUND_WORKFLOW.md'),
  read('Docs/NAYAX_REFUND_WORKING_CONTRACT.md'),
]);

test('current Nayax lookup and selection do not derive a card block from another case', () => {
  assert.doesNotMatch(lookup, /loadNayaxTransactionStates/);
  assert.doesNotMatch(recommendation, /hardExclusions\.push\("duplicate_transaction"\)/);
  assert.doesNotMatch(adminUpdate, /nayaxTransactionIsLinkedElsewhere/);
  assert.doesNotMatch(adminUpdate, /already linked to another refund case/);
});

test('the card execution boundary keeps same-case preflight without a cross-case block', () => {
  assert.doesNotMatch(cardRefund, /getDuplicateTransactionBlocks/);
  assert.match(cardRefund, /service_get_refund_nayax_transaction_preflight/);
  assert.match(cardRefund, /reason === "payment_already_confirmed"/);
  assert.doesNotMatch(cardRefund, /\[reason === "payment_already_confirmed" \? "already_refunded" : "duplicate_transaction"\]/);
  assert.match(cardRefund, /admin_approve_selected_nayax_refund_for_system_v1/);
});

test('database allocation is per case while same-case idempotency and receipts remain', () => {
  assert.match(migration, /drop index if exists public\.refund_cases_unique_matched_nayax_transaction_id_idx/);
  assert.match(migration, /drop index if exists public\.refund_nayax_transaction_allocations_active_exact_idx/);
  assert.match(
    migration,
    /account_scope, provider_machine_id, original_transaction_id, refund_case_id[\s\S]*?where allocation_state <> 'released'/,
  );
  assert.match(
    migration,
    /and refund_case_id = p_case_id[\s\S]*?and allocation_state <> 'released'[\s\S]*?for update/,
  );
  assert.match(migration, /where receipt\.refund_case_id = p_case_id/);
  assert.doesNotMatch(migration, /exact_transaction_allocated|related_case_uses_transaction/);
  assert.match(migration, /refund_case_nayax_manager_readiness/);
  assert.match(migration, /can_prepare_nayax_refund_execution/);
  assert.match(migration, /service_apply_refund_official_case_update/);
  assert.match(migration, /refund_nayax_retry_safe_case_is_current/);
  assert.match(migration, /refund_nayax_evidence_only_start_is_safe/);
  assert.match(migration, /admin_record_refund_authoritative_receipt/);
  assert.match(migration, /service_commit_refund_nayax_lookup_and_preselect_v1/);
  assert.match(migration, /refund_reviewed_card_candidate_safe_v1/);
  assert.match(migration, /allocation\.refund_case_id=c\.id/);
  assert.match(migration, /allocation\.refund_case_id = c\.id/);
});

test('duplicate-specific Manager blocks are removed from the rendered card flow', () => {
  assert.doesNotMatch(managerPage, /already linked to another refund case/);
  assert.doesNotMatch(managerPage, /already reserved by another refund case/);
  assert.doesNotMatch(managerState, /linked to another refund case/);
});

test('the written contract names the provider limit and preserves same-case safety', () => {
  assert.match(workflow, /Nayax owns the\s+authoritative limit that refund totals cannot exceed the original purchase/);
  assert.match(workflow, /same-case idempotency/);
  assert.match(providerContract, /Do not add a cross-case card block/);
  assert.match(providerContract, /same-attempt idempotency/);
});
