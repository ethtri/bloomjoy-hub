-- Keep internal placeholder location names out of the Refund Operations workbench.
-- The original overview remains private and this wrapper rewrites only labels.

alter function public.admin_get_refund_operations_overview()
  rename to admin_get_refund_operations_overview_raw_20260721;

revoke all on function public.admin_get_refund_operations_overview_raw_20260721()
  from public, anon, authenticated;

create function public.admin_get_refund_operations_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  raw_result jsonb;
  safe_cases jsonb;
  safe_machines jsonb;
begin
  raw_result := public.admin_get_refund_operations_overview_raw_20260721();

  select coalesce(jsonb_agg(
    case_item || jsonb_build_object(
      'machineLabel', coalesce(
        nullif(trim(machine.refund_public_display_label), ''),
        machine.machine_label
      ),
      'locationName', case
        when lower(trim(location.name)) like 'unmapped %'
          or lower(trim(location.name)) like 'unknown %'
          or lower(trim(location.name)) in ('unmapped', 'unknown')
        then coalesce(nullif(trim(machine.refund_public_display_label), ''), 'Bloomjoy location')
        else location.name
      end
    )
    order by case_ordinality
  ), '[]'::jsonb)
  into safe_cases
  from jsonb_array_elements(coalesce(raw_result -> 'cases', '[]'::jsonb))
    with ordinality as cases(case_item, case_ordinality)
  join public.refund_cases refund_case on refund_case.id = (case_item ->> 'id')::uuid
  join public.reporting_machines machine on machine.id = refund_case.reporting_machine_id
  join public.reporting_locations location on location.id = refund_case.reporting_location_id;

  select coalesce(jsonb_agg(
    machine_item || jsonb_build_object(
      'machineLabel', coalesce(
        nullif(trim(machine.refund_public_display_label), ''),
        machine.machine_label
      ),
      'locationName', case
        when lower(trim(location.name)) like 'unmapped %'
          or lower(trim(location.name)) like 'unknown %'
          or lower(trim(location.name)) in ('unmapped', 'unknown')
        then coalesce(nullif(trim(machine.refund_public_display_label), ''), 'Bloomjoy location')
        else location.name
      end
    )
    order by machine_ordinality
  ), '[]'::jsonb)
  into safe_machines
  from jsonb_array_elements(coalesce(raw_result -> 'machines', '[]'::jsonb))
    with ordinality as machines(machine_item, machine_ordinality)
  join public.reporting_machines machine on machine.id = (machine_item ->> 'id')::uuid
  join public.reporting_locations location on location.id = machine.location_id;

  return jsonb_set(
    jsonb_set(raw_result, '{cases}', safe_cases, true),
    '{machines}',
    safe_machines,
    true
  );
end;
$$;

revoke all on function public.admin_get_refund_operations_overview() from public, anon;
grant execute on function public.admin_get_refund_operations_overview() to authenticated;

comment on function public.admin_get_refund_operations_overview() is
  'Refund Operations overview with customer-safe machine and location labels.';

select pg_notify('pgrst', 'reload schema');
