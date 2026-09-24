begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  '12810000-0000-4000-8000-000000000001',
  'authenticated', 'authenticated', 'digest-manager@example.invalid', '', now(),
  '{}'::jsonb, '{}'::jsonb, now(), now()
);

insert into public.customer_accounts (id, name, account_type)
values ('12811000-0000-4000-8000-000000000001', 'Digest test', 'customer');

insert into public.reporting_locations (id, account_id, name, timezone)
values (
  '12812000-0000-4000-8000-000000000001',
  '12811000-0000-4000-8000-000000000001',
  'Unknown internal inventory', 'America/Los_Angeles'
);

insert into public.reporting_machines (
  id, account_id, location_id, machine_label, refund_public_display_label
) values (
  '12813000-0000-4000-8000-000000000001',
  '12811000-0000-4000-8000-000000000001',
  '12812000-0000-4000-8000-000000000001',
  'Private digest machine', 'Public lobby treats'
);

insert into public.reporting_machine_refund_managers (
  id, reporting_machine_id, manager_user_id, manager_email, grant_reason
) values (
  '12814000-0000-4000-8000-000000000001',
  '12813000-0000-4000-8000-000000000001',
  '12810000-0000-4000-8000-000000000001',
  'digest-manager@example.invalid', 'Synthetic digest test'
);

insert into public.refund_cases (
  id, public_reference, reporting_machine_id, reporting_location_id,
  customer_email, customer_name, issue_summary, incident_at, payment_method,
  payment_amount_cents, card_last4, status, automation_state,
  deterministic_fact_version, created_at
) values (
  '12815000-0000-4000-8000-000000000001', 'RF-DIGEST-1',
  '12813000-0000-4000-8000-000000000001',
  '12812000-0000-4000-8000-000000000001',
  'private-customer@example.invalid', 'Private Customer',
  'Private complaint content', '2026-09-08T12:00:00Z', 'card', 725, '4242',
  'needs_review', 'under_review', 1, '2026-09-08T12:00:00Z'
), (
  '12815000-0000-4000-8000-000000000002', 'RF-URGENT-2',
  '12813000-0000-4000-8000-000000000001',
  '12812000-0000-4000-8000-000000000001',
  'other-customer@example.invalid', 'Other Private Customer',
  'Other private complaint', '2026-09-09T12:00:00Z', 'card', 500, '1111',
  'needs_review', 'under_review', 1, '2026-09-09T12:00:00Z'
);

insert into public.refund_manager_attention_states (
  refund_case_id, attention_version, attention_started_at, case_status,
  correlation_status, deterministic_fact_version
) values
  ('12815000-0000-4000-8000-000000000001', 1, '2026-09-08T12:00:00Z',
   'needs_review', 'pending', 1),
  ('12815000-0000-4000-8000-000000000002', 1, '2026-09-09T12:00:00Z',
   'needs_review', 'pending', 1)
on conflict (refund_case_id) do update
set attention_version = excluded.attention_version,
    attention_started_at = excluded.attention_started_at,
    case_status = excluded.case_status,
    correlation_status = excluded.correlation_status,
    deterministic_fact_version = excluded.deterministic_fact_version;

select is((select delivery_enabled from public.refund_manager_digest_settings where singleton),
  false, 'Both delivery switches stay disabled by default');
select is(public.service_begin_next_refund_manager_digest('2026-09-10T15:00:00Z') ->> 'reason',
  'digest_disabled', 'Database switch prevents a digest claim');

set local role service_role;
create temporary table first_projection as
select public.refund_manager_daily_digest_projection_for(
  '12810000-0000-4000-8000-000000000001', '2026-09-10T15:00:00Z') as value;
reset role;
select is((select value ->> 'schemaVersion' from first_projection),
  'refund_manager_daily_digest_v2', 'Digest consumes its separate canonical snapshot');
select is((select value ->> 'openCount' from first_projection), '2',
  'All current open cases appear even without notification actions');
select ok(not (select value::text from first_projection) like any (array[
  '%private-customer@example.invalid%', '%Private Customer%',
  '%Private complaint%', '%4242%', '%Private digest machine%'
]), 'Digest snapshot contains no customer or internal machine details');

insert into public.refund_cases (
  id, public_reference, reporting_machine_id, reporting_location_id,
  customer_email, issue_summary, incident_at, payment_method,
  payment_amount_cents, status, automation_state, deterministic_fact_version, created_at
)
select ('12815000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  'RF-DIGEST-' || n, '12813000-0000-4000-8000-000000000001',
  '12812000-0000-4000-8000-000000000001',
  'case-' || n || '@example.invalid', 'Synthetic case',
  '2026-09-09T12:00:00Z', 'card', 500, 'needs_review',
  'under_review', 1, '2026-09-09T12:00:00Z'
from generate_series(3, 12) n;

set local role service_role;
select is(public.refund_manager_daily_digest_projection_for(
  '12810000-0000-4000-8000-000000000001', '2026-09-10T15:00:00Z') ->> 'openCount',
  '12', 'Queues over eight include every open case');
reset role;

update public.refund_manager_digest_settings set delivery_enabled = true where singleton;
create temporary table first_claim as
select public.service_begin_next_refund_manager_digest('2026-09-10T15:00:00Z') as value;
select is((select value ->> 'claimed' from first_claim), 'true',
  'Nonempty scoped queue produces a daily claim');
select is((select value #>> '{projection,openCount}' from first_claim), '12',
  'Claim carries the complete personal queue');
select is((select count(*)::text from public.refund_manager_digest_items), '12',
  'Ledger records all 12 cases without an attention-version cap');
select is(public.service_begin_next_refund_manager_digest('2026-09-10T15:00:00Z') ->> 'claimed',
  'false', 'Concurrent or replayed worker cannot claim a second daily message');
select is(public.service_begin_next_refund_manager_digest('2026-09-10T16:00:00Z') ->> 'reason',
  'outside_digest_hour', 'No catch-up burst outside the configured local hour');

select is(public.service_mark_refund_manager_digest_provider_started(
  (select (value ->> 'batchId')::uuid from first_claim),
  (select (value ->> 'claimToken')::uuid from first_claim),
  (select value ->> 'mappingFingerprint' from first_claim),
  (select value ->> 'recipient' from first_claim))::text,
  'true', 'Full current scope and snapshot pass the provider boundary');
select is(public.service_complete_refund_manager_digest(
  (select (value ->> 'batchId')::uuid from first_claim),
  (select (value ->> 'claimToken')::uuid from first_claim),
  'sent', 'synthetic-provider-message')::text,
  'true', 'Provider acceptance settles the daily batch');

create temporary table second_claim as
select public.service_begin_next_refund_manager_digest('2026-09-11T15:00:00Z') as value;
select is((select value ->> 'claimed' from second_claim), 'true',
  'Unchanged cases return on the next local date');
select is((select value #>> '{projection,openCount}' from second_claim), '12',
  'Second day again contains every unchanged case');
select is((select count(*)::text from public.refund_manager_digest_items), '24',
  'Daily ledger permits the same case on consecutive dates');

update public.refund_cases set refund_amount_cents = 800
where id = '12815000-0000-4000-8000-000000000001';
select is(public.service_mark_refund_manager_digest_provider_started(
  (select (value ->> 'batchId')::uuid from second_claim),
  (select (value ->> 'claimToken')::uuid from second_claim),
  (select value ->> 'mappingFingerprint' from second_claim),
  (select value ->> 'recipient' from second_claim))::text,
  'false', 'Changed amount invalidates the prepared digest before provider send');
create temporary table retry_claim as
select public.service_begin_next_refund_manager_digest('2026-09-11T15:02:00Z') as value;
select is((select value ->> 'claimed' from retry_claim), 'true',
  'Known-not-sent batch rebuilds with current case facts in the same local hour');
select is((select value #>> '{projection,items,0,amountCents}' from retry_claim),
  '800', 'Rebuilt digest shows the current reviewed amount');

update public.reporting_machine_refund_managers
set status = 'revoked', revoked_at = '2026-09-11T15:01:00Z',
  revoke_reason = 'Synthetic reassignment'
where id = '12814000-0000-4000-8000-000000000001';
select is(public.service_mark_refund_manager_digest_provider_started(
  (select (value ->> 'batchId')::uuid from retry_claim),
  (select (value ->> 'claimToken')::uuid from retry_claim),
  (select value ->> 'mappingFingerprint' from retry_claim),
  (select value ->> 'recipient' from retry_claim))::text,
  'false', 'Revocation before provider start prevents stale recipient delivery');
select is((select status from public.refund_manager_digest_batches
    where id = (select (value ->> 'batchId')::uuid from retry_claim)),
  'known_not_sent', 'Revoke-wins batch has explicit safe retry evidence');
set local role service_role;
select is(public.refund_manager_daily_digest_projection_for(
  '12810000-0000-4000-8000-000000000001', '2026-09-11T15:00:00Z') ->> 'openCount',
  '0', 'Removed mapping disappears from the next scoped snapshot');
reset role;

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  '12810000-0000-4000-8000-000000000002',
  'authenticated', 'authenticated', 'co-manager@example.invalid', '', now(),
  '{}'::jsonb, '{}'::jsonb, now(), now()
), (
  '00000000-0000-0000-0000-000000000000',
  '12810000-0000-4000-8000-000000000003',
  'authenticated', 'authenticated', 'unmapped-admin@example.invalid', '', now(),
  '{"role":"admin"}'::jsonb, '{}'::jsonb, now(), now()
);
insert into public.reporting_machine_refund_managers (
  id, reporting_machine_id, manager_user_id, manager_email, grant_reason
) values (
  '12814000-0000-4000-8000-000000000002',
  '12813000-0000-4000-8000-000000000001',
  '12810000-0000-4000-8000-000000000002',
  'co-manager@example.invalid', 'Synthetic co-manager'
);
create temporary table new_manager_claim as
select public.service_begin_next_refund_manager_digest('2026-09-12T15:00:00Z') as value;
select is((select value ->> 'recipient' from new_manager_claim),
  'co-manager@example.invalid', 'Current co-manager gets their own scoped daily message');
select is((select value #>> '{projection,openCount}' from new_manager_claim),
  '12', 'Co-manager sees every case on their mapped machine');
select is((select count(*)::text from public.refund_manager_digest_batches
  where manager_user_id = '12810000-0000-4000-8000-000000000003'),
  '0', 'Unmapped super-admin gets no case digest');

update public.reporting_machine_refund_managers
set manager_email = 'invalid-route'
where id = '12814000-0000-4000-8000-000000000002';
select is(public.service_begin_next_refund_manager_digest('2026-09-13T15:00:00Z') ->> 'reason',
  'invalid_route', 'Invalid route is visible to monitoring without a fallback recipient');
select is((select count(*)::text from public.refund_manager_digest_batches
  where digest_local_date = '2026-09-13'), '0',
  'Invalid route produces no empty or misdirected batch');
update public.reporting_machine_refund_managers
set manager_email = 'co-manager@example.invalid'
where id = '12814000-0000-4000-8000-000000000002';

insert into public.reporting_machines (
  id, account_id, location_id, machine_label, refund_public_display_label
) values (
  '12813000-0000-4000-8000-000000000002',
  '12811000-0000-4000-8000-000000000001',
  '12812000-0000-4000-8000-000000000001',
  'Private second machine', 'Second public machine'
);
insert into public.reporting_machine_refund_managers (
  id, reporting_machine_id, manager_user_id, manager_email, grant_reason
) values (
  '12814000-0000-4000-8000-000000000003',
  '12813000-0000-4000-8000-000000000002',
  '12810000-0000-4000-8000-000000000002',
  'co-manager@example.invalid', 'Synthetic second machine'
);
insert into public.refund_cases (
  id, public_reference, reporting_machine_id, reporting_location_id,
  customer_email, issue_summary, incident_at, payment_method,
  payment_amount_cents, status, automation_state, deterministic_fact_version, created_at
) values (
  '12815000-0000-4000-8000-000000000013', 'RF-DIGEST-13',
  '12813000-0000-4000-8000-000000000002',
  '12812000-0000-4000-8000-000000000001',
  'second-machine-customer@example.invalid', 'Synthetic second-machine case',
  '2026-09-09T12:00:00Z', 'card', 500, 'needs_review',
  'under_review', 1, '2026-09-09T12:00:00Z'
);
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  '12810000-0000-4000-8000-000000000004',
  'authenticated', 'authenticated', 'second-co-manager@example.invalid', '', now(),
  '{}'::jsonb, '{}'::jsonb, now(), now()
);
insert into public.reporting_machine_refund_managers (
  id, reporting_machine_id, manager_user_id, manager_email, grant_reason
) values (
  '12814000-0000-4000-8000-000000000004',
  '12813000-0000-4000-8000-000000000001',
  '12810000-0000-4000-8000-000000000004',
  'second-co-manager@example.invalid', 'Synthetic simultaneous co-manager'
);
select is(public.service_begin_next_refund_manager_digest('2026-11-01T15:00:00Z') ->> 'reason',
  'outside_digest_hour', 'DST fall-back does not send at the old UTC hour');
create temporary table winter_claim as
select public.service_begin_next_refund_manager_digest('2026-11-01T16:00:00Z') as value;
select is((select value ->> 'claimed' from winter_claim),
  'true', '08:00 America/Los_Angeles sends at the winter UTC hour');
select is((select value #>> '{projection,openCount}' from winter_claim),
  '13', 'One manager gets one combined digest across two assigned machines');
select is((select count(*)::text from public.refund_manager_digest_batches
  where manager_user_id = '12810000-0000-4000-8000-000000000002'
    and digest_local_date = '2026-11-01'),
  '1', 'Multiple machine mappings do not duplicate the manager message');
create temporary table other_co_manager_claim as
select public.service_begin_next_refund_manager_digest('2026-11-01T16:00:00Z') as value;
select is((select value ->> 'recipient' from other_co_manager_claim),
  'second-co-manager@example.invalid', 'Simultaneous co-manager gets their own daily message');
select is((select value #>> '{projection,openCount}' from other_co_manager_claim),
  '12', 'Co-manager sees only their mapped first machine, not the second');
select is(public.service_begin_next_refund_manager_digest('2027-03-14T16:00:00Z') ->> 'reason',
  'outside_digest_hour', 'DST spring change does not send at the former UTC hour');
select is(public.service_begin_next_refund_manager_digest('2027-03-14T15:00:00Z') ->> 'claimed',
  'true', '08:00 America/Los_Angeles sends at the summer UTC hour');

-- Exercise the daily projection against real lifecycle rows. A paid customer
-- whose completion notice was delivered is closed to the digest even if an
-- internal accounting follow-up remains; stale legacy queue buckets must not
-- revive that case or a denied case.
insert into public.refund_cases (
  id, public_reference, reporting_machine_id, reporting_location_id,
  customer_email, issue_summary, incident_at, payment_method,
  payment_amount_cents, refund_amount_cents, status, decision,
  refund_completed_at, correlation_status, correlation_source,
  correlation_confidence, automation_state, nayax_refund_execution_status,
  nayax_match_execution_eligible, matched_nayax_transaction_id,
  matched_nayax_machine_auth_time, matched_nayax_amount_cents,
  matched_nayax_currency_code, matched_nayax_site_id
) values (
  '12815000-0000-4000-8000-000000000014', 'RF-DIGEST-PAID-NOTIFIED',
  '12813000-0000-4000-8000-000000000001',
  '12812000-0000-4000-8000-000000000001',
  'paid-notified@example.invalid', 'Synthetic settled refund',
  '2026-09-14T12:00:00Z', 'card', 500, 500, 'completed', 'approved',
  statement_timestamp(), 'matched', 'nayax', 1, 'completed', 'approved',
  false, 'DIGEST-PAID-14',
  '2026-09-14T12:00:00Z', 500, 'USD', 7001
), (
  '12815000-0000-4000-8000-000000000015', 'RF-DIGEST-DENIED',
  '12813000-0000-4000-8000-000000000001',
  '12812000-0000-4000-8000-000000000001',
  'denied@example.invalid', 'Synthetic denied refund',
  '2026-09-15T12:00:00Z', 'card', 500, null, 'denied', 'denied',
  null, 'no_match', null, 0, 'under_review', 'not_requested', false,
  null, null, null, null, null
);

insert into public.sales_adjustment_facts (
  id, reporting_machine_id, reporting_location_id, adjustment_date,
  adjustment_type, amount_cents, complaint_count, source,
  source_row_hash, source_reference, source_row_reference, refund_case_id,
  match_status, match_confidence, notes, raw_payload
) values (
  '12816000-0000-4000-8000-000000000014',
  '12813000-0000-4000-8000-000000000001',
  '12812000-0000-4000-8000-000000000001',
  current_date, 'refund', 500, 1, 'refund_case',
  'digest-paid-notified-14', 'refund_cases', 'RF-DIGEST-PAID-NOTIFIED',
  '12815000-0000-4000-8000-000000000014', 'applied', 1,
  'Synthetic committed payment', jsonb_build_object(
    'refund_case_id', '12815000-0000-4000-8000-000000000014',
    'refund_case_reference', 'RF-DIGEST-PAID-NOTIFIED',
    'refund_case_status', 'completed', 'refund_case_decision', 'approved',
    'payment_method', 'card', 'correlation_source', 'nayax',
    'correlation_has_card_lookup', true, 'payload_redacted', true
  )
);
update public.refund_cases
set reporting_adjustment_id = '12816000-0000-4000-8000-000000000014'
where id = '12815000-0000-4000-8000-000000000014';
insert into public.refund_case_nayax_refund_attempts (
  id, refund_case_id, execution_mode, status, idempotency_key, amount_cents,
  provider_reference, provider_status, sanitized_response, provider_outcome,
  provider_outcome_recorded_at, reconciliation_required,
  reporting_adjustment_id, case_finalization_committed_at, completed_at
) values (
  '12817000-0000-4000-8000-000000000014',
  '12815000-0000-4000-8000-000000000014',
  'request_and_approve', 'succeeded', 'digest-settlement-14', 500,
  'DIGEST-PROVIDER-14', 'approved',
  '{"provider_outcome":"success","payload_redacted":true}'::jsonb,
  'success', statement_timestamp(), false,
  '12816000-0000-4000-8000-000000000014',
  statement_timestamp(), statement_timestamp()
);
insert into public.refund_case_messages (
  id, refund_case_id, nayax_refund_attempt_id, message_type, status,
  recipient_email, subject, body, sent_at, delivery_transport,
  provider_message_id, delivery_state, delivery_state_updated_at
) values (
  '12818000-0000-4000-8000-000000000014',
  '12815000-0000-4000-8000-000000000014',
  '12817000-0000-4000-8000-000000000014',
  'completed', 'sent', 'paid-notified@example.invalid',
  'Synthetic completion', 'Synthetic completion', statement_timestamp(),
  'resend', 'digest-completion-14', 'delivered', statement_timestamp()
);
insert into public.refund_transactional_delivery_events (
  event_key_digest, provider_message_id, delivery_state, event_at,
  matched_refund_case_message_id, applied_at
) values (
  repeat('d', 63) || '5', 'digest-completion-14', 'delivered',
  statement_timestamp(), '12818000-0000-4000-8000-000000000014',
  statement_timestamp()
);
insert into public.refund_authoritative_receipts (
  refund_case_id, nayax_refund_attempt_id, reporting_machine_id,
  account_scope, provider_machine_id, original_transaction_id,
  original_amount_cents, refunded_amount_cents, currency_code,
  provider_status, evidence_reference_digest, recorded_by,
  attempt_binding_kind, current_provider_observation_reviewed
) values (
  '12815000-0000-4000-8000-000000000014',
  '12817000-0000-4000-8000-000000000014',
  '12813000-0000-4000-8000-000000000001',
  'DIGEST-TEST-ACCOUNT', 'DIGEST-TEST-MACHINE', 'DIGEST-PAID-14',
  500, 500, 'USD', 62, repeat('d', 63) || '4',
  '12810000-0000-4000-8000-000000000001',
  'verified_authorized_api', true
);

select is(public.refund_lifecycle_contract(
  '12815000-0000-4000-8000-000000000014') #>> '{accountingState,state}',
  'pending', 'Receipt keeps its separate accounting follow-up pending');
select is(public.refund_lifecycle_contract(
  '12815000-0000-4000-8000-000000000014') #>> '{nextWork,isOpen}',
  'false', 'Delivered paid case is canonically closed to the digest');
select is(public.refund_lifecycle_contract(
  '12815000-0000-4000-8000-000000000015') #>> '{nextWork,isOpen}',
  'false', 'Denied case is canonically closed to the digest');
set local role service_role;
create temporary table terminal_projection as
select public.refund_manager_daily_digest_projection_for(
  '12810000-0000-4000-8000-000000000004',
  '2027-03-15T15:00:00Z') as value;
reset role;
select is((select value ->> 'openCount' from terminal_projection), '12',
  'Daily digest excludes paid-notified and denied cases while retaining unchanged open cases');
select ok(not (select value::text from terminal_projection) like any (array[
  '%RF-DIGEST-PAID-NOTIFIED%', '%RF-DIGEST-DENIED%'
]), 'Neither terminal case appears in the actual daily digest projection');

select * from finish();
rollback;
