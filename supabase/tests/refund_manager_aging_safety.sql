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
  'card',
  725,
  '4242',
  'needs_review',
  'under_review'
);

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
    'public.service_authorize_refund_manager_aging_notice(uuid,bigint,text,timestamp with time zone,text,integer,integer,text)',
    'execute'
  ),
  'Browser roles cannot authorize a manager aging notice'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.service_authorize_refund_manager_aging_notice(uuid,bigint,text,timestamp with time zone,text,integer,integer,text)',
    'execute'
  ),
  'Only the service workflow receives manager aging authorization'
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

select ok(
  (
    select attention_started_at is not null
    from public.refund_manager_attention_states
    where refund_case_id = '91500000-0000-4000-8000-000000000001'
  ),
  'A manager-actionable case starts its attention clock'
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

select ok(
  pg_temp.capture_error($test$
    select public.service_complete_refund_manager_aging_notice(
      '91500000-0000-4000-8000-000000000001', 1, 'reminder', 'delivered',
      'refund_manager_aging_v1', 2, 0, 1, 'no_active_managers'
    )
  $test$) like '%require mapped-manager recipients only%',
  'A delivered outcome cannot be recorded without mapped-manager recipients'
);

select ok(
  pg_temp.capture_error($test$
    select public.service_complete_refund_manager_aging_notice(
      '91500000-0000-4000-8000-000000000001', 1, 'reminder', 'operations_exception',
      'refund_manager_aging_v1', 2, 1, 1, 'resolved'
    )
  $test$) like '%require bounded internal recipients only%',
  'An operations exception cannot assert a mapped-manager recipient'
);

select ok(
  pg_temp.capture_error($test$
    select public.service_complete_refund_manager_aging_notice(
      '91500000-0000-4000-8000-000000000001', 1, 'reminder', 'delivery_unknown',
      'refund_manager_aging_v1', 2, 0, 1, 'delivery_unknown'
    )
  $test$) like '%cannot assert recipients%',
  'Unknown delivery cannot claim a known recipient count'
);

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
  'A two-business-day manager reminder is authorized exactly at its milestone'
);

select is(
  public.service_complete_refund_manager_aging_notice(
    '91500000-0000-4000-8000-000000000001',
    1,
    'reminder',
    'delivered',
    'refund_manager_aging_v1',
    2,
    1,
    1,
    'resolved'
  ),
  true,
  'A delivered reminder settles its milestone once'
);

select is(
  (
    public.service_authorize_refund_manager_aging_notice(
      '91500000-0000-4000-8000-000000000001',
      1,
      'reminder',
      '2026-08-05 18:00:00+00',
      'America/Los_Angeles',
      2,
      5,
      'refund_manager_aging_v1'
    ) ->> 'reason'
  ),
  'reminder_already_sent',
  'The same attention version cannot send a duplicate reminder'
);

select is(
  (
    select metadata ->> 'payload_redacted'
    from public.refund_case_events
    where refund_case_id = '91500000-0000-4000-8000-000000000001'
      and event_type = 'refund_manager_aging_notice_sent'
    order by created_at desc
    limit 1
  ),
  'true',
  'Manager aging audit evidence is explicitly redacted'
);

select ok(
  not exists (
    select 1
    from public.refund_case_events event
    where event.refund_case_id = '91500000-0000-4000-8000-000000000001'
      and event.event_type = 'refund_manager_aging_notice_sent'
      and (
        event.metadata::text ilike '%aging-customer@example.test%'
        or event.metadata::text ilike '%4242%'
        or event.metadata::text ilike '%synthetic complaint%'
      )
  ),
  'Audit metadata omits customer, payment, and complaint content'
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
  id,
  gmail_thread_id,
  refund_case_id,
  provider_message_id,
  direction,
  message_kind,
  status,
  sender_email,
  recipient_email,
  subject,
  plain_body,
  participant_role,
  participant_trust,
  received_at,
  retention_expires_at
) values (
  '91700000-0000-4000-8000-000000000001',
  '91600000-0000-4000-8000-000000000001',
  '91500000-0000-4000-8000-000000000001',
  'aging-message-1',
  'inbound',
  'message',
  'received',
  'aging-customer@example.test',
  'info@example.test',
  'Synthetic reply',
  'Synthetic reply content',
  'customer',
  'verified',
  now(),
  now() + interval '180 days'
);

select ok(
  (
    select attention_started_at is null
      and attention_version = 3
      and source_customer_message_id = '91700000-0000-4000-8000-000000000001'
    from public.refund_manager_attention_states
    where refund_case_id = '91500000-0000-4000-8000-000000000001'
  ),
  'A verified customer reply invalidates the old version while customer work is pending'
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
  'Reprocessing the same verified customer message does not create another version'
);

update public.refund_cases
set status = 'needs_review', automation_state = 'customer_reply_review'
where id = '91500000-0000-4000-8000-000000000001';

select ok(
  (
    select attention_started_at is not null and attention_version = 4
    from public.refund_manager_attention_states
    where refund_case_id = '91500000-0000-4000-8000-000000000001'
  ),
  'Customer re-evaluation starts one fresh manager-ready attention version'
);

select is(
  (
    public.service_authorize_refund_manager_aging_notice(
      '91500000-0000-4000-8000-000000000001',
      1,
      'escalation',
      now() + interval '10 days',
      'America/Los_Angeles',
      2,
      5,
      'refund_manager_aging_v1'
    ) ->> 'reason'
  ),
  'stale_attention_version',
  'An old reminder version cannot act after a customer response'
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
      '91500000-0000-4000-8000-000000000001',
      4,
      'escalation',
      '2026-08-10 17:00:00+00',
      'America/Los_Angeles',
      2,
      5,
      'refund_manager_aging_v1'
    ) ->> 'reason'
  ),
  'customer_bounce_hold',
  'A case-wide customer bounce hold suppresses an aging escalation'
);

update public.refund_gmail_threads
set
  automatic_customer_contact_paused_at = null,
  automatic_customer_contact_pause_reason = null
where id = '91600000-0000-4000-8000-000000000001';

select is(
  public.service_complete_refund_manager_aging_notice(
    '91500000-0000-4000-8000-000000000001',
    4,
    'escalation',
    'delivery_unknown',
    'refund_manager_aging_v1',
    5,
    0,
    0,
    'delivery_unknown'
  ),
  true,
  'Uncertain delivery creates durable manual-review state'
);

select is(
  (
    public.service_authorize_refund_manager_aging_notice(
      '91500000-0000-4000-8000-000000000001',
      4,
      'escalation',
      '2026-08-11 17:00:00+00',
      'America/Los_Angeles',
      2,
      5,
      'refund_manager_aging_v1'
    ) ->> 'reason'
  ),
  'delivery_review_required',
  'Unknown delivery is never retried automatically'
);

update public.refund_cases
set correlation_status = 'multiple_candidates'
where id = '91500000-0000-4000-8000-000000000001';

select ok(
  (
    select attention_version = 5
      and delivery_review_required_at is null
      and reminder_sent_at is null
      and escalation_sent_at is null
    from public.refund_manager_attention_states
    where refund_case_id = '91500000-0000-4000-8000-000000000001'
  ),
  'A new manager-relevant case state starts a clean attention version'
);

update public.refund_manager_attention_states
set attention_started_at = '2026-08-03 17:00:00+00'
where refund_case_id = '91500000-0000-4000-8000-000000000001';

update public.reporting_machine_refund_managers
set
  status = 'revoked',
  revoked_at = now(),
  revoke_reason = 'Synthetic zero-manager reminder route'
where id = '91400000-0000-4000-8000-000000000001';

select is(
  public.service_resolve_refund_customer_manager_cc(
    '91500000-0000-4000-8000-000000000001',
    'aging-customer@example.test',
    array['info@bloomjoysweets.com', 'support@bloomjoysweets.com']
  ) ->> 'status',
  'no_active_managers',
  'A send-time resolution with no current manager is an explicit routing exception'
);

select is(
  (
    public.service_authorize_refund_manager_aging_notice(
      '91500000-0000-4000-8000-000000000001',
      5,
      'reminder',
      '2026-08-05 17:00:00+00',
      'America/Los_Angeles',
      2,
      5,
      'refund_manager_aging_v1'
    ) ->> 'authorized'
  )::boolean,
  true,
  'The zero-manager reminder is due before its redacted routing exception is settled'
);

select is(
  public.service_complete_refund_manager_aging_notice(
    '91500000-0000-4000-8000-000000000001',
    5,
    'reminder',
    'operations_exception',
    'refund_manager_aging_v1',
    2,
    0,
    1,
    'no_active_managers'
  ),
  true,
  'A bounded redacted operations exception consumes only the due reminder milestone'
);

insert into public.reporting_machine_refund_managers (
  id, reporting_machine_id, manager_user_id, manager_email, status, grant_reason
) values (
  '91400000-0000-4000-8000-000000000002',
  '91300000-0000-4000-8000-000000000001',
  '91000000-0000-4000-8000-000000000001',
  'aging-manager@example.test',
  'active',
  'Synthetic manager mapping repair'
);

select is(
  public.service_resolve_refund_customer_manager_cc(
    '91500000-0000-4000-8000-000000000001',
    'aging-customer@example.test',
    array['info@bloomjoysweets.com', 'support@bloomjoysweets.com']
  ) -> 'managerCcEmails',
  '["aging-manager@example.test"]'::jsonb,
  'A mapping repair is used by the next send-time resolution'
);

select is(
  (
    public.service_authorize_refund_manager_aging_notice(
      '91500000-0000-4000-8000-000000000001',
      5,
      'escalation',
      '2026-08-10 17:00:00+00',
      'America/Los_Angeles',
      2,
      5,
      'refund_manager_aging_v1'
    ) ->> 'authorized'
  )::boolean,
  true,
  'The consumed routing-exception reminder does not block the later escalation milestone'
);

update public.reporting_machine_refund_managers
set
  status = 'revoked',
  revoked_at = now(),
  revoke_reason = 'Synthetic manager mapping revocation'
where id = '91400000-0000-4000-8000-000000000002';

select is(
  public.service_resolve_refund_customer_manager_cc(
    '91500000-0000-4000-8000-000000000001',
    'aging-customer@example.test',
    array['info@bloomjoysweets.com', 'support@bloomjoysweets.com']
  ) ->> 'status',
  'no_active_managers',
  'Revocation is reflected immediately instead of reusing a stale manager route'
);

insert into public.reporting_machine_refund_managers (
  id, reporting_machine_id, manager_user_id, manager_email, status, grant_reason
) values (
  '91400000-0000-4000-8000-000000000003',
  '91300000-0000-4000-8000-000000000001',
  '91000000-0000-4000-8000-000000000001',
  'aging-manager@example.test',
  'active',
  'Synthetic second manager mapping repair'
);

insert into public.refund_gmail_messages (
  id,
  gmail_thread_id,
  refund_case_id,
  provider_message_id,
  direction,
  message_kind,
  status,
  sender_email,
  recipient_email,
  subject,
  plain_body,
  participant_role,
  participant_trust,
  received_at,
  retention_expires_at
) values (
  '91700000-0000-4000-8000-000000000002',
  '91600000-0000-4000-8000-000000000001',
  '91500000-0000-4000-8000-000000000001',
  'aging-message-2',
  'inbound',
  'message',
  'received',
  'aging-customer@example.test',
  'info@example.test',
  'Synthetic second reply',
  'Synthetic second reply content',
  'customer',
  'verified',
  now() + interval '1 minute',
  now() + interval '180 days'
);

select ok(
  (
    select attention_started_at is null and attention_version = 6
    from public.refund_manager_attention_states
    where refund_case_id = '91500000-0000-4000-8000-000000000001'
  ),
  'A verified reply pauses reminders even if the case was still manager-actionable'
);

update public.refund_cases
set payment_amount_cents = payment_amount_cents + 1
where id = '91500000-0000-4000-8000-000000000001';

select ok(
  (
    select attention_started_at is not null and attention_version = 7
    from public.refund_manager_attention_states
    where refund_case_id = '91500000-0000-4000-8000-000000000001'
  ),
  'Explicit manager re-evaluation starts a fresh clock after the reply pause'
);

update public.refund_manager_attention_states
set attention_started_at = '2026-08-03 17:00:00+00'
where refund_case_id = '91500000-0000-4000-8000-000000000001';

select is(
  (
    public.service_authorize_refund_manager_aging_notice(
      '91500000-0000-4000-8000-000000000001',
      7,
      'escalation',
      '2026-08-10 17:00:00+00',
      'America/Los_Angeles',
      2,
      5,
      'refund_manager_aging_v1'
    ) ->> 'authorized'
  )::boolean,
  true,
  'A missed reminder window can advance directly to its due escalation'
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
  'The fixture can start a scheduler run'
);

select is(
  (
    public.service_claim_refund_automation_action(
      (
        select id from public.refund_automation_runs
        where run_key = 'scheduled:manager-aging-test'
      ),
      '91500000-0000-4000-8000-000000000001',
      'manager_aging:escalation:91500000-0000-4000-8000-000000000001:v7',
      'manager_escalation',
      'needs_review',
      date_trunc('hour', now())
    ) ->> 'claimed'
  )::boolean,
  true,
  'A manager escalation receives one deterministic action claim'
);

select is(
  (
    public.service_claim_refund_automation_action(
      (
        select id from public.refund_automation_runs
        where run_key = 'scheduled:manager-aging-test'
      ),
      '91500000-0000-4000-8000-000000000001',
      'manager_aging:escalation:91500000-0000-4000-8000-000000000001:v7',
      'manager_escalation',
      'needs_review',
      date_trunc('hour', now())
    ) ->> 'claimed'
  )::boolean,
  false,
  'Replaying the schedule cannot duplicate the manager escalation action'
);

select is(
  public.service_complete_refund_manager_aging_notice(
    '91500000-0000-4000-8000-000000000001',
    7,
    'escalation',
    'delivered',
    'refund_manager_aging_v1',
    5,
    1,
    1,
    'resolved'
  ),
  true,
  'A due escalation settles once for the current mapped manager'
);

select is(
  (
    public.service_authorize_refund_manager_aging_notice(
      '91500000-0000-4000-8000-000000000001',
      7,
      'reminder',
      '2026-08-10 18:00:00+00',
      'America/Los_Angeles',
      2,
      5,
      'refund_manager_aging_v1'
    ) ->> 'reason'
  ),
  'higher_milestone_already_sent',
  'A direct escalation suppresses a late lower-priority reminder'
);

update public.refund_cases
set status = 'completed', automation_state = 'completed'
where id = '91500000-0000-4000-8000-000000000001';

select ok(
  (
    select attention_started_at is null and attention_version = 8
    from public.refund_manager_attention_states
    where refund_case_id = '91500000-0000-4000-8000-000000000001'
  ),
  'Completion terminates manager aging and invalidates outstanding notices'
);

select * from finish();
rollback;
