-- #782: let only the preapproved owner-operator open a short enrollment
-- window for their own refund-specific TOTP factor.
--
-- This does not change the hard-false official-action gate and does not expose
-- a target parameter or a service/admin setter. The identity binding is the
-- one-way digest of a private, immutable, high-entropy Auth user UUID. It can
-- be rotated only by another reviewed migration and is not derived from an
-- email address or other guessable identifier.

alter table public.refund_manager_security_config
  add column if not exists totp_enrollment_owner_user_id_digest text;

update public.refund_manager_security_config
set totp_enrollment_owner_user_id_digest =
  'bf3a4d8b10cbfb0cc3371fa4f891d9f8fc77ce28da5d8bca13c7703f5d8d4a6a'
where singleton = true
  and totp_enrollment_owner_user_id_digest is null;

alter table public.refund_manager_security_config
  alter column totp_enrollment_owner_user_id_digest set not null;

alter table public.refund_manager_security_config
  drop constraint if exists refund_manager_security_config_owner_digest_valid;
alter table public.refund_manager_security_config
  add constraint refund_manager_security_config_owner_digest_valid check (
    totp_enrollment_owner_user_id_digest ~ '^[a-f0-9]{64}$'
  );

alter table public.refund_manager_step_up_audit
  drop constraint if exists refund_manager_step_up_audit_event_type_check;
alter table public.refund_manager_step_up_audit
  add constraint refund_manager_step_up_audit_event_type_check check (
    event_type in (
      'intent_created',
      'intent_cancelled',
      'intent_consumed',
      'totp_enrollment_window_opened',
      'totp_enrollment_window_expired',
      'totp_enrollment_window_cancelled',
      'totp_enrollment_verified',
      'totp_enrollment_compensated'
    )
  );

create or replace function public.refund_totp_enrollment_owner_is_user(
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, auth, extensions
as $$
  select p_user_id is not null
    and exists (
      select 1
      from public.admin_roles owner_role
      where owner_role.user_id = p_user_id
        and owner_role.role = 'super_admin'
        and owner_role.active = true
    )
    and public.user_is_active_refund_manager(p_user_id)
    and exists (
      select 1
      from auth.users owner_user
      join public.refund_manager_security_config config
        on config.singleton = true
      where owner_user.id = p_user_id
        and owner_user.email_confirmed_at is not null
        and encode(
          extensions.digest(
            convert_to(owner_user.id::text, 'UTF8'),
            'sha256'
          ),
          'hex'
        ) = config.totp_enrollment_owner_user_id_digest
    );
$$;

create or replace function public.refund_totp_enrollment_owner_is_current_user()
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select auth.role() = 'authenticated'
    and auth.uid() is not null
    and public.refund_totp_enrollment_owner_is_user(auth.uid());
$$;

-- Replaces the generic manager-only enrollment check from the step-up
-- migration. The exact owner predicate is deliberately evaluated after the
-- singleton lock so a role, mapping, confirmation, or identity-binding change
-- invalidates an already-open window before Auth enrollment can start or be
-- verified.
create or replace function public.can_enroll_refund_manager_totp_current_user()
returns boolean
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  current_actor_user_id uuid := auth.uid();
  config public.refund_manager_security_config%rowtype;
begin
  if auth.role() is distinct from 'authenticated'
    or current_actor_user_id is null then
    return false;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('refund-totp-enrollment-owner-window', 782)
  );

  select existing.*
  into strict config
  from public.refund_manager_security_config existing
  where existing.singleton = true
  for update;

  return config.totp_enrollment_enabled
    and config.totp_enrollment_approved_manager_user_id = current_actor_user_id
    and config.totp_enrollment_approved_by_owner_user_id = current_actor_user_id
    and config.totp_enrollment_approval_expires_at > statement_timestamp()
    and coalesce(public.refund_totp_enrollment_owner_is_user(current_actor_user_id), false);
exception
  when no_data_found then
    return false;
end;
$$;

create or replace function public.get_refund_manager_totp_enrollment_readiness_current_user()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  current_actor_user_id uuid := auth.uid();
  eligible boolean := false;
  enrolled boolean := false;
  window_open boolean := false;
  window_expires_at timestamptz := null;
begin
  eligible := public.refund_totp_enrollment_owner_is_current_user();
  if not eligible then
    return jsonb_build_object(
      'eligible', false,
      'enrolled', false,
      'windowOpen', false,
      'windowExpiresAt', null
    );
  end if;

  select exists (
    select 1
    from public.refund_manager_totp_enrollments enrollment
    where enrollment.actor_user_id = current_actor_user_id
      and enrollment.status = 'active'
      and enrollment.revoked_at is null
  ) into enrolled;

  select
    config.totp_enrollment_enabled
      and config.totp_enrollment_approved_manager_user_id = current_actor_user_id
      and config.totp_enrollment_approved_by_owner_user_id = current_actor_user_id
      and config.totp_enrollment_approval_expires_at > statement_timestamp(),
    case
      when config.totp_enrollment_enabled
        and config.totp_enrollment_approved_manager_user_id = current_actor_user_id
        and config.totp_enrollment_approved_by_owner_user_id = current_actor_user_id
        and config.totp_enrollment_approval_expires_at > statement_timestamp()
      then config.totp_enrollment_approval_expires_at
      else null
    end
  into window_open, window_expires_at
  from public.refund_manager_security_config config
  where config.singleton = true;

  return jsonb_build_object(
    'eligible', true,
    'enrolled', enrolled,
    'windowOpen', coalesce(window_open, false),
    'windowExpiresAt', window_expires_at
  );
end;
$$;

create or replace function public.open_refund_manager_totp_enrollment_window_current_user()
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  current_actor_user_id uuid := auth.uid();
  config public.refund_manager_security_config%rowtype;
  opened_at timestamptz := statement_timestamp();
  expires_at timestamptz;
begin
  if auth.role() is distinct from 'authenticated'
    or current_actor_user_id is null then
    raise exception 'Refund authenticator enrollment is not available for this account';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('refund-totp-enrollment-owner-window', 782));

  select existing.*
  into strict config
  from public.refund_manager_security_config existing
  where existing.singleton = true
  for update;

  if public.refund_totp_enrollment_owner_is_user(current_actor_user_id) is distinct from true then
    raise exception 'Refund authenticator enrollment is not available for this account';
  end if;

  if exists (
    select 1
    from public.refund_manager_totp_enrollments enrollment
    where enrollment.actor_user_id = current_actor_user_id
      and enrollment.status = 'active'
      and enrollment.revoked_at is null
  ) then
    return jsonb_build_object(
      'opened', false,
      'status', 'already_enrolled',
      'windowOpen', false,
      'windowExpiresAt', null
    );
  end if;

  if config.totp_enrollment_enabled
    and config.totp_enrollment_approval_expires_at > opened_at then
    if config.totp_enrollment_approved_manager_user_id is distinct from current_actor_user_id
      or config.totp_enrollment_approved_by_owner_user_id is distinct from current_actor_user_id then
      raise exception 'Another owner-controlled enrollment window is already active';
    end if;

    return jsonb_build_object(
      'opened', false,
      'status', 'already_open',
      'windowOpen', true,
      'windowExpiresAt', config.totp_enrollment_approval_expires_at
    );
  end if;

  if config.totp_enrollment_enabled
    and config.totp_enrollment_approval_expires_at <= opened_at
    and config.totp_enrollment_approved_manager_user_id is not null then
    insert into public.refund_manager_step_up_audit (
      actor_user_id,
      event_type
    ) values (
      config.totp_enrollment_approved_manager_user_id,
      'totp_enrollment_window_expired'
    );
  end if;

  expires_at := opened_at + interval '5 minutes';

  update public.refund_manager_security_config
  set
    totp_enrollment_enabled = true,
    totp_enrollment_approved_manager_user_id = current_actor_user_id,
    totp_enrollment_approved_by_owner_user_id = current_actor_user_id,
    totp_enrollment_approval_expires_at = expires_at,
    totp_enrollment_approval_version = config.totp_enrollment_approval_version + 1,
    updated_at = opened_at
  where singleton = true;

  insert into public.refund_manager_step_up_audit (
    actor_user_id,
    event_type
  ) values (
    current_actor_user_id,
    'totp_enrollment_window_opened'
  );

  return jsonb_build_object(
    'opened', true,
    'status', 'opened',
    'windowOpen', true,
    'windowExpiresAt', expires_at
  );
end;
$$;

create or replace function public.close_refund_manager_totp_enrollment_window_current_user()
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  current_actor_user_id uuid := auth.uid();
  config public.refund_manager_security_config%rowtype;
begin
  if auth.role() is distinct from 'authenticated'
    or current_actor_user_id is null then
    raise exception 'Refund authenticator enrollment is not available for this account';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('refund-totp-enrollment-owner-window', 782));

  select existing.*
  into strict config
  from public.refund_manager_security_config existing
  where existing.singleton = true
  for update;

  if not config.totp_enrollment_enabled
    or config.totp_enrollment_approved_manager_user_id is distinct from current_actor_user_id
    or config.totp_enrollment_approved_by_owner_user_id is distinct from current_actor_user_id then
    return jsonb_build_object('closed', false, 'status', 'already_closed');
  end if;

  update public.refund_manager_security_config
  set
    totp_enrollment_enabled = false,
    totp_enrollment_approved_manager_user_id = null,
    totp_enrollment_approved_by_owner_user_id = null,
    totp_enrollment_approval_expires_at = null,
    updated_at = statement_timestamp()
  where singleton = true;

  insert into public.refund_manager_step_up_audit (
    actor_user_id,
    event_type
  ) values (
    current_actor_user_id,
    'totp_enrollment_window_cancelled'
  );

  return jsonb_build_object('closed', true, 'status', 'closed');
end;
$$;

-- Revalidate the exact owner after both enrollment locks and immediately
-- before durable consumption. A window opened before an owner-role,
-- manager-mapping, email-confirmation, or immutable identity-binding change
-- cannot be converted into an active refund factor.
create or replace function public.service_record_refund_manager_totp_enrollment(
  p_actor_user_id uuid,
  p_factor_binding_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  enrollment_config public.refund_manager_security_config%rowtype;
  manager_totp_enrollment public.refund_manager_totp_enrollments%rowtype;
begin
  if auth.role() is distinct from 'service_role'
    or p_actor_user_id is null
    or not coalesce(p_factor_binding_hash ~ '^[a-f0-9]{64}$', false) then
    raise exception 'Supervised Machine Manager authenticator enrollment is not authorized';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('refund-totp-enrollment-owner-window', 782)
  );
  perform pg_advisory_xact_lock(hashtextextended(p_actor_user_id::text, 692));

  select config.*
  into enrollment_config
  from public.refund_manager_security_config config
  where config.singleton = true
  for update;

  if not found
    or enrollment_config.totp_enrollment_enabled is distinct from true
    or enrollment_config.totp_enrollment_approved_manager_user_id is distinct from p_actor_user_id
    or enrollment_config.totp_enrollment_approved_by_owner_user_id is distinct from p_actor_user_id
    or enrollment_config.totp_enrollment_approval_expires_at <= statement_timestamp()
    or enrollment_config.totp_enrollment_approval_version <= 0
    or public.refund_totp_enrollment_owner_is_user(p_actor_user_id) is distinct from true then
    raise exception 'Supervised Machine Manager authenticator enrollment is not authorized';
  end if;

  insert into public.refund_manager_totp_enrollments as existing_enrollment (
    actor_user_id,
    approved_factor_binding_hash,
    owner_approved_by_user_id,
    owner_approval_version,
    enrollment_version,
    status,
    approved_at,
    last_step_up_verified_at,
    revoked_at,
    updated_at
  ) values (
    p_actor_user_id,
    p_factor_binding_hash,
    enrollment_config.totp_enrollment_approved_by_owner_user_id,
    enrollment_config.totp_enrollment_approval_version,
    1,
    'active',
    statement_timestamp(),
    null,
    null,
    statement_timestamp()
  )
  on conflict (actor_user_id) do update
  set
    approved_factor_binding_hash = excluded.approved_factor_binding_hash,
    owner_approved_by_user_id = excluded.owner_approved_by_user_id,
    owner_approval_version = excluded.owner_approval_version,
    enrollment_version = existing_enrollment.enrollment_version + 1,
    status = 'active',
    approved_at = statement_timestamp(),
    last_step_up_verified_at = null,
    revoked_at = null,
    updated_at = statement_timestamp()
  returning * into manager_totp_enrollment;

  insert into public.refund_manager_step_up_audit (
    actor_user_id,
    event_type,
    verified_totp_at
  ) values (
    p_actor_user_id,
    'totp_enrollment_verified',
    statement_timestamp()
  );

  update public.refund_manager_security_config
  set
    totp_enrollment_enabled = false,
    totp_enrollment_approved_manager_user_id = null,
    totp_enrollment_approved_by_owner_user_id = null,
    totp_enrollment_approval_expires_at = null,
    updated_at = statement_timestamp()
  where singleton = true;

  return jsonb_build_object(
    'recorded', true,
    'enrollmentVersion', manager_totp_enrollment.enrollment_version
  );
end;
$$;

revoke execute on function public.refund_totp_enrollment_owner_is_user(uuid)
  from public, anon, authenticated, service_role;

revoke execute on function public.refund_totp_enrollment_owner_is_current_user()
  from public, anon, authenticated, service_role;

revoke execute on function public.get_refund_manager_totp_enrollment_readiness_current_user()
  from public, anon, authenticated, service_role;
grant execute on function public.get_refund_manager_totp_enrollment_readiness_current_user()
  to authenticated;

revoke execute on function public.open_refund_manager_totp_enrollment_window_current_user()
  from public, anon, authenticated, service_role;
grant execute on function public.open_refund_manager_totp_enrollment_window_current_user()
  to authenticated;

revoke execute on function public.close_refund_manager_totp_enrollment_window_current_user()
  from public, anon, authenticated, service_role;
grant execute on function public.close_refund_manager_totp_enrollment_window_current_user()
  to authenticated;

comment on column public.refund_manager_security_config.totp_enrollment_owner_user_id_digest is
  'SHA-256 binding of the private immutable Auth user UUID for the single preapproved owner-operator; never derived from email. Rotation requires a reviewed forward-only migration.';
comment on function public.open_refund_manager_totp_enrollment_window_current_user() is
  'Self-only, preapproved owner-operator control. Opens at most one non-extendable five-minute refund TOTP enrollment window; never enables official actions.';
comment on function public.close_refund_manager_totp_enrollment_window_current_user() is
  'Self-only close control for the preapproved owner-operator enrollment window.';
