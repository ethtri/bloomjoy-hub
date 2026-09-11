begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(45);

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

select is(
  (select delivery_enabled from public.refund_manager_digest_settings where singleton),
  false,
  'Digest delivery is disabled by default'
);

create temporary table digest_action as
select public.service_begin_refund_manager_notification(
  '12815000-0000-4000-8000-000000000001', 'customer_reply',
  'private-customer@example.invalid', array['refunds@example.invalid'],
  array['ops@example.invalid']
) as value;

select is((select value ->> 'channel' from digest_action), 'daily_digest',
  'Customer replies classify as daily digest after the consumer exists');
select is((select value ->> 'deliveryState' from digest_action), 'digest_eligible',
  'Digest classification persists eligible work without sending');
select is((select value ->> 'urgency' from digest_action), 'routine',
  'Digest work remains nonurgent');

create temporary table urgent_action as
select public.service_begin_refund_manager_notification(
  '12815000-0000-4000-8000-000000000002', 'hard_bounce',
  'other-customer@example.invalid', array['refunds@example.invalid'],
  array['ops@example.invalid']
) as value;

select is((select value ->> 'channel' from urgent_action), 'immediate',
  'Urgent exceptions remain on the immediate path');
select is((select value ->> 'deliveryState' from urgent_action), 'reserved',
  'Urgent delivery still reserves the existing outbox');

select set_config(
  'request.jwt.claims',
  '{"sub":"12810000-0000-4000-8000-000000000001","role":"authenticated","is_anonymous":false}',
  true
);
select ok(
  has_function_privilege('service_role',
    'public.refund_manager_work_projection_for(uuid,timestamptz)', 'execute'),
  'Service role can execute the internal projection used by digest claims'
);
select ok(
  not has_function_privilege('authenticated',
    'public.refund_manager_work_projection_for(uuid,timestamptz)', 'execute'),
  'Authenticated callers cannot bypass the mapped browser projection'
);
set local role service_role;
select lives_ok(
  $$ select public.refund_manager_work_projection_for(
    '12810000-0000-4000-8000-000000000001', '2026-09-10T15:00:00Z'
  ) $$,
  'A real service-role digest claim can execute the shared internal projection'
);
reset role;
create temporary table manager_projection as
select public.get_refund_manager_work_projection('2026-09-10T15:00:00Z') as value;

select is((select value ->> 'schemaVersion' from manager_projection),
  'refund_manager_work_v1', 'Portal projection has a stable version');
select is((select value #>> '{bucketCounts,needs_action}' from manager_projection),
  '2', 'Projection reuses the canonical six-bucket queue');
select is((select value #>> '{digestCounts,newInformation}' from manager_projection),
  '1', 'Digest and portal share the new-information count');
select is((select value #>> '{items,0,locationName}' from manager_projection),
  'Public lobby treats', 'Internal location placeholders use the public label');
select is((select value #>> '{items,0,machineLabel}' from manager_projection),
  'Public lobby treats', 'Only the public machine label is projected');
select is((select value #>> '{items,0,actionCode}' from manager_projection),
  public.get_refund_lifecycle_for_manager('12815000-0000-4000-8000-000000000001')
    #>> '{managerAction,action}',
  'Projection action matches the manager portal lifecycle');
select ok(
  not ((select value::text from manager_projection) like any (array[
    '%private-customer@example.invalid%', '%Private Customer%',
    '%Private complaint%', '%4242%', '%Private digest machine%',
    '%Unknown internal inventory%'
  ])),
  'Projection excludes customer, card, complaint, private machine, and placeholder fields'
);
select is((select value #>> '{items,1,urgentNoticeState}' from manager_projection),
  'immediate_unresolved', 'Unresolved urgent notice is labeled separately');

select is(
  (public.service_begin_next_refund_manager_digest('2026-09-10T15:00:00Z') ->> 'reason'),
  'digest_disabled', 'Database kill switch blocks digest claims'
);
update public.refund_manager_digest_settings set delivery_enabled = true where singleton;

create temporary table first_claim as
select public.service_begin_next_refund_manager_digest('2026-09-10T15:00:00Z') as value;
select is((select value ->> 'claimed' from first_claim), 'true',
  'One nonempty manager digest is claimed');
select is((select jsonb_array_length(value #> '{projection,items}')::text from first_claim),
  '1', 'Claim contains only the digest-eligible item');
select is((select value #>> '{projection,items,0,caseId}' from first_claim),
  '12815000-0000-4000-8000-000000000001', 'Claim keeps the exact case link identity');

select is(
  (public.service_begin_next_refund_manager_digest('2026-09-10T15:00:00Z') ->> 'claimed'),
  'false', 'Concurrent worker cannot claim a second daily digest'
);
select is(
  (select duplicate_suppressed_count::text from public.refund_manager_digest_batches),
  '1', 'Duplicate suppression is retained as a safe metric'
);

select is(
  public.service_mark_refund_manager_digest_provider_started(
    (select (value ->> 'batchId')::uuid from first_claim),
    (select (value ->> 'claimToken')::uuid from first_claim),
    (select value ->> 'mappingFingerprint' from first_claim),
    (select value ->> 'recipient' from first_claim)
  ), true, 'Current mapping and items authorize one provider boundary'
);
select throws_ok(
  $$ select public.service_complete_refund_manager_digest(
    (select (value ->> 'batchId')::uuid from first_claim),
    (select (value ->> 'claimToken')::uuid from first_claim),
    'sent', '   '
  ) $$,
  'P0001', null, 'Sent settlement requires a nonblank provider message id'
);
select is(
  public.service_complete_refund_manager_digest(
    (select (value ->> 'batchId')::uuid from first_claim),
    (select (value ->> 'claimToken')::uuid from first_claim),
    'delivery_unknown', null
  ), true, 'Provider-started delivery-unknown settlement is idempotent'
);
select is(
  public.service_complete_refund_manager_digest(
    (select (value ->> 'batchId')::uuid from first_claim),
    (select (value ->> 'claimToken')::uuid from first_claim),
    'sent', 'synthetic-provider-id'
  ), true, 'Provider acceptance settles the one daily batch'
);
select is(
  public.service_complete_refund_manager_digest(
    (select (value ->> 'batchId')::uuid from first_claim),
    (select (value ->> 'claimToken')::uuid from first_claim),
    'sent', 'synthetic-provider-id'
  ), true, 'Exact terminal sent settlement replay is idempotent'
);
select throws_ok(
  $$ select public.service_complete_refund_manager_digest(
    (select (value ->> 'batchId')::uuid from first_claim),
    (select (value ->> 'claimToken')::uuid from first_claim),
    'delivery_unknown', null
  ) $$,
  'P0001', null, 'Sent settlement cannot be downgraded'
);
select throws_ok(
  $$ select public.service_complete_refund_manager_digest(
    (select (value ->> 'batchId')::uuid from first_claim),
    (select (value ->> 'claimToken')::uuid from first_claim),
    'sent', 'different-provider-id'
  ) $$,
  'P0001', null, 'Sent settlement cannot mutate its provider evidence'
);
insert into public.refund_manager_digest_batches (
  id, manager_user_id, digest_local_date, digest_timezone, status, claim_token,
  mapping_fingerprint, recipient_fingerprint
) values (
  '12816000-0000-4000-8000-000000000001',
  '12810000-0000-4000-8000-000000000001',
  '2026-09-09', 'America/Los_Angeles', 'reserved',
  '12817000-0000-4000-8000-000000000001', repeat('a', 64), repeat('b', 64)
);
select is(
  public.service_complete_refund_manager_digest(
    '12816000-0000-4000-8000-000000000001',
    '12817000-0000-4000-8000-000000000001',
    'known_not_sent', null
  ), true, 'An unstarted reservation can settle known-not-sent'
);
select is(
  public.service_complete_refund_manager_digest(
    '12816000-0000-4000-8000-000000000001',
    '12817000-0000-4000-8000-000000000001',
    'known_not_sent', null
  ), true, 'Exact known-not-sent terminal replay is idempotent'
);
select throws_ok(
  $$ select public.service_complete_refund_manager_digest(
    '12816000-0000-4000-8000-000000000001',
    '12817000-0000-4000-8000-000000000001',
    'sent', 'late-provider-id'
  ) $$,
  'P0001', null, 'Known-not-sent settlement cannot be upgraded after release'
);
select is(
  (public.service_begin_next_refund_manager_digest('2026-09-11T15:00:00Z') ->> 'claimed'),
  'false', 'Unchanged attention version is not repeated on the next day'
);

-- A routine digest event and an urgent immediate event may coexist for one
-- attention version in either arrival order. The digest item stays eligible,
-- while the urgent state is independently visible and never changes its copy.
select public.service_begin_refund_manager_notification(
  '12815000-0000-4000-8000-000000000001', 'hard_bounce',
  'private-customer@example.invalid', array['refunds@example.invalid'],
  array['ops@example.invalid']
);
select public.service_begin_refund_manager_notification(
  '12815000-0000-4000-8000-000000000001', 'manager_reminder',
  'private-customer@example.invalid', array['refunds@example.invalid'],
  array['ops@example.invalid']
);
select public.service_begin_refund_manager_notification(
  '12815000-0000-4000-8000-000000000002', 'manager_reminder',
  'other-customer@example.invalid', array['refunds@example.invalid'],
  array['ops@example.invalid']
);
select public.service_begin_refund_manager_notification(
  '12815000-0000-4000-8000-000000000002', 'customer_reply',
  'other-customer@example.invalid', array['refunds@example.invalid'],
  array['ops@example.invalid']
);
create temporary table mixed_action_projection as
select public.refund_manager_work_projection_for(
  '12810000-0000-4000-8000-000000000001', '2026-09-11T15:00:00Z'
) as value;
select is((
  select item ->> 'digestEligible'
  from mixed_action_projection, jsonb_array_elements(value -> 'items') item
  where item ->> 'caseId' = '12815000-0000-4000-8000-000000000001'
), 'true', 'Routine-first work remains digest eligible after a later urgent event');
select is((
  select item ->> 'urgentNoticeState'
  from mixed_action_projection, jsonb_array_elements(value -> 'items') item
  where item ->> 'caseId' = '12815000-0000-4000-8000-000000000001'
), 'immediate_unresolved', 'Routine-first work retains its independent urgent label');
select is((
  select item ->> 'digestEligible'
  from mixed_action_projection, jsonb_array_elements(value -> 'items') item
  where item ->> 'caseId' = '12815000-0000-4000-8000-000000000002'
), 'true', 'Urgent-first work remains eligible after a later routine event');
select is((
  select item ->> 'urgentNoticeState'
  from mixed_action_projection, jsonb_array_elements(value -> 'items') item
  where item ->> 'caseId' = '12815000-0000-4000-8000-000000000002'
), 'immediate_unresolved', 'Urgent-first work retains its independent urgent label');
select is((
  select item ->> 'noticeReason'
  from mixed_action_projection, jsonb_array_elements(value -> 'items') item
  where item ->> 'caseId' = '12815000-0000-4000-8000-000000000001'
), 'customer_reply', 'Reply-first routine work keeps the canonical new-information action');
select is((
  select item ->> 'noticeReason'
  from mixed_action_projection, jsonb_array_elements(value -> 'items') item
  where item ->> 'caseId' = '12815000-0000-4000-8000-000000000002'
), 'customer_reply', 'Reminder-first routine work still selects the canonical new-information action');

update public.refund_manager_attention_states
set attention_version = 2, updated_at = '2026-09-11T16:00:00Z'
where refund_case_id = '12815000-0000-4000-8000-000000000001';
select is(public.service_resolve_refund_manager_digest_items('2026-09-11T16:00:00Z')::text,
  '1', 'Attention-version change resolves the old digest item automatically');
select is((select item_state from public.refund_manager_digest_items),
  'resolved', 'Resolved digest state needs no mark-read chore');

update public.reporting_machine_refund_managers
set status = 'revoked', revoked_at = '2026-09-11T16:00:00Z',
    revoke_reason = 'Synthetic digest projection removal'
where manager_user_id = '12810000-0000-4000-8000-000000000001';
select is(
  jsonb_array_length(public.refund_manager_work_projection_for(
    '12810000-0000-4000-8000-000000000001', '2026-09-11T16:00:00Z'
  ) -> 'items')::text,
  '0', 'Removed mapping disappears from the next server projection'
);
select is(
  jsonb_array_length(public.get_refund_manager_work_projection(
    '2026-09-11T16:00:00Z'
  ) -> 'items')::text,
  '0', 'An authenticated elevated user without a machine mapping receives an empty projection'
);
select ok(
  not has_function_privilege('anon',
    'public.get_refund_manager_work_projection(timestamptz)', 'execute'),
  'Anonymous sessions cannot read manager work'
);

select * from finish();
rollback;
