begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select plan(40);

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
('b7410000-0000-4000-8000-000000000001','authenticated','authenticated','triage@example.invalid','{}','{}'),
('b7410000-0000-4000-8000-000000000002','authenticated','authenticated','manager-b@example.invalid','{}','{}'),
('b7410000-0000-4000-8000-000000000003','authenticated','authenticated','manager-c@example.invalid','{}','{}');
insert into public.customer_accounts(id,name,account_type)
values('b7420000-0000-4000-8000-000000000001','Exact reporting fixture','internal');
insert into public.reporting_locations(id,account_id,name,timezone)
values('b7430000-0000-4000-8000-000000000001','b7420000-0000-4000-8000-000000000001','Exact reporting location','America/Los_Angeles');
insert into public.reporting_machines(id,account_id,location_id,machine_label,status,
  nayax_machine_id,nayax_account_key,nayax_refunds_enabled)
values('b7440000-0000-4000-8000-000000000001','b7420000-0000-4000-8000-000000000001',
  'b7430000-0000-4000-8000-000000000001','Exact reporting machine','active',
  'EXACT-REPORTING-MACHINE','EXACT_REPORTING_ACCOUNT',true);
insert into public.refund_nayax_machine_inventory(account_key,nayax_machine_id,reporting_machine_id)
values('EXACT_REPORTING_ACCOUNT','EXACT-REPORTING-MACHINE','b7440000-0000-4000-8000-000000000001');
insert into public.reporting_machine_refund_managers(id,reporting_machine_id,manager_user_id,manager_email,grant_reason)
values('b7450000-0000-4000-8000-000000000001','b7440000-0000-4000-8000-000000000001',
  'b7410000-0000-4000-8000-000000000002','manager-b@example.invalid','Fixture'),
('b7450000-0000-4000-8000-000000000002','b7440000-0000-4000-8000-000000000001',
  'b7410000-0000-4000-8000-000000000003','manager-c@example.invalid','Fixture');
insert into public.admin_scoped_access_grants(id,user_id,grant_reason)
values('b7460000-0000-4000-8000-000000000001','b7410000-0000-4000-8000-000000000001','Triage fixture');
insert into public.admin_scoped_access_scopes(grant_id,scope_type,machine_id,grant_reason)
values('b7460000-0000-4000-8000-000000000001','machine','b7440000-0000-4000-8000-000000000001','Triage fixture');
insert into public.refund_nayax_provider_callers(caller_id,assertion_digest,status)
values('nayax-card-refund',encode(extensions.digest(convert_to('exact-reporting-executor','UTF8'),'sha256'),'hex'),'active')
on conflict(caller_id) do update set assertion_digest=excluded.assertion_digest,status='active';

insert into public.refund_cases(id,public_reference,reporting_machine_id,reporting_location_id,
  customer_email,issue_summary,incident_at,incident_timezone,incident_time_resolution,
  incident_time_confidence,payment_method,payment_amount_cents,refund_amount_cents,
  card_last4,card_last4_provenance,payment_interaction,status,correlation_status,
  deterministic_fact_version,intake_source,intake_meta,nayax_lookup_generation,
  nayax_lookup_status,nayax_recommendation_state,nayax_refund_execution_status)
values('b7470000-0000-4000-8000-000000000001','RF-EXACT-REPORTING',
  'b7440000-0000-4000-8000-000000000001','b7430000-0000-4000-8000-000000000001',
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
 'lookup_account_scope','EXACT_REPORTING_ACCOUNT','lookup_provider_machine_id','EXACT-REPORTING-MACHINE',
 'provider_machine_id','EXACT-REPORTING-MACHINE','machine_authorization_time_raw','2026-09-12T20:00:00Z',
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

insert into public.refund_nayax_lookup_candidates(token,refund_case_id,lookup_generation,actor_user_id,
  reporting_machine_id,provider_transaction_id,site_id,machine_authorization_time,amount_cents,
  card_last4,currency_code,evidence_summary,expires_at)
values('b7480000-0000-4000-8000-000000000001','b7470000-0000-4000-8000-000000000001',1,
  'b7410000-0000-4000-8000-000000000001','b7440000-0000-4000-8000-000000000001',
  'ORIGINAL-EXACT-REPORTING-ONE',17,'2026-09-12T20:00:00Z',1090,'4242','USD',pg_temp.exact_evidence(),now()+interval '1 hour');

select pg_temp.set_actor('b7410000-0000-4000-8000-000000000001');
select public.admin_select_refund_nayax_candidate_current_user_v1(
 'b7470000-0000-4000-8000-000000000001',
 (select official_action_version from public.refund_cases where id='b7470000-0000-4000-8000-000000000001'),
 'b7480000-0000-4000-8000-000000000001',null);
select pg_temp.set_actor('b7410000-0000-4000-8000-000000000002');
create temp table approval_result as select public.admin_approve_selected_nayax_refund_for_system_v1(
 'b7470000-0000-4000-8000-000000000001',
 (select official_action_version from public.refund_cases where id='b7470000-0000-4000-8000-000000000001')) result;
create temp table second_claim as select public.service_claim_due_nayax_refund_attempts_v1(
 'exact-reporting-executor','EXACT_REPORTING_ACCOUNT','exact_source','empty_string',1) result;
select public.service_record_nayax_refund_provider_stage_v4_diagnostics(
  p_executor_assertion=>'exact-reporting-executor',
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
  p_executor_assertion=>'exact-reporting-executor',
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
select public.service_record_nayax_refund_provider_stage_v4_diagnostics(
  p_executor_assertion=>'exact-reporting-executor',
  p_attempt_id=>(select (result->>'attemptId')::uuid from approval_result),
  p_provider_claim_token=>(select result#>>'{claims,0,providerClaimToken}' from second_claim),
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
  p_executor_assertion=>'exact-reporting-executor',
  p_attempt_id=>(select (result->>'attemptId')::uuid from approval_result),
  p_provider_claim_token=>(select result#>>'{claims,0,providerClaimToken}' from second_claim),
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

-- Management rehearsal runs one SQL request; statement_timestamp is shared by
-- that request. Set distinct observed synthetic response times explicitly so
-- the same strict request-before-approval invariant is exercised there and CI.
set local session_replication_role=replica;
update public.refund_nayax_provider_stage_journal set created_at=statement_timestamp()-interval '2 seconds'
 where nayax_refund_attempt_id=(select (result->>'attemptId')::uuid from approval_result)
 and stage='request';
update public.refund_nayax_provider_stage_journal set created_at=statement_timestamp()-interval '1 second'
 where nayax_refund_attempt_id=(select (result->>'attemptId')::uuid from approval_result)
 and stage='approve';
set local session_replication_role=origin;

-- A different original purchase shares the obsolete machine/day/amount key.
insert into public.refund_cases(id,public_reference,reporting_machine_id,reporting_location_id,
 customer_email,issue_summary,incident_at,incident_timezone,payment_method,payment_amount_cents,
 refund_amount_cents,status,intake_source,intake_meta)
values('b7470000-0000-4000-8000-000000000099','RF-DIFFERENT-ORIGINAL',
 'b7440000-0000-4000-8000-000000000001','b7430000-0000-4000-8000-000000000001',
 'different@example.invalid','Different purchase','2026-09-12T20:00:00Z',
 'America/Los_Angeles','card',1090,1090,'needs_review','form','{}');
-- Reproduce the other applied ledger row as well as the same-key open case.
-- Import history is fixture-only; the production guard remains active afterward.
set local session_replication_role=replica;
update public.refund_cases set matched_nayax_transaction_id='ORIGINAL-EXACT-REPORTING-TWO'
 where id='b7470000-0000-4000-8000-000000000099';
insert into public.sales_adjustment_facts(reporting_machine_id,reporting_location_id,
 adjustment_date,adjustment_type,amount_cents,complaint_count,source,source_row_hash,
 source_reference,source_row_reference,match_status,match_confidence,raw_payload,refund_business_fingerprint)
values('b7440000-0000-4000-8000-000000000001','b7430000-0000-4000-8000-000000000001',
 '2026-09-12','refund',1090,1,'google_sheets','different-original-row',
 'synthetic-old-report','different-original','applied',1,'{"payment_method":"card","incident_date":"2026-09-12"}',
 public.build_refund_business_fingerprint('b7440000-0000-4000-8000-000000000001','2026-09-12',1090,'card'));
set local session_replication_role=origin;
select matches(pg_temp.capture_error($sql$insert into public.sales_adjustment_facts(
 reporting_machine_id,reporting_location_id,adjustment_date,adjustment_type,amount_cents,
 complaint_count,source,source_row_hash,source_reference,source_row_reference,match_status,match_confidence,raw_payload)
values('b7440000-0000-4000-8000-000000000001','b7430000-0000-4000-8000-000000000001',
 '2026-09-12','refund',1090,1,'google_sheets','unbound-row','synthetic-new-report',
 'unbound-original','applied',1,'{"payment_method":"card","incident_date":"2026-09-12"}')$sql$),
 '^23505:','unbound legacy/import rows still retain the existing duplicate guard');
select ok((select refund_business_fingerprint=(select refund_business_fingerprint from public.refund_cases
 where id='b7470000-0000-4000-8000-000000000001')
 from public.sales_adjustment_facts where source_reference='synthetic-old-report'),
 'other applied ledger row reproduces the weak fingerprint collision');
select ok(public.refund_nayax_unsettled_api_success_journal_proved(
 'b7470000-0000-4000-8000-000000000001',(select (result->>'attemptId')::uuid from approval_result)),
 'current System exact stored success is proved without obsolete step-up');
select ok((select c.refund_business_fingerprint=other.refund_business_fingerprint
 from public.refund_cases c cross join public.refund_cases other
 where c.id='b7470000-0000-4000-8000-000000000001'
 and other.id='b7470000-0000-4000-8000-000000000099'),
 'two distinct purchases reproduce the weak fingerprint collision');
create function pg_temp.settle_and_rollback() returns text language plpgsql as $$
begin
 perform public.service_settle_nayax_refund_attempt('exact-reporting-executor',
  (select (result->>'attemptId')::uuid from approval_result),
  (select (result->>'authorizationId')::uuid from approval_result),
  'b7470000-0000-4000-8000-000000000001',
  (select idempotency_key from public.refund_case_nayax_refund_attempts where id=(select (result->>'attemptId')::uuid from approval_result)),
  1090,'USD',(select result#>>'{claims,0,providerClaimToken}' from second_claim),
  'success','EXACT-REPORTING-RECEIPT','approve_succeeded_contract_match',null);
 raise exception 'synthetic settlement passed' using errcode='Z0001';
exception when others then return sqlstate;
end $$;
select is(pg_temp.settle_and_rollback(),'Z0001','normal exact settlement survives another original purchase; subtransaction rolls back');
select is((select status from public.refund_case_nayax_refund_attempts where id=(select (result->>'attemptId')::uuid from approval_result)),
 'in_progress','settlement test leaves no synthetic finalization');
select public.service_hold_nayax_refund_attempt_v1('exact-reporting-executor',
 (select (result->>'attemptId')::uuid from approval_result),'settlement_failure');
select ok((select a.status='manual_review' and a.provider_outcome='unknown' and a.reconciliation_required
 and c.nayax_refund_execution_status='ambiguous' and c.reporting_adjustment_id is null
 from public.refund_case_nayax_refund_attempts a join public.refund_cases c on c.id=a.refund_case_id
 where a.id=(select (result->>'attemptId')::uuid from approval_result)),
 'held fixture uses the supported settlement-failure path');
create temp table immutable_before as select
 (select jsonb_agg(to_jsonb(j) order by j.id) from public.refund_nayax_provider_stage_journal j
  where j.nayax_refund_attempt_id=(select (result->>'attemptId')::uuid from approval_result)) journals,
 (select jsonb_agg(to_jsonb(o) order by o.provider_stage_journal_id) from public.refund_nayax_provider_business_outcomes o
  where o.nayax_refund_attempt_id=(select (result->>'attemptId')::uuid from approval_result)) outcomes,
 (select to_jsonb(z) from public.refund_case_official_action_authorizations z
  where z.id=(select (result->>'authorizationId')::uuid from approval_result)) approval,
 (select to_jsonb(x) from public.refund_nayax_execution_contexts x
  where x.attempt_id=(select (result->>'attemptId')::uuid from approval_result)) context,
 (select to_jsonb(c) from public.refund_cases c where c.id='b7470000-0000-4000-8000-000000000099') other_case,
 (select count(*) from public.refund_case_messages) messages;
select pg_temp.set_actor('b7410000-0000-4000-8000-000000000002');
select matches(pg_temp.capture_error($sql$select public.service_reconcile_proved_nayax_api_terminal(
 'b7470000-0000-4000-8000-000000000001',(select (result->>'attemptId')::uuid from approval_result))$sql$),
 '^42501:','Manager identity cannot invoke service-only receipt recovery');
select set_config('request.jwt.claim.role','service_role',true);
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select matches(pg_temp.capture_error($sql$select public.service_reconcile_proved_nayax_api_terminal(
 'b7470000-0000-4000-8000-000000000099',(select (result->>'attemptId')::uuid from approval_result))$sql$),
 '^P4670:','attempt from another case is rejected');
-- Mutations below are synthetic corruption fixtures, isolated in subtransactions.
create function pg_temp.corrupt_and_reconcile(p_sql text) returns text language plpgsql as $$
declare result text;
begin
 execute 'set local session_replication_role=replica';
 execute p_sql;
 execute 'set local session_replication_role=origin';
 perform public.service_reconcile_proved_nayax_api_terminal(
  'b7470000-0000-4000-8000-000000000001',(select (result->>'attemptId')::uuid from approval_result));
 raise exception 'unexpected acceptance' using errcode='Z0002';
exception when others then return sqlstate||':'||sqlerrm;
end $$;
select matches(pg_temp.corrupt_and_reconcile($sql$update public.refund_case_nayax_refund_attempts set request_fingerprint=repeat('f',64)
 where id=(select (result->>'attemptId')::uuid from approval_result)$sql$),'^P4670:','wrong immutable request binding fails closed');
select matches(pg_temp.corrupt_and_reconcile($sql$update public.refund_nayax_execution_contexts set context=jsonb_set(context,'{contextHash}',to_jsonb(repeat('f',64)))
 where attempt_id=(select (result->>'attemptId')::uuid from approval_result)$sql$),'^P4670:','wrong frozen-context self-hash fails closed');
select matches(pg_temp.corrupt_and_reconcile($sql$update public.refund_case_nayax_refund_attempts set provider_execution_generation=2
 where id=(select (result->>'attemptId')::uuid from approval_result)$sql$),'^P4670:','stale provider generation cannot settle');
select matches(pg_temp.corrupt_and_reconcile($sql$update public.refund_case_official_action_authorizations set status='authorized',consumed_at=null
 where id=(select (result->>'authorizationId')::uuid from approval_result)$sql$),'^P4670:','unconsumed approval cannot settle');
select matches(pg_temp.corrupt_and_reconcile($sql$update public.refund_nayax_provider_business_outcomes set business_status='Success'
 where nayax_refund_attempt_id=(select (result->>'attemptId')::uuid from approval_result) and stage='approve'$sql$),
 '^P4670:','unlisted provider business pair cannot settle');
select matches(pg_temp.corrupt_and_reconcile($sql$update public.refund_cases set matched_nayax_transaction_id='OTHER-ORIGINAL'
 where id='b7470000-0000-4000-8000-000000000001'$sql$),'^P4670:','changed original transaction cannot settle');
select matches(pg_temp.corrupt_and_reconcile($sql$update public.refund_nayax_provider_stage_journal set provider_execution_generation=2
 where nayax_refund_attempt_id=(select (result->>'attemptId')::uuid from approval_result) and stage='request'$sql$),
 '^P4670:','request journal from another generation cannot settle');
select matches(pg_temp.corrupt_and_reconcile($sql$update public.refund_nayax_provider_stage_journal set provider_execution_generation=2
 where nayax_refund_attempt_id=(select (result->>'attemptId')::uuid from approval_result) and stage='approve'$sql$),
 '^P4670:','approval journal from another generation cannot settle');
select matches(pg_temp.corrupt_and_reconcile($sql$delete from public.refund_nayax_provider_business_outcomes
 where nayax_refund_attempt_id=(select (result->>'attemptId')::uuid from approval_result) and stage='approve'$sql$),
 '^P4670:','missing retained approval business/scalar proof cannot settle');
select is((select count(*) from public.sales_adjustment_facts where refund_case_id='b7470000-0000-4000-8000-000000000001'),0::bigint,
 'failed proof paths leave no adjustment');
select is((select count(*) from public.refund_authoritative_receipts where refund_case_id='b7470000-0000-4000-8000-000000000001'),0::bigint,
 'failed proof paths leave no receipt');
create temp table recovery_result as select public.service_reconcile_proved_nayax_api_terminal(
 'b7470000-0000-4000-8000-000000000001',(select (result->>'attemptId')::uuid from approval_result)) result;
select is((select result->>'status' from recovery_result),'receipt_recorded','stored exact success repairs local reporting');
select ok((select result->>'providerCallMade'='false' and result->>'customerMessageCreated'='false'
 and result->>'customerMessageSent'='false' from recovery_result),'receipt repair explicitly makes no provider call or customer message');
select ok((select status='completed' and decision='approved' and nayax_refund_execution_status='approved'
 and reporting_adjustment_id is not null and refund_completed_by='b7410000-0000-4000-8000-000000000002'
 from public.refund_cases where id='b7470000-0000-4000-8000-000000000001'),
 'local finalization retains the original consumed Manager decision');
select ok((select status='succeeded' and provider_outcome='success' and not reconciliation_required
 and reporting_adjustment_id is not null and case_finalization_committed_at is not null
 and completion_message_id is null and completion_delivery_status='not_claimed'
 from public.refund_case_nayax_refund_attempts where id=(select (result->>'attemptId')::uuid from approval_result)),
 'attempt is finalized with completion delivery untouched');
select is((select count(*) from public.sales_adjustment_facts where refund_case_id='b7470000-0000-4000-8000-000000000001'),1::bigint,
 'one adjustment belongs to the exact case');
select ok((select source='refund_case' and source_reference='refund_cases'
 and source_row_hash=refund_case_id::text and amount_cents=1090 and match_status='applied'
 and raw_payload->>'accounting_date_meaning'='provider_approval_response_date_not_bank_settlement'
 from public.sales_adjustment_facts where refund_case_id='b7470000-0000-4000-8000-000000000001'),
 'reporting retains exact source identity and honest accounting time meaning');
select ok((select confirmation_source='api_stage_contract' and settlement_time_precision='unknown'
 and settled_at is null and not current_provider_observation_reviewed and original_transaction_id='ORIGINAL-EXACT-REPORTING-ONE'
 from public.refund_authoritative_receipts where id=(select (result->>'receiptId')::uuid from recovery_result)),
 'receipt records exact API truth without inventing bank settlement');
select is((select allocation_state from public.refund_nayax_transaction_allocations
 where refund_case_id='b7470000-0000-4000-8000-000000000001'),'refunded','existing exact allocation advances without another provider request');
select is((select count(*) from public.refund_case_messages),(select messages from immutable_before),'no customer message is created');
select is((select to_jsonb(c) from public.refund_cases c where c.id='b7470000-0000-4000-8000-000000000099'),
 (select other_case from immutable_before),'different original purchase is untouched');
select is((select jsonb_agg(to_jsonb(j) order by j.id) from public.refund_nayax_provider_stage_journal j
 where j.nayax_refund_attempt_id=(select (result->>'attemptId')::uuid from approval_result)),
 (select journals from immutable_before),'provider journal is immutable through recovery');
select is((select jsonb_agg(to_jsonb(o) order by o.provider_stage_journal_id) from public.refund_nayax_provider_business_outcomes o
 where o.nayax_refund_attempt_id=(select (result->>'attemptId')::uuid from approval_result)),
 (select outcomes from immutable_before),'exact provider business outcomes are retained');
select is((select to_jsonb(z) from public.refund_case_official_action_authorizations z
 where z.id=(select (result->>'authorizationId')::uuid from approval_result)),
 (select approval from immutable_before),'original approval is never replaced');
select is((select to_jsonb(x) from public.refund_nayax_execution_contexts x
 where x.attempt_id=(select (result->>'attemptId')::uuid from approval_result)),
 (select context from immutable_before),'frozen execution context is retained');
select is(public.service_reconcile_proved_nayax_api_terminal(
 'b7470000-0000-4000-8000-000000000001',(select (result->>'attemptId')::uuid from approval_result))->>'receiptId',
 (select result->>'receiptId' from recovery_result),'response loss/retry returns the original receipt');
select is((select count(*) from public.refund_authoritative_receipts where refund_case_id='b7470000-0000-4000-8000-000000000001'),1::bigint,
 'retry creates no duplicate receipt');
select is((select count(*) from public.sales_adjustment_facts where refund_case_id='b7470000-0000-4000-8000-000000000001'),1::bigint,
 'retry creates no duplicate adjustment');
select is((select count(*) from public.refund_case_events where refund_case_id='b7470000-0000-4000-8000-000000000001'
 and event_type='authoritative_refund_receipt_recorded'),1::bigint,'retry creates no duplicate receipt event');
select ok(not has_function_privilege('authenticated','public.service_reconcile_proved_nayax_api_terminal(uuid,uuid)','execute')
 and not has_function_privilege('anon','public.service_reconcile_proved_nayax_api_terminal(uuid,uuid)','execute'),
 'customer and manager roles cannot access receipt repair');
select ok(has_function_privilege('service_role','public.service_reconcile_proved_nayax_api_terminal(uuid,uuid)','execute'),
 'existing service-role capability is retained');
select * from finish();
rollback;
