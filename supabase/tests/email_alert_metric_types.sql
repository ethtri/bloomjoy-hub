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
create temporary table metric_projections(label text primary key,p jsonb);
select lives_ok($$insert into metric_projections values('one-daily',private.email_alert_projection(
 'ed710000-0000-4000-8000-000000000001','daily','2026-10-03T15:00Z','2026-10-02','2026-10-02'))$$,
 'Reported to restricted to missing to reported stays valid within one machine loop');
select lives_ok($$insert into metric_projections values('two-daily',private.email_alert_projection(
 'ed710000-0000-4000-8000-000000000002','daily','2026-10-03T15:00Z','2026-10-02','2026-10-02'))$$,
 'Same cached function accepts the reverse access pattern for another recipient');
select lives_ok($$insert into metric_projections values('one-weekly',private.email_alert_projection(
 'ed710000-0000-4000-8000-000000000001','weekly','2026-10-05T15:00Z','2026-09-28','2026-10-04'))$$,
 'Weekly aggregate reuses the cached record fields without type changes');
select lives_ok($$insert into metric_projections values('one-again',private.email_alert_projection(
 'ed710000-0000-4000-8000-000000000001','daily','2026-10-03T15:00Z','2026-10-02','2026-10-02'))$$,
 'A later daily invocation remains stable after the category and recipient change');
select is((select p#>>'{summary,grossSalesCents}' from metric_projections where label='one-daily'),'1800','Known subtotal includes only authorized data-bearing machines');
select is((select p#>>'{summary,transactionCount}' from metric_projections where label='one-daily'),'18','Transaction counts remain integer-valued');
select is((select p#>>'{summary,refundAmountCents}' from metric_projections where label='one-daily'),'0','Known zero refund impact remains zero');
select is((select p#>>'{summary,netSalesCents}' from metric_projections where label='one-daily'),'1800','Canonical net is unchanged');
select is((select p#>>'{summary,salesMachineCount}' from metric_projections where label='one-daily'),'2','Restricted and missing-data machines do not expand the known cohort');
select is((select m->>'grossSalesCents' from metric_projections,jsonb_array_elements(p->'machines') m where label='one-daily' and m->>'machineId'='ed740000-0000-4000-8000-000000000002'),null,'Restricted machine stays null');
select is((select m->>'grossSalesCents' from metric_projections,jsonb_array_elements(p->'machines') m where label='one-daily' and m->>'machineId'='ed740000-0000-4000-8000-000000000003'),null,'Absent import stays null rather than invented zero');
select is((select m->>'previousGrossSalesCents' from metric_projections,jsonb_array_elements(p->'machines') m where label='one-daily' and m->>'machineId'='ed740000-0000-4000-8000-000000000001'),'900','Previous aggregate uses same stable integer type');
select is((select m->>'previousGrossSalesCents' from metric_projections,jsonb_array_elements(p->'machines') m where label='one-daily' and m->>'machineId'='ed740000-0000-4000-8000-000000000003'),null,'Missing comparison remains explicitly unknown');
select is((select p#>>'{summary,grossSalesCents}' from metric_projections where label='two-daily'),'9999','Second actor receives only their current reporting scope');
select is((select p from metric_projections where label='one-again'),(select p from metric_projections where label='one-daily'),'Repeated same-snapshot projection remains identical');
select lives_ok($$select public.service_preview_email_alerts('2026-10-03T15:00Z')$$,'Production no-send preview handles a complete recipient');

-- The same intended delivery time falls on different dates for two machine
-- timezones. Keep exact per-machine current/comparison ranges when batching.
set local session_replication_role=replica;
insert into public.reporting_locations(id,account_id,name,timezone)
 values('ed730000-0000-4000-8000-000000000002','ed720000-0000-4000-8000-000000000001','Far east fixture','Pacific/Kiritimati');
update public.reporting_machines set location_id='ed730000-0000-4000-8000-000000000002'
 where id='ed740000-0000-4000-8000-000000000004';
insert into public.machine_sales_facts(reporting_machine_id,reporting_location_id,sale_date,payment_method,net_sales_cents,
 transaction_count,source,source_row_hash,source_order_hash,raw_payload) values
 ('ed740000-0000-4000-8000-000000000004','ed730000-0000-4000-8000-000000000002','2026-10-03','cash',700,7,'sunze_browser',repeat('6',64),repeat('6',32),'{}'),
 ('ed740000-0000-4000-8000-000000000004','ed730000-0000-4000-8000-000000000002','2026-09-26','cash',300,3,'sunze_browser',repeat('7',64),repeat('7',32),'{}');
set local session_replication_role=origin;
insert into metric_projections values('two-zones',private.email_alert_projection(
 'ed710000-0000-4000-8000-000000000001','daily','2026-10-03T15:00Z','2026-10-02','2026-10-02'));
select is((select p#>>'{summary,grossSalesCents}' from metric_projections where label='two-zones'),'1700','Different local dates retain separate current-day aggregates');
select is((select m->>'dateTo' from metric_projections,jsonb_array_elements(p->'machines') m where label='two-zones' and m->>'machineId'='ed740000-0000-4000-8000-000000000004'),'2026-10-03','Far-east machine keeps its original local reporting day');
select is((select m->>'previousGrossSalesCents' from metric_projections,jsonb_array_elements(p->'machines') m where label='two-zones' and m->>'machineId'='ed740000-0000-4000-8000-000000000004'),'300','Far-east comparison uses its own previous same weekday');
select ok(not exists(
 select 1 from metric_projections p cross join lateral jsonb_array_elements(p.p->'machines') m
 cross join lateral (
  select count(*)>0 and coalesce(sum(r.unresolved_sales_count),0)=0 and coalesce(sum(r.unresolved_refund_count),0)=0 complete,
   sum(r.gross_sales_cents)::bigint gross,sum(r.refund_amount_cents)::bigint refunds,
   sum(r.net_sales_cents)::bigint net,sum(r.transaction_count)::bigint transactions
  from private.sales_report_rows_for_actor('ed710000-0000-4000-8000-000000000001',
   (m->>'dateFrom')::date,(m->>'dateTo')::date,'day',array[(m->>'machineId')::uuid]) r
 ) direct
 where p.label='two-zones' and (m->>'reportingAllowed')::boolean and
  ((m->>'salesComplete')::boolean is distinct from direct.complete
   or (m->>'grossSalesCents')::bigint is distinct from case when direct.complete then direct.gross end
   or (m->>'refundAmountCents')::bigint is distinct from case when direct.complete then direct.refunds end
   or (m->>'netSalesCents')::bigint is distinct from case when direct.complete then direct.net end
   or (m->>'transactionCount')::bigint is distinct from case when direct.complete then direct.transactions end)
),'Batched metrics equal direct canonical reporting for every authorized machine-local period');
select is((select count(*)::integer from private.email_alert_jobs),0,'Read-only regression creates no email jobs');
select * from finish();
rollback;
