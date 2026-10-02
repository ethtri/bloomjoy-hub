begin;

-- Superseded static marker: Commissionable Sales uses the authoritative net revenue snapshot.
-- The executable assertions below now prove the stricter date-bounded fact basis and
-- reconcile that basis back to the authoritative monthly snapshot.
-- Retained validator markers: an inactive Technician remains available in a historical monthly report.
-- Commissionable Sales refresh retains historically valid revoked assignments.

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(17);

create function pg_temp.capture_error(statement text)
returns text
language plpgsql
as $$
begin
  execute statement;
  return null;
exception
  when others then return sqlerrm;
end;
$$;

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  ('00000000-0000-0000-0000-000000000000', 'a1000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'pay-report-tech@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'a1000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'pay-report-machine-manager@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'a1000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'pay-report-owner@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'a1000000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'pay-report-outsider@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'a1000000-0000-0000-0000-000000000005', 'authenticated', 'authenticated', 'pay-report-partial-tech@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'a1000000-0000-0000-0000-000000000006', 'authenticated', 'authenticated', 'pilot-setup-tech@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'a1000000-0000-0000-0000-000000000007', 'authenticated', 'authenticated', 'arrangement-setup-tech@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now());

insert into public.customer_accounts (id, name, account_type)
values ('a2000000-0000-0000-0000-000000000001', 'Manager report account', 'customer');

insert into public.customer_account_memberships (
  id, account_id, user_id, email, role, active
)
values (
  'a2100000-0000-0000-0000-000000000001',
  'a2000000-0000-0000-0000-000000000001',
  'a1000000-0000-0000-0000-000000000003',
  'pay-report-owner@example.test',
  'owner',
  true
);

insert into public.reporting_locations (id, account_id, name)
values (
  'a3000000-0000-0000-0000-000000000001',
  'a2000000-0000-0000-0000-000000000001',
  'Manager report location'
);

insert into public.reporting_machines (id, account_id, location_id, machine_label)
values
  ('a4000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000001', 'a3000000-0000-0000-0000-000000000001', 'Manager Report Machine'),
  ('a4000000-0000-0000-0000-000000000002', 'a2000000-0000-0000-0000-000000000001', 'a3000000-0000-0000-0000-000000000001', 'Partial Assignment Machine');

insert into public.reporting_machine_tax_rates (
  id, machine_id, tax_rate_percent, effective_start_date, status
)
values
  ('a4050000-0000-0000-0000-000000000001', 'a4000000-0000-0000-0000-000000000001', 10.0000, '2026-01-01', 'active'),
  ('a4050000-0000-0000-0000-000000000002', 'a4000000-0000-0000-0000-000000000002', 10.0000, '2026-01-01', 'active');

insert into public.reporting_machine_refund_managers (
  id, reporting_machine_id, manager_user_id, manager_email, grant_reason
)
values
  (
    'a4100000-0000-0000-0000-000000000001',
    'a4000000-0000-0000-0000-000000000001',
    'a1000000-0000-0000-0000-000000000002',
    'pay-report-machine-manager@example.test',
    'Machine-only Time Report fixture'
  ),
  (
    'a4100000-0000-0000-0000-000000000002',
    'a4000000-0000-0000-0000-000000000002',
    'a1000000-0000-0000-0000-000000000002',
    'pay-report-machine-manager@example.test',
    'Machine-only missed-time fixture'
  );

insert into public.payout_policies (
  id, account_id, name, frequency, period_anchor_type, monthly_period_type,
  submission_due_offset_days, lock_offset_days, target_payout_offset_days,
  rounding_rule, review_model
)
values (
  'a5000000-0000-0000-0000-000000000001',
  'a2000000-0000-0000-0000-000000000001',
  'Manager report monthly policy',
  'monthly', 'calendar', 'calendar_month', 4, 4, 5,
  'round_up_60_minutes', 'no_review_required'
);

update public.customer_accounts
set default_payout_policy_id = 'a5000000-0000-0000-0000-000000000001'
where id = 'a2000000-0000-0000-0000-000000000001';

insert into public.operator_payout_profiles (
  id, account_id, user_id, display_name, worker_type, payout_policy_id,
  worker_identifier, position_title
)
values
  ('a6000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'Report Technician', 'contractor_1099', 'a5000000-0000-0000-0000-000000000001', 'TECH-001', 'Technician'),
  ('a6000000-0000-0000-0000-000000000002', 'a2000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000005', 'Z Partial Technician', 'contractor_1099', 'a5000000-0000-0000-0000-000000000001', 'TECH-002', 'Technician');

insert into public.operator_machine_assignments (
  id, operator_profile_id, account_id, reporting_machine_id,
  effective_start_date, effective_end_date, grant_reason
)
values
  ('a6100000-0000-0000-0000-000000000001', 'a6000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000001', 'a4000000-0000-0000-0000-000000000001', '2026-01-01', '2026-12-31', 'Manager report assignment fixture'),
  ('a6100000-0000-0000-0000-000000000002', 'a6000000-0000-0000-0000-000000000002', 'a2000000-0000-0000-0000-000000000001', 'a4000000-0000-0000-0000-000000000002', '2026-07-16', '2026-07-31', 'Valid partial-month assignment fixture');

insert into public.payout_periods (
  id, account_id, payout_policy_id, period_start_date, period_end_date,
  submission_due_date, lock_date, target_payout_date, status
)
values (
  'a7000000-0000-0000-0000-000000000001',
  'a2000000-0000-0000-0000-000000000001',
  'a5000000-0000-0000-0000-000000000001',
  '2026-07-01', '2026-07-31', '2026-08-04', '2026-08-04', '2026-08-05', 'locked'
);

insert into public.compensation_rules (
  id, account_id, operator_profile_id, reporting_machine_id,
  shift_rate_cents, effective_start_date, effective_end_date, status
)
values
  ('a8000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000001', 'a6000000-0000-0000-0000-000000000001', null, 2000, '2026-01-01', '2026-07-15', 'active'),
  ('a8000000-0000-0000-0000-000000000002', 'a2000000-0000-0000-0000-000000000001', 'a6000000-0000-0000-0000-000000000001', null, 2500, '2026-07-16', null, 'active');

insert into public.compensation_rules (
  id, account_id, operator_profile_id, reporting_machine_id,
  commission_basis_points, effective_start_date, effective_end_date, status
)
values
  ('a8000000-0000-0000-0000-000000000003', 'a2000000-0000-0000-0000-000000000001', 'a6000000-0000-0000-0000-000000000001', null, 1000, '2026-01-01', '2026-07-15', 'active'),
  ('a8000000-0000-0000-0000-000000000004', 'a2000000-0000-0000-0000-000000000001', 'a6000000-0000-0000-0000-000000000001', null, 2000, '2026-07-16', null, 'active'),
  ('a8000000-0000-0000-0000-000000000005', 'a2000000-0000-0000-0000-000000000001', 'a6000000-0000-0000-0000-000000000002', null, 500, '2026-07-16', '2026-07-23', 'active'),
  ('a8000000-0000-0000-0000-000000000006', 'a2000000-0000-0000-0000-000000000001', 'a6000000-0000-0000-0000-000000000002', null, 1000, '2026-07-24', null, 'active');

insert into public.compensation_rules (
  id, account_id, operator_profile_id, reporting_machine_id,
  commission_basis_points, effective_start_date, status
)
values (
  'a8000000-0000-0000-0000-000000000007',
  'a2000000-0000-0000-0000-000000000001',
  'a6000000-0000-0000-0000-000000000001',
  'a4000000-0000-0000-0000-000000000001',
  1200,
  '2026-08-01',
  'active'
);

-- These historical locked-period rows are fixture setup, so seed them through
-- the same explicit manager-correction context enforced by the production trigger.
select set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-000000000002', true);
select set_config('app.timekeeping_manager_correction', 'true', true);

insert into public.time_entries (
  id, account_id, operator_profile_id, reporting_machine_id, reporting_location_id,
  payout_policy_id, payout_period_id, work_date, start_time, end_time,
  actual_start_at, actual_end_at, raw_duration_minutes, rounded_paid_minutes,
  paid_shift_count, status
)
values
  ('a9000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000001', 'a6000000-0000-0000-0000-000000000001', 'a4000000-0000-0000-0000-000000000001', 'a3000000-0000-0000-0000-000000000001', 'a5000000-0000-0000-0000-000000000001', 'a7000000-0000-0000-0000-000000000001', '2026-07-05', '08:00', '09:01', '2026-07-05 15:00:00+00', '2026-07-05 16:01:00+00', 61, 120, 2, 'submitted'),
  ('a9000000-0000-0000-0000-000000000002', 'a2000000-0000-0000-0000-000000000001', 'a6000000-0000-0000-0000-000000000001', 'a4000000-0000-0000-0000-000000000001', 'a3000000-0000-0000-0000-000000000001', 'a5000000-0000-0000-0000-000000000001', 'a7000000-0000-0000-0000-000000000001', '2026-07-10', '08:00', '08:20', '2026-07-10 15:00:00+00', '2026-07-10 15:20:00+00', 20, 60, 1, 'submitted'),
  ('a9000000-0000-0000-0000-000000000003', 'a2000000-0000-0000-0000-000000000001', 'a6000000-0000-0000-0000-000000000001', 'a4000000-0000-0000-0000-000000000001', 'a3000000-0000-0000-0000-000000000001', 'a5000000-0000-0000-0000-000000000001', 'a7000000-0000-0000-0000-000000000001', '2026-07-11', '08:00', '08:20', '2026-07-11 15:00:00+00', '2026-07-11 15:20:00+00', 20, 60, 1, 'submitted'),
  ('a9000000-0000-0000-0000-000000000004', 'a2000000-0000-0000-0000-000000000001', 'a6000000-0000-0000-0000-000000000001', 'a4000000-0000-0000-0000-000000000001', 'a3000000-0000-0000-0000-000000000001', 'a5000000-0000-0000-0000-000000000001', 'a7000000-0000-0000-0000-000000000001', '2026-07-20', '08:00', '08:20', '2026-07-20 15:00:00+00', '2026-07-20 15:20:00+00', 20, 60, 1, 'submitted');

select set_config('app.timekeeping_manager_correction', 'false', true);

-- July 10 late Eastern work falls on July 11 in UTC. Analytics must continue
-- to use the location-local work date preserved by the canonical trigger.
update public.reporting_locations set timezone='America/New_York'
where id='a3000000-0000-0000-0000-000000000001';
select set_config('app.timekeeping_manager_correction','true',true);
update public.time_entries set actual_start_at='2026-07-11 03:00:00+00',actual_end_at='2026-07-11 03:20:00+00',start_time='23:00',end_time='23:20'
where id='a9000000-0000-0000-0000-000000000002';
select set_config('app.timekeeping_manager_correction','false',true);

select is((select provolatile::text from pg_proc where oid='public.get_labor_analytics_report(date,date,uuid[],uuid[])'::regprocedure),'s','analytics is STABLE');
select ok(not has_function_privilege('anon','public.get_labor_analytics_report(date,date,uuid[],uuid[])','EXECUTE'),'anonymous cannot call analytics');
select is(public.get_labor_analytics_access()->>'canViewPay','false','machine manager has no account pay authority');
select is(public.get_labor_analytics_report('2026-07-01','2026-07-31')->'pay','null'::jsonb,'time-only payload contains no compensation');
select is((select sum((value->>'actualMinutes')::integer) from jsonb_array_elements(public.get_labor_analytics_report('2026-07-01','2026-07-31')->'rows')),121::bigint,'actual effort is not rounded shifts');
select is((select sum((value->>'paidShifts')::integer) from jsonb_array_elements(public.get_labor_analytics_report('2026-07-01','2026-07-31')->'rows')),5::bigint,'each entry preserves canonical independently rounded shifts');
select is(jsonb_array_length(public.get_labor_analytics_report('2026-07-10','2026-07-10')->'rows'),1,'inclusive dates retain boundary entries');
select is((select sum((value->>'actualMinutes')::integer) from jsonb_array_elements(public.get_labor_analytics_report('2026-07-10','2026-07-10')->'rows')),20::bigint,'Eastern work date survives UTC day boundary');
select is(jsonb_array_length(public.get_labor_analytics_report('2026-07-01','2026-07-31',array[]::uuid[])->'rows'),0,'empty machine scope does not broaden access');
select set_config('request.jwt.claim.sub','a1000000-0000-0000-0000-000000000004',true);
select is(jsonb_array_length(public.get_labor_analytics_report('2026-07-01','2026-07-31')->'rows'),0,'outsider cannot see recorded effort');
select set_config('request.jwt.claim.sub','a1000000-0000-0000-0000-000000000003',true);
create temporary table before_analytics as select (select count(*) from public.payout_periods) periods,(select count(*) from public.payout_period_machine_revenue_snapshots) snapshots;
insert into public.operator_recurring_compensation_items(account_id,operator_profile_id,item_type,description,amount_cents,effective_start_date)
values('a2000000-0000-0000-0000-000000000001','a6000000-0000-0000-0000-000000000001','bonus','Synthetic monthly bonus',1000,'2026-07-01');
select ok(public.get_labor_analytics_report('2026-07-01','2026-07-31')->'pay' <> 'null'::jsonb,'account owner receives sanitized canonical earnings');
select is(public.get_labor_analytics_report('2026-07-01','2026-07-31',array['a4000000-0000-0000-0000-000000000001'::uuid])->'pay'->'unallocatedOtherEarningsCents','null'::jsonb,'machine filtering cannot allocate account bonuses or reimbursements');
select is(public.get_labor_analytics_report('2026-07-10','2026-07-20')->'pay'->'unallocatedOtherEarningsCents','null'::jsonb,'partial-month dates cannot invent bonus proration');
select is((public.get_labor_analytics_report('2026-07-10','2026-07-20')->'pay'->>'readyCalculationCount')::integer,0,'partial-month estimates are not full statement readiness');
select is((public.get_labor_analytics_report('2026-07-01','2026-08-31')->'pay'->>'unallocatedOtherEarningsCents')::bigint,2000::bigint,'multi-month recurring bonus follows one canonical calculation per month');
insert into public.payout_runs(id,account_id,payout_period_id,status)
values('ac000000-0000-0000-0000-000000000001','a2000000-0000-0000-0000-000000000001','a7000000-0000-0000-0000-000000000001','review');
insert into public.payout_run_items(id,payout_run_id,account_id,operator_profile_id,worker_type,status)
values('ac100000-0000-0000-0000-000000000001','ac000000-0000-0000-0000-000000000001','a2000000-0000-0000-0000-000000000001','a6000000-0000-0000-0000-000000000001','contractor_1099','finalized');
-- The canonical freshness helper marks an issued v2 statement with no source
-- revision as requiring regeneration. Analytics must expose that exact state.
insert into public.pay_statements(id,payout_run_id,payout_run_item_id,account_id,operator_profile_id,statement_number,statement_label,status,issued_at,statement_payload,operator_notification_status)
values('ac300000-0000-0000-0000-000000000001','ac000000-0000-0000-0000-000000000001','ac100000-0000-0000-0000-000000000001','a2000000-0000-0000-0000-000000000001','a6000000-0000-0000-0000-000000000001','LABOR-SYNTHETIC-JULY','Pay Stub','issued','2026-08-01','{"schemaVersion":"operator-pay-stub-v2","calculationMeta":{}}','portal_published');
select is((public.get_labor_analytics_report('2026-07-01','2026-07-31')->'pay'->>'revisionRequiredCount')::integer,1,'stale issued statement revision uses canonical stable freshness helper');
select ok((select periods=(select count(*) from public.payout_periods) and snapshots=(select count(*) from public.payout_period_machine_revenue_snapshots) from before_analytics),'analytics never creates periods or snapshots');
select * from finish();
rollback;

