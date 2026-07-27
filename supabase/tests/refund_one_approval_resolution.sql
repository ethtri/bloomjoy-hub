begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(24);

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
  '78000000-0000-4000-8000-000000000001',
  'authenticated',
  'authenticated',
  'one-approval-manager@example.test',
  '',
  now(),
  '{}'::jsonb,
  '{}'::jsonb,
  now(),
  now()
);

insert into public.customer_accounts (id, name, account_type)
values ('78100000-0000-4000-8000-000000000001', 'One approval resolution test', 'customer');

insert into public.reporting_locations (id, account_id, name, timezone)
values (
  '78200000-0000-4000-8000-000000000001',
  '78100000-0000-4000-8000-000000000001',
  'One approval test location',
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
  '78300000-0000-4000-8000-000000000001',
  '78100000-0000-4000-8000-000000000001',
  '78200000-0000-4000-8000-000000000001',
  'One approval test machine',
  '9901',
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
  '78400000-0000-4000-8000-000000000001',
  '78300000-0000-4000-8000-000000000001',
  '78000000-0000-4000-8000-000000000001',
  'one-approval-manager@example.test',
  'One approval resolution test'
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
  card_wallet_used,
  status,
  assigned_manager_id
)
values
  (
    '78500000-0000-4000-8000-000000000001',
    'RF-ONE-APPROVAL-1',
    '78300000-0000-4000-8000-000000000001',
    '78200000-0000-4000-8000-000000000001',
    'one-approval-customer@example.test',
    'Synthetic high-confidence wallet refund',
    now() - interval '20 minutes',
    'card',
    700,
    '1111',
    true,
    'needs_review',
    '78000000-0000-4000-8000-000000000001'
  ),
  (
    '78500000-0000-4000-8000-000000000002',
    'RF-ONE-APPROVAL-2',
    '78300000-0000-4000-8000-000000000001',
    '78200000-0000-4000-8000-000000000001',
    'ambiguous-customer@example.test',
    'Synthetic ambiguous refund',
    now() - interval '20 minutes',
    'card',
    800,
    '2222',
    false,
    'needs_review',
    '78000000-0000-4000-8000-000000000001'
  );

insert into public.refund_nayax_lookup_candidates (
  token,
  refund_case_id,
  actor_user_id,
  provider_transaction_id,
  site_id,
  machine_authorization_time,
  amount_cents,
  card_last4,
  currency_code,
  evidence_summary,
  expires_at
)
values
  (
    '78600000-0000-4000-8000-000000000001',
    '78500000-0000-4000-8000-000000000001',
    '78000000-0000-4000-8000-000000000001',
    'nayax-one-approval-transaction-1',
    42,
    now() - interval '19 minutes',
    700,
    '9999',
    'USD',
    jsonb_build_object(
      'selection_allowed', true,
      'is_recommended', true,
      'recommendation_state', 'high_confidence',
      'one_click_eligible', true,
      'confidence_class', 'unique_qr_time',
      'policy_version', '2026-07-27.v3'
    ),
    now() + interval '30 minutes'
  ),
  (
    '78600000-0000-4000-8000-000000000002',
    '78500000-0000-4000-8000-000000000002',
    '78000000-0000-4000-8000-000000000001',
    'nayax-one-approval-transaction-2',
    42,
    now() - interval '18 minutes',
    800,
    '2222',
    'USD',
    jsonb_build_object(
      'selection_allowed', true,
      'is_recommended', false,
      'recommendation_state', 'ambiguous',
      'one_click_eligible', false,
      'confidence_class', 'ambiguous_manual',
      'policy_version', '2026-07-27.v3'
    ),
    now() + interval '30 minutes'
  );

select has_table(
  'public',
  'refund_case_resolution_notifications',
  'Confirmed refunds have a durable resolution notification outbox'
);

select ok(
  to_regprocedure('public.service_approve_nayax_refund_as_actor(uuid,uuid,uuid,text)') is not null
  and to_regprocedure('public.service_finalize_nayax_refund_execution(uuid,uuid,uuid,text,jsonb)') is not null
  and to_regprocedure('public.service_claim_refund_resolution_notifications(uuid,integer)') is not null
  and to_regprocedure('public.service_finish_refund_resolution_notification(uuid,text,text,text)') is not null,
  'The one-approval and notification service functions exist'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.service_approve_nayax_refund_as_actor(uuid,uuid,uuid,text)',
    'execute'
  ),
  'Authenticated browser clients cannot call the approval mutation directly'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.service_finalize_nayax_refund_execution(uuid,uuid,uuid,text,jsonb)',
    'execute'
  ),
  'Authenticated browser clients cannot finalize a provider refund'
);

select ok(
  not has_table_privilege(
    'authenticated',
    'public.refund_case_resolution_notifications',
    'select'
  ),
  'Authenticated browser clients cannot read confirmation recipients or delivery state'
);

select is(
  (
    public.service_approve_nayax_refund_as_actor(
      '78000000-0000-4000-8000-000000000001',
      '78500000-0000-4000-8000-000000000001',
      '78600000-0000-4000-8000-000000000001',
      '2026-07-27.v3'
    ) ->> 'approved'
  )::boolean,
  true,
  'One manager decision accepts a high-confidence unique QR and wallet recommendation'
);

select is(
  (
    select status || ':' || decision || ':' || nayax_refund_execution_status
    from public.refund_cases
    where id = '78500000-0000-4000-8000-000000000001'
  ),
  'card_refund_pending:approved:ready',
  'Approval moves the case directly into guarded provider readiness'
);

select is(
  (
    select
      matched_nayax_card_last4 || ':' ||
      nayax_recommendation_policy_version || ':' ||
      nayax_match_execution_eligible::text
    from public.refund_cases
    where id = '78500000-0000-4000-8000-000000000001'
  ),
  '9999:2026-07-27.v3:true',
  'Approval saves the verified wallet last four and exact recommendation policy'
);

select is(
  (
    select count(*)::integer
    from public.refund_case_events
    where refund_case_id = '78500000-0000-4000-8000-000000000001'
      and event_type = 'nayax_refund_approved'
  ),
  1,
  'The business approval is audited once'
);

select ok(
  public.can_prepare_nayax_refund_execution(
    '78000000-0000-4000-8000-000000000001',
    '78500000-0000-4000-8000-000000000001'
  ),
  'The approved wallet case passes the same server-side execution predicate'
);

select ok(
  pg_temp.capture_error($sql$
    select public.service_approve_nayax_refund_as_actor(
      '78000000-0000-4000-8000-000000000001',
      '78500000-0000-4000-8000-000000000002',
      '78600000-0000-4000-8000-000000000002',
      '2026-07-27.v3'
    )
  $sql$) is not null,
  'An ambiguous candidate cannot be promoted by the manager approval endpoint'
);

update public.refund_nayax_lookup_candidates
set evidence_summary = jsonb_build_object(
  'confidence_class', 'strong_card',
  'policy_version', '2026-07-27.v3'
)
where token = '78600000-0000-4000-8000-000000000002';

select ok(
  pg_temp.capture_error($sql$
    select public.service_approve_nayax_refund_as_actor(
      '78000000-0000-4000-8000-000000000001',
      '78500000-0000-4000-8000-000000000002',
      '78600000-0000-4000-8000-000000000002',
      '2026-07-27.v3'
    )
  $sql$) is not null,
  'Missing recommendation flags fail closed instead of becoming an approval'
);

select set_config(
  'refund_test.one_approval_claim',
  public.service_claim_nayax_refund_execution(
    '78000000-0000-4000-8000-000000000001',
    '78500000-0000-4000-8000-000000000001',
    'nayax-refund-execute-' || repeat('a', 64),
    5000,
    10,
    repeat('b', 64),
    'nayax-account-contract-v1',
    jsonb_build_object(
      'reportingMachineId', '78300000-0000-4000-8000-000000000001',
      'transactionId', 'nayax-one-approval-transaction-1',
      'siteId', 42,
      'machineAuthorizationTime', (
        select matched_nayax_machine_auth_time
        from public.refund_cases
        where id = '78500000-0000-4000-8000-000000000001'
      ),
      'amountCents', 700,
      'currencyCode', 'USD',
      'nayaxAccountKey', 'TGPACI_USA_DB',
      'nayaxMachineId', '9901'
    )
  )::text,
  true
);

select is(
  (current_setting('refund_test.one_approval_claim')::jsonb ->> 'claimed')::boolean,
  true,
  'The approved case obtains exactly one provider execution claim'
);

update public.refund_case_nayax_refund_attempts
set status = 'approved'
where id = (current_setting('refund_test.one_approval_claim')::jsonb ->> 'attemptId')::uuid;

select ok(
  pg_temp.capture_error($sql$
    select public.service_finalize_nayax_refund_execution(
      '78000000-0000-4000-8000-000000000001',
      '78500000-0000-4000-8000-000000000001',
      (current_setting('refund_test.one_approval_claim')::jsonb ->> 'attemptId')::uuid,
      'Approved',
      '{"stage":"approve","outcome":"succeeded"}'::jsonb
    )
  $sql$) is not null,
  'Provider success finalization rejects a response that is not explicitly redacted'
);

select is(
  (
    public.service_finalize_nayax_refund_execution(
      '78000000-0000-4000-8000-000000000001',
      '78500000-0000-4000-8000-000000000001',
      (current_setting('refund_test.one_approval_claim')::jsonb ->> 'attemptId')::uuid,
      'Approved',
      '{"stage":"approve","outcome":"succeeded","payload_redacted":true}'::jsonb
    ) ->> 'completed'
  )::boolean,
  true,
  'A confirmed provider success atomically finalizes the approved refund'
);

select is(
  (
    select status || ':' || nayax_refund_execution_status || ':' || automation_state
    from public.refund_cases
    where id = '78500000-0000-4000-8000-000000000001'
  ),
  'completed:succeeded:completed',
  'Finalization completes the case and records confirmed execution'
);

select is(
  (
    select count(*)::integer
    from public.sales_adjustment_facts
    where refund_case_id = '78500000-0000-4000-8000-000000000001'
  ),
  1,
  'Finalization writes the reporting adjustment exactly once'
);

select is(
  (
    select count(*)::integer
    from public.refund_case_resolution_notifications
    where refund_case_id = '78500000-0000-4000-8000-000000000001'
  ),
  2,
  'Finalization queues one customer and one approving-manager confirmation'
);

select lives_ok(
  $sql$
    select public.service_finalize_nayax_refund_execution(
      '78000000-0000-4000-8000-000000000001',
      '78500000-0000-4000-8000-000000000001',
      (current_setting('refund_test.one_approval_claim')::jsonb ->> 'attemptId')::uuid,
      'Approved',
      '{"stage":"approve","outcome":"succeeded","payload_redacted":true}'::jsonb
    )
  $sql$,
  'A repeated success callback is idempotent'
);

select is(
  (
    select count(*)::integer
    from public.sales_adjustment_facts
    where refund_case_id = '78500000-0000-4000-8000-000000000001'
  ) || ':' ||
  (
    select count(*)::integer
    from public.refund_case_resolution_notifications
    where refund_case_id = '78500000-0000-4000-8000-000000000001'
  ),
  '1:2',
  'A repeated success callback does not duplicate reporting or confirmations'
);

select is(
  jsonb_array_length(
    public.service_claim_refund_resolution_notifications(
      '78500000-0000-4000-8000-000000000001',
      2
    )
  ),
  2,
  'The worker claims both due confirmations once'
);

select is(
  jsonb_array_length(
    public.service_claim_refund_resolution_notifications(
      '78500000-0000-4000-8000-000000000001',
      2
    )
  ),
  0,
  'Already-claimed confirmations are not claimed again'
);

select lives_ok(
  $sql$
    select public.service_finish_refund_resolution_notification(
      notification.id,
      'sent',
      null,
      'resend-message-123456'
    )
    from public.refund_case_resolution_notifications notification
    where notification.refund_case_id = '78500000-0000-4000-8000-000000000001'
  $sql$,
  'Both claimed confirmations can be marked sent'
);

select is(
  (
    select count(*)::integer
    from public.refund_case_resolution_notifications
    where refund_case_id = '78500000-0000-4000-8000-000000000001'
      and status = 'sent'
      and attempt_count = 1
  ),
  2,
  'The two confirmations finish once with one delivery attempt each'
);

select * from finish();
rollback;
