-- Disposable database only: committed fixtures are required by dblink.
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
set search_path=public,extensions;

select extensions.dblink_connect('refund_submission_a','host=db port='||current_setting('port')||
  ' dbname='||current_database()||' user=postgres password=postgres sslmode=disable application_name=refund_submission_a');
select extensions.dblink_connect('refund_submission_b','host=db port='||current_setting('port')||
  ' dbname='||current_database()||' user=postgres password=postgres sslmode=disable application_name=refund_submission_b');

create schema refund_submission_race_test;
create table refund_submission_race_test.results(lane text primary key, outcome text);
insert into public.customer_accounts(id,name,account_type)
values('fa100000-0000-4000-8000-000000000001','Submission race','internal');
insert into public.reporting_locations(id,account_id,name,timezone)
values('fa200000-0000-4000-8000-000000000001','fa100000-0000-4000-8000-000000000001','Submission race','America/Los_Angeles');
insert into public.reporting_machines(id,account_id,location_id,machine_label,nayax_refunds_enabled)
values('fa300000-0000-4000-8000-000000000001','fa100000-0000-4000-8000-000000000001','fa200000-0000-4000-8000-000000000001','Submission race',false);

create function refund_submission_race_test.insert_case(p_lane text,p_fingerprint text)
returns text language plpgsql as $$
begin
  insert into public.refund_cases(
    id,public_reference,reporting_machine_id,reporting_location_id,customer_email,
    issue_summary,incident_at,payment_method,status,correlation_status,intake_meta,server_dedupe_key
  ) values (
    case p_lane when 'a' then 'fa400000-0000-4000-8000-000000000001'::uuid
      else 'fa400000-0000-4000-8000-000000000002'::uuid end,
    'RF-SUBMISSION-'||upper(p_lane),'fa300000-0000-4000-8000-000000000001',
    'fa200000-0000-4000-8000-000000000001','submission-race@example.invalid',
    'Synthetic submission race',now()-interval '1 hour','card','submitted','not_started',
    jsonb_build_object(
      'submission_identity_hash',repeat('1',64),
      'submission_payload_fingerprint',p_fingerprint
    ),
    repeat(p_lane,64)
  );
  return 'created';
exception when unique_violation then
  return 'conflict';
end;
$$;

insert into public.refund_cases(
  id,public_reference,reporting_machine_id,reporting_location_id,customer_email,
  issue_summary,incident_at,payment_method,status,correlation_status,intake_meta,server_dedupe_key
) values (
  'fa400000-0000-4000-8000-000000000003','RF-SUBMISSION-LEGACY',
  'fa300000-0000-4000-8000-000000000001','fa200000-0000-4000-8000-000000000001',
  'submission-race@example.invalid','Synthetic legacy adoption',now()-interval '1 hour',
  'card','submitted','not_started','{}',repeat('c',64)
);

select plan(8);
select has_column('public','refund_cases','submission_identity_hash','Identity hash has a database column');
select has_index('public','refund_cases','refund_cases_submission_identity_hash_idx','Identity hash has a unique index');

select extensions.dblink_send_query('refund_submission_a',$q$select refund_submission_race_test.insert_case('a',repeat('a',64))$q$);
select extensions.dblink_send_query('refund_submission_b',$q$select refund_submission_race_test.insert_case('b',repeat('b',64))$q$);
insert into refund_submission_race_test.results
select 'a',outcome from extensions.dblink_get_result('refund_submission_a') as x(outcome text);
select * from extensions.dblink_get_result('refund_submission_a') as x(outcome text);
insert into refund_submission_race_test.results
select 'b',outcome from extensions.dblink_get_result('refund_submission_b') as x(outcome text);
select * from extensions.dblink_get_result('refund_submission_b') as x(outcome text);

select is((select count(*)::integer from public.refund_cases where submission_identity_hash=repeat('1',64)),1,
  'Concurrent changed-payload UUID reuse creates exactly one case');
select is((select count(*)::integer from refund_submission_race_test.results where outcome='conflict'),1,
  'Concurrent changed-payload UUID reuse returns exactly one conflict');

truncate refund_submission_race_test.results;
select extensions.dblink_send_query('refund_submission_a',$q$select public.service_claim_refund_submission_identity(
  'fa400000-0000-4000-8000-000000000003',repeat('2',64),repeat('a',64))->>'outcome'$q$);
select extensions.dblink_send_query('refund_submission_b',$q$select public.service_claim_refund_submission_identity(
  'fa400000-0000-4000-8000-000000000003',repeat('3',64),repeat('b',64))->>'outcome'$q$);
insert into refund_submission_race_test.results
select 'a',outcome from extensions.dblink_get_result('refund_submission_a') as x(outcome text);
select * from extensions.dblink_get_result('refund_submission_a') as x(outcome text);
insert into refund_submission_race_test.results
select 'b',outcome from extensions.dblink_get_result('refund_submission_b') as x(outcome text);
select * from extensions.dblink_get_result('refund_submission_b') as x(outcome text);

select is((select count(*)::integer from refund_submission_race_test.results where outcome='adopted'),1,
  'Exactly one concurrent legacy identity is adopted');
select is((select count(*)::integer from refund_submission_race_test.results where outcome='occupied'),1,
  'The losing legacy adopter observes an immutable occupied identity');
select ok((select (submission_identity_hash=repeat('2',64)
    and submission_payload_fingerprint=repeat('a',64))
  or (submission_identity_hash=repeat('3',64)
    and submission_payload_fingerprint=repeat('b',64))
  from public.refund_cases where id='fa400000-0000-4000-8000-000000000003'),
  'The adopted identity and fingerprint remain a same-lane pair');

select throws_ok($q$update public.refund_cases set intake_meta=intake_meta||jsonb_build_object(
  'submission_identity_hash',repeat('9',64),'submission_payload_fingerprint',repeat('9',64))
  where id='fa400000-0000-4000-8000-000000000003'$q$,'23514','Refund submission identity is immutable',
  'A later update cannot overwrite an adopted identity');

select * from finish();
select extensions.dblink_disconnect('refund_submission_a');
select extensions.dblink_disconnect('refund_submission_b');
drop schema refund_submission_race_test cascade;
delete from public.refund_cases where id::text like 'fa400000-0000-4000-8000-%';
delete from public.reporting_machines where id='fa300000-0000-4000-8000-000000000001';
delete from public.reporting_locations where id='fa200000-0000-4000-8000-000000000001';
delete from public.customer_accounts where id='fa100000-0000-4000-8000-000000000001';
