-- Issue #536/#537: allow Scoped Admins to manage Technician grants only for
-- active machines inside their current scoped-admin machine set.

alter table public.technician_grants
  drop constraint if exists technician_grants_sponsor_type_check;

alter table public.technician_grants
  add constraint technician_grants_sponsor_type_check
  check (sponsor_type in ('plus_customer_account', 'corporate_partner', 'scoped_admin'));

create or replace function public.scoped_admin_can_manage_technician_machine_set(
  p_user_id uuid,
  p_machine_ids uuid[]
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with requested as (
    select distinct requested.machine_id
    from unnest(coalesce(p_machine_ids, '{}'::uuid[])) as requested(machine_id)
    where requested.machine_id is not null
  ),
  actor_scope as (
    select coalesce(public.scoped_admin_machine_ids(p_user_id), '{}'::uuid[]) as machine_ids
  )
  select p_user_id is not null
    and exists (select 1 from requested)
    and not exists (
      select 1
      from requested
      cross join actor_scope scope
      left join public.reporting_machines machine
        on machine.id = requested.machine_id
      left join public.customer_accounts account
        on account.id = machine.account_id
      where machine.id is null
        or machine.status <> 'active'
        or account.id is null
        or account.status <> 'active'
        or not requested.machine_id = any(scope.machine_ids)
    );
$$;

create or replace function public.can_manage_scoped_admin_technician_grant(
  p_user_id uuid,
  p_technician_grant_id uuid,
  p_machine_ids uuid[] default null
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  current_machine_ids uuid[];
begin
  if p_user_id is null or p_technician_grant_id is null then
    return false;
  end if;

  if not public.is_scoped_admin(p_user_id) then
    return false;
  end if;

  if not exists (
    select 1
    from public.technician_grants grant_row
    where grant_row.id = p_technician_grant_id
      and grant_row.revoked_at is null
  ) then
    return false;
  end if;

  select coalesce(array_agg(assignment.machine_id order by assignment.machine_id), '{}'::uuid[])
  into current_machine_ids
  from public.technician_machine_assignments assignment
  where assignment.technician_grant_id = p_technician_grant_id
    and public.technician_assignment_is_active(
      assignment.starts_at,
      assignment.expires_at,
      assignment.revoked_at,
      assignment.status
    );

  if not public.scoped_admin_can_manage_technician_machine_set(
    p_user_id,
    current_machine_ids
  ) then
    return false;
  end if;

  if p_machine_ids is null then
    return true;
  end if;

  return public.scoped_admin_can_manage_technician_machine_set(
    p_user_id,
    p_machine_ids
  );
end;
$$;

create or replace function public.can_manage_technician_grants_for_account(
  p_user_id uuid,
  p_account_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_user_id is not null
    and p_account_id is not null
    and (
      public.is_super_admin(p_user_id)
      or (
        public.has_plus_access(p_user_id)
        and exists (
          select 1
          from public.customer_account_memberships membership
          where membership.user_id = p_user_id
            and membership.account_id = p_account_id
            and membership.active
            and membership.role = 'owner'
        )
      )
      or p_account_id = any(public.corporate_partner_account_ids_for_user(p_user_id))
      or exists (
        select 1
        from public.reporting_machines machine
        where machine.account_id = p_account_id
          and machine.status = 'active'
          and machine.id = any(public.scoped_admin_machine_ids(p_user_id))
      )
    );
$$;

create or replace function public.can_manage_technician_grants_for_machine(
  p_user_id uuid,
  p_machine_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_user_id is not null
    and p_machine_id is not null
    and exists (
      select 1
      from public.reporting_machines machine
      where machine.id = p_machine_id
        and machine.status = 'active'
        and (
          public.is_super_admin(p_user_id)
          or (
            public.has_plus_access(p_user_id)
            and exists (
              select 1
              from public.customer_account_memberships membership
              where membership.user_id = p_user_id
                and membership.account_id = machine.account_id
                and membership.active
                and membership.role = 'owner'
            )
          )
          or machine.id = any(public.corporate_partner_machine_ids_for_user(p_user_id))
          or machine.id = any(public.scoped_admin_machine_ids(p_user_id))
        )
    );
$$;

create or replace function public.technician_actor_authority_path(
  p_actor_user_id uuid,
  p_account_id uuid
)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_actor_user_id is null or p_account_id is null then
    return null;
  end if;

  if public.is_super_admin(p_actor_user_id) then
    return 'super_admin';
  end if;

  if exists (
    select 1
    from public.customer_account_memberships membership
    where membership.user_id = p_actor_user_id
      and membership.account_id = p_account_id
      and membership.active
      and membership.role = 'owner'
      and public.has_plus_access(p_actor_user_id)
  ) then
    return 'plus_account_owner';
  end if;

  if p_account_id = any(public.corporate_partner_account_ids_for_user(p_actor_user_id)) then
    return 'corporate_partner';
  end if;

  if exists (
    select 1
    from public.reporting_machines machine
    where machine.account_id = p_account_id
      and machine.status = 'active'
      and machine.id = any(public.scoped_admin_machine_ids(p_actor_user_id))
  ) then
    return 'scoped_admin';
  end if;

  return null;
end;
$$;

create or replace function public.technician_pick_sponsor_user_id(
  p_actor_user_id uuid,
  p_account_id uuid
)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  selected_sponsor_user_id uuid;
  authority_path text;
begin
  if p_actor_user_id is null or p_account_id is null then
    return null;
  end if;

  authority_path := public.technician_actor_authority_path(p_actor_user_id, p_account_id);

  if authority_path in ('plus_account_owner', 'corporate_partner', 'scoped_admin') then
    return p_actor_user_id;
  end if;

  if authority_path <> 'super_admin' then
    return null;
  end if;

  select membership.user_id
  into selected_sponsor_user_id
  from public.customer_account_memberships membership
  where membership.account_id = p_account_id
    and membership.active
    and membership.role = 'owner'
    and public.has_plus_access(membership.user_id)
  order by membership.created_at asc, membership.id asc
  limit 1;

  return coalesce(selected_sponsor_user_id, p_actor_user_id);
end;
$$;

create or replace function public.grant_technician_access(
  p_technician_email text,
  p_machine_ids uuid[] default '{}'::uuid[],
  p_reason text default 'Technician access',
  p_account_id uuid default null,
  p_partner_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  current_user_id uuid;
  current_user_email text;
  normalized_email text;
  normalized_reason text;
  normalized_machine_ids uuid[];
  target_account_id uuid;
  target_partner_id uuid;
  target_user_id uuid;
  selected_sponsor_user_id uuid;
  sponsor_email text;
  actor_authority_path text;
  operator_grant public.operator_training_grants;
  before_grant public.technician_grants;
  after_grant public.technician_grants;
  internal_result jsonb;
  resolved_grant_id uuid;
  grant_expiry timestamptz := now() + interval '1 year';
  invalid_machine_count integer;
  account_count integer;
  action_name text;
begin
  current_user_id := auth.uid();

  if current_user_id is null then
    raise exception 'Authentication required';
  end if;

  normalized_email := public.normalize_technician_email(p_technician_email);
  normalized_reason := public.technician_assert_reason(p_reason);

  if normalized_email = '' then
    raise exception 'Technician email is required';
  end if;

  select public.normalize_technician_email(auth_user.email)
  into current_user_email
  from auth.users auth_user
  where auth_user.id = current_user_id
  limit 1;

  if current_user_email = normalized_email then
    raise exception 'Use a different email for Technician access';
  end if;

  select coalesce(array_agg(distinct requested.machine_id), '{}'::uuid[])
  into normalized_machine_ids
  from unnest(coalesce(p_machine_ids, '{}'::uuid[])) as requested(machine_id)
  where requested.machine_id is not null;

  if coalesce(array_length(normalized_machine_ids, 1), 0) > 0 then
    select count(distinct machine.account_id)::integer
    into account_count
    from public.reporting_machines machine
    where machine.id = any(normalized_machine_ids)
      and machine.status = 'active';

    if account_count = 1 then
      select machine.account_id
      into target_account_id
      from public.reporting_machines machine
      where machine.id = any(normalized_machine_ids)
        and machine.status = 'active'
      limit 1;

      actor_authority_path := public.technician_actor_authority_path(
        current_user_id,
        target_account_id
      );

      if actor_authority_path = 'corporate_partner' then
        target_partner_id := public.corporate_partner_partner_id_for_machine(
          current_user_id,
          normalized_machine_ids[1]
        );

        if target_partner_id is null then
          raise exception 'Corporate Partner machine scope is required';
        end if;

        if p_partner_id is not null and p_partner_id <> target_partner_id then
          raise exception 'Corporate Partner machine scope does not match the selected partner';
        end if;

        select count(*)::integer
        into invalid_machine_count
        from unnest(normalized_machine_ids) as requested(machine_id)
        where public.corporate_partner_partner_id_for_machine(
          current_user_id,
          requested.machine_id
        ) is distinct from target_partner_id;

        if invalid_machine_count > 0 then
          raise exception 'Select machines from one active portal-enabled Corporate Partner scope';
        end if;
      elsif actor_authority_path = 'scoped_admin'
        and not public.scoped_admin_can_manage_technician_machine_set(
          current_user_id,
          normalized_machine_ids
        ) then
        raise exception 'Scoped Admin can manage only assigned in-scope Technician machines';
      end if;
    end if;

    internal_result := public.grant_technician_access_internal(
      normalized_email,
      normalized_machine_ids,
      normalized_reason
    );

    select (internal_result ->> 'grantId')::uuid
    into resolved_grant_id;

    select *
    into after_grant
    from public.technician_grants grant_row
    where grant_row.id = resolved_grant_id
    limit 1;

    actor_authority_path := public.technician_actor_authority_path(
      current_user_id,
      after_grant.account_id
    );

    if actor_authority_path = 'corporate_partner' and target_partner_id is null then
      target_partner_id := public.corporate_partner_partner_id_for_machine(
        current_user_id,
        normalized_machine_ids[1]
      );
    end if;

    update public.technician_grants
    set
      sponsor_type = case
        when actor_authority_path = 'corporate_partner' then 'corporate_partner'
        when actor_authority_path = 'scoped_admin' then 'scoped_admin'
        else 'plus_customer_account'
      end,
      partner_id = case when actor_authority_path = 'corporate_partner'
        then target_partner_id
        else null
      end,
      expires_at = grant_expiry
    where id = after_grant.id
    returning * into after_grant;

    update public.technician_machine_assignments
    set expires_at = grant_expiry
    where technician_grant_id = after_grant.id
      and revoked_at is null;

    update public.reporting_machine_entitlements
    set expires_at = grant_expiry
    where source_type = 'technician_grant'
      and source_id = after_grant.id
      and revoked_at is null;

    return internal_result
      || jsonb_build_object(
        'expiresAt', after_grant.expires_at,
        'sponsorType', after_grant.sponsor_type,
        'partnerId', after_grant.partner_id,
        'authorityPath', actor_authority_path
      );
  end if;

  target_account_id := p_account_id;

  if target_account_id is null then
    raise exception 'Select an account before saving training-only Technician access';
  end if;

  actor_authority_path := public.technician_actor_authority_path(current_user_id, target_account_id);

  if actor_authority_path is null then
    raise exception 'Technician management access required';
  end if;

  if actor_authority_path = 'scoped_admin' then
    raise exception 'Scoped Admin Technician grants require at least one assigned machine';
  end if;

  if actor_authority_path = 'corporate_partner' then
    target_partner_id := p_partner_id;

    if target_partner_id is null then
      select party.partner_id
      into target_partner_id
      from public.reporting_machines machine
      join public.reporting_machine_partnership_assignments assignment
        on assignment.machine_id = machine.id
      join public.reporting_partnership_parties party
        on party.partnership_id = assignment.partnership_id
      join public.reporting_partnerships partnership
        on partnership.id = assignment.partnership_id
      where machine.account_id = target_account_id
        and machine.status = 'active'
        and assignment.assignment_role = 'primary_reporting'
        and assignment.status = 'active'
        and partnership.status = 'active'
        and party.portal_access_enabled
        and party.partner_id = any(public.corporate_partner_ids_for_user(current_user_id))
      order by party.created_at desc
      limit 1;
    end if;

    if target_partner_id is null
      or not target_partner_id = any(public.corporate_partner_ids_for_user(current_user_id)) then
      raise exception 'Corporate Partner context is required';
    end if;
  else
    target_partner_id := null;
  end if;

  if not exists (
    select 1
    from public.customer_accounts account
    where account.id = target_account_id
      and account.status = 'active'
  ) then
    raise exception 'Active account not found';
  end if;

  select auth_user.id
  into target_user_id
  from auth.users auth_user
  where public.normalize_technician_email(auth_user.email) = normalized_email
  limit 1;

  selected_sponsor_user_id := public.technician_pick_sponsor_user_id(
    current_user_id,
    target_account_id
  );

  if selected_sponsor_user_id is null then
    raise exception 'No active Technician sponsor found for this account';
  end if;

  select public.normalize_technician_email(auth_user.email)
  into sponsor_email
  from auth.users auth_user
  where auth_user.id = selected_sponsor_user_id
  limit 1;

  if sponsor_email = normalized_email then
    raise exception 'Use a different email for Technician access';
  end if;

  select *
  into before_grant
  from public.technician_grants grant_row
  where grant_row.account_id = target_account_id
    and lower(grant_row.technician_email) = normalized_email
    and grant_row.revoked_at is null
  limit 1
  for update;

  if before_grant.id is null
    and not public.has_available_technician_grant_seat(
      target_account_id,
      normalized_email,
      target_user_id,
      10
    ) then
    raise exception 'Technician grant cap exceeded for this account';
  end if;

  operator_grant := public.technician_reuse_or_create_operator_training_grant(
    selected_sponsor_user_id,
    normalized_email,
    target_user_id,
    normalized_reason,
    current_user_id
  );

  if before_grant.id is null then
    insert into public.technician_grants (
      account_id,
      sponsor_user_id,
      sponsor_type,
      partner_id,
      technician_email,
      technician_user_id,
      operator_training_grant_id,
      status,
      starts_at,
      expires_at,
      grant_reason,
      granted_by_user_id,
      revoked_at,
      revoked_by_user_id,
      revoke_reason
    )
    values (
      target_account_id,
      selected_sponsor_user_id,
      case when actor_authority_path = 'corporate_partner'
        then 'corporate_partner'
        else 'plus_customer_account'
      end,
      case when actor_authority_path = 'corporate_partner'
        then target_partner_id
        else null
      end,
      normalized_email,
      target_user_id,
      operator_grant.id,
      case when target_user_id is null then 'pending' else 'active' end,
      now(),
      grant_expiry,
      normalized_reason,
      current_user_id,
      null,
      null,
      null
    )
    returning * into after_grant;

    action_name := 'technician_access.granted';
  else
    update public.technician_grants
    set
      sponsor_user_id = selected_sponsor_user_id,
      sponsor_type = case when actor_authority_path = 'corporate_partner'
        then 'corporate_partner'
        else 'plus_customer_account'
      end,
      partner_id = case when actor_authority_path = 'corporate_partner'
        then target_partner_id
        else null
      end,
      technician_user_id = coalesce(target_user_id, technician_user_id),
      operator_training_grant_id = operator_grant.id,
      status = case
        when coalesce(target_user_id, technician_user_id) is null then 'pending'
        else 'active'
      end,
      expires_at = grant_expiry,
      grant_reason = normalized_reason,
      granted_by_user_id = current_user_id,
      revoked_at = null,
      revoked_by_user_id = null,
      revoke_reason = null
    where id = before_grant.id
    returning * into after_grant;

    action_name := 'technician_access.updated';
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
    action_name,
    'technician_grant',
    after_grant.id::text,
    after_grant.technician_user_id,
    coalesce(to_jsonb(before_grant), '{}'::jsonb),
    to_jsonb(after_grant),
    jsonb_build_object(
      'actor_authority_path', actor_authority_path,
      'account_id', after_grant.account_id,
      'sponsor_user_id', after_grant.sponsor_user_id,
      'technician_email', normalized_email,
      'technician_user_id', after_grant.technician_user_id,
      'operator_training_grant_id', after_grant.operator_training_grant_id,
      'reason', normalized_reason,
      'machine_ids_requested', '[]'::jsonb,
      'source_type', 'technician_grant',
      'source_id', after_grant.id
    )
  );

  return jsonb_build_object(
    'grantId', after_grant.id,
    'accountId', after_grant.account_id,
    'partnerId', after_grant.partner_id,
    'sponsorType', after_grant.sponsor_type,
    'technicianEmail', after_grant.technician_email,
    'technicianUserId', after_grant.technician_user_id,
    'status', after_grant.status,
    'expiresAt', after_grant.expires_at,
    'operatorTrainingGrantId', after_grant.operator_training_grant_id,
    'authorityPath', actor_authority_path
  );
end;
$$;

create or replace function public.update_technician_machines(
  p_grant_id uuid,
  p_machine_ids uuid[] default '{}'::uuid[],
  p_reason text default 'Technician machine assignments updated'
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  result jsonb;
  current_user_id uuid;
  actor_authority_path text;
  grant_row public.technician_grants;
  grant_expiry timestamptz := now() + interval '1 year';
begin
  current_user_id := auth.uid();

  if current_user_id is null then
    raise exception 'Authentication required';
  end if;

  select *
  into grant_row
  from public.technician_grants existing_grant
  where existing_grant.id = p_grant_id
    and existing_grant.revoked_at is null
  limit 1;

  if grant_row.id is null then
    raise exception 'No active Technician grant found';
  end if;

  actor_authority_path := public.technician_actor_authority_path(
    current_user_id,
    grant_row.account_id
  );

  if actor_authority_path = 'corporate_partner'
    and not public.can_manage_corporate_partner_technician_grant(
      current_user_id,
      p_grant_id,
      coalesce(p_machine_ids, '{}'::uuid[])
    ) then
    raise exception 'Corporate Partner can manage only Technician grants in their partner scope';
  end if;

  if actor_authority_path = 'scoped_admin'
    and not public.can_manage_scoped_admin_technician_grant(
      current_user_id,
      p_grant_id,
      coalesce(p_machine_ids, '{}'::uuid[])
    ) then
    raise exception 'Scoped Admin can manage only Technician grants wholly inside assigned machine scope';
  end if;

  result := public.update_technician_machines_internal(
    p_grant_id,
    coalesce(p_machine_ids, '{}'::uuid[]),
    p_reason
  );

  update public.technician_grants
  set
    sponsor_type = case when actor_authority_path = 'scoped_admin'
      then 'scoped_admin'
      else sponsor_type
    end,
    expires_at = grant_expiry
  where id = p_grant_id
    and revoked_at is null;

  update public.technician_machine_assignments
  set expires_at = grant_expiry
  where technician_grant_id = p_grant_id
    and revoked_at is null;

  update public.reporting_machine_entitlements
  set expires_at = grant_expiry
  where source_type = 'technician_grant'
    and source_id = p_grant_id
    and revoked_at is null;

  return result || jsonb_build_object('expiresAt', grant_expiry, 'authorityPath', actor_authority_path);
end;
$$;

create or replace function public.revoke_technician_access(
  p_grant_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  current_user_id uuid;
  actor_authority_path text;
  grant_row public.technician_grants;
begin
  current_user_id := auth.uid();

  if current_user_id is null then
    raise exception 'Authentication required';
  end if;

  select *
  into grant_row
  from public.technician_grants existing_grant
  where existing_grant.id = p_grant_id
    and existing_grant.revoked_at is null
  limit 1;

  if grant_row.id is null then
    raise exception 'No active Technician grant found';
  end if;

  actor_authority_path := public.technician_actor_authority_path(
    current_user_id,
    grant_row.account_id
  );

  if actor_authority_path = 'corporate_partner'
    and not public.can_manage_corporate_partner_technician_grant(
      current_user_id,
      p_grant_id,
      null
    ) then
    raise exception 'Corporate Partner can revoke only Technician grants in their partner scope';
  end if;

  if actor_authority_path = 'scoped_admin'
    and not public.can_manage_scoped_admin_technician_grant(
      current_user_id,
      p_grant_id,
      null
    ) then
    raise exception 'Scoped Admin can revoke only Technician grants wholly inside assigned machine scope';
  end if;

  return public.revoke_technician_access_internal(p_grant_id, p_reason)
    || jsonb_build_object('authorityPath', actor_authority_path);
end;
$$;

create or replace function public.can_access_technician_grant(
  p_user_id uuid,
  p_technician_grant_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select p_user_id is not null
    and p_technician_grant_id is not null
    and (
      public.is_super_admin(p_user_id)
      or public.can_manage_scoped_admin_technician_grant(
        p_user_id,
        p_technician_grant_id,
        null
      )
      or exists (
        select 1
        from public.technician_grants grant_row
        left join auth.users auth_user on auth_user.id = p_user_id
        where grant_row.id = p_technician_grant_id
          and (
            (
              grant_row.sponsor_user_id = p_user_id
              and (
                grant_row.sponsor_type = 'plus_customer_account'
                or (
                  grant_row.sponsor_type = 'scoped_admin'
                  and public.can_manage_scoped_admin_technician_grant(
                    p_user_id,
                    grant_row.id,
                    null
                  )
                )
                or public.can_manage_corporate_partner_technician_grant(
                  p_user_id,
                  grant_row.id,
                  null
                )
              )
            )
            or grant_row.technician_user_id = p_user_id
            or lower(grant_row.technician_email) = lower(auth_user.email)
            or public.can_manage_corporate_partner_technician_grant(
              p_user_id,
              grant_row.id,
              null
            )
          )
      )
    );
$$;

create or replace function public.admin_get_technician_access_context(
  p_target_email text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  current_user_id uuid;
  normalized_email text;
  target_user_id uuid;
  actor_is_super_admin boolean;
  actor_machine_ids uuid[];
  actor_is_scoped_admin boolean;
  result jsonb;
begin
  current_user_id := auth.uid();

  actor_is_super_admin := public.is_super_admin(current_user_id);
  actor_machine_ids := coalesce(public.scoped_admin_machine_ids(current_user_id), '{}'::uuid[]);
  actor_is_scoped_admin := coalesce(array_length(actor_machine_ids, 1), 0) > 0;

  if not actor_is_super_admin and not actor_is_scoped_admin then
    raise exception 'Admin Technician access required';
  end if;

  normalized_email := public.normalize_technician_email(p_target_email);

  if normalized_email = '' then
    raise exception 'Technician email is required';
  end if;

  select auth_user.id
  into target_user_id
  from auth.users auth_user
  where public.normalize_technician_email(auth_user.email) = normalized_email
  limit 1;

  select jsonb_build_object(
    'targetEmail', normalized_email,
    'targetUserId', target_user_id,
    'authorityPath', case when actor_is_super_admin then 'super_admin' else 'scoped_admin' end,
    'requiresMachineScope', actor_is_scoped_admin and not actor_is_super_admin,
    'allowTrainingOnly', actor_is_super_admin,
    'activeAccountCount', (
      select count(distinct account.id)::integer
      from public.customer_accounts account
      left join public.reporting_machines machine
        on machine.account_id = account.id
        and machine.status = 'active'
      where account.status = 'active'
        and (
          actor_is_super_admin
          or machine.id = any(actor_machine_ids)
        )
    ),
    'eligibleAccountCount', (
      select count(distinct account.id)::integer
      from public.customer_accounts account
      left join public.reporting_machines machine
        on machine.account_id = account.id
        and machine.status = 'active'
      where account.status = 'active'
        and (
          actor_is_super_admin
          or machine.id = any(actor_machine_ids)
        )
    ),
    'ineligibleAccountCount', 0,
    'accounts', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'accountId', account.id,
          'accountName', account.name,
          'accountStatus', account.status,
          'sponsorUserId', coalesce(sponsor.sponsor_user_id, current_user_id),
          'sponsorType', case
            when sponsor.sponsor_user_id is not null then 'plus_customer_account'
            when actor_is_super_admin then 'super_admin_fallback'
            else 'scoped_admin'
          end,
          'authorityPath', case when actor_is_super_admin then 'super_admin' else 'scoped_admin' end,
          'machineCount', (
            select count(*)::integer
            from public.reporting_machines machine
            where machine.account_id = account.id
              and machine.status = 'active'
              and (
                actor_is_super_admin
                or machine.id = any(actor_machine_ids)
              )
          ),
          'machines', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'machineId', machine.id,
                'machineLabel', machine.machine_label,
                'machineType', machine.machine_type,
                'accountId', account.id,
                'accountName', account.name,
                'locationId', location.id,
                'locationName', location.name,
                'status', machine.status
              )
              order by location.name, machine.machine_label, machine.id
            )
            from public.reporting_machines machine
            left join public.reporting_locations location on location.id = machine.location_id
            where machine.account_id = account.id
              and machine.status = 'active'
              and (
                actor_is_super_admin
                or machine.id = any(actor_machine_ids)
              )
          ), '[]'::jsonb)
        )
        order by account.name, account.id
      )
      from public.customer_accounts account
      left join lateral (
        select membership.user_id as sponsor_user_id
        from public.customer_account_memberships membership
        where membership.account_id = account.id
          and membership.active
          and membership.role = 'owner'
          and public.has_plus_access(membership.user_id)
        order by membership.created_at asc, membership.id asc
        limit 1
      ) sponsor on true
      where account.status = 'active'
        and (
          actor_is_super_admin
          or exists (
            select 1
            from public.reporting_machines machine
            where machine.account_id = account.id
              and machine.status = 'active'
              and machine.id = any(actor_machine_ids)
          )
        )
    ), '[]'::jsonb),
    'grants', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'grantId', grant_row.id,
          'accountId', grant_row.account_id,
          'accountName', account.name,
          'sponsorUserId', grant_row.sponsor_user_id,
          'sponsorType', grant_row.sponsor_type,
          'authorityPath', case
            when actor_is_super_admin then 'super_admin'
            when public.can_manage_scoped_admin_technician_grant(current_user_id, grant_row.id, null)
              then 'scoped_admin'
            else 'super_admin_required'
          end,
          'canManage', actor_is_super_admin
            or public.can_manage_scoped_admin_technician_grant(current_user_id, grant_row.id, null),
          'requiresSuperAdminRepair', not actor_is_super_admin
            and not public.can_manage_scoped_admin_technician_grant(current_user_id, grant_row.id, null),
          'outOfScopeMachineCount', case
            when actor_is_super_admin then 0
            else (
              select count(*)::integer
              from public.technician_machine_assignments assignment
              where assignment.technician_grant_id = grant_row.id
                and public.technician_assignment_is_active(
                  assignment.starts_at,
                  assignment.expires_at,
                  assignment.revoked_at,
                  assignment.status
                )
                and not assignment.machine_id = any(actor_machine_ids)
            )
          end,
          'partnerId', grant_row.partner_id,
          'partnerName', partner.name,
          'technicianEmail', grant_row.technician_email,
          'technicianUserId', grant_row.technician_user_id,
          'operatorTrainingGrantId', grant_row.operator_training_grant_id,
          'status', grant_row.status,
          'startsAt', grant_row.starts_at,
          'expiresAt', grant_row.expires_at,
          'grantReason', grant_row.grant_reason,
          'revokedAt', grant_row.revoked_at,
          'revokeReason', grant_row.revoke_reason,
          'createdAt', grant_row.created_at,
          'updatedAt', grant_row.updated_at,
          'isActive', public.technician_grant_is_active(
            grant_row.starts_at,
            grant_row.expires_at,
            grant_row.revoked_at,
            grant_row.status
          ),
          'machines', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'assignmentId', assignment.id,
                'machineId', assignment.machine_id,
                'machineLabel', machine.machine_label,
                'machineType', machine.machine_type,
                'accountId', machine.account_id,
                'accountName', machine_account.name,
                'locationId', machine.location_id,
                'locationName', location.name,
                'status', assignment.status,
                'startsAt', assignment.starts_at,
                'expiresAt', assignment.expires_at,
                'revokedAt', assignment.revoked_at,
                'revokeReason', assignment.revoke_reason,
                'isActive', public.technician_assignment_is_active(
                  assignment.starts_at,
                  assignment.expires_at,
                  assignment.revoked_at,
                  assignment.status
                )
              )
              order by machine.machine_label, assignment.created_at
            )
            from public.technician_machine_assignments assignment
            left join public.reporting_machines machine on machine.id = assignment.machine_id
            left join public.customer_accounts machine_account on machine_account.id = machine.account_id
            left join public.reporting_locations location on location.id = machine.location_id
            where assignment.technician_grant_id = grant_row.id
              and assignment.revoked_at is null
              and (
                actor_is_super_admin
                or assignment.machine_id = any(actor_machine_ids)
              )
          ), '[]'::jsonb),
          'activeReportingEntitlementCount', (
            select count(*)::integer
            from public.reporting_machine_entitlements entitlement
            where entitlement.source_type = 'technician_grant'
              and entitlement.source_id = grant_row.id
              and public.reporting_entitlement_is_active(
                entitlement.starts_at,
                entitlement.expires_at,
                entitlement.revoked_at
              )
          )
        )
        order by
          case when grant_row.revoked_at is null then 0 else 1 end,
          grant_row.updated_at desc,
          grant_row.id
      )
      from public.technician_grants grant_row
      join public.customer_accounts account on account.id = grant_row.account_id
      left join public.reporting_partners partner on partner.id = grant_row.partner_id
      where (
          public.normalize_technician_email(grant_row.technician_email) = normalized_email
          or (
            target_user_id is not null
            and grant_row.technician_user_id = target_user_id
          )
        )
        and (
          actor_is_super_admin
          or exists (
            select 1
            from public.technician_machine_assignments assignment
            where assignment.technician_grant_id = grant_row.id
              and public.technician_assignment_is_active(
                assignment.starts_at,
                assignment.expires_at,
                assignment.revoked_at,
                assignment.status
              )
              and assignment.machine_id = any(actor_machine_ids)
          )
        )
    ), '[]'::jsonb)
  )
  into result;

  return result;
end;
$$;

create or replace function public.admin_grant_technician_access(
  p_target_email text,
  p_account_id uuid,
  p_machine_ids uuid[] default '{}'::uuid[],
  p_reason text default 'Admin Technician access'
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  current_user_id uuid;
  normalized_email text;
  normalized_reason text;
  normalized_machine_ids uuid[];
  target_account_id uuid;
  requested_machine_count integer;
  active_machine_count integer;
  account_count integer;
  actor_authority_path text;
  grant_result jsonb;
  update_result jsonb;
begin
  current_user_id := auth.uid();

  if current_user_id is null then
    raise exception 'Authentication required';
  end if;

  normalized_email := public.normalize_technician_email(p_target_email);
  normalized_reason := public.technician_assert_reason(p_reason);

  if normalized_email = '' then
    raise exception 'Technician email is required';
  end if;

  select coalesce(array_agg(machine_id order by machine_id), '{}'::uuid[])
  into normalized_machine_ids
  from (
    select distinct requested.machine_id
    from unnest(coalesce(p_machine_ids, '{}'::uuid[])) as requested(machine_id)
    where requested.machine_id is not null
  ) distinct_requested;

  requested_machine_count := coalesce(array_length(normalized_machine_ids, 1), 0);

  if requested_machine_count = 0 and p_account_id is null then
    raise exception 'Select an account for training-only Technician access';
  end if;

  if requested_machine_count > 0 then
    select
      count(*)::integer,
      count(distinct machine.account_id)::integer
    into active_machine_count, account_count
    from public.reporting_machines machine
    join public.customer_accounts account on account.id = machine.account_id
    where machine.id = any(normalized_machine_ids)
      and machine.status = 'active'
      and account.status = 'active';

    if active_machine_count <> requested_machine_count then
      raise exception 'One or more selected machines are unavailable';
    end if;

    if account_count <> 1 then
      raise exception 'Selected machines must belong to one active account';
    end if;

    select machine.account_id
    into target_account_id
    from public.reporting_machines machine
    where machine.id = any(normalized_machine_ids)
      and machine.status = 'active'
    limit 1;

    if p_account_id is not null and p_account_id <> target_account_id then
      raise exception 'Selected machines do not belong to the selected account';
    end if;
  else
    target_account_id := p_account_id;
  end if;

  if not exists (
    select 1
    from public.customer_accounts account
    where account.id = target_account_id
      and account.status = 'active'
  ) then
    raise exception 'Active account not found';
  end if;

  actor_authority_path := public.technician_actor_authority_path(current_user_id, target_account_id);

  if actor_authority_path not in ('super_admin', 'scoped_admin') then
    raise exception 'Admin Technician access required';
  end if;

  if actor_authority_path = 'scoped_admin' then
    if requested_machine_count = 0 then
      raise exception 'Scoped Admin Technician grants require at least one assigned machine';
    end if;

    if not public.scoped_admin_can_manage_technician_machine_set(
      current_user_id,
      normalized_machine_ids
    ) then
      raise exception 'Scoped Admin can manage only assigned in-scope Technician machines';
    end if;
  end if;

  grant_result := public.grant_technician_access(
    normalized_email,
    normalized_machine_ids,
    normalized_reason,
    target_account_id,
    null
  );

  if requested_machine_count = 0 then
    update_result := public.update_technician_machines(
      (grant_result ->> 'grantId')::uuid,
      '{}'::uuid[],
      normalized_reason
    );

    grant_result := grant_result || jsonb_build_object('machineResult', update_result);
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
    'admin_technician_access.granted_or_updated',
    'technician_grant',
    grant_result ->> 'grantId',
    nullif(grant_result ->> 'technicianUserId', '')::uuid,
    '{}'::jsonb,
    grant_result,
    jsonb_build_object(
      'actor_authority_path', actor_authority_path,
      'account_id', target_account_id,
      'machine_ids', normalized_machine_ids,
      'machine_count', requested_machine_count,
      'technician_email', normalized_email,
      'reason', normalized_reason,
      'admin_wrapper', true,
      'source_type', 'technician_grant',
      'source_id', grant_result ->> 'grantId'
    )
  );

  return grant_result || jsonb_build_object('authorityPath', actor_authority_path);
end;
$$;

create or replace function public.admin_update_technician_machines(
  p_grant_id uuid,
  p_machine_ids uuid[] default '{}'::uuid[],
  p_reason text default 'Admin Technician machine scope updated'
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  current_user_id uuid;
  normalized_reason text;
  grant_row public.technician_grants;
  normalized_machine_ids uuid[];
  requested_machine_count integer;
  valid_machine_count integer;
  before_machine_ids uuid[];
  actor_authority_path text;
  update_result jsonb;
begin
  current_user_id := auth.uid();

  if current_user_id is null then
    raise exception 'Authentication required';
  end if;

  if p_grant_id is null then
    raise exception 'Technician grant ID is required';
  end if;

  normalized_reason := public.technician_assert_reason(p_reason);

  select *
  into grant_row
  from public.technician_grants existing_grant
  where existing_grant.id = p_grant_id
    and existing_grant.revoked_at is null
  limit 1
  for update;

  if grant_row.id is null then
    raise exception 'No active Technician grant found';
  end if;

  actor_authority_path := public.technician_actor_authority_path(current_user_id, grant_row.account_id);

  if actor_authority_path not in ('super_admin', 'scoped_admin') then
    raise exception 'Admin Technician access required';
  end if;

  select coalesce(array_agg(assignment.machine_id order by assignment.machine_id), '{}'::uuid[])
  into before_machine_ids
  from public.technician_machine_assignments assignment
  where assignment.technician_grant_id = grant_row.id
    and assignment.revoked_at is null
    and assignment.status <> 'revoked';

  select coalesce(array_agg(machine_id order by machine_id), '{}'::uuid[])
  into normalized_machine_ids
  from (
    select distinct requested.machine_id
    from unnest(coalesce(p_machine_ids, '{}'::uuid[])) as requested(machine_id)
    where requested.machine_id is not null
  ) distinct_requested;

  requested_machine_count := coalesce(array_length(normalized_machine_ids, 1), 0);

  if requested_machine_count > 0 then
    select count(*)::integer
    into valid_machine_count
    from public.reporting_machines machine
    where machine.id = any(normalized_machine_ids)
      and machine.account_id = grant_row.account_id
      and machine.status = 'active';

    if valid_machine_count <> requested_machine_count then
      raise exception 'One or more selected machines are unavailable or outside this Technician account';
    end if;
  end if;

  if actor_authority_path = 'scoped_admin'
    and not public.can_manage_scoped_admin_technician_grant(
      current_user_id,
      grant_row.id,
      normalized_machine_ids
    ) then
    raise exception 'Scoped Admin can manage only Technician grants wholly inside assigned machine scope';
  end if;

  update_result := public.update_technician_machines(
    grant_row.id,
    normalized_machine_ids,
    normalized_reason
  );

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
    'admin_technician_access.scope_updated',
    'technician_grant',
    grant_row.id::text,
    grant_row.technician_user_id,
    jsonb_build_object(
      'grant', to_jsonb(grant_row),
      'machine_ids', before_machine_ids
    ),
    update_result,
    jsonb_build_object(
      'actor_authority_path', actor_authority_path,
      'account_id', grant_row.account_id,
      'machine_ids', normalized_machine_ids,
      'machine_count', requested_machine_count,
      'reason', normalized_reason,
      'admin_wrapper', true,
      'source_type', 'technician_grant',
      'source_id', grant_row.id
    )
  );

  return update_result || jsonb_build_object('authorityPath', actor_authority_path);
end;
$$;

create or replace function public.admin_renew_technician_access(
  p_grant_id uuid,
  p_reason text default 'Admin Technician access renewed'
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  current_user_id uuid;
  normalized_reason text;
  grant_row public.technician_grants;
  current_machine_ids uuid[];
  actor_authority_path text;
  update_result jsonb;
begin
  current_user_id := auth.uid();

  if current_user_id is null then
    raise exception 'Authentication required';
  end if;

  if p_grant_id is null then
    raise exception 'Technician grant ID is required';
  end if;

  normalized_reason := public.technician_assert_reason(p_reason);

  select *
  into grant_row
  from public.technician_grants existing_grant
  where existing_grant.id = p_grant_id
    and existing_grant.revoked_at is null
  limit 1
  for update;

  if grant_row.id is null then
    raise exception 'No active Technician grant found';
  end if;

  actor_authority_path := public.technician_actor_authority_path(current_user_id, grant_row.account_id);

  if actor_authority_path not in ('super_admin', 'scoped_admin') then
    raise exception 'Admin Technician access required';
  end if;

  select coalesce(array_agg(assignment.machine_id order by assignment.machine_id), '{}'::uuid[])
  into current_machine_ids
  from public.technician_machine_assignments assignment
  where assignment.technician_grant_id = grant_row.id
    and assignment.revoked_at is null
    and assignment.status = 'active';

  if actor_authority_path = 'scoped_admin'
    and not public.can_manage_scoped_admin_technician_grant(
      current_user_id,
      grant_row.id,
      null
    ) then
    raise exception 'Scoped Admin can renew only Technician grants wholly inside assigned machine scope';
  end if;

  update_result := public.update_technician_machines(
    grant_row.id,
    current_machine_ids,
    normalized_reason
  );

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
    'admin_technician_access.renewed',
    'technician_grant',
    grant_row.id::text,
    grant_row.technician_user_id,
    to_jsonb(grant_row),
    update_result,
    jsonb_build_object(
      'actor_authority_path', actor_authority_path,
      'account_id', grant_row.account_id,
      'machine_ids', current_machine_ids,
      'machine_count', coalesce(array_length(current_machine_ids, 1), 0),
      'reason', normalized_reason,
      'admin_wrapper', true,
      'source_type', 'technician_grant',
      'source_id', grant_row.id
    )
  );

  return update_result || jsonb_build_object('authorityPath', actor_authority_path);
end;
$$;

create or replace function public.admin_revoke_technician_access(
  p_grant_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  current_user_id uuid;
  normalized_reason text;
  grant_row public.technician_grants;
  current_machine_ids uuid[];
  actor_authority_path text;
  revoke_result jsonb;
begin
  current_user_id := auth.uid();

  if current_user_id is null then
    raise exception 'Authentication required';
  end if;

  if p_grant_id is null then
    raise exception 'Technician grant ID is required';
  end if;

  normalized_reason := public.technician_assert_reason(p_reason);

  select *
  into grant_row
  from public.technician_grants existing_grant
  where existing_grant.id = p_grant_id
    and existing_grant.revoked_at is null
  limit 1
  for update;

  if grant_row.id is null then
    raise exception 'No active Technician grant found';
  end if;

  actor_authority_path := public.technician_actor_authority_path(current_user_id, grant_row.account_id);

  if actor_authority_path not in ('super_admin', 'scoped_admin') then
    raise exception 'Admin Technician access required';
  end if;

  select coalesce(array_agg(assignment.machine_id order by assignment.machine_id), '{}'::uuid[])
  into current_machine_ids
  from public.technician_machine_assignments assignment
  where assignment.technician_grant_id = grant_row.id
    and public.technician_assignment_is_active(
      assignment.starts_at,
      assignment.expires_at,
      assignment.revoked_at,
      assignment.status
    );

  if actor_authority_path = 'scoped_admin'
    and not public.can_manage_scoped_admin_technician_grant(
      current_user_id,
      grant_row.id,
      null
    ) then
    raise exception 'Scoped Admin can revoke only Technician grants wholly inside assigned machine scope';
  end if;

  revoke_result := public.revoke_technician_access(grant_row.id, normalized_reason);

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
    'admin_technician_access.revoked',
    'technician_grant',
    grant_row.id::text,
    grant_row.technician_user_id,
    to_jsonb(grant_row),
    revoke_result,
    jsonb_build_object(
      'actor_authority_path', actor_authority_path,
      'account_id', grant_row.account_id,
      'machine_ids', current_machine_ids,
      'reason', normalized_reason,
      'admin_wrapper', true,
      'source_type', 'technician_grant',
      'source_id', grant_row.id
    )
  );

  return revoke_result || jsonb_build_object('authorityPath', actor_authority_path);
end;
$$;

create or replace function public.admin_reconcile_technician_entitlements(
  p_reason text default 'Technician entitlement reconciliation'
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  current_user_id uuid;
  normalized_reason text;
  grant_before public.technician_grants;
  grant_after public.technician_grants;
  assignment_before public.technician_machine_assignments;
  assignment_after public.technician_machine_assignments;
  suspended_grant_count integer := 0;
  suspended_assignment_count integer := 0;
  revoked_entitlement_count integer := 0;
  revoked_count integer := 0;
begin
  current_user_id := auth.uid();

  if current_user_id is null then
    raise exception 'Authentication required';
  end if;

  if not public.is_super_admin(current_user_id) then
    raise exception 'Admin access required';
  end if;

  normalized_reason := public.technician_assert_reason(p_reason);

  for grant_before in
    select *
    from public.technician_grants grant_row
    where grant_row.revoked_at is null
      and grant_row.status in ('pending', 'active')
      and not (
        public.is_super_admin(grant_row.sponsor_user_id)
        or (
          grant_row.sponsor_type = 'corporate_partner'
          and grant_row.partner_id is not null
          and grant_row.partner_id = any(
            public.corporate_partner_ids_for_user(grant_row.sponsor_user_id)
          )
          and grant_row.account_id = any(
            public.corporate_partner_account_ids_for_user(grant_row.sponsor_user_id)
          )
        )
        or (
          grant_row.sponsor_type = 'scoped_admin'
          and public.can_manage_scoped_admin_technician_grant(
            grant_row.sponsor_user_id,
            grant_row.id,
            null
          )
        )
        or (
          public.has_plus_access(grant_row.sponsor_user_id)
          and exists (
            select 1
            from public.customer_account_memberships membership
            where membership.account_id = grant_row.account_id
              and membership.user_id = grant_row.sponsor_user_id
              and membership.active
              and membership.role = 'owner'
          )
        )
      )
    for update
  loop
    update public.technician_grants
    set
      status = 'suspended',
      grant_reason = normalized_reason,
      granted_by_user_id = current_user_id
    where id = grant_before.id
    returning * into grant_after;

    suspended_grant_count := suspended_grant_count + 1;

    update public.technician_machine_assignments assignment
    set
      status = 'suspended',
      grant_reason = normalized_reason,
      granted_by_user_id = current_user_id
    where assignment.technician_grant_id = grant_before.id
      and assignment.revoked_at is null
      and assignment.status = 'active';

    with revoked_entitlements as (
      update public.reporting_machine_entitlements entitlement
      set
        revoked_at = now(),
        revoked_by = current_user_id,
        revoke_reason = normalized_reason
      where entitlement.source_type = 'technician_grant'
        and entitlement.source_id = grant_before.id
        and public.reporting_entitlement_is_active(
          entitlement.starts_at,
          entitlement.expires_at,
          entitlement.revoked_at
        )
      returning entitlement.id
    )
    select count(*)::integer
    into revoked_count
    from revoked_entitlements;

    revoked_entitlement_count := revoked_entitlement_count + revoked_count;

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
      'technician_access.suspended',
      'technician_grant',
      grant_after.id::text,
      grant_after.technician_user_id,
      to_jsonb(grant_before),
      to_jsonb(grant_after),
      jsonb_build_object(
        'automation', true,
        'reason', normalized_reason,
        'account_id', grant_after.account_id,
        'sponsor_user_id', grant_after.sponsor_user_id,
        'technician_email', grant_after.technician_email,
        'technician_user_id', grant_after.technician_user_id,
        'reporting_entitlements_revoked', revoked_count,
        'source_type', 'technician_grant',
        'source_id', grant_after.id
      )
    );
  end loop;

  for assignment_before in
    select assignment.*
    from public.technician_machine_assignments assignment
    join public.technician_grants grant_row on grant_row.id = assignment.technician_grant_id
    left join public.reporting_machines machine on machine.id = assignment.machine_id
    where assignment.revoked_at is null
      and assignment.status = 'active'
      and grant_row.revoked_at is null
      and grant_row.status in ('pending', 'active')
      and (
        machine.id is null
        or machine.status <> 'active'
        or machine.account_id <> grant_row.account_id
      )
    for update of assignment
  loop
    update public.technician_machine_assignments
    set
      status = 'suspended',
      grant_reason = normalized_reason,
      granted_by_user_id = current_user_id
    where id = assignment_before.id
    returning * into assignment_after;

    suspended_assignment_count := suspended_assignment_count + 1;

    with revoked_entitlements as (
      update public.reporting_machine_entitlements entitlement
      set
        revoked_at = now(),
        revoked_by = current_user_id,
        revoke_reason = normalized_reason
      where entitlement.source_type = 'technician_grant'
        and entitlement.source_id = assignment_after.technician_grant_id
        and entitlement.machine_id = assignment_after.machine_id
        and public.reporting_entitlement_is_active(
          entitlement.starts_at,
          entitlement.expires_at,
          entitlement.revoked_at
        )
      returning entitlement.id
    )
    select count(*)::integer
    into revoked_count
    from revoked_entitlements;

    revoked_entitlement_count := revoked_entitlement_count + revoked_count;

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
      'technician_assignment.suspended',
      'technician_machine_assignment',
      assignment_after.id::text,
      null,
      to_jsonb(assignment_before),
      to_jsonb(assignment_after),
      jsonb_build_object(
        'automation', true,
        'reason', normalized_reason,
        'technician_grant_id', assignment_after.technician_grant_id,
        'machine_id', assignment_after.machine_id,
        'reporting_entitlements_revoked', revoked_count,
        'source_type', 'technician_grant',
        'source_id', assignment_after.technician_grant_id
      )
    );
  end loop;

  return jsonb_build_object(
    'suspendedGrantCount', suspended_grant_count,
    'suspendedAssignmentCount', suspended_assignment_count,
    'revokedReportingEntitlementCount', revoked_entitlement_count
  );
end;
$$;

comment on function public.scoped_admin_can_manage_technician_machine_set(uuid, uuid[]) is
  'Returns true only when a Scoped Admin can manage every requested active reporting machine.';

comment on function public.can_manage_scoped_admin_technician_grant(uuid, uuid, uuid[]) is
  'Returns true only for active Technician grants whose current and requested machines are wholly inside the Scoped Admin machine scope.';

comment on function public.admin_get_technician_access_context(text) is
  'Admin context for /admin/access Technician controls, including Super Admin fallback sponsorship and Scoped Admin machine-scoped authority.';

comment on function public.admin_grant_technician_access(text, uuid, uuid[], text) is
  'Admin Technician grant/update wrapper. Super Admin may grant training-only or selected machines; Scoped Admin must select in-scope machines.';

comment on function public.admin_update_technician_machines(uuid, uuid[], text) is
  'Admin Technician machine-scope update wrapper that blocks Scoped Admin out-of-scope and training-only updates.';

comment on function public.admin_renew_technician_access(uuid, text) is
  'Admin Technician renewal wrapper that preserves scope and blocks Scoped Admin stale or out-of-scope grants.';

comment on function public.admin_revoke_technician_access(uuid, text) is
  'Admin Technician revoke wrapper that leaves unrelated manual reporting grants intact and limits Scoped Admins to wholly in-scope grants.';

revoke execute on function public.scoped_admin_can_manage_technician_machine_set(uuid, uuid[])
  from public, anon;
revoke execute on function public.can_manage_scoped_admin_technician_grant(uuid, uuid, uuid[])
  from public, anon;
revoke execute on function public.can_manage_technician_grants_for_account(uuid, uuid)
  from public, anon;
revoke execute on function public.can_manage_technician_grants_for_machine(uuid, uuid)
  from public, anon;
revoke execute on function public.technician_actor_authority_path(uuid, uuid)
  from public, anon;
revoke execute on function public.technician_pick_sponsor_user_id(uuid, uuid)
  from public, anon;
revoke execute on function public.admin_get_technician_access_context(text)
  from public, anon, authenticated, service_role;
revoke execute on function public.admin_grant_technician_access(text, uuid, uuid[], text)
  from public, anon, authenticated, service_role;
revoke execute on function public.admin_update_technician_machines(uuid, uuid[], text)
  from public, anon, authenticated, service_role;
revoke execute on function public.admin_renew_technician_access(uuid, text)
  from public, anon, authenticated, service_role;
revoke execute on function public.admin_revoke_technician_access(uuid, text)
  from public, anon, authenticated, service_role;
revoke execute on function public.admin_reconcile_technician_entitlements(text)
  from public, anon, authenticated;

grant execute on function public.scoped_admin_can_manage_technician_machine_set(uuid, uuid[])
  to authenticated, service_role;
grant execute on function public.can_manage_scoped_admin_technician_grant(uuid, uuid, uuid[])
  to authenticated, service_role;
grant execute on function public.can_manage_technician_grants_for_account(uuid, uuid)
  to authenticated, service_role;
grant execute on function public.can_manage_technician_grants_for_machine(uuid, uuid)
  to authenticated, service_role;
grant execute on function public.technician_actor_authority_path(uuid, uuid)
  to authenticated, service_role;
grant execute on function public.technician_pick_sponsor_user_id(uuid, uuid)
  to authenticated, service_role;
grant execute on function public.admin_get_technician_access_context(text)
  to authenticated;
grant execute on function public.admin_grant_technician_access(text, uuid, uuid[], text)
  to authenticated;
grant execute on function public.admin_update_technician_machines(uuid, uuid[], text)
  to authenticated;
grant execute on function public.admin_renew_technician_access(uuid, text)
  to authenticated;
grant execute on function public.admin_revoke_technician_access(uuid, text)
  to authenticated;
grant execute on function public.admin_reconcile_technician_entitlements(text)
  to service_role;

select pg_notify('pgrst', 'reload schema');
