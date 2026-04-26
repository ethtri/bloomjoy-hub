-- Database migration hygiene repairs.
--
-- This migration fixes existing function return-type mismatches reported by
-- `supabase db lint --local --fail-on error`. The historical migration file
-- cleanup in this PR handles clean local replay; these CREATE OR REPLACE
-- statements handle final-schema lint compatibility.

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
    u.email::text as user_email,
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
    actor.email::text as actor_email,
    log.target_user_id,
    target.email::text as target_email,
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
      u.email::text as customer_email
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
    coalesce(auth_user.email, am.customer_email, sr.customer_email, orr.customer_email)::text as customer_email,
    mb.status::text as membership_status,
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

grant execute on function public.admin_list_super_admin_roles() to authenticated;
grant execute on function public.admin_get_audit_log(text, text, text, integer) to authenticated;
grant execute on function public.admin_get_account_summaries(text) to authenticated;

select pg_notify('pgrst', 'reload schema');
