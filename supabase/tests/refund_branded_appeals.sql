begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(32);

select has_table(
  'public',
  'refund_case_appeals',
  'Denial appeals have a durable same-case ledger'
);
select ok(
  not has_table_privilege('anon', 'public.refund_case_appeals', 'select'),
  'Anonymous clients cannot read appeal records'
);
select ok(
  has_table_privilege('authenticated', 'public.refund_case_appeals', 'select'),
  'Authenticated managers have an RLS-controlled appeal read path'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.service_record_refund_denial_appeal(uuid,uuid)',
    'execute'
  ),
  'Browser clients cannot create an appeal'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.service_record_refund_denial_appeal(uuid,uuid)',
    'execute'
  ),
  'The inbox service can record a verified appeal'
);

create temporary table initial_ingest as
select public.service_ingest_refund_gmail_message_v2(
  repeat('e', 64),
  'appeal-thread-1',
  'appeal-message-1',
  '<appeal-message-1@example.test>',
  null,
  'inbound',
  false,
  'appeal-customer@example.test',
  'Appeal Customer',
  'info@bloomjoysweets.com',
  'Refund request',
  'Synthetic customer intake for appeal safety testing.',
  false,
  now() - interval '30 minutes',
  null,
  '[]'::jsonb,
  '{}'::text[],
  array['info@bloomjoysweets.com'],
  'direct_human',
  false,
  false,
  '{}'::text[]
) as result;

select is(
  (select (result ->> 'created')::boolean from initial_ingest),
  true,
  'The fixture starts with one customer Gmail message'
);

insert into public.customer_accounts (id, name, account_type)
values ('ae100000-0000-4000-8000-000000000001', 'Appeal fixture account', 'customer');
insert into public.reporting_locations (id, account_id, name, timezone)
values (
  'ae200000-0000-4000-8000-000000000001',
  'ae100000-0000-4000-8000-000000000001',
  'Appeal fixture location',
  'America/Los_Angeles'
);
insert into public.reporting_machines (id, account_id, location_id, machine_label)
values (
  'ae300000-0000-4000-8000-000000000001',
  'ae100000-0000-4000-8000-000000000001',
  'ae200000-0000-4000-8000-000000000001',
  'Appeal fixture machine'
);

set local session_replication_role = replica;
update public.refund_cases
set
  reporting_machine_id = 'ae300000-0000-4000-8000-000000000001',
  reporting_location_id = 'ae200000-0000-4000-8000-000000000001',
  incident_at = now() - interval '1 hour',
  payment_method = 'card',
  payment_amount_cents = 700,
  card_last4 = '4242',
  status = 'denied',
  decision = 'denied',
  decision_reason = 'We could not confirm a matching purchase at the machine and time provided.',
  decided_at = now() - interval '10 minutes',
  automation_state = 'denied'
where id = (select (result ->> 'caseId')::uuid from initial_ingest);
set local session_replication_role = origin;

insert into public.refund_case_messages (
  refund_case_id,
  message_type,
  status,
  recipient_email,
  subject,
  body,
  sent_at
) values (
  (select (result ->> 'caseId')::uuid from initial_ingest),
  'denied',
  'sent',
  'appeal-customer@example.test',
  'Update on your Bloomjoy refund request',
  'We could not confirm a matching purchase. Reply in this conversation if we missed something.',
  now() - interval '9 minutes'
);

select is(
  (select status from public.refund_cases where id = (select (result ->> 'caseId')::uuid from initial_ingest)),
  'denied',
  'The fixture has a completed denial before a reply can be an appeal'
);

create temporary table first_appeal_ingest as
select public.service_ingest_refund_gmail_message_v2(
  repeat('e', 64),
  'appeal-thread-1',
  'appeal-message-2',
  '<appeal-message-2@example.test>',
  '<appeal-message-1@example.test>',
  'inbound',
  false,
  'appeal-customer@example.test',
  'Appeal Customer',
  'info@bloomjoysweets.com',
  'Re: Refund request',
  'Please take another look. The purchase was at 2:15 PM.',
  false,
  now(),
  null,
  '[]'::jsonb,
  '{}'::text[],
  array['info@bloomjoysweets.com'],
  'direct_human',
  false,
  false,
  '{}'::text[]
) as result;

select is(
  (select (result ->> 'appealReceived')::boolean from first_appeal_ingest),
  true,
  'A verified customer reply after a sent denial is recognized as an appeal'
);
select is(
  (select result ->> 'caseId' from first_appeal_ingest),
  (select result ->> 'caseId' from initial_ingest),
  'The appeal stays on the same refund case'
);
select is(
  (select count(*)::integer from public.refund_cases),
  1,
  'An appeal does not create a second case'
);
select is(
  (select count(*)::integer from public.refund_case_appeals),
  1,
  'One verified reply creates one appeal record'
);
select is(
  (select status from public.refund_cases where id = (select (result ->> 'caseId')::uuid from initial_ingest)),
  'needs_review',
  'The denied case is reopened for manager review'
);
select ok(
  (select decision is null and decision_reason is null and decided_at is null
   from public.refund_cases
   where id = (select (result ->> 'caseId')::uuid from initial_ingest)),
  'The prior decision is cleared so a manager must decide again'
);
select is(
  (select automation_state from public.refund_cases where id = (select (result ->> 'caseId')::uuid from initial_ingest)),
  'appeal_received',
  'The manager queue receives an explicit appeal state'
);
select is(
  (select count(*)::integer from public.refund_case_nayax_refund_attempts),
  0,
  'An appeal never creates a payment-provider attempt'
);
select ok(
  (select metadata @> '{"payment_authorized":false,"provider_attempt_created":false}'::jsonb
   from public.refund_case_events
   where event_type = 'refund_denial_appeal_received'
   order by created_at desc
   limit 1),
  'The audit event states that no payment was authorized or attempted'
);
select is(
  (select prior_customer_safe_reason from public.refund_case_appeals limit 1),
  'We could not confirm a matching purchase at the machine and time provided.',
  'The appeal preserves the prior customer-safe denial reason'
);

create temporary table duplicate_appeal_ingest as
select public.service_ingest_refund_gmail_message_v2(
  repeat('e', 64), 'appeal-thread-1', 'appeal-message-2',
  '<appeal-message-2@example.test>', '<appeal-message-1@example.test>',
  'inbound', false, 'appeal-customer@example.test', 'Appeal Customer',
  'info@bloomjoysweets.com', 'Re: Refund request',
  'Please take another look. The purchase was at 2:15 PM.', false, now(), null,
  '[]'::jsonb, '{}'::text[], array['info@bloomjoysweets.com'],
  'direct_human', false, false, '{}'::text[]
) as result;

select is(
  (select (result ->> 'duplicate')::boolean from duplicate_appeal_ingest),
  true,
  'A repeated Gmail delivery is deduplicated'
);
select is(
  (select count(*)::integer from public.refund_case_appeals),
  1,
  'A repeated Gmail delivery cannot duplicate the appeal'
);

update public.refund_customer_contact_settings
set automatic_customer_contact_enabled = true
where singleton;

create temporary table appeal_claim as
select public.service_claim_refund_denial_appeal_confirmation(
  (select (result ->> 'appealId')::uuid from first_appeal_ingest),
  'We received your Bloomjoy appeal - RF-APPEAL',
  E'Hi there,\n\nThank you for replying. We reopened the same request for review. This does not approve or issue a payment.\n\nWarmly,\nThe Bloomjoy Sweets Team'
) as result;

select is(
  (select (result ->> 'claimed')::boolean from appeal_claim),
  true,
  'The acknowledgement is claimed once'
);
select is(
  (select count(*)::integer from public.refund_case_messages where message_type = 'appeal_received'),
  1,
  'The claim creates one deterministic appeal receipt message'
);
select is(
  public.service_claim_refund_denial_appeal_confirmation(
    (select (result ->> 'appealId')::uuid from first_appeal_ingest),
    'We received your Bloomjoy appeal - RF-APPEAL',
    E'Hi there,\n\nThank you for replying. We reopened the same request for review. This does not approve or issue a payment.\n\nWarmly,\nThe Bloomjoy Sweets Team'
  ) ->> 'claimed',
  'false',
  'A concurrent or repeated acknowledgement claim cannot send twice'
);
select ok(
  public.service_finish_refund_denial_appeal_confirmation(
    (select (result ->> 'appealId')::uuid from first_appeal_ingest),
    (select (result ->> 'refundCaseMessageId')::uuid from appeal_claim),
    'sent',
    null
  ),
  'A confirmed acknowledgement send is finalized'
);
select is(
  (select confirmation_status from public.refund_case_appeals limit 1),
  'sent',
  'The appeal ledger records confirmed delivery'
);
select is(
  (select last_customer_message_type from public.refund_cases where id = (select (result ->> 'caseId')::uuid from initial_ingest)),
  'appeal_received',
  'The customer communication summary reports the appeal receipt'
);
select is(
  public.service_claim_refund_denial_appeal_confirmation(
    (select (result ->> 'appealId')::uuid from first_appeal_ingest),
    'We received your Bloomjoy appeal - RF-APPEAL',
    E'Hi there,\n\nThank you for replying. We reopened the same request for review. This does not approve or issue a payment.\n\nWarmly,\nThe Bloomjoy Sweets Team'
  ) ->> 'status',
  'sent',
  'A sent acknowledgement is permanently idempotent'
);

set local session_replication_role = replica;
update public.refund_cases
set
  status = 'denied',
  decision = 'denied',
  decision_reason = 'The purchase details still did not match one machine transaction.',
  decided_at = now(),
  automation_state = 'denied'
where id = (select (result ->> 'caseId')::uuid from initial_ingest);
set local session_replication_role = origin;

insert into public.refund_case_messages (
  refund_case_id, message_type, status, recipient_email, subject, body, sent_at
) values (
  (select (result ->> 'caseId')::uuid from initial_ingest),
  'denied', 'sent', 'appeal-customer@example.test',
  'Second review decision',
  'The purchase details still did not match one transaction. Reply if anything is incorrect.',
  now()
);

create temporary table forwarded_reply as
select public.service_ingest_refund_gmail_message_v2(
  repeat('e', 64), 'appeal-thread-1', 'appeal-message-forwarded',
  '<appeal-message-forwarded@example.test>', null, 'inbound', false,
  'appeal-customer@example.test', 'Appeal Customer', 'info@bloomjoysweets.com',
  'Fwd: second review decision', 'Forwarded content is not verified customer evidence.',
  false, now() + interval '1 minute', null, '[]'::jsonb, '{}'::text[],
  array['info@bloomjoysweets.com'], 'forwarded', false, false, '{}'::text[]
) as result;

select is(
  (select (result ->> 'appealReceived')::boolean from forwarded_reply),
  false,
  'Forwarded or otherwise unverified content cannot reopen a denied case'
);
select is(
  (select count(*)::integer from public.refund_case_appeals),
  1,
  'Unverified content creates no appeal record'
);

create temporary table second_appeal_ingest as
select public.service_ingest_refund_gmail_message_v2(
  repeat('e', 64), 'appeal-thread-1', 'appeal-message-3',
  '<appeal-message-3@example.test>', null, 'inbound', false,
  'appeal-customer@example.test', 'Appeal Customer', 'info@bloomjoysweets.com',
  'Re: second review decision', 'This direct reply asks for one more review.',
  false, now() + interval '2 minutes', null, '[]'::jsonb, '{}'::text[],
  array['info@bloomjoysweets.com'], 'direct_human', false, false, '{}'::text[]
) as result;

select is(
  (select (result ->> 'appealReceived')::boolean from second_appeal_ingest),
  true,
  'A later verified reply can reopen a later denial on the same case'
);

create temporary table unknown_claim as
select public.service_claim_refund_denial_appeal_confirmation(
  (select (result ->> 'appealId')::uuid from second_appeal_ingest),
  'We received your Bloomjoy appeal - RF-APPEAL',
  E'Hi there,\n\nThank you for replying. We reopened the same request for review. This does not approve or issue a payment.\n\nWarmly,\nThe Bloomjoy Sweets Team'
) as result;

select ok(
  public.service_finish_refund_denial_appeal_confirmation(
    (select (result ->> 'appealId')::uuid from second_appeal_ingest),
    (select (result ->> 'refundCaseMessageId')::uuid from unknown_claim),
    'delivery_unknown',
    'synthetic_transport_timeout'
  ),
  'An uncertain transport result is recorded without guessing'
);
select is(
  public.service_claim_refund_denial_appeal_confirmation(
    (select (result ->> 'appealId')::uuid from second_appeal_ingest),
    'We received your Bloomjoy appeal - RF-APPEAL',
    E'Hi there,\n\nThank you for replying. We reopened the same request for review. This does not approve or issue a payment.\n\nWarmly,\nThe Bloomjoy Sweets Team'
  ) ->> 'status',
  'delivery_unknown',
  'An uncertain appeal receipt cannot be blindly retried'
);
select is(
  (select count(*)::integer from public.refund_case_nayax_refund_attempts),
  0,
  'Repeated appeals still cannot create a payment-provider attempt'
);

select * from finish();
rollback;
