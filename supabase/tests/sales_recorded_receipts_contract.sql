begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
set local session_replication_role=replica;
insert into auth.users(id,email) values('b1824400-0000-4000-8000-000000000011','receipts-owner@example.invalid'),('b1824400-0000-4000-8000-000000000012','receipts-outsider@example.invalid');
insert into customer_accounts(id,name) values('b1824500-0000-4000-8000-000000000011','Receipts fixture');
insert into reporting_locations(id,account_id,name,timezone) values('b1824600-0000-4000-8000-000000000011','b1824500-0000-4000-8000-000000000011','Receipts site','America/Los_Angeles');
insert into reporting_machines(id,account_id,location_id,machine_label) values('b1824700-0000-4000-8000-000000000011','b1824500-0000-4000-8000-000000000011','b1824600-0000-4000-8000-000000000011','Recorded receipts');
insert into reporting_machines(id,account_id,location_id,machine_label,management_archived_at,management_archive_reason) values('b1824700-0000-4000-8000-000000000012','b1824500-0000-4000-8000-000000000011','b1824600-0000-4000-8000-000000000011','Historical permitted empty machine','2099-09-01','Synthetic archive');
insert into reporting_machine_entitlements(user_id,machine_id,starts_at) values('b1824400-0000-4000-8000-000000000011','b1824700-0000-4000-8000-000000000011','2000-01-01');
insert into reporting_machine_entitlements(user_id,machine_id,starts_at) values('b1824400-0000-4000-8000-000000000011','b1824700-0000-4000-8000-000000000012','2000-01-01');
-- Same source/date/tender: three distinct basis components collapse into one
-- canonical row. Known original tax and inclusive receipts must survive.
insert into machine_sales_facts(reporting_machine_id,reporting_location_id,sale_date,payment_method,net_sales_cents,transaction_count,tax_cents,source,source_row_hash,raw_payload) values
 ('b1824700-0000-4000-8000-000000000011','b1824600-0000-4000-8000-000000000011','2099-10-01','credit',1080,2,80,'manual_csv','receipts-known','{"amountBasis":"separate_tax"}'),
 ('b1824700-0000-4000-8000-000000000011','b1824600-0000-4000-8000-000000000011','2099-10-01','credit',550,1,0,'manual_csv','receipts-inclusive-missing-tax','{"amountBasis":"tax_inclusive"}'),
 ('b1824700-0000-4000-8000-000000000011','b1824600-0000-4000-8000-000000000011','2099-10-01','credit',700,1,0,'manual_csv','receipts-unknown-basis','{}'),
 ('b1824700-0000-4000-8000-000000000011','b1824600-0000-4000-8000-000000000011','2099-10-02','cash',200,1,0,'snapcase_cash','receipts-cash','{}'),
 ('b1824700-0000-4000-8000-000000000011','b1824600-0000-4000-8000-000000000011','2099-10-02','credit',9999,99,0,'snapcase_cash','receipts-card-comparison','{"amountBasis":"tax_inclusive"}');
insert into sales_adjustment_facts(reporting_machine_id,reporting_location_id,adjustment_date,adjustment_type,amount_cents,source,source_row_hash,raw_payload,created_at) values
 ('b1824700-0000-4000-8000-000000000011','b1824600-0000-4000-8000-000000000011','2099-10-03','refund',100,'manual','receipts-refund-only','{"payment_method":"cash","amountBasis":"tax_exclusive"}','2020-01-01');
set local session_replication_role=origin;
select set_config('request.jwt.claim.sub','b1824400-0000-4000-8000-000000000011',true);
select set_config('request.jwt.claim.role','authenticated',true);
select is((select management_archived_at from public.get_reporting_dimensions() where machine_id='b1824700-0000-4000-8000-000000000012'),'2099-09-01'::timestamptz,'Authorized empty historical machine remains in dimensions with explicit archival metadata');
select is((select latest_sale_date from public.get_reporting_dimensions() where machine_id='b1824700-0000-4000-8000-000000000012'),null::date,'Empty machine does not invent last recorded sale');
select is((select management_archived_at from public.get_reporting_dimensions() where machine_id='b1824700-0000-4000-8000-000000000011'),null::timestamptz,'Active roster marker is explicitly null');
-- Rollout fallback must still execute with its original version and all fields.
update private.refund_request_recognition_rollout set activated_at=null where singleton;
select lives_ok($$select * from public.get_sales_report('2099-10-01','2099-10-03','day',array['b1824700-0000-4000-8000-000000000011'::uuid])$$,'Legacy interactive row wrapper supports additive contract');
select lives_ok($$select * from public.get_sales_report('{"dateFrom":"2099-10-01","dateTo":"2099-10-03","grain":"day","machineIds":["b1824700-0000-4000-8000-000000000011"]}'::jsonb)$$,'JSON row wrapper supports additive legacy contract');
select set_config('request.jwt.claim.role','service_role',true);
select lives_ok($$select * from public.sales_report_scheduler_get_sales_report('b1824400-0000-4000-8000-000000000011','2099-10-01','2099-10-03','day',array['b1824700-0000-4000-8000-000000000011'::uuid])$$,'Legacy scheduler wrapper supports additive contract');
insert into private.refund_request_recognition_rollout(singleton,activated_at,activated_by) values(true,'2099-10-01','Synthetic receipt test') on conflict(singleton) do update set activated_at=excluded.activated_at;
create temporary table receipt_rows as select * from private.sales_report_rows_for_actor('b1824400-0000-4000-8000-000000000011','2099-10-01','2099-10-03','day',array['b1824700-0000-4000-8000-000000000011'::uuid]);
select is((select net_sales_cents from receipt_rows where period_start='2099-10-01'),null::bigint,'Existing net remains unknown rather than publishing a partial complete value');
select is((select gross_sales_cents from receipt_rows where period_start='2099-10-01'),null::bigint,'Existing ex-tax sales remains unknown');
select is((select customer_receipts_cents from receipt_rows where period_start='2099-10-01'),null::bigint,'Unknown source basis prevents complete customer receipt claim');
select is((select customer_receipts_known_cents from receipt_rows where period_start='2099-10-01'),1630::bigint,'Same source/date known inclusive payment amounts survive unknown component');
select is((select customer_receipts_unknown_count from receipt_rows where period_start='2099-10-01'),1::bigint,'Receipt unknown count measures unknown-basis components, not missing tax');
select is((select gross_sales_known_cents from receipt_rows where period_start='2099-10-01'),1000::bigint,'Same source/date original-tax ex-tax subtotal survives two unresolved components');
select is((select gross_sales_unknown_count from receipt_rows where period_start='2099-10-01'),2::bigint,'Ex-tax unknown count preserves component units');
select is((select net_sales_known_cents from receipt_rows where period_start='2099-10-01'),1000::bigint,'Independent known net component subtotal survives null row');
select is((select net_sales_unknown_count from receipt_rows where period_start='2099-10-01'),2::bigint,'Independent net unknown components preserved');
select is((select transaction_count from receipt_rows where period_start='2099-10-01'),4::bigint,'Recorded transactions remain independent of payment normalization');
select is((select customer_receipts_cents from receipt_rows where period_start='2099-10-02'),200::bigint,'Genuine cash remains collected cash; comparison card does not duplicate revenue');
select is((select transaction_count from receipt_rows where period_start='2099-10-02'),1::bigint,'Excluded comparison observations do not inflate transaction count');
select is((select customer_receipts_known_cents from receipt_rows where period_start='2099-10-03'),null::bigint,'Refund-only day has no recorded receipt rather than a false zero');
select is((select customer_receipts_unknown_count from receipt_rows where period_start='2099-10-03'),0::bigint,'Refund-only day has no unknown payment component');
select is((select refund_amount_known_cents from receipt_rows where period_start='2099-10-03'),100::bigint,'Refund amount remains independent of recorded receipts');
select is((select count(*) from private.sales_report_rows_for_actor('b1824400-0000-4000-8000-000000000012','2099-10-01','2099-10-03','day',array['b1824700-0000-4000-8000-000000000011'::uuid])),0::bigint,'Additive money cannot leak to an unauthorized actor');
select is((select count(*) from private.sales_report_rows_for_actor('b1824400-0000-4000-8000-000000000011','2099-10-04','2099-10-04','day',array['b1824700-0000-4000-8000-000000000011'::uuid])),0::bigint,'Empty imported day never synthesizes zero');
select set_config('request.jwt.claim.role','authenticated',true);
select is((public.get_sales_report_complete('2099-10-01','2099-10-03','day',array['b1824700-0000-4000-8000-000000000011'::uuid],null,null,'b1824500-0000-4000-8000-000000000011')#>>'{0,calculation_version}'),'shared-sales-basis-v1','Company complete JSON preserves established calculation version');
select ok(not has_function_privilege('authenticated','private.machine_sales_daily_receipt_components(uuid,date,date)','EXECUTE') and not has_function_privilege('authenticated','public.sales_report_scheduler_get_sales_report(uuid,date,date,text,uuid[],uuid[],text[])','EXECUTE'),'Additive adapters and scheduler retain private role boundary');
select * from finish();
rollback;
