begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
set local timezone = 'America/Los_Angeles';
select no_plan();

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  'ca000000-0000-4000-8000-000000000001',
  'authenticated', 'authenticated', 'consumer-alignment@example.invalid', '', now(),
  '{}'::jsonb, '{}'::jsonb, now(), now()
), (
  '00000000-0000-0000-0000-000000000000',
  'ca000000-0000-4000-8000-000000000002',
  'authenticated', 'authenticated', 'consumer-replacement@example.invalid', '', now(),
  '{}'::jsonb, '{}'::jsonb, now(), now()
), (
  '00000000-0000-0000-0000-000000000000',
  'ca000000-0000-4000-8000-000000000003',
  'authenticated', 'authenticated', 'consumer-no-access@example.invalid', '', now(),
  '{}'::jsonb, '{}'::jsonb, now(), now()
);
insert into public.admin_roles(user_id, role, active)
values ('ca000000-0000-4000-8000-000000000001', 'super_admin', true);

insert into public.customer_accounts(id, name, account_type, status)
values ('ca100000-0000-4000-8000-000000000001', 'Consumer alignment fixture', 'internal', 'active');
insert into public.reporting_locations(id, account_id, name, timezone, status) values
  ('ca200000-0000-4000-8000-000000000001', 'ca100000-0000-4000-8000-000000000001', 'Original location', 'America/Los_Angeles', 'active'),
  ('ca200000-0000-4000-8000-000000000002', 'ca100000-0000-4000-8000-000000000001', 'Replacement location', 'America/New_York', 'active');
insert into public.reporting_machines(id, account_id, location_id, machine_label, machine_type, status) values
  ('ca300000-0000-4000-8000-000000000001', 'ca100000-0000-4000-8000-000000000001', 'ca200000-0000-4000-8000-000000000001', 'Parity machine', 'commercial', 'active'),
  ('ca300000-0000-4000-8000-000000000002', 'ca100000-0000-4000-8000-000000000001', 'ca200000-0000-4000-8000-000000000001', 'Moved machine', 'commercial', 'active'),
  ('ca300000-0000-4000-8000-000000000003', 'ca100000-0000-4000-8000-000000000001', 'ca200000-0000-4000-8000-000000000001', 'Reversal-only machine', 'commercial', 'active'),
  ('ca300000-0000-4000-8000-000000000004', 'ca100000-0000-4000-8000-000000000001', 'ca200000-0000-4000-8000-000000000001', 'Unresolved-basis machine', 'commercial', 'active'),
  ('ca300000-0000-4000-8000-000000000005', 'ca100000-0000-4000-8000-000000000001', 'ca200000-0000-4000-8000-000000000001', 'Prior-month move machine', 'commercial', 'active');
insert into public.reporting_machine_tax_rates(id, machine_id, tax_rate_percent, effective_start_date, status) values
  ('ca310000-0000-4000-8000-000000000001', 'ca300000-0000-4000-8000-000000000001', 10, current_date-30, 'active'),
  ('ca310000-0000-4000-8000-000000000002', 'ca300000-0000-4000-8000-000000000002', 10, current_date-30, 'active'),
  ('ca310000-0000-4000-8000-000000000003', 'ca300000-0000-4000-8000-000000000003', 10, date_trunc('month', current_date)::date-60, 'active'),
  ('ca310000-0000-4000-8000-000000000004', 'ca300000-0000-4000-8000-000000000004', 10, current_date-30, 'active'),
  ('ca310000-0000-4000-8000-000000000005', 'ca300000-0000-4000-8000-000000000005', 10, date_trunc('month', current_date)::date-60, 'active');

insert into public.machine_sales_facts (
  id, reporting_machine_id, reporting_location_id, sale_date, payment_method,
  net_sales_cents, transaction_count, item_quantity, source, source_order_hash,
  source_row_hash, tax_cents, raw_payload
) values
  ('ca400000-0000-4000-8000-000000000001', 'ca300000-0000-4000-8000-000000000001', 'ca200000-0000-4000-8000-000000000001', current_date, 'credit', 11000, 3, 1, 'nayax_scheduled_report', repeat('1',32), repeat('1',64), 0, '{"amountBasis":"gross_customer_charge_minor"}'),
  ('ca400000-0000-4000-8000-000000000002', 'ca300000-0000-4000-8000-000000000001', 'ca200000-0000-4000-8000-000000000001', current_date, 'cash', 2200, 1, 1, 'snapcase_cash', repeat('2',32), repeat('2',64), 0, '{"amountBasis":"gross_customer_charge_minor"}'),
  ('ca400000-0000-4000-8000-000000000003', 'ca300000-0000-4000-8000-000000000001', 'ca200000-0000-4000-8000-000000000001', current_date, 'credit', 3300, 1, 1, 'snapcase_cash', repeat('3',32), repeat('3',64), 0, '{"amountBasis":"gross_customer_charge_minor"}'),
  ('ca400000-0000-4000-8000-000000000004', 'ca300000-0000-4000-8000-000000000001', 'ca200000-0000-4000-8000-000000000001', current_date-1, 'other', 500, 1, 1, 'manual_csv', null, repeat('4',64), 0, '{"amountBasis":"tax_exclusive"}'),
  ('ca400000-0000-4000-8000-000000000005', 'ca300000-0000-4000-8000-000000000004', 'ca200000-0000-4000-8000-000000000001', current_date, 'other', 1000, 1, 1, 'manual_csv', null, repeat('5',64), 0, '{}'),
  ('ca400000-0000-4000-8000-000000000007', 'ca300000-0000-4000-8000-000000000001', 'ca200000-0000-4000-8000-000000000001', current_date, 'credit', 0, 9, 0, 'nayax_scheduled_report', repeat('7',32), repeat('7',64), 0, '{"amountBasis":"gross_customer_charge_minor"}');

select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'ca000000-0000-4000-8000-000000000001', true);
select results_eq($$
  select distinct calculation_version
  from public.get_sales_report(current_date, current_date, 'day')
$$, $$values ('legacy-sales-basis-v0'::text)$$,
  'Interactive report keeps the legacy calculation contract before activation');

select set_config('request.jwt.claim.role', 'service_role', true);
select results_eq($$
  select distinct calculation_version
  from public.sales_report_scheduler_get_sales_report(
    'ca000000-0000-4000-8000-000000000001',
    current_date, current_date, 'day'
  )
$$, $$values ('legacy-sales-basis-v0'::text)$$,
  'Scheduled report keeps the same legacy calculation contract before activation');
select is((
  select count(*)::integer
  from public.sales_report_scheduler_get_sales_report(
    'ca000000-0000-4000-8000-000000000001',
    current_date, current_date, 'day'
  )
), (
  select count(*)::integer
  from public.get_sales_report(current_date, current_date, 'day')
), 'Interactive and scheduled pre-activation report scopes have row parity');
select set_config('request.jwt.claim.role', 'authenticated', true);

create temporary table consumer_activation_result on commit drop as
select * from private.activate_refund_request_recognition('pgTAP #1572 consumers');
insert into public.refund_cases (
  id, public_reference, reporting_machine_id, reporting_location_id,
  customer_email, issue_summary, incident_at, payment_method,
  payment_amount_cents, refund_amount_cents, status,
  customer_request_received_at, customer_request_received_source
) values (
  'ca500000-0000-4000-8000-000000000001', 'RF-CONSUMER-1',
  'ca300000-0000-4000-8000-000000000001', 'ca200000-0000-4000-8000-000000000001',
  'request@example.invalid', 'Parity request', clock_timestamp(), 'card',
  1100, 1100, 'needs_review', clock_timestamp(), 'hosted_refund_intake'
);

insert into public.payout_policies (
  id, account_id, name, frequency, period_anchor_type, monthly_period_type,
  submission_due_offset_days, lock_offset_days, target_payout_offset_days,
  rounding_rule, review_model
) values (
  'ca600000-0000-4000-8000-000000000001', 'ca100000-0000-4000-8000-000000000001',
  'Consumer fixture policy', 'monthly', 'calendar', 'calendar_month', 4, 4, 5,
  'round_up_60_minutes', 'no_review_required'
);
insert into public.payout_periods (
  id, account_id, payout_policy_id, period_start_date, period_end_date,
  submission_due_date, lock_date, target_payout_date, status
) values (
  'ca605000-0000-4000-8000-000000000001',
  'ca100000-0000-4000-8000-000000000001',
  'ca600000-0000-4000-8000-000000000001',
  date_trunc('month', current_date)::date,
  (date_trunc('month', current_date) + interval '1 month - 1 day')::date,
  (date_trunc('month', current_date) + interval '1 month + 3 days')::date,
  (date_trunc('month', current_date) + interval '1 month + 4 days')::date,
  (date_trunc('month', current_date) + interval '1 month + 5 days')::date,
  'open'
);
insert into public.operator_payout_profiles (
  id, account_id, user_id, display_name, worker_type, payout_policy_id
) values
  ('ca610000-0000-4000-8000-000000000001', 'ca100000-0000-4000-8000-000000000001', 'ca000000-0000-4000-8000-000000000001', 'Original Technician', 'contractor_1099', 'ca600000-0000-4000-8000-000000000001'),
  ('ca610000-0000-4000-8000-000000000002', 'ca100000-0000-4000-8000-000000000001', 'ca000000-0000-4000-8000-000000000002', 'Replacement Technician', 'contractor_1099', 'ca600000-0000-4000-8000-000000000001');
insert into public.operator_machine_assignments (
  id, operator_profile_id, account_id, reporting_machine_id,
  effective_start_date, effective_end_date, grant_reason
) values
  ('ca620000-0000-4000-8000-000000000001', 'ca610000-0000-4000-8000-000000000001', 'ca100000-0000-4000-8000-000000000001', 'ca300000-0000-4000-8000-000000000001', current_date-30, null, 'Parity fixture'),
  ('ca620000-0000-4000-8000-000000000002', 'ca610000-0000-4000-8000-000000000001', 'ca100000-0000-4000-8000-000000000001', 'ca300000-0000-4000-8000-000000000002', current_date-30, current_date-1, 'Original attribution fixture'),
  ('ca620000-0000-4000-8000-000000000003', 'ca610000-0000-4000-8000-000000000002', 'ca100000-0000-4000-8000-000000000001', 'ca300000-0000-4000-8000-000000000002', current_date, null, 'Replacement attribution fixture'),
  ('ca620000-0000-4000-8000-000000000004', 'ca610000-0000-4000-8000-000000000001', 'ca100000-0000-4000-8000-000000000001', 'ca300000-0000-4000-8000-000000000004', current_date-30, null, 'Unresolved basis fixture'),
  ('ca620000-0000-4000-8000-000000000005', 'ca610000-0000-4000-8000-000000000001', 'ca100000-0000-4000-8000-000000000001', 'ca300000-0000-4000-8000-000000000005', date_trunc('month', current_date)::date-60, date_trunc('month', current_date)::date-1, 'Prior-month original fixture'),
  ('ca620000-0000-4000-8000-000000000006', 'ca610000-0000-4000-8000-000000000002', 'ca100000-0000-4000-8000-000000000001', 'ca300000-0000-4000-8000-000000000005', date_trunc('month', current_date)::date, null, 'Current-month replacement fixture');
insert into public.compensation_rules (
  id, account_id, operator_profile_id, reporting_machine_id,
  commission_basis_points, effective_start_date, status
) values
  ('ca630000-0000-4000-8000-000000000001', 'ca100000-0000-4000-8000-000000000001', 'ca610000-0000-4000-8000-000000000001', 'ca300000-0000-4000-8000-000000000001', 1000, current_date-30, 'active'),
  ('ca630000-0000-4000-8000-000000000002', 'ca100000-0000-4000-8000-000000000001', 'ca610000-0000-4000-8000-000000000001', 'ca300000-0000-4000-8000-000000000002', 1000, current_date-30, 'active'),
  ('ca630000-0000-4000-8000-000000000003', 'ca100000-0000-4000-8000-000000000001', 'ca610000-0000-4000-8000-000000000002', 'ca300000-0000-4000-8000-000000000002', 2000, current_date, 'active'),
  ('ca630000-0000-4000-8000-000000000004', 'ca100000-0000-4000-8000-000000000001', 'ca610000-0000-4000-8000-000000000001', 'ca300000-0000-4000-8000-000000000004', 1000, current_date-30, 'active'),
  ('ca630000-0000-4000-8000-000000000005', 'ca100000-0000-4000-8000-000000000001', 'ca610000-0000-4000-8000-000000000001', 'ca300000-0000-4000-8000-000000000005', 1000, date_trunc('month', current_date)::date-60, 'active'),
  ('ca630000-0000-4000-8000-000000000006', 'ca100000-0000-4000-8000-000000000001', 'ca610000-0000-4000-8000-000000000002', 'ca300000-0000-4000-8000-000000000005', 2000, date_trunc('month', current_date)::date, 'active');

insert into public.reporting_partnerships (
  id, name, partnership_type, reporting_week_end_day, timezone,
  effective_start_date, status
) values (
  'ca700000-0000-4000-8000-000000000001', 'Consumer partner fixture',
  'revenue_share', 0, 'America/Los_Angeles', current_date-30, 'active'
);
insert into public.reporting_machine_partnership_assignments (
  machine_id, partnership_id, assignment_role, effective_start_date, status
) values (
  'ca300000-0000-4000-8000-000000000001', 'ca700000-0000-4000-8000-000000000001',
  'primary_reporting', current_date-30, 'active'
);
insert into public.reporting_partnership_financial_rules (
  partnership_id, calculation_model, split_base, fee_amount_cents, fee_basis,
  cost_amount_cents, cost_basis, deduction_timing, gross_to_net_method,
  fever_share_basis_points, partner_share_basis_points, bloomjoy_share_basis_points,
  effective_start_date, status
) values (
  'ca700000-0000-4000-8000-000000000001', 'contribution_split',
  'contribution_after_costs', 100, 'per_order', 200, 'per_stick',
  'before_split', 'imported_tax_plus_configured_fees', 0, 10000, 0,
  current_date-30, 'active'
);

insert into public.sales_adjustment_facts (
  id, reporting_machine_id, reporting_location_id, adjustment_date,
  adjustment_type, amount_cents, complaint_count, source, source_row_hash,
  raw_payload, created_at
)
select
  'ca800000-0000-4000-8000-000000000002',
  'ca300000-0000-4000-8000-000000000001',
  'ca200000-0000-4000-8000-000000000001',
  current_date-2, 'refund', 500, 1, 'manual', repeat('9',64),
  '{"payment_method":"card","amountBasis":"tax_exclusive"}',
  rollout.activated_at - interval '1 second'
from private.refund_request_recognition_rollout rollout
where rollout.singleton;

select results_eq($$
  select purchase_attribution_date, legacy_paid_deduction_ex_tax_cents
  from private.machine_sales_daily_components(
    'ca300000-0000-4000-8000-000000000001', current_date-2, current_date-2
  )
  where legacy_paid_deduction_ex_tax_cents <> 0
$$, $$values (null::date,500::bigint)$$,
  'Unlinked legacy paid impact remains visible with unresolved purchase attribution');

select results_eq($$
  select (value ->> 'refundAdjustmentCents')::bigint,
    (value ->> 'legacyPaidDeductionCents')::bigint
  from (select private.operator_machine_tax_snapshot(
    'ca300000-0000-4000-8000-000000000001', current_date-2, current_date-2
  ) value) result
$$, $$values (500::bigint,500::bigint)$$,
  'Machine reporting retains the null-date legacy paid deduction');

select results_eq($$
  select (value ->> 'refundAdjustmentCents')::bigint,
    (value ->> 'commissionEarningsCents')::bigint,
    (value ->> 'commissionRateCompleteForPeriod')::boolean,
    (value ->> 'commissionAllocationResolved')::boolean,
    jsonb_array_length(value -> 'segments')
  from (select private.operator_machine_tax_commission(
    'ca100000-0000-4000-8000-000000000001',
    'ca610000-0000-4000-8000-000000000001',
    'ca300000-0000-4000-8000-000000000001', current_date-2, current_date-2
  ) value) result
$$, $$values (0::bigint,0::bigint,true,true,0)$$,
  'Null-date legacy paid impact is absent from assigned Technician commission');

select results_eq($$
  select (result.value ->> 'grossSalesCents')::bigint,
    (result.value ->> 'refundAdjustmentCents')::bigint,
    (result.value ->> 'commissionableSalesCents')::bigint,
    (result.value ->> 'commissionEarningsCents')::bigint,
    (result.value ->> 'commissionAllocationResolved')::boolean,
    count(*) filter (where segment.value ->> 'purchaseAttributionDate' is null)::integer
  from (select private.operator_machine_tax_commission(
    'ca100000-0000-4000-8000-000000000001',
    'ca610000-0000-4000-8000-000000000001',
    'ca300000-0000-4000-8000-000000000001', current_date-2, current_date
  ) value) result
  cross join lateral jsonb_array_elements(result.value -> 'segments') segment(value)
  group by result.value
$$, $$values (12500::bigint,1000::bigint,11500::bigint,1150::bigint,true,0)$$,
  'Assigned dated sales and request earn commission without the null-date legacy adjustment');

select is((
  select count(*)::integer
  from jsonb_array_elements(private.calculate_technician_pay_report(
    'ca100000-0000-4000-8000-000000000001',
    'ca610000-0000-4000-8000-000000000001',
    date_trunc('month', current_date)::date,
    (date_trunc('month', current_date) + interval '1 month - 1 day')::date
  ) -> 'blockers') blocker(value)
  where blocker.value ->> 'code' = 'cross_rate_refund_allocation_ambiguous'
), 0, 'Null-date adjustment does not create a Technician publication blocker');

insert into public.sales_adjustment_facts (
  id, reporting_machine_id, reporting_location_id, adjustment_date,
  adjustment_type, amount_cents, complaint_count, source, source_row_hash,
  raw_payload, created_at
)
select
  'ca800000-0000-4000-8000-000000000004',
  'ca300000-0000-4000-8000-000000000004',
  'ca200000-0000-4000-8000-000000000001',
  current_date-2, 'refund', 300, 1, 'manual', repeat('b',64),
  '{"payment_method":"card","amountBasis":"tax_exclusive"}',
  rollout.activated_at - interval '1 second'
from private.refund_request_recognition_rollout rollout
where rollout.singleton;

select results_eq($$
  select (snapshot ->> 'legacyPaidDeductionCents')::bigint,
    (commission ->> 'legacyPaidDeductionCents')::bigint,
    (commission ->> 'commissionEarningsCents')::bigint,
    (commission ->> 'taxRateCompleteForSales')::boolean,
    (commission ->> 'commissionAllocationResolved')::boolean,
    count(*) filter (where segment.value ->> 'purchaseAttributionDate' is null)::integer
  from (select
    private.operator_machine_tax_snapshot(
      'ca300000-0000-4000-8000-000000000004', current_date-2, current_date
    ) snapshot,
    private.operator_machine_tax_commission(
      'ca100000-0000-4000-8000-000000000001',
      'ca610000-0000-4000-8000-000000000001',
      'ca300000-0000-4000-8000-000000000004', current_date-2, current_date
    ) commission
  ) calculation
  cross join lateral jsonb_array_elements(calculation.commission -> 'segments') segment(value)
  group by calculation.snapshot,calculation.commission
$$, $$values (300::bigint,0::bigint,0::bigint,false,true,0)$$,
  'Null-date adjustment stays out of incomplete-tax Technician scope without hiding the tax blocker');

delete from public.sales_adjustment_facts
where id='ca800000-0000-4000-8000-000000000004';

select results_eq($$
  select (preview #>> '{summary,refund_amount_cents}')::bigint,
    (preview #>> '{summary,amount_owed_cents}')::bigint,
    exists (
      select 1 from jsonb_array_elements(preview -> 'warnings') warning(value)
      where warning.value ->> 'warning_type' = 'missing_financial_rule'
    )
  from (select public.admin_preview_partner_period_report_internal(
    'ca700000-0000-4000-8000-000000000001', current_date-2, current_date-2,
    'calendar_month') preview) result
$$, $$values (500::bigint,0::bigint,true)$$,
  'Partner report surfaces missing original rule instead of dropping legacy impact');

select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'ca000000-0000-4000-8000-000000000001', true);

select results_eq($$
  select sum(gross_sales_cents)::bigint, sum(tax_cents)::bigint,
    sum(refund_amount_cents)::bigint, sum(net_sales_cents)::bigint
  from public.get_sales_report(current_date, current_date, 'day')
$$, $$values (12000::bigint,1200::bigint,1000::bigint,11000::bigint)$$,
  'Nayax card plus vendor cash yields 120 tax-exclusive sales, one 10 deduction, and 110 net');

select results_eq($$
  select payment_method, gross_sales_cents, refund_amount_cents, net_sales_cents
  from public.get_sales_report(jsonb_build_object(
    'dateFrom', current_date, 'dateTo', current_date, 'grain', 'day',
    'paymentMethods', jsonb_build_array('credit')
  ))
$$, $$values ('credit'::text,10000::bigint,1000::bigint,9000::bigint)$$,
  'JSON overload and card filter preserve the shared basis');

select results_eq($$
  select payment_method, gross_sales_cents, refund_amount_cents, net_sales_cents
  from public.get_sales_report(current_date, current_date, 'day', null, null, array['cash'])
$$, $$values ('cash'::text,2000::bigint,0::bigint,2000::bigint)$$,
  'Cash filter includes vendor cash without vendor card shadow rows');

select ok(
  not has_function_privilege(
    'authenticated',
    'public.sales_report_scheduler_get_sales_report(uuid,date,date,text,uuid[],uuid[],text[])',
    'EXECUTE'
  ),
  'Authenticated callers cannot execute the scheduler adapter'
);

select set_config('request.jwt.claim.role', 'service_role', true);
select results_eq($$
  select sum(gross_sales_cents)::bigint, sum(refund_amount_cents)::bigint,
    sum(net_sales_cents)::bigint
  from public.sales_report_scheduler_get_sales_report(
    'ca000000-0000-4000-8000-000000000001',
    current_date, current_date, 'day'
  )
$$, $$values (12000::bigint,1000::bigint,11000::bigint)$$,
  'Scheduler adapter applies the authorized owner scope and shared calculation');

select is((
  select count(*)::integer
  from public.sales_report_scheduler_get_sales_report(
    'ca000000-0000-4000-8000-000000000003',
    current_date, current_date, 'day'
  )
), 0, 'Scheduler adapter returns no rows for an actor without machine access');
select set_config('request.jwt.claim.role', 'authenticated', true);

select results_eq($$
  select (value ->> 'grossSalesCents')::bigint,
    (value ->> 'refundAdjustmentCents')::bigint,
    (value ->> 'taxCents')::bigint,
    (value ->> 'commissionableSalesCents')::bigint
  from (select private.operator_machine_tax_snapshot(
    'ca300000-0000-4000-8000-000000000001', current_date, current_date
  ) value) result
$$, $$values (12000::bigint,1000::bigint,1200::bigint,11000::bigint)$$,
  'Operator snapshot consumes the same tax-exclusive sales and request deduction');

select results_eq($$
  select (value ->> 'commissionableSalesCents')::bigint,
    (value ->> 'commissionEarningsCents')::bigint,
    (value ->> 'commissionAllocationResolved')::boolean
  from (select private.operator_machine_tax_commission(
    'ca100000-0000-4000-8000-000000000001',
    'ca610000-0000-4000-8000-000000000001',
    'ca300000-0000-4000-8000-000000000001', current_date, current_date
  ) value) result
$$, $$values (11000::bigint,1100::bigint,true)$$,
  'Commission applies the existing rate to the same 110 dollar basis');

select results_eq($$
  select (value ->> 'grossSalesCents')::bigint,
    (value ->> 'taxCents')::bigint,
    (value ->> 'netRevenueCents')::bigint,
    (value ->> 'commissionableSalesCents')::bigint,
    (value ->> 'commissionEarningsCents')::bigint,
    (value ->> 'taxRateCompleteForSales')::boolean,
    (value #>> '{segments,0,grossSalesCents}')::bigint,
    (value #>> '{segments,0,taxCents}')::bigint,
    (value #>> '{segments,0,netRevenueCents}')::bigint,
    (value #>> '{segments,0,commissionableSalesCents}')::bigint
  from (select private.operator_machine_tax_commission(
    'ca100000-0000-4000-8000-000000000001',
    'ca610000-0000-4000-8000-000000000001',
    'ca300000-0000-4000-8000-000000000004', current_date, current_date
  ) value) result
$$, $$values (
  null::bigint,null::bigint,null::bigint,null::bigint,0::bigint,false,
  null::bigint,null::bigint,null::bigint,null::bigint
)$$,
  'Commission machine values remain unavailable when the financial basis is unresolved');

select results_eq($$
  select (preview #>> '{summary,gross_sales_cents}')::bigint,
    (preview #>> '{summary,refund_amount_cents}')::bigint,
    (preview #>> '{summary,order_count}')::bigint,
    (preview #>> '{summary,item_quantity}')::bigint,
    (preview #>> '{summary,fee_cents}')::bigint,
    (preview #>> '{summary,cost_cents}')::bigint,
    (preview #>> '{summary,net_sales_cents}')::bigint,
    (preview #>> '{summary,split_base_cents}')::bigint,
    (preview #>> '{summary,amount_owed_cents}')::bigint
  from (select public.admin_preview_partner_period_report_internal(
    'ca700000-0000-4000-8000-000000000001', current_date, current_date,
    'calendar_month') preview) result
$$, $$values (12000::bigint,1000::bigint,4::bigint,2::bigint,400::bigint,
  400::bigint,10600::bigint,10200::bigint,10200::bigint)$$,
  'Partner basis charges three published Nayax orders plus one cash order and excludes zero-money operations');

insert into public.reporting_machine_partnership_assignments (
  machine_id, partnership_id, assignment_role, effective_start_date, status
) values (
  'ca300000-0000-4000-8000-000000000004', 'ca700000-0000-4000-8000-000000000001',
  'primary_reporting', current_date-30, 'active'
);

select results_eq($$
  select (preview #>> '{summary,gross_sales_cents}')::bigint,
    (preview #>> '{summary,refund_amount_cents}')::bigint,
    (preview #>> '{summary,tax_cents}')::bigint,
    (preview #>> '{summary,net_sales_cents}')::bigint,
    (preview #>> '{summary,split_base_cents}')::bigint,
    (preview #>> '{summary,amount_owed_cents}')::bigint,
    (preview #>> '{summary,bloomjoy_retained_cents}')::bigint,
    (select (machine.value ->> 'net_sales_cents')::bigint
      from jsonb_array_elements(preview -> 'machine_periods') machine(value)
      where machine.value ->> 'reporting_machine_id' =
        'ca300000-0000-4000-8000-000000000004'),
    (select (machine.value ->> 'split_base_cents')::bigint
      from jsonb_array_elements(preview -> 'machine_periods') machine(value)
      where machine.value ->> 'reporting_machine_id' =
        'ca300000-0000-4000-8000-000000000004'),
    (select (machine.value ->> 'amount_owed_cents')::bigint
      from jsonb_array_elements(preview -> 'machine_periods') machine(value)
      where machine.value ->> 'reporting_machine_id' =
        'ca300000-0000-4000-8000-000000000004'),
    (select (period.value ->> 'net_sales_cents')::bigint
      from jsonb_array_elements(preview -> 'periods') period(value) limit 1),
    (select (period.value ->> 'split_base_cents')::bigint
      from jsonb_array_elements(preview -> 'periods') period(value) limit 1),
    (select (period.value ->> 'amount_owed_cents')::bigint
      from jsonb_array_elements(preview -> 'periods') period(value) limit 1),
    exists (
      select 1 from jsonb_array_elements(preview -> 'warnings') warning(value)
      where warning.value ->> 'warning_type' = 'missing_machine_tax_rate'
    )
  from (select public.admin_preview_partner_period_report_internal(
    'ca700000-0000-4000-8000-000000000001', current_date, current_date,
    'calendar_month') preview) result
$$, $$values (
  null::bigint,1000::bigint,null::bigint,null::bigint,null::bigint,null::bigint,
  null::bigint,null::bigint,null::bigint,null::bigint,null::bigint,null::bigint,
  null::bigint,true
)$$,
  'Partner row, period, and summary rollups preserve unavailable financial values');

insert into public.sales_adjustment_facts (
  id, reporting_machine_id, reporting_location_id, adjustment_date,
  adjustment_type, amount_cents, complaint_count, source, source_row_hash,
  refund_case_id, raw_payload, created_at
) values (
  'ca800000-0000-4000-8000-000000000001', 'ca300000-0000-4000-8000-000000000001',
  'ca200000-0000-4000-8000-000000000001', current_date, 'refund', 1100, 1,
  'manual', repeat('8',64), 'ca500000-0000-4000-8000-000000000001',
  '{"payment_method":"card"}', clock_timestamp()
);
select results_eq($$
  select sum(net_sales_cents)::bigint, sum(refund_paid_context_cents)::bigint
  from public.get_sales_report(current_date, current_date, 'day')
$$, $$values (11000::bigint,1000::bigint)$$,
  'Later payment adds paid context and zero new refund impact');

insert into public.sales_adjustment_facts (
  id, reporting_machine_id, reporting_location_id, adjustment_date,
  adjustment_type, amount_cents, complaint_count, source, source_row_hash,
  raw_payload, created_at
) values (
  'ca800000-0000-4000-8000-000000000003', 'ca300000-0000-4000-8000-000000000001',
  'ca200000-0000-4000-8000-000000000001', current_date, 'refund', 700, 1,
  'manual', repeat('a',64),
  '{"payment_method":"card","amountBasis":"tax_exclusive"}', clock_timestamp()
);
select results_eq($$
  select (value ->> 'refundPaidContextCents')::bigint,
    (value ->> 'commissionEarningsCents')::bigint,
    (value ->> 'commissionAllocationResolved')::boolean
  from (select private.operator_machine_tax_commission(
    'ca100000-0000-4000-8000-000000000001',
    'ca610000-0000-4000-8000-000000000001',
    'ca300000-0000-4000-8000-000000000001', current_date, current_date
  ) value) result
$$, $$values (1000::bigint,1100::bigint,true)$$,
  'Unlinked post-cutover paid context remains in reporting but outside Technician commission');

select is((
  select count(*)::integer
  from jsonb_array_elements(public.admin_preview_partner_period_report_internal(
    'ca700000-0000-4000-8000-000000000001', current_date, current_date,
    'calendar_month') -> 'warnings') warning(value)
  where warning.value ->> 'warning_type' = 'missing_financial_rule'
), 0, 'Payment-only unknown attribution does not create a partner financial-rule warning');

insert into public.refund_cases (
  id, public_reference, reporting_machine_id, reporting_location_id,
  customer_email, issue_summary, incident_at, payment_method,
  payment_amount_cents, refund_amount_cents, status,
  customer_request_received_at, customer_request_received_source
) values (
  'ca500000-0000-4000-8000-000000000002', 'RF-CONSUMER-2',
  'ca300000-0000-4000-8000-000000000002', 'ca200000-0000-4000-8000-000000000001',
  'move@example.invalid', 'Moved machine request', clock_timestamp()-interval '1 day',
  'card', 1100, 1100, 'needs_review', clock_timestamp(), 'hosted_refund_intake'
);
update public.reporting_machines set location_id='ca200000-0000-4000-8000-000000000002'
where id='ca300000-0000-4000-8000-000000000002';
select results_eq($$
  select
    (private.operator_machine_tax_commission(
      'ca100000-0000-4000-8000-000000000001',
      'ca610000-0000-4000-8000-000000000001',
      'ca300000-0000-4000-8000-000000000002', current_date, current_date
    ) ->> 'refundAdjustmentCents')::bigint,
    (private.operator_machine_tax_commission(
      'ca100000-0000-4000-8000-000000000001',
      'ca610000-0000-4000-8000-000000000002',
      'ca300000-0000-4000-8000-000000000002', current_date, current_date
    ) ->> 'refundAdjustmentCents')::bigint
$$, $$values (1000::bigint,0::bigint)$$,
  'Request month booking retains original purchase Technician after a move');

select is((select sales_ex_tax_cents from private.machine_sales_daily_components(
  'ca300000-0000-4000-8000-000000000001', current_date-1, current_date-1
) where tender='other'), 500::bigint,
  'Explicit tax-exclusive evidence remains tax-exclusive');

-- The previous-day assertion above is independent of the monthly snapshot
-- fixture below. Keep its 500-cent evidence in that report month on day one,
-- so the unchanged late-evidence assertion always proves 12500 -> 13500.
select results_eq($$
  select greatest(example.report_day-1,date_trunc('month',example.report_day)::date)
  from (values (date '2026-10-01'),(date '2026-10-20')) example(report_day)
$$, $$values (date '2026-10-01'),(date '2026-10-19')$$,
  'Monthly fixture evidence stays in-period on month start and an ordinary day');
update public.machine_sales_facts
set sale_date=greatest(sale_date,date_trunc('month',current_date)::date)
where id='ca400000-0000-4000-8000-000000000004';

-- This isolates the snapshot writer against already-captured immutable history.
-- The core recognition fixture separately proves denial-event trigger capture.
insert into private.refund_request_recognition_events (
  event_key, refund_case_id, event_kind, effective_at, recorded_at, booking_date,
  reporting_machine_id, reporting_location_id, tender, source,
  purchase_attribution_date, request_target_before_cents,
  request_target_after_cents, paid_cumulative_cents,
  recognized_target_before_cents, recognized_target_after_cents,
  amount_basis, amount_provenance
)
select
  'consumer:reversal-only', 'ca500000-0000-4000-8000-000000000003', 'denied',
  rollout.activated_at, rollout.activated_at + interval '1 second', current_date,
  'ca300000-0000-4000-8000-000000000003', 'ca200000-0000-4000-8000-000000000001',
  'card', 'consumer_fixture', date_trunc('month', current_date)::date-2,
  1100, 0, 0, 1100, 0, 'tax_inclusive', 'consumer_fixture'
from private.refund_request_recognition_rollout rollout
where rollout.singleton;

select lives_ok($$
  select public.service_refresh_pay_stub_revenue_snapshot(
    'ca605000-0000-4000-8000-000000000001',
    'ca300000-0000-4000-8000-000000000003'
  )
$$, 'The real snapshot writer persists a reversal-only month');

select results_eq($$
  select refund_adjustment_cents, net_revenue_cents,
    eligible_commission_revenue_cents
  from public.payout_period_machine_revenue_snapshots
  where payout_period_id = 'ca605000-0000-4000-8000-000000000001'
    and reporting_machine_id = 'ca300000-0000-4000-8000-000000000003'
    and status <> 'voided'
$$, $$values (-1000, 1000, 1000)$$,
  'A reversal-only snapshot stores signed impact and positive restored basis');

select lives_ok($$
  select public.service_refresh_pay_stub_revenue_snapshot(
    'ca605000-0000-4000-8000-000000000001',
    'ca300000-0000-4000-8000-000000000004'
  )
$$, 'The real snapshot writer preserves an unresolved financial basis');

select results_eq($$
  select gross_sales_cents, net_revenue_cents,
    (source_metadata ->> 'calculationComplete')::boolean,
    exists (
      select 1
      from jsonb_array_elements(warnings) warning(value)
      where warning.value ->> 'code' = 'missing_machine_tax_rate'
    )
  from public.payout_period_machine_revenue_snapshots
  where payout_period_id = 'ca605000-0000-4000-8000-000000000001'
    and reporting_machine_id = 'ca300000-0000-4000-8000-000000000004'
    and status <> 'voided'
$$, $$values (null::integer, null::integer, false, true)$$,
  'Unresolved snapshot values remain null and use the existing unavailable warning');

insert into public.refund_cases (
  id, public_reference, reporting_machine_id, reporting_location_id,
  customer_email, issue_summary, incident_at, payment_method,
  payment_amount_cents, refund_amount_cents, status,
  customer_request_received_at, customer_request_received_source
) values (
  'ca500000-0000-4000-8000-000000000004', 'RF-CONSUMER-CROSS-MONTH',
  'ca300000-0000-4000-8000-000000000005', 'ca200000-0000-4000-8000-000000000001',
  'cross-month@example.invalid', 'Prior-month purchase, current-month request',
  date_trunc('month', current_date) - interval '2 days' + interval '12 hours',
  'card', 1100, 1100, 'needs_review', clock_timestamp(), 'hosted_refund_intake'
);

select results_eq($$
  with report as (
    select public.get_current_technician_pay_report_context(current_date) payload
  )
  select
    coalesce((
      select (machine.value ->> 'refundAdjustmentCents')::bigint
      from report
      cross join lateral jsonb_array_elements(report.payload -> 'technicians') technician(value)
      cross join lateral jsonb_array_elements(technician.value -> 'machines') machine(value)
      where technician.value ->> 'operatorProfileId' =
          'ca610000-0000-4000-8000-000000000001'
        and machine.value ->> 'machineId' = 'ca300000-0000-4000-8000-000000000005'
    ), 0::bigint),
    coalesce((
      select (machine.value ->> 'refundAdjustmentCents')::bigint
      from report
      cross join lateral jsonb_array_elements(report.payload -> 'technicians') technician(value)
      cross join lateral jsonb_array_elements(technician.value -> 'machines') machine(value)
      where technician.value ->> 'operatorProfileId' =
          'ca610000-0000-4000-8000-000000000002'
        and machine.value ->> 'machineId' = 'ca300000-0000-4000-8000-000000000005'
    ), 0::bigint)
$$, $$values (1000::bigint,0::bigint)$$,
  'Current pay report keeps a prior-month purchase request with the original assignee');

select lives_ok($$
  select public.service_refresh_pay_stub_revenue_snapshot(
    'ca605000-0000-4000-8000-000000000001',
    'ca300000-0000-4000-8000-000000000001'
  )
$$, 'An open shared-basis snapshot is generated before issuing the statement');

update public.payout_period_machine_revenue_snapshots snapshot
set
  gross_sales_cents = (legacy.value ->> 'grossSalesCents')::integer,
  refund_adjustment_cents = (legacy.value ->> 'refundAdjustmentCents')::integer,
  tax_cents = (legacy.value ->> 'taxCents')::integer,
  net_revenue_cents = (legacy.value ->> 'netRevenueCents')::integer,
  eligible_commission_revenue_cents =
    (legacy.value ->> 'commissionableSalesCents')::integer,
  source_metadata = snapshot.source_metadata || jsonb_build_object(
    'salesCalculationVersion', 'issued-prior-formula'
  )
from (
  select private.operator_machine_tax_snapshot_before_shared_basis(
    'ca300000-0000-4000-8000-000000000001',
    date_trunc('month', current_date)::date,
    (date_trunc('month', current_date) + interval '1 month - 1 day')::date
  ) value
) legacy
where payout_period_id = 'ca605000-0000-4000-8000-000000000001'
  and reporting_machine_id = 'ca300000-0000-4000-8000-000000000001';

insert into public.payout_runs (
  id, account_id, payout_period_id, status, issued_at
) values (
  'ca640000-0000-4000-8000-000000000001',
  'ca100000-0000-4000-8000-000000000001',
  'ca605000-0000-4000-8000-000000000001', 'issued', clock_timestamp()
);
insert into public.payout_run_items (
  id, payout_run_id, account_id, operator_profile_id, worker_type, status
) values (
  'ca650000-0000-4000-8000-000000000001',
  'ca640000-0000-4000-8000-000000000001',
  'ca100000-0000-4000-8000-000000000001',
  'ca610000-0000-4000-8000-000000000001', 'contractor_1099', 'issued'
);
insert into public.pay_statements (
  id, payout_run_id, payout_run_item_id, account_id, operator_profile_id,
  statement_number, status, storage_path, issued_at
) values (
  'ca660000-0000-4000-8000-000000000001',
  'ca640000-0000-4000-8000-000000000001',
  'ca650000-0000-4000-8000-000000000001',
  'ca100000-0000-4000-8000-000000000001',
  'ca610000-0000-4000-8000-000000000001',
  'CONSUMER-ISSUED-1', 'issued', 'fixtures/consumer-issued-1.pdf', clock_timestamp()
);

select lives_ok($$
  select public.get_current_technician_pay_report_context(current_date)
$$, 'Opening an issued period returns context without regenerating its snapshot');

select is((
  select source_metadata ->> 'salesCalculationVersion'
  from public.payout_period_machine_revenue_snapshots
  where payout_period_id = 'ca605000-0000-4000-8000-000000000001'
    and reporting_machine_id = 'ca300000-0000-4000-8000-000000000001'
    and status <> 'voided'
), 'issued-prior-formula',
  'Formula version mismatch alone leaves the issued prior-month snapshot untouched');

insert into public.machine_sales_facts (
  id, reporting_machine_id, reporting_location_id, sale_date, payment_method,
  net_sales_cents, transaction_count, item_quantity, source, source_order_hash,
  source_row_hash, tax_cents, raw_payload
) values (
  'ca400000-0000-4000-8000-000000000006',
  'ca300000-0000-4000-8000-000000000001',
  'ca200000-0000-4000-8000-000000000001', current_date, 'credit',
  1100, 1, 1, 'nayax_scheduled_report', repeat('6',32), repeat('6',64), 0,
  '{"amountBasis":"gross_customer_charge_minor"}'
);
select lives_ok($$
  select public.get_current_technician_pay_report_context(current_date)
$$, 'Actual late sales evidence refreshes the shared report snapshot');

select results_eq($$
  select gross_sales_cents, source_metadata ->> 'salesCalculationVersion'
  from public.payout_period_machine_revenue_snapshots
  where payout_period_id = 'ca605000-0000-4000-8000-000000000001'
    and reporting_machine_id = 'ca300000-0000-4000-8000-000000000001'
    and status <> 'voided'
$$, $$values (13500, 'shared-sales-basis-v1'::text)$$,
  'Changed evidence refreshes the current report snapshot on the shared basis');

select results_eq($$
  select status, storage_path
  from public.pay_statements
  where id = 'ca660000-0000-4000-8000-000000000001'
$$, $$values ('issued'::text, 'fixtures/consumer-issued-1.pdf'::text)$$,
  'Issued statement content remains immutable after current-report reconciliation');

select ok(exists (
  select 1 from public.admin_audit_log audit
  where audit.action = 'operator_payout_revenue_snapshot.regenerated'
    and audit.meta ->> 'reporting_machine_id' = 'ca300000-0000-4000-8000-000000000001'
), 'Actual evidence change retains the targeted snapshot regeneration audit signal');

update public.reporting_machine_partnership_assignments
set effective_end_date = current_date-1
where partnership_id = 'ca700000-0000-4000-8000-000000000001'
  and machine_id = 'ca300000-0000-4000-8000-000000000004';

insert into public.reporting_machines (
  id, account_id, location_id, machine_label, machine_type, status
) values (
  'ca300000-0000-4000-8000-000000000006',
  'ca100000-0000-4000-8000-000000000001',
  'ca200000-0000-4000-8000-000000000001',
  'Missing-rate compatibility machine', 'commercial', 'active'
), (
  'ca300000-0000-4000-8000-000000000007',
  'ca100000-0000-4000-8000-000000000001',
  'ca200000-0000-4000-8000-000000000001',
  'Refund-only compatibility machine', 'commercial', 'active'
);
insert into public.operator_machine_assignments (
  id, operator_profile_id, account_id, reporting_machine_id,
  effective_start_date, effective_end_date, grant_reason
) values (
  'ca620000-0000-4000-8000-000000000007',
  'ca610000-0000-4000-8000-000000000001',
  'ca100000-0000-4000-8000-000000000001',
  'ca300000-0000-4000-8000-000000000006',
  current_date-30, null, 'Missing-rate compatibility fixture'
);
insert into public.compensation_rules (
  id, account_id, operator_profile_id, reporting_machine_id,
  commission_basis_points, effective_start_date, status
) values (
  'ca630000-0000-4000-8000-000000000007',
  'ca100000-0000-4000-8000-000000000001',
  'ca610000-0000-4000-8000-000000000001',
  'ca300000-0000-4000-8000-000000000006',
  1000, current_date-30, 'active'
);
insert into public.machine_sales_facts (
  id, reporting_machine_id, reporting_location_id, sale_date, payment_method,
  net_sales_cents, transaction_count, item_quantity, source, source_order_hash,
  source_row_hash, tax_cents, raw_payload
) values (
  'ca400000-0000-4000-8000-000000000008',
  'ca300000-0000-4000-8000-000000000006',
  'ca200000-0000-4000-8000-000000000001', current_date, 'credit',
  1100, 1, 1, 'nayax_scheduled_report', repeat('8',32), repeat('8',64), 0, '{}'
);
insert into public.reporting_machine_partnership_assignments (
  machine_id, partnership_id, assignment_role, effective_start_date, status
) values (
  'ca300000-0000-4000-8000-000000000006',
  'ca700000-0000-4000-8000-000000000001',
  'primary_reporting', current_date-30, 'active'
);
select results_eq($$
  select (value ->> 'grossSalesCents')::bigint,
    (value ->> 'taxCents')::bigint,
    (value ->> 'netRevenueCents')::bigint,
    (value ->> 'commissionableSalesCents')::bigint,
    (value ->> 'commissionEarningsCents')::bigint,
    (value ->> 'taxRateCompleteForSales')::boolean
  from (select private.operator_machine_tax_commission_shared(
    'ca100000-0000-4000-8000-000000000001',
    'ca610000-0000-4000-8000-000000000001',
    'ca300000-0000-4000-8000-000000000006', current_date, current_date
  ) value) calculation
$$, $$values (
  1100::bigint,0::bigint,1100::bigint,1100::bigint,0::bigint,false
)$$,
  'Missing-rate commission stays numeric, incomplete, and unpublished at zero earnings');
select ok(not exists (
  select 1
  from jsonb_array_elements(private.operator_machine_tax_commission_shared(
    'ca100000-0000-4000-8000-000000000001',
    'ca610000-0000-4000-8000-000000000001',
    'ca300000-0000-4000-8000-000000000006', current_date, current_date
  ) -> 'segments') segment(value)
  where (segment.value ->> 'commissionEarningsCents')::bigint <> 0
), 'Missing-rate commission segments cannot expose nonzero earnings');

select ok(exists (
  select 1
  from jsonb_array_elements(public.admin_preview_partner_period_report_internal(
    'ca700000-0000-4000-8000-000000000001', current_date, current_date,
    'calendar_month'
  ) -> 'warnings') warning(value)
  where warning.value ->> 'warning_type' = 'missing_machine_tax_rate'
), 'Partner preview retains the existing missing-machine-tax-rate blocker');

insert into public.machine_sales_facts (
  id, reporting_machine_id, reporting_location_id, sale_date, payment_method,
  net_sales_cents, transaction_count, item_quantity, source, source_order_hash,
  source_row_hash, tax_cents, raw_payload
) values (
  'ca400000-0000-4000-8000-000000000009',
  'ca300000-0000-4000-8000-000000000001',
  'ca200000-0000-4000-8000-000000000001', current_date-4, 'other',
  1100, 1, 1, 'manual_csv', null, repeat('9',64), 0,
  '{"amountBasis":"legacy_percentage_of_gross_estimate"}'
);
select results_eq($$
  select (value ->> 'grossSalesCents')::bigint,
    (value ->> 'taxCents')::bigint,
    (value ->> 'commissionableSalesCents')::bigint,
    (value ->> 'commissionEarningsCents')::bigint,
    (value ->> 'taxRateCompleteForSales')::boolean
  from (select private.operator_machine_tax_commission_shared(
    'ca100000-0000-4000-8000-000000000001',
    'ca610000-0000-4000-8000-000000000001',
    'ca300000-0000-4000-8000-000000000001', current_date-4, current_date-4
  ) value) calculation
$$, $$values (990::bigint,110::bigint,990::bigint,99::bigint,true)$$,
  'Configured legacy estimates remain tax-complete and commissionable');

insert into public.refund_cases (
  id, public_reference, reporting_machine_id, reporting_location_id,
  customer_email, issue_summary, incident_at, payment_method,
  payment_amount_cents, refund_amount_cents, status,
  customer_request_received_at, customer_request_received_source
) values (
  'ca500000-0000-4000-8000-000000000007', 'RF-CONSUMER-7',
  'ca300000-0000-4000-8000-000000000007',
  'ca200000-0000-4000-8000-000000000001',
  'refund-only@example.invalid', 'Refund-only estimated context', clock_timestamp(),
  'card', 1100, 1100, 'needs_review', clock_timestamp(), 'hosted_refund_intake'
);
select is((
  private.operator_machine_tax_snapshot_shared(
    'ca300000-0000-4000-8000-000000000007', current_date, current_date
  ) ->> 'taxRateCompleteForSales'
)::boolean, true,
  'Estimated refund-only context does not create a missing-sales-tax blocker');

select * from finish();
rollback;
