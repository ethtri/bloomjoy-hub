begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(17);

-- This fixture intentionally requires the independent completed-work producer.
-- It runs only after #1429 has landed in the normal migration order.
insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data)
values ('d8610000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
  'prepared-manager@example.invalid', '{}', '{}');
insert into public.customer_accounts (id, name, account_type)
values ('d8620000-0000-4000-8000-000000000001', 'Prepared next-work fixtures', 'internal');
insert into public.reporting_locations (id, account_id, name, timezone)
values ('d8630000-0000-4000-8000-000000000001',
  'd8620000-0000-4000-8000-000000000001', 'Prepared location', 'America/Los_Angeles');
insert into public.reporting_machines (
  id, account_id, location_id, machine_label, status, sunze_machine_id
) values
  ('d8640000-0000-4000-8000-000000000001',
   'd8620000-0000-4000-8000-000000000001',
   'd8630000-0000-4000-8000-000000000001', 'Unavailable cash', 'active', 'PREP-NEXT-UNAVAILABLE'),
  ('d8640000-0000-4000-8000-000000000002',
   'd8620000-0000-4000-8000-000000000001',
   'd8630000-0000-4000-8000-000000000001', 'Covered cash', 'active', 'PREP-NEXT-COVERED');
insert into public.reporting_machine_refund_managers (
  reporting_machine_id, manager_user_id, manager_email, grant_reason
) values
  ('d8640000-0000-4000-8000-000000000001',
   'd8610000-0000-4000-8000-000000000001', 'prepared-manager@example.invalid', 'Fixture'),
  ('d8640000-0000-4000-8000-000000000002',
   'd8610000-0000-4000-8000-000000000001', 'prepared-manager@example.invalid', 'Fixture');
insert into public.sales_import_runs (
  id, source, status, rows_seen, rows_imported, meta, completed_at
) values (
  'd8650000-0000-4000-8000-000000000001', 'sunze_browser', 'completed', 0, 0,
  '{"payment_time_semantics_status":"validated","payment_time_timezone":"America/Los_Angeles","timestamp_proof_scope":"account","machine_coverage_verified":true,"visible_machine_count_mismatch":false}'::jsonb,
  statement_timestamp() - interval '30 minutes'
);
insert into public.sunze_cash_source_watermarks (
  reporting_machine_id, coverage_started_at, covered_through,
  last_successful_import_at, freshness_expires_at, payment_time_basis,
  payment_time_timezone, timestamp_proof_scope, import_run_id
) values (
  'd8640000-0000-4000-8000-000000000002',
  statement_timestamp() - interval '14 hours', statement_timestamp() + interval '1 hour',
  statement_timestamp() - interval '30 minutes', statement_timestamp() + interval '1 day',
  'validated_iana_timezone', 'America/Los_Angeles', 'account',
  'd8650000-0000-4000-8000-000000000001'
);
insert into public.refund_cases (
  id, public_reference, reporting_machine_id, reporting_location_id,
  customer_email, issue_summary, incident_at, incident_timezone,
  payment_method, payment_amount_cents, refund_amount_cents,
  zelle_payment_contact, status, correlation_status
) values
  ('d8660000-0000-4000-8000-000000000001', 'RF-PROOF-UNAVAILABLE',
   'd8640000-0000-4000-8000-000000000001',
   'd8630000-0000-4000-8000-000000000001',
   'unavailable@example.invalid', 'Research unavailable coverage',
   statement_timestamp() - interval '11 hours', 'America/Los_Angeles',
   'cash', 900, 900, 'unavailable-zelle@example.invalid', 'needs_review', 'manual_review'),
  ('d8660000-0000-4000-8000-000000000002', 'RF-PROOF-UNMATCHED',
   'd8640000-0000-4000-8000-000000000002',
   'd8630000-0000-4000-8000-000000000001',
   'unmatched@example.invalid', 'Research complete coverage without a sale',
   statement_timestamp() - interval '8 hours', 'America/Los_Angeles',
   'cash', 900, 900, 'unmatched-zelle@example.invalid', 'needs_review', 'manual_review');

set local role service_role;
select is(public.refund_lifecycle_contract(
  'd8660000-0000-4000-8000-000000000001'
)->'nextWork'->>'actionCode', 'prepare_manager_decision',
  'amount and destination alone remain internal before completed research');
reset role;
select is((public.service_prepare_due_refund_cash_cases(10)->>'evaluated')::integer, 2,
  'the existing bounded worker actually completes both research paths');
select is(public.refund_manager_preparation_snapshot(
  'd8660000-0000-4000-8000-000000000001',
  (select official_action_version from public.refund_cases
    where id = 'd8660000-0000-4000-8000-000000000001'))->>'evidenceBasis',
  'cash_coverage_unavailable_researched', 'unavailable coverage is a completed reviewed gap');
select is(public.refund_manager_preparation_snapshot(
  'd8660000-0000-4000-8000-000000000002',
  (select official_action_version from public.refund_cases
    where id = 'd8660000-0000-4000-8000-000000000002'))->>'evidenceBasis',
  'cash_researched_unmatched', 'complete coverage with no sale is a researched outcome');
set local role service_role;
select is(public.refund_lifecycle_contract(
  'd8660000-0000-4000-8000-000000000001'
)->'nextWork'->>'actionCode', 'send_cash_refund_and_confirm',
  'service projection exposes the one final cash action after unavailable research');
select is(public.refund_lifecycle_contract(
  'd8660000-0000-4000-8000-000000000002'
)->'nextWork'->>'actionCode', 'send_cash_refund_and_confirm',
  'service projection does not require a matched sale after completed no-sale research');
reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"d8610000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select is(public.get_refund_lifecycle_for_manager(
  'd8660000-0000-4000-8000-000000000002'
)->'nextWork'->>'actionCode', 'send_cash_refund_and_confirm',
  'the currently mapped Manager sees the same prepared final action');
reset role;
select set_config('request.jwt.claims', '{}', true);

insert into public.sales_import_runs (
  id, source, status, rows_seen, rows_imported, meta, completed_at
) values (
  'd8650000-0000-4000-8000-000000000002', 'sunze_browser', 'completed', 0, 0,
  '{"payment_time_semantics_status":"validated","payment_time_timezone":"America/Los_Angeles","timestamp_proof_scope":"account","machine_coverage_verified":true,"visible_machine_count_mismatch":false}'::jsonb,
  statement_timestamp()
);
insert into public.sunze_cash_source_watermarks (
  reporting_machine_id, coverage_started_at, covered_through,
  last_successful_import_at, freshness_expires_at, payment_time_basis,
  payment_time_timezone, timestamp_proof_scope, import_run_id
) values (
  'd8640000-0000-4000-8000-000000000002',
  statement_timestamp() - interval '14 hours', statement_timestamp() + interval '1 hour',
  statement_timestamp(), statement_timestamp() + interval '1 day',
  'validated_iana_timezone', 'America/Los_Angeles', 'account',
  'd8650000-0000-4000-8000-000000000002'
);
select is(public.refund_manager_preparation_snapshot(
  'd8660000-0000-4000-8000-000000000002',
  (select official_action_version from public.refund_cases
    where id = 'd8660000-0000-4000-8000-000000000002')),
  null::jsonb, 'a new source snapshot invalidates the old completed proof');
set local role service_role;
select is(public.refund_lifecycle_contract(
  'd8660000-0000-4000-8000-000000000002'
)->'nextWork'->>'actionCode', 'prepare_manager_decision',
  'source change returns the undecided case to Agent preparation');
reset role;
select is((public.service_prepare_due_refund_cash_cases(10)->>'evaluated')::integer, 1,
  'the bounded worker re-evaluates the changed source once');
set local role service_role;
select is(public.refund_lifecycle_contract(
  'd8660000-0000-4000-8000-000000000002'
)->'nextWork'->>'actionCode', 'send_cash_refund_and_confirm',
  'completed current-source research restores the final Manager action');
reset role;

update public.refund_cases set payment_amount_cents = 950, refund_amount_cents = 950
where id = 'd8660000-0000-4000-8000-000000000002';
select is(public.refund_manager_preparation_snapshot(
  'd8660000-0000-4000-8000-000000000002',
  (select official_action_version from public.refund_cases
    where id = 'd8660000-0000-4000-8000-000000000002')),
  null::jsonb, 'corrected case facts invalidate prior preparation');
set local role service_role;
select is(public.refund_lifecycle_contract(
  'd8660000-0000-4000-8000-000000000002'
)->'nextWork'->>'actor', 'agent',
  'the corrected amount cannot remain Manager-ready on stale evidence');
reset role;
select is((public.service_prepare_due_refund_cash_cases(10)->>'evaluated')::integer, 1,
  'the existing worker researches the corrected fact version');
set local role service_role;
select is(public.refund_lifecycle_contract(
  'd8660000-0000-4000-8000-000000000002'
)->'nextWork'->>'actionCode', 'send_cash_refund_and_confirm',
  'the current corrected proof restores the same single decision path');
reset role;

update public.refund_cases set decision = 'approved', status = 'cash_zelle_pending'
where id = 'd8660000-0000-4000-8000-000000000002';
select is(public.refund_manager_preparation_snapshot(
  'd8660000-0000-4000-8000-000000000002',
  (select official_action_version from public.refund_cases
    where id = 'd8660000-0000-4000-8000-000000000002')),
  null::jsonb, 'the producer does not fabricate a second preparation after approval');
set local role service_role;
select is(public.refund_lifecycle_contract(
  'd8660000-0000-4000-8000-000000000002'
)->'nextWork'->>'actionCode', 'send_cash_refund_and_confirm',
  'a prior valid cash approval still permits only payout and confirmation');
reset role;

select * from finish();
rollback;
