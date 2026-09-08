begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(102);

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('00000000-0000-0000-0000-000000000000','ca000000-0000-4000-8000-000000000001',
  'authenticated','authenticated','continuation-manager@example.test','',now(),'{}','{}',now(),now());
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('00000000-0000-0000-0000-000000000000','ca000000-0000-4000-8000-000000000002',
  'authenticated','authenticated','handoff-manager@example.test','',now(),'{}','{}',now(),now());
insert into auth.sessions(id,user_id,created_at,updated_at)
values('ca010000-0000-4000-8000-000000000001','ca000000-0000-4000-8000-000000000001',now(),now());
insert into public.admin_roles(user_id,role,active)
values('ca000000-0000-4000-8000-000000000001','super_admin',true);
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
  nayax_recommendation_policy_version,nayax_match_execution_eligible,nayax_refund_execution_status,
  intake_source)
select ('ca500000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'RF-CONTINUE-'||n,
  'ca300000-0000-4000-8000-000000000001','ca200000-0000-4000-8000-000000000001',
  'fixture-'||n||'@example.test','Synthetic continuation fixture',
  now()-(n||' days')::interval,
  'card',800,800,'4242','needs_review','matched','nayax',1,'approved',(823456780+n)::text,
  800,'USD','2026-08-26T18:17:09.810Z',6,'high_confidence','2026-07-21.v1',true,'not_requested',
  'form'
from generate_series(1,7) n;
insert into public.refund_case_events(refund_case_id,actor_user_id,event_type,message,metadata)
select ('ca500000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  'ca000000-0000-4000-8000-000000000001','nayax_match_selected',
  'Synthetic exact selection','{"payload_redacted":true}'::jsonb from generate_series(1,7) n;
insert into public.refund_nayax_lookup_candidates(token,refund_case_id,lookup_generation,actor_user_id,
  reporting_machine_id,provider_transaction_id,site_id,machine_authorization_time,amount_cents,
  card_last4,currency_code,evidence_summary,expires_at)
select gen_random_uuid(),c.id,c.nayax_lookup_generation,'ca000000-0000-4000-8000-000000000001',
  c.reporting_machine_id,c.matched_nayax_transaction_id,c.matched_nayax_site_id,
  c.matched_nayax_machine_auth_time,c.matched_nayax_amount_cents,c.matched_nayax_card_last4,
  c.matched_nayax_currency_code,
  jsonb_build_object('machine_authorization_time_raw',
    case when c.id='ca500000-0000-4000-8000-000000000001'::uuid
      then '2026-08-26T13:17:09.810' else '2026-08-26T13:17:08.123' end,
    'machine_authorization_time_source','MachineAuthorizationTime',
    'machine_time_resolution',case when c.id='ca500000-0000-4000-8000-000000000001'::uuid
      then 'exact' else 'unknown' end)
    ||jsonb_build_object('lookup_account_scope','CONTINUATION_ACCOUNT',
      'lookup_provider_machine_id','CONTINUATION-MACHINE','provider_machine_id','CONTINUATION-MACHINE'),
  now()+interval '1 hour'
from public.refund_cases c where c.id::text like 'ca500000-%';

create temp table continuation_reservations(n integer primary key, expected_version bigint, result jsonb);
insert into continuation_reservations
select n,(context->>'caseVersion')::bigint,
  case when n=1 then public.service_reserve_nayax_refund_manager_action_v4('continuation-executor',
    'ca000000-0000-4000-8000-000000000001',
    ('ca500000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
    (context->>'caseVersion')::bigint,'nayax-refund-'||repeat(n::text,64),800,null,null,'USD',
    'nayax-production-account-contract-v2','nayax-provider-journal-v3',context->>'contextHash',
    'source_with_bound_offset')
  else public.service_reserve_nayax_refund_manager_action_v3('continuation-executor',
    'ca000000-0000-4000-8000-000000000001',
    ('ca500000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
    (context->>'caseVersion')::bigint,'nayax-refund-'||repeat(n::text,64),800,null,null,'USD',
    'nayax-production-account-contract-v2','nayax-provider-journal-v3',context->>'contextHash') end
from generate_series(1,6) n
cross join lateral (
  select case when n=1 then public.service_get_refund_nayax_execution_context_v2('continuation-executor',
    'ca000000-0000-4000-8000-000000000001',
    ('ca500000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'source_with_bound_offset')
  else public.service_get_refund_nayax_execution_context('continuation-executor',
    'ca000000-0000-4000-8000-000000000001',
    ('ca500000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid) end as context
) execution;

create function pg_temp.record_request(p_n integer,outcome_name text,contract_match boolean,
  semantic_match boolean,business_result text,business_status text)
returns void language plpgsql as $$
declare r jsonb; aid uuid; claim text;
begin
  select result into r from continuation_reservations where continuation_reservations.n=p_n;
  aid:=(r#>>'{attempt,attemptId}')::uuid; claim:=r->>'providerClaimToken';
  perform public.service_record_nayax_refund_provider_stage_v4_diagnostics('continuation-executor',aid,claim,
    'request','started',null,null,null,null,repeat(p_n::text,64),
    'nayax-production-account-contract-v2','nayax-provider-journal-v3',
    null,null,null,null,null,null,null,null,null,null,null,null,null,null,false,
    null,null,false,null,null,null,null,null,null);
  perform public.service_record_nayax_refund_provider_stage_v4_diagnostics('continuation-executor',aid,claim,
    'request','result',200,outcome_name,contract_match,null,repeat(p_n::text,64),
    'nayax-production-account-contract-v2','nayax-provider-journal-v3',
    true,'application_json','json_object','1_256',true,true,true,true,true,'string','string',
    semantic_match,
    case when semantic_match then business_result else null end,
    case when semantic_match then business_status else null end,
    semantic_match,business_result,business_status,true,
    business_result,'exact','1_80',business_status,'exact','1_80');
  update public.refund_case_nayax_refund_attempts
  set provider_claim_expires_at=statement_timestamp()-interval '1 second' where id=aid;
end $$;

create function pg_temp.continue_attempt(p_n integer,version_offset integer default 2,
  p_actor_user_id uuid default 'ca000000-0000-4000-8000-000000000001',
  p_wire text default null,
  p_mode text default null,p_email_mode text default 'omit')
returns jsonb language sql as $$
  select public.service_reserve_nayax_refund_approval_continuation_v2('continuation-executor',
    p_actor_user_id,
    ('ca500000-0000-4000-8000-'||lpad(p_n::text,12,'0'))::uuid,
    expected_version+version_offset,'nayax-refund-'||repeat(p_n::text,64),800,'USD',
    'nayax-production-account-contract-v2','nayax-provider-journal-v3',
    coalesce(p_wire,case when p_n=1 then '2026-08-26T13:17:09.810-05:00' else '2026-08-26T13:17:08.123' end),
    coalesce(p_mode,case when p_n=1 then 'source_with_bound_offset' else 'exact_source' end),p_email_mode)
  from continuation_reservations where continuation_reservations.n=p_n;
$$;

select ok(not has_table_privilege('service_role','public.refund_nayax_provider_business_outcomes','select')
  and not has_table_privilege('authenticated','public.refund_nayax_provider_business_outcomes','select')
  and not has_table_privilege('anon','public.refund_nayax_provider_business_outcomes','select')
  and not has_table_privilege('service_role','public.refund_nayax_provider_response_diagnostics','select')
  and not has_table_privilege('authenticated','public.refund_nayax_provider_response_diagnostics','select')
  and not has_table_privilege('anon','public.refund_nayax_provider_response_diagnostics','select'),
  'Business outcomes and independent diagnostics have no service, manager, or anonymous read grant');
select ok(not has_table_privilege('service_role','public.refund_nayax_attempt_approval_continuations','select')
  and not has_table_privilege('authenticated','public.refund_nayax_attempt_approval_continuations','select'),
  'Continuation claims have no service or browser read grant');
select ok((select relrowsecurity from pg_class where oid='public.refund_nayax_provider_business_outcomes'::regclass)
  and (select relrowsecurity from pg_class where oid='public.refund_nayax_attempt_approval_continuations'::regclass)
  and (select relrowsecurity from pg_class where oid='public.refund_nayax_provider_response_diagnostics'::regclass),
  'All private response and continuation tables have RLS enabled');
select ok(exists(select 1 from pg_constraint
  where conrelid='public.refund_nayax_attempt_approval_continuations'::regclass
    and conname='refund_nayax_approval_continuation_generation_unique' and contype='u'),
  'One case generation can reserve at most one approval continuation');
select ok(has_function_privilege('service_role',
  'public.service_record_nayax_refund_provider_stage_v3_outcomes(text,uuid,text,text,text,integer,text,boolean,text,text,text,text,boolean,text,text,text,boolean,boolean,boolean,boolean,boolean,text,text,boolean,text,text,boolean)','execute')
  and has_function_privilege('service_role',
  'public.service_record_nayax_refund_provider_stage_v3_diagnostics(text,uuid,text,text,text,integer,text,boolean,text,text,text,text,boolean,text,text,text,boolean,boolean,boolean,boolean,boolean,text,text,boolean,text,text,boolean,text,text,boolean)','execute')
  and has_function_privilege('service_role',
  'public.service_record_nayax_refund_provider_stage_v4_diagnostics(text,uuid,text,text,text,integer,text,boolean,text,text,text,text,boolean,text,text,text,boolean,boolean,boolean,boolean,boolean,text,text,boolean,text,text,boolean,text,text,boolean,text,text,text,text,text,text)','execute')
  and not has_function_privilege('service_role',
  'public.service_reserve_nayax_refund_approval_continuation_v1(text,uuid,uuid,bigint,text,integer,text,text,text)','execute'),
  'Only assertion-protected service boundaries expose writes');
select ok(not has_function_privilege('authenticated',
  'public.service_reserve_nayax_refund_approval_continuation_v1(text,uuid,uuid,bigint,text,integer,text,text,text)','execute'),
  'Browser roles cannot reserve an approval continuation');
select ok(not has_function_privilege('authenticated',
  'public.service_record_nayax_refund_provider_stage_v3_diagnostics(text,uuid,text,text,text,integer,text,boolean,text,text,text,text,boolean,text,text,text,boolean,boolean,boolean,boolean,boolean,text,text,boolean,text,text,boolean,text,text,boolean)','execute')
  and not has_function_privilege('authenticated',
  'public.service_record_nayax_refund_provider_stage_v4_diagnostics(text,uuid,text,text,text,integer,text,boolean,text,text,text,text,boolean,text,text,text,boolean,boolean,boolean,boolean,boolean,text,text,boolean,text,text,boolean,text,text,boolean,text,text,text,text,text,text)','execute'),
  'Browser roles cannot write restricted provider response scalars');
select ok(
  public.refund_nayax_response_diagnostic_is_safe(repeat('safe ',20),'length_extended','81_160',true,'string')
  and public.refund_nayax_response_diagnostic_is_safe(repeat('safe ',32),'length_truncated','over_160',true,'string')
  and not public.refund_nayax_response_diagnostic_is_safe(repeat('x',160),'length_truncated','over_160',true,'string')
  and public.refund_nayax_response_diagnostic_is_safe('[redacted]','sensitive_redacted','1_80',true,'string')
  and public.refund_nayax_response_diagnostic_is_safe('customer notice','exact','1_80',true,'string')
  and not public.refund_nayax_response_diagnostic_is_safe('safe'||chr(133)||'unsafe','exact','1_80',true,'string'),
  'Independent diagnostic validation preserves useful prose and rejects C1 controls');
select ok(
  public.refund_nayax_restricted_scalar_is_safe(repeat('x',31),'string')
  and not public.refund_nayax_restricted_scalar_is_safe(repeat('x',32),'string')
  and not public.refund_nayax_restricted_scalar_is_safe(repeat('x',47),'string')
  and not public.refund_nayax_restricted_scalar_is_safe('4111 1111 1111 1111','string')
  and public.refund_nayax_restricted_scalar_is_safe('999999999','number')
  and not public.refund_nayax_restricted_scalar_is_safe('1000000000','number')
  and not public.refund_nayax_restricted_scalar_is_safe(null,'boolean'),
  'Database scalar safety matches adapter boundaries and rejects null misuse');
select ok(not has_function_privilege('authenticated',
  'public.refund_nayax_approval_continuation_ready_v1(uuid,uuid)','execute')
  and not has_function_privilege('service_role',
  'public.refund_nayax_approval_continuation_ready_v1(uuid,uuid)','execute'),
  'The evidence predicate is reachable only through the service readiness contract');
select ok(has_function_privilege('service_role',
  'public.service_record_nayax_refund_provider_stage_v3(text,uuid,text,text,text,integer,text,boolean,text,text,text,text,boolean,text,text,text,boolean,boolean,boolean,boolean,boolean,text,text,boolean)','execute'),
  'The prior journal-v3 recorder remains available to the previously deployed Edge');
select ok(
  public.service_get_nayax_refund_provider_journal_capability_v3('continuation-executor')
    @> '{"businessOutcomeRecordVersion":"nayax-business-outcome-v2","approvalContinuationVersion":"same-attempt-approval-continuation-v1"}'::jsonb,
  'Capability pins the private outcome record and same-attempt continuation contracts');

grant select on continuation_reservations to service_role;
set local role service_role;
select lives_ok($$select public.service_record_nayax_refund_provider_stage_v3(
  'continuation-executor',
  (select (result#>>'{attempt,attemptId}')::uuid from continuation_reservations where n=2),
  (select result->>'providerClaimToken' from continuation_reservations where n=2),
  'request','started',null,null,null,null,repeat('2',64),
  'nayax-production-account-contract-v2','nayax-provider-journal-v3',
  null,null,null,null,null,null,null,null,null,null,null,null)$$,
  'Old Edge plus new database can journal after preflight without a post-transport permission failure');
reset role;

select is(public.refund_case_nayax_manager_readiness(
  'ca000000-0000-4000-8000-000000000001',
  'ca500000-0000-4000-8000-000000000002')#>>'{approvalContinuationReady}',
  'false','A request without an accepted result remains on the ordinary hold path');

select public.service_record_nayax_refund_provider_stage_v4_diagnostics(
  'continuation-executor',
  (select (result#>>'{attempt,attemptId}')::uuid from continuation_reservations where n=2),
  (select result->>'providerClaimToken' from continuation_reservations where n=2),
  'request','result',null,'unknown',false,'network',repeat('e',64),
  'nayax-production-account-contract-v2','nayax-provider-journal-v3',
  false,'unavailable','unavailable','unavailable',false,false,false,false,false,
  'unavailable','unavailable',false,null,null,false,null,null,false,
  null,'unavailable','unavailable',null,'unavailable','unavailable');
select is((select result_disposition||'|'||status_disposition
  from public.refund_nayax_provider_response_diagnostics d
  join continuation_reservations r on (r.result#>>'{attempt,attemptId}')::uuid=d.nayax_refund_attempt_id
  where r.n=2 and d.stage='request'),'unavailable|unavailable',
  'Transport failure records unavailable diagnostics without inventing parsed missing keys');

select pg_temp.record_request(1,'accepted',true,true,
  'Refund status updated successfully, but the email could not be sent','Partial success');
select ok(public.refund_case_nayax_manager_readiness(
  'ca000000-0000-4000-8000-000000000001',
  'ca500000-0000-4000-8000-000000000001') @> jsonb_build_object(
    'approvalContinuationReady',true,
    'canIssueCardRefund',true,
    'blockReason',null,
    'caseVersion',(select expected_version+2 from continuation_reservations where n=1)
  ),'Reloaded readiness exposes only the proved current-version approval continuation');
select is(public.refund_case_nayax_manager_readiness(
  'ca000000-0000-4000-8000-000000000002',
  'ca500000-0000-4000-8000-000000000001')#>>'{approvalContinuationReady}',
  'false','A different user without current machine authority cannot obtain continuation readiness');
select throws_ok($$select pg_temp.continue_attempt(1,p_wire=>'2026-08-26T13:17:09.810',
  p_mode=>'exact_source')$$,'P4628',null,
  'A changed timestamp representation cannot reserve an approval continuation');
select throws_ok($$select pg_temp.continue_attempt(1,p_email_mode=>'empty_string')$$,'P4628',null,
  'A changed email representation cannot reserve an approval continuation');
select is((select count(*) from public.refund_nayax_attempt_approval_continuations c
  join continuation_reservations r on (r.result#>>'{attempt,attemptId}')::uuid=c.nayax_refund_attempt_id
  where r.n=1),0::bigint,'Serialization mismatches create no continuation claim');
select ok(not has_function_privilege('authenticated',
  'public.service_reserve_nayax_refund_approval_continuation_v2(text,uuid,uuid,bigint,text,integer,text,text,text,text,text,text)','execute')
  and has_function_privilege('service_role',
  'public.service_reserve_nayax_refund_approval_continuation_v2(text,uuid,uuid,bigint,text,integer,text,text,text,text,text,text)','execute'),
  'The serialization-bound continuation remains an assertion-protected service boundary');
create temp table issued_continuation as select pg_temp.continue_attempt(1) result;
select is((select result#>>'{attempt,shouldExecute}' from issued_continuation),'true',
  'Crash after proved request acceptance: a bound-offset request reloads its advanced case version and continues with the original wire');
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
  where r.n=1 and b.stage='request'),
  'Refund status updated successfully, but the email could not be sent|Partial success',
  'Exact bounded request business pair is retained');
select is((select observed_result_scalar||'|'||observed_status_scalar from public.refund_nayax_provider_business_outcomes b
  join continuation_reservations r on (r.result#>>'{attempt,attemptId}')::uuid=b.nayax_refund_attempt_id
  where r.n=1 and b.stage='request'),
  'Refund status updated successfully, but the email could not be sent|Partial success',
  'Restricted request scalars are retained separately');
select is(pg_temp.continue_attempt(1)#>>'{attempt,shouldExecute}','false',
  'Duplicate click or concurrent worker cannot obtain a second continuation claim');
select is((select count(*) from public.refund_nayax_attempt_approval_continuations c
  join continuation_reservations r on (r.result#>>'{attempt,attemptId}')::uuid=c.nayax_refund_attempt_id where r.n=1),
  1::bigint,'One immutable attempt has at most one continuation reservation');
select is(public.refund_case_nayax_manager_readiness(
  'ca000000-0000-4000-8000-000000000001',
  'ca500000-0000-4000-8000-000000000001')#>>'{approvalContinuationReady}',
  'false','A concurrent tab cannot see an actionable second continuation');

select pg_temp.record_request(3,'unknown',false,false,'True','Unexpected');
select is(pg_temp.continue_attempt(3)#>>'{attempt,shouldExecute}','false',
  'Unknown or ambiguous request pair remains inspect-only');
select is((select business_result||'|'||business_status from public.refund_nayax_provider_business_outcomes b
  join continuation_reservations r on (r.result#>>'{attempt,attemptId}')::uuid=b.nayax_refund_attempt_id
  where r.n=3 and b.stage='request'),null,'Unknown alphabetic provider text is represented without retaining the pair');
select is((select observed_result_scalar||'|'||observed_status_scalar from public.refund_nayax_provider_business_outcomes b
  join continuation_reservations r on (r.result#>>'{attempt,attemptId}')::uuid=b.nayax_refund_attempt_id
  where r.n=3 and b.stage='request'),'True|Unexpected',
  'Unknown request scalars are captured without changing their unknown outcome');
select is((select result_text||'|'||status_text from public.refund_nayax_provider_response_diagnostics d
  join continuation_reservations r on (r.result#>>'{attempt,attemptId}')::uuid=d.nayax_refund_attempt_id
  where r.n=3 and d.stage='request'),'True|Unexpected',
  'Independent request diagnostics retain each safe unfamiliar scalar');
select is((select result_disposition||'|'||status_disposition from public.refund_nayax_provider_response_diagnostics d
  join continuation_reservations r on (r.result#>>'{attempt,attemptId}')::uuid=d.nayax_refund_attempt_id
  where r.n=3 and d.stage='request'),'exact|exact',
  'Independent request diagnostics bind explicit per-field dispositions');
select is(public.refund_case_nayax_manager_readiness(
  'ca000000-0000-4000-8000-000000000001',
  'ca500000-0000-4000-8000-000000000003')#>>'{approvalContinuationReady}',
  'false','Unknown request evidence remains inspect-only in manager readiness');

update public.refund_case_nayax_refund_attempts set provider_claim_expires_at=now()-interval '1 second'
where id=(select (result#>>'{attempt,attemptId}')::uuid from continuation_reservations where n=2);
select is(pg_temp.continue_attempt(2)#>>'{attempt,shouldExecute}','false',
  'Request-not-proved cannot continue');
select pg_temp.record_request(4,'accepted',true,true,'True','Pending Approval');
select throws_ok($$select pg_temp.continue_attempt(4,0)$$,'P4628',null,
  'Stale expected version cannot claim continuation');
select is((select count(*) from public.refund_nayax_attempt_approval_continuations c
  join continuation_reservations r on (r.result#>>'{attempt,attemptId}')::uuid=c.nayax_refund_attempt_id where r.n=4),
  0::bigint,'Stale-version rejection creates no continuation claim');
select pg_temp.record_request(6,'accepted',true,true,'FixtureResult','FixtureStatus');
select throws_ok($$update public.refund_cases set refund_amount_cents=700
  where id='ca500000-0000-4000-8000-000000000006'$$,'P0001',null,
  'The active attempt guard prevents the full refund amount from changing before approval');

select public.service_record_nayax_refund_provider_stage_v4_diagnostics('continuation-executor',
  (select (result#>>'{attempt,attemptId}')::uuid from issued_continuation),
  (select result->>'providerClaimToken' from issued_continuation),'approve','started',null,null,null,null,
  repeat('a',64),'nayax-production-account-contract-v2','nayax-provider-journal-v3',
  null,null,null,null,null,null,null,null,null,null,null,null,null,null,false,
  null,null,false,null,null,null,null,null,null);
select public.service_record_nayax_refund_provider_stage_v4_diagnostics('continuation-executor',
  (select (result#>>'{attempt,attemptId}')::uuid from issued_continuation),
  (select result->>'providerClaimToken' from issued_continuation),'approve','result',200,'succeeded',true,null,
  repeat('b',64),'nayax-production-account-contract-v2','nayax-provider-journal-v3',
  true,'application_json','json_object','1_256',true,true,true,true,true,'string','string',true,
  'Refund status updated successfully, but the email could not be sent','Partial success',true,
  'Refund status updated successfully, but the email could not be sent','Partial success',true,
  'Refund status updated successfully, but the email could not be sent','exact','1_80',
  'Partial success','exact','1_80');
select is((select business_result||'|'||business_status from public.refund_nayax_provider_business_outcomes b
  join continuation_reservations r on (r.result#>>'{attempt,attemptId}')::uuid=b.nayax_refund_attempt_id
  where r.n=1 and b.stage='approve'),
  'Refund status updated successfully, but the email could not be sent|Partial success',
  'Exact bounded approval business pair is retained');
select is((select observed_result_scalar||'|'||observed_status_scalar from public.refund_nayax_provider_business_outcomes b
  join continuation_reservations r on (r.result#>>'{attempt,attemptId}')::uuid=b.nayax_refund_attempt_id
  where r.n=1 and b.stage='approve'),
  'Refund status updated successfully, but the email could not be sent|Partial success',
  'Restricted approval scalars are retained separately');
select is((select result_text||'|'||status_text from public.refund_nayax_provider_response_diagnostics d
  join continuation_reservations r on (r.result#>>'{attempt,attemptId}')::uuid=d.nayax_refund_attempt_id
  where r.n=1 and d.stage='approve'),
  'Refund status updated successfully, but the email could not be sent|Partial success',
  'Independent approval diagnostics bind the same safe response pair');
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
select ok((select confirmation_source='api_stage_contract' and provider_status is null
    and settled_at is null and settlement_time_precision='unknown'
    and nayax_refund_attempt_id=(select (result#>>'{attempt,attemptId}')::uuid
      from issued_continuation)
  from public.refund_authoritative_receipts
  where refund_case_id='ca500000-0000-4000-8000-000000000001'),
  'Exact successful request and approval journals record payment truth before customer delivery');
select is((select count(*) from public.refund_case_messages
  where refund_case_id='ca500000-0000-4000-8000-000000000001'),0::bigint,
  'Receipt recording does not require or create the completion notice');
insert into public.refund_gmail_threads(
  id,refund_case_id,mailbox_hash,provider_thread_id,thread_subject,
  first_message_at,latest_message_at,retention_expires_at
) values (
  'ca700000-0000-4000-8000-000000000001',
  'ca500000-0000-4000-8000-000000000001',repeat('9',64),
  'continuation-terminal-thread','Synthetic terminal thread',
  now()-interval '1 day',now(),now()+interval '30 days'
);
insert into public.refund_gmail_messages(
  id,gmail_thread_id,refund_case_id,provider_message_id,direction,message_kind,status,
  sender_email,recipient_email,participant_role,participant_trust,subject,plain_body,
  received_at,retention_expires_at
) values (
  'ca710000-0000-4000-8000-000000000001',
  'ca700000-0000-4000-8000-000000000001',
  'ca500000-0000-4000-8000-000000000001','continuation-terminal-inbound',
  'inbound','message','received','fixture-1@example.test','info@bloomjoysweets.com',
  'customer','verified','Synthetic terminal thread','Synthetic original request',
  now()-interval '1 day',now()+interval '30 days'
);
select set_config('test.terminal_api_attempt_id',
  (select (result#>>'{attempt,attemptId}') from issued_continuation),true);
select set_config('request.jwt.claim.role','service_role',true);
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select set_config('test.terminal_api_claim',public.service_claim_nayax_refund_completion(
  'continuation-executor',current_setting('test.terminal_api_attempt_id')::uuid)::text,true);
reset role;
select ok((current_setting('test.terminal_api_claim')::jsonb->>'claimed')::boolean,
  'The receipt permits the succeeded attempt to create its one exact completion message');
select ok((select message_type='completed' and status='pending'
    and template_version='refund_nayax_completion_v2' and delivery_kind='manual'
    and nayax_refund_attempt_id=current_setting('test.terminal_api_attempt_id')::uuid
  from public.refund_case_messages
  where refund_case_id='ca500000-0000-4000-8000-000000000001'),
  'The permitted message retains the exact claimed v2 identity and delivery kind');
select is(public.service_get_refund_lifecycle(
    'ca500000-0000-4000-8000-000000000001')#>>'{stage}',
  'refund_confirmed',
  'An API receipt with a queued v2 notice remains payment-confirmed');
select is(public.service_get_refund_lifecycle(
    'ca500000-0000-4000-8000-000000000001')#>>'{managerQueue,bucket}',
  'in_progress',
  'A queued v2 notice does not fall into receipt accounting review');
select is(public.service_get_refund_lifecycle(
    'ca500000-0000-4000-8000-000000000001')#>>'{accountingState,state}',
  'applied',
  'The existing adjustment remains separate applied accounting');
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claims',
  '{"sub":"ca000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"ca010000-0000-4000-8000-000000000001","is_anonymous":false}',true);
set local role authenticated;
select set_config('test.terminal_api_overview',
  public.admin_get_refund_authoritative_receipt_overview(
    'ca500000-0000-4000-8000-000000000001')::text,true);
reset role;
select ok(current_setting('test.terminal_api_overview')::jsonb->>'attemptBindingKind'='proved_terminal_api'
    and not (current_setting('test.terminal_api_overview')::jsonb?'completionNotice')
    and current_setting('test.terminal_api_overview')::jsonb->'noticeChoices'='[]'::jsonb,
  'The manager overview recognizes API proof without offering receipt-v1 notice controls');
select set_config('test.terminal_api_message_id',(select id::text
  from public.refund_case_messages
  where refund_case_id='ca500000-0000-4000-8000-000000000001'),true);
select set_config('test.terminal_api_recipient',(select recipient_email
  from public.refund_case_messages
  where id=current_setting('test.terminal_api_message_id')::uuid),true);
select set_config('test.terminal_api_body',(select body
  from public.refund_case_messages
  where id=current_setting('test.terminal_api_message_id')::uuid),true);
select throws_ok($$update public.refund_case_messages
  set body=body||E'\nChanged after receipt'
  where id=current_setting('test.terminal_api_message_id')::uuid$$,
  'P4663',null,'The receipt keeps the bound v2 customer copy immutable');
select throws_ok($$update public.refund_case_messages set status='sent',sent_at=now()
  where id=current_setting('test.terminal_api_message_id')::uuid$$,
  'P4663',null,'A pending receipt-bound message cannot become sent without exact provider proof');
select throws_ok($$update public.refund_case_nayax_refund_attempts
  set completion_delivery_status='sent',completion_manager_cc_count=1
  where id=current_setting('test.terminal_api_attempt_id')::uuid$$,
  'P4663',null,'A pending receipt-bound attempt cannot become sent without exact provider proof');
set local role service_role;
select throws_ok($$select public.service_claim_refund_gmail_outbound_v3(
  'ca500000-0000-4000-8000-000000000001',
  current_setting('test.terminal_api_message_id')::uuid,
  'refund-case-message:'||current_setting('test.terminal_api_message_id'),
  'info@bloomjoysweets.com',current_setting('test.terminal_api_recipient'),
  current_setting('test.terminal_api_body'),array['info@bloomjoysweets.com'],
  'automatic','ca700000-0000-4000-8000-000000000001'
)$$,'P4664',null,'The receipt rejects a transport kind different from the stored v2 message');
reset role;
set local role service_role;
select is(public.service_claim_nayax_refund_completion(
  'continuation-executor',current_setting('test.terminal_api_attempt_id')::uuid)->>'claimed',
  'false','Duplicate completion claim reuses the same message');
reset role;
select throws_ok($$insert into public.refund_case_messages(
  refund_case_id,message_type,status,recipient_email,subject,body,template_key,
  created_by,content_source,delivery_kind,template_version,requested_fields
) values (
  'ca500000-0000-4000-8000-000000000001','completed','pending',
  'fixture-1@example.test','Changed completion','Changed completion',
  'refund_nayax_completed_v2','ca000000-0000-4000-8000-000000000001',
  'deterministic_template','manual','refund_nayax_completion_v2','{}'
)$$,'P4663',null,'Receipt guard rejects every unbound additional completion message');
set local role service_role;
select set_config('test.terminal_api_outbound',public.service_claim_refund_gmail_outbound_v3(
  'ca500000-0000-4000-8000-000000000001',
  current_setting('test.terminal_api_message_id')::uuid,
  'refund-case-message:'||current_setting('test.terminal_api_message_id'),
  'info@bloomjoysweets.com',current_setting('test.terminal_api_recipient'),
  current_setting('test.terminal_api_body'),array['info@bloomjoysweets.com'],
  'manual','ca700000-0000-4000-8000-000000000001'
)::text,true);
reset role;
select ok((current_setting('test.terminal_api_outbound')::jsonb->>'claimed')::boolean,
  'The exact receipt-bound v2 notice can claim its original-thread transport');
select is(public.service_get_refund_lifecycle(
    'ca500000-0000-4000-8000-000000000001')#>>'{managerQueue,bucket}',
  'needs_action',
  'A claimed transport without provider confirmation does not look safely unsent');
set local role service_role;
select lives_ok($$select public.service_finish_nayax_refund_completion(
  'continuation-executor',current_setting('test.terminal_api_attempt_id')::uuid,
  'delivery_unknown')$$,
  'A transport with no result is durably held without retrying its message');
reset role;
select ok((select completion_delivery_status='delivery_unknown'
      from public.refund_case_nayax_refund_attempts
      where id=current_setting('test.terminal_api_attempt_id')::uuid)
    and public.service_get_refund_lifecycle(
      'ca500000-0000-4000-8000-000000000001')#>>'{managerQueue,bucket}'='needs_action',
  'Delivery uncertainty remains actionable while payment stays confirmed');
select throws_ok(format($sql$update public.refund_case_nayax_refund_attempts
  set completion_delivery_status='sent',completion_manager_cc_count=1 where id=%L$sql$,
  current_setting('test.terminal_api_attempt_id')),
  'P4663',null,'Delivery unknown cannot become sent without exact Gmail provider and manager-CC proof');
set local role service_role;
select lives_ok(format($sql$select public.service_finish_refund_gmail_outbound(
  %L,'sent','terminal-api-provider-message',null,null)$sql$,
  current_setting('test.terminal_api_outbound')::jsonb->>'transportMessageId'),
  'The normal Gmail finalizer records exact provider sent proof');
select lives_ok($$select public.service_finish_nayax_refund_completion(
  'continuation-executor',current_setting('test.terminal_api_attempt_id')::uuid,'sent'
)$$,'The exact claimed v2 notice can finish independently after receipt creation');
reset role;
select ok(public.service_get_refund_lifecycle(
      'ca500000-0000-4000-8000-000000000001')#>>'{stage}'='customer_notified'
    and public.service_get_refund_lifecycle(
      'ca500000-0000-4000-8000-000000000001')->>'publicCopyKey'='refund_customer_notified'
    and public.service_get_refund_lifecycle(
      'ca500000-0000-4000-8000-000000000001')#>>'{messageState,state}'='sent',
  'A sent v2 notice projects consistent customer-notified state and public copy');
select is(public.service_get_refund_lifecycle(
    'ca500000-0000-4000-8000-000000000001')#>>'{managerQueue,bucket}',
  'completed',
  'A sent v2 notice removes the API-confirmed case from the actionable manager queue');
select ok((public.service_get_refund_lifecycle(
    'ca500000-0000-4000-8000-000000000001')->>'terminal')::boolean
    and public.service_get_refund_lifecycle(
      'ca500000-0000-4000-8000-000000000001')#>>'{accountingState,state}'='applied',
  'Customer delivery can finish while applied accounting remains separate');
select ok((select attempt.completion_delivery_status='sent' and message.status='sent'
    from public.refund_case_nayax_refund_attempts attempt
    join public.refund_case_messages message on message.id=attempt.completion_message_id
    where attempt.id=current_setting('test.terminal_api_attempt_id')::uuid),
  'The guarded finalizers retain exact sent state on the bound attempt and message');
set local role service_role;
select is(public.service_finish_nayax_refund_completion(
    'continuation-executor',current_setting('test.terminal_api_attempt_id')::uuid,'sent')->>'status',
  'already_sent','Sent completion replay performs no retry');
reset role;
select throws_ok(format($sql$update public.refund_case_messages set status='pending'
  where id=%L$sql$,current_setting('test.terminal_api_message_id')),
  'P4663',null,'A sent receipt-bound v2 message cannot move backward to pending');
select throws_ok(format($sql$update public.refund_case_nayax_refund_attempts
  set completion_delivery_status='failed' where id=%L$sql$,
  current_setting('test.terminal_api_attempt_id')),
  'P4663',null,'A sent receipt-bound completion attempt cannot move backward to failed');
select ok(not public.refund_terminal_api_completion_attempt_change_allowed(
  (select to_jsonb(attempt)||jsonb_build_object(
      'completion_delivery_status','failed','completion_delivery_retry_count',1)
    from public.refund_case_nayax_refund_attempts attempt
    where id=current_setting('test.terminal_api_attempt_id')::uuid),
  (select to_jsonb(attempt)||jsonb_build_object(
      'completion_delivery_status','pending','completion_delivery_retry_count',0)
    from public.refund_case_nayax_refund_attempts attempt
    where id=current_setting('test.terminal_api_attempt_id')::uuid)),
  'A receipt-bound delivery retry count cannot decrease');

-- A normal request/approve pair may outlive its plaintext claim after the
-- provider succeeded. A manager-confirmed same-incident sibling is the only
-- duplicate state this provider-free recovery accepts.
create temp table recovery_reservation as
select result from continuation_reservations where n=7;
select public.service_record_nayax_refund_provider_stage_v4_diagnostics('continuation-executor',
  (select (result#>>'{attempt,attemptId}')::uuid from recovery_reservation),
  (select result->>'providerClaimToken' from recovery_reservation),
  'request','started',null,null,null,null,repeat('7',64),
  'nayax-production-account-contract-v2','nayax-provider-journal-v3',
  null,null,null,null,null,null,null,null,null,null,null,null,null,null,false,
  null,null,false,null,null,null,null,null,null);
select public.service_record_nayax_refund_provider_stage_v4_diagnostics('continuation-executor',
  (select (result#>>'{attempt,attemptId}')::uuid from recovery_reservation),
  (select result->>'providerClaimToken' from recovery_reservation),
  'request','result',200,'accepted',true,null,repeat('8',64),
  'nayax-production-account-contract-v2','nayax-provider-journal-v3',
  true,'application_json','json_object','1_256',true,true,true,true,true,'string','string',true,
  'Refund status updated successfully, but the email could not be sent','Partial success',true,
  'Refund status updated successfully, but the email could not be sent','Partial success',true,
  'Refund status updated successfully, but the email could not be sent','exact','1_80',
  'Partial success','exact','1_80');
select public.service_record_nayax_refund_provider_stage_v4_diagnostics('continuation-executor',
  (select (result#>>'{attempt,attemptId}')::uuid from recovery_reservation),
  (select result->>'providerClaimToken' from recovery_reservation),
  'approve','started',null,null,null,null,repeat('9',64),
  'nayax-production-account-contract-v2','nayax-provider-journal-v3',
  null,null,null,null,null,null,null,null,null,null,null,null,null,null,false,
  null,null,false,null,null,null,null,null,null);
select public.service_record_nayax_refund_provider_stage_v4_diagnostics('continuation-executor',
  (select (result#>>'{attempt,attemptId}')::uuid from recovery_reservation),
  (select result->>'providerClaimToken' from recovery_reservation),
  'approve','result',200,'succeeded',true,null,repeat('a',64),
  'nayax-production-account-contract-v2','nayax-provider-journal-v3',
  true,'application_json','json_object','1_256',true,true,true,true,true,'string','string',true,
  'Refund status updated successfully, but the email could not be sent','Partial success',true,
  'Refund status updated successfully, but the email could not be sent','Partial success',true,
  'Refund status updated successfully, but the email could not be sent','exact','1_80',
  'Partial success','exact','1_80');
insert into public.refund_cases(
  id,public_reference,reporting_machine_id,reporting_location_id,customer_email,
  issue_summary,incident_at,payment_method,payment_amount_cents,card_last4,
  card_wallet_used,status,correlation_status,automation_state,
  nayax_match_execution_eligible,nayax_refund_execution_status,intake_source
) select
  'ca500000-0000-4000-8000-000000000107','RF-CONTINUE-7-DUP',
  reporting_machine_id,reporting_location_id,customer_email,
  'Same incident submitted again',incident_at,payment_method,payment_amount_cents,
  card_last4,card_wallet_used,'needs_review','manual_review','needs_review',
  false,'not_requested','form'
from public.refund_cases where id='ca500000-0000-4000-8000-000000000007';

insert into public.refund_gmail_threads(
  id,refund_case_id,mailbox_hash,provider_thread_id,thread_subject,
  first_message_at,latest_message_at,retention_expires_at
) values (
  'ca700000-0000-4000-8000-000000000007',
  'ca500000-0000-4000-8000-000000000007',repeat('7',64),
  'continuation-recovery-thread','Synthetic recovery thread',
  now()-interval '1 day',now(),now()+interval '30 days'
);
insert into public.refund_gmail_messages(
  id,gmail_thread_id,refund_case_id,provider_message_id,direction,message_kind,status,
  sender_email,recipient_email,participant_role,participant_trust,subject,plain_body,
  received_at,retention_expires_at
) values (
  'ca710000-0000-4000-8000-000000000007',
  'ca700000-0000-4000-8000-000000000007',
  'ca500000-0000-4000-8000-000000000007','continuation-recovery-inbound',
  'inbound','message','received','fixture-7@example.test','info@bloomjoysweets.com',
  'customer','verified','Synthetic recovery thread','Synthetic original request',
  now()-interval '1 day',now()+interval '30 days'
);

select ok(not has_function_privilege('authenticated',
  'public.service_recover_proved_nayax_api_success_with_duplicate(uuid,uuid,uuid)','execute')
  and has_function_privilege('service_role',
  'public.service_recover_proved_nayax_api_success_with_duplicate(uuid,uuid,uuid)','execute'),
  'Only service role can invoke journal-proved settlement recovery');
select is((select status from public.refund_case_reconciliation_reviews
  where 'ca500000-0000-4000-8000-000000000107' in
    (left_refund_case_id,right_refund_case_id)), 'pending',
  'A same-source possible duplicate receives an ordinary pending manager review');

select set_config('request.jwt.claim.role','service_role',true);
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select throws_ok($$select public.service_recover_proved_nayax_api_success_with_duplicate(
  'ca500000-0000-4000-8000-000000000007',
  (select (result#>>'{attempt,attemptId}')::uuid from recovery_reservation),
  'ca500000-0000-4000-8000-000000000107')$$,
  'P4674',null,'Recovery refuses a possible duplicate before explicit manager resolution');
reset role;
select ok(not exists(select 1 from public.sales_adjustment_facts
    where refund_case_id='ca500000-0000-4000-8000-000000000007')
  and not exists(select 1 from public.refund_case_messages
    where refund_case_id='ca500000-0000-4000-8000-000000000007'),
  'A refused recovery rolls back without adjustment or customer-message intent');

select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','ca000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims',
  '{"sub":"ca000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"ca010000-0000-4000-8000-000000000001","is_anonymous":false}',true);
set local role authenticated;
select lives_ok($$select public.admin_resolve_refund_case_reconciliation(
  (select id from public.refund_case_reconciliation_reviews
    where 'ca500000-0000-4000-8000-000000000107' in
      (left_refund_case_id,right_refund_case_id)),
  'duplicate','ca500000-0000-4000-8000-000000000007','same_incident')$$,
  'The existing authenticated manager boundary confirms the same incident');
reset role;
select ok((select duplicate_of_refund_case_id='ca500000-0000-4000-8000-000000000007'
    and duplicate_marked_by='ca000000-0000-4000-8000-000000000001'
    from public.refund_cases where id='ca500000-0000-4000-8000-000000000107')
  and exists(select 1 from public.refund_case_reconciliation_reviews
    where 'ca500000-0000-4000-8000-000000000107' in
      (left_refund_case_id,right_refund_case_id)
      and status='confirmed_duplicate'
      and canonical_refund_case_id='ca500000-0000-4000-8000-000000000007'
      and resolution_reason_code='same_incident'
      and resolved_by='ca000000-0000-4000-8000-000000000001'),
  'Recovery precondition preserves the real manager actor and canonical binding');

select set_config('request.jwt.claim.role','service_role',true);
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select set_config('test.journal_recovery',
  public.service_recover_proved_nayax_api_success_with_duplicate(
    'ca500000-0000-4000-8000-000000000007',
    (select (result#>>'{attempt,attemptId}')::uuid from recovery_reservation),
    'ca500000-0000-4000-8000-000000000107')::text,true);
reset role;
select ok(current_setting('test.journal_recovery')::jsonb @>
    '{"recovered":true,"replayed":false,"providerCallMade":false,"customerMessageSent":false,"completionMessageStatus":"pending"}'::jsonb,
  'Journal recovery completes payment state and only creates a pending notice intent');
select ok((select status='succeeded' and provider_outcome='success'
      and provider_status='approve_succeeded_contract_match'
      and safe_transport_stage='settled' and not reconciliation_required
      and provider_claim_consumed_at > provider_outcome_recorded_at
    from public.refund_case_nayax_refund_attempts
    where id=(select (result#>>'{attempt,attemptId}')::uuid from recovery_reservation)),
  'Attempt records historical provider approval separately from later recovery consumption');
select ok((select status='completed' and decision='approved'
      and nayax_refund_execution_status='approved'
      and reporting_adjustment_id is not null
    from public.refund_cases where id='ca500000-0000-4000-8000-000000000007')
  and (select count(*)=1 from public.sales_adjustment_facts
    where refund_case_id='ca500000-0000-4000-8000-000000000007'
      and match_status='applied'),
  'Canonical case and one applied adjustment commit atomically');
select ok((select confirmation_source='api_stage_contract'
      and attempt_binding_kind='proved_terminal_api' and provider_status is null
      and nayax_refund_attempt_id=(select (result#>>'{attempt,attemptId}')::uuid
        from recovery_reservation)
    from public.refund_authoritative_receipts
    where refund_case_id='ca500000-0000-4000-8000-000000000007'),
  'Recovery records the existing API-stage authoritative receipt contract');
select ok((select count(*)=1 and bool_and(status='pending')
      and bool_and(template_version='refund_nayax_completion_v2')
      and bool_and(delivery_kind='manual')
      and bool_and(nayax_refund_attempt_id=(select (result#>>'{attempt,attemptId}')::uuid
        from recovery_reservation))
    from public.refund_case_messages
    where refund_case_id='ca500000-0000-4000-8000-000000000007')
  and (select completion_gmail_thread_id='ca700000-0000-4000-8000-000000000007'
    from public.refund_case_nayax_refund_attempts
    where id=(select (result#>>'{attempt,attemptId}')::uuid from recovery_reservation)),
  'Exactly one v2 completion intent binds the canonical case and original thread');
select is((select count(*) from public.refund_nayax_provider_stage_journal
    where nayax_refund_attempt_id=(select (result#>>'{attempt,attemptId}')::uuid
      from recovery_reservation)),4::bigint,
  'Provider-free recovery preserves the exact two-stage journal without another call');
select set_config('test.journal_recovery_message_id',(select id::text
  from public.refund_case_messages
  where refund_case_id='ca500000-0000-4000-8000-000000000007'),true);
set local role service_role;
select set_config('test.journal_replay',
  public.service_recover_proved_nayax_api_success_with_duplicate(
    'ca500000-0000-4000-8000-000000000007',
    (select (result#>>'{attempt,attemptId}')::uuid from recovery_reservation),
    'ca500000-0000-4000-8000-000000000107')::text,true);
reset role;
select ok(current_setting('test.journal_replay')::jsonb @>
    '{"recovered":false,"replayed":true,"providerCallMade":false,"customerMessageSent":false}'::jsonb
  and current_setting('test.journal_replay')::jsonb->>'refundCaseMessageId'
    = current_setting('test.journal_recovery_message_id')
  and (select count(*)=1 from public.refund_case_messages
    where refund_case_id='ca500000-0000-4000-8000-000000000007'),
  'Recovery replay returns the same receipt-bound message and creates no second intent');

select pg_temp.record_request(5,'accepted',true,true,'True','Pending Approval');
update public.reporting_machine_refund_managers
set status='revoked',revoked_at=now(),revoke_reason='Synthetic continuation revocation'
where id='ca400000-0000-4000-8000-000000000001';
select throws_ok($$select pg_temp.continue_attempt(5)$$,'P4628',null,
  'Revoked manager authority cannot continue approval');
select is(public.refund_case_nayax_manager_readiness(
  'ca000000-0000-4000-8000-000000000001',
  'ca500000-0000-4000-8000-000000000005')#>>'{approvalContinuationReady}',
  'false','Revoked manager authority is removed from the read-only continuation path');
select is((select count(*) from public.refund_nayax_attempt_approval_continuations c
  join continuation_reservations r on (r.result#>>'{attempt,attemptId}')::uuid=c.nayax_refund_attempt_id where r.n=5),
  0::bigint,'Revoked manager creates no continuation claim');

insert into public.reporting_machine_refund_managers(id,reporting_machine_id,manager_user_id,
  manager_email,grant_reason)
values('ca400000-0000-4000-8000-000000000002','ca300000-0000-4000-8000-000000000001',
  'ca000000-0000-4000-8000-000000000002','handoff-manager@example.test',
  'Synthetic unchanged-machine handoff');
select is(public.refund_case_nayax_manager_readiness(
  'ca000000-0000-4000-8000-000000000002',
  'ca500000-0000-4000-8000-000000000005')#>>'{approvalContinuationReady}',
  'true','The current mapped manager can continue the unchanged originally approved attempt');
create temp table handoff_continuation as
select pg_temp.continue_attempt(5,2,'ca000000-0000-4000-8000-000000000002') result;
select is((select result#>>'{attempt,shouldExecute}' from handoff_continuation),'true',
  'A different current manager receives one approval-only continuation claim');
select ok((select a.actor_user_id='ca000000-0000-4000-8000-000000000001'
    and z.actor_user_id='ca000000-0000-4000-8000-000000000001'
    and c.actor_user_id='ca000000-0000-4000-8000-000000000002'
    and c.official_action_authorization_id=z.id
  from continuation_reservations r
  join public.refund_case_nayax_refund_attempts a
    on a.id=(r.result#>>'{attempt,attemptId}')::uuid
  join public.refund_case_official_action_authorizations z
    on z.id=a.official_action_authorization_id
  join public.refund_nayax_attempt_approval_continuations c
    on c.nayax_refund_attempt_id=a.id
  where r.n=5),
  'The attempt and authorization retain the original approver while the continuation audits the current executor');
select is((select count(*) from public.refund_nayax_provider_stage_journal j
  join continuation_reservations r on (r.result#>>'{attempt,attemptId}')::uuid=j.nayax_refund_attempt_id
  where r.n=5 and j.stage='request'),2::bigint,
  'Manager handoff creates no second request journal event');
select is(pg_temp.continue_attempt(5,2,'ca000000-0000-4000-8000-000000000002')#>>'{attempt,shouldExecute}',
  'false','A handoff replay cannot obtain a second continuation claim');

select throws_ok($$update public.refund_nayax_provider_business_outcomes set business_status='Changed'$$,
  'P0001',null,'Business outcomes are immutable');
select throws_ok($$update public.refund_nayax_provider_response_diagnostics set result_text='Changed'$$,
  'P0001',null,'Independent response diagnostics are immutable');
select throws_ok($$insert into public.refund_nayax_provider_response_diagnostics(
  provider_stage_journal_id,nayax_refund_attempt_id,stage,result_text,result_disposition,
  result_length_bucket,status_text,status_disposition,status_length_bucket)
  select j.id,j.nayax_refund_attempt_id,j.stage,'safe'||chr(133)||'unsafe','exact','1_80',
    'Review','exact','1_80'
  from public.refund_nayax_provider_stage_journal j
  where j.event='result' limit 1$$,'P4633',null,
  'Database guards reject storage-unsafe control text even from privileged direct inserts');
select throws_ok($$insert into public.refund_nayax_provider_business_outcomes(
  provider_stage_journal_id,nayax_refund_attempt_id,stage,business_result,business_status,business_pair_retained)
  select j.id,j.nayax_refund_attempt_id,j.stage,'Alice','TopSecret',true
  from public.refund_nayax_provider_stage_journal j
  where j.event='result' and j.semantic_pair_matched is false limit 1$$,'P4628',null,
  'Unreviewed alphabetic names and secrets cannot enter the diagnostic record');

select * from finish();
rollback;
