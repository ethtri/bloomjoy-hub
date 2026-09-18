begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(58);

select has_table('public', 'refund_sunze_cash_correlation_attempts', 'Correlation attempts are durable');
select has_table('public', 'refund_sunze_cash_correlation_candidates', 'Candidate evidence is durable');
select has_table('public', 'refund_sunze_cash_sale_links', 'Selected-sale evidence is durable');
select ok(
  has_function_privilege('service_role', 'public.service_correlate_sunze_cash_case(uuid,bigint,text,uuid,timestamptz)', 'execute')
  and not has_function_privilege('anon', 'public.service_correlate_sunze_cash_case(uuid,bigint,text,uuid,timestamptz)', 'execute')
  and not has_function_privilege('authenticated', 'public.service_correlate_sunze_cash_case(uuid,bigint,text,uuid,timestamptz)', 'execute'),
  'Correlation is service-only'
);

insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data)
values
  ('35260000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'manager@example.test', '{}'::jsonb, '{}'::jsonb),
  ('35260000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'manager-two@example.test', '{}'::jsonb, '{}'::jsonb);
select ok(
  not has_table_privilege('anon', 'public.refund_sunze_cash_correlation_candidates', 'select')
  and not has_table_privilege('authenticated', 'public.refund_sunze_cash_correlation_candidates', 'select')
  and has_table_privilege('service_role', 'public.refund_sunze_cash_correlation_candidates', 'select'),
  'Candidate rows are service-only'
);

insert into public.customer_accounts (id, name, account_type, status)
values ('35200000-0000-4000-8000-000000000001', 'Sunze correlation fixtures', 'internal', 'active');

insert into public.reporting_locations (id, account_id, name, timezone, status)
values ('35210000-0000-4000-8000-000000000001', '35200000-0000-4000-8000-000000000001', 'Synthetic correlation location', 'America/Los_Angeles', 'active');

insert into public.reporting_machines (
  id, account_id, location_id, machine_label, machine_type, sunze_machine_id,
  status, refund_intake_enabled
)
values
  ('35220000-0000-4000-8000-000000000001', '35200000-0000-4000-8000-000000000001', '35210000-0000-4000-8000-000000000001', 'Multi fixture', 'commercial', 'SUNZE-CORR-1', 'active', true),
  ('35220000-0000-4000-8000-000000000002', '35200000-0000-4000-8000-000000000001', '35210000-0000-4000-8000-000000000001', 'Single fixture', 'commercial', 'SUNZE-CORR-2', 'active', true),
  ('35220000-0000-4000-8000-000000000003', '35200000-0000-4000-8000-000000000001', '35210000-0000-4000-8000-000000000001', 'Freshness fixture', 'commercial', 'SUNZE-CORR-3', 'active', true);

insert into public.reporting_machine_refund_managers (
  reporting_machine_id, manager_user_id, manager_email, status, grant_reason
)
values (
  '35220000-0000-4000-8000-000000000002', '35260000-0000-4000-8000-000000000001',
  'manager@example.test', 'active', 'Synthetic correlation test'
), (
  '35220000-0000-4000-8000-000000000001', '35260000-0000-4000-8000-000000000001',
  'manager@example.test', 'active', 'Synthetic correlation test'
), (
  '35220000-0000-4000-8000-000000000001', '35260000-0000-4000-8000-000000000002',
  'manager-two@example.test', 'active', 'Synthetic concurrency test'
), (
  '35220000-0000-4000-8000-000000000003', '35260000-0000-4000-8000-000000000001',
  'manager@example.test', 'active', 'Synthetic freshness-read test'
);

insert into public.sales_import_runs (
  id, source, status, rows_seen, rows_imported, meta, completed_at
)
values (
  '35230000-0000-4000-8000-000000000001', 'sunze_browser', 'completed', 5, 5,
  '{"payment_time_semantics_status":"validated","payment_time_timezone":"America/Los_Angeles","timestamp_proof_scope":"account","machine_coverage_verified":true,"visible_machine_count_mismatch":false}'::jsonb,
  '2026-09-14 20:00:00+00'
), (
  '35230000-0000-4000-8000-000000000002', 'sunze_browser', 'completed', 0, 0,
  '{"payment_time_semantics_status":"validated","payment_time_timezone":"America/Los_Angeles","timestamp_proof_scope":"account","machine_coverage_verified":true,"visible_machine_count_mismatch":false}'::jsonb,
  '2026-09-15 20:00:00+00'
);

insert into public.sunze_cash_source_watermarks (
  reporting_machine_id, coverage_started_at, covered_through,
  last_successful_import_at, freshness_expires_at, payment_time_basis,
  payment_time_timezone, timestamp_proof_scope, import_run_id
)
values
  ('35220000-0000-4000-8000-000000000001', '2026-09-14 16:00:00+00', '2026-09-14 22:00:00+00', '2026-09-14 20:00:00+00', '2026-09-16 20:00:00+00', 'validated_iana_timezone', 'America/Los_Angeles', 'account', '35230000-0000-4000-8000-000000000001'),
  ('35220000-0000-4000-8000-000000000002', '2026-09-14 16:00:00+00', '2026-09-14 22:00:00+00', '2026-09-14 20:00:00+00', '2026-09-16 20:00:00+00', 'validated_iana_timezone', 'America/Los_Angeles', 'account', '35230000-0000-4000-8000-000000000001'),
  ('35220000-0000-4000-8000-000000000003', '2026-09-14 16:00:00+00', '2026-09-14 22:00:00+00', '2026-09-14 20:00:00+00', '2026-09-16 20:00:00+00', 'validated_iana_timezone', 'America/Los_Angeles', 'account', '35230000-0000-4000-8000-000000000001'),
  ('35220000-0000-4000-8000-000000000001', '2026-09-15 16:00:00+00', '2026-09-15 22:00:00+00', '2026-09-15 20:00:00+00', '2026-09-17 20:00:00+00', 'validated_iana_timezone', 'America/Los_Angeles', 'account', '35230000-0000-4000-8000-000000000002'),
  ('35220000-0000-4000-8000-000000000002', '2026-09-15 16:00:00+00', '2026-09-15 22:00:00+00', '2026-09-15 20:00:00+00', '2026-09-17 20:00:00+00', 'validated_iana_timezone', 'America/Los_Angeles', 'account', '35230000-0000-4000-8000-000000000002');

insert into public.machine_sales_facts (
  id, reporting_machine_id, reporting_location_id, sale_date, payment_method,
  net_sales_cents, transaction_count, source, source_row_hash, source_order_hash,
  import_run_id, payment_time, source_payment_status, raw_payload
)
values
  ('35240000-0000-4000-8000-000000000001', '35220000-0000-4000-8000-000000000001', '35210000-0000-4000-8000-000000000001', '2026-09-14', 'cash', 700, 1, 'sunze_browser', 'sunze-correlation-row-1', 'sunze-correlation-order-1', '35230000-0000-4000-8000-000000000001', '2026-09-14 19:04:00+00', 'Payment success', '{}'::jsonb),
  ('35240000-0000-4000-8000-000000000002', '35220000-0000-4000-8000-000000000001', '35210000-0000-4000-8000-000000000001', '2026-09-14', 'cash', 1000, 1, 'sunze_browser', 'sunze-correlation-row-2', 'sunze-correlation-order-2', '35230000-0000-4000-8000-000000000001', '2026-09-14 19:20:00+00', 'Payment success', '{}'::jsonb),
  ('35240000-0000-4000-8000-000000000003', '35220000-0000-4000-8000-000000000001', '35210000-0000-4000-8000-000000000001', '2026-09-14', 'cash', 1200, 1, 'sunze_browser', 'sunze-correlation-row-3', 'sunze-correlation-order-3', '35230000-0000-4000-8000-000000000001', '2026-09-14 19:25:00+00', 'Payment success', '{}'::jsonb),
  ('35240000-0000-4000-8000-000000000004', '35220000-0000-4000-8000-000000000002', '35210000-0000-4000-8000-000000000001', '2026-09-14', 'cash', 800, 1, 'sunze_browser', 'sunze-correlation-row-4', 'sunze-correlation-order-4', '35230000-0000-4000-8000-000000000001', '2026-09-14 19:05:00+00', 'Payment success', '{}'::jsonb),
  ('35240000-0000-4000-8000-000000000005', '35220000-0000-4000-8000-000000000001', '35210000-0000-4000-8000-000000000001', '2026-09-14', 'cash', 1000, 1, 'sunze_browser', 'sunze-correlation-row-5', 'sunze-correlation-order-5', '35230000-0000-4000-8000-000000000001', '2026-09-14 19:01:00+00', 'Payment failed', '{}'::jsonb);

insert into public.refund_cases (
  id, public_reference, reporting_machine_id, reporting_location_id, customer_email,
  zelle_payment_contact, issue_summary, incident_at, payment_method,
  payment_amount_cents, status, correlation_status
)
values
  ('35250000-0000-4000-8000-000000000001', 'RF-SUNZE-CORR-1', '35220000-0000-4000-8000-000000000001', '35210000-0000-4000-8000-000000000001', 'multi@example.test', 'multi@example.test', 'Multiple evidence fixture', '2026-09-14 19:00:00+00', 'cash', 1000, 'needs_review', 'manual_review'),
  ('35250000-0000-4000-8000-000000000002', 'RF-SUNZE-CORR-2', '35220000-0000-4000-8000-000000000002', '35210000-0000-4000-8000-000000000001', 'single@example.test', 'single@example.test', 'Single evidence fixture', '2026-09-14 19:00:00+00', 'cash', 800, 'needs_review', 'manual_review'),
  ('35250000-0000-4000-8000-000000000003', 'RF-SUNZE-CORR-3', '35220000-0000-4000-8000-000000000002', '35210000-0000-4000-8000-000000000001', 'conflict@example.test', 'conflict@example.test', 'Conflict evidence fixture', '2026-09-14 19:00:00+00', 'cash', 999, 'needs_review', 'manual_review'),
  ('35250000-0000-4000-8000-000000000004', 'RF-SUNZE-CORR-4', '35220000-0000-4000-8000-000000000003', '35210000-0000-4000-8000-000000000001', 'freshness@example.test', 'freshness@example.test', 'Freshness phase fixture', '2026-09-14 21:30:00+00', 'cash', 500, 'needs_review', 'manual_review'),
  ('35250000-0000-4000-8000-000000000005', 'RF-SUNZE-CORR-5', '35220000-0000-4000-8000-000000000001', '35210000-0000-4000-8000-000000000001', 'snapshot@example.test', 'snapshot@example.test', 'Snapshot attribution fixture', '2026-09-14 19:00:00+00', 'cash', 800, 'needs_review', 'manual_review'),
  ('35250000-0000-4000-8000-000000000006', 'RF-SUNZE-CORR-6', '35220000-0000-4000-8000-000000000001', '35210000-0000-4000-8000-000000000001', 'pending@example.test', 'pending@example.test', 'Deferred intake fixture', '2026-09-14 19:00:00+00', 'cash', 800, 'needs_review', 'manual_review'),
  ('35250000-0000-4000-8000-000000000007', 'RF-SUNZE-CORR-7', '35220000-0000-4000-8000-000000000001', '35210000-0000-4000-8000-000000000001', 'legacy-completed@example.test', 'legacy-completed@example.test', 'Legacy completed selection fixture', '2026-09-14 19:00:00+00', 'cash', 1000, 'needs_review', 'manual_review'),
  ('35250000-0000-4000-8000-000000000008', 'RF-SUNZE-CORR-8', '35220000-0000-4000-8000-000000000002', '35210000-0000-4000-8000-000000000001', 'zero-candidate@example.test', 'zero-candidate@example.test', 'Internal zero-candidate fixture', '2026-09-14 21:00:00+00', 'cash', 800, 'needs_review', 'manual_review');

update public.refund_cases
set matched_sales_fact_id = '35240000-0000-4000-8000-000000000002'
where id = '35250000-0000-4000-8000-000000000007';
set local session_replication_role = replica;
update public.refund_cases
set refund_completed_at = '2026-09-14 20:30:00+00'
where id = '35250000-0000-4000-8000-000000000007';
set local session_replication_role = origin;

update public.refund_cases
set cash_match_state = 'checking_sales_history'
where id = '35250000-0000-4000-8000-000000000006';
select is(
  public.service_get_sunze_cash_correlation('35250000-0000-4000-8000-000000000006', '35260000-0000-4000-8000-000000000001', 100)->>'state',
  'checking_sales_history',
  'No-attempt manager reads retain the truthful persisted checking state'
);
select is(
  jsonb_array_length(public.service_get_sunze_cash_correlation('35250000-0000-4000-8000-000000000006', '35260000-0000-4000-8000-000000000001', 100)->'candidates'),
  0,
  'No-attempt manager reads return bounded empty evidence without guessing'
);
select is(
  public.service_get_sunze_cash_correlation('35250000-0000-4000-8000-000000000006', '35260000-0000-4000-8000-000000000001', 100)->>'sourceReadiness',
  'correlation_pending',
  'No-attempt reads explain that internal correlation remains pending'
);

select is(
  public.service_correlate_sunze_cash_case('35250000-0000-4000-8000-000000000005', 1, 'completed_import', '35230000-0000-4000-8000-000000000002', '2026-09-15 21:00:00+00')->>'state',
  'multiple_possible_sales',
  'A newer non-covering trigger import does not hide the older covering snapshot'
);
select results_eq(
  $$select source_import_run_id, trigger_import_run_id from public.refund_sunze_cash_correlation_attempts where refund_case_id='35250000-0000-4000-8000-000000000005'$$,
  $$values ('35230000-0000-4000-8000-000000000001'::uuid, '35230000-0000-4000-8000-000000000002'::uuid)$$,
  'Attempt provenance separates evaluated coverage from the triggering import'
);

select is(
  public.service_correlate_sunze_cash_case('35250000-0000-4000-8000-000000000004', 1, 'intake', null, '2026-09-14 21:00:00+00')->>'state',
  'checking_sales_history',
  'Incomplete but fresh coverage remains checking'
);
select is(
  public.service_get_sunze_cash_correlation('35250000-0000-4000-8000-000000000004', '35260000-0000-4000-8000-000000000001', 100)->>'sourceReadiness',
  'awaiting_coverage',
  'Safe reads explain fresh but incomplete internal coverage'
);
select ok(
  (public.service_get_sunze_cash_correlation('35250000-0000-4000-8000-000000000004', '35260000-0000-4000-8000-000000000001', 100)->>'coveredThrough')::timestamptz is not null
  and (public.service_get_sunze_cash_correlation('35250000-0000-4000-8000-000000000004', '35260000-0000-4000-8000-000000000001', 100)->>'freshnessExpiresAt')::timestamptz is not null,
  'Safe reads expose bounded coverage and freshness timestamps without vendor rows'
);
select is(
  public.service_correlate_sunze_cash_case('35250000-0000-4000-8000-000000000004', 1, 'backfill', null, '2026-09-17 21:00:00+00')->>'state',
  'sales_history_unavailable',
  'The same watermark transitions truthfully after freshness expires'
);
select is(
  public.service_get_sunze_cash_correlation('35250000-0000-4000-8000-000000000004', '35260000-0000-4000-8000-000000000001', 100)->>'sourceReadiness',
  'stale',
  'Safe reads distinguish stale internal history from incomplete coverage'
);

-- Later correction-trigger checks use statement_timestamp(). Keep their
-- machine's fixture fresh when this suite runs after the fixed September dates.
update public.sunze_cash_source_watermarks
set freshness_expires_at = '2099-01-01 00:00:00+00'
where reporting_machine_id = '35220000-0000-4000-8000-000000000002'
  and import_run_id = '35230000-0000-4000-8000-000000000001';

select is(
  public.service_correlate_sunze_cash_case('35250000-0000-4000-8000-000000000001', 1, 'intake', null, '2026-09-14 21:00:00+00')->>'state',
  'multiple_possible_sales',
  'Every plausible candidate remains advisory evidence'
);
select is((select count(*)::integer from public.refund_sunze_cash_correlation_candidates c join public.refund_sunze_cash_correlation_attempts a on a.id=c.attempt_id where a.refund_case_id='35250000-0000-4000-8000-000000000001'), 3, 'All plausible candidates are retained');
select is((select sales_fact_id from public.refund_sunze_cash_correlation_candidates c join public.refund_sunze_cash_correlation_attempts a on a.id=c.attempt_id where a.refund_case_id='35250000-0000-4000-8000-000000000001' and c.deterministic_rank=1), '35240000-0000-4000-8000-000000000002'::uuid, 'Ranking is deterministic and amount remains advisory evidence');
select is((select selection_conflict from public.refund_sunze_cash_correlation_candidates c join public.refund_sunze_cash_correlation_attempts a on a.id=c.attempt_id where a.refund_case_id='35250000-0000-4000-8000-000000000001' and c.sales_fact_id='35240000-0000-4000-8000-000000000002'), true, 'Legacy completed-case use is visible as a candidate conflict');
select is(
  public.service_get_sunze_cash_correlation('35250000-0000-4000-8000-000000000001', '35260000-0000-4000-8000-000000000001', 100)->>'returnedCandidateCount',
  '3',
  'Manager read contract returns bounded safe current candidates'
);
select is(
  public.service_select_sunze_cash_candidate(
    '35250000-0000-4000-8000-000000000001',
    (select id from public.refund_sunze_cash_correlation_attempts where refund_case_id='35250000-0000-4000-8000-000000000001'),
    '35240000-0000-4000-8000-000000000001', 1, 0,
    '35260000-0000-4000-8000-000000000001'
  )->>'selected',
  'true',
  'Manager may deliberately select a lower-ranked current candidate'
);
select is((select matched_sales_fact_id from public.refund_cases where id='35250000-0000-4000-8000-000000000001'), '35240000-0000-4000-8000-000000000001'::uuid, 'Reviewed selection persists without deciding or completing the case');
select is(
  public.service_select_sunze_cash_candidate(
    '35250000-0000-4000-8000-000000000001',
    (select id from public.refund_sunze_cash_correlation_attempts where refund_case_id='35250000-0000-4000-8000-000000000001'),
    '35240000-0000-4000-8000-000000000001', 1, 0,
    '35260000-0000-4000-8000-000000000001'
  )->>'replayed',
  'true',
  'A lost initial selection response replays with the original generation token'
);
select is(
  public.service_select_sunze_cash_candidate(
    '35250000-0000-4000-8000-000000000001',
    (select id from public.refund_sunze_cash_correlation_attempts where refund_case_id='35250000-0000-4000-8000-000000000001'),
    '35240000-0000-4000-8000-000000000001', 1, 1,
    '35260000-0000-4000-8000-000000000001'
  )->>'replayed',
  'true',
  'Identical reviewed selection replays without another audit event'
);
select is(
  public.service_select_sunze_cash_candidate(
    '35250000-0000-4000-8000-000000000001',
    (select id from public.refund_sunze_cash_correlation_attempts where refund_case_id='35250000-0000-4000-8000-000000000001'),
    '35240000-0000-4000-8000-000000000003', 1, 1,
    '35260000-0000-4000-8000-000000000002'
  )->>'linkVersion',
  '2',
  'A second manager replacement advances the active selection generation'
);
select is(
  public.service_select_sunze_cash_candidate(
    '35250000-0000-4000-8000-000000000001',
    (select id from public.refund_sunze_cash_correlation_attempts where refund_case_id='35250000-0000-4000-8000-000000000001'),
    '35240000-0000-4000-8000-000000000003', 1, 1,
    '35260000-0000-4000-8000-000000000002'
  )->>'replayed',
  'true',
  'A lost replacement response replays only for the original actor and generation'
);
select throws_ok(
  $$select public.service_select_sunze_cash_candidate(
    '35250000-0000-4000-8000-000000000001',
    (select id from public.refund_sunze_cash_correlation_attempts where refund_case_id='35250000-0000-4000-8000-000000000001'),
    '35240000-0000-4000-8000-000000000003', null::bigint, 2,
    '35260000-0000-4000-8000-000000000002')$$,
  '40001', 'Stale Sunze candidate selection',
  'Candidate selection rejects a NULL fact-version token explicitly'
);
select throws_ok(
  $$select public.service_select_sunze_cash_candidate(
    '35250000-0000-4000-8000-000000000001',
    (select id from public.refund_sunze_cash_correlation_attempts where refund_case_id='35250000-0000-4000-8000-000000000001'),
    '35240000-0000-4000-8000-000000000003', 1, null::bigint,
    '35260000-0000-4000-8000-000000000002')$$,
  '40001', 'Stale Sunze link version',
  'Candidate selection rejects a NULL link-generation token explicitly'
);
select throws_ok(
  $$select public.service_select_sunze_cash_candidate(
    '35250000-0000-4000-8000-000000000001',
    (select id from public.refund_sunze_cash_correlation_attempts where refund_case_id='35250000-0000-4000-8000-000000000001'),
    '35240000-0000-4000-8000-000000000002', 1, 2,
    '35260000-0000-4000-8000-000000000001')$$,
  '23505', 'Sunze sale is already selected for another case',
  'Reviewed selection rejects a sale already used by a legacy completed case'
);
select throws_ok(
  $$select public.service_select_sunze_cash_candidate(
    '35250000-0000-4000-8000-000000000001',
    (select id from public.refund_sunze_cash_correlation_attempts where refund_case_id='35250000-0000-4000-8000-000000000001'),
    '35240000-0000-4000-8000-000000000002', 1, 1,
    '35260000-0000-4000-8000-000000000001')$$,
  '40001', 'Stale Sunze link version',
  'A stale concurrent manager cannot replace a newer reviewed selection'
);

select is(
  public.service_correlate_sunze_cash_case('35250000-0000-4000-8000-000000000001', 1, 'intake', null, '2026-09-14 21:00:00+00')->>'replayed',
  'true',
  'A replay returns the original durable attempt'
);
select is((select count(*)::integer from public.refund_sunze_cash_correlation_attempts where refund_case_id='35250000-0000-4000-8000-000000000001'), 1, 'Replay creates no duplicate attempt');

select throws_ok(
  $$select public.service_correlate_sunze_cash_case('35250000-0000-4000-8000-000000000001', 0, 'intake', null, '2026-09-14 21:00:00+00')$$,
  '40001', 'Stale Sunze correlation worker', 'Stale worker versions are rejected'
);

select is(
  public.service_correlate_sunze_cash_case('35250000-0000-4000-8000-000000000002', 1, 'intake', null, '2026-09-14 21:00:00+00')->>'state',
  'sale_found',
  'A sole candidate is explainable evidence, not an outcome gate'
);
select is((select matched_sales_fact_id from public.refund_cases where id='35250000-0000-4000-8000-000000000002'), '35240000-0000-4000-8000-000000000004'::uuid, 'Sole candidate is linked for manager review');
select is(
  public.service_correlate_sunze_cash_case('35250000-0000-4000-8000-000000000003', 1, 'intake', null, '2026-09-14 21:00:00+00')->>'reason',
  'selected_sale_conflict',
  'Concurrent selected-sale reuse becomes reviewable conflict evidence'
);
select is((select matched_sales_fact_id from public.refund_cases where id='35250000-0000-4000-8000-000000000003'), null::uuid, 'A conflicted sale is not selected twice');

select is(
  public.service_correlate_sunze_cash_case('35250000-0000-4000-8000-000000000008', 1, 'intake', null, '2026-09-14 21:00:00+00')->>'state',
  'no_sale_found_with_complete_coverage',
  'Complete internal coverage may retain zero-candidate evidence'
);
select is((select correlation_status from public.refund_cases where id='35250000-0000-4000-8000-000000000008'), 'manual_review', 'Internal zero-candidate evidence cannot activate customer no-match outreach');

select lives_ok(
  $$update public.refund_cases set incident_at='2026-09-14 17:00:00+00' where id='35250000-0000-4000-8000-000000000002'$$,
  'Corrected facts invoke the shared correlation contract'
);
select is((select deterministic_fact_version from public.refund_cases where id='35250000-0000-4000-8000-000000000002'), 2::bigint, 'Corrected facts advance the protected version');
select is((select max(case_fact_version) from public.refund_sunze_cash_correlation_attempts where refund_case_id='35250000-0000-4000-8000-000000000002'), 2::bigint, 'Corrected facts are re-evaluated');
select is((select matched_sales_fact_id from public.refund_cases where id='35250000-0000-4000-8000-000000000002'), '35240000-0000-4000-8000-000000000004'::uuid, 'Corrected facts preserve an unreleased selected link as visible evidence');
select is((select reason_code from public.refund_sunze_cash_correlation_attempts where refund_case_id='35250000-0000-4000-8000-000000000002' and case_fact_version=2), 'selected_sale_conflict', 'Corrected facts mark an old selection for guarded reconciliation');

select is(public.service_sunze_cash_correlation_backfill(true, 100, '2026-09-14 21:00:00+00')->>'evaluated', '0', 'Dry-run backfill reports without mutating');

select throws_ok(
  $$select public.service_release_sunze_cash_sale_link(
    '35250000-0000-4000-8000-000000000002', null::bigint, 1,
    '35260000-0000-4000-8000-000000000001', 'wrong_sale', 'synthetic test')$$,
  '40001', 'Stale Sunze reconciliation worker',
  'Release rejects a NULL fact-version token explicitly'
);
select throws_ok(
  $$select public.service_release_sunze_cash_sale_link(
    '35250000-0000-4000-8000-000000000002', 2, null::bigint,
    '35260000-0000-4000-8000-000000000001', 'wrong_sale', 'synthetic test')$$,
  '40001', 'Stale Sunze link version',
  'Release rejects a NULL link-generation token explicitly'
);

select is(
  public.service_release_sunze_cash_sale_link(
    '35250000-0000-4000-8000-000000000002', 2, 1,
    '35260000-0000-4000-8000-000000000001', 'wrong_sale', 'synthetic test'
  )->>'released',
  'true',
  'An authorized manager can release nonterminal selected-sale evidence'
);
select is(
  public.service_release_sunze_cash_sale_link(
    '35250000-0000-4000-8000-000000000002', 2, 1,
    '35260000-0000-4000-8000-000000000001', 'wrong_sale', 'synthetic test'
  )->>'replayed',
  'true',
  'A lost release response replays with the original actor and generation token'
);
select ok(
  (select released_by = '35260000-0000-4000-8000-000000000001'::uuid
      and released_case_fact_version = 2
    from public.refund_sunze_cash_sale_links
    where refund_case_id='35250000-0000-4000-8000-000000000002'),
  'Reconciliation retains the explicit validated audit actor and release-time fact version'
);
select ok(
  public.service_get_sunze_cash_correlation('35250000-0000-4000-8000-000000000002', '35260000-0000-4000-8000-000000000001', 100)->>'state' = 'checking_sales_history'
  and public.service_get_sunze_cash_correlation('35250000-0000-4000-8000-000000000002', '35260000-0000-4000-8000-000000000001', 100)->>'expectedLinkVersion' = '2',
  'A released selection invalidates the prior attempt and exposes its current history token'
);
select ok(
  public.service_correlate_sunze_cash_case('35250000-0000-4000-8000-000000000002', 2, 'backfill', null, '2026-09-14 21:00:00+00')->>'state' = 'checking_sales_history'
  and (select count(*) from public.refund_sunze_cash_sale_links where refund_case_id='35250000-0000-4000-8000-000000000002' and released_at is null) = 0,
  'Same-snapshot replay cannot silently restore released evidence'
);

update public.refund_cases
set incident_at = '2026-09-14 19:00:00+00'
where id = '35250000-0000-4000-8000-000000000002';
select ok(
  (select link_version = 3 from public.refund_sunze_cash_sale_links where refund_case_id='35250000-0000-4000-8000-000000000002' and released_at is null)
  and public.service_get_sunze_cash_correlation('35250000-0000-4000-8000-000000000002', '35260000-0000-4000-8000-000000000001', 100)->>'expectedLinkVersion' = '3',
  'A new fact snapshot reselects evidence with a monotonic case-history generation'
);

set local session_replication_role = replica;
update public.refund_cases set refund_completed_at='2026-09-14 22:00:00+00' where id='35250000-0000-4000-8000-000000000002';
set local session_replication_role = origin;
select throws_ok(
  $$select public.service_release_sunze_cash_sale_link('35250000-0000-4000-8000-000000000002', 3, 3, '35260000-0000-4000-8000-000000000001', 'wrong_sale', 'synthetic test')$$,
  'P0001', 'Completed or official refund evidence cannot be released', 'Completed evidence cannot be released'
);

select is(
  public.service_correlate_sunze_cash_import('35230000-0000-4000-8000-000000000001', 500, '2026-09-14 21:00:00+00')->>'evaluated',
  '1',
  'Completed imports evaluate only active relevant cases missing the current source snapshot'
);
select is(
  public.service_correlate_sunze_cash_import('35230000-0000-4000-8000-000000000001', 500, '2026-09-14 21:00:00+00')->>'evaluated',
  '0',
  'Repeated completed-import hooks do not reselect processed cases or block bounded pagination'
);

insert into public.refund_cases (
  id, public_reference, reporting_machine_id, reporting_location_id, customer_email,
  issue_summary, incident_at, payment_method, payment_amount_cents, status, correlation_status
)
select
  md5('sunze-correlation-bulk-' || fixture)::uuid,
  'RF-SUNZE-BULK-' || fixture,
  '35220000-0000-4000-8000-000000000003',
  '35210000-0000-4000-8000-000000000001',
  'bulk-' || fixture || '@example.test',
  'Bounded import continuation fixture',
  '2026-09-14 19:00:00+00', 'cash', 500, 'needs_review', 'manual_review'
from generate_series(1, 501) fixture;

create temporary table sunze_bulk_first as
select public.service_correlate_sunze_cash_import(
  '35230000-0000-4000-8000-000000000001', 500, '2026-09-14 21:00:00+00'
) as result;
create temporary table sunze_bulk_second as
select public.service_correlate_sunze_cash_import(
  '35230000-0000-4000-8000-000000000001', 500, '2026-09-14 21:00:00+00'
) as result;
select ok(
  (select result->>'evaluated' from sunze_bulk_first) = '500'
  and (select result->>'remaining' from sunze_bulk_first) = '1'
  and (select result->>'hasMore' from sunze_bulk_first) = 'true'
  and (select result->>'evaluated' from sunze_bulk_second) = '1'
  and (select result->>'remaining' from sunze_bulk_second) = '0',
  'Completed-import batches report exact bounded continuation and drain the final snapshot'
);

select ok(
  (public.service_sunze_cash_correlation_metrics('2026-09-14 00:00:00+00')->>'attemptCount')::integer >= 3
  and not (public.service_sunze_cash_correlation_metrics('2026-09-14 00:00:00+00') ? 'refundCaseId'),
  'Metrics are aggregate and privacy-safe'
);

select * from finish();
rollback;
