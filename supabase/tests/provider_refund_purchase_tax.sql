begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
-- Synthetic only. Disable FK/triggers to avoid provider or outbox actions.
set local session_replication_role=replica;
insert into public.customer_accounts(id,name,account_type) values
 ('fc720000-0000-4000-8000-000000000001','Tax fixture','internal');
insert into public.reporting_locations(id,account_id,name,timezone) values
 ('fc730000-0000-4000-8000-000000000001','fc720000-0000-4000-8000-000000000001','Tax fixture','America/Los_Angeles');
insert into public.reporting_machines(id,account_id,location_id,machine_label,status) values
 ('fc740000-0000-4000-8000-000000000001','fc720000-0000-4000-8000-000000000001','fc730000-0000-4000-8000-000000000001','Tax fixture','active');
insert into public.reporting_machine_tax_rates(machine_id,tax_rate_percent,effective_start_date,effective_end_date,status) values
 ('fc740000-0000-4000-8000-000000000001',9.75,'2026-01-01','2026-08-31','active'),
 ('fc740000-0000-4000-8000-000000000001',20,'2026-09-01',null,'active');
insert into private.refund_request_recognition_rollout(singleton,activated_at,activated_by)
 values(true,'2026-09-29','Synthetic test') on conflict(singleton) do update set activated_at=excluded.activated_at;
insert into public.machine_sales_facts(id,reporting_machine_id,reporting_location_id,sale_date,payment_method,net_sales_cents,transaction_count,source,source_row_hash,raw_payload) values
 ('fc760000-0000-4000-8000-000000000001','fc740000-0000-4000-8000-000000000001','fc730000-0000-4000-8000-000000000001','2026-08-08','credit',1090,1,'nayax_scheduled_report',repeat('1',64),'{"actorId":"111","providerMachineId":"222","transactionId":"333","currencyCode":"USD"}');
insert into public.sales_adjustment_facts(id,reporting_machine_id,reporting_location_id,adjustment_date,adjustment_type,amount_cents,source,source_row_hash,raw_payload,created_at) values
 ('fc770000-0000-4000-8000-000000000001','fc740000-0000-4000-8000-000000000001','fc730000-0000-4000-8000-000000000001','2026-09-03','refund',1090,'nayax_provider_refund',repeat('2',64),'{}','2026-09-27');
insert into public.nayax_provider_refund_events(refund_identity_hash,account_key,provider_actor_id,provider_machine_id,original_transaction_id,event_transaction_id,currency_code,amount_cents,machine_event_at,evidence_kind,reporting_machine_id,adjustment_id,disposition) values
 (repeat('2',64),'SYNTHETIC','111','222','333','444','USD',1090,'2026-09-03 12:00','native_event','fc740000-0000-4000-8000-000000000001','fc770000-0000-4000-8000-000000000001','applied');
insert into public.nayax_dtm_export_rows(file_digest,source_row_hash,provider_actor_id,provider_machine_id,provider_site_id,provider_transaction_id,settlement_amount_cents,machine_settled_at,provider_type,machine_name_hash,mapping_disposition,financial_disposition,history_scope_disposition,disposition,fact_id) values
 (repeat('3',64),repeat('4',64),'111','222','555','333',1090,'2026-08-08 12:00',0,repeat('5',64),'canonical','eligible','in_scope','fact_linked','fc760000-0000-4000-8000-000000000001');
select is(private.provider_refund_original_sale_date('fc770000-0000-4000-8000-000000000001'),'2026-08-08'::date,'Exact provider original determines purchase date');
select is((select sum(legacy_paid_deduction_ex_tax_cents) from private.machine_sales_daily_components('fc740000-0000-4000-8000-000000000001','2026-09-01','2026-09-30')),993::numeric,'Refund uses original 9.75 rate instead of new booking-date 20 rate');
select is((select min(booking_date) from private.machine_sales_daily_components('fc740000-0000-4000-8000-000000000001','2026-09-01','2026-09-30')),'2026-09-03'::date,'Refund booking date stays unchanged');
select is((select min(purchase_attribution_date) from private.machine_sales_daily_components('fc740000-0000-4000-8000-000000000001','2026-09-01','2026-09-30')),'2026-08-08'::date,'Shared component exposes proved original purchase date');
-- Repeat export of same original fact must never duplicate refund components.
insert into public.nayax_dtm_export_rows(file_digest,source_row_hash,source_order_hash,refund_identity_hash,provider_actor_id,provider_machine_id,provider_site_id,provider_transaction_id,original_transaction_id,authorization_amount_cents,settlement_amount_cents,refund_annotation_cents,machine_settled_at,provider_settled_at,provider_updated_at,provider_status,provider_type,machine_name_hash,mapping_disposition,financial_disposition,history_scope_disposition,disposition,fact_id,adjustment_id,recorded_at) select repeat('6',64),source_row_hash,source_order_hash,refund_identity_hash,provider_actor_id,provider_machine_id,provider_site_id,provider_transaction_id,original_transaction_id,authorization_amount_cents,settlement_amount_cents,refund_annotation_cents,machine_settled_at,provider_settled_at,provider_updated_at,provider_status,provider_type,machine_name_hash,mapping_disposition,financial_disposition,history_scope_disposition,disposition,fact_id,adjustment_id,recorded_at from public.nayax_dtm_export_rows where file_digest=repeat('3',64);
select is((select count(*) from private.machine_sales_daily_components('fc740000-0000-4000-8000-000000000001','2026-09-01','2026-09-30')),1::bigint,'Repeated file does not multiply refund');
-- Authority suppression changes published sales, not original purchase evidence.
update public.machine_sales_facts set net_sales_cents=0,raw_payload=raw_payload||'{"revenueAuthority":"card_authority_daily","_salesAuthorityOriginal":{"netSalesCents":1090}}'::jsonb where id='fc760000-0000-4000-8000-000000000001';
select is(private.provider_refund_original_sale_date('fc770000-0000-4000-8000-000000000001'),'2026-08-08'::date,'Retained authority-suppressed purchase evidence proves date');
select is((select sum(recorded_sales_cents) from private.machine_sales_daily_components('fc740000-0000-4000-8000-000000000001','2026-08-01','2026-08-31')),null::numeric,'Date lookup does not restore suppressed sales');
update public.machine_sales_facts set net_sales_cents=1090 where id='fc760000-0000-4000-8000-000000000001';
-- Partial refund keeps the original purchase date.
update public.sales_adjustment_facts set amount_cents=545 where id='fc770000-0000-4000-8000-000000000001';
update public.nayax_provider_refund_events set amount_cents=545 where refund_identity_hash=repeat('2',64);
select is((select sum(legacy_paid_deduction_ex_tax_cents) from private.machine_sales_daily_components('fc740000-0000-4000-8000-000000000001','2026-09-01','2026-09-30')),497::numeric,'Partial refund normalizes once with original rate');
update public.sales_adjustment_facts set amount_cents=1090 where id='fc770000-0000-4000-8000-000000000001';
update public.nayax_provider_refund_events set amount_cents=1090 where refund_identity_hash=repeat('2',64);
update public.nayax_dtm_export_rows set provider_actor_id='999';
select is(private.provider_refund_original_sale_date('fc770000-0000-4000-8000-000000000001'),null::date,'Wrong actor cannot supply date');
update public.nayax_dtm_export_rows set provider_actor_id='111',provider_machine_id='999';
select is(private.provider_refund_original_sale_date('fc770000-0000-4000-8000-000000000001'),null::date,'Wrong provider machine cannot supply date');
update public.nayax_dtm_export_rows set provider_machine_id='222',fact_id=null;
select is((select sum(legacy_paid_deduction_ex_tax_cents) from private.machine_sales_daily_components('fc740000-0000-4000-8000-000000000001','2026-09-01','2026-09-30')),1090::numeric,'Missing original retains historical fallback without guessing date');
select is((select min(normalization_status) from private.machine_sales_daily_components('fc740000-0000-4000-8000-000000000001','2026-09-01','2026-09-30')),'estimated','Missing original remains explicitly estimated');
update public.nayax_dtm_export_rows set fact_id='fc760000-0000-4000-8000-000000000001';
insert into public.machine_sales_facts(id,reporting_machine_id,reporting_location_id,sale_date,payment_method,net_sales_cents,transaction_count,source,source_row_hash,import_run_id,raw_payload,created_at,updated_at,source_order_hash,source_trade_name,item_quantity,tax_cents,source_payment_status,payment_time) select 'fc760000-0000-4000-8000-000000000002',reporting_machine_id,reporting_location_id,'2026-08-09',payment_method,net_sales_cents,transaction_count,source,repeat('7',64),import_run_id,raw_payload,created_at,updated_at,source_order_hash,source_trade_name,item_quantity,tax_cents,source_payment_status,payment_time from public.machine_sales_facts where id='fc760000-0000-4000-8000-000000000001';
update public.nayax_dtm_export_rows set fact_id='fc760000-0000-4000-8000-000000000002',machine_settled_at='2026-08-09 12:00' where file_digest=repeat('6',64);
select is(private.provider_refund_original_sale_date('fc770000-0000-4000-8000-000000000001'),null::date,'Conflicting original facts remain unproved');
select is((select min(normalization_status) from private.machine_sales_daily_components('fc740000-0000-4000-8000-000000000001','2026-09-01','2026-09-30')),'estimated','Conflicting originals remain explicitly estimated');
-- Restore unique evidence, then exercise the actual shared sales/refund adapter.
update public.nayax_dtm_export_rows set fact_id='fc760000-0000-4000-8000-000000000001',machine_settled_at='2026-08-08 12:00';
update public.reporting_machine_tax_rates set tax_rate_percent=9.75 where machine_id='fc740000-0000-4000-8000-000000000001' and effective_start_date='2026-09-01';
insert into public.machine_sales_facts(reporting_machine_id,reporting_location_id,sale_date,payment_method,net_sales_cents,transaction_count,source,source_row_hash,raw_payload) values
 ('fc740000-0000-4000-8000-000000000001','fc730000-0000-4000-8000-000000000001','2026-09-01','credit',55590,51,'nayax_scheduled_report',repeat('8',64),'{}');
select is((select sum(commissionable_sales_ex_tax_cents) from private.machine_sales_daily_components('fc740000-0000-4000-8000-000000000001','2026-09-01','2026-09-30')),49658::numeric,'Actual shared adapter reconciles Gilroy gross sales and refund');
select is((select sum(sales_tax_cents) from private.machine_sales_daily_components('fc740000-0000-4000-8000-000000000001','2026-09-01','2026-09-30')),4939::numeric,'Actual shared adapter preserves separated sales tax');
-- Original-date tender treatment reaches the fourth normalization seam.
insert into public.reporting_machine_tax_treatments(machine_id,tender,amount_basis,taxable_portion_percent,effective_start_date,effective_end_date) values
 ('fc740000-0000-4000-8000-000000000001','card','source_default',0,'2026-08-01','2026-08-31');
select is((select sum(legacy_paid_deduction_ex_tax_cents) from private.machine_sales_daily_components('fc740000-0000-4000-8000-000000000001','2026-09-01','2026-09-30')),1090::numeric,'Original purchase tender treatment preserves non-taxable portion');
delete from public.reporting_machine_tax_treatments where machine_id='fc740000-0000-4000-8000-000000000001';
-- Finance API reads the same corrected adapter.
insert into auth.users(id,email) values('fc710000-0000-4000-8000-000000000001','tax@example.invalid');
insert into public.reporting_machine_refund_managers(reporting_machine_id,manager_user_id,manager_email,status) values
 ('fc740000-0000-4000-8000-000000000001','fc710000-0000-4000-8000-000000000001','tax@example.invalid','active');
insert into public.reporting_machine_entitlements(user_id,machine_id,starts_at) values
 ('fc710000-0000-4000-8000-000000000001','fc740000-0000-4000-8000-000000000001','2020-01-01');
select set_config('request.jwt.claim.sub','fc710000-0000-4000-8000-000000000001',true);
select is((public.get_finance_reporting('2026-09-01','2026-09-30')#>>'{rows,0,netSalesExTaxCents}')::bigint,49658::bigint,'Finance API agrees with shared adapter');
-- Synthetic Gilroy arithmetic at the existing daily rounding precision.
select is((select tax_exclusive_amount_cents from private.normalize_financial_amount_cents(55590,'tax_inclusive',9.75,null))-993,49658::bigint,'Gilroy gross sale less gross refund on matching ex-tax basis');
select is((select tax_cents from private.normalize_financial_amount_cents(1090,'tax_inclusive',9.75,null)),97::bigint,'Refund returns embedded tax once');
set local session_replication_role=origin;
select * from finish();
rollback;
