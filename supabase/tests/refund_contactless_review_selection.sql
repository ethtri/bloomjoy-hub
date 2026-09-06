begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(26);

insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data)
values('fc110000-0000-4000-8000-000000000001','authenticated','authenticated',
  'contactless-review-manager@example.invalid','{}','{}');
insert into public.customer_accounts(id,name,account_type)
values('fc120000-0000-4000-8000-000000000001','Contactless review fixture','internal');
insert into public.reporting_locations(id,account_id,name,timezone)
values('fc130000-0000-4000-8000-000000000001','fc120000-0000-4000-8000-000000000001',
  'Contactless review location','America/Los_Angeles');
insert into public.reporting_machines(id,account_id,location_id,machine_label,status,nayax_machine_id,
  nayax_account_key,nayax_refunds_enabled)
values('fc140000-0000-4000-8000-000000000001','fc120000-0000-4000-8000-000000000001',
  'fc130000-0000-4000-8000-000000000001','Contactless review machine','active',
  'CONTACTLESS-REVIEW-MACHINE','CONTACTLESS_REVIEW_ACCOUNT',true);
insert into public.reporting_machine_refund_managers(reporting_machine_id,manager_user_id,manager_email,grant_reason)
values('fc140000-0000-4000-8000-000000000001','fc110000-0000-4000-8000-000000000001',
  'contactless-review-manager@example.invalid','Fixture');
insert into public.refund_nayax_machine_inventory(account_key,nayax_machine_id,reporting_machine_id)
values('CONTACTLESS_REVIEW_ACCOUNT','CONTACTLESS-REVIEW-MACHINE','fc140000-0000-4000-8000-000000000001');

insert into public.refund_cases(id,public_reference,reporting_machine_id,reporting_location_id,customer_email,
  issue_summary,incident_at,incident_timezone,incident_time_resolution,incident_time_confidence,
  incident_time_source,nearby_attempt_count,payment_method,payment_amount_cents,refund_amount_cents,
  card_last4,card_last4_provenance,card_last4_source,payment_interaction,status,correlation_status,
  deterministic_fact_version,intake_source,intake_meta,customer_request_received_at,
  customer_request_received_source)
values('fc150000-0000-4000-8000-000000000001','RF-CONTACTLESS-REVIEW',
  'fc140000-0000-4000-8000-000000000001','fc130000-0000-4000-8000-000000000001',
  'contactless-review-customer@example.invalid','Charged without product',
  '2026-08-22T20:00:00Z','America/Los_Angeles','exact','exact',null,null,
  'card',1090,1090,'6768','physical_card',null,'tap_card','needs_review','needs_nayax',
  2,'form','{}',null,null);

create function pg_temp.contactless_evidence(
  selection_allowed boolean default true,
  review_state text default 'reviewable_uncertainty',
  last4_comparison text default 'mismatch_neutral_unproven_scope',
  duplicate_record boolean default false,
  hard_exclusions jsonb default '[]'::jsonb,
  correction_fields jsonb default '[]'::jsonb,
  provider_machine_id text default 'CONTACTLESS-REVIEW-MACHINE',
  amount_delta integer default 0,
  provider_amount integer default 1090
) returns jsonb language sql stable as $$
  select jsonb_build_object(
    'selection_allowed',selection_allowed,'is_recommended',true,'one_click_eligible',false,
    'recommendation_state','manual_exception','confidence_class','evidence_aware_review',
    'policy_version','2026-09-05.v11','identifier_policy_version','2026-09-05.identifier.v2',
    'customer_fact_version',c.deterministic_fact_version,
    'customer_credential_class',case when c.payment_interaction='swipe_card'
      then 'customer_physical_swipe_pan' else 'customer_physical_contactless_pan' end,
    'provider_identifier_class',case when c.payment_interaction='swipe_card'
      then 'last_sales_swipe_identifier_unverified' else 'last_sales_present_identifier_unverified' end,
    'card_last4_comparison',last4_comparison,'card_network_comparison','missing',
    'payment_interaction_comparison',case when c.payment_interaction='swipe_card' then 'supporting' else 'unknown' end,
    'same_identifier_equivalence_proven',false,'identifier_review_state',review_state,
    'customer_correction_fields',correction_fields,'hard_exclusions',hard_exclusions,
    'manual_review_reasons','["customer_request_time_unknown","transaction_occurrence_time_uncertain","card_last4_mismatch_reviewable"]'::jsonb,
    'reason_codes','["machine_exact","amount_exact","customer_request_time_unknown","transaction_occurrence_time_uncertain","card_last4_mismatch_neutral_unproven_scope"]'::jsonb
  ) || jsonb_build_object(
    'match_factors','[]'::jsonb,'match_reason','Exact machine and amount; contactless identifier needs manager review',
    'recommendation_rank',1,'is_top_ranked',true,'lookup_account_scope','CONTACTLESS_REVIEW_ACCOUNT',
    'lookup_provider_machine_id','CONTACTLESS-REVIEW-MACHINE','provider_machine_id',provider_machine_id,
    'machine_authorization_time_raw','2026-08-22T20:15:00Z',
    'machine_authorization_at','2026-08-22T20:15:00Z','machine_authorization_time_source','MachineAuthorizationTime',
    'machine_time_resolution','exact','provider_time_resolution','exact','provider_time_source','authorization_gmt',
    'authorized_at','2026-08-22T20:15:00Z','customer_request_received_at',null,
    'customer_request_received_source',null,'request_time_boundary','request_time_unknown',
    'transaction_occurrence_comparable',false,'transaction_occurrence_semantics','unknown',
    'transaction_occurrence_proof_source',null,'transaction_occurrence_timestamp_source',null,
    'transaction_occurrence_timezone_basis',null,'transaction_occurrence_lower_bound_at',null,
    'transaction_occurrence_upper_bound_at',null,'request_receipt_lower_bound_at',null,
    'request_receipt_upper_bound_at',null,'amount_delta_cents',amount_delta,'time_delta_minutes',null,
    'provider_processing_time_delta_minutes',15,'payment_status','approved',
    'payment_status_evidence','last_sales_contract','provider_refund_state','clear',
    'duplicate_provider_record',duplicate_record,'card_last4','3760','currency_code','USD','amount_cents',provider_amount
  ) from public.refund_cases c where c.id='fc150000-0000-4000-8000-000000000001';
$$;

select is(public.refund_nayax_candidate_identifier_evidence_state(
  'fc150000-0000-4000-8000-000000000001','fc140000-0000-4000-8000-000000000001',101,
  '2026-08-22T20:15:00Z',1090,'3760','USD',pg_temp.contactless_evidence()
), 'valid','Neutral physical-contactless suffix difference is valid for manual review without optional customer facts');

select is(public.refund_nayax_candidate_identifier_evidence_state(
  'fc150000-0000-4000-8000-000000000001','fc140000-0000-4000-8000-000000000001',101,
  '2026-08-22T20:15:00Z',1090,'3760','USD',pg_temp.contactless_evidence(false)
), 'invalid','Server rejects scorer disagreement that disables an otherwise valid contactless review');

select is(public.refund_nayax_identifier_evidence_state(2,
  jsonb_set(pg_temp.contactless_evidence(),'{identifier_policy_version}','"2026-09-05.identifier.v1"'::jsonb)
), 'refresh','Immutable v1 evidence remains readable but requires a fresh v2 lookup before selection');

select is(public.refund_nayax_identifier_evidence_state(2,
  jsonb_set(pg_temp.contactless_evidence(),'{one_click_eligible}','true'::jsonb)
), 'invalid','A suffix difference can never become one-click evidence');

select is(public.refund_nayax_candidate_identifier_evidence_state(
  'fc150000-0000-4000-8000-000000000001','fc140000-0000-4000-8000-000000000001',101,
  '2026-08-22T20:15:00Z',1091,'3760','USD',
  jsonb_set(pg_temp.contactless_evidence(),'{amount_delta_cents}','1'::jsonb)
), 'valid','A one-cent customer amount difference remains contextual manager-review evidence');

select is(public.refund_nayax_candidate_identifier_evidence_state(
  'fc150000-0000-4000-8000-000000000001','fc140000-0000-4000-8000-000000000001',101,
  '2026-08-22T20:15:00Z',2590,'3760','USD',
  pg_temp.contactless_evidence(amount_delta => 1500, provider_amount => 2590)
), 'valid','A difference above the old three-dollar threshold remains contextual for the neutral contactless review');

select is(public.refund_nayax_candidate_identifier_evidence_state(
  'fc150000-0000-4000-8000-000000000001','fc140000-0000-4000-8000-000000000001',101,
  '2026-08-22T20:15:00Z',1090,'3760','USD',
  jsonb_set(pg_temp.contactless_evidence(),'{payment_interaction_comparison}',
    '"conflict_unverified_provider_semantics"'::jsonb)
), 'valid','An unverified provider interaction label does not override the settled customer tap fact');

select is(public.refund_nayax_candidate_identifier_evidence_state(
  'fc150000-0000-4000-8000-000000000001','fc140000-0000-4000-8000-000000000001',101,
  '2026-08-22T20:15:00Z',1090,'3760','USD',
  jsonb_set(jsonb_set(pg_temp.contactless_evidence(),'{authorized_at}',
    '"2026-08-22T23:30:00Z"'::jsonb),'{provider_processing_time_delta_minutes}','210'::jsonb)
), 'valid','A delayed provider authorization timestamp is not treated as proved purchase occurrence time');

create temp table lookup_claim as
select (public.service_begin_refund_nayax_lookup('fc150000-0000-4000-8000-000000000001',2,'manual',
  'fc110000-0000-4000-8000-000000000001')->>'lookupGeneration')::bigint generation;

update public.refund_cases set decision='approved',status='approved',
  decision_reason='Ordinary manager approval',decided_by='fc110000-0000-4000-8000-000000000001',
  decided_at=statement_timestamp()
where id='fc150000-0000-4000-8000-000000000001';

select lives_ok($$insert into public.refund_nayax_lookup_candidates(token,refund_case_id,lookup_generation,
  actor_user_id,reporting_machine_id,provider_transaction_id,site_id,machine_authorization_time,amount_cents,
  card_last4,currency_code,evidence_summary,expires_at)
select 'fc160000-0000-4000-8000-000000000001','fc150000-0000-4000-8000-000000000001',generation,
  'fc110000-0000-4000-8000-000000000001','fc140000-0000-4000-8000-000000000001',
  'CONTACTLESS-REVIEW-SALE',101,'2026-08-22T20:15:00Z',2590,'3760','USD',
  jsonb_set(pg_temp.contactless_evidence(amount_delta => 1500, provider_amount => 2590),'{is_recommended}','false'::jsonb),
  statement_timestamp()+interval '1 hour' from lookup_claim$$,
  'Current contactless review evidence persists through the authoritative trigger');

select lives_ok($$insert into public.refund_nayax_lookup_candidates(token,refund_case_id,lookup_generation,
  actor_user_id,reporting_machine_id,provider_transaction_id,site_id,machine_authorization_time,amount_cents,
  card_last4,currency_code,evidence_summary,expires_at)
select 'fc160000-0000-4000-8000-000000000002','fc150000-0000-4000-8000-000000000001',generation,
  'fc110000-0000-4000-8000-000000000001','fc140000-0000-4000-8000-000000000001',
  'CONTACTLESS-REVIEW-SALE-2',101,'2026-08-22T20:15:00Z',2590,'3760','USD',
  jsonb_set(pg_temp.contactless_evidence(amount_delta => 1500, provider_amount => 2590),'{is_recommended}','false'::jsonb),
  statement_timestamp()+interval '1 hour' from lookup_claim$$,
  'A second reviewable transaction persists but prevents unique binding');

select is((public.service_commit_refund_nayax_lookup('fc150000-0000-4000-8000-000000000001',
  (select generation from lookup_claim),2,'manual_exception','manual_exception','2026-09-05.v11',
  statement_timestamp(),'Two contactless transactions need manager review',null,2,'manual',
  'fc110000-0000-4000-8000-000000000001')->>'applied'),'true',
  'Contactless review result commits through the generation guard');

set local role service_role;
select throws_ok($$select public.service_select_refund_nayax_candidate_as_actor(
  'fc110000-0000-4000-8000-000000000001','fc150000-0000-4000-8000-000000000001',
  (select official_action_version from public.refund_cases where id='fc150000-0000-4000-8000-000000000001'),
  'fc160000-0000-4000-8000-000000000001',null)$$,
  'P4604','Choose why this alternate Nayax transaction is the correct one',
  'Two close reviewable transactions cannot bind without an explicit manager reason');
reset role;

set local role service_role;
select is((public.service_select_refund_nayax_candidate_as_actor(
  'fc110000-0000-4000-8000-000000000001','fc150000-0000-4000-8000-000000000001',
  (select official_action_version from public.refund_cases where id='fc150000-0000-4000-8000-000000000001'),
  'fc160000-0000-4000-8000-000000000001','customer_confirmation')->>'selectionApplied'),
  'true','Manager can explicitly bind one of two close reviewable transactions with a reason');
reset role;

select ok((select matched_nayax_transaction_id='CONTACTLESS-REVIEW-SALE'
    and matched_nayax_machine_auth_time='2026-08-22T20:15:00Z'
    and decision='approved'
    and refund_amount_cents=2590
    and matched_nayax_amount_cents=2590
    and nayax_recommendation_state='manager_confirmed'
  from public.refund_cases where id='fc150000-0000-4000-8000-000000000001'),
  'Selection preserves ordinary approval and binds its full amount to the unique provider transaction');
select is((select count(*)::integer from public.refund_case_nayax_refund_attempts
  where refund_case_id='fc150000-0000-4000-8000-000000000001'),0,
  'Manual transaction selection creates no payment attempt');
select is((select count(*)::integer from public.refund_authoritative_receipts
  where refund_case_id='fc150000-0000-4000-8000-000000000001'),0,
  'Manual transaction selection creates no refund receipt');
select is((select metadata -> 'corroboration_codes' from public.refund_case_events
  where refund_case_id='fc150000-0000-4000-8000-000000000001'
    and event_type='nayax_identifier_evidence_selected' order by created_at desc limit 1),
  '["machine_exact","provider_sale_approved","customer_physical_contactless_fact"]'::jsonb,
  'Selection event records only corroboration that the candidate actually established');
select is((select metadata ->> 'amount_delta_cents' from public.refund_case_events
  where refund_case_id='fc150000-0000-4000-8000-000000000001'
    and event_type='nayax_identifier_evidence_selected' order by created_at desc limit 1),
  '1500','Selection event records the exact customer/provider amount difference');
select ok((select (metadata ->> 'one_click_eligible')::boolean = false
    and (metadata ->> 'execution_eligible_after_manager_selection')::boolean = true
  from public.refund_case_events
  where refund_case_id='fc150000-0000-4000-8000-000000000001'
    and event_type='nayax_identifier_evidence_selected' order by created_at desc limit 1),
  'Contactless event distinguishes one-click ineligibility from manager-selected execution eligibility');
select is((select metadata -> 'uncertainty_codes' from public.refund_case_events
  where refund_case_id='fc150000-0000-4000-8000-000000000001'
    and event_type='nayax_identifier_evidence_selected' order by created_at desc limit 1),
  '["customer_request_time_unknown","transaction_occurrence_time_uncertain","card_last4_mismatch_reviewable","customer_amount_variance"]'::jsonb,
  'Selection event preserves the actual unknown timing and identifier uncertainty');
select is((select metadata ->> 'customer_payment_interaction' from public.refund_case_events
  where refund_case_id='fc150000-0000-4000-8000-000000000001'
    and event_type='nayax_identifier_evidence_selected' order by created_at desc limit 1),
  'tap_card','Selection event preserves the settled customer tap fact');
select matches((select message from public.refund_case_events
  where refund_case_id='fc150000-0000-4000-8000-000000000001'
    and event_type='nayax_identifier_evidence_selected' order by created_at desc limit 1),
  'full selected provider amount.*Provider identifier scope and purchase timing remain unproved',
  'Manager event copy names the unresolved identifier and timing evidence');

update public.refund_cases set payment_interaction='swipe_card'
where id='fc150000-0000-4000-8000-000000000001';
select is(public.refund_nayax_candidate_identifier_evidence_state(
  'fc150000-0000-4000-8000-000000000001','fc140000-0000-4000-8000-000000000001',101,
  '2026-08-22T20:15:00Z',1090,'3760','USD',
  pg_temp.contactless_evidence(false,'needs_corroboration','mismatch_negative_unproven_equivalence',
    false,'[]'::jsonb,'["incident_time_source","nearby_attempt_count"]'::jsonb)
), 'valid','Same-interface suffix mismatch remains nonselectable without corroboration');
select is(public.refund_nayax_candidate_identifier_evidence_state(
  'fc150000-0000-4000-8000-000000000001','fc140000-0000-4000-8000-000000000001',101,
  '2026-08-22T20:15:00Z',1090,'3760','USD',
  pg_temp.contactless_evidence(true,'reviewable_uncertainty','mismatch_negative_unproven_equivalence')
), 'invalid','Same-interface mismatch cannot use the contactless exception');

update public.refund_cases set payment_interaction='tap_card'
where id='fc150000-0000-4000-8000-000000000001';
select is(public.refund_nayax_candidate_identifier_evidence_state(
  'fc150000-0000-4000-8000-000000000001','fc140000-0000-4000-8000-000000000001',101,
  '2026-08-22T20:15:00Z',1090,'3760','USD',
  pg_temp.contactless_evidence(true,'blocked_safety','mismatch_neutral_unproven_scope',
    true,'["duplicate_transaction"]'::jsonb)
), 'invalid','Duplicate transaction remains a hard stop even for physical contactless review');
select is(public.refund_nayax_candidate_identifier_evidence_state(
  'fc150000-0000-4000-8000-000000000001','fc140000-0000-4000-8000-000000000001',101,
  '2026-08-22T20:15:00Z',1090,'3760','USD',
  pg_temp.contactless_evidence(true,'reviewable_uncertainty','mismatch_neutral_unproven_scope',
    false,'[]'::jsonb,'[]'::jsonb,'OTHER-MACHINE')
), 'invalid','Wrong provider machine remains a hard stop');

select * from finish();
rollback;
