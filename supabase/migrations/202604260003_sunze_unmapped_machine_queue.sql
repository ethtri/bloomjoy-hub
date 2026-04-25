-- Sunze unmapped machine queue: keep mapped sales flowing while admins map
-- newly discovered Sunze machine IDs to canonical reporting machines.

create table if not exists public.sunze_machine_discoveries (
  sunze_machine_id text primary key,
  sunze_machine_name text,
  status text not null default 'pending'
    check (status in ('pending', 'mapped', 'ignored')),
  reporting_machine_id uuid references public.reporting_machines (id) on delete set null,
  first_seen_import_run_id uuid references public.sales_import_runs (id) on delete set null,
  last_seen_import_run_id uuid references public.sales_import_runs (id) on delete set null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  mapped_at timestamptz,
  mapped_by uuid references auth.users (id) on delete set null,
  ignored_at timestamptz,
  ignored_by uuid references auth.users (id) on delete set null,
  ignore_reason text,
  updated_at timestamptz not null default now(),
  constraint sunze_machine_discoveries_id_present check (length(trim(sunze_machine_id)) > 0),
  constraint sunze_machine_discoveries_ignore_reason check (
    status <> 'ignored' or length(trim(coalesce(ignore_reason, ''))) > 0
  )
);

create index if not exists sunze_machine_discoveries_status_seen_idx
  on public.sunze_machine_discoveries (status, last_seen_at desc);

drop trigger if exists sunze_machine_discoveries_set_updated_at on public.sunze_machine_discoveries;
create trigger sunze_machine_discoveries_set_updated_at
before update on public.sunze_machine_discoveries
for each row execute function public.set_updated_at();

create table if not exists public.sunze_unmapped_sales (
  id uuid primary key default gen_random_uuid(),
  sunze_machine_id text not null,
  sunze_machine_name text,
  source_order_hash text not null,
  source_row_hash text not null,
  sale_date date not null,
  payment_method text not null default 'unknown'
    check (payment_method in ('cash', 'credit', 'other', 'unknown')),
  net_sales_cents integer not null default 0 check (net_sales_cents >= 0),
  transaction_count integer not null default 1 check (transaction_count >= 0),
  status text not null default 'pending'
    check (status in ('pending', 'mapped', 'ignored')),
  import_run_id uuid references public.sales_import_runs (id) on delete set null,
  reporting_machine_id uuid references public.reporting_machines (id) on delete set null,
  reporting_location_id uuid references public.reporting_locations (id) on delete set null,
  raw_payload jsonb not null default '{}'::jsonb,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  promoted_at timestamptz,
  mapped_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint sunze_unmapped_sales_machine_id_present check (length(trim(sunze_machine_id)) > 0),
  constraint sunze_unmapped_sales_order_hash_present check (length(trim(source_order_hash)) > 0),
  constraint sunze_unmapped_sales_row_hash_present check (length(trim(source_row_hash)) > 0)
);

create unique index if not exists sunze_unmapped_sales_source_order_hash_idx
  on public.sunze_unmapped_sales (source_order_hash);

create index if not exists sunze_unmapped_sales_machine_status_idx
  on public.sunze_unmapped_sales (lower(sunze_machine_id), status, sale_date desc);

drop trigger if exists sunze_unmapped_sales_set_updated_at on public.sunze_unmapped_sales;
create trigger sunze_unmapped_sales_set_updated_at
before update on public.sunze_unmapped_sales
for each row execute function public.set_updated_at();

alter table public.sunze_machine_discoveries enable row level security;
alter table public.sunze_unmapped_sales enable row level security;

drop policy if exists "sunze_machine_discoveries_select_super_admin" on public.sunze_machine_discoveries;
create policy "sunze_machine_discoveries_select_super_admin"
on public.sunze_machine_discoveries
for select
to authenticated
using (public.is_super_admin(auth.uid()));

drop policy if exists "sunze_unmapped_sales_select_super_admin" on public.sunze_unmapped_sales;
create policy "sunze_unmapped_sales_select_super_admin"
on public.sunze_unmapped_sales
for select
to authenticated
using (public.is_super_admin(auth.uid()));

drop function if exists public.admin_get_sunze_machine_mapping_queue();
create or replace function public.admin_get_sunze_machine_mapping_queue()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  result jsonb;
begin
  if not public.is_super_admin(auth.uid()) then
    raise exception 'Admin access required';
  end if;

  with pending_sales as (
    select
      lower(sale.sunze_machine_id) as normalized_sunze_machine_id,
      count(*) filter (where sale.status = 'pending') as pending_row_count,
      coalesce(sum(sale.net_sales_cents) filter (where sale.status = 'pending'), 0) as pending_revenue_cents,
      max(sale.sale_date) filter (where sale.status = 'pending') as latest_sale_date
    from public.sunze_unmapped_sales sale
    where sale.status in ('pending', 'ignored')
    group by lower(sale.sunze_machine_id)
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'sunzeMachineId', discovery.sunze_machine_id,
        'sunzeMachineName', discovery.sunze_machine_name,
        'status', discovery.status,
        'firstSeenAt', discovery.first_seen_at,
        'lastSeenAt', discovery.last_seen_at,
        'ignoredAt', discovery.ignored_at,
        'ignoreReason', discovery.ignore_reason,
        'pendingRowCount', coalesce(pending_sales.pending_row_count, 0),
        'pendingRevenueCents', coalesce(pending_sales.pending_revenue_cents, 0),
        'latestSaleDate', pending_sales.latest_sale_date
      )
      order by
        case discovery.status when 'pending' then 0 when 'ignored' then 1 else 2 end,
        coalesce(pending_sales.latest_sale_date, discovery.last_seen_at::date) desc,
        discovery.sunze_machine_id
    ),
    '[]'::jsonb
  )
  into result
  from public.sunze_machine_discoveries discovery
  left join pending_sales on pending_sales.normalized_sunze_machine_id = lower(discovery.sunze_machine_id)
  where discovery.status in ('pending', 'ignored');

  return result;
end;
$$;

drop function if exists public.admin_set_sunze_machine_discovery_status(text, text, text);
create or replace function public.admin_set_sunze_machine_discovery_status(
  p_sunze_machine_id text,
  p_status text,
  p_reason text
)
returns public.sunze_machine_discoveries
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  normalized_sunze_machine_id text;
  normalized_status text;
  normalized_reason text;
  before_row public.sunze_machine_discoveries;
  after_row public.sunze_machine_discoveries;
begin
  if not public.is_super_admin(auth.uid()) then
    raise exception 'Admin access required';
  end if;

  normalized_sunze_machine_id := trim(coalesce(p_sunze_machine_id, ''));
  normalized_status := lower(trim(coalesce(p_status, '')));
  normalized_reason := trim(coalesce(p_reason, ''));

  if normalized_sunze_machine_id = '' then
    raise exception 'Sunze machine ID is required';
  end if;

  if normalized_status not in ('pending', 'ignored') then
    raise exception 'Invalid Sunze machine queue status';
  end if;

  if normalized_status = 'ignored' and normalized_reason = '' then
    raise exception 'Ignore reason is required';
  end if;

  select *
  into before_row
  from public.sunze_machine_discoveries discovery
  where lower(discovery.sunze_machine_id) = lower(normalized_sunze_machine_id)
  limit 1;

  if before_row.sunze_machine_id is null then
    insert into public.sunze_machine_discoveries (
      sunze_machine_id,
      status,
      ignored_at,
      ignored_by,
      ignore_reason
    )
    values (
      normalized_sunze_machine_id,
      normalized_status,
      case when normalized_status = 'ignored' then now() else null end,
      case when normalized_status = 'ignored' then auth.uid() else null end,
      case when normalized_status = 'ignored' then normalized_reason else null end
    )
    returning * into after_row;
  else
    update public.sunze_machine_discoveries
    set
      status = normalized_status,
      ignored_at = case when normalized_status = 'ignored' then now() else null end,
      ignored_by = case when normalized_status = 'ignored' then auth.uid() else null end,
      ignore_reason = case when normalized_status = 'ignored' then normalized_reason else null end
    where sunze_machine_id = before_row.sunze_machine_id
    returning * into after_row;
  end if;

  update public.sunze_unmapped_sales
  set status = normalized_status
  where lower(sunze_machine_id) = lower(normalized_sunze_machine_id)
    and status in ('pending', 'ignored');

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
    'sunze_machine_discovery.status_updated',
    'sunze_machine_discovery',
    after_row.sunze_machine_id,
    null,
    coalesce(to_jsonb(before_row), '{}'::jsonb),
    to_jsonb(after_row),
    jsonb_build_object('reason', normalized_reason)
  );

  return after_row;
end;
$$;

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

grant execute on function public.admin_get_sunze_machine_mapping_queue() to authenticated;
grant execute on function public.admin_set_sunze_machine_discovery_status(text, text, text) to authenticated;
grant execute on function public.admin_upsert_reporting_machine(uuid, text, text, text, text, text, text) to authenticated;
