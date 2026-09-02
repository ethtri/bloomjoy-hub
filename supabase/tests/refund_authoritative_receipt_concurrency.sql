-- Disposable database only: committed synthetic rows are required by dblink.
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
set search_path=public,extensions;
select extensions.dblink_connect('receipt_race_a','host=db port='||current_setting('port')||
  ' dbname='||current_database()||' user=postgres password=postgres sslmode=disable application_name=receipt_race_a');
select extensions.dblink_connect('receipt_race_b','host=db port='||current_setting('port')||
  ' dbname='||current_database()||' user=postgres password=postgres sslmode=disable application_name=receipt_race_b');

begin;
create schema refund_receipt_race_test;
create table refund_receipt_race_test.results(lane text primary key,payload jsonb);
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('00000000-0000-0000-0000-000000000000','af000000-0000-4000-8000-000000000001','authenticated','authenticated','receipt-race@example.invalid','',now(),'{}','{}',now(),now());
insert into auth.sessions(id,user_id,created_at,updated_at)
values('af010000-0000-4000-8000-000000000001','af000000-0000-4000-8000-000000000001',now(),now());
insert into public.admin_roles(user_id,role,active) values('af000000-0000-4000-8000-000000000001','super_admin',true);
insert into public.customer_accounts(id,name,account_type) values('af100000-0000-4000-8000-000000000001','Receipt race','internal');
insert into public.reporting_locations(id,account_id,name,timezone)
values('af200000-0000-4000-8000-000000000001','af100000-0000-4000-8000-000000000001','Receipt race','America/Los_Angeles');
insert into public.reporting_machines(id,account_id,location_id,machine_label,nayax_machine_id,nayax_account_key,nayax_refunds_enabled)
values('af300000-0000-4000-8000-000000000001','af100000-0000-4000-8000-000000000001','af200000-0000-4000-8000-000000000001','Receipt race','RECEIPT-RACE-MACHINE','RECEIPT-RACE-ACCOUNT',true);
insert into public.reporting_machine_refund_managers(reporting_machine_id,manager_user_id,manager_email,grant_reason)
values('af300000-0000-4000-8000-000000000001','af000000-0000-4000-8000-000000000001','receipt-race@example.invalid','Synthetic receipt race');
insert into public.refund_cases(id,public_reference,reporting_machine_id,reporting_location_id,customer_email,issue_summary,
  incident_at,payment_method,payment_amount_cents,refund_amount_cents,card_last4,status,correlation_status,correlation_source,
  correlation_confidence,automation_state,matched_nayax_transaction_id,matched_nayax_amount_cents,matched_nayax_currency_code,
  matched_nayax_machine_auth_time,lifecycle_integrity_status,lifecycle_integrity_code,lifecycle_integrity_detected_at)
select ('af400000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'RF-RECEIPT-RACE-'||n,
  'af300000-0000-4000-8000-000000000001','af200000-0000-4000-8000-000000000001','receipt-race-customer@example.invalid',
  'Synthetic receipt race',now()-interval '3 days','card',700,700,'4242','card_refund_pending','matched','nayax',1,'approved',
  (223456780+n)::text,700,'USD',now()-interval '3 days',case when n=2 then 'ok' else 'hold' end,
  case when n=2 then null else 'card_payment_state_without_attempt' end,case when n=2 then null else now() end
from generate_series(1,2) n;
update public.refund_cases set status='needs_review',nayax_recommendation_state='high_confidence',
  nayax_recommendation_policy_version='2026-07-21.v1',nayax_match_execution_eligible=true,matched_nayax_site_id=97102,
  matched_nayax_card_last4='4242',nayax_refund_execution_status='not_requested'
where id='af400000-0000-4000-8000-000000000002';
insert into public.refund_case_events(refund_case_id,actor_user_id,event_type,message,metadata)
values('af400000-0000-4000-8000-000000000002','af000000-0000-4000-8000-000000000001','nayax_match_selected','Synthetic selection','{"payload_redacted":true}');
create function refund_receipt_race_test.authorize() returns void language plpgsql as $$ begin
  perform set_config('request.jwt.claim.sub','af000000-0000-4000-8000-000000000001',true);
  perform set_config('request.jwt.claim.role','authenticated',true);
  perform set_config('request.jwt.claims','{"sub":"af000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"af010000-0000-4000-8000-000000000001","is_anonymous":false}',true);
end; $$;
select refund_receipt_race_test.authorize();
select public.admin_begin_refund_manual_nayax_portal('af400000-0000-4000-8000-000000000002',
  (select official_action_version from public.refund_cases where id='af400000-0000-4000-8000-000000000002'));
insert into public.refund_gmail_threads(id,refund_case_id,mailbox_hash,provider_thread_id,thread_subject,first_message_at,latest_message_at,retention_expires_at)
values('af700000-0000-4000-8000-000000000001','af400000-0000-4000-8000-000000000001',repeat('f',64),'receipt-race-thread','Synthetic already-sent notice',now()-interval '1 day',now(),now()+interval '30 days');
insert into public.refund_gmail_messages(id,gmail_thread_id,refund_case_id,provider_message_id,operation_key,direction,message_kind,status,sender_email,recipient_email,subject,plain_body,sent_at,retention_expires_at)
values('af800000-0000-4000-8000-000000000001','af700000-0000-4000-8000-000000000001','af400000-0000-4000-8000-000000000001',
  'receipt-race-sent','imported:receipt-race-sent','outbound','message','sent','info@bloomjoysweets.com','receipt-race-customer@example.invalid',
  'Synthetic refund confirmation','RF-RECEIPT-RACE-1 original223456781 is fully refunded $7.00.',now()-interval '1 hour',now()+interval '30 days');
create function refund_receipt_race_test.run(p_action text,n integer) returns jsonb language plpgsql as $$
declare c public.refund_cases%rowtype; a uuid; r uuid;
begin
  perform refund_receipt_race_test.authorize();
  select * into c from public.refund_cases where id=('af400000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid;
  select id into a from public.refund_case_nayax_refund_attempts where refund_case_id=c.id order by created_at desc limit 1;
  if p_action='record' then
    return public.admin_record_refund_authoritative_receipt(c.id,a,c.official_action_version,'RECEIPT-RACE-ACCOUNT','RECEIPT-RACE-MACHINE',
      c.matched_nayax_transaction_id,700,700,'USD',62,'DTM:NAYAX-'||c.matched_nayax_transaction_id,true);
  elsif p_action='adopt' then
    select id into r from public.refund_authoritative_receipts where refund_case_id=c.id;
    return public.admin_adopt_refund_completion_notice(c.id,r,'af800000-0000-4000-8000-000000000001',c.official_action_version,
      c.public_reference,c.matched_nayax_transaction_id,700,true);
  elsif p_action='old_resolver' then
    return public.admin_resolve_refund_nayax_outcome_manager_session(c.id,a,'documented_manual_completion','documented_manual_refund',
      'MANUAL:'||c.matched_nayax_transaction_id,statement_timestamp(),'manual_nayax_completion',c.official_action_version);
  end if;
  raise exception 'Unexpected test action';
exception when others then return jsonb_build_object('error',sqlstate);
end; $$;
create function refund_receipt_race_test.wait_for_blocked_b() returns boolean language plpgsql as $$ begin
  for i in 1..100 loop
    perform pg_stat_clear_snapshot();
    if exists(select 1 from pg_stat_activity where application_name='receipt_race_b' and wait_event_type='Lock') then return true; end if;
    perform pg_sleep(0.01);
  end loop;
  return false;
end; $$;
commit;
select no_plan();

-- B reaches the real row lock before A records; B then observes durable replay.
select extensions.dblink_exec('receipt_race_a','begin');
select * from extensions.dblink('receipt_race_a',$q$select id::text from public.refund_cases where id='af400000-0000-4000-8000-000000000001' for update$q$) as x(id text);
select extensions.dblink_send_query('receipt_race_b',$q$select refund_receipt_race_test.run('record',1)$q$);
select ok(refund_receipt_race_test.wait_for_blocked_b(),'Concurrent recorder is verified waiting on the same case lock');
insert into refund_receipt_race_test.results select 'record_a',payload from extensions.dblink('receipt_race_a',$q$select refund_receipt_race_test.run('record',1)$q$) as x(payload jsonb);
select extensions.dblink_exec('receipt_race_a','commit');
insert into refund_receipt_race_test.results select 'record_b',payload from extensions.dblink_get_result('receipt_race_b') as x(payload jsonb);
select * from extensions.dblink_get_result('receipt_race_b') as x(payload jsonb);
select is((select payload->>'status' from refund_receipt_race_test.results where lane='record_a'),'recorded','First recorder commits once');
select is((select payload->>'status' from refund_receipt_race_test.results where lane='record_b'),'already_recorded','Concurrent recorder observes one durable receipt');

-- The old dated resolver is already waiting when the new receipt commits.
select extensions.dblink_exec('receipt_race_a','begin');
select * from extensions.dblink('receipt_race_a',$q$select id::text from public.refund_cases where id='af400000-0000-4000-8000-000000000002' for update$q$) as x(id text);
select extensions.dblink_send_query('receipt_race_b',$q$select refund_receipt_race_test.run('old_resolver',2)$q$);
select ok(refund_receipt_race_test.wait_for_blocked_b(),'Old resolver is verified waiting while receipt owns the case lock');
insert into refund_receipt_race_test.results select 'receipt_wins',payload from extensions.dblink('receipt_race_a',$q$select refund_receipt_race_test.run('record',2)$q$) as x(payload jsonb);
select extensions.dblink_exec('receipt_race_a','commit');
insert into refund_receipt_race_test.results select 'resolver_loses',payload from extensions.dblink_get_result('receipt_race_b') as x(payload jsonb);
select * from extensions.dblink_get_result('receipt_race_b') as x(payload jsonb);
select is((select payload->>'status' from refund_receipt_race_test.results where lane='receipt_wins'),'recorded','Receipt winner is committed');
select is((select payload->>'error' from refund_receipt_race_test.results where lane='resolver_loses'),'P4663','Waiting old resolver is stopped by the receipt effects guard');

select extensions.dblink_exec('receipt_race_a','begin');
select * from extensions.dblink('receipt_race_a',$q$select id::text from public.refund_cases where id='af400000-0000-4000-8000-000000000001' for update$q$) as x(id text);
select extensions.dblink_send_query('receipt_race_b',$q$select refund_receipt_race_test.run('adopt',1)$q$);
select ok(refund_receipt_race_test.wait_for_blocked_b(),'Concurrent adopter waits on the exact receipt case lock');
insert into refund_receipt_race_test.results select 'adopt_a',payload from extensions.dblink('receipt_race_a',$q$select refund_receipt_race_test.run('adopt',1)$q$) as x(payload jsonb);
select extensions.dblink_exec('receipt_race_a','commit');
insert into refund_receipt_race_test.results select 'adopt_b',payload from extensions.dblink_get_result('receipt_race_b') as x(payload jsonb);
select * from extensions.dblink_get_result('receipt_race_b') as x(payload jsonb);
select is((select payload->>'status' from refund_receipt_race_test.results where lane='adopt_a'),'adopted','One adopter commits');
select is((select payload->>'status' from refund_receipt_race_test.results where lane='adopt_b'),'already_adopted','Concurrent adopter is an idempotent replay');
select is((select count(*)::integer from public.refund_authoritative_receipts where reporting_machine_id='af300000-0000-4000-8000-000000000001'),2,'Exactly one receipt per case');
select is((select count(*)::integer from public.refund_completion_notice_adoptions where refund_case_id='af400000-0000-4000-8000-000000000001'),1,'Exactly one notice adoption');
select is((select count(*)::integer from public.refund_case_messages where refund_case_id in ('af400000-0000-4000-8000-000000000001','af400000-0000-4000-8000-000000000002')),0,'Races create no customer-send intent');
select is((select count(*)::integer from public.sales_adjustment_facts where refund_case_id in ('af400000-0000-4000-8000-000000000001','af400000-0000-4000-8000-000000000002')),0,'Races create no dated accounting adjustment');
select ok((select bool_and(refund_completed_at is null) from public.refund_cases where reporting_machine_id='af300000-0000-4000-8000-000000000001'),'Races never fabricate settlement time');
select is((select count(*)::integer from public.refund_case_nayax_refund_attempts where refund_case_id='af400000-0000-4000-8000-000000000001'),0,'No-attempt race creates no attempt');
select is((select status from public.refund_case_nayax_refund_attempts where refund_case_id='af400000-0000-4000-8000-000000000002'),'manual_review','Old attempt stays historical rather than finalized');
select * from finish();
select extensions.dblink_disconnect('receipt_race_a');
select extensions.dblink_disconnect('receipt_race_b');

-- Restore all guards in the same transaction while removing only named fixtures.
begin;
alter table public.refund_completion_notice_adoptions disable trigger refund_completion_notice_adoptions_immutable;
alter table public.refund_authoritative_receipts disable trigger refund_authoritative_receipts_immutable;
delete from public.refund_completion_notice_adoptions where refund_case_id='af400000-0000-4000-8000-000000000001';
delete from public.refund_authoritative_receipts where reporting_machine_id='af300000-0000-4000-8000-000000000001';
alter table public.refund_completion_notice_adoptions enable trigger refund_completion_notice_adoptions_immutable;
alter table public.refund_authoritative_receipts enable trigger refund_authoritative_receipts_immutable;
delete from public.refund_gmail_messages where gmail_thread_id='af700000-0000-4000-8000-000000000001';
delete from public.refund_gmail_threads where id='af700000-0000-4000-8000-000000000001';
delete from public.refund_cases where reporting_machine_id='af300000-0000-4000-8000-000000000001';
delete from public.reporting_machine_refund_managers where reporting_machine_id='af300000-0000-4000-8000-000000000001';
delete from public.reporting_machines where id='af300000-0000-4000-8000-000000000001';
delete from public.reporting_locations where id='af200000-0000-4000-8000-000000000001';
delete from public.customer_accounts where id='af100000-0000-4000-8000-000000000001';
delete from auth.users where id='af000000-0000-4000-8000-000000000001';
drop schema refund_receipt_race_test cascade;
commit;
