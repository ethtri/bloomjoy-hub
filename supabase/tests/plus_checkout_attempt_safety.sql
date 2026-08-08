begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(18);

create function pg_temp.capture_error(statement text)
returns text
language plpgsql
as $$
begin
  execute statement;
  return null;
exception
  when others then
    return sqlstate || ':' || sqlerrm;
end;
$$;

select ok(
  (select relrowsecurity from pg_class where oid = 'public.plus_checkout_attempts'::regclass),
  'Plus checkout attempts have RLS enabled'
);
select ok(
  (select relforcerowsecurity from pg_class where oid = 'public.plus_checkout_attempts'::regclass),
  'Plus checkout attempts force RLS'
);
select is(
  has_table_privilege('authenticated', 'public.plus_checkout_attempts', 'select'),
  false,
  'Authenticated users cannot read checkout-attempt rows directly'
);
select is(
  has_function_privilege('authenticated', 'public.claim_my_plus_checkout_attempt()', 'execute'),
  true,
  'Authenticated users can claim their own checkout attempt'
);
select is(
  has_function_privilege(
    'authenticated',
    'public.complete_my_plus_checkout_attempt(uuid,text,text,timestamptz)',
    'execute'
  ),
  true,
  'Authenticated users can complete only their tokenized checkout attempt'
);
select is(
  has_function_privilege('authenticated', 'public.release_my_plus_checkout_attempt(uuid)', 'execute'),
  true,
  'Authenticated users can release only their tokenized checkout attempt'
);
select ok(
  pg_temp.capture_error('select public.claim_my_plus_checkout_attempt()') like '42501:%',
  'Anonymous callers cannot claim a Plus checkout attempt'
);

insert into auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
)
values (
  '00000000-0000-0000-0000-000000000000',
  '79000000-0000-4000-8000-000000000001',
  'authenticated',
  'authenticated',
  'plus-checkout-attempt@example.test',
  '',
  now(),
  '{}'::jsonb,
  '{}'::jsonb,
  now(),
  now()
);

select set_config('request.jwt.claim.sub', '79000000-0000-4000-8000-000000000001', true);

create temporary table claim_results (
  label text primary key,
  result jsonb not null
);

insert into claim_results values ('first', public.claim_my_plus_checkout_attempt());
insert into claim_results values ('concurrent', public.claim_my_plus_checkout_attempt());

select is(
  (select (result ->> 'owner')::boolean from claim_results where label = 'first'),
  true,
  'The first caller owns the creation lease'
);
select is(
  (select (result ->> 'owner')::boolean from claim_results where label = 'concurrent'),
  false,
  'A concurrent caller cannot own the same creation lease'
);
select is(
  (select result ->> 'status' from claim_results where label = 'concurrent'),
  'creating',
  'The concurrent caller sees an in-progress checkout'
);
select is(
  public.complete_my_plus_checkout_attempt(
    gen_random_uuid(),
    'cs_test_wrong_token',
    'https://checkout.stripe.com/c/pay/cs_test_wrong_token',
    now() + interval '1 hour'
  ),
  false,
  'A different token cannot complete the lease'
);
select is(
  public.complete_my_plus_checkout_attempt(
    (select (result ->> 'attemptToken')::uuid from claim_results where label = 'first'),
    'cs_test_safe_attempt',
    'https://checkout.stripe.com/c/pay/cs_test_safe_attempt',
    now() + interval '1 hour'
  ),
  true,
  'The lease owner can persist the reusable Checkout Session'
);

insert into claim_results values ('ready', public.claim_my_plus_checkout_attempt());

select is(
  (select (result ->> 'owner')::boolean from claim_results where label = 'ready'),
  false,
  'A ready unexpired session is reused without a new owner'
);
select is(
  (select result ->> 'checkoutUrl' from claim_results where label = 'ready'),
  'https://checkout.stripe.com/c/pay/cs_test_safe_attempt',
  'The ready claim returns the stored Checkout URL'
);
select is(
  public.release_my_plus_checkout_attempt(
    (select (result ->> 'attemptToken')::uuid from claim_results where label = 'first')
  ),
  false,
  'A completed attempt cannot be released as creating'
);

update public.plus_checkout_attempts
set lease_expires_at = now() - interval '1 second'
where user_id = '79000000-0000-4000-8000-000000000001';

insert into claim_results values ('replacement', public.claim_my_plus_checkout_attempt());

select is(
  (select (result ->> 'owner')::boolean from claim_results where label = 'replacement'),
  true,
  'An expired attempt can be replaced by a new owner'
);
select isnt(
  (select result ->> 'attemptToken' from claim_results where label = 'replacement'),
  (select result ->> 'attemptToken' from claim_results where label = 'first'),
  'A replacement attempt receives a new stable idempotency token'
);
select is(
  public.release_my_plus_checkout_attempt(
    (select (result ->> 'attemptToken')::uuid from claim_results where label = 'replacement')
  ),
  true,
  'The current lease owner can release a failed creation attempt'
);

select * from finish();
rollback;
