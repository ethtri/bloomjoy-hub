begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(12);

insert into public.customer_accounts (id, name, account_type)
values ('e1000000-0000-4000-8000-000000000001', 'Waiting truth test', 'customer');

insert into public.reporting_locations (id, account_id, name, timezone)
values (
  'e2000000-0000-4000-8000-000000000001',
  'e1000000-0000-4000-8000-000000000001',
  'Waiting truth location',
  'America/Los_Angeles'
);

insert into public.reporting_machines (id, account_id, location_id, machine_label)
values (
  'e3000000-0000-4000-8000-000000000001',
  'e1000000-0000-4000-8000-000000000001',
  'e2000000-0000-4000-8000-000000000001',
  'Waiting truth machine'
);

insert into public.refund_cases (
  id, public_reference, reporting_machine_id, reporting_location_id,
  customer_email, issue_summary, incident_at, payment_method,
  incident_time_resolution, payment_amount_cents, refund_amount_cents,
  card_last4, status,
  correlation_status, correlation_source, automation_state
) values (
  'e4000000-0000-4000-8000-000000000001', 'RF-WAIT-TRUTH',
  'e3000000-0000-4000-8000-000000000001',
  'e2000000-0000-4000-8000-000000000001',
  'waiting-truth@example.invalid', '',
  statement_timestamp() - interval '30 minutes', 'card', 'exact',
  700, 700, null, 'needs_review', 'no_match', 'nayax', 'under_review'
);

select lives_ok($sql$
  update public.refund_cases
  set status = 'waiting_on_customer', automation_state = 'more_info_needed'
  where id = 'e4000000-0000-4000-8000-000000000001'
$sql$, 'An unsupported customer-wait request is safely normalized');

select is(
  (select status from public.refund_cases
   where id = 'e4000000-0000-4000-8000-000000000001'),
  'needs_review',
  'A case without a sent field request stays in manager review'
);

select is(
  (select automation_state from public.refund_cases
   where id = 'e4000000-0000-4000-8000-000000000001'),
  'under_review',
  'more_info_needed is rejected when no information request was sent'
);

update public.refund_cases
set status = 'waiting_on_customer', automation_state = 'more_info_needed'
where id = 'e4000000-0000-4000-8000-000000000001';

select is(
  (select count(*)::integer from public.refund_case_events
   where refund_case_id = 'e4000000-0000-4000-8000-000000000001'
     and event_type = 'customer_waiting_contract_rejected'),
  1,
  'Replay does not duplicate the manager-owned contract exception'
);

select is(
  public.refund_customer_action_contract(
    'e4000000-0000-4000-8000-000000000001'
  ) ->> 'reason',
  'no_sent_information_request',
  'The redacted action contract explains the missing sent request'
);

select lives_ok($sql$
  insert into public.refund_case_messages (
    refund_case_id, message_type, status, recipient_email, subject, body,
    template_key, content_source, delivery_kind, reason_code,
    template_version, requested_fields, sent_at
  ) values (
    'e4000000-0000-4000-8000-000000000001', 'more_info', 'sent',
    'waiting-truth@example.invalid', 'Purchase details needed',
    'Please reply with the physical-card last four.',
    'refund_more_info_editable_v1', 'manager_authored', 'manual',
    'missing_information', null, array['card_last4'],
    statement_timestamp()
  )
$sql$, 'A sent deterministic request with exact missing fields is accepted');

select lives_ok($sql$
  update public.refund_cases
  set status = 'waiting_on_customer', automation_state = 'more_info_needed'
  where id = 'e4000000-0000-4000-8000-000000000001'
$sql$, 'A sent specific request may enter the customer-wait state');

select is(
  (select status from public.refund_cases
   where id = 'e4000000-0000-4000-8000-000000000001'),
  'waiting_on_customer',
  'The case waits only after successful specific customer contact'
);

select is(
  (select automation_state from public.refund_cases
   where id = 'e4000000-0000-4000-8000-000000000001'),
  'more_info_needed',
  'more_info_needed is truthful after a sent information request'
);

select is(
  public.refund_lifecycle_contract(
    'e4000000-0000-4000-8000-000000000001'
  ) #>> '{managerQueue,bucket}',
  'waiting_on_customer',
  'The canonical queue uses the same truthful waiting contract'
);

select is(
  public.refund_lifecycle_contract(
    'e4000000-0000-4000-8000-000000000001'
  ) #> '{managerQueue,customerActionFields}',
  '["card_last4"]'::jsonb,
  'Case detail receives the exact customer-correctable fields'
);

select is(
  has_function_privilege(
    'service_role', 'public.refund_customer_action_contract(uuid)', 'execute'
  ),
  false,
  'The supporting proof function is not a service-callable bypass surface'
);

select * from finish();
rollback;
