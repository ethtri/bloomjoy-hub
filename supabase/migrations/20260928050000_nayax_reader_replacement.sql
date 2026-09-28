-- Keep ordinary Nayax inventory reconciliation inside the web RPC budget and
-- provide one audited transaction for replacing a physical reader that was
-- registered as a new Nayax logical machine.

create or replace function private.restore_machine_card_sales_authority(
  p_reporting_machine_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  has_sunze boolean;
  has_nayax boolean;
begin
  if p_reporting_machine_id is null then
    return;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'machine-card-authority:' || p_reporting_machine_id::text,
      0
    )
  );

  select
    nullif(btrim(machine.sunze_machine_id), '') is not null,
    nullif(btrim(machine.nayax_machine_id), '') is not null
  into has_sunze, has_nayax
  from public.reporting_machines machine
  where machine.id = p_reporting_machine_id;

  if not found then
    return;
  end if;

  update public.machine_sales_facts fact
  set
    net_sales_cents = (fact.raw_payload #>> '{_salesAuthorityOriginal,netSalesCents}')::integer,
    transaction_count = (fact.raw_payload #>> '{_salesAuthorityOriginal,transactionCount}')::integer,
    item_quantity = (fact.raw_payload #>> '{_salesAuthorityOriginal,itemQuantity}')::integer,
    tax_cents = (fact.raw_payload #>> '{_salesAuthorityOriginal,taxCents}')::integer,
    raw_payload = fact.raw_payload - 'revenueAuthority'
      - 'operationalMetricsAuthority' - 'operationalMetricsScope'
  where fact.reporting_machine_id = p_reporting_machine_id
    and fact.source = 'sunze_browser'
    and fact.payment_method = 'credit'
    and fact.raw_payload ? '_salesAuthorityOriginal';

  update public.machine_sales_facts fact
  set
    net_sales_cents = case
      when has_sunze and has_nayax then 0
      else (fact.raw_payload #>> '{_salesAuthorityOriginal,netSalesCents}')::integer
    end,
    transaction_count = case
      when has_sunze and has_nayax then 0
      else (fact.raw_payload #>> '{_salesAuthorityOriginal,transactionCount}')::integer
    end,
    item_quantity = case
      when has_sunze and has_nayax then 0
      else (fact.raw_payload #>> '{_salesAuthorityOriginal,itemQuantity}')::integer
    end,
    tax_cents = case
      when has_sunze and has_nayax then 0
      else (fact.raw_payload #>> '{_salesAuthorityOriginal,taxCents}')::integer
    end,
    raw_payload = case
      when has_sunze and has_nayax then fact.raw_payload || jsonb_build_object(
        'revenueAuthority', 'sunze_browser',
        'authorityStatus', 'staged_before_boundary'
      )
      else fact.raw_payload - 'revenueAuthority' - 'authorityStatus'
    end
  where fact.reporting_machine_id = p_reporting_machine_id
    and fact.source = 'nayax_scheduled_report'
    and fact.payment_method = 'credit'
    and fact.raw_payload ? '_salesAuthorityOriginal';

  delete from public.machine_sales_facts fact
  where fact.reporting_machine_id = p_reporting_machine_id
    and fact.source = 'card_authority_daily';
end;
$$;

revoke all on function private.restore_machine_card_sales_authority(uuid)
  from public, anon, authenticated, service_role;

create or replace function private.sync_nayax_card_authority_from_inventory()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  prior_machine_id uuid;
  prior_mapping_withdrawn boolean := false;
  mapping_published boolean := false;
begin
  if current_setting('app.nayax_reader_replacement', true) = '1' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  prior_machine_id := case when tg_op = 'INSERT' then null else old.reporting_machine_id end;

  if tg_op = 'DELETE' then
    prior_mapping_withdrawn := true;
  elsif tg_op = 'INSERT' then
    mapping_published := true;
  elsif tg_op = 'UPDATE' then
    prior_mapping_withdrawn :=
      new.reporting_machine_id is distinct from prior_machine_id
      or new.reconciliation_state <> 'published'
      or not new.provider_is_active
      or new.account_key is distinct from old.account_key
      or new.nayax_machine_id is distinct from old.nayax_machine_id;
    mapping_published :=
      new.reporting_machine_id is distinct from prior_machine_id
      or old.reconciliation_state <> 'published'
      or not old.provider_is_active
      or new.account_key is distinct from old.account_key
      or new.nayax_machine_id is distinct from old.nayax_machine_id;
  end if;

  if prior_machine_id is not null
    and prior_mapping_withdrawn
    and not exists (
      select 1
      from public.refund_nayax_machine_inventory inventory
      join public.reporting_machines machine
        on machine.id = inventory.reporting_machine_id
      where inventory.reporting_machine_id = prior_machine_id
        and inventory.reconciliation_state = 'published'
        and inventory.provider_is_active
        and machine.nayax_machine_id = inventory.nayax_machine_id
        and upper(coalesce(machine.nayax_account_key, 'TGPACI_USA_DB')) =
          inventory.account_key
    ) then
    update public.reporting_machines
    set nayax_card_sales_started_on = null,
        updated_at = statement_timestamp()
    where id = prior_machine_id
      and nayax_card_sales_started_on is not null;
  end if;

  if tg_op <> 'DELETE'
    and mapping_published
    and new.reporting_machine_id is not null
    and new.reconciliation_state = 'published'
    and new.provider_is_active then
    update public.reporting_machines machine
    set nayax_card_sales_started_on =
          (statement_timestamp() at time zone location.timezone)::date + 1,
        updated_at = statement_timestamp()
    from public.reporting_locations location
    where machine.id = new.reporting_machine_id
      and location.id = machine.location_id
      and machine.status = 'active'
      and location.status = 'active'
      and nullif(btrim(machine.sunze_machine_id), '') is not null
      and machine.nayax_machine_id = new.nayax_machine_id
      and upper(coalesce(machine.nayax_account_key, 'TGPACI_USA_DB')) =
        new.account_key
      and machine.nayax_card_sales_started_on is null;
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

revoke all on function private.sync_nayax_card_authority_from_inventory()
  from public, anon, authenticated, service_role;

create or replace function private.reporting_machine_card_authority_reconcile_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  affected_date date;
  old_mapping_eligible boolean;
  new_mapping_eligible boolean;
begin
  if current_setting('app.nayax_reader_replacement', true) = '1' then
    return new;
  end if;

  if old.nayax_card_sales_started_on is not null
    and new.nayax_card_sales_started_on is null then
    perform private.restore_machine_card_sales_authority(new.id);
    return new;
  end if;

  old_mapping_eligible :=
    old.status = 'active'
    and nullif(btrim(old.sunze_machine_id), '') is not null
    and nullif(btrim(old.nayax_machine_id), '') is not null
    and exists (
      select 1
      from public.refund_nayax_machine_inventory inventory
      join public.reporting_locations location on location.id = old.location_id
      where inventory.reporting_machine_id = old.id
        and inventory.reconciliation_state = 'published'
        and inventory.provider_is_active
        and inventory.nayax_machine_id = old.nayax_machine_id
        and inventory.account_key =
          upper(coalesce(old.nayax_account_key, 'TGPACI_USA_DB'))
        and location.status = 'active'
    );

  new_mapping_eligible :=
    new.status = 'active'
    and nullif(btrim(new.sunze_machine_id), '') is not null
    and nullif(btrim(new.nayax_machine_id), '') is not null
    and exists (
      select 1
      from public.refund_nayax_machine_inventory inventory
      join public.reporting_locations location on location.id = new.location_id
      where inventory.reporting_machine_id = new.id
        and inventory.reconciliation_state = 'published'
        and inventory.provider_is_active
        and inventory.nayax_machine_id = new.nayax_machine_id
        and inventory.account_key =
          upper(coalesce(new.nayax_account_key, 'TGPACI_USA_DB'))
        and location.status = 'active'
    );

  if new.nayax_card_sales_started_on is not null
    and old_mapping_eligible
    and not new_mapping_eligible then
    update public.reporting_machines
    set nayax_card_sales_started_on = null,
        updated_at = statement_timestamp()
    where id = new.id
      and nayax_card_sales_started_on is not null;
    return new;
  end if;

  if new.nayax_card_sales_started_on is null
    and not old_mapping_eligible
    and new_mapping_eligible then
    update public.reporting_machines machine
    set nayax_card_sales_started_on =
          (statement_timestamp() at time zone location.timezone)::date + 1,
        updated_at = statement_timestamp()
    from public.reporting_locations location
    where machine.id = new.id
      and location.id = machine.location_id
      and location.status = 'active'
      and machine.nayax_card_sales_started_on is null;
    return new;
  end if;

  if new.nayax_card_sales_started_on is not distinct from old.nayax_card_sales_started_on
    and new.sunze_machine_id is not distinct from old.sunze_machine_id
    and new.nayax_machine_id is not distinct from old.nayax_machine_id then
    return new;
  end if;

  for affected_date in
    select distinct fact.sale_date
    from public.machine_sales_facts fact
    where fact.reporting_machine_id = new.id
      and fact.source in ('sunze_browser', 'nayax_scheduled_report')
      and fact.payment_method = 'credit'
  loop
    perform private.reconcile_machine_card_sales_authority(new.id, affected_date);
  end loop;

  return new;
end;
$$;

revoke all on function private.reporting_machine_card_authority_reconcile_trigger()
  from public, anon, authenticated, service_role;

create or replace function public.admin_replace_refund_nayax_machine(
  p_reporting_machine_id uuid,
  p_replacement_inventory_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = 'public', 'auth'
set statement_timeout = '60s'
as $$
declare
  actor_user_id uuid := auth.uid();
  machine public.reporting_machines;
  current_inventory public.refund_nayax_machine_inventory;
  replacement_inventory public.refund_nayax_machine_inventory;
  replacement_category text;
  normalized_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  manager_count integer := 0;
  preserved_authority_start date;
begin
  if actor_user_id is null or not public.is_super_admin(actor_user_id) then
    raise exception 'Super Admin access required';
  end if;
  if normalized_reason is null or length(normalized_reason) < 8 then
    raise exception 'An audit reason of at least 8 characters is required';
  end if;

  select * into machine
  from public.reporting_machines
  where id = p_reporting_machine_id
  for update;
  if machine.id is null then raise exception 'Reporting machine not found'; end if;
  if machine.status <> 'active' then raise exception 'Reporting machine must be active'; end if;

  select * into current_inventory
  from public.refund_nayax_machine_inventory
  where reporting_machine_id = machine.id
    and reconciliation_state = 'published'
  for update;
  if current_inventory.id is null then
    raise exception 'A current published Nayax reader is required before replacement';
  end if;
  if current_inventory.nayax_machine_id <> btrim(coalesce(machine.nayax_machine_id, ''))
    or current_inventory.account_key <>
      upper(coalesce(machine.nayax_account_key, 'TGPACI_USA_DB')) then
    raise exception 'Current Nayax reader mapping is inconsistent; refresh and review setup';
  end if;

  select * into replacement_inventory
  from public.refund_nayax_machine_inventory
  where id = p_replacement_inventory_id
  for update;
  if replacement_inventory.id is null then raise exception 'Replacement Nayax reader not found'; end if;
  if replacement_inventory.id = current_inventory.id then
    raise exception 'Choose a different replacement Nayax reader';
  end if;
  if not replacement_inventory.provider_is_active
    or replacement_inventory.missing_successful_snapshots > 0 then
    raise exception 'Replacement Nayax reader must be active in the latest complete inventory';
  end if;
  if replacement_inventory.account_key <> current_inventory.account_key then
    raise exception 'Replacement Nayax reader must use the same provider account';
  end if;
  if replacement_inventory.reporting_machine_id is not null then
    raise exception 'Replacement Nayax reader is already linked to a Bloomjoy machine';
  end if;

  if nullif(btrim(coalesce(machine.refund_public_display_label, '')), '') is null then
    raise exception 'Customer-facing label is required before replacing the reader';
  end if;
  if not exists (
    select 1 from public.reporting_locations location
    where location.id = machine.location_id and location.status = 'active'
  ) then raise exception 'Active location is required before replacing the reader'; end if;

  select count(*)::integer into manager_count
  from public.reporting_machine_refund_managers manager
  where manager.reporting_machine_id = machine.id
    and manager.status = 'active' and manager.revoked_at is null;
  if manager_count < 1 or manager_count > 4 then
    raise exception 'One to four current Machine Managers are required before replacing the reader';
  end if;

  replacement_category := coalesce(
    replacement_inventory.refund_category,
    current_inventory.refund_category
  );
  if replacement_category is null
    or replacement_category not in ('cotton_candy', 'snapcase', 'unknown') then
    raise exception 'Confirm the replacement reader category before replacement';
  end if;

  preserved_authority_start := machine.nayax_card_sales_started_on;
  perform set_config('app.nayax_reader_replacement', '1', true);

  update public.refund_nayax_machine_inventory
  set
    reconciliation_state = 'excluded',
    reporting_machine_id = null,
    exclusion_reason = 'Retired reader after verified replacement',
    setup_reason = 'explicitly_excluded',
    decision_reason = normalized_reason,
    decided_by = actor_user_id,
    decided_at = statement_timestamp(),
    updated_at = statement_timestamp()
  where id = current_inventory.id;

  update public.reporting_machines
  set
    nayax_machine_id = replacement_inventory.nayax_machine_id,
    nayax_account_key = replacement_inventory.account_key,
    nayax_card_sales_started_on = preserved_authority_start,
    updated_at = statement_timestamp()
  where id = machine.id;

  update public.refund_nayax_machine_inventory
  set
    reconciliation_state = 'published',
    refund_category = replacement_category,
    reporting_machine_id = machine.id,
    exclusion_reason = null,
    setup_reason = 'ready',
    decision_reason = normalized_reason,
    decided_by = actor_user_id,
    decided_at = statement_timestamp(),
    updated_at = statement_timestamp()
  where id = replacement_inventory.id;

  perform set_config('app.nayax_reader_replacement', '0', true);

  if not exists (
    select 1
    from public.refund_nayax_machine_inventory inventory
    join public.reporting_machines reporting on reporting.id = inventory.reporting_machine_id
    where inventory.id = replacement_inventory.id
      and inventory.reconciliation_state = 'published'
      and inventory.provider_is_active
      and inventory.missing_successful_snapshots = 0
      and reporting.id = machine.id
      and reporting.nayax_machine_id = inventory.nayax_machine_id
      and upper(coalesce(reporting.nayax_account_key, 'TGPACI_USA_DB')) = inventory.account_key
  ) then
    raise exception 'Replacement mapping did not pass readiness verification';
  end if;

  insert into public.admin_audit_log (
    actor_user_id, action, entity_type, entity_id, before, after, meta
  ) values
  (
    actor_user_id,
    'refund_nayax_inventory.reconciled',
    'refund_nayax_machine_inventory',
    current_inventory.id::text,
    jsonb_build_object('state', current_inventory.reconciliation_state,
      'category', current_inventory.refund_category,
      'reportingMachineId', current_inventory.reporting_machine_id),
    jsonb_build_object('state', 'excluded', 'category', current_inventory.refund_category,
      'reportingMachineId', null, 'hasExclusionReason', true),
    jsonb_build_object('reason', normalized_reason, 'replacement', true)
  ),
  (
    actor_user_id,
    'reporting_machine.nayax_config.set',
    'reporting_machine',
    machine.id::text,
    jsonb_build_object('had_nayax_machine_id', true, 'had_nayax_account_key', true),
    jsonb_build_object('has_nayax_machine_id', true, 'has_nayax_account_key', true),
    jsonb_build_object('reason', normalized_reason, 'actor_authority', 'super_admin',
      'readerReplacement', true)
  ),
  (
    actor_user_id,
    'refund_nayax_inventory.reconciled',
    'refund_nayax_machine_inventory',
    replacement_inventory.id::text,
    jsonb_build_object('state', replacement_inventory.reconciliation_state,
      'category', replacement_inventory.refund_category,
      'reportingMachineId', replacement_inventory.reporting_machine_id,
      'hasExclusionReason', replacement_inventory.exclusion_reason is not null),
    jsonb_build_object('state', 'published', 'category', replacement_category,
      'reportingMachineId', machine.id, 'hasExclusionReason', false),
    jsonb_build_object('reason', normalized_reason, 'replacement', true,
      'activeManagerCount', manager_count)
  ),
  (
    actor_user_id,
    'reporting_machine.nayax_reader.replaced',
    'reporting_machine',
    machine.id::text,
    jsonb_build_object('inventoryId', current_inventory.id,
      'nayaxMachineId', current_inventory.nayax_machine_id),
    jsonb_build_object('inventoryId', replacement_inventory.id,
      'nayaxMachineId', replacement_inventory.nayax_machine_id),
    jsonb_build_object('reason', normalized_reason, 'accountKey', replacement_inventory.account_key,
      'authorityStartPreserved', preserved_authority_start)
  );

  return jsonb_build_object(
    'ok', true,
    'reportingMachineId', machine.id,
    'retiredInventoryId', current_inventory.id,
    'replacementInventoryId', replacement_inventory.id,
    'replacementNayaxMachineId', replacement_inventory.nayax_machine_id,
    'readiness', 'ready'
  );
end;
$$;

revoke execute on function public.admin_replace_refund_nayax_machine(uuid, uuid, text)
  from public, anon;
grant execute on function public.admin_replace_refund_nayax_machine(uuid, uuid, text)
  to authenticated;

alter function public.admin_reconcile_refund_nayax_machine(uuid, text, text, uuid, text, text)
  set statement_timeout = '60s';

comment on function public.admin_replace_refund_nayax_machine(uuid, uuid, text) is
  'Atomically retires the current Nayax reader, switches the reporting-machine provider identity, publishes one verified same-account replacement, preserves historical rows and the existing card-authority boundary, and records the complete audited change.';
