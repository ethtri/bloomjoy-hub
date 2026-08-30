-- Issue #989: invitation-first Scoped Admin onboarding.
-- Pending invites are intentionally separate from effective grants. A grant is
-- created only after the exact invited email has completed Auth verification and
-- signs in with a normal authenticated session.

create table public.admin_scoped_access_invites (
  id uuid primary key default gen_random_uuid(),
  target_email text not null,
  status text not null default 'pending'
    check (status in ('pending', 'activated', 'revoked', 'expired')),
  grant_reason text not null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days'),
  activated_user_id uuid references auth.users (id) on delete set null,
  activated_grant_id uuid references public.admin_scoped_access_grants (id) on delete set null,
  activated_at timestamptz,
  revoked_by uuid references auth.users (id) on delete set null,
  revoked_at timestamptz,
  revoke_reason text,
  updated_at timestamptz not null default now(),
  constraint admin_scoped_access_invites_email_normalized check (
    target_email = lower(trim(target_email))
    and target_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  ),
  constraint admin_scoped_access_invites_reason_present check (
    length(trim(grant_reason)) > 0
  ),
  constraint admin_scoped_access_invites_valid_window check (
    expires_at > created_at
  ),
  constraint admin_scoped_access_invites_activation_shape check (
    (status = 'activated' and activated_user_id is not null and activated_at is not null)
    or (status <> 'activated' and activated_user_id is null and activated_grant_id is null and activated_at is null)
  ),
  constraint admin_scoped_access_invites_revocation_shape check (
    (status = 'revoked' and revoked_at is not null and length(trim(coalesce(revoke_reason, ''))) > 0)
    or (status <> 'revoked' and revoked_by is null and revoked_at is null and revoke_reason is null)
  )
);

create unique index admin_scoped_access_invites_one_pending_email_idx
  on public.admin_scoped_access_invites (target_email)
  where status = 'pending';

create index admin_scoped_access_invites_status_expiry_idx
  on public.admin_scoped_access_invites (status, expires_at);

create index admin_scoped_access_invites_created_by_idx
  on public.admin_scoped_access_invites (created_by)
  where created_by is not null;

create index admin_scoped_access_invites_activated_user_idx
  on public.admin_scoped_access_invites (activated_user_id)
  where activated_user_id is not null;

create table public.admin_scoped_access_invite_scopes (
  id uuid primary key default gen_random_uuid(),
  invite_id uuid not null references public.admin_scoped_access_invites (id) on delete cascade,
  machine_id uuid not null references public.reporting_machines (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (invite_id, machine_id)
);

create index admin_scoped_access_invite_scopes_invite_idx
  on public.admin_scoped_access_invite_scopes (invite_id);

create index admin_scoped_access_invite_scopes_machine_idx
  on public.admin_scoped_access_invite_scopes (machine_id);

create trigger admin_scoped_access_invites_set_updated_at
before update on public.admin_scoped_access_invites
for each row execute function public.set_updated_at();

alter table public.admin_scoped_access_invites enable row level security;
alter table public.admin_scoped_access_invite_scopes enable row level security;

revoke all on table public.admin_scoped_access_invites from public, anon, authenticated;
revoke all on table public.admin_scoped_access_invite_scopes from public, anon, authenticated;
grant select, insert, update on table public.admin_scoped_access_invites to service_role;
grant select, insert, update, delete on table public.admin_scoped_access_invite_scopes to service_role;

alter table public.admin_scoped_access_grants
  drop constraint if exists admin_scoped_access_grants_source_check;

alter table public.admin_scoped_access_grants
  add constraint admin_scoped_access_grants_source_check
    check (source in ('manual_admin_grant', 'production_bootstrap', 'access_invite'));

alter table public.access_invite_deliveries
  drop constraint if exists access_invite_deliveries_invite_type_check;

alter table public.access_invite_deliveries
  add constraint access_invite_deliveries_invite_type_check
    check (invite_type in ('corporate_partner', 'technician', 'machine_manager', 'scoped_admin'));

alter table public.access_invite_deliveries
  drop constraint if exists access_invite_deliveries_source_type_check;

alter table public.access_invite_deliveries
  add constraint access_invite_deliveries_source_type_check
    check (source_type in (
      'corporate_partner_membership',
      'technician_grant',
      'reporting_machine',
      'scoped_admin_invite'
    ));

comment on table public.admin_scoped_access_invites is
  'Pending invitation-first Scoped Admin intent. Rows grant no effective access until exact-email activation.';

comment on table public.admin_scoped_access_invite_scopes is
  'Machine scope staged for a pending Scoped Admin invite; copied to the effective grant only on activation.';

comment on column public.access_invite_deliveries.invite_type is
  'User-facing invite preset. Supports Corporate Partner, Technician, Machine Manager, and Scoped Admin signup emails.';

comment on column public.access_invite_deliveries.source_type is
  'Source behind the invite, including scoped_admin_invite for pending invitation-first admin access.';

create or replace function public.admin_expire_scoped_admin_invites()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  expired_invite public.admin_scoped_access_invites;
  expired_count integer := 0;
begin
  for expired_invite in
    update public.admin_scoped_access_invites invite_row
    set status = 'expired'
    where invite_row.status = 'pending'
      and invite_row.expires_at <= now()
    returning invite_row.*
  loop
    expired_count := expired_count + 1;

    insert into public.admin_audit_log (
      actor_user_id,
      action,
      entity_type,
      entity_id,
      before,
      after,
      meta
    )
    values (
      null,
      'admin_scoped_access_invite.expired',
      'admin_scoped_access_invite',
      expired_invite.id::text,
      jsonb_build_object('status', 'pending'),
      to_jsonb(expired_invite),
      jsonb_build_object(
        'target_email', expired_invite.target_email,
        'expires_at', expired_invite.expires_at
      )
    );
  end loop;

  return expired_count;
end;
$$;

revoke execute on function public.admin_expire_scoped_admin_invites()
from public, anon, authenticated;

create or replace function public.admin_create_scoped_admin_invite(
  p_target_email text,
  p_machine_ids uuid[],
  p_reason text,
  p_expires_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_user_id uuid := auth.uid();
  normalized_email text := lower(trim(coalesce(p_target_email, '')));
  normalized_reason text := trim(coalesce(p_reason, ''));
  desired_machine_ids uuid[];
  desired_expires_at timestamptz := coalesce(p_expires_at, now() + interval '7 days');
  existing_user_id uuid;
  invite_before public.admin_scoped_access_invites;
  invite_after public.admin_scoped_access_invites;
  previous_machine_ids uuid[] := '{}'::uuid[];
  missing_machine_count bigint;
begin
  if actor_user_id is null or not public.is_super_admin(actor_user_id) then
    raise exception 'Super Admin access required';
  end if;

  perform public.admin_expire_scoped_admin_invites();

  if normalized_email = ''
    or normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  then
    raise exception 'A valid target email is required';
  end if;

  if normalized_reason = '' then
    raise exception 'Grant reason is required';
  end if;

  if desired_expires_at <= now() then
    raise exception 'Invite expiry must be in the future';
  end if;

  if desired_expires_at > now() + interval '7 days' then
    raise exception 'Invite expiry cannot exceed seven days';
  end if;

  select coalesce(array_agg(distinct requested.machine_id order by requested.machine_id), '{}'::uuid[])
  into desired_machine_ids
  from unnest(coalesce(p_machine_ids, '{}'::uuid[])) as requested(machine_id)
  where requested.machine_id is not null;

  if coalesce(array_length(desired_machine_ids, 1), 0) = 0 then
    raise exception 'Select at least one active reporting machine';
  end if;

  select count(*)
  into missing_machine_count
  from unnest(desired_machine_ids) as requested(machine_id)
  left join public.reporting_machines machine
    on machine.id = requested.machine_id
   and machine.status = 'active'
  where machine.id is null;

  if missing_machine_count > 0 then
    raise exception 'One or more selected reporting machines are unavailable';
  end if;

  select users.id
  into existing_user_id
  from auth.users users
  where lower(trim(users.email)) = normalized_email
  limit 1;

  if existing_user_id is not null then
    raise exception 'This email already has a Bloomjoy account. Open the person workspace to grant Scoped Admin access.';
  end if;

  select invite_row.*
  into invite_before
  from public.admin_scoped_access_invites invite_row
  where invite_row.target_email = normalized_email
    and invite_row.status = 'pending'
  limit 1
  for update of invite_row;

  if invite_before.id is not null then
    select coalesce(
      array_agg(scope_row.machine_id order by scope_row.machine_id),
      '{}'::uuid[]
    )
    into previous_machine_ids
    from public.admin_scoped_access_invite_scopes scope_row
    where scope_row.invite_id = invite_before.id;
  end if;

  insert into public.admin_scoped_access_invites (
    target_email,
    status,
    grant_reason,
    created_by,
    created_at,
    expires_at
  )
  values (
    normalized_email,
    'pending',
    normalized_reason,
    actor_user_id,
    now(),
    desired_expires_at
  )
  on conflict (target_email) where status = 'pending'
  do update set
    grant_reason = excluded.grant_reason,
    created_by = excluded.created_by,
    created_at = excluded.created_at,
    expires_at = excluded.expires_at
  returning * into invite_after;

  delete from public.admin_scoped_access_invite_scopes
  where invite_id = invite_after.id;

  insert into public.admin_scoped_access_invite_scopes (invite_id, machine_id)
  select invite_after.id, machine_id
  from unnest(desired_machine_ids) as selected(machine_id);

  insert into public.admin_audit_log (
    actor_user_id,
    action,
    entity_type,
    entity_id,
    before,
    after,
    meta
  )
  values (
    actor_user_id,
    case
      when invite_before.id is null then 'admin_scoped_access_invite.created'
      else 'admin_scoped_access_invite.updated'
    end,
    'admin_scoped_access_invite',
    invite_after.id::text,
    case
      when invite_before.id is null then '{}'::jsonb
      else to_jsonb(invite_before) || jsonb_build_object('machine_ids', previous_machine_ids)
    end,
    to_jsonb(invite_after) || jsonb_build_object('machine_ids', desired_machine_ids),
    jsonb_build_object(
      'reason', normalized_reason,
      'target_email', normalized_email,
      'machine_ids', desired_machine_ids,
      'expires_at', invite_after.expires_at
    )
  );

  return jsonb_build_object(
    'inviteId', invite_after.id,
    'targetEmail', invite_after.target_email,
    'status', invite_after.status,
    'grantReason', invite_after.grant_reason,
    'createdAt', invite_after.created_at,
    'expiresAt', invite_after.expires_at,
    'machineIds', desired_machine_ids
  );
end;
$$;

revoke execute on function public.admin_create_scoped_admin_invite(text, uuid[], text, timestamptz)
from public, anon;
grant execute on function public.admin_create_scoped_admin_invite(text, uuid[], text, timestamptz)
to authenticated;

create or replace function public.admin_list_scoped_admin_invites()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_user_id uuid := auth.uid();
  result jsonb;
begin
  if actor_user_id is null or not public.is_super_admin(actor_user_id) then
    raise exception 'Super Admin access required';
  end if;

  perform public.admin_expire_scoped_admin_invites();

  select coalesce(jsonb_agg(invite_payload order by created_at desc), '[]'::jsonb)
  into result
  from (
    select
      invite_row.created_at,
      jsonb_build_object(
        'id', invite_row.id,
        'targetEmail', invite_row.target_email,
        'status', invite_row.status,
        'grantReason', invite_row.grant_reason,
        'createdBy', invite_row.created_by,
        'createdAt', invite_row.created_at,
        'expiresAt', invite_row.expires_at,
        'activatedUserId', invite_row.activated_user_id,
        'activatedGrantId', invite_row.activated_grant_id,
        'activatedAt', invite_row.activated_at,
        'revokedBy', invite_row.revoked_by,
        'revokedAt', invite_row.revoked_at,
        'revokeReason', invite_row.revoke_reason,
        'machineIds', coalesce(scope_data.machine_ids, '[]'::jsonb),
        'machineLabels', coalesce(scope_data.machine_labels, '[]'::jsonb)
      ) as invite_payload
    from public.admin_scoped_access_invites invite_row
    left join lateral (
      select
        jsonb_agg(scope_row.machine_id order by machine.machine_label, scope_row.machine_id) as machine_ids,
        jsonb_agg(
          coalesce(nullif(trim(machine.machine_label), ''), 'Bloomjoy machine')
          order by machine.machine_label, scope_row.machine_id
        ) as machine_labels
      from public.admin_scoped_access_invite_scopes scope_row
      join public.reporting_machines machine on machine.id = scope_row.machine_id
      where scope_row.invite_id = invite_row.id
    ) scope_data on true
    order by invite_row.created_at desc
    limit 100
  ) recent_invites;

  return result;
end;
$$;

revoke execute on function public.admin_list_scoped_admin_invites()
from public, anon;
grant execute on function public.admin_list_scoped_admin_invites()
to authenticated;

create or replace function public.admin_revoke_scoped_admin_invite(
  p_invite_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_user_id uuid := auth.uid();
  normalized_reason text := trim(coalesce(p_reason, ''));
  invite_before public.admin_scoped_access_invites;
  invite_after public.admin_scoped_access_invites;
begin
  if actor_user_id is null or not public.is_super_admin(actor_user_id) then
    raise exception 'Super Admin access required';
  end if;

  if normalized_reason = '' then
    raise exception 'Revoke reason is required';
  end if;

  perform public.admin_expire_scoped_admin_invites();

  select *
  into invite_before
  from public.admin_scoped_access_invites invite_row
  where invite_row.id = p_invite_id
  limit 1
  for update;

  if invite_before.id is null then
    raise exception 'Scoped Admin invite was not found';
  end if;

  if invite_before.status <> 'pending' then
    raise exception 'Only a pending Scoped Admin invite can be revoked';
  end if;

  update public.admin_scoped_access_invites
  set
    status = 'revoked',
    revoked_by = actor_user_id,
    revoked_at = now(),
    revoke_reason = normalized_reason
  where id = invite_before.id
  returning * into invite_after;

  insert into public.admin_audit_log (
    actor_user_id,
    action,
    entity_type,
    entity_id,
    before,
    after,
    meta
  )
  values (
    actor_user_id,
    'admin_scoped_access_invite.revoked',
    'admin_scoped_access_invite',
    invite_after.id::text,
    to_jsonb(invite_before),
    to_jsonb(invite_after),
    jsonb_build_object(
      'reason', normalized_reason,
      'target_email', invite_after.target_email
    )
  );

  return jsonb_build_object(
    'inviteId', invite_after.id,
    'status', invite_after.status,
    'revokedAt', invite_after.revoked_at
  );
end;
$$;

revoke execute on function public.admin_revoke_scoped_admin_invite(uuid, text)
from public, anon;
grant execute on function public.admin_revoke_scoped_admin_invite(uuid, text)
to authenticated;

create or replace function public.resolve_my_scoped_admin_invites(
  p_reason text default 'Scoped Admin invite accepted'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  current_user_email text;
  email_confirmed_at timestamptz;
  normalized_email text;
  normalized_reason constant text := 'Scoped Admin invite accepted';
  invite_before public.admin_scoped_access_invites;
  invite_after public.admin_scoped_access_invites;
  grant_before public.admin_scoped_access_grants;
  grant_after public.admin_scoped_access_grants;
  desired_machine_ids uuid[];
  staged_machine_count bigint;
  existing_scope public.admin_scoped_access_scopes;
  desired_machine_id uuid;
  added_count integer := 0;
  revoked_count integer := 0;
  resolved_count integer := 0;
begin
  if current_user_id is null then
    raise exception 'Authentication required';
  end if;

  select auth_user.email, auth_user.email_confirmed_at
  into current_user_email, email_confirmed_at
  from auth.users auth_user
  where auth_user.id = current_user_id
  limit 1;

  normalized_email := lower(trim(coalesce(current_user_email, '')));

  if normalized_email = '' or email_confirmed_at is null then
    return jsonb_build_object(
      'targetEmail', null,
      'resolvedInviteCount', 0,
      'grantId', null,
      'machineCount', 0
    );
  end if;

  perform public.admin_expire_scoped_admin_invites();

  select *
  into invite_before
  from public.admin_scoped_access_invites invite_row
  where invite_row.target_email = normalized_email
    and invite_row.status = 'pending'
    and invite_row.expires_at > now()
  limit 1
  for update;

  if invite_before.id is null then
    return jsonb_build_object(
      'targetEmail', normalized_email,
      'resolvedInviteCount', 0,
      'grantId', null,
      'machineCount', 0
    );
  end if;

  if public.is_super_admin(current_user_id) then
    update public.admin_scoped_access_invites
    set
      status = 'activated',
      activated_user_id = current_user_id,
      activated_at = now()
    where id = invite_before.id
    returning * into invite_after;

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
      'admin_scoped_access_invite.superseded',
      'admin_scoped_access_invite',
      invite_after.id::text,
      current_user_id,
      to_jsonb(invite_before),
      to_jsonb(invite_after),
      jsonb_build_object(
        'reason', 'Target user already has Super Admin access',
        'target_email', normalized_email
      )
    );

    return jsonb_build_object(
      'targetEmail', normalized_email,
      'resolvedInviteCount', 1,
      'grantId', null,
      'machineCount', 0,
      'supersededBySuperAdmin', true
    );
  end if;

  -- Invite creation rejects an email that already belongs to an Auth user, so
  -- any Scoped Admin grant found for this user was created after the pending
  -- invite. Preserve that newer existing-person decision (including a revoke)
  -- instead of letting an older invite silently replace or re-enable it.
  select *
  into grant_before
  from public.admin_scoped_access_grants grant_row
  where grant_row.user_id = current_user_id
    and grant_row.role = 'scoped_admin'
  order by grant_row.revoked_at is null desc, grant_row.updated_at desc
  limit 1
  for update;

  if grant_before.id is not null then
    update public.admin_scoped_access_invites
    set
      status = 'revoked',
      revoked_by = coalesce(
        grant_before.revoked_by,
        grant_before.granted_by,
        invite_before.created_by
      ),
      revoked_at = now(),
      revoke_reason = 'Superseded by a newer existing-person Scoped Admin decision'
    where id = invite_before.id
      and status = 'pending'
    returning * into invite_after;

    if invite_after.id is null then
      raise exception 'Scoped Admin invite was already resolved';
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
      'admin_scoped_access_invite.superseded',
      'admin_scoped_access_invite',
      invite_after.id::text,
      current_user_id,
      to_jsonb(invite_before),
      to_jsonb(invite_after),
      jsonb_build_object(
        'reason', invite_after.revoke_reason,
        'target_email', normalized_email,
        'superseding_grant_id', grant_before.id,
        'superseding_grant_active', (
          grant_before.revoked_at is null
          and grant_before.starts_at <= now()
          and (grant_before.expires_at is null or grant_before.expires_at > now())
        )
      )
    );

    return jsonb_build_object(
      'targetEmail', normalized_email,
      'resolvedInviteCount', 1,
      'grantId', null,
      'machineCount', 0,
      'supersededByExistingGrant', true
    );
  end if;

  select count(*)
  into staged_machine_count
  from public.admin_scoped_access_invite_scopes scope_row
  where scope_row.invite_id = invite_before.id;

  select coalesce(array_agg(scope_row.machine_id order by scope_row.machine_id), '{}'::uuid[])
  into desired_machine_ids
  from public.admin_scoped_access_invite_scopes scope_row
  join public.reporting_machines machine
    on machine.id = scope_row.machine_id
   and machine.status = 'active'
  where scope_row.invite_id = invite_before.id;

  if coalesce(array_length(desired_machine_ids, 1), 0) = 0 then
    raise exception 'Scoped Admin invite no longer has an active machine scope';
  end if;

  if coalesce(array_length(desired_machine_ids, 1), 0) <> staged_machine_count then
    raise exception 'One or more Scoped Admin invite machines are no longer active';
  end if;

  insert into public.admin_scoped_access_grants (
    user_id,
    source,
    grant_reason,
    granted_by
  )
  values (
    current_user_id,
    'access_invite',
    invite_before.grant_reason,
    invite_before.created_by
  )
  returning * into grant_after;

  for existing_scope in
    select *
    from public.admin_scoped_access_scopes scope_row
    where scope_row.grant_id = grant_after.id
      and scope_row.revoked_at is null
    for update
  loop
    if existing_scope.scope_type <> 'machine'
      or not (existing_scope.machine_id = any(desired_machine_ids))
    then
      update public.admin_scoped_access_scopes
      set
        revoked_by = invite_before.created_by,
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
        invite_before.grant_reason,
        invite_before.created_by
      );

      added_count := added_count + 1;
    end if;
  end loop;

  update public.admin_scoped_access_invites
  set
    status = 'activated',
    activated_user_id = current_user_id,
    activated_grant_id = grant_after.id,
    activated_at = now()
  where id = invite_before.id
    and status = 'pending'
  returning * into invite_after;

  if invite_after.id is null then
    raise exception 'Scoped Admin invite was already resolved';
  end if;

  resolved_count := 1;

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
  values
  (
    current_user_id,
    case when grant_before.id is null then 'admin_scoped_access.granted' else 'admin_scoped_access.updated' end,
    'admin_scoped_access_grant',
    grant_after.id::text,
    current_user_id,
    coalesce(to_jsonb(grant_before), '{}'::jsonb),
    to_jsonb(grant_after),
    jsonb_build_object(
      'reason', normalized_reason,
      'target_email', normalized_email,
      'source', 'access_invite',
      'invite_id', invite_after.id,
      'machine_ids', desired_machine_ids,
      'added_count', added_count,
      'revoked_count', revoked_count
    )
  ),
  (
    current_user_id,
    'admin_scoped_access_invite.activated',
    'admin_scoped_access_invite',
    invite_after.id::text,
    current_user_id,
    to_jsonb(invite_before),
    to_jsonb(invite_after),
    jsonb_build_object(
      'reason', normalized_reason,
      'target_email', normalized_email,
      'grant_id', grant_after.id,
      'machine_ids', desired_machine_ids
    )
  );

  return jsonb_build_object(
    'targetEmail', normalized_email,
    'resolvedInviteCount', resolved_count,
    'grantId', grant_after.id,
    'machineCount', coalesce(array_length(desired_machine_ids, 1), 0),
    'addedCount', added_count,
    'revokedCount', revoked_count
  );
end;
$$;

revoke execute on function public.resolve_my_scoped_admin_invites(text)
from public, anon;
grant execute on function public.resolve_my_scoped_admin_invites(text)
to authenticated;

select pg_notify('pgrst', 'reload schema');
