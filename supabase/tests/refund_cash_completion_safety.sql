begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(13);

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
  '75000000-0000-4000-8000-000000000001',
  'authenticated',
  'authenticated',
  'cash-refund-manager@example.test',
  '',
  now(),
  '{}'::jsonb,
  '{}'::jsonb,
  now(),
  now()
);

insert into public.customer_accounts (id, name, account_type)
values ('75100000-0000-4000-8000-000000000001', 'Cash refund safety test', 'customer');

insert into public.reporting_locations (id, account_id, name, timezone)
values (
  '75200000-0000-4000-8000-000000000001',
  '75100000-0000-4000-8000-000000000001',
  'Cash refund test location',
  'America/Los_Angeles'
);

insert into public.reporting_machines (id, account_id, location_id, machine_label)
values (
  '75300000-0000-4000-8000-000000000001',
  '75100000-0000-4000-8000-000000000001',
  '75200000-0000-4000-8000-000000000001',
  'Cash refund test machine'
);

insert into public.reporting_machine_refund_managers (
  id,
  reporting_machine_id,
  manager_user_id,
  manager_email,
  grant_reason
)
values (
  '75400000-0000-4000-8000-000000000001',
  '75300000-0000-4000-8000-000000000001',
  '75000000-0000-4000-8000-000000000001',
  'cash-refund-manager@example.test',
  'Cash refund completion safety test'
);

insert into public.machine_sales_facts (
  id,
  reporting_machine_id,
  reporting_location_id,
  sale_date,
  payment_method,
  net_sales_cents,
  transaction_count,
  source,
  source_row_hash,
  raw_payload
)
values
  (
    '75500000-0000-4000-8000-000000000001',
    '75300000-0000-4000-8000-000000000001',
    '75200000-0000-4000-8000-000000000001',
    current_date,
    'cash',
    800,
    1,
    'sample_seed',
    'cash-refund-completion-safety-1',
    '{"fixture":"cash-refund-completion-safety"}'::jsonb
  ),
  (
    '75500000-0000-4000-8000-000000000002',
    '75300000-0000-4000-8000-000000000001',
    '75200000-0000-4000-8000-000000000001',
    current_date,
    'cash',
    900,
    1,
    'sample_seed',
    'cash-refund-completion-safety-2',
    '{"fixture":"cash-refund-completion-safety"}'::jsonb
  );

insert into public.refund_cases (
  id,
  public_reference,
  reporting_machine_id,
  reporting_location_id,
  customer_email,
  zelle_payment_contact,
  issue_summary,
  incident_at,
  payment_method,
  payment_amount_cents,
  status,
  correlation_status,
  correlation_source,
  correlation_confidence,
  matched_sales_fact_id,
  assigned_manager_id,
  decision,
  decision_reason,
  decided_by,
  decided_at,
  refund_amount_cents
)
values
  (
    '75600000-0000-4000-8000-000000000001',
    'RF-CASH-SAFETY-1',
    '75300000-0000-4000-8000-000000000001',
    '75200000-0000-4000-8000-000000000001',
    'cash-refund-one@example.test',
    'synthetic-zelle-contact',
    'Cash refund safety fixture one',
    now() - interval '1 hour',
    'cash',
    800,
    'cash_zelle_pending',
    'matched',
    'sunze',
    0.95,
    '75500000-0000-4000-8000-000000000001',
    '75000000-0000-4000-8000-000000000001',
    'approved',
    'Cash sale matched for safety test.',
    '75000000-0000-4000-8000-000000000001',
    now() - interval '30 minutes',
    800
  ),
  (
    '75600000-0000-4000-8000-000000000002',
    'RF-CASH-SAFETY-2',
    '75300000-0000-4000-8000-000000000001',
    '75200000-0000-4000-8000-000000000001',
    'cash-refund-two@example.test',
    'synthetic-zelle-contact',
    'Cash refund safety fixture two',
    now() - interval '1 hour',
    'cash',
    900,
    'cash_zelle_pending',
    'matched',
    'sunze',
    0.95,
    '75500000-0000-4000-8000-000000000002',
    '75000000-0000-4000-8000-000000000001',
    'approved',
    'Cash sale matched for safety test.',
    '75000000-0000-4000-8000-000000000001',
    now() - interval '30 minutes',
    900
  );

select ok(
  to_regprocedure(
    'public.service_complete_cash_refund_as_actor(uuid,uuid,integer,text,timestamp with time zone,text,text,text)'
  ) is not null,
  'The idempotent cash completion function exists'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.service_complete_cash_refund_as_actor(uuid,uuid,integer,text,timestamp with time zone,text,text,text)',
    'execute'
  ),
  'Authenticated browser clients cannot call cash completion directly'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.service_complete_cash_refund_as_actor(uuid,uuid,integer,text,timestamp with time zone,text,text,text)',
    'execute'
  ),
  'Only the service workflow can call cash completion'
);

select is(
  (
    public.service_complete_cash_refund_as_actor(
      '75000000-0000-4000-8000-000000000001',
      '75600000-0000-4000-8000-000000000001',
      800,
      'Zelle confirmation ZP-4821',
      now() - interval '5 minutes',
      'Cash sale matched for safety test.',
      null,
      'cash-refund-manager@example.test'
    ) ->> 'updateApplied'
  )::boolean,
  true,
  'The first valid cash completion is applied'
);

select is(
  (select status from public.refund_cases where id = '75600000-0000-4000-8000-000000000001'),
  'completed',
  'A valid cash completion closes the case'
);

select ok(
  (
    select
      actor_user_id = '75000000-0000-4000-8000-000000000001'
      and metadata ? 'payout_sent_at'
      and metadata ->> 'refund_amount_cents' = '800'
      and metadata ->> 'manual_reference_present' = 'true'
      and not (metadata ? 'manual_refund_reference')
      and message like '%cash-refund-manager@example.test%'
    from public.refund_case_events
    where refund_case_id = '75600000-0000-4000-8000-000000000001'
      and event_type = 'cash_payout_confirmed'
  ),
  'Cash history captures actor, sent time, and amount without the payment reference'
);

select is(
  (
    public.service_complete_cash_refund_as_actor(
      '75000000-0000-4000-8000-000000000001',
      '75600000-0000-4000-8000-000000000001',
      800,
      'Zelle confirmation ZP-4821',
      now() - interval '5 minutes',
      'Cash sale matched for safety test.',
      null,
      'cash-refund-manager@example.test'
    ) ->> 'updateApplied'
  )::boolean,
  false,
  'A repeated completion is treated as an idempotent no-op'
);

select is(
  (
    select count(*)::integer
    from public.refund_case_events
    where refund_case_id = '75600000-0000-4000-8000-000000000001'
      and event_type = 'cash_payout_confirmed'
  ),
  1,
  'A repeated completion creates no duplicate cash audit event'
);

select ok(
  pg_temp.capture_error($sql$
    select public.service_complete_cash_refund_as_actor(
      '75000000-0000-4000-8000-000000000001',
      '75600000-0000-4000-8000-000000000002',
      900,
      'Zelle confirmation ZP-4822',
      null,
      'Cash sale matched for safety test.',
      null,
      'cash-refund-manager@example.test'
    )
  $sql$) like '%Enter when the cash refund payment was sent%',
  'Cash completion rejects a missing payout time'
);

select ok(
  pg_temp.capture_error($sql$
    select public.service_complete_cash_refund_as_actor(
      '75000000-0000-4000-8000-000000000001',
      '75600000-0000-4000-8000-000000000002',
      901,
      'Zelle confirmation ZP-4822',
      now() - interval '5 minutes',
      'Cash sale matched for safety test.',
      null,
      'cash-refund-manager@example.test'
    )
  $sql$) like '%Cash refund amount cannot exceed the recorded customer payment%',
  'Cash completion rejects an over-refund'
);

select ok(
  pg_temp.capture_error($sql$
    select public.service_complete_cash_refund_as_actor(
      '75000000-0000-4000-8000-000000000001',
      '75600000-0000-4000-8000-000000000002',
      900,
      '123456789',
      now() - interval '5 minutes',
      'Cash sale matched for safety test.',
      null,
      'cash-refund-manager@example.test'
    )
  $sql$) like '%Do not enter bank, card, contact, or other sensitive payment details%',
  'Cash completion rejects a bare routing or account number'
);

select ok(
  pg_temp.capture_error($sql$
    select public.service_complete_cash_refund_as_actor(
      '75000000-0000-4000-8000-000000000001',
      '75600000-0000-4000-8000-000000000002',
      900,
      'card 4111 1111 1111 1111',
      now() - interval '5 minutes',
      'Cash sale matched for safety test.',
      null,
      'cash-refund-manager@example.test'
    )
  $sql$) like '%Do not enter bank, card, contact, or other sensitive payment details%',
  'Cash completion rejects sensitive card or bank details'
);

select is(
  (select status from public.refund_cases where id = '75600000-0000-4000-8000-000000000002'),
  'cash_zelle_pending',
  'Rejected cash completion attempts leave the case open'
);

select * from finish();
rollback;
