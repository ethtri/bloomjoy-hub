-- Sunze enriched fact upsert repair.
-- Preserve trade name, item quantity, imported tax, payment status, and payment
-- timestamp for both direct Sunze imports and queued sales promoted after admin
-- machine mapping.

alter table public.machine_sales_facts
  add column if not exists source_order_hash text,
  add column if not exists source_trade_name text,
  add column if not exists item_quantity integer not null default 1 check (item_quantity >= 0),
  add column if not exists tax_cents integer not null default 0 check (tax_cents >= 0),
  add column if not exists source_payment_status text,
  add column if not exists payment_time timestamptz;

create index if not exists machine_sales_facts_payment_time_idx
  on public.machine_sales_facts (payment_time desc)
  where payment_time is not null;

drop function if exists public.upsert_sunze_sales_facts(jsonb);
create or replace function public.upsert_sunze_sales_facts(
  p_facts jsonb
)
returns table (
  id uuid
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_facts is null or jsonb_typeof(p_facts) <> 'array' then
    raise exception 'Sunze facts payload must be a JSON array';
  end if;

  return query
  with payload as (
    select
      value as fact_json,
      ordinality
    from jsonb_array_elements(p_facts) with ordinality
  ),
  normalized as (
    select
      fact.reporting_machine_id,
      fact.reporting_location_id,
      fact.sale_date,
      fact.payment_method,
      fact.net_sales_cents,
      coalesce(fact.transaction_count, 1) as transaction_count,
      coalesce(nullif(fact.source, ''), 'sunze_browser') as source,
      fact.source_order_hash,
      fact.source_row_hash,
      fact.import_run_id,
      nullif(
        coalesce(fact.source_trade_name, fact.raw_payload ->> 'trade_name'),
        ''
      ) as source_trade_name,
      coalesce(
        fact.item_quantity,
        case
          when coalesce(fact.raw_payload ->> 'item_quantity', '') ~ '^[0-9]+$'
            then (fact.raw_payload ->> 'item_quantity')::integer
          else null
        end,
        1
      ) as item_quantity,
      coalesce(
        fact.tax_cents,
        case
          when coalesce(fact.raw_payload ->> 'tax_cents', '') ~ '^[0-9]+$'
            then (fact.raw_payload ->> 'tax_cents')::integer
          else null
        end,
        0
      ) as tax_cents,
      nullif(
        coalesce(fact.source_payment_status, fact.raw_payload ->> 'status_source'),
        ''
      ) as source_payment_status,
      coalesce(
        fact.payment_time,
        nullif(fact.raw_payload ->> 'payment_time_iso', '')::timestamptz
      ) as payment_time,
      coalesce(fact.raw_payload, '{}'::jsonb) as raw_payload,
      payload.ordinality
    from payload
    cross join lateral jsonb_to_record(payload.fact_json) as fact (
      reporting_machine_id uuid,
      reporting_location_id uuid,
      sale_date date,
      payment_method text,
      net_sales_cents integer,
      transaction_count integer,
      source text,
      source_order_hash text,
      source_row_hash text,
      import_run_id uuid,
      source_trade_name text,
      item_quantity integer,
      tax_cents integer,
      source_payment_status text,
      payment_time timestamptz,
      raw_payload jsonb
    )
  ),
  deduped as (
    select distinct on (source, source_order_hash)
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
    from normalized
    where source = 'sunze_browser'
      and source_order_hash is not null
      and source_row_hash is not null
    order by source, source_order_hash, ordinality desc
  )
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
    deduped.reporting_machine_id,
    deduped.reporting_location_id,
    deduped.sale_date,
    deduped.payment_method,
    deduped.net_sales_cents,
    deduped.transaction_count,
    deduped.source,
    deduped.source_order_hash,
    deduped.source_row_hash,
    deduped.import_run_id,
    deduped.source_trade_name,
    deduped.item_quantity,
    deduped.tax_cents,
    deduped.source_payment_status,
    deduped.payment_time,
    deduped.raw_payload
  from deduped
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
  returning target.id;
end;
$$;

revoke execute on function public.upsert_sunze_sales_facts(jsonb) from public;
revoke execute on function public.upsert_sunze_sales_facts(jsonb) from anon;
revoke execute on function public.upsert_sunze_sales_facts(jsonb) from authenticated;
grant execute on function public.upsert_sunze_sales_facts(jsonb) to service_role;

drop function if exists public.admin_upsert_reporting_machine(uuid, text, text, text, text, text, text);
create or replace function public.admin_upsert_reporting_machine(
  p_machine_id uuid,
  p_account_name text,
  p_location_name text,
  p_machine_label text,
  p_machine_type text,
  p_sunze_machine_id text,
  p_reason text
)
returns public.reporting_machines
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  normalized_account_name text;
  normalized_location_name text;
  normalized_machine_label text;
  normalized_machine_type text;
  normalized_sunze_machine_id text;
  normalized_reason text;
  promoted_pending_count integer := 0;
  account_row public.customer_accounts;
  location_row public.reporting_locations;
  before_row public.reporting_machines;
  after_row public.reporting_machines;
begin
  if not public.is_super_admin(auth.uid()) then
    raise exception 'Admin access required';
  end if;

  normalized_account_name := trim(coalesce(p_account_name, ''));
  normalized_location_name := trim(coalesce(p_location_name, ''));
  normalized_machine_label := trim(coalesce(p_machine_label, ''));
  normalized_machine_type := lower(coalesce(nullif(trim(p_machine_type), ''), 'commercial'));
  normalized_sunze_machine_id := nullif(trim(coalesce(p_sunze_machine_id, '')), '');
  normalized_reason := trim(coalesce(p_reason, ''));

  if normalized_account_name = '' then
    raise exception 'Account name is required';
  end if;

  if normalized_location_name = '' then
    raise exception 'Location name is required';
  end if;

  if normalized_machine_label = '' then
    raise exception 'Machine label is required';
  end if;

  if normalized_machine_type not in ('commercial', 'mini', 'micro', 'unknown') then
    raise exception 'Invalid machine type';
  end if;

  if normalized_reason = '' then
    raise exception 'Update reason is required';
  end if;

  select *
  into account_row
  from public.customer_accounts account
  where lower(account.name) = lower(normalized_account_name)
  limit 1;

  if account_row.id is null then
    insert into public.customer_accounts (name, account_type, created_by)
    values (normalized_account_name, 'customer', auth.uid())
    returning * into account_row;
  end if;

  select *
  into location_row
  from public.reporting_locations location
  where location.account_id = account_row.id
    and lower(location.name) = lower(normalized_location_name)
  limit 1;

  if location_row.id is null then
    insert into public.reporting_locations (account_id, name)
    values (account_row.id, normalized_location_name)
    returning * into location_row;
  end if;

  if p_machine_id is not null then
    select *
    into before_row
    from public.reporting_machines machine
    where machine.id = p_machine_id
    limit 1;
  elsif normalized_sunze_machine_id is not null then
    select *
    into before_row
    from public.reporting_machines machine
    where lower(machine.sunze_machine_id) = lower(normalized_sunze_machine_id)
    limit 1;
  end if;

  if before_row.id is null then
    insert into public.reporting_machines (
      account_id,
      location_id,
      machine_label,
      machine_type,
      sunze_machine_id
    )
    values (
      account_row.id,
      location_row.id,
      normalized_machine_label,
      normalized_machine_type,
      normalized_sunze_machine_id
    )
    returning * into after_row;
  else
    update public.reporting_machines
    set
      account_id = account_row.id,
      location_id = location_row.id,
      machine_label = normalized_machine_label,
      machine_type = normalized_machine_type,
      sunze_machine_id = normalized_sunze_machine_id,
      status = 'active'
    where id = before_row.id
    returning * into after_row;
  end if;

  if normalized_sunze_machine_id is not null then
    insert into public.sunze_machine_discoveries (
      sunze_machine_id,
      status,
      reporting_machine_id,
      mapped_at,
      mapped_by
    )
    values (
      normalized_sunze_machine_id,
      'mapped',
      after_row.id,
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

    with promotable as (
      select *
      from public.sunze_unmapped_sales pending
      where lower(pending.sunze_machine_id) = lower(normalized_sunze_machine_id)
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
        after_row.id,
        after_row.location_id,
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
          'promoted_from_unmapped_sale_id', promotable.id,
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
      reporting_machine_id = after_row.id,
      reporting_location_id = after_row.location_id,
      promoted_at = now(),
      mapped_by = auth.uid()
    where pending.source_order_hash in (select source_order_hash from upserted);

    get diagnostics promoted_pending_count = row_count;
  end if;

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
    'reporting_machine.upserted',
    'reporting_machine',
    after_row.id::text,
    null,
    coalesce(to_jsonb(before_row), '{}'::jsonb),
    to_jsonb(after_row),
    jsonb_build_object(
      'reason', normalized_reason,
      'promoted_sunze_pending_sales', promoted_pending_count
    )
  );

  return after_row;
end;
$$;

grant execute on function public.admin_upsert_reporting_machine(uuid, text, text, text, text, text, text) to authenticated;

select pg_notify('pgrst', 'reload schema');
