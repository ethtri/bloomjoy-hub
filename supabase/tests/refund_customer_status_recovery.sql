begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select no_plan();

insert into public.customer_accounts (id, name, account_type)
values ('d1000000-0000-4000-8000-000000000001', 'Status recovery test', 'customer');

insert into public.reporting_locations (id, account_id, name, timezone)
values (
  'd2000000-0000-4000-8000-000000000001',
  'd1000000-0000-4000-8000-000000000001',
  'Status recovery location',
  'America/Los_Angeles'
);

insert into public.reporting_machines (id, account_id, location_id, machine_label)
values (
  'd3000000-0000-4000-8000-000000000001',
  'd1000000-0000-4000-8000-000000000001',
  'd2000000-0000-4000-8000-000000000001',
  'Status recovery machine'
);

insert into auth.users (
  instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  'd9000000-0000-4000-8000-000000000001',
  'authenticated','authenticated','status-manager@example.invalid','',now(),
  '{}'::jsonb,'{}'::jsonb,now(),now()
);
insert into public.reporting_machine_refund_managers (
  id,reporting_machine_id,manager_user_id,manager_email,grant_reason
) values (
  'da000000-0000-4000-8000-000000000001',
  'd3000000-0000-4000-8000-000000000001',
  'd9000000-0000-4000-8000-000000000001',
  'status-manager@example.invalid','Synthetic status delivery test'
);

insert into public.refund_cases (
  id, public_reference, reporting_machine_id, reporting_location_id,
  customer_email, issue_summary, incident_at, payment_method,
  payment_amount_cents, refund_amount_cents, card_last4, status,
  correlation_status, correlation_source, automation_state, created_at
) values
  (
    'd4000000-0000-4000-8000-000000000001', 'RF-STATUS-DUE',
    'd3000000-0000-4000-8000-000000000001',
    'd2000000-0000-4000-8000-000000000001',
    'status-due@example.invalid', '', statement_timestamp() - interval '9 days',
    'card', 700, 700, '4242', 'needs_review', 'needs_nayax', 'nayax',
    'under_review', statement_timestamp() - interval '9 days'
  ),
  (
    'd4000000-0000-4000-8000-000000000002', 'RF-STATUS-EARLY',
    'd3000000-0000-4000-8000-000000000001',
    'd2000000-0000-4000-8000-000000000001',
    'status-early@example.invalid', '', statement_timestamp(),
    'card', 700, 700, '4242', 'needs_review', 'needs_nayax', 'nayax',
    'under_review', statement_timestamp()
  );

insert into public.refund_cases (
  id, public_reference, reporting_machine_id, reporting_location_id,
  customer_email, issue_summary, incident_at, payment_method,
  payment_amount_cents, refund_amount_cents, card_last4, status, decision,
  correlation_status, correlation_source, automation_state, created_at
) values
  (
    'd4000000-0000-4000-8000-000000000003', 'RF-STATUS-PROVIDER-DUE',
    'd3000000-0000-4000-8000-000000000001',
    'd2000000-0000-4000-8000-000000000001',
    'status-provider-due@example.invalid', '', statement_timestamp() - interval '2 hours',
    'card', 700, 700, '4242', 'card_refund_pending', 'approved',
    'matched', 'nayax', 'approved', statement_timestamp() - interval '2 hours'
  ),
  (
    'd4000000-0000-4000-8000-000000000004', 'RF-STATUS-PROVIDER-NO-HOLD',
    'd3000000-0000-4000-8000-000000000001',
    'd2000000-0000-4000-8000-000000000001',
    'status-provider-no-hold@example.invalid', '', statement_timestamp() - interval '2 hours',
    'card', 700, 700, '4242', 'card_refund_pending', 'approved',
    'matched', 'nayax', 'approved', statement_timestamp() - interval '2 hours'
  );

insert into public.refund_case_nayax_refund_attempts (
  id, refund_case_id, execution_mode, status, idempotency_key,
  amount_cents, request_fingerprint, provider_claim_digest,
  provider_claim_expires_at, provider_outcome, provider_outcome_recorded_at,
  reconciliation_required, completed_at, safe_transport_stage,
  safe_failure_class, refund_operations_due_at, created_at
) values (
  'd6000000-0000-4000-8000-000000000003',
  'd4000000-0000-4000-8000-000000000003',
  'request_and_approve', 'ambiguous', 'nayax-refund-' || repeat('a', 64),
  700, repeat('b', 64), repeat('c', 64),
  statement_timestamp() + interval '5 minutes', 'unknown',
  statement_timestamp() - interval '2 hours', true,
  statement_timestamp() - interval '2 hours', 'confirmation_hold',
  'provider_unknown', statement_timestamp() - interval '1 hour',
  statement_timestamp() - interval '2 hours'
);

update public.refund_customer_contact_settings
set automatic_customer_contact_enabled = true
where singleton;

select ok(
  (public.service_start_refund_automation_run(
    'status-recovery-test-run', 'manual', statement_timestamp()
  ) ->> 'claimed')::boolean,
  'A test automation run is claimed'
);

select ok(
  (public.service_claim_refund_automation_action(
    (select id from public.refund_automation_runs
      where run_key = 'status-recovery-test-run'),
    'd4000000-0000-4000-8000-000000000001',
    'customer_status:sla_at_risk:d4000000-0000-4000-8000-000000000001',
    'customer_status_update', 'needs_review', statement_timestamp()
  ) ->> 'claimed')::boolean,
  'Customer status updates have a dedicated exactly-once action type'
);

select lives_ok($sql$
  insert into public.refund_case_messages (
    refund_case_id, message_type, status, recipient_email, subject, body,
    template_key, content_source, delivery_kind, reason_code,
    template_version, requested_fields
  ) values (
    'd4000000-0000-4000-8000-000000000001', 'status_update', 'pending',
    'status-due@example.invalid', 'A quick update', 'A person is following this.',
    'refund_status_update_sla_at_risk_v1', 'deterministic_template', 'automatic',
    'sla_at_risk', 'refund_customer_status_v1', '{}'
  )
$sql$, 'A due deterministic SLA status update is accepted');

select is(
  (select status from public.refund_case_messages
   where refund_case_id = 'd4000000-0000-4000-8000-000000000001'
     and reason_code = 'sla_at_risk'),
  'pending',
  'The pending status update is journaled before delivery'
);

select throws_ok($sql$
  update public.refund_case_messages
  set status = 'sent'
  where refund_case_id = 'd4000000-0000-4000-8000-000000000001'
    and reason_code = 'sla_at_risk'
$sql$, '23514', 'Sent customer status update requires a sent timestamp',
  'A sent status update requires delivery time evidence');

select lives_ok($sql$
  update public.refund_case_messages
  set status = 'failed', error_message = 'delivery_unknown'
  where refund_case_id = 'd4000000-0000-4000-8000-000000000001'
    and reason_code = 'sla_at_risk'
$sql$, 'Delivery-unknown evidence can settle the pending attempt as failed');

select throws_ok($sql$
  update public.refund_case_messages
  set status = 'pending'
  where refund_case_id = 'd4000000-0000-4000-8000-000000000001'
    and reason_code = 'sla_at_risk'
$sql$, '23514', 'Delivered or uncertain status update cannot be retried',
  'A failed or uncertain automatic status update cannot be blindly retried');

select throws_ok($sql$
  insert into public.refund_case_messages (
    refund_case_id, message_type, status, recipient_email, subject, body,
    template_key, content_source, delivery_kind, reason_code,
    template_version, requested_fields
  ) values (
    'd4000000-0000-4000-8000-000000000002', 'status_update', 'pending',
    'status-early@example.invalid', 'A quick update', 'A person is following this.',
    'refund_status_update_sla_at_risk_v1', 'deterministic_template', 'automatic',
    'sla_at_risk', 'refund_customer_status_v1', '{}'
  )
$sql$, '23514', 'SLA status update is not due',
  'A business-day-four message cannot be sent early');

select lives_ok($sql$
  insert into public.refund_case_messages (
    refund_case_id, message_type, status, recipient_email, subject, body,
    template_key, content_source, delivery_kind, reason_code,
    template_version, requested_fields
  ) values (
    'd4000000-0000-4000-8000-000000000003', 'status_update', 'pending',
    'status-provider-due@example.invalid', 'A quick update',
    'A person is following this.', 'refund_status_update_provider_delay_v1',
    'deterministic_template', 'automatic', 'provider_delay',
    'refund_customer_status_v1', '{}'
  )
$sql$, 'An approved pending refund with a current due hold accepts provider-delay evidence');

select throws_ok($sql$
  insert into public.refund_case_messages (
    refund_case_id, message_type, status, recipient_email, subject, body,
    template_key, content_source, delivery_kind, reason_code,
    template_version, requested_fields
  ) values (
    'd4000000-0000-4000-8000-000000000004', 'status_update', 'pending',
    'status-provider-no-hold@example.invalid', 'A quick update',
    'A person is following this.', 'refund_status_update_provider_delay_v1',
    'deterministic_template', 'automatic', 'provider_delay',
    'refund_customer_status_v1', '{}'
  )
$sql$, '23514', 'Provider-delay message requires the latest unresolved hold',
  'Provider-delay evidence fails closed without a current due hold');

select throws_ok($sql$
  insert into public.refund_case_messages (
    refund_case_id, message_type, status, recipient_email, subject, body,
    template_key, content_source, delivery_kind, reason_code,
    template_version, requested_fields
  ) values (
    'd4000000-0000-4000-8000-000000000003', 'status_update', 'pending',
    'status-provider-due@example.invalid', 'A quick update',
    'A person is following this.', 'refund_status_update_sla_at_risk_v1',
    'deterministic_template', 'automatic', 'sla_at_risk',
    'refund_customer_status_v1', '{}'
  )
$sql$, '23514', 'Automatic customer status update requires current deterministic evidence',
  'An approved pending refund cannot be mislabeled as an SLA-at-risk update');

select is(public.service_get_refund_status_contact_obligation_health()
  ->> 'unknownEffectCount','1',
  'The failed original status attempt with ambiguous effect remains an owned obligation');
select is(public.service_get_refund_status_contact_obligation_health()
  ->> 'unresolvedCount','1',
  'A fresh pending status message with no provider start remains queued');
-- Each transport outcome starts from the same guarded pending intent. Savepoints
-- model separate production attempts; no terminal message is reset or retried.
savepoint status_pending_resend_unknown;
set local role service_role;
select public.service_mark_refund_transactional_delivery_attempt(id)
from public.refund_case_messages
where refund_case_id='d4000000-0000-4000-8000-000000000003'
  and reason_code='provider_delay' and status='pending';
reset role;
select is(public.service_get_refund_status_contact_obligation_health()
  ->> 'unknownEffectCount','2',
  'A pending parent with a recorded provider start is immediately unknown');
rollback to savepoint status_pending_resend_unknown;

savepoint status_pending_resend_accepted;
set local role service_role;
select public.service_mark_refund_transactional_delivery_attempt(id)
from public.refund_case_messages
where refund_case_id='d4000000-0000-4000-8000-000000000003'
  and reason_code='provider_delay' and status='pending';
select public.service_bind_refund_transactional_delivery(
  id,'status-pending-accepted',statement_timestamp())
from public.refund_case_messages
where refund_case_id='d4000000-0000-4000-8000-000000000003'
  and reason_code='provider_delay' and status='pending';
reset role;
select is(public.service_get_refund_status_contact_obligation_health()
  ->> 'unknownEffectCount','1',
  'A saved accepted receipt outranks a stale pending parent');
set local role service_role;
select public.service_record_refund_transactional_delivery_event(
  repeat('d',64),'status-pending-accepted','bounced',statement_timestamp());
reset role;
select is(public.service_get_refund_status_contact_obligation_health()
  ->> 'definiteFailureCount','1',
  'An adverse provider event outranks the accepted receipt');
rollback to savepoint status_pending_resend_accepted;

savepoint status_failed_before_parent_update;
set local role service_role;
select public.service_mark_refund_transactional_delivery_attempt(id)
from public.refund_case_messages
where refund_case_id='d4000000-0000-4000-8000-000000000003'
  and reason_code='provider_delay' and status='pending';
reset role;
update public.refund_case_messages
set status='failed',error_message='delivery_unknown'
where refund_case_id='d4000000-0000-4000-8000-000000000003'
  and reason_code='provider_delay' and status='pending';
select is(public.service_get_refund_status_contact_obligation_health()
  ->> 'unknownEffectCount','2',
  'A failed parent with provider-start evidence remains effect-unknown');
set local role service_role;
select public.service_bind_refund_transactional_delivery(
  id,'status-failed-accepted',statement_timestamp())
from public.refund_case_messages
where refund_case_id='d4000000-0000-4000-8000-000000000003'
  and reason_code='provider_delay' and status='failed';
reset role;
select is(public.service_get_refund_status_contact_obligation_health()
  ->> 'unknownEffectCount','1',
  'A delayed accepted receipt resolves transport uncertainty despite the failed parent');
rollback to savepoint status_failed_before_parent_update;

savepoint status_sent_delivery_events;
set local role service_role;
select public.service_mark_refund_transactional_delivery_attempt(id)
from public.refund_case_messages
where refund_case_id='d4000000-0000-4000-8000-000000000003'
  and reason_code='provider_delay' and status='pending';
select public.service_bind_refund_transactional_delivery(
  id,'status-sent-accepted',statement_timestamp())
from public.refund_case_messages
where refund_case_id='d4000000-0000-4000-8000-000000000003'
  and reason_code='provider_delay' and status='pending';
reset role;
update public.refund_case_messages
set status='sent',sent_at=statement_timestamp()
where refund_case_id='d4000000-0000-4000-8000-000000000003'
  and reason_code='provider_delay' and status='pending';
select is(public.service_get_refund_status_contact_obligation_health()
  ->> 'unknownEffectCount','1',
  'Provider-accepted sent contact without webhook telemetry is not unresolved');
set local role service_role;
select public.service_record_refund_transactional_delivery_event(
  repeat('e',64),'status-sent-accepted','complained',statement_timestamp());
reset role;
select is(public.service_get_refund_status_contact_obligation_health()
  ->> 'definiteFailureCount','1',
  'An explicit adverse event after send is a required recovery');
rollback to savepoint status_sent_delivery_events;

update public.refund_case_messages set status='failed',
  error_message='gmail_source_thread_required'
where refund_case_id='d4000000-0000-4000-8000-000000000003'
  and reason_code='provider_delay' and status='pending';
select is(public.service_get_refund_status_contact_obligation_health()
  ->> 'definiteFailureCount','1',
  'A guarded known-unsent pending-to-failed transition is actionable');insert into public.refund_automation_runs(
  run_key,trigger_source,scheduled_for,started_at,finished_at,status,reason_counts
) values ('scheduled:status-obligation-noop','scheduled',now(),now(),now(),
  'succeeded','{}'::jsonb);
select is(public.service_get_refund_status_contact_obligation_health()
  ->> 'unresolvedCount','2',
  'A later healthy or no-op scheduler run cannot erase either old obligation');

-- A new guarded status intent does not itself resolve the failed old contact.
insert into public.refund_case_messages(
  refund_case_id,message_type,status,recipient_email,subject,body,
  template_key,content_source,delivery_kind,reason_code,template_version,
  requested_fields
) values ('d4000000-0000-4000-8000-000000000003','status_update','pending',
  'status-provider-due@example.invalid','Provider update',
  'A person is following this.','refund_status_update_provider_delay_v1',
  'deterministic_template','automatic','provider_delay',
  'refund_customer_status_v1','{}');
select is(public.service_get_refund_status_contact_obligation_health()
  ->> 'definiteFailureCount','1',
  'A queued same-purpose message cannot discharge the failed old contact');

-- A real accepted receipt followed by an adverse event is not supersession.
savepoint status_replacement_bounced;
set local role service_role;
select public.service_mark_refund_transactional_delivery_attempt(id)
from public.refund_case_messages
where refund_case_id='d4000000-0000-4000-8000-000000000003'
  and reason_code='provider_delay' and status='pending';
select public.service_bind_refund_transactional_delivery(
  id,'status-replacement-bounced',statement_timestamp())
from public.refund_case_messages
where refund_case_id='d4000000-0000-4000-8000-000000000003'
  and reason_code='provider_delay' and status='pending';
reset role;
update public.refund_case_messages
set status='sent',sent_at=statement_timestamp()
where refund_case_id='d4000000-0000-4000-8000-000000000003'
  and reason_code='provider_delay' and status='pending';
set local role service_role;
select public.service_record_refund_transactional_delivery_event(
  repeat('f',64),'status-replacement-bounced','bounced',statement_timestamp());
reset role;
select is(public.service_get_refund_status_contact_obligation_health()
  ->> 'definiteFailureCount','2',
  'Explicit adverse delivery cannot supersede an old required status contact');
rollback to savepoint status_replacement_bounced;

set local role service_role;
select public.service_mark_refund_transactional_delivery_attempt(id)
from public.refund_case_messages
where refund_case_id='d4000000-0000-4000-8000-000000000003'
  and reason_code='provider_delay' and status='pending';
select public.service_bind_refund_transactional_delivery(
  id,'status-replacement-accepted',statement_timestamp())
from public.refund_case_messages
where refund_case_id='d4000000-0000-4000-8000-000000000003'
  and reason_code='provider_delay' and status='pending';
reset role;
update public.refund_case_messages
set status='sent',sent_at=statement_timestamp()
where refund_case_id='d4000000-0000-4000-8000-000000000003'
  and reason_code='provider_delay' and status='pending';
select is(public.service_get_refund_status_contact_obligation_health()
  ->> 'definiteFailureCount','0',
  'A later provider-accepted same-purpose send resolves the old failure');
select is(public.service_get_refund_status_contact_obligation_health()
  ->> 'unknownEffectCount','1',
  'Contact on one case cannot clear another case’s unknown-effect obligation');

insert into public.refund_case_messages(
  refund_case_id,message_type,status,recipient_email,subject,body,
  template_key,content_source,delivery_kind,reason_code,template_version,
  requested_fields
) values ('d4000000-0000-4000-8000-000000000001','status_update','pending',
  'status-due@example.invalid','Later status',
  'A person is following this.','refund_status_update_sla_at_risk_v1',
  'deterministic_template','automatic','sla_at_risk',
  'refund_customer_status_v1','{}');
-- The same issued status purpose can also use the original verified Gmail
-- conversation. Claim and finish each outcome through its service writer;
-- savepoints keep separate attempts from the same still-pending intent.
insert into public.refund_gmail_threads(
  id,refund_case_id,mailbox_hash,provider_thread_id,thread_subject,
  first_message_at,latest_message_at,retention_expires_at
) values (
  'd7000000-0000-4000-8000-000000000001',
  'd4000000-0000-4000-8000-000000000001',repeat('a',64),
  'status-sla-source-thread','Refund status',
  statement_timestamp(),statement_timestamp(),
  statement_timestamp()+interval '30 days'
);
insert into public.refund_gmail_messages(
  id,gmail_thread_id,refund_case_id,provider_message_id,direction,
  message_kind,status,sender_email,recipient_email,participant_role,
  participant_trust,subject,plain_body,received_at,retention_expires_at
) values (
  'd8000000-0000-4000-8000-000000000001',
  'd7000000-0000-4000-8000-000000000001',
  'd4000000-0000-4000-8000-000000000001','status-sla-source-inbound',
  'inbound','message','received','status-due@example.invalid',
  'info@bloomjoysweets.com','customer','verified','Refund status',
  'Safe synthetic source message',statement_timestamp(),
  statement_timestamp()+interval '30 days'
);

savepoint status_gmail_unknown;
set local role service_role;
select is(public.service_claim_refund_gmail_outbound_v3(
  'd4000000-0000-4000-8000-000000000001',
  (select id from public.refund_case_messages
   where refund_case_id='d4000000-0000-4000-8000-000000000001'
     and reason_code='sla_at_risk' and status='pending'),
  (select 'refund-case-message:'||id::text from public.refund_case_messages
   where refund_case_id='d4000000-0000-4000-8000-000000000001'
     and reason_code='sla_at_risk' and status='pending'),
  'info@bloomjoysweets.com','status-due@example.invalid',
  'A person is following this.',array['info@bloomjoysweets.com'],
  'automatic','d7000000-0000-4000-8000-000000000001'
)->>'claimed','true','A verified source thread authorizes the exact Gmail status claim');
select ok(public.service_finish_refund_gmail_outbound(
  (select id from public.refund_gmail_messages
   where refund_case_id='d4000000-0000-4000-8000-000000000001'
     and direction='outbound' and refund_case_message_id=(
       select id from public.refund_case_messages
       where refund_case_id='d4000000-0000-4000-8000-000000000001'
         and reason_code='sla_at_risk' and status='pending')),
  'delivery_unknown',null,null,'provider_uncertain'),
  'The Gmail writer records an exact unknown effect');
reset role;
select is(public.service_get_refund_status_contact_obligation_health()
  ->> 'unknownEffectCount','2',
  'A Gmail unknown effect is visible despite the pending parent');
rollback to savepoint status_gmail_unknown;

savepoint status_gmail_failed;
set local role service_role;
select public.service_claim_refund_gmail_outbound_v3(
  'd4000000-0000-4000-8000-000000000001',
  (select id from public.refund_case_messages
   where refund_case_id='d4000000-0000-4000-8000-000000000001'
     and reason_code='sla_at_risk' and status='pending'),
  (select 'refund-case-message:'||id::text from public.refund_case_messages
   where refund_case_id='d4000000-0000-4000-8000-000000000001'
     and reason_code='sla_at_risk' and status='pending'),
  'info@bloomjoysweets.com','status-due@example.invalid',
  'A person is following this.',array['info@bloomjoysweets.com'],
  'automatic','d7000000-0000-4000-8000-000000000001');
select ok(public.service_finish_refund_gmail_outbound(
  (select id from public.refund_gmail_messages
   where refund_case_id='d4000000-0000-4000-8000-000000000001'
     and direction='outbound' and refund_case_message_id=(
       select id from public.refund_case_messages
       where refund_case_id='d4000000-0000-4000-8000-000000000001'
         and reason_code='sla_at_risk' and status='pending')),
  'failed',null,null,'gmail_source_thread_required'),
  'The Gmail writer records a known-unsent failure');
reset role;
select is(public.service_get_refund_status_contact_obligation_health()
  ->> 'definiteFailureCount','1',
  'A linked Gmail known-unsent failure is actionable before parent settlement');
rollback to savepoint status_gmail_failed;

savepoint status_gmail_accepted;
set local role service_role;
select public.service_claim_refund_gmail_outbound_v3(
  'd4000000-0000-4000-8000-000000000001',
  (select id from public.refund_case_messages
   where refund_case_id='d4000000-0000-4000-8000-000000000001'
     and reason_code='sla_at_risk' and status='pending'),
  (select 'refund-case-message:'||id::text from public.refund_case_messages
   where refund_case_id='d4000000-0000-4000-8000-000000000001'
     and reason_code='sla_at_risk' and status='pending'),
  'info@bloomjoysweets.com','status-due@example.invalid',
  'A person is following this.',array['info@bloomjoysweets.com'],
  'automatic','d7000000-0000-4000-8000-000000000001');
select ok(public.service_finish_refund_gmail_outbound(
  (select id from public.refund_gmail_messages
   where refund_case_id='d4000000-0000-4000-8000-000000000001'
     and direction='outbound' and refund_case_message_id=(
       select id from public.refund_case_messages
       where refund_case_id='d4000000-0000-4000-8000-000000000001'
         and reason_code='sla_at_risk' and status='pending')),
  'sent','status-gmail-accepted',null,null),
  'The Gmail writer records an accepted provider receipt');
reset role;
select is(public.service_get_refund_status_contact_obligation_health()
  ->> 'unknownEffectCount','1',
  'A linked Gmail accepted receipt does not inherit the pending parent uncertainty');
rollback to savepoint status_gmail_accepted;

set local role service_role;
select public.service_mark_refund_transactional_delivery_attempt(id)
from public.refund_case_messages
where refund_case_id='d4000000-0000-4000-8000-000000000001'
  and reason_code='sla_at_risk' and status='pending';
select public.service_bind_refund_transactional_delivery(
  id,'status-sla-replacement',statement_timestamp())
from public.refund_case_messages
where refund_case_id='d4000000-0000-4000-8000-000000000001'
  and reason_code='sla_at_risk' and status='pending';
reset role;
update public.refund_case_messages
set status='sent',sent_at=statement_timestamp()
where refund_case_id='d4000000-0000-4000-8000-000000000001'
  and reason_code='sla_at_risk' and status='pending';
select is(public.service_get_refund_status_contact_obligation_health()
  ->> 'unresolvedCount','0',
  'A later same-purpose accepted status resolves the unknown-effect obligation without retrying it');
select ok(not has_function_privilege('authenticated',
  'public.service_get_refund_status_contact_obligation_health()','execute'),
  'The redacted obligation-health projection is service-only');

select is(
  has_function_privilege(
    'service_role', 'public.guard_refund_customer_status_message()', 'execute'
  ) or has_function_privilege(
    'service_role', 'public.guard_refund_provider_hold_customer_message()', 'execute'
  ),
  false,
  'The trigger guards are not a service-callable bypass surface'
);

select * from finish();
rollback;
