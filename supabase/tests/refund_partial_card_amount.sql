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
select * from finish();
rollback;
