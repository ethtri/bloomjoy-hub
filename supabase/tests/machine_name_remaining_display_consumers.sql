begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
-- Synthetic disposable fixtures; actual tested saves run with origin triggers.
set local session_replication_role=replica;
insert into auth.users(id,email) values
 ('aa176000-0000-4000-8000-000000000001','report-name-admin@example.invalid'),
 ('aa176000-0000-4000-8000-000000000002','report-name-outsider@example.invalid'),
 ('00000000-0000-4000-8000-000000000099','consumer-outsider@example.invalid');
insert into public.admin_roles(user_id,role,active) values('aa176000-0000-4000-8000-000000000001','super_admin',true);
insert into public.customer_accounts(id,name,account_type) values
 ('aa176001-0000-4000-8000-000000000001','Name original company','internal'),
 ('aa176001-0000-4000-8000-000000000002','Name zero venue target','internal'),
 ('aa176001-0000-4000-8000-000000000003','Name one venue target','internal'),
 ('aa176001-0000-4000-8000-000000000004','Name multiple venue target','internal');
insert into public.reporting_locations(id,account_id,name,timezone) values
 ('aa176002-0000-4000-8000-000000000001','aa176001-0000-4000-8000-000000000001','Shared durable venue','America/New_York'),
 ('aa176002-0000-4000-8000-000000000002','aa176001-0000-4000-8000-000000000003','Existing single target venue','America/Chicago'),
 ('aa176002-0000-4000-8000-000000000003','aa176001-0000-4000-8000-000000000004','Existing multiple target A','America/Chicago'),
 ('aa176002-0000-4000-8000-000000000004','aa176001-0000-4000-8000-000000000004','Existing multiple target B','America/Denver'),
 ('aa176002-0000-4000-8000-000000000005','aa176001-0000-4000-8000-000000000001','Unique collision venue','America/New_York'),
 ('aa176002-0000-4000-8000-000000000006','aa176001-0000-4000-8000-000000000001','Unmapped collision fixture','America/New_York');
insert into public.reporting_machines(id,account_id,location_id,machine_label,machine_type,refund_public_display_label) values
 ('aa176003-0000-4000-8000-000000000001','aa176001-0000-4000-8000-000000000001','aa176002-0000-4000-8000-000000000001','Opaque original alias','commercial','Customer machine name'),
 ('aa176003-0000-4000-8000-000000000002','aa176001-0000-4000-8000-000000000001','aa176002-0000-4000-8000-000000000001','Shared sibling alias','commercial','Sibling machine name'),
 ('aa176003-0000-4000-8000-000000000003','aa176001-0000-4000-8000-000000000001','aa176002-0000-4000-8000-000000000005','Collision original alias','commercial','Collision name'),
 ('aa176003-0000-4000-8000-000000000004','aa176001-0000-4000-8000-000000000001','aa176002-0000-4000-8000-000000000006','Collision other alias','commercial','Collision name');
-- Keep the shared sibling in reporting scope without creating a same-category
-- public duplicate: positive transfer tests begin with an eligible exact choice.
update public.reporting_machines set machine_type='snapcase' where id='aa176003-0000-4000-8000-000000000002';
insert into public.reporting_machine_refund_managers(reporting_machine_id,manager_user_id,manager_email,status)
 select id,'aa176000-0000-4000-8000-000000000001','report-name-admin@example.invalid','active' from public.reporting_machines where id::text like 'aa176003-%';
insert into public.reporting_machine_entitlements(user_id,machine_id,starts_at)
 select 'aa176000-0000-4000-8000-000000000001',id,'2020-01-01' from public.reporting_machines where id::text like 'aa176003-%';
insert into public.reporting_machine_tax_rates(machine_id,tax_rate_percent,effective_start_date,status)
 select id,0,'2020-01-01','active' from public.reporting_machines where id::text like 'aa176003-%';
insert into public.machine_sales_facts(reporting_machine_id,reporting_location_id,sale_date,payment_method,net_sales_cents,transaction_count,source,source_row_hash,source_order_hash,raw_payload) values
 ('aa176003-0000-4000-8000-000000000001','aa176002-0000-4000-8000-000000000001','2026-02-01','cash',1200,2,'sunze_browser','report-name-one',repeat('d',32),'{}'),
 ('aa176003-0000-4000-8000-000000000002','aa176002-0000-4000-8000-000000000001','2026-02-01','cash',2300,3,'sunze_browser','report-name-two',repeat('e',32),'{}');
insert into public.reporting_partnerships(id,name,effective_start_date,status) values
 ('aa176004-0000-4000-8000-000000000001','Name reporting partnership','2020-01-01','active');
insert into public.refund_cases(id,public_reference,reporting_machine_id,reporting_location_id,customer_email,issue_summary,incident_at,payment_method,payment_amount_cents,refund_amount_cents,status,customer_request_received_at,customer_request_received_source) values
 ('aa176005-0000-4000-8000-000000000001','RF-NAME-1751','aa176003-0000-4000-8000-000000000001','aa176002-0000-4000-8000-000000000001','name-case@example.invalid','Synthetic name report','2026-02-01T12:00Z','card',1200,1200,'needs_review','2026-02-01T12:00Z','hosted_refund_intake');
insert into public.reporting_machine_partnership_assignments(machine_id,partnership_id,effective_start_date,status)
 select id,'aa176004-0000-4000-8000-000000000001','2020-01-01','active' from public.reporting_machines where id in ('aa176003-0000-4000-8000-000000000001','aa176003-0000-4000-8000-000000000002');
insert into public.refund_machine_qr_codes(reporting_machine_id,public_code,version) values('aa176003-0000-4000-8000-000000000003',repeat('c',32),1);
create temporary table durable_locations as select id,to_jsonb(l) value from public.reporting_locations l where id::text like 'aa176002-%';
create temporary table durable_facts as select id,to_jsonb(f) value from public.machine_sales_facts f where source_row_hash in ('report-name-one','report-name-two');
create temporary table durable_qr as select to_jsonb(qr) value from public.refund_machine_qr_codes qr where reporting_machine_id='aa176003-0000-4000-8000-000000000003';
insert into public.payout_policies(id,account_id,name) values('aa176006-0000-4000-8000-000000000001','aa176001-0000-4000-8000-000000000001','Name hours monthly policy');
insert into public.operator_payout_profiles(id,account_id,user_id,display_name,worker_type,payout_policy_id) values('aa176007-0000-4000-8000-000000000001','aa176001-0000-4000-8000-000000000001','aa176000-0000-4000-8000-000000000002','Name fixture technician','contractor_1099','aa176006-0000-4000-8000-000000000001');
insert into public.operator_machine_assignments(operator_profile_id,account_id,reporting_machine_id,effective_start_date,grant_reason) values('aa176007-0000-4000-8000-000000000001','aa176001-0000-4000-8000-000000000001','aa176003-0000-4000-8000-000000000001','2020-01-01','Synthetic name labor assignment');
insert into public.payout_periods(id,account_id,payout_policy_id,period_start_date,period_end_date,submission_due_date,lock_date,target_payout_date) values('aa176008-0000-4000-8000-000000000001','aa176001-0000-4000-8000-000000000001','aa176006-0000-4000-8000-000000000001','2026-02-01','2026-02-28','2026-03-02','2026-03-03','2026-03-05');
insert into public.compensation_rules(account_id,operator_profile_id,shift_rate_cents,effective_start_date,status) values('aa176001-0000-4000-8000-000000000001','aa176007-0000-4000-8000-000000000001',2000,'2020-01-01','active');
insert into public.time_entries(id,account_id,operator_profile_id,reporting_machine_id,reporting_location_id,payout_policy_id,payout_period_id,work_date,start_time,end_time,actual_start_at,actual_end_at,raw_duration_minutes,rounded_paid_minutes,paid_shift_count,status) values('aa176009-0000-4000-8000-000000000001','aa176001-0000-4000-8000-000000000001','aa176007-0000-4000-8000-000000000001','aa176003-0000-4000-8000-000000000001','aa176002-0000-4000-8000-000000000001','aa176006-0000-4000-8000-000000000001','aa176008-0000-4000-8000-000000000001','2026-02-01','08:00','09:01','2026-02-01T13:00Z','2026-02-01T14:01Z',61,120,2,'submitted');
create temporary table durable_time as select to_jsonb(e) value from public.time_entries e where id='aa176009-0000-4000-8000-000000000001';
set local session_replication_role=origin;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','aa176000-0000-4000-8000-000000000001',true);
-- Add current refund/alert scope without customer automation side effects.
set local session_replication_role=replica;
insert into public.reporting_machine_refund_managers(reporting_machine_id,manager_user_id,manager_email,status)
 values('aa176003-0000-4000-8000-000000000001','aa176000-0000-4000-8000-000000000002','display-reader@example.invalid','active');
set local session_replication_role=origin;
create temporary table durable_refunds as select to_jsonb(c) value from public.refund_cases c where id='aa176005-0000-4000-8000-000000000001';
create temporary table public_membership as select private.refund_selection_membership() value;
select is(public.operator_time_entry_payload('aa176009-0000-4000-8000-000000000001')->>'machineLabel','Customer machine name','Time entry final payload uses effective legacy Machine name');
select is(public.operator_time_entry_payload('aa176009-0000-4000-8000-000000000001')->>'locationName','Shared durable venue','Time entry factual venue is preserved');
select is(public.operator_time_entry_payload('aa176009-0000-4000-8000-000000000001')->>'rawDurationMinutes','61','Time duration remains actual 61 minutes');
select ok(jsonb_path_exists(public.get_my_time_review_context('2026-02-01'),'$.**.machineLabel ? (@ == "Customer machine name")'),'Review final nested JSON resolves full machine by scoped ID');
select ok(jsonb_path_exists(public.get_timekeeping_setup_context(),'$.**.machineLabel ? (@ == "Customer machine name")'),'Timekeeping setup uses effective Machine name');
select is((select x->>'label' from jsonb_array_elements(public.admin_list_access_people()->'machines') x where x->>'id'='aa176003-0000-4000-8000-000000000001'),'Customer machine name','People machine selector uses effective Machine name');
select set_config('request.jwt.claim.sub','aa176000-0000-4000-8000-000000000002',true);
select ok(jsonb_path_exists(public.get_my_operator_timekeeping_context('2026-02-01'),'$.**.machineLabel ? (@ == "Customer machine name")'),'Assigned technician context uses effective Machine name');
select ok(jsonb_path_exists(public.get_my_operator_payout_context(),'$.**.machineLabel ? (@ == "Customer machine name")'),'Current payout assignment context uses effective Machine name');
select is((select machine_label from private.email_alert_machine_scope('aa176000-0000-4000-8000-000000000002') where machine_id='aa176003-0000-4000-8000-000000000001'),'Customer machine name','Alert scope uses effective Machine name');
select is((select x->>'machineLabel' from jsonb_array_elements(public.get_refund_request_access()->'machines') x where x->>'machineId'='aa176003-0000-4000-8000-000000000001'),'Customer machine name','Refund access uses effective Machine name');
select is(public.get_refund_request('aa176005-0000-4000-8000-000000000001')->>'machineLabel','Customer machine name','Refund detail uses effective Machine name');
select is(public.get_refund_request('aa176005-0000-4000-8000-000000000001')->>'timezone','America/New_York','Refund factual timezone remains unchanged');
create temporary table entry_before as select public.operator_time_entry_payload('aa176009-0000-4000-8000-000000000001')-'machineLabel' value;
select set_config('request.jwt.claim.sub','aa176000-0000-4000-8000-000000000001',true);
select lives_ok($$select public.admin_set_machine_display_name('aa176003-0000-4000-8000-000000000001','Canonical final name','Customer machine name')$$,'Deliberate canonical edit remains supported');
select is(public.operator_time_entry_payload('aa176009-0000-4000-8000-000000000001')->>'machineLabel','Canonical final name','Explicit canonical name takes precedence');
select is((select value from entry_before),public.operator_time_entry_payload('aa176009-0000-4000-8000-000000000001')-'machineLabel','Only display label changes in historical entry payload');
select is((select value from durable_time),(select to_jsonb(e) from public.time_entries e where id='aa176009-0000-4000-8000-000000000001'),'Historical time row is byte-equivalent');
select is((select value from durable_refunds),(select to_jsonb(c) from public.refund_cases c where id='aa176005-0000-4000-8000-000000000001'),'Historical refund row is byte-equivalent');
select is((select value from public_membership),private.refund_selection_membership(),'Customer eligibility and selection identities are unchanged');
select ok(not exists(select 1 from durable_locations b join public.reporting_locations l using(id) where b.value is distinct from to_jsonb(l)),'Shared reporting venues/timezones are unchanged');
select ok(not exists(select 1 from durable_facts b join public.machine_sales_facts f using(id) where b.value is distinct from to_jsonb(f)),'Sales facts and amounts are unchanged');
select is((select value from durable_qr),(select to_jsonb(q) from public.refund_machine_qr_codes q where reporting_machine_id='aa176003-0000-4000-8000-000000000003'),'QR identity row is unchanged');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000099',true);
select is(public.operator_time_entry_payload('aa176009-0000-4000-8000-000000000001'),null::jsonb,'Unrelated actor cannot read time payload');
select is(public.get_refund_request_access()->>'hasAccess','false','Unrelated actor receives no refund scope');
select is(jsonb_array_length(private.email_alert_context('00000000-0000-4000-8000-000000000099')->'machines'),0,'Unrelated actor receives no alert machines');
select ok(not has_function_privilege('anon','private.reporting_machine_display_name(public.reporting_machines)','execute'),'Private name helper remains denied to anon');
select ok(not has_function_privilege('authenticated','private.reporting_machine_display_name(public.reporting_machines)','execute'),'Private name helper remains denied to direct authenticated callers');
select * from finish();
rollback;
