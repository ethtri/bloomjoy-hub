-- Issue #613: pending Technician invites created by Super Admin or Scoped Admin
-- must resolve on the invited user's first successful sign-in.
--
-- The existing resolver still accepted only a Plus account owner (and, in a
-- later wrapper, Corporate Partner) as a valid sponsor. Admin grant workflows
-- can intentionally fall back to the Super Admin actor when an account has no
-- Plus owner, and Scoped Admin grants are also first-class. The stale resolver
-- silently counted those grants as skipped, leaving training active but the
-- selected reporting machines unavailable.

create or replace function public.resolve_my_technician_entitlements(
  p_reason text default 'Technician invite accepted'
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
  grant_before public.technician_grants;
  grant_after public.technician_grants;
  operator_before public.operator_training_grants;
  operator_after public.operator_training_grants;
  active_machine_ids uuid[];
  grant_changed boolean;
  operator_changed boolean;
  entitlement_rows_changed integer;
  sponsor_is_valid boolean;
  resolved_grant_count integer := 0;
  resolved_operator_grant_count integer := 0;
  upserted_reporting_entitlement_count integer := 0;
  skipped_grant_count integer := 0;
begin
  current_user_id := auth.uid();

  if current_user_id is null then
    raise exception 'Authentication required';
  end if;

  normalized_reason := public.technician_assert_reason(p_reason);

  select auth_user.email
  into current_user_email
  from auth.users auth_user
  where auth_user.id = current_user_id
  limit 1;

  normalized_email := public.normalize_technician_email(current_user_email);

  if normalized_email = '' then
    return jsonb_build_object(
      'technicianEmail', null,
      'resolvedGrantCount', 0,
      'resolvedOperatorTrainingGrantCount', 0,
      'upsertedReportingEntitlementCount', 0,
      'skippedGrantCount', 0
    );
  end if;

  for grant_before in
    select *
    from public.technician_grants grant_row
    where public.normalize_technician_email(grant_row.technician_email) = normalized_email
      and public.technician_grant_is_active(
        grant_row.starts_at,
        grant_row.expires_at,
        grant_row.revoked_at,
        grant_row.status
      )
      and (
        grant_row.technician_user_id is null
        or grant_row.technician_user_id = current_user_id
      )
    for update
  loop
    if public.is_super_admin(grant_before.sponsor_user_id) then
      sponsor_is_valid := true;
    elsif grant_before.sponsor_type = 'corporate_partner' then
      sponsor_is_valid :=
        grant_before.partner_id is not null
        and grant_before.partner_id = any(
          public.corporate_partner_ids_for_user(grant_before.sponsor_user_id)
        )
        and grant_before.account_id = any(
          public.corporate_partner_account_ids_for_user(grant_before.sponsor_user_id)
        )
        and not exists (
          select 1
          from public.technician_machine_assignments assignment
          left join public.reporting_machines machine on machine.id = assignment.machine_id
          where assignment.technician_grant_id = grant_before.id
            and public.technician_assignment_is_active(
              assignment.starts_at,
              assignment.expires_at,
              assignment.revoked_at,
              assignment.status
            )
            and (
              machine.id is null
              or machine.status <> 'active'
              or machine.account_id <> grant_before.account_id
              or not assignment.machine_id = any(
                public.corporate_partner_machine_ids_for_user(grant_before.sponsor_user_id)
              )
            )
        );
    elsif grant_before.sponsor_type = 'scoped_admin' then
      sponsor_is_valid := public.can_manage_scoped_admin_technician_grant(
        grant_before.sponsor_user_id,
        grant_before.id,
        null
      );
    else
      sponsor_is_valid :=
        public.has_plus_access(grant_before.sponsor_user_id)
        and exists (
          select 1
          from public.customer_account_memberships membership
          where membership.account_id = grant_before.account_id
            and membership.user_id = grant_before.sponsor_user_id
            and membership.active
            and membership.role = 'owner'
        );
    end if;

    if not sponsor_is_valid then
      skipped_grant_count := skipped_grant_count + 1;
      continue;
    end if;

    grant_changed :=
      grant_before.technician_user_id is distinct from current_user_id
      or grant_before.status = 'pending';

    if grant_changed then
      update public.technician_grants
      set
        technician_user_id = current_user_id,
        status = 'active'
      where id = grant_before.id
      returning * into grant_after;

      resolved_grant_count := resolved_grant_count + 1;
    else
      grant_after := grant_before;
    end if;

    operator_changed := false;

    if grant_after.operator_training_grant_id is not null then
      select *
      into operator_before
      from public.operator_training_grants operator_grant
      where operator_grant.id = grant_after.operator_training_grant_id
        and operator_grant.revoked_at is null
        and operator_grant.sponsor_user_id = grant_after.sponsor_user_id
        and public.normalize_technician_email(operator_grant.operator_email) = normalized_email
      limit 1
      for update;

      if operator_before.id is not null
        and operator_before.operator_user_id is distinct from current_user_id then
        update public.operator_training_grants
        set operator_user_id = current_user_id
        where id = operator_before.id
        returning * into operator_after;

        operator_changed := true;
        resolved_operator_grant_count := resolved_operator_grant_count + 1;

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
          'operator_training.resolved',
          'operator_training_grant',
          operator_after.id::text,
          current_user_id,
          to_jsonb(operator_before),
          to_jsonb(operator_after),
          jsonb_build_object(
            'automation', true,
            'reason', normalized_reason,
            'operator_email', normalized_email,
            'sponsor_type', grant_after.sponsor_type,
            'partner_id', grant_after.partner_id,
            'source_type', 'technician_grant',
            'source_id', grant_after.id
          )
        );
      end if;
    end if;

    select coalesce(array_agg(assignment.machine_id order by assignment.machine_id), '{}'::uuid[])
    into active_machine_ids
    from public.technician_machine_assignments assignment
    join public.reporting_machines machine on machine.id = assignment.machine_id
    where assignment.technician_grant_id = grant_after.id
      and machine.status = 'active'
      and machine.account_id = grant_after.account_id
      and public.technician_assignment_is_active(
        assignment.starts_at,
        assignment.expires_at,
        assignment.revoked_at,
        assignment.status
      );

    insert into public.reporting_machine_entitlements (
      user_id,
      account_id,
      location_id,
      machine_id,
      access_level,
      starts_at,
      expires_at,
      grant_reason,
      granted_by,
      revoked_at,
      revoked_by,
      revoke_reason,
      source_type,
      source_id
    )
    select
      current_user_id,
      null,
      null,
      assignment.machine_id,
      'viewer',
      assignment.starts_at,
      assignment.expires_at,
      assignment.grant_reason,
      coalesce(
        assignment.granted_by_user_id,
        grant_after.granted_by_user_id,
        grant_after.sponsor_user_id
      ),
      null,
      null,
      null,
      'technician_grant',
      grant_after.id
    from public.technician_machine_assignments assignment
    join public.reporting_machines machine on machine.id = assignment.machine_id
    where assignment.technician_grant_id = grant_after.id
      and machine.status = 'active'
      and machine.account_id = grant_after.account_id
      and public.technician_assignment_is_active(
        assignment.starts_at,
        assignment.expires_at,
        assignment.revoked_at,
        assignment.status
      )
    on conflict (source_type, source_id, machine_id)
      where source_type = 'technician_grant'
        and revoked_at is null
    do update
    set
      user_id = excluded.user_id,
      account_id = null,
      location_id = null,
      access_level = 'viewer',
      starts_at = excluded.starts_at,
      expires_at = excluded.expires_at,
      grant_reason = excluded.grant_reason,
      granted_by = excluded.granted_by,
      revoked_at = null,
      revoked_by = null,
      revoke_reason = null
    where reporting_machine_entitlements.user_id is distinct from excluded.user_id
      or reporting_machine_entitlements.account_id is not null
      or reporting_machine_entitlements.location_id is not null
      or reporting_machine_entitlements.access_level <> 'viewer'
      or reporting_machine_entitlements.starts_at is distinct from excluded.starts_at
      or reporting_machine_entitlements.expires_at is distinct from excluded.expires_at
      or reporting_machine_entitlements.grant_reason is distinct from excluded.grant_reason
      or reporting_machine_entitlements.granted_by is distinct from excluded.granted_by
      or reporting_machine_entitlements.revoked_at is not null
      or reporting_machine_entitlements.revoked_by is not null
      or reporting_machine_entitlements.revoke_reason is not null;

    get diagnostics entitlement_rows_changed = row_count;
    upserted_reporting_entitlement_count :=
      upserted_reporting_entitlement_count + entitlement_rows_changed;

    if grant_changed or operator_changed or entitlement_rows_changed > 0 then
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
        'technician_access.resolved',
        'technician_grant',
        grant_after.id::text,
        current_user_id,
        to_jsonb(grant_before),
        to_jsonb(grant_after),
        jsonb_build_object(
          'automation', true,
          'reason', normalized_reason,
          'account_id', grant_after.account_id,
          'partner_id', grant_after.partner_id,
          'sponsor_type', grant_after.sponsor_type,
          'sponsor_user_id', grant_after.sponsor_user_id,
          'technician_email', normalized_email,
          'technician_user_id', current_user_id,
          'operator_training_grant_id', grant_after.operator_training_grant_id,
          'operator_training_resolved', operator_changed,
          'reporting_entitlements_upserted', entitlement_rows_changed,
          'machine_ids', active_machine_ids,
          'source_type', 'technician_grant',
          'source_id', grant_after.id
        )
      );
    end if;
  end loop;

  return jsonb_build_object(
    'technicianEmail', normalized_email,
    'resolvedGrantCount', resolved_grant_count,
    'resolvedOperatorTrainingGrantCount', resolved_operator_grant_count,
    'upsertedReportingEntitlementCount', upserted_reporting_entitlement_count,
    'skippedGrantCount', skipped_grant_count
  );
end;
$$;

comment on function public.resolve_my_technician_entitlements(text) is
  'Links pending Technician email grants for valid Plus, Corporate Partner, Super Admin, or Scoped Admin sponsors and materializes Technician reporting entitlements.';

revoke execute on function public.resolve_my_technician_entitlements(text) from public;
grant execute on function public.resolve_my_technician_entitlements(text) to authenticated;

select pg_notify('pgrst', 'reload schema');
