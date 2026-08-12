begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(25);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
(
  '00000000-0000-0000-0000-000000000000',
  '79800000-0000-4000-8000-000000000001',
  'authenticated',
  'authenticated',
  'first-contact-manager-a@example.test',
  '',
  now(),
  '{}'::jsonb,
  '{}'::jsonb,
  now(),
  now()
),
(
  '00000000-0000-0000-0000-000000000000',
  '79800000-0000-4000-8000-000000000002',
  'authenticated',
  'authenticated',
  'first-contact-manager-b@example.test',
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
) values
(
  '79840000-0000-4000-8000-000000000001',
  '79830000-0000-4000-8000-000000000001',
  '79800000-0000-4000-8000-000000000001',
  'first-contact-manager-a@example.test',
  'active',
  'Exactly-once first-contact CC test'
),
(
  '79840000-0000-4000-8000-000000000002',
  '79830000-0000-4000-8000-000000000001',
  '79800000-0000-4000-8000-000000000002',
  'first-contact-manager-b@example.test',
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
  '<prior-first-contact@example.test>',
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

select ok(
  public.service_register_refund_gmail_intake_link(
    (select (result ->> 'operationId')::uuid from first_claim),
    repeat('a', 64),
    now() + interval '14 days'
  ),
  'The service registers one private hosted-form context before delivery'
);

create temporary table first_prepared as
select public.service_prepare_refund_gmail_first_contact_delivery(
  (select (result ->> 'operationId')::uuid from first_claim),
  array['info@bloomjoysweets.com', 'support@bloomjoysweets.com']
) as result;

select is(
  (select (result ->> 'allowed')::boolean from first_prepared),
  true,
  'The generic acknowledgement is allowed before a machine is mapped'
);

select is(
  (select result -> 'managerCcEmails' from first_prepared),
  '[]'::jsonb,
  'The pre-mapping acknowledgement exposes no manager recipient'
);

select ok(
  (
    select recipient_cc_emails = '{}'::text[]
      and recipient_cc_count = 0
      and recipient_resolution_status = 'premapping_acknowledgement'
      and delivery_kind = 'automatic'
      and participant_role = 'mailbox'
      and participant_trust = 'verified'
    from public.refund_gmail_messages
    where id = (select (result ->> 'transportMessageId')::uuid from first_claim)
  ),
  'The transport persists the narrow no-CC pre-mapping policy and participant evidence'
);

select ok(
  (
    select result ->> 'providerThreadId' = 'first-contact-cc-thread-one'
      and result ->> 'recipientEmail' = 'first-contact-customer-one@example.test'
      and result ->> 'inReplyTo' = '<first-contact-cc-message-one@example.test>'
      and result ->> 'references' = '<prior-first-contact@example.test> <first-contact-cc-message-one@example.test>'
      and position('/refunds?case=' in lower(result ->> 'subject')) = 0
    from first_claim
  )
  and not exists (
    select 1
    from public.refund_gmail_messages
    where id = (select (result ->> 'transportMessageId')::uuid from first_claim)
      and plain_body ~* '/refunds\?case='
  ),
  'The acknowledgement targets the customer on the original thread with reply headers and no internal case link'
);

select is(
  (
    select count(*)::integer
    from public.refund_case_events
    where refund_case_id = (select (result ->> 'caseId')::uuid from first_source)
      and event_type = 'gmail_first_contact_premapping_ready'
  ),
  1,
  'The pre-mapping exception writes one redacted audit event'
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
      and event_type = 'gmail_first_contact_premapping_ready'
  ),
  1,
  'Replaying preparation does not duplicate pre-mapping audit evidence'
);

create temporary table linked_form_case as
select public.service_link_refund_gmail_draft_from_hosted_form(
  repeat('a', 64),
  'first-contact-customer-one@example.test',
  jsonb_build_object(
    'reportingMachineId', '79830000-0000-4000-8000-000000000001',
    'reportingLocationId', '79820000-0000-4000-8000-000000000001',
    'customerName', 'Synthetic Customer One',
    'customerPhone', '',
    'zellePaymentContact', '',
    'issueSummary', 'Synthetic hosted-form details.',
    'incidentAt', '2026-08-03T17:45:00Z',
    'incidentLocalDateTime', '2026-08-03T10:45',
    'incidentTimezone', 'America/Los_Angeles',
    'incidentTimeResolution', 'exact',
    'paymentMethod', 'card',
    'paymentAmountCents', 900,
    'cardLast4', '4242',
    'cardWalletUsed', false,
    'status', 'needs_review',
    'correlationStatus', 'needs_nayax',
    'correlationSource', '',
    'correlationConfidence', 0,
    'correlationSummary', 'Synthetic manager review required.',
    'matchedSalesFactId', '',
    'intakeMeta', jsonb_build_object('payload_redacted', true),
    'serverDedupeKey', repeat('c', 64),
    'serverDedupeWindowStartedAt', '2026-08-03T17:40:00Z'
  )
) as result;

select is(
  (select result ->> 'id' from linked_form_case),
  (select result ->> 'caseId' from first_source),
  'The hosted form completes the original Gmail case instead of creating a second case'
);

select ok(
  (
    select reporting_machine_id = '79830000-0000-4000-8000-000000000001'
      and status = 'needs_review'
      and intake_source = 'gmail'
      and intake_meta ->> 'intake_path' = 'email_context_form'
    from public.refund_cases
    where id = (select (result ->> 'caseId')::uuid from first_source)
  ),
  'The linked Gmail draft contains the validated hosted-form operational fields'
);

select ok(
  (
    select used_at is not null
    from public.refund_gmail_intake_links
    where token_hash = repeat('a', 64)
  ),
  'The private email context is consumed exactly once'
);

select is(
  public.service_link_refund_gmail_draft_from_hosted_form(
    repeat('a', 64),
    'first-contact-customer-one@example.test',
    '{}'::jsonb
  ),
  null,
  'A consumed email context cannot be replayed'
);

select ok(
  public.service_finish_refund_gmail_first_contact(
    (select (result ->> 'operationId')::uuid from first_claim),
    'sent',
    'first-contact-provider-send-one',
    (
      select '<refund-' || left(
        regexp_replace(result ->> 'operationKey', '[^a-zA-Z0-9._-]', '', 'g'),
        80
      ) || '@bloomjoyusa.com>'
      from first_claim
    ),
    null
  ),
  'The synthetic provider completion confirms the one first-contact send'
);

select ok(
  (
    select status = 'sent'
    from public.refund_gmail_first_contact_operations
    where id = (select (result ->> 'operationId')::uuid from first_claim)
  )
  and (
    select count(*) = 1
    from public.refund_gmail_messages
    where gmail_thread_id = (
      select id
      from public.refund_gmail_threads
      where provider_thread_id = 'first-contact-cc-thread-one'
    )
      and direction = 'outbound'
      and status = 'sent'
  ),
  'One case and thread contain exactly one sent acknowledgement operation and outbound message'
);

create temporary table first_replay as
select public.service_claim_refund_gmail_first_contact(
  (select (result ->> 'messageId')::uuid from first_source),
  'active',
  '2026-08-03 18:00:00+00'::timestamptz,
  'refund_first_contact_v1',
  'info@bloomjoysweets.com',
  'Synthetic deterministic first-contact body.'
) as result;

select ok(
  (select (result ->> 'eligible')::boolean from first_replay)
  and not (select (result ->> 'claimed')::boolean from first_replay)
  and (select result ->> 'reason' from first_replay) = 'operation_already_exists'
  and (select result ->> 'status' from first_replay) = 'sent',
  'Replaying the original provider message creates no second acknowledgement or send'
);

create temporary table later_reply as
select public.service_ingest_refund_gmail_message_v2(
  repeat('8', 64),
  'first-contact-cc-thread-one',
  'first-contact-cc-message-later',
  '<first-contact-cc-message-later@example.test>',
  '<first-contact-cc-message-one@example.test>',
  'inbound',
  false,
  'first-contact-customer-one@example.test',
  'Synthetic Customer One',
  'info@bloomjoysweets.com',
  'Re: Synthetic first-contact CC request',
  'Synthetic later reply.',
  false,
  '2026-08-03 18:05:01+00'::timestamptz,
  null,
  '[]'::jsonb,
  '{}'::text[],
  array['info@bloomjoysweets.com', 'support@bloomjoysweets.com'],
  'direct_human',
  false,
  false,
  '{}'::text[]
) as result;

create temporary table later_reply_claim as
select public.service_claim_refund_gmail_first_contact(
  (select (result ->> 'messageId')::uuid from later_reply),
  'active',
  '2026-08-03 18:00:00+00'::timestamptz,
  'refund_first_contact_v1',
  'info@bloomjoysweets.com',
  'Synthetic deterministic first-contact body.'
) as result;

select is(
  (select result ->> 'reason' from later_reply_claim),
  'later_thread_message',
  'A later verified customer reply creates no second acknowledgement or outbound send'
);

select ok(
  (
    select count(*) = 1
    from public.refund_cases
    where id = (select (result ->> 'caseId')::uuid from first_source)
  )
  and (
    select count(*) = 1
    from public.refund_gmail_threads
    where provider_thread_id = 'first-contact-cc-thread-one'
  )
  and (
    select count(*) = 1
    from public.refund_gmail_first_contact_operations
    where refund_case_id = (select (result ->> 'caseId')::uuid from first_source)
  )
  and (
    select count(*) = 1
    from public.refund_gmail_messages
    where refund_case_id = (select (result ->> 'caseId')::uuid from first_source)
      and direction = 'outbound'
      and status = 'sent'
  ),
  'Replay and later reply leave exactly one case, thread, acknowledgement operation, and sent outbound message'
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
set manager_email = 'not-an-email'
where id = '79840000-0000-4000-8000-000000000002';

select ok(
  public.service_register_refund_gmail_intake_link(
    (select (result ->> 'operationId')::uuid from second_claim),
    repeat('b', 64),
    now() + interval '14 days'
  ),
  'A second thread receives its own private hosted-form context'
);

create temporary table blocked_preparation as
select public.service_prepare_refund_gmail_first_contact_delivery(
  (select (result ->> 'operationId')::uuid from second_claim),
  array['info@bloomjoysweets.com', 'support@bloomjoysweets.com']
) as result;

select is(
  (select result ->> 'status' from blocked_preparation),
  'premapping_acknowledgement',
  'Malformed manager mappings do not deadlock the sole generic form-link acknowledgement'
);

select is(
  (select (result ->> 'allowed')::boolean from blocked_preparation),
  true,
  'The generic acknowledgement remains sendable while case-specific mail stays separately gated'
);

select is(
  (
    select recipient_cc_count
    from public.refund_gmail_messages
    where id = (select (result ->> 'transportMessageId')::uuid from second_claim)
  ),
  0,
  'The generic first-contact transport contains no manager recipient'
);

select * from finish();
rollback;
