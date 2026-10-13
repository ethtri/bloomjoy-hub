begin;
set local timezone = 'America/Los_Angeles';
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select set_config('request.jwt.claim.role','authenticated',true);
select no_plan();

-- Synthetic IDs only. Fixture seeding bypasses triggers; every operation under
-- test below runs with origin triggers and the real authenticated RPC authority.
create function pg_temp.fixture_id(n integer) returns uuid language sql immutable as $$
  select ('d1906000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid;
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


-- An old revoked source assignment survived a payer consolidation. It has no
-- valid retained mapping, whereas the original assignment remains historical.
set local session_replication_role = replica;
insert into public.operator_machine_assignments(id,operator_profile_id,account_id,reporting_machine_id,effective_start_date,status,revoked_at,grant_reason)
values(pg_temp.fixture_id(61),pg_temp.fixture_id(51),pg_temp.fixture_id(10),pg_temp.fixture_id(31),'2025-01-01','revoked',now(),'Synthetic consolidated source');
update public.operator_machine_assignments set status='revoked',revoked_at=now() where id=pg_temp.fixture_id(60);
-- A revoked valid machine with no sales must still be reconciled by the
-- assignment arm (it cannot be rescued by the sales-attribution UNION arm).
insert into public.reporting_machines(id,account_id,location_id,machine_label)
values(pg_temp.fixture_id(34),pg_temp.fixture_id(10),pg_temp.fixture_id(20),'Synthetic zero-sales historical machine');
insert into public.operator_machine_assignments(id,operator_profile_id,account_id,reporting_machine_id,effective_start_date,status,revoked_at,grant_reason)
values(pg_temp.fixture_id(62),pg_temp.fixture_id(50),pg_temp.fixture_id(10),pg_temp.fixture_id(34),'2025-01-01','revoked',now(),'Synthetic historical no-sales assignment');
update public.payout_period_machine_revenue_snapshots set gross_sales_cents=1 where id=pg_temp.fixture_id(92);
insert into public.payout_runs(id,account_id,payout_period_id,status)
values(pg_temp.fixture_id(100),pg_temp.fixture_id(10),pg_temp.fixture_id(80),'issued');
insert into public.payout_run_items(id,payout_run_id,account_id,operator_profile_id,worker_type,status)
values(pg_temp.fixture_id(101),pg_temp.fixture_id(100),pg_temp.fixture_id(10),pg_temp.fixture_id(50),'contractor_1099','finalized');
insert into public.pay_statements(id,payout_run_id,payout_run_item_id,account_id,operator_profile_id,statement_number,statement_label,status,version,issued_at,statement_payload,operator_notification_status)
values(pg_temp.fixture_id(102),pg_temp.fixture_id(100),pg_temp.fixture_id(101),pg_temp.fixture_id(10),pg_temp.fixture_id(50),'SYNTHETIC-SCOPE-RECOVERY-V1','Pay Stub','issued',1,'2025-02-05 12:00+00',jsonb_build_object('schemaVersion','operator-pay-stub-v2','calculationMeta',jsonb_build_object('paySourceRevision',0)),'portal_published');
set local session_replication_role = origin;
create temporary table preserved_assignment on commit drop as select to_jsonb(a) as row from public.operator_machine_assignments a where id=pg_temp.fixture_id(61);
create temporary table preserved_statements on commit drop as select coalesce(jsonb_agg(to_jsonb(s) order by id),'[]'::jsonb) as rows from public.pay_statements s;

select ok(not private.reporting_company_payroll_machine_matches(pg_temp.fixture_id(10),pg_temp.fixture_id(31)), 'fixture reproduces an invalid old-account assignment scope');
select ok(private.reporting_company_payroll_machine_matches(pg_temp.fixture_id(10),pg_temp.fixture_id(30)), 'valid revoked historical assignment still has snapshot scope');
select is(pg_temp.capture_error(format('select public.service_refresh_pay_stub_revenue_snapshot(%L,%L)',pg_temp.fixture_id(80),pg_temp.fixture_id(31))), 'Pay Stub revenue snapshot scope not found', 'snapshot writer continues to reject invalid scope');

set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.fixture_id(4)::text,true);
select lives_ok($$select public.get_current_technician_pay_report_context('2025-01-01')$$, 'authorized monthly report survives invalid revoked source assignment');
select ok(exists(select 1 from jsonb_array_elements(public.get_current_technician_pay_report_context('2025-01-01')->'technicians') t where t->>'operatorProfileId'=pg_temp.fixture_id(50)::text and t ? 'payStubPublication'), 'public generation-status wrapper still returns legitimate Technician');
select set_config('request.jwt.claim.sub',pg_temp.fixture_id(5)::text,true);
select is(pg_temp.capture_error($$select public.get_current_technician_pay_report_context('2025-01-01')$$),'Account pay authority required','unrelated actor still cannot access the report');
select set_config('request.jwt.claim.sub','',true);
select is(pg_temp.capture_error($$select public.get_current_technician_pay_report_context('2025-01-01')$$),'Authentication required','unauthenticated report remains denied');
reset role;

select ok(not exists(select 1 from public.payout_period_machine_revenue_snapshots where payout_period_id=pg_temp.fixture_id(80) and reporting_machine_id=pg_temp.fixture_id(31)), 'invalid assignment creates no snapshot');
select ok(exists(select 1 from public.payout_period_machine_revenue_snapshots where payout_period_id=pg_temp.fixture_id(80) and reporting_machine_id=pg_temp.fixture_id(30) and gross_sales_cents=10000), 'valid historical revoked assignment snapshot remains calculated');
select ok(exists(select 1 from public.payout_period_machine_revenue_snapshots where payout_period_id=pg_temp.fixture_id(80) and reporting_machine_id=pg_temp.fixture_id(34)), 'valid revoked no-sales assignment remains in assignment-derived snapshot scope');
select is((select to_jsonb(a) from public.operator_machine_assignments a where id=pg_temp.fixture_id(61)),(select row from preserved_assignment),'stale assignment history is unchanged');
select is((select coalesce(jsonb_agg(to_jsonb(s) order by id),'[]'::jsonb) from public.pay_statements s),(select rows from preserved_statements),'report does not publish or rewrite statements');
select * from finish();
rollback;
