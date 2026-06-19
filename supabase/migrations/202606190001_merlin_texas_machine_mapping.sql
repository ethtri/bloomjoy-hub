-- Map newly discovered Texas Merlin source machines into canonical reporting.
-- These source machines were discovered by the Sunze import queue after the
-- initial Merlin cleanup migration.

do $$
declare
  merlin_partnership public.reporting_partnerships;
  merlin_partner public.reporting_partners;
  merlin_account public.customer_accounts;
  merlin_location public.reporting_locations;
  merlin_machine public.reporting_machines;
  machine_record record;
  promoted_source_order_hashes text[];
begin
  select *
  into merlin_partnership
  from public.reporting_partnerships partnership
  where lower(partnership.name) = lower('Merlin Revenue Share')
    and partnership.status in ('draft', 'active')
  limit 1;

  if merlin_partnership.id is null then
    return;
  end if;

  select partner.*
  into merlin_partner
  from public.reporting_partnership_parties party
  join public.reporting_partners partner on partner.id = party.partner_id
  where party.partnership_id = merlin_partnership.id
    and partner.status = 'active'
  order by
    case party.party_role
      when 'revenue_share_recipient' then 0
      when 'venue_partner' then 1
      else 2
    end,
    party.created_at asc
  limit 1;

  if merlin_partner.id is not null then
    update public.reporting_partners
    set
      name = case
        when not exists (
          select 1
          from public.reporting_partners partner
          where lower(partner.name) = lower('Merlin Entertainments')
            and partner.id <> merlin_partner.id
        ) then 'Merlin Entertainments'
        else name
      end,
      legal_name = coalesce(
        nullif(legal_name, ''),
        'MERLIN ENTERTAINMENTS GROUP U.S. HOLDINGS INC.'
      )
    where id = merlin_partner.id
    returning * into merlin_partner;
  end if;

  select *
  into merlin_account
  from public.customer_accounts account
  where lower(account.name) = lower('Merlin Entertainments')
  limit 1;

  if merlin_account.id is null then
    insert into public.customer_accounts (
      name,
      account_type,
      status,
      notes
    )
    values (
      'Merlin Entertainments',
      'partner',
      'active',
      'Created by Merlin Texas machine mapping.'
    )
    returning * into merlin_account;
  else
    update public.customer_accounts
    set
      account_type = 'partner',
      status = 'active'
    where id = merlin_account.id
    returning * into merlin_account;
  end if;

  for machine_record in
    select *
    from (
      values
        (
          'PEPPA PIG Theme Park Dallas-Fort Worth',
          'PEPPA PIG Theme Park Dallas-Fort Worth',
          'Peppa Pig',
          'North Richland Hills',
          'TX',
          'America/Chicago',
          '1777281426074167988377962',
          date '2026-06-16'
        ),
        (
          'SEA LIFE Grapevine',
          'SEA LIFE Grapevine',
          'Dallas Sea Life',
          'Grapevine',
          'TX',
          'America/Chicago',
          '1776409726952851603526190',
          date '2026-06-06'
        )
    ) as machine_values(
      machine_label,
      location_name,
      source_machine_name,
      city,
      state,
      timezone,
      external_machine_id,
      effective_start_date
    )
  loop
    select *
    into merlin_location
    from public.reporting_locations location
    where location.account_id = merlin_account.id
      and lower(location.name) = lower(machine_record.location_name)
    limit 1;

    if merlin_location.id is null then
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
      values (
        merlin_account.id,
        machine_record.location_name,
        'Merlin Entertainments',
        machine_record.city,
        machine_record.state,
        machine_record.timezone,
        'active',
        'Created by Merlin Texas machine mapping.'
      )
      returning * into merlin_location;
    else
      update public.reporting_locations
      set
        partner_name = 'Merlin Entertainments',
        city = machine_record.city,
        state = machine_record.state,
        timezone = machine_record.timezone,
        status = 'active'
      where id = merlin_location.id
      returning * into merlin_location;
    end if;

    select *
    into merlin_machine
    from public.reporting_machines machine
    where lower(machine.sunze_machine_id) = lower(machine_record.external_machine_id)
    limit 1;

    if merlin_machine.id is null then
      insert into public.reporting_machines (
        account_id,
        location_id,
        machine_label,
        machine_type,
        sunze_machine_id,
        status,
        notes
      )
      values (
        merlin_account.id,
        merlin_location.id,
        machine_record.machine_label,
        'commercial',
        machine_record.external_machine_id,
        'active',
        'Created by Merlin Texas machine mapping.'
      )
      returning * into merlin_machine;
    else
      update public.reporting_machines
      set
        account_id = merlin_account.id,
        location_id = merlin_location.id,
        machine_label = machine_record.machine_label,
        machine_type = 'commercial',
        sunze_machine_id = machine_record.external_machine_id,
        status = 'active'
      where id = merlin_machine.id
      returning * into merlin_machine;
    end if;

    insert into public.sunze_machine_discoveries (
      sunze_machine_id,
      sunze_machine_name,
      status,
      reporting_machine_id,
      mapped_at
    )
    values (
      machine_record.external_machine_id,
      machine_record.source_machine_name,
      'mapped',
      merlin_machine.id,
      now()
    )
    on conflict (sunze_machine_id)
    do update set
      status = 'mapped',
      reporting_machine_id = excluded.reporting_machine_id,
      mapped_at = coalesce(public.sunze_machine_discoveries.mapped_at, now()),
      ignored_at = null,
      ignored_by = null,
      ignore_reason = null;

    if exists (
      select 1
      from public.reporting_machine_partnership_assignments assignment
      where assignment.machine_id = merlin_machine.id
        and assignment.partnership_id = merlin_partnership.id
        and assignment.assignment_role = 'primary_reporting'
    ) then
      update public.reporting_machine_partnership_assignments
      set
        effective_start_date = least(effective_start_date, machine_record.effective_start_date),
        effective_end_date = merlin_partnership.effective_end_date,
        status = 'active',
        notes = coalesce(nullif(notes, ''), 'Normalized by Merlin Texas machine mapping.')
      where machine_id = merlin_machine.id
        and partnership_id = merlin_partnership.id
        and assignment_role = 'primary_reporting';
    else
      insert into public.reporting_machine_partnership_assignments (
        machine_id,
        partnership_id,
        assignment_role,
        effective_start_date,
        effective_end_date,
        status,
        notes
      )
      values (
        merlin_machine.id,
        merlin_partnership.id,
        'primary_reporting',
        machine_record.effective_start_date,
        merlin_partnership.effective_end_date,
        'active',
        'Created by Merlin Texas machine mapping.'
      );
    end if;

    if exists (
      select 1
      from public.reporting_machine_tax_rates tax
      where tax.machine_id = merlin_machine.id
        and tax.effective_start_date = machine_record.effective_start_date
        and tax.status = 'active'
    ) then
      update public.reporting_machine_tax_rates
      set
        tax_rate_percent = 0,
        effective_end_date = null,
        notes = 'Provisional reporting tax rate: current source imports for this Merlin machine carry tax_cents = 0. Update if site/SOW tax details are later confirmed.'
      where machine_id = merlin_machine.id
        and effective_start_date = machine_record.effective_start_date
        and status = 'active';
    else
      insert into public.reporting_machine_tax_rates (
        machine_id,
        tax_rate_percent,
        effective_start_date,
        effective_end_date,
        status,
        notes
      )
      values (
        merlin_machine.id,
        0,
        machine_record.effective_start_date,
        null,
        'active',
        'Provisional reporting tax rate: current source imports for this Merlin machine carry tax_cents = 0. Update if site/SOW tax details are later confirmed.'
      );
    end if;

    with promotable as (
      select *
      from public.sunze_unmapped_sales pending
      where lower(pending.sunze_machine_id) = lower(machine_record.external_machine_id)
        and pending.status in ('pending', 'ignored')
    ),
    upserted as (
      insert into public.machine_sales_facts as target (
        reporting_machine_id,
        reporting_location_id,
        sale_date,
        payment_method,
        net_sales_cents,
        transaction_count,
        source,
        source_order_hash,
        source_row_hash,
        import_run_id,
        source_trade_name,
        item_quantity,
        tax_cents,
        source_payment_status,
        payment_time,
        raw_payload
      )
      select
        merlin_machine.id,
        merlin_machine.location_id,
        promotable.sale_date,
        promotable.payment_method,
        promotable.net_sales_cents,
        promotable.transaction_count,
        'sunze_browser',
        promotable.source_order_hash,
        promotable.source_row_hash,
        promotable.import_run_id,
        nullif(promotable.raw_payload ->> 'trade_name', ''),
        coalesce(
          case
            when coalesce(promotable.raw_payload ->> 'item_quantity', '') ~ '^[0-9]+$'
              then (promotable.raw_payload ->> 'item_quantity')::integer
            else null
          end,
          1
        ),
        coalesce(
          case
            when coalesce(promotable.raw_payload ->> 'tax_cents', '') ~ '^[0-9]+$'
              then (promotable.raw_payload ->> 'tax_cents')::integer
            else null
          end,
          0
        ),
        nullif(promotable.raw_payload ->> 'status_source', ''),
        nullif(promotable.raw_payload ->> 'payment_time_iso', '')::timestamptz,
        promotable.raw_payload || jsonb_build_object(
          'promoted_from_merlin_texas_mapping', true,
          'promoted_at', now()
        )
      from promotable
      on conflict (source, source_order_hash)
        where source = 'sunze_browser'
          and source_order_hash is not null
      do update set
        reporting_machine_id = excluded.reporting_machine_id,
        reporting_location_id = excluded.reporting_location_id,
        sale_date = excluded.sale_date,
        payment_method = excluded.payment_method,
        net_sales_cents = excluded.net_sales_cents,
        transaction_count = excluded.transaction_count,
        source_row_hash = excluded.source_row_hash,
        import_run_id = excluded.import_run_id,
        source_trade_name = excluded.source_trade_name,
        item_quantity = excluded.item_quantity,
        tax_cents = excluded.tax_cents,
        source_payment_status = excluded.source_payment_status,
        payment_time = excluded.payment_time,
        raw_payload = excluded.raw_payload,
        updated_at = now()
      returning target.source_order_hash
    )
    select coalesce(array_agg(source_order_hash), '{}'::text[])
    into promoted_source_order_hashes
    from upserted;

    update public.sunze_unmapped_sales pending
    set
      status = 'mapped',
      reporting_machine_id = merlin_machine.id,
      reporting_location_id = merlin_machine.location_id,
      promoted_at = coalesce(promoted_at, now())
    where pending.source_order_hash = any(promoted_source_order_hashes);
  end loop;
end;
$$;

select pg_notify('pgrst', 'reload schema');
