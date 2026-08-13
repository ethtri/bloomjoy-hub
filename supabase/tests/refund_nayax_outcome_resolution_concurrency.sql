create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
set search_path = public, extensions;

-- Fail before committing fixtures or replacing the default-off gate unless
-- this is the disposable Supabase CLI database. Never run with --linked.
do $$
declare
  local_connection text := 'host=db port=' || current_setting('port')
    || ' dbname=' || current_database()
    || ' user=postgres password=postgres sslmode=disable';
begin
  perform extensions.dblink_connect('nayax_resolution_local_guard', local_connection);
  perform extensions.dblink_disconnect('nayax_resolution_local_guard');
end;
$$;

-- Commit one exact held attempt and one verified intent so two independent
-- database sessions can race against the same durable state.
begin;

drop schema if exists refund_nayax_resolution_race_test cascade;
create schema refund_nayax_resolution_race_test;

create table refund_nayax_resolution_race_test.run_state (
  intent_id uuid primary key,
  proof text not null
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  'b2000000-0000-4000-8000-000000000001',
  'authenticated', 'authenticated', 'resolution-race-manager@example.test', '',
  now(), '{}'::jsonb, '{}'::jsonb, now(), now()
);

insert into public.customer_accounts (id, name, account_type)
values ('b2100000-0000-4000-8000-000000000001', 'Nayax resolution race', 'customer');

insert into public.reporting_locations (id, account_id, name, timezone)
values (
  'b2200000-0000-4000-8000-000000000001',
  'b2100000-0000-4000-8000-000000000001',
  'Resolution race location',
  'America/Los_Angeles'
);

insert into public.reporting_machines (
  id, account_id, location_id, machine_label, nayax_machine_id,
  nayax_account_key, nayax_refunds_enabled, nayax_refund_max_amount_cents
) values (
  'b2300000-0000-4000-8000-000000000001',
  'b2100000-0000-4000-8000-000000000001',
  'b2200000-0000-4000-8000-000000000001',
  'Resolution race machine', 'RESOLUTION-RACE-MACHINE',
  'RESOLUTION-RACE-ACCOUNT', true, 2500
);

insert into public.reporting_machine_refund_managers (
  id, reporting_machine_id, manager_user_id, manager_email, grant_reason
) values (
  'b2400000-0000-4000-8000-000000000001',
  'b2300000-0000-4000-8000-000000000001',
  'b2000000-0000-4000-8000-000000000001',
  'resolution-race-manager@example.test',
  'Two-session Nayax outcome-resolution regression'
);

insert into public.refund_manager_totp_enrollments (
  actor_user_id, approved_factor_binding_hash, owner_approved_by_user_id,
  owner_approval_version, enrollment_version
) values (
  'b2000000-0000-4000-8000-000000000001',
  repeat('b', 64),
  'b2000000-0000-4000-8000-000000000001',
  1,
  1
);

insert into public.refund_nayax_resolution_operators (
  actor_user_id, capability, status, approved_by_owner_user_id
) values (
  'b2000000-0000-4000-8000-000000000001',
  'payment_support_resolution',
  'active',
  'b2000000-0000-4000-8000-000000000001'
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
  nayax_recommendation_evaluated_at, nayax_match_execution_eligible,
  nayax_refund_execution_status
) values (
  'b2600000-0000-4000-8000-000000000001',
  'RF-RESOLUTION-RACE',
  'b2300000-0000-4000-8000-000000000001',
  'b2200000-0000-4000-8000-000000000001',
  'resolution-race-customer@example.test',
  'Synthetic held provider attempt for a two-session race',
  statement_timestamp() - interval '2 hours',
  'card', 909, 909, 'card_refund_pending', 'approved',
  'b2000000-0000-4000-8000-000000000001',
  statement_timestamp() - interval '20 minutes',
  '4242', false, 'matched', 'nayax', 1,
  'RESOLUTION-RACE-TX', 909,
  statement_timestamp() - interval '2 hours',
  909, '4242', 'USD', 'high_confidence',
  'resolution-race-v1', statement_timestamp(), false, 'not_requested'
);

-- Model the reverse ordering with a customer message that committed before the
-- provider outcome entered its payment-support hold. Once the case is held,
-- the older provider-hold trigger correctly prevents creating a new generic
-- message, so seeding the already-in-flight row first is the only reachable
-- generic-first state.
insert into public.refund_case_messages (
  refund_case_id, message_type, status, recipient_email, subject, body,
  template_key, created_by, content_source, delivery_kind, requested_fields
) values (
  'b2600000-0000-4000-8000-000000000001',
  'status_update', 'pending',
  'resolution-race-customer@example.test',
  'Generic message already in flight',
  'Generic message already in flight',
  'refund_status_update_editable_v1',
  'b2000000-0000-4000-8000-000000000001',
  'manager_authored', 'manual', '{}'::text[]
);

update public.refund_cases
set nayax_refund_execution_status = 'failed'
where id = 'b2600000-0000-4000-8000-000000000001';

insert into public.refund_case_nayax_refund_attempts (
  id, refund_case_id, actor_user_id, execution_mode, status, idempotency_key,
  amount_cents, transaction_id_present, site_id_present,
  machine_auth_time_present, request_fingerprint, currency_code,
  provider_outcome, provider_outcome_recorded_at, reconciliation_required,
  sanitized_request, sanitized_response
) values (
  'b2700000-0000-4000-8000-000000000001',
  'b2600000-0000-4000-8000-000000000001',
  'b2000000-0000-4000-8000-000000000001',
  'request_and_approve', 'failed', 'resolution-race-idempotency', 909,
  true, true, true, repeat('2', 64), 'USD', 'timeout',
  statement_timestamp() - interval '10 minutes', true,
  '{"payload_redacted":true}'::jsonb,
  '{"payload_redacted":true}'::jsonb
);

insert into public.refund_gmail_threads (
  id, refund_case_id, mailbox_hash, provider_thread_id, thread_subject,
  first_message_at, latest_message_at, retention_expires_at
) values (
  'b2800000-0000-4000-8000-000000000001',
  'b2600000-0000-4000-8000-000000000001',
  repeat('8', 64), 'resolution-race-original-thread',
  'Original race refund conversation',
  statement_timestamp() - interval '2 days',
  statement_timestamp() - interval '1 day',
  statement_timestamp() + interval '180 days'
);

create or replace function public.refund_nayax_outcome_resolution_enabled()
returns boolean language sql immutable set search_path = public as $$ select true; $$;

do $$
declare
  prepared jsonb;
  marked jsonb;
begin
  perform set_config('request.jwt.claim.sub', 'b2000000-0000-4000-8000-000000000001', true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config(
    'request.jwt.claims',
    '{"sub":"b2000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1","amr":[{"method":"password","timestamp":1}]}'::text,
    true
  );
  prepared := public.admin_prepare_refund_nayax_resolution_intent(
    'b2600000-0000-4000-8000-000000000001',
    'b2700000-0000-4000-8000-000000000001',
    'provider_confirmed_success',
    'nayax_dtm_transaction',
    'DTM:RACE-SETTLED-0001',
    statement_timestamp(),
    'nayax_dtm_settled',
    (select official_action_version
     from public.refund_cases
     where id = 'b2600000-0000-4000-8000-000000000001')
  );

  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  marked := public.service_mark_refund_nayax_resolution_factor_verified(
    'b2000000-0000-4000-8000-000000000001',
    (prepared ->> 'intentId')::uuid,
    repeat('b', 64)
  );

  insert into refund_nayax_resolution_race_test.run_state (intent_id, proof)
  values ((prepared ->> 'intentId')::uuid, marked ->> 'factorVerificationProof');
end;
$$;

create function refund_nayax_resolution_race_test.consume()
returns jsonb
language plpgsql
as $$
declare
  state_row refund_nayax_resolution_race_test.run_state%rowtype;
  intent_not_before timestamptz;
  evidence_occurred_at timestamptz;
  result jsonb;
begin
  select state.* into strict state_row
  from refund_nayax_resolution_race_test.run_state state;

  select intent.not_before, intent.evidence_occurred_at
  into strict intent_not_before, evidence_occurred_at
  from public.refund_nayax_resolution_intents intent
  where intent.id = state_row.intent_id;

  perform set_config('request.jwt.claim.sub', 'b2000000-0000-4000-8000-000000000001', true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', 'b2000000-0000-4000-8000-000000000001',
      'role', 'authenticated',
      'aal', 'aal2',
      'amr', jsonb_build_array(jsonb_build_object(
        'method', 'totp',
        'timestamp', extract(epoch from date_trunc('second', intent_not_before) + interval '10 seconds')
      ))
    )::text,
    true
  );

  result := public.admin_consume_refund_nayax_resolution_intent(
    state_row.intent_id,
    'b2600000-0000-4000-8000-000000000001',
    'b2700000-0000-4000-8000-000000000001',
    'provider_confirmed_success',
    'nayax_dtm_transaction',
    'DTM:RACE-SETTLED-0001',
    evidence_occurred_at,
    'nayax_dtm_settled',
    state_row.proof
  );

  return jsonb_build_object(
    'ok', true,
    'resolved', result -> 'resolved',
    'providerCallMade', result -> 'providerCallMade',
    'customerMessageCreated', result -> 'customerMessageCreated'
  );
exception when others then
  return jsonb_build_object('ok', false, 'error', 'resolution_not_consumed');
end;
$$;

create function refund_nayax_resolution_race_test.try_generic_message()
returns boolean
language plpgsql
as $$
begin
  insert into public.refund_case_messages (
    refund_case_id, message_type, status, recipient_email, subject, body,
    template_key, created_by, content_source, delivery_kind, requested_fields
  ) values (
    'b2600000-0000-4000-8000-000000000001',
    'status_update',
    'pending',
    'resolution-race-customer@example.test',
    'Generic race bypass',
    'Generic race bypass',
    'refund_status_update_editable_v1',
    'b2000000-0000-4000-8000-000000000001',
    'manager_authored',
    'manual',
    '{}'::text[]
  );
  return true;
exception when others then
  return false;
end;
$$;

commit;

select plan(15);

create temporary table nayax_resolution_race_results (
  connection_name text primary key,
  result jsonb not null
);

do $$
declare
  local_connection text := 'host=db port=' || current_setting('port')
    || ' dbname=' || current_database()
    || ' user=postgres password=postgres sslmode=disable';
begin
  perform extensions.dblink_connect('nayax_resolution_race_a', local_connection);
  perform extensions.dblink_connect('nayax_resolution_race_b', local_connection);
end;
$$;

-- Reverse lock order: the separately committed generic customer message won
-- the case lane before the provider hold. Resolution must now observe that
-- pending lane and fail before it can commit payment facts or a completion.
select ok((
  select not (result ->> 'ok')::boolean
    and result ->> 'error' = 'resolution_not_consumed'
  from extensions.dblink(
    'nayax_resolution_race_b',
    'select refund_nayax_resolution_race_test.consume()'
  ) as response(result jsonb)
), 'A committed generic message blocks the reverse-order resolution consume');
select ok(
  (select count(*) = 0
   from public.refund_nayax_outcome_resolutions
   where refund_case_id = 'b2600000-0000-4000-8000-000000000001')
  and (select count(*) = 0
       from public.refund_case_messages
       where refund_case_id = 'b2600000-0000-4000-8000-000000000001'
         and template_version = 'refund_nayax_completion_v2')
  and (select count(*) = 1
       from public.refund_case_nayax_refund_attempts
       where refund_case_id = 'b2600000-0000-4000-8000-000000000001'),
  'Reverse-order rejection creates no resolution, completion, or provider attempt'
);
update public.refund_case_messages
set status = 'failed',
    error_message =
      'Gmail delivery could not be confirmed. Reconcile the original thread before retrying.'
where refund_case_id = 'b2600000-0000-4000-8000-000000000001'
  and template_key = 'refund_status_update_editable_v1';
select ok((
  select not (result ->> 'ok')::boolean
  from extensions.dblink(
    'nayax_resolution_race_b',
    'select refund_nayax_resolution_race_test.consume()'
  ) as response(result jsonb)
), 'First-contact delivery-unknown state blocks completed resolution');
update public.refund_case_messages
set error_message = 'gmail_delivery_reconciliation_required'
where refund_case_id = 'b2600000-0000-4000-8000-000000000001'
  and template_key = 'refund_status_update_editable_v1';
select ok((
  select not (result ->> 'ok')::boolean
  from extensions.dblink(
    'nayax_resolution_race_b',
    'select refund_nayax_resolution_race_test.consume()'
  ) as response(result jsonb)
), 'Automation delivery-reconciliation state blocks completed resolution');
delete from public.refund_case_messages
where refund_case_id = 'b2600000-0000-4000-8000-000000000001'
  and template_key = 'refund_status_update_editable_v1';

-- Hold the exact actor lock while both remote transactions are launched.
-- Releasing this transaction queues both callers on the production lock and
-- forces a genuine two-session consume race.
begin;
do $$
begin
  perform pg_advisory_xact_lock(
    hashtextextended('b2000000-0000-4000-8000-000000000001', 767)
  );
  perform extensions.dblink_send_query(
    'nayax_resolution_race_a',
    'select refund_nayax_resolution_race_test.consume()'
  );
  perform extensions.dblink_send_query(
    'nayax_resolution_race_b',
    'select refund_nayax_resolution_race_test.consume()'
  );
end;
$$;
commit;

insert into nayax_resolution_race_results (connection_name, result)
select 'a', result
from extensions.dblink_get_result('nayax_resolution_race_a') as response(result jsonb);
insert into nayax_resolution_race_results (connection_name, result)
select 'b', result
from extensions.dblink_get_result('nayax_resolution_race_b') as response(result jsonb);

select is(
  (select count(*)::integer from nayax_resolution_race_results
    where (result ->> 'ok')::boolean),
  1,
  'Exactly one database session can consume the same verified resolution intent'
);
select is(
  (select count(*)::integer from nayax_resolution_race_results
    where not (result ->> 'ok')::boolean
      and result ->> 'error' = 'resolution_not_consumed'),
  1,
  'The concurrent loser fails closed with a fixed redacted result'
);
select ok((
  select (result ->> 'resolved')::boolean
    and not (result ->> 'providerCallMade')::boolean
    and (result ->> 'customerMessageCreated')::boolean
  from nayax_resolution_race_results
  where (result ->> 'ok')::boolean
), 'The winner proves resolution without a provider call and with one bound customer message');
select is(
  (select count(*)::integer from public.refund_nayax_outcome_resolutions
    where refund_case_id = 'b2600000-0000-4000-8000-000000000001'),
  1,
  'The race commits exactly one immutable support-resolution record'
);
select ok((
  select intent.status = 'consumed'
    and intent.consumed_at is not null
  from public.refund_nayax_resolution_intents intent
  where intent.id = (
    select state.intent_id from refund_nayax_resolution_race_test.run_state state
  )
), 'The exact verified intent is consumed once');
select ok((
  select refund_case.status = 'completed'
    and refund_case.refund_completed_by = 'b2000000-0000-4000-8000-000000000001'
    and refund_case.refund_completed_at is not null
    and refund_case.reporting_adjustment_id is not null
  from public.refund_cases refund_case
  where refund_case.id = 'b2600000-0000-4000-8000-000000000001'
), 'The winner atomically completes the exact case and reporting adjustment');
select ok((
  select attempt.status = 'succeeded'
    and attempt.provider_outcome = 'success'
    and not attempt.reconciliation_required
    and attempt.support_resolution_result = 'provider_confirmed_success'
    and attempt.sanitized_response ->> 'initial_provider_outcome' = 'timeout'
  from public.refund_case_nayax_refund_attempts attempt
  where attempt.id = 'b2700000-0000-4000-8000-000000000001'
), 'The attempt preserves the prior timeout while recording one effective support success');
select ok(
  (select count(*) = 1 from public.sales_adjustment_facts
    where refund_case_id = 'b2600000-0000-4000-8000-000000000001')
  and (select count(*) = 1 from public.refund_case_messages
    where refund_case_id = 'b2600000-0000-4000-8000-000000000001'
      and message_type = 'completed'
      and status = 'pending'
      and nayax_refund_attempt_id = 'b2700000-0000-4000-8000-000000000001')
  and (select count(*) = 1 from public.refund_case_nayax_refund_attempts
    where refund_case_id = 'b2600000-0000-4000-8000-000000000001'),
  'Concurrency creates one adjustment, one bound message, and no additional provider attempt'
);

-- Hold the exact case row while another database session attempts a generic
-- customer message. The remote insert must wait, re-check the unresolved
-- completion after the lock is released, and fail before creating a row.
do $$
declare
  local_connection text := 'host=db port=' || current_setting('port')
    || ' dbname=' || current_database()
    || ' user=postgres password=postgres sslmode=disable';
begin
  perform extensions.dblink_connect(
    'nayax_resolution_message_race',
    local_connection
  );
end;
$$;
begin;
select 1 from public.refund_cases
where id = 'b2600000-0000-4000-8000-000000000001'
for update;
select extensions.dblink_send_query(
  'nayax_resolution_message_race',
  'select refund_nayax_resolution_race_test.try_generic_message()'
);
commit;

select is(
  (select inserted from extensions.dblink_get_result(
    'nayax_resolution_message_race'
  ) as response(inserted boolean)),
  false,
  'A concurrent direct generic customer-message insert loses to the unresolved completion guard'
);
select is(
  (select count(*)::integer from public.refund_case_messages
   where refund_case_id = 'b2600000-0000-4000-8000-000000000001'
     and template_version is distinct from 'refund_nayax_completion_v2'),
  0,
  'The concurrent generic-message loser creates no second customer-message row'
);

select extensions.dblink_disconnect('nayax_resolution_message_race');

do $$
begin
  perform extensions.dblink_disconnect('nayax_resolution_race_a');
  perform extensions.dblink_disconnect('nayax_resolution_race_b');
end;
$$;

-- Durable dblink fixtures must be removed for later pgTAP files. This cleanup
-- runs only after the disposable-local guard and temporarily suppresses FK and
-- immutability triggers for these exact synthetic UUIDs.
begin;
set local session_replication_role = replica;
delete from public.refund_case_events
where refund_case_id = 'b2600000-0000-4000-8000-000000000001';
delete from public.refund_case_messages
where refund_case_id = 'b2600000-0000-4000-8000-000000000001';
delete from public.refund_gmail_threads
where refund_case_id = 'b2600000-0000-4000-8000-000000000001';
delete from public.refund_nayax_outcome_resolutions
where refund_case_id = 'b2600000-0000-4000-8000-000000000001';
delete from public.refund_nayax_resolution_intents
where refund_case_id = 'b2600000-0000-4000-8000-000000000001';
delete from public.sales_adjustment_facts
where refund_case_id = 'b2600000-0000-4000-8000-000000000001';
delete from public.refund_case_nayax_refund_attempts
where refund_case_id = 'b2600000-0000-4000-8000-000000000001';
delete from public.refund_cases
where id = 'b2600000-0000-4000-8000-000000000001';
delete from public.refund_nayax_resolution_operators
where actor_user_id = 'b2000000-0000-4000-8000-000000000001';
delete from public.refund_manager_totp_enrollments
where actor_user_id = 'b2000000-0000-4000-8000-000000000001';
delete from public.reporting_machine_refund_managers
where id = 'b2400000-0000-4000-8000-000000000001';
delete from public.reporting_machines
where id = 'b2300000-0000-4000-8000-000000000001';
delete from public.reporting_locations
where id = 'b2200000-0000-4000-8000-000000000001';
delete from public.customer_accounts
where id = 'b2100000-0000-4000-8000-000000000001';
delete from auth.users
where id = 'b2000000-0000-4000-8000-000000000001';
drop schema refund_nayax_resolution_race_test cascade;
create or replace function public.refund_nayax_outcome_resolution_enabled()
returns boolean language sql immutable set search_path = public as $$ select false; $$;
commit;

select ok(not public.refund_nayax_outcome_resolution_enabled(),
  'Concurrent regression restores the production hard-off gate');

select * from finish();
