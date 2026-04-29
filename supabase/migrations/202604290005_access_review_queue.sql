-- Read-only access lifecycle review queue for Admin Access issue #331.
--
-- This does not change authorization semantics. It gives super-admins one
-- source-aware list of expiring and high-risk access records so the existing
-- person-first console can route review work to the right source card.

drop function if exists public.admin_get_access_review_queue(integer, integer);

create index if not exists technician_grants_review_expiry_idx
  on public.technician_grants (expires_at)
  where revoked_at is null
    and status in ('pending', 'active')
    and expires_at is not null;

create index if not exists corporate_partner_memberships_review_expiry_idx
  on public.corporate_partner_memberships (expires_at)
  where revoked_at is null
    and status = 'active'
    and expires_at is not null;

create index if not exists plus_access_grants_review_expiry_idx
  on public.plus_access_grants (expires_at)
  where revoked_at is null;

create index if not exists admin_scoped_access_grants_review_expiry_idx
  on public.admin_scoped_access_grants (expires_at)
  where revoked_at is null;

create or replace function public.admin_get_access_review_queue(
  p_window_days integer default 30,
  p_limit integer default 100
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  current_user_id uuid;
  review_window_days integer;
  effective_limit integer;
  result jsonb;
begin
  current_user_id := auth.uid();

  if not public.is_super_admin(current_user_id) then
    raise exception 'Super-admin access required';
  end if;

  review_window_days := greatest(1, least(coalesce(p_window_days, 30), 120));
  effective_limit := greatest(1, least(coalesce(p_limit, 100), 200));

  with review_items as (
    select
      ('technician:' || grant_row.id::text) as item_id,
      case
        when grant_row.expires_at <= now() then 'technician_expired'
        else 'technician_expiring'
      end as kind,
      case
        when grant_row.expires_at <= now() then 'urgent'
        when grant_row.expires_at <= now() + interval '7 days' then 'urgent'
        else 'soon'
      end as severity,
      grant_row.technician_email::text as person_email,
      grant_row.technician_user_id as user_id,
      case
        when grant_row.partner_id is not null then
          'Technician via Corporate Partner'
        else
          'Technician via Plus Customer'
      end as source_label,
      (
        coalesce(account.name, 'Customer account')
        || ' / '
        || (
          select count(*)::text
          from public.technician_machine_assignments assignment
          join public.reporting_machines machine on machine.id = assignment.machine_id
          where assignment.technician_grant_id = grant_row.id
            and machine.status = 'active'
            and public.technician_assignment_is_active(
              assignment.starts_at,
              assignment.expires_at,
              assignment.revoked_at,
              assignment.status
            )
        )
        || ' machine scope'
      ) as scope_label,
      grant_row.grant_reason as reason,
      grant_row.expires_at,
      grant_row.expires_at as review_by,
      'Review renewal in Portal > Settings > Technician Access' as action_label,
      coalesce(grant_row.technician_email, grant_row.technician_user_id::text) as workspace_search,
      grant_row.expires_at as sort_at,
      ceil(extract(epoch from (grant_row.expires_at - now())) / 86400.0)::integer as days_until_due,
      case
        when grant_row.expires_at <= now() + interval '7 days' then 1
        else 2
      end as severity_sort
    from public.technician_grants grant_row
    join public.customer_accounts account on account.id = grant_row.account_id
    where grant_row.revoked_at is null
      and grant_row.status in ('pending', 'active')
      and grant_row.starts_at <= now()
      and grant_row.expires_at is not null
      and grant_row.expires_at <= now() + (review_window_days * interval '1 day')

    union all

    select
      ('corporate_partner:' || membership.id::text) as item_id,
      case
        when membership.expires_at <= now() then 'corporate_partner_expired'
        else 'corporate_partner_expiring'
      end as kind,
      case
        when membership.expires_at <= now() then 'urgent'
        when membership.expires_at <= now() + interval '7 days' then 'urgent'
        else 'soon'
      end as severity,
      membership.member_email::text as person_email,
      membership.user_id,
      ('Corporate Partner / ' || partner.name) as source_label,
      (
        coalesce((
          select count(distinct partnership.id)::text
          from public.reporting_partnership_parties party
          join public.reporting_partnerships partnership on partnership.id = party.partnership_id
          where party.partner_id = partner.id
            and party.portal_access_enabled = true
            and partnership.status = 'active'
        ), '0')
        || ' portal-enabled partnerships'
      ) as scope_label,
      membership.grant_reason as reason,
      membership.expires_at,
      membership.expires_at as review_by,
      'Review Corporate Partner renewal or revoke path' as action_label,
      coalesce(membership.member_email, membership.user_id::text) as workspace_search,
      membership.expires_at as sort_at,
      ceil(extract(epoch from (membership.expires_at - now())) / 86400.0)::integer as days_until_due,
      case
        when membership.expires_at <= now() + interval '7 days' then 1
        else 2
      end as severity_sort
    from public.corporate_partner_memberships membership
    join public.reporting_partners partner on partner.id = membership.partner_id
    where membership.revoked_at is null
      and membership.status = 'active'
      and membership.starts_at <= now()
      and membership.expires_at is not null
      and membership.expires_at <= now() + (review_window_days * interval '1 day')

    union all

    select
      ('corporate_partner_inactive:' || membership.id::text) as item_id,
      'corporate_partner_inactive' as kind,
      'review' as severity,
      membership.member_email::text as person_email,
      membership.user_id,
      ('Corporate Partner / ' || partner.name) as source_label,
      case
        when partner.status <> 'active' then 'Partner record is ' || partner.status
        when not exists (
          select 1
          from public.reporting_partnership_parties party
          join public.reporting_partnerships partnership on partnership.id = party.partnership_id
          where party.partner_id = partner.id
            and party.portal_access_enabled = true
            and partnership.status = 'active'
        ) then 'No active portal-enabled partnerships'
        else 'Membership status is ' || membership.status
      end as scope_label,
      membership.grant_reason as reason,
      membership.expires_at,
      null::timestamptz as review_by,
      'Review inactive Corporate Partner source' as action_label,
      coalesce(membership.member_email, membership.user_id::text) as workspace_search,
      membership.updated_at as sort_at,
      null::integer as days_until_due,
      3 as severity_sort
    from public.corporate_partner_memberships membership
    join public.reporting_partners partner on partner.id = membership.partner_id
    where membership.revoked_at is null
      and membership.status <> 'revoked'
      and (
        membership.status <> 'active'
        or partner.status <> 'active'
        or not exists (
          select 1
          from public.reporting_partnership_parties party
          join public.reporting_partnerships partnership on partnership.id = party.partnership_id
          where party.partner_id = partner.id
            and party.portal_access_enabled = true
            and partnership.status = 'active'
        )
      )

    union all

    select
      ('plus_grant:' || grant_row.id::text) as item_id,
      case
        when grant_row.expires_at <= now() then 'plus_grant_expired'
        else 'plus_grant_expiring'
      end as kind,
      case
        when grant_row.expires_at <= now() then 'urgent'
        when grant_row.expires_at <= now() + interval '7 days' then 'urgent'
        else 'soon'
      end as severity,
      auth_user.email::text as person_email,
      grant_row.user_id,
      'Plus Customer admin grant' as source_label,
      'Admin-granted Plus Customer access' as scope_label,
      grant_row.grant_reason as reason,
      grant_row.expires_at,
      grant_row.expires_at as review_by,
      'Review Plus Customer extension or revoke path' as action_label,
      coalesce(auth_user.email::text, grant_row.user_id::text) as workspace_search,
      grant_row.expires_at as sort_at,
      ceil(extract(epoch from (grant_row.expires_at - now())) / 86400.0)::integer as days_until_due,
      case
        when grant_row.expires_at <= now() + interval '7 days' then 1
        else 2
      end as severity_sort
    from public.plus_access_grants grant_row
    left join auth.users auth_user on auth_user.id = grant_row.user_id
    where grant_row.revoked_at is null
      and grant_row.starts_at <= now()
      and grant_row.expires_at <= now() + (review_window_days * interval '1 day')

    union all

    select
      ('super_admin:' || role_row.id::text) as item_id,
      'global_admin_review' as kind,
      'review' as severity,
      auth_user.email::text as person_email,
      role_row.user_id,
      'Super Admin' as source_label,
      'Global admin access' as scope_label,
      'Broad access should be reviewed periodically' as reason,
      null::timestamptz as expires_at,
      null::timestamptz as review_by,
      'Review whether global admin is still required' as action_label,
      coalesce(auth_user.email::text, role_row.user_id::text) as workspace_search,
      role_row.granted_at as sort_at,
      null::integer as days_until_due,
      3 as severity_sort
    from public.admin_roles role_row
    left join auth.users auth_user on auth_user.id = role_row.user_id
    where role_row.active = true
      and role_row.role = 'super_admin'

    union all

    select
      ('scoped_admin:' || grant_row.id::text) as item_id,
      'scoped_admin_review' as kind,
      'review' as severity,
      auth_user.email::text as person_email,
      grant_row.user_id,
      'Scoped Admin' as source_label,
      (
        coalesce((
          select count(*)::text
          from public.admin_scoped_access_scopes scope_row
          where scope_row.grant_id = grant_row.id
            and scope_row.revoked_at is null
        ), '0')
        || ' scoped machines/accounts'
      ) as scope_label,
      grant_row.grant_reason as reason,
      grant_row.expires_at,
      grant_row.expires_at as review_by,
      'Review scoped admin machine boundary' as action_label,
      coalesce(auth_user.email::text, grant_row.user_id::text) as workspace_search,
      coalesce(grant_row.expires_at, grant_row.granted_at) as sort_at,
      case
        when grant_row.expires_at is null then null::integer
        else ceil(extract(epoch from (grant_row.expires_at - now())) / 86400.0)::integer
      end as days_until_due,
      3 as severity_sort
    from public.admin_scoped_access_grants grant_row
    left join auth.users auth_user on auth_user.id = grant_row.user_id
    where grant_row.revoked_at is null
      and grant_row.starts_at <= now()
      and (
        grant_row.expires_at is null
        or grant_row.expires_at <= now() + (review_window_days * interval '1 day')
      )
  ),
  limited_items as (
    select *
    from review_items
    order by severity_sort, sort_at nulls last, source_label, person_email nulls last
    limit effective_limit
  )
  select jsonb_build_object(
    'generatedAt', now(),
    'windowDays', review_window_days,
    'items', coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', item_id,
          'kind', kind,
          'severity', severity,
          'personEmail', person_email,
          'userId', user_id,
          'sourceLabel', source_label,
          'scopeLabel', scope_label,
          'reason', reason,
          'expiresAt', expires_at,
          'reviewBy', review_by,
          'actionLabel', action_label,
          'workspaceSearch', workspace_search,
          'daysUntilDue', days_until_due
        )
        order by severity_sort, sort_at nulls last, source_label, person_email nulls last
      ),
      '[]'::jsonb
    )
  )
  into result
  from limited_items;

  return coalesce(
    result,
    jsonb_build_object(
      'generatedAt', now(),
      'windowDays', review_window_days,
      'items', '[]'::jsonb
    )
  );
end;
$$;

comment on function public.admin_get_access_review_queue(integer, integer) is
  'Read-only super-admin lifecycle review queue for expiring and high-risk access sources.';

revoke execute on function public.admin_get_access_review_queue(integer, integer)
  from public, anon;
grant execute on function public.admin_get_access_review_queue(integer, integer)
  to authenticated, service_role;

select pg_notify('pgrst', 'reload schema');
