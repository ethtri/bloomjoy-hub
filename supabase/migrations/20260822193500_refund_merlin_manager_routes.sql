-- Restore an actionable manager route for the three customer-visible Merlin
-- machines added to portfolio-wide refund intake.
--
-- The repair does not invent a new principal. It copies the exact two active
-- managers who are already common to the three established Merlin refund
-- machines. Any source, target, identity, or public-intake drift aborts the
-- whole transaction before a mapping is added.

create or replace function public.owner_repair_refund_merlin_manager_routes()
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  target_machine_count integer;
  public_target_count integer;
  source_machine_count integer;
  source_mapping_count integer;
  source_manager_count integer;
  valid_source_manager_count integer;
  unexpected_target_mapping_count integer;
  inserted_mapping_count integer := 0;
  final_mapping_count integer;
  machine_record record;
begin
  perform pg_advisory_xact_lock(hashtext('refund_merlin_manager_routes_v1'));

  select count(*)::integer
  into target_machine_count
  from public.reporting_machines machine
  join public.customer_accounts account on account.id = machine.account_id
  where lower(trim(account.name)) = lower('Merlin Entertainments')
    and machine.machine_label in (
      'Madame Tussauds Vegas',
      'PEPPA PIG Theme Park Dallas-Fort Worth',
      'SEA LIFE Grapevine'
    );

  -- Fresh disposable installs contain only the three original Merlin rows.
  -- Production has the three reconciled target rows and must pass every
  -- strict assertion below.
  if target_machine_count = 0 then
    return jsonb_build_object(
      'skipped', true,
      'targetMachineCount', 0,
      'insertedMappingCount', 0
    );
  end if;

  if target_machine_count <> 3 then
    raise exception 'Expected exactly three Merlin refund route targets';
  end if;

  for machine_record in
    select machine.id
    from public.reporting_machines machine
    join public.customer_accounts account on account.id = machine.account_id
    where lower(trim(account.name)) = lower('Merlin Entertainments')
      and machine.machine_label in (
        'Merlin Chicago',
        'Merlin Dallas',
        'Merlin Minneapolis',
        'Madame Tussauds Vegas',
        'PEPPA PIG Theme Park Dallas-Fort Worth',
        'SEA LIFE Grapevine'
      )
    order by machine.id
  loop
    perform pg_advisory_xact_lock(hashtext('machine_manager:' || machine_record.id::text));
    perform 1
    from public.reporting_machines machine
    where machine.id = machine_record.id
    for update;
  end loop;

  select count(*)::integer
  into public_target_count
  from public.reporting_machines machine
  join public.reporting_locations location on location.id = machine.location_id
  join public.customer_accounts account on account.id = machine.account_id
  where lower(trim(account.name)) = lower('Merlin Entertainments')
    and machine.status = 'active'
    and location.status = 'active'
    and machine.machine_label in (
      'Madame Tussauds Vegas',
      'PEPPA PIG Theme Park Dallas-Fort Worth',
      'SEA LIFE Grapevine'
    )
    and public.service_refund_machine_is_public(machine.id);

  if public_target_count <> 3 then
    raise exception 'Every Merlin refund route target must be active and public';
  end if;

  select count(*)::integer
  into source_machine_count
  from public.reporting_machines machine
  join public.customer_accounts account on account.id = machine.account_id
  where lower(trim(account.name)) = lower('Merlin Entertainments')
    and machine.status = 'active'
    and machine.machine_label in ('Merlin Chicago', 'Merlin Dallas', 'Merlin Minneapolis');

  if source_machine_count <> 3 then
    raise exception 'Expected exactly three established Merlin refund route sources';
  end if;

  select
    count(*)::integer,
    count(distinct manager.manager_user_id)::integer
  into source_mapping_count, source_manager_count
  from public.reporting_machine_refund_managers manager
  join public.reporting_machines machine on machine.id = manager.reporting_machine_id
  join public.customer_accounts account on account.id = machine.account_id
  where lower(trim(account.name)) = lower('Merlin Entertainments')
    and machine.machine_label in ('Merlin Chicago', 'Merlin Dallas', 'Merlin Minneapolis')
    and manager.status = 'active'
    and manager.revoked_at is null;

  if source_mapping_count <> 6 or source_manager_count <> 2 then
    raise exception 'Established Merlin machines must share exactly two active refund managers';
  end if;

  select count(*)::integer
  into valid_source_manager_count
  from (
    select manager.manager_user_id
    from public.reporting_machine_refund_managers manager
    join public.reporting_machines machine on machine.id = manager.reporting_machine_id
    join public.customer_accounts account on account.id = machine.account_id
    join auth.users auth_user on auth_user.id = manager.manager_user_id
    where lower(trim(account.name)) = lower('Merlin Entertainments')
      and machine.machine_label in ('Merlin Chicago', 'Merlin Dallas', 'Merlin Minneapolis')
      and manager.status = 'active'
      and manager.revoked_at is null
      and lower(trim(manager.manager_email)) = lower(trim(auth_user.email))
    group by manager.manager_user_id
    having count(distinct machine.id) = 3
      and count(distinct lower(trim(manager.manager_email))) = 1
  ) valid_manager;

  if valid_source_manager_count <> 2 then
    raise exception 'Established Merlin manager identities or emails are inconsistent';
  end if;

  select count(*)::integer
  into unexpected_target_mapping_count
  from public.reporting_machine_refund_managers target_manager
  join public.reporting_machines target_machine
    on target_machine.id = target_manager.reporting_machine_id
  join public.customer_accounts target_account on target_account.id = target_machine.account_id
  where lower(trim(target_account.name)) = lower('Merlin Entertainments')
    and target_machine.machine_label in (
      'Madame Tussauds Vegas',
      'PEPPA PIG Theme Park Dallas-Fort Worth',
      'SEA LIFE Grapevine'
    )
    and target_manager.status = 'active'
    and target_manager.revoked_at is null
    and not exists (
      select 1
      from public.reporting_machine_refund_managers source_manager
      join public.reporting_machines source_machine
        on source_machine.id = source_manager.reporting_machine_id
      join public.customer_accounts source_account on source_account.id = source_machine.account_id
      where lower(trim(source_account.name)) = lower('Merlin Entertainments')
        and source_machine.machine_label in ('Merlin Chicago', 'Merlin Dallas', 'Merlin Minneapolis')
        and source_manager.status = 'active'
        and source_manager.revoked_at is null
        and source_manager.manager_user_id = target_manager.manager_user_id
      group by source_manager.manager_user_id
      having count(distinct source_machine.id) = 3
    );

  if unexpected_target_mapping_count <> 0 then
    raise exception 'A Merlin refund route target has an unexpected active manager';
  end if;

  insert into public.reporting_machine_refund_managers (
    reporting_machine_id,
    manager_user_id,
    manager_email,
    status,
    grant_reason,
    granted_by
  )
  select
    target_machine.id,
    source_manager.manager_user_id,
    min(lower(trim(source_manager.manager_email))),
    'active',
    'Production route repair: established Merlin refund managers (#911)',
    null
  from public.reporting_machines target_machine
  join public.customer_accounts target_account on target_account.id = target_machine.account_id
  cross join public.reporting_machine_refund_managers source_manager
  join public.reporting_machines source_machine
    on source_machine.id = source_manager.reporting_machine_id
  join public.customer_accounts source_account on source_account.id = source_machine.account_id
  where lower(trim(target_account.name)) = lower('Merlin Entertainments')
    and target_machine.machine_label in (
      'Madame Tussauds Vegas',
      'PEPPA PIG Theme Park Dallas-Fort Worth',
      'SEA LIFE Grapevine'
    )
    and lower(trim(source_account.name)) = lower('Merlin Entertainments')
    and source_machine.machine_label in ('Merlin Chicago', 'Merlin Dallas', 'Merlin Minneapolis')
    and source_manager.status = 'active'
    and source_manager.revoked_at is null
    and not exists (
      select 1
      from public.reporting_machine_refund_managers existing_manager
      where existing_manager.reporting_machine_id = target_machine.id
        and existing_manager.manager_user_id = source_manager.manager_user_id
        and existing_manager.status = 'active'
        and existing_manager.revoked_at is null
    )
  group by target_machine.id, source_manager.manager_user_id
  having count(distinct source_machine.id) = 3;

  get diagnostics inserted_mapping_count = row_count;

  select count(*)::integer
  into final_mapping_count
  from public.reporting_machine_refund_managers manager
  join public.reporting_machines machine on machine.id = manager.reporting_machine_id
  join public.customer_accounts account on account.id = machine.account_id
  where lower(trim(account.name)) = lower('Merlin Entertainments')
    and machine.machine_label in (
      'Madame Tussauds Vegas',
      'PEPPA PIG Theme Park Dallas-Fort Worth',
      'SEA LIFE Grapevine'
    )
    and manager.status = 'active'
    and manager.revoked_at is null;

  if final_mapping_count <> 6 then
    raise exception 'Merlin refund route repair did not end with six exact active mappings';
  end if;

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
    'reporting_machine_refund_managers.production_route_repair',
    'reporting_machine_portfolio',
    'merlin-refund-route-v1',
    jsonb_build_object(
      'targetMachineCount', target_machine_count,
      'sourceManagerCount', source_manager_count
    ),
    jsonb_build_object(
      'activeTargetMappingCount', final_mapping_count,
      'insertedMappingCount', inserted_mapping_count
    ),
    jsonb_build_object(
      'issue', 911,
      'identityDataIncluded', false,
      'officialAction', false,
      'customerContact', false
    )
  );

  return jsonb_build_object(
    'skipped', false,
    'targetMachineCount', target_machine_count,
    'sourceManagerCount', source_manager_count,
    'insertedMappingCount', inserted_mapping_count,
    'activeTargetMappingCount', final_mapping_count
  );
end;
$$;

revoke all on function public.owner_repair_refund_merlin_manager_routes()
  from public, anon, authenticated, service_role;

select public.owner_repair_refund_merlin_manager_routes();

comment on function public.owner_repair_refund_merlin_manager_routes() is
  'Database-owner-only, exact-set, idempotent repair for issue #911. Copies the established two-manager Merlin refund route to three reviewed public targets and fails closed on any drift.';
