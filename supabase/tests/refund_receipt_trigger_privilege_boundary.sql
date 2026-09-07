begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(6);

insert into public.customer_accounts (id, name, account_type)
values ('ac100000-0000-4000-8000-000000000001', 'Acknowledgement boundary', 'internal');

insert into public.reporting_locations (id, account_id, name, timezone)
values (
  'ac200000-0000-4000-8000-000000000001',
  'ac100000-0000-4000-8000-000000000001',
  'Acknowledgement boundary',
  'America/Los_Angeles'
);

insert into public.reporting_machines (id, account_id, location_id, machine_label)
values (
  'ac300000-0000-4000-8000-000000000001',
  'ac100000-0000-4000-8000-000000000001',
  'ac200000-0000-4000-8000-000000000001',
  'Acknowledgement boundary'
);

insert into public.refund_cases (
  id, public_reference, reporting_machine_id, reporting_location_id,
  customer_email, issue_summary, incident_at, payment_method,
  payment_amount_cents, refund_amount_cents, status,
  correlation_status, correlation_source, automation_state
) values (
  'ac400000-0000-4000-8000-000000000001', 'RF-ACK-BOUNDARY',
  'ac300000-0000-4000-8000-000000000001',
  'ac200000-0000-4000-8000-000000000001',
  'acknowledgement-boundary@example.invalid', 'Synthetic acknowledgement boundary',
  statement_timestamp(), 'cash', 1, 1, 'submitted',
  'not_started', 'manual', 'under_review'
);

select ok(
  not (select prosecdef
   from pg_proc
   where oid = 'public.guard_refund_receipt_completion_identity()'::regprocedure),
  'The receipt identity trigger preserves its caller-rights mutation boundary'
);

select is(
  has_function_privilege(
    'service_role',
    'public.is_refund_receipt_automatic_completion_message(uuid)',
    'execute'
  ),
  false,
  'The service role still cannot call the private receipt predicate directly'
);

set local role service_role;

select throws_ok(
  $$
    insert into public.refund_case_messages (
      refund_case_id, message_type, status, recipient_email, subject, body,
      template_key, template_version
    ) values (
      'ac400000-0000-4000-8000-000000000001',
      'completed',
      'pending',
      'acknowledgement-boundary@example.invalid',
      'Unsupported direct completion',
      'Unsupported direct completion',
      'refund_receipt_completed',
      'refund_receipt_completion_v1'
    )
  $$,
  '42501',
  'Receipt completion is owned by the supported delivery functions',
  'The service role still cannot create a receipt completion directly'
);

select is(
  (public.service_issue_refund_status_capability(
    'ac400000-0000-4000-8000-000000000001',
    repeat('c', 64),
    statement_timestamp() + interval '30 days'
  ) ->> 'issued')::boolean,
  true,
  'The intake service can issue the case status capability'
);

select lives_ok(
  $$
    insert into public.refund_case_messages (
      refund_case_id, message_type, status, recipient_email, subject, body,
      template_key, status_capability_id, status_link_included
    ) values (
      'ac400000-0000-4000-8000-000000000001',
      'confirmation',
      'pending',
      'acknowledgement-boundary@example.invalid',
      'We received your refund request',
      '[Secure refund status link included at delivery]',
      'refund_confirmation_v1',
      (select id from public.refund_case_status_capabilities
       where token_digest = repeat('c', 64)),
      true
    )
  $$,
  'A service-role intake acknowledgement survives the private receipt trigger'
);

reset role;

select is(
  (select count(*)::integer
   from public.refund_case_messages
   where refund_case_id = 'ac400000-0000-4000-8000-000000000001'
     and message_type = 'confirmation'
     and status = 'pending'
     and status_link_included is true
     and status_capability_id is not null),
  1,
  'The acknowledgement and its status-link audit evidence persist exactly once'
);

select * from finish();
rollback;
