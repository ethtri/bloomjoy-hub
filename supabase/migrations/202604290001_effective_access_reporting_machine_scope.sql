-- Effective access reporting-machine scope repair.
--
-- The Admin Access console should show the machines a person can actually
-- report on, regardless of whether that scope comes from Corporate Partner,
-- Technician, Plus account membership, manual reporting entitlement, or
-- Scoped Admin access.

create or replace function public.reporting_machine_ids_for_user(p_user_id uuid)
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(distinct machine.id order by machine.id), '{}'::uuid[])
  from public.reporting_machines machine
  where machine.status = 'active'
    and public.has_reporting_machine_access(p_user_id, machine.id);
$$;

create or replace function public.technician_machine_ids_for_user(p_user_id uuid)
returns uuid[]
language sql
stable
security definer
set search_path = public, auth
as $$
  select coalesce(array_agg(distinct assignment.machine_id order by assignment.machine_id), '{}'::uuid[])
  from auth.users auth_user
  join public.technician_grants grant_row
    on (
      grant_row.technician_user_id = auth_user.id
      or public.normalize_technician_email(grant_row.technician_email)
        = public.normalize_technician_email(auth_user.email)
    )
  join public.technician_machine_assignments assignment
    on assignment.technician_grant_id = grant_row.id
  join public.reporting_machines machine
    on machine.id = assignment.machine_id
  where auth_user.id = p_user_id
    and machine.status = 'active'
    and public.technician_grant_is_active(
      grant_row.starts_at,
      grant_row.expires_at,
      grant_row.revoked_at,
      grant_row.status
    )
    and public.technician_assignment_is_active(
      assignment.starts_at,
      assignment.expires_at,
      assignment.revoked_at,
      assignment.status
    );
$$;

create or replace function public.get_effective_access_context_for_user(
  p_user_id uuid,
  p_email text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, auth
as $$
declare
  normalized_email text;
  resolved_user_id uuid;
  capability_names text[] := array[
    'training.view',
    'support.request',
    'supplies.member_discount',
    'reports.partner.view',
    'reports.machine.view',
    'technicians.manage',
    'admin.access.manage_reporting',
    'admin.global'
  ];
  active_capabilities jsonb;
  active_presets jsonb;
  partner_ids uuid[];
  partnership_ids uuid[];
  reporting_machine_ids uuid[];
  corporate_partner_machine_ids uuid[];
  technician_machine_ids uuid[];
  scoped_admin_machine_ids uuid[];
begin
  normalized_email := public.normalize_corporate_partner_email(p_email);
  resolved_user_id := p_user_id;

  if resolved_user_id is null and normalized_email <> '' then
    select auth_user.id
    into resolved_user_id
    from auth.users auth_user
    where public.normalize_corporate_partner_email(auth_user.email) = normalized_email
    limit 1;
  end if;

  if resolved_user_id is null then
    return jsonb_build_object(
      'userId', null,
      'email', nullif(normalized_email, ''),
      'presets', '[]'::jsonb,
      'capabilities', '[]'::jsonb,
      'sources', jsonb_build_object(
        'corporatePartnerMemberships', '[]'::jsonb,
        'technicianGrants', '[]'::jsonb
      ),
      'scopes', jsonb_build_object(
        'partnershipIds', '[]'::jsonb,
        'machineIds', '[]'::jsonb,
        'corporatePartnerMachineIds', '[]'::jsonb,
        'technicianMachineIds', '[]'::jsonb,
        'scopedAdminMachineIds', '[]'::jsonb
      ),
      'warnings', jsonb_build_array('No auth user exists yet; email-based grants can still be created.')
    );
  end if;

  select auth_user.email
  into normalized_email
  from auth.users auth_user
  where auth_user.id = resolved_user_id
  limit 1;

  partner_ids := public.corporate_partner_ids_for_user(resolved_user_id);
  partnership_ids := public.corporate_partner_partnership_ids_for_user(resolved_user_id, true);
  reporting_machine_ids := public.reporting_machine_ids_for_user(resolved_user_id);
  corporate_partner_machine_ids := public.corporate_partner_machine_ids_for_user(resolved_user_id);
  technician_machine_ids := public.technician_machine_ids_for_user(resolved_user_id);
  scoped_admin_machine_ids := public.scoped_admin_machine_ids(resolved_user_id);

  select coalesce(jsonb_agg(capability order by capability), '[]'::jsonb)
  into active_capabilities
  from unnest(capability_names) as capability
  where public.has_user_capability(resolved_user_id, capability);

  select coalesce(jsonb_agg(preset order by preset), '[]'::jsonb)
  into active_presets
  from (
    select 'Super Admin' as preset where public.is_super_admin(resolved_user_id)
    union all
    select 'Scoped Admin' where public.is_scoped_admin(resolved_user_id)
    union all
    select 'Plus Customer' where public.has_plus_access(resolved_user_id)
    union all
    select 'Corporate Partner' where public.is_active_corporate_partner_user(resolved_user_id)
    union all
    select 'Technician' where public.has_active_operator_training_grant(resolved_user_id)
  ) presets;

  return jsonb_build_object(
    'userId', resolved_user_id,
    'email', normalized_email,
    'presets', active_presets,
    'capabilities', active_capabilities,
    'sources', jsonb_build_object(
      'plusAccess', public.get_plus_access_for_user(resolved_user_id),
      'corporatePartnerMemberships', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id', membership.id,
            'partnerId', membership.partner_id,
            'partnerName', partner.name,
            'status', membership.status,
            'startsAt', membership.starts_at,
            'expiresAt', membership.expires_at,
            'grantReason', membership.grant_reason,
            'revokedAt', membership.revoked_at,
            'isActive', public.corporate_partner_membership_is_active(
              membership.starts_at,
              membership.expires_at,
              membership.revoked_at,
              membership.status
            )
          )
          order by partner.name, membership.created_at desc
        )
        from public.corporate_partner_memberships membership
        join public.reporting_partners partner on partner.id = membership.partner_id
        where (
          membership.user_id = resolved_user_id
          or public.normalize_corporate_partner_email(membership.member_email)
            = public.normalize_corporate_partner_email(normalized_email)
        )
      ), '[]'::jsonb),
      'technicianGrants', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id', grant_row.id,
            'accountId', grant_row.account_id,
            'accountName', account.name,
            'sponsorType', grant_row.sponsor_type,
            'partnerId', grant_row.partner_id,
            'partnerName', partner.name,
            'status', grant_row.status,
            'startsAt', grant_row.starts_at,
            'expiresAt', grant_row.expires_at,
            'grantReason', grant_row.grant_reason,
            'revokedAt', grant_row.revoked_at,
            'isActive', public.technician_grant_is_active(
              grant_row.starts_at,
              grant_row.expires_at,
              grant_row.revoked_at,
              grant_row.status
            ),
            'machineIds', coalesce((
              select jsonb_agg(distinct assignment.machine_id order by assignment.machine_id)
              from public.technician_machine_assignments assignment
              join public.reporting_machines machine on machine.id = assignment.machine_id
              where assignment.technician_grant_id = grant_row.id
                and machine.status = 'active'
                and public.technician_assignment_is_active(
                  assignment.starts_at,
                  assignment.expires_at,
                  assignment.revoked_at,
                  assignment.status
                )
            ), '[]'::jsonb)
          )
          order by grant_row.created_at desc
        )
        from public.technician_grants grant_row
        join public.customer_accounts account on account.id = grant_row.account_id
        left join public.reporting_partners partner on partner.id = grant_row.partner_id
        where (
          grant_row.technician_user_id = resolved_user_id
          or public.normalize_technician_email(grant_row.technician_email)
            = public.normalize_technician_email(normalized_email)
        )
      ), '[]'::jsonb)
    ),
    'scopes', jsonb_build_object(
      'partnerIds', to_jsonb(partner_ids),
      'partnershipIds', to_jsonb(partnership_ids),
      'machineIds', to_jsonb(reporting_machine_ids),
      'corporatePartnerMachineIds', to_jsonb(corporate_partner_machine_ids),
      'technicianMachineIds', to_jsonb(technician_machine_ids),
      'scopedAdminMachineIds', to_jsonb(scoped_admin_machine_ids)
    ),
    'warnings', coalesce((
      select jsonb_agg(warning)
      from (
        select 'Corporate Partner has no active portal-enabled partnerships.' as warning
        where public.is_active_corporate_partner_user(resolved_user_id)
          and coalesce(array_length(partnership_ids, 1), 0) = 0
        union all
        select 'Corporate Partner has portal-enabled partnerships but no active derived machines.'
        where public.is_active_corporate_partner_user(resolved_user_id)
          and coalesce(array_length(partnership_ids, 1), 0) > 0
          and coalesce(array_length(corporate_partner_machine_ids, 1), 0) = 0
        union all
        select 'Technician has training access but no assigned reporting machines.'
        where public.has_active_operator_training_grant(resolved_user_id)
          and coalesce(array_length(technician_machine_ids, 1), 0) = 0
          and not public.is_active_corporate_partner_user(resolved_user_id)
      ) warnings
    ), '[]'::jsonb)
  );
end;
$$;

revoke execute on function public.reporting_machine_ids_for_user(uuid)
  from public, anon, authenticated;
revoke execute on function public.technician_machine_ids_for_user(uuid)
  from public, anon, authenticated;
grant execute on function public.reporting_machine_ids_for_user(uuid) to service_role;
grant execute on function public.technician_machine_ids_for_user(uuid) to service_role;

comment on function public.reporting_machine_ids_for_user(uuid) is
  'Internal helper that resolves all active reporting machines visible to a user.';
comment on function public.technician_machine_ids_for_user(uuid) is
  'Internal helper that resolves active Technician-assigned reporting machines for a user.';

select pg_notify('pgrst', 'reload schema');
