-- Forward-only repair for environments that marked the account operations
-- migration applied without creating the machine inventory table.

create table if not exists public.customer_machine_inventory (
  id uuid primary key default gen_random_uuid(),
  customer_user_id uuid not null references auth.users (id) on delete cascade,
  machine_type text not null check (machine_type in ('commercial', 'mini', 'micro')),
  quantity integer not null default 0 check (quantity >= 0),
  source text not null default 'admin_portal' check (source in ('admin_portal')),
  updated_reason text not null default 'Initial entry',
  last_updated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists customer_machine_inventory_user_type_idx
  on public.customer_machine_inventory (customer_user_id, machine_type);

create index if not exists customer_machine_inventory_customer_user_id_idx
  on public.customer_machine_inventory (customer_user_id);

drop trigger if exists customer_machine_inventory_set_updated_at
  on public.customer_machine_inventory;

create trigger customer_machine_inventory_set_updated_at
before update on public.customer_machine_inventory
for each row execute function public.set_updated_at();

alter table public.customer_machine_inventory enable row level security;

drop policy if exists "customer_machine_inventory_select_super_admin"
  on public.customer_machine_inventory;
drop policy if exists "customer_machine_inventory_insert_super_admin"
  on public.customer_machine_inventory;
drop policy if exists "customer_machine_inventory_update_super_admin"
  on public.customer_machine_inventory;
drop policy if exists "customer_machine_inventory_delete_super_admin"
  on public.customer_machine_inventory;

create policy "customer_machine_inventory_select_super_admin"
on public.customer_machine_inventory
for select
using (public.is_super_admin((select auth.uid())));

create policy "customer_machine_inventory_insert_super_admin"
on public.customer_machine_inventory
for insert
with check (public.is_super_admin((select auth.uid())));

create policy "customer_machine_inventory_update_super_admin"
on public.customer_machine_inventory
for update
using (public.is_super_admin((select auth.uid())))
with check (public.is_super_admin((select auth.uid())));

create policy "customer_machine_inventory_delete_super_admin"
on public.customer_machine_inventory
for delete
using (public.is_super_admin((select auth.uid())));

create or replace function public.admin_upsert_customer_machine_inventory(
  p_customer_user_id uuid,
  p_machine_type text,
  p_quantity integer,
  p_updated_reason text
)
returns public.customer_machine_inventory
language plpgsql
security definer
set search_path = public
as $$
declare
  before_row public.customer_machine_inventory;
  after_row public.customer_machine_inventory;
  normalized_machine_type text;
  normalized_reason text;
begin
  if not public.is_super_admin(auth.uid()) then
    raise exception 'Admin access required';
  end if;

  normalized_machine_type := coalesce(trim(lower(p_machine_type)), '');
  normalized_reason := coalesce(trim(p_updated_reason), '');

  if normalized_machine_type not in ('commercial', 'mini', 'micro') then
    raise exception 'Invalid machine type: %', p_machine_type;
  end if;

  if p_quantity is null or p_quantity < 0 then
    raise exception 'Quantity must be >= 0';
  end if;

  if normalized_reason = '' then
    raise exception 'Update reason is required';
  end if;

  select *
  into before_row
  from public.customer_machine_inventory
  where customer_user_id = p_customer_user_id
    and machine_type = normalized_machine_type;

  if before_row.id is null then
    insert into public.customer_machine_inventory (
      customer_user_id,
      machine_type,
      quantity,
      source,
      updated_reason,
      last_updated_by
    )
    values (
      p_customer_user_id,
      normalized_machine_type,
      p_quantity,
      'admin_portal',
      normalized_reason,
      auth.uid()
    )
    returning * into after_row;
  else
    update public.customer_machine_inventory
    set
      quantity = p_quantity,
      source = 'admin_portal',
      updated_reason = normalized_reason,
      last_updated_by = auth.uid()
    where id = before_row.id
    returning * into after_row;
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
    'machine_inventory.upserted',
    'customer_machine_inventory',
    after_row.id::text,
    p_customer_user_id,
    coalesce(to_jsonb(before_row), '{}'::jsonb),
    to_jsonb(after_row),
    jsonb_build_object(
      'machine_type',
      normalized_machine_type,
      'updated_reason',
      normalized_reason
    )
  );

  return after_row;
end;
$$;

revoke execute on function public.admin_upsert_customer_machine_inventory(uuid, text, integer, text)
  from public, anon;
grant execute on function public.admin_upsert_customer_machine_inventory(uuid, text, integer, text)
  to authenticated;

notify pgrst, 'reload schema';
