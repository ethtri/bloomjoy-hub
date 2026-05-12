create or replace function public.admin_get_refund_manager_setup()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  actor_user_id uuid;
  result jsonb;
begin
  actor_user_id := auth.uid();

  if actor_user_id is null then
    raise exception 'Authentication required';
  end if;

  if not public.is_super_admin(actor_user_id) and not public.is_scoped_admin(actor_user_id) then
    raise exception 'Machine setup access required';
  end if;

  select jsonb_build_object(
    'machines', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', machine.id,
          'machineLabel', machine.machine_label,
          'locationName', location.name,
          'nayaxLookupConfigured',
            machine.nayax_machine_id is not null and btrim(machine.nayax_machine_id) <> '',
          'managerEmails', coalesce((
            select jsonb_agg(manager.manager_email order by manager.manager_email)
            from public.reporting_machine_refund_managers manager
            where manager.reporting_machine_id = machine.id
              and manager.status = 'active'
              and manager.revoked_at is null
          ), '[]'::jsonb)
        )
        order by location.name, machine.machine_label
      )
      from public.reporting_machines machine
      join public.reporting_locations location on location.id = machine.location_id
      where machine.status = 'active'
        and public.can_manage_refund_machine(actor_user_id, machine.id)
    ), '[]'::jsonb)
  )
  into result;

  return result;
end;
$$;

comment on function public.admin_get_refund_manager_setup() is
  'Machine-level refund manager setup data without refund case/customer payloads.';

revoke execute on function public.admin_get_refund_manager_setup() from public;
revoke execute on function public.admin_get_refund_manager_setup() from anon;
grant execute on function public.admin_get_refund_manager_setup() to authenticated;
