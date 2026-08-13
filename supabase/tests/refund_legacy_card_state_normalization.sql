begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(39);

create function pg_temp.capture_error(statement text)
returns text
language plpgsql
as $$
begin
  execute statement;
  return null;
exception when others then
  return sqlstate || ':' || sqlerrm;
end;
$$;

create temporary table normalization_results (
  result_key text primary key,
  result jsonb not null
);

create temporary table historical_message_snapshots (
  result_key text primary key,
  messages jsonb not null
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values (
  '00000000-0000-0000-0000-000000000000',
  '8d000000-0000-4000-8000-000000000001',
  'authenticated', 'authenticated', 'legacy-review-manager@example.test', '', now(),
  '{}'::jsonb, '{}'::jsonb, now(), now()
);

insert into public.customer_accounts (id, name, account_type)
values ('8d100000-0000-4000-8000-000000000001', 'Legacy normalization test', 'customer');

insert into public.reporting_locations (id, account_id, name, timezone)
values (
  '8d200000-0000-4000-8000-000000000001',
  '8d100000-0000-4000-8000-000000000001',
  'Legacy normalization location',
  'America/Los_Angeles'
);

insert into public.reporting_machines (
  id, account_id, location_id, machine_label, nayax_machine_id, nayax_account_key
)
values (
  '8d300000-0000-4000-8000-000000000001',
  '8d100000-0000-4000-8000-000000000001',
  '8d200000-0000-4000-8000-000000000001',
  'Legacy normalization machine',
  'LEGACY-NORMALIZATION',
  'LEGACY-NORMALIZATION'
);

insert into public.reporting_machine_refund_managers (
  id, reporting_machine_id, manager_user_id, manager_email, status, grant_reason
)
values (
  '8d400000-0000-4000-8000-000000000001',
  '8d300000-0000-4000-8000-000000000001',
  '8d000000-0000-4000-8000-000000000001',
  'legacy-review-manager@example.test',
  'active',
  'Synthetic legacy normalization review'
);

insert into public.refund_cases (
  id, reporting_machine_id, reporting_location_id, customer_email,
  issue_summary, incident_at, payment_method, payment_amount_cents,
  card_last4, status, decision, decision_reason, decided_by, decided_at,
  nayax_match_execution_eligible, nayax_refund_execution_status,
  automation_state, correlation_status, intake_source
)
values
  (
    '8d500000-0000-4000-8000-000000000001',
    '8d300000-0000-4000-8000-000000000001',
    '8d200000-0000-4000-8000-000000000001',
    'legacy-target-customer@example.test', 'Synthetic target.', now() - interval '2 days',
    'card', 700, '4242', 'card_refund_pending', 'approved', 'Historical reason.',
    '8d000000-0000-4000-8000-000000000001', now() - interval '1 day',
    false, 'not_requested', 'approved', 'matched', 'form'
  ),
  (
    '8d500000-0000-4000-8000-000000000002',
    '8d300000-0000-4000-8000-000000000001',
    '8d200000-0000-4000-8000-000000000001',
    'wrong-confirmation-customer@example.test', 'Synthetic confirmation guard.', now() - interval '2 days',
    'card', 700, '4242', 'card_refund_pending', 'approved', null,
    '8d000000-0000-4000-8000-000000000001', now() - interval '1 day',
    false, 'not_requested', 'approved', 'matched', 'form'
  ),
  (
    '8d500000-0000-4000-8000-000000000003',
    '8d300000-0000-4000-8000-000000000001',
    '8d200000-0000-4000-8000-000000000001',
    'missing-message-customer@example.test', 'Synthetic missing message guard.', now() - interval '2 days',
    'card', 700, '4242', 'card_refund_pending', 'approved', null,
    '8d000000-0000-4000-8000-000000000001', now() - interval '1 day',
    false, 'not_requested', 'approved', 'matched', 'form'
  ),
  (
    '8d500000-0000-4000-8000-000000000004',
    '8d300000-0000-4000-8000-000000000001',
    '8d200000-0000-4000-8000-000000000001',
    'provider-attempt-customer@example.test', 'Synthetic provider attempt guard.', now() - interval '2 days',
    'card', 700, '4242', 'card_refund_pending', 'approved', null,
    '8d000000-0000-4000-8000-000000000001', now() - interval '1 day',
    false, 'not_requested', 'approved', 'matched', 'form'
  );

insert into public.refund_cases (
  id, reporting_machine_id, reporting_location_id, customer_email,
  issue_summary, incident_at, payment_method, payment_amount_cents,
  card_last4, status, decision, decided_by, decided_at,
  nayax_match_execution_eligible, nayax_refund_execution_status,
  automation_state, correlation_status, intake_source
)
select
  case_id,
  '8d300000-0000-4000-8000-000000000001'::uuid,
  '8d200000-0000-4000-8000-000000000001'::uuid,
  customer_email,
  fixture_name,
  now() - interval '2 days',
  'card', 700, '4242', case_status,
  case when case_status = 'draft' then null else 'approved' end,
  case when case_status = 'draft' then null else '8d000000-0000-4000-8000-000000000001'::uuid end,
  case when case_status = 'draft' then null else now() - interval '1 day' end,
  false, 'not_requested',
  case when case_status = 'draft' then 'submitted' else 'approved' end,
  case when case_status = 'draft' then 'not_started' else 'matched' end,
  case when case_status = 'draft' then 'gmail' else 'form' end
from (values
  ('8d500000-0000-4000-8000-000000000005'::uuid, 'one-message@example.test', 'One-message near miss', 'card_refund_pending'),
  ('8d500000-0000-4000-8000-000000000006'::uuid, 'three-messages@example.test', 'Three-message near miss', 'card_refund_pending'),
  ('8d500000-0000-4000-8000-000000000007'::uuid, 'pending-message@example.test', 'Pending-message near miss', 'card_refund_pending'),
  ('8d500000-0000-4000-8000-000000000008'::uuid, 'completed-message@example.test', 'Completed-message near miss', 'card_refund_pending'),
  ('8d500000-0000-4000-8000-000000000009'::uuid, 'failed-message@example.test', 'Failed-message near miss', 'card_refund_pending'),
  ('8d500000-0000-4000-8000-000000000010'::uuid, 'draft-case@example.test', 'Draft-case near miss', 'draft'),
  ('8d500000-0000-4000-8000-000000000011'::uuid, 'duplicate-confirmation@example.test', 'Duplicate-confirmation near miss', 'card_refund_pending'),
  ('8d500000-0000-4000-8000-000000000012'::uuid, 'duplicate-approval@example.test', 'Duplicate-approval near miss', 'card_refund_pending'),
  ('8d500000-0000-4000-8000-000000000013'::uuid, 'other-message@example.test', 'Other-message near miss', 'card_refund_pending')
) fixture(case_id, customer_email, fixture_name, case_status);

-- Model the misleading current match/approval fields the normalization must
-- preserve in history and clear before the manager can run a fresh check.
update public.refund_cases
set
  refund_amount_cents = 700,
  correlation_source = 'nayax',
  correlation_confidence = 0.97,
  correlation_summary = 'Historical selected transaction.',
  matched_nayax_transaction_id = 'legacy-synthetic-transaction',
  matched_nayax_site_id = 101,
  matched_nayax_machine_auth_time = now() - interval '2 days',
  matched_nayax_amount_cents = 700,
  matched_nayax_card_last4 = '4242',
  matched_nayax_currency_code = 'USD',
  nayax_recommendation_state = 'manual_exception',
  nayax_recommendation_policy_version = 'legacy.synthetic.v1',
  nayax_recommendation_evaluated_at = now() - interval '2 days'
where id = '8d500000-0000-4000-8000-000000000001';

-- Recreate the pre-guard historical fixture. Production cannot create this
-- contradiction through the current message boundary.
alter table public.refund_case_messages
  disable trigger refund_case_messages_nayax_attempt_guard;
insert into public.refund_case_messages (
  refund_case_id, message_type, status, recipient_email, subject, body, sent_at
)
values
  (
    '8d500000-0000-4000-8000-000000000001', 'confirmation', 'sent',
    'legacy-target-customer@example.test', 'Historical confirmation', 'Historical confirmation body.', now() - interval '25 hours'
  ),
  (
    '8d500000-0000-4000-8000-000000000001', 'approved', 'sent',
    'legacy-target-customer@example.test', 'Historical approval', 'Historical body.', now() - interval '1 day'
  ),
  (
    '8d500000-0000-4000-8000-000000000002', 'confirmation', 'sent',
    'wrong-confirmation-customer@example.test', 'Historical confirmation', 'Historical confirmation body.', now() - interval '25 hours'
  ),
  (
    '8d500000-0000-4000-8000-000000000002', 'approved', 'sent',
    'wrong-confirmation-customer@example.test', 'Historical approval', 'Historical body.', now() - interval '1 day'
  ),
  (
    '8d500000-0000-4000-8000-000000000004', 'confirmation', 'sent',
    'provider-attempt-customer@example.test', 'Historical confirmation', 'Historical confirmation body.', now() - interval '25 hours'
  ),
  (
    '8d500000-0000-4000-8000-000000000004', 'approved', 'sent',
    'provider-attempt-customer@example.test', 'Historical approval', 'Historical body.', now() - interval '1 day'
  ),
  (
    '8d500000-0000-4000-8000-000000000005', 'approved', 'sent',
    'one-message@example.test', 'Historical approval', 'Historical body.', now() - interval '1 day'
  ),
  (
    '8d500000-0000-4000-8000-000000000006', 'confirmation', 'sent',
    'three-messages@example.test', 'Historical confirmation', 'Historical confirmation body.', now() - interval '25 hours'
  ),
  (
    '8d500000-0000-4000-8000-000000000006', 'approved', 'sent',
    'three-messages@example.test', 'Historical approval', 'Historical body.', now() - interval '1 day'
  ),
  (
    '8d500000-0000-4000-8000-000000000006', 'status_update', 'sent',
    'three-messages@example.test', 'Historical update', 'Historical update body.', now() - interval '23 hours'
  ),
  (
    '8d500000-0000-4000-8000-000000000007', 'confirmation', 'pending',
    'pending-message@example.test', 'Pending confirmation', 'Pending confirmation body.', null
  ),
  (
    '8d500000-0000-4000-8000-000000000007', 'approved', 'sent',
    'pending-message@example.test', 'Historical approval', 'Historical body.', now() - interval '1 day'
  ),
  (
    '8d500000-0000-4000-8000-000000000008', 'completed', 'sent',
    'completed-message@example.test', 'Historical completion', 'Historical completion body.', now() - interval '25 hours'
  ),
  (
    '8d500000-0000-4000-8000-000000000008', 'approved', 'sent',
    'completed-message@example.test', 'Historical approval', 'Historical body.', now() - interval '1 day'
  ),
  (
    '8d500000-0000-4000-8000-000000000009', 'confirmation', 'failed',
    'failed-message@example.test', 'Failed confirmation', 'Failed confirmation body.', null
  ),
  (
    '8d500000-0000-4000-8000-000000000009', 'approved', 'sent',
    'failed-message@example.test', 'Historical approval', 'Historical body.', now() - interval '1 day'
  ),
  (
    '8d500000-0000-4000-8000-000000000010', 'confirmation', 'sent',
    'draft-case@example.test', 'Historical confirmation', 'Historical confirmation body.', now() - interval '25 hours'
  ),
  (
    '8d500000-0000-4000-8000-000000000010', 'approved', 'sent',
    'draft-case@example.test', 'Historical approval', 'Historical body.', now() - interval '1 day'
  ),
  (
    '8d500000-0000-4000-8000-000000000011', 'confirmation', 'sent',
    'duplicate-confirmation@example.test', 'Historical confirmation one', 'Historical confirmation body one.', now() - interval '26 hours'
  ),
  (
    '8d500000-0000-4000-8000-000000000011', 'confirmation', 'sent',
    'duplicate-confirmation@example.test', 'Historical confirmation two', 'Historical confirmation body two.', now() - interval '25 hours'
  ),
  (
    '8d500000-0000-4000-8000-000000000011', 'approved', 'sent',
    'duplicate-confirmation@example.test', 'Historical approval', 'Historical body.', now() - interval '1 day'
  ),
  (
    '8d500000-0000-4000-8000-000000000012', 'confirmation', 'sent',
    'duplicate-approval@example.test', 'Historical confirmation', 'Historical confirmation body.', now() - interval '26 hours'
  ),
  (
    '8d500000-0000-4000-8000-000000000012', 'approved', 'sent',
    'duplicate-approval@example.test', 'Historical approval one', 'Historical approval body one.', now() - interval '25 hours'
  ),
  (
    '8d500000-0000-4000-8000-000000000012', 'approved', 'sent',
    'duplicate-approval@example.test', 'Historical approval two', 'Historical approval body two.', now() - interval '1 day'
  ),
  (
    '8d500000-0000-4000-8000-000000000013', 'status_update', 'sent',
    'other-message@example.test', 'Historical update', 'Historical update body.', now() - interval '25 hours'
  ),
  (
    '8d500000-0000-4000-8000-000000000013', 'approved', 'sent',
    'other-message@example.test', 'Historical approval', 'Historical body.', now() - interval '1 day'
  );
alter table public.refund_case_messages
  enable trigger refund_case_messages_nayax_attempt_guard;

insert into public.refund_nayax_lookup_candidates (
  token, refund_case_id, actor_user_id, provider_transaction_id, site_id,
  machine_authorization_time, amount_cents, card_last4, currency_code,
  evidence_summary, expires_at
)
values (
  '8d600000-0000-4000-8000-000000000001',
  '8d500000-0000-4000-8000-000000000001',
  '8d000000-0000-4000-8000-000000000001',
  'SAFE-TXN-LEGACY-STALE-1', 101, now() - interval '2 days',
  700, '4242', 'USD',
  jsonb_build_object(
    'selection_allowed', true,
    'is_recommended', true,
    'provider_payload_redacted', true
  ),
  now() + interval '1 hour'
);

insert into public.refund_case_nayax_refund_attempts (
  refund_case_id, execution_mode, status, idempotency_key, amount_cents,
  transaction_id_present, site_id_present, machine_auth_time_present
)
values (
  '8d500000-0000-4000-8000-000000000004', 'preflight', 'preflight_blocked',
  'legacy-normalization-near-miss-attempt', 700, true, true, true
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.owner_normalize_refund_legacy_card_state(uuid,text)',
    'execute'
  ),
  'Authenticated browsers cannot invoke the owner repair'
);
select ok(
  not has_function_privilege(
    'service_role',
    'public.owner_normalize_refund_legacy_card_state(uuid,text)',
    'execute'
  ),
  'Service automation cannot invoke the owner repair'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.owner_normalize_refund_legacy_card_state(uuid,text)',
    'execute'
  ),
  'Anonymous callers cannot invoke the owner repair'
);
select ok(
  (
    select pg_get_userbyid(routine.proowner) = pg_get_userbyid(database.datdba)
    from pg_proc routine
    cross join pg_database database
    where routine.oid =
      'public.owner_normalize_refund_legacy_card_state(uuid,text)'::regprocedure
      and database.datname = current_database()
  ),
  'The private operation is owned by the exact database owner'
);

insert into historical_message_snapshots (result_key, messages)
select
  'target',
  jsonb_agg(to_jsonb(message) order by message.id)
from public.refund_case_messages message
where message.refund_case_id = '8d500000-0000-4000-8000-000000000001';

insert into normalization_results (result_key, result)
select 'target', public.owner_normalize_refund_legacy_card_state(
  '8d500000-0000-4000-8000-000000000001',
  'NORMALIZE_LEGACY_CARD_STATE_WITHOUT_PROVIDER_ACTION'
);

select ok(
  (select (result ->> 'normalized')::boolean from normalization_results where result_key = 'target')
  and not (select (result ->> 'alreadyNormalized')::boolean from normalization_results where result_key = 'target')
  and (select result ->> 'status' from normalization_results where result_key = 'target') = 'needs_review'
  and (select result ->> 'decision' from normalization_results where result_key = 'target') is null
  and (select (result ->> 'legacyConfirmationMessageCount')::integer from normalization_results where result_key = 'target') = 1
  and (select (result ->> 'legacyApprovedMessageCount')::integer from normalization_results where result_key = 'target') = 1
  and (select (result ->> 'totalHistoricalMessageCount')::integer from normalization_results where result_key = 'target') = 2,
  'The exact legacy target returns only truthful review state'
);
select ok(
  (select result::text from normalization_results where result_key = 'target')
    !~ '8d5|example|4242|Historical (body|confirmation)|LEGACY-NORMALIZATION'
  and (select (result ->> 'payloadRedacted')::boolean from normalization_results where result_key = 'target'),
  'The owner operation returns sanitized aggregate evidence only'
);
select ok(
  exists (
    select 1 from public.refund_cases refund_case
    where refund_case.id = '8d500000-0000-4000-8000-000000000001'
      and refund_case.status = 'needs_review'
      and refund_case.decision is null
      and refund_case.decision_reason is null
      and refund_case.decided_by is null
      and refund_case.decided_at is null
      and refund_case.refund_amount_cents is null
      and refund_case.correlation_status = 'manual_review'
      and refund_case.correlation_source is null
      and refund_case.correlation_confidence = 0
      and refund_case.matched_nayax_transaction_id is null
      and refund_case.matched_nayax_site_id is null
      and refund_case.matched_nayax_machine_auth_time is null
      and refund_case.matched_nayax_amount_cents is null
      and refund_case.matched_nayax_card_last4 is null
      and refund_case.matched_nayax_currency_code is null
      and refund_case.nayax_recommendation_state is null
      and refund_case.nayax_recommendation_policy_version is null
      and refund_case.nayax_recommendation_evaluated_at is null
      and refund_case.automation_state = 'under_review'
      and refund_case.nayax_match_execution_eligible = false
      and refund_case.nayax_refund_execution_status = 'not_requested'
  ),
  'The case moves from misleading approval into a truthful review state'
);
select is(
  (select count(*)::integer from public.refund_case_nayax_refund_attempts
    where refund_case_id = '8d500000-0000-4000-8000-000000000001'),
  0,
  'Normalization creates no provider attempt'
);
select is(
  (select count(*)::integer from public.refund_nayax_lookup_candidates
    where refund_case_id = '8d500000-0000-4000-8000-000000000001'),
  0,
  'Normalization removes every stale replaceable lookup candidate'
);
select ok(
  (select messages from historical_message_snapshots where result_key = 'target') = (
    select jsonb_agg(to_jsonb(message) order by message.id)
    from public.refund_case_messages message
    where message.refund_case_id = '8d500000-0000-4000-8000-000000000001'
  )
  and (select count(*) from public.refund_case_messages
    where refund_case_id = '8d500000-0000-4000-8000-000000000001') = 2,
  'Both historical customer messages remain byte-for-byte unchanged and no message is sent'
);
select is(
  (select count(*)::integer from public.refund_case_events
    where refund_case_id = '8d500000-0000-4000-8000-000000000001'
      and event_type = 'legacy_card_state_normalized'),
  1,
  'Normalization appends one dedicated history event'
);
select ok(
  exists (
    select 1 from public.refund_case_events event
    where event.refund_case_id = '8d500000-0000-4000-8000-000000000001'
      and event.event_type = 'legacy_card_state_normalized'
      and event.metadata ->> 'previous_status' = 'card_refund_pending'
      and event.metadata ->> 'previous_decision' = 'approved'
      and (event.metadata ->> 'previous_decision_reason_present')::boolean
      and (event.metadata ->> 'previous_decided_by_present')::boolean
      and (event.metadata ->> 'previous_match_present')::boolean
      and (event.metadata ->> 'previous_match_site_present')::boolean
      and (event.metadata ->> 'previous_match_time_present')::boolean
      and (event.metadata ->> 'previous_match_amount_present')::boolean
      and event.metadata ->> 'previous_recommendation_state' = 'manual_exception'
      and (event.metadata ->> 'previous_recommendation_policy_present')::boolean
      and (event.metadata ->> 'legacy_confirmation_message_count')::integer = 1
      and (event.metadata ->> 'legacy_approved_message_count')::integer = 1
      and (event.metadata ->> 'total_historical_message_count')::integer = 2
      and (event.metadata ->> 'stale_lookup_candidate_count')::integer = 1
      and (event.metadata ->> 'provider_attempt_count')::integer = 0
      and event.metadata ->> 'provider_execution_status' = 'not_requested'
      and (event.metadata ->> 'payload_redacted')::boolean
  ),
  'Immutable history preserves the prior decision facts without claiming success'
);
select ok(
  (select metadata::text from public.refund_case_events
    where refund_case_id = '8d500000-0000-4000-8000-000000000001'
      and event_type = 'legacy_card_state_normalized')
    !~ 'example|4242|Historical body|LEGACY-NORMALIZATION',
  'The history event excludes customer, card, and provider identifiers'
);
select ok(
  exists (
    select 1 from public.admin_audit_log audit
    where audit.entity_id = '8d500000-0000-4000-8000-000000000001'
      and audit.action = 'refund_case.legacy_state_normalized'
      and audit.before ->> 'decision' = 'approved'
      and audit.after ->> 'status' = 'needs_review'
      and (audit.meta ->> 'provider_action_taken')::boolean = false
      and (audit.meta ->> 'customer_message_sent')::boolean = false
      and (audit.meta ->> 'payload_redacted')::boolean
  ),
  'The owner repair records a redacted no-side-effect audit entry'
);

insert into normalization_results (result_key, result)
select 'replay', public.owner_normalize_refund_legacy_card_state(
  '8d500000-0000-4000-8000-000000000001',
  'NORMALIZE_LEGACY_CARD_STATE_WITHOUT_PROVIDER_ACTION'
);
select ok(
  not (select (result ->> 'normalized')::boolean from normalization_results where result_key = 'replay')
  and (select (result ->> 'alreadyNormalized')::boolean from normalization_results where result_key = 'replay'),
  'A repeated owner repair is idempotent'
);
select is(
  (select count(*)::integer from public.refund_case_events
    where refund_case_id = '8d500000-0000-4000-8000-000000000001'
      and event_type = 'legacy_card_state_normalized'),
  1,
  'Idempotent replay does not duplicate history'
);
select ok(
  public.refund_case_legacy_state_review_required('8d500000-0000-4000-8000-000000000001'),
  'The normalized case requires a fresh payment-history review'
);

select set_config('request.jwt.claim.sub', '8d000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claims', jsonb_build_object(
  'sub', '8d000000-0000-4000-8000-000000000001',
  'role', 'authenticated', 'aal', 'aal1', 'amr', '[]'::jsonb
)::text, true);
select ok(
  exists (
    select 1
    from jsonb_array_elements(public.admin_get_refund_email_queue_states()) state
    where state ->> 'caseId' = '8d500000-0000-4000-8000-000000000001'
      and (state ->> 'legacyStateReviewRequired')::boolean
      and (state ->> 'actionBlocked')::boolean
      and (state ->> 'payloadRedacted')::boolean
  ),
  'The mapped manager sees one explicit action-blocked legacy review signal'
);

select ok(
  pg_temp.capture_error($$select public.owner_normalize_refund_legacy_card_state(
    '8d500000-0000-4000-8000-000000000002', 'I AGREE'
  )$$) like '%Exact legacy refund normalization confirmation is required%',
  'A wrong confirmation phrase fails closed'
);
select is(
  (select status from public.refund_cases where id = '8d500000-0000-4000-8000-000000000002'),
  'card_refund_pending',
  'A failed confirmation leaves the near-match case unchanged'
);
select ok(
  pg_temp.capture_error($$select public.owner_normalize_refund_legacy_card_state(
    '8d500000-0000-4000-8000-000000000003',
    'NORMALIZE_LEGACY_CARD_STATE_WITHOUT_PROVIDER_ACTION'
  )$$) like '%does not match the exact legacy confirmation-and-approval structure%',
  'A case with zero historical messages is rejected'
);
select ok(
  pg_temp.capture_error($$select public.owner_normalize_refund_legacy_card_state(
    '8d500000-0000-4000-8000-000000000004',
    'NORMALIZE_LEGACY_CARD_STATE_WITHOUT_PROVIDER_ACTION'
  )$$) like '%does not match the exact legacy confirmation-and-approval structure%',
  'Any existing provider attempt excludes a case from normalization'
);
select ok(
  pg_temp.capture_error($$select public.owner_normalize_refund_legacy_card_state(
    '8d500000-0000-4000-8000-000000000005',
    'NORMALIZE_LEGACY_CARD_STATE_WITHOUT_PROVIDER_ACTION'
  )$$) like '%does not match the exact legacy confirmation-and-approval structure%',
  'The former one-approval-only fixture is deliberately rejected'
);
select ok(
  pg_temp.capture_error($$select public.owner_normalize_refund_legacy_card_state(
    '8d500000-0000-4000-8000-000000000006',
    'NORMALIZE_LEGACY_CARD_STATE_WITHOUT_PROVIDER_ACTION'
  )$$) like '%does not match the exact legacy confirmation-and-approval structure%',
  'Three or more historical messages are rejected'
);
select ok(
  pg_temp.capture_error($$select public.owner_normalize_refund_legacy_card_state(
    '8d500000-0000-4000-8000-000000000007',
    'NORMALIZE_LEGACY_CARD_STATE_WITHOUT_PROVIDER_ACTION'
  )$$) like '%does not match the exact legacy confirmation-and-approval structure%',
  'A pending historical message is rejected'
);
select ok(
  pg_temp.capture_error($$select public.owner_normalize_refund_legacy_card_state(
    '8d500000-0000-4000-8000-000000000008',
    'NORMALIZE_LEGACY_CARD_STATE_WITHOUT_PROVIDER_ACTION'
  )$$) like '%does not match the exact legacy confirmation-and-approval structure%',
  'A completed historical message type is rejected'
);
select ok(
  pg_temp.capture_error($$select public.owner_normalize_refund_legacy_card_state(
    '8d500000-0000-4000-8000-000000000009',
    'NORMALIZE_LEGACY_CARD_STATE_WITHOUT_PROVIDER_ACTION'
  )$$) like '%does not match the exact legacy confirmation-and-approval structure%',
  'A failed historical message is rejected'
);
select ok(
  pg_temp.capture_error($$select public.owner_normalize_refund_legacy_card_state(
    '8d500000-0000-4000-8000-000000000010',
    'NORMALIZE_LEGACY_CARD_STATE_WITHOUT_PROVIDER_ACTION'
  )$$) like '%does not match the exact legacy confirmation-and-approval structure%',
  'A draft case is rejected even when its two messages otherwise match'
);
select ok(
  pg_temp.capture_error($$select public.owner_normalize_refund_legacy_card_state(
    '8d500000-0000-4000-8000-000000000011',
    'NORMALIZE_LEGACY_CARD_STATE_WITHOUT_PROVIDER_ACTION'
  )$$) like '%does not match the exact legacy confirmation-and-approval structure%',
  'Duplicate confirmations are rejected'
);
select ok(
  pg_temp.capture_error($$select public.owner_normalize_refund_legacy_card_state(
    '8d500000-0000-4000-8000-000000000012',
    'NORMALIZE_LEGACY_CARD_STATE_WITHOUT_PROVIDER_ACTION'
  )$$) like '%does not match the exact legacy confirmation-and-approval structure%',
  'Duplicate approvals are rejected'
);
select ok(
  pg_temp.capture_error($$select public.owner_normalize_refund_legacy_card_state(
    '8d500000-0000-4000-8000-000000000013',
    'NORMALIZE_LEGACY_CARD_STATE_WITHOUT_PROVIDER_ACTION'
  )$$) like '%does not match the exact legacy confirmation-and-approval structure%',
  'Any other message type is rejected'
);
select ok(
  pg_temp.capture_error($$update public.refund_cases
    set status = 'denied', decision = 'denied'
    where id = '8d500000-0000-4000-8000-000000000001'$$)
    like '%Run a fresh transaction check before any decision or refund action%',
  'Normalization alone cannot enable a new official decision'
);
select ok(
  pg_temp.capture_error($$insert into public.refund_case_messages (
    refund_case_id, message_type, status, recipient_email, subject, body
  ) values (
    '8d500000-0000-4000-8000-000000000001', 'status_update', 'pending',
    'legacy-target-customer@example.test', 'Blocked', 'Blocked'
  )$$) like '%Run a fresh transaction check before any customer message%',
  'Normalization alone cannot enable a customer message'
);
select ok(
  pg_temp.capture_error($$update public.refund_case_messages
    set status = 'pending', sent_at = null
    where refund_case_id = '8d500000-0000-4000-8000-000000000001'
      and message_type = 'approved'$$)
    like '%Run a fresh transaction check before any customer message%',
  'Normalization freezes updates to every pre-existing customer message'
);
select ok(
  pg_temp.capture_error($$insert into public.refund_case_nayax_refund_attempts (
    refund_case_id, execution_mode, status, idempotency_key, amount_cents
  ) values (
    '8d500000-0000-4000-8000-000000000001', 'preflight', 'preflight_blocked',
    'legacy-normalization-blocked-attempt', 700
  )$$) like '%Run a fresh transaction check before any provider attempt%',
  'Normalization alone cannot enable a provider attempt or retry'
);
select ok(
  pg_temp.capture_error($$update public.refund_case_events
    set message = 'rewrite'
    where refund_case_id = '8d500000-0000-4000-8000-000000000001'
      and event_type = 'legacy_card_state_normalized'$$)
    like '%Legacy refund normalization evidence is append-only%',
  'The normalization event cannot be rewritten'
);
select ok(
  pg_temp.capture_error($$delete from public.refund_case_events
    where refund_case_id = '8d500000-0000-4000-8000-000000000001'
      and event_type = 'legacy_card_state_normalized'$$)
    like '%Legacy refund normalization evidence is append-only%',
  'The normalization event cannot be deleted'
);

insert into public.refund_case_events (
  refund_case_id, actor_user_id, event_type, message, metadata, created_at
)
values (
  '8d500000-0000-4000-8000-000000000001',
  '8d000000-0000-4000-8000-000000000001',
  'nayax_recommendation_evaluated',
  'Fresh synthetic read-only transaction check.',
  jsonb_build_object('payload_redacted', true),
  clock_timestamp() + interval '1 second'
);
select ok(
  not public.refund_case_legacy_state_review_required('8d500000-0000-4000-8000-000000000001'),
  'A later fresh transaction evaluation resolves only the historical-review freeze'
);
select ok(
  exists (
    select 1 from public.refund_cases refund_case
    where refund_case.id = '8d500000-0000-4000-8000-000000000001'
      and refund_case.status = 'needs_review'
      and refund_case.decision is null
      and refund_case.nayax_match_execution_eligible = false
      and refund_case.nayax_refund_execution_status = 'not_requested'
  ),
  'A fresh check does not itself approve, complete, or enable provider execution'
);

select * from finish();
rollback;
