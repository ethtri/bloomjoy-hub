create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
set search_path = public, extensions;

-- Fail before committing fixtures or replacing any gate if this is not the
-- disposable Supabase CLI database (whose Docker service alias and local-only
-- password are fixed). Never run this file with `supabase test db --linked`.
do $$
declare
  local_connection text := 'host=db port=' || current_setting('port')
    || ' dbname=' || current_database()
    || ' user=postgres password=postgres sslmode=disable';
begin
  perform extensions.dblink_connect('step_up_local_guard', local_connection);
  perform extensions.dblink_disconnect('step_up_local_guard');
end;
$$;

-- These fixtures are committed before the remote dblink sessions start so
-- both database sessions race against the same durable state.
begin;

drop schema if exists refund_step_up_race_test cascade;
create schema refund_step_up_race_test;

create table refund_step_up_race_test.factor_proofs (
  intent_id uuid primary key,
  proof text not null
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  ('00000000-0000-0000-0000-000000000000', '8b000000-0000-4000-8000-000000000001',
   'authenticated', 'authenticated', 'step-up-race-manager@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '8b000000-0000-4000-8000-000000000002',
   'authenticated', 'authenticated', 'step-up-race-owner@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now());

insert into public.customer_accounts (id, name, account_type)
values ('8b100000-0000-4000-8000-000000000001', 'Step-up race safety', 'customer');

insert into public.reporting_locations (id, account_id, name, timezone)
values (
  '8b200000-0000-4000-8000-000000000001',
  '8b100000-0000-4000-8000-000000000001',
  'Step-up race location',
  'America/Los_Angeles'
);

insert into public.reporting_machines (
  id, account_id, location_id, machine_label, nayax_machine_id,
  nayax_account_key, nayax_refunds_enabled, nayax_refund_max_amount_cents
)
values (
  '8b300000-0000-4000-8000-000000000001',
  '8b100000-0000-4000-8000-000000000001',
  '8b200000-0000-4000-8000-000000000001',
  'Step-up race machine', 'STEP-UP-RACE-MACHINE', 'STEP-UP-RACE-ACCOUNT', true, 2500
);

insert into public.reporting_machine_refund_managers (
  id, reporting_machine_id, manager_user_id, manager_email, grant_reason
)
values (
  '8b400000-0000-4000-8000-000000000001',
  '8b300000-0000-4000-8000-000000000001',
  '8b000000-0000-4000-8000-000000000001',
  'step-up-race-manager@example.test',
  'Two-session step-up race regression'
), (
  '8b400000-0000-4000-8000-000000000002',
  '8b300000-0000-4000-8000-000000000001',
  '8b000000-0000-4000-8000-000000000002',
  'step-up-race-owner@example.test',
  'Two-session owner-window race regression'
);

insert into public.admin_roles (id, user_id, role, active)
values (
  '8b410000-0000-4000-8000-000000000001',
  '8b000000-0000-4000-8000-000000000002',
  'super_admin',
  true
);

update public.refund_manager_security_config
set
  totp_enrollment_enabled = false,
  totp_enrollment_approved_manager_user_id = null,
  totp_enrollment_approved_by_owner_user_id = null,
  totp_enrollment_approval_expires_at = null,
  totp_enrollment_owner_user_id_digest = encode(
    extensions.digest(
      convert_to('8b000000-0000-4000-8000-000000000002', 'UTF8'),
      'sha256'
    ),
    'hex'
  )
where singleton = true;

insert into public.machine_sales_facts (
  id, reporting_machine_id, reporting_location_id, sale_date, payment_method,
  net_sales_cents, transaction_count, source, source_row_hash, raw_payload
)
values (
  '8b500000-0000-4000-8000-000000000001',
  '8b300000-0000-4000-8000-000000000001',
  '8b200000-0000-4000-8000-000000000001',
  current_date, 'cash', 1400, 2, 'sample_seed', 'step-up-race-sale', '{"fixture":true}'::jsonb
);

insert into public.refund_cases (
  id, public_reference, reporting_machine_id, reporting_location_id,
  customer_email, zelle_payment_contact, issue_summary, incident_at,
  payment_method, payment_amount_cents, status, correlation_status,
  correlation_source, correlation_confidence, matched_sales_fact_id,
  refund_amount_cents, nayax_match_execution_eligible
)
values
  ('8b600000-0000-4000-8000-000000000001', 'RF-STEP-UP-RACE-ONE',
   '8b300000-0000-4000-8000-000000000001', '8b200000-0000-4000-8000-000000000001',
   'step-up-race-one@example.test', 'synthetic-contact', 'Step-up race one', now() - interval '2 hours',
   'cash', 700, 'needs_review', 'matched', 'sunze', 0.95,
   '8b500000-0000-4000-8000-000000000001', 700, false),
  ('8b600000-0000-4000-8000-000000000002', 'RF-STEP-UP-RACE-TWO',
   '8b300000-0000-4000-8000-000000000001', '8b200000-0000-4000-8000-000000000001',
   'step-up-race-two@example.test', 'synthetic-contact', 'Step-up race two', now() - interval '2 hours',
   'cash', 650, 'needs_review', 'matched', 'sunze', 0.95,
   '8b500000-0000-4000-8000-000000000001', 650, false);

insert into public.refund_manager_totp_enrollments (
  actor_user_id, approved_factor_binding_hash, owner_approved_by_user_id,
  owner_approval_version, enrollment_version
)
values (
  '8b000000-0000-4000-8000-000000000001', repeat('d', 64),
  '8b000000-0000-4000-8000-000000000002', 1, 1
);

create or replace function public.refund_official_actions_enabled()
returns boolean
language sql
stable
set search_path = public
as $$
  select coalesce(current_setting('refund.step_up_race_enabled', true), '') = 'on';
$$;

create function refund_step_up_race_test.prepare(p_case_id uuid)
returns jsonb
language plpgsql
set search_path = public, auth
as $$
declare
  prepared jsonb;
begin
  perform set_config('refund.step_up_race_enabled', 'on', true);
  perform set_config('request.jwt.claim.sub', '8b000000-0000-4000-8000-000000000001', true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', '8b000000-0000-4000-8000-000000000001',
      'role', 'authenticated',
      'aal', 'aal1',
      'amr', jsonb_build_array(jsonb_build_object('method', 'password', 'timestamp', extract(epoch from statement_timestamp())))
    )::text,
    true
  );
  prepared := public.admin_prepare_refund_action_step_up_intent(
    p_case_id,
    'approve',
    'refund-case-admin-update',
    (select official_action_version from public.refund_cases where id = p_case_id),
    'cash_zelle_pending',
    'approved',
    null, null, null,
    (select refund_amount_cents from public.refund_cases where id = p_case_id),
    null, null, false, null, null
  );
  return jsonb_build_object('ok', true, 'intentId', prepared ->> 'intentId');
exception when others then
  return jsonb_build_object('ok', false, 'error', sqlerrm);
end;
$$;

create function refund_step_up_race_test.consume(p_intent_id uuid)
returns jsonb
language plpgsql
set search_path = public, auth
as $$
declare
  pending_intent public.refund_manager_action_step_up_intents%rowtype;
  consumed jsonb;
begin
  select intent.*
  into pending_intent
  from public.refund_manager_action_step_up_intents intent
  where intent.id = p_intent_id;

  perform set_config('refund.step_up_race_enabled', 'on', true);
  perform set_config('request.jwt.claim.sub', '8b000000-0000-4000-8000-000000000001', true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', '8b000000-0000-4000-8000-000000000001',
      'role', 'authenticated',
      'aal', 'aal2',
      'amr', jsonb_build_array(jsonb_build_object(
        'method', 'totp',
        'timestamp', extract(epoch from date_trunc('second', pending_intent.not_before) + interval '20 seconds')
      ))
    )::text,
    true
  );
  consumed := public.admin_consume_refund_action_step_up_intent(
    pending_intent.id,
    pending_intent.refund_case_id,
    'approve',
    'refund-case-admin-update',
    pending_intent.expected_case_version,
    'cash_zelle_pending',
    'approved',
    null, null, null,
    (select refund_amount_cents from public.refund_cases where id = pending_intent.refund_case_id),
    null, null, false, null, null,
    (select proof from refund_step_up_race_test.factor_proofs where intent_id = pending_intent.id)
  );
  return jsonb_build_object('ok', true, 'authorizationId', consumed ->> 'authorizationId');
exception when others then
  return jsonb_build_object('ok', false, 'error', sqlerrm);
end;
$$;

create function refund_step_up_race_test.open_owner_window()
returns jsonb
language plpgsql
set search_path = public, auth
as $$
declare
  opened jsonb;
begin
  perform set_config('request.jwt.claim.sub', '8b000000-0000-4000-8000-000000000002', true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', '8b000000-0000-4000-8000-000000000002',
      'role', 'authenticated',
      'aal', 'aal1',
      'amr', '[]'::jsonb
    )::text,
    true
  );
  opened := public.open_refund_manager_totp_enrollment_window_current_user();
  return jsonb_build_object(
    'ok', true,
    'opened', opened -> 'opened',
    'status', opened -> 'status',
    'windowExpiresAt', opened -> 'windowExpiresAt'
  );
exception when others then
  return jsonb_build_object('ok', false, 'error', sqlerrm);
end;
$$;

commit;

select plan(7);

create temporary table step_up_prepare_race_results (
  connection_name text primary key,
  result jsonb not null
);
create temporary table step_up_consume_race_results (
  connection_name text primary key,
  result jsonb not null
);
create temporary table owner_window_race_results (
  connection_name text primary key,
  result jsonb not null
);
create temporary table owner_window_race_baseline as
select config.totp_enrollment_approval_version as approval_version
from public.refund_manager_security_config config
where config.singleton = true;

do $$
declare
  local_connection text := 'host=db port=' || current_setting('port')
    || ' dbname=' || current_database()
    || ' user=postgres password=postgres sslmode=disable';
begin
  -- `postgres` is the fixed disposable-local password provisioned by the
  -- Supabase CLI; this test is never run against a linked database.
  perform extensions.dblink_connect('step_up_prepare_a', local_connection);
  perform extensions.dblink_connect('step_up_prepare_b', local_connection);
end;
$$;

-- Hold the same actor lock while both remote sessions are launched. Releasing
-- this transaction queues both independent prepare statements on the exact
-- lock used by production RPCs, forcing a genuine two-session race.
begin;
do $$
begin
  perform pg_advisory_xact_lock(hashtextextended('8b000000-0000-4000-8000-000000000001', 692));
  perform extensions.dblink_send_query(
    'step_up_prepare_a',
    $query$select refund_step_up_race_test.prepare('8b600000-0000-4000-8000-000000000001')$query$
  );
  perform extensions.dblink_send_query(
    'step_up_prepare_b',
    $query$select refund_step_up_race_test.prepare('8b600000-0000-4000-8000-000000000002')$query$
  );
end;
$$;
commit;

insert into step_up_prepare_race_results (connection_name, result)
select 'a', result
from extensions.dblink_get_result('step_up_prepare_a') as response(result jsonb);
insert into step_up_prepare_race_results (connection_name, result)
select 'b', result
from extensions.dblink_get_result('step_up_prepare_b') as response(result jsonb);

select is(
  (select count(*)::integer from step_up_prepare_race_results where (result ->> 'ok')::boolean),
  2,
  'Two independent database sessions both complete serialized prepare calls'
);
select ok(
  (select count(*) = 1 from public.refund_manager_action_step_up_intents
    where actor_user_id = '8b000000-0000-4000-8000-000000000001' and status = 'pending')
  and (select count(*) = 1 from public.refund_manager_action_step_up_intents
    where actor_user_id = '8b000000-0000-4000-8000-000000000001' and status = 'superseded'),
  'Concurrent prepare calls leave exactly one live intent and supersede the other'
);

-- Mimic the trusted Edge Function once: an exact approved factor challenge
-- mints one opaque proof before two independent target-consumption sessions
-- race with the same frozen intent.
do $$
declare
  pending_intent_id uuid;
  marker jsonb;
begin
  select id into strict pending_intent_id
  from public.refund_manager_action_step_up_intents
  where actor_user_id = '8b000000-0000-4000-8000-000000000001'
    and status = 'pending';

  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  marker := public.service_mark_refund_manager_step_up_factor_verified(
    '8b000000-0000-4000-8000-000000000001',
    pending_intent_id,
    repeat('d', 64)
  );
  insert into refund_step_up_race_test.factor_proofs (intent_id, proof)
  values (pending_intent_id, marker ->> 'factorVerificationProof');
end;
$$;

-- Close the completed async commands and use two fresh database sessions for
-- the independent consume race.
do $$
declare
  local_connection text := 'host=db port=' || current_setting('port')
    || ' dbname=' || current_database()
    || ' user=postgres password=postgres sslmode=disable';
begin
  perform extensions.dblink_disconnect('step_up_prepare_a');
  perform extensions.dblink_disconnect('step_up_prepare_b');
  perform extensions.dblink_connect('step_up_prepare_a', local_connection);
  perform extensions.dblink_connect('step_up_prepare_b', local_connection);
end;
$$;

begin;
do $$
declare
  live_intent_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('8b000000-0000-4000-8000-000000000001', 692));
  select id into live_intent_id
  from public.refund_manager_action_step_up_intents
  where actor_user_id = '8b000000-0000-4000-8000-000000000001'
    and status = 'pending';
  perform extensions.dblink_send_query(
    'step_up_prepare_a',
    format('select refund_step_up_race_test.consume(%L)', live_intent_id)
  );
  perform extensions.dblink_send_query(
    'step_up_prepare_b',
    format('select refund_step_up_race_test.consume(%L)', live_intent_id)
  );
end;
$$;
commit;

insert into step_up_consume_race_results (connection_name, result)
select 'a', result
from extensions.dblink_get_result('step_up_prepare_a') as response(result jsonb);
insert into step_up_consume_race_results (connection_name, result)
select 'b', result
from extensions.dblink_get_result('step_up_prepare_b') as response(result jsonb);

select is(
  (select count(*)::integer from step_up_consume_race_results where (result ->> 'ok')::boolean),
  1,
  'Exactly one of two concurrent sessions can consume the same intent'
);
select ok(
  (select count(*) = 1 from public.refund_manager_action_step_up_intents
    where actor_user_id = '8b000000-0000-4000-8000-000000000001' and status = 'consumed')
  and (select count(*) = 1 from public.refund_case_official_action_authorizations
    where actor_user_id = '8b000000-0000-4000-8000-000000000001')
  and (select count(*) = 1 from public.refund_manager_step_up_audit
    where actor_user_id = '8b000000-0000-4000-8000-000000000001' and event_type = 'intent_consumed'),
  'The consume race commits one receipt and one sanitized consumption audit row'
);

-- Reuse the two independent sessions for a genuine enrollment-window open
-- race. The singleton advisory lock must serialize both callers without
-- extending the first five-minute expiry or creating a second open audit.
do $$
declare
  local_connection text := 'host=db port=' || current_setting('port')
    || ' dbname=' || current_database()
    || ' user=postgres password=postgres sslmode=disable';
begin
  perform extensions.dblink_disconnect('step_up_prepare_a');
  perform extensions.dblink_disconnect('step_up_prepare_b');
  perform extensions.dblink_connect('step_up_prepare_a', local_connection);
  perform extensions.dblink_connect('step_up_prepare_b', local_connection);
end;
$$;

begin;
do $$
begin
  perform pg_advisory_xact_lock(
    hashtextextended('refund-totp-enrollment-owner-window', 782)
  );
  perform extensions.dblink_send_query(
    'step_up_prepare_a',
    'select refund_step_up_race_test.open_owner_window()'
  );
  perform extensions.dblink_send_query(
    'step_up_prepare_b',
    'select refund_step_up_race_test.open_owner_window()'
  );
end;
$$;
commit;

insert into owner_window_race_results (connection_name, result)
select 'a', result
from extensions.dblink_get_result('step_up_prepare_a') as response(result jsonb);
insert into owner_window_race_results (connection_name, result)
select 'b', result
from extensions.dblink_get_result('step_up_prepare_b') as response(result jsonb);

select ok(
  (select count(*) = 2 from owner_window_race_results where (result ->> 'ok')::boolean)
  and (select count(*) = 1 from owner_window_race_results
    where (result ->> 'opened')::boolean)
  and (select count(*) = 1 from owner_window_race_results
    where result ->> 'status' = 'already_open'),
  'Two concurrent owner opens serialize into one open and one non-extending replay'
);

select ok(
  exists (
    select 1
    from public.refund_manager_security_config config
    cross join owner_window_race_baseline baseline
    where config.singleton = true
      and config.totp_enrollment_enabled
      and config.totp_enrollment_approved_manager_user_id = '8b000000-0000-4000-8000-000000000002'
      and config.totp_enrollment_approved_by_owner_user_id = '8b000000-0000-4000-8000-000000000002'
      and config.totp_enrollment_approval_version = baseline.approval_version + 1
      and config.totp_enrollment_approval_expires_at = config.updated_at + interval '5 minutes'
  )
  and (select count(*) = 1 from public.refund_manager_step_up_audit audit
    where audit.actor_user_id = '8b000000-0000-4000-8000-000000000002'
      and audit.event_type = 'totp_enrollment_window_opened'),
  'Concurrent owner opens commit one exact target, one version increment, one expiry, and one audit row'
);

do $$
begin
  perform extensions.dblink_disconnect('step_up_prepare_a');
  perform extensions.dblink_disconnect('step_up_prepare_b');
end;
$$;

begin;
delete from public.refund_manager_step_up_audit
where actor_user_id in (
  '8b000000-0000-4000-8000-000000000001',
  '8b000000-0000-4000-8000-000000000002'
);
delete from public.refund_case_official_action_authorizations
where actor_user_id = '8b000000-0000-4000-8000-000000000001';
delete from public.refund_manager_action_step_up_intents
where actor_user_id = '8b000000-0000-4000-8000-000000000001';
delete from public.refund_manager_totp_enrollments
where actor_user_id = '8b000000-0000-4000-8000-000000000001';
delete from public.refund_cases
where id in (
  '8b600000-0000-4000-8000-000000000001',
  '8b600000-0000-4000-8000-000000000002'
);
delete from public.machine_sales_facts
where id = '8b500000-0000-4000-8000-000000000001';
delete from public.reporting_machine_refund_managers
where id in (
  '8b400000-0000-4000-8000-000000000001',
  '8b400000-0000-4000-8000-000000000002'
);
delete from public.admin_roles
where id = '8b410000-0000-4000-8000-000000000001';
delete from public.reporting_machines
where id = '8b300000-0000-4000-8000-000000000001';
delete from public.reporting_locations
where id = '8b200000-0000-4000-8000-000000000001';
delete from public.customer_accounts
where id = '8b100000-0000-4000-8000-000000000001';
update public.refund_manager_security_config
set
  totp_enrollment_enabled = false,
  totp_enrollment_approved_manager_user_id = null,
  totp_enrollment_approved_by_owner_user_id = null,
  totp_enrollment_approval_expires_at = null,
  updated_at = statement_timestamp()
where singleton = true;
delete from auth.users
where id in (
  '8b000000-0000-4000-8000-000000000001',
  '8b000000-0000-4000-8000-000000000002'
);
drop schema refund_step_up_race_test cascade;
create or replace function public.refund_official_actions_enabled()
returns boolean language sql immutable set search_path = public as $$ select false; $$;
commit;

select ok(not public.refund_official_actions_enabled(),
  'Concurrent regression restores the production hard-off gate');

select * from finish();
