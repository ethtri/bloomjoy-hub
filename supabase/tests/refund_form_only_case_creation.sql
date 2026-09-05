begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(28);

insert into public.customer_accounts (id, name, account_type)
values (
  '88910000-0000-4000-8000-000000000001',
  'Form-only refund intake test',
  'customer'
);

insert into public.reporting_locations (id, account_id, name, timezone)
values (
  '88920000-0000-4000-8000-000000000001',
  '88910000-0000-4000-8000-000000000001',
  'Form-only refund location',
  'America/Los_Angeles'
);

insert into public.reporting_machines (id, account_id, location_id, machine_label)
values (
  '88930000-0000-4000-8000-000000000001',
  '88910000-0000-4000-8000-000000000001',
  '88920000-0000-4000-8000-000000000001',
  'Form-only refund machine'
);

create temporary table case_baseline as
select count(*)::integer as count from public.refund_cases;

select ok(
  not has_table_privilege('authenticated', 'public.refund_gmail_intake_contacts', 'select'),
  'Browser roles cannot read pre-form contact context'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.service_create_refund_case_from_gmail_contact_form(text,text,jsonb)',
    'execute'
  ),
  'Browser roles cannot consume a private email context'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.service_create_refund_case_from_gmail_contact_form(text,text,jsonb)',
    'execute'
  ),
  'Only the service path can consume the private context'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.service_purge_refund_gmail_intake_contacts(uuid,uuid,integer)',
    'execute'
  ),
  'Browser roles cannot purge private pre-form contacts'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.service_purge_refund_gmail_intake_contacts(uuid,uuid,integer)',
    'execute'
  ),
  'The independently gated retention service can purge private pre-form contacts'
);

create temporary table staged_contact as
select public.service_ingest_refund_gmail_contact_v1(
  repeat('8', 64),
  'form-only-thread-one',
  'form-only-message-one',
  '<form-only-message-one@example.test>',
  null,
  'inbound',
  false,
  'form-only-customer@example.test',
  'Form Only Customer',
  'info@bloomjoysweets.com',
  'Refund help',
  'Please help me request a refund.',
  false,
  '2026-08-21 17:00:01+00'::timestamptz,
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
  (select count(*)::integer from public.refund_cases),
  (select count from case_baseline),
  'Customer contact creates zero refund cases'
);

select is(
  (select result ->> 'participantRole' from staged_contact),
  'customer',
  'The pre-form contact retains a verified customer participant'
);

select is(
  (select result ->> 'contactOnly' from staged_contact),
  'true',
  'The service marks contact-only ingestion explicitly'
);

create temporary table duplicate_contact as
select public.service_ingest_refund_gmail_contact_v1(
  repeat('8', 64), 'form-only-thread-one', 'form-only-message-one',
  '<form-only-message-one@example.test>', null, 'inbound', false,
  'form-only-customer@example.test', 'Form Only Customer',
  'info@bloomjoysweets.com', 'Refund help', 'Please help me request a refund.',
  false, '2026-08-21 17:00:01+00'::timestamptz, null, '[]'::jsonb,
  '{}'::text[], array['info@bloomjoysweets.com', 'support@bloomjoysweets.com'],
  'direct_human', false, false, '{}'::text[]
) as result;

select is(
  (select result ->> 'duplicate' from duplicate_contact),
  'true',
  'Reprocessing the same contact is deduplicated'
);

select is(
  (select count(*)::integer from public.refund_gmail_intake_contact_messages),
  1,
  'Contact replay creates no second stored customer message'
);

create temporary table contact_claim as
select public.service_claim_refund_gmail_contact_first_response(
  (select (result ->> 'messageId')::uuid from staged_contact),
  'active',
  '2026-08-21 17:00:00+00'::timestamptz,
  'refund_first_contact_v1',
  'info@bloomjoysweets.com',
  'Please use https://www.bloomjoyusa.com/refunds/request?emailContext=private-context'
) as result;

select is(
  (select result ->> 'claimed' from contact_claim),
  'true',
  'The initial verified contact claims one response operation'
);

select ok(
  public.service_register_refund_gmail_contact_link(
    (select (result ->> 'operationId')::uuid from contact_claim),
    repeat('a', 64),
    now() + interval '14 days'
  ),
  'A private expiring form context is registered'
);

select is(
  (
    select result ->> 'allowed'
    from (
      select public.service_prepare_refund_gmail_contact_first_response(
        (select (result ->> 'operationId')::uuid from contact_claim),
        array['info@bloomjoysweets.com', 'support@bloomjoysweets.com']
      ) as result
    ) prepared
  ),
  'true',
  'The first response is prepared without creating a refund case'
);

select is(
  (select count(*)::integer from public.refund_cases),
  (select count from case_baseline),
  'Preparing and sending the form response still creates zero cases'
);

select ok(
  public.service_finish_refund_gmail_contact_first_response(
    (select (result ->> 'operationId')::uuid from contact_claim),
    'sent',
    'form-only-provider-send-one',
    (
      select '<refund-' || left(
        regexp_replace(result ->> 'operationKey', '[^a-zA-Z0-9._-]', '', 'g'),
        80
      ) || '@bloomjoyusa.com>'
      from contact_claim
    ),
    null
  ),
  'Provider-confirmed first response is recorded exactly once'
);

create temporary table linked_form_case as
select public.service_create_refund_case_from_gmail_contact_form(
  repeat('a', 64),
  'form-only-customer@example.test',
  jsonb_build_object(
    'reportingMachineId', '88930000-0000-4000-8000-000000000001',
    'reportingLocationId', '88920000-0000-4000-8000-000000000001',
    'customerName', 'Form Only Customer',
    'customerPhone', '',
    'zellePaymentContact', '',
    'issueSummary', 'Synthetic hosted-form refund request.',
    'incidentAt', '2026-08-21T16:45:00Z',
    'incidentLocalDateTime', '2026-08-21T09:45',
    'incidentTimezone', 'America/Los_Angeles',
    'incidentTimeResolution', 'exact',
    'paymentMethod', 'card',
    'paymentAmountCents', 900,
    'cardLast4', '4242',
    'cardWalletUsed', false,
    'paymentInteraction', 'tap_card',
    'walletProvider', '',
    'incidentTimeConfidence', 'exact',
    'issueCategory', 'charged_no_product',
    'productDescription', 'Cotton candy',
    'status', 'needs_review',
    'correlationStatus', 'needs_nayax',
    'correlationSource', '',
    'correlationConfidence', 0,
    'correlationSummary', 'Synthetic manager review required.',
    'matchedSalesFactId', '',
    'intakeMeta', jsonb_build_object('payload_redacted', true),
    'serverDedupeKey', repeat('c', 64),
    'serverDedupeWindowStartedAt', '2026-08-21T16:40:00Z'
  )
) as result;

select is(
  (select count(*)::integer from public.refund_cases),
  (select count + 1 from case_baseline),
  'Submitting the hosted form creates exactly one refund case'
);

select ok(
  (
    select intake_source = 'gmail'
      and intake_meta ->> 'gmail_contact_linked' = 'true'
      and intake_meta ->> 'intake_path' = 'email_context_form'
      and intake_meta ->> 'contact_alone_created_case' = 'false'
    from public.refund_cases
    where id = (select (result ->> 'id')::uuid from linked_form_case)
  ),
  'The form-created case preserves its Email source and linked context truthfully'
);

select ok(
  (
    select refund_case.customer_request_received_source = 'gmail_contact_ingested'
      and refund_case.customer_request_received_at = contact.created_at
    from public.refund_cases refund_case
    join public.refund_gmail_intake_contacts contact
      on contact.linked_refund_case_id = refund_case.id
    where refund_case.id = (select (result ->> 'id')::uuid from linked_form_case)
  ),
  'Email-linked intake keeps the first server-observed customer contact receipt'
);

select ok(
  (
    select refund_case_id = (select (result ->> 'id')::uuid from linked_form_case)
      and provider_thread_id = 'form-only-thread-one'
    from public.refund_gmail_threads
    where provider_thread_id = 'form-only-thread-one'
  )
  and (
    select count(*) = 2
    from public.refund_gmail_messages message
    join public.refund_gmail_threads thread on thread.id = message.gmail_thread_id
    where thread.provider_thread_id = 'form-only-thread-one'
  ),
  'The original inbound message and sent response move to the new case thread'
);

select is(
  public.service_create_refund_case_from_gmail_contact_form(
    repeat('a', 64),
    'form-only-customer@example.test',
    '{}'::jsonb
  ),
  null,
  'A consumed email context cannot create a second case'
);

select is(
  (select count(*)::integer from public.refund_cases),
  (select count + 1 from case_baseline),
  'Context replay preserves exactly-one case creation'
);

select ok(
  (
    select refund_case.customer_request_received_at = contact.created_at
    from public.refund_cases refund_case
    join public.refund_gmail_intake_contacts contact
      on contact.linked_refund_case_id = refund_case.id
    where refund_case.id = (select (result ->> 'id')::uuid from linked_form_case)
  ),
  'Consumed-link replay cannot move the original request receipt'
);

insert into public.refund_cases (
  id, reporting_machine_id, reporting_location_id, customer_email,
  issue_summary, incident_at, payment_method, payment_amount_cents,
  card_last4, card_wallet_used, status, correlation_status, intake_source,
  intake_meta, server_dedupe_key, server_dedupe_window_started_at
) values (
  '88950000-0000-4000-8000-000000000001',
  '88930000-0000-4000-8000-000000000001',
  '88920000-0000-4000-8000-000000000001',
  'form-only-customer@example.test',
  'Synthetic direct website submission for the same purchase.',
  '2026-08-21T16:49:00Z',
  'card', 900, '4242', false, 'needs_review', 'needs_nayax', 'form',
  jsonb_build_object(
    'source', 'hosted_refund_intake',
    'intake_path', 'direct_website_form',
    'payload_redacted', true
  ),
  repeat('d', 64),
  '2026-08-21T16:40:00Z'
);

select is(
  (select count(*)::integer from public.refund_cases),
  (select count + 2 from case_baseline),
  'A separate direct website submission remains a separate reviewable case'
);

select ok(
  (
    select customer_request_received_at is not null
      and customer_request_received_source = 'hosted_refund_intake'
    from public.refund_cases
    where id = '88950000-0000-4000-8000-000000000001'
  ),
  'Direct hosted intake receives an immutable database receipt time'
);

select throws_ok(
  $$update public.refund_cases set customer_request_received_at = customer_request_received_at + interval '1 minute'
    where id = '88950000-0000-4000-8000-000000000001'$$,
  'P4625',
  'The original customer request receipt is immutable',
  'Corrections and refreshes cannot move the request boundary'
);

select throws_ok(
  $$update public.refund_cases set incident_at = customer_request_received_at + interval '2 minutes'
    where id = '88950000-0000-4000-8000-000000000001'$$,
  'P4625',
  'The reported purchase time cannot be after Bloomjoy received the request',
  'Materially future customer purchase times are rejected by the database'
);

select is(
  (
    select count(*)::integer
    from public.refund_case_reconciliation_reviews review
    where '88950000-0000-4000-8000-000000000001' in (
      review.left_refund_case_id,
      review.right_refund_case_id
    )
      and (select (result ->> 'id')::uuid from linked_form_case) in (
        review.left_refund_case_id,
        review.right_refund_case_id
      )
      and review.status = 'pending'
      and review.match_class = 'exact'
  ),
  1,
  'Email-linked and direct Website forms create one visible duplicate review'
);

select ok(
  public.refund_case_has_unresolved_reconciliation(
    (select (result ->> 'id')::uuid from linked_form_case)
  )
  and public.refund_case_has_unresolved_reconciliation(
    '88950000-0000-4000-8000-000000000001'
  ),
  'Both possible duplicates remain blocked from official action until manager review'
);

select * from finish();
rollback;
