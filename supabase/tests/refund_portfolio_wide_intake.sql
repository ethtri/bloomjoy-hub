begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(12);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values (
  '00000000-0000-0000-0000-000000000000',
  '90000000-0000-4000-8000-000000000001',
  'authenticated', 'authenticated', 'portfolio-manager@example.test', '', now(),
  '{}'::jsonb, '{}'::jsonb, now(), now()
);

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
  refund_public_display_label,
  nayax_machine_id,
  nayax_account_key
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
    null,
    'NAYAX-1',
    'TEST_ACCOUNT'
  ),
  (
    '93000000-0000-4000-8000-000000000002',
    '91000000-0000-4000-8000-000000000001',
    '92000000-0000-4000-8000-000000000001',
    'Portfolio machine automation ready',
    'mini',
    'active',
    true,
    'Portfolio mini public label',
    'NAYAX-2',
    'TEST_ACCOUNT'
  ),
  (
    '93000000-0000-4000-8000-000000000003',
    '91000000-0000-4000-8000-000000000001',
    '92000000-0000-4000-8000-000000000002',
    'Internal placeholder machine',
    'commercial',
    'active',
    false,
    null,
    'NAYAX-3',
    'TEST_ACCOUNT'
  ),
  (
    '93000000-0000-4000-8000-000000000004',
    '91000000-0000-4000-8000-000000000001',
    '92000000-0000-4000-8000-000000000002',
    'Internal machine with public alias',
    'commercial',
    'active',
    true,
    'Portfolio public alias',
    'NAYAX-4',
    'TEST_ACCOUNT'
  ),
  (
    '93000000-0000-4000-8000-000000000005',
    '91000000-0000-4000-8000-000000000001',
    '92000000-0000-4000-8000-000000000001',
    'Inactive portfolio machine',
    'commercial',
    'inactive',
    false,
    null,
    'NAYAX-5',
    'TEST_ACCOUNT'
  ),
  (
    '93000000-0000-4000-8000-000000000006',
    '91000000-0000-4000-8000-000000000001',
    '92000000-0000-4000-8000-000000000001',
    'Unsupported micro machine',
    'micro',
    'active',
    true,
    'Explicit Snapcase public label',
    'NAYAX-6',
    'TEST_ACCOUNT'
  ),
  (
    '93000000-0000-4000-8000-000000000007',
    '91000000-0000-4000-8000-000000000001',
    '92000000-0000-4000-8000-000000000003',
    'Machine at inactive location',
    'commercial',
    'active',
    false,
    null,
    'NAYAX-7',
    'TEST_ACCOUNT'
  );

insert into public.refund_nayax_machine_inventory (
  account_key, nayax_machine_id, machine_name, provider_is_active, refund_category,
  reporting_machine_id, reconciliation_state, setup_reason
)
values
  ('TEST_ACCOUNT', 'NAYAX-1', 'Needs setup machine', true, 'cotton_candy',
    '93000000-0000-4000-8000-000000000001', 'needs_setup', 'refund_automation_not_enabled'),
  ('TEST_ACCOUNT', 'NAYAX-2', 'Published mini', true, 'cotton_candy',
    '93000000-0000-4000-8000-000000000002', 'published', 'ready'),
  ('TEST_ACCOUNT', 'NAYAX-3', 'Placeholder machine', true, 'cotton_candy',
    '93000000-0000-4000-8000-000000000003', 'needs_setup', 'customer_label_required'),
  ('TEST_ACCOUNT', 'NAYAX-4', 'Published alias', true, 'cotton_candy',
    '93000000-0000-4000-8000-000000000004', 'published', 'ready'),
  ('TEST_ACCOUNT', 'NAYAX-5', 'Inactive reporting machine', true, 'cotton_candy',
    '93000000-0000-4000-8000-000000000005', 'published', 'ready'),
  ('TEST_ACCOUNT', 'NAYAX-6', 'Explicit Snapcase classification', true, 'snapcase',
    '93000000-0000-4000-8000-000000000006', 'published', 'ready'),
  ('TEST_ACCOUNT', 'NAYAX-7', 'Inactive reporting location', true, 'cotton_candy',
    '93000000-0000-4000-8000-000000000007', 'published', 'ready');

insert into public.reporting_machine_refund_managers (
  reporting_machine_id, manager_user_id, manager_email, status, grant_reason
)
select
  machine_id,
  '90000000-0000-4000-8000-000000000001',
  'portfolio-manager@example.test',
  'active',
  'Portfolio refund eligibility test'
from unnest(array[
  '93000000-0000-4000-8000-000000000002'::uuid,
  '93000000-0000-4000-8000-000000000004'::uuid,
  '93000000-0000-4000-8000-000000000005'::uuid,
  '93000000-0000-4000-8000-000000000006'::uuid,
  '93000000-0000-4000-8000-000000000007'::uuid
]) machine_id;

select ok(
  has_function_privilege('anon', 'public.public_refund_machine_options()', 'execute'),
  'Anonymous public intake can read the sanitized portfolio options function'
);

select ok(
  has_function_privilege('authenticated', 'public.public_refund_machine_options()', 'execute'),
  'Authenticated clients can read the same sanitized portfolio options function'
);

select ok(
  not exists (
    select 1
    from public.public_refund_machine_options()
    where machine_id = '93000000-0000-4000-8000-000000000001'
  ),
  'An active machine remains hidden until its inventory row is explicitly published'
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
  exists (
    select 1
    from public.public_refund_machine_options()
    where machine_id = '93000000-0000-4000-8000-000000000006'
  ),
  'An explicitly classified Snapcase option is eligible without a reporting-machine-type rule'
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
    'machine_type'
    in pg_get_functiondef('public.public_refund_machine_options()'::regprocedure)
  ) = 0,
  'Public eligibility does not contain a Commercial/Mini machine-type filter'
);

select * from finish();
rollback;
