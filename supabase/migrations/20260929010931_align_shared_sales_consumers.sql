-- #1572: bind reporting and compensation consumers to the shared, source-aware
-- machine/day calculation from #1571. Finance's location-specific rules remain
-- an activation dependency; unresolved basis stays explicit and contributes no
-- invented normalized amount.

-- Preserve the deployed calculations until the separately controlled
-- recognition rollout is activated. These aliases also give issued-period
-- reconciliation the legacy comparison path before cutover.
alter function public.operator_revenue_snapshot_source_values(uuid, uuid)
  rename to operator_revenue_snapshot_source_values_before_shared_basis;
alter function private.operator_machine_tax_snapshot(uuid, date, date)
  rename to operator_machine_tax_snapshot_before_shared_basis;
alter function private.operator_machine_tax_commission(uuid, uuid, uuid, date, date)
  rename to operator_machine_tax_commission_before_shared_basis;
alter function public.get_sales_report(date, date, text, uuid[], uuid[], text[])
  rename to get_sales_report_before_shared_basis;
alter function public.get_sales_report(jsonb)
  rename to get_sales_report_before_shared_basis;

-- A request denial can make the period's signed refund impact negative. Unknown
-- financial bases must remain NULL instead of becoming a false zero. Existing
-- issued numeric snapshots are unchanged; new unresolved snapshots use the
-- established missing_machine_tax_rate unavailable presentation.
alter table public.payout_period_machine_revenue_snapshots
  alter column gross_sales_cents drop not null,
  alter column refund_adjustment_cents drop not null,
  alter column tax_cents drop not null,
  alter column net_revenue_cents drop not null,
  alter column eligible_commission_revenue_cents drop not null;

do $$
declare
  constraint_row record;
begin
  for constraint_row in
    select constraint_definition.conname
    from pg_catalog.pg_constraint constraint_definition
    where constraint_definition.conrelid =
      'public.payout_period_machine_revenue_snapshots'::regclass
      and constraint_definition.contype = 'c'
      and pg_catalog.pg_get_constraintdef(constraint_definition.oid)
        ilike '%refund_adjustment_cents%>=%0%'
  loop
    execute format(
      'alter table public.payout_period_machine_revenue_snapshots drop constraint %I',
      constraint_row.conname
    );
  end loop;
end;
$$;

create or replace function public.operator_revenue_snapshot_source_values(
  p_payout_period_id uuid,
  p_reporting_machine_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  period_row public.payout_periods;
  machine_row public.reporting_machines;
  totals record;
  warnings jsonb := '[]'::jsonb;
begin
  if not exists (
    select 1 from private.refund_request_recognition_rollout rollout
    where rollout.singleton
      and rollout.activated_at is not null
  ) then
    return public.operator_revenue_snapshot_source_values_before_shared_basis(
      p_payout_period_id,
      p_reporting_machine_id
    );
  end if;

  select * into period_row
  from public.payout_periods period
  where period.id = p_payout_period_id;

  if period_row.id is null then
    raise exception 'Payout period not found';
  end if;

  select * into machine_row
  from public.reporting_machines machine
  where machine.id = p_reporting_machine_id
    and machine.account_id = period_row.account_id;

  if machine_row.id is null then
    raise exception 'Reporting machine not found for payout account';
  end if;

  select
    coalesce(sum(component.sales_ex_tax_cents), 0)::bigint as gross_sales_cents,
    coalesce(sum(
      component.request_deduction_ex_tax_cents
      + component.legacy_paid_deduction_ex_tax_cents
      - component.refund_reversal_ex_tax_cents
    ), 0)::bigint as refund_adjustment_cents,
    coalesce(sum(component.commissionable_sales_ex_tax_cents), 0)::bigint
      as net_revenue_cents,
    coalesce(sum(component.sales_transaction_count), 0)::bigint as transaction_count,
    count(*) filter (
      where component.recorded_sales_cents <> 0
        or component.sales_transaction_count <> 0
    )::integer as source_sales_row_count,
    count(*) filter (
      where component.request_deduction_ex_tax_cents <> 0
        or component.refund_reversal_ex_tax_cents <> 0
        or component.legacy_paid_deduction_ex_tax_cents <> 0
        or component.paid_context_ex_tax_cents <> 0
        or component.outstanding_context_ex_tax_cents <> 0
    )::integer as source_adjustment_row_count,
    max(component.purchase_attribution_date) filter (
      where component.recorded_sales_cents <> 0
        or component.sales_transaction_count <> 0
    ) as source_latest_sale_date,
    max(component.booking_date) filter (
      where component.request_deduction_ex_tax_cents <> 0
        or component.refund_reversal_ex_tax_cents <> 0
        or component.legacy_paid_deduction_ex_tax_cents <> 0
        or component.paid_context_ex_tax_cents <> 0
        or component.outstanding_context_ex_tax_cents <> 0
    ) as source_latest_adjustment_date,
    coalesce(sum(component.unresolved_sales_count), 0)::bigint
      as unresolved_sales_count,
    coalesce(sum(component.unresolved_sales_cents), 0)::bigint
      as unresolved_sales_cents,
    coalesce(sum(component.unresolved_refund_count), 0)::bigint
      as unresolved_refund_count,
    coalesce(sum(component.unresolved_refund_cents), 0)::bigint
      as unresolved_refund_cents,
    coalesce(sum(component.unresolved_paid_context_count), 0)::bigint
      as unresolved_paid_context_count,
    coalesce(sum(component.unresolved_paid_context_cents), 0)::bigint
      as unresolved_paid_context_cents,
    coalesce(jsonb_agg(jsonb_build_object(
      'bookingDate', component.booking_date,
      'purchaseAttributionDate', component.purchase_attribution_date,
      'locationId', component.reporting_location_id,
      'tender', component.tender,
      'source', component.source,
      'normalizationStatus', component.normalization_status,
      'salesExTaxCents', component.sales_ex_tax_cents,
      'salesTaxCents', component.sales_tax_cents,
      'requestDeductionExTaxCents', component.request_deduction_ex_tax_cents,
      'refundReversalExTaxCents', component.refund_reversal_ex_tax_cents,
      'legacyPaidDeductionExTaxCents', component.legacy_paid_deduction_ex_tax_cents,
      'paidContextExTaxCents', component.paid_context_ex_tax_cents,
      'outstandingContextExTaxCents', component.outstanding_context_ex_tax_cents
    ) order by component.booking_date, component.purchase_attribution_date,
      component.tender, component.source), '[]'::jsonb) as components
  into totals
  from private.machine_sales_daily_components(
    machine_row.id,
    period_row.period_start_date,
    period_row.period_end_date
  ) component;

  if totals.source_sales_row_count = 0 then
    warnings := warnings || jsonb_build_array(jsonb_build_object(
      'code', 'missing_sales_source',
      'severity', 'blocker',
      'message', 'No sales facts were found for this machine in the payout period.'
    ));
  end if;

  if totals.source_latest_sale_date is null
    or totals.source_latest_sale_date < period_row.period_end_date then
    warnings := warnings || jsonb_build_array(jsonb_build_object(
      'code', 'stale_sales_source',
      'severity', 'warning',
      'message', 'Sales freshness could not be confirmed through the payout period end date.',
      'latestSaleDate', totals.source_latest_sale_date
    ));
  end if;

  if totals.net_revenue_cents < 0 then
    warnings := warnings || jsonb_build_array(jsonb_build_object(
      'code', 'negative_net_revenue_clamped',
      'severity', 'warning',
      'message', 'Refund impact exceeds sales; eligible commission revenue was clamped to zero.'
    ));
  end if;

  return jsonb_build_object(
    'accountId', period_row.account_id,
    'payoutPeriodId', period_row.id,
    'payoutPolicyId', period_row.payout_policy_id,
    'machineId', machine_row.id,
    'locationId', machine_row.location_id,
    'periodStartDate', period_row.period_start_date,
    'periodEndDate', period_row.period_end_date,
    'grossSalesCents', case when totals.unresolved_sales_count > 0
      then null else totals.gross_sales_cents end,
    'refundAdjustmentCents', case when totals.unresolved_refund_count > 0
      then null else totals.refund_adjustment_cents end,
    'netRevenueCents', case when totals.unresolved_sales_count > 0
        or totals.unresolved_refund_count > 0
      then null else totals.net_revenue_cents end,
    'eligibleCommissionRevenueCents', case
      when totals.unresolved_sales_count > 0 or totals.unresolved_refund_count > 0
        then null
      else greatest(totals.net_revenue_cents, 0) end,
    'transactionCount', totals.transaction_count,
    'sourceSalesRowCount', totals.source_sales_row_count,
    'sourceAdjustmentRowCount', totals.source_adjustment_row_count,
    'sourceLatestSaleDate', totals.source_latest_sale_date,
    'sourceLatestAdjustmentDate', totals.source_latest_adjustment_date,
    'sourceMetadata', jsonb_build_object(
      'salesCalculationVersion', 'shared-sales-basis-v1',
      'components', totals.components,
      'unresolvedSalesCount', totals.unresolved_sales_count,
      'unresolvedSalesCents', totals.unresolved_sales_cents,
      'unresolvedRefundCount', totals.unresolved_refund_count,
      'unresolvedRefundCents', totals.unresolved_refund_cents,
      'unresolvedPaidContextCount', totals.unresolved_paid_context_count,
      'unresolvedPaidContextCents', totals.unresolved_paid_context_cents,
      'calculationComplete', totals.unresolved_sales_count = 0
        and totals.unresolved_refund_count = 0,
      'rawProviderPayloadsIncluded', false,
      'sourceRowHashesIncluded', false
    ),
    'warnings', warnings
  );
end;
$$;

create function private.operator_machine_tax_snapshot_shared(
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
  with components as materialized (
    select
      component.*,
      rate.tax_rate_percent
    from private.machine_sales_daily_components(
      p_reporting_machine_id,
      p_period_start_date,
      p_period_end_date
    ) component
    left join lateral (
      select configured.tax_rate_percent
      from public.reporting_machine_tax_rates configured
      where configured.machine_id = component.reporting_machine_id
        and configured.status = 'active'
        and configured.effective_start_date <= component.purchase_attribution_date
        and coalesce(configured.effective_end_date, 'infinity'::date)
          >= component.purchase_attribution_date
      order by configured.effective_start_date desc, configured.created_at desc, configured.id
      limit 1
    ) rate on true
  ),
  segments as materialized (
    select
      component.booking_date,
      component.purchase_attribution_date,
      component.reporting_location_id,
      component.tender,
      component.source,
      component.normalization_status,
      component.tax_rate_percent,
      sum(component.sales_transaction_count)::bigint as sales_transaction_count,
      sum(component.sales_ex_tax_cents)::bigint as gross_sales_cents,
      sum(component.sales_tax_cents)::bigint as tax_cents,
      sum(component.request_deduction_ex_tax_cents)::bigint as request_deduction_cents,
      sum(component.legacy_paid_deduction_ex_tax_cents)::bigint as legacy_paid_deduction_cents,
      sum(component.refund_reversal_ex_tax_cents)::bigint as refund_reversal_cents,
      sum(component.paid_context_ex_tax_cents)::bigint as paid_context_cents,
      sum(component.outstanding_context_ex_tax_cents)::bigint as outstanding_context_cents,
      sum(component.unresolved_sales_count)::bigint as unresolved_sales_count,
      sum(component.unresolved_refund_count)::bigint as unresolved_refund_count,
      sum(component.unresolved_paid_context_count)::bigint as unresolved_paid_context_count,
      sum(component.commissionable_sales_ex_tax_cents)::bigint as net_revenue_cents
    from components component
    group by component.booking_date, component.purchase_attribution_date,
      component.reporting_location_id, component.tender, component.source,
      component.normalization_status, component.tax_rate_percent
  )
  select jsonb_build_object(
    'calculationVersion', 'shared-sales-basis-v1',
    'grossSalesCents', case
      when coalesce(sum(segment.unresolved_sales_count), 0) > 0 then null
      else coalesce(sum(segment.gross_sales_cents), 0)::bigint end,
    'refundAdjustmentCents', case
      when coalesce(sum(segment.unresolved_refund_count), 0) > 0 then null
      else coalesce(sum(
        segment.request_deduction_cents + segment.legacy_paid_deduction_cents
          - segment.refund_reversal_cents
      ), 0)::bigint end,
    'refundRequestDeductionCents', coalesce(sum(segment.request_deduction_cents), 0)::bigint,
    'legacyPaidDeductionCents', coalesce(sum(segment.legacy_paid_deduction_cents), 0)::bigint,
    'refundReversalCents', coalesce(sum(segment.refund_reversal_cents), 0)::bigint,
    'refundPaidContextCents', coalesce(sum(segment.paid_context_cents), 0)::bigint,
    'refundOutstandingContextCents', coalesce(sum(segment.outstanding_context_cents), 0)::bigint,
    'unresolvedPaidContextCount', coalesce(sum(segment.unresolved_paid_context_count), 0)::bigint,
    'taxCents', case
      when coalesce(sum(segment.unresolved_sales_count), 0) > 0 then null
      else coalesce(sum(segment.tax_cents), 0)::bigint end,
    'netRevenueCents', case
      when coalesce(sum(
        segment.unresolved_sales_count + segment.unresolved_refund_count
      ), 0) > 0 then null
      else coalesce(sum(segment.net_revenue_cents), 0)::bigint end,
    'commissionableSalesCents', case
      when coalesce(sum(
        segment.unresolved_sales_count + segment.unresolved_refund_count
      ), 0) > 0 then null
      else greatest(coalesce(sum(segment.net_revenue_cents), 0), 0)::bigint end,
    'taxRateCompleteForSales', coalesce(sum(
      segment.unresolved_sales_count + segment.unresolved_refund_count
    ), 0) = 0,
    'segments', coalesce(jsonb_agg(jsonb_build_object(
      'segmentStartDate', segment.booking_date,
      'segmentEndDate', segment.booking_date,
      'purchaseAttributionDate', segment.purchase_attribution_date,
      'locationId', segment.reporting_location_id,
      'tender', segment.tender,
      'source', segment.source,
      'normalizationStatus', segment.normalization_status,
      'taxRatePercent', segment.tax_rate_percent,
      'grossSalesCents', case when segment.unresolved_sales_count > 0 then null
        else segment.gross_sales_cents end,
      'refundAdjustmentCents', case when segment.unresolved_refund_count > 0 then null
        else segment.request_deduction_cents + segment.legacy_paid_deduction_cents
          - segment.refund_reversal_cents end,
      'refundRequestDeductionCents', segment.request_deduction_cents,
      'legacyPaidDeductionCents', segment.legacy_paid_deduction_cents,
      'refundReversalCents', segment.refund_reversal_cents,
      'refundPaidContextCents', segment.paid_context_cents,
      'refundOutstandingContextCents', segment.outstanding_context_cents,
      'unresolvedPaidContextCount', segment.unresolved_paid_context_count,
      'taxCents', case when segment.unresolved_sales_count > 0 then null
        else segment.tax_cents end,
      'netRevenueCents', case
        when segment.unresolved_sales_count + segment.unresolved_refund_count > 0 then null
        else segment.net_revenue_cents end,
      'commissionableSalesCents', case
        when segment.unresolved_sales_count + segment.unresolved_refund_count > 0 then null
        else greatest(segment.net_revenue_cents, 0) end,
      'transactionCount', segment.sales_transaction_count
    ) order by segment.booking_date, segment.purchase_attribution_date,
      segment.tender, segment.source), '[]'::jsonb)
  )
  from segments segment;
$$;

create function private.operator_machine_tax_snapshot(
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
  select case when exists (
    select 1 from private.refund_request_recognition_rollout rollout
    where rollout.singleton
      and rollout.activated_at is not null
  ) then private.operator_machine_tax_snapshot_shared(
    p_reporting_machine_id, p_period_start_date, p_period_end_date
  ) else private.operator_machine_tax_snapshot_before_shared_basis(
    p_reporting_machine_id, p_period_start_date, p_period_end_date
  ) end;
$$;

create function private.operator_machine_tax_commission_shared(
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
  with attributed as materialized (
    select
      component.*,
      public.operator_compensation_rate_at(
        p_account_id,
        p_operator_profile_id,
        p_reporting_machine_id,
        component.purchase_attribution_date,
        'commission'
      ) as commission_rate,
      rate.tax_rate_percent
    from private.machine_sales_daily_components(
      p_reporting_machine_id,
      p_period_start_date,
      p_period_end_date
    ) component
    left join lateral (
      select configured.tax_rate_percent
      from public.reporting_machine_tax_rates configured
      where configured.machine_id = component.reporting_machine_id
        and configured.status = 'active'
        and configured.effective_start_date <= component.purchase_attribution_date
        and coalesce(configured.effective_end_date, 'infinity'::date)
          >= component.purchase_attribution_date
      order by configured.effective_start_date desc, configured.created_at desc, configured.id
      limit 1
    ) rate on true
    where component.purchase_attribution_date is null
      or exists (
      select 1
      from public.operator_machine_assignments assignment
      where assignment.account_id = p_account_id
        and assignment.operator_profile_id = p_operator_profile_id
        and assignment.reporting_machine_id = p_reporting_machine_id
        and component.purchase_attribution_date between assignment.effective_start_date
          and coalesce(assignment.effective_end_date, 'infinity'::date)
    )
  ),
  segments as materialized (
    select
      attributed.booking_date,
      attributed.purchase_attribution_date,
      attributed.reporting_location_id,
      attributed.tender,
      attributed.source,
      attributed.normalization_status,
      attributed.tax_rate_percent,
      attributed.commission_rate,
      nullif(attributed.commission_rate ->> 'commissionBasisPoints', '')::integer
        as commission_basis_points,
      sum(attributed.sales_transaction_count)::bigint as sales_transaction_count,
      sum(attributed.sales_ex_tax_cents)::bigint as gross_sales_cents,
      sum(attributed.sales_tax_cents)::bigint as tax_cents,
      sum(attributed.request_deduction_ex_tax_cents)::bigint as request_deduction_cents,
      sum(attributed.legacy_paid_deduction_ex_tax_cents)::bigint as legacy_paid_deduction_cents,
      sum(attributed.refund_reversal_ex_tax_cents)::bigint as refund_reversal_cents,
      sum(attributed.paid_context_ex_tax_cents)::bigint as paid_context_cents,
      sum(attributed.outstanding_context_ex_tax_cents)::bigint as outstanding_context_cents,
      sum(attributed.unresolved_sales_count)::bigint as unresolved_sales_count,
      sum(attributed.unresolved_refund_count)::bigint as unresolved_refund_count,
      sum(attributed.unresolved_paid_context_count)::bigint as unresolved_paid_context_count,
      sum(attributed.commissionable_sales_ex_tax_cents)::bigint as net_revenue_cents,
      count(*) filter (
        where attributed.recorded_sales_cents <> 0
          or attributed.sales_transaction_count <> 0
      )::integer as source_sales_row_count,
      count(*) filter (
        where attributed.request_deduction_ex_tax_cents <> 0
          or attributed.refund_reversal_ex_tax_cents <> 0
          or attributed.legacy_paid_deduction_ex_tax_cents <> 0
          or attributed.paid_context_ex_tax_cents <> 0
          or attributed.outstanding_context_ex_tax_cents <> 0
      )::integer as source_adjustment_row_count,
      max(attributed.purchase_attribution_date) filter (
        where attributed.recorded_sales_cents <> 0
          or attributed.sales_transaction_count <> 0
      ) as source_latest_sale_date
    from attributed
    group by attributed.booking_date, attributed.purchase_attribution_date,
      attributed.reporting_location_id, attributed.tender, attributed.source,
      attributed.normalization_status, attributed.tax_rate_percent,
      attributed.commission_rate
  ),
  rate_buckets as materialized (
    select
      min(segment.booking_date) as segment_start_date,
      max(segment.booking_date) as segment_end_date,
      min(segment.purchase_attribution_date) as purchase_attribution_date,
      (array_agg(segment.reporting_location_id order by
        segment.purchase_attribution_date, segment.booking_date))[1] as reporting_location_id,
      segment.commission_rate,
      segment.commission_basis_points,
      sum(segment.gross_sales_cents)::bigint as gross_sales_cents,
      sum(segment.tax_cents)::bigint as tax_cents,
      sum(segment.request_deduction_cents)::bigint as request_deduction_cents,
      sum(segment.legacy_paid_deduction_cents)::bigint as legacy_paid_deduction_cents,
      sum(segment.refund_reversal_cents)::bigint as refund_reversal_cents,
      sum(segment.paid_context_cents)::bigint as paid_context_cents,
      sum(segment.outstanding_context_cents)::bigint as outstanding_context_cents,
      sum(segment.unresolved_sales_count)::bigint as unresolved_sales_count,
      sum(segment.unresolved_refund_count)::bigint as unresolved_refund_count,
      sum(segment.unresolved_paid_context_count)::bigint as unresolved_paid_context_count,
      sum(segment.net_revenue_cents)::bigint as net_revenue_cents,
      coalesce(bool_or(
        segment.purchase_attribution_date is null
        and (
          segment.gross_sales_cents <> 0
          or segment.request_deduction_cents <> 0
          or segment.legacy_paid_deduction_cents <> 0
          or segment.refund_reversal_cents <> 0
          or segment.unresolved_sales_count > 0
          or segment.unresolved_refund_count > 0
        )
      ), false) as purchase_attribution_missing,
      sum(segment.source_sales_row_count)::integer as source_sales_row_count,
      sum(segment.source_adjustment_row_count)::integer as source_adjustment_row_count,
      max(segment.source_latest_sale_date) as source_latest_sale_date
    from segments segment
    group by segment.commission_rate, segment.commission_basis_points
  ),
  scope as materialized (
    select
      count(distinct segment.commission_basis_points)
        filter (where segment.commission_basis_points is not null)::integer
        as commission_rate_count,
      coalesce(bool_or(
        segment.purchase_attribution_date is not null
        and segment.commission_rate is null
        and (
          segment.gross_sales_cents <> 0
          or segment.request_deduction_cents + segment.legacy_paid_deduction_cents
            <> segment.refund_reversal_cents
        )
      ), false) as commission_rate_missing,
      coalesce(sum(segment.unresolved_sales_count), 0) > 0 as sales_basis_missing,
      coalesce(sum(segment.unresolved_refund_count), 0) > 0 as refund_basis_missing,
      coalesce(sum(segment.unresolved_sales_count + segment.unresolved_refund_count), 0) > 0
        as tax_basis_missing,
      coalesce(bool_or(
        segment.purchase_attribution_date is null
        and (
          segment.gross_sales_cents <> 0
          or segment.request_deduction_cents <> 0
          or segment.legacy_paid_deduction_cents <> 0
          or segment.refund_reversal_cents <> 0
          or segment.unresolved_sales_count > 0
          or segment.unresolved_refund_count > 0
        )
      ), false) as purchase_attribution_missing
    from segments segment
  ),
  totals as materialized (
    select
      coalesce(sum(segment.gross_sales_cents), 0)::bigint as gross_sales_cents,
      coalesce(sum(segment.request_deduction_cents), 0)::bigint
        as request_deduction_cents,
      coalesce(sum(segment.legacy_paid_deduction_cents), 0)::bigint
        as legacy_paid_deduction_cents,
      coalesce(sum(segment.refund_reversal_cents), 0)::bigint as refund_reversal_cents,
      coalesce(sum(segment.paid_context_cents), 0)::bigint as paid_context_cents,
      coalesce(sum(segment.outstanding_context_cents), 0)::bigint as outstanding_context_cents,
      coalesce(sum(segment.tax_cents), 0)::bigint as tax_cents,
      coalesce(sum(segment.net_revenue_cents), 0)::bigint as net_revenue_cents,
      coalesce((select sum(greatest(bucket.net_revenue_cents, 0))
        from rate_buckets bucket), 0)::bigint as commissionable_sales_cents,
      coalesce(sum(segment.source_sales_row_count), 0)::integer as source_sales_row_count,
      coalesce(sum(segment.source_adjustment_row_count), 0)::integer
        as source_adjustment_row_count,
      max(segment.source_latest_sale_date) as source_latest_sale_date
    from segments segment
  )
  select jsonb_build_object(
    'calculationVersion', 'shared-sales-basis-v1',
    'grossSalesCents', case when scope.sales_basis_missing then null
      else totals.gross_sales_cents end,
    'refundAdjustmentCents', case when scope.refund_basis_missing then null
      else totals.request_deduction_cents
        + totals.legacy_paid_deduction_cents - totals.refund_reversal_cents end,
    'refundRequestDeductionCents', totals.request_deduction_cents,
    'legacyPaidDeductionCents', totals.legacy_paid_deduction_cents,
    'refundReversalCents', totals.refund_reversal_cents,
    'refundPaidContextCents', totals.paid_context_cents,
    'refundOutstandingContextCents', totals.outstanding_context_cents,
    'unresolvedPaidContextCount', coalesce(sum(bucket.unresolved_paid_context_count), 0),
    'taxCents', case when scope.sales_basis_missing then null else totals.tax_cents end,
    'netRevenueCents', case when scope.tax_basis_missing then null
      else totals.net_revenue_cents end,
    'commissionableSalesCents', case
      when scope.tax_basis_missing or scope.purchase_attribution_missing then null
      else totals.commissionable_sales_cents end,
    'commissionEarningsCents', case
      when scope.commission_rate_missing
        or scope.tax_basis_missing
        or scope.purchase_attribution_missing
      then 0
      else coalesce(sum(round(
        greatest(bucket.net_revenue_cents, 0)::numeric
        * bucket.commission_basis_points
        / 10000
      )), 0)::bigint
    end,
    'commissionRate', case
      when scope.commission_rate_count = 1
      then (array_agg(bucket.commission_rate order by bucket.purchase_attribution_date))[1]
      else null
    end,
    'commissionBasisPoints', case
      when scope.commission_rate_count = 1 then max(bucket.commission_basis_points)
      else null
    end,
    'commissionRateCompleteForPeriod', not scope.commission_rate_missing,
    'taxRateCompleteForSales', not scope.tax_basis_missing,
    'commissionAllocationResolved', not scope.purchase_attribution_missing,
    'sourceSalesRowCount', totals.source_sales_row_count,
    'sourceAdjustmentRowCount', totals.source_adjustment_row_count,
    'sourceLatestSaleDate', totals.source_latest_sale_date,
    'segments', coalesce(jsonb_agg(jsonb_build_object(
      'segmentStartDate', bucket.segment_start_date,
      'segmentEndDate', bucket.segment_end_date,
      'purchaseAttributionDate', bucket.purchase_attribution_date,
      'locationId', bucket.reporting_location_id,
      'commissionRate', bucket.commission_rate,
      'commissionBasisPoints', bucket.commission_basis_points,
      'grossSalesCents', case when bucket.unresolved_sales_count > 0 then null
        else bucket.gross_sales_cents end,
      'refundAdjustmentCents', case when bucket.unresolved_refund_count > 0 then null
        else bucket.request_deduction_cents + bucket.legacy_paid_deduction_cents
          - bucket.refund_reversal_cents end,
      'refundRequestDeductionCents', bucket.request_deduction_cents,
      'legacyPaidDeductionCents', bucket.legacy_paid_deduction_cents,
      'refundReversalCents', bucket.refund_reversal_cents,
      'refundPaidContextCents', bucket.paid_context_cents,
      'refundOutstandingContextCents', bucket.outstanding_context_cents,
      'unresolvedPaidContextCount', bucket.unresolved_paid_context_count,
      'taxCents', case when bucket.unresolved_sales_count > 0 then null
        else bucket.tax_cents end,
      'netRevenueCents', case
        when bucket.unresolved_sales_count + bucket.unresolved_refund_count > 0 then null
        else bucket.net_revenue_cents end,
      'commissionableSalesCents', case
        when bucket.unresolved_sales_count + bucket.unresolved_refund_count > 0
          or bucket.purchase_attribution_missing then null
        else greatest(bucket.net_revenue_cents, 0) end,
      'commissionEarningsCents', case
        when scope.commission_rate_missing
          or scope.tax_basis_missing
          or bucket.purchase_attribution_missing
        then 0
        else round(
          greatest(bucket.net_revenue_cents, 0)::numeric
          * bucket.commission_basis_points / 10000
        )::bigint
      end,
      'sourceSalesRowCount', bucket.source_sales_row_count,
      'sourceAdjustmentRowCount', bucket.source_adjustment_row_count,
      'sourceLatestSaleDate', bucket.source_latest_sale_date
    ) order by bucket.segment_start_date, bucket.commission_basis_points), '[]'::jsonb)
  )
  from totals
  cross join scope
  left join rate_buckets bucket on true
  group by totals.gross_sales_cents, totals.request_deduction_cents,
    totals.legacy_paid_deduction_cents, totals.refund_reversal_cents,
    totals.paid_context_cents,
    totals.outstanding_context_cents, totals.tax_cents, totals.net_revenue_cents,
    totals.commissionable_sales_cents, totals.source_sales_row_count,
    totals.source_adjustment_row_count, totals.source_latest_sale_date,
    scope.commission_rate_count, scope.commission_rate_missing,
    scope.sales_basis_missing, scope.refund_basis_missing,
    scope.tax_basis_missing, scope.purchase_attribution_missing;
$$;

create function private.operator_machine_tax_commission(
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
  select case when exists (
    select 1 from private.refund_request_recognition_rollout rollout
    where rollout.singleton
      and rollout.activated_at is not null
  ) then private.operator_machine_tax_commission_shared(
    p_account_id, p_operator_profile_id, p_reporting_machine_id,
    p_period_start_date, p_period_end_date
  ) else private.operator_machine_tax_commission_before_shared_basis(
    p_account_id, p_operator_profile_id, p_reporting_machine_id,
    p_period_start_date, p_period_end_date
  ) end;
$$;

create or replace function private.sales_report_legacy_rows_for_actor(
  p_actor_user_id uuid,
  p_date_from date,
  p_date_to date,
  p_grain text default 'week',
  p_machine_ids uuid[] default null,
  p_location_ids uuid[] default null,
  p_payment_methods text[] default null
)
returns table (
  calculation_version text,
  period_start date,
  machine_id uuid,
  machine_label text,
  location_id uuid,
  location_name text,
  payment_method text,
  net_sales_cents bigint,
  refund_amount_cents bigint,
  gross_sales_cents bigint,
  tax_cents bigint,
  refund_request_deduction_cents bigint,
  refund_reversal_cents bigint,
  refund_legacy_paid_deduction_cents bigint,
  refund_paid_context_cents bigint,
  refund_outstanding_context_cents bigint,
  unresolved_sales_count bigint,
  unresolved_sales_cents bigint,
  unresolved_refund_count bigint,
  unresolved_refund_cents bigint,
  unresolved_paid_context_count bigint,
  unresolved_paid_context_cents bigint,
  transaction_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  normalized_grain text := lower(coalesce(nullif(trim(p_grain), ''), 'week'));
begin
  if p_actor_user_id is null then
    raise exception 'Report actor is required';
  end if;
  if p_date_from is null or p_date_to is null then
    raise exception 'Date range is required';
  end if;
  if p_date_from > p_date_to then
    raise exception 'Date range is invalid';
  end if;
  if normalized_grain not in ('day', 'week', 'month') then
    raise exception 'Invalid report grain: %', p_grain;
  end if;

  return query
  with accessible_machines as materialized (
    select machine.id as machine_id, machine.machine_label
    from public.reporting_machines machine
    where public.has_reporting_machine_access(p_actor_user_id, machine.id)
      and (p_machine_ids is null or cardinality(p_machine_ids) = 0
        or machine.id = any(p_machine_ids))
  ),
  sales_by_method as (
    select
      date_trunc(normalized_grain, fact.sale_date::timestamp)::date as report_period_start,
      fact.reporting_machine_id,
      fact.reporting_location_id,
      fact.payment_method as report_payment_method,
      sum(fact.net_sales_cents)::bigint as recorded_sales_cents,
      sum(fact.transaction_count)::bigint as report_transaction_count
    from public.machine_sales_facts fact
    join accessible_machines machine on machine.machine_id = fact.reporting_machine_id
    where fact.sale_date between p_date_from and p_date_to
      and (p_location_ids is null or cardinality(p_location_ids) = 0
        or fact.reporting_location_id = any(p_location_ids))
    group by date_trunc(normalized_grain, fact.sale_date::timestamp)::date,
      fact.reporting_machine_id, fact.reporting_location_id, fact.payment_method
  ),
  adjustment_evidence as (
    select
      date_trunc(normalized_grain, adjustment.adjustment_date::timestamp)::date
        as report_period_start,
      adjustment.reporting_machine_id,
      adjustment.reporting_location_id,
      case
        when adjustment.source = 'nayax_provider_refund' then 'credit'
        when refund_case.payment_method = 'card' then 'credit'
        when refund_case.payment_method = 'cash' then 'cash'
        when lower(trim(adjustment.raw_payload ->> 'payment_method')) in ('card', 'credit') then 'credit'
        when lower(trim(adjustment.raw_payload ->> 'payment_method')) = 'cash' then 'cash'
        when lower(trim(adjustment.raw_payload ->> 'payment_method')) = 'other' then 'other'
        else 'unknown'
      end as report_payment_method,
      adjustment.amount_cents
    from public.sales_adjustment_facts adjustment
    join accessible_machines machine on machine.machine_id = adjustment.reporting_machine_id
    left join lateral (
      select candidate.payment_method
      from public.refund_cases candidate
      where candidate.id = adjustment.refund_case_id
        or (adjustment.refund_case_id is null
          and candidate.reporting_adjustment_id = adjustment.id)
      order by (candidate.id = adjustment.refund_case_id) desc, candidate.id
      limit 1
    ) refund_case on true
    where adjustment.adjustment_date between p_date_from and p_date_to
      and adjustment.adjustment_type in ('refund', 'complaint_refund')
      and (p_location_ids is null or cardinality(p_location_ids) = 0
        or adjustment.reporting_location_id = any(p_location_ids))
  ),
  adjustments_by_method as (
    select adjustment.report_period_start, adjustment.reporting_machine_id,
      adjustment.reporting_location_id, adjustment.report_payment_method,
      sum(adjustment.amount_cents)::bigint as report_refund_amount_cents
    from adjustment_evidence adjustment
    group by adjustment.report_period_start, adjustment.reporting_machine_id,
      adjustment.reporting_location_id, adjustment.report_payment_method
  ),
  report_keys as (
    select sales.report_period_start, sales.reporting_machine_id,
      sales.reporting_location_id, sales.report_payment_method
    from sales_by_method sales
    union
    select adjustment.report_period_start, adjustment.reporting_machine_id,
      adjustment.reporting_location_id, adjustment.report_payment_method
    from adjustments_by_method adjustment
  )
  select
    'legacy-sales-basis-v0'::text,
    report.report_period_start,
    report.reporting_machine_id,
    machine.machine_label,
    report.reporting_location_id,
    location.name,
    report.report_payment_method,
    (coalesce(sales.recorded_sales_cents, 0)
      - coalesce(adjustment.report_refund_amount_cents, 0))::bigint,
    coalesce(adjustment.report_refund_amount_cents, 0)::bigint,
    coalesce(sales.recorded_sales_cents, 0)::bigint,
    0::bigint,
    coalesce(adjustment.report_refund_amount_cents, 0)::bigint,
    0::bigint, 0::bigint, 0::bigint, 0::bigint,
    0::bigint, 0::bigint, 0::bigint, 0::bigint, 0::bigint, 0::bigint,
    coalesce(sales.report_transaction_count, 0)::bigint
  from report_keys report
  join accessible_machines machine on machine.machine_id = report.reporting_machine_id
  join public.reporting_locations location on location.id = report.reporting_location_id
  left join sales_by_method sales
    on sales.report_period_start = report.report_period_start
    and sales.reporting_machine_id = report.reporting_machine_id
    and sales.reporting_location_id = report.reporting_location_id
    and sales.report_payment_method = report.report_payment_method
  left join adjustments_by_method adjustment
    on adjustment.report_period_start = report.report_period_start
    and adjustment.reporting_machine_id = report.reporting_machine_id
    and adjustment.reporting_location_id = report.reporting_location_id
    and adjustment.report_payment_method = report.report_payment_method
  where p_payment_methods is null or cardinality(p_payment_methods) = 0
    or report.report_payment_method = any(p_payment_methods)
  order by report.report_period_start desc, location.name, machine.machine_label,
    report.report_payment_method;
end;
$$;

create or replace function private.sales_report_rows_for_actor(
  p_actor_user_id uuid,
  p_date_from date,
  p_date_to date,
  p_grain text default 'week',
  p_machine_ids uuid[] default null,
  p_location_ids uuid[] default null,
  p_payment_methods text[] default null
)
returns table (
  calculation_version text,
  period_start date,
  machine_id uuid,
  machine_label text,
  location_id uuid,
  location_name text,
  payment_method text,
  net_sales_cents bigint,
  refund_amount_cents bigint,
  gross_sales_cents bigint,
  tax_cents bigint,
  refund_request_deduction_cents bigint,
  refund_reversal_cents bigint,
  refund_legacy_paid_deduction_cents bigint,
  refund_paid_context_cents bigint,
  refund_outstanding_context_cents bigint,
  unresolved_sales_count bigint,
  unresolved_sales_cents bigint,
  unresolved_refund_count bigint,
  unresolved_refund_cents bigint,
  unresolved_paid_context_count bigint,
  unresolved_paid_context_cents bigint,
  transaction_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  normalized_grain text := lower(coalesce(nullif(trim(p_grain), ''), 'week'));
begin
  if p_actor_user_id is null then
    raise exception 'Report actor is required';
  end if;
  if p_date_from is null or p_date_to is null or p_date_from > p_date_to then
    raise exception 'Date range is invalid';
  end if;
  if normalized_grain not in ('day', 'week', 'month') then
    raise exception 'Invalid report grain: %', p_grain;
  end if;

  return query
  with accessible_machines as materialized (
    select machine.id, machine.machine_label
    from public.reporting_machines machine
    where public.has_reporting_machine_access(p_actor_user_id, machine.id)
      and (
        p_machine_ids is null
        or cardinality(p_machine_ids) = 0
        or machine.id = any(p_machine_ids)
      )
  ),
  components as materialized (
    select
      component.*,
      case component.tender when 'card' then 'credit' else component.tender end
        as report_payment_method
    from accessible_machines machine
    cross join lateral private.machine_sales_daily_components(
      machine.id,
      p_date_from,
      p_date_to
    ) component
  ),
  grouped as (
    select
      date_trunc(normalized_grain, component.booking_date::timestamp)::date
        as report_period_start,
      component.reporting_machine_id,
      component.reporting_location_id,
      component.report_payment_method,
      case when sum(component.unresolved_sales_count + component.unresolved_refund_count) > 0
        then null else sum(component.commissionable_sales_ex_tax_cents)::bigint end
        as net_sales_cents,
      case when sum(component.unresolved_refund_count) > 0 then null else sum(
        component.request_deduction_ex_tax_cents
        + component.legacy_paid_deduction_ex_tax_cents
        - component.refund_reversal_ex_tax_cents
      )::bigint end as refund_amount_cents,
      case when sum(component.unresolved_sales_count) > 0
        then null else sum(component.sales_ex_tax_cents)::bigint end as gross_sales_cents,
      case when sum(component.unresolved_sales_count + component.unresolved_refund_count) > 0
        then null else sum(component.sales_tax_cents)::bigint end as tax_cents,
      sum(component.request_deduction_ex_tax_cents)::bigint
        as refund_request_deduction_cents,
      sum(component.refund_reversal_ex_tax_cents)::bigint as refund_reversal_cents,
      sum(component.legacy_paid_deduction_ex_tax_cents)::bigint
        as refund_legacy_paid_deduction_cents,
      sum(component.paid_context_ex_tax_cents)::bigint as refund_paid_context_cents,
      sum(component.outstanding_context_ex_tax_cents)::bigint
        as refund_outstanding_context_cents,
      sum(component.unresolved_sales_count)::bigint as unresolved_sales_count,
      sum(component.unresolved_sales_cents)::bigint as unresolved_sales_cents,
      sum(component.unresolved_refund_count)::bigint as unresolved_refund_count,
      sum(component.unresolved_refund_cents)::bigint as unresolved_refund_cents,
      sum(component.unresolved_paid_context_count)::bigint
        as unresolved_paid_context_count,
      sum(component.unresolved_paid_context_cents)::bigint
        as unresolved_paid_context_cents,
      sum(component.sales_transaction_count)::bigint as transaction_count
    from components component
    where (
        p_location_ids is null
        or cardinality(p_location_ids) = 0
        or component.reporting_location_id = any(p_location_ids)
      )
      and (
        p_payment_methods is null
        or cardinality(p_payment_methods) = 0
        or component.report_payment_method = any(p_payment_methods)
      )
    group by date_trunc(normalized_grain, component.booking_date::timestamp)::date,
      component.reporting_machine_id, component.reporting_location_id,
      component.report_payment_method
  )
  select
    'shared-sales-basis-v1'::text,
    grouped.report_period_start,
    grouped.reporting_machine_id,
    machine.machine_label,
    grouped.reporting_location_id,
    location.name,
    grouped.report_payment_method,
    grouped.net_sales_cents,
    grouped.refund_amount_cents,
    grouped.gross_sales_cents,
    grouped.tax_cents,
    grouped.refund_request_deduction_cents,
    grouped.refund_reversal_cents,
    grouped.refund_legacy_paid_deduction_cents,
    grouped.refund_paid_context_cents,
    grouped.refund_outstanding_context_cents,
    grouped.unresolved_sales_count,
    grouped.unresolved_sales_cents,
    grouped.unresolved_refund_count,
    grouped.unresolved_refund_cents,
    grouped.unresolved_paid_context_count,
    grouped.unresolved_paid_context_cents,
    grouped.transaction_count
  from grouped
  join accessible_machines machine on machine.id = grouped.reporting_machine_id
  join public.reporting_locations location on location.id = grouped.reporting_location_id
  order by grouped.report_period_start desc, location.name, machine.machine_label,
    grouped.report_payment_method;
end;
$$;

drop function if exists public.get_sales_report(date, date, text, uuid[], uuid[], text[]);
create function public.get_sales_report(
  p_date_from date,
  p_date_to date,
  p_grain text default 'week',
  p_machine_ids uuid[] default null,
  p_location_ids uuid[] default null,
  p_payment_methods text[] default null
)
returns table (
  calculation_version text,
  period_start date,
  machine_id uuid,
  machine_label text,
  location_id uuid,
  location_name text,
  payment_method text,
  net_sales_cents bigint,
  refund_amount_cents bigint,
  gross_sales_cents bigint,
  tax_cents bigint,
  refund_request_deduction_cents bigint,
  refund_reversal_cents bigint,
  refund_legacy_paid_deduction_cents bigint,
  refund_paid_context_cents bigint,
  refund_outstanding_context_cents bigint,
  unresolved_sales_count bigint,
  unresolved_sales_cents bigint,
  unresolved_refund_count bigint,
  unresolved_refund_cents bigint,
  unresolved_paid_context_count bigint,
  unresolved_paid_context_cents bigint,
  transaction_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if exists (
    select 1 from private.refund_request_recognition_rollout rollout
    where rollout.singleton
      and rollout.activated_at is not null
  ) then
    return query select *
    from private.sales_report_rows_for_actor(
      auth.uid(), p_date_from, p_date_to, p_grain,
      p_machine_ids, p_location_ids, p_payment_methods
    );
    return;
  end if;

  return query select *
  from private.sales_report_legacy_rows_for_actor(
    auth.uid(), p_date_from, p_date_to, p_grain,
    p_machine_ids, p_location_ids, p_payment_methods
  );
end;
$$;

drop function if exists public.get_sales_report(jsonb);
create function public.get_sales_report(p_filters jsonb)
returns table (
  calculation_version text,
  period_start date,
  machine_id uuid,
  machine_label text,
  location_id uuid,
  location_name text,
  payment_method text,
  net_sales_cents bigint,
  refund_amount_cents bigint,
  gross_sales_cents bigint,
  tax_cents bigint,
  refund_request_deduction_cents bigint,
  refund_reversal_cents bigint,
  refund_legacy_paid_deduction_cents bigint,
  refund_paid_context_cents bigint,
  refund_outstanding_context_cents bigint,
  unresolved_sales_count bigint,
  unresolved_sales_cents bigint,
  unresolved_refund_count bigint,
  unresolved_refund_cents bigint,
  unresolved_paid_context_count bigint,
  unresolved_paid_context_cents bigint,
  transaction_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  normalized_filters jsonb := coalesce(p_filters, '{}'::jsonb);
  machine_ids uuid[];
  location_ids uuid[];
  payment_methods text[];
begin
  select array_agg(value::uuid) into machine_ids
  from jsonb_array_elements_text(coalesce(normalized_filters -> 'machineIds', '[]'::jsonb)) item(value)
  where value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';

  select array_agg(value::uuid) into location_ids
  from jsonb_array_elements_text(coalesce(normalized_filters -> 'locationIds', '[]'::jsonb)) item(value)
  where value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';

  select array_agg(lower(value)) into payment_methods
  from jsonb_array_elements_text(coalesce(normalized_filters -> 'paymentMethods', '[]'::jsonb)) item(value)
  where lower(value) in ('cash', 'credit', 'other', 'unknown');

  return query select * from public.get_sales_report(
    nullif(normalized_filters ->> 'dateFrom', '')::date,
    nullif(normalized_filters ->> 'dateTo', '')::date,
    coalesce(nullif(normalized_filters ->> 'grain', ''), 'week'),
    machine_ids,
    location_ids,
    payment_methods
  );
end;
$$;

create or replace function public.sales_report_scheduler_get_sales_report(
  p_actor_user_id uuid,
  p_date_from date,
  p_date_to date,
  p_grain text default 'week',
  p_machine_ids uuid[] default null,
  p_location_ids uuid[] default null,
  p_payment_methods text[] default null
)
returns table (
  calculation_version text,
  period_start date,
  machine_id uuid,
  machine_label text,
  location_id uuid,
  location_name text,
  payment_method text,
  net_sales_cents bigint,
  refund_amount_cents bigint,
  gross_sales_cents bigint,
  tax_cents bigint,
  refund_request_deduction_cents bigint,
  refund_reversal_cents bigint,
  refund_legacy_paid_deduction_cents bigint,
  refund_paid_context_cents bigint,
  refund_outstanding_context_cents bigint,
  unresolved_sales_count bigint,
  unresolved_sales_cents bigint,
  unresolved_refund_count bigint,
  unresolved_refund_cents bigint,
  unresolved_paid_context_count bigint,
  unresolved_paid_context_cents bigint,
  transaction_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if current_user <> 'service_role'
    and coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then
    raise exception 'Service role required';
  end if;

  if exists (
    select 1 from private.refund_request_recognition_rollout rollout
    where rollout.singleton
      and rollout.activated_at is not null
  ) then
    return query select *
    from private.sales_report_rows_for_actor(
      p_actor_user_id, p_date_from, p_date_to, p_grain,
      p_machine_ids, p_location_ids, p_payment_methods
    );
    return;
  end if;

  return query select *
  from private.sales_report_legacy_rows_for_actor(
    p_actor_user_id, p_date_from, p_date_to, p_grain,
    p_machine_ids, p_location_ids, p_payment_methods
  );
end;
$$;

revoke execute on function public.operator_revenue_snapshot_source_values(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.operator_revenue_snapshot_source_values(uuid, uuid)
  to service_role;
revoke execute on function public.operator_revenue_snapshot_source_values_before_shared_basis(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.operator_revenue_snapshot_source_values_before_shared_basis(uuid, uuid)
  to service_role;
revoke execute on function private.operator_machine_tax_snapshot(uuid, date, date)
  from public, anon, authenticated;
grant execute on function private.operator_machine_tax_snapshot(uuid, date, date)
  to service_role;
revoke execute on function private.operator_machine_tax_snapshot_shared(uuid, date, date)
  from public, anon, authenticated;
grant execute on function private.operator_machine_tax_snapshot_shared(uuid, date, date)
  to service_role;
revoke execute on function private.operator_machine_tax_snapshot_before_shared_basis(uuid, date, date)
  from public, anon, authenticated;
grant execute on function private.operator_machine_tax_snapshot_before_shared_basis(uuid, date, date)
  to service_role;
revoke execute on function private.operator_machine_tax_commission(uuid, uuid, uuid, date, date)
  from public, anon, authenticated;
grant execute on function private.operator_machine_tax_commission(uuid, uuid, uuid, date, date)
  to service_role;
revoke execute on function private.operator_machine_tax_commission_shared(uuid, uuid, uuid, date, date)
  from public, anon, authenticated;
grant execute on function private.operator_machine_tax_commission_shared(uuid, uuid, uuid, date, date)
  to service_role;
revoke execute on function private.operator_machine_tax_commission_before_shared_basis(uuid, uuid, uuid, date, date)
  from public, anon, authenticated;
grant execute on function private.operator_machine_tax_commission_before_shared_basis(uuid, uuid, uuid, date, date)
  to service_role;
revoke execute on function private.sales_report_rows_for_actor(uuid, date, date, text, uuid[], uuid[], text[])
  from public, anon, authenticated;
grant execute on function private.sales_report_rows_for_actor(uuid, date, date, text, uuid[], uuid[], text[])
  to service_role;
revoke execute on function private.sales_report_legacy_rows_for_actor(uuid, date, date, text, uuid[], uuid[], text[])
  from public, anon, authenticated;
grant execute on function private.sales_report_legacy_rows_for_actor(uuid, date, date, text, uuid[], uuid[], text[])
  to service_role;
revoke execute on function public.get_sales_report(date, date, text, uuid[], uuid[], text[])
  from public, anon;
grant execute on function public.get_sales_report(date, date, text, uuid[], uuid[], text[])
  to authenticated, service_role;
revoke execute on function public.get_sales_report_before_shared_basis(date, date, text, uuid[], uuid[], text[])
  from public, anon, authenticated;
grant execute on function public.get_sales_report_before_shared_basis(date, date, text, uuid[], uuid[], text[])
  to service_role;
revoke execute on function public.get_sales_report(jsonb) from public, anon;
grant execute on function public.get_sales_report(jsonb) to authenticated, service_role;
revoke execute on function public.get_sales_report_before_shared_basis(jsonb)
  from public, anon, authenticated;
grant execute on function public.get_sales_report_before_shared_basis(jsonb)
  to service_role;
revoke execute on function public.sales_report_scheduler_get_sales_report(uuid, date, date, text, uuid[], uuid[], text[])
  from public, anon, authenticated;
grant execute on function public.sales_report_scheduler_get_sales_report(uuid, date, date, text, uuid[], uuid[], text[])
  to service_role;

comment on function public.get_sales_report(date, date, text, uuid[], uuid[], text[]) is
  'Actor-scoped tax-exclusive sales report. Refund impact is booked in request/change periods; paid and outstanding values are context and do not create a second deduction.';
comment on function public.sales_report_scheduler_get_sales_report(uuid, date, date, text, uuid[], uuid[], text[]) is
  'Service-only scheduled-report adapter that applies the schedule owner access scope to the shared sales calculation.';

-- Keep the established authorization and audit paths while correcting the
-- calculation description stored on newly generated shared-basis snapshots.
alter function public.admin_generate_payout_revenue_snapshot(uuid, uuid, boolean, text)
  rename to admin_generate_payout_revenue_snapshot_without_shared_metadata;

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
  result jsonb;
  snapshot_id uuid;
begin
  result := public.admin_generate_payout_revenue_snapshot_without_shared_metadata(
    p_payout_period_id, p_reporting_machine_id, p_regenerate, p_reason
  );
  snapshot_id := nullif(result #>> '{snapshot,id}', '')::uuid;
  if snapshot_id is null then return result; end if;

  update public.payout_period_machine_revenue_snapshots snapshot
  set source_metadata = coalesce(snapshot.source_metadata, '{}'::jsonb)
    || jsonb_build_object(
      'salesCalculationVersion', 'shared-sales-basis-v1',
      'commissionFormula', 'tax-exclusive sales - refund deductions + reversals',
      'taxCalculation', 'source-aware sales tax normalized once',
      'paymentCreatesRefundImpact', false
    )
  where snapshot.id = snapshot_id
    and exists (
      select 1 from private.refund_request_recognition_rollout rollout
      where rollout.singleton
      and rollout.activated_at is not null
    );

  return result || jsonb_build_object(
    'snapshot', public.payout_revenue_snapshot_payload(snapshot_id)
  );
end;
$$;

alter function public.service_refresh_pay_stub_revenue_snapshot(uuid, uuid)
  rename to service_refresh_pay_stub_revenue_snapshot_without_shared_metadata;

create function public.service_refresh_pay_stub_revenue_snapshot(
  p_payout_period_id uuid,
  p_reporting_machine_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  snapshot_id uuid;
begin
  snapshot_id := public.service_refresh_pay_stub_revenue_snapshot_without_shared_metadata(
    p_payout_period_id, p_reporting_machine_id
  );
  update public.payout_period_machine_revenue_snapshots snapshot
  set source_metadata = coalesce(snapshot.source_metadata, '{}'::jsonb)
    || jsonb_build_object(
      'salesCalculationVersion', 'shared-sales-basis-v1',
      'commissionFormula', 'tax-exclusive sales - refund deductions + reversals',
      'taxCalculation', 'source-aware sales tax normalized once',
      'paymentCreatesRefundImpact', false
    )
  where snapshot.id = snapshot_id
    and exists (
      select 1 from private.refund_request_recognition_rollout rollout
      where rollout.singleton
      and rollout.activated_at is not null
    );
  return snapshot_id;
end;
$$;

revoke execute on function public.admin_generate_payout_revenue_snapshot_without_shared_metadata(uuid, uuid, boolean, text)
  from public, anon, authenticated;
grant execute on function public.admin_generate_payout_revenue_snapshot_without_shared_metadata(uuid, uuid, boolean, text)
  to service_role;
revoke execute on function public.admin_generate_payout_revenue_snapshot(uuid, uuid, boolean, text)
  from public, anon;
grant execute on function public.admin_generate_payout_revenue_snapshot(uuid, uuid, boolean, text)
  to authenticated;
revoke execute on function public.service_refresh_pay_stub_revenue_snapshot_without_shared_metadata(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.service_refresh_pay_stub_revenue_snapshot_without_shared_metadata(uuid, uuid)
  to service_role;
revoke execute on function public.service_refresh_pay_stub_revenue_snapshot(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.service_refresh_pay_stub_revenue_snapshot(uuid, uuid)
  to service_role;

-- The legacy context aggregate used coalesce(sum(...), 0), which turns one
-- unresolved machine into a proved zero total. Preserve its authorization and
-- empty-period behavior while carrying nullable machine values into totals.
alter function public.get_payout_revenue_snapshot_context(uuid)
  rename to get_payout_revenue_snapshot_context_without_nullable_totals;

create function public.get_payout_revenue_snapshot_context(
  p_payout_period_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
  snapshot_values jsonb;
begin
  result := public.get_payout_revenue_snapshot_context_without_nullable_totals(
    p_payout_period_id
  );
  snapshot_values := coalesce(result -> 'snapshots', '[]'::jsonb);

  if exists (
    select 1 from jsonb_array_elements(snapshot_values) snapshot(value)
    where jsonb_typeof(snapshot.value -> 'grossSalesCents') = 'null'
  ) then
    result := jsonb_set(result, '{totals,grossSalesCents}', 'null'::jsonb);
  end if;
  if exists (
    select 1 from jsonb_array_elements(snapshot_values) snapshot(value)
    where jsonb_typeof(snapshot.value -> 'refundAdjustmentCents') = 'null'
  ) then
    result := jsonb_set(result, '{totals,refundAdjustmentCents}', 'null'::jsonb);
  end if;
  if exists (
    select 1 from jsonb_array_elements(snapshot_values) snapshot(value)
    where jsonb_typeof(snapshot.value -> 'taxCents') = 'null'
  ) then
    result := jsonb_set(result, '{totals,taxCents}', 'null'::jsonb);
  end if;
  if exists (
    select 1 from jsonb_array_elements(snapshot_values) snapshot(value)
    where jsonb_typeof(snapshot.value -> 'netRevenueCents') = 'null'
  ) then
    result := jsonb_set(result, '{totals,netRevenueCents}', 'null'::jsonb);
  end if;
  if exists (
    select 1 from jsonb_array_elements(snapshot_values) snapshot(value)
    where jsonb_typeof(snapshot.value -> 'eligibleCommissionRevenueCents') = 'null'
  ) then
    result := jsonb_set(
      result,
      '{totals,eligibleCommissionRevenueCents}',
      'null'::jsonb
    );
  end if;

  return result;
end;
$$;

revoke execute on function public.get_payout_revenue_snapshot_context_without_nullable_totals(uuid)
  from public, anon, authenticated;
grant execute on function public.get_payout_revenue_snapshot_context_without_nullable_totals(uuid)
  to service_role;
revoke execute on function public.get_payout_revenue_snapshot_context(uuid)
  from public, anon;
grant execute on function public.get_payout_revenue_snapshot_context(uuid)
  to authenticated;

-- Reconcile changed source values for both open and issued periods. Issued
-- statement payloads remain immutable; an actual snapshot fact change keeps the
-- existing targeted regeneration-required signal through the audit record.
create or replace function public.get_current_technician_pay_report_context(
  p_month date default current_date
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor_user_id uuid;
  period_start date;
  period_end date;
  profile_id uuid;
  scope_row record;
  snapshot_row public.payout_period_machine_revenue_snapshots;
  refreshed_snapshot_row public.payout_period_machine_revenue_snapshots;
  refreshed_snapshot_id uuid;
  current_values jsonb;
begin
  actor_user_id := auth.uid();
  period_start := date_trunc('month', coalesce(p_month, current_date)::timestamp)::date;
  period_end := (period_start + interval '1 month - 1 day')::date;

  if actor_user_id is null then
    raise exception 'Authentication required';
  end if;

  if not exists (
    select 1
    from public.customer_accounts account
    where coalesce(
      public.can_manage_operator_payout_account(actor_user_id, account.id),
      false
    )
  ) then
    raise exception 'Account pay authority required';
  end if;

  for profile_id in
    select distinct on (profile.account_id) profile.id
    from public.operator_payout_profiles profile
    where public.can_manage_operator_payout_account(actor_user_id, profile.account_id)
      and (
        exists (
          select 1
          from public.operator_machine_assignments assignment
          where assignment.operator_profile_id = profile.id
            and assignment.account_id = profile.account_id
            and assignment.effective_start_date <= period_end
            and coalesce(assignment.effective_end_date, 'infinity'::date) >= period_start
        )
        or exists (
          select 1
          from public.reporting_machines machine
          cross join lateral private.machine_sales_daily_components(
            machine.id,
            period_start,
            period_end
          ) component
          join public.operator_machine_assignments assignment
            on assignment.reporting_machine_id = component.reporting_machine_id
            and assignment.operator_profile_id = profile.id
            and assignment.account_id = profile.account_id
            and component.purchase_attribution_date between assignment.effective_start_date
              and coalesce(assignment.effective_end_date, 'infinity'::date)
          where machine.account_id = profile.account_id
        )
      )
      and not exists (
        select 1
        from public.payout_periods period
        where period.account_id = profile.account_id
          and period.period_start_date = period_start
          and period.period_end_date = period_end
          and period.status <> 'voided'
      )
    order by profile.account_id, profile.id
  loop
    perform public.ensure_operator_payout_period_for_date(profile_id, period_start);
  end loop;

  for scope_row in
    select distinct scope.payout_period_id, scope.reporting_machine_id
    from (
      select
        period.id as payout_period_id,
        assignment.reporting_machine_id
      from public.payout_periods period
      join public.operator_machine_assignments assignment
        on assignment.account_id = period.account_id
        and assignment.effective_start_date <= period.period_end_date
        and coalesce(assignment.effective_end_date, 'infinity'::date)
          >= period.period_start_date
      where period.period_start_date = period_start
        and period.period_end_date = period_end
        and period.status <> 'voided'
        and public.can_manage_operator_payout_account(actor_user_id, period.account_id)

      union

      select
        period.id,
        component.reporting_machine_id
      from public.payout_periods period
      join public.reporting_machines machine on machine.account_id = period.account_id
      cross join lateral private.machine_sales_daily_components(
        machine.id,
        period_start,
        period_end
      ) component
      where period.period_start_date = period_start
        and period.period_end_date = period_end
        and period.status <> 'voided'
        and public.can_manage_operator_payout_account(actor_user_id, period.account_id)
        and exists (
          select 1
          from public.operator_machine_assignments attribution
          where attribution.account_id = period.account_id
            and attribution.reporting_machine_id = component.reporting_machine_id
            and component.purchase_attribution_date between attribution.effective_start_date
              and coalesce(attribution.effective_end_date, 'infinity'::date)
        )
    ) scope
    order by scope.payout_period_id, scope.reporting_machine_id
  loop
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        'technician_pay_report_snapshot:'
          || scope_row.payout_period_id::text
          || ':'
          || scope_row.reporting_machine_id::text,
        0
      )
    );

    select snapshot.* into snapshot_row
    from public.payout_period_machine_revenue_snapshots snapshot
    where snapshot.payout_period_id = scope_row.payout_period_id
      and snapshot.reporting_machine_id = scope_row.reporting_machine_id
      and snapshot.status <> 'voided'
    order by snapshot.created_at desc, snapshot.id
    limit 1;

    if snapshot_row.id is not null
      and snapshot_row.source_metadata ->> 'salesCalculationVersion'
        is distinct from 'shared-sales-basis-v1'
      and exists (
        select 1
        from public.payout_runs issued_run
        join public.pay_statements issued_statement
          on issued_statement.payout_run_id = issued_run.id
          and issued_statement.status = 'issued'
        where issued_run.payout_period_id = scope_row.payout_period_id
      )
    then
      -- Formula cutover alone cannot stale an issued statement. Compare its
      -- frozen legacy snapshot to the same legacy facts; a real evidence change
      -- still refreshes the snapshot and triggers the existing targeted notice.
      current_values := private.operator_machine_tax_snapshot_before_shared_basis(
        scope_row.reporting_machine_id,
        period_start,
        period_end
      );
    else
      current_values := private.operator_machine_tax_snapshot(
        scope_row.reporting_machine_id,
        period_start,
        period_end
      );
    end if;

    if snapshot_row.id is null
      or snapshot_row.gross_sales_cents is distinct from
        (current_values ->> 'grossSalesCents')::integer
      or snapshot_row.refund_adjustment_cents is distinct from
        (current_values ->> 'refundAdjustmentCents')::integer
      or snapshot_row.tax_cents is distinct from (current_values ->> 'taxCents')::integer
      or snapshot_row.eligible_commission_revenue_cents is distinct from
        (current_values ->> 'commissionableSalesCents')::integer
    then
      refreshed_snapshot_id := public.service_refresh_pay_stub_revenue_snapshot(
        scope_row.payout_period_id,
        scope_row.reporting_machine_id
      );

      select snapshot.* into refreshed_snapshot_row
      from public.payout_period_machine_revenue_snapshots snapshot
      where snapshot.id = refreshed_snapshot_id;

      insert into public.admin_audit_log (
        actor_user_id,
        action,
        entity_type,
        entity_id,
        before,
        after,
        meta
      ) values (
        actor_user_id,
        case when snapshot_row.id is null
          then 'operator_payout_revenue_snapshot.created'
          else 'operator_payout_revenue_snapshot.regenerated'
        end,
        'payout_period_machine_revenue_snapshot',
        refreshed_snapshot_id::text,
        coalesce(to_jsonb(snapshot_row), '{}'::jsonb),
        to_jsonb(refreshed_snapshot_row),
        jsonb_build_object(
          'reason', 'Technician Pay Report automatic sales reconciliation',
          'payout_period_id', scope_row.payout_period_id,
          'reporting_machine_id', scope_row.reporting_machine_id,
          'sales_calculation_version', current_values ->> 'calculationVersion',
          'raw_provider_payloads_included', false
        )
      );
    end if;

    snapshot_row := null;
    refreshed_snapshot_row := null;
    refreshed_snapshot_id := null;
  end loop;

  return public.get_technician_pay_report_context(period_start);
end;
$$;

comment on function public.get_current_technician_pay_report_context(date) is
  'Account-pay-authorized Technician Pay Report that refreshes only missing or fact-changed report snapshots. Issued Pay Stub payloads remain immutable; this function does not execute payment.';

-- The existing report enumerates machines assigned during the report month.
-- Add only machines with request/change-month components attributed to this
-- Technician's original purchase-date assignment, so a move cannot charge the
-- replacement Technician.
alter function private.calculate_technician_pay_report(uuid, uuid, date, date)
  rename to calculate_technician_pay_report_without_shared_attribution;

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
  extra_scope record;
  calculation jsonb;
  snapshot_calculation jsonb;
  snapshot_row public.payout_period_machine_revenue_snapshots;
  machine_blockers jsonb;
  blockers jsonb;
  machines jsonb;
  added_commissionable bigint := 0;
  added_commission bigint := 0;
  added_tax bigint := 0;
begin
  result := private.calculate_technician_pay_report_without_shared_attribution(
    p_account_id,
    p_operator_profile_id,
    p_period_start_date,
    p_period_end_date
  );
  blockers := coalesce(result -> 'blockers', '[]'::jsonb);
  machines := coalesce(result -> 'machines', '[]'::jsonb);

  for extra_scope in
    select
      machine.id as reporting_machine_id,
      machine.machine_label,
      (array_agg(component.reporting_location_id order by
        component.purchase_attribution_date, component.booking_date))[1] as location_id,
      (array_agg(location.name order by
        component.purchase_attribution_date, component.booking_date))[1] as location_name,
      min(component.purchase_attribution_date) as attributed_start_date,
      max(component.purchase_attribution_date) as attributed_end_date
    from public.reporting_machines machine
    cross join lateral private.machine_sales_daily_components(
      machine.id,
      p_period_start_date,
      p_period_end_date
    ) component
    join public.reporting_locations location on location.id = component.reporting_location_id
    where machine.account_id = p_account_id
      and (
        component.request_deduction_ex_tax_cents <> 0
        or component.refund_reversal_ex_tax_cents <> 0
        or component.paid_context_ex_tax_cents <> 0
        or component.outstanding_context_ex_tax_cents <> 0
      )
      and exists (
        select 1
        from public.operator_machine_assignments assignment
        where assignment.account_id = p_account_id
          and assignment.operator_profile_id = p_operator_profile_id
          and assignment.reporting_machine_id = machine.id
          and component.purchase_attribution_date between assignment.effective_start_date
            and coalesce(assignment.effective_end_date, 'infinity'::date)
      )
      and not exists (
        select 1
        from jsonb_array_elements(machines) existing(item)
        where existing.item ->> 'machineId' = machine.id::text
      )
    group by machine.id, machine.machine_label
    order by machine.machine_label, machine.id
  loop
    calculation := private.operator_machine_tax_commission(
      p_account_id,
      p_operator_profile_id,
      extra_scope.reporting_machine_id,
      p_period_start_date,
      p_period_end_date
    );
    snapshot_calculation := private.operator_machine_tax_snapshot(
      extra_scope.reporting_machine_id,
      p_period_start_date,
      p_period_end_date
    );
    machine_blockers := '[]'::jsonb;

    select snapshot.* into snapshot_row
    from public.payout_period_machine_revenue_snapshots snapshot
    where snapshot.account_id = p_account_id
      and snapshot.reporting_machine_id = extra_scope.reporting_machine_id
      and snapshot.period_start_date = p_period_start_date
      and snapshot.period_end_date = p_period_end_date
      and snapshot.status <> 'voided'
    order by snapshot.updated_at desc, snapshot.id
    limit 1;

    if not (calculation ->> 'taxRateCompleteForSales')::boolean then
      machine_blockers := machine_blockers || jsonb_build_array(jsonb_build_object(
        'code', 'missing_machine_tax_rate',
        'severity', 'blocker',
        'message', 'Complete the existing sales tax basis before publishing compensation.',
        'operatorProfileId', p_operator_profile_id,
        'machineId', extra_scope.reporting_machine_id
      ));
    end if;
    if not (calculation ->> 'commissionRateCompleteForPeriod')::boolean then
      machine_blockers := machine_blockers || jsonb_build_array(jsonb_build_object(
        'code', 'missing_commission_rate',
        'severity', 'blocker',
        'message', 'Add a commission rate effective on the original purchase attribution date.',
        'operatorProfileId', p_operator_profile_id,
        'machineId', extra_scope.reporting_machine_id
      ));
    end if;
    if not (calculation ->> 'commissionAllocationResolved')::boolean then
      machine_blockers := machine_blockers || jsonb_build_array(jsonb_build_object(
        'code', 'cross_rate_refund_allocation_ambiguous',
        'severity', 'blocker',
        'message', 'Resolve refund attribution across commission-rate periods before publishing.',
        'operatorProfileId', p_operator_profile_id,
        'machineId', extra_scope.reporting_machine_id
      ));
    end if;
    if snapshot_row.id is null then
      machine_blockers := machine_blockers || jsonb_build_array(jsonb_build_object(
        'code', 'missing_revenue_snapshot',
        'severity', 'blocker',
        'message', 'Refresh Commissionable Sales for this machine and month.',
        'operatorProfileId', p_operator_profile_id,
        'machineId', extra_scope.reporting_machine_id
      ));
    elsif snapshot_row.gross_sales_cents is distinct from
        (snapshot_calculation ->> 'grossSalesCents')::integer
      or snapshot_row.refund_adjustment_cents is distinct from
        (snapshot_calculation ->> 'refundAdjustmentCents')::integer
      or snapshot_row.tax_cents is distinct from
        (snapshot_calculation ->> 'taxCents')::integer
      or snapshot_row.eligible_commission_revenue_cents is distinct from
        (snapshot_calculation ->> 'commissionableSalesCents')::integer
      or snapshot_row.source_metadata ->> 'salesCalculationVersion'
        is distinct from snapshot_calculation ->> 'calculationVersion'
    then
      machine_blockers := machine_blockers || jsonb_build_array(jsonb_build_object(
        'code', 'revenue_snapshot_fact_mismatch',
        'severity', 'blocker',
        'message', 'Refresh the monthly revenue snapshot to freeze sales, refunds, and tax.',
        'operatorProfileId', p_operator_profile_id,
        'machineId', extra_scope.reporting_machine_id
      ));
    end if;

    blockers := blockers || machine_blockers;
    added_commissionable := added_commissionable
      + coalesce((calculation ->> 'commissionableSalesCents')::bigint, 0);
    added_commission := added_commission
      + (calculation ->> 'commissionEarningsCents')::bigint;
    added_tax := added_tax + coalesce((calculation ->> 'taxCents')::bigint, 0);

    machines := machines || jsonb_build_array(jsonb_build_object(
      'machineId', extra_scope.reporting_machine_id,
      'machineLabel', extra_scope.machine_label,
      'locationId', extra_scope.location_id,
      'locationName', extra_scope.location_name,
      'assignedStartDate', extra_scope.attributed_start_date,
      'assignedEndDate', extra_scope.attributed_end_date,
      'assignmentScopeResolved', true,
      'fullPeriodAssignment', false,
      'originalPurchaseAttribution', true,
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
      'revenueSnapshotId', snapshot_row.id,
      'revenueSnapshotStatus', snapshot_row.status,
      'revenueGeneratedAt', snapshot_row.generated_at,
      'sourceLatestSaleDate', calculation ->> 'sourceLatestSaleDate',
      'sourceSalesRowCount', (calculation ->> 'sourceSalesRowCount')::integer,
      'sourceAdjustmentRowCount', (calculation ->> 'sourceAdjustmentRowCount')::integer,
      'snapshotTaxCents', coalesce(snapshot_row.tax_cents, 0),
      'snapshotMatchesFacts', jsonb_array_length(machine_blockers) = 0,
      'warnings', coalesce(snapshot_row.warnings, '[]'::jsonb)
    ));
    snapshot_row := null;
  end loop;

  result := result || jsonb_build_object(
    'taxCents', coalesce((result ->> 'taxCents')::bigint, 0) + added_tax,
    'commissionableSalesCents',
      coalesce((result ->> 'commissionableSalesCents')::bigint, 0) + added_commissionable,
    'commissionEarningsCents',
      coalesce((result ->> 'commissionEarningsCents')::bigint, 0) + added_commission,
    'currentTotalCents', coalesce((result ->> 'currentTotalCents')::bigint, 0)
      + added_commission,
    'machines', machines,
    'blockers', blockers,
    'publishable', jsonb_array_length(blockers) = 0,
    'calculationMeta', coalesce(result -> 'calculationMeta', '{}'::jsonb)
      || jsonb_build_object(
        'salesCalculationVersion', 'shared-sales-basis-v1',
        'refundRecognition', 'request/change month with original purchase attribution',
        'paymentCreatesRefundImpact', false
      )
  );
  return result;
end;
$$;

revoke execute on function private.calculate_technician_pay_report_without_shared_attribution(uuid, uuid, date, date)
  from public, anon, authenticated;
grant execute on function private.calculate_technician_pay_report_without_shared_attribution(uuid, uuid, date, date)
  to service_role;
revoke execute on function private.calculate_technician_pay_report(uuid, uuid, date, date)
  from public, anon, authenticated;
grant execute on function private.calculate_technician_pay_report(uuid, uuid, date, date)
  to service_role;

-- Keep the public partner wrapper and export contract unchanged. The internal
-- calculation uses booking_date for the report period and the original purchase
-- date for partnership assignment and financial-rule attribution.
alter function public.admin_preview_partner_period_report_internal(uuid, date, date, text)
  rename to admin_preview_partner_period_report_internal_without_shared_basis;

create function public.admin_preview_partner_period_report_internal(
  p_partnership_id uuid,
  p_date_from date,
  p_date_to date,
  p_period_grain text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  normalized_grain text;
  result jsonb;
  partnership_row public.reporting_partnerships;
  actor_user_id uuid;
  actor_is_super_admin boolean;
  actor_machine_ids uuid[];
begin
  if not exists (
    select 1 from private.refund_request_recognition_rollout rollout
    where rollout.singleton
      and rollout.activated_at is not null
  ) then
    return public.admin_preview_partner_period_report_internal_without_shared_basis(
      p_partnership_id,
      p_date_from,
      p_date_to,
      p_period_grain
    );
  end if;

  actor_user_id := auth.uid();
  actor_is_super_admin := public.is_super_admin(actor_user_id);
  actor_machine_ids := public.scoped_admin_machine_ids(actor_user_id);
  normalized_grain := lower(coalesce(nullif(trim(p_period_grain), ''), 'reporting_week'));

  if p_partnership_id is null then raise exception 'Partnership is required'; end if;
  if p_date_from is null or p_date_to is null or p_date_from > p_date_to then
    raise exception 'Date range is invalid';
  end if;
  if normalized_grain not in ('reporting_week', 'calendar_month') then
    raise exception 'Invalid period grain: %', p_period_grain;
  end if;

  select * into partnership_row
  from public.reporting_partnerships partnership
  where partnership.id = p_partnership_id;
  if partnership_row.id is null then raise exception 'Partnership not found'; end if;

  if not public.can_access_partner_dashboard(
    actor_user_id,
    p_partnership_id,
    p_date_from,
    p_date_to
  ) then
    raise exception 'Partner dashboard access required';
  end if;

  with weekly_bounds as (
    select
      (p_date_from + ((partnership_row.reporting_week_end_day
        - extract(dow from p_date_from)::integer + 7) % 7))::date as first_week_end,
      (p_date_to - ((extract(dow from p_date_to)::integer
        - partnership_row.reporting_week_end_day + 7) % 7))::date as last_week_end
  ),
  period_windows as materialized (
    select (week_end::date - 6) as period_start, week_end::date as period_end
    from weekly_bounds bounds
    cross join lateral generate_series(
      bounds.first_week_end,
      bounds.last_week_end,
      interval '7 days'
    ) week_end
    where normalized_grain = 'reporting_week'
      and bounds.first_week_end <= bounds.last_week_end
    union all
    select month_start::date,
      (month_start + interval '1 month' - interval '1 day')::date
    from generate_series(
      date_trunc('month', p_date_from::timestamp)::date,
      date_trunc('month', p_date_to::timestamp)::date,
      interval '1 month'
    ) month_start
    where normalized_grain = 'calendar_month'
  ),
  scoped_component_rows as materialized (
    select
      period.period_start,
      period.period_end,
      component.reporting_machine_id,
      component.reporting_location_id,
      machine.machine_label,
      location.name as location_name,
      component.booking_date,
      component.purchase_attribution_date,
      component.tender,
      component.source,
      component.sales_transaction_count,
      case
        when component.sales_transaction_count <> 0
          and row_number() over (
            partition by period.period_start, period.period_end,
              component.reporting_machine_id, component.reporting_location_id,
              component.purchase_attribution_date, component.tender, component.source
            order by (component.sales_transaction_count <> 0) desc,
              component.booking_date, component.normalization_status
          ) = 1
        then coalesce(items.item_quantity, 0)
        else 0
      end::bigint as item_quantity,
      component.sales_ex_tax_cents as source_order_amount_cents,
      component.sales_tax_cents as calculated_tax_cents,
      component.request_deduction_ex_tax_cents,
      component.legacy_paid_deduction_ex_tax_cents,
      component.refund_reversal_ex_tax_cents,
      component.request_deduction_ex_tax_cents
        + component.legacy_paid_deduction_ex_tax_cents
        - component.refund_reversal_ex_tax_cents as refund_amount_cents,
      component.paid_context_ex_tax_cents,
      component.outstanding_context_ex_tax_cents,
      component.unresolved_sales_count,
      component.unresolved_sales_cents,
      component.unresolved_refund_count,
      component.unresolved_refund_cents,
      component.unresolved_paid_context_count,
      component.unresolved_paid_context_cents,
      component.normalization_status,
      rule.id as financial_rule_id,
      rule.calculation_model,
      rule.split_base,
      rule.fee_amount_cents,
      rule.fee_basis,
      rule.cost_amount_cents,
      rule.cost_basis,
      rule.deduction_timing,
      rule.gross_to_net_method,
      rule.fever_share_basis_points,
      rule.partner_share_basis_points,
      rule.bloomjoy_share_basis_points
    from public.reporting_machine_partnership_assignments assignment
    join public.reporting_machines machine on machine.id = assignment.machine_id
    cross join lateral private.machine_sales_daily_components(
      machine.id,
      p_date_from,
      p_date_to
    ) component
    join period_windows period on component.booking_date between period.period_start and period.period_end
    join public.reporting_locations location on location.id = component.reporting_location_id
    left join lateral (
      select coalesce(sum(fact.item_quantity), 0)::bigint as item_quantity
      from public.machine_sales_facts fact
      where fact.reporting_machine_id = component.reporting_machine_id
        and fact.reporting_location_id = component.reporting_location_id
        and fact.sale_date = component.purchase_attribution_date
        and fact.source = component.source
        and case fact.payment_method when 'credit' then 'card' else fact.payment_method end
          = component.tender
    ) items on true
    left join lateral (
      select financial_rule.*
      from public.reporting_partnership_financial_rules financial_rule
      where financial_rule.partnership_id = p_partnership_id
        and financial_rule.status = 'active'
        and financial_rule.effective_start_date <= component.purchase_attribution_date
        and coalesce(financial_rule.effective_end_date, 'infinity'::date)
          >= component.purchase_attribution_date
      order by financial_rule.effective_start_date desc, financial_rule.created_at desc,
        financial_rule.id
      limit 1
    ) rule on true
    where assignment.partnership_id = p_partnership_id
      and assignment.assignment_role = 'primary_reporting'
      and assignment.status = 'active'
      and (component.purchase_attribution_date is null
        or component.purchase_attribution_date between assignment.effective_start_date
          and coalesce(assignment.effective_end_date, 'infinity'::date))
      and (component.purchase_attribution_date is null
        or (
          component.purchase_attribution_date >= partnership_row.effective_start_date
          and component.purchase_attribution_date <= coalesce(
            partnership_row.effective_end_date,
            'infinity'::date
          )
        ))
      and partnership_row.status = 'active'
      and component.booking_date between p_date_from and p_date_to
      and (actor_is_super_admin or component.reporting_machine_id = any(actor_machine_ids))
  ),
  scoped_components as materialized (
    select
      row.period_start,
      row.period_end,
      row.reporting_machine_id,
      row.reporting_location_id,
      row.machine_label,
      row.location_name,
      min(row.booking_date) as booking_date,
      min(row.purchase_attribution_date) as purchase_attribution_date,
      sum(row.sales_transaction_count)::bigint as sales_transaction_count,
      sum(row.item_quantity)::bigint as item_quantity,
      case when sum(row.unresolved_sales_count) > 0 then null
        else sum(row.source_order_amount_cents)::bigint end as source_order_amount_cents,
      case when sum(row.unresolved_sales_count) > 0 then null
        else sum(row.calculated_tax_cents)::bigint end as calculated_tax_cents,
      sum(row.request_deduction_ex_tax_cents)::bigint as request_deduction_ex_tax_cents,
      sum(row.legacy_paid_deduction_ex_tax_cents)::bigint as legacy_paid_deduction_ex_tax_cents,
      sum(row.refund_reversal_ex_tax_cents)::bigint as refund_reversal_ex_tax_cents,
      case when sum(row.unresolved_refund_count) > 0 then null
        else sum(row.request_deduction_ex_tax_cents + row.legacy_paid_deduction_ex_tax_cents
          - row.refund_reversal_ex_tax_cents)::bigint end as refund_amount_cents,
      sum(row.paid_context_ex_tax_cents)::bigint as paid_context_ex_tax_cents,
      sum(row.outstanding_context_ex_tax_cents)::bigint as outstanding_context_ex_tax_cents,
      sum(row.unresolved_sales_count)::bigint as unresolved_sales_count,
      sum(row.unresolved_sales_cents)::bigint as unresolved_sales_cents,
      sum(row.unresolved_refund_count)::bigint as unresolved_refund_count,
      sum(row.unresolved_refund_cents)::bigint as unresolved_refund_cents,
      sum(row.unresolved_paid_context_count)::bigint as unresolved_paid_context_count,
      sum(row.unresolved_paid_context_cents)::bigint as unresolved_paid_context_cents,
      case
        when bool_or(row.normalization_status = 'unresolved') then 'unresolved'
        when bool_or(row.normalization_status = 'estimated') then 'estimated'
        when bool_or(row.normalization_status = 'context_unresolved') then 'context_unresolved'
        else 'proved'
      end as normalization_status,
      row.financial_rule_id,
      row.calculation_model,
      row.split_base,
      row.fee_amount_cents,
      row.fee_basis,
      row.cost_amount_cents,
      row.cost_basis,
      row.deduction_timing,
      row.gross_to_net_method,
      row.fever_share_basis_points,
      row.partner_share_basis_points,
      row.bloomjoy_share_basis_points
    from scoped_component_rows row
    group by row.period_start, row.period_end, row.reporting_machine_id,
      row.reporting_location_id, row.machine_label, row.location_name,
      row.financial_rule_id, row.calculation_model, row.split_base,
      row.fee_amount_cents, row.fee_basis, row.cost_amount_cents,
      row.cost_basis, row.deduction_timing, row.gross_to_net_method,
      row.fever_share_basis_points, row.partner_share_basis_points,
      row.bloomjoy_share_basis_points
  ),
  assigned_machine_periods as materialized (
    select distinct
      period.period_start,
      period.period_end,
      machine.id as reporting_machine_id,
      machine.machine_label,
      location.name as location_name
    from period_windows period
    join public.reporting_machine_partnership_assignments assignment
      on assignment.partnership_id = p_partnership_id
      and assignment.assignment_role = 'primary_reporting'
      and assignment.status = 'active'
      and assignment.effective_start_date <= period.period_end
      and coalesce(assignment.effective_end_date, 'infinity'::date) >= period.period_start
    join public.reporting_machines machine on machine.id = assignment.machine_id
    join public.reporting_locations location on location.id = machine.location_id
    where actor_is_super_admin or machine.id = any(actor_machine_ids)
    union
    select distinct period_start, period_end, reporting_machine_id, machine_label, location_name
    from scoped_components
  ),
  calculated as materialized (
    select
      component.*,
      case
        when component.source_order_amount_cents is null then null
        when component.source_order_amount_cents <= 0 then 0
        when component.fee_basis in ('per_order', 'per_transaction')
          then coalesce(component.fee_amount_cents, 0)
            * coalesce(component.sales_transaction_count, 0)
        when component.fee_basis = 'per_stick'
          then coalesce(component.fee_amount_cents, 0) * coalesce(component.item_quantity, 0)
        else 0
      end::bigint as fee_cents,
      case
        when component.source_order_amount_cents is null then null
        when component.source_order_amount_cents <= 0 then 0
        when component.cost_basis = 'per_order'
          then coalesce(component.cost_amount_cents, 0)
            * coalesce(component.sales_transaction_count, 0)
        when component.cost_basis = 'per_stick'
          then coalesce(component.cost_amount_cents, 0) * coalesce(component.item_quantity, 0)
        when component.cost_basis = 'percentage_of_sales'
          then round(component.source_order_amount_cents
            * coalesce(component.cost_amount_cents, 0) / 10000.0)::bigint
        else 0
      end::bigint as cost_cents
    from scoped_components component
  ),
  row_amounts as materialized (
    select
      calculated.*,
      calculated.source_order_amount_cents as gross_sales_cents,
      case
        when calculated.source_order_amount_cents is null
          or calculated.fee_cents is null
          or calculated.refund_amount_cents is null
        then null
        else greatest(
          calculated.source_order_amount_cents
            - calculated.fee_cents
            - calculated.refund_amount_cents,
          0
        )::bigint
      end as net_sales_cents,
      case when calculated.deduction_timing = 'before_split'
        then calculated.cost_cents else 0 end::bigint as split_deductible_cost_cents
    from calculated
  ),
  split_rows as materialized (
    select
      row_amounts.*,
      case
        when row_amounts.split_base = 'gross_sales'
          and (row_amounts.gross_sales_cents is null
            or row_amounts.refund_amount_cents is null) then null
        when row_amounts.split_base = 'gross_sales' then greatest(
            row_amounts.gross_sales_cents - row_amounts.refund_amount_cents,
            0
          )
        when row_amounts.split_base = 'contribution_after_costs'
          and (row_amounts.net_sales_cents is null
            or row_amounts.split_deductible_cost_cents is null) then null
        when row_amounts.split_base = 'contribution_after_costs' then greatest(
            row_amounts.net_sales_cents - row_amounts.split_deductible_cost_cents,
            0
          )
        else row_amounts.net_sales_cents
      end::bigint as split_base_cents
    from row_amounts
  ),
  split_amounts as materialized (
    select
      split_rows.*,
      case when split_rows.split_base_cents is null then null else
        round(split_rows.split_base_cents * (
          coalesce(split_rows.fever_share_basis_points, 0)
          + coalesce(split_rows.partner_share_basis_points, 0)
        ) / 10000.0)::bigint end as amount_owed_cents,
      case when split_rows.split_base_cents is null then null else
        round(split_rows.split_base_cents
          * coalesce(split_rows.bloomjoy_share_basis_points, 0)
          / 10000.0)::bigint end as bloomjoy_retained_cents
    from split_rows
  ),
  machine_amounts as materialized (
    select
      period_start,
      period_end,
      reporting_machine_id,
      machine_label,
      location_name,
      coalesce(sum(sales_transaction_count), 0)::integer as order_count,
      coalesce(sum(item_quantity), 0)::integer as item_quantity,
      case when count(*) filter (where gross_sales_cents is null) > 0 then null
        else coalesce(sum(gross_sales_cents), 0)::bigint end as gross_sales_cents,
      case when count(*) filter (where refund_amount_cents is null) > 0 then null
        else coalesce(sum(refund_amount_cents), 0)::bigint end as refund_amount_cents,
      case when count(*) filter (where calculated_tax_cents is null) > 0 then null
        else coalesce(sum(calculated_tax_cents), 0)::bigint end as tax_cents,
      case when count(*) filter (where fee_cents is null) > 0 then null
        else coalesce(sum(fee_cents), 0)::bigint end as fee_cents,
      case when count(*) filter (where cost_cents is null) > 0 then null
        else coalesce(sum(cost_cents), 0)::bigint end as cost_cents,
      case when count(*) filter (where net_sales_cents is null) > 0 then null
        else coalesce(sum(net_sales_cents), 0)::bigint end as net_sales_cents,
      case when count(*) filter (where split_base_cents is null) > 0 then null
        else coalesce(sum(split_base_cents), 0)::bigint end as split_base_cents,
      case when count(*) filter (where amount_owed_cents is null) > 0 then null
        else coalesce(sum(amount_owed_cents), 0)::bigint end as amount_owed_cents,
      case when count(*) filter (where bloomjoy_retained_cents is null) > 0 then null
        else coalesce(sum(bloomjoy_retained_cents), 0)::bigint end as bloomjoy_retained_cents,
      coalesce(sum(unresolved_sales_count), 0)::bigint as unresolved_sales_count,
      coalesce(sum(unresolved_sales_cents), 0)::bigint as unresolved_sales_cents,
      coalesce(sum(unresolved_refund_count), 0)::bigint as unresolved_refund_count,
      coalesce(sum(unresolved_refund_cents), 0)::bigint as unresolved_refund_cents,
      coalesce(sum(unresolved_paid_context_count), 0)::bigint
        as unresolved_paid_context_count,
      coalesce(sum(unresolved_paid_context_cents), 0)::bigint
        as unresolved_paid_context_cents,
      coalesce(sum(request_deduction_ex_tax_cents), 0)::bigint
        as refund_request_deduction_cents,
      coalesce(sum(legacy_paid_deduction_ex_tax_cents), 0)::bigint
        as refund_legacy_paid_deduction_cents,
      coalesce(sum(refund_reversal_ex_tax_cents), 0)::bigint
        as refund_reversal_cents,
      coalesce(sum(paid_context_ex_tax_cents), 0)::bigint
        as refund_paid_context_cents,
      coalesce(sum(outstanding_context_ex_tax_cents), 0)::bigint
        as refund_outstanding_context_cents
    from split_amounts
    group by period_start, period_end, reporting_machine_id, machine_label, location_name
  ),
  machine_periods as materialized (
    select
      assigned.period_start,
      assigned.period_end,
      assigned.reporting_machine_id,
      assigned.machine_label,
      assigned.location_name,
      coalesce(amount.order_count, 0)::integer as order_count,
      coalesce(amount.item_quantity, 0)::integer as item_quantity,
      case when amount.reporting_machine_id is null then 0
        else amount.gross_sales_cents end::bigint as gross_sales_cents,
      case when amount.reporting_machine_id is null then 0
        else amount.refund_amount_cents end::bigint as refund_amount_cents,
      case when amount.reporting_machine_id is null then 0
        else amount.tax_cents end::bigint as tax_cents,
      case when amount.reporting_machine_id is null then 0
        else amount.fee_cents end::bigint as fee_cents,
      case when amount.reporting_machine_id is null then 0
        else amount.cost_cents end::bigint as cost_cents,
      case when amount.reporting_machine_id is null then 0
        else amount.net_sales_cents end::bigint as net_sales_cents,
      case when amount.reporting_machine_id is null then 0
        else amount.split_base_cents end::bigint as split_base_cents,
      case when amount.reporting_machine_id is null then 0
        else amount.amount_owed_cents end::bigint as amount_owed_cents,
      case when amount.reporting_machine_id is null then 0
        else amount.bloomjoy_retained_cents end::bigint as bloomjoy_retained_cents,
      coalesce(amount.unresolved_sales_count, 0)::bigint as unresolved_sales_count,
      coalesce(amount.unresolved_sales_cents, 0)::bigint as unresolved_sales_cents,
      coalesce(amount.unresolved_refund_count, 0)::bigint as unresolved_refund_count,
      coalesce(amount.unresolved_refund_cents, 0)::bigint as unresolved_refund_cents,
      coalesce(amount.unresolved_paid_context_count, 0)::bigint
        as unresolved_paid_context_count,
      coalesce(amount.unresolved_paid_context_cents, 0)::bigint
        as unresolved_paid_context_cents,
      coalesce(amount.refund_request_deduction_cents, 0)::bigint
        as refund_request_deduction_cents,
      coalesce(amount.refund_legacy_paid_deduction_cents, 0)::bigint
        as refund_legacy_paid_deduction_cents,
      coalesce(amount.refund_reversal_cents, 0)::bigint as refund_reversal_cents,
      coalesce(amount.refund_paid_context_cents, 0)::bigint as refund_paid_context_cents,
      coalesce(amount.refund_outstanding_context_cents, 0)::bigint
        as refund_outstanding_context_cents
    from assigned_machine_periods assigned
    left join machine_amounts amount
      on amount.period_start = assigned.period_start
      and amount.period_end = assigned.period_end
      and amount.reporting_machine_id = assigned.reporting_machine_id
  ),
  periods as materialized (
    select
      period.period_start,
      period.period_end,
      coalesce(sum(machine.order_count), 0)::integer as order_count,
      coalesce(sum(machine.item_quantity), 0)::integer as item_quantity,
      case when count(*) filter (where machine.gross_sales_cents is null) > 0 then null
        else coalesce(sum(machine.gross_sales_cents), 0)::bigint end as gross_sales_cents,
      case when count(*) filter (where machine.refund_amount_cents is null) > 0 then null
        else coalesce(sum(machine.refund_amount_cents), 0)::bigint end as refund_amount_cents,
      case when count(*) filter (where machine.tax_cents is null) > 0 then null
        else coalesce(sum(machine.tax_cents), 0)::bigint end as tax_cents,
      case when count(*) filter (where machine.fee_cents is null) > 0 then null
        else coalesce(sum(machine.fee_cents), 0)::bigint end as fee_cents,
      case when count(*) filter (where machine.cost_cents is null) > 0 then null
        else coalesce(sum(machine.cost_cents), 0)::bigint end as cost_cents,
      case when count(*) filter (where machine.net_sales_cents is null) > 0 then null
        else coalesce(sum(machine.net_sales_cents), 0)::bigint end as net_sales_cents,
      case when count(*) filter (where machine.split_base_cents is null) > 0 then null
        else coalesce(sum(machine.split_base_cents), 0)::bigint end as split_base_cents,
      case when count(*) filter (where machine.amount_owed_cents is null) > 0 then null
        else coalesce(sum(machine.amount_owed_cents), 0)::bigint end as amount_owed_cents,
      case when count(*) filter (where machine.bloomjoy_retained_cents is null) > 0 then null
        else coalesce(sum(machine.bloomjoy_retained_cents), 0)::bigint end as bloomjoy_retained_cents,
      coalesce(sum(machine.unresolved_sales_count), 0)::bigint as unresolved_sales_count,
      coalesce(sum(machine.unresolved_sales_cents), 0)::bigint as unresolved_sales_cents,
      coalesce(sum(machine.unresolved_refund_count), 0)::bigint as unresolved_refund_count,
      coalesce(sum(machine.unresolved_refund_cents), 0)::bigint as unresolved_refund_cents,
      coalesce(sum(machine.unresolved_paid_context_count), 0)::bigint
        as unresolved_paid_context_count,
      coalesce(sum(machine.unresolved_paid_context_cents), 0)::bigint
        as unresolved_paid_context_cents,
      coalesce(sum(machine.refund_request_deduction_cents), 0)::bigint
        as refund_request_deduction_cents,
      coalesce(sum(machine.refund_legacy_paid_deduction_cents), 0)::bigint
        as refund_legacy_paid_deduction_cents,
      coalesce(sum(machine.refund_reversal_cents), 0)::bigint as refund_reversal_cents,
      coalesce(sum(machine.refund_paid_context_cents), 0)::bigint
        as refund_paid_context_cents,
      coalesce(sum(machine.refund_outstanding_context_cents), 0)::bigint
        as refund_outstanding_context_cents
    from period_windows period
    left join machine_periods machine
      on machine.period_start = period.period_start and machine.period_end = period.period_end
    group by period.period_start, period.period_end
  ),
  summary as materialized (
    select
      coalesce(sum(order_count), 0)::integer as order_count,
      coalesce(sum(item_quantity), 0)::integer as item_quantity,
      case when count(*) filter (where gross_sales_cents is null) > 0 then null
        else coalesce(sum(gross_sales_cents), 0)::bigint end as gross_sales_cents,
      case when count(*) filter (where refund_amount_cents is null) > 0 then null
        else coalesce(sum(refund_amount_cents), 0)::bigint end as refund_amount_cents,
      case when count(*) filter (where tax_cents is null) > 0 then null
        else coalesce(sum(tax_cents), 0)::bigint end as tax_cents,
      case when count(*) filter (where fee_cents is null) > 0 then null
        else coalesce(sum(fee_cents), 0)::bigint end as fee_cents,
      case when count(*) filter (where cost_cents is null) > 0 then null
        else coalesce(sum(cost_cents), 0)::bigint end as cost_cents,
      case when count(*) filter (where net_sales_cents is null) > 0 then null
        else coalesce(sum(net_sales_cents), 0)::bigint end as net_sales_cents,
      case when count(*) filter (where split_base_cents is null) > 0 then null
        else coalesce(sum(split_base_cents), 0)::bigint end as split_base_cents,
      case when count(*) filter (where amount_owed_cents is null) > 0 then null
        else coalesce(sum(amount_owed_cents), 0)::bigint end as amount_owed_cents,
      case when count(*) filter (where bloomjoy_retained_cents is null) > 0 then null
        else coalesce(sum(bloomjoy_retained_cents), 0)::bigint end as bloomjoy_retained_cents,
      coalesce(sum(unresolved_sales_count), 0)::bigint as unresolved_sales_count,
      coalesce(sum(unresolved_sales_cents), 0)::bigint as unresolved_sales_cents,
      coalesce(sum(unresolved_refund_count), 0)::bigint as unresolved_refund_count,
      coalesce(sum(unresolved_refund_cents), 0)::bigint as unresolved_refund_cents,
      coalesce(sum(unresolved_paid_context_count), 0)::bigint
        as unresolved_paid_context_count,
      coalesce(sum(unresolved_paid_context_cents), 0)::bigint
        as unresolved_paid_context_cents,
      coalesce(sum(refund_request_deduction_cents), 0)::bigint
        as refund_request_deduction_cents,
      coalesce(sum(refund_legacy_paid_deduction_cents), 0)::bigint
        as refund_legacy_paid_deduction_cents,
      coalesce(sum(refund_reversal_cents), 0)::bigint as refund_reversal_cents,
      coalesce(sum(refund_paid_context_cents), 0)::bigint as refund_paid_context_cents,
      coalesce(sum(refund_outstanding_context_cents), 0)::bigint
        as refund_outstanding_context_cents
    from periods
  ),
  warnings as (
    select jsonb_build_object(
      'warning_type', 'inactive_partnership',
      'severity', 'blocking',
      'partnership_status', partnership_row.status,
      'message', 'This partnership is not active. Partner previews and exports generate settlement amounts only for active partnerships.'
    ) warning
    where partnership_row.status <> 'active'
    union all
    select jsonb_build_object(
      'warning_type', 'missing_financial_rule',
      'severity', 'blocking',
      'message', 'This report includes sales or refund impact without the original purchase-date financial rule.'
    )
    where exists (
      select 1 from scoped_components
      where calculation_model is null
        and (
          source_order_amount_cents <> 0
          or refund_amount_cents <> 0
          or unresolved_sales_count > 0
          or unresolved_refund_count > 0
        )
    )
    union all
    select jsonb_build_object(
      'warning_type', 'missing_machine_tax_rate',
      'severity', 'blocking',
      'message', 'Complete the existing sales tax basis before sharing settlement totals.'
    )
    where exists (
      select 1 from scoped_components
      where unresolved_sales_count > 0 or unresolved_refund_count > 0
    )
    union all
    select jsonb_build_object(
      'warning_type', 'no_assigned_machines',
      'severity', 'blocking',
      'message', 'This partnership has no reporting machines for the selected period.'
    )
    where not exists (select 1 from assigned_machine_periods)
    union all
    select jsonb_build_object(
      'warning_type', 'no_sales_for_machine',
      'severity', 'non_blocking',
      'machine_id', machine.reporting_machine_id,
      'machine_label', machine.machine_label,
      'message', machine.machine_label || ' has no sales in the selected period.'
    )
    from (
      select reporting_machine_id, machine_label, sum(order_count) total_orders
      from machine_periods
      group by reporting_machine_id, machine_label
    ) machine
    where coalesce(machine.total_orders, 0) = 0
  )
  select jsonb_build_object(
    'partnership_id', p_partnership_id,
    'partnership_name', partnership_row.name,
    'period_grain', normalized_grain,
    'date_from', p_date_from,
    'date_to', p_date_to,
    'calculation_version', 'shared-sales-basis-v1',
    'summary', coalesce((select to_jsonb(summary) from summary), '{}'::jsonb),
    'periods', coalesce((
      select jsonb_agg(to_jsonb(periods) order by periods.period_start) from periods
    ), '[]'::jsonb),
    'machine_periods', coalesce((
      select jsonb_agg(to_jsonb(machine_periods)
        order by machine_periods.period_start, machine_periods.machine_label)
      from machine_periods
    ), '[]'::jsonb),
    'warnings', coalesce((select jsonb_agg(warnings.warning) from warnings), '[]'::jsonb)
  ) into result;
  return result;
end;
$$;

revoke execute on function public.admin_preview_partner_period_report_internal_without_shared_basis(uuid, date, date, text)
  from public, anon, authenticated;
grant execute on function public.admin_preview_partner_period_report_internal_without_shared_basis(uuid, date, date, text)
  to service_role;
revoke execute on function public.admin_preview_partner_period_report_internal(uuid, date, date, text)
  from public, anon, authenticated;
grant execute on function public.admin_preview_partner_period_report_internal(uuid, date, date, text)
  to service_role;

select pg_notify('pgrst', 'reload schema');
