begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(45);

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
  ('00000000-0000-0000-0000-000000000000', 'a1000000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'pay-report-outsider@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now());

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
values (
  'a4000000-0000-0000-0000-000000000001',
  'a2000000-0000-0000-0000-000000000001',
  'a3000000-0000-0000-0000-000000000001',
  'Manager Report Machine'
);

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
values (
  'a6000000-0000-0000-0000-000000000001',
  'a2000000-0000-0000-0000-000000000001',
  'a1000000-0000-0000-0000-000000000001',
  'Report Technician',
  'contractor_1099',
  'a5000000-0000-0000-0000-000000000001',
  'TECH-001',
  'Technician'
);

insert into public.operator_machine_assignments (
  id, operator_profile_id, account_id, reporting_machine_id,
  effective_start_date, effective_end_date, grant_reason
)
values (
  'a6100000-0000-0000-0000-000000000001',
  'a6000000-0000-0000-0000-000000000001',
  'a2000000-0000-0000-0000-000000000001',
  'a4000000-0000-0000-0000-000000000001',
  '2026-01-01',
  '2026-12-31',
  'Manager report assignment fixture'
);

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
  commission_basis_points, effective_start_date, status
)
values (
  'a8000000-0000-0000-0000-000000000003',
  'a2000000-0000-0000-0000-000000000001',
  'a6000000-0000-0000-0000-000000000001',
  null,
  1000,
  '2026-01-01',
  'active'
);

insert into public.compensation_rules (
  id, account_id, operator_profile_id, reporting_machine_id,
  commission_basis_points, effective_start_date, status
)
values (
  'a8000000-0000-0000-0000-000000000004',
  'a2000000-0000-0000-0000-000000000001',
  'a6000000-0000-0000-0000-000000000001',
  'a4000000-0000-0000-0000-000000000001',
  1200,
  '2026-08-01',
  'active'
);

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

insert into public.payout_period_machine_revenue_snapshots (
  id, account_id, payout_period_id, reporting_machine_id, reporting_location_id,
  period_start_date, period_end_date, gross_sales_cents, refund_adjustment_cents,
  net_revenue_cents, eligible_commission_revenue_cents, transaction_count,
  source_sales_row_count, source_adjustment_row_count, source_latest_sale_date,
  source_latest_adjustment_date, status, warnings
)
values (
  'aa000000-0000-0000-0000-000000000001',
  'a2000000-0000-0000-0000-000000000001',
  'a7000000-0000-0000-0000-000000000001',
  'a4000000-0000-0000-0000-000000000001',
  'a3000000-0000-0000-0000-000000000001',
  '2026-07-01', '2026-07-31', 10000, 1000, 9000, 9000, 10, 1, 1,
  '2026-07-31', '2026-07-20', 'source_generated', '[]'::jsonb
);

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
  1,
  'the pay report returns the authorized account Technician only'
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
  'Commissionable Sales uses the authoritative net revenue snapshot'
);
select is(
  public.get_technician_pay_report_context('2026-07-01') #>> '{technicians,0,commissionEarningsCents}',
  '900',
  'commission reconciles from Commissionable Sales and the effective rate'
);
select is(
  public.get_technician_pay_report_context('2026-07-01') #>> '{technicians,0,supplyCreditCents}',
  '5000',
  'one effective recurring supply credit is included once'
);
select is(
  public.get_technician_pay_report_context('2026-07-01') #>> '{technicians,0,currentTotalCents}',
  '16400',
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
update public.operator_payout_profiles
set status = 'inactive'
where id = 'a6000000-0000-0000-0000-000000000001';
update public.operator_machine_assignments
set status = 'revoked',
    revoked_at = now()
where id = 'a6100000-0000-0000-0000-000000000001';
select is(
  jsonb_array_length(public.get_technician_pay_report_context('2026-07-01')->'technicians'),
  1,
  'an inactive Technician remains available in a historical monthly report'
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
  '1:1',
  'Commissionable Sales refresh retains historically valid revoked assignments'
);
update public.operator_payout_profiles
set status = 'active'
where id = 'a6000000-0000-0000-0000-000000000001';
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
select is(
  pg_temp.capture_error($$
    select public.manager_correct_operator_time_entry(
      'a9000000-0000-0000-0000-000000000001',
      'a4000000-0000-0000-0000-000000000001',
      '2026-07-05 15:00:00+00',
      '2026-07-05 16:02:00+00',
      null,
      false
    )
  $$),
  null,
  'the existing manager correction RPC still works without a reason'
);

reset role;
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
select set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-000000000004', true);
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
