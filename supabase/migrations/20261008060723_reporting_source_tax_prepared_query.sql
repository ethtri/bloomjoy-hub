-- #1824: reuse the exact dated-source lookup plan for inclusive/unknown tax
-- paths. Keep evidence priority, date/account matching, missing-machine row
-- cardinality and all access/normalization contracts unchanged.
CREATE OR REPLACE FUNCTION private.resolve_reporting_machine_source_tax(p_machine_id uuid, p_sale_date date)
 RETURNS TABLE(rate_percent numeric, source text, coverage_status text, observed_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER ROWS 1
 SET search_path TO ''
AS $function$
begin
 return query
  select case when observation.classification = 'verified_tax' then observation.rate_percent end,
    observation.source,
    coalesce(observation.classification,'missing'),
    observation.observed_at
  from public.reporting_machines machine
  left join lateral (
    select evidence.* from private.nayax_machine_tax_observations evidence
    where evidence.account_key = upper(coalesce(machine.nayax_account_key,'TGPACI_USA_DB'))
      and evidence.nayax_machine_id = btrim(machine.nayax_machine_id)
      and evidence.effective_start_date <= p_sale_date
      and coalesce(evidence.effective_end_date,'infinity'::date) >= p_sale_date
    order by (evidence.classification <> 'unavailable') desc,
      evidence.effective_start_date desc,evidence.observed_at desc,evidence.id
    limit 1
  ) observation on true
  where machine.id = p_machine_id;
end;
$function$;

-- Preserve all access fields; seek the latest raw date for each authorized
-- machine using its existing machine/date index before computing the maximum.
CREATE OR REPLACE FUNCTION public.get_my_reporting_access_context()
 RETURNS TABLE(has_reporting_access boolean, accessible_machine_count bigint, accessible_location_count bigint, can_manage_reporting boolean, latest_sale_date date, latest_import_completed_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  current_user_id uuid;
  current_scoped_machine_ids uuid[];
begin
  current_user_id := auth.uid();

  if current_user_id is null then
    raise exception 'Authentication required';
  end if;

  current_scoped_machine_ids := public.scoped_admin_machine_ids(current_user_id);

  return query
  with accessible_machines as (
    select machine.id, machine.location_id
    from public.reporting_machines machine
    where public.has_reporting_machine_access(current_user_id, machine.id)
  )
  select
    exists (select 1 from accessible_machines) as has_reporting_access,
    (select count(*) from accessible_machines)::bigint as accessible_machine_count,
    (select count(distinct location_id) from accessible_machines)::bigint
      as accessible_location_count,
    (
      public.is_super_admin(current_user_id)
      or coalesce(array_length(current_scoped_machine_ids, 1), 0) > 0
    ) as can_manage_reporting,
    (
      select max(latest.sale_date)
      from accessible_machines machine
      cross join lateral (
        select fact.sale_date from public.machine_sales_facts fact
        where fact.reporting_machine_id = machine.id
        order by fact.sale_date desc limit 1
      ) latest
    ) as latest_sale_date,
    (
      select max(run.completed_at)
      from public.sales_import_runs run
      where run.status = 'completed'
    ) as latest_import_completed_at;
end;
$function$;
