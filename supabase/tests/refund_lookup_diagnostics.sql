begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data)
values('fb410000-0000-4000-8000-000000000001','authenticated','authenticated','diagnostics-manager@example.invalid','{}','{}');
insert into public.customer_accounts(id,name,account_type)
values('fb420000-0000-4000-8000-000000000001','Diagnostics fixture','internal');
insert into public.reporting_locations(id,account_id,name,timezone)
values('fb430000-0000-4000-8000-000000000001','fb420000-0000-4000-8000-000000000001','Diagnostics fixture','America/New_York');
insert into public.reporting_machines(id,account_id,location_id,machine_label,status,nayax_machine_id,nayax_account_key,nayax_refunds_enabled)
values('fb440000-0000-4000-8000-000000000001','fb420000-0000-4000-8000-000000000001',
 'fb430000-0000-4000-8000-000000000001','Diagnostics fixture','active','DIAGNOSTICS-MACHINE','DIAGNOSTICS-ACCOUNT',true);
insert into public.reporting_machine_refund_managers(reporting_machine_id,manager_user_id,manager_email,grant_reason)
values('fb440000-0000-4000-8000-000000000001','fb410000-0000-4000-8000-000000000001','diagnostics-manager@example.invalid','Fixture');
create function pg_temp.case_id(n integer) returns uuid language sql immutable as $$
 select ('fb450000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid;
$$;
insert into public.refund_cases(id,public_reference,reporting_machine_id,reporting_location_id,customer_email,
 issue_summary,incident_at,incident_timezone,payment_method,payment_amount_cents,refund_amount_cents,card_last4,
 status,decision,decision_reason,decided_by,decided_at,correlation_status,correlation_source,deterministic_fact_version,
 nayax_refund_execution_status)
select pg_temp.case_id(n),'RF-DIAGNOSTIC-'||n,'fb440000-0000-4000-8000-000000000001',
 'fb430000-0000-4000-8000-000000000001','diagnostics-customer@example.invalid','Synthetic diagnostics',
 '2026-08-29T20:10:00Z','America/New_York','card',963,963,'4242','needs_review','approved','Ordinary decision',
 'fb410000-0000-4000-8000-000000000001',now()-interval '1 day','no_match','nayax',1,'not_requested'
from generate_series(1,4) n;
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
 'fb410000-0000-4000-8000-000000000001',diagnostics);
$$;
select public.service_begin_refund_nayax_lookup(pg_temp.case_id(n),1,'manual','fb410000-0000-4000-8000-000000000001')
from generate_series(1,4) n;
select is(pg_temp.commit_result(1)->>'applied','true','Actual existing commit accepts approved unpaid result with diagnostics');
select is((select metadata->'diagnostics' from public.refund_case_events where refund_case_id=pg_temp.case_id(1)
 and event_type='nayax_lookup_diagnostics'),pg_temp.diagnostic(),'Exact counts/window/provenance stored in existing event stream');
select is((select count(*) from public.refund_case_events where refund_case_id=pg_temp.case_id(1)
 and event_type='nayax_lookup_completed'),1::bigint,'Wrapper delegates once');
select ok(not exists(select 1 from approval_before b join public.refund_cases c using(id)
 where row(b.decision,b.decision_reason,b.decided_by,b.decided_at,b.refund_amount_cents,b.deterministic_fact_version)
 is distinct from row(c.decision,c.decision_reason,c.decided_by,c.decided_at,c.refund_amount_cents,c.deterministic_fact_version)),
 'Approval amount actor date and facts are preserved');
select is(pg_temp.commit_result(1)->>'applied','true','Unchanged same-generation result remains supported');
select is((select count(*) from public.refund_case_events where refund_case_id=pg_temp.case_id(1)
 and event_type='nayax_lookup_diagnostics'),1::bigint,'Unchanged replay adds no second diagnostic event');
select throws_ok($$select pg_temp.commit_result(1,jsonb_set(pg_temp.diagnostic(),'{providerRecordCount}','13'))$$,
 'P4623','Lookup diagnostic replay changed','Changed same-generation diagnostic cannot overwrite history');
select throws_ok($$select pg_temp.commit_result(2,pg_temp.diagnostic()||'{"rawPayload":"secret"}')$$,
 'P4623','Invalid bounded lookup diagnostics','No arbitrary/raw payload keys');
select throws_ok($$select pg_temp.commit_result(2,jsonb_set(pg_temp.diagnostic(),'{providerRecordCount}','"12"'))$$,
 'P4623','Invalid lookup diagnostic count','Counts cannot be strings');
select throws_ok($$select pg_temp.commit_result(2,jsonb_set(pg_temp.diagnostic(),'{providerParseableRecordCount}','13'))$$,
 'P4623','Inconsistent lookup diagnostic counts','Parseable cannot exceed returned count');
select throws_ok($$select pg_temp.commit_result(2,jsonb_set(pg_temp.diagnostic(),'{windowEnd}','"2026-08-30T03:10:00Z"'))$$,
 'P4623','Invalid lookup window','Window boundaries must match effective duration');
select throws_ok($$select pg_temp.commit_result(2,jsonb_set(pg_temp.diagnostic(),'{incidentTimeConfidence}','null'))$$,
 'P4623','Invalid lookup time provenance','Null confidence cannot evade enum checks');
select throws_ok($$select pg_temp.commit_result(2,jsonb_set(pg_temp.diagnostic(),'{historicalCoverage}','"complete"'))$$,
 'P4623','Invalid bounded lookup diagnostics','Latest-sales observation cannot claim complete history');
select is(pg_temp.commit_result(2,pg_temp.diagnostic(),2)->>'applied','false','Wrong generation remains stale');
select is((select count(*) from public.refund_case_events where refund_case_id=pg_temp.case_id(2)
 and event_type='nayax_lookup_diagnostics'),0::bigint,'Stale result adds no diagnostics');
update public.refund_cases set refund_completed_at=now() where id=pg_temp.case_id(4);
select is(pg_temp.commit_result(4)->>'applied','false','Late result cannot rewind completed payment marker');
select is((select count(*) from public.refund_case_events where refund_case_id=pg_temp.case_id(4)
 and event_type='nayax_lookup_diagnostics'),0::bigint,'Late progressed result adds no diagnostics');
select is(public.service_commit_refund_nayax_lookup(pg_temp.case_id(3),1,1,'no_match','no_safe_match','old-fixture',
 statement_timestamp(),'Old deployment',null,0,'manual','fb410000-0000-4000-8000-000000000001')->>'applied','true',
 'Old deployed caller signature remains supported');
select ok(not has_function_privilege('anon','public.service_commit_refund_nayax_lookup_with_diagnostics(uuid,bigint,bigint,text,text,text,timestamptz,text,uuid,integer,text,uuid,jsonb)','execute')
 and not has_function_privilege('authenticated','public.service_commit_refund_nayax_lookup_with_diagnostics(uuid,bigint,bigint,text,text,text,timestamptz,text,uuid,integer,text,uuid,jsonb)','execute')
 and has_function_privilege('service_role','public.service_commit_refund_nayax_lookup_with_diagnostics(uuid,bigint,bigint,text,text,text,timestamptz,text,uuid,integer,text,uuid,jsonb)','execute'),
 'Only existing service execution role can call diagnostic commit');
select is((select count(*) from public.refund_case_messages where refund_case_id in(select pg_temp.case_id(n) from generate_series(1,4)n)),0::bigint,'No customer messages');
select is((select count(*) from public.refund_case_nayax_refund_attempts where refund_case_id in(select pg_temp.case_id(n) from generate_series(1,4)n)),0::bigint,'No payment attempts');
select * from finish();
rollback;
