-- Super-admin Technician controls for Admin Access.
--
-- These wrappers keep customer/partner Technician RPCs intact while giving
-- /admin/access a narrower, audited path: one assigned reporting machine or
-- no machine for training-only Technician access.

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
    'accounts', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'accountId', account.id,
          'accountName', account.name,
          'accountStatus', account.status,
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

create or replace function public.admin_grant_technician_access(
  p_target_email text,
  p_account_id uuid,
  p_machine_id uuid default null,
  p_reason text default 'Admin Technician access'
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  current_user_id uuid;
  normalized_email text;
  normalized_reason text;
  target_account_id uuid;
  machine_ids uuid[];
  grant_result jsonb;
  update_result jsonb;
begin
  current_user_id := auth.uid();

  if not public.is_super_admin(current_user_id) then
    raise exception 'Super-admin access required';
  end if;

  normalized_email := public.normalize_technician_email(p_target_email);
  normalized_reason := public.technician_assert_reason(p_reason);

  if normalized_email = '' then
    raise exception 'Technician email is required';
  end if;

  if p_machine_id is null and p_account_id is null then
    raise exception 'Select an account for training-only Technician access';
  end if;

  if p_machine_id is not null then
    select machine.account_id
    into target_account_id
    from public.reporting_machines machine
    join public.customer_accounts account on account.id = machine.account_id
    where machine.id = p_machine_id
      and machine.status = 'active'
      and account.status = 'active'
    limit 1;

    if target_account_id is null then
      raise exception 'Active reporting machine not found';
    end if;

    if p_account_id is not null and p_account_id <> target_account_id then
      raise exception 'Selected machine does not belong to the selected account';
    end if;

    machine_ids := array[p_machine_id];
  else
    target_account_id := p_account_id;
    machine_ids := '{}'::uuid[];
  end if;

  if not exists (
    select 1
    from public.customer_accounts account
    where account.id = target_account_id
      and account.status = 'active'
  ) then
    raise exception 'Active account not found';
  end if;

  grant_result := public.grant_technician_access(
    normalized_email,
    machine_ids,
    normalized_reason,
    target_account_id,
    null
  );

  if p_machine_id is null then
    update_result := public.update_technician_machines(
      (grant_result ->> 'grantId')::uuid,
      '{}'::uuid[],
      normalized_reason
    );

    grant_result := grant_result || jsonb_build_object('machineResult', update_result);
  end if;

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
    'admin_technician_access.granted_or_updated',
    'technician_grant',
    grant_result ->> 'grantId',
    nullif(grant_result ->> 'technicianUserId', '')::uuid,
    '{}'::jsonb,
    grant_result,
    jsonb_build_object(
      'account_id', target_account_id,
      'machine_id', p_machine_id,
      'technician_email', normalized_email,
      'reason', normalized_reason,
      'admin_wrapper', true,
      'source_type', 'technician_grant',
      'source_id', grant_result ->> 'grantId'
    )
  );

  return grant_result;
end;
$$;

create or replace function public.admin_update_technician_machines(
  p_grant_id uuid,
  p_machine_id uuid default null,
  p_reason text default 'Admin Technician machine scope updated'
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  current_user_id uuid;
  normalized_reason text;
  grant_row public.technician_grants;
  machine_ids uuid[];
  before_machine_ids uuid[];
  update_result jsonb;
begin
  current_user_id := auth.uid();

  if not public.is_super_admin(current_user_id) then
    raise exception 'Super-admin access required';
  end if;

  if p_grant_id is null then
    raise exception 'Technician grant ID is required';
  end if;

  normalized_reason := public.technician_assert_reason(p_reason);

  select *
  into grant_row
  from public.technician_grants existing_grant
  where existing_grant.id = p_grant_id
    and existing_grant.revoked_at is null
  limit 1
  for update;

  if grant_row.id is null then
    raise exception 'No active Technician grant found';
  end if;

  select coalesce(array_agg(assignment.machine_id order by assignment.machine_id), '{}'::uuid[])
  into before_machine_ids
  from public.technician_machine_assignments assignment
  where assignment.technician_grant_id = grant_row.id
    and assignment.revoked_at is null
    and assignment.status <> 'revoked';

  if p_machine_id is not null then
    if not exists (
      select 1
      from public.reporting_machines machine
      where machine.id = p_machine_id
        and machine.account_id = grant_row.account_id
        and machine.status = 'active'
    ) then
      raise exception 'Selected machine is unavailable or outside this Technician account';
    end if;

    machine_ids := array[p_machine_id];
  else
    machine_ids := '{}'::uuid[];
  end if;

  update_result := public.update_technician_machines(
    grant_row.id,
    machine_ids,
    normalized_reason
  );

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
    'admin_technician_access.scope_updated',
    'technician_grant',
    grant_row.id::text,
    grant_row.technician_user_id,
    jsonb_build_object(
      'grant', to_jsonb(grant_row),
      'machine_ids', before_machine_ids
    ),
    update_result,
    jsonb_build_object(
      'account_id', grant_row.account_id,
      'machine_id', p_machine_id,
      'reason', normalized_reason,
      'admin_wrapper', true,
      'source_type', 'technician_grant',
      'source_id', grant_row.id
    )
  );

  return update_result;
end;
$$;

create or replace function public.admin_renew_technician_access(
  p_grant_id uuid,
  p_reason text default 'Admin Technician access renewed'
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  current_user_id uuid;
  normalized_reason text;
  grant_row public.technician_grants;
  current_machine_ids uuid[];
  update_result jsonb;
begin
  current_user_id := auth.uid();

  if not public.is_super_admin(current_user_id) then
    raise exception 'Super-admin access required';
  end if;

  if p_grant_id is null then
    raise exception 'Technician grant ID is required';
  end if;

  normalized_reason := public.technician_assert_reason(p_reason);

  select *
  into grant_row
  from public.technician_grants existing_grant
  where existing_grant.id = p_grant_id
    and existing_grant.revoked_at is null
  limit 1
  for update;

  if grant_row.id is null then
    raise exception 'No active Technician grant found';
  end if;

  select coalesce(array_agg(assignment.machine_id order by assignment.machine_id), '{}'::uuid[])
  into current_machine_ids
  from public.technician_machine_assignments assignment
  where assignment.technician_grant_id = grant_row.id
    and assignment.revoked_at is null
    and assignment.status = 'active';

  if coalesce(array_length(current_machine_ids, 1), 0) > 1 then
    raise exception 'Admin renewal requires zero or one Technician machine; save a one-machine scope before renewing';
  end if;

  update_result := public.update_technician_machines(
    grant_row.id,
    current_machine_ids,
    normalized_reason
  );

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
    'admin_technician_access.renewed',
    'technician_grant',
    grant_row.id::text,
    grant_row.technician_user_id,
    to_jsonb(grant_row),
    update_result,
    jsonb_build_object(
      'account_id', grant_row.account_id,
      'machine_ids', current_machine_ids,
      'reason', normalized_reason,
      'admin_wrapper', true,
      'source_type', 'technician_grant',
      'source_id', grant_row.id
    )
  );

  return update_result;
end;
$$;

create or replace function public.admin_revoke_technician_access(
  p_grant_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  current_user_id uuid;
  normalized_reason text;
  grant_row public.technician_grants;
  revoke_result jsonb;
begin
  current_user_id := auth.uid();

  if not public.is_super_admin(current_user_id) then
    raise exception 'Super-admin access required';
  end if;

  if p_grant_id is null then
    raise exception 'Technician grant ID is required';
  end if;

  normalized_reason := public.technician_assert_reason(p_reason);

  select *
  into grant_row
  from public.technician_grants existing_grant
  where existing_grant.id = p_grant_id
    and existing_grant.revoked_at is null
  limit 1
  for update;

  if grant_row.id is null then
    raise exception 'No active Technician grant found';
  end if;

  revoke_result := public.revoke_technician_access(grant_row.id, normalized_reason);

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
    'admin_technician_access.revoked',
    'technician_grant',
    grant_row.id::text,
    grant_row.technician_user_id,
    to_jsonb(grant_row),
    revoke_result,
    jsonb_build_object(
      'account_id', grant_row.account_id,
      'reason', normalized_reason,
      'admin_wrapper', true,
      'source_type', 'technician_grant',
      'source_id', grant_row.id
    )
  );

  return revoke_result;
end;
$$;

comment on function public.admin_get_technician_access_context(text) is
  'Super-admin context for /admin/access Technician controls, including active accounts, machines, and target grants.';

comment on function public.admin_grant_technician_access(text, uuid, uuid, text) is
  'Super-admin grant/update wrapper that limits Technician scope to one reporting machine or training-only access.';

comment on function public.admin_update_technician_machines(uuid, uuid, text) is
  'Super-admin Technician machine-scope update wrapper that revokes only Technician-sourced reporting entitlements for removed machines.';

comment on function public.admin_renew_technician_access(uuid, text) is
  'Super-admin Technician renewal wrapper that preserves the current zero-or-one machine scope.';

comment on function public.admin_revoke_technician_access(uuid, text) is
  'Super-admin Technician revoke wrapper that leaves unrelated manual reporting grants intact.';

revoke execute on function public.admin_get_technician_access_context(text)
  from public, anon, authenticated, service_role;
revoke execute on function public.admin_grant_technician_access(text, uuid, uuid, text)
  from public, anon, authenticated, service_role;
revoke execute on function public.admin_update_technician_machines(uuid, uuid, text)
  from public, anon, authenticated, service_role;
revoke execute on function public.admin_renew_technician_access(uuid, text)
  from public, anon, authenticated, service_role;
revoke execute on function public.admin_revoke_technician_access(uuid, text)
  from public, anon, authenticated, service_role;

grant execute on function public.admin_get_technician_access_context(text)
  to authenticated;
grant execute on function public.admin_grant_technician_access(text, uuid, uuid, text)
  to authenticated;
grant execute on function public.admin_update_technician_machines(uuid, uuid, text)
  to authenticated;
grant execute on function public.admin_renew_technician_access(uuid, text)
  to authenticated;
grant execute on function public.admin_revoke_technician_access(uuid, text)
  to authenticated;

select pg_notify('pgrst', 'reload schema');
