-- Keep inventory synchronization lintable without changing its durable behavior.
-- plpgsql_check resolves relations before this function can create its session-local
-- temporary table, so parse the already-validated JSON snapshot inline instead.
create or replace function public.service_sync_refund_nayax_inventory(
  p_run_key text,
  p_account_key text,
  p_snapshot jsonb default '[]'::jsonb,
  p_succeeded boolean default true,
  p_error_code text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_run_key text := nullif(btrim(coalesce(p_run_key, '')), '');
  normalized_account_key text := upper(regexp_replace(btrim(coalesce(p_account_key, '')), '[^A-Za-z0-9_]+', '_', 'g'));
  snapshot_count integer := 0;
  snapshot_active_count integer := 0;
  prior_active_count integer;
  needs_setup_count integer := 0;
  published_count integer := 0;
  excluded_count integer := 0;
  duplicate_count integer := 0;
  run_result jsonb;
begin
  if normalized_run_key is null or length(normalized_run_key) > 160 then
    raise exception 'A valid inventory run key is required';
  end if;
  if normalized_account_key is null or normalized_account_key = '' or length(normalized_account_key) > 80 then
    raise exception 'A valid Nayax account key is required';
  end if;

  -- Preserve account-level serialization so concurrent manual/scheduled runs cannot
  -- advance absence counters out of order.
  perform pg_advisory_xact_lock(hashtextextended('refund_nayax_inventory:' || normalized_account_key, 0));

  select jsonb_build_object(
    'status', existing.status,
    'accountKey', existing.account_key,
    'discoveredCount', existing.discovered_count,
    'activeCount', existing.active_count,
    'needsSetupCount', existing.needs_setup_count,
    'publishedCount', existing.published_count,
    'excludedCount', existing.excluded_count,
    'largeDrop', existing.large_drop_detected,
    'replayed', true
  )
  into run_result
  from public.refund_nayax_inventory_runs existing
  where existing.run_key = normalized_run_key;

  if run_result is not null then
    return run_result;
  end if;

  select run.active_count
  into prior_active_count
  from public.refund_nayax_inventory_runs run
  where run.account_key = normalized_account_key
    and run.status = 'completed'
  order by run.completed_at desc
  limit 1;

  if not coalesce(p_succeeded, false) then
    insert into public.refund_nayax_inventory_runs (
      run_key, account_key, status, previous_active_count, error_code
    ) values (
      normalized_run_key,
      normalized_account_key,
      'failed',
      prior_active_count,
      left(nullif(btrim(coalesce(p_error_code, 'sync_failed')), ''), 120)
    );
    return jsonb_build_object(
      'status', 'failed',
      'accountKey', normalized_account_key,
      'discoveredCount', 0,
      'activeCount', 0,
      'needsSetupCount', 0,
      'publishedCount', 0,
      'excludedCount', 0,
      'replayed', false
    );
  end if;

  if jsonb_typeof(coalesce(p_snapshot, '[]'::jsonb)) <> 'array' then
    raise exception 'Nayax inventory snapshot must be a JSON array';
  end if;
  if jsonb_array_length(coalesce(p_snapshot, '[]'::jsonb)) = 0 then
    raise exception 'A complete Nayax inventory snapshot cannot be empty';
  end if;

  select count(*) - count(distinct nullif(left(btrim(item->>'machineId'), 160), ''))
  into duplicate_count
  from jsonb_array_elements(coalesce(p_snapshot, '[]'::jsonb)) item;

  if duplicate_count > 0 then
    raise exception 'Nayax inventory snapshot contains duplicate or missing immutable machine IDs';
  end if;

  select
    count(*),
    count(*) filter (where coalesce((item->>'active')::boolean, false))
  into snapshot_count, snapshot_active_count
  from jsonb_array_elements(coalesce(p_snapshot, '[]'::jsonb)) item;

  insert into public.refund_nayax_machine_inventory (
    account_key,
    nayax_machine_id,
    machine_name,
    machine_number,
    nayax_machine_type_id,
    provider_status_bit,
    provider_is_active,
    reporting_machine_id,
    refund_category,
    reconciliation_state,
    setup_reason
  )
  select
    normalized_account_key,
    stage.nayax_machine_id,
    stage.machine_name,
    stage.machine_number,
    stage.nayax_machine_type_id,
    stage.provider_status_bit,
    stage.provider_is_active,
    reporting.id,
    case when reporting.machine_type in ('commercial', 'mini', 'micro') then 'cotton_candy' else null end,
    case
      when not stage.provider_is_active then 'needs_setup'
      when reporting.id is not null
        and reporting.machine_type in ('commercial', 'mini', 'micro')
        and coalesce(reporting.refund_intake_enabled, false)
        and nullif(btrim(coalesce(reporting.refund_public_display_label, '')), '') is not null
        and exists (
          select 1 from public.reporting_machine_refund_managers manager
          where manager.reporting_machine_id = reporting.id
            and manager.status = 'active' and manager.revoked_at is null
        )
      then 'published'
      else 'needs_setup'
    end,
    case
      when not stage.provider_is_active then 'provider_inactive'
      when reporting.id is null then 'exact_mapping_required'
      when nullif(btrim(coalesce(reporting.refund_public_display_label, '')), '') is null then 'customer_label_required'
      when not exists (
        select 1 from public.reporting_machine_refund_managers manager
        where manager.reporting_machine_id = reporting.id
          and manager.status = 'active' and manager.revoked_at is null
      ) then 'manager_route_required'
      when not coalesce(reporting.refund_intake_enabled, false) then 'refund_automation_not_enabled'
      else 'ready'
    end
  from (
    select
      left(btrim(item->>'machineId'), 160) as nayax_machine_id,
      nullif(left(btrim(item->>'machineName'), 240), '') as machine_name,
      nullif(left(btrim(item->>'machineNumber'), 160), '') as machine_number,
      nullif(left(btrim(item->>'machineTypeId'), 120), '') as nayax_machine_type_id,
      case when (item->>'statusBit') ~ '^-?[0-9]+$' then (item->>'statusBit')::integer else null end as provider_status_bit,
      coalesce((item->>'active')::boolean, false) as provider_is_active
    from jsonb_array_elements(coalesce(p_snapshot, '[]'::jsonb)) item
  ) stage
  left join public.reporting_machines reporting
    on upper(coalesce(reporting.nayax_account_key, 'TGPACI_USA_DB')) = normalized_account_key
   and btrim(coalesce(reporting.nayax_machine_id, '')) = stage.nayax_machine_id
  on conflict (account_key, nayax_machine_id) do update set
    machine_name = excluded.machine_name,
    machine_number = excluded.machine_number,
    nayax_machine_type_id = excluded.nayax_machine_type_id,
    provider_status_bit = excluded.provider_status_bit,
    provider_is_active = case
      when excluded.provider_is_active then true
      when public.refund_nayax_machine_inventory.provider_is_active
        and public.refund_nayax_machine_inventory.missing_successful_snapshots < 1
      then true
      else false
    end,
    last_seen_at = now(),
    last_successful_sync_at = now(),
    missing_successful_snapshots = case
      when excluded.provider_is_active then 0
      when public.refund_nayax_machine_inventory.provider_is_active
        or public.refund_nayax_machine_inventory.missing_successful_snapshots > 0
      then public.refund_nayax_machine_inventory.missing_successful_snapshots + 1
      else 0
    end,
    reporting_machine_id = coalesce(public.refund_nayax_machine_inventory.reporting_machine_id, excluded.reporting_machine_id),
    refund_category = coalesce(public.refund_nayax_machine_inventory.refund_category, excluded.refund_category),
    reconciliation_state = case
      when public.refund_nayax_machine_inventory.reconciliation_state = 'excluded'
        then 'excluded'
      when not excluded.provider_is_active
        and public.refund_nayax_machine_inventory.provider_is_active
        and public.refund_nayax_machine_inventory.missing_successful_snapshots < 1
      then public.refund_nayax_machine_inventory.reconciliation_state
      when not excluded.provider_is_active then 'needs_setup'
      when public.refund_nayax_machine_inventory.reconciliation_state = 'published'
        then 'published'
      else excluded.reconciliation_state
    end,
    setup_reason = case
      when public.refund_nayax_machine_inventory.reconciliation_state = 'excluded'
        then public.refund_nayax_machine_inventory.setup_reason
      when not excluded.provider_is_active
        and public.refund_nayax_machine_inventory.provider_is_active
        and public.refund_nayax_machine_inventory.missing_successful_snapshots < 1
      then public.refund_nayax_machine_inventory.setup_reason
      else excluded.setup_reason
    end,
    updated_at = now();

  -- Absence only counts after a complete successful snapshot. Two misses are required
  -- before an existing row becomes inactive; failures never enter this path.
  update public.refund_nayax_machine_inventory inventory
  set
    missing_successful_snapshots = inventory.missing_successful_snapshots + 1,
    provider_is_active = case
      when inventory.missing_successful_snapshots + 1 >= 2 then false
      else inventory.provider_is_active
    end,
    reconciliation_state = case
      when inventory.missing_successful_snapshots + 1 >= 2
        and inventory.reconciliation_state = 'published'
      then 'needs_setup'
      else inventory.reconciliation_state
    end,
    setup_reason = case
      when inventory.missing_successful_snapshots + 1 >= 2 then 'missing_from_two_successful_snapshots'
      else inventory.setup_reason
    end,
    last_successful_sync_at = now(),
    updated_at = now()
  where inventory.account_key = normalized_account_key
    and not exists (
      select 1
      from jsonb_array_elements(coalesce(p_snapshot, '[]'::jsonb)) item
      where left(btrim(item->>'machineId'), 160) = inventory.nayax_machine_id
    );

  select
    count(*) filter (where provider_is_active and reconciliation_state = 'needs_setup'),
    count(*) filter (where provider_is_active and reconciliation_state = 'published'),
    count(*) filter (where provider_is_active and reconciliation_state = 'excluded')
  into needs_setup_count, published_count, excluded_count
  from public.refund_nayax_machine_inventory
  where account_key = normalized_account_key;

  insert into public.refund_nayax_inventory_runs (
    run_key, account_key, status, discovered_count, active_count, previous_active_count,
    needs_setup_count, published_count, excluded_count, large_drop_detected
  ) values (
    normalized_run_key, normalized_account_key, 'completed', snapshot_count,
    snapshot_active_count, prior_active_count, needs_setup_count, published_count, excluded_count,
    prior_active_count is not null and prior_active_count >= 5
      and snapshot_active_count < ceil(prior_active_count * 0.8)
  );

  return jsonb_build_object(
    'status', 'completed',
    'accountKey', normalized_account_key,
    'discoveredCount', snapshot_count,
    'activeCount', snapshot_active_count,
    'needsSetupCount', needs_setup_count,
    'publishedCount', published_count,
    'excludedCount', excluded_count,
    'largeDrop', prior_active_count is not null
      and prior_active_count >= 5
      and snapshot_active_count < ceil(prior_active_count * 0.8),
    'replayed', false
  );
end;
$$;

revoke execute on function public.service_sync_refund_nayax_inventory(text, text, jsonb, boolean, text)
  from public, anon, authenticated;
grant execute on function public.service_sync_refund_nayax_inventory(text, text, jsonb, boolean, text)
  to service_role;
