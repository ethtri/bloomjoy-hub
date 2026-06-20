-- Allow Super Admin-created Technician grants for customer accounts that do
-- not yet have an active Plus owner sponsor.

create or replace function public.technician_pick_sponsor_user_id(
  p_actor_user_id uuid,
  p_account_id uuid
)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  selected_sponsor_user_id uuid;
  authority_path text;
begin
  if p_actor_user_id is null or p_account_id is null then
    return null;
  end if;

  authority_path := public.technician_actor_authority_path(p_actor_user_id, p_account_id);

  if authority_path in ('plus_account_owner', 'corporate_partner') then
    return p_actor_user_id;
  end if;

  if authority_path <> 'super_admin' then
    return null;
  end if;

  select membership.user_id
  into selected_sponsor_user_id
  from public.customer_account_memberships membership
  where membership.account_id = p_account_id
    and membership.active
    and membership.role = 'owner'
    and public.has_plus_access(membership.user_id)
  order by membership.created_at asc, membership.id asc
  limit 1;

  return coalesce(selected_sponsor_user_id, p_actor_user_id);
end;
$$;

create or replace function public.admin_reconcile_technician_entitlements(
  p_reason text default 'Technician entitlement reconciliation'
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  current_user_id uuid;
  normalized_reason text;
  grant_before public.technician_grants;
  grant_after public.technician_grants;
  assignment_before public.technician_machine_assignments;
  assignment_after public.technician_machine_assignments;
  suspended_grant_count integer := 0;
  suspended_assignment_count integer := 0;
  revoked_entitlement_count integer := 0;
  revoked_count integer := 0;
begin
  current_user_id := auth.uid();

  if current_user_id is null then
    raise exception 'Authentication required';
  end if;

  if not public.is_super_admin(current_user_id) then
    raise exception 'Admin access required';
  end if;

  normalized_reason := public.technician_assert_reason(p_reason);

  for grant_before in
    select *
    from public.technician_grants grant_row
    where grant_row.revoked_at is null
      and grant_row.status in ('pending', 'active')
      and not (
        public.is_super_admin(grant_row.sponsor_user_id)
        or (
          grant_row.sponsor_type = 'corporate_partner'
          and grant_row.partner_id is not null
          and grant_row.partner_id = any(
            public.corporate_partner_ids_for_user(grant_row.sponsor_user_id)
          )
          and grant_row.account_id = any(
            public.corporate_partner_account_ids_for_user(grant_row.sponsor_user_id)
          )
        )
        or (
          public.has_plus_access(grant_row.sponsor_user_id)
          and exists (
            select 1
            from public.customer_account_memberships membership
            where membership.account_id = grant_row.account_id
              and membership.user_id = grant_row.sponsor_user_id
              and membership.active
              and membership.role = 'owner'
          )
        )
      )
    for update
  loop
    update public.technician_grants
    set
      status = 'suspended',
      grant_reason = normalized_reason,
      granted_by_user_id = current_user_id
    where id = grant_before.id
    returning * into grant_after;

    suspended_grant_count := suspended_grant_count + 1;

    update public.technician_machine_assignments assignment
    set
      status = 'suspended',
      grant_reason = normalized_reason,
      granted_by_user_id = current_user_id
    where assignment.technician_grant_id = grant_before.id
      and assignment.revoked_at is null
      and assignment.status = 'active';

    with revoked_entitlements as (
      update public.reporting_machine_entitlements entitlement
      set
        revoked_at = now(),
        revoked_by = current_user_id,
        revoke_reason = normalized_reason
      where entitlement.source_type = 'technician_grant'
        and entitlement.source_id = grant_before.id
        and public.reporting_entitlement_is_active(
          entitlement.starts_at,
          entitlement.expires_at,
          entitlement.revoked_at
        )
      returning entitlement.id
    )
    select count(*)::integer
    into revoked_count
    from revoked_entitlements;

    revoked_entitlement_count := revoked_entitlement_count + revoked_count;

    insert into public.admin_audit_log (
      actor_user_id,
      action,
      entity_type,
      entity_id,
      target_user_id,
      before,
      after,
      meta
    )
    values (
      current_user_id,
      'technician_access.suspended',
      'technician_grant',
      grant_after.id::text,
      grant_after.technician_user_id,
      to_jsonb(grant_before),
      to_jsonb(grant_after),
      jsonb_build_object(
        'automation', true,
        'reason', normalized_reason,
        'account_id', grant_after.account_id,
        'sponsor_user_id', grant_after.sponsor_user_id,
        'technician_email', grant_after.technician_email,
        'technician_user_id', grant_after.technician_user_id,
        'reporting_entitlements_revoked', revoked_count,
        'source_type', 'technician_grant',
        'source_id', grant_after.id
      )
    );
  end loop;

  for assignment_before in
    select assignment.*
    from public.technician_machine_assignments assignment
    join public.technician_grants grant_row on grant_row.id = assignment.technician_grant_id
    left join public.reporting_machines machine on machine.id = assignment.machine_id
    where assignment.revoked_at is null
      and assignment.status = 'active'
      and grant_row.revoked_at is null
      and grant_row.status in ('pending', 'active')
      and (
        machine.id is null
        or machine.status <> 'active'
        or machine.account_id <> grant_row.account_id
      )
    for update of assignment
  loop
    update public.technician_machine_assignments
    set
      status = 'suspended',
      grant_reason = normalized_reason,
      granted_by_user_id = current_user_id
    where id = assignment_before.id
    returning * into assignment_after;

    suspended_assignment_count := suspended_assignment_count + 1;

    with revoked_entitlements as (
      update public.reporting_machine_entitlements entitlement
      set
        revoked_at = now(),
        revoked_by = current_user_id,
        revoke_reason = normalized_reason
      where entitlement.source_type = 'technician_grant'
        and entitlement.source_id = assignment_after.technician_grant_id
        and entitlement.machine_id = assignment_after.machine_id
        and public.reporting_entitlement_is_active(
          entitlement.starts_at,
          entitlement.expires_at,
          entitlement.revoked_at
        )
      returning entitlement.id
    )
    select count(*)::integer
    into revoked_count
    from revoked_entitlements;

    revoked_entitlement_count := revoked_entitlement_count + revoked_count;

    insert into public.admin_audit_log (
      actor_user_id,
      action,
      entity_type,
      entity_id,
      target_user_id,
      before,
      after,
      meta
    )
    values (
      current_user_id,
      'technician_assignment.suspended',
      'technician_machine_assignment',
      assignment_after.id::text,
      null,
      to_jsonb(assignment_before),
      to_jsonb(assignment_after),
      jsonb_build_object(
        'automation', true,
        'reason', normalized_reason,
        'technician_grant_id', assignment_after.technician_grant_id,
        'machine_id', assignment_after.machine_id,
        'reporting_entitlements_revoked', revoked_count,
        'source_type', 'technician_grant',
        'source_id', assignment_after.technician_grant_id
      )
    );
  end loop;

  return jsonb_build_object(
    'suspendedGrantCount', suspended_grant_count,
    'suspendedAssignmentCount', suspended_assignment_count,
    'revokedReportingEntitlementCount', revoked_entitlement_count
  );
end;
$$;

comment on function public.technician_pick_sponsor_user_id(uuid, uuid) is
  'Selects the sponsor for Technician access. Super Admin grants may fall back to the Super Admin actor when an account has no active Plus owner sponsor.';

comment on function public.admin_reconcile_technician_entitlements(text) is
  'Suspends stale Technician access while preserving Super Admin-sponsored grants for admin-managed accounts without Plus owner sponsors.';

revoke execute on function public.technician_pick_sponsor_user_id(uuid, uuid)
  from public, anon;
grant execute on function public.technician_pick_sponsor_user_id(uuid, uuid)
  to authenticated, service_role;

revoke execute on function public.admin_reconcile_technician_entitlements(text)
  from public, anon, authenticated;
grant execute on function public.admin_reconcile_technician_entitlements(text)
  to service_role;

select pg_notify('pgrst', 'reload schema');
