-- #1195: the current Nayax inventory proves the immutable Valley Mall machine
-- identity, but it does not prove a physical product. Keep customer intake and
-- the existing manager/case route while removing the unsupported product claim.

alter table public.refund_nayax_machine_inventory
  drop constraint if exists refund_nayax_machine_inventory_refund_category_check;

alter table public.refund_nayax_machine_inventory
  drop constraint if exists refund_nayax_inventory_category_check;

alter table public.refund_nayax_machine_inventory
  add constraint refund_nayax_inventory_category_check
  check (refund_category in ('cotton_candy', 'snapcase', 'unknown')) not valid;

alter table public.refund_nayax_machine_inventory
  validate constraint refund_nayax_inventory_category_check;

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
  if normalized_category is not null
    and normalized_category not in ('cotton_candy', 'snapcase', 'unknown') then
    raise exception 'Refund category must be cotton_candy, snapcase, or unknown';
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
    if manager_count < 1 or manager_count > 4 then
      raise exception 'One to four current Machine Managers are required before publishing';
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

-- Unknown product is public only when an operator has explicitly published an
-- exact, current provider mapping. The ordinary commercial/mini intake rule is
-- unchanged, as is every downstream approval and payment gate.
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
    machine.id as machine_id,
    coalesce(nullif(trim(machine.refund_public_display_label), ''), machine.machine_label) as machine_label,
    location.id as location_id,
    case
      when lower(trim(location.name)) like 'unmapped %'
        or lower(trim(location.name)) like 'unknown %'
        or lower(trim(location.name)) in ('unmapped', 'unknown')
      then trim(machine.refund_public_display_label)
      else location.name
    end as location_name,
    location.timezone as location_timezone
  from public.reporting_machines machine
  join public.reporting_locations location on location.id = machine.location_id
  where machine.status = 'active'
    and location.status = 'active'
    and (
      (
        machine.machine_type in ('commercial', 'mini')
        and not exists (
          select 1
          from public.refund_nayax_machine_inventory blocked_inventory
          where blocked_inventory.reporting_machine_id = machine.id
            and (
              blocked_inventory.reconciliation_state = 'excluded'
              or not blocked_inventory.provider_is_active
              or blocked_inventory.missing_successful_snapshots >= 2
            )
        )
      )
      or exists (
        select 1
        from public.refund_nayax_machine_inventory inventory
        where inventory.reporting_machine_id = machine.id
          and inventory.provider_is_active
          and inventory.missing_successful_snapshots < 2
          and (
            (
              inventory.refund_category = 'snapcase'
              and inventory.reconciliation_state <> 'excluded'
            )
            or (
              inventory.refund_category = 'unknown'
              and inventory.reconciliation_state = 'published'
            )
          )
      )
    )
    and (
      not (
        lower(trim(location.name)) like 'unmapped %'
        or lower(trim(location.name)) like 'unknown %'
        or lower(trim(location.name)) in ('unmapped', 'unknown')
      )
      or nullif(trim(machine.refund_public_display_label), '') is not null
    )
  order by
    case
      when lower(trim(location.name)) like 'unmapped %'
        or lower(trim(location.name)) like 'unknown %'
        or lower(trim(location.name)) in ('unmapped', 'unknown')
      then trim(machine.refund_public_display_label)
      else location.name
    end,
    coalesce(nullif(trim(machine.refund_public_display_label), ''), machine.machine_label);
$$;

comment on function public.public_refund_machine_options() is
  'Public noindex refund intake selector. Explicitly published unknown-product inventory remains customer-visible without asserting a physical product; payment readiness remains separately gated.';

revoke execute on function public.public_refund_machine_options() from public;
grant execute on function public.public_refund_machine_options() to anon, authenticated;

create function public.reconcile_valley_mall_product_unknown()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  inventory public.refund_nayax_machine_inventory%rowtype;
  machine public.reporting_machines%rowtype;
  before_inventory jsonb;
  before_machine jsonb;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('refund_valley_mall_product_unknown_v1')
  );

  select * into inventory
  from public.refund_nayax_machine_inventory
  where account_key = 'TGPACI_USA_DB'
    and nayax_machine_id = '224560057'
  for update;

  if inventory.id is null then
    return jsonb_build_object('skipped', true);
  end if;

  if inventory.id is distinct from '1d7d0d06-5586-4233-ba6b-cad55fe4edab'::uuid
    or inventory.machine_name is distinct from 'Preit1085-Valley mall'
    or inventory.machine_number is distinct from '434334924111783AutoI&IBl'
    or inventory.reporting_machine_id is distinct from 'f77bc8a8-71b3-4300-8a76-c935b8b1972f'::uuid
    or not inventory.provider_is_active
    or inventory.missing_successful_snapshots <> 0
  then
    raise exception 'Reviewed Valley Mall provider identity has changed';
  end if;

  select * into machine
  from public.reporting_machines
  where id = inventory.reporting_machine_id
  for update;

  if machine.id is null
    or machine.nayax_machine_id is distinct from inventory.nayax_machine_id
    or upper(coalesce(machine.nayax_account_key, 'TGPACI_USA_DB')) is distinct from inventory.account_key
    or machine.location_id is distinct from '806bb025-eb06-4c53-b11b-35e782646f51'::uuid
    or machine.status is distinct from 'active'
    or not machine.refund_intake_enabled
    or not exists (
      select 1
      from public.reporting_locations location
      where location.id = machine.location_id
        and location.name = 'Valley Mall'
        and location.timezone = 'America/New_York'
        and location.status = 'active'
    )
    or not exists (
      select 1
      from public.reporting_machine_refund_managers manager
      where manager.reporting_machine_id = machine.id
        and manager.status = 'active'
        and manager.revoked_at is null
    )
  then
    raise exception 'Reviewed Valley Mall public identity or manager route has changed';
  end if;

  if inventory.refund_category = 'unknown'
    and inventory.reconciliation_state = 'published'
    and machine.machine_type = 'unknown'
    and machine.refund_public_display_label = 'Valley Mall — product type unverified'
    and exists (
      select 1 from public.public_refund_machine_options() option
      where option.machine_id = machine.id
        and option.machine_label = 'Valley Mall — product type unverified'
        and option.location_timezone = 'America/New_York'
    )
  then
    return jsonb_build_object('skipped', false, 'alreadyApplied', true);
  end if;

  if inventory.refund_category is distinct from 'cotton_candy'
    or inventory.reconciliation_state is distinct from 'published'
    or inventory.setup_reason is distinct from 'ready'
    or machine.machine_type is distinct from 'commercial'
    or machine.refund_public_display_label is distinct from 'Valley Mall — Cotton Candy'
  then
    raise exception 'Conflicting Valley Mall product or publication decision';
  end if;

  before_inventory := jsonb_build_object(
    'category', inventory.refund_category,
    'state', inventory.reconciliation_state,
    'reportingMachineId', inventory.reporting_machine_id
  );
  before_machine := jsonb_build_object(
    'machineType', machine.machine_type,
    'publicLabel', machine.refund_public_display_label,
    'locationId', machine.location_id,
    'refundIntakeEnabled', machine.refund_intake_enabled
  );

  update public.refund_nayax_machine_inventory
  set
    refund_category = 'unknown',
    decision_reason = 'Current provider inventory verifies this machine identity but not its physical product; product remains unverified (#1195).',
    decided_by = null,
    decided_at = statement_timestamp(),
    updated_at = statement_timestamp()
  where id = inventory.id;

  update public.reporting_machines
  set
    machine_type = 'unknown',
    refund_public_display_label = 'Valley Mall — product type unverified',
    updated_at = statement_timestamp()
  where id = machine.id;

  if not exists (
    select 1
    from public.public_refund_machine_options() option
    where option.machine_id = machine.id
      and option.machine_label = 'Valley Mall — product type unverified'
      and option.location_id = machine.location_id
      and option.location_name = 'Valley Mall'
      and option.location_timezone = 'America/New_York'
  ) then
    raise exception 'Valley Mall customer intake was not preserved';
  end if;

  insert into public.admin_audit_log (
    actor_user_id, action, entity_type, entity_id, before, after, meta
  ) values (
    null,
    'refund_nayax_inventory.valley_mall_product_unknown',
    'refund_nayax_machine_inventory',
    inventory.id::text,
    before_inventory || jsonb_build_object('reportingMachine', before_machine),
    jsonb_build_object(
      'category', 'unknown',
      'state', 'published',
      'reportingMachineId', inventory.reporting_machine_id,
      'reportingMachine', jsonb_build_object(
        'machineType', 'unknown',
        'publicLabel', 'Valley Mall — product type unverified',
        'locationId', machine.location_id,
        'refundIntakeEnabled', true
      )
    ),
    jsonb_build_object(
      'issue', 1195,
      'evidenceBoundary', 'Provider inventory verifies identity, not physical product.',
      'managerAssignmentsChanged', false,
      'caseBindingsChanged', false,
      'candidateBindingsChanged', false,
      'historyChanged', false,
      'selectionOrApprovalAction', false,
      'refundOrPaymentAction', false,
      'customerMessageSent', false,
      'providerActionTaken', false
    )
  );

  return jsonb_build_object('skipped', false, 'alreadyApplied', false);
end;
$$;

revoke all on function public.reconcile_valley_mall_product_unknown()
  from public, anon, authenticated, service_role;

select public.reconcile_valley_mall_product_unknown();
