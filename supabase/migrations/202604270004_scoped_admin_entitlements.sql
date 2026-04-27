-- Scoped Admin entitlement model and production bootstrap for issue #259.
-- This keeps super_admin as the only global role and gives internal admins
-- explicit machine-scoped authority for the Admin Access reporting surface.

create table if not exists public.admin_scoped_access_grants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'scoped_admin'
    check (role = 'scoped_admin'),
  source text not null default 'manual_admin_grant'
    check (source in ('manual_admin_grant', 'production_bootstrap')),
  starts_at timestamptz not null default now(),
  expires_at timestamptz,
  grant_reason text not null,
  granted_by uuid references auth.users (id) on delete set null,
  granted_at timestamptz not null default now(),
  revoked_by uuid references auth.users (id) on delete set null,
  revoked_at timestamptz,
  revoke_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint admin_scoped_access_grants_valid_window check (
    expires_at is null or expires_at > starts_at
  ),
  constraint admin_scoped_access_grants_reason_present check (
    length(trim(grant_reason)) > 0
  ),
  constraint admin_scoped_access_grants_revoke_reason_required check (
    revoked_at is null or length(trim(coalesce(revoke_reason, ''))) > 0
  )
);

create unique index if not exists admin_scoped_access_one_active_user_idx
  on public.admin_scoped_access_grants (user_id, role)
  where revoked_at is null;

create index if not exists admin_scoped_access_grants_user_id_idx
  on public.admin_scoped_access_grants (user_id)
  where revoked_at is null;

drop trigger if exists admin_scoped_access_grants_set_updated_at
  on public.admin_scoped_access_grants;
create trigger admin_scoped_access_grants_set_updated_at
before update on public.admin_scoped_access_grants
for each row execute function public.set_updated_at();

create table if not exists public.admin_scoped_access_scopes (
  id uuid primary key default gen_random_uuid(),
  grant_id uuid not null references public.admin_scoped_access_grants (id) on delete cascade,
  scope_type text not null check (scope_type in ('account', 'machine')),
  account_id uuid references public.customer_accounts (id) on delete cascade,
  machine_id uuid references public.reporting_machines (id) on delete cascade,
  grant_reason text not null,
  granted_by uuid references auth.users (id) on delete set null,
  granted_at timestamptz not null default now(),
  revoked_by uuid references auth.users (id) on delete set null,
  revoked_at timestamptz,
  revoke_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint admin_scoped_access_scopes_shape_check check (
    (
      scope_type = 'account'
      and account_id is not null
      and machine_id is null
    )
    or (
      scope_type = 'machine'
      and account_id is null
      and machine_id is not null
    )
  ),
  constraint admin_scoped_access_scopes_reason_present check (
    length(trim(grant_reason)) > 0
  ),
  constraint admin_scoped_access_scopes_revoke_reason_required check (
    revoked_at is null or length(trim(coalesce(revoke_reason, ''))) > 0
  )
);

create unique index if not exists admin_scoped_access_one_active_machine_scope_idx
  on public.admin_scoped_access_scopes (grant_id, machine_id)
  where scope_type = 'machine' and revoked_at is null;

create unique index if not exists admin_scoped_access_one_active_account_scope_idx
  on public.admin_scoped_access_scopes (grant_id, account_id)
  where scope_type = 'account' and revoked_at is null;

create index if not exists admin_scoped_access_scopes_grant_id_idx
  on public.admin_scoped_access_scopes (grant_id)
  where revoked_at is null;

create index if not exists admin_scoped_access_scopes_machine_id_idx
  on public.admin_scoped_access_scopes (machine_id)
  where revoked_at is null;

create index if not exists admin_scoped_access_scopes_account_id_idx
  on public.admin_scoped_access_scopes (account_id)
  where revoked_at is null;

drop trigger if exists admin_scoped_access_scopes_set_updated_at
  on public.admin_scoped_access_scopes;
create trigger admin_scoped_access_scopes_set_updated_at
before update on public.admin_scoped_access_scopes
for each row execute function public.set_updated_at();

alter table public.admin_scoped_access_grants enable row level security;
alter table public.admin_scoped_access_scopes enable row level security;

drop policy if exists "admin_scoped_access_grants_select_self_or_super_admin"
  on public.admin_scoped_access_grants;
create policy "admin_scoped_access_grants_select_self_or_super_admin"
on public.admin_scoped_access_grants
for select
using (
  auth.uid() = user_id
  or public.is_super_admin(auth.uid())
);

drop policy if exists "admin_scoped_access_grants_write_super_admin"
  on public.admin_scoped_access_grants;
create policy "admin_scoped_access_grants_write_super_admin"
on public.admin_scoped_access_grants
for all
using (public.is_super_admin(auth.uid()))
with check (public.is_super_admin(auth.uid()));

drop policy if exists "admin_scoped_access_scopes_select_related_or_super_admin"
  on public.admin_scoped_access_scopes;
create policy "admin_scoped_access_scopes_select_related_or_super_admin"
on public.admin_scoped_access_scopes
for select
using (
  public.is_super_admin(auth.uid())
  or exists (
    select 1
    from public.admin_scoped_access_grants grant_row
    where grant_row.id = admin_scoped_access_scopes.grant_id
      and grant_row.user_id = auth.uid()
  )
);

drop policy if exists "admin_scoped_access_scopes_write_super_admin"
  on public.admin_scoped_access_scopes;
create policy "admin_scoped_access_scopes_write_super_admin"
on public.admin_scoped_access_scopes
for all
using (public.is_super_admin(auth.uid()))
with check (public.is_super_admin(auth.uid()));

create or replace function public.admin_scoped_grant_is_active(
  starts_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz
)
returns boolean
language sql
stable
as $$
  select
    revoked_at is null
    and starts_at <= now()
    and (expires_at is null or expires_at > now());
$$;

create or replace function public.scoped_admin_machine_ids(uid uuid)
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(distinct machine.id), '{}'::uuid[])
  from public.admin_scoped_access_grants grant_row
  join public.admin_scoped_access_scopes scope_row
    on scope_row.grant_id = grant_row.id
  join public.reporting_machines machine
    on (
      scope_row.scope_type = 'machine'
      and machine.id = scope_row.machine_id
    )
    or (
      scope_row.scope_type = 'account'
      and machine.account_id = scope_row.account_id
    )
  where grant_row.user_id = uid
    and grant_row.role = 'scoped_admin'
    and public.admin_scoped_grant_is_active(
      grant_row.starts_at,
      grant_row.expires_at,
      grant_row.revoked_at
    )
    and scope_row.revoked_at is null;
$$;

create or replace function public.is_scoped_admin(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_length(public.scoped_admin_machine_ids(uid), 1), 0) > 0;
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
      and lower(coalesce(nullif(trim(surface), ''), 'access')) in ('access', 'reporting_access')
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
  actor_machine_ids := public.scoped_admin_machine_ids(actor_user_id);
  actor_is_scoped_admin := coalesce(array_length(actor_machine_ids, 1), 0) > 0;

  return jsonb_build_object(
    'isSuperAdmin', actor_is_super_admin,
    'isScopedAdmin', actor_is_scoped_admin,
    'canAccessAdmin', actor_is_super_admin or actor_is_scoped_admin,
    'allowedSurfaces',
      case
        when actor_is_super_admin then jsonb_build_array('*')
        when actor_is_scoped_admin then jsonb_build_array('access', 'reporting_access')
        else '[]'::jsonb
      end,
    'scopedMachineIds', to_jsonb(actor_machine_ids)
  );
end;
$$;

create or replace function public.admin_list_scoped_admin_grants()
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
    raise exception 'Super-admin access required';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', grant_row.id,
        'userId', grant_row.user_id,
        'userEmail', users.email,
        'role', grant_row.role,
        'source', grant_row.source,
        'active', public.admin_scoped_grant_is_active(
          grant_row.starts_at,
          grant_row.expires_at,
          grant_row.revoked_at
        ),
        'startsAt', grant_row.starts_at,
        'expiresAt', grant_row.expires_at,
        'grantReason', grant_row.grant_reason,
        'grantedBy', grant_row.granted_by,
        'grantedAt', grant_row.granted_at,
        'revokedBy', grant_row.revoked_by,
        'revokedAt', grant_row.revoked_at,
        'revokeReason', grant_row.revoke_reason,
        'scopes', coalesce(
          (
            select jsonb_agg(
              jsonb_build_object(
                'id', scope_row.id,
                'scopeType', scope_row.scope_type,
                'accountId', scope_row.account_id,
                'accountName', account.name,
                'machineId', scope_row.machine_id,
                'machineLabel', machine.machine_label,
                'sunzeMachineId', machine.sunze_machine_id,
                'active', scope_row.revoked_at is null,
                'grantedAt', scope_row.granted_at,
                'revokedAt', scope_row.revoked_at
              )
              order by account.name, machine.machine_label
            )
            from public.admin_scoped_access_scopes scope_row
            left join public.customer_accounts account
              on account.id = scope_row.account_id
            left join public.reporting_machines machine
              on machine.id = scope_row.machine_id
            where scope_row.grant_id = grant_row.id
              and scope_row.revoked_at is null
          ),
          '[]'::jsonb
        )
      )
      order by
        public.admin_scoped_grant_is_active(
          grant_row.starts_at,
          grant_row.expires_at,
          grant_row.revoked_at
        ) desc,
        users.email
    ),
    '[]'::jsonb
  )
  into result
  from public.admin_scoped_access_grants grant_row
  left join auth.users users on users.id = grant_row.user_id;

  return result;
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

  if coalesce(array_length(desired_machine_ids, 1), 0) = 0 then
    raise exception 'At least one machine scope is required';
  end if;

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
      'reason',
      normalized_reason,
      'target_email',
      normalized_email,
      'machine_ids',
      desired_machine_ids,
      'added_count',
      added_count,
      'revoked_count',
      revoked_count,
      'issue',
      '#259'
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

create or replace function public.admin_revoke_scoped_admin(
  p_grant_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  normalized_reason text;
  grant_before public.admin_scoped_access_grants;
  grant_after public.admin_scoped_access_grants;
begin
  if not public.is_super_admin(auth.uid()) then
    raise exception 'Super-admin access required';
  end if;

  normalized_reason := trim(coalesce(p_reason, ''));

  if p_grant_id is null then
    raise exception 'Scoped admin grant ID is required';
  end if;

  if normalized_reason = '' then
    raise exception 'Revoke reason is required';
  end if;

  select *
  into grant_before
  from public.admin_scoped_access_grants grant_row
  where grant_row.id = p_grant_id
    and grant_row.revoked_at is null
  limit 1;

  if grant_before.id is null then
    raise exception 'Active scoped admin grant not found';
  end if;

  update public.admin_scoped_access_grants
  set
    revoked_by = auth.uid(),
    revoked_at = now(),
    revoke_reason = normalized_reason
  where id = grant_before.id
  returning * into grant_after;

  update public.admin_scoped_access_scopes
  set
    revoked_by = auth.uid(),
    revoked_at = now(),
    revoke_reason = normalized_reason
  where grant_id = grant_before.id
    and revoked_at is null;

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
    'admin_scoped_access.revoked',
    'admin_scoped_access_grant',
    grant_after.id::text,
    grant_after.user_id,
    to_jsonb(grant_before),
    to_jsonb(grant_after),
    jsonb_build_object('reason', normalized_reason, 'issue', '#259')
  );

  return jsonb_build_object(
    'grantId', grant_after.id,
    'userId', grant_after.user_id,
    'revokedAt', grant_after.revoked_at
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
  actor_machine_ids uuid[];
begin
  actor_user_id := auth.uid();
  actor_is_super_admin := public.is_super_admin(actor_user_id);
  actor_machine_ids := public.scoped_admin_machine_ids(actor_user_id);

  if not actor_is_super_admin and coalesce(array_length(actor_machine_ids, 1), 0) = 0 then
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
  actor_machine_ids uuid[];
begin
  actor_user_id := auth.uid();
  actor_is_super_admin := public.is_super_admin(actor_user_id);
  actor_machine_ids := public.scoped_admin_machine_ids(actor_user_id);

  if not actor_is_super_admin and coalesce(array_length(actor_machine_ids, 1), 0) = 0 then
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
  actor_user_id uuid;
  actor_is_super_admin boolean;
  actor_machine_ids uuid[];
begin
  actor_user_id := auth.uid();
  actor_is_super_admin := public.is_super_admin(actor_user_id);
  actor_machine_ids := public.scoped_admin_machine_ids(actor_user_id);

  if not actor_is_super_admin and coalesce(array_length(actor_machine_ids, 1), 0) = 0 then
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
    if not actor_is_super_admin then
      raise exception 'Scoped admins can grant machine-scoped reporting access only';
    end if;

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
    if not actor_is_super_admin then
      raise exception 'Scoped admins can grant machine-scoped reporting access only';
    end if;

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

  if not actor_is_super_admin
    and not (normalized_machine_id = any(actor_machine_ids))
  then
    raise exception 'Scoped admin access does not include this machine';
  end if;

  select *
  into existing_row
  from public.reporting_machine_entitlements entitlement
  where entitlement.user_id = target_user_id
    and entitlement.account_id is not distinct from normalized_account_id
    and entitlement.location_id is not distinct from normalized_location_id
    and entitlement.machine_id is not distinct from normalized_machine_id
    and coalesce(entitlement.source_type, 'manual') = 'manual'
  order by entitlement.revoked_at is null desc, entitlement.updated_at desc
  limit 1;

  if existing_row.id is not null then
    update public.reporting_machine_entitlements
    set
      access_level = normalized_access_level,
      grant_reason = normalized_reason,
      starts_at = now(),
      expires_at = null,
      granted_by = actor_user_id,
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
      granted_by,
      source_type,
      source_id
    )
    values (
      target_user_id,
      normalized_account_id,
      normalized_location_id,
      normalized_machine_id,
      normalized_access_level,
      normalized_reason,
      actor_user_id,
      'manual',
      null
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
    actor_user_id,
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
      'source_type',
      'manual',
      'actor_authority',
      case when actor_is_super_admin then 'super_admin' else 'scoped_admin' end,
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

create or replace function public.admin_revoke_reporting_access(
  p_entitlement_id uuid,
  p_reason text
)
returns public.reporting_machine_entitlements
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  normalized_reason text;
  before_row public.reporting_machine_entitlements;
  after_row public.reporting_machine_entitlements;
  actor_user_id uuid;
  actor_is_super_admin boolean;
  actor_machine_ids uuid[];
begin
  actor_user_id := auth.uid();
  actor_is_super_admin := public.is_super_admin(actor_user_id);
  actor_machine_ids := public.scoped_admin_machine_ids(actor_user_id);

  if not actor_is_super_admin and coalesce(array_length(actor_machine_ids, 1), 0) = 0 then
    raise exception 'Admin access required';
  end if;

  normalized_reason := trim(coalesce(p_reason, ''));

  if p_entitlement_id is null then
    raise exception 'Entitlement id is required';
  end if;

  if normalized_reason = '' then
    raise exception 'Revocation reason is required';
  end if;

  select *
  into before_row
  from public.reporting_machine_entitlements entitlement
  where entitlement.id = p_entitlement_id
  limit 1;

  if before_row.id is null then
    raise exception 'Reporting entitlement not found';
  end if;

  if coalesce(before_row.source_type, 'manual') <> 'manual' then
    raise exception 'Only manual reporting grants can be revoked here';
  end if;

  if not actor_is_super_admin
    and (
      before_row.machine_id is null
      or not (before_row.machine_id = any(actor_machine_ids))
    )
  then
    raise exception 'Scoped admin access does not include this entitlement';
  end if;

  update public.reporting_machine_entitlements
  set
    revoked_at = coalesce(revoked_at, now()),
    revoked_by = coalesce(revoked_by, actor_user_id),
    revoke_reason = normalized_reason
  where id = p_entitlement_id
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
    actor_user_id,
    'reporting_access.revoked',
    'reporting_machine_entitlement',
    after_row.id::text,
    after_row.user_id,
    to_jsonb(before_row),
    to_jsonb(after_row),
    jsonb_build_object(
      'reason',
      normalized_reason,
      'actor_authority',
      case when actor_is_super_admin then 'super_admin' else 'scoped_admin' end,
      'source_type',
      'manual'
    )
  );

  return after_row;
end;
$$;

create or replace function public.admin_set_user_machine_reporting_access(
  p_user_email text,
  p_machine_ids uuid[],
  p_access_level text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  normalized_email text;
  normalized_reason text;
  normalized_access_level text;
  target_user_id uuid;
  normalized_machine_ids uuid[];
  existing_row public.reporting_machine_entitlements;
  desired_machine_id uuid;
  missing_machine_count bigint;
  out_of_scope_count bigint;
  added_count integer := 0;
  revoked_count integer := 0;
  actor_user_id uuid;
  actor_is_super_admin boolean;
  actor_machine_ids uuid[];
begin
  actor_user_id := auth.uid();
  actor_is_super_admin := public.is_super_admin(actor_user_id);
  actor_machine_ids := public.scoped_admin_machine_ids(actor_user_id);

  if not actor_is_super_admin and coalesce(array_length(actor_machine_ids, 1), 0) = 0 then
    raise exception 'Admin access required';
  end if;

  normalized_email := lower(trim(coalesce(p_user_email, '')));
  normalized_reason := public.reporting_admin_assert_reason(p_reason);
  normalized_access_level := lower(coalesce(nullif(trim(p_access_level), ''), 'viewer'));

  if normalized_email = '' then
    raise exception 'User email is required';
  end if;

  if normalized_access_level not in ('viewer', 'report_manager') then
    raise exception 'Invalid reporting access level';
  end if;

  select users.id
  into target_user_id
  from auth.users users
  where lower(users.email) = normalized_email
  limit 1;

  if target_user_id is null then
    raise exception 'No user found for email %', normalized_email;
  end if;

  select coalesce(array_agg(distinct requested.machine_id), '{}'::uuid[])
  into normalized_machine_ids
  from unnest(coalesce(p_machine_ids, '{}'::uuid[])) as requested(machine_id)
  where requested.machine_id is not null;

  select count(*)
  into missing_machine_count
  from unnest(normalized_machine_ids) as requested(machine_id)
  left join public.reporting_machines machine on machine.id = requested.machine_id
  where machine.id is null;

  if missing_machine_count > 0 then
    raise exception 'One or more reporting machines were not found';
  end if;

  if not actor_is_super_admin then
    select count(*)
    into out_of_scope_count
    from unnest(normalized_machine_ids) as requested(machine_id)
    where not (requested.machine_id = any(actor_machine_ids));

    if out_of_scope_count > 0 then
      raise exception 'Scoped admin access does not include one or more requested machines';
    end if;
  end if;

  for existing_row in
    select *
    from public.reporting_machine_entitlements entitlement
    where entitlement.user_id = target_user_id
      and entitlement.machine_id is not null
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
  loop
    if not (existing_row.machine_id = any(normalized_machine_ids)) then
      perform public.admin_revoke_reporting_access(existing_row.id, normalized_reason);
      revoked_count := revoked_count + 1;
    end if;
  end loop;

  foreach desired_machine_id in array normalized_machine_ids
  loop
    if not exists (
      select 1
      from public.reporting_machine_entitlements entitlement
      where entitlement.user_id = target_user_id
        and entitlement.machine_id = desired_machine_id
        and coalesce(entitlement.source_type, 'manual') = 'manual'
        and public.reporting_entitlement_is_active(
          entitlement.starts_at,
          entitlement.expires_at,
          entitlement.revoked_at
        )
    ) then
      added_count := added_count + 1;

      perform public.admin_grant_reporting_access(
        normalized_email,
        null,
        null,
        desired_machine_id,
        normalized_access_level,
        normalized_reason
      );
    end if;
  end loop;

  return jsonb_build_object(
    'userId', target_user_id,
    'machineCount', coalesce(array_length(normalized_machine_ids, 1), 0),
    'addedCount', added_count,
    'revokedCount', revoked_count
  );
end;
$$;

revoke execute on function public.admin_scoped_grant_is_active(timestamptz, timestamptz, timestamptz) from public, anon, authenticated;
revoke execute on function public.scoped_admin_machine_ids(uuid) from public, anon, authenticated;
revoke execute on function public.is_scoped_admin(uuid) from public, anon, authenticated;
revoke execute on function public.can_access_admin_surface(uuid, text) from public, anon, authenticated;

grant execute on function public.admin_scoped_grant_is_active(timestamptz, timestamptz, timestamptz) to service_role;
grant execute on function public.scoped_admin_machine_ids(uuid) to service_role;
grant execute on function public.is_scoped_admin(uuid) to service_role;
grant execute on function public.can_access_admin_surface(uuid, text) to service_role;

revoke execute on function public.get_my_admin_access_context() from public, anon;
revoke execute on function public.admin_list_scoped_admin_grants() from public, anon;
revoke execute on function public.admin_grant_scoped_admin_by_email(text, uuid[], text) from public, anon;
revoke execute on function public.admin_revoke_scoped_admin(uuid, text) from public, anon;
revoke execute on function public.admin_get_reporting_access_matrix() from public, anon;
revoke execute on function public.admin_lookup_reporting_user_by_email(text) from public, anon;
revoke execute on function public.admin_grant_machine_report_access(text, uuid, uuid, uuid, text, text) from public, anon;
revoke execute on function public.admin_revoke_reporting_access(uuid, text) from public, anon;
revoke execute on function public.admin_set_user_machine_reporting_access(text, uuid[], text, text) from public, anon;

grant execute on function public.get_my_admin_access_context() to authenticated;
grant execute on function public.admin_list_scoped_admin_grants() to authenticated;
grant execute on function public.admin_grant_scoped_admin_by_email(text, uuid[], text) to authenticated;
grant execute on function public.admin_revoke_scoped_admin(uuid, text) to authenticated;
grant execute on function public.admin_get_reporting_access_matrix() to authenticated;
grant execute on function public.admin_lookup_reporting_user_by_email(text) to authenticated;
grant execute on function public.admin_grant_machine_report_access(text, uuid, uuid, uuid, text, text) to authenticated;
grant execute on function public.admin_revoke_reporting_access(uuid, text) to authenticated;
grant execute on function public.admin_set_user_machine_reporting_access(text, uuid[], text, text) to authenticated;

do $$
declare
  adam_user_id uuid;
  adam_grant_id uuid;
  adam_machine_id uuid;
  adam_machine_count integer := 0;
  bootstrap_reason text := 'P0 scoped-admin production bootstrap for issue #259';
begin
  select users.id
  into adam_user_id
  from auth.users users
  where lower(users.email) = 'adam@bloomjoysweets.com'
  limit 1;

  if adam_user_id is null then
    insert into public.admin_audit_log (
      action,
      entity_type,
      meta
    )
    values (
      'admin_scoped_access.bootstrap_skipped',
      'admin_scoped_access_grant',
      jsonb_build_object(
        'target_email',
        'adam@bloomjoysweets.com',
        'reason',
        'No auth.users row existed when migration ran',
        'issue',
        '#259'
      )
    );

    return;
  end if;

  if public.is_super_admin(adam_user_id) then
    insert into public.admin_audit_log (
      action,
      entity_type,
      target_user_id,
      meta
    )
    values (
      'admin_scoped_access.bootstrap_skipped',
      'admin_scoped_access_grant',
      adam_user_id,
      jsonb_build_object(
        'target_email',
        'adam@bloomjoysweets.com',
        'reason',
        'Target user is already a super-admin',
        'issue',
        '#259'
      )
    );

    return;
  end if;

  select grant_row.id
  into adam_grant_id
  from public.admin_scoped_access_grants grant_row
  where grant_row.user_id = adam_user_id
    and grant_row.role = 'scoped_admin'
    and grant_row.revoked_at is null
  limit 1;

  if adam_grant_id is null then
    insert into public.admin_scoped_access_grants (
      user_id,
      source,
      grant_reason
    )
    values (
      adam_user_id,
      'production_bootstrap',
      bootstrap_reason
    )
    returning id into adam_grant_id;
  else
    update public.admin_scoped_access_grants
    set
      source = 'production_bootstrap',
      starts_at = now(),
      expires_at = null,
      grant_reason = bootstrap_reason,
      revoked_by = null,
      revoked_at = null,
      revoke_reason = null
    where id = adam_grant_id;
  end if;

  for adam_machine_id in
    select machine.id
    from public.reporting_machines machine
    where coalesce(machine.status, 'active') = 'active'
  loop
    adam_machine_count := adam_machine_count + 1;

    insert into public.admin_scoped_access_scopes (
      grant_id,
      scope_type,
      machine_id,
      grant_reason
    )
    values (
      adam_grant_id,
      'machine',
      adam_machine_id,
      bootstrap_reason
    )
    on conflict (grant_id, machine_id)
      where scope_type = 'machine' and revoked_at is null
    do update
    set
      grant_reason = excluded.grant_reason,
      revoked_by = null,
      revoked_at = null,
      revoke_reason = null;
  end loop;

  insert into public.admin_audit_log (
    action,
    entity_type,
    entity_id,
    target_user_id,
    after,
    meta
  )
  values (
    'admin_scoped_access.bootstrap_granted',
    'admin_scoped_access_grant',
    adam_grant_id::text,
    adam_user_id,
    jsonb_build_object(
      'grant_id',
      adam_grant_id,
      'target_email',
      'adam@bloomjoysweets.com',
      'machine_count',
      adam_machine_count
    ),
    jsonb_build_object(
      'reason',
      bootstrap_reason,
      'scope',
      'active_reporting_machines',
      'issue',
      '#259'
    )
  );
end;
$$;

select pg_notify('pgrst', 'reload schema');
