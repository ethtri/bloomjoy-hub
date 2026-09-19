-- Keep customer intake eligibility tied to the reviewed refund inventory product
-- category. A reporting machine family may be changed for operations such as
-- timekeeping without changing the product sold or hiding a published refund
-- route from customers.

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
    and location.status = 'active'
    and (
      (
        machine.machine_type in ('commercial', 'mini')
        and not exists (
          select 1
          from public.refund_nayax_machine_inventory blocked_inventory
          where blocked_inventory.reporting_machine_id = machine.id
            and (
              blocked_inventory.reconciliation_state = 'excluded'
              or not blocked_inventory.provider_is_active
              or blocked_inventory.missing_successful_snapshots >= 2
            )
        )
      )
      or exists (
        select 1
        from public.refund_nayax_machine_inventory inventory
        where inventory.reporting_machine_id = machine.id
          and inventory.provider_is_active
          and inventory.missing_successful_snapshots < 2
          and (
            (
              inventory.refund_category in ('cotton_candy', 'snapcase')
              and inventory.reconciliation_state <> 'excluded'
            )
            or (
              inventory.refund_category = 'unknown'
              and inventory.reconciliation_state = 'published'
            )
          )
      )
    )
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
  'Public noindex refund intake selector. Customer-safe portfolio visibility follows reviewed refund inventory product categories independently of operational reporting-machine family; payment readiness remains separately gated.';

revoke execute on function public.public_refund_machine_options() from public;
grant execute on function public.public_refund_machine_options() to anon, authenticated;
