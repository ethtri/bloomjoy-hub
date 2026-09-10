begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

select is(
  public.reconcile_inactive_published_refund_intake()->>'skipped',
  'true',
  'Clean databases skip the production-specific inactive route repair'
);

insert into public.customer_accounts (id, name, account_type)
values ('da100000-0000-4000-8000-000000000001', 'Inactive route fixture', 'internal');

insert into public.reporting_locations (id, account_id, name, timezone)
values (
  'da200000-0000-4000-8000-000000000001',
  'da100000-0000-4000-8000-000000000001',
  'Inactive fixture location',
  'America/Los_Angeles'
);

insert into public.reporting_machines (
  id,
  account_id,
  location_id,
  machine_label,
  machine_type,
  status,
  nayax_machine_id,
  nayax_account_key,
  refund_intake_enabled,
  nayax_refunds_enabled,
  refund_public_display_label
) values (
  'a4d61df8-9f6d-4022-be00-b6e94113d302',
  'da100000-0000-4000-8000-000000000001',
  'da200000-0000-4000-8000-000000000001',
  'Inactive synthetic route',
  'unknown',
  'inactive',
  'inactive-fixture-provider-id',
  'TGPACI_USA_DB',
  true,
  true,
  'Inactive fixture — Phone cases (SnapCase)'
);

insert into public.refund_nayax_machine_inventory (
  account_key,
  nayax_machine_id,
  machine_name,
  machine_number,
  provider_is_active,
  missing_successful_snapshots,
  refund_category,
  reporting_machine_id,
  reconciliation_state
) values (
  'TGPACI_USA_DB',
  'inactive-fixture-provider-id',
  'SnapCase Gilroy',
  'inactive-fixture-number',
  true,
  0,
  'snapcase',
  'a4d61df8-9f6d-4022-be00-b6e94113d302',
  'published'
);

insert into public.refund_cases (
  id,
  public_reference,
  reporting_machine_id,
  reporting_location_id,
  customer_email,
  issue_summary,
  incident_at,
  payment_method,
  payment_amount_cents,
  status,
  correlation_status,
  intake_selection_kind,
  intake_selection_machine_ids
) values (
  'da400000-0000-4000-8000-000000000001',
  'RF-INACTIVE-ROUTE-FIXTURE',
  'a4d61df8-9f6d-4022-be00-b6e94113d302',
  'da200000-0000-4000-8000-000000000001',
  'inactive-route@example.invalid',
  'Synthetic case retained during route retirement',
  pg_catalog.now() - interval '1 day',
  'card',
  700,
  'needs_review',
  'no_match',
  'exact_machine',
  array['a4d61df8-9f6d-4022-be00-b6e94113d302'::uuid]
);

select lives_ok(
  $$select public.reconcile_inactive_published_refund_intake()$$,
  'Inactive public route is retired atomically'
);

select ok(
  (
    select status = 'inactive'
      and refund_intake_enabled is false
      and nayax_refunds_enabled is false
      and nayax_refunds_disabled_reason = 'machine_maintenance'
    from public.reporting_machines
    where id = 'a4d61df8-9f6d-4022-be00-b6e94113d302'
  ),
  'Inactive reporting machine has intake and payment execution disabled'
);

select ok(
  (
    select reconciliation_state = 'excluded'
      and setup_reason = 'inactive_reporting_machine'
      and refund_category = 'snapcase'
      and reporting_machine_id = 'a4d61df8-9f6d-4022-be00-b6e94113d302'::uuid
    from public.refund_nayax_machine_inventory
    where machine_name = 'SnapCase Gilroy'
  ),
  'Provider identity is retained in an explicit inactive-machine exclusion'
);

select ok(
  not exists (
    select 1 from public.public_refund_machine_options()
    where machine_id = 'a4d61df8-9f6d-4022-be00-b6e94113d302'
  ),
  'Inactive route remains absent from customer options'
);

select ok(
  (
    select reporting_machine_id = 'a4d61df8-9f6d-4022-be00-b6e94113d302'::uuid
      and matched_nayax_transaction_id is null
      and status = 'needs_review'
    from public.refund_cases
    where id = 'da400000-0000-4000-8000-000000000001'
  ),
  'Existing cases are not rebound, advanced, paid, or closed'
);

select is(
  public.reconcile_inactive_published_refund_intake()->>'alreadyApplied',
  'true',
  'Exact replay is harmless'
);

select is(
  (
    select count(*)::integer
    from public.admin_audit_log
    where action = 'refund_nayax_inventory.inactive_published_route_retired'
  ),
  1,
  'Replay creates no second audit event'
);

select ok(
  not has_function_privilege(
    'service_role',
    'public.reconcile_inactive_published_refund_intake()',
    'execute'
  ) and not has_function_privilege(
    'authenticated',
    'public.reconcile_inactive_published_refund_intake()',
    'execute'
  ),
  'Repair is not exposed as a customer, manager, or service action'
);

select * from finish();
rollback;
