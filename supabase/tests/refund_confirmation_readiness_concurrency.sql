create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
set search_path = public, extensions;

-- This test commits synthetic fixtures so two local database sessions can race.
-- Refuse to continue if the fixed disposable Supabase database is unavailable.
do $$
declare
  local_connection text := 'host=db port=' || current_setting('port')
    || ' dbname=' || current_database()
    || ' user=postgres password=postgres sslmode=disable';
begin
  perform extensions.dblink_connect('confirmation_local_guard', local_connection);
  perform extensions.dblink_disconnect('confirmation_local_guard');
end;
$$;

begin;

drop schema if exists refund_confirmation_race_test cascade;
create schema refund_confirmation_race_test;

create table refund_confirmation_race_test.results (
  lane text primary key,
  payload jsonb not null
);

create table refund_confirmation_race_test.baseline (
  case_version bigint not null
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values (
  '00000000-0000-0000-0000-000000000000',
  'a0000000-0000-4000-8000-000000000001',
  'authenticated', 'authenticated', 'confirmation-race-manager@example.test',
  '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()
);

insert into public.customer_accounts (id, name, account_type)
values (
  'a0100000-0000-4000-8000-000000000001',
  'Confirmation race safety',
  'customer'
);

insert into public.reporting_locations (id, account_id, name, timezone)
values (
  'a0200000-0000-4000-8000-000000000001',
  'a0100000-0000-4000-8000-000000000001',
  'Confirmation race location',
  'America/Los_Angeles'
);

insert into public.reporting_machines (
  id, account_id, location_id, machine_label, nayax_machine_id,
  nayax_account_key, nayax_refunds_enabled, nayax_refund_max_amount_cents
)
values (
  'a0300000-0000-4000-8000-000000000001',
  'a0100000-0000-4000-8000-000000000001',
  'a0200000-0000-4000-8000-000000000001',
  'Confirmation race machine', 'CONFIRMATION-RACE-MACHINE',
  'CONFIRMATION-RACE-ACCOUNT', true, 2000
);

insert into public.reporting_machine_refund_managers (
  id, reporting_machine_id, manager_user_id, manager_email, grant_reason
)
values (
  'a0400000-0000-4000-8000-000000000001',
  'a0300000-0000-4000-8000-000000000001',
  'a0000000-0000-4000-8000-000000000001',
  'confirmation-race-manager@example.test',
  'Two-session transaction confirmation regression'
);

insert into public.refund_cases (
  id, public_reference, reporting_machine_id, reporting_location_id,
  customer_email, issue_summary, incident_at, payment_method,
  payment_amount_cents, card_last4, status, correlation_status,
  correlation_confidence, refund_amount_cents, nayax_match_execution_eligible,
  customer_request_received_at, customer_request_received_source,
  incident_time_resolution, incident_time_confidence
)
values (
  'a0500000-0000-4000-8000-000000000001',
  'RF-CONFIRM-RACE',
  'a0300000-0000-4000-8000-000000000001',
  'a0200000-0000-4000-8000-000000000001',
  'confirmation-race-customer@example.test',
  'Concurrent confirmation fixture',
  now() - interval '30 minutes',
  'card', 700, '4242', 'needs_review', 'needs_nayax', 0, 700, false,
  now() - interval '5 minutes', 'hosted_refund_intake', 'exact', 'exact'
);

insert into public.refund_nayax_lookup_candidates (
  token, refund_case_id, actor_user_id, reporting_machine_id,
  provider_transaction_id, site_id, machine_authorization_time,
  amount_cents, card_last4, currency_code, evidence_summary, expires_at
)
values (
  'a0600000-0000-4000-8000-000000000001',
  'a0500000-0000-4000-8000-000000000001',
  'a0000000-0000-4000-8000-000000000001',
  'a0300000-0000-4000-8000-000000000001',
  'SAFE-CONCURRENT-CONFIRM-001', 17, date_trunc('second', now() - interval '30 minutes'),
  700, '4242', 'USD',
  jsonb_build_object(
    'selection_allowed', true,
    'is_recommended', false,
    'one_click_eligible', false,
    'recommendation_state', 'manual_exception',
    'policy_version', '2026-09-05.v11',
    'identifier_policy_version', '2026-09-05.identifier.v2',
    'customer_fact_version', 1,
    'customer_credential_class', 'customer_identifier_unknown',
    'provider_identifier_class', 'last_sales_identifier_unknown',
    'card_last4_comparison', 'exact_support',
    'card_network_comparison', 'missing',
    'payment_interaction_comparison', 'unknown',
    'same_identifier_equivalence_proven', false,
    'identifier_review_state', 'exact_support',
    'customer_correction_fields', '[]'::jsonb,
    'hard_exclusions', '[]'::jsonb,
    'reason_codes', '[]'::jsonb,
    'lookup_account_scope', 'CONFIRMATION_RACE_ACCOUNT',
    'lookup_provider_machine_id', 'CONFIRMATION-RACE-MACHINE',
    'provider_machine_id', 'CONFIRMATION-RACE-MACHINE',
    'machine_authorization_time_raw', to_char(date_trunc('second',now() - interval '30 minutes') at time zone 'America/Los_Angeles', 'YYYY-MM-DD"T"HH24:MI:SS'),
    'machine_authorization_at', date_trunc('second',now() - interval '30 minutes'),
    'machine_authorization_time_source', 'MachineAuthorizationTime',
    'machine_time_resolution', 'exact',
    'provider_time_resolution', 'exact',
    'provider_time_source', 'authorization_gmt',
    'authorized_at', date_trunc('second',now() - interval '30 minutes'),
    'customer_request_received_at', now() - interval '5 minutes',
    'customer_request_received_source', 'hosted_refund_intake',
    'request_time_boundary', 'occurrence_time_uncertain',
    'transaction_occurrence_comparable', false,
    'transaction_occurrence_semantics','unknown',
    'transaction_occurrence_proof_source','null'::jsonb,
    'transaction_occurrence_timestamp_source','null'::jsonb,
    'transaction_occurrence_timezone_basis','null'::jsonb,
    'transaction_occurrence_lower_bound_at','null'::jsonb,
    'transaction_occurrence_upper_bound_at','null'::jsonb,
    'request_receipt_lower_bound_at','null'::jsonb,
    'request_receipt_upper_bound_at','null'::jsonb,
    'payment_status', 'approved',
    'payment_status_evidence', 'last_sales_contract',
    'provider_refund_state', 'clear',
    'duplicate_provider_record', false,
    'amount_delta_cents', 0,
    'time_delta_minutes', null,
    'provider_processing_time_delta_minutes', 1,
    'provider_payload_redacted', true
  ),
  now() + interval '1 hour'
);

insert into refund_confirmation_race_test.baseline (case_version)
select official_action_version
from public.refund_cases
where id = 'a0500000-0000-4000-8000-000000000001';

create function refund_confirmation_race_test.hold_first_update()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  perform pg_sleep(0.5);
  return new;
end;
$$;

create trigger refund_confirmation_race_hold
before update on public.refund_cases
for each row
when (new.id = 'a0500000-0000-4000-8000-000000000001')
execute function refund_confirmation_race_test.hold_first_update();

commit;

select plan(4);

select extensions.dblink_connect(
  'confirmation_a',
  'host=db port=' || current_setting('port') || ' dbname=' || current_database()
    || ' user=postgres password=postgres sslmode=disable'
);
select extensions.dblink_connect(
  'confirmation_b',
  'host=db port=' || current_setting('port') || ' dbname=' || current_database()
    || ' user=postgres password=postgres sslmode=disable'
);

select extensions.dblink_send_query('confirmation_a', $sql$
  select public.service_select_refund_nayax_candidate_as_actor(
    'a0000000-0000-4000-8000-000000000001',
    'a0500000-0000-4000-8000-000000000001',
    (select case_version from refund_confirmation_race_test.baseline),
    'a0600000-0000-4000-8000-000000000001',
    'customer_confirmation'
  )
$sql$);
select extensions.dblink_send_query('confirmation_b', $sql$
  select public.service_select_refund_nayax_candidate_as_actor(
    'a0000000-0000-4000-8000-000000000001',
    'a0500000-0000-4000-8000-000000000001',
    (select case_version from refund_confirmation_race_test.baseline),
    'a0600000-0000-4000-8000-000000000001',
    'customer_confirmation'
  )
$sql$);

insert into refund_confirmation_race_test.results (lane, payload)
select 'a', payload
from extensions.dblink_get_result('confirmation_a') as result(payload jsonb);
insert into refund_confirmation_race_test.results (lane, payload)
select 'b', payload
from extensions.dblink_get_result('confirmation_b') as result(payload jsonb);

select extensions.dblink_disconnect('confirmation_a');
select extensions.dblink_disconnect('confirmation_b');

select ok(
  (select count(*) = 2 from refund_confirmation_race_test.results)
  and (
    select count(*) = 1
    from refund_confirmation_race_test.results
    where payload ->> 'selectionApplied' = 'true'
  )
  and (
    select count(*) = 1
    from refund_confirmation_race_test.results
    where payload ->> 'selectionApplied' = 'false'
  )
  and not exists (
    select 1
    from refund_confirmation_race_test.results
    where payload ->> 'transactionConfirmed' <> 'true'
      or payload -> 'refundReadiness' ->> 'canIssueCardRefund' <> 'true'
  ),
  'Two simultaneous exact confirmations return one write and one successful replay'
);

select is(
  (
    select count(*)::integer
    from public.refund_case_events
    where refund_case_id = 'a0500000-0000-4000-8000-000000000001'
      and event_type = 'nayax_match_selected'
  ),
  1,
  'The row lock permits exactly one redacted selection event'
);

select is(
  (
    select refund_case.official_action_version - baseline.case_version
    from public.refund_cases refund_case
    cross join refund_confirmation_race_test.baseline baseline
    where refund_case.id = 'a0500000-0000-4000-8000-000000000001'
  ),
  1::bigint,
  'The replay does not advance the case version'
);

select ok(
  not exists (
    select 1 from public.refund_case_nayax_refund_attempts
    where refund_case_id = 'a0500000-0000-4000-8000-000000000001'
  )
  and not exists (
    select 1 from public.refund_case_official_action_authorizations
    where refund_case_id = 'a0500000-0000-4000-8000-000000000001'
  )
  and not exists (
    select 1 from public.sales_adjustment_facts
    where refund_case_id = 'a0500000-0000-4000-8000-000000000001'
  )
  and not exists (
    select 1 from public.refund_case_messages
    where refund_case_id = 'a0500000-0000-4000-8000-000000000001'
  ),
  'Concurrent confirmation remains nonfinancial and sends no customer message'
);

select * from finish();

begin;
drop trigger refund_confirmation_race_hold on public.refund_cases;
delete from public.refund_cases
where id = 'a0500000-0000-4000-8000-000000000001';
delete from public.reporting_machine_refund_managers
where id = 'a0400000-0000-4000-8000-000000000001';
delete from public.reporting_machines
where id = 'a0300000-0000-4000-8000-000000000001';
delete from public.reporting_locations
where id = 'a0200000-0000-4000-8000-000000000001';
delete from public.customer_accounts
where id = 'a0100000-0000-4000-8000-000000000001';
delete from auth.users
where id = 'a0000000-0000-4000-8000-000000000001';
drop schema refund_confirmation_race_test cascade;
commit;
