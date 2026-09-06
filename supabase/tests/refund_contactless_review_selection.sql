begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(28);
set local timezone = 'UTC';

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
  2,'form','{}','2026-08-23T20:00:00Z','hosted_refund_intake');

create function pg_temp.contactless_evidence(
  selection_allowed boolean default true,
  review_state text default 'reviewable_uncertainty',
  last4_comparison text default 'mismatch_neutral_unproven_scope',
  duplicate_record boolean default false,
  hard_exclusions jsonb default '[]'::jsonb,
  correction_fields jsonb default '[]'::jsonb,
  provider_machine_id text default 'CONTACTLESS-REVIEW-MACHINE',
  candidate_amount_cents integer default 1090,
  authorization_time text default '2026-08-22T20:15:00Z',
  occurrence_comparable boolean default true,
  interaction_comparison text default 'supporting',
  evidence_reason_codes jsonb default null
) returns jsonb language sql stable as $$
  select jsonb_build_object(
    'selection_allowed',selection_allowed,'is_recommended',true,'one_click_eligible',false,
    'recommendation_state','manual_exception','confidence_class','evidence_aware_review',
    'policy_version','2026-09-05.v11','identifier_policy_version','2026-09-05.identifier.v2',
    'customer_fact_version',c.deterministic_fact_version,
    'customer_credential_class',case when c.payment_interaction='swipe_card'
      then 'customer_physical_swipe_pan' else 'customer_physical_contactless_pan' end,
    'provider_identifier_class',case when interaction_comparison='conflict_unverified_provider_semantics'
      then 'last_sales_swipe_identifier_unverified'
      when c.payment_interaction='swipe_card' then 'last_sales_swipe_identifier_unverified'
      else 'last_sales_contactless_identifier_unverified' end,
    'card_last4_comparison',last4_comparison,'card_network_comparison','missing',
    'payment_interaction_comparison',interaction_comparison,
    'recognition_method',case when interaction_comparison='conflict_unverified_provider_semantics'
      then 'swipe' when c.payment_interaction='swipe_card' then 'swipe' else 'contactless' end,
    'same_identifier_equivalence_proven',false,'identifier_review_state',review_state,
    'customer_correction_fields',correction_fields,'hard_exclusions',hard_exclusions,
    'manual_review_reasons','["card_last4_mismatch_reviewable"]'::jsonb,
    'reason_codes',coalesce(evidence_reason_codes,
      jsonb_build_array('machine_exact','card_last4_mismatch_neutral_unproven_scope')
      || case when candidate_amount_cents=1090 then jsonb_build_array('amount_exact')
        else jsonb_build_array('amount_within_tolerance') end
      || case when occurrence_comparable then jsonb_build_array('incident_time_within_60m')
        else jsonb_build_array('transaction_occurrence_time_uncertain') end
      || case when interaction_comparison='supporting' then jsonb_build_array('payment_interaction_supporting')
        else jsonb_build_array('payment_interaction_conflict_unverified_provider_semantics') end
      || case when selection_allowed and review_state='reviewable_uncertainty'
        and c.payment_interaction='tap_card'
        and last4_comparison='mismatch_neutral_unproven_scope'
        and not duplicate_record and hard_exclusions='[]'::jsonb
        and provider_machine_id='CONTACTLESS-REVIEW-MACHINE'
        and candidate_amount_cents=1090 and occurrence_comparable
        and ceil(abs(extract(epoch from
          (authorization_time::timestamptz-c.incident_at)))/60.0)::integer <= 60
        and interaction_comparison='supporting'
        then jsonb_build_array('physical_contactless_exact_scope_review')
        else '[]'::jsonb end)
  ) || jsonb_build_object(
    'match_factors','[]'::jsonb,'match_reason','Exact machine and amount; contactless identifier needs manager review',
    'recommendation_rank',1,'is_top_ranked',true,'lookup_account_scope','CONTACTLESS_REVIEW_ACCOUNT',
    'lookup_provider_machine_id','CONTACTLESS-REVIEW-MACHINE','provider_machine_id',provider_machine_id,
    'machine_authorization_time_raw',authorization_time,
    'machine_authorization_at',authorization_time,'machine_authorization_time_source','MachineAuthorizationTime',
    'machine_time_resolution','exact','provider_time_resolution','exact','provider_time_source','authorization_gmt',
    'authorized_at',authorization_time,'customer_request_received_at',c.customer_request_received_at,
    'customer_request_received_source',c.customer_request_received_source,
    'request_time_boundary',case when occurrence_comparable then 'before_or_at_request'
      else 'occurrence_time_uncertain' end,
    'transaction_occurrence_comparable',occurrence_comparable,
    'transaction_occurrence_semantics',case when occurrence_comparable
      then 'online_purchase_occurrence' else 'unknown' end,
    'transaction_occurrence_proof_source',case when occurrence_comparable
      then 'verified_provider_purchase_occurrence_v1' else null end,
    'transaction_occurrence_timestamp_source',case when occurrence_comparable
      then 'authorization_gmt' else null end,
    'transaction_occurrence_timezone_basis',case when occurrence_comparable then 'utc' else null end,
    'transaction_occurrence_lower_bound_at',case when occurrence_comparable
      then authorization_time::timestamptz else null end,
    'transaction_occurrence_upper_bound_at',case when occurrence_comparable
      then authorization_time::timestamptz else null end,
    'request_receipt_lower_bound_at',case when occurrence_comparable
      then c.customer_request_received_at else null end,
    'request_receipt_upper_bound_at',case when occurrence_comparable
      then c.customer_request_received_at else null end,
    'amount_delta_cents',abs(candidate_amount_cents-c.payment_amount_cents),
    'time_delta_minutes',case when occurrence_comparable then ceil(abs(extract(epoch from
      (authorization_time::timestamptz-c.incident_at)))/60.0)::integer else null end,
    'provider_processing_time_delta_minutes',ceil(abs(extract(epoch from
      (authorization_time::timestamptz-c.incident_at)))/60.0)::integer,
    'payment_status','approved',
    'payment_status_evidence','last_sales_contract','provider_refund_state','clear',
    'duplicate_provider_record',duplicate_record,'card_last4','3760','currency_code','USD',
    'amount_cents',candidate_amount_cents
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
  '2026-08-22T20:15:00Z',890,'3760','USD',
  pg_temp.contactless_evidence(false,'needs_corroboration','mismatch_neutral_unproven_scope',
    false,'[]'::jsonb,'["amount"]'::jsonb,'CONTACTLESS-REVIEW-MACHINE',890)
), 'valid','A near-but-not-exact amount persists only as nonselectable review evidence');
select is(public.refund_nayax_candidate_identifier_evidence_state(
  'fc150000-0000-4000-8000-000000000001','fc140000-0000-4000-8000-000000000001',101,
  '2026-08-22T20:15:00Z',890,'3760','USD',
  pg_temp.contactless_evidence(true,'reviewable_uncertainty','mismatch_neutral_unproven_scope',
    false,'[]'::jsonb,'[]'::jsonb,'CONTACTLESS-REVIEW-MACHINE',890)
), 'invalid','A near amount cannot forge the contactless selection exception');

select is(public.refund_nayax_candidate_identifier_evidence_state(
  'fc150000-0000-4000-8000-000000000001','fc140000-0000-4000-8000-000000000001',101,
  '2026-08-22T20:15:00Z',1090,'3760','USD',
  pg_temp.contactless_evidence(false,'needs_corroboration','mismatch_neutral_unproven_scope',
    false,'[]'::jsonb,'["incident_time"]'::jsonb,'CONTACTLESS-REVIEW-MACHINE',1090,
    '2026-08-22T20:15:00Z',false)
), 'valid','Unknown purchase-occurrence time persists only as nonselectable review evidence');
select is(public.refund_nayax_candidate_identifier_evidence_state(
  'fc150000-0000-4000-8000-000000000001','fc140000-0000-4000-8000-000000000001',101,
  '2026-08-22T20:15:00Z',1090,'3760','USD',
  pg_temp.contactless_evidence(true,'reviewable_uncertainty','mismatch_neutral_unproven_scope',
    false,'[]'::jsonb,'[]'::jsonb,'CONTACTLESS-REVIEW-MACHINE',1090,
    '2026-08-22T20:15:00Z',false)
), 'invalid','Unknown purchase-occurrence time cannot fall through a broader mismatch path');

select is(public.refund_nayax_candidate_identifier_evidence_state(
  'fc150000-0000-4000-8000-000000000001','fc140000-0000-4000-8000-000000000001',101,
  '2026-08-22T22:00:00Z',1090,'3760','USD',
  pg_temp.contactless_evidence(false,'needs_corroboration','mismatch_neutral_unproven_scope',
    false,'[]'::jsonb,'["incident_time"]'::jsonb,'CONTACTLESS-REVIEW-MACHINE',1090,
    '2026-08-22T22:00:00Z')
), 'valid','A transaction two hours away persists only as nonselectable review evidence');
select is(public.refund_nayax_candidate_identifier_evidence_state(
  'fc150000-0000-4000-8000-000000000001','fc140000-0000-4000-8000-000000000001',101,
  '2026-08-22T22:00:00Z',1090,'3760','USD',
  pg_temp.contactless_evidence(true,'reviewable_uncertainty','mismatch_neutral_unproven_scope',
    false,'[]'::jsonb,'[]'::jsonb,'CONTACTLESS-REVIEW-MACHINE',1090,
    '2026-08-22T22:00:00Z')
), 'invalid','A distant time cannot forge the contactless selection exception');

select is(public.refund_nayax_candidate_identifier_evidence_state(
  'fc150000-0000-4000-8000-000000000001','fc140000-0000-4000-8000-000000000001',101,
  '2026-08-22T20:15:00Z',1090,'3760','USD',
  pg_temp.contactless_evidence(false,'needs_corroboration','mismatch_neutral_unproven_scope',
    false,'[]'::jsonb,'["payment_interaction"]'::jsonb,'CONTACTLESS-REVIEW-MACHINE',1090,
    '2026-08-22T20:15:00Z',true,'conflict_unverified_provider_semantics')
), 'valid','A customer-provider interaction conflict persists only as nonselectable review evidence');
select is(public.refund_nayax_candidate_identifier_evidence_state(
  'fc150000-0000-4000-8000-000000000001','fc140000-0000-4000-8000-000000000001',101,
  '2026-08-22T20:15:00Z',1090,'3760','USD',
  pg_temp.contactless_evidence(true,'reviewable_uncertainty','mismatch_neutral_unproven_scope',
    false,'[]'::jsonb,'[]'::jsonb,'CONTACTLESS-REVIEW-MACHINE',1090,
    '2026-08-22T20:15:00Z',true,'conflict_unverified_provider_semantics')
), 'invalid','An interaction conflict cannot fall through a broader mismatch path');

select is(public.refund_nayax_candidate_identifier_evidence_state(
  'fc150000-0000-4000-8000-000000000001','fc140000-0000-4000-8000-000000000001',101,
  '2026-08-22T20:15:00Z',890,'3760','USD',
  jsonb_set(pg_temp.contactless_evidence(false,'needs_corroboration','mismatch_neutral_unproven_scope',
    false,'[]'::jsonb,'["amount"]'::jsonb,'CONTACTLESS-REVIEW-MACHINE',890),
    '{reason_codes}',
    '["machine_exact","amount_within_tolerance","physical_contactless_exact_scope_review"]'::jsonb)
), 'invalid','The path-specific reason code cannot be attached without exact-scope evidence');

select is(public.refund_nayax_candidate_identifier_evidence_state(
  'fc150000-0000-4000-8000-000000000001','fc140000-0000-4000-8000-000000000001',101,
  '2026-08-22T20:15:00Z',1090,'3760','USD',
  jsonb_set(pg_temp.contactless_evidence(),'{is_recommended}','false'::jsonb)
), 'invalid','A non-recommended contactless candidate cannot reach the generic disagreement selector');

select is(public.refund_nayax_candidate_identifier_evidence_state(
  'fc150000-0000-4000-8000-000000000001','fc140000-0000-4000-8000-000000000001',101,
  '2026-08-22T20:15:00Z',1090,'3760','USD',
  pg_temp.contactless_evidence() || jsonb_build_object(
    'recognition_method','swipe',
    'provider_identifier_class','last_sales_swipe_identifier_unverified',
    'payment_interaction_comparison','supporting'
  )
), 'invalid','A forged supporting comparison cannot override conflicting persisted provider semantics');

create temp table lookup_claim as
select (public.service_begin_refund_nayax_lookup('fc150000-0000-4000-8000-000000000001',2,'manual',
  'fc110000-0000-4000-8000-000000000001')->>'lookupGeneration')::bigint generation;

select lives_ok($$insert into public.refund_nayax_lookup_candidates(token,refund_case_id,lookup_generation,
  actor_user_id,reporting_machine_id,provider_transaction_id,site_id,machine_authorization_time,amount_cents,
  card_last4,currency_code,evidence_summary,expires_at)
select 'fc160000-0000-4000-8000-000000000001','fc150000-0000-4000-8000-000000000001',generation,
  'fc110000-0000-4000-8000-000000000001','fc140000-0000-4000-8000-000000000001',
  'CONTACTLESS-REVIEW-SALE',101,'2026-08-22T20:15:00Z',1090,'3760','USD',
  pg_temp.contactless_evidence(),statement_timestamp()+interval '1 hour' from lookup_claim$$,
  'Current contactless review evidence persists through the authoritative trigger');

select is((public.service_commit_refund_nayax_lookup('fc150000-0000-4000-8000-000000000001',
  (select generation from lookup_claim),2,'manual_exception','manual_exception','2026-09-05.v11',
  statement_timestamp(),'One contactless transaction needs manager review',null,1,'manual',
  'fc110000-0000-4000-8000-000000000001')->>'applied'),'true',
  'Contactless review result commits through the generation guard');

set local role service_role;
select is((public.service_select_refund_nayax_candidate_as_actor(
  'fc110000-0000-4000-8000-000000000001','fc150000-0000-4000-8000-000000000001',
  (select official_action_version from public.refund_cases where id='fc150000-0000-4000-8000-000000000001'),
  'fc160000-0000-4000-8000-000000000001','customer_confirmation')->>'selectionApplied'),
  'true','Manager can bind the exact neutral contactless transaction once');
reset role;

select is((select metadata ->> 'review_path' from public.refund_case_events
  where refund_case_id='fc150000-0000-4000-8000-000000000001'
    and event_type='nayax_identifier_evidence_selected'),
  'physical_contactless_exact_scope',
  'The immutable selection event names the exact contactless review path');
select is((select metadata -> 'corroboration_codes' from public.refund_case_events
  where refund_case_id='fc150000-0000-4000-8000-000000000001'
    and event_type='nayax_identifier_evidence_selected'),
  '["machine_exact","amount_exact","approved_sale","customer_reported_time_exact","occurrence_time_comparable","occurrence_time_within_60m","payment_interaction_supporting","identifier_equivalence_unproved"]'::jsonb,
  'The immutable selection event records only established exact-path facts');
select ok((select metadata ->> 'same_identifier_equivalence_proven' = 'false'
    and metadata ->> 'one_click_eligible' = 'false'
    and metadata ->> 'execution_eligible_after_manager_selection' = 'true'
    and not (metadata -> 'corroboration_codes' ?| array[
      'customer_time_from_alert_or_receipt','customer_reports_one_nearby_attempt'
    ])
  from public.refund_case_events
  where refund_case_id='fc150000-0000-4000-8000-000000000001'
    and event_type='nayax_identifier_evidence_selected'),
  'The selection event preserves unproved equivalence and omits unsupplied customer facts');

select ok((select matched_nayax_transaction_id='CONTACTLESS-REVIEW-SALE'
    and matched_nayax_machine_auth_time='2026-08-22T20:15:00Z'
    and nayax_recommendation_state='manager_confirmed'
  from public.refund_cases where id='fc150000-0000-4000-8000-000000000001'),
  'Manager review binds the exact provider transaction without claiming identifier equivalence');
select is((select count(*)::integer from public.refund_case_nayax_refund_attempts
  where refund_case_id='fc150000-0000-4000-8000-000000000001'),0,
  'Manual transaction selection creates no payment attempt');
select is((select count(*)::integer from public.refund_authoritative_receipts
  where refund_case_id='fc150000-0000-4000-8000-000000000001'),0,
  'Manual transaction selection creates no refund receipt');

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
