begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(117);

insert into auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
)
values
  (
    '00000000-0000-0000-0000-000000000000',
    '79000000-0000-4000-8000-000000000001',
    'authenticated',
    'authenticated',
    'first-contact-admin@example.test',
    '',
    now(),
    '{}'::jsonb,
    '{}'::jsonb,
    now(),
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '79000000-0000-4000-8000-000000000002',
    'authenticated',
    'authenticated',
    'first-contact-unauthorized@example.test',
    '',
    now(),
    '{}'::jsonb,
    '{}'::jsonb,
    now(),
    now()
  );

insert into public.admin_roles (user_id, role, active)
values ('79000000-0000-4000-8000-000000000001', 'super_admin', true);

select has_table(
  'public',
  'refund_gmail_first_contact_operations',
  'First-contact operation ledger exists'
);
select ok(
  not has_table_privilege(
    'authenticated',
    'public.refund_gmail_first_contact_operations',
    'select'
  ),
  'Browser clients cannot read the first-contact operation ledger'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.service_claim_refund_gmail_first_contact(uuid,text,timestamp with time zone,text,text,text,boolean)',
    'execute'
  ),
  'Browser clients cannot claim an automatic first-contact operation'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.service_claim_refund_gmail_first_contact(uuid,text,timestamp with time zone,text,text,text,boolean)',
    'execute'
  ),
  'The Gmail service can claim a first-contact operation'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.service_claim_refund_gmail_first_contact_reconciliation_batch(integer)',
    'execute'
  ),
  'Browser clients cannot claim outstanding first-contact reconciliation work'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.service_claim_refund_gmail_first_contact_reconciliation_batch(integer)',
    'execute'
  ),
  'The Gmail service can claim a content-free first-contact reconciliation batch'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.service_count_refund_gmail_first_contact_reconciliation()',
    'execute'
  ),
  'Browser clients cannot count outstanding first-contact reconciliation work'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.service_count_refund_gmail_first_contact_reconciliation()',
    'execute'
  ),
  'The Gmail service can count outstanding first-contact reconciliation work'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.service_mark_stale_refund_gmail_outbound_unknown(timestamp with time zone)',
    'execute'
  ),
  'Browser clients cannot transition stale manager replies to reconciliation work'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.service_mark_stale_refund_gmail_outbound_unknown(timestamp with time zone)',
    'execute'
  ),
  'The Gmail service can transition stale manager replies to reconciliation work'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.service_claim_refund_gmail_outbound_reconciliation_batch(integer)',
    'execute'
  ),
  'Browser clients cannot claim manager-reply reconciliation work'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.service_claim_refund_gmail_outbound_reconciliation_batch(integer)',
    'execute'
  ),
  'The Gmail service can claim manager-reply reconciliation work'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.service_finish_refund_gmail_outbound_reconciliation(uuid,text,text,integer)',
    'execute'
  ),
  'Browser clients cannot supply Gmail evidence for manager-reply reconciliation'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.service_finish_refund_gmail_outbound_reconciliation(uuid,text,text,integer)',
    'execute'
  ),
  'The Gmail service can finish manager-reply reconciliation'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.service_count_refund_gmail_outbound_reconciliation()',
    'execute'
  ),
  'Browser clients cannot count unresolved manager replies'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.service_count_refund_gmail_outbound_reconciliation()',
    'execute'
  ),
  'The Gmail service can keep unresolved manager replies in health'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.service_finish_refund_gmail_first_contact_no_match(uuid,integer)',
    'execute'
  ),
  'Browser clients cannot mint first-contact no-match receipts'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.service_finish_refund_gmail_first_contact_no_match(uuid,integer)',
    'execute'
  ),
  'The Gmail service can record a versioned first-contact no-match result'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.service_finish_refund_gmail_outbound_reconciliation_no_match(uuid,integer)',
    'execute'
  ),
  'Browser clients cannot mint manager-reply no-match receipts'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.service_finish_refund_gmail_outbound_reconciliation_no_match(uuid,integer)',
    'execute'
  ),
  'The Gmail service can record a versioned manager-reply no-match result'
);
select ok(
  has_function_privilege(
    'authenticated',
    'public.admin_resolve_refund_gmail_delivery_not_found(uuid)',
    'execute'
  ),
  'Authenticated portal users can request an authorized negative-delivery resolution'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.admin_resolve_refund_gmail_delivery_not_found(uuid)',
    'execute'
  ),
  'Anonymous callers cannot resolve uncertain Gmail delivery'
);
select ok(
  not has_function_privilege(
    'service_role',
    'public.admin_resolve_refund_gmail_delivery_not_found(uuid)',
    'execute'
  ),
  'The service role cannot impersonate a human negative-delivery verification'
);

create temporary table shadow_source as
select public.service_ingest_refund_gmail_message(
  repeat('a', 64),
  'first-contact-thread-shadow',
  'first-contact-message-shadow-1',
  '<first-contact-shadow-1@example.test>',
  null,
  'inbound',
  false,
  'synthetic-customer@example.test',
  'Synthetic Customer',
  'support@example.test',
  'Synthetic first contact',
  'Synthetic customer message without private data.',
  false,
  '2026-08-03 18:00:00+00'::timestamptz,
  null,
  '[]'::jsonb
) as result;

select is(
  (select (result ->> 'created')::boolean from shadow_source),
  true,
  'A first eligible labeled customer message is ingested'
);

create temporary table shadow_claim as
select public.service_claim_refund_gmail_first_contact(
  (select (result ->> 'messageId')::uuid from shadow_source),
  'shadow',
  null,
  'refund_first_contact_v1',
  'support@example.test',
  'Synthetic deterministic first-contact body.'
) as result;

select is(
  (select (result ->> 'claimed')::boolean from shadow_claim),
  true,
  'Shadow mode claims one would-send operation'
);
select is(
  (select status from public.refund_gmail_first_contact_operations limit 1),
  'shadowed',
  'Shadow mode persists no-send status'
);
select is(
  (
    public.service_claim_refund_gmail_first_contact(
      (select (result ->> 'messageId')::uuid from shadow_source),
      'shadow',
      null,
      'refund_first_contact_v1',
      'support@example.test',
      'Synthetic deterministic first-contact body.'
    ) ->> 'claimed'
  )::boolean,
  false,
  'Scheduler or ingestion replay cannot claim a second acknowledgement'
);
select is(
  (select count(*)::integer from public.refund_gmail_first_contact_operations),
  1,
  'One Gmail thread has one durable first-contact operation'
);

create temporary table later_source as
select public.service_ingest_refund_gmail_message(
  repeat('a', 64),
  'first-contact-thread-shadow',
  'first-contact-message-shadow-2',
  '<first-contact-shadow-2@example.test>',
  '<first-contact-shadow-1@example.test>',
  'inbound',
  false,
  'synthetic-customer@example.test',
  'Synthetic Customer',
  'support@example.test',
  'Re: Synthetic first contact',
  'Synthetic later reply.',
  false,
  '2026-08-03 18:05:00+00'::timestamptz,
  null,
  '[]'::jsonb
) as result;

select is(
  (select count(*)::integer from public.refund_gmail_messages where direction = 'inbound'),
  2,
  'A later reply remains part of the same Gmail conversation'
);
select is(
  (
    public.service_claim_refund_gmail_first_contact(
      (select (result ->> 'messageId')::uuid from later_source),
      'shadow',
      null,
      'refund_first_contact_v1',
      'support@example.test',
      'Synthetic deterministic first-contact body.'
    ) ->> 'reason'
  ),
  'later_thread_message',
  'A later customer reply is never eligible for first contact'
);

create temporary table before_cutover_source as
select public.service_ingest_refund_gmail_message(
  repeat('a', 64),
  'first-contact-thread-before-cutover',
  'first-contact-message-before-cutover',
  '<first-contact-before-cutover@example.test>',
  null,
  'inbound',
  false,
  'before-cutover@example.test',
  'Before Cutover',
  'support@example.test',
  'Synthetic old thread',
  'Synthetic pre-cutover message.',
  false,
  '2026-08-03 17:59:59+00'::timestamptz,
  null,
  '[]'::jsonb
) as result;

select is(
  (select (result ->> 'created')::boolean from before_cutover_source),
  true,
  'A pre-cutover thread is still safely ingested'
);
select is(
  (
    public.service_claim_refund_gmail_first_contact(
      (select (result ->> 'messageId')::uuid from before_cutover_source),
      'active',
      '2026-08-03 18:00:00+00'::timestamptz,
      'refund_first_contact_v1',
      'support@example.test',
      'Synthetic deterministic first-contact body.'
    ) ->> 'reason'
  ),
  'before_cutover',
  'Active mode never acknowledges an old thread discovered after cutover'
);

create temporary table prior_reply_source as
select public.service_ingest_refund_gmail_message(
  repeat('a', 64),
  'first-contact-thread-prior-reply',
  'first-contact-message-prior-reply-inbound',
  '<first-contact-prior-reply-inbound@example.test>',
  null,
  'inbound',
  false,
  'prior-reply-customer@example.test',
  'Prior Reply Customer',
  'support@example.test',
  'Synthetic thread with existing reply',
  'Synthetic customer message.',
  false,
  '2026-08-03 18:00:00+00'::timestamptz,
  null,
  '[]'::jsonb
) as result;

select public.service_ingest_refund_gmail_message(
  repeat('a', 64),
  'first-contact-thread-prior-reply',
  'first-contact-message-prior-reply-outbound',
  '<first-contact-prior-reply-outbound@example.test>',
  '<first-contact-prior-reply-inbound@example.test>',
  'outbound',
  false,
  'support@example.test',
  'Bloomjoy Support',
  'prior-reply-customer@example.test',
  'Re: Synthetic thread with existing reply',
  'Synthetic legacy or manual reply.',
  false,
  '2026-08-03 18:00:01+00'::timestamptz,
  null,
  '[]'::jsonb
);

select is(
  (
    public.service_claim_refund_gmail_first_contact(
      (select (result ->> 'messageId')::uuid from prior_reply_source),
      'active',
      '2026-08-03 18:00:00+00'::timestamptz,
      'refund_first_contact_v1',
      'support@example.test',
      'Synthetic deterministic first-contact body.',
      true
    ) ->> 'reason'
  ),
  'prior_mailbox_reply',
  'A fetched thread with a legacy or manual mailbox reply is suppressed'
);
select is(
  (
    select count(*)::integer
    from public.refund_gmail_first_contact_operations operation
    where operation.source_message_id = (select (result ->> 'messageId')::uuid from prior_reply_source)
  ),
  0,
  'A prior mailbox reply creates no first-contact send operation'
);

create temporary table prior_reply_shadow_claim as
select public.service_claim_refund_gmail_first_contact(
  (select (result ->> 'messageId')::uuid from prior_reply_source),
  'shadow',
  null,
  'refund_first_contact_v1',
  '',
  '',
  true
) as result;

select ok(
  (select (result ->> 'claimed')::boolean from prior_reply_shadow_claim),
  'Shadow mode records an otherwise eligible first contact even when the legacy mailbox already replied'
);
select ok(
  (select (result ->> 'priorMailboxReplyPresent')::boolean from prior_reply_shadow_claim)
  and (
    select prior_mailbox_reply_present
    from public.refund_gmail_first_contact_operations operation
    where operation.source_message_id = (select (result ->> 'messageId')::uuid from prior_reply_source)
  ),
  'Shadow evidence records that a prior mailbox reply was present without sending another message'
);

create temporary table active_source as
select public.service_ingest_refund_gmail_message(
  repeat('a', 64),
  'first-contact-thread-active',
  'first-contact-message-active',
  '<first-contact-active@example.test>',
  null,
  'inbound',
  false,
  'active-customer@example.test',
  'Active Customer',
  'support@example.test',
  'Synthetic active thread',
  'Synthetic post-cutover message.',
  false,
  '2026-08-03 18:00:01+00'::timestamptz,
  null,
  '[]'::jsonb
) as result;

select is(
  (select (result ->> 'created')::boolean from active_source),
  true,
  'A separate post-cutover customer thread is ingested independently'
);

create temporary table active_claim as
select public.service_claim_refund_gmail_first_contact(
  (select (result ->> 'messageId')::uuid from active_source),
  'active',
  '2026-08-03 18:00:00+00'::timestamptz,
  'refund_first_contact_v1',
  'support@example.test',
  'Synthetic deterministic first-contact body without an internal link.'
) as result;

create temporary table active_provider_header as
select '<refund-' || left(
  regexp_replace((select result ->> 'operationKey' from active_claim), '[^a-zA-Z0-9._-]', '', 'g'),
  80
) || '@bloomjoyusa.com>' as value;

select is(
  (select (result ->> 'claimed')::boolean from active_claim),
  true,
  'A new post-cutover thread claims one active acknowledgement'
);
select ok(
  (
    select message_type = 'confirmation'
      and status = 'pending'
      and template_key = 'refund_first_contact_v1'
    from public.refund_case_messages
    where id = (select (result ->> 'refundCaseMessageId')::uuid from active_claim)
  ),
  'The deterministic template and pending customer operation are recorded'
);
select ok(
  (
    select status = 'pending_send'
      and operation_key like 'refund-first-contact:%'
      and direction = 'outbound'
    from public.refund_gmail_messages
    where id = (select (result ->> 'transportMessageId')::uuid from active_claim)
  ),
  'The original-thread transport operation is pending exactly once'
);
select throws_ok(
  $guard_pending$
    insert into public.refund_gmail_messages (
      gmail_thread_id,
      refund_case_id,
      operation_key,
      direction,
      message_kind,
      status,
      sender_email,
      recipient_email,
      subject,
      plain_body,
      received_at,
      retention_expires_at
    )
    select
      transport.gmail_thread_id,
      transport.refund_case_id,
      'refund-guard-active-new-operation',
      'outbound',
      'message',
      'pending_send',
      transport.sender_email,
      transport.recipient_email,
      'Synthetic blocked pending send',
      'Synthetic blocked pending send body.',
      now(),
      now() + interval '180 days'
    from public.refund_gmail_messages transport
    where transport.id = (
      select (result ->> 'transportMessageId')::uuid from active_claim
    )
  $guard_pending$,
  'P0001',
  'refund_gmail_delivery_reconciliation_required',
  'A new outbound pending send is blocked while the thread already has pending delivery'
);
select is(
  (
    public.service_claim_refund_gmail_first_contact(
      (select (result ->> 'messageId')::uuid from active_source),
      'active',
      '2026-08-03 18:00:00+00'::timestamptz,
      'refund_first_contact_v1',
      'support@example.test',
      'Synthetic deterministic first-contact body without an internal link.'
    ) ->> 'claimed'
  )::boolean,
  false,
  'A concurrent or repeated active claim is suppressed'
);
select is(
  public.service_finish_refund_gmail_first_contact(
    (select (result ->> 'operationId')::uuid from active_claim),
    'sent',
    'first-contact-provider-message-active',
    (select value from active_provider_header),
    null
  ),
  true,
  'Confirmed Gmail delivery finalizes the acknowledgement once'
);
select is(
  public.service_finish_refund_gmail_first_contact(
    (select (result ->> 'operationId')::uuid from active_claim),
    'sent',
    'first-contact-provider-message-active',
    (select value from active_provider_header),
    null
  ),
  true,
  'A replayed provider-confirmed finalization is idempotent'
);
select ok(
  (
    select operation.status = 'sent'
      and transport.status = 'sent'
      and case_message.status = 'sent'
    from public.refund_gmail_first_contact_operations operation
    join public.refund_gmail_messages transport on transport.id = operation.transport_message_id
    join public.refund_case_messages case_message on case_message.id = operation.refund_case_message_id
    where operation.id = (select (result ->> 'operationId')::uuid from active_claim)
  ),
  'Operation, transport, and customer message agree on confirmed success'
);
select is(
  (
    select count(*)::integer
    from public.refund_case_events
    where event_type = 'gmail_first_contact_sent'
  ),
  1,
  'Confirmed delivery creates one redacted success event'
);

create temporary table known_failure_source as
select public.service_ingest_refund_gmail_message(
  repeat('a', 64),
  'first-contact-thread-known-failure',
  'first-contact-message-known-failure',
  '<first-contact-known-failure@example.test>',
  null,
  'inbound',
  false,
  'known-failure-customer@example.test',
  'Known Failure Customer',
  'support@example.test',
  'Synthetic known failure thread',
  'Synthetic post-cutover message.',
  false,
  '2026-08-03 18:08:00+00'::timestamptz,
  null,
  '[]'::jsonb
) as result;

create temporary table known_failure_claim as
select public.service_claim_refund_gmail_first_contact(
  (select (result ->> 'messageId')::uuid from known_failure_source),
  'isolated_test',
  '2026-08-03 18:00:00+00'::timestamptz,
  'refund_first_contact_v1',
  'support@example.test',
  'Synthetic deterministic first-contact body.'
) as result;

select is(
  public.service_finish_refund_gmail_first_contact(
    (select (result ->> 'operationId')::uuid from known_failure_claim),
    'failed',
    null,
    null,
    'gmail_http_400'
  ),
  true,
  'A provider-confirmed rejection becomes known failure work'
);
select ok(
  (
    select status = 'failed' and error_code = 'gmail_http_400'
    from public.refund_gmail_first_contact_operations
    where id = (select (result ->> 'operationId')::uuid from known_failure_claim)
  )
  and exists (
    select 1 from public.refund_case_events where event_type = 'gmail_first_contact_failed'
  ),
  'Known failure state is visible with a safe error code'
);
select is(
  (
    public.service_claim_refund_gmail_first_contact(
      (select (result ->> 'messageId')::uuid from known_failure_source),
      'isolated_test',
      '2026-08-03 18:00:00+00'::timestamptz,
      'refund_first_contact_v1',
      'support@example.test',
      'Synthetic deterministic first-contact body.'
    ) ->> 'claimed'
  )::boolean,
  false,
  'Known failure is not retried automatically by replay'
);

create temporary table uncertain_source as
select public.service_ingest_refund_gmail_message(
  repeat('a', 64),
  'first-contact-thread-uncertain',
  'first-contact-message-uncertain',
  '<first-contact-uncertain@example.test>',
  null,
  'inbound',
  false,
  'uncertain-customer@example.test',
  'Uncertain Customer',
  'support@example.test',
  'Synthetic uncertain thread',
  'Synthetic post-cutover message.',
  false,
  '2026-08-03 18:10:00+00'::timestamptz,
  null,
  '[]'::jsonb
) as result;

create temporary table uncertain_claim as
select public.service_claim_refund_gmail_first_contact(
  (select (result ->> 'messageId')::uuid from uncertain_source),
  'isolated_test',
  '2026-08-03 18:00:00+00'::timestamptz,
  'refund_first_contact_v1',
  'support@example.test',
  'Synthetic deterministic first-contact body.'
) as result;

grant select on uncertain_claim to authenticated;

select is(
  (select (result ->> 'claimed')::boolean from uncertain_claim),
  true,
  'An isolated synthetic thread can claim its own acknowledgement'
);
select is(
  public.service_finish_refund_gmail_first_contact(
    (select (result ->> 'operationId')::uuid from uncertain_claim),
    'delivery_unknown',
    null,
    null,
    'gmail_send_unconfirmed'
  ),
  true,
  'Uncertain delivery is recorded without claiming success'
);
select ok(
  (
    select status = 'delivery_unknown'
      and error_code = 'gmail_send_unconfirmed'
    from public.refund_gmail_first_contact_operations
    where id = (select (result ->> 'operationId')::uuid from uncertain_claim)
  )
  and exists (
    select 1
    from public.refund_case_events
    where event_type = 'gmail_first_contact_delivery_unknown'
  ),
  'Uncertain delivery creates visible reconciliation work with a safe code'
);
select throws_ok(
  $guard_unknown$
    insert into public.refund_gmail_messages (
      gmail_thread_id,
      refund_case_id,
      operation_key,
      direction,
      message_kind,
      status,
      sender_email,
      recipient_email,
      subject,
      plain_body,
      received_at,
      retention_expires_at
    )
    select
      transport.gmail_thread_id,
      transport.refund_case_id,
      'refund-guard-unknown-new-operation',
      'outbound',
      'message',
      'pending_send',
      transport.sender_email,
      transport.recipient_email,
      'Synthetic blocked uncertain send',
      'Synthetic blocked uncertain send body.',
      now(),
      now() + interval '180 days'
    from public.refund_gmail_messages transport
    where transport.id = (
      select (result ->> 'transportMessageId')::uuid from uncertain_claim
    )
  $guard_unknown$,
  'P0001',
  'refund_gmail_delivery_reconciliation_required',
  'A new outbound pending send is blocked while the thread requires delivery reconciliation'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '79000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select throws_ok(
  $human_before_automatic_check$
    select public.admin_resolve_refund_gmail_delivery_not_found(
      (select (result ->> 'refundCaseMessageId')::uuid from uncertain_claim)
    )
  $human_before_automatic_check$,
  'P0001',
  'A completed latest-version Gmail no-match check is required before human resolution',
  'Even an authorized manager must wait for a completed automatic no-match check'
);

reset role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', '', true);

select is(
  (
    public.service_claim_refund_gmail_first_contact(
      (select (result ->> 'messageId')::uuid from uncertain_source),
      'isolated_test',
      '2026-08-03 18:00:00+00'::timestamptz,
      'refund_first_contact_v1',
      'support@example.test',
      'Synthetic deterministic first-contact body.'
    ) ->> 'claimed'
  )::boolean,
  false,
  'Uncertain delivery is never retried blindly by a replay'
);

create temporary table stale_source as
select public.service_ingest_refund_gmail_message(
  repeat('a', 64),
  'first-contact-thread-stale',
  'first-contact-message-stale',
  '<first-contact-stale@example.test>',
  null,
  'inbound',
  false,
  'stale-customer@example.test',
  'Stale Customer',
  'support@example.test',
  'Synthetic stale thread',
  'Synthetic post-cutover message.',
  false,
  now(),
  null,
  '[]'::jsonb
) as result;

create temporary table stale_claim as
select public.service_claim_refund_gmail_first_contact(
  (select (result ->> 'messageId')::uuid from stale_source),
  'isolated_test',
  now() - interval '1 minute',
  'refund_first_contact_v1',
  'support@example.test',
  'Synthetic deterministic first-contact body.'
) as result;

update public.refund_gmail_first_contact_operations
set claimed_at = now() - interval '20 minutes'
where id = (select (result ->> 'operationId')::uuid from stale_claim);

select is(
  public.service_mark_stale_refund_gmail_first_contacts_unknown(now() - interval '10 minutes'),
  1,
  'An abandoned send claim becomes reconciliation-required'
);
select is(
  (
    select status from public.refund_gmail_first_contact_operations
    where id = (select (result ->> 'operationId')::uuid from stale_claim)
  ),
  'delivery_unknown',
  'Stale pending work is never silently retried'
);
select is(
  public.service_count_refund_gmail_first_contact_reconciliation(),
  2,
  'Outstanding reconciliation count keeps health degraded for both unresolved deliveries'
);

create temporary table first_reconciliation_batch as
select *
from public.service_claim_refund_gmail_first_contact_reconciliation_batch(1);

select is(
  (select operation_id from first_reconciliation_batch),
  (select (result ->> 'operationId')::uuid from stale_claim),
  'The oldest never-checked operation is claimed in the first reconciliation batch'
);

create temporary table second_reconciliation_batch as
select *
from public.service_claim_refund_gmail_first_contact_reconciliation_batch(1);

select is(
  (select operation_id from second_reconciliation_batch),
  (select (result ->> 'operationId')::uuid from uncertain_claim),
  'The next reconciliation batch rotates to the other never-checked operation'
);
select ok(
  (
    select reconciliation_attempt_count = 1
    from public.refund_gmail_first_contact_operations
    where id = (select (result ->> 'operationId')::uuid from stale_claim)
  )
  and (
    select reconciliation_attempt_count = 1
    from public.refund_gmail_first_contact_operations
    where id = (select (result ->> 'operationId')::uuid from uncertain_claim)
  ),
  'Each claimed reconciliation operation records exactly one deterministic attempt'
);

select is(
  (
    select count(*)::integer
    from public.service_claim_refund_gmail_first_contact_reconciliation_batch(100)
  ),
  0,
  'An active first-contact reconciliation attempt cannot be reclaimed before its lease expires'
);

update public.refund_gmail_first_contact_operations
set reconciliation_checked_at = now() - interval '6 minutes'
where id = (select (result ->> 'operationId')::uuid from stale_claim);

create temporary table first_contact_lease_recovery_batch as
select *
from public.service_claim_refund_gmail_first_contact_reconciliation_batch(1);

select is(
  (
    select operation_id::text || ':' || attempt_version::text
    from first_contact_lease_recovery_batch
  ),
  (
    select (result ->> 'operationId') || ':2'
    from stale_claim
  ),
  'An expired first-contact reconciliation lease can be reclaimed with a newer fenced version'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '79000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select throws_ok(
  $claimed_without_no_match_receipt$
    select public.admin_resolve_refund_gmail_delivery_not_found(
      (select (result ->> 'refundCaseMessageId')::uuid from uncertain_claim)
    )
  $claimed_without_no_match_receipt$,
  'P0001',
  'A completed latest-version Gmail no-match check is required before human resolution',
  'Claiming reconciliation work alone cannot authorize a human negative-delivery resolution'
);

reset role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', '', true);

select is(
  public.service_finish_refund_gmail_first_contact_no_match(
    (select operation_id from second_reconciliation_batch),
    (select attempt_version from second_reconciliation_batch)
  ),
  true,
  'The service can mint a first-contact no-match receipt for the exact current attempt version'
);
select is(
  public.service_finish_refund_gmail_first_contact_no_match(
    (select operation_id from second_reconciliation_batch),
    (select attempt_version from second_reconciliation_batch)
  ),
  true,
  'Replaying the same first-contact no-match receipt is idempotent'
);

update public.refund_gmail_first_contact_operations
set reconciliation_checked_at = now() - interval '5 minutes'
where id = (select (result ->> 'operationId')::uuid from uncertain_claim);

create temporary table third_reconciliation_batch as
select *
from public.service_claim_refund_gmail_first_contact_reconciliation_batch(1);

select is(
  (
    select operation_id::text || ':' || attempt_version::text
    from third_reconciliation_batch
  ),
  (
    select (result ->> 'operationId') || ':2'
    from uncertain_claim
  ),
  'A newer first-contact claim advances the version and makes the prior receipt stale'
);
select is(
  public.service_finish_refund_gmail_first_contact_no_match(
    (select operation_id from third_reconciliation_batch),
    1
  ),
  false,
  'A stale first-contact attempt version cannot mint a new no-match receipt'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '79000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select throws_ok(
  $stale_no_match_receipt$
    select public.admin_resolve_refund_gmail_delivery_not_found(
      (select (result ->> 'refundCaseMessageId')::uuid from uncertain_claim)
    )
  $stale_no_match_receipt$,
  'P0001',
  'A completed latest-version Gmail no-match check is required before human resolution',
  'A newer automatic claim invalidates an older human-resolution receipt'
);

reset role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', '', true);

select is(
  public.service_finish_refund_gmail_first_contact_no_match(
    (select operation_id from third_reconciliation_batch),
    (select attempt_version from third_reconciliation_batch)
  ),
  true,
  'The exact latest first-contact no-match version restores human-resolution eligibility'
);
select is(
  public.service_finish_refund_gmail_first_contact_no_match(
    (select operation_id from third_reconciliation_batch),
    (select attempt_version from third_reconciliation_batch)
  ),
  true,
  'The latest first-contact no-match receipt remains idempotent'
);
select is(
  public.service_count_refund_gmail_first_contact_reconciliation(),
  2,
  'Claiming reconciliation work does not hide unresolved delivery from health'
);

create temporary table stale_provider_header as
select '<refund-' || left(
  regexp_replace((select result ->> 'operationKey' from stale_claim), '[^a-zA-Z0-9._-]', '', 'g'),
  80
) || '@bloomjoyusa.com>' as value;

select is(
  public.service_finish_refund_gmail_first_contact(
    (select (result ->> 'operationId')::uuid from stale_claim),
    'sent',
    'first-contact-provider-message-stale',
    (select value from stale_provider_header),
    null,
    (select attempt_version from first_reconciliation_batch)
  ),
  false,
  'A delayed positive first-contact result cannot finalize after a newer lease claim'
);
select is(
  (
    select status from public.refund_gmail_first_contact_operations
    where id = (select (result ->> 'operationId')::uuid from stale_claim)
  ),
  'delivery_unknown',
  'A stale positive result leaves first-contact delivery unresolved'
);
select is(
  public.service_finish_refund_gmail_first_contact(
    (select (result ->> 'operationId')::uuid from stale_claim),
    'sent',
    'first-contact-provider-message-stale',
    (select value from stale_provider_header),
    null,
    (select attempt_version from first_contact_lease_recovery_batch)
  ),
  true,
  'Deterministic Gmail Message-ID evidence reconciles an uncertain operation to sent'
);
select is(
  (
    select status from public.refund_gmail_first_contact_operations
    where id = (select (result ->> 'operationId')::uuid from stale_claim)
  ),
  'sent',
  'Reconciled operation, transport, and case message return to confirmed sent state'
);
select is(
  public.service_count_refund_gmail_first_contact_reconciliation(),
  1,
  'Outstanding reconciliation health count drops only after deterministic delivery proof'
);

create temporary table generic_pending_source as
select public.service_ingest_refund_gmail_message(
  repeat('a', 64),
  'manager-reply-thread-pending',
  'manager-reply-message-pending',
  '<manager-reply-pending@example.test>',
  null,
  'inbound',
  false,
  'manager-reply-pending-customer@example.test',
  'Pending Reply Customer',
  'support@example.test',
  'Synthetic pending manager reply thread',
  'Synthetic request for a manager reply.',
  false,
  now() - interval '30 minutes',
  null,
  '[]'::jsonb
) as result;

insert into public.refund_case_messages (
  id,
  refund_case_id,
  message_type,
  status,
  recipient_email,
  subject,
  body
)
select
  '79100000-0000-4000-8000-000000000001',
  source_message.refund_case_id,
  'more_info',
  'pending',
  'manager-reply-pending-customer@example.test',
  'Synthetic pending manager reply',
  'Please share the missing synthetic purchase details.'
from public.refund_gmail_messages source_message
where source_message.id = (
  select (result ->> 'messageId')::uuid from generic_pending_source
);

create temporary table generic_pending_claim as
select public.service_claim_refund_gmail_outbound(
  source_message.refund_case_id,
  '79100000-0000-4000-8000-000000000001',
  'refund-case-message:79100000-0000-4000-8000-000000000001',
  'support@example.test',
  'manager-reply-pending-customer@example.test',
  'Please share the missing synthetic purchase details.'
) as result
from public.refund_gmail_messages source_message
where source_message.id = (
  select (result ->> 'messageId')::uuid from generic_pending_source
);

select is(
  (select (result ->> 'claimed')::boolean from generic_pending_claim),
  true,
  'A generic manager reply can be claimed for its original Gmail thread'
);

create temporary table generic_pending_provider_header as
select '<refund-' || left(
  regexp_replace(message.operation_key, '[^a-zA-Z0-9._-]', '', 'g'),
  80
) || '@bloomjoyusa.com>' as value
from public.refund_gmail_messages message
where message.id = (select (result ->> 'transportMessageId')::uuid from generic_pending_claim);

create temporary table generic_unknown_source as
select public.service_ingest_refund_gmail_message(
  repeat('a', 64),
  'manager-reply-thread-unknown',
  'manager-reply-message-unknown',
  '<manager-reply-unknown@example.test>',
  null,
  'inbound',
  false,
  'manager-reply-unknown-customer@example.test',
  'Unknown Reply Customer',
  'support@example.test',
  'Synthetic uncertain manager reply thread',
  'Synthetic request for another manager reply.',
  false,
  now() - interval '20 minutes',
  null,
  '[]'::jsonb
) as result;

insert into public.refund_case_messages (
  id,
  refund_case_id,
  message_type,
  status,
  recipient_email,
  subject,
  body
)
select
  '79100000-0000-4000-8000-000000000002',
  source_message.refund_case_id,
  'status_update',
  'pending',
  'manager-reply-unknown-customer@example.test',
  'Synthetic uncertain manager reply',
  'We are reviewing the synthetic refund request.'
from public.refund_gmail_messages source_message
where source_message.id = (
  select (result ->> 'messageId')::uuid from generic_unknown_source
);

create temporary table generic_unknown_claim as
select public.service_claim_refund_gmail_outbound(
  source_message.refund_case_id,
  '79100000-0000-4000-8000-000000000002',
  'refund-case-message:79100000-0000-4000-8000-000000000002',
  'support@example.test',
  'manager-reply-unknown-customer@example.test',
  'We are reviewing the synthetic refund request.'
) as result
from public.refund_gmail_messages source_message
where source_message.id = (
  select (result ->> 'messageId')::uuid from generic_unknown_source
);

select is(
  (select (result ->> 'claimed')::boolean from generic_unknown_claim),
  true,
  'A second generic manager reply is claimed independently'
);
select is(
  public.service_finish_refund_gmail_outbound(
    (select (result ->> 'transportMessageId')::uuid from generic_unknown_claim),
    'delivery_unknown',
    null,
    null,
    'gmail_send_unconfirmed'
  ),
  true,
  'An uncertain manager reply becomes generic reconciliation work'
);
select is(
  public.service_count_refund_gmail_outbound_reconciliation(),
  1,
  'A fresh pending reply is excluded while the delivery-unknown reply keeps health degraded'
);

create temporary table generic_fresh_reconciliation_batch as
select *
from public.service_claim_refund_gmail_outbound_reconciliation_batch(100);

select is(
  (
    select string_agg(transport_message_id::text || ':' || operation_status, ',')
    from generic_fresh_reconciliation_batch
  ),
  (
    select (result ->> 'transportMessageId') || ':delivery_unknown'
    from generic_unknown_claim
  ),
  'Generic reconciliation claims only delivery-unknown work and leaves the fresh live send alone'
);
select is(
  public.service_finish_refund_gmail_outbound_reconciliation_no_match(
    (select transport_message_id from generic_fresh_reconciliation_batch),
    (select attempt_version from generic_fresh_reconciliation_batch)
  ),
  true,
  'The service can mint a manager-reply no-match receipt for the exact current attempt version'
);
select is(
  public.service_finish_refund_gmail_outbound_reconciliation_no_match(
    (select transport_message_id from generic_fresh_reconciliation_batch),
    (select attempt_version from generic_fresh_reconciliation_batch)
  ),
  true,
  'Replaying the same manager-reply no-match receipt is idempotent'
);

update public.refund_gmail_messages
set reconciliation_checked_at = now() - interval '5 minutes'
where id = (select (result ->> 'transportMessageId')::uuid from generic_unknown_claim);

select is(
  public.service_finish_refund_gmail_outbound_reconciliation(
    (select (result ->> 'transportMessageId')::uuid from generic_pending_claim),
    'manager-reply-provider-pending',
    (select value from generic_pending_provider_header),
    1
  ),
  false,
  'Even exact provider evidence cannot finalize a fresh pending reply through reconciliation'
);

update public.refund_gmail_messages
set created_at = now() - interval '20 minutes'
where id = (select (result ->> 'transportMessageId')::uuid from generic_pending_claim);

select is(
  public.service_mark_stale_refund_gmail_outbound_unknown(now() - interval '10 minutes'),
  1,
  'Only the stale-marker moves an aged pending manager reply into recovery'
);
select ok(
  (
    select transport.status = 'delivery_unknown'
      and case_message.status = 'failed'
      and case_message.error_message = 'Gmail delivery could not be confirmed. Check the original thread before retrying.'
    from public.refund_gmail_messages transport
    join public.refund_case_messages case_message on case_message.id = transport.refund_case_message_id
    where transport.id = (select (result ->> 'transportMessageId')::uuid from generic_pending_claim)
  )
  and public.service_count_refund_gmail_outbound_reconciliation() = 2,
  'The stale transition visibly blocks the reply and adds it to delivery health'
);

create temporary table generic_first_reconciliation_batch as
select *
from public.service_claim_refund_gmail_outbound_reconciliation_batch(1);

select is(
  (
    select transport_message_id::text || ':' || operation_status
    from generic_first_reconciliation_batch
  ),
  (
    select (result ->> 'transportMessageId') || ':delivery_unknown'
    from generic_pending_claim
  ),
  'Rotation first claims the newly stale delivery-unknown manager reply'
);

create temporary table generic_second_reconciliation_batch as
select *
from public.service_claim_refund_gmail_outbound_reconciliation_batch(1);

select is(
  (
    select transport_message_id::text || ':' || operation_status
    from generic_second_reconciliation_batch
  ),
  (
    select (result ->> 'transportMessageId') || ':delivery_unknown'
    from generic_unknown_claim
  ),
  'The next generic batch rotates back to the previously checked uncertain reply'
);
select ok(
  (
    select transport_message_id from generic_first_reconciliation_batch
  ) <> (select (result ->> 'transportMessageId')::uuid from uncertain_claim)
  and (
    select transport_message_id from generic_second_reconciliation_batch
  ) <> (select (result ->> 'transportMessageId')::uuid from uncertain_claim),
  'An outstanding first-contact transport is excluded from every generic reconciliation batch'
);
select ok(
  (
    select reconciliation_attempt_count = 1
    from public.refund_gmail_messages
    where id = (select (result ->> 'transportMessageId')::uuid from generic_pending_claim)
  )
  and (
    select reconciliation_attempt_count = 2
    from public.refund_gmail_messages
    where id = (select (result ->> 'transportMessageId')::uuid from generic_unknown_claim)
  ),
  'Generic rotation records one attempt for newly stale work and a second check for older unknown work'
);

select is(
  (
    select count(*)::integer
    from public.service_claim_refund_gmail_outbound_reconciliation_batch(100)
  ),
  0,
  'An active manager-reply reconciliation attempt cannot be reclaimed before its lease expires'
);

update public.refund_gmail_messages
set reconciliation_checked_at = now() - interval '6 minutes'
where id = (select (result ->> 'transportMessageId')::uuid from generic_pending_claim);

create temporary table generic_lease_recovery_batch as
select *
from public.service_claim_refund_gmail_outbound_reconciliation_batch(1);

select is(
  (
    select transport_message_id::text || ':' || attempt_version::text
    from generic_lease_recovery_batch
  ),
  (
    select (result ->> 'transportMessageId') || ':2'
    from generic_pending_claim
  ),
  'An expired manager-reply reconciliation lease can be reclaimed with a newer fenced version'
);
select is(
  public.service_finish_refund_gmail_outbound_reconciliation_no_match(
    (select transport_message_id from generic_second_reconciliation_batch),
    1
  ),
  false,
  'A stale manager-reply attempt version cannot mint another no-match receipt'
);
select is(
  public.service_finish_refund_gmail_outbound_reconciliation_no_match(
    (select transport_message_id from generic_second_reconciliation_batch),
    (select attempt_version from generic_second_reconciliation_batch)
  ),
  true,
  'The exact latest manager-reply version replaces the stale no-match receipt'
);
select is(
  public.service_finish_refund_gmail_outbound_reconciliation_no_match(
    (select transport_message_id from generic_second_reconciliation_batch),
    (select attempt_version from generic_second_reconciliation_batch)
  ),
  true,
  'The latest manager-reply no-match receipt remains idempotent'
);
select is(
  public.service_count_refund_gmail_outbound_reconciliation(),
  2,
  'Rotating generic reconciliation does not hide unresolved replies from health'
);

create temporary table generic_unknown_provider_header as
select '<refund-' || left(
  regexp_replace(message.operation_key, '[^a-zA-Z0-9._-]', '', 'g'),
  80
) || '@bloomjoyusa.com>' as value
from public.refund_gmail_messages message
where message.id = (select (result ->> 'transportMessageId')::uuid from generic_unknown_claim);

select throws_ok(
  $generic_invalid_provider_evidence$
    select public.service_finish_refund_gmail_outbound_reconciliation(
      (select (result ->> 'transportMessageId')::uuid from generic_unknown_claim),
      'manager-reply-provider-unknown',
      '<wrong-message-id@example.test>',
      (select attempt_version from generic_second_reconciliation_batch)
    )
  $generic_invalid_provider_evidence$,
  'P0001',
  'Confirmed Gmail outbound provider evidence required',
  'A generic uncertain reply cannot become sent with mismatched Message-ID evidence'
);
select is(
  public.service_finish_refund_gmail_outbound_reconciliation(
    (select (result ->> 'transportMessageId')::uuid from generic_unknown_claim),
    'manager-reply-provider-unknown',
    (select value from generic_unknown_provider_header),
    (select attempt_version from generic_second_reconciliation_batch)
  ),
  true,
  'Exact deterministic Message-ID evidence reconciles a delivery-unknown manager reply'
);
select ok(
  (
    select transport.status = 'sent'
      and transport.provider_message_id = 'manager-reply-provider-unknown'
      and case_message.status = 'sent'
    from public.refund_gmail_messages transport
    join public.refund_case_messages case_message on case_message.id = transport.refund_case_message_id
    where transport.id = (select (result ->> 'transportMessageId')::uuid from generic_unknown_claim)
  )
  and exists (
    select 1
    from public.refund_case_events event
    where event.refund_case_id = (
      select refund_case_id
      from public.refund_gmail_messages
      where id = (select (result ->> 'transportMessageId')::uuid from generic_unknown_claim)
    )
      and event.event_type = 'gmail_manager_reply_reconciled'
      and event.metadata ->> 'payload_redacted' = 'true'
  ),
  'Generic reconciliation updates the transport, canonical message, and redacted audit together'
);
select is(
  public.service_count_refund_gmail_outbound_reconciliation(),
  1,
  'Generic health drops only the reply with confirmed provider evidence'
);

select is(
  public.service_finish_refund_gmail_outbound_reconciliation(
    (select (result ->> 'transportMessageId')::uuid from generic_pending_claim),
    'manager-reply-provider-pending',
    (select value from generic_pending_provider_header),
    (select attempt_version from generic_first_reconciliation_batch)
  ),
  false,
  'A delayed positive manager-reply result cannot finalize after a newer lease claim'
);
select is(
  public.service_finish_refund_gmail_outbound_reconciliation(
    (select (result ->> 'transportMessageId')::uuid from generic_pending_claim),
    'manager-reply-provider-pending',
    (select value from generic_pending_provider_header),
    (select attempt_version from generic_lease_recovery_batch)
  ),
  true,
  'Exact deterministic evidence also resolves a stale pending reply after it becomes unknown'
);
select is(
  public.service_count_refund_gmail_outbound_reconciliation(),
  0,
  'Generic delivery health clears after every manager reply has deterministic evidence'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '79000000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select throws_ok(
  $unauthorized_human_resolution$
    select public.admin_resolve_refund_gmail_delivery_not_found(
      (select (result ->> 'refundCaseMessageId')::uuid from uncertain_claim)
    )
  $unauthorized_human_resolution$,
  'P0001',
  'Not authorized to resolve this Gmail delivery',
  'An authenticated user without case access cannot clear uncertain delivery'
);

reset role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', '', true);

set local role authenticated;
select set_config('request.jwt.claim.sub', '79000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select throws_ok(
  $positive_evidence_cannot_be_negated$
    select public.admin_resolve_refund_gmail_delivery_not_found(
      '79100000-0000-4000-8000-000000000002'::uuid
    )
  $positive_evidence_cannot_be_negated$,
  'P0001',
  'A delivery-unknown Gmail reply is required',
  'Human negative resolution cannot override a reply with confirmed positive evidence'
);
select is(
  (
    public.admin_resolve_refund_gmail_delivery_not_found(
      (select (result ->> 'refundCaseMessageId')::uuid from uncertain_claim)
    ) ->> 'resolved'
  )::boolean,
  true,
  'An authorized manager can verify non-delivery after automatic reconciliation checked once'
);

reset role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', '', true);

select ok(
  (
    select operation.status = 'failed'
      and operation.error_code = 'human_verified_not_delivered'
      and transport.status = 'failed'
      and case_message.status = 'failed'
      and case_message.error_message = 'A manager verified that no Gmail message was delivered. A controlled follow-up is now allowed.'
    from public.refund_gmail_first_contact_operations operation
    join public.refund_gmail_messages transport on transport.id = operation.transport_message_id
    join public.refund_case_messages case_message on case_message.id = operation.refund_case_message_id
    where operation.id = (select (result ->> 'operationId')::uuid from uncertain_claim)
  ),
  'Human verification atomically fails the uncertain transport and first-contact ledger with a safe code'
);
select ok(
  exists (
    select 1
    from public.refund_case_events event
    where event.refund_case_id = (
      select refund_case_id
      from public.refund_gmail_messages
      where id = (select (result ->> 'transportMessageId')::uuid from uncertain_claim)
    )
      and event.actor_user_id = '79000000-0000-4000-8000-000000000001'
      and event.event_type = 'gmail_delivery_verified_not_delivered'
      and event.metadata ->> 'payload_redacted' = 'true'
      and event.metadata ->> 'resolution' = 'verified_not_delivered'
  ),
  'The negative-delivery audit records the authorized actor and only redacted resolution metadata'
);
select is(
  public.service_count_refund_gmail_first_contact_reconciliation(),
  0,
  'A verified negative result clears first-contact reconciliation health without claiming delivery'
);

insert into public.refund_case_messages (
  id,
  refund_case_id,
  message_type,
  status,
  recipient_email,
  subject,
  body
)
select
  '79100000-0000-4000-8000-000000000003',
  source_message.refund_case_id,
  'status_update',
  'pending',
  'uncertain-customer@example.test',
  'Synthetic controlled follow-up',
  'Thank you for your patience while we continue reviewing your request.'
from public.refund_gmail_messages source_message
where source_message.id = (
  select (result ->> 'messageId')::uuid from uncertain_source
);

create temporary table controlled_follow_up_claim as
select public.service_claim_refund_gmail_outbound(
  source_message.refund_case_id,
  '79100000-0000-4000-8000-000000000003',
  'refund-case-message:79100000-0000-4000-8000-000000000003',
  'support@example.test',
  'uncertain-customer@example.test',
  'Thank you for your patience while we continue reviewing your request.'
) as result
from public.refund_gmail_messages source_message
where source_message.id = (
  select (result ->> 'messageId')::uuid from uncertain_source
);

select is(
  (select (result ->> 'claimed')::boolean from controlled_follow_up_claim),
  true,
  'Verified non-delivery permits one later controlled outbound in the original thread'
);
select is(
  public.service_finish_refund_gmail_outbound(
    (select (result ->> 'transportMessageId')::uuid from controlled_follow_up_claim),
    'sent',
    'controlled-follow-up-provider-message',
    '<controlled-follow-up-provider-message@example.test>',
    null
  ),
  true,
  'The controlled follow-up can complete through the normal provider-confirmed path'
);

create temporary table system_ingest as
select public.service_ingest_refund_gmail_message(
  repeat('a', 64),
  'first-contact-thread-system',
  'first-contact-message-system',
  '<first-contact-system@example.test>',
  null,
  'system',
  false,
  'automated@example.test',
  'Automated Sender',
  'support@example.test',
  'Synthetic automated response',
  'Synthetic automated content.',
  false,
  '2026-08-03 18:15:00+00'::timestamptz,
  null,
  '[]'::jsonb
) as result;

select is(
  (select (result ->> 'reason') from system_ingest),
  'unlinked_non_customer_message',
  'Automated or system mail cannot create a first-contact thread'
);
select is(
  (
    public.service_claim_refund_gmail_first_contact(
      '99999999-9999-4999-8999-999999999999'::uuid,
      'active',
      '2026-08-03 18:00:00+00'::timestamptz,
      'refund_first_contact_v1',
      'support@example.test',
      'Synthetic deterministic first-contact body.'
    ) ->> 'reason'
  ),
  'source_message_not_eligible',
  'Missing, outbound, bounce, or system source rows fail eligibility'
);
select is(
  (select count(*)::integer from public.refund_gmail_first_contact_operations),
  6,
  'Separate eligible threads each receive at most one shadow or send operation'
);

update public.refund_gmail_messages
set retention_expires_at = now() - interval '1 minute'
where id = (select (result ->> 'transportMessageId')::uuid from active_claim);

select is(
  public.service_purge_refund_gmail_expired_message_content(20),
  1,
  'Gmail retention purges the expired first-contact transport copy'
);
select ok(
  (
    select content_deleted_at is not null
      and recipient_email is null
      and plain_body = '[Deleted after Gmail retention period]'
    from public.refund_gmail_messages
    where id = (select (result ->> 'transportMessageId')::uuid from active_claim)
  )
  and (
    select recipient_email = '[Deleted after Gmail retention period]'
      and subject = '[Deleted after Gmail retention period]'
      and body = '[Deleted after Gmail retention period]'
    from public.refund_case_messages
    where id = (select (result ->> 'refundCaseMessageId')::uuid from active_claim)
  ),
  'Linked canonical customer copy is redacted with the Gmail retention boundary'
);

select * from finish();
rollback;
