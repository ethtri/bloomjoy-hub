begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(25);

create function pg_temp.set_auth_claims(p_user_id uuid)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p_user_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', p_user_id, 'role', 'authenticated', 'is_anonymous', false
  )::text, true);
end;
$$;

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', '75100000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'selected-transaction-manager@example.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '75100000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'unrelated-manager@example.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now());

insert into public.customer_accounts (id, name, account_type)
values ('75110000-0000-4000-8000-000000000001', 'Selected transaction fixture', 'internal');

insert into public.reporting_locations (id, account_id, name, timezone)
values (
  '75120000-0000-4000-8000-000000000001',
  '75110000-0000-4000-8000-000000000001',
  'Selected transaction location',
  'America/New_York'
);

insert into public.reporting_machines (
  id, account_id, location_id, machine_label, status,
  nayax_machine_id, nayax_account_key
) values
  (
    '75130000-0000-4000-8000-000000000001',
    '75110000-0000-4000-8000-000000000001',
    '75120000-0000-4000-8000-000000000001',
    'Selected transaction machine', 'active',
    'SAFE-MACHINE-751', 'TGPACI_USA_DB'
  ),
  (
    '75130000-0000-4000-8000-000000000002',
    '75110000-0000-4000-8000-000000000001',
    '75120000-0000-4000-8000-000000000001',
    'Unrelated manager machine', 'active',
    'SAFE-MACHINE-UNRELATED-751', 'TGPACI_USA_DB'
  );

insert into public.reporting_machine_refund_managers (
  reporting_machine_id, manager_user_id, manager_email, grant_reason
) values
  (
    '75130000-0000-4000-8000-000000000001',
    '75100000-0000-4000-8000-000000000001',
    'selected-transaction-manager@example.invalid',
    'Selected transaction manager fixture'
  ),
  (
    '75130000-0000-4000-8000-000000000002',
    '75100000-0000-4000-8000-000000000002',
    'unrelated-manager@example.invalid',
    'Unrelated manager isolation fixture'
  );

insert into public.refund_nayax_machine_inventory (
  account_key, nayax_machine_id, reporting_machine_id,
  provider_clock_timezone, provider_clock_source,
  provider_clock_observed_at, provider_clock_daylight_saving
) values (
  'TGPACI_USA_DB', 'SAFE-MACHINE-751',
  '75130000-0000-4000-8000-000000000001',
  'America/Los_Angeles', 'native_machine_configuration',
  '2026-08-31T17:00:00Z', true
);

insert into public.refund_cases (
  id, public_reference, reporting_machine_id, reporting_location_id,
  customer_email, issue_summary, incident_at, incident_local_datetime,
  incident_timezone, incident_time_resolution, payment_method,
  payment_amount_cents, card_last4, card_last4_provenance, card_network,
  card_wallet_used, payment_interaction, wallet_provider,
  status, correlation_status, correlation_source, correlation_confidence,
  correlation_summary, decision, decision_reason, decided_by, decided_at,
  refund_amount_cents, matched_nayax_transaction_id, matched_nayax_site_id,
  matched_nayax_machine_auth_time, matched_nayax_amount_cents,
  matched_nayax_card_last4, matched_nayax_currency_code,
  nayax_recommendation_state, nayax_recommendation_policy_version,
  nayax_recommendation_evaluated_at, nayax_match_execution_eligible
) values (
  '75140000-0000-4000-8000-000000000001', 'RF-SELECTED-751',
  '75130000-0000-4000-8000-000000000001',
  '75120000-0000-4000-8000-000000000001',
  'selected-transaction-customer@example.invalid',
  'Selected transaction evidence fixture',
  '2026-08-31T18:10:00Z', '2026-08-31T14:10:00',
  'America/New_York', 'exact', 'card', 800, '4242', 'wallet_device_token',
  'visa', true, 'phone_watch_wallet', 'apple_pay',
  'card_refund_pending', 'matched', 'nayax', 0.98,
  'Exact machine, amount, time, and wallet evidence.',
  'approved', 'Confirmed exact provider sale.',
  '75100000-0000-4000-8000-000000000001', '2026-08-31T18:20:00Z',
  800, 'NAYAX-751000001', 751,
  '2026-08-31T18:07:00Z', 800, '9999', 'USD',
  'high_confidence', 'selected-evidence-test.v1',
  '2026-08-31T18:15:00Z', false
);

insert into public.refund_nayax_lookup_candidates (
  token, refund_case_id, actor_user_id, provider_transaction_id,
  site_id, machine_authorization_time, amount_cents, card_last4,
  currency_code, evidence_summary, expires_at, reporting_machine_id
) values (
  '75150000-0000-4000-8000-000000000001',
  '75140000-0000-4000-8000-000000000001',
  '75100000-0000-4000-8000-000000000001',
  'NAYAX-751000001', 751, '2026-08-31T18:07:00Z', 800, '9999', 'USD',
  jsonb_build_object(
    'provider_time_resolution', 'exact',
    'provider_time_source', 'authorization_gmt',
    'authorized_at', '2026-08-31T18:08:00Z',
    'machine_time_resolution', 'exact',
    'machine_clock_context', jsonb_build_object(
      'reportingMachineId', '75130000-0000-4000-8000-000000000001',
      'timezone', 'America/Los_Angeles',
      'source', 'native_machine_configuration',
      'observedAt', '2026-08-31T17:00:00Z'
    ),
    'transaction_occurrence_comparable', false,
    'transaction_occurrence_semantics', 'unknown',
    'transaction_occurrence_timezone_basis', null,
    'card_network', 'visa',
    'recognition_method', 'wallet',
    'match_reason', 'Exact machine, amount, time, and wallet evidence',
    'match_factors', jsonb_build_array(
      jsonb_build_object('key', 'machine', 'outcome', 'match', 'label', 'Exact mapped machine and location'),
      jsonb_build_object('key', 'amount', 'outcome', 'match', 'label', 'Transaction amount matches exactly')
    ),
    'provider_payload_redacted', true
  ),
  '9999-12-31T23:59:59.999999Z',
  '75130000-0000-4000-8000-000000000001'
);

select ok(
  has_function_privilege(
    'authenticated', 'public.admin_get_refund_operations_overview()', 'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'public.admin_get_refund_operations_overview_pre_selected_nayax_evidence_v1()',
    'execute'
  ),
  'Authenticated managers can reach only the current actor-scoped overview'
);

set local role authenticated;
select pg_temp.set_auth_claims('75100000-0000-4000-8000-000000000001');

select is(
  public.admin_get_refund_operations_overview() ->> 'selectedNayaxTransactionContractVersion',
  'refund_selected_nayax_transaction_v1',
  'The overview versions the selected transaction contract'
);

select is(
  public.admin_get_refund_operations_overview() ->> 'candidateTimeContractVersion',
  'refund_candidate_time_v1',
  'The overview versions the redacted candidate timestamp contract'
);

create temporary table selected_transaction_contract as
select item -> 'selectedNayaxTransaction' as evidence
from jsonb_array_elements(
  public.admin_get_refund_operations_overview() -> 'cases'
) item
where item ->> 'id' = '75140000-0000-4000-8000-000000000001';

select is(
  (select evidence ->> 'transactionId' from selected_transaction_contract),
  'NAYAX-751000001',
  'The selected exact provider transaction ID is copyable after selection'
);

select ok(
  (select (evidence ->> 'saleAmountCents')::integer = 800
    and evidence ->> 'currencyCode' = 'USD'
    from selected_transaction_contract),
  'The selected provider sale amount and currency are authoritative and explicit'
);

select ok(
  (select evidence ->> 'machineLabel' = 'Selected transaction machine'
    and evidence ->> 'locationName' = 'Selected transaction location'
    from selected_transaction_contract),
  'The selected provider sale stays bound to the visible machine and location'
);

select ok(
  (select evidence ->> 'customerReportedAt' = '2026-08-31T18:10:00+00:00'
    and evidence ->> 'providerAuthorizedAt' = '2026-08-31T18:07:00+00:00'
    and evidence ->> 'machineTimezone' = 'America/New_York'
    and evidence ->> 'providerTimeResolution' = 'exact'
    from selected_transaction_contract),
  'Customer-reported and provider times share an explicit machine timezone without being conflated'
);

select ok(
  (select evidence ->> 'cardLast4' = '9999'
    and evidence ->> 'cardNetwork' = 'visa'
    and evidence ->> 'recognitionMethod' = 'wallet'
    and evidence ->> 'paymentInteraction' = 'phone_watch_wallet'
    and evidence ->> 'walletProvider' = 'apple_pay'
    from selected_transaction_contract),
  'The selected contract exposes only safe card and wallet context'
);

select ok(
  (select evidence ->> 'matchExplanation' = 'Exact machine, amount, time, and wallet evidence'
    and jsonb_array_length(evidence -> 'matchFactors') = 2
    from selected_transaction_contract),
  'The selected contract explains why the sale was matched'
);

select ok(
  (select (evidence ->> 'payloadRedacted')::boolean
    and evidence ->> 'evidenceSource' = 'nayax_last_sales'
    and not evidence ? 'providerPayload'
    and not evidence ? 'accountToken'
    from selected_transaction_contract),
  'The selected contract is explicitly redacted and contains no raw provider payload or credential'
);

select ok(
  (select evidence ->> 'customerTimezone' = 'America/New_York'
    and evidence ->> 'providerTimestampAt' = '2026-08-31T18:08:00Z'
    and evidence #>> '{timeEvidence,machineClockTimezone}' = 'America/Los_Angeles'
    and evidence #>> '{timeEvidence,providerTimestampSource}' = 'authorization_gmt'
    from selected_transaction_contract),
  'Selected evidence distinguishes customer, venue, provider, and verified machine-clock time'
);

select is(
  (
    select item ->> 'incidentLocalDateTime'
    from jsonb_array_elements(
      public.admin_get_refund_operations_overview() -> 'cases'
    ) item
    where item ->> 'id' = '75140000-0000-4000-8000-000000000001'
  ),
  '2026-08-31T14:10:00',
  'The manager contract preserves the bounded customer-entered wall clock'
);

create temporary table candidate_time_contract as
select item -> 'nayaxLookupCandidates' -> 0 -> 'timeEvidence' as evidence,
  item -> 'nayaxLookupCandidates' -> 0 as candidate
from jsonb_array_elements(
  public.admin_get_refund_operations_overview() -> 'cases'
) item
where item ->> 'id' = '75140000-0000-4000-8000-000000000001';

select ok(
  (select candidate ->> 'authorizedAt' = '2026-08-31T18:07:00+00:00'
    and candidate ->> 'providerTimestampAt' = '2026-08-31T18:08:00Z'
    and evidence ->> 'schemaVersion' = 'refund_candidate_time_v1'
    and evidence ->> 'machineClockTimezone' = 'America/Los_Angeles'
    and (evidence ->> 'occurrenceComparable')::boolean is false
    from candidate_time_contract),
  'Visible candidates carry normalized provider time and bounded comparison semantics'
);

select ok(
  (select (evidence ->> 'payloadRedacted')::boolean
    and not candidate ? 'machineAuthorizationTimeRaw'
    and not candidate ? 'machineClockContext'
    and not evidence ? 'reportingMachineId'
    and not evidence ? 'observedAt'
    from candidate_time_contract),
  'Candidate timestamp labels do not expose raw wall clocks or provider clock records'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.refund_candidate_time_evidence_v1(jsonb)',
    'execute'
  ) and not has_function_privilege(
    'authenticated',
    'public.refund_project_candidate_time_evidence_v1(jsonb)',
    'execute'
  ),
  'Authenticated managers cannot call the private timestamp projection helpers directly'
);

select is(
  (
    select count(*)::integer
    from jsonb_array_elements(
      public.admin_get_refund_operations_overview() -> 'cases'
    ) item
    where item -> 'nayaxLookupCandidates' -> 0 ? 'providerTransactionId'
  ),
  0,
  'Unselected candidate projections remain tokenized without provider transaction IDs'
);

select ok(
  (
    select item -> 'selectedNayaxTransaction' ->> 'transactionId' =
      item ->> 'matchedNayaxTransactionId'
      or item ->> 'matchedNayaxTransactionId' is null
    from jsonb_array_elements(
      public.admin_get_refund_operations_overview() -> 'cases'
    ) item
    where item ->> 'id' = '75140000-0000-4000-8000-000000000001'
  ),
  'The visible provider reference is derived from the immutable transaction already selected on the case'
);

reset role;

insert into public.refund_nayax_lookup_candidates (
  token, refund_case_id, actor_user_id, provider_transaction_id,
  site_id, machine_authorization_time, amount_cents, card_last4,
  currency_code, evidence_summary, expires_at, reporting_machine_id, created_at
) values (
  '75150000-0000-4000-8000-000000000002',
  '75140000-0000-4000-8000-000000000001',
  '75100000-0000-4000-8000-000000000001',
  'NAYAX-751000001', 999, '2026-08-31T19:07:00Z', 900, '1111', 'USD',
  jsonb_build_object(
    'provider_time_resolution', 'unknown',
    'provider_time_source', 'unverified_location_clock',
    'authorized_at', '2026-08-31T23:59:00Z',
    'machine_time_resolution', 'ambiguous',
    'transaction_occurrence_comparable', false,
    'transaction_occurrence_semantics', 'unknown',
    'transaction_occurrence_timezone_basis', null
  ),
  '9999-12-31T23:59:59.999999Z',
  '75130000-0000-4000-8000-000000000001',
  '2026-09-01T00:00:00Z'
);

set local role authenticated;
select pg_temp.set_auth_claims('75100000-0000-4000-8000-000000000001');

select is(
  (
    select item #>> '{selectedNayaxTransaction,providerTimestampAt}'
    from jsonb_array_elements(
      public.admin_get_refund_operations_overview() -> 'cases'
    ) item
    where item ->> 'id' = '75140000-0000-4000-8000-000000000001'
  ),
  '2026-08-31T18:08:00Z',
  'Selected time evidence stays bound to the full immutable sale identity across later representations'
);

reset role;

update public.refund_cases
set incident_timezone = 'Invalid/Legacy Zone'
where id = '75140000-0000-4000-8000-000000000001';

set local role authenticated;
select pg_temp.set_auth_claims('75100000-0000-4000-8000-000000000001');

select is(
  (
    select item ->> 'incidentTimezone'
    from jsonb_array_elements(
      public.admin_get_refund_operations_overview() -> 'cases'
    ) item
    where item ->> 'id' = '75140000-0000-4000-8000-000000000001'
  ),
  'America/New_York',
  'An invalid legacy case timezone falls back to the catalog-backed venue zone'
);

reset role;

update public.reporting_locations
set timezone = 'Invalid/Legacy Zone'
where id = '75120000-0000-4000-8000-000000000001';

set local role authenticated;
select pg_temp.set_auth_claims('75100000-0000-4000-8000-000000000001');

select ok(
  (
    select item ? 'incidentTimezone'
      and item -> 'incidentTimezone' = 'null'::jsonb
    from jsonb_array_elements(
      public.admin_get_refund_operations_overview() -> 'cases'
    ) item
    where item ->> 'id' = '75140000-0000-4000-8000-000000000001'
  ),
  'Invalid case and venue zones degrade one case to unavailable without hiding the manager queue'
);

select pg_temp.set_auth_claims('75100000-0000-4000-8000-000000000002');

select is(
  (
    select count(*)::integer
    from jsonb_array_elements(
      public.admin_get_refund_operations_overview() -> 'cases'
    ) item
    where item ->> 'id' = '75140000-0000-4000-8000-000000000001'
  ),
  0,
  'An unrelated manager cannot discover the case or its selected provider reference'
);

select is(
  (
    select count(*)::integer
    from jsonb_array_elements(
      public.admin_get_refund_operations_overview() -> 'cases'
    ) item
    where item::text like '%NAYAX-751000001%'
  ),
  0,
  'The unrelated manager overview contains no selected provider identifier'
);

reset role;

create temporary table refund_timezone_projection_benchmark (
  case_count integer not null,
  projected_count integer not null,
  elapsed_ms numeric not null
) on commit drop;

do $benchmark$
declare
  started_at timestamptz;
  projected jsonb;
  case_count integer;
begin
  foreach case_count in array array[61, 200] loop
    started_at := clock_timestamp();
    select public.refund_project_candidate_time_evidence_v1(
      jsonb_agg(jsonb_build_object(
        'id', '75140000-0000-4000-8000-000000000001'
      ))
    ) into projected
    from generate_series(1, case_count);
    insert into refund_timezone_projection_benchmark
      (case_count, projected_count, elapsed_ms)
    values (
      case_count,
      jsonb_array_length(projected),
      extract(epoch from clock_timestamp() - started_at) * 1000
    );
  end loop;
end;
$benchmark$;

select is(
  (select projected_count from refund_timezone_projection_benchmark where case_count = 61),
  61,
  'A current-volume projection retains every authorized case item'
);
select is(
  (select projected_count from refund_timezone_projection_benchmark where case_count = 200),
  200,
  'A larger projection retains every case item without truncating the queue'
);
select ok(
  (select elapsed_ms < 4000 from refund_timezone_projection_benchmark where case_count = 200),
  'Two hundred candidate-time projection items finish with margin under the authenticated eight-second timeout'
);
select diag(format(
  'Candidate-time projection: 61 items %s ms; 200 items %s ms (synthetic repeated case)',
  (select round(elapsed_ms, 1) from refund_timezone_projection_benchmark where case_count = 61),
  (select round(elapsed_ms, 1) from refund_timezone_projection_benchmark where case_count = 200)
));

select * from finish();
rollback;
