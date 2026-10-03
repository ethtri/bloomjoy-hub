begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();

-- Synthetic immutable evidence fixtures. No provider/outbox/automation runs.
set local session_replication_role=replica;
insert into auth.users(id,email) values
 ('fa710000-0000-4000-8000-000000000001','refund-manager@example.invalid'),
 ('fa710000-0000-4000-8000-000000000002','sales-viewer@example.invalid');
insert into public.customer_accounts(id,name,account_type)
 values('fa720000-0000-4000-8000-000000000001','Analytics synthetic fixtures','internal');
insert into public.reporting_locations(id,account_id,name,timezone)
 values('fa730000-0000-4000-8000-000000000001','fa720000-0000-4000-8000-000000000001','Analytics fixture','America/Los_Angeles');
insert into public.reporting_machines(id,account_id,location_id,machine_label,status) values
 ('fa740000-0000-4000-8000-000000000001','fa720000-0000-4000-8000-000000000001','fa730000-0000-4000-8000-000000000001','Authorized fixture','active'),
 ('fa740000-0000-4000-8000-000000000002','fa720000-0000-4000-8000-000000000001','fa730000-0000-4000-8000-000000000001','Unauthorized fixture','active');
insert into public.reporting_machine_refund_managers(reporting_machine_id,manager_user_id,manager_email,status)
 values('fa740000-0000-4000-8000-000000000001','fa710000-0000-4000-8000-000000000001','refund-manager@example.invalid','active');
insert into public.reporting_machine_tax_rates(machine_id,tax_rate_percent,effective_start_date,status)
 values('fa740000-0000-4000-8000-000000000001',0,'2020-01-01','active');
insert into private.refund_request_recognition_rollout(singleton,activated_at,activated_by)
 values(true,'2026-01-01','Synthetic analytics test');
insert into public.refund_cases(id,public_reference,reporting_machine_id,reporting_location_id,
 customer_email,issue_summary,incident_at,payment_method,payment_amount_cents,refund_amount_cents,
 status,customer_request_received_at,customer_request_received_source) values
 ('fa750000-0000-4000-8000-000000000001','RF-ANALYTICS-1','fa740000-0000-4000-8000-000000000001','fa730000-0000-4000-8000-000000000001','fixture1@example.invalid','Private free text must never appear','2026-02-01T12:00Z','card',1000,1000,'completed','2026-02-01T12:00Z','hosted_refund_intake'),
 ('fa750000-0000-4000-8000-000000000002','RF-ANALYTICS-2','fa740000-0000-4000-8000-000000000001','fa730000-0000-4000-8000-000000000001','fixture2@example.invalid','Synthetic partial','2026-02-02T12:00Z','card',3000,1000,'needs_review','2026-02-02T12:00Z','hosted_refund_intake'),
 ('fa750000-0000-4000-8000-000000000003','RF-ANALYTICS-3','fa740000-0000-4000-8000-000000000001','fa730000-0000-4000-8000-000000000001','fixture3@example.invalid','Synthetic gift','2026-02-02T12:00Z','card',1100,1100,'completed','2026-02-02T12:00Z','hosted_refund_intake'),
 ('fa750000-0000-4000-8000-000000000004','RF-ANALYTICS-4','fa740000-0000-4000-8000-000000000001','fa730000-0000-4000-8000-000000000001','fixture4@example.invalid','Missing immutable history','2026-02-02T12:00Z','card',500,500,'denied','2026-02-02T12:00Z','hosted_refund_intake'),
 ('fa750000-0000-4000-8000-000000000005','RF-ANALYTICS-5','fa740000-0000-4000-8000-000000000002','fa730000-0000-4000-8000-000000000001','fixture5@example.invalid','Outside manager scope','2026-02-02T12:00Z','card',99999,99999,'needs_review','2026-02-02T12:00Z','hosted_refund_intake'),
 ('fa750000-0000-4000-8000-000000000006','RF-ANALYTICS-6','fa740000-0000-4000-8000-000000000001','fa730000-0000-4000-8000-000000000001','fixture6@example.invalid','Confirmed duplicate','2026-02-02T12:00Z','card',1000,1000,'needs_review','2026-02-02T12:00Z','hosted_refund_intake');
update public.refund_cases set duplicate_of_refund_case_id='fa750000-0000-4000-8000-000000000002'
 where id='fa750000-0000-4000-8000-000000000006';
-- Same transaction evidence on independent claims does not collapse requests.
update public.refund_cases set matched_nayax_transaction_id='same-purchase-fixture'
 where id in ('fa750000-0000-4000-8000-000000000001','fa750000-0000-4000-8000-000000000002');
insert into private.refund_request_recognition_events(event_key,refund_case_id,event_kind,effective_at,recorded_at,
 booking_date,reporting_machine_id,reporting_location_id,tender,source,purchase_attribution_date,
 request_target_before_cents,request_target_after_cents,recognized_target_before_cents,recognized_target_after_cents,amount_basis,amount_provenance)
 select 'analytics:'||id,id,'request_received','2026-02-02T12:00Z','2026-02-02T12:00Z','2026-02-02',
 reporting_machine_id,reporting_location_id,'card','hosted_refund_intake','2026-02-02',0,refund_amount_cents,
 0,refund_amount_cents,'tax_inclusive','synthetic' from public.refund_cases
 where id in ('fa750000-0000-4000-8000-000000000001','fa750000-0000-4000-8000-000000000002','fa750000-0000-4000-8000-000000000003');
insert into public.sales_adjustment_facts(id,reporting_machine_id,reporting_location_id,adjustment_date,
 adjustment_type,amount_cents,complaint_count,source,source_row_hash,refund_case_id,raw_payload) values
 ('fa760000-0000-4000-8000-000000000001','fa740000-0000-4000-8000-000000000001','fa730000-0000-4000-8000-000000000001','2026-03-01','refund',1000,1,'manual',repeat('7',64),'fa750000-0000-4000-8000-000000000001','{"amountBasis":"tax_inclusive","payment_method":"card"}'),
 ('fa760000-0000-4000-8000-000000000002','fa740000-0000-4000-8000-000000000001','fa730000-0000-4000-8000-000000000001','2026-03-02','refund',400,1,'manual',repeat('8',64),'fa750000-0000-4000-8000-000000000006','{"amountBasis":"tax_inclusive","payment_method":"card"}');
insert into public.refund_gift_card_issuances(refund_case_id,code_id,pool_id,normalized_email,
 purchase_amount_cents,face_value_cents,goodwill_amount_cents,currency,eligible_locations,expires_at,
 redemption_instructions,message_id,message_identity_digest,issued_at)
 values('fa750000-0000-4000-8000-000000000003',gen_random_uuid(),gen_random_uuid(),'gift@example.invalid',1100,1500,400,'USD',array['Fixture'],'2027-01-01','Private instructions',gen_random_uuid(),repeat('f',64),'2026-03-02T12:00Z');
set local session_replication_role=origin;

select set_config('request.jwt.claim.sub','fa710000-0000-4000-8000-000000000001',true);
create temporary table analytics_reports as select
 public.get_refund_analytics('2026-02-01','2026-02-28') as feb,
 public.get_refund_analytics('2026-03-01','2026-03-31') as march,
 public.get_refund_analytics('2026-02-01','2026-03-31') as combined;
select is((select (feb#>>'{cohort,requestCount}')::int from analytics_reports),4,'Unique requests exclude only confirmed duplicate lineage and unauthorized scope');
select is((select (feb#>>'{cohort,requestedCents}')::int from analytics_reports),3100,'Canonical received targets include reviewed affected portion, not full purchase');
select is((select (feb#>>'{cohort,unknownAmountCount}')::int from analytics_reports),1,'No historical amount fabricated from current denied state');
select is((select (feb#>>'{asOf,outstandingCents}')::int from analytics_reports),3100,'February balance does not subtract future cash or gift issuance');
select is((select (march#>>'{asOf,outstandingCents}')::int from analytics_reports),600,'March balance subtracts paid duplicate lineage and gift purchase once');
select is((select (march#>>'{period,cashPaidCents}')::int from analytics_reports),1400,'Cross-month recorded money is March activity');
select is((select (march#>>'{period,giftPurchaseCents}')::int from analytics_reports),1100,'Gift purchase portion separate from money');
select is((select (march#>>'{period,giftFaceCents}')::int from analytics_reports),1500,'Gift face value preserved');
select is((select (march#>>'{period,goodwillCents}')::int from analytics_reports),400,'Goodwill is separate');
select is((select (combined#>>'{period,requestDeductionExTaxCents}')::int from analytics_reports),3100,'Canonical accounting deducts received targets once');
select is((select (march#>>'{period,requestDeductionExTaxCents}')::int from analytics_reports),0,'Later money and gift recovery do not deduct again');
select is((select (feb#>>'{asOf,unknownBalanceCount}')::int from analytics_reports),1,'Missing immutable history stays unknown');
select ok((select feb::text not like '%example.invalid%' and feb::text not like '%Private%' and feb::text not like '%same-purchase%' from analytics_reports),'No customer identifiers, free text or transaction data returned');
select is((public.get_refund_analytics('2026-02-01','2026-02-28',array['fa740000-0000-4000-8000-000000000002']::uuid[])#>>'{cohort,requestCount}')::int,0,'Forged machine filter does not broaden authority');
select is((public.get_refund_analytics_access()->>'hasAccess')::boolean,true,'Assigned manager has independent analytics authority');
select is((select provolatile::text from pg_proc where oid='public.get_refund_analytics(date,date,uuid[],uuid[])'::regprocedure),'s','Analytics endpoint is STABLE');
select ok(not has_function_privilege('anon','public.get_refund_analytics(date,date,uuid[],uuid[])','EXECUTE'),'Anonymous role cannot execute endpoint');
select throws_ok($$select public.get_refund_analytics('2025-01-01','2026-03-01')$$,'22023',null,'Long periods rejected before aggregate scan');

-- Change-period reversal: only the unpaid $6 reverses, original February stays intact.
set local session_replication_role=replica;
insert into private.refund_request_recognition_events(event_key,refund_case_id,event_kind,effective_at,recorded_at,
 booking_date,reporting_machine_id,reporting_location_id,tender,source,purchase_attribution_date,
 request_target_before_cents,request_target_after_cents,paid_cumulative_cents,
 recognized_target_before_cents,recognized_target_after_cents,amount_basis,amount_provenance)
 values('analytics:denied','fa750000-0000-4000-8000-000000000002','denied','2026-04-01T12:00Z','2026-04-01T12:00Z',
 '2026-04-01','fa740000-0000-4000-8000-000000000001','fa730000-0000-4000-8000-000000000001',
 'card','hosted_refund_intake','2026-02-02',1000,0,400,1000,400,'tax_inclusive','synthetic');
insert into private.refund_request_recognition_events(event_key,refund_case_id,event_kind,effective_at,recorded_at,
 booking_date,reporting_machine_id,reporting_location_id,tender,source,purchase_attribution_date,
 request_target_before_cents,request_target_after_cents,recognized_target_before_cents,recognized_target_after_cents,amount_basis,amount_provenance)
 values('analytics:late','fa750000-0000-4000-8000-000000000004','late_request_opening','2026-04-01T12:00Z','2026-04-01T12:00Z',
 '2026-04-01','fa740000-0000-4000-8000-000000000001','fa730000-0000-4000-8000-000000000001',
 'card','hosted_refund_intake','2026-02-02',0,500,0,500,'tax_inclusive','synthetic');
set local session_replication_role=origin;
select is((public.get_refund_analytics('2026-04-01','2026-04-30')#>>'{period,reversalExTaxCents}')::int,600,'Denial reverses only unpaid amount in the change period');
select is((public.get_refund_analytics('2026-02-01','2026-02-28')#>>'{period,requestDeductionExTaxCents}')::int,3100,'Later denial preserves original request-period accounting');
select is((public.get_refund_analytics('2026-02-01','2026-02-28')#>>'{cohort,unknownAmountCount}')::int,1,'Future late opening cannot reveal a historical cohort amount');

-- Deliberately corrupt cross-machine lineage must not disclose the hidden payment/gift.
set local session_replication_role=replica;
insert into public.refund_cases(id,public_reference,reporting_machine_id,reporting_location_id,customer_email,
 issue_summary,incident_at,payment_method,payment_amount_cents,refund_amount_cents,status,duplicate_of_refund_case_id)
 values('fa750000-0000-4000-8000-000000000007','RF-ANALYTICS-7','fa740000-0000-4000-8000-000000000002','fa730000-0000-4000-8000-000000000001',
 'hidden@example.invalid','Hidden duplicate','2026-02-02T12:00Z','card',99999,99999,'completed','fa750000-0000-4000-8000-000000000002');
insert into public.sales_adjustment_facts(id,reporting_machine_id,reporting_location_id,adjustment_date,
 adjustment_type,amount_cents,complaint_count,source,source_row_hash,refund_case_id,raw_payload)
 values(gen_random_uuid(),'fa740000-0000-4000-8000-000000000002','fa730000-0000-4000-8000-000000000001','2026-03-02',
 'refund',99999,1,'manual',repeat('9',64),'fa750000-0000-4000-8000-000000000007','{"amountBasis":"tax_inclusive"}');
insert into public.refund_gift_card_issuances(refund_case_id,code_id,pool_id,normalized_email,
 purchase_amount_cents,face_value_cents,goodwill_amount_cents,currency,eligible_locations,expires_at,
 redemption_instructions,message_id,message_identity_digest,issued_at)
 values('fa750000-0000-4000-8000-000000000007',gen_random_uuid(),gen_random_uuid(),'hidden@example.invalid',99999,100000,1,'USD',array['Hidden'],
 '2027-01-01','Hidden instructions',gen_random_uuid(),repeat('e',64),'2026-03-02T12:00Z');
insert into public.reporting_locations(id,account_id,name,timezone)
 values('fa730000-0000-4000-8000-000000000002','fa720000-0000-4000-8000-000000000001','New machine location','America/New_York');
update public.reporting_machines set location_id='fa730000-0000-4000-8000-000000000002'
 where id='fa740000-0000-4000-8000-000000000001';
set local session_replication_role=origin;
select is((public.get_refund_analytics('2026-03-01','2026-03-31')#>>'{period,cashPaidCents}')::int,1400,'Unauthorized duplicate money excluded');
select is((public.get_refund_analytics('2026-03-01','2026-03-31')#>>'{period,giftPurchaseCents}')::int,1100,'Unauthorized duplicate gift excluded');
select is((public.get_refund_analytics('2026-03-01','2026-03-31')#>>'{asOf,unknownBalanceCount}')::int,2,'Cross-scope lineage makes balance unknown instead of revealing hidden recovery');
select is((public.get_refund_analytics('2026-02-01','2026-02-28',null,array['fa730000-0000-4000-8000-000000000001']::uuid[])#>>'{cohort,requestCount}')::int,4,'Historical case location survives machine relocation');
set local role authenticated;
select is((public.get_refund_analytics('2026-02-01','2026-02-28')#>>'{cohort,requestCount}')::int,4,'Authenticated role can execute only the guarded manager projection');
reset role;

-- Current exception receipts preserve original purchase separately from the
-- affected purchase portion. Courtesy change is all goodwill and has no
-- recognition events by design; this never zeroes missing ordinary history.
set local session_replication_role=replica;
insert into public.reporting_machines(id,account_id,location_id,machine_label,status)
 values('fa740000-0000-4000-8000-000000000003','fa720000-0000-4000-8000-000000000001','fa730000-0000-4000-8000-000000000001','Exception analytics fixture','active');
insert into public.reporting_machine_refund_managers(reporting_machine_id,manager_user_id,manager_email,status)
 values('fa740000-0000-4000-8000-000000000003','fa710000-0000-4000-8000-000000000001','refund-manager@example.invalid','active');
insert into public.reporting_machine_tax_rates(machine_id,tax_rate_percent,effective_start_date,status)
 values('fa740000-0000-4000-8000-000000000003',0,'2020-01-01','active');
insert into public.refund_cases(id,public_reference,reporting_machine_id,reporting_location_id,
 customer_email,issue_summary,incident_at,payment_method,payment_amount_cents,refund_amount_cents,
 status,customer_request_received_at,customer_request_received_source,issue_category,resolution_method,
 affected_amount_cents,cash_inserted_amount_cents,expected_change_amount_cents,
 gift_card_pool_id,gift_card_value_cents,gift_card_expires_at,gift_card_state) values
 ('fa750000-0000-4000-8000-000000000008','RF-ANALYTICS-8','fa740000-0000-4000-8000-000000000003','fa730000-0000-4000-8000-000000000001',
 'partial@example.invalid','Partial gift fixture','2026-02-15T12:00Z','card',3000,1000,'completed','2026-02-15T12:00Z','hosted_refund_intake','partial_items','gift_card',1000,null,null,
 gen_random_uuid(),1000,'2027-01-01','issued'),
 ('fa750000-0000-4000-8000-000000000009','RF-ANALYTICS-9','fa740000-0000-4000-8000-000000000003','fa730000-0000-4000-8000-000000000001',
 'courtesy@example.invalid','Issued expected-change courtesy','2026-02-15T12:00Z','cash',1000,0,'completed','2026-02-15T12:00Z','hosted_refund_intake','expected_cash_change','gift_card',9000,10000,9000,
 gen_random_uuid(),9000,'2027-01-01','issued'),
 ('fa750000-0000-4000-8000-000000000010','RF-ANALYTICS-10','fa740000-0000-4000-8000-000000000003','fa730000-0000-4000-8000-000000000001',
 'pending-courtesy@example.invalid','Pending expected-change courtesy','2026-02-15T12:00Z','cash',1000,0,'needs_review','2026-02-15T12:00Z','hosted_refund_intake','expected_cash_change','gift_card',9000,10000,9000,
 gen_random_uuid(),9000,'2027-01-01','manager_review');
insert into private.refund_request_recognition_events(event_key,refund_case_id,event_kind,effective_at,recorded_at,
 booking_date,reporting_machine_id,reporting_location_id,tender,source,purchase_attribution_date,
 request_target_before_cents,request_target_after_cents,recognized_target_before_cents,recognized_target_after_cents,amount_basis,amount_provenance) values
 ('analytics:partial-opening','fa750000-0000-4000-8000-000000000008','request_received','2026-02-15T12:00Z','2026-02-15T12:00Z',
 '2026-02-15','fa740000-0000-4000-8000-000000000003','fa730000-0000-4000-8000-000000000001','card','hosted_refund_intake','2026-02-15',0,3000,0,3000,'tax_inclusive','synthetic'),
 ('analytics:partial-reviewed','fa750000-0000-4000-8000-000000000008','amount_changed','2026-03-04T12:00Z','2026-03-04T12:00Z',
 '2026-03-04','fa740000-0000-4000-8000-000000000003','fa730000-0000-4000-8000-000000000001','card','hosted_refund_intake','2026-02-15',3000,1000,3000,1000,'tax_inclusive','synthetic');
insert into public.refund_gift_card_issuances(refund_case_id,code_id,pool_id,normalized_email,
 purchase_amount_cents,affected_purchase_amount_cents,face_value_cents,goodwill_amount_cents,currency,eligible_locations,expires_at,
 redemption_instructions,message_id,message_identity_digest,issued_at) values
 ('fa750000-0000-4000-8000-000000000008',gen_random_uuid(),gen_random_uuid(),'partial@example.invalid',3000,1000,1000,0,'USD',array['Fixture'],
 '2027-01-01','Private instructions',gen_random_uuid(),repeat('d',64),'2026-03-05T12:00Z'),
 ('fa750000-0000-4000-8000-000000000009',gen_random_uuid(),gen_random_uuid(),'courtesy@example.invalid',1000,0,9000,9000,'USD',array['Fixture'],
 '2027-01-01','Private instructions',gen_random_uuid(),repeat('c',64),'2026-03-05T12:00Z');
set local session_replication_role=origin;
create temporary table exception_analytics_reports as select
 public.get_refund_analytics('2026-02-01','2026-02-28',array['fa740000-0000-4000-8000-000000000003']::uuid[]) as feb,
 public.get_refund_analytics('2026-03-01','2026-03-31',array['fa740000-0000-4000-8000-000000000003']::uuid[]) as march,
 public.get_refund_analytics('2026-02-01','2026-03-31',array['fa740000-0000-4000-8000-000000000003']::uuid[]) as combined;
select is((select (march#>>'{period,giftPurchaseCents}')::int from exception_analytics_reports),1000,'Period gift recovery uses affected purchase and excludes courtesy purchase value');
select is((select (combined#>>'{cohort,resolvedGiftPurchaseCents}')::int from exception_analytics_reports),1000,'Cohort gift recovery matches canonical affected-purchase helper');
select is((select (march#>>'{period,giftFaceCents}')::int from exception_analytics_reports),10000,'Partial and courtesy gift face values remain separate from purchase recovery');
select is((select (march#>>'{period,goodwillCents}')::int from exception_analytics_reports),9000,'Cash-change courtesy is entirely Bloomjoy goodwill');
select is((select (march#>>'{period,cashPaidCents}')::int from exception_analytics_reports),0,'Neither exception gift is recorded cash paid');
select is((select (feb#>>'{asOf,outstandingCents}')::int from exception_analytics_reports),3000,'Historical purchase balance excludes pending courtesy and future gift issuance');
select is((select (march#>>'{asOf,outstandingCents}')::int from exception_analytics_reports),0,'Affected partial gift fully resolves purchase balance');
select is((select (combined#>>'{cohort,requestCount}')::int from exception_analytics_reports),3,'Courtesy remains visible as a received request');
select is((select (combined#>>'{cohort,requestedCents}')::int from exception_analytics_reports),3000,'Original cohort purchase request is preserved; courtesy adds zero purchase impact');
select is((select (combined#>>'{asOf,unknownBalanceCount}')::int from exception_analytics_reports),0,'Missing courtesy recognition is explicit zero, not an unknown ordinary purchase balance');
select is((select (combined#>>'{cohort,unknownAmountCount}')::int from exception_analytics_reports),0,'Courtesy zero purchase amount is known despite intentionally absent recognition');
select is((select jsonb_array_length(march->'aging') from exception_analytics_reports),0,'Neither issued nor pending courtesy creates purchase-balance aging');
select is((select (feb#>>'{period,requestDeductionExTaxCents}')::int from exception_analytics_reports),3000,'Courtesy creates no request-period deduction');
select is((select (march#>>'{period,reversalExTaxCents}')::int from exception_analytics_reports),2000,'Partial approval reverses only the unaffected purchase portion in the change period');
select is((select (march#>>'{period,requestDeductionExTaxCents}')::int from exception_analytics_reports),0,'Gift issuance and courtesy do not add another deduction');
select set_config('request.jwt.claim.sub','fa710000-0000-4000-8000-000000000002',true);
select is((public.get_refund_analytics_access()->>'hasAccess')::boolean,false,'Sales viewer without manager assignment denied');
select throws_ok($$select public.get_refund_analytics('2026-02-01','2026-02-28')$$,'42501',null,'Direct endpoint rechecks manager authority');
select * from finish();
rollback;
