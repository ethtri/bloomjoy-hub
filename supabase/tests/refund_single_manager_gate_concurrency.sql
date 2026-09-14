create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
set search_path=public,extensions;

-- This regression commits its synthetic fixture so two independent database
-- sessions can enter the manager approval function at the same time.
do $$
declare connection text:='host=db port='||current_setting('port')||' dbname='||current_database()
  ||' user=postgres password=postgres sslmode=disable';
begin
  perform extensions.dblink_connect('single_gate_race_guard',connection);
  perform extensions.dblink_disconnect('single_gate_race_guard');
end $$;

begin;
drop schema if exists refund_single_gate_race cascade;
create schema refund_single_gate_race;
create table refund_single_gate_race.results(lane text primary key,payload jsonb not null);
create table refund_single_gate_race.settings(expected_version bigint not null);
create table refund_single_gate_race.provider_caller_backup as
select * from public.refund_nayax_provider_callers where caller_id='nayax-card-refund';

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
('00000000-0000-0000-0000-000000000000','b3410000-0000-4000-8000-000000000001',
 'authenticated','authenticated','single-gate-race@example.invalid','',now(),'{}','{}',now(),now());
insert into public.customer_accounts(id,name,account_type)
values('b3420000-0000-4000-8000-000000000001','Single gate race','internal');
insert into public.reporting_locations(id,account_id,name,timezone)
values('b3430000-0000-4000-8000-000000000001','b3420000-0000-4000-8000-000000000001',
  'Single gate race location','America/Los_Angeles');
insert into public.reporting_machines(id,account_id,location_id,machine_label,status,
  nayax_machine_id,nayax_account_key,nayax_refunds_enabled)
values('b3440000-0000-4000-8000-000000000001','b3420000-0000-4000-8000-000000000001',
  'b3430000-0000-4000-8000-000000000001','Single gate race machine','active',
  'SINGLE-GATE-RACE-MACHINE','SINGLE_GATE_RACE_ACCOUNT',true);
insert into public.refund_nayax_machine_inventory(account_key,nayax_machine_id,reporting_machine_id)
values('SINGLE_GATE_RACE_ACCOUNT','SINGLE-GATE-RACE-MACHINE','b3440000-0000-4000-8000-000000000001');
insert into public.reporting_machine_refund_managers(id,reporting_machine_id,manager_user_id,
  manager_email,grant_reason)
values('b3450000-0000-4000-8000-000000000001','b3440000-0000-4000-8000-000000000001',
  'b3410000-0000-4000-8000-000000000001','single-gate-race@example.invalid','Race fixture');
insert into public.refund_nayax_provider_callers(caller_id,assertion_digest,status)
values('nayax-card-refund',encode(extensions.digest(convert_to('single-gate-race-executor','UTF8'),'sha256'),'hex'),'active')
on conflict(caller_id) do update set assertion_digest=excluded.assertion_digest,status='active';

insert into public.refund_cases(id,public_reference,reporting_machine_id,reporting_location_id,
  customer_email,issue_summary,incident_at,incident_timezone,incident_time_resolution,
  incident_time_confidence,payment_method,payment_amount_cents,refund_amount_cents,
  card_last4,card_last4_provenance,payment_interaction,status,correlation_status,
  correlation_source,correlation_confidence,correlation_summary,deterministic_fact_version,
  intake_source,intake_meta,nayax_lookup_generation,nayax_lookup_status,
  nayax_refund_execution_status,matched_nayax_transaction_id,matched_nayax_site_id,
  matched_nayax_machine_auth_time,matched_nayax_amount_cents,matched_nayax_card_last4,
  matched_nayax_currency_code)
values('b3470000-0000-4000-8000-000000000001','RF-SINGLE-GATE-RACE',
  'b3440000-0000-4000-8000-000000000001','b3430000-0000-4000-8000-000000000001',
  'race-customer@example.invalid','Concurrent exact saved sale','2026-09-12T20:00:00Z',
  'America/Los_Angeles','exact','exact','card',1000,1090,'4242','physical_card','tap_card',
  'needs_review','matched','nayax',100,'Exact saved System candidate',1,'form','{}',1,
  'manual_exception','not_requested','RF423906B2-RACE',17,'2026-09-12T20:00:00Z',1090,'4242','USD');

insert into public.refund_nayax_lookup_candidates(token,refund_case_id,lookup_generation,actor_user_id,
  reporting_machine_id,provider_transaction_id,site_id,machine_authorization_time,amount_cents,
  card_last4,currency_code,evidence_summary,expires_at)
values('b3480000-0000-4000-8000-000000000001','b3470000-0000-4000-8000-000000000001',1,
  'b3410000-0000-4000-8000-000000000001','b3440000-0000-4000-8000-000000000001',
  'RF423906B2-RACE',17,'2026-09-12T20:00:00Z',1090,'4242','USD',jsonb_build_object(
    'source','nayax_api','selection_allowed',true,'is_recommended',true,'one_click_eligible',false,
    'recommendation_state','manual_exception','confidence_class','evidence_aware_review',
    'policy_version','2026-09-05.v11','identifier_policy_version','2026-09-05.identifier.v2',
    'customer_fact_version',1,'customer_credential_class','customer_physical_contactless_pan',
    'provider_identifier_class','last_sales_present_identifier_unverified',
    'card_last4_comparison','exact','card_network_comparison','missing',
    'payment_interaction_comparison','unknown','same_identifier_equivalence_proven',false,
    'identifier_review_state','reviewable_uncertainty','customer_correction_fields','[]'::jsonb,
    'hard_exclusions','[]'::jsonb,'manual_review_reasons','[]'::jsonb,
    'reason_codes','["machine_exact","provider_sale_approved"]'::jsonb,'match_factors','[]'::jsonb,
    'match_reason','Exact saved System candidate','recommendation_rank',1,'is_top_ranked',true,
    'lookup_account_scope','SINGLE_GATE_RACE_ACCOUNT','lookup_provider_machine_id','SINGLE-GATE-RACE-MACHINE',
    'provider_machine_id','SINGLE-GATE-RACE-MACHINE','machine_authorization_time_raw','2026-09-12T20:00:00Z',
    'machine_authorization_at','2026-09-12T20:00:00Z','machine_authorization_time_source','MachineAuthorizationTime',
    'machine_time_resolution','exact','provider_time_resolution','exact','provider_time_source','authorization_gmt',
    'authorized_at','2026-09-12T20:00:00Z','request_time_boundary','request_time_unknown',
    'transaction_occurrence_comparable',false,'transaction_occurrence_semantics','unknown',
    'amount_delta_cents',90,'provider_processing_time_delta_minutes',0,'payment_status','approved',
    'payment_status_evidence','last_sales_contract','provider_refund_state','clear',
    'duplicate_provider_record',false,'card_last4','4242','currency_code','USD','amount_cents',1090),
  now()+interval '1 hour');
insert into refund_single_gate_race.settings
select official_action_version from public.refund_cases where id='b3470000-0000-4000-8000-000000000001';

create function refund_single_gate_race.approve() returns jsonb language plpgsql as $$
declare output jsonb;
begin
  perform set_config('request.jwt.claim.sub','b3410000-0000-4000-8000-000000000001',true);
  perform set_config('request.jwt.claim.role','authenticated',true);
  perform set_config('request.jwt.claims','{"sub":"b3410000-0000-4000-8000-000000000001","role":"authenticated","is_anonymous":false}',true);
  begin
    output:=public.admin_approve_selected_nayax_refund_for_system_v1(
      'b3470000-0000-4000-8000-000000000001',(select expected_version from refund_single_gate_race.settings));
    return jsonb_build_object('ok',true,'output',output);
  exception when others then
    return jsonb_build_object('ok',false,'sqlstate',sqlstate,'message',sqlerrm);
  end;
end $$;

create function refund_single_gate_race.delay_case_update() returns trigger language plpgsql
set search_path='' as $$ begin perform pg_sleep(0.5); return new; end $$;
create trigger refund_single_gate_race_delay before update on public.refund_cases for each row
when (new.id='b3470000-0000-4000-8000-000000000001')
execute function refund_single_gate_race.delay_case_update();
commit;

select plan(5);
select extensions.dblink_connect('single_gate_race_a','host=db port='||current_setting('port')
  ||' dbname='||current_database()||' user=postgres password=postgres sslmode=disable');
select extensions.dblink_connect('single_gate_race_b','host=db port='||current_setting('port')
  ||' dbname='||current_database()||' user=postgres password=postgres sslmode=disable');
select extensions.dblink_send_query('single_gate_race_a','select refund_single_gate_race.approve()');
select extensions.dblink_send_query('single_gate_race_b','select refund_single_gate_race.approve()');
insert into refund_single_gate_race.results select 'a',payload
  from extensions.dblink_get_result('single_gate_race_a') result(payload jsonb);
insert into refund_single_gate_race.results select 'b',payload
  from extensions.dblink_get_result('single_gate_race_b') result(payload jsonb);
select extensions.dblink_disconnect('single_gate_race_a');
select extensions.dblink_disconnect('single_gate_race_b');

select ok((select count(*)=2 from refund_single_gate_race.results)
  and (select count(*)=1 from refund_single_gate_race.results where (payload->>'ok')::boolean)
  and (select count(*)=1 from refund_single_gate_race.results
    where not (payload->>'ok')::boolean and payload->>'sqlstate'='P4620')
  and not exists(select 1 from refund_single_gate_race.results where payload->>'sqlstate'='40P01'),
  'two simultaneous manager sessions finish without deadlock and exactly one wins');
select is((select count(*) from public.refund_case_official_action_authorizations
  where refund_case_id='b3470000-0000-4000-8000-000000000001'),1::bigint,
  'the race consumes exactly one financial authorization');
select is((select count(*) from public.refund_case_nayax_refund_attempts
  where refund_case_id='b3470000-0000-4000-8000-000000000001'),1::bigint,
  'the race creates exactly one System-owned provider attempt');
create temp table race_claim as select public.service_claim_due_nayax_refund_attempts_v1(
  'single-gate-race-executor','SINGLE_GATE_RACE_ACCOUNT','exact_source','empty_string',1) payload;
select is(jsonb_array_length((select payload->'claims' from race_claim)),1,
  'the current queue claims the winning attempt exactly once');
select is(jsonb_array_length(public.service_claim_due_nayax_refund_attempts_v1(
  'single-gate-race-executor','SINGLE_GATE_RACE_ACCOUNT','exact_source','empty_string',1)->'claims'),0,
  'a second queue consumer cannot claim the same attempt');
select * from finish();

-- The committed fixture exists only to permit real independent sessions.
set session_replication_role=replica;
delete from public.refund_case_events where refund_case_id='b3470000-0000-4000-8000-000000000001';
delete from public.refund_nayax_transaction_allocations where refund_case_id='b3470000-0000-4000-8000-000000000001';
delete from public.refund_nayax_execution_contexts where refund_case_id='b3470000-0000-4000-8000-000000000001';
delete from public.refund_case_nayax_refund_attempts where refund_case_id='b3470000-0000-4000-8000-000000000001';
delete from public.refund_case_official_action_authorizations where refund_case_id='b3470000-0000-4000-8000-000000000001';
delete from public.refund_nayax_lookup_candidates where refund_case_id='b3470000-0000-4000-8000-000000000001';
delete from public.refund_cases where id='b3470000-0000-4000-8000-000000000001';
delete from public.reporting_machine_refund_managers where id='b3450000-0000-4000-8000-000000000001';
delete from public.refund_nayax_machine_inventory where nayax_machine_id='SINGLE-GATE-RACE-MACHINE';
delete from public.reporting_machines where id='b3440000-0000-4000-8000-000000000001';
delete from public.reporting_locations where id='b3430000-0000-4000-8000-000000000001';
delete from public.customer_accounts where id='b3420000-0000-4000-8000-000000000001';
delete from auth.users where id='b3410000-0000-4000-8000-000000000001';
delete from public.refund_nayax_provider_callers where caller_id='nayax-card-refund';
insert into public.refund_nayax_provider_callers
select * from refund_single_gate_race.provider_caller_backup;
set session_replication_role=origin;
drop schema refund_single_gate_race cascade;
