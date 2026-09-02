begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(35);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  'e0000000-0000-4000-8000-000000000001',
  'authenticated', 'authenticated', 'lifecycle-v2@example.invalid', '', now(),
  '{}'::jsonb, '{}'::jsonb, now(), now()
);

insert into public.customer_accounts (id, name, account_type)
values ('e1000000-0000-4000-8000-000000000001', 'Lifecycle v2 test', 'customer');

insert into public.reporting_locations (id, account_id, name, timezone)
values (
  'e2000000-0000-4000-8000-000000000001',
  'e1000000-0000-4000-8000-000000000001',
  'Lifecycle v2 location', 'America/Los_Angeles'
);

insert into public.reporting_machines (id, account_id, location_id, machine_label)
values (
  'e3000000-0000-4000-8000-000000000001',
  'e1000000-0000-4000-8000-000000000001',
  'e2000000-0000-4000-8000-000000000001',
  'Lifecycle v2 machine'
);

insert into public.refund_nayax_machine_inventory (
  id, account_key, nayax_machine_id, machine_name, provider_is_active,
  refund_category, reporting_machine_id, reconciliation_state, setup_reason
) values (
  'e3500000-0000-4000-8000-000000000001', 'LIFECYCLE_TEST',
  'LIFECYCLE-MACHINE-001', 'Lifecycle v2 provider machine', true,
  'cotton_candy', 'e3000000-0000-4000-8000-000000000001',
  'published', 'reviewed_exact_mapping'
);

insert into public.refund_cases (
  id, public_reference, reporting_machine_id, reporting_location_id,
  intake_selection_key, intake_selection_kind, intake_selection_machine_ids,
  customer_email, issue_summary, incident_at, incident_timezone,
  payment_method, payment_amount_cents, refund_amount_cents, card_last4,
  status, correlation_status, correlation_source, correlation_confidence,
  automation_state
) values
  (
    'e4000000-0000-4000-8000-000000000001', 'RF-LIFECYCLE-V2-NORMAL',
    'e3000000-0000-4000-8000-000000000001',
    'e2000000-0000-4000-8000-000000000001',
    'customer-selection-e1', 'exact_machine',
    array['e3000000-0000-4000-8000-000000000001'::uuid],
    'lifecycle-normal@example.invalid', 'Lifecycle normal fixture',
    statement_timestamp() - interval '30 minutes', 'America/Los_Angeles',
    'card', 700, 700, '4242', 'needs_review', 'matched', 'nayax', 1,
    'under_review'
  ),
  (
    'e4000000-0000-4000-8000-000000000002', 'RF-LIFECYCLE-V2-CLOSED',
    'e3000000-0000-4000-8000-000000000001',
    'e2000000-0000-4000-8000-000000000001',
    null, null, null,
    'lifecycle-closed@example.invalid', 'Lifecycle closed fixture',
    statement_timestamp() - interval '40 minutes', 'America/Los_Angeles',
    'card', 700, 700, '4242', 'closed', 'no_match', 'nayax', 0,
    'closed_incomplete'
  ),
  (
    'e4000000-0000-4000-8000-000000000003', 'RF-LIFECYCLE-V2-CASH',
    'e3000000-0000-4000-8000-000000000001',
    'e2000000-0000-4000-8000-000000000001',
    null, null, null,
    'lifecycle-cash@example.invalid', 'Lifecycle payout fixture',
    statement_timestamp() - interval '20 minutes', 'America/Los_Angeles',
    'cash', 800, 800, null, 'needs_review', 'not_started', null, 0,
    'under_review'
  );

insert into public.refund_cases (
  id, public_reference, reporting_machine_id, reporting_location_id,
  customer_email, issue_summary, incident_at, incident_timezone,
  payment_method, payment_amount_cents, refund_amount_cents, card_last4,
  status, correlation_status, correlation_source, automation_state,
  case_population, internal_test_reason, internal_test_classified_at,
  internal_test_classified_by
) values (
  'e4000000-0000-4000-8000-000000000004', 'RF-LIFECYCLE-V2-INTERNAL',
  'e3000000-0000-4000-8000-000000000001',
  'e2000000-0000-4000-8000-000000000001',
  'lifecycle-internal@example.invalid', 'Lifecycle internal fixture',
  statement_timestamp() - interval '10 minutes', 'America/Los_Angeles',
  'card', 700, 700, '4242', 'closed', 'not_started', null,
  'closed_incomplete', 'internal_test', 'employee_technician_test',
  statement_timestamp(), 'e0000000-0000-4000-8000-000000000001'
);

select has_column('public', 'refund_cases', 'lifecycle_revision',
  'Cases retain a monotonic lifecycle revision');
select has_constraint('public', 'refund_cases', 'refund_cases_lifecycle_integrity_shape_check',
  'Integrity holds have a constrained redacted shape');
select is(public.refund_lifecycle_contract('e4000000-0000-4000-8000-000000000001') ->> 'schemaVersion',
  'refund_lifecycle_v2', 'The shared projection is v2');
select ok((public.refund_lifecycle_contract('e4000000-0000-4000-8000-000000000001') ->> 'version')::bigint >= 1,
  'The projection exposes a durable revision');
select is(public.refund_lifecycle_contract('e4000000-0000-4000-8000-000000000001') #>> '{locationEvidence,customerReported,selectionKey}',
  'customer-selection-e1', 'Customer selection evidence is preserved separately');
select is(public.refund_lifecycle_contract('e4000000-0000-4000-8000-000000000001') #>> '{locationEvidence,normalized,providerAccountKey}',
  'LIFECYCLE_TEST', 'Normalized evidence carries the provider account scope');
select is((public.refund_lifecycle_contract('e4000000-0000-4000-8000-000000000001') #>> '{locationEvidence,normalized,authoritative}')::boolean,
  true, 'Published exact machine evidence is authoritative');
select is(public.refund_lifecycle_contract('e4000000-0000-4000-8000-000000000002') ->> 'stage',
  'unable_to_complete', 'Closed is not misrepresented as denied');
select is(public.refund_lifecycle_contract('e4000000-0000-4000-8000-000000000003') ->> 'stage',
  'awaiting_payout', 'Cash reimbursement has a named payout stage');
select is(public.refund_lifecycle_contract('e4000000-0000-4000-8000-000000000004') ->> 'stage',
  'internal_test_archived', 'Internal/test has a distinct terminal archive stage');
select is(public.refund_lifecycle_contract('e4000000-0000-4000-8000-000000000004') ->> 'classification',
  'internal_test', 'Internal/test classification is explicit');
select is(public.refund_lifecycle_contract('e4000000-0000-4000-8000-000000000004') #>> '{messageState,state}',
  'suppressed', 'Internal/test customer messaging is suppressed');

insert into public.refund_cases (
  id, public_reference, reporting_machine_id, reporting_location_id,
  customer_email, issue_summary, incident_at, incident_timezone,
  payment_method, payment_amount_cents, refund_amount_cents, card_last4,
  status, correlation_status, correlation_source, automation_state,
  lifecycle_integrity_status, lifecycle_integrity_code,
  lifecycle_integrity_detected_at
) values (
  'e4000000-0000-4000-8000-000000000005', 'RF-LIFECYCLE-V2-HOLD',
  'e3000000-0000-4000-8000-000000000001',
  'e2000000-0000-4000-8000-000000000001',
  'lifecycle-hold@example.invalid', 'Lifecycle historical hold fixture',
  statement_timestamp() - interval '50 minutes', 'America/Los_Angeles',
  'card', 700, 700, '4242', 'card_refund_pending', 'matched', 'nayax',
  'approved', 'hold', 'card_payment_state_without_attempt', statement_timestamp()
);

select is(public.refund_lifecycle_contract('e4000000-0000-4000-8000-000000000005') ->> 'stage',
  'integrity_hold', 'Impossible historical payment truth is quarantined');
select is(public.refund_lifecycle_contract('e4000000-0000-4000-8000-000000000005') ->> 'paymentState',
  'integrity_unknown', 'A quarantine never claims payment completion');
select is(public.service_reconcile_refund_lifecycle_integrity_v2() ->> 'schemaVersion',
  'refund_lifecycle_integrity_v2', 'The provider-free reconciliation monitor is versioned');
select is((select count(*)::integer from public.refund_case_nayax_refund_attempts where refund_case_id = 'e4000000-0000-4000-8000-000000000005'),
  0, 'Reconciliation never fabricates a payment attempt');
select is((select count(*)::integer from public.refund_case_messages where refund_case_id = 'e4000000-0000-4000-8000-000000000005'),
  0, 'Reconciliation never contacts the customer');
select is((select count(*)::integer from public.refund_case_events where refund_case_id = 'e4000000-0000-4000-8000-000000000005' and event_type = 'refund_lifecycle_integrity_hold'),
  1, 'The redacted hold is audited once');

insert into public.refund_case_nayax_refund_attempts (
  id, refund_case_id, execution_mode, status, idempotency_key, amount_cents
) values (
  'e6000000-0000-4000-8000-000000000001',
  'e4000000-0000-4000-8000-000000000005',
  'manual_portal', 'manual_review', 'lifecycle-v2-historical-attempt', 700
);

select is((select lifecycle_integrity_status from public.refund_cases where id = 'e4000000-0000-4000-8000-000000000005'),
  'ok', 'Adding durable evidence clears the integrity hold atomically');
select is((select lifecycle_integrity_code from public.refund_cases where id = 'e4000000-0000-4000-8000-000000000005'),
  null, 'Resolved evidence removes the integrity reason code');
select is(public.refund_lifecycle_contract('e4000000-0000-4000-8000-000000000005') ->> 'stage',
  'needs_refund_operations', 'Manual-portal uncertainty remains held without a fresh action');

create or replace function pg_temp.insert_invalid_refund_lifecycle_v2()
returns void language plpgsql as $$
begin
  insert into public.refund_cases (
    id, public_reference, reporting_machine_id, reporting_location_id,
    customer_email, issue_summary, incident_at, payment_method,
    payment_amount_cents, refund_amount_cents, card_last4, status,
    correlation_status, correlation_source, automation_state
  ) values (
    'e4000000-0000-4000-8000-000000000006', 'RF-LIFECYCLE-V2-INVALID',
    'e3000000-0000-4000-8000-000000000001',
    'e2000000-0000-4000-8000-000000000001',
    'invalid@example.invalid', 'Invalid split write', statement_timestamp(),
    'card', 700, 700, '4242', 'card_refund_pending', 'matched', 'nayax', 'approved'
  );
  set constraints refund_cases_enforce_lifecycle_v2 immediate;
end;
$$;

select throws_ok(
  $$select pg_temp.insert_invalid_refund_lifecycle_v2()$$,
  'P4650',
  'Refund lifecycle transition requires one durable payment attempt or an explicit integrity hold',
  'A new case-only payment transition fails closed'
);

create or replace function pg_temp.insert_atomic_refund_lifecycle_v2()
returns uuid language plpgsql as $$
declare case_id uuid := 'e4000000-0000-4000-8000-000000000007';
begin
  insert into public.refund_cases (
    id, public_reference, reporting_machine_id, reporting_location_id,
    customer_email, issue_summary, incident_at, payment_method,
    payment_amount_cents, refund_amount_cents, card_last4, status,
    correlation_status, correlation_source, automation_state
  ) values (
    case_id, 'RF-LIFECYCLE-V2-ATOMIC',
    'e3000000-0000-4000-8000-000000000001',
    'e2000000-0000-4000-8000-000000000001',
    'atomic@example.invalid', 'Atomic attempt fixture', statement_timestamp(),
    'card', 700, 700, '4242', 'card_refund_pending', 'matched', 'nayax', 'approved'
  );
  insert into public.refund_case_nayax_refund_attempts (
    refund_case_id, execution_mode, status, idempotency_key, amount_cents
  ) values (case_id, 'request_and_approve', 'in_progress', 'lifecycle-v2-atomic-attempt', 700);
  set constraints refund_cases_enforce_lifecycle_v2, refund_attempts_enforce_lifecycle_v2 immediate;
  set constraints refund_cases_enforce_lifecycle_v2, refund_attempts_enforce_lifecycle_v2 deferred;
  return case_id;
end;
$$;

select is(pg_temp.insert_atomic_refund_lifecycle_v2(),
  'e4000000-0000-4000-8000-000000000007'::uuid,
  'A case and attempt may transition atomically in one transaction');
select is((select count(*)::integer from public.refund_case_nayax_refund_attempts where refund_case_id = 'e4000000-0000-4000-8000-000000000007'),
  1, 'The atomic transition has exactly one durable attempt');

select is((public.service_issue_refund_status_capability(
  'e4000000-0000-4000-8000-000000000001', repeat('e', 64),
  statement_timestamp() + interval '1 day'
) ->> 'issued')::boolean, true, 'A customer capability can bind to the v2 case');
select is(public.service_read_refund_status_capability(repeat('e', 64), repeat('1', 64)) #>> '{lifecycle,schemaVersion}',
  'refund_lifecycle_v2', 'Customer status consumes the same lifecycle version');
select ok(not (public.service_read_refund_status_capability(repeat('e', 64), repeat('2', 64)) -> 'lifecycle') ? 'locationEvidence',
  'Customer status excludes manager-only location provenance');
select ok(not (public.service_read_refund_status_capability(repeat('e', 64), repeat('3', 64)) -> 'lifecycle') ? 'managerAction',
  'Customer status excludes manager actions');

select is((public.service_issue_refund_status_capability(
  'e4000000-0000-4000-8000-000000000004', repeat('f', 64),
  statement_timestamp() + interval '1 day'
) ->> 'issued')::boolean, true, 'An existing capability record can be reconciled for Internal/test');
select is((public.service_read_refund_status_capability(repeat('f', 64), repeat('4', 64)) ->> 'available')::boolean,
  false, 'Internal/test never exposes a customer status lifecycle');

create temporary table lifecycle_revision_before as
select lifecycle_revision
from public.refund_cases
where id = 'e4000000-0000-4000-8000-000000000001';

insert into public.refund_case_nayax_refund_attempts (
  id, refund_case_id, execution_mode, status, idempotency_key, amount_cents,
  provider_outcome
) values (
  'e6000000-0000-4000-8000-000000000002',
  'e4000000-0000-4000-8000-000000000001',
  'request_and_approve', 'succeeded', 'lifecycle-v2-completed-attempt', 700,
  'success'
);
insert into public.refund_case_messages (
  refund_case_id, message_type, status, recipient_email, subject, body,
  template_key, delivery_transport, delivery_state, delivery_state_updated_at
) values (
  'e4000000-0000-4000-8000-000000000001', 'completed', 'failed',
  'lifecycle-normal@example.invalid', 'Completion', 'Redacted completion',
  'refund_completed_v2_test', 'resend', 'failed', statement_timestamp()
);

select ok(
  (select lifecycle_revision from public.refund_cases where id = 'e4000000-0000-4000-8000-000000000001')
    > (select lifecycle_revision from lifecycle_revision_before),
  'Attempt and message evidence advance the shared lifecycle revision'
);
select is(public.refund_lifecycle_contract('e4000000-0000-4000-8000-000000000001') ->> 'stage',
  'refund_confirmed', 'Delivery failure cannot erase confirmed payment truth');
select is(public.refund_lifecycle_contract('e4000000-0000-4000-8000-000000000001') #>> '{messageState,state}',
  'failed', 'Delivery failure is visible in the shared lifecycle');
select is((public.refund_lifecycle_contract('e4000000-0000-4000-8000-000000000001') #>> '{operations,required}')::boolean,
  true, 'Delivery failure is actionable Refund Operations work');
select is(public.refund_nayax_reliability_health_snapshot(null) ->> 'lifecycleContractVersion',
  'refund_lifecycle_v2', 'Aggregate health advertises the same lifecycle release');
select is(public.refund_nayax_reliability_health_snapshot(null) -> 'releaseOrder',
  jsonb_build_array('database', 'functions', 'ui'),
  'Aggregate health advertises the mandatory release order');

select * from finish();
rollback;
