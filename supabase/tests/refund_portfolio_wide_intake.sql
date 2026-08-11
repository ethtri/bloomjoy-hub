begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(12);

insert into public.customer_accounts (id, name, account_type)
values ('91000000-0000-4000-8000-000000000001', 'Refund portfolio safety test', 'customer');

insert into public.reporting_locations (id, account_id, name, timezone, status)
values
  (
    '92000000-0000-4000-8000-000000000001',
    '91000000-0000-4000-8000-000000000001',
    'Refund portfolio active location',
    'America/Los_Angeles',
    'active'
  ),
  (
    '92000000-0000-4000-8000-000000000002',
    '91000000-0000-4000-8000-000000000001',
    'Unmapped refund portfolio test',
    'America/Chicago',
    'active'
  ),
  (
    '92000000-0000-4000-8000-000000000003',
    '91000000-0000-4000-8000-000000000001',
    'Refund portfolio inactive location',
    'America/New_York',
    'inactive'
  );

insert into public.reporting_machines (
  id,
  account_id,
  location_id,
  machine_label,
  machine_type,
  status,
  refund_intake_enabled,
  refund_public_display_label
)
values
  (
    '93000000-0000-4000-8000-000000000001',
    '91000000-0000-4000-8000-000000000001',
    '92000000-0000-4000-8000-000000000001',
    'Portfolio machine automation not ready',
    'commercial',
    'active',
    false,
    null
  ),
  (
    '93000000-0000-4000-8000-000000000002',
    '91000000-0000-4000-8000-000000000001',
    '92000000-0000-4000-8000-000000000001',
    'Portfolio machine automation ready',
    'mini',
    'active',
    true,
    'Portfolio mini public label'
  ),
  (
    '93000000-0000-4000-8000-000000000003',
    '91000000-0000-4000-8000-000000000001',
    '92000000-0000-4000-8000-000000000002',
    'Internal placeholder machine',
    'commercial',
    'active',
    false,
    null
  ),
  (
    '93000000-0000-4000-8000-000000000004',
    '91000000-0000-4000-8000-000000000001',
    '92000000-0000-4000-8000-000000000002',
    'Internal machine with public alias',
    'commercial',
    'active',
    false,
    'Portfolio public alias'
  ),
  (
    '93000000-0000-4000-8000-000000000005',
    '91000000-0000-4000-8000-000000000001',
    '92000000-0000-4000-8000-000000000001',
    'Inactive portfolio machine',
    'commercial',
    'inactive',
    false,
    null
  ),
  (
    '93000000-0000-4000-8000-000000000006',
    '91000000-0000-4000-8000-000000000001',
    '92000000-0000-4000-8000-000000000001',
    'Unsupported micro machine',
    'micro',
    'active',
    false,
    null
  ),
  (
    '93000000-0000-4000-8000-000000000007',
    '91000000-0000-4000-8000-000000000001',
    '92000000-0000-4000-8000-000000000003',
    'Machine at inactive location',
    'commercial',
    'active',
    false,
    null
  );

select ok(
  has_function_privilege('anon', 'public.public_refund_machine_options()', 'execute'),
  'Anonymous public intake can read the sanitized portfolio options function'
);

select ok(
  has_function_privilege('authenticated', 'public.public_refund_machine_options()', 'execute'),
  'Authenticated clients can read the same sanitized portfolio options function'
);

select ok(
  exists (
    select 1
    from public.public_refund_machine_options()
    where machine_id = '93000000-0000-4000-8000-000000000001'
  ),
  'An active Commercial machine appears even when automation readiness is off'
);

select ok(
  exists (
    select 1
    from public.public_refund_machine_options()
    where machine_id = '93000000-0000-4000-8000-000000000002'
  ),
  'An active Mini machine appears when automation readiness is on'
);

select ok(
  not exists (
    select 1
    from public.public_refund_machine_options()
    where machine_id = '93000000-0000-4000-8000-000000000003'
  ),
  'A placeholder location without a public label remains hidden'
);

select is(
  (
    select location_name
    from public.public_refund_machine_options()
    where machine_id = '93000000-0000-4000-8000-000000000004'
  ),
  'Portfolio public alias'::text,
  'A placeholder location is replaced by its explicit customer-facing label'
);

select is(
  (
    select machine_label
    from public.public_refund_machine_options()
    where machine_id = '93000000-0000-4000-8000-000000000004'
  ),
  'Portfolio public alias'::text,
  'The internal machine label is also replaced for a placeholder location'
);

select ok(
  not exists (
    select 1
    from public.public_refund_machine_options()
    where machine_id = '93000000-0000-4000-8000-000000000005'
  ),
  'Inactive machines remain hidden'
);

select ok(
  not exists (
    select 1
    from public.public_refund_machine_options()
    where machine_id = '93000000-0000-4000-8000-000000000006'
  ),
  'Unsupported machine types remain hidden'
);

select ok(
  not exists (
    select 1
    from public.public_refund_machine_options()
    where machine_id = '93000000-0000-4000-8000-000000000007'
  ),
  'Machines at inactive locations remain hidden'
);

select is(
  (
    select count(*)::integer
    from public.public_refund_machine_options()
    where machine_id::text like '93000000-0000-4000-8000-%'
  ),
  3,
  'Exactly the three eligible test portfolio machines are public'
);

select ok(
  position(
    'refund_intake_enabled'
    in pg_get_functiondef('public.public_refund_machine_options()'::regprocedure)
  ) = 0,
  'Portfolio visibility is independent of the legacy automation-readiness flag'
);

select * from finish();
rollback;
