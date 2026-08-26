begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(38);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  (
    '00000000-0000-0000-0000-000000000000',
    'b0000000-0000-4000-8000-000000000001',
    'authenticated', 'authenticated', 'durable-manager@example.invalid', '',
    now(), '{}'::jsonb, '{}'::jsonb, now(), now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    'b0000000-0000-4000-8000-000000000002',
    'authenticated', 'authenticated', 'durable-unrelated@example.invalid', '',
    now(), '{}'::jsonb, '{}'::jsonb, now(), now()
  );

insert into public.customer_accounts (id, name, account_type)
values (
  'b1000000-0000-4000-8000-000000000001',
  'Durable refund lifecycle test',
  'customer'
);

insert into public.reporting_locations (id, account_id, name, timezone)
values (
  'b2000000-0000-4000-8000-000000000001',
  'b1000000-0000-4000-8000-000000000001',
  'Durable lifecycle location',
  'America/Los_Angeles'
);

insert into public.reporting_machines (
  id, account_id, location_id, machine_label
) values (
  'b3000000-0000-4000-8000-000000000001',
  'b1000000-0000-4000-8000-000000000001',
  'b2000000-0000-4000-8000-000000000001',
  'Durable lifecycle machine'
);

insert into public.reporting_machine_refund_managers (
  id, reporting_machine_id, manager_user_id, manager_email, grant_reason
) values (
  'b3500000-0000-4000-8000-000000000001',
  'b3000000-0000-4000-8000-000000000001',
  'b0000000-0000-4000-8000-000000000001',
  'durable-manager@example.invalid',
  'Durable lifecycle authorization fixture'
);

insert into public.refund_cases (
  id, public_reference, reporting_machine_id, reporting_location_id,
  customer_email, issue_summary, incident_at, payment_method,
  payment_amount_cents, refund_amount_cents, card_last4, status,
  correlation_status, correlation_source, automation_state
) values
  (
    'b4000000-0000-4000-8000-000000000001', 'RF-DURABLE-LOOKUP',
    'b3000000-0000-4000-8000-000000000001',
    'b2000000-0000-4000-8000-000000000001',
    'durable-lookup@example.invalid', 'Durable lookup fixture',
    statement_timestamp() - interval '30 minutes', 'card', 700, 700,
    '4242', 'needs_review', 'needs_nayax', 'nayax', 'under_review'
  ),
  (
    'b4000000-0000-4000-8000-000000000002', 'RF-DURABLE-NOCALL',
    'b3000000-0000-4000-8000-000000000001',
    'b2000000-0000-4000-8000-000000000001',
    'durable-nocall@example.invalid', 'Interrupted before transport fixture',
    statement_timestamp() - interval '35 minutes', 'card', 700, 700,
    '4242', 'card_refund_pending', 'matched', 'nayax', 'approved'
  ),
  (
    'b4000000-0000-4000-8000-000000000003', 'RF-DURABLE-HOLD',
    'b3000000-0000-4000-8000-000000000001',
    'b2000000-0000-4000-8000-000000000001',
    'durable-hold@example.invalid', 'Interrupted after transport fixture',
    statement_timestamp() - interval '40 minutes', 'card', 700, 700,
    '4242', 'card_refund_pending', 'matched', 'nayax', 'approved'
  );

update public.refund_cases
set decision = 'approved', nayax_refund_execution_status = 'requested'
where id in (
  'b4000000-0000-4000-8000-000000000002',
  'b4000000-0000-4000-8000-000000000003'
);

create temporary table lookup_results (
  result_key text primary key,
  result jsonb not null
);

insert into lookup_results values (
  'generation_one',
  public.service_begin_refund_nayax_lookup(
    'b4000000-0000-4000-8000-000000000001', 1, 'manual', null
  )
);

select is(
  (select (result ->> 'lookupGeneration')::integer from lookup_results
    where result_key = 'generation_one'),
  1,
  'The first lookup claims generation one'
);
select is(
  (select nayax_lookup_status from public.refund_cases
    where id = 'b4000000-0000-4000-8000-000000000001'),
  'checking',
  'A claimed lookup publishes the checking state immediately'
);

insert into public.refund_nayax_lookup_candidates (
  token, refund_case_id, reporting_machine_id, provider_transaction_id,
  site_id, machine_authorization_time, amount_cents, card_last4,
  currency_code, evidence_summary, expires_at, lookup_generation
) values (
  'b5000000-0000-4000-8000-000000000001',
  'b4000000-0000-4000-8000-000000000001',
  'b3000000-0000-4000-8000-000000000001',
  'DURABLE-TXN-OLD-001', 101, statement_timestamp() - interval '30 minutes',
  700, '4242', 'USD', '{"selection_allowed":true}'::jsonb,
  statement_timestamp() + interval '30 minutes', 1
);

insert into lookup_results values (
  'generation_two',
  public.service_begin_refund_nayax_lookup(
    'b4000000-0000-4000-8000-000000000001', 1, 'manual', null
  )
);
select is(
  (select (result ->> 'lookupGeneration')::integer from lookup_results
    where result_key = 'generation_two'),
  2,
  'A newer request receives the next lookup generation'
);

insert into public.refund_nayax_lookup_candidates (
  token, refund_case_id, reporting_machine_id, provider_transaction_id,
  site_id, machine_authorization_time, amount_cents, card_last4,
  currency_code, evidence_summary, expires_at, lookup_generation
) values (
  'b5000000-0000-4000-8000-000000000002',
  'b4000000-0000-4000-8000-000000000001',
  'b3000000-0000-4000-8000-000000000001',
  'DURABLE-TXN-NEW-002', 102, statement_timestamp() - interval '29 minutes',
  700, '4242', 'USD', '{"selection_allowed":true}'::jsonb,
  statement_timestamp() + interval '30 minutes', 2
);

insert into lookup_results values (
  'old_commit',
  public.service_commit_refund_nayax_lookup(
    'b4000000-0000-4000-8000-000000000001', 1, 1,
    'match_found', 'high_confidence', 'durable-test-v1',
    statement_timestamp(), 'Old result must not win.', null, 1, 'manual', null
  )
);
select is(
  (select (result ->> 'applied')::boolean from lookup_results
    where result_key = 'old_commit'),
  false,
  'An older lookup generation cannot publish its result'
);
select is(
  (select count(*)::integer from public.refund_nayax_lookup_candidates
    where token = 'b5000000-0000-4000-8000-000000000001'),
  0,
  'A stale generation removes only its own candidate evidence'
);

insert into lookup_results values (
  'current_commit',
  public.service_commit_refund_nayax_lookup(
    'b4000000-0000-4000-8000-000000000001', 2, 1,
    'match_found', 'high_confidence', 'durable-test-v1',
    statement_timestamp(), 'One exact candidate is ready for confirmation.',
    null, 1, 'manual', null
  )
);
select is(
  (select (result ->> 'applied')::boolean from lookup_results
    where result_key = 'current_commit'),
  true,
  'Only the current lookup generation can publish'
);
select is(
  (select nayax_lookup_status from public.refund_cases
    where id = 'b4000000-0000-4000-8000-000000000001'),
  'match_found',
  'The committed lookup state is durable'
);
select is(
  public.refund_lifecycle_contract(
    'b4000000-0000-4000-8000-000000000001'
  ) ->> 'stage',
  'needs_transaction_selection',
  'The lifecycle contract directs the manager to select the transaction'
);
select is(
  public.refund_lifecycle_contract(
    'b4000000-0000-4000-8000-000000000001'
  ) ->> 'schemaVersion',
  'refund_lifecycle_v1',
  'The lifecycle contract is explicitly versioned'
);
select is(
  (public.refund_lifecycle_contract(
    'b4000000-0000-4000-8000-000000000001'
  ) ->> 'payloadRedacted')::boolean,
  true,
  'The lifecycle contract identifies its redacted boundary'
);

select ok(
  not has_function_privilege(
    'anon', 'public.refund_lifecycle_contract(uuid)', 'execute'
  ) and not has_function_privilege(
    'authenticated', 'public.refund_lifecycle_contract(uuid)', 'execute'
  ),
  'Browser roles cannot call the internal lifecycle projection'
);
select ok(
  has_function_privilege(
    'authenticated', 'public.get_refund_lifecycle_for_manager(uuid)', 'execute'
  ) and not has_function_privilege(
    'anon', 'public.get_refund_lifecycle_for_manager(uuid)', 'execute'
  ),
  'Only authenticated users receive the revalidated manager lifecycle RPC'
);
select ok(
  pg_get_functiondef(
    'public.get_refund_lifecycle_for_manager(uuid)'::regprocedure
  ) like '%auth.uid()%'
  and pg_get_functiondef(
    'public.get_refund_lifecycle_for_manager(uuid)'::regprocedure
  ) like '%can_manage_refund_case%',
  'Manager lifecycle reads revalidate the current authenticated session and case scope'
);

set local role anon;
select ok(
  not has_function_privilege(
    current_user,
    'public.get_refund_lifecycle_for_manager(uuid)',
    'execute'
  ),
  'The anonymous database role has no manager lifecycle execution grant'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"b0000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
select is(
  public.get_refund_lifecycle_for_manager(
    'b4000000-0000-4000-8000-000000000001'
  ) ->> 'schemaVersion',
  'refund_lifecycle_v1',
  'The current exact-machine manager can read the redacted lifecycle'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"b0000000-0000-4000-8000-000000000002","role":"authenticated"}',
  true
);
select throws_ok(
  $$select public.get_refund_lifecycle_for_manager(
    'b4000000-0000-4000-8000-000000000001'
  )$$,
  '42501',
  'Current refund case access required',
  'An unrelated authenticated user cannot read another case lifecycle'
);

reset role;
update public.reporting_machine_refund_managers
set status = 'revoked', revoked_at = statement_timestamp(),
    revoke_reason = 'Durable lifecycle revoked-session fixture'
where id = 'b3500000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"b0000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
select throws_ok(
  $$select public.get_refund_lifecycle_for_manager(
    'b4000000-0000-4000-8000-000000000001'
  )$$,
  '42501',
  'Current refund case access required',
  'A revoked manager loses lifecycle access without relying on stale UI state'
);
reset role;

select ok(
  not has_function_privilege(
    'anon', 'public.service_begin_refund_nayax_lookup(uuid,bigint,text,uuid)', 'execute'
  ) and not has_function_privilege(
    'authenticated', 'public.service_begin_refund_nayax_lookup(uuid,bigint,text,uuid)', 'execute'
  ) and has_function_privilege(
    'service_role', 'public.service_begin_refund_nayax_lookup(uuid,bigint,text,uuid)', 'execute'
  ),
  'Lookup mutation RPCs are service-only'
);
select ok(
  (select relrowsecurity from pg_class
    where oid = 'public.refund_nayax_lookup_candidates'::regclass)
  and not has_table_privilege(
    'authenticated', 'public.refund_nayax_lookup_candidates', 'select'
  ),
  'Raw provider candidate evidence remains private behind RLS and revoked grants'
);
select ok(
  pg_get_functiondef(
    'public.service_select_refund_nayax_candidate_as_actor(uuid,uuid,bigint,uuid,text)'::regprocedure
  ) like '%candidate_row.lookup_generation <> case_row.nayax_lookup_generation%',
  'Candidate selection rejects evidence from an older lookup generation'
);

insert into lookup_results values (
  'generation_three',
  public.service_begin_refund_nayax_lookup(
    'b4000000-0000-4000-8000-000000000001', 1, 'manual', null
  )
);
insert into lookup_results values (
  'timeout_failure',
  public.service_fail_refund_nayax_lookup(
    'b4000000-0000-4000-8000-000000000001', 3, 1,
    'timeout', true, 'manual', null
  )
);
select is(
  (select nayax_lookup_status from public.refund_cases
    where id = 'b4000000-0000-4000-8000-000000000001'),
  'lookup_timed_out',
  'A bounded timeout is classified distinctly'
);
select is(
  (select nayax_lookup_safe_retry_eligible from public.refund_cases
    where id = 'b4000000-0000-4000-8000-000000000001'),
  true,
  'A read-only timeout is explicitly safe to retry'
);
select is(
  public.refund_lifecycle_contract(
    'b4000000-0000-4000-8000-000000000001'
  ) ->> 'managerNextAction',
  'retry_read_only_lookup',
  'The lifecycle exposes only a safe read-only retry action'
);

insert into lookup_results values (
  'generation_four',
  public.service_begin_refund_nayax_lookup(
    'b4000000-0000-4000-8000-000000000001', 1, 'scheduled', null
  )
);
update public.refund_cases
set nayax_lookup_started_at = statement_timestamp() - interval '2 minutes'
where id = 'b4000000-0000-4000-8000-000000000001';
select is(
  (public.service_recover_stale_refund_nayax_lookups() ->> 'recoveredCount')::integer,
  1,
  'An interrupted read-only worker is recovered without a provider write'
);
select is(
  (select nayax_lookup_failure_class from public.refund_cases
    where id = 'b4000000-0000-4000-8000-000000000001'),
  'worker_interrupted',
  'Interrupted read-only work records a named failure class'
);

insert into public.refund_nayax_provider_callers (
  caller_id, assertion_digest, status
) values (
  'nayax-card-refund',
  encode(extensions.digest(convert_to('durable-test-executor', 'UTF8'), 'sha256'), 'hex'),
  'active'
) on conflict (caller_id) do update set
  assertion_digest = excluded.assertion_digest,
  status = 'active';

insert into public.refund_case_nayax_refund_attempts (
  id, refund_case_id, execution_mode, status, idempotency_key,
  amount_cents, request_fingerprint, provider_claim_digest,
  provider_claim_expires_at, reconciliation_required, created_at
) values
  (
    'b6000000-0000-4000-8000-000000000001',
    'b4000000-0000-4000-8000-000000000002',
    'request_and_approve', 'in_progress', 'durable-no-call-attempt', 700,
    repeat('1', 64),
    encode(extensions.digest(convert_to('durable-no-call-claim', 'UTF8'), 'sha256'), 'hex'),
    statement_timestamp() + interval '10 minutes', true,
    statement_timestamp() - interval '3 minutes'
  ),
  (
    'b6000000-0000-4000-8000-000000000002',
    'b4000000-0000-4000-8000-000000000003',
    'request_and_approve', 'in_progress', 'durable-started-attempt', 700,
    repeat('2', 64),
    encode(extensions.digest(convert_to('durable-started-claim', 'UTF8'), 'sha256'), 'hex'),
    statement_timestamp() + interval '10 minutes', true,
    statement_timestamp() - interval '3 minutes'
  );

update public.refund_cases
set
  matched_nayax_transaction_id = 'DURABLE-NOCALL-MATCH-001',
  matched_nayax_site_id = 103,
  matched_nayax_machine_auth_time = incident_at,
  matched_nayax_amount_cents = 700,
  matched_nayax_card_last4 = '4242',
  matched_nayax_currency_code = 'USD',
  nayax_recommendation_state = 'high_confidence',
  nayax_recommendation_policy_version = 'durable-test-v1',
  nayax_match_execution_eligible = true
where id = 'b4000000-0000-4000-8000-000000000002';

select is(
  public.service_record_nayax_refund_provider_stage_v2(
    'durable-test-executor',
    'b6000000-0000-4000-8000-000000000002',
    'durable-started-claim', 'request', 'started',
    null, null, null, null, repeat('a', 64),
    'nayax-production-observed-2026-08-22', 'nayax-provider-journal-v2'
  ) ->> 'safeStage',
  'request_started',
  'A provider started marker immediately persists its sanitized safe stage'
);

insert into lookup_results values (
  'attempt_recovery',
  public.service_recover_stale_nayax_refund_attempts('durable-test-executor')
);
select is(
  (select (result ->> 'releasedNoCallCount')::integer from lookup_results
    where result_key = 'attempt_recovery'),
  1,
  'A stale reservation with no journal evidence is released as provably no-call'
);
select is(
  (select status from public.refund_case_nayax_refund_attempts
    where id = 'b6000000-0000-4000-8000-000000000001'),
  'failed',
  'The no-call attempt becomes terminal before another generation is allowed'
);
select is(
  (select safe_transport_stage from public.refund_case_nayax_refund_attempts
    where id = 'b6000000-0000-4000-8000-000000000001'),
  'released_no_call',
  'No-call recovery retains an auditable safe transport stage'
);
select is(
  (select nayax_refund_attempt_generation from public.refund_cases
    where id = 'b4000000-0000-4000-8000-000000000002'),
  1,
  'Only provable no-call recovery advances the idempotency generation'
);
select is(
  (select (result ->> 'confirmationHoldCount')::integer from lookup_results
    where result_key = 'attempt_recovery'),
  1,
  'A stale attempt with any transport marker enters confirmation hold'
);
select is(
  (select status from public.refund_case_nayax_refund_attempts
    where id = 'b6000000-0000-4000-8000-000000000002'),
  'manual_review',
  'An uncertain provider attempt cannot return to an executable state'
);
select is(
  (select safe_transport_stage from public.refund_case_nayax_refund_attempts
    where id = 'b6000000-0000-4000-8000-000000000002'),
  'confirmation_hold',
  'Uncertain transport is retained as a no-retry confirmation hold'
);
select is(
  public.refund_lifecycle_contract(
    'b4000000-0000-4000-8000-000000000003'
  ) ->> 'stage',
  'needs_refund_operations',
  'An uncertain attempt enters the named Refund Operations lifecycle stage'
);
select is(
  public.refund_lifecycle_contract(
    'b4000000-0000-4000-8000-000000000003'
  ) #>> '{operations,owner}',
  'Refund Operations',
  'The exception contract has a named owner'
);
select is(
  (public.refund_lifecycle_contract(
    'b4000000-0000-4000-8000-000000000003'
  ) #>> '{operations,slaMinutes}')::integer,
  60,
  'The exception contract carries the 60-minute SLA'
);
select is(
  (public.refund_nayax_reliability_health_snapshot(null)
    ->> 'lifecycleContractVersion'),
  'refund_lifecycle_v1',
  'Aggregate reliability health reports the lifecycle contract version'
);
select ok(
  (public.refund_nayax_reliability_health_snapshot(null)
    -> 'safeStageCounts') ? 'confirmation_hold',
  'Aggregate reliability health exposes redacted stage counts'
);

select * from finish();
rollback;
