-- Temporary non-super-admin reporting access for Adam while scoped admin roles
-- are tracked in issue #259.
--
-- This intentionally does not grant `super_admin`. The currently implemented
-- non-super-admin access model for reporting is explicit machine-level
-- `report_manager` access through `reporting_machine_entitlements`.

do $$
declare
  target_user_id uuid;
  normalized_email text := 'adam@bloomjoysweets.com';
  access_reason text := 'Temporary report-manager access pending scoped admin UI (#259)';
  updated_count integer := 0;
  inserted_count integer := 0;
begin
  select users.id
  into target_user_id
  from auth.users users
  where lower(users.email) = normalized_email
  limit 1;

  if target_user_id is null then
    raise notice 'Skipping Adam report-manager quick fix: no auth user found for %', normalized_email;
    return;
  end if;

  with target_machines as (
    select machine.id
    from public.reporting_machines machine
    where machine.status = 'active'
  ),
  active_existing as (
    select distinct on (entitlement.machine_id)
      entitlement.id
    from public.reporting_machine_entitlements entitlement
    join target_machines machine
      on machine.id = entitlement.machine_id
    where entitlement.user_id = target_user_id
      and public.reporting_entitlement_is_active(
        entitlement.starts_at,
        entitlement.expires_at,
        entitlement.revoked_at
      )
    order by entitlement.machine_id, entitlement.updated_at desc
  ),
  updated as (
    update public.reporting_machine_entitlements entitlement
    set
      access_level = 'report_manager',
      grant_reason = access_reason,
      expires_at = null,
      revoked_at = null,
      revoked_by = null,
      revoke_reason = null
    where entitlement.id in (select existing.id from active_existing existing)
      and (
        entitlement.access_level is distinct from 'report_manager'
        or entitlement.grant_reason is distinct from access_reason
        or entitlement.expires_at is not null
        or entitlement.revoked_at is not null
      )
    returning entitlement.id
  )
  select count(*)
  into updated_count
  from updated;

  with target_machines as (
    select machine.id
    from public.reporting_machines machine
    where machine.status = 'active'
  ),
  missing_machines as (
    select machine.id
    from target_machines machine
    where not exists (
      select 1
      from public.reporting_machine_entitlements entitlement
      where entitlement.user_id = target_user_id
        and entitlement.machine_id = machine.id
        and public.reporting_entitlement_is_active(
          entitlement.starts_at,
          entitlement.expires_at,
          entitlement.revoked_at
        )
    )
  ),
  inserted as (
    insert into public.reporting_machine_entitlements (
      user_id,
      machine_id,
      access_level,
      grant_reason,
      granted_by
    )
    select
      target_user_id,
      machine.id,
      'report_manager',
      access_reason,
      null
    from missing_machines machine
    returning id
  )
  select count(*)
  into inserted_count
  from inserted;

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
    null,
    'reporting_access.bulk_granted',
    'reporting_machine_entitlement',
    target_user_id::text,
    target_user_id,
    '{}'::jsonb,
    jsonb_build_object(
      'access_level', 'report_manager',
      'updated_count', updated_count,
      'inserted_count', inserted_count
    ),
    jsonb_build_object(
      'target_email', normalized_email,
      'reason', access_reason,
      'github_issue', 'https://github.com/ethtri/bloomjoy-hub/issues/259'
    )
  );

  raise notice 'Granted Adam report-manager access: % updated, % inserted', updated_count, inserted_count;
end $$;
