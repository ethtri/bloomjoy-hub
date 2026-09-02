create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
set search_path = public, extensions;

-- Refuse to run the committed two-session fixture anywhere except the
-- disposable Supabase CLI database.
do $$
declare
  local_connection text := 'host=db port=' || current_setting('port')
    || ' dbname=' || current_database()
    || ' user=postgres password=postgres sslmode=disable';
begin
  perform extensions.dblink_connect('nayax_provider_local_guard', local_connection);
  perform extensions.dblink_disconnect('nayax_provider_local_guard');
end;
$$;

begin;

drop schema if exists refund_nayax_provider_race_test cascade;
create schema refund_nayax_provider_race_test;

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  '9b000000-0000-4000-8000-000000000001',
  'authenticated', 'authenticated', 'provider-race-manager@example.test', '', now(),
  '{}'::jsonb, '{}'::jsonb, now(), now()
);

insert into public.customer_accounts (id, name, account_type)
values ('9b100000-0000-4000-8000-000000000001', 'Provider reserve race', 'customer');
insert into public.reporting_locations (id, account_id, name, timezone)
values ('9b200000-0000-4000-8000-000000000001',
  '9b100000-0000-4000-8000-000000000001', 'Provider race location', 'America/Los_Angeles');
insert into public.reporting_machines (
  id, account_id, location_id, machine_label, nayax_machine_id,
  nayax_account_key, nayax_refunds_enabled, nayax_refund_max_amount_cents
) values ('9b300000-0000-4000-8000-000000000001',
  '9b100000-0000-4000-8000-000000000001',
  '9b200000-0000-4000-8000-000000000001',
  'Provider race machine', 'PROVIDER-RACE-MACHINE', 'PROVIDER-RACE-ACCOUNT', true, 2500);
insert into public.reporting_machine_refund_managers (
  id, reporting_machine_id, manager_user_id, manager_email, grant_reason
) values ('9b400000-0000-4000-8000-000000000001',
  '9b300000-0000-4000-8000-000000000001',
  '9b000000-0000-4000-8000-000000000001',
  'provider-race-manager@example.test', 'Provider reserve race');

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
  nayax_recommendation_evaluated_at, nayax_match_execution_eligible,
  lifecycle_integrity_status, lifecycle_integrity_code,
  lifecycle_integrity_detected_at
) values (
  '9b600000-0000-4000-8000-000000000001', 'RF-PROVIDER-RACE',
  '9b300000-0000-4000-8000-000000000001',
  '9b200000-0000-4000-8000-000000000001',
  'provider-race-customer@example.test', 'Synthetic reserve race',
  statement_timestamp() - interval '3 days', 'card', 700, 700,
  'card_refund_pending', 'approved', '9b000000-0000-4000-8000-000000000001',
  statement_timestamp() - interval '10 minutes', '4242', false,
  'matched', 'nayax', 1, 'PROVIDER-RACE-TX-001', 951,
  statement_timestamp() - interval '3 days', 700, '4242', 'USD',
  'high_confidence', 'provider-race-v1', statement_timestamp(), true,
  'hold', 'card_payment_state_without_attempt', statement_timestamp()
);

do $$
declare
  case_row public.refund_cases%rowtype;
  machine_row public.reporting_machines%rowtype;
  evidence_hash text;
  context_hash text;
  verified_at timestamptz := statement_timestamp() - interval '10 seconds';
begin
  select * into case_row from public.refund_cases
  where id = '9b600000-0000-4000-8000-000000000001';
  select * into machine_row from public.reporting_machines
  where id = case_row.reporting_machine_id;
  evidence_hash := public.refund_nayax_execution_evidence_hash(case_row, machine_row);
  context_hash := public.refund_official_action_context_hash(
    'nayax_execute', 'card_refund_pending', 'approved', null, null, null,
    700, null, null, false, null, null, null
  );

  insert into public.refund_manager_action_step_up_intents (
    id, actor_user_id, refund_case_id, action, target_function,
    manager_mapping_id, manager_mapping_version,
    manager_totp_enrollment_version, expected_case_version,
    action_context_hash, nayax_execution_evidence_hash,
    status, not_before, expires_at, factor_verified_at,
    verified_totp_at, consumed_at
  ) values (
    '9b700000-0000-4000-8000-000000000001',
    '9b000000-0000-4000-8000-000000000001',
    case_row.id, 'nayax_execute', 'nayax-card-refund',
    '9b400000-0000-4000-8000-000000000001', 1, 1,
    case_row.official_action_version, context_hash, evidence_hash,
    'consumed', statement_timestamp() - interval '30 seconds',
    statement_timestamp() + interval '60 seconds', verified_at,
    verified_at, verified_at
  );
  insert into public.refund_case_official_action_authorizations (
    id, refund_case_id, action, actor_user_id, manager_mapping_id,
    manager_mapping_version, expected_case_version, action_context_hash,
    status, expires_at, step_up_intent_id, verified_totp_at,
    nayax_execution_evidence_hash
  ) values (
    '9b800000-0000-4000-8000-000000000001', case_row.id, 'nayax_execute',
    '9b000000-0000-4000-8000-000000000001',
    '9b400000-0000-4000-8000-000000000001', 1,
    case_row.official_action_version, context_hash, 'authorized',
    statement_timestamp() + interval '5 minutes',
    '9b700000-0000-4000-8000-000000000001', verified_at, evidence_hash
  );
end;
$$;

insert into public.refund_nayax_provider_callers (caller_id, assertion_digest)
values ('nayax-card-refund', encode(
  extensions.digest(convert_to('provider-race-executor', 'UTF8'), 'sha256'), 'hex'
));

create function refund_nayax_provider_race_test.reserve()
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  reserved jsonb;
begin
  reserved := public.service_reserve_and_consume_nayax_refund_attempt_v2(
    'provider-race-executor',
    '9b800000-0000-4000-8000-000000000001',
    '9b600000-0000-4000-8000-000000000001',
    'nayax-refund-' || repeat('b', 64), 700, 100000, 100, 'USD'
  );
  return jsonb_build_object('ok', true, 'reservation', reserved);
exception when others then
  return jsonb_build_object('ok', false, 'errorClass', sqlstate);
end;
$$;

commit;

select plan(5);
create temporary table nayax_provider_race_results (
  connection_name text primary key,
  result jsonb not null
);

do $$
declare
  local_connection text := 'host=db port=' || current_setting('port')
    || ' dbname=' || current_database()
    || ' user=postgres password=postgres sslmode=disable';
begin
  perform extensions.dblink_connect('nayax_provider_race_a', local_connection);
  perform extensions.dblink_connect('nayax_provider_race_b', local_connection);
end;
$$;

-- Hold the exact authorization lock so both independent sessions start before
-- either can consume it or create the idempotency row.
begin;
select id from public.refund_case_official_action_authorizations
where id = '9b800000-0000-4000-8000-000000000001'
for update;
select extensions.dblink_send_query(
  'nayax_provider_race_a',
  'select refund_nayax_provider_race_test.reserve()'
);
select extensions.dblink_send_query(
  'nayax_provider_race_b',
  'select refund_nayax_provider_race_test.reserve()'
);
commit;

insert into nayax_provider_race_results (connection_name, result)
select 'a', result from extensions.dblink_get_result('nayax_provider_race_a')
  as response(result jsonb);
insert into nayax_provider_race_results (connection_name, result)
select 'b', result from extensions.dblink_get_result('nayax_provider_race_b')
  as response(result jsonb);

select is((select count(*)::integer from nayax_provider_race_results), 2,
  'Two independent reserve sessions return a bounded result');
select is((select count(*)::integer from nayax_provider_race_results
  where (result ->> 'ok')::boolean
    and (result #>> '{reservation,attempt,shouldExecute}')::boolean
    and length(result #>> '{reservation,providerClaimToken}') = 64), 1,
  'Exactly one reserve racer receives the raw provider claim');
select is((select count(*)::integer from public.refund_case_nayax_refund_attempts
  where refund_case_id = '9b600000-0000-4000-8000-000000000001'), 1,
  'Concurrent reserve creates exactly one immutable attempt');
select ok((select status = 'consumed' and consumed_at is not null
  from public.refund_case_official_action_authorizations
  where id = '9b800000-0000-4000-8000-000000000001'),
  'Concurrent reserve consumes the one manager authorization exactly once');
select ok((select count(*) = 1 from nayax_provider_race_results
  where not (result ->> 'ok')::boolean
     or (
       not (result #>> '{reservation,attempt,shouldExecute}')::boolean
       and result #> '{reservation,providerClaimToken}' = 'null'::jsonb
     )),
  'The losing racer fails safely or receives replay state without a provider claim');

do $$
begin
  perform extensions.dblink_disconnect('nayax_provider_race_a');
  perform extensions.dblink_disconnect('nayax_provider_race_b');
end;
$$;

begin;
delete from public.refund_case_nayax_refund_attempts
where refund_case_id = '9b600000-0000-4000-8000-000000000001';
delete from public.refund_case_official_action_authorizations
where id = '9b800000-0000-4000-8000-000000000001';
delete from public.refund_manager_action_step_up_intents
where id = '9b700000-0000-4000-8000-000000000001';
delete from public.refund_cases where id = '9b600000-0000-4000-8000-000000000001';
delete from public.reporting_machine_refund_managers
where id = '9b400000-0000-4000-8000-000000000001';
delete from public.reporting_machines where id = '9b300000-0000-4000-8000-000000000001';
delete from public.reporting_locations where id = '9b200000-0000-4000-8000-000000000001';
delete from public.customer_accounts where id = '9b100000-0000-4000-8000-000000000001';
delete from auth.users where id = '9b000000-0000-4000-8000-000000000001';
delete from public.refund_nayax_provider_callers where caller_id = 'nayax-card-refund';
drop schema refund_nayax_provider_race_test cascade;
commit;

select * from finish();
