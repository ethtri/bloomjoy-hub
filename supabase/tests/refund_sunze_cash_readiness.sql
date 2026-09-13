begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(13);

select has_table('public', 'sunze_cash_source_watermarks', 'Private Sunze cash coverage intervals exist');
select has_column('public', 'refund_cases', 'cash_match_state', 'Refund cases can retain the server-owned cash state');
select ok(
  has_function_privilege('service_role', 'public.service_match_sunze_cash_sale(uuid,timestamptz,integer,timestamptz)', 'execute')
  and not has_function_privilege('anon', 'public.service_match_sunze_cash_sale(uuid,timestamptz,integer,timestamptz)', 'execute')
  and not has_function_privilege('authenticated', 'public.service_match_sunze_cash_sale(uuid,timestamptz,integer,timestamptz)', 'execute'),
  'Only the server can evaluate cash source readiness and matches'
);

insert into public.customer_accounts (id, name, account_type, status)
values ('35100000-0000-4000-8000-000000000001', 'Sunze readiness fixtures', 'internal', 'active');

insert into public.reporting_locations (id, account_id, name, timezone, status)
values ('35110000-0000-4000-8000-000000000001', '35100000-0000-4000-8000-000000000001', 'Synthetic location', 'America/Los_Angeles', 'active');

insert into public.reporting_machines (
  id, account_id, location_id, machine_label, machine_type, sunze_machine_id,
  status, refund_intake_enabled
)
values
  ('35120000-0000-4000-8000-000000000001', '35100000-0000-4000-8000-000000000001', '35110000-0000-4000-8000-000000000001', 'Mapped fixture', 'commercial', 'SYNZE-READY-1', 'active', true),
  ('35120000-0000-4000-8000-000000000002', '35100000-0000-4000-8000-000000000001', '35110000-0000-4000-8000-000000000001', 'Unmapped fixture', 'commercial', null, 'active', true);

select is(
  public.service_match_sunze_cash_sale('35120000-0000-4000-8000-000000000002', '2026-09-01 19:00:00+00', 1000, '2026-09-02 00:00:00+00')->>'state',
  'sales_history_unavailable',
  'An unmapped refund machine is unavailable, never complete-no-match'
);

select is(
  public.service_match_sunze_cash_sale('35120000-0000-4000-8000-000000000001', '2026-09-01 19:00:00+00', 1000, '2026-09-02 00:00:00+00')->>'state',
  'sales_history_unavailable',
  'A mapped machine without validated coverage is unavailable'
);

insert into public.sales_import_runs (
  id, source, status, rows_seen, rows_imported, meta, completed_at
)
values
  ('35130000-0000-4000-8000-000000000001', 'sunze_browser', 'completed', 1, 1,
   '{"payment_time_semantics_status":"validated","payment_time_timezone":"America/Los_Angeles","timestamp_proof_scope":"account","machine_coverage_verified":true,"visible_machine_count_mismatch":false}'::jsonb,
   '2026-09-02 00:00:00+00'),
  ('35130000-0000-4000-8000-000000000002', 'sunze_browser', 'completed', 0, 0,
   '{"payment_time_semantics_status":"validated","payment_time_timezone":"America/Los_Angeles","timestamp_proof_scope":"account","machine_coverage_verified":true,"visible_machine_count_mismatch":false}'::jsonb,
   '2026-09-04 00:00:00+00');

insert into public.sunze_cash_source_watermarks (
  reporting_machine_id, coverage_started_at, covered_through,
  last_successful_import_at, freshness_expires_at, payment_time_basis,
  payment_time_timezone, timestamp_proof_scope, import_run_id
)
values (
  '35120000-0000-4000-8000-000000000001', '2026-09-01 07:00:00+00', '2026-09-02 06:59:59.999+00',
  '2026-09-02 00:00:00+00', '2026-09-05 06:00:00+00', 'validated_iana_timezone',
  'America/Los_Angeles', 'account', '35130000-0000-4000-8000-000000000001'
);

select is(
  public.service_match_sunze_cash_sale('35120000-0000-4000-8000-000000000001', '2026-09-03 19:00:00+00', 1000, '2026-09-02 00:00:00+00')->>'state',
  'checking_sales_history',
  'A fresh source awaiting a later watermark remains checking'
);

select is(
  public.service_match_sunze_cash_sale('35120000-0000-4000-8000-000000000001', '2026-09-01 19:00:00+00', 1000, '2026-09-02 00:00:00+00')->>'state',
  'no_sale_found_with_complete_coverage',
  'Zero candidates becomes complete-no-match only inside a fresh complete interval'
);

insert into public.machine_sales_facts (
  id, reporting_machine_id, reporting_location_id, sale_date, payment_method,
  net_sales_cents, transaction_count, source, source_row_hash, source_order_hash,
  import_run_id, payment_time, source_payment_status, raw_payload
)
values (
  '35140000-0000-4000-8000-000000000001', '35120000-0000-4000-8000-000000000001',
  '35110000-0000-4000-8000-000000000001', '2026-09-01', 'cash', 1000, 1,
  'sunze_browser', 'sunze-readiness-row-1', 'sunze-readiness-order-1',
  '35130000-0000-4000-8000-000000000001', '2026-09-01 19:10:00+00', 'Payment success',
  '{"source_order_hash":"sunze-readiness-order-1"}'::jsonb
);

select is(
  public.service_match_sunze_cash_sale('35120000-0000-4000-8000-000000000001', '2026-09-01 19:00:00+00', 1000, '2026-09-02 00:00:00+00')->>'state',
  'sale_found',
  'Exactly one validated candidate is sale-found'
);

insert into public.machine_sales_facts (
  id, reporting_machine_id, reporting_location_id, sale_date, payment_method,
  net_sales_cents, transaction_count, source, source_row_hash, source_order_hash,
  import_run_id, payment_time, source_payment_status, raw_payload
)
values (
  '35140000-0000-4000-8000-000000000002', '35120000-0000-4000-8000-000000000001',
  '35110000-0000-4000-8000-000000000001', '2026-09-01', 'cash', 1000, 1,
  'sunze_browser', 'sunze-readiness-row-2', 'sunze-readiness-order-2',
  '35130000-0000-4000-8000-000000000001', '2026-09-01 19:20:00+00', 'Payment success',
  '{"source_order_hash":"sunze-readiness-order-2"}'::jsonb
);

select is(
  public.service_match_sunze_cash_sale('35120000-0000-4000-8000-000000000001', '2026-09-01 19:00:00+00', 1000, '2026-09-02 00:00:00+00')->>'state',
  'multiple_possible_sales',
  'Two validated candidates are mutually exclusive ambiguous evidence'
);

insert into public.sunze_cash_source_watermarks (
  reporting_machine_id, coverage_started_at, covered_through,
  last_successful_import_at, freshness_expires_at, payment_time_basis,
  payment_time_timezone, timestamp_proof_scope, import_run_id
)
values (
  '35120000-0000-4000-8000-000000000001', '2026-09-03 07:00:00+00', '2026-09-04 06:59:59.999+00',
  '2026-09-04 00:00:00+00', '2026-09-05 06:00:00+00', 'validated_iana_timezone',
  'America/Los_Angeles', 'account', '35130000-0000-4000-8000-000000000002'
);

select is(
  public.service_match_sunze_cash_sale('35120000-0000-4000-8000-000000000001', '2026-09-01 19:00:00+00', 1000, '2026-09-04 01:00:00+00')->>'state',
  'multiple_possible_sales',
  'A newer narrow interval cannot hide an older still-fresh interval that fully covers the purchase window'
);

select is(
  public.service_match_sunze_cash_sale('35120000-0000-4000-8000-000000000001', '2026-09-02 19:00:00+00', 1000, '2026-09-04 01:00:00+00')->>'state',
  'sales_history_unavailable',
  'Disjoint import intervals never fabricate continuous coverage across a gap'
);

select is(
  public.service_match_sunze_cash_sale('35120000-0000-4000-8000-000000000001', '2026-09-03 19:00:00+00', 1000, '2026-09-06 00:00:00+00')->>'state',
  'sales_history_unavailable',
  'Stale coverage is unavailable, never complete-no-match'
);

select ok(
  not has_table_privilege('anon', 'public.sunze_cash_source_watermarks', 'select')
  and not has_table_privilege('authenticated', 'public.sunze_cash_source_watermarks', 'select')
  and has_table_privilege('service_role', 'public.sunze_cash_source_watermarks', 'select'),
  'Cash source watermark rows are server-only'
);

select * from finish();
rollback;
