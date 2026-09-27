begin;

select plan(4);

select set_config('request.jwt.claim.role', '', true);
select set_config('request.jwt.claims', '{"role":"authenticated"}', true);

select throws_ok(
  $$
    select public.service_finalize_snapcase_import_run(
      'claim-shape-regression',
      repeat('0', 64)
    )
  $$,
  'Service role required',
  'non-service hosted claims remain unauthorized'
);

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

insert into private.snapcase_provider_accounts (source_account_key)
values ('claim-shape-regression');

select is(
  auth.role(),
  'service_role',
  'hosted PostgREST claim JSON resolves the service role'
);

select lives_ok(
  $$
    select public.service_finalize_snapcase_import_run(
      'claim-shape-regression',
      repeat('0', 64)
    )
  $$,
  'hosted claim JSON reaches the private finalizer instead of failing authorization'
);

select is(
  current_setting('request.jwt.claim.role', true),
  'service_role',
  'the finalizer bridges the role for the existing private projection transaction'
);

select * from finish();

rollback;
