-- Admin governance polish (issue #47)

drop function if exists public.admin_list_super_admin_roles();

create or replace function public.admin_list_super_admin_roles()
returns table (
  id uuid,
  user_id uuid,
  user_email text,
  role text,
  active boolean,
  granted_by uuid,
  granted_at timestamptz,
  revoked_by uuid,
  revoked_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_super_admin(auth.uid()) then
    raise exception 'Admin access required';
  end if;

  return query
  select
    ar.id,
    ar.user_id,
    u.email as user_email,
    ar.role,
    ar.active,
    ar.granted_by,
    ar.granted_at,
    ar.revoked_by,
    ar.revoked_at,
    ar.created_at,
    ar.updated_at
  from public.admin_roles ar
  left join auth.users u
    on u.id = ar.user_id
  where ar.role = 'super_admin'
  order by ar.active desc, ar.updated_at desc;
end;
$$;

grant execute on function public.admin_list_super_admin_roles() to authenticated;

drop function if exists public.admin_grant_super_admin_by_email(text, text);

create or replace function public.admin_grant_super_admin_by_email(
  p_target_email text,
  p_reason text default null
)
returns public.admin_roles
language plpgsql
security definer
set search_path = public
as $$
declare
  target_user_id uuid;
  before_row public.admin_roles;
  after_row public.admin_roles;
  normalized_email text;
  normalized_reason text;
begin
  if not public.is_super_admin(auth.uid()) then
    raise exception 'Admin access required';
  end if;

  normalized_email := trim(lower(coalesce(p_target_email, '')));
  normalized_reason := trim(coalesce(p_reason, ''));

  if normalized_email = '' then
    raise exception 'Target email is required';
  end if;

  select u.id
  into target_user_id
  from auth.users u
  where lower(u.email) = normalized_email
  limit 1;

  if target_user_id is null then
    raise exception 'No user found for email %', normalized_email;
  end if;

  select *
  into before_row
  from public.admin_roles
  where user_id = target_user_id
    and role = 'super_admin'
  order by updated_at desc
  limit 1;

  if before_row.id is null then
    insert into public.admin_roles (
      user_id,
      role,
      active,
      granted_by,
      granted_at,
      revoked_by,
      revoked_at
    )
    values (
      target_user_id,
      'super_admin',
      true,
      auth.uid(),
      now(),
      null,
      null
    )
    returning * into after_row;
  elsif before_row.active = true then
    after_row := before_row;
  else
    update public.admin_roles
    set
      active = true,
      granted_by = auth.uid(),
      granted_at = now(),
      revoked_by = null,
      revoked_at = null
    where id = before_row.id
    returning * into after_row;
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
    auth.uid(),
    'admin_role.granted',
    'admin_role',
    after_row.id::text,
    after_row.user_id,
    coalesce(to_jsonb(before_row), '{}'::jsonb),
    to_jsonb(after_row),
    jsonb_build_object('reason', normalized_reason, 'target_email', normalized_email)
  );

  return after_row;
end;
$$;

grant execute on function public.admin_grant_super_admin_by_email(text, text) to authenticated;

drop function if exists public.admin_revoke_super_admin(uuid, text);

create or replace function public.admin_revoke_super_admin(
  p_target_user_id uuid,
  p_reason text default null
)
returns public.admin_roles
language plpgsql
security definer
set search_path = public
as $$
declare
  before_row public.admin_roles;
  after_row public.admin_roles;
  normalized_reason text;
  active_admin_count bigint;
begin
  if not public.is_super_admin(auth.uid()) then
    raise exception 'Admin access required';
  end if;

  normalized_reason := trim(coalesce(p_reason, ''));

  if p_target_user_id is null then
    raise exception 'Target user ID is required';
  end if;

  if normalized_reason = '' then
    raise exception 'Revoke reason is required';
  end if;

  select count(*)
  into active_admin_count
  from public.admin_roles ar
  where ar.role = 'super_admin'
    and ar.active = true;

  if active_admin_count <= 1 and p_target_user_id = auth.uid() then
    raise exception 'Cannot revoke the last active super-admin';
  end if;

  select *
  into before_row
  from public.admin_roles
  where user_id = p_target_user_id
    and role = 'super_admin'
    and active = true
  order by updated_at desc
  limit 1;

  if before_row.id is null then
    raise exception 'No active super-admin role found for target user';
  end if;

  update public.admin_roles
  set
    active = false,
    revoked_by = auth.uid(),
    revoked_at = now()
  where id = before_row.id
  returning * into after_row;

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
    auth.uid(),
    'admin_role.revoked',
    'admin_role',
    after_row.id::text,
    after_row.user_id,
    to_jsonb(before_row),
    to_jsonb(after_row),
    jsonb_build_object('reason', normalized_reason)
  );

  return after_row;
end;
$$;

grant execute on function public.admin_revoke_super_admin(uuid, text) to authenticated;

drop function if exists public.admin_get_audit_log(text, text, text, integer);

create or replace function public.admin_get_audit_log(
  p_action text default null,
  p_entity_type text default null,
  p_search text default null,
  p_limit integer default 200
)
returns table (
  id uuid,
  created_at timestamptz,
  action text,
  entity_type text,
  entity_id text,
  actor_user_id uuid,
  actor_email text,
  target_user_id uuid,
  target_email text,
  before jsonb,
  after jsonb,
  meta jsonb
)
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_action text;
  normalized_entity_type text;
  normalized_search text;
  safe_limit integer;
begin
  if not public.is_super_admin(auth.uid()) then
    raise exception 'Admin access required';
  end if;

  normalized_action := nullif(trim(lower(coalesce(p_action, ''))), '');
  normalized_entity_type := nullif(trim(lower(coalesce(p_entity_type, ''))), '');
  normalized_search := nullif(trim(lower(coalesce(p_search, ''))), '');
  safe_limit := least(greatest(coalesce(p_limit, 200), 1), 500);

  return query
  select
    log.id,
    log.created_at,
    log.action,
    log.entity_type,
    log.entity_id,
    log.actor_user_id,
    actor.email as actor_email,
    log.target_user_id,
    target.email as target_email,
    log.before,
    log.after,
    log.meta
  from public.admin_audit_log log
  left join auth.users actor on actor.id = log.actor_user_id
  left join auth.users target on target.id = log.target_user_id
  where (
    normalized_action is null
    or lower(log.action) = normalized_action
  )
  and (
    normalized_entity_type is null
    or lower(log.entity_type) = normalized_entity_type
  )
  and (
    normalized_search is null
    or lower(coalesce(log.entity_id, '')) like '%' || normalized_search || '%'
    or lower(coalesce(actor.email, '')) like '%' || normalized_search || '%'
    or lower(coalesce(target.email, '')) like '%' || normalized_search || '%'
    or lower(log.action) like '%' || normalized_search || '%'
    or lower(log.entity_type) like '%' || normalized_search || '%'
  )
  order by log.created_at desc
  limit safe_limit;
end;
$$;

grant execute on function public.admin_get_audit_log(text, text, text, integer) to authenticated;
