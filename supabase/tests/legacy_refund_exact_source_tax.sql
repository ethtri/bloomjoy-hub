begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
set local timezone='UTC';
select no_plan();
set local session_replication_role=replica;
insert into auth.users(id,email) values('b1848000-0000-4000-8000-000000000001','legacy-exact@example.invalid');
insert into customer_accounts(id,name) values('b1848100-0000-4000-8000-000000000001','Legacy exact fixture');
insert into reporting_locations(id,account_id,name,timezone) values('b1848200-0000-4000-8000-000000000001','b1848100-0000-4000-8000-000000000001','Exact site','UTC');
insert into reporting_machines(id,account_id,location_id,machine_label,nayax_machine_id,nayax_account_key) values
 ('b1848300-0000-4000-8000-000000000001','b1848100-0000-4000-8000-000000000001','b1848200-0000-4000-8000-000000000001','Replacement reader','184800002','TGPACI_USA_DB'),
 ('b1848300-0000-4000-8000-000000000002','b1848100-0000-4000-8000-000000000001','b1848200-0000-4000-8000-000000000001','Different financial machine','184800099','TGPACI_USA_DB');
insert into private.machine_nayax_reader_associations(account_key,nayax_machine_id,reporting_machine_id,ownership_basis,created_by,reason,closed_at,closed_by,close_reason,effective_until) values
 ('TGPACI_USA_DB','184800001','b1848300-0000-4000-8000-000000000001','original_transactions_only','b1848000-0000-4000-8000-000000000001','Synthetic original purchase evidence','2026-09-01','b1848000-0000-4000-8000-000000000001','Fixture closed reader','2026-09-01');
insert into private.nayax_machine_tax_observations(account_key,nayax_machine_id,observed_at,source,classification,rate_percent,provenance,effective_start_date) values
 ('TGPACI_USA_DB','184800001','2026-01-01','finance_verified','verified_tax',9,'Synthetic original reader proof','2026-01-01'),
 ('TGPACI_USA_DB','184800002','2026-01-01','finance_verified','verified_tax',20,'Synthetic replacement reader proof','2026-01-01');
insert into machine_sales_facts(id,reporting_machine_id,reporting_location_id,sale_date,payment_method,net_sales_cents,transaction_count,source,source_row_hash,raw_payload) values
 ('b1848400-0000-4000-8000-000000000001','b1848300-0000-4000-8000-000000000001','b1848200-0000-4000-8000-000000000001','2026-08-08','credit',1090,1,'nayax_scheduled_report',repeat('8',64),'{"actorId":"2001508696","providerMachineId":"184800001","siteId":"1848","transactionId":"18480001","currencyCode":"USD","amountBasis":"tax_inclusive"}');
insert into refund_cases(id,public_reference,reporting_machine_id,reporting_location_id,customer_email,issue_summary,incident_at,incident_time_confidence,payment_method,payment_amount_cents,refund_amount_cents,status,correlation_source,matched_nayax_transaction_id,matched_nayax_site_id,matched_nayax_amount_cents,matched_nayax_currency_code) values
 ('b1848500-0000-4000-8000-000000000001','RF-EXACT-LEGACY','b1848300-0000-4000-8000-000000000001','b1848200-0000-4000-8000-000000000001','synthetic@example.invalid','Synthetic exact fixture','2026-09-03','rough','card',1090,1090,'completed','nayax','18480001',1848,1090,'USD');
insert into nayax_dtm_export_rows(file_digest,source_row_hash,provider_actor_id,provider_machine_id,provider_site_id,provider_transaction_id,settlement_amount_cents,machine_settled_at,provider_type,machine_name_hash,mapping_disposition,financial_disposition,history_scope_disposition,disposition,fact_id) values
 (repeat('8',64),repeat('9',64),'2001508696','184800001','1848','18480001',1090,'2026-08-08T12:00Z',0,repeat('7',64),'canonical','eligible','in_scope','fact_linked','b1848400-0000-4000-8000-000000000001');
insert into sales_adjustment_facts(id,reporting_machine_id,reporting_location_id,adjustment_date,adjustment_type,amount_cents,source,source_row_hash,refund_case_id,created_at) values
 ('b1848600-0000-4000-8000-000000000001','b1848300-0000-4000-8000-000000000001','b1848200-0000-4000-8000-000000000001','2026-09-03','refund',1090,'refund_case',repeat('6',64),'b1848500-0000-4000-8000-000000000001','2026-09-03');
insert into private.refund_request_recognition_rollout(singleton,activated_at,activated_by) values(true,'2026-09-29','Fixture') on conflict(singleton) do update set activated_at=excluded.activated_at;
-- Match production's large DTM ledger, rather than the earlier 1,000-row toy.
insert into nayax_dtm_export_rows(file_digest,source_row_hash,provider_actor_id,provider_machine_id,provider_site_id,provider_transaction_id,settlement_amount_cents,machine_settled_at,provider_type,machine_name_hash,mapping_disposition,financial_disposition,history_scope_disposition,disposition,fact_id)
 select repeat('5',64),md5('legacy-exact-'||n)||md5('legacy-row-'||n),'2001508696','184800099','184899',(1848990000::bigint+n)::text,1090,'2026-08-08T12:00Z',0,repeat('4',64),'canonical','eligible','in_scope','fact_linked','b1848400-0000-4000-8000-000000000001' from generate_series(1,80000)n;
-- Synthetic corruption checks retain replica mode to bypass immutable-ledger triggers.
analyze nayax_dtm_export_rows;
select is(private.refund_original_source_tax_cents('b1848500-0000-4000-8000-000000000001',1090),90::bigint,'Exact original transaction restores tax despite rough incident date and replacement reader');
update nayax_dtm_export_rows set machine_settled_at='2026-08-09T02:00Z' where file_digest=repeat('8',64);
select is(private.refund_original_source_tax_cents('b1848500-0000-4000-8000-000000000001',1090),90::bigint,'UTC midnight boundary does not overwrite linked fact purchase date');
select is(private.refund_original_source_tax_cents('b1848500-0000-4000-8000-000000000001',500),41::bigint,'Partial refund uses original rate once, without proportional double rounding');
update machine_sales_facts set net_sales_cents=500 where id='b1848400-0000-4000-8000-000000000001';
update refund_cases set matched_nayax_amount_cents=500 where id='b1848500-0000-4000-8000-000000000001';
update nayax_dtm_export_rows set settlement_amount_cents=500 where file_digest=repeat('8',64);
select is(private.refund_original_source_tax_cents('b1848500-0000-4000-8000-000000000001',67),6::bigint,'Once-rounded 9 percent gives six cents where scaling rounded original tax would give five');
update machine_sales_facts set net_sales_cents=1090 where id='b1848400-0000-4000-8000-000000000001';
update refund_cases set matched_nayax_amount_cents=1090 where id='b1848500-0000-4000-8000-000000000001';
update nayax_dtm_export_rows set settlement_amount_cents=1090 where file_digest=repeat('8',64);
select is((select sum(legacy_paid_deduction_ex_tax_cents) from private.machine_sales_daily_components('b1848300-0000-4000-8000-000000000001','2026-09-01','2026-09-30')),1000::numeric,'Recovered legacy refund stays in its recognition month');
select is((select min(booking_date) from private.machine_sales_daily_components('b1848300-0000-4000-8000-000000000001','2026-09-01','2026-09-30')),'2026-09-03'::date,'No refund date rewrite');
select is((select matched_sales_fact_id from refund_cases where id='b1848500-0000-4000-8000-000000000001'),null::uuid,'Report read does not repair case pointer');
update machine_sales_facts set tax_cents=100 where id='b1848400-0000-4000-8000-000000000001';
select is(private.refund_original_source_tax_cents('b1848500-0000-4000-8000-000000000001',500),46::bigint,'Actual transaction tax is proportional and remains authoritative');
update machine_sales_facts set tax_cents=0,raw_payload=raw_payload||'{"taxBasis":"separate_tax"}' where id='b1848400-0000-4000-8000-000000000001';
select is(private.refund_original_source_tax_cents('b1848500-0000-4000-8000-000000000001',500),0::bigint,'Explicit separate zero tax precedes percentage');
update machine_sales_facts set raw_payload=raw_payload||'{"currencyCode":"EUR"}' where id='b1848400-0000-4000-8000-000000000001';
select is(private.refund_original_source_tax_cents('b1848500-0000-4000-8000-000000000001',1090),null::bigint,'Non-USD source cannot recover');
update machine_sales_facts set raw_payload=raw_payload||'{"currencyCode":"USD","actorId":"unaccepted"}' where id='b1848400-0000-4000-8000-000000000001';
select is(private.refund_original_source_tax_cents('b1848500-0000-4000-8000-000000000001',1090),null::bigint,'Unaccepted source actor cannot recover');
update machine_sales_facts set raw_payload=raw_payload||'{"actorId":"2001508696"}' where id='b1848400-0000-4000-8000-000000000001';
update nayax_dtm_export_rows set financial_disposition='hold_sheet_overlap' where file_digest=repeat('8',64);
select is(private.refund_original_source_tax_cents('b1848500-0000-4000-8000-000000000001',1090),null::bigint,'Financially excluded original cannot recover');
update nayax_dtm_export_rows set financial_disposition='eligible' where file_digest=repeat('8',64);
create temporary table original_history as select * from private.machine_nayax_reader_associations where account_key='TGPACI_USA_DB' and nayax_machine_id='184800001';
delete from private.machine_nayax_reader_associations where account_key='TGPACI_USA_DB' and nayax_machine_id='184800001';
select is(private.refund_original_source_tax_cents('b1848500-0000-4000-8000-000000000001',1090),null::bigint,'Unapproved historical reader cannot borrow replacement rate');
insert into private.machine_nayax_reader_associations select * from original_history;
update machine_sales_facts set raw_payload=raw_payload-'taxBasis'||'{"accountKey":"OTHER_ACCOUNT"}' where id='b1848400-0000-4000-8000-000000000001';
select is(private.refund_original_source_tax_cents('b1848500-0000-4000-8000-000000000001',1090),null::bigint,'Wrong account cannot recover');
update machine_sales_facts set raw_payload=raw_payload-'accountKey' where id='b1848400-0000-4000-8000-000000000001';
update refund_cases set matched_nayax_site_id=999 where id='b1848500-0000-4000-8000-000000000001';
select is(private.refund_original_source_tax_cents('b1848500-0000-4000-8000-000000000001',1090),null::bigint,'Wrong original site cannot recover');
update refund_cases set matched_nayax_site_id=1848,matched_nayax_amount_cents=999 where id='b1848500-0000-4000-8000-000000000001';
select is(private.refund_original_source_tax_cents('b1848500-0000-4000-8000-000000000001',1090),null::bigint,'Wrong original amount cannot recover');
update refund_cases set matched_nayax_amount_cents=1090 where id='b1848500-0000-4000-8000-000000000001';
-- A second eligible fact with unresolved tax must count before the tax filter.
update refund_cases set reporting_machine_id='b1848300-0000-4000-8000-000000000002' where id='b1848500-0000-4000-8000-000000000001';
select is(private.refund_original_source_tax_cents('b1848500-0000-4000-8000-000000000001',1090),null::bigint,'Exact transaction from another financial machine cannot recover');
update refund_cases set reporting_machine_id='b1848300-0000-4000-8000-000000000001' where id='b1848500-0000-4000-8000-000000000001';
set local session_replication_role=replica;
insert into machine_sales_facts(id,reporting_machine_id,reporting_location_id,sale_date,payment_method,net_sales_cents,transaction_count,source,source_row_hash,raw_payload)
 select 'b1848400-0000-4000-8000-000000000002',reporting_machine_id,reporting_location_id,sale_date,payment_method,net_sales_cents,transaction_count,source,repeat('3',64),raw_payload||'{"providerMachineId":"184800003"}' from machine_sales_facts where id='b1848400-0000-4000-8000-000000000001';
insert into private.machine_nayax_reader_associations(account_key,nayax_machine_id,reporting_machine_id,ownership_basis,created_by,reason,closed_at,closed_by,close_reason,effective_until) values('TGPACI_USA_DB','184800003','b1848300-0000-4000-8000-000000000001','original_transactions_only','b1848000-0000-4000-8000-000000000001','Ambiguous unresolved original','2026-09-01','b1848000-0000-4000-8000-000000000001','Fixture closed reader','2026-09-01');
insert into nayax_dtm_export_rows(file_digest,source_row_hash,provider_actor_id,provider_machine_id,provider_site_id,provider_transaction_id,settlement_amount_cents,machine_settled_at,provider_type,machine_name_hash,mapping_disposition,financial_disposition,history_scope_disposition,disposition,fact_id)
 select repeat('2',64),repeat('1',64),provider_actor_id,'184800003',provider_site_id,provider_transaction_id,settlement_amount_cents,machine_settled_at,provider_type,machine_name_hash,mapping_disposition,financial_disposition,history_scope_disposition,disposition,'b1848400-0000-4000-8000-000000000002' from nayax_dtm_export_rows where file_digest=repeat('8',64);
-- Synthetic corruption checks retain replica mode to bypass immutable-ledger triggers.
select is(private.refund_original_source_tax_cents('b1848500-0000-4000-8000-000000000001',1090),null::bigint,'Known plus unresolved second original is ambiguous before tax filtering');
delete from nayax_dtm_export_rows where file_digest=repeat('2',64);
update refund_cases set matched_sales_fact_id='b1848400-0000-4000-8000-000000000001' where id='b1848500-0000-4000-8000-000000000001';
update machine_sales_facts set tax_cents=100 where id='b1848400-0000-4000-8000-000000000001';
select is(private.refund_original_source_tax_cents('b1848500-0000-4000-8000-000000000001',500),46::bigint,'Existing matched-fact path remains unchanged');
select ok(not has_function_privilege('authenticated','private.refund_original_source_tax_cents(uuid,bigint)','EXECUTE'),'Browser execution remains revoked');
create temporary table lookup_plan(plan jsonb);
do $$declare p jsonb; begin
 execute $plan$explain(format json) select fact_id from public.nayax_dtm_export_rows where provider_transaction_id='18480001' and provider_site_id='1848' and fact_id is not null and disposition in ('fact_linked','fact_linked+refund_applied') and financial_disposition='eligible' and original_transaction_id is null and settlement_amount_cents>0 and (provider_type=0 or (provider_type is null and provider_status in (12,62,63)))$plan$ into p;
 insert into lookup_plan values(p);
end$$;
select ok((select jsonb_path_exists(plan,'$.** ? (@."Index Name" == "nayax_dtm_case_original_identity_idx")') from lookup_plan),'80k DTM ledger uses exact transaction/site partial index');
select * from finish();
rollback;
