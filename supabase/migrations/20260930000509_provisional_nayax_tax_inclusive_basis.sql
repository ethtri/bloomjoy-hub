-- #1574: preserve the configured Nayax customer-charge tax treatment before
-- activating shared request-month sales and commission calculations.
-- Explicit per-row basis metadata still wins; Sunze remains tax-exclusive.

create function private.refund_has_hosted_customer_charge_basis(
  p_request_received_source text,
  p_intake_source text,
  p_intake_meta jsonb,
  p_target_cents bigint,
  p_payment_amount_cents integer
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_target_cents is not null
    and p_payment_amount_cents::bigint = p_target_cents
    and (
      p_request_received_source = 'hosted_refund_intake'
      or (
        p_intake_source = 'gmail'
        and p_intake_meta ->> 'source' = 'hosted_refund_intake'
        and p_intake_meta ->> 'intake_path' = 'email_context_form'
      )
    );
$$;

create function private.apply_hosted_customer_charge_event_basis()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  hosted_customer_charge boolean;
begin
  if new.amount_basis <> 'unknown' then
    return new;
  end if;

  select private.refund_has_hosted_customer_charge_basis(
    refund_case.customer_request_received_source,
    refund_case.intake_source,
    refund_case.intake_meta,
    new.request_target_after_cents,
    refund_case.payment_amount_cents
  )
  into hosted_customer_charge
  from public.refund_cases refund_case
  where refund_case.id = new.refund_case_id;

  if coalesce(hosted_customer_charge, false) then
    new.amount_basis := 'tax_inclusive';
    new.amount_provenance := 'hosted_email_context_form_customer_charge';
  end if;

  return new;
end;
$$;

create trigger refund_request_recognition_hosted_charge_basis
before insert on private.refund_request_recognition_events
for each row execute function private.apply_hosted_customer_charge_event_basis();

revoke all on function private.refund_has_hosted_customer_charge_basis(
  text, text, jsonb, bigint, integer
) from public, anon, authenticated;
grant execute on function private.refund_has_hosted_customer_charge_basis(
  text, text, jsonb, bigint, integer
) to service_role;
revoke all on function private.apply_hosted_customer_charge_event_basis()
  from public, anon, authenticated, service_role;

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
    when 'legacy_percentage_of_gross_estimate'
      then 'legacy_percentage_of_gross_estimate'
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
        -- Preserve the established pre-cutover display: retain the recorded
        -- customer charge with no provisional deduction, while keeping the
        -- missing configured rate explicit so commission publication remains
        -- incomplete. This is not evidence of exemption or a proved 0% rate.
        tax_exclusive_amount_cents := p_amount_cents;
        tax_cents := 0;
        normalization_status := 'estimated';
        normalization_reason := 'configured_tax_rate_missing_no_deduction';
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

comment on function private.normalize_financial_amount_cents(bigint, text, numeric, bigint) is
  'Normalizes financial cents by explicit/source basis. Tax-inclusive amounts use the configured embedded-tax rate; a missing configured rate preserves the recorded amount with estimated status and no provisional deduction, not a proved 0% rate.';

create or replace function private.machine_sales_daily_components(
  p_reporting_machine_id uuid,
  p_date_from date,
  p_date_to date
)
returns table (
  reporting_machine_id uuid,
  reporting_location_id uuid,
  booking_date date,
  purchase_attribution_date date,
  tender text,
  source text,
  sales_transaction_count bigint,
  recorded_sales_cents bigint,
  sales_ex_tax_cents bigint,
  sales_tax_cents bigint,
  request_deduction_ex_tax_cents bigint,
  refund_reversal_ex_tax_cents bigint,
  legacy_paid_deduction_ex_tax_cents bigint,
  paid_context_ex_tax_cents bigint,
  outstanding_context_ex_tax_cents bigint,
  unresolved_sales_count bigint,
  unresolved_sales_cents bigint,
  unresolved_refund_count bigint,
  unresolved_refund_cents bigint,
  unresolved_paid_context_count bigint,
  unresolved_paid_context_cents bigint,
  commissionable_sales_ex_tax_cents bigint,
  normalization_status text
)
language plpgsql
stable
security definer
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
  with sales_scoped as materialized (
    select
      fact.reporting_machine_id,
      fact.reporting_location_id,
      fact.sale_date,
      case fact.payment_method
        when 'cash' then 'cash'
        when 'credit' then 'card'
        when 'other' then 'other'
        else 'unknown'
      end::text as tender,
      fact.source,
      fact.transaction_count::bigint as transaction_count,
      fact.net_sales_cents::bigint as amount_cents,
      fact.tax_cents::bigint as separate_tax_cents,
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
        -- Nayax publishes the settled customer charge. Until Finance supplies
        -- a narrower location/effective-date exception, use the configured
        -- machine rate to remove embedded tax. Explicit source metadata above
        -- continues to override this provisional source default.
        when fact.source in (
          'nayax_scheduled_report', 'card_authority_daily'
        ) and fact.payment_method = 'credit' then 'tax_inclusive'
        else 'unknown'
      end::text as amount_basis,
      tax_rate.tax_rate_percent
    from public.machine_sales_facts fact
    left join lateral (
      select rate.tax_rate_percent
      from public.reporting_machine_tax_rates rate
      where rate.machine_id = fact.reporting_machine_id
        and rate.status = 'active'
        and rate.effective_start_date <= fact.sale_date
        and coalesce(rate.effective_end_date, 'infinity'::date) >= fact.sale_date
      order by rate.effective_start_date desc, rate.created_at desc, rate.id
      limit 1
    ) tax_rate on true
    where fact.reporting_machine_id = p_reporting_machine_id
      and fact.sale_date between p_date_from and p_date_to
      and fact.net_sales_cents > 0
      -- SnapCase/Kex card observations are comparison evidence only. Nayax is
      -- the card-money publisher; existing Sunze card facts remain intentional
      -- legacy history at the ingestion boundary.
      and (fact.source <> 'snapcase_cash' or fact.payment_method = 'cash')
      and (fact.source <> 'nayax_scheduled_report' or fact.payment_method = 'credit')
  ), sales_grouped as materialized (
    select
      scoped.reporting_machine_id,
      scoped.reporting_location_id,
      scoped.sale_date,
      scoped.tender,
      scoped.source,
      scoped.amount_basis,
      scoped.tax_rate_percent,
      sum(scoped.transaction_count)::bigint as transaction_count,
      sum(scoped.amount_cents)::bigint as recorded_cents,
      sum(case when scoped.amount_basis = 'separate_tax'
        then scoped.separate_tax_cents else 0 end)::bigint as separate_tax_cents
    from sales_scoped scoped
    group by
      scoped.reporting_machine_id,
      scoped.reporting_location_id,
      scoped.sale_date,
      scoped.tender,
      scoped.source,
      scoped.amount_basis,
      scoped.tax_rate_percent
  ), sales_components as (
    select
      grouped.reporting_machine_id,
      grouped.reporting_location_id,
      grouped.sale_date as booking_date,
      grouped.sale_date as purchase_attribution_date,
      grouped.tender,
      grouped.source,
      grouped.transaction_count as sales_transaction_count,
      grouped.recorded_cents as recorded_sales_cents,
      normalized.tax_exclusive_amount_cents as sales_ex_tax_cents,
      normalized.tax_cents as sales_tax_cents,
      0::bigint as request_deduction_ex_tax_cents,
      0::bigint as refund_reversal_ex_tax_cents,
      0::bigint as legacy_paid_deduction_ex_tax_cents,
      0::bigint as paid_context_ex_tax_cents,
      0::bigint as outstanding_context_ex_tax_cents,
      case when normalized.tax_exclusive_amount_cents is null
        then grouped.transaction_count else 0 end::bigint as unresolved_sales_count,
      case when normalized.tax_exclusive_amount_cents is null
        then grouped.recorded_cents else 0 end::bigint as unresolved_sales_cents,
      0::bigint as unresolved_refund_count,
      0::bigint as unresolved_refund_cents,
      0::bigint as unresolved_paid_context_count,
      0::bigint as unresolved_paid_context_cents,
      normalized.tax_exclusive_amount_cents::bigint
        as commissionable_sales_ex_tax_cents,
      normalized.normalization_status
    from sales_grouped grouped
    cross join lateral private.normalize_financial_amount_cents(
      grouped.recorded_cents,
      grouped.amount_basis,
      grouped.tax_rate_percent,
      case when grouped.amount_basis = 'separate_tax'
        then grouped.separate_tax_cents else null end
    ) normalized
  ), active_recognition as materialized (
    select event.*,
      case
        when event.amount_basis <> 'unknown' then event.amount_basis
        when event.request_target_after_cents is null then 'unknown'
        when private.refund_has_hosted_customer_charge_basis(
          refund_case.customer_request_received_source,
          refund_case.intake_source,
          refund_case.intake_meta,
          event.request_target_after_cents,
          refund_case.payment_amount_cents
        ) then 'tax_inclusive'
        when refund_case.payment_method = 'cash'
          and (
            event.request_target_before_cents
              is not distinct from event.request_target_after_cents
            or event.event_kind in (
              'request_received', 'late_request_opening', 'cutover_opening',
              'scope_applied'
            )
          )
          and refund_case.status = 'completed'
          and refund_case.refund_completed_at is not null
          and refund_case.payment_amount_cents = event.request_target_after_cents
          and refund_case.refund_amount_cents = event.request_target_after_cents
          then 'tax_inclusive'
        when refund_case.payment_method = 'card'
          and (
            event.request_target_before_cents
              is not distinct from event.request_target_after_cents
            or event.event_kind in (
              'request_received', 'late_request_opening', 'cutover_opening',
              'scope_applied'
            )
          )
          and refund_case.correlation_source = 'nayax'
          and refund_case.matched_nayax_amount_cents = event.request_target_after_cents
          and refund_case.matched_nayax_currency_code = 'USD'
          and nullif(refund_case.matched_nayax_transaction_id, '') is not null
          then 'tax_inclusive'
        when receipt.id is not null
          and (
            event.request_target_before_cents
              is not distinct from event.request_target_after_cents
            or event.event_kind in (
              'request_received', 'late_request_opening', 'cutover_opening',
              'scope_applied'
            )
          ) then 'tax_inclusive'
        else 'unknown'
      end::text as effective_amount_basis,
      tax_rate.tax_rate_percent
    from private.refund_request_recognition_events event
    join private.refund_request_recognition_rollout rollout
      on rollout.singleton
     and event.recorded_at >= rollout.activated_at
    left join public.refund_cases refund_case
      on refund_case.id = event.refund_case_id
    left join public.refund_authoritative_receipts receipt
      on receipt.refund_case_id = event.refund_case_id
     and receipt.original_amount_cents = event.request_target_after_cents
     and receipt.refunded_amount_cents = event.request_target_after_cents
     and receipt.currency_code = 'USD'
    left join lateral (
      select rate.tax_rate_percent
      from public.reporting_machine_tax_rates rate
      where rate.machine_id = event.reporting_machine_id
        and rate.status = 'active'
        and rate.effective_start_date <= event.purchase_attribution_date
        and coalesce(rate.effective_end_date, 'infinity'::date)
          >= event.purchase_attribution_date
      order by rate.effective_start_date desc, rate.created_at desc, rate.id
      limit 1
    ) tax_rate on true
    where event.reporting_machine_id = p_reporting_machine_id
      and event.booking_date between p_date_from and p_date_to
  ), recognition_normalized as materialized (
    select
      event.*,
      before_amount.tax_exclusive_amount_cents as before_ex_tax_cents,
      after_amount.tax_exclusive_amount_cents as after_ex_tax_cents,
      paid_amount.tax_exclusive_amount_cents as paid_ex_tax_cents,
      before_amount.normalization_status as before_normalization_status,
      after_amount.normalization_status as after_normalization_status,
      paid_amount.normalization_status as paid_normalization_status
    from active_recognition event
    cross join lateral private.normalize_financial_amount_cents(
      event.recognized_target_before_cents,
      event.effective_amount_basis,
      event.tax_rate_percent,
      null
    ) before_amount
    cross join lateral private.normalize_financial_amount_cents(
      event.recognized_target_after_cents,
      event.effective_amount_basis,
      event.tax_rate_percent,
      null
    ) after_amount
    cross join lateral private.normalize_financial_amount_cents(
      event.paid_cumulative_cents,
      event.effective_amount_basis,
      event.tax_rate_percent,
      null
    ) paid_amount
  ), recognition_ranked as materialized (
    select normalized.*,
      row_number() over (
        partition by normalized.reporting_machine_id,
          normalized.reporting_location_id,
          normalized.booking_date,
          normalized.purchase_attribution_date,
          normalized.tender,
          normalized.source,
          normalized.refund_case_id
        order by normalized.recorded_at desc, normalized.id desc
      ) as latest_in_group
    from recognition_normalized normalized
  ), recognition_components as (
    select
      ranked.reporting_machine_id,
      ranked.reporting_location_id,
      ranked.booking_date,
      ranked.purchase_attribution_date,
      ranked.tender,
      'refund_request'::text as source,
      0::bigint as sales_transaction_count,
      0::bigint as recorded_sales_cents,
      0::bigint as sales_ex_tax_cents,
      0::bigint as sales_tax_cents,
      case when bool_or(
        ranked.before_ex_tax_cents is null
          or ranked.after_ex_tax_cents is null
      ) then null else coalesce(sum(greatest(
        ranked.after_ex_tax_cents - ranked.before_ex_tax_cents,
        0
      )), 0)::bigint end as request_deduction_ex_tax_cents,
      case when bool_or(
        ranked.before_ex_tax_cents is null
          or ranked.after_ex_tax_cents is null
      ) then null else coalesce(sum(greatest(
        ranked.before_ex_tax_cents - ranked.after_ex_tax_cents,
        0
      )), 0)::bigint end as refund_reversal_ex_tax_cents,
      0::bigint as legacy_paid_deduction_ex_tax_cents,
      0::bigint as paid_context_ex_tax_cents,
      coalesce(sum(case when ranked.latest_in_group = 1
        then greatest(ranked.after_ex_tax_cents - ranked.paid_ex_tax_cents, 0)
        else null end), 0)::bigint as outstanding_context_ex_tax_cents,
      0::bigint as unresolved_sales_count,
      0::bigint as unresolved_sales_cents,
      count(*) filter (
        where ranked.before_ex_tax_cents is null
          or ranked.after_ex_tax_cents is null
      )::bigint as unresolved_refund_count,
      coalesce(sum(case
        when ranked.before_ex_tax_cents is null
          or ranked.after_ex_tax_cents is null
        then abs(coalesce(
          ranked.recognized_target_after_cents
            - ranked.recognized_target_before_cents,
          ranked.request_target_after_cents,
          ranked.request_target_before_cents,
          0
        ))
        else 0
      end), 0)::bigint as unresolved_refund_cents,
      0::bigint as unresolved_paid_context_count,
      0::bigint as unresolved_paid_context_cents,
      case when bool_or(
        ranked.before_ex_tax_cents is null
          or ranked.after_ex_tax_cents is null
      ) then null else coalesce(sum(
        ranked.before_ex_tax_cents - ranked.after_ex_tax_cents
      ), 0)::bigint end as commissionable_sales_ex_tax_cents,
      case
        when bool_or(
          ranked.before_ex_tax_cents is null
          or ranked.after_ex_tax_cents is null
        ) then 'unresolved'
        when bool_or(
          ranked.before_normalization_status = 'estimated'
          or ranked.after_normalization_status = 'estimated'
        ) then 'estimated'
        else 'proved'
      end::text as normalization_status
    from recognition_ranked ranked
    group by
      ranked.reporting_machine_id,
      ranked.reporting_location_id,
      ranked.booking_date,
      ranked.purchase_attribution_date,
      ranked.tender
  ), paid_components as (
    select
      adjustment.reporting_machine_id,
      adjustment.reporting_location_id,
      adjustment.adjustment_date as booking_date,
      coalesce(
        event.purchase_attribution_date,
        matched_fact.sale_date,
        case when linked_location.timezone is not null
          then (linked_case.incident_at at time zone linked_location.timezone)::date end
      )
        as purchase_attribution_date,
      case
        when adjustment.source = 'nayax_provider_refund' then 'card'
        when event.tender is not null then event.tender
        when linked_case.payment_method in ('cash', 'card')
          then linked_case.payment_method
        when lower(coalesce(adjustment.raw_payload ->> 'payment_method', ''))
          in ('card', 'credit') then 'card'
        when lower(coalesce(adjustment.raw_payload ->> 'payment_method', '')) = 'cash'
          then 'cash'
        when lower(coalesce(adjustment.raw_payload ->> 'payment_method', '')) = 'other'
          then 'other'
        else 'unknown'
      end::text as tender,
      adjustment.source,
      0::bigint as sales_transaction_count,
      0::bigint as recorded_sales_cents,
      0::bigint as sales_ex_tax_cents,
      0::bigint as sales_tax_cents,
      0::bigint as request_deduction_ex_tax_cents,
      0::bigint as refund_reversal_ex_tax_cents,
      case when adjustment.created_at < rollout.activated_at
        then normalized.tax_exclusive_amount_cents else 0 end::bigint
        as legacy_paid_deduction_ex_tax_cents,
      coalesce(normalized.tax_exclusive_amount_cents, 0)::bigint
        as paid_context_ex_tax_cents,
      0::bigint as outstanding_context_ex_tax_cents,
      0::bigint as unresolved_sales_count,
      0::bigint as unresolved_sales_cents,
      case when adjustment.created_at < rollout.activated_at
          and normalized.tax_exclusive_amount_cents is null
        then 1 else 0 end::bigint as unresolved_refund_count,
      case when adjustment.created_at < rollout.activated_at
          and normalized.tax_exclusive_amount_cents is null
        then adjustment.amount_cents else 0 end::bigint as unresolved_refund_cents,
      case when adjustment.created_at >= rollout.activated_at
          and normalized.tax_exclusive_amount_cents is null
        then 1 else 0 end::bigint as unresolved_paid_context_count,
      case when adjustment.created_at >= rollout.activated_at
          and normalized.tax_exclusive_amount_cents is null
        then adjustment.amount_cents else 0 end::bigint
        as unresolved_paid_context_cents,
      case when adjustment.created_at < rollout.activated_at
        then -normalized.tax_exclusive_amount_cents else 0 end::bigint
        as commissionable_sales_ex_tax_cents,
      case
        when adjustment.created_at < rollout.activated_at
          and normalized.tax_exclusive_amount_cents is null then 'unresolved'
        when adjustment.created_at >= rollout.activated_at
          and normalized.tax_exclusive_amount_cents is null then 'context_unresolved'
        else normalized.normalization_status end::text
        as normalization_status
    from public.sales_adjustment_facts adjustment
    join private.refund_request_recognition_rollout rollout
      on rollout.singleton
    left join lateral (
      select recognition.*
      from private.refund_request_recognition_events recognition
      where recognition.refund_case_id = adjustment.refund_case_id
        and recognition.recorded_at <= adjustment.created_at
      order by recognition.recorded_at desc, recognition.id desc
      limit 1
    ) event on true
    left join lateral (
      select refund_case.*
      from public.refund_cases refund_case
      where refund_case.id = adjustment.refund_case_id
        or refund_case.reporting_adjustment_id = adjustment.id
      order by (refund_case.id = adjustment.refund_case_id) desc,
        refund_case.created_at,
        refund_case.id
      limit 1
    ) linked_case on true
    left join public.machine_sales_facts matched_fact
      on matched_fact.id = linked_case.matched_sales_fact_id
    left join public.reporting_locations linked_location
      on linked_location.id = linked_case.reporting_location_id
    cross join lateral (
      select case
        when event.amount_basis is not null and event.amount_basis <> 'unknown'
          then event.amount_basis
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
        when private.refund_has_hosted_customer_charge_basis(
          linked_case.customer_request_received_source,
          linked_case.intake_source,
          linked_case.intake_meta,
          adjustment.amount_cents::bigint,
          linked_case.payment_amount_cents
        )
          and adjustment.amount_cents = linked_case.refund_amount_cents
          then 'tax_inclusive'
        when linked_case.payment_method = 'cash'
          and linked_case.status = 'completed'
          and linked_case.refund_completed_at is not null
          and adjustment.amount_cents = linked_case.payment_amount_cents
          and adjustment.amount_cents = linked_case.refund_amount_cents
          then 'tax_inclusive'
        when linked_case.payment_method = 'card'
          and linked_case.correlation_source = 'nayax'
          and adjustment.amount_cents = linked_case.matched_nayax_amount_cents
          and linked_case.matched_nayax_currency_code = 'USD'
          and nullif(linked_case.matched_nayax_transaction_id, '') is not null
          then 'tax_inclusive'
        else 'unknown'
      end::text as amount_basis
    ) paid_basis
    left join lateral (
      select rate.tax_rate_percent
      from public.reporting_machine_tax_rates rate
      where rate.machine_id = adjustment.reporting_machine_id
        and rate.status = 'active'
        and rate.effective_start_date <= coalesce(
          event.purchase_attribution_date,
          matched_fact.sale_date,
          case when linked_location.timezone is not null
            then (linked_case.incident_at at time zone linked_location.timezone)::date end
        )
        and coalesce(rate.effective_end_date, 'infinity'::date) >= coalesce(
          event.purchase_attribution_date,
          matched_fact.sale_date,
          case when linked_location.timezone is not null
            then (linked_case.incident_at at time zone linked_location.timezone)::date end
        )
      order by rate.effective_start_date desc, rate.created_at desc, rate.id
      limit 1
    ) tax_rate on true
    cross join lateral private.normalize_financial_amount_cents(
      adjustment.amount_cents,
      paid_basis.amount_basis,
      tax_rate.tax_rate_percent,
      null
    ) normalized
    where adjustment.reporting_machine_id = p_reporting_machine_id
      and adjustment.adjustment_date between p_date_from and p_date_to
      and adjustment.adjustment_type in ('refund', 'complaint_refund')
      and adjustment.amount_cents > 0
  ), all_components as (
    select * from sales_components
    union all
    select * from recognition_components
    union all
    select * from paid_components
  )
  select
    component.reporting_machine_id,
    component.reporting_location_id,
    component.booking_date,
    component.purchase_attribution_date,
    component.tender,
    component.source,
    sum(component.sales_transaction_count)::bigint,
    sum(component.recorded_sales_cents)::bigint,
    case when bool_or(component.unresolved_sales_count > 0) then null
      else sum(component.sales_ex_tax_cents)::bigint end,
    case when bool_or(component.unresolved_sales_count > 0) then null
      else sum(component.sales_tax_cents)::bigint end,
    case when bool_or(component.unresolved_refund_count > 0) then null
      else sum(component.request_deduction_ex_tax_cents)::bigint end,
    case when bool_or(component.unresolved_refund_count > 0) then null
      else sum(component.refund_reversal_ex_tax_cents)::bigint end,
    case when bool_or(component.unresolved_refund_count > 0) then null
      else sum(component.legacy_paid_deduction_ex_tax_cents)::bigint end,
    sum(component.paid_context_ex_tax_cents)::bigint,
    max(component.outstanding_context_ex_tax_cents)::bigint,
    sum(component.unresolved_sales_count)::bigint,
    sum(component.unresolved_sales_cents)::bigint,
    sum(component.unresolved_refund_count)::bigint,
    sum(component.unresolved_refund_cents)::bigint,
    sum(component.unresolved_paid_context_count)::bigint,
    sum(component.unresolved_paid_context_cents)::bigint,
    case when bool_or(
      component.unresolved_sales_count > 0
        or component.unresolved_refund_count > 0
    ) then null else sum(component.commissionable_sales_ex_tax_cents)::bigint end,
    case
      when bool_or(component.normalization_status = 'unresolved') then 'unresolved'
      when bool_or(component.normalization_status = 'estimated') then 'estimated'
      when bool_or(component.normalization_status = 'context_unresolved')
        then 'context_unresolved'
      else 'proved'
    end::text
  from all_components component
  group by
    component.reporting_machine_id,
    component.reporting_location_id,
    component.booking_date,
    component.purchase_attribution_date,
    component.tender,
    component.source
  order by
    component.booking_date,
    component.purchase_attribution_date,
    component.tender,
    component.source;
end;
$$;

revoke all on function private.machine_sales_daily_components(uuid, date, date)
  from public, anon, authenticated;
grant execute on function private.machine_sales_daily_components(uuid, date, date)
  to service_role;

comment on function private.machine_sales_daily_components(uuid, date, date) is
  'Private daily sales and dated refund-recognition components. booking_date controls period recognition; purchase_attribution_date preserves original tax, assignment, and partner scope and is null when no purchase evidence exists. Paid context never changes commissionable sales. Explicit source basis metadata wins; Nayax card customer charges provisionally use the configured embedded-tax rate, Sunze remains tax-exclusive, missing configured rates retain numeric display with estimated status and no provisional deduction, and unknown sources remain unavailable.';

alter function private.operator_machine_tax_snapshot_shared(uuid, date, date)
  rename to operator_machine_tax_snapshot_shared_before_provisional_nayax_basis;

create function private.operator_machine_tax_snapshot_shared(
  p_reporting_machine_id uuid,
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
  calculation jsonb;
  configured_rate_missing boolean;
begin
  calculation := private.operator_machine_tax_snapshot_shared_before_provisional_nayax_basis(
    p_reporting_machine_id,
    p_period_start_date,
    p_period_end_date
  );

  select coalesce(bool_or(
    component.recorded_sales_cents > 0
      and component.normalization_status = 'estimated'
      and not exists (
        select 1
        from public.reporting_machine_tax_rates tax_rate
        where tax_rate.machine_id = component.reporting_machine_id
          and tax_rate.status = 'active'
          and tax_rate.effective_start_date <= component.purchase_attribution_date
          and coalesce(tax_rate.effective_end_date, 'infinity'::date)
            >= component.purchase_attribution_date
      )
  ), false)
  into configured_rate_missing
  from private.machine_sales_daily_components(
    p_reporting_machine_id,
    p_period_start_date,
    p_period_end_date
  ) component;

  if configured_rate_missing then
    calculation := jsonb_set(
      calculation,
      '{taxRateCompleteForSales}',
      'false'::jsonb,
      true
    );
  end if;

  return calculation;
end;
$$;

alter function private.operator_machine_tax_commission_shared(
  uuid, uuid, uuid, date, date
)
  rename to operator_machine_tax_commission_shared_before_provisional_nayax_basis;

create function private.operator_machine_tax_commission_shared(
  p_account_id uuid,
  p_operator_profile_id uuid,
  p_reporting_machine_id uuid,
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
  calculation jsonb;
  configured_rate_missing boolean;
  zeroed_segments jsonb;
begin
  calculation := private.operator_machine_tax_commission_shared_before_provisional_nayax_basis(
    p_account_id,
    p_operator_profile_id,
    p_reporting_machine_id,
    p_period_start_date,
    p_period_end_date
  );

  select coalesce(bool_or(
    component.recorded_sales_cents > 0
      and component.normalization_status = 'estimated'
      and not exists (
        select 1
        from public.reporting_machine_tax_rates tax_rate
        where tax_rate.machine_id = component.reporting_machine_id
          and tax_rate.status = 'active'
          and tax_rate.effective_start_date <= component.purchase_attribution_date
          and coalesce(tax_rate.effective_end_date, 'infinity'::date)
            >= component.purchase_attribution_date
      )
  ), false)
  into configured_rate_missing
  from private.machine_sales_daily_components(
    p_reporting_machine_id,
    p_period_start_date,
    p_period_end_date
  ) component
  where component.purchase_attribution_date is null
    or exists (
      select 1
      from public.operator_machine_assignments assignment
      where assignment.account_id = p_account_id
        and assignment.operator_profile_id = p_operator_profile_id
        and assignment.reporting_machine_id = p_reporting_machine_id
        and component.purchase_attribution_date between assignment.effective_start_date
          and coalesce(assignment.effective_end_date, 'infinity'::date)
    );

  if configured_rate_missing then
    select coalesce(jsonb_agg(jsonb_set(
      segment.value,
      '{commissionEarningsCents}',
      to_jsonb(0),
      true
    ) order by segment.ordinality), '[]'::jsonb)
    into zeroed_segments
    from jsonb_array_elements(coalesce(calculation -> 'segments', '[]'::jsonb))
      with ordinality as segment(value, ordinality);

    calculation := jsonb_set(
      jsonb_set(
        jsonb_set(
          calculation,
          '{taxRateCompleteForSales}',
          'false'::jsonb,
          true
        ),
        '{commissionEarningsCents}',
        to_jsonb(0),
        true
      ),
      '{segments}',
      zeroed_segments,
      true
    );
  end if;

  return calculation;
end;
$$;

revoke all on function private.operator_machine_tax_snapshot_shared(uuid, date, date)
  from public, anon, authenticated;
grant execute on function private.operator_machine_tax_snapshot_shared(uuid, date, date)
  to service_role;
revoke all on function private.operator_machine_tax_commission_shared(
  uuid, uuid, uuid, date, date
) from public, anon, authenticated;
grant execute on function private.operator_machine_tax_commission_shared(
  uuid, uuid, uuid, date, date
) to service_role;

comment on function private.operator_machine_tax_snapshot_shared(uuid, date, date) is
  'Shared sales snapshot that preserves numeric pre-cutover display for missing configured tax rates while retaining taxRateCompleteForSales=false.';
comment on function private.operator_machine_tax_commission_shared(
  uuid, uuid, uuid, date, date
) is
  'Shared commission calculation that preserves numeric pre-cutover display for missing configured tax rates while retaining incomplete-tax publication behavior and zero commission earnings.';

-- Numeric compatibility for missing configured rates must not remove the
-- existing partner settlement blocker. Keep the public contract and warning
-- type unchanged while checking the same positive-sales condition directly.
alter function public.admin_preview_partner_period_report_internal(uuid, date, date, text)
  rename to admin_preview_partner_period_report_internal_before_provisional_nayax_basis;

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
  result jsonb;
  configured_rate_missing boolean;
  actor_user_id uuid;
  actor_is_super_admin boolean;
  actor_machine_ids uuid[];
begin
  result := public.admin_preview_partner_period_report_internal_before_provisional_nayax_basis(
    p_partnership_id,
    p_date_from,
    p_date_to,
    p_period_grain
  );

  actor_user_id := auth.uid();
  actor_is_super_admin := public.is_super_admin(actor_user_id);
  actor_machine_ids := public.scoped_admin_machine_ids(actor_user_id);

  select exists (
    select 1
    from public.reporting_partnerships partnership
    join public.reporting_machine_partnership_assignments assignment
      on assignment.partnership_id = partnership.id
     and assignment.assignment_role = 'primary_reporting'
     and assignment.status = 'active'
    cross join lateral private.machine_sales_daily_components(
      assignment.machine_id,
      p_date_from,
      p_date_to
    ) component
    where partnership.id = p_partnership_id
      and partnership.status = 'active'
      and component.recorded_sales_cents > 0
      and component.normalization_status = 'estimated'
      and component.purchase_attribution_date between assignment.effective_start_date
        and coalesce(assignment.effective_end_date, 'infinity'::date)
      and component.purchase_attribution_date between partnership.effective_start_date
        and coalesce(partnership.effective_end_date, 'infinity'::date)
      and (actor_is_super_admin
        or component.reporting_machine_id = any(actor_machine_ids))
      and exists (
        select 1
        from jsonb_array_elements(coalesce(result -> 'machine_periods', '[]'::jsonb)) period(value)
        where period.value ->> 'reporting_machine_id'
            = component.reporting_machine_id::text
          and component.booking_date between
            (period.value ->> 'period_start')::date
            and (period.value ->> 'period_end')::date
      )
      and not exists (
        select 1
        from public.reporting_machine_tax_rates tax_rate
        where tax_rate.machine_id = component.reporting_machine_id
          and tax_rate.status = 'active'
          and tax_rate.effective_start_date <= component.purchase_attribution_date
          and coalesce(tax_rate.effective_end_date, 'infinity'::date)
            >= component.purchase_attribution_date
      )
  ) into configured_rate_missing;

  if configured_rate_missing
    and not exists (
      select 1
      from jsonb_array_elements(coalesce(result -> 'warnings', '[]'::jsonb)) warning(value)
      where warning.value ->> 'warning_type' = 'missing_machine_tax_rate'
    )
  then
    result := jsonb_set(
      result,
      '{warnings}',
      coalesce(result -> 'warnings', '[]'::jsonb) || jsonb_build_array(
        jsonb_build_object(
          'warning_type', 'missing_machine_tax_rate',
          'severity', 'blocking',
          'message', 'Complete the existing sales tax basis before sharing settlement totals.'
        )
      ),
      true
    );
  end if;

  return result;
end;
$$;

revoke execute on function public.admin_preview_partner_period_report_internal_before_provisional_nayax_basis(
  uuid, date, date, text
) from public, anon, authenticated;
grant execute on function public.admin_preview_partner_period_report_internal_before_provisional_nayax_basis(
  uuid, date, date, text
) to service_role;
revoke execute on function public.admin_preview_partner_period_report_internal(uuid, date, date, text)
  from public, anon, authenticated;
grant execute on function public.admin_preview_partner_period_report_internal(uuid, date, date, text)
  to service_role;

select pg_notify('pgrst', 'reload schema');
