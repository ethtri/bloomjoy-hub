-- Keep internal placeholder locations out of the public refund selector.
--
-- Machines assigned to a temporary internal location can still participate in
-- the controlled pilot. Their customer-facing machine label becomes the public
-- location label until the canonical reporting location is repaired.

create or replace function public.public_refund_machine_options()
returns table (
  machine_id uuid,
  machine_label text,
  location_id uuid,
  location_name text,
  location_timezone text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    machine.id as machine_id,
    coalesce(nullif(trim(machine.refund_public_display_label), ''), machine.machine_label) as machine_label,
    location.id as location_id,
    case
      when lower(trim(location.name)) like 'unmapped %'
        or lower(trim(location.name)) like 'unknown %'
        or lower(trim(location.name)) in ('unmapped', 'unknown')
      then trim(machine.refund_public_display_label)
      else location.name
    end as location_name,
    location.timezone as location_timezone
  from public.reporting_machines machine
  join public.reporting_locations location on location.id = machine.location_id
  where machine.status = 'active'
    and machine.machine_type in ('commercial', 'mini')
    and machine.refund_intake_enabled = true
    and location.status = 'active'
    and (
      not (
        lower(trim(location.name)) like 'unmapped %'
        or lower(trim(location.name)) like 'unknown %'
        or lower(trim(location.name)) in ('unmapped', 'unknown')
      )
      or nullif(trim(machine.refund_public_display_label), '') is not null
    )
  order by
    case
      when lower(trim(location.name)) like 'unmapped %'
        or lower(trim(location.name)) like 'unknown %'
        or lower(trim(location.name)) in ('unmapped', 'unknown')
      then trim(machine.refund_public_display_label)
      else location.name
    end,
    coalesce(nullif(trim(machine.refund_public_display_label), ''), machine.machine_label);
$$;

comment on function public.public_refund_machine_options() is
  'Public noindex refund intake selector. Exposes only enabled Commercial/Mini machines and requires an explicit customer-facing label before a placeholder location can be shown.';

select pg_notify('pgrst', 'reload schema');
