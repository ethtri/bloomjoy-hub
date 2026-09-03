begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(16);

select ok(
  has_function_privilege('service_role', 'public.service_sync_refund_nayax_inventory(text,text,jsonb,boolean,text)', 'execute'),
  'Only the service integration receives the inventory sync RPC grant'
);

select ok(
  not has_function_privilege('authenticated', 'public.service_sync_refund_nayax_inventory(text,text,jsonb,boolean,text)', 'execute'),
  'Browser-authenticated users cannot run inventory sync'
);

select ok(
  not has_table_privilege('anon', 'public.refund_nayax_machine_inventory', 'select'),
  'Anonymous users cannot read private provider inventory'
);

select is(
  (public.service_sync_refund_nayax_inventory(
    'inventory-test-run-1',
    'test_account',
    '[{"machineId":"ACTIVE-1","machineName":"Snapcase-like name must not classify","machineTypeId":"99","statusBit":1,"active":true},{"machineId":"INACTIVE-1","machineName":"Inactive","statusBit":2,"active":false}]'::jsonb,
    true,
    null
  )->>'status'),
  'completed'::text,
  'A complete snapshot is recorded'
);

select is(
  (select count(*)::integer from public.refund_nayax_machine_inventory where account_key = 'TEST_ACCOUNT'),
  2,
  'One durable row is created per account and immutable machine ID'
);

select is(
  (select reconciliation_state from public.refund_nayax_machine_inventory where account_key = 'TEST_ACCOUNT' and nayax_machine_id = 'ACTIVE-1'),
  'needs_setup'::text,
  'A newly discovered active machine is visibly marked as needing setup'
);

select is(
  (select refund_category from public.refund_nayax_machine_inventory where account_key = 'TEST_ACCOUNT' and nayax_machine_id = 'ACTIVE-1'),
  null::text,
  'A provider name and type never guess the refund category'
);

select is(
  (public.service_sync_refund_nayax_inventory(
    'inventory-test-run-1', 'test_account', '[]'::jsonb, true, null
  )->>'replayed'),
  'true'::text,
  'Replaying a run key returns the original result without applying a second snapshot'
);

select is(
  (select count(*)::integer from public.refund_nayax_inventory_runs where run_key = 'inventory-test-run-1'),
  1,
  'Run-key replay creates no duplicate run row'
);

select lives_ok(
  $$ select public.service_sync_refund_nayax_inventory(
    'inventory-test-run-2', 'test_account',
    '[{"machineId":"INACTIVE-1","machineName":"Inactive","statusBit":2,"active":false}]'::jsonb,
    true, null
  ) $$,
  'The first complete snapshot missing an active machine is accepted'
);

select is(
  (select missing_successful_snapshots from public.refund_nayax_machine_inventory where account_key = 'TEST_ACCOUNT' and nayax_machine_id = 'ACTIVE-1'),
  1,
  'One successful miss increments the grace counter once'
);

select ok(
  (select provider_is_active from public.refund_nayax_machine_inventory where account_key = 'TEST_ACCOUNT' and nayax_machine_id = 'ACTIVE-1'),
  'One successful miss does not inactivate the machine'
);

select lives_ok(
  $$ select public.service_sync_refund_nayax_inventory(
    'inventory-test-failed', 'test_account', '[]'::jsonb, false, 'provider_timeout'
  ) $$,
  'A failed provider run is recorded without processing an empty snapshot'
);

select is(
  (select missing_successful_snapshots from public.refund_nayax_machine_inventory where account_key = 'TEST_ACCOUNT' and nayax_machine_id = 'ACTIVE-1'),
  1,
  'Failed sync does not advance missing-snapshot counters'
);

select throws_ok(
  $$ select public.service_sync_refund_nayax_inventory(
    'inventory-test-empty', 'test_account', '[]'::jsonb, true, null
  ) $$,
  'A complete Nayax inventory snapshot cannot be empty',
  'An empty successful snapshot cannot advance removal state'
);

select throws_ok(
  $$ select public.service_sync_refund_nayax_inventory(
    'inventory-test-duplicate', 'test_account',
    '[{"machineId":"DUP","active":true},{"machineId":"DUP","active":true}]'::jsonb,
    true, null
  ) $$,
  'Nayax inventory snapshot contains duplicate or missing immutable machine IDs',
  'Duplicate immutable IDs fail the complete snapshot before any mutation'
);

select * from finish();
rollback;
