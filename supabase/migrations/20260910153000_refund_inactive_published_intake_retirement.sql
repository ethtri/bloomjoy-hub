-- #1293: retire the one provider-active inventory row whose mapped reporting
-- machine is inactive but whose refund intake and payment flags remained on.
-- Existing cases, provider identities, manager assignments, and payments are
-- retained. Rollback requires a reviewed reporting-machine reactivation first.

create function public.reconcile_inactive_published_refund_intake()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_machine public.reporting_machines%rowtype;
  target_inventory public.refund_nayax_machine_inventory%rowtype;
  machine_count integer;
  inventory_count integer;
  before_state jsonb;
  after_state jsonb;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('inactive_published_refund_intake_retirement_v1')
  );

  select count(*)::integer into machine_count
  from public.reporting_machines
  where id = 'a4d61df8-9f6d-4022-be00-b6e94113d302'::uuid;

  select count(*)::integer into inventory_count
  from public.refund_nayax_machine_inventory
  where reporting_machine_id = 'a4d61df8-9f6d-4022-be00-b6e94113d302'::uuid;

  if machine_count = 0 and inventory_count = 0 then
    return pg_catalog.jsonb_build_object('skipped', true);
  end if;

  if machine_count <> 1 or inventory_count <> 1 then
    raise exception 'Reviewed inactive refund route must resolve to one reporting and inventory row';
  end if;

  select * into target_machine
  from public.reporting_machines
  where id = 'a4d61df8-9f6d-4022-be00-b6e94113d302'::uuid
  for update;

  select * into target_inventory
  from public.refund_nayax_machine_inventory
  where reporting_machine_id = target_machine.id
  for update;

  if target_machine.status = 'inactive'
    and target_machine.refund_intake_enabled is false
    and target_machine.nayax_refunds_enabled is false
    and target_machine.nayax_refunds_disabled_reason = 'machine_maintenance'
    and target_inventory.reconciliation_state = 'excluded'
    and target_inventory.setup_reason = 'inactive_reporting_machine'
    and target_inventory.exclusion_reason is not null
    and not exists (
      select 1 from public.public_refund_machine_options() option
      where option.machine_id = target_machine.id
    ) then
    return pg_catalog.jsonb_build_object('skipped', false, 'alreadyApplied', true);
  end if;

  if target_machine.status is distinct from 'inactive'
    or target_machine.refund_intake_enabled is distinct from true
    or target_machine.nayax_refunds_enabled is distinct from true
    or target_inventory.machine_name is distinct from 'SnapCase Gilroy'
    or target_inventory.provider_is_active is distinct from true
    or target_inventory.missing_successful_snapshots <> 0
    or target_inventory.refund_category is distinct from 'snapcase'
    or target_inventory.reconciliation_state is distinct from 'published'
    or exists (
      select 1 from public.public_refund_machine_options() option
      where option.machine_id = target_machine.id
    ) then
    raise exception 'Reviewed inactive refund route changed before retirement';
  end if;

  before_state := pg_catalog.jsonb_build_object(
    'inventory', pg_catalog.to_jsonb(target_inventory),
    'machine', pg_catalog.to_jsonb(target_machine)
  );

  update public.reporting_machines
  set refund_intake_enabled = false,
      nayax_refunds_enabled = false,
      nayax_refunds_disabled_reason = 'machine_maintenance',
      updated_at = pg_catalog.statement_timestamp()
  where id = target_machine.id;

  update public.refund_nayax_machine_inventory
  set reconciliation_state = 'excluded',
      setup_reason = 'inactive_reporting_machine',
      exclusion_reason = 'Mapped reporting machine is inactive; public refund intake and payment execution are retired (#1293).',
      decision_reason = 'Reconciled the stale published inventory row after authoritative reporting status was inactive (#1293).',
      decided_by = null,
      decided_at = pg_catalog.statement_timestamp(),
      updated_at = pg_catalog.statement_timestamp()
  where id = target_inventory.id;

  if exists (
      select 1 from public.reporting_machines
      where id = target_machine.id
        and (
          status <> 'inactive'
          or refund_intake_enabled
          or nayax_refunds_enabled
          or nayax_refunds_disabled_reason is distinct from 'machine_maintenance'
        )
    )
    or exists (
      select 1 from public.refund_nayax_machine_inventory
      where id = target_inventory.id
        and (
          reconciliation_state <> 'excluded'
          or setup_reason <> 'inactive_reporting_machine'
          or reporting_machine_id is distinct from target_machine.id
        )
    )
    or exists (
      select 1 from public.public_refund_machine_options() option
      where option.machine_id = target_machine.id
    ) then
    raise exception 'Inactive refund route retirement did not reach its closed state';
  end if;

  select pg_catalog.jsonb_build_object(
    'inventory', pg_catalog.to_jsonb(inventory),
    'machine', pg_catalog.to_jsonb(machine)
  ) into after_state
  from public.refund_nayax_machine_inventory inventory
  join public.reporting_machines machine on machine.id = inventory.reporting_machine_id
  where inventory.id = target_inventory.id;

  insert into public.admin_audit_log (
    actor_user_id,
    action,
    entity_type,
    entity_id,
    before,
    after,
    meta
  ) values (
    null,
    'refund_nayax_inventory.inactive_published_route_retired',
    'refund_nayax_machine_inventory',
    target_inventory.id::text,
    before_state,
    after_state,
    pg_catalog.jsonb_build_object(
      'issue', 1293,
      'caseMutation', false,
      'managerAssignmentsChanged', false,
      'providerActionTaken', false,
      'customerContact', false
    )
  );

  return pg_catalog.jsonb_build_object('skipped', false, 'alreadyApplied', false);
end;
$$;

revoke all on function public.reconcile_inactive_published_refund_intake()
  from public, anon, authenticated, service_role;

select public.reconcile_inactive_published_refund_intake();

comment on function public.reconcile_inactive_published_refund_intake() is
  'One-time fail-closed #1293 repair. Retains cases and provider identity while retiring stale public intake and payment flags.';
