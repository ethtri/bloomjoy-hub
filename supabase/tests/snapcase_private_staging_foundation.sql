begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

create temporary table fact_baseline as
select
  (select count(*) from public.machine_sales_facts) as machine_sales_count,
  (select count(*) from public.sunze_machine_discoveries) as sunze_machine_count,
  (select count(*) from public.nayax_scheduled_sales_ingestions) as nayax_ingestion_count;

create function pg_temp.snapcase_payload(
  p_batch_key text,
  p_batch_digest text,
  p_revision_digest text,
  p_source_status text default '1'
)
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'contractVersion', 'snapcase.ingest.v1',
    'sourceAccountKey', 'kexiaozhan-primary',
    'runKey', repeat('a', 64),
    'batchKey', p_batch_key,
    'batchDigest', p_batch_digest,
    'machines', jsonb_build_array(jsonb_build_object(
      'sourceInventoryId', 'inventory-row-17',
      'sourceMachineId', 'machine-filter-42',
      'sourceMerchantId', 'merchant-8',
      'sourceMerchantName', 'Fixture merchant',
      'sourceLabel', 'Fixture machine',
      'sourceStatus', 'active',
      'sourceTimezone', 'America/Chicago',
      'sourceCurrency', 'USD',
      'revisionDigest', p_revision_digest
    )),
    'orders', jsonb_build_array(jsonb_build_object(
      'sourceKey', repeat('1', 64),
      'keyVersion', 1,
      'revisionDigest', p_revision_digest,
      'sourceMachineId', 'machine-filter-42',
      'sourceMerchantId', 'merchant-8',
      'sourceStatus', p_source_status,
      'sourcePaymentStatus', '1',
      'sourceTenderCode', '0',
      'sourceTenderLabel', 'POS',
      'normalizedTender', 'unknown',
      'occurredTimeRaw', '2026-09-25 09:15:00',
      'occurredAt', null,
      'sourceCurrency', '$',
      'currencyCode', null,
      'sourceAmountText', '12.50',
      'amountMinor', null,
      'sourceRefundAmountText', null,
      'refundAmountMinor', null,
      'productLabel', null,
      'quantity', null,
      'exceptionCodes', jsonb_build_array(
        'amount_unit_unverified',
        'currency_unverified',
        'financial_status_semantics_unverified',
        'financial_tender_semantics_unverified',
        'source_clock_offset_missing',
        'source_time_semantics_unverified'
      )
    )),
    'payments', jsonb_build_array(jsonb_build_object(
      'sourceKey', repeat('2', 64),
      'keyVersion', 1,
      'revisionDigest', p_revision_digest,
      'sourceMachineId', 'machine-filter-42',
      'sourceStatus', p_source_status,
      'sourceTransactionKey', repeat('3', 64),
      'relatedOrderKeys', jsonb_build_array(repeat('1', 64)),
      'sourceTenderCode', '1',
      'sourceTenderLabel', 'banknotes',
      'normalizedTender', 'unknown',
      'occurredTimeRaw', '2026-09-25 09:15:30',
      'occurredAt', null,
      'sourceCurrency', '$',
      'currencyCode', null,
      'sourceAmountText', '12.50',
      'amountMinor', null,
      'sourceRefundAmountText', null,
      'refundAmountMinor', null,
      'exceptionCodes', jsonb_build_array(
        'amount_unit_unverified',
        'currency_unverified',
        'financial_status_semantics_unverified',
        'financial_tender_semantics_unverified',
        'source_clock_offset_missing',
        'source_time_semantics_unverified'
      )
    )),
    'evidence', jsonb_build_array(
      jsonb_build_object(
        'resource', 'machines',
        'sourceMachineId', null,
        'query', jsonb_build_object(
          'requestedStart', '2026-09-01T00:00:00Z',
          'requestedEnd', '2026-10-01T00:00:00Z',
          'requestedTimezone', null
        ),
        'extraction', jsonb_build_object(
          'status', 'complete',
          'pageCount', 1,
          'nextCursor', null,
          'responseTruncated', false,
          'observedCount', 1,
          'rejectedCount', 0,
          'maxObservedTimeRaw', null,
          'maxObservedAt', null
        ),
        'businessCoverageStatus', 'unverified',
        'coverageReasonCode', 'source_time_semantics_unverified'
      ),
      jsonb_build_object(
        'resource', 'orders',
        'sourceMachineId', 'machine-filter-42',
        'query', jsonb_build_object(
          'requestedStart', '2026-09-01T00:00:00Z',
          'requestedEnd', '2026-10-01T00:00:00Z',
          'requestedTimezone', 'America/Los_Angeles'
        ),
        'extraction', jsonb_build_object(
          'status', 'complete',
          'pageCount', 2,
          'nextCursor', null,
          'responseTruncated', false,
          'observedCount', 1,
          'rejectedCount', 0,
          'maxObservedTimeRaw', '2026-09-25 09:15:00',
          'maxObservedAt', null
        ),
        'businessCoverageStatus', 'unverified',
        'coverageReasonCode', 'source_time_semantics_unverified'
      ),
      jsonb_build_object(
        'resource', 'payments',
        'sourceMachineId', 'machine-filter-42',
        'query', jsonb_build_object(
          'requestedStart', '2026-09-01T00:00:00Z',
          'requestedEnd', '2026-10-01T00:00:00Z',
          'requestedTimezone', 'America/Los_Angeles'
        ),
        'extraction', jsonb_build_object(
          'status', 'complete',
          'pageCount', 2,
          'nextCursor', null,
          'responseTruncated', false,
          'observedCount', 1,
          'rejectedCount', 0,
          'maxObservedTimeRaw', '2026-09-25 09:15:30',
          'maxObservedAt', null
        ),
        'businessCoverageStatus', 'unverified',
        'coverageReasonCode', 'source_time_semantics_unverified'
      )
    )
  );
$$;

select is(
  (
    select count(*)::integer
    from pg_class relation
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'private'
      and relation.relname in (
        'snapcase_provider_accounts',
        'snapcase_ingest_batches',
        'snapcase_source_machines',
        'snapcase_sales_observations',
        'snapcase_extraction_evidence'
      )
      and relation.relrowsecurity
  ),
  5,
  'every private SnapCase table has RLS enabled'
);

select ok(
  not has_table_privilege('anon', 'private.snapcase_sales_observations', 'select')
  and not has_table_privilege('authenticated', 'private.snapcase_sales_observations', 'select')
  and not has_table_privilege('service_role', 'private.snapcase_sales_observations', 'select'),
  'private observations have no direct client or service-role grants'
);

select set_config('request.jwt.claim.role', 'authenticated', true);
select throws_ok(
  $$select public.service_ingest_snapcase_observations(
    pg_temp.snapcase_payload(repeat('b', 64), repeat('c', 64), repeat('d', 64))
  )$$,
  'P0001',
  'SnapCase service ingestion required',
  'authenticated clients cannot stage provider observations'
);

select set_config('request.jwt.claim.role', 'service_role', true);
select lives_ok(
  $$select public.service_ingest_snapcase_observations(
    pg_temp.snapcase_payload(repeat('b', 64), repeat('c', 64), repeat('d', 64))
  )$$,
  'service role can stage one sanitized batch'
);

select is(
  (
    select jsonb_build_object(
      'inventoryId', source_inventory_id,
      'machineId', source_machine_id,
      'sourceTimezone', source_timezone,
      'sourceCurrency', source_currency
    )
    from private.snapcase_source_machines
    where source_machine_id = 'machine-filter-42'
  ),
  jsonb_build_object(
    'inventoryId', 'inventory-row-17',
    'machineId', 'machine-filter-42',
    'sourceTimezone', 'America/Chicago',
    'sourceCurrency', 'USD'
  ),
  'machine inventory observations preserve distinct IDs, timezone, and currency without interpreting them'
);

select is(
  (
    select count(*)::integer
    from private.snapcase_sales_observations
  ),
  2,
  'unmapped order and payment observations are both retained privately'
);

select is(
  (
    select jsonb_build_object(
      'transactionKey', source_transaction_key,
      'relatedOrderKeys', to_jsonb(related_order_keys)
    )
    from private.snapcase_sales_observations
    where resource = 'payment'
  ),
  jsonb_build_object(
    'transactionKey', repeat('3', 64),
    'relatedOrderKeys', jsonb_build_array(repeat('1', 64))
  ),
  'payment linkage retains only protected transaction and order keys'
);

select is(
  (
    public.service_ingest_snapcase_observations(
      pg_temp.snapcase_payload(repeat('b', 64), repeat('c', 64), repeat('d', 64))
    ) ->> 'duplicate'
  )::boolean,
  true,
  'an identical batch replay is idempotent'
);

select throws_ok(
  $$select public.service_ingest_snapcase_observations(
    jsonb_set(
      pg_temp.snapcase_payload(repeat('b', 64), repeat('c', 64), repeat('d', 64)),
      '{orders,0,sourceStatus}',
      '"changed"'::jsonb
    )
  )$$,
  'P0001',
  'SnapCase batch key was reused with different content',
  'a reused client digest cannot hide a changed request body'
);

select is(
  (
    select max(revision_number)
    from private.snapcase_sales_observations
  ),
  1,
  'batch replay does not create a source revision'
);

select lives_ok(
  $$select public.service_ingest_snapcase_observations(
    pg_temp.snapcase_payload(repeat('e', 64), repeat('f', 64), repeat('9', 64), '2')
  )$$,
  'a new batch can carry a changed source revision'
);

select is(
  (
    select count(*)::integer
    from private.snapcase_sales_observations
  ),
  2,
  'a changed revision updates stable source identities without duplication'
);

select is(
  (
    select min(revision_number)
    from private.snapcase_sales_observations
  ),
  2,
  'each changed observation advances its revision exactly once'
);

select is(
  (
    select source_status
    from private.snapcase_sales_observations
    where resource = 'order'
  ),
  '2',
  'the current sanitized observation reflects the newest revision'
);

select is(
  (
    select jsonb_build_object(
      'requestedStart', requested_start,
      'requestedEnd', requested_end,
      'maxObservedAt', max_observed_at,
      'maxObservedTimeRaw', max_observed_time_raw,
      'extractionStatus', extraction_status,
      'businessCoverageStatus', business_coverage_status
    )
    from private.snapcase_extraction_evidence
    where resource = 'orders'
    order by recorded_at
    limit 1
  ),
  jsonb_build_object(
    'requestedStart', '2026-09-01T00:00:00+00'::timestamptz,
    'requestedEnd', '2026-10-01T00:00:00+00'::timestamptz,
    'maxObservedAt', null,
    'maxObservedTimeRaw', '2026-09-25 09:15:00',
    'extractionStatus', 'complete',
    'businessCoverageStatus', 'unverified'
  ),
  'query window, raw maximum observation, extraction completion, and business coverage stay distinct'
);

select throws_ok(
  $$select public.service_ingest_snapcase_observations(
    pg_temp.snapcase_payload(repeat('3', 64), repeat('4', 64), repeat('5', 64))
      || jsonb_build_object('customerEmail', 'private@example.com')
  )$$,
  'P0001',
  'Invalid SnapCase ingest envelope',
  'unknown and PII-shaped envelope fields are rejected'
);

select throws_like(
  $$select public.service_ingest_snapcase_observations(
    jsonb_set(
      pg_temp.snapcase_payload(repeat('6', 64), repeat('7', 64), repeat('8', 64)),
      '{evidence,0,extraction,rejectedCount}',
      '1'::jsonb
    )
  )$$,
  '%snapcase_extraction_evidence_complete_is_extraction_only%',
  'an extraction with rejected rows cannot be recorded as complete'
);

select is(
  (select count(*) from public.machine_sales_facts),
  (select machine_sales_count from fact_baseline),
  'private SnapCase staging publishes no machine sales facts'
);

select is(
  (select count(*) from public.sunze_machine_discoveries),
  (select sunze_machine_count from fact_baseline),
  'private SnapCase staging does not change Sunze behavior'
);

select is(
  (select count(*) from public.nayax_scheduled_sales_ingestions),
  (select nayax_ingestion_count from fact_baseline),
  'private SnapCase staging does not change Nayax behavior'
);

select * from finish();
rollback;
