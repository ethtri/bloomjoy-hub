begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  '92000000-0000-4000-8000-000000000001',
  'authenticated', 'authenticated', 'notice-manager@example.test', '', now(),
  '{}'::jsonb, '{}'::jsonb, now(), now()
);

insert into public.customer_accounts (id, name, account_type)
values ('92100000-0000-4000-8000-000000000001', 'Notification policy test', 'customer');

insert into public.reporting_locations (id, account_id, name, timezone)
values (
  '92200000-0000-4000-8000-000000000001',
  '92100000-0000-4000-8000-000000000001',
  'Synthetic notification location', 'America/Los_Angeles'
);

insert into public.reporting_machines (
  id, account_id, location_id, machine_label, refund_public_display_label
) values (
  '92300000-0000-4000-8000-000000000001',
  '92100000-0000-4000-8000-000000000001',
  '92200000-0000-4000-8000-000000000001',
  'Private synthetic machine', 'Lobby machine'
);

insert into public.reporting_machine_refund_managers (
  id, reporting_machine_id, manager_user_id, manager_email, grant_reason
) values (
  '92400000-0000-4000-8000-000000000001',
  '92300000-0000-4000-8000-000000000001',
  '92000000-0000-4000-8000-000000000001',
  'notice-manager@example.test', 'Synthetic notification test'
);

insert into public.refund_cases (
  id, public_reference, reporting_machine_id, reporting_location_id,
  customer_email, issue_summary, incident_at, payment_method,
  payment_amount_cents, card_last4, status, automation_state
) values (
  '92500000-0000-4000-8000-000000000001', 'RF-NOTICE-TEST',
  '92300000-0000-4000-8000-000000000001',
  '92200000-0000-4000-8000-000000000001',
  'notice-customer@example.test', 'Synthetic issue text.', now(), 'card',
  500, '4242', 'needs_review', 'under_review'
);

update public.refund_customer_contact_settings
set automatic_customer_contact_enabled = true,
    updated_at = statement_timestamp()
where singleton;

select is(
  public.service_authorize_refund_customer_outbound(
    '92500000-0000-4000-8000-000000000001',
    'notice-customer@example.test',
    array['mailbox@example.test'],
    'automatic'
  ) -> 'managerCcEmails',
  '[]'::jsonb,
  'routine automatic customer mail has no manager CC recipients'
);
select is(
  public.service_authorize_refund_customer_outbound(
    '92500000-0000-4000-8000-000000000001',
    'notice-customer@example.test',
    array['mailbox@example.test'],
    'automatic'
  ) ->> 'managerCopyPolicy',
  'automatic_portal_only',
  'automatic customer mail remains manager-visible only in the portal'
);
select is(
  (
    public.service_authorize_refund_customer_outbound(
      '92500000-0000-4000-8000-000000000001',
      'notice-customer@example.test',
      array['mailbox@example.test'],
      'automatic'
    ) ->> 'managerRecipientCount'
  )::integer,
  1,
  'automatic mail still requires a current mapped-manager authorization route'
);
select is(
  public.service_authorize_refund_customer_outbound(
    '92500000-0000-4000-8000-000000000001',
    'notice-customer@example.test',
    array['mailbox@example.test'],
    'manual'
  ) -> 'managerCcEmails',
  '["notice-manager@example.test"]'::jsonb,
  'manager-authored customer conversation retains the current manager CC route'
);

insert into public.refund_gmail_threads (
  id, refund_case_id, mailbox_hash, provider_thread_id, thread_subject,
  first_message_at, latest_message_at, retention_expires_at
) values (
  '92600000-0000-4000-8000-000000000001',
  '92500000-0000-4000-8000-000000000001', repeat('9', 64),
  'notification-policy-thread', 'Synthetic notification policy thread',
  statement_timestamp(), statement_timestamp(),
  statement_timestamp() + interval '30 days'
);

select lives_ok(
  $$
    insert into public.refund_gmail_messages (
      id, gmail_thread_id, refund_case_id, operation_key, direction,
      message_kind, status, sender_email, recipient_email, subject, plain_body,
      received_at, retention_expires_at, recipient_cc_emails,
      recipient_cc_count, recipient_resolution_status, delivery_kind,
      recipient_manager_overlap, recipient_manager_count
    ) values (
      '92700000-0000-4000-8000-000000000001',
      '92600000-0000-4000-8000-000000000001',
      '92500000-0000-4000-8000-000000000001',
      'notification-policy-automatic', 'outbound', 'message', 'pending_send',
      'mailbox@example.test', 'notice-customer@example.test',
      'Synthetic automatic portal-only update', 'Synthetic body.',
      statement_timestamp(), statement_timestamp() + interval '30 days',
      '{}'::text[], 0, 'resolved', 'automatic', false, 1
    )
  $$,
  'resolved automatic portal-only Gmail evidence stores manager authorization without manager CC'
);

set local session_replication_role = replica;
select throws_ok(
  $$
    insert into public.refund_gmail_messages (
      id, gmail_thread_id, refund_case_id, operation_key, direction,
      message_kind, status, sender_email, recipient_email, subject, plain_body,
      received_at, retention_expires_at, recipient_cc_emails,
      recipient_cc_count, recipient_resolution_status, delivery_kind,
      recipient_manager_overlap, recipient_manager_count
    ) values (
      '92700000-0000-4000-8000-000000000003',
      '92600000-0000-4000-8000-000000000001',
      '92500000-0000-4000-8000-000000000001',
      'notification-policy-count-mismatch', 'outbound', 'message', 'pending_send',
      'mailbox@example.test', 'notice-customer@example.test',
      'Synthetic invalid count mismatch', 'Synthetic body.',
      statement_timestamp(), statement_timestamp() + interval '30 days',
      array['notice-manager@example.test'], 0, 'resolved', 'automatic', false, 1
    )
  $$,
  '23514', null,
  'resolved Gmail evidence rejects a CC array and count mismatch'
);
select throws_ok(
  $$
    insert into public.refund_gmail_messages (
      id, gmail_thread_id, refund_case_id, operation_key, direction,
      message_kind, status, sender_email, recipient_email, subject, plain_body,
      received_at, retention_expires_at, recipient_cc_emails,
      recipient_cc_count, recipient_resolution_status, delivery_kind,
      recipient_manager_overlap, recipient_manager_count
    ) values (
      '92700000-0000-4000-8000-000000000002',
      '92600000-0000-4000-8000-000000000001',
      '92500000-0000-4000-8000-000000000001',
      'notification-policy-manual', 'outbound', 'message', 'pending_send',
      'mailbox@example.test', 'notice-customer@example.test',
      'Synthetic invalid manual update', 'Synthetic body.',
      statement_timestamp(), statement_timestamp() + interval '30 days',
      '{}'::text[], 0, 'resolved', 'manual', false, 1
    )
  $$,
  '23514', null,
  'manual Gmail evidence cannot use the automatic no-manager-CC shape'
);
select throws_ok(
  $$
    insert into public.refund_gmail_messages (
      id, gmail_thread_id, refund_case_id, operation_key, direction,
      message_kind, status, sender_email, recipient_email, subject, plain_body,
      received_at, retention_expires_at, recipient_cc_emails,
      recipient_cc_count, recipient_resolution_status, delivery_kind,
      recipient_manager_overlap, recipient_manager_count
    ) values (
      '92700000-0000-4000-8000-000000000004',
      '92600000-0000-4000-8000-000000000001',
      '92500000-0000-4000-8000-000000000001',
      'notification-policy-manual-zero', 'outbound', 'message', 'pending_send',
      'mailbox@example.test', 'notice-customer@example.test',
      'Synthetic invalid zero-manager manual update', 'Synthetic body.',
      statement_timestamp(), statement_timestamp() + interval '30 days',
      '{}'::text[], 0, 'resolved', 'manual', false, 0
    )
  $$,
  '23514', null,
  'resolved manual Gmail evidence cannot use the legacy zero-manager shape'
);
set local session_replication_role = origin;

select has_table('public', 'refund_manager_notification_actions', 'notification actions are durable');
select has_table('public', 'refund_manager_notification_recipients', 'recipient dedupe is durable');
select ok(not has_table_privilege('authenticated', 'public.refund_manager_notification_actions', 'select'), 'browser cannot read notification actions');
select ok(not has_function_privilege('authenticated', 'public.service_begin_refund_manager_notification(uuid,text,text,text[],text[])', 'execute'), 'browser cannot reserve notifications');
select ok(not has_function_privilege('authenticated', 'public.service_mark_refund_manager_notification_provider_started(uuid,uuid)', 'execute'), 'browser cannot mark provider access');

select is(
  public.service_begin_refund_manager_notification(
    '92500000-0000-4000-8000-000000000001', 'intake_created',
    'notice-customer@example.test', array['mailbox@example.test'],
    array['ops@example.test']
  ) ->> 'channel',
  'portal_only',
  'intake is portal-only'
);

select is(
  public.service_begin_refund_manager_notification(
    '92500000-0000-4000-8000-000000000001', 'intake_created',
    'notice-customer@example.test', array['mailbox@example.test'],
    array['ops@example.test']
  ) ->> 'reason',
  'duplicate_coalesced',
  'intake replay coalesces'
);

create temporary table customer_reply_claim as
select public.service_begin_refund_manager_notification(
  '92500000-0000-4000-8000-000000000001', 'hard_bounce',
  'notice-customer@example.test', array['mailbox@example.test'],
  array['ops@example.test']
) as value;

select is(
  (select value ->> 'channel' from customer_reply_claim),
  'immediate',
  'urgent delivery exceptions remain immediate after the digest consumer is deployed'
);

update public.refund_manager_notification_actions
set updated_at = statement_timestamp() - interval '11 minutes'
where id = (select (value ->> 'actionId')::uuid from customer_reply_claim);

create temporary table reclaimed_customer_reply as
select public.service_begin_refund_manager_notification(
  '92500000-0000-4000-8000-000000000001', 'hard_bounce',
  'notice-customer@example.test', array['mailbox@example.test'],
  array['ops@example.test']
) as value;

select is(
  (select (value ->> 'claimed')::boolean from reclaimed_customer_reply),
  true,
  'a stale reservation with no provider-start marker is safely reclaimed'
);
select is(
  (
    select attempt_count
    from public.refund_manager_notification_actions
    where id = (select (value ->> 'actionId')::uuid from reclaimed_customer_reply)
  ),
  2,
  'safe pre-provider reservation recovery is bounded and counted'
);
select is(
  public.service_mark_refund_manager_notification_provider_started(
    (select (value ->> 'actionId')::uuid from reclaimed_customer_reply),
    (select (value ->> 'claimToken')::uuid from reclaimed_customer_reply)
  ),
  true,
  'the provider boundary becomes delivery-unknown before provider access'
);
select is(
  (
    public.service_begin_refund_manager_notification(
      '92500000-0000-4000-8000-000000000001', 'hard_bounce',
      'notice-customer@example.test', array['mailbox@example.test'],
      array['ops@example.test']
    ) ->> 'claimed'
  )::boolean,
  false,
  'provider-started uncertainty is never reclaimed or blindly resent'
);
select is(
  (
    select delivery_state
    from public.refund_manager_notification_actions
    where id = (select (value ->> 'actionId')::uuid from reclaimed_customer_reply)
  ),
  'delivery_unknown',
  'provider-started crash evidence remains visible for review'
);

create temporary table notification_claim as
select public.service_begin_refund_manager_notification(
  '92500000-0000-4000-8000-000000000001', 'wallet_match_ready',
  'notice-customer@example.test', array['mailbox@example.test'],
  array['ops@example.test']
) as value;

select is((select (value ->> 'claimed')::boolean from notification_claim), true, 'action-ready notice is reserved once');
select is((select value #>> '{recipientRoute,recipients,0}' from notification_claim), 'notice-manager@example.test', 'current manager is resolved at reservation time');

select is(
  (public.service_begin_refund_manager_notification(
    '92500000-0000-4000-8000-000000000001', 'wallet_match_ready',
    'notice-customer@example.test', array['mailbox@example.test'],
    array['ops@example.test']
  ) ->> 'claimed')::boolean,
  false,
  'concurrent or replayed action-ready work cannot send twice'
);

select is(
  public.service_mark_refund_manager_notification_provider_started(
    (select (value ->> 'actionId')::uuid from notification_claim),
    (select (value ->> 'claimToken')::uuid from notification_claim)
  ),
  true,
  'winning reservation marks provider access before delivery'
);

select is(
  public.service_complete_refund_manager_notification(
    (select (value ->> 'actionId')::uuid from notification_claim),
    (select (value ->> 'claimToken')::uuid from notification_claim),
    'sent', 'synthetic-provider-message-id'
  ),
  true,
  'winning reservation settles once'
);

select is(
  (select delivery_state from public.refund_manager_notification_actions where notice_reason = 'wallet_match_ready'),
  'sent',
  'settlement is retained'
);
select ok(
  not exists (
    select 1 from public.refund_manager_notification_actions
    where row_to_json(refund_manager_notification_actions)::text like '%notice-manager@example.test%'
       or row_to_json(refund_manager_notification_actions)::text like '%synthetic-provider-message-id%'
  ),
  'notification ledger stores neither recipient address nor provider id'
);
select is(
  (select count(*)::integer from public.refund_manager_notification_recipients where delivery_state = 'sent'),
  1,
  'per-recipient delivery is settled without storing the address'
);

select is(
  public.service_begin_refund_manager_notification(
    '92500000-0000-4000-8000-000000000001',
    'manager_reminder', 'notice-customer@example.test',
    array['mailbox@example.test'], array['ops@example.test']
  ) ->> 'channel',
  'daily_digest',
  'two-business-day reminder is eligible for the quiet daily digest'
);

select * from finish();
rollback;
