begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
-- Synthetic disposable fixtures; actual tested saves run with origin triggers.
set local session_replication_role=replica;
insert into auth.users(id,email) values
 ('aa175100-0000-4000-8000-000000000001','report-name-admin@example.invalid'),
 ('aa175100-0000-4000-8000-000000000002','report-name-outsider@example.invalid');
insert into public.admin_roles(user_id,role,active) values('aa175100-0000-4000-8000-000000000001','super_admin',true);
insert into public.customer_accounts(id,name,account_type) values
 ('aa175101-0000-4000-8000-000000000001','Name original company','internal'),
 ('aa175101-0000-4000-8000-000000000002','Name zero venue target','internal'),
 ('aa175101-0000-4000-8000-000000000003','Name one venue target','internal'),
 ('aa175101-0000-4000-8000-000000000004','Name multiple venue target','internal');
insert into public.reporting_locations(id,account_id,name,timezone) values
 ('aa175102-0000-4000-8000-000000000001','aa175101-0000-4000-8000-000000000001','Shared durable venue','America/New_York'),
 ('aa175102-0000-4000-8000-000000000002','aa175101-0000-4000-8000-000000000003','Existing single target venue','America/Chicago'),
 ('aa175102-0000-4000-8000-000000000003','aa175101-0000-4000-8000-000000000004','Existing multiple target A','America/Chicago'),
 ('aa175102-0000-4000-8000-000000000004','aa175101-0000-4000-8000-000000000004','Existing multiple target B','America/Denver'),
 ('aa175102-0000-4000-8000-000000000005','aa175101-0000-4000-8000-000000000001','Unique collision venue','America/New_York'),
 ('aa175102-0000-4000-8000-000000000006','aa175101-0000-4000-8000-000000000001','Unmapped collision fixture','America/New_York');
insert into public.reporting_machines(id,account_id,location_id,machine_label,machine_type,refund_public_display_label) values
 ('aa175103-0000-4000-8000-000000000001','aa175101-0000-4000-8000-000000000001','aa175102-0000-4000-8000-000000000001','Opaque original alias','commercial','Customer machine name'),
 ('aa175103-0000-4000-8000-000000000002','aa175101-0000-4000-8000-000000000001','aa175102-0000-4000-8000-000000000001','Shared sibling alias','commercial','Sibling machine name'),
 ('aa175103-0000-4000-8000-000000000003','aa175101-0000-4000-8000-000000000001','aa175102-0000-4000-8000-000000000005','Collision original alias','commercial','Collision name'),
 ('aa175103-0000-4000-8000-000000000004','aa175101-0000-4000-8000-000000000001','aa175102-0000-4000-8000-000000000006','Collision other alias','commercial','Collision name');
-- Keep the shared sibling in reporting scope without creating a same-category
-- public duplicate: positive transfer tests begin with an eligible exact choice.
update public.reporting_machines set machine_type='snapcase' where id='aa175103-0000-4000-8000-000000000002';
insert into public.reporting_machine_refund_managers(reporting_machine_id,manager_user_id,manager_email,status)
 select id,'aa175100-0000-4000-8000-000000000001','report-name-admin@example.invalid','active' from public.reporting_machines where id::text like 'aa175103-%';
insert into public.reporting_machine_entitlements(user_id,machine_id,starts_at)
 select 'aa175100-0000-4000-8000-000000000001',id,'2020-01-01' from public.reporting_machines where id::text like 'aa175103-%';
insert into public.reporting_machine_tax_rates(machine_id,tax_rate_percent,effective_start_date,status)
 select id,0,'2020-01-01','active' from public.reporting_machines where id::text like 'aa175103-%';
insert into public.machine_sales_facts(reporting_machine_id,reporting_location_id,sale_date,payment_method,net_sales_cents,transaction_count,source,source_row_hash,raw_payload) values
 ('aa175103-0000-4000-8000-000000000001','aa175102-0000-4000-8000-000000000001','2026-02-01','cash',1200,2,'sunze_browser','report-name-one','{}'),
 ('aa175103-0000-4000-8000-000000000002','aa175102-0000-4000-8000-000000000001','2026-02-01','cash',2300,3,'sunze_browser','report-name-two','{}');
insert into public.reporting_partnerships(id,name,effective_start_date,status) values
 ('aa175104-0000-4000-8000-000000000001','Name reporting partnership','2020-01-01','active');
insert into public.refund_cases(id,public_reference,reporting_machine_id,reporting_location_id,customer_email,issue_summary,incident_at,payment_method,payment_amount_cents,refund_amount_cents,status,customer_request_received_at,customer_request_received_source) values
 ('aa175105-0000-4000-8000-000000000001','RF-NAME-1751','aa175103-0000-4000-8000-000000000001','aa175102-0000-4000-8000-000000000001','name-case@example.invalid','Synthetic name report','2026-02-01T12:00Z','card',1200,1200,'needs_review','2026-02-01T12:00Z','hosted_refund_intake');
insert into public.reporting_machine_partnership_assignments(machine_id,partnership_id,effective_start_date,status)
 select id,'aa175104-0000-4000-8000-000000000001','2020-01-01','active' from public.reporting_machines where id in ('aa175103-0000-4000-8000-000000000001','aa175103-0000-4000-8000-000000000002');
insert into public.refund_machine_qr_codes(reporting_machine_id,public_code,version) values('aa175103-0000-4000-8000-000000000003',repeat('c',32),1);
create temporary table durable_locations as select id,to_jsonb(l) value from public.reporting_locations l where id::text like 'aa175102-%';
create temporary table durable_facts as select id,to_jsonb(f) value from public.machine_sales_facts f where source_row_hash in ('report-name-one','report-name-two');
create temporary table durable_qr as select to_jsonb(qr) value from public.refund_machine_qr_codes qr where reporting_machine_id='aa175103-0000-4000-8000-000000000003';
set local session_replication_role=origin;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','aa175100-0000-4000-8000-000000000001',true);
select is((select machine_label from public.get_reporting_dimensions() where machine_id='aa175103-0000-4000-8000-000000000001'),'Customer machine name','Sales dimensions use legacy effective customer name');
select is((select machine_label from private.sales_report_rows_for_actor('aa175100-0000-4000-8000-000000000001','2026-02-01','2026-02-28','day',array['aa175103-0000-4000-8000-000000000001']::uuid[],null,null) limit 1),'Customer machine name','Current sales rows use effective customer name');
select is((select machine_label from private.sales_report_legacy_rows_for_actor('aa175100-0000-4000-8000-000000000001','2026-02-01','2026-02-28','day',array['aa175103-0000-4000-8000-000000000001']::uuid[],null,null) limit 1),'Customer machine name','Legacy sales rows use effective customer name');
select ok(public.get_finance_reporting('2026-02-01','2026-02-28') @> '{"rows":[{"machineId":"aa175103-0000-4000-8000-000000000001","machineLabel":"Customer machine name"}]}','Finance rows use effective name');
select ok(public.get_refund_analytics('2026-02-01','2026-02-28') @> '{"machines":[{"machineId":"aa175103-0000-4000-8000-000000000001","machineLabel":"Customer machine name"}]}','Refund analytics rows use effective name');
select ok(public.admin_preview_partner_period_report('aa175104-0000-4000-8000-000000000001','2026-02-01','2026-02-28','calendar_month') @> '{"machine_periods":[{"reporting_machine_id":"aa175103-0000-4000-8000-000000000001","machine_label":"Customer machine name"}]}','Partner period output uses effective name');
create temporary table sales_before as select to_jsonb(r)-'machine_label'-'location_name' value from public.get_sales_report('2026-02-01','2026-02-28','day',array['aa175103-0000-4000-8000-000000000001','aa175103-0000-4000-8000-000000000002']::uuid[]) r;
create temporary table finance_before as select r-'machineLabel'-'locationName' value from jsonb_array_elements(public.get_finance_reporting('2026-02-01','2026-02-28')->'rows') r;
create temporary table refund_before as select r-'machineLabel'-'locationName' value from jsonb_array_elements(public.get_refund_analytics('2026-02-01','2026-02-28')->'machines') r;
create temporary table partner_before as select r-'machine_label'-'location_name' value from jsonb_array_elements(public.admin_preview_partner_period_report('aa175104-0000-4000-8000-000000000001','2026-02-01','2026-02-28','calendar_month')->'machine_periods') r;
create temporary table membership_before as select private.refund_selection_membership() value;
select is((select count(*)::int from public.public_refund_selections_v2() where machine_id='aa175103-0000-4000-8000-000000000001'),1,'Positive transfer fixture begins with eligible exact public choice');
select lives_ok($$select public.admin_set_machine_display_name('aa175103-0000-4000-8000-000000000001','Canonical machine name','Customer machine name')$$,'Explicit canonical name edit succeeds');
select is((select machine_label from public.get_reporting_dimensions() where machine_id='aa175103-0000-4000-8000-000000000001'),'Canonical machine name','Sales dimensions use deliberate canonical name');
select ok(not exists((select to_jsonb(r)-'machine_label'-'location_name' from public.get_sales_report('2026-02-01','2026-02-28','day',array['aa175103-0000-4000-8000-000000000001','aa175103-0000-4000-8000-000000000002']::uuid[]) r except select value from sales_before) union all (select value from sales_before except select to_jsonb(r)-'machine_label'-'location_name' from public.get_sales_report('2026-02-01','2026-02-28','day',array['aa175103-0000-4000-8000-000000000001','aa175103-0000-4000-8000-000000000002']::uuid[]) r)),'Name edit preserves all sales measures, dates, IDs and shared venue grouping');
select ok(not exists((select r-'machineLabel'-'locationName' from jsonb_array_elements(public.get_finance_reporting('2026-02-01','2026-02-28')->'rows') r except select value from finance_before) union all (select value from finance_before except select r-'machineLabel'-'locationName' from jsonb_array_elements(public.get_finance_reporting('2026-02-01','2026-02-28')->'rows') r)),'Name edit preserves all finance values and grouping IDs');
select is(private.refund_selection_membership(),(select value from membership_before),'Canonical edit preserves public identity and membership');
select ok(not exists((select r-'machineLabel'-'locationName' from jsonb_array_elements(public.get_refund_analytics('2026-02-01','2026-02-28')->'machines') r except select value from refund_before) union all (select value from refund_before except select r-'machineLabel'-'locationName' from jsonb_array_elements(public.get_refund_analytics('2026-02-01','2026-02-28')->'machines') r)),'Name edit preserves refund counts, amounts and identities');
select ok(not exists((select r-'machine_label'-'location_name' from jsonb_array_elements(public.admin_preview_partner_period_report('aa175104-0000-4000-8000-000000000001','2026-02-01','2026-02-28','calendar_month')->'machine_periods') r except select value from partner_before) union all (select value from partner_before except select r-'machine_label'-'location_name' from jsonb_array_elements(public.admin_preview_partner_period_report('aa175104-0000-4000-8000-000000000001','2026-02-01','2026-02-28','calendar_month')->'machine_periods') r)),'Name edit preserves partner period amounts, scopes and grouping IDs');
-- Explicit target association creation never reuses zero/one/multiple company venues.
select lives_ok($$select public.admin_save_named_machine('aa175103-0000-4000-8000-000000000001','aa175101-0000-4000-8000-000000000002',null,'Canonical machine name','commercial',null,'setup','Move zero venue company','aa175101-0000-4000-8000-000000000001','aa175102-0000-4000-8000-000000000001','Unmapped Hub aa175103-0000-4000-8000-000000000001','America/New_York','Canonical machine name')$$,'Company with zero venues creates internal association');
select is((select location_name from public.get_reporting_dimensions() where machine_id='aa175103-0000-4000-8000-000000000001'),'Canonical machine name','Generated internal location does not leak through dimensions');
select is((select l.timezone from public.reporting_machines m join public.reporting_locations l on l.id=m.location_id where m.id='aa175103-0000-4000-8000-000000000001'),'America/New_York','Transfer retains exact saved timezone');
create temporary table transfer_one as select location_id from public.reporting_machines where id='aa175103-0000-4000-8000-000000000001';
select lives_ok($$select public.admin_save_named_machine('aa175103-0000-4000-8000-000000000001','aa175101-0000-4000-8000-000000000003',null,'Canonical machine name','commercial',null,'setup','Move one venue company','aa175101-0000-4000-8000-000000000002',(select location_id from transfer_one),'Unmapped Hub aa175103-0000-4000-8000-000000000001','America/New_York','Canonical machine name')$$,'Company with one venue creates separate internal association');
select isnt((select location_id from public.reporting_machines where id='aa175103-0000-4000-8000-000000000001'),'aa175102-0000-4000-8000-000000000002'::uuid,'One existing venue is never guessed or reused');
create temporary table transfer_two as select location_id from public.reporting_machines where id='aa175103-0000-4000-8000-000000000001';
select lives_ok($$select public.admin_save_named_machine('aa175103-0000-4000-8000-000000000001','aa175101-0000-4000-8000-000000000004',null,'Canonical machine name','commercial',null,'setup','Move multiple venue company','aa175101-0000-4000-8000-000000000003',(select location_id from transfer_two),'Unmapped Hub aa175103-0000-4000-8000-000000000001','America/New_York','Canonical machine name')$$,'Company with multiple venues creates separate internal association');
select ok((select location_id not in ('aa175102-0000-4000-8000-000000000003','aa175102-0000-4000-8000-000000000004') from public.reporting_machines where id='aa175103-0000-4000-8000-000000000001'),'Multiple existing venues never guessed or reused');
select is(private.refund_selection_membership(),(select value from membership_before),'Successful company transfers preserve all customer choices');
create temporary table collision_machine_before as select to_jsonb(m) value from public.reporting_machines m where id='aa175103-0000-4000-8000-000000000003';
create temporary table collision_counts_before as select (select count(*) from public.reporting_locations) locations,(select count(*) from public.admin_audit_log) audits;
select throws_ok($$select public.admin_save_named_machine('aa175103-0000-4000-8000-000000000003','aa175101-0000-4000-8000-000000000002',null,'Collision name','commercial',null,'setup','Collision transfer','aa175101-0000-4000-8000-000000000001','aa175102-0000-4000-8000-000000000005','Unmapped Hub aa175103-0000-4000-8000-000000000003','America/New_York','Collision name')$$,'22023',null,'Assignment that changes duplicate suppression rejects atomically');
select is((select to_jsonb(m) from public.reporting_machines m where id='aa175103-0000-4000-8000-000000000003'),(select value from collision_machine_before),'Rejected assignment restores whole machine row');
select is((select count(*) from public.reporting_locations),(select locations from collision_counts_before),'Rejected assignment leaves no new internal association');
select is((select count(*) from public.admin_audit_log),(select audits from collision_counts_before),'Rejected assignment leaves no audit mutation');
select is(private.refund_selection_membership(),(select value from membership_before),'Rejected assignment preserves all public choices');
select ok(not exists(select 1 from durable_locations d join public.reporting_locations l using(id) where to_jsonb(l) is distinct from d.value),'All original shared venues/timezones/status remain byte-equivalent');
select ok(not exists(select 1 from durable_facts d join public.machine_sales_facts f using(id) where to_jsonb(f) is distinct from d.value),'All historical facts remain byte-equivalent');
select is((select to_jsonb(qr) from public.refund_machine_qr_codes qr where reporting_machine_id='aa175103-0000-4000-8000-000000000003'),(select value from durable_qr),'QR identity/status/version remain byte-equivalent');
select ok(not has_function_privilege('authenticated','private.project_machine_report_names(jsonb)','EXECUTE'),'Private display projection cannot be called directly');
select ok(not has_function_privilege('anon','public.admin_save_named_machine(uuid,uuid,uuid,text,text,text,text,text,uuid,uuid,text,text,text)','EXECUTE'),'Anonymous named writes remain denied');
select set_config('request.jwt.claim.sub','aa175100-0000-4000-8000-000000000002',true);
select throws_ok($$select public.admin_save_named_machine('aa175103-0000-4000-8000-000000000003','aa175101-0000-4000-8000-000000000001','aa175102-0000-4000-8000-000000000005','Collision name','commercial',null,'setup','Unauthorized save','aa175101-0000-4000-8000-000000000001','aa175102-0000-4000-8000-000000000005',null,null,'Collision name')$$,'42501',null,'Unauthorized actor cannot change hidden associations');
select * from finish();
rollback;
