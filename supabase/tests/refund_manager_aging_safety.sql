begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select no_plan();

create or replace function pg_temp.capture_error(statement text)
returns text
language plpgsql
as $$
begin
  execute statement;
  return null;
exception
  when others then return sqlerrm;
end;
$$;

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  '91000000-0000-4000-8000-000000000001',
  'authenticated',
  'authenticated',
  'aging-manager@example.test',
  '',
  now(),
  '{}'::jsonb,
  '{}'::jsonb,
  now(),
  now()
), (
  '00000000-0000-0000-0000-000000000000',
  '91000000-0000-4000-8000-000000000002',
  'authenticated',
  'authenticated',
  'aging-manager-b@example.test',
  '',
  now(),
  '{}'::jsonb,
  '{}'::jsonb,
  now(),
  now()
);

insert into public.customer_accounts (id, name, account_type)
values (
  '91100000-0000-4000-8000-000000000001',
  'Manager aging safety',
  'customer'
);

insert into public.reporting_locations (id, account_id, name, timezone)
values (
  '91200000-0000-4000-8000-000000000001',
  '91100000-0000-4000-8000-000000000001',
  'Synthetic aging location',
  'America/Los_Angeles'
);

insert into public.reporting_machines (
  id, account_id, location_id, machine_label, refund_public_display_label
) values (
  '91300000-0000-4000-8000-000000000001',
  '91100000-0000-4000-8000-000000000001',
  '91200000-0000-4000-8000-000000000001',
  'Private machine name',
  'Lobby machine'
);

insert into public.reporting_machine_refund_managers (
  id, reporting_machine_id, manager_user_id, manager_email, grant_reason
) values (
  '91400000-0000-4000-8000-000000000001',
  '91300000-0000-4000-8000-000000000001',
  '91000000-0000-4000-8000-000000000001',
  'aging-manager@example.test',
  'Synthetic manager aging test'
);

insert into public.refund_cases (
  id,
  public_reference,
  reporting_machine_id,
  reporting_location_id,
  customer_email,
  issue_summary,
  incident_at,
  payment_method,
  payment_amount_cents,
  card_last4,
  zelle_payment_contact,
  status,
  automation_state
) values (
  '91500000-0000-4000-8000-000000000001',
  'RF-AGING-TEST',
  '91300000-0000-4000-8000-000000000001',
  '91200000-0000-4000-8000-000000000001',
  'aging-customer@example.test',
  'Synthetic complaint text must never enter reminder evidence.',
  now() - interval '3 days',
  'cash',
  987654,
  null,
  'aging-cash-contact@example.test',
  'needs_review',
  'under_review'
);

select is(
  (
    public.service_start_refund_automation_run(
      'scheduled:manager-aging-test',
      'scheduled',
      now()
    ) ->> 'claimed'
  )::boolean,
  true,
  'The fixture starts one scheduler run'
);

create or replace function pg_temp.claim_aging_action(
  p_refund_case_id uuid,
  p_attention_version bigint,
  p_milestone text
)
returns boolean
language sql
as $$
  select (
    public.service_claim_refund_automation_action(
      (
        select id
        from public.refund_automation_runs
        where run_key = 'scheduled:manager-aging-test'
      ),
      p_refund_case_id,
      format(
        'manager_aging:%s:%s:v%s',
        p_milestone,
        p_refund_case_id,
        p_attention_version
      ),
      case when p_milestone = 'reminder'
        then 'manager_reminder'
        else 'manager_escalation'
      end,
      'needs_review',
      date_trunc('hour', now())
    ) ->> 'claimed'
  )::boolean;
$$;

select has_table(
  'public',
  'refund_manager_attention_states',
  'Manager attention has a durable service-only state table'
);

select ok(
  not has_table_privilege(
    'authenticated',
    'public.refund_manager_attention_states',
    'select'
  ),
  'Browser roles cannot read manager aging state'
);

select ok(
  has_table_privilege(
    'service_role',
    'public.refund_manager_attention_states',
    'select'
  ),
  'The service workflow can read manager aging state'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.service_list_due_refund_manager_aging_notices(timestamp with time zone,text,integer,integer,text,integer)',
    'execute'
  ),
  'Browser roles cannot list due manager aging notices'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.service_list_due_refund_manager_aging_notices(timestamp with time zone,text,integer,integer,text,integer)',
    'execute'
  ),
  'Only the service workflow receives bounded due candidates'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.service_begin_refund_manager_aging_notice_attempt(uuid,bigint,text,timestamp with time zone,text,integer,integer,text,text,text[],text[])',
    'execute'
  ),
  'Browser roles cannot reserve a manager notice attempt'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.service_begin_refund_manager_aging_notice_attempt(uuid,bigint,text,timestamp with time zone,text,integer,integer,text,text,text[],text[])',
    'execute'
  ),
  'Only the service workflow can create the pre-send hold'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.service_complete_refund_manager_aging_notice(uuid,text,text)',
    'execute'
  ),
  'Browser roles cannot settle a manager notice attempt'
);

select is(
  (
    select attention_version
    from public.refund_manager_attention_states
    where refund_case_id = '91500000-0000-4000-8000-000000000001'
  ),
  1::bigint,
  'A new manager-actionable case starts one attention version'
);

select is(
  public.service_refund_business_days_elapsed(
    '2026-08-03 17:00:00+00',
    '2026-08-05 16:59:59+00',
    'America/Los_Angeles'
  ),
  1,
  'The second business day is not reached before the local anchor time'
);

select is(
  public.service_refund_business_days_elapsed(
    '2026-08-03 17:00:00+00',
    '2026-08-05 17:00:00+00',
    'America/Los_Angeles'
  ),
  2,
  'The second business day is reached at the matching local time'
);

select is(
  public.service_refund_business_days_elapsed(
    '2026-08-07 17:00:00+00',
    '2026-08-11 17:00:00+00',
    'America/Los_Angeles'
  ),
  2,
  'Business-day aging skips Saturday and Sunday'
);

update public.refund_manager_attention_states
set attention_started_at = '2026-08-03 17:00:00+00'
where refund_case_id = '91500000-0000-4000-8000-000000000001';

select is(
  (
    public.service_authorize_refund_manager_aging_notice(
      '91500000-0000-4000-8000-000000000001',
      1,
      'reminder',
      '2026-08-05 17:00:00+00',
      'America/Los_Angeles',
      2,
      5,
      'refund_manager_aging_v1'
    ) ->> 'authorized'
  )::boolean,
  true,
  'A two-business-day manager reminder is due exactly at its milestone'
);

select is(
  pg_temp.claim_aging_action(
    '91500000-0000-4000-8000-000000000001', 1, 'reminder'
  ),
  true,
  'The reminder receives one deterministic action claim'
);

select ok(
  pg_temp.capture_error($test$
    select public.service_begin_refund_manager_aging_notice_attempt(
      '91500000-0000-4000-8000-000000000001', 1, 'reminder',
      '2026-08-05 17:00:00+00', 'America/Los_Angeles', 2, 5,
      'refund_manager_aging_v1',
      'manager_aging:reminder:91500000-0000-4000-8000-000000000001:v999',
      array['info@bloomjoysweets.com', 'support@bloomjoysweets.com'],
      array['ops-refunds@example.test']
    )
  $test$) like '%not bound to this milestone%',
  'A reservation cannot use an action key from another attention version'
);

select ok(
  (
    with attempt as (
      select public.service_begin_refund_manager_aging_notice_attempt(
        '91500000-0000-4000-8000-000000000001', 1, 'reminder',
        '2026-08-05 17:00:00+00', 'America/Los_Angeles', 2, 5,
        'refund_manager_aging_v1',
        'manager_aging:reminder:91500000-0000-4000-8000-000000000001:v1',
        array['info@bloomjoysweets.com', 'support@bloomjoysweets.com'],
        array['ops-refunds@example.test']
      ) result
    )
    select (result ->> 'authorized')::boolean
      and result #>> '{recipientRoute,routeType}' = 'manager'
      and result #>> '{recipientRoute,recipients,0}' =
        'aging-manager@example.test'
      and result #>> '{recipientRoute,mappingFingerprint}' ~ '^[a-f0-9]{64}$'
    from attempt
  ),
  'The final send-time gate resolves and returns only the current manager route'
);

select ok(
  (
    select notice_attempt_key =
        'manager_aging:reminder:91500000-0000-4000-8000-000000000001:v1'
      and delivery_review_reason = 'notice_attempt_in_flight'
      and reminder_sent_at is null
      and notice_attempt_mapping_fingerprint ~ '^[a-f0-9]{64}$'
    from public.refund_manager_attention_states
    where refund_case_id = '91500000-0000-4000-8000-000000000001'
  ),
  'The durable in-flight hold exists before any provider result is recorded'
);

select is(
  (
    public.service_authorize_refund_manager_aging_notice(
      '91500000-0000-4000-8000-000000000001', 1, 'escalation',
      '2026-08-10 17:00:00+00', 'America/Los_Angeles', 2, 5,
      'refund_manager_aging_v1'
    ) ->> 'reason'
  ),
  'delivery_review_required',
  'An in-flight reminder blocks a newer escalation milestone'
);

select ok(
  pg_temp.capture_error($test$
    select public.service_complete_refund_manager_aging_notice(
      '91500000-0000-4000-8000-000000000001',
      'manager_aging:reminder:91500000-0000-4000-8000-000000000001:v1',
      'operations_exception'
    )
  $test$) like '%must match the reserved recipient route%',
  'A known-sent settlement cannot change the bound recipient route'
);

select is(
  public.service_complete_refund_manager_aging_notice(
    '91500000-0000-4000-8000-000000000001',
    'manager_aging:reminder:91500000-0000-4000-8000-000000000001:v1',
    'delivered'
  ),
  true,
  'A delivered reservation settles exactly once'
);

select ok(
  (
    select reminder_sent_at is not null
      and reminder_resolved_at is not null
      and notice_attempt_key is null
      and delivery_review_required_at is null
    from public.refund_manager_attention_states
    where refund_case_id = '91500000-0000-4000-8000-000000000001'
  ),
  'Known delivery consumes the milestone and clears its global hold'
);

select is(
  public.service_complete_refund_manager_aging_notice(
    '91500000-0000-4000-8000-000000000001',
    'manager_aging:reminder:91500000-0000-4000-8000-000000000001:v1',
    'delivered'
  ),
  false,
  'A settled attempt key cannot be replayed'
);

select ok(
  not exists (
    select 1
    from public.refund_case_events event
    where event.refund_case_id = '91500000-0000-4000-8000-000000000001'
      and event.event_type like 'refund_manager_aging%'
      and (
        event.metadata::text ilike '%aging-customer@example.test%'
        or event.metadata::text ilike '%aging-manager@example.test%'
        or event.metadata::text ilike '%aging-cash-contact@example.test%'
        or event.metadata::text ilike '%987654%'
        or event.metadata::text ilike '%synthetic complaint%'
      )
  ),
  'Attempt and settlement audit evidence omits recipients, customer, payment, and complaint content'
);

update public.refund_cases
set status = 'waiting_on_customer', automation_state = 'more_info_needed'
where id = '91500000-0000-4000-8000-000000000001';

select ok(
  (
    select attention_started_at is null and attention_version = 2
    from public.refund_manager_attention_states
    where refund_case_id = '91500000-0000-4000-8000-000000000001'
  ),
  'Waiting on the customer cancels the stale manager attention clock'
);

insert into public.refund_gmail_threads (
  id,
  refund_case_id,
  mailbox_hash,
  provider_thread_id,
  thread_subject,
  first_message_at,
  latest_message_at,
  retention_expires_at
) values (
  '91600000-0000-4000-8000-000000000001',
  '91500000-0000-4000-8000-000000000001',
  repeat('a', 64),
  'aging-thread-1',
  'Synthetic refund thread',
  now() - interval '2 days',
  now(),
  now() + interval '180 days'
);

insert into public.refund_gmail_messages (
  id, gmail_thread_id, refund_case_id, provider_message_id, direction,
  message_kind, status, sender_email, recipient_email, subject, plain_body,
  participant_role, participant_trust, received_at, retention_expires_at
) values (
  '91700000-0000-4000-8000-000000000001',
  '91600000-0000-4000-8000-000000000001',
  '91500000-0000-4000-8000-000000000001',
  'aging-message-1',
  'inbound', 'message', 'received',
  'aging-customer@example.test', 'info@example.test',
  'Synthetic reply', 'Synthetic reply content',
  'customer', 'verified',
  now() + interval '365 days',
  now() + interval '730 days'
);

select ok(
  (
    select attention_started_at is null
      and attention_version = 3
      and source_customer_message_id = '91700000-0000-4000-8000-000000000001'
      and source_customer_message_received_at <= source_customer_message_created_at
      and source_customer_message_created_at <= statement_timestamp()
    from public.refund_manager_attention_states
    where refund_case_id = '91500000-0000-4000-8000-000000000001'
  ),
  'A future provider timestamp is clamped to trusted database-created evidence'
);

update public.refund_gmail_messages
set participant_role = 'customer', participant_trust = 'verified'
where id = '91700000-0000-4000-8000-000000000001';

select is(
  (
    select attention_version
    from public.refund_manager_attention_states
    where refund_case_id = '91500000-0000-4000-8000-000000000001'
  ),
  3::bigint,
  'Replaying the same future-dated provider message does not create another version'
);

insert into public.refund_gmail_messages (
  id, gmail_thread_id, refund_case_id, provider_message_id, direction,
  message_kind, status, sender_email, recipient_email, subject, plain_body,
  participant_role, participant_trust, received_at, retention_expires_at
) values (
  '91700000-0000-4000-8000-000000000002',
  '91600000-0000-4000-8000-000000000001',
  '91500000-0000-4000-8000-000000000001',
  'aging-message-2',
  'inbound', 'message', 'received',
  'aging-customer@example.test', 'info@example.test',
  'Synthetic second reply', 'Synthetic second reply content',
  'customer', 'verified',
  now() + interval '365 days',
  now() + interval '730 days'
);

select is(
  (
    select attention_version
    from public.refund_manager_attention_states
    where refund_case_id = '91500000-0000-4000-8000-000000000001'
  ),
  4::bigint,
  'A distinct reply with the same provider timestamp advances by trusted created_at and id'
);

update public.refund_gmail_messages
set participant_role = 'customer', participant_trust = 'verified'
where id = '91700000-0000-4000-8000-000000000001';

select is(
  (
    select attention_version
    from public.refund_manager_attention_states
    where refund_case_id = '91500000-0000-4000-8000-000000000001'
  ),
  4::bigint,
  'Reprocessing an older created_at/id tuple cannot supersede the latest reply'
);

update public.refund_cases
set status = 'needs_review', automation_state = 'customer_reply_review'
where id = '91500000-0000-4000-8000-000000000001';

select ok(
  (
    select attention_started_at is not null and attention_version = 5
    from public.refund_manager_attention_states
    where refund_case_id = '91500000-0000-4000-8000-000000000001'
  ),
  'Manager re-evaluation starts a fresh clock after verified replies'
);

update public.refund_manager_attention_states
set attention_started_at = '2026-08-03 17:00:00+00'
where refund_case_id = '91500000-0000-4000-8000-000000000001';

update public.refund_gmail_threads
set
  automatic_customer_contact_paused_at = now(),
  automatic_customer_contact_pause_reason = 'hard_bounce'
where id = '91600000-0000-4000-8000-000000000001';

select is(
  (
    public.service_authorize_refund_manager_aging_notice(
      '91500000-0000-4000-8000-000000000001', 5, 'escalation',
      '2026-08-10 17:00:00+00', 'America/Los_Angeles', 2, 5,
      'refund_manager_aging_v1'
    ) ->> 'reason'
  ),
  'customer_bounce_hold',
  'A case-wide bounce hold suppresses an internal aging escalation'
);

update public.refund_gmail_threads
set
  automatic_customer_contact_paused_at = null,
  automatic_customer_contact_pause_reason = null
where id = '91600000-0000-4000-8000-000000000001';

select is(
  pg_temp.claim_aging_action(
    '91500000-0000-4000-8000-000000000001', 5, 'escalation'
  ),
  true,
  'The version-five escalation receives its action claim'
);

select is(
  (
    public.service_begin_refund_manager_aging_notice_attempt(
      '91500000-0000-4000-8000-000000000001', 5, 'escalation',
      '2026-08-10 17:00:00+00', 'America/Los_Angeles', 2, 5,
      'refund_manager_aging_v1',
      'manager_aging:escalation:91500000-0000-4000-8000-000000000001:v5',
      array['info@bloomjoysweets.com', 'support@bloomjoysweets.com'],
      array['ops-refunds@example.test']
    ) ->> 'attemptStarted'
  )::boolean,
  true,
  'A due escalation creates its pre-send reservation'
);

insert into public.refund_gmail_messages (
  id, gmail_thread_id, refund_case_id, provider_message_id, direction,
  message_kind, status, sender_email, recipient_email, subject, plain_body,
  participant_role, participant_trust, received_at, retention_expires_at
) values (
  '91700000-0000-4000-8000-000000000003',
  '91600000-0000-4000-8000-000000000001',
  '91500000-0000-4000-8000-000000000001',
  'aging-message-3',
  'inbound', 'message', 'received',
  'aging-customer@example.test', 'info@example.test',
  'Synthetic third reply', 'Synthetic third reply content',
  'customer', 'verified', now(), now() + interval '180 days'
);

update public.refund_cases
set correlation_status = 'multiple_candidates'
where id = '91500000-0000-4000-8000-000000000001';

select ok(
  (
    select attention_version = 7
      and notice_attempt_attention_version = 5
      and delivery_review_reason = 'notice_attempt_in_flight'
    from public.refund_manager_attention_states
    where refund_case_id = '91500000-0000-4000-8000-000000000001'
  ),
  'Reply and case re-evaluation preserve the old attempt as a global hold'
);

update public.refund_manager_attention_states
set attention_started_at = '2026-08-03 17:00:00+00'
where refund_case_id = '91500000-0000-4000-8000-000000000001';

select is(
  (
    public.service_authorize_refund_manager_aging_notice(
      '91500000-0000-4000-8000-000000000001', 7, 'escalation',
      '2026-08-10 17:00:00+00', 'America/Los_Angeles', 2, 5,
      'refund_manager_aging_v1'
    ) ->> 'reason'
  ),
  'delivery_review_required',
  'The old in-flight attempt blocks every newer attention version'
);

select is(
  public.service_complete_refund_manager_aging_notice(
    '91500000-0000-4000-8000-000000000001',
    'manager_aging:escalation:91500000-0000-4000-8000-000000000001:v5',
    'delivered'
  ),
  true,
  'A bound known-sent settlement can reconcile an older attempt'
);

select ok(
  (
    select attention_version = 7
      and notice_attempt_key is null
      and delivery_review_required_at is null
      and escalation_sent_at is null
      and escalation_resolved_at is null
    from public.refund_manager_attention_states
    where refund_case_id = '91500000-0000-4000-8000-000000000001'
  ),
  'Old-attempt settlement clears the hold without marking the newer milestone'
);

select is(
  (
    select metadata ->> 'settled_current_attention_version'
    from public.refund_case_events
    where refund_case_id = '91500000-0000-4000-8000-000000000001'
      and event_type = 'refund_manager_aging_notice_sent'
      and metadata ->> 'attempt_attention_version' = '5'
    order by created_at desc, id desc
    limit 1
  ),
  'false',
  'The recovery audit explicitly records the cross-version settlement'
);

select is(
  pg_temp.claim_aging_action(
    '91500000-0000-4000-8000-000000000001', 7, 'escalation'
  ),
  true,
  'The newer escalation can reserve only after the old hold is reconciled'
);

select is(
  (
    public.service_begin_refund_manager_aging_notice_attempt(
      '91500000-0000-4000-8000-000000000001', 7, 'escalation',
      '2026-08-10 17:00:00+00', 'America/Los_Angeles', 2, 5,
      'refund_manager_aging_v1',
      'manager_aging:escalation:91500000-0000-4000-8000-000000000001:v7',
      array['info@bloomjoysweets.com', 'support@bloomjoysweets.com'],
      array['ops-refunds@example.test']
    ) ->> 'attemptStarted'
  )::boolean,
  true,
  'The newer escalation receives its own bound attempt'
);

select is(
  public.service_complete_refund_manager_aging_notice(
    '91500000-0000-4000-8000-000000000001',
    'manager_aging:escalation:91500000-0000-4000-8000-000000000001:v7',
    'delivery_unknown'
  ),
  true,
  'Uncertain provider delivery converts the in-flight hold to manual review'
);

update public.refund_cases
set correlation_status = 'manual_review'
where id = '91500000-0000-4000-8000-000000000001';

update public.refund_manager_attention_states
set attention_started_at = '2026-08-03 17:00:00+00'
where refund_case_id = '91500000-0000-4000-8000-000000000001';

select ok(
  (
    select attention_version = 8
      and notice_attempt_attention_version = 7
      and delivery_review_reason = 'delivery_unknown'
    from public.refund_manager_attention_states
    where refund_case_id = '91500000-0000-4000-8000-000000000001'
  ),
  'An unknown attempt remains a global hold after another version change'
);

select is(
  (
    public.service_authorize_refund_manager_aging_notice(
      '91500000-0000-4000-8000-000000000001', 8, 'reminder',
      '2026-08-10 17:00:00+00', 'America/Los_Angeles', 2, 5,
      'refund_manager_aging_v1'
    ) ->> 'reason'
  ),
  'delivery_review_required',
  'Unknown delivery blocks even a different milestone on the newer version'
);

select is(
  public.service_complete_refund_manager_aging_notice(
    '91500000-0000-4000-8000-000000000001',
    'manager_aging:escalation:91500000-0000-4000-8000-000000000001:v7',
    'delivered'
  ),
  true,
  'Manual known-sent recovery clears an old unknown attempt'
);

select ok(
  (
    select attention_version = 8
      and notice_attempt_key is null
      and delivery_review_required_at is null
      and escalation_sent_at is null
      and escalation_resolved_at is null
    from public.refund_manager_attention_states
    where refund_case_id = '91500000-0000-4000-8000-000000000001'
  ),
  'Unknown recovery also leaves the newer attention version untouched'
);

select is(
  pg_temp.claim_aging_action(
    '91500000-0000-4000-8000-000000000001', 8, 'reminder'
  ),
  true,
  'A known-not-sent recovery fixture claims the current reminder'
);

select is(
  (
    public.service_begin_refund_manager_aging_notice_attempt(
      '91500000-0000-4000-8000-000000000001', 8, 'reminder',
      '2026-08-05 17:00:00+00', 'America/Los_Angeles', 2, 5,
      'refund_manager_aging_v1',
      'manager_aging:reminder:91500000-0000-4000-8000-000000000001:v8',
      array['info@bloomjoysweets.com', 'support@bloomjoysweets.com'],
      array['ops-refunds@example.test']
    ) ->> 'attemptStarted'
  )::boolean,
  true,
  'The known-not-sent fixture reserves before its version race'
);

update public.refund_cases
set correlation_status = 'no_match'
where id = '91500000-0000-4000-8000-000000000001';

select is(
  public.service_complete_refund_manager_aging_notice(
    '91500000-0000-4000-8000-000000000001',
    'manager_aging:reminder:91500000-0000-4000-8000-000000000001:v8',
    'known_not_sent'
  ),
  true,
  'A bound known-not-sent settlement can clear an old-version hold'
);

select ok(
  (
    select attention_version = 9
      and notice_attempt_key is null
      and reminder_sent_at is null
      and reminder_resolved_at is null
    from public.refund_manager_attention_states
    where refund_case_id = '91500000-0000-4000-8000-000000000001'
  ),
  'Known-not-sent recovery does not consume the newer version milestone'
);

update public.refund_manager_attention_states
set attention_started_at = '2026-08-03 17:00:00+00'
where refund_case_id = '91500000-0000-4000-8000-000000000001';

select is(
  public.service_resolve_refund_customer_manager_cc(
    '91500000-0000-4000-8000-000000000001',
    'aging-customer@example.test',
    array['info@bloomjoysweets.com', 'support@bloomjoysweets.com']
  ) #>> '{managerCcEmails,0}',
  'aging-manager@example.test',
  'An earlier, stale manager lookup resolves manager A'
);

update public.reporting_machine_refund_managers
set status = 'revoked', revoked_at = now(), revoke_reason = 'Synthetic A-to-B remap'
where id = '91400000-0000-4000-8000-000000000001';

insert into public.reporting_machine_refund_managers (
  id, reporting_machine_id, manager_user_id, manager_email, status, grant_reason
) values (
  '91400000-0000-4000-8000-000000000002',
  '91300000-0000-4000-8000-000000000001',
  '91000000-0000-4000-8000-000000000002',
  'aging-manager-b@example.test',
  'active',
  'Synthetic A-to-B manager remap'
);

select is(
  pg_temp.claim_aging_action(
    '91500000-0000-4000-8000-000000000001', 9, 'reminder'
  ),
  true,
  'The version-nine reminder receives its deterministic claim'
);

select ok(
  (
    with attempt as (
      select public.service_begin_refund_manager_aging_notice_attempt(
        '91500000-0000-4000-8000-000000000001', 9, 'reminder',
        '2026-08-05 17:00:00+00', 'America/Los_Angeles', 2, 5,
        'refund_manager_aging_v1',
        'manager_aging:reminder:91500000-0000-4000-8000-000000000001:v9',
        array['info@bloomjoysweets.com', 'support@bloomjoysweets.com'],
        array['ops-refunds@example.test']
      ) result
    )
    select (result ->> 'attemptStarted')::boolean
      and result #>> '{recipientRoute,routeType}' = 'manager'
      and result #>> '{recipientRoute,recipients,0}' =
        'aging-manager-b@example.test'
      and jsonb_array_length(result #> '{recipientRoute,recipients}') = 1
      and result #> '{recipientRoute,recipients}' @>
        '["aging-manager@example.test"]'::jsonb is false
      and result #>> '{recipientRoute,mappingFingerprint}' ~ '^[a-f0-9]{64}$'
    from attempt
  ),
  'The final reservation re-resolves manager B and manager A cannot reach transport'
);

select is(
  public.service_complete_refund_manager_aging_notice(
    '91500000-0000-4000-8000-000000000001',
    'manager_aging:reminder:91500000-0000-4000-8000-000000000001:v9',
    'delivered'
  ),
  true,
  'The manager-B reservation settles only its reminder milestone'
);

update public.reporting_machine_refund_managers
set
  manager_email = 'not-an-email',
  status = 'active',
  revoked_at = null,
  revoke_reason = null
where id = '91400000-0000-4000-8000-000000000001';

select is(
  pg_temp.claim_aging_action(
    '91500000-0000-4000-8000-000000000001', 9, 'escalation'
  ),
  true,
  'The version-nine escalation receives its deterministic claim'
);

select is(
  public.service_begin_refund_manager_aging_notice_attempt(
    '91500000-0000-4000-8000-000000000001', 9, 'escalation',
    '2026-08-10 17:00:00+00', 'America/Los_Angeles', 2, 5,
    'refund_manager_aging_v1',
    'manager_aging:escalation:91500000-0000-4000-8000-000000000001:v9',
    array['info@bloomjoysweets.com', 'support@bloomjoysweets.com'],
    array[
      'ops-1@example.test', 'ops-2@example.test', 'ops-3@example.test',
      'ops-4@example.test', 'ops-5@example.test', 'ops-6@example.test'
    ]
  ) ->> 'reason',
  'ops_fallback_policy_invalid',
  'An over-cap operations route fails closed before reserving delivery'
);

select ok(
  (
    with attempt as (
      select public.service_begin_refund_manager_aging_notice_attempt(
        '91500000-0000-4000-8000-000000000001', 9, 'escalation',
        '2026-08-10 17:00:00+00', 'America/Los_Angeles', 2, 5,
        'refund_manager_aging_v1',
        'manager_aging:escalation:91500000-0000-4000-8000-000000000001:v9',
        array['info@bloomjoysweets.com', 'support@bloomjoysweets.com'],
        array['ops-refunds@example.test']
      ) result
    )
    select (result ->> 'attemptStarted')::boolean
      and result #>> '{recipientRoute,routeType}' = 'operations'
      and result #>> '{recipientRoute,recipients,0}' =
        'ops-refunds@example.test'
      and result #>> '{recipientRoute,managerRecipientCount}' = '0'
      and result #>> '{recipientRoute,mappingFingerprint}' ~ '^[a-f0-9]{64}$'
    from attempt
  ),
  'A mixed valid and malformed active-manager route uses the bounded operations fallback without a partial manager notice'
);

select is(
  public.service_complete_refund_manager_aging_notice(
    '91500000-0000-4000-8000-000000000001',
    'manager_aging:escalation:91500000-0000-4000-8000-000000000001:v9',
    'operations_exception'
  ),
  true,
  'The sent operations exception settles only its escalation milestone'
);

update public.reporting_machine_refund_managers
set
  status = 'revoked',
  revoked_at = now(),
  revoke_reason = 'Synthetic malformed mapping repair'
where id = '91400000-0000-4000-8000-000000000001';

insert into public.refund_gmail_messages (
  id, gmail_thread_id, refund_case_id, provider_message_id, direction,
  message_kind, status, sender_email, recipient_email, subject, plain_body,
  participant_role, participant_trust, received_at, retention_expires_at
) values (
  '91700000-0000-4000-8000-000000000004',
  '91600000-0000-4000-8000-000000000001',
  '91500000-0000-4000-8000-000000000001',
  'aging-message-4',
  'inbound', 'message', 'received',
  'aging-customer@example.test', 'info@example.test',
  'Synthetic fourth reply', 'Synthetic fourth reply content',
  'customer', 'verified', now(), now() + interval '180 days'
);

update public.refund_cases
set correlation_status = 'matched'
where id = '91500000-0000-4000-8000-000000000001';

update public.refund_manager_attention_states
set attention_started_at = '2026-08-03 17:00:00+00'
where refund_case_id = '91500000-0000-4000-8000-000000000001';

select is(
  pg_temp.claim_aging_action(
    '91500000-0000-4000-8000-000000000001', 11, 'escalation'
  ),
  true,
  'A missed reminder window can claim the direct escalation'
);

select is(
  (
    public.service_begin_refund_manager_aging_notice_attempt(
      '91500000-0000-4000-8000-000000000001', 11, 'escalation',
      '2026-08-10 17:00:00+00', 'America/Los_Angeles', 2, 5,
      'refund_manager_aging_v1',
      'manager_aging:escalation:91500000-0000-4000-8000-000000000001:v11',
      array['info@bloomjoysweets.com', 'support@bloomjoysweets.com'],
      array['ops-refunds@example.test']
    ) ->> 'attemptStarted'
  )::boolean,
  true,
  'The direct escalation is reserved at five business days'
);

select is(
  public.service_complete_refund_manager_aging_notice(
    '91500000-0000-4000-8000-000000000001',
    'manager_aging:escalation:91500000-0000-4000-8000-000000000001:v11',
    'delivered'
  ),
  true,
  'The direct escalation settles for the current mapped manager'
);

select is(
  (
    public.service_authorize_refund_manager_aging_notice(
      '91500000-0000-4000-8000-000000000001', 11, 'reminder',
      '2026-08-10 18:00:00+00', 'America/Los_Angeles', 2, 5,
      'refund_manager_aging_v1'
    ) ->> 'reason'
  ),
  'higher_milestone_already_resolved',
  'A resolved escalation suppresses a late lower-priority reminder'
);

update public.refund_cases
set status = 'completed', automation_state = 'completed'
where id = '91500000-0000-4000-8000-000000000001';

select ok(
  (
    select attention_started_at is null and attention_version = 12
    from public.refund_manager_attention_states
    where refund_case_id = '91500000-0000-4000-8000-000000000001'
  ),
  'Completion terminates manager aging and invalidates outstanding notices'
);

-- Starvation proof: 100 resolved rows sort before a 101st due row. The service
-- RPC filters resolved/non-due work before applying its cap, then the 101st row
-- can be claimed and reserved by the same worker contract.
insert into public.refund_cases (
  id,
  public_reference,
  reporting_machine_id,
  reporting_location_id,
  customer_email,
  issue_summary,
  incident_at,
  payment_method,
  status,
  automation_state
)
select
  md5('refund-aging-bulk-' || series)::uuid,
  'RF-AGING-BULK-' || lpad(series::text, 3, '0'),
  '91300000-0000-4000-8000-000000000001'::uuid,
  '91200000-0000-4000-8000-000000000001'::uuid,
  'bulk-aging-customer@example.test',
  'Synthetic starvation proof',
  now() - interval '10 days',
  'card',
  'needs_review',
  'under_review'
from generate_series(1, 101) series;

update public.refund_manager_attention_states attention
set
  attention_started_at = '2026-08-03 17:00:00+00',
  reminder_resolved_at = case
    when refund_case.public_reference <> 'RF-AGING-BULK-101'
      then '2026-08-05 17:00:00+00'::timestamptz
    else null
  end,
  escalation_resolved_at = case
    when refund_case.public_reference <> 'RF-AGING-BULK-101'
      then '2026-08-10 17:00:00+00'::timestamptz
    else null
  end
from public.refund_cases refund_case
where refund_case.id = attention.refund_case_id
  and refund_case.public_reference like 'RF-AGING-BULK-%';

select is(
  (
    select refund_case.public_reference
    from public.service_list_due_refund_manager_aging_notices(
      '2026-08-10 17:00:00+00',
      'America/Los_Angeles',
      2,
      5,
      'refund_manager_aging_v1',
      1
    ) due
    join public.refund_cases refund_case on refund_case.id = due.refund_case_id
  ),
  'RF-AGING-BULK-101',
  'The 101st due case is returned even when 100 earlier rows are resolved'
);

select is(
  pg_temp.claim_aging_action(
    md5('refund-aging-bulk-101')::uuid,
    1,
    'escalation'
  ),
  true,
  'The 101st due case receives its deterministic action claim'
);

select is(
  (
    public.service_begin_refund_manager_aging_notice_attempt(
      md5('refund-aging-bulk-101')::uuid,
      1,
      'escalation',
      '2026-08-10 17:00:00+00',
      'America/Los_Angeles',
      2,
      5,
      'refund_manager_aging_v1',
      format(
        'manager_aging:escalation:%s:v1',
        md5('refund-aging-bulk-101')::uuid
      ),
      array['info@bloomjoysweets.com', 'support@bloomjoysweets.com'],
      array['ops-refunds@example.test']
    ) ->> 'attemptStarted'
  )::boolean,
  true,
  'The worker contract processes the 101st case through its durable pre-send hold'
);

select is(
  public.service_complete_refund_manager_aging_notice(
    md5('refund-aging-bulk-101')::uuid,
    format(
      'manager_aging:escalation:%s:v1',
      md5('refund-aging-bulk-101')::uuid
    ),
    'known_not_sent'
  ),
  true,
  'Known-not-sent recovery closes the processed 101st milestone without claiming delivery'
);

select ok(
  not exists (
    select 1
    from public.refund_case_events event
    where event.event_type like 'refund_manager_aging%'
      and event.metadata::text ilike any(array[
        '%aging-customer@example.test%',
        '%aging-manager@example.test%',
        '%aging-manager-b@example.test%',
        '%ops-refunds@example.test%'
      ])
  ),
  'All manager-aging audits omit customer, manager, and operations addresses'
);

select ok(
  not exists (
    select 1
    from public.refund_case_events event
    where event.event_type like 'refund_manager_aging%'
      and event.metadata ? 'mapping_fingerprint'
      and event.metadata ->> 'mapping_fingerprint' in (
        select encode(
          extensions.digest(convert_to(address, 'UTF8'), 'sha256'),
          'hex'
        )
        from unnest(array[
          'aging-manager@example.test',
          'aging-manager-b@example.test',
          'ops-refunds@example.test'
        ]) address
      )
  ),
  'Persisted mapping fingerprints are not unsalted hashes of recipient addresses'
);

select ok(
  not exists (
    select 1
    from public.refund_case_events event
    where event.event_type = 'refund_manager_aging_notice_attempt_started'
      and coalesce(event.metadata ->> 'mapping_fingerprint', '') !~
        '^[a-f0-9]{64}$'
  ),
  'Every reserved route has a canonical non-PII mapping fingerprint'
);

select * from finish();
rollback;
