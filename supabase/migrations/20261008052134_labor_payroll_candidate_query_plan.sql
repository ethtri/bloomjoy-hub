-- #1824: profile/month payroll calculations must not read every company
-- machine before discovering that the profile has no assignment. Materialize
-- candidates first; keep canonical payroll amounts, historical attribution,
-- issued artifacts and all access predicates unchanged.
CREATE OR REPLACE FUNCTION private.calculate_technician_pay_report(p_account_id uuid, p_operator_profile_id uuid, p_period_start_date date, p_period_end_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    -- Decide exact account/profile candidates before reading sales. Historical
    -- assignments remain eligible: later refunds retain their purchase date.
    with candidate_machines as materialized (
      select machine.* from public.reporting_machines machine
      where private.reporting_company_payroll_machine_matches(p_account_id,machine.id,p_operator_profile_id)
        and exists (
          select 1 from public.operator_machine_assignments assignment
          where assignment.account_id=p_account_id
            and assignment.operator_profile_id=p_operator_profile_id
            and assignment.reporting_machine_id=machine.id
        )
        and not exists (
          select 1 from jsonb_array_elements(machines) existing(item)
          where existing.item ->> 'machineId'=machine.id::text
        )
    )
    select
      machine.id as reporting_machine_id,
      machine.machine_label,
      (array_agg(component.reporting_location_id order by
        component.purchase_attribution_date, component.booking_date))[1] as location_id,
      (array_agg(location.name order by
        component.purchase_attribution_date, component.booking_date))[1] as location_name,
      min(component.purchase_attribution_date) as attributed_start_date,
      max(component.purchase_attribution_date) as attributed_end_date
    from candidate_machines machine
    cross join lateral private.machine_sales_daily_components(
      machine.id,
      p_period_start_date,
      p_period_end_date
    ) component
    join public.reporting_locations location on location.id = component.reporting_location_id
    where (
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
$function$

