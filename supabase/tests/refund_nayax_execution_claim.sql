begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(12);

insert into auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
)
values (
  '00000000-0000-0000-0000-000000000000',
  '76000000-0000-4000-8000-000000000001',
  'authenticated',
  'authenticated',
  'nayax-claim-manager@example.test',
  '',
  now(),
  '{}'::jsonb,
  '{}'::jsonb,
  now(),
  now()
);

insert into public.customer_accounts (id, name, account_type)
values ('76100000-0000-4000-8000-000000000001', 'Nayax claim safety test', 'customer');

insert into public.reporting_locations (id, account_id, name, timezone)
values (
  '76200000-0000-4000-8000-000000000001',
  '76100000-0000-4000-8000-000000000001',
  'Nayax claim test location',
  'America/Los_Angeles'
);

insert into public.reporting_machines (
  id,
  account_id,
  location_id,
  machine_label,
  nayax_machine_id,
  nayax_account_key,
  nayax_refunds_enabled,
  nayax_refund_max_amount_cents
)
values (
  '76300000-0000-4000-8000-000000000001',
  '76100000-0000-4000-8000-000000000001',
  '76200000-0000-4000-8000-000000000001',
  'Nayax claim test machine',
  '9001',
  'TGPACI_USA_DB',
  true,
  1000
);

insert into public.reporting_machine_refund_managers (
  id,
  reporting_machine_id,
  manager_user_id,
  manager_email,
  grant_reason
)
values (
  '76400000-0000-4000-8000-000000000001',
  '76300000-0000-4000-8000-000000000001',
  '76000000-0000-4000-8000-000000000001',
  'nayax-claim-manager@example.test',
  'Nayax execution claim safety test'
);

insert into public.refund_cases (
  id,
  public_reference,
  reporting_machine_id,
  reporting_location_id,
  customer_email,
  issue_summary,
  incident_at,
  payment_method,
  payment_amount_cents,
  card_last4,
  status,
  correlation_status,
  correlation_source,
  matched_nayax_transaction_id,
  matched_nayax_site_id,
  matched_nayax_machine_auth_time,
  matched_nayax_amount_cents,
  matched_nayax_currency_code,
  nayax_recommendation_state,
  nayax_recommendation_policy_version,
  nayax_match_execution_eligible,
  assigned_manager_id,
  decision,
  decision_reason,
  decided_by,
  decided_at,
  refund_amount_cents
)
values
  (
    '76500000-0000-4000-8000-000000000001',
    'RF-NAYAX-CLAIM-1',
    '76300000-0000-4000-8000-000000000001',
    '76200000-0000-4000-8000-000000000001',
    'nayax-claim-one@example.test',
    'Synthetic Nayax execution claim fixture one',
    now() - interval '1 hour',
    'card',
    700,
    '4242',
    'card_refund_pending',
    'matched',
    'nayax',
    'nayax-claim-transaction-1',
    42,
    now() - interval '1 hour',
    700,
    'USD',
    'high_confidence',
    '2026-07-21.v1',
    true,
    '76000000-0000-4000-8000-000000000001',
    'approved',
    'Synthetic exact match.',
    '76000000-0000-4000-8000-000000000001',
    now() - interval '30 minutes',
    700
  ),
  (
    '76500000-0000-4000-8000-000000000002',
    'RF-NAYAX-CLAIM-2',
    '76300000-0000-4000-8000-000000000001',
    '76200000-0000-4000-8000-000000000001',
    'nayax-claim-two@example.test',
    'Synthetic Nayax execution claim fixture two',
    now() - interval '1 hour',
    'card',
    600,
    '4242',
    'card_refund_pending',
    'matched',
    'nayax',
    'nayax-claim-transaction-2',
    42,
    now() - interval '1 hour',
    600,
    'USD',
    'high_confidence',
    '2026-07-21.v1',
    true,
    '76000000-0000-4000-8000-000000000001',
    'approved',
    'Synthetic exact match.',
    '76000000-0000-4000-8000-000000000001',
    now() - interval '30 minutes',
    600
  );

select ok(
  to_regprocedure(
    'public.service_claim_nayax_refund_execution(uuid,uuid,text,integer,integer,text,text)'
  ) is not null,
  'The atomic Nayax execution claim function exists'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.service_claim_nayax_refund_execution(uuid,uuid,text,integer,integer,text,text)',
    'execute'
  ),
  'Authenticated browser clients cannot claim a provider refund'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.service_claim_nayax_refund_execution(uuid,uuid,text,integer,integer,text,text)',
    'execute'
  ),
  'The service role can claim a provider refund'
);

select is(
  (
    public.service_claim_nayax_refund_execution(
      '76000000-0000-4000-8000-000000000001',
      '76500000-0000-4000-8000-000000000001',
      'nayax-refund-execute-' || repeat('a', 64),
      2000,
      2,
      repeat('b', 64),
      'nayax-qa-confirmed-v1'
    ) ->> 'claimed'
  )::boolean,
  true,
  'The first eligible execution obtains the provider claim'
);

select is(
  (
    public.service_claim_nayax_refund_execution(
      '76000000-0000-4000-8000-000000000001',
      '76500000-0000-4000-8000-000000000001',
      'nayax-refund-execute-' || repeat('a', 64),
      2000,
      2,
      repeat('b', 64),
      'nayax-qa-confirmed-v1'
    ) ->> 'claimed'
  )::boolean,
  false,
  'A repeated idempotency key does not obtain a second provider claim'
);

select is(
  (
    select count(*)::integer
    from public.refund_case_nayax_refund_attempts
    where refund_case_id = '76500000-0000-4000-8000-000000000001'
      and execution_mode = 'request_and_approve'
  ),
  1,
  'A repeated claim creates exactly one provider attempt row'
);

select ok(
  (
    select
      status = 'in_progress'
      and amount_cents = 700
      and sanitized_request ->> 'payload_redacted' = 'true'
      and sanitized_request ->> 'provider_contract_version' = 'nayax-qa-confirmed-v1'
      and not (sanitized_request ? 'transaction_id')
      and not (sanitized_request ? 'site_id')
      and sanitized_response = '{}'::jsonb
    from public.refund_case_nayax_refund_attempts
    where refund_case_id = '76500000-0000-4000-8000-000000000001'
  ),
  'The claim stores only redacted request evidence'
);

select throws_ok(
  $$
    update public.refund_cases
    set refund_amount_cents = 699
    where id = '76500000-0000-4000-8000-000000000001'
  $$,
  '23514',
  'Claimed Nayax refund evidence cannot be changed',
  'Provider transaction and amount evidence is immutable after a claim'
);

select lives_ok(
  $$
    update public.refund_cases
    set nayax_refund_execution_status = 'ambiguous'
    where id = '76500000-0000-4000-8000-000000000001'
  $$,
  'Execution status can still be recorded after the evidence is frozen'
);

update public.refund_case_nayax_refund_attempts
set status = 'ambiguous', error_code = 'provider_outcome_unconfirmed'
where refund_case_id = '76500000-0000-4000-8000-000000000001';

select is(
  (
    public.service_claim_nayax_refund_execution(
      '76000000-0000-4000-8000-000000000001',
      '76500000-0000-4000-8000-000000000002',
      'nayax-refund-execute-' || repeat('c', 64),
      2000,
      1,
      repeat('d', 64),
      'nayax-qa-confirmed-v1'
    ) ->> 'errorCode'
  ),
  'daily_count_cap_exceeded',
  'An ambiguous provider attempt still consumes the daily count cap'
);

select is(
  (
    public.service_claim_nayax_refund_execution(
      '76000000-0000-4000-8000-000000000001',
      '76500000-0000-4000-8000-000000000002',
      'nayax-refund-execute-' || repeat('c', 64),
      1200,
      2,
      repeat('d', 64),
      'nayax-qa-confirmed-v1'
    ) ->> 'errorCode'
  ),
  'daily_amount_cap_exceeded',
  'An ambiguous provider attempt still consumes the daily amount cap'
);

select is(
  (
    select count(*)::integer
    from public.refund_case_nayax_refund_attempts
    where refund_case_id = '76500000-0000-4000-8000-000000000002'
  ),
  0,
  'A cap rejection creates no provider attempt'
);

select * from finish();
rollback;
