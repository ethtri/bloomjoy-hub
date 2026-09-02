-- Accept the Mini order type without changing order access or fulfillment rules.
begin;
set local lock_timeout = '5s';
alter table public.orders drop constraint orders_order_type_check;
alter table public.orders add constraint orders_order_type_check
  check (order_type in ('sugar', 'blank_sticks', 'micro_machine', 'mini_machine', 'mixed', 'unknown'));
commit;
