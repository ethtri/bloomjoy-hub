-- Sunze order-hash idempotency repair.
-- Some branches briefly used migration version 202604260002 for partner
-- reporting setup. This forward migration makes the Sunze order-hash
-- constraint/index explicit for any environment that did not run the original
-- Sunze controls migration under that version.

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

select pg_notify('pgrst', 'reload schema');
