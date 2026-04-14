-- Training-only operator access grants.
--
-- This intentionally stays separate from Bloomjoy Plus membership. Operators can
-- access members-only training content when sponsored by an active Plus member
-- or a super-admin, but they do not receive Plus portal benefits.

create table if not exists public.operator_training_grants (
  id uuid primary key default gen_random_uuid(),
  sponsor_user_id uuid not null references auth.users (id) on delete cascade,
  operator_email text not null,
  operator_user_id uuid references auth.users (id) on delete set null,
  starts_at timestamptz not null default now(),
  expires_at timestamptz,
  grant_reason text not null default 'Operator training access',
  granted_by_user_id uuid references auth.users (id) on delete set null,
  revoked_at timestamptz,
  revoked_by_user_id uuid references auth.users (id) on delete set null,
  revoke_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint operator_training_grants_email_present check (length(trim(operator_email)) > 0),
  constraint operator_training_grants_valid_window check (
    expires_at is null
    or expires_at > starts_at
  ),
  constraint operator_training_grants_reason_present check (length(trim(grant_reason)) > 0),
  constraint operator_training_grants_revoke_reason_required check (
    revoked_at is null
    or length(trim(coalesce(revoke_reason, ''))) > 0
  )
);

create unique index if not exists operator_training_grants_one_open_email_per_sponsor_idx
  on public.operator_training_grants (sponsor_user_id, lower(operator_email))
  where revoked_at is null;

create index if not exists operator_training_grants_sponsor_user_id_idx
  on public.operator_training_grants (sponsor_user_id);

create index if not exists operator_training_grants_operator_user_id_idx
  on public.operator_training_grants (operator_user_id);

create index if not exists operator_training_grants_operator_email_idx
  on public.operator_training_grants (lower(operator_email))
  where revoked_at is null;

drop trigger if exists operator_training_grants_set_updated_at on public.operator_training_grants;

create trigger operator_training_grants_set_updated_at
before update on public.operator_training_grants
for each row execute function public.set_updated_at();

alter table public.operator_training_grants enable row level security;

drop policy if exists "operator_training_grants_select_related" on public.operator_training_grants;

create policy "operator_training_grants_select_related"
on public.operator_training_grants
for select
to authenticated
using (
  sponsor_user_id = (select auth.uid())
  or operator_user_id = (select auth.uid())
  or exists (
    select 1
    from auth.users u
    where u.id = (select auth.uid())
      and lower(u.email) = lower(operator_email)
  )
  or public.is_super_admin((select auth.uid()))
);

create or replace function public.normalize_operator_training_email(email_input text)
returns text
language sql
immutable
as $$
  select lower(trim(coalesce(email_input, '')));
$$;

create or replace function public.has_active_paid_plus_subscription(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.subscriptions s
    where s.user_id = uid
      and s.status in ('active', 'trialing')
      and (s.current_period_end is null or s.current_period_end > now())
  );
$$;

create or replace function public.can_manage_operator_training_grants_for_user(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_super_admin(uid)
    or public.has_plus_access(uid);
$$;

create or replace function public.has_active_operator_training_grant(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1
    from auth.users u
    join public.operator_training_grants g
      on (
        g.operator_user_id = u.id
        or lower(g.operator_email) = lower(u.email)
      )
    where u.id = uid
      and g.revoked_at is null
      and g.starts_at <= now()
      and (g.expires_at is null or g.expires_at > now())
      and public.has_plus_access(g.sponsor_user_id)
  );
$$;

create or replace function public.get_portal_access_tier_for_user(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_user_id is null then 'baseline'
    when public.is_super_admin(p_user_id) then 'plus'
    when public.has_plus_access(p_user_id) then 'plus'
    when public.has_active_operator_training_grant(p_user_id) then 'training'
    else 'baseline'
  end;
$$;

create or replace function public.can_access_members_only_training()
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select public.get_portal_access_tier_for_user(auth.uid()) in ('training', 'plus');
$$;

create or replace function public.can_access_plus_portal()
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select public.get_portal_access_tier_for_user(auth.uid()) = 'plus';
$$;

drop function if exists public.get_my_portal_access_context();

create or replace function public.get_my_portal_access_context()
returns table (
  access_tier text,
  is_plus_member boolean,
  is_training_operator boolean,
  is_admin boolean,
  can_manage_operator_training boolean
)
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  current_user_id uuid;
  resolved_tier text;
begin
  current_user_id := auth.uid();

  if current_user_id is null then
    raise exception 'Authentication required';
  end if;

  resolved_tier := public.get_portal_access_tier_for_user(current_user_id);

  return query
  select
    resolved_tier as access_tier,
    public.has_plus_access(current_user_id) as is_plus_member,
    public.has_active_operator_training_grant(current_user_id) as is_training_operator,
    public.is_super_admin(current_user_id) as is_admin,
    public.can_manage_operator_training_grants_for_user(current_user_id)
      as can_manage_operator_training;
end;
$$;

drop function if exists public.get_my_operator_training_grants();

create or replace function public.get_my_operator_training_grants()
returns table (
  id uuid,
  sponsor_user_id uuid,
  operator_email text,
  operator_user_id uuid,
  starts_at timestamptz,
  expires_at timestamptz,
  grant_reason text,
  revoked_at timestamptz,
  revoke_reason text,
  created_at timestamptz,
  updated_at timestamptz,
  is_active boolean
)
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  current_user_id uuid;
begin
  current_user_id := auth.uid();

  if current_user_id is null then
    raise exception 'Authentication required';
  end if;

  if not public.can_manage_operator_training_grants_for_user(current_user_id) then
    raise exception 'Bloomjoy Plus required';
  end if;

  return query
  select
    g.id,
    g.sponsor_user_id,
    g.operator_email,
    g.operator_user_id,
    g.starts_at,
    g.expires_at,
    g.grant_reason,
    g.revoked_at,
    g.revoke_reason,
    g.created_at,
    g.updated_at,
    (
      g.revoked_at is null
      and g.starts_at <= now()
      and (g.expires_at is null or g.expires_at > now())
      and public.can_manage_operator_training_grants_for_user(g.sponsor_user_id)
    ) as is_active
  from public.operator_training_grants g
  where g.sponsor_user_id = current_user_id
  order by
    case when g.revoked_at is null then 0 else 1 end,
    g.updated_at desc;
end;
$$;

drop function if exists public.grant_operator_training_access(text, timestamptz, text);

create or replace function public.grant_operator_training_access(
  p_operator_email text,
  p_expires_at timestamptz default null,
  p_reason text default 'Operator training access'
)
returns public.operator_training_grants
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  current_user_id uuid;
  current_user_email text;
  normalized_email text;
  normalized_reason text;
  existing_user_id uuid;
  before_row public.operator_training_grants;
  after_row public.operator_training_grants;
  action_name text;
begin
  current_user_id := auth.uid();

  if current_user_id is null then
    raise exception 'Authentication required';
  end if;

  if not public.can_manage_operator_training_grants_for_user(current_user_id) then
    raise exception 'Bloomjoy Plus required';
  end if;

  normalized_email := public.normalize_operator_training_email(p_operator_email);
  normalized_reason := trim(coalesce(p_reason, ''));

  if normalized_email = '' then
    raise exception 'Operator email is required';
  end if;

  if normalized_reason = '' then
    raise exception 'Grant reason is required';
  end if;

  if p_expires_at is not null and p_expires_at <= now() then
    raise exception 'Expiry must be in the future';
  end if;

  select public.normalize_operator_training_email(u.email)
  into current_user_email
  from auth.users u
  where u.id = current_user_id
  limit 1;

  if current_user_email = normalized_email then
    raise exception 'Use a different email for operator training access';
  end if;

  select u.id
  into existing_user_id
  from auth.users u
  where public.normalize_operator_training_email(u.email) = normalized_email
  limit 1;

  select *
  into before_row
  from public.operator_training_grants g
  where g.sponsor_user_id = current_user_id
    and lower(g.operator_email) = normalized_email
    and g.revoked_at is null
  limit 1;

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
      current_user_id,
      normalized_email,
      existing_user_id,
      now(),
      p_expires_at,
      normalized_reason,
      current_user_id
    )
    returning * into after_row;

    action_name := 'operator_training.granted';
  else
    update public.operator_training_grants
    set
      operator_user_id = coalesce(existing_user_id, operator_user_id),
      expires_at = p_expires_at,
      grant_reason = normalized_reason,
      granted_by_user_id = current_user_id
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
    current_user_id,
    action_name,
    'operator_training_grant',
    after_row.id::text,
    after_row.operator_user_id,
    coalesce(to_jsonb(before_row), '{}'::jsonb),
    to_jsonb(after_row),
    jsonb_build_object(
      'operator_email',
      normalized_email,
      'reason',
      normalized_reason
    )
  );

  return after_row;
end;
$$;

drop function if exists public.revoke_operator_training_access(uuid, text);

create or replace function public.revoke_operator_training_access(
  p_grant_id uuid,
  p_reason text default 'Operator training access revoked'
)
returns public.operator_training_grants
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  current_user_id uuid;
  normalized_reason text;
  before_row public.operator_training_grants;
  after_row public.operator_training_grants;
begin
  current_user_id := auth.uid();

  if current_user_id is null then
    raise exception 'Authentication required';
  end if;

  normalized_reason := trim(coalesce(p_reason, ''));

  if p_grant_id is null then
    raise exception 'Grant ID is required';
  end if;

  if normalized_reason = '' then
    raise exception 'Revoke reason is required';
  end if;

  select *
  into before_row
  from public.operator_training_grants g
  where g.id = p_grant_id
    and g.revoked_at is null
  limit 1;

  if before_row.id is null then
    raise exception 'No active operator training grant found';
  end if;

  if before_row.sponsor_user_id <> current_user_id
    and not public.is_super_admin(current_user_id) then
    raise exception 'Access denied';
  end if;

  update public.operator_training_grants
  set
    revoked_at = now(),
    revoked_by_user_id = current_user_id,
    revoke_reason = normalized_reason
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
    current_user_id,
    'operator_training.revoked',
    'operator_training_grant',
    after_row.id::text,
    after_row.operator_user_id,
    to_jsonb(before_row),
    to_jsonb(after_row),
    jsonb_build_object(
      'operator_email',
      after_row.operator_email,
      'reason',
      normalized_reason
    )
  );

  return after_row;
end;
$$;

revoke execute on function public.has_active_paid_plus_subscription(uuid) from public;
revoke execute on function public.can_manage_operator_training_grants_for_user(uuid) from public;
revoke execute on function public.has_active_operator_training_grant(uuid) from public;
revoke execute on function public.get_portal_access_tier_for_user(uuid) from public;

grant execute on function public.can_access_members_only_training() to authenticated;
grant execute on function public.can_access_plus_portal() to authenticated;
grant execute on function public.get_my_portal_access_context() to authenticated;
grant execute on function public.get_my_operator_training_grants() to authenticated;
grant execute on function public.grant_operator_training_access(text, timestamptz, text) to authenticated;
grant execute on function public.revoke_operator_training_access(uuid, text) to authenticated;
