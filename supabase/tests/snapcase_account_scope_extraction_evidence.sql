begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

create function pg_temp.account_scope_payload()
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'contractVersion', 'snapcase.ingest.v1',
    'sourceAccountKey', 'account-wide-history-fixture',
    'runKey', repeat('1', 64),
    'batchKey', repeat('2', 64),
    'batchDigest', repeat('3', 64),
    'machines', '[]'::jsonb,
    'orders', '[]'::jsonb,
    'payments', '[]'::jsonb,
    'evidence', jsonb_build_array(
      jsonb_build_object(
        'resource', 'orders',
        'sourceMachineId', null,
        'query', jsonb_build_object(
          'requestedStart', '2025-01-01T00:00:00Z',
          'requestedEnd', '2025-02-01T00:00:00Z',
          'requestedTimezone', 'UTC'
        ),
        'extraction', jsonb_build_object(
          'status', 'complete',
          'pageCount', 1,
          'nextCursor', null,
          'responseTruncated', false,
          'observedCount', 0,
          'expectedTotal', 0,
          'effectivePageSize', 50,
          'rejectedCount', 0,
          'maxObservedTimeRaw', null,
          'maxObservedAt', null
        ),
        'businessCoverageStatus', 'unverified',
        'coverageReasonCode', 'source_time_semantics_unverified'
      ),
      jsonb_build_object(
        'resource', 'payments',
        'sourceMachineId', null,
        'query', jsonb_build_object(
          'requestedStart', '2025-01-01T00:00:00Z',
          'requestedEnd', '2025-02-01T00:00:00Z',
          'requestedTimezone', 'UTC'
        ),
        'extraction', jsonb_build_object(
          'status', 'complete',
          'pageCount', 1,
          'nextCursor', null,
          'responseTruncated', false,
          'observedCount', 0,
          'expectedTotal', 0,
          'effectivePageSize', 50,
          'rejectedCount', 0,
          'maxObservedTimeRaw', null,
          'maxObservedAt', null
        ),
        'businessCoverageStatus', 'unverified',
        'coverageReasonCode', 'source_time_semantics_unverified'
      )
    )
  );
$$;

select lives_ok(
  $$select public.service_ingest_snapcase_observations(pg_temp.account_scope_payload())$$,
  'account-wide empty extraction receipts are accepted without inventing a machine'
);

select is(
  (
    select count(*)::integer
    from private.snapcase_extraction_evidence evidence
    join private.snapcase_provider_accounts account
      on account.id = evidence.provider_account_id
    where account.source_account_key = 'account-wide-history-fixture'
      and evidence.source_machine_id is null
      and evidence.business_coverage_status = 'unverified'
  ),
  2,
  'account-wide order and payment receipts remain explicitly business-unverified'
);

select is(
  (
    select count(*)::integer
    from private.snapcase_source_machines machine
    join private.snapcase_provider_accounts account
      on account.id = machine.provider_account_id
    where account.source_account_key = 'account-wide-history-fixture'
  ),
  0,
  'an account-wide empty receipt does not fabricate a machine shell'
);

select throws_ok(
  $$select public.service_ingest_snapcase_observations(
    jsonb_set(pg_temp.account_scope_payload(), '{evidence,0,sourceMachineId}', '42'::jsonb)
      || jsonb_build_object('batchKey', repeat('4', 64), 'batchDigest', repeat('5', 64))
  )$$,
  'P0001',
  'Invalid SnapCase extraction evidence',
  'non-string and non-null evidence scope is rejected'
);

select * from finish();
rollback;
