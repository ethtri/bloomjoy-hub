-- Disposable database only: committed fixtures are required by dblink sessions.
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
set search_path = public, extensions;

begin;
drop schema if exists refund_lookup_work_race_test cascade;
create schema refund_lookup_work_race_test;
create table refund_lookup_work_race_test.results(lane text primary key,payload jsonb not null);
insert into public.customer_accounts(id,name,account_type)
values('a8800000-0000-4000-8000-000000000001','Lookup race fixture','internal');
insert into public.reporting_locations(id,account_id,name,timezone)
values('a8800000-0000-4000-8000-000000000002','a8800000-0000-4000-8000-000000000001','Lookup race place','America/Los_Angeles');
insert into public.reporting_machines(id,account_id,location_id,machine_label,status,nayax_machine_id,nayax_account_key)
values('a8800000-0000-4000-8000-000000000003','a8800000-0000-4000-8000-000000000001','a8800000-0000-4000-8000-000000000002','Lookup race machine','active','lookup-race-machine','default');
insert into public.refund_cases(id,public_reference,reporting_machine_id,reporting_location_id,
  customer_email,issue_summary,incident_at,incident_timezone,incident_time_resolution,
  payment_method,payment_amount_cents,card_last4,status,correlation_status,correlation_source)
values('a8800000-0000-4000-8000-000000000010','RF-LOOKUP-RACE','a8800000-0000-4000-8000-000000000003','a8800000-0000-4000-8000-000000000002','race@example.invalid','Case claim race',statement_timestamp()-interval '1 hour','America/Los_Angeles','exact','card',700,'4242','needs_review','needs_nayax','nayax');
commit;

select plan(3);
select extensions.dblink_connect('lookup_work_a','host=db port='||current_setting('port')||' dbname='||current_database()||' user=postgres password=postgres sslmode=disable');
select extensions.dblink_connect('lookup_work_b','host=db port='||current_setting('port')||' dbname='||current_database()||' user=postgres password=postgres sslmode=disable');
select extensions.dblink_send_query('lookup_work_a','select public.service_claim_due_refund_nayax_lookups(1)');
select extensions.dblink_send_query('lookup_work_b','select public.service_claim_due_refund_nayax_lookups(1)');
insert into refund_lookup_work_race_test.results select 'a',payload from extensions.dblink_get_result('lookup_work_a') as result(payload jsonb);
insert into refund_lookup_work_race_test.results select 'b',payload from extensions.dblink_get_result('lookup_work_b') as result(payload jsonb);
select is((select sum(jsonb_array_length(payload))::integer from refund_lookup_work_race_test.results),1,
  'Competing sweeps obtain exactly one case-owned lookup claim');
select is(jsonb_array_length(public.service_claim_due_refund_nayax_lookups(1)),0,
  'The active case cannot be claimed again');
select is((select nayax_lookup_status from public.refund_cases where id='a8800000-0000-4000-8000-000000000010'),'checking',
  'The winning claim is visible on the refund case');
select extensions.dblink_disconnect('lookup_work_a');
select extensions.dblink_disconnect('lookup_work_b');
select * from finish();

begin;
delete from public.refund_cases where id='a8800000-0000-4000-8000-000000000010';
delete from public.reporting_machines where id='a8800000-0000-4000-8000-000000000003';
delete from public.reporting_locations where id='a8800000-0000-4000-8000-000000000002';
delete from public.customer_accounts where id='a8800000-0000-4000-8000-000000000001';
drop schema refund_lookup_work_race_test cascade;
commit;
