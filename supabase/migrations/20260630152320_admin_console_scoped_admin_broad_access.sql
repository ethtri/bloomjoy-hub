-- Admin Console IA + scoped-admin authority alignment.
--
-- Current production main already uses reporting_machines and
-- admin_scoped_access_grants/scopes as the machine registry + machine grant
-- model. This migration keeps that model, but separates "is a scoped admin"
-- from "has at least one machine scope" so scoped admins can enter Admin
-- Console before any machines are assigned.

alter table public.admin_roles
  drop constraint if exists admin_roles_role_check;

alter table public.admin_roles
  add constraint admin_roles_role_check
  check (role in ('super_admin', 'scoped_admin'));

create or replace function public.is_scoped_admin(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select uid is not null
    and exists (
      select 1
      from public.admin_scoped_access_grants grant_row
      where grant_row.user_id = uid
        and grant_row.role = 'scoped_admin'
        and public.admin_scoped_grant_is_active(
          grant_row.starts_at,
          grant_row.expires_at,
          grant_row.revoked_at
        )
    );
$$;

create or replace function public.is_admin(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_super_admin(uid) or public.is_scoped_admin(uid);
$$;

create or replace function public.can_access_machine(
  uid uuid,
  p_machine_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select uid is not null
    and p_machine_id is not null
    and (
      public.is_super_admin(uid)
      or p_machine_id = any(coalesce(public.scoped_admin_machine_ids(uid), '{}'::uuid[]))
    );
$$;

create or replace function public.can_access_admin_surface(
  uid uuid,
  surface text default null
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.is_super_admin(uid)
    or (
      public.is_scoped_admin(uid)
      and lower(coalesce(nullif(trim(surface), ''), 'overview')) in (
        'overview',
        'orders',
        'support',
        'accounts',
        'machines',
        'access',
        'audit',
        'reporting_access',
        'refunds',
        'partnerships'
      )
    )
    or (
      lower(coalesce(nullif(trim(surface), ''), 'overview')) = 'refunds'
      and public.user_is_refund_manager(uid)
    )
    or (
      lower(coalesce(nullif(trim(surface), ''), 'overview')) = 'payouts'
      and (
        exists (
          select 1
          from public.customer_accounts account
          where public.can_manage_operator_payout_account(uid, account.id)
        )
        or exists (
          select 1
          from public.reporting_machines machine
          where public.can_manage_operator_payout_machine(uid, machine.id)
        )
      )
    );
$$;

create or replace function public.get_my_admin_access_context()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  actor_user_id uuid;
  actor_is_super_admin boolean;
  actor_machine_ids uuid[];
  actor_is_scoped_admin boolean;
  actor_is_refund_manager boolean;
  actor_can_manage_payouts boolean;
  allowed_surfaces text[];
begin
  actor_user_id := auth.uid();

  if actor_user_id is null then
    return jsonb_build_object(
      'isSuperAdmin', false,
      'isScopedAdmin', false,
      'canAccessAdmin', false,
      'allowedSurfaces', '[]'::jsonb,
      'scopedMachineIds', '[]'::jsonb
    );
  end if;

  actor_is_super_admin := public.is_super_admin(actor_user_id);
  actor_machine_ids := coalesce(public.scoped_admin_machine_ids(actor_user_id), '{}'::uuid[]);
  actor_is_scoped_admin := public.is_scoped_admin(actor_user_id);
  actor_is_refund_manager := public.user_is_refund_manager(actor_user_id);
  actor_can_manage_payouts := exists (
    select 1
    from public.customer_accounts account
    where public.can_manage_operator_payout_account(actor_user_id, account.id)
  ) or exists (
    select 1
    from public.reporting_machines machine
    where public.can_manage_operator_payout_machine(actor_user_id, machine.id)
  );

  if actor_is_super_admin then
    allowed_surfaces := array['*'];
  else
    allowed_surfaces := '{}'::text[];

    if actor_is_scoped_admin then
      allowed_surfaces := allowed_surfaces || array[
        'overview',
        'orders',
        'support',
        'accounts',
        'machines',
        'access',
        'audit',
        'reporting_access',
        'refunds',
        'partnerships'
      ];
    end if;

    if actor_is_refund_manager then
      allowed_surfaces := allowed_surfaces || array['refunds'];
    end if;

    if actor_can_manage_payouts then
      allowed_surfaces := allowed_surfaces || array['payouts'];
    end if;
  end if;

  return jsonb_build_object(
    'isSuperAdmin', actor_is_super_admin,
    'isScopedAdmin', actor_is_scoped_admin,
    'canAccessAdmin',
      actor_is_super_admin
      or actor_is_scoped_admin
      or actor_is_refund_manager
      or actor_can_manage_payouts,
    'allowedSurfaces', to_jsonb(array(
      select distinct surface
      from unnest(allowed_surfaces) as surface
    )),
    'scopedMachineIds', to_jsonb(actor_machine_ids)
  );
end;
$$;

drop policy if exists "orders_select_super_admin" on public.orders;

create policy "orders_select_super_admin"
on public.orders
for select
using (public.is_admin((select auth.uid())));

drop policy if exists "support_requests_select_own_or_super_admin" on public.support_requests;
drop policy if exists "support_requests_update_super_admin" on public.support_requests;

create policy "support_requests_select_own_or_super_admin"
on public.support_requests
for select
using (
  (select auth.uid()) = customer_user_id
  or public.is_admin((select auth.uid()))
);

create policy "support_requests_update_super_admin"
on public.support_requests
for update
using (public.is_admin((select auth.uid())))
with check (public.is_admin((select auth.uid())));

create or replace function public.admin_update_order_fulfillment(
  p_order_id uuid,
  p_fulfillment_status text,
  p_tracking_url text,
  p_fulfillment_notes text,
  p_assigned_to uuid
)
returns public.orders
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  before_row public.orders;
  after_row public.orders;
  normalized_fulfillment_status text;
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'Admin access required';
  end if;

  normalized_fulfillment_status := coalesce(trim(lower(p_fulfillment_status)), '');

  if normalized_fulfillment_status not in ('unfulfilled', 'processing', 'shipped', 'delivered', 'canceled') then
    raise exception 'Invalid fulfillment status: %', p_fulfillment_status;
  end if;

  select *
  into before_row
  from public.orders
  where id = p_order_id;

  if before_row.id is null then
    raise exception 'Order not found';
  end if;

  update public.orders
  set
    fulfillment_status = normalized_fulfillment_status,
    fulfillment_tracking_url = nullif(trim(p_tracking_url), ''),
    fulfillment_notes = nullif(trim(p_fulfillment_notes), ''),
    fulfillment_assigned_to = p_assigned_to,
    fulfilled_at = case when normalized_fulfillment_status = 'delivered' then coalesce(fulfilled_at, now()) else null end,
    fulfilled_by = case when normalized_fulfillment_status = 'delivered' then coalesce(fulfilled_by, auth.uid()) else null end
  where id = p_order_id
  returning * into after_row;

  insert into public.admin_audit_log (
    actor_user_id,
    action,
    entity_type,
    entity_id,
    target_user_id,
    before,
    after
  )
  values (
    auth.uid(),
    'order.fulfillment_updated',
    'order',
    after_row.id::text,
    after_row.user_id,
    to_jsonb(before_row),
    to_jsonb(after_row)
  );

  return after_row;
end;
$$;

create or replace function public.admin_update_support_request(
  p_request_id uuid,
  p_status text,
  p_priority text,
  p_assigned_to uuid,
  p_internal_notes text
)
returns public.support_requests
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  before_row public.support_requests;
  after_row public.support_requests;
  normalized_status text;
  normalized_priority text;
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'Admin access required';
  end if;

  normalized_status := coalesce(trim(lower(p_status)), '');
  normalized_priority := coalesce(trim(lower(p_priority)), '');

  if normalized_status not in ('new', 'triaged', 'waiting_on_customer', 'resolved', 'closed') then
    raise exception 'Invalid support status: %', p_status;
  end if;

  if normalized_priority not in ('low', 'normal', 'high', 'urgent') then
    raise exception 'Invalid support priority: %', p_priority;
  end if;

  select *
  into before_row
  from public.support_requests
  where id = p_request_id;

  if before_row.id is null then
    raise exception 'Support request not found';
  end if;

  update public.support_requests
  set
    status = normalized_status,
    priority = normalized_priority,
    assigned_to = p_assigned_to,
    internal_notes = p_internal_notes,
    resolved_at = case when normalized_status = 'resolved' then coalesce(resolved_at, now()) else null end,
    resolved_by = case when normalized_status = 'resolved' then coalesce(resolved_by, auth.uid()) else null end
  where id = p_request_id
  returning * into after_row;

  insert into public.admin_audit_log (
    actor_user_id,
    action,
    entity_type,
    entity_id,
    target_user_id,
    before,
    after
  )
  values (
    auth.uid(),
    'support_request.updated',
    'support_request',
    after_row.id::text,
    after_row.customer_user_id,
    to_jsonb(before_row),
    to_jsonb(after_row)
  );

  return after_row;
end;
$$;

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
  if not public.is_admin(auth.uid()) then
    raise exception 'Admin access required';
  end if;

  normalized_reason := trim(coalesce(p_reason, ''));

  if p_customer_user_id is null then
    raise exception 'Customer user ID is required';
  end if;

  if not exists (
    select 1
    from auth.users users
    where users.id = p_customer_user_id
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
    from public.subscriptions subscription
    where subscription.user_id = p_customer_user_id
      and subscription.status in ('active', 'trialing')
      and (subscription.current_period_end is null or subscription.current_period_end > now())
      and subscription.cancel_at_period_end = false
  ) then
    raise exception 'Cancel or schedule cancellation for the paid Stripe subscription before granting free Plus access';
  end if;

  select *
  into before_row
  from public.plus_access_grants plus_grant
  where plus_grant.user_id = p_customer_user_id
    and plus_grant.revoked_at is null
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
      'reason', normalized_reason,
      'expires_at', p_expires_at
    )
  );

  return after_row;
end;
$$;

create or replace function public.admin_revoke_plus_access(
  p_grant_id uuid,
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
begin
  if not public.is_admin(auth.uid()) then
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
  from public.plus_access_grants plus_grant
  where plus_grant.id = p_grant_id
    and plus_grant.revoked_at is null
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
  actor_user_id uuid;
  actor_is_super_admin boolean;
  actor_machine_ids uuid[];
  normalized_search text;
begin
  actor_user_id := auth.uid();
  actor_is_super_admin := public.is_super_admin(actor_user_id);
  actor_machine_ids := coalesce(public.scoped_admin_machine_ids(actor_user_id), '{}'::uuid[]);

  if not public.is_admin(actor_user_id) then
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
  machine_record_rollup as (
    select
      membership.user_id,
      count(distinct machine.id)::bigint as total_machine_count,
      max(machine.updated_at) as last_machine_update_at
    from public.reporting_machines machine
    join public.customer_account_memberships membership
      on membership.account_id = machine.account_id
      and membership.active
    where actor_is_super_admin
      or machine.id = any(actor_machine_ids)
    group by membership.user_id
  ),
  legacy_machine_rollup as (
    select
      inventory.customer_user_id as user_id,
      sum(inventory.quantity)::bigint as total_machine_count,
      max(inventory.updated_at) as last_machine_update_at
    from public.customer_machine_inventory inventory
    where actor_is_super_admin
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
    select machine_record_rollup.user_id from machine_record_rollup
    union
    select legacy_machine_rollup.user_id from legacy_machine_rollup
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
    case
      when actor_is_super_admin then coalesce(
        machine_record_rollup.total_machine_count,
        legacy_machine_rollup.total_machine_count,
        0
      )::bigint
      else coalesce(machine_record_rollup.total_machine_count, 0)::bigint
    end as total_machine_count,
    case
      when actor_is_super_admin then coalesce(
        machine_record_rollup.last_machine_update_at,
        legacy_machine_rollup.last_machine_update_at
      )
      else machine_record_rollup.last_machine_update_at
    end as last_machine_update_at,
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
  left join machine_record_rollup on machine_record_rollup.user_id = access_user.user_id
  left join legacy_machine_rollup on legacy_machine_rollup.user_id = access_user.user_id
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
      machine_record_rollup.last_machine_update_at,
      legacy_machine_rollup.last_machine_update_at,
      grant_rollup.updated_at,
      membership.updated_at,
      auth_match.auth_created_at
    ) desc nulls last,
    lower(coalesce(auth_user.email, auth_match.customer_email, support_rollup.customer_email, order_rollup.customer_email, '')),
    access_user.user_id;
end;
$$;

create or replace function public.admin_audit_log_entry_visible_to_scoped_admin(
  p_entity_type text,
  p_entity_id text,
  p_before jsonb,
  p_after jsonb,
  p_meta jsonb,
  p_machine_ids uuid[]
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with normalized as (
    select
      lower(coalesce(p_entity_type, '')) as entity_type,
      coalesce(p_machine_ids, '{}'::uuid[]) as machine_ids
  ),
  machine_tokens as (
    select scoped.machine_id::text as machine_id
    from unnest((select machine_ids from normalized)) as scoped(machine_id)
  ),
  extracted_machine_tokens as (
    select nullif(p_meta ->> 'machineId', '') as machine_id
    union
    select nullif(p_meta ->> 'machine_id', '')
    union
    select nullif(p_meta ->> 'reportingMachineId', '')
    union
    select nullif(p_meta ->> 'reporting_machine_id', '')
    union
    select nullif(p_after ->> 'machine_id', '')
    union
    select nullif(p_after ->> 'reporting_machine_id', '')
    union
    select nullif(p_before ->> 'machine_id', '')
    union
    select nullif(p_before ->> 'reporting_machine_id', '')
  )
  select (select entity_type from normalized) not in (
      'admin_role',
      'admin_scoped_access',
      'admin_scoped_access_grant',
      'admin_scoped_access_scope'
    )
    and (
      (select entity_type from normalized) not in (
        'reporting_machine',
        'reporting_machine_tax_rate',
        'reporting_machine_entitlement',
        'reporting_machine_partnership_assignment',
        'reporting_machine_refund_manager',
        'refund_case',
        'machine_sales_fact',
        'sales_adjustment_fact',
        'operator_payout_run',
        'operator_payout_item'
      )
      or exists (
        select 1
        from machine_tokens token
        where token.machine_id = p_entity_id
      )
      or exists (
        select 1
        from extracted_machine_tokens token
        join machine_tokens machine_token on machine_token.machine_id = token.machine_id
        where token.machine_id is not null
      )
      or (
        p_entity_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        and (
          exists (
            select 1
            from public.reporting_machine_tax_rates tax
            join machine_tokens token on token.machine_id = tax.machine_id::text
            where tax.id = p_entity_id::uuid
          )
          or exists (
            select 1
            from public.reporting_machine_entitlements entitlement
            join machine_tokens token on token.machine_id = entitlement.machine_id::text
            where entitlement.id = p_entity_id::uuid
          )
          or exists (
            select 1
            from public.reporting_machine_partnership_assignments assignment
            join machine_tokens token on token.machine_id = assignment.machine_id::text
            where assignment.id = p_entity_id::uuid
          )
          or exists (
            select 1
            from public.refund_cases refund_case
            join machine_tokens token on token.machine_id = refund_case.reporting_machine_id::text
            where refund_case.id = p_entity_id::uuid
          )
        )
      )
    );
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
set search_path = public, auth
as $$
declare
  actor_user_id uuid;
  actor_is_super_admin boolean;
  actor_machine_ids uuid[];
  normalized_action text;
  normalized_entity_type text;
  normalized_search text;
  safe_limit integer;
begin
  actor_user_id := auth.uid();
  actor_is_super_admin := public.is_super_admin(actor_user_id);
  actor_machine_ids := coalesce(public.scoped_admin_machine_ids(actor_user_id), '{}'::uuid[]);

  if not public.is_admin(actor_user_id) then
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
    actor_is_super_admin
    or public.admin_audit_log_entry_visible_to_scoped_admin(
      log.entity_type,
      log.entity_id,
      log.before,
      log.after,
      log.meta,
      actor_machine_ids
    )
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

create or replace function public.admin_grant_scoped_admin_by_email(
  p_target_email text,
  p_machine_ids uuid[],
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  normalized_email text;
  normalized_reason text;
  target_user_id uuid;
  grant_before public.admin_scoped_access_grants;
  grant_after public.admin_scoped_access_grants;
  desired_machine_ids uuid[];
  missing_machine_count bigint;
  existing_scope public.admin_scoped_access_scopes;
  desired_machine_id uuid;
  added_count integer := 0;
  revoked_count integer := 0;
begin
  if not public.is_super_admin(auth.uid()) then
    raise exception 'Super-admin access required';
  end if;

  normalized_email := lower(trim(coalesce(p_target_email, '')));
  normalized_reason := trim(coalesce(p_reason, ''));

  if normalized_email = '' then
    raise exception 'Target email is required';
  end if;

  if normalized_reason = '' then
    raise exception 'Grant reason is required';
  end if;

  select users.id
  into target_user_id
  from auth.users users
  where lower(users.email) = normalized_email
  limit 1;

  if target_user_id is null then
    raise exception 'No user found for email %', normalized_email;
  end if;

  if public.is_super_admin(target_user_id) then
    raise exception 'Target user is already a super-admin';
  end if;

  select coalesce(array_agg(distinct requested.machine_id), '{}'::uuid[])
  into desired_machine_ids
  from unnest(coalesce(p_machine_ids, '{}'::uuid[])) as requested(machine_id)
  where requested.machine_id is not null;

  select count(*)
  into missing_machine_count
  from unnest(desired_machine_ids) as requested(machine_id)
  left join public.reporting_machines machine on machine.id = requested.machine_id
  where machine.id is null;

  if missing_machine_count > 0 then
    raise exception 'One or more reporting machines were not found';
  end if;

  select *
  into grant_before
  from public.admin_scoped_access_grants grant_row
  where grant_row.user_id = target_user_id
    and grant_row.role = 'scoped_admin'
  order by grant_row.revoked_at is null desc, grant_row.updated_at desc
  limit 1;

  if grant_before.id is null then
    insert into public.admin_scoped_access_grants (
      user_id,
      grant_reason,
      granted_by
    )
    values (
      target_user_id,
      normalized_reason,
      auth.uid()
    )
    returning * into grant_after;
  else
    update public.admin_scoped_access_grants
    set
      source = 'manual_admin_grant',
      starts_at = now(),
      expires_at = null,
      grant_reason = normalized_reason,
      granted_by = auth.uid(),
      granted_at = now(),
      revoked_by = null,
      revoked_at = null,
      revoke_reason = null
    where id = grant_before.id
    returning * into grant_after;
  end if;

  for existing_scope in
    select *
    from public.admin_scoped_access_scopes scope_row
    where scope_row.grant_id = grant_after.id
      and scope_row.revoked_at is null
  loop
    if existing_scope.scope_type <> 'machine'
      or not (existing_scope.machine_id = any(desired_machine_ids))
    then
      update public.admin_scoped_access_scopes
      set
        revoked_by = auth.uid(),
        revoked_at = now(),
        revoke_reason = normalized_reason
      where id = existing_scope.id;

      revoked_count := revoked_count + 1;
    end if;
  end loop;

  foreach desired_machine_id in array desired_machine_ids
  loop
    if not exists (
      select 1
      from public.admin_scoped_access_scopes scope_row
      where scope_row.grant_id = grant_after.id
        and scope_row.scope_type = 'machine'
        and scope_row.machine_id = desired_machine_id
        and scope_row.revoked_at is null
    ) then
      insert into public.admin_scoped_access_scopes (
        grant_id,
        scope_type,
        machine_id,
        grant_reason,
        granted_by
      )
      values (
        grant_after.id,
        'machine',
        desired_machine_id,
        normalized_reason,
        auth.uid()
      );

      added_count := added_count + 1;
    end if;
  end loop;

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
    case when grant_before.id is null then 'admin_scoped_access.granted' else 'admin_scoped_access.updated' end,
    'admin_scoped_access_grant',
    grant_after.id::text,
    target_user_id,
    coalesce(to_jsonb(grant_before), '{}'::jsonb),
    to_jsonb(grant_after),
    jsonb_build_object(
      'reason', normalized_reason,
      'target_email', normalized_email,
      'machine_ids', desired_machine_ids,
      'added_count', added_count,
      'revoked_count', revoked_count
    )
  );

  return jsonb_build_object(
    'grantId', grant_after.id,
    'userId', grant_after.user_id,
    'userEmail', normalized_email,
    'machineCount', coalesce(array_length(desired_machine_ids, 1), 0),
    'addedCount', added_count,
    'revokedCount', revoked_count
  );
end;
$$;

create or replace function public.admin_get_reporting_access_matrix()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  result jsonb;
  actor_user_id uuid;
  actor_is_super_admin boolean;
  actor_is_scoped_admin boolean;
  actor_machine_ids uuid[];
begin
  actor_user_id := auth.uid();
  actor_is_super_admin := public.is_super_admin(actor_user_id);
  actor_is_scoped_admin := public.is_scoped_admin(actor_user_id);
  actor_machine_ids := coalesce(public.scoped_admin_machine_ids(actor_user_id), '{}'::uuid[]);

  if not actor_is_super_admin and not actor_is_scoped_admin then
    raise exception 'Admin access required';
  end if;

  with active_grants as (
    select
      entitlement.id,
      entitlement.user_id,
      users.email as user_email,
      entitlement.account_id,
      entitlement.location_id,
      entitlement.machine_id,
      entitlement.access_level,
      entitlement.grant_reason,
      entitlement.starts_at,
      entitlement.expires_at,
      entitlement.created_at,
      case
        when entitlement.machine_id is not null then 'machine'
        when entitlement.location_id is not null then 'location'
        when entitlement.account_id is not null then 'account'
        else 'unknown'
      end as scope_type
    from public.reporting_machine_entitlements entitlement
    left join auth.users users on users.id = entitlement.user_id
    where public.reporting_entitlement_is_active(
      entitlement.starts_at,
      entitlement.expires_at,
      entitlement.revoked_at
    )
      and coalesce(entitlement.source_type, 'manual') = 'manual'
      and (
        actor_is_super_admin
        or entitlement.machine_id = any(actor_machine_ids)
      )
  ),
  super_admins as (
    select
      role.user_id,
      users.email as user_email
    from public.admin_roles role
    left join auth.users users on users.id = role.user_id
    where role.role = 'super_admin'
      and role.active
      and role.revoked_at is null
  ),
  people_source as (
    select
      grant_row.user_id,
      max(grant_row.user_email) as user_email
    from active_grants grant_row
    group by grant_row.user_id
    union
    select
      admin_row.user_id,
      admin_row.user_email
    from super_admins admin_row
    where actor_is_super_admin
  ),
  people as (
    select
      person.user_id,
      coalesce(max(person.user_email), '') as user_email,
      exists (
        select 1
        from super_admins admin_row
        where admin_row.user_id = person.user_id
      ) as is_super_admin,
      count(distinct grant_row.machine_id) filter (
        where grant_row.scope_type = 'machine'
          and grant_row.machine_id is not null
      ) as explicit_machine_count,
      count(grant_row.id) filter (
        where grant_row.scope_type in ('account', 'location')
      ) as inherited_grant_count
    from people_source person
    left join active_grants grant_row on grant_row.user_id = person.user_id
    group by person.user_id
  ),
  machine_rows as (
    select
      machine.id,
      machine.account_id,
      account.name as account_name,
      machine.location_id,
      location.name as location_name,
      machine.machine_label,
      machine.machine_type,
      machine.sunze_machine_id,
      machine.status,
      max(fact.sale_date) as latest_sale_date,
      count(distinct grant_row.user_id) filter (
        where grant_row.scope_type = 'machine'
          and grant_row.machine_id = machine.id
      ) as viewer_count,
      coalesce(
        jsonb_agg(
          distinct jsonb_build_object(
            'userId', grant_row.user_id,
            'userEmail', grant_row.user_email
          )
        ) filter (
          where grant_row.scope_type = 'machine'
            and grant_row.machine_id = machine.id
            and grant_row.user_id is not null
        ),
        '[]'::jsonb
      ) as viewers
    from public.reporting_machines machine
    join public.customer_accounts account on account.id = machine.account_id
    join public.reporting_locations location on location.id = machine.location_id
    left join public.machine_sales_facts fact on fact.reporting_machine_id = machine.id
    left join active_grants grant_row on grant_row.machine_id = machine.id
    where actor_is_super_admin
      or machine.id = any(actor_machine_ids)
    group by
      machine.id,
      account.name,
      location.name
  ),
  grant_rows as (
    select
      grant_row.id,
      grant_row.user_id,
      grant_row.user_email,
      grant_row.account_id,
      grant_row.location_id,
      grant_row.machine_id,
      grant_row.access_level,
      grant_row.grant_reason,
      grant_row.starts_at,
      grant_row.expires_at,
      grant_row.created_at,
      grant_row.scope_type
    from active_grants grant_row
  )
  select jsonb_build_object(
    'people',
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'userId', people.user_id,
            'userEmail', people.user_email,
            'isSuperAdmin', people.is_super_admin,
            'explicitMachineCount', people.explicit_machine_count,
            'inheritedGrantCount', people.inherited_grant_count
          )
          order by people.is_super_admin desc, people.user_email
        )
        from people
      ),
      '[]'::jsonb
    ),
    'machines',
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', machine_rows.id,
            'accountId', machine_rows.account_id,
            'accountName', machine_rows.account_name,
            'locationId', machine_rows.location_id,
            'locationName', machine_rows.location_name,
            'machineLabel', machine_rows.machine_label,
            'machineType', machine_rows.machine_type,
            'sunzeMachineId', machine_rows.sunze_machine_id,
            'status', machine_rows.status,
            'latestSaleDate', machine_rows.latest_sale_date,
            'viewerCount', machine_rows.viewer_count,
            'viewers', machine_rows.viewers
          )
          order by machine_rows.account_name, machine_rows.location_name, machine_rows.machine_label
        )
        from machine_rows
      ),
      '[]'::jsonb
    ),
    'grants',
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', grant_rows.id,
            'userId', grant_rows.user_id,
            'userEmail', grant_rows.user_email,
            'accountId', grant_rows.account_id,
            'locationId', grant_rows.location_id,
            'machineId', grant_rows.machine_id,
            'accessLevel', grant_rows.access_level,
            'grantReason', grant_rows.grant_reason,
            'startsAt', grant_rows.starts_at,
            'expiresAt', grant_rows.expires_at,
            'createdAt', grant_rows.created_at,
            'scopeType', grant_rows.scope_type
          )
          order by grant_rows.created_at desc
        )
        from grant_rows
      ),
      '[]'::jsonb
    )
  )
  into result;

  return result;
end;
$$;

create or replace function public.admin_lookup_reporting_user_by_email(
  p_user_email text
)
returns table (
  user_id uuid,
  user_email text,
  is_super_admin boolean,
  explicit_machine_count bigint,
  inherited_grant_count bigint
)
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  normalized_email text;
  actor_user_id uuid;
  actor_is_super_admin boolean;
  actor_is_scoped_admin boolean;
  actor_machine_ids uuid[];
begin
  actor_user_id := auth.uid();
  actor_is_super_admin := public.is_super_admin(actor_user_id);
  actor_is_scoped_admin := public.is_scoped_admin(actor_user_id);
  actor_machine_ids := coalesce(public.scoped_admin_machine_ids(actor_user_id), '{}'::uuid[]);

  if not actor_is_super_admin and not actor_is_scoped_admin then
    raise exception 'Admin access required';
  end if;

  normalized_email := lower(trim(coalesce(p_user_email, '')));

  if normalized_email = '' then
    raise exception 'User email is required';
  end if;

  return query
  select
    users.id as user_id,
    users.email::text as user_email,
    exists (
      select 1
      from public.admin_roles role
      where role.user_id = users.id
        and role.role = 'super_admin'
        and role.active
        and role.revoked_at is null
    ) as is_super_admin,
    count(distinct entitlement.machine_id) filter (
      where entitlement.machine_id is not null
        and coalesce(entitlement.source_type, 'manual') = 'manual'
        and public.reporting_entitlement_is_active(
          entitlement.starts_at,
          entitlement.expires_at,
          entitlement.revoked_at
        )
        and (
          actor_is_super_admin
          or entitlement.machine_id = any(actor_machine_ids)
        )
    ) as explicit_machine_count,
    count(entitlement.id) filter (
      where actor_is_super_admin
        and entitlement.machine_id is null
        and (entitlement.account_id is not null or entitlement.location_id is not null)
        and coalesce(entitlement.source_type, 'manual') = 'manual'
        and public.reporting_entitlement_is_active(
          entitlement.starts_at,
          entitlement.expires_at,
          entitlement.revoked_at
        )
    ) as inherited_grant_count
  from auth.users users
  left join public.reporting_machine_entitlements entitlement
    on entitlement.user_id = users.id
  where lower(users.email) = normalized_email
  group by users.id, users.email;
end;
$$;

create or replace function public.admin_get_partnership_reporting_setup()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  actor_user_id uuid;
  actor_is_super_admin boolean;
  actor_is_scoped_admin boolean;
  actor_machine_ids uuid[];
  result jsonb;
begin
  actor_user_id := auth.uid();
  actor_is_super_admin := public.is_super_admin(actor_user_id);
  actor_is_scoped_admin := public.is_scoped_admin(actor_user_id);
  actor_machine_ids := coalesce(public.scoped_admin_machine_ids(actor_user_id), '{}'::uuid[]);

  if actor_user_id is null then
    raise exception 'Authentication required';
  end if;

  if not actor_is_super_admin and not actor_is_scoped_admin then
    raise exception 'Admin access required';
  end if;

  with partnership_rows as (
    select partnership.*
    from public.reporting_partnerships partnership
    where actor_is_super_admin
      or public.admin_can_manage_scoped_partnership(actor_user_id, partnership.id)
  ),
  partner_rows as (
    select partner.*
    from public.reporting_partners partner
    where actor_is_super_admin
      or public.admin_can_manage_scoped_reporting_partner(actor_user_id, partner.id)
  ),
  machines as (
    select
      machine.id,
      machine.machine_label,
      machine.machine_type,
      machine.sunze_machine_id,
      machine.status,
      account.name as account_name,
      location.name as location_name,
      max(fact.sale_date) as latest_sale_date
    from public.reporting_machines machine
    join public.customer_accounts account on account.id = machine.account_id
    join public.reporting_locations location on location.id = machine.location_id
    left join public.machine_sales_facts fact on fact.reporting_machine_id = machine.id
    where actor_is_super_admin
      or machine.id = any(actor_machine_ids)
    group by machine.id, account.name, location.name
  ),
  assignment_rows as (
    select
      assignment.id,
      assignment.machine_id,
      machine.machine_label,
      assignment.partnership_id,
      partnership.name as partnership_name,
      assignment.assignment_role,
      assignment.effective_start_date,
      assignment.effective_end_date,
      assignment.status,
      assignment.notes
    from public.reporting_machine_partnership_assignments assignment
    join machines machine on machine.id = assignment.machine_id
    join partnership_rows partnership on partnership.id = assignment.partnership_id
  ),
  tax_rows as (
    select
      tax.id,
      tax.machine_id,
      machine.machine_label,
      tax.tax_rate_percent,
      tax.effective_start_date,
      tax.effective_end_date,
      tax.status,
      tax.notes
    from public.reporting_machine_tax_rates tax
    join machines machine on machine.id = tax.machine_id
  ),
  party_rows as (
    select
      party.id,
      party.partnership_id,
      partnership.name as partnership_name,
      party.partner_id,
      partner.name as partner_name,
      partner.legal_name as partner_legal_name,
      party.party_role,
      party.share_basis_points,
      party.is_report_recipient,
      party.created_at,
      party.updated_at
    from public.reporting_partnership_parties party
    join partnership_rows partnership on partnership.id = party.partnership_id
    join partner_rows partner on partner.id = party.partner_id
  ),
  rule_rows as (
    select
      rule.*,
      partnership.name as partnership_name
    from public.reporting_partnership_financial_rules rule
    join partnership_rows partnership on partnership.id = rule.partnership_id
  ),
  warnings as (
    select jsonb_build_object(
      'warningType', 'missing_machine_tax_rate',
      'machineId', machine.id,
      'machineLabel', machine.machine_label,
      'message', machine.machine_label || ' has no active machine tax rate.'
    ) as warning
    from machines machine
    where not exists (
      select 1
      from public.reporting_machine_tax_rates tax
      where tax.machine_id = machine.id
        and tax.status = 'active'
        and tax.effective_start_date <= current_date
        and (tax.effective_end_date is null or tax.effective_end_date >= current_date)
    )
    union all
    select jsonb_build_object(
      'warningType', 'missing_partnership_assignment',
      'machineId', machine.id,
      'machineLabel', machine.machine_label,
      'message', machine.machine_label || ' has no active partnership assignment.'
    ) as warning
    from machines machine
    where not exists (
      select 1
      from public.reporting_machine_partnership_assignments assignment
      where assignment.machine_id = machine.id
        and assignment.status = 'active'
        and assignment.assignment_role = 'primary_reporting'
        and assignment.effective_start_date <= current_date
        and (assignment.effective_end_date is null or assignment.effective_end_date >= current_date)
    )
    union all
    select jsonb_build_object(
      'warningType', 'missing_financial_rule',
      'partnershipId', partnership.id,
      'partnershipName', partnership.name,
      'message', partnership.name || ' has no active financial rule.'
    ) as warning
    from partnership_rows partnership
    where partnership.status = 'active'
      and not exists (
        select 1
        from public.reporting_partnership_financial_rules rule
        where rule.partnership_id = partnership.id
          and rule.status = 'active'
          and rule.effective_start_date <= current_date
          and (rule.effective_end_date is null or rule.effective_end_date >= current_date)
      )
    union all
    select jsonb_build_object(
      'warningType', 'overlapping_partnership_assignments',
      'machineId', left_assignment.machine_id,
      'machineLabel', machine.machine_label,
      'message', machine.machine_label || ' has overlapping active partnership assignments.'
    ) as warning
    from public.reporting_machine_partnership_assignments left_assignment
    join public.reporting_machine_partnership_assignments right_assignment
      on right_assignment.machine_id = left_assignment.machine_id
      and right_assignment.assignment_role = left_assignment.assignment_role
      and right_assignment.id > left_assignment.id
      and right_assignment.status = 'active'
      and left_assignment.status = 'active'
      and public.reporting_date_windows_overlap(
        left_assignment.effective_start_date,
        left_assignment.effective_end_date,
        right_assignment.effective_start_date,
        right_assignment.effective_end_date
      )
    join machines machine on machine.id = left_assignment.machine_id
  )
  select jsonb_build_object(
    'partners',
    coalesce((select jsonb_agg(to_jsonb(partner) order by partner.name) from partner_rows partner), '[]'::jsonb),
    'partnerships',
    coalesce((select jsonb_agg(to_jsonb(partnership) order by partnership.name) from partnership_rows partnership), '[]'::jsonb),
    'machines',
    coalesce((select jsonb_agg(to_jsonb(machines) order by machines.account_name, machines.location_name, machines.machine_label) from machines), '[]'::jsonb),
    'assignments',
    coalesce((select jsonb_agg(to_jsonb(assignment_rows) order by assignment_rows.effective_start_date desc) from assignment_rows), '[]'::jsonb),
    'taxRates',
    coalesce((select jsonb_agg(to_jsonb(tax_rows) order by tax_rows.effective_start_date desc) from tax_rows), '[]'::jsonb),
    'parties',
    coalesce((select jsonb_agg(to_jsonb(party_rows) order by party_rows.partnership_name, party_rows.partner_name) from party_rows), '[]'::jsonb),
    'financialRules',
    coalesce((select jsonb_agg(to_jsonb(rule_rows) order by rule_rows.effective_start_date desc) from rule_rows), '[]'::jsonb),
    'warnings',
    coalesce((select jsonb_agg(warnings.warning) from warnings), '[]'::jsonb)
  )
  into result;

  return result;
end;
$$;

comment on function public.is_admin(uuid) is
  'True when a user has active Super Admin or Scoped Admin authority.';
comment on function public.can_access_machine(uuid, uuid) is
  'True when a Super Admin has global machine authority or a Scoped Admin has an active machine grant.';
comment on function public.get_my_admin_access_context() is
  'Current user Admin Console authority context, including broad scoped-admin surfaces and explicit machine ids.';
comment on function public.admin_get_account_summaries(text) is
  'Admin Console account/person search. Super Admins see global machine context; Scoped Admins see only granted machine-record counts.';
comment on function public.admin_get_audit_log(text, text, text, integer) is
  'Admin Console audit log. Super Admins see all records; Scoped Admins see non-role records and machine records only for granted machines.';

revoke execute on function public.is_scoped_admin(uuid)
  from public, anon;
grant execute on function public.is_scoped_admin(uuid)
  to service_role;

revoke execute on function public.is_admin(uuid)
  from public, anon;
grant execute on function public.is_admin(uuid)
  to authenticated, service_role;

revoke execute on function public.can_access_machine(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.can_access_machine(uuid, uuid)
  to service_role;

revoke execute on function public.can_access_admin_surface(uuid, text)
  from public, anon;
grant execute on function public.can_access_admin_surface(uuid, text)
  to authenticated, service_role;

revoke execute on function public.admin_audit_log_entry_visible_to_scoped_admin(text, text, jsonb, jsonb, jsonb, uuid[])
  from public, anon, authenticated;
grant execute on function public.admin_audit_log_entry_visible_to_scoped_admin(text, text, jsonb, jsonb, jsonb, uuid[])
  to service_role;

revoke execute on function public.get_my_admin_access_context()
  from public, anon;
grant execute on function public.get_my_admin_access_context()
  to authenticated, service_role;

revoke execute on function public.admin_update_order_fulfillment(uuid, text, text, text, uuid)
  from public, anon;
grant execute on function public.admin_update_order_fulfillment(uuid, text, text, text, uuid)
  to authenticated;

revoke execute on function public.admin_update_support_request(uuid, text, text, uuid, text)
  from public, anon;
grant execute on function public.admin_update_support_request(uuid, text, text, uuid, text)
  to authenticated;

revoke execute on function public.admin_grant_plus_access(uuid, timestamptz, text)
  from public, anon;
grant execute on function public.admin_grant_plus_access(uuid, timestamptz, text)
  to authenticated;

revoke execute on function public.admin_revoke_plus_access(uuid, text)
  from public, anon;
grant execute on function public.admin_revoke_plus_access(uuid, text)
  to authenticated;

revoke execute on function public.admin_get_account_summaries(text)
  from public, anon;
grant execute on function public.admin_get_account_summaries(text)
  to authenticated, service_role;

revoke execute on function public.admin_get_audit_log(text, text, text, integer)
  from public, anon;
grant execute on function public.admin_get_audit_log(text, text, text, integer)
  to authenticated, service_role;

revoke execute on function public.admin_grant_scoped_admin_by_email(text, uuid[], text)
  from public, anon;
grant execute on function public.admin_grant_scoped_admin_by_email(text, uuid[], text)
  to authenticated;

revoke execute on function public.admin_get_reporting_access_matrix()
  from public, anon;
grant execute on function public.admin_get_reporting_access_matrix()
  to authenticated;

revoke execute on function public.admin_lookup_reporting_user_by_email(text)
  from public, anon;
grant execute on function public.admin_lookup_reporting_user_by_email(text)
  to authenticated;

revoke execute on function public.admin_get_partnership_reporting_setup()
  from public, anon;
grant execute on function public.admin_get_partnership_reporting_setup()
  to authenticated;

select pg_notify('pgrst', 'reload schema');
