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

insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data) values
('b7d10000-0000-4000-8000-000000000001','authenticated','authenticated','triage@example.invalid','{}','{}'),
('b7d10000-0000-4000-8000-000000000002','authenticated','authenticated','manager-b@example.invalid','{}','{}'),
('b7d10000-0000-4000-8000-000000000003','authenticated','authenticated','manager-c@example.invalid','{}','{}');
insert into public.customer_accounts(id,name,account_type)
values('b7d20000-0000-4000-8000-000000000001','Exact reporting fixture','internal');
insert into public.reporting_locations(id,account_id,name,timezone)
values('b7d30000-0000-4000-8000-000000000001','b7d20000-0000-4000-8000-000000000001','Exact reporting location','America/Los_Angeles');
insert into public.reporting_machines(id,account_id,location_id,machine_label,status,
  nayax_machine_id,nayax_account_key,nayax_refunds_enabled)
values('b7d40000-0000-4000-8000-000000000001','b7d20000-0000-4000-8000-000000000001',
  'b7d30000-0000-4000-8000-000000000001','Exact reporting machine','active',
  '18039901','TGPACI_USA_DB',true);
insert into public.refund_nayax_machine_inventory(account_key,nayax_machine_id,reporting_machine_id)
values('TGPACI_USA_DB','18039901','b7d40000-0000-4000-8000-000000000001');
insert into public.reporting_machine_refund_managers(id,reporting_machine_id,manager_user_id,manager_email,grant_reason)
values('b7d50000-0000-4000-8000-000000000001','b7d40000-0000-4000-8000-000000000001',
  'b7d10000-0000-4000-8000-000000000002','manager-b@example.invalid','Fixture'),
('b7d50000-0000-4000-8000-000000000002','b7d40000-0000-4000-8000-000000000001',
  'b7d10000-0000-4000-8000-000000000003','manager-c@example.invalid','Fixture');
insert into public.admin_scoped_access_grants(id,user_id,grant_reason)
values('b7d60000-0000-4000-8000-000000000001','b7d10000-0000-4000-8000-000000000001','Triage fixture');
insert into public.admin_scoped_access_scopes(grant_id,scope_type,machine_id,grant_reason)
values('b7d60000-0000-4000-8000-000000000001','machine','b7d40000-0000-4000-8000-000000000001','Triage fixture');
insert into public.refund_nayax_provider_callers(caller_id,assertion_digest,status)
values('nayax-card-refund',encode(extensions.digest(convert_to('exact-reporting-executor','UTF8'),'sha256'),'hex'),'active')
on conflict(caller_id) do update set assertion_digest=excluded.assertion_digest,status='active';

insert into public.refund_cases(id,public_reference,reporting_machine_id,reporting_location_id,
  customer_email,issue_summary,incident_at,incident_timezone,incident_time_resolution,
  incident_time_confidence,payment_method,payment_amount_cents,refund_amount_cents,
  card_last4,card_last4_provenance,payment_interaction,status,correlation_status,
  deterministic_fact_version,intake_source,intake_meta,nayax_lookup_generation,
  nayax_lookup_status,nayax_recommendation_state,nayax_refund_execution_status)
values('b7d70000-0000-4000-8000-000000000001','RF-EXACT-REPORTING',
  'b7d40000-0000-4000-8000-000000000001','b7d30000-0000-4000-8000-000000000001',
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
 'lookup_account_scope','TGPACI_USA_DB','lookup_provider_machine_id','18039901',
 'provider_machine_id','18039901','machine_authorization_time_raw','2026-09-12T20:00:00Z',
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
values('b7d80000-0000-4000-8000-000000000001','b7d70000-0000-4000-8000-000000000001',1,
  'b7d10000-0000-4000-8000-000000000001','b7d40000-0000-4000-8000-000000000001',
  '1803990101',17,'2026-09-12T20:00:00Z',1090,'4242','USD',pg_temp.exact_evidence(),now()+interval '1 hour');

-- Seed a real-shaped already-retired reader state; selection and every payment
-- transition below use origin guards. The replacement writer itself is proved
-- separately in machine_reader_replacement_history.sql.
set local session_replication_role=replica;
insert into public.machine_sales_facts(id,reporting_machine_id,reporting_location_id,sale_date,payment_method,net_sales_cents,transaction_count,item_quantity,tax_cents,source,source_order_hash,source_row_hash,raw_payload)
values('b7d90000-0000-4000-8000-000000000001','b7d40000-0000-4000-8000-000000000001','b7d30000-0000-4000-8000-000000000001','2026-09-12','credit',1090,1,1,0,'nayax_scheduled_report',repeat('7',64),'historical-refund-execution-original','{"amountBasis":"tax_inclusive","providerMachineId":"18039901","transactionId":"1803990101","siteId":"17","actorId":"2003563806","currencyCode":"USD"}');
update public.refund_cases set matched_sales_fact_id='b7d90000-0000-4000-8000-000000000001' where id='b7d70000-0000-4000-8000-000000000001';
update public.reporting_machines set nayax_machine_id=null,nayax_account_key=null where id='b7d40000-0000-4000-8000-000000000001';
update public.refund_nayax_machine_inventory set reporting_machine_id=null where account_key='TGPACI_USA_DB' and nayax_machine_id='18039901';
insert into private.machine_nayax_reader_associations(account_key,nayax_machine_id,reporting_machine_id,ownership_basis,closed_on,closed_timezone,closed_at,closed_by,close_reason,created_by,reason)
values('TGPACI_USA_DB','18039901','b7d40000-0000-4000-8000-000000000001','original_transactions_only','2026-10-02','America/Los_Angeles',now(),'b7d10000-0000-4000-8000-000000000001','Reviewed actual synthetic retirement','b7d10000-0000-4000-8000-000000000001','Reviewed synthetic historical ownership');
set local session_replication_role=origin;
create temporary table historical_original_before as select to_jsonb(f) value from public.machine_sales_facts f where id='b7d90000-0000-4000-8000-000000000001';
select is(public.service_refund_case_reader_identity('b7d70000-0000-4000-8000-000000000001','b7d40000-0000-4000-8000-000000000001')->>'readerId','18039901','Retired original identity remains available before fresh manager selection');
select pg_temp.set_actor('b7d10000-0000-4000-8000-000000000001');
select public.admin_select_refund_nayax_candidate_current_user_v1(
 'b7d70000-0000-4000-8000-000000000001',
 (select official_action_version from public.refund_cases where id='b7d70000-0000-4000-8000-000000000001'),
 'b7d80000-0000-4000-8000-000000000001',null);
select pg_temp.set_actor('b7d10000-0000-4000-8000-000000000002');
create temp table approval_result as select public.admin_approve_selected_nayax_refund_for_system_v1(
 'b7d70000-0000-4000-8000-000000000001',
 (select official_action_version from public.refund_cases where id='b7d70000-0000-4000-8000-000000000001')) result;
create temp table second_claim as select public.service_claim_due_nayax_refund_attempts_v1(
 'exact-reporting-executor','TGPACI_USA_DB','exact_source','empty_string',1) result;
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
-- A System manager_session authorization must not enter the distinct direct
-- manager continuation lane. Expiry does not change its authorization method.
-- Restore only the seeded expiry so the same ordinary System request can finish below.
create temporary table historical_continuation_before as select id,provider_claim_expires_at from public.refund_case_nayax_refund_attempts
 where id=(select (result->>'attemptId')::uuid from approval_result);
set local session_replication_role=replica;
update public.refund_case_nayax_refund_attempts set provider_claim_expires_at=statement_timestamp()-interval '1 second'
 where id=(select id from historical_continuation_before);
set local session_replication_role=origin;
create temporary table historical_continuation_probe as select public.service_claim_due_nayax_approval_continuations_v1('exact-reporting-executor','TGPACI_USA_DB',1) value;
select ok((select value->>'claimedCount'='0' and value->'claims'='[]'::jsonb from historical_continuation_probe),'Expired System authorization cannot enter the direct-manager continuation lane after reader retirement');
select ok(not exists(select 1 from public.refund_nayax_attempt_approval_continuations where refund_case_id='b7d70000-0000-4000-8000-000000000001'),'Continuation rehearsal leaves no second execution path');
set local session_replication_role=replica;
update public.refund_case_nayax_refund_attempts a set provider_claim_expires_at=b.provider_claim_expires_at
 from historical_continuation_before b where a.id=b.id;
set local session_replication_role=origin;
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
select ok((select result->>'attemptId' is not null from approval_result),'Fresh manager approval reserves an actual historical-reader attempt');
select ok((select result#>>'{claims,0,providerClaimToken}' is not null from second_claim),'Executor claims the old-reader attempt even with no current reader pointer');
select ok((select context @> '{"accountScope":"TGPACI_USA_DB","providerMachineId":"18039901","transactionId":"1803990101","siteId":17,"originalAmountCents":1090}' from public.refund_nayax_execution_contexts where attempt_id=(select (result->>'attemptId')::uuid from approval_result)),'Actual claimed context freezes the exact original tuple');
select ok(public.refund_nayax_unsettled_api_success_journal_proved('b7d70000-0000-4000-8000-000000000001',(select (result->>'attemptId')::uuid from approval_result)),'Old-reader request and approval journal contract is proved before settlement');
select lives_ok($sql$select public.service_settle_nayax_refund_attempt('exact-reporting-executor',
 (select (result->>'attemptId')::uuid from approval_result),(select (result->>'authorizationId')::uuid from approval_result),
 'b7d70000-0000-4000-8000-000000000001',
 (select idempotency_key from public.refund_case_nayax_refund_attempts where id=(select (result->>'attemptId')::uuid from approval_result)),
 1090,'USD',(select result#>>'{claims,0,providerClaimToken}' from second_claim),
 'success','HISTORICAL-READER-SYNTHETIC-RECEIPT','approve_succeeded_contract_match',null)$sql$,'Full old-reader System settlement commits through retained journal guards');
select ok(public.refund_nayax_api_terminal_evidence_proved('b7d70000-0000-4000-8000-000000000001',(select (result->>'attemptId')::uuid from approval_result)),'Terminal evidence verifies the original tuple after retirement');
select results_eq($$select account_scope,provider_machine_id,original_transaction_id,original_amount_cents,refunded_amount_cents from public.refund_authoritative_receipts where refund_case_id='b7d70000-0000-4000-8000-000000000001'$$,
 $$ values('TGPACI_USA_DB'::text,'18039901'::text,'1803990101'::text,1090::integer,1090::integer)$$,'Immutable execution receipt retains the old reader and full original amount');
select is((select count(*) from public.refund_authoritative_receipts where refund_case_id='b7d70000-0000-4000-8000-000000000001'),1::bigint,'One approved historical attempt creates exactly one authoritative receipt');
select is((select count(*) from public.sales_adjustment_facts where refund_case_id='b7d70000-0000-4000-8000-000000000001'),1::bigint,'Historical settlement creates exactly one financial adjustment');
select is((select to_jsonb(f) from public.machine_sales_facts f where id='b7d90000-0000-4000-8000-000000000001'),(select value from historical_original_before),'Execution changes no original sales fact bytes');
select ok((select nayax_machine_id is null and nayax_account_key is null from public.reporting_machines where id='b7d40000-0000-4000-8000-000000000001'),'Historical refund does not reattach retired reader configuration');
-- A known original provider clock remains available without a current owner.
-- A changed observation requires refresh; it never substitutes a new reader.
set local session_replication_role=replica;
update public.refund_nayax_machine_inventory set provider_clock_timezone='America/Los_Angeles',provider_clock_source='native_machine_configuration',provider_clock_observed_at='2026-09-01T00:00Z',provider_clock_daylight_saving=true
 where account_key='TGPACI_USA_DB' and nayax_machine_id='18039901';
set local session_replication_role=origin;
select ok(public.service_refund_case_reader_clock('b7d70000-0000-4000-8000-000000000001','b7d40000-0000-4000-8000-000000000001') @> '{"provider_clock_timezone":"America/Los_Angeles","provider_clock_source":"native_machine_configuration","provider_clock_daylight_saving":true}','Case-scoped clock producer reads the retired exact inventory tuple');
select ok(private.refund_case_reader_clock_context_matches('b7d70000-0000-4000-8000-000000000001','b7d40000-0000-4000-8000-000000000001','{"reportingMachineId":"b7d40000-0000-4000-8000-000000000001","timezone":"America/Los_Angeles","source":"native_machine_configuration","observedAt":"2026-09-01T00:00:00Z"}'),'Four-field original clock snapshot matches despite the detached current tuple');
select ok(not private.refund_case_reader_clock_context_matches('b7d70000-0000-4000-8000-000000000099','b7d40000-0000-4000-8000-000000000001','{"reportingMachineId":"b7d40000-0000-4000-8000-000000000001","timezone":"America/Los_Angeles","source":"native_machine_configuration","observedAt":"2026-09-01T00:00:00Z"}'),'Wrong case scope cannot authorize the retired reader clock');
set local session_replication_role=replica;
update public.refund_nayax_machine_inventory set provider_clock_observed_at='2026-09-02T00:00Z' where account_key='TGPACI_USA_DB' and nayax_machine_id='18039901';
set local session_replication_role=origin;
select ok(not private.refund_case_reader_clock_context_matches('b7d70000-0000-4000-8000-000000000001','b7d40000-0000-4000-8000-000000000001','{"reportingMachineId":"b7d40000-0000-4000-8000-000000000001","timezone":"America/Los_Angeles","source":"native_machine_configuration","observedAt":"2026-09-01T00:00:00Z"}'),'Changed original clock observation invalidates the snapshot instead of borrowing a replacement clock');
select ok(not has_function_privilege('authenticated','public.service_refund_case_reader_clock(uuid,uuid)','execute') and not has_function_privilege('anon','public.service_refund_case_reader_clock(uuid,uuid)','execute'),'Original case clock producer remains service-only');
select * from finish();
rollback;
