begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(18);

insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data)
values('fd110000-0000-4000-8000-000000000001','authenticated','authenticated','request-boundary-manager@example.invalid','{}','{}');
insert into public.customer_accounts(id,name,account_type)
values('fd120000-0000-4000-8000-000000000001','Request boundary fixture','internal');
insert into public.reporting_locations(id,account_id,name,timezone)
values('fd130000-0000-4000-8000-000000000001','fd120000-0000-4000-8000-000000000001','Request boundary fixture','America/Los_Angeles');
insert into public.reporting_machines(id,account_id,location_id,machine_label,status,nayax_machine_id,nayax_account_key,nayax_refunds_enabled)
values('fd140000-0000-4000-8000-000000000001','fd120000-0000-4000-8000-000000000001',
 'fd130000-0000-4000-8000-000000000001','Request boundary machine','active','BOUNDARY-MACHINE','BOUNDARY_ACCOUNT',true);
insert into public.reporting_machine_refund_managers(reporting_machine_id,manager_user_id,manager_email,grant_reason)
values('fd140000-0000-4000-8000-000000000001','fd110000-0000-4000-8000-000000000001','request-boundary-manager@example.invalid','Fixture');
insert into public.refund_nayax_machine_inventory(account_key,nayax_machine_id,reporting_machine_id)
values('BOUNDARY_ACCOUNT','BOUNDARY-MACHINE','fd140000-0000-4000-8000-000000000001');

insert into public.refund_cases(id,public_reference,reporting_machine_id,reporting_location_id,customer_email,
 issue_summary,incident_at,incident_timezone,incident_time_resolution,incident_time_confidence,
 payment_method,payment_amount_cents,refund_amount_cents,card_last4,card_last4_provenance,card_last4_source,
 payment_interaction,
 status,correlation_status,deterministic_fact_version,intake_source,intake_meta)
values
 ('fd150000-0000-4000-8000-000000000001','RF-BOUNDARY-1','fd140000-0000-4000-8000-000000000001',
  'fd130000-0000-4000-8000-000000000001','boundary-customer@example.invalid','Hosted request boundary',
  statement_timestamp()-interval '1 hour','America/Los_Angeles','exact','exact','card',963,963,'4242',
  'physical_card','physical_card','insert_card','needs_review','needs_nayax',1,
  'form','{"source":"hosted_refund_intake"}'),
 ('fd150000-0000-4000-8000-000000000002','RF-BOUNDARY-2','fd140000-0000-4000-8000-000000000001',
  'fd130000-0000-4000-8000-000000000001','legacy-customer@example.invalid','Legacy unknown request boundary',
  statement_timestamp()-interval '2 hours','America/Los_Angeles','exact','exact','card',963,963,'4242',
  'physical_card','physical_card','insert_card','needs_review','needs_nayax',1,
 'form','{}');

insert into public.refund_cases(id,public_reference,reporting_machine_id,reporting_location_id,customer_email,
 issue_summary,incident_at,incident_timezone,incident_time_resolution,incident_time_confidence,
 payment_method,payment_amount_cents,refund_amount_cents,card_last4,card_last4_provenance,card_last4_source,
 payment_interaction,
 status,correlation_status,deterministic_fact_version,intake_source,intake_meta,
 customer_request_received_at,customer_request_received_source)
values('fd150000-0000-4000-8000-000000000003','RF-BOUNDARY-3','fd140000-0000-4000-8000-000000000001',
 'fd130000-0000-4000-8000-000000000001','diagnostic-customer@example.invalid','Diagnostic request boundary',
 '2026-09-05T11:00:00Z','America/Los_Angeles','exact','exact','card',963,963,'4242',
 'physical_card','physical_card','insert_card','needs_review','needs_nayax',1,
 'form','{}','2026-09-05T12:00:00Z','hosted_refund_intake');

select ok((select customer_request_received_at is not null and customer_request_received_source='hosted_refund_intake'
 from public.refund_cases where id='fd150000-0000-4000-8000-000000000001'),
 'Hosted case receives the database request anchor');
select ok((select customer_request_received_at is null and customer_request_received_source is null
 from public.refund_cases where id='fd150000-0000-4000-8000-000000000002'),
 'Legacy case remains explicitly unknown');

create function pg_temp.boundary_evidence(
  case_id uuid, authorized_at timestamptz, boundary text, comparable boolean, one_click boolean,
  policy text default '2026-09-05.v9'
) returns jsonb language sql stable as $$
  select jsonb_build_object(
    'selection_allowed',(comparable and boundary = 'before_or_at_request'),
    'is_recommended',true,'one_click_eligible',one_click,
    'recommendation_state','high_confidence','policy_version',policy,
    'identifier_policy_version','2026-09-05.identifier.v1',
    'customer_fact_version',c.deterministic_fact_version,
    'customer_credential_class','customer_physical_contact_chip_pan',
    'provider_identifier_class','last_sales_chip_identifier_unverified',
    'card_last4_comparison','exact_support','card_network_comparison','missing',
    'payment_interaction_comparison','supporting','same_identifier_equivalence_proven',false,
    'identifier_review_state','exact_support','customer_correction_fields','[]'::jsonb,
    'hard_exclusions','[]'::jsonb,
    'lookup_account_scope','BOUNDARY_ACCOUNT','lookup_provider_machine_id','BOUNDARY-MACHINE',
    'provider_machine_id','BOUNDARY-MACHINE','machine_authorization_time_raw','2026-09-05T10:00:00',
    'machine_authorization_time_source','MachineAuthorizationTime','machine_time_resolution','exact',
    'provider_time_resolution',case when comparable then 'exact' else 'ambiguous' end,
    'provider_time_source',case when comparable then 'authorization_gmt' else 'unverified_location_clock' end,
    'authorized_at',authorized_at,'customer_request_received_at',c.customer_request_received_at,
    'customer_request_received_source',c.customer_request_received_source,
    'request_time_boundary',boundary,'transaction_occurrence_comparable',comparable,
    'amount_delta_cents',0,'time_delta_minutes',
      ceil(abs(extract(epoch from (authorized_at-c.incident_at)))/60.0)::integer,
    'payment_status','approved','payment_status_evidence','last_sales_contract',
    'provider_refund_state','clear','duplicate_provider_record',false
  ) from public.refund_cases c where c.id=case_id;
$$;

create temp table lookup_claim as
select (public.service_begin_refund_nayax_lookup('fd150000-0000-4000-8000-000000000001',1,'manual',
 'fd110000-0000-4000-8000-000000000001')->>'lookupGeneration')::bigint generation;

insert into public.refund_nayax_lookup_candidates(token,refund_case_id,lookup_generation,actor_user_id,reporting_machine_id,
 provider_transaction_id,site_id,machine_authorization_time,amount_cents,card_last4,currency_code,evidence_summary,expires_at)
select 'fd160000-0000-4000-8000-000000000001','fd150000-0000-4000-8000-000000000001',generation,
 'fd110000-0000-4000-8000-000000000001','fd140000-0000-4000-8000-000000000001','SAFE-BOUNDARY-1',7,
 c.customer_request_received_at-interval '1 second',963,'4242','USD',
 pg_temp.boundary_evidence(c.id,c.customer_request_received_at-interval '1 second','before_or_at_request',true,true),
 statement_timestamp()+interval '1 hour'
from public.refund_cases c cross join lookup_claim
where c.id='fd150000-0000-4000-8000-000000000001';
select is((select count(*)::integer from public.refund_nayax_lookup_candidates
 where token='fd160000-0000-4000-8000-000000000001'),1,'Immediately-before evidence is admitted');

select throws_ok($$insert into public.refund_nayax_lookup_candidates(token,refund_case_id,lookup_generation,actor_user_id,reporting_machine_id,
 provider_transaction_id,site_id,machine_authorization_time,amount_cents,card_last4,currency_code,evidence_summary,expires_at)
select 'fd160000-0000-4000-8000-000000000002',c.id,l.generation,'fd110000-0000-4000-8000-000000000001',
 'fd140000-0000-4000-8000-000000000001','LATER-BOUNDARY-2',7,c.customer_request_received_at+interval '1 second',963,'4242','USD',
 pg_temp.boundary_evidence(c.id,c.customer_request_received_at+interval '1 second','after_request',true,false),statement_timestamp()+interval '1 hour'
from public.refund_cases c cross join lookup_claim l where c.id='fd150000-0000-4000-8000-000000000001'$$,
 'P4625','Transaction occurred after Bloomjoy received the customer request',
 'Immediately-after provider occurrence is rejected before persistence');

insert into public.refund_nayax_lookup_candidates(token,refund_case_id,lookup_generation,actor_user_id,reporting_machine_id,
 provider_transaction_id,site_id,machine_authorization_time,amount_cents,card_last4,currency_code,evidence_summary,expires_at)
select 'fd160000-0000-4000-8000-000000000003',c.id,l.generation,'fd110000-0000-4000-8000-000000000001',
 'fd140000-0000-4000-8000-000000000001','UNCERTAIN-BOUNDARY-3',7,c.customer_request_received_at-interval '1 minute',963,'4242','USD',
 pg_temp.boundary_evidence(c.id,c.customer_request_received_at-interval '1 minute','occurrence_time_uncertain',false,false),
 statement_timestamp()+interval '1 hour'
from public.refund_cases c cross join lookup_claim l where c.id='fd150000-0000-4000-8000-000000000001';
select is((select count(*)::integer from public.refund_nayax_lookup_candidates where token='fd160000-0000-4000-8000-000000000003'),1,
 'Uncertain occurrence timing remains reviewable');

select throws_ok($$insert into public.refund_nayax_lookup_candidates(token,refund_case_id,lookup_generation,actor_user_id,reporting_machine_id,
 provider_transaction_id,site_id,machine_authorization_time,amount_cents,card_last4,currency_code,evidence_summary,expires_at)
select 'fd160000-0000-4000-8000-000000000004',c.id,l.generation,'fd110000-0000-4000-8000-000000000001',
 'fd140000-0000-4000-8000-000000000001','UNSAFE-UNCERTAIN-4',7,c.customer_request_received_at-interval '1 minute',963,'4242','USD',
 pg_temp.boundary_evidence(c.id,c.customer_request_received_at-interval '1 minute','occurrence_time_uncertain',false,true),
 statement_timestamp()+interval '1 hour'
from public.refund_cases c cross join lookup_claim l where c.id='fd150000-0000-4000-8000-000000000001'$$,
 'P4625','Invalid customer request time evidence','Uncertain timing cannot become one-click evidence');

select throws_ok($$insert into public.refund_nayax_lookup_candidates(token,refund_case_id,lookup_generation,actor_user_id,reporting_machine_id,
 provider_transaction_id,site_id,machine_authorization_time,amount_cents,card_last4,currency_code,evidence_summary,expires_at)
select 'fd160000-0000-4000-8000-000000000006',c.id,l.generation,'fd110000-0000-4000-8000-000000000001',
 'fd140000-0000-4000-8000-000000000001','MISSING-SOURCE-6',7,c.customer_request_received_at-interval '1 minute',963,'4242','USD',
 pg_temp.boundary_evidence(c.id,c.customer_request_received_at-interval '1 minute','before_or_at_request',true,false)
   - 'provider_time_source',
 statement_timestamp()+interval '1 hour'
from public.refund_cases c cross join lookup_claim l where c.id='fd150000-0000-4000-8000-000000000001'$$,
 'P4625','Invalid customer request time evidence',
 'Comparable occurrence evidence must name an established provider time source');

select throws_ok($$insert into public.refund_nayax_lookup_candidates(token,refund_case_id,lookup_generation,actor_user_id,reporting_machine_id,
 provider_transaction_id,site_id,machine_authorization_time,amount_cents,card_last4,currency_code,evidence_summary,expires_at)
select 'fd160000-0000-4000-8000-000000000007',c.id,l.generation,'fd110000-0000-4000-8000-000000000001',
 'fd140000-0000-4000-8000-000000000001','MANUAL-LATER-7',null,c.customer_request_received_at+interval '1 second',963,'4242','USD',
 '{"source":"manual_nayax_portal","selection_allowed":true,"is_recommended":true,"one_click_eligible":false,"policy_version":"manual-nayax-portal-v1"}',
 statement_timestamp()+interval '1 hour'
from public.refund_cases c cross join lookup_claim l where c.id='fd150000-0000-4000-8000-000000000001'$$,
 'P4625','Transaction occurred after Bloomjoy received the customer request',
 'Exact manual portal occurrence after the request is never persisted');

select is((public.service_commit_refund_nayax_lookup('fd150000-0000-4000-8000-000000000001',
 (select generation from lookup_claim),1,'match_found','high_confidence','2026-09-05.v9',statement_timestamp(),
 'Synthetic request-bound candidate',null,2,'manual','fd110000-0000-4000-8000-000000000001')->>'applied'),'true',
 'Current request-bound candidates commit through the existing generation guard');

set local role service_role;
select is((public.service_select_refund_nayax_candidate_as_actor('fd110000-0000-4000-8000-000000000001',
 'fd150000-0000-4000-8000-000000000001',
 (select official_action_version from public.refund_cases where id='fd150000-0000-4000-8000-000000000001'),
 'fd160000-0000-4000-8000-000000000001',null)->>'selectionApplied'),'true',
 'A proved earlier transaction remains selectable through the normal manager path');
reset role;

select ok((select matched_nayax_transaction_id='SAFE-BOUNDARY-1' and nayax_match_execution_eligible
 from public.refund_cases where id='fd150000-0000-4000-8000-000000000001'),
 'Safe exact evidence retains existing one-click readiness');

create temp table legacy_claim as
select (public.service_begin_refund_nayax_lookup('fd150000-0000-4000-8000-000000000002',1,'manual',
 'fd110000-0000-4000-8000-000000000001')->>'lookupGeneration')::bigint generation;
-- Simulate a v8 row persisted before the additive identifier-policy migration.
alter table public.refund_nayax_lookup_candidates disable trigger zzz_refund_nayax_candidate_identifier_evidence;
insert into public.refund_nayax_lookup_candidates(token,refund_case_id,lookup_generation,actor_user_id,reporting_machine_id,
 provider_transaction_id,site_id,machine_authorization_time,amount_cents,card_last4,currency_code,evidence_summary,expires_at)
select 'fd160000-0000-4000-8000-000000000005','fd150000-0000-4000-8000-000000000002',generation,
 'fd110000-0000-4000-8000-000000000001','fd140000-0000-4000-8000-000000000001','STALE-LEGACY-5',7,
 statement_timestamp()-interval '1 hour',963,'4242','USD',
 pg_temp.boundary_evidence('fd150000-0000-4000-8000-000000000002',statement_timestamp()-interval '1 hour',
   'request_time_unknown',false,false,'2026-09-05.v8'),
 statement_timestamp()+interval '1 hour' from legacy_claim;
alter table public.refund_nayax_lookup_candidates enable trigger zzz_refund_nayax_candidate_identifier_evidence;
select is((select evidence_summary->>'one_click_eligible' from public.refund_nayax_lookup_candidates
 where token='fd160000-0000-4000-8000-000000000005'),'false',
 'Unknown-anchor legacy evidence stays reviewable without a stale one-click claim');
select is((public.service_commit_refund_nayax_lookup('fd150000-0000-4000-8000-000000000002',
 (select generation from legacy_claim),1,'match_found','high_confidence','2026-09-05.v8',statement_timestamp(),
 'Synthetic stale candidate',null,1,'manual','fd110000-0000-4000-8000-000000000001')->>'applied'),'true',
 'Legacy evidence remains readable until refreshed');
update public.refund_cases set customer_request_received_at=statement_timestamp(),
 customer_request_received_source='hosted_refund_intake' where id='fd150000-0000-4000-8000-000000000002';
set local role service_role;
select throws_ok(format($$select public.service_select_refund_nayax_candidate_as_actor('fd110000-0000-4000-8000-000000000001',
 'fd150000-0000-4000-8000-000000000002',%s,'fd160000-0000-4000-8000-000000000005',null)$$,
 (select official_action_version from public.refund_cases where id='fd150000-0000-4000-8000-000000000002')),
 'P4626','Refresh Nayax transactions to use current identifier evidence','Stale selection cannot bypass the current identifier policy');
reset role;
select is((select count(*)::integer from public.refund_case_nayax_refund_attempts
 where refund_case_id in ('fd150000-0000-4000-8000-000000000001','fd150000-0000-4000-8000-000000000002')),0,
 'Request-time matching creates no payment attempt');
select is((select count(*)::integer from public.refund_case_messages
 where refund_case_id in ('fd150000-0000-4000-8000-000000000001','fd150000-0000-4000-8000-000000000002')),0,
 'Request-time matching sends no customer message');

create temp table diagnostic_claim as
select (public.service_begin_refund_nayax_lookup('fd150000-0000-4000-8000-000000000003',1,'manual',
 'fd110000-0000-4000-8000-000000000001')->>'lookupGeneration')::bigint generation;
create function pg_temp.request_diagnostic() returns jsonb language sql stable as $$
 select jsonb_build_object(
  'schemaVersion','nayax_lookup_diagnostics_v3','endpoint','machine_last_sales','historicalCoverage','unknown',
  'providerRecordCount',2,'providerParseableRecordCount',2,'providerWindowRecordCount',2,
  'windowHours',6,'incidentAt','2026-09-05T11:00:00Z','windowStart','2026-09-05T05:00:00Z',
  'windowEnd','2026-09-05T17:00:00Z','incidentTimeResolution','legacy_absolute','incidentTimeConfidence','rough',
  'locationTimezone','America/Los_Angeles',
  'providerTimePolicy','authorization_gmt_else_provider_clock_else_unverified_location',
  'machineTimezoneSource','per_machine_provider_clock_contexts','providerPayloadRedacted',true,
  'providerClockContexts',jsonb_build_array(jsonb_build_object(
    'reportingMachineId','fd140000-0000-4000-8000-000000000001','timezone',null,'source','unknown','observedAt',null)),
  'customerRequestReceivedAt','2026-09-05T12:00:00Z','customerRequestReceivedSource','hosted_refund_intake',
  'excludedAfterRequestCount',1,'uncertainRequestTimeCandidateCount',0
 );
$$;
select is((public.service_commit_refund_nayax_lookup_with_diagnostics(
 'fd150000-0000-4000-8000-000000000003',(select generation from diagnostic_claim),1,'no_match','no_safe_match',
 '2026-09-05.v9',statement_timestamp(),'One later transaction was excluded',null,0,'manual',
 'fd110000-0000-4000-8000-000000000001',pg_temp.request_diagnostic())->>'applied'),'true',
 'Bounded v3 diagnostics commit the exact request anchor and exclusion count');
select is((select metadata->'diagnostics'->>'excludedAfterRequestCount' from public.refund_case_events
 where refund_case_id='fd150000-0000-4000-8000-000000000003' and event_type='nayax_lookup_diagnostics'),'1',
 'The durable diagnostic retains the later-transaction measure without provider payload');

select * from finish();
rollback;
