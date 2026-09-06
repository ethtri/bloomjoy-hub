begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(12);

insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data)
values('fb110000-0000-4000-8000-000000000001','authenticated','authenticated',
  'soft-time-manager@example.invalid','{}','{}');
insert into public.customer_accounts(id,name,account_type)
values('fb120000-0000-4000-8000-000000000001','Soft time fixture','internal');
insert into public.reporting_locations(id,account_id,name,timezone)
values('fb130000-0000-4000-8000-000000000001','fb120000-0000-4000-8000-000000000001',
  'Soft time location','America/Los_Angeles');
insert into public.reporting_machines(id,account_id,location_id,machine_label,status,nayax_machine_id,
  nayax_account_key,nayax_refunds_enabled)
values('fb140000-0000-4000-8000-000000000001','fb120000-0000-4000-8000-000000000001',
  'fb130000-0000-4000-8000-000000000001','Soft time machine','active','SOFT-TIME-MACHINE',
  'SOFT_TIME_ACCOUNT',true);
insert into public.reporting_machine_refund_managers(reporting_machine_id,manager_user_id,manager_email,grant_reason)
values('fb140000-0000-4000-8000-000000000001','fb110000-0000-4000-8000-000000000001',
  'soft-time-manager@example.invalid','Fixture');
insert into public.refund_nayax_machine_inventory(account_key,nayax_machine_id,reporting_machine_id)
values('SOFT_TIME_ACCOUNT','SOFT-TIME-MACHINE','fb140000-0000-4000-8000-000000000001');

insert into public.refund_cases(id,public_reference,reporting_machine_id,reporting_location_id,customer_email,
  issue_summary,incident_at,incident_timezone,incident_time_resolution,incident_time_confidence,
  incident_time_source,nearby_attempt_count,payment_method,payment_amount_cents,refund_amount_cents,
  card_last4,card_last4_provenance,card_last4_source,payment_interaction,status,correlation_status,
  deterministic_fact_version,intake_source,intake_meta,customer_request_received_at,
  customer_request_received_source)
values('fb150000-0000-4000-8000-000000000001','RF-SOFT-TIME','fb140000-0000-4000-8000-000000000001',
  'fb130000-0000-4000-8000-000000000001','soft-time-customer@example.invalid','Offline vend before form',
  '2026-09-05T18:00:00Z','America/Los_Angeles','exact','within_15_minutes',
  'transaction_alert_or_receipt','one','card',1090,1090,'6768','physical_card','physical_card','tap_card',
  'needs_review','needs_nayax',4,'form','{"source":"hosted_refund_intake"}',
  '2026-09-05T18:03:00Z','hosted_refund_intake');

create function pg_temp.soft_time_evidence(
  boundary text,
  authorized_at timestamptz,
  comparable boolean default false,
  occurrence_lower timestamptz default null,
  occurrence_upper timestamptz default null,
  request_lower timestamptz default null,
  request_upper timestamptz default null
) returns jsonb language sql stable as $$
  select jsonb_build_object(
    'selection_allowed',boundary <> 'after_request','is_recommended',true,'one_click_eligible',false,
    'recommendation_state','manual_exception','confidence_class','ambiguous_manual',
    'policy_version','2026-09-05.v11','identifier_policy_version','2026-09-05.identifier.v1',
    'customer_fact_version',c.deterministic_fact_version,
    'customer_credential_class','customer_physical_contactless_pan',
    'provider_identifier_class','last_sales_contactless_identifier_unverified',
    'card_last4_comparison','exact_support','card_network_comparison','missing',
    'payment_interaction_comparison','supporting','same_identifier_equivalence_proven',false,
    'identifier_review_state','exact_support','customer_correction_fields','[]'::jsonb,
    'hard_exclusions','[]'::jsonb,
    'manual_review_reasons','["transaction_occurrence_time_uncertain"]'::jsonb,
    'reason_codes','["machine_exact","amount_exact","transaction_occurrence_time_uncertain"]'::jsonb,
    'match_factors','[]'::jsonb,'match_reason','Exact machine and amount; provider timing is supporting evidence',
    'recommendation_rank',1,'lookup_account_scope','SOFT_TIME_ACCOUNT',
    'lookup_provider_machine_id','SOFT-TIME-MACHINE','provider_machine_id','SOFT-TIME-MACHINE',
    'machine_authorization_time_raw','2026-09-05T18:05:00.1234567',
    'machine_authorization_at','2026-09-05T18:05:00Z',
    'machine_authorization_time_source','MachineAuthorizationTime','machine_time_resolution','exact',
    'provider_time_resolution','exact','provider_time_source','authorization_gmt',
    'authorized_at',authorized_at,'customer_request_received_at',c.customer_request_received_at,
    'customer_request_received_source',c.customer_request_received_source,
    'request_time_boundary',boundary,'transaction_occurrence_comparable',comparable,
    'transaction_occurrence_semantics',case when comparable then 'online_purchase_occurrence' else 'unknown' end,
    'transaction_occurrence_proof_source',case when comparable then to_jsonb('synthetic_online_event'::text) else 'null'::jsonb end,
    'transaction_occurrence_timestamp_source',case when comparable then to_jsonb('authorization_gmt'::text) else 'null'::jsonb end,
    'transaction_occurrence_timezone_basis',case when comparable then to_jsonb('utc'::text) else 'null'::jsonb end,
    'transaction_occurrence_lower_bound_at',coalesce(to_jsonb(occurrence_lower),'null'::jsonb),
    'transaction_occurrence_upper_bound_at',coalesce(to_jsonb(occurrence_upper),'null'::jsonb),
    'request_receipt_lower_bound_at',coalesce(to_jsonb(request_lower),'null'::jsonb),
    'request_receipt_upper_bound_at',coalesce(to_jsonb(request_upper),'null'::jsonb),
    'amount_delta_cents',0,'time_delta_minutes',
      ceil(abs(extract(epoch from (authorized_at-c.incident_at)))/60.0)::integer,
    'payment_status','approved','payment_status_evidence','last_sales_contract',
    'provider_refund_state','clear','duplicate_provider_record',false,
    'card_last4','6768','currency_code','USD','amount_cents',1090
  ) from public.refund_cases c where c.id='fb150000-0000-4000-8000-000000000001';
$$;

create temp table lookup_claim as
select (public.service_begin_refund_nayax_lookup('fb150000-0000-4000-8000-000000000001',4,'manual',
  'fb110000-0000-4000-8000-000000000001')->>'lookupGeneration')::bigint generation;

-- The customer vended before the form, but offline authorization/synchronization produced a later provider time.
insert into public.refund_nayax_lookup_candidates(token,refund_case_id,lookup_generation,actor_user_id,
  reporting_machine_id,provider_transaction_id,site_id,machine_authorization_time,amount_cents,card_last4,
  currency_code,evidence_summary,expires_at)
select 'fb160000-0000-4000-8000-000000000001','fb150000-0000-4000-8000-000000000001',generation,
  'fb110000-0000-4000-8000-000000000001','fb140000-0000-4000-8000-000000000001',
  'OFFLINE-LATER-AUTH',14,'2026-09-05T18:05:00Z',1090,'6768','USD',
  pg_temp.soft_time_evidence('occurrence_time_uncertain','2026-09-05T18:05:00Z'),
  statement_timestamp()+interval '1 hour' from lookup_claim;
select is((select count(*)::integer from public.refund_nayax_lookup_candidates
  where token='fb160000-0000-4000-8000-000000000001'),1,
  'Offline/deferred authorization after form remains a selectable review candidate');
select is((select evidence_summary->>'one_click_eligible' from public.refund_nayax_lookup_candidates
  where token='fb160000-0000-4000-8000-000000000001'),'false',
  'Unknown ordering never becomes automatic one-click evidence');
select is((select evidence_summary->>'transaction_occurrence_semantics' from public.refund_nayax_lookup_candidates
  where token='fb160000-0000-4000-8000-000000000001'),'unknown',
  'Authorization GMT is retained separately and does not invent purchase-occurrence semantics');

select throws_ok($$insert into public.refund_nayax_lookup_candidates(token,refund_case_id,lookup_generation,
  actor_user_id,reporting_machine_id,provider_transaction_id,site_id,machine_authorization_time,amount_cents,
  card_last4,currency_code,evidence_summary,expires_at)
select 'fb160000-0000-4000-8000-000000000002','fb150000-0000-4000-8000-000000000001',generation,
  'fb110000-0000-4000-8000-000000000001','fb140000-0000-4000-8000-000000000001',
  'FORGED-UNKNOWN-BOUNDS',14,'2026-09-05T18:05:00Z',1090,'6768','USD',
  jsonb_set(pg_temp.soft_time_evidence('occurrence_time_uncertain','2026-09-05T18:05:00Z'),
    '{transaction_occurrence_lower_bound_at}',to_jsonb('2026-09-05T18:04:59Z'::text)),
  statement_timestamp()+interval '1 hour' from lookup_claim$$,
  'P4625','Invalid customer request time evidence',
  'Unknown semantics cannot smuggle a proof bound into selectable evidence');

select throws_ok($$insert into public.refund_nayax_lookup_candidates(token,refund_case_id,lookup_generation,
  actor_user_id,reporting_machine_id,provider_transaction_id,site_id,machine_authorization_time,amount_cents,
  card_last4,currency_code,evidence_summary,expires_at)
select 'fb160000-0000-4000-8000-000000000003','fb150000-0000-4000-8000-000000000001',generation,
  'fb110000-0000-4000-8000-000000000001','fb140000-0000-4000-8000-000000000001',
  'PROVED-ONLINE-LATER',14,'2026-09-05T18:05:00Z',1090,'6768','USD',
  pg_temp.soft_time_evidence('after_request','2026-09-05T18:05:00Z',true,
    '2026-09-05T18:04:59.900Z','2026-09-05T18:05:00.100Z',
    '2026-09-05T18:02:59.900Z','2026-09-05T18:03:00.100Z'),
  statement_timestamp()+interval '1 hour' from lookup_claim$$,
  'P4625','Transaction occurred after Bloomjoy received the customer request',
  'Only a proved online purchase interval wholly after receipt is hard excluded');

select lives_ok($$insert into public.refund_nayax_lookup_candidates(token,refund_case_id,lookup_generation,
  actor_user_id,reporting_machine_id,provider_transaction_id,site_id,machine_authorization_time,amount_cents,
  card_last4,currency_code,evidence_summary,expires_at)
select 'fb160000-0000-4000-8000-000000000004','fb150000-0000-4000-8000-000000000001',generation,
  'fb110000-0000-4000-8000-000000000001','fb140000-0000-4000-8000-000000000001',
  'ONLINE-OVERLAP',14,'2026-09-05T18:05:00Z',1090,'6768','USD',
  pg_temp.soft_time_evidence('occurrence_time_uncertain','2026-09-05T18:03:00Z',true,
    '2026-09-05T18:02:59.900Z','2026-09-05T18:03:00.100Z',
    '2026-09-05T18:02:59.900Z','2026-09-05T18:03:00.100Z'),
  statement_timestamp()+interval '1 hour' from lookup_claim$$,
  'Overlapping bounded clocks remain uncertain instead of hard excluded');

select is((public.service_commit_refund_nayax_lookup('fb150000-0000-4000-8000-000000000001',
  (select generation from lookup_claim),4,'multiple_matches','ambiguous','2026-09-05.v11',statement_timestamp(),
  'Provider timing is supporting evidence',null,2,'manual','fb110000-0000-4000-8000-000000000001')->>'applied'),
  'true','Current v11 candidates commit through the existing generation guard');

set local role service_role;
select is((public.service_select_refund_nayax_candidate_as_actor(
  'fb110000-0000-4000-8000-000000000001','fb150000-0000-4000-8000-000000000001',
  (select official_action_version from public.refund_cases where id='fb150000-0000-4000-8000-000000000001'),
  'fb160000-0000-4000-8000-000000000001','customer_confirmation')->>'selectionApplied'),
  'true','Manager can confirm the otherwise corroborated offline candidate');
reset role;
select ok((select matched_nayax_transaction_id='OFFLINE-LATER-AUTH'
    and matched_nayax_machine_auth_time='2026-09-05T18:05:00Z'
    and nayax_match_execution_eligible
  from public.refund_cases where id='fb150000-0000-4000-8000-000000000001'),
  'Manager corroboration binds the exact raw API transaction and exposes the normal decision path');
select is((select count(*)::integer from public.refund_case_nayax_refund_attempts
  where refund_case_id='fb150000-0000-4000-8000-000000000001'),0,
  'Transaction confirmation creates no provider or payment attempt');
select is((select count(*)::integer from public.refund_case_messages
  where refund_case_id='fb150000-0000-4000-8000-000000000001'),0,
  'Transaction confirmation sends no customer communication');
select ok((select count(*)=1 and bool_and((metadata->>'execution_eligible')::boolean)
  from public.refund_case_events where refund_case_id='fb150000-0000-4000-8000-000000000001'
    and event_type='nayax_match_selected'),
  'Durable selection evidence records the manager-corroborated execution state');

select * from finish();
rollback;
