begin;
set local timezone = 'America/Los_Angeles';
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select set_config('request.jwt.claim.role','authenticated',true);
select no_plan();

-- Synthetic IDs only. Fixture seeding bypasses triggers; every operation under
-- test below runs with origin triggers and the real authenticated RPC authority.
create function pg_temp.fixture_id(n integer) returns uuid language sql immutable as $$
  select ('e1216000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid;
$$;
create function pg_temp.capture_error(statement text) returns text language plpgsql as $$
begin execute statement; return null; exception when others then return sqlerrm; end;
$$;
create function pg_temp.work_at(hour integer) returns timestamptz language sql stable as $$
  select ((current_date-1)::timestamp + make_interval(hours=>hour)) at time zone 'America/Los_Angeles';
$$;
create function pg_temp.save_sql(profile_number integer,machine_number integer,hour integer)
returns text language sql stable as $$
  select format('select public.save_operator_time_entry(null,%L,%L,%L::timestamptz,%L::timestamptz,null)',
    pg_temp.fixture_id(profile_number),pg_temp.fixture_id(machine_number),pg_temp.work_at(hour),pg_temp.work_at(hour)+interval '20 minutes');
$$;
create function pg_temp.assignment_sql(assignment_number integer,profile_number integer,machine_number integer,end_date date default null)
returns text language sql stable as $$
  select format('select public.admin_upsert_operator_machine_assignment(%L,%L,%L,%L::date,%L::date)',
    case when assignment_number is null then null else pg_temp.fixture_id(assignment_number) end,
    pg_temp.fixture_id(profile_number),pg_temp.fixture_id(machine_number),'2020-01-01',end_date);
$$;

set local session_replication_role = replica;
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select '00000000-0000-0000-0000-000000000000',pg_temp.fixture_id(n),'authenticated','authenticated',
  'payroll-company-'||n||'@example.test','',now(),'{}'::jsonb,'{}'::jsonb,now(),now()
from generate_series(1,5) n;
insert into public.customer_accounts(id,name,account_type) values
  (pg_temp.fixture_id(10),'Synthetic original payroll company','customer'),
  (pg_temp.fixture_id(11),'Synthetic reporting destination company','customer'),
  (pg_temp.fixture_id(14),'Synthetic unrelated reporting target','customer');
insert into public.customer_account_memberships(id,account_id,user_id,email,role,active) values
  (pg_temp.fixture_id(12),pg_temp.fixture_id(10),pg_temp.fixture_id(4),'payroll-company-4@example.test','owner',true);
insert into public.reporting_locations(id,account_id,name,timezone) values
  (pg_temp.fixture_id(20),pg_temp.fixture_id(10),'Synthetic retained venue','America/Los_Angeles'),
  (pg_temp.fixture_id(21),pg_temp.fixture_id(11),'Synthetic unrelated venue','America/Los_Angeles');
insert into public.reporting_machines(id,account_id,location_id,machine_label) values
  (pg_temp.fixture_id(30),pg_temp.fixture_id(10),pg_temp.fixture_id(20),'Synthetic retained machine'),
  (pg_temp.fixture_id(31),pg_temp.fixture_id(11),pg_temp.fixture_id(21),'Synthetic unrelated destination machine');
insert into public.reporting_machine_tax_rates(id,machine_id,tax_rate_percent,effective_start_date,status)
values(pg_temp.fixture_id(32),pg_temp.fixture_id(30),0,'2020-01-01','active');
\ir fixtures/reporting_source_tax.inc

insert into public.reporting_machine_refund_managers(id,reporting_machine_id,manager_user_id,manager_email,grant_reason)
values
  (pg_temp.fixture_id(33),pg_temp.fixture_id(30),pg_temp.fixture_id(3),'payroll-company-3@example.test','Synthetic payroll manager'),
  -- A user can have one active company membership. Preserve payroll authority
  -- through that original membership and grant only the moved machine explicitly.
  (pg_temp.fixture_id(13),pg_temp.fixture_id(30),pg_temp.fixture_id(4),'payroll-company-4@example.test','Synthetic retained machine authority');
insert into public.payout_policies(id,account_id,name,frequency,period_anchor_type,monthly_period_type,submission_due_offset_days,lock_offset_days,target_payout_offset_days,rounding_rule,review_model)
values(pg_temp.fixture_id(40),pg_temp.fixture_id(10),'Synthetic retained policy','monthly','calendar','calendar_month',4,4,5,'round_up_60_minutes','no_review_required');
update public.customer_accounts set default_payout_policy_id=pg_temp.fixture_id(40) where id=pg_temp.fixture_id(10);
insert into public.operator_payout_profiles(id,account_id,user_id,display_name,worker_type,payout_policy_id) values
  (pg_temp.fixture_id(50),pg_temp.fixture_id(10),pg_temp.fixture_id(1),'Synthetic retained Technician','contractor_1099',pg_temp.fixture_id(40)),
  (pg_temp.fixture_id(51),pg_temp.fixture_id(10),pg_temp.fixture_id(2),'Synthetic new Technician','contractor_1099',pg_temp.fixture_id(40));
insert into public.operator_machine_assignments(id,operator_profile_id,account_id,reporting_machine_id,effective_start_date,grant_reason)
values(pg_temp.fixture_id(60),pg_temp.fixture_id(50),pg_temp.fixture_id(10),pg_temp.fixture_id(30),'2020-01-01','Synthetic original assignment');
insert into public.compensation_rules(id,account_id,operator_profile_id,reporting_machine_id,shift_rate_cents,commission_basis_points,effective_start_date,status) values
  (pg_temp.fixture_id(70),pg_temp.fixture_id(10),pg_temp.fixture_id(50),null,2500,null,'2020-01-01','active'),
  (pg_temp.fixture_id(71),pg_temp.fixture_id(10),pg_temp.fixture_id(50),pg_temp.fixture_id(30),null,500,'2020-01-01','active');
insert into public.payout_periods(id,account_id,payout_policy_id,period_start_date,period_end_date,submission_due_date,lock_date,target_payout_date,status)
values(pg_temp.fixture_id(80),pg_temp.fixture_id(10),pg_temp.fixture_id(40),'2025-01-01','2025-01-31','2025-02-04','2025-02-04','2025-02-05','locked');
insert into public.time_entries(id,account_id,operator_profile_id,reporting_machine_id,reporting_location_id,payout_policy_id,payout_period_id,work_date,start_time,end_time,actual_start_at,actual_end_at,raw_duration_minutes,rounded_paid_minutes,paid_shift_count,status)
values(pg_temp.fixture_id(90),pg_temp.fixture_id(10),pg_temp.fixture_id(50),pg_temp.fixture_id(30),pg_temp.fixture_id(20),pg_temp.fixture_id(40),pg_temp.fixture_id(80),'2025-01-15','08:00','08:20','2025-01-15 16:00+00','2025-01-15 16:20+00',20,60,1,'submitted');
insert into public.machine_sales_facts(id,reporting_machine_id,reporting_location_id,sale_date,payment_method,net_sales_cents,transaction_count,source,source_row_hash)
values(pg_temp.fixture_id(91),pg_temp.fixture_id(30),pg_temp.fixture_id(20),'2025-01-15','credit',10000,10,'sample_seed','company-payroll-1730-sale');
insert into public.payout_period_machine_revenue_snapshots(id,account_id,payout_period_id,reporting_machine_id,reporting_location_id,period_start_date,period_end_date,gross_sales_cents,net_revenue_cents,eligible_commission_revenue_cents,transaction_count,source_sales_row_count,status)
values(pg_temp.fixture_id(92),pg_temp.fixture_id(10),pg_temp.fixture_id(80),pg_temp.fixture_id(30),pg_temp.fixture_id(20),'2025-01-01','2025-01-31',10000,10000,10000,10,1,'source_generated');
set local session_replication_role = origin;

select set_config('request.jwt.claim.role','service_role',true);
select public.service_enqueue_automatic_pay_stubs('2025-02-05 07:59:59+00');
select is((select count(*)::integer from public.pay_stub_generation_requests where operator_profile_id=pg_temp.fixture_id(50)),0,'No automatic generation before Pacific cutoff');
select public.service_enqueue_automatic_pay_stubs('2025-02-05 08:00:00+00');
select is((select count(*)::integer from public.pay_stub_generation_requests where operator_profile_id=pg_temp.fixture_id(50)),1,'First generation enqueued exactly at winter cutoff');
select public.service_enqueue_automatic_pay_stubs('2025-02-05 08:00:00+00');
select is((select count(*)::integer from public.pay_stub_generation_requests where operator_profile_id=pg_temp.fixture_id(50)),1,'Scheduler replay does not duplicate request');
select is(public.operator_time_entry_cutoff_at('2026-09-30'),'2026-10-05 07:00:00+00'::timestamptz,'Summer cutoff uses Pacific daylight time');
select is(public.operator_time_entry_cutoff_at('2026-10-31'),'2026-11-05 08:00:00+00'::timestamptz,'DST transition cutoff uses Pacific standard time');

insert into public.operator_recurring_compensation_items(account_id,operator_profile_id,item_type,description,amount_cents,effective_start_date)
values(pg_temp.fixture_id(10),pg_temp.fixture_id(51),'supply_credit','Synthetic recurring credit',1000,'2025-01-01');
select public.service_enqueue_automatic_pay_stubs('2025-02-05 08:00:00+00');
select is((select count(*)::integer from public.pay_stub_generation_requests where operator_profile_id=pg_temp.fixture_id(51)),1,'Payable credit-only worker needs no time entry');
select is(jsonb_array_length(public.service_claim_pay_stub_generation_requests(10)),1,'Worker reserves only one request, even when asked for a batch');
select is((select count(*)::integer from public.pay_stub_generation_requests where status='queued' and operator_profile_id in (pg_temp.fixture_id(50),pg_temp.fixture_id(51))),1,'Other contractor stays queued instead of abandoned processing');
insert into public.payout_periods(id,account_id,payout_policy_id,period_start_date,period_end_date,submission_due_date,lock_date,target_payout_date,status)
values(pg_temp.fixture_id(81),pg_temp.fixture_id(10),pg_temp.fixture_id(40),'2025-02-01','2025-02-28','2025-03-04','2025-03-04','2025-03-05','locked');
insert into public.pay_stub_generation_requests(id,account_id,operator_profile_id,payout_period_id,trigger_kind)
values(pg_temp.fixture_id(93),pg_temp.fixture_id(10),pg_temp.fixture_id(50),pg_temp.fixture_id(81),'manager_regeneration');
select is(public.service_claim_pay_stub_generation_request(pg_temp.fixture_id(93))->>'status','queued','Interactive regeneration waits for an in-flight earlier statement');
select is((select status from public.pay_stub_generation_requests where id=pg_temp.fixture_id(93)),'queued','Deferred regeneration remains durably queued');
select is(public.service_claim_pay_stub_generation_request((select id from public.pay_stub_generation_requests where status='processing' and operator_profile_id=pg_temp.fixture_id(50)))->>'status','processing','Replayed interactive request reports existing processing state');
delete from public.pay_stub_generation_requests where id=pg_temp.fixture_id(93);
select public.service_fail_pay_stub((select id from public.pay_stub_generation_requests where status='processing' and operator_profile_id in (pg_temp.fixture_id(50),pg_temp.fixture_id(51))),'Synthetic temporary upload failure');
select ok((select retry_after>now() from public.pay_stub_generation_requests where status='failed' and operator_profile_id in (pg_temp.fixture_id(50),pg_temp.fixture_id(51))),'Transient failure receives future retry time');
select public.service_enqueue_automatic_pay_stubs(now());
select is((select count(*)::integer from public.pay_stub_generation_requests where status='failed' and operator_profile_id in (pg_temp.fixture_id(50),pg_temp.fixture_id(51))),1,'Scheduler respects retry backoff');
update public.pay_stub_generation_requests set retry_after=now()-interval '1 second' where status='failed' and operator_profile_id in (pg_temp.fixture_id(50),pg_temp.fixture_id(51));
select public.service_enqueue_automatic_pay_stubs(now());
select is((select count(*)::integer from public.pay_stub_generation_requests where status='queued' and payout_period_id=pg_temp.fixture_id(80)),2,'Due transient failure automatically returns to queue');
select public.service_claim_pay_stub_generation_requests(1);
update public.pay_stub_generation_requests set started_at=now()-interval '11 minutes' where status='processing' and payout_period_id=pg_temp.fixture_id(80);
select public.service_enqueue_automatic_pay_stubs(now());
select is((select count(*)::integer from public.pay_stub_generation_requests where status='processing' and payout_period_id=pg_temp.fixture_id(80)),0,'Expired processing lease is recoverable');
select ok(exists(select 1 from public.pay_stub_generation_requests where error_message='Worker interrupted; retrying automatically' and payout_period_id=pg_temp.fixture_id(80)),'Interrupted attempt retains audit evidence');

update public.pay_stub_generation_requests set status='blocked',blocker_details='[{"code":"missing_machine_tax_rate"}]' where status='queued' and payout_period_id=pg_temp.fixture_id(80);
select ok((select bool_and(retry_after>=now()+interval '14 minutes') from public.pay_stub_generation_requests where status='blocked' and payout_period_id=pg_temp.fixture_id(80)),'Calculation blockers use safe automatic retry timing');
select public.service_enqueue_automatic_pay_stubs(now());
select is((select count(*)::integer from public.pay_stub_generation_requests where payout_period_id=pg_temp.fixture_id(80)),2,'Repeated failed/blocked enqueue retains same request history');
select ok(not public.service_authorize_pay_stub_scheduler(repeat('x',64)),'Unknown scheduler secret rejected');
select ok(not has_function_privilege(actor,'public.service_enqueue_automatic_pay_stubs(timestamptz)','execute'),actor||' cannot enqueue automatically') from unnest(array['anon','authenticated']) actor;
select ok(not has_function_privilege(actor,'public.service_authorize_pay_stub_scheduler(text)','execute'),actor||' cannot inspect scheduler authorization') from unnest(array['anon','authenticated']) actor;
select ok(not has_function_privilege(actor,'private.configure_pay_stub_scheduler(text,boolean)','execute'),actor||' cannot configure scheduler') from unnest(array['anon','authenticated','service_role']) actor;
select * from finish();
rollback;
