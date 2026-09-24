begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(20);

with fixture as (
  select jsonb_build_object(
    'payloadRedacted', true, 'stage', 'needs_refund_operations',
    'reasonCode', 'provider_outcome_unknown', 'paymentState', 'outcome_unknown',
    'terminal', false, 'messageState', jsonb_build_object('state', 'none'),
    'lookup', jsonb_build_object('lastUpdatedAt', '2026-09-24T10:00:00Z')
  ) as lifecycle
)
select is((public.refund_next_work_projection(lifecycle)->>'actor'), 'agent',
  'unknown payment belongs to Agent') from fixture;
with fixture as (
  select public.refund_next_work_projection(jsonb_build_object(
    'payloadRedacted', true, 'stage', 'needs_refund_operations',
    'reasonCode', 'provider_outcome_unknown', 'paymentState', 'outcome_unknown',
    'terminal', false, 'messageState', jsonb_build_object('state', 'none')
  )) as work
)
select is(work->>'actionCode', 'reconcile_provider_outcome',
  'unknown payment requires exact-attempt reconciliation') from fixture;
with fixture as (
  select public.refund_next_work_projection(jsonb_build_object(
    'payloadRedacted', true, 'stage', 'needs_refund_operations',
    'reasonCode', 'provider_outcome_unknown', 'paymentState', 'outcome_unknown',
    'terminal', false, 'messageState', jsonb_build_object('state', 'none')
  )) as work
)
select ok(work->'dueAt' = 'null'::jsonb and work->'blocker'->>'owner' = 'Agent',
  'unknown outcome has no invented retry or due time') from fixture;

with fixture as (
  select jsonb_build_object(
    'payloadRedacted', true, 'stage', 'waiting_on_customer', 'terminal', false,
    'paymentState', 'not_requested', 'messageState', jsonb_build_object('state', 'none'),
    'customerOutreach', jsonb_build_object(
      'state', 'waiting_for_customer', 'requestSentAt', '2026-09-24T10:00:00Z',
      'deliveryState', 'delivered', 'replyReceivedAt', null
    )
  ) as lifecycle
)
select is(public.refund_next_work_projection(lifecycle)->>'actor', 'customer',
  'delivered unanswered question belongs to customer') from fixture;
with fixture as (
  select jsonb_build_object(
    'payloadRedacted', true, 'stage', 'waiting_on_customer', 'terminal', false,
    'paymentState', 'not_requested', 'messageState', jsonb_build_object('state', 'none'),
    'customerOutreach', jsonb_build_object(
      'state', 'waiting_for_customer', 'requestSentAt', '2026-09-24T10:00:00Z',
      'deliveryState', 'delivered', 'replyReceivedAt', null
    )
  ) as lifecycle
)
select is(public.refund_next_work_projection(lifecycle, '2026-09-24T10:05:00Z')->>'actionCode',
  'review_customer_reply', 'verified unparsed reply clears customer wait') from fixture;
select is(public.refund_next_work_projection(jsonb_build_object(
  'payloadRedacted', true, 'stage', 'waiting_on_customer', 'terminal', false,
  'paymentState', 'not_requested', 'messageState', jsonb_build_object('state', 'none'),
  'customerOutreach', jsonb_build_object(
    'state', 'delivery_unknown', 'requestSentAt', '2026-09-24T10:00:00Z',
    'deliveryState', 'unknown', 'replyReceivedAt', null
  )
))->>'actor', 'agent', 'unknown question delivery stays internal');

select is(public.refund_next_work_projection(jsonb_build_object(
  'payloadRedacted', true, 'stage', 'awaiting_payout', 'terminal', false,
  'reasonCode', 'payout_destination_missing', 'paymentState', 'not_requested',
  'messageState', jsonb_build_object('state', 'none')
))->>'actor', 'agent', 'missing cash destination is not Manager work');
select is(public.refund_next_work_projection(jsonb_build_object(
  'payloadRedacted', true, 'stage', 'awaiting_payout', 'terminal', false,
  'reasonCode', 'external_payment_ready', 'paymentState', 'not_requested',
  'messageState', jsonb_build_object('state', 'none'),
  'managerAction', jsonb_build_object('action', 'mark_external_refund')
))->>'actionCode', 'send_cash_refund_and_confirm', 'ready cash has one final Manager action');
select is(public.refund_next_work_projection(jsonb_build_object(
  'payloadRedacted', true, 'stage', 'awaiting_payout', 'terminal', false,
  'reasonCode', 'external_payment_ready', 'paymentState', 'not_requested',
  'messageState', jsonb_build_object('state', 'none'),
  'managerAction', jsonb_build_object('action', 'resolve_manager_access')
))->>'actor', 'agent', 'a saved destination without current Manager authority is internal assignment work');
select is(public.refund_next_work_projection(jsonb_build_object(
  'payloadRedacted', true, 'stage', 'needs_transaction_selection', 'terminal', false,
  'paymentState', 'not_requested', 'messageState', jsonb_build_object('state', 'none')
))->>'actor', 'agent', 'candidate research is Agent work');
select is(public.refund_next_work_projection(jsonb_build_object(
  'payloadRedacted', true, 'stage', 'transaction_confirmed', 'terminal', false,
  'paymentState', 'not_requested', 'messageState', jsonb_build_object('state', 'none'),
  'managerAction', jsonb_build_object('action', 'refund')
))->>'actionCode', 'approve_or_deny_request', 'prepared card request has one final Manager decision');

select ok((public.refund_next_work_projection(jsonb_build_object(
  'payloadRedacted', true, 'stage', 'refund_confirmed', 'terminal', false,
  'paymentState', 'confirmed', 'messageState', jsonb_build_object('state', 'failed')
))->>'isOpen')::boolean, 'paid case with unresolved required notice remains open');
select is(public.refund_next_work_projection(jsonb_build_object(
  'payloadRedacted', true, 'stage', 'refund_confirmed', 'terminal', false,
  'paymentState', 'confirmed', 'messageState', jsonb_build_object('state', null)
))->>'isOpen', 'true', 'missing notice state remains an explicitly open customer obligation');
select ok(not (public.refund_next_work_projection(jsonb_build_object(
  'payloadRedacted', true, 'stage', 'customer_notified', 'terminal', false,
  'reasonCode', 'settlement_time_unknown', 'paymentState', 'confirmed',
  'accountingState', jsonb_build_object('state', 'pending'),
  'messageState', jsonb_build_object('state', 'sent')
))->>'isOpen')::boolean, 'paid and notified accounting-only case is closed to digest');

-- The service caller has no Manager JWT. Its read projection must use current
-- exact-machine mappings, while the portal retains the authenticated user's
-- scoped read and all actual actions still require their versioned authority.
insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data)
values
  ('d8510000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
   'projection-manager-a@example.invalid', '{}', '{}'),
  ('d8510000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
   'projection-manager-b@example.invalid', '{}', '{}');
insert into public.customer_accounts (id, name, account_type)
values ('d8520000-0000-4000-8000-000000000001', 'Next-work authority fixture', 'customer');
insert into public.reporting_locations (id, account_id, name, timezone)
values ('d8530000-0000-4000-8000-000000000001',
  'd8520000-0000-4000-8000-000000000001', 'Next-work location', 'America/Los_Angeles');
insert into public.reporting_machines (id, account_id, location_id, machine_label)
values ('d8540000-0000-4000-8000-000000000001',
  'd8520000-0000-4000-8000-000000000001',
  'd8530000-0000-4000-8000-000000000001', 'Next-work machine');
insert into public.reporting_machine_refund_managers
  (id, reporting_machine_id, manager_user_id, manager_email, grant_reason)
values ('d8550000-0000-4000-8000-000000000001',
  'd8540000-0000-4000-8000-000000000001',
  'd8510000-0000-4000-8000-000000000001',
  'projection-manager-a@example.invalid', 'Next-work authority fixture');
insert into public.refund_cases (
  id, public_reference, reporting_machine_id, reporting_location_id,
  customer_email, issue_summary, incident_at, payment_method,
  payment_amount_cents, refund_amount_cents, zelle_payment_contact,
  status, correlation_status, correlation_source
) values (
  'd8560000-0000-4000-8000-000000000001', 'RF-NEXT-WORK-AUTH',
  'd8540000-0000-4000-8000-000000000001',
  'd8530000-0000-4000-8000-000000000001',
  'projection-customer@example.invalid', 'Prepared cash refund fixture',
  statement_timestamp() - interval '1 hour', 'cash', 700, 700,
  'projection-zelle@example.invalid', 'needs_review', 'matched', 'manual'
);
select is(public.refund_lifecycle_contract(
  'd8560000-0000-4000-8000-000000000001'
)->'nextWork'->>'actionCode', 'send_cash_refund_and_confirm',
  'service projection finds a current mapped Manager without a Manager JWT');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"d8510000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select is(public.get_refund_lifecycle_for_manager(
  'd8560000-0000-4000-8000-000000000001'
)->'nextWork'->>'actionCode', 'send_cash_refund_and_confirm',
  'the actual mapped Manager sees the prepared cash action in the portal');
reset role;
select set_config('request.jwt.claims', '{}', true);

insert into public.reporting_machine_refund_managers
  (id, reporting_machine_id, manager_user_id, manager_email, grant_reason)
values ('d8550000-0000-4000-8000-000000000002',
  'd8540000-0000-4000-8000-000000000001',
  'd8510000-0000-4000-8000-000000000002',
  'projection-manager-b@example.invalid', 'Next-work co-manager fixture');
update public.reporting_machine_refund_managers
set status = 'revoked', revoked_at = statement_timestamp(), revoke_reason = 'Fixture replacement'
where id = 'd8550000-0000-4000-8000-000000000001';
select is(public.refund_lifecycle_contract(
  'd8560000-0000-4000-8000-000000000001'
)->'nextWork'->>'actionCode', 'send_cash_refund_and_confirm',
  'service readiness follows current replacement mapping, not saved original assignee');
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"d8510000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select is(public.get_refund_lifecycle_for_manager(
  'd8560000-0000-4000-8000-000000000001'
)->'nextWork'->>'actor', 'manager',
  'current co-manager retains exact-machine portal action');
reset role;
select set_config('request.jwt.claims', '{}', true);

update public.reporting_machine_refund_managers
set status = 'revoked', revoked_at = statement_timestamp(), revoke_reason = 'Fixture revocation'
where id = 'd8550000-0000-4000-8000-000000000002';
select is(public.refund_lifecycle_contract(
  'd8560000-0000-4000-8000-000000000001'
)->'nextWork'->>'actor', 'agent',
  'no active exact-machine Manager cannot create a worker Manager action');
update public.reporting_machine_refund_managers
set status = 'active', revoked_at = null, revoke_reason = null
where id = 'd8550000-0000-4000-8000-000000000002';
update public.refund_cases set zelle_payment_contact = null
where id = 'd8560000-0000-4000-8000-000000000001';
select is(public.refund_lifecycle_contract(
  'd8560000-0000-4000-8000-000000000001'
)->'nextWork'->>'actor', 'agent',
  'a current Manager mapping cannot make cash actionable without its saved destination');

select * from finish();
rollback;
