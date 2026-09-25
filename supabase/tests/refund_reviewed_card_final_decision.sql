begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select plan(74);

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
        outcome := 'UNEXPECTED_APPROVAL';
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
 '2026-09-12T20:00:00Z',1090,'4242','USD',pg_temp.evidence(1090,1),now()+interval '1 hour'),
('e1460000-0000-4000-8000-000000000002','e1450000-0000-4000-8000-000000000001',1,null,
 'e1440000-0000-4000-8000-000000000001','REVIEWED-A-SALE-2',17,
 '2026-09-12T20:00:00Z',1190,'4242','USD',pg_temp.evidence(1190,2),now()+interval '1 hour'),
('e1460000-0000-4000-8000-000000000003','e1450000-0000-4000-8000-000000000002',1,null,
 'e1440000-0000-4000-8000-000000000001','REVIEWED-B-SALE-1',17,
 '2026-09-12T20:00:00Z',1090,'4242','USD',pg_temp.evidence(1090,1),now()+interval '1 hour'),
('e1460000-0000-4000-8000-000000000004','e1450000-0000-4000-8000-000000000002',1,null,
 'e1440000-0000-4000-8000-000000000001','REVIEWED-B-SALE-2',17,
 '2026-09-12T20:00:00Z',1190,'4242','USD',pg_temp.evidence(1190,2),now()+interval '1 hour'),
('e1460000-0000-4000-8000-000000000005','e1450000-0000-4000-8000-000000000003',1,null,
 'e1440000-0000-4000-8000-000000000001','REVIEWED-DENY-SALE-1',17,
 '2026-09-12T20:00:00Z',1090,'4242','USD',pg_temp.evidence(1090,1),now()+interval '1 hour'),
('e1460000-0000-4000-8000-000000000006','e1450000-0000-4000-8000-000000000004',1,null,
 'e1440000-0000-4000-8000-000000000003','REVIEWED-PUNCT-SALE-1',17,
 '2026-09-12T20:00:00Z',1090,'4242','USD',pg_temp.evidence(1090,1)||
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
select is(public.refund_manager_preparation_snapshot(
  'e1450000-0000-4000-8000-000000000001',
  (select official_action_version from public.refund_cases where id='e1450000-0000-4000-8000-000000000001')
)->>'evidenceBasis','card_reviewed_candidate_set',
  'completed current automatic research prepares a set without preselection');
select is((select matched_nayax_transaction_id from public.refund_cases
  where id='e1450000-0000-4000-8000-000000000001'),null::text,
  'completed review does not select or approve a purchase');
select is((public.refund_manager_preparation_snapshot(
  'e1450000-0000-4000-8000-000000000001',
  (select official_action_version from public.refund_cases where id='e1450000-0000-4000-8000-000000000001')
)->>'candidateCount')::integer,2,'both safe purchases are in the completed set');
select is((public.refund_manager_preparation_snapshot(
  'e1450000-0000-4000-8000-000000000001',
  (select official_action_version from public.refund_cases
    where id='e1450000-0000-4000-8000-000000000001'))
  ->'eligibleCandidateTokens'),
  '["e1460000-0000-4000-8000-000000000001", "e1460000-0000-4000-8000-000000000002"]'::jsonb,
  'the original prepared set exposes exactly its two safe opaque candidate tokens');
select is(public.refund_manager_preparation_snapshot(
  'e1450000-0000-4000-8000-000000000003',
  (select official_action_version from public.refund_cases where id='e1450000-0000-4000-8000-000000000003')
)->>'evidenceBasis','card_reviewed_candidate_set',
  'denial case is prepared without a saved selection');
select is(public.refund_manager_preparation_snapshot(
  'e1450000-0000-4000-8000-000000000004',
  (select official_action_version from public.refund_cases where id='e1450000-0000-4000-8000-000000000004')
)->>'evidenceBasis','card_reviewed_candidate_set',
  'normalized provider account evidence matches its punctuated stored machine key');

-- A new completed read may mint fresh tokens and a new proof for the same
-- eligible purchases. The notification identity follows business evidence.
create temp table ready_material_baseline on commit drop as
select public.refund_manager_decision_material_fingerprint(
  'e1450000-0000-4000-8000-000000000001',
  'approve_or_deny_request') as fingerprint,
  public.refund_manager_preparation_snapshot(
    'e1450000-0000-4000-8000-000000000001',
    (select official_action_version from public.refund_cases
      where id='e1450000-0000-4000-8000-000000000001'))->>'proofId' as proof_id;
select isnt((select fingerprint from ready_material_baseline),null::text,
  'Completed reviewed set has a material decision fingerprint');
savepoint ready_material_renewed_read;
select is((public.service_begin_refund_nayax_lookup(
  'e1450000-0000-4000-8000-000000000001',1,'scheduled',null
)->>'lookupGeneration')::bigint,2::bigint,
  'A new read creates a second generation without selecting a purchase');
insert into public.refund_nayax_lookup_candidates(
 token,refund_case_id,lookup_generation,actor_user_id,reporting_machine_id,
 provider_transaction_id,site_id,machine_authorization_time,amount_cents,
 card_last4,currency_code,evidence_summary,expires_at)
select case k.token
    when 'e1460000-0000-4000-8000-000000000001'::uuid
      then 'e1460000-0000-4000-8000-000000000101'::uuid
    else 'e1460000-0000-4000-8000-000000000102'::uuid end,
  k.refund_case_id,2,k.actor_user_id,k.reporting_machine_id,
  k.provider_transaction_id,k.site_id,k.machine_authorization_time,
  k.amount_cents,k.card_last4,k.currency_code,k.evidence_summary,k.expires_at
from public.refund_nayax_lookup_candidates k
where k.refund_case_id='e1450000-0000-4000-8000-000000000001'
  and k.lookup_generation=1;
select is((public.service_commit_refund_nayax_lookup(
  'e1450000-0000-4000-8000-000000000001',2,1,
  'multiple_matches','ambiguous','2026-09-05.v11',statement_timestamp(),
  'The same two purchases were reviewed again',null,2,'scheduled',null
)->>'applied'),'true','Renewed read completes with the same purchases');
select isnt(public.refund_manager_preparation_snapshot(
  'e1450000-0000-4000-8000-000000000001',
  (select official_action_version from public.refund_cases
    where id='e1450000-0000-4000-8000-000000000001'))->>'proofId',
  (select proof_id from ready_material_baseline),
  'Renewed evidence has a distinct opaque proof');
select is(public.refund_manager_decision_material_fingerprint(
  'e1450000-0000-4000-8000-000000000001',
  'approve_or_deny_request'),
  (select fingerprint from ready_material_baseline),
  'New token, proof and generation do not reopen the same decision');
savepoint ready_material_unrelated_block;
insert into public.refund_nayax_transaction_allocations(
  account_scope,provider_machine_id,original_transaction_id,refund_case_id)
values ('REVIEWED_ACCOUNT','REVIEWED-MACHINE','UNRELATED-BLOCKED-SALE',
  'e1450000-0000-4000-8000-000000000001');
select is(public.refund_manager_decision_material_fingerprint(
  'e1450000-0000-4000-8000-000000000001',
  'approve_or_deny_request'),
  (select fingerprint from ready_material_baseline),
  'Unrelated blocked evidence does not reopen the same decision');
rollback to savepoint ready_material_unrelated_block;
insert into public.refund_nayax_transaction_allocations(
  account_scope,provider_machine_id,original_transaction_id,refund_case_id)
values ('REVIEWED_ACCOUNT','REVIEWED-MACHINE','REVIEWED-A-SALE-2',
  'e1450000-0000-4000-8000-000000000001');
select isnt(public.refund_manager_decision_material_fingerprint(
  'e1450000-0000-4000-8000-000000000001',
  'approve_or_deny_request'),
  (select fingerprint from ready_material_baseline),
  'A changed current eligible purchase set is a new material decision');
rollback to savepoint ready_material_renewed_read;

create temp table reviewed_initial on commit drop as
select c.id case_id,c.official_action_version action_version,
  (public.refund_manager_preparation_snapshot(c.id,c.official_action_version)->>'proofId')::uuid proof_id
from public.refund_cases c
where c.id in ('e1450000-0000-4000-8000-000000000001',
  'e1450000-0000-4000-8000-000000000002',
  'e1450000-0000-4000-8000-000000000003');
grant select on reviewed_initial to authenticated;
create temp table reviewed_approval_a(result jsonb) on commit drop;
create temp table reviewed_replay(result jsonb) on commit drop;
create temp table reviewed_approval_b(result jsonb) on commit drop;
grant select, insert on reviewed_approval_a, reviewed_replay,
  reviewed_approval_b to authenticated;

select pg_temp.set_actor('e1410000-0000-4000-8000-000000000001');
select matches(pg_temp.probe_rolled_back_decision(
  $$update public.refund_cases set payment_amount_cents=1200
    where id='e1450000-0000-4000-8000-000000000001'$$,
  (select case_id from reviewed_initial where case_id='e1450000-0000-4000-8000-000000000001'),
  (select action_version from reviewed_initial where case_id='e1450000-0000-4000-8000-000000000001'),
  (select proof_id from reviewed_initial where case_id='e1450000-0000-4000-8000-000000000001'),
  'e1460000-0000-4000-8000-000000000001'
), '^P4620:', 'changed customer amount/fact rejects stale proof atomically');
select matches(pg_temp.probe_rolled_back_decision(
  $$select public.service_begin_refund_nayax_lookup(
    'e1450000-0000-4000-8000-000000000001',1,'scheduled',null)$$,
  (select case_id from reviewed_initial where case_id='e1450000-0000-4000-8000-000000000001'),
  (select action_version from reviewed_initial where case_id='e1450000-0000-4000-8000-000000000001'),
  (select proof_id from reviewed_initial where case_id='e1450000-0000-4000-8000-000000000001'),
  'e1460000-0000-4000-8000-000000000001'
), '^P4620:', 'a new lookup generation rejects the old reviewed set');
select matches(pg_temp.probe_rolled_back_decision(
  $$update public.reporting_machines set nayax_account_key='CHANGED_ACCOUNT'
    where id='e1440000-0000-4000-8000-000000000001'$$,
  (select case_id from reviewed_initial where case_id='e1450000-0000-4000-8000-000000000001'),
  (select action_version from reviewed_initial where case_id='e1450000-0000-4000-8000-000000000001'),
  (select proof_id from reviewed_initial where case_id='e1450000-0000-4000-8000-000000000001'),
  'e1460000-0000-4000-8000-000000000001'
), '^P4620:', 'a changed machine account cannot approve under prior proof');
select matches(pg_temp.capture_error($$
  update public.refund_nayax_lookup_candidates set currency_code='EUR'
    where token='e1460000-0000-4000-8000-000000000001'$$),
  '^P0001:Nayax candidate evidence is immutable',
  'persisted candidate currency cannot be rewritten after the provider read');
select matches(pg_temp.capture_error($$
  update public.refund_nayax_lookup_candidates
    set reporting_machine_id='e1440000-0000-4000-8000-000000000002'
    where token='e1460000-0000-4000-8000-000000000001'$$),
  '^P0001:Nayax candidate evidence is immutable',
  'persisted candidate machine cannot be reassigned');
select matches(pg_temp.capture_error($$
  update public.refund_nayax_lookup_candidates set evidence_summary=
    jsonb_set(evidence_summary,'{provider_refund_state}','"refunded"'::jsonb)
    where token='e1460000-0000-4000-8000-000000000001'$$),
  '^P0001:Nayax candidate evidence is immutable',
  'persisted refundability evidence cannot be rewritten');
select matches(pg_temp.probe_rolled_back_decision(
  $$insert into public.refund_nayax_transaction_allocations(
      account_scope,provider_machine_id,original_transaction_id,refund_case_id)
    values('REVIEWED-ACCOUNT','PUNCT-MACHINE','REVIEWED-PUNCT-SALE-1',
      'e1450000-0000-4000-8000-000000000003')$$,
  'e1450000-0000-4000-8000-000000000004',
  (select official_action_version from public.refund_cases
    where id='e1450000-0000-4000-8000-000000000004'),
  (public.refund_manager_preparation_snapshot(
    'e1450000-0000-4000-8000-000000000004',
    (select official_action_version from public.refund_cases
      where id='e1450000-0000-4000-8000-000000000004'))->>'proofId')::uuid,
  'e1460000-0000-4000-8000-000000000006'
), '^P4620:', 'raw punctuated execution account allocation blocks the exact reviewed sale');
-- Unsafe evidence must be seeded as new immutable rows, never made reachable by
-- rewriting a completed provider candidate. Case D is not a payment case.
insert into public.refund_nayax_lookup_candidates(
 token,refund_case_id,lookup_generation,actor_user_id,reporting_machine_id,
 provider_transaction_id,site_id,machine_authorization_time,amount_cents,
 card_last4,currency_code,evidence_summary,expires_at)
values
('e1460000-0000-4000-8000-000000000007','e1450000-0000-4000-8000-000000000004',1,null,
 'e1440000-0000-4000-8000-000000000003','REVIEWED-PUNCT-EUR',17,
 '2026-09-12T20:00:00Z',1090,'4242','EUR',pg_temp.evidence(1090,1)||
 jsonb_build_object('lookup_provider_machine_id','PUNCT-MACHINE',
   'provider_machine_id','PUNCT-MACHINE','currency_code','EUR',
   'selection_allowed',false,'identifier_review_state','blocked_safety',
   'hard_exclusions','["currency_not_usd"]'::jsonb,
   'reason_codes','["machine_exact","provider_sale_approved","currency_not_usd"]'::jsonb),
 now()+interval '1 hour'),
('e1460000-0000-4000-8000-000000000008','e1450000-0000-4000-8000-000000000004',1,null,
 'e1440000-0000-4000-8000-000000000002','REVIEWED-PUNCT-WRONG-MACHINE',17,
 '2026-09-12T20:00:00Z',1090,'4242','USD',pg_temp.evidence(1090,1)||
 jsonb_build_object('lookup_account_scope','OTHER_ACCOUNT',
   'lookup_provider_machine_id','OTHER-MACHINE',
   'provider_machine_id','OTHER-MACHINE','selection_allowed',false,
   'identifier_review_state','blocked_safety',
   'hard_exclusions','["wrong_machine"]'::jsonb,
   'reason_codes','["provider_machine_mismatch","provider_sale_approved"]'::jsonb),
 now()+interval '1 hour'),
('e1460000-0000-4000-8000-000000000009','e1450000-0000-4000-8000-000000000004',1,null,
 'e1440000-0000-4000-8000-000000000003','REVIEWED-PUNCT-REFUNDED',17,
 '2026-09-12T20:00:00Z',1090,'4242','USD',pg_temp.evidence(1090,1)||
 jsonb_build_object('lookup_provider_machine_id','PUNCT-MACHINE',
   'provider_machine_id','PUNCT-MACHINE',
   'provider_refund_state','already_refunded','selection_allowed',false,
   'identifier_review_state','blocked_safety',
   'hard_exclusions','["already_refunded"]'::jsonb,
   'reason_codes','["machine_exact","provider_sale_approved","already_refunded"]'::jsonb),
 now()+interval '1 hour');
select is((select count(*)::integer from public.refund_nayax_lookup_candidates
  where token in ('e1460000-0000-4000-8000-000000000007',
    'e1460000-0000-4000-8000-000000000008',
    'e1460000-0000-4000-8000-000000000009')),3,
  'three truthful unselectable provider rows passed the normal insert guard');
select is(public.refund_reviewed_card_candidate_safe_v1(
  'e1450000-0000-4000-8000-000000000004','e1460000-0000-4000-8000-000000000007'),false,
  'non-USD provider sale cannot enter the reviewed execution set');
select is(public.refund_reviewed_card_candidate_safe_v1(
  'e1450000-0000-4000-8000-000000000004','e1460000-0000-4000-8000-000000000008'),false,
  'different reporting machine cannot enter the reviewed execution set');
select is(public.refund_reviewed_card_candidate_safe_v1(
  'e1450000-0000-4000-8000-000000000004','e1460000-0000-4000-8000-000000000009'),false,
  'already-refunded provider sale cannot enter the reviewed execution set');
select is(public.refund_manager_preparation_snapshot(
  'e1450000-0000-4000-8000-000000000004',
  (select official_action_version from public.refund_cases
   where id='e1450000-0000-4000-8000-000000000004')),null::jsonb,
  'new unsafe evidence invalidates the previously completed candidate set');
select matches(pg_temp.probe_rolled_back_decision(
  $$insert into public.refund_nayax_transaction_allocations(
      account_scope,provider_machine_id,original_transaction_id,refund_case_id)
    values('REVIEWED_ACCOUNT','REVIEWED-MACHINE','REVIEWED-A-SALE-1',
      'e1450000-0000-4000-8000-000000000003')$$,
  (select case_id from reviewed_initial where case_id='e1450000-0000-4000-8000-000000000001'),
  (select action_version from reviewed_initial where case_id='e1450000-0000-4000-8000-000000000001'),
  (select proof_id from reviewed_initial where case_id='e1450000-0000-4000-8000-000000000001'),
  'e1460000-0000-4000-8000-000000000001'
), '^P4620:', 'another case reserving the exact sale atomically blocks final approval');
select is((select count(*)::integer from public.refund_nayax_transaction_allocations
  where original_transaction_id='REVIEWED-A-SALE-1'),0,
  'failed overlapping allocation probe rolled back its reservation');
select matches(pg_temp.probe_rolled_back_decision(
  $$update public.refund_cases set nayax_refund_execution_status='ambiguous'
    where id='e1450000-0000-4000-8000-000000000001'$$,
  (select case_id from reviewed_initial where case_id='e1450000-0000-4000-8000-000000000001'),
  (select action_version from reviewed_initial where case_id='e1450000-0000-4000-8000-000000000001'),
  (select proof_id from reviewed_initial where case_id='e1450000-0000-4000-8000-000000000001'),
  'e1460000-0000-4000-8000-000000000001'
), '^P4620:', 'unknown prior payment effect cannot receive a fresh final decision');
select matches(pg_temp.probe_rolled_back_decision(
  $$update public.reporting_machine_refund_managers set status='revoked',
    revoked_at=statement_timestamp(),revoke_reason='Fixture revocation'
    where manager_user_id='e1410000-0000-4000-8000-000000000001'$$,
  (select case_id from reviewed_initial where case_id='e1450000-0000-4000-8000-000000000001'),
  (select action_version from reviewed_initial where case_id='e1450000-0000-4000-8000-000000000001'),
  (select proof_id from reviewed_initial where case_id='e1450000-0000-4000-8000-000000000001'),
  'e1460000-0000-4000-8000-000000000001'
), '^42501:', 'revoked current machine Manager cannot choose a reviewed purchase');
select is((select count(*)::integer from public.refund_case_nayax_refund_attempts
  where refund_case_id='e1450000-0000-4000-8000-000000000001'),0,
  'every failed final-decision probe rolled back without a payment attempt');
set local role authenticated;
select matches(pg_temp.capture_error(format(
  'select public.admin_approve_reviewed_nayax_candidate_v1(%L,%s,%L::uuid,%L::uuid)',
  'e1450000-0000-4000-8000-000000000001',
  (select official_action_version from public.refund_cases where id='e1450000-0000-4000-8000-000000000001'),
  (select proof_id from reviewed_initial
    where case_id='e1450000-0000-4000-8000-000000000001'),
  'e1460000-0000-4000-8000-000000000004'
)), '^P4620:','a token from another case cannot be approved');
reset role;

create function pg_temp.probe_mixed_allocation()
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  target_id constant uuid := 'e1450000-0000-4000-8000-000000000001';
  original record;
  current_proof jsonb;
  stale_error text;
  blocked_error text;
  safe_approval jsonb;
  outcome jsonb;
begin
  select action_version, proof_id into original
    from pg_temp.reviewed_initial where case_id=target_id;
  begin
    insert into public.refund_nayax_transaction_allocations(
      account_scope,provider_machine_id,original_transaction_id,refund_case_id
    ) values('REVIEWED_ACCOUNT','REVIEWED-MACHINE','REVIEWED-A-SALE-2',
      'e1450000-0000-4000-8000-000000000003');
    current_proof := public.refund_reviewed_card_candidate_set_snapshot_v1(
      target_id,original.action_version);
    begin
      perform public.admin_approve_reviewed_nayax_candidate_v1(
        target_id,original.action_version,original.proof_id,
        'e1460000-0000-4000-8000-000000000001');
      stale_error := 'UNEXPECTED_APPROVAL';
    exception when others then stale_error := sqlstate || ':' || sqlerrm;
    end;
    begin
      perform public.admin_approve_reviewed_nayax_candidate_v1(
        target_id,original.action_version,(current_proof->>'proofId')::uuid,
        'e1460000-0000-4000-8000-000000000002');
      blocked_error := 'UNEXPECTED_APPROVAL';
    exception when others then blocked_error := sqlstate || ':' || sqlerrm;
    end;
    safe_approval := public.admin_approve_reviewed_nayax_candidate_v1(
      target_id,original.action_version,(current_proof->>'proofId')::uuid,
      'e1460000-0000-4000-8000-000000000001');
    outcome := jsonb_build_object(
      'oldProofChanged',current_proof->>'proofId'<>original.proof_id::text,
      'eligibleTokens',current_proof->'eligibleCandidateTokens',
      'candidateCount',current_proof->'candidateCount',
      'staleError',stale_error,'blockedError',blocked_error,
      'safeApproved',safe_approval->>'approved',
      'attemptCount',(select count(*) from public.refund_case_nayax_refund_attempts
        where refund_case_id=target_id));
    raise exception 'rollback mixed allocation probe' using errcode='P0001';
  exception when sqlstate 'P0001' then return outcome;
  end;
end $$;
create temp table reviewed_mixed_probe(result jsonb) on commit drop;
insert into reviewed_mixed_probe select pg_temp.probe_mixed_allocation();
select is((select result->>'oldProofChanged' from reviewed_mixed_probe),'true',
  'new exact allocation changes the completed-set proof without changing research provenance');
select is((select result->'eligibleTokens' from reviewed_mixed_probe),
  '["e1460000-0000-4000-8000-000000000001"]'::jsonb,
  'remaining safe purchase alone is exposed as eligible in the completed set');
select is((select (result->>'candidateCount')::integer from reviewed_mixed_probe),1,
  'prepared candidate count reflects currently safe choices');
select matches((select result->>'staleError' from reviewed_mixed_probe),'^P4620:',
  'old proof cannot approve even the safe purchase after allocation changes');
select matches((select result->>'blockedError' from reviewed_mixed_probe),'^P4620:',
  'currently allocated purchase cannot be approved using the fresh proof');
select ok((select result->>'safeApproved'='true'
    and (result->>'attemptCount')::integer=1 from reviewed_mixed_probe)
    and not exists(select 1 from public.refund_nayax_transaction_allocations
      where original_transaction_id='REVIEWED-A-SALE-2'),
  'remaining safe purchase approves once in probe while allocation and attempt roll back');

set local role authenticated;
insert into reviewed_approval_a
select public.admin_approve_reviewed_nayax_candidate_v1(
  case_id,action_version,proof_id,'e1460000-0000-4000-8000-000000000001') result
from reviewed_initial where case_id='e1450000-0000-4000-8000-000000000001';
select is((select result->>'approved' from reviewed_approval_a),'true',
  'one final Manager decision approves the first exact reviewed sale');
reset role;
select is((select refund_amount_cents from public.refund_cases
  where id='e1450000-0000-4000-8000-000000000001'),1090,
  'the provider full charge, not the customer estimate, is frozen');
select is((select count(*)::integer from public.refund_case_nayax_refund_attempts
  where refund_case_id='e1450000-0000-4000-8000-000000000001'),1,
  'one protected provider-free attempt is queued');
set local role authenticated;
insert into reviewed_replay
select public.admin_approve_reviewed_nayax_candidate_v1(
  case_id,action_version,proof_id,'e1460000-0000-4000-8000-000000000001') result
from reviewed_initial where case_id='e1450000-0000-4000-8000-000000000001';
select is((select result->>'attemptId' from reviewed_replay),
  (select result->>'attemptId' from reviewed_approval_a),
  'duplicate final-action retry returns the same authoritative attempt');
select is((select result->>'replayed' from reviewed_replay),'true',
  'duplicate response is visibly acknowledged as a replay');
reset role;
select is((select count(*)::integer from public.refund_case_official_action_authorizations
  where refund_case_id='e1450000-0000-4000-8000-000000000001' and action='approve'),1,
  'replay creates no second official authorization');
insert into public.refund_nayax_provider_callers(caller_id,assertion_digest,status)
values('nayax-card-refund',
  encode(extensions.digest(convert_to('reviewed-fixture-executor','UTF8'),'sha256'),'hex'),
  'active')
on conflict(caller_id) do update set
  assertion_digest=excluded.assertion_digest,status='active';
create function pg_temp.probe_approved_attempt_after_revocation()
returns boolean language plpgsql security definer set search_path='' as $$
declare claimed jsonb; held jsonb; continued boolean := false;
begin
  begin
    update public.reporting_machine_refund_managers
      set status='revoked',revoked_at=statement_timestamp(),
        revoke_reason='Fixture post-approval revocation'
      where manager_user_id='e1410000-0000-4000-8000-000000000001';
    claimed := public.service_claim_due_nayax_refund_attempts_v1(
      'reviewed-fixture-executor','REVIEWED_ACCOUNT',
      'exact_source','empty_string',2);
    if exists(select 1 from jsonb_array_elements(claimed->'claims') claim
      where claim->>'attemptId'=(select approval.result->>'attemptId'
        from pg_temp.reviewed_approval_a approval)) then
      held := public.service_hold_nayax_refund_attempt_v1(
        'reviewed-fixture-executor',
        (select (approval.result->>'attemptId')::uuid
          from pg_temp.reviewed_approval_a approval),
        'provider_result_unknown');
      continued := held->>'held'='true';
    end if;
    raise exception 'rollback post-approval service probe' using errcode='ZX001';
  exception when sqlstate 'ZX001' then return continued;
  end;
end $$;
select is(pg_temp.probe_approved_attempt_after_revocation(),true,
  'revoking the Manager after approval does not revoke the existing System attempt');
select is((select count(*)::integer from public.reporting_machine_refund_managers
  where manager_user_id='e1410000-0000-4000-8000-000000000001'
    and status='revoked'),0,
  'post-approval service probe restores the original Manager mapping');
set local role authenticated;
select matches(pg_temp.probe_rolled_back_decision(
  $$update public.reporting_machine_refund_managers set status='revoked',
    revoked_at=statement_timestamp(),revoke_reason='Fixture revocation'
    where manager_user_id='e1410000-0000-4000-8000-000000000001'$$,
  (select case_id from reviewed_initial where case_id='e1450000-0000-4000-8000-000000000001'),
  (select action_version from reviewed_initial where case_id='e1450000-0000-4000-8000-000000000001'),
  (select proof_id from reviewed_initial where case_id='e1450000-0000-4000-8000-000000000001'),
  'e1460000-0000-4000-8000-000000000001'
), '^42501:', 'replayed acknowledgement still requires current machine Manager authority');
select matches(pg_temp.capture_error(format(
  'select public.admin_approve_reviewed_nayax_candidate_v1(%L,%s,%L::uuid,%L::uuid)',
  'e1450000-0000-4000-8000-000000000001',
  (select action_version from reviewed_initial where case_id='e1450000-0000-4000-8000-000000000001'),
  (select proof_id from reviewed_initial where case_id='e1450000-0000-4000-8000-000000000001'),
  'e1460000-0000-4000-8000-000000000002'
)), '^P4620:','a changed candidate after approval cannot create another attempt');
insert into reviewed_approval_b
select public.admin_approve_reviewed_nayax_candidate_v1(
  case_id,action_version,proof_id,'e1460000-0000-4000-8000-000000000004') result
from reviewed_initial where case_id='e1450000-0000-4000-8000-000000000002';
select is((select result->>'approved' from reviewed_approval_b),'true',
  'another case can approve the other safe reviewed sale');
reset role;
select is((select refund_amount_cents from public.refund_cases
  where id='e1450000-0000-4000-8000-000000000002'),1190,
  'the alternate exact provider total is preserved');

create temp table reviewed_denial(authorization_id uuid) on commit drop;
grant select, insert on reviewed_denial to authenticated;
grant select on reviewed_denial to service_role;
set local role authenticated;
select pg_temp.set_actor('e1410000-0000-4000-8000-000000000001');
insert into reviewed_denial
select (public.admin_authorize_refund_official_action(
  'e1450000-0000-4000-8000-000000000003','decline',
  (select action_version from reviewed_initial
    where case_id='e1450000-0000-4000-8000-000000000003'),
  'denied','denied',null,
  'We could not verify a matching purchase for the details provided.',
  null,null,null,null,false,null,null
)->>'authorizationId')::uuid;
reset role;
select ok((select authorization_id is not null from reviewed_denial),
  'prepared Manager may deny without choosing any purchase');
set local role service_role;
select public.service_apply_refund_official_case_update(
  (select authorization_id from reviewed_denial),
  'e1450000-0000-4000-8000-000000000003','decline','denied',null,'denied',
  'We could not verify a matching purchase for the details provided.',
  null,null,null,null,null
);
reset role;
select ok((select status='denied' and decision='denied'
    and matched_nayax_transaction_id is null from public.refund_cases
    where id='e1450000-0000-4000-8000-000000000003'),
  'denial is terminal without a prior Select or new purchase binding');
select is((select count(*)::integer from public.refund_case_nayax_refund_attempts
  where refund_case_id='e1450000-0000-4000-8000-000000000003'),0,
  'denial creates no protected payment attempt');
select is((select count(*)::integer from public.refund_case_events
  where refund_case_id='e1450000-0000-4000-8000-000000000003'
    and event_type='nayax_reviewed_set_final_decision_committed'),0,
  'denial does not invent an approved-card replay receipt');

select is((select count(*)::integer from public.refund_case_nayax_refund_attempts
  where refund_case_id in ('e1450000-0000-4000-8000-000000000001',
    'e1450000-0000-4000-8000-000000000002')),2,
  'two separate approved cases have exactly one attempt each');
select is((select count(*)::integer from public.refund_case_events
  where event_type='nayax_reviewed_set_final_decision_committed'
    and refund_case_id in ('e1450000-0000-4000-8000-000000000001',
      'e1450000-0000-4000-8000-000000000002')),2,
  'each decision has one replayable immutable receipt');
select is(public.refund_manager_preparation_snapshot(
  'e1450000-0000-4000-8000-000000000001',
  (select official_action_version from public.refund_cases where id='e1450000-0000-4000-8000-000000000001')
),null::jsonb,'completed prior approval never opens another preparation decision');

-- A lost response after the System worker advances must describe the current
-- immutable outcome, not announce a fresh Manager action or another payment.
create temp table reviewed_claims(result jsonb) on commit drop;
grant select, insert on reviewed_claims to service_role;
set local role service_role;
insert into reviewed_claims
select public.service_claim_due_nayax_refund_attempts_v1(
  'reviewed-fixture-executor','REVIEWED_ACCOUNT','exact_source','empty_string',2
);
select is((select jsonb_array_length(result->'claims') from reviewed_claims),2,
  'existing System worker claims both reviewed approvals without a Manager retry');
select is((public.service_hold_nayax_refund_attempt_v1(
  'reviewed-fixture-executor',
  (select (result->'claims'->0->>'attemptId')::uuid from reviewed_claims),
  'provider_result_unknown')->>'held'),'true',
  'first claimed attempt enters the existing unknown-outcome hold');
select is((public.service_hold_nayax_refund_attempt_v1(
  'reviewed-fixture-executor',
  (select (result->'claims'->1->>'attemptId')::uuid from reviewed_claims),
  'provider_result_unknown')->>'held'),'true',
  'second claimed attempt enters the existing unknown-outcome hold');
reset role;
insert into public.refund_gmail_threads(id,refund_case_id,mailbox_hash,
  provider_thread_id,thread_subject,first_message_at,latest_message_at,
  retention_expires_at)
values('e1490000-0000-4000-8000-000000000001',
  'e1450000-0000-4000-8000-000000000001',repeat('d',64),
  'reviewed-success-thread','Synthetic prior customer thread',
  statement_timestamp()-interval '2 days',statement_timestamp()-interval '2 days',
  statement_timestamp()+interval '180 days');
create temp table reviewed_terminal_replay(result jsonb) on commit drop;
create temp table reviewed_failure_replay(result jsonb) on commit drop;
grant select, insert on reviewed_terminal_replay, reviewed_failure_replay
  to authenticated;
set local role authenticated;
select pg_temp.set_actor('e1410000-0000-4000-8000-000000000001');
select is((public.admin_record_nayax_system_outcome_evidence_v1(
  'e1450000-0000-4000-8000-000000000001',
  (select (result->>'attemptId')::uuid from reviewed_approval_a),
  'provider_confirmed_success','nayax_dtm_transaction','DTM:NAYAX-123456789',
  statement_timestamp(),'America/Los_Angeles','nayax_dtm_settled',
  (select official_action_version from public.refund_cases
    where id='e1450000-0000-4000-8000-000000000001'))->>'resolved'),'true',
  'supported evidence writer completes the same originally approved attempt');
select is((public.admin_record_nayax_system_outcome_evidence_v1(
  'e1450000-0000-4000-8000-000000000002',
  (select (result->>'attemptId')::uuid from reviewed_approval_b),
  'provider_confirmed_no_refund','nayax_dtm_transaction','DTM:NAYAX-987654321',
  statement_timestamp(),'America/Los_Angeles','nayax_dtm_not_refunded',
  (select official_action_version from public.refund_cases
    where id='e1450000-0000-4000-8000-000000000002'))->>'status'),'system_finishing',
  'authoritative no-refund evidence requeues the same approval and attempt');
insert into reviewed_terminal_replay
select public.admin_approve_reviewed_nayax_candidate_v1(
  case_id,action_version,proof_id,'e1460000-0000-4000-8000-000000000001')
from reviewed_initial where case_id='e1450000-0000-4000-8000-000000000001';
select is((select result->>'status' from reviewed_terminal_replay),'completed',
  'lost-response retry reports receipt-backed completed payment truth');
select ok((select result->>'replayed'='true'
    and result->>'attemptId'=(select result->>'attemptId' from reviewed_approval_a)
    and result->>'providerCallMade'='false'
    from reviewed_terminal_replay),
  'completed replay acknowledges the same attempt without a provider call');
insert into reviewed_failure_replay
select public.admin_approve_reviewed_nayax_candidate_v1(
  case_id,action_version,proof_id,'e1460000-0000-4000-8000-000000000004')
from reviewed_initial where case_id='e1450000-0000-4000-8000-000000000002';
select is((select result->>'status' from reviewed_failure_replay),'system_finishing',
  'proved no-refund resolution reports same-attempt System continuation');
select ok((select result->>'replayed'='true'
    and result->>'attemptId'=(select result->>'attemptId' from reviewed_approval_b)
    and result->>'providerCallMade'='false'
    from reviewed_failure_replay),
  'definitive no-refund retry never creates another Manager approval or attempt');
reset role;
select is((select count(*)::integer from public.refund_case_nayax_refund_attempts
  where refund_case_id in ('e1450000-0000-4000-8000-000000000001',
    'e1450000-0000-4000-8000-000000000002')),2,
  'terminal and no-refund replay retain exactly the original two attempts');

select * from finish();
rollback;
