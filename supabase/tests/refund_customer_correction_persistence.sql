begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(16);

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

select ok(
  pg_get_functiondef('public.admin_get_refund_operations_overview()'::regprocedure)
    like '%customerFactEvidence%'
  and pg_get_functiondef('public.admin_get_refund_operations_overview()'::regprocedure)
    like '%cardLast4Provenance%'
  and pg_get_functiondef('public.admin_get_refund_operations_overview()'::regprocedure)
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
