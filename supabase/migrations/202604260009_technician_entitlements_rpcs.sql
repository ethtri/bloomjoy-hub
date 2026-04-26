-- Technician entitlement grant/revoke RPCs.
--
-- This slice composes existing operator training grants with
-- Technician-derived machine reporting entitlements. It does not add customer
-- UI, partner reporting behavior, PDF/report export behavior, or paid seats.

create unique index if not exists reporting_machine_entitlements_one_open_technician_machine_idx
  on public.reporting_machine_entitlements (source_type, source_id, machine_id)
  where source_type = 'technician_grant'
    and revoked_at is null;

create or replace function public.technician_assert_reason(p_reason text)
returns text
language plpgsql
stable
as $$
declare
  normalized_reason text;
begin
  normalized_reason := trim(coalesce(p_reason, ''));

  if normalized_reason = '' then
    raise exception 'A reason is required';
  end if;

  return normalized_reason;
end;
$$;

create or replace function public.technician_actor_authority_path(
  p_actor_user_id uuid,
  p_account_id uuid
)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_actor_user_id is null or p_account_id is null then
    return null;
  end if;

  if public.has_plus_access(p_actor_user_id)
    and exists (
      select 1
      from public.customer_account_memberships membership
      where membership.user_id = p_actor_user_id
        and membership.account_id = p_account_id
        and membership.active
        and membership.role = 'owner'
    ) then
    return 'plus_account_owner';
  end if;

  if public.is_super_admin(p_actor_user_id) then
    return 'super_admin';
  end if;

  return null;
end;
$$;

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
begin
  if p_actor_user_id is null or p_account_id is null then
    return null;
  end if;

  if public.technician_actor_authority_path(p_actor_user_id, p_account_id) = 'plus_account_owner' then
    return p_actor_user_id;
  end if;

  if not public.is_super_admin(p_actor_user_id) then
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

  return selected_sponsor_user_id;
end;
$$;

create or replace function public.technician_reuse_or_create_operator_training_grant(
  p_sponsor_user_id uuid,
  p_technician_email text,
  p_technician_user_id uuid,
  p_reason text,
  p_actor_user_id uuid
)
returns public.operator_training_grants
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  normalized_email text;
  normalized_reason text;
  before_row public.operator_training_grants;
  after_row public.operator_training_grants;
  action_name text;
begin
  normalized_email := public.normalize_technician_email(p_technician_email);
  normalized_reason := public.technician_assert_reason(p_reason);

  if p_actor_user_id is null then
    raise exception 'Authentication required';
  end if;

  if p_sponsor_user_id is null then
    raise exception 'A Plus Account Owner sponsor is required';
  end if;

  if normalized_email = '' then
    raise exception 'Technician email is required';
  end if;

  select *
  into before_row
  from public.operator_training_grants grant_row
  where grant_row.sponsor_user_id = p_sponsor_user_id
    and lower(grant_row.operator_email) = normalized_email
    and grant_row.revoked_at is null
  limit 1
  for update;

  if before_row.id is null then
    insert into public.operator_training_grants (
      sponsor_user_id,
      operator_email,
      operator_user_id,
      starts_at,
      expires_at,
      grant_reason,
      granted_by_user_id
    )
    values (
      p_sponsor_user_id,
      normalized_email,
      p_technician_user_id,
      now(),
      null,
      normalized_reason,
      p_actor_user_id
    )
    returning * into after_row;

    action_name := 'operator_training.granted';
  else
    update public.operator_training_grants
    set
      operator_user_id = coalesce(p_technician_user_id, operator_user_id),
      expires_at = null,
      grant_reason = normalized_reason,
      granted_by_user_id = p_actor_user_id
    where id = before_row.id
    returning * into after_row;

    action_name := 'operator_training.updated';
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
    p_actor_user_id,
    action_name,
    'operator_training_grant',
    after_row.id::text,
    after_row.operator_user_id,
    coalesce(to_jsonb(before_row), '{}'::jsonb),
    to_jsonb(after_row),
    jsonb_build_object(
      'operator_email', normalized_email,
      'reason', normalized_reason,
      'source_type', 'technician_grant',
      'sponsor_user_id', p_sponsor_user_id
    )
  );

  return after_row;
end;
$$;

create or replace function public.technician_apply_machine_assignments(
  p_grant_id uuid,
  p_machine_ids uuid[],
  p_reason text,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  grant_row public.technician_grants;
  normalized_reason text;
  normalized_machine_ids uuid[];
  before_machine_ids uuid[];
  after_machine_ids uuid[];
  added_machine_ids uuid[];
  removed_machine_ids uuid[];
  desired_machine_id uuid;
  invalid_machine_count integer;
  assignments_revoked integer := 0;
  reporting_entitlements_revoked integer := 0;
  reporting_entitlements_upserted integer := 0;
begin
  if p_actor_user_id is null then
    raise exception 'Authentication required';
  end if;

  if p_grant_id is null then
    raise exception 'Technician grant ID is required';
  end if;

  normalized_reason := public.technician_assert_reason(p_reason);

  select *
  into grant_row
  from public.technician_grants grant_record
  where grant_record.id = p_grant_id
    and grant_record.revoked_at is null
  limit 1
  for update;

  if grant_row.id is null then
    raise exception 'No active Technician grant found';
  end if;

  if not public.can_manage_technician_grants_for_account(p_actor_user_id, grant_row.account_id) then
    raise exception 'Access denied';
  end if;

  select coalesce(array_agg(distinct requested.machine_id), '{}'::uuid[])
  into normalized_machine_ids
  from unnest(coalesce(p_machine_ids, '{}'::uuid[])) as requested(machine_id)
  where requested.machine_id is not null;

  select count(*)::integer
  into invalid_machine_count
  from unnest(normalized_machine_ids) as requested(machine_id)
  left join public.reporting_machines machine on machine.id = requested.machine_id
  where machine.id is null
    or machine.status <> 'active'
    or machine.account_id <> grant_row.account_id
    or not public.can_manage_technician_grants_for_machine(p_actor_user_id, requested.machine_id);

  if invalid_machine_count > 0 then
    raise exception 'One or more reporting machines are unavailable or outside this account';
  end if;

  select coalesce(array_agg(assignment.machine_id order by assignment.machine_id), '{}'::uuid[])
  into before_machine_ids
  from public.technician_machine_assignments assignment
  where assignment.technician_grant_id = grant_row.id
    and public.technician_assignment_is_active(
      assignment.starts_at,
      assignment.expires_at,
      assignment.revoked_at,
      assignment.status
    );

  select coalesce(array_agg(machine_id order by machine_id), '{}'::uuid[])
  into added_machine_ids
  from unnest(normalized_machine_ids) as desired(machine_id)
  where not (desired.machine_id = any(before_machine_ids));

  select coalesce(array_agg(machine_id order by machine_id), '{}'::uuid[])
  into removed_machine_ids
  from unnest(before_machine_ids) as existing(machine_id)
  where not (existing.machine_id = any(normalized_machine_ids));

  with revoked_assignments as (
    update public.technician_machine_assignments assignment
    set
      status = 'revoked',
      revoked_at = now(),
      revoked_by_user_id = p_actor_user_id,
      revoke_reason = normalized_reason
    where assignment.technician_grant_id = grant_row.id
      and assignment.revoked_at is null
      and assignment.status <> 'revoked'
      and not (assignment.machine_id = any(normalized_machine_ids))
    returning assignment.id
  )
  select count(*)::integer
  into assignments_revoked
  from revoked_assignments;

  foreach desired_machine_id in array normalized_machine_ids
  loop
    insert into public.technician_machine_assignments (
      technician_grant_id,
      machine_id,
      status,
      starts_at,
      expires_at,
      grant_reason,
      granted_by_user_id,
      revoked_at,
      revoked_by_user_id,
      revoke_reason
    )
    values (
      grant_row.id,
      desired_machine_id,
      'active',
      now(),
      null,
      normalized_reason,
      p_actor_user_id,
      null,
      null,
      null
    )
    on conflict (technician_grant_id, machine_id) where revoked_at is null
    do update
    set
      status = 'active',
      expires_at = null,
      grant_reason = excluded.grant_reason,
      granted_by_user_id = excluded.granted_by_user_id,
      revoked_at = null,
      revoked_by_user_id = null,
      revoke_reason = null;
  end loop;

  with revoked_entitlements as (
    update public.reporting_machine_entitlements entitlement
    set
      revoked_at = now(),
      revoked_by = p_actor_user_id,
      revoke_reason = normalized_reason
    where entitlement.source_type = 'technician_grant'
      and entitlement.source_id = grant_row.id
      and entitlement.machine_id = any(removed_machine_ids)
      and public.reporting_entitlement_is_active(
        entitlement.starts_at,
        entitlement.expires_at,
        entitlement.revoked_at
      )
    returning entitlement.id
  )
  select count(*)::integer
  into reporting_entitlements_revoked
  from revoked_entitlements;

  if grant_row.technician_user_id is not null then
    insert into public.reporting_machine_entitlements (
      user_id,
      account_id,
      location_id,
      machine_id,
      access_level,
      starts_at,
      expires_at,
      grant_reason,
      granted_by,
      revoked_at,
      revoked_by,
      revoke_reason,
      source_type,
      source_id
    )
    select
      grant_row.technician_user_id,
      null,
      null,
      requested.machine_id,
      'viewer',
      now(),
      null,
      normalized_reason,
      p_actor_user_id,
      null,
      null,
      null,
      'technician_grant',
      grant_row.id
    from unnest(normalized_machine_ids) as requested(machine_id)
    on conflict (source_type, source_id, machine_id)
      where source_type = 'technician_grant'
        and revoked_at is null
    do update
    set
      user_id = excluded.user_id,
      account_id = null,
      location_id = null,
      access_level = 'viewer',
      expires_at = null,
      grant_reason = excluded.grant_reason,
      granted_by = excluded.granted_by,
      revoked_at = null,
      revoked_by = null,
      revoke_reason = null;

    get diagnostics reporting_entitlements_upserted = row_count;
  end if;

  select coalesce(array_agg(assignment.machine_id order by assignment.machine_id), '{}'::uuid[])
  into after_machine_ids
  from public.technician_machine_assignments assignment
  where assignment.technician_grant_id = grant_row.id
    and public.technician_assignment_is_active(
      assignment.starts_at,
      assignment.expires_at,
      assignment.revoked_at,
      assignment.status
    );

  return jsonb_build_object(
    'grantId', grant_row.id,
    'accountId', grant_row.account_id,
    'technicianUserId', grant_row.technician_user_id,
    'machineIdsBefore', before_machine_ids,
    'machineIdsAfter', after_machine_ids,
    'machineIdsAdded', added_machine_ids,
    'machineIdsRemoved', removed_machine_ids,
    'assignmentsRevoked', assignments_revoked,
    'reportingEntitlementsUpserted', reporting_entitlements_upserted,
    'reportingEntitlementsRevoked', reporting_entitlements_revoked
  );
end;
$$;

drop function if exists public.grant_technician_access(text, uuid[], text);
create or replace function public.grant_technician_access(
  p_technician_email text,
  p_machine_ids uuid[],
  p_reason text default 'Technician access'
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  current_user_id uuid;
  current_user_email text;
  normalized_email text;
  normalized_reason text;
  normalized_machine_ids uuid[];
  invalid_machine_count integer;
  account_count integer;
  target_account_id uuid;
  target_user_id uuid;
  selected_sponsor_user_id uuid;
  sponsor_email text;
  actor_authority_path text;
  operator_grant public.operator_training_grants;
  before_grant public.technician_grants;
  after_grant public.technician_grants;
  machine_result jsonb;
  action_name text;
begin
  current_user_id := auth.uid();

  if current_user_id is null then
    raise exception 'Authentication required';
  end if;

  normalized_email := public.normalize_technician_email(p_technician_email);
  normalized_reason := public.technician_assert_reason(p_reason);

  if normalized_email = '' then
    raise exception 'Technician email is required';
  end if;

  select public.normalize_technician_email(auth_user.email)
  into current_user_email
  from auth.users auth_user
  where auth_user.id = current_user_id
  limit 1;

  if current_user_email = normalized_email then
    raise exception 'Use a different email for Technician access';
  end if;

  select coalesce(array_agg(distinct requested.machine_id), '{}'::uuid[])
  into normalized_machine_ids
  from unnest(coalesce(p_machine_ids, '{}'::uuid[])) as requested(machine_id)
  where requested.machine_id is not null;

  if coalesce(array_length(normalized_machine_ids, 1), 0) = 0 then
    raise exception 'At least one reporting machine is required';
  end if;

  select
    (count(*) filter (where machine.id is null or machine.status <> 'active'))::integer,
    (count(distinct machine.account_id) filter (where machine.id is not null and machine.status = 'active'))::integer
  into invalid_machine_count, account_count
  from unnest(normalized_machine_ids) as requested(machine_id)
  left join public.reporting_machines machine on machine.id = requested.machine_id;

  if invalid_machine_count > 0 then
    raise exception 'One or more reporting machines were not found or are inactive';
  end if;

  if account_count <> 1 then
    raise exception 'Technician machine assignments must belong to one account';
  end if;

  select machine.account_id
  into target_account_id
  from public.reporting_machines machine
  where machine.id = normalized_machine_ids[1]
  limit 1;

  actor_authority_path := public.technician_actor_authority_path(current_user_id, target_account_id);

  if actor_authority_path is null then
    raise exception 'Plus Account Owner access required';
  end if;

  select count(*)::integer
  into invalid_machine_count
  from unnest(normalized_machine_ids) as requested(machine_id)
  where not public.can_manage_technician_grants_for_machine(current_user_id, requested.machine_id);

  if invalid_machine_count > 0 then
    raise exception 'One or more reporting machines are outside your control';
  end if;

  select auth_user.id
  into target_user_id
  from auth.users auth_user
  where public.normalize_technician_email(auth_user.email) = normalized_email
  limit 1;

  selected_sponsor_user_id := public.technician_pick_sponsor_user_id(current_user_id, target_account_id);

  if selected_sponsor_user_id is null then
    raise exception 'No active Plus Account Owner sponsor found for this account';
  end if;

  select public.normalize_technician_email(auth_user.email)
  into sponsor_email
  from auth.users auth_user
  where auth_user.id = selected_sponsor_user_id
  limit 1;

  if sponsor_email = normalized_email then
    raise exception 'Use a different email for Technician access';
  end if;

  select *
  into before_grant
  from public.technician_grants grant_row
  where grant_row.account_id = target_account_id
    and lower(grant_row.technician_email) = normalized_email
    and grant_row.revoked_at is null
  limit 1
  for update;

  if before_grant.id is null
    and not public.has_available_technician_grant_seat(
      target_account_id,
      normalized_email,
      target_user_id,
      10
    ) then
    raise exception 'Technician grant cap exceeded for this Plus account';
  end if;

  operator_grant := public.technician_reuse_or_create_operator_training_grant(
    selected_sponsor_user_id,
    normalized_email,
    target_user_id,
    normalized_reason,
    current_user_id
  );

  if before_grant.id is null then
    insert into public.technician_grants (
      account_id,
      sponsor_user_id,
      technician_email,
      technician_user_id,
      operator_training_grant_id,
      status,
      starts_at,
      expires_at,
      grant_reason,
      granted_by_user_id,
      revoked_at,
      revoked_by_user_id,
      revoke_reason
    )
    values (
      target_account_id,
      selected_sponsor_user_id,
      normalized_email,
      target_user_id,
      operator_grant.id,
      case when target_user_id is null then 'pending' else 'active' end,
      now(),
      null,
      normalized_reason,
      current_user_id,
      null,
      null,
      null
    )
    returning * into after_grant;

    action_name := 'technician_access.granted';
  else
    update public.technician_grants
    set
      sponsor_user_id = selected_sponsor_user_id,
      technician_user_id = coalesce(target_user_id, technician_user_id),
      operator_training_grant_id = operator_grant.id,
      status = case
        when coalesce(target_user_id, technician_user_id) is null then 'pending'
        else 'active'
      end,
      expires_at = null,
      grant_reason = normalized_reason,
      granted_by_user_id = current_user_id,
      revoked_at = null,
      revoked_by_user_id = null,
      revoke_reason = null
    where id = before_grant.id
    returning * into after_grant;

    action_name := 'technician_access.updated';
  end if;

  machine_result := public.technician_apply_machine_assignments(
    after_grant.id,
    normalized_machine_ids,
    normalized_reason,
    current_user_id
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
    action_name,
    'technician_grant',
    after_grant.id::text,
    after_grant.technician_user_id,
    coalesce(to_jsonb(before_grant), '{}'::jsonb),
    to_jsonb(after_grant),
    jsonb_build_object(
      'actor_authority_path', actor_authority_path,
      'account_id', after_grant.account_id,
      'sponsor_user_id', after_grant.sponsor_user_id,
      'technician_email', normalized_email,
      'technician_user_id', after_grant.technician_user_id,
      'operator_training_grant_id', after_grant.operator_training_grant_id,
      'reason', normalized_reason,
      'machine_ids_requested', normalized_machine_ids,
      'machine_ids_added', machine_result -> 'machineIdsAdded',
      'machine_ids_removed', machine_result -> 'machineIdsRemoved',
      'source_type', 'technician_grant',
      'source_id', after_grant.id
    )
  );

  return jsonb_build_object(
    'grantId', after_grant.id,
    'accountId', after_grant.account_id,
    'technicianEmail', after_grant.technician_email,
    'technicianUserId', after_grant.technician_user_id,
    'status', after_grant.status,
    'operatorTrainingGrantId', after_grant.operator_training_grant_id,
    'machineResult', machine_result
  );
end;
$$;

drop function if exists public.update_technician_machines(uuid, uuid[], text);
create or replace function public.update_technician_machines(
  p_grant_id uuid,
  p_machine_ids uuid[],
  p_reason text default 'Technician machine assignments updated'
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  current_user_id uuid;
  normalized_reason text;
  target_user_id uuid;
  selected_sponsor_user_id uuid;
  actor_authority_path text;
  operator_grant public.operator_training_grants;
  before_grant public.technician_grants;
  after_grant public.technician_grants;
  before_machine_ids uuid[];
  machine_result jsonb;
begin
  current_user_id := auth.uid();

  if current_user_id is null then
    raise exception 'Authentication required';
  end if;

  if p_grant_id is null then
    raise exception 'Technician grant ID is required';
  end if;

  normalized_reason := public.technician_assert_reason(p_reason);

  select *
  into before_grant
  from public.technician_grants grant_row
  where grant_row.id = p_grant_id
    and grant_row.revoked_at is null
  limit 1
  for update;

  if before_grant.id is null then
    raise exception 'No active Technician grant found';
  end if;

  actor_authority_path := public.technician_actor_authority_path(current_user_id, before_grant.account_id);

  if actor_authority_path is null then
    raise exception 'Access denied';
  end if;

  select coalesce(array_agg(assignment.machine_id order by assignment.machine_id), '{}'::uuid[])
  into before_machine_ids
  from public.technician_machine_assignments assignment
  where assignment.technician_grant_id = before_grant.id
    and public.technician_assignment_is_active(
      assignment.starts_at,
      assignment.expires_at,
      assignment.revoked_at,
      assignment.status
    );

  select auth_user.id
  into target_user_id
  from auth.users auth_user
  where public.normalize_technician_email(auth_user.email) = lower(before_grant.technician_email)
  limit 1;

  selected_sponsor_user_id := public.technician_pick_sponsor_user_id(current_user_id, before_grant.account_id);

  if selected_sponsor_user_id is null then
    raise exception 'No active Plus Account Owner sponsor found for this account';
  end if;

  operator_grant := public.technician_reuse_or_create_operator_training_grant(
    selected_sponsor_user_id,
    before_grant.technician_email,
    coalesce(target_user_id, before_grant.technician_user_id),
    normalized_reason,
    current_user_id
  );

  update public.technician_grants
  set
    sponsor_user_id = selected_sponsor_user_id,
    technician_user_id = coalesce(target_user_id, technician_user_id),
    operator_training_grant_id = operator_grant.id,
    status = case
      when coalesce(target_user_id, technician_user_id) is null then 'pending'
      else 'active'
    end,
    expires_at = null,
    grant_reason = normalized_reason,
    granted_by_user_id = current_user_id
  where id = before_grant.id
  returning * into after_grant;

  machine_result := public.technician_apply_machine_assignments(
    after_grant.id,
    coalesce(p_machine_ids, '{}'::uuid[]),
    normalized_reason,
    current_user_id
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
    'technician_access.machines_updated',
    'technician_grant',
    after_grant.id::text,
    after_grant.technician_user_id,
    jsonb_build_object(
      'grant', to_jsonb(before_grant),
      'machine_ids', before_machine_ids
    ),
    jsonb_build_object(
      'grant', to_jsonb(after_grant),
      'machine_ids', machine_result -> 'machineIdsAfter'
    ),
    jsonb_build_object(
      'actor_authority_path', actor_authority_path,
      'account_id', after_grant.account_id,
      'sponsor_user_id', after_grant.sponsor_user_id,
      'technician_email', after_grant.technician_email,
      'technician_user_id', after_grant.technician_user_id,
      'operator_training_grant_id', after_grant.operator_training_grant_id,
      'reason', normalized_reason,
      'machine_ids_added', machine_result -> 'machineIdsAdded',
      'machine_ids_removed', machine_result -> 'machineIdsRemoved',
      'source_type', 'technician_grant',
      'source_id', after_grant.id
    )
  );

  return jsonb_build_object(
    'grantId', after_grant.id,
    'accountId', after_grant.account_id,
    'technicianEmail', after_grant.technician_email,
    'technicianUserId', after_grant.technician_user_id,
    'status', after_grant.status,
    'operatorTrainingGrantId', after_grant.operator_training_grant_id,
    'machineResult', machine_result
  );
end;
$$;

drop function if exists public.revoke_technician_access(uuid, text);
create or replace function public.revoke_technician_access(
  p_grant_id uuid,
  p_reason text default 'Technician access revoked'
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  current_user_id uuid;
  normalized_reason text;
  actor_authority_path text;
  before_grant public.technician_grants;
  after_grant public.technician_grants;
  before_operator_grant public.operator_training_grants;
  after_operator_grant public.operator_training_grants;
  active_machine_ids uuid[];
  assignments_revoked integer := 0;
  reporting_entitlements_revoked integer := 0;
  operator_training_revoked boolean := false;
begin
  current_user_id := auth.uid();

  if current_user_id is null then
    raise exception 'Authentication required';
  end if;

  if p_grant_id is null then
    raise exception 'Technician grant ID is required';
  end if;

  normalized_reason := public.technician_assert_reason(p_reason);

  select *
  into before_grant
  from public.technician_grants grant_row
  where grant_row.id = p_grant_id
    and grant_row.revoked_at is null
  limit 1
  for update;

  if before_grant.id is null then
    raise exception 'No active Technician grant found';
  end if;

  actor_authority_path := public.technician_actor_authority_path(current_user_id, before_grant.account_id);

  if actor_authority_path is null then
    raise exception 'Access denied';
  end if;

  select coalesce(array_agg(assignment.machine_id order by assignment.machine_id), '{}'::uuid[])
  into active_machine_ids
  from public.technician_machine_assignments assignment
  where assignment.technician_grant_id = before_grant.id
    and public.technician_assignment_is_active(
      assignment.starts_at,
      assignment.expires_at,
      assignment.revoked_at,
      assignment.status
    );

  with revoked_assignments as (
    update public.technician_machine_assignments assignment
    set
      status = 'revoked',
      revoked_at = now(),
      revoked_by_user_id = current_user_id,
      revoke_reason = normalized_reason
    where assignment.technician_grant_id = before_grant.id
      and assignment.revoked_at is null
      and assignment.status <> 'revoked'
    returning assignment.id
  )
  select count(*)::integer
  into assignments_revoked
  from revoked_assignments;

  with revoked_entitlements as (
    update public.reporting_machine_entitlements entitlement
    set
      revoked_at = now(),
      revoked_by = current_user_id,
      revoke_reason = normalized_reason
    where entitlement.source_type = 'technician_grant'
      and entitlement.source_id = before_grant.id
      and public.reporting_entitlement_is_active(
        entitlement.starts_at,
        entitlement.expires_at,
        entitlement.revoked_at
      )
    returning entitlement.id
  )
  select count(*)::integer
  into reporting_entitlements_revoked
  from revoked_entitlements;

  update public.technician_grants
  set
    status = 'revoked',
    revoked_at = now(),
    revoked_by_user_id = current_user_id,
    revoke_reason = normalized_reason
  where id = before_grant.id
  returning * into after_grant;

  if before_grant.operator_training_grant_id is not null
    and not exists (
      select 1
      from public.technician_grants other_grant
      where other_grant.id <> before_grant.id
        and other_grant.operator_training_grant_id = before_grant.operator_training_grant_id
        and public.technician_grant_is_active(
          other_grant.starts_at,
          other_grant.expires_at,
          other_grant.revoked_at,
          other_grant.status
        )
    ) then
    select *
    into before_operator_grant
    from public.operator_training_grants operator_grant
    where operator_grant.id = before_grant.operator_training_grant_id
      and operator_grant.revoked_at is null
    limit 1
    for update;

    if before_operator_grant.id is not null then
      update public.operator_training_grants
      set
        revoked_at = now(),
        revoked_by_user_id = current_user_id,
        revoke_reason = normalized_reason
      where id = before_operator_grant.id
      returning * into after_operator_grant;

      operator_training_revoked := true;

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
        'operator_training.revoked',
        'operator_training_grant',
        after_operator_grant.id::text,
        after_operator_grant.operator_user_id,
        to_jsonb(before_operator_grant),
        to_jsonb(after_operator_grant),
        jsonb_build_object(
          'operator_email', after_operator_grant.operator_email,
          'reason', normalized_reason,
          'source_type', 'technician_grant',
          'source_id', after_grant.id
        )
      );
    end if;
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
    'technician_access.revoked',
    'technician_grant',
    after_grant.id::text,
    after_grant.technician_user_id,
    to_jsonb(before_grant),
    to_jsonb(after_grant),
    jsonb_build_object(
      'actor_authority_path', actor_authority_path,
      'account_id', after_grant.account_id,
      'sponsor_user_id', after_grant.sponsor_user_id,
      'technician_email', after_grant.technician_email,
      'technician_user_id', after_grant.technician_user_id,
      'operator_training_grant_id', after_grant.operator_training_grant_id,
      'operator_training_revoked', operator_training_revoked,
      'reason', normalized_reason,
      'machine_ids_removed', active_machine_ids,
      'assignments_revoked', assignments_revoked,
      'reporting_entitlements_revoked', reporting_entitlements_revoked,
      'source_type', 'technician_grant',
      'source_id', after_grant.id
    )
  );

  return jsonb_build_object(
    'grantId', after_grant.id,
    'accountId', after_grant.account_id,
    'technicianEmail', after_grant.technician_email,
    'technicianUserId', after_grant.technician_user_id,
    'status', after_grant.status,
    'operatorTrainingGrantId', after_grant.operator_training_grant_id,
    'operatorTrainingRevoked', operator_training_revoked,
    'machineIdsRemoved', active_machine_ids,
    'assignmentsRevoked', assignments_revoked,
    'reportingEntitlementsRevoked', reporting_entitlements_revoked
  );
end;
$$;

drop function if exists public.get_my_technician_grants();
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
      'canManage', public.can_manage_technician_grants_for_account(current_user_id, grant_row.account_id),
      'authorityPath', coalesce(public.technician_actor_authority_path(current_user_id, grant_row.account_id), 'technician'),
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
  where public.can_manage_technician_grants_for_account(current_user_id, grant_row.account_id)
    or public.can_access_technician_grant(current_user_id, grant_row.id);

  return result;
end;
$$;

drop function if exists public.admin_reconcile_technician_entitlements(text);
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
      and (
        not public.has_plus_access(grant_row.sponsor_user_id)
        or not exists (
          select 1
          from public.customer_account_memberships membership
          where membership.account_id = grant_row.account_id
            and membership.user_id = grant_row.sponsor_user_id
            and membership.active
            and membership.role = 'owner'
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

comment on function public.grant_technician_access(text, uuid[], text) is
  'Grant or update Technician access by normalized email for machines controlled by a Plus Account Owner or super-admin override.';

comment on function public.update_technician_machines(uuid, uuid[], text) is
  'Replace a Technician grant machine set in one audited transaction, revoking only Technician-derived reporting entitlements for removed machines.';

comment on function public.revoke_technician_access(uuid, text) is
  'Revoke a Technician grant, its machine assignments, and Technician-derived reporting entitlements without touching manual reporting access.';

comment on function public.get_my_technician_grants() is
  'List Technician grants visible to the current account owner, super-admin, sponsor, or Technician.';

comment on function public.admin_reconcile_technician_entitlements(text) is
  'Super-admin reconciliation hook that suspends Technician grants or assignments after sponsor/account/machine loss and audits the automated suspension.';

revoke execute on function public.technician_assert_reason(text) from public;
revoke execute on function public.technician_actor_authority_path(uuid, uuid) from public;
revoke execute on function public.technician_pick_sponsor_user_id(uuid, uuid) from public;
revoke execute on function public.technician_reuse_or_create_operator_training_grant(uuid, text, uuid, text, uuid) from public;
revoke execute on function public.technician_apply_machine_assignments(uuid, uuid[], text, uuid) from public;

grant execute on function public.grant_technician_access(text, uuid[], text) to authenticated;
grant execute on function public.update_technician_machines(uuid, uuid[], text) to authenticated;
grant execute on function public.revoke_technician_access(uuid, text) to authenticated;
grant execute on function public.get_my_technician_grants() to authenticated;
grant execute on function public.admin_reconcile_technician_entitlements(text) to authenticated;

select pg_notify('pgrst', 'reload schema');
