-- Admin Access person search rescue.
--
-- Keep the existing RPC shape, but make auth-user search explicit and
-- deterministic so Super Admins can find existing auth users by exact email,
-- partial email, or UUID/user-id even when those users have no orders yet.

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
  with auth_match as (
    select
      auth_user.id as user_id,
      auth_user.email::text as customer_email,
      auth_user.created_at as auth_created_at
    from auth.users auth_user
    where normalized_search is not null
      and (
        auth_user.id::text = normalized_search
        or auth_user.id::text like '%' || normalized_search || '%'
        or lower(coalesce(auth_user.email, '')) = normalized_search
        or lower(coalesce(auth_user.email, '')) like '%' || normalized_search || '%'
      )
  ),
  membership_candidates as (
    select
      subscription.user_id,
      subscription.status,
      subscription.current_period_end,
      subscription.cancel_at_period_end,
      subscription.updated_at,
      (
        subscription.status in ('active', 'trialing')
        and (
          subscription.current_period_end is null
          or subscription.current_period_end > now()
        )
      ) as paid_subscription_active
    from public.subscriptions subscription
  ),
  membership as (
    select distinct on (candidate.user_id)
      candidate.user_id,
      candidate.status,
      candidate.current_period_end,
      candidate.cancel_at_period_end,
      candidate.updated_at,
      candidate.paid_subscription_active
    from membership_candidates candidate
    order by
      candidate.user_id,
      candidate.paid_subscription_active desc,
      candidate.updated_at desc
  ),
  grant_candidates as (
    select
      plus_grant.user_id,
      plus_grant.id,
      plus_grant.starts_at,
      plus_grant.expires_at,
      plus_grant.updated_at,
      (
        plus_grant.revoked_at is null
        and plus_grant.starts_at <= now()
        and plus_grant.expires_at > now()
      ) as grant_active
    from public.plus_access_grants plus_grant
    where plus_grant.revoked_at is null
  ),
  grant_rollup as (
    select distinct on (candidate.user_id)
      candidate.user_id,
      candidate.id,
      candidate.starts_at,
      candidate.expires_at,
      candidate.updated_at,
      candidate.grant_active
    from grant_candidates candidate
    order by
      candidate.user_id,
      candidate.grant_active desc,
      candidate.updated_at desc
  ),
  order_rollup as (
    select
      orders.user_id,
      (max(orders.customer_email) filter (where orders.customer_email is not null))::text as customer_email,
      count(*) as total_orders,
      max(orders.created_at) as last_order_at
    from public.orders orders
    where orders.user_id is not null
    group by orders.user_id
  ),
  support_rollup as (
    select
      support.customer_user_id as user_id,
      max(support.customer_email)::text as customer_email,
      count(*) filter (where support.status not in ('resolved', 'closed')) as open_support_requests
    from public.support_requests support
    group by support.customer_user_id
  ),
  machine_rollup as (
    select
      inventory.customer_user_id as user_id,
      sum(inventory.quantity)::bigint as total_machine_count,
      max(inventory.updated_at) as last_machine_update_at
    from public.customer_machine_inventory inventory
    group by inventory.customer_user_id
  ),
  all_users as (
    select match.user_id from auth_match match
    union
    select membership.user_id from membership
    union
    select grant_rollup.user_id from grant_rollup
    union
    select order_rollup.user_id from order_rollup
    union
    select support_rollup.user_id from support_rollup
    union
    select machine_rollup.user_id from machine_rollup
  )
  select
    access_user.user_id,
    coalesce(
      auth_user.email,
      auth_match.customer_email,
      support_rollup.customer_email,
      order_rollup.customer_email
    )::text as customer_email,
    membership.status::text as membership_status,
    membership.current_period_end,
    coalesce(order_rollup.total_orders, 0)::bigint as total_orders,
    order_rollup.last_order_at,
    coalesce(support_rollup.open_support_requests, 0)::bigint as open_support_requests,
    coalesce(machine_rollup.total_machine_count, 0)::bigint as total_machine_count,
    machine_rollup.last_machine_update_at,
    coalesce(membership.cancel_at_period_end, false) as membership_cancel_at_period_end,
    coalesce(membership.paid_subscription_active, false) as paid_subscription_active,
    case
      when coalesce(membership.paid_subscription_active, false) then 'paid_subscription'
      when coalesce(grant_rollup.grant_active, false) then 'free_grant'
      when public.is_super_admin(access_user.user_id) then 'admin'
      else 'none'
    end as plus_access_source,
    (
      coalesce(membership.paid_subscription_active, false)
      or coalesce(grant_rollup.grant_active, false)
      or public.is_super_admin(access_user.user_id)
    ) as has_plus_access,
    grant_rollup.id as plus_grant_id,
    grant_rollup.starts_at as plus_grant_starts_at,
    grant_rollup.expires_at as plus_grant_expires_at,
    coalesce(grant_rollup.grant_active, false) as plus_grant_active
  from all_users access_user
  left join auth.users auth_user on auth_user.id = access_user.user_id
  left join auth_match on auth_match.user_id = access_user.user_id
  left join membership on membership.user_id = access_user.user_id
  left join grant_rollup on grant_rollup.user_id = access_user.user_id
  left join order_rollup on order_rollup.user_id = access_user.user_id
  left join support_rollup on support_rollup.user_id = access_user.user_id
  left join machine_rollup on machine_rollup.user_id = access_user.user_id
  where (
    normalized_search is null
    or access_user.user_id::text like '%' || normalized_search || '%'
    or lower(coalesce(auth_user.email, '')) like '%' || normalized_search || '%'
    or lower(coalesce(auth_match.customer_email, '')) like '%' || normalized_search || '%'
    or lower(coalesce(support_rollup.customer_email, '')) like '%' || normalized_search || '%'
    or lower(coalesce(order_rollup.customer_email, '')) like '%' || normalized_search || '%'
  )
  order by
    case
      when normalized_search is null then 9
      when access_user.user_id::text = normalized_search then 0
      when lower(coalesce(auth_user.email, auth_match.customer_email, '')) = normalized_search then 1
      when lower(coalesce(auth_user.email, auth_match.customer_email, '')) like normalized_search || '%' then 2
      when access_user.user_id::text like normalized_search || '%' then 3
      else 4
    end,
    coalesce(
      order_rollup.last_order_at,
      machine_rollup.last_machine_update_at,
      grant_rollup.updated_at,
      membership.updated_at,
      auth_match.auth_created_at
    ) desc nulls last,
    lower(coalesce(auth_user.email, auth_match.customer_email, support_rollup.customer_email, order_rollup.customer_email, '')),
    access_user.user_id;
end;
$$;

revoke execute on function public.admin_get_account_summaries(text)
  from public, anon, authenticated;
grant execute on function public.admin_get_account_summaries(text) to authenticated;
grant execute on function public.admin_get_account_summaries(text) to service_role;

comment on function public.admin_get_account_summaries(text) is
  'Admin RPC for account/person search. Super-admin only; supports exact or partial auth email and UUID search.';

select pg_notify('pgrst', 'reload schema');
