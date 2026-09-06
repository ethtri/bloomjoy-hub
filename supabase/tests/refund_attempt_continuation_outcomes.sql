begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(29);

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('00000000-0000-0000-0000-000000000000','ca000000-0000-4000-8000-000000000001',
  'authenticated','authenticated','continuation-manager@example.test','',now(),'{}','{}',now(),now());
insert into public.customer_accounts(id,name,account_type)
values('ca100000-0000-4000-8000-000000000001','Continuation fixture','internal');
insert into public.reporting_locations(id,account_id,name,timezone)
values('ca200000-0000-4000-8000-000000000001','ca100000-0000-4000-8000-000000000001',
  'Continuation fixture','America/Chicago');
insert into public.reporting_machines(id,account_id,location_id,machine_label,status,nayax_machine_id,
  nayax_account_key,nayax_refunds_enabled,nayax_refund_max_amount_cents)
values('ca300000-0000-4000-8000-000000000001','ca100000-0000-4000-8000-000000000001',
  'ca200000-0000-4000-8000-000000000001','Continuation fixture','active',
  'CONTINUATION-MACHINE','CONTINUATION-ACCOUNT',true,2500);
insert into public.reporting_machine_refund_managers(id,reporting_machine_id,manager_user_id,
  manager_email,grant_reason)
values('ca400000-0000-4000-8000-000000000001','ca300000-0000-4000-8000-000000000001',
  'ca000000-0000-4000-8000-000000000001','continuation-manager@example.test','Continuation fixture');
insert into public.refund_nayax_provider_callers(caller_id,assertion_digest,status)
values('nayax-card-refund',encode(extensions.digest('continuation-executor','sha256'),'hex'),'active')
on conflict(caller_id) do update set assertion_digest=excluded.assertion_digest,status='active';

insert into public.refund_cases(id,public_reference,reporting_machine_id,reporting_location_id,
  customer_email,issue_summary,incident_at,payment_method,payment_amount_cents,refund_amount_cents,
  card_last4,status,correlation_status,correlation_source,correlation_confidence,automation_state,
  matched_nayax_transaction_id,matched_nayax_amount_cents,matched_nayax_currency_code,
  matched_nayax_machine_auth_time,matched_nayax_site_id,nayax_recommendation_state,
  nayax_recommendation_policy_version,nayax_match_execution_eligible,nayax_refund_execution_status)
select ('ca500000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'RF-CONTINUE-'||n,
  'ca300000-0000-4000-8000-000000000001','ca200000-0000-4000-8000-000000000001',
  'fixture-'||n||'@example.test','Synthetic continuation fixture',now()-interval '3 days',
  'card',800,800,'4242','needs_review','matched','nayax',1,'approved',(823456780+n)::text,
  800,'USD','2026-08-26T18:17:09.810Z',6,'high_confidence','2026-07-21.v1',true,'not_requested'
from generate_series(1,6) n;
insert into public.refund_case_events(refund_case_id,actor_user_id,event_type,message,metadata)
select ('ca500000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  'ca000000-0000-4000-8000-000000000001','nayax_match_selected',
  'Synthetic exact selection','{"payload_redacted":true}'::jsonb from generate_series(1,6) n;
insert into public.refund_nayax_lookup_candidates(token,refund_case_id,lookup_generation,actor_user_id,
  reporting_machine_id,provider_transaction_id,site_id,machine_authorization_time,amount_cents,
  card_last4,currency_code,evidence_summary,expires_at)
select gen_random_uuid(),c.id,c.nayax_lookup_generation,'ca000000-0000-4000-8000-000000000001',
  c.reporting_machine_id,c.matched_nayax_transaction_id,c.matched_nayax_site_id,
  c.matched_nayax_machine_auth_time,c.matched_nayax_amount_cents,c.matched_nayax_card_last4,
  c.matched_nayax_currency_code,
  '{"machine_authorization_time_raw":"2026-08-26T13:17:08.123","machine_authorization_time_source":"MachineAuthorizationTime"}'::jsonb
    ||jsonb_build_object('lookup_account_scope','CONTINUATION_ACCOUNT',
      'lookup_provider_machine_id','CONTINUATION-MACHINE','provider_machine_id','CONTINUATION-MACHINE'),
  now()+interval '1 hour'
from public.refund_cases c where c.id::text like 'ca500000-%';

create temp table continuation_reservations(n integer primary key, expected_version bigint, result jsonb);
insert into continuation_reservations
select n,(context->>'caseVersion')::bigint,
  public.service_reserve_nayax_refund_manager_action_v3('continuation-executor',
    'ca000000-0000-4000-8000-000000000001',
    ('ca500000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
    (context->>'caseVersion')::bigint,'nayax-refund-'||repeat(n::text,64),800,null,null,'USD',
    'nayax-production-account-contract-v2','nayax-provider-journal-v3',context->>'contextHash')
from generate_series(1,6) n
cross join lateral (
  select public.service_get_refund_nayax_execution_context('continuation-executor',
    'ca000000-0000-4000-8000-000000000001',
    ('ca500000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid) as context
) execution;

create function pg_temp.record_request(p_n integer,outcome_name text,contract_match boolean,
  semantic_match boolean,business_result text,business_status text)
returns void language plpgsql as $$
declare r jsonb; aid uuid; claim text;
begin
  select result into r from continuation_reservations where continuation_reservations.n=p_n;
  aid:=(r#>>'{attempt,attemptId}')::uuid; claim:=r->>'providerClaimToken';
  perform public.service_record_nayax_refund_provider_stage_v3_outcomes('continuation-executor',aid,claim,
    'request','started',null,null,null,null,repeat(p_n::text,64),
    'nayax-production-account-contract-v2','nayax-provider-journal-v3',
    null,null,null,null,null,null,null,null,null,null,null,null,null,null,false);
  perform public.service_record_nayax_refund_provider_stage_v3_outcomes('continuation-executor',aid,claim,
    'request','result',200,outcome_name,contract_match,null,repeat(p_n::text,64),
    'nayax-production-account-contract-v2','nayax-provider-journal-v3',
    true,'application_json','json_object','1_256',true,true,true,true,true,'string','string',
    semantic_match,business_result,business_status,true);
  update public.refund_case_nayax_refund_attempts
  set provider_claim_expires_at=statement_timestamp()-interval '1 second' where id=aid;
end $$;

create function pg_temp.continue_attempt(p_n integer,version_offset integer default 0)
returns jsonb language sql as $$
  select public.service_reserve_nayax_refund_approval_continuation_v1('continuation-executor',
    'ca000000-0000-4000-8000-000000000001',
    ('ca500000-0000-4000-8000-'||lpad(p_n::text,12,'0'))::uuid,
    expected_version+version_offset,'nayax-refund-'||repeat(p_n::text,64),800,'USD',
    'nayax-production-account-contract-v2','nayax-provider-journal-v3')
  from continuation_reservations where continuation_reservations.n=p_n;
$$;

select ok(not has_table_privilege('service_role','public.refund_nayax_provider_business_outcomes','select')
  and not has_table_privilege('authenticated','public.refund_nayax_provider_business_outcomes','select')
  and not has_table_privilege('anon','public.refund_nayax_provider_business_outcomes','select'),
  'Business outcomes have no service, manager, or anonymous read grant');
select ok(not has_table_privilege('service_role','public.refund_nayax_attempt_approval_continuations','select')
  and not has_table_privilege('authenticated','public.refund_nayax_attempt_approval_continuations','select'),
  'Continuation claims have no service or browser read grant');
select ok((select relrowsecurity from pg_class where oid='public.refund_nayax_provider_business_outcomes'::regclass)
  and (select relrowsecurity from pg_class where oid='public.refund_nayax_attempt_approval_continuations'::regclass),
  'Both private tables have RLS enabled');
select ok(exists(select 1 from pg_constraint
  where conrelid='public.refund_nayax_attempt_approval_continuations'::regclass
    and conname='refund_nayax_approval_continuation_generation_unique' and contype='u'),
  'One case generation can reserve at most one approval continuation');
select ok(has_function_privilege('service_role',
  'public.service_record_nayax_refund_provider_stage_v3_outcomes(text,uuid,text,text,text,integer,text,boolean,text,text,text,text,boolean,text,text,text,boolean,boolean,boolean,boolean,boolean,text,text,boolean,text,text,boolean)','execute')
  and has_function_privilege('service_role',
  'public.service_reserve_nayax_refund_approval_continuation_v1(text,uuid,uuid,bigint,text,integer,text,text,text)','execute'),
  'Only assertion-protected service boundaries expose writes');
select ok(not has_function_privilege('service_role',
  'public.service_record_nayax_refund_provider_stage_v3(text,uuid,text,text,text,integer,text,boolean,text,text,text,text,boolean,text,text,text,boolean,boolean,boolean,boolean,boolean,text,text,boolean)','execute')
  and not has_function_privilege('authenticated',
  'public.service_reserve_nayax_refund_approval_continuation_v1(text,uuid,uuid,bigint,text,integer,text,text,text)','execute'),
  'The non-retaining writer and browser continuation are denied');
select ok(
  public.service_get_nayax_refund_provider_journal_capability_v3('continuation-executor')
    @> '{"businessOutcomeRecordVersion":"nayax-business-outcome-v1","approvalContinuationVersion":"same-attempt-approval-continuation-v1"}'::jsonb,
  'Capability pins the private outcome record and same-attempt continuation contracts');

select pg_temp.record_request(1,'accepted',true,true,'True','Pending Approval');
create temp table issued_continuation as select pg_temp.continue_attempt(1) result;
select is((select result#>>'{attempt,shouldExecute}' from issued_continuation),'true',
  'Crash after proved request acceptance receives one same-attempt approval continuation');
select is((select result#>>'{attempt,executionPlan}' from issued_continuation),'approval_continuation',
  'Continuation explicitly selects the approval-only current-contract plan');
select isnt((select result->>'providerClaimToken' from issued_continuation),
  (select result->>'providerClaimToken' from continuation_reservations where n=1),
  'Continuation rotates the expired claim instead of reviving it');
select is((select count(*) from public.refund_nayax_provider_stage_journal j
  join continuation_reservations r on (r.result#>>'{attempt,attemptId}')::uuid=j.nayax_refund_attempt_id
  where r.n=1 and j.stage='request'),2::bigint,'Continuation creates no second request journal event');
select is((select business_result||'|'||business_status from public.refund_nayax_provider_business_outcomes b
  join continuation_reservations r on (r.result#>>'{attempt,attemptId}')::uuid=b.nayax_refund_attempt_id
  where r.n=1 and b.stage='request'),'True|Pending Approval','Exact bounded request business pair is retained');
select is(pg_temp.continue_attempt(1)#>>'{attempt,shouldExecute}','false',
  'Duplicate click or concurrent worker cannot obtain a second continuation claim');
select is((select count(*) from public.refund_nayax_attempt_approval_continuations c
  join continuation_reservations r on (r.result#>>'{attempt,attemptId}')::uuid=c.nayax_refund_attempt_id where r.n=1),
  1::bigint,'One immutable attempt has at most one continuation reservation');

select pg_temp.record_request(3,'unknown',false,false,'True','Unexpected');
select is(pg_temp.continue_attempt(3)#>>'{attempt,shouldExecute}','false',
  'Unknown or ambiguous request pair remains inspect-only');
select is((select business_result||'|'||business_status from public.refund_nayax_provider_business_outcomes b
  join continuation_reservations r on (r.result#>>'{attempt,attemptId}')::uuid=b.nayax_refund_attempt_id
  where r.n=3 and b.stage='request'),'True|Unexpected','Safe unknown pair is retained without guessing its outcome');

update public.refund_case_nayax_refund_attempts set provider_claim_expires_at=now()-interval '1 second'
where id=(select (result#>>'{attempt,attemptId}')::uuid from continuation_reservations where n=2);
select is(pg_temp.continue_attempt(2)#>>'{attempt,shouldExecute}','false',
  'Request-not-proved cannot continue');
select throws_ok($$select pg_temp.continue_attempt(1,1)$$,'P4628',null,
  'Stale expected version cannot claim continuation');
select pg_temp.record_request(6,'accepted',true,true,'FixtureResult','FixtureStatus');
select throws_ok($$update public.refund_cases set refund_amount_cents=700
  where id='ca500000-0000-4000-8000-000000000006'$$,'P0001',null,
  'The active attempt guard prevents the full refund amount from changing before approval');

select public.service_record_nayax_refund_provider_stage_v3_outcomes('continuation-executor',
  (select (result#>>'{attempt,attemptId}')::uuid from issued_continuation),
  (select result->>'providerClaimToken' from issued_continuation),'approve','started',null,null,null,null,
  repeat('a',64),'nayax-production-account-contract-v2','nayax-provider-journal-v3',
  null,null,null,null,null,null,null,null,null,null,null,null,null,null,false);
select public.service_record_nayax_refund_provider_stage_v3_outcomes('continuation-executor',
  (select (result#>>'{attempt,attemptId}')::uuid from issued_continuation),
  (select result->>'providerClaimToken' from issued_continuation),'approve','result',200,'succeeded',true,null,
  repeat('b',64),'nayax-production-account-contract-v2','nayax-provider-journal-v3',
  true,'application_json','json_object','1_256',true,true,true,true,true,'string','string',true,
  'True','Approved',true);
select is((select business_result||'|'||business_status from public.refund_nayax_provider_business_outcomes b
  join continuation_reservations r on (r.result#>>'{attempt,attemptId}')::uuid=b.nayax_refund_attempt_id
  where r.n=1 and b.stage='approve'),'True|Approved','Exact bounded approval business pair is retained');
select is(pg_temp.continue_attempt(1)#>>'{attempt,shouldExecute}','false',
  'An approval journal result cannot be approved again');
select throws_ok($$select public.service_settle_nayax_refund_attempt('continuation-executor',
  (select (result#>>'{attempt,attemptId}')::uuid from issued_continuation),
  (select (result#>>'{managerAction,authorizationId}')::uuid from issued_continuation),
  'ca500000-0000-4000-8000-000000000001','nayax-refund-'||repeat('1',64),800,'USD',
  'wrong-continuation-claim','success','nayax-evidence-'||repeat('c',64),
  'approve_succeeded_contract_match',null)$$,'P0001',null,
  'Settlement with the wrong continuation claim fails after possible provider effect');
select is(pg_temp.continue_attempt(1)#>>'{attempt,shouldExecute}','false',
  'Unsettled possible approval effect remains recoverable without another payment');
select lives_ok($$select public.service_settle_nayax_refund_attempt('continuation-executor',
  (select (result#>>'{attempt,attemptId}')::uuid from issued_continuation),
  (select (result#>>'{managerAction,authorizationId}')::uuid from issued_continuation),
  'ca500000-0000-4000-8000-000000000001','nayax-refund-'||repeat('1',64),800,'USD',
  (select result->>'providerClaimToken' from issued_continuation),'success',
  'nayax-evidence-'||repeat('c',64),'approve_succeeded_contract_match',null)$$,
  'The same approval effect can settle with its exact claim and no provider retry');
select is((select status from public.refund_case_nayax_refund_attempts
  where id=(select (result#>>'{attempt,attemptId}')::uuid from issued_continuation)),'succeeded',
  'Settlement-after-effect recovery commits the existing attempt');

select pg_temp.record_request(5,'accepted',true,true,'True','Pending Approval');
update public.reporting_machine_refund_managers set status='revoked',revoked_at=now()
where id='ca400000-0000-4000-8000-000000000001';
select throws_ok($$select pg_temp.continue_attempt(5)$$,'P4628',null,
  'Revoked manager authority cannot continue approval');
select is((select count(*) from public.refund_nayax_attempt_approval_continuations c
  join continuation_reservations r on (r.result#>>'{attempt,attemptId}')::uuid=c.nayax_refund_attempt_id where r.n=5),
  0::bigint,'Revoked manager creates no continuation claim');

select throws_ok($$update public.refund_nayax_provider_business_outcomes set business_status='Changed'$$,
  'P0001',null,'Business outcomes are immutable');
select throws_ok($$insert into public.refund_nayax_provider_business_outcomes(
  provider_stage_journal_id,nayax_refund_attempt_id,stage,business_result,business_status,business_pair_retained)
  select j.id,j.nayax_refund_attempt_id,j.stage,'owner@example.test','customer-4242',true
  from public.refund_nayax_provider_stage_journal j
  where j.event='result' and j.schema_matched is true limit 1$$,'23514',null,
  'Email and even last-four-like identifiers cannot enter the diagnostic record');

select * from finish();
rollback;
