begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

-- The controlled-pilot suite exercises the retired gate state. The replacement
-- manager-session flow is covered independently.
create or replace function public.refund_official_actions_enabled()
returns boolean language sql immutable set search_path = public
as $$ select false; $$;

-- Test-owner delegate exercises retained historical internals without reopening
-- the retired production endpoint. Current service entry is tested separately.
create function pg_temp.historical_pilot_consume(uuid,uuid,uuid,bigint,integer,text,text,text,text,text,uuid)
returns jsonb language sql security definer set search_path='' as $$
  select public.admin_consume_refund_nayax_controlled_pilot_intent($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11);
$$;
revoke all on function pg_temp.historical_pilot_consume(uuid,uuid,uuid,bigint,integer,text,text,text,text,text,uuid) from public,anon,authenticated,service_role;
grant execute on function pg_temp.historical_pilot_consume(uuid,uuid,uuid,bigint,integer,text,text,text,text,text,uuid) to authenticated;

-- Test-owner delegate exercises retained historical internals without reopening
-- the retired production endpoint. Current service entry is tested separately.
create function pg_temp.historical_pilot_reserve(text,uuid,text,text,uuid,uuid,text,integer,text,uuid)
returns jsonb language sql security definer set search_path='' as $$
  select public.service_reserve_and_consume_nayax_controlled_pilot_attempt($1,$2,$3,$4,$5,$6,$7,$8,$9,$10);
$$;
revoke all on function pg_temp.historical_pilot_reserve(text,uuid,text,text,uuid,uuid,text,integer,text,uuid) from public,anon,authenticated,service_role;
grant execute on function pg_temp.historical_pilot_reserve(text,uuid,text,text,uuid,uuid,text,integer,text,uuid) to service_role;

select plan(55);

select is(
  public.refund_nayax_controlled_pilot_audit_retention_approved(),
  false,
  'Controlled pilot live authorization remains hard-blocked until retention approval'
);
create or replace function public.refund_nayax_controlled_pilot_audit_retention_approved()
returns boolean language sql immutable set search_path = public
as $$ select true; $$;

create function pg_temp.capture_error(statement text)
returns text
language plpgsql
as $$
begin
  execute statement;
  return null;
exception when others then
  return sqlstate || ':' || sqlerrm;
end;
$$;

create function pg_temp.set_auth_claims(p_user_id uuid, p_aal text)
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claim.sub', p_user_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', p_user_id,
      'role', 'authenticated',
      'aal', p_aal,
      'amr', jsonb_build_array(jsonb_build_object(
        'method', 'totp',
        'timestamp', extract(epoch from clock_timestamp() + interval '2 seconds')
      ))
    )::text,
    true
  );
end;
$$;

create temporary table controlled_pilot_results (
  result_key text primary key,
  result jsonb not null
);
grant all on table pg_temp.controlled_pilot_results to authenticated, service_role;

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
(
  '00000000-0000-0000-0000-000000000000',
  '43000000-0000-4000-8000-000000000001',
  'authenticated', 'authenticated', 'pilot-owner@example.test', '', now(),
  '{}'::jsonb, '{}'::jsonb, now(), now()
),
(
  '00000000-0000-0000-0000-000000000000',
  '43000000-0000-4000-8000-000000000002',
  'authenticated', 'authenticated', 'pilot-approver@example.test', '', now(),
  '{}'::jsonb, '{}'::jsonb, now(), now()
);

insert into public.customer_accounts (id, name, account_type)
values ('43100000-0000-4000-8000-000000000001', 'Controlled pilot', 'customer');

insert into public.reporting_locations (id, account_id, name, timezone)
values (
  '43200000-0000-4000-8000-000000000001',
  '43100000-0000-4000-8000-000000000001',
  'Controlled pilot location', 'America/Los_Angeles'
);

insert into public.reporting_machines (
  id, account_id, location_id, machine_label, status, nayax_machine_id,
  nayax_account_key, nayax_refunds_enabled, nayax_refund_max_amount_cents
) values (
  '43300000-0000-4000-8000-000000000001',
  '43100000-0000-4000-8000-000000000001',
  '43200000-0000-4000-8000-000000000001',
  'Controlled pilot machine', 'active', 'PILOT-MACHINE',
  'PILOT-ACCOUNT', false, null
);

insert into public.reporting_machine_refund_managers (
  id, reporting_machine_id, manager_user_id, manager_email, grant_reason
) values (
  '43400000-0000-4000-8000-000000000001',
  '43300000-0000-4000-8000-000000000001',
  '43000000-0000-4000-8000-000000000001',
  'pilot-owner@example.test', 'One self-owned provider pilot'
);

insert into public.refund_manager_totp_enrollments (
  actor_user_id, approved_factor_binding_hash, owner_approved_by_user_id,
  owner_approval_version, enrollment_version
) values (
  '43000000-0000-4000-8000-000000000001', repeat('a', 64),
  '43000000-0000-4000-8000-000000000002', 1, 1
);

insert into public.refund_cases (
  id, public_reference, reporting_machine_id, reporting_location_id,
  customer_email, issue_summary, incident_at, payment_method,
  payment_amount_cents, refund_amount_cents, status, decision,
  decided_by, decided_at, card_last4, card_wallet_used,
  correlation_status, correlation_source, correlation_confidence,
  matched_nayax_transaction_id, matched_nayax_site_id,
  matched_nayax_machine_auth_time, matched_nayax_amount_cents,
  matched_nayax_card_last4, matched_nayax_currency_code,
  nayax_recommendation_state, nayax_recommendation_policy_version,
  nayax_recommendation_evaluated_at, nayax_match_execution_eligible
) values (
  '43600000-0000-4000-8000-000000000001', 'RF-PILOT-ONE',
  '43300000-0000-4000-8000-000000000001',
  '43200000-0000-4000-8000-000000000001',
  'pilot-owner@example.test', 'Controlled provider-only pilot fixture',
  statement_timestamp() - interval '1 day', 'card', 700, 700,
  'correlated', null,
  null, null, '4242', false,
  'matched', 'nayax', 1, '123456789', 42,
  statement_timestamp() - interval '1 day', 700, '4242', 'USD',
  'high_confidence', 'controlled-pilot-v1', statement_timestamp(), true
);

create function pg_temp.controlled_pilot_case_digest()
returns text
language sql
as $$
  select encode(extensions.digest(convert_to(concat_ws('|',
    refund_case.id::text, machine.id::text,
    refund_case.official_action_version::text,
    refund_case.refund_amount_cents::text,
    refund_case.matched_nayax_transaction_id,
    refund_case.matched_nayax_site_id::text,
    refund_case.matched_nayax_machine_auth_time::text,
    public.refund_nayax_controlled_pilot_prearm_evidence_hash(
      refund_case, machine, 700
    )
  ), 'UTF8'), 'sha256'), 'hex')
  from public.refund_cases refund_case
  join public.reporting_machines machine
    on machine.id = refund_case.reporting_machine_id
  where refund_case.id = '43600000-0000-4000-8000-000000000001';
$$;

create function pg_temp.controlled_pilot_machine_digest()
returns text
language sql
as $$
  select encode(extensions.digest(convert_to(concat_ws('|',
    machine.id::text, machine.nayax_machine_id,
    machine.nayax_account_key, '700'
  ), 'UTF8'), 'sha256'), 'hex')
  from public.reporting_machines machine
  where machine.id = '43300000-0000-4000-8000-000000000001';
$$;

create function pg_temp.controlled_pilot_owner_email_digest()
returns text language sql as $$
  select encode(extensions.digest(convert_to('pilot-owner@example.test', 'UTF8'), 'sha256'), 'hex');
$$;

create function pg_temp.controlled_pilot_self_attestation_digest()
returns text language sql as $$
  select public.refund_nayax_controlled_pilot_self_attestation_hash(
    refund_case, machine, pg_temp.controlled_pilot_owner_email_digest(), 700
  )
  from public.refund_cases refund_case
  join public.reporting_machines machine on machine.id = refund_case.reporting_machine_id
  where refund_case.id = '43600000-0000-4000-8000-000000000001';
$$;

create function pg_temp.controlled_pilot_account_key_digest()
returns text language sql as $$
  select encode(extensions.digest(convert_to('PILOT_ACCOUNT', 'UTF8'), 'sha256'), 'hex');
$$;

select ok(
  not has_table_privilege('authenticated', 'public.refund_nayax_controlled_pilot_authorizations', 'select')
  and not has_table_privilege('service_role', 'public.refund_nayax_controlled_pilot_authorizations', 'select')
  and not has_table_privilege('service_role', 'public.refund_nayax_controlled_pilot_stage_journal', 'insert'),
  'Pilot authorization and stage tables have no direct browser or service access'
);

select ok(
  not has_function_privilege('service_role',
    'public.owner_authorize_refund_nayax_controlled_pilot(uuid,uuid,uuid,bigint,integer,text,text,text,text,text,text,text,text,text,text,text)', 'execute')
  and not has_function_privilege('authenticated',
    'public.admin_consume_refund_nayax_controlled_pilot_intent(uuid,uuid,uuid,bigint,integer,text,text,text,text,text,uuid)', 'execute')
  and has_function_privilege('service_role',
    'public.service_record_nayax_controlled_pilot_stage(text,uuid,uuid,uuid,text,text,integer,text,text,text,boolean,text)', 'execute')
  and has_function_privilege('service_role',
    'public.service_validate_nayax_controlled_pilot_postarm(text,uuid,uuid,integer,text,text)', 'execute'),
  'Retired pilot consumption is private; historical journal boundaries remain available'
);

select is(public.refund_official_actions_enabled(), false,
  'The global official-action gate remains false');

select ok((
  select nayax_refunds_enabled is false
    and nayax_refund_max_amount_cents is null
  from public.reporting_machines
  where id = '43300000-0000-4000-8000-000000000001'
), 'The exact pilot machine begins closed before owner authorization');

select ok((public.owner_cancel_refund_nayax_controlled_pilot(
  '43000000-0000-4000-8000-000000000099'
) ->> 'closed')::boolean, 'Close-before-authorize records a durable tombstone');

select throws_ok($sql$
  select public.owner_authorize_refund_nayax_controlled_pilot(
    '43000000-0000-4000-8000-000000000099',
    '43000000-0000-4000-8000-000000000001',
    '43600000-0000-4000-8000-000000000001',
    (select official_action_version from public.refund_cases
      where id = '43600000-0000-4000-8000-000000000001'),
    700, pg_temp.controlled_pilot_case_digest(),
    pg_temp.controlled_pilot_owner_email_digest(),
    pg_temp.controlled_pilot_self_attestation_digest(),
    pg_temp.controlled_pilot_machine_digest(),
    pg_temp.controlled_pilot_account_key_digest(), repeat('2',64),
    encode(extensions.digest(convert_to('controlled-pilot-executor', 'UTF8'), 'sha256'), 'hex'),
    repeat('3',64), 'nayax-written-contract-v1', repeat('4',64), repeat('5',64)
  )
$sql$, 'P0001', 'Controlled Nayax pilot authorization was already closed or used',
  'A delayed authorize cannot pass a close-first tombstone');

delete from public.refund_nayax_controlled_pilot_closures;

savepoint controlled_pilot_wrong_customer;
update public.refund_cases set customer_email = 'different-owner@example.test'
where id = '43600000-0000-4000-8000-000000000001';
select throws_ok($sql$
  select public.owner_authorize_refund_nayax_controlled_pilot(
    '43000000-0000-4000-8000-000000000010',
    '43000000-0000-4000-8000-000000000001',
    '43600000-0000-4000-8000-000000000001', 1, 700,
    pg_temp.controlled_pilot_case_digest(),
    pg_temp.controlled_pilot_owner_email_digest(),
    pg_temp.controlled_pilot_self_attestation_digest(),
    pg_temp.controlled_pilot_machine_digest(),
    pg_temp.controlled_pilot_account_key_digest(), repeat('2',64),
    encode(extensions.digest(convert_to('controlled-pilot-executor', 'UTF8'), 'sha256'), 'hex'),
    repeat('3',64), 'nayax-written-contract-v1', repeat('4',64), repeat('5',64)
  )
$sql$, 'P0001', 'Exact self-owned case, machine, and account evidence required',
  'A manager cannot arm a case whose normalized customer email is not their Auth email');
rollback to savepoint controlled_pilot_wrong_customer;

select throws_ok($sql$
  select public.owner_authorize_refund_nayax_controlled_pilot(
    '43000000-0000-4000-8000-000000000010',
    '43000000-0000-4000-8000-000000000001',
    '43600000-0000-4000-8000-000000000001', 1, 700,
    pg_temp.controlled_pilot_case_digest(),
    pg_temp.controlled_pilot_owner_email_digest(), repeat('f',64),
    pg_temp.controlled_pilot_machine_digest(),
    pg_temp.controlled_pilot_account_key_digest(), repeat('2',64),
    encode(extensions.digest(convert_to('controlled-pilot-executor', 'UTF8'), 'sha256'), 'hex'),
    repeat('3',64), 'nayax-written-contract-v1', repeat('4',64), repeat('5',64)
  )
$sql$, 'P0001', 'Exact self-owned case, machine, and account evidence required',
  'A mismatched private self-case/card/amount attestation cannot arm the pilot');

select lives_ok($sql$
  insert into pg_temp.controlled_pilot_results (result_key, result)
  select 'owner-authorize', public.owner_authorize_refund_nayax_controlled_pilot(
    '43000000-0000-4000-8000-000000000010',
    '43000000-0000-4000-8000-000000000001',
    '43600000-0000-4000-8000-000000000001',
    (select official_action_version from public.refund_cases
      where id = '43600000-0000-4000-8000-000000000001'),
    700, pg_temp.controlled_pilot_case_digest(),
    pg_temp.controlled_pilot_owner_email_digest(),
    pg_temp.controlled_pilot_self_attestation_digest(),
    pg_temp.controlled_pilot_machine_digest(),
    pg_temp.controlled_pilot_account_key_digest(), repeat('2',64),
    encode(extensions.digest(convert_to('controlled-pilot-executor', 'UTF8'), 'sha256'), 'hex'),
    repeat('3',64), 'nayax-written-contract-v1', repeat('4',64), repeat('5',64)
  )
$sql$, 'The owner can arm one exact redacted case and contract');

select ok((
  select (result ->> 'authorized')::boolean
    and (result ->> 'payloadRedacted')::boolean
    and (result ->> 'authorizationId')::uuid = '43000000-0000-4000-8000-000000000010'
    and (result ->> 'intentId')::uuid is not null
  from pg_temp.controlled_pilot_results where result_key = 'owner-authorize'
), 'Owner authorization returns only the expected private handles and redacted status');

select ok((
  select status = 'armed' and amount_cents = 700 and currency_code = 'USD'
    and owner_user_id = '43000000-0000-4000-8000-000000000001'
    and contract_digest = repeat('3',64)
    and runner_assertion_digest = repeat('2',64)
    and executor_assertion_digest = encode(extensions.digest(
      convert_to('controlled-pilot-executor', 'UTF8'), 'sha256'), 'hex')
    and provider_attempt_id is null
  from public.refund_nayax_controlled_pilot_authorizations
), 'The durable pilot binds actor, case, exact cap, runner, and written contract');

set local role service_role;
select lives_ok($sql$
  insert into pg_temp.controlled_pilot_results (result_key, result)
  select 'postarm', public.service_validate_nayax_controlled_pilot_postarm(
    'controlled-pilot-executor',
    '43000000-0000-4000-8000-000000000010',
    '43600000-0000-4000-8000-000000000001', 700,
    repeat('2',64), repeat('3',64)
  )
$sql$, 'The exact authorization-bound armed machine and amount cap pass before TOTP');
reset role;

select ok((
  select (result ->> 'ready')::boolean
    and (result ->> 'authorizationBound')::boolean
    and (result ->> 'machineArmed')::boolean
    and (result ->> 'amountCapExact')::boolean
    and (result ->> 'payloadRedacted')::boolean
  from pg_temp.controlled_pilot_results where result_key = 'postarm'
), 'Post-arm readiness returns only fixed redacted proof flags');

update public.reporting_machines
set nayax_refund_max_amount_cents = 701
where id = '43300000-0000-4000-8000-000000000001';
set local role service_role;
select throws_ok($sql$
  select public.service_validate_nayax_controlled_pilot_postarm(
    'controlled-pilot-executor',
    '43000000-0000-4000-8000-000000000010',
    '43600000-0000-4000-8000-000000000001', 700,
    repeat('2',64), repeat('3',64)
  )
$sql$, 'P0001', 'Controlled Nayax pilot post-arm machine or cap changed',
  'A wrong armed amount cap fails before TOTP or any provider reservation');
reset role;
update public.reporting_machines
set nayax_refund_max_amount_cents = 700
where id = '43300000-0000-4000-8000-000000000001';

select ok((
  select intent.status = 'pending' and intent.action = 'nayax_execute'
    and intent.target_function = 'nayax-card-refund'
    and intent.expires_at <= intent.not_before + interval '2 minutes 5 seconds'
  from public.refund_manager_action_step_up_intents intent
  join public.refund_nayax_controlled_pilot_authorizations pilot
    on pilot.step_up_intent_id = intent.id
), 'Owner authorization creates one exact two-minute TOTP intent without the global gate');

select throws_ok($sql$
  select public.owner_authorize_refund_nayax_controlled_pilot(
    '43000000-0000-4000-8000-000000000011',
    '43000000-0000-4000-8000-000000000001',
    '43600000-0000-4000-8000-000000000001', 1, 700,
    pg_temp.controlled_pilot_case_digest(),
    pg_temp.controlled_pilot_owner_email_digest(),
    pg_temp.controlled_pilot_self_attestation_digest(),
    pg_temp.controlled_pilot_machine_digest(),
    pg_temp.controlled_pilot_account_key_digest(), repeat('2',64),
    encode(extensions.digest(convert_to('controlled-pilot-executor', 'UTF8'), 'sha256'), 'hex'),
    repeat('3',64), 'nayax-written-contract-v1', repeat('4',64), repeat('5',64)
  )
$sql$, 'P0001', 'Controlled Nayax pilot authorization was already closed or used',
  'A second authorization cannot be armed');

set local role authenticated;
select pg_temp.set_auth_claims('43000000-0000-4000-8000-000000000002', 'aal2');
select throws_ok(format($sql$
  select pg_temp.historical_pilot_consume(
    '43000000-0000-4000-8000-000000000010', %L,
    '43600000-0000-4000-8000-000000000001', 1, 700, repeat('f',64),
    'controlled-pilot-executor', repeat('2',64), repeat('3',64),
    'nayax-refund-' || repeat('a',64),
    '43000000-0000-4000-8000-000000000020'
  )
$sql$, (select result ->> 'intentId' from pg_temp.controlled_pilot_results
  where result_key = 'owner-authorize')), 'P0001',
  'Exact active controlled Nayax pilot authorization required',
  'A different authenticated actor cannot consume the owner pilot');
reset role;

set local role authenticated;
select pg_temp.set_auth_claims('43000000-0000-4000-8000-000000000001', 'aal1');
select throws_ok($sql$
  select public.admin_prepare_refund_action_step_up_intent(
    '43600000-0000-4000-8000-000000000001', 'nayax_execute',
    'nayax-card-refund', 1, 'card_refund_pending', 'approved',
    null, null, null, 700, null, null, false, null, null
  )
$sql$, 'P0001',
  'Official refund actions are disabled pending owner approval and controlled UAT',
  'The portal-facing general official-action surface remains unavailable');
reset role;

update public.refund_manager_action_step_up_intents
set factor_verified_at = clock_timestamp(),
  factor_verification_proof_hash = encode(extensions.digest(convert_to(
    'bloomjoy-refund-manager-step-up-proof-v1:' || repeat('f',64), 'UTF8'
  ), 'sha256'), 'hex')
where id = (select (result ->> 'intentId')::uuid
  from pg_temp.controlled_pilot_results where result_key = 'owner-authorize');

set local role authenticated;
select pg_temp.set_auth_claims('43000000-0000-4000-8000-000000000001', 'aal2');
select throws_ok(format($sql$
  select pg_temp.historical_pilot_consume(
    '43000000-0000-4000-8000-000000000010', %L,
    '43600000-0000-4000-8000-000000000001', 1, 700, repeat('f',64),
    'controlled-pilot-executor', repeat('9',64), repeat('3',64),
    'nayax-refund-' || repeat('a',64),
    '43000000-0000-4000-8000-000000000020'
  )
$sql$, (select result ->> 'intentId' from pg_temp.controlled_pilot_results
  where result_key = 'owner-authorize')), 'P0001',
  'Exact unused controlled Nayax pilot authorization required',
  'A wrong runner digest rolls back before any provider reservation');
reset role;

select ok((
  select case_row.status = 'correlated' and case_row.decision is null
    and pilot.status = 'armed' and pilot.provider_attempt_id is null
    and machine.nayax_refunds_enabled is true
    and caller.status = 'active'
    and not exists (select 1 from public.refund_case_nayax_refund_attempts)
    and not exists (select 1 from public.refund_case_official_action_authorizations)
  from public.refund_cases case_row
  join public.refund_nayax_controlled_pilot_authorizations pilot
    on pilot.refund_case_id = case_row.id
  join public.reporting_machines machine
    on machine.id = pilot.reporting_machine_id
  join public.refund_nayax_provider_callers caller
    on caller.caller_id = 'nayax-card-refund'
), 'Failed combined consumption rolls back case, receipt, and reservation atomically');

set local role authenticated;
select pg_temp.set_auth_claims('43000000-0000-4000-8000-000000000001', 'aal2');
select throws_ok(format($sql$
  select pg_temp.historical_pilot_consume(
    '43000000-0000-4000-8000-000000000010', %L,
    '43600000-0000-4000-8000-000000000001', 1, 700, repeat('f',64),
    'controlled-pilot-executor', repeat('2',64), repeat('9',64),
    'nayax-refund-' || repeat('a',64),
    '43000000-0000-4000-8000-000000000020'
  )
$sql$, (select result ->> 'intentId' from pg_temp.controlled_pilot_results
  where result_key = 'owner-authorize')), 'P0001',
  'Exact unused controlled Nayax pilot authorization required',
  'A different provider contract cannot consume the exact pilot');
reset role;

savepoint controlled_pilot_postarm_case_email_drift;
update public.refund_cases set customer_email = 'postarm-drift@example.test'
where id = '43600000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.set_auth_claims('43000000-0000-4000-8000-000000000001', 'aal2');
select throws_ok(format($sql$
  select pg_temp.historical_pilot_consume(
    '43000000-0000-4000-8000-000000000010', %L,
    '43600000-0000-4000-8000-000000000001', 1, 700, repeat('f',64),
    'controlled-pilot-executor', repeat('2',64), repeat('3',64),
    'nayax-refund-' || repeat('a',64),
    '43000000-0000-4000-8000-000000000020'
  )
$sql$, (select result ->> 'intentId' from pg_temp.controlled_pilot_results
  where result_key = 'owner-authorize')), 'P0001',
  'Reviewed controlled pilot self-owner evidence changed',
  'Case customer-email drift after arm blocks atomic TOTP consumption');
reset role;
select ok(
  not exists (select 1 from public.refund_case_nayax_refund_attempts)
  and not exists (select 1 from public.refund_case_official_action_authorizations)
  and not exists (select 1 from public.refund_nayax_controlled_pilot_stage_journal),
  'Post-arm case-email drift creates no provider attempt, receipt, or stage journal'
);
rollback to savepoint controlled_pilot_postarm_case_email_drift;

savepoint controlled_pilot_postarm_auth_email_drift;
update auth.users set email = 'postarm-auth-drift@example.test'
where id = '43000000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.set_auth_claims('43000000-0000-4000-8000-000000000001', 'aal2');
select throws_ok(format($sql$
  select pg_temp.historical_pilot_consume(
    '43000000-0000-4000-8000-000000000010', %L,
    '43600000-0000-4000-8000-000000000001', 1, 700, repeat('f',64),
    'controlled-pilot-executor', repeat('2',64), repeat('3',64),
    'nayax-refund-' || repeat('a',64),
    '43000000-0000-4000-8000-000000000020'
  )
$sql$, (select result ->> 'intentId' from pg_temp.controlled_pilot_results
  where result_key = 'owner-authorize')), 'P0001',
  'Reviewed controlled pilot self-owner evidence changed',
  'Authenticated owner-email drift after arm blocks atomic TOTP consumption');
reset role;
select ok(
  not exists (select 1 from public.refund_case_nayax_refund_attempts)
  and not exists (select 1 from public.refund_case_official_action_authorizations)
  and not exists (select 1 from public.refund_nayax_controlled_pilot_stage_journal),
  'Post-arm Auth-email drift creates no provider attempt, receipt, or stage journal'
);
rollback to savepoint controlled_pilot_postarm_auth_email_drift;

set local role authenticated;
select pg_temp.set_auth_claims('43000000-0000-4000-8000-000000000001', 'aal2');
select lives_ok(format($sql$
  insert into pg_temp.controlled_pilot_results (result_key, result)
  select 'step-up', pg_temp.historical_pilot_consume(
    '43000000-0000-4000-8000-000000000010', %L,
    '43600000-0000-4000-8000-000000000001',
    1, 700, repeat('f',64), 'controlled-pilot-executor', repeat('2',64),
    repeat('3',64), 'nayax-refund-' || repeat('a',64),
    '43000000-0000-4000-8000-000000000020'
  )
$sql$, (select result ->> 'intentId' from pg_temp.controlled_pilot_results
  where result_key = 'owner-authorize')),
  'The exact owner TOTP atomically approves, authorizes, and reserves once');
reset role;

select ok((
  select auth.action = 'nayax_execute' and auth.status = 'consumed'
    and auth.consumed_at is not null
    and auth.actor_user_id = '43000000-0000-4000-8000-000000000001'
    and auth.nayax_execution_evidence_hash = pilot.nayax_execution_evidence_hash
    and pilot.status = 'consumed' and pilot.provider_attempt_id is not null
    and (result.result -> 'pilotReservation' -> 'attempt' ->> 'attemptId')::uuid
      = pilot.provider_attempt_id
  from public.refund_case_official_action_authorizations auth
  join public.refund_nayax_controlled_pilot_authorizations pilot
    on pilot.step_up_intent_id = auth.step_up_intent_id
  join pg_temp.controlled_pilot_results result on result.result_key = 'step-up'
), 'The official receipt is exact-case, fresh-TOTP, and execution-evidence bound');

select ok((
  select case_row.status = 'card_refund_pending'
    and case_row.decision = 'approved'
    and case_row.decision_reason = 'owner_controlled_nayax_pilot'
    and pilot.status = 'consumed' and pilot.provider_attempt_id is not null
    and pilot.consumed_at is not null and pilot.settled_at is null
    and (select count(*) from public.refund_case_nayax_refund_attempts) = 1
  from public.refund_nayax_controlled_pilot_authorizations pilot
  join public.refund_cases case_row on case_row.id = pilot.refund_case_id
), 'One transaction advances the case and consumes the provider reservation');

select ok(not (public.owner_cancel_refund_nayax_controlled_pilot(
  '43000000-0000-4000-8000-000000000010'
) ->> 'closed')::boolean,
  'Exact close cannot report closed while the reserved Edge worker lease is active');

select throws_ok($sql$
  select public.owner_recover_expired_refund_nayax_controlled_pilot()
$sql$, 'P0001', 'Controlled Nayax pilot worker lease is still active',
  'No-ID recovery cannot race an active reserved Edge worker');

savepoint controlled_pilot_hard_crash;
update public.refund_nayax_controlled_pilot_authorizations
set worker_lease_expires_at = clock_timestamp() - interval '1 second'
where authorization_id = '43000000-0000-4000-8000-000000000010';
insert into pg_temp.controlled_pilot_results (result_key, result)
select 'hard-crash-recovery',
  public.owner_recover_expired_refund_nayax_controlled_pilot();
select ok((
  select (result ->> 'closed')::boolean
    and (result ->> 'consumedAttemptCount')::integer = 1
    and result ->> 'providerCallCountStatus' = 'unknown'
    and (result ->> 'providerHold')::boolean
    and (result ->> 'manualReconciliationRequired')::boolean
    and not exists (
      select 1 from public.refund_nayax_provider_callers where status = 'active'
    )
    and not exists (
      select 1 from public.reporting_machines
      where id = '43300000-0000-4000-8000-000000000001'
        and (nayax_refunds_enabled or nayax_refund_max_amount_cents is not null)
    )
    and exists (
      select 1 from public.refund_case_nayax_refund_attempts
      where reconciliation_required and provider_outcome = 'unknown'
    )
  from pg_temp.controlled_pilot_results
  where result_key = 'hard-crash-recovery'
), 'Expired no-ID recovery converts a lost consumed worker to a closed no-replay provider hold');
rollback to savepoint controlled_pilot_hard_crash;

select throws_ok(format($sql$
  select pg_temp.historical_pilot_reserve(
    'controlled-pilot-executor', '43000000-0000-4000-8000-000000000010',
    repeat('2',64), repeat('3',64), %L,
    '43600000-0000-4000-8000-000000000001',
    'nayax-refund-' || repeat('a',64), 700, 'USD',
    '43000000-0000-4000-8000-000000000020'
  )
$sql$, (select result ->> 'authorizationId'
  from pg_temp.controlled_pilot_results where result_key = 'step-up')),
  'P0001', 'Exact unused controlled Nayax pilot authorization required',
  'The controlled pilot has no replay surface');

select throws_ok(format($sql$
  select public.service_record_nayax_controlled_pilot_stage(
    'controlled-pilot-executor', '43000000-0000-4000-8000-000000000010',
    %L, '43000000-0000-4000-8000-000000000020', 'approve_started'
  )
$sql$, (select result -> 'pilotReservation' -> 'attempt' ->> 'attemptId'
  from pg_temp.controlled_pilot_results where result_key = 'step-up')),
  'P0001', 'Controlled pilot stage journal order is invalid',
  'Approval cannot start before the request result');

select lives_ok(format($sql$
  select public.service_record_nayax_controlled_pilot_stage(
    'controlled-pilot-executor', '43000000-0000-4000-8000-000000000010',
    %L, '43000000-0000-4000-8000-000000000020', 'request_started'
  )
$sql$, (select result -> 'pilotReservation' -> 'attempt' ->> 'attemptId'
  from pg_temp.controlled_pilot_results where result_key = 'step-up')),
  'request_started is durable before provider transport');

select throws_ok(format($sql$
  select public.service_record_nayax_controlled_pilot_stage(
    'controlled-pilot-executor', '43000000-0000-4000-8000-000000000010',
    %L, '43000000-0000-4000-8000-000000000020', 'request_started'
  )
$sql$, (select result -> 'pilotReservation' -> 'attempt' ->> 'attemptId'
  from pg_temp.controlled_pilot_results where result_key = 'step-up')),
  'P0001', 'Controlled pilot request was already started',
  'A second request_started cannot be inserted');

select throws_ok(format($sql$
  select public.service_record_nayax_controlled_pilot_stage(
    'controlled-pilot-executor', '43000000-0000-4000-8000-000000000010',
    %L, '43000000-0000-4000-8000-000000000020',
    'request_result', 'unknown', 200,
    'owner_email@example.test', '4111111111111111', null, false, repeat('e',64)
  )
$sql$, (select result -> 'pilotReservation' -> 'attempt' ->> 'attemptId'
  from pg_temp.controlled_pilot_results where result_key = 'step-up')),
  'P0001', 'Exact redacted controlled pilot provider classification required',
  'Raw provider email, PAN, and identifier-like fields cannot enter the journal');

select lives_ok(format($sql$
  select public.service_record_nayax_controlled_pilot_stage(
    'controlled-pilot-executor', '43000000-0000-4000-8000-000000000010',
    %L, '43000000-0000-4000-8000-000000000020',
    'request_result', 'accepted', 200,
    'contract_match', 'http_success', null, true, repeat('c',64)
  )
$sql$, (select result -> 'pilotReservation' -> 'attempt' ->> 'attemptId'
  from pg_temp.controlled_pilot_results where result_key = 'step-up')),
  'request_result records only the configured redacted outcome');

select lives_ok(format($sql$
  select public.service_record_nayax_controlled_pilot_stage(
    'controlled-pilot-executor', '43000000-0000-4000-8000-000000000010',
    %L, '43000000-0000-4000-8000-000000000020', 'approve_started'
  )
$sql$, (select result -> 'pilotReservation' -> 'attempt' ->> 'attemptId'
  from pg_temp.controlled_pilot_results where result_key = 'step-up')),
  'approve_started is durable only after exact acceptance');

select lives_ok(format($sql$
  select public.service_record_nayax_controlled_pilot_stage(
    'controlled-pilot-executor', '43000000-0000-4000-8000-000000000010',
    %L, '43000000-0000-4000-8000-000000000020',
    'approve_result', 'succeeded', 200,
    'contract_match', 'http_success', null, true, repeat('d',64)
  )
$sql$, (select result -> 'pilotReservation' -> 'attempt' ->> 'attemptId'
  from pg_temp.controlled_pilot_results where result_key = 'step-up')),
  'approve_result records one exact terminal provider result');

select is(
  (select string_agg(stage_event, ',' order by stage_ordinal)
   from public.refund_nayax_controlled_pilot_stage_journal),
  'request_started,request_result,approve_started,approve_result',
  'The immutable stage journal has exactly one request and at most one approval in order'
);

select throws_ok($sql$
  update public.refund_nayax_controlled_pilot_stage_journal
  set provider_status = 'changed'
$sql$, 'P0001', 'Controlled Nayax pilot stage evidence is immutable',
  'Stage journal rows cannot be changed');

select throws_ok(format($sql$
  select public.service_settle_nayax_controlled_pilot_attempt(
    'controlled-pilot-executor', '43000000-0000-4000-8000-000000000010',
    %L, %L, '43600000-0000-4000-8000-000000000001',
    'nayax-refund-' || repeat('a',64), 700, 'USD', %L,
    'success', '43000000-0000-4000-8000-000000000020',
    'nayax-transaction-123456789', 'approve_true_approved', null
  )
$sql$,
  (select result -> 'pilotReservation' -> 'attempt' ->> 'attemptId'
    from pg_temp.controlled_pilot_results where result_key = 'step-up'),
  (select result ->> 'authorizationId' from pg_temp.controlled_pilot_results
    where result_key = 'step-up'),
  (select result -> 'pilotReservation' ->> 'providerClaimToken'
    from pg_temp.controlled_pilot_results where result_key = 'step-up')),
  'P0001', 'Exact request and approval success journal required',
  'The original TransactionId cannot be presented as a provider refund receipt');

select lives_ok(format($sql$
  insert into pg_temp.controlled_pilot_results (result_key, result)
  select 'settlement', public.service_settle_nayax_controlled_pilot_attempt(
    'controlled-pilot-executor', '43000000-0000-4000-8000-000000000010',
    %L, %L, '43600000-0000-4000-8000-000000000001',
    'nayax-refund-' || repeat('a',64), 700, 'USD', %L,
    'success', '43000000-0000-4000-8000-000000000020',
    'nayax-evidence-' || repeat('b',64),
    'approve_true_approved', null
  )
$sql$,
  (select result -> 'pilotReservation' -> 'attempt' ->> 'attemptId'
    from pg_temp.controlled_pilot_results where result_key = 'step-up'),
  (select result ->> 'authorizationId' from pg_temp.controlled_pilot_results
    where result_key = 'step-up'),
  (select result -> 'pilotReservation' ->> 'providerClaimToken'
    from pg_temp.controlled_pilot_results where result_key = 'step-up')),
  'Exact journal plus redacted evidence digest can settle the provider-only pilot');

select ok((
  select status = 'completed' and nayax_refund_execution_status = 'approved'
    and reporting_adjustment_id is not null
    and manual_refund_reference ~ '^nayax-evidence-[a-f0-9]{64}$'
  from public.refund_cases
  where id = '43600000-0000-4000-8000-000000000001'
), 'Provider success atomically completes only the case and reporting adjustment');

select ok((
  select status = 'consumed' and settled_at is not null
    and provider_outcome = 'success'
  from public.refund_nayax_controlled_pilot_authorizations
), 'Pilot authorization records the exact terminal provider outcome');

select ok((
  select machine.nayax_refunds_enabled is false
    and machine.nayax_refund_max_amount_cents is null
    and not exists (
      select 1 from public.refund_nayax_provider_callers caller
      where caller.caller_id = 'nayax-card-refund' and caller.status = 'active'
    )
  from public.reporting_machines machine
  where machine.id = '43300000-0000-4000-8000-000000000001'
), 'Terminal settlement restores the exact machine cap and provider caller to closed');

select is((select count(*)::integer from public.refund_case_messages), 0,
  'Provider-only pilot creates no customer delivery row');
select is((select count(*)::integer from public.refund_gmail_messages
  where operation_key is not null), 0,
  'Provider-only pilot creates no Hub Gmail outbound operation');

select ok(not exists (
  select 1 from public.refund_nayax_controlled_pilot_stage_journal
  where payload_redacted is not true
     or (
       stage_event in ('request_started', 'approve_started')
       and (outcome is not null or http_status is not null
         or provider_result is not null or provider_status is not null
         or contract_matched is not null or classification_digest is not null
         or failure_type is not null)
     )
     or (
       stage_event in ('request_result', 'approve_result')
       and (provider_result not in ('contract_match', 'contract_mismatch')
         or provider_status not in (
           'http_success', 'http_failure', 'transport_timeout', 'transport_network'
         )
         or contract_matched is null
         or classification_digest !~ '^[a-f0-9]{64}$')
     )
), 'The journal retains only redacted fixed-shape provider classifications');

select ok((
  select (recovery ->> 'consumedAttemptCount')::integer = 1
    and recovery ->> 'providerCallCountStatus' = 'unknown'
    and (recovery ->> 'providerHold')::boolean
  from public.owner_recover_expired_refund_nayax_controlled_pilot() recovery
), 'Repeated recovery after success preserves consumed provider history');

savepoint controlled_pilot_rejected_history;
update public.refund_nayax_controlled_pilot_authorizations
set provider_outcome = 'rejected', worker_terminal_status = 'rejected';
select ok((
  select (recovery ->> 'consumedAttemptCount')::integer = 1
    and recovery ->> 'providerCallCountStatus' = 'unknown'
    and (recovery ->> 'manualReconciliationRequired')::boolean
  from public.owner_recover_expired_refund_nayax_controlled_pilot() recovery
), 'Repeated recovery after rejection cannot be relabeled proven zero');
rollback to savepoint controlled_pilot_rejected_history;

savepoint controlled_pilot_resolved_unknown_history;
update public.refund_nayax_controlled_pilot_authorizations
set provider_outcome = 'unknown', worker_terminal_status = 'forced_unknown';
select ok((
  select (recovery ->> 'consumedAttemptCount')::integer = 1
    and recovery ->> 'providerCallCountStatus' = 'unknown'
    and (recovery ->> 'providerHold')::boolean
  from public.owner_recover_expired_refund_nayax_controlled_pilot() recovery
), 'Repeated recovery after forced-unknown resolution preserves consumed history');
rollback to savepoint controlled_pilot_resolved_unknown_history;

select ok((public.owner_cancel_refund_nayax_controlled_pilot(
  '43000000-0000-4000-8000-000000000010'
) ->> 'closed')::boolean, 'Safe close is idempotent after the pilot was consumed');

select is((select count(*)::integer
  from public.refund_case_nayax_refund_attempts), 1,
  'Exactly one provider attempt exists after the one-transaction pilot');

select * from finish();
rollback;
