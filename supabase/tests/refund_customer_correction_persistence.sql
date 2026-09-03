begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(44);

select has_column(
  'public',
  'refund_cases',
  'card_last4_provenance',
  'Refund cases store explicit physical-card versus wallet-token provenance'
);

select ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'public.refund_cases'::regclass
      and conname = 'refund_cases_wallet_last4_provenance_check'
  ),
  'Wallet-token provenance is constrained to wallet card cases'
);

select is(
  public.canonical_refund_follow_up_fields(array[
    'card_network',
    'wallet_provider',
    'payment_interaction',
    'card_last4',
    'card_network'
  ]),
  array['payment_interaction', 'wallet_provider', 'card_last4', 'card_network']::text[],
  'Correction fields are canonical, ordered, and deduplicated'
);

select ok(
  pg_get_triggerdef(
    (
      select oid
      from pg_trigger
      where tgrelid = 'public.refund_cases'::regclass
        and tgname = 'refund_cases_guard_deterministic_fact_version'
    )
  ) like '%payment_interaction%'
  and pg_get_triggerdef(
    (
      select oid
      from pg_trigger
      where tgrelid = 'public.refund_cases'::regclass
        and tgname = 'refund_cases_guard_deterministic_fact_version'
    )
  ) like '%wallet_provider%'
  and pg_get_triggerdef(
    (
      select oid
      from pg_trigger
      where tgrelid = 'public.refund_cases'::regclass
        and tgname = 'refund_cases_guard_deterministic_fact_version'
    )
  ) like '%card_last4_provenance%',
  'Interaction, wallet provider, and last-four provenance invalidate stale matching evidence'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.service_apply_refund_wallet_correction_v2(text,text,text,text,timestamp with time zone,text,boolean)',
    'execute'
  ),
  'Anonymous clients cannot call the wallet correction persistence RPC directly'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.service_apply_refund_wallet_correction_v2(text,text,text,text,timestamp with time zone,text,boolean)',
    'execute'
  ),
  'Authenticated browser clients cannot call the wallet correction persistence RPC directly'
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  'a0000000-0000-4000-8000-000000000001',
  'authenticated', 'authenticated', 'correction-manager@example.test', '',
  now(), '{}'::jsonb, '{}'::jsonb, now(), now()
);

insert into public.customer_accounts (id, name, account_type)
values (
  'a1000000-0000-4000-8000-000000000001',
  'Customer correction persistence test',
  'customer'
);

insert into public.reporting_locations (
  id,
  account_id,
  name,
  timezone,
  status
)
values (
  'a2000000-0000-4000-8000-000000000001',
  'a1000000-0000-4000-8000-000000000001',
  'Correction persistence location',
  'America/Los_Angeles',
  'active'
);

insert into public.reporting_machines (
  id,
  account_id,
  location_id,
  machine_label,
  machine_type,
  status,
  refund_intake_enabled,
  refund_public_display_label
)
values (
  'a3000000-0000-4000-8000-000000000001',
  'a1000000-0000-4000-8000-000000000001',
  'a2000000-0000-4000-8000-000000000001',
  'Private correction persistence label',
  'commercial',
  'active',
  true,
  'Cotton Candy correction test'
);

insert into public.reporting_machine_refund_managers (
  reporting_machine_id, manager_user_id, manager_email, grant_reason
) values (
  'a3000000-0000-4000-8000-000000000001',
  'a0000000-0000-4000-8000-000000000001',
  'correction-manager@example.test',
  'Customer correction provenance fixture'
);

insert into public.refund_cases (
  id,
  reporting_machine_id,
  reporting_location_id,
  customer_email,
  customer_name,
  issue_summary,
  incident_at,
  incident_local_datetime,
  incident_timezone,
  incident_time_resolution,
  payment_method,
  payment_amount_cents,
  refund_amount_cents,
  card_last4,
  card_network,
  card_wallet_used,
  payment_interaction,
  wallet_provider,
  status,
  correlation_status,
  correlation_source
)
values (
  'a4000000-0000-4000-8000-000000000001',
  'a3000000-0000-4000-8000-000000000001',
  'a2000000-0000-4000-8000-000000000001',
  'correction-customer@example.test',
  'Correction Customer',
  'Customer correction persistence fixture',
  statement_timestamp() - interval '2 hours',
  to_char(statement_timestamp() - interval '2 hours', 'YYYY-MM-DD"T"HH24:MI'),
  'America/Los_Angeles',
  'exact',
  'card',
  700,
  700,
  '1111',
  'mastercard',
  true,
  'phone_watch_wallet',
  'unsure',
  'needs_review',
  'no_match',
  'nayax'
);

update public.refund_customer_contact_settings
set automatic_customer_contact_enabled = true
where singleton;

select lives_ok(
  $$select public.service_issue_refund_wallet_correction(
    'a4000000-0000-4000-8000-000000000001',
    repeat('a', 64),
    statement_timestamp() + interval '2 hours'
  )$$,
  'A bounded secure wallet correction can be issued for the fixture'
);

select lives_ok(
  $$select public.service_apply_refund_wallet_correction_v2(
    repeat('a', 64),
    'apple_pay',
    'Visa',
    '2222',
    statement_timestamp() - interval '1 hour',
    to_char(statement_timestamp() - interval '1 hour', 'YYYY-MM-DD"T"HH24:MI'),
    true
  )$$,
  'One secure submission atomically persists every corrected wallet fact'
);

select is(
  (select deterministic_fact_version from public.refund_cases where id = 'a4000000-0000-4000-8000-000000000001'),
  2::bigint,
  'One customer correction advances the deterministic fact version exactly once'
);

select results_eq(
  $$select card_network, card_last4, card_last4_provenance, payment_interaction, wallet_provider
    from public.refund_cases
    where id = 'a4000000-0000-4000-8000-000000000001'$$,
  $$values ('visa'::text, '2222'::text, 'wallet_device_token'::text, 'phone_watch_wallet'::text, 'apple_pay'::text)$$,
  'Normalized network, device-token provenance, interaction, and provider persist on the same case'
);

select results_eq(
  $$select status, automation_state, correlation_status
    from public.refund_cases
    where id = 'a4000000-0000-4000-8000-000000000001'$$,
  $$values ('needs_review'::text, 'wallet_correction_received'::text, 'needs_nayax'::text)$$,
  'The corrected fact version is queued for one fresh Nayax match'
);

select is(
  (select status from public.refund_wallet_correction_contexts where token_hash = repeat('a', 64)),
  'submitted',
  'The correction token is consumed exactly once'
);

select is(
  (
    select count(*)::integer
    from public.refund_case_events
    where refund_case_id = 'a4000000-0000-4000-8000-000000000001'
      and event_type = 'wallet_correction_received'
      and metadata ->> 'resulting_fact_version' = '2'
      and metadata -> 'changed_fields' ? 'card_last4_provenance'
      and metadata ->> 'payload_redacted' = 'true'
  ),
  1,
  'One redacted audit event records the resulting version and changed evidence'
);

select throws_ok(
  $$select public.service_apply_refund_wallet_correction_v2(
    repeat('a', 64),
    'apple_pay',
    'Visa',
    '2222',
    statement_timestamp() - interval '1 hour',
    to_char(statement_timestamp() - interval '1 hour', 'YYYY-MM-DD"T"HH24:MI'),
    true
  )$$,
  'P0001',
  'This wallet correction link is invalid or has expired',
  'A duplicate Gmail or form replay cannot apply the same correction twice'
);

select has_table(
  'public',
  'refund_customer_fact_applications',
  'Verified Gmail fact applications have a private idempotency ledger'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.service_apply_refund_gmail_customer_facts_v1(uuid,uuid,bigint,jsonb,text[],text)',
    'execute'
  ),
  'Browser clients cannot invoke the atomic Gmail fact application RPC'
);

insert into public.refund_gmail_threads (
  id, refund_case_id, mailbox_hash, provider_thread_id, thread_subject,
  first_message_at, latest_message_at, retention_expires_at
) values (
  'a5000000-0000-4000-8000-000000000001',
  'a4000000-0000-4000-8000-000000000001',
  repeat('b', 64),
  'correction-persistence-thread',
  'Correction persistence reply',
  statement_timestamp(),
  statement_timestamp(),
  statement_timestamp() + interval '30 days'
);

insert into public.refund_gmail_messages (
  id, gmail_thread_id, refund_case_id, provider_message_id, direction,
  message_kind, status, sender_email, recipient_email, participant_role,
  participant_trust, subject, plain_body, received_at, retention_expires_at
) values
  (
    'a6000000-0000-4000-8000-000000000001',
    'a5000000-0000-4000-8000-000000000001',
    'a4000000-0000-4000-8000-000000000001',
    'correction-persistence-message-1',
    'inbound', 'message', 'received',
    'correction-customer@example.test', 'refunds@example.test',
    'customer', 'verified', 'Correction details',
    'Wallet provider: Google Wallet',
    statement_timestamp(), statement_timestamp() + interval '30 days'
  ),
  (
    'a6000000-0000-4000-8000-000000000002',
    'a5000000-0000-4000-8000-000000000001',
    'a4000000-0000-4000-8000-000000000001',
    'correction-persistence-message-2',
    'inbound', 'message', 'received',
    'correction-customer@example.test', 'refunds@example.test',
    'customer', 'verified', 'Correction details retry',
    'Card type: Mastercard',
    statement_timestamp(), statement_timestamp() + interval '30 days'
  );

select is(
  public.service_apply_refund_gmail_customer_facts_v1(
    'a4000000-0000-4000-8000-000000000001',
    'a6000000-0000-4000-8000-000000000001',
    2,
    '{"wallet_provider":"google_wallet"}'::jsonb,
    array['wallet_provider'],
    'labeled_customer_correction_v3'
  ) ->> 'outcome',
  'applied',
  'The RPC atomically applies a verified reply against the expected fact version'
);

select is(
  (select deterministic_fact_version from public.refund_cases where id = 'a4000000-0000-4000-8000-000000000001'),
  3::bigint,
  'The atomic Gmail application advances the fact version exactly once'
);

select is(
  (
    select count(*)::integer
    from public.refund_customer_fact_applications application
    join public.refund_case_events event on event.id = application.event_id
    where application.gmail_message_id = 'a6000000-0000-4000-8000-000000000001'
      and application.resulting_fact_version = 3
      and event.metadata ->> 'resulting_fact_version' = '3'
      and event.metadata ->> 'payload_redacted' = 'true'
      and event.metadata::text not like '%a6000000-0000-4000-8000-000000000001%'
  ),
  1,
  'Case update, private ledger, and redacted version-bound event commit together'
);

select is(
  public.service_apply_refund_gmail_customer_facts_v1(
    'a4000000-0000-4000-8000-000000000001',
    'a6000000-0000-4000-8000-000000000001',
    2,
    '{"wallet_provider":"google_wallet"}'::jsonb,
    array['wallet_provider'],
    'labeled_customer_correction_v3'
  ) ->> 'outcome',
  'already_applied',
  'Replaying an ingested Gmail message returns the durable idempotent outcome'
);

select is(
  (select deterministic_fact_version from public.refund_cases where id = 'a4000000-0000-4000-8000-000000000001'),
  3::bigint,
  'Idempotent replay cannot advance the fact version or duplicate the event'
);

select is(
  public.service_apply_refund_gmail_customer_facts_v1(
    'a4000000-0000-4000-8000-000000000001',
    'a6000000-0000-4000-8000-000000000002',
    2,
    '{"card_network":"mastercard"}'::jsonb,
    array['card_network'],
    'labeled_customer_correction_v3'
  ) ->> 'outcome',
  'conflict',
  'A stale expected fact version returns an explicit retryable conflict'
);

select is(
  (
    select count(*)::integer
    from public.refund_customer_fact_applications
    where gmail_message_id = 'a6000000-0000-4000-8000-000000000002'
  ),
  0,
  'A conflict records no final ledger row so duplicate ingestion may retry later'
);

select ok(not has_function_privilege('anon',
  'public.service_get_refund_gmail_fact_application_v1(uuid,uuid)', 'execute'),
  'Anonymous clients cannot read private reply receipts');
select ok(not has_function_privilege('authenticated',
  'public.service_get_refund_gmail_fact_application_v1(uuid,uuid)', 'execute'),
  'Browser clients cannot read private reply receipts');
select ok(has_function_privilege('service_role',
  'public.service_get_refund_gmail_fact_application_v1(uuid,uuid)', 'execute'),
  'The worker can read a narrowly scoped reply receipt');
select ok(not has_table_privilege('service_role',
  'public.refund_customer_fact_applications', 'select'),
  'Reply recovery does not expose the private application ledger');

select is(public.service_get_refund_gmail_fact_application_v1(
  'a4000000-0000-4000-8000-000000000001', 'a6000000-0000-4000-8000-000000000001'),
  '{"outcome":"already_applied","factVersion":3,"appliedFields":["wallet_provider"]}'::jsonb,
  'The same verified message recovers its exact current-version redacted receipt');
select is(public.service_get_refund_gmail_fact_application_v1(
  'a4000000-0000-4000-8000-000000000001', 'a6000000-0000-4000-8000-000000000001'),
  '{"outcome":"already_applied","factVersion":3,"appliedFields":["wallet_provider"]}'::jsonb,
  'Repeating receipt recovery is read-only and idempotent');
select is(public.service_get_refund_gmail_fact_application_v1(
  'a4000000-0000-4000-8000-000000000001', 'a6000000-0000-4000-8000-000000000002') ->> 'outcome',
  'not_applied', 'A different verified message cannot borrow the earlier application');
select is(public.service_get_refund_gmail_fact_application_v1(
  'a4000000-0000-4000-8000-000000000001', null) ->> 'outcome',
  'conflict', 'A missing source cannot authorize reply recovery');
select is(public.service_get_refund_gmail_fact_application_v1(
  'a4000000-0000-4000-8000-000000000099', 'a6000000-0000-4000-8000-000000000001') ->> 'outcome',
  'conflict', 'A foreign case cannot borrow a verified reply receipt');

update public.refund_gmail_messages set participant_trust = 'unverified'
where id = 'a6000000-0000-4000-8000-000000000001';
select is(public.service_get_refund_gmail_fact_application_v1(
  'a4000000-0000-4000-8000-000000000001', 'a6000000-0000-4000-8000-000000000001') ->> 'outcome',
  'conflict', 'An unverified source cannot recover even a previously applied reply');
update public.refund_gmail_messages set participant_trust = 'verified', direction = 'outbound'
where id = 'a6000000-0000-4000-8000-000000000001';
select is(public.service_get_refund_gmail_fact_application_v1(
  'a4000000-0000-4000-8000-000000000001', 'a6000000-0000-4000-8000-000000000001') ->> 'outcome',
  'conflict', 'An outbound source cannot authorize reply recovery');
update public.refund_gmail_messages set direction = 'inbound'
where id = 'a6000000-0000-4000-8000-000000000001';
select is((select count(*)::integer from public.refund_customer_fact_applications
  where refund_case_id = 'a4000000-0000-4000-8000-000000000001'),
  1, 'Receipt reads neither reapply facts nor create application records');

-- A later manager/system change advances the current fact snapshot without a
-- customer-correction event for that version. Provenance must name the current
-- case record and use the authoritative fact-update clock, never intake time.
update public.refund_cases
set card_network = 'discover'
where id = 'a4000000-0000-4000-8000-000000000001';

select is(public.service_get_refund_gmail_fact_application_v1(
  'a4000000-0000-4000-8000-000000000001', 'a6000000-0000-4000-8000-000000000001') ->> 'outcome',
  'stale', 'A previously applied reply cannot authorize reranking a newer fact version');

select set_config(
  'request.jwt.claims',
  '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);

select is(
  (
    select item #>> '{customerFactEvidence,source}'
    from jsonb_array_elements(
      public.admin_get_refund_operations_overview() -> 'cases'
    ) item
    where item ->> 'id' = 'a4000000-0000-4000-8000-000000000001'
  ),
  'current_case_record',
  'A later non-customer fact version is labeled as the current case record'
);

select is(
  (
    select (item #>> '{customerFactEvidence,factVersion}')::bigint
    from jsonb_array_elements(
      public.admin_get_refund_operations_overview() -> 'cases'
    ) item
    where item ->> 'id' = 'a4000000-0000-4000-8000-000000000001'
  ),
  (
    select deterministic_fact_version
    from public.refund_cases
    where id = 'a4000000-0000-4000-8000-000000000001'
  ),
  'Current-record provenance reports the exact later fact version'
);

select ok(
  (
    select
      (item #>> '{customerFactEvidence,appliedAt}')::timestamptz
        = refund_case.deterministic_facts_updated_at
      and (item #>> '{customerFactEvidence,appliedAt}')::timestamptz
        is distinct from refund_case.created_at
      and (item #>> '{customerFactEvidence,appliedAt}')::timestamptz
        is distinct from correction.created_at
    from jsonb_array_elements(
      public.admin_get_refund_operations_overview() -> 'cases'
    ) item
    join public.refund_cases refund_case
      on refund_case.id = (item ->> 'id')::uuid
    left join lateral (
      select event.created_at
      from public.refund_case_events event
      where event.refund_case_id = refund_case.id
        and event.event_type in (
          'gmail_customer_facts_applied',
          'wallet_correction_received'
        )
      order by event.created_at desc, event.id desc
      limit 1
    ) correction on true
    where refund_case.id = 'a4000000-0000-4000-8000-000000000001'
  ),
  'Current-record provenance uses the later deterministic fact-update timestamp, not intake or correction time'
);

select ok(
  pg_get_functiondef('public.admin_get_refund_operations_overview()'::regprocedure)
    like '%SET search_path TO ''''%'
  and pg_get_functiondef('public.service_apply_refund_gmail_customer_facts_v1(uuid,uuid,bigint,jsonb,text[],text)'::regprocedure)
    like '%SET search_path TO ''''%',
  'Both SECURITY DEFINER functions use an empty search path'
);

select ok(
  pg_get_functiondef('public.admin_get_refund_operations_overview_pre_ack_recovery_v1()'::regprocedure)
    like '%resulting_fact_version%'
  and pg_get_functiondef('public.admin_get_refund_operations_overview_pre_ack_recovery_v1()'::regprocedure)
    like '%refund_case.deterministic_fact_version%'
  and pg_get_functiondef('public.admin_get_refund_operations_overview_pre_ack_recovery_v1()'::regprocedure)
    like '%current_case_record%',
  'Manager provenance binds correction evidence to the exact current fact version'
);

select ok(
  pg_get_functiondef('public.service_apply_refund_gmail_customer_facts_v1(uuid,uuid,bigint,jsonb,text[],text)'::regprocedure)
    like '%for update%'
  and pg_get_functiondef('public.service_apply_refund_gmail_customer_facts_v1(uuid,uuid,bigint,jsonb,text[],text)'::regprocedure)
    like '%refund_authoritative_receipts%'
  and pg_get_functiondef('public.service_apply_refund_gmail_customer_facts_v1(uuid,uuid,bigint,jsonb,text[],text)'::regprocedure)
    like '%service_apply_refund_gmail_customer_facts_pre_receipt(%'
  and pg_get_functiondef('public.service_apply_refund_gmail_customer_facts_pre_receipt(uuid,uuid,bigint,jsonb,text[],text)'::regprocedure)
    like '%for update%'
  and pg_get_functiondef('public.service_apply_refund_gmail_customer_facts_pre_receipt(uuid,uuid,bigint,jsonb,text[],text)'::regprocedure)
    like '%refund_customer_fact_applications%'
  and pg_get_functiondef('public.service_apply_refund_gmail_customer_facts_pre_receipt(uuid,uuid,bigint,jsonb,text[],text)'::regprocedure)
    like '%gmail_customer_facts_applied%',
  'The receipt wrapper serializes state and delegates update, ledger, and event atomicity to the current private implementation'
);

select ok(
  pg_get_functiondef('public.admin_get_refund_operations_overview_pre_ack_recovery_v1()'::regprocedure)
    like '%customerFactEvidence%'
  and pg_get_functiondef('public.admin_get_refund_operations_overview_pre_ack_recovery_v1()'::regprocedure)
    like '%cardLast4Provenance%'
  and pg_get_functiondef('public.admin_get_refund_operations_overview_pre_ack_recovery_v1()'::regprocedure)
    not like '%source_message_id%',
  'The manager overview exposes redacted source/time/provenance without raw message IDs'
);

select ok(
  pg_get_functiondef('public.service_apply_refund_wallet_correction_v2(text,text,text,text,timestamp with time zone,text,boolean)'::regprocedure)
    not like '%service_apply_refund_wallet_correction(%',
  'The v2 correction performs one atomic case update instead of chaining two fact versions'
);

select * from finish();
rollback;
