begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select plan(6);
select ok((select indisvalid and indisready from pg_index where indexrelid='public.machine_sales_facts_nayax_reader_owner_idx'::regclass),'Historical reader owner index is ready and valid');
select ok((select indnkeyatts=2 and pg_get_indexdef(indexrelid,1,true) like '%providerMachineId%' and pg_get_indexdef(indexrelid,2,true)='reporting_machine_id' from pg_index where indexrelid='public.machine_sales_facts_nayax_reader_owner_idx'::regclass),'Reader lookup is covered by original provider ID and stable Hub ID');
select is((select pg_get_expr(indpred,indrelid) from pg_index where indexrelid='public.machine_sales_facts_nayax_reader_owner_idx'::regclass),'(source = ''nayax_scheduled_report''::text)','Only native Nayax facts belong to this index');
set local session_replication_role=replica;
insert into customer_accounts(id,name) values('b0180501-0000-4000-8000-000000000001','Reader lookup fixture');
insert into reporting_locations(id,account_id,name,timezone) values('b0180502-0000-4000-8000-000000000001','b0180501-0000-4000-8000-000000000001','Saved fixture site','America/Los_Angeles');
insert into reporting_machines(id,account_id,location_id,machine_label,machine_type) values
 ('b0180503-0000-4000-8000-000000000001','b0180501-0000-4000-8000-000000000001','b0180502-0000-4000-8000-000000000001','Original owner one','commercial'),
 ('b0180503-0000-4000-8000-000000000002','b0180501-0000-4000-8000-000000000001','b0180502-0000-4000-8000-000000000001','Original owner two','commercial'),
 ('b0180503-0000-4000-8000-000000000003','b0180501-0000-4000-8000-000000000001','b0180502-0000-4000-8000-000000000001','App observation owner','commercial');
insert into machine_sales_facts(reporting_machine_id,reporting_location_id,sale_date,payment_method,net_sales_cents,transaction_count,item_quantity,tax_cents,source,source_order_hash,source_row_hash,raw_payload) values
 ('b0180503-0000-4000-8000-000000000001','b0180502-0000-4000-8000-000000000001','2026-01-01','credit',100,1,1,0,'nayax_scheduled_report',repeat('a',64),'reader-owner-index-a','{"providerMachineId":"FIXTURE-OWNER-INDEX"}'),
 ('b0180503-0000-4000-8000-000000000001','b0180502-0000-4000-8000-000000000001','2026-01-02','credit',100,1,1,0,'nayax_scheduled_report',repeat('b',64),'reader-owner-index-b','{"providerMachineId":"FIXTURE-OWNER-INDEX"}'),
 ('b0180503-0000-4000-8000-000000000002','b0180502-0000-4000-8000-000000000001','2026-01-03','credit',100,1,1,0,'nayax_scheduled_report',repeat('c',64),'reader-owner-index-c','{"providerMachineId":"FIXTURE-OWNER-INDEX"}'),
 ('b0180503-0000-4000-8000-000000000003','b0180502-0000-4000-8000-000000000001','2026-01-04','credit',100,1,1,0,'sunze_browser',repeat('d',64),'reader-owner-index-d','{"providerMachineId":"FIXTURE-OWNER-INDEX"}');
set local session_replication_role=origin;
select results_eq($$select unnest(private.original_reader_machine_owners(' tgpaci_usa_db ',' FIXTURE-OWNER-INDEX ')) order by 1$$,$$ values ('b0180503-0000-4000-8000-000000000001'::uuid),('b0180503-0000-4000-8000-000000000002'::uuid)$$,'Original ownership retains every distinct native owner and excludes app observations');
select is(private.original_reader_machine_owners('OTHER_ACCOUNT','FIXTURE-OWNER-INDEX'),'{}'::uuid[],'A different provider account cannot borrow native ownership');
select is(private.original_reader_machine_owners('TGPACI_USA_DB','UNKNOWN-OWNER-INDEX'),'{}'::uuid[],'Unknown reader remains without inferred historical ownership');
select * from finish();
rollback;
