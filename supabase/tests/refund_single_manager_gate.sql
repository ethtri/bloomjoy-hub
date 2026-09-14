begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select plan(28);

create function pg_temp.set_actor(p_user_id uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub',p_user_id::text,true);
  perform set_config('request.jwt.claim.role','authenticated',true);
  perform set_config('request.jwt.claims',jsonb_build_object(
    'sub',p_user_id,'role','authenticated','is_anonymous',false)::text,true);
end $$;
create function pg_temp.capture_error(statement text) returns text language plpgsql as $$
begin execute statement; return null; exception when others then return sqlstate||':'||sqlerrm; end $$;

insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data) values
('a3410000-0000-4000-8000-000000000001','authenticated','authenticated','triage@example.invalid','{}','{}'),
('a3410000-0000-4000-8000-000000000002','authenticated','authenticated','manager-b@example.invalid','{}','{}'),
('a3410000-0000-4000-8000-000000000003','authenticated','authenticated','manager-c@example.invalid','{}','{}');
insert into public.customer_accounts(id,name,account_type)
values('a3420000-0000-4000-8000-000000000001','Single gate fixture','internal');
insert into public.reporting_locations(id,account_id,name,timezone)
values('a3430000-0000-4000-8000-000000000001','a3420000-0000-4000-8000-000000000001','Single gate location','America/Los_Angeles');
insert into public.reporting_machines(id,account_id,location_id,machine_label,status,
  nayax_machine_id,nayax_account_key,nayax_refunds_enabled)
values('a3440000-0000-4000-8000-000000000001','a3420000-0000-4000-8000-000000000001',
  'a3430000-0000-4000-8000-000000000001','Single gate machine','active',
  'SINGLE-GATE-MACHINE','SINGLE_GATE_ACCOUNT',true);
insert into public.refund_nayax_machine_inventory(account_key,nayax_machine_id,reporting_machine_id)
values('SINGLE_GATE_ACCOUNT','SINGLE-GATE-MACHINE','a3440000-0000-4000-8000-000000000001');
insert into public.reporting_machine_refund_managers(id,reporting_machine_id,manager_user_id,manager_email,grant_reason)
values('a3450000-0000-4000-8000-000000000001','a3440000-0000-4000-8000-000000000001',
  'a3410000-0000-4000-8000-000000000002','manager-b@example.invalid','Fixture');
insert into public.admin_scoped_access_grants(id,user_id,grant_reason)
values('a3460000-0000-4000-8000-000000000001','a3410000-0000-4000-8000-000000000001','Triage fixture');
insert into public.admin_scoped_access_scopes(grant_id,scope_type,machine_id,grant_reason)
values('a3460000-0000-4000-8000-000000000001','machine','a3440000-0000-4000-8000-000000000001','Triage fixture');
insert into public.refund_nayax_provider_callers(caller_id,assertion_digest,status)
values('nayax-card-refund',encode(extensions.digest(convert_to('single-gate-executor','UTF8'),'sha256'),'hex'),'active')
on conflict(caller_id) do update set assertion_digest=excluded.assertion_digest,status='active';

insert into public.refund_cases(id,public_reference,reporting_machine_id,reporting_location_id,
  customer_email,issue_summary,incident_at,incident_timezone,incident_time_resolution,
  incident_time_confidence,payment_method,payment_amount_cents,refund_amount_cents,
  card_last4,card_last4_provenance,payment_interaction,status,correlation_status,
  deterministic_fact_version,intake_source,intake_meta,nayax_lookup_generation,
  nayax_lookup_status,nayax_refund_execution_status)
values('a3470000-0000-4000-8000-000000000001','RF-SINGLE-GATE',
  'a3440000-0000-4000-8000-000000000001','a3430000-0000-4000-8000-000000000001',
  'customer@example.invalid','Exact saved sale','2026-09-12T20:00:00Z','America/Los_Angeles',
  'exact','exact','card',1000,1090,'4242','physical_card','tap_card','needs_review',
  'needs_nayax',1,'form','{}',1,'manual_exception','not_requested');

create function pg_temp.exact_evidence(p_source text default 'nayax_api') returns jsonb language sql stable as $$
select jsonb_build_object(
 'source',p_source,'selection_allowed',true,'is_recommended',true,'one_click_eligible',false,
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
 'lookup_account_scope','SINGLE_GATE_ACCOUNT','lookup_provider_machine_id','SINGLE-GATE-MACHINE',
 'provider_machine_id','SINGLE-GATE-MACHINE','machine_authorization_time_raw','2026-09-12T20:00:00Z',
 'machine_authorization_at','2026-09-12T20:00:00Z','machine_authorization_time_source','MachineAuthorizationTime',
 'machine_time_resolution','exact','provider_time_resolution','exact','provider_time_source','authorization_gmt',
 'authorized_at','2026-09-12T20:00:00Z','request_time_boundary','request_time_unknown',
 'transaction_occurrence_comparable',false,'transaction_occurrence_semantics','unknown',
 'amount_delta_cents',90,'provider_processing_time_delta_minutes',0,'payment_status','approved',
 'payment_status_evidence','last_sales_contract','provider_refund_state','clear',
 'duplicate_provider_record',false,'card_last4','4242','currency_code','USD','amount_cents',1090)
$$;
insert into public.refund_nayax_lookup_candidates(token,refund_case_id,lookup_generation,actor_user_id,
  reporting_machine_id,provider_transaction_id,site_id,machine_authorization_time,amount_cents,
  card_last4,currency_code,evidence_summary,expires_at)
values('a3480000-0000-4000-8000-000000000001','a3470000-0000-4000-8000-000000000001',1,
  'a3410000-0000-4000-8000-000000000001','a3440000-0000-4000-8000-000000000001',
  'RF423906B2-SALE',17,'2026-09-12T20:00:00Z',1090,'4242','USD',pg_temp.exact_evidence(),now()+interval '1 hour');

select pg_temp.set_actor('a3410000-0000-4000-8000-000000000001');
select is((public.admin_select_refund_nayax_candidate_current_user_v1(
  'a3470000-0000-4000-8000-000000000001',
  (select official_action_version from public.refund_cases where id='a3470000-0000-4000-8000-000000000001'),
  'a3480000-0000-4000-8000-000000000001',null)->>'selectionApplied'),'true',
  'triage actor A can save exact evidence with case-work access');
select ok((select matched_nayax_transaction_id='RF423906B2-SALE' and matched_nayax_amount_cents=1090
  from public.refund_cases where id='a3470000-0000-4000-8000-000000000001'),
  'RF-423906B2 keeps the exact $10.90 provider sale');
select is((select actor_user_id from public.refund_case_events where refund_case_id='a3470000-0000-4000-8000-000000000001'
  and event_type='nayax_match_selected' order by created_at desc limit 1),
  'a3410000-0000-4000-8000-000000000001'::uuid,'selection audit retains triage actor A');

select pg_temp.set_actor('a3410000-0000-4000-8000-000000000002');
create temp table approval_result as select public.admin_approve_selected_nayax_refund_for_system_v1(
  'a3470000-0000-4000-8000-000000000001',
  (select official_action_version from public.refund_cases where id='a3470000-0000-4000-8000-000000000001')) result;
select ok((select z.actor_user_id='a3410000-0000-4000-8000-000000000002' and z.status='consumed'
  from public.refund_case_official_action_authorizations z where z.id=(select (result->>'authorizationId')::uuid from approval_result)),
  'manager B is the sole financial approver');
select ok((select a.actor_user_id is null and a.status='created' and a.official_action_authorization_id is not null
  from public.refund_case_nayax_refund_attempts a where a.id=(select (result->>'attemptId')::uuid from approval_result)),
  'approval creates one System-owned queued attempt');
select like(pg_temp.capture_error(format('select public.admin_approve_selected_nayax_refund_for_system_v1(%L,%s)',
  'a3470000-0000-4000-8000-000000000001',
  (select official_action_version from public.refund_cases where id='a3470000-0000-4000-8000-000000000001'))),
  'P4620:%','double approval loses without another attempt');
select is((select count(*) from public.refund_case_nayax_refund_attempts where refund_case_id='a3470000-0000-4000-8000-000000000001'),1::bigint,
  'sequential duplicate approval leaves one attempt; the unique queue index is the cross-session arbiter');

update public.reporting_machine_refund_managers set status='revoked',revoked_at=now()
where id='a3450000-0000-4000-8000-000000000001';
insert into public.reporting_machine_refund_managers(reporting_machine_id,manager_user_id,manager_email,grant_reason)
values('a3440000-0000-4000-8000-000000000001','a3410000-0000-4000-8000-000000000003','manager-c@example.invalid','Reassignment fixture');
select pg_temp.set_actor('a3410000-0000-4000-8000-000000000003');
select is((public.admin_get_refund_nayax_resolution_readiness('a3470000-0000-4000-8000-000000000001')->>'visible'),'true',
  'manager reassignment preserves case status visibility after approval');

create temp table first_claim as select public.service_claim_due_nayax_refund_attempts_v1(
  'single-gate-executor','SINGLE_GATE_ACCOUNT','exact_source','empty_string',1) result;
select is((select result#>>'{claims,0,attemptId}' from first_claim),
  (select result->>'attemptId' from approval_result),'claim exposes the exact attempt id at the minimal root envelope');
update public.refund_case_nayax_refund_attempts set provider_claim_expires_at=now()-interval '1 second'
where id=(select (result->>'attemptId')::uuid from approval_result);
select is((public.service_reclaim_nayax_refund_attempt_no_call_v1('single-gate-executor','SINGLE_GATE_ACCOUNT')->>'reclaimed'),'true',
  'expired no-start claim resets the same row and generation');
select ok((select status='created' and provider_claim_digest is null from public.refund_case_nayax_refund_attempts
  where id=(select (result->>'attemptId')::uuid from approval_result)),'no-start reclaim keeps the same created row');

create temp table second_claim as select public.service_claim_due_nayax_refund_attempts_v1(
  'single-gate-executor','SINGLE_GATE_ACCOUNT','exact_source','empty_string',1) result;
select public.service_record_nayax_refund_provider_stage_v4_diagnostics(
  p_executor_assertion=>'single-gate-executor',
  p_attempt_id=>(select (result->>'attemptId')::uuid from approval_result),
  p_provider_claim_token=>(select result#>>'{claims,0,providerClaimToken}' from second_claim),
  p_stage=>'request',p_event=>'started',p_http_status=>null,p_outcome=>null,
  p_contract_matched=>null,p_failure_type=>null,p_classification_digest=>repeat('a',64),
  p_provider_contract_version=>'nayax-production-account-contract-v2',
  p_journal_contract_version=>'nayax-provider-journal-v3',p_http_accepted=>null,
  p_media_type_class=>null,p_body_kind=>null,p_body_length_bucket=>null,
  p_json_parsed=>null,p_json_object=>null,p_schema_matched=>null,
  p_result_key_present=>null,p_status_key_present=>null,p_result_value_type=>null,
  p_status_value_type=>null,p_semantic_pair_matched=>null,p_business_result=>null,
  p_business_status=>null,p_business_pair_retained=>false,p_observed_result_scalar=>null,
  p_observed_status_scalar=>null,p_observed_scalar_pair_retained=>false,
  p_result_diagnostic_text=>null,p_result_diagnostic_disposition=>null,
  p_result_diagnostic_length_bucket=>null,p_status_diagnostic_text=>null,
  p_status_diagnostic_disposition=>null,p_status_diagnostic_length_bucket=>null);
select like(pg_temp.capture_error(format($sql$select public.service_settle_nayax_refund_attempt(
  'single-gate-executor',%L,%L,%L,%L,1090,'USD','wrong-claim-token','success',
  'SINGLE-GATE-SUCCESS-1','approve_succeeded_contract_match',null)$sql$,
  (select result->>'attemptId' from approval_result),(select result->>'authorizationId' from approval_result),
  'a3470000-0000-4000-8000-000000000001',
  (select idempotency_key from public.refund_case_nayax_refund_attempts
    where id=(select (result->>'attemptId')::uuid from approval_result)))),
  'P4620:%','wrong provider claim token cannot settle the attempt');
select is((select status from public.refund_case_nayax_refund_attempts
  where id=(select (result->>'attemptId')::uuid from approval_result)),'in_progress',
  'wrong settlement claim leaves the exact attempt unsettled');
update public.refund_case_nayax_refund_attempts set provider_claim_expires_at=now()-interval '1 second'
where id=(select (result->>'attemptId')::uuid from approval_result);
select is((public.service_reclaim_nayax_refund_attempt_no_call_v1('single-gate-executor','SINGLE_GATE_ACCOUNT')->>'held'),'true',
  'expired provider-started claim becomes a permanent hold');
select ok((select status='manual_review' and provider_outcome='unknown' and reconciliation_required
  from public.refund_case_nayax_refund_attempts where id=(select (result->>'attemptId')::uuid from approval_result)),
  'started claim remains the same manual-review unknown row');
select is(jsonb_array_length(public.service_claim_due_nayax_refund_attempts_v1(
  'single-gate-executor','SINGLE_GATE_ACCOUNT','exact_source','empty_string',1)->'claims'),0,
  'permanent unknown cannot be claimed again');

select is((public.service_settle_nayax_refund_attempt(
  'single-gate-executor',(select (result->>'attemptId')::uuid from approval_result),
  (select (result->>'authorizationId')::uuid from approval_result),
  'a3470000-0000-4000-8000-000000000001',
  (select idempotency_key from public.refund_case_nayax_refund_attempts where id=(select (result->>'attemptId')::uuid from approval_result)),
  1090,'USD','captured-outcome-replay-token','unknown',null,null,null)->>'alreadySettled'),'true',
  'captured unknown settlement replays against the same held attempt');
select is((select count(*) from public.sales_adjustment_facts where refund_case_id='a3470000-0000-4000-8000-000000000001'),0::bigint,
  'settlement replay creates no duplicate adjustment');
select is((public.service_hold_nayax_refund_attempt_v1('single-gate-executor',
  (select (result->>'attemptId')::uuid from approval_result),'settlement_failure')->>'alreadyHeld'),'true',
  'settlement-failure hold is idempotent on the same attempt');

select is((public.admin_record_nayax_system_outcome_evidence_v1(
  'a3470000-0000-4000-8000-000000000001',(select (result->>'attemptId')::uuid from approval_result),
  'remain_on_hold','nayax_dtm_transaction','DTM:NAYAX-123456789',now(),'evidence_incomplete',
  (select official_action_version from public.refund_cases where id='a3470000-0000-4000-8000-000000000001'))->>'status'),
  'provider_hold','valid evidence remains on the same permanent hold');
select ok((select metadata->>'evidence_reference_digest'~'^[a-f0-9]{64}$'
  and metadata->>'reason_code'='evidence_incomplete' from public.refund_case_events
  where refund_case_id='a3470000-0000-4000-8000-000000000001'
    and event_type='nayax_system_outcome_evidence_recorded' order by created_at desc limit 1),
  'hold evidence stores its privacy-safe type, digest, time, and reason');
select like(pg_temp.capture_error($sql$select public.admin_record_nayax_system_outcome_evidence_v1(
  'a3470000-0000-4000-8000-000000000001',(select (result->>'attemptId')::uuid from approval_result),
  'provider_confirmed_success','nayax_dtm_transaction','DTM:NAYAX-123456789',now(),
  'nayax_support_confirmed_success',(select official_action_version from public.refund_cases where id='a3470000-0000-4000-8000-000000000001'))$sql$),
  'P4661:%','mismatched evidence tuple is rejected');
select is((public.admin_record_nayax_system_outcome_evidence_v1(
  'a3470000-0000-4000-8000-000000000001',(select (result->>'attemptId')::uuid from approval_result),
  'provider_confirmed_success','nayax_dtm_transaction','DTM:NAYAX-123456789',now(),
  'nayax_dtm_settled',(select official_action_version from public.refund_cases
    where id='a3470000-0000-4000-8000-000000000001'))->>'resolved'),'true',
  'valid provider-confirmed success evidence finalizes the same held attempt');
select ok((select count(*)=1 from public.refund_nayax_outcome_resolutions
    where refund_case_id='a3470000-0000-4000-8000-000000000001')
  and (select count(*)=1 from public.sales_adjustment_facts
    where refund_case_id='a3470000-0000-4000-8000-000000000001')
  and (select count(*)=1 from public.refund_case_messages
    where refund_case_id='a3470000-0000-4000-8000-000000000001' and message_type='completed')
  and (select count(*)=1 from public.refund_case_nayax_refund_attempts
    where refund_case_id='a3470000-0000-4000-8000-000000000001')
  and (select count(*)=1 from public.refund_nayax_provider_stage_journal
    where nayax_refund_attempt_id=(select (result->>'attemptId')::uuid from approval_result)),
  'success evidence creates one resolution, adjustment, completion and message with no new attempt or provider call');

insert into public.refund_nayax_lookup_candidates(token,refund_case_id,lookup_generation,actor_user_id,
  reporting_machine_id,provider_transaction_id,site_id,machine_authorization_time,amount_cents,
  card_last4,currency_code,evidence_summary,expires_at)
values('a3480000-0000-4000-8000-000000000002','a3470000-0000-4000-8000-000000000001',1,
  'a3410000-0000-4000-8000-000000000003','a3440000-0000-4000-8000-000000000001',
  'MANUAL-HISTORICAL',17,'2026-09-12T20:00:00Z',1090,'4242','USD',pg_temp.exact_evidence('manual_nayax_portal'),now()+interval '1 hour');
select like(pg_temp.capture_error(format('select public.admin_select_refund_nayax_candidate_current_user_v1(%L,%s,%L,null)',
  'a3470000-0000-4000-8000-000000000001',(select official_action_version from public.refund_cases where id='a3470000-0000-4000-8000-000000000001'),
  'a3480000-0000-4000-8000-000000000002')),'P4626:%','manual candidate source is rejected');

select ok(not exists(
  select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  cross join (values('anon'),('authenticated'),('service_role')) denied(role_name)
  where n.nspname='public' and p.proname=any(array[
    'admin_prepare_refund_action_step_up_intent','admin_get_refund_action_step_up_intent',
    'admin_cancel_refund_action_step_up_intent','admin_consume_refund_action_step_up_intent',
    'admin_refund_manager_step_up_factor_is_approved',
    'open_refund_manager_totp_enrollment_window_current_user',
    'close_refund_manager_totp_enrollment_window_current_user',
    'get_refund_manager_totp_enrollment_readiness_current_user',
    'can_enroll_refund_manager_totp_current_user',
    'service_mark_refund_manager_step_up_factor_verified',
    'service_mark_refund_nayax_resolution_factor_verified',
    'service_record_refund_manager_totp_enrollment',
    'service_compensate_refund_manager_totp_enrollment',
    'service_reserve_nayax_pending_approval_recovery',
    'service_settle_nayax_pending_approval_recovery',
    'service_claim_due_nayax_approval_continuations_v1',
    'service_reserve_nayax_refund_manager_action',
    'service_reserve_nayax_refund_manager_action_v2',
    'service_reserve_nayax_refund_manager_action_v3',
    'service_reserve_nayax_refund_manager_action_v4',
    'service_reserve_nayax_refund_manager_action_v5',
    'service_reserve_and_consume_nayax_refund_attempt',
    'service_reserve_and_consume_nayax_refund_attempt_v2',
    'service_reserve_nayax_refund_approval_continuation_v1',
    'service_reserve_nayax_refund_approval_continuation_v2',
    'service_recover_stale_nayax_refund_attempts',
    'owner_authorize_refund_nayax_controlled_pilot',
    'owner_cancel_refund_nayax_controlled_pilot',
    'owner_recover_expired_refund_nayax_controlled_pilot',
    'admin_consume_refund_nayax_controlled_pilot_intent',
    'service_validate_nayax_controlled_pilot_postarm',
    'service_record_nayax_controlled_pilot_stage',
    'service_settle_nayax_controlled_pilot_attempt',
    'service_reserve_and_consume_nayax_controlled_pilot_attempt',
    'admin_begin_refund_manual_nayax_portal','admin_create_refund_manual_nayax_candidate',
    'admin_get_refund_manual_nayax_context','admin_prepare_refund_nayax_resolution_intent',
    'admin_consume_refund_nayax_resolution_intent',
    'admin_begin_refund_nayax_evidence_only_reconciliation',
    'admin_resolve_refund_nayax_outcome_manager_session'
  ]) and has_function_privilege(denied.role_name,p.oid,'execute')
) and not has_function_privilege('anon',
    'public.can_perform_refund_official_action(uuid,uuid)','execute')
  and not has_function_privilege('authenticated',
    'public.can_perform_refund_official_action(uuid,uuid)','execute'),
 'all overloads of legacy step-up, TOTP, continuation, pilot, manual writers and arbitrary-user authority deny runtime roles');
select ok(to_regprocedure('public.service_settle_nayax_refund_attempt_legacy_v1(text,uuid,uuid,uuid,text,integer,text,text,text,text,text,text)') is null
  and to_regprocedure('public.can_view_refund_system_finishing_status_v1(uuid,uuid)') is null,
  'parallel settlement and arbitrary-user status artifacts are absent');

select ok(
  has_function_privilege('service_role',
    'public.refund_nayax_approved_card_read_state_v1(uuid)','execute')
  and not has_function_privilege('anon',
    'public.refund_nayax_approved_card_read_state_v1(uuid)','execute')
  and not has_function_privilege('authenticated',
    'public.refund_nayax_approved_card_read_state_v1(uuid)','execute'),
  'approved-card read state is executable only by the service role'
);

select * from finish();
rollback;
