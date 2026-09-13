-- A single, read-only directory for the People & Permissions roster.
-- The browser receives summaries only; existing source-specific RPCs remain the
-- authority for viewing and changing an individual person's access.

create schema if not exists private;

create or replace function private.admin_list_access_people(
  p_search text default null,
  p_role text default null,
  p_account_id uuid default null,
  p_status text default null,
  p_machine_id uuid default null,
  p_limit integer default 25,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_user_id uuid := auth.uid();
  actor_is_super boolean;
  actor_machine_ids uuid[];
  result jsonb;
begin
  if actor_user_id is null or not public.is_admin(actor_user_id) then
    raise exception 'Admin access required';
  end if;

  actor_is_super := public.is_super_admin(actor_user_id);
  actor_machine_ids := coalesce(public.scoped_admin_machine_ids(actor_user_id), '{}'::uuid[]);

  with source_rows as (
    select
      membership.user_id,
      users.email,
      initcap(replace(membership.role, '_', ' ')) as role_label,
      membership.account_id,
      null::uuid as machine_id,
      'active'::text as source_status,
      null::text as attention_reason,
      membership.updated_at,
      null::uuid as operator_profile_id,
      null::text as display_name
    from public.customer_account_memberships membership
    join auth.users users on users.id = membership.user_id
    where membership.active

    union all

    select
      grant_row.technician_user_id,
      lower(trim(grant_row.technician_email)),
      'Technician',
      grant_row.account_id,
      assignment.machine_id,
      grant_row.status,
      case
        when grant_row.invite_last_error is not null then 'Invite delivery needs attention'
        when grant_row.status = 'pending' and grant_row.expires_at is not null and grant_row.expires_at <= now()
          then 'Technician invitation expired'
        else null
      end,
      greatest(grant_row.updated_at, coalesce(assignment.updated_at, grant_row.updated_at)),
      profile.id,
      profile.display_name
    from public.technician_grants grant_row
    left join public.technician_machine_assignments assignment
      on assignment.technician_grant_id = grant_row.id
      and assignment.revoked_at is null
      and assignment.status = 'active'
      and assignment.starts_at <= now()
      and (assignment.expires_at is null or assignment.expires_at > now())
    left join public.operator_payout_profiles profile
      on profile.user_id = grant_row.technician_user_id
      and profile.account_id = grant_row.account_id
    where grant_row.revoked_at is null
      and grant_row.status in ('pending', 'active', 'suspended')

    union all

    select
      membership.user_id,
      lower(trim(membership.member_email)),
      'Corporate Partner',
      null::uuid,
      null::uuid,
      membership.status,
      null::text,
      membership.updated_at,
      null::uuid,
      null::text
    from public.corporate_partner_memberships membership
    where membership.revoked_at is null
      and membership.status in ('active', 'suspended')

    union all

    select
      entitlement.user_id,
      users.email,
      case entitlement.access_level
        when 'report_manager' then 'Reporting Manager'
        else 'Reporting Viewer'
      end,
      entitlement.account_id,
      entitlement.machine_id,
      'active',
      null::text,
      entitlement.updated_at,
      null::uuid,
      null::text
    from public.reporting_machine_entitlements entitlement
    join auth.users users on users.id = entitlement.user_id
    where entitlement.revoked_at is null
      and entitlement.starts_at <= now()
      and (entitlement.expires_at is null or entitlement.expires_at > now())

    union all

    select
      role_row.user_id,
      users.email,
      'Super Admin',
      null::uuid,
      null::uuid,
      'active',
      null::text,
      role_row.updated_at,
      null::uuid,
      null::text
    from public.admin_roles role_row
    join auth.users users on users.id = role_row.user_id
    where role_row.role = 'super_admin'
      and role_row.active
      and role_row.revoked_at is null

    union all

    select
      grant_row.user_id,
      users.email,
      'Scoped Admin',
      scope.account_id,
      scope.machine_id,
      'active',
      null::text,
      greatest(grant_row.updated_at, coalesce(scope.updated_at, grant_row.updated_at)),
      null::uuid,
      null::text
    from public.admin_scoped_access_grants grant_row
    join auth.users users on users.id = grant_row.user_id
    left join public.admin_scoped_access_scopes scope
      on scope.grant_id = grant_row.id
      and scope.revoked_at is null
    where grant_row.revoked_at is null
      and grant_row.starts_at <= now()
      and (grant_row.expires_at is null or grant_row.expires_at > now())

    union all

    select
      invite.activated_user_id,
      invite.target_email,
      'Scoped Admin',
      null::uuid,
      scope.machine_id,
      'invited',
      case when invite.expires_at <= now() then 'Invitation expired' else null end,
      invite.updated_at,
      null::uuid,
      null::text
    from public.admin_scoped_access_invites invite
    left join public.admin_scoped_access_invite_scopes scope on scope.invite_id = invite.id
    where invite.status = 'pending'

    union all

    select
      profile.user_id,
      users.email,
      'Technician',
      profile.account_id,
      assignment.reporting_machine_id,
      profile.status,
      case when profile.payout_policy_id is null then 'Technician pay setup is incomplete' else null end,
      greatest(profile.updated_at, coalesce(assignment.updated_at, profile.updated_at)),
      profile.id,
      profile.display_name
    from public.operator_payout_profiles profile
    join auth.users users on users.id = profile.user_id
    left join public.operator_machine_assignments assignment
      on assignment.operator_profile_id = profile.id
      and assignment.status = 'active'
      and assignment.revoked_at is null
      and assignment.effective_start_date <= current_date
      and (assignment.effective_end_date is null or assignment.effective_end_date >= current_date)
    where profile.status = 'active'
  ), normalized as (
    select
      coalesce('user:' || user_id::text, 'email:' || lower(trim(email))) as person_key,
      user_id,
      lower(trim(email)) as email,
      role_label,
      account_id,
      machine_id,
      source_status,
      attention_reason,
      updated_at,
      operator_profile_id,
      display_name
    from source_rows
    where user_id is not null or nullif(trim(email), '') is not null
  ), visible as (
    select distinct normalized.*
    from normalized
    left join public.reporting_machines account_machine
      on account_machine.account_id = normalized.account_id
    where actor_is_super
      or normalized.machine_id = any(actor_machine_ids)
      or account_machine.id = any(actor_machine_ids)
  ), grouped as (
    select
      person_key,
      (array_agg(user_id) filter (where user_id is not null))[1] as user_id,
      max(email) as email,
      coalesce(max(display_name), split_part(max(email), '@', 1), 'Unknown person') as display_name,
      array_agg(distinct role_label order by role_label) as roles,
      array_remove(array_agg(distinct account.name order by account.name), null) as account_names,
      count(distinct coalesce(visible.machine_id, account_machine.id))::integer as machine_count,
      case
        when bool_or(attention_reason is not null) then 'needs_attention'
        when bool_and(source_status = 'invited') then 'invited'
        when bool_or(source_status in ('active', 'pending')) then 'active'
        else 'inactive'
      end as status,
      max(attention_reason) as attention_reason,
      (array_agg(operator_profile_id) filter (where operator_profile_id is not null))[1] as operator_profile_id,
      max(updated_at) as updated_at
    from visible
    left join public.customer_accounts account on account.id = visible.account_id
    left join public.reporting_machines account_machine
      on account_machine.account_id = visible.account_id
    group by person_key
  ), filtered as (
    select grouped.*, count(*) over()::integer as total_count
    from grouped
    where (nullif(trim(p_search), '') is null
      or grouped.display_name ilike '%' || trim(p_search) || '%'
      or grouped.email ilike '%' || trim(p_search) || '%'
      or grouped.user_id::text = trim(p_search))
      and (nullif(trim(p_role), '') is null or p_role = any(grouped.roles))
      and (p_account_id is null or exists (
        select 1 from visible source where source.person_key = grouped.person_key and source.account_id = p_account_id
      ))
      and (nullif(trim(p_status), '') is null or grouped.status = p_status)
      and (p_machine_id is null or exists (
        select 1 from visible source
        left join public.reporting_machines source_account_machine on source_account_machine.account_id = source.account_id
        where source.person_key = grouped.person_key
          and (source.machine_id = p_machine_id or source_account_machine.id = p_machine_id)
      ))
  ), page as (
    select * from filtered
    order by
      case status when 'needs_attention' then 0 when 'invited' then 1 when 'active' then 2 else 3 end,
      display_name,
      email
    limit greatest(1, least(coalesce(p_limit, 25), 100))
    offset greatest(coalesce(p_offset, 0), 0)
  )
  select jsonb_build_object(
    'items', coalesce(jsonb_agg(jsonb_build_object(
      'personKey', page.person_key,
      'userId', page.user_id,
      'email', page.email,
      'displayName', page.display_name,
      'roles', to_jsonb(page.roles),
      'accountNames', to_jsonb(page.account_names),
      'machineCount', page.machine_count,
      'status', page.status,
      'attentionReason', page.attention_reason,
      'operatorProfileId', page.operator_profile_id,
      'updatedAt', page.updated_at
    ) order by
      case page.status when 'needs_attention' then 0 when 'invited' then 1 when 'active' then 2 else 3 end,
      page.display_name,
      page.email), '[]'::jsonb),
    'totalCount', coalesce(max(page.total_count), 0),
    'roles', coalesce((
      select jsonb_agg(role_label order by role_label)
      from (select distinct role_label from visible) role_options
    ), '[]'::jsonb),
    'accounts', coalesce((
      select jsonb_agg(jsonb_build_object('id', account_id, 'name', account_name) order by account_name)
      from (
        select distinct account.id as account_id, account.name as account_name
        from visible source
        join public.customer_accounts account on account.id = source.account_id
      ) account_options
    ), '[]'::jsonb),
    'machines', coalesce((
      select jsonb_agg(jsonb_build_object('id', machine_id, 'label', machine_label) order by machine_label)
      from (
        select distinct machine.id as machine_id, machine.machine_label
        from visible source
        join public.reporting_machines machine
          on machine.id = source.machine_id or machine.account_id = source.account_id
      ) machine_options
    ), '[]'::jsonb),
    'updatedAt', now()
  ) into result
  from page;

  return result;
end;
$$;

create or replace function public.admin_list_access_people(
  p_search text default null,
  p_role text default null,
  p_account_id uuid default null,
  p_status text default null,
  p_machine_id uuid default null,
  p_limit integer default 25,
  p_offset integer default 0
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select private.admin_list_access_people(
    p_search,
    p_role,
    p_account_id,
    p_status,
    p_machine_id,
    p_limit,
    p_offset
  );
$$;

comment on function public.admin_list_access_people(text, text, uuid, text, uuid, integer, integer) is
  'Returns the paginated, actor-scoped People & Permissions roster. Mutations remain source-specific and audited.';

revoke all on function private.admin_list_access_people(text, text, uuid, text, uuid, integer, integer)
  from public, anon;
revoke all on function public.admin_list_access_people(text, text, uuid, text, uuid, integer, integer)
  from public, anon;
grant usage on schema private to authenticated, service_role;
grant execute on function private.admin_list_access_people(text, text, uuid, text, uuid, integer, integer)
  to authenticated, service_role;
grant execute on function public.admin_list_access_people(text, text, uuid, text, uuid, integer, integer)
  to authenticated, service_role;
