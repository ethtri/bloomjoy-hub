begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('00000000-0000-4000-8000-000000000000','b7000000-0000-4000-8000-000000000001','authenticated','authenticated',
  'verification-manager@example.invalid','',now(),'{}','{}',now(),now());
insert into auth.sessions(id,user_id,created_at,updated_at)
values('b7010000-0000-4000-8000-000000000001','b7000000-0000-4000-8000-000000000001',now(),now());
insert into public.admin_roles(user_id,role,active) values('b7000000-0000-4000-8000-000000000001','super_admin',true);
insert into public.customer_accounts(id,name,account_type) values('b7100000-0000-4000-8000-000000000001','Verification fixture','internal');
insert into public.reporting_locations(id,account_id,name,timezone)
values('b7200000-0000-4000-8000-000000000001','b7100000-0000-4000-8000-000000000001','Verification fixture','America/Chicago');
insert into public.reporting_machines(id,account_id,location_id,machine_label,nayax_machine_id,nayax_account_key,nayax_refunds_enabled)
values('b7300000-0000-4000-8000-000000000001','b7100000-0000-4000-8000-000000000001',
  'b7200000-0000-4000-8000-000000000001','Verification fixture','VERIFICATION-MACHINE','VERIFICATION-ACCOUNT',true);
insert into public.reporting_machine_refund_managers(reporting_machine_id,manager_user_id,manager_email,grant_reason)
values('b7300000-0000-4000-8000-000000000001','b7000000-0000-4000-8000-000000000001','verification-manager@example.invalid','Verification fixture');
insert into public.refund_nayax_provider_callers(caller_id,assertion_digest,status)
values('nayax-card-refund',encode(extensions.digest('verification-executor','sha256'),'hex'),'active')
on conflict(caller_id) do update set assertion_digest=excluded.assertion_digest,status='active';
insert into public.refund_cases(id,public_reference,reporting_machine_id,reporting_location_id,customer_email,issue_summary,
  incident_at,payment_method,payment_amount_cents,refund_amount_cents,card_last4,status,correlation_status,correlation_source,
  correlation_confidence,automation_state,matched_nayax_transaction_id,matched_nayax_amount_cents,matched_nayax_currency_code,
  matched_nayax_machine_auth_time,matched_nayax_site_id,nayax_recommendation_state,nayax_recommendation_policy_version,
  nayax_match_execution_eligible,nayax_refund_execution_status)
select ('b7400000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'RF-VERIFY-'||n,
  'b7300000-0000-4000-8000-000000000001','b7200000-0000-4000-8000-000000000001',
  'verification-customer@example.invalid','Synthetic verification fixture',now()-interval '3 days','card',800,800,'4242',
  'needs_review','matched','nayax',1,'approved',(723456780+n)::text,800,'USD','2026-08-26T18:17:09.810Z',6,
  'high_confidence','2026-07-21.v1',true,'not_requested' from generate_series(1,5) n;
insert into public.refund_case_events(refund_case_id,actor_user_id,event_type,message,metadata)
select ('b7400000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'b7000000-0000-4000-8000-000000000001',
  'nayax_match_selected','Synthetic exact selection','{"payload_redacted":true}' from generate_series(1,5) n;
select set_config('request.jwt.claims','{"sub":"b7000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"b7010000-0000-4000-8000-000000000001","is_anonymous":false}',true);
select set_config('request.jwt.claim.sub','b7000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claim.role','authenticated',true);

insert into public.refund_nayax_lookup_candidates(token,refund_case_id,lookup_generation,actor_user_id,reporting_machine_id,
  provider_transaction_id,site_id,machine_authorization_time,amount_cents,card_last4,currency_code,evidence_summary,expires_at)
select gen_random_uuid(),c.id,c.nayax_lookup_generation,'b7000000-0000-4000-8000-000000000001',c.reporting_machine_id,
  c.matched_nayax_transaction_id,c.matched_nayax_site_id,c.matched_nayax_machine_auth_time,c.matched_nayax_amount_cents,
  c.matched_nayax_card_last4,c.matched_nayax_currency_code,
  '{"machine_authorization_time_raw":"2026-08-26T13:17:08.123","machine_authorization_time_source":"MachineAuthorizationTime"}'::jsonb||jsonb_build_object('lookup_account_scope',regexp_replace(upper(btrim(m.nayax_account_key)),'[^A-Z0-9_]','_','g'),'lookup_provider_machine_id',m.nayax_machine_id,'provider_machine_id',m.nayax_machine_id),now()+interval '1 hour'
  from public.refund_cases c join public.reporting_machines m on m.id=c.reporting_machine_id where c.id::text like 'b7400000-%';

create function pg_temp.reserve_context(n integer,context_hash text default null,amount integer default 800) returns jsonb language plpgsql as $$
declare cid uuid:=('b7400000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid; v bigint;
begin
  select official_action_version into v from public.refund_cases where id=cid;
  return public.service_reserve_nayax_refund_manager_action_v3('verification-executor',
    'b7000000-0000-4000-8000-000000000001',cid,v,'nayax-refund-'||repeat(n::text,64),amount,null,null,'USD',
    'nayax-production-account-contract-v2','nayax-provider-journal-v3',coalesce(context_hash,
      public.service_get_refund_nayax_execution_context('verification-executor','b7000000-0000-4000-8000-000000000001',cid)->>'contextHash'));
end; $$;
select ok(not has_table_privilege('authenticated','public.refund_nayax_execution_contexts','select'),'Execution identity is private');
select ok(not has_table_privilege('service_role','public.refund_nayax_execution_contexts','insert'),'Service cannot forge execution snapshots');
select ok(not exists(select 1 from (values
  ('service_role','public.service_reserve_nayax_refund_manager_action(text,uuid,uuid,bigint,text,integer,integer,integer,text)'),
  ('service_role','public.service_reserve_nayax_refund_manager_action_v2(text,uuid,uuid,bigint,text,integer,integer,integer,text,text,text)'),
  ('service_role','public.service_reserve_and_consume_nayax_refund_attempt_v2(text,uuid,uuid,text,integer,integer,integer,text)'),
  ('service_role','public.service_reserve_and_consume_nayax_controlled_pilot_attempt(text,uuid,text,text,uuid,uuid,text,integer,text,uuid)'),
  ('authenticated','public.admin_consume_refund_nayax_controlled_pilot_intent(uuid,uuid,uuid,bigint,integer,text,text,text,text,text,uuid)')
) retired(role_name,signature) where has_function_privilege(role_name,signature,'execute')),
  'Every retired fresh-attempt entrypoint denies its former caller');
select throws_ok($$select pg_temp.reserve_context(1,repeat('f',64))$$,'P4620',null,'Forged context cannot reserve money');
select throws_ok($$select pg_temp.reserve_context(1,null,801)$$,'P4620',null,'Requested amount cannot exceed the selected original');
select is(public.refund_case_nayax_manager_readiness('b7000000-0000-4000-8000-000000000001',
  'b7400000-0000-4000-8000-000000000001')->>'canIssueCardRefund','true','Selected purchase requires no remaining-balance attestation');
create temp table current_execution_input as select public.service_get_refund_nayax_execution_context(
  'verification-executor','b7000000-0000-4000-8000-000000000001','b7400000-0000-4000-8000-000000000001') context;
grant select on current_execution_input to service_role;
create temp table verified_result(result jsonb);
grant select,insert on verified_result to service_role;
set local role service_role;
insert into verified_result select public.service_reserve_nayax_refund_manager_action_v3(
  'verification-executor','b7000000-0000-4000-8000-000000000001','b7400000-0000-4000-8000-000000000001',
  (context->>'caseVersion')::bigint,'nayax-refund-'||repeat('1',64),800,null,null,'USD',
  'nayax-production-account-contract-v2','nayax-provider-journal-v3',context->>'contextHash') from current_execution_input;
reset role;
select is((select result#>>'{attempt,shouldExecute}' from verified_result),'true','Normal manager action reserves the first request');
select is(pg_temp.reserve_context(1)#>>'{attempt,shouldExecute}','false','Exact replay never reserves another request');
select throws_ok($$select public.service_record_nayax_refund_provider_stage_v2('verification-executor',
  (select (result#>>'{attempt,attemptId}')::uuid from verified_result),(select result->>'providerClaimToken' from verified_result),
  'request','started',null,null,null,null,repeat('a',64),'nayax-production-observed-2026-08-22','nayax-provider-journal-v2')$$,
  'P4620',null,'A bound attempt cannot downgrade its provider journal');
select is((select context->>'machineAuthorizationTime' from public.refund_nayax_execution_contexts
  where refund_case_id='b7400000-0000-4000-8000-000000000001'),'2026-08-26T13:17:08.123','Raw machine clock remains exact');
select throws_ok($$update public.refund_nayax_execution_contexts set context='{}'
  where refund_case_id='b7400000-0000-4000-8000-000000000001'$$,'P4660',null,'Execution context cannot be rewritten');
delete from public.refund_nayax_lookup_candidates where refund_case_id='b7400000-0000-4000-8000-000000000001';
select lives_ok($$select public.service_record_nayax_refund_provider_stage_v3('verification-executor',
  (select (result#>>'{attempt,attemptId}')::uuid from verified_result),(select result->>'providerClaimToken' from verified_result),
  'request','started',null,null,null,null,repeat('a',64),'nayax-production-account-contract-v2','nayax-provider-journal-v3',
  null,null,null,null,null,null,null,null,null,null,null,null)$$,'Candidate cleanup does not erase the authorized request identity');
select throws_ok($$select public.service_record_nayax_refund_provider_stage_v3('verification-executor',
  (select (result#>>'{attempt,attemptId}')::uuid from verified_result),(select result->>'providerClaimToken' from verified_result),
  'request','started',null,null,null,null,repeat('a',64),'nayax-production-account-contract-v2','nayax-provider-journal-v3',
  null,null,null,null,null,null,null,null,null,null,null,null)$$,'23505',null,'Started marker is unique; no second dispatch');
create temp table stale_context as select public.refund_nayax_selected_execution_context('b7400000-0000-4000-8000-000000000002') x;
update public.refund_cases set card_last4='1234' where id='b7400000-0000-4000-8000-000000000002';
select throws_ok($$select pg_temp.reserve_context(2,(select x->>'contextHash' from stale_context))$$,'P4620',null,'Edited case invalidates prior execution context');
create temp table changed_candidate_fixtures as select * from public.refund_nayax_lookup_candidates
  where refund_case_id in ('b7400000-0000-4000-8000-000000000003','b7400000-0000-4000-8000-000000000004');
delete from public.refund_nayax_lookup_candidates
  where refund_case_id in ('b7400000-0000-4000-8000-000000000003','b7400000-0000-4000-8000-000000000004');
update changed_candidate_fixtures set token=gen_random_uuid();
update changed_candidate_fixtures set site_id=4 where refund_case_id='b7400000-0000-4000-8000-000000000003';
update changed_candidate_fixtures set evidence_summary=evidence_summary||'{"machine_authorization_time_source":"AuthorizationTimeGMT"}'
  where refund_case_id='b7400000-0000-4000-8000-000000000004';
insert into public.refund_nayax_lookup_candidates select * from changed_candidate_fixtures;
select is(public.refund_nayax_selected_execution_context('b7400000-0000-4000-8000-000000000003'),null::jsonb,'Wrong site cannot supply the raw timestamp');
select is(public.refund_nayax_selected_execution_context('b7400000-0000-4000-8000-000000000004'),null::jsonb,'GMT source cannot substitute for the machine clock');
-- One actual normal reservation/start/unknown result may be independently
-- confirmed through the existing receipt writer. No second payment or date.
select is(public.refund_receipt_verified_api_attempt('b7400000-0000-4000-8000-000000000001',
  (select (result#>>'{attempt,attemptId}')::uuid from verified_result)),false,'An active provider claim cannot receive a terminal receipt');
select public.service_record_nayax_refund_provider_stage_v3('verification-executor',
  (select (result#>>'{attempt,attemptId}')::uuid from verified_result),(select result->>'providerClaimToken' from verified_result),
  'request','result',200,'unknown',false,null,repeat('b',64),'nayax-production-account-contract-v2','nayax-provider-journal-v3',
  true,'application_json','json_object','1_256',true,true,true,true,true,'string','string',false);
select public.service_settle_nayax_refund_attempt('verification-executor',
  (select (result#>>'{attempt,attemptId}')::uuid from verified_result),
  (select (result#>>'{managerAction,authorizationId}')::uuid from verified_result),
  'b7400000-0000-4000-8000-000000000001','nayax-refund-'||repeat('1',64),800,'USD',
  (select result->>'providerClaimToken' from verified_result),'unknown',null,null,'provider_request_semantic_mismatch');
select ok(public.refund_receipt_verified_api_attempt('b7400000-0000-4000-8000-000000000001',
  (select (result#>>'{attempt,attemptId}')::uuid from verified_result)),'Settled uncertain API attempt has exact immutable purchase authority');
select is(public.refund_nayax_original_portal_fallback_ready('b7400000-0000-4000-8000-000000000001'),false,
  'Unknown API outcome cannot authorize a portal payment');
select is(public.admin_get_refund_authoritative_receipt_overview('b7400000-0000-4000-8000-000000000001')->>'attemptBindingKind',
  'verified_authorized_api','Existing receipt view accepts verified API outcome review');
select is(public.admin_get_refund_authoritative_receipt_overview('b7400000-0000-4000-8000-000000000001')->>'canRecord',
  'true','Existing receipt action is available after the API outcome is held');
create function pg_temp.record_api_receipt(status_id integer default 62,scope text default 'VERIFICATION-ACCOUNT',amount integer default 800)
returns jsonb language plpgsql as $$
declare c public.refund_cases%rowtype; begin
  select * into c from public.refund_cases where id='b7400000-0000-4000-8000-000000000001';
  return public.admin_record_refund_authoritative_receipt(c.id,(select (result#>>'{attempt,attemptId}')::uuid from verified_result),
    c.official_action_version,scope,'VERIFICATION-MACHINE',c.matched_nayax_transaction_id,800,amount,'USD',status_id,
    'DTM:NAYAX-'||c.matched_nayax_transaction_id,true);
end $$;
select throws_ok($$select pg_temp.record_api_receipt(63)$$,'P4661',null,'Pending provider status cannot confirm payment');
select throws_ok($$select pg_temp.record_api_receipt(62,'OTHER-ACCOUNT')$$,'P4661',null,'Another account cannot confirm this API attempt');
select throws_ok($$select pg_temp.record_api_receipt(62,'VERIFICATION-ACCOUNT',700)$$,'P4661',null,'Partial evidence cannot confirm the full refund');
select is(pg_temp.record_api_receipt()->>'status','recorded','Independent full refund saves through the existing receipt writer');
select is(pg_temp.record_api_receipt()->>'status','already_recorded','Repeated independent confirmation reuses the same receipt');
select ok((select count(*)=1 and bool_and(settled_at is null and settlement_time_precision='unknown')
  from public.refund_authoritative_receipts where refund_case_id='b7400000-0000-4000-8000-000000000001'),
  'One full-refund receipt preserves unknown settlement time');
select is((select count(*) from public.refund_case_nayax_refund_attempts where refund_case_id='b7400000-0000-4000-8000-000000000001'),
  1::bigint,'Confirmation creates no new payment attempt');
select is((select count(*) from public.sales_adjustment_facts where refund_case_id='b7400000-0000-4000-8000-000000000001'),
  0::bigint,'Unknown settlement date creates no falsely dated adjustment');
select is((select count(*) from public.refund_case_messages where refund_case_id='b7400000-0000-4000-8000-000000000001'),
  0::bigint,'Evidence import does not create a second customer message');
select throws_ok($$insert into public.refund_case_nayax_refund_attempts(refund_case_id,execution_mode,status,idempotency_key,amount_cents)
  values('b7400000-0000-4000-8000-000000000001','manual_portal','manual_review','forbidden-confirmed-retry',800)$$,
  'P4663',null,'Confirmed API refund cannot receive an invented portal retry');

-- A mapping correction before the getter must not relabel old provider evidence.
update public.reporting_machines set nayax_machine_id='DIFFERENT-MACHINE' where id='b7300000-0000-4000-8000-000000000001';
select is(public.refund_nayax_selected_execution_context('b7400000-0000-4000-8000-000000000005'),null::jsonb,
  'Changed provider mapping cannot stamp a new identity onto an old lookup');
update public.reporting_machines set nayax_machine_id='VERIFICATION-MACHINE' where id='b7300000-0000-4000-8000-000000000001';
create temp table rejected_result as select pg_temp.reserve_context(5) result;
select public.service_record_nayax_refund_provider_stage_v3('verification-executor',
  (select (result#>>'{attempt,attemptId}')::uuid from rejected_result),(select result->>'providerClaimToken' from rejected_result),
  'request','started',null,null,null,null,repeat('d',64),'nayax-production-account-contract-v2','nayax-provider-journal-v3',
  null,null,null,null,null,null,null,null,null,null,null,null);
select public.service_record_nayax_refund_provider_stage_v3('verification-executor',
  (select (result#>>'{attempt,attemptId}')::uuid from rejected_result),(select result->>'providerClaimToken' from rejected_result),
  'request','result',200,'rejected',true,null,repeat('e',64),'nayax-production-account-contract-v2','nayax-provider-journal-v3',
  true,'application_json','json_object','1_256',true,true,true,true,true,'string','string',true);
select public.service_settle_nayax_refund_attempt('verification-executor',
  (select (result#>>'{attempt,attemptId}')::uuid from rejected_result),
  (select (result#>>'{managerAction,authorizationId}')::uuid from rejected_result),
  'b7400000-0000-4000-8000-000000000005','nayax-refund-'||repeat('5',64),800,'USD',
  (select result->>'providerClaimToken' from rejected_result),'rejected',null,null,'provider_request_rejected');
select is((select nayax_refund_attempt_generation from public.refund_cases where id='b7400000-0000-4000-8000-000000000005'),1,
  'Definitive rejection releases a fresh review generation');
select ok(public.refund_nayax_original_portal_fallback_ready('b7400000-0000-4000-8000-000000000005'),
  'Exact released rejection permits the supported portal fallback');
select is(public.admin_begin_refund_manual_nayax_portal('b7400000-0000-4000-8000-000000000005',
  (select official_action_version from public.refund_cases where id='b7400000-0000-4000-8000-000000000005'))->>'created','true',
  'Rejected API purchase can enter one manager-approved portal hold');
select is(public.refund_nayax_original_portal_fallback_ready('b7400000-0000-4000-8000-000000000005'),false,
  'A newer held portal attempt prevents reuse of earlier rejection authority');
select * from finish();
rollback;
