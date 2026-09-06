begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(23);

insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data)
values('cf110000-0000-4000-8000-000000000001','authenticated','authenticated',
  'current-fact-manager@example.invalid','{}','{}');
insert into public.customer_accounts(id,name,account_type)
values('cf120000-0000-4000-8000-000000000001','Current correction fact fixture','internal');
insert into public.reporting_locations(id,account_id,name,timezone)
values('cf130000-0000-4000-8000-000000000001','cf120000-0000-4000-8000-000000000001',
  'Current correction location','America/Los_Angeles');
insert into public.reporting_machines(id,account_id,location_id,machine_label,status,
  nayax_machine_id,nayax_account_key,nayax_refunds_enabled)
values('cf140000-0000-4000-8000-000000000001','cf120000-0000-4000-8000-000000000001',
  'cf130000-0000-4000-8000-000000000001','Current correction machine','active',
  'CURRENT-CORRECTION-MACHINE','CURRENT_CORRECTION_ACCOUNT',true);
insert into public.admin_roles(user_id,role,active)
values('cf110000-0000-4000-8000-000000000001','super_admin',true);
insert into public.reporting_machine_refund_managers(
  reporting_machine_id,manager_user_id,manager_email,grant_reason
) values('cf140000-0000-4000-8000-000000000001','cf110000-0000-4000-8000-000000000001',
  'current-fact-manager@example.invalid','Current-fact correction fixture');
insert into public.refund_nayax_machine_inventory(account_key,nayax_machine_id,reporting_machine_id)
values('CURRENT_CORRECTION_ACCOUNT','CURRENT-CORRECTION-MACHINE',
  'cf140000-0000-4000-8000-000000000001');
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
values('cf150000-0000-4000-8000-000000000001','RF-CURRENT-FACT',
  'cf140000-0000-4000-8000-000000000001','cf130000-0000-4000-8000-000000000001',
  'current-fact-customer@example.invalid','Production-shaped redundant correction scope',
  '2026-09-05T21:00:00Z','2026-09-05T14:00','America/Los_Angeles','exact','rough',null,
  'card',1060,1060,'1003','wallet_device_token','wallet_device',null,true,
  'phone_watch_wallet','apple_pay','phone',null,'needs_review','needs_nayax',2,'form','{}',
  '2026-09-05T22:00:00Z','hosted_refund_intake');

create function pg_temp.current_fact_evidence(
  case_id uuid,
  authorized_at timestamptz,
  identifier_policy_version text,
  correction_fields jsonb,
  is_top boolean,
  candidate_rank integer
) returns jsonb language sql stable as $$
  select jsonb_build_object(
    'selection_allowed',false,'is_recommended',false,'one_click_eligible',false,
    'recommendation_state','ambiguous','confidence_class','ambiguous_manual',
    'policy_version','2026-09-05.v11','identifier_policy_version',identifier_policy_version,
    'customer_fact_version',c.deterministic_fact_version,
    'customer_credential_class','customer_phone_wallet_token',
    'provider_identifier_class','last_sales_contactless_identifier_unverified',
    'card_last4_comparison','exact_support','card_network_comparison','missing',
    'payment_interaction_comparison','supporting','same_identifier_equivalence_proven',false,
    'identifier_review_state','exact_support',
    'customer_correction_fields',correction_fields,
    'hard_exclusions','[]'::jsonb,
    'manual_review_reasons','["transaction_occurrence_time_uncertain","wallet_payment"]'::jsonb,
    'reason_codes','["machine_exact","amount_exact","customer_time_rough","transaction_occurrence_time_uncertain","customer_card_network_unknown","wallet_payment"]'::jsonb,
    'match_factors','[]'::jsonb,'match_reason','One purchase needs current customer context',
    'recommendation_rank',candidate_rank,'is_top_ranked',is_top,
    'lookup_account_scope','CURRENT_CORRECTION_ACCOUNT',
    'lookup_provider_machine_id','CURRENT-CORRECTION-MACHINE',
    'provider_machine_id','CURRENT-CORRECTION-MACHINE',
    'machine_authorization_time_raw',
      to_char(authorized_at at time zone 'America/Los_Angeles','YYYY-MM-DD"T"HH24:MI:SS.MS'),
    'machine_authorization_time_source','MachineAuthorizationTime',
    'machine_authorization_at',authorized_at,
    'machine_time_resolution','exact','provider_time_resolution','exact',
    'provider_time_source','authorization_gmt','authorized_at',authorized_at
  ) || jsonb_build_object(
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
  where c.id=case_id;
$$;

create temp table correction_claim as
select (public.service_begin_refund_nayax_lookup(
  'cf150000-0000-4000-8000-000000000001',2,'manual',
  'cf110000-0000-4000-8000-000000000001'
)->>'lookupGeneration')::bigint generation;

insert into public.refund_nayax_lookup_candidates(token,refund_case_id,lookup_generation,
  actor_user_id,reporting_machine_id,provider_transaction_id,site_id,machine_authorization_time,
  amount_cents,card_last4,currency_code,evidence_summary,expires_at)
select 'cf160000-0000-4000-8000-000000000001','cf150000-0000-4000-8000-000000000001',
  generation,'cf110000-0000-4000-8000-000000000001','cf140000-0000-4000-8000-000000000001',
  'CURRENT-CORRECTION-TX',91,'2026-09-05T21:15:00Z',1060,'1003','USD',
  pg_temp.current_fact_evidence('cf150000-0000-4000-8000-000000000001','2026-09-05T21:15:00Z',
    '2026-09-05.identifier.v1','["card_last4_source"]',true,1),
  statement_timestamp()+interval '1 hour'
from correction_claim;

select is(public.refund_nayax_candidate_identifier_evidence_state(
  'cf150000-0000-4000-8000-000000000001','cf140000-0000-4000-8000-000000000001',
  91,'2026-09-05T21:15:00Z',1060,'1003','USD',
  pg_temp.current_fact_evidence('cf150000-0000-4000-8000-000000000001','2026-09-05T21:15:00Z',
    '2026-09-05.identifier.v1','["card_last4_source"]',true,1)
), 'refresh','The production-shaped exact-support candidate requires an internal evidence refresh');

select is((public.service_commit_refund_nayax_lookup(
  'cf150000-0000-4000-8000-000000000001',(select generation from correction_claim),2,
  'manual_exception','manual_exception','2026-09-05.v11',statement_timestamp(),
  'Current customer facts can resolve the same case',null,1,'manual',
  'cf110000-0000-4000-8000-000000000001'
)->>'applied'),'true','The correction lookup commits through the generation guard');

select is(public.refund_purchase_correction_request_fields(
  'cf150000-0000-4000-8000-000000000001'), '{}'::text[],
  'Refresh-only evidence stays customer-silent instead of offering stale scope');
select is((select count(*)::integer from public.refund_case_messages
  where refund_case_id='cf150000-0000-4000-8000-000000000001'),0,
  'Refresh-only correction inspection creates no customer message');

create temp table refreshed_claim as
select (public.service_begin_refund_nayax_lookup(
  'cf150000-0000-4000-8000-000000000001',2,'manual',
  'cf110000-0000-4000-8000-000000000001'
)->>'lookupGeneration')::bigint generation;

select is(public.refund_purchase_correction_request_fields(
  'cf150000-0000-4000-8000-000000000001'), '{}'::text[],
  'An in-progress read-only lookup exposes no customer correction action');

insert into public.refund_nayax_lookup_candidates(token,refund_case_id,lookup_generation,
  actor_user_id,reporting_machine_id,provider_transaction_id,site_id,machine_authorization_time,
  amount_cents,card_last4,currency_code,evidence_summary,expires_at)
select gen_random_uuid(),'cf150000-0000-4000-8000-000000000001',claim.generation,
  'cf110000-0000-4000-8000-000000000001','cf140000-0000-4000-8000-000000000001',
  'CURRENT-CORRECTION-REFRESHED-' || series.value,90+series.value,
  '2026-09-05T21:15:00Z'::timestamptz+(series.value-1)*interval '1 minute',
  1060,'1003','USD',
  pg_temp.current_fact_evidence('cf150000-0000-4000-8000-000000000001',
    '2026-09-05T21:15:00Z'::timestamptz+(series.value-1)*interval '1 minute',
    '2026-09-05.identifier.v2','[]',series.value=1,series.value),
  statement_timestamp()+interval '1 hour'
from refreshed_claim claim
cross join generate_series(1,10) series(value);

select is(public.refund_nayax_candidate_identifier_evidence_state(
  'cf150000-0000-4000-8000-000000000001','cf140000-0000-4000-8000-000000000001',
  91,'2026-09-05T21:15:00Z',1060,'1003','USD',
  pg_temp.current_fact_evidence('cf150000-0000-4000-8000-000000000001','2026-09-05T21:15:00Z',
    '2026-09-05.identifier.v2','[]',true,1)
), 'valid','The refreshed top candidate evidence is current and valid');

select is((public.service_commit_refund_nayax_lookup(
  'cf150000-0000-4000-8000-000000000001',(select generation from refreshed_claim),2,
  'manual_exception','manual_exception','2026-09-05.v11',statement_timestamp(),
  'Ten current candidates need structured customer facts',null,10,'manual',
  'cf110000-0000-4000-8000-000000000001'
)->>'applied'),'true','The refreshed current generation commits through the generation guard');

select is(public.refund_purchase_correction_request_fields_pre_production_parity(
  'cf150000-0000-4000-8000-000000000001'),
  array['card_last4_source']::text[],
  'The retained production behavior offers only the redundant last-four-source question');

select is(public.refund_purchase_correction_request_fields(
  'cf150000-0000-4000-8000-000000000001'),
  array['incident_time','incident_time_source','card_network','nearby_attempt_count']::text[],
  'Useful unresolved purchase facts replace the already-established wallet-token source');

update public.refund_cases
set card_last4_provenance='physical_card'
where id='cf150000-0000-4000-8000-000000000001';
select is(public.refund_purchase_correction_request_fields(
  'cf150000-0000-4000-8000-000000000001'),
  array['card_last4','card_last4_source']::text[],
  'Phone/watch interaction alone cannot repair a suffix with physical-card provenance');
update public.refund_cases
set card_last4_provenance='wallet_device_token'
where id='cf150000-0000-4000-8000-000000000001';

update public.refund_cases
set payment_interaction='unsure',wallet_device_kind=null
where id='cf150000-0000-4000-8000-000000000001';
select is(public.refund_purchase_correction_request_fields(
  'cf150000-0000-4000-8000-000000000001'),
  array['payment_interaction','card_last4_source','wallet_device_kind']::text[],
  'Wallet-token suffix provenance alone cannot repair an unresolved interaction');
update public.refund_cases
set payment_interaction='phone_watch_wallet',wallet_device_kind='phone'
where id='cf150000-0000-4000-8000-000000000001';

update public.refund_cases
set card_last4_source='physical_card'
where id='cf150000-0000-4000-8000-000000000001';
select is(public.refund_purchase_correction_request_fields(
  'cf150000-0000-4000-8000-000000000001'), '{}'::text[],
  'An explicit contradictory physical-card source is not silently replaced');
update public.refund_cases
set card_last4_source='bank_record'
where id='cf150000-0000-4000-8000-000000000001';
select is(public.refund_purchase_correction_request_fields(
  'cf150000-0000-4000-8000-000000000001'), '{}'::text[],
  'An explicit contradictory bank-record source is not silently replaced');
update public.refund_cases
set card_last4_source=null
where id='cf150000-0000-4000-8000-000000000001';

select is((select count(*)::integer from public.refund_case_messages
  where refund_case_id='cf150000-0000-4000-8000-000000000001'),0,
  'Reading the repaired correction scope creates no customer message');

create function pg_temp.queue_current_fact_scope(p_fields text[])
returns jsonb language sql as $$
  select public.service_enqueue_refund_manual_message_intent(
    'cf150000-0000-4000-8000-000000000001',
    (select official_action_version from public.refund_cases
      where id='cf150000-0000-4000-8000-000000000001'),
    gen_random_uuid(),'cf110000-0000-4000-8000-000000000001','more_info',
    'current-fact-customer@example.invalid','Please confirm these purchase details',
    '[Secure refund correction link included at delivery]',
    'refund_more_info_editable_v1','manager_authored','missing_information',p_fields,
    null,false,null
  );
$$;

select throws_like(
  $$select pg_temp.queue_current_fact_scope(array['card_last4_source'])$$,
  '%Valid refund manual-message intent%',
  'A redundant-only action fails before an outbox message is created');
select is((select count(*)::integer from public.refund_case_messages
  where refund_case_id='cf150000-0000-4000-8000-000000000001'),0,
  'The rejected redundant-only action sends and queues no customer message');

create temp table correction_message as
select pg_temp.queue_current_fact_scope(
  array['incident_time','incident_time_source','card_network','nearby_attempt_count']
) value;
select is((select count(*)::integer from public.refund_case_messages
  where refund_case_id='cf150000-0000-4000-8000-000000000001'),1,
  'One structured same-case customer message is queued');
select lives_ok(format(
  $$select public.service_issue_refund_purchase_correction('%s',repeat('c',64),2)$$,
  (select value->>'messageId' from correction_message)
), 'The one message receives one secure existing-case correction capability');
select ok((select count(*)=1
    and bool_and(correction_requested_fields =
      array['incident_time','incident_time_source','card_network','nearby_attempt_count']::text[])
  from public.refund_wallet_correction_contexts
  where refund_case_id='cf150000-0000-4000-8000-000000000001'),
  'The secure capability contains only the current useful fields');

update public.refund_case_messages
set status='sent',sent_at=statement_timestamp()
where id=(select (value->>'messageId')::uuid from correction_message);
select is(public.service_get_refund_purchase_correction(repeat('c',64))->>'state','ready',
  'The sent same-case link opens the structured correction form');
select lives_ok($$
  select public.service_submit_refund_purchase_correction(
    repeat('c',64),2,
    '{
      "incident_time":{"disposition":"cannot_provide"},
      "incident_time_source":{"disposition":"cannot_provide"},
      "card_network":{"disposition":"cannot_provide"},
      "nearby_attempt_count":{"disposition":"cannot_provide"}
    }'::jsonb
  )
$$, 'Choosing Not sure for every requested field completes the correction once');
select is(public.service_get_refund_purchase_correction(repeat('c',64))->>'state','received',
  'The completed Not-sure response is retained on the existing case');
select is((select count(*)::integer from public.refund_case_messages
  where refund_case_id='cf150000-0000-4000-8000-000000000001'),1,
  'Correction completion creates no second customer message');

select * from finish();
rollback;
