-- Correct the operator sales report without changing source selection or stored
-- financial facts. Existing callers keep the same response fields:
--   gross_sales_cents = recorded sales before reported refunds
--   refund_amount_cents = reported refund adjustments
--   net_sales_cents = recorded sales after reported refunds
-- Only refund and complaint_refund facts are refund deductions. The generic
-- manual_adjustment type remains outside this refund-specific contract, matching
-- the existing payout and partner-report adjustment filters.

create index if not exists refund_cases_reporting_adjustment_id_idx
  on public.refund_cases (reporting_adjustment_id)
  where reporting_adjustment_id is not null;

create or replace function public.get_sales_report(
  p_date_from date,
  p_date_to date,
  p_grain text default 'week',
  p_machine_ids uuid[] default null,
  p_location_ids uuid[] default null,
  p_payment_methods text[] default null
)
returns table (
  period_start date,
  machine_id uuid,
  machine_label text,
  location_id uuid,
  location_name text,
  payment_method text,
  net_sales_cents bigint,
  refund_amount_cents bigint,
  gross_sales_cents bigint,
  transaction_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_user_id uuid;
  normalized_grain text;
begin
  current_user_id := auth.uid();
  normalized_grain := lower(coalesce(nullif(trim(p_grain), ''), 'week'));

  if current_user_id is null then
    raise exception 'Authentication required';
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
  with accessible_machines as (
    select
      machine.id as machine_id,
      machine.machine_label
    from public.reporting_machines machine
    where public.has_reporting_machine_access(current_user_id, machine.id)
      and (
        p_machine_ids is null
        or cardinality(p_machine_ids) = 0
        or machine.id = any(p_machine_ids)
      )
  ),
  sales_by_method as (
    select
      date_trunc(normalized_grain, fact.sale_date::timestamp)::date as period_start,
      fact.reporting_machine_id as machine_id,
      fact.reporting_location_id as location_id,
      fact.payment_method,
      sum(fact.net_sales_cents)::bigint as recorded_sales_cents,
      sum(fact.transaction_count)::bigint as transaction_count
    from public.machine_sales_facts fact
    join accessible_machines machine on machine.machine_id = fact.reporting_machine_id
    where fact.sale_date between p_date_from and p_date_to
      and (
        p_location_ids is null
        or cardinality(p_location_ids) = 0
        or fact.reporting_location_id = any(p_location_ids)
      )
    group by
      date_trunc(normalized_grain, fact.sale_date::timestamp)::date,
      fact.reporting_machine_id,
      fact.reporting_location_id,
      fact.payment_method
  ),
  adjustment_evidence as (
    select
      date_trunc(normalized_grain, adjustment.adjustment_date::timestamp)::date as period_start,
      adjustment.reporting_machine_id as machine_id,
      adjustment.reporting_location_id as location_id,
      case
        when adjustment.source = 'nayax_provider_refund' then 'credit'
        when refund_case.payment_method = 'card' then 'credit'
        when refund_case.payment_method = 'cash' then 'cash'
        when lower(trim(adjustment.raw_payload ->> 'payment_method')) in ('card', 'credit') then 'credit'
        when lower(trim(adjustment.raw_payload ->> 'payment_method')) = 'cash' then 'cash'
        when lower(trim(adjustment.raw_payload ->> 'payment_method')) = 'other' then 'other'
        else 'unknown'
      end as payment_method,
      adjustment.amount_cents
    from public.sales_adjustment_facts adjustment
    join accessible_machines machine on machine.machine_id = adjustment.reporting_machine_id
    left join lateral (
      select candidate.payment_method
      from public.refund_cases candidate
      where candidate.id = adjustment.refund_case_id
        or (
          adjustment.refund_case_id is null
          and candidate.reporting_adjustment_id = adjustment.id
        )
      order by (candidate.id = adjustment.refund_case_id) desc, candidate.id
      limit 1
    ) refund_case on true
    where adjustment.adjustment_date between p_date_from and p_date_to
      and adjustment.adjustment_type in ('refund', 'complaint_refund')
      and (
        p_location_ids is null
        or cardinality(p_location_ids) = 0
        or adjustment.reporting_location_id = any(p_location_ids)
      )
  ),
  adjustments_by_method as (
    select
      adjustment.period_start,
      adjustment.machine_id,
      adjustment.location_id,
      adjustment.payment_method,
      sum(adjustment.amount_cents)::bigint as refund_amount_cents
    from adjustment_evidence adjustment
    group by
      adjustment.period_start,
      adjustment.machine_id,
      adjustment.location_id,
      adjustment.payment_method
  ),
  report_keys as (
    select
      sales.period_start,
      sales.machine_id,
      sales.location_id,
      sales.payment_method
    from sales_by_method sales
    union
    select
      adjustment.period_start,
      adjustment.machine_id,
      adjustment.location_id,
      adjustment.payment_method
    from adjustments_by_method adjustment
  )
  select
    report.period_start,
    report.machine_id,
    machine.machine_label,
    report.location_id,
    location.name as location_name,
    report.payment_method,
    (
      coalesce(sales.recorded_sales_cents, 0)
      - coalesce(adjustment.refund_amount_cents, 0)
    )::bigint as net_sales_cents,
    coalesce(adjustment.refund_amount_cents, 0)::bigint as refund_amount_cents,
    coalesce(sales.recorded_sales_cents, 0)::bigint as gross_sales_cents,
    coalesce(sales.transaction_count, 0)::bigint as transaction_count
  from report_keys report
  join accessible_machines machine on machine.machine_id = report.machine_id
  join public.reporting_locations location on location.id = report.location_id
  left join sales_by_method sales
    on sales.period_start = report.period_start
    and sales.machine_id = report.machine_id
    and sales.location_id = report.location_id
    and sales.payment_method = report.payment_method
  left join adjustments_by_method adjustment
    on adjustment.period_start = report.period_start
    and adjustment.machine_id = report.machine_id
    and adjustment.location_id = report.location_id
    and adjustment.payment_method = report.payment_method
  where p_payment_methods is null
    or cardinality(p_payment_methods) = 0
    or report.payment_method = any(p_payment_methods)
  order by
    report.period_start desc,
    location.name,
    machine.machine_label,
    report.payment_method;
end;
$$;

revoke all on function public.get_sales_report(date, date, text, uuid[], uuid[], text[])
  from public, anon;
grant execute on function public.get_sales_report(date, date, text, uuid[], uuid[], text[])
  to authenticated, service_role;

comment on function public.get_sales_report(date, date, text, uuid[], uuid[], text[]) is
  'Actor-scoped recorded sales report. gross_sales_cents is recorded sales before reported refunds; net_sales_cents is recorded sales after reported refunds. Only refund and complaint_refund facts are reported refunds. Refund tender is evidence-based and otherwise remains unknown.';
