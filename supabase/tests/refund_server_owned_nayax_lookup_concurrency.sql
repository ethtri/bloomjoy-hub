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
  perform extensions.dblink_connect('lookup_recovery_local_guard',local_connection);
  perform extensions.dblink_disconnect('lookup_recovery_local_guard');
end;
$$;

begin;
drop schema if exists refund_lookup_recovery_race_test cascade;
create schema refund_lookup_recovery_race_test;
create table refund_lookup_recovery_race_test.results(
  lane text primary key,
  payload jsonb not null
);

insert into public.customer_accounts(id,name,account_type)
values('a8800000-0000-4000-8000-000000000001','Lookup race fixture','internal');
insert into public.reporting_locations(id,account_id,name,timezone)
values('a8800000-0000-4000-8000-000000000002','a8800000-0000-4000-8000-000000000001',
  'Lookup race place','America/Los_Angeles');
insert into public.reporting_machines(id,account_id,location_id,machine_label,status,nayax_machine_id,nayax_account_key)
values('a8800000-0000-4000-8000-000000000003','a8800000-0000-4000-8000-000000000001',
  'a8800000-0000-4000-8000-000000000002','Lookup race machine','active','recovery-race-machine','default');
insert into public.refund_cases(id,public_reference,reporting_machine_id,reporting_location_id,
  customer_email,issue_summary,incident_at,incident_timezone,incident_time_resolution,
  payment_method,payment_amount_cents,card_last4,status,correlation_status,correlation_source)
values('a8800000-0000-4000-8000-000000000010','RF-RECOVERY-RACE',
  'a8800000-0000-4000-8000-000000000003','a8800000-0000-4000-8000-000000000002',
  'race@example.invalid','Provider read ownership race',statement_timestamp()-interval '1 hour',
  'America/Los_Angeles','exact','card',700,'4242','needs_review','needs_nayax','nayax');
select public.service_enqueue_refund_nayax_lookup(
  'a8800000-0000-4000-8000-000000000010',1);
commit;

select plan(5);

select extensions.dblink_connect('lookup_recovery_a',
  'host=db port='||current_setting('port')||' dbname='||current_database()
    ||' user=postgres password=postgres sslmode=disable');
select extensions.dblink_connect('lookup_recovery_b',
  'host=db port='||current_setting('port')||' dbname='||current_database()
    ||' user=postgres password=postgres sslmode=disable');
select extensions.dblink_send_query('lookup_recovery_a',
  'select public.service_claim_refund_nayax_lookup_recoveries(1)');
select extensions.dblink_send_query('lookup_recovery_b',
  'select public.service_claim_refund_nayax_lookup_recoveries(1)');

insert into refund_lookup_recovery_race_test.results
select 'a',payload from extensions.dblink_get_result('lookup_recovery_a') as result(payload jsonb);
insert into refund_lookup_recovery_race_test.results
select 'b',payload from extensions.dblink_get_result('lookup_recovery_b') as result(payload jsonb);

select is((select sum(jsonb_array_length(payload))::integer
  from refund_lookup_recovery_race_test.results),1,
  'Competing sweep sessions obtain exactly one active provider-read claim');
select is(jsonb_array_length(public.service_claim_refund_nayax_lookup_recoveries(1)),0,
  'A repeated sweep cannot claim the active exact attempt again');

update public.refund_nayax_lookup_recoveries
set claim_expires_at=statement_timestamp()-interval '1 second'
where refund_case_id='a8800000-0000-4000-8000-000000000010';
update public.refund_cases
set deterministic_fact_version=deterministic_fact_version+1,
  nayax_lookup_status='no_match',nayax_lookup_generation=7,
  nayax_recommendation_state='no_safe_match',
  nayax_recommendation_evaluated_at=statement_timestamp()
where id='a8800000-0000-4000-8000-000000000010';

select is((public.service_commit_refund_nayax_lookup_with_diagnostics(
  'a8800000-0000-4000-8000-000000000010',1,1,'no_match','no_safe_match',
  'nayax_deterministic_v1',statement_timestamp(),'Late old-generation result',null,0,
  'scheduled',null,null)->>'applied'),'false',
  'A provider response crossing the lease cannot persist over newer fact and lookup generations');
select is((public.service_finish_refund_nayax_lookup_recovery(
  (select id from public.refund_nayax_lookup_recoveries
    where refund_case_id='a8800000-0000-4000-8000-000000000010'),
  (select claim_token from public.refund_nayax_lookup_recoveries
    where refund_case_id='a8800000-0000-4000-8000-000000000010'),
  null,false,'worker_interrupted')->>'reason'),'stale_evidence',
  'A worker returning after its lease cannot settle over a newer fact version');
select is((select jsonb_build_object('factVersion',deterministic_fact_version,
    'lookupGeneration',nayax_lookup_generation,'lookupStatus',nayax_lookup_status)
  from public.refund_cases where id='a8800000-0000-4000-8000-000000000010'),
  jsonb_build_object('factVersion',2,'lookupGeneration',7,'lookupStatus','no_match'),
  'The late worker leaves newer fact and completed lookup evidence unchanged');

select extensions.dblink_disconnect('lookup_recovery_a');
select extensions.dblink_disconnect('lookup_recovery_b');
select * from finish();
