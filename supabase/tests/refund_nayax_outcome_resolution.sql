begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(65);

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
) values (
  'b1300000-0000-4000-8000-000000000001',
  'b1100000-0000-4000-8000-000000000001',
  'b1200000-0000-4000-8000-000000000001',
  'Resolution test machine', 'RESOLUTION-MACHINE', 'RESOLUTION-ACCOUNT', true, 2500
);

insert into public.reporting_machine_refund_managers (
  id, reporting_machine_id, manager_user_id, manager_email, grant_reason
) values (
  'b1400000-0000-4000-8000-000000000001',
  'b1300000-0000-4000-8000-000000000001',
  'b1000000-0000-4000-8000-000000000001',
  'resolution-manager@example.test',
  'Nayax resolution safety'
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
  'b1300000-0000-4000-8000-000000000001'::uuid,
  'b1200000-0000-4000-8000-000000000001'::uuid,
  'resolution-customer-' || series || '@example.test',
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
  case series when 1 then 'ambiguous' when 2 then 'declined' when 3 then 'failed' else 'declined' end
from generate_series(1, 4) series;

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
  case series when 1 then 'ambiguous' when 2 then 'declined' when 3 then 'failed' else 'declined' end,
  'resolution-idempotency-' || series,
  700 + series, true, true, true, repeat(series::text, 64), 'USD',
  case series when 1 then 'unknown' when 2 then 'rejected' when 3 then 'timeout' else 'rejected' end,
  statement_timestamp() - interval '10 minutes',
  true,
  jsonb_build_object('payload_redacted', true),
  jsonb_build_object('payload_redacted', true),
  statement_timestamp() - interval '20 minutes'
from generate_series(1, 4) series;

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
    and not (readiness ->> 'available')::boolean
    and readiness ->> 'blockReason' = 'authenticator_required'
  from (select public.admin_get_refund_nayax_resolution_readiness(
    'b1600000-0000-4000-8000-000000000001') readiness) checked
), 'Readiness stays closed until the exact manager has an active owner-approved authenticator');
reset role;
update public.refund_manager_totp_enrollments
set status = 'active', revoked_at = null
where actor_user_id = 'b1000000-0000-4000-8000-000000000001';
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
  'DTM:NAYAX-123456789', 'nayax_dtm_transaction'
), 'The documented nine-digit Nayax DTM transaction shape remains usable');
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

update public.refund_case_nayax_refund_attempts
set
  created_at = (
    date_trunc('day', statement_timestamp() at time zone 'UTC') + interval '15 minutes'
  ) at time zone 'UTC' - interval '30 minutes',
  provider_outcome_recorded_at = (
    date_trunc('day', statement_timestamp() at time zone 'UTC') + interval '15 minutes'
  ) at time zone 'UTC'
where id = 'b1700000-0000-4000-8000-000000000003';
set local role authenticated;
select pg_temp.set_auth_claims('b1000000-0000-4000-8000-000000000001', 'aal1', '[]'::jsonb);
with evidence as (
  select (
    date_trunc('day', statement_timestamp() at time zone 'UTC') + interval '15 minutes'
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
select 'fresh-reserve', public.service_reserve_and_consume_nayax_refund_attempt_v2(
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

select * from finish();
rollback;
