begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('00000000-0000-0000-0000-000000000000','e1000000-0000-4000-8000-000000000001','authenticated','authenticated','report-fixture@example.invalid','',now(),'{}','{}',now(),now());
insert into public.customer_accounts(id,name,account_type) values('e1100000-0000-4000-8000-000000000001','Report fixture','internal');
insert into public.reporting_locations(id,account_id,name,timezone) values('e1200000-0000-4000-8000-000000000001','e1100000-0000-4000-8000-000000000001','Report location','America/Los_Angeles');
insert into public.reporting_machines(id,account_id,location_id,machine_label,nayax_machine_id,nayax_account_key)
values('e1300000-0000-4000-8000-000000000001','e1100000-0000-4000-8000-000000000001','e1200000-0000-4000-8000-000000000001','Report machine','600000001','TGPACI_USA_DB');
insert into public.refund_cases(id,customer_email,reporting_machine_id,reporting_location_id,payment_method,payment_amount_cents,issue_type,status,
matched_nayax_transaction_id,matched_nayax_site_id,matched_nayax_amount_cents,matched_nayax_currency_code)
values('e1400000-0000-4000-8000-000000000001','report-fixture@example.invalid','e1300000-0000-4000-8000-000000000001','e1200000-0000-4000-8000-000000000001','card',3200,'refund_request','needs_review','700000001',4,3210,'USD'),
('e1400000-0000-4000-8000-000000000002','report-fixture@example.invalid','e1300000-0000-4000-8000-000000000001','e1200000-0000-4000-8000-000000000001','card',3210,'refund_request','needs_review','700000002',4,3210,'USD');
insert into public.refund_authoritative_receipts(id,refund_case_id,reporting_machine_id,account_scope,provider_machine_id,original_transaction_id,original_amount_cents,refunded_amount_cents,currency_code,provider_status,evidence_reference_digest,recorded_by,attempt_binding_kind,current_provider_observation_reviewed)
values('e1500000-0000-4000-8000-000000000001','e1400000-0000-4000-8000-000000000001','e1300000-0000-4000-8000-000000000001','TGPACI_USA_DB','600000001','700000001',3210,3210,'USD',62,repeat('a',64),'e1000000-0000-4000-8000-000000000001','no_attempt_integrity_hold',true);
create function pg_temp.report(p_digest text,p_original text default '700000001',p_machine text default '600000001',p_amount integer default -3210) returns jsonb language sql as $$
select jsonb_build_object('fileDigest',repeat(p_digest,64),'byteCount',100,'rowCount',1,'actorCounts',jsonb_build_object('2003563806',1),
'terminalEvidenceProven',false,'reportingPeriod',null,'settlementTimePrecision','unknown','observations',jsonb_build_array(jsonb_build_object(
'transactionId','800000001','originalTransactionId',p_original,'siteId','4','actorId','2003563806','providerMachineId',p_machine,'currencyCode','USD',
'authorizationAmountCents',p_amount,'settlementAmountCents',p_amount,'paidAmountCents',p_amount,'providerStatus',null,'providerStatusName',null,'observationDigest',repeat(p_digest,64))));
$$;
select set_config('request.jwt.claim.role','service_role',true);
select lives_ok($$select public.service_record_nayax_scheduled_report('aa1',now(),'linked_download',pg_temp.report('b'))$$,'Blank status report reuses exact existing receipt');
select is((select existing_receipt_id from public.nayax_scheduled_refund_observations where observation_digest=repeat('b',64)),'e1500000-0000-4000-8000-000000000001'::uuid,'Receipt amount is authoritative despite customer amount difference');
select is((select disposition from public.nayax_scheduled_refund_observations where observation_digest=repeat('b',64)),'existing_receipt_confirmed','Completion comes from prior receipt, not blank report status');
select is((public.service_record_nayax_scheduled_report('aa1',now(),'linked_download',pg_temp.report('b'))->>'duplicate')::boolean,true,'Same message replay deduplicates');
select lives_ok($$select public.service_record_nayax_scheduled_report('aa2',now(),'attachment',pg_temp.report('b'))$$,'Delayed duplicate file in different message deduplicates');
select is((select count(*) from public.refund_case_events where event_type='nayax_scheduled_report_observed'),1::bigint,'Replay has one audit event');
select lives_ok($$select public.service_record_nayax_scheduled_report('aa3',now(),'linked_download',pg_temp.report('c','700000002'))$$,'Unconfirmed exact case becomes internal review');
select is((select disposition from public.nayax_scheduled_refund_observations where observation_digest=repeat('c',64)),'needs_provider_review','Blank status never writes a receipt');
select lives_ok($$select public.service_record_nayax_scheduled_report('aa4',now(),'linked_download',pg_temp.report('d','700000001','999999999'))$$,'Wrong machine remains conflict');
select is((select disposition from public.nayax_scheduled_refund_observations where observation_digest=repeat('d',64)),'identity_conflict','Original ID alone cannot reuse receipt');
select lives_ok($$select public.service_record_nayax_scheduled_report('aa5',now(),'linked_download',pg_temp.report('e','700000001','600000001',-1000))$$,'Partial amount stays distinct');
select is((select disposition from public.nayax_scheduled_refund_observations where observation_digest=repeat('e',64)),'identity_conflict','Partial row cannot replace full receipt');
select throws_ok($$select public.service_record_nayax_scheduled_report('aa1',now(),'linked_download',pg_temp.report('f'))$$,'P0001','Report message content changed','Same message cannot change content');
select is((select count(*) from public.refund_authoritative_receipts where refund_case_id::text like 'e1400000%'),1::bigint,'No new receipt');
select is((select count(*) from public.refund_case_nayax_refund_attempts where refund_case_id::text like 'e1400000%'),0::bigint,'No payment attempt');
select is((select count(*) from public.refund_case_messages where refund_case_id::text like 'e1400000%'),0::bigint,'No customer message');
select is((select status from public.refund_cases where id='e1400000-0000-4000-8000-000000000002'),'needs_review','Case state preserved');
select is((select settled_at from public.refund_authoritative_receipts where id='e1500000-0000-4000-8000-000000000001'),null::timestamptz,'Report timestamps do not invent bank settlement');
select set_config('request.jwt.claim.role','authenticated',true);
select throws_ok($$select public.service_record_nayax_scheduled_report('bb1',now(),'linked_download',pg_temp.report('f'))$$,'P0001','Service report ingestion required','Customer session cannot import provider observations');
select * from finish();
rollback;

