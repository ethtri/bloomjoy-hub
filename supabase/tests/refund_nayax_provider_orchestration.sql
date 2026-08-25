begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(61);

create function pg_temp.capture_error(statement text)
returns text
language plpgsql
as $$
begin
  execute statement;
  return null;
exception when others then
  return sqlstate || ':' || sqlerrm;
end;
$$;

-- Reproduces the class of bypass a separate SECURITY DEFINER wrapper could
-- otherwise create by setting transaction-local settlement context before a
-- raw case update. The production trigger must require both the exact attempt
-- and the raw one-time provider claim, never the imitable attempt ID alone.
create function pg_temp.try_raw_nayax_case_mutation(
  p_case_id uuid,
  p_attempt_id uuid,
  p_provider_claim_token text,
  p_complete boolean
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  perform set_config(
    'bloomjoy.nayax_settlement_attempt_id',
    p_attempt_id::text,
    true
  );
  perform set_config(
    'bloomjoy.nayax_settlement_provider_claim',
    coalesce(p_provider_claim_token, ''),
    true
  );

  if p_complete then
    update public.refund_cases
    set
      status = 'completed',
      decision = 'approved',
      manual_refund_reference = 'UNSAFE-RAW-NAYAX-SETTLEMENT',
      refund_completed_at = statement_timestamp(),
      nayax_refund_execution_status = 'approved'
    where id = p_case_id;
  else
    update public.refund_cases
    set manual_refund_reference = 'UNSAFE-RAW-NAYAX-MUTATION'
    where id = p_case_id;
  end if;
end;
$$;

create temporary table nayax_provider_results (
  result_key text primary key,
  result jsonb not null
);
grant all on table pg_temp.nayax_provider_results to service_role;

create function pg_temp.seed_nayax_authorization(
  p_case_id uuid,
  p_intent_id uuid,
  p_authorization_id uuid,
  p_consumed_intent boolean default true
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  case_row public.refund_cases%rowtype;
  machine_row public.reporting_machines%rowtype;
  mapping_row public.reporting_machine_refund_managers%rowtype;
  evidence_hash text;
  context_hash text;
  factor_time timestamptz := statement_timestamp() - interval '20 seconds'
    + make_interval(secs => get_byte(uuid_send(p_intent_id), 15));
begin
  select * into case_row from public.refund_cases where id = p_case_id;
  select * into machine_row from public.reporting_machines where id = case_row.reporting_machine_id;
  select * into mapping_row
  from public.reporting_machine_refund_managers
  where reporting_machine_id = case_row.reporting_machine_id
    and status = 'active' and revoked_at is null
  order by id limit 1;

  evidence_hash := public.refund_nayax_execution_evidence_hash(case_row, machine_row);
  context_hash := public.refund_official_action_context_hash(
    'nayax_execute', 'card_refund_pending', 'approved',
    null, null, null, case_row.refund_amount_cents, null,
    null, false, null, null, null
  );

  insert into public.refund_manager_action_step_up_intents (
    id, actor_user_id, refund_case_id, action, target_function,
    manager_mapping_id, manager_mapping_version,
    manager_totp_enrollment_version, expected_case_version,
    action_context_hash, nayax_execution_evidence_hash,
    status, not_before, expires_at, factor_verified_at,
    verified_totp_at, consumed_at
  ) values (
    p_intent_id, mapping_row.manager_user_id, p_case_id,
    'nayax_execute', 'nayax-card-refund', mapping_row.id,
    mapping_row.mapping_version, 1, case_row.official_action_version,
    context_hash, evidence_hash,
    case when p_consumed_intent then 'consumed' else 'pending' end,
    statement_timestamp() - interval '30 seconds',
    statement_timestamp() + interval '60 seconds',
    case when p_consumed_intent then factor_time else null end,
    case when p_consumed_intent then factor_time else null end,
    case when p_consumed_intent then factor_time else null end
  );

  insert into public.refund_case_official_action_authorizations (
    id, refund_case_id, action, actor_user_id, manager_mapping_id,
    manager_mapping_version, expected_case_version, action_context_hash,
    status, expires_at, step_up_intent_id, verified_totp_at,
    nayax_execution_evidence_hash
  ) values (
    p_authorization_id, p_case_id, 'nayax_execute', mapping_row.manager_user_id,
    mapping_row.id, mapping_row.mapping_version, case_row.official_action_version,
    context_hash, 'authorized', statement_timestamp() + interval '5 minutes',
    p_intent_id, factor_time, evidence_hash
  );
end;
$$;

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
(
  '00000000-0000-0000-0000-000000000000',
  '9a000000-0000-4000-8000-000000000001',
  'authenticated', 'authenticated', 'provider-manager@example.test', '', now(),
  '{}'::jsonb, '{}'::jsonb, now(), now()
),
(
  '00000000-0000-0000-0000-000000000000',
  '9a000000-0000-4000-8000-000000000002',
  'authenticated', 'authenticated', 'provider-manager-two@example.test', '', now(),
  '{}'::jsonb, '{}'::jsonb, now(), now()
);

insert into public.customer_accounts (id, name, account_type)
values ('9a100000-0000-4000-8000-000000000001', 'Provider orchestration safety', 'customer');

insert into public.reporting_locations (id, account_id, name, timezone)
values (
  '9a200000-0000-4000-8000-000000000001',
  '9a100000-0000-4000-8000-000000000001',
  'Provider test location', 'America/Los_Angeles'
);

insert into public.reporting_machines (
  id, account_id, location_id, machine_label, nayax_machine_id,
  nayax_account_key, nayax_refunds_enabled, nayax_refund_max_amount_cents
) values
(
  '9a300000-0000-4000-8000-000000000001',
  '9a100000-0000-4000-8000-000000000001',
  '9a200000-0000-4000-8000-000000000001',
  'Provider test machine', 'PROVIDER-MACHINE', 'PROVIDER-ACCOUNT', true, 2500
);

insert into public.reporting_machine_refund_managers (
  id, reporting_machine_id, manager_user_id, manager_email, grant_reason
) values (
  '9a400000-0000-4000-8000-000000000001',
  '9a300000-0000-4000-8000-000000000001',
  '9a000000-0000-4000-8000-000000000001',
  'provider-manager@example.test', 'Provider orchestration safety'
),
(
  '9a400000-0000-4000-8000-000000000002',
  '9a300000-0000-4000-8000-000000000001',
  '9a000000-0000-4000-8000-000000000002',
  'provider-manager-two@example.test', 'Provider orchestration safety'
);

insert into public.refund_cases (
  id, public_reference, reporting_machine_id, reporting_location_id,
  customer_email, issue_summary, incident_at, payment_method,
  payment_amount_cents, refund_amount_cents, status, decision,
  decided_by, decided_at, card_last4, card_wallet_used,
  correlation_status, correlation_source, correlation_confidence,
  matched_nayax_transaction_id, matched_nayax_site_id,
  matched_nayax_machine_auth_time, matched_nayax_amount_cents,
  matched_nayax_card_last4, matched_nayax_currency_code,
  nayax_recommendation_state, nayax_recommendation_policy_version,
  nayax_recommendation_evaluated_at, nayax_match_execution_eligible
)
select
  ('9a600000-0000-4000-8000-' || lpad(series::text, 12, '0'))::uuid,
  'RF-PROVIDER-' || series,
  '9a300000-0000-4000-8000-000000000001'::uuid,
  '9a200000-0000-4000-8000-000000000001'::uuid,
  'provider-customer-' || series || '@example.test',
  'Synthetic provider outcome ' || series,
  statement_timestamp() - make_interval(days => series),
  'card', 700, 700, 'card_refund_pending', 'approved',
  '9a000000-0000-4000-8000-000000000001'::uuid,
  statement_timestamp() - interval '20 minutes',
  '4242', false, 'matched', 'nayax', 1,
  'PROVIDER-TX-' || lpad(series::text, 3, '0'),
  900 + series,
  statement_timestamp() - make_interval(days => series),
  700, '4242', 'USD', 'high_confidence',
  'provider-test-v1', statement_timestamp(), true
from generate_series(1, 6) series;

select pg_temp.seed_nayax_authorization(
  ('9a600000-0000-4000-8000-' || lpad(series::text, 12, '0'))::uuid,
  ('9a700000-0000-4000-8000-' || lpad(series::text, 12, '0'))::uuid,
  ('9a800000-0000-4000-8000-' || lpad(series::text, 12, '0'))::uuid,
  series <> 6
)
from generate_series(1, 6) series;

insert into public.refund_gmail_threads (
  id, refund_case_id, mailbox_hash, provider_thread_id, thread_subject,
  first_message_at, latest_message_at, retention_expires_at
) values
  ('9aa00000-0000-4000-8000-000000000001', '9a600000-0000-4000-8000-000000000001',
   repeat('b', 64), 'provider-original-thread', 'Original customer thread',
   statement_timestamp() - interval '2 days', statement_timestamp() - interval '2 days',
   statement_timestamp() + interval '180 days'),
  ('9aa00000-0000-4000-8000-000000000002', '9a600000-0000-4000-8000-000000000001',
   repeat('b', 64), 'provider-newer-thread', 'Newer customer thread',
   statement_timestamp() - interval '1 day', statement_timestamp() - interval '1 day',
   statement_timestamp() + interval '180 days');

insert into public.refund_nayax_provider_callers (
  caller_id, assertion_digest
) values (
  'nayax-card-refund',
  encode(extensions.digest(convert_to('provider-test-executor', 'UTF8'), 'sha256'), 'hex')
);

select ok(
  not has_table_privilege('service_role', 'public.refund_case_nayax_refund_attempts', 'select')
  and not has_table_privilege('service_role', 'public.refund_case_nayax_refund_attempts', 'insert')
  and not has_table_privilege('service_role', 'public.refund_nayax_provider_callers', 'select')
  and not has_table_privilege('authenticated', 'public.refund_case_nayax_refund_attempts', 'select'),
  'Attempts and executor assertions are private from browsers and services'
);
select ok(
  not has_function_privilege('service_role',
    'public.service_reserve_and_consume_nayax_refund_attempt(text,uuid,uuid,text,integer,text)', 'execute')
  and has_function_privilege('service_role',
    'public.service_reserve_and_consume_nayax_refund_attempt_v2(text,uuid,uuid,text,integer,integer,integer,text)', 'execute')
  and has_function_privilege('service_role',
    'public.service_settle_nayax_refund_attempt(text,uuid,uuid,uuid,text,integer,text,text,text,text,text,text)', 'execute')
  and not has_function_privilege('authenticated',
    'public.service_reserve_and_consume_nayax_refund_attempt_v2(text,uuid,uuid,text,integer,integer,integer,text)', 'execute'),
  'Only service role can enter the capped assertion-protected orchestration RPCs'
);
select ok(
  not has_function_privilege(
    'service_role',
    'public.service_consume_nayax_refund_official_action(uuid,uuid,text,text,integer,uuid)',
    'execute'
  ),
  'Service workloads cannot call the legacy assertion-free authorization consumer'
);
select ok(
  not exists (
    select 1 from public.refund_nayax_provider_callers
    where caller_id <> 'nayax-card-refund'
  ),
  'No Gmail, GPT, or scheduler provider executor identity exists'
);

-- PostgreSQL 15 can terminate the backend when a revoked SECURITY DEFINER
-- function is invoked through dynamic SQL under SET ROLE. Prove the same
-- boundary from the privilege catalog without executing the forbidden call.
select ok(
  not has_function_privilege(
    'service_role',
    'public.service_consume_nayax_refund_official_action(uuid,uuid,text,text,integer,uuid)',
    'execute'
  ),
  'Direct legacy consumption is denied before it can burn manager evidence'
);
select is((select status from public.refund_case_official_action_authorizations
  where id = '9a800000-0000-4000-8000-000000000001'), 'authorized',
  'Denied legacy consumption leaves the fresh manager authorization usable');

select ok(pg_temp.capture_error($sql$
  update public.refund_cases
  set status = 'completed', refund_completed_at = statement_timestamp()
  where id = '9a600000-0000-4000-8000-000000000001'
$sql$) like '%token-bound confirmed provider settlement%',
  'An ordinary card case update cannot complete before token-bound provider settlement');

select ok(
  pg_temp.capture_error($sql$
    insert into public.refund_case_messages (
      refund_case_id, message_type, status, recipient_email, subject, body,
      template_key, content_source, delivery_kind, template_version, requested_fields
    ) values (
      '9a600000-0000-4000-8000-000000000001', 'approved', 'pending',
      'provider-customer-1@example.test', 'Approved', 'Approved',
      'unsafe-card-approved', 'deterministic_template', 'manual', 'unsafe-v1', '{}'::text[]
    )
  $sql$) like '%committed token-bound provider settlement%'
  and pg_temp.capture_error($sql$
    insert into public.refund_case_messages (
      refund_case_id, message_type, status, recipient_email, subject, body,
      template_key, content_source, delivery_kind, template_version, requested_fields
    ) values (
      '9a600000-0000-4000-8000-000000000001', 'completed', 'pending',
      'provider-customer-1@example.test', 'Complete', 'Complete',
      'unsafe-card-complete', 'deterministic_template', 'manual', 'unsafe-v1', '{}'::text[]
    )
  $sql$) like '%committed token-bound provider settlement%',
  'Card approved/completed success messages cannot bypass confirmed provider settlement'
);

set local role service_role;
select ok(pg_temp.capture_error($sql$
  select public.service_reserve_and_consume_nayax_refund_attempt_v2(
    null, '9a800000-0000-4000-8000-000000000001',
    '9a600000-0000-4000-8000-000000000001',
    'nayax-refund-' || repeat('1',64), 700, 100000, 100, 'USD')
$sql$) like '%executor identity required%',
  'Missing function-scoped executor assertion cannot obtain a provider claim');
reset role;
select is((select status from public.refund_case_official_action_authorizations
  where id = '9a800000-0000-4000-8000-000000000001'), 'authorized',
  'Missing executor assertion does not consume manager authority');

set local role service_role;
select ok(pg_temp.capture_error($sql$
  select public.service_reserve_and_consume_nayax_refund_attempt_v2(
    'gmail-gpt-scheduler', '9a800000-0000-4000-8000-000000000001',
    '9a600000-0000-4000-8000-000000000001',
    'nayax-refund-' || repeat('1',64), 700, 100000, 100, 'USD')
$sql$) like '%executor identity required%',
  'Gmail, GPT, or scheduler-shaped assertion cannot obtain a provider claim');
select ok(pg_temp.capture_error($sql$
  select public.service_reserve_and_consume_nayax_refund_attempt_v2(
    'provider-test-executor', '9a800000-0000-4000-8000-000000000006',
    '9a600000-0000-4000-8000-000000000006',
    'nayax-refund-' || repeat('6',64), 700, 100000, 100, 'USD')
$sql$) like '%exact-factor%',
  'A non-consumed step-up intent cannot reserve a provider attempt');
reset role;
select is((select status from public.refund_case_official_action_authorizations
  where id = '9a800000-0000-4000-8000-000000000006'), 'authorized',
  'Rejected step-up evidence leaves its authorization unused');

set local role service_role;
insert into pg_temp.nayax_provider_results (result_key, result)
select 'success-reserve', public.service_reserve_and_consume_nayax_refund_attempt_v2(
  'provider-test-executor', '9a800000-0000-4000-8000-000000000001',
  '9a600000-0000-4000-8000-000000000001',
  'nayax-refund-' || repeat('1',64), 700, 100000, 100, 'USD');
reset role;
select ok(
  (select (result #>> '{attempt,shouldExecute}')::boolean
     and length(result ->> 'providerClaimToken') = 64
   from pg_temp.nayax_provider_results where result_key = 'success-reserve'),
  'Fresh atomic reserve returns one high-entropy attempt-scoped claim to the executor'
);
select ok(
  (select provider_claim_digest ~ '^[a-f0-9]{64}$'
      and provider_claim_digest <> (select result ->> 'providerClaimToken'
        from pg_temp.nayax_provider_results where result_key = 'success-reserve')
   from public.refund_case_nayax_refund_attempts
   where refund_case_id = '9a600000-0000-4000-8000-000000000001'),
  'Only the provider claim digest is persisted'
);
select is((select status from public.refund_case_official_action_authorizations
  where id = '9a800000-0000-4000-8000-000000000001'), 'consumed',
  'Attempt reservation and manager authorization consumption commit together');
set local role service_role;
select ok(pg_temp.capture_error($sql$
  select public.service_reserve_and_consume_nayax_refund_attempt_v2(
    'provider-test-executor', '9a800000-0000-4000-8000-000000000002',
    '9a600000-0000-4000-8000-000000000002',
    'nayax-refund-' || repeat('2',64), 700, 0, 0, 'USD')
$sql$) like '%Valid bounded Nayax daily caps are required%',
  'Missing or unbounded daily caps fail before receipt consumption');
select ok(pg_temp.capture_error($sql$
  select public.service_reserve_and_consume_nayax_refund_attempt_v2(
    'provider-test-executor', '9a800000-0000-4000-8000-000000000002',
    '9a600000-0000-4000-8000-000000000002',
    'nayax-refund-' || repeat('2',64), 700, 100000, 1, 'USD')
$sql$) like '%daily refund count cap exceeded%',
  'The UTC-day count cap blocks a new provider attempt');
select ok(pg_temp.capture_error($sql$
  select public.service_reserve_and_consume_nayax_refund_attempt_v2(
    'provider-test-executor', '9a800000-0000-4000-8000-000000000002',
    '9a600000-0000-4000-8000-000000000002',
    'nayax-refund-' || repeat('2',64), 700, 700, 100, 'USD')
$sql$) like '%daily refund amount cap exceeded%',
  'The UTC-day amount cap blocks a new provider attempt');
reset role;
select ok(
  (select status = 'authorized' and consumed_at is null
   from public.refund_case_official_action_authorizations
   where id = '9a800000-0000-4000-8000-000000000002')
  and not exists (
    select 1 from public.refund_case_nayax_refund_attempts
    where refund_case_id = '9a600000-0000-4000-8000-000000000002'
  ),
  'Cap rejection preserves the manager receipt and creates no partial attempt');
select ok(
  (select count(*) = 1 and bool_and(status = 'in_progress')
   from public.refund_case_nayax_refund_attempts
   where refund_case_id = '9a600000-0000-4000-8000-000000000001')
  and (select nayax_refund_execution_status = 'requested'
       and not nayax_match_execution_eligible
       from public.refund_cases where id = '9a600000-0000-4000-8000-000000000001'),
  'Reservation creates one durable in-flight hold and closes execution eligibility'
);

set local role service_role;
select ok(
  pg_temp.capture_error(format(
    'select pg_temp.try_raw_nayax_case_mutation(%L,%L,null,true)',
    '9a600000-0000-4000-8000-000000000001',
    (select result #>> '{attempt,attemptId}'
     from pg_temp.nayax_provider_results where result_key = 'success-reserve')
  )) like '%token-bound confirmed provider settlement%',
  'Attempt ID alone cannot authorize a raw card completion through a SECURITY DEFINER wrapper'
);
select ok(
  pg_temp.capture_error(format(
    'select pg_temp.try_raw_nayax_case_mutation(%L,%L,null,false)',
    '9a600000-0000-4000-8000-000000000001',
    (select result #>> '{attempt,attemptId}'
     from pg_temp.nayax_provider_results where result_key = 'success-reserve')
  )) like '%must settle before another official mutation%',
  'Attempt ID alone cannot authorize another raw official mutation through a SECURITY DEFINER wrapper'
);
reset role;
select ok(
  (select status = 'card_refund_pending'
      and manual_refund_reference is null
      and refund_completed_at is null
      and reporting_adjustment_id is null
   from public.refund_cases where id = '9a600000-0000-4000-8000-000000000001')
  and (select status = 'in_progress'
      and provider_outcome is null
      and provider_claim_consumed_at is null
   from public.refund_case_nayax_refund_attempts
   where refund_case_id = '9a600000-0000-4000-8000-000000000001')
  and not exists (
    select 1 from public.sales_adjustment_facts
    where refund_case_id = '9a600000-0000-4000-8000-000000000001'
  ),
  'ID-only trigger bypass attempts leave case, provider attempt, and reporting state unchanged'
);

set local role service_role;
select ok(
  pg_temp.capture_error(format(
    'select pg_temp.try_raw_nayax_case_mutation(%L,%L,%L,true)',
    '9a600000-0000-4000-8000-000000000001',
    (select result #>> '{attempt,attemptId}'
     from pg_temp.nayax_provider_results where result_key = 'success-reserve'),
    repeat('f', 64)
  )) like '%token-bound confirmed provider settlement%',
  'A wrong raw provider claim cannot authorize card completion through a SECURITY DEFINER wrapper'
);
select ok(
  pg_temp.capture_error(format(
    'select pg_temp.try_raw_nayax_case_mutation(%L,%L,%L,false)',
    '9a600000-0000-4000-8000-000000000001',
    (select result #>> '{attempt,attemptId}'
     from pg_temp.nayax_provider_results where result_key = 'success-reserve'),
    repeat('f', 64)
  )) like '%must settle before another official mutation%',
  'A wrong raw provider claim cannot authorize another official mutation through a SECURITY DEFINER wrapper'
);
reset role;
select ok(
  (select status = 'card_refund_pending'
      and manual_refund_reference is null
      and refund_completed_at is null
      and reporting_adjustment_id is null
   from public.refund_cases where id = '9a600000-0000-4000-8000-000000000001')
  and (select status = 'in_progress'
      and provider_outcome is null
      and provider_claim_consumed_at is null
   from public.refund_case_nayax_refund_attempts
   where refund_case_id = '9a600000-0000-4000-8000-000000000001')
  and not exists (
    select 1 from public.sales_adjustment_facts
    where refund_case_id = '9a600000-0000-4000-8000-000000000001'
  ),
  'Wrong-token trigger bypass attempts leave case, provider attempt, and reporting state unchanged'
);

set local role service_role;
insert into pg_temp.nayax_provider_results (result_key, result)
select 'success-reserve-replay', public.service_reserve_and_consume_nayax_refund_attempt_v2(
  'provider-test-executor', '9a800000-0000-4000-8000-000000000001',
  '9a600000-0000-4000-8000-000000000001',
  'nayax-refund-' || repeat('1',64), 700, 100000, 100, 'USD');
reset role;
select ok(
  (select not (result #>> '{attempt,shouldExecute}')::boolean
      and result #>> '{attempt,providerOutcome}' = 'unknown'
      and (result #>> '{attempt,reconciliationRequired}')::boolean
      and result -> 'providerClaimToken' = 'null'::jsonb
   from pg_temp.nayax_provider_results where result_key = 'success-reserve-replay'),
  'An in-flight replay returns an unknown reconciliation hold with no provider claim'
);
select is((select count(*)::integer from public.refund_case_nayax_refund_attempts
  where refund_case_id = '9a600000-0000-4000-8000-000000000001'), 1,
  'Reservation replay cannot create a second attempt');

set local role service_role;
select ok(pg_temp.capture_error(format($sql$
  select public.service_settle_nayax_refund_attempt(
    'provider-test-executor', %L, '9a800000-0000-4000-8000-000000000001',
    '9a600000-0000-4000-8000-000000000001',
    'nayax-refund-' || repeat('1',64), 700, 'USD', repeat('f',64),
    'success', 'SYNTHETIC-NAYAX-SUCCESS-1', 'approved', null)
$sql$, (select (result #>> '{attempt,attemptId}')::uuid
  from pg_temp.nayax_provider_results where result_key = 'success-reserve'))) like '%unused attempt-scoped provider claim%',
  'Wrong provider claim cannot mark an attempt successful');
reset role;
select ok(
  (select status = 'in_progress' and provider_outcome is null
   from public.refund_case_nayax_refund_attempts
   where refund_case_id = '9a600000-0000-4000-8000-000000000001')
  and (select status = 'card_refund_pending' and reporting_adjustment_id is null
       from public.refund_cases where id = '9a600000-0000-4000-8000-000000000001'),
  'Wrong claim produces no payment, case, or reporting mutation'
);

set local role service_role;
insert into pg_temp.nayax_provider_results (result_key, result)
select 'success-settle', public.service_settle_nayax_refund_attempt(
  'provider-test-executor',
  (select (result #>> '{attempt,attemptId}')::uuid
   from pg_temp.nayax_provider_results where result_key = 'success-reserve'),
  '9a800000-0000-4000-8000-000000000001',
  '9a600000-0000-4000-8000-000000000001',
  'nayax-refund-' || repeat('1',64), 700, 'USD',
  (select result ->> 'providerClaimToken' from pg_temp.nayax_provider_results
   where result_key = 'success-reserve'),
  'success', 'SYNTHETIC-NAYAX-SUCCESS-1', 'approved', null);
reset role;
select ok(
  (select (result ->> 'updateApplied')::boolean
      and (result ->> 'reportingAdjustmentPresent')::boolean
      and result #>> '{attempt,status}' = 'succeeded'
      and (result #>> '{attempt,caseFinalizationCommitted}')::boolean
   from pg_temp.nayax_provider_results where result_key = 'success-settle'),
  'The correct raw claim through the settlement wrapper atomically proves terminal attempt, case finalization, and reporting'
);
select ok(
  (select status = 'completed' and refund_completed_at is not null
      and reporting_adjustment_id is not null
   from public.refund_cases where id = '9a600000-0000-4000-8000-000000000001')
  and (select count(*) = 1 from public.sales_adjustment_facts
       where refund_case_id = '9a600000-0000-4000-8000-000000000001'),
  'Confirmed success completes the case and writes exactly one reporting adjustment'
);
select ok(
  (select status = 'succeeded' and provider_outcome = 'success'
      and provider_claim_consumed_at is not null
      and case_finalization_committed_at is not null
      and reporting_adjustment_id is not null
   from public.refund_case_nayax_refund_attempts
   where refund_case_id = '9a600000-0000-4000-8000-000000000001'),
  'Success attempt retains immutable consumed-claim and finalization markers'
);

set local role service_role;
select ok(pg_temp.capture_error(format($sql$
  select public.service_settle_nayax_refund_attempt(
    'provider-test-executor', %L, '9a800000-0000-4000-8000-000000000001',
    '9a600000-0000-4000-8000-000000000001',
    'nayax-refund-' || repeat('1',64), 700, 'USD', %L,
    'rejected', null, 'rejected', 'provider_rejected')
$sql$,
  (select (result #>> '{attempt,attemptId}')::uuid
   from pg_temp.nayax_provider_results where result_key = 'success-reserve'),
  (select result ->> 'providerClaimToken' from pg_temp.nayax_provider_results
   where result_key = 'success-reserve'))) like '%already terminal%',
  'The consumed provider claim cannot be reused and a terminal provider outcome cannot be rewritten');
select ok(pg_temp.capture_error(format(
  'select public.service_claim_nayax_refund_completion(%L,%L)',
  'gmail-gpt-scheduler',
  (select result #>> '{attempt,attemptId}'
   from pg_temp.nayax_provider_results where result_key = 'success-reserve')
)) like '%executor identity required%',
  'Unrelated service identity cannot claim customer completion');
reset role;

select ok(
  to_regprocedure('public.service_claim_nayax_refund_completion(text,uuid,text,text)') is null,
  'No arbitrary-subject/body completion claim overload exists'
);

set local role service_role;
insert into pg_temp.nayax_provider_results (result_key, result)
select 'completion-claim', public.service_claim_nayax_refund_completion(
  'provider-test-executor',
  (select (result #>> '{attempt,attemptId}')::uuid
   from pg_temp.nayax_provider_results where result_key = 'success-reserve'));
reset role;
select ok(
  (select (result ->> 'claimed')::boolean
      and (result ->> 'gmailThreadId')::uuid = '9aa00000-0000-4000-8000-000000000001'
      and (result ->> 'originalThread')::boolean
   from pg_temp.nayax_provider_results where result_key = 'completion-claim')
  and (select message_type = 'completed'
      and content_source = 'deterministic_template'
      and delivery_kind = 'manual'
      and template_version = 'refund_nayax_completion_v2'
      and body like 'Hi there,%'
      and body like '%We issued your $7.00 refund to the card ending in 4242 on %'
      and body like '%up to 4 business days%'
      and body not like '%marked complete%'
   from public.refund_case_messages
   where nayax_refund_attempt_id = (select id from public.refund_case_nayax_refund_attempts
     where refund_case_id = '9a600000-0000-4000-8000-000000000001')),
  'Completion claim uses DB-owned versioned copy on the earliest original thread'
);

set local role service_role;
insert into pg_temp.nayax_provider_results (result_key, result)
select 'completion-claim-replay', public.service_claim_nayax_refund_completion(
  'provider-test-executor',
  (select (result #>> '{attempt,attemptId}')::uuid
   from pg_temp.nayax_provider_results where result_key = 'success-reserve'));
reset role;
select ok(
  (select not (result ->> 'claimed')::boolean
   from pg_temp.nayax_provider_results where result_key = 'completion-claim-replay')
  and (select count(*) = 1 from public.refund_case_messages
       where nayax_refund_attempt_id = (select id from public.refund_case_nayax_refund_attempts
         where refund_case_id = '9a600000-0000-4000-8000-000000000001')),
  'Completion claim replay creates no duplicate customer operation'
);

insert into public.refund_gmail_messages (
  id, gmail_thread_id, refund_case_id, refund_case_message_id,
  provider_message_id, operation_key, direction, message_kind, status,
  sender_email, recipient_email, recipient_cc_emails, recipient_cc_count,
  recipient_manager_overlap, recipient_manager_count,
  recipient_resolution_status, delivery_kind, participant_role,
  participant_trust, subject, plain_body, received_at, sent_at,
  retention_expires_at
) select
  '9ab00000-0000-4000-8000-000000000001',
  '9aa00000-0000-4000-8000-000000000001',
  '9a600000-0000-4000-8000-000000000001', message.id,
  'provider-gmail-completion-1', 'refund-case-message:' || message.id::text,
  'outbound', 'message', 'sent', 'info@example.test',
  'provider-customer-1@example.test',
  array['provider-manager@example.test'], 1,
  false, 1,
  'resolved', 'manual', 'mailbox', 'verified', message.subject, message.body,
  statement_timestamp(), statement_timestamp(), statement_timestamp() + interval '180 days'
from public.refund_case_messages message
where message.nayax_refund_attempt_id = (select id from public.refund_case_nayax_refund_attempts
  where refund_case_id = '9a600000-0000-4000-8000-000000000001');

set local role service_role;
select ok(pg_temp.capture_error(format(
  'select public.service_finish_nayax_refund_completion(%L,%L,%L)',
  'provider-test-executor',
  (select result #>> '{attempt,attemptId}'
   from pg_temp.nayax_provider_results where result_key = 'success-reserve'),
  'sent'
)) like '%current mapped manager CC%',
  'Completion proof that omits one of two current managers is rejected');
reset role;
update public.refund_gmail_messages
set
  recipient_cc_emails = array[
    'provider-manager-two@example.test',
    'provider-manager@example.test'
  ],
  recipient_cc_count = 2,
  recipient_manager_count = 2,
  recipient_resolution_status = 'resolved_with_exclusions'
where id = '9ab00000-0000-4000-8000-000000000001';

set local role service_role;
select ok(pg_temp.capture_error(format(
  'select public.service_finish_nayax_refund_completion(%L,%L,%L)',
  'provider-test-executor',
  (select result #>> '{attempt,attemptId}'
   from pg_temp.nayax_provider_results where result_key = 'success-reserve'),
  'sent'
)) like '%current mapped manager CC%',
  'Provider completion rejects an exclusion-status route even when its visible CC count otherwise matches');
reset role;

update public.refund_gmail_messages
set recipient_resolution_status = 'resolved'
where id = '9ab00000-0000-4000-8000-000000000001';

set local role service_role;
insert into pg_temp.nayax_provider_results (result_key, result)
select 'completion-finish', public.service_finish_nayax_refund_completion(
  'provider-test-executor',
  (select (result #>> '{attempt,attemptId}')::uuid
   from pg_temp.nayax_provider_results where result_key = 'success-reserve'), 'sent');
reset role;
select ok(
  (select result ->> 'status' = 'sent'
      and (result ->> 'managerCcCount')::integer = 2
      and (result ->> 'originalThread')::boolean
      and not (result ->> 'managerCompletionNoticeSent')::boolean
   from pg_temp.nayax_provider_results where result_key = 'completion-finish'),
  'Sent completion requires exact original-thread Gmail proof with both and only both current managers in CC'
);
select ok(
  (select completion_delivery_status = 'sent' and completion_manager_cc_count = 2
   from public.refund_case_nayax_refund_attempts
   where refund_case_id = '9a600000-0000-4000-8000-000000000001')
  and (select count(*) = 1 from public.refund_case_messages
       where refund_case_id = '9a600000-0000-4000-8000-000000000001'
         and message_type = 'completed')
  and not exists (select 1 from public.refund_case_events
       where refund_case_id = '9a600000-0000-4000-8000-000000000001'
         and event_type like '%manager%completion%'),
  'Success sends one customer completion and no separate manager completion notice'
);

set local role service_role;
insert into pg_temp.nayax_provider_results (result_key, result)
select 'completion-finish-replay', public.service_finish_nayax_refund_completion(
  'provider-test-executor',
  (select (result #>> '{attempt,attemptId}')::uuid
   from pg_temp.nayax_provider_results where result_key = 'success-reserve'), 'sent');
reset role;
select ok(
  (select result ->> 'status' = 'already_sent'
      and not (result ->> 'operationApplied')::boolean
   from pg_temp.nayax_provider_results where result_key = 'completion-finish-replay'),
  'Sent completion replay is an idempotent no-op'
);

-- Inject and settle rejection, timeout, and unknown through the same real RPCs.
set local role service_role;
insert into pg_temp.nayax_provider_results (result_key, result)
select 'reserve-' || outcome, public.service_reserve_and_consume_nayax_refund_attempt_v2(
  'provider-test-executor',
  ('9a800000-0000-4000-8000-' || lpad(series::text,12,'0'))::uuid,
  ('9a600000-0000-4000-8000-' || lpad(series::text,12,'0'))::uuid,
  'nayax-refund-' || repeat(series::text,64), 700, 100000, 100, 'USD')
from (values (2,'rejected'),(3,'timeout'),(4,'unknown')) scenario(series,outcome);

insert into pg_temp.nayax_provider_results (result_key, result)
select 'settle-' || outcome, public.service_settle_nayax_refund_attempt(
  'provider-test-executor',
  (select (result #>> '{attempt,attemptId}')::uuid
   from pg_temp.nayax_provider_results where result_key = 'reserve-' || outcome),
  ('9a800000-0000-4000-8000-' || lpad(series::text,12,'0'))::uuid,
  ('9a600000-0000-4000-8000-' || lpad(series::text,12,'0'))::uuid,
  'nayax-refund-' || repeat(series::text,64), 700, 'USD',
  (select result ->> 'providerClaimToken' from pg_temp.nayax_provider_results
   where result_key = 'reserve-' || outcome),
  outcome, null, outcome, 'synthetic_' || outcome)
from (values (2,'rejected'),(3,'timeout'),(4,'unknown')) scenario(series,outcome);
reset role;

select ok(
  (select status = 'declined' and provider_outcome = 'rejected'
      and not reconciliation_required
   from public.refund_case_nayax_refund_attempts
   where refund_case_id = '9a600000-0000-4000-8000-000000000002')
  and (select status = 'card_refund_pending' and reporting_adjustment_id is null
       from public.refund_cases where id = '9a600000-0000-4000-8000-000000000002'),
  'Provider rejection is terminal while the refund case remains open'
);
select ok(
  not exists (select 1 from public.refund_case_messages
    where refund_case_id = '9a600000-0000-4000-8000-000000000002')
  and not exists (select 1 from public.sales_adjustment_facts
    where refund_case_id = '9a600000-0000-4000-8000-000000000002'),
  'Provider rejection emits no success mail, reporting, or fallback'
);
select ok(
  pg_temp.capture_error($sql$
    update public.refund_cases
    set status = 'denied', decision = 'denied'
    where id = '9a600000-0000-4000-8000-000000000002'
  $sql$) like '%Nayax provider outcome freezes official case decisions for payment support%',
  'A provider-rejected refund cannot be converted into a customer denial'
);
select ok(
  pg_temp.capture_error($sql$
    insert into public.refund_case_messages (
      refund_case_id, message_type, status, recipient_email, subject, body
    ) values (
      '9a600000-0000-4000-8000-000000000002',
      'denied', 'pending', 'provider-customer-2@example.test',
      'Unsafe rejection decision', 'Unsafe rejection decision'
    )
  $sql$) like '%Nayax provider outcome pauses customer messages for payment support%',
  'A provider-rejected refund cannot create a customer decision message'
);
select ok(
  (select status = 'ambiguous' and provider_outcome = 'timeout'
      and reconciliation_required
   from public.refund_case_nayax_refund_attempts
   where refund_case_id = '9a600000-0000-4000-8000-000000000003')
  and (select status = 'card_refund_pending' and nayax_refund_execution_status = 'ambiguous'
       from public.refund_cases where id = '9a600000-0000-4000-8000-000000000003'),
  'Provider timeout leaves the case open on a durable reconciliation hold'
);

select ok(
  pg_temp.capture_error($sql$
    update public.refund_cases
    set status = 'denied', decision = 'denied'
    where id = '9a600000-0000-4000-8000-000000000003'
  $sql$) like '%Nayax provider outcome freezes official case decisions for payment support%',
  'An unconfirmed provider outcome cannot be converted into a denial'
);

select ok(
  pg_temp.capture_error($sql$
    insert into public.refund_case_messages (
      refund_case_id, message_type, status, recipient_email, subject, body
    ) values (
      '9a600000-0000-4000-8000-000000000003',
      'denied', 'pending', 'provider-customer-3@example.test',
      'Unsafe decision', 'Unsafe decision'
    )
  $sql$) like '%Nayax provider outcome pauses customer messages for payment support%',
  'An unconfirmed provider outcome cannot create a customer decision message'
);

select is(
  public.refund_nayax_provider_outcome_state('ambiguous'),
  'unconfirmed',
  'Ambiguous Nayax state is exposed only as a sanitized unconfirmed outcome'
);

select ok(
  pg_get_functiondef('public.admin_get_refund_email_queue_states()'::regprocedure)
    like '%providerOutcome%'
  and pg_get_functiondef('public.admin_get_refund_email_queue_states()'::regprocedure)
    not like '%provider_transaction_id%',
  'Manager queue exposes only the sanitized provider outcome without provider identifiers'
);
select ok(
  not exists (select 1 from public.refund_case_messages
    where refund_case_id = '9a600000-0000-4000-8000-000000000003')
  and not exists (select 1 from public.sales_adjustment_facts
    where refund_case_id = '9a600000-0000-4000-8000-000000000003'),
  'Provider timeout emits no success mail, reporting, or fallback'
);
select ok(
  (select status = 'ambiguous' and provider_outcome = 'unknown'
      and reconciliation_required
   from public.refund_case_nayax_refund_attempts
   where refund_case_id = '9a600000-0000-4000-8000-000000000004')
  and (select status = 'card_refund_pending' and nayax_refund_execution_status = 'ambiguous'
       from public.refund_cases where id = '9a600000-0000-4000-8000-000000000004'),
  'Unknown provider outcome leaves the case open on a durable reconciliation hold'
);
select ok(
  not exists (select 1 from public.refund_case_messages
    where refund_case_id = '9a600000-0000-4000-8000-000000000004')
  and not exists (select 1 from public.sales_adjustment_facts
    where refund_case_id = '9a600000-0000-4000-8000-000000000004'),
  'Unknown provider outcome emits no success mail, reporting, or fallback'
);

set local role service_role;
insert into pg_temp.nayax_provider_results (result_key, result)
select 'rejected-replay', public.service_reserve_and_consume_nayax_refund_attempt_v2(
  'provider-test-executor', '9a800000-0000-4000-8000-000000000002',
  '9a600000-0000-4000-8000-000000000002',
  'nayax-refund-' || repeat('2',64), 700, 100000, 100, 'USD');
reset role;
select ok(
  (select not (result #>> '{attempt,shouldExecute}')::boolean
      and result #>> '{attempt,providerOutcome}' = 'rejected'
      and result -> 'providerClaimToken' = 'null'::jsonb
   from pg_temp.nayax_provider_results where result_key = 'rejected-replay'),
  'Terminal non-success replay exposes no claim and cannot call the provider again'
);

-- Force a post-consumption insert failure. The one-use authorization must roll
-- back with the failed attempt reservation.
insert into public.refund_case_nayax_refund_attempts (
  refund_case_id, actor_user_id, execution_mode, status,
  idempotency_key, amount_cents
) values (
  '9a600000-0000-4000-8000-000000000005',
  '9a000000-0000-4000-8000-000000000001',
  'preflight', 'in_progress', 'legacy-live-attempt', 700
);
set local role service_role;
select ok(pg_temp.capture_error($sql$
  select public.service_reserve_and_consume_nayax_refund_attempt_v2(
    'provider-test-executor', '9a800000-0000-4000-8000-000000000005',
    '9a600000-0000-4000-8000-000000000005',
    'nayax-refund-' || repeat('5',64), 700, 100000, 100, 'USD')
$sql$) like '%duplicate key value%',
  'A post-consumption unique conflict aborts the atomic reservation');
reset role;
select is((select status from public.refund_case_official_action_authorizations
  where id = '9a800000-0000-4000-8000-000000000005'), 'authorized',
  'Failed attempt insert rolls manager authorization consumption back');
select is((select count(*)::integer from public.refund_case_nayax_refund_attempts
  where idempotency_key = 'nayax-refund-' || repeat('5',64)), 0,
  'Failed atomic reservation leaves no partial attempt row');

select ok(
  (select count(*) = 4 from public.refund_case_nayax_refund_attempts
   where refund_case_id in (
     '9a600000-0000-4000-8000-000000000001',
     '9a600000-0000-4000-8000-000000000002',
     '9a600000-0000-4000-8000-000000000003',
     '9a600000-0000-4000-8000-000000000004'
   ))
  and (select count(*) = 1 from public.sales_adjustment_facts
       where refund_case_id in (
         '9a600000-0000-4000-8000-000000000001',
         '9a600000-0000-4000-8000-000000000002',
         '9a600000-0000-4000-8000-000000000003',
         '9a600000-0000-4000-8000-000000000004'
       )),
  'Four injected outcomes produce four attempts and only one payment/reporting completion'
);

select * from finish();
rollback;
