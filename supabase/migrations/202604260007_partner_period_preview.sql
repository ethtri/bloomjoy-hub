drop function if exists public.admin_preview_partner_period_report(uuid, date, date, text);

create or replace function public.admin_preview_partner_period_report(
  p_partnership_id uuid,
  p_date_from date,
  p_date_to date,
  p_period_grain text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  normalized_grain text;
  result jsonb;
  partnership_row public.reporting_partnerships;
begin
  if not public.is_super_admin(auth.uid()) then
    raise exception 'Admin access required';
  end if;

  normalized_grain := lower(coalesce(nullif(trim(p_period_grain), ''), 'reporting_week'));

  if p_partnership_id is null then
    raise exception 'Partnership is required';
  end if;

  if p_date_from is null or p_date_to is null then
    raise exception 'Date range is required';
  end if;

  if p_date_from > p_date_to then
    raise exception 'Date range is invalid';
  end if;

  if normalized_grain not in ('reporting_week', 'calendar_month') then
    raise exception 'Invalid period grain: %', p_period_grain;
  end if;

  select *
  into partnership_row
  from public.reporting_partnerships partnership
  where partnership.id = p_partnership_id;

  if partnership_row.id is null then
    raise exception 'Partnership not found';
  end if;

  with weekly_bounds as (
    select
      (
        p_date_from
        + ((partnership_row.reporting_week_end_day - extract(dow from p_date_from)::integer + 7) % 7)
      )::date as first_week_end,
      (
        p_date_to
        - ((extract(dow from p_date_to)::integer - partnership_row.reporting_week_end_day + 7) % 7)
      )::date as last_week_end
  ),
  period_windows as (
    select
      (week_end::date - 6) as period_start,
      week_end::date as period_end
    from weekly_bounds bounds
    cross join lateral generate_series(
      bounds.first_week_end,
      bounds.last_week_end,
      interval '7 days'
    ) as week_end
    where normalized_grain = 'reporting_week'
      and bounds.first_week_end <= bounds.last_week_end

    union all

    select
      month_start::date as period_start,
      (month_start + interval '1 month' - interval '1 day')::date as period_end
    from generate_series(
      date_trunc('month', p_date_from::timestamp)::date,
      date_trunc('month', p_date_to::timestamp)::date,
      interval '1 month'
    ) as month_start
    where normalized_grain = 'calendar_month'
  ),
  assigned_machine_periods as (
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
      and (assignment.effective_end_date is null or assignment.effective_end_date >= period.period_start)
    join public.reporting_machines machine on machine.id = assignment.machine_id
    left join public.reporting_locations location on location.id = machine.location_id
  ),
  scoped_facts as (
    -- Partner settlement follows the canonical Bubble Planet baseline:
    -- Sunze Order amount is the gross sales basis, then machine tax and configured
    -- paid-order fees are deducted before applying the active split rule.
    select
      period.period_start,
      period.period_end,
      fact.id,
      fact.reporting_machine_id,
      machine.machine_label,
      location.name as location_name,
      fact.sale_date,
      fact.payment_method,
      fact.net_sales_cents as source_order_amount_cents,
      fact.transaction_count,
      fact.item_quantity,
      fact.tax_cents as imported_tax_cents,
      tax.tax_rate_percent,
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
    from public.machine_sales_facts fact
    join period_windows period on fact.sale_date between period.period_start and period.period_end
    join public.reporting_machines machine on machine.id = fact.reporting_machine_id
    left join public.reporting_locations location on location.id = machine.location_id
    join public.reporting_machine_partnership_assignments assignment
      on assignment.machine_id = fact.reporting_machine_id
      and assignment.partnership_id = p_partnership_id
      and assignment.assignment_role = 'primary_reporting'
      and assignment.status = 'active'
      and assignment.effective_start_date <= fact.sale_date
      and (assignment.effective_end_date is null or assignment.effective_end_date >= fact.sale_date)
    left join lateral (
      select tax_rate.tax_rate_percent
      from public.reporting_machine_tax_rates tax_rate
      where tax_rate.machine_id = fact.reporting_machine_id
        and tax_rate.status = 'active'
        and tax_rate.effective_start_date <= fact.sale_date
        and (tax_rate.effective_end_date is null or tax_rate.effective_end_date >= fact.sale_date)
      order by tax_rate.effective_start_date desc
      limit 1
    ) tax on true
    left join lateral (
      select financial_rule.*
      from public.reporting_partnership_financial_rules financial_rule
      where financial_rule.partnership_id = p_partnership_id
        and financial_rule.status = 'active'
        and financial_rule.effective_start_date <= fact.sale_date
        and (financial_rule.effective_end_date is null or financial_rule.effective_end_date >= fact.sale_date)
      order by financial_rule.effective_start_date desc
      limit 1
    ) rule on true
    where fact.sale_date between p_date_from and p_date_to
  ),
  calculated as (
    select
      fact.*,
      case
        when fact.source_order_amount_cents <= 0 then 0
        when fact.gross_to_net_method = 'imported_tax_plus_configured_fees' then fact.imported_tax_cents
        when fact.gross_to_net_method = 'configured_fees_only' then 0
        else round(fact.source_order_amount_cents * coalesce(fact.tax_rate_percent, 0) / 100.0)::integer
      end as calculated_tax_cents,
      case
        when fact.source_order_amount_cents <= 0 then 0
        when fact.fee_basis in ('per_order', 'per_transaction') then coalesce(fact.fee_amount_cents, 0) * coalesce(fact.transaction_count, 1)
        when fact.fee_basis = 'per_stick' then coalesce(fact.fee_amount_cents, 0) * coalesce(fact.item_quantity, 1)
        else 0
      end as fee_cents,
      case
        when fact.source_order_amount_cents <= 0 then 0
        when fact.cost_basis = 'per_order' then coalesce(fact.cost_amount_cents, 0) * coalesce(fact.transaction_count, 1)
        when fact.cost_basis = 'per_stick' then coalesce(fact.cost_amount_cents, 0) * coalesce(fact.item_quantity, 1)
        when fact.cost_basis = 'percentage_of_sales' then round(fact.source_order_amount_cents * coalesce(fact.cost_amount_cents, 0) / 10000.0)::integer
        else 0
      end as cost_cents
    from scoped_facts fact
  ),
  row_amounts as (
    select
      calculated.*,
      calculated.source_order_amount_cents as gross_sales_cents,
      greatest(calculated.source_order_amount_cents - calculated.calculated_tax_cents - calculated.fee_cents, 0) as net_sales_cents,
      case
        when calculated.deduction_timing = 'before_split' then calculated.cost_cents
        else 0
      end as split_deductible_cost_cents
    from calculated
  ),
  split_rows as (
    select
      row_amounts.*,
      case
        when row_amounts.split_base = 'gross_sales' then row_amounts.gross_sales_cents
        when row_amounts.split_base = 'contribution_after_costs' then greatest(row_amounts.net_sales_cents - row_amounts.split_deductible_cost_cents, 0)
        else row_amounts.net_sales_cents
      end as split_base_cents
    from row_amounts
  ),
  split_amounts as (
    select
      split_rows.*,
      round(split_rows.split_base_cents * coalesce(split_rows.partner_share_basis_points, 0) / 10000.0)::bigint as amount_owed_cents,
      round(split_rows.split_base_cents * coalesce(split_rows.bloomjoy_share_basis_points, 0) / 10000.0)::bigint as bloomjoy_retained_cents
    from split_rows
  ),
  period_amounts as (
    select
      period_start,
      period_end,
      coalesce(sum(transaction_count), 0)::integer as order_count,
      coalesce(sum(item_quantity), 0)::integer as item_quantity,
      coalesce(sum(gross_sales_cents), 0)::bigint as gross_sales_cents,
      coalesce(sum(calculated_tax_cents), 0)::bigint as tax_cents,
      coalesce(sum(fee_cents), 0)::bigint as fee_cents,
      coalesce(sum(cost_cents), 0)::bigint as cost_cents,
      coalesce(sum(net_sales_cents), 0)::bigint as net_sales_cents,
      coalesce(sum(split_base_cents), 0)::bigint as split_base_cents,
      coalesce(sum(amount_owed_cents), 0)::bigint as amount_owed_cents,
      coalesce(sum(bloomjoy_retained_cents), 0)::bigint as bloomjoy_retained_cents
    from split_amounts
    group by period_start, period_end
  ),
  machine_amounts as (
    select
      period_start,
      period_end,
      reporting_machine_id,
      machine_label,
      location_name,
      coalesce(sum(transaction_count), 0)::integer as order_count,
      coalesce(sum(item_quantity), 0)::integer as item_quantity,
      coalesce(sum(gross_sales_cents), 0)::bigint as gross_sales_cents,
      coalesce(sum(calculated_tax_cents), 0)::bigint as tax_cents,
      coalesce(sum(fee_cents), 0)::bigint as fee_cents,
      coalesce(sum(cost_cents), 0)::bigint as cost_cents,
      coalesce(sum(net_sales_cents), 0)::bigint as net_sales_cents,
      coalesce(sum(split_base_cents), 0)::bigint as split_base_cents,
      coalesce(sum(amount_owed_cents), 0)::bigint as amount_owed_cents,
      coalesce(sum(bloomjoy_retained_cents), 0)::bigint as bloomjoy_retained_cents
    from split_amounts
    group by period_start, period_end, reporting_machine_id, machine_label, location_name
  ),
  periods as (
    select
      period.period_start,
      period.period_end,
      coalesce(amount.order_count, 0)::integer as order_count,
      coalesce(amount.item_quantity, 0)::integer as item_quantity,
      coalesce(amount.gross_sales_cents, 0)::bigint as gross_sales_cents,
      coalesce(amount.tax_cents, 0)::bigint as tax_cents,
      coalesce(amount.fee_cents, 0)::bigint as fee_cents,
      coalesce(amount.cost_cents, 0)::bigint as cost_cents,
      coalesce(amount.net_sales_cents, 0)::bigint as net_sales_cents,
      coalesce(amount.split_base_cents, 0)::bigint as split_base_cents,
      coalesce(amount.amount_owed_cents, 0)::bigint as amount_owed_cents,
      coalesce(amount.bloomjoy_retained_cents, 0)::bigint as bloomjoy_retained_cents
    from period_windows period
    left join period_amounts amount
      on amount.period_start = period.period_start
      and amount.period_end = period.period_end
  ),
  machine_periods as (
    select
      assigned.period_start,
      assigned.period_end,
      assigned.reporting_machine_id,
      assigned.machine_label,
      assigned.location_name,
      coalesce(amount.order_count, 0)::integer as order_count,
      coalesce(amount.item_quantity, 0)::integer as item_quantity,
      coalesce(amount.gross_sales_cents, 0)::bigint as gross_sales_cents,
      coalesce(amount.tax_cents, 0)::bigint as tax_cents,
      coalesce(amount.fee_cents, 0)::bigint as fee_cents,
      coalesce(amount.cost_cents, 0)::bigint as cost_cents,
      coalesce(amount.net_sales_cents, 0)::bigint as net_sales_cents,
      coalesce(amount.split_base_cents, 0)::bigint as split_base_cents,
      coalesce(amount.amount_owed_cents, 0)::bigint as amount_owed_cents,
      coalesce(amount.bloomjoy_retained_cents, 0)::bigint as bloomjoy_retained_cents
    from assigned_machine_periods assigned
    left join machine_amounts amount
      on amount.period_start = assigned.period_start
      and amount.period_end = assigned.period_end
      and amount.reporting_machine_id = assigned.reporting_machine_id
  ),
  summary as (
    select
      coalesce(sum(order_count), 0)::integer as order_count,
      coalesce(sum(item_quantity), 0)::integer as item_quantity,
      coalesce(sum(gross_sales_cents), 0)::bigint as gross_sales_cents,
      coalesce(sum(tax_cents), 0)::bigint as tax_cents,
      coalesce(sum(fee_cents), 0)::bigint as fee_cents,
      coalesce(sum(cost_cents), 0)::bigint as cost_cents,
      coalesce(sum(net_sales_cents), 0)::bigint as net_sales_cents,
      coalesce(sum(split_base_cents), 0)::bigint as split_base_cents,
      coalesce(sum(amount_owed_cents), 0)::bigint as amount_owed_cents,
      coalesce(sum(bloomjoy_retained_cents), 0)::bigint as bloomjoy_retained_cents
    from periods
  ),
  warnings as (
    select jsonb_build_object(
      'warning_type', 'missing_machine_tax_rate',
      'severity', 'blocking',
      'machine_id', fact.reporting_machine_id,
      'machine_label', fact.machine_label,
      'message', fact.machine_label || ' has sales in this period without an active machine tax rate.'
    ) as warning
    from scoped_facts fact
    where fact.tax_rate_percent is null
      and coalesce(fact.gross_to_net_method, 'machine_tax_plus_configured_fees') <> 'configured_fees_only'
    group by fact.reporting_machine_id, fact.machine_label
    union all
    select jsonb_build_object(
      'warning_type', 'missing_financial_rule',
      'severity', 'blocking',
      'message', 'This report includes sales without an active partnership financial rule.'
    ) as warning
    where exists (select 1 from scoped_facts fact where fact.calculation_model is null)
    union all
    select jsonb_build_object(
      'warning_type', 'no_assigned_machines',
      'severity', 'blocking',
      'message', 'This partnership has no active reporting machines for the selected period.'
    ) as warning
    where not exists (select 1 from assigned_machine_periods)
    union all
    select jsonb_build_object(
      'warning_type', 'no_sales_for_machine',
      'severity', 'non_blocking',
      'machine_id', assigned.reporting_machine_id,
      'machine_label', assigned.machine_label,
      'message', assigned.machine_label || ' has no sales in the selected period.'
    ) as warning
    from (
      select reporting_machine_id, machine_label, sum(order_count) as total_orders
      from machine_periods
      group by reporting_machine_id, machine_label
    ) assigned
    where coalesce(assigned.total_orders, 0) = 0
  )
  select jsonb_build_object(
    'partnership_id', p_partnership_id,
    'partnership_name', partnership_row.name,
    'period_grain', normalized_grain,
    'date_from', p_date_from,
    'date_to', p_date_to,
    'summary', coalesce((select to_jsonb(summary) from summary), '{}'::jsonb),
    'periods', coalesce((select jsonb_agg(to_jsonb(periods) order by periods.period_start) from periods), '[]'::jsonb),
    'machine_periods', coalesce((select jsonb_agg(to_jsonb(machine_periods) order by machine_periods.period_start, machine_periods.machine_label) from machine_periods), '[]'::jsonb),
    'warnings', coalesce((select jsonb_agg(warnings.warning) from warnings), '[]'::jsonb)
  )
  into result;

  return result;
end;
$$;

grant execute on function public.admin_preview_partner_period_report(uuid, date, date, text) to authenticated;
