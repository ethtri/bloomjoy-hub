begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(14);

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

select * from finish();
rollback;
