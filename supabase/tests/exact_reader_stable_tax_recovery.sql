begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
set local timezone='UTC';
select no_plan();
set local session_replication_role=replica;
insert into customer_accounts(id,name) values('b1846100-0000-4000-8000-000000000001','Exact recovery fixture');
insert into reporting_locations(id,account_id,name,timezone) values
 ('b1846200-0000-4000-8000-000000000001','b1846100-0000-4000-8000-000000000001','Exact site','UTC');
insert into reporting_machines(id,account_id,location_id,machine_label,nayax_machine_id,nayax_account_key) values
 ('b1846300-0000-4000-8000-000000000001','b1846100-0000-4000-8000-000000000001','b1846200-0000-4000-8000-000000000001','Exact reader','184600001','TEST_EXACT'),
 ('b1846300-0000-4000-8000-000000000002','b1846100-0000-4000-8000-000000000001','b1846200-0000-4000-8000-000000000001','Unrelated reader','184600002','TEST_EXACT'),
 ('b1846300-0000-4000-8000-000000000003','b1846100-0000-4000-8000-000000000001','b1846200-0000-4000-8000-000000000001','Conflicting reader','184600003','TEST_EXACT');
set local session_replication_role=origin;
insert into private.nayax_machine_tax_observations(account_key,nayax_machine_id,observed_at,source,classification,rate_percent,provenance,effective_start_date) values
 ('TEST_EXACT','184600001','2026-10-05T21:00Z','nayax_api','verified_tax',9,'Fixture earlier exact API','2026-10-05'),
 ('TEST_EXACT','184600001','2026-10-08T19:31:25.82Z','nayax_api','verified_tax',9,'Fixture later matching API','2026-10-08'),
 ('TEST_EXACT','184600002','2026-10-05','nayax_api','verified_tax',12,'Fixture unrelated API','2026-10-05'),
 ('TEST_EXACT','184600003','2026-10-05','nayax_api','verified_tax',9,'Fixture conflicting API','2026-10-05'),
 ('TEST_EXACT','184600003','2026-10-06','nayax_api','verified_tax',10,'Fixture conflicting API','2026-10-06');
create temporary table refund_components(day date,amount bigint);
insert into refund_components select date '2026-01-01'+n,1090::bigint*(n+1) from generate_series(0,5)n;
select is((select count(*) from refund_components r cross join lateral private.normalize_refund_original_reader_amount_cents('b1846300-0000-4000-8000-000000000001','card',r.day,r.amount,'tax_inclusive',null,null,true)n where n.tax_exclusive_amount_cents is null),6::bigint,'Six dated inclusive refund components are initially unresolved');
select is(private.record_exact_owner_stable_tax_history('TEST_EXACT','184600001',9,'2026-10-08T18:09Z','2026-10-08T19:31:25.82Z','#1824 unchanged rates'),1::bigint,'Apply existing owner authority only to exact reviewed tuple');
select is((select count(*) from refund_components r cross join lateral private.normalize_refund_original_reader_amount_cents('b1846300-0000-4000-8000-000000000001','card',r.day,r.amount,'tax_inclusive',null,null,true)n where n.tax_exclusive_amount_cents=1000*(extract(day from r.day))),6::bigint,'All six equivalent refund components recover exact 9 percent');
select is((select sum(n.tax_exclusive_amount_cents) from refund_components r cross join lateral private.normalize_refund_original_reader_amount_cents('b1846300-0000-4000-8000-000000000001','card',r.day,r.amount,'tax_inclusive',null,null,true)n),21000::numeric,'Known normalized refund subtotal is correct');
select is((select count(*) from private.nayax_machine_tax_observations where account_key='TEST_EXACT' and nayax_machine_id='184600001' and source='nayax_api'),2::bigint,'Both original source observations remain');
select ok(exists(select 1 from private.nayax_machine_tax_observations where account_key='TEST_EXACT' and nayax_machine_id='184600001' and source='owner_stable_rate' and observed_at between transaction_timestamp() and statement_timestamp() and provenance like '%owner attestation=2026-10-08 18:09%' and provenance like '%evidence through=2026-10-08 19:31:25.82%' and provenance like '%actual application=%' and provenance like '%verified observation IDs=%'),'Separate authority, evidence and actual application times retained');
select is((select source from private.resolve_reporting_machine_source_tax('b1846300-0000-4000-8000-000000000001','2026-10-05')),'nayax_api','Dated source observation retains precedence');
select results_eq($$select tax_exclusive_amount_cents,tax_cents from private.normalize_refund_original_reader_amount_cents('b1846300-0000-4000-8000-000000000001','card','2026-01-01',1090,'tax_inclusive',null,100,true)$$,$$select 990::bigint,100::bigint$$,'Original transaction tax overrides stable percentage');
select is((select rate_percent from private.resolve_reporting_machine_source_tax('b1846300-0000-4000-8000-000000000002','2026-01-01')),null::numeric,'Unrelated tuple receives no historical inference');
select throws_ok($$select private.record_exact_owner_stable_tax_history('TEST_EXACT','184600003',9,'2026-10-08T18:09Z','2026-10-08T19:31:25.82Z','Fixture owner authority')$$,'22023','Conflicting verified reader rates require exact reconciliation','Conflicting verified rates cannot infer history');
select throws_ok($$select private.record_exact_owner_stable_tax_history('OTHER_ACCOUNT','184600001',9,'2026-10-08T18:09Z','2026-10-08T19:31:25.82Z','Fixture owner authority')$$,'22023','Exact reader ownership evidence required','Other account cannot borrow identity');
select is(private.record_exact_owner_stable_tax_history('TEST_EXACT','184600001',9,'2026-10-08T18:09Z','2026-10-08T19:31:25.82Z','#1824 unchanged rates'),0::bigint,'Scoped recovery replay is idempotent');
select ok(not has_function_privilege('authenticated','private.record_exact_owner_stable_tax_history(text,text,numeric,timestamptz,timestamptz,text)','EXECUTE') and not has_function_privilege('service_role','private.record_exact_owner_stable_tax_history(text,text,numeric,timestamptz,timestamptz,text)','EXECUTE'),'Browser and worker cannot invoke internal attestation');
select * from finish();
rollback;
