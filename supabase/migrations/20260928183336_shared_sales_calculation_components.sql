-- #1571: one private cents contract for sales and refund consumers.
--
-- This migration deliberately stops before assigning a refund to an accounting
-- date. The candidate helper exposes the original-sale, request-receipt, and
-- paid-evidence dates so the residual finance choice can be made without
-- rewriting the amount and deduplication rules.

create or replace function private.normalize_financial_amount_cents(
  p_amount_cents bigint,
  p_amount_basis text,
  p_tax_rate_percent numeric default null,
  p_separate_tax_cents bigint default null
)
returns table (
  recorded_amount_cents bigint,
  tax_exclusive_amount_cents bigint,
  tax_cents bigint,
  amount_basis text,
  normalization_status text,
  normalization_reason text
)
language plpgsql
immutable
set search_path = ''
as $$
declare
  normalized_basis text := case lower(btrim(coalesce(p_amount_basis, '')))
    when 'tax_exclusive' then 'tax_exclusive'
    when 'tax_exclusive_minor' then 'tax_exclusive'
    when 'tax_inclusive' then 'tax_inclusive'
    when 'gross_customer_charge_minor' then 'tax_inclusive'
    when 'separate_tax' then 'separate_tax'
    when 'separately_imported_tax' then 'separate_tax'
    when 'legacy_percentage_of_gross_estimate' then 'legacy_percentage_of_gross_estimate'
    else 'unknown'
  end;
  calculated_tax bigint;
begin
  if p_amount_cents is not null and p_amount_cents < 0 then
    raise exception 'Financial amount cents must be nonnegative' using errcode = '22023';
  end if;
  if p_separate_tax_cents is not null and p_separate_tax_cents < 0 then
    raise exception 'Separate tax cents must be nonnegative' using errcode = '22023';
  end if;
  if p_tax_rate_percent is not null
    and (p_tax_rate_percent < 0 or p_tax_rate_percent > 100) then
    raise exception 'Tax rate percent must be between zero and 100' using errcode = '22023';
  end if;

  recorded_amount_cents := p_amount_cents;
  amount_basis := normalized_basis;

  if p_amount_cents is null then
    tax_exclusive_amount_cents := null;
    tax_cents := null;
    normalization_status := 'missing';
    normalization_reason := 'amount_missing';
    return next;
    return;
  end if;

  case normalized_basis
    when 'tax_exclusive' then
      tax_exclusive_amount_cents := p_amount_cents;
      tax_cents := 0;
      normalization_status := 'proved';
      normalization_reason := 'source_tax_exclusive';
    when 'tax_inclusive' then
      if p_tax_rate_percent is null then
        tax_exclusive_amount_cents := null;
        tax_cents := null;
        normalization_status := 'unknown';
        normalization_reason := 'verified_tax_rate_missing';
      else
        calculated_tax := round(
          p_amount_cents::numeric * p_tax_rate_percent / (100 + p_tax_rate_percent)
        )::bigint;
        tax_exclusive_amount_cents := p_amount_cents - calculated_tax;
        tax_cents := calculated_tax;
        normalization_status := 'proved';
        normalization_reason := 'embedded_tax_extracted';
      end if;
    when 'separate_tax' then
      if p_amount_cents = 0 and p_separate_tax_cents is null then
        tax_exclusive_amount_cents := 0;
        tax_cents := 0;
        normalization_status := 'proved';
        normalization_reason := 'zero_amount_has_zero_tax';
      elsif p_separate_tax_cents is null then
        tax_exclusive_amount_cents := null;
        tax_cents := null;
        normalization_status := 'unknown';
        normalization_reason := 'separate_tax_missing';
      elsif p_separate_tax_cents > p_amount_cents then
        raise exception 'Separate tax cents cannot exceed the recorded amount'
          using errcode = '22023';
      else
        tax_exclusive_amount_cents := p_amount_cents - p_separate_tax_cents;
        tax_cents := p_separate_tax_cents;
        normalization_status := 'proved';
        normalization_reason := 'separate_tax_subtracted';
      end if;
    when 'legacy_percentage_of_gross_estimate' then
      if p_tax_rate_percent is null then
        tax_exclusive_amount_cents := null;
        tax_cents := null;
        normalization_status := 'unknown';
        normalization_reason := 'estimate_tax_rate_missing';
      else
        calculated_tax := round(
          p_amount_cents::numeric * p_tax_rate_percent / 100
        )::bigint;
        tax_exclusive_amount_cents := greatest(p_amount_cents - calculated_tax, 0);
        tax_cents := least(calculated_tax, p_amount_cents);
        normalization_status := 'estimated';
        normalization_reason := 'legacy_percentage_of_gross_estimate';
      end if;
    else
      tax_exclusive_amount_cents := null;
      tax_cents := null;
      normalization_status := 'unknown';
      normalization_reason := 'amount_basis_unproved';
  end case;

  return next;
end;
$$;

create or replace function private.normalize_refund_cents(
  p_request_target_cents bigint,
  p_paid_cumulative_cents bigint,
  p_amount_basis text,
  p_tax_rate_percent numeric default null,
  p_target_separate_tax_cents bigint default null,
  p_paid_separate_tax_cents bigint default null
)
returns table (
  request_target_cents bigint,
  paid_cumulative_cents bigint,
  request_target_ex_tax_cents bigint,
  paid_cumulative_ex_tax_cents bigint,
  outstanding_request_ex_tax_cents bigint,
  combined_refund_ex_tax_cents bigint,
  request_target_tax_cents bigint,
  paid_cumulative_tax_cents bigint,
  amount_basis text,
  normalization_status text
)
language plpgsql
immutable
set search_path = ''
as $$
declare
  target_row record;
  paid_row record;
begin
  if p_paid_cumulative_cents is not null and p_paid_cumulative_cents < 0 then
    raise exception 'Paid cumulative cents must be nonnegative' using errcode = '22023';
  end if;

  select * into target_row
  from private.normalize_financial_amount_cents(
    p_request_target_cents,
    p_amount_basis,
    p_tax_rate_percent,
    p_target_separate_tax_cents
  );
  select * into paid_row
  from private.normalize_financial_amount_cents(
    coalesce(p_paid_cumulative_cents, 0),
    p_amount_basis,
    p_tax_rate_percent,
    p_paid_separate_tax_cents
  );

  request_target_cents := p_request_target_cents;
  paid_cumulative_cents := coalesce(p_paid_cumulative_cents, 0);
  request_target_ex_tax_cents := target_row.tax_exclusive_amount_cents;
  paid_cumulative_ex_tax_cents := paid_row.tax_exclusive_amount_cents;
  request_target_tax_cents := target_row.tax_cents;
  paid_cumulative_tax_cents := paid_row.tax_cents;
  amount_basis := target_row.amount_basis;

  if target_row.tax_exclusive_amount_cents is null then
    outstanding_request_ex_tax_cents := null;
    combined_refund_ex_tax_cents := paid_row.tax_exclusive_amount_cents;
    normalization_status := case
      when paid_row.tax_exclusive_amount_cents is null then 'unknown'
      else 'paid_only_target_unknown'
    end;
  elsif paid_row.tax_exclusive_amount_cents is null then
    outstanding_request_ex_tax_cents := null;
    combined_refund_ex_tax_cents := null;
    normalization_status := 'unknown';
  else
    -- Normalize the cumulative values first. Normalizing the remaining gross
    -- amount separately can shift a cent after partial payments.
    outstanding_request_ex_tax_cents := greatest(
      target_row.tax_exclusive_amount_cents - paid_row.tax_exclusive_amount_cents,
      0
    );
    combined_refund_ex_tax_cents := paid_row.tax_exclusive_amount_cents
      + outstanding_request_ex_tax_cents;
    normalization_status := case
      when target_row.normalization_status = 'estimated'
        or paid_row.normalization_status = 'estimated' then 'estimated'
      else 'proved'
    end;
  end if;

  return next;
end;
$$;

create or replace function private.machine_sales_calculation_candidates(
  p_reporting_machine_id uuid,
  p_date_from date,
  p_date_to date
)
returns table (
  component_kind text,
  component_identity text,
  refund_case_id uuid,
  tender text,
  source text,
  sale_date date,
  incident_date date,
  request_received_date date,
  paid_date date,
  component_amount_cents bigint,
  request_target_cents bigint,
  linked_paid_cumulative_cents bigint,
  amount_basis text,
  amount_provenance text,
  tax_rate_percent numeric,
  tax_exclusive_amount_cents bigint,
  tax_cents bigint,
  normalization_status text
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if p_reporting_machine_id is null
    or p_date_from is null
    or p_date_to is null
    or p_date_from > p_date_to then
    raise exception 'Valid machine and date range required' using errcode = '22023';
  end if;

  return query
  with machine_scope as materialized (
    select machine.id, location.timezone
    from public.reporting_machines machine
    join public.reporting_locations location on location.id = machine.location_id
    where machine.id = p_reporting_machine_id
  ),
  sales as materialized (
    select
      'sale'::text as component_kind,
      'sale:' || fact.id::text as component_identity,
      null::uuid as refund_case_id,
      case fact.payment_method
        when 'credit' then 'card'
        when 'cash' then 'cash'
        when 'other' then 'other'
        else 'unknown'
      end::text as tender,
      fact.source,
      fact.sale_date,
      null::date as incident_date,
      null::date as request_received_date,
      null::date as paid_date,
      fact.net_sales_cents::bigint as component_amount_cents,
      null::bigint as request_target_cents,
      null::bigint as linked_paid_cumulative_cents,
      basis.amount_basis,
      basis.amount_provenance,
      rate.tax_rate_percent,
      normalized.tax_exclusive_amount_cents,
      normalized.tax_cents,
      normalized.normalization_status
    from public.machine_sales_facts fact
    join machine_scope scope on scope.id = fact.reporting_machine_id
    left join lateral (
      select tax_rate.tax_rate_percent
      from public.reporting_machine_tax_rates tax_rate
      where tax_rate.machine_id = fact.reporting_machine_id
        and tax_rate.status = 'active'
        and tax_rate.effective_start_date <= fact.sale_date
        and coalesce(tax_rate.effective_end_date, 'infinity'::date) >= fact.sale_date
      order by tax_rate.effective_start_date desc, tax_rate.created_at desc, tax_rate.id
      limit 1
    ) rate on true
    cross join lateral (
      select
        case
          when lower(coalesce(fact.raw_payload ->> 'amountBasis', '')) in (
            'tax_exclusive', 'tax_exclusive_minor'
          ) then 'tax_exclusive'
          when lower(coalesce(fact.raw_payload ->> 'amountBasis', '')) in (
            'tax_inclusive', 'gross_customer_charge_minor'
          ) then 'tax_inclusive'
          when lower(coalesce(fact.raw_payload ->> 'amountBasis', '')) in (
            'separate_tax', 'separately_imported_tax'
          ) then 'separate_tax'
          when lower(coalesce(fact.raw_payload ->> 'amountBasis', '')) =
            'legacy_percentage_of_gross_estimate'
          then 'legacy_percentage_of_gross_estimate'
          when lower(coalesce(fact.raw_payload ->> 'taxBasis', '')) in (
            'separate_tax', 'separately_imported_tax'
          ) then 'separate_tax'
          when fact.source = 'sunze_browser' then 'tax_exclusive'
          when fact.source in (
            'nayax_scheduled_report', 'card_authority_daily', 'snapcase_cash'
          ) then 'tax_inclusive'
          else 'unknown'
        end::text as amount_basis,
        case
          when fact.raw_payload ? 'amountBasis' then 'source_amount_basis'
          when lower(coalesce(fact.raw_payload ->> 'taxBasis', '')) in (
            'separate_tax', 'separately_imported_tax'
          ) then 'source_tax_basis'
          when fact.source in ('nayax_scheduled_report', 'card_authority_daily')
            then 'nayax_settled_customer_charge'
          when fact.source = 'snapcase_cash' then 'vendor_cash_customer_charge'
          when fact.source = 'sunze_browser'
            then 'sunze_orders_tax_exclusive_revenue'
          else 'recorded_amount_basis_unproved'
        end::text as amount_provenance
    ) basis
    cross join lateral private.normalize_financial_amount_cents(
      fact.net_sales_cents,
      basis.amount_basis,
      rate.tax_rate_percent,
      case when basis.amount_basis = 'separate_tax' then fact.tax_cents else null end
    ) normalized
    where fact.sale_date between p_date_from and p_date_to
      and fact.net_sales_cents > 0
  ),
  case_context as materialized (
    select
      refund_case.*,
      scope.timezone as machine_timezone,
      (refund_case.incident_at at time zone scope.timezone)::date as local_incident_date,
      case when refund_case.customer_request_received_at is null then null
        else (refund_case.customer_request_received_at at time zone scope.timezone)::date
      end as local_request_date,
      case
        when refund_case.decision = 'denied' or refund_case.status = 'denied' then 0
        when coalesce(refund_case.refund_amount_cents, 0) > 0
          then refund_case.refund_amount_cents
        when coalesce(refund_case.payment_amount_cents, 0) > 0
          then refund_case.payment_amount_cents
        else null
      end::bigint as target_cents,
      case
        when refund_case.decision = 'denied' or refund_case.status = 'denied'
          then 'denied_request_zeroed'
        when coalesce(refund_case.refund_amount_cents, 0) > 0
          and refund_case.decision = 'approved'
          then 'approved_case_amount'
        when coalesce(refund_case.refund_amount_cents, 0) > 0
          and refund_case.refund_amount_cents is distinct from refund_case.payment_amount_cents
          then 'reviewed_or_corrected_case_amount'
        when coalesce(refund_case.refund_amount_cents, 0) > 0
          then 'customer_estimate_carried_forward'
        when coalesce(refund_case.payment_amount_cents, 0) > 0
          then 'customer_reported_estimate'
        else 'request_amount_missing'
      end::text as target_provenance,
      case
        when refund_case.customer_request_received_source = 'hosted_refund_intake'
          then 'tax_inclusive'
        when refund_case.correlation_source = 'nayax'
          and refund_case.payment_method = 'card' then 'tax_inclusive'
        else 'unknown'
      end::text as target_amount_basis,
      case
        when refund_case.customer_request_received_source = 'hosted_refund_intake'
          then 'hosted_intake_customer_charge_estimate'
        when refund_case.correlation_source = 'nayax'
          and refund_case.payment_method = 'card'
          then 'nayax_settled_customer_charge'
        else 'refund_amount_basis_unproved'
      end::text as target_basis_provenance
    from public.refund_cases refund_case
    join machine_scope scope on scope.id = refund_case.reporting_machine_id
  ),
  cases as materialized (
    select
      candidate.*,
      coalesce(linked_paid.amount_cents, 0)::bigint as linked_paid_cents,
      linked_paid.latest_paid_date,
      coalesce(linked_paid.intersects_scope, false) as paid_intersects_scope
    from case_context candidate
    left join lateral (
      with recursive lineage as (
        select
          candidate.id,
          candidate.reporting_adjustment_id,
          array[candidate.id]::uuid[] as path
        union all
        select
          child.id,
          child.reporting_adjustment_id,
          lineage.path || child.id
        from public.refund_cases child
        join lineage on child.duplicate_of_refund_case_id = lineage.id
        where child.case_population = 'customer'
          and not child.id = any(lineage.path)
      )
      select
        coalesce(sum(adjustment.amount_cents), 0)::bigint as amount_cents,
        max(adjustment.adjustment_date) as latest_paid_date,
        bool_or(adjustment.adjustment_date between p_date_from and p_date_to)
          as intersects_scope
      from public.sales_adjustment_facts adjustment
      where adjustment.adjustment_type in ('refund', 'complaint_refund')
        and adjustment.amount_cents > 0
        and exists (
          select 1
          from lineage
          where adjustment.refund_case_id = lineage.id
            or (
              adjustment.refund_case_id is null
              and adjustment.id = lineage.reporting_adjustment_id
            )
        )
    ) linked_paid on true
    where candidate.case_population = 'customer'
      and candidate.duplicate_of_refund_case_id is null
  ),
  requests as materialized (
    select
      'refund_request_outstanding'::text as component_kind,
      'request:' || candidate.id::text as component_identity,
      candidate.id as refund_case_id,
      case candidate.payment_method
        when 'card' then 'card'
        when 'cash' then 'cash'
        else 'unknown'
      end::text as tender,
      'refund_case'::text as source,
      null::date as sale_date,
      candidate.local_incident_date as incident_date,
      candidate.local_request_date as request_received_date,
      candidate.latest_paid_date as paid_date,
      case when candidate.target_cents is null then null
        else greatest(candidate.target_cents - candidate.linked_paid_cents, 0)
      end::bigint as component_amount_cents,
      candidate.target_cents as request_target_cents,
      candidate.linked_paid_cents as linked_paid_cumulative_cents,
      candidate.target_amount_basis as amount_basis,
      candidate.target_provenance || ':' || candidate.target_basis_provenance
        as amount_provenance,
      null::numeric as tax_rate_percent,
      null::bigint as tax_exclusive_amount_cents,
      null::bigint as tax_cents,
      case when candidate.target_cents is null then 'missing'
        when candidate.target_amount_basis = 'unknown'
          then 'amount_basis_and_date_policy_pending'
        else 'date_and_tax_policy_pending'
      end::text as normalization_status
    from cases candidate
    where candidate.local_incident_date between p_date_from and p_date_to
      or candidate.local_request_date between p_date_from and p_date_to
      or candidate.paid_intersects_scope
  ),
  paid as materialized (
    select
      'refund_paid'::text as component_kind,
      'paid:' || adjustment.id::text as component_identity,
      coalesce(adjustment.refund_case_id, linked_case.id) as refund_case_id,
      case
        when adjustment.source = 'nayax_provider_refund' then 'card'
        when linked_case.payment_method = 'card' then 'card'
        when linked_case.payment_method = 'cash' then 'cash'
        when lower(btrim(coalesce(adjustment.raw_payload ->> 'payment_method', '')))
          in ('card', 'credit') then 'card'
        when lower(btrim(coalesce(adjustment.raw_payload ->> 'payment_method', ''))) = 'cash'
          then 'cash'
        when lower(btrim(coalesce(adjustment.raw_payload ->> 'payment_method', ''))) = 'other'
          then 'other'
        else 'unknown'
      end::text as tender,
      adjustment.source,
      null::date as sale_date,
      case when linked_case.id is null then null
        else (linked_case.incident_at at time zone scope.timezone)::date
      end as incident_date,
      case when linked_case.customer_request_received_at is null then null
        else (linked_case.customer_request_received_at at time zone scope.timezone)::date
      end as request_received_date,
      adjustment.adjustment_date as paid_date,
      adjustment.amount_cents::bigint as component_amount_cents,
      null::bigint as request_target_cents,
      null::bigint as linked_paid_cumulative_cents,
      case
        when lower(coalesce(adjustment.raw_payload ->> 'amountBasis', '')) in (
          'tax_exclusive', 'tax_exclusive_minor'
        ) then 'tax_exclusive'
        when lower(coalesce(adjustment.raw_payload ->> 'amountBasis', '')) in (
          'tax_inclusive', 'gross_customer_charge_minor'
        ) then 'tax_inclusive'
        when lower(coalesce(adjustment.raw_payload ->> 'amountBasis', '')) in (
          'separate_tax', 'separately_imported_tax'
        ) then 'separate_tax'
        when adjustment.source = 'nayax_provider_refund' then 'tax_inclusive'
        when linked_case.id is not null then linked_case.target_amount_basis
        else 'unknown'
      end::text as amount_basis,
      case
        when adjustment.raw_payload ? 'amountBasis' then 'paid_adjustment_amount_basis'
        when adjustment.source = 'nayax_provider_refund'
          then 'nayax_provider_refund_customer_charge'
        when adjustment.refund_case_id is null and linked_case.id is null
          then 'independent_paid_adjustment_basis_unproved'
        when adjustment.refund_case_id is null
          then 'legacy_case_backlinked_paid_adjustment:' || linked_case.target_basis_provenance
        else 'case_linked_paid_adjustment:' || linked_case.target_basis_provenance
      end::text as amount_provenance,
      null::numeric as tax_rate_percent,
      null::bigint as tax_exclusive_amount_cents,
      null::bigint as tax_cents,
      case
        when lower(coalesce(adjustment.raw_payload ->> 'amountBasis', '')) in (
          'tax_exclusive', 'tax_exclusive_minor', 'tax_inclusive',
          'gross_customer_charge_minor', 'separate_tax', 'separately_imported_tax'
        ) or adjustment.source = 'nayax_provider_refund'
          or coalesce(linked_case.target_amount_basis, 'unknown') <> 'unknown'
          then 'date_and_tax_policy_pending'
        else 'amount_basis_and_date_policy_pending'
      end::text as normalization_status
    from public.sales_adjustment_facts adjustment
    join machine_scope scope on scope.id = adjustment.reporting_machine_id
    left join lateral (
      select candidate.*
      from case_context candidate
      where candidate.id = adjustment.refund_case_id
        or (
          adjustment.refund_case_id is null
          and candidate.reporting_adjustment_id = adjustment.id
        )
      order by (candidate.id = adjustment.refund_case_id) desc, candidate.id
      limit 1
    ) linked_case on true
    where adjustment.adjustment_type in ('refund', 'complaint_refund')
      and adjustment.amount_cents > 0
      and coalesce(linked_case.case_population, 'customer') <> 'internal_test'
      and (
        adjustment.adjustment_date between p_date_from and p_date_to
        or (linked_case.incident_at at time zone scope.timezone)::date
          between p_date_from and p_date_to
        or (linked_case.customer_request_received_at at time zone scope.timezone)::date
          between p_date_from and p_date_to
      )
  )
  select * from sales
  union all
  select * from requests
  union all
  select * from paid;
end;
$$;

revoke all on function private.normalize_financial_amount_cents(bigint, text, numeric, bigint)
  from public, anon, authenticated;
grant execute on function private.normalize_financial_amount_cents(bigint, text, numeric, bigint)
  to service_role;
revoke all on function private.normalize_refund_cents(bigint, bigint, text, numeric, bigint, bigint)
  from public, anon, authenticated;
grant execute on function private.normalize_refund_cents(bigint, bigint, text, numeric, bigint, bigint)
  to service_role;
revoke all on function private.machine_sales_calculation_candidates(uuid, date, date)
  from public, anon, authenticated;
grant execute on function private.machine_sales_calculation_candidates(uuid, date, date)
  to service_role;

comment on function private.machine_sales_calculation_candidates(uuid, date, date) is
  'Private source-aware sales, outstanding-request, and paid-refund evidence-union candidates. The date range finds rows through sale, incident, request, or paid evidence and is not a final additive accounting period. Evidence dates are intentionally separate until refund period attribution is approved. Per-fact normalized sales values are diagnostic; financial rollups must first group recorded cents by machine-local day, effective basis and rate, then round once at that approved scope.';
