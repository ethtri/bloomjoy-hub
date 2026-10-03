begin;
set local timezone = 'America/Los_Angeles';
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select set_config('request.jwt.claim.role','authenticated',true);
select no_plan();

-- Synthetic IDs only. Fixture seeding bypasses triggers; every operation under
-- test below runs with origin triggers and the real authenticated RPC authority.
create function pg_temp.fixture_id(n integer) returns uuid language sql immutable as $$
  select ('d1730000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid;
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

create temporary table before_correction on commit drop as select
  to_jsonb(profile) as profile,to_jsonb(assignment) as assignment,to_jsonb(policy) as policy,
  (select jsonb_agg(to_jsonb(rate) order by rate.id) from public.compensation_rules rate where rate.operator_profile_id=profile.id) as rates,
  (select to_jsonb(entry) from public.time_entries entry where entry.id=pg_temp.fixture_id(90)) as entry,
  (select to_jsonb(snapshot) from public.payout_period_machine_revenue_snapshots snapshot where snapshot.id=pg_temp.fixture_id(92)) as snapshot,
  private.calculate_technician_pay_report(profile.account_id,profile.id,'2025-01-01','2025-01-31') as report,
  public.operator_revenue_snapshot_source_values(pg_temp.fixture_id(80),pg_temp.fixture_id(30)) as source_values
from public.operator_payout_profiles profile
join public.operator_machine_assignments assignment on assignment.operator_profile_id=profile.id
join public.payout_policies policy on policy.id=profile.payout_policy_id
where profile.id=pg_temp.fixture_id(50);

-- Represent the exact retained correction tuple, independently of production IDs.
insert into private.reporting_company_payroll_compatibility(operator_assignment_id,operator_profile_id,reporting_machine_id,payroll_account_id,reporting_account_id,correction_issue)
values(pg_temp.fixture_id(60),pg_temp.fixture_id(50),pg_temp.fixture_id(30),pg_temp.fixture_id(10),pg_temp.fixture_id(11),1730);
update public.reporting_locations set account_id=pg_temp.fixture_id(11) where id=pg_temp.fixture_id(20);
update public.reporting_machines set account_id=pg_temp.fixture_id(11) where id=pg_temp.fixture_id(30);

select ok(public.can_manage_operator_payout_account(pg_temp.fixture_id(4),pg_temp.fixture_id(10)),'fixture owner retains original payroll company authority');
select ok(public.can_manage_operator_payout_machine(pg_temp.fixture_id(4),pg_temp.fixture_id(30)),'fixture owner retains explicit moved-machine authority');
select ok(not public.can_manage_operator_payout_machine(pg_temp.fixture_id(4),pg_temp.fixture_id(31)),'fixture owner receives no authority over unrelated destination machines');
select ok((select relrowsecurity from pg_class where oid='private.reporting_company_payroll_compatibility'::regclass),'retained mappings have RLS');
select ok(not has_table_privilege(actor,'private.reporting_company_payroll_compatibility','select,insert,update,delete'),actor||' cannot inspect or create retained mappings') from unnest(array['anon','authenticated','service_role']) actor;
select ok(not has_function_privilege(actor,'private.reporting_company_payroll_machine_matches(uuid,uuid,uuid)','execute'),actor||' cannot directly invoke the private compatibility helper') from unnest(array['anon','authenticated','service_role']) actor;
select ok(private.reporting_company_payroll_machine_matches(pg_temp.fixture_id(10),pg_temp.fixture_id(30),pg_temp.fixture_id(50)),'the exact original profile/machine/payroll tuple remains compatible');
select ok(private.reporting_company_payroll_machine_matches(pg_temp.fixture_id(10),pg_temp.fixture_id(30)),'account-wide historical snapshots admit the retained tuple');
select ok(not private.reporting_company_payroll_machine_matches(pg_temp.fixture_id(10),pg_temp.fixture_id(30),pg_temp.fixture_id(51)),'another profile does not inherit the retained tuple');
select ok(not private.reporting_company_payroll_machine_matches(pg_temp.fixture_id(10),pg_temp.fixture_id(31),pg_temp.fixture_id(50)),'unrelated destination machine does not inherit payroll compatibility');
select ok(private.reporting_company_payroll_machine_matches(pg_temp.fixture_id(11),pg_temp.fixture_id(31),pg_temp.fixture_id(51)),'canonical current-company matching remains supported');
select is((select to_jsonb(profile) from public.operator_payout_profiles profile where id=pg_temp.fixture_id(50)),(select profile from before_correction),'correction preserves the complete original payroll profile');
select is((select to_jsonb(assignment) from public.operator_machine_assignments assignment where id=pg_temp.fixture_id(60)),(select assignment from before_correction),'correction preserves the exact assignment ID, window and grant');
select is((select to_jsonb(policy) from public.payout_policies policy where id=pg_temp.fixture_id(40)),(select policy from before_correction),'correction preserves the payroll policy and rounding');
select is((select jsonb_agg(to_jsonb(rate) order by rate.id) from public.compensation_rules rate where operator_profile_id=pg_temp.fixture_id(50)),(select rates from before_correction),'correction preserves all effective rates');
select is((select to_jsonb(entry) from public.time_entries entry where id=pg_temp.fixture_id(90)),(select entry from before_correction),'correction does not rewrite historical time');
select is((select to_jsonb(snapshot) from public.payout_period_machine_revenue_snapshots snapshot where id=pg_temp.fixture_id(92)),(select snapshot from before_correction),'correction does not rewrite historical snapshots');
select is(private.calculate_technician_pay_report(pg_temp.fixture_id(10),pg_temp.fixture_id(50),'2025-01-01','2025-01-31'),(select report from before_correction),'historical recalculation retains the complete prior report');
select is(public.operator_revenue_snapshot_source_values(pg_temp.fixture_id(80),pg_temp.fixture_id(30)),(select source_values from before_correction),'historical snapshot source values retain their prior revenue basis');
select is(public.operator_compensation_rate_at(pg_temp.fixture_id(10),pg_temp.fixture_id(50),pg_temp.fixture_id(30),current_date,'shift')->>'shiftRateCents','2500','retained Technician resolves the original shift rate');
select is(public.operator_compensation_rate_at(pg_temp.fixture_id(10),pg_temp.fixture_id(50),pg_temp.fixture_id(30),current_date,'commission')->>'commissionBasisPoints','500','retained Technician resolves the original machine commission');

set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.fixture_id(1)::text,true);
select is(pg_temp.capture_error(pg_temp.save_sql(50,30,8)),null,'retained Technician can save fresh completed work');
select is(pg_temp.capture_error(format('select public.submit_operator_time_entry(%L,%L,%L::date,%L::time,%L::time,null)',pg_temp.fixture_id(50),pg_temp.fixture_id(30),current_date-1,'10:00','10:20')),null,'retained Technician can submit fresh work through the legacy public entry point');
select is(pg_temp.capture_error(pg_temp.save_sql(50,31,12)),'Assigned machine not found','retained Technician cannot save an unrelated destination machine');
select set_config('request.jwt.claim.sub',pg_temp.fixture_id(2)::text,true);
select is(pg_temp.capture_error(pg_temp.save_sql(51,30,12)),'Assigned machine not found','new profile cannot save work through another profile compatibility');
select set_config('request.jwt.claim.sub',pg_temp.fixture_id(3)::text,true);
select is(pg_temp.capture_error(format('select public.manager_create_operator_time_entry(%L,%L,%L::timestamptz,%L::timestamptz,null)',pg_temp.fixture_id(50),pg_temp.fixture_id(30),pg_temp.work_at(12),pg_temp.work_at(12)+interval '20 minutes')),null,'existing explicit machine manager can create fresh retained-profile work');
select is(pg_temp.capture_error(format('select public.manager_correct_operator_time_entry(%L,%L,%L::timestamptz,%L::timestamptz,%L,false)',pg_temp.fixture_id(90),pg_temp.fixture_id(30),'2025-01-15 16:00+00','2025-01-15 16:40+00','Synthetic historical correction')),null,'existing manager can correct historical time after the company move');
select set_config('request.jwt.claim.sub',pg_temp.fixture_id(5)::text,true);
select is(pg_temp.capture_error(format('select public.manager_create_operator_time_entry(%L,%L,%L::timestamptz,%L::timestamptz,null)',pg_temp.fixture_id(50),pg_temp.fixture_id(30),pg_temp.work_at(14),pg_temp.work_at(14)+interval '20 minutes')),'Machine manager access required','outsider receives no manager authority from retained payroll compatibility');
reset role;
select is((select count(*)::integer from public.time_entries where operator_profile_id=pg_temp.fixture_id(50)),4,'fresh save/submit/manager create each persist a real entry');
select ok(not exists(select 1 from public.time_entries where operator_profile_id=pg_temp.fixture_id(50) and (account_id<>pg_temp.fixture_id(10) or payout_policy_id<>pg_temp.fixture_id(40) or reporting_location_id<>pg_temp.fixture_id(20))),'all fresh and historical time retains original payroll account/policy and venue ID');
select is((select raw_duration_minutes from public.time_entries where id=pg_temp.fixture_id(90)),40,'historical manager correction runs the real duration trigger');

set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.fixture_id(4)::text,true);
select is(pg_temp.capture_error(pg_temp.assignment_sql(60,50,30)),null,'authorized edit keeps the exact retained assignment');
select is(pg_temp.capture_error(pg_temp.assignment_sql(null,50,30)),'Technician and machine must belong to the same account','single writer cannot create a replacement cross-company assignment ID');
select is(pg_temp.capture_error(pg_temp.assignment_sql(60,51,30)),'Technician and machine must belong to the same account','single writer cannot transfer the retained tuple to a new profile');
select is(pg_temp.capture_error(pg_temp.assignment_sql(60,50,31)),'Technician and machine must belong to the same account','single writer cannot redirect retained assignment to another destination machine');
select is(pg_temp.capture_error(format('select public.admin_set_operator_machine_assignments(%L,array[%L]::uuid[],%L)',pg_temp.fixture_id(50),pg_temp.fixture_id(30),'Synthetic keep retained')),null,'bulk writer keeps the active exact retained pair');
select is(pg_temp.capture_error(format('select public.admin_upsert_operator_compensation_rate(%L,%L,%L,%L,%L,600,%L::date,null,%L,null)',pg_temp.fixture_id(71),pg_temp.fixture_id(10),pg_temp.fixture_id(50),pg_temp.fixture_id(30),'commission','2020-01-01','active')),null,'authorized retained-pair commission editing remains available');
select is(pg_temp.capture_error(format('select public.admin_upsert_operator_compensation_rule(%L,%L,%L,%L,null,600,%L::date,null,%L,null,%L)',pg_temp.fixture_id(71),pg_temp.fixture_id(10),pg_temp.fixture_id(50),pg_temp.fixture_id(30),'2020-01-01','active','Synthetic same-pair compensation')),null,'legacy compensation writer permits authorized same-pair editing');
select is(pg_temp.capture_error(format('select public.admin_upsert_operator_compensation_rule(null,%L,null,%L,null,600,%L::date,null,%L,null,%L)',pg_temp.fixture_id(10),pg_temp.fixture_id(30),'2020-01-01','active','Synthetic generic denied')),'Reporting machine not found for account','generic machine-wide compensation cannot borrow a retained profile mapping');
select is(pg_temp.capture_error(format('select public.admin_upsert_operator_compensation_rate(null,%L,%L,%L,%L,600,%L::date,null,%L,null)',pg_temp.fixture_id(10),pg_temp.fixture_id(51),pg_temp.fixture_id(30),'commission','2020-01-01','active')),'Reporting machine not found for account','compensation cannot borrow another profile retained machine');
select is(pg_temp.capture_error(format('select public.admin_generate_payout_revenue_snapshot(%L,%L,false,null)',pg_temp.fixture_id(80),pg_temp.fixture_id(30))),null,'authorized historical snapshot remains readable through public generation RPC');
select is(pg_temp.capture_error(format('select public.admin_generate_payout_revenue_snapshot(%L,%L,true,%L)',pg_temp.fixture_id(80),pg_temp.fixture_id(30),'Synthetic historical regenerate')),null,'authorized historical snapshot can recalculate after the move');
select is(pg_temp.capture_error(format('select public.admin_generate_payout_revenue_snapshot(%L,%L,true,%L)',pg_temp.fixture_id(80),pg_temp.fixture_id(31),'Synthetic unrelated denied')),'Reporting machine not found for payout account','snapshot compatibility does not admit unrelated destination machines');
select set_config('request.jwt.claim.sub',pg_temp.fixture_id(5)::text,true);
select is(pg_temp.capture_error(pg_temp.assignment_sql(60,50,30)),'Machine assignment access required','outsider cannot edit the retained assignment');
select is(pg_temp.capture_error(format('select public.admin_upsert_operator_compensation_rate(%L,%L,%L,%L,%L,700,%L::date,null,%L,null)',pg_temp.fixture_id(71),pg_temp.fixture_id(10),pg_temp.fixture_id(50),pg_temp.fixture_id(30),'commission','2020-01-01','active')),'Technician compensation access required','outsider cannot change retained compensation');
select is(pg_temp.capture_error(format('select public.admin_generate_payout_revenue_snapshot(%L,%L,false,null)',pg_temp.fixture_id(80),pg_temp.fixture_id(30))),'Operator payout revenue snapshot access required','compatibility never grants historical snapshot authority');

-- Expiry changes caller eligibility, not historical identity compatibility.
select set_config('request.jwt.claim.sub',pg_temp.fixture_id(4)::text,true);
select is(pg_temp.capture_error(pg_temp.assignment_sql(60,50,30,current_date-2)),null,'authorized exact assignment may retain an explicit expired window');
select set_config('request.jwt.claim.sub',pg_temp.fixture_id(1)::text,true);
select is(pg_temp.capture_error(pg_temp.save_sql(50,30,14)),'Assigned machine not found for the work date','retained tuple does not bypass expired-window save guard');
select is(pg_temp.capture_error(format('select public.submit_operator_time_entry(%L,%L,%L::date,%L::time,%L::time,null)',pg_temp.fixture_id(50),pg_temp.fixture_id(30),current_date-1,'14:00','14:20')),'Operator is not assigned to this machine for the work date','retained tuple does not bypass expired-window submit guard');
select set_config('request.jwt.claim.sub',pg_temp.fixture_id(4)::text,true);
select is(pg_temp.capture_error(pg_temp.assignment_sql(60,50,30)),null,'authorized exact assignment can restore its window');
select is(pg_temp.capture_error(format('select public.admin_set_operator_machine_assignments(%L,array[]::uuid[],%L)',pg_temp.fixture_id(50),'Synthetic explicit revoke')),null,'bulk writer can explicitly revoke the retained assignment');
select is(pg_temp.capture_error(format('select public.admin_set_operator_machine_assignments(%L,array[%L]::uuid[],%L)',pg_temp.fixture_id(50),pg_temp.fixture_id(30),'Synthetic replacement denied')),'Every assigned machine must exist in the operator account','bulk writer cannot recreate a revoked cross-company assignment');
select set_config('request.jwt.claim.sub',pg_temp.fixture_id(1)::text,true);
select is(pg_temp.capture_error(pg_temp.save_sql(50,30,14)),'Assigned machine not found for the work date','retained tuple does not bypass revoked-assignment save guard');
select is(pg_temp.capture_error(format('select public.submit_operator_time_entry(%L,%L,%L::date,%L::time,%L::time,null)',pg_temp.fixture_id(50),pg_temp.fixture_id(30),current_date-1,'14:00','14:20')),'Operator is not assigned to this machine for the work date','retained tuple does not bypass revoked-assignment submit guard');
reset role;
select ok(private.reporting_company_payroll_machine_matches(pg_temp.fixture_id(10),pg_temp.fixture_id(30),pg_temp.fixture_id(50)),'revocation leaves the exact historical identity mapping intact');
select is(jsonb_array_length(private.calculate_technician_pay_report(pg_temp.fixture_id(10),pg_temp.fixture_id(50),'2025-01-01','2025-01-31')->'machines'),1,'revoked retained assignment remains in historical recalculation');
select is((select status from public.operator_machine_assignments where id=pg_temp.fixture_id(60)),'revoked','explicit revoke persists on the original assignment');
set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.fixture_id(5)::text,true);
select is(pg_temp.capture_error(pg_temp.assignment_sql(60,50,30)),'Machine assignment access required','outsider cannot reinstate the retained assignment');
select set_config('request.jwt.claim.sub',pg_temp.fixture_id(4)::text,true);
select is(pg_temp.capture_error(pg_temp.assignment_sql(60,50,30)),null,'authorized reinstatement requires the same retained assignment ID');
select set_config('request.jwt.claim.sub',pg_temp.fixture_id(1)::text,true);
select is(pg_temp.capture_error(pg_temp.save_sql(50,30,14)),null,'same-ID reinstatement restores fresh Technician save');
reset role;
select is((select count(*)::integer from public.operator_machine_assignments where operator_profile_id=pg_temp.fixture_id(50) and reporting_machine_id=pg_temp.fixture_id(30)),1,'editing, bulk keep, revoke and reinstatement never introduce a replacement assignment');
select ok((select status='active' and revoked_at is null and account_id=pg_temp.fixture_id(10) from public.operator_machine_assignments where id=pg_temp.fixture_id(60)),'same original ID returns active under its original payroll account');

-- Drift must invalidate the tuple; it is never a general cross-company alias.
update private.reporting_company_payroll_compatibility set reporting_account_id=pg_temp.fixture_id(14) where operator_assignment_id=pg_temp.fixture_id(60);
select ok(not private.reporting_company_payroll_machine_matches(pg_temp.fixture_id(10),pg_temp.fixture_id(30),pg_temp.fixture_id(50)),'changed reporting target invalidates retained compatibility');
select * from finish();
rollback;
