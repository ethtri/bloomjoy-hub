-- Restore previously verified reporting functions after live annual performance regression.
CREATE OR REPLACE FUNCTION private.machine_sales_daily_components(p_reporting_machine_id uuid, p_date_from date, p_date_to date)
 RETURNS TABLE(reporting_machine_id uuid, reporting_location_id uuid, booking_date date, purchase_attribution_date date, tender text, source text, sales_transaction_count bigint, recorded_sales_cents bigint, sales_ex_tax_cents bigint, sales_tax_cents bigint, request_deduction_ex_tax_cents bigint, refund_reversal_ex_tax_cents bigint, legacy_paid_deduction_ex_tax_cents bigint, paid_context_ex_tax_cents bigint, outstanding_context_ex_tax_cents bigint, unresolved_sales_count bigint, unresolved_sales_cents bigint, unresolved_refund_count bigint, unresolved_refund_cents bigint, unresolved_paid_context_count bigint, unresolved_paid_context_cents bigint, commissionable_sales_ex_tax_cents bigint, normalization_status text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
      case when fact.source='nayax_scheduled_report' and exists(select 1 from private.machine_nayax_reader_associations history
          where history.reporting_machine_id=fact.reporting_machine_id) then nullif(btrim(fact.raw_payload->>'providerMachineId'),'')
        when fact.source='card_authority_daily' and exists(select 1 from private.machine_nayax_reader_associations history
          where history.reporting_machine_id=fact.reporting_machine_id) then (
          select case when count(distinct nullif(btrim(original.raw_payload->>'providerMachineId'),''))=1
            and count(*)=count(nullif(btrim(original.raw_payload->>'providerMachineId'),''))
            then min(original.raw_payload->>'providerMachineId') end
          from public.machine_sales_facts original
          cross join lateral private.reporting_retained_original_money(original) retained
          where original.reporting_machine_id=fact.reporting_machine_id and original.sale_date=fact.sale_date
            and original.source='nayax_scheduled_report' and original.payment_method='credit'
            and retained.original_amount_cents>0
        ) end as original_reader_id,
      fact.transaction_count::bigint as transaction_count,
      fact.net_sales_cents::bigint as amount_cents,
      fact.tax_cents::bigint as separate_tax_cents,
      case
        when fact.payment_method='cash' then 'tax_exclusive'
        when (fact.tax_cents>0 or lower(coalesce(fact.raw_payload->>'taxBasis','')) in ('separate_tax','separately_imported_tax'))
          and fact.payment_method='credit'
          and lower(coalesce(fact.raw_payload->>'amountBasis','')) not in ('tax_exclusive','tax_exclusive_minor')
          and (fact.source<>'sunze_browser' or lower(coalesce(fact.raw_payload->>'amountBasis',fact.raw_payload->>'taxBasis',''))
            in ('tax_inclusive','gross_customer_charge_minor','separate_tax','separately_imported_tax')) then 'separate_tax'
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
    from private.financial_machine_sales_facts fact
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
    left join lateral (
      select configured.amount_basis
      from public.reporting_machine_tax_treatments configured
      where configured.machine_id = fact.reporting_machine_id
        and configured.tender = case fact.payment_method
          when 'credit' then 'card' when 'cash' then 'cash' else 'unknown' end
        and configured.effective_start_date <= fact.sale_date
        and coalesce(configured.effective_end_date, 'infinity'::date) >= fact.sale_date
      order by configured.effective_start_date desc limit 1
    ) treatment on true
    where fact.reporting_machine_id = p_reporting_machine_id
      and fact.sale_date between p_date_from and p_date_to
      and fact.net_sales_cents > 0
      and not (fact.source = 'sunze_browser' and fact.payment_method = 'other'
        and lower(btrim(coalesce(fact.raw_payload ->> 'payment_method_source', '')))
          in ('free', 'no-pay', 'no pay'))
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
      scoped.original_reader_id,
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
      scoped.original_reader_id,
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
    cross join lateral private.normalize_original_reader_amount_cents(
      grouped.reporting_machine_id, grouped.tender, grouped.sale_date,
      grouped.recorded_cents,
      grouped.amount_basis,
      grouped.tax_rate_percent,
      case when grouped.amount_basis = 'separate_tax'
        then grouped.separate_tax_cents else null end,
      true,grouped.source,grouped.original_reader_id
    ) normalized
  ), active_recognition as materialized (
    select event.*,
      case
        when event.amount_basis <> 'unknown' then event.amount_basis
        when private.refund_original_source_tax_cents(event.refund_case_id,event.request_target_after_cents) is not null then 'tax_inclusive'
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
      gift_card_amount.tax_exclusive_amount_cents as gift_card_resolved_ex_tax_cents,
      before_amount.normalization_status as before_normalization_status,
      after_amount.normalization_status as after_normalization_status,
      paid_amount.normalization_status as paid_normalization_status
    from active_recognition event
    cross join lateral private.normalize_refund_original_reader_amount_cents(
      event.reporting_machine_id, event.tender, event.purchase_attribution_date,
      event.recognized_target_before_cents,
      event.effective_amount_basis,
      event.tax_rate_percent,
      private.refund_original_source_tax_cents(event.refund_case_id,event.recognized_target_before_cents), true
    ) before_amount
    cross join lateral private.normalize_refund_original_reader_amount_cents(
      event.reporting_machine_id, event.tender, event.purchase_attribution_date,
      event.recognized_target_after_cents,
      event.effective_amount_basis,
      event.tax_rate_percent,
      private.refund_original_source_tax_cents(event.refund_case_id,event.recognized_target_after_cents), true
    ) after_amount
    cross join lateral private.normalize_refund_original_reader_amount_cents(
      event.reporting_machine_id, event.tender, event.purchase_attribution_date,
      event.paid_cumulative_cents,
      event.effective_amount_basis,
      event.tax_rate_percent,
      private.refund_original_source_tax_cents(event.refund_case_id,event.paid_cumulative_cents), true
    ) paid_amount
    cross join lateral private.normalize_refund_original_reader_amount_cents(
      event.reporting_machine_id, event.tender, event.purchase_attribution_date,
      private.refund_gift_card_resolved_purchase_cents(event.refund_case_id, p_date_to),
      event.effective_amount_basis,
      event.tax_rate_percent,
      private.refund_original_source_tax_cents(event.refund_case_id,private.refund_gift_card_resolved_purchase_cents(event.refund_case_id,p_date_to)), true
    ) gift_card_amount
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
        then greatest(ranked.after_ex_tax_cents - ranked.paid_ex_tax_cents
          - coalesce(ranked.gift_card_resolved_ex_tax_cents, 0), 0)
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
          then (linked_case.incident_at at time zone linked_location.timezone)::date end,
          provider_original.sale_date
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
    left join lateral (
      select private.provider_refund_original_sale_date(adjustment.id) as sale_date
      where adjustment.source = 'nayax_provider_refund'
    ) provider_original on true
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
        when private.refund_original_source_tax_cents(linked_case.id,adjustment.amount_cents) is not null then 'tax_inclusive'
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
            then (linked_case.incident_at at time zone linked_location.timezone)::date end,
          provider_original.sale_date
        )
        and coalesce(rate.effective_end_date, 'infinity'::date) >= coalesce(
          event.purchase_attribution_date,
          matched_fact.sale_date,
          case when linked_location.timezone is not null
            then (linked_case.incident_at at time zone linked_location.timezone)::date end,
          provider_original.sale_date
        )
      order by rate.effective_start_date desc, rate.created_at desc, rate.id
      limit 1
    ) tax_rate on true
    cross join lateral private.normalize_refund_original_reader_amount_cents(
      adjustment.reporting_machine_id,
      case when adjustment.source = 'nayax_provider_refund' then 'card'
        when event.tender is not null then event.tender
        when linked_case.payment_method in ('cash', 'card') then linked_case.payment_method
        when lower(coalesce(adjustment.raw_payload ->> 'payment_method', '')) in ('card', 'credit') then 'card'
        when lower(coalesce(adjustment.raw_payload ->> 'payment_method', '')) = 'cash' then 'cash'
        else 'unknown' end,
      coalesce(event.purchase_attribution_date, matched_fact.sale_date,
        case when linked_location.timezone is not null
          then (linked_case.incident_at at time zone linked_location.timezone)::date end,
          provider_original.sale_date),
      adjustment.amount_cents,
      paid_basis.amount_basis,
      tax_rate.tax_rate_percent,
      case when adjustment.source='nayax_provider_refund' then private.provider_refund_original_source_tax_cents(adjustment.id,adjustment.amount_cents) else private.refund_original_source_tax_cents(linked_case.id,adjustment.amount_cents) end, true
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
      when bool_or(component.unresolved_sales_count>0 or component.unresolved_refund_count>0) then 'unresolved'
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
$function$;

CREATE OR REPLACE FUNCTION private.machine_sales_daily_receipt_components(p_reporting_machine_id uuid, p_date_from date, p_date_to date)
 RETURNS TABLE(reporting_machine_id uuid, reporting_location_id uuid, receipt_component_count bigint, receipt_known_cents bigint, receipt_unknown_count bigint, sales_known_cents bigint, sales_unknown_count bigint, net_known_cents bigint, net_unknown_count bigint, refund_known_cents bigint, refund_unknown_count bigint, gross_sales_cents bigint, gross_deduction_cents bigint, gross_paid_cents bigint, booking_date date, purchase_attribution_date date, tender text, source text, sales_transaction_count bigint, recorded_sales_cents bigint, sales_ex_tax_cents bigint, sales_tax_cents bigint, request_deduction_ex_tax_cents bigint, refund_reversal_ex_tax_cents bigint, legacy_paid_deduction_ex_tax_cents bigint, paid_context_ex_tax_cents bigint, outstanding_context_ex_tax_cents bigint, unresolved_sales_count bigint, unresolved_sales_cents bigint, unresolved_refund_count bigint, unresolved_refund_cents bigint, unresolved_paid_context_count bigint, unresolved_paid_context_cents bigint, commissionable_sales_ex_tax_cents bigint, normalization_status text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
      case when fact.source='nayax_scheduled_report' and exists(select 1 from private.machine_nayax_reader_associations history
          where history.reporting_machine_id=fact.reporting_machine_id) then nullif(btrim(fact.raw_payload->>'providerMachineId'),'')
        when fact.source='card_authority_daily' and exists(select 1 from private.machine_nayax_reader_associations history
          where history.reporting_machine_id=fact.reporting_machine_id) then (
          select case when count(distinct nullif(btrim(original.raw_payload->>'providerMachineId'),''))=1
            and count(*)=count(nullif(btrim(original.raw_payload->>'providerMachineId'),''))
            then min(original.raw_payload->>'providerMachineId') end
          from public.machine_sales_facts original
          cross join lateral private.reporting_retained_original_money(original) retained
          where original.reporting_machine_id=fact.reporting_machine_id and original.sale_date=fact.sale_date
            and original.source='nayax_scheduled_report' and original.payment_method='credit'
            and retained.original_amount_cents>0
        ) end as original_reader_id,
      fact.transaction_count::bigint as transaction_count,
      fact.net_sales_cents::bigint as amount_cents,
      fact.tax_cents::bigint as separate_tax_cents,
      case
        when fact.payment_method='cash' then 'tax_exclusive'
        when (fact.tax_cents>0 or lower(coalesce(fact.raw_payload->>'taxBasis','')) in ('separate_tax','separately_imported_tax'))
          and fact.payment_method='credit'
          and lower(coalesce(fact.raw_payload->>'amountBasis','')) not in ('tax_exclusive','tax_exclusive_minor')
          and (fact.source<>'sunze_browser' or lower(coalesce(fact.raw_payload->>'amountBasis',fact.raw_payload->>'taxBasis',''))
            in ('tax_inclusive','gross_customer_charge_minor','separate_tax','separately_imported_tax')) then 'separate_tax'
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
    from private.financial_machine_sales_facts fact
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
    left join lateral (
      select configured.amount_basis
      from public.reporting_machine_tax_treatments configured
      where configured.machine_id = fact.reporting_machine_id
        and configured.tender = case fact.payment_method
          when 'credit' then 'card' when 'cash' then 'cash' else 'unknown' end
        and configured.effective_start_date <= fact.sale_date
        and coalesce(configured.effective_end_date, 'infinity'::date) >= fact.sale_date
      order by configured.effective_start_date desc limit 1
    ) treatment on true
    where fact.reporting_machine_id = p_reporting_machine_id
      and fact.sale_date between p_date_from and p_date_to
      and fact.net_sales_cents > 0
      and not (fact.source = 'sunze_browser' and fact.payment_method = 'other'
        and lower(btrim(coalesce(fact.raw_payload ->> 'payment_method_source', '')))
          in ('free', 'no-pay', 'no pay'))
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
      scoped.original_reader_id,
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
      scoped.original_reader_id,
      scoped.amount_basis,
      scoped.tax_rate_percent
  ), sales_components as (
    select
      grouped.reporting_machine_id,
      grouped.reporting_location_id,
      1::bigint as receipt_component_count,
      case when grouped.tender='cash' or grouped.amount_basis in ('tax_inclusive','separate_tax')
        then grouped.recorded_cents else null end::bigint as gross_sales_cents,
      0::bigint as gross_deduction_cents, 0::bigint as gross_paid_cents,
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
    cross join lateral private.normalize_original_reader_amount_cents(
      grouped.reporting_machine_id, grouped.tender, grouped.sale_date,
      grouped.recorded_cents,
      grouped.amount_basis,
      grouped.tax_rate_percent,
      case when grouped.amount_basis = 'separate_tax'
        then grouped.separate_tax_cents else null end,
      true,grouped.source,grouped.original_reader_id
    ) normalized
  ), active_recognition as materialized (
    select event.*,
      case
        when event.amount_basis <> 'unknown' then event.amount_basis
        when private.refund_original_source_tax_cents(event.refund_case_id,event.request_target_after_cents) is not null then 'tax_inclusive'
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
      gift_card_amount.tax_exclusive_amount_cents as gift_card_resolved_ex_tax_cents,
      before_amount.normalization_status as before_normalization_status,
      after_amount.normalization_status as after_normalization_status,
      paid_amount.normalization_status as paid_normalization_status
    from active_recognition event
    cross join lateral private.normalize_refund_original_reader_amount_cents(
      event.reporting_machine_id, event.tender, event.purchase_attribution_date,
      event.recognized_target_before_cents,
      event.effective_amount_basis,
      event.tax_rate_percent,
      private.refund_original_source_tax_cents(event.refund_case_id,event.recognized_target_before_cents), true
    ) before_amount
    cross join lateral private.normalize_refund_original_reader_amount_cents(
      event.reporting_machine_id, event.tender, event.purchase_attribution_date,
      event.recognized_target_after_cents,
      event.effective_amount_basis,
      event.tax_rate_percent,
      private.refund_original_source_tax_cents(event.refund_case_id,event.recognized_target_after_cents), true
    ) after_amount
    cross join lateral private.normalize_refund_original_reader_amount_cents(
      event.reporting_machine_id, event.tender, event.purchase_attribution_date,
      event.paid_cumulative_cents,
      event.effective_amount_basis,
      event.tax_rate_percent,
      private.refund_original_source_tax_cents(event.refund_case_id,event.paid_cumulative_cents), true
    ) paid_amount
    cross join lateral private.normalize_refund_original_reader_amount_cents(
      event.reporting_machine_id, event.tender, event.purchase_attribution_date,
      private.refund_gift_card_resolved_purchase_cents(event.refund_case_id, p_date_to),
      event.effective_amount_basis,
      event.tax_rate_percent,
      private.refund_original_source_tax_cents(event.refund_case_id,private.refund_gift_card_resolved_purchase_cents(event.refund_case_id,p_date_to)), true
    ) gift_card_amount
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
      0::bigint as receipt_component_count,
      0::bigint as gross_sales_cents,
      case when bool_or(ranked.tender<>'cash' and ranked.effective_amount_basis not in ('tax_inclusive','separate_tax'))
        or bool_or(ranked.recognized_target_after_cents is null or ranked.recognized_target_before_cents is null)
        then null else sum(ranked.recognized_target_after_cents-ranked.recognized_target_before_cents)::bigint end as gross_deduction_cents,
      0::bigint as gross_paid_cents,
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
        then greatest(ranked.after_ex_tax_cents - ranked.paid_ex_tax_cents
          - coalesce(ranked.gift_card_resolved_ex_tax_cents, 0), 0)
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
      0::bigint as receipt_component_count,
      0::bigint as gross_sales_cents,
      case when adjustment.created_at>=rollout.activated_at then 0
        when paid_basis.amount_basis in ('tax_inclusive','separate_tax') or normalized.normalization_reason='cash_not_taxed'
        then adjustment.amount_cents else null end::bigint as gross_deduction_cents,
      case when paid_basis.amount_basis in ('tax_inclusive','separate_tax') or normalized.normalization_reason='cash_not_taxed'
        then adjustment.amount_cents else null end::bigint as gross_paid_cents,
      adjustment.adjustment_date as booking_date,
      coalesce(
        event.purchase_attribution_date,
        matched_fact.sale_date,
        case when linked_location.timezone is not null
          then (linked_case.incident_at at time zone linked_location.timezone)::date end,
          provider_original.sale_date
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
    left join lateral (
      select private.provider_refund_original_sale_date(adjustment.id) as sale_date
      where adjustment.source = 'nayax_provider_refund'
    ) provider_original on true
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
        when private.refund_original_source_tax_cents(linked_case.id,adjustment.amount_cents) is not null then 'tax_inclusive'
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
            then (linked_case.incident_at at time zone linked_location.timezone)::date end,
          provider_original.sale_date
        )
        and coalesce(rate.effective_end_date, 'infinity'::date) >= coalesce(
          event.purchase_attribution_date,
          matched_fact.sale_date,
          case when linked_location.timezone is not null
            then (linked_case.incident_at at time zone linked_location.timezone)::date end,
          provider_original.sale_date
        )
      order by rate.effective_start_date desc, rate.created_at desc, rate.id
      limit 1
    ) tax_rate on true
    cross join lateral private.normalize_refund_original_reader_amount_cents(
      adjustment.reporting_machine_id,
      case when adjustment.source = 'nayax_provider_refund' then 'card'
        when event.tender is not null then event.tender
        when linked_case.payment_method in ('cash', 'card') then linked_case.payment_method
        when lower(coalesce(adjustment.raw_payload ->> 'payment_method', '')) in ('card', 'credit') then 'card'
        when lower(coalesce(adjustment.raw_payload ->> 'payment_method', '')) = 'cash' then 'cash'
        else 'unknown' end,
      coalesce(event.purchase_attribution_date, matched_fact.sale_date,
        case when linked_location.timezone is not null
          then (linked_case.incident_at at time zone linked_location.timezone)::date end,
          provider_original.sale_date),
      adjustment.amount_cents,
      paid_basis.amount_basis,
      tax_rate.tax_rate_percent,
      case when adjustment.source='nayax_provider_refund' then private.provider_refund_original_source_tax_cents(adjustment.id,adjustment.amount_cents) else private.refund_original_source_tax_cents(linked_case.id,adjustment.amount_cents) end, true
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
    sum(component.receipt_component_count)::bigint,
    sum(component.gross_sales_cents) filter(where component.receipt_component_count>0)::bigint,
    count(*) filter(where component.receipt_component_count>0 and component.gross_sales_cents is null)::bigint,
    sum(component.sales_ex_tax_cents)::bigint,
    count(*) filter(where component.sales_ex_tax_cents is null)::bigint,
    sum(component.commissionable_sales_ex_tax_cents)::bigint,
    count(*) filter(where component.commissionable_sales_ex_tax_cents is null)::bigint,
    sum(component.request_deduction_ex_tax_cents+component.legacy_paid_deduction_ex_tax_cents-component.refund_reversal_ex_tax_cents)::bigint,
    count(*) filter(where component.request_deduction_ex_tax_cents+component.legacy_paid_deduction_ex_tax_cents-component.refund_reversal_ex_tax_cents is null)::bigint,
    case when bool_or(component.gross_sales_cents is null) then null else sum(component.gross_sales_cents)::bigint end,
    case when bool_or(component.gross_deduction_cents is null) then null else sum(component.gross_deduction_cents)::bigint end,
    case when bool_or(component.gross_paid_cents is null) then null else sum(component.gross_paid_cents)::bigint end,
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
      when bool_or(component.unresolved_sales_count>0 or component.unresolved_refund_count>0) then 'unresolved'
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
$function$;

CREATE OR REPLACE FUNCTION private.machine_sales_daily_waterfall_components(p_reporting_machine_id uuid, p_date_from date, p_date_to date)
 RETURNS TABLE(reporting_machine_id uuid, reporting_location_id uuid, gross_sales_cents bigint, gross_deduction_cents bigint, gross_paid_cents bigint, booking_date date, purchase_attribution_date date, tender text, source text, sales_transaction_count bigint, recorded_sales_cents bigint, sales_ex_tax_cents bigint, sales_tax_cents bigint, request_deduction_ex_tax_cents bigint, refund_reversal_ex_tax_cents bigint, legacy_paid_deduction_ex_tax_cents bigint, paid_context_ex_tax_cents bigint, outstanding_context_ex_tax_cents bigint, unresolved_sales_count bigint, unresolved_sales_cents bigint, unresolved_refund_count bigint, unresolved_refund_cents bigint, unresolved_paid_context_count bigint, unresolved_paid_context_cents bigint, commissionable_sales_ex_tax_cents bigint, normalization_status text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
      case when fact.source='nayax_scheduled_report' and exists(select 1 from private.machine_nayax_reader_associations history
          where history.reporting_machine_id=fact.reporting_machine_id) then nullif(btrim(fact.raw_payload->>'providerMachineId'),'')
        when fact.source='card_authority_daily' and exists(select 1 from private.machine_nayax_reader_associations history
          where history.reporting_machine_id=fact.reporting_machine_id) then (
          select case when count(distinct nullif(btrim(original.raw_payload->>'providerMachineId'),''))=1
            and count(*)=count(nullif(btrim(original.raw_payload->>'providerMachineId'),''))
            then min(original.raw_payload->>'providerMachineId') end
          from public.machine_sales_facts original
          cross join lateral private.reporting_retained_original_money(original) retained
          where original.reporting_machine_id=fact.reporting_machine_id and original.sale_date=fact.sale_date
            and original.source='nayax_scheduled_report' and original.payment_method='credit'
            and retained.original_amount_cents>0
        ) end as original_reader_id,
      fact.transaction_count::bigint as transaction_count,
      fact.net_sales_cents::bigint as amount_cents,
      fact.tax_cents::bigint as separate_tax_cents,
      case
        when fact.payment_method='cash' then 'tax_exclusive'
        when (fact.tax_cents>0 or lower(coalesce(fact.raw_payload->>'taxBasis','')) in ('separate_tax','separately_imported_tax'))
          and fact.payment_method='credit'
          and lower(coalesce(fact.raw_payload->>'amountBasis','')) not in ('tax_exclusive','tax_exclusive_minor')
          and (fact.source<>'sunze_browser' or lower(coalesce(fact.raw_payload->>'amountBasis',fact.raw_payload->>'taxBasis',''))
            in ('tax_inclusive','gross_customer_charge_minor','separate_tax','separately_imported_tax')) then 'separate_tax'
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
    from private.financial_machine_sales_facts fact
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
    left join lateral (
      select configured.amount_basis
      from public.reporting_machine_tax_treatments configured
      where configured.machine_id = fact.reporting_machine_id
        and configured.tender = case fact.payment_method
          when 'credit' then 'card' when 'cash' then 'cash' else 'unknown' end
        and configured.effective_start_date <= fact.sale_date
        and coalesce(configured.effective_end_date, 'infinity'::date) >= fact.sale_date
      order by configured.effective_start_date desc limit 1
    ) treatment on true
    where fact.reporting_machine_id = p_reporting_machine_id
      and fact.sale_date between p_date_from and p_date_to
      and fact.net_sales_cents > 0
      and not (fact.source = 'sunze_browser' and fact.payment_method = 'other'
        and lower(btrim(coalesce(fact.raw_payload ->> 'payment_method_source', '')))
          in ('free', 'no-pay', 'no pay'))
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
      scoped.original_reader_id,
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
      scoped.original_reader_id,
      scoped.amount_basis,
      scoped.tax_rate_percent
  ), sales_components as (
    select
      grouped.reporting_machine_id,
      grouped.reporting_location_id,
      case when grouped.tender='cash' or grouped.amount_basis in ('tax_inclusive','separate_tax')
        then grouped.recorded_cents else null end::bigint as gross_sales_cents,
      0::bigint as gross_deduction_cents, 0::bigint as gross_paid_cents,
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
    cross join lateral private.normalize_original_reader_amount_cents(
      grouped.reporting_machine_id, grouped.tender, grouped.sale_date,
      grouped.recorded_cents,
      grouped.amount_basis,
      grouped.tax_rate_percent,
      case when grouped.amount_basis = 'separate_tax'
        then grouped.separate_tax_cents else null end,
      true,grouped.source,grouped.original_reader_id
    ) normalized
  ), active_recognition as materialized (
    select event.*,
      case
        when event.amount_basis <> 'unknown' then event.amount_basis
        when private.refund_original_source_tax_cents(event.refund_case_id,event.request_target_after_cents) is not null then 'tax_inclusive'
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
      gift_card_amount.tax_exclusive_amount_cents as gift_card_resolved_ex_tax_cents,
      before_amount.normalization_status as before_normalization_status,
      after_amount.normalization_status as after_normalization_status,
      paid_amount.normalization_status as paid_normalization_status
    from active_recognition event
    cross join lateral private.normalize_refund_original_reader_amount_cents(
      event.reporting_machine_id, event.tender, event.purchase_attribution_date,
      event.recognized_target_before_cents,
      event.effective_amount_basis,
      event.tax_rate_percent,
      private.refund_original_source_tax_cents(event.refund_case_id,event.recognized_target_before_cents), true
    ) before_amount
    cross join lateral private.normalize_refund_original_reader_amount_cents(
      event.reporting_machine_id, event.tender, event.purchase_attribution_date,
      event.recognized_target_after_cents,
      event.effective_amount_basis,
      event.tax_rate_percent,
      private.refund_original_source_tax_cents(event.refund_case_id,event.recognized_target_after_cents), true
    ) after_amount
    cross join lateral private.normalize_refund_original_reader_amount_cents(
      event.reporting_machine_id, event.tender, event.purchase_attribution_date,
      event.paid_cumulative_cents,
      event.effective_amount_basis,
      event.tax_rate_percent,
      private.refund_original_source_tax_cents(event.refund_case_id,event.paid_cumulative_cents), true
    ) paid_amount
    cross join lateral private.normalize_refund_original_reader_amount_cents(
      event.reporting_machine_id, event.tender, event.purchase_attribution_date,
      private.refund_gift_card_resolved_purchase_cents(event.refund_case_id, p_date_to),
      event.effective_amount_basis,
      event.tax_rate_percent,
      private.refund_original_source_tax_cents(event.refund_case_id,private.refund_gift_card_resolved_purchase_cents(event.refund_case_id,p_date_to)), true
    ) gift_card_amount
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
      0::bigint as gross_sales_cents,
      case when bool_or(ranked.tender<>'cash' and ranked.effective_amount_basis not in ('tax_inclusive','separate_tax'))
        or bool_or(ranked.recognized_target_after_cents is null or ranked.recognized_target_before_cents is null)
        then null else sum(ranked.recognized_target_after_cents-ranked.recognized_target_before_cents)::bigint end as gross_deduction_cents,
      0::bigint as gross_paid_cents,
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
        then greatest(ranked.after_ex_tax_cents - ranked.paid_ex_tax_cents
          - coalesce(ranked.gift_card_resolved_ex_tax_cents, 0), 0)
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
      0::bigint as gross_sales_cents,
      case when adjustment.created_at>=rollout.activated_at then 0
        when paid_basis.amount_basis in ('tax_inclusive','separate_tax') or normalized.normalization_reason='cash_not_taxed'
        then adjustment.amount_cents else null end::bigint as gross_deduction_cents,
      case when paid_basis.amount_basis in ('tax_inclusive','separate_tax') or normalized.normalization_reason='cash_not_taxed'
        then adjustment.amount_cents else null end::bigint as gross_paid_cents,
      adjustment.adjustment_date as booking_date,
      coalesce(
        event.purchase_attribution_date,
        matched_fact.sale_date,
        case when linked_location.timezone is not null
          then (linked_case.incident_at at time zone linked_location.timezone)::date end,
          provider_original.sale_date
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
    left join lateral (
      select private.provider_refund_original_sale_date(adjustment.id) as sale_date
      where adjustment.source = 'nayax_provider_refund'
    ) provider_original on true
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
        when private.refund_original_source_tax_cents(linked_case.id,adjustment.amount_cents) is not null then 'tax_inclusive'
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
            then (linked_case.incident_at at time zone linked_location.timezone)::date end,
          provider_original.sale_date
        )
        and coalesce(rate.effective_end_date, 'infinity'::date) >= coalesce(
          event.purchase_attribution_date,
          matched_fact.sale_date,
          case when linked_location.timezone is not null
            then (linked_case.incident_at at time zone linked_location.timezone)::date end,
          provider_original.sale_date
        )
      order by rate.effective_start_date desc, rate.created_at desc, rate.id
      limit 1
    ) tax_rate on true
    cross join lateral private.normalize_refund_original_reader_amount_cents(
      adjustment.reporting_machine_id,
      case when adjustment.source = 'nayax_provider_refund' then 'card'
        when event.tender is not null then event.tender
        when linked_case.payment_method in ('cash', 'card') then linked_case.payment_method
        when lower(coalesce(adjustment.raw_payload ->> 'payment_method', '')) in ('card', 'credit') then 'card'
        when lower(coalesce(adjustment.raw_payload ->> 'payment_method', '')) = 'cash' then 'cash'
        else 'unknown' end,
      coalesce(event.purchase_attribution_date, matched_fact.sale_date,
        case when linked_location.timezone is not null
          then (linked_case.incident_at at time zone linked_location.timezone)::date end,
          provider_original.sale_date),
      adjustment.amount_cents,
      paid_basis.amount_basis,
      tax_rate.tax_rate_percent,
      case when adjustment.source='nayax_provider_refund' then private.provider_refund_original_source_tax_cents(adjustment.id,adjustment.amount_cents) else private.refund_original_source_tax_cents(linked_case.id,adjustment.amount_cents) end, true
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
    case when bool_or(component.gross_sales_cents is null) then null else sum(component.gross_sales_cents)::bigint end,
    case when bool_or(component.gross_deduction_cents is null) then null else sum(component.gross_deduction_cents)::bigint end,
    case when bool_or(component.gross_paid_cents is null) then null else sum(component.gross_paid_cents)::bigint end,
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
      when bool_or(component.unresolved_sales_count>0 or component.unresolved_refund_count>0) then 'unresolved'
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
$function$;

CREATE OR REPLACE FUNCTION private.normalize_original_reader_amount_cents(p_machine_id uuid, p_tender text, p_purchase_date date, p_amount_cents bigint, p_amount_basis text, p_tax_rate_percent numeric, p_separate_tax_cents bigint, p_preserve_basis boolean, p_source text, p_reader_id text)
 RETURNS TABLE(recorded_amount_cents bigint, tax_exclusive_amount_cents bigint, tax_cents bigint, amount_basis text, normalization_status text, normalization_reason text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER ROWS 1
 SET search_path TO ''
AS $function$
declare has_history boolean; original_rate numeric;
begin
  if p_source not in ('nayax_scheduled_report','card_authority_daily') then
    return query select * from private.normalize_reporting_treated_amount_cents(
      p_machine_id,p_tender,p_purchase_date,p_amount_cents,p_amount_basis,
      p_tax_rate_percent,p_separate_tax_cents,p_preserve_basis);
    return;
  end if;
  select exists(select 1 from private.machine_nayax_reader_associations history
    where history.reporting_machine_id=p_machine_id) into has_history;
  if p_source not in ('nayax_scheduled_report','card_authority_daily') or not has_history then
    return query select * from private.normalize_reporting_treated_amount_cents(
      p_machine_id,p_tender,p_purchase_date,p_amount_cents,p_amount_basis,
      p_tax_rate_percent,p_separate_tax_cents,p_preserve_basis);
  elsif p_source in ('nayax_scheduled_report','card_authority_daily') and has_history then
    if (case when p_tender='cash' or p_amount_cents=0 then false
      when p_separate_tax_cents is not null then false
      when lower(btrim(coalesce(p_amount_basis,''))) in
        ('tax_inclusive','gross_customer_charge_minor','legacy_percentage_of_gross_estimate') then true
      else false end) then
    select case when evidence.classification='verified_tax' then evidence.rate_percent end
    into original_rate from private.nayax_machine_tax_observations evidence
    where evidence.account_key='TGPACI_USA_DB'
      and evidence.nayax_machine_id=nullif(btrim(p_reader_id),'')
      and evidence.effective_start_date<=p_purchase_date
      and coalesce(evidence.effective_end_date,'infinity'::date)>=p_purchase_date
    order by (evidence.source='owner_rate_correction') desc, (evidence.classification<>'unavailable') desc,
      evidence.effective_start_date desc,evidence.observed_at desc,evidence.id limit 1;
    end if;
    return query select * from private.normalize_financial_amount_cents(p_amount_cents,
      case when p_tender='cash' or p_amount_cents=0 then 'tax_exclusive'
        when p_separate_tax_cents is not null then 'separate_tax'
        when p_amount_basis in ('tax_inclusive','legacy_percentage_of_gross_estimate')
          and original_rate is null then 'unknown' else p_amount_basis end,
      case when p_tender='cash' then 0 else original_rate end,
      case when p_tender='cash' then null else p_separate_tax_cents end);
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION private.provider_refund_original_sale_date(p_adjustment_id uuid)
 RETURNS date
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare result date;
begin
select case when count(distinct fact.id) = 1 then min(fact.sale_date) end
  into result
  from public.nayax_provider_refund_events event
  join public.sales_adjustment_facts adjustment
    on adjustment.id = event.adjustment_id
   and adjustment.source = 'nayax_provider_refund'
   and adjustment.reporting_machine_id = event.reporting_machine_id
   and adjustment.amount_cents = event.amount_cents
  join public.nayax_dtm_export_rows original
    on original.provider_actor_id = event.provider_actor_id
   and original.provider_machine_id = event.provider_machine_id
   and original.provider_transaction_id = event.original_transaction_id
   and (original.provider_type = 0
     or (original.provider_type is null and original.provider_status in (12, 62, 63)))
   and original.settlement_amount_cents > 0
   and original.settlement_amount_cents >= event.amount_cents
   and original.original_transaction_id is null
   and original.disposition in ('fact_linked', 'fact_linked+refund_applied')
   and original.financial_disposition = 'eligible'
  join public.machine_sales_facts fact
    on fact.id = original.fact_id
   and fact.reporting_machine_id = event.reporting_machine_id
   and fact.payment_method = 'credit'
   and fact.source = 'nayax_scheduled_report'
   and fact.sale_date = original.machine_settled_at::date
   and fact.raw_payload ->> 'actorId' = event.provider_actor_id
   and fact.raw_payload ->> 'providerMachineId' = event.provider_machine_id
   and fact.raw_payload ->> 'transactionId' = event.original_transaction_id
   and fact.raw_payload ->> 'currencyCode' = event.currency_code
  where event.adjustment_id = p_adjustment_id
    and event.disposition = 'applied'
    and event.currency_code = 'USD';
  return result;
end;
$function$;

CREATE OR REPLACE FUNCTION private.provider_refund_original_source_tax_cents(p_adjustment_id uuid, p_amount_cents bigint)
 RETURNS bigint
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare result bigint;
begin
select case when count(distinct fact.id)=1 then
    min(round(p_amount_cents::numeric*resolved_tax.original_tax_cents/money.original_amount_cents)::bigint) end
  into result
  from public.nayax_provider_refund_events event
  join public.nayax_dtm_export_rows original
    on original.provider_actor_id=event.provider_actor_id
    and original.provider_machine_id=event.provider_machine_id
    and original.provider_transaction_id=event.original_transaction_id
    and (original.provider_type=0 or (original.provider_type is null and original.provider_status in (12,62,63)))
    and original.settlement_amount_cents>0 and original.settlement_amount_cents>=event.amount_cents
    and original.original_transaction_id is null
    and original.disposition in ('fact_linked','fact_linked+refund_applied')
    and original.financial_disposition='eligible'
  join public.machine_sales_facts fact on fact.id=original.fact_id
    and fact.reporting_machine_id=event.reporting_machine_id
    and fact.sale_date=private.provider_refund_original_sale_date(p_adjustment_id)
    and fact.sale_date=original.machine_settled_at::date
    and fact.source='nayax_scheduled_report'
    and fact.raw_payload->>'actorId'=event.provider_actor_id
    and fact.raw_payload->>'providerMachineId'=event.provider_machine_id
    and fact.raw_payload->>'transactionId'=event.original_transaction_id
    and fact.raw_payload->>'currencyCode'=event.currency_code
  cross join lateral private.reporting_retained_original_money(fact) money
  left join lateral private.normalize_original_reader_amount_cents(
    fact.reporting_machine_id,'card',fact.sale_date,money.original_amount_cents,
    'tax_inclusive',null,null,true,fact.source,fact.raw_payload->>'providerMachineId'
  ) original_reader on fact.source='nayax_scheduled_report'
  cross join lateral (select case
    when money.original_tax_cents>0
      or lower(coalesce(fact.raw_payload->>'amountBasis','')) in ('separate_tax','separately_imported_tax')
      or lower(coalesce(fact.raw_payload->>'taxBasis','')) in ('separate_tax','separately_imported_tax')
      then money.original_tax_cents
    when fact.source='nayax_scheduled_report' and exists(select 1 from private.machine_nayax_reader_associations history
      where history.reporting_machine_id=fact.reporting_machine_id) then original_reader.tax_cents
    else null end as original_tax_cents) resolved_tax
  where event.adjustment_id=p_adjustment_id and event.disposition='applied' and event.currency_code='USD'
    and fact.payment_method='credit' and money.original_amount_cents>0
    and lower(coalesce(fact.raw_payload->>'amountBasis','')) not in ('tax_exclusive','tax_exclusive_minor')
    and p_amount_cents between 0 and money.original_amount_cents
    and resolved_tax.original_tax_cents between 0 and money.original_amount_cents;
  return result;
end;
$function$;
select pg_notify('pgrst','reload schema');

