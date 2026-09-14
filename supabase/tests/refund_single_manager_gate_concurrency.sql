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
  'needs_review','matched','nayax',1,'Exact saved System candidate',1,'form','{}',1,
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
    'card_last4_comparison','exact_support','card_network_comparison','missing',
    'payment_interaction_comparison','unknown','same_identifier_equivalence_proven',false,
    'identifier_review_state','exact_support','customer_correction_fields','[]'::jsonb,
    'hard_exclusions','[]'::jsonb,'manual_review_reasons','[]'::jsonb,
    'reason_codes','["machine_exact","provider_sale_approved"]'::jsonb,'match_factors','[]'::jsonb
  ) || jsonb_build_object(
    'match_reason','Exact saved System candidate','recommendation_rank',1,'is_top_ranked',true,
    'lookup_account_scope','SINGLE_GATE_RACE_ACCOUNT','lookup_provider_machine_id','SINGLE-GATE-RACE-MACHINE',
    'provider_machine_id','SINGLE-GATE-RACE-MACHINE','machine_authorization_time_raw','2026-09-12T20:00:00Z',
    'machine_authorization_at','2026-09-12T20:00:00Z','machine_authorization_time_source','MachineAuthorizationTime',
    'machine_time_resolution','exact','provider_time_resolution','exact','provider_time_source','authorization_gmt',
    'authorized_at','2026-09-12T20:00:00Z',
    'customer_request_received_at',null,'customer_request_received_source',null,
    'transaction_occurrence_proof_source',null,'transaction_occurrence_timestamp_source',null,
    'transaction_occurrence_timezone_basis',null,'transaction_occurrence_lower_bound_at',null,
    'transaction_occurrence_upper_bound_at',null,'request_receipt_lower_bound_at',null,
    'request_receipt_upper_bound_at',null,'request_time_boundary','request_time_unknown',
    'transaction_occurrence_comparable',false,'transaction_occurrence_semantics','unknown','time_delta_minutes',null,
    'amount_delta_cents',90,'provider_processing_time_delta_minutes',0,'payment_status','approved',
    'payment_status_evidence','last_sales_contract','provider_refund_state','clear',
  'duplicate_provider_record',false,'card_last4','4242','currency_code','USD','amount_cents',1090),
  now()+interval '1 hour');
insert into public.refund_gmail_threads(id,refund_case_id,mailbox_hash,provider_thread_id,
  thread_subject,first_message_at,latest_message_at,retention_expires_at)
values('b3490000-0000-4000-8000-000000000001','b3470000-0000-4000-8000-000000000001',
  repeat('1',64),'single-gate-race-thread-1','Single gate race refund',
  '2026-09-12T20:00:00Z','2026-09-12T20:00:00Z','2027-09-12T20:00:00Z');
select set_config('request.jwt.claim.sub','b3410000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claims','{"sub":"b3410000-0000-4000-8000-000000000001","role":"authenticated","is_anonymous":false}',true);
select public.admin_select_refund_nayax_candidate_current_user_v1(
  'b3470000-0000-4000-8000-000000000001',
  (select official_action_version from public.refund_cases where id='b3470000-0000-4000-8000-000000000001'),
  'b3480000-0000-4000-8000-000000000001',null);
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

create function refund_single_gate_race.record_no_refund() returns jsonb language plpgsql as $$
declare output jsonb;
begin
  perform set_config('request.jwt.claim.sub','b3410000-0000-4000-8000-000000000001',true);
  perform set_config('request.jwt.claim.role','authenticated',true);
  perform set_config('request.jwt.claims','{"sub":"b3410000-0000-4000-8000-000000000001","role":"authenticated","is_anonymous":false}',true);
  begin
    output:=public.admin_record_nayax_system_outcome_evidence_v1(
      'b3470000-0000-4000-8000-000000000001',
      (select id from public.refund_case_nayax_refund_attempts where refund_case_id='b3470000-0000-4000-8000-000000000001'),
      'provider_confirmed_no_refund','nayax_support_ticket','SUPPORT:NAYAX-12345678',
      statement_timestamp(),'nayax_support_confirmed_no_refund',
      (select official_action_version from public.refund_cases where id='b3470000-0000-4000-8000-000000000001'));
    return jsonb_build_object('ok',true,'output',output);
  exception when others then
    return jsonb_build_object('ok',false,'sqlstate',sqlstate,'message',sqlerrm);
  end;
end $$;

-- Clone the already-held case under disabled triggers so this test can isolate
-- the cross-case success-reference boundary without authorizing two more real
-- manager actions. All runtime calls below still traverse the production RPC,
-- guards, indexes, settlement path, and RLS/auth checks.
create function refund_single_gate_race.insert_json_row(
  p_table regclass,p_values jsonb
) returns void language plpgsql as $$
declare columns text;
begin
  select string_agg(format('%I',attribute.attname),',' order by attribute.attnum)
    into strict columns
  from pg_catalog.pg_attribute attribute
  where attribute.attrelid=p_table and attribute.attnum>0
    and not attribute.attisdropped and attribute.attgenerated='';
  execute format('insert into %s(%s) select %s from pg_catalog.jsonb_populate_record(null::%s,$1)',
    p_table,columns,columns,p_table) using p_values;
end $$;

create function refund_single_gate_race.clone_held_case(
  p_case_id uuid,p_attempt_id uuid,p_authorization_id uuid,p_allocation_id uuid,
  p_thread_id uuid,p_public_reference text,p_transaction_id text,p_customer_email text,
  p_incident_offset interval
) returns void language plpgsql as $$
declare source_case public.refund_cases%rowtype;
  source_attempt public.refund_case_nayax_refund_attempts%rowtype;
  source_authorization public.refund_case_official_action_authorizations%rowtype;
  source_context public.refund_nayax_execution_contexts%rowtype;
  source_allocation public.refund_nayax_transaction_allocations%rowtype;
  cloned_context jsonb; context_hash text;
begin
  select * into strict source_case from public.refund_cases
    where id='b3470000-0000-4000-8000-000000000001';
  select * into strict source_attempt from public.refund_case_nayax_refund_attempts
    where refund_case_id=source_case.id;
  select * into strict source_authorization from public.refund_case_official_action_authorizations
    where id=source_attempt.official_action_authorization_id;
  select * into strict source_context from public.refund_nayax_execution_contexts
    where attempt_id=source_attempt.id;
  select * into strict source_allocation from public.refund_nayax_transaction_allocations
    where refund_case_id=source_case.id;

  cloned_context:=(source_context.context-'contextHash')||jsonb_build_object(
    'caseId',p_case_id::text,'transactionId',p_transaction_id,
    'machineAuthorizationTime',
      to_char(source_case.matched_nayax_machine_auth_time+p_incident_offset,
        'YYYY-MM-DD"T"HH24:MI:SS"Z"'));
  context_hash:=encode(extensions.digest(convert_to(cloned_context::text,'UTF8'),'sha256'),'hex');

  perform refund_single_gate_race.insert_json_row('public.refund_cases',
    to_jsonb(source_case)||jsonb_build_object(
      'id',p_case_id,'public_reference',p_public_reference,
      'customer_email',p_customer_email,
      'incident_at',source_case.incident_at+p_incident_offset,
      'matched_nayax_transaction_id',p_transaction_id,
      'matched_nayax_machine_auth_time',source_case.matched_nayax_machine_auth_time+p_incident_offset,
      'server_dedupe_key',null,'refund_qr_claim_context_id',null,
      'external_refund_recovery_id',null,'submission_identity_hash',null,
      'refund_business_fingerprint',null));
  perform refund_single_gate_race.insert_json_row(
    'public.refund_case_official_action_authorizations',
    to_jsonb(source_authorization)||jsonb_build_object(
      'id',p_authorization_id,'refund_case_id',p_case_id));
  perform refund_single_gate_race.insert_json_row('public.refund_case_nayax_refund_attempts',
    to_jsonb(source_attempt)||jsonb_build_object(
      'id',p_attempt_id,'refund_case_id',p_case_id,
      'official_action_authorization_id',p_authorization_id,
      'idempotency_key','nayax-refund-race-'||p_attempt_id::text,
      'request_fingerprint',encode(extensions.digest(convert_to(
        'nayax-refund-race-'||p_attempt_id::text||'|'||context_hash,
        'UTF8'),'sha256'),'hex')));
  perform refund_single_gate_race.insert_json_row('public.refund_nayax_execution_contexts',
    to_jsonb(source_context)||jsonb_build_object(
      'attempt_id',p_attempt_id,'refund_case_id',p_case_id,
      'context',cloned_context||jsonb_build_object('contextHash',context_hash)));
  perform refund_single_gate_race.insert_json_row('public.refund_nayax_transaction_allocations',
    to_jsonb(source_allocation)||jsonb_build_object(
      'id',p_allocation_id,'refund_case_id',p_case_id,'first_attempt_id',p_attempt_id,
      'original_transaction_id',p_transaction_id));
  insert into public.refund_gmail_threads(id,refund_case_id,mailbox_hash,provider_thread_id,
    thread_subject,first_message_at,latest_message_at,retention_expires_at)
  values(p_thread_id,p_case_id,encode(extensions.digest(convert_to(
      'mailbox|'||p_case_id::text,'UTF8'),'sha256'),'hex'),
    'single-gate-race-thread-'||p_case_id::text,'Single gate race refund',
    source_case.incident_at+p_incident_offset,source_case.incident_at+p_incident_offset,
    statement_timestamp()+interval '1 year');
end $$;

create function refund_single_gate_race.record_success(
  p_case_id uuid,p_attempt_id uuid
) returns jsonb language plpgsql as $$
declare output jsonb;
begin
  perform set_config('request.jwt.claim.sub','b3410000-0000-4000-8000-000000000001',true);
  perform set_config('request.jwt.claim.role','authenticated',true);
  perform set_config('request.jwt.claims','{"sub":"b3410000-0000-4000-8000-000000000001","role":"authenticated","is_anonymous":false}',true);
  begin
    output:=public.admin_record_nayax_system_outcome_evidence_v1(
      p_case_id,p_attempt_id,'provider_confirmed_success','nayax_dtm_transaction',
      'DTM:NAYAX-876543210',statement_timestamp(),'nayax_dtm_settled',
      (select official_action_version from public.refund_cases where id=p_case_id));
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

select plan(10);
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
select public.service_hold_nayax_refund_attempt_v1('single-gate-race-executor',
  (select (payload#>>'{claims,0,attemptId}')::uuid from race_claim),'provider_result_unknown');
set session_replication_role=replica;
select refund_single_gate_race.clone_held_case(
  'b3470000-0000-4000-8000-000000000002','b34a0000-0000-4000-8000-000000000002',
  'b34b0000-0000-4000-8000-000000000002','b34c0000-0000-4000-8000-000000000002',
  'b3490000-0000-4000-8000-000000000002','RF-SINGLE-GATE-RACE-2',
  'RF423906B2-RACE-2','race-customer-2@example.invalid','-2 days');
select refund_single_gate_race.clone_held_case(
  'b3470000-0000-4000-8000-000000000003','b34a0000-0000-4000-8000-000000000003',
  'b34b0000-0000-4000-8000-000000000003','b34c0000-0000-4000-8000-000000000003',
  'b3490000-0000-4000-8000-000000000003','RF-SINGLE-GATE-RACE-3',
  'RF423906B2-RACE-3','race-customer-3@example.invalid','-1 day');
set session_replication_role=origin;
truncate refund_single_gate_race.results;
select extensions.dblink_connect('single_gate_race_a','host=db port='||current_setting('port')
  ||' dbname='||current_database()||' user=postgres password=postgres sslmode=disable');
select extensions.dblink_connect('single_gate_race_b','host=db port='||current_setting('port')
  ||' dbname='||current_database()||' user=postgres password=postgres sslmode=disable');
select extensions.dblink_send_query('single_gate_race_a','select refund_single_gate_race.record_no_refund()');
select extensions.dblink_send_query('single_gate_race_b','select refund_single_gate_race.record_no_refund()');
insert into refund_single_gate_race.results select 'proof-a',payload
  from extensions.dblink_get_result('single_gate_race_a') result(payload jsonb);
insert into refund_single_gate_race.results select 'proof-b',payload
  from extensions.dblink_get_result('single_gate_race_b') result(payload jsonb);
select extensions.dblink_disconnect('single_gate_race_a');
select extensions.dblink_disconnect('single_gate_race_b');
select ok((select count(*)=1 from refund_single_gate_race.results where (payload->>'ok')::boolean)
    and (select count(*)=1 from refund_single_gate_race.results where not (payload->>'ok')::boolean)
    and not exists(select 1 from refund_single_gate_race.results where payload->>'sqlstate'='40P01'),
  'two simultaneous exact proofs finish without deadlock and exactly one advances the held generation');
select ok((select count(*)=1 from public.refund_nayax_no_refund_proofs
    where refund_case_id='b3470000-0000-4000-8000-000000000001')
  and (select provider_execution_generation=2 and status='created'
    from public.refund_case_nayax_refund_attempts where refund_case_id='b3470000-0000-4000-8000-000000000001'),
  'the proof race advances the same attempt exactly once');
create temp table proof_claim as select public.service_claim_due_nayax_refund_attempts_v1(
  'single-gate-race-executor','SINGLE_GATE_RACE_ACCOUNT','exact_source','empty_string',1) payload;
select is(jsonb_array_length((select payload->'claims' from proof_claim)),1,
  'one queue consumer claims the proof-authorized generation');
select is(jsonb_array_length(public.service_claim_due_nayax_refund_attempts_v1(
  'single-gate-race-executor','SINGLE_GATE_RACE_ACCOUNT','exact_source','empty_string',1)->'claims'),0,
  'a second queue consumer cannot claim the same generation');

truncate refund_single_gate_race.results;
select extensions.dblink_connect('single_gate_race_a','host=db port='||current_setting('port')
  ||' dbname='||current_database()||' user=postgres password=postgres sslmode=disable');
select extensions.dblink_connect('single_gate_race_b','host=db port='||current_setting('port')
  ||' dbname='||current_database()||' user=postgres password=postgres sslmode=disable');
select extensions.dblink_send_query('single_gate_race_a',$sql$select refund_single_gate_race.record_success(
  'b3470000-0000-4000-8000-000000000002','b34a0000-0000-4000-8000-000000000002')$sql$);
select extensions.dblink_send_query('single_gate_race_b',$sql$select refund_single_gate_race.record_success(
  'b3470000-0000-4000-8000-000000000003','b34a0000-0000-4000-8000-000000000003')$sql$);
insert into refund_single_gate_race.results select 'success-a',payload
  from extensions.dblink_get_result('single_gate_race_a') result(payload jsonb);
insert into refund_single_gate_race.results select 'success-b',payload
  from extensions.dblink_get_result('single_gate_race_b') result(payload jsonb);
select extensions.dblink_disconnect('single_gate_race_a');
select extensions.dblink_disconnect('single_gate_race_b');
select ok((select count(*)=1 from refund_single_gate_race.results where (payload->>'ok')::boolean)
    and (select count(*)=1 from refund_single_gate_race.results
      where not (payload->>'ok')::boolean and payload->>'sqlstate'='P4661'
        and payload->>'message'='This provider evidence reference already completed another refund case')
    and not exists(select 1 from refund_single_gate_race.results where payload->>'sqlstate'='40P01'),
  'success evidence reference race returns one friendly loser without deadlock');
select is((select count(*) from public.refund_nayax_system_success_evidence
    where refund_case_id in ('b3470000-0000-4000-8000-000000000002',
      'b3470000-0000-4000-8000-000000000003')),
  1::bigint,'exactly one case owns the shared successful provider reference');
select * from finish();

-- The committed fixture exists only to permit real independent sessions.
set session_replication_role=replica;
delete from public.refund_case_messages where refund_case_id in
  ('b3470000-0000-4000-8000-000000000001','b3470000-0000-4000-8000-000000000002','b3470000-0000-4000-8000-000000000003');
delete from public.sales_adjustment_facts where refund_case_id in
  ('b3470000-0000-4000-8000-000000000001','b3470000-0000-4000-8000-000000000002','b3470000-0000-4000-8000-000000000003');
delete from public.refund_case_events where refund_case_id in
  ('b3470000-0000-4000-8000-000000000001','b3470000-0000-4000-8000-000000000002','b3470000-0000-4000-8000-000000000003');
delete from public.refund_nayax_system_success_evidence where refund_case_id in
  ('b3470000-0000-4000-8000-000000000001','b3470000-0000-4000-8000-000000000002','b3470000-0000-4000-8000-000000000003');
delete from public.refund_nayax_transaction_allocations where refund_case_id in
  ('b3470000-0000-4000-8000-000000000001','b3470000-0000-4000-8000-000000000002','b3470000-0000-4000-8000-000000000003');
delete from public.refund_nayax_execution_contexts where refund_case_id in
  ('b3470000-0000-4000-8000-000000000001','b3470000-0000-4000-8000-000000000002','b3470000-0000-4000-8000-000000000003');
delete from public.refund_nayax_no_refund_proofs where refund_case_id in
  ('b3470000-0000-4000-8000-000000000001','b3470000-0000-4000-8000-000000000002','b3470000-0000-4000-8000-000000000003');
delete from public.refund_case_nayax_refund_attempts where refund_case_id in
  ('b3470000-0000-4000-8000-000000000001','b3470000-0000-4000-8000-000000000002','b3470000-0000-4000-8000-000000000003');
delete from public.refund_case_official_action_authorizations where refund_case_id in
  ('b3470000-0000-4000-8000-000000000001','b3470000-0000-4000-8000-000000000002','b3470000-0000-4000-8000-000000000003');
delete from public.refund_nayax_lookup_candidates where refund_case_id in
  ('b3470000-0000-4000-8000-000000000001','b3470000-0000-4000-8000-000000000002','b3470000-0000-4000-8000-000000000003');
delete from public.refund_gmail_threads where refund_case_id in
  ('b3470000-0000-4000-8000-000000000001','b3470000-0000-4000-8000-000000000002','b3470000-0000-4000-8000-000000000003');
delete from public.refund_cases where id in
  ('b3470000-0000-4000-8000-000000000001','b3470000-0000-4000-8000-000000000002','b3470000-0000-4000-8000-000000000003');
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
