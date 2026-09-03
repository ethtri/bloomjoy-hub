begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(15);

select has_function(
  'public',
  'owner_repair_refund_nayax_obvious_mappings',
  array[]::text[],
  'The exact-set Nayax mapping repair exists'
);

select ok(
  not has_function_privilege('anon', 'public.owner_repair_refund_nayax_obvious_mappings()', 'execute')
  and not has_function_privilege('authenticated', 'public.owner_repair_refund_nayax_obvious_mappings()', 'execute')
  and not has_function_privilege('service_role', 'public.owner_repair_refund_nayax_obvious_mappings()', 'execute'),
  'Browser and service roles cannot invoke the production mapping repair'
);

update public.customer_accounts
set name = 'Mapping repair fixture baseline ' || left(id::text, 8)
where lower(trim(name)) in (lower('TGPaci'), lower('Merlin Entertainments'));

insert into public.customer_accounts (id, name, account_type, status)
values
  ('89005000-0000-4000-8000-000000000001', 'TGPaci', 'internal', 'active'),
  ('89005000-0000-4000-8000-000000000002', 'Merlin Entertainments', 'partner', 'active');

insert into public.reporting_locations (id, account_id, name, timezone, status)
values
  ('89010000-0000-4000-8000-000000000001', '89005000-0000-4000-8000-000000000001', 'Unmapped Sunze Machines', 'America/Los_Angeles', 'active'),
  ('89010000-0000-4000-8000-000000000002', '89005000-0000-4000-8000-000000000001', 'Great Mall of the Bay Area', 'America/Los_Angeles', 'active'),
  ('89010000-0000-4000-8000-000000000003', '89005000-0000-4000-8000-000000000002', 'Las Vegas', 'America/Los_Angeles', 'active'),
  ('89010000-0000-4000-8000-000000000004', '89005000-0000-4000-8000-000000000002', 'PEPPA PIG Theme Park Dallas-Fort Worth', 'America/Chicago', 'active'),
  ('89010000-0000-4000-8000-000000000005', '89005000-0000-4000-8000-000000000002', 'SEA LIFE Grapevine', 'America/Chicago', 'active');

insert into public.reporting_machines (
  id, account_id, location_id, machine_label, machine_type, status,
  refund_public_display_label, refund_intake_enabled, nayax_refunds_enabled
)
values
  ('89020000-0000-4000-8000-000000000001', '89005000-0000-4000-8000-000000000001', '89010000-0000-4000-8000-000000000001', 'BS02 1st Livermore', 'commercial', 'active', 'San Francisco Premium Outlets — TT33 Cotton Candy', false, false),
  ('89020000-0000-4000-8000-000000000002', '89005000-0000-4000-8000-000000000001', '89010000-0000-4000-8000-000000000001', 'BS03 2nd Livermore', 'commercial', 'active', 'San Francisco Premium Outlets — TT20 Cotton Candy', false, false),
  ('89020000-0000-4000-8000-000000000003', '89005000-0000-4000-8000-000000000001', '89010000-0000-4000-8000-000000000001', 'BS09 2nd Stoneridge mall', 'commercial', 'active', 'Stoneridge Shopping Center — Cotton Candy', false, false),
  ('89020000-0000-4000-8000-000000000004', '89005000-0000-4000-8000-000000000001', '89010000-0000-4000-8000-000000000001', 'Tulsa PO New', 'commercial', 'active', 'Tulsa Premium Outlets — Cotton Candy', false, false),
  ('89020000-0000-4000-8000-000000000005', '89005000-0000-4000-8000-000000000001', '89010000-0000-4000-8000-000000000001', 'BS06 Great mall', 'commercial', 'active', 'Great Mall of the Bay Area — Cotton Candy', false, false),
  ('89020000-0000-4000-8000-000000000006', '89005000-0000-4000-8000-000000000001', '89010000-0000-4000-8000-000000000001', 'BS08 Woodland Hill', 'commercial', 'active', 'Woodland Hills Mall — Cotton Candy', false, false),
  ('89020000-0000-4000-8000-000000000007', '89005000-0000-4000-8000-000000000002', '89010000-0000-4000-8000-000000000003', 'Madame Tussauds Vegas', 'commercial', 'active', null, false, false),
  ('89020000-0000-4000-8000-000000000008', '89005000-0000-4000-8000-000000000002', '89010000-0000-4000-8000-000000000004', 'PEPPA PIG Theme Park Dallas-Fort Worth', 'commercial', 'active', null, false, false),
  ('89020000-0000-4000-8000-000000000009', '89005000-0000-4000-8000-000000000002', '89010000-0000-4000-8000-000000000005', 'SEA LIFE Grapevine', 'commercial', 'active', null, false, false);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values (
  '00000000-0000-0000-0000-000000000000',
  '89000000-0000-4000-8000-000000000001',
  'authenticated',
  'authenticated',
  'mapping-repair-manager@example.test',
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
select
  machine.id,
  '89000000-0000-4000-8000-000000000001',
  'mapping-repair-manager@example.test',
  'Exact mapping repair test route'
from public.reporting_machines machine
where machine.id::text like '89020000-0000-4000-8000-00000000000%';

insert into public.refund_nayax_machine_inventory (
  id, account_key, nayax_machine_id, machine_name, machine_number,
  provider_status_bit, provider_is_active, refund_category,
  reporting_machine_id, reconciliation_state, setup_reason
)
values
  ('89030000-0000-4000-8000-000000000001', 'TGPACI_USA_DB', '890900001', '1st Livermore outlets', 'fixture-1', 1, true, null, null, 'needs_setup', 'exact_mapping_required'),
  ('89030000-0000-4000-8000-000000000002', 'TGPACI_USA_DB', '890900002', '2nd Livermore outlets', 'fixture-2', 1, true, null, null, 'needs_setup', 'exact_mapping_required'),
  ('89030000-0000-4000-8000-000000000003', 'TGPACI_USA_DB', '890900003', 'BS01 Stoneridge mall New', 'fixture-3', 1, true, null, null, 'needs_setup', 'exact_mapping_required'),
  ('89030000-0000-4000-8000-000000000004', 'TGPACI_USA_DB', '890900004', 'BS05 New Tulsa PO', 'fixture-4', 1, true, null, null, 'needs_setup', 'exact_mapping_required'),
  ('89030000-0000-4000-8000-000000000005', 'TGPACI_USA_DB', '890900005', 'BS06 Great mall', 'fixture-5', 1, true, null, null, 'needs_setup', 'exact_mapping_required'),
  ('89030000-0000-4000-8000-000000000006', 'TGPACI_USA_DB', '890900006', 'BS07 Woodland Hill', 'fixture-6', 1, true, null, null, 'needs_setup', 'exact_mapping_required'),
  ('89030000-0000-4000-8000-000000000007', 'TGPACI_USA_DB', '890900007', 'Madame Tussauds', 'fixture-7', 1, true, null, null, 'needs_setup', 'exact_mapping_required'),
  ('89030000-0000-4000-8000-000000000008', 'TGPACI_USA_DB', '890900008', 'Peppa Pig Dallas', 'fixture-8', 1, true, null, null, 'needs_setup', 'exact_mapping_required'),
  ('89030000-0000-4000-8000-000000000009', 'TGPACI_USA_DB', '890900009', 'Dallas Sea Life', 'fixture-9', 1, true, null, null, 'needs_setup', 'exact_mapping_required');

insert into public.refund_cases (
  id, reporting_machine_id, reporting_location_id, customer_email,
  issue_summary, incident_at, incident_timezone, payment_method,
  status, correlation_status, correlation_source, automation_state,
  nayax_recommendation_state, nayax_recommendation_policy_version,
  nayax_recommendation_evaluated_at, deterministic_fact_version
)
values (
  '89040000-0000-4000-8000-000000000001',
  '89020000-0000-4000-8000-000000000005',
  '89010000-0000-4000-8000-000000000001',
  'mapping-repair-customer@example.test',
  'Synthetic setup-blocked refund case.',
  now(),
  'America/Los_Angeles',
  'card',
  'needs_review',
  'nayax_not_configured',
  'nayax',
  'under_review',
  'manual_exception',
  'fixture-policy',
  now(),
  1
);

create temporary table mapping_repair_result as
select public.owner_repair_refund_nayax_obvious_mappings() as result;

select is(
  (select (result ->> 'mappedMachineCount')::integer from mapping_repair_result),
  9,
  'The repair maps exactly the nine reviewed machines'
);

select is(
  (select (result ->> 'repairedCaseCount')::integer from mapping_repair_result),
  1,
  'The repair queues the one safe setup-blocked fixture case'
);

select is(
  (select count(*)::integer from public.reporting_machines
    where id::text like '89020000-0000-4000-8000-00000000000%'
      and nullif(trim(nayax_machine_id), '') is not null
      and nayax_account_key = 'TGPACI_USA_DB'
      and refund_intake_enabled),
  9,
  'All nine reporting machines receive exact lookup configuration'
);

select is(
  (select count(*)::integer from public.reporting_machines
    where id::text like '89020000-0000-4000-8000-00000000000%'
      and nayax_refunds_enabled),
  0,
  'The mapping repair does not enable live payment'
);

select is(
  (select count(*)::integer from public.refund_nayax_machine_inventory
    where id::text like '89030000-0000-4000-8000-00000000000%'
      and reconciliation_state = 'published'
      and refund_category = 'cotton_candy'
      and reporting_machine_id is not null),
  9,
  'All nine inventory rows become exact published cotton-candy mappings'
);

select is(
  (select count(*)::integer from public.reporting_locations
    where account_id = '89005000-0000-4000-8000-000000000001'
      and name in (
        'San Francisco Premium Outlets',
        'Stoneridge Shopping Center',
        'Tulsa Premium Outlets',
        'Woodland Hills Mall'
      )),
  4,
  'The four missing customer locations are created once'
);

select is(
  (select timezone from public.reporting_locations
    where account_id = '89005000-0000-4000-8000-000000000001'
      and name = 'Tulsa Premium Outlets'),
  'America/Chicago',
  'The repair uses the correct Central timezone for Tulsa'
);

select is(
  (select correlation_status from public.refund_cases
    where id = '89040000-0000-4000-8000-000000000001'),
  'needs_nayax',
  'The setup-blocked case is returned to automatic lookup readiness'
);

select is(
  (select deterministic_fact_version::integer from public.refund_cases
    where id = '89040000-0000-4000-8000-000000000001'),
  2,
  'The repaired mapping gives the case one fresh lookup evidence version'
);

select is(
  (select count(*)::integer from public.refund_case_events
    where refund_case_id = '89040000-0000-4000-8000-000000000001'
      and event_type = 'nayax_mapping_repaired_retry_queued'),
  1,
  'The case repair leaves one sanitized retry event'
);

select is(
  (select count(*)::integer
    from public.public_refund_machine_options() option
    where option.machine_id::text like '89020000-0000-4000-8000-00000000000%'),
  9,
  'All repaired mappings stay available on the live form'
);

select is(
  (public.owner_repair_refund_nayax_obvious_mappings() ->> 'repairedCaseCount')::integer,
  0,
  'The exact repair is idempotent and does not requeue the case'
);

select is(
  (select count(*)::integer from public.admin_audit_log
    where action = 'refund_nayax_inventory.production_mapping_repair'
      and entity_id = 'refund-nayax-obvious-mapping-v1'
      and meta ->> 'livePaymentEnablementChanged' = 'false'
      and meta ->> 'providerActionTaken' = 'false'
      and meta ->> 'customerContact' = 'false'),
  2,
  'Successful and idempotent runs leave sanitized non-payment audit evidence'
);

select * from finish();
rollback;
