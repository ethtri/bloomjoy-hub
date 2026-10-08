-- #1824: legacy cases may retain an exact transaction/site without a matched
-- fact pointer. Resolve their already recorded original; never repair pointers,
-- decisions, financial ownership or recognition dates as part of a report read.
-- The case retains transaction/site rather than actor, so the actor-leading
-- original-sale index cannot serve this bounded lookup.
create index nayax_dtm_case_original_identity_idx
  on public.nayax_dtm_export_rows(provider_transaction_id,provider_site_id)
  where fact_id is not null and disposition in ('fact_linked','fact_linked+refund_applied')
    and financial_disposition='eligible' and original_transaction_id is null
    and settlement_amount_cents>0
    and (provider_type=0 or (provider_type is null and provider_status in (12,62,63)));

create or replace function private.refund_original_source_tax_cents(p_case_id uuid,p_amount_cents bigint)
returns bigint language plpgsql stable security definer set search_path='' as $$
declare result bigint; matched_fact_id uuid;
begin
  select c.matched_sales_fact_id into matched_fact_id from public.refund_cases c where c.id=p_case_id;
  if not found then return null; end if;
  if matched_fact_id is not null then
  select round(p_amount_cents::numeric*money.original_tax_cents/money.original_amount_cents)::bigint
  into result
  from public.refund_cases refund_case
  join public.machine_sales_facts fact on fact.id=refund_case.matched_sales_fact_id
    and fact.reporting_machine_id=refund_case.reporting_machine_id
  cross join lateral private.reporting_retained_original_money(fact) money
  where refund_case.id=p_case_id and refund_case.payment_method='card'
    and fact.payment_method='credit' and money.original_amount_cents>0
    and lower(coalesce(fact.raw_payload->>'amountBasis','')) not in ('tax_exclusive','tax_exclusive_minor')
    and (fact.source<>'sunze_browser' or lower(coalesce(fact.raw_payload->>'amountBasis',fact.raw_payload->>'taxBasis',''))
      in ('tax_inclusive','gross_customer_charge_minor','separate_tax','separately_imported_tax'))
    and p_amount_cents between 0 and money.original_amount_cents
    and money.original_tax_cents between 0 and money.original_amount_cents
    and (money.original_tax_cents>0 or lower(coalesce(fact.raw_payload->>'amountBasis','')) in ('separate_tax','separately_imported_tax')
      or lower(coalesce(fact.raw_payload->>'taxBasis','')) in ('separate_tax','separately_imported_tax'));
  return result;
  end if;
  select recovered.tax_cents into result from (
    with originals as materialized (
      select distinct fact.id,fact.reporting_machine_id,fact.sale_date,fact.source,
        fact.raw_payload,money.original_amount_cents,money.original_tax_cents
      from public.refund_cases refund_case
      join public.nayax_dtm_export_rows original
        on original.provider_transaction_id=refund_case.matched_nayax_transaction_id
        and original.provider_site_id=refund_case.matched_nayax_site_id::text
      join public.machine_sales_facts fact on fact.id=original.fact_id
        and fact.reporting_machine_id=refund_case.reporting_machine_id
      cross join lateral private.reporting_retained_original_money(fact) money
      where refund_case.id=p_case_id and refund_case.matched_sales_fact_id is null
        and refund_case.payment_method='card' and refund_case.correlation_source='nayax'
        and refund_case.matched_nayax_currency_code='USD'
        and refund_case.matched_nayax_amount_cents=money.original_amount_cents
        and money.original_amount_cents>0 and p_amount_cents between 0 and money.original_amount_cents
        and fact.source='nayax_scheduled_report' and fact.payment_method='credit'
        and fact.raw_payload->>'currencyCode'='USD'
        and fact.raw_payload->>'actorId' in ('2001508696','2003563806')
        and coalesce(nullif(fact.raw_payload->>'accountKey',''),'TGPACI_USA_DB')='TGPACI_USA_DB'
        and fact.raw_payload->>'actorId'=original.provider_actor_id
        and fact.raw_payload->>'providerMachineId'=original.provider_machine_id
        and fact.raw_payload->>'transactionId'=original.provider_transaction_id
        and fact.raw_payload->>'siteId'=original.provider_site_id
        and original.disposition in ('fact_linked','fact_linked+refund_applied')
        and original.financial_disposition='eligible' and original.original_transaction_id is null
        and original.fact_id is not null and original.settlement_amount_cents>0
        and original.settlement_amount_cents=money.original_amount_cents
        -- The linked fact owns its local purchase date. A UTC cast of the DTM
        -- timestamp could cross midnight and must not replace that date.
        and (original.provider_type=0 or (original.provider_type is null and original.provider_status in (12,62,63)))
        and lower(coalesce(fact.raw_payload->>'amountBasis','')) not in ('tax_exclusive','tax_exclusive_minor')
        and exists(select 1 from private.machine_nayax_reader_associations history
          where history.reporting_machine_id=fact.reporting_machine_id
            and history.account_key='TGPACI_USA_DB' and history.nayax_machine_id=original.provider_machine_id)
    ), normalized as (
      select original.id,amount.tax_cents from originals original
      cross join lateral private.normalize_original_reader_amount_cents(
        original.reporting_machine_id,'card',original.sale_date,p_amount_cents,'tax_inclusive',null,
        case when original.original_tax_cents>0
          or lower(coalesce(original.raw_payload->>'amountBasis','')) in ('separate_tax','separately_imported_tax')
          or lower(coalesce(original.raw_payload->>'taxBasis','')) in ('separate_tax','separately_imported_tax')
          then round(p_amount_cents::numeric*original.original_tax_cents/original.original_amount_cents)::bigint end,
        true,original.source,original.raw_payload->>'providerMachineId') amount
    )
    select case when (select count(*) from originals)=1
      and count(*)=1 and bool_and(tax_cents is not null)
      then min(tax_cents) end tax_cents from normalized
  ) recovered;
  return result;
end;
$$;
revoke all on function private.refund_original_source_tax_cents(uuid,bigint) from public,anon,authenticated;
grant execute on function private.refund_original_source_tax_cents(uuid,bigint) to service_role;
