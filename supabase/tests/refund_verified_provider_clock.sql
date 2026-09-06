begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data)
values('fc410000-0000-4000-8000-000000000001','authenticated','authenticated','diagnostics-manager@example.invalid','{}','{}');
insert into public.customer_accounts(id,name,account_type)
values('fc420000-0000-4000-8000-000000000001','Diagnostics fixture','internal');
insert into public.reporting_locations(id,account_id,name,timezone)
values('fc430000-0000-4000-8000-000000000001','fc420000-0000-4000-8000-000000000001','Diagnostics fixture','America/New_York');
insert into public.reporting_machines(id,account_id,location_id,machine_label,status,nayax_machine_id,nayax_account_key,nayax_refunds_enabled)
values('fc440000-0000-4000-8000-000000000001','fc420000-0000-4000-8000-000000000001',
 'fc430000-0000-4000-8000-000000000001','Diagnostics fixture','active','CLOCK-MACHINE','CLOCK_ACCOUNT',true);
insert into public.reporting_machine_refund_managers(reporting_machine_id,manager_user_id,manager_email,grant_reason)
values('fc440000-0000-4000-8000-000000000001','fc410000-0000-4000-8000-000000000001','diagnostics-manager@example.invalid','Fixture');
create function pg_temp.case_id(n integer) returns uuid language sql immutable as $$
 select ('fc450000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid;
$$;
-- Metadata is seeded only in this disposable fixture, with all real triggers.
insert into public.refund_nayax_machine_inventory(account_key,nayax_machine_id,reporting_machine_id)
values('CLOCK_ACCOUNT','CLOCK-MACHINE','fc440000-0000-4000-8000-000000000001');
select ok(public.refund_nayax_provider_clock_context_matches('fc440000-0000-4000-8000-000000000001',
 '{"reportingMachineId":"fc440000-0000-4000-8000-000000000001","timezone":null,"source":"unknown","observedAt":null}'),
 'Unverified inventory retains explicit unknown clock state');
select throws_ok($$update public.refund_nayax_machine_inventory set provider_clock_timezone='America/Los_Angeles'
 where nayax_machine_id='CLOCK-MACHINE'$$,'23514',null,'Partial provenance is not verified');
update public.refund_nayax_machine_inventory set provider_clock_timezone='America/Los_Angeles',
 provider_clock_source='native_machine_configuration',provider_clock_observed_at='2026-09-04T15:44:13.963271Z',
 provider_clock_daylight_saving=true where nayax_machine_id='CLOCK-MACHINE';
select throws_ok($$update public.refund_nayax_machine_inventory set provider_clock_timezone='Not/A_Zone'
 where nayax_machine_id='CLOCK-MACHINE'$$,'P4624','Invalid verified provider clock timezone','Only a real IANA zone can be stored');
select throws_ok($$update public.refund_nayax_machine_inventory set provider_clock_daylight_saving=false
 where nayax_machine_id='CLOCK-MACHINE'$$,'23514',null,'Fixed-offset behavior is not fabricated from a DST mapping');
create function pg_temp.clock_context() returns jsonb language sql stable as $$
 select jsonb_build_object('reportingMachineId',reporting_machine_id,'timezone',provider_clock_timezone,
 'source',provider_clock_source,'observedAt',provider_clock_observed_at)
 from public.refund_nayax_machine_inventory where nayax_machine_id='CLOCK-MACHINE';
$$;
insert into public.refund_cases(id,public_reference,reporting_machine_id,reporting_location_id,customer_email,
 issue_summary,incident_at,incident_timezone,payment_method,payment_amount_cents,refund_amount_cents,card_last4,
 status,decision,decision_reason,decided_by,decided_at,correlation_status,correlation_source,deterministic_fact_version,
 nayax_refund_execution_status,incident_time_resolution,incident_time_confidence,
 customer_request_received_at,customer_request_received_source)
select pg_temp.case_id(n),'RF-DIAGNOSTIC-'||n,'fc440000-0000-4000-8000-000000000001',
 'fc430000-0000-4000-8000-000000000001','diagnostics-customer@example.invalid','Synthetic diagnostics',
 '2026-08-29T20:10:00Z','America/New_York','card',963,963,'4242','needs_review','approved','Ordinary decision',
 'fc410000-0000-4000-8000-000000000001',now()-interval '1 day','no_match','nayax',1,'not_requested','exact',
 case n when 5 then 'within_15_minutes' when 6 then 'within_1_hour' else 'rough' end,
 '2026-08-30T00:00:00Z','hosted_refund_intake'
from generate_series(1,8) n;
create temp table approval_before as select id,decision,decision_reason,decided_by,decided_at,refund_amount_cents,
 deterministic_fact_version from public.refund_cases where id=pg_temp.case_id(1);
create function pg_temp.diagnostic() returns jsonb language sql immutable as $$
 select '{"schemaVersion":"nayax_lookup_diagnostics_v1","endpoint":"machine_last_sales","historicalCoverage":"unknown",
 "providerRecordCount":12,"providerParseableRecordCount":11,"providerWindowRecordCount":0,"windowHours":6,
 "incidentAt":"2026-08-29T20:10:00Z","windowStart":"2026-08-29T14:10:00Z","windowEnd":"2026-08-30T02:10:00Z",
 "incidentTimeResolution":"exact","incidentTimeConfidence":"rough","locationTimezone":"America/New_York",
 "providerTimePolicy":"authorization_gmt_else_mapped_machine_clock",
 "machineTimezoneSource":"configured_location_not_verified_provider_clock","providerPayloadRedacted":true}'::jsonb;
$$;
create function pg_temp.commit_result(n integer,diagnostics jsonb default pg_temp.diagnostic(),generation bigint default 1)
returns jsonb language sql as $$
 select public.service_commit_refund_nayax_lookup_with_diagnostics(pg_temp.case_id(n),generation,1,'no_match','no_safe_match',
 'diagnostics-fixture-v1',statement_timestamp(),'Historical coverage is unknown',null,0,'manual',
 'fc410000-0000-4000-8000-000000000001',diagnostics);
$$;
create function pg_temp.diagnostic_v2() returns jsonb language sql stable as $$
 select pg_temp.diagnostic()||jsonb_build_object('schemaVersion','nayax_lookup_diagnostics_v2',
  'providerTimePolicy','authorization_gmt_else_provider_clock_else_unverified_location',
  'machineTimezoneSource','per_machine_provider_clock_contexts','providerClockContexts',jsonb_build_array(pg_temp.clock_context()));
$$;
select public.service_begin_refund_nayax_lookup(pg_temp.case_id(n),1,'manual','fc410000-0000-4000-8000-000000000001')
from generate_series(1,5)n;
select is(pg_temp.commit_result(1,pg_temp.diagnostic_v2())->>'applied','true','Actual v2 commit records exact provider clock without changing the physical zone');
select is((select metadata->'diagnostics' from public.refund_case_events where refund_case_id=pg_temp.case_id(1)
 and event_type='nayax_lookup_diagnostics'),pg_temp.diagnostic_v2(),'Existing event contains the bounded verified clock snapshot');
select is(pg_temp.commit_result(1,pg_temp.diagnostic_v2())->>'applied','true','Unchanged v2 replay remains compatible');
select is((select count(*) from public.refund_case_events where refund_case_id=pg_temp.case_id(1) and event_type='nayax_lookup_diagnostics'),1::bigint,'Replay adds no duplicate diagnostic');
select is(pg_temp.commit_result(2,pg_temp.diagnostic())->>'applied','true','Old v1 scalar diagnostics remain supported after clock migration');
create temp table case3_before as select to_jsonb(c) snapshot from public.refund_cases c where id=pg_temp.case_id(3);
select throws_ok($$select pg_temp.commit_result(3,jsonb_set(pg_temp.diagnostic_v2(),'{providerClockContexts,0,timezone}','"America/New_York"'))$$,
 'P4624','Provider clock context changed or is outside current lookup scope','A stale provider clock cannot be recorded as current');
select is((select to_jsonb(c) from public.refund_cases c where id=pg_temp.case_id(3)),(select snapshot from case3_before),'Rejected clock result rolls back all canonical commit mutation');
select throws_ok($$select pg_temp.commit_result(3,jsonb_set(pg_temp.diagnostic_v2(),'{providerClockContexts,0,rawPayload}','"private"',true))$$,
 'P4624','Provider clock context changed or is outside current lookup scope','Raw fields cannot enter a clock context');
select throws_ok($$select pg_temp.commit_result(3,jsonb_set(pg_temp.diagnostic_v2(),'{providerClockContexts,0,reportingMachineId}','"fc440000-0000-4000-8000-000000000099"'))$$,
 'P4624','Provider clock context changed or is outside current lookup scope','Another machine clock is outside this lookup scope');
select throws_ok($$select pg_temp.commit_result(3,jsonb_set(pg_temp.diagnostic_v2(),'{providerClockContexts}','[]'))$$,
 'P4624','Invalid provider clock context count','V2 cannot omit the actual machine clock scope');
select throws_ok($$select pg_temp.commit_result(3,jsonb_set(pg_temp.diagnostic_v2(),'{providerClockContexts}',jsonb_build_array(pg_temp.clock_context(),pg_temp.clock_context())))$$,
 'P4624','Provider clock contexts do not cover the exact lookup scope','Duplicate contexts do not cover more machines');
select throws_ok($$select pg_temp.commit_result(3,pg_temp.diagnostic()||jsonb_build_object('providerClockContexts',jsonb_build_array(pg_temp.clock_context())))$$,
 'P4623','Invalid bounded lookup diagnostics','V1 does not silently accept v2 fields');
select throws_ok($$select pg_temp.commit_result(3,jsonb_set(pg_temp.diagnostic_v2(),'{schemaVersion}','null'))$$,
 'P4623','Invalid bounded lookup diagnostics','Null schema cannot evade strict version checks');
select is(pg_temp.commit_result(3,pg_temp.diagnostic_v2())->>'applied','true','Valid current clock remains usable after rejected payloads');
update public.refund_cases set refund_completed_at=now() where id=pg_temp.case_id(5);
select is(pg_temp.commit_result(5,pg_temp.diagnostic_v2())->>'applied','false','A progressed payment still wins over late v2 metadata');
select is((select count(*) from public.refund_case_events where refund_case_id=pg_temp.case_id(5) and event_type='nayax_lookup_diagnostics'),0::bigint,'Late progressed result adds no clock event');
select ok(not exists(select 1 from approval_before b join public.refund_cases c using(id)
 where row(c.decision,c.decision_reason,c.decided_by,c.decided_at,c.refund_amount_cents,c.deterministic_fact_version)
 is distinct from row(b.decision,b.decision_reason,b.decided_by,b.decided_at,b.refund_amount_cents,b.deterministic_fact_version)),
 'Clock provenance preserves the exact ordinary approval and customer fact version');
select is((select timezone from public.reporting_locations where id='fc430000-0000-4000-8000-000000000001'),'America/New_York','Physical purchase location remains Eastern while provider clock is Pacific');
select ok(not has_function_privilege('anon','public.refund_nayax_provider_clock_context_matches(uuid,jsonb)','execute')
 and not has_function_privilege('authenticated','public.refund_nayax_provider_clock_context_matches(uuid,jsonb)','execute')
 and has_function_privilege('service_role','public.refund_nayax_provider_clock_context_matches(uuid,jsonb)','execute'),
 'Clock validation is service-only with unchanged scoped inventory access');
create function pg_temp.prepare_candidate(n integer, minute_offset integer default 0, clock_override jsonb default null) returns uuid language plpgsql as $$
declare token_id uuid:=gen_random_uuid(); generation bigint; fact_version bigint;
begin
  select deterministic_fact_version into fact_version from public.refund_cases where id=pg_temp.case_id(n);
  generation:=(public.service_begin_refund_nayax_lookup(pg_temp.case_id(n),fact_version,'manual','fc410000-0000-4000-8000-000000000001')->>'lookupGeneration')::bigint;
  insert into public.refund_nayax_lookup_candidates(token,refund_case_id,lookup_generation,actor_user_id,reporting_machine_id,
    provider_transaction_id,site_id,machine_authorization_time,amount_cents,card_last4,currency_code,evidence_summary,expires_at)
  values(token_id,pg_temp.case_id(n),generation,'fc410000-0000-4000-8000-000000000001','fc440000-0000-4000-8000-000000000001',
    (923456780+n)::text,4,'2026-08-29T20:10:00Z'::timestamptz+minute_offset*interval '1 minute',963,'4242','USD',
    '{"selection_allowed":true,"is_recommended":true,"one_click_eligible":true,"recommendation_state":"high_confidence","policy_version":"2026-09-05.v11","identifier_policy_version":"2026-09-05.identifier.v2","customer_fact_version":1,"customer_credential_class":"customer_identifier_unknown","provider_identifier_class":"last_sales_identifier_unknown","card_last4_comparison":"exact_support","card_network_comparison":"missing","payment_interaction_comparison":"unknown","same_identifier_equivalence_proven":false,"identifier_review_state":"exact_support","customer_correction_fields":[],"hard_exclusions":[],"reason_codes":[],"lookup_account_scope":"CLOCK_ACCOUNT","lookup_provider_machine_id":"CLOCK-MACHINE","provider_machine_id":"CLOCK-MACHINE","machine_authorization_time_raw":"2026-08-29T13:10:00","machine_authorization_time_source":"MachineAuthorizationTime","machine_time_resolution":"exact","provider_time_resolution":"exact","provider_time_source":"verified_machine_clock","customer_request_received_at":"2026-08-30T00:00:00Z","customer_request_received_source":"hosted_refund_intake","request_time_boundary":"before_or_at_request","transaction_occurrence_comparable":true,"transaction_occurrence_semantics":"online_purchase_occurrence","transaction_occurrence_proof_source":"verified_provider_purchase_occurrence_v1","transaction_occurrence_timestamp_source":"verified_machine_clock","transaction_occurrence_timezone_basis":"verified_machine_timezone","request_receipt_lower_bound_at":"2026-08-30T00:00:00Z","request_receipt_upper_bound_at":"2026-08-30T00:00:00Z","payment_status":"approved","payment_status_evidence":"last_sales_contract","provider_refund_state":"clear","duplicate_provider_record":false,"amount_delta_cents":0}'::jsonb
      ||jsonb_build_object('customer_fact_version',fact_version,
        'machine_clock_context',coalesce(clock_override,pg_temp.clock_context()),
        'machine_authorization_time_raw',to_char('2026-08-29T13:10:00'::timestamp+minute_offset*interval '1 minute','YYYY-MM-DD"T"HH24:MI:SS'),
        'machine_authorization_at','2026-08-29T20:10:00Z'::timestamptz+minute_offset*interval '1 minute',
        'authorized_at','2026-08-29T20:10:00Z'::timestamptz+minute_offset*interval '1 minute',
        'transaction_occurrence_lower_bound_at','2026-08-29T20:10:00Z'::timestamptz+minute_offset*interval '1 minute',
        'transaction_occurrence_upper_bound_at','2026-08-29T20:10:00Z'::timestamptz+minute_offset*interval '1 minute',
        'time_delta_minutes',abs(minute_offset),
        'provider_processing_time_delta_minutes',abs(minute_offset)),
    now()+interval '1 hour');
  perform public.service_commit_refund_nayax_lookup(pg_temp.case_id(n),generation,fact_version,'match_found','high_confidence',
    '2026-09-05.v11',now(),'Synthetic exact candidate',null,1,'manual','fc410000-0000-4000-8000-000000000001');
  return token_id;
end;
$$;
-- Case8 is an undecided synthetic case, so an actual non-replay reselection can
-- exercise its existing supported path without rewriting a real approval.
update public.refund_cases set decision=null,decision_reason=null,decided_by=null,decided_at=null where id=pg_temp.case_id(8);
update public.refund_cases set incident_time_confidence='exact' where id in(pg_temp.case_id(7),pg_temp.case_id(8));
create temp table clock_selection_tokens as select n,pg_temp.prepare_candidate(n) token from generate_series(6,8)n;
grant select,update on clock_selection_tokens to service_role;
create function pg_temp.select_candidate(p_n integer) returns jsonb language sql as $$
 select public.service_select_refund_nayax_candidate_as_actor('fc410000-0000-4000-8000-000000000001',c.id,c.official_action_version,t.token,null)
 from public.refund_cases c join clock_selection_tokens t on t.n=p_n where c.id=pg_temp.case_id(p_n);
$$;
set local role service_role;
select is(pg_temp.select_candidate(6)->>'selectionApplied','true','Current verified-clock candidate preserves the normal approved selection path');
select is(pg_temp.select_candidate(8)->>'selectionApplied','true','Undecided fixture selects its original exact candidate');
reset role;
-- Exercise the existing service-only candidate/selection boundary with another
-- immutable token for the same ID and different evidence. This does not claim
-- the automatic matcher admits duplicate provider records or starts a new read.
create function pg_temp.changed_evidence_token(old_token uuid) returns uuid language plpgsql as $$
declare next_token uuid:=gen_random_uuid();
begin
 insert into public.refund_nayax_lookup_candidates(token,refund_case_id,lookup_generation,actor_user_id,reporting_machine_id,
  provider_transaction_id,site_id,machine_authorization_time,amount_cents,card_last4,currency_code,evidence_summary,expires_at)
 select next_token,candidate.refund_case_id,lookup_generation,actor_user_id,candidate.reporting_machine_id,
  provider_transaction_id,site_id,machine_authorization_time+interval '1 minute',amount_cents,candidate.card_last4,currency_code,
  evidence_summary || jsonb_build_object(
    'machine_authorization_time_raw','2026-08-29T13:11:00',
    'machine_authorization_at',machine_authorization_time+interval '1 minute',
    'authorized_at',machine_authorization_time+interval '1 minute',
    'transaction_occurrence_lower_bound_at',machine_authorization_time+interval '1 minute',
    'transaction_occurrence_upper_bound_at',machine_authorization_time+interval '1 minute',
    'time_delta_minutes',ceil(abs(extract(epoch from
      ((machine_authorization_time+interval '1 minute')-case_row.incident_at)))/60.0)::integer,
    'provider_processing_time_delta_minutes',ceil(abs(extract(epoch from
      ((machine_authorization_time+interval '1 minute')-case_row.incident_at)))/60.0)::integer
  ),expires_at
 from public.refund_nayax_lookup_candidates candidate
 join public.refund_cases case_row on case_row.id=candidate.refund_case_id
 where token=old_token;
 return next_token;
end;
$$;
update clock_selection_tokens set token=pg_temp.changed_evidence_token(token) where n=8;
create temp table before_stale_selection as select id,to_jsonb(c) snapshot from public.refund_cases c where id in(pg_temp.case_id(7),pg_temp.case_id(8));
update public.refund_nayax_machine_inventory set provider_clock_timezone='America/Indiana/Indianapolis',
 provider_clock_observed_at='2026-09-04T16:00:00Z' where nayax_machine_id='CLOCK-MACHINE';
select throws_ok($$select pg_temp.prepare_candidate(7,0,(select evidence_summary->'machine_clock_context'
 from public.refund_nayax_lookup_candidates where refund_case_id=pg_temp.case_id(7) limit 1))$$,
 'P4624','Provider clock changed during lookup; refresh current evidence','Actual candidate insert rejects a clock changed during the provider read');
set local role service_role;
select is(pg_temp.select_candidate(6)->>'selectionApplied','false','Exact already-selected replay stays read-only after later clock configuration changes');
select throws_ok($$select pg_temp.select_candidate(7)$$,'P4626','Invalid Nayax identifier evidence','Unselected stale-clock candidate cannot be selected');
select throws_ok($$select pg_temp.select_candidate(8)$$,'P4626','Invalid Nayax identifier evidence','Same original ID with changed evidence is not a freshness-bypassing replay');
reset role;
select ok(not exists(select 1 from before_stale_selection b join public.refund_cases c using(id) where b.snapshot is distinct from to_jsonb(c)),
 'Rejected new and same-ID selections leave every current case field unchanged');
select is((select count(*) from public.refund_case_messages where refund_case_id in(select pg_temp.case_id(n) from generate_series(1,8)n)),0::bigint,'Clock interpretation sends no customer message');
select is((select count(*) from public.refund_case_nayax_refund_attempts where refund_case_id in(select pg_temp.case_id(n) from generate_series(1,8)n)),0::bigint,'Clock interpretation creates no payment attempt');

-- Existing bounded Livermore scope: one invocation reads two machines only
-- while unresolved; a later already-resolved invocation reads just its machine.
insert into public.reporting_locations(id,account_id,name,city,state,timezone,status)
values('fc430000-0000-4000-8000-000000000002','fc420000-0000-4000-8000-000000000001','San Francisco Premium Outlets','Livermore','CA','America/Los_Angeles','active');
insert into public.reporting_machines(id,account_id,location_id,machine_label,machine_type,status,nayax_machine_id,nayax_account_key,nayax_refunds_enabled,refund_intake_enabled,refund_public_display_label)
values
 ('91bae5ac-4ba6-4378-91f0-ef266bdd4d7a','fc420000-0000-4000-8000-000000000001','fc430000-0000-4000-8000-000000000002','TT20 Cotton Candy','commercial','active','921900001','TGPACI_USA_DB',false,true,'San Francisco Premium Outlets — TT20 Cotton Candy'),
 ('8eda5a29-1718-4c70-9993-7c7e2fd6c65a','fc420000-0000-4000-8000-000000000001','fc430000-0000-4000-8000-000000000002','TT33 Cotton Candy','commercial','active','921900002','TGPACI_USA_DB',false,true,'San Francisco Premium Outlets — TT33 Cotton Candy');
insert into public.refund_nayax_machine_inventory(account_key,nayax_machine_id,machine_name,machine_number,provider_is_active,refund_category,reporting_machine_id,reconciliation_state,setup_reason)
values
 ('TGPACI_USA_DB','921900001','Livermore A','fixture-a',true,'cotton_candy','91bae5ac-4ba6-4378-91f0-ef266bdd4d7a','published','reviewed_exact_mapping'),
 ('TGPACI_USA_DB','921900002','Livermore B','fixture-b',true,'cotton_candy','8eda5a29-1718-4c70-9993-7c7e2fd6c65a','published','reviewed_exact_mapping');
insert into public.reporting_machine_refund_managers(reporting_machine_id,manager_user_id,manager_email,grant_reason)
select id,'fc410000-0000-4000-8000-000000000001','diagnostics-manager@example.invalid','Clock pair fixture'
from public.reporting_machines where id=any(public.refund_livermore_selection_machine_ids());
select ok(public.refund_livermore_selection_is_valid(),'Synthetic grouped clock cases use the exact existing public pair and manager scope');
insert into public.refund_cases(id,public_reference,reporting_machine_id,reporting_location_id,intake_selection_key,intake_selection_kind,intake_selection_machine_ids,
 customer_email,issue_summary,incident_at,incident_local_datetime,incident_timezone,incident_time_resolution,payment_method,payment_amount_cents,card_last4,card_network,payment_interaction,incident_time_confidence,issue_category,status,correlation_status)
select pg_temp.case_id(n),'RF-CLOCK-PAIR-'||n,case when n=10 then '91bae5ac-4ba6-4378-91f0-ef266bdd4d7a'::uuid else null end,
 'fc430000-0000-4000-8000-000000000002',public.refund_livermore_selection_key(),'livermore_pair',public.refund_livermore_selection_machine_ids(),
 'clock-pair@example.invalid','Synthetic grouped clock','2026-08-29T20:10:00Z','2026-08-29T13:10','America/Los_Angeles','exact','card',963,'4242','visa','tap_card','exact','charged_no_product','needs_review','no_match'
from generate_series(9,10)n;
select public.service_begin_refund_nayax_lookup(pg_temp.case_id(n),1,'manual','fc410000-0000-4000-8000-000000000001') from generate_series(9,10)n;
create function pg_temp.pair_diagnostic(n integer) returns jsonb language sql stable as $$
 select pg_temp.diagnostic_v2()||jsonb_build_object('locationTimezone','America/Los_Angeles','providerWindowRecordCount',case when n=9 then 1 else 0 end,
 'providerClockContexts',(select jsonb_agg(jsonb_build_object('reportingMachineId',id,'timezone',null,'source','unknown','observedAt',null) order by id)
 from unnest(case when n=9 then public.refund_livermore_selection_machine_ids() else array['91bae5ac-4ba6-4378-91f0-ef266bdd4d7a'::uuid] end) id));
$$;
insert into public.refund_nayax_lookup_candidates(token,refund_case_id,lookup_generation,actor_user_id,reporting_machine_id,provider_transaction_id,site_id,machine_authorization_time,amount_cents,card_last4,currency_code,evidence_summary,expires_at)
values(gen_random_uuid(),pg_temp.case_id(9),1,'fc410000-0000-4000-8000-000000000001','91bae5ac-4ba6-4378-91f0-ef266bdd4d7a','923456799',4,'2026-08-29T20:10:00Z',963,'4242','USD',
 '{"lookup_account_scope":"TGPACI_USA_DB","lookup_provider_machine_id":"921900001","provider_machine_id":"921900001","machine_clock_context":{"reportingMachineId":"91bae5ac-4ba6-4378-91f0-ef266bdd4d7a","timezone":null,"source":"unknown","observedAt":null}}',now()+interval '1 hour');
select is(public.service_commit_refund_nayax_lookup_with_diagnostics(pg_temp.case_id(9),1,1,'match_found','high_confidence','clock-v2',now(),
 'Synthetic unresolved pair resolved one machine','91bae5ac-4ba6-4378-91f0-ef266bdd4d7a',1,'manual','fc410000-0000-4000-8000-000000000001',pg_temp.pair_diagnostic(9))->>'applied',
 'true','Unresolved pair retains both invocation clock contexts even when commit resolves one machine');
select is(pg_temp.commit_result(10,pg_temp.pair_diagnostic(10))->>'applied','true','Previously resolved pair accepts its actual single-machine invocation context');
select is((select jsonb_array_length(metadata->'diagnostics'->'providerClockContexts') from public.refund_case_events where refund_case_id=pg_temp.case_id(9) and event_type='nayax_lookup_diagnostics'),2,
 'Grouped event preserves the two actual clock observations');
select is((select jsonb_array_length(metadata->'diagnostics'->'providerClockContexts') from public.refund_case_events where refund_case_id=pg_temp.case_id(10) and event_type='nayax_lookup_diagnostics'),1,
 'Resolved event does not invent a second provider read');

select * from finish();
rollback;
