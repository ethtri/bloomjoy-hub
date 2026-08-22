-- Restore the customer intake boundary after the Nayax inventory rollout.
--
-- Asking Bloomjoy for help is intentionally broader than automatic payment
-- readiness. Active Commercial/Mini machines with a customer-safe location,
-- plus explicitly classified Snapcase machines, remain available in the form.
-- Exact inventory mapping, manager routing, approval, caps, and the execution
-- kill switch continue to gate the actual Nayax refund.

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
          and inventory.refund_category = 'snapcase'
          and inventory.reconciliation_state <> 'excluded'
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
  'Public noindex refund intake selector. Active customer-safe portfolio visibility is independent of automatic Nayax payment readiness; Snapcase remains explicitly classified by inventory.';

revoke execute on function public.public_refund_machine_options() from public;
grant execute on function public.public_refund_machine_options() to anon, authenticated;

create or replace function public.service_refund_machine_is_public(p_machine_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.public_refund_machine_options() option
    where option.machine_id = p_machine_id
  );
$$;

revoke execute on function public.service_refund_machine_is_public(uuid) from public, anon, authenticated;
grant execute on function public.service_refund_machine_is_public(uuid) to service_role;

-- These two launch-reconciliation explanations describe missing setup, not a
-- business decision to exclude a machine. Reopen only rows with those exact
-- reviewed explanations; all other explicit exclusions remain untouched.
update public.refund_nayax_machine_inventory inventory
set
  reconciliation_state = 'needs_setup',
  setup_reason = case
    when inventory.reporting_machine_id is null then 'exact_mapping_required'
    when inventory.refund_category is null then 'refund_category_required'
    else 'refund_automation_not_enabled'
  end,
  exclusion_reason = null,
  decision_reason = 'Corrected launch reconciliation: setup gaps are not exclusions.',
  decided_by = null,
  decided_at = now(),
  updated_at = now()
where inventory.provider_is_active
  and inventory.reconciliation_state = 'excluded'
  and inventory.exclusion_reason in (
    'No exact Bloomjoy reporting-machine record exists for this immutable Nayax ID; excluded until location and manager route are verified.',
    'Not selected for the v1 monitored pilot; exact location and manager route require verification.'
  );

select pg_notify('pgrst', 'reload schema');
