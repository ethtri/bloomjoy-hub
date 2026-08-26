-- #971: allow a mapped manager to reconcile a refund that Nayax already
-- completed outside Bloomjoy, without creating any provider write path.

alter table public.refund_case_nayax_refund_attempts
  drop constraint if exists refund_case_nayax_refund_attempts_execution_mode_check,
  add constraint refund_case_nayax_refund_attempts_execution_mode_check check (
    execution_mode in (
      'preflight', 'request', 'approve', 'decline', 'request_and_approve',
      'manual_portal', 'evidence_only'
    )
  ),
  drop constraint if exists refund_nayax_attempt_bound_lifecycle_check,
  add constraint refund_nayax_attempt_bound_lifecycle_check check (
    official_action_authorization_id is null
    or (
      execution_mode in ('manual_portal', 'evidence_only')
      and step_up_intent_id is null
      and request_fingerprint is not null
      and provider_claim_digest is null
      and provider_claim_expires_at is null
      and provider_claim_consumed_at is null
      and (
        (
          provider_outcome = 'unknown'
          and provider_outcome_recorded_at is not null
          and status = 'manual_review'
          and reconciliation_required = true
          and reporting_adjustment_id is null
          and case_finalization_committed_at is null
        )
        or (
          provider_outcome = 'success'
          and provider_outcome_recorded_at is not null
          and status = 'succeeded'
          and reconciliation_required = false
          and reporting_adjustment_id is not null
          and case_finalization_committed_at is not null
        )
      )
    )
    or (
      execution_mode not in ('manual_portal', 'evidence_only')
      and step_up_intent_id is not null
      and request_fingerprint is not null
      and provider_claim_digest is not null
      and provider_claim_expires_at is not null
      and (
        (provider_outcome is null and provider_outcome_recorded_at is null)
        or (provider_outcome is not null and provider_outcome_recorded_at is not null)
      )
      and (provider_outcome = 'success' or reporting_adjustment_id is null)
      and (
        case_finalization_committed_at is null
        or (
          provider_outcome = 'success'
          and reporting_adjustment_id is not null
          and status = 'succeeded'
        )
      )
    )
  );

create or replace function public.refund_nayax_evidence_only_start_is_safe(
  p_refund_case_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select
      refund_case.payment_method = 'card'
      and refund_case.status = 'needs_review'
      and refund_case.decision is null
      and refund_case.correlation_status = 'matched'
      and refund_case.correlation_source = 'nayax'
      and nullif(btrim(refund_case.matched_nayax_transaction_id), '') is not null
      and refund_case.matched_nayax_machine_auth_time is not null
      and refund_case.matched_nayax_amount_cents > 0
      and refund_case.matched_nayax_amount_cents = refund_case.payment_amount_cents
      and refund_case.matched_nayax_amount_cents = refund_case.refund_amount_cents
      and refund_case.matched_nayax_currency_code = 'USD'
      and refund_case.nayax_refund_execution_status = 'not_requested'
      and refund_case.reporting_adjustment_id is null
      and refund_case.refund_completed_at is null
      and not public.refund_case_has_unresolved_reconciliation(refund_case.id)
      and (
        refund_case.intake_source = 'form'
        or exists (
          select 1
          from public.refund_gmail_threads original_thread
          where original_thread.refund_case_id = refund_case.id
        )
      )
      and not exists (
        select 1
        from public.refund_cases other_case
        where other_case.id <> refund_case.id
          and other_case.correlation_source = 'nayax'
          and other_case.matched_nayax_transaction_id =
            refund_case.matched_nayax_transaction_id
      )
      and not exists (
        select 1
        from public.refund_case_nayax_refund_attempts attempt
        where attempt.refund_case_id = refund_case.id
      )
    from public.refund_cases refund_case
    where refund_case.id = p_refund_case_id
  ), false);
$$;

revoke execute on function public.refund_nayax_evidence_only_start_is_safe(uuid)
  from public, anon, authenticated, service_role;

create or replace function public.admin_begin_refund_nayax_evidence_only_reconciliation(
  p_case_id uuid,
  p_expected_case_version bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  current_actor_user_id uuid := auth.uid();
  case_row public.refund_cases%rowtype;
  authorization_result jsonb;
  authorization_id uuid;
  attempt_row public.refund_case_nayax_refund_attempts%rowtype;
  idempotency_key text;
  request_fingerprint text;
begin
  if auth.role() is distinct from 'authenticated'
    or current_actor_user_id is null
    or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'Authenticated Machine Manager session required';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'refund-nayax-evidence-only-v1|' || p_case_id::text,
      0
    )
  );

  select refund_case.*
  into case_row
  from public.refund_cases refund_case
  where refund_case.id = p_case_id
  for update;

  if not found then
    raise exception 'Refund case not found';
  end if;

  if not public.can_perform_refund_official_action(
    current_actor_user_id,
    case_row.id
  ) then
    raise exception 'Active Machine Manager mapping required';
  end if;

  select attempt.*
  into attempt_row
  from public.refund_case_nayax_refund_attempts attempt
  where attempt.refund_case_id = case_row.id
    and attempt.execution_mode = 'evidence_only'
  order by attempt.created_at desc, attempt.id desc
  limit 1
  for update;

  if found then
    return jsonb_build_object(
      'attemptId', attempt_row.id,
      'created', false,
      'status', attempt_row.status,
      'providerOutcome', attempt_row.provider_outcome,
      'providerCallMade', false,
      'customerMessageCreated', false,
      'expectedCaseVersion', case_row.official_action_version,
      'payloadRedacted', true
    );
  end if;

  if case_row.official_action_version is distinct from p_expected_case_version then
    raise exception 'Refund case changed since review; reload before continuing';
  end if;

  if not public.refund_nayax_evidence_only_start_is_safe(case_row.id) then
    raise exception 'This case is not safe for evidence-only reconciliation';
  end if;

  idempotency_key := 'evidence-only-' || encode(extensions.digest(
    convert_to(
      case_row.id::text || '|' || case_row.matched_nayax_transaction_id ||
        '|' || case_row.nayax_refund_attempt_generation::text,
      'UTF8'
    ),
    'sha256'
  ), 'hex');

  authorization_result := public.admin_authorize_refund_official_action(
    case_row.id,
    'approve',
    case_row.official_action_version,
    'card_refund_pending',
    'approved',
    null,
    'Authoritative provider evidence review opened. No provider call was made.',
    null,
    case_row.refund_amount_cents,
    null,
    null,
    false,
    null,
    null
  );
  authorization_id := (authorization_result ->> 'authorizationId')::uuid;

  perform public.service_apply_refund_official_case_update(
    authorization_id,
    case_row.id,
    'approve',
    'card_refund_pending',
    null,
    'approved',
    'Authoritative provider evidence review opened. No provider call was made.',
    null,
    case_row.refund_amount_cents,
    null,
    null,
    null
  );

  request_fingerprint := encode(extensions.digest(
    convert_to(
      authorization_id::text || '|' || idempotency_key || '|USD|' ||
        case_row.refund_amount_cents::text,
      'UTF8'
    ),
    'sha256'
  ), 'hex');

  insert into public.refund_case_nayax_refund_attempts (
    refund_case_id,
    actor_user_id,
    execution_mode,
    status,
    idempotency_key,
    amount_cents,
    transaction_id_present,
    site_id_present,
    machine_auth_time_present,
    sanitized_request,
    sanitized_response,
    official_action_authorization_id,
    step_up_intent_id,
    request_fingerprint,
    currency_code,
    provider_outcome,
    provider_outcome_recorded_at,
    reconciliation_required
  ) values (
    case_row.id,
    current_actor_user_id,
    'evidence_only',
    'manual_review',
    idempotency_key,
    case_row.refund_amount_cents,
    true,
    case_row.matched_nayax_site_id is not null,
    true,
    jsonb_build_object(
      'evidence_only_reconciliation', true,
      'transaction_id_present', true,
      'site_id_present', case_row.matched_nayax_site_id is not null,
      'machine_authorization_time_present', true,
      'amount_cents', case_row.refund_amount_cents,
      'currency_code', 'USD',
      'provider_call_made', false,
      'payload_redacted', true
    ),
    jsonb_build_object(
      'authoritative_evidence_required', true,
      'provider_outcome', 'unknown',
      'provider_call_made', false,
      'customer_message_created', false,
      'payload_redacted', true
    ),
    authorization_id,
    null,
    request_fingerprint,
    'USD',
    'unknown',
    statement_timestamp(),
    true
  )
  returning * into attempt_row;

  update public.refund_cases
  set
    nayax_refund_execution_status = 'manual_review',
    nayax_match_execution_eligible = false
  where id = case_row.id;

  insert into public.refund_case_events (
    refund_case_id,
    actor_user_id,
    event_type,
    message,
    metadata
  ) values (
    case_row.id,
    current_actor_user_id,
    'nayax_evidence_only_reconciliation_started',
    'The mapped manager opened provider-evidence review. No provider call, reporting adjustment, or customer email occurred.',
    jsonb_build_object(
      'attempt_id', attempt_row.id,
      'authorization_id', authorization_id,
      'execution_mode', 'evidence_only',
      'provider_outcome', 'unknown',
      'provider_call_made', false,
      'customer_message_created', false,
      'payload_redacted', true
    )
  );

  return jsonb_build_object(
    'attemptId', attempt_row.id,
    'created', true,
    'status', attempt_row.status,
    'providerOutcome', attempt_row.provider_outcome,
    'providerCallMade', false,
    'customerMessageCreated', false,
    'expectedCaseVersion', (
      select refund_case.official_action_version
      from public.refund_cases refund_case
      where refund_case.id = case_row.id
    ),
    'payloadRedacted', true
  );
end;
$$;

revoke execute on function public.admin_begin_refund_nayax_evidence_only_reconciliation(
  uuid,
  bigint
) from public, anon, service_role;
grant execute on function public.admin_begin_refund_nayax_evidence_only_reconciliation(
  uuid,
  bigint
) to authenticated;

do $$
declare
  resolver_definition text;
  result_gate_pattern text :=
    $pattern$if[[:space:]]+p_evidence_occurred_at[[:space:]]+is[[:space:]]+not[[:space:]]+null[[:space:]]+and[[:space:]]+\($pattern$;
  new_result_gate text := $new$if attempt_row.execution_mode = 'evidence_only'
    and normalized_result not in ('provider_confirmed_success', 'remain_on_hold') then
    raise exception 'Evidence-only reconciliation can only record success or preserve the hold';
  end if;

  if p_evidence_occurred_at is not null
    and ($new$;
  time_gate_pattern text :=
    $pattern$p_evidence_occurred_at[[:space:]]*<[[:space:]]*attempt_row\.created_at[[:space:]]+or[[:space:]]+p_evidence_occurred_at[[:space:]]*>[[:space:]]*resolved_at[[:space:]]*\+[[:space:]]*interval[[:space:]]+'30 seconds'$pattern$;
  new_time_gate text := $new$      (
        attempt_row.execution_mode <> 'evidence_only'
        and p_evidence_occurred_at < attempt_row.created_at
      )
      or (
        attempt_row.execution_mode = 'evidence_only'
        and (
          case_row.matched_nayax_machine_auth_time is null
          or p_evidence_occurred_at < case_row.matched_nayax_machine_auth_time
        )
      )
      or p_evidence_occurred_at > resolved_at + interval '30 seconds'$new$;
begin
  resolver_definition := pg_get_functiondef(
    'public.admin_resolve_refund_nayax_outcome_manager_session(uuid,uuid,text,text,text,timestamptz,text,bigint)'::regprocedure
  );

  if resolver_definition !~ result_gate_pattern
    or resolver_definition !~ time_gate_pattern then
    raise exception 'Expected manager-session refund resolver definition required';
  end if;

  resolver_definition := regexp_replace(
    resolver_definition,
    result_gate_pattern,
    new_result_gate
  );
  resolver_definition := regexp_replace(
    resolver_definition,
    time_gate_pattern,
    new_time_gate
  );
  execute resolver_definition;
end;
$$;

create or replace function public.admin_get_refund_nayax_resolution_readiness(
  p_refund_case_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  current_actor_user_id uuid := auth.uid();
  case_row public.refund_cases%rowtype;
  attempt_row public.refund_case_nayax_refund_attempts%rowtype;
  has_manager_authority boolean := false;
  can_start_evidence_only boolean := false;
begin
  if current_actor_user_id is null
    or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'Authenticated Machine Manager session required';
  end if;

  select refund_case.*
  into case_row
  from public.refund_cases refund_case
  where refund_case.id = p_refund_case_id;

  if not found then
    return jsonb_build_object(
      'visible', false,
      'available', false,
      'payloadRedacted', true
    );
  end if;

  has_manager_authority := public.can_perform_refund_official_action(
    current_actor_user_id,
    case_row.id
  );
  if not has_manager_authority then
    return jsonb_build_object(
      'visible', false,
      'available', false,
      'blockReason', 'manager_access_required',
      'payloadRedacted', true
    );
  end if;

  select attempt.*
  into attempt_row
  from public.refund_case_nayax_refund_attempts attempt
  where attempt.refund_case_id = case_row.id
    and attempt.provider_outcome in ('rejected', 'timeout', 'unknown')
  order by attempt.created_at desc, attempt.id desc
  limit 1;

  can_start_evidence_only :=
    public.refund_nayax_evidence_only_start_is_safe(case_row.id);

  return jsonb_build_object(
    'visible', true,
    'available', public.refund_nayax_outcome_resolution_enabled()
      and attempt_row.id is not null
      and public.refund_nayax_provider_outcome_state(
        case_row.nayax_refund_execution_status
      ) in ('unconfirmed', 'rejected')
      and attempt_row.support_resolution_id is null,
    'blockReason', case
      when not public.refund_nayax_outcome_resolution_enabled()
        then 'resolution_disabled'
      when attempt_row.id is null and can_start_evidence_only
        then 'evidence_only_start_required'
      when attempt_row.id is null
        then 'exact_attempt_required'
      when attempt_row.support_resolution_id is not null
        then 'already_resolved'
      when public.refund_nayax_provider_outcome_state(
        case_row.nayax_refund_execution_status
      ) not in ('unconfirmed', 'rejected')
        then 'provider_hold_required'
      else null
    end,
    'canStartEvidenceOnlyReconciliation', can_start_evidence_only,
    'attemptId', attempt_row.id,
    'providerOutcome', attempt_row.provider_outcome,
    'manualPortalAttempt', attempt_row.execution_mode = 'manual_portal',
    'evidenceOnlyAttempt', attempt_row.execution_mode = 'evidence_only',
    'expectedCaseVersion', case_row.official_action_version,
    'allowedResults', case
      when attempt_row.execution_mode = 'evidence_only' then
        jsonb_build_array('provider_confirmed_success', 'remain_on_hold')
      else
        jsonb_build_array(
          'provider_confirmed_success',
          'provider_confirmed_retry_safe',
          'documented_manual_completion',
          'remain_on_hold'
        )
      end,
    'authorizationMethod', 'manager_session',
    'payloadRedacted', true
  );
end;
$$;

revoke execute on function public.admin_get_refund_nayax_resolution_readiness(uuid)
  from public, anon, service_role;
grant execute on function public.admin_get_refund_nayax_resolution_readiness(uuid)
  to authenticated;

comment on function public.admin_begin_refund_nayax_evidence_only_reconciliation(
  uuid,
  bigint
) is
  'Opens one provider-free evidence review for a matched, never-attempted Nayax card case. It cannot call Nayax, create a customer message, or post reporting.';

comment on function public.refund_nayax_evidence_only_start_is_safe(uuid) is
  'Fail-closed eligibility check for provider-free reconciliation of a Nayax refund completed outside Bloomjoy.';

comment on function public.admin_resolve_refund_nayax_outcome_manager_session(
  uuid, uuid, text, text, text, timestamptz, text, bigint
) is
  'Records one authoritative result for the exact latest held or evidence-only Nayax attempt. It can never call Nayax; customer completion remains exactly-once.';

select pg_notify('pgrst', 'reload schema');
