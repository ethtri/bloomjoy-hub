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
const behavioralFixture = await read('supabase/tests/refund_single_manager_gate.sql');
const durableLifecycle = await read('supabase/migrations/20260826165423_refund_durable_lifecycle_v1.sql');
const requestBoundaryContract = await read('supabase/migrations/20260906053800_refund_soft_time_evidence.sql');
const identifierContract = await read('supabase/migrations/20260906073000_refund_contactless_review_selection.sql');
const lookupPersistence = await read('supabase/functions/_shared/nayax-lookup-persistence.ts');
const attemptQueue = await read('supabase/functions/_shared/nayax-refund-attempt-queue.ts');

const jsonbBuildObjectArgumentCounts = (sql) => {
  const counts = [];
  const needle = 'jsonb_build_object(';
  let offset = 0;
  while ((offset = sql.indexOf(needle, offset)) >= 0) {
    let depth = 1;
    let inString = false;
    let argumentCount = 1;
    let index = offset + needle.length;
    for (; index < sql.length && depth > 0; index += 1) {
      const character = sql[index];
      if (inString) {
        if (character === "'" && sql[index + 1] === "'") index += 1;
        else if (character === "'") inString = false;
      } else if (character === "'") inString = true;
      else if (character === '(') depth += 1;
      else if (character === ')') depth -= 1;
      else if (character === ',' && depth === 1) argumentCount += 1;
    }
    assert.equal(depth, 0, 'jsonb_build_object call must close');
    counts.push(argumentCount);
    offset = index;
  }
  return counts;
};

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
  assert.match(concurrency, /a second queue consumer cannot claim the same generation/);
  assert.match(
    migration,
    /official_action_version is distinct from p_expected_case_version then[\s\S]*?reload before approving the refund'[\s\S]*?using errcode='P4620'/,
  );
  assert.match(concurrency, /payload->>'sqlstate'='P4620'/);
});

test('database fixtures use an allowed completed-review lookup status', () => {
  const constraintBody = durableLifecycle.match(
    /add constraint refund_cases_nayax_lookup_status_check check \(\s*nayax_lookup_status in \(([\s\S]*?)\)\s*\)/,
  )?.[1] ?? '';
  const allowedStatuses = new Set(
    [...constraintBody.matchAll(/'([^']+)'/g)].map((match) => match[1]),
  );
  assert(allowedStatuses.has('manual_exception'));
  for (const [name, fixture] of [
    ['behavioral', behavioralFixture],
    ['concurrency', concurrency],
  ]) {
    const seededLookupStatuses = [...fixture.matchAll(/'([^']+)'\s*,\s*'not_requested'/g)]
      .map((match) => match[1]);
    assert.deepEqual(seededLookupStatuses,
      name === 'behavioral' ? ['manual_exception', 'checking', 'manual_exception'] : ['manual_exception'],
      `${name} fixture lookup status`);
    assert(seededLookupStatuses.every((status) => allowedStatuses.has(status)));
  }
});

test('database fixtures satisfy the real null-request boundary contract', () => {
  const nullRequestBranch = requestBoundaryContract.match(
    /if p_request_received_at is null then([\s\S]*?)return 'invalid';/,
  )?.[1] ?? '';
  const requiredNullKeys = [
    ...nullRequestBranch.matchAll(/p_evidence -> '([^']+)' = 'null'::jsonb/g),
  ].map((match) => match[1]);
  assert.deepEqual(requiredNullKeys, [
    'customer_request_received_at',
    'customer_request_received_source',
    'transaction_occurrence_proof_source',
    'transaction_occurrence_timestamp_source',
    'transaction_occurrence_timezone_basis',
    'transaction_occurrence_lower_bound_at',
    'transaction_occurrence_upper_bound_at',
    'request_receipt_lower_bound_at',
    'request_receipt_upper_bound_at',
  ]);
  for (const [name, fixture] of [
    ['behavioral', behavioralFixture],
    ['concurrency', concurrency],
  ]) {
    for (const key of requiredNullKeys) {
      assert.equal(
        [...fixture.matchAll(new RegExp(`'${key}'\\s*,\\s*null`, 'g'))].length,
        1,
        `${name} fixture must carry JSON null for ${key}`,
      );
    }
    assert.match(fixture, /'request_time_boundary'\s*,\s*'request_time_unknown'/);
    assert.match(fixture, /'transaction_occurrence_comparable'\s*,\s*false/);
    assert.match(fixture, /'transaction_occurrence_semantics'\s*,\s*'unknown'/);
    assert.match(fixture, /'one_click_eligible'\s*,\s*false/);
  }
});

test('database fixtures satisfy exact-card support and unknown-time rules', () => {
  assert.match(
    identifierContract,
    /case_row\.card_last4 = p_card_last4[\s\S]*?card_last4_comparison' is distinct from 'exact_support'/,
  );
  assert.match(
    identifierContract,
    /review_state = 'exact_support' and last4_comparison <> 'exact_support'/,
  );
  assert.match(
    identifierContract,
    /elsif p_evidence -> 'time_delta_minutes' is distinct from 'null'::jsonb then/,
  );
  for (const [name, fixture] of [
    ['behavioral', behavioralFixture],
    ['concurrency', concurrency],
  ]) {
    assert.match(fixture, /'card_last4_comparison'\s*,\s*'exact_support'/, name);
    assert.match(fixture, /'identifier_review_state'\s*,\s*'exact_support'/, name);
    assert.match(fixture, /'transaction_occurrence_comparable'\s*,\s*false/, name);
    assert.match(fixture, /'time_delta_minutes'\s*,\s*null/, name);
  }
});

test('fixture evidence constructors stay below PostgreSQL argument limits', () => {
  const evidenceBuilders = [
    ['behavioral', behavioralFixture.match(
      /create function pg_temp\.exact_evidence[\s\S]*?as \$\$([\s\S]*?)\$\$;/,
    )?.[1] ?? ''],
    ['concurrency', concurrency.match(
      /values\('b3480000-0000-4000-8000-000000000001'[\s\S]*?(jsonb_build_object\([\s\S]*?\))\s*,\s*now\(\)\+interval '1 hour'/,
    )?.[1] ?? ''],
  ];
  for (const [name, builder] of evidenceBuilders) {
    const counts = jsonbBuildObjectArgumentCounts(builder);
    assert(counts.length >= 2, `${name} evidence must remain split across constructors`);
    assert(counts.every((count) => count > 0 && count <= 100 && count % 2 === 0),
      `${name} jsonb_build_object argument counts: ${counts.join(', ')}`);
  }
});

test('standalone completion owns its Gmail thread seed after the generator cut', () => {
  const generatorCut = behavioralFixture.indexOf('create temp table second_claim as');
  const gmailThreadSeed = behavioralFixture.indexOf('insert into public.refund_gmail_threads');
  const successResolution = behavioralFixture.indexOf("'generation two settles through the canonical settlement function'");
  assert(generatorCut >= 0);
  assert(gmailThreadSeed > generatorCut);
  assert(gmailThreadSeed < successResolution);
  assert.doesNotMatch(behavioralFixture.slice(0, generatorCut), /insert into public\.refund_gmail_threads/);
});

test('outcome evidence timestamps cannot predate work performed in the statement', () => {
  const outcomeEvidenceSection = behavioralFixture.slice(
    behavioralFixture.indexOf('public.admin_record_nayax_system_outcome_evidence_v1('),
  );
  assert.equal(
    [...outcomeEvidenceSection.matchAll(/DTM:NAYAX-123456789',statement_timestamp\(\)/g)].length,
    4,
  );
  assert.doesNotMatch(outcomeEvidenceSection, /DTM:NAYAX-123456789',now\(\)/);
  assert.match(outcomeEvidenceSection, /DTM:NAYAX-123456789','2026-09-01T00:00:00Z'/);
});

test('routine clear matches are System-preselected while ambiguous selection remains human case work', () => {
  assert.match(lookupPersistence, /service_commit_refund_nayax_lookup_and_preselect_v1/);
  assert.match(migration, /p_actor_user_id is not null[\s\S]*?p_trigger_source not in \('automatic','scheduled'\)/);
  assert.match(migration, /k\.actor_user_id is null[\s\S]*?recommendation_state'='high_confidence'[\s\S]*?one_click_eligible'='true'/);
  assert.match(migration, /nayax_match_preselected[\s\S]*?provider_amount_cents',candidate\.amount_cents/);
  assert.match(migration, /create or replace function public\.refund_case_nayax_manager_readiness[\s\S]*?nayax_match_preselected[\s\S]*?approvalContinuationReady',false/);
  assert.match(migration, /Clear System matches are read-only; choose only among ambiguous results/);
  assert.match(sweep, /nayax_clear_match_preselected[\s\S]*?continue;/);
  assert.match(portal, /System found one clear transaction/);
  assert.match(migration, /admin_dispute_refund_nayax_preselection_current_user_v1/);
  assert.match(migration, /nayax_match_preselection_disputed[\s\S]*?provider_call_made',false[\s\S]*?approval_created',false/);
  assert.match(migration, /grant execute on function public\.admin_dispute_refund_nayax_preselection_current_user_v1\(uuid,bigint\)[\s\S]*?to authenticated/);
});

test('provider continuation is generation-scoped on the same authorized attempt', () => {
  assert.match(migration, /provider_execution_generation integer not null default 1/);
  assert.match(migration, /execution_plan text not null default 'request_and_approve'/);
  assert.match(migration, /refund_nayax_provider_stage_once_idx[\s\S]*?provider_execution_generation/);
  assert.match(migration, /refund_nayax_no_refund_proofs[\s\S]*?frozen_execution_context_hash[\s\S]*?prior_provider_outcome[\s\S]*?prior_safe_transport_stage/);
  assert.match(migration, /provider_confirmed_no_refund[\s\S]*?provider_execution_generation=next_generation[\s\S]*?official_action_authorization_id/);
  assert.match(migration, /provider_execution_generation=a\.provider_execution_generation[\s\S]*?stage='approve'/);
  assert.match(attemptQueue, /providerExecutionGeneration[\s\S]*?executionPlan/);
  assert.match(sweep, /executionPlan === "approve_only"[\s\S]*?executeNayaxRefundApprovalOnly/);
  assert.match(behavioralFixture, /old generation claim token is rejected/);
  assert.match(behavioralFixture, /journal stage uniqueness is scoped by provider execution generation/);
});

test('approval selection evidence is bound to the current exact candidate', () => {
  assert.match(migration, /e\.event_type='nayax_match_selected'[\s\S]*?candidate_token'=selected\.token::text[\s\S]*?candidate_evidence_hash'=candidate_hash[\s\S]*?lookup_generation'=c\.nayax_lookup_generation::text/);
  assert.match(migration, /''candidate_token'', candidate\.token[\s\S]*?''candidate_evidence_hash'', public\.refund_nayax_candidate_evidence_hash/);
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
  const evidenceRpc = migration.match(/create or replace function public\.admin_record_nayax_system_outcome_evidence_v1\([\s\S]*?\n\$\$;/)?.[0] ?? '';
  assert.match(evidenceRpc, /refund_nayax_system_success_evidence/);
  assert.match(evidenceRpc, /authorizationMethod','original_manager_approval'/);
  assert.doesNotMatch(evidenceRpc, /admin_resolve_refund_nayax_outcome_manager_session_pre_ops_v1|refund_nayax_resolution_intents/);
  assert.match(migration, /alter table public\.refund_nayax_system_success_evidence enable row level security/);
  assert.match(migration, /alter table public\.refund_nayax_no_refund_proofs enable row level security/);
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
