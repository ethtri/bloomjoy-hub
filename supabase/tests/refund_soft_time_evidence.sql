begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(54);

create function pg_temp.set_auth_claims(p_user_id uuid)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub',p_user_id::text,true);
  perform set_config('request.jwt.claim.role','authenticated',true);
  perform set_config('request.jwt.claims',jsonb_build_object(
    'sub',p_user_id,'role','authenticated','aal','aal1','amr',
    jsonb_build_array(jsonb_build_object('method','password','timestamp',
      extract(epoch from statement_timestamp())))
  )::text,true);
end;
$$;

create temp table soft_time_approval_receipt(authorization_id uuid primary key);
grant select,insert on table pg_temp.soft_time_approval_receipt to authenticated,service_role;

insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data)
values('fb110000-0000-4000-8000-000000000001','authenticated','authenticated',
  'soft-time-manager@example.invalid','{}','{}');
insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data)
values('fb110000-0000-4000-8000-000000000002','authenticated','authenticated',
  'soft-time-handoff-manager@example.invalid','{}','{}');
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
insert into public.reporting_machine_refund_managers(reporting_machine_id,manager_user_id,manager_email,grant_reason)
values('fb140000-0000-4000-8000-000000000001','fb110000-0000-4000-8000-000000000002',
  'soft-time-handoff-manager@example.invalid','Fixture handoff');
insert into public.refund_nayax_machine_inventory(account_key,nayax_machine_id,reporting_machine_id)
values('SOFT_TIME_ACCOUNT','SOFT-TIME-MACHINE','fb140000-0000-4000-8000-000000000001');

insert into public.refund_cases(id,public_reference,reporting_machine_id,reporting_location_id,customer_email,
  issue_summary,incident_at,incident_local_datetime,incident_timezone,incident_time_resolution,incident_time_confidence,
  incident_time_source,nearby_attempt_count,payment_method,payment_amount_cents,refund_amount_cents,
  card_last4,card_last4_provenance,card_last4_source,payment_interaction,status,correlation_status,
  deterministic_fact_version,intake_source,intake_meta,customer_request_received_at,
  customer_request_received_source)
values('fb150000-0000-4000-8000-000000000001','RF-SOFT-TIME','fb140000-0000-4000-8000-000000000001',
  'fb130000-0000-4000-8000-000000000001','soft-time-customer@example.invalid','Offline vend before form',
  '2026-09-05T18:00:00Z','2026-09-05T11:00','America/Los_Angeles','exact','rough',
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
  request_upper timestamptz default null,
  refund_case_id uuid default 'fb150000-0000-4000-8000-000000000001'
) returns jsonb language sql stable as $$
  select jsonb_build_object(
    'selection_allowed',boundary <> 'after_request' and (
      (c.incident_time_resolution in ('exact','legacy_absolute')
        and c.incident_time_confidence is distinct from 'rough')
      or c.card_last4 = '6768'
    ),'is_recommended',true,'one_click_eligible',false,
    'recommendation_state','manual_exception','confidence_class','ambiguous_manual',
    'policy_version','2026-09-05.v11','identifier_policy_version','2026-09-05.identifier.v2',
    'customer_fact_version',c.deterministic_fact_version,
    'customer_credential_class',case when c.card_last4 is null
      then 'customer_identifier_unknown' else 'customer_physical_contactless_pan' end,
    'provider_identifier_class','last_sales_contactless_identifier_unverified',
    'card_last4_comparison',case when c.card_last4 is null then 'missing' else 'exact_support' end,
    'card_network_comparison','missing',
    'payment_interaction_comparison','supporting','same_identifier_equivalence_proven',false,
    'identifier_review_state',case when c.card_last4 is null then 'needs_corroboration' else 'exact_support' end,
    'customer_correction_fields','["incident_time"]'::jsonb,
    'hard_exclusions','[]'::jsonb,
    'manual_review_reasons','["transaction_occurrence_time_uncertain"]'::jsonb,
    'reason_codes','["machine_exact","amount_exact","transaction_occurrence_time_uncertain"]'::jsonb,
    'match_factors','[]'::jsonb,'match_reason','Exact machine and amount; provider timing is supporting evidence',
    'recommendation_rank',1,'is_top_ranked',true,'lookup_account_scope','SOFT_TIME_ACCOUNT',
    'lookup_provider_machine_id','SOFT-TIME-MACHINE','provider_machine_id','SOFT-TIME-MACHINE',
    'machine_authorization_time_raw','2026-09-05T11:05:00.1234567',
    'machine_authorization_at','2026-09-05T18:05:00.123Z',
    'machine_authorization_time_source','MachineAuthorizationTime','machine_time_resolution','exact',
    'provider_time_resolution','exact','provider_time_source','authorization_gmt',
    'authorized_at',authorized_at,'customer_request_received_at',c.customer_request_received_at,
    'customer_request_received_source',c.customer_request_received_source,
    'request_time_boundary',boundary,'transaction_occurrence_comparable',comparable
  ) || jsonb_build_object(
    'transaction_occurrence_semantics',case when comparable then 'online_purchase_occurrence' else 'unknown' end,
    'transaction_occurrence_proof_source',case when comparable then to_jsonb('verified_provider_purchase_occurrence_v1'::text) else 'null'::jsonb end,
    'transaction_occurrence_timestamp_source',case when comparable then to_jsonb('authorization_gmt'::text) else 'null'::jsonb end,
    'transaction_occurrence_timezone_basis',case when comparable then to_jsonb('utc'::text) else 'null'::jsonb end,
    'transaction_occurrence_lower_bound_at',coalesce(to_jsonb(occurrence_lower),'null'::jsonb),
    'transaction_occurrence_upper_bound_at',coalesce(to_jsonb(occurrence_upper),'null'::jsonb),
    'request_receipt_lower_bound_at',coalesce(to_jsonb(request_lower),'null'::jsonb),
    'request_receipt_upper_bound_at',coalesce(to_jsonb(request_upper),'null'::jsonb),
    'amount_delta_cents',0,
    'time_delta_minutes',case when comparable then
      ceil(abs(extract(epoch from (authorized_at-c.incident_at)))/60.0)::integer else null end,
    'provider_processing_time_delta_minutes',
      ceil(abs(extract(epoch from (authorized_at-c.incident_at)))/60.0)::integer,
    'payment_status','approved','payment_status_evidence','last_sales_contract',
    'provider_refund_state','clear','duplicate_provider_record',false,
    'card_last4','6768','currency_code','USD','amount_cents',1090
  ) from public.refund_cases c where c.id=refund_case_id;
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
  'OFFLINE-LATER-AUTH',14,'2026-09-05T18:05:00.123Z',1090,'6768','USD',
  pg_temp.soft_time_evidence('occurrence_time_uncertain','2026-09-05T18:05:00Z'),
  statement_timestamp()+interval '1 hour' from lookup_claim;
select is((select count(*)::integer from public.refund_nayax_lookup_candidates
  where token='fb160000-0000-4000-8000-000000000001'),1,
  'Offline/deferred authorization after form remains a selectable review candidate');
select is(public.refund_nayax_candidate_identifier_evidence_state(
  'fb150000-0000-4000-8000-000000000001','fb140000-0000-4000-8000-000000000001',14,
  '2026-09-05T18:05:00.123Z',1090,'6768','USD',
  pg_temp.soft_time_evidence('occurrence_time_uncertain','2026-09-05T18:05:00Z')
), 'valid',
  'Rough customer time remains valid for explicit manager selection when the other evidence identifies the sale');
select is((select evidence_summary->>'one_click_eligible' from public.refund_nayax_lookup_candidates
  where token='fb160000-0000-4000-8000-000000000001'),'false',
  'Unknown ordering never becomes automatic one-click evidence');
select is((select evidence_summary->>'transaction_occurrence_semantics' from public.refund_nayax_lookup_candidates
  where token='fb160000-0000-4000-8000-000000000001'),'unknown',
  'Authorization GMT is retained separately and does not invent purchase-occurrence semantics');
select ok((select evidence_summary->'time_delta_minutes' = 'null'::jsonb
    and evidence_summary->>'provider_processing_time_delta_minutes'='5'
  from public.refund_nayax_lookup_candidates
  where token='fb160000-0000-4000-8000-000000000001'),
  'Unknown occurrence has no purchase-time delta while provider processing delta remains explicit');

select ok(not has_function_privilege('service_role',
  'public.service_select_refund_nayax_candidate_as_actor_pre_lookup_generation_v1(uuid,uuid,bigint,uuid,text)',
  'execute'),
  'Service role cannot bypass the validated current-generation selection wrapper');

select is(public.refund_nayax_candidate_identifier_evidence_state(
  'fb150000-0000-4000-8000-000000000001','fb140000-0000-4000-8000-000000000001',14,
  '2026-09-05T18:05:00.123Z',1090,'6768','USD',
  jsonb_set(pg_temp.soft_time_evidence('occurrence_time_uncertain','2026-09-05T18:05:00Z'),
    '{machine_authorization_time_raw}',to_jsonb('2026-09-05T11:05:00.999'::text))
), 'invalid',
  'Raw MachineAuTime must normalize to the exact selected candidate timestamp');

select is(public.refund_nayax_request_boundary_evidence_state(
  '2026-09-05T18:03:00Z','hosted_refund_intake',
  jsonb_set(pg_temp.soft_time_evidence('before_or_at_request','2026-09-05T18:00:00Z',true,
    '2026-09-05T17:59:59.900Z','2026-09-05T18:00:00.100Z',
    '2026-09-05T18:02:59.900Z','2026-09-05T18:03:00.100Z'),
    '{transaction_occurrence_timezone_basis}',to_jsonb('verified_machine_timezone'::text))
), 'invalid',
  'A purchase proof cannot alias an authorization GMT timestamp to a machine timezone');

select is(public.refund_nayax_request_boundary_evidence_state(
  '2026-09-05T18:03:00Z','hosted_refund_intake',
  jsonb_set(pg_temp.soft_time_evidence('before_or_at_request','2026-09-05T18:00:00Z',true,
    '2026-09-05T17:59:59.900Z','2026-09-05T18:00:00.100Z',
    '2026-09-05T18:02:59.900Z','2026-09-05T18:03:00.100Z'),
    '{transaction_occurrence_lower_bound_at}',to_jsonb('-infinity'::text))
), 'invalid',
  'Non-finite occurrence intervals cannot authorize transaction filtering');

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
  'ONLINE-OVERLAP',14,'2026-09-05T18:05:00.123Z',1090,'6768','USD',
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
select throws_ok($$select public.service_select_refund_nayax_candidate_as_actor(
  'fb110000-0000-4000-8000-000000000001','fb150000-0000-4000-8000-000000000001',
  (select official_action_version from public.refund_cases where id='fb150000-0000-4000-8000-000000000001'),
  'fb160000-0000-4000-8000-000000000001','correct_card')$$,
  'P4626','Invalid Nayax identifier evidence',
  'Server rejects one selectable row when a rough-time same-card sibling remains selectable');
reset role;

select is(public.refund_purchase_correction_request_fields(
  'fb150000-0000-4000-8000-000000000001'),'{}'::text[],
  'Explicit empty v11 correction scope creates no unnecessary customer question');

set local session_replication_role=replica;
update public.refund_nayax_lookup_candidates
set evidence_summary=jsonb_set(evidence_summary,'{policy_version}',to_jsonb('2026-09-05.v10'::text))
where refund_case_id='fb150000-0000-4000-8000-000000000001';
set local session_replication_role=origin;
update public.refund_cases set nayax_recommendation_state='manual_exception',
  nayax_lookup_status='manual_exception'
where id='fb150000-0000-4000-8000-000000000001';
select is(public.refund_purchase_correction_request_fields(
  'fb150000-0000-4000-8000-000000000001'),'{}'::text[],
  'Stored current-fact v10 evidence preserves an explicit empty correction scope');
set local session_replication_role=replica;
update public.refund_nayax_lookup_candidates
set evidence_summary=jsonb_set(evidence_summary,'{customer_fact_version}',to_jsonb(3))
where refund_case_id='fb150000-0000-4000-8000-000000000001';
set local session_replication_role=origin;
select is(public.refund_purchase_correction_request_fields(
  'fb150000-0000-4000-8000-000000000001'),'{}'::text[],
  'Stale recognized v10 evidence requests an internal refresh without guessed customer fields');
set local session_replication_role=replica;
update public.refund_nayax_lookup_candidates
set evidence_summary=jsonb_set(
  jsonb_set(evidence_summary,'{policy_version}',to_jsonb('2026-09-05.v11'::text)),
  '{customer_fact_version}',to_jsonb(4)
)
where refund_case_id='fb150000-0000-4000-8000-000000000001';
set local session_replication_role=origin;

set local session_replication_role=replica;
update public.refund_nayax_lookup_candidates
set evidence_summary=evidence_summary || jsonb_build_object(
  'selection_allowed',false,
  'identifier_review_state','needs_corroboration',
  'customer_correction_fields',jsonb_build_array('incident_time'),
  'reason_codes',(evidence_summary->'reason_codes') ||
    jsonb_build_array('multiple_candidates_need_distinguishing_time')
)
where refund_case_id='fb150000-0000-4000-8000-000000000001';
set local session_replication_role=origin;
select is(public.refund_nayax_candidate_identifier_evidence_state(
  'fb150000-0000-4000-8000-000000000001','fb140000-0000-4000-8000-000000000001',14,
  '2026-09-05T18:05:00.123Z',1090,'6768','USD',
  (select evidence_summary from public.refund_nayax_lookup_candidates
    where token='fb160000-0000-4000-8000-000000000001')
), 'valid',
  'Server accepts the scorer conservative hold for competing same-card purchases with rough time');
set local role service_role;
select throws_ok($$select public.service_select_refund_nayax_candidate_as_actor(
  'fb110000-0000-4000-8000-000000000001','fb150000-0000-4000-8000-000000000001',
  (select official_action_version from public.refund_cases where id='fb150000-0000-4000-8000-000000000001'),
  'fb160000-0000-4000-8000-000000000001','correct_card')$$,
  'P4604','This Nayax transaction has a safety block and cannot be selected',
  'Server rejects a manager selection when competing same-card purchases still need distinguishing time');
reset role;
update public.refund_cases set nayax_recommendation_state='ambiguous',
  nayax_lookup_status='multiple_matches'
where id='fb150000-0000-4000-8000-000000000001';
select is(public.refund_purchase_correction_request_fields(
  'fb150000-0000-4000-8000-000000000001'),array['incident_time']::text[],
  'Competing same-card purchases use the existing same-case correction path for one distinguishing time fact');

-- Model the exact pre-migration grouped shapes already persisted in production.
-- Compatibility is correction-only: these rows remain invalid for selection.
set local session_replication_role=replica;
update public.refund_nayax_lookup_candidates
set evidence_summary=evidence_summary || case token
  when 'fb160000-0000-4000-8000-000000000001' then jsonb_build_object(
    'identifier_review_state','exact_support',
    'customer_correction_fields','[]'::jsonb
  )
  else jsonb_build_object(
    'identifier_review_state','needs_corroboration',
    'customer_correction_fields','["card_last4_source"]'::jsonb
  )
end
where refund_case_id='fb150000-0000-4000-8000-000000000001';
set local session_replication_role=origin;
select is(public.refund_nayax_candidate_identifier_evidence_state(
  'fb150000-0000-4000-8000-000000000001','fb140000-0000-4000-8000-000000000001',14,
  '2026-09-05T18:05:00.123Z',1090,'6768','USD',
  (select evidence_summary from public.refund_nayax_lookup_candidates
    where token='fb160000-0000-4000-8000-000000000001')
), 'invalid','Persisted pre-migration grouped evidence never becomes selectable');
set local role service_role;
select throws_ok($$select public.service_select_refund_nayax_candidate_as_actor(
  'fb110000-0000-4000-8000-000000000001','fb150000-0000-4000-8000-000000000001',
  (select official_action_version from public.refund_cases where id='fb150000-0000-4000-8000-000000000001'),
  'fb160000-0000-4000-8000-000000000001','correct_card')$$,
  'P4626','Invalid Nayax identifier evidence',
  'Selection stays fail-closed for correction-only upgrade compatibility');
reset role;
select is(public.refund_purchase_correction_request_fields(
  'fb150000-0000-4000-8000-000000000001'),array['incident_time']::text[],
  'Persisted grouped evidence asks only the one distinguishing time question');

-- Apply the customer's answer through the same versioned same-case correction
-- capability used in production. That consumes the old generation before the
-- fresh lookup is created.
create temp table soft_time_correction_message as
select public.service_enqueue_refund_manual_message_intent(
  'fb150000-0000-4000-8000-000000000001',
  (select official_action_version from public.refund_cases
    where id='fb150000-0000-4000-8000-000000000001'),
  gen_random_uuid(),'fb110000-0000-4000-8000-000000000001','more_info',
  'soft-time-customer@example.invalid','Please confirm the purchase time',
  '[Secure refund correction link included at delivery]',
  'refund_more_info_editable_v1','manager_authored','missing_information',
  array['incident_time']::text[],null,false,null
) value;
create temp table soft_time_correction_capability as
select public.service_issue_refund_purchase_correction(
  (select (value->>'messageId')::uuid from soft_time_correction_message),
  repeat('d',64),
  (select deterministic_fact_version from public.refund_cases
    where id='fb150000-0000-4000-8000-000000000001')
) value;
update public.refund_case_messages
set status='sent',sent_at=statement_timestamp()
where id=(select (value->>'messageId')::uuid from soft_time_correction_message);
create temp table soft_time_correction_submission as
select public.service_submit_refund_purchase_correction(
  repeat('d',64),
  (select correction_fact_version from public.refund_wallet_correction_contexts
    where token_hash=repeat('d',64)),
  '{
    "incident_time":{"disposition":"changed","value":"11:02","confidence":"exact"},
    "incident_time_source":{"disposition":"changed","value":"transaction_alert_or_receipt"}
  }'::jsonb
) value;

create temp table corrected_lookup_claim as
select (public.service_begin_refund_nayax_lookup(
  'fb150000-0000-4000-8000-000000000001',
  (select deterministic_fact_version from public.refund_cases
    where id='fb150000-0000-4000-8000-000000000001'),'manual',
  'fb110000-0000-4000-8000-000000000001')->>'lookupGeneration')::bigint generation;

insert into public.refund_nayax_lookup_candidates(token,refund_case_id,lookup_generation,actor_user_id,
  reporting_machine_id,provider_transaction_id,site_id,machine_authorization_time,amount_cents,card_last4,
  currency_code,evidence_summary,expires_at)
select 'fb160000-0000-4000-8000-000000000005','fb150000-0000-4000-8000-000000000001',generation,
  'fb110000-0000-4000-8000-000000000001','fb140000-0000-4000-8000-000000000001',
  'OFFLINE-LATER-AUTH',14,'2026-09-05T18:05:00.123Z',1090,'6768','USD',
  pg_temp.soft_time_evidence('occurrence_time_uncertain','2026-09-05T18:05:00Z'),
  statement_timestamp()+interval '1 hour' from corrected_lookup_claim;

select is((public.service_commit_refund_nayax_lookup('fb150000-0000-4000-8000-000000000001',
  (select generation from corrected_lookup_claim),
  (select deterministic_fact_version from public.refund_cases
    where id='fb150000-0000-4000-8000-000000000001'),
  'manual_exception','manual_exception',
  '2026-09-05.v11',statement_timestamp(),'Corrected incident time identifies one purchase',null,1,
  'manual','fb110000-0000-4000-8000-000000000001')->>'applied'),'true',
  'Accepted correction produces a fresh fact-bound lookup generation');

set local role authenticated;
select pg_temp.set_auth_claims('fb110000-0000-4000-8000-000000000001');
insert into pg_temp.soft_time_approval_receipt(authorization_id)
select (public.admin_authorize_refund_official_action(
  'fb150000-0000-4000-8000-000000000001','approve',
  (select official_action_version from public.refund_cases
    where id='fb150000-0000-4000-8000-000000000001'),
  'card_refund_pending','approved',null,'customer_owed',null,1090,null,null,false,
  'fb160000-0000-4000-8000-000000000005','customer_confirmation'
)->>'authorizationId')::uuid;
reset role;

set local role service_role;
select lives_ok($$select public.service_apply_refund_nayax_selection_approval(
  (select authorization_id from pg_temp.soft_time_approval_receipt),
  'fb150000-0000-4000-8000-000000000001',null,'customer_owed',null,1090,
  'fb160000-0000-4000-8000-000000000005','customer_confirmation')$$,
  'One ordinary approval atomically selects the corrected purchase without a provider call');
reset role;
select ok((select matched_nayax_transaction_id='OFFLINE-LATER-AUTH'
    and matched_nayax_machine_auth_time='2026-09-05T18:05:00.123Z'
    and nayax_match_execution_eligible and nayax_recommendation_state='manager_confirmed'
    and status='card_refund_pending' and decision='approved'
  from public.refund_cases where id='fb150000-0000-4000-8000-000000000001'),
  'Manager confirmation durably approves and binds the exact raw API transaction');
select is((select decision_reason from public.refund_cases
  where id='fb150000-0000-4000-8000-000000000001'),'customer_owed',
  'Transaction confirmation never clears or replaces the existing refund decision');
select is((select count(*)::integer from public.refund_case_nayax_refund_attempts
  where refund_case_id='fb150000-0000-4000-8000-000000000001'),0,
  'Transaction confirmation creates no provider or payment attempt');
select is((select count(*)::integer from public.refund_case_messages
  where refund_case_id='fb150000-0000-4000-8000-000000000001'),1,
  'Transaction confirmation adds no message beyond the one structured correction');
select ok((select count(*)=1 and bool_and(metadata->>'schema_version'='nayax-selection-approval-v1')
  from public.refund_case_events where refund_case_id='fb150000-0000-4000-8000-000000000001'
    and event_type='nayax_refund_execution_authorized'),
  'One immutable marker records the manager-approved exact execution state');
select ok(public.refund_nayax_current_manager_approval_pending(
  'fb110000-0000-4000-8000-000000000001','fb150000-0000-4000-8000-000000000001'),
  'The same manager approval is resumable before any provider attempt');
select ok(public.refund_nayax_current_manager_approval_pending(
  'fb110000-0000-4000-8000-000000000002','fb150000-0000-4000-8000-000000000001'),
  'A different currently mapped manager can continue the same exact business approval after handoff');
update public.reporting_machine_refund_managers
set status='revoked',revoked_at=statement_timestamp()
where reporting_machine_id='fb140000-0000-4000-8000-000000000001'
  and manager_user_id='fb110000-0000-4000-8000-000000000002';
select is(public.refund_nayax_current_manager_approval_pending(
  'fb110000-0000-4000-8000-000000000002','fb150000-0000-4000-8000-000000000001'),false,
  'A manager whose current authority was revoked cannot continue the payment action');
update public.reporting_machine_refund_managers
set status='active',revoked_at=null
where reporting_machine_id='fb140000-0000-4000-8000-000000000001'
  and manager_user_id='fb110000-0000-4000-8000-000000000002';
select is((public.refund_case_nayax_manager_readiness(
  'fb110000-0000-4000-8000-000000000001','fb150000-0000-4000-8000-000000000001'
)->>'approvalPendingExecution'),'true',
  'Manager readiness exposes the current durable approval for reload continuation');

set local session_replication_role=replica;
update public.refund_case_events
set metadata=jsonb_set(metadata,'{case_version}',to_jsonb(0))
where refund_case_id='fb150000-0000-4000-8000-000000000001'
  and event_type='nayax_refund_execution_authorized';
set local session_replication_role=origin;
select is(public.refund_nayax_current_manager_approval_pending(
  'fb110000-0000-4000-8000-000000000001','fb150000-0000-4000-8000-000000000001'),false,
  'A stale marker cannot auto-resume a refund');
set local session_replication_role=replica;
update public.refund_case_events marker
set metadata=jsonb_set(metadata,'{case_version}',to_jsonb(refund_case.official_action_version))
from public.refund_cases refund_case
where marker.refund_case_id=refund_case.id
  and marker.refund_case_id='fb150000-0000-4000-8000-000000000001'
  and marker.event_type='nayax_refund_execution_authorized';
set local session_replication_role=origin;
select ok(public.refund_nayax_current_manager_approval_pending(
  'fb110000-0000-4000-8000-000000000001','fb150000-0000-4000-8000-000000000001'),
  'Only the unchanged exact approval becomes resumable again');

insert into public.refund_nayax_provider_callers(caller_id,assertion_digest,status)
values('nayax-card-refund',encode(extensions.digest('soft-time-executor','sha256'),'hex'),'active')
on conflict(caller_id) do update
set assertion_digest=excluded.assertion_digest,status='active';
create temp table soft_time_fact_change_before as
select official_action_version,deterministic_fact_version,deterministic_facts_updated_at,
  public.refund_nayax_selected_execution_context(id) execution_context
from public.refund_cases where id='fb150000-0000-4000-8000-000000000001';
grant select on table pg_temp.soft_time_fact_change_before to service_role;
update public.refund_cases set card_network='visa'
where id='fb150000-0000-4000-8000-000000000001';
select ok((select refund_case.official_action_version=prior.official_action_version
    and refund_case.deterministic_fact_version=prior.deterministic_fact_version+1
    and not public.refund_nayax_current_manager_approval_pending(
      'fb110000-0000-4000-8000-000000000001',refund_case.id
    )
  from public.refund_cases refund_case cross join pg_temp.soft_time_fact_change_before prior
  where refund_case.id='fb150000-0000-4000-8000-000000000001'),
  'A matching-fact-only change invalidates the saved approval without relying on case-version drift');
set local role service_role;
select throws_ok($$select public.service_reserve_nayax_refund_manager_action_v3(
  'soft-time-executor','fb110000-0000-4000-8000-000000000001',
  'fb150000-0000-4000-8000-000000000001',
  (select official_action_version from pg_temp.soft_time_fact_change_before),
  'nayax-refund-'||repeat('b',64),1090,null,null,'USD',
  'nayax-production-account-contract-v2','nayax-provider-journal-v3',
  (select execution_context->>'contextHash' from pg_temp.soft_time_fact_change_before)
)$$,'P4620',null,
  'A stale matching-fact marker cannot reserve a provider attempt even when the case version is unchanged');
reset role;
set local session_replication_role=replica;
update public.refund_cases refund_case
set card_network=null,
    deterministic_fact_version=prior.deterministic_fact_version,
    deterministic_facts_updated_at=prior.deterministic_facts_updated_at
from pg_temp.soft_time_fact_change_before prior
where refund_case.id='fb150000-0000-4000-8000-000000000001';
set local session_replication_role=origin;
select ok(public.refund_nayax_current_manager_approval_pending(
  'fb110000-0000-4000-8000-000000000001','fb150000-0000-4000-8000-000000000001'),
  'Restoring the unchanged matching facts restores only the same exact saved approval');

select is(public.refund_nayax_machine_authorization_raw_at(
  '2026-11-01T01:30:00','America/Los_Angeles'),
  '2026-11-01T08:30:00Z'::timestamptz,
  'Raw local MachineAuTime uses the scorer first-fold instant during DST fallback');

select lives_ok($$update public.refund_cases set card_wallet_used=true
  where id='fb150000-0000-4000-8000-000000000001'$$,
  'Manager-confirmed exact transaction binding supports wallet-token cases');
select ok((select card_wallet_used and nayax_match_execution_eligible
  from public.refund_cases where id='fb150000-0000-4000-8000-000000000001'),
  'Wallet manager confirmation remains execution eligible without becoming automatic evidence');

update public.refund_cases set status='card_refund_pending'
where id='fb150000-0000-4000-8000-000000000001';
select ok((select public.refund_nayax_retry_safe_case_is_current(c)
  from public.refund_cases c where id='fb150000-0000-4000-8000-000000000001'),
  'Retry-safe recovery recognizes manager-confirmed wallet evidence while retaining every payment guard');
select ok((select card_wallet_used and public.refund_nayax_retry_safe_case_is_current(c)
  from public.refund_cases c where id='fb150000-0000-4000-8000-000000000001'),
  'Wallet classification does not block retry-safe review of the exact selected transaction');

update public.refund_cases set incident_time_resolution='ambiguous',incident_time_confidence='rough'
where id='fb150000-0000-4000-8000-000000000001';
select is(public.refund_nayax_candidate_identifier_evidence_state(
  'fb150000-0000-4000-8000-000000000001','fb140000-0000-4000-8000-000000000001',14,
  '2026-09-05T18:05:00.123Z',1090,'6768','USD',
  pg_temp.soft_time_evidence('occurrence_time_uncertain','2026-09-05T18:05:00Z')
), 'valid',
  'Uncertain customer-time resolution does not block an otherwise independently identified exact-card purchase');

update public.refund_cases set card_last4=null,card_last4_provenance=null,card_last4_source=null
where id='fb150000-0000-4000-8000-000000000001';
select ok(
  public.refund_nayax_candidate_identifier_evidence_state(
    'fb150000-0000-4000-8000-000000000001','fb140000-0000-4000-8000-000000000001',14,
    '2026-09-05T18:05:00.123Z',1090,'6768','USD',
    pg_temp.soft_time_evidence('occurrence_time_uncertain','2026-09-05T18:05:00Z')
  ) = 'valid'
  and (pg_temp.soft_time_evidence('occurrence_time_uncertain','2026-09-05T18:05:00Z')->>'selection_allowed')::boolean is false
  and pg_temp.soft_time_evidence('occurrence_time_uncertain','2026-09-05T18:05:00Z')->'customer_correction_fields' = '["incident_time"]'::jsonb,
  'Machine and amount with rough unresolved time remains explicitly nonselectable and asks only for incident time');

-- A separate case proves an interrupted approval can be continued by another
-- currently mapped manager without rewriting the original business decision.
insert into public.refund_cases(id,public_reference,reporting_machine_id,reporting_location_id,customer_email,
  issue_summary,incident_at,incident_local_datetime,incident_timezone,incident_time_resolution,incident_time_confidence,
  incident_time_source,nearby_attempt_count,payment_method,payment_amount_cents,refund_amount_cents,
  card_last4,card_last4_provenance,card_last4_source,payment_interaction,status,correlation_status,
  deterministic_fact_version,intake_source,intake_meta,customer_request_received_at,
  customer_request_received_source,nayax_refund_attempt_generation)
values('fb150000-0000-4000-8000-000000000002','RF-SOFT-HANDOFF','fb140000-0000-4000-8000-000000000001',
  'fb130000-0000-4000-8000-000000000001','soft-handoff-customer@example.invalid','Approved refund handoff',
  '2026-09-05T18:02:00Z','2026-09-05T11:02','America/Los_Angeles','exact','exact',
  'transaction_alert_or_receipt','one','card',1090,1090,'6768','physical_card','physical_card','tap_card',
  'needs_review','needs_nayax',4,'form','{"source":"hosted_refund_intake"}',
  '2026-09-05T18:03:00Z','hosted_refund_intake',1);
create temp table soft_time_handoff_lookup_claim as
select (public.service_begin_refund_nayax_lookup(
  'fb150000-0000-4000-8000-000000000002',4,'manual',
  'fb110000-0000-4000-8000-000000000001')->>'lookupGeneration')::bigint generation;
insert into public.refund_nayax_lookup_candidates(token,refund_case_id,lookup_generation,actor_user_id,
  reporting_machine_id,provider_transaction_id,site_id,machine_authorization_time,amount_cents,card_last4,
  currency_code,evidence_summary,expires_at)
select 'fb160000-0000-4000-8000-000000000006','fb150000-0000-4000-8000-000000000002',generation,
  'fb110000-0000-4000-8000-000000000001','fb140000-0000-4000-8000-000000000001',
  'OFFLINE-HANDOFF-AUTH',15,'2026-09-05T18:05:00.123Z',1090,'6768','USD',
  pg_temp.soft_time_evidence('occurrence_time_uncertain','2026-09-05T18:05:00Z',
    false,null,null,null,null,'fb150000-0000-4000-8000-000000000002'),
  statement_timestamp()+interval '1 hour' from soft_time_handoff_lookup_claim;
select public.service_commit_refund_nayax_lookup('fb150000-0000-4000-8000-000000000002',
  (select generation from soft_time_handoff_lookup_claim),4,'manual_exception','manual_exception',
  '2026-09-05.v11',statement_timestamp(),'One exact purchase for handoff',null,1,
  'manual','fb110000-0000-4000-8000-000000000001');

-- Model a prior released generation. A fresh explicit approval below creates
-- the only current marker; this superseded marker must not permanently block
-- the mature definitive-no-refund retry path.
insert into public.refund_case_events(refund_case_id,actor_user_id,event_type,message,metadata,created_at)
values('fb150000-0000-4000-8000-000000000002','fb110000-0000-4000-8000-000000000001',
  'nayax_refund_execution_authorized','Superseded released-generation approval fixture',
  jsonb_build_object(
    'schema_version','nayax-selection-approval-v1','case_version',0,
    'deterministic_fact_version',3,'attempt_generation',0,
    'transaction_id','OFFLINE-HANDOFF-AUTH','site_id',15,
    'machine_authorization_time','2026-09-05T18:05:00.123Z',
    'amount_cents',1090,'card_last4','6768','currency_code','USD',
    'authorization_id','fb170000-0000-4000-8000-000000000099','payload_redacted',true
  ),statement_timestamp()-interval '1 day');

create temp table soft_time_handoff_approval_receipt(authorization_id uuid primary key);
grant select,insert on table pg_temp.soft_time_handoff_approval_receipt to authenticated,service_role;
set local role authenticated;
select pg_temp.set_auth_claims('fb110000-0000-4000-8000-000000000001');
insert into pg_temp.soft_time_handoff_approval_receipt(authorization_id)
select (public.admin_authorize_refund_official_action(
  'fb150000-0000-4000-8000-000000000002','approve',
  (select official_action_version from public.refund_cases
    where id='fb150000-0000-4000-8000-000000000002'),
  'card_refund_pending','approved',null,'customer_owed',null,1090,null,null,false,
  'fb160000-0000-4000-8000-000000000006','customer_confirmation'
)->>'authorizationId')::uuid;
reset role;
set local role service_role;
select public.service_apply_refund_nayax_selection_approval(
  (select authorization_id from pg_temp.soft_time_handoff_approval_receipt),
  'fb150000-0000-4000-8000-000000000002',null,'customer_owed',null,1090,
  'fb160000-0000-4000-8000-000000000006','customer_confirmation');
reset role;

create temp table soft_time_handoff_before as
select decided_by,decided_at,public.refund_nayax_selected_execution_context(id) execution_context
from public.refund_cases where id='fb150000-0000-4000-8000-000000000002';
create temp table soft_time_handoff_result(result jsonb);
grant select on table pg_temp.soft_time_handoff_before to service_role;
grant select,insert on table pg_temp.soft_time_handoff_result to service_role;
set local role service_role;
insert into pg_temp.soft_time_handoff_result(result)
select public.service_reserve_nayax_refund_manager_action_v3(
  'soft-time-executor','fb110000-0000-4000-8000-000000000002',
  'fb150000-0000-4000-8000-000000000002',(execution_context->>'caseVersion')::bigint,
  'nayax-refund-'||repeat('a',64),1090,null,null,'USD',
  'nayax-production-account-contract-v2','nayax-provider-journal-v3',
  execution_context->>'contextHash'
) from pg_temp.soft_time_handoff_before;
reset role;
select is((select result#>>'{attempt,shouldExecute}' from pg_temp.soft_time_handoff_result),'true',
  'A fresh explicit approval reserves one guarded attempt despite a superseded released-generation marker');
select ok((select refund_case.decided_by=prior.decided_by
    and refund_case.decided_at=prior.decided_at
  from public.refund_cases refund_case cross join pg_temp.soft_time_handoff_before prior
  where refund_case.id='fb150000-0000-4000-8000-000000000002'),
  'Execution handoff preserves the original business approver and approval time');
select ok((select count(*)=1 and bool_and(actor_user_id='fb110000-0000-4000-8000-000000000001')
  from public.refund_case_events
  where refund_case_id='fb150000-0000-4000-8000-000000000002'
    and event_type='official_action_committed' and metadata->>'action'='approve'),
  'The case retains exactly one ordinary approval event attributed to the deciding manager');
select ok((select count(*)=1
    and bool_and(actor_user_id='fb110000-0000-4000-8000-000000000002')
    and bool_and((metadata->>'business_approval_reused')::boolean)
  from public.refund_case_events
  where refund_case_id='fb150000-0000-4000-8000-000000000002'
    and event_type='nayax_refund_execution_continued'),
  'The handoff manager is audited separately as continuing execution under the saved approval');
select ok((select count(*)=1
    and bool_and(actor_user_id='fb110000-0000-4000-8000-000000000002')
  from public.refund_case_nayax_refund_attempts
  where refund_case_id='fb150000-0000-4000-8000-000000000002'),
  'The durable attempt records the current executor without rewriting the business decision');
select is(public.refund_nayax_current_manager_approval_pending(
  'fb110000-0000-4000-8000-000000000002','fb150000-0000-4000-8000-000000000002'),false,
  'A created attempt ends automatic approval resumption and moves the case to outcome inspection');

-- The mature retry path may have only a superseded approval marker after a
-- definitive no-refund release and generation advance. A new explicit manager
-- action must remain able to reserve once without treating that old marker as
-- a current interrupted approval.
insert into public.refund_cases(id,public_reference,reporting_machine_id,reporting_location_id,customer_email,
  issue_summary,incident_at,incident_local_datetime,incident_timezone,incident_time_resolution,incident_time_confidence,
  incident_time_source,nearby_attempt_count,payment_method,payment_amount_cents,refund_amount_cents,
  card_last4,card_last4_provenance,card_last4_source,payment_interaction,status,decision,decision_reason,
  decided_by,decided_at,correlation_status,correlation_source,matched_nayax_transaction_id,matched_nayax_site_id,
  matched_nayax_machine_auth_time,matched_nayax_amount_cents,matched_nayax_card_last4,matched_nayax_currency_code,
  nayax_recommendation_state,nayax_recommendation_policy_version,nayax_recommendation_evaluated_at,
  nayax_match_execution_eligible,nayax_refund_execution_status,nayax_lookup_generation,
  nayax_refund_attempt_generation,deterministic_fact_version,intake_source,intake_meta,
  customer_request_received_at,customer_request_received_source)
values('fb150000-0000-4000-8000-000000000003','RF-SOFT-RETRY','fb140000-0000-4000-8000-000000000001',
  'fb130000-0000-4000-8000-000000000001','soft-retry-customer@example.invalid','Released retry fixture',
  '2026-09-05T18:02:00Z','2026-09-05T11:02','America/Los_Angeles','exact','exact',
  'transaction_alert_or_receipt','one','card',1090,1090,'6768','physical_card','physical_card','tap_card',
  'card_refund_pending','approved','customer_owed','fb110000-0000-4000-8000-000000000002',statement_timestamp(),
  'matched','nayax','OFFLINE-RETRY-AUTH',16,'2026-09-05T18:05:00.123Z',1090,'6768','USD',
  'high_confidence','2026-09-05.v11',statement_timestamp(),true,'not_requested',2,1,4,'form',
  '{"source":"hosted_refund_intake"}','2026-09-05T18:03:00Z','hosted_refund_intake');
insert into public.refund_nayax_lookup_candidates(token,refund_case_id,lookup_generation,actor_user_id,
  reporting_machine_id,provider_transaction_id,site_id,machine_authorization_time,amount_cents,card_last4,
  currency_code,evidence_summary,expires_at)
values('fb160000-0000-4000-8000-000000000007','fb150000-0000-4000-8000-000000000003',2,
  'fb110000-0000-4000-8000-000000000002','fb140000-0000-4000-8000-000000000001',
  'OFFLINE-RETRY-AUTH',16,'2026-09-05T18:05:00.123Z',1090,'6768','USD',
  pg_temp.soft_time_evidence('occurrence_time_uncertain','2026-09-05T18:05:00Z',
    false,null,null,null,null,'fb150000-0000-4000-8000-000000000003'),
  statement_timestamp()+interval '1 hour');
insert into public.refund_case_events(refund_case_id,actor_user_id,event_type,message,metadata,created_at)
values
  ('fb150000-0000-4000-8000-000000000003','fb110000-0000-4000-8000-000000000001',
   'nayax_refund_execution_authorized','Released prior-generation approval',jsonb_build_object(
     'schema_version','nayax-selection-approval-v1','case_version',0,'deterministic_fact_version',3,
     'attempt_generation',0,'transaction_id','OFFLINE-RETRY-AUTH','site_id',16,
     'machine_authorization_time','2026-09-05T18:05:00.123Z','amount_cents',1090,
     'card_last4','6768','currency_code','USD','authorization_id',
     'fb170000-0000-4000-8000-000000000098','payload_redacted',true),
   statement_timestamp()-interval '1 day'),
  ('fb150000-0000-4000-8000-000000000003','fb110000-0000-4000-8000-000000000002',
   'nayax_match_selected','Fresh explicit selection after definitive no-refund release',
   '{"payload_redacted":true}'::jsonb,statement_timestamp());
create temp table soft_time_retry_context as
select public.refund_nayax_selected_execution_context('fb150000-0000-4000-8000-000000000003') value;
create temp table soft_time_retry_result(result jsonb);
grant select on table pg_temp.soft_time_retry_context to service_role;
grant select,insert on table pg_temp.soft_time_retry_result to service_role;
set local role service_role;
insert into pg_temp.soft_time_retry_result(result)
select public.service_reserve_nayax_refund_manager_action_v3(
  'soft-time-executor','fb110000-0000-4000-8000-000000000002',
  'fb150000-0000-4000-8000-000000000003',(value->>'caseVersion')::bigint,
  'nayax-refund-'||repeat('c',64),1090,null,null,'USD',
  'nayax-production-account-contract-v2','nayax-provider-journal-v3',value->>'contextHash'
) from pg_temp.soft_time_retry_context;
reset role;
select is((select result#>>'{attempt,shouldExecute}' from pg_temp.soft_time_retry_result),'true',
  'Only a superseded marker does not block one fresh explicit retry reservation');
select ok((select count(*)=1
    and bool_and(actor_user_id='fb110000-0000-4000-8000-000000000002')
  from public.refund_case_events
  where refund_case_id='fb150000-0000-4000-8000-000000000003'
    and event_type='official_action_committed' and metadata->>'action'='nayax_execute'),
  'The fresh retry records one current ordinary execution approval instead of reusing the old marker');

select * from finish();
rollback;
