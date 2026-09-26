begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

insert into public.customer_accounts (id, name, account_type)
values (
  'e2100000-0000-4000-8000-000000000001',
  'Nayax sales fixture',
  'internal'
);

insert into public.reporting_locations (id, account_id, name, timezone)
values (
  'e2200000-0000-4000-8000-000000000001',
  'e2100000-0000-4000-8000-000000000001',
  'Nayax sales location',
  'America/Los_Angeles'
);

insert into public.reporting_machines (
  id,
  account_id,
  location_id,
  machine_label,
  sunze_machine_id,
  nayax_machine_id,
  nayax_account_key
) values (
  'e2300000-0000-4000-8000-000000000001',
  'e2100000-0000-4000-8000-000000000001',
  'e2200000-0000-4000-8000-000000000001',
  'Nayax-only fixture',
  null,
  '600000001',
  'TGPACI_USA_DB'
), (
  'e2300000-0000-4000-8000-000000000002',
  'e2100000-0000-4000-8000-000000000001',
  'e2200000-0000-4000-8000-000000000001',
  'Sunze overlap fixture',
  'sunze-overlap',
  '600000002',
  'TGPACI_USA_DB'
);

insert into public.refund_nayax_machine_inventory (
  account_key,
  nayax_machine_id,
  provider_is_active,
  refund_category,
  reporting_machine_id,
  reconciliation_state,
  setup_reason
) values (
  'TGPACI_USA_DB',
  '600000001',
  true,
  'snapcase',
  'e2300000-0000-4000-8000-000000000001',
  'published',
  'test_fixture'
), (
  'TGPACI_USA_DB',
  '600000002',
  true,
  'snapcase',
  'e2300000-0000-4000-8000-000000000002',
  'published',
  'test_fixture'
);

insert into public.nayax_scheduled_report_files (
  file_digest,
  received_at,
  byte_count,
  row_count,
  report
) values (
  repeat('c', 64),
  '2026-09-26T01:05:00Z',
  500,
  1,
  '{}'::jsonb
), (
  repeat('d', 64),
  '2026-09-26T01:05:00Z',
  500,
  1,
  '{}'::jsonb
);

create function pg_temp.sale(
  p_machine_id text,
  p_transaction_id text,
  p_order_hash text,
  p_row_hash text
)
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'transactionId', p_transaction_id,
    'siteId', '4',
    'actorId', '2003563806',
    'providerMachineId', p_machine_id,
    'currencyCode', 'USD',
    'authorizationAmountCents', 1080,
    'settlementAmountCents', 1080,
    'paidAmountCents', 1080,
    'providerSettledAt', '2026-09-26T01:00:00Z',
    'providerStatus', 12,
    'providerStatusName', 'Settled',
    'sourceOrderHash', p_order_hash,
    'sourceRowHash', p_row_hash
  );
$$;

select set_config('request.jwt.claim.role', 'service_role', true);

select lives_ok(
  $$select public.service_ingest_nayax_scheduled_sales(
    repeat('c', 64),
    jsonb_build_array(pg_temp.sale('600000001', '800000001', repeat('a', 64), repeat('b', 64)))
  )$$,
  'A published Nayax-only machine imports one settled sale'
);

select is(
  (
    select count(*)
    from public.machine_sales_facts
    where source = 'nayax_scheduled_report'
  ),
  1::bigint,
  'One Nayax sale fact exists'
);

select is(
  (
    select net_sales_cents
    from public.machine_sales_facts
    where source = 'nayax_scheduled_report'
  ),
  1080,
  'The settled amount is used as revenue'
);

select is(
  (
    select sale_date
    from public.machine_sales_facts
    where source = 'nayax_scheduled_report'
  ),
  date '2026-09-25',
  'The sale date uses the reporting location timezone'
);

select is(
  (
    public.service_ingest_nayax_scheduled_sales(
      repeat('c', 64),
      jsonb_build_array(pg_temp.sale('600000001', '800000001', repeat('a', 64), repeat('b', 64)))
    ) ->> 'duplicate'
  )::boolean,
  true,
  'The same report file is idempotent'
);

select lives_ok(
  $$select public.service_ingest_nayax_scheduled_sales(
    repeat('d', 64),
    jsonb_build_array(pg_temp.sale('600000002', '800000002', repeat('e', 64), repeat('f', 64)))
  )$$,
  'A Sunze-backed machine is safely recognized'
);

select is(
  (
    select sunze_overlap_rows
    from public.nayax_scheduled_sales_ingestions
    where file_digest = repeat('d', 64)
  ),
  1,
  'Sunze-backed sales are skipped to prevent double-counting'
);

select is(
  (
    select count(*)
    from public.machine_sales_facts
    where source = 'nayax_scheduled_report'
  ),
  1::bigint,
  'The overlap did not create a second fact'
);

select set_config('request.jwt.claim.role', 'authenticated', true);
select throws_ok(
  $$select public.service_ingest_nayax_scheduled_sales(repeat('c', 64), '[]'::jsonb)$$,
  'P0001',
  'Service report sales ingestion required',
  'Customer sessions cannot import provider sales'
);

select * from finish();
rollback;
