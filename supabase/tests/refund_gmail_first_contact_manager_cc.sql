begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(13);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  '79800000-0000-4000-8000-000000000001',
  'authenticated',
  'authenticated',
  'first-contact-manager@example.test',
  '',
  now(),
  '{}'::jsonb,
  '{}'::jsonb,
  now(),
  now()
);

insert into public.customer_accounts (id, name, account_type)
values (
  '79810000-0000-4000-8000-000000000001',
  'First-contact CC test',
  'customer'
);

insert into public.reporting_locations (id, account_id, name, timezone)
values (
  '79820000-0000-4000-8000-000000000001',
  '79810000-0000-4000-8000-000000000001',
  'First-contact CC location',
  'America/Los_Angeles'
);

insert into public.reporting_machines (id, account_id, location_id, machine_label)
values (
  '79830000-0000-4000-8000-000000000001',
  '79810000-0000-4000-8000-000000000001',
  '79820000-0000-4000-8000-000000000001',
  'First-contact CC machine'
);

insert into public.reporting_machine_refund_managers (
  id, reporting_machine_id, manager_user_id, manager_email, status, grant_reason
) values (
  '79840000-0000-4000-8000-000000000001',
  '79830000-0000-4000-8000-000000000001',
  '79800000-0000-4000-8000-000000000001',
  'first-contact-manager@example.test',
  'active',
  'Exactly-once first-contact CC test'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.service_prepare_refund_gmail_first_contact_delivery(uuid,text[])',
    'execute'
  ),
  'Browser roles cannot resolve first-contact manager recipients'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.service_prepare_refund_gmail_first_contact_delivery(uuid,text[])',
    'execute'
  ),
  'The Gmail service can prepare a first-contact delivery'
);

create temporary table first_source as
select public.service_ingest_refund_gmail_message_v2(
  repeat('8', 64),
  'first-contact-cc-thread-one',
  'first-contact-cc-message-one',
  '<first-contact-cc-message-one@example.test>',
  null,
  'inbound',
  false,
  'first-contact-customer-one@example.test',
  'Synthetic Customer One',
  'info@bloomjoysweets.com',
  'Synthetic first-contact CC request',
  'Synthetic refund details.',
  false,
  '2026-08-03 18:00:01+00'::timestamptz,
  null,
  '[]'::jsonb,
  '{}'::text[],
  array['info@bloomjoysweets.com', 'support@bloomjoysweets.com'],
  'direct_human',
  false,
  false,
  '{}'::text[]
) as result;

update public.refund_cases
set reporting_machine_id = '79830000-0000-4000-8000-000000000001'
where id = (select (result ->> 'caseId')::uuid from first_source);

select is(
  (
    select participant_role
    from public.refund_gmail_messages
    where id = (select (result ->> 'messageId')::uuid from first_source)
  ),
  'customer',
  'The first-contact source is a verified direct customer participant'
);

create temporary table first_claim as
select public.service_claim_refund_gmail_first_contact(
  (select (result ->> 'messageId')::uuid from first_source),
  'active',
  '2026-08-03 18:00:00+00'::timestamptz,
  'refund_first_contact_v1',
  'info@bloomjoysweets.com',
  'Synthetic deterministic first-contact body.'
) as result;

select is(
  (select (result ->> 'claimed')::boolean from first_claim),
  true,
  'The verified first customer message claims one exactly-once operation'
);

create temporary table first_prepared as
select public.service_prepare_refund_gmail_first_contact_delivery(
  (select (result ->> 'operationId')::uuid from first_claim),
  array['info@bloomjoysweets.com', 'support@bloomjoysweets.com']
) as result;

select is(
  (select (result ->> 'allowed')::boolean from first_prepared),
  true,
  'A current mapped-manager route authorizes first-contact delivery'
);

select is(
  (select result -> 'managerCcEmails' from first_prepared),
  '["first-contact-manager@example.test"]'::jsonb,
  'The preparation returns only the current mapped Machine Manager'
);

select ok(
  (
    select recipient_cc_emails = array['first-contact-manager@example.test']
      and recipient_cc_count = 1
      and recipient_resolution_status = 'resolved'
      and delivery_kind = 'automatic'
      and participant_role = 'mailbox'
      and participant_trust = 'verified'
    from public.refund_gmail_messages
    where id = (select (result ->> 'transportMessageId')::uuid from first_claim)
  ),
  'The pending exactly-once transport persists the visible CC and participant evidence'
);

select is(
  (
    select count(*)::integer
    from public.refund_case_events
    where refund_case_id = (select (result ->> 'caseId')::uuid from first_source)
      and event_type = 'gmail_first_contact_manager_cc_resolved'
  ),
  1,
  'The first resolved route writes one redacted audit event'
);

select public.service_prepare_refund_gmail_first_contact_delivery(
  (select (result ->> 'operationId')::uuid from first_claim),
  array['info@bloomjoysweets.com', 'support@bloomjoysweets.com']
);

select is(
  (
    select count(*)::integer
    from public.refund_case_events
    where refund_case_id = (select (result ->> 'caseId')::uuid from first_source)
      and event_type = 'gmail_first_contact_manager_cc_resolved'
  ),
  1,
  'Replaying preparation with the same route does not duplicate audit evidence'
);

create temporary table second_source as
select public.service_ingest_refund_gmail_message_v2(
  repeat('8', 64),
  'first-contact-cc-thread-two',
  'first-contact-cc-message-two',
  '<first-contact-cc-message-two@example.test>',
  null,
  'inbound',
  false,
  'first-contact-customer-two@example.test',
  'Synthetic Customer Two',
  'info@bloomjoysweets.com',
  'Synthetic first-contact CC race',
  'Synthetic refund details.',
  false,
  '2026-08-03 18:00:02+00'::timestamptz,
  null,
  '[]'::jsonb,
  '{}'::text[],
  array['info@bloomjoysweets.com', 'support@bloomjoysweets.com'],
  'direct_human',
  false,
  false,
  '{}'::text[]
) as result;

update public.refund_cases
set reporting_machine_id = '79830000-0000-4000-8000-000000000001'
where id = (select (result ->> 'caseId')::uuid from second_source);

create temporary table second_claim as
select public.service_claim_refund_gmail_first_contact(
  (select (result ->> 'messageId')::uuid from second_source),
  'active',
  '2026-08-03 18:00:00+00'::timestamptz,
  'refund_first_contact_v1',
  'info@bloomjoysweets.com',
  'Synthetic deterministic first-contact body.'
) as result;

select is(
  (select (result ->> 'claimed')::boolean from second_claim),
  true,
  'A second verified thread has its own exactly-once operation'
);

update public.reporting_machine_refund_managers
set status = 'revoked', revoked_at = now(), revoke_reason = 'Synthetic race'
where id = '79840000-0000-4000-8000-000000000001';

create temporary table blocked_preparation as
select public.service_prepare_refund_gmail_first_contact_delivery(
  (select (result ->> 'operationId')::uuid from second_claim),
  array['info@bloomjoysweets.com', 'support@bloomjoysweets.com']
) as result;

select is(
  (select result ->> 'status' from blocked_preparation),
  'no_active_managers',
  'A mapping revoked after claim blocks provider delivery at preparation time'
);

select is(
  (select (result ->> 'allowed')::boolean from blocked_preparation),
  false,
  'The revoked route fails closed instead of sending without a manager CC'
);

select is(
  (
    select recipient_cc_count
    from public.refund_gmail_messages
    where id = (select (result ->> 'transportMessageId')::uuid from second_claim)
  ),
  0,
  'A blocked first-contact transport contains no stale manager recipient'
);

select * from finish();
rollback;
