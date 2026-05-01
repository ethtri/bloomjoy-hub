-- Keep Admin Access Technician invites from offering accounts that the grant
-- RPC cannot use. Super Admin Technician grants currently need an active Plus
-- Customer owner as the sponsor behind the source-owned entitlement.

create or replace function public.admin_get_technician_access_context(
  p_target_email text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  current_user_id uuid;
  normalized_email text;
  target_user_id uuid;
  result jsonb;
begin
  current_user_id := auth.uid();

  if not public.is_super_admin(current_user_id) then
    raise exception 'Super-admin access required';
  end if;

  normalized_email := public.normalize_technician_email(p_target_email);

  if normalized_email = '' then
    raise exception 'Technician email is required';
  end if;

  select auth_user.id
  into target_user_id
  from auth.users auth_user
  where public.normalize_technician_email(auth_user.email) = normalized_email
  limit 1;

  select jsonb_build_object(
    'targetEmail', normalized_email,
    'targetUserId', target_user_id,
    'activeAccountCount', (
      select count(*)::integer
      from public.customer_accounts account
      where account.status = 'active'
    ),
    'eligibleAccountCount', (
      select count(*)::integer
      from public.customer_accounts account
      where account.status = 'active'
        and exists (
          select 1
          from public.customer_account_memberships membership
          where membership.account_id = account.id
            and membership.active
            and membership.role = 'owner'
            and public.has_plus_access(membership.user_id)
        )
    ),
    'ineligibleAccountCount', (
      select count(*)::integer
      from public.customer_accounts account
      where account.status = 'active'
        and not exists (
          select 1
          from public.customer_account_memberships membership
          where membership.account_id = account.id
            and membership.active
            and membership.role = 'owner'
            and public.has_plus_access(membership.user_id)
        )
    ),
    'accounts', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'accountId', account.id,
          'accountName', account.name,
          'accountStatus', account.status,
          'sponsorUserId', sponsor.sponsor_user_id,
          'sponsorType', 'plus_customer_account',
          'machineCount', (
            select count(*)::integer
            from public.reporting_machines machine
            where machine.account_id = account.id
              and machine.status = 'active'
          ),
          'machines', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'machineId', machine.id,
                'machineLabel', machine.machine_label,
                'machineType', machine.machine_type,
                'accountId', account.id,
                'accountName', account.name,
                'locationId', location.id,
                'locationName', location.name,
                'status', machine.status
              )
              order by location.name, machine.machine_label, machine.id
            )
            from public.reporting_machines machine
            left join public.reporting_locations location on location.id = machine.location_id
            where machine.account_id = account.id
              and machine.status = 'active'
          ), '[]'::jsonb)
        )
        order by account.name, account.id
      )
      from public.customer_accounts account
      join lateral (
        select membership.user_id as sponsor_user_id
        from public.customer_account_memberships membership
        where membership.account_id = account.id
          and membership.active
          and membership.role = 'owner'
          and public.has_plus_access(membership.user_id)
        order by membership.created_at asc, membership.id asc
        limit 1
      ) sponsor on true
      where account.status = 'active'
    ), '[]'::jsonb),
    'grants', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'grantId', grant_row.id,
          'accountId', grant_row.account_id,
          'accountName', account.name,
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
          'machines', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'assignmentId', assignment.id,
                'machineId', assignment.machine_id,
                'machineLabel', machine.machine_label,
                'machineType', machine.machine_type,
                'accountId', machine.account_id,
                'accountName', machine_account.name,
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
            left join public.customer_accounts machine_account on machine_account.id = machine.account_id
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
          grant_row.updated_at desc,
          grant_row.id
      )
      from public.technician_grants grant_row
      join public.customer_accounts account on account.id = grant_row.account_id
      left join public.reporting_partners partner on partner.id = grant_row.partner_id
      where public.normalize_technician_email(grant_row.technician_email) = normalized_email
        or (
          target_user_id is not null
          and grant_row.technician_user_id = target_user_id
        )
    ), '[]'::jsonb)
  )
  into result;

  return result;
end;
$$;

comment on function public.admin_get_technician_access_context(text) is
  'Super-admin context for /admin/access Technician controls, limited to grantable Plus Customer sponsor accounts plus target grants.';

select pg_notify('pgrst', 'reload schema');
