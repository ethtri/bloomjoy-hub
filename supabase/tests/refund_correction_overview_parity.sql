begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(12);

create function pg_temp.set_auth_claims(p_user_id uuid)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p_user_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', p_user_id, 'role', 'authenticated', 'is_anonymous', false
  )::text, true);
end;
$$;

insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data)
values('d9100000-0000-4000-8000-000000000001','authenticated','authenticated',
  'overview-parity-manager@example.invalid','{}','{}');
insert into public.customer_accounts(id,name,account_type)
values('d9110000-0000-4000-8000-000000000001','Overview parity fixture','internal');
insert into public.reporting_locations(id,account_id,name,timezone)
values('d9120000-0000-4000-8000-000000000001','d9110000-0000-4000-8000-000000000001',
  'Overview parity location','America/Los_Angeles');
insert into public.reporting_machines(id,account_id,location_id,machine_label,status,
  nayax_machine_id,nayax_account_key,nayax_refunds_enabled)
values('d9130000-0000-4000-8000-000000000001','d9110000-0000-4000-8000-000000000001',
  'd9120000-0000-4000-8000-000000000001','Overview parity machine','active',
  'OVERVIEW-PARITY-MACHINE','OVERVIEW_PARITY_ACCOUNT',true);
insert into public.admin_roles(user_id,role,active)
values('d9100000-0000-4000-8000-000000000001','super_admin',true);
insert into public.reporting_machine_refund_managers(
  reporting_machine_id,manager_user_id,manager_email,grant_reason
) values('d9130000-0000-4000-8000-000000000001','d9100000-0000-4000-8000-000000000001',
  'overview-parity-manager@example.invalid','Overview parity fixture');
insert into public.refund_nayax_machine_inventory(account_key,nayax_machine_id,reporting_machine_id)
values('OVERVIEW_PARITY_ACCOUNT','OVERVIEW-PARITY-MACHINE',
  'd9130000-0000-4000-8000-000000000001');
update public.refund_customer_contact_settings
set automatic_customer_contact_enabled=true,correction_links_enabled=true
where singleton;

insert into public.refund_cases(id,public_reference,reporting_machine_id,reporting_location_id,
  customer_email,issue_summary,incident_at,incident_local_datetime,incident_timezone,
  incident_time_resolution,incident_time_confidence,incident_time_source,payment_method,
  payment_amount_cents,refund_amount_cents,card_last4,card_last4_provenance,card_last4_source,
  card_network,card_wallet_used,payment_interaction,wallet_provider,wallet_device_kind,
  nearby_attempt_count,status,correlation_status,deterministic_fact_version,intake_source,
  intake_meta,customer_request_received_at,customer_request_received_source)
values
('d9140000-0000-4000-8000-000000000001','RF-OVERVIEW-PARITY',
  'd9130000-0000-4000-8000-000000000001','d9120000-0000-4000-8000-000000000001',
  'overview-parity-customer@example.invalid','Current helper must own the manager field list',
  '2026-09-05T21:00:00Z','2026-09-05T14:00','America/Los_Angeles','exact','rough',null,
  'card',1060,1060,'1003','wallet_device_token',null,null,true,
  'phone_watch_wallet','apple_pay','phone',null,'needs_review','needs_nayax',2,'form','{}',
  '2026-09-05T22:00:00Z','hosted_refund_intake'),
('d9140000-0000-4000-8000-000000000002','RF-OVERVIEW-INTERNAL',
  'd9130000-0000-4000-8000-000000000001','d9120000-0000-4000-8000-000000000001',
  'overview-internal@example.invalid','Internal test projection parity',
  '2026-09-05T20:00:00Z','2026-09-05T13:00','America/Los_Angeles','exact','exact','memory',
  'card',700,700,'4242','physical_card','physical_card','visa',false,
  'tap_card',null,null,'one','needs_review','needs_nayax',1,'form','{}',
  '2026-09-05T21:00:00Z','hosted_refund_intake');

create function pg_temp.current_overview_evidence(
  authorized_at timestamptz,
  is_top boolean,
  candidate_rank integer
) returns jsonb language sql stable as $$
  select jsonb_build_object(
    'selection_allowed',false,'is_recommended',false,'one_click_eligible',false,
    'recommendation_state','ambiguous','confidence_class','ambiguous_manual',
    'policy_version','2026-09-05.v11',
    'identifier_policy_version','2026-09-05.identifier.v2',
    'customer_fact_version',c.deterministic_fact_version,
    'customer_credential_class','customer_phone_wallet_token',
    'provider_identifier_class','last_sales_contactless_identifier_unverified',
    'card_last4_comparison','exact_support','card_network_comparison','missing',
    'payment_interaction_comparison','supporting','same_identifier_equivalence_proven',false,
    'identifier_review_state','exact_support','customer_correction_fields','[]'::jsonb,
    'hard_exclusions','[]'::jsonb,
    'manual_review_reasons','["transaction_occurrence_time_uncertain","wallet_payment"]'::jsonb,
    'reason_codes','["machine_exact","amount_exact","customer_time_rough","transaction_occurrence_time_uncertain","customer_card_network_unknown","wallet_payment"]'::jsonb,
    'match_factors','[]'::jsonb,'match_reason','Current facts can distinguish nearby purchases',
    'recommendation_rank',candidate_rank,'is_top_ranked',is_top,
    'lookup_account_scope','OVERVIEW_PARITY_ACCOUNT',
    'lookup_provider_machine_id','OVERVIEW-PARITY-MACHINE',
    'provider_machine_id','OVERVIEW-PARITY-MACHINE',
    'machine_authorization_time_raw',
      to_char(authorized_at at time zone 'America/Los_Angeles','YYYY-MM-DD"T"HH24:MI:SS.MS'),
    'machine_authorization_time_source','MachineAuthorizationTime',
    'machine_authorization_at',authorized_at,
    'machine_time_resolution','exact','provider_time_resolution','exact',
    'provider_time_source','authorization_gmt','authorized_at',authorized_at,
    'customer_request_received_at',c.customer_request_received_at,
    'customer_request_received_source',c.customer_request_received_source,
    'request_time_boundary','occurrence_time_uncertain',
    'transaction_occurrence_comparable',false,
    'transaction_occurrence_semantics','unknown',
    'transaction_occurrence_proof_source','null'::jsonb,
    'transaction_occurrence_timestamp_source','null'::jsonb,
    'transaction_occurrence_timezone_basis','null'::jsonb,
    'transaction_occurrence_lower_bound_at','null'::jsonb,
    'transaction_occurrence_upper_bound_at','null'::jsonb,
    'request_receipt_lower_bound_at','null'::jsonb,
    'request_receipt_upper_bound_at','null'::jsonb,
    'payment_status','approved','payment_status_evidence','last_sales_contract',
    'provider_refund_state','clear','duplicate_provider_record',false,
    'amount_delta_cents',0,'time_delta_minutes',null,
    'provider_processing_time_delta_minutes',
      ceil(abs(extract(epoch from (authorized_at-c.incident_at)))/60.0)::integer
  )
  from public.refund_cases c
  where c.id='d9140000-0000-4000-8000-000000000001';
$$;

create temp table overview_claim as
select (public.service_begin_refund_nayax_lookup(
  'd9140000-0000-4000-8000-000000000001',2,'manual',
  'd9100000-0000-4000-8000-000000000001'
)->>'lookupGeneration')::bigint generation;

insert into public.refund_nayax_lookup_candidates(token,refund_case_id,lookup_generation,
  actor_user_id,reporting_machine_id,provider_transaction_id,site_id,machine_authorization_time,
  amount_cents,card_last4,currency_code,evidence_summary,expires_at)
select gen_random_uuid(),'d9140000-0000-4000-8000-000000000001',claim.generation,
  'd9100000-0000-4000-8000-000000000001','d9130000-0000-4000-8000-000000000001',
  'OVERVIEW-PARITY-TX-' || series.value,100+series.value,
  '2026-09-05T21:15:00Z'::timestamptz+(series.value-1)*interval '1 minute',
  1060,'1003','USD',
  pg_temp.current_overview_evidence(
    '2026-09-05T21:15:00Z'::timestamptz+(series.value-1)*interval '1 minute',
    series.value=1,series.value),
  statement_timestamp()+interval '1 hour'
from overview_claim claim
cross join generate_series(1,10) series(value);

select is((public.service_commit_refund_nayax_lookup(
  'd9140000-0000-4000-8000-000000000001',(select generation from overview_claim),2,
  'manual_exception','manual_exception','2026-09-05.v11',statement_timestamp(),
  'Ten current candidates need structured customer facts',null,10,'manual',
  'd9100000-0000-4000-8000-000000000001'
)->>'applied'),'true','The current production-shaped lookup commits normally');

set local role authenticated;
select pg_temp.set_auth_claims('d9100000-0000-4000-8000-000000000001');
select is((public.admin_classify_refund_case_internal_test(
  'd9140000-0000-4000-8000-000000000002',1,'employee_technician_test'
)->>'classified')::boolean,true,'The fixture has one separately projected Internal/test case');
reset role;

select is(public.refund_purchase_correction_request_fields(
  'd9140000-0000-4000-8000-000000000001'),
  array['incident_time','incident_time_source','card_network','nearby_attempt_count']::text[],
  'The current helper derives the useful production correction scope');

create temp table case_rows_before as
select id,to_jsonb(c) value from public.refund_cases c
where id in('d9140000-0000-4000-8000-000000000001','d9140000-0000-4000-8000-000000000002');
create temp table candidate_rows_before as
select token,to_jsonb(candidate) value from public.refund_nayax_lookup_candidates candidate
where refund_case_id='d9140000-0000-4000-8000-000000000001';
create temp table side_effects_before as select jsonb_build_object(
  'messages',(select count(*) from public.refund_case_messages where refund_case_id in(
    'd9140000-0000-4000-8000-000000000001','d9140000-0000-4000-8000-000000000002')),
  'attempts',(select count(*) from public.refund_case_nayax_refund_attempts where refund_case_id in(
    'd9140000-0000-4000-8000-000000000001','d9140000-0000-4000-8000-000000000002')),
  'authorizations',(select count(*) from public.refund_case_official_action_authorizations where refund_case_id in(
    'd9140000-0000-4000-8000-000000000001','d9140000-0000-4000-8000-000000000002')),
  'events',(select count(*) from public.refund_case_events where refund_case_id in(
    'd9140000-0000-4000-8000-000000000001','d9140000-0000-4000-8000-000000000002'))
) value;

set local role authenticated;
select pg_temp.set_auth_claims('d9100000-0000-4000-8000-000000000001');
create temp table predecessor_overview as
select public.admin_get_refund_operations_overview_pre_correction_scope_parity_v1() value;
create temp table current_overview as
select public.admin_get_refund_operations_overview() value;
reset role;

select ok(
  position('refund_purchase_correction_request_fields' in pg_get_functiondef(
    'public.admin_get_refund_operations_overview()'::regprocedure))>0
  and position('internalTestCases' in pg_get_functiondef(
    'public.admin_get_refund_operations_overview()'::regprocedure))>0,
  'The outermost overview explicitly binds both case arrays to the current helper');

select is((select item->'customerCorrectionFields'
  from current_overview, lateral jsonb_array_elements(value->'cases') item
  where item->>'id'='d9140000-0000-4000-8000-000000000001'),
  to_jsonb(public.refund_purchase_correction_request_fields(
    'd9140000-0000-4000-8000-000000000001')),
  'The ordinary manager case exposes the direct current-helper result');

select is((select item->'customerCorrectionFields'
  from current_overview, lateral jsonb_array_elements(value->'internalTestCases') item
  where item->>'id'='d9140000-0000-4000-8000-000000000002'),
  to_jsonb(public.refund_purchase_correction_request_fields(
    'd9140000-0000-4000-8000-000000000002')),
  'The Internal/test case also exposes the direct current-helper result');

select is((select value-'cases'-'internalTestCases' from current_overview),
  (select value-'cases'-'internalTestCases' from predecessor_overview),
  'The outer wrapper preserves every top-level overview value');

select is((select jsonb_agg(item-'customerCorrectionFields' order by ordinality)
  from current_overview, lateral jsonb_array_elements(value->'cases') with ordinality entries(item,ordinality)),
  (select jsonb_agg(item-'customerCorrectionFields' order by ordinality)
  from predecessor_overview, lateral jsonb_array_elements(value->'cases') with ordinality entries(item,ordinality)),
  'Ordinary case order and every non-correction field remain unchanged');

select is((select jsonb_agg(item-'customerCorrectionFields' order by ordinality)
  from current_overview, lateral jsonb_array_elements(value->'internalTestCases') with ordinality entries(item,ordinality)),
  (select jsonb_agg(item-'customerCorrectionFields' order by ordinality)
  from predecessor_overview, lateral jsonb_array_elements(value->'internalTestCases') with ordinality entries(item,ordinality)),
  'Internal/test order and every non-correction field remain unchanged');

select ok(not exists(select 1 from case_rows_before before
  join public.refund_cases current using(id)
  where before.value is distinct from to_jsonb(current)),
  'Overview reads do not select, decide, approve, or otherwise mutate either case');

select ok(not exists(select 1 from candidate_rows_before before
  join public.refund_nayax_lookup_candidates current using(token)
  where before.value is distinct from to_jsonb(current)),
  'Overview reads preserve exact transaction candidates and evidence');

select is(jsonb_build_object(
  'messages',(select count(*) from public.refund_case_messages where refund_case_id in(
    'd9140000-0000-4000-8000-000000000001','d9140000-0000-4000-8000-000000000002')),
  'attempts',(select count(*) from public.refund_case_nayax_refund_attempts where refund_case_id in(
    'd9140000-0000-4000-8000-000000000001','d9140000-0000-4000-8000-000000000002')),
  'authorizations',(select count(*) from public.refund_case_official_action_authorizations where refund_case_id in(
    'd9140000-0000-4000-8000-000000000001','d9140000-0000-4000-8000-000000000002')),
  'events',(select count(*) from public.refund_case_events where refund_case_id in(
    'd9140000-0000-4000-8000-000000000001','d9140000-0000-4000-8000-000000000002'))
), (select value from side_effects_before),
  'Overview reads create no customer contact, authorization, payment attempt, or event');

select * from finish();
rollback;
