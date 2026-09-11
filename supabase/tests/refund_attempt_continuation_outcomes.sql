begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
\ir fixtures/refund_transaction_authority.inc
select pg_temp.refund_reset_authority_markers();
select plan(136);
select ok(
  array_length(pg_temp.refund_authority_marker_names(), 1) = 10
    and pg_temp.refund_authority_markers_match('{}'::text[]),
  'Continuation and recovery fixtures begin with the enumerated authority markers cleared'
);
select diag(pg_temp.refund_authority_marker_diagnostic('{}'::text[])::text)
where not pg_temp.refund_authority_markers_match('{}'::text[]);

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
  'CONTINUATION-MACHINE','CONTINUATION_ACCOUNT',true,2500);
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
  matched_nayax_transaction_id,matched_nayax_amount_cents,matched_nayax_card_last4,
  matched_nayax_currency_code,
  matched_nayax_machine_auth_time,matched_nayax_site_id,nayax_recommendation_state,
  nayax_recommendation_policy_version,nayax_match_execution_eligible,nayax_refund_execution_status,
  intake_source)
select ('ca500000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'RF-CONTINUE-'||n,
  'ca300000-0000-4000-8000-000000000001','ca200000-0000-4000-8000-000000000001',
  'fixture-'||n||'@example.test','Synthetic continuation fixture',
  case when n=7 then '2026-08-26T18:17:09.810Z'::timestamptz
    else now()-(n||' days')::interval end,
  'card',800,800,'4242','needs_review','matched','nayax',1,'approved',(823456780+n)::text,
  800,'4242','USD','2026-08-26T18:17:09.810Z',6,'high_confidence','2026-07-21.v1',true,'not_requested',
  'form'
from generate_series(1,7) n;
create function pg_temp.recovery_candidate_evidence(p_case_id uuid)
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'selection_allowed',true,'is_recommended',true,'one_click_eligible',false,
    'recommendation_state','high_confidence','confidence_class','evidence_aware_review',
    'policy_version','2026-09-05.v11',
    'identifier_policy_version','2026-09-05.identifier.v2',
    'customer_fact_version',c.deterministic_fact_version,
    'customer_credential_class','customer_identifier_unknown',
    'provider_identifier_class','last_sales_identifier_unknown',
    'card_last4_comparison','exact_support','card_network_comparison','missing',
    'payment_interaction_comparison','unknown','same_identifier_equivalence_proven',false,
    'identifier_review_state','exact_support','customer_correction_fields','[]'::jsonb,
    'hard_exclusions','[]'::jsonb,
    'reason_codes','["customer_request_time_unknown"]'::jsonb
  ) || jsonb_build_object(
    'lookup_account_scope','CONTINUATION_ACCOUNT',
    'lookup_provider_machine_id','CONTINUATION-MACHINE',
    'provider_machine_id','CONTINUATION-MACHINE',
    'machine_authorization_time_raw','2026-08-26T13:17:09.810',
    'machine_authorization_at',c.matched_nayax_machine_auth_time,
    'machine_authorization_time_source','MachineAuthorizationTime',
    'machine_time_resolution','exact','provider_time_resolution','exact',
    'provider_time_source','authorization_gmt',
    'authorized_at',c.matched_nayax_machine_auth_time,
    'customer_request_received_at','null'::jsonb,
    'customer_request_received_source','null'::jsonb,
    'request_time_boundary','request_time_unknown',
    'transaction_occurrence_comparable',false,
    'transaction_occurrence_semantics','unknown',
    'transaction_occurrence_proof_source','null'::jsonb,
    'transaction_occurrence_timestamp_source','null'::jsonb,
    'transaction_occurrence_timezone_basis','null'::jsonb,
    'transaction_occurrence_lower_bound_at','null'::jsonb,
    'transaction_occurrence_upper_bound_at','null'::jsonb,
    'request_receipt_lower_bound_at','null'::jsonb,
    'request_receipt_upper_bound_at','null'::jsonb,
    'amount_delta_cents',0,'time_delta_minutes','null'::jsonb,
    'provider_processing_time_delta_minutes',ceil(abs(extract(epoch from
      (c.matched_nayax_machine_auth_time-c.incident_at)))/60.0)::integer,
    'payment_status','approved','payment_status_evidence','last_sales_contract',
    'provider_refund_state','clear','duplicate_provider_record',false,
    'card_last4','4242','currency_code','USD','amount_cents',800,
    'provider_payload_redacted',true
  ) from public.refund_cases c where c.id=p_case_id;
$$;
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
  case when c.id='ca500000-0000-4000-8000-000000000007'::uuid then
    pg_temp.recovery_candidate_evidence(c.id)
  else jsonb_build_object('machine_authorization_time_raw',
    case when c.id='ca500000-0000-4000-8000-000000000001'::uuid
      then '2026-08-26T13:17:09.810' else '2026-08-26T13:17:08.123' end,
    'machine_authorization_time_source','MachineAuthorizationTime',
    'machine_time_resolution',case when c.id='ca500000-0000-4000-8000-000000000001'::uuid
      then 'exact' else 'unknown' end)
    ||jsonb_build_object('lookup_account_scope','CONTINUATION_ACCOUNT',
      'lookup_provider_machine_id','CONTINUATION-MACHINE','provider_machine_id','CONTINUATION-MACHINE') end,
  now()+interval '1 hour'
from public.refund_cases c where c.id::text like 'ca500000-%';

-- Case 7 models the production path: one ordinary authenticated approval
-- durably selects the exact purchase before the provider worker reserves it.
create temp table recovery_candidate as
select token from public.refund_nayax_lookup_candidates
where refund_case_id='ca500000-0000-4000-8000-000000000007';
create temp table recovery_approval_receipt(authorization_id uuid primary key);
grant select on recovery_candidate to authenticated,service_role;
grant select,insert on recovery_approval_receipt to authenticated,service_role;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','ca000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims',
  '{"sub":"ca000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"ca010000-0000-4000-8000-000000000001","is_anonymous":false}',true);
set local role authenticated;
insert into recovery_approval_receipt(authorization_id)
select (public.admin_authorize_refund_official_action(
  'ca500000-0000-4000-8000-000000000007','approve',
  (select official_action_version from public.refund_cases
    where id='ca500000-0000-4000-8000-000000000007'),
  'card_refund_pending','approved',null,'customer_owed',null,800,null,null,false,
  (select token from recovery_candidate),
  'customer_confirmation'
)->>'authorizationId')::uuid;
reset role;
select set_config('request.jwt.claim.role','service_role',true);
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select public.service_apply_refund_nayax_selection_approval(
  (select authorization_id from recovery_approval_receipt),
  'ca500000-0000-4000-8000-000000000007',null,'customer_owed',null,800,
  (select token from recovery_candidate),
  'customer_confirmation');
reset role;

create temp table continuation_reservations(n integer primary key, expected_version bigint, result jsonb);
insert into continuation_reservations
select n,(context->>'caseVersion')::bigint,
  case when n=1 then public.service_reserve_nayax_refund_manager_action_v4('continuation-executor',
    'ca000000-0000-4000-8000-000000000001',
    ('ca500000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
    (context->>'caseVersion')::bigint,'nayax-refund-'||repeat(n::text,64),800,null,null,'USD',
    'nayax-production-account-contract-v2','nayax-provider-journal-v3',context->>'contextHash',
    'source_with_bound_offset')
  when n in (4,6,7) then public.service_reserve_nayax_refund_manager_action_v5('continuation-executor',
    'ca000000-0000-4000-8000-000000000001',
    ('ca500000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
    (context->>'caseVersion')::bigint,'nayax-refund-'||repeat(n::text,64),800,null,null,'USD',
    'nayax-production-account-contract-v2','nayax-provider-journal-v3',context->>'contextHash',
    'exact_source','empty_string')
  else public.service_reserve_nayax_refund_manager_action_v3('continuation-executor',
    'ca000000-0000-4000-8000-000000000001',
    ('ca500000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
    (context->>'caseVersion')::bigint,'nayax-refund-'||repeat(n::text,64),800,null,null,'USD',
    'nayax-production-account-contract-v2','nayax-provider-journal-v3',context->>'contextHash') end
from generate_series(1,7) n
cross join lateral (
  select case when n=1 then public.service_get_refund_nayax_execution_context_v2('continuation-executor',
    'ca000000-0000-4000-8000-000000000001',
    ('ca500000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'source_with_bound_offset')
  when n in (4,6,7) then public.service_get_refund_nayax_execution_context_v3('continuation-executor',
    'ca000000-0000-4000-8000-000000000001',
    ('ca500000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'exact_source','empty_string')
  else public.service_get_refund_nayax_execution_context('continuation-executor',
    'ca000000-0000-4000-8000-000000000001',
    ('ca500000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid) end as context
) execution;

select ok((select authz.expected_case_version=reservation.expected_version
    and refund_case.official_action_version=authz.expected_case_version+1
    and (saved.context->>'machineAuthorizationTimeInstant')::timestamptz=
      refund_case.matched_nayax_machine_auth_time
    and saved.context->>'machineAuthorizationTimeSerializationMode'='exact_source'
    and saved.context->>'refundEmailListMode'='empty_string'
  from continuation_reservations reservation
  join public.refund_case_nayax_refund_attempts attempt
    on attempt.id=(reservation.result#>>'{attempt,attemptId}')::uuid
  join public.refund_case_official_action_authorizations authz
    on authz.id=attempt.official_action_authorization_id
  join public.refund_nayax_execution_contexts saved on saved.attempt_id=attempt.id
  join public.refund_cases refund_case on refund_case.id=attempt.refund_case_id
  where reservation.n=7),
  'Recovery fixture preserves durable preapproval context and one execution version advance');

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
select ok(not has_table_privilege('service_role',
  'public.refund_nayax_server_approval_continuation_claims','select')
  and not has_table_privilege('authenticated',
  'public.refund_nayax_server_approval_continuation_claims','select')
  and not has_table_privilege('anon',
  'public.refund_nayax_server_approval_continuation_claims','select'),
  'Server continuation audit claims are private even from direct service reads');
select ok(has_function_privilege('service_role',
  'public.service_claim_due_nayax_approval_continuations_v1(text,text,integer)','execute')
  and not has_function_privilege('authenticated',
  'public.service_claim_due_nayax_approval_continuations_v1(text,text,integer)','execute')
  and not has_function_privilege('anon',
  'public.service_claim_due_nayax_approval_continuations_v1(text,text,integer)','execute'),
  'Only the assertion-protected service worker can claim due continuations');
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

insert into public.refund_gmail_intake_contacts(
  id,mailbox_hash,provider_thread_id,customer_email,thread_subject,
  first_message_at,latest_message_at,retention_expires_at,status
) values (
  'ca600000-0000-4000-8000-000000000004',repeat('4',64),
  'server-continuation-blocked-review','fixture-4@example.test',
  'Synthetic ambiguous existing-case link',now(),now(),now()+interval '30 days',
  'link_review'
);
insert into public.refund_gmail_intake_contact_messages(
  id,contact_id,provider_message_id,direction,status,sender_email,
  participant_role,participant_trust,subject,plain_body,received_at,
  retention_expires_at
) values (
  'ca610000-0000-4000-8000-000000000004',
  'ca600000-0000-4000-8000-000000000004','blocked-review-message',
  'inbound','received','fixture-4@example.test','customer','verified',
  'Synthetic ambiguous existing-case link','Synthetic redacted fixture',now(),
  now()+interval '30 days'
);
insert into public.refund_gmail_case_link_reviews(
  id,contact_id,source_message_id,status,match_basis,candidate_count
) values (
  'ca620000-0000-4000-8000-000000000004',
  'ca600000-0000-4000-8000-000000000004',
  'ca610000-0000-4000-8000-000000000004','pending',
  'normalized_sender_recent_open_cases',1
);
insert into public.refund_gmail_case_link_review_candidates(
  review_id,refund_case_id,evidence
) values (
  'ca620000-0000-4000-8000-000000000004',
  'ca500000-0000-4000-8000-000000000004',
  '{"payloadRedacted":true}'::jsonb
);
set local role service_role;
select set_config('test.server_continuation_blocked_review',
  public.service_claim_due_nayax_approval_continuations_v1(
    'continuation-executor','CONTINUATION_ACCOUNT',1)::text,true);
reset role;
select ok(current_setting('test.server_continuation_blocked_review')::jsonb
    ->>'claimedCount'='0'
  and not exists (
    select 1
    from public.refund_nayax_attempt_approval_continuations continuation
    join continuation_reservations reservation
      on (reservation.result#>>'{attempt,attemptId}')::uuid =
        continuation.nayax_refund_attempt_id
    where reservation.n=4
  ),
  'A pending Gmail case-link review blocks authority before any immutable claim');
update public.refund_gmail_case_link_reviews
set status='resolved',
    primary_refund_case_id='ca500000-0000-4000-8000-000000000004',
    resolution_reason='primary_with_related_cases',
    resolved_by='ca000000-0000-4000-8000-000000000001',
    resolved_at=now()
where id='ca620000-0000-4000-8000-000000000004';
set local role service_role;
select set_config('test.server_continuation_claim',
  public.service_claim_due_nayax_approval_continuations_v1(
    'continuation-executor','CONTINUATION_ACCOUNT',1)::text,true);
reset role;
select is(current_setting('test.server_continuation_claim')::jsonb->>'claimedCount','1',
  'A later sweep restarts the expired, already-authorized attempt without a browser');
select is(current_setting('test.server_continuation_claim')::jsonb
    #>>'{claims,0,attempt,executionPlan}','approval_continuation',
  'The service restart receives approval-only execution and cannot repeat request');
select is((select count(*) from public.refund_nayax_provider_stage_journal j
  join continuation_reservations r
    on (r.result#>>'{attempt,attemptId}')::uuid=j.nayax_refund_attempt_id
  where r.n=4 and j.stage='request'),2::bigint,
  'Service claiming preserves the one existing request start/result pair');
select ok((select claim.official_action_authorization_id=
      attempt.official_action_authorization_id
    and claim.execution_context_hash=frozen.context->>'contextHash'
  from continuation_reservations reservation
  join public.refund_case_nayax_refund_attempts attempt
    on attempt.id=(reservation.result#>>'{attempt,attemptId}')::uuid
  join public.refund_nayax_execution_contexts frozen on frozen.attempt_id=attempt.id
  join public.refund_nayax_server_approval_continuation_claims claim
    on claim.nayax_refund_attempt_id=attempt.id
  where reservation.n=4),
  'Claim binds the existing approval and exact immutable execution context');
set local role service_role;
select set_config('test.server_continuation_second_worker',
  public.service_claim_due_nayax_approval_continuations_v1(
    'continuation-executor','CONTINUATION_ACCOUNT',1)::text,true);
reset role;
select is(current_setting('test.server_continuation_second_worker')::jsonb
    ->>'claimedCount','0',
  'A coalesced second worker cannot claim the same attempt');
select throws_ok($$update public.refund_nayax_server_approval_continuation_claims
  set current_manager_mapping_version=current_manager_mapping_version+1$$,
  'P0001',null,'Server continuation claim evidence is immutable');
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
grant select on recovery_reservation to service_role;
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
  card_last4,card_wallet_used,'needs_review','manual_review','approved',
  false,'not_requested','form'
from public.refund_cases where id='ca500000-0000-4000-8000-000000000007';

select ok(not has_function_privilege('authenticated',
  'public.service_recover_proved_nayax_api_success_with_duplicate(uuid,uuid,uuid)','execute')
  and has_function_privilege('service_role',
  'public.service_recover_proved_nayax_api_success_with_duplicate(uuid,uuid,uuid)','execute'),
  'Only service role can invoke journal-proved settlement recovery');
select is((select status from public.refund_case_reconciliation_reviews
  where 'ca500000-0000-4000-8000-000000000107' in
    (left_refund_case_id,right_refund_case_id)), 'pending',
  'A same-source possible duplicate receives an ordinary pending manager review');
select throws_ok($$insert into public.sales_adjustment_facts(
  reporting_machine_id,reporting_location_id,adjustment_date,adjustment_type,
  amount_cents,complaint_count,source,source_row_hash,source_reference,
  source_row_reference,refund_case_id,match_status,match_confidence,notes,raw_payload
) select reporting_machine_id,reporting_location_id,incident_at::date,'refund',
  payment_amount_cents,1,'google_sheets','recovery-null-case-fingerprint',
  'synthetic-sheet','synthetic-row',null,'applied',1,'Synthetic unresolved duplicate',
  jsonb_build_object('incident_date',incident_at::date,'payment_method',payment_method)
from public.refund_cases where id='ca500000-0000-4000-8000-000000000007'$$,
  '23505',null,
  'A null-case adjustment still fails closed against an unresolved business fingerprint');

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
    where refund_case_id='ca500000-0000-4000-8000-000000000007')
  and not exists(select 1 from public.refund_receipt_completion_intents
    where refund_case_id='ca500000-0000-4000-8000-000000000007'),
  'A refused recovery rolls back without adjustment or customer-message intent');

select set_config('test.recovery_review_id',(
  select id::text from public.refund_case_reconciliation_reviews
  where 'ca500000-0000-4000-8000-000000000107' in
    (left_refund_case_id,right_refund_case_id)
),true);
select set_config('test.recovery_attempt_id',
  (select result#>>'{attempt,attemptId}' from recovery_reservation),true);
create temp table recovery_case_before_forgeries as
select to_jsonb(refund_case) value from public.refund_cases refund_case
where id='ca500000-0000-4000-8000-000000000007';
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','ca000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims',
  '{"sub":"ca000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"ca010000-0000-4000-8000-000000000001","is_anonymous":false}',true);
set local role authenticated;
select lives_ok($$select public.admin_resolve_refund_case_reconciliation(
  current_setting('test.recovery_review_id')::uuid,
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
-- Simulate trusted state advancing between approval and recovery. The DO block
-- rolls the owner-only fixture mutation back with the expected recovery error.
select throws_ok($cmd$do $stale$
begin
  update public.refund_cases set correlation_summary=coalesce(correlation_summary,'')||' stale-version-fixture'
  where id='ca500000-0000-4000-8000-000000000007';
  perform public.service_recover_proved_nayax_api_success_with_duplicate(
    'ca500000-0000-4000-8000-000000000007',
    (select (result#>>'{attempt,attemptId}')::uuid from recovery_reservation),
    'ca500000-0000-4000-8000-000000000107');
  raise exception 'stale recovery unexpectedly succeeded';
end $stale$$cmd$,'P4674',null,
  'Recovery rejects a stale official-action version and rolls its test mutation back');
set local role service_role;
select throws_ok($cmd$do $forged$
begin
  perform set_config('bloomjoy.nayax_journal_recovery_attempt_id',
    current_setting('test.recovery_attempt_id'),true);
  perform set_config('bloomjoy.nayax_journal_recovery_duplicate_id',
    'ca500000-0000-4000-8000-000000000107',true);
  update public.refund_cases set status='completed',
    manual_refund_reference='nayax-evidence-'||repeat('f',64),
    refund_completed_by='ca000000-0000-4000-8000-000000000001',
    refund_completed_at=statement_timestamp(),automation_state='completed',
    nayax_refund_execution_status='approved'
  where id='ca500000-0000-4000-8000-000000000007';
end $forged$$cmd$,'42501',null,
  'Service role cannot turn forged recovery settings into a direct case transition');
select throws_ok($$select public.service_recover_proved_nayax_api_success_with_duplicate(
  'ca500000-0000-4000-8000-000000000007',
  (select (result#>>'{attempt,attemptId}')::uuid from recovery_reservation),
  'ca500000-0000-4000-8000-000000000006')$$,
  'P4674',null,'Recovery rejects a different sibling binding');
reset role;
select ok((select to_jsonb(refund_case) from public.refund_cases refund_case
      where id='ca500000-0000-4000-8000-000000000007')
      is not distinct from (select value from recovery_case_before_forgeries)
    and not exists(select 1 from public.sales_adjustment_facts
      where refund_case_id='ca500000-0000-4000-8000-000000000007')
    and not exists(select 1 from public.refund_case_messages
      where refund_case_id='ca500000-0000-4000-8000-000000000007'),
  'Rejected stale, forged, and wrong-sibling recovery attempts leave the case unchanged');

update public.refund_customer_contact_settings
set automatic_customer_contact_enabled=true
where singleton;

-- Emit every nullable input row used by the two strict recovery predicates in
-- one hosted run. This diagnostic is synthetic fixture data inside rollback.
select diag((
  with target as (
    select 'ca500000-0000-4000-8000-000000000007'::uuid canonical_id,
      'ca500000-0000-4000-8000-000000000107'::uuid duplicate_id,
      current_setting('test.recovery_attempt_id')::uuid attempt_id
  ), inputs as (
    select canonical, duplicate, attempt, authz, intent, saved, machine
    from target
    join public.refund_cases canonical on canonical.id=target.canonical_id
    left join public.refund_cases duplicate on duplicate.id=target.duplicate_id
    left join public.refund_case_nayax_refund_attempts attempt on attempt.id=target.attempt_id
    left join public.refund_case_official_action_authorizations authz
      on authz.id=attempt.official_action_authorization_id
    left join public.refund_manager_action_step_up_intents intent
      on intent.id=attempt.step_up_intent_id
    left join public.refund_nayax_execution_contexts saved on saved.attempt_id=attempt.id
    left join public.reporting_machines machine on machine.id=canonical.reporting_machine_id
  )
  select jsonb_pretty(jsonb_build_object(
    'journalProved',public.refund_nayax_unsettled_api_success_journal_proved(
      target.canonical_id,target.attempt_id),
    'duplicateProved',public.refund_nayax_unsettled_api_success_duplicate_proved(
      target.canonical_id,target.attempt_id,target.duplicate_id),
    'crossFormatHashesEqual',(inputs.saved).context->>'contextHash'=
      (inputs.authz).nayax_execution_evidence_hash,
    'failedChecks',coalesce((select jsonb_agg(jsonb_build_object(
        'check',check_row.name,'passed',check_row.passed) order by check_row.name)
      from (values
        ('journal.casePopulation',(inputs.canonical).case_population='customer'),
        ('journal.paymentMethod',(inputs.canonical).payment_method='card'),
        ('journal.decision',(inputs.canonical).decision='approved'),
        ('journal.executionMode',(inputs.attempt).execution_mode='request_and_approve'),
        ('journal.actor', (inputs.attempt).actor_user_id=(inputs.authz).actor_user_id),
        ('journal.amountRefund',(inputs.attempt).amount_cents=(inputs.canonical).refund_amount_cents),
        ('journal.amountMatch',(inputs.attempt).amount_cents=(inputs.canonical).matched_nayax_amount_cents),
        ('journal.currency',(inputs.attempt).currency_code='USD' and
          (inputs.attempt).currency_code=(inputs.canonical).matched_nayax_currency_code),
        ('journal.idempotency',(inputs.attempt).idempotency_key~'^nayax-refund-[a-f0-9]{64}$'),
        ('journal.fingerprint',(inputs.attempt).request_fingerprint=
          public.refund_nayax_attempt_request_fingerprint((inputs.authz).id,
            (inputs.canonical).id,(inputs.attempt).idempotency_key,
            (inputs.attempt).amount_cents,(inputs.attempt).currency_code,
            (inputs.authz).nayax_execution_evidence_hash)),
        ('journal.authStatus',(inputs.authz).status='consumed'),
        ('journal.authConsumedAt',(inputs.authz).consumed_at is not null),
        ('journal.authAction',(inputs.authz).action='nayax_execute'),
        ('journal.authCase',(inputs.authz).refund_case_id=(inputs.canonical).id),
        ('journal.authTotp',(inputs.authz).verified_totp_at is not null),
        ('journal.authHash',(inputs.authz).nayax_execution_evidence_hash~'^[a-f0-9]{64}$'),
        ('journal.intentStatus',(inputs.intent).status='consumed'),
        ('journal.intentAction',(inputs.intent).action='nayax_execute'),
        ('journal.intentTarget',(inputs.intent).target_function='nayax-card-refund'),
        ('journal.intentCase',(inputs.intent).refund_case_id=(inputs.canonical).id),
        ('journal.intentActor',(inputs.intent).actor_user_id=(inputs.authz).actor_user_id),
        ('journal.intentTotp',(inputs.intent).verified_totp_at=(inputs.authz).verified_totp_at),
        ('journal.intentHash',(inputs.intent).nayax_execution_evidence_hash=
          (inputs.authz).nayax_execution_evidence_hash),
        ('journal.contextCase',((inputs.saved).context->>'caseId')::uuid=(inputs.canonical).id),
        ('journal.contextMachine',((inputs.saved).context->>'reportingMachineId')::uuid=(inputs.machine).id),
        ('journal.contextVersion',(inputs.authz).expected_case_version=
          ((inputs.saved).context->>'caseVersion')::bigint),
        ('journal.contextHashSelf',(inputs.saved).context->>'contextHash'=
          encode(extensions.digest(convert_to(
            ((inputs.saved).context-'contextHash')::text,'UTF8'),'sha256'),'hex')),
        ('journal.contextCurrentContract',(inputs.saved).context->>'machineAuthorizationTimeSerializationMode'='exact_source'
          and (inputs.saved).context->>'machineAuthorizationTimeSerializationSource'='exact_source'
          and (inputs.saved).context->>'refundEmailListMode'='empty_string'
          and (inputs.saved).context->>'machineAuthorizationTimeWire'=
            (inputs.saved).context->>'machineAuthorizationTime'),
        ('journal.contextGeneration',((inputs.saved).context->>'attemptGeneration')::integer=
          (inputs.canonical).nayax_refund_attempt_generation),
        ('journal.contextAccount',(inputs.saved).context->>'accountScope'=(inputs.machine).nayax_account_key),
        ('journal.contextProviderMachine',(inputs.saved).context->>'providerMachineId'=(inputs.machine).nayax_machine_id),
        ('journal.contextTransaction',(inputs.saved).context->>'transactionId'=
          (inputs.canonical).matched_nayax_transaction_id),
        ('journal.contextSite',((inputs.saved).context->>'siteId')::integer=
          (inputs.canonical).matched_nayax_site_id),
        ('journal.contextAmount',((inputs.saved).context->>'originalAmountCents')::integer=
          (inputs.attempt).amount_cents),
        ('journal.contextCurrency',(inputs.saved).context->>'currencyCode'=(inputs.attempt).currency_code),
        ('journal.contextLast4',(inputs.saved).context->>'cardLast4'=
          (inputs.canonical).matched_nayax_card_last4),
        ('journal.contextInstant',((inputs.saved).context->>'machineAuthorizationTimeInstant')::timestamptz=
          (inputs.canonical).matched_nayax_machine_auth_time),
        ('journal.requestResultCount',(select count(*)=1
          from public.refund_nayax_provider_stage_journal journal
          where journal.nayax_refund_attempt_id=target.attempt_id
            and journal.pending_approval_recovery_id is null
            and journal.stage='request' and journal.event='result')),
        ('journal.approveResultCount',(select count(*)=1
          from public.refund_nayax_provider_stage_journal journal
          where journal.nayax_refund_attempt_id=target.attempt_id
            and journal.pending_approval_recovery_id is null
            and journal.stage='approve' and journal.event='result')),
        ('journal.pendingRecoveryAbsent',not exists(select 1
          from public.refund_nayax_provider_stage_journal journal
          where journal.nayax_refund_attempt_id=target.attempt_id
            and journal.pending_approval_recovery_id is not null)),
        ('journal.requestResult',(select bool_and(journal.http_status=200 and journal.http_accepted
            and journal.outcome='accepted' and journal.contract_matched and journal.approval_authorized
            and journal.schema_matched and journal.semantic_pair_matched
            and journal.journal_contract_version='nayax-provider-journal-v3'
            and journal.provider_contract_version='nayax-production-account-contract-v2')
          from public.refund_nayax_provider_stage_journal journal
          where journal.nayax_refund_attempt_id=target.attempt_id
            and journal.pending_approval_recovery_id is null
            and journal.stage='request' and journal.event='result')),
        ('journal.approveResult',(select bool_and(journal.http_status=200 and journal.http_accepted
            and journal.outcome='succeeded' and journal.contract_matched
            and journal.schema_matched and journal.semantic_pair_matched
            and journal.journal_contract_version='nayax-provider-journal-v3'
            and journal.provider_contract_version='nayax-production-account-contract-v2')
          from public.refund_nayax_provider_stage_journal journal
          where journal.nayax_refund_attempt_id=target.attempt_id
            and journal.pending_approval_recovery_id is null
            and journal.stage='approve' and journal.event='result')),
        ('journal.outcomes',(select count(*)=2 and bool_and(outcome.business_pair_retained
            and outcome.observed_scalar_pair_retained
            and outcome.business_result='Refund status updated successfully, but the email could not be sent'
            and outcome.business_status='Partial success'
            and outcome.observed_result_scalar=outcome.business_result
            and outcome.observed_status_scalar=outcome.business_status)
          from public.refund_nayax_provider_business_outcomes outcome
          where outcome.nayax_refund_attempt_id=target.attempt_id)),
        ('journal.stageOrder',(select min(journal.created_at) filter(where journal.stage='request')
            < min(journal.created_at) filter(where journal.stage='approve')
          from public.refund_nayax_provider_stage_journal journal
          where journal.nayax_refund_attempt_id=target.attempt_id and journal.event='result')),
        ('journal.noOtherAttempt',not exists(select 1
          from public.refund_case_nayax_refund_attempts other_attempt
          where other_attempt.refund_case_id=target.canonical_id
            and other_attempt.id<>target.attempt_id
            and (other_attempt.status in ('in_progress','requested','approved','succeeded')
              or other_attempt.provider_outcome='success'))),
        ('duplicate.canonicalStatus',(inputs.canonical).status in ('approved','card_refund_pending')),
        ('duplicate.canonicalExecution',(inputs.canonical).nayax_refund_execution_status='requested'),
        ('duplicate.canonicalVersion',(inputs.canonical).official_action_version=
          (inputs.authz).expected_case_version+1),
        ('duplicate.canonicalEligibility',not (inputs.canonical).nayax_match_execution_eligible),
        ('duplicate.canonicalUntouched',(inputs.canonical).refund_completed_at is null
          and (inputs.canonical).reporting_adjustment_id is null
          and (inputs.canonical).manual_refund_reference is null
          and (inputs.canonical).duplicate_of_refund_case_id is null),
        ('duplicate.attemptState',(inputs.attempt).status='in_progress'
          and (inputs.attempt).provider_outcome is null
          and (inputs.attempt).provider_outcome_recorded_at is null
          and (inputs.attempt).provider_claim_consumed_at is null
          and (inputs.attempt).reconciliation_required
          and (inputs.attempt).safe_transport_stage='approval_result'),
        ('duplicate.attemptUntouched',(inputs.attempt).provider_status is null
          and (inputs.attempt).provider_reference is null
          and (inputs.attempt).error_code is null
          and (inputs.attempt).reporting_adjustment_id is null
          and (inputs.attempt).case_finalization_committed_at is null
          and (inputs.attempt).completed_at is null
          and (inputs.attempt).completion_message_id is null
          and (inputs.attempt).completion_gmail_thread_id is null
          and (inputs.attempt).completion_delivery_status='not_claimed'),
        ('duplicate.populationSource',(inputs.duplicate).id<>(inputs.canonical).id
          and (inputs.duplicate).case_population='customer'
          and (inputs.duplicate).intake_source=(inputs.canonical).intake_source),
        ('duplicate.state',(inputs.duplicate).status in ('submitted','needs_review','correlated')
          and (inputs.duplicate).decision is null
          and (inputs.duplicate).duplicate_of_refund_case_id=(inputs.canonical).id),
        ('duplicate.untouched',(inputs.duplicate).refund_completed_at is null
          and (inputs.duplicate).reporting_adjustment_id is null
          and (inputs.duplicate).manual_refund_reference is null
          and (inputs.duplicate).nayax_refund_execution_status='not_requested'
          and not (inputs.duplicate).nayax_match_execution_eligible
          and (inputs.duplicate).matched_nayax_transaction_id is null
          and (inputs.duplicate).matched_nayax_site_id is null
          and (inputs.duplicate).matched_nayax_amount_cents is null
          and (inputs.duplicate).matched_nayax_currency_code is null),
        ('duplicate.fingerprint',(inputs.duplicate).refund_business_fingerprint is not null
          and (inputs.duplicate).refund_business_fingerprint=(inputs.canonical).refund_business_fingerprint),
        ('duplicate.email',lower(btrim((inputs.duplicate).customer_email))=
          lower(btrim((inputs.canonical).customer_email))),
        ('duplicate.machine',(inputs.duplicate).reporting_machine_id=(inputs.canonical).reporting_machine_id),
        ('duplicate.location',(inputs.duplicate).reporting_location_id=(inputs.canonical).reporting_location_id),
        ('duplicate.incident',(inputs.duplicate).incident_at=(inputs.canonical).incident_at),
        ('duplicate.payment',(inputs.duplicate).payment_method=(inputs.canonical).payment_method
          and (inputs.duplicate).payment_amount_cents=(inputs.canonical).payment_amount_cents),
        ('duplicate.last4',(inputs.duplicate).card_last4=(inputs.canonical).card_last4),
        ('duplicate.network',(inputs.duplicate).card_network is not distinct from (inputs.canonical).card_network),
        ('duplicate.walletUsed',(inputs.duplicate).card_wallet_used=(inputs.canonical).card_wallet_used),
        ('duplicate.walletProvider',(inputs.duplicate).wallet_provider is not distinct from
          (inputs.canonical).wallet_provider),
        ('duplicate.walletDevice',(inputs.duplicate).wallet_device_kind is not distinct from
          (inputs.canonical).wallet_device_kind),
        ('duplicate.interaction',(inputs.duplicate).payment_interaction is not distinct from
          (inputs.canonical).payment_interaction),
        ('duplicate.issue',(inputs.duplicate).issue_category is not distinct from
          (inputs.canonical).issue_category),
        ('duplicate.review',exists(select 1 from public.refund_case_reconciliation_reviews review
          where review.left_refund_case_id=least(target.canonical_id,target.duplicate_id)
            and review.right_refund_case_id=greatest(target.canonical_id,target.duplicate_id)
            and review.status='confirmed_duplicate' and review.canonical_refund_case_id=target.canonical_id
            and review.resolution_reason_code='same_incident' and review.resolved_at is not null
            and review.resolved_by=(inputs.duplicate).duplicate_marked_by)),
        ('duplicate.noOfficialAction',not public.refund_case_has_official_action(target.duplicate_id)),
        ('duplicate.noAttempt',not exists(select 1 from public.refund_case_nayax_refund_attempts a
          where a.refund_case_id=target.duplicate_id)),
        ('duplicate.noReceipt',not exists(select 1 from public.refund_authoritative_receipts r
          where r.refund_case_id in (target.canonical_id,target.duplicate_id))),
        ('duplicate.noAdjustment',not exists(select 1 from public.sales_adjustment_facts a
          where a.refund_case_id in (target.canonical_id,target.duplicate_id))),
        ('duplicate.noMessage',not exists(select 1 from public.refund_case_messages m
          where m.refund_case_id in (target.canonical_id,target.duplicate_id))),
        ('duplicate.noAuthorization',not exists(select 1
          from public.refund_case_official_action_authorizations a
          where a.refund_case_id=target.duplicate_id))
      ) check_row(name,passed)
      where check_row.passed is distinct from true),'[]'::jsonb),
    'canonical',to_jsonb(inputs.canonical),
    'duplicate',to_jsonb(inputs.duplicate),
    'attempt',to_jsonb(inputs.attempt),
    'authorization',to_jsonb(inputs.authz),
    'stepUpIntent',to_jsonb(inputs.intent),
    'savedContext',to_jsonb(inputs.saved),
    'machine',to_jsonb(inputs.machine),
    'stageJournals',coalesce((select jsonb_agg(to_jsonb(journal)
        order by journal.created_at,journal.id)
      from public.refund_nayax_provider_stage_journal journal
      where journal.nayax_refund_attempt_id=target.attempt_id),'[]'::jsonb),
    'businessOutcomes',coalesce((select jsonb_agg(to_jsonb(outcome)
        order by outcome.created_at,outcome.provider_stage_journal_id)
      from public.refund_nayax_provider_business_outcomes outcome
      where outcome.nayax_refund_attempt_id=target.attempt_id),'[]'::jsonb),
    'reviews',coalesce((select jsonb_agg(to_jsonb(review) order by review.created_at,review.id)
      from public.refund_case_reconciliation_reviews review
      where target.canonical_id in (review.left_refund_case_id,review.right_refund_case_id)
        and target.duplicate_id in (review.left_refund_case_id,review.right_refund_case_id)),
      '[]'::jsonb),
    'counts',jsonb_build_object(
      'otherCanonicalAttempts',(select count(*) from public.refund_case_nayax_refund_attempts other_attempt
        where other_attempt.refund_case_id=target.canonical_id and other_attempt.id<>target.attempt_id),
      'duplicateAttempts',(select count(*) from public.refund_case_nayax_refund_attempts duplicate_attempt
        where duplicate_attempt.refund_case_id=target.duplicate_id),
      'receipts',(select count(*) from public.refund_authoritative_receipts receipt
        where receipt.refund_case_id in (target.canonical_id,target.duplicate_id)),
      'adjustments',(select count(*) from public.sales_adjustment_facts adjustment
        where adjustment.refund_case_id in (target.canonical_id,target.duplicate_id)),
      'messages',(select count(*) from public.refund_case_messages message
        where message.refund_case_id in (target.canonical_id,target.duplicate_id)),
      'duplicateAuthorizations',(select count(*)
        from public.refund_case_official_action_authorizations duplicate_authz
        where duplicate_authz.refund_case_id=target.duplicate_id),
      'duplicateOfficialActions',public.refund_case_has_official_action(target.duplicate_id)
    )
  ))
  from target cross join inputs
)::text);

select throws_ok($cmd$do $changed_context$
begin
  alter table public.refund_nayax_execution_contexts
    disable trigger refund_nayax_execution_context_immutable;
  update public.refund_nayax_execution_contexts
  set context=jsonb_set(context,'{machineAuthorizationTimeWire}',to_jsonb('changed'::text))
  where attempt_id=current_setting('test.recovery_attempt_id')::uuid;
  perform public.service_recover_proved_nayax_api_success_with_duplicate(
    'ca500000-0000-4000-8000-000000000007',
    current_setting('test.recovery_attempt_id')::uuid,
    'ca500000-0000-4000-8000-000000000107');
end $changed_context$$cmd$,'P4674',null,
  'Recovery rejects a changed saved request context and rolls the mutation back');
select throws_ok($cmd$do $changed_context_hash$
begin
  alter table public.refund_nayax_execution_contexts
    disable trigger refund_nayax_execution_context_immutable;
  update public.refund_nayax_execution_contexts
  set context=jsonb_set(context,'{contextHash}',to_jsonb(repeat('0',64)))
  where attempt_id=current_setting('test.recovery_attempt_id')::uuid;
  perform public.service_recover_proved_nayax_api_success_with_duplicate(
    'ca500000-0000-4000-8000-000000000007',
    current_setting('test.recovery_attempt_id')::uuid,
    'ca500000-0000-4000-8000-000000000107');
end $changed_context_hash$$cmd$,'P4674',null,
  'Recovery rejects a changed saved request-context hash and rolls the mutation back');
select ok(
  (select trigger_row.tgenabled = 'O'
   from pg_trigger trigger_row
   where trigger_row.tgrelid = 'public.refund_nayax_execution_contexts'::regclass
     and trigger_row.tgname = 'refund_nayax_execution_context_immutable'),
  'The corruption-only immutable-context trigger disable is rolled back and restored before later scenarios'
);
select throws_ok($cmd$do $broken_authorization_intent$
begin
  update public.refund_manager_action_step_up_intents intent
  set nayax_execution_evidence_hash=repeat('0',64)
  from public.refund_case_nayax_refund_attempts attempt
  where attempt.id=current_setting('test.recovery_attempt_id')::uuid
    and intent.id=attempt.step_up_intent_id;
  perform public.service_recover_proved_nayax_api_success_with_duplicate(
    'ca500000-0000-4000-8000-000000000007',
    current_setting('test.recovery_attempt_id')::uuid,
    'ca500000-0000-4000-8000-000000000107');
end $broken_authorization_intent$$cmd$,'P4674',null,
  'Recovery rejects a broken authorization-to-intent evidence chain and rolls the mutation back');
select throws_ok($cmd$do $malformed_recovery_adjustment$
begin
  perform set_config('bloomjoy.nayax_journal_recovery_attempt_id',
    current_setting('test.recovery_attempt_id'),true);
  perform set_config('bloomjoy.nayax_journal_recovery_duplicate_id',
    'ca500000-0000-4000-8000-000000000107',true);
  insert into public.sales_adjustment_facts(
    reporting_machine_id,reporting_location_id,adjustment_date,
    adjustment_type,amount_cents,complaint_count,source,source_row_hash,
    source_reference,source_row_reference,refund_case_id,match_status,
    match_confidence,notes,raw_payload)
  select c.reporting_machine_id,c.reporting_location_id,
    (journal.created_at at time zone 'America/Los_Angeles')::date,
    'refund',attempt.amount_cents+1,1,'refund_case',c.id::text,
    'refund_cases',c.public_reference,c.id,'applied',
    greatest(c.correlation_confidence,0.01),
    'Bloomjoy refund case '||c.public_reference,
    jsonb_build_object(
      'refund_case_id',c.id,'refund_case_reference',c.public_reference,
      'refund_case_status','completed','refund_case_decision','approved',
      'payment_method',c.payment_method,'correlation_source',c.correlation_source,
      'correlation_has_card_lookup',true,'nayax_provider_attempt_id',attempt.id,
      'provider_reference_present',true,'api_provider_approved_at',journal.created_at,
      'accounting_date_meaning','provider_approval_response_date_not_bank_settlement',
      'payload_redacted',true)
  from public.refund_cases c
  join public.refund_case_nayax_refund_attempts attempt
    on attempt.refund_case_id=c.id
    and attempt.id=current_setting('test.recovery_attempt_id')::uuid
  join public.refund_nayax_provider_stage_journal journal
    on journal.nayax_refund_attempt_id=attempt.id
    and journal.stage='approve' and journal.event='result'
    and journal.pending_approval_recovery_id is null
  where c.id='ca500000-0000-4000-8000-000000000007';
end $malformed_recovery_adjustment$$cmd$,'23514',null,
  'Recovery adjustment admission rejects a row whose amount differs from the proved provider attempt');

-- The production case transition reaches its guards on both sides of the
-- lifecycle revision trigger. PostgreSQL runs same-kind triggers by name, so
-- assert the installed order instead of recreating or disabling production
-- guards in the fixture.
select ok(
  (select array_agg(trigger_row.tgname order by trigger_row.tgname) = array[
      'aa_refund_receipt_case_effect_guard',
      'refund_cases_active_nayax_attempt_guard',
      'refund_cases_bump_lifecycle_revision',
      'refund_cases_guard_provider_hold_decisions'
    ]::name[]
    and bool_and(trigger_row.tgenabled = 'O')
   from pg_trigger trigger_row
   where trigger_row.tgrelid = 'public.refund_cases'::regclass
     and trigger_row.tgname = any(array[
       'aa_refund_receipt_case_effect_guard',
       'refund_cases_active_nayax_attempt_guard',
       'refund_cases_bump_lifecycle_revision',
       'refund_cases_guard_provider_hold_decisions'
     ]::name[]))
  and not exists (
    select 1 from pg_constraint constraint_row
    where constraint_row.conrelid in (
      'public.refund_cases'::regclass,
      'public.refund_case_nayax_refund_attempts'::regclass,
      'public.refund_nayax_execution_contexts'::regclass
    ) and not constraint_row.convalidated
  ),
  'Recovery runs with the production pre-lifecycle/post-lifecycle trigger order and validated constraints'
);
create temporary table journal_recovery_marker_snapshots(markers text[]);
grant insert on journal_recovery_marker_snapshots to service_role;
create function pg_temp.mutate_journal_recovery_case_after_lifecycle()
returns trigger language plpgsql as $$
begin
  if new.id='ca500000-0000-4000-8000-000000000007'::uuid
    and new.status='completed' then
    if current_setting('test.journal_recovery_case_mutation',true)='lifecycle_plus_two' then
      new.lifecycle_revision := old.lifecycle_revision + 2;
    elsif current_setting('test.journal_recovery_case_mutation',true)='unrelated_field' then
      new.issue_summary := old.issue_summary || ' changed';
    elsif current_setting('test.journal_recovery_case_mutation',true)='capture_markers' then
      insert into journal_recovery_marker_snapshots(markers)
      values(pg_temp.refund_active_authority_markers());
    end if;
  end if;
  return new;
end;
$$;
create trigger refund_cases_c_test_journal_recovery_mutation
before update on public.refund_cases
for each row execute function pg_temp.mutate_journal_recovery_case_after_lifecycle();

select pg_temp.refund_reset_authority_markers();
select set_config('request.jwt.claim.role','service_role',true);
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select set_config('test.journal_recovery_case_mutation','lifecycle_plus_two',true);
select throws_ok($$select public.service_recover_proved_nayax_api_success_with_duplicate(
  'ca500000-0000-4000-8000-000000000007',
  (select (result#>>'{attempt,attemptId}')::uuid from recovery_reservation),
  'ca500000-0000-4000-8000-000000000107')$$,'P0001',null,
  'Recovery rejects a lifecycle revision advance beyond the one trigger-owned increment');
select set_config('test.journal_recovery_case_mutation','unrelated_field',true);
select throws_ok($$select public.service_recover_proved_nayax_api_success_with_duplicate(
  'ca500000-0000-4000-8000-000000000007',
  (select (result#>>'{attempt,attemptId}')::uuid from recovery_reservation),
  'ca500000-0000-4000-8000-000000000107')$$,'P0001',null,
  'Recovery rejects an unrelated case-field mutation at the post-lifecycle guard');
select set_config('test.journal_recovery_case_mutation','',true);
reset role;

create function pg_temp.reject_recovery_notice_preparation()
returns trigger language plpgsql as $$
begin
  raise exception 'synthetic_notice_preparation_failure';
end;
$$;
create trigger reject_recovery_notice_preparation
before insert on public.refund_receipt_completion_automation_authorities
for each row execute function pg_temp.reject_recovery_notice_preparation();

select pg_temp.refund_reset_authority_markers();
select ok(
  pg_temp.refund_authority_markers_match('{}'::text[]),
  'Journal recovery coverage starts without an inherited transition bypass'
);
select diag(pg_temp.refund_authority_marker_diagnostic('{}'::text[])::text)
where not pg_temp.refund_authority_markers_match('{}'::text[]);

select set_config('request.jwt.claim.role','service_role',true);
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select set_config('test.journal_recovery_case_mutation','capture_markers',true);
select set_config('test.journal_recovery',
  public.service_recover_proved_nayax_api_success_with_duplicate(
    'ca500000-0000-4000-8000-000000000007',
    (select (result#>>'{attempt,attemptId}')::uuid from recovery_reservation),
    'ca500000-0000-4000-8000-000000000107')::text,true);
select set_config('test.journal_recovery_case_mutation','',true);
reset role;
select ok(
  (select count(*)>0 and bool_and(markers=array[
    'bloomjoy.nayax_journal_recovery_attempt_id',
    'bloomjoy.nayax_journal_recovery_duplicate_id'
  ]::text[]) from journal_recovery_marker_snapshots),
  'Legitimate journal recovery exposes only its exact internal authority markers during the protected update'
);
select diag(jsonb_build_object(
  'expected',array[
      'bloomjoy.nayax_journal_recovery_attempt_id',
      'bloomjoy.nayax_journal_recovery_duplicate_id'
    ]::text[],
  'snapshots',coalesce((select jsonb_agg(markers) from journal_recovery_marker_snapshots),'[]'::jsonb)
)::text)
where not (select count(*)>0 and bool_and(markers=array[
  'bloomjoy.nayax_journal_recovery_attempt_id',
  'bloomjoy.nayax_journal_recovery_duplicate_id'
]::text[]) from journal_recovery_marker_snapshots);
select ok(current_setting('test.journal_recovery')::jsonb @>
    '{"recovered":true,"replayed":false,"providerCallMade":false,"customerMessageSent":false,"completionMessageStatus":"notice_deferred","completionNoticeDeferred":true}'::jsonb
  and not exists(select 1 from public.refund_case_messages
    where refund_case_id='ca500000-0000-4000-8000-000000000007')
  and not exists(select 1 from public.refund_receipt_completion_intents
    where refund_case_id='ca500000-0000-4000-8000-000000000007'),
  'A notice-preparation failure is deferred without rolling back payment truth or creating partial intent state');
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
select is((select count(*) from public.refund_nayax_provider_stage_journal
    where nayax_refund_attempt_id=(select (result#>>'{attempt,attemptId}')::uuid
      from recovery_reservation)),4::bigint,
  'Provider-free recovery preserves the exact two-stage journal without another call');
drop trigger reject_recovery_notice_preparation
  on public.refund_receipt_completion_automation_authorities;
set local role service_role;
select set_config('test.form_completion_claim',
  public.service_claim_nayax_refund_completion(
    'continuation-executor',
    (select (result#>>'{attempt,attemptId}')::uuid from recovery_reservation)
  )::text,true);
reset role;
select ok(current_setting('test.form_completion_claim')::jsonb @>
    '{"claimed":true,"status":"queued","transport":"transactional_email","originalThread":false,"noticeDeferred":false,"payloadRedacted":true}'::jsonb,
  'The normal form completion path can queue the exact receipt notice after deferred preparation');
select ok((select count(*)=1 and bool_and(status='pending')
      and bool_and(template_version='refund_receipt_completion_v1')
      and bool_and(delivery_kind='automatic')
      and bool_and(manual_delivery_state='queued')
      and bool_and(nayax_refund_attempt_id is null)
      and bool_and(public.is_refund_receipt_completion_message(to_jsonb(refund_case_messages)))
    from public.refund_case_messages
    where refund_case_id='ca500000-0000-4000-8000-000000000007')
  and (select completion_gmail_thread_id is null and completion_message_id is null
    from public.refund_case_nayax_refund_attempts
    where id=(select (result#>>'{attempt,attemptId}')::uuid from recovery_reservation))
  and not exists(select 1 from public.refund_gmail_threads
    where refund_case_id='ca500000-0000-4000-8000-000000000007')
  and not exists(select 1 from public.refund_gmail_messages
    where refund_case_id='ca500000-0000-4000-8000-000000000007')
  and (select count(*)=1 from public.refund_receipt_completion_intents intent
    join public.refund_authoritative_receipts receipt on receipt.id=intent.receipt_id
    join public.refund_receipt_completion_automation_authorities authority
      on authority.id=intent.automation_authority_id
    where intent.refund_case_id='ca500000-0000-4000-8000-000000000007'
      and not intent.reviewed_no_existing_notice
      and authority.source_kind='nayax_api_terminal'
      and authority.source_event_digest=receipt.evidence_reference_digest),
  'Exactly one API-receipt authority binds the automatic form completion outbox intent');
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
set local role service_role;
select is((select count(*) from public.service_claim_refund_manual_message_deliveries(
    current_setting('test.journal_recovery_message_id')::uuid,1)),1::bigint,
  'The automatic form completion receives one atomic initial-send outbox claim');
select is((select count(*) from public.service_claim_refund_manual_message_deliveries(
    current_setting('test.journal_recovery_message_id')::uuid,1)),0::bigint,
  'A concurrent initial sender cannot claim the same form completion again');
reset role;

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
set local role service_role;
select set_config('test.server_handoff_claim',
  public.service_claim_due_nayax_approval_continuations_v1(
    'continuation-executor','CONTINUATION_ACCOUNT',1)::text,true);
reset role;
select is(current_setting('test.server_handoff_claim')::jsonb->>'claimedCount','1',
  'Service continuation survives a manager handoff on the unchanged machine');
select ok((select claim.current_manager_mapping_id=
      'ca400000-0000-4000-8000-000000000002'::uuid
    and claim.official_action_authorization_id=attempt.official_action_authorization_id
    and attempt.actor_user_id='ca000000-0000-4000-8000-000000000001'::uuid
  from continuation_reservations reservation
  join public.refund_case_nayax_refund_attempts attempt
    on attempt.id=(reservation.result#>>'{attempt,attemptId}')::uuid
  join public.refund_nayax_server_approval_continuation_claims claim
    on claim.nayax_refund_attempt_id=attempt.id
  where reservation.n=6),
  'Handoff freezes the current mapping while retaining the original approver');
select ok(current_setting('test.server_handoff_claim')::jsonb
    #>>'{claims,0,executionContext,transactionId}'='823456786'
  and current_setting('test.server_handoff_claim')::jsonb
    #>>'{claims,0,executionContext,originalAmountCents}'='800'
  and current_setting('test.server_handoff_claim')::jsonb
    #>>'{claims,0,accountKey}'='CONTINUATION_ACCOUNT',
  'Handoff claim returns only the frozen exact transaction, amount, and account');
set local role service_role;
select lives_ok($$select public.service_record_nayax_refund_provider_stage_v4_diagnostics(
  'continuation-executor',
  (current_setting('test.server_handoff_claim')::jsonb
    #>>'{claims,0,attempt,attemptId}')::uuid,
  current_setting('test.server_handoff_claim')::jsonb
    #>>'{claims,0,providerClaimToken}',
  'approve','started',null,null,null,null,repeat('6',64),
  'nayax-production-account-contract-v2','nayax-provider-journal-v3',
  null,null,null,null,null,null,null,null,null,null,null,null,null,null,false,
  null,null,false,null,null,null,null,null,null)$$,
  'A reassigned server claim reaches the approval journal before any provider call');
reset role;
select ok((select attempt.actor_user_id=
      'ca000000-0000-4000-8000-000000000001'::uuid
    and continuation.actor_user_id=
      'ca000000-0000-4000-8000-000000000002'::uuid
    and count(journal.id)=1
  from continuation_reservations reservation
  join public.refund_case_nayax_refund_attempts attempt
    on attempt.id=(reservation.result#>>'{attempt,attemptId}')::uuid
  join public.refund_nayax_attempt_approval_continuations continuation
    on continuation.nayax_refund_attempt_id=attempt.id
  left join public.refund_nayax_provider_stage_journal journal
    on journal.nayax_refund_attempt_id=attempt.id
    and journal.stage='approve' and journal.event='started'
  where reservation.n=6
  group by attempt.actor_user_id,continuation.actor_user_id),
  'Handoff execution preserves the original audit actor and journals the current executor');
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
