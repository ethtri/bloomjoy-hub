create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
set search_path = public, extensions;

-- This test commits synthetic fixtures so two local database sessions can race.
do $$
declare
  local_connection text := 'host=db port=' || current_setting('port')
    || ' dbname=' || current_database()
    || ' user=postgres password=postgres sslmode=disable';
begin
  perform extensions.dblink_connect('cash_completion_local_guard', local_connection);
  perform extensions.dblink_disconnect('cash_completion_local_guard');
end;
$$;

begin;

drop schema if exists refund_cash_completion_race_test cascade;
create schema refund_cash_completion_race_test;

create table refund_cash_completion_race_test.results (
  lane text primary key,
  payload jsonb not null
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values (
  '00000000-0000-0000-0000-000000000000',
  'b0000000-0000-4000-8000-000000000001',
  'authenticated', 'authenticated', 'cash-race-manager@example.test', '', now(),
  '{}'::jsonb, '{}'::jsonb, now(), now()
);

insert into public.customer_accounts (id, name, account_type)
values ('b0100000-0000-4000-8000-000000000001', 'Cash completion race', 'customer');

insert into public.reporting_locations (id, account_id, name, timezone)
values (
  'b0200000-0000-4000-8000-000000000001',
  'b0100000-0000-4000-8000-000000000001',
  'Cash completion race location',
  'America/Los_Angeles'
);

insert into public.reporting_machines (id, account_id, location_id, machine_label)
values (
  'b0300000-0000-4000-8000-000000000001',
  'b0100000-0000-4000-8000-000000000001',
  'b0200000-0000-4000-8000-000000000001',
  'Cash completion race machine'
);

insert into public.reporting_machine_refund_managers (
  id, reporting_machine_id, manager_user_id, manager_email, grant_reason
)
values (
  'b0400000-0000-4000-8000-000000000001',
  'b0300000-0000-4000-8000-000000000001',
  'b0000000-0000-4000-8000-000000000001',
  'cash-race-manager@example.test',
  'Two-session cash completion regression'
);

insert into public.refund_cases (
  id, public_reference, reporting_machine_id, reporting_location_id,
  customer_email, zelle_payment_contact, issue_summary, incident_at,
  payment_method, payment_amount_cents, status, correlation_status,
  correlation_confidence, refund_amount_cents
)
values (
  'b0500000-0000-4000-8000-000000000001',
  'RF-CASH-RACE',
  'b0300000-0000-4000-8000-000000000001',
  'b0200000-0000-4000-8000-000000000001',
  'cash-race-customer@example.test',
  'legacy-race-contact',
  'Concurrent unmatched cash completion fixture',
  now() - interval '30 minutes',
  'cash', 825, 'needs_review', 'no_match', 0, null
);

create function refund_cash_completion_race_test.hold_first_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform pg_sleep(0.5);
  return new;
end;
$$;

create trigger refund_cash_completion_race_hold
before update on public.refund_cases
for each row
when (new.id = 'b0500000-0000-4000-8000-000000000001')
execute function refund_cash_completion_race_test.hold_first_update();

commit;

select plan(4);

select extensions.dblink_connect(
  'cash_completion_a',
  'host=db port=' || current_setting('port') || ' dbname=' || current_database()
    || ' user=postgres password=postgres sslmode=disable'
);
select extensions.dblink_connect(
  'cash_completion_b',
  'host=db port=' || current_setting('port') || ' dbname=' || current_database()
    || ' user=postgres password=postgres sslmode=disable'
);

select extensions.dblink_send_query('cash_completion_a', $sql$
  select public.service_complete_cash_refund_as_actor(
    'b0000000-0000-4000-8000-000000000001',
    'b0500000-0000-4000-8000-000000000001',
    1, 'ignored-a', now() - interval '1 year', null, null, null
  )
$sql$);
select extensions.dblink_send_query('cash_completion_b', $sql$
  select public.service_complete_cash_refund_as_actor(
    'b0000000-0000-4000-8000-000000000001',
    'b0500000-0000-4000-8000-000000000001',
    999999, 'ignored-b', now() + interval '1 year', null, null, null
  )
$sql$);

insert into refund_cash_completion_race_test.results (lane, payload)
select 'a', payload
from extensions.dblink_get_result('cash_completion_a') as result(payload jsonb);
insert into refund_cash_completion_race_test.results (lane, payload)
select 'b', payload
from extensions.dblink_get_result('cash_completion_b') as result(payload jsonb);

select extensions.dblink_disconnect('cash_completion_a');
select extensions.dblink_disconnect('cash_completion_b');

select ok(
  (select count(*) = 2 from refund_cash_completion_race_test.results)
  and (
    select count(*) = 1
    from refund_cash_completion_race_test.results
    where payload ->> 'updateApplied' = 'true'
  )
  and (
    select count(*) = 1
    from refund_cash_completion_race_test.results
    where payload ->> 'updateApplied' = 'false'
  ),
  'Two simultaneous cash completions return one write and one durable replay'
);

select ok(
  (
    select status = 'completed'
      and decision = 'approved'
      and refund_amount_cents = 825
      and refund_completed_by = 'b0000000-0000-4000-8000-000000000001'
    from public.refund_cases
    where id = 'b0500000-0000-4000-8000-000000000001'
  ),
  'The winning completion uses the case amount and mapped actor'
);

select ok(
  (
    select count(*) = 1
      and max(amount_cents) = 825
      and bool_and(raw_payload ->> 'completion_method' = 'manual_external')
    from public.sales_adjustment_facts
    where refund_case_id = 'b0500000-0000-4000-8000-000000000001'
  )
  and (
    select count(*) = 1
    from public.admin_audit_log
    where entity_id = 'b0500000-0000-4000-8000-000000000001'
      and action = 'refund_case.manual_external_completed'
  ),
  'The race creates exactly one reporting adjustment and one redacted actor audit'
);

select ok(
  not exists (
    select 1
    from public.refund_case_events
    where refund_case_id = 'b0500000-0000-4000-8000-000000000001'
  )
  and not exists (
    select 1
    from public.refund_case_messages
    where refund_case_id = 'b0500000-0000-4000-8000-000000000001'
  )
  and not exists (
    select 1
    from public.refund_case_nayax_refund_attempts
    where refund_case_id = 'b0500000-0000-4000-8000-000000000001'
  ),
  'The internal race makes no customer-message or Nayax side effect outside the wrapper'
);

select * from finish();

begin;
drop trigger refund_cash_completion_race_hold on public.refund_cases;
update public.refund_cases
set reporting_adjustment_id = null
where id = 'b0500000-0000-4000-8000-000000000001';
delete from public.sales_adjustment_facts
where refund_case_id = 'b0500000-0000-4000-8000-000000000001';
delete from public.admin_audit_log
where entity_id = 'b0500000-0000-4000-8000-000000000001';
delete from public.refund_cases
where id = 'b0500000-0000-4000-8000-000000000001';
delete from public.reporting_machine_refund_managers
where id = 'b0400000-0000-4000-8000-000000000001';
delete from public.reporting_machines
where id = 'b0300000-0000-4000-8000-000000000001';
delete from public.reporting_locations
where id = 'b0200000-0000-4000-8000-000000000001';
delete from public.customer_accounts
where id = 'b0100000-0000-4000-8000-000000000001';
delete from auth.users
where id = 'b0000000-0000-4000-8000-000000000001';
drop schema refund_cash_completion_race_test cascade;
commit;
