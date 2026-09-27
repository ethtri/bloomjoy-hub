begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(4);

insert into public.customer_accounts(id, name, account_type, status)
values
  ('b2000000-0000-4000-8000-000000000001', 'SnapCase scope machine account', 'internal', 'active'),
  ('b2000000-0000-4000-8000-000000000002', 'SnapCase scope legacy period account', 'internal', 'active');

insert into public.reporting_locations(id, account_id, name, timezone, status)
values (
  'b2100000-0000-4000-8000-000000000001',
  'b2000000-0000-4000-8000-000000000001',
  'SnapCase scope location', 'America/Los_Angeles', 'active'
);

insert into public.reporting_machines(
  id, account_id, location_id, machine_label, machine_type, status
) values (
  'b2200000-0000-4000-8000-000000000001',
  'b2000000-0000-4000-8000-000000000001',
  'b2100000-0000-4000-8000-000000000001',
  'SnapCase scope machine', 'snapcase', 'active'
);

insert into public.payout_policies(id, account_id, name)
values
  ('b2300000-0000-4000-8000-000000000001', 'b2000000-0000-4000-8000-000000000001', 'Scope valid policy'),
  ('b2300000-0000-4000-8000-000000000002', 'b2000000-0000-4000-8000-000000000002', 'Scope legacy policy');

insert into public.payout_periods(
  id, account_id, payout_policy_id, period_start_date, period_end_date,
  submission_due_date, lock_date, target_payout_date
) values
  (
    'b2400000-0000-4000-8000-000000000001',
    'b2000000-0000-4000-8000-000000000001',
    'b2300000-0000-4000-8000-000000000001',
    '2026-09-01', '2026-09-30', '2026-10-02', '2026-10-03', '2026-10-05'
  ),
  (
    'b2400000-0000-4000-8000-000000000002',
    'b2000000-0000-4000-8000-000000000002',
    'b2300000-0000-4000-8000-000000000002',
    '2026-09-01', '2026-09-30', '2026-10-02', '2026-10-03', '2026-10-05'
  );

insert into public.payout_period_machine_revenue_snapshots(
  id, account_id, payout_period_id, reporting_machine_id, reporting_location_id,
  period_start_date, period_end_date
) values
  (
    'b2500000-0000-4000-8000-000000000001',
    'b2000000-0000-4000-8000-000000000001',
    'b2400000-0000-4000-8000-000000000001',
    'b2200000-0000-4000-8000-000000000001',
    'b2100000-0000-4000-8000-000000000001',
    '2026-09-01', '2026-09-30'
  ),
  (
    'b2500000-0000-4000-8000-000000000002',
    'b2000000-0000-4000-8000-000000000002',
    'b2400000-0000-4000-8000-000000000002',
    'b2200000-0000-4000-8000-000000000001',
    'b2100000-0000-4000-8000-000000000001',
    '2026-09-01', '2026-09-30'
  );

select set_config('request.jwt.claim.role', 'service_role', true);

select is(
  private.refresh_snapcase_payout_snapshots(
    jsonb_build_array('b2200000-0000-4000-8000-000000000001'),
    date '2026-09-01',
    date '2026-10-01'
  ),
  1,
  'late correction refreshes the valid same-account snapshot once'
);

select ok(
  (select regenerated_at is not null
   from public.payout_period_machine_revenue_snapshots
   where id='b2500000-0000-4000-8000-000000000001'),
  'the valid snapshot is refreshed'
);

select ok(
  (select regenerated_at is null
   from public.payout_period_machine_revenue_snapshots
   where id='b2500000-0000-4000-8000-000000000002'),
  'a legacy cross-account snapshot is left unchanged instead of aborting the import'
);

select is(
  (select count(*)::integer
   from public.admin_audit_log
   where action='operator_payout_revenue_snapshot.regenerated'
     and meta ->> 'reason'='SnapCase cash import changed source sales'),
  1,
  'only the refreshable snapshot receives the existing late-correction audit event'
);

select * from finish();
rollback;
