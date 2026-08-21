create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
set search_path = public, extensions;

do $$
declare
  local_connection text := 'host=db port=' || current_setting('port')
    || ' dbname=' || current_database()
    || ' user=postgres password=postgres sslmode=disable';
begin
  perform extensions.dblink_connect('controlled_pilot_local_guard', local_connection);
  perform extensions.dblink_disconnect('controlled_pilot_local_guard');
end;
$$;

begin;
drop schema if exists refund_nayax_controlled_pilot_race_test cascade;
create schema refund_nayax_controlled_pilot_race_test;
create or replace function public.refund_nayax_controlled_pilot_audit_retention_approved()
returns boolean language sql immutable set search_path = public
as $$ select true; $$;
create or replace function public.refund_official_actions_enabled()
returns boolean language sql immutable set search_path = public
as $$ select false; $$;

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
('00000000-0000-0000-0000-000000000000',
 '44000000-0000-4000-8000-000000000001',
 'authenticated', 'authenticated', 'pilot-race-owner@example.test', '', now(),
 '{}'::jsonb, '{}'::jsonb, now(), now()),
('00000000-0000-0000-0000-000000000000',
 '44000000-0000-4000-8000-000000000002',
 'authenticated', 'authenticated', 'pilot-race-approver@example.test', '', now(),
 '{}'::jsonb, '{}'::jsonb, now(), now());
insert into public.customer_accounts (id, name, account_type)
values ('44100000-0000-4000-8000-000000000001', 'Pilot race', 'customer');
insert into public.reporting_locations (id, account_id, name, timezone)
values ('44200000-0000-4000-8000-000000000001',
  '44100000-0000-4000-8000-000000000001', 'Pilot race location', 'America/Los_Angeles');
insert into public.reporting_machines (
  id, account_id, location_id, machine_label, status, nayax_machine_id,
  nayax_account_key, nayax_refunds_enabled, nayax_refund_max_amount_cents
) values ('44300000-0000-4000-8000-000000000001',
  '44100000-0000-4000-8000-000000000001',
  '44200000-0000-4000-8000-000000000001',
  'Pilot race machine', 'active', 'PILOT-RACE-MACHINE',
  'PILOT-RACE-ACCOUNT', false, null);
insert into public.reporting_machine_refund_managers (
  id, reporting_machine_id, manager_user_id, manager_email, grant_reason
) values ('44400000-0000-4000-8000-000000000001',
  '44300000-0000-4000-8000-000000000001',
  '44000000-0000-4000-8000-000000000001',
  'pilot-race-owner@example.test', 'Controlled pilot concurrency');
insert into public.refund_manager_totp_enrollments (
  actor_user_id, approved_factor_binding_hash, owner_approved_by_user_id,
  owner_approval_version, enrollment_version
) values ('44000000-0000-4000-8000-000000000001', repeat('a',64),
  '44000000-0000-4000-8000-000000000002', 1, 1);
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
) values ('44600000-0000-4000-8000-000000000001', 'RF-PILOT-RACE',
  '44300000-0000-4000-8000-000000000001',
  '44200000-0000-4000-8000-000000000001',
  'pilot-race-owner@example.test', 'Controlled pilot race fixture',
  statement_timestamp() - interval '1 day', 'card', 700, 700,
  'correlated', null,
  null, null, '4242', false,
  'matched', 'nayax', 1, '223456789', 43,
  statement_timestamp() - interval '1 day', 700, '4242', 'USD',
  'high_confidence', 'controlled-pilot-race-v1', statement_timestamp(), true);

create function refund_nayax_controlled_pilot_race_test.authorize(p_id uuid)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  case_digest text;
  machine_digest text;
  owner_email_digest text;
  self_attestation_digest text;
  account_key_digest text;
begin
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
  ), 'UTF8'), 'sha256'), 'hex'),
  encode(extensions.digest(convert_to(concat_ws('|',
    machine.id::text, machine.nayax_machine_id,
    machine.nayax_account_key, '700'
  ), 'UTF8'), 'sha256'), 'hex')
  into case_digest, machine_digest
  from public.refund_cases refund_case
  join public.reporting_machines machine
    on machine.id = refund_case.reporting_machine_id
  where refund_case.id = '44600000-0000-4000-8000-000000000001';
  owner_email_digest := encode(extensions.digest(convert_to(
    'pilot-race-owner@example.test', 'UTF8'
  ), 'sha256'), 'hex');
  select public.refund_nayax_controlled_pilot_self_attestation_hash(
    refund_case, machine, owner_email_digest, 700
  ), encode(extensions.digest(convert_to('PILOT_RACE_ACCOUNT', 'UTF8'), 'sha256'), 'hex')
  into self_attestation_digest, account_key_digest
  from public.refund_cases refund_case
  join public.reporting_machines machine on machine.id = refund_case.reporting_machine_id
  where refund_case.id = '44600000-0000-4000-8000-000000000001';
  return jsonb_build_object(
    'ok', true,
    'value', public.owner_authorize_refund_nayax_controlled_pilot(
      p_id,
      '44000000-0000-4000-8000-000000000001',
      '44600000-0000-4000-8000-000000000001',
      (select official_action_version from public.refund_cases
        where id = '44600000-0000-4000-8000-000000000001'),
      700, case_digest, owner_email_digest, self_attestation_digest,
      machine_digest, account_key_digest, repeat('2',64),
      encode(extensions.digest(convert_to('controlled-pilot-race-executor', 'UTF8'), 'sha256'), 'hex'),
      repeat('3',64), 'nayax-written-contract-v1', repeat('4',64), repeat('5',64)
    )
  );
exception when others then
  return jsonb_build_object('ok', false, 'errorClass', sqlstate);
end;
$$;
commit;

select plan(12);
create temporary table controlled_pilot_race_results (
  connection_name text primary key,
  result jsonb not null
);

do $$
declare
  local_connection text := 'host=db port=' || current_setting('port')
    || ' dbname=' || current_database()
    || ' user=postgres password=postgres sslmode=disable';
begin
  perform extensions.dblink_connect('controlled_pilot_race_a', local_connection);
  perform extensions.dblink_connect('controlled_pilot_race_b', local_connection);
end;
$$;

begin;
select pg_advisory_xact_lock(hashtextextended('refund-nayax-controlled-owner-pilot', 430));
select extensions.dblink_send_query('controlled_pilot_race_a',
  $$select refund_nayax_controlled_pilot_race_test.authorize(
    '44000000-0000-4000-8000-000000000010')$$);
select extensions.dblink_send_query('controlled_pilot_race_b',
  $$select refund_nayax_controlled_pilot_race_test.authorize(
    '44000000-0000-4000-8000-000000000011')$$);
commit;

insert into controlled_pilot_race_results
select 'a', result from extensions.dblink_get_result('controlled_pilot_race_a')
  as response(result jsonb);
insert into controlled_pilot_race_results
select 'b', result from extensions.dblink_get_result('controlled_pilot_race_b')
  as response(result jsonb);

select is((select count(*)::integer from controlled_pilot_race_results), 2,
  'Two independent owner authorization sessions return');
select is((select count(*)::integer from controlled_pilot_race_results
  where (result ->> 'ok')::boolean), 1,
  'Exactly one concurrent owner authorization succeeds');
select is((select count(*)::integer
  from public.refund_nayax_controlled_pilot_authorizations), 1,
  'The singleton database invariant leaves one armed authorization');
select is((select count(*)::integer
  from public.refund_manager_action_step_up_intents where status = 'pending'), 1,
  'The losing authorization cannot create another TOTP intent');

do $$
declare
  local_connection text := 'host=db port=' || current_setting('port')
    || ' dbname=' || current_database()
    || ' user=postgres password=postgres sslmode=disable';
begin
  perform extensions.dblink_disconnect('controlled_pilot_race_a');
  perform extensions.dblink_disconnect('controlled_pilot_race_b');
  perform extensions.dblink_connect('controlled_pilot_race_a', local_connection);
end;
$$;

begin;
delete from public.refund_nayax_controlled_pilot_authorizations;
delete from public.refund_manager_step_up_audit
where refund_case_id = '44600000-0000-4000-8000-000000000001';
delete from public.refund_manager_action_step_up_intents
where refund_case_id = '44600000-0000-4000-8000-000000000001';
delete from public.refund_nayax_provider_callers
where caller_id = 'nayax-card-refund';
update public.reporting_machines
set nayax_refunds_enabled = false,
    nayax_refund_max_amount_cents = null
where id = '44300000-0000-4000-8000-000000000001';
commit;

truncate controlled_pilot_race_results;
begin;
select pg_advisory_xact_lock(hashtextextended('refund-nayax-controlled-owner-pilot', 430));
select extensions.dblink_send_query('controlled_pilot_race_a',
  $$select refund_nayax_controlled_pilot_race_test.authorize(
    '44000000-0000-4000-8000-000000000012')$$);
select public.owner_cancel_refund_nayax_controlled_pilot(
  '44000000-0000-4000-8000-000000000012');
commit;

insert into controlled_pilot_race_results
select 'close-wins', result
from extensions.dblink_get_result('controlled_pilot_race_a')
  as response(result jsonb);

select is((select (result ->> 'ok')::boolean
  from controlled_pilot_race_results where connection_name = 'close-wins'), false,
  'A pending authorize rejects when close wins the global lock');
select is((select count(*)::integer
  from public.refund_nayax_controlled_pilot_authorizations), 0,
  'Close-first race leaves no armed authorization');
select ok(
  (select count(*) = 1 from public.refund_nayax_controlled_pilot_closures)
  and (select count(*) = 0 from public.refund_case_nayax_refund_attempts),
  'Close-first race leaves only one redacted tombstone and zero attempts'
);

do $$
begin
  perform extensions.dblink_disconnect('controlled_pilot_race_a');
end;
$$;

begin;
delete from public.refund_nayax_controlled_pilot_closures;
delete from public.refund_nayax_controlled_pilot_authorizations;
delete from public.refund_manager_step_up_audit
where refund_case_id = '44600000-0000-4000-8000-000000000001';
delete from public.refund_manager_action_step_up_intents
where refund_case_id = '44600000-0000-4000-8000-000000000001';
delete from public.refund_nayax_provider_callers
where caller_id = 'nayax-card-refund';
update public.reporting_machines
set nayax_refunds_enabled = false,
    nayax_refund_max_amount_cents = null
where id = '44300000-0000-4000-8000-000000000001';
commit;

select ok((refund_nayax_controlled_pilot_race_test.authorize(
  '44000000-0000-4000-8000-000000000013'
) ->> 'ok')::boolean, 'A crash fixture arms the exact pilot before process loss');
update public.refund_nayax_controlled_pilot_authorizations
set expires_at = clock_timestamp() - interval '1 second';

select ok((
  select (recovery ->> 'closed')::boolean
    and (recovery ->> 'cancelledAuthorizationCount')::integer = 1
    and (recovery ->> 'cancelledIntentCount')::integer = 1
    and (recovery ->> 'consumedAttemptCount')::integer = 0
    and recovery ->> 'providerCallCountStatus' = 'proven_zero'
  from (select public.owner_recover_expired_refund_nayax_controlled_pilot()
    as recovery) result
), 'No-target recovery cancels exactly one expired armed authorization');
select ok((
  select pilot.status = 'cancelled'
    and intent.status = 'cancelled'
    and machine.nayax_refunds_enabled is false
    and machine.nayax_refund_max_amount_cents is null
    and caller.status = 'revoked'
    and not exists (select 1 from public.refund_case_nayax_refund_attempts)
  from public.refund_nayax_controlled_pilot_authorizations pilot
  join public.refund_manager_action_step_up_intents intent
    on intent.id = pilot.step_up_intent_id
  join public.reporting_machines machine
    on machine.id = pilot.reporting_machine_id
  join public.refund_nayax_provider_callers caller
    on caller.caller_id = 'nayax-card-refund'
), 'Crash recovery disables the machine, revokes the caller, and creates no attempt');

begin;
delete from public.refund_nayax_controlled_pilot_closures;
delete from public.refund_nayax_controlled_pilot_authorizations;
delete from public.refund_manager_step_up_audit
where refund_case_id = '44600000-0000-4000-8000-000000000001';
delete from public.refund_manager_action_step_up_intents
where refund_case_id = '44600000-0000-4000-8000-000000000001';
delete from public.refund_nayax_provider_callers
where caller_id = 'nayax-card-refund';
update public.reporting_machines
set nayax_refunds_enabled = false,
    nayax_refund_max_amount_cents = null
where id = '44300000-0000-4000-8000-000000000001';
commit;

do $$
declare
  local_connection text := 'host=db port=' || current_setting('port')
    || ' dbname=' || current_database()
    || ' user=postgres password=postgres sslmode=disable';
begin
  perform extensions.dblink_connect('controlled_pilot_race_a', local_connection);
end;
$$;

truncate controlled_pilot_race_results;
begin;
select pg_advisory_xact_lock(hashtextextended('refund-nayax-controlled-owner-pilot', 430));
select extensions.dblink_send_query('controlled_pilot_race_a',
  $$select refund_nayax_controlled_pilot_race_test.authorize(
    '44000000-0000-4000-8000-000000000014')$$);
select public.owner_recover_expired_refund_nayax_controlled_pilot();
commit;

insert into controlled_pilot_race_results
select 'recovery-wins', result
from extensions.dblink_get_result('controlled_pilot_race_a')
  as response(result jsonb);
select is((select (result ->> 'ok')::boolean
  from controlled_pilot_race_results where connection_name = 'recovery-wins'), false,
  'A pending authorize rejects when no-target recovery wins the global lock');
select ok(
  (select count(*) = 1 from public.refund_nayax_controlled_pilot_closures)
  and (select count(*) = 0 from public.refund_nayax_controlled_pilot_authorizations)
  and (select count(*) = 0 from public.refund_case_nayax_refund_attempts)
  and (select nayax_refunds_enabled is false
    and nayax_refund_max_amount_cents is null
    from public.reporting_machines
    where id = '44300000-0000-4000-8000-000000000001')
  and not exists (select 1 from public.refund_nayax_provider_callers),
  'Recovery-first race leaves only a durable closure and zero provider surface'
);

do $$
begin
  perform extensions.dblink_disconnect('controlled_pilot_race_a');
end;
$$;

begin;
delete from public.refund_nayax_controlled_pilot_closures;
delete from public.refund_manager_step_up_audit
where refund_case_id = '44600000-0000-4000-8000-000000000001';
delete from public.refund_manager_totp_enrollments
where actor_user_id = '44000000-0000-4000-8000-000000000001';
delete from public.refund_cases where id = '44600000-0000-4000-8000-000000000001';
delete from public.reporting_machine_refund_managers
where id = '44400000-0000-4000-8000-000000000001';
delete from public.reporting_machines where id = '44300000-0000-4000-8000-000000000001';
delete from public.reporting_locations where id = '44200000-0000-4000-8000-000000000001';
delete from public.customer_accounts where id = '44100000-0000-4000-8000-000000000001';
delete from auth.users where id in (
  '44000000-0000-4000-8000-000000000001',
  '44000000-0000-4000-8000-000000000002'
);
drop schema refund_nayax_controlled_pilot_race_test cascade;
create or replace function public.refund_nayax_controlled_pilot_audit_retention_approved()
returns boolean language sql immutable set search_path = public
as $$ select false; $$;
create or replace function public.refund_official_actions_enabled()
returns boolean language sql immutable set search_path = public
as $$ select true; $$;
commit;

select * from finish();
