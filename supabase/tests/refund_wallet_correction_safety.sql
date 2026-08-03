begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(19);

create function pg_temp.capture_error(statement text)
returns text
language plpgsql
as $$
begin
  execute statement;
  return null;
exception
  when others then
    return sqlstate || ':' || sqlerrm;
end;
$$;

insert into public.customer_accounts (id, name, account_type)
values (
  '91000000-0000-4000-8000-000000000001',
  'Wallet correction safety test',
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
  '92000000-0000-4000-8000-000000000001',
  '91000000-0000-4000-8000-000000000001',
  'Wallet correction test location',
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
  '93000000-0000-4000-8000-000000000001',
  '91000000-0000-4000-8000-000000000001',
  '92000000-0000-4000-8000-000000000001',
  'Private provider machine label',
  'commercial',
  'active',
  true,
  'Cotton Candy 01'
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
  card_wallet_used,
  status,
  correlation_status,
  correlation_source
)
values (
  '94000000-0000-4000-8000-000000000001',
  '93000000-0000-4000-8000-000000000001',
  '92000000-0000-4000-8000-000000000001',
  'wallet-customer@example.test',
  'Wallet Customer',
  'Wallet correction safety fixture',
  statement_timestamp() - interval '2 hours',
  to_char(statement_timestamp() - interval '2 hours', 'YYYY-MM-DD"T"HH24:MI'),
  'America/Los_Angeles',
  'exact',
  'card',
  700,
  700,
  '1111',
  true,
  'needs_review',
  'no_match',
  'nayax'
);

select has_table(
  'public',
  'refund_wallet_correction_contexts',
  'Wallet correction links have a dedicated server-only table'
);

select has_column(
  'public',
  'refund_cases',
  'wallet_correction_state',
  'Refund cases expose bounded wallet correction workflow state'
);

select ok(
  (
    select relrowsecurity
    from pg_class
    where oid = 'public.refund_wallet_correction_contexts'::regclass
  ),
  'Wallet correction contexts enforce row-level security'
);

select ok(
  not has_table_privilege(
    'anon',
    'public.refund_wallet_correction_contexts',
    'select'
  )
  and not has_table_privilege(
    'authenticated',
    'public.refund_wallet_correction_contexts',
    'select'
  ),
  'Browser roles cannot read wallet correction contexts'
);

select ok(
  has_table_privilege(
    'service_role',
    'public.refund_wallet_correction_contexts',
    'select'
  )
  and has_table_privilege(
    'service_role',
    'public.refund_wallet_correction_contexts',
    'insert'
  )
  and has_table_privilege(
    'service_role',
    'public.refund_wallet_correction_contexts',
    'update'
  ),
  'The server role has only the wallet context privileges used by the flow'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.service_get_refund_wallet_correction(text)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'public.service_apply_refund_wallet_correction(text,text,text,timestamp with time zone,text,boolean)',
    'execute'
  ),
  'Browser roles cannot call wallet correction service RPCs directly'
);

select is(
  public.record_public_intake_rate_limit_event(
    'refund_wallet_correction',
    'ip',
    repeat('9', 64),
    3600
  ),
  1,
  'Wallet correction attempts use a dedicated public rate-limit scope'
);

select throws_like(
  $sql$
    select public.service_issue_refund_wallet_correction(
      '94000000-0000-4000-8000-000000000001',
      repeat('a', 64),
      statement_timestamp() + interval '48 hours'
    )
  $sql$,
  '%Automatic customer contact is disabled%',
  'The database kill switch blocks wallet-link issuance by default'
);

update public.refund_customer_contact_settings
set automatic_customer_contact_enabled = true
where singleton;

select lives_ok(
  $sql$
    select public.service_issue_refund_wallet_correction(
      '94000000-0000-4000-8000-000000000001',
      repeat('a', 64),
      statement_timestamp() + interval '48 hours'
    )
  $sql$,
  'The service can issue the first short-lived wallet correction link'
);

select is(
  (
    public.service_get_refund_wallet_correction(repeat('a', 64))
      ->> 'state'
  ),
  'ready',
  'An unexpired unused correction link returns sanitized ready state'
);

select ok(
  not (
    public.service_get_refund_wallet_correction(repeat('a', 64))
      ? 'customerEmail'
  )
  and not (
    public.service_get_refund_wallet_correction(repeat('a', 64))
      ? 'cardLast4'
  )
  and not (
    public.service_get_refund_wallet_correction(repeat('a', 64))
      ? 'refundCaseId'
  ),
  'Correction inspection omits customer PII, card digits, and internal case IDs'
);

select is(
  (
    public.service_get_refund_wallet_correction(repeat('a', 64))
      ->> 'machineLabel'
  ),
  'Cotton Candy 01',
  'Correction inspection uses the approved public machine label'
);

select lives_ok(
  $sql$
    select public.service_apply_refund_wallet_correction(
      repeat('a', 64),
      'apple_pay',
      '4242',
      statement_timestamp() - interval '1 hour',
      to_char(statement_timestamp() - interval '1 hour', 'YYYY-MM-DD"T"HH24:MI'),
      true
    )
  $sql$,
  'A valid link atomically applies the requested wallet correction'
);

select is(
  (
    select status
    from public.refund_wallet_correction_contexts
    where token_hash = repeat('a', 64)
  ),
  'submitted',
  'Applying a correction consumes the link'
);

select ok(
  (
    select
      card_last4 = '4242'
      and card_wallet_used is true
      and wallet_correction_state = 'received'
      and automation_state = 'wallet_correction_received'
      and correlation_status = 'needs_nayax'
    from public.refund_cases
    where id = '94000000-0000-4000-8000-000000000001'
  ),
  'Correction saves only the wallet matching inputs and schedules automatic re-match'
);

select ok(
  (
    select
      reporting_machine_id = '93000000-0000-4000-8000-000000000001'
      and reporting_location_id = '92000000-0000-4000-8000-000000000001'
      and refund_qr_claim_context_id is null
    from public.refund_cases
    where id = '94000000-0000-4000-8000-000000000001'
  ),
  'Customer correction cannot change the locked machine, location, or QR context'
);

select ok(
  pg_temp.capture_error($sql$
    select public.service_apply_refund_wallet_correction(
      repeat('a', 64),
      'apple_pay',
      '9999',
      statement_timestamp() - interval '30 minutes',
      to_char(statement_timestamp() - interval '30 minutes', 'YYYY-MM-DD"T"HH24:MI'),
      true
    )
  $sql$) is not null,
  'A consumed wallet correction link cannot be replayed'
);

select ok(
  (
    select
      metadata ->> 'payload_redacted' = 'true'
      and metadata ->> 'machine_context_changed' = 'false'
      and metadata ->> 'qr_context_changed' = 'false'
      and metadata::text not like '%4242%'
      and metadata::text not like '%' || repeat('a', 64) || '%'
    from public.refund_case_events
    where refund_case_id = '94000000-0000-4000-8000-000000000001'
      and event_type = 'wallet_correction_received'
    order by created_at desc
    limit 1
  ),
  'Wallet correction audit metadata is redacted and records locked context'
);

select ok(
  (
    select
      count(*) = 1
      and bool_and(token_hash ~ '^[a-f0-9]{64}$')
    from public.refund_wallet_correction_contexts
  )
  and not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'refund_wallet_correction_contexts'
      and column_name in ('token', 'raw_token', 'card_number', 'cvv')
  ),
  'The database stores only correction token hashes and no forbidden payment fields'
);

select * from finish();
rollback;
