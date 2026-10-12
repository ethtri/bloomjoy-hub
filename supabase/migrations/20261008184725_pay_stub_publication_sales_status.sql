-- Publication must use the same closed-month status rules as the Pay Report.
-- Keep only audited zero attestations that still match empty current facts;
-- a generated empty snapshot is not evidence of a verified zero month.
create function private.pay_stub_has_verified_zero_snapshot(
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
      and (facts.value ->> 'sourceSalesRowCount')::bigint = 0
      and (facts.value ->> 'sourceAdjustmentRowCount')::bigint = 0
      and (facts.value ->> 'taxRateCompleteForSales')::boolean is true
  );
$$;
revoke all on function private.pay_stub_has_verified_zero_snapshot(uuid,uuid)
  from public,anon,authenticated;
grant execute on function private.pay_stub_has_verified_zero_snapshot(uuid,uuid)
  to service_role;

-- Keep the deployed preparation implementation and its permissions, locking,
-- source revision, cash policy and statement/YTD payload contracts intact.
do $patch$
declare
  definition text := replace(pg_get_functiondef(
    'public.service_prepare_pay_stub_without_time_source_revision(uuid)'::regprocedure
  ), E'\r\n', E'\n');
  refresh_call text := 'perform public.service_refresh_pay_stub_revenue_snapshot(period_row.id, machine_id);';
  status_gate text := 'if not coalesce((report ->> ''publishable'')::boolean, false) then';
begin
  if cardinality(string_to_array(definition, refresh_call)) <> 2
    or cardinality(string_to_array(definition, status_gate)) <> 2 then
    raise exception 'Pay Stub preparation contract changed; review before applying';
  end if;
  definition := replace(definition, refresh_call,
    'if not private.pay_stub_has_verified_zero_snapshot(period_row.id, machine_id) then
      ' || refresh_call || '
    end if;');
  definition := replace(definition, status_gate,
    'report := private.normalize_technician_pay_report_status(
    report, period_row.period_start_date, period_row.period_end_date,
    timezone(''America/Los_Angeles'', now())::date
  );

  ' || status_gate);
  execute definition;
end;
$patch$;
