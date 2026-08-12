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
  perform extensions.dblink_connect('legacy_normalization_local_guard', local_connection);
  perform extensions.dblink_disconnect('legacy_normalization_local_guard');
end;
$$;

begin;

drop schema if exists refund_legacy_normalization_race_test cascade;
create schema refund_legacy_normalization_race_test;

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values (
  '00000000-0000-0000-0000-000000000000',
  '8e000000-0000-4000-8000-000000000001',
  'authenticated', 'authenticated', 'legacy-race-manager@example.test', '', now(),
  '{}'::jsonb, '{}'::jsonb, now(), now()
);

insert into public.customer_accounts (id, name, account_type)
values ('8e100000-0000-4000-8000-000000000001', 'Legacy normalization race', 'customer');

insert into public.reporting_locations (id, account_id, name, timezone)
values (
  '8e200000-0000-4000-8000-000000000001',
  '8e100000-0000-4000-8000-000000000001',
  'Legacy normalization race location',
  'America/Los_Angeles'
);

insert into public.reporting_machines (
  id, account_id, location_id, machine_label, nayax_machine_id, nayax_account_key
)
values (
  '8e300000-0000-4000-8000-000000000001',
  '8e100000-0000-4000-8000-000000000001',
  '8e200000-0000-4000-8000-000000000001',
  'Legacy normalization race machine',
  'LEGACY-NORMALIZATION-RACE',
  'LEGACY-NORMALIZATION-RACE'
);

insert into public.refund_cases (
  id, reporting_machine_id, reporting_location_id, customer_email,
  issue_summary, incident_at, payment_method, payment_amount_cents,
  card_last4, status, decision, decided_by, decided_at,
  nayax_match_execution_eligible, nayax_refund_execution_status,
  automation_state, correlation_status, intake_source
)
select
  case_id,
  '8e300000-0000-4000-8000-000000000001'::uuid,
  '8e200000-0000-4000-8000-000000000001'::uuid,
  'legacy-race-' || ordinal::text || '@example.test',
  'Synthetic legacy normalization race ' || ordinal::text,
  now() - interval '2 days',
  'card', 700, '4242', 'card_refund_pending', 'approved',
  '8e000000-0000-4000-8000-000000000001'::uuid,
  now() - interval '1 day', false, 'not_requested', 'approved', 'matched', 'form'
from (values
  (1, '8e500000-0000-4000-8000-000000000001'::uuid),
  (2, '8e500000-0000-4000-8000-000000000002'::uuid),
  (3, '8e500000-0000-4000-8000-000000000003'::uuid),
  (4, '8e500000-0000-4000-8000-000000000004'::uuid)
) fixture(ordinal, case_id);

-- Recreate only the one historical sent approval required by the legacy
-- structure. Current production boundaries cannot create this contradiction.
alter table public.refund_case_messages
  disable trigger refund_case_messages_nayax_attempt_guard;
insert into public.refund_case_messages (
  refund_case_id, message_type, status, recipient_email, subject, body, sent_at
)
select
  case_id, 'approved', 'sent',
  'legacy-race-' || ordinal::text || '@example.test',
  'Historical approval', 'Historical body.', now() - interval '1 day'
from (values
  (1, '8e500000-0000-4000-8000-000000000001'::uuid),
  (2, '8e500000-0000-4000-8000-000000000002'::uuid),
  (3, '8e500000-0000-4000-8000-000000000003'::uuid),
  (4, '8e500000-0000-4000-8000-000000000004'::uuid)
) fixture(ordinal, case_id);
alter table public.refund_case_messages
  enable trigger refund_case_messages_nayax_attempt_guard;

create function refund_legacy_normalization_race_test.normalize(case_id uuid)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  result jsonb;
begin
  result := public.owner_normalize_refund_legacy_card_state(
    case_id,
    'NORMALIZE_LEGACY_CARD_STATE_WITHOUT_PROVIDER_ACTION'
  );
  return jsonb_build_object('ok', true, 'result', result);
exception when others then
  return jsonb_build_object('ok', false, 'errorClass', sqlstate);
end;
$$;

create function refund_legacy_normalization_race_test.insert_provider_attempt(case_id uuid)
returns jsonb
language plpgsql
set search_path = public
as $$
begin
  insert into public.refund_case_nayax_refund_attempts (
    refund_case_id, execution_mode, status, idempotency_key, amount_cents
  ) values (
    case_id, 'preflight', 'preflight_blocked',
    'legacy-race-' || case_id::text, 700
  );
  return jsonb_build_object('ok', true);
exception when others then
  return jsonb_build_object('ok', false, 'errorClass', sqlstate);
end;
$$;

create function refund_legacy_normalization_race_test.insert_customer_message(case_id uuid)
returns jsonb
language plpgsql
set search_path = public
as $$
begin
  insert into public.refund_case_messages (
    refund_case_id, message_type, status, recipient_email, subject, body
  ) values (
    case_id, 'status_update', 'pending',
    'legacy-race-customer@example.test', 'Blocked race', 'Blocked race'
  );
  return jsonb_build_object('ok', true);
exception when others then
  return jsonb_build_object('ok', false, 'errorClass', sqlstate);
end;
$$;

create function refund_legacy_normalization_race_test.update_case(case_id uuid)
returns jsonb
language plpgsql
set search_path = public
as $$
begin
  update public.refund_cases
  set status = 'denied', decision = 'denied'
  where id = case_id;
  return jsonb_build_object('ok', true);
exception when others then
  return jsonb_build_object('ok', false, 'errorClass', sqlstate);
end;
$$;

commit;

select plan(11);

create temporary table legacy_normalization_race_results (
  race_name text not null,
  connection_name text not null,
  result jsonb not null,
  primary key (race_name, connection_name)
);

do $$
declare
  local_connection text := 'host=db port=' || current_setting('port')
    || ' dbname=' || current_database()
    || ' user=postgres password=postgres sslmode=disable';
begin
  perform extensions.dblink_connect('legacy_normalization_owner_a', local_connection);
  perform extensions.dblink_connect('legacy_normalization_owner_b', local_connection);
  perform extensions.dblink_connect('legacy_normalization_provider_a', local_connection);
  perform extensions.dblink_connect('legacy_normalization_provider_b', local_connection);
  perform extensions.dblink_connect('legacy_normalization_message_a', local_connection);
  perform extensions.dblink_connect('legacy_normalization_message_b', local_connection);
  perform extensions.dblink_connect('legacy_normalization_case_a', local_connection);
  perform extensions.dblink_connect('legacy_normalization_case_b', local_connection);
end;
$$;

-- Two owner calls queue behind the same locked case. One normalizes, and the
-- other receives the idempotent replay response after the first commits.
begin;
select id from public.refund_cases
where id = '8e500000-0000-4000-8000-000000000001'
for update;
select extensions.dblink_send_query(
  'legacy_normalization_owner_a',
  $$select refund_legacy_normalization_race_test.normalize(
    '8e500000-0000-4000-8000-000000000001'
  )$$
);
select pg_sleep(0.05);
select extensions.dblink_send_query(
  'legacy_normalization_owner_b',
  $$select refund_legacy_normalization_race_test.normalize(
    '8e500000-0000-4000-8000-000000000001'
  )$$
);
commit;

insert into legacy_normalization_race_results
select 'owner_owner', 'a', result
from extensions.dblink_get_result('legacy_normalization_owner_a') as response(result jsonb);
insert into legacy_normalization_race_results
select 'owner_owner', 'b', result
from extensions.dblink_get_result('legacy_normalization_owner_b') as response(result jsonb);

select is(
  (select count(*)::integer from legacy_normalization_race_results
    where race_name = 'owner_owner' and (result ->> 'ok')::boolean),
  2,
  'Both concurrent owner calls return bounded successful responses'
);
select is(
  (select count(*)::integer from legacy_normalization_race_results
    where race_name = 'owner_owner'
      and (result #>> '{result,normalized}')::boolean),
  1,
  'Exactly one concurrent owner call performs the normalization'
);
select ok(
  (select count(*) = 1 from legacy_normalization_race_results
    where race_name = 'owner_owner'
      and (result #>> '{result,alreadyNormalized}')::boolean)
  and (select count(*) = 1 from public.refund_case_events
    where refund_case_id = '8e500000-0000-4000-8000-000000000001'
      and event_type = 'legacy_card_state_normalized'),
  'The losing owner call is an idempotent replay with no duplicate event'
);

-- Queue normalization first, then a provider-attempt insert. Both boundaries
-- lock the same case row, so the attempt revalidates only after normalization.
begin;
select id from public.refund_cases
where id = '8e500000-0000-4000-8000-000000000002'
for update;
select extensions.dblink_send_query(
  'legacy_normalization_provider_a',
  $$select refund_legacy_normalization_race_test.normalize(
    '8e500000-0000-4000-8000-000000000002'
  )$$
);
select pg_sleep(0.05);
select extensions.dblink_send_query(
  'legacy_normalization_provider_b',
  $$select refund_legacy_normalization_race_test.insert_provider_attempt(
    '8e500000-0000-4000-8000-000000000002'
  )$$
);
commit;

insert into legacy_normalization_race_results
select 'provider', 'normalize', result
from extensions.dblink_get_result('legacy_normalization_provider_a') as response(result jsonb);
insert into legacy_normalization_race_results
select 'provider', 'action', result
from extensions.dblink_get_result('legacy_normalization_provider_b') as response(result jsonb);

select ok(
  (select (result ->> 'ok')::boolean from legacy_normalization_race_results
    where race_name = 'provider' and connection_name = 'normalize')
  and not (select (result ->> 'ok')::boolean from legacy_normalization_race_results
    where race_name = 'provider' and connection_name = 'action'),
  'A provider attempt queued behind normalization fails closed'
);
select is(
  (select count(*)::integer from public.refund_case_nayax_refund_attempts
    where refund_case_id = '8e500000-0000-4000-8000-000000000002'),
  0,
  'The provider race creates no provider attempt'
);

-- The same lock-time revalidation freezes a customer-message insert.
begin;
select id from public.refund_cases
where id = '8e500000-0000-4000-8000-000000000003'
for update;
select extensions.dblink_send_query(
  'legacy_normalization_message_a',
  $$select refund_legacy_normalization_race_test.normalize(
    '8e500000-0000-4000-8000-000000000003'
  )$$
);
select pg_sleep(0.05);
select extensions.dblink_send_query(
  'legacy_normalization_message_b',
  $$select refund_legacy_normalization_race_test.insert_customer_message(
    '8e500000-0000-4000-8000-000000000003'
  )$$
);
commit;

insert into legacy_normalization_race_results
select 'message', 'normalize', result
from extensions.dblink_get_result('legacy_normalization_message_a') as response(result jsonb);
insert into legacy_normalization_race_results
select 'message', 'action', result
from extensions.dblink_get_result('legacy_normalization_message_b') as response(result jsonb);

select ok(
  (select (result ->> 'ok')::boolean from legacy_normalization_race_results
    where race_name = 'message' and connection_name = 'normalize')
  and not (select (result ->> 'ok')::boolean from legacy_normalization_race_results
    where race_name = 'message' and connection_name = 'action'),
  'A customer message queued behind normalization fails closed'
);
select is(
  (select count(*)::integer from public.refund_case_messages
    where refund_case_id = '8e500000-0000-4000-8000-000000000003'),
  1,
  'The message race preserves only the one historical sent approval'
);

-- A competing case decision also revalidates after the owner operation.
begin;
select id from public.refund_cases
where id = '8e500000-0000-4000-8000-000000000004'
for update;
select extensions.dblink_send_query(
  'legacy_normalization_case_a',
  $$select refund_legacy_normalization_race_test.normalize(
    '8e500000-0000-4000-8000-000000000004'
  )$$
);
select pg_sleep(0.05);
select extensions.dblink_send_query(
  'legacy_normalization_case_b',
  $$select refund_legacy_normalization_race_test.update_case(
    '8e500000-0000-4000-8000-000000000004'
  )$$
);
commit;

insert into legacy_normalization_race_results
select 'case', 'normalize', result
from extensions.dblink_get_result('legacy_normalization_case_a') as response(result jsonb);
insert into legacy_normalization_race_results
select 'case', 'action', result
from extensions.dblink_get_result('legacy_normalization_case_b') as response(result jsonb);

select ok(
  (select (result ->> 'ok')::boolean from legacy_normalization_race_results
    where race_name = 'case' and connection_name = 'normalize')
  and not (select (result ->> 'ok')::boolean from legacy_normalization_race_results
    where race_name = 'case' and connection_name = 'action'),
  'A case decision queued behind normalization fails closed'
);
select ok(
  exists (
    select 1 from public.refund_cases
    where id = '8e500000-0000-4000-8000-000000000004'
      and status = 'needs_review'
      and decision is null
      and nayax_refund_execution_status = 'not_requested'
      and nayax_match_execution_eligible = false
  ),
  'The case race ends only in truthful review state'
);

select is(
  (select count(*)::integer from public.refund_case_nayax_refund_attempts
    where refund_case_id in (
      '8e500000-0000-4000-8000-000000000001',
      '8e500000-0000-4000-8000-000000000002',
      '8e500000-0000-4000-8000-000000000003',
      '8e500000-0000-4000-8000-000000000004'
    )),
  0,
  'All concurrent paths complete with zero provider side effects'
);
select ok(
  (select count(*) = 4 from public.refund_case_events
    where refund_case_id in (
      '8e500000-0000-4000-8000-000000000001',
      '8e500000-0000-4000-8000-000000000002',
      '8e500000-0000-4000-8000-000000000003',
      '8e500000-0000-4000-8000-000000000004'
    ) and event_type = 'legacy_card_state_normalized')
  and (select count(*) = 4 from public.refund_case_messages
    where refund_case_id in (
      '8e500000-0000-4000-8000-000000000001',
      '8e500000-0000-4000-8000-000000000002',
      '8e500000-0000-4000-8000-000000000003',
      '8e500000-0000-4000-8000-000000000004'
    )),
  'All races create one redacted event per case and no customer communication'
);

do $$
begin
  perform extensions.dblink_disconnect('legacy_normalization_owner_a');
  perform extensions.dblink_disconnect('legacy_normalization_owner_b');
  perform extensions.dblink_disconnect('legacy_normalization_provider_a');
  perform extensions.dblink_disconnect('legacy_normalization_provider_b');
  perform extensions.dblink_disconnect('legacy_normalization_message_a');
  perform extensions.dblink_disconnect('legacy_normalization_message_b');
  perform extensions.dblink_disconnect('legacy_normalization_case_a');
  perform extensions.dblink_disconnect('legacy_normalization_case_b');
end;
$$;

begin;
delete from public.admin_audit_log
where entity_id in (
  '8e500000-0000-4000-8000-000000000001',
  '8e500000-0000-4000-8000-000000000002',
  '8e500000-0000-4000-8000-000000000003',
  '8e500000-0000-4000-8000-000000000004'
);
alter table public.refund_case_events
  disable trigger refund_case_events_guard_legacy_normalization;
delete from public.refund_cases
where id in (
  '8e500000-0000-4000-8000-000000000001',
  '8e500000-0000-4000-8000-000000000002',
  '8e500000-0000-4000-8000-000000000003',
  '8e500000-0000-4000-8000-000000000004'
);
alter table public.refund_case_events
  enable trigger refund_case_events_guard_legacy_normalization;
delete from public.reporting_machines
where id = '8e300000-0000-4000-8000-000000000001';
delete from public.reporting_locations
where id = '8e200000-0000-4000-8000-000000000001';
delete from public.customer_accounts
where id = '8e100000-0000-4000-8000-000000000001';
delete from auth.users
where id = '8e000000-0000-4000-8000-000000000001';
drop schema refund_legacy_normalization_race_test cascade;
commit;

select * from finish();
