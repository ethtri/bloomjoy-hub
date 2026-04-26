-- Sunze daily sales sync reliability controls: stable order-level
-- idempotency plus a service-role-only upsert path for corrected exports.

alter table public.machine_sales_facts
  add column if not exists source_order_hash text;

update public.machine_sales_facts
set source_order_hash = raw_payload ->> 'source_order_hash'
where source = 'sunze_browser'
  and source_order_hash is null
  and raw_payload ? 'source_order_hash';

do $$
declare
  missing_hash_count integer;
begin
  select count(*)
  into missing_hash_count
  from public.machine_sales_facts
  where source = 'sunze_browser'
    and source_order_hash is null;

  if missing_hash_count > 0 then
    raise exception 'Found % legacy Sunze sales fact(s) without raw_payload.source_order_hash. Reconcile or reclassify these rows before applying Sunze order-level idempotency.', missing_hash_count;
  end if;
end;
$$;

with ranked_sunze_orders as (
  select
    id,
    row_number() over (
      partition by source_order_hash
      order by updated_at desc, created_at desc, id desc
    ) as order_rank
  from public.machine_sales_facts
  where source = 'sunze_browser'
    and source_order_hash is not null
)
delete from public.machine_sales_facts facts
using ranked_sunze_orders
where facts.id = ranked_sunze_orders.id
  and ranked_sunze_orders.order_rank > 1;

do $$
begin
  alter table public.machine_sales_facts
    add constraint machine_sales_facts_sunze_order_hash_required
    check (source <> 'sunze_browser' or source_order_hash is not null)
    not valid;
exception
  when duplicate_object then null;
end;
$$;

alter table public.machine_sales_facts
  validate constraint machine_sales_facts_sunze_order_hash_required;

create unique index if not exists machine_sales_facts_sunze_source_order_hash_idx
  on public.machine_sales_facts (source, source_order_hash)
  where source = 'sunze_browser'
    and source_order_hash is not null;

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
      fact.transaction_count,
      coalesce(nullif(fact.source, ''), 'sunze_browser') as source,
      fact.source_order_hash,
      fact.source_row_hash,
      fact.import_run_id,
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
    raw_payload = excluded.raw_payload,
    updated_at = now()
  returning target.id;
end;
$$;

revoke execute on function public.upsert_sunze_sales_facts(jsonb) from public;
revoke execute on function public.upsert_sunze_sales_facts(jsonb) from anon;
revoke execute on function public.upsert_sunze_sales_facts(jsonb) from authenticated;
grant execute on function public.upsert_sunze_sales_facts(jsonb) to service_role;
