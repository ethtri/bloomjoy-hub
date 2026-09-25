begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(43);

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
  'payloadRedacted', true, 'stage', 'transaction_confirmed', 'terminal', false,
  'approvedCardContinuation', true, 'paymentState', 'not_requested',
  'messageState', jsonb_build_object('state', 'none'),
  'customerOutreach', jsonb_build_object(
    'state', 'waiting_for_customer', 'requestSentAt', '2026-09-24T10:00:00Z',
    'deliveryState', 'delivered', 'replyReceivedAt', null
  )
))->>'actionCode', 'continue_refund',
  'a prior card approval cannot be demoted to a stale customer wait');

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
  'payloadRedacted', true, 'stage', 'matching', 'terminal', false,
  'reasonCode', 'lookup_results_expired', 'paymentState', 'not_requested',
  'messageState', jsonb_build_object('state', 'none'),
  'lookup', jsonb_build_object('status', 'results_expired'),
  'managerAction', jsonb_build_object('action', 'retry_read_only_lookup')
))->>'actionCode', 'research_purchase',
  'expired approved-state research remains internal rather than a second Manager decision');
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
select is(public.refund_next_work_projection(jsonb_build_object(
  'payloadRedacted', true, 'stage', 'denied', 'terminal', true,
  'denialNoticeState', 'pending'
))->>'actor', 'agent', 'pending required denial notice stays Bloomjoy-owned');
select is(public.refund_next_work_projection(jsonb_build_object(
  'payloadRedacted', true, 'stage', 'denied', 'terminal', true,
  'denialNoticeState', 'failed'
))->>'actionCode', 'recover_customer_delivery',
  'failed denial notice requires internal delivery reconciliation');
select is(public.refund_next_work_projection(jsonb_build_object(
  'payloadRedacted', true, 'stage', 'denied', 'terminal', true,
  'denialNoticeState', 'unknown'
))->>'isOpen', 'true', 'uncertain required denial notice is not marked closed');
select is(public.refund_next_work_projection(jsonb_build_object(
  'payloadRedacted', true, 'stage', 'denied', 'terminal', true,
  'denialNoticeState', 'sent'
))->>'isOpen', 'false', 'sent denial notice closes customer-contact work');
select is(public.refund_next_work_projection(jsonb_build_object(
  'payloadRedacted', true, 'stage', 'denied', 'terminal', true
))->>'isOpen', 'false', 'historical denied case without a required notice stays closed');
select is(public.refund_next_work_projection(jsonb_build_object(
  'payloadRedacted', true, 'stage', 'duplicate_resolved', 'terminal', true,
  'denialNoticeState', 'failed'
))->>'isOpen', 'false', 'resolved duplicate has no denial-contact obligation');

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
set local role service_role;
select is(public.refund_lifecycle_contract(
  'd8560000-0000-4000-8000-000000000001'
)->'nextWork'->>'actionCode', 'prepare_manager_decision',
  'destination-only cash intake is not prepared Manager work even with a live mapping');
reset role;

-- The independent producer may be installed after this migration on a clean
-- replay. Before it exists the projection stays Agent-owned; once installed,
-- an actual completed Sunze attempt makes the same case Manager-ready.
do $prepare$
begin
  if pg_catalog.to_regprocedure('public.service_prepare_due_refund_cash_cases(integer)') is not null then
    execute 'select public.service_prepare_due_refund_cash_cases(10)';
  end if;
end;
$prepare$;
set local role service_role;
select is(public.refund_lifecycle_contract(
  'd8560000-0000-4000-8000-000000000001'
)->'nextWork'->>'actor',
  case when pg_catalog.to_regprocedure(
    'public.refund_manager_preparation_snapshot(uuid,bigint)') is not null
    then 'manager' else 'agent' end,
  'service readiness requires a completed current proof, never the saved destination alone');
reset role;

set local role anon;
select throws_ok($$select public.refund_lifecycle_contract(
  'd8560000-0000-4000-8000-000000000001')$$, '42501', null,
  'anon cannot call the service-only lifecycle projection');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{}', true);
select throws_ok($$select public.get_refund_lifecycle_for_manager(
  'd8560000-0000-4000-8000-000000000001')$$, '42501',
  'Current refund case access required',
  'authenticated caller without a Manager JWT cannot read the portal projection');
reset role;

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"d8510000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select is(public.get_refund_lifecycle_for_manager(
  'd8560000-0000-4000-8000-000000000001'
)->'nextWork'->>'actionCode',
  case when pg_catalog.to_regprocedure(
    'public.refund_manager_preparation_snapshot(uuid,bigint)') is not null
    then 'send_cash_refund_and_confirm' else 'prepare_manager_decision' end,
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
set local role service_role;
select is(public.refund_lifecycle_contract(
  'd8560000-0000-4000-8000-000000000001'
)->'nextWork'->>'actionCode',
  case when pg_catalog.to_regprocedure(
    'public.refund_manager_preparation_snapshot(uuid,bigint)') is not null
    then 'send_cash_refund_and_confirm' else 'prepare_manager_decision' end,
  'service readiness follows current replacement mapping, not saved original assignee');
reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"d8510000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select is(public.get_refund_lifecycle_for_manager(
  'd8560000-0000-4000-8000-000000000001'
)->'nextWork'->>'actor',
  case when pg_catalog.to_regprocedure(
    'public.refund_manager_preparation_snapshot(uuid,bigint)') is not null
    then 'manager' else 'agent' end,
  'current co-manager retains exact-machine portal action');
reset role;
select set_config('request.jwt.claims', '{}', true);

-- Existing approved decisions are durable authority facts. A new preparation
-- snapshot deliberately returns NULL for those cases and must not ask the
-- Manager to decide again or hide a permitted cash payout confirmation.
insert into public.refund_cases (
  id, public_reference, reporting_machine_id, reporting_location_id,
  customer_email, issue_summary, incident_at, payment_method,
  payment_amount_cents, refund_amount_cents, zelle_payment_contact,
  status, decision, correlation_status, correlation_source
) values (
  'd8560000-0000-4000-8000-000000000002', 'RF-NEXT-WORK-APPROVED-CASH',
  'd8540000-0000-4000-8000-000000000001',
  'd8530000-0000-4000-8000-000000000001',
  'approved-cash@example.invalid', 'Previously approved cash payout',
  statement_timestamp() - interval '1 hour', 'cash', 700, 700,
  'approved-cash-zelle@example.invalid', 'cash_zelle_pending', 'approved',
  'matched', 'manual'
);
insert into public.refund_cases (
  id, public_reference, reporting_machine_id, reporting_location_id,
  customer_email, issue_summary, incident_at, payment_method,
  payment_amount_cents, refund_amount_cents, card_last4,
  status, decision, correlation_status, correlation_source, automation_state,
  nayax_refund_execution_status, nayax_match_execution_eligible,
  matched_nayax_transaction_id, matched_nayax_site_id,
  matched_nayax_machine_auth_time, matched_nayax_amount_cents,
  matched_nayax_card_last4, matched_nayax_currency_code,
  nayax_recommendation_state, nayax_recommendation_policy_version
) values (
  'd8560000-0000-4000-8000-000000000003', 'RF-NEXT-WORK-APPROVED-CARD',
  'd8540000-0000-4000-8000-000000000001',
  'd8530000-0000-4000-8000-000000000001',
  'approved-card@example.invalid', 'Previously approved card refund',
  statement_timestamp() - interval '1 hour', 'card', 700, 700, '4242',
  'card_refund_pending', 'approved', 'matched', 'nayax', 'approved',
  'requested', true, 'NEXT-WORK-APPROVED-CARD', 104,
  statement_timestamp() - interval '1 hour', 700, '4242', 'USD',
  'high_confidence', 'fixture-v1'
);
insert into public.refund_case_nayax_refund_attempts (
  id, refund_case_id, execution_mode, status, idempotency_key,
  amount_cents, request_fingerprint, provider_claim_digest,
  provider_claim_expires_at, reconciliation_required, created_at
) values (
  'd8580000-0000-4000-8000-000000000001',
  'd8560000-0000-4000-8000-000000000003',
  'request_and_approve', 'requested', 'next-work-approved-card-attempt',
  700, repeat('1', 64), repeat('2', 64),
  statement_timestamp() + interval '10 minutes', false,
  statement_timestamp() - interval '3 minutes'
);
set local role service_role;
select is(public.refund_lifecycle_contract(
  'd8560000-0000-4000-8000-000000000002'
)->>'stage', 'awaiting_payout', 'prior approved cash retains its payout stage');
select is(public.refund_lifecycle_contract(
  'd8560000-0000-4000-8000-000000000002'
)->'nextWork'->>'actionCode', 'send_cash_refund_and_confirm',
  'prior approved cash keeps only the existing Manager payout confirmation');
select is(public.refund_lifecycle_contract(
  'd8560000-0000-4000-8000-000000000003'
)->>'stage', 'confirming_with_nayax', 'prior approved card retains its original provider attempt');
select is(public.refund_lifecycle_contract(
  'd8560000-0000-4000-8000-000000000003'
)->'nextWork'->>'actor', 'system',
  'prior approved card attempt continuation is internal, even with a live Manager mapping');
select is(public.refund_lifecycle_contract(
  'd8560000-0000-4000-8000-000000000003'
)->'nextWork'->>'actionCode', 'continue_refund',
  'prior approved card never asks the Manager to approve it again');
reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"d8510000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select is(public.get_refund_lifecycle_for_manager(
  'd8560000-0000-4000-8000-000000000002'
)->'nextWork'->>'actionCode', 'send_cash_refund_and_confirm',
  'current mapped Manager can finish a previously approved cash payout');
select is(public.get_refund_lifecycle_for_manager(
  'd8560000-0000-4000-8000-000000000003'
)->'nextWork'->>'actionCode', 'continue_refund',
  'portal agrees that prior approved card work is internal continuation');
reset role;
select set_config('request.jwt.claims', '{}', true);
select ok((select bool_and(decision = 'approved') from public.refund_cases
  where id in ('d8560000-0000-4000-8000-000000000002',
    'd8560000-0000-4000-8000-000000000003')),
  'read projections preserve both immutable approved decisions');

update public.reporting_machine_refund_managers
set status = 'revoked', revoked_at = statement_timestamp(), revoke_reason = 'Fixture revocation'
where id = 'd8550000-0000-4000-8000-000000000002';
set local role service_role;
select is(public.refund_lifecycle_contract(
  'd8560000-0000-4000-8000-000000000001'
)->'nextWork'->>'actor', 'agent',
  'no active exact-machine Manager cannot create a worker Manager action');
reset role;
update public.reporting_machine_refund_managers
set status = 'active', revoked_at = null, revoke_reason = null
where id = 'd8550000-0000-4000-8000-000000000002';
update public.refund_cases set zelle_payment_contact = null
where id = 'd8560000-0000-4000-8000-000000000001';
set local role service_role;
select is(public.refund_lifecycle_contract(
  'd8560000-0000-4000-8000-000000000001'
)->'nextWork'->>'actor', 'agent',
  'a current Manager mapping cannot make cash actionable without its saved destination');
reset role;

update public.refund_cases set status = 'denied', decision = 'denied'
where id = 'd8560000-0000-4000-8000-000000000001';
insert into public.refund_case_messages (
  id, refund_case_id, message_type, status, recipient_email, subject, body
) values (
  'd8570000-0000-4000-8000-000000000001',
  'd8560000-0000-4000-8000-000000000001',
  'denied', 'pending', 'projection-customer@example.invalid',
  'Refund decision', 'Fixture denial notice'
);
set local role service_role;
select is(public.refund_lifecycle_contract(
  'd8560000-0000-4000-8000-000000000001'
)->'nextWork'->>'isOpen', 'true',
  'service projection keeps an actual pending denial notice open');
reset role;
update public.refund_case_messages set status = 'failed'
where id = 'd8570000-0000-4000-8000-000000000001';
set local role service_role;
select is(public.refund_lifecycle_contract(
  'd8560000-0000-4000-8000-000000000001'
)->'nextWork'->>'actionCode', 'recover_customer_delivery',
  'service projection owns actual failed denial notice recovery');
reset role;
update public.refund_case_messages set status = 'sent', sent_at = statement_timestamp()
where id = 'd8570000-0000-4000-8000-000000000001';
set local role service_role;
select is(public.refund_lifecycle_contract(
  'd8560000-0000-4000-8000-000000000001'
)->'nextWork'->>'isOpen', 'false',
  'service projection closes contact after the actual denial notice is sent');
reset role;
insert into public.refund_case_messages (
  id, refund_case_id, message_type, status, recipient_email, subject, body
) values (
  'd8570000-0000-4000-8000-000000000002',
  'd8560000-0000-4000-8000-000000000001',
  'manual_note', 'failed', 'projection-customer@example.invalid',
  'Later note', 'Unrelated fixture note'
);
set local role service_role;
select is(public.refund_lifecycle_contract(
  'd8560000-0000-4000-8000-000000000001'
)->'nextWork'->>'isOpen', 'false',
  'a later unrelated message cannot reopen a sent denial notice');
reset role;

select * from finish();
rollback;
