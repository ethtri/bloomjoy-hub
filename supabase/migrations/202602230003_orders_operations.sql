-- Orders operations workspace + fulfillment workflow (issue #46)

alter table public.orders
  add column if not exists fulfillment_status text not null default 'unfulfilled'
    check (fulfillment_status in ('unfulfilled', 'processing', 'shipped', 'delivered', 'canceled')),
  add column if not exists fulfillment_tracking_url text,
  add column if not exists fulfillment_notes text,
  add column if not exists fulfillment_assigned_to uuid references auth.users (id) on delete set null,
  add column if not exists fulfilled_at timestamptz,
  add column if not exists fulfilled_by uuid references auth.users (id) on delete set null;

create index if not exists orders_fulfillment_status_created_at_idx
  on public.orders (fulfillment_status, created_at desc);

drop policy if exists "orders_select_super_admin" on public.orders;

create policy "orders_select_super_admin"
on public.orders
for select
using (public.is_super_admin(auth.uid()));

drop function if exists public.admin_update_order_fulfillment(uuid, text, text, text, uuid);

create or replace function public.admin_update_order_fulfillment(
  p_order_id uuid,
  p_fulfillment_status text,
  p_tracking_url text,
  p_fulfillment_notes text,
  p_assigned_to uuid
)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  before_row public.orders;
  after_row public.orders;
  normalized_fulfillment_status text;
begin
  if not public.is_super_admin(auth.uid()) then
    raise exception 'Admin access required';
  end if;

  normalized_fulfillment_status := coalesce(trim(lower(p_fulfillment_status)), '');

  if normalized_fulfillment_status not in ('unfulfilled', 'processing', 'shipped', 'delivered', 'canceled') then
    raise exception 'Invalid fulfillment status: %', p_fulfillment_status;
  end if;

  select *
  into before_row
  from public.orders
  where id = p_order_id;

  if before_row.id is null then
    raise exception 'Order not found';
  end if;

  update public.orders
  set
    fulfillment_status = normalized_fulfillment_status,
    fulfillment_tracking_url = nullif(trim(p_tracking_url), ''),
    fulfillment_notes = nullif(trim(p_fulfillment_notes), ''),
    fulfillment_assigned_to = p_assigned_to,
    fulfilled_at = case when normalized_fulfillment_status = 'delivered' then coalesce(fulfilled_at, now()) else null end,
    fulfilled_by = case when normalized_fulfillment_status = 'delivered' then coalesce(fulfilled_by, auth.uid()) else null end
  where id = p_order_id
  returning * into after_row;

  insert into public.admin_audit_log (
    actor_user_id,
    action,
    entity_type,
    entity_id,
    target_user_id,
    before,
    after
  )
  values (
    auth.uid(),
    'order.fulfillment_updated',
    'order',
    after_row.id::text,
    after_row.user_id,
    to_jsonb(before_row),
    to_jsonb(after_row)
  );

  return after_row;
end;
$$;

grant execute on function public.admin_update_order_fulfillment(uuid, text, text, text, uuid) to authenticated;
