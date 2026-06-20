-- Allow Super Admin Technician wrappers to manage multiple assigned reporting machines.

drop function if exists public.admin_grant_technician_access(text, uuid, uuid, text);
drop function if exists public.admin_update_technician_machines(uuid, uuid, text);

create or replace function public.admin_grant_technician_access(
  p_target_email text,
  p_account_id uuid,
  p_machine_ids uuid[] default '{}'::uuid[],
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
  normalized_machine_ids uuid[];
  target_account_id uuid;
  requested_machine_count integer;
  active_machine_count integer;
  account_count integer;
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

  select coalesce(array_agg(machine_id order by machine_id), '{}'::uuid[])
  into normalized_machine_ids
  from (
    select distinct requested.machine_id
    from unnest(coalesce(p_machine_ids, '{}'::uuid[])) as requested(machine_id)
    where requested.machine_id is not null
  ) distinct_requested;

  requested_machine_count := coalesce(array_length(normalized_machine_ids, 1), 0);

  if requested_machine_count = 0 and p_account_id is null then
    raise exception 'Select an account for training-only Technician access';
  end if;

  if requested_machine_count > 0 then
    select
      count(*)::integer,
      count(distinct machine.account_id)::integer
    into active_machine_count, account_count
    from public.reporting_machines machine
    join public.customer_accounts account on account.id = machine.account_id
    where machine.id = any(normalized_machine_ids)
      and machine.status = 'active'
      and account.status = 'active';

    if active_machine_count <> requested_machine_count then
      raise exception 'One or more selected machines are unavailable';
    end if;

    if account_count <> 1 then
      raise exception 'Selected machines must belong to one active account';
    end if;

    select machine.account_id
    into target_account_id
    from public.reporting_machines machine
    where machine.id = any(normalized_machine_ids)
      and machine.status = 'active'
    limit 1;

    if p_account_id is not null and p_account_id <> target_account_id then
      raise exception 'Selected machines do not belong to the selected account';
    end if;
  else
    target_account_id := p_account_id;
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
    normalized_machine_ids,
    normalized_reason,
    target_account_id,
    null
  );

  if requested_machine_count = 0 then
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
      'machine_ids', normalized_machine_ids,
      'machine_count', requested_machine_count,
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
  p_machine_ids uuid[] default '{}'::uuid[],
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
  normalized_machine_ids uuid[];
  requested_machine_count integer;
  valid_machine_count integer;
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

  select coalesce(array_agg(machine_id order by machine_id), '{}'::uuid[])
  into normalized_machine_ids
  from (
    select distinct requested.machine_id
    from unnest(coalesce(p_machine_ids, '{}'::uuid[])) as requested(machine_id)
    where requested.machine_id is not null
  ) distinct_requested;

  requested_machine_count := coalesce(array_length(normalized_machine_ids, 1), 0);

  if requested_machine_count > 0 then
    select count(*)::integer
    into valid_machine_count
    from public.reporting_machines machine
    where machine.id = any(normalized_machine_ids)
      and machine.account_id = grant_row.account_id
      and machine.status = 'active';

    if valid_machine_count <> requested_machine_count then
      raise exception 'One or more selected machines are unavailable or outside this Technician account';
    end if;
  end if;

  update_result := public.update_technician_machines(
    grant_row.id,
    normalized_machine_ids,
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
      'machine_ids', normalized_machine_ids,
      'machine_count', requested_machine_count,
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
      'machine_count', coalesce(array_length(current_machine_ids, 1), 0),
      'reason', normalized_reason,
      'admin_wrapper', true,
      'source_type', 'technician_grant',
      'source_id', grant_row.id
    )
  );

  return update_result;
end;
$$;

comment on function public.admin_grant_technician_access(text, uuid, uuid[], text) is
  'Super-admin grant/update wrapper that limits Technician reporting to selected machines or training-only access.';

comment on function public.admin_update_technician_machines(uuid, uuid[], text) is
  'Super-admin Technician machine-scope update wrapper that revokes only Technician-sourced reporting entitlements for removed machines.';

comment on function public.admin_renew_technician_access(uuid, text) is
  'Super-admin Technician renewal wrapper that preserves the current assigned machine scope.';

revoke execute on function public.admin_grant_technician_access(text, uuid, uuid[], text)
  from public, anon, authenticated, service_role;
revoke execute on function public.admin_update_technician_machines(uuid, uuid[], text)
  from public, anon, authenticated, service_role;
revoke execute on function public.admin_renew_technician_access(uuid, text)
  from public, anon, authenticated, service_role;

grant execute on function public.admin_grant_technician_access(text, uuid, uuid[], text)
  to authenticated;
grant execute on function public.admin_update_technician_machines(uuid, uuid[], text)
  to authenticated;
grant execute on function public.admin_renew_technician_access(uuid, text)
  to authenticated;

select pg_notify('pgrst', 'reload schema');
