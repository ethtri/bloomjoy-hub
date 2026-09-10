-- Disposable database only: committed fixtures are required by dblink sessions.
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
set search_path = public, extensions;

do $$
declare
  local_connection text := 'host=db port=' || current_setting('port')
    || ' dbname=' || current_database()
    || ' user=postgres password=postgres sslmode=disable';
begin
  perform extensions.dblink_connect('outreach_local_guard',local_connection);
  perform extensions.dblink_disconnect('outreach_local_guard');
end;
$$;

begin;
drop schema if exists refund_outreach_race_test cascade;
create schema refund_outreach_race_test;
create table refund_outreach_race_test.fixture(cycle_id uuid primary key);
create table refund_outreach_race_test.results(
  lane text primary key,
  payload jsonb not null
);

insert into public.refund_cases(
  id,public_reference,customer_email,issue_summary,status,intake_source
) values (
  'b8900000-0000-4000-8000-000000000010','RF-OUTREACH-RACE',
  'race@example.invalid','Concurrent exact suppression settlement','draft','gmail'
);
update public.refund_customer_contact_settings
set automatic_customer_contact_enabled=true
where singleton;
insert into refund_outreach_race_test.fixture(cycle_id)
select (public.service_claim_refund_follow_up_cycle(
  'b8900000-0000-4000-8000-000000000010','missing_information',
  'refund_follow_up_v1',repeat('c',64),null)->'cycle'->>'id')::uuid;
commit;

select plan(5);

select extensions.dblink_connect('outreach_settle_a',
  'host=db port='||current_setting('port')||' dbname='||current_database()
    ||' user=postgres password=postgres sslmode=disable');
select extensions.dblink_connect('outreach_settle_b',
  'host=db port='||current_setting('port')||' dbname='||current_database()
    ||' user=postgres password=postgres sslmode=disable');
select extensions.dblink_send_query('outreach_settle_a',$sql$
  select public.service_settle_refund_follow_up_pre_message_suppression(
    'b8900000-0000-4000-8000-000000000010',
    (select cycle_id from refund_outreach_race_test.fixture),
    'automatic_customer_contact_disabled')
$sql$);
select extensions.dblink_send_query('outreach_settle_b',$sql$
  select public.service_settle_refund_follow_up_pre_message_suppression(
    'b8900000-0000-4000-8000-000000000010',
    (select cycle_id from refund_outreach_race_test.fixture),
    'automatic_customer_contact_disabled')
$sql$);

insert into refund_outreach_race_test.results
select 'a',payload from extensions.dblink_get_result('outreach_settle_a') as result(payload jsonb);
insert into refund_outreach_race_test.results
select 'b',payload from extensions.dblink_get_result('outreach_settle_b') as result(payload jsonb);

select is((select count(*)::integer from refund_outreach_race_test.results
  where (payload->>'settled')::boolean),1,
  'Competing workers perform exactly one settlement');
select is((select count(*)::integer from refund_outreach_race_test.results
  where (payload->>'idempotentReplay')::boolean),1,
  'The losing worker receives an idempotent replay result');
select is((select status from public.refund_follow_up_cycles where id=
  (select cycle_id from refund_outreach_race_test.fixture)),'manual_review',
  'The exact cycle is terminalized fail closed');
select is((select count(*)::integer from public.refund_case_events
  where refund_case_id='b8900000-0000-4000-8000-000000000010'
    and event_type='refund_follow_up_pre_message_suppressed'),1,
  'Concurrent settlement records one durable event');
select is((public.refund_customer_outreach_contract(
  'b8900000-0000-4000-8000-000000000010')->>'state'),'policy_suppressed',
  'Concurrent settlement immediately projects truthful ownership');

select extensions.dblink_disconnect('outreach_settle_a');
select extensions.dblink_disconnect('outreach_settle_b');
select * from finish();

begin;
delete from public.refund_cases
where id='b8900000-0000-4000-8000-000000000010';
drop schema refund_outreach_race_test cascade;
commit;
