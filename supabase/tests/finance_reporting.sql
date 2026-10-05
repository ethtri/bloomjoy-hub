begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
-- Synthetic evidence only; triggers disabled so no provider or outbox work runs.
set local session_replication_role=replica;
insert into auth.users(id,email) values
 ('fb710000-0000-4000-8000-000000000001','finance@example.invalid'),
 ('fb710000-0000-4000-8000-000000000002','sales-only@example.invalid'),
 ('fb710000-0000-4000-8000-000000000003','refund-only@example.invalid');
insert into public.customer_accounts(id,name,account_type)
 values('fb720000-0000-4000-8000-000000000001','Finance synthetic','internal');
insert into public.reporting_locations(id,account_id,name,timezone)
 values('fb730000-0000-4000-8000-000000000001','fb720000-0000-4000-8000-000000000001','Finance fixture','America/Los_Angeles');
insert into public.reporting_machines(id,account_id,location_id,machine_label,status) values
 ('fb740000-0000-4000-8000-000000000001','fb720000-0000-4000-8000-000000000001','fb730000-0000-4000-8000-000000000001','Authorized finance','active'),
 ('fb740000-0000-4000-8000-000000000002','fb720000-0000-4000-8000-000000000001','fb730000-0000-4000-8000-000000000001','Hidden finance','active');
insert into public.reporting_machine_refund_managers(reporting_machine_id,manager_user_id,manager_email,status) values
 ('fb740000-0000-4000-8000-000000000001','fb710000-0000-4000-8000-000000000001','finance@example.invalid','active'),
 ('fb740000-0000-4000-8000-000000000001','fb710000-0000-4000-8000-000000000003','refund-only@example.invalid','active');
insert into public.reporting_machine_entitlements(user_id,machine_id,starts_at) values
 ('fb710000-0000-4000-8000-000000000001','fb740000-0000-4000-8000-000000000001','2020-01-01'),
 ('fb710000-0000-4000-8000-000000000002','fb740000-0000-4000-8000-000000000001','2020-01-01');
insert into public.reporting_machine_tax_rates(machine_id,tax_rate_percent,effective_start_date,status)
 values('fb740000-0000-4000-8000-000000000001',10,'2020-01-01','active');
update public.reporting_machines set nayax_machine_id='1763002',nayax_account_key='TGPACI_USA_DB'
where id='fb740000-0000-4000-8000-000000000001';
insert into private.nayax_machine_tax_observations(account_key,nayax_machine_id,observed_at,source,
 classification,rate_percent,provenance,effective_start_date,effective_end_date)
values('TGPACI_USA_DB','1763002',now(),'finance_verified','verified_tax',10,
 'Synthetic dated Finance evidence','2020-01-01','2026-12-31');
insert into private.refund_request_recognition_rollout(singleton,activated_at,activated_by)
 values(true,'2026-01-01','Synthetic finance test');
insert into public.machine_sales_facts(reporting_machine_id,reporting_location_id,sale_date,payment_method,
 net_sales_cents,transaction_count,source,source_row_hash,source_order_hash,raw_payload) values
 ('fb740000-0000-4000-8000-000000000001','fb730000-0000-4000-8000-000000000001','2026-02-01','credit',11000,10,'manual_csv',repeat('a',64),null,'{"amountBasis":"tax_inclusive"}'),
 ('fb740000-0000-4000-8000-000000000001','fb730000-0000-4000-8000-000000000001','2026-02-01','cash',2000,2,'sunze_browser',repeat('b',64),repeat('b',32),'{}'),
 ('fb740000-0000-4000-8000-000000000002','fb730000-0000-4000-8000-000000000001','2026-02-01','credit',99999,100,'manual_csv',repeat('c',64),null,'{"amountBasis":"tax_exclusive"}');
insert into public.refund_cases(id,public_reference,reporting_machine_id,reporting_location_id,customer_email,
 issue_summary,incident_at,payment_method,payment_amount_cents,refund_amount_cents,status,
 customer_request_received_at,customer_request_received_source) values
 ('fb750000-0000-4000-8000-000000000001','RF-FINANCE-1','fb740000-0000-4000-8000-000000000001','fb730000-0000-4000-8000-000000000001','private@example.invalid','Private free text','2026-02-01T12:00Z','card',1100,1100,'completed','2026-02-01T12:00Z','hosted_refund_intake'),
 ('fb750000-0000-4000-8000-000000000002','RF-FINANCE-2','fb740000-0000-4000-8000-000000000001','fb730000-0000-4000-8000-000000000001','gift@example.invalid','Partial gift','2026-02-01T12:00Z','card',3300,1100,'completed','2026-02-01T12:00Z','hosted_refund_intake'),
 ('fb750000-0000-4000-8000-000000000003','RF-FINANCE-3','fb740000-0000-4000-8000-000000000001','fb730000-0000-4000-8000-000000000001','legacy@example.invalid','Unknown history','2026-02-01T12:00Z','card',500,500,'needs_review','2026-02-01T12:00Z','hosted_refund_intake');
insert into private.refund_request_recognition_events(event_key,refund_case_id,event_kind,effective_at,recorded_at,
 booking_date,reporting_machine_id,reporting_location_id,tender,source,purchase_attribution_date,
 request_target_before_cents,request_target_after_cents,recognized_target_before_cents,recognized_target_after_cents,amount_basis,amount_provenance)
 select 'finance:'||id,id,'request_received','2026-02-01T12:00Z','2026-02-01T12:00Z','2026-02-01',
 reporting_machine_id,reporting_location_id,'card','hosted_refund_intake','2026-02-01',0,refund_amount_cents,
 0,refund_amount_cents,'tax_inclusive','synthetic' from public.refund_cases
 where id in ('fb750000-0000-4000-8000-000000000001','fb750000-0000-4000-8000-000000000002');
insert into public.sales_adjustment_facts(reporting_machine_id,reporting_location_id,adjustment_date,
 adjustment_type,amount_cents,source,source_row_hash,refund_case_id,raw_payload) values
 ('fb740000-0000-4000-8000-000000000001','fb730000-0000-4000-8000-000000000001','2026-03-01','refund',440,'manual',repeat('d',64),'fb750000-0000-4000-8000-000000000001','{"amountBasis":"tax_inclusive"}'),
 ('fb740000-0000-4000-8000-000000000001','fb730000-0000-4000-8000-000000000001','2026-03-02','refund',200,'manual',repeat('e',64),null,'{"amountBasis":"tax_exclusive"}');
update public.sales_adjustment_facts set created_at='2025-12-01'
 where source_row_hash=repeat('e',64);
insert into public.refund_gift_card_issuances(refund_case_id,code_id,pool_id,normalized_email,
 purchase_amount_cents,affected_purchase_amount_cents,face_value_cents,goodwill_amount_cents,currency,eligible_locations,
 expires_at,redemption_instructions,message_id,message_identity_digest,issued_at)
 values('fb750000-0000-4000-8000-000000000002',gen_random_uuid(),gen_random_uuid(),'gift@example.invalid',3300,1100,1500,400,
 'USD',array['Finance fixture'],'2027-01-01','Private instructions',gen_random_uuid(),repeat('f',64),'2026-03-02T12:00Z');
set local session_replication_role=origin;
select set_config('request.jwt.claim.sub','fb710000-0000-4000-8000-000000000001',true);
create temporary table finance_reports as select
 public.get_finance_reporting('2026-02-01','2026-02-28')#>'{rows,0}' as feb,
 public.get_finance_reporting('2026-03-01','2026-03-31')#>'{rows,0}' as march;
select is((select (feb->>'recordedSalesCents')::bigint from finance_reports),13000::bigint,'Recorded sales include card and cash');
select is((select (feb->>'cardRecordedSalesCents')::bigint from finance_reports),11000::bigint,'Card recorded basis retained');
select is((select (feb->>'cashRecordedSalesCents')::bigint from finance_reports),2000::bigint,'Cash reporting retains historical sales');
select is((select (feb->>'reportingTaxRemovedCents')::bigint from finance_reports),1000::bigint,'Reporting tax removed uses canonical normalization');
select is((select (feb->>'salesExTaxCents')::bigint from finance_reports),12000::bigint,'Canonical sales basis retained');
select is((select (feb->>'requestedDeductionExTaxCents')::bigint from finance_reports),2000::bigint,'Requested basis books both affected portions in February');
select is((select (feb->>'netSalesExTaxCents')::bigint from finance_reports),10000::bigint,'Finance net reconciles canonical equation');
select is((select (feb->>'grossSalesIncludingTaxCents')::bigint from finance_reports),13000::bigint,'Gross includes full untaxed cash plus card charge');
select is((select (feb->>'refundDeductionIncludingTaxCents')::bigint from finance_reports),2200::bigint,'Gross request deductions are retained before separating refund tax');
select is((select (feb->>'remainingTaxCents')::bigint from finance_reports),800::bigint,'Remaining tax subtracts tax on requested refunds once');
select is((select (feb->>'completedRefundExTaxCents')::bigint from finance_reports),0::bigint,'Unpaid requests are absent from completed-refund reconciliation');
select is((select (feb->>'reconciliationNetSalesExTaxCents')::bigint from finance_reports),12000::bigint,'Reconciliation uses completed payments independently of request accounting');
select is((select (march->>'completedRefundExTaxCents')::bigint from finance_reports),600::bigint,'Partial completed payment tax uses original purchase date and includes known exclusive legacy payment');
select is((select (feb->>'asOfOutstandingCents')::bigint from finance_reports),2200::bigint,'February outstanding ignores later payment and gift');
select is((select (march->>'moneyPaidCents')::bigint from finance_reports),640::bigint,'Recorded money includes partial and independent legacy paid facts');
select is((select (march->>'giftPurchaseCents')::bigint from finance_reports),1100::bigint,'Gift affected value does not use full purchase');
select is((select (march->>'giftFaceCents')::bigint from finance_reports),1500::bigint,'Gift face value is separate');
select is((select (march->>'goodwillCents')::bigint from finance_reports),400::bigint,'Goodwill is separate');
select is((select (march->>'requestedDeductionExTaxCents')::bigint from finance_reports),0::bigint,'Later payment and gift do not deduct again');
select is((select (march->>'legacyPaidDeductionExTaxCents')::bigint from finance_reports),200::bigint,'Independent legacy paid fact remains canonical fallback');
select is((select (march->>'asOfOutstandingCents')::bigint from finance_reports),660::bigint,'Partial money and affected gift resolve balance once');
select is((select (feb#>>'{coverage,unknownBalanceCount}')::int from finance_reports),1,'Legacy missing immutable history stays unknown');
select ok((select feb::text not like '%example.invalid%' and feb::text not like '%Private%' from finance_reports),'No customer, code or free-text data returned');
select is(jsonb_array_length(public.get_finance_reporting('2026-02-01','2026-02-28',array['fb740000-0000-4000-8000-000000000002']::uuid[])->'rows'),0,'Forged machine filter cannot broaden access');
select ok(not has_function_privilege('anon','public.get_finance_reporting(date,date,uuid[],uuid[])','EXECUTE'),'Anonymous endpoint execution revoked');
select ok(not has_function_privilege('authenticated','private.finance_reporting_machine_scope(uuid)','EXECUTE'),'Private actor lookup never exposed');
select is((select provolatile::text from pg_proc where oid='public.get_finance_reporting(date,date,uuid[],uuid[])'::regprocedure),'s','Finance is read-only STABLE');
select throws_ok($$select public.get_finance_reporting('2025-01-01','2026-03-01')$$,'22023',null,'Unbounded scans rejected');
select set_config('request.jwt.claim.sub','fb710000-0000-4000-8000-000000000002',true);
select is((public.get_finance_reporting_access()->>'hasAccess')::boolean,false,'Sales access does not grant refund finance scope');
select throws_ok($$select public.get_finance_reporting('2026-02-01','2026-02-28')$$,'42501',null,'Direct sales-only call denied');
select set_config('request.jwt.claim.sub','fb710000-0000-4000-8000-000000000003',true);
select is((public.get_finance_reporting_access()->>'hasAccess')::boolean,false,'Refund scope does not grant sales');
select throws_ok($$select public.get_finance_reporting('2026-02-01','2026-02-28')$$,'42501',null,'Direct refund-only call denied');
select set_config('request.jwt.claim.sub','fb710000-0000-4000-8000-000000000001',true);
set local role authenticated;
select is(jsonb_array_length(public.get_finance_reporting('2026-02-01','2026-02-28')->'rows'),1,'Authenticated role can call guarded read API');
reset role;
-- Historical-only payment and recognition locations remain selectable even
-- without current machine placement, original sales, or a case at that location.
set local session_replication_role=replica;
insert into public.reporting_locations(id,account_id,name,timezone) values
 ('fb730000-0000-4000-8000-000000000002','fb720000-0000-4000-8000-000000000001','Paid archive','America/Los_Angeles'),
 ('fb730000-0000-4000-8000-000000000003','fb720000-0000-4000-8000-000000000001','Recognition archive','America/Los_Angeles');
insert into public.sales_adjustment_facts(reporting_machine_id,reporting_location_id,adjustment_date,
 adjustment_type,amount_cents,source,source_row_hash,raw_payload,created_at)
 values('fb740000-0000-4000-8000-000000000001','fb730000-0000-4000-8000-000000000002','2026-06-01',
 'refund',321,'manual',repeat('6',64),'{"amountBasis":"tax_exclusive"}','2025-12-01');
insert into private.refund_request_recognition_events(event_key,refund_case_id,event_kind,effective_at,recorded_at,
 booking_date,reporting_machine_id,reporting_location_id,tender,source,purchase_attribution_date,
 request_target_before_cents,request_target_after_cents,recognized_target_before_cents,recognized_target_after_cents,amount_basis,amount_provenance)
 values('finance:historic-location','fb750000-0000-4000-8000-000000000003','late_request_opening','2026-06-01T12:00Z','2026-06-01T12:00Z',
 '2026-06-01','fb740000-0000-4000-8000-000000000001','fb730000-0000-4000-8000-000000000003','card','hosted_refund_intake',
 '2026-02-01',0,500,0,500,'tax_inclusive','synthetic');
set local session_replication_role=origin;
select ok(exists(select 1 from jsonb_array_elements(public.get_finance_reporting_access()->'dimensions') d
 where d->>'locationId'='fb730000-0000-4000-8000-000000000002'),'Independent historical payment location is selectable');
select ok(exists(select 1 from jsonb_array_elements(public.get_finance_reporting_access()->'dimensions') d
 where d->>'locationId'='fb730000-0000-4000-8000-000000000003'),'Immutable historical recognition location is selectable');
select is((public.get_finance_reporting('2026-06-01','2026-06-30',null,array['fb730000-0000-4000-8000-000000000002']::uuid[])#>>'{rows,0,moneyPaidCents}')::bigint,321::bigint,'Selected historical-only payment location reconciles recorded money');
select is((public.get_finance_reporting('2026-06-01','2026-06-30',null,array['fb730000-0000-4000-8000-000000000002']::uuid[])#>>'{rows,0,legacyPaidDeductionExTaxCents}')::bigint,321::bigint,'Historical-only payment location retains canonical legacy deduction');
select is((public.get_finance_reporting('2026-06-01','2026-06-30',null,array['fb730000-0000-4000-8000-000000000003']::uuid[])#>>'{rows,0,requestedDeductionExTaxCents}')::bigint,455::bigint,'Selected immutable recognition location retains canonical request impact');
-- April amount change does not rewrite the original month or deduct payment twice.
set local session_replication_role=replica;
insert into private.refund_request_recognition_events(event_key,refund_case_id,event_kind,effective_at,recorded_at,
 booking_date,reporting_machine_id,reporting_location_id,tender,source,purchase_attribution_date,
 request_target_before_cents,request_target_after_cents,paid_cumulative_cents,
 recognized_target_before_cents,recognized_target_after_cents,amount_basis,amount_provenance)
 values('finance:denied','fb750000-0000-4000-8000-000000000001','denied','2026-04-01T12:00Z','2026-04-01T12:00Z',
 '2026-04-01','fb740000-0000-4000-8000-000000000001','fb730000-0000-4000-8000-000000000001','card','hosted_refund_intake',
 '2026-02-01',1100,0,440,1100,440,'tax_inclusive','synthetic');
insert into public.machine_sales_facts(reporting_machine_id,reporting_location_id,sale_date,payment_method,
 net_sales_cents,transaction_count,source,source_row_hash,raw_payload)
 values('fb740000-0000-4000-8000-000000000001','fb730000-0000-4000-8000-000000000001','2026-05-01','credit',1234,1,'manual_csv',repeat('1',64),'{}');
insert into public.refund_authoritative_receipts(refund_case_id,reporting_machine_id,account_scope,provider_machine_id,
 original_transaction_id,original_amount_cents,refunded_amount_cents,currency_code,provider_status,
 evidence_reference_digest,observed_at,recorded_by,attempt_binding_kind,current_provider_observation_reviewed)
 values('fb750000-0000-4000-8000-000000000003','fb740000-0000-4000-8000-000000000001','fixture-account','fixture-device',
 'private-transaction',500,500,'USD',62,repeat('2',64),'2026-05-02T12:00Z','fb710000-0000-4000-8000-000000000001',
 'no_attempt_integrity_hold',true);
set local session_replication_role=origin;
select is((public.get_finance_reporting('2026-04-01','2026-04-30')#>>'{rows,0,reversalExTaxCents}')::bigint,600::bigint,'Change period reverses only unpaid normalized amount');
select is((public.get_finance_reporting('2026-04-01','2026-04-30')#>>'{rows,0,netSalesExTaxCents}')::bigint,600::bigint,'Reversal is positive activity in April');
select is((public.get_finance_reporting('2026-02-01','2026-02-28')#>>'{rows,0,requestedDeductionExTaxCents}')::bigint,2000::bigint,'Later denial leaves February untouched');
select ok(public.get_finance_reporting('2026-05-01','2026-05-31')#>'{rows,0,salesExTaxCents}'='null'::jsonb,'Unknown source accounting is unavailable, not zero');
select ok(public.get_finance_reporting('2026-05-01','2026-05-31')#>'{rows,0,netSalesExTaxCents}'='null'::jsonb,'Unknown sales cannot produce apparently complete net');
select is((public.get_finance_reporting('2026-05-01','2026-05-31')#>>'{rows,0,coverage,unknownPaymentDateCount}')::int,1,'Observed money without payment date stays out of period activity');
select is((public.get_finance_reporting('2026-05-01','2026-05-31')#>>'{rows,0,moneyPaidCents}')::bigint,0::bigint,'Undated receipt is never attributed to observed date');

-- A malformed duplicate or backlink cannot reveal hidden financial evidence.
select is((public.get_refund_analytics('2026-03-01','2026-03-31')#>>'{period,legacyPaidDeductionExTaxCents}')::bigint,
  200::bigint,'Refund report retains authorized independent legacy paid deductions');
set local session_replication_role=replica;
insert into public.refund_cases(id,public_reference,reporting_machine_id,reporting_location_id,customer_email,
 issue_summary,incident_at,payment_method,payment_amount_cents,refund_amount_cents,status,duplicate_of_refund_case_id) values
 ('fb750000-0000-4000-8000-000000000004','RF-FINANCE-4','fb740000-0000-4000-8000-000000000002','fb730000-0000-4000-8000-000000000001',
 'hidden@example.invalid','Hidden duplicate','2026-02-01T12:00Z','card',99999,99999,'completed','fb750000-0000-4000-8000-000000000001');
insert into public.sales_adjustment_facts(reporting_machine_id,reporting_location_id,adjustment_date,
 adjustment_type,amount_cents,source,source_row_hash,refund_case_id,raw_payload,created_at) values
 ('fb740000-0000-4000-8000-000000000002','fb730000-0000-4000-8000-000000000001','2026-03-01','refund',99999,'manual',repeat('3',64),'fb750000-0000-4000-8000-000000000004','{"amountBasis":"tax_exclusive"}','2025-12-01'),
 ('fb740000-0000-4000-8000-000000000001','fb730000-0000-4000-8000-000000000001','2026-03-03','refund',88888,'manual',repeat('4',64),'fb750000-0000-4000-8000-000000000004','{"amountBasis":"tax_exclusive"}','2025-12-01');
insert into public.refund_cases(id,public_reference,reporting_machine_id,reporting_location_id,customer_email,
 issue_summary,incident_at,payment_method,payment_amount_cents,refund_amount_cents,status,case_population,
 automation_state,internal_test_reason,internal_test_classified_at,internal_test_classified_by)
 values('fb750000-0000-4000-8000-000000000005','RF-FINANCE-5','fb740000-0000-4000-8000-000000000001','fb730000-0000-4000-8000-000000000001',
 'test@example.invalid','Private internal test','2026-02-01T12:00Z','card',77777,77777,'closed','internal_test',
 'closed_incomplete','provider_test','2026-03-01T12:00Z','fb710000-0000-4000-8000-000000000001');
insert into public.sales_adjustment_facts(reporting_machine_id,reporting_location_id,adjustment_date,
 adjustment_type,amount_cents,source,source_row_hash,refund_case_id,raw_payload,created_at)
 values('fb740000-0000-4000-8000-000000000001','fb730000-0000-4000-8000-000000000001','2026-03-04','refund',77777,'manual',repeat('5',64),
 'fb750000-0000-4000-8000-000000000005','{"amountBasis":"tax_exclusive"}','2025-12-01');
set local session_replication_role=origin;
select ok(public.get_refund_analytics('2026-03-03','2026-03-03')#>'{period,legacyPaidDeductionExTaxCents}'='null'::jsonb,
  'Refund accounting never reveals a hidden customer case through a visible-machine adjustment');
select ok(public.get_refund_analytics('2026-03-04','2026-03-04')#>'{period,legacyPaidDeductionExTaxCents}'='null'::jsonb,
  'Refund accounting never includes internal-test adjustments in customer totals');
select ok(public.get_refund_analytics('2026-03-01','2026-03-31')#>'{period,requestDeductionExTaxCents}'='null'::jsonb
  and public.get_refund_analytics('2026-03-01','2026-03-31')#>'{period,reversalExTaxCents}'='null'::jsonb,
  'Restricted components make all grouped refund accounting explicitly unavailable');
select is((public.get_refund_analytics('2026-03-02','2026-03-02')#>>'{period,legacyPaidDeductionExTaxCents}')::bigint,
  200::bigint,'A safe filtered date still retains its authorized legacy paid adjustment');
select is((public.get_refund_analytics('2026-03-01','2026-03-31')#>>'{period,cashPaidCents}')::bigint,
  440::bigint,'Restricted accounting does not hide authorized case-linked payment activity');
select is((public.get_refund_analytics('2026-03-01','2026-03-31')#>>'{period,giftPurchaseCents}')::bigint,
  1100::bigint,'Restricted accounting does not hide authorized gift recovery');
select ok((public.get_refund_analytics('2026-03-01','2026-03-31')#>>'{period,unresolvedAccountingCount}')::bigint>0,
  'Unavailable restricted accounting has explicit coverage');
select is((public.get_finance_reporting('2026-03-01','2026-03-31')#>>'{rows,0,moneyPaidCents}')::bigint,640::bigint,'Hidden and internal-test payments excluded from recorded money');
select ok(public.get_finance_reporting('2026-03-01','2026-03-31')#>'{rows,0,netSalesExTaxCents}'='null'::jsonb,'Restricted accounting is unavailable rather than leaking canonical legacy amounts');
select is((public.get_finance_reporting('2026-03-01','2026-03-31')#>>'{rows,0,coverage,unknownBalanceCount}')::int,2,'Cross-scope lineage marks balance unknown without revealing hidden recovery');
select ok(public.get_finance_reporting('2026-03-01','2026-03-31')::text not like '%88888%'
 and public.get_finance_reporting('2026-03-01','2026-03-31')::text not like '%77777%'
 and public.get_finance_reporting('2026-03-01','2026-03-31')::text not like '%99999%','Restricted amounts never enter API payload');
set local session_replication_role=replica;
insert into public.reporting_locations(id,account_id,name,timezone)
 values('fb730000-0000-4000-8000-000000000004','fb720000-0000-4000-8000-000000000001','Restricted archive','America/Los_Angeles');
insert into public.sales_adjustment_facts(id,reporting_machine_id,reporting_location_id,adjustment_date,
 adjustment_type,amount_cents,source,source_row_hash,refund_case_id,raw_payload,created_at)
 values('fb760000-0000-4000-8000-000000000001','fb740000-0000-4000-8000-000000000001','fb730000-0000-4000-8000-000000000004','2026-03-01',
 'refund',55555,'manual',repeat('7',64),null,'{"amountBasis":"tax_exclusive"}','2025-12-01');
update public.refund_cases set reporting_adjustment_id='fb760000-0000-4000-8000-000000000001'
 where id='fb750000-0000-4000-8000-000000000004';
insert into private.refund_request_recognition_events(event_key,refund_case_id,event_kind,effective_at,recorded_at,
 booking_date,reporting_machine_id,reporting_location_id,tender,source,purchase_attribution_date,
 request_target_before_cents,request_target_after_cents,recognized_target_before_cents,recognized_target_after_cents,amount_basis,amount_provenance)
 values('finance:hidden-recognition','fb750000-0000-4000-8000-000000000004','late_request_opening',
 '2026-08-01T12:00Z','2026-08-01T12:00Z','2026-08-01','fb740000-0000-4000-8000-000000000001',
 'fb730000-0000-4000-8000-000000000001','card','synthetic_fixture','2026-02-01',0,66666,0,66666,'tax_exclusive','synthetic');
set local session_replication_role=origin;
select ok(public.get_refund_analytics('2026-03-01','2026-03-01',null,
 array['fb730000-0000-4000-8000-000000000004']::uuid[])#>'{period,legacyPaidDeductionExTaxCents}'='null'::jsonb,
  'A hidden customer backlink with no direct case ID cannot leak through location-filtered accounting');
select ok(public.get_refund_analytics('2026-08-01','2026-08-01')#>'{period,requestDeductionExTaxCents}'='null'::jsonb,
  'Hidden recognition event cannot leak a requested deduction through a visible machine');
select ok(public.get_refund_analytics('2026-03-01','2026-03-31')::text not like '%88888%'
 and public.get_refund_analytics('2026-03-01','2026-03-31')::text not like '%77777%'
 and public.get_refund_analytics('2026-03-01','2026-03-31')::text not like '%55555%'
 and public.get_refund_analytics('2026-08-01','2026-08-01')::text not like '%66666%',
  'Restricted payment and recognition amounts never enter the refund API payload');
select ok(not exists(select 1 from jsonb_array_elements(public.get_finance_reporting_access()->'dimensions') d
 where d->>'locationId'='fb730000-0000-4000-8000-000000000004'),'Restricted-only payment location does not broaden selectable dimensions');
select is(jsonb_array_length(public.get_finance_reporting('2026-03-01','2026-03-31',null,array['fb730000-0000-4000-8000-000000000004']::uuid[])->'rows'),0,'Restricted-only location cannot expose a component row');
-- Instrument only the disposable fixture transaction. Preserve the real refund
-- calculation in a temporary clone so both complete JSON parity and the number
-- of actual evaluations are checked without a timing-dependent assertion.
create temporary table finance_projection_definitions as select
  pg_get_functiondef('public.get_refund_analytics(date,date,uuid[],uuid[])'::regprocedure) as refund_definition;
create temporary table finance_projection_baseline as select
  public.get_finance_reporting('2026-03-01','2026-03-31')-'generatedAt' as payload;
do $instrument$
begin
  execute replace((select refund_definition from finance_projection_definitions),
    'FUNCTION public.get_refund_analytics(', 'FUNCTION pg_temp.finance_counted_refund_original(');
end;
$instrument$;
create temporary sequence finance_refund_projection_calls;
create or replace function public.get_refund_analytics(
  p_date_from date,p_date_to date,p_machine_ids uuid[] default null,p_location_ids uuid[] default null
) returns jsonb language plpgsql stable security definer set search_path='' as $counted$
begin
  perform nextval('pg_temp.finance_refund_projection_calls'::regclass);
  return pg_temp.finance_counted_refund_original(p_date_from,p_date_to,p_machine_ids,p_location_ids);
end;
$counted$;
create temporary table finance_projection_counted as select
  public.get_finance_reporting('2026-03-01','2026-03-31')-'generatedAt' as payload;
select is((select payload from finance_projection_counted),
  (select payload from finance_projection_baseline),'Instrumented projection preserves the complete Finance JSON including unavailable coverage');
select ok((select jsonb_array_length(payload->'rows')>=2 from finance_projection_counted),
  'The call-count fixture exercises multiple historical/current dimensions');
select is((select last_value from finance_refund_projection_calls),
  (select jsonb_array_length(payload->'rows')::bigint from finance_projection_counted),
  'Finance evaluates the refund projection exactly once per historical/current dimension');
select setval('pg_temp.finance_refund_projection_calls',1,false);
create temporary table finance_projection_filtered as select public.get_finance_reporting('2026-03-01','2026-03-31',null,
  array['fb730000-0000-4000-8000-000000000002']::uuid[]) as payload;
select is((select last_value from finance_refund_projection_calls),1::bigint,
  'A selected historical location evaluates one refund projection');
select is(jsonb_array_length((select payload from finance_projection_filtered)->'rows'),1,
  'A selected historical location returns exactly its existing dimension');
select setval('pg_temp.finance_refund_projection_calls',1,false);
select is(jsonb_array_length(public.get_finance_reporting('2026-03-01','2026-03-31','{}'::uuid[],null)->'rows'),0,
  'An empty machine selection is deny-all after materialization');
select is(jsonb_array_length(public.get_finance_reporting('2026-03-01','2026-03-31',null,'{}'::uuid[])->'rows'),0,
  'An empty location selection is deny-all after materialization');
select is(jsonb_array_length(public.get_finance_reporting('2026-03-01','2026-03-31',array['fb740000-0000-4000-8000-000000000002']::uuid[],null)->'rows'),0,
  'An unauthorized machine selection never creates a materialized dimension');
select ok(not (select is_called from finance_refund_projection_calls),
  'Empty selections never evaluate any refund projection');
-- Restore the original body for later tests sharing this disposable session.
do $restore$ begin execute (select refund_definition from finance_projection_definitions); end; $restore$;
-- The access projection must retain sales-only historical placements outside
-- the selected dates, collapse repeated sales to one placement, and exclude
-- every location seen only in another machine's facts.
set local session_replication_role=replica;
insert into public.reporting_locations(id,account_id,name,timezone) values
 ('fb730000-0000-4000-8000-000000000005','fb720000-0000-4000-8000-000000000001','Sales archive','America/Los_Angeles'),
 ('fb730000-0000-4000-8000-000000000006','fb720000-0000-4000-8000-000000000001','Hidden sales archive','America/Los_Angeles');
insert into public.machine_sales_facts(reporting_machine_id,reporting_location_id,sale_date,payment_method,
 net_sales_cents,transaction_count,source,source_row_hash,raw_payload) values
 ('fb740000-0000-4000-8000-000000000001','fb730000-0000-4000-8000-000000000005','2020-02-01','credit',1000,1,'manual_csv',repeat('8',64),'{"amountBasis":"tax_exclusive"}'),
 ('fb740000-0000-4000-8000-000000000001','fb730000-0000-4000-8000-000000000005','2020-02-02','cash',2000,2,'manual_csv',repeat('9',64),'{"amountBasis":"tax_exclusive"}'),
 ('fb740000-0000-4000-8000-000000000002','fb730000-0000-4000-8000-000000000006','2020-02-01','credit',99999,1,'manual_csv',repeat('0',64),'{"amountBasis":"tax_exclusive"}');
set local session_replication_role=origin;
select is((select count(*) from jsonb_array_elements(public.get_finance_reporting_access()->'dimensions') d
 where d->>'locationId'='fb730000-0000-4000-8000-000000000005'),1::bigint,
 'Repeated sales preserve exactly one authorized historical-only location');
select ok(not exists(select 1 from jsonb_array_elements(public.get_finance_reporting_access()->'dimensions') d
 where d->>'locationId'='fb730000-0000-4000-8000-000000000006'),
 'A sales-only historical location on an unauthorized machine never broadens access');
select is(jsonb_array_length(public.get_finance_reporting('2025-10-02','2026-10-01',null,
 array['fb730000-0000-4000-8000-000000000005']::uuid[])->'rows'),1,
 'Annual Finance retains the authorized historical dimension outside the selected period');
select is((public.get_finance_reporting('2025-10-02','2026-10-01',null,
 array['fb730000-0000-4000-8000-000000000005']::uuid[])#>>'{rows,0,recordedSalesCents}')::bigint,0::bigint,
 'Retaining a historical dimension does not pull outside-period sales into annual totals');
select * from finish();
rollback;
