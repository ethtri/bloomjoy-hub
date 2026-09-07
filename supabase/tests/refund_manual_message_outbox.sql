begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(27);

create function pg_temp.capture_error(statement text)
returns text language plpgsql as $$
begin
  execute statement;
  return null;
exception when others then
  return sqlstate || ':' || sqlerrm;
end;
$$;

create function pg_temp.enqueue_manual_message(
  p_case_id uuid,
  p_intent_id uuid,
  p_message_type text,
  p_requested_fields text[],
  p_body text default 'Synthetic customer-safe body.'
)
returns jsonb language sql as $$
  select public.service_enqueue_refund_manual_message_intent(
    p_case_id,
    (select official_action_version from public.refund_cases where id = p_case_id),
    p_intent_id,
    'b1000000-0000-4000-8000-000000000001',
    p_message_type,
    (select customer_email from public.refund_cases where id = p_case_id),
    'Synthetic customer-safe subject',
    p_body,
    'refund_' || p_message_type || '_editable_v1',
    'manager_authored',
    case when p_message_type = 'more_info' then 'missing_information' else null end,
    p_requested_fields,
    null,
    false,
    null
  );
$$;

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  'b1000000-0000-4000-8000-000000000001',
  'authenticated', 'authenticated', 'outbox-manager@example.invalid', '', now(),
  '{}'::jsonb, '{}'::jsonb, now(), now()
);

insert into public.admin_roles (user_id, role, active)
values ('b1000000-0000-4000-8000-000000000001', 'super_admin', true);

insert into public.customer_accounts (id, name, account_type)
values ('b1100000-0000-4000-8000-000000000001', 'Manual outbox fixture', 'internal');

insert into public.reporting_locations (id, account_id, name, timezone)
values (
  'b1200000-0000-4000-8000-000000000001',
  'b1100000-0000-4000-8000-000000000001',
  'Manual outbox location', 'America/Los_Angeles'
);

insert into public.reporting_machines (
  id, account_id, location_id, machine_label, status
) values (
  'b1300000-0000-4000-8000-000000000001',
  'b1100000-0000-4000-8000-000000000001',
  'b1200000-0000-4000-8000-000000000001',
  'Manual outbox machine', 'active'
);

insert into public.refund_cases (
  id, public_reference, reporting_machine_id, reporting_location_id,
  customer_email, issue_summary, incident_at, incident_timezone,
  payment_method, payment_amount_cents, card_last4, status,
  correlation_status, correlation_source, automation_state, intake_source
) values
  ('b1400000-0000-4000-8000-000000000001', 'RF-OUTBOX-SENT', 'b1300000-0000-4000-8000-000000000001', 'b1200000-0000-4000-8000-000000000001', 'outbox-sent@example.invalid', 'Manual outbox sent fixture', statement_timestamp() - interval '2 hours', 'America/Los_Angeles', 'card', 700, '4242', 'needs_review', 'matched', 'nayax', 'under_review', 'form'),
  ('b1400000-0000-4000-8000-000000000002', 'RF-OUTBOX-VERSION', 'b1300000-0000-4000-8000-000000000001', 'b1200000-0000-4000-8000-000000000001', 'outbox-version@example.invalid', 'Manual outbox version fixture', statement_timestamp() - interval '2 hours', 'America/Los_Angeles', 'card', 800, '4242', 'needs_review', 'matched', 'nayax', 'under_review', 'form'),
  ('b1400000-0000-4000-8000-000000000003', 'RF-OUTBOX-INTERNAL', 'b1300000-0000-4000-8000-000000000001', 'b1200000-0000-4000-8000-000000000001', 'outbox-internal@example.invalid', 'Manual outbox internal fixture', statement_timestamp() - interval '2 hours', 'America/Los_Angeles', 'card', 900, '4242', 'needs_review', 'matched', 'nayax', 'under_review', 'form'),
  ('b1400000-0000-4000-8000-000000000004', 'RF-OUTBOX-STALE', 'b1300000-0000-4000-8000-000000000001', 'b1200000-0000-4000-8000-000000000001', 'outbox-stale@example.invalid', 'Manual outbox stale fixture', statement_timestamp() - interval '2 hours', 'America/Los_Angeles', 'card', 1000, '4242', 'needs_review', 'matched', 'nayax', 'under_review', 'form'),
  ('b1400000-0000-4000-8000-000000000005', 'RF-OUTBOX-UNKNOWN', 'b1300000-0000-4000-8000-000000000001', 'b1200000-0000-4000-8000-000000000001', 'outbox-unknown@example.invalid', 'Manual outbox unknown fixture', statement_timestamp() - interval '2 hours', 'America/Los_Angeles', 'card', 1100, '4242', 'needs_review', 'matched', 'nayax', 'under_review', 'form'),
  ('b1400000-0000-4000-8000-000000000006', 'RF-OUTBOX-GMAIL', 'b1300000-0000-4000-8000-000000000001', 'b1200000-0000-4000-8000-000000000001', 'outbox-gmail@example.invalid', 'Manual outbox Gmail draft fixture', statement_timestamp() - interval '2 hours', 'America/Los_Angeles', 'card', null, null, 'draft', 'not_started', null, 'under_review', 'gmail');

update public.refund_cases
set official_action_version = 9
where id = 'b1400000-0000-4000-8000-000000000006';

insert into public.refund_gmail_threads (
  id, refund_case_id, mailbox_hash, provider_thread_id, thread_subject,
  first_message_at, latest_message_at, retention_expires_at
) values (
  'b1600000-0000-4000-8000-000000000001',
  'b1400000-0000-4000-8000-000000000006',
  repeat('f', 64),
  'manual-outbox-gmail-thread',
  'Synthetic manual outbox Gmail thread',
  statement_timestamp() - interval '2 hours',
  statement_timestamp() - interval '1 hour',
  statement_timestamp() + interval '180 days'
);

select ok(
  has_function_privilege('service_role', 'public.service_enqueue_refund_manual_message_intent(uuid,bigint,uuid,uuid,text,text,text,text,text,text,text,text[],uuid,boolean,uuid)', 'execute')
  and has_function_privilege('service_role', 'public.service_claim_refund_manual_message_deliveries(uuid,integer)', 'execute')
  and has_function_privilege('service_role', 'public.service_mark_refund_manual_message_provider_attempt(uuid,uuid)', 'execute')
  and has_function_privilege('service_role', 'public.service_finish_refund_manual_message_delivery(uuid,uuid,text,text,text,integer,text)', 'execute')
  and not has_function_privilege('authenticated', 'public.service_enqueue_refund_manual_message_intent(uuid,bigint,uuid,uuid,text,text,text,text,text,text,text,text[],uuid,boolean,uuid)', 'execute'),
  'Only the service boundary can operate the manager-message outbox'
);

select ok(
  (
    select count(*) = 5
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'refund_case_messages'
      and column_name = any(array[
        'manual_delivery_intent_id',
        'manual_delivery_state',
        'manual_delivery_expected_case_version',
        'manual_delivery_provider_attempted_at',
        'manual_delivery_attempt_count'
      ])
  ),
  'The customer-message ledger exposes the durable outbox state'
);

select set_config('request.jwt.claim.sub', 'b1000000-0000-4000-8000-000000000001', true);
select is(
  (
    select (draft_case ->> 'officialActionVersion')::bigint
    from jsonb_array_elements(public.admin_get_refund_gmail_draft_cases()) as draft_case
    where draft_case ->> 'id' = 'b1400000-0000-4000-8000-000000000006'
  ),
  (
    select official_action_version
    from public.refund_cases
    where id = 'b1400000-0000-4000-8000-000000000006'
  ),
  'Gmail draft cases expose the authoritative version required by the durable outbox'
);

set local role service_role;
select ok(
  pg_temp.capture_error($$select pg_temp.enqueue_manual_message(
    'b1400000-0000-4000-8000-000000000001',
    'b1500000-0000-4000-8000-000000000099',
    'more_info', '{}'::text[]
  )$$) like 'P4655:Valid refund manual-message intent is required%',
  'Waiting-state messages cannot be queued without a specific requested field'
);

select is(
  pg_temp.enqueue_manual_message(
    'b1400000-0000-4000-8000-000000000001',
    'b1500000-0000-4000-8000-000000000001',
    'more_info', array['incident_time']::text[]
  ) ->> 'enqueued',
  'true', 'A valid manager message is committed before provider access'
);
reset role;

select ok(
  (select status = 'pending'
      and manual_delivery_state = 'queued'
      and manual_delivery_attempt_count = 0
      and requested_fields = array['incident_time']::text[]
   from public.refund_case_messages
   where manual_delivery_intent_id = 'b1500000-0000-4000-8000-000000000001'),
  'The exact immutable message intent is queued without claiming delivery'
);

select is(
  (select count(*)::integer from public.refund_case_events
   where refund_case_id = 'b1400000-0000-4000-8000-000000000001'
     and event_type = 'customer_message_queued'
     and metadata ->> 'payload_redacted' = 'true'),
  1, 'Queueing records one redacted audit event atomically'
);

set local role service_role;
select is(
  pg_temp.enqueue_manual_message(
    'b1400000-0000-4000-8000-000000000001',
    'b1500000-0000-4000-8000-000000000001',
    'more_info', array['incident_time']::text[]
  ) ->> 'replayed',
  'true', 'An exact client retry reuses the same intent'
);
reset role;

select ok(
  (select count(*) = 1 from public.refund_case_messages
   where manual_delivery_intent_id = 'b1500000-0000-4000-8000-000000000001')
  and (select count(*) = 1 from public.refund_case_events
       where refund_case_id = 'b1400000-0000-4000-8000-000000000001'
         and event_type = 'customer_message_queued'),
  'Intent replay creates neither a duplicate message nor a duplicate event'
);

set local role service_role;
select ok(
  pg_temp.capture_error($$select pg_temp.enqueue_manual_message(
    'b1400000-0000-4000-8000-000000000001',
    'b1500000-0000-4000-8000-000000000001',
    'more_info', array['incident_time']::text[], 'Changed body'
  )$$) like 'P4656:Refund message intent identity is already bound%',
  'An intent id cannot be rebound to changed customer content'
);

select ok(
  pg_temp.capture_error($$select pg_temp.enqueue_manual_message(
    'b1400000-0000-4000-8000-000000000001',
    'b1500000-0000-4000-8000-000000000002',
    'status_update', '{}'::text[]
  )$$) like 'P4657:A customer message is already queued for this case%',
  'Only one unresolved manager message can be active for a case'
);

create temp table first_claim as
select * from public.service_claim_refund_manual_message_deliveries(
  (select id from public.refund_case_messages
   where manual_delivery_intent_id = 'b1500000-0000-4000-8000-000000000001'),
  1
);
reset role;

select is((select count(*)::integer from first_claim), 1,
  'One worker claims the exact queued message');
select ok(
  (select manual_delivery_state = 'claimed'
      and manual_delivery_claim_token = first_claim.claim_token
      and manual_delivery_attempt_count = 1
   from public.refund_case_messages, first_claim
   where id = first_claim.refund_case_message_id),
  'A claim records its token, time, and bounded attempt count'
);

set local role service_role;
select is(
  (select count(*)::integer
   from public.service_claim_refund_manual_message_deliveries(
     (select refund_case_message_id from first_claim), 1
   )),
  0, 'A concurrent worker cannot claim the same active message'
);

select public.service_mark_refund_manual_message_provider_attempt(
  (select refund_case_message_id from first_claim),
  (select claim_token from first_claim)
);

select is(
  public.service_finish_refund_manual_message_delivery(
    (select refund_case_message_id from first_claim),
    (select claim_token from first_claim),
    'sent', 'gmail_thread', null, 1, 'linked_thread'
  ) ->> 'finished',
  'true', 'Provider acceptance and lifecycle settlement finish atomically'
);
reset role;

select ok(
  (select status = 'sent' and manual_delivery_state = 'sent'
      and sent_at is not null and manual_delivery_claim_token is null
      and manual_delivery_provider_attempted_at is not null
   from public.refund_case_messages
   where manual_delivery_intent_id = 'b1500000-0000-4000-8000-000000000001'),
  'A successful delivery becomes terminal and clears its claim'
);

select ok(
  (select automation_state = 'more_info_needed'
      and customer_last_contacted_at is not null
      and last_customer_message_type = 'more_info'
   from public.refund_cases
   where id = 'b1400000-0000-4000-8000-000000000001'),
  'Only a sent request advances the truthful waiting lifecycle'
);

select is(
  (select count(*)::integer from public.refund_case_events
   where refund_case_id = 'b1400000-0000-4000-8000-000000000001'
     and event_type = 'customer_message_sent'
     and metadata ->> 'outbox_state' = 'sent'),
  1, 'Successful settlement records one redacted sent event'
);

set local role service_role;
select is(
  public.service_finish_refund_manual_message_delivery(
    (select refund_case_message_id from first_claim),
    (select claim_token from first_claim),
    'sent', 'gmail_thread', null, 1, 'linked_thread'
  ) ->> 'replayed',
  'true', 'A settlement replay cannot duplicate the customer message'
);
reset role;

select is(
  (select count(*)::integer from public.refund_case_nayax_refund_attempts
   where refund_case_id = 'b1400000-0000-4000-8000-000000000001'),
  0, 'Message delivery creates no payment attempt'
);

set local role service_role;
select pg_temp.enqueue_manual_message(
  'b1400000-0000-4000-8000-000000000002',
  'b1500000-0000-4000-8000-000000000003',
  'status_update', '{}'::text[]
);
reset role;
update public.refund_cases set issue_summary = 'Changed after queueing'
where id = 'b1400000-0000-4000-8000-000000000002';
set local role service_role;
select is(
  (select count(*)::integer
   from public.service_claim_refund_manual_message_deliveries(
     (select id from public.refund_case_messages
      where manual_delivery_intent_id = 'b1500000-0000-4000-8000-000000000003'),
     1
   )),
  0, 'A changed case is rejected before provider access'
);
reset role;

select ok(
  (select status = 'failed'
      and manual_delivery_state = 'failed'
      and error_message = 'manual_delivery_case_version_changed'
   from public.refund_case_messages
   where manual_delivery_intent_id = 'b1500000-0000-4000-8000-000000000003'),
  'Version invalidation leaves a manager-owned delivery exception'
);

select ok(
  (select automation_state = 'under_review'
      and customer_last_contacted_at is null
   from public.refund_cases
   where id = 'b1400000-0000-4000-8000-000000000002'),
  'A pre-provider cancellation never claims customer contact'
);

set local role service_role;
select pg_temp.enqueue_manual_message(
  'b1400000-0000-4000-8000-000000000003',
  'b1500000-0000-4000-8000-000000000004',
  'status_update', '{}'::text[]
);
reset role;
update public.refund_cases
set case_population = 'internal_test',
  internal_test_reason = 'provider_test',
  internal_test_classified_at = statement_timestamp(),
  internal_test_classified_by = 'b1000000-0000-4000-8000-000000000001',
  status = 'closed', automation_state = 'closed_incomplete',
  automation_follow_up_due_at = null, decision = null, decided_by = null,
  decided_at = null, reporting_adjustment_id = null,
  refund_completed_by = null, refund_completed_at = null
where id = 'b1400000-0000-4000-8000-000000000003';
set local role service_role;
select public.service_claim_refund_manual_message_deliveries(
  (select id from public.refund_case_messages
   where manual_delivery_intent_id = 'b1500000-0000-4000-8000-000000000004'),
  1
);
reset role;
select ok(
  (select status = 'failed'
      and error_message = 'internal_test_customer_contact_suppressed'
      and manual_delivery_attempt_count = 0
   from public.refund_case_messages
   where manual_delivery_intent_id = 'b1500000-0000-4000-8000-000000000004'),
  'Internal/test classification suppresses queued contact before any attempt'
);

set local role service_role;
select pg_temp.enqueue_manual_message(
  'b1400000-0000-4000-8000-000000000005',
  'b1500000-0000-4000-8000-000000000006',
  'status_update', '{}'::text[]
);
create temp table uncertain_claim as
select * from public.service_claim_refund_manual_message_deliveries(
  (select id from public.refund_case_messages
   where manual_delivery_intent_id = 'b1500000-0000-4000-8000-000000000006'),
  1
);
select public.service_mark_refund_manual_message_provider_attempt(
  (select refund_case_message_id from uncertain_claim),
  (select claim_token from uncertain_claim)
);
reset role;
update public.refund_cases set issue_summary = 'Changed after provider access began'
where id = 'b1400000-0000-4000-8000-000000000005';
set local role service_role;
select public.service_claim_refund_manual_message_deliveries(
  (select refund_case_message_id from uncertain_claim), 1
);
reset role;
select ok(
  (select status = 'failed'
      and manual_delivery_state = 'delivery_unknown'
      and error_message = 'manual_delivery_case_changed_after_provider_attempt'
   from public.refund_case_messages
   where manual_delivery_intent_id = 'b1500000-0000-4000-8000-000000000006'),
  'A case change after provider access preserves unknown evidence without replay'
);

set local role service_role;
select pg_temp.enqueue_manual_message(
  'b1400000-0000-4000-8000-000000000004',
  'b1500000-0000-4000-8000-000000000005',
  'status_update', '{}'::text[]
);
create temp table stale_claim as
select * from public.service_claim_refund_manual_message_deliveries(
  (select id from public.refund_case_messages
   where manual_delivery_intent_id = 'b1500000-0000-4000-8000-000000000005'),
  1
);
select public.service_mark_refund_manual_message_provider_attempt(
  (select refund_case_message_id from stale_claim),
  (select claim_token from stale_claim)
);
reset role;
update public.refund_case_messages
set manual_delivery_claimed_at = statement_timestamp() - interval '11 minutes',
  manual_delivery_attempt_count = 3
where manual_delivery_intent_id = 'b1500000-0000-4000-8000-000000000005';
set local role service_role;
select public.service_claim_refund_manual_message_deliveries(
  (select refund_case_message_id from stale_claim), 1
);
reset role;
select ok(
  (select status = 'failed'
      and manual_delivery_state = 'failed'
      and error_message = 'manual_delivery_claims_exhausted'
      and manual_delivery_claim_token is null
   from public.refund_case_messages
   where manual_delivery_intent_id = 'b1500000-0000-4000-8000-000000000005'),
  'Three abandoned claims exhaust automatic retry without changing identity'
);

select ok(
  (select count(*) = 0 from public.refund_case_nayax_refund_attempts
   where refund_case_id in (
     'b1400000-0000-4000-8000-000000000001',
     'b1400000-0000-4000-8000-000000000002',
     'b1400000-0000-4000-8000-000000000003',
     'b1400000-0000-4000-8000-000000000004',
     'b1400000-0000-4000-8000-000000000005'
   )),
  'Outbox success, invalidation, suppression, and exhaustion remain payment-inert'
);

select * from finish();
rollback;
