-- Preserve valid Nayax sales that arrive before an exact machine mapping exists.
-- The same canonical queue is available to the bounded DTM history importer.

create table public.nayax_pending_sales (
  source_order_hash text primary key
    check (source_order_hash ~ '^[a-f0-9]{64}$'),
  source_row_hash text not null
    check (source_row_hash ~ '^[a-f0-9]{64}$'),
  account_key text not null
    check (account_key ~ '^[A-Z0-9_]{1,80}$'),
  provider_actor_id text not null
    check (provider_actor_id ~ '^[0-9]{1,30}$'),
  provider_site_id text not null
    check (provider_site_id ~ '^[0-9]{1,9}$'),
  provider_transaction_id text not null
    check (provider_transaction_id ~ '^[0-9]{1,30}$'),
  provider_machine_id text not null
    check (provider_machine_id ~ '^[0-9]{1,30}$'),
  currency_code text not null check (currency_code = 'USD'),
  settlement_amount_cents integer not null
    check (settlement_amount_cents > 0),
  machine_settled_at timestamp without time zone not null,
  provider_settled_at timestamptz not null,
  provider_updated_at timestamptz,
  provider_status integer not null check (provider_status in (12, 62, 63)),
  provider_status_name text not null check (length(provider_status_name) between 1 and 100),
  normalized_sale jsonb not null,
  first_file_digest text references public.nayax_scheduled_report_files (file_digest) on delete restrict,
  last_file_digest text references public.nayax_scheduled_report_files (file_digest) on delete restrict,
  disposition text not null default 'pending'
    check (disposition in ('pending', 'excluded', 'promoted')),
  disposition_reason text not null,
  promoted_fact_id uuid references public.machine_sales_facts (id) on delete set null,
  promotion_import_run_id uuid references public.sales_import_runs (id) on delete set null,
  first_observed_at timestamptz not null default statement_timestamp(),
  last_observed_at timestamptz not null default statement_timestamp(),
  promoted_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint nayax_pending_sales_identity_unique unique (
    account_key,
    provider_actor_id,
    provider_site_id,
    provider_transaction_id
  ),
  constraint nayax_pending_sales_normalized_object check (
    jsonb_typeof(normalized_sale) = 'object'
  ),
  constraint nayax_pending_sales_normalized_required check (
    normalized_sale ?& array[
      'transactionId',
      'siteId',
      'actorId',
      'providerMachineId',
      'currencyCode',
      'authorizationAmountCents',
      'settlementAmountCents',
      'machineSettledAt',
      'providerSettledAt',
      'providerUpdatedAt',
      'providerStatus',
      'providerStatusName',
      'sourceOrderHash',
      'sourceRowHash'
    ]
  ),
  constraint nayax_pending_sales_normalized_allowlist check (
    normalized_sale - array[
      'transactionId',
      'siteId',
      'actorId',
      'providerMachineId',
      'currencyCode',
      'authorizationAmountCents',
      'settlementAmountCents',
      'paidAmountCents',
      'machineSettledAt',
      'providerSettledAt',
      'providerUpdatedAt',
      'providerStatus',
      'providerStatusName',
      'sourceOrderHash',
      'sourceRowHash'
    ] = '{}'::jsonb
  ),
  constraint nayax_pending_sales_normalized_scalars_match check (
    normalized_sale ->> 'sourceOrderHash' = source_order_hash
    and normalized_sale ->> 'sourceRowHash' = source_row_hash
    and normalized_sale ->> 'actorId' = provider_actor_id
    and normalized_sale ->> 'siteId' = provider_site_id
    and normalized_sale ->> 'transactionId' = provider_transaction_id
    and normalized_sale ->> 'providerMachineId' = provider_machine_id
    and normalized_sale ->> 'currencyCode' = currency_code
    and (normalized_sale ->> 'settlementAmountCents')::integer = settlement_amount_cents
    and (normalized_sale ->> 'machineSettledAt')::timestamp = machine_settled_at
    and (normalized_sale ->> 'providerSettledAt')::timestamptz = provider_settled_at
    and nullif(normalized_sale ->> 'providerUpdatedAt', '')::timestamptz
      is not distinct from provider_updated_at
    and (normalized_sale ->> 'providerStatus')::integer = provider_status
    and normalized_sale ->> 'providerStatusName' = provider_status_name
  )
);

create index nayax_pending_sales_disposition_machine_idx
  on public.nayax_pending_sales (disposition, account_key, provider_machine_id, provider_settled_at);

alter table public.nayax_pending_sales enable row level security;
revoke all on public.nayax_pending_sales from public, anon, authenticated;
grant select, insert, update on public.nayax_pending_sales to service_role;

create trigger nayax_pending_sales_set_updated_at
before update on public.nayax_pending_sales
for each row execute function public.set_updated_at();

create or replace function private.nayax_provider_evidence_is_newer(
  p_existing jsonb,
  p_incoming jsonb
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when nullif(p_incoming ->> 'providerUpdatedAt', '') is null then false
    when nullif(p_existing ->> 'providerUpdatedAt', '') is null then true
    else (p_incoming ->> 'providerUpdatedAt')::timestamptz
      > (p_existing ->> 'providerUpdatedAt')::timestamptz
  end;
$$;

revoke all on function private.nayax_provider_evidence_is_newer(jsonb, jsonb)
  from public, anon, authenticated, service_role;

create or replace function public.service_promote_nayax_pending_sales(
  p_limit integer default 10000
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  pending_sale record;
  import_run_id uuid;
  v_promoted_fact_id uuid;
  promoted_rows integer := 0;
  normalized_limit integer := least(greatest(coalesce(p_limit, 10000), 1), 10000);
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service pending Nayax sales promotion required';
  end if;

  for pending_sale in
    select
      pending.*,
      machine.id as mapped_machine_id,
      location.id as mapped_location_id
    from public.nayax_pending_sales pending
    join public.refund_nayax_machine_inventory inventory
      on inventory.account_key = pending.account_key
     and inventory.nayax_machine_id = pending.provider_machine_id
     and inventory.reconciliation_state = 'published'
    join public.reporting_machines machine
      on machine.id = inventory.reporting_machine_id
     and machine.nayax_machine_id = inventory.nayax_machine_id
     and upper(coalesce(machine.nayax_account_key, 'TGPACI_USA_DB')) = inventory.account_key
    join public.reporting_locations location
      on location.id = machine.location_id
    where pending.disposition <> 'promoted'
    order by pending.provider_settled_at, pending.source_order_hash
    limit normalized_limit
    for update of pending skip locked
  loop
    if import_run_id is null then
      insert into public.sales_import_runs (
        source,
        status,
        source_reference,
        rows_seen,
        rows_imported,
        rows_skipped,
        meta,
        started_at
      ) values (
        'nayax_scheduled_report',
        'running',
        'pending-mapping-recovery',
        0,
        0,
        0,
        jsonb_build_object(
          'provider', 'nayax',
          'delivery', 'pending_mapping_recovery',
          'payloadRedacted', true
        ),
        statement_timestamp()
      ) returning id into import_run_id;
    end if;

    v_promoted_fact_id := null;
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
    ) values (
      pending_sale.mapped_machine_id,
      pending_sale.mapped_location_id,
      pending_sale.machine_settled_at::date,
      'credit',
      pending_sale.settlement_amount_cents,
      1,
      'nayax_scheduled_report',
      pending_sale.source_order_hash,
      pending_sale.source_row_hash,
      import_run_id,
      null,
      1,
      0,
      pending_sale.provider_status_name,
      pending_sale.provider_settled_at,
      pending_sale.normalized_sale || jsonb_build_object(
        'payloadRedacted', true,
        'pendingMappingRecovery', true
      )
    )
    on conflict (source, source_order_hash)
      where source = 'nayax_scheduled_report'
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
      source_payment_status = excluded.source_payment_status,
      payment_time = excluded.payment_time,
      raw_payload = excluded.raw_payload,
      updated_at = statement_timestamp()
    where private.nayax_provider_evidence_is_newer(
      target.raw_payload,
      excluded.raw_payload
    )
    returning id into v_promoted_fact_id;

    if v_promoted_fact_id is null then
      select fact.id into v_promoted_fact_id
      from public.machine_sales_facts fact
      where fact.source = 'nayax_scheduled_report'
        and fact.source_order_hash = pending_sale.source_order_hash;
    end if;

    if v_promoted_fact_id is null then
      raise exception 'Pending Nayax sale promotion failed';
    end if;

    update public.nayax_pending_sales
    set
      disposition = 'promoted',
      disposition_reason = 'exact_published_mapping',
      promoted_fact_id = v_promoted_fact_id,
      promotion_import_run_id = import_run_id,
      promoted_at = statement_timestamp()
    where source_order_hash = pending_sale.source_order_hash;

    promoted_rows := promoted_rows + 1;
  end loop;

  if import_run_id is not null then
    update public.sales_import_runs
    set
      status = 'completed',
      rows_seen = promoted_rows,
      rows_imported = promoted_rows,
      completed_at = statement_timestamp()
    where id = import_run_id;
  end if;

  return jsonb_build_object(
    'promotedRows', promoted_rows,
    'remainingRows', (
      select count(*)
      from public.nayax_pending_sales pending
      where pending.disposition <> 'promoted'
    ),
    'importRunId', import_run_id
  );
end;
$$;

revoke all on function public.service_promote_nayax_pending_sales(integer)
  from public, anon, authenticated;
grant execute on function public.service_promote_nayax_pending_sales(integer)
  to service_role;

create or replace function public.service_ingest_nayax_scheduled_sales(
  p_file_digest text,
  p_sales jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  report_file public.nayax_scheduled_report_files;
  prior public.nayax_scheduled_sales_ingestions;
  authority_replay public.nayax_scheduled_card_authority_replays;
  replay_only boolean := false;
  sale jsonb;
  mapped_machine_id uuid;
  mapped_location_id uuid;
  mapped_sunze_machine_id text;
  pending_disposition text;
  import_run_id uuid;
  machine_settled_at timestamp without time zone;
  settled_at timestamptz;
  provider_updated_at timestamptz;
  settled_rows integer;
  imported_rows integer := 0;
  unmapped_rows integer := 0;
  sunze_overlap_rows integer := 0;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service report sales ingestion required';
  end if;

  if coalesce(p_file_digest, '') !~ '^[a-f0-9]{64}$'
    or jsonb_typeof(p_sales) is distinct from 'array'
    or jsonb_array_length(p_sales) > 10000 then
    raise exception 'Invalid native report sales contract';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('nayax-report-sales:' || p_file_digest, 0)
  );

  select * into report_file
  from public.nayax_scheduled_report_files
  where file_digest = p_file_digest;

  if report_file.file_digest is null then
    raise exception 'Native report receipt required';
  end if;

  select * into prior
  from public.nayax_scheduled_sales_ingestions
  where file_digest = p_file_digest;

  if prior.file_digest is not null then
    select * into authority_replay
    from public.nayax_scheduled_card_authority_replays
    where file_digest = p_file_digest;

    if prior.sunze_overlap_rows = 0 or authority_replay.file_digest is not null then
      return jsonb_build_object(
        'recorded', true,
        'duplicate', true,
        'settledRows', prior.settled_rows,
        'importedRows', prior.imported_rows + coalesce(authority_replay.imported_overlap_rows, 0),
        'unmappedRows', prior.unmapped_rows,
        'sunzeOverlapRows', 0,
        'authorityReplay', authority_replay.file_digest is not null
      );
    end if;

    replay_only := true;
  end if;

  settled_rows := jsonb_array_length(p_sales);
  if settled_rows > report_file.row_count then
    raise exception 'Invalid native report sales contract';
  end if;
  if replay_only and settled_rows <> prior.settled_rows then
    raise exception 'Complete native report sales replay required';
  end if;

  insert into public.sales_import_runs (
    source,
    status,
    source_reference,
    rows_seen,
    rows_imported,
    rows_skipped,
    meta,
    started_at
  ) values (
    'nayax_scheduled_report',
    'running',
    p_file_digest,
    settled_rows,
    0,
    0,
    jsonb_build_object(
      'provider', 'nayax',
      'delivery', 'authenticated_scheduled_report',
      'payloadRedacted', true
    ),
    statement_timestamp()
  ) returning id into import_run_id;

  for sale in
    select value
    from jsonb_array_elements(p_sales)
    order by value ->> 'sourceOrderHash'
  loop
    if jsonb_typeof(sale) is distinct from 'object'
      or not (sale ?& array[
        'transactionId',
        'siteId',
        'actorId',
        'providerMachineId',
        'currencyCode',
        'authorizationAmountCents',
        'settlementAmountCents',
        'paidAmountCents',
        'machineSettledAt',
        'providerSettledAt',
        'providerUpdatedAt',
        'providerStatus',
        'providerStatusName',
        'sourceOrderHash',
        'sourceRowHash'
      ])
      or exists (
        select 1
        from jsonb_object_keys(sale) key
        where key not in (
          'transactionId',
          'siteId',
          'actorId',
          'providerMachineId',
          'currencyCode',
          'authorizationAmountCents',
          'settlementAmountCents',
          'paidAmountCents',
          'machineSettledAt',
          'providerSettledAt',
          'providerUpdatedAt',
          'providerStatus',
          'providerStatusName',
          'sourceOrderHash',
          'sourceRowHash'
        )
      )
      or coalesce(sale ->> 'transactionId', '') !~ '^[0-9]{1,30}$'
      or coalesce(sale ->> 'siteId', '') !~ '^[0-9]{1,9}$'
      or coalesce(sale ->> 'actorId', '') not in ('2001508696', '2003563806')
      or coalesce(sale ->> 'providerMachineId', '') !~ '^[0-9]{1,30}$'
      or sale ->> 'currencyCode' is distinct from 'USD'
      or coalesce(sale ->> 'authorizationAmountCents', '') !~ '^[0-9]{1,10}$'
      or coalesce(sale ->> 'settlementAmountCents', '') !~ '^[1-9][0-9]{0,9}$'
      or coalesce(sale ->> 'paidAmountCents', '') !~ '^-?[0-9]{1,10}$'
      or coalesce(sale ->> 'machineSettledAt', '')
        !~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}$'
      or coalesce(sale ->> 'providerStatus', '') not in ('12', '62', '63')
      or length(coalesce(sale ->> 'providerStatusName', '')) not between 1 and 100
      or coalesce(sale ->> 'providerSettledAt', '')
        !~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$'
      or (
        sale ->> 'providerUpdatedAt' is not null
        and sale ->> 'providerUpdatedAt'
          !~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$'
      )
      or coalesce(sale ->> 'sourceOrderHash', '') !~ '^[a-f0-9]{64}$'
      or coalesce(sale ->> 'sourceRowHash', '') !~ '^[a-f0-9]{64}$' then
      raise exception 'Invalid native report sale';
    end if;

    machine_settled_at := (sale ->> 'machineSettledAt')::timestamp;
    settled_at := (sale ->> 'providerSettledAt')::timestamptz;
    provider_updated_at := nullif(sale ->> 'providerUpdatedAt', '')::timestamptz;
    if settled_at > report_file.received_at + interval '5 minutes'
      or settled_at < timestamptz '2025-01-01 00:00:00+00'
      or machine_settled_at < timestamp '2025-01-01 00:00:00'
      or machine_settled_at::date
        > (report_file.received_at at time zone 'UTC')::date + 1
      or provider_updated_at > report_file.received_at + interval '5 minutes'
      or provider_updated_at < timestamptz '2025-01-01 00:00:00+00' then
      raise exception 'Invalid native report sale time';
    end if;

    mapped_machine_id := null;
    mapped_location_id := null;
    mapped_sunze_machine_id := null;

    select
      machine.id,
      location.id,
      machine.sunze_machine_id
    into
      mapped_machine_id,
      mapped_location_id,
      mapped_sunze_machine_id
    from public.refund_nayax_machine_inventory inventory
    join public.reporting_machines machine
      on machine.id = inventory.reporting_machine_id
    join public.reporting_locations location
      on location.id = machine.location_id
    where inventory.account_key = 'TGPACI_USA_DB'
      and inventory.nayax_machine_id = sale ->> 'providerMachineId'
      and inventory.reconciliation_state = 'published'
      and machine.nayax_machine_id = inventory.nayax_machine_id
      and upper(coalesce(machine.nayax_account_key, 'TGPACI_USA_DB')) = inventory.account_key;

    if mapped_machine_id is null then
      select case
        when inventory.reconciliation_state = 'excluded' then 'excluded'
        else 'pending'
      end
      into pending_disposition
      from public.refund_nayax_machine_inventory inventory
      where inventory.account_key = 'TGPACI_USA_DB'
        and inventory.nayax_machine_id = sale ->> 'providerMachineId';

      pending_disposition := coalesce(pending_disposition, 'pending');

      insert into public.nayax_pending_sales as pending (
        source_order_hash,
        source_row_hash,
        account_key,
        provider_actor_id,
        provider_site_id,
        provider_transaction_id,
        provider_machine_id,
        currency_code,
        settlement_amount_cents,
        machine_settled_at,
        provider_settled_at,
        provider_updated_at,
        provider_status,
        provider_status_name,
        normalized_sale,
        first_file_digest,
        last_file_digest,
        disposition,
        disposition_reason
      ) values (
        sale ->> 'sourceOrderHash',
        sale ->> 'sourceRowHash',
        'TGPACI_USA_DB',
        sale ->> 'actorId',
        sale ->> 'siteId',
        sale ->> 'transactionId',
        sale ->> 'providerMachineId',
        sale ->> 'currencyCode',
        (sale ->> 'settlementAmountCents')::integer,
        machine_settled_at,
        settled_at,
        provider_updated_at,
        (sale ->> 'providerStatus')::integer,
        sale ->> 'providerStatusName',
        sale,
        p_file_digest,
        p_file_digest,
        pending_disposition,
        case
          when pending_disposition = 'excluded' then 'inventory_excluded'
          else 'exact_mapping_required'
        end
      )
      on conflict (source_order_hash) do update set
        source_row_hash = case
          when private.nayax_provider_evidence_is_newer(
            pending.normalized_sale,
            excluded.normalized_sale
          ) then excluded.source_row_hash
          else pending.source_row_hash
        end,
        provider_machine_id = case
          when private.nayax_provider_evidence_is_newer(
            pending.normalized_sale,
            excluded.normalized_sale
          ) then excluded.provider_machine_id
          else pending.provider_machine_id
        end,
        currency_code = case
          when private.nayax_provider_evidence_is_newer(
            pending.normalized_sale,
            excluded.normalized_sale
          ) then excluded.currency_code
          else pending.currency_code
        end,
        settlement_amount_cents = case
          when private.nayax_provider_evidence_is_newer(
            pending.normalized_sale,
            excluded.normalized_sale
          ) then excluded.settlement_amount_cents
          else pending.settlement_amount_cents
        end,
        machine_settled_at = case
          when private.nayax_provider_evidence_is_newer(
            pending.normalized_sale,
            excluded.normalized_sale
          ) then excluded.machine_settled_at
          else pending.machine_settled_at
        end,
        provider_settled_at = case
          when private.nayax_provider_evidence_is_newer(
            pending.normalized_sale,
            excluded.normalized_sale
          ) then excluded.provider_settled_at
          else pending.provider_settled_at
        end,
        provider_updated_at = case
          when private.nayax_provider_evidence_is_newer(
            pending.normalized_sale,
            excluded.normalized_sale
          ) then excluded.provider_updated_at
          else pending.provider_updated_at
        end,
        provider_status = case
          when private.nayax_provider_evidence_is_newer(
            pending.normalized_sale,
            excluded.normalized_sale
          ) then excluded.provider_status
          else pending.provider_status
        end,
        provider_status_name = case
          when private.nayax_provider_evidence_is_newer(
            pending.normalized_sale,
            excluded.normalized_sale
          ) then excluded.provider_status_name
          else pending.provider_status_name
        end,
        normalized_sale = case
          when private.nayax_provider_evidence_is_newer(
            pending.normalized_sale,
            excluded.normalized_sale
          ) then excluded.normalized_sale
          else pending.normalized_sale
        end,
        first_file_digest = coalesce(pending.first_file_digest, excluded.first_file_digest),
        last_file_digest = excluded.last_file_digest,
        last_observed_at = statement_timestamp(),
        disposition = case
          when pending.disposition = 'promoted' then 'promoted'
          else excluded.disposition
        end,
        disposition_reason = case
          when pending.disposition = 'promoted' then pending.disposition_reason
          else excluded.disposition_reason
        end;

      unmapped_rows := unmapped_rows + 1;
      continue;
    end if;

    if replay_only and nullif(btrim(mapped_sunze_machine_id), '') is null then
      continue;
    end if;

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
    ) values (
      mapped_machine_id,
      mapped_location_id,
      machine_settled_at::date,
      'credit',
      (sale ->> 'settlementAmountCents')::integer,
      1,
      'nayax_scheduled_report',
      sale ->> 'sourceOrderHash',
      sale ->> 'sourceRowHash',
      import_run_id,
      null,
      1,
      0,
      sale ->> 'providerStatusName',
      settled_at,
      jsonb_build_object(
        'actorId', sale ->> 'actorId',
        'siteId', sale ->> 'siteId',
        'providerMachineId', sale ->> 'providerMachineId',
        'transactionId', sale ->> 'transactionId',
        'machineSettledAt', sale ->> 'machineSettledAt',
        'providerStatus', (sale ->> 'providerStatus')::integer,
        'providerStatusName', sale ->> 'providerStatusName',
        'providerUpdatedAt', sale -> 'providerUpdatedAt',
        'payloadRedacted', true
      )
    )
    on conflict (source, source_order_hash)
      where source = 'nayax_scheduled_report'
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
      source_payment_status = excluded.source_payment_status,
      payment_time = excluded.payment_time,
      raw_payload = excluded.raw_payload,
      updated_at = statement_timestamp()
    where private.nayax_provider_evidence_is_newer(
      target.raw_payload,
      excluded.raw_payload
    );

    imported_rows := imported_rows + 1;
  end loop;

  update public.sales_import_runs
  set status = 'completed',
      rows_imported = imported_rows,
      rows_skipped = greatest(settled_rows - imported_rows, 0),
      completed_at = statement_timestamp(),
      meta = meta || jsonb_build_object(
        'unmappedRows', unmapped_rows,
        'sunzeOverlapRows', 0,
        'authorityReplay', replay_only
      )
  where id = import_run_id;

  if replay_only then
    if imported_rows <> prior.sunze_overlap_rows then
      raise exception 'Complete mapped overlap replay required';
    end if;

    insert into public.nayax_scheduled_card_authority_replays (
      file_digest,
      import_run_id,
      imported_overlap_rows
    ) values (
      p_file_digest,
      import_run_id,
      imported_rows
    );

    return jsonb_build_object(
      'recorded', true,
      'duplicate', false,
      'settledRows', settled_rows,
      'importedRows', imported_rows,
      'unmappedRows', unmapped_rows,
      'sunzeOverlapRows', 0,
      'authorityReplay', true
    );
  end if;

  insert into public.nayax_scheduled_sales_ingestions (
    file_digest,
    import_run_id,
    settled_rows,
    imported_rows,
    unmapped_rows,
    sunze_overlap_rows
  ) values (
    p_file_digest,
    import_run_id,
    settled_rows,
    imported_rows,
    unmapped_rows,
    0
  );

  return jsonb_build_object(
    'recorded', true,
    'duplicate', false,
    'settledRows', settled_rows,
    'importedRows', imported_rows,
    'unmappedRows', unmapped_rows,
    'sunzeOverlapRows', 0,
    'authorityReplay', false
  );
end;
$$;

revoke all on function public.service_ingest_nayax_scheduled_sales(text, jsonb)
  from public, anon, authenticated;
grant execute on function public.service_ingest_nayax_scheduled_sales(text, jsonb)
  to service_role;

comment on table public.nayax_pending_sales is
  'Service-only normalized positive Nayax sales awaiting an exact published machine mapping. No card, customer, or payment identifiers are retained.';

comment on function public.service_promote_nayax_pending_sales(integer) is
  'Idempotently promotes queued Nayax sales through exact published mappings. Historical rows do not require the provider machine, reporting machine, or location to remain active.';

comment on function public.service_ingest_nayax_scheduled_sales(text, jsonb) is
  'Imports authenticated scheduled settled sales, retains unmapped normalized rows, and rejects stale provider evidence overwrites.';

select pg_notify('pgrst', 'reload schema');
