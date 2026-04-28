-- Scoped-admin reporting visibility repair for issue #259.
--
-- The initial scoped-admin migration created machine-scoped internal admin
-- authority, but the portal reporting resolver still only recognized
-- super-admins, account memberships, and explicit reporting entitlements.
-- Keep scoped admin distinct from report_manager while allowing scoped admins
-- to view reports for the same machines they can administer.

create or replace function public.has_reporting_machine_access(
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
    and (
      public.is_super_admin(p_user_id)
      or p_machine_id = any(public.scoped_admin_machine_ids(p_user_id))
      or exists (
        select 1
        from public.reporting_machines machine
        where machine.id = p_machine_id
          and public.is_reporting_account_member(p_user_id, machine.account_id)
      )
      or exists (
        select 1
        from public.reporting_machines machine
        join public.reporting_machine_entitlements entitlement
          on entitlement.user_id = p_user_id
        where machine.id = p_machine_id
          and public.reporting_entitlement_is_active(
            entitlement.starts_at,
            entitlement.expires_at,
            entitlement.revoked_at
          )
          and (
            entitlement.machine_id = machine.id
            or entitlement.location_id = machine.location_id
            or entitlement.account_id = machine.account_id
          )
      )
    );
$$;

create or replace function public.get_my_reporting_access_context()
returns table (
  has_reporting_access boolean,
  accessible_machine_count bigint,
  accessible_location_count bigint,
  can_manage_reporting boolean,
  latest_sale_date date,
  latest_import_completed_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  current_user_id uuid;
  current_scoped_machine_ids uuid[];
begin
  current_user_id := auth.uid();

  if current_user_id is null then
    raise exception 'Authentication required';
  end if;

  current_scoped_machine_ids := public.scoped_admin_machine_ids(current_user_id);

  return query
  with accessible_machines as (
    select machine.id, machine.location_id
    from public.reporting_machines machine
    where public.has_reporting_machine_access(current_user_id, machine.id)
  )
  select
    exists (select 1 from accessible_machines) as has_reporting_access,
    (select count(*) from accessible_machines)::bigint as accessible_machine_count,
    (select count(distinct location_id) from accessible_machines)::bigint
      as accessible_location_count,
    (
      public.is_super_admin(current_user_id)
      or coalesce(array_length(current_scoped_machine_ids, 1), 0) > 0
    ) as can_manage_reporting,
    (
      select max(fact.sale_date)
      from public.machine_sales_facts fact
      join accessible_machines machine on machine.id = fact.reporting_machine_id
    ) as latest_sale_date,
    (
      select max(run.completed_at)
      from public.sales_import_runs run
      where run.status = 'completed'
    ) as latest_import_completed_at;
end;
$$;

revoke execute on function public.has_reporting_machine_access(uuid, uuid)
  from public, anon;
revoke execute on function public.get_my_reporting_access_context()
  from public, anon;
grant execute on function public.get_my_reporting_access_context()
  to authenticated;

do $$
declare
  adam_user_id uuid;
  adam_grant_id uuid;
  adam_machine_id uuid;
  adam_machine_count integer := 0;
  bootstrap_reason text := 'P0 scoped-admin reporting visibility repair for issue #259';
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
      'admin_scoped_access.bootstrap_repair_skipped',
      'admin_scoped_access_grant',
      jsonb_build_object(
        'target_email',
        'adam@bloomjoysweets.com',
        'reason',
        'No auth.users row existed when repair migration ran',
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
      'admin_scoped_access.bootstrap_repair_skipped',
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
      expires_at = null,
      grant_reason = bootstrap_reason
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
    set grant_reason = excluded.grant_reason;
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
    'admin_scoped_access.bootstrap_repaired',
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
end $$;

select pg_notify('pgrst', 'reload schema');
