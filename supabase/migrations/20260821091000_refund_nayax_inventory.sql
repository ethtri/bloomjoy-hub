-- Refund Operations v1: server-only Nayax inventory and explicit refund eligibility.
-- This inventory is independent of Sunze/reporting ingestion. A machine becomes public
-- only after an exact immutable-ID link, customer-safe label, manager route, and an
-- explicit category decision. Missing machines are retained until two complete snapshots.

create table if not exists public.refund_nayax_inventory_runs (
  id uuid primary key default gen_random_uuid(),
  run_key text not null unique,
  account_key text not null,
  status text not null check (status in ('completed', 'failed')),
  discovered_count integer not null default 0 check (discovered_count >= 0),
  active_count integer not null default 0 check (active_count >= 0),
  previous_active_count integer,
  needs_setup_count integer not null default 0 check (needs_setup_count >= 0),
  published_count integer not null default 0 check (published_count >= 0),
  excluded_count integer not null default 0 check (excluded_count >= 0),
  large_drop_detected boolean not null default false,
  error_code text,
  started_at timestamptz not null default now(),
  completed_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.refund_nayax_machine_inventory (
  id uuid primary key default gen_random_uuid(),
  account_key text not null,
  nayax_machine_id text not null,
  machine_name text,
  machine_number text,
  nayax_machine_type_id text,
  provider_status_bit integer,
  provider_is_active boolean not null default false,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  last_successful_sync_at timestamptz not null default now(),
  missing_successful_snapshots integer not null default 0 check (missing_successful_snapshots >= 0),
  refund_category text check (refund_category in ('cotton_candy', 'snapcase')),
  reporting_machine_id uuid references public.reporting_machines(id) on delete set null,
  reconciliation_state text not null default 'needs_setup'
    check (reconciliation_state in ('published', 'needs_setup', 'excluded')),
  setup_reason text not null default 'exact_mapping_required',
  exclusion_reason text,
  decision_reason text,
  decided_by uuid references auth.users(id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_key, nayax_machine_id),
  constraint refund_nayax_inventory_exclusion_reason_check check (
    reconciliation_state <> 'excluded'
    or nullif(btrim(coalesce(exclusion_reason, '')), '') is not null
  ),
  constraint refund_nayax_inventory_publish_fields_check check (
    reconciliation_state <> 'published'
    or (refund_category is not null and reporting_machine_id is not null and provider_is_active)
  )
);

create unique index if not exists refund_nayax_inventory_reporting_machine_unique
  on public.refund_nayax_machine_inventory (reporting_machine_id)
  where reporting_machine_id is not null;

create index if not exists refund_nayax_inventory_operations_queue
  on public.refund_nayax_machine_inventory (provider_is_active, reconciliation_state, last_seen_at desc);

alter table public.refund_nayax_inventory_runs enable row level security;
alter table public.refund_nayax_machine_inventory enable row level security;

drop policy if exists refund_nayax_inventory_runs_super_admin_read on public.refund_nayax_inventory_runs;
create policy refund_nayax_inventory_runs_super_admin_read
on public.refund_nayax_inventory_runs for select to authenticated
using (public.is_super_admin(auth.uid()));

drop policy if exists refund_nayax_machine_inventory_admin_read on public.refund_nayax_machine_inventory;
create policy refund_nayax_machine_inventory_admin_read
on public.refund_nayax_machine_inventory for select to authenticated
using (
  public.is_super_admin(auth.uid())
  or (
    reporting_machine_id is not null
    and public.can_manage_refund_machine(auth.uid(), reporting_machine_id)
  )
);

revoke all on public.refund_nayax_inventory_runs from public, anon, authenticated;
revoke all on public.refund_nayax_machine_inventory from public, anon, authenticated;
grant select on public.refund_nayax_inventory_runs to authenticated;
grant select on public.refund_nayax_machine_inventory to authenticated;

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

  -- Serialize every successful or failed result for the same provider account so
  -- concurrent manual/scheduled runs cannot advance absence counters out of order.
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

  create temporary table if not exists refund_nayax_snapshot_stage (
    nayax_machine_id text primary key,
    machine_name text,
    machine_number text,
    nayax_machine_type_id text,
    provider_status_bit integer,
    provider_is_active boolean not null
  ) on commit drop;

  truncate table refund_nayax_snapshot_stage;

  select count(*) - count(distinct nullif(btrim(item->>'machineId'), ''))
  into duplicate_count
  from jsonb_array_elements(coalesce(p_snapshot, '[]'::jsonb)) item;

  if duplicate_count > 0 then
    raise exception 'Nayax inventory snapshot contains duplicate or missing immutable machine IDs';
  end if;

  insert into refund_nayax_snapshot_stage (
    nayax_machine_id,
    machine_name,
    machine_number,
    nayax_machine_type_id,
    provider_status_bit,
    provider_is_active
  )
  select
    left(btrim(item->>'machineId'), 160),
    nullif(left(btrim(item->>'machineName'), 240), ''),
    nullif(left(btrim(item->>'machineNumber'), 160), ''),
    nullif(left(btrim(item->>'machineTypeId'), 120), ''),
    case when (item->>'statusBit') ~ '^-?[0-9]+$' then (item->>'statusBit')::integer else null end,
    coalesce((item->>'active')::boolean, false)
  from jsonb_array_elements(coalesce(p_snapshot, '[]'::jsonb)) item;

  select count(*), count(*) filter (where provider_is_active)
  into snapshot_count, snapshot_active_count
  from refund_nayax_snapshot_stage;

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
  from refund_nayax_snapshot_stage stage
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
      select 1 from refund_nayax_snapshot_stage stage
      where stage.nayax_machine_id = inventory.nayax_machine_id
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

create or replace function public.admin_get_refund_nayax_inventory()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  actor_user_id uuid := auth.uid();
  result jsonb;
begin
  if actor_user_id is null or not (public.is_super_admin(actor_user_id) or public.is_scoped_admin(actor_user_id)) then
    raise exception 'Admin access required';
  end if;

  select jsonb_build_object(
    'summary', jsonb_build_object(
      'active', count(*) filter (where inventory.provider_is_active),
      'published', count(*) filter (where inventory.provider_is_active and inventory.reconciliation_state = 'published'),
      'needsSetup', count(*) filter (where inventory.provider_is_active and inventory.reconciliation_state = 'needs_setup'),
      'excluded', count(*) filter (where inventory.provider_is_active and inventory.reconciliation_state = 'excluded'),
      'stalePublished', count(*) filter (
        where inventory.reconciliation_state = 'published'
          and not exists (
            select 1 from public.public_refund_machine_options() option
            where option.machine_id = inventory.reporting_machine_id
          )
      )
    ),
    'lastRun', (
      select jsonb_build_object(
        'status', run.status,
        'completedAt', run.completed_at,
        'errorCode', run.error_code,
        'activeCount', run.active_count,
        'previousActiveCount', run.previous_active_count,
        'largeDrop', run.large_drop_detected
      )
      from public.refund_nayax_inventory_runs run
      order by run.completed_at desc limit 1
    ),
    'machines', coalesce(jsonb_agg(jsonb_build_object(
      'id', inventory.id,
      'accountKey', inventory.account_key,
      'nayaxMachineId', inventory.nayax_machine_id,
      'machineName', inventory.machine_name,
      'machineNumber', inventory.machine_number,
      'providerActive', inventory.provider_is_active,
      'category', inventory.refund_category,
      'reportingMachineId', inventory.reporting_machine_id,
      'state', inventory.reconciliation_state,
      'setupReason', inventory.setup_reason,
      'exclusionReason', inventory.exclusion_reason,
      'missingSuccessfulSnapshots', inventory.missing_successful_snapshots,
      'lastSeenAt', inventory.last_seen_at,
      'lastSuccessfulSyncAt', inventory.last_successful_sync_at
    ) order by
      inventory.provider_is_active desc,
      case inventory.reconciliation_state when 'needs_setup' then 0 when 'published' then 1 else 2 end,
      inventory.machine_name nulls last), '[]'::jsonb)
  )
  into result
  from public.refund_nayax_machine_inventory inventory
  where public.is_super_admin(actor_user_id)
    or (
      inventory.reporting_machine_id is not null
      and public.can_manage_refund_machine(actor_user_id, inventory.reporting_machine_id)
    );

  return result;
end;
$$;

revoke execute on function public.admin_get_refund_nayax_inventory() from public, anon;
grant execute on function public.admin_get_refund_nayax_inventory() to authenticated;

create or replace function public.admin_reconcile_refund_nayax_machine(
  p_inventory_id uuid,
  p_reconciliation_state text,
  p_refund_category text default null,
  p_reporting_machine_id uuid default null,
  p_exclusion_reason text default null,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  actor_user_id uuid := auth.uid();
  before_row public.refund_nayax_machine_inventory;
  reporting public.reporting_machines;
  normalized_state text := lower(btrim(coalesce(p_reconciliation_state, '')));
  normalized_category text := nullif(lower(btrim(coalesce(p_refund_category, ''))), '');
  normalized_exclusion text := nullif(btrim(coalesce(p_exclusion_reason, '')), '');
  normalized_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  manager_count integer := 0;
begin
  if actor_user_id is null or not public.is_super_admin(actor_user_id) then
    raise exception 'Super Admin access required';
  end if;
  if normalized_state not in ('published', 'needs_setup', 'excluded') then
    raise exception 'A valid reconciliation state is required';
  end if;
  if normalized_category is not null and normalized_category not in ('cotton_candy', 'snapcase') then
    raise exception 'Refund category must be cotton_candy or snapcase';
  end if;
  if normalized_reason is null or length(normalized_reason) < 8 then
    raise exception 'An audit reason of at least 8 characters is required';
  end if;
  if normalized_state = 'excluded' and normalized_exclusion is null then
    raise exception 'An explicit exclusion reason is required';
  end if;

  select * into before_row
  from public.refund_nayax_machine_inventory
  where id = p_inventory_id for update;
  if before_row.id is null then raise exception 'Nayax inventory machine not found'; end if;

  if p_reporting_machine_id is not null then
    select * into reporting from public.reporting_machines where id = p_reporting_machine_id;
    if reporting.id is null then raise exception 'Reporting machine not found'; end if;
    if btrim(coalesce(reporting.nayax_machine_id, '')) <> before_row.nayax_machine_id
      or upper(coalesce(reporting.nayax_account_key, 'TGPACI_USA_DB')) <> before_row.account_key then
      raise exception 'Reporting machine must use the same Nayax account and immutable machine ID';
    end if;
  end if;

  if normalized_state = 'published' then
    if not before_row.provider_is_active then raise exception 'Inactive Nayax machines cannot be published'; end if;
    if normalized_category is null then raise exception 'Refund category is required before publishing'; end if;
    if reporting.id is null then raise exception 'Exact reporting machine mapping is required before publishing'; end if;
    if reporting.status <> 'active' then raise exception 'Reporting machine must be active before publishing'; end if;
    if nullif(btrim(coalesce(reporting.refund_public_display_label, '')), '') is null then
      raise exception 'Customer-facing label is required before publishing';
    end if;
    if not exists (
      select 1 from public.reporting_locations location
      where location.id = reporting.location_id and location.status = 'active'
    ) then raise exception 'Active location is required before publishing'; end if;
    select count(*)::integer into manager_count
    from public.reporting_machine_refund_managers manager
    where manager.reporting_machine_id = reporting.id
      and manager.status = 'active' and manager.revoked_at is null;
    if manager_count < 1 or manager_count > 3 then
      raise exception 'One to three current Machine Managers are required before publishing';
    end if;
    update public.reporting_machines set refund_intake_enabled = true where id = reporting.id;
  elsif p_reporting_machine_id is not null then
    update public.reporting_machines set refund_intake_enabled = false where id = reporting.id;
  end if;

  update public.refund_nayax_machine_inventory
  set
    reconciliation_state = normalized_state,
    refund_category = normalized_category,
    reporting_machine_id = p_reporting_machine_id,
    exclusion_reason = case when normalized_state = 'excluded' then normalized_exclusion else null end,
    setup_reason = case
      when normalized_state = 'published' then 'ready'
      when normalized_state = 'excluded' then 'explicitly_excluded'
      else 'operator_setup_required'
    end,
    decision_reason = normalized_reason,
    decided_by = actor_user_id,
    decided_at = now(),
    updated_at = now()
  where id = before_row.id;

  insert into public.admin_audit_log (actor_user_id, action, entity_type, entity_id, before, after, meta)
  values (
    actor_user_id,
    'refund_nayax_inventory.reconciled',
    'refund_nayax_machine_inventory',
    before_row.id::text,
    jsonb_build_object('state', before_row.reconciliation_state, 'category', before_row.refund_category,
      'reportingMachineId', before_row.reporting_machine_id, 'hasExclusionReason', before_row.exclusion_reason is not null),
    jsonb_build_object('state', normalized_state, 'category', normalized_category,
      'reportingMachineId', p_reporting_machine_id, 'hasExclusionReason', normalized_exclusion is not null),
    jsonb_build_object('reason', normalized_reason, 'accountKey', before_row.account_key,
      'nayaxMachineId', before_row.nayax_machine_id, 'activeManagerCount', manager_count)
  );

  return jsonb_build_object('ok', true, 'inventoryId', before_row.id, 'state', normalized_state);
end;
$$;

revoke execute on function public.admin_reconcile_refund_nayax_machine(uuid, text, text, uuid, text, text)
  from public, anon;
grant execute on function public.admin_reconcile_refund_nayax_machine(uuid, text, text, uuid, text, text)
  to authenticated;

-- Public eligibility is now explicit. No reporting machine type, provider type, or
-- machine-name guess can publish an option.
create or replace function public.public_refund_machine_options()
returns table (
  machine_id uuid,
  machine_label text,
  location_id uuid,
  location_name text,
  location_timezone text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    machine.id,
    machine.refund_public_display_label,
    location.id,
    case
      when lower(trim(location.name)) like 'unmapped %'
        or lower(trim(location.name)) like 'unknown %'
        or lower(trim(location.name)) in ('unmapped', 'unknown')
      then machine.refund_public_display_label
      else location.name
    end,
    location.timezone
  from public.refund_nayax_machine_inventory inventory
  join public.reporting_machines machine
    on machine.id = inventory.reporting_machine_id
   and upper(coalesce(machine.nayax_account_key, 'TGPACI_USA_DB')) = inventory.account_key
   and btrim(coalesce(machine.nayax_machine_id, '')) = inventory.nayax_machine_id
  join public.reporting_locations location on location.id = machine.location_id
  where inventory.reconciliation_state = 'published'
    and inventory.provider_is_active
    and inventory.missing_successful_snapshots < 2
    and inventory.refund_category in ('cotton_candy', 'snapcase')
    and machine.status = 'active'
    and machine.refund_intake_enabled
    and nullif(btrim(coalesce(machine.refund_public_display_label, '')), '') is not null
    and location.status = 'active'
    and exists (
      select 1 from public.reporting_machine_refund_managers manager
      where manager.reporting_machine_id = machine.id
        and manager.status = 'active' and manager.revoked_at is null
    )
  order by location.name, machine.refund_public_display_label;
$$;

comment on function public.public_refund_machine_options() is
  'Public refund selector backed by explicit Nayax inventory reconciliation. Published cotton-candy and Snapcase machines use the same immutable-ID eligibility path.';

revoke execute on function public.public_refund_machine_options() from public;
grant execute on function public.public_refund_machine_options() to anon, authenticated;

create or replace function public.service_refund_machine_is_public(p_machine_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.public_refund_machine_options() option
    where option.machine_id = p_machine_id
  );
$$;

revoke execute on function public.service_refund_machine_is_public(uuid) from public, anon, authenticated;
grant execute on function public.service_refund_machine_is_public(uuid) to service_role;

-- Remove the legacy Commercial/Mini type ceremony. The inventory publication gate
-- is authoritative; this function remains the label/readiness editor.
create or replace function public.admin_set_reporting_machine_refund_intake_config(
  p_machine_id uuid,
  p_refund_intake_enabled boolean,
  p_refund_public_display_label text default null,
  p_reason text default 'Refund readiness updated from Admin Machines'
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  actor_user_id uuid := auth.uid();
  before_row public.reporting_machines;
  after_row public.reporting_machines;
  normalized_display_label text := nullif(btrim(coalesce(p_refund_public_display_label, '')), '');
  normalized_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  active_manager_count integer := 0;
begin
  if actor_user_id is null then raise exception 'Authentication required'; end if;
  if not (public.is_super_admin(actor_user_id) or public.is_scoped_admin(actor_user_id)) then
    raise exception 'Scoped Admin or Super Admin access required';
  end if;
  if not public.can_manage_refund_machine(actor_user_id, p_machine_id) then raise exception 'Machine access required'; end if;
  if normalized_reason is null then raise exception 'Refund setup changes require a reason'; end if;
  if normalized_display_label is not null and length(normalized_display_label) > 120 then
    raise exception 'Refund display label must be 120 characters or fewer';
  end if;

  select * into before_row from public.reporting_machines where id = p_machine_id for update;
  if before_row.id is null then raise exception 'Reporting machine not found'; end if;
  if coalesce(p_refund_intake_enabled, false) then
    if before_row.nayax_machine_id is null or btrim(before_row.nayax_machine_id) = '' then
      raise exception 'Nayax machine ID is required before enabling refund matching';
    end if;
    select count(*)::integer into active_manager_count
    from public.reporting_machine_refund_managers manager
    where manager.reporting_machine_id = before_row.id and manager.status = 'active' and manager.revoked_at is null;
    if active_manager_count < 1 then raise exception 'Assign at least one Machine Manager before enabling refund matching'; end if;
  end if;

  update public.reporting_machines set
    refund_intake_enabled = coalesce(p_refund_intake_enabled, false),
    refund_public_display_label = normalized_display_label
  where id = before_row.id returning * into after_row;

  insert into public.admin_audit_log (actor_user_id, action, entity_type, entity_id, before, after, meta)
  values (actor_user_id, 'reporting_machine.refund_intake_config.set', 'reporting_machine', before_row.id::text,
    jsonb_build_object('refundIntakeEnabled', coalesce(before_row.refund_intake_enabled, false),
      'hasDisplayLabel', before_row.refund_public_display_label is not null),
    jsonb_build_object('refundIntakeEnabled', coalesce(after_row.refund_intake_enabled, false),
      'hasDisplayLabel', after_row.refund_public_display_label is not null),
    jsonb_build_object('reason', normalized_reason, 'activeManagerCount', active_manager_count,
      'publicEligibilityControlledByInventory', true));

  return jsonb_build_object('machine', jsonb_build_object('id', after_row.id,
    'refundIntakeEnabled', coalesce(after_row.refund_intake_enabled, false),
    'refundPublicDisplayLabel', after_row.refund_public_display_label));
end;
$$;

revoke execute on function public.admin_set_reporting_machine_refund_intake_config(uuid, boolean, text, text)
  from public, anon;
grant execute on function public.admin_set_reporting_machine_refund_intake_config(uuid, boolean, text, text)
  to authenticated;

select pg_notify('pgrst', 'reload schema');
