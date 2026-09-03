begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

-- Exercise the historical default-off branch before this transaction opens the
-- resolver. The current reviewed schema enables the mapped-manager path.
create or replace function public.refund_nayax_outcome_resolution_enabled()
returns boolean language sql immutable set search_path = public
as $$ select false; $$;

-- Test-owner delegate exercises retained historical internals without reopening
-- the retired production endpoint. Current service entry is tested separately.
create function pg_temp.historical_reserve_v2(text,uuid,uuid,text,integer,integer,integer,text)
returns jsonb language sql security definer set search_path='' as $$
  select public.service_reserve_and_consume_nayax_refund_attempt_v2($1,$2,$3,$4,$5,$6,$7,$8);
$$;
revoke all on function pg_temp.historical_reserve_v2(text,uuid,uuid,text,integer,integer,integer,text) from public,anon,authenticated,service_role;
grant execute on function pg_temp.historical_reserve_v2(text,uuid,uuid,text,integer,integer,integer,text) to service_role;

select plan(145);

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

create function pg_temp.set_auth_claims(
  p_user_id uuid,
  p_aal text,
  p_amr jsonb
)
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claim.sub', p_user_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', p_user_id,
      'role', 'authenticated',
      'aal', p_aal,
      'amr', p_amr
    )::text,
    true
  );
end;
$$;

create temporary table nayax_resolution_test_intents (
  intent_key text primary key,
  intent_id uuid not null,
  evidence_occurred_at timestamptz
);
create temporary table nayax_resolution_test_proofs (
  intent_key text primary key,
  proof text not null
);
create temporary table nayax_resolution_test_results (
  result_key text primary key,
  result jsonb not null
);
grant all on table pg_temp.nayax_resolution_test_intents to authenticated, service_role;
grant all on table pg_temp.nayax_resolution_test_proofs to authenticated, service_role;
grant all on table pg_temp.nayax_resolution_test_results to authenticated, service_role;

create function pg_temp.intent_totp_epoch(p_intent_id uuid, p_offset_seconds integer)
returns numeric
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select extract(epoch from date_trunc('second', intent.not_before)
    + make_interval(secs => p_offset_seconds))
  from public.refund_nayax_resolution_intents intent
  where intent.id = p_intent_id;
$$;
grant execute on function pg_temp.intent_totp_epoch(uuid, integer) to authenticated;

create function pg_temp.seed_fresh_nayax_authorization(
  p_case_id uuid,
  p_intent_id uuid,
  p_authorization_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  case_row public.refund_cases%rowtype;
  machine_row public.reporting_machines%rowtype;
  mapping_row public.reporting_machine_refund_managers%rowtype;
  evidence_hash text;
  context_hash text;
  factor_time timestamptz := statement_timestamp() - interval '20 seconds';
begin
  select * into case_row from public.refund_cases where id = p_case_id;
  select * into machine_row from public.reporting_machines
    where id = case_row.reporting_machine_id;
  select * into mapping_row
  from public.reporting_machine_refund_managers
  where reporting_machine_id = case_row.reporting_machine_id
    and manager_user_id = 'b1000000-0000-4000-8000-000000000001'
    and status = 'active' and revoked_at is null;

  evidence_hash := public.refund_nayax_execution_evidence_hash(
    case_row,
    machine_row
  );
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
    context_hash, evidence_hash, 'consumed',
    statement_timestamp() - interval '30 seconds',
    statement_timestamp() + interval '60 seconds',
    factor_time, factor_time, factor_time
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
  ('00000000-0000-0000-0000-000000000000', 'b1000000-0000-4000-8000-000000000001',
   'authenticated', 'authenticated', 'resolution-manager@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'b1000000-0000-4000-8000-000000000002',
   'authenticated', 'authenticated', 'resolution-unrelated@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now());

insert into public.admin_roles (user_id, role, active)
values ('b1000000-0000-4000-8000-000000000001', 'super_admin', true);

insert into public.customer_accounts (id, name, account_type)
values ('b1100000-0000-4000-8000-000000000001', 'Nayax resolution safety', 'customer');

insert into public.reporting_locations (id, account_id, name, timezone)
values (
  'b1200000-0000-4000-8000-000000000001',
  'b1100000-0000-4000-8000-000000000001',
  'Resolution test location',
  'America/Los_Angeles'
);

insert into public.reporting_machines (
  id, account_id, location_id, machine_label, nayax_machine_id,
  nayax_account_key, nayax_refunds_enabled, nayax_refund_max_amount_cents
) values
  (
    'b1300000-0000-4000-8000-000000000001',
    'b1100000-0000-4000-8000-000000000001',
    'b1200000-0000-4000-8000-000000000001',
    'Resolution test machine', 'RESOLUTION-MACHINE', 'RESOLUTION-ACCOUNT', true, 2500
  ),
  (
    'b1300000-0000-4000-8000-000000000002',
    'b1100000-0000-4000-8000-000000000001',
    'b1200000-0000-4000-8000-000000000001',
    'Retry-safe release machine', 'RESOLUTION-RETRY-MACHINE',
    'RESOLUTION-RETRY-ACCOUNT', true, 2500
  );

insert into public.reporting_machine_refund_managers (
  id, reporting_machine_id, manager_user_id, manager_email, grant_reason
) values
  (
    'b1400000-0000-4000-8000-000000000001',
    'b1300000-0000-4000-8000-000000000001',
    'b1000000-0000-4000-8000-000000000001',
    'resolution-manager@example.test',
    'Nayax resolution safety'
  ),
  (
    'b1400000-0000-4000-8000-000000000002',
    'b1300000-0000-4000-8000-000000000002',
    'b1000000-0000-4000-8000-000000000001',
    'resolution-manager@example.test',
    'Retry-safe release safety'
  );

insert into public.refund_manager_totp_enrollments (
  actor_user_id, approved_factor_binding_hash, owner_approved_by_user_id,
  owner_approval_version, enrollment_version
) values (
  'b1000000-0000-4000-8000-000000000001',
  repeat('a', 64),
  'b1000000-0000-4000-8000-000000000001',
  1,
  1
);

insert into public.refund_nayax_resolution_operators (
  actor_user_id, capability, status, approved_by_owner_user_id
) values (
  'b1000000-0000-4000-8000-000000000001',
  'payment_support_resolution',
  'active',
  'b1000000-0000-4000-8000-000000000001'
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
  nayax_recommendation_evaluated_at, nayax_match_execution_eligible,
  nayax_refund_execution_status
)
select
  ('b1600000-0000-4000-8000-' || lpad(series::text, 12, '0'))::uuid,
  'RF-RESOLUTION-' || series,
  case when series = 11
    then 'b1300000-0000-4000-8000-000000000002'::uuid
    else 'b1300000-0000-4000-8000-000000000001'::uuid
  end,
  'b1200000-0000-4000-8000-000000000001'::uuid,
  case when series in (6, 7) then 'resolution-manager@example.test'
    else 'resolution-customer-' || series || '@example.test' end,
  'Synthetic held provider attempt ' || series,
  statement_timestamp() - make_interval(hours => series),
  'card', 700 + series, 700 + series, 'card_refund_pending', 'approved',
  'b1000000-0000-4000-8000-000000000001'::uuid,
  statement_timestamp() - interval '20 minutes',
  (4200 + series)::text, false, 'matched', 'nayax', 1,
  'RESOLUTION-TX-' || lpad(series::text, 3, '0'),
  700 + series,
  statement_timestamp() - make_interval(hours => series),
  700 + series, (4200 + series)::text, 'USD', 'high_confidence',
  'resolution-test-v1', statement_timestamp(), false,
  case series
    when 1 then 'ambiguous'
    when 2 then 'declined'
    when 3 then 'failed'
    when 6 then 'ambiguous'
    when 7 then 'ambiguous'
    when 11 then 'ambiguous'
    else 'declined'
  end
from unnest(array[1, 2, 3, 4, 5, 6, 7, 11]) series;

insert into public.refund_case_events (
  refund_case_id, actor_user_id, event_type, message, metadata
) values (
  'b1600000-0000-4000-8000-000000000011',
  'b1000000-0000-4000-8000-000000000001',
  'nayax_match_selected', 'Manager selected the transaction.',
  '{"selected_recommended":true,"payload_redacted":true}'::jsonb
);

insert into public.refund_gmail_threads (
  id, refund_case_id, mailbox_hash, provider_thread_id, thread_subject,
  first_message_at, latest_message_at, retention_expires_at
) values
  (
    'b1800000-0000-4000-8000-000000000003',
    'b1600000-0000-4000-8000-000000000003', repeat('3', 64),
    'resolution-original-thread-3', 'Original refund conversation 3',
    statement_timestamp() - interval '2 days',
    statement_timestamp() - interval '1 day',
    statement_timestamp() + interval '180 days'
  ),
  (
    'b1800000-0000-4000-8000-000000000004',
    'b1600000-0000-4000-8000-000000000004', repeat('4', 64),
    'resolution-original-thread-4', 'Original refund conversation 4',
    statement_timestamp() - interval '2 days',
    statement_timestamp() - interval '1 day',
    statement_timestamp() + interval '180 days'
  ),
  (
    'b1800000-0000-4000-8000-000000000005',
    'b1600000-0000-4000-8000-000000000005', repeat('5', 64),
    'resolution-original-thread-5', 'Original refund conversation 5',
    statement_timestamp() - interval '2 days',
    statement_timestamp() - interval '1 day',
    statement_timestamp() + interval '180 days'
  );

insert into public.refund_nayax_provider_callers (
  caller_id, assertion_digest
) values (
  'nayax-card-refund',
  encode(
    extensions.digest(
      convert_to('resolution-test-executor', 'UTF8'),
      'sha256'
    ),
    'hex'
  )
);

insert into public.refund_case_nayax_refund_attempts (
  id, refund_case_id, actor_user_id, execution_mode, status, idempotency_key,
  amount_cents, transaction_id_present, site_id_present,
  machine_auth_time_present, request_fingerprint, currency_code,
  provider_outcome, provider_outcome_recorded_at, reconciliation_required,
  sanitized_request, sanitized_response, created_at
)
select
  ('b1700000-0000-4000-8000-' || lpad(series::text, 12, '0'))::uuid,
  ('b1600000-0000-4000-8000-' || lpad(series::text, 12, '0'))::uuid,
  'b1000000-0000-4000-8000-000000000001'::uuid,
  'request_and_approve',
  case series
    when 1 then 'ambiguous'
    when 2 then 'declined'
    when 3 then 'failed'
    when 6 then 'ambiguous'
    when 7 then 'ambiguous'
    when 11 then 'ambiguous'
    else 'declined'
  end,
  'resolution-idempotency-' || series,
  700 + series, true, true, true,
  case when series = 11 then repeat('b', 64) else repeat(series::text, 64) end,
  'USD',
  case series
    when 1 then 'unknown'
    when 2 then 'rejected'
    when 3 then 'timeout'
    when 6 then 'unknown'
    when 7 then 'unknown'
    when 11 then 'unknown'
    else 'rejected'
  end,
  statement_timestamp() - interval '10 minutes',
  true,
  jsonb_build_object('payload_redacted', true),
  jsonb_build_object('payload_redacted', true),
  statement_timestamp() - interval '20 minutes'
from unnest(array[1, 2, 3, 4, 5, 6, 7, 11]) series;

select ok(not public.refund_nayax_outcome_resolution_enabled(),
  'Payment-support resolution is hard disabled by default');
select is((select count(*)::integer from public.refund_nayax_resolution_operators), 1,
  'The migration seeds no production operator; only this transaction fixture exists');
select ok(
  not has_table_privilege('authenticated', 'public.refund_nayax_resolution_operators', 'select')
  and not has_table_privilege('authenticated', 'public.refund_nayax_resolution_intents', 'insert')
  and not has_table_privilege('authenticated', 'public.refund_nayax_outcome_resolutions', 'update')
  and not has_table_privilege('service_role', 'public.refund_nayax_outcome_resolutions', 'select'),
  'Operator, intent, and immutable resolution tables are private from browsers and services');
select ok(
  has_function_privilege('authenticated',
    'public.admin_prepare_refund_nayax_resolution_intent(uuid,uuid,text,text,text,timestamptz,text,bigint)', 'execute')
  and has_function_privilege('authenticated',
    'public.admin_consume_refund_nayax_resolution_intent(uuid,uuid,uuid,text,text,text,timestamptz,text,text)', 'execute')
  and not has_function_privilege('service_role',
    'public.admin_consume_refund_nayax_resolution_intent(uuid,uuid,uuid,text,text,text,timestamptz,text,text)', 'execute')
  and has_function_privilege('service_role',
    'public.service_mark_refund_nayax_resolution_factor_verified(uuid,uuid,text)', 'execute')
  and has_function_privilege('service_role',
    'public.service_prepare_nayax_completion_retry(text,uuid)', 'execute')
  and not has_function_privilege('authenticated',
    'public.service_prepare_nayax_completion_retry(text,uuid)', 'execute'),
  'Authenticated humans consume exact intents and only the trusted service marks factor proof');
select ok((
  select pg_get_userbyid(procedure.proowner) = pg_get_userbyid(database.datdba)
  from pg_proc procedure
  cross join pg_database database
  where procedure.oid =
    'public.admin_consume_refund_nayax_resolution_intent(uuid,uuid,uuid,text,text,text,timestamptz,text,text)'::regprocedure
    and database.datname = current_database()
), 'The consume function is owned by the exact database owner');

set local role authenticated;
select pg_temp.set_auth_claims(
  'b1000000-0000-4000-8000-000000000002', 'aal1',
  jsonb_build_array(jsonb_build_object('method', 'password', 'timestamp', extract(epoch from statement_timestamp())))
);
select ok(
  not (public.admin_get_refund_nayax_resolution_readiness(
    'b1600000-0000-4000-8000-000000000001') ->> 'visible')::boolean,
  'An unrelated user cannot discover the payment-support control');
reset role;

set local role authenticated;
select pg_temp.set_auth_claims(
  'b1000000-0000-4000-8000-000000000001', 'aal1',
  jsonb_build_array(jsonb_build_object('method', 'password', 'timestamp', extract(epoch from statement_timestamp())))
);
select ok((
  select (readiness ->> 'visible')::boolean
    and not (readiness ->> 'available')::boolean
    and readiness ->> 'blockReason' = 'resolution_disabled'
    and (readiness ->> 'payloadRedacted')::boolean
  from (select public.admin_get_refund_nayax_resolution_readiness(
    'b1600000-0000-4000-8000-000000000001') readiness) checked
), 'The exact operator sees a redacted default-off readiness result');
select ok(pg_temp.capture_error($sql$
  select public.admin_prepare_refund_nayax_resolution_intent(
    'b1600000-0000-4000-8000-000000000001',
    'b1700000-0000-4000-8000-000000000001',
    'remain_on_hold', 'nayax_support_ticket', 'SUPPORT:DISABLED-001',
    null, 'evidence_incomplete', 1)
$sql$) like '%resolution is disabled%',
  'The default-off gate blocks preparation before any write');
reset role;

create or replace function public.refund_nayax_outcome_resolution_enabled()
returns boolean language sql immutable set search_path = public as $$ select true; $$;

select ok(pg_temp.capture_error($sql$
  update public.refund_cases
  set nayax_refund_attempt_generation = 1
  where id = 'b1600000-0000-4000-8000-000000000001'
$sql$) like '%advances only through one exact retry-safe support resolution%',
  'No browser, service, or database-owner session can forge a fresh retry generation');

set local role authenticated;
select pg_temp.set_auth_claims(
  'b1000000-0000-4000-8000-000000000001', 'aal1',
  jsonb_build_array(jsonb_build_object('method', 'password', 'timestamp', extract(epoch from statement_timestamp())))
);
select ok((
  select (readiness ->> 'available')::boolean
    and readiness ->> 'providerOutcome' = 'unknown'
    and jsonb_array_length(readiness -> 'allowedResults') = 4
  from (select public.admin_get_refund_nayax_resolution_readiness(
    'b1600000-0000-4000-8000-000000000001') readiness) checked
), 'The test-only gate exposes only the exact latest held attempt and four fixed outcomes');
reset role;
update public.refund_manager_totp_enrollments
set status = 'revoked', revoked_at = statement_timestamp()
where actor_user_id = 'b1000000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.set_auth_claims(
  'b1000000-0000-4000-8000-000000000001', 'aal1',
  jsonb_build_array(jsonb_build_object('method', 'password', 'timestamp', extract(epoch from statement_timestamp())))
);
select ok((
  select (readiness ->> 'visible')::boolean
    and (readiness ->> 'available')::boolean
    and readiness ->> 'blockReason' is null
  from (select public.admin_get_refund_nayax_resolution_readiness(
    'b1600000-0000-4000-8000-000000000001') readiness) checked
), 'A mapped manager remains ready without an authenticator enrollment');
reset role;
update public.refund_manager_totp_enrollments
set status = 'active', revoked_at = null
where actor_user_id = 'b1000000-0000-4000-8000-000000000001';

set local role authenticated;
select pg_temp.set_auth_claims(
  'b1000000-0000-4000-8000-000000000001', 'aal1',
  jsonb_build_array(jsonb_build_object('method', 'password', 'timestamp', extract(epoch from statement_timestamp())))
);
insert into pg_temp.nayax_resolution_test_results (result_key, result)
select 'manager-session-success', public.admin_resolve_refund_nayax_outcome_manager_session(
  'b1600000-0000-4000-8000-000000000005',
  'b1700000-0000-4000-8000-000000000005',
  'provider_confirmed_success',
  'nayax_support_ticket',
  'SUPPORT:NAYAX-CS1500666',
  statement_timestamp() - interval '15 minutes',
  'nayax_support_confirmed_success',
  (select official_action_version from public.refund_cases
    where id = 'b1600000-0000-4000-8000-000000000005')
);
reset role;
select ok((
  select (result ->> 'caseCompleted')::boolean
    and not (result ->> 'providerCallMade')::boolean
    and result ->> 'authorizationMethod' = 'manager_session'
  from pg_temp.nayax_resolution_test_results
  where result_key = 'manager-session-success'
), 'The mapped-manager session completes a confirmed result without another provider call');
select ok((
  select intent.authorization_method = 'manager_session'
    and intent.manager_totp_enrollment_version is null
    and intent.operator_version is null
    and resolution.authorization_method = 'manager_session'
  from public.refund_nayax_resolution_intents intent
  join public.refund_nayax_outcome_resolutions resolution
    on resolution.resolution_intent_id = intent.id
  where intent.refund_case_id = 'b1600000-0000-4000-8000-000000000005'
), 'Manager-session evidence records no TOTP enrollment or temporary operator');
select ok((
  select refund_case.status = 'completed'
    and refund_case.reporting_adjustment_id is not null
    and attempt.status = 'succeeded'
    and attempt.provider_outcome = 'success'
    and not attempt.reconciliation_required
  from public.refund_cases refund_case
  join public.refund_case_nayax_refund_attempts attempt
    on attempt.refund_case_id = refund_case.id
  where refund_case.id = 'b1600000-0000-4000-8000-000000000005'
), 'Confirmed success atomically settles the case, reporting, and held attempt');
select ok(
  (select count(*) = 1 from public.sales_adjustment_facts
    where refund_case_id = 'b1600000-0000-4000-8000-000000000005')
  and (select count(*) = 1 from public.refund_case_messages
    where refund_case_id = 'b1600000-0000-4000-8000-000000000005'
      and template_version = 'refund_nayax_completion_v2')
  and (select completion_gmail_thread_id = 'b1800000-0000-4000-8000-000000000005'
    from public.refund_case_nayax_refund_attempts
    where refund_case_id = 'b1600000-0000-4000-8000-000000000005'),
  'Confirmed success creates one adjustment and one original-thread completion');

set local role authenticated;
select pg_temp.set_auth_claims(
  'b1000000-0000-4000-8000-000000000001', 'aal1',
  jsonb_build_array(jsonb_build_object('method', 'password', 'timestamp', extract(epoch from statement_timestamp())))
);
insert into pg_temp.nayax_resolution_test_results (result_key, result)
select 'form-manager-session-success', public.admin_resolve_refund_nayax_outcome_manager_session(
  'b1600000-0000-4000-8000-000000000006',
  'b1700000-0000-4000-8000-000000000006',
  'provider_confirmed_success',
  'nayax_support_ticket',
  'SUPPORT:NAYAX-CS1500667',
  statement_timestamp() - interval '10 minutes',
  'nayax_support_confirmed_success',
  (select official_action_version from public.refund_cases
    where id = 'b1600000-0000-4000-8000-000000000006')
);
reset role;
select ok((
  select (stored.result ->> 'caseCompleted')::boolean
    and (stored.result ->> 'customerCompletionMessageId') is not null
    and attempt.completion_gmail_thread_id is null
  from pg_temp.nayax_resolution_test_results stored
  join public.refund_case_nayax_refund_attempts attempt
    on attempt.id = 'b1700000-0000-4000-8000-000000000006'
  where stored.result_key = 'form-manager-session-success'
), 'A website-form case prepares one customer completion without inventing a Gmail thread');

set local role service_role;
insert into pg_temp.nayax_resolution_test_results (result_key, result)
select 'form-route', public.service_authorize_nayax_refund_form_completion(
  'resolution-test-executor',
  'b1700000-0000-4000-8000-000000000006',
  array['refunds@example.test']::text[]
);
reset role;
select ok((
  select result ->> 'status' = 'resolved'
    and (result ->> 'managerCcCount')::integer = 0
    and (result ->> 'managerRecipientOverlap')::boolean
    and result ->> 'recipientEmail' = 'resolution-manager@example.test'
  from pg_temp.nayax_resolution_test_results
  where result_key = 'form-route'
), 'A mapped manager who is also the customer is covered once as the To recipient');

set local role service_role;
insert into pg_temp.nayax_resolution_test_results (result_key, result)
select 'form-finish', public.service_finish_nayax_refund_form_completion(
  'resolution-test-executor',
  'b1700000-0000-4000-8000-000000000006',
  'sent',
  0,
  true
);
reset role;
select ok((
  select result ->> 'status' = 'sent'
    and result ->> 'transport' = 'transactional_email'
    and (result ->> 'managerCcCount')::integer = 0
    and (result ->> 'managerRecipientOverlap')::boolean
  from pg_temp.nayax_resolution_test_results
  where result_key = 'form-finish'
), 'The website completion finalizer records the transactional route without a duplicate self-CC');
select ok(
  (select count(*) = 1 from public.refund_case_messages
    where refund_case_id = 'b1600000-0000-4000-8000-000000000006'
      and template_version = 'refund_nayax_completion_v2'
      and status = 'sent')
  and (select completion_delivery_status = 'sent'
      and completion_manager_cc_count = 0
    from public.refund_case_nayax_refund_attempts
    where id = 'b1700000-0000-4000-8000-000000000006')
  and exists (
    select 1 from public.refund_case_events event
    where event.refund_case_id = 'b1600000-0000-4000-8000-000000000006'
      and event.event_type = 'nayax_customer_completion_sent'
      and (event.metadata ->> 'manager_recipient_overlap')::boolean
      and event.metadata ->> 'transport' = 'transactional_email'
  ),
  'Website completion has one sent message and redacted manager-recipient audit evidence');

set local role authenticated;
select pg_temp.set_auth_claims(
  'b1000000-0000-4000-8000-000000000001', 'aal1',
  jsonb_build_array(jsonb_build_object('method', 'password', 'timestamp', extract(epoch from statement_timestamp())))
);
insert into pg_temp.nayax_resolution_test_results (result_key, result)
select 'form-retry-source', public.admin_resolve_refund_nayax_outcome_manager_session(
  'b1600000-0000-4000-8000-000000000007',
  'b1700000-0000-4000-8000-000000000007',
  'provider_confirmed_success', 'nayax_support_ticket',
  'SUPPORT:NAYAX-CS1500668', statement_timestamp() - interval '8 minutes',
  'nayax_support_confirmed_success',
  (select official_action_version from public.refund_cases
    where id = 'b1600000-0000-4000-8000-000000000007')
);
reset role;
select ok((
  select (result ->> 'caseCompleted')::boolean
    and (result ->> 'providerCallMade')::boolean is false
  from pg_temp.nayax_resolution_test_results
  where result_key = 'form-retry-source'
), 'A second website-form fixture commits before exercising email-only recovery');

set local role service_role;
insert into pg_temp.nayax_resolution_test_results (result_key, result)
select 'form-retry-prepared', public.service_prepare_nayax_form_completion_retry(
  'b1600000-0000-4000-8000-000000000007',
  (select (result ->> 'customerCompletionMessageId')::uuid
    from pg_temp.nayax_resolution_test_results
    where result_key = 'form-retry-source'),
  array['refunds@example.test']::text[]
);
reset role;
select ok((
  select result ->> 'prepared' = 'true'
    and result ->> 'transport' = 'transactional_email'
    and result ->> 'providerCallMade' = 'false'
    and (result ->> 'managerRecipientOverlap')::boolean
    and (select completion_delivery_retry_count = 1
      from public.refund_case_nayax_refund_attempts
      where id = 'b1700000-0000-4000-8000-000000000007')
  from pg_temp.nayax_resolution_test_results
  where result_key = 'form-retry-prepared'
), 'Website-form recovery claims exactly one email-only retry with no provider action');
select ok(pg_temp.capture_error($sql$
  select public.service_prepare_nayax_form_completion_retry(
    'b1600000-0000-4000-8000-000000000007',
    (select completion_message_id from public.refund_case_nayax_refund_attempts
      where id = 'b1700000-0000-4000-8000-000000000007'),
    array['refunds@example.test']::text[]
  )
$sql$) like '%One pending website-form Nayax completion is required%',
  'The website-form email-only retry cannot be claimed twice');

select ok(pg_temp.capture_error($sql$
  select public.admin_resolve_refund_nayax_outcome_manager_session(
    'b1600000-0000-4000-8000-000000000005',
    'b1700000-0000-4000-8000-000000000005',
    'provider_confirmed_success', 'nayax_support_ticket',
    'SUPPORT:NAYAX-CS1500666', statement_timestamp() - interval '15 minutes',
    'nayax_support_confirmed_success',
    (select official_action_version from public.refund_cases
      where id = 'b1600000-0000-4000-8000-000000000005')
  )
$sql$) is not null
  and (select count(*) = 1 from public.sales_adjustment_facts
    where refund_case_id = 'b1600000-0000-4000-8000-000000000005')
  and (select count(*) = 1 from public.refund_case_messages
    where refund_case_id = 'b1600000-0000-4000-8000-000000000005'),
  'The same result cannot be replayed into duplicate reporting or customer contact');
reset role;

set local role authenticated;
select pg_temp.set_auth_claims(
  'b1000000-0000-4000-8000-000000000001', 'aal1',
  jsonb_build_array(jsonb_build_object('method', 'password', 'timestamp', extract(epoch from statement_timestamp())))
);
select ok(pg_temp.capture_error($sql$
  select public.admin_prepare_refund_nayax_resolution_intent(
    'b1600000-0000-4000-8000-000000000001',
    'b1700000-0000-4000-8000-000000000001',
    'provider_confirmed_success', 'nayax_dtm_transaction', 'DTM:MISMATCH-001',
    statement_timestamp() - interval '5 minutes',
    'nayax_support_confirmed_success', 1)
$sql$) like '%do not form an approved%',
  'Evidence type and reason must form an exact approved pair');
select ok(pg_temp.capture_error($sql$
  select public.admin_prepare_refund_nayax_resolution_intent(
    'b1600000-0000-4000-8000-000000000001',
    'b1700000-0000-4000-8000-000000000001',
    'remain_on_hold', 'nayax_support_ticket', 'unsafe reference with spaces',
    null, 'evidence_incomplete', 1)
$sql$) like '%safe authoritative evidence reference%',
  'Evidence accepts a bounded reference only, never vendor content');
select ok(pg_temp.capture_error($sql$
  select public.admin_prepare_refund_nayax_resolution_intent(
    'b1600000-0000-4000-8000-000000000001',
    'b1700000-0000-4000-8000-000000000001',
    'remain_on_hold', 'nayax_support_ticket', 'SUPPORT:4111111111111111',
    null, 'evidence_incomplete', 1)
$sql$) like '%safe authoritative evidence reference%',
  'PAN, phone, account, and other long digit-shaped references are rejected');
select ok(pg_temp.capture_error($sql$
  select public.admin_prepare_refund_nayax_resolution_intent(
    'b1600000-0000-4000-8000-000000000001',
    'b1700000-0000-4000-8000-000000000001',
    'remain_on_hold', 'nayax_support_ticket', 'SUPPORT:4111-1111-1111-1111',
    null, 'evidence_incomplete', 1)
$sql$) like '%safe authoritative evidence reference%',
  'Grouped card, phone, and account digit shapes are rejected');
reset role;
select ok(public.refund_nayax_resolution_reference_is_safe(
  'SUPPORT:NAYAX-03595795', 'nayax_support_ticket'
), 'The documented eight-digit Nayax support-ticket shape remains usable');
select ok(public.refund_nayax_resolution_reference_is_safe(
  'SUPPORT:NAYAX-CS1500666', 'nayax_support_ticket'
), 'The documented seven-digit Nayax CS support-ticket shape remains usable');
select ok(public.refund_nayax_resolution_reference_is_safe(
  'DTM:NAYAX-123456789', 'nayax_dtm_transaction'
), 'The documented nine-digit Nayax DTM transaction shape remains usable');
select ok(public.refund_nayax_resolution_reference_is_safe(
  'DTM:NAYAX-1234567890', 'nayax_dtm_transaction'
), 'The provider-emitted ten-digit Nayax DTM transaction shape is usable');
select ok(not public.refund_nayax_resolution_reference_is_safe(
  'DTM:NAYAX-12345678901', 'nayax_dtm_transaction'
), 'An undocumented eleven-digit DTM shape remains blocked');
set local role authenticated;
select pg_temp.set_auth_claims(
  'b1000000-0000-4000-8000-000000000001', 'aal1',
  jsonb_build_array(jsonb_build_object('method', 'password', 'timestamp', extract(epoch from statement_timestamp())))
);
select ok(pg_temp.capture_error($sql$
  select public.admin_prepare_refund_nayax_resolution_intent(
    'b1600000-0000-4000-8000-000000000001',
    'b1700000-0000-4000-8000-000000000001',
    'provider_confirmed_success', 'nayax_dtm_transaction', 'DTM:SETTLED-TIME',
    null, 'nayax_dtm_settled', 1)
$sql$) like '%action time is required%',
  'A success outcome cannot substitute support-review time for the payment action time');
select ok(pg_temp.capture_error($sql$
  select public.admin_prepare_refund_nayax_resolution_intent(
    'b1600000-0000-4000-8000-000000000001',
    'b1700000-0000-4000-8000-000000000002',
    'remain_on_hold', 'nayax_support_ticket', 'SUPPORT:WRONG-ATTEMPT',
    null, 'evidence_incomplete', 1)
$sql$) like '%Exact latest provider-held Nayax attempt is required%',
  'A held attempt from another case cannot be substituted');
select lives_ok($sql$
  insert into pg_temp.nayax_resolution_test_intents (intent_key, intent_id)
  select 'hold', (public.admin_prepare_refund_nayax_resolution_intent(
    'b1600000-0000-4000-8000-000000000001',
    'b1700000-0000-4000-8000-000000000001',
    'remain_on_hold', 'nayax_support_ticket', 'SUPPORT:HOLD-0001',
    null, 'evidence_incomplete', 1) ->> 'intentId')::uuid
$sql$, 'The exact mapped operator can prepare a bounded hold review');
reset role;

select ok((
  select intent.actor_user_id = 'b1000000-0000-4000-8000-000000000001'
    and intent.refund_case_id = 'b1600000-0000-4000-8000-000000000001'
    and intent.nayax_refund_attempt_id = 'b1700000-0000-4000-8000-000000000001'
    and intent.manager_mapping_version > 0
    and intent.manager_totp_enrollment_version = 1
    and intent.operator_version = 1
    and intent.attempt_evidence_hash ~ '^[a-f0-9]{64}$'
    and intent.expires_at <= intent.not_before + interval '2 minutes 5 seconds'
  from public.refund_nayax_resolution_intents intent
  where intent.id = (select intent_id from pg_temp.nayax_resolution_test_intents where intent_key = 'hold')
), 'Intent freezes actor, case, attempt, authority versions, evidence hash, and expiry');
select ok((
  select intent.evidence_reference_digest =
      public.refund_nayax_resolution_reference_digest('SUPPORT:HOLD-0001')
    and intent.evidence_reference_digest <> 'SUPPORT:HOLD-0001'
  from public.refund_nayax_resolution_intents intent
  where intent.id = (
    select intent_id from pg_temp.nayax_resolution_test_intents
    where intent_key = 'hold'
  )
), 'The immutable intent stores only a one-way evidence-reference digest');
select ok(
  (select count(*) = 0 from public.refund_case_messages where refund_case_id = 'b1600000-0000-4000-8000-000000000001')
  and (select count(*) = 0 from public.sales_adjustment_facts where refund_case_id = 'b1600000-0000-4000-8000-000000000001')
  and (select provider_outcome = 'unknown' and reconciliation_required
    from public.refund_case_nayax_refund_attempts where id = 'b1700000-0000-4000-8000-000000000001'),
  'Preparing evidence creates no customer, reporting, retry, or provider outcome side effect');

set local role authenticated;
select pg_temp.set_auth_claims(
  'b1000000-0000-4000-8000-000000000001', 'aal2',
  jsonb_build_array(jsonb_build_object('method', 'totp', 'timestamp',
    pg_temp.intent_totp_epoch((select intent_id from pg_temp.nayax_resolution_test_intents where intent_key = 'hold'), 10)))
);
select ok(
  public.admin_refund_nayax_resolution_factor_is_approved(
    (select intent_id from pg_temp.nayax_resolution_test_intents where intent_key = 'hold'), repeat('a', 64))
  and not public.admin_refund_nayax_resolution_factor_is_approved(
    (select intent_id from pg_temp.nayax_resolution_test_intents where intent_key = 'hold'), repeat('b', 64)),
  'Only the exact owner-approved factor binding is accepted');
select ok(pg_temp.capture_error(format($sql$
  select public.admin_consume_refund_nayax_resolution_intent(
    %L, 'b1600000-0000-4000-8000-000000000001', 'b1700000-0000-4000-8000-000000000001',
    'remain_on_hold', 'nayax_support_ticket', 'SUPPORT:HOLD-0001', null, 'evidence_incomplete', repeat('f', 64))
$sql$, (select intent_id from pg_temp.nayax_resolution_test_intents where intent_key = 'hold')))
  like '%authenticator verification proof is required%',
  'A generic AAL2 token cannot replace the trusted exact-factor proof');
reset role;

select set_config('request.jwt.claim.role', 'service_role', true);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select lives_ok($sql$
  insert into pg_temp.nayax_resolution_test_proofs (intent_key, proof)
  select 'hold', public.service_mark_refund_nayax_resolution_factor_verified(
    'b1000000-0000-4000-8000-000000000001',
    (select intent_id from pg_temp.nayax_resolution_test_intents where intent_key = 'hold'),
    repeat('a', 64)) ->> 'factorVerificationProof'
$sql$, 'The trusted service can mark the exact verified factor without resolving the case');

set local role authenticated;
select pg_temp.set_auth_claims(
  'b1000000-0000-4000-8000-000000000001', 'aal2',
  jsonb_build_array(jsonb_build_object('method', 'totp', 'timestamp',
    pg_temp.intent_totp_epoch((select intent_id from pg_temp.nayax_resolution_test_intents where intent_key = 'hold'), 10)))
);
select lives_ok($sql$
  insert into pg_temp.nayax_resolution_test_results (result_key, result)
  select 'hold', public.admin_consume_refund_nayax_resolution_intent(
    (select intent_id from pg_temp.nayax_resolution_test_intents where intent_key = 'hold'),
    'b1600000-0000-4000-8000-000000000001', 'b1700000-0000-4000-8000-000000000001',
    'remain_on_hold', 'nayax_support_ticket', 'SUPPORT:HOLD-0001', null, 'evidence_incomplete',
    (select proof from pg_temp.nayax_resolution_test_proofs where intent_key = 'hold'))
$sql$, 'A fresh exact TOTP proof records the immutable remain-on-hold result');
select ok((
  select not (result ->> 'resolved')::boolean
    and not (result ->> 'providerCallMade')::boolean
    and not (result ->> 'customerMessageCreated')::boolean
    and (result ->> 'payloadRedacted')::boolean
  from pg_temp.nayax_resolution_test_results where result_key = 'hold'
), 'The hold receipt explicitly proves zero provider and customer action');
reset role;

select ok((
  select refund_case.status = 'card_refund_pending'
    and refund_case.decision = 'approved'
    and refund_case.reporting_adjustment_id is null
    and refund_case.refund_completed_at is null
    and refund_case.nayax_refund_execution_status = 'ambiguous'
  from public.refund_cases refund_case
  where refund_case.id = 'b1600000-0000-4000-8000-000000000001'
), 'Remain-on-hold leaves the official case outcome byte-for-byte held');
select ok((
  select attempt.status = 'ambiguous'
    and attempt.provider_outcome = 'unknown'
    and attempt.reconciliation_required
    and attempt.support_resolution_id is null
  from public.refund_case_nayax_refund_attempts attempt
  where attempt.id = 'b1700000-0000-4000-8000-000000000001'
), 'Remain-on-hold leaves the provider attempt unresolved and unretried');
select ok((
  select resolution.prior_provider_outcome = 'unknown'
    and resolution.resolution_result = 'remain_on_hold'
    and resolution.evidence_reference_digest =
      public.refund_nayax_resolution_reference_digest('SUPPORT:HOLD-0001')
    and resolution.payload_redacted
  from public.refund_nayax_outcome_resolutions resolution
  where resolution.resolution_intent_id =
    (select intent_id from pg_temp.nayax_resolution_test_intents where intent_key = 'hold')
), 'Immutable audit preserves the prior provider fact and only a reference digest');
select ok(pg_temp.capture_error($sql$
  update public.refund_nayax_outcome_resolutions
  set reason_code = 'evidence_conflict'
  where resolution_intent_id =
    (select intent_id from pg_temp.nayax_resolution_test_intents where intent_key = 'hold')
$sql$) like '%resolution evidence is immutable%',
  'Even the database owner cannot rewrite a recorded resolution');
select set_config(
  'bloomjoy.nayax_support_resolution_id',
  (select id::text from public.refund_nayax_outcome_resolutions
    where resolution_intent_id =
      (select intent_id from pg_temp.nayax_resolution_test_intents where intent_key = 'hold')),
  true
);
select ok(pg_temp.capture_error($sql$
  update public.refund_cases
  set status = 'completed', refund_completed_at = statement_timestamp()
  where id = 'b1600000-0000-4000-8000-000000000001'
$sql$) like '%token-bound confirmed provider settlement%',
  'A session-local resolution ID cannot bypass the provider hold');

set local role authenticated;
select pg_temp.set_auth_claims(
  'b1000000-0000-4000-8000-000000000001', 'aal2',
  jsonb_build_array(jsonb_build_object('method', 'totp', 'timestamp',
    pg_temp.intent_totp_epoch((select intent_id from pg_temp.nayax_resolution_test_intents where intent_key = 'hold'), 11)))
);
select ok(pg_temp.capture_error(format($sql$
  select public.admin_consume_refund_nayax_resolution_intent(
    %L, 'b1600000-0000-4000-8000-000000000001', 'b1700000-0000-4000-8000-000000000001',
    'remain_on_hold', 'nayax_support_ticket', 'SUPPORT:HOLD-0001', null, 'evidence_incomplete', repeat('f', 64))
$sql$, (select intent_id from pg_temp.nayax_resolution_test_intents where intent_key = 'hold')))
  like '%already used%',
  'A consumed intent cannot be replayed');
reset role;

set local role authenticated;
select pg_temp.set_auth_claims('b1000000-0000-4000-8000-000000000001', 'aal1', '[]'::jsonb);
insert into pg_temp.nayax_resolution_test_intents (intent_key, intent_id)
select 'retry', (public.admin_prepare_refund_nayax_resolution_intent(
  'b1600000-0000-4000-8000-000000000002', 'b1700000-0000-4000-8000-000000000002',
  'provider_confirmed_retry_safe', 'nayax_dtm_transaction', 'DTM:RETRY-SAFE-0002',
  null, 'nayax_dtm_not_refunded', 1) ->> 'intentId')::uuid;
reset role;
select lives_ok($sql$select 1$sql$, 'Retry-safe intent prepares without calling the provider');

select set_config('request.jwt.claim.role', 'service_role', true);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
insert into pg_temp.nayax_resolution_test_proofs (intent_key, proof)
select 'retry', public.service_mark_refund_nayax_resolution_factor_verified(
  'b1000000-0000-4000-8000-000000000001',
  (select intent_id from pg_temp.nayax_resolution_test_intents where intent_key = 'retry'),
  repeat('a', 64)) ->> 'factorVerificationProof';
select lives_ok($sql$select 1$sql$, 'Retry-safe factor proof is marked once');

set local role authenticated;
select pg_temp.set_auth_claims(
  'b1000000-0000-4000-8000-000000000001', 'aal2',
  jsonb_build_array(jsonb_build_object('method', 'totp', 'timestamp',
    pg_temp.intent_totp_epoch((select intent_id from pg_temp.nayax_resolution_test_intents where intent_key = 'retry'), 12)))
);
insert into pg_temp.nayax_resolution_test_results (result_key, result)
select 'retry', public.admin_consume_refund_nayax_resolution_intent(
  (select intent_id from pg_temp.nayax_resolution_test_intents where intent_key = 'retry'),
  'b1600000-0000-4000-8000-000000000002', 'b1700000-0000-4000-8000-000000000002',
  'provider_confirmed_retry_safe', 'nayax_dtm_transaction', 'DTM:RETRY-SAFE-0002',
  null, 'nayax_dtm_not_refunded',
  (select proof from pg_temp.nayax_resolution_test_proofs where intent_key = 'retry'));
select lives_ok($sql$select 1$sql$, 'Retry-safe consumes one exact fresh TOTP without a provider retry');
reset role;

select ok((
  select refund_case.nayax_refund_execution_status = 'not_requested'
    and refund_case.nayax_match_execution_eligible
    and refund_case.nayax_refund_attempt_generation = 1
    and refund_case.status = 'card_refund_pending'
    and refund_case.refund_completed_at is null
  from public.refund_cases refund_case where refund_case.id = 'b1600000-0000-4000-8000-000000000002'
), 'Retry-safe advances a fresh attempt generation and returns the case to separate review');
select ok((
  select attempt.status = 'declined'
    and attempt.provider_outcome = 'rejected'
    and not attempt.reconciliation_required
    and attempt.support_resolution_result = 'provider_confirmed_retry_safe'
  from public.refund_case_nayax_refund_attempts attempt
  where attempt.id = 'b1700000-0000-4000-8000-000000000002'
), 'Retry-safe preserves the rejected attempt and records why reconciliation closed');
select ok(
  (select not (result ->> 'providerCallMade')::boolean
    and not (result ->> 'customerMessageCreated')::boolean
    and (result ->> 'retryReadyForFreshReview')::boolean
   from pg_temp.nayax_resolution_test_results where result_key = 'retry')
  and (select count(*) = 0 from public.refund_case_messages where refund_case_id = 'b1600000-0000-4000-8000-000000000002')
  and (select count(*) = 0 from public.sales_adjustment_facts where refund_case_id = 'b1600000-0000-4000-8000-000000000002'),
  'Retry-safe proves no provider call, customer message, or completion adjustment');

set local role authenticated;
select pg_temp.set_auth_claims(
  'b1000000-0000-4000-8000-000000000001', 'aal1',
  jsonb_build_array(jsonb_build_object(
    'method', 'password',
    'timestamp', extract(epoch from statement_timestamp())
  ))
);
insert into pg_temp.nayax_resolution_test_results (result_key, result)
select 'manager-session-retry-safe',
  public.admin_resolve_refund_nayax_outcome_manager_session(
    'b1600000-0000-4000-8000-000000000011',
    'b1700000-0000-4000-8000-000000000011',
    'provider_confirmed_retry_safe', 'nayax_dtm_transaction',
    'DTM:MANAGER-RETRY-SAFE-0011', null, 'nayax_dtm_not_refunded',
    (select official_action_version from public.refund_cases
      where id = 'b1600000-0000-4000-8000-000000000011')
  );
reset role;

select ok((
  select (result ->> 'retryReadyForFreshReview')::boolean
    and not (result ->> 'providerCallMade')::boolean
    and not (result ->> 'customerMessageCreated')::boolean
  from pg_temp.nayax_resolution_test_results
  where result_key = 'manager-session-retry-safe'
), 'Manager-session evidence releases the exact case without a provider call or customer message');
select ok((
  select attempt.status = 'ambiguous'
    and attempt.provider_outcome = 'unknown'
    and attempt.reconciliation_required is false
    and attempt.support_resolution_result = 'provider_confirmed_retry_safe'
  from public.refund_case_nayax_refund_attempts attempt
  where attempt.id = 'b1700000-0000-4000-8000-000000000011'
), 'The release preserves the immutable ambiguous provider facts and records the authoritative resolution separately');
select ok(
  public.refund_nayax_retry_safe_resolution_is_current(
    'b1700000-0000-4000-8000-000000000011'
  )
  and public.refund_nayax_retry_safe_resolution_is_historical(
    'b1700000-0000-4000-8000-000000000011'
  )
  and not public.refund_nayax_retry_safe_resolution_is_current(
    '00000000-0000-4000-8000-000000000000'
  ),
  'The exact linked current-generation resolution is both active and historical');
select ok(
  not (public.refund_nayax_account_execution_hold(
    'RESOLUTION-RETRY-ACCOUNT'
  ) ->> 'blocked')::boolean
  and not (public.refund_nayax_account_execution_hold(
    'RESOLUTION-ACCOUNT'
  ) ->> 'blocked')::boolean,
  'An unresolved transaction never pauses unrelated refunds on its account');
select ok((
  select lifecycle ->> 'stage' = 'transaction_confirmed'
    and (lifecycle ->> 'safeRetryEligible')::boolean
    and not (lifecycle #>> '{operations,required}')::boolean
  from (select public.refund_lifecycle_contract(
    'b1600000-0000-4000-8000-000000000011'
  ) lifecycle) checked
), 'The manager lifecycle returns the resolved case to one Refund action');
select ok((
  select (readiness ->> 'canIssueCardRefund')::boolean
    and not (readiness ->> 'accountCircuitBreakerActive')::boolean
  from (select public.refund_case_nayax_manager_readiness(
    'b1000000-0000-4000-8000-000000000001',
    'b1600000-0000-4000-8000-000000000011'
  ) readiness) checked
), 'Database readiness reopens only the exact resolved manager case');

select ok(
  not has_function_privilege(
    'authenticated',
    'public.refund_nayax_retry_safe_resolution_is_historical(uuid)',
    'execute'
  )
  and not has_function_privilege(
    'service_role',
    'public.refund_nayax_retry_safe_resolution_is_historical(uuid)',
    'execute'
  ),
  'The historical resolution predicate remains private to trusted database functions');

-- Projection-only fixtures model later immutable generations without invoking
-- provider or customer-delivery code. The generation guard is bypassed only
-- inside this rolled-back pgTAP transaction; production generation changes
-- still require the exact retry-safe resolver.
set local session_replication_role = replica;
update public.refund_cases
set nayax_refund_attempt_generation = 2
where id = 'b1600000-0000-4000-8000-000000000011';
set local session_replication_role = origin;

select ok(
  not public.refund_nayax_retry_safe_resolution_is_current(
    'b1700000-0000-4000-8000-000000000011'
  )
  and public.refund_nayax_retry_safe_resolution_is_historical(
    'b1700000-0000-4000-8000-000000000011'
  ),
  'A generation 0 to 1 resolution stays historical after generation 2 while no longer driving the active lifecycle');

select ok((
  select not (hold ->> 'blocked')::boolean
    and (hold ->> 'unresolvedCount')::integer = 0
    and hold -> 'oldestUnresolvedAt' = 'null'::jsonb
  from (select public.refund_nayax_account_execution_hold(
    'RESOLUTION-RETRY-ACCOUNT'
  ) hold) checked
), 'A superseded resolved generation cannot re-enter the account breaker');

select ok(
  (select count(*) = 1
    from public.refund_case_nayax_refund_attempts
    where refund_case_id = 'b1600000-0000-4000-8000-000000000011')
  and (select count(*) = 1
    from public.refund_nayax_outcome_resolutions
    where refund_case_id = 'b1600000-0000-4000-8000-000000000011')
  and (select count(*) = 0
    from public.refund_case_messages
    where refund_case_id = 'b1600000-0000-4000-8000-000000000011')
  and (select count(*) = 0
    from public.sales_adjustment_facts
    where refund_case_id = 'b1600000-0000-4000-8000-000000000011'),
  'The projection repair preserves append-only evidence and creates no attempt, message, or reporting side effect');

insert into public.refund_case_nayax_refund_attempts (
  id, refund_case_id, actor_user_id, execution_mode, status, idempotency_key,
  amount_cents, transaction_id_present, site_id_present,
  machine_auth_time_present, request_fingerprint, currency_code,
  provider_outcome, provider_outcome_recorded_at, reconciliation_required,
  sanitized_request, sanitized_response, created_at
) values (
  'b1700000-0000-4000-8000-000000000012',
  'b1600000-0000-4000-8000-000000000011',
  'b1000000-0000-4000-8000-000000000001',
  'request_and_approve', 'ambiguous', 'resolution-generation-2-current',
  711, true, true, true, repeat('c', 64), 'USD', 'unknown',
  statement_timestamp() - interval '1 minute', true,
  '{"payload_redacted":true}'::jsonb,
  '{"payload_redacted":true}'::jsonb,
  statement_timestamp() - interval '2 minutes'
);

select ok((
  select not (hold ->> 'blocked')::boolean
    and (hold ->> 'unresolvedCount')::integer = 1
    and (hold ->> 'legacyHoldRetired')::boolean
  from (select public.refund_nayax_account_execution_hold(
    'RESOLUTION-RETRY-ACCOUNT'
  ) hold) checked
), 'An unresolved current transaction remains visible without blocking its account');

select ok(
  not public.refund_nayax_retry_safe_resolution_is_historical(
    'b1700000-0000-4000-8000-000000000012'
  ),
  'An unresolved attempt cannot borrow a retry-safe resolution from an older generation');

-- Advance once more and model a terminal newer attempt. The account projection
-- must remain replay-stable even though the first resolution is now two
-- generations behind and the case no longer has a current no-refund shape.
set local session_replication_role = replica;
update public.refund_case_nayax_refund_attempts
set
  status = 'succeeded',
  provider_outcome = 'success',
  reconciliation_required = false
where id = 'b1700000-0000-4000-8000-000000000012';
update public.refund_cases
set
  nayax_refund_attempt_generation = 3,
  nayax_refund_execution_status = 'approved'
where id = 'b1600000-0000-4000-8000-000000000011';
set local session_replication_role = origin;

select ok(
  public.refund_nayax_retry_safe_resolution_is_historical(
    'b1700000-0000-4000-8000-000000000011'
  )
  and not (public.refund_nayax_account_execution_hold(
    'RESOLUTION-RETRY-ACCOUNT'
  ) ->> 'blocked')::boolean,
  'Three-generation and newer-terminal replay cannot revive the oldest resolved attempt');

select ok((
  with simulated_clock as (
    select '2026-08-14 00:05:00+00'::timestamptz as now_at
  ), fixture_evidence as (
    select
      now_at,
      (
        date_trunc('day', now_at at time zone 'UTC')
        - interval '1 day'
        + interval '15 minutes'
      ) at time zone 'UTC' as occurred_at
    from simulated_clock
  )
  select
    occurred_at <= now_at + interval '30 seconds'
    and (occurred_at at time zone 'UTC')::date <>
      (occurred_at at time zone 'America/Los_Angeles')::date
  from fixture_evidence
), 'Previous-day UTC evidence stays in the past and crosses the LA date at 00:05 UTC');

update public.refund_case_nayax_refund_attempts
set
  created_at = (
    date_trunc('day', statement_timestamp() at time zone 'UTC')
    - interval '1 day' + interval '15 minutes'
  ) at time zone 'UTC' - interval '30 minutes',
  provider_outcome_recorded_at = (
    date_trunc('day', statement_timestamp() at time zone 'UTC')
    - interval '1 day' + interval '15 minutes'
  ) at time zone 'UTC'
where id = 'b1700000-0000-4000-8000-000000000003';
set local role authenticated;
select pg_temp.set_auth_claims('b1000000-0000-4000-8000-000000000001', 'aal1', '[]'::jsonb);
with evidence as (
  select (
    date_trunc('day', statement_timestamp() at time zone 'UTC')
    - interval '1 day' + interval '15 minutes'
  ) at time zone 'UTC' as occurred_at
)
insert into pg_temp.nayax_resolution_test_intents (intent_key, intent_id, evidence_occurred_at)
select 'success', (public.admin_prepare_refund_nayax_resolution_intent(
  'b1600000-0000-4000-8000-000000000003', 'b1700000-0000-4000-8000-000000000003',
  'provider_confirmed_success', 'nayax_dtm_transaction', 'DTM:NAYAX-123456789',
  evidence.occurred_at, 'nayax_dtm_settled', 1) ->> 'intentId')::uuid,
  evidence.occurred_at
from evidence;
reset role;
select lives_ok($sql$select 1$sql$, 'Provider-success intent freezes exact settled evidence');

select set_config('request.jwt.claim.role', 'service_role', true);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
insert into pg_temp.nayax_resolution_test_proofs (intent_key, proof)
select 'success', public.service_mark_refund_nayax_resolution_factor_verified(
  'b1000000-0000-4000-8000-000000000001',
  (select intent_id from pg_temp.nayax_resolution_test_intents where intent_key = 'success'),
  repeat('a', 64)) ->> 'factorVerificationProof';
select lives_ok($sql$select 1$sql$, 'Provider-success factor proof is marked once');

set local role authenticated;
select pg_temp.set_auth_claims(
  'b1000000-0000-4000-8000-000000000001', 'aal2',
  jsonb_build_array(jsonb_build_object('method', 'totp', 'timestamp',
    pg_temp.intent_totp_epoch((select intent_id from pg_temp.nayax_resolution_test_intents where intent_key = 'success'), 14)))
);
insert into pg_temp.nayax_resolution_test_results (result_key, result)
select 'success', public.admin_consume_refund_nayax_resolution_intent(
  (select intent_id from pg_temp.nayax_resolution_test_intents where intent_key = 'success'),
  'b1600000-0000-4000-8000-000000000003', 'b1700000-0000-4000-8000-000000000003',
  'provider_confirmed_success', 'nayax_dtm_transaction', 'DTM:NAYAX-123456789',
  (select evidence_occurred_at from pg_temp.nayax_resolution_test_intents where intent_key = 'success'),
  'nayax_dtm_settled',
  (select proof from pg_temp.nayax_resolution_test_proofs where intent_key = 'success'));
select lives_ok($sql$select 1$sql$, 'Provider-success commits the payment fact after fresh exact TOTP');
reset role;

select ok((
  select refund_case.status = 'completed'
    and refund_case.decision = 'approved'
    and refund_case.refund_completed_by = 'b1000000-0000-4000-8000-000000000001'
    and refund_case.refund_completed_at is not null
    and refund_case.reporting_adjustment_id is not null
    and refund_case.nayax_refund_execution_status = 'approved'
  from public.refund_cases refund_case where refund_case.id = 'b1600000-0000-4000-8000-000000000003'
), 'Provider-success atomically commits the case and reporting adjustment');
select ok((
  select refund_case.refund_completed_at = resolution.evidence_occurred_at
    and refund_case.refund_completed_at = attempt.provider_outcome_recorded_at
    and adjustment.adjustment_date = (resolution.evidence_occurred_at at time zone 'UTC')::date
    and adjustment.adjustment_date <>
      (resolution.evidence_occurred_at at time zone 'America/Los_Angeles')::date
  from public.refund_cases refund_case
  join public.refund_nayax_outcome_resolutions resolution
    on resolution.refund_case_id = refund_case.id
  join public.refund_case_nayax_refund_attempts attempt
    on attempt.id = resolution.nayax_refund_attempt_id
  join public.sales_adjustment_facts adjustment
    on adjustment.id = refund_case.reporting_adjustment_id
  where refund_case.id = 'b1600000-0000-4000-8000-000000000003'
), 'Customer and reporting dates preserve the UTC action time across a local-date boundary');
select ok((
  select attempt.status = 'succeeded'
    and attempt.provider_outcome = 'success'
    and attempt.support_resolution_result = 'provider_confirmed_success'
    and attempt.reporting_adjustment_id is not null
    and attempt.case_finalization_committed_at is not null
    and attempt.sanitized_response ->> 'initial_provider_outcome' = 'timeout'
  from public.refund_case_nayax_refund_attempts attempt
  where attempt.id = 'b1700000-0000-4000-8000-000000000003'
), 'Effective success remains bound to immutable prior timeout and support provenance');
select ok(
  (select count(*) = 1 from public.sales_adjustment_facts where refund_case_id = 'b1600000-0000-4000-8000-000000000003')
  and (select count(*) = 1 from public.refund_case_messages
    where refund_case_id = 'b1600000-0000-4000-8000-000000000003'
      and message_type = 'completed'
      and status = 'pending'
      and template_version = 'refund_nayax_completion_v2'
      and nayax_refund_attempt_id = 'b1700000-0000-4000-8000-000000000003')
  and (select not (result ->> 'providerCallMade')::boolean
    and (result ->> 'customerMessageCreated')::boolean
    and (result ->> 'customerCompletionAvailable')::boolean
   from pg_temp.nayax_resolution_test_results where result_key = 'success'),
  'Success atomically binds one pending original-thread completion without calling the provider');

select set_config('request.jwt.claim.role', 'service_role', true);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
savepoint exact_sent_recovery;
update public.refund_case_nayax_refund_attempts
set completion_delivery_attempted_at = statement_timestamp() - interval '6 minutes'
where id = 'b1700000-0000-4000-8000-000000000003';
insert into public.refund_gmail_messages (
  gmail_thread_id, refund_case_id, refund_case_message_id, operation_key,
  provider_message_id, direction, message_kind, status, sender_email,
  recipient_email, recipient_cc_emails, recipient_cc_count,
  recipient_manager_overlap, recipient_manager_count,
  recipient_resolution_status, delivery_kind, participant_role,
  participant_trust, subject, plain_body, sent_at, received_at,
  retention_expires_at
)
select
  attempt.completion_gmail_thread_id,
  attempt.refund_case_id,
  attempt.completion_message_id,
  'refund-case-message:' || attempt.completion_message_id::text,
  'nayax-completion-sent-evidence',
  'outbound', 'message', 'sent', 'info@bloomjoysweets.com',
  message.recipient_email, array['resolution-manager@example.test'], 1,
  false, 1, 'resolved',
  'manual', 'mailbox', 'verified', message.subject, message.body,
  statement_timestamp() - interval '6 minutes',
  statement_timestamp() - interval '6 minutes',
  statement_timestamp() + interval '180 days'
from public.refund_case_nayax_refund_attempts attempt
join public.refund_case_messages message on message.id = attempt.completion_message_id
where attempt.id = 'b1700000-0000-4000-8000-000000000003';
select lives_ok($sql$
  select public.service_recover_stale_nayax_completion(
    'resolution-test-executor',
    'b1600000-0000-4000-8000-000000000003',
    (select completion_message_id
      from public.refund_case_nayax_refund_attempts
      where id = 'b1700000-0000-4000-8000-000000000003')
  )
$sql$, 'Exact sent Gmail evidence settles an interrupted completion without another send');
select ok((
  select attempt.completion_delivery_status = 'sent'
    and message.status = 'sent'
    and message.error_message is null
  from public.refund_case_nayax_refund_attempts attempt
  join public.refund_case_messages message on message.id = attempt.completion_message_id
  where attempt.id = 'b1700000-0000-4000-8000-000000000003'
), 'Sent-evidence recovery durably reconciles the exact attempt and message');
rollback to savepoint exact_sent_recovery;
savepoint mapping_drift_sent_recovery;
update public.refund_case_nayax_refund_attempts
set completion_delivery_attempted_at = statement_timestamp() - interval '6 minutes'
where id = 'b1700000-0000-4000-8000-000000000003';
insert into public.refund_gmail_messages (
  gmail_thread_id, refund_case_id, refund_case_message_id, operation_key,
  provider_message_id, direction, message_kind, status, sender_email,
  recipient_email, recipient_cc_emails, recipient_cc_count,
  recipient_manager_overlap, recipient_manager_count,
  recipient_resolution_status, delivery_kind, participant_role,
  participant_trust, subject, plain_body, sent_at, received_at,
  retention_expires_at
)
select
  attempt.completion_gmail_thread_id,
  attempt.refund_case_id,
  attempt.completion_message_id,
  'refund-case-message:' || attempt.completion_message_id::text,
  'nayax-completion-mapping-drift-evidence',
  'outbound', 'message', 'sent', 'info@bloomjoysweets.com',
  message.recipient_email, array['resolution-manager@example.test'], 1,
  false, 1,
  'resolved', 'manual', 'mailbox', 'verified', message.subject, message.body,
  statement_timestamp() - interval '6 minutes',
  statement_timestamp() - interval '6 minutes',
  statement_timestamp() + interval '180 days'
from public.refund_case_nayax_refund_attempts attempt
join public.refund_case_messages message on message.id = attempt.completion_message_id
where attempt.id = 'b1700000-0000-4000-8000-000000000003';
update public.reporting_machine_refund_managers
set manager_email = 'replacement-manager@example.test'
where id = 'b1400000-0000-4000-8000-000000000001';
select lives_ok($sql$
  select public.service_recover_stale_nayax_completion(
    'resolution-test-executor',
    'b1600000-0000-4000-8000-000000000003',
    (select completion_message_id
      from public.refund_case_nayax_refund_attempts
      where id = 'b1700000-0000-4000-8000-000000000003')
  )
$sql$, 'Sent evidence with later manager-route drift becomes reconciliation-only without another send');
select ok((
  select attempt.completion_delivery_status = 'delivery_unknown'
    and message.status = 'pending'
    and message.error_message = 'gmail_completion_delivery_unknown'
  from public.refund_case_nayax_refund_attempts attempt
  join public.refund_case_messages message on message.id = attempt.completion_message_id
  where attempt.id = 'b1700000-0000-4000-8000-000000000003'
), 'Manager-route drift cannot strand sent evidence or permit a customer-message retry');
rollback to savepoint mapping_drift_sent_recovery;
select lives_ok($sql$
  select public.service_finish_nayax_refund_completion(
    'resolution-test-executor',
    'b1700000-0000-4000-8000-000000000003',
    'failed'
  )
$sql$, 'A safely failed first completion attempt is recorded without changing payment facts');
select lives_ok($sql$
  select public.service_prepare_nayax_completion_retry(
    'resolution-test-executor',
    (select id from public.refund_case_messages
      where refund_case_id = 'b1600000-0000-4000-8000-000000000003'
        and nayax_refund_attempt_id = 'b1700000-0000-4000-8000-000000000003')
  )
$sql$, 'The exact safely failed completion can be reopened once for original-thread delivery');
select ok((
  select attempt.completion_delivery_status = 'pending'
    and attempt.completion_delivery_retry_count = 1
    and message.status = 'pending'
    and message.error_message is null
  from public.refund_case_nayax_refund_attempts attempt
  join public.refund_case_messages message
    on message.id = attempt.completion_message_id
  where attempt.id = 'b1700000-0000-4000-8000-000000000003'
), 'The one retry reuses the exact attempt-bound message and never creates a second payment or customer record');
select lives_ok($sql$
  select public.service_finish_nayax_refund_completion(
    'resolution-test-executor',
    'b1700000-0000-4000-8000-000000000003',
    'failed'
  )
$sql$, 'A failed bounded retry is durably marked exhausted');
select ok(pg_temp.capture_error($sql$
  select public.service_prepare_nayax_completion_retry(
    'resolution-test-executor',
    (select id from public.refund_case_messages
      where refund_case_id = 'b1600000-0000-4000-8000-000000000003'
        and nayax_refund_attempt_id = 'b1700000-0000-4000-8000-000000000003')
  )
$sql$) like '%One safely failed Nayax completion is required%'
  and (select message.error_message = 'gmail_completion_retry_exhausted'
    from public.refund_case_messages message
    where message.refund_case_id = 'b1600000-0000-4000-8000-000000000003'
      and message.nayax_refund_attempt_id = 'b1700000-0000-4000-8000-000000000003'),
  'A second customer-completion retry is impossible');

set local role authenticated;
select pg_temp.set_auth_claims('b1000000-0000-4000-8000-000000000001', 'aal1', '[]'::jsonb);
with evidence as (
  select statement_timestamp() - interval '5 minutes' as occurred_at
)
insert into pg_temp.nayax_resolution_test_intents (intent_key, intent_id, evidence_occurred_at)
select 'manual', (public.admin_prepare_refund_nayax_resolution_intent(
  'b1600000-0000-4000-8000-000000000004', 'b1700000-0000-4000-8000-000000000004',
  'documented_manual_completion', 'documented_manual_refund', 'MANUAL:NAYAX-0004',
  evidence.occurred_at, 'manual_nayax_completion', 1) ->> 'intentId')::uuid,
  evidence.occurred_at
from evidence;
reset role;
select lives_ok($sql$select 1$sql$, 'Manual-completion intent accepts only the documented manual evidence shape');

select set_config('request.jwt.claim.role', 'service_role', true);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
insert into pg_temp.nayax_resolution_test_proofs (intent_key, proof)
select 'manual', public.service_mark_refund_nayax_resolution_factor_verified(
  'b1000000-0000-4000-8000-000000000001',
  (select intent_id from pg_temp.nayax_resolution_test_intents where intent_key = 'manual'),
  repeat('a', 64)) ->> 'factorVerificationProof';
select lives_ok($sql$select 1$sql$, 'Manual-completion factor proof is marked once');

set local role authenticated;
select pg_temp.set_auth_claims(
  'b1000000-0000-4000-8000-000000000001', 'aal2',
  jsonb_build_array(jsonb_build_object('method', 'totp', 'timestamp',
    pg_temp.intent_totp_epoch((select intent_id from pg_temp.nayax_resolution_test_intents where intent_key = 'manual'), 16)))
);
insert into pg_temp.nayax_resolution_test_results (result_key, result)
select 'manual', public.admin_consume_refund_nayax_resolution_intent(
  (select intent_id from pg_temp.nayax_resolution_test_intents where intent_key = 'manual'),
  'b1600000-0000-4000-8000-000000000004', 'b1700000-0000-4000-8000-000000000004',
  'documented_manual_completion', 'documented_manual_refund', 'MANUAL:NAYAX-0004',
  (select evidence_occurred_at from pg_temp.nayax_resolution_test_intents where intent_key = 'manual'),
  'manual_nayax_completion',
  (select proof from pg_temp.nayax_resolution_test_proofs where intent_key = 'manual'));
select lives_ok($sql$select 1$sql$, 'Documented manual completion commits after fresh exact TOTP');
reset role;

select ok((
  select refund_case.status = 'completed'
    and refund_case.manual_refund_reference = 'Support evidence recorded'
    and refund_case.reporting_adjustment_id is not null
  from public.refund_cases refund_case where refund_case.id = 'b1600000-0000-4000-8000-000000000004'
), 'Documented manual completion commits a redacted marker and one reporting fact');
select ok((
  select resolution.resolution_result = 'documented_manual_completion'
    and resolution.prior_provider_outcome = 'rejected'
    and resolution.evidence_type = 'documented_manual_refund'
    and resolution.reason_code = 'manual_nayax_completion'
  from public.refund_nayax_outcome_resolutions resolution
  where resolution.nayax_refund_attempt_id = 'b1700000-0000-4000-8000-000000000004'
), 'Manual completion preserves the original rejected outcome and exact evidence classification');
select ok((
  select count(*) = 1
  from public.refund_case_messages message
  where message.refund_case_id = 'b1600000-0000-4000-8000-000000000004'
    and message.message_type = 'completed'
    and message.status = 'pending'
    and message.template_version = 'refund_nayax_completion_v2'
    and message.nayax_refund_attempt_id = 'b1700000-0000-4000-8000-000000000004'
), 'Manual completion also binds one pending original-thread customer reply atomically');

update public.refund_case_nayax_refund_attempts
set completion_delivery_attempted_at = statement_timestamp() - interval '6 minutes'
where id = 'b1700000-0000-4000-8000-000000000004';
select throws_ok($sql$
  select public.service_recover_stale_nayax_completion(
    'resolution-test-executor',
    'b1600000-0000-4000-8000-000000000003',
    (select completion_message_id
      from public.refund_case_nayax_refund_attempts
      where id = 'b1700000-0000-4000-8000-000000000004')
  )
$sql$, 'P0001', 'One exact pending Nayax completion is required',
  'Recovery refuses a message that is not bound to the exact authorized case');
select is((
  select attempt.completion_delivery_status
  from public.refund_case_nayax_refund_attempts attempt
  where attempt.id = 'b1700000-0000-4000-8000-000000000004'
), 'pending', 'Wrong-case recovery leaves the exact completion pending and unchanged');
select lives_ok($sql$
  select public.service_recover_stale_nayax_completion(
    'resolution-test-executor',
    'b1600000-0000-4000-8000-000000000004',
    (select completion_message_id
      from public.refund_case_nayax_refund_attempts
      where id = 'b1700000-0000-4000-8000-000000000004')
  )
$sql$, 'A stale completion with no Gmail claim is proven safe without sending');
select ok((
  select attempt.completion_delivery_status = 'failed'
    and attempt.completion_delivery_retry_count = 0
    and message.status = 'failed'
    and message.error_message = 'gmail_completion_failed'
  from public.refund_case_nayax_refund_attempts attempt
  join public.refund_case_messages message on message.id = attempt.completion_message_id
  where attempt.id = 'b1700000-0000-4000-8000-000000000004'
), 'Pre-claim interruption enters only the one bounded customer-message retry path');
select lives_ok($sql$
  select public.service_prepare_nayax_completion_retry(
    'resolution-test-executor',
    (select completion_message_id
      from public.refund_case_nayax_refund_attempts
      where id = 'b1700000-0000-4000-8000-000000000004')
  )
$sql$, 'The recovered pre-claim interruption can prepare its exact one retry');

insert into public.refund_gmail_messages (
  gmail_thread_id, refund_case_id, refund_case_message_id, operation_key,
  direction, message_kind, status, sender_email, recipient_email,
  recipient_cc_emails, recipient_cc_count, recipient_resolution_status,
  delivery_kind, participant_role, participant_trust, subject, plain_body,
  received_at, retention_expires_at
)
select
  attempt.completion_gmail_thread_id,
  attempt.refund_case_id,
  attempt.completion_message_id,
  'refund-case-message:' || attempt.completion_message_id::text,
  'outbound', 'message', 'pending_send', 'info@bloomjoysweets.com',
  message.recipient_email, array['manager@example.test'], 1, 'resolved',
  'manual', 'mailbox', 'verified', message.subject, message.body,
  statement_timestamp() - interval '6 minutes',
  statement_timestamp() + interval '180 days'
from public.refund_case_nayax_refund_attempts attempt
join public.refund_case_messages message on message.id = attempt.completion_message_id
where attempt.id = 'b1700000-0000-4000-8000-000000000004';
update public.refund_case_nayax_refund_attempts
set completion_delivery_attempted_at = statement_timestamp() - interval '6 minutes'
where id = 'b1700000-0000-4000-8000-000000000004';
select lives_ok($sql$
  select public.service_recover_stale_nayax_completion(
    'resolution-test-executor',
    'b1600000-0000-4000-8000-000000000004',
    (select completion_message_id
      from public.refund_case_nayax_refund_attempts
      where id = 'b1700000-0000-4000-8000-000000000004')
  )
$sql$, 'A stale completion with an unconfirmed Gmail claim becomes reconciliation-only');
select ok((
  select attempt.completion_delivery_status = 'delivery_unknown'
    and attempt.completion_delivery_retry_count = 1
    and message.status = 'pending'
    and message.error_message = 'gmail_completion_delivery_unknown'
  from public.refund_case_nayax_refund_attempts attempt
  join public.refund_case_messages message on message.id = attempt.completion_message_id
  where attempt.id = 'b1700000-0000-4000-8000-000000000004'
), 'A possibly delivered retry cannot become a second customer send');
select ok(pg_temp.capture_error($sql$
  select public.service_prepare_nayax_completion_retry(
    'resolution-test-executor',
    (select completion_message_id
      from public.refund_case_nayax_refund_attempts
      where id = 'b1700000-0000-4000-8000-000000000004')
  )
$sql$) like '%One safely failed Nayax completion is required%',
  'Delivery-unknown interruption recovery cannot be retried');
select ok(pg_temp.capture_error($sql$
  insert into public.refund_case_messages (
    refund_case_id, message_type, status, recipient_email, subject, body,
    template_key, created_by, content_source, delivery_kind, requested_fields
  ) values (
    'b1600000-0000-4000-8000-000000000004', 'status_update', 'pending',
    'customer4@example.test', 'Generic bypass', 'Generic bypass',
    'refund_status_update_editable_v1', 'b1000000-0000-4000-8000-000000000001',
    'manager_authored', 'manual', '{}'::text[]
  )
$sql$) like '%Unresolved Nayax completion blocks every other customer message%',
  'A direct generic customer-message insert cannot bypass delivery-unknown reconciliation');
select is((select count(*)::integer from public.refund_case_messages
  where refund_case_id = 'b1600000-0000-4000-8000-000000000004'
    and template_version is distinct from 'refund_nayax_completion_v2'), 0,
  'The blocked generic path creates no second customer-message row');
select set_config('request.jwt.claim.role', 'service_role', true);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select is(
  public.service_refund_nayax_completion_message_lane_open(
    'b1600000-0000-4000-8000-000000000004'
  ),
  false,
  'The Edge pre-insert lane probe reports the unresolved completion as closed'
);
select ok(not has_function_privilege(
    'authenticated',
    'public.service_refund_nayax_completion_message_lane_open(uuid)',
    'execute'
  ),
  'Only the service role can read the generic-message lane preflight'
);
select set_config('request.jwt.claim.role', 'service_role', true);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select is((select count(*)::integer from public.refund_case_messages
  where refund_case_id in (
    'b1600000-0000-4000-8000-000000000001',
    'b1600000-0000-4000-8000-000000000002',
    'b1600000-0000-4000-8000-000000000003',
    'b1600000-0000-4000-8000-000000000004'
  )), 2, 'Only the two completed outcomes create one exact customer message each');
select is((select count(*)::integer from public.refund_case_nayax_refund_attempts
  where refund_case_id in (
    'b1600000-0000-4000-8000-000000000001',
    'b1600000-0000-4000-8000-000000000002',
    'b1600000-0000-4000-8000-000000000003',
    'b1600000-0000-4000-8000-000000000004'
  )), 4, 'Resolution never creates or retries a provider attempt');
select ok(not exists (
  select 1
  from public.refund_case_events event
  where event.refund_case_id in (
    'b1600000-0000-4000-8000-000000000001',
    'b1600000-0000-4000-8000-000000000002',
    'b1600000-0000-4000-8000-000000000003',
    'b1600000-0000-4000-8000-000000000004'
  )
    and event.metadata::text like '%SUPPORT:%'
), 'Audit events remain aggregate/redacted and never copy evidence references');

create or replace function public.refund_official_actions_enabled()
returns boolean
language sql
immutable
set search_path = public
as $$ select true; $$;

set local role authenticated;
select pg_temp.set_auth_claims(
  'b1000000-0000-4000-8000-000000000001',
  'aal1',
  jsonb_build_array(jsonb_build_object(
    'method', 'password',
    'timestamp', extract(epoch from statement_timestamp())
  ))
);
insert into pg_temp.nayax_resolution_test_intents (
  intent_key,
  intent_id,
  evidence_occurred_at
)
select
  'retry-step-up',
  (public.admin_prepare_refund_action_step_up_intent(
    'b1600000-0000-4000-8000-000000000002',
    'nayax_execute',
    'nayax-card-refund',
    (select official_action_version
      from public.refund_cases
      where id = 'b1600000-0000-4000-8000-000000000002'),
    'card_refund_pending',
    'approved',
    null,
    null,
    null,
    702,
    null,
    null,
    false,
    null,
    null
  ) ->> 'intentId')::uuid,
  null;
reset role;
select ok((
  select
    refund_case.nayax_refund_attempt_generation = 1
    and intent.expected_case_version = refund_case.official_action_version
    and intent.nayax_execution_evidence_hash =
      public.refund_nayax_execution_evidence_hash(refund_case, machine)
  from public.refund_manager_action_step_up_intents intent
  join public.refund_cases refund_case
    on refund_case.id = intent.refund_case_id
  join public.reporting_machines machine
    on machine.id = refund_case.reporting_machine_id
  where intent.id = (
    select intent_id
    from pg_temp.nayax_resolution_test_intents
    where intent_key = 'retry-step-up'
  )
), 'Retry-safe returns through the real manager step-up preparation path with generation one frozen');

select pg_temp.seed_fresh_nayax_authorization(
  'b1600000-0000-4000-8000-000000000002',
  'b1900000-0000-4000-8000-000000000002',
  'b1a00000-0000-4000-8000-000000000002'
);
update public.refund_nayax_provider_callers
set assertion_digest = encode(
    extensions.digest(
      convert_to('resolution-retry-executor', 'UTF8'),
      'sha256'
    ),
    'hex'
  )
where caller_id = 'nayax-card-refund';
set local role service_role;
insert into pg_temp.nayax_resolution_test_results (result_key, result)
select 'fresh-reserve', pg_temp.historical_reserve_v2(
  'resolution-retry-executor',
  'b1a00000-0000-4000-8000-000000000002',
  'b1600000-0000-4000-8000-000000000002',
  'nayax-refund-' || repeat('9', 64),
  702,
  100000,
  100,
  'USD'
);
reset role;
select ok((
  select (result #>> '{attempt,shouldExecute}')::boolean
    and length(result ->> 'providerClaimToken') = 64
  from pg_temp.nayax_resolution_test_results
  where result_key = 'fresh-reserve'
), 'A new manager approval can reserve one fresh attempt after retry-safe generation');
select ok((
  select count(*) = 1
  from public.refund_case_nayax_refund_attempts attempt
  where attempt.refund_case_id = 'b1600000-0000-4000-8000-000000000002'
    and attempt.official_action_authorization_id =
      'b1a00000-0000-4000-8000-000000000002'
    and attempt.idempotency_key = 'nayax-refund-' || repeat('9', 64)
), 'The fresh generation does not collide with the prior attempt idempotency row');

set local role authenticated;
select pg_temp.set_auth_claims('b1000000-0000-4000-8000-000000000001', 'aal2', '[]'::jsonb);
select ok(pg_temp.capture_error($sql$
  insert into public.refund_nayax_outcome_resolutions (
    refund_case_id, nayax_refund_attempt_id, resolution_intent_id, actor_user_id,
    resolution_result, evidence_type, evidence_reference_digest,
    evidence_occurred_at, reason_code,
    prior_attempt_status, prior_provider_outcome, prior_reconciliation_required,
    prior_attempt_generation, next_attempt_generation,
    attempt_evidence_hash
  ) values (
    'b1600000-0000-4000-8000-000000000001',
    'b1700000-0000-4000-8000-000000000001',
    gen_random_uuid(), 'b1000000-0000-4000-8000-000000000001',
    'remain_on_hold', 'nayax_support_ticket', repeat('e', 64), null,
    'evidence_incomplete', 'ambiguous', 'unknown', true, 0, 0,
    repeat('f', 64)
  )
$sql$) is not null, 'Authenticated callers cannot directly insert immutable resolution evidence');
reset role;

-- A matched card refund can predate Bloomjoy's attempt journal (for example,
-- an operator completed it directly in Nayax). The evidence-only boundary
-- must reconcile that exact transaction without exposing a provider write.
insert into public.refund_cases (
  id, public_reference, reporting_machine_id, reporting_location_id,
  customer_email, issue_summary, incident_at, payment_method,
  payment_amount_cents, refund_amount_cents, status, decision,
  card_last4, card_wallet_used, correlation_status, correlation_source,
  correlation_confidence, matched_nayax_transaction_id,
  matched_nayax_site_id, matched_nayax_machine_auth_time,
  matched_nayax_amount_cents, matched_nayax_card_last4,
  matched_nayax_currency_code, nayax_recommendation_state,
  nayax_recommendation_policy_version, nayax_recommendation_evaluated_at,
  nayax_match_execution_eligible, nayax_refund_execution_status
) values (
  'b1600000-0000-4000-8000-000000000008', 'RF-RESOLUTION-8',
  'b1300000-0000-4000-8000-000000000001',
  'b1200000-0000-4000-8000-000000000001',
  'resolution-customer-8@example.test',
  'Synthetic refund completed in Nayax before Bloomjoy recorded an attempt',
  statement_timestamp() - interval '4 days', 'card', 708, 708,
  'needs_review', null, '4208', false, 'matched', 'nayax', 1,
  'RESOLUTION-TX-008', 708,
  statement_timestamp() - interval '4 days', 708, '4208', 'USD',
  'high_confidence', 'resolution-test-v1', statement_timestamp(), true,
  'not_requested'
);

update public.refund_cases
set intake_source = 'gmail'
where id = 'b1600000-0000-4000-8000-000000000008';

select ok(
  not public.refund_nayax_evidence_only_start_is_safe(
    'b1600000-0000-4000-8000-000000000008'
  ),
  'A Gmail case without its original thread cannot open evidence-only review'
);

insert into public.refund_gmail_threads (
  id, refund_case_id, mailbox_hash, provider_thread_id, thread_subject,
  first_message_at, latest_message_at, retention_expires_at
) values (
  'b1800000-0000-4000-8000-000000000008',
  'b1600000-0000-4000-8000-000000000008', repeat('8', 64),
  'resolution-original-thread-8', 'Original refund conversation 8',
  statement_timestamp() - interval '5 days',
  statement_timestamp() - interval '4 days',
  statement_timestamp() + interval '180 days'
);

select ok(
  pg_temp.capture_error($sql$
    update public.refund_cases
    set matched_nayax_transaction_id = 'RESOLUTION-TX-008'
    where id = 'b1600000-0000-4000-8000-000000000007'
  $sql$) like '%duplicate key value%',
  'The database rejects a Nayax transaction matched to another case'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.admin_begin_refund_nayax_evidence_only_reconciliation(uuid,bigint)',
    'execute'
  )
  and not has_function_privilege(
    'service_role',
    'public.admin_begin_refund_nayax_evidence_only_reconciliation(uuid,bigint)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'public.refund_nayax_evidence_only_start_is_safe(uuid)',
    'execute'
  ),
  'Only an authenticated mapped-manager session can open evidence-only review'
);

set local role authenticated;
select pg_temp.set_auth_claims(
  'b1000000-0000-4000-8000-000000000001', 'aal1', '[]'::jsonb
);
select ok((
  select (readiness ->> 'visible')::boolean
    and not (readiness ->> 'available')::boolean
    and readiness ->> 'blockReason' = 'evidence_only_start_required'
    and (readiness ->> 'canStartEvidenceOnlyReconciliation')::boolean
    and readiness ->> 'attemptId' is null
  from (select public.admin_get_refund_nayax_resolution_readiness(
    'b1600000-0000-4000-8000-000000000008') readiness) checked
), 'A matched never-attempted case exposes only the evidence-only start action');
reset role;

set local role authenticated;
select pg_temp.set_auth_claims(
  'b1000000-0000-4000-8000-000000000002', 'aal1', '[]'::jsonb
);
select ok(pg_temp.capture_error($sql$
  select public.admin_begin_refund_nayax_evidence_only_reconciliation(
    'b1600000-0000-4000-8000-000000000008',
    (select official_action_version from public.refund_cases
      where id = 'b1600000-0000-4000-8000-000000000008')
  )
$sql$) like '%Refund Operations administrator required%',
  'A routine authenticated user cannot open evidence-only review');
reset role;

set local role authenticated;
select pg_temp.set_auth_claims(
  'b1000000-0000-4000-8000-000000000001', 'aal1', '[]'::jsonb
);
insert into pg_temp.nayax_resolution_test_results (result_key, result)
select 'evidence-only-start',
  public.admin_begin_refund_nayax_evidence_only_reconciliation(
    'b1600000-0000-4000-8000-000000000008',
    (select official_action_version from public.refund_cases
      where id = 'b1600000-0000-4000-8000-000000000008')
  );
reset role;

select ok((
  select (result ->> 'created')::boolean
    and result ->> 'status' = 'manual_review'
    and result ->> 'providerOutcome' = 'unknown'
    and not (result ->> 'providerCallMade')::boolean
    and not (result ->> 'customerMessageCreated')::boolean
    and (result ->> 'payloadRedacted')::boolean
  from pg_temp.nayax_resolution_test_results
  where result_key = 'evidence-only-start'
), 'Opening evidence-only review reports no provider or customer action');

select ok(
  (select count(*) = 1
    from public.refund_case_nayax_refund_attempts attempt
    where attempt.refund_case_id = 'b1600000-0000-4000-8000-000000000008'
      and attempt.execution_mode = 'evidence_only'
      and attempt.status = 'manual_review'
      and attempt.provider_outcome = 'unknown'
      and attempt.reconciliation_required
      and attempt.step_up_intent_id is null
      and attempt.provider_claim_digest is null)
  and (select count(*) = 0 from public.sales_adjustment_facts
    where refund_case_id = 'b1600000-0000-4000-8000-000000000008')
  and (select count(*) = 0 from public.refund_case_messages
    where refund_case_id = 'b1600000-0000-4000-8000-000000000008'),
  'The synthetic attempt is held and creates no reporting or customer side effect'
);

set local role authenticated;
select pg_temp.set_auth_claims(
  'b1000000-0000-4000-8000-000000000001', 'aal1', '[]'::jsonb
);
insert into pg_temp.nayax_resolution_test_results (result_key, result)
select 'evidence-only-replay',
  public.admin_begin_refund_nayax_evidence_only_reconciliation(
    'b1600000-0000-4000-8000-000000000008', 0
  );
reset role;
select ok((
  select not (replayed.result ->> 'created')::boolean
    and (replayed.result ->> 'attemptId')::uuid =
      (started.result ->> 'attemptId')::uuid
    and (select count(*) = 1
      from public.refund_case_nayax_refund_attempts attempt
      where attempt.refund_case_id = 'b1600000-0000-4000-8000-000000000008')
  from pg_temp.nayax_resolution_test_results replayed
  join pg_temp.nayax_resolution_test_results started
    on started.result_key = 'evidence-only-start'
  where replayed.result_key = 'evidence-only-replay'
), 'Opening evidence-only review is idempotent after the case version changes');

set local role authenticated;
select pg_temp.set_auth_claims(
  'b1000000-0000-4000-8000-000000000001', 'aal1', '[]'::jsonb
);

select ok((
  select (readiness ->> 'available')::boolean
    and (readiness ->> 'evidenceOnlyAttempt')::boolean
    and not (readiness ->> 'manualPortalAttempt')::boolean
    and jsonb_array_length(readiness -> 'allowedResults') = 2
    and readiness -> 'allowedResults' ? 'provider_confirmed_success'
    and readiness -> 'allowedResults' ? 'remain_on_hold'
  from (select public.admin_get_refund_nayax_resolution_readiness(
    'b1600000-0000-4000-8000-000000000008') readiness) checked
), 'Evidence-only readiness permits success or hold, never a fresh refund path');

select ok(pg_temp.capture_error($sql$
  select public.admin_resolve_refund_nayax_outcome_manager_session(
    'b1600000-0000-4000-8000-000000000008',
    (select (result ->> 'attemptId')::uuid
      from pg_temp.nayax_resolution_test_results
      where result_key = 'evidence-only-start'),
    'provider_confirmed_retry_safe', 'nayax_dtm_transaction',
    'DTM:NAYAX-6001143932', null, 'nayax_dtm_not_refunded',
    (select official_action_version from public.refund_cases
      where id = 'b1600000-0000-4000-8000-000000000008')
  )
$sql$) like '%can only record success or preserve the hold%',
  'Evidence-only review cannot release the case to any refund retry path');

select ok(pg_temp.capture_error($sql$
  select public.admin_resolve_refund_nayax_outcome_manager_session(
    'b1600000-0000-4000-8000-000000000008',
    (select (result ->> 'attemptId')::uuid
      from pg_temp.nayax_resolution_test_results
      where result_key = 'evidence-only-start'),
    'documented_manual_completion', 'documented_manual_refund',
    'MANUAL:NAYAX-0008', statement_timestamp() - interval '2 days',
    'manual_nayax_completion',
    (select official_action_version from public.refund_cases
      where id = 'b1600000-0000-4000-8000-000000000008')
  )
$sql$) like '%can only record success or preserve the hold%',
  'Evidence-only review requires authoritative DTM or support evidence');

select ok(pg_temp.capture_error($sql$
  select public.admin_resolve_refund_nayax_outcome_manager_session(
    'b1600000-0000-4000-8000-000000000008',
    (select (result ->> 'attemptId')::uuid
      from pg_temp.nayax_resolution_test_results
      where result_key = 'evidence-only-start'),
    'provider_confirmed_success', 'nayax_dtm_transaction',
    'DTM:NAYAX-6001143932', statement_timestamp() - interval '5 days',
    'nayax_dtm_settled',
    (select official_action_version from public.refund_cases
      where id = 'b1600000-0000-4000-8000-000000000008')
  )
$sql$) like '%reviewed payment attempt window%',
  'Evidence-only review rejects a refund timestamp before the matched sale');

insert into pg_temp.nayax_resolution_test_results (result_key, result)
select 'evidence-only-success',
  public.admin_resolve_refund_nayax_outcome_manager_session(
    'b1600000-0000-4000-8000-000000000008',
    (select (result ->> 'attemptId')::uuid
      from pg_temp.nayax_resolution_test_results
      where result_key = 'evidence-only-start'),
    'provider_confirmed_success', 'nayax_dtm_transaction',
    'DTM:NAYAX-6001143932', statement_timestamp() - interval '2 days',
    'nayax_dtm_settled',
    (select official_action_version from public.refund_cases
      where id = 'b1600000-0000-4000-8000-000000000008')
  );
reset role;

select ok((
  select (result ->> 'caseCompleted')::boolean
    and not (result ->> 'providerCallMade')::boolean
    and (result ->> 'customerMessageCreated')::boolean
    and result ->> 'authorizationMethod' = 'manager_session'
  from pg_temp.nayax_resolution_test_results
  where result_key = 'evidence-only-success'
), 'Authoritative historical evidence completes the case without a provider call');

select ok((
  select refund_case.status = 'completed'
    and refund_case.decision = 'approved'
    and refund_case.reporting_adjustment_id is not null
    and attempt.execution_mode = 'evidence_only'
    and attempt.status = 'succeeded'
    and attempt.provider_outcome = 'success'
    and not attempt.reconciliation_required
    and attempt.case_finalization_committed_at is not null
  from public.refund_cases refund_case
  join public.refund_case_nayax_refund_attempts attempt
    on attempt.refund_case_id = refund_case.id
  where refund_case.id = 'b1600000-0000-4000-8000-000000000008'
), 'Evidence-only success atomically settles the case, journal, and reporting');

select ok(
  (select count(*) = 1 from public.sales_adjustment_facts
    where refund_case_id = 'b1600000-0000-4000-8000-000000000008')
  and (select count(*) = 1 from public.refund_case_messages
    where refund_case_id = 'b1600000-0000-4000-8000-000000000008'
      and template_version = 'refund_nayax_completion_v2')
  and (select evidence_reference_digest ~ '^[a-f0-9]{64}$'
      and evidence_reference_digest <> 'DTM:NAYAX-6001143932'
    from public.refund_nayax_outcome_resolutions
    where refund_case_id = 'b1600000-0000-4000-8000-000000000008'),
  'Completion is exactly once and stores only a one-way evidence digest'
);

set local role authenticated;
select pg_temp.set_auth_claims(
  'b1000000-0000-4000-8000-000000000001', 'aal1', '[]'::jsonb
);
insert into pg_temp.nayax_resolution_test_proofs (intent_key, proof)
select 'evidence-only-replay-error', pg_temp.capture_error($sql$
  select public.admin_resolve_refund_nayax_outcome_manager_session(
    'b1600000-0000-4000-8000-000000000008',
    (select (result ->> 'attemptId')::uuid
      from pg_temp.nayax_resolution_test_results
      where result_key = 'evidence-only-start'),
    'provider_confirmed_success', 'nayax_dtm_transaction',
    'DTM:NAYAX-6001143932', statement_timestamp() - interval '2 days',
    'nayax_dtm_settled',
    (select official_action_version from public.refund_cases
      where id = 'b1600000-0000-4000-8000-000000000008')
  )
$sql$);
reset role;
select ok(
  (select proof is not null
    from pg_temp.nayax_resolution_test_proofs
    where intent_key = 'evidence-only-replay-error')
  and (select count(*) = 1 from public.sales_adjustment_facts
    where refund_case_id = 'b1600000-0000-4000-8000-000000000008')
  and (select count(*) = 1 from public.refund_case_messages
    where refund_case_id = 'b1600000-0000-4000-8000-000000000008'),
  'A completed evidence-only result cannot be replayed into duplicate effects');

select ok(
  not public.refund_nayax_evidence_only_start_is_safe(
    'b1600000-0000-4000-8000-000000000008'
  )
  and exists (
    select 1 from public.refund_case_events event
    where event.refund_case_id = 'b1600000-0000-4000-8000-000000000008'
      and event.event_type = 'nayax_evidence_only_reconciliation_started'
      and not (event.metadata ->> 'provider_call_made')::boolean
      and not (event.metadata ->> 'customer_message_created')::boolean
  ), 'The start gate closes permanently and audit evidence proves no provider action');

-- A normal Bloomjoy attempt may be created after an operator already completed
-- the exact refund in Nayax. The resolver must accept only authoritative DTM
-- evidence after the matched sale, classify the causal timing honestly, and
-- retain every exactly-once and fail-closed boundary.
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
  nayax_recommendation_evaluated_at, nayax_match_execution_eligible,
  nayax_refund_execution_status, intake_source
) values
  (
    'b1600000-0000-4000-8000-000000000009', 'RF-RESOLUTION-9',
    'b1300000-0000-4000-8000-000000000001',
    'b1200000-0000-4000-8000-000000000001',
    'resolution-customer-9@example.test',
    'Synthetic refund completed before a later ambiguous Bloomjoy attempt',
    statement_timestamp() - interval '4 hours', 'card', 709, 709,
    'card_refund_pending', 'approved',
    'b1000000-0000-4000-8000-000000000001',
    statement_timestamp() - interval '25 minutes', '4209', false,
    'matched', 'nayax', 1, 'RESOLUTION-TX-009', 709,
    statement_timestamp() - interval '4 hours', 709, '4209', 'USD',
    'high_confidence', 'resolution-test-v1', statement_timestamp(), false,
    'ambiguous', 'form'
  ),
  (
    'b1600000-0000-4000-8000-000000000010', 'RF-RESOLUTION-10',
    'b1300000-0000-4000-8000-000000000001',
    'b1200000-0000-4000-8000-000000000001',
    'resolution-customer-10@example.test',
    'Synthetic second case cannot reuse the first provider evidence reference',
    statement_timestamp() - interval '3 hours', 'card', 710, 710,
    'card_refund_pending', 'approved',
    'b1000000-0000-4000-8000-000000000001',
    statement_timestamp() - interval '25 minutes', '4210', false,
    'matched', 'nayax', 1, 'RESOLUTION-TX-010', 710,
    statement_timestamp() - interval '3 hours', 710, '4210', 'USD',
    'high_confidence', 'resolution-test-v1', statement_timestamp(), false,
    'ambiguous', 'form'
  );

insert into public.refund_case_nayax_refund_attempts (
  id, refund_case_id, actor_user_id, execution_mode, status, idempotency_key,
  amount_cents, transaction_id_present, site_id_present,
  machine_auth_time_present, request_fingerprint, currency_code,
  provider_outcome, provider_outcome_recorded_at, reconciliation_required,
  sanitized_request, sanitized_response, created_at
) values
  (
    'b1700000-0000-4000-8000-000000000009',
    'b1600000-0000-4000-8000-000000000009',
    'b1000000-0000-4000-8000-000000000001',
    'request_and_approve', 'ambiguous', 'resolution-idempotency-9',
    709, true, true, true, repeat('9', 64), 'USD', 'unknown',
    statement_timestamp() - interval '10 minutes', true,
    jsonb_build_object('payload_redacted', true),
    jsonb_build_object('payload_redacted', true),
    statement_timestamp() - interval '20 minutes'
  ),
  (
    'b1700000-0000-4000-8000-000000000010',
    'b1600000-0000-4000-8000-000000000010',
    'b1000000-0000-4000-8000-000000000001',
    'request_and_approve', 'ambiguous', 'resolution-idempotency-10',
    710, true, true, true, repeat('c', 64), 'USD', 'unknown',
    statement_timestamp() - interval '10 minutes', true,
    jsonb_build_object('payload_redacted', true),
    jsonb_build_object('payload_redacted', true),
    statement_timestamp() - interval '20 minutes'
  );

select ok(
  exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'refund_nayax_outcome_resolutions'
      and indexname = 'refund_nayax_resolution_one_success_evidence_idx'
      and indexdef like 'CREATE UNIQUE INDEX%'
  ),
  'Confirmed provider evidence has a concurrency-safe one-case unique index'
);

set local role authenticated;
select pg_temp.set_auth_claims(
  'b1000000-0000-4000-8000-000000000001', 'aal1', '[]'::jsonb
);
select ok(pg_temp.capture_error($sql$
  select public.admin_resolve_refund_nayax_outcome_manager_session(
    'b1600000-0000-4000-8000-000000000009',
    'b1700000-0000-4000-8000-000000000009',
    'provider_confirmed_success', 'nayax_dtm_transaction',
    'DTM:NAYAX-60011439X2', statement_timestamp() - interval '2 hours',
    'nayax_dtm_settled',
    (select official_action_version from public.refund_cases
      where id = 'b1600000-0000-4000-8000-000000000009')
  )
$sql$) like '%safe authoritative evidence reference is required%',
  'A malformed DTM reference fails before any reconciliation write');

select ok(pg_temp.capture_error($sql$
  select public.admin_resolve_refund_nayax_outcome_manager_session(
    'b1600000-0000-4000-8000-000000000009',
    'b1700000-0000-4000-8000-000000000009',
    'provider_confirmed_success', 'nayax_dtm_transaction',
    'DTM:NAYAX-6001143999', statement_timestamp() - interval '5 hours',
    'nayax_dtm_settled',
    (select official_action_version from public.refund_cases
      where id = 'b1600000-0000-4000-8000-000000000009')
  )
$sql$) like '%reviewed payment attempt window%',
  'DTM evidence before the matched sale remains blocked');

select ok(pg_temp.capture_error($sql$
  select public.admin_resolve_refund_nayax_outcome_manager_session(
    'b1600000-0000-4000-8000-000000000009',
    'b1700000-0000-4000-8000-000000000009',
    'provider_confirmed_success', 'nayax_support_ticket',
    'SUPPORT:NAYAX-CS1500699', statement_timestamp() - interval '2 hours',
    'nayax_support_confirmed_success',
    (select official_action_version from public.refund_cases
      where id = 'b1600000-0000-4000-8000-000000000009')
  )
$sql$) like '%reviewed payment attempt window%',
  'Historical support evidence cannot bypass the DTM-only pre-existing-refund rule');

select ok(pg_temp.capture_error($sql$
  select public.admin_resolve_refund_nayax_outcome_manager_session(
    'b1600000-0000-4000-8000-000000000009',
    'b1700000-0000-4000-8000-000000000009',
    'provider_confirmed_success', 'nayax_dtm_transaction',
    'DTM:NAYAX-6001143999', statement_timestamp() + interval '2 minutes',
    'nayax_dtm_settled',
    (select official_action_version from public.refund_cases
      where id = 'b1600000-0000-4000-8000-000000000009')
  )
$sql$) like '%reviewed payment attempt window%',
  'Future DTM evidence remains blocked');

select ok(pg_temp.capture_error($sql$
  select public.admin_resolve_refund_nayax_outcome_manager_session(
    'b1600000-0000-4000-8000-000000000009',
    'b1700000-0000-4000-8000-000000000009',
    'provider_confirmed_success', 'nayax_dtm_transaction',
    'DTM:NAYAX-6001143999', statement_timestamp() - interval '2 hours',
    'nayax_dtm_preexisting_settled',
    (select official_action_version from public.refund_cases
      where id = 'b1600000-0000-4000-8000-000000000009')
  )
$sql$) like '%do not form an approved payment outcome%',
  'The operator cannot self-assert the derived pre-existing timing classification');

select ok(pg_temp.capture_error($sql$
  select public.admin_resolve_refund_nayax_outcome_manager_session(
    'b1600000-0000-4000-8000-000000000009',
    'b1700000-0000-4000-8000-000000000009',
    'provider_confirmed_success', 'nayax_dtm_transaction',
    'DTM:NAYAX-6001143999', statement_timestamp() - interval '2 hours',
    'nayax_dtm_settled', 999
  )
$sql$) like '%changed; reload%',
  'A stale case version cannot reconcile historical provider evidence');
reset role;

set local role authenticated;
select pg_temp.set_auth_claims(
  'b1000000-0000-4000-8000-000000000002', 'aal1', '[]'::jsonb
);
select ok(pg_temp.capture_error($sql$
  select public.admin_resolve_refund_nayax_outcome_manager_session(
    'b1600000-0000-4000-8000-000000000009',
    'b1700000-0000-4000-8000-000000000009',
    'provider_confirmed_success', 'nayax_dtm_transaction',
    'DTM:NAYAX-6001143999', statement_timestamp() - interval '2 hours',
    'nayax_dtm_settled', 1
  )
$sql$) like '%Refund Operations administrator required%',
  'A routine authenticated user cannot reconcile historical provider evidence');
reset role;

select ok(
  (select count(*) = 0 from public.refund_nayax_outcome_resolutions
    where refund_case_id = 'b1600000-0000-4000-8000-000000000009')
  and (select count(*) = 0 from public.sales_adjustment_facts
    where refund_case_id = 'b1600000-0000-4000-8000-000000000009')
  and (select count(*) = 0 from public.refund_case_messages
    where refund_case_id = 'b1600000-0000-4000-8000-000000000009'),
  'Every rejected historical-evidence variant is atomic and side-effect free'
);

set local role authenticated;
select pg_temp.set_auth_claims(
  'b1000000-0000-4000-8000-000000000001', 'aal1', '[]'::jsonb
);
insert into pg_temp.nayax_resolution_test_results (result_key, result)
select 'preexisting-attempt-success',
  public.admin_resolve_refund_nayax_outcome_manager_session(
    'b1600000-0000-4000-8000-000000000009',
    'b1700000-0000-4000-8000-000000000009',
    'provider_confirmed_success', 'nayax_dtm_transaction',
    'DTM:NAYAX-6001143999', statement_timestamp() - interval '2 hours',
    'nayax_dtm_settled',
    (select official_action_version from public.refund_cases
      where id = 'b1600000-0000-4000-8000-000000000009')
  );
reset role;

select ok((
  select (result ->> 'caseCompleted')::boolean
    and not (result ->> 'providerCallMade')::boolean
    and (result ->> 'customerMessageCreated')::boolean
    and result ->> 'authorizationMethod' = 'manager_session'
  from pg_temp.nayax_resolution_test_results
  where result_key = 'preexisting-attempt-success'
), 'Pre-existing DTM success completes the held case without a provider call');

select ok((
  select resolution.reason_code = 'nayax_dtm_preexisting_settled'
    and resolution.evidence_type = 'nayax_dtm_transaction'
    and resolution.resolution_result = 'provider_confirmed_success'
    and resolution.prior_provider_outcome = 'unknown'
    and resolution.evidence_occurred_at < attempt.created_at
    and resolution.evidence_reference_digest ~ '^[a-f0-9]{64}$'
    and resolution.evidence_reference_digest <> 'DTM:NAYAX-6001143999'
  from public.refund_nayax_outcome_resolutions resolution
  join public.refund_case_nayax_refund_attempts attempt
    on attempt.id = resolution.nayax_refund_attempt_id
  where resolution.refund_case_id = 'b1600000-0000-4000-8000-000000000009'
), 'The immutable resolution distinguishes provider success that predates the Bloomjoy attempt');

select ok((
  select attempt.status = 'succeeded'
    and attempt.provider_outcome = 'success'
    and not attempt.reconciliation_required
    and attempt.support_resolution_result = 'provider_confirmed_success'
    and attempt.sanitized_response ->> 'initial_provider_outcome' = 'unknown'
    and (attempt.sanitized_response ->> 'evidence_predated_bloomjoy_attempt')::boolean
    and attempt.sanitized_response ->> 'support_resolution_reason_code' =
      'nayax_dtm_preexisting_settled'
    and not (attempt.sanitized_response ->> 'provider_call_made')::boolean
  from public.refund_case_nayax_refund_attempts attempt
  where attempt.id = 'b1700000-0000-4000-8000-000000000009'
), 'The attempt keeps its original unknown outcome and records provider-free historical reconciliation');

select ok(
  (select status = 'completed'
      and decision = 'approved'
      and reporting_adjustment_id is not null
    from public.refund_cases
    where id = 'b1600000-0000-4000-8000-000000000009')
  and (select count(*) = 1 from public.sales_adjustment_facts
    where refund_case_id = 'b1600000-0000-4000-8000-000000000009')
  and (select count(*) = 1 from public.refund_case_messages
    where refund_case_id = 'b1600000-0000-4000-8000-000000000009'
      and message_type = 'completed'
      and body like '%Your $7.09 refund to the card ending in 4209 was completed on%'
      and body not like '%We issued your%'),
  'Reporting and truthful customer completion are committed exactly once'
);

select ok(
  exists (
    select 1
    from public.refund_case_events event
    where event.refund_case_id = 'b1600000-0000-4000-8000-000000000009'
      and event.event_type = 'nayax_preexisting_refund_reconciled'
      and event.metadata ->> 'reason_code' = 'nayax_dtm_preexisting_settled'
      and not (event.metadata ->> 'provider_call_made')::boolean
      and (event.metadata ->> 'customer_message_created')::boolean
  ),
  'The official event states that Nayax completed the refund before the later attempt'
);

set local role authenticated;
select pg_temp.set_auth_claims(
  'b1000000-0000-4000-8000-000000000001', 'aal1', '[]'::jsonb
);
select ok(pg_temp.capture_error($sql$
  select public.admin_resolve_refund_nayax_outcome_manager_session(
    'b1600000-0000-4000-8000-000000000010',
    'b1700000-0000-4000-8000-000000000010',
    'provider_confirmed_success', 'nayax_dtm_transaction',
    'DTM:NAYAX-6001143999', statement_timestamp() - interval '90 minutes',
    'nayax_dtm_settled',
    (select official_action_version from public.refund_cases
      where id = 'b1600000-0000-4000-8000-000000000010')
  )
$sql$) like '%already completed another refund case%',
  'One DTM success reference cannot complete a second refund case');
reset role;

select ok(
  (select status = 'card_refund_pending'
      and decision = 'approved'
      and reporting_adjustment_id is null
      and refund_completed_at is null
    from public.refund_cases
    where id = 'b1600000-0000-4000-8000-000000000010')
  and (select count(*) = 0 from public.refund_nayax_outcome_resolutions
    where refund_case_id = 'b1600000-0000-4000-8000-000000000010')
  and (select count(*) = 0 from public.sales_adjustment_facts
    where refund_case_id = 'b1600000-0000-4000-8000-000000000010')
  and (select count(*) = 0 from public.refund_case_messages
    where refund_case_id = 'b1600000-0000-4000-8000-000000000010'),
  'Duplicate provider evidence leaves the second case held with zero side effects'
);

set local role authenticated;
select pg_temp.set_auth_claims(
  'b1000000-0000-4000-8000-000000000001', 'aal1', '[]'::jsonb
);
select ok(pg_temp.capture_error($sql$
  select public.admin_resolve_refund_nayax_outcome_manager_session(
    'b1600000-0000-4000-8000-000000000009',
    'b1700000-0000-4000-8000-000000000009',
    'provider_confirmed_success', 'nayax_dtm_transaction',
    'DTM:NAYAX-6001143999', statement_timestamp() - interval '2 hours',
    'nayax_dtm_settled',
    (select official_action_version from public.refund_cases
      where id = 'b1600000-0000-4000-8000-000000000009')
  )
$sql$) is not null,
  'A completed pre-existing result cannot be replayed');
reset role;

select ok(
  (select count(*) = 1 from public.refund_nayax_outcome_resolutions
    where refund_case_id = 'b1600000-0000-4000-8000-000000000009')
  and (select count(*) = 1 from public.sales_adjustment_facts
    where refund_case_id = 'b1600000-0000-4000-8000-000000000009')
  and (select count(*) = 1 from public.refund_case_messages
    where refund_case_id = 'b1600000-0000-4000-8000-000000000009'
      and message_type = 'completed'),
  'Replay leaves the resolution, reporting, and customer completion exactly once'
);

select * from finish();
rollback;
