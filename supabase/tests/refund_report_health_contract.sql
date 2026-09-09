begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(32);

create function pg_temp.set_auth_claims(p_user_id uuid, p_role text default 'authenticated')
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p_user_id::text, true);
  perform set_config('request.jwt.claim.role', p_role, true);
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', p_user_id, 'role', p_role, 'is_anonymous', false
  )::text, true);
end;
$$;

insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data) values
 ('e3100000-0000-4000-8000-000000000001','authenticated','authenticated','report-health-ops@example.invalid','{}','{}'),
 ('e3100000-0000-4000-8000-000000000002','authenticated','authenticated','report-health-manager@example.invalid','{}','{}');
insert into public.admin_roles(user_id,role,active)
values('e3100000-0000-4000-8000-000000000001','super_admin',true);
insert into public.customer_accounts(id,name,account_type)
values('e3200000-0000-4000-8000-000000000001','Report health fixture','internal');
insert into public.reporting_locations(id,account_id,name,timezone)
values('e3300000-0000-4000-8000-000000000001','e3200000-0000-4000-8000-000000000001','Report health fixture','America/Los_Angeles');
insert into public.reporting_machines(id,account_id,location_id,machine_label)
values('e3400000-0000-4000-8000-000000000001','e3200000-0000-4000-8000-000000000001','e3300000-0000-4000-8000-000000000001','Report health fixture');
insert into public.reporting_machine_refund_managers(reporting_machine_id,manager_user_id,manager_email,grant_reason)
values('e3400000-0000-4000-8000-000000000001','e3100000-0000-4000-8000-000000000002','report-health-manager@example.invalid','Report health fixture');

select pg_temp.set_auth_claims('e3100000-0000-4000-8000-000000000001');
select is(public.get_refund_gmail_health()#>>'{reportFreshness,schemaVersion}','refund_report_health_v2','Health contract is versioned');
select is(public.get_refund_gmail_health()#>>'{reportFreshness,deliveryState}','unobserved','No provider run or file remains unobserved');
select is(public.get_refund_gmail_health()#>>'{reportFreshness,coverageState}','unknown','No file cannot invent coverage');
select is(public.get_refund_gmail_health()#>>'{reportFreshness,attentionRequired}','false','Unobserved state does not create a failure alert');

insert into public.nayax_scheduled_report_files(file_digest,received_at,byte_count,row_count,report)
values(repeat('1',64),now()-interval '3 hours',100,1,jsonb_build_object('reportingPeriod',null));
insert into public.nayax_scheduled_report_messages(message_id,file_digest,received_at,delivery_form)
values('health-file-1',repeat('1',64),now()-interval '3 hours','linked_download');
select is(public.get_refund_gmail_health()#>>'{reportFreshness,deliveryState}','ordinary_silence','Old file without provider log evidence is ordinary silence');
select is(public.get_refund_gmail_health()#>>'{reportFreshness,status}','recent','Compatibility status keeps ordinary silence out of manager warnings');
select is((public.get_refund_gmail_health()#>>'{reportFreshness,lastRecordedAt}')::timestamptz,(select recorded_at from public.nayax_scheduled_report_files where file_digest=repeat('1',64)),'File received and recorded times remain separate');
select is(public.get_refund_gmail_health()#>>'{reportFreshness,coverageState}','unknown','Missing reporting period preserves unknown coverage');
select is(public.get_refund_gmail_health()#>>'{reportFreshness,absenceIsNoRefundEvidence}','false','Silence is never no-refund evidence');

select throws_ok($$select public.service_record_nayax_scheduled_report_provider_run(now(),'empty','nayax_core_distribution_log',repeat('a',64))$$,'P0001','Service role required','Authenticated callers cannot record provider observations');
select pg_temp.set_auth_claims('e3100000-0000-4000-8000-000000000001','service_role');
select lives_ok($$select public.service_record_nayax_scheduled_report_provider_run(now()-interval '40 minutes','empty','nayax_core_distribution_log',repeat('a',64))$$,'Service role records one authenticated Empty run');
select is((select count(*) from public.nayax_scheduled_report_provider_run_observations),1::bigint,'One provider observation is stored');
select lives_ok($$select public.service_record_nayax_scheduled_report_provider_run(now()-interval '40 minutes','empty','nayax_core_distribution_log',repeat('a',64))$$,'Exact provider observation replay is idempotent');
select is((select count(*) from public.nayax_scheduled_report_provider_run_observations),1::bigint,'Replay creates no duplicate observation');
select throws_ok($$select public.service_record_nayax_scheduled_report_provider_run(now()-interval '40 minutes','failed','nayax_core_distribution_log',repeat('b',64))$$,'P0001','Provider report run observation conflict','Conflicting status for one provider run fails closed');
select throws_ok($$select public.service_record_nayax_scheduled_report_provider_run(now()-interval '40 minutes','empty','manual_note',repeat('c',64))$$,'P0001','Invalid provider report run observation','Unproved evidence source is rejected');
select throws_ok($$select public.service_record_nayax_scheduled_report_provider_run(now()-interval '15 days','empty','nayax_core_distribution_log',repeat('d',64))$$,'P0001','Invalid provider report run observation','Unbounded historical observations are rejected');

select pg_temp.set_auth_claims('e3100000-0000-4000-8000-000000000001');
select is(public.get_refund_gmail_health()#>>'{reportFreshness,deliveryState}','explicit_empty','Authenticated Empty run is distinct from silence');
select is(public.get_refund_gmail_health()#>>'{reportFreshness,attentionRequired}','false','Explicit Empty run creates no failure alert');
select is(public.get_refund_gmail_health()#>>'{reportFreshness,paymentRetryAuthorized}','false','Empty run cannot authorize payment retry');

select pg_temp.set_auth_claims('e3100000-0000-4000-8000-000000000001','service_role');
select lives_ok($$select public.service_record_nayax_scheduled_report_provider_run(now()-interval '35 minutes','file_sent','nayax_core_distribution_log',repeat('e',64))$$,'Service role records a sent-file run separately');
select pg_temp.set_auth_claims('e3100000-0000-4000-8000-000000000001');
select is(public.get_refund_gmail_health()#>>'{reportFreshness,deliveryState}','file_sent_awaiting_ingest','A provider-sent file newer than the inbox record remains awaiting ingest');
select is(public.get_refund_gmail_health()#>>'{reportFreshness,attentionReason}','provider_file_not_ingested','A sent file beyond local grace routes to operations');

select pg_temp.set_auth_claims('e3100000-0000-4000-8000-000000000001','service_role');
select lives_ok($$select public.service_record_nayax_scheduled_report_provider_run(now()-interval '5 minutes','failed','nayax_core_distribution_log',repeat('f',64))$$,'Service role records a failed provider run separately');
select pg_temp.set_auth_claims('e3100000-0000-4000-8000-000000000001');
select is(public.get_refund_gmail_health()#>>'{reportFreshness,deliveryState}','provider_failed','Provider failed run is distinct from ingest failure and silence');
select is(public.get_refund_gmail_health()#>>'{reportFreshness,attentionReason}','provider_run_failed','Provider failed run routes to operations');

insert into public.refund_gmail_sync_runs(
  id,run_key,trigger_source,status,started_at,finished_at,messages_failed,failure_category,error_code
) values(
  'e3500000-0000-4000-8000-000000000001','report-health-failed-run','failure_test','failed',
  now()-interval '1 minute',now(),1,'message_processing','nayax_report:normalize:nayax_report_contract_invalid'
);
update public.refund_gmail_sync_state
set last_run_id='e3500000-0000-4000-8000-000000000001',last_attempt_at=now(),
  last_error_code='nayax_report:normalize:nayax_report_contract_invalid'
where singleton;
select is(public.get_refund_gmail_health()#>>'{reportFreshness,ingestState}','failed','Actual report processing failure is distinct');
select is(public.get_refund_gmail_health()#>>'{reportFreshness,attentionReason}','report_ingest_failed','Actual ingest failure routes to operations');
select is(public.get_refund_gmail_health()#>>'{reportFreshness,attentionRequired}','true','Actual report ingest failure requires attention');

select pg_temp.set_auth_claims('e3100000-0000-4000-8000-000000000002');
select is(public.get_refund_gmail_health()->'reportFreshness','null'::jsonb,'Routine machine manager receives no account-wide report banner');
select ok(not has_function_privilege('anon','public.service_record_nayax_scheduled_report_provider_run(timestamptz,text,text,text)','execute'),'Anonymous callers cannot record provider runs');
select ok(not has_function_privilege('authenticated','public.service_record_nayax_scheduled_report_provider_run(timestamptz,text,text,text)','execute'),'Authenticated callers lack provider-run execution privilege');

select * from finish();
rollback;
