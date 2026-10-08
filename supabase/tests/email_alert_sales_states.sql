begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
-- One connection repeatedly executes the same cached projection plans with
-- alternating reported, restricted, missing-data and reported machines.
set local session_replication_role=replica;
insert into auth.users(id,email) values
 ('ed710000-0000-4000-8000-000000000001','mixed-one@example.invalid'),
 ('ed710000-0000-4000-8000-000000000002','mixed-two@example.invalid');
insert into public.customer_accounts(id,name,account_type)
 values('ed720000-0000-4000-8000-000000000001','Mixed metric fixture','internal');
insert into public.reporting_locations(id,account_id,name,timezone)
 values('ed730000-0000-4000-8000-000000000001','ed720000-0000-4000-8000-000000000001','Mixed metrics','America/Los_Angeles');
insert into public.reporting_machines(id,account_id,location_id,machine_label,status) values
 ('ed740000-0000-4000-8000-000000000001','ed720000-0000-4000-8000-000000000001','ed730000-0000-4000-8000-000000000001','A recorded','active'),
 ('ed740000-0000-4000-8000-000000000002','ed720000-0000-4000-8000-000000000001','ed730000-0000-4000-8000-000000000001','B different access','active'),
 ('ed740000-0000-4000-8000-000000000003','ed720000-0000-4000-8000-000000000001','ed730000-0000-4000-8000-000000000001','C no imported data','active'),
 ('ed740000-0000-4000-8000-000000000004','ed720000-0000-4000-8000-000000000001','ed730000-0000-4000-8000-000000000001','D recorded again','active');
insert into public.reporting_machine_refund_managers(reporting_machine_id,manager_user_id,manager_email,status)
 select m.id,u.id,u.email,'active' from public.reporting_machines m cross join auth.users u
 where m.account_id='ed720000-0000-4000-8000-000000000001'
 and u.id in ('ed710000-0000-4000-8000-000000000001','ed710000-0000-4000-8000-000000000002');
insert into public.reporting_machine_entitlements(user_id,machine_id,starts_at) values
 ('ed710000-0000-4000-8000-000000000001','ed740000-0000-4000-8000-000000000001','2020-01-01'),
 ('ed710000-0000-4000-8000-000000000001','ed740000-0000-4000-8000-000000000003','2020-01-01'),
 ('ed710000-0000-4000-8000-000000000001','ed740000-0000-4000-8000-000000000004','2020-01-01'),
 ('ed710000-0000-4000-8000-000000000002','ed740000-0000-4000-8000-000000000002','2020-01-01');
insert into public.machine_sales_facts(reporting_machine_id,reporting_location_id,sale_date,payment_method,net_sales_cents,
 transaction_count,source,source_row_hash,source_order_hash,raw_payload) values
 ('ed740000-0000-4000-8000-000000000001','ed730000-0000-4000-8000-000000000001','2026-10-02','cash',1000,10,'sunze_browser',repeat('1',64),repeat('1',32),'{}'),
 ('ed740000-0000-4000-8000-000000000002','ed730000-0000-4000-8000-000000000001','2026-10-02','cash',9999,99,'sunze_browser',repeat('2',64),repeat('2',32),'{}'),
 ('ed740000-0000-4000-8000-000000000004','ed730000-0000-4000-8000-000000000001','2026-10-02','cash',800,8,'sunze_browser',repeat('3',64),repeat('3',32),'{}'),
 ('ed740000-0000-4000-8000-000000000001','ed730000-0000-4000-8000-000000000001','2026-09-25','cash',900,9,'sunze_browser',repeat('4',64),repeat('4',32),'{}'),
 ('ed740000-0000-4000-8000-000000000004','ed730000-0000-4000-8000-000000000001','2026-09-25','cash',400,4,'sunze_browser',repeat('5',64),repeat('5',32),'{}');
insert into public.email_alert_preferences(user_id,alert_id,enabled,scope_mode,enabled_since) values
 ('ed710000-0000-4000-8000-000000000001','weekly',true,'all_assigned','2026-01-01'),
 ('ed710000-0000-4000-8000-000000000002','weekly',true,'all_assigned','2026-01-01');
set local session_replication_role=origin;

create temporary table projections as select private.email_alert_projection(
 'ed710000-0000-4000-8000-000000000001','daily','2026-10-03T15:00Z','2026-10-02','2026-10-02') p;
select is((select m#>>'{salesMetrics,salesExTax,knownSubtotal}' from projections,jsonb_array_elements(p->'machines') m where m->>'machineId'='ed740000-0000-4000-8000-000000000001'),'1000','Known ex-tax sales retained');
select is((select m#>>'{salesMetrics,sourceCoverage}' from projections,jsonb_array_elements(p->'machines') m where m->>'machineId'='ed740000-0000-4000-8000-000000000001'),'unverified','Positive imported rows do not prove period coverage');
select is((select m#>>'{previousSalesMetrics,salesExTax,knownSubtotal}' from projections,jsonb_array_elements(p->'machines') m where m->>'machineId'='ed740000-0000-4000-8000-000000000001'),'900','Comparison uses original local period');
select is((select m#>>'{salesMetrics,salesExTax,reason}' from projections,jsonb_array_elements(p->'machines') m where m->>'machineId'='ed740000-0000-4000-8000-000000000002'),'reporting_not_allowed','Restricted data has no numeric subtotal');
select is((select m#>>'{salesMetrics,salesExTax,knownSubtotal}' from projections,jsonb_array_elements(p->'machines') m where m->>'machineId'='ed740000-0000-4000-8000-000000000003'),null,'Empty canonical period stays unknown');

-- Missing normalization must not discard observed transactions or known sales.
set local session_replication_role=replica;
insert into public.machine_sales_facts(reporting_machine_id,reporting_location_id,sale_date,payment_method,net_sales_cents,
 transaction_count,source,source_row_hash,source_order_hash,raw_payload) values
 ('ed740000-0000-4000-8000-000000000001','ed730000-0000-4000-8000-000000000001','2026-10-02','credit',550,2,'manual_csv',repeat('8',64),repeat('8',32),'{"amountBasis":"tax_inclusive"}');
update public.reporting_machines set management_archived_at='2026-10-03',management_archive_reason='Synthetic legacy fixture'
 where id='ed740000-0000-4000-8000-000000000004';
set local session_replication_role=origin;
create temporary table partial_projections as select private.email_alert_projection(
 'ed710000-0000-4000-8000-000000000001','daily','2026-10-03T15:00Z','2026-10-02','2026-10-02') p;
select is((select m#>>'{salesMetrics,salesExTax,state}' from partial_projections,jsonb_array_elements(p->'machines') m where m->>'machineId'='ed740000-0000-4000-8000-000000000001'),'partial','Mixed normalization is explicitly partial');
select is((select m#>>'{salesMetrics,salesExTax,knownSubtotal}' from partial_projections,jsonb_array_elements(p->'machines') m where m->>'machineId'='ed740000-0000-4000-8000-000000000001'),'1000','Known sales survive unknown tax in same period');
select is((select m#>>'{salesMetrics,transactions,knownSubtotal}' from partial_projections,jsonb_array_elements(p->'machines') m where m->>'machineId'='ed740000-0000-4000-8000-000000000001'),'12','Observed transactions survive missing normalization');
select is((select m#>>'{salesMetrics,refundImpact,knownSubtotal}' from partial_projections,jsonb_array_elements(p->'machines') m where m->>'machineId'='ed740000-0000-4000-8000-000000000001'),'0','Independent known refund snapshot is retained');
select is((select count(*)::integer from partial_projections,jsonb_array_elements(p->'machines') m where m->>'machineId'='ed740000-0000-4000-8000-000000000004'),0,'Archived machine absent from performance roster');
select is((select p#>>'{summary,machineCount}' from partial_projections),'3','Archived machine excluded from performance count');
select ok(public.has_reporting_machine_access('ed710000-0000-4000-8000-000000000001','ed740000-0000-4000-8000-000000000004'),'Archive filtering preserves historical sales permissions');
select is((select count(*)::integer from public.machine_sales_facts where reporting_machine_id='ed740000-0000-4000-8000-000000000004'),2,'Historical raw sales remain intact');
select is(private.email_alert_metric_state(null,0,1)#>>'{reason}','normalization_unresolved','Wholly unresolved dollars have explicit reason');
select is(private.email_alert_sales_metrics('[]')#>>'{transactions,knownSubtotal}',null,'Empty observed transactions do not become zero');
-- Refund-only evidence reports its signed impact, but provides no imported
-- sales or transaction evidence. A reversal is intentionally negative.
create temporary table refund_only as select private.email_alert_sales_metrics('[{"recorded_sales_cents":0,"sales_ex_tax_cents":0,"request_deduction_ex_tax_cents":0,"legacy_paid_deduction_ex_tax_cents":0,"refund_reversal_ex_tax_cents":200,"unresolved_refund_count":0,"unresolved_sales_count":0,"commissionable_sales_ex_tax_cents":200,"sales_transaction_count":0}]') s;
select is((select s#>>'{salesExTax,knownSubtotal}' from refund_only),null,'Refund-only day never invents zero sales');
select is((select s#>>'{transactions,knownSubtotal}' from refund_only),null,'Refund-only day never invents zero transaction coverage');
select is((select s#>>'{refundImpact,knownSubtotal}' from refund_only),'-200','Refund reversal retains its signed impact');
select is((select s#>>'{netSales,knownSubtotal}' from refund_only),'200','Known reversal net component remains known');
select ok(not has_function_privilege('authenticated','private.email_alert_sales_metrics(jsonb,text)','execute'),'Internal metric helper not exposed to clients');

set local session_replication_role=replica;
insert into public.refund_cases(id,public_reference,reporting_machine_id,reporting_location_id,customer_email,issue_summary,incident_at,
 payment_method,payment_amount_cents,refund_amount_cents,status,customer_request_received_at,customer_request_received_source) values
 ('ed760000-0000-4000-8000-000000000001','RF-ARCHIVE-FIXTURE','ed740000-0000-4000-8000-000000000004','ed730000-0000-4000-8000-000000000001',
 'private@example.invalid','Machine did not dispense','2026-10-01T12:00Z','card',500,500,'needs_review','2026-10-01T12:00Z','hosted_refund_intake');
set local session_replication_role=origin;
create temporary table archive_work as select category,private.email_alert_projection(
 'ed710000-0000-4000-8000-000000000001',category,'2026-10-05T15:00Z','2026-09-28','2026-10-04') p from unnest(array['daily','weekly']) category;
select is((select count(*)::integer from archive_work,jsonb_array_elements(p->'managerCaseMachines') m where m->>'machineId'='ed740000-0000-4000-8000-000000000004'),2,'Daily and weekly preserve authorized archived manager open work');
select ok(not exists(select 1 from archive_work,jsonb_array_elements(p->'machines') m where m->>'machineId'='ed740000-0000-4000-8000-000000000004' and (m->>'includedInPerformanceScope')::boolean),'Manager work does not reintroduce archived performance membership');
select ok(not exists(select 1 from archive_work,jsonb_array_elements(p->'machines') m where m->>'machineId'='ed740000-0000-4000-8000-000000000004' and m#>>'{salesMetrics,salesExTax,knownSubtotal}' is not null),'Archived manager work does not leak performance dollars');
select is((select count(*)::integer from private.email_alert_jobs),0,'Regression sends no messages and creates no delivery jobs');
select * from finish();
rollback;

