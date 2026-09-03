begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(12);

insert into public.customer_accounts (id, name, account_type)
values ('d1000000-0000-4000-8000-000000000001', 'Status recovery test', 'customer');

insert into public.reporting_locations (id, account_id, name, timezone)
values (
  'd2000000-0000-4000-8000-000000000001',
  'd1000000-0000-4000-8000-000000000001',
  'Status recovery location',
  'America/Los_Angeles'
);

insert into public.reporting_machines (id, account_id, location_id, machine_label)
values (
  'd3000000-0000-4000-8000-000000000001',
  'd1000000-0000-4000-8000-000000000001',
  'd2000000-0000-4000-8000-000000000001',
  'Status recovery machine'
);

insert into public.refund_cases (
  id, public_reference, reporting_machine_id, reporting_location_id,
  customer_email, issue_summary, incident_at, payment_method,
  payment_amount_cents, refund_amount_cents, card_last4, status,
  correlation_status, correlation_source, automation_state, created_at
) values
  (
    'd4000000-0000-4000-8000-000000000001', 'RF-STATUS-DUE',
    'd3000000-0000-4000-8000-000000000001',
    'd2000000-0000-4000-8000-000000000001',
    'status-due@example.invalid', '', statement_timestamp() - interval '9 days',
    'card', 700, 700, '4242', 'needs_review', 'needs_nayax', 'nayax',
    'under_review', statement_timestamp() - interval '9 days'
  ),
  (
    'd4000000-0000-4000-8000-000000000002', 'RF-STATUS-EARLY',
    'd3000000-0000-4000-8000-000000000001',
    'd2000000-0000-4000-8000-000000000001',
    'status-early@example.invalid', '', statement_timestamp(),
    'card', 700, 700, '4242', 'needs_review', 'needs_nayax', 'nayax',
    'under_review', statement_timestamp()
  );

insert into public.refund_cases (
  id, public_reference, reporting_machine_id, reporting_location_id,
  customer_email, issue_summary, incident_at, payment_method,
  payment_amount_cents, refund_amount_cents, card_last4, status, decision,
  correlation_status, correlation_source, automation_state, created_at
) values
  (
    'd4000000-0000-4000-8000-000000000003', 'RF-STATUS-PROVIDER-DUE',
    'd3000000-0000-4000-8000-000000000001',
    'd2000000-0000-4000-8000-000000000001',
    'status-provider-due@example.invalid', '', statement_timestamp() - interval '2 hours',
    'card', 700, 700, '4242', 'card_refund_pending', 'approved',
    'matched', 'nayax', 'approved', statement_timestamp() - interval '2 hours'
  ),
  (
    'd4000000-0000-4000-8000-000000000004', 'RF-STATUS-PROVIDER-NO-HOLD',
    'd3000000-0000-4000-8000-000000000001',
    'd2000000-0000-4000-8000-000000000001',
    'status-provider-no-hold@example.invalid', '', statement_timestamp() - interval '2 hours',
    'card', 700, 700, '4242', 'card_refund_pending', 'approved',
    'matched', 'nayax', 'approved', statement_timestamp() - interval '2 hours'
  );

insert into public.refund_case_nayax_refund_attempts (
  id, refund_case_id, execution_mode, status, idempotency_key,
  amount_cents, request_fingerprint, provider_claim_digest,
  provider_claim_expires_at, provider_outcome, provider_outcome_recorded_at,
  reconciliation_required, completed_at, safe_transport_stage,
  safe_failure_class, refund_operations_due_at, created_at
) values (
  'd6000000-0000-4000-8000-000000000003',
  'd4000000-0000-4000-8000-000000000003',
  'request_and_approve', 'ambiguous', 'nayax-refund-' || repeat('a', 64),
  700, repeat('b', 64), repeat('c', 64),
  statement_timestamp() + interval '5 minutes', 'unknown',
  statement_timestamp() - interval '2 hours', true,
  statement_timestamp() - interval '2 hours', 'confirmation_hold',
  'provider_unknown', statement_timestamp() - interval '1 hour',
  statement_timestamp() - interval '2 hours'
);

update public.refund_customer_contact_settings
set automatic_customer_contact_enabled = true
where singleton;

select ok(
  (public.service_start_refund_automation_run(
    'status-recovery-test-run', 'manual', statement_timestamp()
  ) ->> 'claimed')::boolean,
  'A test automation run is claimed'
);

select ok(
  (public.service_claim_refund_automation_action(
    (select id from public.refund_automation_runs
      where run_key = 'status-recovery-test-run'),
    'd4000000-0000-4000-8000-000000000001',
    'customer_status:sla_at_risk:d4000000-0000-4000-8000-000000000001',
    'customer_status_update', 'needs_review', statement_timestamp()
  ) ->> 'claimed')::boolean,
  'Customer status updates have a dedicated exactly-once action type'
);

select lives_ok($sql$
  insert into public.refund_case_messages (
    refund_case_id, message_type, status, recipient_email, subject, body,
    template_key, content_source, delivery_kind, reason_code,
    template_version, requested_fields
  ) values (
    'd4000000-0000-4000-8000-000000000001', 'status_update', 'pending',
    'status-due@example.invalid', 'A quick update', 'A person is following this.',
    'refund_status_update_sla_at_risk_v1', 'deterministic_template', 'automatic',
    'sla_at_risk', 'refund_customer_status_v1', '{}'
  )
$sql$, 'A due deterministic SLA status update is accepted');

select is(
  (select status from public.refund_case_messages
   where refund_case_id = 'd4000000-0000-4000-8000-000000000001'
     and reason_code = 'sla_at_risk'),
  'pending',
  'The pending status update is journaled before delivery'
);

select throws_ok($sql$
  update public.refund_case_messages
  set status = 'sent'
  where refund_case_id = 'd4000000-0000-4000-8000-000000000001'
    and reason_code = 'sla_at_risk'
$sql$, '23514', 'Sent customer status update requires a sent timestamp',
  'A sent status update requires delivery time evidence');

select lives_ok($sql$
  update public.refund_case_messages
  set status = 'failed', error_message = 'delivery_unknown'
  where refund_case_id = 'd4000000-0000-4000-8000-000000000001'
    and reason_code = 'sla_at_risk'
$sql$, 'Delivery-unknown evidence can settle the pending attempt as failed');

select throws_ok($sql$
  update public.refund_case_messages
  set status = 'pending'
  where refund_case_id = 'd4000000-0000-4000-8000-000000000001'
    and reason_code = 'sla_at_risk'
$sql$, '23514', 'Delivered or uncertain status update cannot be retried',
  'A failed or uncertain automatic status update cannot be blindly retried');

select throws_ok($sql$
  insert into public.refund_case_messages (
    refund_case_id, message_type, status, recipient_email, subject, body,
    template_key, content_source, delivery_kind, reason_code,
    template_version, requested_fields
  ) values (
    'd4000000-0000-4000-8000-000000000002', 'status_update', 'pending',
    'status-early@example.invalid', 'A quick update', 'A person is following this.',
    'refund_status_update_sla_at_risk_v1', 'deterministic_template', 'automatic',
    'sla_at_risk', 'refund_customer_status_v1', '{}'
  )
$sql$, '23514', 'SLA status update is not due',
  'A business-day-four message cannot be sent early');

select lives_ok($sql$
  insert into public.refund_case_messages (
    refund_case_id, message_type, status, recipient_email, subject, body,
    template_key, content_source, delivery_kind, reason_code,
    template_version, requested_fields
  ) values (
    'd4000000-0000-4000-8000-000000000003', 'status_update', 'pending',
    'status-provider-due@example.invalid', 'A quick update',
    'A person is following this.', 'refund_status_update_provider_delay_v1',
    'deterministic_template', 'automatic', 'provider_delay',
    'refund_customer_status_v1', '{}'
  )
$sql$, 'An approved pending refund with a current due hold accepts provider-delay evidence');

select throws_ok($sql$
  insert into public.refund_case_messages (
    refund_case_id, message_type, status, recipient_email, subject, body,
    template_key, content_source, delivery_kind, reason_code,
    template_version, requested_fields
  ) values (
    'd4000000-0000-4000-8000-000000000004', 'status_update', 'pending',
    'status-provider-no-hold@example.invalid', 'A quick update',
    'A person is following this.', 'refund_status_update_provider_delay_v1',
    'deterministic_template', 'automatic', 'provider_delay',
    'refund_customer_status_v1', '{}'
  )
$sql$, '23514', 'Provider-delay message requires the latest unresolved hold',
  'Provider-delay evidence fails closed without a current due hold');

select throws_ok($sql$
  insert into public.refund_case_messages (
    refund_case_id, message_type, status, recipient_email, subject, body,
    template_key, content_source, delivery_kind, reason_code,
    template_version, requested_fields
  ) values (
    'd4000000-0000-4000-8000-000000000003', 'status_update', 'pending',
    'status-provider-due@example.invalid', 'A quick update',
    'A person is following this.', 'refund_status_update_sla_at_risk_v1',
    'deterministic_template', 'automatic', 'sla_at_risk',
    'refund_customer_status_v1', '{}'
  )
$sql$, '23514', 'Automatic customer status update requires current deterministic evidence',
  'An approved pending refund cannot be mislabeled as an SLA-at-risk update');

select is(
  has_function_privilege(
    'service_role', 'public.guard_refund_customer_status_message()', 'execute'
  ) or has_function_privilege(
    'service_role', 'public.guard_refund_provider_hold_customer_message()', 'execute'
  ),
  false,
  'The trigger guards are not a service-callable bypass surface'
);

select * from finish();
rollback;
