-- Keep one card-revenue source while retaining Sunze order/item context.
-- A nullable machine-local date makes the historical transition explicit:
-- Sunze card money remains canonical before it; Nayax card money is canonical
-- on and after it. Cash authority and refund adjustments are unchanged.

alter table public.reporting_machines
  add column if not exists nayax_card_sales_started_on date
  check (
    nayax_card_sales_started_on is null
    or nayax_card_sales_started_on >= date '2025-01-01'
  );

comment on column public.reporting_machines.nayax_card_sales_started_on is
  'Machine-local first date on which Nayax supplies card revenue. NULL retains legacy Sunze card revenue until replacement history is available.';

alter table public.machine_sales_facts
  drop constraint if exists machine_sales_facts_source_check;

alter table public.machine_sales_facts
  add constraint machine_sales_facts_source_check check (
    source in (
      'manual_csv',
      'sunze_browser',
      'nayax_scheduled_report',
      'card_authority_daily',
      'sample_seed'
    )
  );

create unique index if not exists machine_sales_facts_card_authority_daily_idx
  on public.machine_sales_facts (source, source_order_hash)
  where source = 'card_authority_daily'
    and source_order_hash is not null;

create table if not exists public.nayax_scheduled_card_authority_replays (
  file_digest text primary key
    references public.nayax_scheduled_report_files (file_digest)
    check (file_digest ~ '^[a-f0-9]{64}$'),
  import_run_id uuid not null unique
    references public.sales_import_runs (id) on delete restrict,
  imported_overlap_rows integer not null
    check (imported_overlap_rows >= 0),
  recorded_at timestamptz not null default statement_timestamp()
);

alter table public.nayax_scheduled_card_authority_replays enable row level security;
revoke all on public.nayax_scheduled_card_authority_replays
  from public, anon, authenticated, service_role;
grant select on public.nayax_scheduled_card_authority_replays to service_role;

create trigger nayax_scheduled_card_authority_replays_immutable
before update or delete on public.nayax_scheduled_card_authority_replays
for each row execute function public.refund_receipt_immutable();

create or replace function private.reconcile_machine_card_sales_authority(
  p_reporting_machine_id uuid,
  p_sale_date date
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  authority_start date;
  has_sunze boolean;
  has_nayax boolean;
  positive_sunze_card_rows integer := 0;
  positive_sunze_transaction_count integer := 0;
  positive_sunze_item_quantity integer := 0;
  positive_sunze_tax_cents integer := 0;
  nayax_card_rows integer := 0;
  nayax_net_sales_cents integer := 0;
  nayax_transaction_count integer := 0;
  nayax_item_quantity integer := 0;
  nayax_tax_cents integer := 0;
  projection_order_hash text;
begin
  if p_reporting_machine_id is null or p_sale_date is null then
    return;
  end if;

  -- Sunze and Nayax can write the same machine/day from independent imports.
  -- Serialize the aggregate per machine so the final projection cannot be
  -- overwritten by a calculation made from an earlier partial snapshot.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'machine-card-authority:' || p_reporting_machine_id::text,
      0
    )
  );

  select
    machine.nayax_card_sales_started_on,
    nullif(btrim(machine.sunze_machine_id), '') is not null,
    nullif(btrim(machine.nayax_machine_id), '') is not null
  into authority_start, has_sunze, has_nayax
  from public.reporting_machines machine
  where machine.id = p_reporting_machine_id;

  if not found then
    return;
  end if;

  -- Capture the current provider values before projecting source authority.
  -- A later provider correction replaces raw_payload through its normal upsert,
  -- so the corrected values become the next reversible source snapshot.
  update public.machine_sales_facts fact
  set raw_payload = fact.raw_payload || jsonb_build_object(
    '_salesAuthorityOriginal', jsonb_build_object(
      'netSalesCents', fact.net_sales_cents,
      'transactionCount', fact.transaction_count,
      'itemQuantity', fact.item_quantity,
      'taxCents', fact.tax_cents
    )
  )
  where fact.reporting_machine_id = p_reporting_machine_id
    and fact.sale_date = p_sale_date
    and fact.payment_method = 'credit'
    and fact.source in ('sunze_browser', 'nayax_scheduled_report')
    and not (fact.raw_payload ? '_salesAuthorityOriginal');

  if has_sunze and has_nayax
    and authority_start is not null
    and p_sale_date >= authority_start then
    select
      count(*) filter (
        where (fact.raw_payload #>> '{_salesAuthorityOriginal,netSalesCents}')::integer > 0
      )::integer,
      coalesce(sum((fact.raw_payload #>> '{_salesAuthorityOriginal,transactionCount}')::integer) filter (
        where (fact.raw_payload #>> '{_salesAuthorityOriginal,netSalesCents}')::integer > 0
      ), 0)::integer,
      coalesce(sum((fact.raw_payload #>> '{_salesAuthorityOriginal,itemQuantity}')::integer) filter (
        where (fact.raw_payload #>> '{_salesAuthorityOriginal,netSalesCents}')::integer > 0
      ), 0)::integer,
      coalesce(sum((fact.raw_payload #>> '{_salesAuthorityOriginal,taxCents}')::integer) filter (
        where (fact.raw_payload #>> '{_salesAuthorityOriginal,netSalesCents}')::integer > 0
      ), 0)::integer
    into
      positive_sunze_card_rows,
      positive_sunze_transaction_count,
      positive_sunze_item_quantity,
      positive_sunze_tax_cents
    from public.machine_sales_facts fact
    where fact.reporting_machine_id = p_reporting_machine_id
      and fact.sale_date = p_sale_date
      and fact.source = 'sunze_browser'
      and fact.payment_method = 'credit';

    select
      count(*)::integer,
      coalesce(sum((fact.raw_payload #>> '{_salesAuthorityOriginal,netSalesCents}')::integer), 0)::integer,
      coalesce(sum((fact.raw_payload #>> '{_salesAuthorityOriginal,transactionCount}')::integer), 0)::integer,
      coalesce(sum((fact.raw_payload #>> '{_salesAuthorityOriginal,itemQuantity}')::integer), 0)::integer,
      coalesce(sum((fact.raw_payload #>> '{_salesAuthorityOriginal,taxCents}')::integer), 0)::integer
    into
      nayax_card_rows,
      nayax_net_sales_cents,
      nayax_transaction_count,
      nayax_item_quantity,
      nayax_tax_cents
    from public.machine_sales_facts fact
    where fact.reporting_machine_id = p_reporting_machine_id
      and fact.sale_date = p_sale_date
      and fact.source = 'nayax_scheduled_report'
      and fact.payment_method = 'credit';

    -- Positive-value Sunze orders move their metrics to the daily projection.
    -- Zero-value operational rows keep their counts on their own zero-value
    -- facts so they do not acquire fees or per-item costs from Nayax revenue.
    update public.machine_sales_facts fact
    set net_sales_cents = 0,
        transaction_count = case
          when nayax_card_rows > 0
            and (fact.raw_payload #>> '{_salesAuthorityOriginal,netSalesCents}')::integer > 0
          then 0
          else (fact.raw_payload #>> '{_salesAuthorityOriginal,transactionCount}')::integer
        end,
        item_quantity = case
          when nayax_card_rows > 0
            and (fact.raw_payload #>> '{_salesAuthorityOriginal,netSalesCents}')::integer > 0
          then 0
          else (fact.raw_payload #>> '{_salesAuthorityOriginal,itemQuantity}')::integer
        end,
        tax_cents = case
          when nayax_card_rows > 0
            and (fact.raw_payload #>> '{_salesAuthorityOriginal,netSalesCents}')::integer > 0
          then 0
          else (fact.raw_payload #>> '{_salesAuthorityOriginal,taxCents}')::integer
        end,
        raw_payload = fact.raw_payload || jsonb_build_object(
          'revenueAuthority', 'nayax_scheduled_report',
          'operationalMetricsAuthority', 'sunze_browser'
        )
    where fact.reporting_machine_id = p_reporting_machine_id
      and fact.sale_date = p_sale_date
      and fact.source = 'sunze_browser'
      and fact.payment_method = 'credit'
      and (
        fact.net_sales_cents <> 0
        or fact.transaction_count <> 0
        or fact.item_quantity <> 0
        or fact.tax_cents <> 0
        or fact.raw_payload ->> 'revenueAuthority' is distinct from 'nayax_scheduled_report'
      );

    -- Provider rows retain immutable source provenance but contribute nothing
    -- directly. One explicit daily row carries the canonical aggregate, which
    -- keeps row-based partner fee/tax/cost calculations correct without
    -- claiming a transaction-level Sunze-to-Nayax match.
    update public.machine_sales_facts fact
    set net_sales_cents = 0,
        transaction_count = 0,
        item_quantity = 0,
        tax_cents = 0,
        raw_payload = fact.raw_payload || jsonb_build_object(
          'revenueAuthority', 'card_authority_daily',
          'operationalMetricsAuthority', case
            when positive_sunze_card_rows > 0 then 'sunze_browser'
            else 'nayax_scheduled_report'
          end
        )
    where fact.reporting_machine_id = p_reporting_machine_id
      and fact.sale_date = p_sale_date
      and fact.source = 'nayax_scheduled_report'
      and fact.payment_method = 'credit';

    projection_order_hash := md5(
      'card-authority-daily:' || p_reporting_machine_id::text || ':' || p_sale_date::text
    );

    if nayax_card_rows > 0 then
      insert into public.machine_sales_facts (
        reporting_machine_id,
        reporting_location_id,
        sale_date,
        payment_method,
        net_sales_cents,
        transaction_count,
        source,
        source_row_hash,
        source_order_hash,
        item_quantity,
        tax_cents,
        raw_payload
      )
      select
        machine.id,
        machine.location_id,
        p_sale_date,
        'credit',
        nayax_net_sales_cents,
        case when positive_sunze_card_rows > 0
          then positive_sunze_transaction_count else nayax_transaction_count end,
        'card_authority_daily',
        md5(concat_ws(':',
          projection_order_hash,
          nayax_net_sales_cents,
          case when positive_sunze_card_rows > 0
            then positive_sunze_transaction_count else nayax_transaction_count end,
          case when positive_sunze_card_rows > 0
            then positive_sunze_item_quantity else nayax_item_quantity end,
          case when positive_sunze_card_rows > 0
            then positive_sunze_tax_cents else nayax_tax_cents end
        )),
        projection_order_hash,
        case when positive_sunze_card_rows > 0
          then positive_sunze_item_quantity else nayax_item_quantity end,
        case when positive_sunze_card_rows > 0
          then positive_sunze_tax_cents else nayax_tax_cents end,
        jsonb_build_object(
          'projection', 'machine_local_card_authority_day',
          'nayaxCardRows', nayax_card_rows,
          'sunzePositiveCardRows', positive_sunze_card_rows,
          'revenueAuthority', 'nayax_scheduled_report',
          'operationalMetricsAuthority', case
            when positive_sunze_card_rows > 0 then 'sunze_browser'
            else 'nayax_scheduled_report'
          end,
          'authorityStartedOn', authority_start
        )
      from public.reporting_machines machine
      where machine.id = p_reporting_machine_id
      on conflict (source, source_order_hash)
        where source = 'card_authority_daily'
          and source_order_hash is not null
      do update set
        reporting_location_id = excluded.reporting_location_id,
        net_sales_cents = excluded.net_sales_cents,
        transaction_count = excluded.transaction_count,
        source_row_hash = excluded.source_row_hash,
        item_quantity = excluded.item_quantity,
        tax_cents = excluded.tax_cents,
        raw_payload = excluded.raw_payload;
    else
      delete from public.machine_sales_facts fact
      where fact.source = 'card_authority_daily'
        and fact.source_order_hash = projection_order_hash;
    end if;
  else
    -- Before the boundary, restore legacy Sunze card facts exactly. Staged
    -- overlap Nayax rows remain non-contributing until the boundary moves.
    update public.machine_sales_facts fact
    set net_sales_cents = (fact.raw_payload #>> '{_salesAuthorityOriginal,netSalesCents}')::integer,
        transaction_count = (fact.raw_payload #>> '{_salesAuthorityOriginal,transactionCount}')::integer,
        item_quantity = (fact.raw_payload #>> '{_salesAuthorityOriginal,itemQuantity}')::integer,
        tax_cents = (fact.raw_payload #>> '{_salesAuthorityOriginal,taxCents}')::integer,
        raw_payload = fact.raw_payload - 'revenueAuthority'
          - 'operationalMetricsAuthority' - 'operationalMetricsScope'
    where fact.reporting_machine_id = p_reporting_machine_id
      and fact.sale_date = p_sale_date
      and fact.source = 'sunze_browser'
      and fact.payment_method = 'credit';

    update public.machine_sales_facts fact
    set net_sales_cents = case
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
      and fact.sale_date = p_sale_date
      and fact.source = 'nayax_scheduled_report'
      and fact.payment_method = 'credit';

    delete from public.machine_sales_facts fact
    where fact.source = 'card_authority_daily'
      and fact.source_order_hash = md5(
        'card-authority-daily:' || p_reporting_machine_id::text || ':' || p_sale_date::text
      );
  end if;
end;
$$;

revoke all on function private.reconcile_machine_card_sales_authority(uuid, date)
  from public, anon, authenticated, service_role;

create or replace function private.machine_sales_fact_authority_reconcile_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if pg_trigger_depth() > 1 then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    perform private.reconcile_machine_card_sales_authority(
      old.reporting_machine_id,
      old.sale_date
    );
    return old;
  end if;

  if new.source <> 'card_authority_daily' then
    perform private.reconcile_machine_card_sales_authority(
      new.reporting_machine_id,
      new.sale_date
    );
  end if;

  if tg_op = 'UPDATE' and old.source <> 'card_authority_daily' and (
    old.reporting_machine_id is distinct from new.reporting_machine_id
    or old.sale_date is distinct from new.sale_date
  ) then
    perform private.reconcile_machine_card_sales_authority(
      old.reporting_machine_id,
      old.sale_date
    );
  end if;

  return new;
end;
$$;

revoke all on function private.machine_sales_fact_authority_reconcile_trigger()
  from public, anon, authenticated, service_role;

drop trigger if exists machine_sales_fact_authority_reconcile
  on public.machine_sales_facts;
create trigger machine_sales_fact_authority_reconcile
after insert or update or delete on public.machine_sales_facts
for each row execute function private.machine_sales_fact_authority_reconcile_trigger();

create or replace function private.reporting_machine_card_authority_reconcile_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  affected_date date;
begin
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
after update of nayax_card_sales_started_on, sunze_machine_id, nayax_machine_id
on public.reporting_machines
for each row execute function private.reporting_machine_card_authority_reconcile_trigger();

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
      or settled_at < timestamptz '2025-01-01 00:00:00+00' then
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
    'salesRecorded', (
      sales.file_digest is not null
      and (
        sales.sunze_overlap_rows = 0
        or replay.file_digest is not null
      )
    )
  )
  from (select 1) singleton
  left join public.nayax_scheduled_report_messages message
    on message.message_id = p_message_id
  left join public.nayax_scheduled_sales_ingestions sales
    on sales.file_digest = message.file_digest
  left join public.nayax_scheduled_card_authority_replays replay
    on replay.file_digest = message.file_digest
  where auth.role() = 'service_role';
$$;

revoke all on function public.service_get_nayax_report_message(text)
  from public, anon, authenticated;
grant execute on function public.service_get_nayax_report_message(text)
  to service_role;

comment on table public.nayax_scheduled_card_authority_replays is
  'Immutable receipt for one idempotent replay of authenticated Nayax rows previously skipped only because the mapped machine also used Sunze.';

comment on function public.service_ingest_nayax_scheduled_sales(text, jsonb) is
  'Idempotently stages authenticated settled Nayax card rows for every active published mapping; one machine-local boundary selects them as revenue without removing legacy Sunze card history.';
