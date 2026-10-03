-- #1696: preserve the complete Finance scope while bounding dimension work.
create or replace function public.get_finance_reporting_access()
returns jsonb language sql stable security definer set search_path='' as $$

  with allowed as materialized (
    select id from private.finance_reporting_machine_scope(auth.uid())
  ), dimensions as (
    select m.id as "machineId",m.machine_label as "machineLabel",l.id as "locationId",l.name as "locationName"
    from allowed s
    join public.reporting_machines m on m.id=s.id join public.reporting_locations l on l.id=m.location_id
    union
    select m.id,m.machine_label,l.id,l.name
    from allowed s
    join public.reporting_machines m on m.id=s.id
    join public.refund_cases c on c.reporting_machine_id=m.id and c.case_population='customer'
    join public.reporting_locations l on l.id=c.reporting_location_id
    union
    select m.id,m.machine_label,l.id,l.name
    from allowed s
    join public.reporting_machines m on m.id=s.id
    join (
      -- Many sales share one historical placement. Deduplicate the scoped keys
      -- before joining names instead of expanding every sale into a dimension.
      select distinct f.reporting_machine_id,f.reporting_location_id
      from public.machine_sales_facts f join allowed a on a.id=f.reporting_machine_id
    ) f on f.reporting_machine_id=m.id
    join public.reporting_locations l on l.id=f.reporting_location_id
    union
    select m.id,m.machine_label,l.id,l.name
    from allowed s join public.reporting_machines m on m.id=s.id
    join public.sales_adjustment_facts f on f.reporting_machine_id=m.id
    join public.reporting_locations l on l.id=f.reporting_location_id
    left join public.refund_cases c on c.id=f.refund_case_id
    where f.adjustment_type in ('refund','complaint_refund') and f.amount_cents>0
      and coalesce(c.case_population,'customer')='customer'
      and (c.id is null or exists(select 1 from allowed a where a.id=c.reporting_machine_id))
      and not exists(select 1 from public.refund_cases backlink where f.refund_case_id is null
        and backlink.reporting_adjustment_id=f.id and (backlink.case_population<>'customer'
          or not exists(select 1 from allowed a where a.id=backlink.reporting_machine_id)))
    union
    select m.id,m.machine_label,l.id,l.name
    from allowed s join public.reporting_machines m on m.id=s.id
    join private.refund_request_recognition_events e on e.reporting_machine_id=m.id
    join public.reporting_locations l on l.id=e.reporting_location_id
    join public.refund_cases c on c.id=e.refund_case_id and c.case_population='customer'
    where exists(select 1 from allowed a where a.id=c.reporting_machine_id)
  )
  select jsonb_build_object('hasAccess',exists(select 1 from dimensions),
    'dimensions',coalesce(jsonb_agg(to_jsonb(d) order by d."machineLabel",d."locationName"),'[]'::jsonb))
  from dimensions d;

$$;
revoke all on function public.get_finance_reporting_access() from public,anon;
grant execute on function public.get_finance_reporting_access() to authenticated;
select pg_notify('pgrst','reload schema');

