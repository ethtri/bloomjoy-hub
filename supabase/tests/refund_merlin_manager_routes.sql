begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(11);

select has_function(
  'public',
  'owner_repair_refund_merlin_manager_routes',
  array[]::text[],
  'The exact Merlin route repair exists'
);

select ok(
  not has_function_privilege('anon', 'public.owner_repair_refund_merlin_manager_routes()', 'execute')
  and not has_function_privilege('authenticated', 'public.owner_repair_refund_merlin_manager_routes()', 'execute')
  and not has_function_privilege('service_role', 'public.owner_repair_refund_merlin_manager_routes()', 'execute'),
  'Browser and service roles cannot invoke the production route repair'
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  ('00000000-0000-0000-0000-000000000000', '91100000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'merlin-route-one@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '91100000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'merlin-route-two@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '91100000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'unexpected-route@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now());

update public.customer_accounts
set name = 'Merlin fixture baseline ' || left(id::text, 8)
where lower(trim(name)) = lower('Merlin Entertainments');

insert into public.customer_accounts (id, name, account_type, status)
values (
  '91105000-0000-4000-8000-000000000001',
  'Merlin Entertainments',
  'partner',
  'active'
);

insert into public.reporting_locations (id, account_id, name, partner_name, timezone, status)
values
  ('91110000-0000-4000-8000-000000000001', '91105000-0000-4000-8000-000000000001', 'Chicago', 'Merlin Entertainments', 'America/Chicago', 'active'),
  ('91110000-0000-4000-8000-000000000002', '91105000-0000-4000-8000-000000000001', 'Dallas', 'Merlin Entertainments', 'America/Chicago', 'active'),
  ('91110000-0000-4000-8000-000000000003', '91105000-0000-4000-8000-000000000001', 'Minneapolis', 'Merlin Entertainments', 'America/Chicago', 'active'),
  ('91110000-0000-4000-8000-000000000004', '91105000-0000-4000-8000-000000000001', 'Las Vegas', 'Merlin Entertainments', 'America/Los_Angeles', 'active'),
  ('91110000-0000-4000-8000-000000000005', '91105000-0000-4000-8000-000000000001', 'PEPPA PIG Theme Park Dallas-Fort Worth', 'Merlin Entertainments', 'America/Chicago', 'active'),
  ('91110000-0000-4000-8000-000000000006', '91105000-0000-4000-8000-000000000001', 'SEA LIFE Grapevine', 'Merlin Entertainments', 'America/Chicago', 'active');

insert into public.reporting_machines (
  id, account_id, location_id, machine_label, machine_type, status
)
values
  ('91120000-0000-4000-8000-000000000001', '91105000-0000-4000-8000-000000000001', '91110000-0000-4000-8000-000000000001', 'Merlin Chicago', 'commercial', 'active'),
  ('91120000-0000-4000-8000-000000000002', '91105000-0000-4000-8000-000000000001', '91110000-0000-4000-8000-000000000002', 'Merlin Dallas', 'commercial', 'active'),
  ('91120000-0000-4000-8000-000000000003', '91105000-0000-4000-8000-000000000001', '91110000-0000-4000-8000-000000000003', 'Merlin Minneapolis', 'commercial', 'active'),
  ('91120000-0000-4000-8000-000000000004', '91105000-0000-4000-8000-000000000001', '91110000-0000-4000-8000-000000000004', 'Madame Tussauds Vegas', 'commercial', 'active'),
  ('91120000-0000-4000-8000-000000000005', '91105000-0000-4000-8000-000000000001', '91110000-0000-4000-8000-000000000005', 'PEPPA PIG Theme Park Dallas-Fort Worth', 'commercial', 'active'),
  ('91120000-0000-4000-8000-000000000006', '91105000-0000-4000-8000-000000000001', '91110000-0000-4000-8000-000000000006', 'SEA LIFE Grapevine', 'commercial', 'active');

insert into public.reporting_machine_refund_managers (
  reporting_machine_id, manager_user_id, manager_email, grant_reason
)
select
  machine.id,
  manager_fixture.manager_user_id,
  manager_fixture.manager_email,
  'Merlin route repair test source'
from public.reporting_machines machine
join public.customer_accounts account on account.id = machine.account_id
cross join (
  values
    ('91100000-0000-4000-8000-000000000001'::uuid, 'merlin-route-one@example.test'),
    ('91100000-0000-4000-8000-000000000002'::uuid, 'merlin-route-two@example.test')
) manager_fixture(manager_user_id, manager_email)
where lower(trim(account.name)) = lower('Merlin Entertainments')
  and machine.machine_label in ('Merlin Chicago', 'Merlin Dallas', 'Merlin Minneapolis');

create temporary table merlin_route_result as
select public.owner_repair_refund_merlin_manager_routes() as result;

select is(
  (select (result ->> 'targetMachineCount')::integer from merlin_route_result),
  3,
  'The repair binds exactly the three reviewed target machines'
);

select is(
  (select (result ->> 'sourceManagerCount')::integer from merlin_route_result),
  2,
  'The repair derives exactly the two established common managers'
);

select is(
  (select (result ->> 'insertedMappingCount')::integer from merlin_route_result),
  6,
  'The first repair inserts two mappings for each target'
);

select is(
  (
    select count(*)::integer
    from public.reporting_machine_refund_managers manager
    where manager.reporting_machine_id in (
      '91120000-0000-4000-8000-000000000004',
      '91120000-0000-4000-8000-000000000005',
      '91120000-0000-4000-8000-000000000006'
    )
      and manager.status = 'active'
      and manager.revoked_at is null
  ),
  6,
  'Every target ends with exactly two active manager mappings'
);

select is(
  (
    select count(*)::integer
    from (
      select manager.reporting_machine_id
      from public.reporting_machine_refund_managers manager
      where manager.reporting_machine_id in (
        '91120000-0000-4000-8000-000000000004',
        '91120000-0000-4000-8000-000000000005',
        '91120000-0000-4000-8000-000000000006'
      )
        and manager.status = 'active'
        and manager.revoked_at is null
      group by manager.reporting_machine_id
      having count(*) = 2
    ) exact_routes
  ),
  3,
  'All three targets have the complete two-manager route'
);

select is(
  (public.owner_repair_refund_merlin_manager_routes() ->> 'insertedMappingCount')::integer,
  0,
  'The exact repair is idempotent'
);

insert into public.reporting_machine_refund_managers (
  reporting_machine_id, manager_user_id, manager_email, grant_reason
)
values (
  '91120000-0000-4000-8000-000000000004',
  '91100000-0000-4000-8000-000000000003',
  'unexpected-route@example.test',
  'Unexpected manager fail-closed test'
);

select throws_ok(
  $$select public.owner_repair_refund_merlin_manager_routes()$$,
  'P0001',
  'A Merlin refund route target has an unexpected active manager',
  'An unexpected target manager blocks the whole repair'
);

delete from public.reporting_machine_refund_managers
where reporting_machine_id = '91120000-0000-4000-8000-000000000004'
  and manager_user_id = '91100000-0000-4000-8000-000000000003';

update public.reporting_machine_refund_managers manager
set status = 'revoked', revoked_at = now(), revoke_reason = 'Source drift test'
from public.reporting_machines machine
where manager.reporting_machine_id = machine.id
  and machine.machine_label = 'Merlin Chicago'
  and manager.manager_user_id = '91100000-0000-4000-8000-000000000002';

select throws_ok(
  $$select public.owner_repair_refund_merlin_manager_routes()$$,
  'P0001',
  'Established Merlin machines must share exactly two active refund managers',
  'Partial source-manager drift blocks the whole repair'
);

select is(
  (
    select count(*)::integer
    from public.admin_audit_log audit
    where audit.action = 'reporting_machine_refund_managers.production_route_repair'
      and audit.entity_id = 'merlin-refund-route-v1'
      and audit.meta ->> 'identityDataIncluded' = 'false'
      and audit.meta ->> 'officialAction' = 'false'
      and audit.meta ->> 'customerContact' = 'false'
  ),
  2,
  'Successful first and idempotent runs leave sanitized non-action audit evidence'
);

select * from finish();
rollback;
