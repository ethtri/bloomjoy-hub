CREATE OR REPLACE FUNCTION private.provider_refund_original_sale_date(p_adjustment_id uuid)
 RETURNS date
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select case when count(distinct fact.id) = 1 then min(fact.sale_date) end
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
$function$
;
CREATE OR REPLACE FUNCTION private.provider_refund_original_source_tax_cents(p_adjustment_id uuid, p_amount_cents bigint)
 RETURNS bigint
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select case when count(distinct fact.id)=1 then
    min(round(p_amount_cents::numeric*resolved_tax.original_tax_cents/money.original_amount_cents)::bigint) end
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
$function$
;