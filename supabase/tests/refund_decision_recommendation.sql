begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select plan(36);

create function pg_temp.set_actor(p_user_id uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub',p_user_id::text,true);
  perform set_config('request.jwt.claim.role','authenticated',true);
  perform set_config('request.jwt.claims',jsonb_build_object(
    'sub',p_user_id,'role','authenticated','aal','aal2',
    'amr',jsonb_build_array(jsonb_build_object(
      'method','totp','timestamp',extract(epoch from statement_timestamp()))))::text,true);
end $$;

select is(public.refund_rejection_wait_clock(
  null,null,false,'2026-02-01T00:00:00Z'),null::jsonb,
  'never-contacted cases have no rejection clock');
select is(public.refund_rejection_wait_clock(
  '2026-01-01T00:00:00Z',null,false,'2026-01-30T23:59:59Z')->>'eligible',
  'false','29 days is not rejection-ready');
select is(public.refund_rejection_wait_clock(
  '2026-01-01T00:00:00Z',null,false,'2026-01-31T00:00:00Z')->>'eligible',
  'true','the exact 30-day boundary is rejection-ready');
select is(public.refund_rejection_wait_clock(
  '2026-01-01T00:00:00Z','2026-01-11T00:00:00Z',false,
  '2026-01-31T00:00:00Z')->>'eligibleAt',
  '2026-02-10T00:00:00+00:00','meaningful input resets the clock from the later fact');
select is(public.refund_rejection_wait_clock(
  '2026-01-01T00:00:00Z',null,false,'2026-01-31T00:00:00Z')->>'waitingSince',
  '2026-01-01T00:00:00+00:00','no meaningful input or reminder resets delivery time');
select is(public.refund_rejection_wait_clock(
  '2026-01-01T00:00:00Z',null,true,'2026-02-01T00:00:00Z'),null::jsonb,
  'an unreviewed customer reply blocks rejection');
select ok(
  has_function_privilege('service_role',
    'public.refund_decision_recommendation_for_case(uuid,timestamptz)','execute')
  and not has_function_privilege('authenticated',
    'public.refund_decision_recommendation_for_case(uuid,timestamptz)','execute')
  and not has_function_privilege('anon',
    'public.refund_rejection_wait_clock(timestamptz,timestamptz,boolean,timestamptz)','execute'),
  'recommendation evidence is service-only');

insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data)
values
('f1010000-0000-4000-8000-000000000001','authenticated','authenticated',
  'decision-manager@example.invalid','{}','{}'),
('f1010000-0000-4000-8000-000000000002','authenticated','authenticated',
  'decision-manager-two@example.invalid','{}','{}');
insert into public.customer_accounts(id,name,account_type)
values('f1020000-0000-4000-8000-000000000001','Decision fixtures','internal');
insert into public.reporting_locations(id,account_id,name,timezone)
values('f1030000-0000-4000-8000-000000000001',
  'f1020000-0000-4000-8000-000000000001','Decision location','America/Los_Angeles');
insert into public.reporting_machines(
  id,account_id,location_id,machine_label,status,nayax_machine_id,
  nayax_account_key,nayax_refunds_enabled,sunze_machine_id
) values
('f1040000-0000-4000-8000-000000000001','f1020000-0000-4000-8000-000000000001',
 'f1030000-0000-4000-8000-000000000001','Card decision','active',
 'DECISION-CARD','DECISION_ACCOUNT',true,null),
('f1040000-0000-4000-8000-000000000002','f1020000-0000-4000-8000-000000000001',
 'f1030000-0000-4000-8000-000000000001','Cash clear','active',
 null,null,false,'DECISION-CASH-CLEAR'),
('f1040000-0000-4000-8000-000000000003','f1020000-0000-4000-8000-000000000001',
 'f1030000-0000-4000-8000-000000000001','Cash ambiguous','active',
 null,null,false,'DECISION-CASH-AMBIGUOUS'),
('f1040000-0000-4000-8000-000000000004','f1020000-0000-4000-8000-000000000001',
 'f1030000-0000-4000-8000-000000000001','Missing manager','active',
 'DECISION-NO-MANAGER','DECISION_ACCOUNT',true,null);
insert into public.reporting_machine_refund_managers(
  reporting_machine_id,manager_user_id,manager_email,grant_reason)
values
('f1040000-0000-4000-8000-000000000001','f1010000-0000-4000-8000-000000000001',
 'decision-manager@example.invalid','Fixture'),
('f1040000-0000-4000-8000-000000000001','f1010000-0000-4000-8000-000000000002',
 'decision-manager-two@example.invalid','Second valid machine Manager'),
('f1040000-0000-4000-8000-000000000002','f1010000-0000-4000-8000-000000000001',
 'decision-manager@example.invalid','Fixture'),
('f1040000-0000-4000-8000-000000000003','f1010000-0000-4000-8000-000000000001',
 'decision-manager@example.invalid','Fixture');
insert into public.refund_nayax_machine_inventory(
  account_key,nayax_machine_id,reporting_machine_id)
values
('DECISION_ACCOUNT','DECISION-CARD','f1040000-0000-4000-8000-000000000001'),
('DECISION_ACCOUNT','DECISION-NO-MANAGER','f1040000-0000-4000-8000-000000000004');

create function pg_temp.card_evidence(
  p_machine text,p_amount integer,p_rank integer
) returns jsonb language sql stable as $$
select jsonb_build_object(
 'source','nayax_api','selection_allowed',true,'is_recommended',true,
 'one_click_eligible',false,'recommendation_state','high_confidence',
 'confidence_class','high_confidence','policy_version','2026-09-05.v11',
 'identifier_policy_version','2026-09-05.identifier.v2','customer_fact_version',1,
 'customer_credential_class','customer_physical_contactless_pan',
 'provider_identifier_class','last_sales_present_identifier_unverified',
 'card_last4_comparison','exact_support','card_network_comparison','missing',
 'payment_interaction_comparison','unknown','same_identifier_equivalence_proven',false,
 'identifier_review_state','exact_support','customer_correction_fields','[]'::jsonb,
 'hard_exclusions','[]'::jsonb,'manual_review_reasons','[]'::jsonb,
 'reason_codes','["machine_exact","provider_sale_approved"]'::jsonb,
 'match_factors','[]'::jsonb,'match_reason','Current machine sale',
 'recommendation_rank',p_rank,'is_top_ranked',p_rank=1,
 'lookup_account_scope','DECISION_ACCOUNT','lookup_provider_machine_id',p_machine,
 'provider_machine_id',p_machine,
 'machine_authorization_time_raw','2026-09-20T20:00:00Z',
 'machine_authorization_at','2026-09-20T20:00:00Z',
 'machine_authorization_time_source','MachineAuthorizationTime',
 'machine_time_resolution','exact','provider_time_resolution','exact',
 'provider_time_source','authorization_gmt','authorized_at','2026-09-20T20:00:00Z',
 'customer_request_received_at','2026-09-20T21:00:00Z',
 'customer_request_received_source','hosted_refund_intake',
 'transaction_occurrence_proof_source',null,
 'transaction_occurrence_timestamp_source',null,
 'transaction_occurrence_timezone_basis',null,
 'transaction_occurrence_lower_bound_at',null,
 'transaction_occurrence_upper_bound_at',null,
 'request_receipt_lower_bound_at',null,'request_receipt_upper_bound_at',null,
 'request_time_boundary','occurrence_time_uncertain') || jsonb_build_object(
 'transaction_occurrence_comparable',false,
 'transaction_occurrence_semantics','unknown','time_delta_minutes',null,
 'amount_delta_cents',p_amount-1000,'provider_processing_time_delta_minutes',0,
 'payment_status','approved','payment_status_evidence','last_sales_contract',
 'provider_refund_state','clear','duplicate_provider_record',false,
 'card_last4','4242','currency_code','USD','amount_cents',p_amount)
$$;

insert into public.refund_cases(
  id,public_reference,reporting_machine_id,reporting_location_id,customer_email,
  issue_summary,incident_at,incident_timezone,incident_time_resolution,
  incident_time_confidence,payment_method,payment_amount_cents,card_last4,
  card_last4_provenance,payment_interaction,status,correlation_status,
  deterministic_fact_version,intake_source,intake_meta,customer_request_received_at,
  customer_request_received_source,nayax_lookup_generation,nayax_lookup_status,
  nayax_refund_execution_status
) values
('f1050000-0000-4000-8000-000000000001','RF-DECISION-CLEAR',
 'f1040000-0000-4000-8000-000000000001','f1030000-0000-4000-8000-000000000001',
 'clear@example.invalid','Clear card','2026-09-20T20:00:00Z','America/Los_Angeles',
 'exact','exact','card',1000,'4242','physical_card','tap_card','needs_review',
 'needs_nayax',1,'form','{}','2026-09-20T21:00:00Z','hosted_refund_intake',
 0,'not_started','not_requested'),
('f1050000-0000-4000-8000-000000000002','RF-DECISION-AMBIGUOUS',
 'f1040000-0000-4000-8000-000000000001','f1030000-0000-4000-8000-000000000001',
 'ambiguous@example.invalid','Ambiguous card','2026-09-20T20:00:00Z','America/Los_Angeles',
 'exact','exact','card',1000,'4242','physical_card','tap_card','needs_review',
 'needs_nayax',1,'form','{}','2026-09-20T21:00:00Z','hosted_refund_intake',
 0,'not_started','not_requested'),
('f1050000-0000-4000-8000-000000000003','RF-DECISION-REJECT',
 'f1040000-0000-4000-8000-000000000001','f1030000-0000-4000-8000-000000000001',
 'reject@example.invalid','Missing amount','2026-09-20T20:00:00Z','America/Los_Angeles',
 'exact','exact','card',null,'4242','physical_card','tap_card','needs_review',
 'needs_nayax',1,'form','{}','2026-09-20T21:00:00Z','hosted_refund_intake',
 0,'not_started','not_requested'),
('f1050000-0000-4000-8000-000000000004','RF-DECISION-NO-MANAGER',
 'f1040000-0000-4000-8000-000000000004','f1030000-0000-4000-8000-000000000001',
 'no-manager@example.invalid','Clear without manager','2026-09-20T20:00:00Z',
 'America/Los_Angeles','exact','exact','card',1000,'4242','physical_card',
 'tap_card','needs_review','needs_nayax',1,'form','{}','2026-09-20T21:00:00Z',
 'hosted_refund_intake',0,'not_started','not_requested');
select public.service_begin_refund_nayax_lookup(
  id,deterministic_fact_version,'scheduled',null)
from public.refund_cases where id in (
 'f1050000-0000-4000-8000-000000000001',
 'f1050000-0000-4000-8000-000000000002',
 'f1050000-0000-4000-8000-000000000003',
 'f1050000-0000-4000-8000-000000000004');
insert into public.refund_nayax_lookup_candidates(
 token,refund_case_id,lookup_generation,actor_user_id,reporting_machine_id,
 provider_transaction_id,site_id,machine_authorization_time,amount_cents,
 card_last4,currency_code,evidence_summary,expires_at
) values
('f1060000-0000-4000-8000-000000000001','f1050000-0000-4000-8000-000000000001',
 1,null,'f1040000-0000-4000-8000-000000000001','CLEAR-SALE',17,
 '2026-09-20T20:00:00Z',1000,'4242','USD',
 pg_temp.card_evidence('DECISION-CARD',1000,1),statement_timestamp()+interval '40 days'),
('f1060000-0000-4000-8000-000000000002','f1050000-0000-4000-8000-000000000002',
 1,null,'f1040000-0000-4000-8000-000000000001','AMB-SALE-1',17,
 '2026-09-20T20:00:00Z',1000,'4242','USD',
 pg_temp.card_evidence('DECISION-CARD',1000,1),statement_timestamp()+interval '40 days'),
('f1060000-0000-4000-8000-000000000003','f1050000-0000-4000-8000-000000000002',
 1,null,'f1040000-0000-4000-8000-000000000001','AMB-SALE-2',17,
 '2026-09-20T20:00:00Z',1000,'4242','USD',
 pg_temp.card_evidence('DECISION-CARD',1000,2),statement_timestamp()+interval '40 days'),
('f1060000-0000-4000-8000-000000000004','f1050000-0000-4000-8000-000000000004',
 1,null,'f1040000-0000-4000-8000-000000000004','NO-MANAGER-SALE',17,
 '2026-09-20T20:00:00Z',1000,'4242','USD',
 pg_temp.card_evidence('DECISION-NO-MANAGER',1000,1),
 statement_timestamp()+interval '40 days');
select public.service_commit_refund_nayax_lookup(
 'f1050000-0000-4000-8000-000000000001',1,1,'manual_exception',
 'manual_exception','2026-09-05.v11',statement_timestamp(),
 'One independently recommended sale',null,1,'scheduled',null);
select public.service_commit_refund_nayax_lookup(
 'f1050000-0000-4000-8000-000000000002',1,1,'multiple_matches',
 'ambiguous','2026-09-05.v11',statement_timestamp(),
 'Two independently recommended sales',null,2,'scheduled',null);
select public.service_commit_refund_nayax_lookup(
 'f1050000-0000-4000-8000-000000000003',1,1,'no_match',
 'no_safe_match','2026-09-05.v11',statement_timestamp(),
 'No sale found',null,0,'scheduled',null);
select public.service_commit_refund_nayax_lookup(
 'f1050000-0000-4000-8000-000000000004',1,1,'manual_exception',
 'manual_exception','2026-09-05.v11',statement_timestamp(),
 'One independently recommended sale',null,1,'scheduled',null);

select is(public.refund_decision_recommendation_for_case(
 'f1050000-0000-4000-8000-000000000001')->>'kind','refund',
 'one genuinely high-confidence current Nayax sale recommends refund');
select ok((select r->>'schemaVersion'='refund_decision_recommendation_v1'
    and r->>'reasonCode'='clear_purchase_match'
    and r->>'officialActionVersion'=c.official_action_version::text
    and r->>'deterministicFactVersion'=c.deterministic_fact_version::text
    and r->>'payloadRedacted'='true'
    and r#>>'{purchase,source}'='nayax'
    and r#>>'{purchase,transactionAt}' is not null
    and r#>>'{purchase,timeMeaning}'='unknown'
    and r#>>'{purchase,candidateToken}'='f1060000-0000-4000-8000-000000000001'
  from public.refund_cases c cross join lateral
    public.refund_decision_recommendation_for_case(c.id) r
  where c.id='f1050000-0000-4000-8000-000000000001'),
  'card recommendation is versioned, redacted, and purchase-shaped');
set local role service_role;
select is(public.refund_lifecycle_contract(
 'f1050000-0000-4000-8000-000000000001')#>>'{nextWork,actionCode}',
 'approve_or_deny_request','clear recommendation becomes one Manager decision');
select ok((select c.assigned_manager_id is null and count(m.id)=2
  from public.refund_cases c
  join public.reporting_machine_refund_managers m
    on m.reporting_machine_id=c.reporting_machine_id
    and m.status='active' and m.revoked_at is null
  where c.id='f1050000-0000-4000-8000-000000000001'
  group by c.assigned_manager_id),
  'two valid machine Managers do not require an arbitrary case assignee');
select ok((select lifecycle#>>'{nextWork,actionCode}'='approve_or_deny_request'
    and lifecycle#>>'{managerQueue,nextAction}'='approve_or_deny_request'
    and lifecycle#>>'{managerQueue,bucket}'='needs_action'
    and lifecycle#>>'{managerQueue,label}'='Decision needed'
    and lifecycle->>'managerNextAction'='approve_or_deny_request'
    and lifecycle#>>'{managerAction,action}'='none'
  from (select public.refund_lifecycle_contract(
    'f1050000-0000-4000-8000-000000000001') lifecycle) q),
  'generic queue follows the canonical decision while the legacy action stays hidden');
select ok((select snapshot->>'schemaVersion'='refund_manager_ready_notice_v2'
    and snapshot->>'actionCode'='approve_or_deny_request'
    and snapshot->>'recommendationKind'='refund'
    and snapshot->>'recommendationReasonCode'='clear_purchase_match'
    and snapshot->>'evidenceBasis' in ('card_exact_selected','card_reviewed_candidate_set')
  from (select public.service_refund_manager_ready_notice_snapshot(
    'f1050000-0000-4000-8000-000000000001',
    'f1010000-0000-4000-8000-000000000001') snapshot) q),
  'ready notice consumes the current card refund recommendation');
reset role;
delete from public.reporting_machine_refund_managers
where reporting_machine_id='f1040000-0000-4000-8000-000000000001'
  and manager_user_id='f1010000-0000-4000-8000-000000000002';
select is(public.refund_manager_decision_material_fingerprint(
    'f1050000-0000-4000-8000-000000000001','approve_or_deny_request'),
  public.refund_manager_decision_fingerprint_pre_recommendation_v1(
    'f1050000-0000-4000-8000-000000000001','approve_or_deny_request'),
  'an unchanged card decision preserves its prior one-notice identity');
select is(public.refund_decision_recommendation_for_case(
 'f1050000-0000-4000-8000-000000000002'),null::jsonb,
 'two recommended candidates remain ambiguous despite candidate count');
set local role service_role;
select is(public.refund_lifecycle_contract(
 'f1050000-0000-4000-8000-000000000002')#>>'{nextWork,actionCode}',
 'research_purchase','ambiguous reviewed sets stay in Agent research');
select is(public.refund_lifecycle_contract(
 'f1050000-0000-4000-8000-000000000004')#>>'{nextWork,actionCode}',
 'resolve_manager_assignment','clear evidence without a Manager routes to assignment repair');
reset role;

insert into public.sales_import_runs(
 id,source,status,rows_seen,rows_imported,meta,completed_at)
values('f1070000-0000-4000-8000-000000000001','sunze_browser','completed',3,3,
 '{"payment_time_semantics_status":"validated","payment_time_timezone":"America/Los_Angeles","timestamp_proof_scope":"account","machine_coverage_verified":true,"visible_machine_count_mismatch":false}',
 statement_timestamp()-interval '10 minutes');
insert into public.sunze_cash_source_watermarks(
 reporting_machine_id,coverage_started_at,covered_through,last_successful_import_at,
 freshness_expires_at,payment_time_basis,payment_time_timezone,
 timestamp_proof_scope,import_run_id)
values
('f1040000-0000-4000-8000-000000000002',statement_timestamp()-interval '12 hours',
 statement_timestamp()+interval '1 hour',statement_timestamp()-interval '10 minutes',
 statement_timestamp()+interval '1 day','validated_iana_timezone',
 'America/Los_Angeles','account','f1070000-0000-4000-8000-000000000001'),
('f1040000-0000-4000-8000-000000000003',statement_timestamp()-interval '12 hours',
 statement_timestamp()+interval '1 hour',statement_timestamp()-interval '10 minutes',
 statement_timestamp()+interval '1 day','validated_iana_timezone',
 'America/Los_Angeles','account','f1070000-0000-4000-8000-000000000001');
insert into public.machine_sales_facts(
 id,reporting_machine_id,reporting_location_id,sale_date,payment_method,
 net_sales_cents,transaction_count,source,source_row_hash,source_order_hash,
 import_run_id,payment_time,source_payment_status,raw_payload)
values
('f1080000-0000-4000-8000-000000000001','f1040000-0000-4000-8000-000000000002',
 'f1030000-0000-4000-8000-000000000001',(statement_timestamp()-interval '5 hours')::date,
 'cash',800,1,'sunze_browser','decision-clear','decision-clear-order',
 'f1070000-0000-4000-8000-000000000001',statement_timestamp()-interval '5 hours',
 'Payment success','{}'),
('f1080000-0000-4000-8000-000000000002','f1040000-0000-4000-8000-000000000003',
 'f1030000-0000-4000-8000-000000000001',(statement_timestamp()-interval '5 hours')::date,
 'cash',700,1,'sunze_browser','decision-amb-1','decision-amb-order-1',
 'f1070000-0000-4000-8000-000000000001',statement_timestamp()-interval '5 hours',
 'Payment success','{}'),
('f1080000-0000-4000-8000-000000000003','f1040000-0000-4000-8000-000000000003',
 'f1030000-0000-4000-8000-000000000001',(statement_timestamp()-interval '5 hours')::date,
 'cash',700,1,'sunze_browser','decision-amb-2','decision-amb-order-2',
 'f1070000-0000-4000-8000-000000000001',statement_timestamp()-interval '5 hours'+interval '5 minutes',
 'Payment success','{}');
insert into public.refund_cases(
 id,public_reference,reporting_machine_id,reporting_location_id,customer_email,
 issue_summary,incident_at,incident_timezone,payment_method,payment_amount_cents,
 refund_amount_cents,zelle_payment_contact,status,correlation_status)
values
('f1050000-0000-4000-8000-000000000011','RF-DECISION-CASH-CLEAR',
 'f1040000-0000-4000-8000-000000000002','f1030000-0000-4000-8000-000000000001',
 'cash-clear@example.invalid','Clear cash',statement_timestamp()-interval '5 hours',
 'America/Los_Angeles','cash',800,800,'cash-clear@example.invalid','needs_review','manual_review'),
('f1050000-0000-4000-8000-000000000012','RF-DECISION-CASH-AMB',
 'f1040000-0000-4000-8000-000000000003','f1030000-0000-4000-8000-000000000001',
 'cash-amb@example.invalid','Ambiguous cash',statement_timestamp()-interval '5 hours',
 'America/Los_Angeles','cash',700,700,'cash-amb@example.invalid','needs_review','manual_review');
select public.service_correlate_sunze_cash_case(
 'f1050000-0000-4000-8000-000000000011',1,'intake',null,statement_timestamp());
select public.service_correlate_sunze_cash_case(
 'f1050000-0000-4000-8000-000000000012',1,'intake',null,statement_timestamp());
select is(public.refund_decision_recommendation_for_case(
 'f1050000-0000-4000-8000-000000000011')#>>'{purchase,source}','sunze',
 'one linked current Sunze payment-success sale recommends refund');
select is(public.refund_decision_recommendation_for_case(
 'f1050000-0000-4000-8000-000000000012'),null::jsonb,
 'multiple Sunze sales do not recommend a purchase');
set local role service_role;
select is(public.refund_lifecycle_contract(
 'f1050000-0000-4000-8000-000000000012')#>>'{nextWork,actionCode}',
 'research_purchase',
 'multiple current Sunze candidates stay in Agent research');
select is(public.service_refund_manager_ready_notice_snapshot(
  'f1050000-0000-4000-8000-000000000012',
  'f1010000-0000-4000-8000-000000000001'),null::jsonb,
  'unapproved ambiguous cash research cannot emit a payout notice');
select ok((select snapshot->>'actionCode'='approve_or_deny_request'
    and snapshot->>'recommendationKind'='refund'
    and snapshot->>'evidenceBasis'='cash_sale_found'
    and snapshot->>'proofId' is not null
  from (select public.service_refund_manager_ready_notice_snapshot(
    'f1050000-0000-4000-8000-000000000011',
    'f1010000-0000-4000-8000-000000000001') snapshot) q),
  'cash purchase recommendation is a decision notice, not a payout notice');
select ok((select item->>'actionCode'='approve_or_deny_request'
    and item->>'recommendationKind'='refund'
    and item->>'evidenceBasis'='cash_sale_found'
  from jsonb_array_elements(public.refund_manager_daily_digest_projection_for(
    'f1010000-0000-4000-8000-000000000001')->'items') item
  where item->>'caseId'='f1050000-0000-4000-8000-000000000011'),
  'daily digest renders the cash match as a Manager decision');
reset role;
insert into public.sales_import_runs(
 id,source,status,rows_seen,rows_imported,meta,completed_at)
values('f1070000-0000-4000-8000-000000000002','sunze_browser','completed',0,0,
 '{"payment_time_semantics_status":"validated","payment_time_timezone":"America/Los_Angeles","timestamp_proof_scope":"account","machine_coverage_verified":true,"visible_machine_count_mismatch":false}',
 statement_timestamp());
insert into public.sunze_cash_source_watermarks(
 reporting_machine_id,coverage_started_at,covered_through,last_successful_import_at,
 freshness_expires_at,payment_time_basis,payment_time_timezone,
 timestamp_proof_scope,import_run_id)
values('f1040000-0000-4000-8000-000000000002',
 statement_timestamp()-interval '12 hours',statement_timestamp()+interval '1 hour',
 statement_timestamp(),statement_timestamp()+interval '1 day',
 'validated_iana_timezone','America/Los_Angeles','account',
 'f1070000-0000-4000-8000-000000000002');
select is(public.refund_decision_recommendation_for_case(
 'f1050000-0000-4000-8000-000000000011'),null::jsonb,
 'a new Sunze source snapshot invalidates the old sale recommendation');
update public.refund_cases set decision='approved',status='cash_zelle_pending'
where id='f1050000-0000-4000-8000-000000000011';
set local role service_role;
select is(public.refund_next_work_for_case(
 'f1050000-0000-4000-8000-000000000011',
 jsonb_build_object('payloadRedacted',true,'stage','awaiting_payout',
   'reasonCode','external_payment_ready','terminal',false,
   'managerAction',jsonb_build_object('action','mark_external_refund')))
 #>>'{nextWork,actionCode}','send_cash_refund_and_confirm',
 'a prior approved cash case preserves payout execution');
reset role;

insert into public.refund_cases(
 id,public_reference,reporting_machine_id,reporting_location_id,customer_email,
 issue_summary,incident_at,payment_method,payment_amount_cents,refund_amount_cents,
 card_last4,status,decision,correlation_status,correlation_source,
 nayax_refund_execution_status,nayax_match_execution_eligible)
values('f1050000-0000-4000-8000-000000000020','RF-DECISION-PAID-UNKNOWN',
 'f1040000-0000-4000-8000-000000000001','f1030000-0000-4000-8000-000000000001',
 'paid-unknown@example.invalid','Provider outcome unknown',statement_timestamp()-interval '1 hour',
 'card',700,700,'4242','card_refund_pending','approved','matched','nayax',
 'requested',false);
insert into public.refund_case_nayax_refund_attempts(
 id,refund_case_id,execution_mode,status,idempotency_key,amount_cents,
 request_fingerprint,provider_claim_digest,provider_claim_expires_at,
 reconciliation_required,created_at)
values('f1090000-0000-4000-8000-000000000001',
 'f1050000-0000-4000-8000-000000000020','request_and_approve','requested',
 'decision-paid-unknown',700,repeat('1',64),repeat('2',64),
 statement_timestamp()+interval '10 minutes',true,statement_timestamp()-interval '3 minutes');
select is(public.refund_decision_recommendation_for_case(
 'f1050000-0000-4000-8000-000000000020'),null::jsonb,
 'an existing provider attempt cannot receive a fresh recommendation');
set local role service_role;
select is(public.refund_next_work_for_case(
 'f1050000-0000-4000-8000-000000000020',
 jsonb_build_object('payloadRedacted',true,'stage','needs_refund_operations',
   'reasonCode','provider_outcome_unknown','terminal',false,'paymentState','pending',
   'managerAction',jsonb_build_object('action','none')))
 #>>'{nextWork,actionCode}','reconcile_provider_outcome',
 'provider-outcome recovery remains the paid-unknown next work');
reset role;
update public.refund_cases set payment_amount_cents=1100
where id='f1050000-0000-4000-8000-000000000001';
select is(public.refund_decision_recommendation_for_case(
 'f1050000-0000-4000-8000-000000000001'),null::jsonb,
 'a fact-version change invalidates the earlier card recommendation');

update public.refund_customer_contact_settings
set automatic_customer_contact_enabled=true where singleton;
create temporary table reject_cycle on commit drop as
select (public.service_claim_refund_follow_up_cycle(
 'f1050000-0000-4000-8000-000000000003','missing_information',
 'refund_follow_up_v2',repeat('a',64),null)#>>'{cycle,id}')::uuid id;
insert into public.refund_case_messages(
 id,refund_case_id,message_type,status,recipient_email,subject,body,
 content_source,delivery_kind,reason_code,template_version,
 follow_up_cycle_id,requested_fields,sent_at)
select 'f1100000-0000-4000-8000-000000000001',
 'f1050000-0000-4000-8000-000000000003','more_info','sent',
 'reject@example.invalid','One purchase detail','Please reply with the amount.',
 'deterministic_template','automatic','missing_information','refund_follow_up_v2',
 id,array['amount'],statement_timestamp()-interval '31 days' from reject_cycle;
insert into public.refund_gmail_threads(
 id,refund_case_id,mailbox_hash,provider_thread_id,thread_subject,
 first_message_at,latest_message_at,retention_expires_at)
values('f1110000-0000-4000-8000-000000000001',
 'f1050000-0000-4000-8000-000000000003',repeat('b',64),
 'decision-reject-thread','Decision reject',statement_timestamp()-interval '31 days',
 statement_timestamp()-interval '31 days',statement_timestamp()+interval '90 days');
insert into public.refund_gmail_messages(
 id,gmail_thread_id,refund_case_id,refund_case_message_id,provider_message_id,
 direction,message_kind,status,sender_email,recipient_email,subject,plain_body,
 received_at,sent_at,retention_expires_at,participant_role,participant_trust)
values('f1120000-0000-4000-8000-000000000001',
 'f1110000-0000-4000-8000-000000000001',
 'f1050000-0000-4000-8000-000000000003',
 'f1100000-0000-4000-8000-000000000001','provider-reject-question',
 'outbound','message','sent','refunds@example.invalid','reject@example.invalid',
 'One purchase detail','Please reply with the amount.',
 statement_timestamp()-interval '31 days',
 statement_timestamp()-interval '31 days',
 statement_timestamp()+interval '90 days','mailbox','verified');
select is(public.refund_decision_recommendation_for_case(
 'f1050000-0000-4000-8000-000000000003',statement_timestamp()-interval '2 days'),
 null::jsonb,'full no-match projection is not ready before the recorded research');
select is(public.refund_decision_recommendation_for_case(
 'f1050000-0000-4000-8000-000000000003',statement_timestamp())
 ->>'kind','reject','full no-match projection is ready after 30 days');
set local role service_role;
select ok((select lifecycle#>>'{nextWork,actionCode}'='reject_request'
    and lifecycle#>>'{decisionRecommendation,decisionReady}'='true'
  from (select public.refund_next_work_for_case(
    'f1050000-0000-4000-8000-000000000003',
    jsonb_build_object('payloadRedacted',true,'stage','matching',
      'terminal',false,'managerAction',jsonb_build_object('action','none'),
      'customerOutreach',public.refund_customer_outreach_contract(
        'f1050000-0000-4000-8000-000000000003'))) lifecycle) q),
  'eligible no-match recommendation exposes one Manager reject action');
select ok((select snapshot->>'actionCode'='reject_request'
    and snapshot->>'recommendationKind'='reject'
    and snapshot->>'recommendationReasonCode'='no_match_after_30_days'
    and snapshot->>'proofId' is null
    and snapshot->'amountCents'='null'::jsonb
    and snapshot->'currencyCode'='null'::jsonb
    and snapshot->>'evidenceBasis'='decision_recommendation_reject'
  from (select public.service_refund_manager_ready_notice_snapshot(
    'f1050000-0000-4000-8000-000000000003',
    'f1010000-0000-4000-8000-000000000001') snapshot) q),
  'ready notice keeps the 30-day decline recommendation advisory');
select is(public.service_enqueue_refund_manager_ready_notices(
  'f1050000-0000-4000-8000-000000000003')->>'queuedCount','1',
  'recommendation-only rejection satisfies the notification ledger constraint');
select ok((select item->>'actionCode'='reject_request'
    and item->>'recommendationKind'='reject'
    and item->>'evidenceBasis'='decision_recommendation_reject'
    and item->'amountCents'='null'::jsonb
    and item->'currencyCode'='null'::jsonb
  from jsonb_array_elements(public.refund_manager_daily_digest_projection_for(
    'f1010000-0000-4000-8000-000000000001')->'items') item
  where item->>'caseId'='f1050000-0000-4000-8000-000000000003'),
  'daily digest carries the advisory decline recommendation');
reset role;
insert into public.refund_gmail_messages(
 id,gmail_thread_id,refund_case_id,provider_message_id,direction,message_kind,
 status,sender_email,recipient_email,subject,plain_body,received_at,
 retention_expires_at,participant_role,participant_trust)
values('f1120000-0000-4000-8000-000000000002',
 'f1110000-0000-4000-8000-000000000001',
 'f1050000-0000-4000-8000-000000000003','provider-pending-reply',
 'inbound','message','received','reject@example.invalid','refunds@example.invalid',
 'Re: One purchase detail','I found more information.',
 statement_timestamp()-interval '1 day',statement_timestamp()+interval '90 days',
 'customer','verified');
select is(public.refund_decision_recommendation_for_case(
 'f1050000-0000-4000-8000-000000000003',statement_timestamp()),
 null::jsonb,'an unreviewed verified reply blocks the rejection recommendation');

create temporary table deny_receipt(id uuid) on commit drop;
grant select,insert on table pg_temp.deny_receipt to authenticated,service_role;
set local role authenticated;
select pg_temp.set_actor('f1010000-0000-4000-8000-000000000001');
insert into pg_temp.deny_receipt
select (public.admin_authorize_refund_official_action(
 'f1050000-0000-4000-8000-000000000003','decline',
 (select official_action_version from public.refund_cases
  where id='f1050000-0000-4000-8000-000000000003'),
 'denied','denied',null,'No supported purchase match.',null,null,
 null,null,false,null,null)->>'authorizationId')::uuid;
reset role;
set local role service_role;
select public.service_apply_refund_official_case_update(
 (select id from pg_temp.deny_receipt),
 'f1050000-0000-4000-8000-000000000003','decline','denied',null,'denied',
 'No supported purchase match.',null,null,null,null,null);
reset role;
select is((select status||':'||decision from public.refund_cases
 where id='f1050000-0000-4000-8000-000000000003'),'denied:denied',
 'the existing Manager-authorized decline path remains the only final action');

select * from finish();
rollback;
