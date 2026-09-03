-- Repair the nine production Nayax mappings that have one unambiguous
-- customer-facing machine/location match. This is a data repair only:
-- transaction lookup is enabled, while live payment enablement is unchanged.

create or replace function public.owner_repair_refund_nayax_obvious_mappings()
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  mapping_record record;
  reporting public.reporting_machines%rowtype;
  inventory public.refund_nayax_machine_inventory%rowtype;
  target_location public.reporting_locations%rowtype;
  target_count integer;
  inventory_count integer;
  source_count integer;
  manager_count integer;
  unsafe_case_count integer;
  repaired_case_count integer := 0;
  repaired_this_mapping integer := 0;
  final_mapping_count integer;
  public_mapping_count integer;
begin
  perform pg_advisory_xact_lock(hashtext('refund_nayax_obvious_mapping_repair_v1'));

  with reviewed_mapping(account_name, reporting_machine_label, provider_machine_name) as (
    values
      ('TGPaci', 'BS02 1st Livermore', '1st Livermore outlets'),
      ('TGPaci', 'BS03 2nd Livermore', '2nd Livermore outlets'),
      ('TGPaci', 'BS09 2nd Stoneridge mall', 'BS01 Stoneridge mall New'),
      ('TGPaci', 'Tulsa PO New', 'BS05 New Tulsa PO'),
      ('TGPaci', 'BS06 Great mall', 'BS06 Great mall'),
      ('TGPaci', 'BS08 Woodland Hill', 'BS07 Woodland Hill'),
      ('Merlin Entertainments', 'Madame Tussauds Vegas', 'Madame Tussauds'),
      ('Merlin Entertainments', 'PEPPA PIG Theme Park Dallas-Fort Worth', 'Peppa Pig Dallas'),
      ('Merlin Entertainments', 'SEA LIFE Grapevine', 'Dallas Sea Life')
  )
  select count(*)::integer
  into target_count
  from reviewed_mapping mapping
  join public.customer_accounts account
    on lower(btrim(account.name)) = lower(mapping.account_name)
  join public.reporting_machines machine
    on machine.account_id = account.id
   and machine.machine_label = mapping.reporting_machine_label;

  -- Disposable installations do not contain the production portfolio.
  if target_count = 0 then
    return jsonb_build_object(
      'skipped', true,
      'mappedMachineCount', 0,
      'repairedCaseCount', 0
    );
  end if;

  if target_count <> 9 then
    raise exception 'Expected exactly nine reviewed reporting-machine targets';
  end if;

  with reviewed_mapping(provider_machine_name) as (
    values
      ('1st Livermore outlets'),
      ('2nd Livermore outlets'),
      ('BS01 Stoneridge mall New'),
      ('BS05 New Tulsa PO'),
      ('BS06 Great mall'),
      ('BS07 Woodland Hill'),
      ('Madame Tussauds'),
      ('Peppa Pig Dallas'),
      ('Dallas Sea Life')
  )
  select count(*)::integer
  into inventory_count
  from reviewed_mapping mapping
  join public.refund_nayax_machine_inventory candidate
    on candidate.account_key = 'TGPACI_USA_DB'
   and candidate.machine_name = mapping.provider_machine_name
   and candidate.provider_is_active;

  if inventory_count <> 9 then
    raise exception 'Expected exactly nine reviewed active Nayax inventory sources';
  end if;

  for mapping_record in
    select *
    from (values
      ('TGPaci', 'BS02 1st Livermore', '1st Livermore outlets', 'San Francisco Premium Outlets', 'Livermore', 'CA', 'America/Los_Angeles'),
      ('TGPaci', 'BS03 2nd Livermore', '2nd Livermore outlets', 'San Francisco Premium Outlets', 'Livermore', 'CA', 'America/Los_Angeles'),
      ('TGPaci', 'BS09 2nd Stoneridge mall', 'BS01 Stoneridge mall New', 'Stoneridge Shopping Center', 'Pleasanton', 'CA', 'America/Los_Angeles'),
      ('TGPaci', 'Tulsa PO New', 'BS05 New Tulsa PO', 'Tulsa Premium Outlets', null, 'OK', 'America/Chicago'),
      ('TGPaci', 'BS06 Great mall', 'BS06 Great mall', 'Great Mall of the Bay Area', 'Milpitas', 'CA', 'America/Los_Angeles'),
      ('TGPaci', 'BS08 Woodland Hill', 'BS07 Woodland Hill', 'Woodland Hills Mall', 'Tulsa', 'OK', 'America/Chicago'),
      ('Merlin Entertainments', 'Madame Tussauds Vegas', 'Madame Tussauds', 'Las Vegas', null, 'NV', 'America/Los_Angeles'),
      ('Merlin Entertainments', 'PEPPA PIG Theme Park Dallas-Fort Worth', 'Peppa Pig Dallas', 'PEPPA PIG Theme Park Dallas-Fort Worth', 'North Richland Hills', 'TX', 'America/Chicago'),
      ('Merlin Entertainments', 'SEA LIFE Grapevine', 'Dallas Sea Life', 'SEA LIFE Grapevine', 'Grapevine', 'TX', 'America/Chicago')
    ) as reviewed(
      account_name,
      reporting_machine_label,
      provider_machine_name,
      location_name,
      city,
      state,
      timezone
    )
    order by account_name, reporting_machine_label
  loop
    select count(*)::integer
    into source_count
    from public.refund_nayax_machine_inventory candidate
    where candidate.account_key = 'TGPACI_USA_DB'
      and candidate.machine_name = mapping_record.provider_machine_name
      and candidate.provider_is_active;

    if source_count <> 1 then
      raise exception 'Each reviewed provider name must resolve to exactly one active inventory row';
    end if;

    select candidate.*
    into inventory
    from public.refund_nayax_machine_inventory candidate
    where candidate.account_key = 'TGPACI_USA_DB'
      and candidate.machine_name = mapping_record.provider_machine_name
      and candidate.provider_is_active
    for update;

    select machine.*
    into reporting
    from public.reporting_machines machine
    join public.customer_accounts account on account.id = machine.account_id
    where lower(btrim(account.name)) = lower(mapping_record.account_name)
      and machine.machine_label = mapping_record.reporting_machine_label
    for update of machine;

    if reporting.status <> 'active' then
      raise exception 'Every reviewed reporting machine must remain active';
    end if;
    if inventory.reporting_machine_id is not null
      and inventory.reporting_machine_id <> reporting.id then
      raise exception 'A reviewed Nayax inventory row is already mapped to another machine';
    end if;
    if nullif(btrim(reporting.nayax_machine_id), '') is not null
      and btrim(reporting.nayax_machine_id) <> inventory.nayax_machine_id then
      raise exception 'A reviewed reporting machine already has a different Nayax machine ID';
    end if;
    if nullif(btrim(reporting.nayax_account_key), '') is not null
      and upper(btrim(reporting.nayax_account_key)) <> inventory.account_key then
      raise exception 'A reviewed reporting machine already has a different Nayax account';
    end if;
    if inventory.refund_category is not null
      and inventory.refund_category <> 'cotton_candy' then
      raise exception 'A reviewed mapping has a conflicting refund category';
    end if;

    select count(*)::integer
    into manager_count
    from public.reporting_machine_refund_managers manager
    where manager.reporting_machine_id = reporting.id
      and manager.status = 'active'
      and manager.revoked_at is null;

    if manager_count < 1 or manager_count > 3 then
      raise exception 'Every reviewed mapping requires one to three active managers';
    end if;

    insert into public.reporting_locations (
      account_id,
      name,
      partner_name,
      city,
      state,
      timezone,
      status,
      notes
    )
    select
      reporting.account_id,
      mapping_record.location_name,
      mapping_record.account_name,
      mapping_record.city,
      mapping_record.state,
      mapping_record.timezone,
      'active',
      'Verified during Refund Operations Nayax mapping repair (#890).'
    where not exists (
      select 1
      from public.reporting_locations existing
      where existing.account_id = reporting.account_id
        and lower(btrim(existing.name)) = lower(mapping_record.location_name)
    );

    select location.*
    into target_location
    from public.reporting_locations location
    where location.account_id = reporting.account_id
      and lower(btrim(location.name)) = lower(mapping_record.location_name)
    for update;

    if target_location.status <> 'active'
      or target_location.timezone <> mapping_record.timezone then
      raise exception 'A reviewed target location is inactive or has the wrong timezone';
    end if;

    select count(*)::integer
    into unsafe_case_count
    from public.refund_cases refund_case
    where refund_case.reporting_machine_id = reporting.id
      and refund_case.reporting_location_id <> target_location.id
      and (
        refund_case.status <> 'needs_review'
        or refund_case.correlation_status <> 'nayax_not_configured'
        or refund_case.decision is not null
        or refund_case.matched_nayax_transaction_id is not null
        or refund_case.refund_completed_at is not null
        or refund_case.nayax_refund_execution_status <> 'not_requested'
        or exists (
          select 1
          from public.refund_case_nayax_refund_attempts attempt
          where attempt.refund_case_id = refund_case.id
        )
      );

    if unsafe_case_count <> 0 then
      raise exception 'A reviewed mapping has a case that cannot be safely moved to the verified location';
    end if;

    update public.reporting_machines
    set
      location_id = target_location.id,
      nayax_machine_id = inventory.nayax_machine_id,
      nayax_account_key = inventory.account_key,
      refund_intake_enabled = true,
      refund_public_display_label = coalesce(
        nullif(btrim(refund_public_display_label), ''),
        machine_label
      )
    where id = reporting.id;

    update public.refund_nayax_machine_inventory
    set
      refund_category = 'cotton_candy',
      reporting_machine_id = reporting.id,
      reconciliation_state = 'published',
      setup_reason = 'ready',
      exclusion_reason = null,
      decision_reason = 'Exact production name/location mapping repair for issue #890.',
      decided_by = null,
      decided_at = now(),
      updated_at = now()
    where id = inventory.id;

    with repaired_case as (
      update public.refund_cases refund_case
      set
        reporting_location_id = target_location.id,
        incident_timezone = target_location.timezone,
        correlation_status = 'needs_nayax',
        correlation_source = 'nayax',
        correlation_confidence = 0,
        correlation_summary = 'Nayax mapping repaired; transaction search is queued to run again.',
        automation_state = 'under_review',
        nayax_recommendation_state = null,
        nayax_recommendation_policy_version = null,
        nayax_recommendation_evaluated_at = null,
        nayax_match_execution_eligible = false,
        deterministic_fact_version = deterministic_fact_version + 1,
        deterministic_facts_updated_at = now(),
        updated_at = now()
      where refund_case.reporting_machine_id = reporting.id
        and refund_case.reporting_location_id <> target_location.id
        and refund_case.status = 'needs_review'
        and refund_case.correlation_status = 'nayax_not_configured'
        and refund_case.decision is null
        and refund_case.matched_nayax_transaction_id is null
        and refund_case.refund_completed_at is null
        and refund_case.nayax_refund_execution_status = 'not_requested'
        and not exists (
          select 1
          from public.refund_case_nayax_refund_attempts attempt
          where attempt.refund_case_id = refund_case.id
        )
      returning refund_case.id, refund_case.deterministic_fact_version
    )
    insert into public.refund_case_events (
      refund_case_id,
      event_type,
      message,
      metadata
    )
    select
      repaired_case.id,
      'nayax_mapping_repaired_retry_queued',
      'The exact machine mapping was repaired and transaction search was queued to run again.',
      jsonb_build_object(
        'deterministic_fact_version', repaired_case.deterministic_fact_version,
        'payload_redacted', true,
        'provider_action_taken', false,
        'payment_action_taken', false
      )
    from repaired_case;

    get diagnostics repaired_this_mapping = row_count;
    repaired_case_count := repaired_case_count + repaired_this_mapping;
  end loop;

  with reviewed_target(account_name, reporting_machine_label) as (
    values
      ('TGPaci', 'BS02 1st Livermore'),
      ('TGPaci', 'BS03 2nd Livermore'),
      ('TGPaci', 'BS09 2nd Stoneridge mall'),
      ('TGPaci', 'Tulsa PO New'),
      ('TGPaci', 'BS06 Great mall'),
      ('TGPaci', 'BS08 Woodland Hill'),
      ('Merlin Entertainments', 'Madame Tussauds Vegas'),
      ('Merlin Entertainments', 'PEPPA PIG Theme Park Dallas-Fort Worth'),
      ('Merlin Entertainments', 'SEA LIFE Grapevine')
  )
  select count(*)::integer
  into final_mapping_count
  from reviewed_target target
  join public.customer_accounts account
    on lower(btrim(account.name)) = lower(target.account_name)
  join public.reporting_machines machine
    on machine.account_id = account.id
   and machine.machine_label = target.reporting_machine_label
  join public.refund_nayax_machine_inventory inventory_row
    on inventory_row.reporting_machine_id = machine.id
   and inventory_row.account_key = upper(machine.nayax_account_key)
   and inventory_row.nayax_machine_id = btrim(machine.nayax_machine_id)
  where machine.status = 'active'
    and machine.refund_intake_enabled
    and inventory_row.provider_is_active
    and inventory_row.reconciliation_state = 'published'
    and inventory_row.refund_category = 'cotton_candy';

  if final_mapping_count <> 9 then
    raise exception 'The repair did not end with nine exact published mappings';
  end if;

  with reviewed_target(account_name, reporting_machine_label) as (
    values
      ('TGPaci', 'BS02 1st Livermore'),
      ('TGPaci', 'BS03 2nd Livermore'),
      ('TGPaci', 'BS09 2nd Stoneridge mall'),
      ('TGPaci', 'Tulsa PO New'),
      ('TGPaci', 'BS06 Great mall'),
      ('TGPaci', 'BS08 Woodland Hill'),
      ('Merlin Entertainments', 'Madame Tussauds Vegas'),
      ('Merlin Entertainments', 'PEPPA PIG Theme Park Dallas-Fort Worth'),
      ('Merlin Entertainments', 'SEA LIFE Grapevine')
  )
  select count(*)::integer
  into public_mapping_count
  from reviewed_target target
  join public.customer_accounts account
    on lower(btrim(account.name)) = lower(target.account_name)
  join public.reporting_machines machine
    on machine.account_id = account.id
   and machine.machine_label = target.reporting_machine_label
  where public.service_refund_machine_is_public(machine.id);

  if public_mapping_count <> 9 then
    raise exception 'Every repaired mapping must remain available in customer intake';
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
    'refund_nayax_inventory.production_mapping_repair',
    'reporting_machine_portfolio',
    'refund-nayax-obvious-mapping-v1',
    jsonb_build_object('reviewedMappingCount', 9),
    jsonb_build_object(
      'publishedMappingCount', final_mapping_count,
      'publicMappingCount', public_mapping_count,
      'repairedCaseCount', repaired_case_count
    ),
    jsonb_build_object(
      'issue', 890,
      'matchingBasis', 'reviewed_unique_name_and_location',
      'livePaymentEnablementChanged', false,
      'providerActionTaken', false,
      'customerContact', false,
      'payloadRedacted', true
    )
  );

  return jsonb_build_object(
    'skipped', false,
    'mappedMachineCount', final_mapping_count,
    'publicMachineCount', public_mapping_count,
    'repairedCaseCount', repaired_case_count,
    'livePaymentEnablementChanged', false
  );
end;
$$;

revoke all on function public.owner_repair_refund_nayax_obvious_mappings()
  from public, anon, authenticated, service_role;

select public.owner_repair_refund_nayax_obvious_mappings();

comment on function public.owner_repair_refund_nayax_obvious_mappings() is
  'Database-owner-only exact-set repair for nine reviewed production Nayax name/location mappings. Queues safe setup-blocked cases for a fresh read-only lookup and does not enable live payment.';
