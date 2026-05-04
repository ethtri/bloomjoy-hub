-- Issue #376: keep Corporate Partner Technician management tied to current
-- portal-enabled machine scope, including direct RPC calls.

create or replace function public.can_manage_corporate_partner_technician_grant(
  p_user_id uuid,
  p_technician_grant_id uuid,
  p_machine_ids uuid[] default null
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with actor_scope as (
    select
      public.corporate_partner_ids_for_user(p_user_id) as partner_ids,
      public.corporate_partner_machine_ids_for_user(p_user_id) as machine_ids,
      public.corporate_partner_account_ids_for_user(p_user_id) as account_ids
  ),
  target_grant as (
    select grant_row.*
    from public.technician_grants grant_row
    cross join actor_scope scope
    where p_user_id is not null
      and grant_row.id = p_technician_grant_id
      and grant_row.revoked_at is null
      and grant_row.sponsor_type = 'corporate_partner'
      and grant_row.partner_id = any(scope.partner_ids)
      and grant_row.account_id = any(scope.account_ids)
  )
  select exists (select 1 from target_grant)
    and not exists (
      select 1
      from target_grant
      join public.technician_machine_assignments assignment
        on assignment.technician_grant_id = target_grant.id
      cross join actor_scope scope
      where public.technician_assignment_is_active(
          assignment.starts_at,
          assignment.expires_at,
          assignment.revoked_at,
          assignment.status
        )
        and not assignment.machine_id = any(scope.machine_ids)
    )
    and not exists (
      select 1
      from target_grant
      cross join actor_scope scope
      cross join lateral unnest(coalesce(p_machine_ids, '{}'::uuid[])) requested(machine_id)
      where requested.machine_id is not null
        and not requested.machine_id = any(scope.machine_ids)
    );
$$;

create or replace function public.can_access_technician_grant(
  p_user_id uuid,
  p_technician_grant_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select p_user_id is not null
    and p_technician_grant_id is not null
    and (
      public.is_super_admin(p_user_id)
      or exists (
        select 1
        from public.technician_grants grant_row
        left join auth.users auth_user on auth_user.id = p_user_id
        where grant_row.id = p_technician_grant_id
          and (
            (
              grant_row.sponsor_user_id = p_user_id
              and (
                grant_row.sponsor_type <> 'corporate_partner'
                or public.can_manage_corporate_partner_technician_grant(
                  p_user_id,
                  grant_row.id,
                  null
                )
              )
            )
            or grant_row.technician_user_id = p_user_id
            or lower(grant_row.technician_email) = lower(auth_user.email)
            or public.can_manage_corporate_partner_technician_grant(
              p_user_id,
              grant_row.id,
              null
            )
          )
      )
    );
$$;

create or replace function public.get_my_technician_grants()
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

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'grantId', grant_row.id,
      'accountId', grant_row.account_id,
      'sponsorUserId', grant_row.sponsor_user_id,
      'sponsorType', grant_row.sponsor_type,
      'partnerId', grant_row.partner_id,
      'partnerName', partner.name,
      'technicianEmail', grant_row.technician_email,
      'technicianUserId', grant_row.technician_user_id,
      'operatorTrainingGrantId', grant_row.operator_training_grant_id,
      'status', grant_row.status,
      'startsAt', grant_row.starts_at,
      'expiresAt', grant_row.expires_at,
      'grantReason', grant_row.grant_reason,
      'revokedAt', grant_row.revoked_at,
      'revokeReason', grant_row.revoke_reason,
      'createdAt', grant_row.created_at,
      'updatedAt', grant_row.updated_at,
      'isActive', public.technician_grant_is_active(
        grant_row.starts_at,
        grant_row.expires_at,
        grant_row.revoked_at,
        grant_row.status
      ),
      'canManage', (
        public.is_super_admin(current_user_id)
        or (
          grant_row.sponsor_type = 'plus_customer_account'
          and public.has_plus_access(current_user_id)
          and exists (
            select 1
            from public.customer_account_memberships membership
            where membership.account_id = grant_row.account_id
              and membership.user_id = current_user_id
              and membership.active
              and membership.role = 'owner'
          )
        )
        or public.can_manage_corporate_partner_technician_grant(
          current_user_id,
          grant_row.id,
          null
        )
      ),
      'authorityPath', case
        when public.is_super_admin(current_user_id) then 'super_admin'
        when public.can_manage_corporate_partner_technician_grant(
          current_user_id,
          grant_row.id,
          null
        )
          then 'corporate_partner'
        when public.has_plus_access(current_user_id)
          and exists (
            select 1
            from public.customer_account_memberships membership
            where membership.account_id = grant_row.account_id
              and membership.user_id = current_user_id
              and membership.active
              and membership.role = 'owner'
          )
          then 'plus_account_owner'
        else 'technician'
      end,
      'seatCap', 10,
      'activeSeatCount', public.count_active_technician_grants(grant_row.account_id),
      'machines', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'assignmentId', assignment.id,
            'machineId', assignment.machine_id,
            'machineLabel', machine.machine_label,
            'locationId', machine.location_id,
            'locationName', location.name,
            'status', assignment.status,
            'startsAt', assignment.starts_at,
            'expiresAt', assignment.expires_at,
            'revokedAt', assignment.revoked_at,
            'revokeReason', assignment.revoke_reason,
            'isActive', public.technician_assignment_is_active(
              assignment.starts_at,
              assignment.expires_at,
              assignment.revoked_at,
              assignment.status
            )
          )
          order by machine.machine_label, assignment.created_at
        )
        from public.technician_machine_assignments assignment
        left join public.reporting_machines machine on machine.id = assignment.machine_id
        left join public.reporting_locations location on location.id = machine.location_id
        where assignment.technician_grant_id = grant_row.id
          and assignment.revoked_at is null
      ), '[]'::jsonb),
      'activeReportingEntitlementCount', (
        select count(*)::integer
        from public.reporting_machine_entitlements entitlement
        where entitlement.source_type = 'technician_grant'
          and entitlement.source_id = grant_row.id
          and public.reporting_entitlement_is_active(
            entitlement.starts_at,
            entitlement.expires_at,
            entitlement.revoked_at
          )
      )
    )
    order by
      case when grant_row.revoked_at is null then 0 else 1 end,
      grant_row.updated_at desc
  ), '[]'::jsonb)
  into result
  from public.technician_grants grant_row
  left join public.reporting_partners partner on partner.id = grant_row.partner_id
  where public.is_super_admin(current_user_id)
    or public.can_access_technician_grant(current_user_id, grant_row.id)
    or (
      grant_row.sponsor_type = 'plus_customer_account'
      and public.has_plus_access(current_user_id)
      and exists (
        select 1
        from public.customer_account_memberships membership
        where membership.account_id = grant_row.account_id
          and membership.user_id = current_user_id
          and membership.active
          and membership.role = 'owner'
      )
    )
    or public.can_manage_corporate_partner_technician_grant(
      current_user_id,
      grant_row.id,
      null
    );

  return result;
end;
$$;

comment on function public.can_manage_corporate_partner_technician_grant(uuid, uuid, uuid[]) is
  'Corporate Partner Technician management is limited to current portal-enabled machine/account scope, including training-only grants.';

comment on function public.get_my_technician_grants() is
  'Returns Technician grants visible to the signed-in user without leaking stale Corporate Partner grants outside current portal-enabled machine scope.';

revoke execute on function public.can_manage_corporate_partner_technician_grant(uuid, uuid, uuid[])
  from public, anon, authenticated;
revoke execute on function public.can_access_technician_grant(uuid, uuid)
  from public, anon;

grant execute on function public.can_access_technician_grant(uuid, uuid)
  to authenticated;

select pg_notify('pgrst', 'reload schema');
