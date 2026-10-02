begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();

create function pg_temp.set_actor(p_user_id uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub',p_user_id::text,true);
  perform set_config('request.jwt.claim.role','authenticated',true);
  perform set_config('request.jwt.claims',jsonb_build_object(
    'sub',p_user_id,'role','authenticated','is_anonymous',false)::text,true);
end $$;
create function pg_temp.capture_error(statement text) returns text language plpgsql as $$
begin execute statement; return null; exception when others then return sqlstate||':'||sqlerrm; end $$;
create function pg_temp.probe_rolled_back_decision(
  p_mutation text,p_case_id uuid,p_expected_version bigint,
  p_proof_id uuid,p_token uuid
) returns text language plpgsql security definer set search_path='' as $$
declare outcome text;
begin
  begin
    begin
      execute p_mutation;
    exception when others then
      outcome := 'MUTATION:' || sqlstate || ':' || sqlerrm;
    end;
    if outcome is null then
      begin
        perform public.admin_approve_reviewed_nayax_candidate_v1(
          p_case_id,p_expected_version,p_proof_id,p_token
        );
        outcome := 'APPROVED';
      exception when others then
        outcome := sqlstate || ':' || sqlerrm;
      end;
    end if;
    raise exception 'rollback probe' using errcode='P0001';
  exception when sqlstate 'P0001' then
    return outcome;
  end;
end $$;
select is(has_function_privilege('anon',
  'public.admin_approve_reviewed_nayax_candidate_v1(uuid,bigint,uuid,uuid)',
  'execute'),false,
  'anonymous sessions cannot invoke the protected reviewed-set final decision');

insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data) values
('e1410000-0000-4000-8000-000000000001','authenticated','authenticated','reviewed-manager@example.invalid','{}','{}'),
('e1410000-0000-4000-8000-000000000002','authenticated','authenticated','revoked-manager@example.invalid','{}','{}');
insert into public.customer_accounts(id,name,account_type)
values('e1420000-0000-4000-8000-000000000001','Reviewed set fixture','internal');
insert into public.reporting_locations(id,account_id,name,timezone)
values('e1430000-0000-4000-8000-000000000001',
  'e1420000-0000-4000-8000-000000000001','Reviewed location','America/Los_Angeles');
insert into public.reporting_machines(id,account_id,location_id,machine_label,status,
  nayax_machine_id,nayax_account_key,nayax_refunds_enabled)
values
('e1440000-0000-4000-8000-000000000001','e1420000-0000-4000-8000-000000000001',
 'e1430000-0000-4000-8000-000000000001','Reviewed machine','active',
 'REVIEWED-MACHINE','REVIEWED_ACCOUNT',true),
('e1440000-0000-4000-8000-000000000002','e1420000-0000-4000-8000-000000000001',
 'e1430000-0000-4000-8000-000000000001','Other machine','active',
 'OTHER-MACHINE','OTHER_ACCOUNT',true),
('e1440000-0000-4000-8000-000000000003','e1420000-0000-4000-8000-000000000001',
 'e1430000-0000-4000-8000-000000000001','Punctuated account machine','active',
 'PUNCT-MACHINE','REVIEWED-ACCOUNT',true);
insert into public.reporting_machine_refund_managers(reporting_machine_id,manager_user_id,manager_email,grant_reason)
values('e1440000-0000-4000-8000-000000000001',
  'e1410000-0000-4000-8000-000000000001','reviewed-manager@example.invalid','Fixture'),
  ('e1440000-0000-4000-8000-000000000003',
  'e1410000-0000-4000-8000-000000000001','reviewed-manager@example.invalid','Fixture');
insert into public.refund_nayax_machine_inventory(account_key,nayax_machine_id,reporting_machine_id)
values('REVIEWED_ACCOUNT','REVIEWED-MACHINE','e1440000-0000-4000-8000-000000000001'),
  ('OTHER_ACCOUNT','OTHER-MACHINE','e1440000-0000-4000-8000-000000000002'),
  ('REVIEWED_ACCOUNT','PUNCT-MACHINE','e1440000-0000-4000-8000-000000000003');

create function pg_temp.evidence(p_amount integer,p_rank integer) returns jsonb
language sql stable as $$
select jsonb_build_object(
 'source','nayax_api','selection_allowed',true,'is_recommended',false,'one_click_eligible',false,
 'recommendation_state','ambiguous','confidence_class','ambiguous_manual',
 'policy_version','2026-09-05.v11','identifier_policy_version','2026-09-05.identifier.v2',
 'customer_fact_version',1,'customer_credential_class','customer_physical_contactless_pan',
 'provider_identifier_class','last_sales_present_identifier_unverified',
 'card_last4_comparison','exact_support','card_network_comparison','missing',
 'payment_interaction_comparison','unknown','same_identifier_equivalence_proven',false,
 'identifier_review_state','exact_support','customer_correction_fields','[]'::jsonb,
 'hard_exclusions','[]'::jsonb,'manual_review_reasons','[]'::jsonb,
 'reason_codes','["machine_exact","provider_sale_approved"]'::jsonb,'match_factors','[]'::jsonb
) || jsonb_build_object(
 'match_reason','One current machine sale reviewed with the request','recommendation_rank',p_rank,
 'is_top_ranked',p_rank=1,'lookup_account_scope','REVIEWED_ACCOUNT',
 'lookup_provider_machine_id','REVIEWED-MACHINE','provider_machine_id','REVIEWED-MACHINE',
 'machine_authorization_time_raw','2026-09-12T20:00:00Z',
 'machine_authorization_at','2026-09-12T20:00:00Z',
 'machine_authorization_time_source','MachineAuthorizationTime',
 'machine_time_resolution','exact','provider_time_resolution','exact',
 'provider_time_source','authorization_gmt','authorized_at','2026-09-12T20:00:00Z',
 'customer_request_received_at','2026-09-12T21:00:00Z',
 'customer_request_received_source','hosted_refund_intake',
 'transaction_occurrence_proof_source',null,'transaction_occurrence_timestamp_source',null,
 'transaction_occurrence_timezone_basis',null,'transaction_occurrence_lower_bound_at',null,
 'transaction_occurrence_upper_bound_at',null,'request_receipt_lower_bound_at',null,
 'request_receipt_upper_bound_at',null,'request_time_boundary','occurrence_time_uncertain',
 'transaction_occurrence_comparable',false,'transaction_occurrence_semantics','unknown',
 'time_delta_minutes',null,'amount_delta_cents',p_amount-1000,
 'provider_processing_time_delta_minutes',0,'payment_status','approved',
 'payment_status_evidence','last_sales_contract','provider_refund_state','clear',
 'duplicate_provider_record',false,'card_last4','4242','currency_code','USD',
 'amount_cents',p_amount)
$$;

insert into public.refund_cases(id,public_reference,reporting_machine_id,reporting_location_id,
  customer_email,issue_summary,incident_at,incident_timezone,incident_time_resolution,
  incident_time_confidence,payment_method,payment_amount_cents,card_last4,
  card_last4_provenance,payment_interaction,status,correlation_status,
  deterministic_fact_version,intake_source,intake_meta,customer_request_received_at,
  customer_request_received_source,nayax_lookup_generation,
  nayax_lookup_status,nayax_refund_execution_status)
values
('e1450000-0000-4000-8000-000000000001','RF-REVIEWED-A',
 'e1440000-0000-4000-8000-000000000001','e1430000-0000-4000-8000-000000000001',
 'reviewed-a@example.invalid','Two reviewed purchases','2026-09-12T20:00:00Z',
 'America/Los_Angeles','exact','exact','card',1000,'4242','physical_card',
 'tap_card','needs_review','needs_nayax',1,'form','{}',
 '2026-09-12T21:00:00Z','hosted_refund_intake',0,'not_started','not_requested'),
('e1450000-0000-4000-8000-000000000002','RF-REVIEWED-B',
 'e1440000-0000-4000-8000-000000000001','e1430000-0000-4000-8000-000000000001',
 'reviewed-b@example.invalid','Two reviewed purchases','2026-09-12T20:00:00Z',
 'America/Los_Angeles','exact','exact','card',1000,'4242','physical_card',
 'tap_card','needs_review','needs_nayax',1,'form','{}',
 '2026-09-12T21:00:00Z','hosted_refund_intake',0,'not_started','not_requested'),
('e1450000-0000-4000-8000-000000000003','RF-REVIEWED-DENY',
 'e1440000-0000-4000-8000-000000000001','e1430000-0000-4000-8000-000000000001',
 'reviewed-deny@example.invalid','One reviewed purchase','2026-09-12T20:00:00Z',
 'America/Los_Angeles','exact','exact','card',1000,'4242','physical_card',
 'tap_card','needs_review','needs_nayax',1,'form','{}',
 '2026-09-12T21:00:00Z','hosted_refund_intake',0,'not_started','not_requested'),
('e1450000-0000-4000-8000-000000000004','RF-REVIEWED-PUNCT',
 'e1440000-0000-4000-8000-000000000003','e1430000-0000-4000-8000-000000000001',
 'reviewed-punct@example.invalid','Normalized account purchase','2026-09-12T20:00:00Z',
 'America/Los_Angeles','exact','exact','card',1000,'4242','physical_card',
 'tap_card','needs_review','needs_nayax',1,'form','{}',
 '2026-09-12T21:00:00Z','hosted_refund_intake',0,'not_started','not_requested');
select is((public.service_begin_refund_nayax_lookup(
  'e1450000-0000-4000-8000-000000000001',1,'scheduled',null
)->>'lookupGeneration')::bigint,1::bigint,
  'first review uses the actual scheduled read-only claimant');
select is((public.service_begin_refund_nayax_lookup(
  'e1450000-0000-4000-8000-000000000002',1,'scheduled',null
)->>'lookupGeneration')::bigint,1::bigint,
  'second review uses its own actual scheduled read-only claimant');
select is((public.service_begin_refund_nayax_lookup(
  'e1450000-0000-4000-8000-000000000003',1,'scheduled',null
)->>'lookupGeneration')::bigint,1::bigint,
  'denial case also has a completed scheduled read-only claim');
select public.service_begin_refund_nayax_lookup(
  'e1450000-0000-4000-8000-000000000004',1,'scheduled',null
);
insert into public.refund_nayax_lookup_candidates(
 token,refund_case_id,lookup_generation,actor_user_id,reporting_machine_id,
 provider_transaction_id,site_id,machine_authorization_time,amount_cents,
 card_last4,currency_code,evidence_summary,expires_at)
values
('e1460000-0000-4000-8000-000000000001','e1450000-0000-4000-8000-000000000001',1,null,
 'e1440000-0000-4000-8000-000000000001','REVIEWED-A-SALE-1',17,
 '2026-09-12T20:00:00Z',3000,'4242','USD',pg_temp.evidence(3000,1),now()+interval '1 hour'),
('e1460000-0000-4000-8000-000000000002','e1450000-0000-4000-8000-000000000001',1,null,
 'e1440000-0000-4000-8000-000000000001','REVIEWED-A-SALE-2',17,
 '2026-09-12T20:00:00Z',1190,'4242','USD',pg_temp.evidence(1190,2),now()+interval '1 hour'),
('e1460000-0000-4000-8000-000000000003','e1450000-0000-4000-8000-000000000002',1,null,
 'e1440000-0000-4000-8000-000000000001','REVIEWED-B-SALE-1',17,
 '2026-09-12T20:00:00Z',3000,'4242','USD',pg_temp.evidence(3000,1),now()+interval '1 hour'),
('e1460000-0000-4000-8000-000000000004','e1450000-0000-4000-8000-000000000002',1,null,
 'e1440000-0000-4000-8000-000000000001','REVIEWED-B-SALE-2',17,
 '2026-09-12T20:00:00Z',1190,'4242','USD',pg_temp.evidence(1190,2),now()+interval '1 hour'),
('e1460000-0000-4000-8000-000000000005','e1450000-0000-4000-8000-000000000003',1,null,
 'e1440000-0000-4000-8000-000000000001','REVIEWED-DENY-SALE-1',17,
 '2026-09-12T20:00:00Z',3000,'4242','USD',pg_temp.evidence(3000,1),now()+interval '1 hour'),
('e1460000-0000-4000-8000-000000000006','e1450000-0000-4000-8000-000000000004',1,null,
 'e1440000-0000-4000-8000-000000000003','REVIEWED-PUNCT-SALE-1',17,
 '2026-09-12T20:00:00Z',3000,'4242','USD',pg_temp.evidence(3000,1)||
  jsonb_build_object('lookup_provider_machine_id','PUNCT-MACHINE',
    'provider_machine_id','PUNCT-MACHINE'),now()+interval '1 hour');

select is(public.refund_manager_preparation_snapshot(
  'e1450000-0000-4000-8000-000000000001',
  (select official_action_version from public.refund_cases where id='e1450000-0000-4000-8000-000000000001')
),null::jsonb,'uncommitted candidate rows do not prove completed research');
select is((public.service_commit_refund_nayax_lookup(
  'e1450000-0000-4000-8000-000000000001',1,1,'multiple_matches','ambiguous',
  '2026-09-05.v11',statement_timestamp(),'Two reviewed sales',null,2,'scheduled',null
)->>'applied'),'true','first automatic lookup completion persists');
select is((public.service_commit_refund_nayax_lookup(
  'e1450000-0000-4000-8000-000000000002',1,1,'multiple_matches','ambiguous',
  '2026-09-05.v11',statement_timestamp(),'Two reviewed sales',null,2,'scheduled',null
)->>'applied'),'true','second automatic lookup completion persists');
select is((public.service_commit_refund_nayax_lookup(
  'e1450000-0000-4000-8000-000000000003',1,1,'manual_exception','manual_exception',
  '2026-09-05.v11',statement_timestamp(),'One reviewed sale',null,1,'scheduled',null
)->>'applied'),'true','denial case has completed review without selection');
select public.service_commit_refund_nayax_lookup(
  'e1450000-0000-4000-8000-000000000004',1,1,'manual_exception','manual_exception',
  '2026-09-05.v11',statement_timestamp(),'Normalized account sale',null,1,'scheduled',null
);

select pg_temp.set_actor('e1410000-0000-4000-8000-000000000001');
create temporary table partial_review as select official_action_version as version,
 (public.refund_manager_preparation_snapshot(id,official_action_version)->>'proofId')::uuid as proof
 from public.refund_cases where id='e1450000-0000-4000-8000-000000000001';
select lives_ok(format('select public.admin_approve_reviewed_nayax_candidate_v2(%L,%s,%L,%L,1000)',
 'e1450000-0000-4000-8000-000000000001',version,proof,'e1460000-0000-4000-8000-000000000001'),
 'Manager commits one partial $10 approval against selected $30 charge') from partial_review;
select results_eq($$select matched_nayax_amount_cents,refund_amount_cents from public.refund_cases where id='e1450000-0000-4000-8000-000000000001'$$,
 $$select 3000::integer,1000::integer$$,'Original and approved amount remain separate');
select is((select amount_cents from public.refund_case_nayax_refund_attempts where refund_case_id='e1450000-0000-4000-8000-000000000001'),1000,'Immutable attempt uses approved amount');
select is((select context->>'refundAmountCents' from public.refund_nayax_execution_contexts where refund_case_id='e1450000-0000-4000-8000-000000000001'),'1000','Frozen hash context binds partial amount');
select is((select context->>'originalAmountCents' from public.refund_nayax_execution_contexts where refund_case_id='e1450000-0000-4000-8000-000000000001'),'3000','Frozen context preserves original total');
select lives_ok(format('select public.admin_approve_reviewed_nayax_candidate_v2(%L,%s,%L,%L,1000)',
 'e1450000-0000-4000-8000-000000000001',version,proof,'e1460000-0000-4000-8000-000000000001'),
 'Identical partial approval replay acknowledges the same immutable attempt') from partial_review;
select throws_ok(format('select public.admin_approve_reviewed_nayax_candidate_v2(%L,%s,%L,%L,1500)',
 'e1450000-0000-4000-8000-000000000001',version,proof,'e1460000-0000-4000-8000-000000000001'),
 'P4620',null,'Changed replay amount cannot execute') from partial_review;
select is((select count(*) from public.refund_case_nayax_refund_attempts where refund_case_id='e1450000-0000-4000-8000-000000000001'),1::bigint,'One partial attempt only');
select is((select count(*) from public.refund_nayax_provider_stage_journal),0::bigint,'Approval performs no provider call');
insert into public.refund_nayax_provider_callers(caller_id,assertion_digest,status)
values('nayax-card-refund',encode(extensions.digest(convert_to('partial-executor','UTF8'),'sha256'),'hex'),'active')
on conflict(caller_id) do update set assertion_digest=excluded.assertion_digest,status='active';
create temp table approval_result as select jsonb_build_object('attemptId',id,'authorizationId',official_action_authorization_id) result
from public.refund_case_nayax_refund_attempts where refund_case_id='e1450000-0000-4000-8000-000000000001';
create temp table second_claim as select public.service_claim_due_nayax_refund_attempts_v1(
 'partial-executor','REVIEWED_ACCOUNT','exact_source','empty_string',1) result;
select is((select result#>>'{claims,0,wire,refundAmountCents}' from second_claim),'1000','System claim retains approved amount');
select public.service_record_nayax_refund_provider_stage_v4_diagnostics(
  p_executor_assertion=>'partial-executor',
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
  p_executor_assertion=>'partial-executor',
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
  p_executor_assertion=>'partial-executor',
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
  p_executor_assertion=>'partial-executor',
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

select ok(public.refund_nayax_unsettled_api_success_journal_proved(
 'e1450000-0000-4000-8000-000000000001',(select (result->>'attemptId')::uuid from approval_result)),
 'Partial success has exact frozen amount and request/approval journal proof');
select lives_ok($sql$select public.service_settle_nayax_refund_attempt('partial-executor',
 (select (result->>'attemptId')::uuid from approval_result),(select (result->>'authorizationId')::uuid from approval_result),
 'e1450000-0000-4000-8000-000000000001',
 (select idempotency_key from public.refund_case_nayax_refund_attempts where refund_case_id='e1450000-0000-4000-8000-000000000001'),
 1000,'USD',(select result#>>'{claims,0,providerClaimToken}' from second_claim),
 'success','PARTIAL-SYNTHETIC-RECEIPT','approve_succeeded_contract_match',null)$sql$,
 'Partial System settlement commits affected financial amount');
select results_eq($$select original_amount_cents,refunded_amount_cents from public.refund_authoritative_receipts where refund_case_id='e1450000-0000-4000-8000-000000000001'$$,
 $$select 3000::integer,1000::integer$$,'Receipt retains original $30 and proved refund $10');
create temp table completion_result as select public.service_claim_nayax_refund_completion('partial-executor',
 (select (result->>'attemptId')::uuid from approval_result)) result;
select is((select result->>'status' from completion_result),'queued','Partial form completion enters existing transactional queue');
select is((select count(*) from public.refund_receipt_completion_intents where refund_case_id='e1450000-0000-4000-8000-000000000001'),1::bigint,
 'Exactly one partial completion intent is persisted without sending');
select lives_ok($sql$select public.service_ensure_refund_receipt_automatic_completions(10)$sql$,'Partial receipt recovery scanner accepts the same proof');
select * from finish();
rollback;
