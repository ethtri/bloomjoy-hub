-- #1576 / #1696. Read-only aggregates; sales access never grants refund access.
create function private.refund_analytics_machine_scope(p_actor uuid)
returns table(id uuid) language sql stable security definer set search_path='' as $$
  select m.id from public.reporting_machines m
  where p_actor is not null and (
    exists(select 1 from public.admin_roles r where r.user_id=p_actor
      and r.role='super_admin' and r.active)
    or exists(select 1 from public.reporting_machine_refund_managers r
      where r.reporting_machine_id=m.id and r.manager_user_id=p_actor
        and r.status='active' and r.revoked_at is null));
$$;
revoke all on function private.refund_analytics_machine_scope(uuid) from public,anon,authenticated;

create function public.get_refund_analytics_access()
returns jsonb language sql stable security definer set search_path='' as $$
  with dimensions as (
    select m.id as "machineId",m.machine_label as "machineLabel",l.id as "locationId",l.name as "locationName"
    from private.refund_analytics_machine_scope(auth.uid()) s
    join public.reporting_machines m on m.id=s.id
    join public.reporting_locations l on l.id=m.location_id
    union
    select m.id,m.machine_label,l.id,l.name
    from private.refund_analytics_machine_scope(auth.uid()) s
    join public.reporting_machines m on m.id=s.id
    join public.refund_cases c on c.reporting_machine_id=m.id and c.case_population='customer'
    join public.reporting_locations l on l.id=c.reporting_location_id
  )
  select jsonb_build_object('hasAccess', exists(select 1 from dimensions),
    'dimensions',coalesce(jsonb_agg(to_jsonb(d) order by d."machineLabel",d."locationName"),'[]'::jsonb))
  from dimensions d;
$$;
revoke all on function public.get_refund_analytics_access() from public,anon;
grant execute on function public.get_refund_analytics_access() to authenticated;

create function public.get_refund_analytics(
  p_date_from date, p_date_to date,
  p_machine_ids uuid[] default null, p_location_ids uuid[] default null
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  if auth.uid() is null or not exists(select 1 from private.refund_analytics_machine_scope(auth.uid())) then
    raise exception 'Refund manager access required' using errcode='42501';
  end if;
  if p_date_from is null or p_date_to is null or p_date_from>p_date_to
    or p_date_to-p_date_from>366 then
    raise exception 'Choose a valid reporting period of up to 367 days' using errcode='22023';
  end if;
  with recursive scope as materialized (
    select m.id,m.machine_label,m.location_id,l.name as location_name,l.timezone
    from private.refund_analytics_machine_scope(auth.uid()) allowed
    join public.reporting_machines m on m.id=allowed.id
    join public.reporting_locations l on l.id=m.location_id
    where (p_machine_ids is null or m.id=any(p_machine_ids))
  ), roots as materialized (
    select c.id,c.reporting_machine_id,c.reporting_location_id,c.issue_category,c.customer_request_received_at,
      c.reporting_adjustment_id,s.machine_label,cl.name as location_name,cl.timezone,
      (c.customer_request_received_at at time zone cl.timezone)::date as request_date
    from public.refund_cases c join scope s on s.id=c.reporting_machine_id
    join public.reporting_locations cl on cl.id=c.reporting_location_id
    where c.case_population='customer' and c.duplicate_of_refund_case_id is null
      and (p_location_ids is null or c.reporting_location_id=any(p_location_ids))
      and (c.customer_request_received_at is null
        or (c.customer_request_received_at at time zone cl.timezone)::date<=p_date_to)
  ), lineage as (
    select r.id as root_id,r.id,r.reporting_adjustment_id,r.reporting_machine_id,array[r.id]::uuid[] as path from roots r
    union all
    select l.root_id,c.id,c.reporting_adjustment_id,c.reporting_machine_id,l.path||c.id
    from lineage l join public.refund_cases c on c.duplicate_of_refund_case_id=l.id
    -- Only actual duplicate lineage; independent claims on one purchase remain separate.
    where c.case_population='customer' and not c.id=any(l.path)
  ), payments as materialized (
    select l.root_id,a.id,a.amount_cents,a.adjustment_date from lineage l
    join public.sales_adjustment_facts a on a.refund_case_id=l.id
      or (a.refund_case_id is null and a.id=l.reporting_adjustment_id)
    where a.adjustment_type in ('refund','complaint_refund') and a.amount_cents>0
      and exists(select 1 from scope s where s.id=l.reporting_machine_id)
      and exists(select 1 from scope s where s.id=a.reporting_machine_id)
  ), gifts as materialized (
    select l.root_id,i.purchase_amount_cents,i.face_value_cents,i.goodwill_amount_cents,
      (i.issued_at at time zone cl.timezone)::date as issue_date
    from lineage l join roots r on r.id=l.root_id
    join public.refund_gift_card_issuances i on i.refund_case_id=l.id
    join public.refund_cases child on child.id=l.id
    join public.reporting_locations cl on cl.id=child.reporting_location_id
    where exists(select 1 from scope s where s.id=l.reporting_machine_id)
  ), cases as materialized (
    select r.*,
      opening.request_target_after_cents as requested_cents,
      latest.request_target_after_cents as target_cents,
      latest.id is not null as has_history,
      coalesce(paid.as_of_cents,0)::bigint as paid_cents,
      case when exists(select 1 from lineage l where l.root_id=r.id
        and not exists(select 1 from scope s where s.id=l.reporting_machine_id))
        or exists(select 1 from lineage l join public.sales_adjustment_facts a
          on a.refund_case_id=l.id or (a.refund_case_id is null and a.id=l.reporting_adjustment_id)
          where l.root_id=r.id and a.adjustment_type in ('refund','complaint_refund')
            and a.amount_cents>0 and a.adjustment_date<=p_date_to
            and not exists(select 1 from scope s where s.id=a.reporting_machine_id)) then null
        else private.refund_gift_card_resolved_purchase_cents(r.id,p_date_to) end as gift_cents,
      coalesce(paid.period_cents,0)::bigint as period_paid_cents,
      coalesce(gift.period_purchase_cents,0)::bigint as period_gift_cents,
      coalesce(gift.period_face_cents,0)::bigint as period_face_cents,
      coalesce(gift.period_goodwill_cents,0)::bigint as period_goodwill_cents
      ,exists(select 1 from lineage l join public.refund_authoritative_receipts receipt
        on receipt.refund_case_id=l.id where l.root_id=r.id
        and (receipt.observed_at at time zone r.timezone)::date<=p_date_to
        and receipt.settled_at is null and coalesce(paid.as_of_cents,0)<receipt.refunded_amount_cents
      ) as undated_payment
    from roots r
    left join lateral (
      select e.request_target_after_cents from private.refund_request_recognition_events e
      where e.refund_case_id=r.id and e.event_kind in ('request_received','late_request_opening')
        and e.booking_date<=p_date_to
      order by e.recorded_at,e.id limit 1
    ) opening on true
    left join lateral (
      select e.id,e.request_target_after_cents from private.refund_request_recognition_events e
      where e.refund_case_id=r.id and e.booking_date<=p_date_to
      order by e.effective_at desc,e.recorded_at desc,e.id desc limit 1
    ) latest on true
    left join lateral (
      select sum(p.amount_cents) filter(where p.adjustment_date<=p_date_to) as as_of_cents,
        sum(p.amount_cents) filter(where p.adjustment_date between p_date_from and p_date_to) as period_cents
      from payments p where p.root_id=r.id
    ) paid on true
    left join lateral (
      select sum(g.purchase_amount_cents) as period_purchase_cents,
        sum(g.face_value_cents) as period_face_cents,sum(g.goodwill_amount_cents) as period_goodwill_cents
      from gifts g where g.root_id=r.id and g.issue_date between p_date_from and p_date_to
    ) gift on true
  ), balances as materialized (
    select c.*,case when c.has_history and c.target_cents is not null and c.gift_cents is not null and not c.undated_payment
      then greatest(c.target_cents-c.paid_cents-c.gift_cents,0) end as outstanding_cents
    from cases c
  ), accounting as materialized (
    select d.* from scope s cross join lateral
      private.machine_sales_daily_components(s.id,p_date_from,p_date_to) d
    where p_location_ids is null or d.reporting_location_id=any(p_location_ids)
  ), machine_rows as (
    select b.reporting_machine_id as "machineId",b.machine_label as "machineLabel",
      b.reporting_location_id as "locationId",b.location_name as "locationName",
      count(*) filter(where b.request_date between p_date_from and p_date_to) as "requestCount",
      coalesce(sum(b.requested_cents) filter(where b.request_date between p_date_from and p_date_to),0) as "requestedCents",
      count(*) filter(where b.request_date between p_date_from and p_date_to and b.requested_cents is null) as "unknownAmountCount",
      coalesce(sum(b.outstanding_cents),0) as "outstandingCents",
      count(*) filter(where b.outstanding_cents is null) as "unknownBalanceCount"
    from balances b group by b.reporting_machine_id,b.machine_label,b.reporting_location_id,b.location_name
  ), category_rows as (
    select b.issue_category as category,count(*) as "requestCount",
      coalesce(sum(b.requested_cents),0) as "requestedCents",
      count(*) filter(where b.requested_cents is null) as "unknownAmountCount"
    from balances b where b.request_date between p_date_from and p_date_to group by b.issue_category
  ), aging_rows as (
    select case when b.request_date is null then 'Unknown request date'
      when p_date_to-b.request_date<1 then 'Same business date'
      when p_date_to-b.request_date<=3 then '1–3 days'
      when p_date_to-b.request_date<=7 then '4–7 days'
      when p_date_to-b.request_date<=30 then '8–30 days' else 'Over 30 days' end as band,
      count(*) as "requestCount",coalesce(sum(b.outstanding_cents),0) as "outstandingCents",
      count(*) filter(where b.outstanding_cents is null) as "unknownBalanceCount"
    from balances b where b.outstanding_cents>0 or b.outstanding_cents is null group by 1
  )
  select jsonb_build_object(
    'calculationVersion','refund-analytics-v1','generatedAt',statement_timestamp(),
    'dateFrom',p_date_from,'dateTo',p_date_to,'dateBasis','Machine-local business dates; inclusive period',
    'machineCount',(select count(distinct reporting_machine_id) from roots),
    'cohort',jsonb_build_object(
      'requestCount',count(*) filter(where b.request_date between p_date_from and p_date_to),
      'requestedCents',coalesce(sum(b.requested_cents) filter(where b.request_date between p_date_from and p_date_to),0),
      'unknownAmountCount',count(*) filter(where b.request_date between p_date_from and p_date_to and b.requested_cents is null),
      'resolvedCashCents',coalesce(sum(b.paid_cents) filter(where b.request_date between p_date_from and p_date_to),0),
      'resolvedGiftPurchaseCents',coalesce(sum(b.gift_cents) filter(where b.request_date between p_date_from and p_date_to),0),
      'outstandingCents',coalesce(sum(b.outstanding_cents) filter(where b.request_date between p_date_from and p_date_to),0)),
    'period',jsonb_build_object('cashPaidCents',coalesce(sum(b.period_paid_cents),0),
      'giftPurchaseCents',coalesce(sum(b.period_gift_cents),0),'giftFaceCents',coalesce(sum(b.period_face_cents),0),
      'goodwillCents',coalesce(sum(b.period_goodwill_cents),0),
      'requestDeductionExTaxCents',(select coalesce(sum(request_deduction_ex_tax_cents),0) from accounting),
      'reversalExTaxCents',(select coalesce(sum(refund_reversal_ex_tax_cents),0) from accounting),
      'legacyPaidDeductionExTaxCents',(select coalesce(sum(legacy_paid_deduction_ex_tax_cents),0) from accounting),
      'unresolvedAccountingCount',(select coalesce(sum(unresolved_refund_count),0) from accounting)),
    'asOf',jsonb_build_object('outstandingCents',coalesce(sum(b.outstanding_cents),0),
      'openRequestCount',count(*) filter(where b.outstanding_cents>0),
      'unknownBalanceCount',count(*) filter(where b.outstanding_cents is null)),
    'coverage',jsonb_build_object('unknownRequestDateCount',count(*) filter(where b.request_date is null),
      'unknownPaymentDateCount',(select count(*) from public.refund_authoritative_receipts receipt
        join lineage l on l.id=receipt.refund_case_id join roots r on r.id=l.root_id
        where exists(select 1 from scope s where s.id=l.reporting_machine_id)
          and (receipt.observed_at at time zone r.timezone)::date<=p_date_to and receipt.settled_at is null)),
    'machines',(select coalesce(jsonb_agg(to_jsonb(m) order by m."machineLabel"),'[]'::jsonb) from machine_rows m),
    'categories',(select coalesce(jsonb_agg(to_jsonb(c) order by c."requestCount" desc,c.category),'[]'::jsonb) from category_rows c),
    'aging',(select coalesce(jsonb_agg(to_jsonb(a)),'[]'::jsonb) from aging_rows a)
  ) into result from balances b;
  return result;
end;
$$;
revoke all on function public.get_refund_analytics(date,date,uuid[],uuid[]) from public,anon;
grant execute on function public.get_refund_analytics(date,date,uuid[],uuid[]) to authenticated;
comment on function public.get_refund_analytics(date,date,uuid[],uuid[]) is
  'Read-only manager-scoped analytics. Immutable request history determines as-of targets; missing history is unknown. Cash/gift recovery is context, never another deduction. No customer or card data is returned.';
