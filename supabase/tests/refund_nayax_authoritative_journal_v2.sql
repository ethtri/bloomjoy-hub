begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(19);

create function pg_temp.capture_error(statement text)
returns text language plpgsql as $$
begin
  execute statement;
  return null;
exception when others then
  return sqlstate || ':' || sqlerrm;
end;
$$;

create temporary table journal_v2_results (
  result_key text primary key,
  result jsonb not null
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  '8f000000-0000-4000-8000-000000000001',
  'authenticated', 'authenticated', 'journal-v2-manager@example.test', '', now(),
  '{}'::jsonb, '{}'::jsonb, now(), now()
);

insert into public.customer_accounts (id, name, account_type)
values ('8f100000-0000-4000-8000-000000000001', 'Journal v2 safety', 'customer');

insert into public.reporting_locations (id, account_id, name, timezone)
values (
  '8f200000-0000-4000-8000-000000000001',
  '8f100000-0000-4000-8000-000000000001',
  'Journal v2 location', 'America/Los_Angeles'
);

insert into public.reporting_machines (
  id, account_id, location_id, machine_label, status, nayax_machine_id,
  nayax_account_key, nayax_refunds_enabled, nayax_refund_max_amount_cents
) values (
  '8f300000-0000-4000-8000-000000000001',
  '8f100000-0000-4000-8000-000000000001',
  '8f200000-0000-4000-8000-000000000001',
  'Journal v2 machine', 'active', 'JOURNAL-V2-MACHINE',
  'JOURNAL-V2-ACCOUNT', true, 2500
);

insert into public.reporting_machine_refund_managers (
  id, reporting_machine_id, manager_user_id, manager_email, grant_reason
) values (
  '8f400000-0000-4000-8000-000000000001',
  '8f300000-0000-4000-8000-000000000001',
  '8f000000-0000-4000-8000-000000000001',
  'journal-v2-manager@example.test', 'Journal v2 state-machine test'
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
  ('8f500000-0000-4000-8000-' || lpad(series::text, 12, '0'))::uuid,
  'RF-JOURNAL-V2-' || series,
  '8f300000-0000-4000-8000-000000000001'::uuid,
  '8f200000-0000-4000-8000-000000000001'::uuid,
  'journal-v2-' || series || '@example.test', 'Journal v2 matrix ' || series,
  statement_timestamp() - interval '1 day', 'card', 700, 700,
  'card_refund_pending', 'approved',
  '8f000000-0000-4000-8000-000000000001'::uuid,
  statement_timestamp() - interval '5 minutes', '4242', false,
  'matched', 'nayax', 1, 'JOURNAL-V2-TX-' || series, 800 + series,
  statement_timestamp() - interval '1 day', 700, '4242', 'USD',
  'high_confidence', 'journal-v2-test', statement_timestamp(), false, 'requested'
from generate_series(1, 12) series;

insert into public.refund_case_nayax_refund_attempts (
  id, refund_case_id, actor_user_id, execution_mode, status,
  idempotency_key, amount_cents, transaction_id_present, site_id_present,
  machine_auth_time_present, sanitized_request, sanitized_response,
  currency_code, provider_claim_digest, provider_claim_expires_at,
  reconciliation_required
)
select
  ('8f600000-0000-4000-8000-' || lpad(series::text, 12, '0'))::uuid,
  ('8f500000-0000-4000-8000-' || lpad(series::text, 12, '0'))::uuid,
  '8f000000-0000-4000-8000-000000000001'::uuid,
  'request_and_approve', 'in_progress',
  'journal-v2-' || series, 700, true, true, true,
  jsonb_build_object('payload_redacted', true), '{}'::jsonb, 'USD',
  encode(extensions.digest(convert_to('journal-v2-claim-' || series, 'UTF8'), 'sha256'), 'hex'),
  statement_timestamp() + interval '15 minutes', true
from generate_series(1, 10) series;


-- Synthetic owner-only prerequisites for the journal classifier fixtures below.
-- Actual authenticated observation/reservation behavior is covered separately.
insert into public.refund_nayax_execution_verifications(
  id,refund_case_id,case_version,attempt_generation,reporting_machine_id,account_scope,provider_machine_id,
  original_transaction_id,site_id,machine_auth_time_raw,original_amount_cents,refunded_amount_cents,
  remaining_amount_cents,currency_code,evidence_reference,observed_by,no_pending_refund_reviewed,exclusive_execution_reviewed)
select a.id,c.id,c.official_action_version,c.nayax_refund_attempt_generation,m.id,m.nayax_account_key,m.nayax_machine_id,
  c.matched_nayax_transaction_id,c.matched_nayax_site_id,'2026-08-26T13:17:08.123',c.matched_nayax_amount_cents,0,
  c.matched_nayax_amount_cents,c.matched_nayax_currency_code,'DTM:NAYAX-'||c.matched_nayax_transaction_id,a.actor_user_id,true,true
from public.refund_case_nayax_refund_attempts a join public.refund_cases c on c.id=a.refund_case_id
join public.reporting_machines m on m.id=c.reporting_machine_id
where a.id::text like '8f6%';
update public.refund_case_nayax_refund_attempts set execution_verification_id=id where id::text like '8f6%';

insert into public.refund_nayax_provider_callers (caller_id, assertion_digest)
values (
  'nayax-card-refund',
  encode(extensions.digest(convert_to('journal-v2-executor', 'UTF8'), 'sha256'), 'hex')
)
on conflict (caller_id) do update
set assertion_digest = excluded.assertion_digest, status = 'active',
  rotated_at = statement_timestamp();

select ok(
  not has_table_privilege('service_role', 'public.refund_nayax_provider_stage_journal', 'select')
  and not has_table_privilege('authenticated', 'public.refund_nayax_provider_stage_journal', 'select')
  and (select relrowsecurity from pg_class where oid = 'public.refund_nayax_provider_stage_journal'::regclass),
  'The authoritative journal is private and protected by RLS'
);

select ok(
  has_function_privilege('service_role',
    'public.service_record_nayax_refund_provider_stage_v2(text,uuid,text,text,text,integer,text,boolean,text,text,text,text)', 'execute')
  and has_function_privilege('service_role',
    'public.service_reserve_nayax_refund_manager_action_v2(text,uuid,uuid,bigint,text,integer,integer,integer,text,text,text)', 'execute')
  and not has_function_privilege('authenticated',
    'public.service_record_nayax_refund_provider_stage_v2(text,uuid,text,text,text,integer,text,boolean,text,text,text,text)', 'execute'),
  'Only the assertion-protected service boundary can use journal v2'
);

insert into pg_temp.journal_v2_results values (
  'capability', public.service_get_nayax_refund_provider_journal_capability('journal-v2-executor')
);
select ok((
  select result ->> 'journalContractVersion' = 'nayax-provider-journal-v2'
    and result -> 'supportedProviderContractVersions'
      ? 'nayax-production-observed-2026-08-22'
    and result ->> 'approvalPolicyVersion' = 'db-authoritative-unknown-2xx-v1'
  from pg_temp.journal_v2_results where result_key = 'capability'
), 'The capability handshake publishes the exact supported contracts');

select public.service_record_nayax_refund_provider_stage_v2(
  'journal-v2-executor', '8f600000-0000-4000-8000-000000000001',
  'journal-v2-claim-1', 'request', 'started', null, null, null, null,
  repeat('a', 64), 'nayax-production-observed-2026-08-22', 'nayax-provider-journal-v2'
);
insert into pg_temp.journal_v2_results values (
  'accepted', public.service_record_nayax_refund_provider_stage_v2(
    'journal-v2-executor', '8f600000-0000-4000-8000-000000000001',
    'journal-v2-claim-1', 'request', 'result', 200, 'accepted', true, null,
    repeat('b', 64), 'nayax-production-observed-2026-08-22', 'nayax-provider-journal-v2')
);
select ok((select (result ->> 'approvalAuthorized')::boolean
  from pg_temp.journal_v2_results where result_key = 'accepted'),
  'Exact accepted HTTP 2xx request evidence authorizes approval');
select lives_ok($sql$select public.service_record_nayax_refund_provider_stage_v2(
  'journal-v2-executor', '8f600000-0000-4000-8000-000000000001',
  'journal-v2-claim-1', 'approve', 'started', null, null, null, null,
  repeat('c', 64), 'nayax-production-observed-2026-08-22', 'nayax-provider-journal-v2')$sql$,
  'Approval starts only after database authorization');

select public.service_record_nayax_refund_provider_stage_v2(
  'journal-v2-executor', '8f600000-0000-4000-8000-000000000002',
  'journal-v2-claim-2', 'request', 'started', null, null, null, null,
  repeat('d', 64), 'nayax-production-observed-2026-08-22', 'nayax-provider-journal-v2'
);
insert into pg_temp.journal_v2_results values (
  'unknown-2xx', public.service_record_nayax_refund_provider_stage_v2(
    'journal-v2-executor', '8f600000-0000-4000-8000-000000000002',
    'journal-v2-claim-2', 'request', 'result', 200, 'unknown', false, null,
    repeat('e', 64), 'nayax-production-observed-2026-08-22', 'nayax-provider-journal-v2')
);
select ok((select (result ->> 'approvalAuthorized')::boolean
  from pg_temp.journal_v2_results where result_key = 'unknown-2xx'),
  'Unfamiliar but successful HTTP 2xx request evidence authorizes one approval');
select lives_ok($sql$select public.service_record_nayax_refund_provider_stage_v2(
  'journal-v2-executor', '8f600000-0000-4000-8000-000000000002',
  'journal-v2-claim-2', 'approve', 'started', null, null, null, null,
  repeat('f', 64), 'nayax-production-observed-2026-08-22', 'nayax-provider-journal-v2')$sql$,
  'The database-authorized unfamiliar 2xx transition advances exactly once');

with fixtures(attempt_no, outcome) as (
  values (3, 'rejected'), (4, 'duplicate'), (5, 'already_refunded'), (6, 'pending')
)
select public.service_record_nayax_refund_provider_stage_v2(
  'journal-v2-executor',
  ('8f600000-0000-4000-8000-' || lpad(attempt_no::text, 12, '0'))::uuid,
  'journal-v2-claim-' || attempt_no, 'request', 'started', null, null, null, null,
  repeat(attempt_no::text, 64),
  'nayax-production-observed-2026-08-22', 'nayax-provider-journal-v2'
) from fixtures;
with fixtures(attempt_no, outcome) as (
  values (3, 'rejected'), (4, 'duplicate'), (5, 'already_refunded'), (6, 'pending')
)
insert into pg_temp.journal_v2_results
select 'known-' || outcome, public.service_record_nayax_refund_provider_stage_v2(
  'journal-v2-executor',
  ('8f600000-0000-4000-8000-' || lpad(attempt_no::text, 12, '0'))::uuid,
  'journal-v2-claim-' || attempt_no, 'request', 'result', 200, outcome, true, null,
  repeat((attempt_no + 1)::text, 64),
  'nayax-production-observed-2026-08-22', 'nayax-provider-journal-v2'
) from fixtures;
select ok((select bool_and(not (result ->> 'approvalAuthorized')::boolean)
  from pg_temp.journal_v2_results where result_key like 'known-%'),
  'Known rejection, duplicate, already-refunded, and pending outcomes all stop');
select ok((
  select bool_and(pg_temp.capture_error(format($sql$select public.service_record_nayax_refund_provider_stage_v2(
    'journal-v2-executor', %L, %L, 'approve', 'started', null, null, null, null,
    %L, 'nayax-production-observed-2026-08-22', 'nayax-provider-journal-v2')$sql$,
    ('8f600000-0000-4000-8000-' || lpad(attempt_no::text, 12, '0'))::uuid,
    'journal-v2-claim-' || attempt_no, repeat('9', 64)
  )) like '%Approval requires database-authorized request evidence%')
  from generate_series(3, 6) attempt_no
), 'No known non-success result can reach approval');

select public.service_record_nayax_refund_provider_stage_v2(
  'journal-v2-executor', '8f600000-0000-4000-8000-000000000007',
  'journal-v2-claim-7', 'request', 'started', null, null, null, null,
  repeat('a', 64), 'nayax-production-observed-2026-08-22', 'nayax-provider-journal-v2'
);
insert into pg_temp.journal_v2_results values (
  'non-2xx', public.service_record_nayax_refund_provider_stage_v2(
    'journal-v2-executor', '8f600000-0000-4000-8000-000000000007',
    'journal-v2-claim-7', 'request', 'result', 503, 'unknown', false, null,
    repeat('b', 64), 'nayax-production-observed-2026-08-22', 'nayax-provider-journal-v2')
);
select ok(not (select (result ->> 'approvalAuthorized')::boolean
  from pg_temp.journal_v2_results where result_key = 'non-2xx'),
  'A non-2xx response cannot authorize approval');
select ok(pg_temp.capture_error($sql$select public.service_record_nayax_refund_provider_stage_v2(
  'journal-v2-executor', '8f600000-0000-4000-8000-000000000007',
  'journal-v2-claim-7', 'approve', 'started', null, null, null, null,
  repeat('c', 64), 'nayax-production-observed-2026-08-22', 'nayax-provider-journal-v2')$sql$)
  like '%Approval requires database-authorized request evidence%',
  'A non-2xx response stops before approval');

select public.service_record_nayax_refund_provider_stage_v2(
  'journal-v2-executor', '8f600000-0000-4000-8000-000000000008',
  'journal-v2-claim-8', 'request', 'started', null, null, null, null,
  repeat('d', 64), 'nayax-production-observed-2026-08-22', 'nayax-provider-journal-v2'
);
insert into pg_temp.journal_v2_results values (
  'timeout', public.service_record_nayax_refund_provider_stage_v2(
    'journal-v2-executor', '8f600000-0000-4000-8000-000000000008',
    'journal-v2-claim-8', 'request', 'result', null, 'unknown', false, 'timeout',
    repeat('e', 64), 'nayax-production-observed-2026-08-22', 'nayax-provider-journal-v2')
);
select ok(not (select (result ->> 'approvalAuthorized')::boolean
  from pg_temp.journal_v2_results where result_key = 'timeout'),
  'A timeout cannot authorize approval');
select ok(pg_temp.capture_error($sql$select public.service_record_nayax_refund_provider_stage_v2(
  'journal-v2-executor', '8f600000-0000-4000-8000-000000000008',
  'journal-v2-claim-8', 'approve', 'started', null, null, null, null,
  repeat('f', 64), 'nayax-production-observed-2026-08-22', 'nayax-provider-journal-v2')$sql$)
  like '%Approval requires database-authorized request evidence%',
  'A timeout stops before approval');

select ok(pg_temp.capture_error($sql$select public.service_record_nayax_refund_provider_stage_v2(
  'journal-v2-executor', '8f600000-0000-4000-8000-000000000009',
  'journal-v2-claim-9', 'request', 'result', 200, 'accepted', true, null,
  repeat('1', 64), 'nayax-production-observed-2026-08-22', 'nayax-provider-journal-v2')$sql$)
  like '%result requires its started marker%',
  'A result cannot be journaled before its started marker');
select ok(pg_temp.capture_error($sql$select public.service_record_nayax_refund_provider_stage_v2(
  'journal-v2-executor', '8f600000-0000-4000-8000-000000000010',
  'journal-v2-claim-10', 'request', 'started', null, null, null, null,
  repeat('2', 64), 'wrong-provider-version', 'nayax-provider-journal-v2')$sql$)
  like '%contract version mismatch%',
  'A version mismatch fails before any provider stage can be recorded');
select is((select count(*)::integer from public.refund_nayax_provider_stage_journal
  where nayax_refund_attempt_id = '8f600000-0000-4000-8000-000000000010'), 0,
  'Version mismatch leaves no partial journal row');

select ok(
  not (
    public.refund_nayax_account_execution_hold('JOURNAL-V2-ACCOUNT')
      ->> 'blocked'
  )::boolean
  and (
    public.refund_nayax_account_execution_hold('JOURNAL-V2-ACCOUNT')
      ->> 'unresolvedCount'
  )::integer >= 10,
  'Journal v2 unresolved evidence remains visible without blocking another transaction'
);

select pg_catalog.set_config('bloomjoy.nayax_journal_contract_version', '', true);
select lives_ok($sql$insert into public.refund_case_nayax_refund_attempts (
  refund_case_id, actor_user_id, execution_mode, status, idempotency_key,
  amount_cents, currency_code, reconciliation_required
) values (
  '8f500000-0000-4000-8000-000000000012',
  '8f000000-0000-4000-8000-000000000001', 'request_and_approve', 'ambiguous',
  'journal-v2-legacy-compatible', 700, 'USD', true
)$sql$, 'Legacy and historical paths remain migration-compatible');

insert into pg_temp.journal_v2_results values (
  'health', public.service_get_refund_nayax_reliability_health('journal-v2-executor')
);
select ok((select result ->> 'status' = 'attention'
    and (result ->> 'unresolvedCount')::integer >= 10
    and result ->> 'ownerLabel' = 'Refund Operations'
    and (result ->> 'escalationSlaMinutes')::integer = 60
    and (result ->> 'payloadRedacted')::boolean
  from pg_temp.journal_v2_results where result_key = 'health'),
  'Reliability health exposes only aggregate alerting, ownership, and SLA state');

select * from finish();
rollback;
