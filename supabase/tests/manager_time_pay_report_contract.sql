begin;

-- Superseded static marker: Commissionable Sales uses the authoritative net revenue snapshot.
-- The executable assertions below now prove the stricter date-bounded fact basis and
-- reconcile that basis back to the authoritative monthly snapshot.
-- Retained validator markers: an inactive Technician remains available in a historical monthly report.
-- Commissionable Sales refresh retains historically valid revoked assignments.

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(73);

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
  ('00000000-0000-0000-0000-000000000000', 'a1000000-0000-0000-0000-000000000006', 'authenticated', 'authenticated', 'pilot-setup-tech@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now());

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

insert into public.reporting_machine_refund_managers (
  id, reporting_machine_id, manager_user_id, manager_email, grant_reason
)
values (
  'a4100000-0000-0000-0000-000000000001',
  'a4000000-0000-0000-0000-000000000001',
  'a1000000-0000-0000-0000-000000000002',
  'pay-report-machine-manager@example.test',
  'Machine-only Time Report fixture'
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

insert into public.machine_sales_facts (
  id, reporting_machine_id, reporting_location_id, sale_date, payment_method,
  net_sales_cents, transaction_count, source, source_row_hash
)
values
  ('a9100000-0000-0000-0000-000000000001', 'a4000000-0000-0000-0000-000000000001', 'a3000000-0000-0000-0000-000000000001', '2026-07-10', 'credit', 4000, 4, 'sample_seed', 'manager-report-sale-a-1'),
  ('a9100000-0000-0000-0000-000000000002', 'a4000000-0000-0000-0000-000000000001', 'a3000000-0000-0000-0000-000000000001', '2026-07-31', 'credit', 6000, 6, 'sample_seed', 'manager-report-sale-a-2'),
  ('a9100000-0000-0000-0000-000000000003', 'a4000000-0000-0000-0000-000000000002', 'a3000000-0000-0000-0000-000000000001', '2026-07-20', 'credit', 2000, 2, 'sample_seed', 'manager-report-sale-b-1'),
  ('a9100000-0000-0000-0000-000000000004', 'a4000000-0000-0000-0000-000000000002', 'a3000000-0000-0000-0000-000000000001', '2026-07-31', 'credit', 3000, 3, 'sample_seed', 'manager-report-sale-b-2');

insert into public.sales_adjustment_facts (
  id, reporting_machine_id, reporting_location_id, adjustment_date,
  adjustment_type, amount_cents, source, source_row_hash
)
values
  ('a9200000-0000-0000-0000-000000000001', 'a4000000-0000-0000-0000-000000000001', 'a3000000-0000-0000-0000-000000000001', '2026-07-31', 'refund', 1000, 'manual', 'manager-report-refund-a-1'),
  ('a9200000-0000-0000-0000-000000000002', 'a4000000-0000-0000-0000-000000000002', 'a3000000-0000-0000-0000-000000000001', '2026-07-31', 'refund', 500, 'manual', 'manager-report-refund-b-1');

insert into public.payout_period_machine_revenue_snapshots (
  id, account_id, payout_period_id, reporting_machine_id, reporting_location_id,
  period_start_date, period_end_date, gross_sales_cents, refund_adjustment_cents,
  net_revenue_cents, eligible_commission_revenue_cents, transaction_count,
  source_sales_row_count, source_adjustment_row_count, source_latest_sale_date,
  source_latest_adjustment_date, status, warnings
)
values
  ('aa000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000001', 'a7000000-0000-0000-0000-000000000001', 'a4000000-0000-0000-0000-000000000001', 'a3000000-0000-0000-0000-000000000001', '2026-07-01', '2026-07-31', 10000, 1000, 9000, 9000, 10, 2, 1, '2026-07-31', '2026-07-31', 'source_generated', '[]'::jsonb),
  ('aa000000-0000-0000-0000-000000000002', 'a2000000-0000-0000-0000-000000000001', 'a7000000-0000-0000-0000-000000000001', 'a4000000-0000-0000-0000-000000000002', 'a3000000-0000-0000-0000-000000000001', '2026-07-01', '2026-07-31', 5000, 500, 4500, 4500, 5, 2, 1, '2026-07-31', '2026-07-31', 'source_generated', '[]'::jsonb);

insert into public.operator_recurring_compensation_items (
  id, account_id, operator_profile_id, item_type, description, amount_cents,
  effective_start_date, status
)
values (
  'ab000000-0000-0000-0000-000000000001',
  'a2000000-0000-0000-0000-000000000001',
  'a6000000-0000-0000-0000-000000000001',
  'supply_credit',
  'Monthly supply credit',
  5000,
  '2026-01-01',
  'active'
);

insert into public.payout_runs (
  id, account_id, payout_period_id, status
)
values (
  'ac000000-0000-0000-0000-000000000001',
  'a2000000-0000-0000-0000-000000000001',
  'a7000000-0000-0000-0000-000000000001',
  'review'
);

insert into public.payout_run_items (
  id, payout_run_id, account_id, operator_profile_id, worker_type,
  raw_minutes, rounded_paid_minutes, shift_count, hourly_pay_cents,
  eligible_net_revenue_cents, commission_basis_points,
  commission_pay_cents, total_payout_cents, status
)
values (
  'ac100000-0000-0000-0000-000000000001',
  'ac000000-0000-0000-0000-000000000001',
  'a2000000-0000-0000-0000-000000000001',
  'a6000000-0000-0000-0000-000000000001',
  'contractor_1099',
  121, 180, 3, 6500, 9000, 1000, 900, 7400, 'draft'
);

insert into public.payout_run_item_machines (
  id, payout_run_item_id, reporting_machine_id, reporting_location_id,
  net_revenue_cents, eligible_net_revenue_cents,
  commission_basis_points, commission_pay_cents, shift_count,
  raw_minutes, rounded_paid_minutes, included_in_commission_basis
)
values (
  'ac200000-0000-0000-0000-000000000001',
  'ac100000-0000-0000-0000-000000000001',
  'a4000000-0000-0000-0000-000000000001',
  'a3000000-0000-0000-0000-000000000001',
  9000, 9000, 1000, 900, 3, 121, 180, true
);

select ok(
  has_function_privilege('authenticated', 'public.get_my_time_review_context(date)', 'execute'),
  'authenticated managers can call the machine-scoped Time Report'
);
select ok(
  has_function_privilege('authenticated', 'public.get_technician_pay_report_context(date)', 'execute'),
  'authenticated managers can reach the pay-authority-gated report RPC'
);
select ok(
  not has_function_privilege('anon', 'public.get_technician_pay_report_context(date)', 'execute'),
  'anonymous callers cannot reach the pay report'
);
select ok(
  has_function_privilege('authenticated', 'public.admin_supersede_operator_compensation_rate(uuid,uuid,uuid,text,integer,date,date,text)', 'execute'),
  'account pay managers can reach the audited rate-change action'
);
select ok(
  not has_function_privilege('anon', 'public.admin_supersede_operator_compensation_rate(uuid,uuid,uuid,text,integer,date,date,text)', 'execute'),
  'anonymous callers cannot change compensation rates'
);
select ok(
  has_function_privilege('authenticated', 'public.admin_refresh_technician_pay_report_sales(date,uuid)', 'execute'),
  'account pay managers can reach the Commissionable Sales refresh action'
);
select ok(
  not has_function_privilege('authenticated', 'private.calculate_technician_pay_report(uuid,uuid,date,date)', 'execute'),
  'browser callers cannot invoke the private pay calculation directly'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-000000000002', true);

select ok(
  (public.get_my_time_review_context('2026-07-01')->>'hasAccess')::boolean,
  'a machine manager has Time Report access'
);
select ok(public.get_my_time_report_access(), 'a machine manager receives the safe Time Report portal capability');
select ok(
  not (public.get_my_admin_access_context()->'allowedSurfaces' ? 'payouts'),
  'a machine-only Time Report manager does not receive the Technician Pay admin surface'
);
select is(
  jsonb_array_length(public.get_my_time_review_context('2026-07-01')->'entries'),
  4,
  'the Time Report returns only four in-scope entries'
);
select is(
  public.get_my_time_review_context('2026-07-01') #>> '{entries,3,actualDurationMinutes}',
  '61',
  'the Time Report preserves the canonical 61-minute duration'
);
select is(
  public.get_my_time_review_context('2026-07-01') #>> '{entries,3,paidShifts}',
  '2',
  '61 minutes displays as two paid shifts'
);
select is(
  public.get_my_time_review_context('2026-07-01') #>> '{technicians,0,paidShifts}',
  '5',
  'the Time Report summary totals independently rounded shifts'
);
select is(
  public.get_my_time_review_context('2026-07-01') #>> '{capabilities,approvalRequired}',
  'false',
  'the Time Report has no approval action'
);

select is(
  pg_temp.capture_error($$select public.get_technician_pay_report_context('2026-07-01')$$),
  'Account pay authority required',
  'machine-only Time Report authority cannot read pay data'
);
select is(
  jsonb_array_length(public.get_payout_review_context()->'periods'),
  0,
  'machine-only Time Report authority cannot read the legacy payout surface either'
);
select is((select count(*)::integer from public.compensation_rules), 0, 'machine-only managers cannot select compensation rates directly');
select is((select count(*)::integer from public.payout_runs), 0, 'machine-only managers cannot select payout runs directly');
select is((select count(*)::integer from public.payout_run_items), 0, 'machine-only managers cannot select payout items directly');
select is((select count(*)::integer from public.payout_run_item_machines), 0, 'machine-only managers cannot select machine pay rows directly');

select set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-000000000003', true);

select ok(
  (public.get_technician_pay_report_context('2026-07-01')->>'hasAccess')::boolean,
  'an account owner has Technician Pay Report access'
);
select is(
  jsonb_array_length(public.get_technician_pay_report_context('2026-07-01')->'technicians'),
  2,
  'the pay report returns only Technicians in the authorized account'
);
select is(
  public.get_technician_pay_report_context('2026-07-01') #>> '{technicians,0,paidShifts}',
  '5',
  'the pay report totals five paid shifts'
);
select is(
  (
    select sum((entry.value->>'paidShifts')::integer)::integer
    from jsonb_array_elements(
      public.get_technician_pay_report_context('2026-07-01') #> '{technicians,0,entries}'
    ) entry(value)
    where (entry.value->>'actualDurationMinutes')::integer = 20
  ),
  3,
  'three separate 20-minute entries count as three shifts'
);
select is(
  (
    select (entry.value->>'paidShifts')::integer
    from jsonb_array_elements(
      public.get_technician_pay_report_context('2026-07-01') #> '{technicians,0,entries}'
    ) entry(value)
    where (entry.value->>'actualDurationMinutes')::integer = 61
  ),
  2,
  'the pay calculation uses two shifts for a 61-minute entry'
);
select is(
  jsonb_array_length(public.get_technician_pay_report_context('2026-07-01') #> '{technicians,0,shiftRateLines}'),
  2,
  'a midmonth raise is displayed as two separate effective rate lines'
);
select is(
  public.get_technician_pay_report_context('2026-07-01') #>> '{technicians,0,shiftEarningsCents}',
  '10500',
  'shift earnings reconcile across the midmonth raise'
);
select is(
  public.get_technician_pay_report_context('2026-07-01') #>> '{technicians,0,commissionableSalesCents}',
  '9000',
  'Commissionable Sales uses authoritative date-bounded sales and refund facts'
);
select is(
  public.get_technician_pay_report_context('2026-07-01') #>> '{technicians,0,commissionEarningsCents}',
  '1400',
  'commission reconciles from two effective-rate date segments'
);
select is(
  public.get_technician_pay_report_context('2026-07-01') #>> '{technicians,0,supplyCreditCents}',
  '5000',
  'one effective recurring supply credit is included once'
);
select is(
  public.get_technician_pay_report_context('2026-07-01') #>> '{technicians,0,currentTotalCents}',
  '16900',
  'current total includes shifts, commission, and supply credit without deducting refunds twice'
);
select is(
  public.get_technician_pay_report_context('2026-07-01') #>> '{technicians,0,machines,0,refundAdjustmentCents}',
  '1000',
  'the source refund remains visible in the machine calculation'
);
select is(
  public.get_technician_pay_report_context('2026-07-01') #>> '{technicians,0,calculationMeta,refundAppliedOnce}',
  'true',
  'calculation metadata makes the once-only refund treatment explicit'
);
select is(
  public.get_technician_pay_report_context('2026-07-01') #>> '{technicians,0,publishable}',
  'true',
  'complete inputs produce a publishable calculation'
);
select is(
  pg_temp.capture_error($$
    select public.admin_supersede_operator_compensation_rate(
      'a2000000-0000-0000-0000-000000000001',
      'a6000000-0000-0000-0000-000000000001',
      null,
      'shift',
      3000,
      '2026-08-01',
      null,
      null
    )
  $$),
  null,
  'a midmonth raise can supersede an existing open-ended shift rate in one action'
);

-- The point-in-time resolver is deliberately service-only; inspect it as the
-- privileged fixture role rather than widening browser execution privileges.
reset role;
select is(
  concat(
    public.operator_compensation_rate_at(
      'a2000000-0000-0000-0000-000000000001',
      'a6000000-0000-0000-0000-000000000001',
      null,
      '2026-07-31',
      'shift'
    ) ->> 'shiftRateCents',
    ':',
    public.operator_compensation_rate_at(
      'a2000000-0000-0000-0000-000000000001',
      'a6000000-0000-0000-0000-000000000001',
      null,
      '2026-08-01',
      'shift'
    ) ->> 'shiftRateCents'
  ),
  '2500:3000',
  'the superseded rate ends the prior window on the preceding day'
);

reset role;
update public.operator_payout_profiles
set status = 'inactive'
where id = 'a6000000-0000-0000-0000-000000000001';
update public.operator_machine_assignments
set status = 'revoked',
    revoked_at = now(),
    revoke_reason = 'Historical report fixture'
where id = 'a6100000-0000-0000-0000-000000000001';

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-000000000003', true);
select is(
  jsonb_array_length(public.get_technician_pay_report_context('2026-07-01')->'technicians'),
  2,
  'an inactive Technician remains available alongside active historical Technicians'
);
select is(
  public.get_technician_pay_report_context('2026-07-01') #>> '{technicians,0,publishable}',
  'true',
  'a later-revoked assignment retains its valid historical calculation window'
);
select is(
  (
    select concat(result ->> 'periodCount', ':', result ->> 'snapshotCount')
    from (
      select public.admin_refresh_technician_pay_report_sales(
        '2026-07-01',
        'a2000000-0000-0000-0000-000000000001'
      ) as result
    ) refreshed
  ),
  '1:2',
  'Commissionable Sales refresh retains both historically valid assignment machines'
);

reset role;
update public.operator_payout_profiles
set status = 'active'
where id = 'a6000000-0000-0000-0000-000000000001';

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-000000000003', true);
select is(
  jsonb_array_length(public.get_technician_pay_report_context('2026-07-01') #> '{technicians,0,machines,0,commissionSegments}'),
  2,
  'a midmonth commission-rate change produces two transparent date segments'
);
select is(
  concat(
    public.get_technician_pay_report_context('2026-07-01') #>> '{technicians,0,machines,0,commissionSegments,0,commissionBasisPoints}', ':',
    public.get_technician_pay_report_context('2026-07-01') #>> '{technicians,0,machines,0,commissionSegments,0,commissionableSalesCents}', ':',
    public.get_technician_pay_report_context('2026-07-01') #>> '{technicians,0,machines,0,commissionSegments,1,commissionBasisPoints}', ':',
    public.get_technician_pay_report_context('2026-07-01') #>> '{technicians,0,machines,0,commissionSegments,1,commissionableSalesCents}'
  ),
  '1000:4000:2000:5000',
  'commission segments expose each effective rate and its Commissionable Sales basis'
);
select is(
  concat(
    public.get_technician_pay_report_context('2026-07-01') #>> '{technicians,0,machines,0,commissionSegments,0,segmentStartDate}', ':',
    public.get_technician_pay_report_context('2026-07-01') #>> '{technicians,0,machines,0,commissionSegments,0,segmentEndDate}', ':',
    public.get_technician_pay_report_context('2026-07-01') #>> '{technicians,0,machines,0,commissionSegments,0,commissionEarningsCents}', ':',
    public.get_technician_pay_report_context('2026-07-01') #>> '{technicians,0,machines,0,commissionSegments,1,segmentStartDate}', ':',
    public.get_technician_pay_report_context('2026-07-01') #>> '{technicians,0,machines,0,commissionSegments,1,segmentEndDate}', ':',
    public.get_technician_pay_report_context('2026-07-01') #>> '{technicians,0,machines,0,commissionSegments,1,commissionEarningsCents}'
  ),
  '2026-07-01:2026-07-15:400:2026-07-16:2026-07-31:1000',
  'midmonth commission segments expose exact date windows and earnings'
);
select is(
  public.get_technician_pay_report_context('2026-07-01') #>> '{technicians,1,publishable}',
  'true',
  'a complete partial-month assignment is publishable'
);
select is(
  concat(
    public.get_technician_pay_report_context('2026-07-01') #>> '{technicians,1,machines,0,assignedStartDate}', ':',
    public.get_technician_pay_report_context('2026-07-01') #>> '{technicians,1,machines,0,assignedEndDate}'
  ),
  '2026-07-16:2026-07-31',
  'the partial assignment preserves its exact compensation window'
);
select is(
  public.get_technician_pay_report_context('2026-07-01') #>> '{technicians,1,machines,0,fullPeriodAssignment}',
  'false',
  'the report transparently identifies a partial-month assignment'
);
select is(
  public.get_technician_pay_report_context('2026-07-01') #>> '{technicians,1,machines,0,assignmentScopeResolved}',
  'true',
  'a non-overlapping partial assignment is resolved rather than blocked'
);
select is(
  jsonb_array_length(public.get_technician_pay_report_context('2026-07-01') #> '{technicians,1,machines,0,commissionSegments}'),
  2,
  'the partial assignment can contain multiple effective commission-rate segments'
);
select is(
  concat(
    public.get_technician_pay_report_context('2026-07-01') #>> '{technicians,1,machines,0,commissionSegments,0,commissionBasisPoints}', ':',
    public.get_technician_pay_report_context('2026-07-01') #>> '{technicians,1,machines,0,commissionSegments,0,commissionableSalesCents}', ':',
    public.get_technician_pay_report_context('2026-07-01') #>> '{technicians,1,machines,0,commissionSegments,1,commissionBasisPoints}', ':',
    public.get_technician_pay_report_context('2026-07-01') #>> '{technicians,1,machines,0,commissionSegments,1,commissionableSalesCents}'
  ),
  '500:2000:1000:2500',
  'partial assignment commission segments use only date-bounded source facts'
);
select is(
  concat(
    public.get_technician_pay_report_context('2026-07-01') #>> '{technicians,1,machines,0,commissionSegments,0,segmentStartDate}', ':',
    public.get_technician_pay_report_context('2026-07-01') #>> '{technicians,1,machines,0,commissionSegments,0,segmentEndDate}', ':',
    public.get_technician_pay_report_context('2026-07-01') #>> '{technicians,1,machines,0,commissionSegments,0,commissionEarningsCents}', ':',
    public.get_technician_pay_report_context('2026-07-01') #>> '{technicians,1,machines,0,commissionSegments,1,segmentStartDate}', ':',
    public.get_technician_pay_report_context('2026-07-01') #>> '{technicians,1,machines,0,commissionSegments,1,segmentEndDate}', ':',
    public.get_technician_pay_report_context('2026-07-01') #>> '{technicians,1,machines,0,commissionSegments,1,commissionEarningsCents}'
  ),
  '2026-07-16:2026-07-23:100:2026-07-24:2026-07-31:250',
  'partial assignment segments expose exact date windows and earnings'
);
select is(
  public.get_technician_pay_report_context('2026-07-01') #>> '{technicians,1,commissionableSalesCents}',
  '4500',
  'partial assignment totals only its in-window Commissionable Sales'
);
select is(
  public.get_technician_pay_report_context('2026-07-01') #>> '{technicians,1,commissionEarningsCents}',
  '350',
  'partial assignment commission reconciles across its two rates'
);

reset role;
update public.sales_adjustment_facts
set amount_cents = 8000
where id = 'a9200000-0000-0000-0000-000000000001';

update public.payout_period_machine_revenue_snapshots
set refund_adjustment_cents = 8000,
    net_revenue_cents = 2000,
    eligible_commission_revenue_cents = 2000
where id = 'aa000000-0000-0000-0000-000000000001';

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-000000000003', true);

select is(
  concat(
    public.get_technician_pay_report_context('2026-07-01') #>> '{technicians,0,machines,0,snapshotMatchesFacts}', ':',
    public.get_technician_pay_report_context('2026-07-01') #>> '{technicians,0,machines,0,commissionableSalesCents}'
  ),
  'true:2000',
  'cross-rate refunds reconcile to authoritative facts with the machine basis capped once'
);
select is(
  concat(
    public.get_technician_pay_report_context('2026-07-01') #>> '{technicians,0,machines,0,commissionAllocationResolved}', ':',
    public.get_technician_pay_report_context('2026-07-01') #>> '{technicians,0,machines,0,commissionEarningsCents}'
  ),
  'false:0',
  'an ambiguous cross-rate refund cannot contribute commission earnings'
);
select is(
  concat(
    public.get_technician_pay_report_context('2026-07-01') #>> '{technicians,0,publishable}', ':',
    (
      select count(*)::integer
      from jsonb_array_elements(
        public.get_technician_pay_report_context('2026-07-01') #> '{technicians,0,blockers}'
      ) blocker(value)
      where blocker.value ->> 'code' = 'cross_rate_refund_allocation_ambiguous'
    )
  ),
  'false:1',
  'ambiguous refund attribution fails closed with one explicit blocker'
);

reset role;
update public.compensation_rules
set commission_basis_points = 500
where id = 'a8000000-0000-0000-0000-000000000006';

update public.sales_adjustment_facts
set amount_cents = 4000
where id = 'a9200000-0000-0000-0000-000000000002';

update public.payout_period_machine_revenue_snapshots
set refund_adjustment_cents = 4000,
    net_revenue_cents = 1000,
    eligible_commission_revenue_cents = 1000
where id = 'aa000000-0000-0000-0000-000000000002';

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-000000000003', true);

select is(
  concat(
    jsonb_array_length(public.get_technician_pay_report_context('2026-07-01') #> '{technicians,1,machines,0,commissionSegments}'), ':',
    public.get_technician_pay_report_context('2026-07-01') #>> '{technicians,1,machines,0,commissionSegments,0,segmentStartDate}', ':',
    public.get_technician_pay_report_context('2026-07-01') #>> '{technicians,1,machines,0,commissionSegments,0,segmentEndDate}', ':',
    public.get_technician_pay_report_context('2026-07-01') #>> '{technicians,1,machines,0,commissionSegments,0,grossSalesCents}', ':',
    public.get_technician_pay_report_context('2026-07-01') #>> '{technicians,1,machines,0,commissionSegments,0,refundAdjustmentCents}', ':',
    public.get_technician_pay_report_context('2026-07-01') #>> '{technicians,1,machines,0,commissionSegments,0,netRevenueCents}', ':',
    public.get_technician_pay_report_context('2026-07-01') #>> '{technicians,1,machines,0,commissionSegments,0,commissionableSalesCents}', ':',
    public.get_technician_pay_report_context('2026-07-01') #>> '{technicians,1,machines,0,commissionSegments,0,commissionEarningsCents}'
  ),
  '1:2026-07-16:2026-07-31:5000:4000:1000:1000:50',
  'same-rate date islands collapse to one once-capped and once-rounded equation'
);
select is(
  concat(
    public.get_technician_pay_report_context('2026-07-01') #>> '{technicians,1,machines,0,commissionAllocationResolved}', ':',
    public.get_technician_pay_report_context('2026-07-01') #>> '{technicians,1,machines,0,commissionableSalesCents}', ':',
    public.get_technician_pay_report_context('2026-07-01') #>> '{technicians,1,machines,0,commissionEarningsCents}', ':',
    public.get_technician_pay_report_context('2026-07-01') #>> '{technicians,1,publishable}'
  ),
  'true:1000:50:true',
  'the collapsed same-rate equation reconciles exactly to its publishable machine total'
);

select is(
  concat(
    public.get_technician_pay_report_context('2026-07-01') #>> '{capabilities,approvalRequired}', ':',
    public.get_technician_pay_report_context('2026-07-01') #>> '{capabilities,paymentExecution}', ':',
    public.get_technician_pay_report_context('2026-07-01') #>> '{capabilities,taxCalculation}'
  ),
  'false:false:false',
  'the pay report exposes no approval, payment, or tax execution capability'
);

select set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-000000000002', true);
-- Static validator marker: manager correction accepts historical time after later assignment revocation without a reason.
select is(
  public.manager_correct_operator_time_entry(
      'a9000000-0000-0000-0000-000000000001',
      'a4000000-0000-0000-0000-000000000001',
      '2026-08-01 15:00:00+00',
      '2026-08-01 16:02:00+00',
      null,
      false
    ) #>> '{timeEntry,workDate}',
  '2026-08-01',
  'manager correction returns the corrected local work date after later assignment revocation'
);

reset role;
select is(
  (
    select entry.work_date::text
    from public.time_entries entry
    where entry.id = 'a9000000-0000-0000-0000-000000000001'
  ),
  '2026-08-01',
  'manager correction persists the corrected local work date'
);
select is(
  (
    select count(*)::integer
    from public.time_entry_change_events
    where time_entry_id = 'a9000000-0000-0000-0000-000000000001'
      and change_kind = 'manager_corrected'
  ),
  1,
  'manager correction retains audited before and after evidence'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-000000000003', true);
select is(
  (
    select entry.value ->> 'shiftRateCents'
    from jsonb_array_elements(
      public.get_technician_pay_report_context('2026-08-01') #> '{technicians,0,entries}'
    ) entry(value)
    where entry.value ->> 'id' = 'a9000000-0000-0000-0000-000000000001'
  ),
  '3000',
  'the corrected work date applies its newly effective shift rate'
);

select is(
  concat(
    jsonb_array_length(public.get_timekeeping_setup_context()->'accounts'), ':',
    jsonb_array_length(public.get_timekeeping_setup_context() #> '{accounts,0,machines}')
  ),
  '1:2',
  'Timekeeping setup lists only the owner-authorized active account and machines'
);
select is(
  public.admin_setup_timekeeping_technician(
    'pilot-setup-tech@example.test',
    'a2000000-0000-0000-0000-000000000001',
    'Pilot Setup Technician',
    'contractor_1099',
    'PILOT-001',
    array[
      'a4000000-0000-0000-0000-000000000001'::uuid,
      'a4000000-0000-0000-0000-000000000002'::uuid
    ],
    2000,
    700,
    '2026-09-08'
  ) #>> '{machineCount}',
  '2',
  'one manager action creates the complete initial Timekeeping setup'
);
select is(
  (
    select concat(profile.display_name, ':', profile.worker_type, ':', profile.worker_identifier, ':', profile.position_title)
    from public.operator_payout_profiles profile
    where profile.user_id = 'a1000000-0000-0000-0000-000000000006'
  ),
  'Pilot Setup Technician:contractor_1099:PILOT-001:Technician',
  'initial setup records the Technician identity and editable worker classification'
);
select is(
  (
    select concat(
      count(*), ':', min(assignment.effective_start_date), ':',
      count(*) filter (where assignment.effective_end_date is null)
    )
    from public.operator_machine_assignments assignment
    join public.operator_payout_profiles profile on profile.id = assignment.operator_profile_id
    where profile.user_id = 'a1000000-0000-0000-0000-000000000006'
  ),
  '2:2026-09-08:2',
  'initial setup creates both open-ended machine assignments on the chosen date'
);
select is(
  (
    select concat(
      max(rule.shift_rate_cents) filter (where rule.shift_rate_cents is not null), ':',
      max(rule.commission_basis_points) filter (where rule.commission_basis_points is not null)
    )
    from public.compensation_rules rule
    join public.operator_payout_profiles profile on profile.id = rule.operator_profile_id
    where profile.user_id = 'a1000000-0000-0000-0000-000000000006'
  ),
  '2000:700',
  'initial setup creates the starting per-shift and default commission rates'
);
select is(
  (
    select count(*)::integer
    from public.admin_audit_log audit
    where audit.action = 'timekeeping_technician.setup_completed'
      and audit.target_user_id = 'a1000000-0000-0000-0000-000000000006'
  ),
  1,
  'initial setup leaves one explicit completion audit record'
);
select is(
  pg_temp.capture_error($$
    select public.admin_setup_timekeeping_technician(
      'pilot-setup-tech@example.test',
      'a2000000-0000-0000-0000-000000000001',
      'Pilot Setup Technician',
      'contractor_1099',
      'PILOT-001',
      array['a4000000-0000-0000-0000-000000000001'::uuid],
      2000,
      700,
      '2026-09-08'
    )
  $$),
  'Technician already has Timekeeping setup for this account',
  'repeating initial setup fails closed instead of creating overlapping records'
);
select is(
  (
    select concat(
      count(distinct profile.id), ':',
      count(distinct assignment.id), ':',
      count(distinct rule.id)
    )
    from public.operator_payout_profiles profile
    left join public.operator_machine_assignments assignment on assignment.operator_profile_id = profile.id
    left join public.compensation_rules rule on rule.operator_profile_id = profile.id
    where profile.user_id = 'a1000000-0000-0000-0000-000000000006'
  ),
  '1:2:2',
  'a rejected repeat leaves one profile, two assignments, and two rates'
);

select set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-000000000004', true);
select is(
  pg_temp.capture_error($$select public.get_timekeeping_setup_context()$$),
  'Account pay authority required',
  'a user without account pay authority cannot read Timekeeping setup choices'
);

select is(
  public.get_my_time_review_context('2026-07-01')->>'hasAccess',
  'false',
  'an outsider has no Time Report machine scope'
);
select is(
  jsonb_array_length(public.get_my_time_review_context('2026-07-01')->'entries'),
  0,
  'an outsider cannot see any time entries'
);

select * from finish();
rollback;
