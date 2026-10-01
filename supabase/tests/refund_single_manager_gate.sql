begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select plan(114);

-- Execute the retained nullable producer beside the corrected producer on the
-- same approved-but-not-executed synthetic attempt. No provider is invoked.
do $legacy$
declare definition text;
begin
  definition := pg_get_functiondef(
    'public.refund_lifecycle_contract_pre_authoritative_receipt_v1(uuid)'::regprocedure);
  definition := replace(definition,
    'public.refund_lifecycle_contract_pre_authoritative_receipt_v1(',
    'pg_temp.legacy_lifecycle_operations(');
  definition := replace(definition,
    '''required'', coalesce(operations_required, false),',
    '''required'', operations_required,');
  execute definition;
end;
$legacy$;

create function pg_temp.set_actor(p_user_id uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub',p_user_id::text,true);
  perform set_config('request.jwt.claim.role','authenticated',true);
  perform set_config('request.jwt.claims',jsonb_build_object(
    'sub',p_user_id,'role','authenticated','is_anonymous',false)::text,true);
end $$;
create function pg_temp.capture_error(statement text) returns text language plpgsql as $$
begin execute statement; return null; exception when others then return sqlstate||':'||sqlerrm; end $$;

create function pg_temp.probe_selected_approval(p_case_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  begin
    result:=public.admin_approve_selected_nayax_refund_for_system_v1(p_case_id,
      (select official_action_version from public.refund_cases where id=p_case_id));
    result:=result||jsonb_build_object('decidedBy',
      (select decided_by from public.refund_cases where id=p_case_id));
    result:=result||jsonb_build_object(
      'lifecycle',public.refund_lifecycle_contract(p_case_id),
      'baseLifecycle',public.refund_lifecycle_contract_pre_authoritative_receipt_v1(p_case_id),
      'legacyBaseLifecycle',pg_temp.legacy_lifecycle_operations(p_case_id));
    raise exception 'rollback approval probe' using errcode='P0001';
  exception when sqlstate 'P0001' then return result; end;
end $$;
create function pg_temp.probe_recommendation(p_mutation text,p_case_id uuid)
returns jsonb language plpgsql as $$
declare result jsonb;
begin
  begin
    execute p_mutation;
    result:=public.refund_decision_recommendation_for_case(p_case_id);
    raise exception 'rollback recommendation probe' using errcode='P0001';
  exception when sqlstate 'P0001' then return result; end;
end $$;

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
  'a3410000-0000-4000-8000-000000000002','manager-b@example.invalid','Fixture'),
('a3450000-0000-4000-8000-000000000002','a3440000-0000-4000-8000-000000000001',
  'a3410000-0000-4000-8000-000000000003','manager-c@example.invalid','Fixture');
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
  nayax_lookup_status,nayax_recommendation_state,nayax_refund_execution_status)
values('a3470000-0000-4000-8000-000000000001','RF-SINGLE-GATE',
  'a3440000-0000-4000-8000-000000000001','a3430000-0000-4000-8000-000000000001',
  'customer@example.invalid','Exact saved sale','2026-09-12T20:00:00Z','America/Los_Angeles',
  'exact','exact','card',1000,1090,'4242','physical_card','tap_card','needs_review',
  'needs_nayax',1,'form','{}',1,'manual_exception','manual_exception','not_requested');

create function pg_temp.exact_evidence(p_source text default 'nayax_api') returns jsonb language sql stable as $$
select jsonb_build_object(
 'source',p_source,'selection_allowed',true,'is_recommended',true,'one_click_eligible',false,
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
 'lookup_account_scope','SINGLE_GATE_ACCOUNT','lookup_provider_machine_id','SINGLE-GATE-MACHINE',
 'provider_machine_id','SINGLE-GATE-MACHINE','machine_authorization_time_raw','2026-09-12T20:00:00Z',
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
 'duplicate_provider_record',false,'card_last4','4242','currency_code','USD','amount_cents',1090)
$$;

create function pg_temp.request_bound_evidence(p_source text default 'nayax_api')
returns jsonb language sql stable as $$
select pg_temp.exact_evidence(p_source) || jsonb_build_object(
 'customer_request_received_at','2026-09-12T21:00:00Z',
 'customer_request_received_source','hosted_refund_intake',
 'transaction_occurrence_proof_source','verified_provider_purchase_occurrence_v1',
 'transaction_occurrence_timestamp_source','authorization_gmt',
 'transaction_occurrence_timezone_basis','utc',
 'transaction_occurrence_lower_bound_at','2026-09-12T20:00:00Z',
 'transaction_occurrence_upper_bound_at','2026-09-12T20:00:00Z',
 'request_receipt_lower_bound_at','2026-09-12T21:00:00Z',
 'request_receipt_upper_bound_at','2026-09-12T21:00:00Z',
 'request_time_boundary','before_or_at_request',
 'transaction_occurrence_comparable',true,
 'transaction_occurrence_semantics','online_purchase_occurrence',
 'time_delta_minutes',0
)
$$;

create function pg_temp.commit_lookup_fixture(
  p_case_id uuid,p_token uuid,p_trigger text,p_actor_user_id uuid,
  p_lookup_status text,p_recommendation_state text
) returns jsonb language plpgsql as $$
declare one_click boolean:=p_recommendation_state='high_confidence';
  fixture_amount integer:=1200+right(replace(p_case_id::text,'-',''),2)::integer;
begin
  insert into public.refund_cases(id,public_reference,reporting_machine_id,reporting_location_id,
    customer_email,issue_summary,incident_at,incident_timezone,incident_time_resolution,
    incident_time_confidence,payment_method,payment_amount_cents,refund_amount_cents,card_last4,
    card_last4_provenance,payment_interaction,status,correlation_status,
    deterministic_fact_version,intake_source,intake_meta,nayax_lookup_generation,
    nayax_lookup_status,nayax_refund_execution_status,customer_request_received_at,
    customer_request_received_source)
  values(p_case_id,'RF-'||upper(right(replace(p_case_id::text,'-',''),12)),
    'a3440000-0000-4000-8000-000000000001','a3430000-0000-4000-8000-000000000001',
    right(replace(p_case_id::text,'-',''),12)||'@example.invalid','Lookup route fixture',
    '2026-09-12T20:00:00Z','America/Los_Angeles','exact','exact','card',fixture_amount,fixture_amount,'4242',
    'physical_card','tap_card','needs_review','needs_nayax',1,'form','{}',1,
    'checking','not_requested','2026-09-12T21:00:00Z','hosted_refund_intake');
  insert into public.refund_nayax_lookup_candidates(token,refund_case_id,lookup_generation,
    actor_user_id,reporting_machine_id,provider_transaction_id,site_id,
    machine_authorization_time,amount_cents,card_last4,currency_code,evidence_summary,expires_at)
  values(p_token,p_case_id,1,p_actor_user_id,'a3440000-0000-4000-8000-000000000001',
    'LOOKUP-'||upper(right(replace(p_case_id::text,'-',''),12)),17,
    '2026-09-12T20:00:00Z',fixture_amount,'4242','USD',
    pg_temp.request_bound_evidence()||jsonb_build_object(
      'amount_cents',fixture_amount,'amount_delta_cents',0,
      'one_click_eligible',one_click,'recommendation_state',p_recommendation_state,
      'confidence_class',case when one_click then 'high_confidence' else 'evidence_aware_review' end,
      'policy_version',case when p_trigger='scheduled'
        then '2026-09-13.v12' else '2026-09-05.v11' end,
      'request_time_boundary',case when p_trigger='scheduled'
        then 'occurrence_time_uncertain' else 'before_or_at_request' end,
      'transaction_occurrence_semantics',case when p_trigger='scheduled'
        then 'unknown' else 'online_purchase_occurrence' end,
      'transaction_occurrence_comparable',p_trigger<>'scheduled',
      'time_delta_minutes',case when p_trigger='scheduled' then null else 0 end,
      'transaction_occurrence_proof_source',case when p_trigger='scheduled'
        then null else 'verified_provider_purchase_occurrence_v1' end,
      'transaction_occurrence_timestamp_source',case when p_trigger='scheduled'
        then null else 'authorization_gmt' end,
      'transaction_occurrence_timezone_basis',case when p_trigger='scheduled'
        then null else 'utc' end,
      'transaction_occurrence_lower_bound_at',case when p_trigger='scheduled'
        then null else '2026-09-12T20:00:00Z' end,
      'transaction_occurrence_upper_bound_at',case when p_trigger='scheduled'
        then null else '2026-09-12T20:00:00Z' end,
      'request_receipt_lower_bound_at',case when p_trigger='scheduled'
        then null else '2026-09-12T21:00:00Z' end,
      'request_receipt_upper_bound_at',case when p_trigger='scheduled'
        then null else '2026-09-12T21:00:00Z' end),
    now()+interval '1 hour');
  return public.service_commit_refund_nayax_lookup_and_preselect_v1(
    p_case_id,1,1,p_lookup_status,p_recommendation_state,
    case when p_trigger='scheduled' then '2026-09-13.v12' else '2026-09-05.v11' end,
    statement_timestamp(),'Provider lookup fixture','a3440000-0000-4000-8000-000000000001',
    1,p_trigger,p_actor_user_id,null);
end;
$$;

create temp table pg_temp.lookup_fixture_results(result_key text primary key,result jsonb);
insert into pg_temp.lookup_fixture_results(result_key,result) values
  ('manual-clear',pg_temp.commit_lookup_fixture(
    'a3470000-0000-4000-8000-000000000010','a3480000-0000-4000-8000-000000000010',
    'manual','a3410000-0000-4000-8000-000000000001','match_found','high_confidence'));
select is((select result->>'systemPreselectionApplied' from pg_temp.lookup_fixture_results
    where result_key='manual-clear'),'true',
  'manual clear lookup uses System preselection');
select ok((select actor_user_id is null from public.refund_nayax_lookup_candidates
    where token='a3480000-0000-4000-8000-000000000010'),
  'manual clear candidate becomes System-owned evidence');
select ok(not exists(select 1 from public.refund_case_events
    where refund_case_id='a3470000-0000-4000-8000-000000000010'
      and event_type in ('nayax_lookup_completed','nayax_lookup_diagnostics','nayax_match_preselected')
      and actor_user_id is not null),
  'manual clear lookup records no human transaction choice');
select ok(exists(select 1 from public.refund_case_events
    where refund_case_id='a3470000-0000-4000-8000-000000000010'
      and event_type='nayax_match_preselected' and actor_user_id is null
      and metadata->>'lookup_initiator_user_id'='a3410000-0000-4000-8000-000000000001'),
  'manual clear lookup keeps the initiator only as audit context');

insert into pg_temp.lookup_fixture_results(result_key,result) values
  ('wallet-clear',pg_temp.commit_lookup_fixture(
    'a3470000-0000-4000-8000-000000000011','a3480000-0000-4000-8000-000000000011',
    'wallet_correction',null,'match_found','high_confidence'));
select is((select result->>'systemPreselectionApplied' from pg_temp.lookup_fixture_results
    where result_key='wallet-clear'),'true',
  'wallet correction uses System preselection for one clear match');
select ok((select matched_nayax_transaction_id is not null from public.refund_cases
    where id='a3470000-0000-4000-8000-000000000011'),
  'wallet correction saves the clear provider transaction without a human save');
select is((pg_temp.commit_lookup_fixture(
    'a3470000-0000-4000-8000-000000000012','a3480000-0000-4000-8000-000000000012',
    'automatic',null,'match_found','high_confidence')->>'systemPreselectionApplied'),'true',
  'automatic lookup keeps the System preselection path');
insert into pg_temp.lookup_fixture_results(result_key,result) values
  ('manual-ambiguous',pg_temp.commit_lookup_fixture(
    'a3470000-0000-4000-8000-000000000013','a3480000-0000-4000-8000-000000000013',
    'manual','a3410000-0000-4000-8000-000000000001','multiple_matches','ambiguous'));
select is((select result->>'systemPreselectionApplied' from pg_temp.lookup_fixture_results
    where result_key='manual-ambiguous'),'false',
  'ambiguous lookup does not use System preselection');
select ok((select actor_user_id='a3410000-0000-4000-8000-000000000001'
    from public.refund_nayax_lookup_candidates
    where token='a3480000-0000-4000-8000-000000000013'),
  'ambiguous candidate remains available to the current case worker');
select ok((select matched_nayax_transaction_id is null from public.refund_cases
    where id='a3470000-0000-4000-8000-000000000013'),
  'ambiguous lookup never saves a transaction before human review');

insert into pg_temp.lookup_fixture_results(result_key,result) values
  ('scheduled-ambiguous',pg_temp.commit_lookup_fixture(
    'a3470000-0000-4000-8000-000000000015','a3480000-0000-4000-8000-000000000015',
    'scheduled',null,'multiple_matches','ambiguous'));
select ok((select actor_user_id is null and lookup_generation=1
    from public.refund_nayax_lookup_candidates
    where token='a3480000-0000-4000-8000-000000000015'),
  'scheduled ambiguous lookup keeps its exact current candidate as System evidence');
select pg_temp.set_actor('a3410000-0000-4000-8000-000000000002');
select is((public.admin_select_refund_nayax_candidate_current_user_v1(
    'a3470000-0000-4000-8000-000000000015',
    (select official_action_version from public.refund_cases
      where id='a3470000-0000-4000-8000-000000000015'),
    'a3480000-0000-4000-8000-000000000015',null)->>'selectionApplied'),'true',
  'a current mapped Manager can review and select exact System-generated ambiguous evidence');
select ok((select matched_nayax_transaction_id='LOOKUP-000000000015'
      and nayax_lookup_generation=1
    from public.refund_cases where id='a3470000-0000-4000-8000-000000000015')
  and exists(select 1 from public.refund_case_events
    where refund_case_id='a3470000-0000-4000-8000-000000000015'
      and event_type='nayax_match_selected'
      and actor_user_id='a3410000-0000-4000-8000-000000000002'
      and metadata->>'provider_call_made'='false'),
  'System evidence selection remains actor-attributed and makes no provider call');
reset role;
select is(public.can_perform_refund_official_action(
    'a3410000-0000-4000-8000-000000000002',
    'a3470000-0000-4000-8000-000000000015'),true,
  'the selecting machine Manager retains current official-action authority');
select is(public.refund_case_nayax_manager_readiness(
    null,'a3470000-0000-4000-8000-000000000015')->>'transactionConfirmed','true',
  'the exact selected System candidate satisfies transaction preparation truth');
select is(public.refund_manager_preparation_snapshot(
    'a3470000-0000-4000-8000-000000000015',
    (select official_action_version from public.refund_cases
      where id='a3470000-0000-4000-8000-000000000015'))->>'evidenceBasis',
  'card_exact_selected',
  'the current exact selection event is the Manager preparation proof');
select ok((select assigned_manager_id is null
      from public.refund_cases
      where id='a3470000-0000-4000-8000-000000000015')
    and public.refund_decision_recommendation_for_case(
      'a3470000-0000-4000-8000-000000000015')->>'kind'='refund',
  'an exact System selection by a current machine Manager needs no single case assignee');
set local role service_role;
select is(public.refund_lifecycle_contract(
    'a3470000-0000-4000-8000-000000000015')#>>'{nextWork,actionCode}',
  'approve_or_deny_request',
  'the authorized System selection reaches the existing Manager decision path');
reset role;
create temp table selected_authority_baseline on commit drop as
select to_jsonb(c) case_row,
  (select md5(jsonb_agg(to_jsonb(e) order by e.id)::text)
    from public.refund_case_events e where e.refund_case_id=c.id) event_hash,
  (select md5(jsonb_agg(to_jsonb(k) order by k.token)::text)
    from public.refund_nayax_lookup_candidates k where k.refund_case_id=c.id) candidate_hash
from public.refund_cases c where c.id='a3470000-0000-4000-8000-000000000015';
update public.reporting_machine_refund_managers
set status='revoked',revoked_at=statement_timestamp(),revoke_reason='Fixture authority check'
where id='a3450000-0000-4000-8000-000000000001';
select is(public.refund_decision_recommendation_for_case(
    'a3470000-0000-4000-8000-000000000015')->>'kind','refund',
  'historical selector reassignment preserves the exact immutable purchase recommendation');
select is(public.can_perform_refund_official_action(
    'a3410000-0000-4000-8000-000000000002',
    'a3470000-0000-4000-8000-000000000015'),false,
  'the historical selecting Manager no longer has current decision authority');
select pg_temp.set_actor('a3410000-0000-4000-8000-000000000003');
select is(public.can_perform_refund_official_action(
    'a3410000-0000-4000-8000-000000000003',
    'a3470000-0000-4000-8000-000000000015'),true,
  'the other current machine Manager retains the independent decision authority');
select is(public.refund_lifecycle_contract(
    'a3470000-0000-4000-8000-000000000015')#>>'{decisionRecommendation,decisionReady}',
  'true','the current deciding Manager receives a usable decision recommendation');
select ok(pg_temp.probe_selected_approval(
    'a3470000-0000-4000-8000-000000000015')->>'decidedBy'=
    'a3410000-0000-4000-8000-000000000003',
  'a different current Manager can approve the exact saved purchase in a rolled-back probe');
select pg_temp.set_actor('a3410000-0000-4000-8000-000000000002');
select matches(pg_temp.capture_error($sql$
  select public.admin_approve_selected_nayax_refund_for_system_v1(
    'a3470000-0000-4000-8000-000000000015',
    (select official_action_version from public.refund_cases
      where id='a3470000-0000-4000-8000-000000000015'))
$sql$),'^42501:Only the assigned machine Manager or a Super-admin',
  'the revoked selecting actor cannot make the current final decision');
select is(public.refund_lifecycle_contract(
    'a3470000-0000-4000-8000-000000000015')#>>'{decisionRecommendation,decisionReady}',
  'false','the unauthorized current actor receives no usable decision recommendation');
select is(pg_temp.probe_recommendation($sql$
  update public.refund_case_events set metadata=jsonb_set(metadata,
    '{candidate_evidence_hash}',to_jsonb(repeat('0',64)))
  where refund_case_id='a3470000-0000-4000-8000-000000000015'
    and event_type='nayax_match_selected'
$sql$,'a3470000-0000-4000-8000-000000000015'),null::jsonb,
  'a corrupted selection evidence hash still invalidates the recommendation');
select is(pg_temp.probe_recommendation($sql$
  update public.refund_cases set nayax_lookup_generation=nayax_lookup_generation+1
  where id='a3470000-0000-4000-8000-000000000015'
$sql$,'a3470000-0000-4000-8000-000000000015'),null::jsonb,
  'a newer lookup generation still invalidates the historical selection proof');
select is(pg_temp.probe_recommendation($sql$
  update public.refund_cases set payment_amount_cents=payment_amount_cents+1
  where id='a3470000-0000-4000-8000-000000000015'
$sql$,'a3470000-0000-4000-8000-000000000015'),null::jsonb,
  'changed customer facts still invalidate the historical selection proof');
select ok((select to_jsonb(c)=b.case_row
    and (select md5(jsonb_agg(to_jsonb(e) order by e.id)::text)
      from public.refund_case_events e where e.refund_case_id=c.id)=b.event_hash
    and (select md5(jsonb_agg(to_jsonb(k) order by k.token)::text)
      from public.refund_nayax_lookup_candidates k where k.refund_case_id=c.id)=b.candidate_hash
    and not exists(select 1 from public.refund_case_nayax_refund_attempts a where a.refund_case_id=c.id)
    and not exists(select 1 from public.refund_case_messages m where m.refund_case_id=c.id)
  from public.refund_cases c cross join selected_authority_baseline b
  where c.id='a3470000-0000-4000-8000-000000000015'),
  'authority checks and rolled-back probes preserve case, selection, payment and message evidence');

-- Reproduce RF-26DB7861's exact proof shape without invoking the global legacy
-- recovery operation: actor-bound candidate and guarded System-recovered event.
create temp table recovered_fixture_original on commit drop as
select e.id,e.actor_user_id,e.event_type,e.metadata,k.actor_user_id candidate_actor
from public.refund_case_events e join public.refund_nayax_lookup_candidates k
  on k.token='a3480000-0000-4000-8000-000000000015'
where e.refund_case_id='a3470000-0000-4000-8000-000000000015'
  and e.event_type='nayax_match_selected';
insert into public.refund_nayax_lookup_candidates
select (jsonb_populate_record(null::public.refund_nayax_lookup_candidates,
  to_jsonb(k)||jsonb_build_object(
    'token','a3480000-0000-4000-8000-000000000016',
    'actor_user_id','a3410000-0000-4000-8000-000000000002'))).*
from public.refund_nayax_lookup_candidates k
where k.token='a3480000-0000-4000-8000-000000000015';
update public.refund_case_events e
set event_type='nayax_match_selection_proof_recovered',actor_user_id=null,
  metadata=e.metadata||jsonb_build_object(
    'candidate_token',k.token,
    'candidate_evidence_hash',public.refund_nayax_candidate_evidence_hash(
      k.refund_case_id,k.actor_user_id,k.provider_transaction_id,k.site_id,
      k.machine_authorization_time,k.amount_cents,k.card_last4,k.currency_code,
      k.evidence_summary,k.expires_at,k.created_at),
    'recovery_contract_version','refund_legacy_selection_proof_recovery_v1',
    'source_selection_event_digest',encode(extensions.digest(e.id::text,'sha256'),'hex'),
    'source_selection_created_at',e.created_at,'execution_eligible',true,
    'approval_created',false)
from public.refund_nayax_lookup_candidates k
where e.id=(select id from recovered_fixture_original)
  and k.token='a3480000-0000-4000-8000-000000000016';
select ok((select e.actor_user_id is null and k.actor_user_id is not null
    and e.event_type='nayax_match_selection_proof_recovered'
  from public.refund_case_events e join public.refund_nayax_lookup_candidates k
    on k.token=(e.metadata->>'candidate_token')::uuid
  where e.id=(select id from recovered_fixture_original)),
  'the regression uses the real recovered System-proof and actor-bound candidate shape');
select is(public.refund_case_nayax_manager_readiness(
  null,'a3470000-0000-4000-8000-000000000015')->>'transactionConfirmed','true',
  'the existing preparation contract accepts the guarded recovered proof');
select is(public.refund_decision_recommendation_for_case(
  'a3470000-0000-4000-8000-000000000015')->>'kind','refund',
  'the same guarded recovered proof supplies the decision recommendation');
select pg_temp.set_actor('a3410000-0000-4000-8000-000000000003');
select is(public.refund_lifecycle_contract(
  'a3470000-0000-4000-8000-000000000015')#>>'{decisionRecommendation,decisionReady}',
  'true','a current mapped Manager has usable controls for the recovered proof');
select ok(pg_temp.probe_selected_approval(
  'a3470000-0000-4000-8000-000000000015')->>'decidedBy'=
  'a3410000-0000-4000-8000-000000000003',
  'the unchanged protected approval accepts the recovered proof in a rolled-back probe');
create temp table approved_lifecycle_probe on commit drop as
select pg_temp.probe_selected_approval(
  'a3470000-0000-4000-8000-000000000015') result;
select is(jsonb_typeof(result#>'{legacyBaseLifecycle,operations,required}'),'null',
  'the actual retained producer reproduces NULL on a newly reserved approved-card attempt')
from approved_lifecycle_probe;
select is(result#>'{baseLifecycle,operations,required}','false'::jsonb,
  'the approved-card attempt without provider outcome serializes boolean false')
from approved_lifecycle_probe;
select is(result#>'{lifecycle,operations,required}','false'::jsonb,
  'the boolean survives the current receipt, completion and gift lifecycle wrappers')
from approved_lifecycle_probe;
select is(result->'baseLifecycle',jsonb_set(result->'legacyBaseLifecycle',
  '{operations,required}','false'::jsonb),
  'the full underlying lifecycle changes only the nullable operations.required field')
from approved_lifecycle_probe;
select pg_temp.set_actor('a3410000-0000-4000-8000-000000000002');
select matches(pg_temp.capture_error($sql$
  select public.admin_approve_selected_nayax_refund_for_system_v1(
    'a3470000-0000-4000-8000-000000000015',
    (select official_action_version from public.refund_cases
      where id='a3470000-0000-4000-8000-000000000015'))
$sql$),'^42501:Only the assigned machine Manager or a Super-admin',
  'recovery never gives the revoked current actor decision authority');
select is(public.refund_lifecycle_contract(
  'a3470000-0000-4000-8000-000000000015')#>>'{decisionRecommendation,decisionReady}',
  'false','the recovered proof does not expose usable controls to an unauthorized actor');
select is(pg_temp.probe_recommendation(format($sql$
  update public.refund_case_events set metadata=jsonb_set(metadata,array[%L],to_jsonb(%L::text))
  where id=(select id from recovered_fixture_original)
$sql$,key,bad_value),'a3470000-0000-4000-8000-000000000015'),null::jsonb,
  'recovered proof rejects altered '||key)
from (values
  ('recovery_contract_version','unsupported'),
  ('source_selection_event_digest','invalid'),
  ('execution_eligible','false'),('approval_created','true'),
  ('provider_call_made','true'),('customer_message_created','true'),
  ('payload_redacted','false'),
  ('candidate_token','a3480000-0000-4000-8000-000000000014'),
  ('candidate_evidence_hash',repeat('0',64)),
  ('lookup_generation','0'),('deterministic_fact_version','0')
) invalid(key,bad_value);
select is(pg_temp.probe_recommendation($sql$
  update public.refund_case_events set actor_user_id='a3410000-0000-4000-8000-000000000002'
  where id=(select id from recovered_fixture_original)
$sql$,'a3470000-0000-4000-8000-000000000015'),null::jsonb,
  'the recovered proof must retain the protected System actor');
select is(pg_temp.probe_recommendation($sql$
  update public.refund_case_events set event_type='nayax_match_selected'
  where id=(select id from recovered_fixture_original)
$sql$,'a3470000-0000-4000-8000-000000000015'),null::jsonb,
  'a native actor-bound selection still requires the matching historical actor');
update public.refund_case_events e
set event_type=o.event_type,actor_user_id=o.actor_user_id,metadata=o.metadata
from recovered_fixture_original o where e.id=o.id;
delete from public.refund_nayax_lookup_candidates
where token='a3480000-0000-4000-8000-000000000016';
select ok((select to_jsonb(c)=b.case_row
    and (select md5(jsonb_agg(to_jsonb(e) order by e.id)::text)
      from public.refund_case_events e where e.refund_case_id=c.id)=b.event_hash
    and (select md5(jsonb_agg(to_jsonb(k) order by k.token)::text)
      from public.refund_nayax_lookup_candidates k where k.refund_case_id=c.id)=b.candidate_hash
    and not exists(select 1 from public.refund_case_nayax_refund_attempts a where a.refund_case_id=c.id)
    and not exists(select 1 from public.refund_case_messages m where m.refund_case_id=c.id)
  from public.refund_cases c cross join selected_authority_baseline b
  where c.id='a3470000-0000-4000-8000-000000000015'),
  'recovered-proof probes restore all case/evidence and leave no approval, attempt or message');
update public.reporting_machine_refund_managers
set status='active',revoked_at=null,revoke_reason=null
where id='a3450000-0000-4000-8000-000000000001';
select is(public.refund_decision_recommendation_for_case(
    'a3470000-0000-4000-8000-000000000015')->>'kind','refund',
  'restoring the historical Manager mapping leaves the same evidence-only recommendation');

insert into public.refund_cases(id,public_reference,reporting_machine_id,reporting_location_id,
  customer_email,issue_summary,incident_at,incident_timezone,incident_time_resolution,
  incident_time_confidence,payment_method,payment_amount_cents,card_last4,
  card_last4_provenance,payment_interaction,status,correlation_status,
  deterministic_fact_version,intake_source,intake_meta,nayax_lookup_generation,
  nayax_lookup_status,nayax_refund_execution_status,customer_request_received_at,
  customer_request_received_source)
values('a3470000-0000-4000-8000-000000000002','RF-SYSTEM-PRESELECT',
  'a3440000-0000-4000-8000-000000000001','a3430000-0000-4000-8000-000000000001',
  'clear-match@example.invalid','Routine clear match','2026-09-12T20:00:00Z','America/Los_Angeles',
  'exact','exact','card',1000,'4242','physical_card','tap_card','needs_review',
  'needs_nayax',1,'form','{}',1,'checking','not_requested',
  '2026-09-12T21:00:00Z','hosted_refund_intake');
insert into public.refund_nayax_lookup_candidates(token,refund_case_id,lookup_generation,actor_user_id,
  reporting_machine_id,provider_transaction_id,site_id,machine_authorization_time,amount_cents,
  card_last4,currency_code,evidence_summary,expires_at)
values('a3480000-0000-4000-8000-000000000014','a3470000-0000-4000-8000-000000000002',1,
  null,'a3440000-0000-4000-8000-000000000001','SYSTEM-CLEAR-SALE',17,
  '2026-09-12T20:00:00Z',1090,'4242','USD',pg_temp.request_bound_evidence()||jsonb_build_object(
    'one_click_eligible',true,'recommendation_state','high_confidence',
    'confidence_class','high_confidence'),now()+interval '1 hour');
select is((public.service_commit_refund_nayax_lookup_and_preselect_v1(
  'a3470000-0000-4000-8000-000000000002',1,1,'match_found','high_confidence',
  '2026-09-05.v11',statement_timestamp(),'One clear provider transaction',
  'a3440000-0000-4000-8000-000000000001',1,'scheduled',null,null)
  ->>'systemPreselectionApplied'),'true','routine lookup atomically System-preselects one clear candidate');
select ok((select matched_nayax_transaction_id='SYSTEM-CLEAR-SALE'
    and matched_nayax_amount_cents=1090 and nayax_match_execution_eligible
    from public.refund_cases where id='a3470000-0000-4000-8000-000000000002')
  and exists(select 1 from public.refund_case_events where refund_case_id='a3470000-0000-4000-8000-000000000002'
    and event_type='nayax_match_preselected' and actor_user_id is null
    and metadata->>'provider_amount_cents'='1090'),
  'System preselection persists exact provider facts and a bounded System audit event');
select is((public.refund_case_nayax_manager_readiness(
    'a3410000-0000-4000-8000-000000000002',
    'a3470000-0000-4000-8000-000000000002')->>'canIssueCardRefund'),'true',
  'the assigned manager can make the one decision on a current System-preselected match');
select is((public.refund_manager_preparation_snapshot(
    'a3470000-0000-4000-8000-000000000002',
    (select official_action_version from public.refund_cases
      where id='a3470000-0000-4000-8000-000000000002'))->>'evidenceBasis'),
  'card_exact_selected','completed System preselection supplies current exact card preparation');
set local role service_role;
select is((select item->>'actionCode' from jsonb_array_elements(
    public.refund_manager_daily_digest_projection_for(
      'a3410000-0000-4000-8000-000000000002',statement_timestamp())->'items') item
    where item->>'publicReference'='RF-SYSTEM-PRESELECT'),
  'approve_or_deny_request',
  'Daily digest includes an exact-selected decision without a nextWork proofId');
reset role;
select pg_temp.set_actor('a3410000-0000-4000-8000-000000000001');
select matches(pg_temp.capture_error($sql$select public.admin_select_refund_nayax_candidate_current_user_v1(
  'a3470000-0000-4000-8000-000000000002',
  (select official_action_version from public.refund_cases where id='a3470000-0000-4000-8000-000000000002'),
  'a3480000-0000-4000-8000-000000000014',null)$sql$),'^P4604:.*',
  'human selection is limited to ambiguous or manual-exception results');
select is((public.admin_dispute_refund_nayax_preselection_current_user_v1(
  'a3470000-0000-4000-8000-000000000002',
  (select official_action_version from public.refund_cases
    where id='a3470000-0000-4000-8000-000000000002'))->>'status'),'manual_exception',
  'a case worker can dispute the exact current System preselection before approval');
select ok((select matched_nayax_transaction_id is null and matched_nayax_amount_cents is null
    and nayax_recommendation_state='manual_exception' and not nayax_match_execution_eligible
    from public.refund_cases where id='a3470000-0000-4000-8000-000000000002')
  and exists(select 1 from public.refund_case_events
    where refund_case_id='a3470000-0000-4000-8000-000000000002'
      and event_type='nayax_match_preselection_disputed'
      and metadata->>'provider_call_made'='false' and metadata->>'approval_created'='false'),
  'dispute clears only the System match and records no payment side effect');
select is(public.refund_manager_preparation_snapshot(
    'a3470000-0000-4000-8000-000000000002',
    (select official_action_version from public.refund_cases
      where id='a3470000-0000-4000-8000-000000000002')),
  null::jsonb,'disputed preselection revokes current card preparation');
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

update public.reporting_machines
set status='inactive',nayax_refunds_enabled=false,
  nayax_refunds_disabled_reason='machine_maintenance'
where id='a3440000-0000-4000-8000-000000000001';
select pg_temp.set_actor('a3410000-0000-4000-8000-000000000002');
select is((public.refund_case_nayax_manager_readiness(
    'a3410000-0000-4000-8000-000000000002',
    'a3470000-0000-4000-8000-000000000001')->>'canIssueCardRefund'),'true',
  'inactive or execution-disabled machine state does not revoke the exact manager decision');
create temp table approval_result as select public.admin_approve_selected_nayax_refund_for_system_v1(
  'a3470000-0000-4000-8000-000000000001',
  (select official_action_version from public.refund_cases where id='a3470000-0000-4000-8000-000000000001')) result;
select ok((select z.actor_user_id='a3410000-0000-4000-8000-000000000002' and z.status='consumed'
  from public.refund_case_official_action_authorizations z where z.id=(select (result->>'authorizationId')::uuid from approval_result)),
  'manager B is the sole financial approver');
select ok((select a.actor_user_id is null and a.status='created' and a.official_action_authorization_id is not null
  from public.refund_case_nayax_refund_attempts a where a.id=(select (result->>'attemptId')::uuid from approval_result)),
  'approval creates one System-owned queued attempt');
select matches(pg_temp.capture_error(format('select public.admin_approve_selected_nayax_refund_for_system_v1(%L,%s)',
  'a3470000-0000-4000-8000-000000000001',
  (select official_action_version from public.refund_cases where id='a3470000-0000-4000-8000-000000000001'))),
  '^P4620:.*','double approval loses without another attempt');
select is((select count(*) from public.refund_case_nayax_refund_attempts where refund_case_id='a3470000-0000-4000-8000-000000000001'),1::bigint,
  'sequential duplicate approval leaves one attempt; the unique queue index is the cross-session arbiter');
select is(jsonb_array_length(public.service_claim_due_nayax_refund_attempts_v1(
    'single-gate-executor','SINGLE_GATE_ACCOUNT','exact_source','empty_string',1)->'claims'),0,
  'inactive or execution-disabled machine holds the one durable attempt before provider claim');
select ok((select a.status='created' and a.provider_claim_digest is null
    and c.nayax_refund_execution_status='not_requested'
    and (select result->>'providerCallMade' from approval_result)='false'
    and not exists(select 1 from public.refund_nayax_provider_stage_journal journal
      where journal.nayax_refund_attempt_id=a.id)
  from public.refund_case_nayax_refund_attempts a
  join public.refund_cases c on c.id=a.refund_case_id
  where a.id=(select (result->>'attemptId')::uuid from approval_result)),
  'held approval remains one provider-free created attempt with no provider journal');

update public.reporting_machines
set status='active',nayax_refunds_enabled=true,nayax_refunds_disabled_reason=null
where id='a3440000-0000-4000-8000-000000000001';

update public.reporting_machine_refund_managers set status='revoked',revoked_at=now(),
  revoke_reason='Fixture manager reassignment'
where id='a3450000-0000-4000-8000-000000000001';
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
insert into public.refund_gmail_threads(id,refund_case_id,mailbox_hash,provider_thread_id,
  thread_subject,first_message_at,latest_message_at,retention_expires_at)
values('a3490000-0000-4000-8000-000000000001','a3470000-0000-4000-8000-000000000001',
  repeat('b',64),'single-gate-original-thread','Original customer thread',
  statement_timestamp()-interval '2 days',statement_timestamp()-interval '2 days',
  statement_timestamp()+interval '180 days');
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
select public.service_record_nayax_refund_provider_stage_v4_diagnostics(
  p_executor_assertion=>'single-gate-executor',
  p_attempt_id=>(select (result->>'attemptId')::uuid from approval_result),
  p_provider_claim_token=>(select result#>>'{claims,0,providerClaimToken}' from second_claim),
  p_stage=>'request',p_event=>'result',p_http_status=>200,p_outcome=>'accepted',
  p_contract_matched=>true,p_failure_type=>null,p_classification_digest=>repeat('b',64),
  p_provider_contract_version=>'nayax-production-account-contract-v2',
  p_journal_contract_version=>'nayax-provider-journal-v3',p_http_accepted=>true,
  p_media_type_class=>'application_json',p_body_kind=>'json_object',p_body_length_bucket=>'1_256',
  p_json_parsed=>true,p_json_object=>true,p_schema_matched=>true,
  p_result_key_present=>true,p_status_key_present=>true,p_result_value_type=>'string',
  p_status_value_type=>'string',p_semantic_pair_matched=>true,
  p_business_result=>'Refund status updated successfully, but the email could not be sent',
  p_business_status=>'Partial success',p_business_pair_retained=>true,
  p_observed_result_scalar=>'Refund status updated successfully, but the email could not be sent',
  p_observed_status_scalar=>'Partial success',p_observed_scalar_pair_retained=>true,
  p_result_diagnostic_text=>'Refund status updated successfully, but the email could not be sent',
  p_result_diagnostic_disposition=>'exact',p_result_diagnostic_length_bucket=>'1_80',
  p_status_diagnostic_text=>'Partial success',p_status_diagnostic_disposition=>'exact',
  p_status_diagnostic_length_bucket=>'1_80');
select matches(pg_temp.capture_error(format($sql$select public.service_settle_nayax_refund_attempt(
  'single-gate-executor',%L,%L,%L,%L,1090,'USD','wrong-claim-token','success',
  'SINGLE-GATE-SUCCESS-1','approve_succeeded_contract_match',null)$sql$,
  (select result->>'attemptId' from approval_result),(select result->>'authorizationId' from approval_result),
  'a3470000-0000-4000-8000-000000000001',
  (select idempotency_key from public.refund_case_nayax_refund_attempts
    where id=(select (result->>'attemptId')::uuid from approval_result)))),
  '^P4620:.*','wrong provider claim token cannot settle the attempt');
select is((select status from public.refund_case_nayax_refund_attempts
  where id=(select (result->>'attemptId')::uuid from approval_result)),'in_progress',
  'wrong settlement claim leaves the exact attempt unsettled');
update public.refund_case_nayax_refund_attempts set provider_claim_expires_at=now()-interval '1 second'
where id=(select (result->>'attemptId')::uuid from approval_result);
select is((public.service_reclaim_nayax_refund_attempt_no_call_v1('single-gate-executor','SINGLE_GATE_ACCOUNT')->>'held'),'true',
  'expired provider-started claim becomes held for verification');
select ok((select status='manual_review' and provider_outcome='unknown' and reconciliation_required
  from public.refund_case_nayax_refund_attempts where id=(select (result->>'attemptId')::uuid from approval_result)),
  'started claim remains the same manual-review unknown row');
select is(jsonb_array_length(public.service_claim_due_nayax_refund_attempts_v1(
  'single-gate-executor','SINGLE_GATE_ACCOUNT','exact_source','empty_string',1)->'claims'),0,
  'held unknown cannot be claimed again without exact no-refund proof');

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
  'remain_on_hold','nayax_dtm_transaction','DTM:NAYAX-123456789',statement_timestamp(),
  'America/Los_Angeles','evidence_incomplete',
  (select official_action_version from public.refund_cases where id='a3470000-0000-4000-8000-000000000001'))->>'status'),
  'provider_hold','valid evidence remains on the same verification hold');
select ok((select metadata->>'evidence_reference_digest'~'^[a-f0-9]{64}$'
  and metadata->>'reason_code'='evidence_incomplete'
  and metadata->>'evidence_source_timezone'='America/Los_Angeles'
  from public.refund_case_events
  where refund_case_id='a3470000-0000-4000-8000-000000000001'
    and event_type='nayax_system_outcome_evidence_recorded' order by created_at desc limit 1),
  'hold evidence stores its privacy-safe type, digest, time, and reason');
select matches(pg_temp.capture_error($sql$select public.admin_record_nayax_system_outcome_evidence_v1(
  'a3470000-0000-4000-8000-000000000001',(select (result->>'attemptId')::uuid from approval_result),
  'remain_on_hold','nayax_dtm_transaction','DTM:NAYAX-123456789',statement_timestamp(),
  'Browser/Local','evidence_incomplete',(select official_action_version from public.refund_cases where id='a3470000-0000-4000-8000-000000000001'))$sql$),
  '^P4661:.*','an unknown browser timezone cannot be saved as provider evidence');
select matches(pg_temp.capture_error($sql$select public.admin_record_nayax_system_outcome_evidence_v1(
  'a3470000-0000-4000-8000-000000000001',(select (result->>'attemptId')::uuid from approval_result),
  'provider_confirmed_success','nayax_dtm_transaction','DTM:NAYAX-123456789',statement_timestamp(),
  'America/Los_Angeles','nayax_support_confirmed_success',(select official_action_version from public.refund_cases where id='a3470000-0000-4000-8000-000000000001'))$sql$),
  '^P4661:.*','mismatched evidence tuple is rejected');
select matches(pg_temp.capture_error($sql$select public.admin_record_nayax_system_outcome_evidence_v1(
  'a3470000-0000-4000-8000-000000000001',(select (result->>'attemptId')::uuid from approval_result),
  'provider_confirmed_no_refund','nayax_dtm_transaction','DTM:NAYAX-123456789',statement_timestamp(),
  'America/Los_Angeles','provider_rejected',(select official_action_version from public.refund_cases where id='a3470000-0000-4000-8000-000000000001'))$sql$),
  '^P4661:.*','a rejected label is not authoritative no-refund proof');
select matches(pg_temp.capture_error($sql$select public.admin_record_nayax_system_outcome_evidence_v1(
  'a3470000-0000-4000-8000-000000000001',(select (result->>'attemptId')::uuid from approval_result),
  'provider_confirmed_no_refund','nayax_dtm_transaction','DTM:NAYAX-123456789','2026-09-01T00:00:00Z',
  'America/Los_Angeles','nayax_dtm_not_refunded',(select official_action_version from public.refund_cases where id='a3470000-0000-4000-8000-000000000001'))$sql$),
  '^P4661:.*','stale no-refund proof cannot continue an attempt');
select is((public.admin_record_nayax_system_outcome_evidence_v1(
  'a3470000-0000-4000-8000-000000000001',(select (result->>'attemptId')::uuid from approval_result),
  'provider_confirmed_no_refund','nayax_dtm_transaction','DTM:NAYAX-123456789',statement_timestamp(),
  'America/Los_Angeles','nayax_dtm_not_refunded',(select official_action_version from public.refund_cases
    where id='a3470000-0000-4000-8000-000000000001'))->>'status'),'system_finishing',
  'exact no-refund proof requeues System rather than asking for another manager decision');
select ok((select provider_execution_generation=2 and execution_plan='approve_only'
    and status='created' and official_action_authorization_id=(select (result->>'authorizationId')::uuid from approval_result)
    from public.refund_case_nayax_refund_attempts where id=(select (result->>'attemptId')::uuid from approval_result)),
  'the same attempt and original authorization advance to approval-only generation two');
select ok((select count(*)=1 and bool_and(source_timezone='America/Los_Angeles')
    from public.refund_nayax_no_refund_proofs
    where nayax_refund_attempt_id=(select (result->>'attemptId')::uuid from approval_result)),
  'one held generation accepts exactly one append-only proof');
select matches(pg_temp.capture_error(format($sql$select public.service_settle_nayax_refund_attempt(
  'single-gate-executor',%L,%L,%L,%L,1090,'USD',%L,'success',
  'SINGLE-GATE-SUCCESS-1','approve_succeeded_contract_match',null)$sql$,
  (select result->>'attemptId' from approval_result),(select result->>'authorizationId' from approval_result),
  'a3470000-0000-4000-8000-000000000001',
  (select idempotency_key from public.refund_case_nayax_refund_attempts where id=(select (result->>'attemptId')::uuid from approval_result)),
  (select result#>>'{claims,0,providerClaimToken}' from second_claim))),
  '^P4620:.*','the old generation claim token is rejected');

create temp table continuation_proof_backup as
select * from public.refund_nayax_no_refund_proofs
where nayax_refund_attempt_id=(select (result->>'attemptId')::uuid from approval_result);
set local session_replication_role=replica;
delete from public.refund_nayax_no_refund_proofs
where nayax_refund_attempt_id=(select (result->>'attemptId')::uuid from approval_result);
set local session_replication_role=origin;
select is(jsonb_array_length(public.service_claim_due_nayax_refund_attempts_v1(
  'single-gate-executor','SINGLE_GATE_ACCOUNT','exact_source','empty_string',1)->'claims'),0,
  'generation two cannot be claimed without its exact no-refund proof');
set local session_replication_role=replica;
insert into public.refund_nayax_no_refund_proofs select * from continuation_proof_backup;
update public.refund_nayax_no_refund_proofs set execution_plan='request_and_approve'
where nayax_refund_attempt_id=(select (result->>'attemptId')::uuid from approval_result);
update public.refund_case_nayax_refund_attempts set execution_plan='request_and_approve'
where id=(select (result->>'attemptId')::uuid from approval_result);
set local session_replication_role=origin;
create temp table full_plan_claim as select public.service_claim_due_nayax_refund_attempts_v1(
  'single-gate-executor','SINGLE_GATE_ACCOUNT','exact_source','empty_string',1) result;
select matches(pg_temp.capture_error(format($sql$select public.service_record_nayax_refund_provider_stage_v4_diagnostics(
  p_executor_assertion=>'single-gate-executor',p_attempt_id=>%L::uuid,
  p_provider_claim_token=>%L,p_stage=>'approve',p_event=>'started',p_http_status=>null,
  p_outcome=>null,p_contract_matched=>null,p_failure_type=>null,
  p_classification_digest=>repeat('c',64),
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
  p_status_diagnostic_disposition=>null,p_status_diagnostic_length_bucket=>null)$sql$,
  (select result->>'attemptId' from approval_result),
  (select result#>>'{claims,0,providerClaimToken}' from full_plan_claim))),
  '^P4620:.*','request-and-approve generation two cannot approve from generation-one request evidence');
update public.refund_case_nayax_refund_attempts set provider_claim_expires_at=now()-interval '1 second'
where id=(select (result->>'attemptId')::uuid from approval_result);
select public.service_reclaim_nayax_refund_attempt_no_call_v1(
  'single-gate-executor','SINGLE_GATE_ACCOUNT');
set local session_replication_role=replica;
update public.refund_nayax_no_refund_proofs set execution_plan='approve_only'
where nayax_refund_attempt_id=(select (result->>'attemptId')::uuid from approval_result);
update public.refund_case_nayax_refund_attempts set execution_plan='approve_only'
where id=(select (result->>'attemptId')::uuid from approval_result);
set local session_replication_role=origin;

create temp table third_claim as select public.service_claim_due_nayax_refund_attempts_v1(
  'single-gate-executor','SINGLE_GATE_ACCOUNT','exact_source','empty_string',1) result;
select ok((select result#>>'{claims,0,attemptId}'=(select result->>'attemptId' from approval_result)
    and result#>>'{claims,0,providerWireContext,providerExecutionGeneration}'='2'
    and result#>>'{claims,0,providerWireContext,executionPlan}'='approve_only' from third_claim),
  'the next claim is generation-scoped to approval-only on the same row');
create temp table prior_request_result_backup as
select * from public.refund_nayax_provider_stage_journal
where nayax_refund_attempt_id=(select (result->>'attemptId')::uuid from approval_result)
  and provider_execution_generation=1 and stage='request' and event='result';
set local session_replication_role=replica;
delete from public.refund_nayax_provider_stage_journal
where nayax_refund_attempt_id=(select (result->>'attemptId')::uuid from approval_result)
  and provider_execution_generation=1 and stage='request' and event='result';
set local session_replication_role=origin;
select matches(pg_temp.capture_error(format($sql$select public.service_record_nayax_refund_provider_stage_v4_diagnostics(
  p_executor_assertion=>'single-gate-executor',p_attempt_id=>%L::uuid,
  p_provider_claim_token=>%L,p_stage=>'approve',p_event=>'started',p_http_status=>null,
  p_outcome=>null,p_contract_matched=>null,p_failure_type=>null,
  p_classification_digest=>repeat('c',64),
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
  p_status_diagnostic_disposition=>null,p_status_diagnostic_length_bucket=>null)$sql$,
  (select result->>'attemptId' from approval_result),
  (select result#>>'{claims,0,providerClaimToken}' from third_claim))),
  '^P4613:.*','approval-only continuation requires the exact prior accepted request');
set local session_replication_role=replica;
insert into public.refund_nayax_provider_stage_journal select * from prior_request_result_backup;
set local session_replication_role=origin;
select matches(pg_temp.capture_error(format($sql$select public.service_record_nayax_refund_provider_stage_v4_diagnostics(
  p_executor_assertion=>'single-gate-executor',p_attempt_id=>%L::uuid,
  p_provider_claim_token=>%L,p_stage=>'request',p_event=>'started',p_http_status=>null,
  p_outcome=>null,p_contract_matched=>null,p_failure_type=>null,
  p_classification_digest=>repeat('c',64),
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
  p_status_diagnostic_disposition=>null,p_status_diagnostic_length_bucket=>null)$sql$,
  (select result->>'attemptId' from approval_result),
  (select result#>>'{claims,0,providerClaimToken}' from third_claim))),
  '^P4620:.*','approval-only continuation cannot create a new request stage');
select public.service_record_nayax_refund_provider_stage_v4_diagnostics(
  p_executor_assertion=>'single-gate-executor',
  p_attempt_id=>(select (result->>'attemptId')::uuid from approval_result),
  p_provider_claim_token=>(select result#>>'{claims,0,providerClaimToken}' from third_claim),
  p_stage=>'approve',p_event=>'started',p_http_status=>null,p_outcome=>null,
  p_contract_matched=>null,p_failure_type=>null,p_classification_digest=>repeat('c',64),
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
select public.service_record_nayax_refund_provider_stage_v4_diagnostics(
  p_executor_assertion=>'single-gate-executor',
  p_attempt_id=>(select (result->>'attemptId')::uuid from approval_result),
  p_provider_claim_token=>(select result#>>'{claims,0,providerClaimToken}' from third_claim),
  p_stage=>'approve',p_event=>'result',p_http_status=>200,p_outcome=>'succeeded',
  p_contract_matched=>true,p_failure_type=>null,p_classification_digest=>repeat('d',64),
  p_provider_contract_version=>'nayax-production-account-contract-v2',
  p_journal_contract_version=>'nayax-provider-journal-v3',p_http_accepted=>true,
  p_media_type_class=>'application_json',p_body_kind=>'json_object',p_body_length_bucket=>'1_256',
  p_json_parsed=>true,p_json_object=>true,p_schema_matched=>true,
  p_result_key_present=>true,p_status_key_present=>true,p_result_value_type=>'string',
  p_status_value_type=>'string',p_semantic_pair_matched=>true,
  p_business_result=>'Refund status updated successfully, but the email could not be sent',
  p_business_status=>'Partial success',p_business_pair_retained=>true,
  p_observed_result_scalar=>'Refund status updated successfully, but the email could not be sent',
  p_observed_status_scalar=>'Partial success',p_observed_scalar_pair_retained=>true,
  p_result_diagnostic_text=>'Refund status updated successfully, but the email could not be sent',
  p_result_diagnostic_disposition=>'exact',p_result_diagnostic_length_bucket=>'1_80',
  p_status_diagnostic_text=>'Partial success',p_status_diagnostic_disposition=>'exact',
  p_status_diagnostic_length_bucket=>'1_80');
select ok((select count(*)=2 from public.refund_nayax_provider_stage_journal
    where nayax_refund_attempt_id=(select (result->>'attemptId')::uuid from approval_result)
      and provider_execution_generation=1)
  and (select count(*)=2 from public.refund_nayax_provider_stage_journal
    where nayax_refund_attempt_id=(select (result->>'attemptId')::uuid from approval_result)
      and provider_execution_generation=2),
  'journal stage uniqueness is scoped by provider execution generation');
select is((public.service_settle_nayax_refund_attempt(
  'single-gate-executor',(select (result->>'attemptId')::uuid from approval_result),
  (select (result->>'authorizationId')::uuid from approval_result),
  'a3470000-0000-4000-8000-000000000001',
  (select idempotency_key from public.refund_case_nayax_refund_attempts where id=(select (result->>'attemptId')::uuid from approval_result)),
  1090,'USD',(select result#>>'{claims,0,providerClaimToken}' from third_claim),
  'success','SINGLE-GATE-SUCCESS-1','approve_succeeded_contract_match',null)->>'updateApplied'),'true',
  'generation two settles through the canonical settlement function');
select ok((select count(*)=1 from public.sales_adjustment_facts
    where refund_case_id='a3470000-0000-4000-8000-000000000001')
  and (select count(*)=1 from public.refund_case_nayax_refund_attempts
    where refund_case_id='a3470000-0000-4000-8000-000000000001')
  and (select count(*)=1 from public.refund_case_official_action_authorizations
    where refund_case_id='a3470000-0000-4000-8000-000000000001' and action='approve'),
  'completion creates one adjustment with no second attempt or manager approval');

insert into public.refund_cases(id,public_reference,reporting_machine_id,reporting_location_id,
  customer_email,issue_summary,incident_at,incident_timezone,incident_time_resolution,
  incident_time_confidence,payment_method,payment_amount_cents,refund_amount_cents,
  card_last4,card_last4_provenance,payment_interaction,status,correlation_status,
  deterministic_fact_version,intake_source,intake_meta,nayax_lookup_generation,
  nayax_lookup_status,nayax_recommendation_state,nayax_refund_execution_status)
values('a3470000-0000-4000-8000-000000000003','RF-SUCCESS-EVIDENCE',
  'a3440000-0000-4000-8000-000000000001','a3430000-0000-4000-8000-000000000001',
  'success-evidence@example.invalid','Held result later proved successful',
  '2026-09-12T20:00:00Z','America/Los_Angeles','exact','exact','card',1100,1190,
  '4242','physical_card','tap_card','needs_review','needs_nayax',1,'form','{}',1,
  'manual_exception','manual_exception','not_requested');
insert into public.refund_nayax_lookup_candidates(token,refund_case_id,lookup_generation,actor_user_id,
  reporting_machine_id,provider_transaction_id,site_id,machine_authorization_time,amount_cents,
  card_last4,currency_code,evidence_summary,expires_at)
values('a3480000-0000-4000-8000-000000000020','a3470000-0000-4000-8000-000000000003',1,
  'a3410000-0000-4000-8000-000000000001','a3440000-0000-4000-8000-000000000001',
  'SUCCESS-EVIDENCE-SALE',17,'2026-09-12T20:00:00Z',1190,'4242','USD',
  pg_temp.exact_evidence()||jsonb_build_object('amount_cents',1190,'amount_delta_cents',90),
  now()+interval '1 hour');
select pg_temp.set_actor('a3410000-0000-4000-8000-000000000001');
select public.admin_select_refund_nayax_candidate_current_user_v1(
  'a3470000-0000-4000-8000-000000000003',
  (select official_action_version from public.refund_cases
    where id='a3470000-0000-4000-8000-000000000003'),
  'a3480000-0000-4000-8000-000000000020',null);
select pg_temp.set_actor('a3410000-0000-4000-8000-000000000003');
create temp table success_approval as select public.admin_approve_selected_nayax_refund_for_system_v1(
  'a3470000-0000-4000-8000-000000000003',
  (select official_action_version from public.refund_cases
    where id='a3470000-0000-4000-8000-000000000003')) result;
create temp table success_claim as select public.service_claim_due_nayax_refund_attempts_v1(
  'single-gate-executor','SINGLE_GATE_ACCOUNT','exact_source','empty_string',1) result;
select public.service_hold_nayax_refund_attempt_v1('single-gate-executor',
  (select (result->>'attemptId')::uuid from success_approval),'provider_result_unknown');
insert into public.refund_gmail_threads(id,refund_case_id,mailbox_hash,provider_thread_id,
  thread_subject,first_message_at,latest_message_at,retention_expires_at)
values('a3490000-0000-4000-8000-000000000002','a3470000-0000-4000-8000-000000000003',
  repeat('c',64),'single-gate-success-thread','Original success evidence thread',
  statement_timestamp()-interval '2 days',statement_timestamp()-interval '2 days',
  statement_timestamp()+interval '180 days');
update public.reporting_machine_refund_managers set status='revoked',revoked_at=statement_timestamp(),
  revoke_reason='Fixture manager reassignment'
where manager_user_id='a3410000-0000-4000-8000-000000000003'
  and reporting_machine_id='a3440000-0000-4000-8000-000000000001';
update public.reporting_machine_refund_managers set status='active',revoked_at=null,revoke_reason=null
where manager_user_id='a3410000-0000-4000-8000-000000000002'
  and reporting_machine_id='a3440000-0000-4000-8000-000000000001';
select pg_temp.set_actor('a3410000-0000-4000-8000-000000000001');
select is((public.admin_record_nayax_system_outcome_evidence_v1(
  'a3470000-0000-4000-8000-000000000003',
  (select (result->>'attemptId')::uuid from success_approval),
  'provider_confirmed_success','nayax_dtm_transaction','DTM:NAYAX-987654321',
  statement_timestamp(),'America/Los_Angeles','nayax_dtm_settled',
  (select official_action_version from public.refund_cases
    where id='a3470000-0000-4000-8000-000000000003'))->>'authorizationMethod'),
  'original_manager_approval',
  'exact success evidence completes after approver reassignment without another manager gate');
select ok((select status='completed' and decision='approved' and reporting_adjustment_id is not null
    from public.refund_cases where id='a3470000-0000-4000-8000-000000000003')
  and (select status='succeeded' and provider_outcome='success' and completion_message_id is not null
    from public.refund_case_nayax_refund_attempts
    where refund_case_id='a3470000-0000-4000-8000-000000000003')
  and exists(select 1 from public.refund_nayax_system_success_evidence
    where refund_case_id='a3470000-0000-4000-8000-000000000003'),
  'success evidence preserves settlement, adjustment, completion, and pending customer message semantics');
select ok((select source_timezone='America/Los_Angeles'
    from public.refund_nayax_system_success_evidence
    where refund_case_id='a3470000-0000-4000-8000-000000000003')
  and (select metadata->>'evidence_source_timezone'='America/Los_Angeles'
    from public.refund_case_events
    where refund_case_id='a3470000-0000-4000-8000-000000000003'
      and event_type='nayax_support_resolution_completed'
    order by created_at desc limit 1),
  'success evidence stores the provider source timezone in the proof and event');
select ok((select count(*)=1 from public.refund_case_official_action_authorizations
    where refund_case_id='a3470000-0000-4000-8000-000000000003' and action='approve')
  and (select count(*)=0 from public.refund_nayax_resolution_intents
    where refund_case_id='a3470000-0000-4000-8000-000000000003')
  and (select count(*)=1 from public.refund_case_nayax_refund_attempts
    where refund_case_id='a3470000-0000-4000-8000-000000000003'),
  'success reconciliation creates no second financial authorization, intent, or attempt');

insert into public.refund_nayax_lookup_candidates(token,refund_case_id,lookup_generation,actor_user_id,
  reporting_machine_id,provider_transaction_id,site_id,machine_authorization_time,amount_cents,
  card_last4,currency_code,evidence_summary,expires_at)
values('a3480000-0000-4000-8000-000000000002','a3470000-0000-4000-8000-000000000002',1,
  'a3410000-0000-4000-8000-000000000001','a3440000-0000-4000-8000-000000000001',
  'MANUAL-HISTORICAL',17,'2026-09-12T20:00:00Z',1090,'4242','USD',
  pg_temp.request_bound_evidence('manual_nayax_portal'),now()+interval '1 hour');
select matches(pg_temp.capture_error(format('select public.admin_select_refund_nayax_candidate_current_user_v1(%L,%s,%L,null)',
  'a3470000-0000-4000-8000-000000000002',(select official_action_version from public.refund_cases where id='a3470000-0000-4000-8000-000000000002'),
  'a3480000-0000-4000-8000-000000000002')),'^P4626:.*','manual candidate source is rejected');

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
select ok((select relrowsecurity from pg_catalog.pg_class
    where oid='public.refund_nayax_no_refund_proofs'::regclass)
  and (select relrowsecurity from pg_catalog.pg_class
    where oid='public.refund_nayax_system_success_evidence'::regclass)
  and not has_table_privilege('anon','public.refund_nayax_no_refund_proofs','select')
  and not has_table_privilege('authenticated','public.refund_nayax_no_refund_proofs','select')
  and not has_table_privilege('service_role','public.refund_nayax_no_refund_proofs','select')
  and not has_table_privilege('anon','public.refund_nayax_system_success_evidence','select')
  and not has_table_privilege('authenticated','public.refund_nayax_system_success_evidence','select')
  and not has_table_privilege('service_role','public.refund_nayax_system_success_evidence','select'),
  'both private System evidence tables have RLS enabled with runtime grants revoked');
select ok(has_function_privilege('authenticated',
    'public.admin_dispute_refund_nayax_preselection_current_user_v1(uuid,bigint)','execute')
  and not has_function_privilege('anon',
    'public.admin_dispute_refund_nayax_preselection_current_user_v1(uuid,bigint)','execute')
  and not has_function_privilege('service_role',
    'public.admin_dispute_refund_nayax_preselection_current_user_v1(uuid,bigint)','execute'),
  'only authenticated case workers can call the auth-bound preselection dispute RPC');

select * from finish();
rollback;
