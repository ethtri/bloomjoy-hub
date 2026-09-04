-- Disposable database only: real ingest RPCs in two independent transactions.
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
set search_path=public,extensions;
select extensions.dblink_connect('report_site_a','host=db port='||current_setting('port')||' dbname='||current_database()||' user=postgres password=postgres sslmode=disable application_name=report_site_a');
select extensions.dblink_connect('report_site_b','host=db port='||current_setting('port')||' dbname='||current_database()||' user=postgres password=postgres sslmode=disable application_name=report_site_b');
select extensions.dblink_exec('report_site_a','set statement_timeout=''20s''');
select extensions.dblink_exec('report_site_b','set statement_timeout=''20s''');
begin;
create schema report_site_race;
create table report_site_race.results(lane text primary key,payload jsonb);
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('00000000-0000-0000-0000-000000000000','e3100000-0000-4000-8000-000000000001','authenticated','authenticated','report-race@example.invalid','',now(),'{}','{}',now(),now());
insert into public.customer_accounts(id,name,account_type) values('e3200000-0000-4000-8000-000000000001','Report race','internal');
insert into public.reporting_locations(id,account_id,name,timezone) values('e3300000-0000-4000-8000-000000000001','e3200000-0000-4000-8000-000000000001','Report race','America/Los_Angeles');
insert into public.reporting_machines(id,account_id,location_id,machine_label,nayax_machine_id,nayax_account_key)
values('e3400000-0000-4000-8000-000000000001','e3200000-0000-4000-8000-000000000001','e3300000-0000-4000-8000-000000000001','Report race','630000001','TGPACI_USA_DB');
insert into public.refund_cases(id,customer_email,reporting_machine_id,reporting_location_id,payment_method,payment_amount_cents,issue_summary,status,
matched_nayax_transaction_id,matched_nayax_site_id,matched_nayax_amount_cents,matched_nayax_currency_code,incident_at)
values('e3500000-0000-4000-8000-000000000001','report-race@example.invalid','e3400000-0000-4000-8000-000000000001','e3300000-0000-4000-8000-000000000001','card',1090,'Synthetic race','needs_review','730000001',2,1090,'USD',now());
-- Existing authoritative state is synthetic; this fixture proves ingestion only.
insert into public.refund_authoritative_receipts(id,refund_case_id,reporting_machine_id,account_scope,provider_machine_id,original_transaction_id,
original_amount_cents,refunded_amount_cents,currency_code,provider_status,evidence_reference_digest,recorded_by,attempt_binding_kind,current_provider_observation_reviewed)
values('e3600000-0000-4000-8000-000000000001','e3500000-0000-4000-8000-000000000001','e3400000-0000-4000-8000-000000000001','TGPACI_USA_DB','630000001','730000001',1090,1090,'USD',62,repeat('3',64),'e3100000-0000-4000-8000-000000000001','no_attempt_integrity_hold',true);
create table report_site_race.before_case as select to_jsonb(c) snapshot from public.refund_cases c where id='e3500000-0000-4000-8000-000000000001';
create table report_site_race.before_receipt as select to_jsonb(r) snapshot from public.refund_authoritative_receipts r where id='e3600000-0000-4000-8000-000000000001';
create function report_site_race.report(lane text) returns jsonb language plpgsql as $$
declare rows jsonb:='[]'; row_data jsonb; n integer;
begin
  -- B's reversed row order must still acquire the lower identity lock first.
  for n in select i from generate_series(1,2) i order by case when lane='b' then -i else i end loop
    row_data:=jsonb_build_object('transactionId',(830000000+n)::text,
      'originalTransactionId',case when n=1 and lane='b' then '730000001' else (739999990+n)::text end,
      'siteId','6','actorId','2001508696','providerMachineId','630000001','currencyCode','USD',
      'authorizationAmountCents',-1090,'settlementAmountCents',-1090,'paidAmountCents',-1090,'providerStatus',null,'providerStatusName',null);
    rows:=rows||jsonb_build_array(row_data||jsonb_build_object('observationDigest',encode(digest(row_data::text,'sha256'),'hex')));
  end loop;
  return jsonb_build_object('fileDigest',encode(digest(rows::text,'sha256'),'hex'),'byteCount',1000,'rowCount',2,
    'actorCounts',jsonb_build_object('2001508696',2),'terminalEvidenceProven',false,'reportingPeriod',null,'settlementTimePrecision','unknown','observations',rows);
end; $$;
create function report_site_race.run(lane text) returns jsonb language plpgsql as $$
declare report jsonb:=report_site_race.report(lane);
begin
  perform set_config('request.jwt.claim.role','service_role',true);
  return public.service_record_nayax_scheduled_report(report->>'fileDigest',now(),'linked_download',report);
end; $$;
create function report_site_race.wait_for_b() returns boolean language plpgsql as $$ begin
  for i in 1..200 loop
    perform pg_stat_clear_snapshot();
    if exists(select 1 from pg_stat_activity where application_name='report_site_b' and wait_event_type='Lock' and wait_event='advisory') then return true; end if;
    perform pg_sleep(0.01);
  end loop;
  return false;
end; $$;
commit;
select no_plan();
select extensions.dblink_exec('report_site_a','begin');
select * from extensions.dblink('report_site_a',$q$select 'locked'::text from pg_advisory_xact_lock(hashtextextended('nayax-report-refund:TGPACI_USA_DB:830000001',0))$q$) as x(result text);
select extensions.dblink_send_query('report_site_b',$q$select report_site_race.run('b')$q$);
select ok(report_site_race.wait_for_b(),'Reversed multirow report actually waits on shared refund identity');
insert into report_site_race.results select 'a',payload from extensions.dblink('report_site_a',$q$select report_site_race.run('a')$q$) as x(payload jsonb);
select extensions.dblink_exec('report_site_a','commit');
insert into report_site_race.results select 'b',payload from extensions.dblink_get_result('report_site_b') as x(payload jsonb);
select * from extensions.dblink_get_result('report_site_b') as x(payload jsonb);
select is((select payload->>'observationsAdded' from report_site_race.results where lane='a'),'2','First writer commits both rows without inverted-order deadlock');
select is((select payload->>'observationsAdded' from report_site_race.results where lane='b'),'1','Waiting writer deduplicates shared row and records only changed link');
select is((select disposition from public.nayax_scheduled_refund_observations where provider_transaction_id='830000001' and original_transaction_id='739999991'),'unmatched','First unmatched identity is retained');
select is((select disposition from public.nayax_scheduled_refund_observations where provider_transaction_id='830000001' and original_transaction_id='730000001'),'identity_conflict','Waiting receipt path sees committed conflicting original link');
select is((select count(*) from public.nayax_scheduled_refund_observations where provider_transaction_id in ('830000001','830000002') and existing_receipt_id is not null),0::bigint,'Concurrent conflict cannot gain receipt corroboration');
select is(report_site_race.run('b')->>'duplicate','true','Post-race same-message replay is immutable');
select is((select count(*) from public.nayax_scheduled_refund_observations where provider_transaction_id in ('830000001','830000002')),3::bigint,'Replay creates no fourth observation');
select is((select to_jsonb(c) from public.refund_cases c where id='e3500000-0000-4000-8000-000000000001'),(select snapshot from report_site_race.before_case),'Whole case remains unchanged');
select is((select to_jsonb(r) from public.refund_authoritative_receipts r where id='e3600000-0000-4000-8000-000000000001'),(select snapshot from report_site_race.before_receipt),'Original receipt remains unchanged');
select is((select count(*) from public.refund_case_nayax_refund_attempts where refund_case_id='e3500000-0000-4000-8000-000000000001'),0::bigint,'Concurrent reports create no payment attempt');
select is((select count(*) from public.refund_case_messages where refund_case_id='e3500000-0000-4000-8000-000000000001'),0::bigint,'Concurrent reports create no customer mail');
select * from finish();
select extensions.dblink_disconnect('report_site_a');
select extensions.dblink_disconnect('report_site_b');
-- Named disposable fixture cleanup only; immutable guards restored atomically.
begin;
alter table public.nayax_scheduled_refund_observations disable trigger nayax_report_observations_immutable;
alter table public.nayax_scheduled_report_messages disable trigger nayax_report_messages_immutable;
alter table public.nayax_scheduled_report_files disable trigger nayax_report_files_immutable;
alter table public.refund_authoritative_receipts disable trigger refund_authoritative_receipts_immutable;
delete from public.nayax_scheduled_refund_observations where provider_transaction_id in ('830000001','830000002');
delete from public.nayax_scheduled_report_messages where file_digest in (report_site_race.report('a')->>'fileDigest',report_site_race.report('b')->>'fileDigest');
delete from public.nayax_scheduled_report_files where file_digest in (report_site_race.report('a')->>'fileDigest',report_site_race.report('b')->>'fileDigest');
delete from public.refund_authoritative_receipts where id='e3600000-0000-4000-8000-000000000001';
alter table public.nayax_scheduled_refund_observations enable trigger nayax_report_observations_immutable;
alter table public.nayax_scheduled_report_messages enable trigger nayax_report_messages_immutable;
alter table public.nayax_scheduled_report_files enable trigger nayax_report_files_immutable;
alter table public.refund_authoritative_receipts enable trigger refund_authoritative_receipts_immutable;
delete from public.refund_cases where id='e3500000-0000-4000-8000-000000000001';
delete from public.reporting_machines where id='e3400000-0000-4000-8000-000000000001';
delete from public.reporting_locations where id='e3300000-0000-4000-8000-000000000001';
delete from public.customer_accounts where id='e3200000-0000-4000-8000-000000000001';
delete from auth.users where id='e3100000-0000-4000-8000-000000000001';
drop schema report_site_race cascade;
commit;
