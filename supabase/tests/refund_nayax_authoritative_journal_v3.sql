begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(30);

create function pg_temp.capture_error(statement text)
returns text language plpgsql as $$
begin
  execute statement;
  return null;
exception when others then
  return sqlstate || ':' || sqlerrm;
end;
$$;

create function pg_temp.start_v3(
  attempt_no integer,
  stage_name text,
  digest_character text
)
returns jsonb language sql as $$
  select public.service_record_nayax_refund_provider_stage_v3(
    'journal-v3-executor',
    ('9f600000-0000-4000-8000-' || lpad(attempt_no::text, 12, '0'))::uuid,
    'journal-v3-claim-' || attempt_no,
    stage_name,
    'started',
    null, null, null, null,
    repeat(digest_character, 64),
    'nayax-production-account-contract-v2',
    'nayax-provider-journal-v3',
    null, null, null, null, null, null, null, null, null, null, null, null
  );
$$;

create function pg_temp.result_v3(
  attempt_no integer,
  stage_name text,
  http_status integer,
  outcome_name text,
  contract_matched boolean,
  failure_type text,
  digest_character text,
  http_accepted boolean,
  media_type_class text,
  body_kind text,
  body_length_bucket text,
  json_parsed boolean,
  json_object_marker boolean,
  schema_matched boolean,
  result_key_present boolean,
  status_key_present boolean,
  result_value_type text,
  status_value_type text,
  semantic_pair_matched boolean
)
returns jsonb language sql as $$
  select public.service_record_nayax_refund_provider_stage_v3(
    'journal-v3-executor',
    ('9f600000-0000-4000-8000-' || lpad(attempt_no::text, 12, '0'))::uuid,
    'journal-v3-claim-' || attempt_no,
    stage_name,
    'result',
    http_status,
    outcome_name,
    contract_matched,
    failure_type,
    repeat(digest_character, 64),
    'nayax-production-account-contract-v2',
    'nayax-provider-journal-v3',
    http_accepted,
    media_type_class,
    body_kind,
    body_length_bucket,
    json_parsed,
    json_object_marker,
    schema_matched,
    result_key_present,
    status_key_present,
    result_value_type,
    status_value_type,
    semantic_pair_matched
  );
$$;

create temporary table journal_v3_results (
  result_key text primary key,
  result jsonb not null
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  '9f000000-0000-4000-8000-000000000001',
  'authenticated', 'authenticated', 'journal-v3-manager@example.test', '', now(),
  '{}'::jsonb, '{}'::jsonb, now(), now()
);

insert into public.customer_accounts (id, name, account_type) values
  ('9f100000-0000-4000-8000-000000000001', 'Journal v3 safety', 'customer'),
  ('9f100000-0000-4000-8000-000000000002', 'Journal v3 reservation', 'customer');

insert into public.reporting_locations (id, account_id, name, timezone) values
  (
    '9f200000-0000-4000-8000-000000000001',
    '9f100000-0000-4000-8000-000000000001',
    'Journal v3 safety location', 'America/Los_Angeles'
  ),
  (
    '9f200000-0000-4000-8000-000000000002',
    '9f100000-0000-4000-8000-000000000002',
    'Journal v3 reservation location', 'America/Los_Angeles'
  );

insert into public.reporting_machines (
  id, account_id, location_id, machine_label, status, nayax_machine_id,
  nayax_account_key, nayax_refunds_enabled, nayax_refund_max_amount_cents
) values
  (
    '9f300000-0000-4000-8000-000000000001',
    '9f100000-0000-4000-8000-000000000001',
    '9f200000-0000-4000-8000-000000000001',
    'Journal v3 machine', 'active', 'JOURNAL-V3-MACHINE',
    'JOURNAL-V3-ACCOUNT', true, 2500
  ),
  (
    '9f300000-0000-4000-8000-000000000002',
    '9f100000-0000-4000-8000-000000000002',
    '9f200000-0000-4000-8000-000000000002',
    'Journal v3 reservation machine', 'active', 'JOURNAL-V3-RESERVE',
    'JOURNAL-V3-RESERVE-ACCOUNT', true, 2500
  );

insert into public.reporting_machine_refund_managers (
  id, reporting_machine_id, manager_user_id, manager_email, grant_reason
) values
  (
    '9f400000-0000-4000-8000-000000000001',
    '9f300000-0000-4000-8000-000000000001',
    '9f000000-0000-4000-8000-000000000001',
    'journal-v3-manager@example.test', 'Journal v3 state-machine test'
  ),
  (
    '9f400000-0000-4000-8000-000000000002',
    '9f300000-0000-4000-8000-000000000002',
    '9f000000-0000-4000-8000-000000000001',
    'journal-v3-manager@example.test', 'Journal v3 reservation test'
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
  ('9f500000-0000-4000-8000-' || lpad(series::text, 12, '0'))::uuid,
  'RF-JOURNAL-V3-' || series,
  '9f300000-0000-4000-8000-000000000001'::uuid,
  '9f200000-0000-4000-8000-000000000001'::uuid,
  'journal-v3-' || series || '@example.test', 'Journal v3 matrix ' || series,
  statement_timestamp() - interval '1 day', 'card', 700, 700,
  'card_refund_pending', 'approved',
  '9f000000-0000-4000-8000-000000000001'::uuid,
  statement_timestamp() - interval '5 minutes', '4242', false,
  'matched', 'nayax', 1, 'JOURNAL-V3-TX-' || series, 900 + series,
  statement_timestamp() - interval '1 day', 700, '4242', 'USD',
  'high_confidence', 'journal-v3-test', statement_timestamp(), false, 'requested'
from generate_series(1, 15) series;

insert into public.refund_cases (
  id, public_reference, reporting_machine_id, reporting_location_id,
  customer_email, issue_summary, incident_at, payment_method,
  payment_amount_cents, refund_amount_cents, status, decision,
  card_last4, card_wallet_used, correlation_status, correlation_source,
  correlation_confidence, matched_nayax_transaction_id, matched_nayax_site_id,
  matched_nayax_machine_auth_time, matched_nayax_amount_cents,
  matched_nayax_card_last4, matched_nayax_currency_code,
  nayax_recommendation_state, nayax_recommendation_policy_version,
  nayax_recommendation_evaluated_at, nayax_match_execution_eligible
) values (
  '9f5f0000-0000-4000-8000-000000000001', 'RF-JOURNAL-V3-RESERVE',
  '9f300000-0000-4000-8000-000000000002',
  '9f200000-0000-4000-8000-000000000002',
  'journal-v3-reserve@example.test', 'Ready v3 reservation transaction',
  statement_timestamp() - interval '1 day', 'card', 700, 700,
  'needs_review', null, '4242', false, 'matched', 'nayax', 1,
  'JOURNAL-V3-RESERVE-TX', 999, statement_timestamp() - interval '1 day',
  700, '4242', 'USD', 'high_confidence', 'journal-v3-test',
  statement_timestamp(), true
);

insert into public.refund_case_events (
  refund_case_id, actor_user_id, event_type, message, metadata
) values (
  '9f5f0000-0000-4000-8000-000000000001',
  '9f000000-0000-4000-8000-000000000001',
  'nayax_match_selected', 'Manager selected the transaction.',
  '{"selected_recommended":true,"payload_redacted":true}'::jsonb
);

insert into public.refund_case_nayax_refund_attempts (
  id, refund_case_id, actor_user_id, execution_mode, status,
  idempotency_key, amount_cents, transaction_id_present, site_id_present,
  machine_auth_time_present, sanitized_request, sanitized_response,
  currency_code, provider_claim_digest, provider_claim_expires_at,
  reconciliation_required
)
select
  ('9f600000-0000-4000-8000-' || lpad(series::text, 12, '0'))::uuid,
  ('9f500000-0000-4000-8000-' || lpad(series::text, 12, '0'))::uuid,
  '9f000000-0000-4000-8000-000000000001'::uuid,
  'request_and_approve', 'in_progress',
  'journal-v3-' || series, 700, true, true, true,
  jsonb_build_object('payload_redacted', true), '{}'::jsonb, 'USD',
  encode(extensions.digest(
    convert_to('journal-v3-claim-' || series, 'UTF8'), 'sha256'
  ), 'hex'),
  statement_timestamp() + interval '15 minutes', true
from generate_series(1, 12) series;

-- Owner-only identity fixtures for classifier/journal tests; actual reservation is tested below.
insert into public.refund_nayax_execution_contexts(attempt_id,refund_case_id,context)
select a.id,c.id,jsonb_build_object('caseId',c.id,'reportingMachineId',m.id,'attemptGeneration',c.nayax_refund_attempt_generation,
  'accountScope',m.nayax_account_key,'providerMachineId',m.nayax_machine_id,'transactionId',c.matched_nayax_transaction_id,
  'siteId',c.matched_nayax_site_id,'originalAmountCents',c.matched_nayax_amount_cents,'currencyCode',c.matched_nayax_currency_code)
from public.refund_case_nayax_refund_attempts a join public.refund_cases c on c.id=a.refund_case_id
join public.reporting_machines m on m.id=c.reporting_machine_id where a.id::text like '9f6%'
  and a.id not in ('9f600000-0000-4000-8000-000000000011','9f600000-0000-4000-8000-000000000012');
insert into public.refund_nayax_provider_callers (caller_id, assertion_digest)
values (
  'nayax-card-refund',
  encode(extensions.digest(
    convert_to('journal-v3-executor', 'UTF8'), 'sha256'
  ), 'hex')
)
on conflict (caller_id) do update
set assertion_digest = excluded.assertion_digest,
  status = 'active',
  rotated_at = statement_timestamp();

select ok(
  not has_table_privilege(
    'service_role', 'public.refund_nayax_provider_stage_journal', 'select'
  )
  and not has_table_privilege(
    'authenticated', 'public.refund_nayax_provider_stage_journal', 'select'
  )
  and (
    select relrowsecurity from pg_class
    where oid = 'public.refund_nayax_provider_stage_journal'::regclass
  ),
  'The v3 journal remains private and protected by RLS'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.service_record_nayax_refund_provider_stage_v3(text,uuid,text,text,text,integer,text,boolean,text,text,text,text,boolean,text,text,text,boolean,boolean,boolean,boolean,boolean,text,text,boolean)',
    'execute'
  )
  and has_function_privilege(
    'service_role',
    'public.service_reserve_nayax_refund_manager_action_v3(text,uuid,uuid,bigint,text,integer,integer,integer,text,text,text,text)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'public.service_record_nayax_refund_provider_stage_v3(text,uuid,text,text,text,integer,text,boolean,text,text,text,text,boolean,text,text,text,boolean,boolean,boolean,boolean,boolean,text,text,boolean)',
    'execute'
  ),
  'Only service_role can execute the assertion-protected v3 boundaries'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.service_record_nayax_refund_provider_stage_v2(text,uuid,text,text,text,integer,text,boolean,text,text,text,text)',
    'execute'
  )
  and not has_function_privilege(
    'service_role',
    'public.service_reserve_nayax_refund_manager_action_v2(text,uuid,uuid,bigint,text,integer,integer,integer,text,text,text)',
    'execute'
  ),
  'Historical v2 journal remains callable but cannot reserve a fresh context-free attempt'
);

select ok(
  not has_function_privilege(
    'service_role',
    'public.service_record_nayax_refund_provider_stage(text,uuid,uuid,text,text,text,integer,text,boolean,text,text)',
    'execute'
  )
  and not has_function_privilege(
    'service_role',
    'public.service_reserve_nayax_pending_approval_recovery(text,uuid,uuid,uuid,bigint,text)',
    'execute'
  )
  and not has_function_privilege(
    'service_role',
    'public.service_settle_nayax_pending_approval_recovery(text,uuid,uuid,uuid,text,text,text,text,text)',
    'execute'
  ),
  'service_role cannot reserve, journal, or settle legacy approval-only recovery'
);

insert into pg_temp.journal_v3_results values (
  'capability',
  public.service_get_nayax_refund_provider_journal_capability_v3(
    'journal-v3-executor'
  )
);
select ok((
  select result ->> 'journalContractVersion' = 'nayax-provider-journal-v3'
    and result ->> 'approvalPolicyVersion' =
      'db-authoritative-exact-200-json-v1'
    and result ->> 'responseEnvelopeVersion' =
      'nayax-response-envelope-v1'
    and result -> 'supportedProviderContractVersions'
      ? 'nayax-production-account-contract-v2'
    and (result ->> 'providerContractConfirmationRequired')::boolean
    and (result ->> 'payloadRedacted')::boolean
  from pg_temp.journal_v3_results where result_key = 'capability'
), 'The v3 capability publishes every exact fail-closed handshake marker');

select pg_temp.start_v3(1, 'request', 'a');
select ok(
  exists (
    select 1 from public.refund_nayax_provider_stage_journal
    where nayax_refund_attempt_id = '9f600000-0000-4000-8000-000000000001'
      and stage = 'request'
      and event = 'started'
      and http_accepted is null
      and schema_matched is null
      and semantic_pair_matched is null
  ),
  'A v3 started marker cannot claim response metadata'
);

insert into pg_temp.journal_v3_results values (
  'accepted', pg_temp.result_v3(
    1, 'request', 200, 'accepted', true, null, 'b', true,
    'application_json', 'json_object', '1_256', true, true, true,
    true, true, 'string', 'string', true
  )
);
select ok((
  select (result ->> 'approvalAuthorized')::boolean
    and result ->> 'approvalPolicyVersion' =
      'db-authoritative-exact-200-json-v1'
    and result ->> 'responseEnvelopeVersion' =
      'nayax-response-envelope-v1'
    and not (result ->> 'refundOperationsRequired')::boolean
  from pg_temp.journal_v3_results where result_key = 'accepted'
), 'Only the exact HTTP 200 JSON schema and accepted semantic pair authorizes approval');
select lives_ok(
  $sql$select pg_temp.start_v3(1, 'approve', 'c')$sql$,
  'Approval starts after the database-authorized exact v3 request result'
);

select pg_temp.start_v3(2, 'request', 'd');
insert into pg_temp.journal_v3_results values (
  'unknown-200', pg_temp.result_v3(
    2, 'request', 200, 'unknown', false, null, 'e', true,
    'application_json', 'json_object', '1_256', true, true, true,
    true, true, 'string', 'string', false
  )
);
select ok((
  select not (result ->> 'approvalAuthorized')::boolean
    and result ->> 'safeFailureClass' = 'provider_semantic_mismatch'
    and (result ->> 'refundOperationsRequired')::boolean
  from pg_temp.journal_v3_results where result_key = 'unknown-200'
), 'An unfamiliar HTTP 200 semantic pair enters Refund Operations and cannot advance');
select ok(
  pg_temp.capture_error(
    $sql$select pg_temp.start_v3(2, 'approve', 'f')$sql$
  ) like '%Approval requires database-authorized exact request evidence%',
  'The former unknown-2xx request-to-approval transition is absent from v3'
);

select pg_temp.start_v3(3, 'request', '1');
insert into pg_temp.journal_v3_results values (
  'json-suffix', pg_temp.result_v3(
    3, 'request', 200, 'unknown', false, null, '2', true,
    'json_suffix', 'json_object', '1_256', true, true, true,
    true, true, 'string', 'string', true
  )
);
select ok((
  select not (result ->> 'approvalAuthorized')::boolean
    and result ->> 'safeFailureClass' = 'provider_response_invalid'
  from pg_temp.journal_v3_results where result_key = 'json-suffix'
), 'A classified JSON suffix is journaled but is not authorized as application/json');

select pg_temp.start_v3(4, 'request', '3');
insert into pg_temp.journal_v3_results values (
  'http-201', pg_temp.result_v3(
    4, 'request', 201, 'unknown', false, null, '4', false,
    'application_json', 'json_object', '1_256', true, true, true,
    true, true, 'string', 'string', true
  )
);
select ok((
  select not (result ->> 'approvalAuthorized')::boolean
    and result ->> 'safeFailureClass' = 'provider_http_error'
  from pg_temp.journal_v3_results where result_key = 'http-201'
), 'HTTP 201 cannot substitute for the account contract exact HTTP 200');

select pg_temp.start_v3(5, 'request', '5');
insert into pg_temp.journal_v3_results values (
  'malformed', pg_temp.result_v3(
    5, 'request', 200, 'unknown', false, null, '6', true,
    'application_json', 'malformed_json', '1_256', false, false, false,
    false, false, 'missing', 'missing', false
  )
);
select ok((
  select not (result ->> 'approvalAuthorized')::boolean
    and result ->> 'safeFailureClass' = 'provider_response_invalid'
  from pg_temp.journal_v3_results where result_key = 'malformed'
), 'Malformed JSON is distinguishable, held, and never approval-authorizing');

select pg_temp.start_v3(6, 'request', '7');
insert into pg_temp.journal_v3_results values (
  'response-read', pg_temp.result_v3(
    6, 'request', 200, 'unknown', false, 'response_read', '8', true,
    'application_json', 'read_error', 'unavailable', false, false, false,
    false, false, 'unavailable', 'unavailable', false
  )
);
select ok((
  select not (result ->> 'approvalAuthorized')::boolean
    and result ->> 'safeFailureClass' = 'provider_response_invalid'
    and (result ->> 'refundOperationsRequired')::boolean
  from pg_temp.journal_v3_results where result_key = 'response-read'
), 'A response-read failure retains HTTP truth but enters the confirmation hold');

select ok(
  pg_temp.capture_error($sql$select pg_temp.result_v3(
    7, 'request', 200, 'accepted', true, null, '9', true,
    'application_json', 'json_object', '1_256', true, true, true,
    true, true, 'string', 'string', true
  )$sql$) like '%result requires its started marker%',
  'A v3 result cannot be journaled before its matching v3 started marker'
);

select pg_temp.start_v3(8, 'request', 'a');
select ok(
  pg_temp.capture_error($sql$select public.service_record_nayax_refund_provider_stage_v3(
    'journal-v3-executor', '9f600000-0000-4000-8000-000000000008',
    'journal-v3-claim-8', 'request', 'result', 200, 'accepted', true, null,
    repeat('b', 64), 'nayax-production-account-contract-v2',
    'nayax-provider-journal-v3',
    null, null, null, null, null, null, null, null, null, null, null, null
  )$sql$) like '%Invalid sanitized Nayax stage result%',
  'Every v3 result requires the complete redacted response envelope'
);

select ok(
  pg_temp.capture_error($sql$select public.service_record_nayax_refund_provider_stage_v3(
    'journal-v3-executor', '9f600000-0000-4000-8000-000000000009',
    'journal-v3-claim-9', 'request', 'started', null, null, null, null,
    repeat('c', 64), 'nayax-production-observed-2026-08-22',
    'nayax-provider-journal-v3',
    null, null, null, null, null, null, null, null, null, null, null, null
  )$sql$) like '%contract version mismatch%'
  and not exists (
    select 1 from public.refund_nayax_provider_stage_journal
    where nayax_refund_attempt_id = '9f600000-0000-4000-8000-000000000009'
  ),
  'The stale observed-v1 provider contract cannot negotiate journal v3'
);

insert into public.refund_nayax_lookup_candidates(token,refund_case_id,lookup_generation,actor_user_id,reporting_machine_id,
  provider_transaction_id,site_id,machine_authorization_time,amount_cents,card_last4,currency_code,evidence_summary,expires_at)
select gen_random_uuid(),c.id,c.nayax_lookup_generation,'9f000000-0000-4000-8000-000000000001',c.reporting_machine_id,
  c.matched_nayax_transaction_id,c.matched_nayax_site_id,c.matched_nayax_machine_auth_time,c.matched_nayax_amount_cents,
  c.matched_nayax_card_last4,c.matched_nayax_currency_code,
  '{"machine_authorization_time_raw":"2026-08-26T13:17:08.123","machine_authorization_time_source":"MachineAuthorizationTime"}'::jsonb||jsonb_build_object('lookup_account_scope',regexp_replace(upper(btrim(m.nayax_account_key)),'[^A-Z0-9_]','_','g'),'lookup_provider_machine_id',m.nayax_machine_id,'provider_machine_id',m.nayax_machine_id),now()+interval '1 hour'
  from public.refund_cases c join public.reporting_machines m on m.id=c.reporting_machine_id where c.id='9f5f0000-0000-4000-8000-000000000001';
select ok(
  pg_temp.capture_error(format(
    $sql$select public.service_reserve_nayax_refund_manager_action_v3(
      'journal-v3-executor', '9f000000-0000-4000-8000-000000000001',
      '9f5f0000-0000-4000-8000-000000000001', %s,
      'nayax-refund-%s', 700, 100000, 100, 'USD',
      'nayax-production-observed-2026-08-22', 'nayax-provider-journal-v3',public.refund_nayax_selected_execution_context('9f5f0000-0000-4000-8000-000000000001')->>'contextHash')$sql$,
    (select official_action_version from public.refund_cases
      where id = '9f5f0000-0000-4000-8000-000000000001'),
    repeat('d', 64)
  )) like '%contract version mismatch%',
  'The v3 reservation wrapper rejects the stale provider contract before mutation'
);

insert into pg_temp.journal_v3_results (result_key, result)
select 'reservation', public.service_reserve_nayax_refund_manager_action_v3(
  'journal-v3-executor',
  '9f000000-0000-4000-8000-000000000001',
  '9f5f0000-0000-4000-8000-000000000001',
  (select official_action_version from public.refund_cases
    where id = '9f5f0000-0000-4000-8000-000000000001'),
  'nayax-refund-' || repeat('e', 64), 700, 100000, 100, 'USD',
  'nayax-production-account-contract-v2', 'nayax-provider-journal-v3',public.refund_nayax_selected_execution_context('9f5f0000-0000-4000-8000-000000000001')->>'contextHash'
);
select ok((
  select (result #>> '{attempt,shouldExecute}')::boolean
    and length(result ->> 'providerClaimToken') = 64
  from pg_temp.journal_v3_results where result_key = 'reservation'
) and current_setting('bloomjoy.nayax_journal_contract_version', true) =
    'nayax-provider-journal-v3',
  'The v3 wrapper reserves once and sets the transaction-local journal version'
);

select ok(
  not exists (
    select 1
    from pg_catalog.pg_trigger
    where tgname = 'refund_nayax_account_circuit_breaker'
      and not tgisinternal
  ),
  'Production removes the account-wide circuit-breaker trigger'
);

select ok(
  not (
    public.refund_nayax_account_execution_hold('JOURNAL-V3-ACCOUNT')
      ->> 'blocked'
  )::boolean
  and (
    public.refund_nayax_account_execution_hold('JOURNAL-V3-ACCOUNT')
      ->> 'unresolvedCount'
  )::integer >= 1,
  'Journal v2/v3 account history is observable but never blocks unrelated transactions'
);

select pg_catalog.set_config('bloomjoy.nayax_journal_contract_version', '', true);
select lives_ok($sql$insert into public.refund_case_nayax_refund_attempts (
  refund_case_id, actor_user_id, execution_mode, status, idempotency_key,
  amount_cents, currency_code, reconciliation_required
) values (
  '9f500000-0000-4000-8000-000000000015',
  '9f000000-0000-4000-8000-000000000001', 'request_and_approve', 'ambiguous',
  'journal-v3-legacy-compatible', 700, 'USD', true
)$sql$, 'Historical non-negotiated insert paths remain migration-compatible');

select pg_temp.start_v3(10, 'request', 'd');
insert into pg_temp.journal_v3_results values (
  'rejected-v3', pg_temp.result_v3(
    10, 'request', 200, 'rejected', true, null, 'e', true,
    'application_json', 'json_object', '1_256', true, true, true,
    true, true, 'string', 'string', true
  )
);
select ok((
  select not (result ->> 'approvalAuthorized')::boolean
    and (result ->> 'definitiveNoRefund')::boolean
    and not (result ->> 'refundOperationsRequired')::boolean
    and result ->> 'safeFailureClass' = 'provider_rejected'
  from pg_temp.journal_v3_results where result_key = 'rejected-v3'
) and exists (
  select 1 from public.refund_case_nayax_refund_attempts
  where id = '9f600000-0000-4000-8000-000000000010'
    and safe_failure_class = 'provider_rejected'
    and refund_operations_due_at is null
), 'An exact v3 rejection is definitive no-refund evidence, not an exception hold');

update public.refund_case_nayax_refund_attempts
set status = 'declined',
  provider_outcome = 'rejected',
  provider_outcome_recorded_at = statement_timestamp(),
  provider_claim_consumed_at = statement_timestamp(),
  reconciliation_required = false,
  completed_at = statement_timestamp()
where id = '9f600000-0000-4000-8000-000000000010';
select ok(
  public.refund_nayax_definitive_rejection_is_retry_safe(
    '9f600000-0000-4000-8000-000000000010'
  ),
  'The definitive-rejection release helper recognizes exact v3 evidence'
);

select public.service_record_nayax_refund_provider_stage_v2(
  'journal-v3-executor', '9f600000-0000-4000-8000-000000000011',
  'journal-v3-claim-11', 'request', 'started', null, null, null, null,
  repeat('f', 64), 'nayax-production-observed-2026-08-22',
  'nayax-provider-journal-v2'
);
select public.service_record_nayax_refund_provider_stage_v2(
  'journal-v3-executor', '9f600000-0000-4000-8000-000000000011',
  'journal-v3-claim-11', 'request', 'result', 200, 'rejected', true, null,
  repeat('1', 64), 'nayax-production-observed-2026-08-22',
  'nayax-provider-journal-v2'
);
update public.refund_case_nayax_refund_attempts
set status = 'declined',
  provider_outcome = 'rejected',
  provider_outcome_recorded_at = statement_timestamp(),
  provider_claim_consumed_at = statement_timestamp(),
  reconciliation_required = false,
  completed_at = statement_timestamp()
where id = '9f600000-0000-4000-8000-000000000011';
select ok(
  public.refund_nayax_definitive_rejection_is_retry_safe(
    '9f600000-0000-4000-8000-000000000011'
  ),
  'The definitive-rejection release helper preserves exact v2 evidence'
);

select public.service_record_nayax_refund_provider_stage_v2(
  'journal-v3-executor', '9f600000-0000-4000-8000-000000000012',
  'journal-v3-claim-12', 'request', 'started', null, null, null, null,
  repeat('2', 64), 'nayax-production-observed-2026-08-22',
  'nayax-provider-journal-v2'
);
insert into pg_temp.journal_v3_results values (
  'unknown-v2', public.service_record_nayax_refund_provider_stage_v2(
    'journal-v3-executor', '9f600000-0000-4000-8000-000000000012',
    'journal-v3-claim-12', 'request', 'result', 200, 'unknown', false, null,
    repeat('3', 64), 'nayax-production-observed-2026-08-22',
    'nayax-provider-journal-v2'
  )
);
select ok((
  select (result ->> 'approvalAuthorized')::boolean
  from pg_temp.journal_v3_results where result_key = 'unknown-v2'
), 'The additive migration does not silently change journal v2 rollback semantics');

select ok(
  exists (
    select 1 from public.refund_nayax_provider_stage_journal
    where nayax_refund_attempt_id = '9f600000-0000-4000-8000-000000000001'
      and stage = 'request'
      and event = 'result'
      and http_accepted is true
      and media_type_class = 'application_json'
      and body_kind = 'json_object'
      and body_length_bucket = '1_256'
      and json_parsed is true
      and body_json_object is true
      and schema_matched is true
      and result_key_present is true
      and status_key_present is true
      and result_value_type = 'string'
      and status_value_type = 'string'
      and semantic_pair_matched is true
      and payload_redacted is true
  ),
  'The journal persists only the approved coarse response-envelope metadata'
);

select is((
  select count(*)::integer
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'refund_nayax_provider_stage_journal'
    and column_name in (
      'raw_body', 'response_body', 'response_headers',
      'result_value', 'status_value', 'provider_response'
    )
), 0, 'The v3 journal has no raw body, header, or exact provider-value columns');

select ok(
  exists (
    select 1 from public.refund_nayax_provider_stage_journal
    where nayax_refund_attempt_id = '9f600000-0000-4000-8000-000000000006'
      and failure_type = 'response_read'
      and body_kind = 'read_error'
      and body_length_bucket = 'unavailable'
  ),
  'Response-read failures retain only privacy-safe unavailable markers'
);

select ok(
  exists (
    select 1 from public.refund_nayax_provider_stage_journal
    where nayax_refund_attempt_id = '9f600000-0000-4000-8000-000000000002'
      and stage = 'request'
      and event = 'result'
      and http_status = 200
      and approval_authorized is false
      and schema_matched is true
      and semantic_pair_matched is false
  ),
  'The database row itself records that unknown HTTP 200 evidence did not authorize approval'
);

select * from finish();
rollback;
