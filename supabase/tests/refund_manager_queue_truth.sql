begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(19);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  'd0000000-0000-4000-8000-000000000001',
  'authenticated', 'authenticated', 'queue-truth-manager@example.invalid', '',
  now(), '{}'::jsonb, '{}'::jsonb, now(), now()
);

insert into public.customer_accounts (id, name, account_type)
values (
  'd1000000-0000-4000-8000-000000000001',
  'Refund manager queue truth test',
  'customer'
);

insert into public.reporting_locations (id, account_id, name, timezone)
values (
  'd2000000-0000-4000-8000-000000000001',
  'd1000000-0000-4000-8000-000000000001',
  'Queue truth location',
  'America/Los_Angeles'
);

insert into public.reporting_machines (
  id, account_id, location_id, machine_label
) values (
  'd3000000-0000-4000-8000-000000000001',
  'd1000000-0000-4000-8000-000000000001',
  'd2000000-0000-4000-8000-000000000001',
  'Queue truth machine'
);

insert into public.reporting_machine_refund_managers (
  id, reporting_machine_id, manager_user_id, manager_email, grant_reason
) values (
  'd3500000-0000-4000-8000-000000000001',
  'd3000000-0000-4000-8000-000000000001',
  'd0000000-0000-4000-8000-000000000001',
  'queue-truth-manager@example.invalid',
  'Queue truth authorization fixture'
);

insert into public.refund_cases (
  id, public_reference, reporting_machine_id, reporting_location_id,
  customer_email, issue_summary, incident_at, payment_method,
  payment_amount_cents, refund_amount_cents, card_last4, status,
  correlation_status, correlation_source, automation_state,
  nayax_lookup_status, nayax_lookup_started_at,
  nayax_lookup_safe_retry_eligible
) values
  (
    'd4000000-0000-4000-8000-000000000001', 'RF-QUEUE-WAIT',
    'd3000000-0000-4000-8000-000000000001',
    'd2000000-0000-4000-8000-000000000001',
    'queue-wait@example.invalid', 'Waiting for one purchase detail',
    statement_timestamp() - interval '30 minutes', 'card', 700, 700,
    null, 'waiting_on_customer', 'needs_nayax', 'nayax', 'more_info_needed',
    'checking', statement_timestamp() - interval '30 seconds', false
  ),
  (
    'd4000000-0000-4000-8000-000000000002', 'RF-QUEUE-STALE',
    'd3000000-0000-4000-8000-000000000001',
    'd2000000-0000-4000-8000-000000000001',
    'queue-stale@example.invalid', 'Interrupted read-only lookup',
    statement_timestamp() - interval '30 minutes', 'card', 700, 700,
    '4242', 'needs_review', 'needs_nayax', 'nayax', 'under_review',
    'checking', statement_timestamp() - interval '2 minutes', false
  ),
  (
    'd4000000-0000-4000-8000-000000000003', 'RF-QUEUE-CASH',
    'd3000000-0000-4000-8000-000000000001',
    'd2000000-0000-4000-8000-000000000001',
    'queue-cash@example.invalid', 'Cash reimbursement ready',
    statement_timestamp() - interval '30 minutes', 'cash', 800, 800,
    null, 'needs_review', 'no_match', 'manual', 'under_review',
    'not_started', null, false
  );

insert into public.refund_case_messages (
  refund_case_id, message_type, status, recipient_email, subject, body,
  template_key, content_source, delivery_kind, reason_code,
  requested_fields, sent_at
) values (
  'd4000000-0000-4000-8000-000000000001', 'more_info', 'sent',
  'queue-wait@example.invalid', 'Purchase details needed',
  'Please reply with the purchase time and physical-card last four.',
  'refund_more_info_editable_v1', 'manager_authored', 'manual',
  'missing_information', array['incident_time', 'card_last4'],
  statement_timestamp()
);

select is(
  public.refund_lifecycle_contract(
    'd4000000-0000-4000-8000-000000000001'
  ) ->> 'stage',
  'waiting_on_customer',
  'Waiting on customer is an explicit canonical lifecycle stage'
);
select is(
  public.refund_lifecycle_contract(
    'd4000000-0000-4000-8000-000000000001'
  ) #>> '{managerQueue,bucket}',
  'waiting_on_customer',
  'Waiting lifecycle and manager queue use the same bucket'
);
select is(
  public.refund_lifecycle_contract(
    'd4000000-0000-4000-8000-000000000001'
  ) ->> 'managerNextAction',
  'wait_for_customer_reply',
  'Waiting directs the existing customer reply instead of a transaction check'
);
select is(
  public.refund_lifecycle_contract(
    'd4000000-0000-4000-8000-000000000002'
  ) #>> '{lookup,status}',
  'lookup_timed_out',
  'A stale checking projection reaches a bounded timeout state'
);
select is(
  (public.refund_lifecycle_contract(
    'd4000000-0000-4000-8000-000000000002'
  ) #>> '{lookup,safeRetryEligible}')::boolean,
  true,
  'A stale read-only lookup exposes an explicitly safe retry'
);
select is(
  public.refund_lifecycle_contract(
    'd4000000-0000-4000-8000-000000000002'
  ) #>> '{managerQueue,nextAction}',
  'retry_read_only_lookup',
  'The stale lookup queue action is read-only retry, never payment retry'
);
select is(
  public.refund_lifecycle_contract(
    'd4000000-0000-4000-8000-000000000003'
  ) #>> '{managerQueue,bucket}',
  'ready_to_pay',
  'A cash case with an amount is canonically ready to mark refunded'
);
select is(
  public.service_get_refund_lifecycle(
    'd4000000-0000-4000-8000-000000000001'
  ) ->> 'stage',
  'waiting_on_customer',
  'The service lifecycle reader was rebound to the repaired contract'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.refund_lifecycle_contract_pre_manager_queue_truth_v1(uuid)',
    'execute'
  ),
  'The superseded lifecycle implementation is not browser-callable'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"d0000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
select is(
  public.get_refund_lifecycle_for_manager(
    'd4000000-0000-4000-8000-000000000001'
  ) ->> 'stage',
  'waiting_on_customer',
  'The scoped manager reader was rebound to the repaired contract'
);
select is(
  (
    select item #>> '{lifecycle,managerQueue,bucket}'
    from jsonb_array_elements(
      public.admin_get_refund_operations_overview() -> 'cases'
    ) item
    where item ->> 'id' = 'd4000000-0000-4000-8000-000000000003'
  ),
  'ready_to_pay',
  'The manager overview emits the same ready bucket consumed by counts and rows'
);

reset role;

-- Exercise the actor-scoped overview projection with contradictory legacy
-- readiness fields. These fixtures deliberately look refundable until the
-- official-action authority/version gates are applied by the canonical queue.
insert into public.refund_cases (
  id, public_reference, reporting_machine_id, reporting_location_id,
  customer_email, issue_summary, incident_at, payment_method,
  payment_amount_cents, refund_amount_cents, card_last4, status,
  correlation_status, correlation_source, automation_state,
  nayax_lookup_status, nayax_lookup_started_at,
  nayax_lookup_safe_retry_eligible
) values
  (
    'd4000000-0000-4000-8000-000000000010', 'RF-QUEUE-AUTHORITY',
    'd3000000-0000-4000-8000-000000000001',
    'd2000000-0000-4000-8000-000000000001',
    'queue-authority@example.invalid', 'Authority-blocked detail fixture',
    statement_timestamp() - interval '30 minutes', 'card', 700, 700,
    '4242', 'needs_review', 'matched', 'nayax', 'under_review',
    'match_found', statement_timestamp() - interval '5 minutes', false
  ),
  (
    'd4000000-0000-4000-8000-000000000011', 'RF-QUEUE-VERSION',
    'd3000000-0000-4000-8000-000000000001',
    'd2000000-0000-4000-8000-000000000001',
    'queue-version@example.invalid', 'Version-blocked detail fixture',
    statement_timestamp() - interval '30 minutes', 'card', 700, 700,
    '4242', 'needs_review', 'matched', 'nayax', 'under_review',
    'match_found', statement_timestamp() - interval '5 minutes', false
  );

create or replace function public.refund_lifecycle_contract(
  p_refund_case_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'schemaVersion', 'refund_lifecycle_v1',
    'stage', 'transaction_confirmed',
    'stageRank', 30,
    'evidenceState', 'transaction_confirmed',
    'lastUpdatedAt', statement_timestamp(),
    'publicCopyKey', 'refund_transaction_confirmed',
    'managerNextAction', 'refund',
    'terminal', false,
    'refreshAfterSeconds', 5,
    'lookup', jsonb_build_object(
      'status', 'match_found',
      'safeRetryEligible', false,
      'failureClass', null,
      'lastUpdatedAt', statement_timestamp()
    ),
    'operations', jsonb_build_object(
      'required', false,
      'queue', 'Refund Operations',
      'owner', 'Refund Operations',
      'slaMinutes', 60,
      'ageMinutes', null,
      'dueAt', null,
      'slaBreached', false,
      'safeStage', 'not_needed',
      'failureClass', null,
      'nextStep', null
    ),
    'payloadRedacted', true
  )
$$;

create or replace function
  public.admin_get_refund_operations_overview_pre_manager_queue_truth_v1()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'cases', jsonb_build_array(
      jsonb_build_object(
        'id', 'd4000000-0000-4000-8000-000000000010',
        'publicReference', 'RF-QUEUE-AUTHORITY',
        'paymentMethod', 'card',
        'status', 'needs_review',
        'reconciliationActionBlocked', false,
        'canPerformOfficialAction', false,
        'officialActionBlockReason', 'manager_mapping_required',
        'officialActionVersion', 1,
        'refundReadiness', jsonb_build_object(
          'transactionConfirmed', true,
          'canIssueCardRefund', true,
          'blockReason', null
        )
      ),
      jsonb_build_object(
        'id', 'd4000000-0000-4000-8000-000000000011',
        'publicReference', 'RF-QUEUE-VERSION',
        'paymentMethod', 'card',
        'status', 'needs_review',
        'reconciliationActionBlocked', false,
        'canPerformOfficialAction', true,
        'officialActionBlockReason', null,
        'officialActionVersion', 0,
        'refundReadiness', jsonb_build_object(
          'transactionConfirmed', true,
          'canIssueCardRefund', true,
          'blockReason', null
        )
      )
    )
  )
$$;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"d0000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);

select is(
  public.admin_get_refund_operations_overview()
    #>> '{cases,0,lifecycle,managerQueue,bucket}',
  'needs_action',
  'Missing manager authority cannot enter the ready queue'
);
select is(
  public.admin_get_refund_operations_overview()
    #>> '{cases,0,lifecycle,managerQueue,label}',
  'Action needed',
  'Missing manager authority uses the action-needed badge'
);
select is(
  public.admin_get_refund_operations_overview()
    #>> '{cases,0,lifecycle,managerQueue,nextAction}',
  'resolve_manager_access',
  'Missing manager authority exposes a non-payment next action'
);
select is(
  public.admin_get_refund_operations_overview()
    #>> '{cases,1,lifecycle,managerQueue,bucket}',
  'needs_action',
  'Missing official-action version cannot enter the ready queue'
);
select is(
  public.admin_get_refund_operations_overview()
    #>> '{cases,1,lifecycle,managerQueue,label}',
  'Action needed',
  'Missing official-action version uses the action-needed badge'
);
select is(
  public.admin_get_refund_operations_overview()
    #>> '{cases,1,lifecycle,managerQueue,nextAction}',
  'refresh_case',
  'Missing official-action version exposes a refresh action, never refund'
);

select is(
  public.get_refund_lifecycle_for_manager(
    'd4000000-0000-4000-8000-000000000010'
  ),
  public.admin_get_refund_operations_overview()
    #> '{cases,0,lifecycle}',
  'Authority-blocked detail reader exactly agrees with the actor-scoped overview projection'
);
select is(
  public.get_refund_lifecycle_for_manager(
    'd4000000-0000-4000-8000-000000000011'
  ),
  public.admin_get_refund_operations_overview()
    #> '{cases,1,lifecycle}',
  'Version-blocked detail reader exactly agrees with the actor-scoped overview projection'
);

select * from finish();
rollback;
