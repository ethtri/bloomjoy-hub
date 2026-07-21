begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(23);

select has_table('public', 'reporting_provider_accounts', 'provider contracts are modeled');
select has_table('public', 'reporting_source_merchants', 'provider merchants are modeled');
select has_table('public', 'reporting_source_machines', 'provider machines are modeled');
select has_table('public', 'kexiazhan_order_staging', 'Kexiazhan orders have a shadow table');
select has_table('public', 'kexiazhan_payment_staging', 'Kexiazhan payments have a shadow table');
select has_table('public', 'nayax_transaction_staging', 'Nayax transactions have a shadow table');
select has_table('public', 'snapcase_payment_reconciliations', 'card reconciliation is modeled');
select has_function(
  'public',
  'refresh_snapcase_payment_reconciliations',
  array['uuid', 'uuid', 'timestamp with time zone', 'timestamp with time zone'],
  'reconciliation refresh is server callable'
);
select has_function(
  'public',
  'admin_register_snapcase_reporting_machine',
  array['uuid', 'uuid', 'uuid', 'text', 'text', 'date', 'text'],
  'Snapcase machines have an audited registration RPC'
);
select hasnt_column(
  'public',
  'kexiazhan_order_staging',
  'source_order_id',
  'raw Kexiazhan order IDs are not persisted'
);
select hasnt_column(
  'public',
  'kexiazhan_payment_staging',
  'source_payment_id',
  'raw Kexiazhan payment IDs are not persisted'
);

insert into public.customer_accounts (id, name, account_type)
values (
  '91000000-0000-0000-0000-000000000001',
  'Snapcase foundation test account',
  'customer'
);

insert into public.reporting_locations (id, account_id, name, timezone)
values (
  '91000000-0000-0000-0000-000000000002',
  '91000000-0000-0000-0000-000000000001',
  'Snapcase foundation test location',
  'America/Los_Angeles'
);

select lives_ok(
  $$
    insert into public.reporting_machines (
      id,
      account_id,
      location_id,
      machine_label,
      machine_type,
      status
    )
    values (
      '91000000-0000-0000-0000-000000000003',
      '91000000-0000-0000-0000-000000000001',
      '91000000-0000-0000-0000-000000000002',
      'Snapcase foundation test machine',
      'snapcase',
      'active'
    )
  $$,
  'canonical reporting machines accept the Snapcase type'
);

insert into public.reporting_provider_accounts (
  id,
  provider,
  account_key,
  base_url,
  contract_status,
  default_timezone,
  default_currency_code,
  credentials_rotated_at,
  vendor_approved_at,
  approval_reason
)
values
  (
    '91000000-0000-0000-0000-000000000010',
    'kexiazhan',
    'snapcase-test-kexiazhan',
    'https://kxzcnt.kexiaozhan.com/mer',
    'approved',
    'America/Los_Angeles',
    'USD',
    now(),
    now(),
    'Fixture-only provider contract'
  ),
  (
    '91000000-0000-0000-0000-000000000011',
    'nayax',
    'snapcase-test-nayax',
    'https://lynx.nayax.com/operational/v1',
    'approved',
    'UTC',
    'USD',
    now(),
    now(),
    'Fixture-only provider contract'
  );

insert into public.reporting_source_merchants (
  id,
  provider_account_id,
  source_merchant_id,
  merchant_name,
  scope_status,
  mapped_account_id,
  approved_at,
  approval_reason
)
values (
  '91000000-0000-0000-0000-000000000020',
  '91000000-0000-0000-0000-000000000010',
  'merchant-fixture',
  'Fixture merchant',
  'approved',
  '91000000-0000-0000-0000-000000000001',
  now(),
  'Fixture merchant approval'
);

insert into public.reporting_source_machines (
  id,
  provider_account_id,
  source_machine_id,
  source_merchant_id,
  source_machine_type,
  source_timezone,
  source_currency_code,
  mapping_status,
  reporting_machine_id,
  approved_at,
  approval_reason
)
values
  (
    '91000000-0000-0000-0000-000000000030',
    '91000000-0000-0000-0000-000000000010',
    'kex-machine-fixture',
    'merchant-fixture',
    'phone_case_printer',
    'America/Los_Angeles',
    'USD',
    'approved',
    '91000000-0000-0000-0000-000000000003',
    now(),
    'Fixture Kexiazhan mapping'
  ),
  (
    '91000000-0000-0000-0000-000000000031',
    '91000000-0000-0000-0000-000000000011',
    'nayax-machine-fixture',
    null,
    'phone_case_printer',
    'UTC',
    'USD',
    'approved',
    '91000000-0000-0000-0000-000000000003',
    now(),
    'Fixture Nayax mapping'
  );

insert into public.kexiazhan_payment_staging (
  id,
  provider_account_id,
  source_payment_hash,
  external_reference_hash,
  source_machine_id,
  source_merchant_id,
  payment_time_raw,
  payment_at,
  source_timezone,
  currency_code,
  normalized_payment_method,
  source_payment_status,
  payment_amount_minor,
  refund_amount_minor,
  record_state,
  quarantine_reasons,
  source_payload_hash,
  redacted_payload
)
values (
  '91000000-0000-0000-0000-000000000040',
  '91000000-0000-0000-0000-000000000010',
  'payment-hash-fixture',
  'shared-reference-hash-fixture',
  'kex-machine-fixture',
  'merchant-fixture',
  '2026-07-18T18:01:00Z',
  '2026-07-18T18:01:00Z',
  'America/Los_Angeles',
  'USD',
  'credit',
  '1',
  2500,
  0,
  'validated',
  array[]::text[],
  'payment-payload-hash-fixture',
  '{"sourcePayloadRedacted":true}'::jsonb
);

insert into public.nayax_transaction_staging (
  id,
  provider_account_id,
  source_transaction_hash,
  payment_service_transaction_hash,
  source_machine_id,
  authorization_time_raw,
  authorized_at,
  settlement_time_raw,
  settled_at,
  currency_code,
  authorization_amount_minor,
  settlement_amount_minor,
  source_payment_method,
  record_state,
  quarantine_reasons,
  source_payload_hash,
  redacted_payload
)
values (
  '91000000-0000-0000-0000-000000000041',
  '91000000-0000-0000-0000-000000000011',
  'transaction-hash-fixture',
  'shared-reference-hash-fixture',
  'nayax-machine-fixture',
  '2026-07-18T18:01:00Z',
  '2026-07-18T18:01:00Z',
  '2026-07-19T05:00:00Z',
  '2026-07-19T05:00:00Z',
  'USD',
  2500,
  2500,
  'CreditCard',
  'validated',
  array[]::text[],
  'nayax-payload-hash-fixture',
  '{"sourcePayloadRedacted":true}'::jsonb
);

select is(
  (
    public.refresh_snapcase_payment_reconciliations(
      '91000000-0000-0000-0000-000000000010',
      '91000000-0000-0000-0000-000000000011',
      '2026-07-18T00:00:00Z',
      '2026-07-19T00:00:00Z'
    ) ->> 'exactCount'
  )::integer,
  1,
  'one shared payment reference reconciles exactly'
);

select is(
  (
    public.refresh_snapcase_payment_reconciliations(
      '91000000-0000-0000-0000-000000000010',
      '91000000-0000-0000-0000-000000000011',
      '2026-07-18T00:00:00Z',
      '2026-07-19T00:00:00Z'
    ) ->> 'salesPublicationEnabled'
  )::boolean,
  false,
  'reconciliation explicitly reports sales publication disabled'
);

select is(
  (
    select reconciliation_status
    from public.snapcase_payment_reconciliations
    where kexiazhan_payment_id = '91000000-0000-0000-0000-000000000040'
  ),
  'exact',
  'exact reconciliation state is retained'
);

select is(
  (
    select reporting_machine_id
    from public.snapcase_payment_reconciliations
    where kexiazhan_payment_id = '91000000-0000-0000-0000-000000000040'
  ),
  '91000000-0000-0000-0000-000000000003'::uuid,
  'reconciliation resolves through the canonical physical machine'
);

insert into public.kexiazhan_payment_staging (
  id,
  provider_account_id,
  source_payment_hash,
  external_reference_hash,
  source_machine_id,
  source_merchant_id,
  payment_time_raw,
  payment_at,
  source_timezone,
  currency_code,
  normalized_payment_method,
  source_payment_status,
  payment_amount_minor,
  refund_amount_minor,
  record_state,
  quarantine_reasons,
  source_payload_hash,
  redacted_payload
)
values (
  '91000000-0000-0000-0000-000000000042',
  '91000000-0000-0000-0000-000000000010',
  'duplicate-payment-hash-fixture',
  'shared-reference-hash-fixture',
  'kex-machine-fixture',
  'merchant-fixture',
  '2026-07-18T18:01:30Z',
  '2026-07-18T18:01:30Z',
  'America/Los_Angeles',
  'USD',
  'credit',
  '1',
  2500,
  0,
  'validated',
  array[]::text[],
  'duplicate-payment-payload-hash-fixture',
  '{"sourcePayloadRedacted":true}'::jsonb
);

select is(
  (
    public.refresh_snapcase_payment_reconciliations(
      '91000000-0000-0000-0000-000000000010',
      '91000000-0000-0000-0000-000000000011',
      '2026-07-18T00:00:00Z',
      '2026-07-19T00:00:00Z'
    ) ->> 'ambiguousCount'
  )::integer,
  2,
  'one Nayax transaction proposed for two payments makes both ambiguous'
);

select is(
  (
    select count(*)::integer
    from public.snapcase_payment_reconciliations
    where reconciliation_status = 'ambiguous'
  ),
  2,
  'reused card evidence never becomes an exact or proposed match'
);

select is(
  (
    select count(*)::integer
    from public.snapcase_payment_reconciliations
    where nayax_transaction_id is not null
  ),
  0,
  'ambiguous reconciliation releases the Nayax transaction identity'
);

select throws_like(
  $$
    insert into public.machine_sales_facts (
      reporting_machine_id,
      reporting_location_id,
      sale_date,
      payment_method,
      net_sales_cents,
      transaction_count,
      source,
      source_row_hash
    )
    values (
      '91000000-0000-0000-0000-000000000003',
      '91000000-0000-0000-0000-000000000002',
      '2026-07-18',
      'credit',
      2500,
      1,
      'kexiazhan_api',
      'must-not-publish'
    )
  $$,
  '%violates check constraint%',
  'Kexiazhan staging cannot write canonical sales facts'
);

select is(
  (
    select count(*)::integer
    from public.machine_sales_facts
    where reporting_machine_id = '91000000-0000-0000-0000-000000000003'
  ),
  0,
  'the shadow fixture creates no reporting or payroll sales facts'
);

select is(
  (
    select count(*)::integer
    from pg_class
    where relnamespace = 'public'::regnamespace
      and relname in (
        'reporting_provider_accounts',
        'reporting_source_merchants',
        'reporting_source_machines',
        'kexiazhan_order_staging',
        'kexiazhan_payment_staging',
        'nayax_transaction_staging',
        'snapcase_payment_reconciliations'
      )
      and relrowsecurity
  ),
  7,
  'all provider foundation tables enforce row-level security'
);

select is(
  (
    select count(*)::integer
    from pg_policies
    where schemaname = 'public'
      and tablename in (
        'reporting_provider_accounts',
        'reporting_source_merchants',
        'reporting_source_machines',
        'kexiazhan_order_staging',
        'kexiazhan_payment_staging',
        'nayax_transaction_staging',
        'snapcase_payment_reconciliations'
      )
  ),
  0,
  'provider foundation tables expose no browser RLS policies'
);

select * from finish();
rollback;
