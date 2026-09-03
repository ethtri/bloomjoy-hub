create extension if not exists dblink with schema extensions;
do $$ begin
 perform extensions.dblink_connect('verification_local_guard','host=db port='||current_setting('port')||' dbname='||current_database()||' user=postgres password=postgres sslmode=disable');
 perform extensions.dblink_disconnect('verification_local_guard');
end $$;
begin;
create schema refund_verification_race;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;


insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('00000000-0000-4000-8000-000000000000','b8000000-0000-4000-8000-000000000001','authenticated','authenticated',
  'verification-manager@example.invalid','',now(),'{}','{}',now(),now());
insert into auth.sessions(id,user_id,created_at,updated_at)
values('b8010000-0000-4000-8000-000000000001','b8000000-0000-4000-8000-000000000001',now(),now());
insert into public.admin_roles(user_id,role,active) values('b8000000-0000-4000-8000-000000000001','super_admin',true);
insert into public.customer_accounts(id,name,account_type) values('b8100000-0000-4000-8000-000000000001','Verification fixture','internal');
insert into public.reporting_locations(id,account_id,name,timezone)
values('b8200000-0000-4000-8000-000000000001','b8100000-0000-4000-8000-000000000001','Verification fixture','America/Chicago');
insert into public.reporting_machines(id,account_id,location_id,machine_label,nayax_machine_id,nayax_account_key,nayax_refunds_enabled)
values('b8300000-0000-4000-8000-000000000001','b8100000-0000-4000-8000-000000000001',
  'b8200000-0000-4000-8000-000000000001','Verification fixture','VERIFICATION-MACHINE','VERIFICATION-ACCOUNT',true);
insert into public.reporting_machine_refund_managers(reporting_machine_id,manager_user_id,manager_email,grant_reason)
values('b8300000-0000-4000-8000-000000000001','b8000000-0000-4000-8000-000000000001','verification-manager@example.invalid','Verification fixture');
insert into public.refund_nayax_provider_callers(caller_id,assertion_digest,status)
values('nayax-card-refund',encode(extensions.digest('verification-executor','sha256'),'hex'),'active')
on conflict(caller_id) do update set assertion_digest=excluded.assertion_digest,status='active';
insert into public.refund_cases(id,public_reference,reporting_machine_id,reporting_location_id,customer_email,issue_summary,
  incident_at,payment_method,payment_amount_cents,refund_amount_cents,card_last4,status,correlation_status,correlation_source,
  correlation_confidence,automation_state,matched_nayax_transaction_id,matched_nayax_amount_cents,matched_nayax_currency_code,
  matched_nayax_machine_auth_time,matched_nayax_site_id,nayax_recommendation_state,nayax_recommendation_policy_version,
  nayax_match_execution_eligible,nayax_refund_execution_status)
select ('b8400000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'RF-VERIFY-'||n,
  'b8300000-0000-4000-8000-000000000001','b8200000-0000-4000-8000-000000000001',
  'verification-customer@example.invalid','Synthetic verification fixture',now()-interval '3 days','card',800,800,'4242',
  'needs_review','matched','nayax',1,'approved',(723456780+n)::text,800,'USD','2026-08-26T18:17:09.810Z',6,
  'high_confidence','2026-07-21.v1',true,'not_requested' from generate_series(1,5) n;
insert into public.refund_case_events(refund_case_id,actor_user_id,event_type,message,metadata)
select ('b8400000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'b8000000-0000-4000-8000-000000000001',
  'nayax_match_selected','Synthetic exact selection','{"payload_redacted":true}' from generate_series(1,5) n;
select set_config('request.jwt.claims','{"sub":"b8000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"b8010000-0000-4000-8000-000000000001","is_anonymous":false}',true);
select set_config('request.jwt.claim.sub','b8000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claim.role','authenticated',true);

create function refund_verification_race.record_verification(n integer,changes jsonb default '{}') returns jsonb language plpgsql as $$
declare cid uuid:=('b8400000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid; v bigint; x jsonb;
begin
  select official_action_version into v from public.refund_cases where id=cid;
  x:=jsonb_build_object('version',v,'original',(723456780+n)::text,'scope','VERIFICATION-ACCOUNT',
    'machine','VERIFICATION-MACHINE','site',6,'time','2026-08-26T13:17:08.123','amount',800,'refunded',0,
    'remaining',800,'currency','USD','reference','DTM:NAYAX-'||(723456780+n)::text,'noPending',true,'exclusive',true)||changes;
  return public.admin_record_refund_nayax_execution_verification(cid,(x->>'version')::bigint,x->>'original',x->>'scope',
    x->>'machine',(x->>'site')::integer,x->>'time',(x->>'amount')::integer,(x->>'refunded')::integer,
    (x->>'remaining')::integer,x->>'currency',x->>'reference',(x->>'noPending')::boolean,(x->>'exclusive')::boolean);
end $$;
create function refund_verification_race.reserve_verified(n integer,verification_id uuid) returns jsonb language plpgsql as $$
declare cid uuid:=('b8400000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid; v bigint;
begin
  select official_action_version into v from public.refund_cases where id=cid;
  return public.service_reserve_nayax_refund_manager_action_v3('verification-executor',
    'b8000000-0000-4000-8000-000000000001',cid,v,'nayax-refund-'||repeat(n::text,64),800,null,null,'USD',
    'nayax-production-account-contract-v2','nayax-provider-journal-v3',verification_id);
end $$;


select refund_verification_race.record_verification(1);
select refund_verification_race.record_verification(2);
create table refund_verification_race.first_reservation as
 select refund_verification_race.reserve_verified(1,(select id from public.refund_nayax_execution_verifications where refund_case_id='b8400000-0000-4000-8000-000000000001')) as result;
create function refund_verification_race.start_request() returns jsonb language sql as $$
 select public.service_record_nayax_refund_provider_stage_v3('verification-executor',
  (select (result#>>'{attempt,attemptId}')::uuid from refund_verification_race.first_reservation),
  (select result->>'providerClaimToken' from refund_verification_race.first_reservation),
  'request','started',null,null,null,null,repeat('a',64),'nayax-production-account-contract-v2','nayax-provider-journal-v3',
  null,null,null,null,null,null,null,null,null,null,null,null);
$$;
commit;
select plan(5);
do $$ declare connection text:='host=db port='||current_setting('port')||' dbname='||current_database()||' user=postgres password=postgres sslmode=disable'; begin
 perform extensions.dblink_connect('verification_a',connection||' application_name=verification_race_a');
 perform extensions.dblink_connect('verification_b',connection||' application_name=verification_race_b');
end $$;
-- Block the attempt while request-start first acquires the case. A replay must
-- wait for that case, not hold it while waiting back on the request's attempt.
begin;
select id from public.refund_case_nayax_refund_attempts where refund_case_id='b8400000-0000-4000-8000-000000000001' for update;
select extensions.dblink_send_query('verification_a','select refund_verification_race.start_request()');
do $$ declare deadline timestamptz:=clock_timestamp()+interval '5 seconds'; begin
 loop
  perform pg_stat_clear_snapshot();
  exit when exists(select 1 from pg_stat_activity where application_name='verification_race_a' and wait_event_type='Lock');
  if clock_timestamp()>deadline then raise exception 'Request did not reach lock barrier'; end if;
  perform pg_sleep(0.01);
 end loop;
end $$;
select extensions.dblink_send_query('verification_b','select refund_verification_race.reserve_verified(1,null)');
do $$ declare deadline timestamptz:=clock_timestamp()+interval '5 seconds'; begin
 loop
  perform pg_stat_clear_snapshot();
  exit when exists(select 1 from pg_stat_activity where application_name='verification_race_b' and wait_event_type='Lock');
  if clock_timestamp()>deadline then raise exception 'Replay did not reach lock barrier'; end if;
  perform pg_sleep(0.01);
 end loop;
end $$;
commit;
create temporary table verification_race_results(kind text,result jsonb);
insert into verification_race_results select 'start',result from extensions.dblink_get_result('verification_a') as r(result jsonb);
insert into verification_race_results select 'replay',result from extensions.dblink_get_result('verification_b') as r(result jsonb);
select is((select result->>'recorded' from verification_race_results where kind='start'),'true','Request starts without a replay deadlock');
select is((select result#>>'{attempt,shouldExecute}' from verification_race_results where kind='replay'),'false','Concurrent replay never receives a provider claim');
-- Two distinct sessions may review before either reserves. The case lock and
-- immutable reservation still allow exactly one request claim.
select * from extensions.dblink_get_result('verification_a') as r(result jsonb);
select * from extensions.dblink_get_result('verification_b') as r(result jsonb);
begin;
select id from public.refund_cases where id='b8400000-0000-4000-8000-000000000002' for update;
select extensions.dblink_send_query('verification_a',$q$select refund_verification_race.reserve_verified(2,(select id from public.refund_nayax_execution_verifications where refund_case_id='b8400000-0000-4000-8000-000000000002'))$q$);
select extensions.dblink_send_query('verification_b',$q$select refund_verification_race.reserve_verified(2,(select id from public.refund_nayax_execution_verifications where refund_case_id='b8400000-0000-4000-8000-000000000002'))$q$);
commit;
insert into verification_race_results select 'reserve-a',result from extensions.dblink_get_result('verification_a') as r(result jsonb);
insert into verification_race_results select 'reserve-b',result from extensions.dblink_get_result('verification_b') as r(result jsonb);
select is((select count(*) from verification_race_results where kind like 'reserve-%' and result#>>'{attempt,shouldExecute}'='true'),1::bigint,'One concurrent manager action receives the request claim');
select is((select count(*) from public.refund_case_nayax_refund_attempts where refund_case_id='b8400000-0000-4000-8000-000000000002'),1::bigint,'Concurrent managers reserve one attempt');
select is((select count(*) from public.refund_nayax_provider_stage_journal where nayax_refund_attempt_id=(select (result#>>'{attempt,attemptId}')::uuid from refund_verification_race.first_reservation)),1::bigint,'Only one request-start marker is recorded');
select extensions.dblink_disconnect('verification_a');
select extensions.dblink_disconnect('verification_b');
-- Remove only the committed synthetic fixture, with immutable-record triggers
-- suspended solely for owner cleanup in the disposable test database.
begin;
alter table public.refund_nayax_provider_stage_journal disable trigger user;
delete from public.refund_nayax_provider_stage_journal where nayax_refund_attempt_id in (select id from public.refund_case_nayax_refund_attempts where refund_case_id::text like 'b8400000-%');
alter table public.refund_nayax_provider_stage_journal enable trigger user;
delete from public.refund_case_nayax_refund_attempts where refund_case_id::text like 'b8400000-%';
alter table public.refund_nayax_execution_verifications disable trigger refund_nayax_execution_verification_immutable;
delete from public.refund_nayax_execution_verifications where refund_case_id::text like 'b8400000-%';
alter table public.refund_nayax_execution_verifications enable trigger refund_nayax_execution_verification_immutable;
delete from public.refund_case_official_action_authorizations where refund_case_id::text like 'b8400000-%';
delete from public.refund_manager_action_step_up_intents where refund_case_id::text like 'b8400000-%';
delete from public.refund_cases where id::text like 'b8400000-%';
delete from public.reporting_machine_refund_managers where reporting_machine_id='b8300000-0000-4000-8000-000000000001';
delete from public.reporting_machines where id='b8300000-0000-4000-8000-000000000001';
delete from public.reporting_locations where id='b8200000-0000-4000-8000-000000000001';
delete from public.customer_accounts where id='b8100000-0000-4000-8000-000000000001';
delete from auth.users where id='b8000000-0000-4000-8000-000000000001';
delete from public.refund_nayax_provider_callers where caller_id='nayax-card-refund';
drop schema refund_verification_race cascade;
commit;
select * from finish();
