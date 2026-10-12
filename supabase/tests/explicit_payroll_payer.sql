begin;
set local timezone = 'America/Los_Angeles';
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select set_config('request.jwt.claim.role','authenticated',true);
select no_plan();

-- Synthetic IDs only. Fixture seeding bypasses triggers; every operation under
-- test below runs with origin triggers and the real authenticated RPC authority.
create function pg_temp.fixture_id(n integer) returns uuid language sql immutable as $$
  select ('e1867000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid;
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
values(pg_temp.fixture_id(41),pg_temp.fixture_id(11),'Synthetic target monthly policy','monthly','calendar','calendar_month',4,4,5,'round_up_60_minutes','no_review_required');
create temporary table original_inputs on commit drop as select
  (select to_jsonb(t)-'account_id'-'payout_policy_id'-'payout_period_id'-'updated_at'-'updated_by' from public.time_entries t where id=pg_temp.fixture_id(90)) time_input,
  (select to_jsonb(m) from public.reporting_machines m where id=pg_temp.fixture_id(30)) machine,
  (select jsonb_agg(to_jsonb(r)-'account_id'-'updated_at' order by r.id) from public.compensation_rules r where operator_profile_id=pg_temp.fixture_id(50)) rates;

select lives_ok(format('select private.realign_operator_payroll_profile(%L,%L)',pg_temp.fixture_id(50),pg_temp.fixture_id(11)),
  'Payer correction runs with all normal time triggers');
select is((select account_id from public.operator_payout_profiles where id=pg_temp.fixture_id(50)),pg_temp.fixture_id(11),'Profile uses explicit payer');
select is((select account_id from public.time_entries where id=pg_temp.fixture_id(90)),pg_temp.fixture_id(11),'Time follows corrected payroll scope');
select is((select to_jsonb(t)-'account_id'-'payout_policy_id'-'payout_period_id'-'updated_at'-'updated_by' from public.time_entries t where id=pg_temp.fixture_id(90)),
  (select time_input from original_inputs),'Actual time and paid shifts preserved');
select is((select to_jsonb(m) from public.reporting_machines m where id=pg_temp.fixture_id(30)),(select machine from original_inputs),'Machine financial ownership preserved');
select is((select jsonb_agg(to_jsonb(r)-'account_id'-'updated_at' order by r.id) from public.compensation_rules r where operator_profile_id=pg_temp.fixture_id(50)),
  (select rates from original_inputs),'Rates and original rule IDs preserved');
select ok(private.reporting_company_payroll_machine_matches(pg_temp.fixture_id(11),pg_temp.fixture_id(30),pg_temp.fixture_id(50)),'Explicit cross-company payroll Machine scope works');
select ok(not private.reporting_company_payroll_machine_matches(pg_temp.fixture_id(14),pg_temp.fixture_id(30),pg_temp.fixture_id(50)),'No unrelated-company scope granted');
select ok(not private.reporting_company_payroll_machine_matches(pg_temp.fixture_id(11),pg_temp.fixture_id(30),pg_temp.fixture_id(51)),'No unrelated-worker scope granted');
select is(private.realign_operator_payroll_profile(pg_temp.fixture_id(50),pg_temp.fixture_id(11)),pg_temp.fixture_id(50),'Replayed correction is idempotent');
select is((select count(*)::integer from private.payroll_profile_corrections where source_profile_id=pg_temp.fixture_id(50)),1,'One correction audit record');
select is((select count(*)::integer from public.time_entries where operator_profile_id=pg_temp.fixture_id(50)),1,'No duplicated time');
select ok(exists(select 1 from public.payout_period_machine_revenue_snapshots s join public.payout_periods p on p.id=s.payout_period_id
  where s.reporting_machine_id=pg_temp.fixture_id(30) and p.account_id=pg_temp.fixture_id(11) and s.source_sales_row_count=1),'Monthly source evidence follows new payroll scope');

-- Consecutive duplicate arrangements consolidate; identical rates remain once.
insert into public.operator_payout_profiles(id,account_id,user_id,display_name,payout_policy_id)
values(pg_temp.fixture_id(52),pg_temp.fixture_id(11),pg_temp.fixture_id(2),'Synthetic consolidated Technician',pg_temp.fixture_id(41));
insert into public.operator_machine_assignments(id,operator_profile_id,account_id,reporting_machine_id,effective_start_date,effective_end_date) values
  (pg_temp.fixture_id(61),pg_temp.fixture_id(51),pg_temp.fixture_id(10),pg_temp.fixture_id(31),'2025-02-01',null),
  (pg_temp.fixture_id(62),pg_temp.fixture_id(52),pg_temp.fixture_id(11),pg_temp.fixture_id(31),'2025-01-01','2025-01-31');
insert into public.compensation_rules(id,account_id,operator_profile_id,reporting_machine_id,shift_rate_cents,effective_start_date) values
  (pg_temp.fixture_id(72),pg_temp.fixture_id(10),pg_temp.fixture_id(51),pg_temp.fixture_id(31),2500,'2025-01-01'),
  (pg_temp.fixture_id(73),pg_temp.fixture_id(11),pg_temp.fixture_id(52),pg_temp.fixture_id(31),2500,'2025-01-01');
select is(private.realign_operator_payroll_profile(pg_temp.fixture_id(51),pg_temp.fixture_id(11)),pg_temp.fixture_id(52),'Existing target profile retained');
select is((select status from public.operator_payout_profiles where id=pg_temp.fixture_id(51)),'inactive','Duplicate historical profile retained inactive');
select is((select count(*)::integer from public.operator_machine_assignments where operator_profile_id=pg_temp.fixture_id(52) and status='active'),1,'Only one current assignment');
select is((select effective_start_date from public.operator_machine_assignments where id=pg_temp.fixture_id(62)),'2025-01-01'::date,'Earliest assignment date preserved');
select ok((select effective_end_date is null from public.operator_machine_assignments where id=pg_temp.fixture_id(62)),'Consecutive assignment remains ongoing');
select is((select count(*)::integer from public.compensation_rules where operator_profile_id in (pg_temp.fixture_id(51),pg_temp.fixture_id(52)) and status='active'),1,'Identical rates do not double count');
select ok(exists(select 1 from public.compensation_rules where id=pg_temp.fixture_id(72) and status='inactive'),'Prior duplicate rate remains auditable');
select ok(not has_function_privilege(actor,'private.realign_operator_payroll_profile(uuid,uuid)','execute'),actor||' cannot correct production payer directly')
  from unnest(array['anon','authenticated','service_role']) actor;
select ok(not has_table_privilege(actor,'private.payroll_machine_payer_scopes','select,insert,update,delete'),actor||' cannot provision private payer scopes')
  from unnest(array['anon','authenticated','service_role']) actor;
select ok(not has_function_privilege('anon','public.admin_setup_timekeeping_for_payer_with_contact(text,uuid,text,text,text,text,text,text,date,jsonb)','execute'),'Anonymous setup denied');
select ok(has_function_privilege('authenticated','public.admin_setup_timekeeping_for_payer_with_contact(text,uuid,text,text,text,text,text,text,date,jsonb)','execute'),'Authenticated setup keeps explicit authority checks');
select * from finish();
rollback;
