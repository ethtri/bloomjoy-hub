create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
set search_path=public,extensions;

do $$
declare local_connection text:='host=db port='||current_setting('port')
  ||' dbname='||current_database()||' user=postgres password=postgres sslmode=disable';
begin
  perform extensions.dblink_connect('manager_session_local_guard',local_connection);
  perform extensions.dblink_disconnect('manager_session_local_guard');
end;
$$;

begin;
drop schema if exists refund_manager_session_race_test cascade;
create schema refund_manager_session_race_test;

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values
('00000000-0000-0000-0000-000000000000','8b000000-0000-4000-8000-000000000001',
 'authenticated','authenticated','manager-session-race@example.test','',now(),'{}','{}',now(),now()),
('00000000-0000-0000-0000-000000000000','8b000000-0000-4000-8000-000000000002',
 'authenticated','authenticated','manager-session-owner@example.test','',now(),'{}','{}',now(),now());
insert into public.admin_roles(id,user_id,role,active)
values('8b010000-0000-4000-8000-000000000001','8b000000-0000-4000-8000-000000000002','super_admin',true);
insert into public.customer_accounts(id,name,account_type)
values('8b100000-0000-4000-8000-000000000001','Manager-session race','customer');
insert into public.reporting_locations(id,account_id,name,timezone)
values('8b200000-0000-4000-8000-000000000001','8b100000-0000-4000-8000-000000000001',
  'Manager-session race location','America/Los_Angeles');
insert into public.reporting_machines(id,account_id,location_id,machine_label,nayax_machine_id,
  nayax_account_key,nayax_refunds_enabled,nayax_refund_max_amount_cents)
values('8b300000-0000-4000-8000-000000000001','8b100000-0000-4000-8000-000000000001',
  '8b200000-0000-4000-8000-000000000001','Manager-session race machine',
  'MANAGER-SESSION-RACE-MACHINE','MANAGER_SESSION_RACE_ACCOUNT',true,2500);
insert into public.reporting_machine_refund_managers(
  id,reporting_machine_id,manager_user_id,manager_email,grant_reason)
values('8b400000-0000-4000-8000-000000000001','8b300000-0000-4000-8000-000000000001',
  '8b000000-0000-4000-8000-000000000001','manager-session-race@example.test',
  'Two-session immutable approval race');

insert into public.refund_cases(
  id,public_reference,reporting_machine_id,reporting_location_id,customer_email,
  issue_summary,incident_at,payment_method,payment_amount_cents,refund_amount_cents,
  status,card_last4,card_wallet_used,correlation_status,correlation_source,
  correlation_confidence,matched_nayax_transaction_id,matched_nayax_site_id,
  matched_nayax_machine_auth_time,matched_nayax_amount_cents,matched_nayax_card_last4,
  matched_nayax_currency_code,nayax_recommendation_state,nayax_recommendation_policy_version,
  nayax_recommendation_evaluated_at,nayax_match_execution_eligible)
values('8b600000-0000-4000-8000-000000000001','RF-MANAGER-SESSION-RACE',
  '8b300000-0000-4000-8000-000000000001','8b200000-0000-4000-8000-000000000001',
  'manager-session-race-customer@example.test','Exact manager-session race',
  now()-interval '1 day','card',700,700,'needs_review','4242',false,'matched','nayax',1,
  'MANAGER-SESSION-RACE-TX',901,now()-interval '1 day',700,'4242','USD',
  'high_confidence','manager-session-race-v1',now(),true);
insert into public.refund_case_events(refund_case_id,actor_user_id,event_type,message,metadata)
values('8b600000-0000-4000-8000-000000000001','8b000000-0000-4000-8000-000000000001',
  'nayax_match_selected','Manager selected the exact transaction.',
  '{"selected_recommended":true,"payload_redacted":true}'::jsonb);
insert into public.refund_nayax_provider_callers(caller_id,assertion_digest)
values('nayax-card-refund',encode(extensions.digest(
  convert_to('manager-session-race-executor','UTF8'),'sha256'),'hex'));

update public.refund_manager_security_config set
  totp_enrollment_enabled=false,
  totp_enrollment_approved_manager_user_id=null,
  totp_enrollment_approved_by_owner_user_id=null,
  totp_enrollment_approval_expires_at=null,
  totp_enrollment_owner_user_id_digest=encode(extensions.digest(
    convert_to('8b000000-0000-4000-8000-000000000002','UTF8'),'sha256'),'hex')
where singleton=true;

create function refund_manager_session_race_test.reserve()
returns jsonb language plpgsql set search_path=public,auth as $$
declare reservation jsonb;
begin
  reservation:=public.service_reserve_nayax_refund_manager_action(
    'manager-session-race-executor','8b000000-0000-4000-8000-000000000001',
    '8b600000-0000-4000-8000-000000000001',1,
    'nayax-refund-'||repeat('8',64),700,100000,100,'USD');
  return jsonb_build_object('ok',true,'reservation',reservation);
exception when others then return jsonb_build_object('ok',false,'error',sqlerrm);
end;
$$;

create function refund_manager_session_race_test.open_owner_window()
returns jsonb language plpgsql set search_path=public,auth as $$
declare opened jsonb;
begin
  perform set_config('request.jwt.claim.sub','8b000000-0000-4000-8000-000000000002',true);
  perform set_config('request.jwt.claim.role','authenticated',true);
  perform set_config('request.jwt.claims',jsonb_build_object(
    'sub','8b000000-0000-4000-8000-000000000002','role','authenticated',
    'aal','aal1','amr','[]'::jsonb)::text,true);
  opened:=public.open_refund_manager_totp_enrollment_window_current_user();
  return jsonb_build_object('ok',true,'opened',opened->'opened','status',opened->'status',
    'windowExpiresAt',opened->'windowExpiresAt');
exception when others then return jsonb_build_object('ok',false,'error',sqlerrm);
end;
$$;
commit;

select plan(6);
create temporary table manager_session_race_results(
  connection_name text primary key,result jsonb not null);
create temporary table owner_window_race_results(
  connection_name text primary key,result jsonb not null);
create temporary table owner_window_race_baseline as
select totp_enrollment_approval_version approval_version
from public.refund_manager_security_config where singleton=true;

do $$
declare local_connection text:='host=db port='||current_setting('port')
  ||' dbname='||current_database()||' user=postgres password=postgres sslmode=disable';
begin
  perform extensions.dblink_connect('manager_session_race_a',local_connection);
  perform extensions.dblink_connect('manager_session_race_b',local_connection);
end;
$$;

begin;
do $$ begin
  perform pg_advisory_xact_lock(hashtextextended(
    'refund-nayax-manager-session-v2|8b000000-0000-4000-8000-000000000001|8b600000-0000-4000-8000-000000000001',0));
  perform extensions.dblink_send_query('manager_session_race_a',
    'select refund_manager_session_race_test.reserve()');
  perform extensions.dblink_send_query('manager_session_race_b',
    'select refund_manager_session_race_test.reserve()');
end; $$;
commit;

insert into manager_session_race_results select 'a',result
from extensions.dblink_get_result('manager_session_race_a') as response(result jsonb);
insert into manager_session_race_results select 'b',result
from extensions.dblink_get_result('manager_session_race_b') as response(result jsonb);

select is((select count(*)::integer from manager_session_race_results
  where (result->>'ok')::boolean),2,
  'Two independent sessions complete the same serialized manager approval request');
select ok(
  (select count(*)=1 from manager_session_race_results
    where (result#>>'{reservation,attempt,shouldExecute}')::boolean)
  and (select count(*)=1 from manager_session_race_results
    where not (result#>>'{reservation,attempt,shouldExecute}')::boolean),
  'Exactly one racing request owns the provider call and one receives the immutable replay');
select ok(
  (select count(*)=1 from public.refund_case_official_action_authorizations
    where refund_case_id='8b600000-0000-4000-8000-000000000001'
      and authorization_method='manager_session' and status='consumed')
  and (select count(*)=1 from public.refund_case_nayax_refund_attempts
    where refund_case_id='8b600000-0000-4000-8000-000000000001'),
  'The consume race commits one manager-session receipt and one bound attempt');
select ok((select receipt.id=attempt.official_action_authorization_id
    and receipt.actor_user_id=attempt.actor_user_id
    and receipt.expected_case_version=1
    and attempt.amount_cents=700 and attempt.currency_code='USD'
  from public.refund_case_nayax_refund_attempts attempt
  join public.refund_case_official_action_authorizations receipt
    on receipt.id=attempt.official_action_authorization_id
  where attempt.refund_case_id='8b600000-0000-4000-8000-000000000001'),
  'The winning attempt retains the exact receipt, actor, version, amount, and currency');

do $$
declare local_connection text:='host=db port='||current_setting('port')
  ||' dbname='||current_database()||' user=postgres password=postgres sslmode=disable';
begin
  perform extensions.dblink_disconnect('manager_session_race_a');
  perform extensions.dblink_disconnect('manager_session_race_b');
  perform extensions.dblink_connect('manager_session_race_a',local_connection);
  perform extensions.dblink_connect('manager_session_race_b',local_connection);
end;
$$;
begin;
do $$ begin
  perform pg_advisory_xact_lock(hashtextextended('refund-totp-enrollment-owner-window',782));
  perform extensions.dblink_send_query('manager_session_race_a',
    'select refund_manager_session_race_test.open_owner_window()');
  perform extensions.dblink_send_query('manager_session_race_b',
    'select refund_manager_session_race_test.open_owner_window()');
end; $$;
commit;
insert into owner_window_race_results select 'a',result
from extensions.dblink_get_result('manager_session_race_a') as response(result jsonb);
insert into owner_window_race_results select 'b',result
from extensions.dblink_get_result('manager_session_race_b') as response(result jsonb);
select ok(
  (select count(*)=2 from owner_window_race_results where (result->>'ok')::boolean)
  and (select count(*)=1 from owner_window_race_results where (result->>'opened')::boolean)
  and (select count(*)=1 from owner_window_race_results where result->>'status'='already_open'),
  'Concurrent owner-window calls serialize into one open and one non-extending replay');
select ok(exists(select 1 from public.refund_manager_security_config config
    cross join owner_window_race_baseline baseline where config.singleton=true
      and config.totp_enrollment_approval_version=baseline.approval_version+1
      and config.totp_enrollment_approval_expires_at=config.updated_at+interval '5 minutes')
  and (select count(*)=1 from public.refund_manager_step_up_audit
    where actor_user_id='8b000000-0000-4000-8000-000000000002'
      and event_type='totp_enrollment_window_opened'),
  'The owner-window race commits one version, expiry, and audit record');

do $$ begin
  perform extensions.dblink_disconnect('manager_session_race_a');
  perform extensions.dblink_disconnect('manager_session_race_b');
end; $$;
select * from finish();

begin;
delete from public.refund_manager_step_up_audit
where actor_user_id='8b000000-0000-4000-8000-000000000002';
delete from public.refund_case_nayax_refund_attempts
where refund_case_id='8b600000-0000-4000-8000-000000000001';
delete from public.refund_case_official_action_authorizations
where refund_case_id='8b600000-0000-4000-8000-000000000001';
delete from public.refund_case_events
where refund_case_id='8b600000-0000-4000-8000-000000000001';
delete from public.refund_cases where id='8b600000-0000-4000-8000-000000000001';
delete from public.refund_nayax_provider_callers where caller_id='nayax-card-refund';
delete from public.reporting_machine_refund_managers
where id='8b400000-0000-4000-8000-000000000001';
delete from public.admin_roles where id='8b010000-0000-4000-8000-000000000001';
delete from public.reporting_machines where id='8b300000-0000-4000-8000-000000000001';
delete from public.reporting_locations where id='8b200000-0000-4000-8000-000000000001';
delete from public.customer_accounts where id='8b100000-0000-4000-8000-000000000001';
update public.refund_manager_security_config set
  totp_enrollment_enabled=false,totp_enrollment_approved_manager_user_id=null,
  totp_enrollment_approved_by_owner_user_id=null,totp_enrollment_approval_expires_at=null,
  updated_at=statement_timestamp() where singleton=true;
delete from auth.users where id in (
  '8b000000-0000-4000-8000-000000000001','8b000000-0000-4000-8000-000000000002');
drop schema refund_manager_session_race_test cascade;
commit;
