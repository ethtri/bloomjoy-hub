begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(47);

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
  intent_id uuid not null
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

insert into public.refund_case_nayax_refund_attempts (
  id, refund_case_id, actor_user_id, execution_mode, status, idempotency_key,
  amount_cents, transaction_id_present, site_id_present,
  machine_auth_time_present, request_fingerprint, currency_code,
  provider_outcome, provider_outcome_recorded_at, reconciliation_required,
  sanitized_request, sanitized_response
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
  jsonb_build_object('payload_redacted', true)
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
    'public.admin_prepare_refund_nayax_resolution_intent(uuid,uuid,text,text,text,text,bigint)', 'execute')
  and has_function_privilege('authenticated',
    'public.admin_consume_refund_nayax_resolution_intent(uuid,uuid,uuid,text,text,text,text,text)', 'execute')
  and not has_function_privilege('service_role',
    'public.admin_consume_refund_nayax_resolution_intent(uuid,uuid,uuid,text,text,text,text,text)', 'execute')
  and has_function_privilege('service_role',
    'public.service_mark_refund_nayax_resolution_factor_verified(uuid,uuid,text)', 'execute'),
  'Authenticated humans consume exact intents and only the trusted service marks factor proof');
select ok((
  select pg_get_userbyid(procedure.proowner) = pg_get_userbyid(database.datdba)
  from pg_proc procedure
  cross join pg_database database
  where procedure.oid =
    'public.admin_consume_refund_nayax_resolution_intent(uuid,uuid,uuid,text,text,text,text,text)'::regprocedure
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
    'evidence_incomplete', 1)
$sql$) like '%resolution is disabled%',
  'The default-off gate blocks preparation before any write');
reset role;

create or replace function public.refund_nayax_outcome_resolution_enabled()
returns boolean language sql immutable set search_path = public as $$ select true; $$;

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
select ok(pg_temp.capture_error($sql$
  select public.admin_prepare_refund_nayax_resolution_intent(
    'b1600000-0000-4000-8000-000000000001',
    'b1700000-0000-4000-8000-000000000001',
    'provider_confirmed_success', 'nayax_dtm_transaction', 'DTM:MISMATCH-001',
    'nayax_support_confirmed_success', 1)
$sql$) like '%do not form an approved%',
  'Evidence type and reason must form an exact approved pair');
select ok(pg_temp.capture_error($sql$
  select public.admin_prepare_refund_nayax_resolution_intent(
    'b1600000-0000-4000-8000-000000000001',
    'b1700000-0000-4000-8000-000000000001',
    'remain_on_hold', 'nayax_support_ticket', 'unsafe reference with spaces',
    'evidence_incomplete', 1)
$sql$) like '%safe authoritative evidence reference%',
  'Evidence accepts a bounded reference only, never vendor content');
select ok(pg_temp.capture_error($sql$
  select public.admin_prepare_refund_nayax_resolution_intent(
    'b1600000-0000-4000-8000-000000000001',
    'b1700000-0000-4000-8000-000000000002',
    'remain_on_hold', 'nayax_support_ticket', 'SUPPORT:WRONG-ATTEMPT',
    'evidence_incomplete', 1)
$sql$) like '%Exact latest provider-held Nayax attempt is required%',
  'A held attempt from another case cannot be substituted');
select lives_ok($sql$
  insert into pg_temp.nayax_resolution_test_intents (intent_key, intent_id)
  select 'hold', (public.admin_prepare_refund_nayax_resolution_intent(
    'b1600000-0000-4000-8000-000000000001',
    'b1700000-0000-4000-8000-000000000001',
    'remain_on_hold', 'nayax_support_ticket', 'SUPPORT:HOLD-0001',
    'evidence_incomplete', 1) ->> 'intentId')::uuid
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
    'remain_on_hold', 'nayax_support_ticket', 'SUPPORT:HOLD-0001', 'evidence_incomplete', repeat('f', 64))
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
    'remain_on_hold', 'nayax_support_ticket', 'SUPPORT:HOLD-0001', 'evidence_incomplete',
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
    and resolution.evidence_reference = 'SUPPORT:HOLD-0001'
    and resolution.payload_redacted
  from public.refund_nayax_outcome_resolutions resolution
  where resolution.resolution_intent_id =
    (select intent_id from pg_temp.nayax_resolution_test_intents where intent_key = 'hold')
), 'Immutable audit preserves the prior provider fact and bounded evidence reference');
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
    'remain_on_hold', 'nayax_support_ticket', 'SUPPORT:HOLD-0001', 'evidence_incomplete', repeat('f', 64))
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
  'nayax_dtm_not_refunded', 1) ->> 'intentId')::uuid;
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
  'nayax_dtm_not_refunded',
  (select proof from pg_temp.nayax_resolution_test_proofs where intent_key = 'retry'));
select lives_ok($sql$select 1$sql$, 'Retry-safe consumes one exact fresh TOTP without a provider retry');
reset role;

select ok((
  select refund_case.nayax_refund_execution_status = 'not_requested'
    and refund_case.nayax_match_execution_eligible
    and refund_case.status = 'card_refund_pending'
    and refund_case.refund_completed_at is null
  from public.refund_cases refund_case where refund_case.id = 'b1600000-0000-4000-8000-000000000002'
), 'Retry-safe returns only the case to a fresh separately authorized review');
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
select pg_temp.set_auth_claims('b1000000-0000-4000-8000-000000000001', 'aal1', '[]'::jsonb);
insert into pg_temp.nayax_resolution_test_intents (intent_key, intent_id)
select 'success', (public.admin_prepare_refund_nayax_resolution_intent(
  'b1600000-0000-4000-8000-000000000003', 'b1700000-0000-4000-8000-000000000003',
  'provider_confirmed_success', 'nayax_dtm_transaction', 'DTM:SETTLED-0003',
  'nayax_dtm_settled', 1) ->> 'intentId')::uuid;
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
  'provider_confirmed_success', 'nayax_dtm_transaction', 'DTM:SETTLED-0003', 'nayax_dtm_settled',
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
  and (select count(*) = 0 from public.refund_case_messages where refund_case_id = 'b1600000-0000-4000-8000-000000000003')
  and (select not (result ->> 'providerCallMade')::boolean
    and not (result ->> 'customerMessageCreated')::boolean
    and (result ->> 'customerCompletionAvailable')::boolean
   from pg_temp.nayax_resolution_test_results where result_key = 'success'),
  'Success commits one reporting fact before any separately controlled customer message');

set local role authenticated;
select pg_temp.set_auth_claims('b1000000-0000-4000-8000-000000000001', 'aal1', '[]'::jsonb);
insert into pg_temp.nayax_resolution_test_intents (intent_key, intent_id)
select 'manual', (public.admin_prepare_refund_nayax_resolution_intent(
  'b1600000-0000-4000-8000-000000000004', 'b1700000-0000-4000-8000-000000000004',
  'documented_manual_completion', 'documented_manual_refund', 'MANUAL:NAYAX-0004',
  'manual_nayax_completion', 1) ->> 'intentId')::uuid;
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
  'manual_nayax_completion',
  (select proof from pg_temp.nayax_resolution_test_proofs where intent_key = 'manual'));
select lives_ok($sql$select 1$sql$, 'Documented manual completion commits after fresh exact TOTP');
reset role;

select ok((
  select refund_case.status = 'completed'
    and refund_case.manual_refund_reference = 'MANUAL:NAYAX-0004'
    and refund_case.reporting_adjustment_id is not null
  from public.refund_cases refund_case where refund_case.id = 'b1600000-0000-4000-8000-000000000004'
), 'Documented manual completion commits the exact reference and one reporting fact');
select ok((
  select resolution.resolution_result = 'documented_manual_completion'
    and resolution.prior_provider_outcome = 'rejected'
    and resolution.evidence_type = 'documented_manual_refund'
    and resolution.reason_code = 'manual_nayax_completion'
  from public.refund_nayax_outcome_resolutions resolution
  where resolution.nayax_refund_attempt_id = 'b1700000-0000-4000-8000-000000000004'
), 'Manual completion preserves the original rejected outcome and exact evidence classification');
select is((select count(*)::integer from public.refund_case_messages
  where refund_case_id in (
    'b1600000-0000-4000-8000-000000000001',
    'b1600000-0000-4000-8000-000000000002',
    'b1600000-0000-4000-8000-000000000003',
    'b1600000-0000-4000-8000-000000000004'
  )), 0, 'No resolution path creates a customer message');
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

set local role authenticated;
select pg_temp.set_auth_claims('b1000000-0000-4000-8000-000000000001', 'aal2', '[]'::jsonb);
select ok(pg_temp.capture_error($sql$
  insert into public.refund_nayax_outcome_resolutions (
    refund_case_id, nayax_refund_attempt_id, resolution_intent_id, actor_user_id,
    resolution_result, evidence_type, evidence_reference, reason_code,
    prior_attempt_status, prior_provider_outcome, prior_reconciliation_required,
    attempt_evidence_hash
  ) values (
    'b1600000-0000-4000-8000-000000000001',
    'b1700000-0000-4000-8000-000000000001',
    gen_random_uuid(), 'b1000000-0000-4000-8000-000000000001',
    'remain_on_hold', 'nayax_support_ticket', 'SUPPORT:DIRECT-INSERT',
    'evidence_incomplete', 'ambiguous', 'unknown', true, repeat('f', 64)
  )
$sql$) is not null, 'Authenticated callers cannot directly insert immutable resolution evidence');
reset role;

select * from finish();
rollback;
