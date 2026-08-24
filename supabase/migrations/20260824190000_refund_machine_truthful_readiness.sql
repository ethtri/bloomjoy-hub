-- #948: truthful machine-level refund readiness and reviewed activation.
--
-- Customer intake, transaction matching, provider inventory, manager routing,
-- and live card execution remain independent server controls. This migration
-- exposes their effective result as one safe Admin contract and provides the
-- only routine Super Admin path for changing the per-machine payment gate.

alter table public.reporting_machines
  add column if not exists nayax_refunds_disabled_reason text;

alter table public.reporting_machines
  drop constraint if exists reporting_machines_nayax_refunds_disabled_reason_check;

alter table public.reporting_machines
  add constraint reporting_machines_nayax_refunds_disabled_reason_check check (
    nayax_refunds_disabled_reason is null
    or nayax_refunds_disabled_reason in (
      'awaiting_reviewed_activation',
      'owner_pause',
      'provider_support',
      'machine_maintenance',
      'commercial_exception'
    )
  );

alter table public.reporting_machines
  drop constraint if exists reporting_machines_nayax_refunds_enabled_reason_check;

alter table public.reporting_machines
  add constraint reporting_machines_nayax_refunds_enabled_reason_check check (
    not nayax_refunds_enabled or nayax_refunds_disabled_reason is null
  );

-- Existing qualified machines were deliberately left payment-disabled during
-- the inventory rollout. Make that state explicit instead of silently relying
-- on the old boolean default.
update public.reporting_machines machine
set nayax_refunds_disabled_reason = 'awaiting_reviewed_activation'
where machine.nayax_refunds_enabled = false
  and machine.refund_intake_enabled = true
  and machine.nayax_refunds_disabled_reason is null
  and public.service_refund_machine_is_public(machine.id)
  and exists (
    select 1
    from public.refund_nayax_machine_inventory inventory
    where inventory.reporting_machine_id = machine.id
      and inventory.provider_is_active
      and inventory.missing_successful_snapshots < 2
      and inventory.reconciliation_state = 'published'
      and inventory.account_key = upper(coalesce(machine.nayax_account_key, 'TGPACI_USA_DB'))
      and inventory.nayax_machine_id = btrim(coalesce(machine.nayax_machine_id, ''))
  )
  and (
    select count(*)
    from public.reporting_machine_refund_managers manager
    where manager.reporting_machine_id = machine.id
      and manager.status = 'active'
      and manager.revoked_at is null
  ) between 1 and 3;

create or replace function public.sync_refund_machine_payment_disabled_reason()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.reporting_machine_id is not null
    and new.reconciliation_state = 'published'
    and new.provider_is_active
    and new.missing_successful_snapshots < 2 then
    update public.reporting_machines machine
    set nayax_refunds_disabled_reason = 'awaiting_reviewed_activation'
    where machine.id = new.reporting_machine_id
      and not machine.nayax_refunds_enabled
      and machine.nayax_refunds_disabled_reason is null
      and machine.refund_intake_enabled
      and new.account_key = upper(coalesce(machine.nayax_account_key, 'TGPACI_USA_DB'))
      and new.nayax_machine_id = btrim(coalesce(machine.nayax_machine_id, ''))
      and (
        select count(*)
        from public.reporting_machine_refund_managers manager
        where manager.reporting_machine_id = machine.id
          and manager.status = 'active'
          and manager.revoked_at is null
      ) between 1 and 3;
  end if;
  return new;
end;
$$;

drop trigger if exists refund_nayax_inventory_sync_payment_disabled_reason
  on public.refund_nayax_machine_inventory;
create trigger refund_nayax_inventory_sync_payment_disabled_reason
after insert or update of reconciliation_state, reporting_machine_id, provider_is_active,
  missing_successful_snapshots on public.refund_nayax_machine_inventory
for each row execute function public.sync_refund_machine_payment_disabled_reason();

comment on function public.sync_refund_machine_payment_disabled_reason() is
  'Makes a newly published, qualified, payment-disabled machine visibly await reviewed activation instead of leaving an unknown false flag.';

revoke execute on function public.sync_refund_machine_payment_disabled_reason()
  from public, anon, authenticated, service_role;

create or replace function public.admin_get_refund_manager_setup()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  actor_user_id uuid := auth.uid();
  result jsonb;
begin
  if actor_user_id is null then
    raise exception 'Authentication required';
  end if;

  if not (public.is_super_admin(actor_user_id) or public.is_scoped_admin(actor_user_id)) then
    raise exception 'Machine setup access required';
  end if;

  with machine_capabilities as (
    select
      machine.*,
      location.name as location_name,
      public.service_refund_machine_is_public(machine.id) as customer_intake_accepting,
      coalesce(machine.refund_intake_enabled, false) as transaction_matching_enabled,
      manager_route.manager_count,
      manager_route.manager_emails,
      manager_route.manager_count between 1 and 3 as manager_routing_ready,
      exists (
        select 1
        from public.refund_nayax_machine_inventory inventory
        where inventory.reporting_machine_id = machine.id
          and inventory.provider_is_active
          and inventory.missing_successful_snapshots < 2
          and inventory.reconciliation_state = 'published'
          and inventory.account_key = upper(coalesce(machine.nayax_account_key, 'TGPACI_USA_DB'))
          and inventory.nayax_machine_id = btrim(coalesce(machine.nayax_machine_id, ''))
      ) as transaction_lookup_ready
    from public.reporting_machines machine
    join public.reporting_locations location on location.id = machine.location_id
    cross join lateral (
      select
        count(*)::integer as manager_count,
        coalesce(jsonb_agg(manager.manager_email order by manager.manager_email)
          filter (where manager.id is not null), '[]'::jsonb) as manager_emails
      from public.reporting_machine_refund_managers manager
      where manager.reporting_machine_id = machine.id
        and manager.status = 'active'
        and manager.revoked_at is null
    ) manager_route
    where machine.status = 'active'
      and public.can_manage_refund_machine(actor_user_id, machine.id)
  ), readiness as (
    select
      capability.*,
      capability.customer_intake_accepting
        and capability.transaction_matching_enabled
        and capability.transaction_lookup_ready
        and capability.manager_routing_ready as activation_eligible,
      case
        when not capability.customer_intake_accepting then 'customer_intake_unavailable'
        when not capability.transaction_matching_enabled then 'transaction_matching_off'
        when not capability.transaction_lookup_ready then 'transaction_lookup_not_ready'
        when not capability.manager_routing_ready then 'manager_route_not_ready'
        when capability.nayax_refunds_enabled
          and capability.nayax_refund_max_amount_cents is null then 'machine_limit_missing'
        else null
      end as setup_block_reason
    from machine_capabilities capability
  )
  select jsonb_build_object(
    'standardLaunchLimitCents', 5000,
    'machines', coalesce(jsonb_agg(
      jsonb_build_object(
        'id', machine.id,
        'machineLabel', machine.machine_label,
        'machineType', machine.machine_type,
        'locationName', machine.location_name,
        'refundIntakeEnabled', machine.transaction_matching_enabled,
        'transactionMatchingEnabled', machine.transaction_matching_enabled,
        'refundPublicDisplayLabel', machine.refund_public_display_label,
        'nayaxLookupConfigured',
          machine.nayax_machine_id is not null and btrim(machine.nayax_machine_id) <> '',
        'nayaxMachineId', machine.nayax_machine_id,
        'nayaxAccountKey', machine.nayax_account_key,
        'managerEmails', machine.manager_emails,
        'managerCount', machine.manager_count,
        'customerIntakeAccepting', machine.customer_intake_accepting,
        'transactionLookupReady', machine.transaction_lookup_ready,
        'managerRoutingReady', machine.manager_routing_ready,
        'nayaxRefundsEnabled', machine.nayax_refunds_enabled,
        'nayaxRefundMaxAmountCents', machine.nayax_refund_max_amount_cents,
        'paymentDisabledReason', case
          when machine.nayax_refunds_enabled then null
          when machine.activation_eligible then coalesce(
            machine.nayax_refunds_disabled_reason,
            'awaiting_reviewed_activation'
          )
          else machine.nayax_refunds_disabled_reason
        end,
        'activationEligible', machine.activation_eligible,
        'readinessState', case
          when machine.setup_block_reason is not null then 'setup_needed'
          when machine.nayax_refunds_enabled
            and machine.nayax_refund_max_amount_cents is not null then 'ready_to_refund'
          else 'ready_to_activate'
        end,
        'readinessBlockReason', machine.setup_block_reason
      ) order by machine.location_name, machine.machine_label
    ), '[]'::jsonb)
  )
  into result
  from readiness machine;

  return result;
end;
$$;

comment on function public.admin_get_refund_manager_setup() is
  'Scoped machine setup plus server-computed customer intake, matching, inventory, manager-route, payment, limit, and safe readiness states. Runtime global pause is merged by the authenticated Nayax availability boundary.';

revoke execute on function public.admin_get_refund_manager_setup() from public, anon;
grant execute on function public.admin_get_refund_manager_setup() to authenticated;

create or replace function public.admin_set_refund_machine_card_activation(
  p_machine_id uuid,
  p_enabled boolean,
  p_disabled_reason text default null,
  p_reason text default 'Reviewed refund machine activation change'
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  actor_user_id uuid := auth.uid();
  machine public.reporting_machines;
  normalized_disabled_reason text := nullif(lower(btrim(coalesce(p_disabled_reason, ''))), '');
  normalized_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  customer_intake_accepting boolean := false;
  transaction_lookup_ready boolean := false;
  manager_count integer := 0;
  activation_eligible boolean := false;
  before_enabled boolean;
  before_limit integer;
  before_disabled_reason text;
begin
  if actor_user_id is null or not public.is_super_admin(actor_user_id) then
    raise exception 'Super Admin access required';
  end if;
  if p_machine_id is null then raise exception 'Machine is required'; end if;
  if normalized_reason is null or length(normalized_reason) < 8 then
    raise exception 'An audit reason of at least 8 characters is required';
  end if;

  select * into machine
  from public.reporting_machines
  where id = p_machine_id
  for update;
  if machine.id is null then raise exception 'Reporting machine not found'; end if;

  customer_intake_accepting := public.service_refund_machine_is_public(machine.id);
  select count(*)::integer into manager_count
  from public.reporting_machine_refund_managers manager
  where manager.reporting_machine_id = machine.id
    and manager.status = 'active'
    and manager.revoked_at is null;
  select exists (
    select 1
    from public.refund_nayax_machine_inventory inventory
    where inventory.reporting_machine_id = machine.id
      and inventory.provider_is_active
      and inventory.missing_successful_snapshots < 2
      and inventory.reconciliation_state = 'published'
      and inventory.account_key = upper(coalesce(machine.nayax_account_key, 'TGPACI_USA_DB'))
      and inventory.nayax_machine_id = btrim(coalesce(machine.nayax_machine_id, ''))
  ) into transaction_lookup_ready;
  activation_eligible := customer_intake_accepting
    and coalesce(machine.refund_intake_enabled, false)
    and transaction_lookup_ready
    and manager_count between 1 and 3;

  before_enabled := machine.nayax_refunds_enabled;
  before_limit := machine.nayax_refund_max_amount_cents;
  before_disabled_reason := machine.nayax_refunds_disabled_reason;

  if coalesce(p_enabled, false) then
    if not activation_eligible then
      raise exception 'Machine is not ready for card refunds';
    end if;
    if machine.nayax_refunds_enabled
      and machine.nayax_refund_max_amount_cents = 5000
      and machine.nayax_refunds_disabled_reason is null then
      return jsonb_build_object(
        'ok', true, 'replayed', true, 'machineId', machine.id,
        'readinessState', 'ready_to_refund', 'limitCents', 5000
      );
    end if;
    update public.reporting_machines
    set nayax_refunds_enabled = true,
        nayax_refund_max_amount_cents = 5000,
        nayax_refunds_disabled_reason = null
    where id = machine.id;
  else
    if normalized_disabled_reason is null or normalized_disabled_reason not in (
      'owner_pause', 'provider_support', 'machine_maintenance', 'commercial_exception'
    ) then
      raise exception 'Choose an approved reason before pausing card refunds';
    end if;
    if not machine.nayax_refunds_enabled
      and machine.nayax_refund_max_amount_cents is null
      and machine.nayax_refunds_disabled_reason = normalized_disabled_reason then
      return jsonb_build_object(
        'ok', true, 'replayed', true, 'machineId', machine.id,
        'readinessState', case when activation_eligible then 'ready_to_activate' else 'setup_needed' end,
        'disabledReason', normalized_disabled_reason
      );
    end if;
    update public.reporting_machines
    set nayax_refunds_enabled = false,
        nayax_refund_max_amount_cents = null,
        nayax_refunds_disabled_reason = normalized_disabled_reason
    where id = machine.id;
  end if;

  insert into public.admin_audit_log (
    actor_user_id, action, entity_type, entity_id, before, after, meta
  ) values (
    actor_user_id,
    case when coalesce(p_enabled, false)
      then 'reporting_machine.card_refunds.activated'
      else 'reporting_machine.card_refunds.paused' end,
    'reporting_machine', machine.id::text,
    jsonb_build_object(
      'enabled', before_enabled,
      'limitCents', before_limit,
      'disabledReason', before_disabled_reason
    ),
    jsonb_build_object(
      'enabled', coalesce(p_enabled, false),
      'limitCents', case when coalesce(p_enabled, false) then 5000 else null end,
      'disabledReason', case when coalesce(p_enabled, false) then null else normalized_disabled_reason end
    ),
    jsonb_build_object(
      'reason', normalized_reason,
      'standardLaunchPolicy', true,
      'customerIntakeAccepting', customer_intake_accepting,
      'transactionLookupReady', transaction_lookup_ready,
      'transactionMatchingEnabled', coalesce(machine.refund_intake_enabled, false),
      'managerCount', manager_count
    )
  );

  return jsonb_build_object(
    'ok', true, 'replayed', false, 'machineId', machine.id,
    'readinessState', case when coalesce(p_enabled, false) then 'ready_to_refund'
      when activation_eligible then 'ready_to_activate' else 'setup_needed' end,
    'limitCents', case when coalesce(p_enabled, false) then 5000 else null end,
    'disabledReason', case when coalesce(p_enabled, false) then null else normalized_disabled_reason end
  );
end;
$$;

comment on function public.admin_set_refund_machine_card_activation(uuid, boolean, text, text) is
  'Super-Admin-only, row-locked, replay-safe activation or pause path. Activation revalidates every machine prerequisite and always applies the reviewed $50 launch cap.';

revoke execute on function public.admin_set_refund_machine_card_activation(uuid, boolean, text, text)
  from public, anon;
grant execute on function public.admin_set_refund_machine_card_activation(uuid, boolean, text, text)
  to authenticated;

create or replace function public.admin_activate_qualified_refund_machines(
  p_reason text default 'Reviewed qualified refund machine bulk activation'
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  actor_user_id uuid := auth.uid();
  normalized_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  candidate record;
  activated_count integer := 0;
  exception_count integer := 0;
begin
  if actor_user_id is null or not public.is_super_admin(actor_user_id) then
    raise exception 'Super Admin access required';
  end if;
  if normalized_reason is null or length(normalized_reason) < 8 then
    raise exception 'An audit reason of at least 8 characters is required';
  end if;

  for candidate in
    select machine.id, machine.nayax_refunds_disabled_reason
    from public.reporting_machines machine
    where machine.status = 'active'
      and machine.refund_intake_enabled
      and not machine.nayax_refunds_enabled
      and public.service_refund_machine_is_public(machine.id)
      and exists (
        select 1 from public.refund_nayax_machine_inventory inventory
        where inventory.reporting_machine_id = machine.id
          and inventory.provider_is_active
          and inventory.missing_successful_snapshots < 2
          and inventory.reconciliation_state = 'published'
          and inventory.account_key = upper(coalesce(machine.nayax_account_key, 'TGPACI_USA_DB'))
          and inventory.nayax_machine_id = btrim(coalesce(machine.nayax_machine_id, ''))
      )
      and (
        select count(*) from public.reporting_machine_refund_managers manager
        where manager.reporting_machine_id = machine.id
          and manager.status = 'active' and manager.revoked_at is null
      ) between 1 and 3
    order by machine.id
  loop
    if candidate.nayax_refunds_disabled_reason is not null
      and candidate.nayax_refunds_disabled_reason <> 'awaiting_reviewed_activation' then
      exception_count := exception_count + 1;
    else
      perform public.admin_set_refund_machine_card_activation(
        candidate.id, true, null, normalized_reason
      );
      activated_count := activated_count + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'activatedCount', activated_count,
    'approvedExceptionCount', exception_count,
    'standardLaunchLimitCents', 5000
  );
end;
$$;

comment on function public.admin_activate_qualified_refund_machines(text) is
  'Reviewed Super Admin bulk activation for every currently qualified payment-disabled machine without an approved pause exception.';

revoke execute on function public.admin_activate_qualified_refund_machines(text)
  from public, anon;
grant execute on function public.admin_activate_qualified_refund_machines(text)
  to authenticated;

select pg_notify('pgrst', 'reload schema');
