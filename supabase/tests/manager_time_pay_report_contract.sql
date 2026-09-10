begin;

-- Superseded static marker: Commissionable Sales uses the authoritative net revenue snapshot.
-- The executable assertions below now prove the stricter date-bounded fact basis and
-- reconcile that basis back to the authoritative monthly snapshot.
-- Retained validator markers: an inactive Technician remains available in a historical monthly report.
-- Commissionable Sales refresh retains historically valid revoked assignments.

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(132);

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
  tax_cents, net_revenue_cents, eligible_commission_revenue_cents, transaction_count,
  source_sales_row_count, source_adjustment_row_count, source_latest_sale_date,
  source_latest_adjustment_date, status, warnings
)
values
  ('aa000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000001', 'a7000000-0000-0000-0000-000000000001', 'a4000000-0000-0000-0000-000000000001', 'a3000000-0000-0000-0000-000000000001', '2026-07-01', '2026-07-31', 10000, 1000, 1000, 8000, 8000, 10, 2, 1, '2026-07-31', '2026-07-31', 'source_generated', '[]'::jsonb),
  ('aa000000-0000-0000-0000-000000000002', 'a2000000-0000-0000-0000-000000000001', 'a7000000-0000-0000-0000-000000000001', 'a4000000-0000-0000-0000-000000000002', 'a3000000-0000-0000-0000-000000000001', '2026-07-01', '2026-07-31', 5000, 500, 500, 4000, 4000, 5, 2, 1, '2026-07-31', '2026-07-31', 'source_generated', '[]'::jsonb);

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

insert into public.payout_run_items (
  id, payout_run_id, account_id, operator_profile_id, worker_type,
  raw_minutes, rounded_paid_minutes, shift_count, hourly_pay_cents,
  eligible_net_revenue_cents, commission_pay_cents, total_payout_cents, status
)
values (
  'ac100000-0000-0000-0000-000000000002',
  'ac000000-0000-0000-0000-000000000001',
  'a2000000-0000-0000-0000-000000000001',
  'a6000000-0000-0000-0000-000000000002',
  'contractor_1099',
  0, 0, 0, 0, 0, 0, 0, 'finalized'
);

insert into public.pay_statements (
  id, payout_run_id, payout_run_item_id, account_id, operator_profile_id,
  statement_number, statement_label, status, version, issued_at,
  statement_payload, operator_notification_status
)
values (
  'ac300000-0000-0000-0000-000000000001',
  'ac000000-0000-0000-0000-000000000001',
  'ac100000-0000-0000-0000-000000000002',
  'a2000000-0000-0000-0000-000000000001',
  'a6000000-0000-0000-0000-000000000002',
  'BJ-STUB-202607-PARTIAL-V1', 'Pay Stub', 'issued', 1,
  '2026-08-01 00:00:00+00',
  jsonb_build_object(
    'schemaVersion', 'operator-pay-stub-v2',
    'calculationMeta', jsonb_build_object(
      'paySourceRevision', private.operator_pay_time_source_revision(
        'a6000000-0000-0000-0000-000000000002',
        '2026-07-31'
      )
    )
  ),
  'portal_published'
);

insert into public.payout_periods (
  id, account_id, payout_policy_id, period_start_date, period_end_date,
  submission_due_date, lock_date, target_payout_date, status
)
values (
  'a7000000-0000-0000-0000-000000000002',
  'a2000000-0000-0000-0000-000000000001',
  'a5000000-0000-0000-0000-000000000001',
  '2026-08-01', '2026-08-31', '2026-09-04', '2026-09-04', '2026-09-05', 'issued'
);

insert into public.payout_runs (
  id, account_id, payout_period_id, status
)
values (
  'ac000000-0000-0000-0000-000000000002',
  'a2000000-0000-0000-0000-000000000001',
  'a7000000-0000-0000-0000-000000000002',
  'issued'
);

insert into public.payout_run_items (
  id, payout_run_id, account_id, operator_profile_id, worker_type,
  raw_minutes, rounded_paid_minutes, shift_count, hourly_pay_cents,
  eligible_net_revenue_cents, commission_pay_cents, total_payout_cents, status
)
values (
  'ac100000-0000-0000-0000-000000000003',
  'ac000000-0000-0000-0000-000000000002',
  'a2000000-0000-0000-0000-000000000001',
  'a6000000-0000-0000-0000-000000000002',
  'contractor_1099',
  0, 0, 0, 0, 0, 0, 0, 'finalized'
);

insert into public.pay_statements (
  id, payout_run_id, payout_run_item_id, account_id, operator_profile_id,
  statement_number, statement_label, status, version, issued_at,
  statement_payload, operator_notification_status
)
values (
  'ac300000-0000-0000-0000-000000000002',
  'ac000000-0000-0000-0000-000000000002',
  'ac100000-0000-0000-0000-000000000003',
  'a2000000-0000-0000-0000-000000000001',
  'a6000000-0000-0000-0000-000000000002',
  'BJ-STUB-202608-PARTIAL-V1', 'Pay Stub', 'issued', 1,
  '2026-09-01 00:00:00+00',
  jsonb_build_object(
    'schemaVersion', 'operator-pay-stub-v2',
    'calculationMeta', jsonb_build_object(
      'paySourceRevision', private.operator_pay_time_source_revision(
        'a6000000-0000-0000-0000-000000000002',
        '2026-08-31'
      )
    )
  ),
  'portal_published'
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
  has_function_privilege('authenticated', 'public.get_my_time_review_entry_options(date)', 'execute'),
  'authenticated managers can load machine-scoped missed-time choices'
);
select ok(
  has_function_privilege('authenticated', 'public.manager_create_operator_time_entry(uuid,uuid,timestamptz,timestamptz,text)', 'execute'),
  'authenticated managers can reach the authorization-gated missed-time action'
);
select ok(
  not has_function_privilege('anon', 'public.manager_create_operator_time_entry(uuid,uuid,timestamptz,timestamptz,text)', 'execute'),
  'anonymous callers cannot add missed Technician time'
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
  has_function_privilege('authenticated', 'public.get_current_technician_pay_report_context(date)', 'execute'),
  'authenticated managers can reach the automatically reconciled pay report'
);
select ok(
  not has_function_privilege('anon', 'public.get_current_technician_pay_report_context(date)', 'execute'),
  'anonymous callers cannot reach the automatically reconciled pay report'
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
select has_column(
  'public',
  'time_entry_change_events',
  'source_revision',
  'audited time changes carry a durable Pay Stub source revision'
);
select col_not_null(
  'public',
  'time_entry_change_events',
  'source_revision',
  'every audited time change must receive a source revision'
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
  pg_temp.capture_error($$select public.get_current_technician_pay_report_context('2026-07-01')$$),
  'Account pay authority required',
  'machine-only Time Report authority cannot reconcile or read pay data'
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
  '8000',
  'Commissionable Sales uses authoritative date-bounded sales, refund, and tax facts'
);
select is(
  public.get_technician_pay_report_context('2026-07-01') #>> '{technicians,0,commissionEarningsCents}',
  '1240',
  'commission reconciles from two effective-rate date segments'
);
select is(
  public.get_technician_pay_report_context('2026-07-01') #>> '{technicians,0,supplyCreditCents}',
  '5000',
  'one effective recurring supply credit is included once'
);
select is(
  public.get_technician_pay_report_context('2026-07-01') #>> '{technicians,0,currentTotalCents}',
  '16740',
  'current total includes shifts, commission, and supply credit without deducting refunds twice'
);
select is(
  concat(
    public.get_technician_pay_report_context('2026-07-01') #>> '{technicians,0,machines,0,refundAdjustmentCents}', ':',
    public.get_technician_pay_report_context('2026-07-01') #>> '{technicians,0,machines,0,taxCents}'
  ),
  '1000:1000',
  'the source refund and effective-date tax remain visible in the machine calculation'
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
  '1000:3600:2000:4400',
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
  '2026-07-01:2026-07-15:360:2026-07-16:2026-07-31:880',
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
  '500:1800:1000:2200',
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
  '2026-07-16:2026-07-23:90:2026-07-24:2026-07-31:220',
  'partial assignment segments expose exact date windows and earnings'
);
select is(
  public.get_technician_pay_report_context('2026-07-01') #>> '{technicians,1,commissionableSalesCents}',
  '4000',
  'partial assignment totals only its in-window Commissionable Sales'
);
select is(
  public.get_technician_pay_report_context('2026-07-01') #>> '{technicians,1,commissionEarningsCents}',
  '310',
  'partial assignment commission reconciles across its two rates'
);

reset role;
update public.sales_adjustment_facts
set amount_cents = 8000
where id = 'a9200000-0000-0000-0000-000000000001';

update public.payout_period_machine_revenue_snapshots
set refund_adjustment_cents = 8000,
    tax_cents = 1000,
    net_revenue_cents = 1000,
    eligible_commission_revenue_cents = 1000
where id = 'aa000000-0000-0000-0000-000000000001';

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-000000000003', true);

select is(
  concat(
    public.get_technician_pay_report_context('2026-07-01') #>> '{technicians,0,machines,0,snapshotMatchesFacts}', ':',
    public.get_technician_pay_report_context('2026-07-01') #>> '{technicians,0,machines,0,commissionableSalesCents}'
  ),
  'true:1000',
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
    tax_cents = 500,
    net_revenue_cents = 500,
    eligible_commission_revenue_cents = 500
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
  '1:2026-07-16:2026-07-31:5000:4000:500:500:25',
  'same-rate date islands collapse to one once-capped and once-rounded equation'
);
select is(
  concat(
    public.get_technician_pay_report_context('2026-07-01') #>> '{technicians,1,machines,0,commissionAllocationResolved}', ':',
    public.get_technician_pay_report_context('2026-07-01') #>> '{technicians,1,machines,0,commissionableSalesCents}', ':',
    public.get_technician_pay_report_context('2026-07-01') #>> '{technicians,1,machines,0,commissionEarningsCents}', ':',
    public.get_technician_pay_report_context('2026-07-01') #>> '{technicians,1,publishable}'
  ),
  'true:500:25:true',
  'the collapsed same-rate equation reconciles exactly to its publishable machine total'
);

select is(
  concat(
    public.get_technician_pay_report_context('2026-07-01') #>> '{capabilities,approvalRequired}', ':',
    public.get_technician_pay_report_context('2026-07-01') #>> '{capabilities,paymentExecution}', ':',
    public.get_technician_pay_report_context('2026-07-01') #>> '{capabilities,taxCalculation}'
  ),
  'false:false:true',
  'the pay report calculates tax without exposing approval or payment execution capability'
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
select set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-000000000002', true);
reset role;
update public.operator_payout_profiles
set status = 'inactive'
where id = 'a6000000-0000-0000-0000-000000000002';
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-000000000002', true);
select is(
  jsonb_array_length(public.get_my_time_review_entry_options('2026-07-01')),
  2,
  'manager entry choices include an inactive historically assigned Technician with no submitted time'
);
select is(
  public.manager_create_operator_time_entry(
    'a6000000-0000-0000-0000-000000000002',
    'a4000000-0000-0000-0000-000000000002',
    '2026-07-30 15:00:00+00',
    '2026-07-30 16:01:00+00',
    null
  ) #>> '{afterTechnicianCutoff}',
  'true',
  'a manager can add entirely missing time after the Technician cutoff without exposing pay-stub state'
);
select is(
  (
    select concat(entry.raw_duration_minutes, ':', entry.paid_shift_count, ':', entry.status)
    from public.time_entries entry
    where entry.operator_profile_id = 'a6000000-0000-0000-0000-000000000002'
      and entry.work_date = '2026-07-30'
  ),
  '61:2:submitted',
  'manager-created late time uses the canonical per-entry shift calculation'
);
select is(
  pg_temp.capture_error($$
    select public.manager_create_operator_time_entry(
      'a6000000-0000-0000-0000-000000000002',
      'a4000000-0000-0000-0000-000000000002',
      '2099-07-30 15:00:00+00',
      '2099-07-30 16:00:00+00',
      null
    )
  $$),
  'Time can be entered only after the work is completed',
  'future manager-created time is rejected'
);
select is(
  pg_temp.capture_error($$
    select public.manager_create_operator_time_entry(
      'a6000000-0000-0000-0000-000000000002',
      'a4000000-0000-0000-0000-000000000002',
      '2026-07-10 15:00:00+00',
      '2026-07-10 16:00:00+00',
      null
    )
  $$),
  'Technician is not assigned to this machine for the work date',
  'manager-created time outside the effective assignment is rejected'
);
select is(
  pg_temp.capture_error($$
    select public.manager_create_operator_time_entry(
      'a6000000-0000-0000-0000-000000000002',
      'a4000000-0000-0000-0000-000000000002',
      '2026-07-30 15:30:00+00',
      '2026-07-30 16:30:00+00',
      null
    )
  $$),
  'Time entry overlaps another Technician entry',
  'overlapping manager-created time is rejected'
);

reset role;
select is(
  (
    select count(*)::integer
    from public.time_entry_change_events event
    join public.time_entries entry on entry.id = event.time_entry_id
    where entry.operator_profile_id = 'a6000000-0000-0000-0000-000000000002'
      and entry.work_date = '2026-07-30'
      and event.change_kind = 'manager_created'
  ),
  1,
  'manager-created missed time retains an audit trail'
);
select is(
  (
    select count(*)::integer
    from public.admin_audit_log audit
    where audit.action = 'operator_time_entry.manager_created'
      and audit.target_user_id = 'a1000000-0000-0000-0000-000000000005'
  ),
  1,
  'manager-created missed time records the responsible manager action'
);
select is(
  (
    select concat(audit.actor_user_id, ':', audit.created_at is not null)
    from public.admin_audit_log audit
    where audit.action = 'operator_time_entry.manager_created'
    order by audit.created_at desc
    limit 1
  ),
  'a1000000-0000-0000-0000-000000000002:t',
  'manager-created missed time audit records the responsible actor and timestamp'
);
select ok(
  (
    select event.source_revision > 0
    from public.time_entry_change_events event
    join public.time_entries entry on entry.id = event.time_entry_id
    where entry.operator_profile_id = 'a6000000-0000-0000-0000-000000000002'
      and entry.work_date = '2026-07-30'
      and event.change_kind = 'manager_created'
    limit 1
  ),
  'the committed missed-time change receives a monotonic source revision'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-000000000003', true);
select is(
  public.get_technician_pay_report_context('2026-07-01')
    #>> '{technicians,1,payStubRegenerationRequired}',
  'true',
  'Pay Reports persistently flags the stale published Pay Stub until regeneration'
);

reset role;
select ok(
  private.operator_pay_stub_regeneration_required(
    'a6000000-0000-0000-0000-000000000002',
    '2026-08-01',
    '2026-08-31'
  ),
  'a July time change also marks the later issued August YTD Pay Stub stale'
);

update public.pay_statements statement
set
  statement_payload = statement.statement_payload || jsonb_build_object(
    'calculationMeta',
    coalesce(statement.statement_payload -> 'calculationMeta', '{}'::jsonb)
      || jsonb_build_object(
        'paySourceRevision',
        private.operator_pay_time_source_revision(
          statement.operator_profile_id,
          '2026-07-31'
        )
      )
  ),
  statement_generated_at = clock_timestamp()
where statement.id = 'ac300000-0000-0000-0000-000000000001';

select ok(
  not private.operator_pay_stub_regeneration_required(
    'a6000000-0000-0000-0000-000000000002',
    '2026-07-01',
    '2026-07-31'
  ),
  'a regenerated July statement clears only its proven current source revision'
);
select ok(
  private.operator_pay_stub_regeneration_required(
    'a6000000-0000-0000-0000-000000000002',
    '2026-08-01',
    '2026-08-31'
  ),
  'regenerating July does not prematurely clear the later August YTD warning'
);

update public.pay_statements statement
set
  statement_payload = statement.statement_payload || jsonb_build_object(
    'calculationMeta',
    coalesce(statement.statement_payload -> 'calculationMeta', '{}'::jsonb)
      || jsonb_build_object(
        'paySourceRevision',
        private.operator_pay_time_source_revision(
          statement.operator_profile_id,
          '2026-08-31'
        )
      )
  ),
  statement_generated_at = clock_timestamp()
where statement.id = 'ac300000-0000-0000-0000-000000000002';

select ok(
  not private.operator_pay_stub_regeneration_required(
    'a6000000-0000-0000-0000-000000000002',
    '2026-08-01',
    '2026-08-31'
  ),
  'the later YTD warning clears only after August records the current source revision'
);

insert into public.payout_periods (
  id, account_id, payout_policy_id, period_start_date, period_end_date,
  submission_due_date, lock_date, target_payout_date, status
)
values (
  'a7000000-0000-0000-0000-000000000003',
  'a2000000-0000-0000-0000-000000000001',
  'a5000000-0000-0000-0000-000000000001',
  '2026-09-01', '2026-09-30', '2026-10-04', '2026-10-04', '2026-10-05', 'voided'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-000000000002', true);
select is(
  pg_temp.capture_error($$
    select public.manager_create_operator_time_entry(
      'a6000000-0000-0000-0000-000000000001',
      'a4000000-0000-0000-0000-000000000001',
      '2026-09-01 15:00:00+00',
      '2026-09-01 16:00:00+00',
      null
    )
  $$),
  'Voided pay periods cannot accept time changes',
  'manager-created time is rejected when its payout period is voided'
);

reset role;
select is(
  (
    select count(*)::integer
    from public.time_entries entry
    where entry.operator_profile_id = 'a6000000-0000-0000-0000-000000000001'
      and entry.work_date = '2026-09-01'
  ),
  0,
  'a rejected voided-period write creates no time entry'
);
select is(
  (
    select count(*)::integer
    from public.admin_audit_log audit
    where audit.action = 'operator_time_entry.manager_created'
      and audit.after ->> 'work_date' = '2026-09-01'
  ),
  0,
  'a rejected voided-period write creates no manager audit record'
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

-- Audit rows are intentionally not directly selectable by an account pay
-- manager, so inspect the fixture as the privileged test role.
reset role;
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

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-000000000003', true);
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

reset role;
insert into public.admin_roles (user_id, role, active)
values ('a1000000-0000-0000-0000-000000000003', 'super_admin', true);
insert into public.customer_accounts (id, name, account_type)
values ('a2000000-0000-0000-0000-000000000002', 'Second payer account', 'customer');
insert into public.reporting_locations (id, account_id, name)
values ('a3000000-0000-0000-0000-000000000002', 'a2000000-0000-0000-0000-000000000002', 'Second payer location');
insert into public.reporting_machines (id, account_id, location_id, machine_label)
values ('a4000000-0000-0000-0000-000000000003', 'a2000000-0000-0000-0000-000000000002', 'a3000000-0000-0000-0000-000000000002', 'Second Payer Machine');
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-000000000003', true);

select is(
  (
    select concat(result ->> 'machineCount', ':', result ->> 'payerCount')
    from (
      select public.admin_setup_timekeeping_technician_arrangements(
      'arrangement-setup-tech@example.test',
      'Arrangement Setup Technician',
      'contractor_1099',
      'ARR-001',
      '2026-09-08',
      jsonb_build_array(
        jsonb_build_object(
          'machineId', 'a4000000-0000-0000-0000-000000000001',
          'shiftRateCents', 2500,
          'commissionBasisPoints', 300,
          'commissionEffectiveStartDate', '2026-09-08'
        ),
        jsonb_build_object(
          'machineId', 'a4000000-0000-0000-0000-000000000002',
          'shiftRateCents', 3500,
          'commissionBasisPoints', 300,
          'commissionEffectiveStartDate', '2026-12-08'
        ),
        jsonb_build_object(
          'machineId', 'a4000000-0000-0000-0000-000000000003',
          'shiftRateCents', 2500,
          'commissionBasisPoints', 300,
          'commissionEffectiveStartDate', '2026-09-08'
        )
      )) as result
    ) setup
  ),
  '3:2',
  'one simple setup creates machine arrangements across two payers'
);
select is(
  (
    select count(*)::integer
    from public.operator_payout_profiles profile
    where profile.user_id = 'a1000000-0000-0000-0000-000000000007'
  ),
  2,
  'arrangement setup creates one profile for each selected payer'
);
select is(
  (
    select count(*)::integer
    from public.operator_machine_assignments assignment
    join public.operator_payout_profiles profile on profile.id = assignment.operator_profile_id
    where profile.user_id = 'a1000000-0000-0000-0000-000000000007'
  ),
  3,
  'arrangement setup assigns every selected machine'
);
select is(
  (
    select string_agg(concat(rule.reporting_machine_id, ':', rule.shift_rate_cents), ',' order by rule.reporting_machine_id)
    from public.compensation_rules rule
    join public.operator_payout_profiles profile on profile.id = rule.operator_profile_id
    where profile.user_id = 'a1000000-0000-0000-0000-000000000007'
      and rule.shift_rate_cents is not null
  ),
  'a4000000-0000-0000-0000-000000000001:2500,a4000000-0000-0000-0000-000000000002:3500,a4000000-0000-0000-0000-000000000003:2500',
  'arrangement setup stores a distinct started-hour rate for each machine'
);
select is(
  (
    select count(*)::integer
    from public.compensation_rules rule
    join public.operator_payout_profiles profile on profile.id = rule.operator_profile_id
    where profile.user_id = 'a1000000-0000-0000-0000-000000000007'
      and rule.commission_basis_points is not null
  ),
  4,
  'a delayed commission creates a zero-rate waiting window and future rate'
);
reset role;
select is(
  concat(
    public.operator_compensation_rate_at(
      'a2000000-0000-0000-0000-000000000001',
      (select id from public.operator_payout_profiles where user_id = 'a1000000-0000-0000-0000-000000000007' and account_id = 'a2000000-0000-0000-0000-000000000001'),
      'a4000000-0000-0000-0000-000000000002', '2026-10-01', 'commission'
    ) ->> 'commissionBasisPoints',
    ':',
    public.operator_compensation_rate_at(
      'a2000000-0000-0000-0000-000000000001',
      (select id from public.operator_payout_profiles where user_id = 'a1000000-0000-0000-0000-000000000007' and account_id = 'a2000000-0000-0000-0000-000000000001'),
      'a4000000-0000-0000-0000-000000000002', '2026-12-08', 'commission'
    ) ->> 'commissionBasisPoints'
  ),
  '0:300',
  'after-three-months commission resolves to zero before its start and three percent on its start'
);
select is(
  (
    select count(*)::integer from public.admin_audit_log audit
    where audit.action = 'timekeeping_technician.arrangements_setup_completed'
      and audit.target_user_id = 'a1000000-0000-0000-0000-000000000007'
  ),
  1,
  'arrangement setup records one summary audit event'
);
select is(
  jsonb_array_length(
    private.calculate_technician_pay_report(
      'a2000000-0000-0000-0000-000000000001',
      'a6000000-0000-0000-0000-000000000001',
      '2026-07-01', '2026-07-31'
    ) -> 'shiftRateLines'
  ) > 0,
  true,
  'pay report retains machine-aware started-hour rate lines for Pay Stub detail'
);

set local role authenticated;
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
select is(
  jsonb_array_length(public.get_my_time_review_entry_options('2026-07-01')),
  0,
  'an outsider cannot see Technician choices for managed machines'
);
select is(
  pg_temp.capture_error($$
    select public.manager_create_operator_time_entry(
      'a6000000-0000-0000-0000-000000000002',
      'a4000000-0000-0000-0000-000000000002',
      '2026-07-29 15:00:00+00',
      '2026-07-29 16:00:00+00',
      null
    )
  $$),
  'Machine manager access required',
  'an outsider cannot add missed time for a managed machine'
);

-- Publication must recheck the time-source watermark after PDF rendering.
-- This proves a failed completion leaves the earlier issued statement current
-- and stale, while a subsequent fresh completion clears the warning.
reset role;
insert into public.pay_statements (
  id, payout_run_id, payout_run_item_id, account_id, operator_profile_id,
  statement_number, statement_label, status, version,
  revised_from_statement_id, statement_payload, statement_generated_at,
  operator_notification_status
)
values (
  'ac300000-0000-0000-0000-000000000003',
  'ac000000-0000-0000-0000-000000000002',
  'ac100000-0000-0000-0000-000000000003',
  'a2000000-0000-0000-0000-000000000001',
  'a6000000-0000-0000-0000-000000000002',
  'BJ-STUB-202608-PARTIAL-V2-STALE', 'Pay Stub', 'draft', 2,
  'ac300000-0000-0000-0000-000000000002',
  jsonb_build_object(
    'schemaVersion', 'operator-pay-stub-v2',
    'calculationMeta', jsonb_build_object(
      'paySourceRevision', private.operator_pay_time_source_revision(
        'a6000000-0000-0000-0000-000000000002',
        '2026-08-31'
      )
    )
  ),
  now(), 'not_sent'
);
insert into public.pay_stub_generation_requests (
  id, account_id, operator_profile_id, payout_period_id, trigger_kind,
  status, requested_by, pay_statement_id, attempt_count, started_at
)
values (
  'ad000000-0000-0000-0000-000000000001',
  'a2000000-0000-0000-0000-000000000001',
  'a6000000-0000-0000-0000-000000000002',
  'a7000000-0000-0000-0000-000000000002',
  'manager_regeneration', 'processing',
  'a1000000-0000-0000-0000-000000000003',
  'ac300000-0000-0000-0000-000000000003', 1, now()
);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-000000000002', true);
select public.manager_create_operator_time_entry(
  'a6000000-0000-0000-0000-000000000002',
  'a4000000-0000-0000-0000-000000000002',
  '2026-07-29 17:00:00+00',
  '2026-07-29 18:00:00+00',
  null
);

reset role;
select is(
  pg_temp.capture_error($$
    select public.service_complete_pay_stub(
      'ad000000-0000-0000-0000-000000000001',
      'ac300000-0000-0000-0000-000000000003',
      'test/stale.pdf'
    )
  $$),
  'Pay Stub source changed during generation; retry required',
  'Pay Stub publication rejects a time change committed after preparation'
);
select is(
  (select status from public.pay_statements where id = 'ac300000-0000-0000-0000-000000000002'),
  'issued',
  'failed stale publication leaves the prior issued Pay Stub current'
);
select public.service_fail_pay_stub(
  'ad000000-0000-0000-0000-000000000001',
  'Pay Stub source changed during generation; retry required'
);
select is(
  (select status from public.pay_stub_generation_requests where id = 'ad000000-0000-0000-0000-000000000001'),
  'failed',
  'the failed regeneration request remains recorded as failed'
);
select ok(
  private.operator_pay_stub_regeneration_required(
    'a6000000-0000-0000-0000-000000000002',
    '2026-08-01', '2026-08-31'
  ),
  'a failed regeneration leaves the later Pay Stub stale'
);

delete from public.pay_statements
where id = 'ac300000-0000-0000-0000-000000000003';

insert into public.pay_statements (
  id, payout_run_id, payout_run_item_id, account_id, operator_profile_id,
  statement_number, statement_label, status, version,
  revised_from_statement_id, statement_payload, statement_generated_at,
  operator_notification_status
)
values (
  'ac300000-0000-0000-0000-000000000004',
  'ac000000-0000-0000-0000-000000000002',
  'ac100000-0000-0000-0000-000000000003',
  'a2000000-0000-0000-0000-000000000001',
  'a6000000-0000-0000-0000-000000000002',
  'BJ-STUB-202608-PARTIAL-V2-FRESH', 'Pay Stub', 'draft', 2,
  'ac300000-0000-0000-0000-000000000002',
  jsonb_build_object(
    'schemaVersion', 'operator-pay-stub-v2',
    'calculationMeta', jsonb_build_object(
      'paySourceRevision', private.operator_pay_time_source_revision(
        'a6000000-0000-0000-0000-000000000002',
        '2026-08-31'
      )
    )
  ),
  now(), 'not_sent'
);
insert into public.pay_stub_generation_requests (
  id, account_id, operator_profile_id, payout_period_id, trigger_kind,
  status, requested_by, pay_statement_id, attempt_count, started_at
)
values (
  'ad000000-0000-0000-0000-000000000002',
  'a2000000-0000-0000-0000-000000000001',
  'a6000000-0000-0000-0000-000000000002',
  'a7000000-0000-0000-0000-000000000002',
  'manager_regeneration', 'processing',
  'a1000000-0000-0000-0000-000000000003',
  'ac300000-0000-0000-0000-000000000004', 1, now()
);

select is(
  public.service_complete_pay_stub(
    'ad000000-0000-0000-0000-000000000002',
    'ac300000-0000-0000-0000-000000000004',
    'test/fresh.pdf'
  ) ->> 'status',
  'completed',
  'a Pay Stub with the current source revision publishes successfully'
);
select is(
  (select status from public.pay_statements where id = 'ac300000-0000-0000-0000-000000000004'),
  'issued',
  'successful regeneration publishes the fresh immutable version'
);
select ok(
  not private.operator_pay_stub_regeneration_required(
    'a6000000-0000-0000-0000-000000000002',
    '2026-08-01', '2026-08-31'
  ),
  'successful regeneration clears the later Pay Stub stale state'
);

insert into public.payout_periods (
  id, account_id, payout_policy_id, period_start_date, period_end_date,
  submission_due_date, lock_date, target_payout_date, status
)
values (
  'a7000000-0000-0000-0000-000000000004',
  'a2000000-0000-0000-0000-000000000001',
  'a5000000-0000-0000-0000-000000000001',
  '2026-06-01', '2026-06-30', '2026-07-04', '2026-07-04', '2026-07-05', 'locked'
);
select set_config('app.timekeeping_manager_correction', 'true', true);
insert into public.time_entries (
  id, account_id, operator_profile_id, reporting_machine_id, reporting_location_id,
  payout_policy_id, payout_period_id, work_date, start_time, end_time,
  actual_start_at, actual_end_at, raw_duration_minutes, rounded_paid_minutes,
  paid_shift_count, status
)
values (
  'a9000000-0000-0000-0000-000000000008',
  'a2000000-0000-0000-0000-000000000001',
  'a6000000-0000-0000-0000-000000000001',
  'a4000000-0000-0000-0000-000000000001',
  'a3000000-0000-0000-0000-000000000001',
  'a5000000-0000-0000-0000-000000000001',
  'a7000000-0000-0000-0000-000000000004',
  '2026-06-15', '08:00', '09:00',
  '2026-06-15 15:00:00+00', '2026-06-15 16:00:00+00',
  60, 60, 1, 'submitted'
);
update public.payout_periods
set status = 'voided'
where id = 'a7000000-0000-0000-0000-000000000004';

select is(
  pg_temp.capture_error($$
    update public.time_entries
    set actual_end_at = '2026-06-15 16:30:00+00'
    where id = 'a9000000-0000-0000-0000-000000000008'
  $$),
  'Voided pay periods cannot accept time changes',
  'manager correction cannot edit an existing entry in a voided period'
);
select is(
  (select raw_duration_minutes from public.time_entries where id = 'a9000000-0000-0000-0000-000000000008'),
  60,
  'a rejected voided-period correction leaves the existing entry unchanged'
);

create temporary table pay_source_cross_move_baseline as
select private.operator_pay_time_source_revision(
  'a6000000-0000-0000-0000-000000000002',
  '2026-07-31'
) as source_revision;

insert into public.time_entry_change_events (
  time_entry_id, account_id, operator_profile_id, reporting_machine_id,
  change_kind, before_state, after_state
)
values (
  'a9000000-0000-0000-0000-000000000008',
  'a2000000-0000-0000-0000-000000000001',
  'a6000000-0000-0000-0000-000000000002',
  'a4000000-0000-0000-0000-000000000002',
  'system_changed',
  '{"operator_profile_id":"a6000000-0000-0000-0000-000000000001","work_date":"2026-01-15"}'::jsonb,
  '{"operator_profile_id":"a6000000-0000-0000-0000-000000000002","work_date":"2026-12-15"}'::jsonb
);

select is(
  private.operator_pay_time_source_revision(
    'a6000000-0000-0000-0000-000000000002',
    '2026-07-31'
  ),
  (select source_revision from pay_source_cross_move_baseline),
  'profile and work date stay paired when a time entry moves across both'
);

select has_column(
  'public',
  'customer_accounts',
  'legal_name',
  'Pay Stub payer records expose the optional legal-name field used by statement builders'
);
select is(
  public.operator_pay_statement_payload_for_item(
    'ac100000-0000-0000-0000-000000000001',
    'BJ-PAY-LINT-PREVIEW',
    1,
    'draft',
    null,
    null
  ) ->> 'schemaVersion',
  'operator-pay-statement-v1',
  'the legacy statement payload builder executes against the current account schema'
);

reset role;

with normalized as (
  select private.normalize_technician_pay_report_status(
    jsonb_build_object(
      'blockers', jsonb_build_array(
        jsonb_build_object('code', 'stale_commission_sales_facts', 'severity', 'blocker', 'machineId', 'machine-a'),
        jsonb_build_object('code', 'stale_sales_source', 'severity', 'blocker', 'machineId', 'machine-a')
      ),
      'warnings', '[]'::jsonb,
      'machines', jsonb_build_array(jsonb_build_object(
        'machineId', 'machine-a',
        'sourceLatestSaleDate', '2026-09-09'
      )),
      'currentTotalCents', 7850,
      'publishable', true,
      'calculationMeta', '{}'::jsonb
    ),
    '2026-09-01',
    '2026-09-30',
    '2026-09-10'
  ) as report
)
select is(
  concat(
    jsonb_array_length(report -> 'blockers'), ':',
    report ->> 'publishable', ':',
    report #>> '{warnings,0,code}', ':',
    report #>> '{calculationMeta,salesThroughDate}'
  ),
  '0:false:current_period_sales_through:2026-09-09',
  'an open month removes impossible future freshness blockers and remains non-publishable'
)
from normalized;

with normalized as (
  select private.normalize_technician_pay_report_status(
    jsonb_build_object(
      'blockers', jsonb_build_array(
        jsonb_build_object('code', 'stale_commission_sales_facts', 'severity', 'blocker', 'machineId', 'machine-a'),
        jsonb_build_object('code', 'stale_sales_source', 'severity', 'blocker', 'machineId', 'machine-a')
      ),
      'warnings', '[]'::jsonb,
      'machines', jsonb_build_array(jsonb_build_object(
        'machineId', 'machine-a',
        'sourceLatestSaleDate', '2026-08-30',
        'revenueSnapshotId', 'snapshot-a',
        'snapshotMatchesFacts', true
      )),
      'currentTotalCents', 7850,
      'publishable', false,
      'calculationMeta', '{}'::jsonb
    ),
    '2026-08-01',
    '2026-08-31',
    '2026-09-10'
  ) as report
)
select is(
  concat(
    jsonb_array_length(report -> 'blockers'), ':',
    report ->> 'publishable'
  ),
  '0:true',
  'a closed month accepts a refreshed matching snapshot when the final day had no sales'
)
from normalized;

update public.payout_runs
set status = 'finalized'
where id = 'ac000000-0000-0000-0000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-000000000003', true);

with report as (
  select public.get_technician_pay_report_context('2026-07-01') as payload
), technician as (
  select technician.item
  from report
  cross join lateral jsonb_array_elements(payload -> 'technicians') technician(item)
  where technician.item ->> 'operatorProfileId' = 'a6000000-0000-0000-0000-000000000001'
), assignment as (
  select assignment.item
  from technician
  cross join lateral jsonb_array_elements(technician.item -> 'assignments') assignment(item)
  where assignment.item ->> 'assignmentId' = 'a6100000-0000-0000-0000-000000000001'
)
select is(
  concat(
    item ->> 'assignmentId', ':',
    item ->> 'effectiveStartDate', ':',
    item ->> 'effectiveEndDate', ':',
    item ->> 'overlapsSelectedPeriod', ':',
    item ->> 'selectedPeriodGrossSalesCents'
  ),
  'a6100000-0000-0000-0000-000000000001:2026-01-01:2026-12-31:true:10000',
  'the pay report exposes effective assignment history to an account pay manager'
)
from assignment;

select is(
  (
    select concat(result ->> 'periodCount', ':', result ->> 'snapshotCount')
    from (
      select public.admin_refresh_technician_pay_report_sales(
        '2026-08-01',
        'a2000000-0000-0000-0000-000000000001'
      ) as result
    ) refreshed
  ),
  '1:1',
  'sales refresh creates a missing monthly period after a historical assignment change'
);

select is(
  public.admin_issue_pay_statements(
    'ac000000-0000-0000-0000-000000000001',
    'Synthetic lint regression',
    'Synthetic lint regression'
  ) ->> 'issuedStatementCount',
  '2',
  'legacy statement issuance resolves the existing payload column without ambiguity'
);

-- The manager-facing report creates the first month and snapshot in one request,
-- then remains idempotent until imported facts actually change.
create temporary table automatic_sales_initial_report as
select public.get_current_technician_pay_report_context('2026-10-01') as payload;

select is(
  concat(
    (select count(*)::integer
     from public.payout_periods period
     where period.account_id = 'a2000000-0000-0000-0000-000000000001'
       and period.period_start_date = '2026-10-01'
       and period.period_end_date = '2026-10-31'
       and period.status <> 'voided'), ':',
    payload #>> '{technicians,0,machines,0,snapshotMatchesFacts}'
  ),
  '1:true',
  'one report request creates the missing month and returns a reconciled snapshot'
)
from automatic_sales_initial_report;

create temporary table automatic_sales_first_read as
select count(*)::integer as audit_count
from public.admin_audit_log audit
where audit.action in (
  'operator_payout_revenue_snapshot.created',
  'operator_payout_revenue_snapshot.regenerated'
);

select public.get_current_technician_pay_report_context('2026-10-01');
select is(
  (select count(*)::integer
   from public.admin_audit_log audit
   where audit.action in (
     'operator_payout_revenue_snapshot.created',
     'operator_payout_revenue_snapshot.regenerated'
   )),
  (select audit_count from automatic_sales_first_read),
  'an unchanged second report read does not rewrite the revenue snapshot'
);

reset role;
insert into public.machine_sales_facts (
  id, reporting_machine_id, reporting_location_id, sale_date, payment_method,
  net_sales_cents, transaction_count, source, source_row_hash
)
values (
  'a9100000-0000-0000-0000-000000000005',
  'a4000000-0000-0000-0000-000000000001',
  'a3000000-0000-0000-0000-000000000001',
  '2026-10-05', 'credit', 1000, 1, 'sample_seed', 'manager-report-auto-sale-october'
);

create temporary table automatic_sales_mismatch_baseline as
select count(*)::integer as audit_count
from public.admin_audit_log audit
where audit.action = 'operator_payout_revenue_snapshot.regenerated';

grant select on automatic_sales_mismatch_baseline to authenticated;

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-000000000003', true);
create temporary table automatic_sales_current_report as
select public.get_current_technician_pay_report_context('2026-10-01') as payload;

with technician as (
  select technician.item
  from automatic_sales_current_report report
  cross join lateral jsonb_array_elements(report.payload -> 'technicians') technician(item)
  where technician.item ->> 'operatorProfileId' = 'a6000000-0000-0000-0000-000000000001'
)
select is(
  concat(
    technician.item #>> '{machines,0,snapshotMatchesFacts}', ':',
    technician.item #>> '{machines,0,commissionableSalesCents}'
  ),
  'true:900',
  'a changed imported sale is reconciled before the current report is returned'
)
from technician;

select is(
  (select count(*)::integer
   from public.admin_audit_log audit
   where audit.action = 'operator_payout_revenue_snapshot.regenerated'),
  (select audit_count + 1 from automatic_sales_mismatch_baseline),
  'a fact mismatch performs exactly one audited snapshot regeneration'
);

-- Reconcile a sale after issuance: the published payload remains frozen while
-- the report directs the manager through explicit Pay Stub regeneration.
reset role;
update public.operator_payout_profiles
set status = 'active'
where id = 'a6000000-0000-0000-0000-000000000002';

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-000000000003', true);
create temporary table automatic_sales_statement_baseline as
select statement.id, statement.statement_payload
from public.pay_statements statement
where statement.operator_profile_id = 'a6000000-0000-0000-0000-000000000002'
  and statement.status = 'issued'
order by statement.version desc, statement.created_at desc
limit 1;

reset role;
update public.pay_statements statement
set statement_generated_at = '2026-09-01 00:00:00+00'
where statement.operator_profile_id = 'a6000000-0000-0000-0000-000000000002'
  and statement.status = 'issued'
  and exists (
    select 1
    from public.payout_runs run
    join public.payout_periods period on period.id = run.payout_period_id
    where run.id = statement.payout_run_id
      and period.period_start_date = '2026-07-01'
      and period.period_end_date = '2026-07-31'
  );

reset role;
insert into public.machine_sales_facts (
  id, reporting_machine_id, reporting_location_id, sale_date, payment_method,
  net_sales_cents, transaction_count, source, source_row_hash
)
values (
  'a9100000-0000-0000-0000-000000000006',
  'a4000000-0000-0000-0000-000000000002',
  'a3000000-0000-0000-0000-000000000001',
  '2026-07-25', 'credit', 100, 1, 'sample_seed', 'manager-report-auto-sale-after-statement'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-000000000003', true);
create temporary table automatic_sales_published_report as
select public.get_current_technician_pay_report_context('2026-07-01') as payload;

reset role;
select diag(jsonb_build_object(
  'issuedStatements', (
    select jsonb_agg(jsonb_build_object(
      'id', statement.id,
      'version', statement.version,
      'issuedAt', statement.issued_at,
      'generatedAt', statement.statement_generated_at,
      'sourceRevision', statement.statement_payload #>> '{calculationMeta,paySourceRevision}',
      'periodStart', period.period_start_date,
      'periodEnd', period.period_end_date
    ) order by statement.version desc, statement.issued_at desc nulls last, statement.created_at desc)
    from public.pay_statements statement
    join public.payout_runs run on run.id = statement.payout_run_id
    join public.payout_periods period on period.id = run.payout_period_id
    where statement.operator_profile_id = 'a6000000-0000-0000-0000-000000000002'
      and statement.status = 'issued'
  ),
  'snapshot', (
    select jsonb_build_object(
      'id', snapshot.id,
      'generatedAt', snapshot.generated_at,
      'regeneratedAt', snapshot.regenerated_at
    )
    from public.payout_period_machine_revenue_snapshots snapshot
    where snapshot.payout_period_id = 'a7000000-0000-0000-0000-000000000001'
      and snapshot.reporting_machine_id = 'a4000000-0000-0000-0000-000000000002'
      and snapshot.status <> 'voided'
  ),
  'audit', (
    select jsonb_build_object('action', audit.action, 'createdAt', audit.created_at)
    from public.admin_audit_log audit
    where audit.entity_type = 'payout_period_machine_revenue_snapshot'
      and audit.entity_id = 'aa000000-0000-0000-0000-000000000002'
    order by audit.created_at desc
    limit 1
  ),
  'regenerationRequired', private.operator_pay_stub_regeneration_required(
    'a6000000-0000-0000-0000-000000000002',
    '2026-07-01',
    '2026-07-31'
  ),
  'timeSourceRevision', private.operator_pay_time_source_revision(
    'a6000000-0000-0000-0000-000000000002',
    '2026-07-31'
  ),
  'salesFreshnessExists', exists (
    select 1
    from public.payout_period_machine_revenue_snapshots snapshot
    where snapshot.account_id = 'a2000000-0000-0000-0000-000000000001'
      and snapshot.period_start_date = '2026-07-01'
      and snapshot.period_end_date = '2026-07-31'
      and snapshot.status <> 'voided'
      and snapshot.regenerated_at >= '2026-09-01 00:00:00+00'::timestamptz
      and exists (
        select 1
        from public.operator_machine_assignments assignment
        where assignment.operator_profile_id = 'a6000000-0000-0000-0000-000000000002'
          and assignment.account_id = 'a2000000-0000-0000-0000-000000000001'
          and assignment.reporting_machine_id = snapshot.reporting_machine_id
          and assignment.effective_start_date <= '2026-07-31'
          and coalesce(assignment.effective_end_date, 'infinity'::date) >= '2026-07-01'
      )
  )
)::text);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-000000000003', true);
with technician as (
  select technician.item
  from automatic_sales_published_report report
  cross join lateral jsonb_array_elements(report.payload -> 'technicians') technician(item)
  where technician.item ->> 'operatorProfileId' = 'a6000000-0000-0000-0000-000000000002'
)
select is(
  concat(
    technician.item #>> '{machines,0,snapshotMatchesFacts}', ':',
    technician.item ->> 'payStubRegenerationRequired'
  ),
  'true:true',
  'post-publication sales reconcile while retaining the explicit Pay Stub regeneration safeguard'
)
from technician;

select is(
  (select statement.statement_payload = baseline.statement_payload
   from public.pay_statements statement
   join automatic_sales_statement_baseline baseline on baseline.id = statement.id),
  true,
  'automatic sales reconciliation never mutates the issued Pay Stub payload'
);

select * from finish();
rollback;
