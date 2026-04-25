-- Partner/operator account access and invite flow for training UAT.

create table if not exists public.customer_accounts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  operator_seat_limit integer not null default 50 check (operator_seat_limit >= 0),
  created_by_user_id uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.customer_account_memberships (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.customer_accounts (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  email text not null,
  role text not null check (role in ('partner', 'operator')),
  invited_by_user_id uuid references auth.users (id) on delete set null,
  joined_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by_user_id uuid references auth.users (id) on delete set null,
  revoke_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.customer_account_invites (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.customer_accounts (id) on delete cascade,
  email text not null,
  role text not null check (role in ('partner', 'operator')),
  invited_by_user_id uuid references auth.users (id) on delete set null,
  accepted_by_user_id uuid references auth.users (id) on delete set null,
  accepted_at timestamptz,
  revoked_at timestamptz,
  revoked_by_user_id uuid references auth.users (id) on delete set null,
  revoke_reason text,
  last_sent_at timestamptz,
  last_send_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists customer_account_memberships_account_role_idx
  on public.customer_account_memberships (account_id, role)
  where revoked_at is null;

create index if not exists customer_account_memberships_user_id_idx
  on public.customer_account_memberships (user_id);

create unique index if not exists customer_account_memberships_active_user_idx
  on public.customer_account_memberships (user_id)
  where revoked_at is null;

create index if not exists customer_account_memberships_active_email_idx
  on public.customer_account_memberships (lower(email))
  where revoked_at is null;

create index if not exists customer_account_invites_account_role_idx
  on public.customer_account_invites (account_id, role)
  where accepted_at is null and revoked_at is null;

create unique index if not exists customer_account_invites_pending_email_idx
  on public.customer_account_invites (lower(email))
  where accepted_at is null and revoked_at is null;

drop trigger if exists customer_accounts_set_updated_at on public.customer_accounts;
create trigger customer_accounts_set_updated_at
before update on public.customer_accounts
for each row execute function public.set_updated_at();

drop trigger if exists customer_account_memberships_set_updated_at on public.customer_account_memberships;
create trigger customer_account_memberships_set_updated_at
before update on public.customer_account_memberships
for each row execute function public.set_updated_at();

drop trigger if exists customer_account_invites_set_updated_at on public.customer_account_invites;
create trigger customer_account_invites_set_updated_at
before update on public.customer_account_invites
for each row execute function public.set_updated_at();

create or replace function public.normalize_account_email(email_input text)
returns text
language sql
immutable
as $$
  select lower(trim(coalesce(email_input, '')));
$$;

create or replace function public.has_active_customer_account_membership(
  p_user_id uuid,
  p_account_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.customer_account_memberships cam
    where cam.user_id = p_user_id
      and cam.account_id = p_account_id
      and cam.revoked_at is null
  );
$$;

create or replace function public.is_partner_on_customer_account(
  p_user_id uuid,
  p_account_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.customer_account_memberships cam
    where cam.user_id = p_user_id
      and cam.account_id = p_account_id
      and cam.role = 'partner'
      and cam.revoked_at is null
  );
$$;

create or replace function public.get_active_customer_account_id(p_user_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select cam.account_id
  from public.customer_account_memberships cam
  where cam.user_id = p_user_id
    and cam.revoked_at is null
  order by case when cam.role = 'partner' then 0 else 1 end, cam.created_at asc
  limit 1;
$$;

create or replace function public.get_active_customer_account_role(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select cam.role
  from public.customer_account_memberships cam
  where cam.user_id = p_user_id
    and cam.revoked_at is null
  order by case when cam.role = 'partner' then 0 else 1 end, cam.created_at asc
  limit 1;
$$;

create or replace function public.get_portal_access_tier_for_user(p_user_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  active_role text;
  has_active_plus boolean := false;
begin
  if p_user_id is null then
    return 'baseline';
  end if;

  if public.is_super_admin(p_user_id) then
    return 'plus';
  end if;

  active_role := public.get_active_customer_account_role(p_user_id);

  select exists (
    select 1
    from public.subscriptions s
    where s.user_id = p_user_id
      and s.status in ('active', 'trialing')
      and (s.current_period_end is null or s.current_period_end > now())
  )
  into has_active_plus;

  if has_active_plus or active_role = 'partner' then
    return 'plus';
  end if;

  if active_role = 'operator' then
    return 'training';
  end if;

  return 'baseline';
end;
$$;

create or replace function public.can_manage_customer_account_operators_for_user(p_user_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_user_id is null then
    return false;
  end if;

  return public.is_super_admin(p_user_id)
    or public.get_active_customer_account_role(p_user_id) = 'partner';
end;
$$;

create or replace function public.get_portal_access_context_for_user(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  active_account_id uuid;
  active_account_role text;
  is_admin_user boolean := false;
  access_tier text := 'baseline';
begin
  if p_user_id is null then
    return jsonb_build_object(
      'account_id', null,
      'account_role', null,
      'access_tier', 'baseline',
      'can_manage_operators', false,
      'is_admin', false
    );
  end if;

  is_admin_user := public.is_super_admin(p_user_id);
  active_account_id := public.get_active_customer_account_id(p_user_id);
  active_account_role := public.get_active_customer_account_role(p_user_id);
  access_tier := public.get_portal_access_tier_for_user(p_user_id);

  return jsonb_build_object(
    'account_id', active_account_id,
    'account_role', active_account_role,
    'access_tier', access_tier,
    'can_manage_operators', public.can_manage_customer_account_operators_for_user(p_user_id),
    'is_admin', is_admin_user
  );
end;
$$;

create or replace function public.get_portal_access_context()
returns jsonb
language sql
stable
security definer
set search_path = public, auth
as $$
  select public.get_portal_access_context_for_user(auth.uid());
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

create or replace function public.can_access_plus_portal_for_user(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.get_portal_access_tier_for_user(p_user_id) = 'plus';
$$;

grant execute on function public.has_active_customer_account_membership(uuid, uuid) to authenticated, service_role;
grant execute on function public.is_partner_on_customer_account(uuid, uuid) to authenticated, service_role;
grant execute on function public.get_active_customer_account_id(uuid) to authenticated, service_role;
grant execute on function public.get_active_customer_account_role(uuid) to authenticated, service_role;
grant execute on function public.get_portal_access_tier_for_user(uuid) to authenticated, service_role;
grant execute on function public.can_manage_customer_account_operators_for_user(uuid) to authenticated, service_role;
grant execute on function public.get_portal_access_context_for_user(uuid) to authenticated, service_role;
grant execute on function public.get_portal_access_context() to authenticated, service_role;
grant execute on function public.can_access_plus_portal() to authenticated, service_role;
grant execute on function public.can_access_plus_portal_for_user(uuid) to authenticated, service_role;
grant execute on function public.can_access_members_only_training() to authenticated, service_role;

alter table public.customer_accounts enable row level security;
alter table public.customer_account_memberships enable row level security;
alter table public.customer_account_invites enable row level security;

drop policy if exists "customer_accounts_select_member_or_admin" on public.customer_accounts;
drop policy if exists "customer_account_memberships_select_partner_or_self" on public.customer_account_memberships;
drop policy if exists "customer_account_invites_select_partner_or_admin" on public.customer_account_invites;

create policy "customer_accounts_select_member_or_admin"
on public.customer_accounts
for select
to authenticated
using (
  public.is_super_admin(auth.uid())
  or public.has_active_customer_account_membership(auth.uid(), id)
);

create policy "customer_account_memberships_select_partner_or_self"
on public.customer_account_memberships
for select
to authenticated
using (
  public.is_super_admin(auth.uid())
  or (auth.uid() = user_id and revoked_at is null)
  or public.is_partner_on_customer_account(auth.uid(), account_id)
);

create policy "customer_account_invites_select_partner_or_admin"
on public.customer_account_invites
for select
to authenticated
using (
  public.is_super_admin(auth.uid())
  or public.is_partner_on_customer_account(auth.uid(), account_id)
);

drop function if exists public.create_customer_account_invite_as_actor(uuid, text, text, text);
create or replace function public.create_customer_account_invite_as_actor(
  p_actor_user_id uuid,
  p_invite_email text,
  p_role text,
  p_account_name text default null
)
returns public.customer_account_invites
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  normalized_email text := public.normalize_account_email(p_invite_email);
  normalized_role text := lower(trim(coalesce(p_role, '')));
  actor_account_id uuid;
  actor_account_role text;
  actor_is_admin boolean := false;
  created_account public.customer_accounts;
  created_invite public.customer_account_invites;
  existing_user_id uuid;
  seat_limit integer;
  active_operator_count integer;
  pending_operator_count integer;
  normalized_account_name text;
begin
  if p_actor_user_id is null then
    raise exception 'Authentication required';
  end if;

  if normalized_email = '' then
    raise exception 'Invite email is required';
  end if;

  if normalized_role not in ('partner', 'operator') then
    raise exception 'Invalid invite role: %', p_role;
  end if;

  actor_is_admin := public.is_super_admin(p_actor_user_id);
  actor_account_id := public.get_active_customer_account_id(p_actor_user_id);
  actor_account_role := public.get_active_customer_account_role(p_actor_user_id);

  if normalized_role = 'partner' then
    if not actor_is_admin then
      raise exception 'Admin access required';
    end if;

    normalized_account_name := nullif(trim(coalesce(p_account_name, '')), '');

    insert into public.customer_accounts (
      name,
      operator_seat_limit,
      created_by_user_id
    )
    values (
      coalesce(normalized_account_name, split_part(normalized_email, '@', 1) || ' team'),
      50,
      p_actor_user_id
    )
    returning * into created_account;

    actor_account_id := created_account.id;
  else
    if actor_account_id is null or actor_account_role <> 'partner' then
      raise exception 'Partner access required';
    end if;

    if exists (
      select 1
      from auth.users au
      where au.id = p_actor_user_id
        and public.normalize_account_email(au.email) = normalized_email
    ) then
      raise exception 'You cannot invite your own email address';
    end if;

    select ca.operator_seat_limit
    into seat_limit
    from public.customer_accounts ca
    where ca.id = actor_account_id
    limit 1;

    select count(*)
    into active_operator_count
    from public.customer_account_memberships cam
    where cam.account_id = actor_account_id
      and cam.role = 'operator'
      and cam.revoked_at is null;

    select count(*)
    into pending_operator_count
    from public.customer_account_invites cai
    where cai.account_id = actor_account_id
      and cai.role = 'operator'
      and cai.accepted_at is null
      and cai.revoked_at is null;

    if coalesce(active_operator_count, 0) + coalesce(pending_operator_count, 0) >= coalesce(seat_limit, 50) then
      raise exception 'Operator seat limit reached (%). Revoke an operator or pending invite before adding another.', coalesce(seat_limit, 50);
    end if;
  end if;

  if exists (
    select 1
    from public.customer_account_invites cai
    where public.normalize_account_email(cai.email) = normalized_email
      and cai.accepted_at is null
      and cai.revoked_at is null
  ) then
    raise exception 'A pending invite already exists for %', normalized_email;
  end if;

  if exists (
    select 1
    from public.customer_account_memberships cam
    where public.normalize_account_email(cam.email) = normalized_email
      and cam.revoked_at is null
  ) then
    raise exception 'This email already has active customer-account access';
  end if;

  select au.id
  into existing_user_id
  from auth.users au
  where public.normalize_account_email(au.email) = normalized_email
  limit 1;

  if existing_user_id is not null and exists (
    select 1
    from public.customer_account_memberships cam
    where cam.user_id = existing_user_id
      and cam.revoked_at is null
  ) then
    raise exception 'This email already has active customer-account access';
  end if;

  insert into public.customer_account_invites (
    account_id,
    email,
    role,
    invited_by_user_id
  )
  values (
    actor_account_id,
    normalized_email,
    normalized_role,
    p_actor_user_id
  )
  returning * into created_invite;

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
    p_actor_user_id,
    case
      when normalized_role = 'partner' then 'customer_account.partner_invited'
      else 'customer_account.operator_invited'
    end,
    'customer_account_invite',
    created_invite.id::text,
    '{}'::jsonb,
    to_jsonb(created_invite),
    jsonb_build_object(
      'account_id', actor_account_id,
      'email', normalized_email,
      'role', normalized_role
    )
  );

  return created_invite;
end;
$$;

drop function if exists public.record_customer_account_invite_delivery_as_actor(uuid, uuid, text);
create or replace function public.record_customer_account_invite_delivery_as_actor(
  p_actor_user_id uuid,
  p_invite_id uuid,
  p_send_error text default null
)
returns public.customer_account_invites
language plpgsql
security definer
set search_path = public
as $$
declare
  invite_row public.customer_account_invites;
  actor_can_manage boolean := false;
  normalized_send_error text := nullif(trim(coalesce(p_send_error, '')), '');
begin
  if p_actor_user_id is null then
    raise exception 'Authentication required';
  end if;

  select *
  into invite_row
  from public.customer_account_invites cai
  where cai.id = p_invite_id;

  if invite_row.id is null then
    raise exception 'Invite not found';
  end if;

  if invite_row.revoked_at is not null then
    raise exception 'Invite has already been revoked';
  end if;

  if invite_row.accepted_at is not null then
    raise exception 'Invite has already been accepted';
  end if;

  actor_can_manage := public.is_super_admin(p_actor_user_id)
    or (
      invite_row.role = 'operator'
      and public.is_partner_on_customer_account(p_actor_user_id, invite_row.account_id)
    );

  if not actor_can_manage then
    raise exception 'Access denied';
  end if;

  update public.customer_account_invites
  set
    last_sent_at = now(),
    last_send_error = normalized_send_error
  where id = invite_row.id
  returning * into invite_row;

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
    p_actor_user_id,
    'customer_account.invite_delivery_recorded',
    'customer_account_invite',
    invite_row.id::text,
    '{}'::jsonb,
    to_jsonb(invite_row),
    jsonb_build_object(
      'account_id', invite_row.account_id,
      'email', invite_row.email,
      'delivery_status', case when normalized_send_error is null then 'sent' else 'failed' end,
      'send_error', normalized_send_error
    )
  );

  return invite_row;
end;
$$;

drop function if exists public.revoke_customer_account_access_as_actor(uuid, uuid, uuid, text);
create or replace function public.revoke_customer_account_access_as_actor(
  p_actor_user_id uuid,
  p_membership_id uuid default null,
  p_invite_id uuid default null,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  membership_row public.customer_account_memberships;
  invite_row public.customer_account_invites;
  actor_account_id uuid;
  actor_account_role text;
  actor_is_admin boolean := false;
  normalized_reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  if p_actor_user_id is null then
    raise exception 'Authentication required';
  end if;

  if p_membership_id is null and p_invite_id is null then
    raise exception 'Membership or invite id is required';
  end if;

  actor_is_admin := public.is_super_admin(p_actor_user_id);
  actor_account_id := public.get_active_customer_account_id(p_actor_user_id);
  actor_account_role := public.get_active_customer_account_role(p_actor_user_id);

  if p_membership_id is not null then
    select *
    into membership_row
    from public.customer_account_memberships cam
    where cam.id = p_membership_id;

    if membership_row.id is null then
      raise exception 'Membership not found';
    end if;

    if membership_row.revoked_at is not null then
      return jsonb_build_object('status', 'already_revoked', 'entity', 'membership');
    end if;

    if not actor_is_admin and not (
      membership_row.role = 'operator'
      and actor_account_id = membership_row.account_id
      and actor_account_role = 'partner'
    ) then
      raise exception 'Access denied';
    end if;

    update public.customer_account_memberships
    set
      revoked_at = now(),
      revoked_by_user_id = p_actor_user_id,
      revoke_reason = coalesce(normalized_reason, 'Access revoked')
    where id = membership_row.id
    returning * into membership_row;

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
      p_actor_user_id,
      case
        when membership_row.role = 'partner' then 'customer_account.partner_revoked'
        else 'customer_account.operator_revoked'
      end,
      'customer_account_membership',
      membership_row.id::text,
      membership_row.user_id,
      '{}'::jsonb,
      to_jsonb(membership_row),
      jsonb_build_object(
        'account_id', membership_row.account_id,
        'email', membership_row.email,
        'reason', coalesce(normalized_reason, 'Access revoked')
      )
    );

    return jsonb_build_object(
      'status', 'revoked',
      'entity', 'membership',
      'membership_id', membership_row.id,
      'account_id', membership_row.account_id
    );
  end if;

  select *
  into invite_row
  from public.customer_account_invites cai
  where cai.id = p_invite_id;

  if invite_row.id is null then
    raise exception 'Invite not found';
  end if;

  if invite_row.revoked_at is not null then
    return jsonb_build_object('status', 'already_revoked', 'entity', 'invite');
  end if;

  if invite_row.accepted_at is not null then
    raise exception 'Accepted invites must be revoked through the membership record';
  end if;

  if not actor_is_admin and not (
    actor_account_id = invite_row.account_id
    and actor_account_role = 'partner'
    and invite_row.role = 'operator'
  ) then
    raise exception 'Access denied';
  end if;

  update public.customer_account_invites
  set
    revoked_at = now(),
    revoked_by_user_id = p_actor_user_id,
    revoke_reason = coalesce(normalized_reason, 'Invite revoked')
  where id = invite_row.id
  returning * into invite_row;

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
    p_actor_user_id,
    case
      when invite_row.role = 'partner' then 'customer_account.partner_invite_revoked'
      else 'customer_account.operator_invite_revoked'
    end,
    'customer_account_invite',
    invite_row.id::text,
    '{}'::jsonb,
    to_jsonb(invite_row),
    jsonb_build_object(
      'account_id', invite_row.account_id,
      'email', invite_row.email,
      'reason', coalesce(normalized_reason, 'Invite revoked')
    )
  );

  return jsonb_build_object(
    'status', 'revoked',
    'entity', 'invite',
    'invite_id', invite_row.id,
    'account_id', invite_row.account_id
  );
end;
$$;

drop function if exists public.accept_customer_account_invite();
create or replace function public.accept_customer_account_invite()
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  current_user_id uuid := auth.uid();
  current_email text := public.normalize_account_email(coalesce(auth.jwt() ->> 'email', ''));
  invite_row public.customer_account_invites;
  existing_membership public.customer_account_memberships;
  accepted_membership public.customer_account_memberships;
begin
  if current_user_id is null then
    raise exception 'Authentication required';
  end if;

  if current_email = '' then
    select public.normalize_account_email(au.email)
    into current_email
    from auth.users au
    where au.id = current_user_id
    limit 1;
  end if;

  if current_email = '' then
    return public.get_portal_access_context();
  end if;

  select *
  into invite_row
  from public.customer_account_invites cai
  where public.normalize_account_email(cai.email) = current_email
    and cai.accepted_at is null
    and cai.revoked_at is null
  order by cai.created_at asc
  limit 1;

  if invite_row.id is null then
    return public.get_portal_access_context();
  end if;

  select *
  into existing_membership
  from public.customer_account_memberships cam
  where cam.user_id = current_user_id
    and cam.revoked_at is null
  limit 1;

  if existing_membership.id is not null then
    if existing_membership.account_id <> invite_row.account_id or existing_membership.role <> invite_row.role then
      raise exception 'This user already has active customer-account access';
    end if;

    accepted_membership := existing_membership;
  else
    insert into public.customer_account_memberships (
      account_id,
      user_id,
      email,
      role,
      invited_by_user_id,
      joined_at
    )
    values (
      invite_row.account_id,
      current_user_id,
      current_email,
      invite_row.role,
      invite_row.invited_by_user_id,
      now()
    )
    returning * into accepted_membership;
  end if;

  update public.customer_account_invites
  set
    accepted_at = coalesce(accepted_at, now()),
    accepted_by_user_id = current_user_id,
    last_send_error = null
  where id = invite_row.id
  returning * into invite_row;

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
    case
      when invite_row.role = 'partner' then 'customer_account.partner_accepted'
      else 'customer_account.operator_accepted'
    end,
    'customer_account_membership',
    accepted_membership.id::text,
    current_user_id,
    '{}'::jsonb,
    to_jsonb(accepted_membership),
    jsonb_build_object(
      'account_id', accepted_membership.account_id,
      'email', accepted_membership.email,
      'invite_id', invite_row.id
    )
  );

  return public.get_portal_access_context();
end;
$$;

grant execute on function public.create_customer_account_invite_as_actor(uuid, text, text, text) to authenticated, service_role;
grant execute on function public.record_customer_account_invite_delivery_as_actor(uuid, uuid, text) to authenticated, service_role;
grant execute on function public.revoke_customer_account_access_as_actor(uuid, uuid, uuid, text) to authenticated, service_role;
grant execute on function public.accept_customer_account_invite() to authenticated, service_role;
