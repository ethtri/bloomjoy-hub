-- #628: harden the normal Nayax request-to-approval transition with a complete,
-- privacy-safe response envelope. Journal v2 remains callable for an immediate
-- Edge rollback; only the new v3 RPCs understand or write the new metadata.

alter table public.refund_nayax_provider_stage_journal
  add column if not exists http_accepted boolean,
  add column if not exists media_type_class text,
  add column if not exists body_kind text,
  add column if not exists body_length_bucket text,
  add column if not exists json_parsed boolean,
  add column if not exists body_json_object boolean,
  add column if not exists schema_matched boolean,
  add column if not exists result_key_present boolean,
  add column if not exists status_key_present boolean,
  add column if not exists result_value_type text,
  add column if not exists status_value_type text,
  add column if not exists semantic_pair_matched boolean;

alter table public.refund_nayax_provider_stage_journal
  drop constraint if exists refund_nayax_provider_stage_journal_failure_type_check,
  add constraint refund_nayax_provider_stage_journal_failure_type_check check (
    failure_type is null or failure_type in ('timeout', 'network', 'response_read')
  ) not valid;

alter table public.refund_nayax_provider_stage_journal
  validate constraint refund_nayax_provider_stage_journal_failure_type_check;

alter table public.refund_nayax_provider_stage_journal
  add constraint refund_nayax_provider_stage_v3_metadata_values_check check (
    (media_type_class is null or media_type_class in (
      'application_json', 'json_suffix', 'html', 'text',
      'missing', 'other', 'unavailable'
    ))
    and (body_kind is null or body_kind in (
      'empty', 'json_object', 'json_non_object', 'html', 'text',
      'malformed_json', 'oversize', 'read_error', 'unavailable'
    ))
    and (body_length_bucket is null or body_length_bucket in (
      'empty', '1_256', '257_2048', '2049_16384', 'over_16384',
      'unavailable'
    ))
    and (result_value_type is null or result_value_type in (
      'string', 'null', 'number', 'boolean', 'object', 'array',
      'missing', 'unavailable'
    ))
    and (status_value_type is null or status_value_type in (
      'string', 'null', 'number', 'boolean', 'object', 'array',
      'missing', 'unavailable'
    ))
  ) not valid;

alter table public.refund_nayax_provider_stage_journal
  validate constraint refund_nayax_provider_stage_v3_metadata_values_check;

alter table public.refund_nayax_provider_stage_journal
  add constraint refund_nayax_provider_stage_v3_shape_check check (
    (
      journal_contract_version is distinct from 'nayax-provider-journal-v3'
      and http_accepted is null
      and media_type_class is null
      and body_kind is null
      and body_length_bucket is null
      and json_parsed is null
      and body_json_object is null
      and schema_matched is null
      and result_key_present is null
      and status_key_present is null
      and result_value_type is null
      and status_value_type is null
      and semantic_pair_matched is null
    )
    or (
      journal_contract_version = 'nayax-provider-journal-v3'
      and event = 'started'
      and http_accepted is null
      and media_type_class is null
      and body_kind is null
      and body_length_bucket is null
      and json_parsed is null
      and body_json_object is null
      and schema_matched is null
      and result_key_present is null
      and status_key_present is null
      and result_value_type is null
      and status_value_type is null
      and semantic_pair_matched is null
    )
    or (
      journal_contract_version = 'nayax-provider-journal-v3'
      and event = 'result'
      and http_accepted is not null
      and media_type_class is not null
      and body_kind is not null
      and body_length_bucket is not null
      and json_parsed is not null
      and body_json_object is not null
      and schema_matched is not null
      and result_key_present is not null
      and status_key_present is not null
      and result_value_type is not null
      and status_value_type is not null
      and semantic_pair_matched is not null
    )
  ) not valid;

alter table public.refund_nayax_provider_stage_journal
  validate constraint refund_nayax_provider_stage_v3_shape_check;

alter table public.refund_nayax_provider_stage_journal
  add constraint refund_nayax_provider_stage_v3_consistency_check check (
    journal_contract_version is distinct from 'nayax-provider-journal-v3'
    or event <> 'result'
    or (
      http_accepted = coalesce(http_status = 200, false)
      and (not body_json_object or json_parsed)
      and (body_kind <> 'json_object' or (json_parsed and body_json_object))
      and (body_kind <> 'json_non_object' or (json_parsed and not body_json_object))
      and (body_kind <> 'malformed_json' or not json_parsed)
      and (body_kind <> 'read_error' or failure_type = 'response_read')
      and (body_kind <> 'oversize' or body_length_bucket = 'over_16384')
      and (
        result_key_present
        or result_value_type in ('missing', 'unavailable')
      )
      and (
        not result_key_present
        or result_value_type not in ('missing', 'unavailable')
      )
      and (
        status_key_present
        or status_value_type in ('missing', 'unavailable')
      )
      and (
        not status_key_present
        or status_value_type not in ('missing', 'unavailable')
      )
      and schema_matched is not distinct from (
        body_json_object
        and result_key_present
        and status_key_present
        and result_value_type = 'string'
        and status_value_type = 'string'
      )
      and (not semantic_pair_matched or schema_matched)
      and contract_matched is not distinct from (
        failure_type is null
        and http_accepted
        and media_type_class = 'application_json'
        and body_kind = 'json_object'
        and json_parsed
        and body_json_object
        and schema_matched
        and semantic_pair_matched
      )
      and (contract_matched or outcome = 'unknown')
    )
  ) not valid;

alter table public.refund_nayax_provider_stage_journal
  validate constraint refund_nayax_provider_stage_v3_consistency_check;

alter table public.refund_case_nayax_refund_attempts
  drop constraint if exists refund_nayax_attempt_safe_failure_class_check,
  add constraint refund_nayax_attempt_safe_failure_class_check check (
    safe_failure_class is null or safe_failure_class in (
      'interrupted_before_transport', 'interrupted_after_transport',
      'provider_timeout', 'provider_network', 'provider_rejected',
      'provider_unknown', 'provider_http_error', 'provider_response_invalid',
      'provider_semantic_mismatch', 'contract_mismatch', 'settlement_failure'
    )
  ) not valid;

alter table public.refund_case_nayax_refund_attempts
  validate constraint refund_nayax_attempt_safe_failure_class_check;

alter table public.refund_nayax_provider_stage_journal enable row level security;
revoke all on table public.refund_nayax_provider_stage_journal
  from public, anon, authenticated, service_role;

create function public.service_get_nayax_refund_provider_journal_capability_v3(
  p_executor_assertion text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.assert_nayax_provider_executor(p_executor_assertion);
  return jsonb_build_object(
    'journalContractVersion', 'nayax-provider-journal-v3',
    'approvalPolicyVersion', 'db-authoritative-exact-200-json-v1',
    'responseEnvelopeVersion', 'nayax-response-envelope-v1',
    'supportedProviderContractVersions', jsonb_build_array(
      'nayax-production-account-contract-v2'
    ),
    'providerContractConfirmationRequired', true,
    'payloadRedacted', true
  );
end;
$$;

create function public.service_record_nayax_refund_provider_stage_v3(
  p_executor_assertion text,
  p_attempt_id uuid,
  p_provider_claim_token text,
  p_stage text,
  p_event text,
  p_http_status integer,
  p_outcome text,
  p_contract_matched boolean,
  p_failure_type text,
  p_classification_digest text,
  p_provider_contract_version text,
  p_journal_contract_version text,
  p_http_accepted boolean,
  p_media_type_class text,
  p_body_kind text,
  p_body_length_bucket text,
  p_json_parsed boolean,
  p_json_object boolean,
  p_schema_matched boolean,
  p_result_key_present boolean,
  p_status_key_present boolean,
  p_result_value_type text,
  p_status_value_type text,
  p_semantic_pair_matched boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_stage text := lower(btrim(coalesce(p_stage, '')));
  normalized_event text := lower(btrim(coalesce(p_event, '')));
  normalized_outcome text := nullif(lower(btrim(coalesce(p_outcome, ''))), '');
  normalized_failure text := nullif(lower(btrim(coalesce(p_failure_type, ''))), '');
  normalized_provider_version text := btrim(coalesce(p_provider_contract_version, ''));
  normalized_journal_version text := btrim(coalesce(p_journal_contract_version, ''));
  normalized_media_type text := nullif(lower(btrim(coalesce(p_media_type_class, ''))), '');
  normalized_body_kind text := nullif(lower(btrim(coalesce(p_body_kind, ''))), '');
  normalized_body_length text := nullif(lower(btrim(coalesce(p_body_length_bucket, ''))), '');
  normalized_result_type text := nullif(lower(btrim(coalesce(p_result_value_type, ''))), '');
  normalized_status_type text := nullif(lower(btrim(coalesce(p_status_value_type, ''))), '');
  attempt_row public.refund_case_nayax_refund_attempts%rowtype;
  claim_digest text;
  approval_authorized boolean := false;
  durable_stage text;
  durable_failure text;
  operations_required boolean := false;
  definitive_rejection boolean := false;
begin
  perform public.assert_nayax_provider_executor(p_executor_assertion);

  if normalized_journal_version <> 'nayax-provider-journal-v3'
    or normalized_provider_version <> 'nayax-production-account-contract-v2' then
    raise exception 'Nayax provider journal contract version mismatch'
      using errcode = 'P4611';
  end if;
  if p_attempt_id is null
    or normalized_stage not in ('request', 'approve')
    or normalized_event not in ('started', 'result')
    or p_classification_digest !~ '^[a-f0-9]{64}$'
    or nullif(p_provider_claim_token, '') is null then
    raise exception 'Exact redacted Nayax stage evidence is required'
      using errcode = 'P4612';
  end if;
  if normalized_event = 'started' and (
    p_http_status is not null
    or normalized_outcome is not null
    or p_contract_matched is not null
    or normalized_failure is not null
    or p_http_accepted is not null
    or normalized_media_type is not null
    or normalized_body_kind is not null
    or normalized_body_length is not null
    or p_json_parsed is not null
    or p_json_object is not null
    or p_schema_matched is not null
    or p_result_key_present is not null
    or p_status_key_present is not null
    or normalized_result_type is not null
    or normalized_status_type is not null
    or p_semantic_pair_matched is not null
  ) then
    raise exception 'A started stage cannot claim a provider result'
      using errcode = 'P4612';
  end if;
  if normalized_event = 'result' and (
    normalized_outcome not in (
      'accepted', 'succeeded', 'rejected', 'duplicate',
      'already_refunded', 'pending', 'unknown'
    )
    or p_contract_matched is null
    or (p_http_status is not null and (p_http_status < 100 or p_http_status > 599))
    or (normalized_failure is not null
      and normalized_failure not in ('timeout', 'network', 'response_read'))
    or p_http_accepted is null
    or normalized_media_type not in (
      'application_json', 'json_suffix', 'html', 'text',
      'missing', 'other', 'unavailable'
    )
    or normalized_body_kind not in (
      'empty', 'json_object', 'json_non_object', 'html', 'text',
      'malformed_json', 'oversize', 'read_error', 'unavailable'
    )
    or normalized_body_length not in (
      'empty', '1_256', '257_2048', '2049_16384', 'over_16384',
      'unavailable'
    )
    or p_json_parsed is null
    or p_json_object is null
    or p_schema_matched is null
    or p_result_key_present is null
    or p_status_key_present is null
    or normalized_result_type not in (
      'string', 'null', 'number', 'boolean', 'object', 'array',
      'missing', 'unavailable'
    )
    or normalized_status_type not in (
      'string', 'null', 'number', 'boolean', 'object', 'array',
      'missing', 'unavailable'
    )
    or p_semantic_pair_matched is null
    or p_http_accepted is distinct from coalesce(p_http_status = 200, false)
    or (p_json_object and not p_json_parsed)
    or (normalized_body_kind = 'json_object' and not (p_json_parsed and p_json_object))
    or (normalized_body_kind = 'json_non_object' and not (p_json_parsed and not p_json_object))
    or (normalized_body_kind = 'malformed_json' and p_json_parsed)
    or (normalized_body_kind = 'read_error' and normalized_failure is distinct from 'response_read')
    or (normalized_body_kind = 'oversize' and normalized_body_length <> 'over_16384')
    or (p_result_key_present and normalized_result_type in ('missing', 'unavailable'))
    or (not p_result_key_present and normalized_result_type not in ('missing', 'unavailable'))
    or (p_status_key_present and normalized_status_type in ('missing', 'unavailable'))
    or (not p_status_key_present and normalized_status_type not in ('missing', 'unavailable'))
    or p_schema_matched is distinct from (
      p_json_object
      and p_result_key_present
      and p_status_key_present
      and normalized_result_type = 'string'
      and normalized_status_type = 'string'
    )
    or (p_semantic_pair_matched and not p_schema_matched)
    or p_contract_matched is distinct from (
      normalized_failure is null
      and p_http_accepted
      and normalized_media_type = 'application_json'
      and normalized_body_kind = 'json_object'
      and p_json_parsed
      and p_json_object
      and p_schema_matched
      and p_semantic_pair_matched
    )
    or (not p_contract_matched and normalized_outcome <> 'unknown')
  ) then
    raise exception 'Invalid sanitized Nayax stage result'
      using errcode = 'P4612';
  end if;

  claim_digest := encode(
    extensions.digest(convert_to(p_provider_claim_token, 'UTF8'), 'sha256'),
    'hex'
  );
  select attempt.* into attempt_row
  from public.refund_case_nayax_refund_attempts attempt
  where attempt.id = p_attempt_id
  for share;
  if not found then
    raise exception 'Nayax provider attempt not found' using errcode = 'P4612';
  end if;
  if attempt_row.status is distinct from 'in_progress'
    or attempt_row.provider_outcome is not null
    or attempt_row.provider_claim_consumed_at is not null
    or attempt_row.provider_claim_expires_at <= statement_timestamp()
    or attempt_row.provider_claim_digest is distinct from claim_digest then
    raise exception 'Valid active attempt-scoped provider claim required'
      using errcode = 'P4612';
  end if;

  if normalized_event = 'result' and not exists (
    select 1
    from public.refund_nayax_provider_stage_journal journal
    where journal.nayax_refund_attempt_id = p_attempt_id
      and journal.pending_approval_recovery_id is null
      and journal.stage = normalized_stage
      and journal.event = 'started'
      and journal.provider_contract_version = normalized_provider_version
      and journal.journal_contract_version = normalized_journal_version
  ) then
    raise exception 'Nayax stage result requires its started marker'
      using errcode = 'P4612';
  end if;

  if normalized_stage = 'request' and normalized_event = 'result' then
    approval_authorized :=
      normalized_failure is null
      and p_http_status = 200
      and p_http_accepted is true
      and normalized_media_type = 'application_json'
      and normalized_body_kind = 'json_object'
      and p_json_parsed is true
      and p_json_object is true
      and p_schema_matched is true
      and p_result_key_present is true
      and p_status_key_present is true
      and normalized_result_type = 'string'
      and normalized_status_type = 'string'
      and p_semantic_pair_matched is true
      and p_contract_matched is true
      and normalized_outcome = 'accepted';
  end if;

  if normalized_stage = 'approve' and normalized_event = 'started'
    and not exists (
      select 1
      from public.refund_nayax_provider_stage_journal journal
      where journal.nayax_refund_attempt_id = p_attempt_id
        and journal.pending_approval_recovery_id is null
        and journal.stage = 'request'
        and journal.event = 'result'
        and journal.http_status = 200
        and journal.http_accepted is true
        and journal.media_type_class = 'application_json'
        and journal.body_kind = 'json_object'
        and journal.json_parsed is true
        and journal.body_json_object is true
        and journal.schema_matched is true
        and journal.result_key_present is true
        and journal.status_key_present is true
        and journal.result_value_type = 'string'
        and journal.status_value_type = 'string'
        and journal.semantic_pair_matched is true
        and journal.contract_matched is true
        and journal.outcome = 'accepted'
        and journal.failure_type is null
        and journal.approval_authorized is true
        and journal.provider_contract_version = normalized_provider_version
        and journal.journal_contract_version = normalized_journal_version
    ) then
    raise exception 'Approval requires database-authorized exact request evidence'
      using errcode = 'P4613';
  end if;

  insert into public.refund_nayax_provider_stage_journal (
    nayax_refund_attempt_id,
    pending_approval_recovery_id,
    stage,
    event,
    http_status,
    outcome,
    contract_matched,
    failure_type,
    classification_digest,
    approval_authorized,
    provider_contract_version,
    journal_contract_version,
    http_accepted,
    media_type_class,
    body_kind,
    body_length_bucket,
    json_parsed,
    body_json_object,
    schema_matched,
    result_key_present,
    status_key_present,
    result_value_type,
    status_value_type,
    semantic_pair_matched
  ) values (
    p_attempt_id,
    null,
    normalized_stage,
    normalized_event,
    p_http_status,
    normalized_outcome,
    p_contract_matched,
    normalized_failure,
    p_classification_digest,
    case
      when normalized_stage = 'request' and normalized_event = 'result'
        then approval_authorized
      else null
    end,
    normalized_provider_version,
    normalized_journal_version,
    p_http_accepted,
    normalized_media_type,
    normalized_body_kind,
    normalized_body_length,
    p_json_parsed,
    p_json_object,
    p_schema_matched,
    p_result_key_present,
    p_status_key_present,
    normalized_result_type,
    normalized_status_type,
    p_semantic_pair_matched
  );

  durable_stage := case
    when normalized_stage = 'request' and normalized_event = 'started'
      then 'request_started'
    when normalized_stage = 'request' and normalized_event = 'result'
      then 'request_result'
    when normalized_stage = 'approve' and normalized_event = 'started'
      then 'approval_started'
    when normalized_stage = 'approve' and normalized_event = 'result'
      then 'approval_result'
    else 'reserved'
  end;
  durable_failure := case
    when normalized_event <> 'result' then null
    when normalized_failure = 'timeout' then 'provider_timeout'
    when normalized_failure = 'network' then 'provider_network'
    when normalized_failure = 'response_read' then 'provider_response_invalid'
    when p_http_status is distinct from 200 or p_http_accepted is not true
      then 'provider_http_error'
    when normalized_media_type <> 'application_json'
      or normalized_body_kind <> 'json_object'
      or p_json_parsed is not true
      or p_json_object is not true
      or p_schema_matched is not true
      then 'provider_response_invalid'
    when p_semantic_pair_matched is not true or p_contract_matched is not true
      then 'provider_semantic_mismatch'
    when normalized_outcome = 'rejected' then 'provider_rejected'
    when normalized_outcome in ('pending', 'unknown') then 'provider_unknown'
    else null
  end;
  definitive_rejection :=
    normalized_event = 'result'
    and normalized_outcome = 'rejected'
    and normalized_failure is null
    and p_http_status = 200
    and p_http_accepted is true
    and normalized_media_type = 'application_json'
    and normalized_body_kind = 'json_object'
    and p_json_parsed is true
    and p_json_object is true
    and p_schema_matched is true
    and p_result_key_present is true
    and p_status_key_present is true
    and normalized_result_type = 'string'
    and normalized_status_type = 'string'
    and p_semantic_pair_matched is true
    and p_contract_matched is true;
  operations_required := durable_failure is not null and not definitive_rejection;

  update public.refund_case_nayax_refund_attempts
  set
    safe_transport_stage = durable_stage,
    safe_failure_class = durable_failure,
    correlation_digest = p_classification_digest,
    refund_operations_due_at = case
      when operations_required then coalesce(
        refund_operations_due_at,
        created_at + interval '60 minutes'
      )
      when definitive_rejection then null
      else refund_operations_due_at
    end
  where id = p_attempt_id;

  return jsonb_build_object(
    'recorded', true,
    'approvalAuthorized', approval_authorized,
    'approvalPolicyVersion', 'db-authoritative-exact-200-json-v1',
    'responseEnvelopeVersion', 'nayax-response-envelope-v1',
    'journalContractVersion', normalized_journal_version,
    'providerContractVersion', normalized_provider_version,
    'safeStage', durable_stage,
    'safeFailureClass', durable_failure,
    'refundOperationsRequired', operations_required,
    'definitiveNoRefund', definitive_rejection,
    'safeRetryEligible', false,
    'payloadRedacted', true
  );
end;
$$;

-- Apply the same account-scoped reconciliation pause to v2 and v3 reservation
-- wrappers. Historical and unrelated insert paths remain unchanged.
create or replace function public.guard_refund_nayax_account_circuit_breaker()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  account_key text;
  journal_version text := coalesce(
    current_setting('bloomjoy.nayax_journal_contract_version', true),
    ''
  );
begin
  if journal_version not in (
    'nayax-provider-journal-v2',
    'nayax-provider-journal-v3'
  ) then
    return new;
  end if;

  if new.execution_mode <> 'request_and_approve' then
    return new;
  end if;

  select upper(btrim(machine.nayax_account_key))
  into account_key
  from public.refund_cases refund_case
  join public.reporting_machines machine
    on machine.id = refund_case.reporting_machine_id
  where refund_case.id = new.refund_case_id;

  if account_key is null or account_key = '' then
    raise exception 'Nayax account key is required before attempt reservation'
      using errcode = 'P4610';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('refund-nayax-account-v1|' || account_key, 0)
  );

  if coalesce(
    (public.refund_nayax_account_execution_hold(account_key) ->> 'blocked')::boolean,
    true
  ) then
    raise exception 'Nayax account is paused for unresolved refund reconciliation'
      using errcode = 'P4610';
  end if;

  return new;
end;
$$;

create function public.service_reserve_nayax_refund_manager_action_v3(
  p_executor_assertion text,
  p_actor_user_id uuid,
  p_case_id uuid,
  p_expected_case_version bigint,
  p_idempotency_key text,
  p_amount_cents integer,
  p_daily_amount_cap_cents integer,
  p_daily_count_cap integer,
  p_currency_code text,
  p_provider_contract_version text,
  p_journal_contract_version text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.assert_nayax_provider_executor(p_executor_assertion);
  if btrim(coalesce(p_journal_contract_version, ''))
      <> 'nayax-provider-journal-v3'
    or btrim(coalesce(p_provider_contract_version, ''))
      <> 'nayax-production-account-contract-v2' then
    raise exception 'Nayax provider journal contract version mismatch'
      using errcode = 'P4611';
  end if;

  perform pg_catalog.set_config(
    'bloomjoy.nayax_journal_contract_version',
    p_journal_contract_version,
    true
  );
  return public.service_reserve_nayax_refund_manager_action(
    p_executor_assertion,
    p_actor_user_id,
    p_case_id,
    p_expected_case_version,
    p_idempotency_key,
    p_amount_cents,
    p_daily_amount_cap_cents,
    p_daily_count_cap,
    p_currency_code
  );
end;
$$;

-- Preserve definitive-rejection release for v2 while admitting only a fully
-- evidenced v3 result. The controlled-pilot branch is unchanged.
create or replace function public.refund_nayax_definitive_rejection_is_retry_safe(
  p_attempt_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.refund_case_nayax_refund_attempts attempt
    where attempt.id = p_attempt_id
      and attempt.execution_mode = 'request_and_approve'
      and attempt.status = 'declined'
      and attempt.provider_outcome = 'rejected'
      and attempt.provider_outcome_recorded_at is not null
      and attempt.provider_claim_consumed_at is not null
      and attempt.reconciliation_required is false
      and attempt.completed_at is not null
      and attempt.reporting_adjustment_id is null
      and attempt.case_finalization_committed_at is null
      and (
        exists (
          select 1
          from public.refund_nayax_provider_stage_journal final_result
          where final_result.nayax_refund_attempt_id = attempt.id
            and final_result.pending_approval_recovery_id is null
            and final_result.event = 'result'
            and final_result.outcome = 'rejected'
            and final_result.contract_matched is true
            and final_result.failure_type is null
            and final_result.classification_digest ~ '^[a-f0-9]{64}$'
            and (
              (
                final_result.provider_contract_version =
                  'nayax-production-observed-2026-08-22'
                and final_result.journal_contract_version =
                  'nayax-provider-journal-v2'
                and final_result.http_status between 200 and 299
              )
              or (
                final_result.provider_contract_version =
                  'nayax-production-account-contract-v2'
                and final_result.journal_contract_version =
                  'nayax-provider-journal-v3'
                and final_result.http_status = 200
                and final_result.http_accepted is true
                and final_result.media_type_class = 'application_json'
                and final_result.body_kind = 'json_object'
                and final_result.json_parsed is true
                and final_result.body_json_object is true
                and final_result.schema_matched is true
                and final_result.result_key_present is true
                and final_result.status_key_present is true
                and final_result.result_value_type = 'string'
                and final_result.status_value_type = 'string'
                and final_result.semantic_pair_matched is true
              )
            )
            and (
              (
                final_result.stage = 'request'
                and final_result.approval_authorized is false
                and not exists (
                  select 1
                  from public.refund_nayax_provider_stage_journal later_stage
                  where later_stage.nayax_refund_attempt_id = attempt.id
                    and later_stage.pending_approval_recovery_id is null
                    and later_stage.stage = 'approve'
                )
              )
              or (
                final_result.stage = 'approve'
                and exists (
                  select 1
                  from public.refund_nayax_provider_stage_journal request_result
                  where request_result.nayax_refund_attempt_id = attempt.id
                    and request_result.pending_approval_recovery_id is null
                    and request_result.stage = 'request'
                    and request_result.event = 'result'
                    and request_result.approval_authorized is true
                    and request_result.failure_type is null
                    and request_result.provider_contract_version =
                      final_result.provider_contract_version
                    and request_result.journal_contract_version =
                      final_result.journal_contract_version
                    and (
                      (
                        request_result.journal_contract_version =
                          'nayax-provider-journal-v2'
                        and request_result.http_status between 200 and 299
                      )
                      or (
                        request_result.journal_contract_version =
                          'nayax-provider-journal-v3'
                        and request_result.http_status = 200
                        and request_result.http_accepted is true
                        and request_result.media_type_class = 'application_json'
                        and request_result.body_kind = 'json_object'
                        and request_result.json_parsed is true
                        and request_result.body_json_object is true
                        and request_result.schema_matched is true
                        and request_result.result_key_present is true
                        and request_result.status_key_present is true
                        and request_result.result_value_type = 'string'
                        and request_result.status_value_type = 'string'
                        and request_result.semantic_pair_matched is true
                        and request_result.contract_matched is true
                        and request_result.outcome = 'accepted'
                      )
                    )
                )
              )
            )
        )
        or exists (
          select 1
          from public.refund_nayax_controlled_pilot_authorizations pilot
          join public.refund_nayax_controlled_pilot_stage_journal final_result
            on final_result.pilot_authorization_id = pilot.authorization_id
           and final_result.provider_attempt_id = attempt.id
          where pilot.provider_attempt_id = attempt.id
            and pilot.refund_case_id = attempt.refund_case_id
            and pilot.amount_cents = attempt.amount_cents
            and pilot.currency_code = attempt.currency_code
            and pilot.status = 'consumed'
            and final_result.outcome = 'rejected'
            and final_result.contract_matched is true
            and final_result.http_status between 200 and 299
            and final_result.failure_type is null
            and final_result.classification_digest ~ '^[a-f0-9]{64}$'
            and not exists (
              select 1
              from public.refund_nayax_controlled_pilot_stage_journal later_stage
              where later_stage.provider_attempt_id = attempt.id
                and later_stage.stage_ordinal > final_result.stage_ordinal
            )
        )
      )
  );
$$;

revoke execute on function
  public.service_get_nayax_refund_provider_journal_capability_v3(text)
  from public, anon, authenticated, service_role;
grant execute on function
  public.service_get_nayax_refund_provider_journal_capability_v3(text)
  to service_role;

revoke execute on function public.service_record_nayax_refund_provider_stage_v3(
  text, uuid, text, text, text, integer, text, boolean, text, text, text, text,
  boolean, text, text, text, boolean, boolean, boolean, boolean, boolean,
  text, text, boolean
) from public, anon, authenticated, service_role;
grant execute on function public.service_record_nayax_refund_provider_stage_v3(
  text, uuid, text, text, text, integer, text, boolean, text, text, text, text,
  boolean, text, text, text, boolean, boolean, boolean, boolean, boolean,
  text, text, boolean
) to service_role;

revoke execute on function public.service_reserve_nayax_refund_manager_action_v3(
  text, uuid, uuid, bigint, text, integer, integer, integer, text, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.service_reserve_nayax_refund_manager_action_v3(
  text, uuid, uuid, bigint, text, integer, integer, integer, text, text, text
) to service_role;

revoke execute on function public.guard_refund_nayax_account_circuit_breaker()
  from public, anon, authenticated, service_role;
revoke execute on function
  public.refund_nayax_definitive_rejection_is_retry_safe(uuid)
  from public, anon, authenticated, service_role;

comment on column public.refund_nayax_provider_stage_journal.media_type_class is
  'Privacy-safe response Content-Type class. No header value or response body is stored.';
comment on column public.refund_nayax_provider_stage_journal.body_length_bucket is
  'Coarse response-body size bucket. Exact response length and bytes are never stored.';
comment on function
  public.service_get_nayax_refund_provider_journal_capability_v3(text) is
  'Hardened journal v3 handshake. The neutral provider contract identifier denotes code compatibility, not provider confirmation; runtime confirmation and schema-version gates remain mandatory.';
comment on function public.service_record_nayax_refund_provider_stage_v3(
  text, uuid, text, text, text, integer, text, boolean, text, text, text, text,
  boolean, text, text, text, boolean, boolean, boolean, boolean, boolean,
  text, text, boolean
) is 'Append-only journal v3 state machine. Approval requires exact HTTP 200 application/json schema-valid and semantic request acceptance evidence.';
comment on function public.service_reserve_nayax_refund_manager_action_v3(
  text, uuid, uuid, bigint, text, integer, integer, integer, text, text, text
) is 'Version-negotiated v3 reservation. Runtime contract confirmation remains a separate fail-closed activation requirement.';

select pg_notify('pgrst', 'reload schema');
