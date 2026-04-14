-- Free Bloomjoy Plus access grants managed by super admins.

create table if not exists public.plus_access_grants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  starts_at timestamptz not null default now(),
  expires_at timestamptz not null,
  grant_reason text not null check (length(trim(grant_reason)) > 0),
  granted_by uuid references auth.users (id) on delete set null,
  revoked_at timestamptz,
  revoked_by uuid references auth.users (id) on delete set null,
  revoke_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint plus_access_grants_valid_window check (expires_at > starts_at),
  constraint plus_access_grants_revoke_reason_required check (
    revoked_at is null
    or length(trim(coalesce(revoke_reason, ''))) > 0
  )
);

create unique index if not exists plus_access_grants_one_open_per_user_idx
  on public.plus_access_grants (user_id)
  where revoked_at is null;

create index if not exists plus_access_grants_user_id_idx
  on public.plus_access_grants (user_id);

create index if not exists plus_access_grants_open_expiry_idx
  on public.plus_access_grants (user_id, expires_at)
  where revoked_at is null;

drop trigger if exists plus_access_grants_set_updated_at on public.plus_access_grants;

create trigger plus_access_grants_set_updated_at
before update on public.plus_access_grants
for each row execute function public.set_updated_at();

alter table public.plus_access_grants enable row level security;

drop policy if exists "plus_access_grants_select_super_admin" on public.plus_access_grants;

create policy "plus_access_grants_select_super_admin"
on public.plus_access_grants
for select
using ((select public.is_super_admin(auth.uid())));

create or replace function public.has_active_plus_grant(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.plus_access_grants g
    where g.user_id = uid
      and g.revoked_at is null
      and g.starts_at <= now()
      and g.expires_at > now()
  );
$$;

create or replace function public.has_plus_access(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    exists (
      select 1
      from public.subscriptions s
      where s.user_id = uid
        and s.status in ('active', 'trialing')
        and (s.current_period_end is null or s.current_period_end > now())
    )
    or public.has_active_plus_grant(uid);
$$;

create or replace function public.can_access_members_only_training()
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select public.has_plus_access(auth.uid())
    or public.is_super_admin(auth.uid());
$$;

revoke execute on function public.has_active_plus_grant(uuid) from public;
revoke execute on function public.has_plus_access(uuid) from public;
grant execute on function public.can_access_members_only_training() to authenticated;

drop function if exists public.get_my_plus_access();

create or replace function public.get_my_plus_access()
returns table (
  has_plus_access boolean,
  source text,
  membership_status text,
  current_period_end timestamptz,
  cancel_at_period_end boolean,
  paid_subscription_active boolean,
  free_grant_id uuid,
  free_grant_starts_at timestamptz,
  free_grant_expires_at timestamptz,
  free_grant_active boolean
)
language plpgsql
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

  return query
  with subscription_candidates as (
    select
      s.status,
      s.current_period_end,
      s.cancel_at_period_end,
      s.updated_at,
      (
        s.status in ('active', 'trialing')
        and (s.current_period_end is null or s.current_period_end > now())
      ) as is_active
    from public.subscriptions s
    where s.user_id = current_user_id
  ),
  selected_subscription as (
    select *
    from subscription_candidates sc
    order by sc.is_active desc, sc.updated_at desc
    limit 1
  ),
  selected_grant as (
    select
      g.id,
      g.starts_at,
      g.expires_at,
      (
        g.revoked_at is null
        and g.starts_at <= now()
        and g.expires_at > now()
      ) as is_active
    from public.plus_access_grants g
    where g.user_id = current_user_id
      and g.revoked_at is null
    order by g.updated_at desc
    limit 1
  ),
  resolved as (
    select
      coalesce(ss.is_active, false) as paid_active,
      coalesce(sg.is_active, false) as grant_active,
      public.is_super_admin(current_user_id) as admin_active,
      ss.status,
      ss.current_period_end,
      ss.cancel_at_period_end,
      sg.id as grant_id,
      sg.starts_at as grant_starts_at,
      sg.expires_at as grant_expires_at
    from (select 1) anchor
    left join selected_subscription ss on true
    left join selected_grant sg on true
  )
  select
    (r.paid_active or r.grant_active or r.admin_active) as has_plus_access,
    case
      when r.paid_active then 'paid_subscription'
      when r.grant_active then 'free_grant'
      when r.admin_active then 'admin'
      else 'none'
    end as source,
    coalesce(r.status, 'none') as membership_status,
    r.current_period_end,
    coalesce(r.cancel_at_period_end, false) as cancel_at_period_end,
    r.paid_active as paid_subscription_active,
    r.grant_id as free_grant_id,
    r.grant_starts_at as free_grant_starts_at,
    r.grant_expires_at as free_grant_expires_at,
    r.grant_active as free_grant_active
  from resolved r;
end;
$$;

grant execute on function public.get_my_plus_access() to authenticated;

drop function if exists public.admin_grant_plus_access(uuid, timestamptz, text);

create or replace function public.admin_grant_plus_access(
  p_customer_user_id uuid,
  p_expires_at timestamptz,
  p_reason text
)
returns public.plus_access_grants
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  before_row public.plus_access_grants;
  after_row public.plus_access_grants;
  normalized_reason text;
  action_name text;
begin
  if not public.is_super_admin(auth.uid()) then
    raise exception 'Admin access required';
  end if;

  normalized_reason := trim(coalesce(p_reason, ''));

  if p_customer_user_id is null then
    raise exception 'Customer user ID is required';
  end if;

  if not exists (
    select 1
    from auth.users u
    where u.id = p_customer_user_id
  ) then
    raise exception 'No user found for target account';
  end if;

  if normalized_reason = '' then
    raise exception 'Grant reason is required';
  end if;

  if p_expires_at is null or p_expires_at <= now() then
    raise exception 'Grant expiry must be in the future';
  end if;

  if exists (
    select 1
    from public.subscriptions s
    where s.user_id = p_customer_user_id
      and s.status in ('active', 'trialing')
      and (s.current_period_end is null or s.current_period_end > now())
      and s.cancel_at_period_end = false
  ) then
    raise exception 'Cancel or schedule cancellation for the paid Stripe subscription before granting free Plus access';
  end if;

  select *
  into before_row
  from public.plus_access_grants g
  where g.user_id = p_customer_user_id
    and g.revoked_at is null
  limit 1;

  if before_row.id is null then
    insert into public.plus_access_grants (
      user_id,
      starts_at,
      expires_at,
      grant_reason,
      granted_by
    )
    values (
      p_customer_user_id,
      now(),
      p_expires_at,
      normalized_reason,
      auth.uid()
    )
    returning * into after_row;

    action_name := 'plus_access.granted';
  else
    update public.plus_access_grants
    set
      expires_at = p_expires_at,
      grant_reason = normalized_reason,
      granted_by = auth.uid()
    where id = before_row.id
    returning * into after_row;

    action_name := 'plus_access.extended';
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
    action_name,
    'plus_access_grant',
    after_row.id::text,
    after_row.user_id,
    coalesce(to_jsonb(before_row), '{}'::jsonb),
    to_jsonb(after_row),
    jsonb_build_object(
      'reason',
      normalized_reason,
      'expires_at',
      p_expires_at
    )
  );

  return after_row;
end;
$$;

grant execute on function public.admin_grant_plus_access(uuid, timestamptz, text) to authenticated;

drop function if exists public.admin_revoke_plus_access(uuid, text);

create or replace function public.admin_revoke_plus_access(
  p_grant_id uuid,
  p_reason text
)
returns public.plus_access_grants
language plpgsql
security definer
set search_path = public
as $$
declare
  before_row public.plus_access_grants;
  after_row public.plus_access_grants;
  normalized_reason text;
begin
  if not public.is_super_admin(auth.uid()) then
    raise exception 'Admin access required';
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
  from public.plus_access_grants g
  where g.id = p_grant_id
    and g.revoked_at is null
  limit 1;

  if before_row.id is null then
    raise exception 'No active or open Plus grant found';
  end if;

  update public.plus_access_grants
  set
    revoked_at = now(),
    revoked_by = auth.uid(),
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
    auth.uid(),
    'plus_access.revoked',
    'plus_access_grant',
    after_row.id::text,
    after_row.user_id,
    to_jsonb(before_row),
    to_jsonb(after_row),
    jsonb_build_object('reason', normalized_reason)
  );

  return after_row;
end;
$$;

grant execute on function public.admin_revoke_plus_access(uuid, text) to authenticated;

drop function if exists public.admin_get_account_summaries(text);

create or replace function public.admin_get_account_summaries(
  p_search text default null
)
returns table (
  user_id uuid,
  customer_email text,
  membership_status text,
  current_period_end timestamptz,
  total_orders bigint,
  last_order_at timestamptz,
  open_support_requests bigint,
  total_machine_count bigint,
  last_machine_update_at timestamptz,
  membership_cancel_at_period_end boolean,
  paid_subscription_active boolean,
  plus_access_source text,
  has_plus_access boolean,
  plus_grant_id uuid,
  plus_grant_starts_at timestamptz,
  plus_grant_expires_at timestamptz,
  plus_grant_active boolean
)
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  normalized_search text;
begin
  if not public.is_super_admin(auth.uid()) then
    raise exception 'Admin access required';
  end if;

  normalized_search := nullif(trim(lower(coalesce(p_search, ''))), '');

  return query
  with membership_candidates as (
    select
      s.user_id,
      s.status,
      s.current_period_end,
      s.cancel_at_period_end,
      s.updated_at,
      (
        s.status in ('active', 'trialing')
        and (s.current_period_end is null or s.current_period_end > now())
      ) as paid_subscription_active
    from public.subscriptions s
  ),
  membership as (
    select distinct on (mc.user_id)
      mc.user_id,
      mc.status,
      mc.current_period_end,
      mc.cancel_at_period_end,
      mc.updated_at,
      mc.paid_subscription_active
    from membership_candidates mc
    order by mc.user_id, mc.paid_subscription_active desc, mc.updated_at desc
  ),
  grant_rollup as (
    select
      g.user_id,
      g.id,
      g.starts_at,
      g.expires_at,
      g.updated_at,
      (
        g.revoked_at is null
        and g.starts_at <= now()
        and g.expires_at > now()
      ) as grant_active
    from public.plus_access_grants g
    where g.revoked_at is null
  ),
  order_rollup as (
    select
      o.user_id,
      max(o.customer_email) filter (where o.customer_email is not null) as customer_email,
      count(*) as total_orders,
      max(o.created_at) as last_order_at
    from public.orders o
    where o.user_id is not null
    group by o.user_id
  ),
  support_rollup as (
    select
      s.customer_user_id as user_id,
      max(s.customer_email) as customer_email,
      count(*) filter (where s.status not in ('resolved', 'closed')) as open_support_requests
    from public.support_requests s
    group by s.customer_user_id
  ),
  machine_rollup as (
    select
      m.customer_user_id as user_id,
      sum(m.quantity)::bigint as total_machine_count,
      max(m.updated_at) as last_machine_update_at
    from public.customer_machine_inventory m
    group by m.customer_user_id
  ),
  auth_match as (
    select
      u.id as user_id,
      u.email as customer_email
    from auth.users u
    where normalized_search is not null
      and (
        u.id::text like '%' || normalized_search || '%'
        or lower(coalesce(u.email, '')) like '%' || normalized_search || '%'
      )
  ),
  all_users as (
    select m.user_id from membership m
    union
    select g.user_id from grant_rollup g
    union
    select o.user_id from order_rollup o
    union
    select s.user_id from support_rollup s
    union
    select m.user_id from machine_rollup m
    union
    select a.user_id from auth_match a
  )
  select
    au.user_id,
    coalesce(auth_user.email, am.customer_email, sr.customer_email, orr.customer_email) as customer_email,
    mb.status as membership_status,
    mb.current_period_end,
    coalesce(orr.total_orders, 0)::bigint as total_orders,
    orr.last_order_at,
    coalesce(sr.open_support_requests, 0)::bigint as open_support_requests,
    coalesce(mr.total_machine_count, 0)::bigint as total_machine_count,
    mr.last_machine_update_at,
    coalesce(mb.cancel_at_period_end, false) as membership_cancel_at_period_end,
    coalesce(mb.paid_subscription_active, false) as paid_subscription_active,
    case
      when coalesce(mb.paid_subscription_active, false) then 'paid_subscription'
      when coalesce(grant_rollup.grant_active, false) then 'free_grant'
      when public.is_super_admin(au.user_id) then 'admin'
      else 'none'
    end as plus_access_source,
    (
      coalesce(mb.paid_subscription_active, false)
      or coalesce(grant_rollup.grant_active, false)
      or public.is_super_admin(au.user_id)
    ) as has_plus_access,
    grant_rollup.id as plus_grant_id,
    grant_rollup.starts_at as plus_grant_starts_at,
    grant_rollup.expires_at as plus_grant_expires_at,
    coalesce(grant_rollup.grant_active, false) as plus_grant_active
  from all_users au
  left join membership mb on mb.user_id = au.user_id
  left join grant_rollup on grant_rollup.user_id = au.user_id
  left join order_rollup orr on orr.user_id = au.user_id
  left join support_rollup sr on sr.user_id = au.user_id
  left join machine_rollup mr on mr.user_id = au.user_id
  left join auth_match am on am.user_id = au.user_id
  left join auth.users auth_user on auth_user.id = au.user_id
  where (
    normalized_search is null
    or au.user_id::text like '%' || normalized_search || '%'
    or lower(coalesce(auth_user.email, am.customer_email, sr.customer_email, orr.customer_email, '')) like '%' || normalized_search || '%'
  )
  order by coalesce(orr.last_order_at, mr.last_machine_update_at, grant_rollup.updated_at, mb.updated_at) desc nulls last;
end;
$$;

grant execute on function public.admin_get_account_summaries(text) to authenticated;
