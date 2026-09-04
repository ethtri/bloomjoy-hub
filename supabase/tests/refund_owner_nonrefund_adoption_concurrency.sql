-- Disposable database only. Actual claimed provider boundaries, two sessions.
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
set search_path=public,extensions;
select extensions.dblink_connect('nonrefund_a','host=db port='||current_setting('port')||' dbname='||current_database()||' user=postgres password=postgres sslmode=disable application_name=nonrefund_a');
select extensions.dblink_connect('nonrefund_b','host=db port='||current_setting('port')||' dbname='||current_database()||' user=postgres password=postgres sslmode=disable application_name=nonrefund_b');
select extensions.dblink_exec('nonrefund_a','set statement_timeout=''20s''');
select extensions.dblink_exec('nonrefund_b','set statement_timeout=''20s''');
begin;
create schema refund_nonrefund_race_test;
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('00000000-0000-0000-0000-000000000000','f0000000-0000-4000-8000-000000000001','authenticated','authenticated',
  'nonrefund-owner@example.invalid','',now(),'{}','{}',now(),now());
insert into auth.sessions(id,user_id,created_at,updated_at)
values('f0010000-0000-4000-8000-000000000001','f0000000-0000-4000-8000-000000000001',now(),now());
insert into public.admin_roles(user_id,role,active) values('f0000000-0000-4000-8000-000000000001','super_admin',true);
insert into public.customer_accounts(id,name,account_type) values('f0100000-0000-4000-8000-000000000001','Nonrefund fixture','internal');
insert into public.reporting_locations(id,account_id,name,timezone)
values('f0200000-0000-4000-8000-000000000001','f0100000-0000-4000-8000-000000000001','Nonrefund fixture','America/Los_Angeles');
insert into public.reporting_machines(id,account_id,location_id,machine_label,nayax_machine_id,nayax_account_key)
values('f0300000-0000-4000-8000-000000000001','f0100000-0000-4000-8000-000000000001',
  'f0200000-0000-4000-8000-000000000001','Nonrefund fixture','NONREFUND-MACHINE','NONREFUND-ACCOUNT');
insert into public.reporting_machine_refund_managers(reporting_machine_id,manager_user_id,manager_email,grant_reason)
values('f0300000-0000-4000-8000-000000000001','f0000000-0000-4000-8000-000000000001','nonrefund-owner@example.invalid','Nonrefund fixture');
insert into public.refund_cases(id,public_reference,reporting_machine_id,reporting_location_id,customer_email,issue_summary,
  incident_at,payment_method,payment_amount_cents,card_last4,status,automation_state,created_at)
select ('f0400000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'RF-NONREFUND-'||n,
  'f0300000-0000-4000-8000-000000000001','f0200000-0000-4000-8000-000000000001',
  'nonrefund-customer@example.invalid','Synthetic nonrefund observation',now()-interval '3 days','card',900,'4242',
  'needs_review','under_review',now()-interval '2 days' from generate_series(1,2) n;
create function refund_nonrefund_race_test.owner_auth() returns void language plpgsql as $$ begin
  perform set_config('request.jwt.claim.sub','f0000000-0000-4000-8000-000000000001',true);
  perform set_config('request.jwt.claim.role','authenticated',true);
  perform set_config('request.jwt.claims','{"sub":"f0000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"f0010000-0000-4000-8000-000000000001","is_anonymous":false}',true);
end; $$;
select refund_nonrefund_race_test.owner_auth();
create table refund_nonrefund_race_test.reviews as select c.id,jsonb_build_object('intent',('f0500000-0000-4000-8000-'||right(c.id::text,12))::uuid,
 'version',c.official_action_version,'facts',c.deterministic_fact_version,'reference',c.public_reference,
 'message','cafe'||right(c.id::text,12),'thread','cafe999999999999','sent',now()-interval '1 day',
 'recipient',c.customer_email,'digest',repeat('a',64),'binding',public.refund_owner_notice_review_binding(),
 'reason','not_operated_by_bloomjoy','owned',true,'exact',true) value from public.refund_cases c where c.id::text like 'f0400000-%';
create function refund_nonrefund_race_test.adopt(n integer,changes jsonb default '{}'::jsonb) returns jsonb language plpgsql as $$
declare c uuid:=('f0400000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid; x jsonb;
begin
  select value||changes into x from refund_nonrefund_race_test.reviews where id=c;
  return public.admin_adopt_refund_owner_nonrefund_resolution(c,(x->>'intent')::uuid,(x->>'version')::bigint,
    (x->>'facts')::bigint,x->>'reference',x->>'message',x->>'thread',(x->>'sent')::timestamptz,x->>'recipient',
    x->>'digest',x->>'binding',x->>'reason',(x->>'owned')::boolean,(x->>'exact')::boolean);
end; $$;
create function refund_nonrefund_race_test.change_and_adopt(setup_sql text,n integer) returns text language plpgsql as $$
declare ready boolean:=false;
begin execute setup_sql; ready:=true; perform refund_nonrefund_race_test.adopt(n); raise exception 'Unexpected adoption' using errcode='XX001';
exception when others then if not ready then raise; end if; return sqlstate; end; $$;
create table refund_nonrefund_race_test.claims as
select c.id case_id,claim.* from public.refund_cases c
cross join lateral (select public.service_enqueue_refund_manual_message_intent(c.id,c.official_action_version,
 ('f0600000-0000-4000-8000-'||right(c.id::text,12))::uuid,'f0000000-0000-4000-8000-000000000001',
 'status_update',c.customer_email,'Synthetic follow-up','Synthetic follow-up body','refund_status_update_editable_v1',
 'manager_authored',null,'{}'::text[],null,false,null) value) queued
cross join lateral public.service_claim_refund_manual_message_deliveries((queued.value->>'messageId')::uuid,1) claim
where c.id::text like 'f0400000-%';
create table refund_nonrefund_race_test.results(lane text primary key,value jsonb);
create function refund_nonrefund_race_test.mark(n integer) returns jsonb language plpgsql as $$
declare m uuid; claim uuid; result jsonb;
begin
 select refund_case_message_id,claim_token into m,claim from refund_nonrefund_race_test.claims where case_id=('f0400000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid;
 perform public.service_mark_refund_manual_message_provider_attempt(m,claim);
 result:=public.service_mark_refund_transactional_delivery_attempt(m);
 return result||jsonb_build_object('snapshot',(select to_jsonb(message) from public.refund_case_messages message where id=m));
exception when others then return jsonb_build_object('error',sqlstate); end; $$;
create function refund_nonrefund_race_test.run_adopt(n integer) returns jsonb language plpgsql as $$ begin
 perform refund_nonrefund_race_test.owner_auth(); return refund_nonrefund_race_test.adopt(n);
exception when others then return jsonb_build_object('error',sqlstate,'detail',sqlerrm); end; $$;
create function refund_nonrefund_race_test.wait_for_b() returns boolean language plpgsql as $$ begin
 for i in 1..200 loop
  perform pg_stat_clear_snapshot();
  if exists(select 1 from pg_stat_activity where application_name='nonrefund_b' and wait_event_type='Lock') then return true; end if;
  perform pg_sleep(0.01);
 end loop; return false; end; $$;
commit;
select no_plan();
select is((select count(*) from refund_nonrefund_race_test.claims),2::bigint,'Both intents are actually claimed before adoption');
select ok((select bool_and(m.manual_delivery_state='claimed' and m.manual_delivery_provider_attempted_at is null and m.delivery_transport is null)
 from public.refund_case_messages m join refund_nonrefund_race_test.claims c on c.refund_case_message_id=m.id),'Neither claim began provider access');
select extensions.dblink_exec('nonrefund_a','begin');
insert into refund_nonrefund_race_test.results select 'adopt_first',value from extensions.dblink('nonrefund_a',$q$select refund_nonrefund_race_test.run_adopt(1)$q$) as r(value jsonb);
select extensions.dblink_send_query('nonrefund_b',$q$select refund_nonrefund_race_test.mark(1)$q$);
select ok(refund_nonrefund_race_test.wait_for_b(),'Already-claimed provider mark waits on adopting case lock');
select extensions.dblink_exec('nonrefund_a','commit');
insert into refund_nonrefund_race_test.results select 'mark_after',value from extensions.dblink_get_result('nonrefund_b') as r(value jsonb);
select * from extensions.dblink_get_result('nonrefund_b') as r(value jsonb);
select is((select value->>'status' from refund_nonrefund_race_test.results where lane='adopt_first'),'adopted','Resolution commits first');
select is((select value->>'error' from refund_nonrefund_race_test.results where lane='mark_after'),'P4672','Claimed worker cannot cross actual provider boundary');
select ok((select m.status='skipped' and m.manual_delivery_state='failed' and m.manual_delivery_provider_attempted_at is null
 and m.delivery_transport is null and m.provider_message_id is null from public.refund_case_messages m
 join refund_nonrefund_race_test.claims c on c.refund_case_message_id=m.id where c.case_id='f0400000-0000-4000-8000-000000000001'),
 'Unstarted claimed intent is cancelled without fabricated provider access');
select throws_ok(format('select public.service_mark_refund_transactional_delivery_attempt(%L::uuid)',
 (select refund_case_message_id from refund_nonrefund_race_test.claims where case_id='f0400000-0000-4000-8000-000000000001')),'P4672',null,
 'Direct transactional boundary also suppresses old intent');
-- Reverse race: already-started provider evidence must survive the adoption.
select extensions.dblink_exec('nonrefund_a','begin');
insert into refund_nonrefund_race_test.results select 'mark_first',value from extensions.dblink('nonrefund_a',$q$select refund_nonrefund_race_test.mark(2)$q$) as r(value jsonb);
select extensions.dblink_send_query('nonrefund_b',$q$select refund_nonrefund_race_test.run_adopt(2)$q$);
select ok(refund_nonrefund_race_test.wait_for_b(),'Adoption waits for already-started provider boundary');
select extensions.dblink_exec('nonrefund_a','commit');
create temporary table started_message as select value->'snapshot' value from refund_nonrefund_race_test.results where lane='mark_first';
insert into refund_nonrefund_race_test.results select 'adopt_after',value from extensions.dblink_get_result('nonrefund_b') as r(value jsonb);
select * from extensions.dblink_get_result('nonrefund_b') as r(value jsonb);
select is((select value->>'marked' from refund_nonrefund_race_test.results where lane='mark_first'),'true','Provider access was recorded first');
select is((select value->>'status' from refund_nonrefund_race_test.results where lane='adopt_after'),'adopted','Owner resolution does not pretend started delivery was stopped');
select is((select to_jsonb(m) from public.refund_case_messages m join refund_nonrefund_race_test.claims c on c.refund_case_message_id=m.id
 where c.case_id='f0400000-0000-4000-8000-000000000002'),(select value from started_message),'Entire started/unknown message remains unchanged');
select is((select count(*) from public.refund_case_messages where refund_case_id::text like 'f0400000-%'),2::bigint,'No new message intent');
select is((select count(*) from public.refund_gmail_messages where refund_case_id::text like 'f0400000-%'),0::bigint,'No Gmail send or fabricated source');
select is((select count(*) from public.refund_case_nayax_refund_attempts where refund_case_id::text like 'f0400000-%'),0::bigint,'No payment attempt');
select is((select count(*) from public.refund_authoritative_receipts where refund_case_id::text like 'f0400000-%'),0::bigint,'No receipt');
select * from finish();
select extensions.dblink_disconnect('nonrefund_a');
select extensions.dblink_disconnect('nonrefund_b');
-- Only named disposable fixtures are removed; immutable guard restored atomically.
begin;
alter table public.refund_case_events disable trigger refund_case_events_guard_owner_nonrefund;
delete from public.refund_case_events where refund_case_id::text like 'f0400000-%';
alter table public.refund_case_events enable trigger refund_case_events_guard_owner_nonrefund;
delete from public.refund_case_messages where refund_case_id::text like 'f0400000-%';
delete from public.refund_cases where id::text like 'f0400000-%';
delete from public.reporting_machine_refund_managers where reporting_machine_id='f0300000-0000-4000-8000-000000000001';
delete from public.reporting_machines where id='f0300000-0000-4000-8000-000000000001';
delete from public.reporting_locations where id='f0200000-0000-4000-8000-000000000001';
delete from public.customer_accounts where id='f0100000-0000-4000-8000-000000000001';
delete from auth.users where id='f0000000-0000-4000-8000-000000000001';
drop schema refund_nonrefund_race_test cascade;
commit;
