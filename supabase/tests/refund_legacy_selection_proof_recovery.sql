begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(20);

create function pg_temp.set_actor(p_user_id uuid)
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
      'is_anonymous', false
    )::text,
    true
  );
end;
$$;

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

create function pg_temp.reject_altered_recovered_proof(
  p_key text,
  p_bad_value text,
  p_good_value text
)
returns text
language plpgsql
as $$
declare
  captured_error text;
begin
  update public.refund_case_events
  set metadata = jsonb_set(metadata, array[p_key], to_jsonb(p_bad_value), true)
  where refund_case_id = 'b5070000-0000-4000-8000-000000000001'
    and event_type = 'nayax_match_selection_proof_recovered';

  captured_error := pg_temp.capture_error(format(
    'select public.admin_approve_selected_nayax_refund_for_system_v1(%L::uuid,%s)',
    'b5070000-0000-4000-8000-000000000001',
    (select official_action_version from public.refund_cases
      where id = 'b5070000-0000-4000-8000-000000000001')
  ));

  update public.refund_case_events
  set metadata = jsonb_set(metadata, array[p_key], to_jsonb(p_good_value), true)
  where refund_case_id = 'b5070000-0000-4000-8000-000000000001'
    and event_type = 'nayax_match_selection_proof_recovered';

  return captured_error;
end;
$$;

create function pg_temp.selection_evidence(
  p_recommended boolean,
  p_rank integer,
  p_state text,
  p_transaction_id text,
  p_amount_cents integer
)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'source', 'nayax_api',
    'selection_allowed', true,
    'is_recommended', p_recommended,
    'one_click_eligible', false,
    'recommendation_state', p_state,
    'confidence_class', 'evidence_aware_review',
    'policy_version', '2026-09-05.v11',
    'identifier_policy_version', '2026-09-05.identifier.v2',
    'customer_fact_version', 1,
    'customer_credential_class', 'customer_physical_contactless_pan',
    'provider_identifier_class', 'last_sales_present_identifier_unverified',
    'card_last4_comparison', 'exact_support',
    'card_network_comparison', 'missing',
    'payment_interaction_comparison', 'unknown',
    'same_identifier_equivalence_proven', false,
    'identifier_review_state', 'exact_support',
    'customer_correction_fields', '[]'::jsonb,
    'hard_exclusions', '[]'::jsonb,
    'manual_review_reasons', '[]'::jsonb,
    'reason_codes', '["machine_exact","provider_sale_approved"]'::jsonb,
    'match_factors', '[]'::jsonb,
    'match_reason', 'Synthetic legacy selection fixture',
    'recommendation_rank', p_rank,
    'is_top_ranked', p_rank = 1,
    'lookup_account_scope', 'LEGACY_SELECTION_ACCOUNT',
    'lookup_provider_machine_id', 'LEGACY-SELECTION-MACHINE',
    'provider_machine_id', 'LEGACY-SELECTION-MACHINE',
    'machine_authorization_time_raw', '2026-09-12T20:00:00Z',
    'machine_authorization_at', '2026-09-12T20:00:00Z',
    'machine_authorization_time_source', 'MachineAuthorizationTime',
    'machine_time_resolution', 'exact',
    'provider_time_resolution', 'exact',
    'provider_time_source', 'authorization_gmt',
    'authorized_at', '2026-09-12T20:00:00Z',
    'customer_request_received_at', null,
    'customer_request_received_source', null,
    'transaction_occurrence_proof_source', null,
    'transaction_occurrence_timestamp_source', null,
    'transaction_occurrence_timezone_basis', null,
    'transaction_occurrence_lower_bound_at', null,
    'transaction_occurrence_upper_bound_at', null,
    'request_receipt_lower_bound_at', null,
    'request_receipt_upper_bound_at', null
  ) || jsonb_build_object(
    'request_time_boundary', 'request_time_unknown',
    'transaction_occurrence_comparable', false,
    'transaction_occurrence_semantics', 'unknown',
    'time_delta_minutes', null,
    'amount_delta_cents', 90,
    'provider_processing_time_delta_minutes', 0,
    'payment_status', 'approved',
    'payment_status_evidence', 'last_sales_contract',
    'provider_refund_state', 'clear',
    'duplicate_provider_record', false,
    'card_last4', '4242',
    'currency_code', 'USD',
    'amount_cents', p_amount_cents,
    'provider_transaction_reference', p_transaction_id
  );
$$;

insert into auth.users (
  id,
  aud,
  role,
  email,
  raw_app_meta_data,
  raw_user_meta_data
)
values
  (
    'b5010000-0000-4000-8000-000000000001',
    'authenticated',
    'authenticated',
    'triage@example.invalid',
    '{}',
    '{}'
  ),
  (
    'b5010000-0000-4000-8000-000000000002',
    'authenticated',
    'authenticated',
    'manager@example.invalid',
    '{}',
    '{}'
  );

insert into public.customer_accounts (id, name, account_type)
values (
  'b5020000-0000-4000-8000-000000000001',
  'Legacy selection fixture',
  'internal'
);

insert into public.reporting_locations (id, account_id, name, timezone)
values (
  'b5030000-0000-4000-8000-000000000001',
  'b5020000-0000-4000-8000-000000000001',
  'Legacy selection location',
  'America/Los_Angeles'
);

insert into public.reporting_machines (
  id,
  account_id,
  location_id,
  machine_label,
  status,
  nayax_machine_id,
  nayax_account_key,
  nayax_refunds_enabled
)
values (
  'b5040000-0000-4000-8000-000000000001',
  'b5020000-0000-4000-8000-000000000001',
  'b5030000-0000-4000-8000-000000000001',
  'Legacy selection machine',
  'active',
  'LEGACY-SELECTION-MACHINE',
  'LEGACY_SELECTION_ACCOUNT',
  true
);

insert into public.reporting_machine_refund_managers (
  id,
  reporting_machine_id,
  manager_user_id,
  manager_email,
  grant_reason
)
values (
  'b5050000-0000-4000-8000-000000000001',
  'b5040000-0000-4000-8000-000000000001',
  'b5010000-0000-4000-8000-000000000002',
  'manager@example.invalid',
  'Legacy selection fixture'
);

insert into public.admin_scoped_access_grants (id, user_id, grant_reason)
values (
  'b5060000-0000-4000-8000-000000000001',
  'b5010000-0000-4000-8000-000000000001',
  'Legacy selection fixture'
);

insert into public.admin_scoped_access_scopes (
  grant_id,
  scope_type,
  machine_id,
  grant_reason
)
values (
  'b5060000-0000-4000-8000-000000000001',
  'machine',
  'b5040000-0000-4000-8000-000000000001',
  'Legacy selection fixture'
);

insert into public.refund_cases (
  id,
  public_reference,
  reporting_machine_id,
  reporting_location_id,
  customer_email,
  issue_summary,
  incident_at,
  incident_timezone,
  incident_time_resolution,
  incident_time_confidence,
  payment_method,
  payment_amount_cents,
  card_last4,
  card_last4_provenance,
  card_wallet_used,
  payment_interaction,
  status,
  correlation_status,
  deterministic_fact_version,
  intake_source,
  intake_meta,
  nayax_lookup_generation,
  nayax_lookup_status,
  nayax_recommendation_state,
  nayax_refund_execution_status
)
values
  (
    'b5070000-0000-4000-8000-000000000001',
    'RF-LEGACY-CLEAR',
    'b5040000-0000-4000-8000-000000000001',
    'b5030000-0000-4000-8000-000000000001',
    'clear@example.invalid',
    'Synthetic clear legacy selection',
    '2026-09-12T20:00:00Z',
    'America/Los_Angeles',
    'exact',
    'exact',
    'card',
    1000,
    '4242',
    'physical_card',
    false,
    'tap_card',
    'needs_review',
    'needs_nayax',
    1,
    'form',
    '{}',
    1,
    'manual_exception',
    'manual_exception',
    'not_requested'
  ),
  (
    'b5070000-0000-4000-8000-000000000002',
    'RF-LEGACY-AMBIGUOUS',
    'b5040000-0000-4000-8000-000000000001',
    'b5030000-0000-4000-8000-000000000001',
    'ambiguous@example.invalid',
    'Synthetic ambiguous legacy selection',
    '2026-09-12T20:00:00Z',
    'America/Los_Angeles',
    'exact',
    'exact',
    'card',
    1000,
    '4242',
    'physical_card',
    false,
    'tap_card',
    'needs_review',
    'needs_nayax',
    1,
    'form',
    '{}',
    1,
    'multiple_matches',
    'ambiguous',
    'not_requested'
  );

insert into public.refund_nayax_lookup_candidates (
  token,
  refund_case_id,
  lookup_generation,
  actor_user_id,
  reporting_machine_id,
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
    'b5080000-0000-4000-8000-000000000001',
    'b5070000-0000-4000-8000-000000000001',
    1,
    'b5010000-0000-4000-8000-000000000001',
    'b5040000-0000-4000-8000-000000000001',
    'LEGACY-CLEAR-SALE',
    17,
    '2026-09-12T20:00:00Z',
    1090,
    '4242',
    'USD',
    pg_temp.selection_evidence(true, 1, 'manual_exception', 'LEGACY-CLEAR-SALE', 1090),
    now() + interval '1 hour'
  ),
  (
    'b5080000-0000-4000-8000-000000000002',
    'b5070000-0000-4000-8000-000000000002',
    1,
    'b5010000-0000-4000-8000-000000000001',
    'b5040000-0000-4000-8000-000000000001',
    'LEGACY-AMBIGUOUS-SALE',
    17,
    '2026-09-12T20:00:00Z',
    1090,
    '4242',
    'USD',
    pg_temp.selection_evidence(false, 2, 'ambiguous', 'LEGACY-AMBIGUOUS-SALE', 1090),
    now() + interval '1 hour'
  );

select pg_temp.set_actor('b5010000-0000-4000-8000-000000000001');

select is(
  (
    public.admin_select_refund_nayax_candidate_current_user_v1(
      'b5070000-0000-4000-8000-000000000001',
      (select official_action_version from public.refund_cases where id = 'b5070000-0000-4000-8000-000000000001'),
      'b5080000-0000-4000-8000-000000000001',
      null
    ) ->> 'selectionApplied'
  ),
  'true',
  'the recoverable fixture starts from a real supported manager selection'
);

select is(
  (
    public.admin_select_refund_nayax_candidate_current_user_v1(
      'b5070000-0000-4000-8000-000000000002',
      (select official_action_version from public.refund_cases where id = 'b5070000-0000-4000-8000-000000000002'),
      'b5080000-0000-4000-8000-000000000002',
      'other_review_reason'
    ) ->> 'selectionApplied'
  ),
  'true',
  'the ambiguous fixture starts from a real supported manager selection'
);

update public.refund_case_events
set
  created_at = '2026-09-13T07:30:00Z',
  metadata = metadata
    - 'candidate_token'
    - 'candidate_evidence_hash'
    - 'lookup_generation'
    - 'deterministic_fact_version'
where refund_case_id in (
  'b5070000-0000-4000-8000-000000000001',
  'b5070000-0000-4000-8000-000000000002'
)
  and event_type = 'nayax_match_selected';

select is(
  (
    public.refund_case_nayax_manager_readiness(
      'b5010000-0000-4000-8000-000000000002',
      'b5070000-0000-4000-8000-000000000001'
    ) ->> 'blockReason'
  ),
  'transaction_not_confirmed',
  'the strict readiness gate rejects a legacy selection before recovery'
);

create temp table recovery_result as
select public.service_recover_safe_legacy_refund_selection_proofs_v1() as result;

select is(
  (select result ->> 'recoveredCount' from recovery_result),
  '1',
  'only the unique top-ranked recommended legacy selection is recovered'
);

select ok(
  exists (
    select 1
    from public.refund_case_events
    where refund_case_id = 'b5070000-0000-4000-8000-000000000001'
      and event_type = 'nayax_match_selection_proof_recovered'
      and actor_user_id is null
      and metadata ->> 'candidate_token' = 'b5080000-0000-4000-8000-000000000001'
      and metadata ->> 'lookup_generation' = '1'
      and metadata ->> 'deterministic_fact_version' = '1'
      and metadata ->> 'recovery_contract_version' =
        'refund_legacy_selection_proof_recovery_v1'
      and metadata ->> 'source_selection_event_digest' ~ '^[0-9a-f]{64}$'
      and metadata ->> 'provider_call_made' = 'false'
      and metadata ->> 'approval_created' = 'false'
      and metadata ->> 'customer_message_created' = 'false'
  ),
  'recovery records full current proof and privacy-safe source-event evidence'
);

set local role service_role;

select matches(
  pg_temp.capture_error($sql$
    insert into public.refund_case_events (
      refund_case_id,
      actor_user_id,
      event_type,
      message,
      metadata
    ) values (
      'b5070000-0000-4000-8000-000000000001',
      null,
      'nayax_match_selection_proof_recovered',
      'Spoofed recovered selection proof.',
      jsonb_build_object(
        'candidate_token', 'b5080000-0000-4000-8000-000000000001',
        'recovery_contract_version', 'refund_legacy_selection_proof_recovery_v1',
        'provider_call_made', false,
        'approval_created', false,
        'customer_message_created', false,
        'payload_redacted', true
      )
    )
  $sql$),
  '^P0001:Official refund audit events are wrapper-owned and append-only$',
  'a raw service-role insert cannot fabricate accepted recovered selection proof'
);

reset role;

select ok(
  not exists (
    select 1
    from public.refund_case_events
    where refund_case_id = 'b5070000-0000-4000-8000-000000000002'
      and event_type = 'nayax_match_selection_proof_recovered'
  ),
  'an ambiguous lower-ranked legacy selection remains unrecovered'
);

select is(
  (
    public.refund_case_nayax_manager_readiness(
      'b5010000-0000-4000-8000-000000000002',
      'b5070000-0000-4000-8000-000000000001'
    ) ->> 'canIssueCardRefund'
  ),
  'true',
  'the assigned manager regains guarded readiness for the recoverable selection'
);

select pg_temp.set_actor('b5010000-0000-4000-8000-000000000002');

select matches(
  pg_temp.reject_altered_recovered_proof(
    'candidate_token',
    'b5080000-0000-4000-8000-000000000099',
    'b5080000-0000-4000-8000-000000000001'
  ),
  '^P4620:.*selection evidence required$',
  'approval rejects a recovered proof with an altered candidate token'
);

select matches(
  pg_temp.reject_altered_recovered_proof(
    'candidate_evidence_hash',
    repeat('0', 64),
    (select public.refund_nayax_candidate_evidence_hash(
      candidate.refund_case_id,
      candidate.actor_user_id,
      candidate.provider_transaction_id,
      candidate.site_id,
      candidate.machine_authorization_time,
      candidate.amount_cents,
      candidate.card_last4,
      candidate.currency_code,
      candidate.evidence_summary,
      candidate.expires_at,
      candidate.created_at
    ) from public.refund_nayax_lookup_candidates candidate
    where candidate.token = 'b5080000-0000-4000-8000-000000000001')
  ),
  '^P4620:.*selection evidence required$',
  'approval rejects a recovered proof with an altered candidate evidence hash'
);

select matches(
  pg_temp.reject_altered_recovered_proof('lookup_generation', '2', '1'),
  '^P4620:.*selection evidence required$',
  'approval rejects a recovered proof from a different lookup generation'
);

select matches(
  pg_temp.reject_altered_recovered_proof('deterministic_fact_version', '2', '1'),
  '^P4620:.*selection evidence required$',
  'approval rejects a recovered proof from a different deterministic fact version'
);

select matches(
  pg_temp.reject_altered_recovered_proof(
    'recovery_contract_version',
    'refund_legacy_selection_proof_recovery_v2',
    'refund_legacy_selection_proof_recovery_v1'
  ),
  '^P4620:.*selection evidence required$',
  'approval rejects an unsupported recovered-proof contract version'
);

select is(
  (
    public.refund_case_nayax_manager_readiness(
      'b5010000-0000-4000-8000-000000000002',
      'b5070000-0000-4000-8000-000000000002'
    ) ->> 'blockReason'
  ),
  'transaction_not_confirmed',
  'the ambiguous selection stays blocked for explicit manager review'
);

select is(
  (
    public.service_recover_safe_legacy_refund_selection_proofs_v1()
      ->> 'recoveredCount'
  ),
  '0',
  'recovery is replay safe'
);

select is(
  (
    select count(*)
    from public.refund_case_nayax_refund_attempts
    where refund_case_id in (
      'b5070000-0000-4000-8000-000000000001',
      'b5070000-0000-4000-8000-000000000002'
    )
  ),
  0::bigint,
  'recovery creates no payment attempt'
);

select is(
  (
    select count(*)
    from public.refund_case_messages
    where refund_case_id in (
      'b5070000-0000-4000-8000-000000000001',
      'b5070000-0000-4000-8000-000000000002'
    )
  ),
  0::bigint,
  'recovery creates no customer message'
);

select is(
  (
    select count(*)
    from public.sales_adjustment_facts
    where refund_case_id in (
      'b5070000-0000-4000-8000-000000000001',
      'b5070000-0000-4000-8000-000000000002'
    )
  ),
  0::bigint,
  'recovery creates no reporting adjustment'
);

select ok(
  not has_function_privilege(
    'service_role',
    'public.service_recover_safe_legacy_refund_selection_proofs_v1()',
    'EXECUTE'
  ),
  'the one-time recovery helper is not callable by runtime roles'
);

create temp table recovered_proof_approval as
select public.admin_approve_selected_nayax_refund_for_system_v1(
  'b5070000-0000-4000-8000-000000000001',
  (select official_action_version from public.refund_cases
    where id = 'b5070000-0000-4000-8000-000000000001')
) as result;

select ok(
  (select result ->> 'approved' = 'true'
      and result ->> 'status' = 'system_finishing'
      and result ->> 'providerCallMade' = 'false'
      and result ->> 'customerMessageCreated' = 'false'
    from recovered_proof_approval)
  and (select count(*) = 1
    from public.refund_case_official_action_authorizations
    where refund_case_id = 'b5070000-0000-4000-8000-000000000001'
      and action = 'approve'
      and status = 'consumed')
  and (select count(*) = 1
    from public.refund_case_nayax_refund_attempts
    where refund_case_id = 'b5070000-0000-4000-8000-000000000001'
      and status = 'created'
      and execution_mode = 'request_and_approve')
  and not exists (
    select 1
    from public.refund_nayax_provider_stage_journal journal
    join public.refund_case_nayax_refund_attempts attempt
      on attempt.id = journal.nayax_refund_attempt_id
    where attempt.refund_case_id = 'b5070000-0000-4000-8000-000000000001'
  ),
  'a readiness-compatible recovered proof consumes one approval and queues one exact attempt without a provider call or customer message'
);

select * from finish();
rollback;
