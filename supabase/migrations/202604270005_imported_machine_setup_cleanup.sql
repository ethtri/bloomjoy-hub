-- Imported machine setup cleanup:
-- - Add a one-save admin RPC that turns a discovered source machine into a
--   report-ready machine assigned to a partnership.
-- - Normalize current Merlin machines out of the internal import holding bucket.

drop function if exists public.admin_map_source_machine_to_partnership(text, uuid, text, text, text, numeric, date, date, date, text);

create or replace function public.admin_map_source_machine_to_partnership(
  p_external_machine_id text,
  p_partnership_id uuid,
  p_machine_label text,
  p_location_name text,
  p_machine_type text,
  p_tax_rate_percent numeric,
  p_assignment_start_date date,
  p_assignment_end_date date,
  p_tax_effective_start_date date,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  normalized_external_machine_id text;
  normalized_machine_label text;
  normalized_location_name text;
  normalized_machine_type text;
  normalized_reason text;
  partnership_row public.reporting_partnerships;
  partner_row public.reporting_partners;
  account_row public.customer_accounts;
  location_row public.reporting_locations;
  before_machine public.reporting_machines;
  after_machine public.reporting_machines;
  before_assignment public.reporting_machine_partnership_assignments;
  after_assignment public.reporting_machine_partnership_assignments;
  after_tax_rate public.reporting_machine_tax_rates;
  promoted_row_count integer := 0;
  promoted_revenue_cents bigint := 0;
begin
  if not public.is_super_admin(auth.uid()) then
    raise exception 'Admin access required';
  end if;

  normalized_external_machine_id := nullif(trim(coalesce(p_external_machine_id, '')), '');
  normalized_machine_label := trim(coalesce(p_machine_label, ''));
  normalized_location_name := trim(coalesce(p_location_name, ''));
  normalized_machine_type := lower(coalesce(nullif(trim(p_machine_type), ''), 'commercial'));
  normalized_reason := public.reporting_admin_assert_reason(p_reason);

  if normalized_external_machine_id is null then
    raise exception 'External machine ID is required';
  end if;

  if p_partnership_id is null then
    raise exception 'Choose the report this machine belongs to';
  end if;

  if normalized_machine_label = '' then
    raise exception 'Machine label is required';
  end if;

  if normalized_location_name = '' then
    raise exception 'Location is required';
  end if;

  if normalized_machine_type not in ('commercial', 'mini', 'micro', 'unknown') then
    raise exception 'Invalid machine type';
  end if;

  if p_tax_rate_percent is null or p_tax_rate_percent < 0 or p_tax_rate_percent > 100 then
    raise exception 'Reporting tax rate must be between 0 and 100';
  end if;

  if p_assignment_start_date is null or p_tax_effective_start_date is null then
    raise exception 'Report assignment and tax effective dates are required';
  end if;

  if p_assignment_end_date is not null and p_assignment_end_date < p_assignment_start_date then
    raise exception 'Report assignment end date must be after the start date';
  end if;

  select *
  into partnership_row
  from public.reporting_partnerships partnership
  where partnership.id = p_partnership_id
    and partnership.status in ('draft', 'active')
  limit 1;

  if partnership_row.id is null then
    raise exception 'Report not found';
  end if;

  select partner.*
  into partner_row
  from public.reporting_partnership_parties party
  join public.reporting_partners partner on partner.id = party.partner_id
  where party.partnership_id = partnership_row.id
    and partner.status = 'active'
  order by
    case party.party_role
      when 'revenue_share_recipient' then 0
      when 'venue_partner' then 1
      when 'platform_partner' then 2
      when 'event_partner' then 3
      else 4
    end,
    party.created_at asc
  limit 1;

  if partner_row.id is null then
    raise exception 'Add a partner participant to this report before setting up imported machines';
  end if;

  select *
  into account_row
  from public.customer_accounts account
  where lower(account.name) = lower(partner_row.name)
  limit 1;

  if account_row.id is null then
    insert into public.customer_accounts (
      name,
      account_type,
      status,
      notes,
      created_by
    )
    values (
      partner_row.name,
      'partner',
      'active',
      'Created from imported machine setup.',
      auth.uid()
    )
    returning * into account_row;
  else
    update public.customer_accounts
    set
      account_type = case
        when account_type = 'internal' then 'partner'
        else account_type
      end,
      status = 'active'
    where id = account_row.id
    returning * into account_row;
  end if;

  select *
  into location_row
  from public.reporting_locations location
  where location.account_id = account_row.id
    and lower(location.name) = lower(normalized_location_name)
  limit 1;

  if location_row.id is null then
    insert into public.reporting_locations (
      account_id,
      name,
      partner_name,
      timezone,
      status,
      notes
    )
    values (
      account_row.id,
      normalized_location_name,
      partner_row.name,
      partnership_row.timezone,
      'active',
      'Created from imported machine setup.'
    )
    returning * into location_row;
  else
    update public.reporting_locations
    set
      partner_name = coalesce(nullif(partner_name, ''), partner_row.name),
      timezone = coalesce(nullif(timezone, ''), partnership_row.timezone),
      status = 'active'
    where id = location_row.id
    returning * into location_row;
  end if;

  select *
  into before_machine
  from public.reporting_machines machine
  where lower(machine.sunze_machine_id) = lower(normalized_external_machine_id)
  limit 1;

  if before_machine.id is null then
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
      account_row.id,
      location_row.id,
      normalized_machine_label,
      normalized_machine_type,
      normalized_external_machine_id,
      'active',
      'Created from imported machine setup.'
    )
    returning * into after_machine;
  else
    update public.reporting_machines
    set
      account_id = account_row.id,
      location_id = location_row.id,
      machine_label = normalized_machine_label,
      machine_type = normalized_machine_type,
      sunze_machine_id = normalized_external_machine_id,
      status = 'active'
    where id = before_machine.id
    returning * into after_machine;
  end if;

  insert into public.sunze_machine_discoveries (
    sunze_machine_id,
    status,
    reporting_machine_id,
    mapped_at,
    mapped_by
  )
  values (
    normalized_external_machine_id,
    'mapped',
    after_machine.id,
    now(),
    auth.uid()
  )
  on conflict (sunze_machine_id)
  do update set
    status = 'mapped',
    reporting_machine_id = excluded.reporting_machine_id,
    mapped_at = now(),
    mapped_by = auth.uid(),
    ignored_at = null,
    ignored_by = null,
    ignore_reason = null;

  select
    count(*)::integer,
    coalesce(sum(pending.net_sales_cents), 0)::bigint
  into promoted_row_count, promoted_revenue_cents
  from public.sunze_unmapped_sales pending
  where lower(pending.sunze_machine_id) = lower(normalized_external_machine_id)
    and pending.status in ('pending', 'ignored');

  with promotable as (
    select *
    from public.sunze_unmapped_sales pending
    where lower(pending.sunze_machine_id) = lower(normalized_external_machine_id)
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
      after_machine.id,
      after_machine.location_id,
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
        'promoted_from_imported_machine_setup', true,
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
  update public.sunze_unmapped_sales pending
  set
    status = 'mapped',
    reporting_machine_id = after_machine.id,
    reporting_location_id = after_machine.location_id,
    promoted_at = now(),
    mapped_by = auth.uid()
  where pending.source_order_hash in (select source_order_hash from upserted);

  if exists (
    select 1
    from public.reporting_machine_partnership_assignments existing
    where existing.machine_id = after_machine.id
      and existing.partnership_id <> partnership_row.id
      and existing.assignment_role = 'primary_reporting'
      and existing.status = 'active'
      and public.reporting_date_windows_overlap(
        existing.effective_start_date,
        existing.effective_end_date,
        p_assignment_start_date,
        p_assignment_end_date
      )
  ) then
    raise exception 'This machine already belongs to another active report for these dates';
  end if;

  select *
  into before_assignment
  from public.reporting_machine_partnership_assignments assignment
  where assignment.machine_id = after_machine.id
    and assignment.partnership_id = partnership_row.id
    and assignment.assignment_role = 'primary_reporting'
    and public.reporting_date_windows_overlap(
      assignment.effective_start_date,
      assignment.effective_end_date,
      p_assignment_start_date,
      p_assignment_end_date
    )
  order by
    case when assignment.status = 'active' then 0 else 1 end,
    assignment.created_at desc
  limit 1;

  if before_assignment.id is null then
    insert into public.reporting_machine_partnership_assignments (
      machine_id,
      partnership_id,
      assignment_role,
      effective_start_date,
      effective_end_date,
      status,
      notes,
      created_by
    )
    values (
      after_machine.id,
      partnership_row.id,
      'primary_reporting',
      p_assignment_start_date,
      p_assignment_end_date,
      'active',
      'Created from imported machine setup.',
      auth.uid()
    )
    returning * into after_assignment;
  else
    update public.reporting_machine_partnership_assignments
    set
      effective_start_date = p_assignment_start_date,
      effective_end_date = p_assignment_end_date,
      status = 'active',
      notes = coalesce(nullif(notes, ''), 'Updated from imported machine setup.')
    where id = before_assignment.id
    returning * into after_assignment;
  end if;

  select *
  into after_tax_rate
  from public.admin_set_reporting_machine_tax_rate(
    after_machine.id,
    p_tax_rate_percent,
    p_tax_effective_start_date,
    normalized_reason
  );

  insert into public.admin_audit_log (
    actor_user_id,
    action,
    entity_type,
    entity_id,
    target_user_id,
    before,
    after,
    meta
  )
  values (
    auth.uid(),
    'source_machine.setup_completed',
    'reporting_machine',
    after_machine.id::text,
    null,
    coalesce(to_jsonb(before_machine), '{}'::jsonb),
    to_jsonb(after_machine),
    jsonb_build_object(
      'reason', normalized_reason,
      'external_machine_id', normalized_external_machine_id,
      'partnership_id', partnership_row.id,
      'partnership_name', partnership_row.name,
      'assignment_id', after_assignment.id,
      'tax_rate_id', after_tax_rate.id,
      'promoted_row_count', promoted_row_count,
      'promoted_revenue_cents', promoted_revenue_cents
    )
  );

  return jsonb_build_object(
    'machineId', after_machine.id,
    'machineLabel', after_machine.machine_label,
    'externalMachineId', normalized_external_machine_id,
    'accountName', account_row.name,
    'locationName', location_row.name,
    'partnershipId', partnership_row.id,
    'partnershipName', partnership_row.name,
    'assignmentId', after_assignment.id,
    'taxRateId', after_tax_rate.id,
    'promotedRowCount', promoted_row_count,
    'promotedRevenueCents', promoted_revenue_cents
  );
end;
$$;

grant execute on function public.admin_map_source_machine_to_partnership(text, uuid, text, text, text, numeric, date, date, date, text)
  to authenticated;

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
  limit 1;

  if merlin_partnership.id is null then
    return;
  end if;

  select partner.*
  into merlin_partner
  from public.reporting_partnership_parties party
  join public.reporting_partners partner on partner.id = party.partner_id
  where party.partnership_id = merlin_partnership.id
  order by
    case party.party_role
      when 'revenue_share_recipient' then 0
      when 'venue_partner' then 1
      else 2
    end,
    party.created_at asc
  limit 1;

  if merlin_partner.id is not null then
    if exists (
      select 1
      from public.reporting_partners partner
      where lower(partner.name) = lower('Merlin Entertainments')
        and partner.id <> merlin_partner.id
    ) then
      update public.reporting_partners
      set
        legal_name = coalesce(
          nullif(legal_name, ''),
          'MERLIN ENTERTAINMENTS GROUP U.S. HOLDINGS INC.'
        )
      where id = merlin_partner.id
      returning * into merlin_partner;
    else
      update public.reporting_partners
      set
        name = 'Merlin Entertainments',
        legal_name = coalesce(
          nullif(legal_name, ''),
          'MERLIN ENTERTAINMENTS GROUP U.S. HOLDINGS INC.'
        )
      where id = merlin_partner.id
      returning * into merlin_partner;
    end if;
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
      'Created by imported machine setup cleanup.'
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
        ('Merlin Dallas', 'Dallas', '1752630142111982412250455'),
        ('Merlin Chicago', 'Chicago', '129388329309348155843236'),
        ('Merlin Minneapolis', 'Minneapolis', '17525706476037914545569')
    ) as machine_values(machine_label, location_name, external_machine_id)
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
        timezone,
        status,
        notes
      )
      values (
        merlin_account.id,
        machine_record.location_name,
        'Merlin Entertainments',
        merlin_partnership.timezone,
        'active',
        'Created by imported machine setup cleanup.'
      )
      returning * into merlin_location;
    else
      update public.reporting_locations
      set
        partner_name = 'Merlin Entertainments',
        timezone = merlin_partnership.timezone,
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
        'Created by imported machine setup cleanup.'
      )
      returning * into merlin_machine;
    else
      update public.reporting_machines
      set
        account_id = merlin_account.id,
        location_id = merlin_location.id,
        machine_label = machine_record.machine_label,
        machine_type = 'commercial',
        status = 'active'
      where id = merlin_machine.id
      returning * into merlin_machine;
    end if;

    insert into public.sunze_machine_discoveries (
      sunze_machine_id,
      status,
      reporting_machine_id,
      mapped_at
    )
    values (
      machine_record.external_machine_id,
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
        effective_start_date = date '2025-08-08',
        effective_end_date = date '2026-08-07',
        status = 'active',
        notes = coalesce(nullif(notes, ''), 'Normalized by imported machine setup cleanup.')
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
        date '2025-08-08',
        date '2026-08-07',
        'active',
        'Created by imported machine setup cleanup.'
      );
    end if;

    if exists (
      select 1
      from public.reporting_machine_tax_rates tax
      where tax.machine_id = merlin_machine.id
        and tax.effective_start_date = date '2025-08-08'
        and tax.status = 'active'
    ) then
      update public.reporting_machine_tax_rates
      set
        tax_rate_percent = 0,
        effective_end_date = null,
        notes = 'Provisional reporting tax rate: current source imports for this Merlin machine carry tax_cents = 0. Update if site/SOW tax details are later confirmed.'
      where machine_id = merlin_machine.id
        and effective_start_date = date '2025-08-08'
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
        date '2025-08-08',
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
          'promoted_from_merlin_cleanup', true,
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
