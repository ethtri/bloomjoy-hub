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
      select max(fact.sale_date)
      from public.machine_sales_facts fact
      join accessible_machines machine on machine.id = fact.reporting_machine_id
    ) as latest_sale_date,
    (
      select max(run.completed_at)
      from public.sales_import_runs run
      where run.status = 'completed'
    ) as latest_import_completed_at;
end;
$function$
;
