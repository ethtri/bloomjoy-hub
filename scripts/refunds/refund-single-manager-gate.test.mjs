import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';

const root = new URL('../../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');
const migration = await read('supabase/migrations/20260913090000_refund_single_manager_gate.sql');
const edge = await read('supabase/functions/nayax-card-refund/index.ts');
const adminUpdate = await read('supabase/functions/refund-case-admin-update/index.ts');
const sweep = await read('supabase/functions/refund-case-automation-sweep/index.ts');
const outcome = await read('supabase/functions/refund-nayax-outcome-resolve/index.ts');
const official = await read('supabase/functions/_shared/refund-official-action.ts');
const portal = await read('src/pages/admin/Refunds.tsx');
const operations = await read('src/lib/refundOperations.ts');
const concurrency = await read('supabase/tests/refund_single_manager_gate_concurrency.sql');

test('one branch migration owns the single manager gate', async () => {
  await assert.rejects(access(new URL(
    'supabase/migrations/20260913153000_refund_system_saved_approval_boundary.sql', root,
  )));
  assert.match(migration, /admin_approve_selected_nayax_refund_for_system_v1/);
  assert.match(migration, /insert into public\.refund_case_official_action_authorizations[\s\S]*?'consumed'/);
  assert.match(migration, /insert into public\.refund_case_nayax_refund_attempts[\s\S]*?values\(c\.id,null,'request_and_approve','created'/);
  assert.match(migration, /insert into public\.refund_nayax_execution_contexts/);
  assert.match(migration, /refund_claim_exact_nayax_transaction/);
  assert.doesNotMatch(migration, /refund_nayax_system_saved_approval_receipts/);
  assert.doesNotMatch(migration, /backfill|legacy approval.*executable/i);
});

test('the existing attempt is the one claim and settlement boundary', () => {
  assert.match(migration, /service_claim_due_nayax_refund_attempts_v1/);
  assert.match(migration, /for update of attempt skip locked/);
  assert.match(migration, /service_reclaim_nayax_refund_attempt_no_call_v1[\s\S]*?transport_started/);
  assert.match(migration, /if transport_started then[\s\S]*?status='manual_review'[\s\S]*?provider_outcome='unknown'/);
  assert.match(migration, /if transport_started then[\s\S]*?status='created'/);
  assert.match(migration, /service_hold_nayax_refund_attempt_v1/);
  assert.equal((migration.match(/create or replace function public\.service_settle_nayax_refund_attempt\(/g) ?? []).length, 1);
  assert.doesNotMatch(migration, /service_settle_nayax_refund_attempt_legacy_v1/);
  assert.match(migration, /status='manual_review'[\s\S]*?reconciliation_required=true/);
  assert.match(migration, /safeRetryEligible',false/);
  assert.doesNotMatch(migration, /service_settle_nayax_system_saved_approval/);
});

test('the database serializes sessions and uniquely permits one queued refund per case', () => {
  assert.match(migration, /pg_advisory_xact_lock[\s\S]*?refund-card-approval/);
  assert.match(migration, /select \* into c from public\.refund_cases where id=p_case_id for update/);
  assert.match(migration, /create unique index if not exists refund_nayax_one_queued_attempt_per_case_idx/);
  assert.match(migration, /where actor_user_id is null and status in \('created','in_progress','ambiguous','manual_review','succeeded'\)/);
  assert.match(concurrency, /dblink_send_query\('single_gate_race_a'/);
  assert.match(concurrency, /dblink_send_query\('single_gate_race_b'/);
  assert.match(concurrency, /exactly one wins/);
  assert.match(concurrency, /a second queue consumer cannot claim the same attempt/);
});

test('case work and financial authority are distinct', () => {
  assert.match(migration, /admin_select_refund_nayax_candidate_current_user_v1/);
  assert.match(migration, /can_manage_refund_case_current_user\(p_case_id\)/);
  assert.match(migration, /return public\.service_select_refund_nayax_candidate_as_actor\(\s*actor_id/);
  assert.match(migration, /Only the assigned machine Manager or a Super-admin can approve this refund/);
  assert.match(adminUpdate, /admin_select_refund_nayax_candidate_current_user_v1/);
  const selectionCall = adminUpdate.match(/admin_select_refund_nayax_candidate_current_user_v1[\s\S]*?\n\s*\}\)/)?.[0] ?? '';
  assert.match(selectionCall, /p_case_id: caseId/);
  assert.doesNotMatch(selectionCall, /p_actor_user_id/);
});

test('System executes without a post-approval manager or browser continuation', () => {
  assert.match(sweep, /runNayaxRefundAttemptSweep/);
  assert.match(sweep, /service_claim_due_nayax_refund_attempts_v1/);
  assert.match(sweep, /service_settle_nayax_refund_attempt/);
  assert.match(sweep, /service_hold_nayax_refund_attempt_v1/);
  assert.match(edge, /admin_approve_selected_nayax_refund_for_system_v1/);
  assert.doesNotMatch(edge + sweep, /approve_pending_request|approval_continuation/);
  assert.doesNotMatch(sweep, /service_claim_due_nayax_approval_continuations_v1/);
  assert.match(migration, /guard_refund_nayax_execution_context_stage[\s\S]*?attempt\.actor_user_id is not null/);
  assert.doesNotMatch(
    migration.match(/create or replace function public\.guard_refund_nayax_execution_context_stage\([\s\S]*?\$\$;/)?.[0] ?? '',
    /can_perform_refund_official_action|reporting_machine_refund_managers/,
  );
});

test('approved-card read state is paired with its service-role caller only', () => {
  assert.match(edge, /\.rpc\("refund_nayax_approved_card_read_state_v1"/);
  assert.match(
    migration,
    /revoke all on function public\.refund_nayax_approved_card_read_state_v1\(uuid\)[\s\S]*?from public,anon,authenticated,service_role;[\s\S]*?grant execute on function public\.refund_nayax_approved_card_read_state_v1\(uuid\)[\s\S]*?to service_role;/,
  );
  assert.doesNotMatch(
    migration,
    /grant execute on function public\.refund_nayax_approved_card_read_state_v1\(uuid\)\s+to (?:public|anon|authenticated)/,
  );
});

test('current card UI exposes neither TOTP nor manual/retry completion', async () => {
  const current = edge + sweep + outcome + official + portal + operations;
  assert.doesNotMatch(current, /step_up_pending|provider_confirmed_retry_safe|documented_manual_completion|manualPortalAttempt|totp/i);
  for (const path of [
    'supabase/functions/refund-manager-action-step-up/index.ts',
    'supabase/functions/refund-manager-totp-enrollment/index.ts',
  ]) {
    await access(new URL(path, root));
    const tombstone = await read(path);
    assert.match(tombstone, /410/);
    assert.doesNotMatch(tombstone, /createClient|auth\.getUser|\.rpc\(/);
  }
  assert.match(outcome, /admin_record_nayax_system_outcome_evidence_v1/);
  assert.match(outcome, /provider_confirmed_success/);
  assert.match(outcome, /remain_on_hold/);
});

test('historical data stays private while legacy writers are absent', () => {
  assert.match(migration, /revoke all on table public\.refund_nayax_attempt_approval_continuations/);
  assert.match(migration, /revoke all on table public\.refund_nayax_pending_approval_recoveries/);
  assert.match(migration, /revoke all on function public\.service_reserve_nayax_refund_manager_action/);
  assert.match(migration, /revoke all on function public\.service_claim_due_nayax_approval_continuations_v1/);
  assert.match(migration, /service_recover_stale_nayax_refund_attempts\(text\)[\s\S]*?public,anon,authenticated,service_role/);
  assert.match(migration, /service_validate_nayax_controlled_pilot_postarm/);
  assert.match(migration, /admin_create_refund_manual_nayax_candidate/);
  assert.match(migration, /admin_prepare_refund_action_step_up_intent/);
  assert.match(migration, /service_compensate_refund_manager_totp_enrollment/);
  assert.match(migration, /drop function if exists public\.can_view_refund_system_finishing_status_v1/);
  assert.doesNotMatch(migration, /lane is retired|raise exception '.*retired/i);
});

test('RF-423906B2 exact saved candidate remains the refund authority', () => {
  assert.match(migration, /k\.amount_cents is not distinct from c\.matched_nayax_amount_cents/);
  assert.match(migration, /k\.card_last4 is not distinct from c\.matched_nayax_card_last4/);
  assert.match(migration, /refund_nayax_candidate_identifier_evidence_state/);
  assert.doesNotMatch(migration, /payment_amount_cents\s*=\s*selected\.amount_cents/);
});
