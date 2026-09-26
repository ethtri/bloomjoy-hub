-- Import authenticated, settled Nayax scheduled-report rows into partner and
-- technician revenue reporting. Existing Sunze-backed machines remain on the
-- Sunze source so one provider transaction cannot be counted twice.

alter table public.sales_import_runs
  drop constraint if exists sales_import_runs_source_check;

alter table public.sales_import_runs
  add constraint sales_import_runs_source_check check (
    source in (
      'manual_csv',
      'google_sheets_refunds',
      'sunze_browser',
      'nayax_scheduled_report',
      'sample_seed'
    )
  );

alter table public.machine_sales_facts
  drop constraint if exists machine_sales_facts_source_check;

alter table public.machine_sales_facts
  add constraint machine_sales_facts_source_check check (
    source in (
      'manual_csv',
      'sunze_browser',
      'nayax_scheduled_report',
      'sample_seed'
    )
  );

create unique index if not exists machine_sales_facts_nayax_order_hash_idx
  on public.machine_sales_facts (source, source_order_hash)
  where source = 'nayax_scheduled_report'
    and source_order_hash is not null;

create table public.nayax_scheduled_sales_ingestions (
  file_digest text primary key
    references public.nayax_scheduled_report_files (file_digest)
    check (file_digest ~ '^[a-f0-9]{64}$'),
  import_run_id uuid not null unique
    references public.sales_import_runs (id) on delete restrict,
  settled_rows integer not null check (settled_rows >= 0),
  imported_rows integer not null check (imported_rows >= 0),
  unmapped_rows integer not null check (unmapped_rows >= 0),
  sunze_overlap_rows integer not null check (sunze_overlap_rows >= 0),
  recorded_at timestamptz not null default statement_timestamp(),
  check (imported_rows + unmapped_rows + sunze_overlap_rows = settled_rows)
);

alter table public.nayax_scheduled_sales_ingestions enable row level security;
revoke all on public.nayax_scheduled_sales_ingestions
  from public, anon, authenticated, service_role;
grant select on public.nayax_scheduled_sales_ingestions to service_role;

create trigger nayax_scheduled_sales_ingestions_immutable
before update or delete on public.nayax_scheduled_sales_ingestions
for each row execute function public.refund_receipt_immutable();

create or replace function public.service_get_nayax_report_message(
  p_message_id text
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'recorded', message.message_id is not null,
    'salesRecorded', sales.file_digest is not null
  )
  from (select 1) singleton
  left join public.nayax_scheduled_report_messages message
    on message.message_id = p_message_id
  left join public.nayax_scheduled_sales_ingestions sales
    on sales.file_digest = message.file_digest
  where auth.role() = 'service_role';
$$;

revoke all on function public.service_get_nayax_report_message(text)
  from public, anon, authenticated;
grant execute on function public.service_get_nayax_report_message(text)
  to service_role;

create function public.service_ingest_nayax_scheduled_sales(
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
  sale jsonb;
  mapped_machine_id uuid;
  mapped_location_id uuid;
  mapped_timezone text;
  mapped_sunze_machine_id text;
  import_run_id uuid;
  settled_at timestamptz;
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
    return jsonb_build_object(
      'recorded', true,
      'duplicate', true,
      'settledRows', prior.settled_rows,
      'importedRows', prior.imported_rows,
      'unmappedRows', prior.unmapped_rows,
      'sunzeOverlapRows', prior.sunze_overlap_rows
    );
  end if;

  settled_rows := jsonb_array_length(p_sales);
  if settled_rows > report_file.row_count then
    raise exception 'Invalid native report sales contract';
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
        'providerSettledAt',
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
          'providerSettledAt',
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
      or coalesce(sale ->> 'authorizationAmountCents', '') !~ '^[1-9][0-9]{0,9}$'
      or sale ->> 'authorizationAmountCents'
        is distinct from sale ->> 'settlementAmountCents'
      or sale ->> 'settlementAmountCents'
        is distinct from sale ->> 'paidAmountCents'
      or sale ->> 'providerStatus' is distinct from '12'
      or sale ->> 'providerStatusName' is distinct from 'Settled'
      or coalesce(sale ->> 'providerSettledAt', '')
        !~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$'
      or coalesce(sale ->> 'sourceOrderHash', '') !~ '^[a-f0-9]{64}$'
      or coalesce(sale ->> 'sourceRowHash', '') !~ '^[a-f0-9]{64}$' then
      raise exception 'Invalid native report sale';
    end if;

    settled_at := (sale ->> 'providerSettledAt')::timestamptz;
    if settled_at > report_file.received_at + interval '5 minutes'
      or settled_at < timestamptz '2026-01-01 00:00:00+00' then
      raise exception 'Invalid native report sale time';
    end if;

    mapped_machine_id := null;
    mapped_location_id := null;
    mapped_timezone := null;
    mapped_sunze_machine_id := null;

    select
      machine.id,
      location.id,
      location.timezone,
      machine.sunze_machine_id
    into
      mapped_machine_id,
      mapped_location_id,
      mapped_timezone,
      mapped_sunze_machine_id
    from public.refund_nayax_machine_inventory inventory
    join public.reporting_machines machine
      on machine.id = inventory.reporting_machine_id
    join public.reporting_locations location
      on location.id = machine.location_id
    where inventory.account_key = 'TGPACI_USA_DB'
      and inventory.nayax_machine_id = sale ->> 'providerMachineId'
      and inventory.reconciliation_state = 'published'
      and inventory.provider_is_active
      and machine.nayax_machine_id = inventory.nayax_machine_id
      and upper(coalesce(machine.nayax_account_key, 'TGPACI_USA_DB')) =
        inventory.account_key
      and machine.status = 'active'
      and location.status = 'active';

    if mapped_machine_id is null then
      unmapped_rows := unmapped_rows + 1;
      continue;
    end if;

    if nullif(btrim(mapped_sunze_machine_id), '') is not null then
      sunze_overlap_rows := sunze_overlap_rows + 1;
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
      (settled_at at time zone mapped_timezone)::date,
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
        'providerStatus', (sale ->> 'providerStatus')::integer,
        'providerStatusName', sale ->> 'providerStatusName',
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
      updated_at = statement_timestamp();

    imported_rows := imported_rows + 1;
  end loop;

  update public.sales_import_runs
  set status = 'completed',
      rows_imported = imported_rows,
      rows_skipped = unmapped_rows + sunze_overlap_rows,
      completed_at = statement_timestamp(),
      meta = meta || jsonb_build_object(
        'unmappedRows', unmapped_rows,
        'sunzeOverlapRows', sunze_overlap_rows
      )
  where id = import_run_id;

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
    sunze_overlap_rows
  );

  return jsonb_build_object(
    'recorded', true,
    'duplicate', false,
    'settledRows', settled_rows,
    'importedRows', imported_rows,
    'unmappedRows', unmapped_rows,
    'sunzeOverlapRows', sunze_overlap_rows
  );
end;
$$;

revoke all on function public.service_ingest_nayax_scheduled_sales(text, jsonb)
  from public, anon, authenticated;
grant execute on function public.service_ingest_nayax_scheduled_sales(text, jsonb)
  to service_role;

comment on table public.nayax_scheduled_sales_ingestions is
  'Immutable per-file receipt for settled Nayax rows imported into revenue reporting.';
comment on function public.service_ingest_nayax_scheduled_sales(text, jsonb) is
  'Idempotently imports authenticated settled Nayax rows for published Nayax-only machine mappings.';
