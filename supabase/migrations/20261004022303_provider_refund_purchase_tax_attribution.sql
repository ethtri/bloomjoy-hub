-- The exact-original lookup otherwise scans all historical DTM rows per refund.
create index nayax_dtm_original_sale_identity_idx
  on public.nayax_dtm_export_rows(provider_actor_id, provider_machine_id, provider_transaction_id)
  where provider_type = 0 and settlement_amount_cents > 0
    and original_transaction_id is null and disposition = 'fact_linked'
    and financial_disposition = 'eligible';

-- Resolve only an exact imported original sale. The refund event date remains
-- the booking date; it never substitutes for an unproved purchase date.
create function private.provider_refund_original_sale_date(p_adjustment_id uuid)
returns date
language sql stable
set search_path = ''
as $$
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
   and original.provider_type = 0
   and original.settlement_amount_cents > 0
   and original.settlement_amount_cents >= event.amount_cents
   and original.original_transaction_id is null
   and original.disposition = 'fact_linked'
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
$$;
revoke all on function private.provider_refund_original_sale_date(uuid)
  from public, anon, authenticated;
revoke execute on function private.provider_refund_original_sale_date(uuid) from service_role;

-- Patch the installed adapter rather than replacing later tax-treatment,
-- gift-card and source-authority changes. Exact seams fail closed on drift.
do $patch$
declare
  definition text := pg_get_functiondef('private.machine_sales_daily_components(uuid,date,date)'::regprocedure);
  old_join text := $oldjoin$    left join public.machine_sales_facts matched_fact
      on matched_fact.id = linked_case.matched_sales_fact_id$oldjoin$;
  new_join text := $newjoin$    left join lateral (
      select private.provider_refund_original_sale_date(adjustment.id) as sale_date
      where adjustment.source = 'nayax_provider_refund'
    ) provider_original on true
    left join public.machine_sales_facts matched_fact
      on matched_fact.id = linked_case.matched_sales_fact_id$newjoin$;
  old_date text := $olddate$(linked_case.incident_at at time zone linked_location.timezone)::date end$olddate$;
  new_date text := $newdate$(linked_case.incident_at at time zone linked_location.timezone)::date end,
          provider_original.sale_date$newdate$;
begin
  if (length(definition)-length(replace(definition,old_join,'')))/length(old_join) <> 1
    or (length(definition)-length(replace(definition,old_date,'')))/length(old_date) <> 4
    or position('private.normalize_reporting_treated_amount_cents' in definition) = 0
    or position('private.refund_gift_card_resolved_purchase_cents' in definition) = 0 then
    raise exception 'Provider refund purchase attribution adapter seam changed';
  end if;
  definition := replace(definition,old_join,new_join);
  definition := replace(definition,old_date,new_date);
  execute definition;
end;
$patch$;
