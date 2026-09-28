begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(13);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  (
    '00000000-0000-0000-0000-000000000000',
    '15700000-0000-4000-8000-000000000001',
    'authenticated', 'authenticated', 'sales-report-admin@example.invalid', '', now(),
    '{}'::jsonb, '{}'::jsonb, now(), now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '15700000-0000-4000-8000-000000000002',
    'authenticated', 'authenticated', 'sales-report-outsider@example.invalid', '', now(),
    '{}'::jsonb, '{}'::jsonb, now(), now()
  );

insert into public.admin_roles (user_id, role, active)
values ('15700000-0000-4000-8000-000000000001', 'super_admin', true);

insert into public.customer_accounts (id, name, account_type, status)
values (
  '15701000-0000-4000-8000-000000000001',
  'Sales report fixture',
  'internal',
  'active'
);

insert into public.reporting_locations (id, account_id, name, timezone, status)
values
  (
    '15702000-0000-4000-8000-000000000001',
    '15701000-0000-4000-8000-000000000001',
    'Current machine location',
    'America/Los_Angeles',
    'active'
  ),
  (
    '15702000-0000-4000-8000-000000000002',
    '15701000-0000-4000-8000-000000000001',
    'Recorded sales location',
    'America/Los_Angeles',
    'active'
  );

insert into public.reporting_machines (
  id, account_id, location_id, machine_label, machine_type, status
) values (
  '15703000-0000-4000-8000-000000000001',
  '15701000-0000-4000-8000-000000000001',
  '15702000-0000-4000-8000-000000000001',
  'Sales report machine',
  'commercial',
  'active'
);

insert into public.machine_sales_facts (
  id, reporting_machine_id, reporting_location_id, sale_date, payment_method,
  net_sales_cents, transaction_count, source, source_order_hash, source_row_hash
) values
  (
    '15704000-0000-4000-8000-000000000001',
    '15703000-0000-4000-8000-000000000001',
    '15702000-0000-4000-8000-000000000002',
    '2026-09-01', 'credit', 40500, 40, 'sample_seed',
    'sales-report-card-order', 'sales-report-card-row'
  ),
  (
    '15704000-0000-4000-8000-000000000002',
    '15703000-0000-4000-8000-000000000001',
    '15702000-0000-4000-8000-000000000002',
    '2026-09-01', 'cash', 10000, 10, 'sample_seed',
    'sales-report-cash-order', 'sales-report-cash-row'
  );

insert into public.refund_cases (
  id, reporting_machine_id, reporting_location_id, customer_email,
  issue_summary, incident_at, payment_method
) values (
  '15705000-0000-4000-8000-000000000001',
  '15703000-0000-4000-8000-000000000001',
  '15702000-0000-4000-8000-000000000002',
  'card-refund@example.invalid', 'Synthetic card refund',
  '2026-09-01T12:00:00-07:00', 'card'
);

insert into public.sales_adjustment_facts (
  id, reporting_machine_id, reporting_location_id, adjustment_date,
  adjustment_type, amount_cents, source, source_row_hash, refund_case_id
) values (
  '15706000-0000-4000-8000-000000000001',
  '15703000-0000-4000-8000-000000000001',
  '15702000-0000-4000-8000-000000000002',
  '2026-09-01', 'refund', 2700, 'manual', 'sales-report-card-refund',
  '15705000-0000-4000-8000-000000000001'
);

insert into public.sales_adjustment_facts (
  id, reporting_machine_id, reporting_location_id, adjustment_date,
  adjustment_type, amount_cents, source, source_row_hash
) values
  (
    '15706000-0000-4000-8000-000000000002',
    '15703000-0000-4000-8000-000000000001',
    '15702000-0000-4000-8000-000000000002',
    '2026-09-02', 'refund', 500, 'manual', 'sales-report-unknown-refund'
  ),
  (
    '15706000-0000-4000-8000-000000000003',
    '15703000-0000-4000-8000-000000000001',
    '15702000-0000-4000-8000-000000000002',
    '2026-09-03', 'refund', 300, 'manual', 'sales-report-reverse-case-refund'
  );

insert into public.refund_cases (
  id, reporting_machine_id, reporting_location_id, customer_email,
  zelle_payment_contact, issue_summary, incident_at, payment_method,
  reporting_adjustment_id
) values (
  '15705000-0000-4000-8000-000000000002',
  '15703000-0000-4000-8000-000000000001',
  '15702000-0000-4000-8000-000000000002',
  'cash-refund@example.invalid', 'cash-refund@example.invalid',
  'Synthetic cash refund', '2026-09-03T12:00:00-07:00', 'cash',
  '15706000-0000-4000-8000-000000000003'
);

insert into public.sales_adjustment_facts (
  id, reporting_machine_id, reporting_location_id, adjustment_date,
  adjustment_type, amount_cents, source, source_row_hash
) values (
  '15706000-0000-4000-8000-000000000004',
  '15703000-0000-4000-8000-000000000001',
  '15702000-0000-4000-8000-000000000002',
  '2026-09-01', 'manual_adjustment', 900, 'manual',
  'sales-report-non-refund-manual-adjustment'
);

select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '15700000-0000-4000-8000-000000000001', true);

select results_eq(
  $$
    select
      sum(gross_sales_cents)::bigint,
      sum(refund_amount_cents)::bigint,
      sum(net_sales_cents)::bigint,
      sum(transaction_count)::bigint
    from public.get_sales_report('2026-09-01', '2026-09-01', 'day')
  $$,
  $$values (50500::bigint, 2700::bigint, 47800::bigint, 50::bigint)$$,
  'Recorded 505 dollars minus 27 dollars of refunds reports 478 dollars after refunds'
);

select results_eq(
  $$
    select location_id, location_name
    from public.get_sales_report(
      '2026-09-01', '2026-09-01', 'day', null,
      array['15702000-0000-4000-8000-000000000002'::uuid], array['credit']
    )
  $$,
  $$values (
    '15702000-0000-4000-8000-000000000002'::uuid,
    'Recorded sales location'::text
  )$$,
  'Historical facts retain their recorded location label and location filter'
);

select results_eq(
  $$
    select payment_method, gross_sales_cents, refund_amount_cents, net_sales_cents
    from public.get_sales_report(
      '2026-09-01', '2026-09-01', 'day', null, null, array['credit']
    )
  $$,
  $$values ('credit'::text, 40500::bigint, 2700::bigint, 37800::bigint)$$,
  'A known card refund stays with card sales'
);

select results_eq(
  $$
    select payment_method, gross_sales_cents, refund_amount_cents, net_sales_cents
    from public.get_sales_report(
      '2026-09-01', '2026-09-01', 'day', null, null, array['cash']
    )
  $$,
  $$values ('cash'::text, 10000::bigint, 0::bigint, 10000::bigint)$$,
  'Cash sales do not inherit a known card refund'
);

select results_eq(
  $$
    select period_start, payment_method, gross_sales_cents, refund_amount_cents, net_sales_cents
    from public.get_sales_report('2026-09-02', '2026-09-02', 'day')
  $$,
  $$values (date '2026-09-02', 'unknown'::text, 0::bigint, 500::bigint, (-500)::bigint)$$,
  'A refund-only date remains visible with unknown tender and a negative after-refund total'
);

select is_empty(
  $$
    select *
    from public.get_sales_report(
      '2026-09-02', '2026-09-02', 'day', null, null, array['credit']
    )
  $$,
  'A credit filter does not invent a tender for an unknown refund'
);

select results_eq(
  $$
    select payment_method, gross_sales_cents, refund_amount_cents, net_sales_cents
    from public.get_sales_report('2026-09-03', '2026-09-03', 'day')
  $$,
  $$values ('cash'::text, 0::bigint, 300::bigint, (-300)::bigint)$$,
  'Reverse reporting-adjustment linkage supplies proven cash tender on a refund-only date'
);

select results_eq(
  $$
    select payment_method, gross_sales_cents, refund_amount_cents, net_sales_cents
    from public.get_sales_report('2026-09-01', '2026-09-30', 'month')
    order by payment_method
  $$,
  $$values
    ('cash'::text, 10000::bigint, 300::bigint, 9700::bigint),
    ('credit'::text, 40500::bigint, 2700::bigint, 37800::bigint),
    ('unknown'::text, 0::bigint, 500::bigint, (-500)::bigint)
  $$,
  'Month grain keeps evidenced tenders and unknown refunds separate'
);

select results_eq(
  $$
    select payment_method, gross_sales_cents, refund_amount_cents, net_sales_cents
    from public.get_sales_report(jsonb_build_object(
      'dateFrom', '2026-09-01',
      'dateTo', '2026-09-01',
      'grain', 'day',
      'paymentMethods', jsonb_build_array('credit')
    ))
  $$,
  $$values ('credit'::text, 40500::bigint, 2700::bigint, 37800::bigint)$$,
  'The JSON adapter preserves the corrected card-filter contract'
);

select set_config('request.jwt.claim.sub', '15700000-0000-4000-8000-000000000002', true);
select is_empty(
  $$select * from public.get_sales_report('2026-09-01', '2026-09-30', 'day')$$,
  'A user without reporting access cannot read the fixture rows'
);

select set_config('request.jwt.claim.sub', '', true);
select throws_ok(
  $$select * from public.get_sales_report('2026-09-01', '2026-09-30', 'day')$$,
  'P0001',
  'Authentication required',
  'An unauthenticated caller cannot read the report'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.get_sales_report(date,date,text,uuid[],uuid[],text[])',
    'execute'
  ),
  'Anonymous execute remains revoked'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.get_sales_report(date,date,text,uuid[],uuid[],text[])',
    'execute'
  ),
  'Authenticated execute remains available'
);

select * from finish();
rollback;
