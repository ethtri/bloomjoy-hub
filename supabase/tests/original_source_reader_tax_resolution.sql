begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
set local session_replication_role=replica;
insert into auth.users(id,email) values('b1842000-0000-4000-8000-000000000001','original-source-owner@example.invalid'),('b1842000-0000-4000-8000-000000000002','original-source-outsider@example.invalid');
insert into customer_accounts(id,name) values('b1842100-0000-4000-8000-000000000001','Original source fixture');
insert into reporting_locations(id,account_id,name,timezone) values('b1842200-0000-4000-8000-000000000001','b1842100-0000-4000-8000-000000000001','Historical location','America/Los_Angeles');
insert into reporting_machines(id,account_id,location_id,machine_label,nayax_machine_id,nayax_account_key) values
 ('b1842300-0000-4000-8000-000000000001','b1842100-0000-4000-8000-000000000001','b1842200-0000-4000-8000-000000000001','Historical original owner',null,null),
 ('b1842300-0000-4000-8000-000000000002','b1842100-0000-4000-8000-000000000001','b1842200-0000-4000-8000-000000000001','Current different owner','18420001','TGPACI_USA_DB'),
 ('b1842300-0000-4000-8000-000000000003','b1842100-0000-4000-8000-000000000001','b1842200-0000-4000-8000-000000000001','Wrong-current-rate context','18420002','TGPACI_USA_DB');
insert into reporting_machine_entitlements(user_id,machine_id,starts_at) values
 ('b1842000-0000-4000-8000-000000000001','b1842300-0000-4000-8000-000000000001','2000-01-01'),
 ('b1842000-0000-4000-8000-000000000001','b1842300-0000-4000-8000-000000000003','2000-01-01');
insert into private.nayax_machine_tax_observations(account_key,nayax_machine_id,observed_at,source,classification,rate_percent,provenance,effective_start_date) values
 ('TGPACI_USA_DB','18420001','2099-10-05','finance_verified','verified_tax',6,'Synthetic exact original source rate','2099-01-01'),
 ('OTHER_ACCOUNT','18420001','2099-10-05','finance_verified','verified_tax',30,'Synthetic unrelated account rate','2099-01-01'),
 ('TGPACI_USA_DB','18420002','2099-10-05','finance_verified','verified_tax',20,'Synthetic different current reader','2099-01-01');
insert into machine_sales_facts(id,reporting_machine_id,reporting_location_id,sale_date,payment_method,net_sales_cents,transaction_count,tax_cents,source,source_row_hash,source_order_hash,raw_payload) values
 ('b1842400-0000-4000-8000-000000000001','b1842300-0000-4000-8000-000000000001','b1842200-0000-4000-8000-000000000001','2099-09-01','credit',1060,1,0,'nayax_scheduled_report','original-source-sale','original-source-order','{"actorId":"2003563806","providerMachineId":"18420001","transactionId":"1842000101","currencyCode":"USD","amountBasis":"tax_inclusive"}');
insert into machine_sales_facts(reporting_machine_id,reporting_location_id,sale_date,payment_method,net_sales_cents,transaction_count,tax_cents,source,source_row_hash,raw_payload)
select 'b1842300-0000-4000-8000-000000000003','b1842200-0000-4000-8000-000000000001','2099-09-01'::date+n,'credit',1060,1,case when n=7 then 80 else 0 end,
 'nayax_scheduled_report','source-case-'||n,
 case n
  when 1 then '{"actorId":"999","providerMachineId":"18420001","currencyCode":"USD"}'::jsonb
  when 2 then '{"actorId":"2003563806","providerMachineId":"not-a-reader","currencyCode":"USD"}'::jsonb
  when 3 then '{"actorId":"2003563806","providerMachineId":"18420001","accountKey":"OTHER_ACCOUNT","currencyCode":"USD"}'::jsonb
  when 4 then '{"actorId":"2003563806","providerMachineId":"18420001","currencyCode":"CAD"}'::jsonb
  when 5 then '{"actorId":"2003563806","currencyCode":"USD"}'::jsonb
  when 6 then '{"actorId":"999","amountBasis":"separate_tax","taxBasis":"separate_tax"}'::jsonb
  else '{"actorId":"2003563806","providerMachineId":"18420001","currencyCode":"USD","amountBasis":"separate_tax"}'::jsonb end
from generate_series(1,7)n;
insert into private.refund_request_recognition_rollout(singleton,activated_at,activated_by) values(true,'2099-09-01','Synthetic source-reader fixture') on conflict(singleton) do update set activated_at=excluded.activated_at;
insert into sales_adjustment_facts(id,reporting_machine_id,reporting_location_id,adjustment_date,adjustment_type,amount_cents,source,source_row_hash,created_at) values
 ('b1842500-0000-4000-8000-000000000001','b1842300-0000-4000-8000-000000000001','b1842200-0000-4000-8000-000000000001','2099-09-03','refund',106,'nayax_provider_refund','original-source-refund','2099-08-01');
insert into nayax_provider_refund_events(refund_identity_hash,account_key,provider_actor_id,provider_machine_id,original_transaction_id,event_transaction_id,currency_code,amount_cents,machine_event_at,evidence_kind,reporting_machine_id,adjustment_id,disposition) values
 (repeat('4',64),'TGPACI_USA_DB','2003563806','18420001','1842000101','1842000102','USD',106,'2099-09-03 12:00','native_event','b1842300-0000-4000-8000-000000000001','b1842500-0000-4000-8000-000000000001','applied');
insert into nayax_dtm_export_rows(file_digest,source_row_hash,provider_actor_id,provider_machine_id,provider_site_id,provider_transaction_id,settlement_amount_cents,machine_settled_at,provider_type,machine_name_hash,mapping_disposition,financial_disposition,history_scope_disposition,disposition,fact_id) values
 (repeat('1',64),repeat('2',64),'2003563806','18420001','4','1842000101',1060,'2099-09-01 12:00',0,repeat('3',64),'canonical','eligible','in_scope','fact_linked','b1842400-0000-4000-8000-000000000001');
set local session_replication_role=origin;
create temporary table source_preserved as select
 (select jsonb_agg(to_jsonb(m) order by id) from reporting_machines m where account_id='b1842100-0000-4000-8000-000000000001') machines,
 (select jsonb_agg(to_jsonb(f) order by id) from machine_sales_facts f where reporting_location_id='b1842200-0000-4000-8000-000000000001') facts;
select is((select rate_percent from private.resolve_reporting_machine_source_tax('b1842300-0000-4000-8000-000000000001','2099-09-01')),null::numeric,'Current machine has no rate or reader, reproducing old fallback gap');
select is((select sales_ex_tax_cents from private.machine_sales_daily_components('b1842300-0000-4000-8000-000000000001','2099-09-01','2099-09-01')),1000::bigint,'Historical sale uses exact raw original reader 6 percent without association');
select is((select sales_tax_cents from private.machine_sales_daily_components('b1842300-0000-4000-8000-000000000001','2099-09-01','2099-09-01')),60::bigint,'Exact source account excludes unrelated 30 percent reader observation');
select is((select gross_sales_cents from private.machine_sales_daily_waterfall_components('b1842300-0000-4000-8000-000000000001','2099-09-01','2099-09-01')),1060::bigint,'Finance inclusive payment remains original recorded amount');
select is((select net_known_cents from private.machine_sales_daily_receipt_components('b1842300-0000-4000-8000-000000000001','2099-09-01','2099-09-01')),1000::bigint,'Operational known components share exact original source rate');
select is((select count(*) from private.machine_sales_daily_components('b1842300-0000-4000-8000-000000000002','2099-09-01','2099-09-01')),0::bigint,'Current other owner receives no historical money');
select is((select count(*) from private.machine_sales_daily_components('b1842300-0000-4000-8000-000000000003','2099-09-02','2099-09-06') where sales_ex_tax_cents is null),5::bigint,'Unknown actor, malformed reader, foreign account/currency and absent reader never borrow current 20 percent');
select is((select sales_ex_tax_cents from private.machine_sales_daily_components('b1842300-0000-4000-8000-000000000003','2099-09-07','2099-09-07')),1060::bigint,'Explicit original zero tax takes precedence even without source rate identity');
select is((select sales_ex_tax_cents from private.machine_sales_daily_components('b1842300-0000-4000-8000-000000000003','2099-09-08','2099-09-08')),980::bigint,'Actual original 80 tax takes precedence over six percent');
select is(private.provider_refund_original_source_tax_cents('b1842500-0000-4000-8000-000000000001',106),6::bigint,'Exact provider original uses its original reader rate at purchase date');
select is((select legacy_paid_deduction_ex_tax_cents from private.machine_sales_daily_components('b1842300-0000-4000-8000-000000000001','2099-09-03','2099-09-03')),100::bigint,'Refund normalizes once with original source and preserves booked deduction');
select is((select purchase_attribution_date from private.machine_sales_daily_components('b1842300-0000-4000-8000-000000000001','2099-09-03','2099-09-03')),'2099-09-01'::date,'Refund preserves original purchase date');
select is((select count(*) from private.sales_report_rows_for_actor('b1842000-0000-4000-8000-000000000002','2099-09-01','2099-09-08','day',array['b1842300-0000-4000-8000-000000000001'::uuid])),0::bigint,'Original source recovery does not grant outsider access');
select is((select jsonb_agg(to_jsonb(m) order by id) from reporting_machines m where account_id='b1842100-0000-4000-8000-000000000001'),(select machines from source_preserved),'Tax recovery rewires no physical/current machine');
select is((select jsonb_agg(to_jsonb(f) order by id) from machine_sales_facts f where reporting_location_id='b1842200-0000-4000-8000-000000000001'),(select facts from source_preserved),'Tax recovery changes no raw money or historical financial owner');
select is((select count(*) from private.machine_nayax_reader_associations where reporting_machine_id::text like 'b1842300-%'),0::bigint,'Calculation creates no physical reader association');
set local session_replication_role=replica;
update machine_sales_facts set net_sales_cents=1090 where id='b1842400-0000-4000-8000-000000000001';
update nayax_dtm_export_rows set settlement_amount_cents=1090 where file_digest=repeat('1',64);
update sales_adjustment_facts set amount_cents=545 where id='b1842500-0000-4000-8000-000000000001';
update nayax_provider_refund_events set amount_cents=545 where adjustment_id='b1842500-0000-4000-8000-000000000001';
update private.nayax_machine_tax_observations set rate_percent=9.75 where nayax_machine_id='18420001' and account_key='TGPACI_USA_DB';
set local session_replication_role=origin;
select is(545-private.provider_refund_original_source_tax_cents('b1842500-0000-4000-8000-000000000001',545),497::bigint,'Verified rate normalizes refund once without rounding original estimate first');
update machine_sales_facts set tax_cents=97 where id='b1842400-0000-4000-8000-000000000001';
select is(545-private.provider_refund_original_source_tax_cents('b1842500-0000-4000-8000-000000000001',545),496::bigint,'Actual original tax remains proportional and outranks rate estimate');
set local session_replication_role=replica;
update machine_sales_facts set net_sales_cents=1060,tax_cents=0,raw_payload=raw_payload-'_salesAuthorityOriginal' where id='b1842400-0000-4000-8000-000000000001';
update nayax_dtm_export_rows set settlement_amount_cents=1060 where file_digest=repeat('1',64);
update sales_adjustment_facts set amount_cents=106 where id='b1842500-0000-4000-8000-000000000001';
update nayax_provider_refund_events set amount_cents=106 where adjustment_id='b1842500-0000-4000-8000-000000000001';
update private.nayax_machine_tax_observations set rate_percent=6 where nayax_machine_id='18420001' and account_key='TGPACI_USA_DB';
set local session_replication_role=origin;
-- Historical inactive recovery promotes the exact pending receipt after the
-- immutable DTM audit recorded queued_excluded and no fact link.
set local session_replication_role=replica;
update machine_sales_facts set source_order_hash=repeat('7',64),raw_payload=raw_payload||'{"manualDtmEvidence":true,"historicalInactiveExactLinkRecovery":true}' where id='b1842400-0000-4000-8000-000000000001';
update nayax_dtm_export_rows set source_order_hash=repeat('7',64),fact_id=null,disposition='queued_excluded',mapping_disposition='historical_inactive_exact_link',provider_status=62 where file_digest=repeat('1',64);
insert into nayax_dtm_export_completions(file_digest,rows_recorded,facts_linked,adjustments_linked,pending_rows,held_rows) values(repeat('1',64),1,0,0,1,0);
insert into nayax_pending_sales(source_order_hash,source_row_hash,account_key,provider_actor_id,provider_site_id,provider_transaction_id,provider_machine_id,currency_code,settlement_amount_cents,machine_settled_at,provider_settled_at,provider_status,provider_status_name,normalized_sale,disposition,disposition_reason,promoted_fact_id)
values(repeat('7',64),repeat('2',64),'TGPACI_USA_DB','2003563806','4','1842000101','18420001','USD',1060,'2099-09-01 12:00','2099-09-01 19:00Z',62,'Settled',jsonb_build_object('transactionId','1842000101','siteId','4','actorId','2003563806','providerMachineId','18420001','currencyCode','USD','authorizationAmountCents',1060,'settlementAmountCents',1060,'machineSettledAt','2099-09-01 12:00','providerSettledAt','2099-09-01 19:00Z','providerUpdatedAt',null,'providerStatus',62,'providerStatusName','Settled','sourceOrderHash',repeat('7',64),'sourceRowHash',repeat('2',64)),'promoted','historical_inactive_exact_link','b1842400-0000-4000-8000-000000000001');
set local session_replication_role=origin;
select is(private.provider_refund_original_sale_date('b1842500-0000-4000-8000-000000000001'),'2099-09-01'::date,'Completed inactive import follows exact approved promoted fact');
select is(private.provider_refund_original_source_tax_cents('b1842500-0000-4000-8000-000000000001',106),6::bigint,'Promoted original reader tax supports refund without mutating immutable DTM audit');
set local session_replication_role=replica;
insert into machine_sales_facts(id,reporting_machine_id,reporting_location_id,sale_date,payment_method,net_sales_cents,transaction_count,tax_cents,source,source_row_hash,raw_payload)
select 'b1842400-0000-4000-8000-000000000003',reporting_machine_id,reporting_location_id,sale_date,payment_method,net_sales_cents,transaction_count,80,source,'mixed-promoted-original',raw_payload from machine_sales_facts where id='b1842400-0000-4000-8000-000000000001';
insert into nayax_dtm_export_rows(file_digest,source_row_hash,provider_actor_id,provider_machine_id,provider_site_id,provider_transaction_id,settlement_amount_cents,machine_settled_at,provider_type,machine_name_hash,mapping_disposition,financial_disposition,history_scope_disposition,disposition,fact_id)
select repeat('9',64),repeat('9',64),provider_actor_id,provider_machine_id,provider_site_id,provider_transaction_id,settlement_amount_cents,machine_settled_at,provider_type,machine_name_hash,'canonical',financial_disposition,history_scope_disposition,'fact_linked','b1842400-0000-4000-8000-000000000003' from nayax_dtm_export_rows where file_digest=repeat('1',64);
set local session_replication_role=origin;
select is(private.provider_refund_original_sale_date('b1842500-0000-4000-8000-000000000001'),null::date,'A linked and promoted original together cannot take fast-path false uniqueness');
select is(private.provider_refund_original_source_tax_cents('b1842500-0000-4000-8000-000000000001',106),null::bigint,'Mixed linked and promoted tax candidates preserve ambiguity');
set local session_replication_role=replica;
delete from nayax_dtm_export_rows where file_digest=repeat('9',64);
delete from machine_sales_facts where id='b1842400-0000-4000-8000-000000000003';
set local session_replication_role=origin;
update nayax_pending_sales set disposition='excluded' where source_order_hash=repeat('7',64);
select is(private.provider_refund_original_sale_date('b1842500-0000-4000-8000-000000000001'),null::date,'Unpromoted receipt cannot supply original purchase');
update nayax_pending_sales set disposition='promoted',account_key='OTHER_ACCOUNT' where source_order_hash=repeat('7',64);
select is(private.provider_refund_original_sale_date('b1842500-0000-4000-8000-000000000001'),null::date,'Promoted receipt must match exact event account');
update nayax_pending_sales set account_key='TGPACI_USA_DB',source_row_hash=repeat('8',64),normalized_sale=normalized_sale||jsonb_build_object('sourceRowHash',repeat('8',64)) where source_order_hash=repeat('7',64);
select is(private.provider_refund_original_sale_date('b1842500-0000-4000-8000-000000000001'),null::date,'Promotion requires exact immutable source row');
update nayax_pending_sales set source_row_hash=repeat('2',64),normalized_sale=normalized_sale||jsonb_build_object('sourceRowHash',repeat('2',64)) where source_order_hash=repeat('7',64);
set local session_replication_role=replica;
delete from nayax_dtm_export_completions where file_digest=repeat('1',64);
set local session_replication_role=origin;
select is(private.provider_refund_original_sale_date('b1842500-0000-4000-8000-000000000001'),null::date,'Incomplete import cannot prove promoted original');
set local session_replication_role=replica;
update nayax_dtm_export_rows set fact_id='b1842400-0000-4000-8000-000000000001',disposition='fact_linked',mapping_disposition='canonical' where file_digest=repeat('1',64);
set local session_replication_role=origin;
-- Native importer validates USD before storing facts but its oldest payload
-- omitted currencyCode. The accepted actor/source tuple remains source proof.
update machine_sales_facts set raw_payload=raw_payload-'currencyCode' where id='b1842400-0000-4000-8000-000000000001';
select is((select sales_ex_tax_cents from private.machine_sales_daily_components('b1842300-0000-4000-8000-000000000001','2099-09-01','2099-09-01')),1000::bigint,'Older native USA import without stored currency retains exact original rate');
update machine_sales_facts set raw_payload=raw_payload||'{"currencyCode":"USD"}',tax_cents=60 where id='b1842400-0000-4000-8000-000000000001';
set local session_replication_role=replica;
insert into machine_sales_facts(id,reporting_machine_id,reporting_location_id,sale_date,payment_method,net_sales_cents,transaction_count,tax_cents,source,source_row_hash,raw_payload)
select 'b1842400-0000-4000-8000-000000000002',reporting_machine_id,reporting_location_id,sale_date,payment_method,net_sales_cents,transaction_count,0,source,'ambiguous-original',raw_payload from machine_sales_facts where id='b1842400-0000-4000-8000-000000000001';
insert into nayax_dtm_export_rows(file_digest,source_row_hash,provider_actor_id,provider_machine_id,provider_site_id,provider_transaction_id,settlement_amount_cents,machine_settled_at,provider_type,machine_name_hash,mapping_disposition,financial_disposition,history_scope_disposition,disposition,fact_id)
select repeat('5',64),repeat('6',64),provider_actor_id,provider_machine_id,provider_site_id,provider_transaction_id,settlement_amount_cents,machine_settled_at,provider_type,machine_name_hash,mapping_disposition,financial_disposition,history_scope_disposition,disposition,'b1842400-0000-4000-8000-000000000002' from nayax_dtm_export_rows where file_digest=repeat('1',64);
set local session_replication_role=origin;
delete from private.nayax_machine_tax_observations where nayax_machine_id='18420001' and account_key='TGPACI_USA_DB';
select is(private.provider_refund_original_sale_date('b1842500-0000-4000-8000-000000000001'),null::date,'Two exact original fact IDs cannot prove unique purchase identity');
select is(private.provider_refund_original_source_tax_cents('b1842500-0000-4000-8000-000000000001',106),null::bigint,'Known and unknown exact originals remain ambiguous');
-- Isolate the tax helper's own uniqueness guard from the upstream date guard.
create or replace function private.provider_refund_original_sale_date(p_adjustment_id uuid) returns date language sql stable set search_path='' as $$select '2099-09-01'::date$$;
select is(private.provider_refund_original_source_tax_cents('b1842500-0000-4000-8000-000000000001',106),null::bigint,'Tax helper counts unknown candidate before rejecting its tax');
update machine_sales_facts set tax_cents=80 where id='b1842400-0000-4000-8000-000000000002';
select is(private.provider_refund_original_source_tax_cents('b1842500-0000-4000-8000-000000000001',106),null::bigint,'Two distinct known tax candidates cannot select minimum');
select * from finish();
rollback;
