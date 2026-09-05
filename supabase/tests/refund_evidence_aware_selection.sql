begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(28);

insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data)
values('fe110000-0000-4000-8000-000000000001','authenticated','authenticated',
  'identifier-manager@example.invalid','{}','{}');
insert into public.customer_accounts(id,name,account_type)
values('fe120000-0000-4000-8000-000000000001','Identifier evidence fixture','internal');
insert into public.reporting_locations(id,account_id,name,timezone)
values('fe130000-0000-4000-8000-000000000001','fe120000-0000-4000-8000-000000000001',
  'Identifier evidence location','America/Los_Angeles');
insert into public.reporting_machines(id,account_id,location_id,machine_label,status,
  nayax_machine_id,nayax_account_key,nayax_refunds_enabled)
values('fe140000-0000-4000-8000-000000000001','fe120000-0000-4000-8000-000000000001',
  'fe130000-0000-4000-8000-000000000001','Identifier evidence machine','active',
  'IDENTIFIER-MACHINE','IDENTIFIER_ACCOUNT',true);
insert into public.reporting_machine_refund_managers(
  reporting_machine_id,manager_user_id,manager_email,grant_reason
) values('fe140000-0000-4000-8000-000000000001','fe110000-0000-4000-8000-000000000001',
  'identifier-manager@example.invalid','Fixture');
insert into public.refund_nayax_machine_inventory(account_key,nayax_machine_id,reporting_machine_id)
values('IDENTIFIER_ACCOUNT','IDENTIFIER-MACHINE','fe140000-0000-4000-8000-000000000001');

insert into public.refund_cases(id,public_reference,reporting_machine_id,reporting_location_id,
  customer_email,issue_summary,incident_at,incident_timezone,incident_time_resolution,
  incident_time_confidence,incident_time_source,payment_method,payment_amount_cents,refund_amount_cents,
  card_last4,card_last4_provenance,card_last4_source,card_network,card_wallet_used,
  payment_interaction,nearby_attempt_count,status,correlation_status,deterministic_fact_version,
  intake_source,intake_meta,customer_request_received_at,customer_request_received_source)
values
 ('fe150000-0000-4000-8000-000000000001','RF-IDENTIFIER-REVIEW','fe140000-0000-4000-8000-000000000001',
  'fe130000-0000-4000-8000-000000000001','review-customer@example.invalid','Evidence-aware review',
  '2026-09-05T18:00:00Z','America/Los_Angeles','exact','within_15_minutes','transaction_alert_or_receipt',
  'card',1090,1090,'6768','physical_card','physical_card',null,false,'tap_card','one',
  'needs_review','needs_nayax',4,'form','{}','2026-09-05T20:00:00Z','hosted_refund_intake'),
 ('fe150000-0000-4000-8000-000000000002','RF-IDENTIFIER-AMBIGUOUS','fe140000-0000-4000-8000-000000000001',
  'fe130000-0000-4000-8000-000000000001','ambiguous-customer@example.invalid','Evidence-aware ambiguity',
  '2026-09-05T18:00:00Z','America/Los_Angeles','exact','within_15_minutes','transaction_alert_or_receipt',
  'card',1090,1090,'6768','physical_card','physical_card',null,false,'tap_card','one',
  'needs_review','needs_nayax',4,'form','{}','2026-09-05T20:00:00Z','hosted_refund_intake'),
 ('fe150000-0000-4000-8000-000000000003','RF-IDENTIFIER-MULTIPLE','fe140000-0000-4000-8000-000000000001',
  'fe130000-0000-4000-8000-000000000001','multiple-customer@example.invalid','Multiple nearby attempts',
  '2026-09-05T18:00:00Z','America/Los_Angeles','exact','within_15_minutes','transaction_alert_or_receipt',
  'card',1090,1090,'6768','physical_card','physical_card',null,false,'tap_card','multiple',
  'needs_review','needs_nayax',4,'form','{}',null,null),
 ('fe150000-0000-4000-8000-000000000004','RF-IDENTIFIER-READONLY','fe140000-0000-4000-8000-000000000001',
  'fe130000-0000-4000-8000-000000000001','readonly-customer@example.invalid','Read-only provider evidence',
  '2026-09-05T18:00:00Z','America/Los_Angeles','exact','within_15_minutes','transaction_alert_or_receipt',
  'card',1090,1090,'6768','physical_card','physical_card',null,false,'tap_card','one',
  'needs_review','needs_nayax',4,'form','{}','2026-09-05T20:00:00Z','hosted_refund_intake');

create function pg_temp.identifier_evidence(
  case_id uuid,
  authorized_at timestamptz,
  recommended boolean
) returns jsonb language sql stable as $$
  select jsonb_build_object(
    'selection_allowed',true,'is_recommended',recommended,'one_click_eligible',false,
    'recommendation_state',case when recommended then 'manual_exception' else 'ambiguous' end,
    'confidence_class',case when recommended then 'evidence_aware_review' else 'ambiguous_manual' end,
    'policy_version','2026-09-05.v9','identifier_policy_version','2026-09-05.identifier.v1',
    'customer_fact_version',c.deterministic_fact_version,
    'customer_credential_class','customer_physical_contactless_pan',
    'provider_identifier_class','last_sales_contactless_identifier_unverified',
    'card_last4_comparison','mismatch_neutral_unproven_scope','card_network_comparison','missing',
    'payment_interaction_comparison','supporting','same_identifier_equivalence_proven',false,
    'identifier_review_state','reviewable_uncertainty','customer_correction_fields','[]'::jsonb,
    'hard_exclusions','[]'::jsonb,'manual_review_reasons','["card_last4_mismatch_reviewable"]'::jsonb,
    'reason_codes','["machine_exact","amount_exact","incident_time_within_60m","card_last4_mismatch"]'::jsonb,
    'match_factors','[]'::jsonb,'match_reason','Exact machine and amount; close time; identifier mismatch needs review',
    'recommendation_rank',1,'lookup_account_scope','IDENTIFIER_ACCOUNT',
    'lookup_provider_machine_id','IDENTIFIER-MACHINE','provider_machine_id','IDENTIFIER-MACHINE',
    'machine_authorization_time_raw','2026-09-05T11:15:00','machine_authorization_time_source','MachineAuthorizationTime',
    'machine_time_resolution','exact','provider_time_resolution','exact','provider_time_source','authorization_gmt',
    'authorized_at',authorized_at,'customer_request_received_at',c.customer_request_received_at,
    'customer_request_received_source',c.customer_request_received_source,
    'request_time_boundary','before_or_at_request','transaction_occurrence_comparable',true
    ,'payment_status','approved','payment_status_evidence','last_sales_contract',
    'provider_refund_state','clear','duplicate_provider_record',false,
    'amount_delta_cents',0,'time_delta_minutes',
      ceil(abs(extract(epoch from (authorized_at-c.incident_at)))/60.0)::integer
  ) from public.refund_cases c where c.id=case_id;
$$;

create function pg_temp.exact_identifier_evidence(
  case_id uuid,
  authorized_at timestamptz,
  amount_delta integer,
  selection_allowed boolean,
  payment_status text default 'approved'
) returns jsonb language sql stable as $$
  select pg_temp.identifier_evidence(case_id,authorized_at,false) || jsonb_build_object(
    'selection_allowed',selection_allowed,'one_click_eligible',false,
    'customer_credential_class','customer_physical_contactless_pan',
    'provider_identifier_class','last_sales_contactless_identifier_unverified',
    'card_last4_comparison','exact_support','card_network_comparison','missing',
    'payment_interaction_comparison','supporting','identifier_review_state','exact_support',
    'customer_correction_fields','[]'::jsonb,'amount_delta_cents',amount_delta,
    'payment_status',payment_status,
    'payment_status_evidence',case when payment_status='approved' then 'last_sales_contract' else null end
  );
$$;

select is(public.refund_nayax_identifier_evidence_state(4,
  pg_temp.identifier_evidence('fe150000-0000-4000-8000-000000000001','2026-09-05T18:15:00Z',true)),
  'valid','A current reviewable mismatch is valid evidence');
select is(public.refund_nayax_identifier_evidence_state(4,
  pg_temp.identifier_evidence('fe150000-0000-4000-8000-000000000001','2026-09-05T18:15:00Z',true)
    || '{"hard_exclusions":["card_last4_mismatch"]}'::jsonb),
  'invalid','Identifier mismatch can never return as a hard exclusion');
select is(public.refund_nayax_identifier_evidence_state(4,
  pg_temp.identifier_evidence('fe150000-0000-4000-8000-000000000001','2026-09-05T18:15:00Z',true)
    || '{"hard_exclusions":["already_refunded"]}'::jsonb),
  'invalid','No selectable current evidence can retain any hard exclusion');
select is(public.refund_nayax_identifier_evidence_state(4,
  pg_temp.identifier_evidence('fe150000-0000-4000-8000-000000000001','2026-09-05T18:15:00Z',true)
    || '{"one_click_eligible":true}'::jsonb),
  'invalid','Identifier mismatch can never become one-click evidence');
select is(public.refund_nayax_identifier_evidence_state(5,
  pg_temp.identifier_evidence('fe150000-0000-4000-8000-000000000001','2026-09-05T18:15:00Z',true)),
  'stale','Evidence is bound to the exact customer fact version');
select is(public.refund_nayax_identifier_evidence_state(4,
  pg_temp.identifier_evidence('fe150000-0000-4000-8000-000000000001','2026-09-05T18:15:00Z',true)
    || '{"policy_version":"2026-09-05.v8"}'::jsonb),
  'refresh','A current-shaped identifier object cannot downgrade itself to the legacy contract');
select is(public.refund_nayax_identifier_evidence_state(4,
  (pg_temp.identifier_evidence('fe150000-0000-4000-8000-000000000001','2026-09-05T18:15:00Z',true)
    - array['identifier_policy_version','customer_fact_version','customer_credential_class',
      'provider_identifier_class','card_last4_comparison','card_network_comparison',
      'payment_interaction_comparison','same_identifier_equivalence_proven',
      'identifier_review_state','customer_correction_fields'])
    || '{"policy_version":"2026-09-05.v8"}'::jsonb),
  'legacy','The actual known pre-v9 evidence shape keeps its existing contract');
select is(public.refund_nayax_identifier_evidence_state(4,
  (pg_temp.identifier_evidence('fe150000-0000-4000-8000-000000000001','2026-09-05T18:15:00Z',true)
    - array['identifier_policy_version','customer_fact_version','customer_credential_class',
      'provider_identifier_class','card_last4_comparison','card_network_comparison',
      'payment_interaction_comparison','same_identifier_equivalence_proven',
      'identifier_review_state','customer_correction_fields'])
    || '{"policy_version":"2026-08-26.v5"}'::jsonb),
  'legacy_readonly','Older immutable lookup evidence remains readable but cannot regain selection authority');
select is(public.refund_nayax_identifier_evidence_state(4,
  pg_temp.identifier_evidence('fe150000-0000-4000-8000-000000000001','2026-09-05T18:15:00Z',true)
    - 'identifier_policy_version'),
  'refresh','Current v9 evidence cannot bypass identifier validation by omitting its policy version');

create temp table parity_claim as
select (public.service_begin_refund_nayax_lookup('fe150000-0000-4000-8000-000000000004',4,'manual',
  'fe110000-0000-4000-8000-000000000001')->>'lookupGeneration')::bigint generation;
select lives_ok($$insert into public.refund_nayax_lookup_candidates(token,refund_case_id,lookup_generation,
 actor_user_id,reporting_machine_id,provider_transaction_id,site_id,machine_authorization_time,
 amount_cents,card_last4,currency_code,evidence_summary,expires_at)
select 'fe160000-0000-4000-8000-000000000007','fe150000-0000-4000-8000-000000000004',generation,
 'fe110000-0000-4000-8000-000000000001','fe140000-0000-4000-8000-000000000001',
 'IDENTIFIER-MISSING-SITE-READONLY',null,'2026-09-05T18:15:00Z',1090,'6768','USD',
 pg_temp.exact_identifier_evidence('fe150000-0000-4000-8000-000000000004','2026-09-05T18:15:00Z',0,false),
 statement_timestamp()+interval '1 hour' from parity_claim$$,
 'Exact-suffix evidence with no provider site persists read-only');
select lives_ok($$insert into public.refund_nayax_lookup_candidates(token,refund_case_id,lookup_generation,
 actor_user_id,reporting_machine_id,provider_transaction_id,site_id,machine_authorization_time,
 amount_cents,card_last4,currency_code,evidence_summary,expires_at)
select 'fe160000-0000-4000-8000-000000000008','fe150000-0000-4000-8000-000000000004',generation,
 'fe110000-0000-4000-8000-000000000001','fe140000-0000-4000-8000-000000000001',
 'IDENTIFIER-UNKNOWN-STATUS-READONLY',11,'2026-09-05T18:15:00Z',1090,'6768','USD',
 pg_temp.exact_identifier_evidence('fe150000-0000-4000-8000-000000000004','2026-09-05T18:15:00Z',0,false,null),
 statement_timestamp()+interval '1 hour' from parity_claim$$,
 'Exact-suffix evidence with unconfirmed provider status persists read-only');
select lives_ok($$insert into public.refund_nayax_lookup_candidates(token,refund_case_id,lookup_generation,
 actor_user_id,reporting_machine_id,provider_transaction_id,site_id,machine_authorization_time,
 amount_cents,card_last4,currency_code,evidence_summary,expires_at)
select 'fe160000-0000-4000-8000-000000000009','fe150000-0000-4000-8000-000000000004',generation,
 'fe110000-0000-4000-8000-000000000001','fe140000-0000-4000-8000-000000000001',
 'IDENTIFIER-NEAR-AMOUNT',12,'2026-09-05T18:15:00Z',1380,'6768','USD',
 pg_temp.exact_identifier_evidence('fe150000-0000-4000-8000-000000000004','2026-09-05T18:15:00Z',290,true),
 statement_timestamp()+interval '1 hour' from parity_claim$$,
 'Exact-suffix amount within the established tolerance remains selectable');
select lives_ok($$insert into public.refund_nayax_lookup_candidates(token,refund_case_id,lookup_generation,
 actor_user_id,reporting_machine_id,provider_transaction_id,site_id,machine_authorization_time,
 amount_cents,card_last4,currency_code,evidence_summary,expires_at)
select 'fe160000-0000-4000-8000-000000000010','fe150000-0000-4000-8000-000000000004',generation,
 'fe110000-0000-4000-8000-000000000001','fe140000-0000-4000-8000-000000000001',
 'IDENTIFIER-OUTSIDE-AMOUNT',13,'2026-09-05T18:15:00Z',1400,'6768','USD',
 pg_temp.exact_identifier_evidence('fe150000-0000-4000-8000-000000000004','2026-09-05T18:15:00Z',310,false),
 statement_timestamp()+interval '1 hour' from parity_claim$$,
 'Exact-suffix amount outside the tolerance persists read-only');
select throws_ok($$insert into public.refund_nayax_lookup_candidates(token,refund_case_id,lookup_generation,
 actor_user_id,reporting_machine_id,provider_transaction_id,site_id,machine_authorization_time,
 amount_cents,card_last4,currency_code,evidence_summary,expires_at)
select 'fe160000-0000-4000-8000-000000000011','fe150000-0000-4000-8000-000000000004',generation,
 'fe110000-0000-4000-8000-000000000001','fe140000-0000-4000-8000-000000000001',
 'IDENTIFIER-MISSING-SITE-FORGED',null,'2026-09-05T18:15:00Z',1090,'6768','USD',
 pg_temp.exact_identifier_evidence('fe150000-0000-4000-8000-000000000004','2026-09-05T18:15:00Z',0,true),
 statement_timestamp()+interval '1 hour' from parity_claim$$,
 'P4626','Invalid Nayax identifier evidence',
 'The database rejects a scorer claim that missing-site evidence is selectable');

create temp table review_claim as
select (public.service_begin_refund_nayax_lookup('fe150000-0000-4000-8000-000000000001',4,'manual',
  'fe110000-0000-4000-8000-000000000001')->>'lookupGeneration')::bigint generation;
select lives_ok($$insert into public.refund_nayax_lookup_candidates(token,refund_case_id,lookup_generation,
 actor_user_id,reporting_machine_id,provider_transaction_id,site_id,machine_authorization_time,
 amount_cents,card_last4,currency_code,evidence_summary,expires_at)
select 'fe160000-0000-4000-8000-000000000001','fe150000-0000-4000-8000-000000000001',generation,
 'fe110000-0000-4000-8000-000000000001','fe140000-0000-4000-8000-000000000001',
 'IDENTIFIER-REVIEW-TX',7,'2026-09-05T18:15:00Z',1090,'3760','USD',
 pg_temp.identifier_evidence('fe150000-0000-4000-8000-000000000001','2026-09-05T18:15:00Z',true),
 statement_timestamp()+interval '1 hour' from review_claim$$,
  'A card-suffix mismatch remains selectable for one manager review');
select throws_ok($$insert into public.refund_nayax_lookup_candidates(token,refund_case_id,lookup_generation,
 actor_user_id,reporting_machine_id,provider_transaction_id,site_id,machine_authorization_time,
 amount_cents,card_last4,currency_code,evidence_summary,expires_at)
select 'fe160000-0000-4000-8000-000000000004','fe150000-0000-4000-8000-000000000001',generation,
 'fe110000-0000-4000-8000-000000000001','fe140000-0000-4000-8000-000000000001',
 'IDENTIFIER-FORGED-AMOUNT',7,'2026-09-05T18:15:00Z',999,'3760','USD',
 pg_temp.identifier_evidence('fe150000-0000-4000-8000-000000000001','2026-09-05T18:15:00Z',true),
 statement_timestamp()+interval '1 hour' from review_claim$$,
 'P4626','Invalid Nayax identifier evidence',
 'A selectable mismatch cannot forge exact-amount evidence against the candidate row');
select throws_ok($$insert into public.refund_nayax_lookup_candidates(token,refund_case_id,lookup_generation,
 actor_user_id,reporting_machine_id,provider_transaction_id,site_id,machine_authorization_time,
 amount_cents,card_last4,currency_code,evidence_summary,expires_at)
select 'fe160000-0000-4000-8000-000000000005','fe150000-0000-4000-8000-000000000001',generation,
 'fe110000-0000-4000-8000-000000000001','fe140000-0000-4000-8000-000000000001',
 'IDENTIFIER-MISSING-SITE',null,'2026-09-05T18:15:00Z',1090,'3760','USD',
 pg_temp.identifier_evidence('fe150000-0000-4000-8000-000000000001','2026-09-05T18:15:00Z',true),
 statement_timestamp()+interval '1 hour' from review_claim$$,
 'P4626','Invalid Nayax identifier evidence',
  'A selectable mismatch requires the provider site identity used by exact binding');

create temp table readonly_claim as
select (public.service_begin_refund_nayax_lookup('fe150000-0000-4000-8000-000000000003',4,'manual',
  'fe110000-0000-4000-8000-000000000001')->>'lookupGeneration')::bigint generation;
select lives_ok($$insert into public.refund_nayax_lookup_candidates(token,refund_case_id,lookup_generation,
 actor_user_id,reporting_machine_id,provider_transaction_id,site_id,machine_authorization_time,
 amount_cents,card_last4,currency_code,evidence_summary,expires_at)
select 'fe160000-0000-4000-8000-000000000006','fe150000-0000-4000-8000-000000000003',generation,
 'fe110000-0000-4000-8000-000000000001','fe140000-0000-4000-8000-000000000001',
 'IDENTIFIER-READONLY-TX',10,'2026-09-05T18:15:00Z',1090,'3760','USD',
 (pg_temp.identifier_evidence('fe150000-0000-4000-8000-000000000003','2026-09-05T18:15:00Z',true)
   - array['identifier_policy_version','customer_fact_version','customer_credential_class',
     'provider_identifier_class','card_last4_comparison','card_network_comparison',
     'payment_interaction_comparison','same_identifier_equivalence_proven',
     'identifier_review_state','customer_correction_fields'])
   || '{"policy_version":"2026-08-26.v5"}'::jsonb,
 statement_timestamp()+interval '1 hour' from readonly_claim$$,
 'Historical pre-v8 evidence can load without changing its immutable audit row');
select is((public.service_commit_refund_nayax_lookup('fe150000-0000-4000-8000-000000000003',
  (select generation from readonly_claim),4,'manual_exception','manual_exception','2026-08-26.v5',
  statement_timestamp(),'Historical evidence requires refresh',null,1,'manual',
  'fe110000-0000-4000-8000-000000000001')->>'applied'),'true',
  'Historical read-only evidence can complete its lookup lifecycle');
set local role service_role;
select throws_ok(format($$select public.service_select_refund_nayax_candidate_as_actor(
  'fe110000-0000-4000-8000-000000000001','fe150000-0000-4000-8000-000000000003',%s,
  'fe160000-0000-4000-8000-000000000006',null)$$,
  (select official_action_version from public.refund_cases where id='fe150000-0000-4000-8000-000000000003')),
  'P4626','Refresh Nayax transactions to use current identifier evidence',
  'Historical pre-v8 evidence cannot create a new exact transaction binding');
reset role;
select is(public.refund_nayax_candidate_identifier_evidence_state(
  'fe150000-0000-4000-8000-000000000003','fe140000-0000-4000-8000-000000000001',8,
  '2026-09-05T18:15:00Z',1090,'3760','USD',
  pg_temp.identifier_evidence('fe150000-0000-4000-8000-000000000003','2026-09-05T18:15:00Z',false)),
  'invalid','Multiple remembered nearby attempts cannot become the single reviewable mismatch');
select is(public.refund_nayax_candidate_identifier_evidence_state(
  'fe150000-0000-4000-8000-000000000001','fe140000-0000-4000-8000-000000000001',8,
  '2026-09-05T18:15:00Z',1090,'3760','USD',
  pg_temp.identifier_evidence('fe150000-0000-4000-8000-000000000001','2026-09-05T18:15:00Z',false)
    || '{"customer_credential_class":"customer_wallet_device_token"}'::jsonb),
  'invalid','Current payment interaction, provenance, source and wallet facts bind the credential class');
select is((public.service_commit_refund_nayax_lookup('fe150000-0000-4000-8000-000000000001',
  (select generation from review_claim),4,'manual_exception','manual_exception','2026-09-05.v9',
  statement_timestamp(),'One transaction needs manager review',null,1,'manual',
  'fe110000-0000-4000-8000-000000000001')->>'applied'),'true',
  'The reviewable lookup commits through the generation guard');
set local role service_role;
select is((public.service_select_refund_nayax_candidate_as_actor(
  'fe110000-0000-4000-8000-000000000001','fe150000-0000-4000-8000-000000000001',
  (select official_action_version from public.refund_cases where id='fe150000-0000-4000-8000-000000000001'),
  'fe160000-0000-4000-8000-000000000001',null)->>'selectionApplied'),'true',
  'One recommended reviewable uncertainty needs no redundant disagreement reason');
reset role;
select ok((select matched_nayax_transaction_id='IDENTIFIER-REVIEW-TX'
  and nayax_match_execution_eligible=false from public.refund_cases
  where id='fe150000-0000-4000-8000-000000000001'),
  'Manager selection binds the exact transaction and cannot enable one-click execution');
select ok((select count(*)=1 and bool_and((metadata->>'payload_redacted')::boolean)
  and bool_and(metadata->'corroboration_codes' @> '["machine_exact","amount_exact","approved_sale",
    "occurrence_time_within_60m","customer_time_from_alert_or_receipt","customer_reports_one_nearby_attempt"]'::jsonb)
  and bool_and(not (metadata ? 'provider_transaction_id'))
  from public.refund_case_events where refund_case_id='fe150000-0000-4000-8000-000000000001'
    and event_type='nayax_identifier_evidence_selected'),
  'Selection writes one redacted durable identifier-evidence event');

create temp table ambiguous_claim as
select (public.service_begin_refund_nayax_lookup('fe150000-0000-4000-8000-000000000002',4,'manual',
  'fe110000-0000-4000-8000-000000000001')->>'lookupGeneration')::bigint generation;
insert into public.refund_nayax_lookup_candidates(token,refund_case_id,lookup_generation,
 actor_user_id,reporting_machine_id,provider_transaction_id,site_id,machine_authorization_time,
 amount_cents,card_last4,currency_code,evidence_summary,expires_at)
select token,'fe150000-0000-4000-8000-000000000002',generation,
 'fe110000-0000-4000-8000-000000000001','fe140000-0000-4000-8000-000000000001',transaction_id,site_id,
 authorized_at,1090,last4,'USD',
 pg_temp.identifier_evidence('fe150000-0000-4000-8000-000000000002',authorized_at,false),
 statement_timestamp()+interval '1 hour'
from ambiguous_claim cross join (values
 ('fe160000-0000-4000-8000-000000000002'::uuid,'IDENTIFIER-AMBIGUOUS-A',8,'2026-09-05T18:14:00Z'::timestamptz,'3760'),
 ('fe160000-0000-4000-8000-000000000003'::uuid,'IDENTIFIER-AMBIGUOUS-B',9,'2026-09-05T18:16:00Z'::timestamptz,'4488')
) v(token,transaction_id,site_id,authorized_at,last4);
select is((public.service_commit_refund_nayax_lookup('fe150000-0000-4000-8000-000000000002',
  (select generation from ambiguous_claim),4,'multiple_matches','ambiguous','2026-09-05.v9',
  statement_timestamp(),'Two transactions require manager corroboration',null,2,'manual',
  'fe110000-0000-4000-8000-000000000001')->>'applied'),'true',
  'Ambiguous evidence remains visible');
set local role service_role;
select throws_ok(format($$select public.service_select_refund_nayax_candidate_as_actor(
  'fe110000-0000-4000-8000-000000000001','fe150000-0000-4000-8000-000000000002',%s,
  'fe160000-0000-4000-8000-000000000002',null)$$,
  (select official_action_version from public.refund_cases where id='fe150000-0000-4000-8000-000000000002')),
  'P4604','Choose why this alternate Nayax transaction is the correct one',
  'Ambiguous candidates still require explicit manager corroboration');
reset role;
select is((select count(*)::integer from public.refund_case_nayax_refund_attempts
  where refund_case_id in ('fe150000-0000-4000-8000-000000000001','fe150000-0000-4000-8000-000000000002'))
  +(select count(*)::integer from public.refund_case_messages
  where refund_case_id in ('fe150000-0000-4000-8000-000000000001','fe150000-0000-4000-8000-000000000002')),
  0,'Matching and selection create no payment attempt or customer message');

select * from finish();
rollback;
