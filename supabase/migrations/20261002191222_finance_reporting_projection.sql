-- Finance composes existing calculations; this adds no ledger or payment powers.
create function private.finance_reporting_machine_scope(p_actor uuid)
returns table(id uuid) language sql stable security definer set search_path='' as $$
  select r.id from private.refund_analytics_machine_scope(p_actor) r
  where p_actor is not null and public.has_reporting_machine_access(p_actor,r.id);
$$;
revoke all on function private.finance_reporting_machine_scope(uuid) from public,anon,authenticated;

create function public.get_finance_reporting_access()
returns jsonb language sql stable security definer set search_path='' as $$
  with dimensions as (
    select m.id as "machineId",m.machine_label as "machineLabel",l.id as "locationId",l.name as "locationName"
    from private.finance_reporting_machine_scope(auth.uid()) s
    join public.reporting_machines m on m.id=s.id join public.reporting_locations l on l.id=m.location_id
    union
    select m.id,m.machine_label,l.id,l.name
    from private.finance_reporting_machine_scope(auth.uid()) s
    join public.reporting_machines m on m.id=s.id
    join public.refund_cases c on c.reporting_machine_id=m.id and c.case_population='customer'
    join public.reporting_locations l on l.id=c.reporting_location_id
    union
    select m.id,m.machine_label,l.id,l.name
    from private.finance_reporting_machine_scope(auth.uid()) s
    join public.reporting_machines m on m.id=s.id
    join public.machine_sales_facts f on f.reporting_machine_id=m.id
    join public.reporting_locations l on l.id=f.reporting_location_id
  )
  select jsonb_build_object('hasAccess',exists(select 1 from dimensions),
    'dimensions',coalesce(jsonb_agg(to_jsonb(d) order by d."machineLabel",d."locationName"),'[]'::jsonb))
  from dimensions d;
$$;
revoke all on function public.get_finance_reporting_access() from public,anon;
grant execute on function public.get_finance_reporting_access() to authenticated;

create function public.get_finance_reporting(
  p_date_from date,p_date_to date,p_machine_ids uuid[] default null,p_location_ids uuid[] default null
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  if auth.uid() is null or not exists(select 1 from private.finance_reporting_machine_scope(auth.uid())) then
    raise exception 'Authorized sales and refund reporting access required' using errcode='42501';
  end if;
  if p_date_from is null or p_date_to is null or p_date_from>p_date_to or p_date_to-p_date_from>366 then
    raise exception 'Choose a valid reporting period of up to 367 days' using errcode='22023';
  end if;
  with scope as materialized (
    select m.id,m.machine_label from private.finance_reporting_machine_scope(auth.uid()) s
    join public.reporting_machines m on m.id=s.id
    where p_machine_ids is null or m.id=any(p_machine_ids)
  ), components as materialized (
    select d.* from scope s cross join lateral private.machine_sales_daily_components(s.id,p_date_from,p_date_to) d
    where p_location_ids is null or d.reporting_location_id=any(p_location_ids)
  ), dimensions as (
    select s.id as machine_id,(d->>'locationId')::uuid as location_id,s.machine_label,d->>'locationName' as location_name
    from scope s cross join jsonb_array_elements(public.get_finance_reporting_access()->'dimensions') d
    where d->>'machineId'=s.id::text and (p_location_ids is null or (d->>'locationId')::uuid=any(p_location_ids))
    union
    select s.id,c.reporting_location_id,s.machine_label,l.name from components c
    join scope s on s.id=c.reporting_machine_id join public.reporting_locations l on l.id=c.reporting_location_id
  ), machine_rows as (
    select d.machine_id as "machineId",d.machine_label as "machineLabel",d.location_id as "locationId",d.location_name as "locationName",
      a.recorded_sales as "recordedSalesCents",a.card_sales as "cardRecordedSalesCents",a.cash_sales as "cashRecordedSalesCents",a.other_sales as "otherRecordedSalesCents",
      a.sales_ex_tax as "salesExTaxCents",a.reporting_tax as "reportingTaxRemovedCents",
      case when restricted.present then null else a.request_deduction end as "requestedDeductionExTaxCents",
      case when restricted.present then null else a.reversal end as "reversalExTaxCents",
      case when restricted.present then null else a.legacy_deduction end as "legacyPaidDeductionExTaxCents",
      case when restricted.present then null else a.net_sales end as "netSalesExTaxCents",
      paid.amount_cents as "moneyPaidCents",
      (r.payload#>>'{period,giftPurchaseCents}')::bigint as "giftPurchaseCents",
      (r.payload#>>'{period,giftFaceCents}')::bigint as "giftFaceCents",
      (r.payload#>>'{period,goodwillCents}')::bigint as "goodwillCents",
      (r.payload#>>'{cohort,requestedCents}')::bigint as "requestedCents",
      (r.payload#>>'{cohort,requestCount}')::bigint as "requestCount",
      (r.payload#>>'{asOf,outstandingCents}')::bigint as "asOfOutstandingCents",
      (r.payload#>>'{asOf,openRequestCount}')::bigint as "openRequestCount",
      jsonb_build_object('unknownAmountCount',(r.payload#>>'{cohort,unknownAmountCount}')::bigint,
        'unknownBalanceCount',(r.payload#>>'{asOf,unknownBalanceCount}')::bigint,
        'unknownRequestDateCount',(r.payload#>>'{coverage,unknownRequestDateCount}')::bigint,
        'unknownPaymentDateCount',(r.payload#>>'{coverage,unknownPaymentDateCount}')::bigint,
        'unresolvedSalesCount',a.unresolved_sales,'unresolvedRefundCount',case when restricted.present then greatest(a.unresolved_refunds,1) else a.unresolved_refunds end,
        'estimatedComponentCount',a.estimated_count) as coverage
    from dimensions d
    cross join lateral (
      -- The shared function groups away case IDs. If an inconsistent backlink
      -- crosses this caller's scope (or belongs to a test), do not recompute its
      -- accounting in another ledger or expose its tax basis through totals.
      select exists(
        select 1 from public.sales_adjustment_facts f
        join public.refund_cases c on c.id=f.refund_case_id or (f.refund_case_id is null and c.reporting_adjustment_id=f.id)
        where f.reporting_machine_id=d.machine_id and f.reporting_location_id=d.location_id
          and f.adjustment_date between p_date_from and p_date_to
          and f.adjustment_type in ('refund','complaint_refund') and f.amount_cents>0
          and (c.case_population<>'customer' or not exists(select 1 from private.finance_reporting_machine_scope(auth.uid()) s where s.id=c.reporting_machine_id))
      ) or exists(
        select 1 from private.refund_request_recognition_events e join public.refund_cases c on c.id=e.refund_case_id
        where e.reporting_machine_id=d.machine_id and e.reporting_location_id=d.location_id
          and e.booking_date between p_date_from and p_date_to
          and (c.case_population<>'customer' or not exists(select 1 from private.finance_reporting_machine_scope(auth.uid()) s where s.id=c.reporting_machine_id))
      ) as present
    ) restricted
    cross join lateral (
      select coalesce(sum(c.recorded_sales_cents),0)::bigint as recorded_sales,
        coalesce(sum(c.recorded_sales_cents) filter(where c.tender='card'),0)::bigint as card_sales,
        coalesce(sum(c.recorded_sales_cents) filter(where c.tender='cash'),0)::bigint as cash_sales,
        coalesce(sum(c.recorded_sales_cents) filter(where c.tender not in ('card','cash')),0)::bigint as other_sales,
        case when bool_or(c.sales_ex_tax_cents is null) then null else coalesce(sum(c.sales_ex_tax_cents),0)::bigint end as sales_ex_tax,
        case when bool_or(c.sales_tax_cents is null) then null else coalesce(sum(c.sales_tax_cents),0)::bigint end as reporting_tax,
        case when bool_or(c.request_deduction_ex_tax_cents is null) then null else coalesce(sum(c.request_deduction_ex_tax_cents),0)::bigint end as request_deduction,
        case when bool_or(c.refund_reversal_ex_tax_cents is null) then null else coalesce(sum(c.refund_reversal_ex_tax_cents),0)::bigint end as reversal,
        case when bool_or(c.legacy_paid_deduction_ex_tax_cents is null) then null else coalesce(sum(c.legacy_paid_deduction_ex_tax_cents),0)::bigint end as legacy_deduction,
        case when bool_or(c.commissionable_sales_ex_tax_cents is null) then null else coalesce(sum(c.commissionable_sales_ex_tax_cents),0)::bigint end as net_sales,
        coalesce(sum(c.unresolved_sales_count),0)::bigint as unresolved_sales,
        coalesce(sum(c.unresolved_refund_count),0)::bigint as unresolved_refunds,
        count(*) filter(where c.normalization_status='estimated') as estimated_count
      from components c where c.reporting_machine_id=d.machine_id and c.reporting_location_id=d.location_id
    ) a
    cross join lateral (
      -- Includes independent legacy payment facts as well as case-linked money.
      -- This is recorded activity, not bank settlement. Never inspect customer
      -- details or allow a backlink into an unauthorized machine's case.
      select coalesce(sum(f.amount_cents),0)::bigint as amount_cents
      from public.sales_adjustment_facts f
      left join public.refund_cases c on c.id=f.refund_case_id
      where f.reporting_machine_id=d.machine_id and f.reporting_location_id=d.location_id
        and f.adjustment_date between p_date_from and p_date_to
        and f.adjustment_type in ('refund','complaint_refund') and f.amount_cents>0
        and coalesce(c.case_population,'customer')='customer'
        and (c.id is null or exists(select 1 from private.finance_reporting_machine_scope(auth.uid()) s where s.id=c.reporting_machine_id))
        and not exists(select 1 from public.refund_cases backlink where f.refund_case_id is null
          and backlink.reporting_adjustment_id=f.id and (backlink.case_population<>'customer'
            or not exists(select 1 from private.finance_reporting_machine_scope(auth.uid()) s where s.id=backlink.reporting_machine_id)))
    ) paid
    cross join lateral (select public.get_refund_analytics(p_date_from,p_date_to,array[d.machine_id],array[d.location_id]) as payload) r
  )
  select jsonb_build_object('calculationVersion','finance-reporting-v1','generatedAt',statement_timestamp(),
    'dateFrom',p_date_from,'dateTo',p_date_to,'dateBasis','Machine-local business dates; inclusive period. Requests use immutable booking dates; money uses recorded payment dates; outstanding is as of period end.',
    'rows',coalesce(jsonb_agg(to_jsonb(m) order by m."machineLabel",m."locationName"),'[]'::jsonb)) into result from machine_rows m;
  return result;
end;
$$;
revoke all on function public.get_finance_reporting(date,date,uuid[],uuid[]) from public,anon;
grant execute on function public.get_finance_reporting(date,date,uuid[],uuid[]) to authenticated;
comment on function public.get_finance_reporting(date,date,uuid[],uuid[]) is
  'Read-only intersection of existing sales and refund scope. Canonical requested-basis accounting, recorded money and gifts are distinct. Reporting tax removed is a calculation adjustment, not proof of tax collected or legally owed. No bank settlement or gift redemption is inferred. Null accounting values and explicit coverage counts preserve missing evidence.';
select pg_notify('pgrst','reload schema');
