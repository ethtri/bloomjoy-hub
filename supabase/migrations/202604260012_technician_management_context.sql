-- Customer portal helper for Plus Account Owner Technician management.
--
-- This intentionally exposes only the signed-in owner's own Plus accounts and
-- active reporting machines. Super-admin override remains a backend capability,
-- not a broad customer-portal account picker.

drop function if exists public.get_my_technician_management_context();

create or replace function public.get_my_technician_management_context()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  current_user_id uuid;
  result jsonb;
begin
  current_user_id := auth.uid();

  if current_user_id is null then
    raise exception 'Authentication required';
  end if;

  with owner_accounts as (
    select
      account.id,
      account.name,
      account.status,
      public.count_active_technician_grants(account.id) as active_seat_count
    from public.customer_account_memberships membership
    join public.customer_accounts account on account.id = membership.account_id
    where membership.user_id = current_user_id
      and membership.active
      and membership.role = 'owner'
      and account.status = 'active'
      and public.has_plus_access(current_user_id)
  ),
  account_payloads as (
    select
      owner_accounts.name as account_name,
      jsonb_build_object(
        'accountId', owner_accounts.id,
        'accountName', owner_accounts.name,
        'accountStatus', owner_accounts.status,
        'seatCap', 10,
        'activeSeatCount', owner_accounts.active_seat_count,
        'machineCount', (
          select count(*)::integer
          from public.reporting_machines machine
          where machine.account_id = owner_accounts.id
            and machine.status = 'active'
        ),
        'machines', coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'machineId', machine.id,
              'machineLabel', machine.machine_label,
              'machineType', machine.machine_type,
              'locationId', location.id,
              'locationName', location.name,
              'status', machine.status
            )
            order by location.name, machine.machine_label, machine.id
          )
          from public.reporting_machines machine
          join public.reporting_locations location on location.id = machine.location_id
          where machine.account_id = owner_accounts.id
            and machine.status = 'active'
        ), '[]'::jsonb)
      ) as payload
    from owner_accounts
  )
  select jsonb_build_object(
    'canManage', exists (select 1 from owner_accounts),
    'seatCap', 10,
    'accounts', coalesce(
      jsonb_agg(account_payloads.payload order by account_payloads.account_name),
      '[]'::jsonb
    )
  )
  into result
  from account_payloads;

  return coalesce(
    result,
    jsonb_build_object(
      'canManage', false,
      'seatCap', 10,
      'accounts', '[]'::jsonb
    )
  );
end;
$$;

comment on function public.get_my_technician_management_context() is
  'Returns the Plus Account Owner accounts and active machines that the signed-in owner can use for customer-portal Technician management.';

grant execute on function public.get_my_technician_management_context() to authenticated;

select pg_notify('pgrst', 'reload schema');
