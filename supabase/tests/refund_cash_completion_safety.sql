begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(21);

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
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values (
  '00000000-0000-0000-0000-000000000000',
  '75000000-0000-4000-8000-000000000001',
  'authenticated', 'authenticated', 'cash-refund-manager@example.test', '', now(),
  '{}'::jsonb, '{}'::jsonb, now(), now()
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
  id, reporting_machine_id, manager_user_id, manager_email, grant_reason
)
values (
  '75400000-0000-4000-8000-000000000001',
  '75300000-0000-4000-8000-000000000001',
  '75000000-0000-4000-8000-000000000001',
  'cash-refund-manager@example.test',
  'Cash refund completion safety test'
);

insert into public.machine_sales_facts (
  id, reporting_machine_id, reporting_location_id, sale_date, payment_method,
  net_sales_cents, transaction_count, source, source_row_hash, raw_payload
)
values (
  '75500000-0000-4000-8000-000000000001',
  '75300000-0000-4000-8000-000000000001',
  '75200000-0000-4000-8000-000000000001',
  current_date, 'cash', 700, 1, 'sample_seed',
  'cash-refund-completion-safety-legacy-match',
  '{"fixture":"cash-refund-completion-safety"}'::jsonb
);

insert into public.refund_cases (
  id, public_reference, reporting_machine_id, reporting_location_id,
  customer_email, zelle_payment_contact, issue_summary, incident_at,
  payment_method, payment_amount_cents, status, correlation_status,
  correlation_source, correlation_confidence, matched_sales_fact_id,
  assigned_manager_id, decision, decision_reason, decided_by, decided_at,
  refund_amount_cents, manual_refund_reference
)
values
  (
    '75600000-0000-4000-8000-000000000001', 'RF-CASH-NO-MATCH',
    '75300000-0000-4000-8000-000000000001', '75200000-0000-4000-8000-000000000001',
    'cash-no-match@example.test', 'legacy-historical-contact', 'Unmatched cash fixture',
    now() - interval '1 hour', 'cash', 800, 'needs_review', 'no_match', null, 0, null,
    '75000000-0000-4000-8000-000000000001', null, null, null, null, null,
    'Legacy historical reference'
  ),
  (
    '75600000-0000-4000-8000-000000000002', 'RF-CASH-SUBMITTED',
    '75300000-0000-4000-8000-000000000001', '75200000-0000-4000-8000-000000000001',
    'cash-submitted@example.test', 'legacy-submitted-contact', 'Submitted cash fixture',
    now() - interval '1 hour', 'cash', 900, 'submitted', 'not_started', null, 0, null,
    '75000000-0000-4000-8000-000000000001', null, null, null, null, null, null
  ),
  (
    '75600000-0000-4000-8000-000000000003', 'RF-CASH-LEGACY-PENDING',
    '75300000-0000-4000-8000-000000000001', '75200000-0000-4000-8000-000000000001',
    'cash-legacy@example.test', 'legacy@example.test', 'Legacy pending cash fixture',
    now() - interval '1 hour', 'cash', 700, 'cash_zelle_pending', 'matched', 'sunze', 0.95,
    '75500000-0000-4000-8000-000000000001',
    '75000000-0000-4000-8000-000000000001', 'approved', 'Legacy approval.',
    '75000000-0000-4000-8000-000000000001', now() - interval '30 minutes', 700,
    'Legacy payout reference'
  ),
  (
    '75600000-0000-4000-8000-000000000004', 'RF-CASH-DENIED',
    '75300000-0000-4000-8000-000000000001', '75200000-0000-4000-8000-000000000001',
    'cash-denied@example.test', 'legacy-denied-contact', 'Denied cash fixture',
    now() - interval '1 hour', 'cash', 600, 'denied', 'no_match', null, 0, null,
    '75000000-0000-4000-8000-000000000001', 'denied', 'Denied fixture.',
    '75000000-0000-4000-8000-000000000001', now() - interval '30 minutes', null, null
  ),
  (
    '75600000-0000-4000-8000-000000000005', 'RF-CASH-MISSING-AMOUNT',
    '75300000-0000-4000-8000-000000000001', '75200000-0000-4000-8000-000000000001',
    'cash-missing@example.test', 'legacy-missing-contact', 'Missing amount cash fixture',
    now() - interval '1 hour', 'cash', null, 'needs_review', 'no_match', null, 0, null,
    '75000000-0000-4000-8000-000000000001', null, null, null, null, null, null
  ),
  (
    '75600000-0000-4000-8000-000000000006', 'RF-CARD-WRONG-PATH',
    '75300000-0000-4000-8000-000000000001', '75200000-0000-4000-8000-000000000001',
    'card-wrong-path@example.test', null, 'Card fixture',
    now() - interval '1 hour', 'card', 500, 'needs_review', 'no_match', null, 0, null,
    '75000000-0000-4000-8000-000000000001', null, null, null, null, null, null
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
  not has_function_privilege(
    'service_role',
    'public.service_complete_cash_refund_as_actor(uuid,uuid,integer,text,timestamp with time zone,text,text,text)',
    'execute'
  )
  and has_function_privilege(
    'service_role',
    'public.service_complete_cash_refund_official(uuid,uuid,integer,text,timestamp with time zone,text,text,text)',
    'execute'
  ),
  'Only the receipt-consuming service workflow can call the internal completion'
);

select is(
  pg_temp.capture_error($sql$
    select public.assert_refund_official_action_payload_shape(
      'cash_complete', 'completed', 'approved', null, null, null,
      800, null, null, true, null, null
    )
  $sql$),
  null,
  'Cash authorization accepts only the server-derived amount and manager confirmation'
);

select ok(
  pg_temp.capture_error($sql$
    select public.assert_refund_official_action_payload_shape(
      'cash_complete', 'completed', 'approved', null, null, null,
      800, null, null, false, null, null
    )
  $sql$) like '%server-derived amount and manager confirmation%',
  'Cash authorization still requires the explicit manager confirmation'
);

select is(
  (
    public.service_complete_cash_refund_as_actor(
      '75000000-0000-4000-8000-000000000001',
      '75600000-0000-4000-8000-000000000001',
      1,
      'card 4111 1111 1111 1111',
      now() - interval '1 year',
      null,
      'Synthetic note without customer data.',
      'ignored@example.test'
    ) ->> 'updateApplied'
  )::boolean,
  true,
  'An authorized manager can complete an unmatched active cash case in one action'
);

select ok(
  (
    select status = 'completed'
      and decision = 'approved'
      and refund_amount_cents = 800
      and refund_completed_by = '75000000-0000-4000-8000-000000000001'
      and refund_completed_at between statement_timestamp() - interval '1 minute' and statement_timestamp()
    from public.refund_cases
    where id = '75600000-0000-4000-8000-000000000001'
  ),
  'Completion derives the amount, actor, and confirmation time from trusted server state'
);

select is(
  (
    select correlation_status || ':' || coalesce(matched_sales_fact_id::text, 'none')
    from public.refund_cases
    where id = '75600000-0000-4000-8000-000000000001'
  ),
  'no_match:none',
  'Cash completion does not fabricate transaction correlation'
);

select ok(
  (
    select count(*) = 1
      and max(amount_cents) = 800
      and bool_and(raw_payload ->> 'completion_method' = 'manual_external')
      and bool_and(raw_payload ->> 'payload_redacted' = 'true')
      and bool_and(not (raw_payload ? 'zelle_payment_contact'))
      and bool_and(not (raw_payload ? 'manual_refund_reference'))
    from public.sales_adjustment_facts
    where refund_case_id = '75600000-0000-4000-8000-000000000001'
  ),
  'Completion writes exactly one channel-neutral, redacted reporting adjustment'
);

select ok(
  (
    select count(*) = 1
      and bool_and(actor_user_id = '75000000-0000-4000-8000-000000000001')
      and bool_and(action = 'refund_case.manual_external_completed')
      and bool_and(meta ->> 'completion_method' = 'manual_external')
      and bool_and(meta ->> 'audit_payload_redacted' = 'true')
      and bool_and((before::text || after::text || meta::text) not like '%4111%')
      and bool_and((before::text || after::text || meta::text) not like '%ignored@example.test%')
    from public.admin_audit_log
    where entity_id = '75600000-0000-4000-8000-000000000001'
      and action = 'refund_case.manual_external_completed'
  ),
  'Completion writes one redacted actor audit without client payment details'
);

select is(
  (select manual_refund_reference from public.refund_cases where id = '75600000-0000-4000-8000-000000000001'),
  'Legacy historical reference',
  'Existing historical manual references remain readable without entering new ones'
);

select is(
  (
    public.service_complete_cash_refund_as_actor(
      '75000000-0000-4000-8000-000000000001',
      '75600000-0000-4000-8000-000000000001',
      999999,
      'different client value',
      now() + interval '1 year',
      null, null, null
    ) ->> 'updateApplied'
  )::boolean,
  false,
  'A repeated completion returns the durable existing completion'
);

select is(
  (select count(*)::integer from public.sales_adjustment_facts where refund_case_id = '75600000-0000-4000-8000-000000000001'),
  1,
  'A replay creates no duplicate reporting adjustment'
);

select is(
  (
    select count(*)::integer
    from public.admin_audit_log
    where entity_id = '75600000-0000-4000-8000-000000000001'
      and action = 'refund_case.manual_external_completed'
  ),
  1,
  'A replay creates no duplicate audit record'
);

select is(
  (
    public.service_complete_cash_refund_as_actor(
      '75000000-0000-4000-8000-000000000001',
      '75600000-0000-4000-8000-000000000002',
      null, null, null, null, null, null
    ) ->> 'updateApplied'
  )::boolean,
  true,
  'A submitted uncorrelated cash case remains compatible with one-action completion'
);

select is(
  (
    public.service_complete_cash_refund_as_actor(
      '75000000-0000-4000-8000-000000000001',
      '75600000-0000-4000-8000-000000000003',
      null, null, null, null, null, null
    ) ->> 'updateApplied'
  )::boolean,
  true,
  'A legacy cash_zelle_pending case remains compatible with one-action completion'
);

select ok(
  pg_temp.capture_error($sql$
    select public.service_complete_cash_refund_as_actor(
      '75000000-0000-4000-8000-000000000001',
      '75600000-0000-4000-8000-000000000004',
      null, null, null, null, null, null
    )
  $sql$) like '%already closed%',
  'A denied cash case remains terminal'
);

select ok(
  pg_temp.capture_error($sql$
    select public.service_complete_cash_refund_as_actor(
      '75000000-0000-4000-8000-000000000001',
      '75600000-0000-4000-8000-000000000005',
      1000, null, null, null, null, null
    )
  $sql$) like '%Confirm the customer payment amount%',
  'A cash case with no recorded amount stays open for customer follow-up'
);

select is(
  (select status from public.refund_cases where id = '75600000-0000-4000-8000-000000000005'),
  'needs_review',
  'A rejected missing-amount completion leaves the case open'
);

select ok(
  pg_temp.capture_error($sql$
    select public.service_complete_cash_refund_as_actor(
      '75000000-0000-4000-8000-000000000001',
      '75600000-0000-4000-8000-000000000006',
      500, null, null, null, null, null
    )
  $sql$) like '%only available for cash refund cases%',
  'The external cash boundary cannot complete a card case'
);

select ok(
  not exists (
    select 1
    from public.refund_case_events
    where refund_case_id in (
      '75600000-0000-4000-8000-000000000001',
      '75600000-0000-4000-8000-000000000002',
      '75600000-0000-4000-8000-000000000003'
    )
      and event_type in ('cash_payout_confirmed', 'nayax_match_selected')
  ),
  'The internal mutation creates no legacy payout or Nayax event outside the receipt wrapper'
);

select * from finish();
rollback;
