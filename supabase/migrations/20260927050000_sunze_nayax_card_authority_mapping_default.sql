-- Apply the owner-selected Nayax card authority when an exact Sunze/Nayax
-- machine mapping becomes active. The date remains explicit and reversible:
-- publishing starts on the next machine-local day, unpublishing restores
-- Sunze, and a deliberate boundary clear is not immediately overwritten.

create function private.sync_nayax_card_authority_from_inventory()
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

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function private.sync_nayax_card_authority_from_inventory()
  from public, anon, authenticated, service_role;

create trigger refund_nayax_inventory_card_authority_sync
after insert or update of
  account_key,
  nayax_machine_id,
  provider_is_active,
  reporting_machine_id,
  reconciliation_state
or delete on public.refund_nayax_machine_inventory
for each row execute function private.sync_nayax_card_authority_from_inventory();

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
      and location.id = new.location_id
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

drop trigger if exists reporting_machine_card_authority_reconcile
  on public.reporting_machines;
create trigger reporting_machine_card_authority_reconcile
after update of
  nayax_card_sales_started_on,
  sunze_machine_id,
  nayax_machine_id,
  nayax_account_key,
  location_id,
  status
on public.reporting_machines
for each row execute function private.reporting_machine_card_authority_reconcile_trigger();

comment on function private.sync_nayax_card_authority_from_inventory() is
  'Applies or removes the next-local-day Nayax card authority boundary when an exact active provider mapping is published or withdrawn.';
