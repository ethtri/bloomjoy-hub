-- Restore the Super Admin revoke RPC expected by the Admin Access console and
-- the #379 live permission-boundary validator.

create or replace function public.admin_revoke_super_admin(
  p_target_user_id uuid,
  p_reason text default null
)
returns public.admin_roles
language plpgsql
security definer
set search_path = public, auth
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

revoke execute on function public.admin_revoke_super_admin(uuid, text)
  from public, anon;

grant execute on function public.admin_revoke_super_admin(uuid, text)
  to authenticated;

select pg_notify('pgrst', 'reload schema');
