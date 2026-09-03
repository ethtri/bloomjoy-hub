-- Finish the reviewed production inventory reconciliation for issue #890.
--
-- Sixteen customer-facing machines receive exact Nayax identities, locations,
-- public labels, and the existing TGPaci manager route. Two ambiguous rows stay
-- explicitly in setup, and four unmistakable test/invalid rows are excluded.
-- Payment enablement is never changed.

create or replace function public.owner_reconcile_refund_nayax_active_inventory()
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  target record;
  tgpaci_account public.customer_accounts%rowtype;
  target_inventory public.refund_nayax_machine_inventory%rowtype;
  target_location public.reporting_locations%rowtype;
  target_machine public.reporting_machines%rowtype;
  cotton_anchor public.reporting_machines%rowtype;
  snapcase_anchor public.reporting_machines%rowtype;
  account_count integer;
  source_count integer;
  location_count integer;
  anchor_manager_count integer;
  published_count integer;
  public_count integer;
  setup_count integer;
  excluded_count integer;
  payment_enabled_count integer;
  manager_route_count integer;
begin
  perform pg_advisory_xact_lock(hashtext('refund_nayax_active_inventory_reconciliation_v1'));

  with reviewed_source(machine_name) as (
    values
      ('1045 Plymouth Meeting'),
      ('BS03 Gilroy Outlets'),
      ('Preit-0990Capital city'),
      ('preit1019-Willow Grove Park'),
      ('Preit1046-Moorestown'),
      ('Preit1077-Cherry Hill'),
      ('Preit1078-Viewmont mall'),
      ('Preit1085-Valley mall'),
      ('Simon 1591-Avenues Mall'),
      ('Simon-1584 Arizona Mills'),
      ('Simon-1585 Gurnee'),
      ('Simon-1592 Colorado Mills'),
      ('Simon1298-White Oaks'),
      ('Simon1302-South Hill Village'),
      ('Simon1303 University Park mall'),
      ('SnapCase Gilroy'),
      ('BS08 Popcorn Christiana mall'),
      ('Snapcase 03'),
      ('0.5760931367898853'),
      ('0.8832587390894364'),
      ('DU-tLiAeSjJmYLD'),
      ('Github Test')
  )
  select count(*)::integer
  into source_count
  from reviewed_source reviewed
  join public.refund_nayax_machine_inventory inventory
    on inventory.account_key = 'TGPACI_USA_DB'
   and inventory.machine_name = reviewed.machine_name
   and inventory.provider_is_active;

  -- Disposable/local installations do not contain the production inventory.
  if source_count = 0 then
    return jsonb_build_object(
      'skipped', true,
      'publishedMachineCount', 0,
      'setupMachineCount', 0,
      'excludedMachineCount', 0
    );
  end if;

  if source_count <> 22 then
    raise exception 'Expected exactly 22 reviewed active Nayax inventory rows';
  end if;

  select count(*)::integer
  into account_count
  from public.customer_accounts account
  where lower(btrim(account.name)) = 'tgpaci'
    and account.status = 'active';

  if account_count <> 1 then
    raise exception 'Expected exactly one active TGPaci reporting account';
  end if;

  select account.*
  into tgpaci_account
  from public.customer_accounts account
  where lower(btrim(account.name)) = 'tgpaci'
    and account.status = 'active';

  select machine.*
  into cotton_anchor
  from public.reporting_machines machine
  where machine.account_id = tgpaci_account.id
    and machine.machine_label = 'BS06 Great mall'
    and machine.status = 'active';

  select machine.*
  into snapcase_anchor
  from public.reporting_machines machine
  where machine.account_id = tgpaci_account.id
    and machine.machine_label = 'SnapCase Great Mall'
    and machine.status = 'active';

  if cotton_anchor.id is null or snapcase_anchor.id is null then
    raise exception 'Expected the reviewed Cotton Candy and Snapcase manager-route anchors';
  end if;

  select count(*)::integer
  into anchor_manager_count
  from public.reporting_machine_refund_managers manager
  where manager.reporting_machine_id = cotton_anchor.id
    and manager.status = 'active'
    and manager.revoked_at is null;

  if anchor_manager_count < 1 or anchor_manager_count > 3 then
    raise exception 'The Cotton Candy manager-route anchor must have one to three active managers';
  end if;

  select count(*)::integer
  into anchor_manager_count
  from public.reporting_machine_refund_managers manager
  where manager.reporting_machine_id = snapcase_anchor.id
    and manager.status = 'active'
    and manager.revoked_at is null;

  if anchor_manager_count < 1 or anchor_manager_count > 3 then
    raise exception 'The Snapcase manager-route anchor must have one to three active managers';
  end if;

  for target in
    select *
    from (values
      ('1045 Plymouth Meeting', 'Plymouth Meeting Mall', 'Plymouth Meeting Mall — Cotton Candy', 'Plymouth Meeting', 'PA', 'America/New_York', 'cotton_candy', 'commercial', 'cotton'),
      ('BS03 Gilroy Outlets', 'Gilroy Premium Outlets', 'Gilroy Premium Outlets — Cotton Candy', 'Gilroy', 'CA', 'America/Los_Angeles', 'cotton_candy', 'commercial', 'cotton'),
      ('Preit-0990Capital city', 'Capital City Mall', 'Capital City Mall — Cotton Candy', 'Camp Hill', 'PA', 'America/New_York', 'cotton_candy', 'commercial', 'cotton'),
      ('preit1019-Willow Grove Park', 'Willow Grove Park Mall', 'Willow Grove Park Mall — Cotton Candy', 'Willow Grove', 'PA', 'America/New_York', 'cotton_candy', 'commercial', 'cotton'),
      ('Preit1046-Moorestown', 'Moorestown Mall', 'Moorestown Mall — Cotton Candy', 'Moorestown', 'NJ', 'America/New_York', 'cotton_candy', 'commercial', 'cotton'),
      ('Preit1077-Cherry Hill', 'Cherry Hill Mall', 'Cherry Hill Mall — Cotton Candy', 'Cherry Hill', 'NJ', 'America/New_York', 'cotton_candy', 'commercial', 'cotton'),
      ('Preit1078-Viewmont mall', 'Viewmont Mall', 'Viewmont Mall — Cotton Candy', 'Dickson City', 'PA', 'America/New_York', 'cotton_candy', 'commercial', 'cotton'),
      ('Preit1085-Valley mall', 'Valley Mall', 'Valley Mall — Cotton Candy', 'Hagerstown', 'MD', 'America/New_York', 'cotton_candy', 'commercial', 'cotton'),
      ('Simon 1591-Avenues Mall', 'The Avenues', 'The Avenues — Cotton Candy', 'Jacksonville', 'FL', 'America/New_York', 'cotton_candy', 'commercial', 'cotton'),
      ('Simon-1584 Arizona Mills', 'Arizona Mills', 'Arizona Mills — Cotton Candy', 'Tempe', 'AZ', 'America/Phoenix', 'cotton_candy', 'commercial', 'cotton'),
      ('Simon-1585 Gurnee', 'Gurnee Mills', 'Gurnee Mills — Cotton Candy', 'Gurnee', 'IL', 'America/Chicago', 'cotton_candy', 'commercial', 'cotton'),
      ('Simon-1592 Colorado Mills', 'Colorado Mills', 'Colorado Mills — Cotton Candy', 'Lakewood', 'CO', 'America/Denver', 'cotton_candy', 'commercial', 'cotton'),
      ('Simon1298-White Oaks', 'White Oaks Mall', 'White Oaks Mall — Cotton Candy', 'Springfield', 'IL', 'America/Chicago', 'cotton_candy', 'commercial', 'cotton'),
      ('Simon1302-South Hill Village', 'South Hills Village', 'South Hills Village — Cotton Candy', 'Pittsburgh', 'PA', 'America/New_York', 'cotton_candy', 'commercial', 'cotton'),
      ('Simon1303 University Park mall', 'University Park Mall', 'University Park Mall — Cotton Candy', 'Mishawaka', 'IN', 'America/Indiana/Indianapolis', 'cotton_candy', 'commercial', 'cotton'),
      ('SnapCase Gilroy', 'Gilroy Premium Outlets', 'Gilroy Premium Outlets — Snapcase', 'Gilroy', 'CA', 'America/Los_Angeles', 'snapcase', 'unknown', 'snapcase')
    ) as reviewed(
      provider_machine_name,
      location_name,
      public_label,
      city,
      state,
      timezone,
      refund_category,
      machine_type,
      manager_route
    )
    order by provider_machine_name
  loop
    select count(*)::integer
    into source_count
    from public.refund_nayax_machine_inventory inventory
    where inventory.account_key = 'TGPACI_USA_DB'
      and inventory.machine_name = target.provider_machine_name
      and inventory.provider_is_active;

    if source_count <> 1 then
      raise exception 'Each reviewed publish target must resolve to one active inventory row';
    end if;

    select inventory.*
    into target_inventory
    from public.refund_nayax_machine_inventory inventory
    where inventory.account_key = 'TGPACI_USA_DB'
      and inventory.machine_name = target.provider_machine_name
      and inventory.provider_is_active
    for update;

    select count(*)::integer
    into location_count
    from public.reporting_locations location
    where location.account_id = tgpaci_account.id
      and lower(btrim(location.name)) = lower(target.location_name);

    if location_count > 1 then
      raise exception 'A reviewed target location is duplicated';
    end if;

    if location_count = 0 then
      insert into public.reporting_locations (
        account_id,
        name,
        partner_name,
        city,
        state,
        timezone,
        status,
        notes
      ) values (
        tgpaci_account.id,
        target.location_name,
        'TGPaci',
        target.city,
        target.state,
        target.timezone,
        'active',
        'Created from the reviewed active Nayax inventory reconciliation (#890).'
      );
    end if;

    select location.*
    into target_location
    from public.reporting_locations location
    where location.account_id = tgpaci_account.id
      and lower(btrim(location.name)) = lower(target.location_name)
    for update;

    if target_location.status <> 'active' or target_location.timezone <> target.timezone then
      raise exception 'A reviewed target location is inactive or has an unexpected timezone';
    end if;

    select machine.*
    into target_machine
    from public.reporting_machines machine
    where lower(coalesce(machine.nayax_account_key, '')) = lower(target_inventory.account_key)
      and lower(coalesce(machine.nayax_machine_id, '')) = lower(target_inventory.nayax_machine_id)
    for update;

    if target_machine.id is null then
      insert into public.reporting_machines (
        account_id,
        location_id,
        machine_label,
        machine_type,
        status,
        notes,
        nayax_machine_id,
        nayax_account_key,
        nayax_refunds_enabled,
        nayax_refund_max_amount_cents,
        refund_intake_enabled,
        refund_public_display_label
      ) values (
        tgpaci_account.id,
        target_location.id,
        target.provider_machine_name,
        target.machine_type,
        'active',
        'Exact provider identity created from the reviewed active Nayax inventory (#890).',
        target_inventory.nayax_machine_id,
        target_inventory.account_key,
        false,
        null,
        true,
        target.public_label
      )
      returning * into target_machine;
    end if;

    if target_machine.account_id <> tgpaci_account.id
      or target_machine.location_id <> target_location.id
      or target_machine.status <> 'active'
      or btrim(target_machine.nayax_machine_id) <> target_inventory.nayax_machine_id
      or upper(btrim(target_machine.nayax_account_key)) <> target_inventory.account_key then
      raise exception 'A reviewed provider identity conflicts with an existing reporting machine';
    end if;

    if target_inventory.reporting_machine_id is not null
      and target_inventory.reporting_machine_id <> target_machine.id then
      raise exception 'A reviewed inventory row is already mapped to another reporting machine';
    end if;

    update public.reporting_machines
    set
      machine_type = target.machine_type,
      refund_intake_enabled = true,
      refund_public_display_label = target.public_label,
      updated_at = now()
    where id = target_machine.id;

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
      manager.manager_user_id,
      manager.manager_email,
      'active',
      'Copied from the reviewed ' || target.manager_route || ' manager route for issue #890.',
      manager.granted_by
    from public.reporting_machine_refund_managers manager
    where manager.reporting_machine_id = case
        when target.manager_route = 'snapcase' then snapcase_anchor.id
        else cotton_anchor.id
      end
      and manager.status = 'active'
      and manager.revoked_at is null
      and not exists (
        select 1
        from public.reporting_machine_refund_managers existing
        where existing.reporting_machine_id = target_machine.id
          and existing.manager_user_id = manager.manager_user_id
          and existing.status = 'active'
          and existing.revoked_at is null
      );

    select count(*)::integer
    into manager_route_count
    from public.reporting_machine_refund_managers manager
    where manager.reporting_machine_id = target_machine.id
      and manager.status = 'active'
      and manager.revoked_at is null;

    if manager_route_count < 1 or manager_route_count > 3 then
      raise exception 'Every published machine must have one to three active managers';
    end if;

    update public.refund_nayax_machine_inventory
    set
      refund_category = target.refund_category,
      reporting_machine_id = target_machine.id,
      reconciliation_state = 'published',
      setup_reason = 'ready',
      exclusion_reason = null,
      decision_reason = 'Reviewed active production mapping for issue #890.',
      decided_by = null,
      decided_at = now(),
      updated_at = now()
    where id = target_inventory.id;
  end loop;

  if exists (
    select 1
    from public.refund_nayax_machine_inventory inventory
    where inventory.account_key = 'TGPACI_USA_DB'
      and inventory.machine_name in ('Snapcase 03', 'BS08 Popcorn Christiana mall')
      and inventory.provider_is_active
      and inventory.reporting_machine_id is not null
  ) then
    raise exception 'A reviewed setup row is already mapped and cannot be reopened automatically';
  end if;

  update public.refund_nayax_machine_inventory
  set
    refund_category = 'snapcase',
    reconciliation_state = 'needs_setup',
    setup_reason = 'customer_safe_location_required',
    exclusion_reason = null,
    decision_reason = 'Snapcase identity is clear, but the provider name does not identify a customer-safe location.',
    decided_by = null,
    decided_at = now(),
    updated_at = now()
  where account_key = 'TGPACI_USA_DB'
    and machine_name = 'Snapcase 03'
    and provider_is_active;

  update public.refund_nayax_machine_inventory
  set
    refund_category = null,
    reconciliation_state = 'needs_setup',
    setup_reason = 'refund_category_confirmation_required',
    exclusion_reason = null,
    decision_reason = 'The active provider row is labeled Popcorn; refund category must be confirmed before public intake.',
    decided_by = null,
    decided_at = now(),
    updated_at = now()
  where account_key = 'TGPACI_USA_DB'
    and machine_name = 'BS08 Popcorn Christiana mall'
    and provider_is_active;

  if exists (
    select 1
    from public.refund_nayax_machine_inventory inventory
    where inventory.account_key = 'TGPACI_USA_DB'
      and inventory.machine_name in (
        '0.5760931367898853',
        '0.8832587390894364',
        'DU-tLiAeSjJmYLD',
        'Github Test'
      )
      and inventory.provider_is_active
      and inventory.reporting_machine_id is not null
  ) then
    raise exception 'A reviewed exclusion row is already mapped and cannot be excluded automatically';
  end if;

  update public.refund_nayax_machine_inventory
  set
    refund_category = null,
    reconciliation_state = 'excluded',
    setup_reason = 'not_applicable',
    exclusion_reason = 'Provider row is an explicit test or invalid machine name, not a customer-facing refund option.',
    decision_reason = 'Reviewed and excluded during active production inventory reconciliation for issue #890.',
    decided_by = null,
    decided_at = now(),
    updated_at = now()
  where account_key = 'TGPACI_USA_DB'
    and machine_name in (
      '0.5760931367898853',
      '0.8832587390894364',
      'DU-tLiAeSjJmYLD',
      'Github Test'
    )
    and provider_is_active;

  with publish_target(machine_name) as (
    values
      ('1045 Plymouth Meeting'),
      ('BS03 Gilroy Outlets'),
      ('Preit-0990Capital city'),
      ('preit1019-Willow Grove Park'),
      ('Preit1046-Moorestown'),
      ('Preit1077-Cherry Hill'),
      ('Preit1078-Viewmont mall'),
      ('Preit1085-Valley mall'),
      ('Simon 1591-Avenues Mall'),
      ('Simon-1584 Arizona Mills'),
      ('Simon-1585 Gurnee'),
      ('Simon-1592 Colorado Mills'),
      ('Simon1298-White Oaks'),
      ('Simon1302-South Hill Village'),
      ('Simon1303 University Park mall'),
      ('SnapCase Gilroy')
  )
  select count(*)::integer,
         count(*) filter (where public.service_refund_machine_is_public(machine.id))::integer,
         count(*) filter (where machine.nayax_refunds_enabled)::integer,
         count(*) filter (where manager.manager_count between 1 and 3)::integer
  into published_count, public_count, payment_enabled_count, manager_route_count
  from publish_target publish_row
  join public.refund_nayax_machine_inventory inventory
    on inventory.account_key = 'TGPACI_USA_DB'
   and inventory.machine_name = publish_row.machine_name
   and inventory.provider_is_active
   and inventory.reconciliation_state = 'published'
   and inventory.reporting_machine_id is not null
  join public.reporting_machines machine on machine.id = inventory.reporting_machine_id
  join lateral (
    select count(*)::integer as manager_count
    from public.reporting_machine_refund_managers route
    where route.reporting_machine_id = machine.id
      and route.status = 'active'
      and route.revoked_at is null
  ) manager on true;

  if published_count <> 16 or public_count <> 16 or payment_enabled_count <> 0 or manager_route_count <> 16 then
    raise exception 'The reviewed publish set did not finish public, routed, and payment-disabled';
  end if;

  select count(*)::integer
  into setup_count
  from public.refund_nayax_machine_inventory inventory
  where inventory.account_key = 'TGPACI_USA_DB'
    and inventory.machine_name in ('Snapcase 03', 'BS08 Popcorn Christiana mall')
    and inventory.provider_is_active
    and inventory.reconciliation_state = 'needs_setup'
    and nullif(btrim(inventory.setup_reason), '') is not null
    and inventory.reporting_machine_id is null;

  select count(*)::integer
  into excluded_count
  from public.refund_nayax_machine_inventory inventory
  where inventory.account_key = 'TGPACI_USA_DB'
    and inventory.machine_name in (
      '0.5760931367898853',
      '0.8832587390894364',
      'DU-tLiAeSjJmYLD',
      'Github Test'
    )
    and inventory.provider_is_active
    and inventory.reconciliation_state = 'excluded'
    and nullif(btrim(inventory.exclusion_reason), '') is not null
    and inventory.reporting_machine_id is null;

  if setup_count <> 2 or excluded_count <> 4 then
    raise exception 'The reviewed setup/exclusion set did not finish explicitly classified';
  end if;

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
    'refund_nayax_inventory.active_inventory_reconciliation',
    'reporting_machine_portfolio',
    'refund-nayax-active-inventory-v1',
    jsonb_build_object('reviewedActiveMachineCount', 22),
    jsonb_build_object(
      'publishedMachineCount', published_count,
      'setupMachineCount', setup_count,
      'excludedMachineCount', excluded_count,
      'publicMachineCount', public_count
    ),
    jsonb_build_object(
      'issue', 890,
      'matchingBasis', 'reviewed_exact_provider_identity_and_customer_safe_location',
      'livePaymentEnablementChanged', false,
      'providerActionTaken', false,
      'customerContact', false,
      'payloadRedacted', true
    )
  );

  return jsonb_build_object(
    'skipped', false,
    'publishedMachineCount', published_count,
    'setupMachineCount', setup_count,
    'excludedMachineCount', excluded_count,
    'publicMachineCount', public_count,
    'livePaymentEnablementChanged', false
  );
end;
$$;

revoke all on function public.owner_reconcile_refund_nayax_active_inventory()
  from public, anon, authenticated, service_role;

select public.owner_reconcile_refund_nayax_active_inventory();

comment on function public.owner_reconcile_refund_nayax_active_inventory() is
  'Database-owner-only exact-set reconciliation for the remaining 22 reviewed active Nayax rows. Publishes 16 customer-safe mappings, leaves two explicit setup rows, excludes four test/invalid rows, and never changes payment enablement.';

select pg_notify('pgrst', 'reload schema');
