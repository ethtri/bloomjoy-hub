-- Reporting access UX support: people-first access matrix, user lookup, and
-- idempotent machine-only grants.

update public.reporting_machine_entitlements
set
  account_id = null,
  location_id = null
where machine_id is not null
  and revoked_at is null
  and (account_id is not null or location_id is not null);

drop function if exists public.admin_get_reporting_access_matrix();
create or replace function public.admin_get_reporting_access_matrix()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  result jsonb;
begin
  if not public.is_super_admin(auth.uid()) then
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

drop function if exists public.admin_lookup_reporting_user_by_email(text);
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
begin
  if not public.is_super_admin(auth.uid()) then
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
        and public.reporting_entitlement_is_active(
          entitlement.starts_at,
          entitlement.expires_at,
          entitlement.revoked_at
        )
    ) as explicit_machine_count,
    count(entitlement.id) filter (
      where entitlement.machine_id is null
        and (entitlement.account_id is not null or entitlement.location_id is not null)
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

create or replace function public.admin_grant_machine_report_access(
  p_user_email text,
  p_account_id uuid,
  p_location_id uuid,
  p_machine_id uuid,
  p_access_level text,
  p_reason text
)
returns public.reporting_machine_entitlements
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  normalized_email text;
  normalized_reason text;
  normalized_access_level text;
  target_user_id uuid;
  machine_row public.reporting_machines;
  location_row public.reporting_locations;
  account_row public.customer_accounts;
  existing_row public.reporting_machine_entitlements;
  entitlement_row public.reporting_machine_entitlements;
  normalized_account_id uuid;
  normalized_location_id uuid;
  normalized_machine_id uuid;
begin
  if not public.is_super_admin(auth.uid()) then
    raise exception 'Admin access required';
  end if;

  normalized_email := lower(trim(coalesce(p_user_email, '')));
  normalized_reason := trim(coalesce(p_reason, ''));
  normalized_access_level := lower(coalesce(nullif(trim(p_access_level), ''), 'viewer'));

  if normalized_email = '' then
    raise exception 'User email is required';
  end if;

  if normalized_access_level not in ('viewer', 'report_manager') then
    raise exception 'Invalid reporting access level';
  end if;

  if normalized_reason = '' then
    raise exception 'Grant reason is required';
  end if;

  if p_account_id is null and p_location_id is null and p_machine_id is null then
    raise exception 'A reporting scope is required';
  end if;

  select users.id
  into target_user_id
  from auth.users users
  where lower(users.email) = normalized_email
  limit 1;

  if target_user_id is null then
    raise exception 'No user found for email %', normalized_email;
  end if;

  if p_machine_id is not null then
    select *
    into machine_row
    from public.reporting_machines machine
    where machine.id = p_machine_id
    limit 1;

    if machine_row.id is null then
      raise exception 'Reporting machine not found';
    end if;

    normalized_machine_id := machine_row.id;
    normalized_location_id := null;
    normalized_account_id := null;
  elsif p_location_id is not null then
    select *
    into location_row
    from public.reporting_locations location
    where location.id = p_location_id
    limit 1;

    if location_row.id is null then
      raise exception 'Reporting location not found';
    end if;

    normalized_machine_id := null;
    normalized_location_id := location_row.id;
    normalized_account_id := null;
  else
    select *
    into account_row
    from public.customer_accounts account
    where account.id = p_account_id
    limit 1;

    if account_row.id is null then
      raise exception 'Reporting account not found';
    end if;

    normalized_machine_id := null;
    normalized_location_id := null;
    normalized_account_id := account_row.id;
  end if;

  select *
  into existing_row
  from public.reporting_machine_entitlements entitlement
  where entitlement.user_id = target_user_id
    and entitlement.account_id is not distinct from normalized_account_id
    and entitlement.location_id is not distinct from normalized_location_id
    and entitlement.machine_id is not distinct from normalized_machine_id
  order by entitlement.revoked_at is null desc, entitlement.updated_at desc
  limit 1;

  if existing_row.id is not null then
    update public.reporting_machine_entitlements
    set
      access_level = normalized_access_level,
      grant_reason = normalized_reason,
      starts_at = now(),
      expires_at = null,
      granted_by = auth.uid(),
      revoked_at = null,
      revoked_by = null,
      revoke_reason = null
    where id = existing_row.id
    returning * into entitlement_row;
  else
    insert into public.reporting_machine_entitlements (
      user_id,
      account_id,
      location_id,
      machine_id,
      access_level,
      grant_reason,
      granted_by
    )
    values (
      target_user_id,
      normalized_account_id,
      normalized_location_id,
      normalized_machine_id,
      normalized_access_level,
      normalized_reason,
      auth.uid()
    )
    returning * into entitlement_row;
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
    'reporting_access.granted',
    'reporting_machine_entitlement',
    entitlement_row.id::text,
    target_user_id,
    coalesce(to_jsonb(existing_row), '{}'::jsonb),
    to_jsonb(entitlement_row),
    jsonb_build_object(
      'email',
      normalized_email,
      'reason',
      normalized_reason,
      'access_level',
      normalized_access_level,
      'scope',
      case
        when normalized_machine_id is not null then 'machine'
        when normalized_location_id is not null then 'location'
        when normalized_account_id is not null then 'account'
        else 'unknown'
      end
    )
  );

  return entitlement_row;
end;
$$;

grant execute on function public.admin_get_reporting_access_matrix() to authenticated;
grant execute on function public.admin_lookup_reporting_user_by_email(text) to authenticated;
