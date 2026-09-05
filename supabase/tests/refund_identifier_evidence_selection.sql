begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(15);

create function pg_temp.identifier_evidence(
  semantic text default 'contactless_chip_application_pan_unproven',
  comparison text default 'negative',
  selection_allowed boolean default true,
  core_eligible boolean default true,
  corroborators jsonb default '["card_network_match"]'::jsonb,
  hard_exclusions jsonb default '[]'::jsonb,
  one_click boolean default false,
  fact_version bigint default 1
) returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'policy_version','2026-09-05.v9',
    'identifier_policy_version','2026-09-05.identifier.v1',
    'deterministic_fact_version',fact_version,
    'customer_payment_interaction','tap_card',
    'customer_card_last4_source','physical_card',
    'customer_card_last4_provenance','physical_card',
    'customer_wallet_device_kind',null,
    'customer_nearby_attempt_count','one',
    'customer_credential_class','physical_contactless_chip',
    'provider_identifier_semantics',semantic,
    'provider_token_field_present',semantic='provider_token_unproven',
    'identifier_comparison_class',comparison,
    'same_identifier_invariant',false,
    'hard_exclusions',hard_exclusions,
    'manager_corroboration_codes',corroborators,
    'selection_allowed',selection_allowed,
    'selection_block_reason',case when selection_allowed then null else
      case when jsonb_array_length(hard_exclusions)>0 then 'hard_safety_stop'
        when not core_eligible then 'exact_core_evidence_required'
        else 'independent_corroboration_required' end end,
    'manager_review_core_eligible',core_eligible,
    'one_click_eligible',one_click,
    'is_recommended',true,
    'recommendation_state',case when one_click then 'high_confidence' else 'manual_exception' end,
    'confidence_class',case when one_click then 'strong_card' else 'ambiguous_manual' end,
    'recommendation_rank',1,
    'reason_codes',jsonb_build_array(case when comparison='match' then 'card_last4_match' else 'card_last4_mismatch_negative' end),
    'lookup_account_scope','IDENTIFIER_ACCOUNT',
    'lookup_provider_machine_id','IDENTIFIER-MACHINE',
    'provider_machine_id','IDENTIFIER-MACHINE',
    'machine_authorization_time_raw','2026-09-05T10:00:00-07:00',
    'machine_authorization_time_source','MachineAuthorizationTime',
    'machine_time_resolution','exact',
    'provider_time_resolution','exact',
    'provider_time_source','authorization_gmt',
    'authorized_at','2026-09-05T17:00:00Z',
    'customer_request_received_at','2026-09-05T18:00:00Z',
    'customer_request_received_source','hosted_refund_intake',
    'request_time_boundary','before_or_at_request',
    'transaction_occurrence_comparable',true,
    'match_factors','[]'::jsonb,
    'manual_review_reasons','[]'::jsonb,
    'match_reason','Synthetic evidence',
    'ranking_points',99
  );
$$;

select is(public.refund_nayax_identifier_evidence_state(
  1,'tap_card','physical_card','physical_card',null,'one',pg_temp.identifier_evidence()
),'valid','Unproved contactless suffix mismatch remains valid with independent network corroboration');

select results_eq(
  $$select public.refund_nayax_identifier_evidence_state(
      1,'tap_card','physical_card','physical_card',null,'one',
      pg_temp.identifier_evidence(semantic,case when semantic='provider_identifier_unknown' then 'internal_review' else 'negative' end)
    )
    from unnest(array[
      'swipe_pan_unproven','chip_application_pan_unproven',
      'contactless_chip_application_pan_unproven','wallet_device_token_unproven',
      'provider_token_unproven','contactless_identifier_unknown','provider_identifier_unknown'
    ]) semantic order by semantic$$,
  $$values ('valid'::text),('valid'::text),('valid'::text),('valid'::text),('valid'::text),('valid'::text),('valid'::text)$$,
  'Every current provider identifier semantic has an explicit valid review classification'
);

select is(public.refund_nayax_identifier_evidence_state(
  2,'tap_card','physical_card','physical_card',null,'one',pg_temp.identifier_evidence()
),'invalid','Fact-version drift invalidates the candidate');

select is(public.refund_nayax_identifier_evidence_state(
  1,'tap_card','physical_card','physical_card',null,'one',
  pg_temp.identifier_evidence(hard_exclusions=>'["card_last4_mismatch"]'::jsonb)
),'invalid','Unproved suffix mismatch cannot be smuggled back as a hard exclusion');

select is(public.refund_nayax_identifier_evidence_state(
  1,'tap_card','physical_card','physical_card',null,'one',
  pg_temp.identifier_evidence(corroborators=>'[]'::jsonb)
),'invalid','Manager selection cannot rely on exact machine, amount, and nearby time alone');

select is(public.refund_nayax_identifier_evidence_state(
  1,'tap_card','physical_card','physical_card',null,'one',
  pg_temp.identifier_evidence(selection_allowed=>false,corroborators=>'[]'::jsonb)
),'valid','Insufficient corroboration remains visible as a non-selectable review candidate');

select is(public.refund_nayax_identifier_evidence_state(
  1,'tap_card','physical_card','physical_card',null,'one',
  pg_temp.identifier_evidence(one_click=>true)
),'invalid','A mismatch can never become one-click eligible');

select is(public.refund_nayax_identifier_evidence_state(
  1,'insert_card','physical_card','physical_card',null,'one',
  pg_temp.identifier_evidence('chip_application_pan_unproven','match',true,true,'["card_last4_match"]', '[]',true)
    || jsonb_build_object('customer_payment_interaction','insert_card','customer_credential_class','physical_contact_chip')
),'valid','Exact suffix plus strict chip evidence may retain the narrower one-click path');

insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data)
values('fe110000-0000-4000-8000-000000000001','authenticated','authenticated','identifier-manager@example.invalid','{}','{}');
insert into public.customer_accounts(id,name,account_type)
values('fe120000-0000-4000-8000-000000000001','Identifier fixture','internal');
insert into public.reporting_locations(id,account_id,name,timezone)
values('fe130000-0000-4000-8000-000000000001','fe120000-0000-4000-8000-000000000001','Identifier fixture','America/Los_Angeles');
insert into public.reporting_machines(id,account_id,location_id,machine_label,status,nayax_machine_id,nayax_account_key,nayax_refunds_enabled)
values('fe140000-0000-4000-8000-000000000001','fe120000-0000-4000-8000-000000000001',
 'fe130000-0000-4000-8000-000000000001','Identifier machine','active','IDENTIFIER-MACHINE','IDENTIFIER_ACCOUNT',true);
insert into public.reporting_machine_refund_managers(reporting_machine_id,manager_user_id,manager_email,grant_reason)
values('fe140000-0000-4000-8000-000000000001','fe110000-0000-4000-8000-000000000001','identifier-manager@example.invalid','Fixture');
insert into public.refund_nayax_machine_inventory(account_key,nayax_machine_id,reporting_machine_id)
values('IDENTIFIER_ACCOUNT','IDENTIFIER-MACHINE','fe140000-0000-4000-8000-000000000001');
insert into public.refund_cases(
 id,public_reference,reporting_machine_id,reporting_location_id,customer_email,issue_summary,
 incident_at,incident_timezone,payment_method,payment_amount_cents,refund_amount_cents,card_last4,
 card_last4_provenance,card_last4_source,card_network,card_wallet_used,payment_interaction,
 wallet_device_kind,nearby_attempt_count,status,correlation_status,deterministic_fact_version,
 intake_source,intake_meta,customer_request_received_at,customer_request_received_source
) values (
 'fe150000-0000-4000-8000-000000000001','RF-IDENTIFIER-1','fe140000-0000-4000-8000-000000000001',
 'fe130000-0000-4000-8000-000000000001','identifier-customer@example.invalid','Identifier evidence fixture',
 '2026-09-05T16:45:00Z','America/Los_Angeles','card',700,700,'4242',
 'physical_card','physical_card','visa',false,'tap_card',null,'one','needs_review','needs_nayax',1,
 'form','{}','2026-09-05T18:00:00Z','hosted_refund_intake'
);

create temp table identifier_claim as
select (public.service_begin_refund_nayax_lookup(
 'fe150000-0000-4000-8000-000000000001',1,'manual','fe110000-0000-4000-8000-000000000001'
)->>'lookupGeneration')::bigint generation;

insert into public.refund_nayax_lookup_candidates(
 token,refund_case_id,lookup_generation,actor_user_id,reporting_machine_id,provider_transaction_id,
 site_id,machine_authorization_time,amount_cents,card_last4,currency_code,evidence_summary,expires_at
)
select 'fe160000-0000-4000-8000-000000000001','fe150000-0000-4000-8000-000000000001',generation,
 'fe110000-0000-4000-8000-000000000001','fe140000-0000-4000-8000-000000000001','IDENTIFIER-EXACT-1',
 7,'2026-09-05T17:00:00Z',700,'9999','USD',pg_temp.identifier_evidence(),statement_timestamp()+interval '1 hour'
from identifier_claim;

select throws_ok($$insert into public.refund_nayax_lookup_candidates(
 token,refund_case_id,lookup_generation,actor_user_id,reporting_machine_id,provider_transaction_id,
 site_id,machine_authorization_time,amount_cents,card_last4,currency_code,evidence_summary,expires_at)
select 'fe160000-0000-4000-8000-000000000002','fe150000-0000-4000-8000-000000000001',generation,
 'fe110000-0000-4000-8000-000000000001','fe140000-0000-4000-8000-000000000001','IDENTIFIER-STALE-2',
 7,'2026-09-05T17:00:00Z',700,'9999','USD',
 pg_temp.identifier_evidence() || jsonb_build_object('customer_payment_interaction','swipe_card'),
 statement_timestamp()+interval '1 hour' from identifier_claim$$,
 'P4626','Invalid or stale Nayax identifier evidence','Candidate insert rechecks current customer interaction');

select is((public.service_commit_refund_nayax_lookup(
 'fe150000-0000-4000-8000-000000000001',(select generation from identifier_claim),1,
 'manual_exception','manual_exception','2026-09-05.v9',statement_timestamp(),
 'One reviewable exact transaction',null,1,'manual','fe110000-0000-4000-8000-000000000001'
)->>'applied'),'true','Current identifier evidence commits through the generation guard');

set local role service_role;
select is((public.service_select_refund_nayax_candidate_as_actor(
 'fe110000-0000-4000-8000-000000000001','fe150000-0000-4000-8000-000000000001',
 (select official_action_version from public.refund_cases where id='fe150000-0000-4000-8000-000000000001'),
 'fe160000-0000-4000-8000-000000000001',null
)->>'selectionApplied'),'true','Manager can select the exact corroborated transaction despite unproved suffix mismatch');
reset role;

select ok((select matched_nayax_transaction_id='IDENTIFIER-EXACT-1' and not nayax_match_execution_eligible
 from public.refund_cases where id='fe150000-0000-4000-8000-000000000001'),
 'Selection binds the exact transaction while one-click execution remains closed');

select ok((select metadata @> jsonb_build_object(
 'policy_version','2026-09-05.v9','identifier_policy_version','2026-09-05.identifier.v1',
 'deterministic_fact_version',1,'exact_provider_transaction_bound',true,'payload_redacted',true)
 from public.refund_case_events where refund_case_id='fe150000-0000-4000-8000-000000000001'
 and event_type='nayax_identifier_evidence_selected'),
 'Selection records policy, fact version, evidence classification, and exact-transaction binding');

select is((select count(*)::integer from public.refund_case_nayax_refund_attempts
 where refund_case_id='fe150000-0000-4000-8000-000000000001'),0,
 'Evidence-aware selection creates no payment attempt');
select is((select count(*)::integer from public.refund_case_messages
 where refund_case_id='fe150000-0000-4000-8000-000000000001'),0,
 'Evidence-aware selection sends no customer message');

select * from finish();
rollback;
