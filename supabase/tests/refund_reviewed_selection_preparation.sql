begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select plan(10);

create function pg_temp.set_actor(p_user_id uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub',p_user_id::text,true);
  perform set_config('request.jwt.claim.role','authenticated',true);
  perform set_config('request.jwt.claims',jsonb_build_object(
    'sub',p_user_id,'role','authenticated','is_anonymous',false,
    'aal','aal2','amr',jsonb_build_array(jsonb_build_object(
      'method','totp','timestamp',extract(epoch from statement_timestamp()))))::text,true);
end $$;

create function pg_temp.selection_evidence(
  p_recommended boolean,p_rank integer,p_transaction_id text
) returns jsonb language sql stable as $$
  select jsonb_build_object(
    'source','nayax_api','selection_allowed',true,
    'is_recommended',p_recommended,'one_click_eligible',false,
    'recommendation_state','ambiguous','confidence_class','evidence_aware_review',
    'policy_version','2026-09-05.v11',
    'identifier_policy_version','2026-09-05.identifier.v2',
    'customer_fact_version',1,
    'customer_credential_class','customer_physical_contactless_pan',
    'provider_identifier_class','last_sales_present_identifier_unverified',
    'card_last4_comparison','exact_support','card_network_comparison','missing',
    'payment_interaction_comparison','unknown',
    'same_identifier_equivalence_proven',false,
    'identifier_review_state','exact_support',
    'customer_correction_fields','[]'::jsonb,
    'hard_exclusions','[]'::jsonb,'manual_review_reasons','[]'::jsonb,
    'reason_codes','["machine_exact","provider_sale_approved"]'::jsonb,
    'match_factors','[]'::jsonb,'match_reason','Reviewed selection fixture',
    'recommendation_rank',p_rank,'is_top_ranked',p_rank=1,
    'lookup_account_scope','REVIEWED_SELECTION_ACCOUNT',
    'lookup_provider_machine_id','REVIEWED-SELECTION-MACHINE',
    'provider_machine_id','REVIEWED-SELECTION-MACHINE',
    'machine_authorization_time_raw','2026-09-20T20:00:00Z',
    'machine_authorization_at','2026-09-20T20:00:00Z',
    'machine_authorization_time_source','MachineAuthorizationTime',
    'machine_time_resolution','exact','provider_time_resolution','exact',
    'provider_time_source','authorization_gmt','authorized_at','2026-09-20T20:00:00Z',
    'customer_request_received_at',null,'customer_request_received_source',null,
    'transaction_occurrence_proof_source',null,
    'transaction_occurrence_timestamp_source',null,
    'transaction_occurrence_timezone_basis',null,
    'transaction_occurrence_lower_bound_at',null,
    'transaction_occurrence_upper_bound_at',null,
    'request_receipt_lower_bound_at',null,'request_receipt_upper_bound_at',null)
  || jsonb_build_object(
    'request_time_boundary','request_time_unknown',
    'transaction_occurrence_comparable',false,
    'transaction_occurrence_semantics','unknown','time_delta_minutes',null,
    'amount_delta_cents',90,'provider_processing_time_delta_minutes',0,
    'payment_status','approved','payment_status_evidence','last_sales_contract',
    'provider_refund_state','clear','duplicate_provider_record',false,
    'card_last4','4242','currency_code','USD','amount_cents',1090,
    'provider_transaction_reference',p_transaction_id)
$$;

insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data)
values
('fa010000-0000-4000-8000-000000000001','authenticated','authenticated',
 'caseworker@example.invalid','{}','{}'),
('fa010000-0000-4000-8000-000000000002','authenticated','authenticated',
 'manager@example.invalid','{}','{}');
insert into public.customer_accounts(id,name,account_type)
values('fa020000-0000-4000-8000-000000000001','Reviewed selection fixture','internal');
insert into public.reporting_locations(id,account_id,name,timezone)
values('fa030000-0000-4000-8000-000000000001',
 'fa020000-0000-4000-8000-000000000001','Reviewed selection location','America/Los_Angeles');
insert into public.reporting_machines(
 id,account_id,location_id,machine_label,status,nayax_machine_id,
 nayax_account_key,nayax_refunds_enabled)
values('fa040000-0000-4000-8000-000000000001',
 'fa020000-0000-4000-8000-000000000001','fa030000-0000-4000-8000-000000000001',
 'Reviewed selection machine','active','REVIEWED-SELECTION-MACHINE',
 'REVIEWED_SELECTION_ACCOUNT',true);
insert into public.reporting_machine_refund_managers(
 id,reporting_machine_id,manager_user_id,manager_email,grant_reason)
values('fa050000-0000-4000-8000-000000000001',
 'fa040000-0000-4000-8000-000000000001','fa010000-0000-4000-8000-000000000002',
 'manager@example.invalid','Reviewed selection fixture');
insert into public.admin_scoped_access_grants(id,user_id,grant_reason)
values('fa060000-0000-4000-8000-000000000001',
 'fa010000-0000-4000-8000-000000000001','Reviewed selection fixture');
insert into public.admin_scoped_access_scopes(
 grant_id,scope_type,machine_id,grant_reason)
values('fa060000-0000-4000-8000-000000000001','machine',
 'fa040000-0000-4000-8000-000000000001','Reviewed selection fixture');

insert into public.refund_cases(
 id,public_reference,reporting_machine_id,reporting_location_id,customer_email,
 issue_summary,incident_at,incident_timezone,incident_time_resolution,
 incident_time_confidence,payment_method,payment_amount_cents,card_last4,
 card_last4_provenance,card_wallet_used,payment_interaction,status,
 correlation_status,deterministic_fact_version,intake_source,intake_meta,
 nayax_lookup_generation,nayax_lookup_status,nayax_recommendation_state,
 nayax_refund_execution_status)
values('fa070000-0000-4000-8000-000000000001','RF-REVIEWED-SELECTION',
 'fa040000-0000-4000-8000-000000000001','fa030000-0000-4000-8000-000000000001',
 'reviewed@example.invalid','Reviewed exact purchase','2026-09-20T20:00:00Z',
 'America/Los_Angeles','exact','exact','card',1000,'4242','physical_card',false,
 'tap_card','needs_review','needs_nayax',1,'form','{}',1,'multiple_matches',
 'ambiguous','not_requested');
insert into public.refund_nayax_lookup_candidates(
 token,refund_case_id,lookup_generation,actor_user_id,reporting_machine_id,
 provider_transaction_id,site_id,machine_authorization_time,amount_cents,
 card_last4,currency_code,evidence_summary,expires_at)
values
('fa080000-0000-4000-8000-000000000001','fa070000-0000-4000-8000-000000000001',
 1,'fa010000-0000-4000-8000-000000000001','fa040000-0000-4000-8000-000000000001',
 'REVIEWED-SALE',17,'2026-09-20T20:00:00Z',1090,'4242','USD',
 pg_temp.selection_evidence(false,2,'REVIEWED-SALE'),statement_timestamp()+interval '40 days');

select is(public.refund_decision_recommendation_for_case(
 'fa070000-0000-4000-8000-000000000001'),null::jsonb,
 'ambiguous evidence has no recommendation before an exact reviewed selection');
set local role authenticated;
select pg_temp.set_actor('fa010000-0000-4000-8000-000000000001');
select is((public.admin_select_refund_nayax_candidate_current_user_v1(
 'fa070000-0000-4000-8000-000000000001',
 (select official_action_version from public.refund_cases
  where id='fa070000-0000-4000-8000-000000000001'),
 'fa080000-0000-4000-8000-000000000001','correct_amount')
 ->>'selectionApplied'),'true','a case worker can select one reviewed transaction');
reset role;
select is((select decision from public.refund_cases
 where id='fa070000-0000-4000-8000-000000000001'),null::text,
 'reviewed selection preserves the Manager decision boundary');

create temporary table reviewed_proof on commit drop as
select id,metadata from public.refund_case_events
where refund_case_id='fa070000-0000-4000-8000-000000000001'
 and event_type='nayax_match_selected'
order by created_at desc,id desc limit 1;
update public.refund_case_events set metadata=metadata-'candidate_token'
 -'candidate_evidence_hash'-'lookup_generation'-'deterministic_fact_version',
 created_at=statement_timestamp()-interval '2 minutes'
where id=(select id from reviewed_proof);
select is(public.refund_manager_preparation_snapshot(
 'fa070000-0000-4000-8000-000000000001',
 (select official_action_version from public.refund_cases
  where id='fa070000-0000-4000-8000-000000000001')),null::jsonb,
 'legacy selection metadata cannot prepare a Manager recommendation');

insert into public.refund_case_events(
 refund_case_id,actor_user_id,event_type,message,metadata,created_at)
select 'fa070000-0000-4000-8000-000000000001',
 'fa010000-0000-4000-8000-000000000002','nayax_match_selected',
 'Synthetic current-shaped proof from the wrong actor.',metadata,
 statement_timestamp()-interval '1 minute'
from reviewed_proof;
select is(public.refund_decision_recommendation_for_case(
 'fa070000-0000-4000-8000-000000000001'),null::jsonb,
 'a current-shaped proof from the wrong actor stays in research');

set local role authenticated;
select pg_temp.set_actor('fa010000-0000-4000-8000-000000000001');
select is((public.admin_select_refund_nayax_candidate_current_user_v1(
 'fa070000-0000-4000-8000-000000000001',
 (select official_action_version from public.refund_cases
  where id='fa070000-0000-4000-8000-000000000001'),
 'fa080000-0000-4000-8000-000000000001','correct_amount')
 ->>'currentSelectionProofRefreshed'),'true',
 'an exact replay refreshes one current actor-bound selection proof');
reset role;
select is(public.refund_decision_recommendation_for_case(
 'fa070000-0000-4000-8000-000000000001')->>'kind','refund',
 'one exact current actor-reviewed transaction recommends a refund');
select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claims','{}',true);
set local role service_role;
select is(public.refund_lifecycle_contract(
 'fa070000-0000-4000-8000-000000000001')#>>'{nextWork,actionCode}',
 'approve_or_deny_request',
 'the reviewed purchase advances to the existing Manager decision path');
reset role;
select ok((select c.decision is null
   and not exists(select 1 from public.refund_case_nayax_refund_attempts a
     where a.refund_case_id=c.id)
   and not exists(select 1 from public.refund_case_messages m
     where m.refund_case_id=c.id)
   and exists(select 1 from public.refund_case_events e
     where e.refund_case_id=c.id and e.event_type='nayax_match_selected'
       and e.actor_user_id='fa010000-0000-4000-8000-000000000001'
       and e.metadata->>'proof_refresh'='true'
       and e.metadata->>'provider_call_made'='false'
       and e.metadata->>'customer_message_created'='false')
 from public.refund_cases c where c.id='fa070000-0000-4000-8000-000000000001'),
 'proof refresh has no decision, payment attempt, provider call, or customer message');
update public.refund_cases
set payment_amount_cents=1100
where id='fa070000-0000-4000-8000-000000000001';
select is(public.refund_decision_recommendation_for_case(
 'fa070000-0000-4000-8000-000000000001'),null::jsonb,
 'a later case fact invalidates the advisory recommendation');

select * from finish();
rollback;
