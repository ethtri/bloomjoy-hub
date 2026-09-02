begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(4);

select lives_ok($$
  insert into public.orders (stripe_checkout_session_id, order_type, status, amount_total, currency)
  values ('cs_test_mini_schema_fixture', 'mini_machine', 'paid', 400000, 'usd')
$$, 'A paid Mini checkout can be persisted');

select is(
  (select fulfillment_status from public.orders where stripe_checkout_session_id = 'cs_test_mini_schema_fixture'),
  'unfulfilled', 'Mini starts in the existing fulfillment workflow'
);

select throws_ok($$
  insert into public.orders (stripe_checkout_session_id, order_type, status)
  values ('cs_test_mini_schema_fixture', 'mini_machine', 'paid')
$$, '23505', null, 'The same paid session cannot create a duplicate order');

select throws_ok($$
  insert into public.orders (order_type, status) values ('arbitrary_product', 'paid')
$$, '23514', null, 'Unsupported order types remain rejected');

select * from finish();
rollback;
