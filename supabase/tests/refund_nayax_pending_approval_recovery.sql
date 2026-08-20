begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(20);

create function pg_temp.capture_error(statement text)
returns text language plpgsql as $$
begin
  execute statement;
  return null;
exception when others then
  return sqlstate || ':' || sqlerrm;
end;
$$;

create temporary table recovery_results (
  result_key text primary key,
  result jsonb not null
);
grant all on table pg_temp.recovery_results to service_role;

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
(
  '00000000-0000-0000-0000-000000000000',
  '8e000000-0000-4000-8000-000000000001',
  'authenticated', 'authenticated', 'recovery-manager@example.test', '', now(),
  '{}'::jsonb, '{}'::jsonb, now(), now()
),
(
  '00000000-0000-0000-0000-000000000000',
  '8e000000-0000-4000-8000-000000000002',
  'authenticated', 'authenticated', 'unmapped-recovery@example.test', '', now(),
  '{}'::jsonb, '{}'::jsonb, now(), now()
);

insert into public.customer_accounts (id, name, account_type)
values ('8e100000-0000-4000-8000-000000000001', 'Recovery safety', 'customer');

insert into public.reporting_locations (id, account_id, name, timezone)
values (
  '8e200000-0000-4000-8000-000000000001',
  '8e100000-0000-4000-8000-000000000001',
  'Recovery test location', 'America/Los_Angeles'
);

insert into public.reporting_machines (
  id, account_id, location_id, machine_label, status, nayax_machine_id,
  nayax_account_key, nayax_refunds_enabled, nayax_refund_max_amount_cents
) values (
  '8e300000-0000-4000-8000-000000000001',
  '8e100000-0000-4000-8000-000000000001',
  '8e200000-0000-4000-8000-000000000001',
  'Recovery machine', 'active', 'RECOVERY-MACHINE',
  'RECOVERY-ACCOUNT', false, null
);

insert into public.reporting_machine_refund_managers (
  id, reporting_machine_id, manager_user_id, manager_email, grant_reason
) values (
  '8e400000-0000-4000-8000-000000000001',
  '8e300000-0000-4000-8000-000000000001',
  '8e000000-0000-4000-8000-000000000001',
  'recovery-manager@example.test', 'Pending request recovery test'
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
) values (
  '8e500000-0000-4000-8000-000000000001', 'RF-RECOVERY-ONE',
  '8e300000-0000-4000-8000-000000000001',
  '8e200000-0000-4000-8000-000000000001',
  'recovery-customer@example.test', 'Request accepted but contract mismatched',
  statement_timestamp() - interval '1 day', 'card', 1090, 1090,
  'card_refund_pending', 'approved',
  '8e000000-0000-4000-8000-000000000001', statement_timestamp() - interval '5 minutes',
  '4242', false, 'matched', 'nayax', 1,
  '6841061866', 6, statement_timestamp() - interval '1 day',
  1090, '4242', 'USD', 'high_confidence', 'recovery-test-v1',
  statement_timestamp(), false, 'ambiguous'
);

insert into public.refund_case_nayax_refund_attempts (
  id, refund_case_id, actor_user_id, execution_mode, status,
  idempotency_key, amount_cents, transaction_id_present, site_id_present,
  machine_auth_time_present, provider_status, error_code,
  sanitized_request, sanitized_response, currency_code,
  provider_outcome, provider_outcome_recorded_at,
  reconciliation_required, completed_at
) values (
  '8e600000-0000-4000-8000-000000000001',
  '8e500000-0000-4000-8000-000000000001',
  '8e000000-0000-4000-8000-000000000001',
  'request_and_approve', 'ambiguous', 'nayax-refund-' || repeat('8', 64),
  1090, true, true, true,
  'request_unknown_contract_mismatch', 'provider_request_outcome_unknown',
  jsonb_build_object('payload_redacted', true),
  jsonb_build_object('payload_redacted', true), 'USD',
  'unknown', statement_timestamp() - interval '4 minutes', true,
  statement_timestamp() - interval '4 minutes'
);

insert into public.refund_nayax_provider_callers (caller_id, assertion_digest)
values (
  'nayax-card-refund',
  encode(extensions.digest(convert_to('recovery-test-executor', 'UTF8'), 'sha256'), 'hex')
)
on conflict (caller_id) do update
set assertion_digest = excluded.assertion_digest, status = 'active',
  rotated_at = statement_timestamp();

select ok(
  not has_table_privilege('service_role', 'public.refund_nayax_pending_approval_recoveries', 'select')
  and not has_table_privilege('service_role', 'public.refund_nayax_provider_stage_journal', 'insert')
  and not has_table_privilege('authenticated', 'public.refund_nayax_pending_approval_recoveries', 'select'),
  'Recovery and stage evidence have no direct service or browser access'
);

select ok(
  has_function_privilege('service_role',
    'public.service_reserve_nayax_pending_approval_recovery(text,uuid,uuid,uuid,bigint,text)', 'execute')
  and has_function_privilege('service_role',
    'public.service_record_nayax_refund_provider_stage(text,uuid,uuid,text,text,text,integer,text,boolean,text,text)', 'execute')
  and has_function_privilege('service_role',
    'public.service_settle_nayax_pending_approval_recovery(text,uuid,uuid,uuid,text,text,text,text,text)', 'execute')
  and not has_function_privilege('authenticated',
    'public.service_reserve_nayax_pending_approval_recovery(text,uuid,uuid,uuid,bigint,text)', 'execute'),
  'Only the assertion-protected service boundary can operate recovery'
);

set local role service_role;
select ok(pg_temp.capture_error($sql$
  select public.service_reserve_nayax_pending_approval_recovery(
    null, '8e000000-0000-4000-8000-000000000001',
    '8e500000-0000-4000-8000-000000000001',
    '8e600000-0000-4000-8000-000000000001', 0, 'dtm:refund-requested:test')
$sql$) like '%executor identity required%',
  'Missing executor assertion cannot reserve a recovery');

select ok(pg_temp.capture_error($sql$
  select public.service_reserve_nayax_pending_approval_recovery(
    'recovery-test-executor', '8e000000-0000-4000-8000-000000000002',
    '8e500000-0000-4000-8000-000000000001',
    '8e600000-0000-4000-8000-000000000001', 0, 'dtm:refund-requested:test')
$sql$) like '%exact latest DTM-confirmed%',
  'An unmapped user cannot recover the request');

insert into pg_temp.recovery_results (result_key, result)
select 'reserve', public.service_reserve_nayax_pending_approval_recovery(
  'recovery-test-executor', '8e000000-0000-4000-8000-000000000001',
  '8e500000-0000-4000-8000-000000000001',
  '8e600000-0000-4000-8000-000000000001',
  (select official_action_version from public.refund_cases
    where id = '8e500000-0000-4000-8000-000000000001'),
  'dtm:refund-requested:test'
);
reset role;

select ok(
  (select (result #>> '{recovery,shouldExecute}')::boolean
    and length(result ->> 'providerClaimToken') > 64
    and result #>> '{evidence,transactionId}' = '6841061866'
    from pg_temp.recovery_results where result_key = 'reserve'),
  'A fresh exact recovery returns one approval-scoped claim and frozen provider evidence'
);
select is((select count(*)::integer from public.refund_nayax_pending_approval_recoveries), 1,
  'Exactly one recovery row is reserved for the original attempt');
select ok((
  select provider_claim_digest ~ '^[a-f0-9]{64}$'
    and provider_claim_digest <> (select result ->> 'providerClaimToken'
      from pg_temp.recovery_results where result_key = 'reserve')
  from public.refund_nayax_pending_approval_recoveries
), 'Only the recovery claim digest is persisted');

set local role service_role;
insert into pg_temp.recovery_results (result_key, result)
select 'replay', public.service_reserve_nayax_pending_approval_recovery(
  'recovery-test-executor', '8e000000-0000-4000-8000-000000000001',
  '8e500000-0000-4000-8000-000000000001',
  '8e600000-0000-4000-8000-000000000001',
  (select official_action_version from public.refund_cases
    where id = '8e500000-0000-4000-8000-000000000001'),
  'dtm:refund-requested:test'
);
reset role;
select ok(
  (select not (result #>> '{recovery,shouldExecute}')::boolean
    and result ->> 'providerClaimToken' is null
    and result ->> 'evidence' is null
    from pg_temp.recovery_results where result_key = 'replay'),
  'Reservation replay exposes no claim or provider evidence and cannot call Nayax again'
);
select is((select count(*)::integer from public.refund_nayax_pending_approval_recoveries), 1,
  'Reservation replay cannot create a second recovery');

set local role service_role;
select ok(pg_temp.capture_error($sql$
  select public.service_record_nayax_refund_provider_stage(
    'recovery-test-executor', '8e600000-0000-4000-8000-000000000001',
    (select (result #>> '{recovery,recoveryId}')::uuid from pg_temp.recovery_results where result_key = 'reserve'),
    (select result ->> 'providerClaimToken' from pg_temp.recovery_results where result_key = 'reserve'),
    'request', 'started', null, null, null, null, repeat('a', 64))
$sql$) like '%active recovery-scoped provider claim%',
  'A recovery claim cannot journal or dispatch a request stage');

select public.service_record_nayax_refund_provider_stage(
  'recovery-test-executor', '8e600000-0000-4000-8000-000000000001',
  (select (result #>> '{recovery,recoveryId}')::uuid from pg_temp.recovery_results where result_key = 'reserve'),
  (select result ->> 'providerClaimToken' from pg_temp.recovery_results where result_key = 'reserve'),
  'approve', 'started', null, null, null, null, repeat('b', 64));

select ok(pg_temp.capture_error($sql$
  select public.service_record_nayax_refund_provider_stage(
    'recovery-test-executor', '8e600000-0000-4000-8000-000000000001',
    (select (result #>> '{recovery,recoveryId}')::uuid from pg_temp.recovery_results where result_key = 'reserve'),
    (select result ->> 'providerClaimToken' from pg_temp.recovery_results where result_key = 'reserve'),
    'approve', 'started', null, null, null, null, repeat('c', 64))
$sql$) like '%duplicate key%',
  'The approval started marker is append-only and exactly once');

select public.service_record_nayax_refund_provider_stage(
  'recovery-test-executor', '8e600000-0000-4000-8000-000000000001',
  (select (result #>> '{recovery,recoveryId}')::uuid from pg_temp.recovery_results where result_key = 'reserve'),
  (select result ->> 'providerClaimToken' from pg_temp.recovery_results where result_key = 'reserve'),
  'approve', 'result', 500, 'unknown', false, null, repeat('d', 64));

insert into pg_temp.recovery_results (result_key, result)
select 'settle', public.service_settle_nayax_pending_approval_recovery(
  'recovery-test-executor',
  (select (result #>> '{recovery,recoveryId}')::uuid from pg_temp.recovery_results where result_key = 'reserve'),
  '8e600000-0000-4000-8000-000000000001',
  '8e500000-0000-4000-8000-000000000001',
  (select result ->> 'providerClaimToken' from pg_temp.recovery_results where result_key = 'reserve'),
  'unknown', null, 'approve_unknown_contract_mismatch',
  'provider_approve_outcome_unknown'
);
reset role;

select is((select result ->> 'status' from pg_temp.recovery_results where result_key = 'settle'),
  'ambiguous', 'A provider HTTP error settles only the recovery as ambiguous');
select ok((
  select provider_outcome = 'unknown'
    and provider_claim_consumed_at is not null
    and completed_at is not null
  from public.refund_nayax_pending_approval_recoveries
), 'The one recovery claim is consumed on an ambiguous result');
select ok((
  select status = 'ambiguous' and provider_outcome = 'unknown'
    and reconciliation_required and support_resolution_id is null
  from public.refund_case_nayax_refund_attempts
  where id = '8e600000-0000-4000-8000-000000000001'
), 'The original provider attempt remains held for structured reconciliation');
select ok((
  select status = 'card_refund_pending' and decision = 'approved'
    and refund_completed_at is null and reporting_adjustment_id is null
  from public.refund_cases
  where id = '8e500000-0000-4000-8000-000000000001'
), 'Recovery uncertainty cannot finalize reporting or the customer case');
select is((select count(*)::integer from public.refund_nayax_provider_stage_journal
  where stage = 'approve'), 2, 'Only approval started/result evidence exists for the recovery');
select is((select count(*)::integer from public.refund_nayax_provider_stage_journal
  where stage = 'request'), 0, 'The recovery path has no request-stage evidence because it cannot call request');

select ok(pg_temp.capture_error($sql$
  update public.refund_nayax_provider_stage_journal
  set classification_digest = repeat('e', 64)
$sql$) like '%immutable%', 'Provider stage evidence cannot be updated');
select ok(pg_temp.capture_error($sql$
  delete from public.refund_nayax_provider_stage_journal
$sql$) like '%immutable%', 'Provider stage evidence cannot be deleted');

set local role service_role;
select ok(pg_temp.capture_error($sql$
  select public.service_settle_nayax_pending_approval_recovery(
    'recovery-test-executor',
    (select (result #>> '{recovery,recoveryId}')::uuid from pg_temp.recovery_results where result_key = 'reserve'),
    '8e600000-0000-4000-8000-000000000001',
    '8e500000-0000-4000-8000-000000000001',
    (select result ->> 'providerClaimToken' from pg_temp.recovery_results where result_key = 'reserve'),
    'success', 'nayax-evidence-' || repeat('f', 64),
    'approve_succeeded_contract_match', null)
$sql$) like '%invalid, expired, changed, or already used%',
  'A consumed recovery cannot be replayed as success');
reset role;

select * from finish();
rollback;
