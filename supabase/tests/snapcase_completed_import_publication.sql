begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

insert into public.customer_accounts(id, name, account_type, status)
values ('15010000-0000-4000-8000-000000000001', 'SnapCase completion fixture', 'internal', 'active');
insert into public.reporting_locations(id, account_id, name, timezone, status)
values ('15011000-0000-4000-8000-000000000001', '15010000-0000-4000-8000-000000000001', 'Completion location', 'America/Los_Angeles', 'active');
insert into public.reporting_machines(id, account_id, location_id, machine_label, machine_type, status)
values ('15012000-0000-4000-8000-000000000001', '15010000-0000-4000-8000-000000000001', '15011000-0000-4000-8000-000000000001', 'Completion SnapCase', 'snapcase', 'active');
insert into public.reporting_machine_tax_rates(id, machine_id, tax_rate_percent, effective_start_date, status)
values ('15012500-0000-4000-8000-000000000001', '15012000-0000-4000-8000-000000000001', 0, '2025-01-01', 'active');

insert into private.snapcase_provider_accounts(id, source_account_key)
values ('15013000-0000-4000-8000-000000000001', 'completion-fixture');

create function pg_temp.add_batch(
  p_id uuid, p_run text, p_batch text, p_payment_count integer, p_evidence_count integer
) returns void language sql as $$
  insert into private.snapcase_ingest_batches(
    id, provider_account_id, contract_version, run_key, batch_key, batch_digest,
    request_fingerprint, machine_count, order_count, payment_count, evidence_count
  ) values (
    p_id, '15013000-0000-4000-8000-000000000001', 'snapcase.ingest.v1',
    p_run, p_batch, encode(extensions.digest(convert_to(p_batch, 'UTF8'), 'sha256'), 'hex'),
    encode(extensions.digest(convert_to(p_batch || '-request', 'UTF8'), 'sha256'), 'hex'),
    0, 0, p_payment_count, p_evidence_count
  );
$$;

select pg_temp.add_batch('15014000-0000-4000-8000-000000000001', repeat('1',64), repeat('a',64), 1, 0);
select pg_temp.add_batch('15014000-0000-4000-8000-000000000002', repeat('1',64), repeat('b',64), 0, 1);

insert into private.snapcase_source_machines(
  provider_account_id, source_machine_id, source_timezone, source_currency,
  revision_digest, revision_number, first_seen_batch_id, last_seen_batch_id
) values (
  '15013000-0000-4000-8000-000000000001', 'completion-machine',
  'America/Los_Angeles', 'USD', repeat('c',64), 1,
  '15014000-0000-4000-8000-000000000001', '15014000-0000-4000-8000-000000000001'
);
insert into private.snapcase_machine_mappings(
  id, provider_account_id, source_machine_id, reporting_machine_id,
  effective_start_date, mapping_reason
) values (
  '15015000-0000-4000-8000-000000000001',
  '15013000-0000-4000-8000-000000000001', 'completion-machine',
  '15012000-0000-4000-8000-000000000001', '2025-01-01', 'Completion fixture'
);

insert into private.snapcase_sales_observations(
  id, provider_account_id, resource, source_key, source_key_version,
  source_machine_id, source_status, source_tender_code, source_tender_label,
  normalized_tender, occurred_time_raw, occurred_at, source_currency,
  currency_code, source_amount_text, amount_minor, exception_codes,
  revision_digest, first_seen_batch_id, last_seen_batch_id
) values (
  '15016000-0000-4000-8000-000000000001',
  '15013000-0000-4000-8000-000000000001', 'payment', repeat('d',64), 1,
  'completion-machine', 'success', '1', 'cash', 'cash',
  '2026-09-20 12:00:00', '2026-09-20T19:00:00Z', 'USD', 'USD',
  '10.00', 1000, array['financial_status_semantics_unverified'], repeat('e',64),
  '15014000-0000-4000-8000-000000000001', '15014000-0000-4000-8000-000000000001'
);

insert into private.snapcase_extraction_evidence(
  provider_account_id, ingest_batch_id, resource, source_machine_id,
  requested_start, requested_end, requested_timezone, extraction_status,
  page_count, next_cursor_present, response_truncated, observed_count,
  expected_total, effective_page_size, rejected_count,
  business_coverage_status, coverage_reason_code
) values (
  '15013000-0000-4000-8000-000000000001', '15014000-0000-4000-8000-000000000002',
  'payments', 'completion-machine', '2026-09-20T07:00:00Z', '2026-09-21T07:00:00Z',
  'America/Los_Angeles', 'complete', 1, false, false, 1, 1, 50, 0,
  'unverified', 'source_time_semantics_unverified'
);

select set_config('request.jwt.claim.role', 'authenticated', true);
select throws_ok(
  $$select public.service_finalize_snapcase_import_run('completion-fixture', repeat('1',64))$$,
  'P0001', 'Service role required',
  'clients cannot finalize SnapCase imports'
);
select set_config('request.jwt.claim.role', 'service_role', true);

create temporary table first_finalize as
select public.service_finalize_snapcase_import_run('completion-fixture', repeat('1',64)) result;
select is((select result ->> 'completedWindowCount' from first_finalize), '1',
  'one acknowledged payment window completes');
select is((select result ->> 'publishedCashFactCount' from first_finalize), '1',
  'the completed window publishes its normalized cash fact');
select is((select count(*)::integer from private.snapcase_observation_ingest_memberships), 1,
  'the completion is bound to the exact observation revision delivered by the run');
select is((select count(*)::integer from private.snapcase_completed_import_windows), 1,
  'one durable machine-local completed window is recorded');
select is((select net_sales_cents from public.machine_sales_facts where source='snapcase_cash'), 1000,
  'cash uses the exact provider payment amount once');
select ok((select financial_ready from private.snapcase_financial_window_revisions
  where source_machine_id='completion-machine'),
  'the exact window records successful canonical cash publication');
select is(
  public.service_finalize_snapcase_import_run('completion-fixture', repeat('1',64)) ->> 'changedWindowCount',
  '0', 'an identical run replay is idempotent'
);
select is((select count(*)::integer from public.machine_sales_facts where source='snapcase_cash'), 1,
  'replay does not duplicate cash facts');

-- A new staged revision invalidates old completion until that exact run has its
-- own complete pagination receipt.
select pg_temp.add_batch('15014000-0000-4000-8000-000000000003', repeat('2',64), repeat('f',64), 1, 0);
update private.snapcase_sales_observations
set source_amount_text='12.00', amount_minor=1200, revision_digest=repeat('f',64),
    last_seen_batch_id='15014000-0000-4000-8000-000000000003'
where id='15016000-0000-4000-8000-000000000001';
select is((select count(*)::integer from private.snapcase_completed_import_windows), 0,
  'a late payment revision removes stale completion immediately');
select is(
  public.service_finalize_snapcase_import_run('completion-fixture', repeat('1',64)) ->> 'completedWindowCount',
  '0', 'an older run cannot claim a newer mutable revision'
);
select pg_temp.add_batch('15014000-0000-4000-8000-000000000004', repeat('2',64), repeat('9',64), 0, 1);
insert into private.snapcase_extraction_evidence(
  provider_account_id, ingest_batch_id, resource, source_machine_id,
  requested_start, requested_end, requested_timezone, extraction_status,
  page_count, next_cursor_present, response_truncated, observed_count,
  expected_total, effective_page_size, rejected_count,
  business_coverage_status, coverage_reason_code
) values (
  '15013000-0000-4000-8000-000000000001', '15014000-0000-4000-8000-000000000004',
  'payments', 'completion-machine', '2026-09-20T07:00:00Z', '2026-09-21T07:00:00Z',
  'America/Los_Angeles', 'complete', 1, false, false, 1, 1, 50, 0,
  'unverified', 'source_time_semantics_unverified'
);
select is(
  public.service_finalize_snapcase_import_run('completion-fixture', repeat('2',64)) ->> 'completedWindowCount',
  '1', 'the newer exact run restores completion'
);
select is((select net_sales_cents from public.machine_sales_facts where source='snapcase_cash'), 1200,
  'the newer exact revision updates the same cash fact');

-- Unknown status can hide revenue; known pending is nonrevenue and does not
-- make an otherwise complete payment query fail.
select pg_temp.add_batch('15014000-0000-4000-8000-000000000005', repeat('3',64), repeat('3',64), 1, 0);
select pg_temp.add_batch('15014000-0000-4000-8000-000000000006', repeat('3',64), repeat('4',64), 0, 1);
insert into private.snapcase_sales_observations(
  id, provider_account_id, resource, source_key, source_key_version,
  source_machine_id, source_status, source_tender_code, source_tender_label,
  normalized_tender, occurred_time_raw, occurred_at, source_currency,
  currency_code, source_amount_text, amount_minor, exception_codes,
  revision_digest, first_seen_batch_id, last_seen_batch_id
) values (
  '15016000-0000-4000-8000-000000000002',
  '15013000-0000-4000-8000-000000000001', 'payment', repeat('1',64), 1,
  'completion-machine', 'mystery', '1', 'cash', 'cash',
  '2026-09-21 12:00:00', '2026-09-21T19:00:00Z', 'USD', 'USD',
  '5.00', 500, array['financial_status_semantics_unverified'], repeat('2',64),
  '15014000-0000-4000-8000-000000000005', '15014000-0000-4000-8000-000000000005'
);
insert into private.snapcase_extraction_evidence(
  provider_account_id, ingest_batch_id, resource, source_machine_id,
  requested_start, requested_end, requested_timezone, extraction_status,
  page_count, next_cursor_present, response_truncated, observed_count,
  expected_total, effective_page_size, rejected_count,
  business_coverage_status, coverage_reason_code
) values (
  '15013000-0000-4000-8000-000000000001', '15014000-0000-4000-8000-000000000006',
  'payments', 'completion-machine', '2026-09-21T07:00:00Z', '2026-09-22T07:00:00Z',
  'America/Los_Angeles', 'complete', 1, false, false, 1, 1, 50, 0,
  'unverified', 'source_time_semantics_unverified'
);
select is(
  public.service_finalize_snapcase_import_run('completion-fixture', repeat('3',64)) ->> 'completedWindowCount',
  '0', 'an unknown payment status cannot silently complete a money window'
);
select is((select count(*)::integer from private.snapcase_completed_import_windows
  where local_start_date='2026-09-21'), 0,
  'the unknown-status date has no completion record');

update private.snapcase_sales_observations
set source_status='pending', normalized_tender='unknown', source_tender_code=null,
    source_tender_label=null, source_amount_text=null, amount_minor=null,
    occurred_time_raw=null, occurred_at=null,
    exception_codes=array['amount_unit_unverified','currency_unverified',
      'financial_status_semantics_unverified','financial_tender_semantics_unverified',
      'source_time_semantics_unverified'], revision_digest=repeat('4',64)
where id='15016000-0000-4000-8000-000000000002';
-- Use a fresh exact run membership/evidence for the pending revision.
select pg_temp.add_batch('15014000-0000-4000-8000-000000000007', repeat('4',64), repeat('5',64), 1, 0);
update private.snapcase_sales_observations
set last_seen_batch_id='15014000-0000-4000-8000-000000000007'
where id='15016000-0000-4000-8000-000000000002';
select pg_temp.add_batch('15014000-0000-4000-8000-000000000008', repeat('4',64), repeat('6',64), 0, 1);
insert into private.snapcase_extraction_evidence(
  provider_account_id, ingest_batch_id, resource, source_machine_id,
  requested_start, requested_end, requested_timezone, extraction_status,
  page_count, next_cursor_present, response_truncated, observed_count,
  expected_total, effective_page_size, rejected_count,
  business_coverage_status, coverage_reason_code
) values (
  '15013000-0000-4000-8000-000000000001', '15014000-0000-4000-8000-000000000008',
  'payments', 'completion-machine', '2026-09-21T07:00:00Z', '2026-09-22T07:00:00Z',
  'America/Los_Angeles', 'complete', 1, false, false, 1, 1, 50, 0,
  'unverified', 'source_time_semantics_unverified'
);
select is(
  public.service_finalize_snapcase_import_run('completion-fixture', repeat('4',64)) ->> 'completedWindowCount',
  '1', 'known pending nonrevenue does not block a complete payment window'
);

-- A complete unmapped run is retained in staging and becomes publishable when
-- the normal mapping is saved; replay is unbounded and errors are not swallowed.
select pg_temp.add_batch('15014000-0000-4000-8000-000000000009', repeat('2',64), repeat('7',64), 1, 1);
insert into private.snapcase_source_machines(
  provider_account_id, source_machine_id, source_timezone, source_currency,
  revision_digest, revision_number, first_seen_batch_id, last_seen_batch_id
) values (
  '15013000-0000-4000-8000-000000000001', 'previously-unmapped',
  'America/Los_Angeles', 'USD', repeat('7',64), 1,
  '15014000-0000-4000-8000-000000000009', '15014000-0000-4000-8000-000000000009'
);
insert into private.snapcase_sales_observations(
  id, provider_account_id, resource, source_key, source_key_version,
  source_machine_id, source_status, source_tender_code, source_tender_label,
  normalized_tender, occurred_time_raw, occurred_at, source_currency,
  currency_code, source_amount_text, amount_minor, exception_codes,
  revision_digest, first_seen_batch_id, last_seen_batch_id
) values (
  '15016000-0000-4000-8000-000000000003',
  '15013000-0000-4000-8000-000000000001', 'payment', repeat('8',64), 1,
  'previously-unmapped', 'success', '1', 'cash', 'cash',
  '2026-09-22 12:00:00', '2026-09-22T19:00:00Z', 'USD', 'USD',
  '7.00', 700, array['financial_status_semantics_unverified'], repeat('9',64),
  '15014000-0000-4000-8000-000000000009', '15014000-0000-4000-8000-000000000009'
);
insert into private.snapcase_extraction_evidence(
  provider_account_id, ingest_batch_id, resource, source_machine_id,
  requested_start, requested_end, requested_timezone, extraction_status,
  page_count, next_cursor_present, response_truncated, observed_count,
  expected_total, effective_page_size, rejected_count,
  business_coverage_status, coverage_reason_code
) values (
  '15013000-0000-4000-8000-000000000001', '15014000-0000-4000-8000-000000000009',
  'payments', 'previously-unmapped', '2026-09-22T07:00:00Z', '2026-09-23T07:00:00Z',
  'America/Los_Angeles', 'complete', 1, false, false, 1, 1, 50, 0,
  'unverified', 'source_time_semantics_unverified'
);
select is(
  public.service_finalize_snapcase_import_run('completion-fixture', repeat('2',64)) ->> 'completedWindowCount',
  '0', 'unmapped cash is not called complete before canonical publication'
);
select pg_temp.add_batch('15014000-0000-4000-8000-000000000010', repeat('6',64), repeat('a',63) || '1', 1, 0);
update private.snapcase_sales_observations
set last_seen_batch_id='15014000-0000-4000-8000-000000000010'
where id='15016000-0000-4000-8000-000000000003';
select pg_temp.add_batch('15014000-0000-4000-8000-000000000011', repeat('6',64), repeat('a',63) || '2', 0, 1);
insert into private.snapcase_extraction_evidence(
  provider_account_id, ingest_batch_id, resource, source_machine_id,
  requested_start, requested_end, requested_timezone, extraction_status,
  page_count, next_cursor_present, response_truncated, observed_count,
  expected_total, effective_page_size, rejected_count,
  business_coverage_status, coverage_reason_code
) values (
  '15013000-0000-4000-8000-000000000001', '15014000-0000-4000-8000-000000000011',
  'payments', 'previously-unmapped', '2026-09-22T07:00:00Z', '2026-09-23T07:00:00Z',
  'America/Los_Angeles', 'complete', 1, false, false, 1, 1, 50, 0,
  'unverified', 'source_time_semantics_unverified'
);
insert into private.snapcase_machine_mappings(
  provider_account_id, source_machine_id, reporting_machine_id,
  effective_start_date, mapping_reason
) values (
  '15013000-0000-4000-8000-000000000001', 'previously-unmapped',
  '15012000-0000-4000-8000-000000000001', '2025-01-01', 'Replay fixture'
);
select is((select count(*)::integer from private.snapcase_completed_import_windows
  where source_machine_id='previously-unmapped'), 1,
  'saving the mapping replays the persisted completed run');
select is((select completed_ingest_batch_id from private.snapcase_completed_import_windows
  where source_machine_id='previously-unmapped'),
  '15014000-0000-4000-8000-000000000011'::uuid,
  'mapping replay leaves the newest duplicate completed-window receipt current');
select is((select completed_ingest_batch_id from private.snapcase_completed_import_windows
  where source_machine_id='completion-machine' and local_start_date='2026-09-20'),
  '15014000-0000-4000-8000-000000000004'::uuid,
  'mapping replay is scoped and does not re-finalize another machine from a shared run');
select is((select count(*)::integer from public.machine_sales_facts
  where source='snapcase_cash' and net_sales_cents=700), 1,
  'mapping replay publishes the previously unmapped cash exactly once');

select * from finish();
rollback;
