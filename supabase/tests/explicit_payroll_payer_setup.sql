begin;
set local timezone = 'America/Los_Angeles';
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select set_config('request.jwt.claim.role','authenticated',true);
select no_plan();

-- Synthetic IDs only. Fixture seeding bypasses triggers; every operation under
-- test below runs with origin triggers and the real authenticated RPC authority.
create function pg_temp.fixture_id(n integer) returns uuid language sql immutable as $$
  select ('e1867100-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid;
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

insert into public.payout_policies(id,account_id,name,frequency,period_anchor_type,monthly_period_type,
  submission_due_offset_days,lock_offset_days,target_payout_offset_days,rounding_rule,review_model)
values(pg_temp.fixture_id(41),pg_temp.fixture_id(11),'Synthetic explicit payer policy','monthly','calendar','calendar_month',4,4,5,'round_up_60_minutes','no_review_required');
update public.customer_accounts set default_payout_policy_id=pg_temp.fixture_id(41) where id=pg_temp.fixture_id(11);
select set_config('request.jwt.claim.sub',pg_temp.fixture_id(4)::text,true);
select is(pg_temp.capture_error(format('select public.admin_setup_timekeeping_for_payer_with_contact(%L,%L,%L,%L,null,null,null,null,%L::date,%L::jsonb)',
  'payroll-company-3@example.test',pg_temp.fixture_id(11),'Synthetic new worker','contractor_1099','2025-01-01',
  jsonb_build_array(jsonb_build_object('machineId',pg_temp.fixture_id(30),'shiftRateCents',2500,'commissionBasisPoints',0,'commissionEffectiveStartDate','2025-01-01')))),
  'Payroll payer authority required','Source-company manager cannot select unauthorized payer');
insert into public.admin_roles(user_id,role,active) values(pg_temp.fixture_id(4),'super_admin',true);
select lives_ok(format('select public.admin_setup_timekeeping_for_payer_with_contact(%L,%L,%L,%L,null,null,null,null,%L::date,%L::jsonb)',
  'payroll-company-3@example.test',pg_temp.fixture_id(11),'Synthetic new worker','contractor_1099','2025-01-01',
  jsonb_build_array(
    jsonb_build_object('machineId',pg_temp.fixture_id(30),'shiftRateCents',2500,'commissionBasisPoints',0,'commissionEffectiveStartDate','2025-01-01'),
    jsonb_build_object('machineId',pg_temp.fixture_id(31),'shiftRateCents',3000,'commissionBasisPoints',500,'commissionEffectiveStartDate','2025-01-01'))),
  'One authorized setup chooses payroll payer across Machine companies');
select is((select count(*)::integer from public.operator_payout_profiles where user_id=pg_temp.fixture_id(3)),1,'One payer profile rather than company-derived duplicates');
select is((select account_id from public.operator_payout_profiles where user_id=pg_temp.fixture_id(3)),pg_temp.fixture_id(11),'Explicit payer retained');
select is((select count(*)::integer from public.operator_machine_assignments a join public.operator_payout_profiles p on p.id=a.operator_profile_id where p.user_id=pg_temp.fixture_id(3) and a.status='active'),2,'Both selected Machines in one payroll arrangement');
select is((select account_id from public.reporting_machines where id=pg_temp.fixture_id(30)),pg_temp.fixture_id(10),'Source Machine ownership unchanged');
select set_config('request.jwt.claim.sub',pg_temp.fixture_id(3)::text,true);
select lives_ok(format('select public.save_operator_time_entry(null,%L,%L,%L::timestamptz,%L::timestamptz,null)',
  (select id from public.operator_payout_profiles where user_id=pg_temp.fixture_id(3)),pg_temp.fixture_id(30),pg_temp.work_at(15),pg_temp.work_at(15)+interval '20 minutes'),
  'Technician can save own time against explicitly assigned cross-company Machine');
select is(jsonb_array_length(public.get_my_operator_timekeeping_context(current_date-1)->'profiles'->0->'assignedMachines'),2,'Technician sees both assigned Machines');
select set_config('request.jwt.claim.sub',pg_temp.fixture_id(5)::text,true);
select is(jsonb_array_length(public.get_my_operator_timekeeping_context(current_date-1)->'profiles'),0,'Unrelated Technician sees no new arrangement');
select * from finish();
rollback;
