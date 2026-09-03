begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(15);

select has_function(
  'public',
  'owner_reconcile_refund_nayax_active_inventory',
  array[]::text[],
  'The reviewed active-inventory reconciliation exists'
);

select ok(
  not has_function_privilege('anon', 'public.owner_reconcile_refund_nayax_active_inventory()', 'execute')
  and not has_function_privilege('authenticated', 'public.owner_reconcile_refund_nayax_active_inventory()', 'execute')
  and not has_function_privilege('service_role', 'public.owner_reconcile_refund_nayax_active_inventory()', 'execute'),
  'Browser and service roles cannot invoke the owner-only reconciliation'
);

update public.customer_accounts
set name = 'Active inventory fixture baseline ' || left(id::text, 8)
where lower(trim(name)) = 'tgpaci';

insert into public.customer_accounts (id, name, account_type, status)
values ('89105000-0000-4000-8000-000000000001', 'TGPaci', 'internal', 'active');

insert into public.reporting_locations (id, account_id, name, city, state, timezone, status)
values
  ('89110000-0000-4000-8000-000000000001', '89105000-0000-4000-8000-000000000001', 'Great Mall of the Bay Area', 'Milpitas', 'CA', 'America/Los_Angeles', 'active');

insert into public.reporting_machines (
  id, account_id, location_id, machine_label, machine_type, status,
  nayax_refunds_enabled, refund_intake_enabled, refund_public_display_label
)
values
  ('89120000-0000-4000-8000-000000000001', '89105000-0000-4000-8000-000000000001', '89110000-0000-4000-8000-000000000001', 'BS06 Great mall', 'commercial', 'active', false, true, 'Great Mall of the Bay Area — Cotton Candy'),
  ('89120000-0000-4000-8000-000000000002', '89105000-0000-4000-8000-000000000001', '89110000-0000-4000-8000-000000000001', 'SnapCase Great Mall', 'unknown', 'active', false, true, 'Great Mall of the Bay Area — Snapcase');

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values (
  '00000000-0000-0000-0000-000000000000',
  '89100000-0000-4000-8000-000000000001',
  'authenticated',
  'authenticated',
  'active-inventory-manager@example.test',
  '',
  now(),
  '{}'::jsonb,
  '{}'::jsonb,
  now(),
  now()
);

insert into public.reporting_machine_refund_managers (
  reporting_machine_id, manager_user_id, manager_email, grant_reason
)
values
  ('89120000-0000-4000-8000-000000000001', '89100000-0000-4000-8000-000000000001', 'active-inventory-manager@example.test', 'Cotton anchor fixture'),
  ('89120000-0000-4000-8000-000000000002', '89100000-0000-4000-8000-000000000001', 'active-inventory-manager@example.test', 'Snapcase anchor fixture');

insert into public.refund_nayax_machine_inventory (
  id, account_key, nayax_machine_id, machine_name, machine_number,
  provider_status_bit, provider_is_active, refund_category,
  reporting_machine_id, reconciliation_state, setup_reason
)
values
  ('89130000-0000-4000-8000-000000000001', 'TGPACI_USA_DB', '891900001', '1045 Plymouth Meeting', 'fixture-01', 1, true, null, null, 'needs_setup', 'exact_mapping_required'),
  ('89130000-0000-4000-8000-000000000002', 'TGPACI_USA_DB', '891900002', 'BS03 Gilroy Outlets', 'fixture-02', 1, true, null, null, 'needs_setup', 'exact_mapping_required'),
  ('89130000-0000-4000-8000-000000000003', 'TGPACI_USA_DB', '891900003', 'Preit-0990Capital city', 'fixture-03', 1, true, null, null, 'needs_setup', 'exact_mapping_required'),
  ('89130000-0000-4000-8000-000000000004', 'TGPACI_USA_DB', '891900004', 'preit1019-Willow Grove Park', 'fixture-04', 1, true, null, null, 'needs_setup', 'exact_mapping_required'),
  ('89130000-0000-4000-8000-000000000005', 'TGPACI_USA_DB', '891900005', 'Preit1046-Moorestown', 'fixture-05', 1, true, null, null, 'needs_setup', 'exact_mapping_required'),
  ('89130000-0000-4000-8000-000000000006', 'TGPACI_USA_DB', '891900006', 'Preit1077-Cherry Hill', 'fixture-06', 1, true, null, null, 'needs_setup', 'exact_mapping_required'),
  ('89130000-0000-4000-8000-000000000007', 'TGPACI_USA_DB', '891900007', 'Preit1078-Viewmont mall', 'fixture-07', 1, true, null, null, 'needs_setup', 'exact_mapping_required'),
  ('89130000-0000-4000-8000-000000000008', 'TGPACI_USA_DB', '891900008', 'Preit1085-Valley mall', 'fixture-08', 1, true, null, null, 'needs_setup', 'exact_mapping_required'),
  ('89130000-0000-4000-8000-000000000009', 'TGPACI_USA_DB', '891900009', 'Simon 1591-Avenues Mall', 'fixture-09', 1, true, null, null, 'needs_setup', 'exact_mapping_required'),
  ('89130000-0000-4000-8000-000000000010', 'TGPACI_USA_DB', '891900010', 'Simon-1584 Arizona Mills', 'fixture-10', 1, true, null, null, 'needs_setup', 'exact_mapping_required'),
  ('89130000-0000-4000-8000-000000000011', 'TGPACI_USA_DB', '891900011', 'Simon-1585 Gurnee', 'fixture-11', 1, true, null, null, 'needs_setup', 'exact_mapping_required'),
  ('89130000-0000-4000-8000-000000000012', 'TGPACI_USA_DB', '891900012', 'Simon-1592 Colorado Mills', 'fixture-12', 1, true, null, null, 'needs_setup', 'exact_mapping_required'),
  ('89130000-0000-4000-8000-000000000013', 'TGPACI_USA_DB', '891900013', 'Simon1298-White Oaks', 'fixture-13', 1, true, null, null, 'needs_setup', 'exact_mapping_required'),
  ('89130000-0000-4000-8000-000000000014', 'TGPACI_USA_DB', '891900014', 'Simon1302-South Hill Village', 'fixture-14', 1, true, null, null, 'needs_setup', 'exact_mapping_required'),
  ('89130000-0000-4000-8000-000000000015', 'TGPACI_USA_DB', '891900015', 'Simon1303 University Park mall', 'fixture-15', 1, true, null, null, 'needs_setup', 'exact_mapping_required'),
  ('89130000-0000-4000-8000-000000000016', 'TGPACI_USA_DB', '891900016', 'SnapCase Gilroy', 'fixture-16', 1, true, null, null, 'needs_setup', 'exact_mapping_required'),
  ('89130000-0000-4000-8000-000000000017', 'TGPACI_USA_DB', '891900017', 'BS08 Popcorn Christiana mall', 'fixture-17', 1, true, null, null, 'needs_setup', 'exact_mapping_required'),
  ('89130000-0000-4000-8000-000000000018', 'TGPACI_USA_DB', '891900018', 'Snapcase 03', 'fixture-18', 1, true, 'snapcase', null, 'needs_setup', 'exact_mapping_required'),
  ('89130000-0000-4000-8000-000000000019', 'TGPACI_USA_DB', '891900019', '0.5760931367898853', 'fixture-19', 1, true, null, null, 'needs_setup', 'exact_mapping_required'),
  ('89130000-0000-4000-8000-000000000020', 'TGPACI_USA_DB', '891900020', '0.8832587390894364', 'fixture-20', 1, true, null, null, 'needs_setup', 'exact_mapping_required'),
  ('89130000-0000-4000-8000-000000000021', 'TGPACI_USA_DB', '891900021', 'DU-tLiAeSjJmYLD', 'fixture-21', 1, true, null, null, 'needs_setup', 'exact_mapping_required'),
  ('89130000-0000-4000-8000-000000000022', 'TGPACI_USA_DB', '891900022', 'Github Test', 'fixture-22', 1, true, null, null, 'needs_setup', 'exact_mapping_required');

create temporary table active_inventory_result as
select public.owner_reconcile_refund_nayax_active_inventory() as result;

select is(
  (select (result ->> 'publishedMachineCount')::integer from active_inventory_result),
  16,
  'Exactly 16 reviewed customer-safe machines are published'
);

select is(
  (select (result ->> 'setupMachineCount')::integer from active_inventory_result),
  2,
  'Exactly two ambiguous machines remain explicitly in setup'
);

select is(
  (select (result ->> 'excludedMachineCount')::integer from active_inventory_result),
  4,
  'Exactly four test or invalid provider rows are excluded'
);

select is(
  (select count(*)::integer
   from public.refund_nayax_machine_inventory inventory
   where inventory.id::text like '89130000-0000-4000-8000-%'
     and inventory.reconciliation_state = 'published'
     and inventory.reporting_machine_id is not null),
  16,
  'Published inventory rows have exact reporting-machine mappings'
);

select is(
  (select count(*)::integer
   from public.refund_nayax_machine_inventory inventory
   join public.reporting_machines machine on machine.id = inventory.reporting_machine_id
   where inventory.id::text like '89130000-0000-4000-8000-%'
     and inventory.reconciliation_state = 'published'
     and public.service_refund_machine_is_public(machine.id)),
  16,
  'All published mappings appear in the customer form'
);

select is(
  (select count(*)::integer
   from public.refund_nayax_machine_inventory inventory
   join public.reporting_machines machine on machine.id = inventory.reporting_machine_id
   where inventory.id::text like '89130000-0000-4000-8000-%'
     and inventory.reconciliation_state = 'published'
     and machine.nayax_refunds_enabled),
  0,
  'The reconciliation does not enable live refunds'
);

select is(
  (select count(*)::integer
   from public.refund_nayax_machine_inventory inventory
   join lateral (
     select count(*)::integer as manager_count
     from public.reporting_machine_refund_managers manager
     where manager.reporting_machine_id = inventory.reporting_machine_id
       and manager.status = 'active'
       and manager.revoked_at is null
   ) route on true
   where inventory.id::text like '89130000-0000-4000-8000-%'
     and inventory.reconciliation_state = 'published'
     and route.manager_count between 1 and 4),
  16,
  'Every published mapping receives a bounded active manager route'
);

select is(
  (select count(*)::integer
   from public.refund_nayax_machine_inventory inventory
   where inventory.id::text like '89130000-0000-4000-8000-%'
     and inventory.reconciliation_state = 'needs_setup'
     and nullif(trim(inventory.setup_reason), '') is not null
     and inventory.reporting_machine_id is null),
  2,
  'Setup rows remain unmapped with explicit reasons'
);

select is(
  (select count(*)::integer
   from public.refund_nayax_machine_inventory inventory
   where inventory.id::text like '89130000-0000-4000-8000-%'
     and inventory.reconciliation_state = 'excluded'
     and nullif(trim(inventory.exclusion_reason), '') is not null
     and inventory.reporting_machine_id is null),
  4,
  'Excluded rows remain unmapped with explicit reasons'
);

select is(
  (select count(*)::integer
   from public.reporting_locations location
   where location.account_id = '89105000-0000-4000-8000-000000000001'
     and location.name in ('Arizona Mills', 'Colorado Mills', 'Gurnee Mills')
     and location.timezone in ('America/Phoenix', 'America/Denver', 'America/Chicago')),
  3,
  'The reviewed Arizona, Colorado, and Illinois timezones are preserved'
);

select is(
  (select count(*)::integer
   from public.admin_audit_log audit
   where audit.action = 'refund_nayax_inventory.active_inventory_reconciliation'
     and audit.entity_id = 'refund-nayax-active-inventory-v1'
     and audit.meta ->> 'livePaymentEnablementChanged' = 'false'
     and audit.meta ->> 'providerActionTaken' = 'false'
     and audit.meta ->> 'customerContact' = 'false'),
  1,
  'The reconciliation leaves sanitized non-payment audit evidence'
);

select is(
  (public.owner_reconcile_refund_nayax_active_inventory() ->> 'publishedMachineCount')::integer,
  16,
  'The exact reconciliation is idempotent'
);

select is(
  (select count(*)::integer
   from public.reporting_machines machine
   where machine.account_id = '89105000-0000-4000-8000-000000000001'
     and machine.nayax_account_key = 'TGPACI_USA_DB'
     and machine.nayax_machine_id like '8919%'),
  16,
  'An idempotent rerun does not duplicate reporting machines'
);

select * from finish();
rollback;
