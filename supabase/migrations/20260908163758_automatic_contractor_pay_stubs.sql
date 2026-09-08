-- #1216: tax-aware contractor commission basis and immutable calculation inputs.
--
-- The source order amount stored in machine_sales_facts.net_sales_cents is the
-- pre-deduction sales amount used by the existing operator payout workflow.
-- Commissionable sales are therefore: sales - refunds - estimated sales tax.

alter table public.payout_period_machine_revenue_snapshots
  add column if not exists tax_cents integer not null default 0
    check (tax_cents >= 0),
  add column if not exists tax_segments jsonb not null default '[]'::jsonb
    check (jsonb_typeof(tax_segments) = 'array');

create or replace function public.payout_revenue_snapshot_payload(
  p_snapshot_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', snapshot.id,
    'accountId', snapshot.account_id,
    'payoutPeriodId', snapshot.payout_period_id,
    'machineId', snapshot.reporting_machine_id,
    'machineLabel', machine.machine_label,
    'locationId', snapshot.reporting_location_id,
    'locationName', location.name,
    'periodStartDate', snapshot.period_start_date,
    'periodEndDate', snapshot.period_end_date,
    'grossSalesCents', snapshot.gross_sales_cents,
    'refundAdjustmentCents', snapshot.refund_adjustment_cents,
    'taxCents', snapshot.tax_cents,
    'taxSegments', snapshot.tax_segments,
    'netRevenueCents', snapshot.net_revenue_cents,
    'eligibleCommissionRevenueCents', snapshot.eligible_commission_revenue_cents,
    'transactionCount', snapshot.transaction_count,
    'sourceSalesRowCount', snapshot.source_sales_row_count,
    'sourceAdjustmentRowCount', snapshot.source_adjustment_row_count,
    'sourceLatestSaleDate', snapshot.source_latest_sale_date,
    'sourceLatestAdjustmentDate', snapshot.source_latest_adjustment_date,
    'sourceMetadata', snapshot.source_metadata,
    'warnings', snapshot.warnings,
    'status', snapshot.status,
    'manualOverrideReason', snapshot.manual_override_reason,
    'generatedAt', snapshot.generated_at,
    'regeneratedAt', snapshot.regenerated_at,
    'createdAt', snapshot.created_at,
    'updatedAt', snapshot.updated_at
  )
  from public.payout_period_machine_revenue_snapshots snapshot
  join public.reporting_machines machine on machine.id = snapshot.reporting_machine_id
  join public.reporting_locations location on location.id = snapshot.reporting_location_id
  where snapshot.id = p_snapshot_id
    and public.operator_can_access_payout_revenue_snapshot_row(
      (select auth.uid()),
      snapshot.account_id,
      snapshot.reporting_machine_id,
      snapshot.period_start_date,
      snapshot.period_end_date
    );
$$;

create or replace function private.operator_machine_tax_snapshot(
  p_reporting_machine_id uuid,
  p_period_start_date date,
  p_period_end_date date
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with daily as materialized (
    select
      day_value::date as activity_date,
      coalesce(sales.gross_sales_cents, 0)::bigint as gross_sales_cents,
      coalesce(refunds.refund_adjustment_cents, 0)::bigint as refund_adjustment_cents,
      rate.tax_rate_percent,
      case
        when rate.tax_rate_percent is null then 0
        else round(coalesce(sales.gross_sales_cents, 0)::numeric * rate.tax_rate_percent / 100)::bigint
      end as tax_cents
    from generate_series(
      p_period_start_date::timestamp,
      p_period_end_date::timestamp,
      interval '1 day'
    ) day_value
    left join lateral (
      select coalesce(sum(fact.net_sales_cents), 0)::bigint as gross_sales_cents
      from public.machine_sales_facts fact
      where fact.reporting_machine_id = p_reporting_machine_id
        and fact.sale_date = day_value::date
    ) sales on true
    left join lateral (
      select coalesce(sum(adjustment.amount_cents), 0)::bigint as refund_adjustment_cents
      from public.sales_adjustment_facts adjustment
      where adjustment.reporting_machine_id = p_reporting_machine_id
        and adjustment.adjustment_date = day_value::date
        and adjustment.adjustment_type in ('refund', 'complaint_refund')
        and adjustment.amount_cents > 0
    ) refunds on true
    left join lateral (
      select tax.tax_rate_percent
      from public.reporting_machine_tax_rates tax
      where tax.machine_id = p_reporting_machine_id
        and tax.status = 'active'
        and tax.effective_start_date <= day_value::date
        and coalesce(tax.effective_end_date, 'infinity'::date) >= day_value::date
      order by tax.effective_start_date desc, tax.created_at desc, tax.id
      limit 1
    ) rate on true
  ),
  segmented as materialized (
    select
      daily.*,
      daily.activity_date - row_number() over (
        partition by coalesce(daily.tax_rate_percent::text, 'missing')
        order by daily.activity_date
      )::integer as segment_group
    from daily
  ),
  segments as materialized (
    select
      min(day_row.activity_date) as segment_start_date,
      max(day_row.activity_date) as segment_end_date,
      day_row.tax_rate_percent,
      sum(day_row.gross_sales_cents)::bigint as gross_sales_cents,
      sum(day_row.refund_adjustment_cents)::bigint as refund_adjustment_cents,
      sum(day_row.tax_cents)::bigint as tax_cents
    from segmented day_row
    group by day_row.tax_rate_percent, day_row.segment_group
  )
  select jsonb_build_object(
    'grossSalesCents', coalesce(sum(segment.gross_sales_cents), 0)::bigint,
    'refundAdjustmentCents', coalesce(sum(segment.refund_adjustment_cents), 0)::bigint,
    'taxCents', coalesce(sum(segment.tax_cents), 0)::bigint,
    'netRevenueCents', (
      coalesce(sum(segment.gross_sales_cents), 0)
      - coalesce(sum(segment.refund_adjustment_cents), 0)
      - coalesce(sum(segment.tax_cents), 0)
    )::bigint,
    'commissionableSalesCents', greatest(
      coalesce(sum(segment.gross_sales_cents), 0)
      - coalesce(sum(segment.refund_adjustment_cents), 0)
      - coalesce(sum(segment.tax_cents), 0),
      0
    )::bigint,
    'taxRateCompleteForSales', not coalesce(bool_or(
      segment.tax_rate_percent is null and segment.gross_sales_cents > 0
    ), false),
    'segments', coalesce(jsonb_agg(jsonb_build_object(
      'segmentStartDate', segment.segment_start_date,
      'segmentEndDate', segment.segment_end_date,
      'taxRatePercent', segment.tax_rate_percent,
      'grossSalesCents', segment.gross_sales_cents,
      'refundAdjustmentCents', segment.refund_adjustment_cents,
      'taxCents', segment.tax_cents
    ) order by segment.segment_start_date), '[]'::jsonb)
  )
  from segments segment;
$$;

create or replace function private.operator_machine_tax_commission(
  p_account_id uuid,
  p_operator_profile_id uuid,
  p_reporting_machine_id uuid,
  p_period_start_date date,
  p_period_end_date date
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with assignment_days as materialized (
    select day_value::date as activity_date
    from generate_series(
      p_period_start_date::timestamp,
      p_period_end_date::timestamp,
      interval '1 day'
    ) day_value
    where exists (
      select 1
      from public.operator_machine_assignments assignment
      where assignment.account_id = p_account_id
        and assignment.operator_profile_id = p_operator_profile_id
        and assignment.reporting_machine_id = p_reporting_machine_id
        and day_value::date between assignment.effective_start_date
          and coalesce(assignment.effective_end_date, 'infinity'::date)
    )
  ),
  daily as materialized (
    select
      day_row.activity_date,
      coalesce(sales.gross_sales_cents, 0)::bigint as gross_sales_cents,
      coalesce(refunds.refund_adjustment_cents, 0)::bigint as refund_adjustment_cents,
      tax.tax_rate_percent,
      case
        when tax.tax_rate_percent is null then 0
        else round(coalesce(sales.gross_sales_cents, 0)::numeric * tax.tax_rate_percent / 100)::bigint
      end as tax_cents,
      public.operator_compensation_rate_at(
        p_account_id,
        p_operator_profile_id,
        p_reporting_machine_id,
        day_row.activity_date,
        'commission'
      ) as commission_rate,
      coalesce(sales.source_sales_row_count, 0)::integer as source_sales_row_count,
      coalesce(refunds.source_adjustment_row_count, 0)::integer as source_adjustment_row_count,
      sales.source_latest_sale_date
    from assignment_days day_row
    left join lateral (
      select
        coalesce(sum(fact.net_sales_cents), 0)::bigint as gross_sales_cents,
        count(*)::integer as source_sales_row_count,
        max(fact.sale_date) as source_latest_sale_date
      from public.machine_sales_facts fact
      where fact.reporting_machine_id = p_reporting_machine_id
        and fact.sale_date = day_row.activity_date
    ) sales on true
    left join lateral (
      select
        coalesce(sum(adjustment.amount_cents), 0)::bigint as refund_adjustment_cents,
        count(*)::integer as source_adjustment_row_count
      from public.sales_adjustment_facts adjustment
      where adjustment.reporting_machine_id = p_reporting_machine_id
        and adjustment.adjustment_date = day_row.activity_date
        and adjustment.adjustment_type in ('refund', 'complaint_refund')
        and adjustment.amount_cents > 0
    ) refunds on true
    left join lateral (
      select rate.tax_rate_percent
      from public.reporting_machine_tax_rates rate
      where rate.machine_id = p_reporting_machine_id
        and rate.status = 'active'
        and rate.effective_start_date <= day_row.activity_date
        and coalesce(rate.effective_end_date, 'infinity'::date) >= day_row.activity_date
      order by rate.effective_start_date desc, rate.created_at desc, rate.id
      limit 1
    ) tax on true
  ),
  segmented as materialized (
    select
      daily.*,
      nullif(daily.commission_rate ->> 'commissionBasisPoints', '')::integer
        as commission_basis_points,
      daily.activity_date - row_number() over (
        partition by
          coalesce(daily.tax_rate_percent::text, 'missing'),
          coalesce(daily.commission_rate ->> 'ruleId', 'missing'),
          coalesce(daily.commission_rate ->> 'commissionBasisPoints', 'missing')
        order by daily.activity_date
      )::integer as segment_group
    from daily
  ),
  segments as materialized (
    select
      min(day_row.activity_date) as segment_start_date,
      max(day_row.activity_date) as segment_end_date,
      day_row.tax_rate_percent,
      (array_agg(day_row.commission_rate order by day_row.activity_date))[1]
        as commission_rate,
      day_row.commission_basis_points,
      sum(day_row.gross_sales_cents)::bigint as gross_sales_cents,
      sum(day_row.refund_adjustment_cents)::bigint as refund_adjustment_cents,
      sum(day_row.tax_cents)::bigint as tax_cents,
      (
        sum(day_row.gross_sales_cents)
        - sum(day_row.refund_adjustment_cents)
        - sum(day_row.tax_cents)
      )::bigint as net_revenue_cents,
      greatest(
        sum(day_row.gross_sales_cents)
        - sum(day_row.refund_adjustment_cents)
        - sum(day_row.tax_cents),
        0
      )::bigint as commissionable_sales_cents,
      sum(day_row.source_sales_row_count)::integer as source_sales_row_count,
      sum(day_row.source_adjustment_row_count)::integer as source_adjustment_row_count,
      max(day_row.source_latest_sale_date) as source_latest_sale_date
    from segmented day_row
    group by
      day_row.tax_rate_percent,
      day_row.commission_rate,
      day_row.commission_basis_points,
      day_row.segment_group
  ),
  scope as materialized (
    select
      count(distinct segment.commission_basis_points)
        filter (where segment.commission_basis_points is not null)::integer as commission_rate_count,
      bool_or(segment.commission_rate is null) as commission_rate_missing,
      bool_or(segment.tax_rate_percent is null and segment.gross_sales_cents > 0)
        as tax_rate_missing,
      (
        count(distinct segment.commission_basis_points)
          filter (where segment.commission_basis_points is not null) > 1
        and bool_or(segment.net_revenue_cents < 0)
      ) as cross_rate_refund_allocation_ambiguous
    from segments segment
  ),
  calculated_segments as materialized (
    select
      segment.*,
      case
        when scope.commission_rate_missing
          or scope.tax_rate_missing
          or scope.cross_rate_refund_allocation_ambiguous
        then 0
        when scope.commission_rate_count = 1 then null
        else round(
          segment.commissionable_sales_cents::numeric
          * segment.commission_basis_points
          / 10000
        )::bigint
      end as segmented_commission_cents
    from segments segment
    cross join scope
  ),
  totals as (
    select
      coalesce(sum(segment.gross_sales_cents), 0)::bigint as gross_sales_cents,
      coalesce(sum(segment.refund_adjustment_cents), 0)::bigint as refund_adjustment_cents,
      coalesce(sum(segment.tax_cents), 0)::bigint as tax_cents,
      coalesce(sum(segment.net_revenue_cents), 0)::bigint as net_revenue_cents,
      greatest(coalesce(sum(segment.net_revenue_cents), 0), 0)::bigint
        as commissionable_sales_cents,
      coalesce(sum(segment.source_sales_row_count), 0)::integer as source_sales_row_count,
      coalesce(sum(segment.source_adjustment_row_count), 0)::integer
        as source_adjustment_row_count,
      max(segment.source_latest_sale_date) as source_latest_sale_date
    from calculated_segments segment
  )
  select jsonb_build_object(
    'grossSalesCents', totals.gross_sales_cents,
    'refundAdjustmentCents', totals.refund_adjustment_cents,
    'taxCents', totals.tax_cents,
    'netRevenueCents', totals.net_revenue_cents,
    'commissionableSalesCents', totals.commissionable_sales_cents,
    'commissionEarningsCents', case
      when scope.commission_rate_missing
        or scope.tax_rate_missing
        or scope.cross_rate_refund_allocation_ambiguous
      then 0
      when scope.commission_rate_count = 1 then round(
        totals.commissionable_sales_cents::numeric
        * max(segment.commission_basis_points)
        / 10000
      )::bigint
      else coalesce(sum(segment.segmented_commission_cents), 0)::bigint
    end,
    'commissionRate', case
      when scope.commission_rate_count = 1
      then (array_agg(segment.commission_rate order by segment.segment_start_date))[1]
      else null
    end,
    'commissionBasisPoints', case
      when scope.commission_rate_count = 1 then max(segment.commission_basis_points)
      else null
    end,
    'commissionRateCompleteForPeriod', not scope.commission_rate_missing,
    'taxRateCompleteForSales', not scope.tax_rate_missing,
    'commissionAllocationResolved', not scope.cross_rate_refund_allocation_ambiguous,
    'sourceSalesRowCount', totals.source_sales_row_count,
    'sourceAdjustmentRowCount', totals.source_adjustment_row_count,
    'sourceLatestSaleDate', totals.source_latest_sale_date,
    'segments', coalesce(jsonb_agg(jsonb_build_object(
      'segmentStartDate', segment.segment_start_date,
      'segmentEndDate', segment.segment_end_date,
      'taxRatePercent', segment.tax_rate_percent,
      'commissionRate', segment.commission_rate,
      'commissionBasisPoints', segment.commission_basis_points,
      'grossSalesCents', segment.gross_sales_cents,
      'refundAdjustmentCents', segment.refund_adjustment_cents,
      'taxCents', segment.tax_cents,
      'netRevenueCents', segment.net_revenue_cents,
      'commissionableSalesCents', segment.commissionable_sales_cents,
      'commissionEarningsCents', case
        when scope.commission_rate_count = 1 then round(
          greatest(segment.net_revenue_cents, 0)::numeric
          * segment.commission_basis_points / 10000
        )::bigint
        else segment.segmented_commission_cents
      end,
      'sourceSalesRowCount', segment.source_sales_row_count,
      'sourceAdjustmentRowCount', segment.source_adjustment_row_count,
      'sourceLatestSaleDate', segment.source_latest_sale_date
    ) order by segment.segment_start_date), '[]'::jsonb)
  )
  from totals
  cross join scope
  left join calculated_segments segment on true
  group by
    totals.gross_sales_cents,
    totals.refund_adjustment_cents,
    totals.tax_cents,
    totals.net_revenue_cents,
    totals.commissionable_sales_cents,
    totals.source_sales_row_count,
    totals.source_adjustment_row_count,
    totals.source_latest_sale_date,
    scope.commission_rate_count,
    scope.commission_rate_missing,
    scope.tax_rate_missing,
    scope.cross_rate_refund_allocation_ambiguous;
$$;

revoke execute on function private.operator_machine_tax_snapshot(uuid, date, date)
  from public, anon, authenticated;
grant execute on function private.operator_machine_tax_snapshot(uuid, date, date)
  to service_role;
revoke execute on function private.operator_machine_tax_commission(uuid, uuid, uuid, date, date)
  from public, anon, authenticated;
grant execute on function private.operator_machine_tax_commission(uuid, uuid, uuid, date, date)
  to service_role;

alter function public.admin_generate_payout_revenue_snapshot(uuid, uuid, boolean, text)
  rename to admin_generate_payout_revenue_snapshot_without_tax;

create function public.admin_generate_payout_revenue_snapshot(
  p_payout_period_id uuid,
  p_reporting_machine_id uuid,
  p_regenerate boolean default false,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  legacy_result jsonb;
  period_row public.payout_periods;
  calculation jsonb;
  snapshot_id uuid;
begin
  legacy_result := public.admin_generate_payout_revenue_snapshot_without_tax(
    p_payout_period_id,
    p_reporting_machine_id,
    p_regenerate,
    p_reason
  );

  select * into period_row
  from public.payout_periods period
  where period.id = p_payout_period_id;

  snapshot_id := nullif(legacy_result #>> '{snapshot,id}', '')::uuid;
  if snapshot_id is null then
    return legacy_result;
  end if;

  calculation := private.operator_machine_tax_snapshot(
    p_reporting_machine_id,
    period_row.period_start_date,
    period_row.period_end_date
  );

  update public.payout_period_machine_revenue_snapshots snapshot
  set
    tax_cents = (calculation ->> 'taxCents')::integer,
    tax_segments = calculation -> 'segments',
    net_revenue_cents = (calculation ->> 'netRevenueCents')::integer,
    eligible_commission_revenue_cents = (calculation ->> 'commissionableSalesCents')::integer,
    source_metadata = coalesce(snapshot.source_metadata, '{}'::jsonb) || jsonb_build_object(
      'commissionFormula', 'sales - refunds - tax',
      'taxCalculation', 'effective-dated machine tax rate applied to each sale date',
      'taxRateCompleteForSales', (calculation ->> 'taxRateCompleteForSales')::boolean,
      'taxSegments', calculation -> 'segments'
    ),
    warnings = case
      when (calculation ->> 'taxRateCompleteForSales')::boolean then
        coalesce((
          select jsonb_agg(warning.value)
          from jsonb_array_elements(coalesce(snapshot.warnings, '[]'::jsonb)) warning(value)
          where warning.value ->> 'code' <> 'missing_machine_tax_rate'
        ), '[]'::jsonb)
      else coalesce(snapshot.warnings, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
        'code', 'missing_machine_tax_rate',
        'severity', 'blocker',
        'message', 'Add a machine tax rate effective on every sale date before publishing.'
      ))
    end
  where snapshot.id = snapshot_id;

  return jsonb_build_object(
    'snapshot', public.payout_revenue_snapshot_payload(snapshot_id) || jsonb_build_object(
      'taxCents', (calculation ->> 'taxCents')::integer,
      'taxSegments', calculation -> 'segments',
      'netRevenueCents', (calculation ->> 'netRevenueCents')::integer,
      'eligibleCommissionRevenueCents', (calculation ->> 'commissionableSalesCents')::integer
    ),
    'idempotent', coalesce((legacy_result ->> 'idempotent')::boolean, false)
  );
end;
$$;

revoke execute on function public.admin_generate_payout_revenue_snapshot_without_tax(uuid, uuid, boolean, text)
  from public, anon, authenticated;
grant execute on function public.admin_generate_payout_revenue_snapshot_without_tax(uuid, uuid, boolean, text)
  to service_role;
revoke execute on function public.admin_generate_payout_revenue_snapshot(uuid, uuid, boolean, text)
  from public, anon;
grant execute on function public.admin_generate_payout_revenue_snapshot(uuid, uuid, boolean, text)
  to authenticated;

alter function private.calculate_technician_pay_report(uuid, uuid, date, date)
  rename to calculate_technician_pay_report_without_tax;

create function private.calculate_technician_pay_report(
  p_account_id uuid,
  p_operator_profile_id uuid,
  p_period_start_date date,
  p_period_end_date date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
  machine jsonb;
  calculation jsonb;
  snapshot_calculation jsonb;
  machines jsonb := '[]'::jsonb;
  blockers jsonb;
  machine_blockers jsonb;
  total_commissionable bigint := 0;
  total_commission bigint := 0;
  total_tax bigint := 0;
begin
  result := private.calculate_technician_pay_report_without_tax(
    p_account_id,
    p_operator_profile_id,
    p_period_start_date,
    p_period_end_date
  );

  blockers := coalesce((
    select jsonb_agg(item.value)
    from jsonb_array_elements(coalesce(result -> 'blockers', '[]'::jsonb)) item(value)
    where item.value ->> 'code' not in (
      'revenue_snapshot_fact_mismatch',
      'cross_rate_refund_allocation_ambiguous'
    )
  ), '[]'::jsonb);

  for machine in
    select value from jsonb_array_elements(coalesce(result -> 'machines', '[]'::jsonb))
  loop
    calculation := private.operator_machine_tax_commission(
      p_account_id,
      p_operator_profile_id,
      (machine ->> 'machineId')::uuid,
      p_period_start_date,
      p_period_end_date
    );
    snapshot_calculation := private.operator_machine_tax_snapshot(
      (machine ->> 'machineId')::uuid,
      p_period_start_date,
      p_period_end_date
    );
    machine_blockers := '[]'::jsonb;

    if not (calculation ->> 'taxRateCompleteForSales')::boolean then
      machine_blockers := machine_blockers || jsonb_build_array(jsonb_build_object(
        'code', 'missing_machine_tax_rate',
        'severity', 'blocker',
        'message', 'Add a machine tax rate effective on every sale date before publishing.',
        'operatorProfileId', p_operator_profile_id,
        'machineId', machine ->> 'machineId'
      ));
    end if;

    if not (calculation ->> 'commissionAllocationResolved')::boolean then
      machine_blockers := machine_blockers || jsonb_build_array(jsonb_build_object(
        'code', 'cross_rate_refund_allocation_ambiguous',
        'severity', 'blocker',
        'message', 'Resolve refund attribution across commission-rate periods before publishing.',
        'operatorProfileId', p_operator_profile_id,
        'machineId', machine ->> 'machineId'
      ));
    end if;

    if machine ->> 'revenueSnapshotId' is not null and not exists (
      select 1
      from public.payout_period_machine_revenue_snapshots snapshot
      where snapshot.id = (machine ->> 'revenueSnapshotId')::uuid
        and snapshot.gross_sales_cents = (snapshot_calculation ->> 'grossSalesCents')::integer
        and snapshot.refund_adjustment_cents = (snapshot_calculation ->> 'refundAdjustmentCents')::integer
        and snapshot.tax_cents = (snapshot_calculation ->> 'taxCents')::integer
        and snapshot.eligible_commission_revenue_cents =
          (snapshot_calculation ->> 'commissionableSalesCents')::integer
    ) then
      machine_blockers := machine_blockers || jsonb_build_array(jsonb_build_object(
        'code', 'revenue_snapshot_fact_mismatch',
        'severity', 'blocker',
        'message', 'Refresh the monthly revenue snapshot to freeze sales, refunds, and tax.',
        'operatorProfileId', p_operator_profile_id,
        'machineId', machine ->> 'machineId'
      ));
    end if;

    blockers := blockers || machine_blockers;
    total_commissionable := total_commissionable
      + (calculation ->> 'commissionableSalesCents')::bigint;
    total_commission := total_commission
      + (calculation ->> 'commissionEarningsCents')::bigint;
    total_tax := total_tax + (calculation ->> 'taxCents')::bigint;

    machines := machines || jsonb_build_array(
      machine || jsonb_build_object(
        'grossSalesCents', (calculation ->> 'grossSalesCents')::bigint,
        'refundAdjustmentCents', (calculation ->> 'refundAdjustmentCents')::bigint,
        'taxCents', (calculation ->> 'taxCents')::bigint,
        'netRevenueCents', (calculation ->> 'netRevenueCents')::bigint,
        'commissionableSalesCents', (calculation ->> 'commissionableSalesCents')::bigint,
        'commissionRate', calculation -> 'commissionRate',
        'commissionBasisPoints', nullif(calculation ->> 'commissionBasisPoints', '')::integer,
        'commissionEarningsCents', (calculation ->> 'commissionEarningsCents')::bigint,
        'commissionSegments', calculation -> 'segments',
        'commissionRateCompleteForPeriod',
          (calculation ->> 'commissionRateCompleteForPeriod')::boolean,
        'taxRateCompleteForSales',
          (calculation ->> 'taxRateCompleteForSales')::boolean,
        'commissionAllocationResolved',
          (calculation ->> 'commissionAllocationResolved')::boolean,
        'snapshotTaxCents', coalesce((
          select snapshot.tax_cents
          from public.payout_period_machine_revenue_snapshots snapshot
          where snapshot.id = nullif(machine ->> 'revenueSnapshotId', '')::uuid
        ), 0),
        'snapshotMatchesFacts', not exists (
          select 1
          from jsonb_array_elements(machine_blockers) blocker(value)
          where blocker.value ->> 'code' = 'revenue_snapshot_fact_mismatch'
        )
      )
    );
  end loop;

  result := result || jsonb_build_object(
    'taxCents', total_tax,
    'commissionableSalesCents', total_commissionable,
    'commissionEarningsCents', total_commission,
    'currentTotalCents',
      coalesce((result ->> 'shiftEarningsCents')::bigint, 0)
      + total_commission
      + coalesce((result ->> 'bonusCents')::bigint, 0)
      + coalesce((result ->> 'supplyCreditCents')::bigint, 0)
      + coalesce((result ->> 'expenseReimbursementCents')::bigint, 0),
    'machines', machines,
    'blockers', blockers,
    'publishable', jsonb_array_length(blockers) = 0,
    'calculationMeta', coalesce(result -> 'calculationMeta', '{}'::jsonb) || jsonb_build_object(
      'schemaVersion', 'technician-pay-report-v2',
      'commissionBasisSource', 'date-bounded sales less refunds and effective-dated machine tax, reconciled to the monthly revenue snapshot',
      'commissionFormula', '(sales - refunds - tax) x commission rate',
      'taxCalculation', true,
      'taxRounding', 'nearest cent per machine per sale date'
    )
  );

  return result;
end;
$$;

revoke execute on function private.calculate_technician_pay_report_without_tax(uuid, uuid, date, date)
  from public, anon, authenticated;
grant execute on function private.calculate_technician_pay_report_without_tax(uuid, uuid, date, date)
  to service_role;
revoke execute on function private.calculate_technician_pay_report(uuid, uuid, date, date)
  from public, anon, authenticated;
grant execute on function private.calculate_technician_pay_report(uuid, uuid, date, date)
  to service_role;

alter function public.get_technician_pay_report_context(date)
  rename to get_technician_pay_report_context_without_tax_capability;

create function public.get_technician_pay_report_context(
  p_month date default current_date
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    public.get_technician_pay_report_context_without_tax_capability(p_month),
    '{}'::jsonb
  ) || jsonb_build_object(
    'capabilities', jsonb_build_object(
      'accountPayAuthorityRequired', true,
      'canCorrectTime', false,
      'approvalRequired', false,
      'paymentExecution', false,
      'taxCalculation', true
    )
  );
$$;

revoke execute on function public.get_technician_pay_report_context_without_tax_capability(date)
  from public, anon, authenticated;
grant execute on function public.get_technician_pay_report_context_without_tax_capability(date)
  to service_role;
revoke execute on function public.get_technician_pay_report_context(date)
  from public, anon;
grant execute on function public.get_technician_pay_report_context(date)
  to authenticated;

-- Superseded revisions remain available to account managers for audit, while a
-- technician can only fetch the single currently-issued Pay Stub version.
create or replace function public.can_access_pay_statement(
  p_user_id uuid,
  p_pay_statement_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user_id is not null
    and p_pay_statement_id is not null
    and exists (
      select 1
      from public.pay_statements statement
      join public.operator_payout_profiles profile
        on profile.id = statement.operator_profile_id
      where statement.id = p_pay_statement_id
        and (
          (profile.user_id = p_user_id and statement.status = 'issued')
          or public.is_super_admin(p_user_id)
          or public.can_manage_operator_payout_account(p_user_id, statement.account_id)
        )
    );
$$;

comment on column public.payout_period_machine_revenue_snapshots.tax_cents is
  'Estimated sales tax frozen with the monthly commission snapshot, rounded to cents by machine and sale date.';
comment on column public.payout_period_machine_revenue_snapshots.tax_segments is
  'Immutable effective-date segments used to explain sales, refunds, tax, commissionable sales, and commission on the Pay Stub appendix.';
comment on function private.operator_machine_tax_commission(uuid, uuid, uuid, date, date) is
  'Service-only tax-aware machine commission calculation. Formula: max(sales - refunds - tax, 0) times the effective contractor commission rate.';
comment on function private.operator_machine_tax_snapshot(uuid, date, date) is
  'Service-only full-period machine tax snapshot used to freeze effective-dated sales tax independently of Technician assignment windows.';

create table if not exists public.pay_stub_generation_requests (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.customer_accounts (id) on delete cascade,
  operator_profile_id uuid not null references public.operator_payout_profiles (id) on delete cascade,
  payout_period_id uuid not null references public.payout_periods (id) on delete cascade,
  trigger_kind text not null check (trigger_kind in ('automatic', 'manager_regeneration')),
  status text not null default 'queued'
    check (status in ('queued', 'processing', 'completed', 'blocked', 'failed')),
  requested_by uuid references auth.users (id) on delete set null,
  pay_statement_id uuid references public.pay_statements (id) on delete set null,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  blocker_details jsonb not null default '[]'::jsonb
    check (jsonb_typeof(blocker_details) = 'array'),
  error_message text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);

create unique index if not exists pay_stub_generation_requests_active_idx
  on public.pay_stub_generation_requests (operator_profile_id, payout_period_id)
  where status in ('queued', 'processing');
create index if not exists pay_stub_generation_requests_queue_idx
  on public.pay_stub_generation_requests (status, created_at)
  where status in ('queued', 'processing');
create index if not exists pay_stub_generation_requests_account_idx
  on public.pay_stub_generation_requests (account_id, created_at desc);

drop trigger if exists pay_stub_generation_requests_set_updated_at
  on public.pay_stub_generation_requests;
create trigger pay_stub_generation_requests_set_updated_at
before update on public.pay_stub_generation_requests
for each row execute function public.set_updated_at();

alter table public.pay_stub_generation_requests enable row level security;
drop policy if exists "pay_stub_generation_requests_manager_read"
  on public.pay_stub_generation_requests;
create policy "pay_stub_generation_requests_manager_read"
on public.pay_stub_generation_requests
for select
to authenticated
using (public.can_manage_operator_payout_account_current_user(account_id));

revoke all on public.pay_stub_generation_requests from anon, authenticated;
grant select on public.pay_stub_generation_requests to authenticated;

create or replace function public.admin_request_pay_stub_generation(
  p_operator_profile_id uuid,
  p_month date
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_user_id uuid := auth.uid();
  profile_row public.operator_payout_profiles;
  period_row public.payout_periods;
  request_row public.pay_stub_generation_requests;
  period_start date := date_trunc('month', p_month::timestamp)::date;
  period_end date := (date_trunc('month', p_month::timestamp) + interval '1 month - 1 day')::date;
begin
  if actor_user_id is null then
    raise exception 'Authentication required';
  end if;

  select * into profile_row
  from public.operator_payout_profiles profile
  where profile.id = p_operator_profile_id
    and profile.status = 'active';

  if profile_row.id is null
    or not public.can_manage_operator_payout_account(actor_user_id, profile_row.account_id) then
    raise exception 'Account pay authority required';
  end if;

  select * into period_row
  from public.payout_periods period
  where period.account_id = profile_row.account_id
    and period.period_start_date = period_start
    and period.period_end_date = period_end
    and period.status <> 'voided'
  order by period.created_at desc
  limit 1;

  if period_row.id is null then
    raise exception 'Monthly pay period not found';
  end if;

  if now() < public.operator_time_entry_cutoff_at(period_row.period_end_date) then
    raise exception 'Pay Stubs can be generated after the Technician edit cutoff';
  end if;

  insert into public.pay_stub_generation_requests (
    account_id,
    operator_profile_id,
    payout_period_id,
    trigger_kind,
    requested_by
  )
  values (
    profile_row.account_id,
    profile_row.id,
    period_row.id,
    'manager_regeneration',
    actor_user_id
  )
  on conflict (operator_profile_id, payout_period_id)
    where status in ('queued', 'processing')
  do update set updated_at = now()
  returning * into request_row;

  insert into public.admin_audit_log (
    actor_user_id, action, entity_type, entity_id, after, meta
  )
  values (
    actor_user_id,
    'operator_pay_stub.generation_requested',
    'pay_stub_generation_request',
    request_row.id::text,
    to_jsonb(request_row),
    jsonb_build_object(
      'account_id', profile_row.account_id,
      'operator_profile_id', profile_row.id,
      'payout_period_id', period_row.id,
      'approval_required', false,
      'payment_execution', false
    )
  );

  return jsonb_build_object(
    'requestId', request_row.id,
    'status', request_row.status
  );
end;
$$;

create or replace function public.service_enqueue_automatic_pay_stubs(
  p_as_of timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  inserted_count integer;
begin
  if current_user not in ('postgres', 'service_role')
    and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Service role required';
  end if;

  insert into public.pay_stub_generation_requests (
    account_id,
    operator_profile_id,
    payout_period_id,
    trigger_kind
  )
  select
    profile.account_id,
    profile.id,
    period.id,
    'automatic'
  from public.payout_periods period
  join public.operator_payout_profiles profile
    on profile.account_id = period.account_id
    and profile.status = 'active'
  where period.status <> 'voided'
    and p_as_of >= public.operator_time_entry_cutoff_at(period.period_end_date)
    and exists (
      select 1
      from public.time_entries entry
      where entry.payout_period_id = period.id
        and entry.operator_profile_id = profile.id
        and entry.status <> 'voided'
    )
    and not exists (
      select 1
      from public.pay_statements statement
      where statement.operator_profile_id = profile.id
        and statement.status = 'issued'
        and statement.payout_run_id in (
          select run.id
          from public.payout_runs run
          where run.payout_period_id = period.id
        )
    )
  on conflict (operator_profile_id, payout_period_id)
    where status in ('queued', 'processing')
  do nothing;

  get diagnostics inserted_count = row_count;
  return jsonb_build_object('queuedCount', inserted_count, 'asOf', p_as_of);
end;
$$;

create or replace function public.service_claim_pay_stub_generation_requests(
  p_limit integer default 10
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  if current_user not in ('postgres', 'service_role')
    and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Service role required';
  end if;

  with claimed as (
    select request.id
    from public.pay_stub_generation_requests request
    where request.status = 'queued'
    order by request.created_at, request.id
    for update skip locked
    limit greatest(1, least(coalesce(p_limit, 10), 25))
  ),
  updated as (
    update public.pay_stub_generation_requests request
    set
      status = 'processing',
      started_at = now(),
      attempt_count = request.attempt_count + 1,
      error_message = null
    from claimed
    where request.id = claimed.id
    returning request.*
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'requestId', updated.id,
    'accountId', updated.account_id,
    'operatorProfileId', updated.operator_profile_id,
    'payoutPeriodId', updated.payout_period_id,
    'triggerKind', updated.trigger_kind,
    'attemptCount', updated.attempt_count
  ) order by updated.created_at), '[]'::jsonb)
  into result
  from updated;

  return result;
end;
$$;

create or replace function public.service_claim_pay_stub_generation_request(
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_row public.pay_stub_generation_requests;
begin
  if current_user not in ('postgres', 'service_role')
    and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Service role required';
  end if;

  update public.pay_stub_generation_requests request
  set
    status = 'processing',
    started_at = now(),
    attempt_count = request.attempt_count + 1,
    error_message = null
  where request.id = p_request_id
    and request.status = 'queued'
  returning * into request_row;

  if request_row.id is null then
    raise exception 'Queued Pay Stub request not found';
  end if;

  return jsonb_build_object(
    'requestId', request_row.id,
    'accountId', request_row.account_id,
    'operatorProfileId', request_row.operator_profile_id,
    'payoutPeriodId', request_row.payout_period_id,
    'triggerKind', request_row.trigger_kind,
    'attemptCount', request_row.attempt_count
  );
end;
$$;

create or replace function public.service_refresh_pay_stub_revenue_snapshot(
  p_payout_period_id uuid,
  p_reporting_machine_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  period_row public.payout_periods;
  machine_row public.reporting_machines;
  source_values jsonb;
  tax_values jsonb;
  snapshot_id uuid;
  warnings jsonb;
begin
  if current_user not in ('postgres', 'service_role')
    and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Service role required';
  end if;

  select * into period_row
  from public.payout_periods period
  where period.id = p_payout_period_id;
  select * into machine_row
  from public.reporting_machines machine
  where machine.id = p_reporting_machine_id
    and machine.account_id = period_row.account_id;
  if period_row.id is null or machine_row.id is null then
    raise exception 'Pay Stub revenue snapshot scope not found';
  end if;

  source_values := public.operator_revenue_snapshot_source_values(
    period_row.id,
    machine_row.id
  );
  tax_values := private.operator_machine_tax_snapshot(
    machine_row.id,
    period_row.period_start_date,
    period_row.period_end_date
  );
  warnings := coalesce(source_values -> 'warnings', '[]'::jsonb);
  if not (tax_values ->> 'taxRateCompleteForSales')::boolean then
    warnings := warnings || jsonb_build_array(jsonb_build_object(
      'code', 'missing_machine_tax_rate',
      'severity', 'blocker',
      'message', 'Add a machine tax rate effective on every sale date before publishing.'
    ));
  end if;

  insert into public.payout_period_machine_revenue_snapshots (
    account_id, payout_period_id, reporting_machine_id, reporting_location_id,
    period_start_date, period_end_date, gross_sales_cents,
    refund_adjustment_cents, tax_cents, tax_segments, net_revenue_cents,
    eligible_commission_revenue_cents, transaction_count,
    source_sales_row_count, source_adjustment_row_count,
    source_latest_sale_date, source_latest_adjustment_date,
    source_metadata, warnings, status, generated_at
  ) values (
    period_row.account_id, period_row.id, machine_row.id, machine_row.location_id,
    period_row.period_start_date, period_row.period_end_date,
    (source_values ->> 'grossSalesCents')::integer,
    (source_values ->> 'refundAdjustmentCents')::integer,
    (tax_values ->> 'taxCents')::integer,
    tax_values -> 'segments',
    (tax_values ->> 'netRevenueCents')::integer,
    (tax_values ->> 'commissionableSalesCents')::integer,
    (source_values ->> 'transactionCount')::integer,
    (source_values ->> 'sourceSalesRowCount')::integer,
    (source_values ->> 'sourceAdjustmentRowCount')::integer,
    nullif(source_values ->> 'sourceLatestSaleDate', '')::date,
    nullif(source_values ->> 'sourceLatestAdjustmentDate', '')::date,
    coalesce(source_values -> 'sourceMetadata', '{}'::jsonb) || jsonb_build_object(
      'commissionFormula', 'sales - refunds - tax',
      'taxCalculation', 'effective-dated machine tax rate applied to each sale date',
      'taxRateCompleteForSales', (tax_values ->> 'taxRateCompleteForSales')::boolean,
      'taxSegments', tax_values -> 'segments'
    ),
    warnings, 'source_generated', now()
  )
  on conflict (payout_period_id, reporting_machine_id) where status <> 'voided'
  do update set
    reporting_location_id = excluded.reporting_location_id,
    gross_sales_cents = excluded.gross_sales_cents,
    refund_adjustment_cents = excluded.refund_adjustment_cents,
    tax_cents = excluded.tax_cents,
    tax_segments = excluded.tax_segments,
    net_revenue_cents = excluded.net_revenue_cents,
    eligible_commission_revenue_cents = excluded.eligible_commission_revenue_cents,
    transaction_count = excluded.transaction_count,
    source_sales_row_count = excluded.source_sales_row_count,
    source_adjustment_row_count = excluded.source_adjustment_row_count,
    source_latest_sale_date = excluded.source_latest_sale_date,
    source_latest_adjustment_date = excluded.source_latest_adjustment_date,
    source_metadata = excluded.source_metadata,
    warnings = excluded.warnings,
    status = 'source_generated',
    manual_override_reason = null,
    regenerated_at = now()
  returning id into snapshot_id;

  return snapshot_id;
end;
$$;

create or replace function public.service_prepare_pay_stub(
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_row public.pay_stub_generation_requests;
  profile_row public.operator_payout_profiles;
  period_row public.payout_periods;
  account_row public.customer_accounts;
  report jsonb;
  run_row public.payout_runs;
  item_row public.payout_run_items;
  previous_statement public.pay_statements;
  statement_row public.pay_statements;
  statement_version integer;
  statement_number text;
  statement_date date := (now() at time zone 'America/Los_Angeles')::date;
  machine jsonb;
  current_ytd jsonb;
  prior_ytd jsonb;
  machine_id uuid;
begin
  if current_user not in ('postgres', 'service_role')
    and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Service role required';
  end if;

  select * into request_row
  from public.pay_stub_generation_requests request
  where request.id = p_request_id
  for update;

  if request_row.id is null or request_row.status <> 'processing' then
    raise exception 'Processing Pay Stub request not found';
  end if;

  select * into profile_row
  from public.operator_payout_profiles profile
  where profile.id = request_row.operator_profile_id;
  select * into period_row
  from public.payout_periods period
  where period.id = request_row.payout_period_id;
  select * into account_row
  from public.customer_accounts account
  where account.id = request_row.account_id;

  for machine_id in
    select distinct assignment.reporting_machine_id
    from public.operator_machine_assignments assignment
    where assignment.account_id = request_row.account_id
      and assignment.operator_profile_id = request_row.operator_profile_id
      and assignment.effective_start_date <= period_row.period_end_date
      and coalesce(assignment.effective_end_date, 'infinity'::date) >= period_row.period_start_date
  loop
    perform public.service_refresh_pay_stub_revenue_snapshot(period_row.id, machine_id);
  end loop;

  report := private.calculate_technician_pay_report(
    request_row.account_id,
    request_row.operator_profile_id,
    period_row.period_start_date,
    period_row.period_end_date
  );

  if not coalesce((report ->> 'publishable')::boolean, false) then
    update public.pay_stub_generation_requests
    set
      status = 'blocked',
      blocker_details = coalesce(report -> 'blockers', '[]'::jsonb),
      completed_at = now()
    where id = request_row.id;
    return jsonb_build_object(
      'requestId', request_row.id,
      'status', 'blocked',
      'blockers', coalesce(report -> 'blockers', '[]'::jsonb)
    );
  end if;

  insert into public.payout_runs (
    account_id, payout_period_id, status, total_raw_minutes,
    total_rounded_paid_minutes, total_hourly_pay_cents,
    total_commission_pay_cents, total_adjustments_cents,
    total_payout_cents, notes
  )
  values (
    request_row.account_id, period_row.id, 'finalized',
    (report ->> 'actualDurationMinutes')::integer,
    (report ->> 'paidShifts')::integer * 60,
    (report ->> 'shiftEarningsCents')::integer,
    (report ->> 'commissionEarningsCents')::integer,
    (report ->> 'bonusCents')::integer
      + (report ->> 'supplyCreditCents')::integer
      + (report ->> 'expenseReimbursementCents')::integer,
    (report ->> 'currentTotalCents')::integer,
    'Pay Stub record only; no approval or payment execution.'
  )
  on conflict (payout_period_id) where status <> 'voided'
  do update set
    status = 'finalized',
    total_raw_minutes = excluded.total_raw_minutes,
    total_rounded_paid_minutes = excluded.total_rounded_paid_minutes,
    total_hourly_pay_cents = excluded.total_hourly_pay_cents,
    total_commission_pay_cents = excluded.total_commission_pay_cents,
    total_adjustments_cents = excluded.total_adjustments_cents,
    total_payout_cents = excluded.total_payout_cents,
    notes = excluded.notes,
    finalized_at = now()
  returning * into run_row;

  insert into public.payout_run_items (
    payout_run_id, account_id, operator_profile_id, worker_type,
    raw_minutes, rounded_paid_minutes, shift_count, hourly_rate_cents,
    hourly_pay_cents, eligible_net_revenue_cents, commission_basis_points,
    commission_pay_cents, adjustments_total_cents, total_payout_cents,
    status, warnings, calculation_notes
  )
  values (
    run_row.id, request_row.account_id, profile_row.id, profile_row.worker_type,
    (report ->> 'actualDurationMinutes')::integer,
    (report ->> 'paidShifts')::integer * 60,
    (report ->> 'paidShifts')::integer,
    case when jsonb_array_length(report -> 'shiftRateLines') = 1
      then nullif(report #>> '{shiftRateLines,0,shiftRateCents}', '')::integer
      else null end,
    (report ->> 'shiftEarningsCents')::integer,
    (report ->> 'commissionableSalesCents')::integer,
    case when jsonb_array_length(report -> 'machines') = 1
      then nullif(report #>> '{machines,0,commissionBasisPoints}', '')::integer
      else null end,
    (report ->> 'commissionEarningsCents')::integer,
    (report ->> 'bonusCents')::integer
      + (report ->> 'supplyCreditCents')::integer
      + (report ->> 'expenseReimbursementCents')::integer,
    (report ->> 'currentTotalCents')::integer,
    'finalized', '[]'::jsonb,
    coalesce(report -> 'calculationMeta', '{}'::jsonb) || jsonb_build_object(
      'taxCents', (report ->> 'taxCents')::integer,
      'calculationSnapshot', report
    )
  )
  on conflict (payout_run_id, operator_profile_id)
  do update set
    raw_minutes = excluded.raw_minutes,
    rounded_paid_minutes = excluded.rounded_paid_minutes,
    shift_count = excluded.shift_count,
    hourly_rate_cents = excluded.hourly_rate_cents,
    hourly_pay_cents = excluded.hourly_pay_cents,
    eligible_net_revenue_cents = excluded.eligible_net_revenue_cents,
    commission_basis_points = excluded.commission_basis_points,
    commission_pay_cents = excluded.commission_pay_cents,
    adjustments_total_cents = excluded.adjustments_total_cents,
    total_payout_cents = excluded.total_payout_cents,
    status = 'finalized',
    warnings = excluded.warnings,
    calculation_notes = excluded.calculation_notes
  returning * into item_row;

  delete from public.payout_run_item_machines
  where payout_run_item_id = item_row.id;
  for machine in select value from jsonb_array_elements(report -> 'machines')
  loop
    insert into public.payout_run_item_machines (
      payout_run_item_id, reporting_machine_id, reporting_location_id,
      net_revenue_cents, eligible_net_revenue_cents,
      commission_basis_points, commission_pay_cents,
      shift_count, raw_minutes, rounded_paid_minutes,
      included_in_commission_basis, inclusion_reason
    ) values (
      item_row.id,
      (machine ->> 'machineId')::uuid,
      (machine ->> 'locationId')::uuid,
      (machine ->> 'netRevenueCents')::integer,
      (machine ->> 'commissionableSalesCents')::integer,
      nullif(machine ->> 'commissionBasisPoints', '')::integer,
      (machine ->> 'commissionEarningsCents')::integer,
      coalesce((select sum((entry.value ->> 'paidShifts')::integer)
        from jsonb_array_elements(report -> 'entries') entry(value)
        where entry.value ->> 'machineId' = machine ->> 'machineId'), 0),
      coalesce((select sum((entry.value ->> 'actualDurationMinutes')::integer)
        from jsonb_array_elements(report -> 'entries') entry(value)
        where entry.value ->> 'machineId' = machine ->> 'machineId'), 0),
      coalesce((select sum((entry.value ->> 'paidShifts')::integer) * 60
        from jsonb_array_elements(report -> 'entries') entry(value)
        where entry.value ->> 'machineId' = machine ->> 'machineId'), 0),
      true,
      'Effective Technician assignment window'
    );
  end loop;

  update public.payout_runs run
  set
    total_raw_minutes = totals.raw_minutes,
    total_rounded_paid_minutes = totals.rounded_paid_minutes,
    total_hourly_pay_cents = totals.hourly_pay_cents,
    total_commission_pay_cents = totals.commission_pay_cents,
    total_adjustments_cents = totals.adjustments_cents,
    total_payout_cents = totals.total_payout_cents,
    finalized_at = now()
  from (
    select
      coalesce(sum(item.raw_minutes), 0)::integer as raw_minutes,
      coalesce(sum(item.rounded_paid_minutes), 0)::integer as rounded_paid_minutes,
      coalesce(sum(item.hourly_pay_cents), 0)::integer as hourly_pay_cents,
      coalesce(sum(item.commission_pay_cents), 0)::integer as commission_pay_cents,
      coalesce(sum(item.adjustments_total_cents), 0)::integer as adjustments_cents,
      coalesce(sum(item.total_payout_cents), 0)::integer as total_payout_cents
    from public.payout_run_items item
    where item.payout_run_id = run_row.id
      and item.status <> 'voided'
  ) totals
  where run.id = run_row.id
  returning * into run_row;

  delete from public.pay_statements statement
  where statement.payout_run_item_id = item_row.id
    and statement.status = 'draft';

  select * into previous_statement
  from public.pay_statements statement
  where statement.payout_run_item_id = item_row.id
    and statement.status = 'issued'
  order by statement.version desc
  limit 1
  for update;

  statement_version := coalesce(previous_statement.version, 0) + 1;
  statement_number := upper(
    'BJ-STUB-' || to_char(period_row.period_start_date, 'YYYYMM') || '-'
    || left(replace(profile_row.id::text, '-', ''), 8) || '-V' || statement_version
  );

  select jsonb_build_object(
    'actualMinutes', coalesce(opening.actual_minutes, 0) + coalesce(history.actual_minutes, 0),
    'paidShifts', coalesce(opening.paid_shift_count, 0) + coalesce(history.paid_shifts, 0),
    'commissionableSalesCents', coalesce(opening.commissionable_sales_cents, 0) + coalesce(history.commissionable_sales_cents, 0),
    'shiftEarningsCents', coalesce(opening.shift_earnings_cents, 0) + coalesce(history.shift_earnings_cents, 0),
    'commissionEarningsCents', coalesce(opening.commission_earnings_cents, 0) + coalesce(history.commission_earnings_cents, 0),
    'bonusCents', coalesce(opening.bonus_cents, 0) + coalesce(history.bonus_cents, 0),
    'supplyCreditCents', coalesce(opening.supply_credit_cents, 0) + coalesce(history.supply_credit_cents, 0),
    'expenseReimbursementCents', coalesce(opening.expense_reimbursement_cents, 0) + coalesce(history.expense_reimbursement_cents, 0)
  ) into prior_ytd
  from (
    select *
    from public.operator_ytd_opening_balances opening
    where opening.operator_profile_id = profile_row.id
      and opening.calendar_year = extract(year from period_row.period_start_date)::integer
    limit 1
  ) opening
  full join (
    select
      coalesce(sum((statement.statement_payload #>> '{current,actualMinutes}')::bigint), 0)::bigint as actual_minutes,
      coalesce(sum((statement.statement_payload #>> '{current,paidShifts}')::bigint), 0)::bigint as paid_shifts,
      coalesce(sum((statement.statement_payload #>> '{current,commissionableSalesCents}')::bigint), 0)::bigint as commissionable_sales_cents,
      coalesce(sum((statement.statement_payload #>> '{current,shiftEarningsCents}')::bigint), 0)::bigint as shift_earnings_cents,
      coalesce(sum((statement.statement_payload #>> '{current,commissionEarningsCents}')::bigint), 0)::bigint as commission_earnings_cents,
      coalesce(sum((statement.statement_payload #>> '{current,bonusCents}')::bigint), 0)::bigint as bonus_cents,
      coalesce(sum((statement.statement_payload #>> '{current,supplyCreditCents}')::bigint), 0)::bigint as supply_credit_cents,
      coalesce(sum((statement.statement_payload #>> '{current,expenseReimbursementCents}')::bigint), 0)::bigint as expense_reimbursement_cents
    from public.pay_statements statement
    join public.payout_runs run on run.id = statement.payout_run_id
    join public.payout_periods period on period.id = run.payout_period_id
    where statement.operator_profile_id = profile_row.id
      and statement.status = 'issued'
      and statement.statement_payload ->> 'schemaVersion' = 'operator-pay-stub-v2'
      and period.period_start_date >= date_trunc('year', period_row.period_start_date::timestamp)::date
      and period.period_end_date < period_row.period_start_date
  ) history on true;

  prior_ytd := coalesce(prior_ytd, jsonb_build_object(
    'actualMinutes', 0, 'paidShifts', 0, 'commissionableSalesCents', 0,
    'shiftEarningsCents', 0, 'commissionEarningsCents', 0, 'bonusCents', 0,
    'supplyCreditCents', 0, 'expenseReimbursementCents', 0
  ));
  current_ytd := prior_ytd || jsonb_build_object(
    'actualMinutes', (prior_ytd ->> 'actualMinutes')::bigint + (report ->> 'actualDurationMinutes')::bigint,
    'paidShifts', (prior_ytd ->> 'paidShifts')::bigint + (report ->> 'paidShifts')::bigint,
    'commissionableSalesCents', (prior_ytd ->> 'commissionableSalesCents')::bigint + (report ->> 'commissionableSalesCents')::bigint,
    'shiftEarningsCents', (prior_ytd ->> 'shiftEarningsCents')::bigint + (report ->> 'shiftEarningsCents')::bigint,
    'commissionEarningsCents', (prior_ytd ->> 'commissionEarningsCents')::bigint + (report ->> 'commissionEarningsCents')::bigint,
    'bonusCents', (prior_ytd ->> 'bonusCents')::bigint + (report ->> 'bonusCents')::bigint,
    'supplyCreditCents', (prior_ytd ->> 'supplyCreditCents')::bigint + (report ->> 'supplyCreditCents')::bigint,
    'expenseReimbursementCents', (prior_ytd ->> 'expenseReimbursementCents')::bigint + (report ->> 'expenseReimbursementCents')::bigint,
    'totalEarningsCents',
      (prior_ytd ->> 'shiftEarningsCents')::bigint
      + (prior_ytd ->> 'commissionEarningsCents')::bigint
      + (prior_ytd ->> 'bonusCents')::bigint
      + (prior_ytd ->> 'supplyCreditCents')::bigint
      + (prior_ytd ->> 'expenseReimbursementCents')::bigint
      + (report ->> 'currentTotalCents')::bigint
  );

  insert into public.pay_statements (
    payout_run_id, payout_run_item_id, account_id, operator_profile_id,
    statement_number, statement_label, status, version, issued_at,
    revised_from_statement_id, statement_payload, statement_generated_at,
    operator_notification_status, created_by, updated_by
  ) values (
    run_row.id, item_row.id, request_row.account_id, profile_row.id,
    statement_number, 'Pay Stub', 'draft', statement_version, null,
    previous_statement.id,
    jsonb_build_object(
      'schemaVersion', 'operator-pay-stub-v2',
      'statementNumber', statement_number,
      'statementLabel', 'Pay Stub',
      'status', 'draft',
      'version', statement_version,
      'statementDate', statement_date,
      'entity', jsonb_build_object(
        'accountId', account_row.id,
        'name', coalesce(nullif(account_row.payout_display_name, ''), account_row.name),
        'legalName', account_row.legal_name,
        'contactEmail', account_row.payout_contact_email,
        'address', jsonb_build_object(
          'line1', account_row.payout_address_line_1,
          'line2', account_row.payout_address_line_2,
          'city', account_row.payout_city,
          'state', account_row.payout_state,
          'postalCode', account_row.payout_postal_code
        )
      ),
      'contractor', jsonb_build_object(
        'operatorProfileId', profile_row.id,
        'displayName', profile_row.display_name,
        'workerType', profile_row.worker_type,
        'workerIdentifier', profile_row.worker_identifier,
        'positionTitle', profile_row.position_title,
        'noticeCode', public.operator_worker_notice_code(profile_row.worker_type)
      ),
      'period', jsonb_build_object(
        'payoutPeriodId', period_row.id,
        'periodStartDate', period_row.period_start_date,
        'periodEndDate', period_row.period_end_date
      ),
      'current', jsonb_build_object(
        'actualMinutes', (report ->> 'actualDurationMinutes')::integer,
        'paidShifts', (report ->> 'paidShifts')::integer,
        'shiftEarningsCents', (report ->> 'shiftEarningsCents')::integer,
        'commissionableSalesCents', (report ->> 'commissionableSalesCents')::integer,
        'commissionEarningsCents', (report ->> 'commissionEarningsCents')::integer,
        'bonusCents', (report ->> 'bonusCents')::integer,
        'supplyCreditCents', (report ->> 'supplyCreditCents')::integer,
        'expenseReimbursementCents', (report ->> 'expenseReimbursementCents')::integer,
        'totalEarningsCents', (report ->> 'currentTotalCents')::integer
      ),
      'yearToDate', current_ytd,
      'machines', report -> 'machines',
      'shiftRateLines', report -> 'shiftRateLines',
      'otherEarnings', report -> 'otherEarnings',
      'calculationMeta', report -> 'calculationMeta',
      'classificationNotice', case
        when profile_row.worker_type = 'contractor_1099'
        then 'Independent contractor statement. No payroll withholding or payment execution is represented.'
        else 'Compensation statement. This document does not represent payment execution.'
      end
    ),
    now(), 'not_sent', request_row.requested_by, request_row.requested_by
  ) returning * into statement_row;

  update public.pay_stub_generation_requests
  set pay_statement_id = statement_row.id
  where id = request_row.id;

  return jsonb_build_object(
    'requestId', request_row.id,
    'status', 'prepared',
    'statementId', statement_row.id,
    'statementNumber', statement_row.statement_number,
    'version', statement_row.version,
    'storageBucket', statement_row.storage_bucket,
    'storagePath', request_row.account_id::text || '/' || profile_row.id::text || '/'
      || to_char(period_row.period_start_date, 'YYYY-MM') || '/'
      || statement_row.id::text || '-v' || statement_row.version || '.pdf',
    'payload', statement_row.statement_payload
  );
end;
$$;

create or replace function public.service_complete_pay_stub(
  p_request_id uuid,
  p_pay_statement_id uuid,
  p_storage_path text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_row public.pay_stub_generation_requests;
  statement_row public.pay_statements;
begin
  if current_user not in ('postgres', 'service_role')
    and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Service role required';
  end if;

  select * into request_row
  from public.pay_stub_generation_requests request
  where request.id = p_request_id
    and request.status = 'processing'
    and request.pay_statement_id = p_pay_statement_id
  for update;
  if request_row.id is null then
    raise exception 'Processing Pay Stub request not found';
  end if;

  select * into statement_row
  from public.pay_statements statement
  where statement.id = p_pay_statement_id
    and statement.status = 'draft'
  for update;
  if statement_row.id is null then
    raise exception 'Prepared Pay Stub not found';
  end if;

  update public.pay_statements previous
  set
    status = 'revised',
    revision_reason = 'Superseded by regenerated Pay Stub',
    statement_payload = previous.statement_payload || jsonb_build_object(
      'status', 'revised',
      'revisionReason', 'Superseded by regenerated Pay Stub'
    )
  where previous.payout_run_item_id = statement_row.payout_run_item_id
    and previous.status = 'issued'
    and previous.id <> statement_row.id;

  update public.pay_statements
  set
    status = 'issued',
    storage_path = trim(p_storage_path),
    issued_at = now(),
    operator_notification_status = 'portal_published',
    operator_notified_at = now(),
    statement_payload = statement_payload || jsonb_build_object(
      'id', id,
      'status', 'issued',
      'issuedAt', now()
    )
  where id = statement_row.id
  returning * into statement_row;

  update public.pay_stub_generation_requests
  set status = 'completed', completed_at = now(), blocker_details = '[]'::jsonb
  where id = request_row.id;

  if request_row.trigger_kind = 'manager_regeneration' then
    insert into public.pay_stub_generation_requests (
      account_id,
      operator_profile_id,
      payout_period_id,
      trigger_kind,
      requested_by
    )
    select
      request_row.account_id,
      request_row.operator_profile_id,
      later_period.id,
      'manager_regeneration',
      request_row.requested_by
    from public.payout_periods current_period
    join public.payout_periods later_period
      on later_period.account_id = current_period.account_id
      and later_period.period_start_date > current_period.period_start_date
      and extract(year from later_period.period_start_date) =
        extract(year from current_period.period_start_date)
      and later_period.status <> 'voided'
    where current_period.id = request_row.payout_period_id
      and exists (
        select 1
        from public.pay_statements later_statement
        join public.payout_runs later_run on later_run.id = later_statement.payout_run_id
        where later_run.payout_period_id = later_period.id
          and later_statement.operator_profile_id = request_row.operator_profile_id
          and later_statement.status = 'issued'
      )
    on conflict (operator_profile_id, payout_period_id)
      where status in ('queued', 'processing')
    do nothing;
  end if;

  return jsonb_build_object(
    'requestId', request_row.id,
    'status', 'completed',
    'statementId', statement_row.id,
    'storageBucket', statement_row.storage_bucket,
    'storagePath', statement_row.storage_path
  );
end;
$$;

create or replace function public.service_fail_pay_stub(
  p_request_id uuid,
  p_error_message text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if current_user not in ('postgres', 'service_role')
    and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Service role required';
  end if;

  update public.pay_stub_generation_requests
  set
    status = 'failed',
    error_message = left(trim(coalesce(p_error_message, 'Pay Stub generation failed')), 1000),
    completed_at = now()
  where id = p_request_id
    and status = 'processing';
end;
$$;

revoke execute on function public.admin_request_pay_stub_generation(uuid, date)
  from public, anon;
grant execute on function public.admin_request_pay_stub_generation(uuid, date)
  to authenticated;
revoke execute on function public.service_enqueue_automatic_pay_stubs(timestamptz)
  from public, anon, authenticated;
revoke execute on function public.service_claim_pay_stub_generation_requests(integer)
  from public, anon, authenticated;
revoke execute on function public.service_claim_pay_stub_generation_request(uuid)
  from public, anon, authenticated;
revoke execute on function public.service_prepare_pay_stub(uuid)
  from public, anon, authenticated;
revoke execute on function public.service_refresh_pay_stub_revenue_snapshot(uuid, uuid)
  from public, anon, authenticated;
revoke execute on function public.service_complete_pay_stub(uuid, uuid, text)
  from public, anon, authenticated;
revoke execute on function public.service_fail_pay_stub(uuid, text)
  from public, anon, authenticated;
grant execute on function public.service_enqueue_automatic_pay_stubs(timestamptz),
  public.service_claim_pay_stub_generation_requests(integer),
  public.service_claim_pay_stub_generation_request(uuid),
  public.service_refresh_pay_stub_revenue_snapshot(uuid, uuid),
  public.service_prepare_pay_stub(uuid),
  public.service_complete_pay_stub(uuid, uuid, text),
  public.service_fail_pay_stub(uuid, text)
  to service_role;

comment on table public.pay_stub_generation_requests is
  'Durable, retry-safe queue for automatic and manager-requested Pay Stub PDF generation after the Technician cutoff.';
comment on function public.service_enqueue_automatic_pay_stubs(timestamptz) is
  'Service-only scheduler target. Enqueues one automatic Pay Stub per active Technician and locked monthly period; it does not execute payment.';

create or replace function public.get_my_operator_pay_statement_context()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_user_id uuid := auth.uid();
  result jsonb;
begin
  if actor_user_id is null then
    raise exception 'Authentication required';
  end if;

  select jsonb_build_object(
    'profiles', coalesce(jsonb_agg(jsonb_build_object(
      'id', profile.id,
      'accountId', profile.account_id,
      'accountName', account.name,
      'displayName', profile.display_name,
      'workerType', profile.worker_type,
      'statements', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', statement.id,
          'statementNumber', statement.statement_number,
          'statementLabel', statement.statement_label,
          'status', statement.status,
          'version', statement.version,
          'issuedAt', statement.issued_at,
          'storageBucket', statement.storage_bucket,
          'storagePath', statement.storage_path,
          'notificationStatus', statement.operator_notification_status,
          'totalPayoutCents', item.total_payout_cents,
          'periodStartDate', period.period_start_date,
          'periodEndDate', period.period_end_date,
          'targetPayoutDate', period.target_payout_date,
          'revisionCount', coalesce((
            select count(*)::integer
            from public.pay_statements history
            where history.payout_run_item_id = statement.payout_run_item_id
              and history.status = 'revised'
          ), 0),
          'downloadFileName', lower(regexp_replace(
            statement.statement_number,
            '[^a-zA-Z0-9_-]+', '-', 'g'
          )) || '.pdf'
        ) order by period.period_start_date desc, statement.issued_at desc)
        from public.pay_statements statement
        join public.payout_run_items item on item.id = statement.payout_run_item_id
        join public.payout_runs run on run.id = statement.payout_run_id
        join public.payout_periods period on period.id = run.payout_period_id
        where statement.operator_profile_id = profile.id
          and statement.status = 'issued'
          and statement.storage_path is not null
      ), '[]'::jsonb)
    ) order by account.name, profile.display_name), '[]'::jsonb)
  ) into result
  from public.operator_payout_profiles profile
  join public.customer_accounts account on account.id = profile.account_id
  where profile.user_id = actor_user_id
    and profile.status = 'active';

  return result;
end;
$$;

create or replace function public.get_pay_statement_artifact(
  p_pay_statement_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_user_id uuid := auth.uid();
  statement_row public.pay_statements;
begin
  if actor_user_id is null then
    raise exception 'Authentication required';
  end if;

  select * into statement_row
  from public.pay_statements statement
  where statement.id = p_pay_statement_id;

  if statement_row.id is null
    or statement_row.status <> 'issued'
    or statement_row.storage_path is null
    or not public.can_access_pay_statement(actor_user_id, statement_row.id) then
    raise exception 'Published Pay Stub access required';
  end if;

  return jsonb_build_object(
    'statement', statement_row.statement_payload || jsonb_build_object(
      'id', statement_row.id,
      'status', statement_row.status,
      'version', statement_row.version,
      'issuedAt', statement_row.issued_at
    ),
    'artifact', jsonb_build_object(
      'format', 'pdf',
      'source', 'private_storage',
      'storageBucket', statement_row.storage_bucket,
      'storagePath', statement_row.storage_path,
      'downloadFileName', lower(regexp_replace(
        statement_row.statement_number,
        '[^a-zA-Z0-9_-]+', '-', 'g'
      )) || '.pdf'
    )
  );
end;
$$;

revoke execute on function public.get_my_operator_pay_statement_context()
  from public, anon;
grant execute on function public.get_my_operator_pay_statement_context()
  to authenticated;
revoke execute on function public.get_pay_statement_artifact(uuid)
  from public, anon;
grant execute on function public.get_pay_statement_artifact(uuid)
  to authenticated;
