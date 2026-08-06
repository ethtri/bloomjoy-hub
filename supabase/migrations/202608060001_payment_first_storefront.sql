-- Payment-first storefront order types for paid Micro Machine and mixed carts.

alter table public.orders
  drop constraint if exists orders_order_type_check;

alter table public.orders
  add constraint orders_order_type_check
  check (order_type in ('sugar', 'blank_sticks', 'micro_machine', 'mixed', 'unknown'));
