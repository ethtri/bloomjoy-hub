-- #1763: cash is the collected sale value; card normalization uses dated source
-- evidence. Existing request events and issued snapshots remain immutable.
create function private.refund_original_source_tax_cents(p_case_id uuid,p_amount_cents bigint)
returns bigint language sql stable security definer set search_path='' as $$
  select round(p_amount_cents::numeric*fact.tax_cents/fact.net_sales_cents)::bigint
  from public.refund_cases refund_case
  join public.machine_sales_facts fact on fact.id=refund_case.matched_sales_fact_id
    and fact.reporting_machine_id=refund_case.reporting_machine_id
  where refund_case.id=p_case_id and refund_case.payment_method='card'
    and fact.payment_method='credit' and fact.net_sales_cents>0
    and lower(coalesce(fact.raw_payload->>'amountBasis','')) not in ('tax_exclusive','tax_exclusive_minor')
    and (fact.source<>'sunze_browser' or lower(coalesce(fact.raw_payload->>'amountBasis',fact.raw_payload->>'taxBasis',''))
      in ('tax_inclusive','gross_customer_charge_minor','separate_tax','separately_imported_tax'))
    and p_amount_cents between 0 and fact.net_sales_cents
    and fact.tax_cents between 0 and fact.net_sales_cents
    and (fact.tax_cents>0 or lower(coalesce(fact.raw_payload->>'amountBasis',fact.raw_payload->>'taxBasis',''))
      in ('separate_tax','separately_imported_tax'));
$$;
revoke all on function private.refund_original_source_tax_cents(uuid,bigint) from public,anon,authenticated;
grant execute on function private.refund_original_source_tax_cents(uuid,bigint) to service_role;

create function private.provider_refund_original_source_tax_cents(p_adjustment_id uuid,p_amount_cents bigint)
returns bigint language sql stable security definer set search_path='' as $$
  select case when count(distinct fact.id)=1 then
    min(round(p_amount_cents::numeric*fact.tax_cents/fact.net_sales_cents)::bigint) end
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
  where event.adjustment_id=p_adjustment_id and event.disposition='applied' and event.currency_code='USD'
    and fact.payment_method='credit' and fact.net_sales_cents>0
    and lower(coalesce(fact.raw_payload->>'amountBasis','')) not in ('tax_exclusive','tax_exclusive_minor')
    and p_amount_cents between 0 and fact.net_sales_cents
    and fact.tax_cents between 0 and fact.net_sales_cents
    and (fact.tax_cents>0 or lower(coalesce(fact.raw_payload->>'amountBasis',fact.raw_payload->>'taxBasis',''))
      in ('separate_tax','separately_imported_tax'));
$$;
revoke all on function private.provider_refund_original_source_tax_cents(uuid,bigint) from public,anon,authenticated;
grant execute on function private.provider_refund_original_source_tax_cents(uuid,bigint) to service_role;

create or replace function private.normalize_reporting_treated_amount_cents(
  p_machine_id uuid, p_tender text, p_purchase_date date,
  p_amount_cents bigint, p_amount_basis text, p_tax_rate_percent numeric,
  p_separate_tax_cents bigint, p_preserve_basis boolean
) returns table(recorded_amount_cents bigint, tax_exclusive_amount_cents bigint,
  tax_cents bigint, amount_basis text, normalization_status text, normalization_reason text)
language sql stable security definer set search_path = '' as $$
  select normalized.recorded_amount_cents,normalized.tax_exclusive_amount_cents,
    normalized.tax_cents,normalized.amount_basis,normalized.normalization_status,
    case when p_tender='cash' then 'cash_not_taxed' else normalized.normalization_reason end
  from (select 1) singleton
  left join lateral private.resolve_reporting_machine_source_tax(p_machine_id,p_purchase_date) source on true
  cross join lateral private.normalize_financial_amount_cents(
    p_amount_cents,
    case when p_tender='cash' or p_amount_cents=0 then 'tax_exclusive'
      when p_tender='card' and p_amount_basis in ('tax_inclusive','unknown','separate_tax')
        and p_separate_tax_cents is not null then 'separate_tax'
      when p_amount_basis in ('tax_inclusive','legacy_percentage_of_gross_estimate')
        and source.rate_percent is null then 'unknown'
      else p_amount_basis end,
    case when p_tender='cash' then 0 else source.rate_percent end,
    case when p_tender='cash' then null else p_separate_tax_cents end
  ) normalized
  -- The resolver returns one row, including missing/unclassified coverage.
  -- Defined by the source ingestion migration preceding this migration.
  -- Kept in a lateral subquery below so missing evidence cannot erase an amount.
$$;

do $actual_tax$
declare definition text:=replace(pg_get_functiondef('private.machine_sales_daily_components(uuid,date,date)'::regprocedure),E'\r\n',E'\n');
  patch record;
begin
  if position('fact.tax_cents::bigint as separate_tax_cents,' in definition)=0 then
    raise exception 'Actual transaction tax adapter seam changed';
  end if;
  definition:=replace(definition,$old$      case
        when lower(coalesce(fact.raw_payload ->> 'amountBasis', ''))$old$,
    $new$      case
        when fact.payment_method='cash' then 'tax_exclusive'
        when fact.tax_cents>0 and fact.payment_method='credit'
          and lower(coalesce(fact.raw_payload->>'amountBasis','')) not in ('tax_exclusive','tax_exclusive_minor')
          and (fact.source<>'sunze_browser' or lower(coalesce(fact.raw_payload->>'amountBasis',fact.raw_payload->>'taxBasis',''))
            in ('tax_inclusive','gross_customer_charge_minor','separate_tax','separately_imported_tax')) then 'separate_tax'
        when lower(coalesce(fact.raw_payload ->> 'amountBasis', ''))$new$);
  definition:=replace(definition,$old$        when treatment.amount_basis <> 'source_default' then treatment.amount_basis
$old$,'');
  definition:=replace(definition,$old$        when event.amount_basis <> 'unknown' then event.amount_basis
$old$,$new$        when event.amount_basis <> 'unknown' then event.amount_basis
        when private.refund_original_source_tax_cents(event.refund_case_id,event.request_target_after_cents) is not null then 'tax_inclusive'
$new$);
  definition:=replace(definition,$old$        when adjustment.source = 'nayax_provider_refund' then 'tax_inclusive'
$old$,$new$        when adjustment.source = 'nayax_provider_refund' then 'tax_inclusive'
        when private.refund_original_source_tax_cents(linked_case.id,adjustment.amount_cents) is not null then 'tax_inclusive'
$new$);
  for patch in select * from (values
    ('before_amount','private.refund_original_source_tax_cents(event.refund_case_id,event.recognized_target_before_cents)'),
    ('after_amount','private.refund_original_source_tax_cents(event.refund_case_id,event.recognized_target_after_cents)'),
    ('paid_amount','private.refund_original_source_tax_cents(event.refund_case_id,event.paid_cumulative_cents)'),
    ('gift_card_amount','private.refund_original_source_tax_cents(event.refund_case_id,private.refund_gift_card_resolved_purchase_cents(event.refund_case_id,p_date_to))')
  ) patches(alias_name,tax_expression) loop
    if cardinality(string_to_array(definition,E'event.tax_rate_percent,\n      null, true\n    ) '||patch.alias_name))<>2 then
      raise exception 'Original refund tax normalization seam changed: %',patch.alias_name;
    end if;
    definition:=replace(definition,E'event.tax_rate_percent,\n      null, true\n    ) '||patch.alias_name,
      E'event.tax_rate_percent,\n      '||patch.tax_expression||E', true\n    ) '||patch.alias_name);
  end loop;
  definition:=replace(definition,E'tax_rate.tax_rate_percent,\n      null, true\n    ) normalized',
    E'tax_rate.tax_rate_percent,\n      case when adjustment.source=\'nayax_provider_refund\' then private.provider_refund_original_source_tax_cents(adjustment.id,adjustment.amount_cents) else private.refund_original_source_tax_cents(linked_case.id,adjustment.amount_cents) end, true\n    ) normalized');
  execute definition;
end;
$actual_tax$;

-- Add a Finance-only projection from the installed canonical adapter. Keeping
-- all its joins, cutoff, recognition reversals, and paid context avoids a second
-- accounting ledger. Exact seams reject incompatible adapter changes.
do $waterfall$
declare definition text;
  patch record;
begin
  definition := replace(pg_get_functiondef('private.machine_sales_daily_components(uuid,date,date)'::regprocedure),E'\r\n',E'\n');
  for patch in select * from (values
    ('private.machine_sales_daily_components(', 'private.machine_sales_daily_waterfall_components(',1),
    ('reporting_location_id uuid,', 'reporting_location_id uuid, gross_sales_cents bigint, gross_deduction_cents bigint, gross_paid_cents bigint,',1),
    ($o$      grouped.reporting_location_id,
$o$, $n$      grouped.reporting_location_id,
      case when grouped.tender='cash' or grouped.amount_basis in ('tax_inclusive','separate_tax')
        then grouped.recorded_cents else null end::bigint as gross_sales_cents,
      0::bigint as gross_deduction_cents, 0::bigint as gross_paid_cents,
$n$,1),
    ($o$    select
      ranked.reporting_machine_id,
      ranked.reporting_location_id,
      ranked.booking_date,$o$, $n$    select
      ranked.reporting_machine_id,
      ranked.reporting_location_id,
      0::bigint as gross_sales_cents,
      case when bool_or(ranked.tender<>'cash' and ranked.effective_amount_basis not in ('tax_inclusive','separate_tax'))
        or bool_or(ranked.recognized_target_after_cents is null or ranked.recognized_target_before_cents is null)
        then null else sum(ranked.recognized_target_after_cents-ranked.recognized_target_before_cents)::bigint end as gross_deduction_cents,
      0::bigint as gross_paid_cents,
      ranked.booking_date,$n$,1),
    ($o$      adjustment.reporting_location_id,
      adjustment.adjustment_date as booking_date,$o$, $n$      adjustment.reporting_location_id,
      0::bigint as gross_sales_cents,
      case when adjustment.created_at>=rollout.activated_at then 0
        when paid_basis.amount_basis in ('tax_inclusive','separate_tax') or normalized.normalization_reason='cash_not_taxed'
        then adjustment.amount_cents else null end::bigint as gross_deduction_cents,
      case when paid_basis.amount_basis in ('tax_inclusive','separate_tax') or normalized.normalization_reason='cash_not_taxed'
        then adjustment.amount_cents else null end::bigint as gross_paid_cents,
      adjustment.adjustment_date as booking_date,$n$,1),
    ($o$  select
    component.reporting_machine_id,
    component.reporting_location_id,
    component.booking_date,$o$, $n$  select
    component.reporting_machine_id,
    component.reporting_location_id,
    case when bool_or(component.gross_sales_cents is null) then null else sum(component.gross_sales_cents)::bigint end,
    case when bool_or(component.gross_deduction_cents is null) then null else sum(component.gross_deduction_cents)::bigint end,
    case when bool_or(component.gross_paid_cents is null) then null else sum(component.gross_paid_cents)::bigint end,
    component.booking_date,$n$,1)
  ) patches(original,replacement,expected_count) loop
    if cardinality(string_to_array(definition,patch.original))<>patch.expected_count+1 then
      raise exception 'Finance waterfall canonical seam changed: %',patch.original;
    end if;
    definition:=replace(definition,patch.original,patch.replacement);
  end loop;
  execute definition;
end;
$waterfall$;
revoke all on function private.machine_sales_daily_waterfall_components(uuid,date,date) from public,anon,authenticated;
grant execute on function private.machine_sales_daily_waterfall_components(uuid,date,date) to service_role;

do $finance$
declare definition text;
begin
  definition:=replace(pg_get_functiondef('public.get_finance_reporting(date,date,uuid[],uuid[])'::regprocedure),E'\r\n',E'\n');
  if position('a.net_sales end as "netSalesExTaxCents"' in definition)=0
    or position('as estimated_count' in definition)=0 then raise exception 'Finance source tax projection seam changed'; end if;
  definition:=replace(definition,'private.machine_sales_daily_components(','private.machine_sales_daily_waterfall_components(');
  definition:=replace(definition,'a.net_sales end as "netSalesExTaxCents",',
    $new$a.net_sales end as "netSalesExTaxCents",
      a.gross_sales as "grossSalesIncludingTaxCents",
      case when restricted.present then null else a.gross_deduction end as "refundDeductionIncludingTaxCents",
      case when restricted.present then null else a.gross_sales-a.gross_deduction-a.net_sales end as "remainingTaxCents",
      case when restricted.present then null else a.completed_refund end as "completedRefundExTaxCents",
      case when restricted.present then null else a.gross_paid end as "completedRefundIncludingTaxCents",
      case when restricted.present then null else a.sales_ex_tax-a.completed_refund end as "reconciliationNetSalesExTaxCents",$new$);
  definition:=replace(definition,'as estimated_count',
    $new$as estimated_count,
        case when bool_or(c.gross_sales_cents is null) then null else coalesce(sum(c.gross_sales_cents),0)::bigint end as gross_sales,
        case when bool_or(c.gross_deduction_cents is null) then null else coalesce(sum(c.gross_deduction_cents),0)::bigint end as gross_deduction,
        case when bool_or(c.gross_paid_cents is null) then null else coalesce(sum(c.gross_paid_cents),0)::bigint end as gross_paid,
        case when bool_or(c.unresolved_paid_context_count>0 or (c.source<>'refund_request' and c.unresolved_refund_count>0)) or bool_or(c.paid_context_ex_tax_cents is null) then null
          else coalesce(sum(c.paid_context_ex_tax_cents),0)::bigint end as completed_refund$new$);
  execute definition;
end;
$finance$;
select pg_notify('pgrst','reload schema');
