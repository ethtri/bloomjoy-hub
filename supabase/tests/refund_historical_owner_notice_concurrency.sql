-- Disposable database only. Both remote sessions connect before committed fixtures.
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
set search_path=public,extensions;
select extensions.dblink_connect('owner_notice_a','host=db port='||current_setting('port')||
  ' dbname='||current_database()||' user=postgres password=postgres sslmode=disable application_name=owner_notice_a');
select extensions.dblink_connect('owner_notice_b','host=db port='||current_setting('port')||
  ' dbname='||current_database()||' user=postgres password=postgres sslmode=disable application_name=owner_notice_b');
select extensions.dblink_exec('owner_notice_a','set statement_timeout=''20s''');
select extensions.dblink_exec('owner_notice_b','set statement_timeout=''20s''');
begin;
create schema refund_owner_race_test;
create table refund_owner_race_test.results(lane text primary key,payload jsonb);
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('00000000-0000-0000-0000-000000000000','bf000000-0000-4000-8000-000000000001','authenticated','authenticated',
  'owner-race@example.invalid','',now(),'{}','{}',now(),now());
insert into auth.sessions(id,user_id,created_at,updated_at)
values('bf010000-0000-4000-8000-000000000001','bf000000-0000-4000-8000-000000000001',now(),now());
insert into public.admin_roles(user_id,role,active) values('bf000000-0000-4000-8000-000000000001','super_admin',true);
insert into public.customer_accounts(id,name,account_type) values('bf100000-0000-4000-8000-000000000001','Owner race','internal');
insert into public.reporting_locations(id,account_id,name,timezone)
values('bf200000-0000-4000-8000-000000000001','bf100000-0000-4000-8000-000000000001','Owner race','America/Los_Angeles');
insert into public.reporting_machines(id,account_id,location_id,machine_label,nayax_machine_id,nayax_account_key)
values('bf300000-0000-4000-8000-000000000001','bf100000-0000-4000-8000-000000000001',
  'bf200000-0000-4000-8000-000000000001','Owner race','OWNER-RACE-MACHINE','OWNER-RACE-ACCOUNT');
insert into public.reporting_machine_refund_managers(reporting_machine_id,manager_user_id,manager_email,grant_reason)
values('bf300000-0000-4000-8000-000000000001','bf000000-0000-4000-8000-000000000001','owner-race@example.invalid','Synthetic owner race');
insert into public.refund_cases(id,public_reference,reporting_machine_id,reporting_location_id,customer_email,issue_summary,
  incident_at,payment_method,payment_amount_cents,refund_amount_cents,card_last4,status,correlation_status,correlation_source,
  correlation_confidence,automation_state,matched_nayax_transaction_id,matched_nayax_amount_cents,matched_nayax_currency_code,
  matched_nayax_machine_auth_time,lifecycle_integrity_status,lifecycle_integrity_code,lifecycle_integrity_detected_at)
select ('bf400000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'RF-OWNER-RACE-'||n,
  'bf300000-0000-4000-8000-000000000001','bf200000-0000-4000-8000-000000000001','owner-race-customer@example.invalid',
  'Synthetic owner race',now()-interval '3 days','card',700,700,'4242','card_refund_pending','matched','nayax',1,'approved',
  (323456780+n)::text,700,'USD',now()-interval '3 days','hold','card_payment_state_without_attempt',now()
from generate_series(1,4) n;
create function refund_owner_race_test.authorize() returns void language plpgsql as $$ begin
  perform set_config('request.jwt.claim.sub','bf000000-0000-4000-8000-000000000001',true);
  perform set_config('request.jwt.claim.role','authenticated',true);
  perform set_config('request.jwt.claims','{"sub":"bf000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"bf010000-0000-4000-8000-000000000001","is_anonymous":false}',true);
end; $$;
select refund_owner_race_test.authorize();
select public.admin_record_refund_authoritative_receipt(c.id,null,c.official_action_version,'OWNER-RACE-ACCOUNT','OWNER-RACE-MACHINE',
  c.matched_nayax_transaction_id,700,700,'USD',62,'DTM:NAYAX-'||c.matched_nayax_transaction_id,true)
from public.refund_cases c where reporting_machine_id='bf300000-0000-4000-8000-000000000001';
insert into public.refund_gmail_threads(id,refund_case_id,mailbox_hash,provider_thread_id,thread_subject,first_message_at,latest_message_at,retention_expires_at)
values('bf700000-0000-4000-8000-000000000002','bf400000-0000-4000-8000-000000000002',
  encode(extensions.digest(convert_to('info@bloomjoysweets.com','UTF8'),'sha256'),'hex'),'feed000000000022',
  'Synthetic support thread',now()-interval '1 day',now(),now()+interval '30 days');
insert into public.refund_gmail_messages(id,gmail_thread_id,refund_case_id,provider_message_id,operation_key,direction,message_kind,status,
  sender_email,recipient_email,subject,plain_body,sent_at,retention_expires_at,received_at)
values('bf800000-0000-4000-8000-000000000002','bf700000-0000-4000-8000-000000000002','bf400000-0000-4000-8000-000000000002',
  'feed000000000002','imported:owner-race-support','outbound','message','sent','info@bloomjoysweets.com',
  'owner-race-customer@example.invalid','Synthetic support notice','RF-OWNER-RACE-2 full $7.00 refund confirmed.',
  '2026-09-02T16:07:00Z',now()+interval '30 days',now());
create table refund_owner_race_test.history as
  select to_jsonb(g) as value from public.refund_gmail_messages g where id='bf800000-0000-4000-8000-000000000002';
create function refund_owner_race_test.run(kind text,n integer,message_id text) returns jsonb language plpgsql as $$
declare c public.refund_cases%rowtype; r uuid;
begin
  perform refund_owner_race_test.authorize();
  select * into c from public.refund_cases where id=('bf400000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid;
  select id into r from public.refund_authoritative_receipts where refund_case_id=c.id;
  if kind='support' then
    return public.admin_adopt_refund_completion_notice(c.id,r,'bf800000-0000-4000-8000-000000000002',
      c.official_action_version,c.public_reference,c.matched_nayax_transaction_id,700,true);
  end if;
  return public.admin_record_refund_historical_owner_notice(c.id,r,c.official_action_version,c.public_reference,
    c.matched_nayax_transaction_id,700,'USD',message_id,'feed000000000099','2026-09-02T16:07:00Z',
    'owner-race-customer@example.invalid',repeat('e',64),'GMAIL-SENT:'||message_id,true,true,true);
exception when others then return jsonb_build_object('error',sqlstate,'message',sqlerrm);
end; $$;
create function refund_owner_race_test.wait_for_b() returns boolean language plpgsql as $$ begin
  for i in 1..200 loop
    perform pg_stat_clear_snapshot();
    if exists(select 1 from pg_stat_activity where application_name='owner_notice_b' and wait_event_type='Lock') then return true; end if;
    perform pg_sleep(0.01);
  end loop;
  return false;
end; $$;
commit;
select no_plan();

-- Same-case external race: B must actually be waiting before A commits.
select extensions.dblink_exec('owner_notice_a','begin');
select * from extensions.dblink('owner_notice_a',$q$select id::text from public.refund_cases where id='bf400000-0000-4000-8000-000000000001' for update$q$) as x(id text);
select extensions.dblink_send_query('owner_notice_b',$q$select refund_owner_race_test.run('owner',1,'feed000000000001')$q$);
select ok(refund_owner_race_test.wait_for_b(),'Second owner adoption really waits on the same case lock');
insert into refund_owner_race_test.results select 'same_a',payload from extensions.dblink('owner_notice_a',$q$select refund_owner_race_test.run('owner',1,'feed000000000001')$q$) as x(payload jsonb);
select extensions.dblink_exec('owner_notice_a','commit');
insert into refund_owner_race_test.results select 'same_b',payload from extensions.dblink_get_result('owner_notice_b') as x(payload jsonb);
select * from extensions.dblink_get_result('owner_notice_b') as x(payload jsonb);
select is((select payload->>'status' from refund_owner_race_test.results where lane='same_a'),'adopted','One owner observation commits');
select is((select payload->>'status' from refund_owner_race_test.results where lane='same_b'),'already_adopted','Waiting identical observation is exact replay');

-- Original support adopter and external observer serialize the SAME canonical row.
select extensions.dblink_exec('owner_notice_a','begin');
select * from extensions.dblink('owner_notice_a',$q$select id::text from public.refund_cases where id='bf400000-0000-4000-8000-000000000002' for update$q$) as x(id text);
select extensions.dblink_send_query('owner_notice_b',$q$select refund_owner_race_test.run('owner',2,'feed000000000002')$q$);
select ok(refund_owner_race_test.wait_for_b(),'External observer really waits while support adopter owns the exact case');
insert into refund_owner_race_test.results select 'support_a',payload from extensions.dblink('owner_notice_a',$q$select refund_owner_race_test.run('support',2,'feed000000000002')$q$) as x(payload jsonb);
select extensions.dblink_exec('owner_notice_a','commit');
insert into refund_owner_race_test.results select 'support_b',payload from extensions.dblink_get_result('owner_notice_b') as x(payload jsonb);
select * from extensions.dblink_get_result('owner_notice_b') as x(payload jsonb);
select is((select payload->>'status' from refund_owner_race_test.results where lane='support_a'),'adopted','Unchanged support RPC wins with real SENT evidence');
select is((select payload->>'error' from refund_owner_race_test.results where lane='support_b'),'P4664','External observer cannot overwrite support adoption');
select is((select payload->>'message' from refund_owner_race_test.results where lane='support_b'),'A different completion notice is already recorded','Cross-source conflict reaches the canonical adoption boundary');

-- Different case locks: unique provider-message identity blocks B on A's insert.
select extensions.dblink_exec('owner_notice_a','begin');
insert into refund_owner_race_test.results select 'message_a',payload from extensions.dblink('owner_notice_a',$q$select refund_owner_race_test.run('owner',3,'feed000000000003')$q$) as x(payload jsonb);
select extensions.dblink_send_query('owner_notice_b',$q$select refund_owner_race_test.run('owner',4,'feed000000000003')$q$);
select ok(refund_owner_race_test.wait_for_b(),'Different-case observation really waits on uncommitted provider-message identity');
select extensions.dblink_exec('owner_notice_a','commit');
insert into refund_owner_race_test.results select 'message_b',payload from extensions.dblink_get_result('owner_notice_b') as x(payload jsonb);
select * from extensions.dblink_get_result('owner_notice_b') as x(payload jsonb);
select is((select payload->>'status' from refund_owner_race_test.results where lane='message_a'),'adopted','First exact claim owns one provider message');
select is((select payload->>'error' from refund_owner_race_test.results where lane='message_b'),'23505','Cross-case concurrent message reuse loses at durable uniqueness');
select is((select count(*) from public.refund_external_notice_observations where refund_case_id::text like 'bf400000-%'),2::bigint,'Two owner winners only, no orphan evidence after either losing race');
select is((select count(*) from public.refund_completion_notice_adoptions where refund_case_id::text like 'bf400000-%'),3::bigint,'One canonical adoption per winning case across both sources');
select is((select count(*) from public.refund_completion_notice_adoptions where refund_case_id='bf400000-0000-4000-8000-000000000004'),0::bigint,'Losing claim in the same thread remains unadopted');
select is((select to_jsonb(g) from public.refund_gmail_messages g where id='bf800000-0000-4000-8000-000000000002'),
  (select value from refund_owner_race_test.history),'Whole prior support message remains immutable through races');
select is((select count(*) from public.refund_case_messages where refund_case_id::text like 'bf400000-%'),0::bigint,'No race creates a customer-send intent');
select is((select count(*) from public.sales_adjustment_facts where refund_case_id::text like 'bf400000-%'),0::bigint,'No race creates accounting effects');
select is((select count(*) from public.refund_case_nayax_refund_attempts where refund_case_id::text like 'bf400000-%'),0::bigint,'No race creates a payment attempt');
select ok((select bool_and(refund_completed_at is null) from public.refund_cases where reporting_machine_id='bf300000-0000-4000-8000-000000000001'),'No race fabricates a settlement date');
select * from finish();
select extensions.dblink_disconnect('owner_notice_a');
select extensions.dblink_disconnect('owner_notice_b');

-- Named disposable-fixture cleanup only, after all behavior proof. Restore guards atomically.
begin;
alter table public.refund_completion_notice_adoptions disable trigger refund_completion_notice_adoptions_immutable;
alter table public.refund_external_notice_observations disable trigger refund_external_notice_observations_immutable;
alter table public.refund_authoritative_receipts disable trigger refund_authoritative_receipts_immutable;
delete from public.refund_completion_notice_adoptions where refund_case_id::text like 'bf400000-%';
delete from public.refund_external_notice_observations where refund_case_id::text like 'bf400000-%';
delete from public.refund_authoritative_receipts where reporting_machine_id='bf300000-0000-4000-8000-000000000001';
alter table public.refund_completion_notice_adoptions enable trigger refund_completion_notice_adoptions_immutable;
alter table public.refund_external_notice_observations enable trigger refund_external_notice_observations_immutable;
alter table public.refund_authoritative_receipts enable trigger refund_authoritative_receipts_immutable;
delete from public.refund_gmail_messages where gmail_thread_id='bf700000-0000-4000-8000-000000000002';
delete from public.refund_gmail_threads where id='bf700000-0000-4000-8000-000000000002';
delete from public.refund_cases where reporting_machine_id='bf300000-0000-4000-8000-000000000001';
delete from public.reporting_machine_refund_managers where reporting_machine_id='bf300000-0000-4000-8000-000000000001';
delete from public.reporting_machines where id='bf300000-0000-4000-8000-000000000001';
delete from public.reporting_locations where id='bf200000-0000-4000-8000-000000000001';
delete from public.customer_accounts where id='bf100000-0000-4000-8000-000000000001';
delete from auth.users where id='bf000000-0000-4000-8000-000000000001';
drop schema refund_owner_race_test cascade;
commit;
