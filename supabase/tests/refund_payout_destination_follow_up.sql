begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(54);

create function pg_temp.capture_error(statement text)
returns text language plpgsql as $$
begin
  execute statement;
  return null;
exception when others then
  return sqlstate || ':' || sqlerrm;
end;
$$;

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  'c1000000-0000-4000-8000-000000000001',
  'authenticated', 'authenticated', 'payout-manager@example.invalid', '', now(),
  '{}'::jsonb, '{}'::jsonb, now(), now()
);

insert into public.admin_roles (user_id, role, active)
values ('c1000000-0000-4000-8000-000000000001', 'super_admin', true);

insert into public.customer_accounts (id, name, account_type)
values ('c1100000-0000-4000-8000-000000000001', 'Payout follow-up fixture', 'internal');

insert into public.reporting_locations (id, account_id, name, timezone)
values (
  'c1200000-0000-4000-8000-000000000001',
  'c1100000-0000-4000-8000-000000000001',
  'Payout follow-up location', 'America/Los_Angeles'
);

insert into public.reporting_machines (
  id, account_id, location_id, machine_label, status
) values (
  'c1300000-0000-4000-8000-000000000001',
  'c1100000-0000-4000-8000-000000000001',
  'c1200000-0000-4000-8000-000000000001',
  'Payout follow-up machine', 'active'
);

insert into public.reporting_machine_refund_managers (
  reporting_machine_id, manager_user_id, manager_email, grant_reason
) values (
  'c1300000-0000-4000-8000-000000000001',
  'c1000000-0000-4000-8000-000000000001',
  'payout-manager@example.invalid',
  'Payout follow-up fixture'
);

insert into public.refund_cases (
  id, public_reference, reporting_machine_id, reporting_location_id,
  customer_email, issue_summary, incident_at, incident_timezone,
  incident_time_resolution, payment_method, payment_amount_cents,
  refund_amount_cents, status, decision, decided_by, decided_at,
  correlation_status, correlation_source, automation_state, intake_source
) values (
  'c1400000-0000-4000-8000-000000000001',
  'RF-PAYOUT-TEST',
  'c1300000-0000-4000-8000-000000000001',
  'c1200000-0000-4000-8000-000000000001',
  'payout-customer@example.invalid',
  'Approved cash reimbursement awaiting one protected destination',
  statement_timestamp() - interval '2 hours',
  'America/Los_Angeles', 'exact', 'cash', 800, 800,
  'cash_zelle_pending', 'approved',
  'c1000000-0000-4000-8000-000000000001', statement_timestamp(),
  'manual_review', 'manual', 'approved', 'form'
);

select is(
  public.canonical_refund_follow_up_fields(array[
    'zelle_payment_contact', 'incident_time', 'zelle_payment_contact'
  ]),
  array['incident_time', 'zelle_payment_contact']::text[],
  'Payout destination is canonical, ordered, and deduplicated'
);

insert into public.refund_case_messages (
  id, refund_case_id, message_type, status, recipient_email, subject, body,
  template_key, created_by, content_source, delivery_kind, reason_code,
  requested_fields, sent_at, created_at
) values (
  'c1450000-0000-4000-8000-000000000001',
  'c1400000-0000-4000-8000-000000000001',
  'more_info', 'sent', 'payout-customer@example.invalid',
  'Earlier payout destination request',
  'Zelle email or phone number:',
  'refund_more_info_editable_v1',
  'c1000000-0000-4000-8000-000000000001',
  'manager_authored', 'manual', 'missing_information',
  array['zelle_payment_contact']::text[],
  statement_timestamp() - interval '3 hours',
  statement_timestamp() - interval '3 hours'
);

set local role service_role;
select is(
  public.service_enqueue_refund_manual_message_intent(
    'c1400000-0000-4000-8000-000000000001',
    (select official_action_version from public.refund_cases
      where id = 'c1400000-0000-4000-8000-000000000001'),
    'c1500000-0000-4000-8000-000000000001',
    'c1000000-0000-4000-8000-000000000001',
    'more_info', 'payout-customer@example.invalid',
    'Your approved Bloomjoy reimbursement needs one detail',
    'Reply with only the Zelle email or phone number requested.',
    'refund_more_info_editable_v1', 'manager_authored',
    'missing_information', array['zelle_payment_contact']::text[],
    null, false, null
  ) ->> 'enqueued',
  'true',
  'An eligible approved cash case queues one protected payout request'
);

select ok(
  pg_temp.capture_error($$select public.service_enqueue_refund_manual_message_intent(
    'c1400000-0000-4000-8000-000000000001',
    (select official_action_version from public.refund_cases
      where id = 'c1400000-0000-4000-8000-000000000001'),
    'c1500000-0000-4000-8000-000000000002',
    'c1000000-0000-4000-8000-000000000001',
    'more_info', 'payout-customer@example.invalid',
    'Unsafe mixed request', 'Unsafe mixed request',
    'refund_more_info_editable_v1', 'manager_authored',
    'missing_information',
    array['incident_time','zelle_payment_contact']::text[],
    null, false, null
  )$$) like 'P4655:%',
  'Payout destination cannot be mixed with repeated purchase-detail work'
);

create temp table payout_claim as
select * from public.service_claim_refund_manual_message_deliveries(
  (select id from public.refund_case_messages
   where manual_delivery_intent_id = 'c1500000-0000-4000-8000-000000000001'),
  1
);

select public.service_mark_refund_manual_message_provider_attempt(
  (select refund_case_message_id from payout_claim),
  (select claim_token from payout_claim)
);

select is(
  public.service_finish_refund_manual_message_delivery(
    (select refund_case_message_id from payout_claim),
    (select claim_token from payout_claim),
    'sent', 'gmail_thread', null, 1, 'mapped_manager'
  ) ->> 'outcome',
  'sent',
  'The exact queued payout request records one successful Gmail-thread send'
);
reset role;

select ok(
  (select status = 'waiting_on_customer'
      and automation_state = 'more_info_needed'
   from public.refund_cases
   where id = 'c1400000-0000-4000-8000-000000000001'),
  'Only the successful durable send advances the case to customer wait'
);

select ok(
  (select status = 'waiting'
      and reminder_due_at is not null
      and request_message_id = (select refund_case_message_id from payout_claim)
   from public.refund_payout_destination_follow_ups
   where refund_case_id = 'c1400000-0000-4000-8000-000000000001'),
  'The sent payout request starts one bounded reminder window'
);

select is(
  public.refund_customer_action_contract(
    'c1400000-0000-4000-8000-000000000001'
  ) -> 'requestedFields',
  '["zelle_payment_contact"]'::jsonb,
  'Lifecycle exposes the exact outstanding payout field from the sent ledger'
);

insert into public.refund_gmail_threads (
  id, refund_case_id, mailbox_hash, provider_thread_id, thread_subject,
  first_message_at, latest_message_at, retention_expires_at
) values (
  'c1600000-0000-4000-8000-000000000001',
  'c1400000-0000-4000-8000-000000000001',
  repeat('c', 64), 'payout-follow-up-thread', 'Payout destination reply',
  statement_timestamp(), statement_timestamp(),
  statement_timestamp() + interval '30 days'
);

insert into public.refund_gmail_messages (
  id, gmail_thread_id, refund_case_id, refund_case_message_id,
  provider_message_id, provider_message_header, operation_key,
  direction, message_kind, status, sender_email, recipient_email,
  recipient_cc_emails, recipient_cc_count, recipient_resolution_status,
  delivery_kind, participant_role, participant_trust, subject, plain_body,
  received_at, sent_at, retention_expires_at
) select
  'c1650000-0000-4000-8000-000000000001',
  'c1600000-0000-4000-8000-000000000001',
  'c1400000-0000-4000-8000-000000000001', message.id,
  'payout-request-provider-1', '<payout-request-1@example.invalid>',
  'payout-request-operation-1', 'outbound', 'message', 'sent',
  'refunds@example.invalid', 'payout-customer@example.invalid',
  array['payout-manager@example.invalid'], 1, 'resolved', 'manual',
  'mailbox', 'verified', message.subject, message.body,
  message.sent_at, message.sent_at, statement_timestamp() + interval '30 days'
from public.refund_case_messages message
where message.manual_delivery_intent_id = 'c1500000-0000-4000-8000-000000000001';

insert into public.refund_cases (
  id, public_reference, reporting_machine_id, reporting_location_id,
  customer_email, issue_summary, incident_at, incident_timezone,
  incident_time_resolution, payment_method, payment_amount_cents,
  refund_amount_cents, status, decision, decided_by, decided_at,
  correlation_status, correlation_source, automation_state, intake_source
) values (
  'c1400000-0000-4000-8000-000000000002',
  'RF-PAYOUT-OFF',
  'c1300000-0000-4000-8000-000000000001',
  'c1200000-0000-4000-8000-000000000001',
  'payout-disabled@example.invalid',
  'Approved cash reimbursement with contact disabled',
  statement_timestamp() - interval '2 hours',
  'America/Los_Angeles', 'exact', 'cash', 900, 900,
  'cash_zelle_pending', 'approved',
  'c1000000-0000-4000-8000-000000000001', statement_timestamp(),
  'manual_review', 'manual', 'approved', 'form'
);

set local role service_role;
select public.service_enqueue_refund_manual_message_intent(
  'c1400000-0000-4000-8000-000000000002',
  (select official_action_version from public.refund_cases
    where id = 'c1400000-0000-4000-8000-000000000002'),
  'c1500000-0000-4000-8000-000000000003',
  'c1000000-0000-4000-8000-000000000001',
  'more_info', 'payout-disabled@example.invalid',
  'Your approved Bloomjoy reimbursement needs one detail',
  'Zelle email or phone number:',
  'refund_more_info_editable_v1', 'manager_authored',
  'missing_information', array['zelle_payment_contact']::text[],
  null, false, null
);
create temp table payout_disabled_claim as
select * from public.service_claim_refund_manual_message_deliveries(
  (select id from public.refund_case_messages
   where manual_delivery_intent_id = 'c1500000-0000-4000-8000-000000000003'),
  1
);
select public.service_mark_refund_manual_message_provider_attempt(
  (select refund_case_message_id from payout_disabled_claim),
  (select claim_token from payout_disabled_claim)
);
select public.service_finish_refund_manual_message_delivery(
  (select refund_case_message_id from payout_disabled_claim),
  (select claim_token from payout_disabled_claim),
  'sent', 'transactional_email', null, 1, 'mapped_manager'
);
reset role;

update public.refund_payout_destination_follow_ups
set reminder_due_at = statement_timestamp() - interval '1 minute'
where refund_case_id = 'c1400000-0000-4000-8000-000000000002';

set local role service_role;
create temp table payout_disabled_sweep as
select public.service_claim_due_refund_payout_destination_follow_ups(10, false) as result;
select is(
  (select result ->> 'contactDisabledToReview' from payout_disabled_sweep),
  '1',
  'A due payout request returns to manager review when contact is disabled'
);
reset role;

select ok(
  (select status = 'manual_review' and reminder_message_id is null
   from public.refund_payout_destination_follow_ups
   where refund_case_id = 'c1400000-0000-4000-8000-000000000002')
  and (select status = 'needs_review' and automation_follow_up_due_at is null
       from public.refund_cases
       where id = 'c1400000-0000-4000-8000-000000000002'),
  'The disabled-contact branch sends no reminder and cannot remain Waiting'
);

select is(
  (select count(*)::integer
   from public.refund_case_nayax_refund_attempts
   where refund_case_id = 'c1400000-0000-4000-8000-000000000002'),
  0,
  'Disabled-contact cleanup is payment-inert'
);

update public.refund_customer_contact_settings
set automatic_customer_contact_enabled = true;

insert into public.refund_cases (
  id, public_reference, reporting_machine_id, reporting_location_id,
  customer_email, issue_summary, incident_at, incident_timezone,
  incident_time_resolution, payment_method, payment_amount_cents,
  refund_amount_cents, status, decision, decided_by, decided_at,
  correlation_status, correlation_source, automation_state, intake_source
) values (
  'c1400000-0000-4000-8000-000000000004', 'RF-PAYOUT-PAUSED',
  'c1300000-0000-4000-8000-000000000001',
  'c1200000-0000-4000-8000-000000000001',
  'payout-paused@example.invalid', 'Paused payout thread fixture',
  statement_timestamp() - interval '2 hours', 'America/Los_Angeles', 'exact',
  'cash', 1000, 1000, 'waiting_on_customer', 'approved',
  'c1000000-0000-4000-8000-000000000001', statement_timestamp(),
  'manual_review', 'manual', 'more_info_needed', 'form'
);
insert into public.refund_case_messages (
  id, refund_case_id, message_type, status, recipient_email, subject, body,
  template_key, created_by, content_source, delivery_kind, reason_code,
  requested_fields, sent_at, created_at
) values (
  'c1450000-0000-4000-8000-000000000004',
  'c1400000-0000-4000-8000-000000000004', 'more_info', 'sent',
  'payout-paused@example.invalid', 'Payout destination request',
  'Zelle email or phone number:', 'refund_more_info_editable_v1',
  'c1000000-0000-4000-8000-000000000001', 'manager_authored', 'manual',
  'missing_information', array['zelle_payment_contact']::text[],
  statement_timestamp() - interval '2 hours', statement_timestamp() - interval '2 hours'
);
insert into public.refund_payout_destination_follow_ups (
  refund_case_id, request_message_id, reminder_delay_hours, reminder_due_at
) values (
  'c1400000-0000-4000-8000-000000000004',
  'c1450000-0000-4000-8000-000000000004', 48,
  statement_timestamp() - interval '1 minute'
);
insert into public.refund_gmail_threads (
  id, refund_case_id, mailbox_hash, provider_thread_id, thread_subject,
  first_message_at, latest_message_at, retention_expires_at,
  automatic_customer_contact_paused_at, automatic_customer_contact_pause_reason
) values (
  'c1600000-0000-4000-8000-000000000004',
  'c1400000-0000-4000-8000-000000000004', repeat('e', 64),
  'paused-payout-thread', 'Paused payout destination thread',
  statement_timestamp() - interval '2 hours', statement_timestamp(),
  statement_timestamp() + interval '30 days', statement_timestamp(), 'hard_bounce'
);

set local role service_role;
create temp table payout_paused_sweep as
select public.service_claim_due_refund_payout_destination_follow_ups(10, true) as result;
select is(
  (select result ->> 'pausedThreadToReview' from payout_paused_sweep),
  '1',
  'A paused customer thread returns the due payout request to manager review'
);
reset role;
select ok(
  (select status = 'manual_review' and reminder_message_id is null
   from public.refund_payout_destination_follow_ups
   where refund_case_id = 'c1400000-0000-4000-8000-000000000004')
  and (select status = 'needs_review' and automation_follow_up_due_at is null
       from public.refund_cases
       where id = 'c1400000-0000-4000-8000-000000000004'),
  'The paused-thread branch sends no reminder and cannot remain Waiting'
);
select is(
  (select count(*)::integer from public.refund_case_messages
   where refund_case_id = 'c1400000-0000-4000-8000-000000000004'
     and message_type = 'reminder'),
  0,
  'Paused-thread cleanup creates no reminder ledger intent'
);
select is(
  (select count(*)::integer from public.refund_case_nayax_refund_attempts
   where refund_case_id = 'c1400000-0000-4000-8000-000000000004'),
  0,
  'Paused-thread cleanup is payment-inert'
);

update public.refund_payout_destination_follow_ups
set reminder_due_at = statement_timestamp() - interval '1 minute'
where refund_case_id = 'c1400000-0000-4000-8000-000000000001';

set local role service_role;
create temp table payout_reminder_claim as
select public.service_claim_due_refund_payout_destination_follow_ups(1) as result;
select is(
  (select result #>> '{reminders,0,requestedFields,0}' from payout_reminder_claim),
  'zelle_payment_contact',
  'The only automated reminder claim is the protected payout field'
);

create temp table payout_reminder_message as
select public.service_create_refund_payout_destination_reminder_message(
  (select (result #>> '{reminders,0,followUpId}')::uuid from payout_reminder_claim),
  (select (result #>> '{reminders,0,claimToken}')::uuid from payout_reminder_claim),
  'Reminder: your approved reimbursement needs one detail',
  'Zelle email or phone number:'
) as result;
select is(
  (select result ->> 'created' from payout_reminder_message),
  'true',
  'The reminder creates one durable deterministic ledger intent before delivery'
);
reset role;

insert into public.refund_gmail_messages (
  id, gmail_thread_id, refund_case_id, refund_case_message_id,
  provider_message_id, provider_message_header, operation_key,
  direction, message_kind, status, sender_email, recipient_email,
  recipient_cc_emails, recipient_cc_count, recipient_resolution_status,
  delivery_kind, participant_role, participant_trust, subject, plain_body,
  received_at, sent_at, retention_expires_at
) select
  'c1650000-0000-4000-8000-000000000002',
  'c1600000-0000-4000-8000-000000000001',
  'c1400000-0000-4000-8000-000000000001',
  (result ->> 'messageId')::uuid,
  'payout-reminder-provider-1', '<payout-reminder-1@example.invalid>',
  'payout-reminder-operation-1', 'outbound', 'message', 'sent',
  'refunds@example.invalid', 'payout-customer@example.invalid',
  array['payout-manager@example.invalid'], 1, 'resolved', 'automatic',
  'mailbox', 'verified', 'Payout destination reminder',
  'Zelle email or phone number:', statement_timestamp(), statement_timestamp(),
  statement_timestamp() + interval '30 days'
from payout_reminder_message;

update public.refund_case_messages
set status = 'sent', sent_at = statement_timestamp()
where id = (select (result ->> 'messageId')::uuid from payout_reminder_message);

select ok(
  (select message.status = 'sent'
      and message.subject = 'Reminder: your approved reimbursement needs one detail'
      and gmail.subject = 'Payout destination reminder'
   from public.refund_case_messages message
   join public.refund_gmail_messages gmail
     on gmail.refund_case_message_id = message.id
   where message.id = (select (result ->> 'messageId')::uuid from payout_reminder_message)),
  'Gmail thread subject remains transport evidence without mutating the sent reminder intent'
);

select ok(
  (select status = 'reminder_sent'
      and reminder_sent_at is not null
      and escalation_due_at is not null
   from public.refund_payout_destination_follow_ups
   where refund_case_id = 'c1400000-0000-4000-8000-000000000001'),
  'One sent reminder starts the final bounded response window'
);

update public.refund_payout_destination_follow_ups
set escalation_due_at = statement_timestamp() - interval '1 minute'
where refund_case_id = 'c1400000-0000-4000-8000-000000000001';
set local role service_role;
select is(
  public.service_claim_due_refund_payout_destination_follow_ups(1) ->> 'escalated',
  '1',
  'An unanswered reminder exits Waiting and returns the case to manager review'
);
reset role;

select ok(
  (select status = 'manual_review'
   from public.refund_payout_destination_follow_ups
   where refund_case_id = 'c1400000-0000-4000-8000-000000000001')
  and (public.refund_customer_action_contract(
    'c1400000-0000-4000-8000-000000000001'
  ) ->> 'valid') = 'false',
  'Contact exhaustion clears the stale customer action and preserves manager ownership'
);

set local role service_role;
select ok(
  pg_temp.capture_error($$select public.service_enqueue_refund_manual_message_intent(
    'c1400000-0000-4000-8000-000000000001',
    (select official_action_version from public.refund_cases
      where id = 'c1400000-0000-4000-8000-000000000001'),
    'c1500000-0000-4000-8000-000000000005',
    'c1000000-0000-4000-8000-000000000001',
    'more_info', 'payout-customer@example.invalid',
    'Second payout request', 'Zelle email or phone number:',
    'refund_more_info_editable_v1', 'manager_authored',
    'missing_information', array['zelle_payment_contact']::text[],
    null, false, null
  )$$) like 'P4662:%'
  and (select status = 'manual_review' and reminder_message_id is not null
       from public.refund_payout_destination_follow_ups
       where refund_case_id = 'c1400000-0000-4000-8000-000000000001')
  and not exists (
    select 1 from public.refund_case_messages
    where manual_delivery_intent_id = 'c1500000-0000-4000-8000-000000000005'
  ),
  'Post-exhaustion recovery cannot send a second request into a dead reminder ledger'
);
reset role;

insert into public.refund_gmail_threads (
  id, refund_case_id, mailbox_hash, provider_thread_id, thread_subject,
  first_message_at, latest_message_at, retention_expires_at
) values (
  'c1600000-0000-4000-8000-000000000002',
  'c1400000-0000-4000-8000-000000000001',
  repeat('d', 64), 'wrong-payout-follow-up-thread', 'Unrelated reply',
  statement_timestamp(), statement_timestamp(),
  statement_timestamp() + interval '30 days'
);

insert into public.refund_gmail_messages (
  id, gmail_thread_id, refund_case_id, provider_message_id, direction,
  message_kind, status, sender_email, recipient_email, participant_role,
  participant_trust, subject, plain_body, received_at, retention_expires_at
) values (
  'c1700000-0000-4000-8000-000000000002',
  'c1600000-0000-4000-8000-000000000002',
  'c1400000-0000-4000-8000-000000000001',
  'payout-follow-up-wrong-thread', 'inbound', 'message', 'received',
  'payout-customer@example.invalid', 'refunds@example.invalid',
  'customer', 'verified', 'Unrelated Zelle detail',
  'Zelle email or phone number: wrong-thread@example.invalid',
  statement_timestamp(), statement_timestamp() + interval '30 days'
);

select ok(
  pg_temp.capture_error($$update public.refund_case_messages
    set body = 'Tampered payout request'
    where manual_delivery_intent_id =
      'c1500000-0000-4000-8000-000000000001'$$)
      like '23514:Protected payout request content and identity are immutable%'
  and pg_temp.capture_error($$update public.refund_case_messages
    set recipient_email = 'other-customer@example.invalid'
    where manual_delivery_intent_id =
      'c1500000-0000-4000-8000-000000000001'$$)
      like '23514:Protected payout-destination message is not eligible%'
  and pg_temp.capture_error($$update public.refund_case_messages
    set requested_fields_satisfied_by_gmail_message_id =
          'c1700000-0000-4000-8000-000000000002',
        requested_fields_satisfied_at = statement_timestamp()
    where manual_delivery_intent_id =
      'c1500000-0000-4000-8000-000000000001'$$)
      like '23514:Protected payout request satisfaction evidence is invalid%',
  'Payout request content, recipient, and satisfaction proof are immutable without the exact verified reply'
);

set local role service_role;
select is(
  public.service_apply_refund_gmail_customer_facts_v1(
    'c1400000-0000-4000-8000-000000000001',
    'c1700000-0000-4000-8000-000000000002', 1,
    '{"zelle_payment_contact":"wrong-thread@example.invalid"}'::jsonb,
    array['zelle_payment_contact']::text[], 'labeled_routine_facts_v1'
  ) ->> 'reason',
  'payout_destination_reply_thread_mismatch',
  'A verified customer message on another thread cannot satisfy the request'
);
reset role;

insert into public.refund_gmail_messages (
  id, gmail_thread_id, refund_case_id, provider_message_id, direction,
  message_kind, status, sender_email, recipient_email, participant_role,
  participant_trust, subject, plain_body, received_at, retention_expires_at
) values (
  'c1700000-0000-4000-8000-000000000001',
  'c1600000-0000-4000-8000-000000000001',
  'c1400000-0000-4000-8000-000000000001',
  'payout-follow-up-reply-1', 'inbound', 'message', 'received',
  'payout-customer@example.invalid', 'refunds@example.invalid',
  'customer', 'verified', 'Re: payout destination',
  'Zelle email or phone number: payout-customer@example.invalid',
  statement_timestamp(), statement_timestamp() + interval '30 days'
);

set local role service_role;
select is(
  public.service_apply_refund_gmail_customer_facts_v1(
    'c1400000-0000-4000-8000-000000000001',
    'c1700000-0000-4000-8000-000000000001',
    1,
    '{"zelle_payment_contact":"payout-customer@example.invalid"}'::jsonb,
    array['zelle_payment_contact']::text[],
    'labeled_routine_facts_v1'
  ) ->> 'outcome',
  'applied',
  'A verified same-thread reply applies the protected destination once'
);
reset role;

select ok(
  (select zelle_payment_contact = 'payout-customer@example.invalid'
      and deterministic_fact_version = 2
      and status = 'needs_review'
   from public.refund_cases
   where id = 'c1400000-0000-4000-8000-000000000001'),
  'The reply persists the payout destination and advances one fact version'
);

select ok(
  (select requested_fields_satisfied_by_gmail_message_id =
      'c1700000-0000-4000-8000-000000000001'
      and requested_fields_satisfied_at is not null
   from public.refund_case_messages
   where manual_delivery_intent_id = 'c1500000-0000-4000-8000-000000000001'),
  'The exact outbound request records the same-case reply that satisfied it'
);

select is(
  public.refund_customer_action_contract(
    'c1400000-0000-4000-8000-000000000001'
  ) ->> 'valid',
  'false',
  'The satisfied payout request cannot remain a stale customer action'
);

select set_config('request.jwt.claim.sub', 'c1000000-0000-4000-8000-000000000001', true);
select ok(
  (public.refund_lifecycle_contract(
    'c1400000-0000-4000-8000-000000000001'
  ) #>> '{managerAction,action}') = 'mark_external_refund'
  and (public.refund_lifecycle_contract(
    'c1400000-0000-4000-8000-000000000001'
  ) ->> 'reasonCode') = 'external_payment_ready',
  'The manager queue becomes payout-ready immediately after the verified reply'
);

set local role service_role;
select is(
  public.service_apply_refund_gmail_customer_facts_v1(
    'c1400000-0000-4000-8000-000000000001',
    'c1700000-0000-4000-8000-000000000001',
    1,
    '{"zelle_payment_contact":"payout-customer@example.invalid"}'::jsonb,
    array['zelle_payment_contact']::text[],
    'labeled_routine_facts_v1'
  ) ->> 'outcome',
  'already_applied',
  'Replaying the same Gmail reply is idempotent'
);
reset role;

select ok(
  (select count(*) = 1
   from public.refund_customer_fact_applications
   where gmail_message_id = 'c1700000-0000-4000-8000-000000000001')
  and (select count(*) = 1
       from public.refund_case_events
       where refund_case_id = 'c1400000-0000-4000-8000-000000000001'
         and event_type = 'gmail_customer_facts_applied'
         and metadata ->> 'payload_redacted' = 'true'
         and metadata::text not like '%payout-customer@example.invalid%'),
  'Reply replay creates one private application and one redacted event'
);

select is(
  (select count(*)::integer
   from public.refund_case_nayax_refund_attempts
   where refund_case_id = 'c1400000-0000-4000-8000-000000000001'),
  0,
  'Request, reply, and payout readiness create no provider or payment attempt'
);

-- Exercise the actual transactional reminder path, including receipts arriving
-- after the send phase, a closed contact gate, and later payment completion.
insert into public.refund_cases (
  id, public_reference, reporting_machine_id, reporting_location_id,
  customer_email, issue_summary, incident_at, incident_timezone,
  incident_time_resolution, payment_method, payment_amount_cents,
  refund_amount_cents, status, decision, decided_by, decided_at,
  correlation_status, correlation_source, automation_state, intake_source
) values (
  'c1400000-0000-4000-8000-000000000005', 'RF-PAYOUT-RECEIPT',
  'c1300000-0000-4000-8000-000000000001',
  'c1200000-0000-4000-8000-000000000001',
  'payout-receipt@example.invalid', 'Transactional payout receipt fixture',
  statement_timestamp() - interval '2 hours', 'America/Los_Angeles', 'exact',
  'cash', 1000, 1000, 'cash_zelle_pending', 'approved',
  'c1000000-0000-4000-8000-000000000001', statement_timestamp(),
  'manual_review', 'manual', 'approved', 'form'
);
insert into public.refund_case_messages (
  id, refund_case_id, message_type, status, recipient_email, subject, body,
  template_key, created_by, content_source, delivery_kind, reason_code,
  requested_fields, sent_at, created_at
) values (
  'c1450000-0000-4000-8000-000000000005',
  'c1400000-0000-4000-8000-000000000005', 'more_info', 'sent',
  'payout-receipt@example.invalid', 'Payout destination request',
  'Zelle email or phone number:', 'refund_more_info_editable_v1',
  'c1000000-0000-4000-8000-000000000001', 'manager_authored', 'manual',
  'missing_information', array['zelle_payment_contact']::text[],
  statement_timestamp() - interval '2 hours', statement_timestamp() - interval '2 hours'
);
update public.refund_cases
set status = 'waiting_on_customer', automation_state = 'more_info_needed'
where id = 'c1400000-0000-4000-8000-000000000005';
insert into public.refund_payout_destination_follow_ups (
  refund_case_id, request_message_id, reminder_delay_hours, reminder_due_at
) values (
  'c1400000-0000-4000-8000-000000000005',
  'c1450000-0000-4000-8000-000000000005', 48,
  statement_timestamp() - interval '1 minute'
);
set local role service_role;
create temp table payout_receipt_claim as
select public.service_claim_due_refund_payout_destination_follow_ups(1) as result;
create temp table payout_receipt_message as
select public.service_create_refund_payout_destination_reminder_message(
  (select (result #>> '{reminders,0,followUpId}')::uuid from payout_receipt_claim),
  (select (result #>> '{reminders,0,claimToken}')::uuid from payout_receipt_claim),
  'Protected transactional reminder', 'Zelle email or phone number:'
) as result;
select public.service_mark_refund_transactional_delivery_attempt(
  (select (result ->> 'messageId')::uuid from payout_receipt_message)
);
select public.service_bind_refund_transactional_delivery(
  (select (result ->> 'messageId')::uuid from payout_receipt_message),
  'payout-reminder-receipt-5', statement_timestamp()
);
update public.refund_case_messages
set status = 'sent', sent_at = statement_timestamp()
where id = (select (result ->> 'messageId')::uuid from payout_receipt_message);
reset role;
update public.refund_customer_contact_settings
set automatic_customer_contact_enabled = false;

set local role service_role;
select lives_ok($$select public.service_record_refund_transactional_delivery_event(
  repeat('1', 64), 'payout-reminder-receipt-5', 'delivered', statement_timestamp()
)$$, 'Late delivered receipt settles after reminder_sent with automatic contact disabled');
select is(
  (select delivery_state from public.refund_case_messages
   where id = (select (result ->> 'messageId')::uuid from payout_receipt_message)),
  'delivered', 'Delivered payout reminder evidence is tracked on the original message'
);
select is(
  public.service_record_refund_transactional_delivery_event(
    repeat('1', 64), 'payout-reminder-receipt-5', 'delivered', statement_timestamp()
  ) ->> 'duplicate', 'true', 'Repeated reminder receipt is idempotent'
);
select ok(
  pg_temp.capture_error($$update public.refund_case_messages set subject = 'Changed'
    where provider_message_id = 'payout-reminder-receipt-5'$$) like '23514:%'
  and pg_temp.capture_error($$update public.refund_case_messages
    set recipient_email = 'wrong@example.invalid'
    where provider_message_id = 'payout-reminder-receipt-5'$$) like '23514:%',
  'Delivery settlement cannot mutate protected reminder content or recipient'
);
select ok(
  pg_temp.capture_error($$update public.refund_case_messages
    set delivery_state = 'complained', status = 'failed',
      error_message = 'transactional_delivery_complained',
      delivery_state_updated_at = statement_timestamp()
    where provider_message_id = 'payout-reminder-receipt-5'$$) like '23514:%',
  'A fabricated reminder receipt without provider-event evidence is rejected'
);
select lives_ok($$select public.service_record_refund_transactional_delivery_event(
  repeat('2', 64), 'payout-reminder-receipt-5', 'bounced', statement_timestamp()
)$$, 'Late bounced receipt settles after the reminder send phase');
reset role;
select ok(
  (select delivery_state = 'bounced' and status = 'failed'
   from public.refund_case_messages
   where provider_message_id = 'payout-reminder-receipt-5')
  and (select status = 'needs_review' from public.refund_cases
       where id = 'c1400000-0000-4000-8000-000000000005')
  and (select status = 'manual_review' from public.refund_payout_destination_follow_ups
       where refund_case_id = 'c1400000-0000-4000-8000-000000000005')
  and (public.refund_customer_action_contract(
       'c1400000-0000-4000-8000-000000000005') ->> 'valid') = 'false',
  'A bounced reminder returns waiting work to managers without a stale customer obligation'
);
select ok(
  (select count(*) = 1 from public.refund_case_messages
   where refund_case_id = 'c1400000-0000-4000-8000-000000000005'
     and message_type = 'reminder')
  and not exists (select 1 from public.refund_case_nayax_refund_attempts
   where refund_case_id = 'c1400000-0000-4000-8000-000000000005'),
  'Reminder receipts create no duplicate message or payment attempt'
);

update public.refund_cases
set zelle_payment_contact = 'payout-receipt@example.invalid',
    status = 'completed', automation_state = 'completed'
where id = 'c1400000-0000-4000-8000-000000000005';
set local role service_role;
select lives_ok($$select public.service_record_refund_transactional_delivery_event(
  repeat('3', 64), 'payout-reminder-receipt-5', 'complained', statement_timestamp()
)$$, 'Late complaint remains recordable after payout destination and payment completion');
reset role;
select ok(
  (select status = 'completed' and automation_state = 'completed'
   from public.refund_cases where id = 'c1400000-0000-4000-8000-000000000005')
  and (select delivery_state = 'complained' from public.refund_case_messages
       where provider_message_id = 'payout-reminder-receipt-5'),
  'A delivery complaint never regresses completed payment truth'
);
set local role service_role;
select lives_ok($$select public.service_record_refund_transactional_delivery_event(
  repeat('4', 64), 'payout-reminder-receipt-5', 'accepted', statement_timestamp()
)$$, 'An out-of-order reminder receipt is safely recorded');
select is(
  (select delivery_state from public.refund_case_messages
   where provider_message_id = 'payout-reminder-receipt-5'),
  'complained', 'Out-of-order provider evidence cannot regress delivery truth'
);
reset role;

-- Interleave the real same-thread reply application between provider entry and
-- case-message settlement. No test hand-edits the satisfied state.
create temp table payout_race_fixtures (
  transport text, case_id uuid, request_id uuid, reminder_id uuid,
  thread_id uuid, reply_id uuid, reply_result jsonb
);
grant select on payout_race_fixtures to service_role;
update public.refund_customer_contact_settings set automatic_customer_contact_enabled = true;
do $$
declare
  transport text;
  case_id uuid;
  request_id uuid;
  thread_id uuid;
  reply_id uuid;
  recipient text;
  claim jsonb;
  reminder jsonb;
  reply_result jsonb;
begin
  foreach transport in array array['gmail', 'resend', 'not_started'] loop
    case_id := gen_random_uuid(); request_id := gen_random_uuid();
    thread_id := gen_random_uuid(); reply_id := gen_random_uuid();
    recipient := 'payout-race-' || transport || '@example.invalid';
    insert into public.refund_cases (
      id, public_reference, reporting_machine_id, reporting_location_id,
      customer_email, issue_summary, incident_at, incident_timezone,
      incident_time_resolution, payment_method, payment_amount_cents,
      refund_amount_cents, status, decision, decided_by, decided_at,
      correlation_status, correlation_source, automation_state, intake_source
    ) values (
      case_id, 'RF-RACE-' || upper(transport),
      'c1300000-0000-4000-8000-000000000001',
      'c1200000-0000-4000-8000-000000000001',
      recipient, 'Payout late-settlement race fixture',
      statement_timestamp() - interval '2 hours', 'America/Los_Angeles', 'exact',
      'cash', 1000, 1000, 'cash_zelle_pending', 'approved',
      'c1000000-0000-4000-8000-000000000001', statement_timestamp(),
      'manual_review', 'manual', 'approved', 'form'
    );
    insert into public.refund_case_messages (
      id, refund_case_id, message_type, status, recipient_email, subject, body,
      template_key, created_by, content_source, delivery_kind, reason_code,
      requested_fields, sent_at, created_at
    ) values (
      request_id, case_id, 'more_info', 'sent', recipient,
      'Original payout thread subject', 'Zelle email or phone number:',
      'refund_more_info_editable_v1', 'c1000000-0000-4000-8000-000000000001',
      'manager_authored', 'manual', 'missing_information',
      array['zelle_payment_contact']::text[],
      statement_timestamp() - interval '2 hours', statement_timestamp() - interval '2 hours'
    );
    update public.refund_cases
    set status = 'waiting_on_customer', automation_state = 'more_info_needed'
    where id = case_id;
    insert into public.refund_payout_destination_follow_ups (
      refund_case_id, request_message_id, reminder_delay_hours, reminder_due_at
    ) values (case_id, request_id, 48, statement_timestamp() - interval '1 minute');
    insert into public.refund_gmail_threads (
      id, refund_case_id, mailbox_hash, provider_thread_id, thread_subject,
      first_message_at, latest_message_at, retention_expires_at
    ) values (
      thread_id, case_id, repeat('f', 64), 'payout-race-thread-' || transport,
      'Original payout thread subject', statement_timestamp() - interval '2 hours',
      statement_timestamp(), statement_timestamp() + interval '30 days'
    );
    insert into public.refund_gmail_messages (
      gmail_thread_id, refund_case_id, refund_case_message_id,
      provider_message_id, provider_message_header, operation_key,
      direction, message_kind, status, sender_email, recipient_email,
      recipient_cc_emails, recipient_cc_count, recipient_resolution_status,
      delivery_kind, participant_role, participant_trust, subject, plain_body,
      received_at, sent_at, retention_expires_at
    ) values (
      thread_id, case_id, request_id, 'payout-race-original-' || transport,
      '<payout-race-original-' || transport || '@example.invalid>',
      'payout-race-original-' || transport, 'outbound', 'message', 'sent',
      'refunds@example.invalid', recipient, array['payout-manager@example.invalid'],
      1, 'resolved', 'manual', 'mailbox', 'verified',
      'Original payout thread subject', 'Zelle email or phone number:',
      statement_timestamp() - interval '2 hours', statement_timestamp() - interval '2 hours',
      statement_timestamp() + interval '30 days'
    );
    claim := public.service_claim_due_refund_payout_destination_follow_ups(1);
    reminder := public.service_create_refund_payout_destination_reminder_message(
      (claim #>> '{reminders,0,followUpId}')::uuid,
      (claim #>> '{reminders,0,claimToken}')::uuid,
      'Generated payout reminder subject', 'Zelle email or phone number:'
    );
    if transport = 'gmail' then
      insert into public.refund_gmail_messages (
        gmail_thread_id, refund_case_id, refund_case_message_id,
        provider_message_id, provider_message_header, operation_key,
        direction, message_kind, status, sender_email, recipient_email,
        recipient_cc_emails, recipient_cc_count, recipient_resolution_status,
        delivery_kind, participant_role, participant_trust, subject, plain_body,
        received_at, sent_at, retention_expires_at
      ) values (
        thread_id, case_id, (reminder ->> 'messageId')::uuid,
        'payout-race-reminder-gmail', '<payout-race-reminder-gmail@example.invalid>',
        'payout-race-reminder-gmail', 'outbound', 'message', 'sent',
        'refunds@example.invalid', recipient, array['payout-manager@example.invalid'],
        1, 'resolved', 'automatic', 'mailbox', 'verified',
        'Original payout thread subject', 'Zelle email or phone number:',
        statement_timestamp(), statement_timestamp(), statement_timestamp() + interval '30 days'
      );
    elsif transport = 'resend' then
      perform public.service_mark_refund_transactional_delivery_attempt(
        (reminder ->> 'messageId')::uuid
      );
    end if;
    insert into public.refund_gmail_messages (
      id, gmail_thread_id, refund_case_id, provider_message_id,
      direction, message_kind, status, sender_email, recipient_email,
      participant_role, participant_trust, subject, plain_body,
      received_at, retention_expires_at
    ) values (
      reply_id, thread_id, case_id, 'payout-race-reply-' || transport,
      'inbound', 'message', 'received', recipient, 'refunds@example.invalid',
      'customer', 'verified', 'Original payout thread subject',
      'Zelle email: ' || recipient, statement_timestamp(),
      statement_timestamp() + interval '30 days'
    );
    reply_result := public.service_apply_refund_gmail_customer_facts_v1(
      case_id, reply_id, 1, jsonb_build_object('zelle_payment_contact', recipient),
      array['zelle_payment_contact']::text[], 'labeled_routine_facts_v1'
    );
    insert into payout_race_fixtures values (
      transport, case_id, request_id, (reminder ->> 'messageId')::uuid,
      thread_id, reply_id, reply_result
    );
  end loop;
end;
$$;
select is((select count(*)::integer from payout_race_fixtures
  where reply_result ->> 'outcome' = 'applied'), 3,
  'Same-thread payout replies apply between provider entry and reminder settlement');
select ok(
  (select bool_and(message.status = 'pending')
   from payout_race_fixtures fixture join public.refund_case_messages message
     on message.id = fixture.reminder_id where fixture.transport <> 'not_started')
  and (select message.status = 'skipped'
   from payout_race_fixtures fixture join public.refund_case_messages message
     on message.id = fixture.reminder_id where fixture.transport = 'not_started'),
  'Reply cancels only pre-provider reminders and preserves started transport uncertainty'
);
select ok(pg_temp.capture_error($$update public.refund_case_messages
  set status = 'sent', sent_at = statement_timestamp()
  where id = (select reminder_id from payout_race_fixtures where transport = 'resend')$$)
  like '23514:%', 'A transactional attempt marker alone cannot fabricate a sent result');
select ok(pg_temp.capture_error($$update public.refund_case_messages
  set status = 'sent', sent_at = statement_timestamp()
  where id = (select reminder_id from payout_race_fixtures where transport = 'not_started')$$)
  like '23514:%', 'A reply-cancelled pre-provider reminder cannot resume or claim sent');
set local role service_role;
select lives_ok($$select public.service_bind_refund_transactional_delivery(
  (select reminder_id from payout_race_fixtures where transport = 'resend'),
  'payout-race-reminder-resend', statement_timestamp()
)$$, 'Resend receipt binds after a same-thread reply wins between attempt and binding');
reset role;
update public.refund_customer_contact_settings set automatic_customer_contact_enabled = false;
update public.refund_cases set status = 'completed', automation_state = 'completed'
where id = (select case_id from payout_race_fixtures where transport = 'resend');
select lives_ok($$update public.refund_case_messages
  set status = 'sent', sent_at = statement_timestamp()
  where id in (select reminder_id from payout_race_fixtures where transport <> 'not_started')$$,
  'Late Gmail and transactional sent settlement succeeds after satisfied reply and payment completion');
select ok(
  (select bool_and(follow_up.status = 'satisfied'
    and follow_up.reminder_sent_at is not null and follow_up.escalation_due_at is null)
   from payout_race_fixtures fixture join public.refund_payout_destination_follow_ups follow_up
     on follow_up.refund_case_id = fixture.case_id where fixture.transport <> 'not_started')
  and (select bool_and(refund_case.automation_follow_up_due_at is null
    and (public.refund_customer_action_contract(refund_case.id) ->> 'valid') = 'false')
   from payout_race_fixtures fixture join public.refund_cases refund_case
     on refund_case.id = fixture.case_id),
  'Late sent evidence never restarts satisfied follow-ups or customer due dates'
);
select ok(
  (select refund_case.status = 'completed' and refund_case.automation_state = 'completed'
   from payout_race_fixtures fixture join public.refund_cases refund_case
     on refund_case.id = fixture.case_id where fixture.transport = 'resend')
  and (select refund_case.status = 'needs_review' and refund_case.automation_state = 'customer_replied'
   from payout_race_fixtures fixture join public.refund_cases refund_case
     on refund_case.id = fixture.case_id where fixture.transport = 'gmail'),
  'Late reminder settlement preserves both completed payment and payout-ready reply states'
);
create temp table payout_race_sent_snapshot as
select message.id, message.sent_at from public.refund_case_messages message
where message.id in (select reminder_id from payout_race_fixtures where transport <> 'not_started');
update public.refund_case_messages set status = 'sent', sent_at = statement_timestamp()
where id in (select id from payout_race_sent_snapshot);
select ok((select bool_and(message.sent_at = snapshot.sent_at)
  from payout_race_sent_snapshot snapshot join public.refund_case_messages message
    on message.id = snapshot.id), 'Duplicate late worker settlement preserves the first sent receipt');
select ok(
  pg_temp.capture_error($$update public.refund_case_messages set body = 'Changed'
    where id = (select reminder_id from payout_race_fixtures where transport = 'gmail')$$) like '23514:%'
  and pg_temp.capture_error($$update public.refund_case_messages set provider_message_id = 'other-provider-identity'
    where id = (select reminder_id from payout_race_fixtures where transport = 'resend')$$) like '23514:%',
  'Late settlement cannot mutate message content or switch provider identity'
);
select ok(
  (select count(*) = 3 from public.refund_case_messages message
   where message.refund_case_id in (select case_id from payout_race_fixtures)
     and message.message_type = 'reminder')
  and not exists (select 1 from public.refund_case_nayax_refund_attempts attempt
    where attempt.refund_case_id in (select case_id from payout_race_fixtures)),
  'Reply and settlement races create one reminder per case and no payment attempt'
);

select * from finish();
rollback;
