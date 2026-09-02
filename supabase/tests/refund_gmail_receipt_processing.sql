-- Disposable host only: validate both connections before committing fixtures.
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
set search_path=public,extensions;
select extensions.dblink_connect('gmail_receipt_a','host=db port='||current_setting('port')||
  ' dbname='||current_database()||' user=postgres password=postgres sslmode=disable application_name=gmail_receipt_a');
select extensions.dblink_connect('gmail_receipt_b','host=db port='||current_setting('port')||
  ' dbname='||current_database()||' user=postgres password=postgres sslmode=disable application_name=gmail_receipt_b');
select extensions.dblink_exec('gmail_receipt_a','set statement_timeout=''30s''');
select extensions.dblink_exec('gmail_receipt_b','set statement_timeout=''30s''');
begin;
create schema refund_gmail_receipt_test;
create table refund_gmail_receipt_test.results(lane text primary key,payload jsonb);
grant usage on schema refund_gmail_receipt_test to authenticated,service_role;
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('00000000-0000-0000-0000-000000000000','c9000000-0000-4000-8000-000000000001','authenticated','authenticated','gmail-receipt-ops@example.invalid','',now(),'{}','{}',now(),now());
insert into auth.sessions(id,user_id,created_at,updated_at)
values('c9010000-0000-4000-8000-000000000001','c9000000-0000-4000-8000-000000000001',now(),now());
insert into public.admin_roles(user_id,role,active) values('c9000000-0000-4000-8000-000000000001','super_admin',true);
insert into public.customer_accounts(id,name,account_type) values('c9100000-0000-4000-8000-000000000001','Gmail receipt fixture','internal');
insert into public.reporting_locations(id,account_id,name,timezone)
values('c9200000-0000-4000-8000-000000000001','c9100000-0000-4000-8000-000000000001','Gmail receipt fixture','America/Los_Angeles');
insert into public.reporting_machines(id,account_id,location_id,machine_label,nayax_machine_id,nayax_account_key)
values('c9300000-0000-4000-8000-000000000001','c9100000-0000-4000-8000-000000000001','c9200000-0000-4000-8000-000000000001','Gmail receipt fixture','GMAIL-RECEIPT-MACHINE','GMAIL-RECEIPT-ACCOUNT');
insert into public.reporting_machine_refund_managers(reporting_machine_id,manager_user_id,manager_email,grant_reason)
values('c9300000-0000-4000-8000-000000000001','c9000000-0000-4000-8000-000000000001','gmail-receipt-ops@example.invalid','Synthetic Gmail receipt test');
insert into public.refund_cases(id,public_reference,reporting_machine_id,reporting_location_id,customer_email,issue_summary,
  incident_at,payment_method,payment_amount_cents,refund_amount_cents,card_last4,status,correlation_status,correlation_source,
  correlation_confidence,automation_state,matched_nayax_transaction_id,matched_nayax_amount_cents,matched_nayax_currency_code,
  matched_nayax_machine_auth_time,lifecycle_integrity_status,lifecycle_integrity_code,lifecycle_integrity_detected_at)
select ('c9400000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'RF-GMAIL-RECEIPT-'||n,
  'c9300000-0000-4000-8000-000000000001','c9200000-0000-4000-8000-000000000001','gmail-receipt-customer@example.invalid',
  'Synthetic Gmail receipt fixture',now()-interval '3 days','card',700,700,'4242','card_refund_pending','matched','nayax',1,'approved',
  (923456780+n)::text,700,'USD',now()-interval '3 days','hold','card_payment_state_without_attempt',now()
from generate_series(1,3) n;
update public.refund_cases set status='needs_review',lifecycle_integrity_status='ok',lifecycle_integrity_code=null,
  lifecycle_integrity_detected_at=null where id='c9400000-0000-4000-8000-000000000002';
insert into public.refund_gmail_threads(id,refund_case_id,mailbox_hash,provider_thread_id,thread_subject,first_message_at,latest_message_at,retention_expires_at)
select ('c9500000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,('c9400000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  repeat('9',64),'gmail-receipt-thread-'||n,'Synthetic customer reply',now()-interval '1 day',now(),now()+interval '30 days'
from generate_series(1,3) n;
insert into public.refund_gmail_messages(id,gmail_thread_id,refund_case_id,provider_message_id,direction,message_kind,status,
  sender_email,recipient_email,participant_role,participant_trust,subject,plain_body,received_at,retention_expires_at)
select ('c9600000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,('c9500000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  ('c9400000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'gmail-receipt-reply-'||n,'inbound','message','received',
  'gmail-receipt-customer@example.invalid','info@bloomjoysweets.com','customer','verified','Synthetic reply','Card type: Visa',now(),now()+interval '30 days'
from generate_series(1,3) n;
create function refund_gmail_receipt_test.authorize() returns void language plpgsql as $$ begin
  perform set_config('request.jwt.claim.sub','c9000000-0000-4000-8000-000000000001',true);
  perform set_config('request.jwt.claim.role','authenticated',true);
  perform set_config('request.jwt.claims','{"sub":"c9000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"c9010000-0000-4000-8000-000000000001","is_anonymous":false}',true);
end; $$;
create function refund_gmail_receipt_test.record(n integer) returns jsonb language plpgsql as $$
declare c public.refund_cases%rowtype;
begin
  select * into c from public.refund_cases where id=('c9400000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid;
  return public.admin_record_refund_authoritative_receipt(c.id,null,c.official_action_version,
    'GMAIL-RECEIPT-ACCOUNT','GMAIL-RECEIPT-MACHINE',c.matched_nayax_transaction_id,700,700,'USD',62,
    'DTM:NAYAX-'||c.matched_nayax_transaction_id,true);
end; $$;
create function refund_gmail_receipt_test.apply(n integer) returns jsonb language plpgsql as $$
declare c public.refund_cases%rowtype;
begin
  select * into c from public.refund_cases where id=('c9400000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid;
  return public.service_apply_refund_gmail_customer_facts_v1(c.id,
    ('c9600000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,c.deterministic_fact_version,
    '{"card_network":"visa"}',array['card_network'],'labeled_routine_facts_v1');
end; $$;
create function refund_gmail_receipt_test.blocked() returns boolean language plpgsql as $$ begin
  for i in 1..100 loop
    perform pg_stat_clear_snapshot();
    if exists(select 1 from pg_stat_activity where application_name='gmail_receipt_b' and wait_event_type='Lock') then return true; end if;
    perform pg_sleep(0.01);
  end loop;
  return false;
end; $$;
select refund_gmail_receipt_test.authorize();
set local role authenticated;
select refund_gmail_receipt_test.record(1);
reset role;
commit;
select no_plan();

select ok(not has_function_privilege(role_name,
  'public.service_apply_refund_gmail_customer_facts_pre_receipt(uuid,uuid,bigint,jsonb,text[],text)','execute'),
  role_name||' cannot bypass the receipt wrapper') from unnest(array['anon','authenticated','service_role']) role_name;
select ok(not has_function_privilege(role_name,
  'public.service_apply_refund_gmail_customer_facts_v1(uuid,uuid,bigint,jsonb,text[],text)','execute'),
  role_name||' cannot invoke background Gmail facts') from unnest(array['anon','authenticated']) role_name;
select ok(has_function_privilege('service_role',
  'public.service_apply_refund_gmail_customer_facts_v1(uuid,uuid,bigint,jsonb,text[],text)','execute'),'Service role retains the guarded API');
select ok(not has_table_privilege('service_role','public.refund_authoritative_receipts','select'),'No raw receipt read grant was added');

-- Real existing-case ingestion remains available after receipt recording.
begin;
set local role service_role;
select is((public.service_ingest_refund_gmail_contact_v2(
  repeat('9',64),'gmail-receipt-thread-1','gmail-receipt-after-confirmation',null,null,'inbound',false,
  'gmail-receipt-customer@example.invalid','Synthetic customer','info@bloomjoysweets.com','Synthetic follow-up','Card type: Mastercard',
  false,statement_timestamp(),'RF-GMAIL-RECEIPT-1','[]','{}',array['info@bloomjoysweets.com'],'direct_human',false,false,'{}','{}')
  ->>'participantRole'),'customer','Verified incoming customer message is ingested after authoritative receipt');
reset role;
commit;
create temp table gmail_receipt_case_snapshot as select to_jsonb(c) payload from public.refund_cases c where id='c9400000-0000-4000-8000-000000000001';
create temp table gmail_receipt_mail_snapshot as select id,to_jsonb(m) payload from public.refund_gmail_messages m where refund_case_id='c9400000-0000-4000-8000-000000000001';
begin;
set local role service_role;
select is(refund_gmail_receipt_test.apply(1),' {"outcome":"skipped","reason":"authoritative_receipt_recorded"}'::jsonb,'Receipted card facts are a no-effect skip');
select is(refund_gmail_receipt_test.apply(1)->>'outcome','skipped','Replay remains a no-effect skip');
select is(public.refund_lifecycle_contract('c9400000-0000-4000-8000-000000000001')->>'reasonCode','settlement_time_unknown','Worker service read identifies exact receipt reason');
select is(public.service_apply_refund_gmail_customer_facts_v1('c9400000-0000-4000-8000-000000000001',
  'c9600000-0000-4000-8000-000000000002',1,'{"card_network":"visa"}',array['card_network'],'labeled_routine_facts_v1')->>'reason',
  'source_not_eligible','Other-case message is not accepted as receipt evidence');
select is(refund_gmail_receipt_test.apply(2)->>'outcome','applied','Unreceipted card correction still applies');
select is(refund_gmail_receipt_test.apply(2)->>'outcome','already_applied','Ordinary recovery replay remains idempotent');
reset role;
commit;
select is((select to_jsonb(c) from public.refund_cases c where id='c9400000-0000-4000-8000-000000000001'),
  (select payload from gmail_receipt_case_snapshot),'Receipt case is byte-for-byte unchanged by skipped facts');
select ok((select bool_and(to_jsonb(m)=s.payload) from gmail_receipt_mail_snapshot s join public.refund_gmail_messages m using(id)),
  'Incoming mail evidence stays byte-for-byte unchanged');
select is((select count(*)::integer from public.refund_customer_fact_applications where refund_case_id='c9400000-0000-4000-8000-000000000001'),0,
  'Skipped facts create no application ledger');
select is((select count(*)::integer from public.refund_case_events where refund_case_id='c9400000-0000-4000-8000-000000000001' and event_type='gmail_customer_facts_applied'),0,
  'Skipped facts create no applied-fact event');

-- The receipt wins while an actual service-role fact application is waiting.
select extensions.dblink_exec('gmail_receipt_a','begin');
-- The disposable coordinator holds the barrier; the real operation below still
-- runs as authenticated, which correctly has no direct table UPDATE grant.
select * from extensions.dblink('gmail_receipt_a',$q$select id::text from public.refund_cases where id='c9400000-0000-4000-8000-000000000003' for update$q$) as x(id text);
select extensions.dblink_exec('gmail_receipt_a','set local role authenticated');
select * from extensions.dblink('gmail_receipt_a','select refund_gmail_receipt_test.authorize()::text') as x(result text);
select extensions.dblink_exec('gmail_receipt_b','set role service_role');
select extensions.dblink_send_query('gmail_receipt_b','select refund_gmail_receipt_test.apply(3)');
select ok(refund_gmail_receipt_test.blocked(),'Fact application is verified waiting on receipt case lock');
select is((select payload->>'status' from extensions.dblink('gmail_receipt_a','select refund_gmail_receipt_test.record(3)') as x(payload jsonb)),
  'recorded','Current authenticated operator records the winning receipt');
insert into refund_gmail_receipt_test.results select 'recorded_case',payload from extensions.dblink('gmail_receipt_a',
  $q$select to_jsonb(c) from public.refund_cases c where id='c9400000-0000-4000-8000-000000000003'$q$) as x(payload jsonb);
select extensions.dblink_exec('gmail_receipt_a','commit');
insert into refund_gmail_receipt_test.results select 'waiting_facts',payload from extensions.dblink_get_result('gmail_receipt_b') as x(payload jsonb);
select * from extensions.dblink_get_result('gmail_receipt_b') as x(payload jsonb);
select is((select payload from refund_gmail_receipt_test.results where lane='waiting_facts'),
  '{"outcome":"skipped","reason":"authoritative_receipt_recorded"}'::jsonb,'Queued fact application observes receipt and skips without failure');
select is((select to_jsonb(c) from public.refund_cases c where id='c9400000-0000-4000-8000-000000000003'),
  (select payload from refund_gmail_receipt_test.results where lane='recorded_case'),'Queued facts leave the complete winning receipt case unchanged');
select is((select count(*)::integer from public.refund_customer_fact_applications where refund_case_id='c9400000-0000-4000-8000-000000000003'),0,'Race creates no fact application');
select is((select count(*)::integer from public.refund_case_messages where refund_case_id in(select id from public.refund_cases where reporting_machine_id='c9300000-0000-4000-8000-000000000001')),0,'No customer-send intents');
select is((select count(*)::integer from public.refund_case_nayax_refund_attempts where refund_case_id in(select id from public.refund_cases where reporting_machine_id='c9300000-0000-4000-8000-000000000001')),0,'No provider or payment attempt');
select is((select count(*)::integer from public.sales_adjustment_facts where refund_case_id in(select id from public.refund_cases where reporting_machine_id='c9300000-0000-4000-8000-000000000001')),0,'No accounting adjustment');
select * from finish();
select extensions.dblink_disconnect('gmail_receipt_a');
select extensions.dblink_disconnect('gmail_receipt_b');
begin;
alter table public.refund_authoritative_receipts disable trigger refund_authoritative_receipts_immutable;
delete from public.refund_authoritative_receipts where reporting_machine_id='c9300000-0000-4000-8000-000000000001';
alter table public.refund_authoritative_receipts enable trigger refund_authoritative_receipts_immutable;
delete from public.refund_customer_fact_applications where refund_case_id in(select id from public.refund_cases where reporting_machine_id='c9300000-0000-4000-8000-000000000001');
delete from public.refund_gmail_messages where refund_case_id in(select id from public.refund_cases where reporting_machine_id='c9300000-0000-4000-8000-000000000001');
delete from public.refund_gmail_threads where refund_case_id in(select id from public.refund_cases where reporting_machine_id='c9300000-0000-4000-8000-000000000001');
delete from public.refund_cases where reporting_machine_id='c9300000-0000-4000-8000-000000000001';
delete from public.reporting_machine_refund_managers where reporting_machine_id='c9300000-0000-4000-8000-000000000001';
delete from public.reporting_machines where id='c9300000-0000-4000-8000-000000000001';
delete from public.reporting_locations where id='c9200000-0000-4000-8000-000000000001';
delete from public.customer_accounts where id='c9100000-0000-4000-8000-000000000001';
delete from auth.users where id='c9000000-0000-4000-8000-000000000001';
drop schema refund_gmail_receipt_test cascade;
commit;
