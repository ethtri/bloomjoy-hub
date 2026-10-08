-- Publication must use the same closed-month status rules as the Pay Report.
-- Keep only audited zero attestations that still match empty current facts;
-- a generated empty snapshot is not evidence of a verified zero month.
create or replace function private.pay_stub_has_verified_zero_snapshot(
  p_period_id uuid, p_machine_id uuid
)
returns boolean
language sql stable security invoker set search_path = ''
as $$
  select exists (
    select 1
    from public.payout_period_machine_revenue_snapshots snapshot
    join public.payout_periods period on period.id = snapshot.payout_period_id
      and period.account_id = snapshot.account_id
      and period.period_start_date = snapshot.period_start_date
      and period.period_end_date = snapshot.period_end_date
    cross join lateral private.operator_machine_tax_snapshot(
      p_machine_id, period.period_start_date, period.period_end_date
    ) facts(value)
    cross join lateral public.operator_revenue_snapshot_source_values(
      period.id, p_machine_id
    ) source_values(value)
    where snapshot.payout_period_id = p_period_id
      and snapshot.reporting_machine_id = p_machine_id
      and snapshot.status = 'manual_override'
      and nullif(btrim(snapshot.manual_override_reason), '') is not null
      and snapshot.gross_sales_cents = 0
      and snapshot.refund_adjustment_cents = 0
      and snapshot.tax_cents = 0
      and snapshot.eligible_commission_revenue_cents = 0
      and (facts.value ->> 'grossSalesCents')::bigint = 0
      and (facts.value ->> 'refundAdjustmentCents')::bigint = 0
      and (facts.value ->> 'taxCents')::bigint = 0
      and (facts.value ->> 'commissionableSalesCents')::bigint = 0
      and (source_values.value ->> 'sourceSalesRowCount')::bigint = 0
      and (source_values.value ->> 'sourceAdjustmentRowCount')::bigint = 0
      and (facts.value ->> 'taxRateCompleteForSales')::boolean is true
      and (source_values.value #>> '{sourceMetadata,calculationComplete}')::boolean is true
  );
$$;
revoke all on function private.pay_stub_has_verified_zero_snapshot(uuid,uuid)
  from public,anon,authenticated;
grant execute on function private.pay_stub_has_verified_zero_snapshot(uuid,uuid)
  to service_role;

