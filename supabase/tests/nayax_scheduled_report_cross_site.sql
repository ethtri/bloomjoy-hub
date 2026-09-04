-- Synthetic receipt state; every observation below uses the actual ingest RPC.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('00000000-0000-0000-0000-000000000000','e2100000-0000-4000-8000-000000000001','authenticated','authenticated','cross-site@example.invalid','',now(),'{}','{}',now(),now());
insert into public.customer_accounts(id,name,account_type) values('e2200000-0000-4000-8000-000000000001','Cross site fixture','internal');
insert into public.reporting_locations(id,account_id,name,timezone) values('e2300000-0000-4000-8000-000000000001','e2200000-0000-4000-8000-000000000001','Cross site','America/Los_Angeles');
insert into public.reporting_machines(id,account_id,location_id,machine_label,nayax_machine_id,nayax_account_key)
select ('e2400000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'e2200000-0000-4000-8000-000000000001',
'e2300000-0000-4000-8000-000000000001','Cross site '||n,(620000000+n)::text,'TGPACI_USA_DB' from generate_series(1,2) n;
insert into public.refund_cases(id,customer_email,reporting_machine_id,reporting_location_id,payment_method,payment_amount_cents,issue_summary,status,
matched_nayax_transaction_id,matched_nayax_site_id,matched_nayax_amount_cents,matched_nayax_currency_code,incident_at)
select ('e2500000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'cross-site@example.invalid',
('e2400000-0000-4000-8000-'||lpad((case when n=4 then 2 else 1 end)::text,12,'0'))::uuid,
'e2300000-0000-4000-8000-000000000001','card',1090,'Synthetic cross-site claim','needs_review',
(case when n=3 then 799999999 else 720000000+n end)::text,case when n=2 then null when n=7 then 0 else 2 end,1090,'USD',now()-interval '25 days'
from generate_series(1,7) n;
insert into public.refund_authoritative_receipts(id,refund_case_id,reporting_machine_id,account_scope,provider_machine_id,original_transaction_id,
original_amount_cents,refunded_amount_cents,currency_code,provider_status,evidence_reference_digest,recorded_by,attempt_binding_kind,current_provider_observation_reviewed)
select ('e2600000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
('e2500000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'e2400000-0000-4000-8000-000000000001',
case when n=6 then 'OTHER_ACCOUNT' else 'TGPACI_USA_DB' end,'620000001',(720000000+n)::text,
1090,1090,'USD',62,encode(digest('cross-site-receipt-'||n,'sha256'),'hex'),'e2100000-0000-4000-8000-000000000001','no_attempt_integrity_hold',true
from generate_series(1,7) n where n<>5;
create temp table before_cases as select id,to_jsonb(c) snapshot from public.refund_cases c where id::text like 'e2500000%';
create temp table before_receipts as select id,to_jsonb(r) snapshot from public.refund_authoritative_receipts r where refund_case_id::text like 'e2500000%';
create function pg_temp.cross_report(p_case integer,p_refund text,p_patch jsonb default '{}'::jsonb,p_nonce text default '')
returns jsonb language plpgsql as $$
declare observation jsonb; observation_digest text;
begin
  observation:=jsonb_build_object('transactionId',p_refund,'originalTransactionId',(720000000+p_case)::text,'siteId','6',
    'actorId','2001508696','providerMachineId','620000001','currencyCode','USD',
    'authorizationAmountCents',-1090,'settlementAmountCents',-1090,'paidAmountCents',-1090,
    'providerStatus',null,'providerStatusName',null)||p_patch;
  observation_digest:=encode(digest(observation::text,'sha256'),'hex');
  return jsonb_build_object('fileDigest',encode(digest(observation_digest||p_nonce,'sha256'),'hex'),'byteCount',512,'rowCount',1,
    'actorCounts',jsonb_build_object('2001508696',1),'terminalEvidenceProven',false,'reportingPeriod',null,
    'settlementTimePrecision','unknown','observations',jsonb_build_array(observation||jsonb_build_object('observationDigest',observation_digest)));
end; $$;
create function pg_temp.ingest(p_report jsonb) returns text language plpgsql as $$
begin
 perform public.service_record_nayax_scheduled_report(p_report->>'fileDigest',now(),'linked_download',p_report);
 return (select disposition from public.nayax_scheduled_refund_observations where observation_digest=p_report#>>'{observations,0,observationDigest}');
end; $$;
select set_config('request.jwt.claim.role','service_role',true);
select is(pg_temp.ingest(pg_temp.cross_report(1,'820000001')),'existing_receipt_confirmed','Site6 refund corroborates existing site2 original receipt');
select is((select matched_nayax_site_id from public.refund_cases where id='e2500000-0000-4000-8000-000000000001'),2,'Original sale site stays2');
select is((select observation->>'siteId' from public.nayax_scheduled_refund_observations where provider_transaction_id='820000001'),'6','Raw refund site stays6');
select is((select metadata->>'original_sale_site_id' from public.refund_case_events where refund_case_id='e2500000-0000-4000-8000-000000000001' and event_type='nayax_scheduled_report_observed'),'2','Audit retains original site separately');
select is((select metadata->>'linkage_source' from public.refund_case_events where refund_case_id='e2500000-0000-4000-8000-000000000001' and event_type='nayax_scheduled_report_observed'),'authenticated_report_explicit_original_id','Refund ID linkage is attributed to authenticated report');
select is(pg_temp.ingest(pg_temp.cross_report(1,'820000001')),'existing_receipt_confirmed','Same-message replay preserves confirmation');
select is(pg_temp.ingest(pg_temp.cross_report(1,'820000001','{}','delayed')),'existing_receipt_confirmed','New-message same observation preserves confirmation');
select is((select count(*) from public.refund_case_events where refund_case_id='e2500000-0000-4000-8000-000000000001' and event_type='nayax_scheduled_report_observed'),1::bigint,'Replays add no second audit event');
select is(pg_temp.ingest(pg_temp.cross_report(1,'820000002','{"siteId":"2"}')),'existing_receipt_confirmed','Same-site explicit refund remains compatible');
select is(pg_temp.ingest(pg_temp.cross_report(1,'820000003','{"originalTransactionId":null}')),'unmatched','Missing explicit original cannot corroborate receipt');
select is(pg_temp.ingest(pg_temp.cross_report(1,'720000001')),'identity_conflict','Self-linked refund cannot corroborate original');
select is(pg_temp.ingest(pg_temp.cross_report(1,'820000004','{"authorizationAmountCents":1090}')),'identity_conflict','Mixed signs do not corroborate');
select is(pg_temp.ingest(pg_temp.cross_report(1,'820000005','{"authorizationAmountCents":-500,"settlementAmountCents":-500,"paidAmountCents":-500}')),'identity_conflict','Partial refund cannot corroborate full receipt');
select is(pg_temp.ingest(pg_temp.cross_report(1,'820000006','{"settlementAmountCents":-1000}')),'identity_conflict','Unequal full amount is rejected');
select is(pg_temp.ingest(pg_temp.cross_report(1,'820000007','{"currencyCode":"CAD"}')),'identity_conflict','Wrong currency cannot corroborate');
select is(pg_temp.ingest(pg_temp.cross_report(1,'820000008','{"providerMachineId":"999999999"}')),'identity_conflict','Wrong provider machine cannot corroborate');
select is(pg_temp.ingest(pg_temp.cross_report(2,'820000009')),'identity_conflict','Missing original sale site cannot use receipt exception');
select is(pg_temp.ingest(pg_temp.cross_report(3,'820000010')),'identity_conflict','Stale case original binding cannot use receipt exception');
select is(pg_temp.ingest(pg_temp.cross_report(4,'820000011')),'identity_conflict','Case reporting machine must remain bound to receipt');
select is(pg_temp.ingest(pg_temp.cross_report(5,'820000012')),'unmatched','Cross-site row without receipt remains unmatched');
select is(pg_temp.ingest(pg_temp.cross_report(5,'820000013','{"siteId":"2"}')),'needs_provider_review','Existing same-site nonreceipt review is unchanged');
select is(pg_temp.ingest(pg_temp.cross_report(6,'820000014')),'unmatched','Other account receipt cannot corroborate TGpaci report');
select is(pg_temp.ingest(pg_temp.cross_report(7,'820000016')),'existing_receipt_confirmed','Canonical original site0 remains a valid nonempty identity');
select is(pg_temp.ingest(pg_temp.cross_report(5,'820000012','{"siteId":"2"}')),'needs_provider_review','Prior report conflict does not broaden or change the nonreceipt review path');
select is(pg_temp.ingest(pg_temp.cross_report(1,'820000015','{"originalTransactionId":"799999998"}')),'unmatched','Wrong original is not assigned by amount');
select is(pg_temp.ingest(pg_temp.cross_report(1,'820000015')),'identity_conflict','Prior conflicting refund ID original link cannot be reassigned');
select is(pg_temp.ingest(pg_temp.cross_report(1,'820000001','{"siteId":"4"}')),'identity_conflict','Changed refund-row site cannot overwrite existing link');
select is((select count(*) from public.nayax_scheduled_refund_observations where provider_transaction_id='820000001' and disposition='existing_receipt_confirmed'),1::bigint,'Conflict cannot erase or duplicate existing receipt observation');
select is((select count(*) from before_cases b join public.refund_cases c using(id) where b.snapshot is distinct from to_jsonb(c)),0::bigint,'Every original case field remains unchanged');
select is((select count(*) from before_receipts b join public.refund_authoritative_receipts r using(id) where b.snapshot is distinct from to_jsonb(r)),0::bigint,'Every prior receipt field remains immutable');
select is((select count(*) from public.refund_authoritative_receipts where refund_case_id::text like 'e2500000%'),6::bigint,'No new receipt');
select is((select count(*) from public.refund_case_nayax_refund_attempts where refund_case_id::text like 'e2500000%'),0::bigint,'No payment attempt');
select is((select count(*) from public.refund_case_messages where refund_case_id::text like 'e2500000%'),0::bigint,'No customer message');
select ok(not has_function_privilege('authenticated','public.service_record_nayax_scheduled_report(text,timestamptz,text,jsonb)','EXECUTE'),'Authenticated cannot execute service ingestion');
select ok(not has_function_privilege('anon','public.service_record_nayax_scheduled_report(text,timestamptz,text,jsonb)','EXECUTE'),'Anonymous cannot execute service ingestion');
select * from finish();
rollback;
