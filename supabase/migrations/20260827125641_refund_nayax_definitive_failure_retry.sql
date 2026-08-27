-- #990: a contract-matched, HTTP-successful Nayax rejection proves that no
-- refund was sent. Release only that exact terminal attempt for a fresh,
-- manager-confirmed generation. Timeouts, transport failures, contract
-- mismatches, and unknown outcomes remain on the Refund Operations hold.

alter table public.refund_case_nayax_refund_attempts
  drop constraint if exists refund_nayax_attempt_safe_transport_stage_check,
  add constraint refund_nayax_attempt_safe_transport_stage_check check (
    safe_transport_stage in (
      'reserved', 'request_started', 'request_result', 'approval_started',
      'approval_result', 'settled', 'released_no_call',
      'released_no_refund', 'confirmation_hold'
    )
  );

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
            and final_result.http_status between 200 and 299
            and final_result.failure_type is null
            and final_result.classification_digest ~ '^[a-f0-9]{64}$'
            and final_result.provider_contract_version =
              'nayax-production-observed-2026-08-22'
            and final_result.journal_contract_version =
              'nayax-provider-journal-v2'
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
                    and request_result.http_status between 200 and 299
                    and request_result.failure_type is null
                    and request_result.provider_contract_version =
                      final_result.provider_contract_version
                    and request_result.journal_contract_version =
                      final_result.journal_contract_version
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
  public.refund_nayax_definitive_rejection_is_retry_safe(uuid)
  from public, anon, authenticated, service_role;

create or replace function public.sync_refund_nayax_attempt_safe_state()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.provider_outcome = 'success' and new.status = 'succeeded' then
    new.safe_transport_stage := 'settled';
    new.safe_failure_class := null;
    new.refund_operations_due_at := null;
  elsif new.status in ('ambiguous', 'manual_review')
    or new.provider_outcome in ('timeout', 'unknown') then
    new.safe_transport_stage := 'confirmation_hold';
    new.safe_failure_class := coalesce(
      new.safe_failure_class,
      case
        when new.provider_outcome = 'timeout' then 'provider_timeout'
        else 'provider_unknown'
      end
    );
    new.refund_operations_due_at := coalesce(
      new.refund_operations_due_at,
      new.created_at + interval '60 minutes'
    );
  elsif new.provider_outcome = 'rejected'
    and new.status = 'declined'
    and new.reconciliation_required is false then
    new.safe_failure_class := 'provider_rejected';
    new.refund_operations_due_at := null;
  elsif new.reconciliation_required is false then
    new.refund_operations_due_at := null;
  end if;
  return new;
end;
$$;

-- Project journal evidence without routing an authoritative rejection to the
-- exception queue. If settlement does not commit, stale-attempt recovery still
-- sees the transport journal and creates the confirmation hold.
alter function public.service_record_nayax_refund_provider_stage_v2(
  text, uuid, text, text, text, integer, text, boolean, text, text, text, text
) rename to service_record_nayax_refund_provider_stage_v2_pre_definitive_retry_v1;

revoke execute on function
  public.service_record_nayax_refund_provider_stage_v2_pre_definitive_retry_v1(
    text, uuid, text, text, text, integer, text, boolean, text, text, text, text
  ) from public, anon, authenticated, service_role;

create function public.service_record_nayax_refund_provider_stage_v2(
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
  p_journal_contract_version text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  result jsonb;
  normalized_stage text := lower(btrim(coalesce(p_stage, '')));
  normalized_event text := lower(btrim(coalesce(p_event, '')));
  normalized_outcome text := nullif(lower(btrim(coalesce(p_outcome, ''))), '');
  normalized_failure text := nullif(lower(btrim(coalesce(p_failure_type, ''))), '');
  definitive_rejection boolean := false;
begin
  result := public.service_record_nayax_refund_provider_stage_v2_pre_definitive_retry_v1(
    p_executor_assertion,
    p_attempt_id,
    p_provider_claim_token,
    p_stage,
    p_event,
    p_http_status,
    p_outcome,
    p_contract_matched,
    p_failure_type,
    p_classification_digest,
    p_provider_contract_version,
    p_journal_contract_version
  );

  definitive_rejection :=
    normalized_event = 'result'
    and normalized_outcome = 'rejected'
    and p_contract_matched is true
    and p_http_status between 200 and 299
    and normalized_failure is null;

  if definitive_rejection then
    update public.refund_case_nayax_refund_attempts
    set
      safe_failure_class = 'provider_rejected',
      refund_operations_due_at = null
    where id = p_attempt_id;
  end if;

  return result || jsonb_build_object(
    'refundOperationsRequired', case
      when definitive_rejection then false
      else coalesce((result ->> 'refundOperationsRequired')::boolean, false)
    end,
    'definitiveNoRefund', definitive_rejection,
    'safeRetryEligible', false,
    'payloadRedacted', true
  );
end;
$$;

revoke execute on function public.service_record_nayax_refund_provider_stage_v2(
  text, uuid, text, text, text, integer, text, boolean, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.service_record_nayax_refund_provider_stage_v2(
  text, uuid, text, text, text, integer, text, boolean, text, text, text, text
) to service_role;

alter function public.service_settle_nayax_refund_attempt(
  text, uuid, uuid, uuid, text, integer, text, text, text, text, text, text
) rename to service_settle_nayax_refund_attempt_pre_definitive_retry_v1;

revoke execute on function
  public.service_settle_nayax_refund_attempt_pre_definitive_retry_v1(
    text, uuid, uuid, uuid, text, integer, text, text, text, text, text, text
  ) from public, anon, authenticated, service_role;

create function public.service_settle_nayax_refund_attempt(
  p_executor_assertion text,
  p_attempt_id uuid,
  p_authorization_id uuid,
  p_case_id uuid,
  p_idempotency_key text,
  p_amount_cents integer,
  p_currency_code text,
  p_provider_claim_token text,
  p_provider_outcome text,
  p_provider_reference text default null,
  p_provider_status text default null,
  p_error_code text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  result jsonb;
  normalized_outcome text := lower(btrim(coalesce(p_provider_outcome, '')));
  case_update_count integer := 0;
begin
  result := public.service_settle_nayax_refund_attempt_pre_definitive_retry_v1(
    p_executor_assertion,
    p_attempt_id,
    p_authorization_id,
    p_case_id,
    p_idempotency_key,
    p_amount_cents,
    p_currency_code,
    p_provider_claim_token,
    p_provider_outcome,
    p_provider_reference,
    p_provider_status,
    p_error_code
  );

  if normalized_outcome <> 'rejected' then
    return result || jsonb_build_object(
      'safeRetryEligible', false,
      'definitiveNoRefund', false,
      'payloadRedacted', true
    );
  end if;

  if not public.refund_nayax_definitive_rejection_is_retry_safe(p_attempt_id) then
    raise exception 'A retry-safe rejection requires exact authoritative no-refund evidence'
      using errcode = 'P4614';
  end if;

  perform pg_catalog.set_config(
    'bloomjoy.nayax_definitive_rejection_attempt_id',
    p_attempt_id::text,
    true
  );

  update public.refund_case_nayax_refund_attempts
  set
    safe_transport_stage = 'released_no_refund',
    safe_failure_class = 'provider_rejected',
    refund_operations_due_at = null,
    sanitized_response = coalesce(sanitized_response, '{}'::jsonb) ||
      jsonb_build_object(
        'safe_stage', 'released_no_refund',
        'failure_class', 'provider_rejected',
        'definitive_no_refund', true,
        'automatic_retry_made', false,
        'safe_retry_eligible', true,
        'payload_redacted', true
      )
  where id = p_attempt_id;

  update public.refund_cases
  set
    status = 'needs_review',
    decision = null,
    decision_reason = null,
    decided_by = null,
    decided_at = null,
    nayax_refund_execution_status = 'not_requested',
    nayax_match_execution_eligible = true,
    nayax_refund_attempt_generation = nayax_refund_attempt_generation + 1
  where id = p_case_id
    and status in ('approved', 'card_refund_pending')
    and decision = 'approved'
    and nayax_refund_execution_status = 'declined'
    and nayax_match_execution_eligible is false
    and reporting_adjustment_id is null
    and refund_completed_at is null;
  get diagnostics case_update_count = row_count;

  if case_update_count <> 1 then
    raise exception 'The definitive no-refund result could not restore the exact case safely'
      using errcode = 'P4614';
  end if;

  insert into public.refund_case_events (
    refund_case_id,
    actor_user_id,
    event_type,
    message,
    metadata
  )
  select
    p_case_id,
    action_authorization.actor_user_id,
    'nayax_definitive_no_refund_released',
    'Bloomjoy confirmed that no refund was sent. The normal manager action is available under a fresh attempt generation.',
    jsonb_build_object(
      'attempt_id', p_attempt_id,
      'safe_stage', 'released_no_refund',
      'failure_class', 'provider_rejected',
      'definitive_no_refund', true,
      'safe_retry_eligible', true,
      'automatic_retry_made', false,
      'refund_operations_required', false,
      'payload_redacted', true
    )
  from public.refund_case_official_action_authorizations action_authorization
  where action_authorization.id = p_authorization_id;

  return result || jsonb_build_object(
    'attempt', public.refund_nayax_attempt_snapshot(p_attempt_id, false),
    'safeRetryEligible', true,
    'definitiveNoRefund', true,
    'refundOperationsRequired', false,
    'automaticRetryMade', false,
    'payloadRedacted', true
  );
end;
$$;

revoke execute on function public.service_settle_nayax_refund_attempt(
  text, uuid, uuid, uuid, text, integer, text, text, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.service_settle_nayax_refund_attempt(
  text, uuid, uuid, uuid, text, integer, text, text, text, text, text, text
) to service_role;

create or replace function public.guard_refund_nayax_attempt_generation()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  resolution_id uuid := nullif(
    current_setting('bloomjoy.nayax_support_resolution_id', true),
    ''
  )::uuid;
  no_call_attempt_id uuid := nullif(
    current_setting('bloomjoy.nayax_no_call_recovery_attempt_id', true),
    ''
  )::uuid;
  rejection_attempt_id uuid := nullif(
    current_setting('bloomjoy.nayax_definitive_rejection_attempt_id', true),
    ''
  )::uuid;
  database_owner text;
  resolver_owner text;
  recovery_owner text;
  settlement_owner text;
  exact_generation_advance boolean := false;
  exact_no_call_advance boolean := false;
  exact_rejection_advance boolean := false;
begin
  if new.nayax_refund_attempt_generation is not distinct from
      old.nayax_refund_attempt_generation then
    return new;
  end if;

  select pg_catalog.pg_get_userbyid(database.datdba)
  into database_owner
  from pg_catalog.pg_database database
  where database.datname = current_database();

  select pg_catalog.pg_get_userbyid(procedure.proowner)
  into resolver_owner
  from pg_catalog.pg_proc procedure
  where procedure.oid =
    'public.admin_consume_refund_nayax_resolution_intent(uuid,uuid,uuid,text,text,text,timestamptz,text,text)'::regprocedure;

  select pg_catalog.pg_get_userbyid(procedure.proowner)
  into recovery_owner
  from pg_catalog.pg_proc procedure
  where procedure.oid =
    'public.service_recover_stale_nayax_refund_attempts(text)'::regprocedure;

  select pg_catalog.pg_get_userbyid(procedure.proowner)
  into settlement_owner
  from pg_catalog.pg_proc procedure
  where procedure.oid =
    'public.service_settle_nayax_refund_attempt(text,uuid,uuid,uuid,text,integer,text,text,text,text,text,text)'::regprocedure;

  if resolution_id is not null then
    select exists (
      select 1
      from public.refund_nayax_outcome_resolutions resolution
      join public.refund_case_nayax_refund_attempts attempt
        on attempt.id = resolution.nayax_refund_attempt_id
      where resolution.id = resolution_id
        and resolution.refund_case_id = old.id
        and resolution.resolution_result = 'provider_confirmed_retry_safe'
        and resolution.prior_attempt_generation =
          old.nayax_refund_attempt_generation
        and resolution.next_attempt_generation =
          new.nayax_refund_attempt_generation
        and attempt.support_resolution_id = resolution.id
        and attempt.support_resolution_result =
          'provider_confirmed_retry_safe'
    ) into exact_generation_advance;
  end if;

  if no_call_attempt_id is not null then
    select exists (
      select 1
      from public.refund_case_nayax_refund_attempts attempt
      where attempt.id = no_call_attempt_id
        and attempt.refund_case_id = old.id
        and attempt.execution_mode = 'request_and_approve'
        and attempt.status = 'failed'
        and attempt.provider_outcome is null
        and attempt.reconciliation_required is false
        and attempt.provider_claim_consumed_at is not null
        and attempt.safe_transport_stage = 'released_no_call'
        and attempt.safe_failure_class = 'interrupted_before_transport'
        and attempt.error_code = 'interrupted_before_transport'
        and not exists (
          select 1
          from public.refund_nayax_provider_stage_journal journal
          where journal.nayax_refund_attempt_id = attempt.id
        )
        and new.nayax_refund_attempt_generation =
          old.nayax_refund_attempt_generation + 1
    ) into exact_no_call_advance;
  end if;

  if rejection_attempt_id is not null then
    select exists (
      select 1
      from public.refund_case_nayax_refund_attempts attempt
      where attempt.id = rejection_attempt_id
        and attempt.refund_case_id = old.id
        and attempt.safe_transport_stage = 'released_no_refund'
        and attempt.safe_failure_class = 'provider_rejected'
        and attempt.refund_operations_due_at is null
        and public.refund_nayax_definitive_rejection_is_retry_safe(attempt.id)
        and new.nayax_refund_attempt_generation =
          old.nayax_refund_attempt_generation + 1
    ) into exact_rejection_advance;
  end if;

  if current_user is distinct from database_owner
    or not (
      (exact_generation_advance and resolver_owner = database_owner)
      or (exact_no_call_advance and recovery_owner = database_owner)
      or (exact_rejection_advance and settlement_owner = database_owner)
    ) then
    raise exception 'Nayax attempt generation advances only through one exact retry-safe support resolution, provable no-call recovery, or authoritative no-refund evidence';
  end if;

  return new;
end;
$$;

create or replace function public.guard_refund_provider_hold_case_update()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  resolution_id uuid := nullif(
    current_setting('bloomjoy.nayax_support_resolution_id', true),
    ''
  )::uuid;
  interruption_attempt_id uuid := nullif(
    current_setting('bloomjoy.nayax_interruption_recovery_attempt_id', true),
    ''
  )::uuid;
  rejection_attempt_id uuid := nullif(
    current_setting('bloomjoy.nayax_definitive_rejection_attempt_id', true),
    ''
  )::uuid;
  database_owner text;
  resolver_owner text;
  recovery_owner text;
  settlement_owner text;
  exact_resolution boolean := false;
  exact_interruption_recovery boolean := false;
  exact_rejection_release boolean := false;
begin
  select pg_catalog.pg_get_userbyid(database.datdba)
  into database_owner
  from pg_catalog.pg_database database
  where database.datname = current_database();

  if resolution_id is not null then
    select pg_catalog.pg_get_userbyid(procedure.proowner)
    into resolver_owner
    from pg_catalog.pg_proc procedure
    where procedure.oid =
      'public.admin_consume_refund_nayax_resolution_intent(uuid,uuid,uuid,text,text,text,timestamptz,text,text)'::regprocedure;
    select exists (
      select 1
      from public.refund_nayax_outcome_resolutions resolution
      where resolution.id = resolution_id
        and resolution.refund_case_id = old.id
        and resolution.resolution_result in (
          'provider_confirmed_success', 'provider_confirmed_retry_safe',
          'documented_manual_completion'
        )
    ) and current_user = database_owner and current_user = resolver_owner
    into exact_resolution;
  end if;

  if interruption_attempt_id is not null then
    select pg_catalog.pg_get_userbyid(procedure.proowner)
    into recovery_owner
    from pg_catalog.pg_proc procedure
    where procedure.oid =
      'public.service_recover_stale_nayax_refund_attempts(text)'::regprocedure;
    select exists (
      select 1
      from public.refund_case_nayax_refund_attempts attempt
      where attempt.id = interruption_attempt_id
        and attempt.refund_case_id = old.id
        and attempt.provider_claim_consumed_at is not null
        and (
          (
            attempt.status = 'failed'
            and attempt.provider_outcome is null
            and attempt.reconciliation_required is false
            and attempt.safe_transport_stage = 'released_no_call'
            and new.status = 'needs_review'
            and new.decision is null
            and new.nayax_refund_execution_status = 'not_requested'
          )
          or (
            attempt.status = 'manual_review'
            and attempt.provider_outcome = 'unknown'
            and attempt.reconciliation_required is true
            and attempt.safe_transport_stage = 'confirmation_hold'
            and new.status = 'card_refund_pending'
            and new.decision = 'approved'
            and new.nayax_refund_execution_status = 'manual_review'
          )
        )
    ) and current_user = database_owner and recovery_owner = database_owner
    into exact_interruption_recovery;
  end if;

  if rejection_attempt_id is not null then
    select pg_catalog.pg_get_userbyid(procedure.proowner)
    into settlement_owner
    from pg_catalog.pg_proc procedure
    where procedure.oid =
      'public.service_settle_nayax_refund_attempt(text,uuid,uuid,uuid,text,integer,text,text,text,text,text,text)'::regprocedure;
    select exists (
      select 1
      from public.refund_case_nayax_refund_attempts attempt
      where attempt.id = rejection_attempt_id
        and attempt.refund_case_id = old.id
        and attempt.safe_transport_stage = 'released_no_refund'
        and attempt.safe_failure_class = 'provider_rejected'
        and attempt.refund_operations_due_at is null
        and public.refund_nayax_definitive_rejection_is_retry_safe(attempt.id)
        and old.nayax_refund_execution_status = 'declined'
        and new.status = 'needs_review'
        and new.decision is null
        and new.decision_reason is null
        and new.decided_by is null
        and new.decided_at is null
        and new.nayax_refund_execution_status = 'not_requested'
        and new.nayax_match_execution_eligible is true
        and new.nayax_refund_attempt_generation =
          old.nayax_refund_attempt_generation + 1
        and new.refund_amount_cents is not distinct from old.refund_amount_cents
        and new.manual_refund_reference is not distinct from
          old.manual_refund_reference
        and new.refund_completed_by is not distinct from old.refund_completed_by
        and new.refund_completed_at is not distinct from old.refund_completed_at
        and new.reporting_adjustment_id is not distinct from
          old.reporting_adjustment_id
        and new.matched_nayax_transaction_id is not distinct from
          old.matched_nayax_transaction_id
        and new.matched_nayax_machine_auth_time is not distinct from
          old.matched_nayax_machine_auth_time
        and new.matched_nayax_amount_cents is not distinct from
          old.matched_nayax_amount_cents
    ) and current_user = database_owner and settlement_owner = database_owner
    into exact_rejection_release;
  end if;

  if public.refund_nayax_provider_outcome_state(
      old.nayax_refund_execution_status
    ) in ('unconfirmed', 'rejected')
    and row(
      old.status, old.decision, old.decision_reason, old.decided_by,
      old.decided_at, old.refund_amount_cents, old.manual_refund_reference,
      old.refund_completed_by, old.refund_completed_at,
      old.reporting_adjustment_id
    ) is distinct from row(
      new.status, new.decision, new.decision_reason, new.decided_by,
      new.decided_at, new.refund_amount_cents, new.manual_refund_reference,
      new.refund_completed_by, new.refund_completed_at,
      new.reporting_adjustment_id
    )
    and not exact_resolution
    and not exact_interruption_recovery
    and not exact_rejection_release
    and (
      lower(btrim(coalesce(old.nayax_refund_execution_status, ''))) <>
        'requested'
      or nullif(
        current_setting('bloomjoy.nayax_settlement_attempt_id', true),
        ''
      ) is null
    ) then
    raise exception 'Nayax provider outcome freezes official case decisions for payment support';
  end if;
  return new;
end;
$$;

create or replace function public.refund_lifecycle_contract(
  p_refund_case_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  case_row public.refund_cases%rowtype;
  attempt_row public.refund_case_nayax_refund_attempts%rowtype;
  latest_journal public.refund_nayax_provider_stage_journal%rowtype;
  stage text;
  evidence_state text;
  public_copy_key text;
  manager_next_action text;
  terminal boolean := false;
  stage_rank integer;
  last_updated_at timestamptz;
  operations_required boolean := false;
  operations_age_minutes integer := null;
  operations_due_at timestamptz := null;
  definitive_no_refund boolean := false;
begin
  select refund_case.* into case_row
  from public.refund_cases refund_case
  where refund_case.id = p_refund_case_id;
  if not found then return null; end if;

  select attempt.* into attempt_row
  from public.refund_case_nayax_refund_attempts attempt
  where attempt.refund_case_id = case_row.id
  order by attempt.created_at desc, attempt.id desc
  limit 1;

  if attempt_row.id is not null then
    select journal.* into latest_journal
    from public.refund_nayax_provider_stage_journal journal
    where journal.nayax_refund_attempt_id = attempt_row.id
    order by journal.created_at desc, journal.id desc
    limit 1;
  end if;

  definitive_no_refund := attempt_row.id is not null
    and attempt_row.provider_outcome = 'rejected'
    and attempt_row.safe_transport_stage = 'released_no_refund'
    and attempt_row.reconciliation_required is false
    and case_row.nayax_refund_execution_status = 'not_requested'
    and public.refund_nayax_definitive_rejection_is_retry_safe(attempt_row.id);

  operations_required := attempt_row.id is not null and (
    attempt_row.status in ('ambiguous', 'manual_review')
    or attempt_row.reconciliation_required is true
    or attempt_row.provider_outcome in ('timeout', 'unknown')
    or (
      attempt_row.provider_outcome = 'rejected'
      and not definitive_no_refund
    )
  );
  operations_due_at := case when operations_required then coalesce(
    attempt_row.refund_operations_due_at,
    attempt_row.created_at + interval '60 minutes'
  ) else null end;
  operations_age_minutes := case when operations_required then greatest(
    0,
    floor(extract(epoch from (
      statement_timestamp() - attempt_row.created_at
    )) / 60)::integer
  ) else null end;

  if case_row.status in ('denied', 'closed') then
    stage := 'denied'; evidence_state := 'denied';
    public_copy_key := 'refund_denied'; manager_next_action := 'none';
    terminal := true; stage_rank := 90;
  elsif case_row.status = 'completed'
    and (
      case_row.payment_method <> 'card'
      or attempt_row.completion_delivery_status = 'sent'
    ) then
    stage := 'customer_notified'; evidence_state := 'customer_delivery_recorded';
    public_copy_key := 'refund_customer_notified'; manager_next_action := 'none';
    terminal := true; stage_rank := 80;
  elsif case_row.status = 'completed'
    or attempt_row.provider_outcome = 'success' then
    stage := 'refund_confirmed'; evidence_state := 'provider_confirmed';
    public_copy_key := 'refund_confirmed_bank_pending';
    manager_next_action := 'wait_for_customer_notification';
    terminal := false; stage_rank := 70;
  elsif operations_required then
    stage := 'needs_refund_operations'; evidence_state := 'operations_hold';
    public_copy_key := 'refund_confirmation_in_progress';
    manager_next_action := 'refund_operations';
    terminal := false; stage_rank := 60;
  elsif attempt_row.id is not null and (
    latest_journal.stage = 'approve'
    or attempt_row.status in ('approved', 'requested')
  ) then
    stage := 'confirming_with_nayax';
    evidence_state := 'awaiting_authoritative_confirmation';
    public_copy_key := 'refund_confirming'; manager_next_action := 'wait';
    terminal := false; stage_rank := 50;
  elsif attempt_row.id is not null
    and attempt_row.status in ('in_progress', 'requested') then
    stage := 'refund_initiated'; evidence_state := 'request_recorded';
    public_copy_key := 'refund_initiated'; manager_next_action := 'wait';
    terminal := false; stage_rank := 40;
  elsif case_row.matched_nayax_transaction_id is not null
    and case_row.correlation_status = 'matched' then
    stage := 'transaction_confirmed'; evidence_state := 'transaction_confirmed';
    public_copy_key := 'refund_transaction_confirmed';
    manager_next_action := 'refund'; terminal := false; stage_rank := 30;
  elsif exists (
    select 1
    from public.refund_nayax_lookup_candidates candidate
    where candidate.refund_case_id = case_row.id
      and candidate.lookup_generation = case_row.nayax_lookup_generation
      and candidate.expires_at > statement_timestamp()
  ) and case_row.nayax_lookup_status <> 'checking' then
    stage := 'needs_transaction_selection'; evidence_state := 'candidate_review';
    public_copy_key := 'refund_reviewing_purchase';
    manager_next_action := 'select_transaction';
    terminal := false; stage_rank := 20;
  else
    stage := 'matching'; evidence_state := case
      when case_row.nayax_lookup_status in (
        'lookup_failed', 'lookup_timed_out', 'response_limited'
      ) then 'lookup_attention'
      else 'matching'
    end;
    public_copy_key := 'refund_request_received';
    manager_next_action := case
      when case_row.nayax_lookup_safe_retry_eligible then 'retry_read_only_lookup'
      else 'wait'
    end;
    terminal := false; stage_rank := 10;
  end if;

  last_updated_at := greatest(
    case_row.updated_at,
    coalesce(case_row.nayax_lookup_finished_at, '-infinity'::timestamptz),
    coalesce(case_row.nayax_lookup_started_at, '-infinity'::timestamptz),
    coalesce(attempt_row.updated_at, '-infinity'::timestamptz),
    coalesce(latest_journal.created_at, '-infinity'::timestamptz)
  );

  return jsonb_build_object(
    'schemaVersion', 'refund_lifecycle_v1',
    'stage', stage,
    'stageRank', stage_rank,
    'evidenceState', evidence_state,
    'lastUpdatedAt', last_updated_at,
    'publicCopyKey', public_copy_key,
    'managerNextAction', manager_next_action,
    'terminal', terminal,
    'refreshAfterSeconds', case when terminal then null else 5 end,
    'lookup', jsonb_build_object(
      'status', case_row.nayax_lookup_status,
      'safeRetryEligible', case_row.nayax_lookup_safe_retry_eligible,
      'failureClass', case_row.nayax_lookup_failure_class,
      'lastUpdatedAt', coalesce(
        case_row.nayax_lookup_finished_at,
        case_row.nayax_lookup_started_at
      )
    ),
    'operations', jsonb_build_object(
      'required', operations_required,
      'queue', 'Refund Operations',
      'owner', 'Refund Operations',
      'slaMinutes', 60,
      'ageMinutes', operations_age_minutes,
      'dueAt', operations_due_at,
      'slaBreached', coalesce(
        operations_due_at <= statement_timestamp(),
        false
      ),
      'safeStage', coalesce(attempt_row.safe_transport_stage, 'not_started'),
      'failureClass', attempt_row.safe_failure_class,
      'nextStep', case
        when operations_required
          then 'Confirm the authoritative Nayax result. Do not retry.'
        else null
      end
    ),
    'definitiveNoRefund', definitive_no_refund,
    'safeRetryEligible', definitive_no_refund,
    'payloadRedacted', true
  );
end;
$$;

revoke execute on function public.refund_lifecycle_contract(uuid)
  from public, anon, authenticated, service_role;

-- Release any previously stuck rejection only when the same authoritative
-- evidence now required by settlement is already present. No provider call is
-- made by this backfill.
do $$
declare
  rejected_attempt record;
begin
  for rejected_attempt in
    select attempt.id, attempt.refund_case_id
    from public.refund_case_nayax_refund_attempts attempt
    join public.refund_cases refund_case
      on refund_case.id = attempt.refund_case_id
    where attempt.status = 'declined'
      and attempt.provider_outcome = 'rejected'
      and attempt.reconciliation_required is false
      and refund_case.status in ('approved', 'card_refund_pending')
      and refund_case.decision = 'approved'
      and refund_case.nayax_refund_execution_status = 'declined'
      and refund_case.nayax_match_execution_eligible is false
      and refund_case.reporting_adjustment_id is null
      and refund_case.refund_completed_at is null
      and public.refund_nayax_definitive_rejection_is_retry_safe(attempt.id)
    order by attempt.created_at, attempt.id
    for update of attempt, refund_case
  loop
    perform pg_catalog.set_config(
      'bloomjoy.nayax_definitive_rejection_attempt_id',
      rejected_attempt.id::text,
      true
    );

    update public.refund_case_nayax_refund_attempts
    set
      safe_transport_stage = 'released_no_refund',
      safe_failure_class = 'provider_rejected',
      refund_operations_due_at = null,
      sanitized_response = coalesce(sanitized_response, '{}'::jsonb) ||
        jsonb_build_object(
          'safe_stage', 'released_no_refund',
          'failure_class', 'provider_rejected',
          'definitive_no_refund', true,
          'automatic_retry_made', false,
          'safe_retry_eligible', true,
          'payload_redacted', true
        )
    where id = rejected_attempt.id;

    update public.refund_cases
    set
      status = 'needs_review',
      decision = null,
      decision_reason = null,
      decided_by = null,
      decided_at = null,
      nayax_refund_execution_status = 'not_requested',
      nayax_match_execution_eligible = true,
      nayax_refund_attempt_generation = nayax_refund_attempt_generation + 1
    where id = rejected_attempt.refund_case_id;

    insert into public.refund_case_events (
      refund_case_id, actor_user_id, event_type, message, metadata
    ) values (
      rejected_attempt.refund_case_id,
      null,
      'nayax_definitive_no_refund_released',
      'Bloomjoy confirmed that no refund was sent. The normal manager action is available under a fresh attempt generation.',
      jsonb_build_object(
        'attempt_id', rejected_attempt.id,
        'safe_stage', 'released_no_refund',
        'failure_class', 'provider_rejected',
        'definitive_no_refund', true,
        'safe_retry_eligible', true,
        'automatic_retry_made', false,
        'refund_operations_required', false,
        'migration_backfill', true,
        'payload_redacted', true
      )
    );
  end loop;
end;
$$;

comment on function
  public.refund_nayax_definitive_rejection_is_retry_safe(uuid) is
  'Private exact-evidence predicate: true only after an immutable, contract-matched HTTP 2xx rejection proves that no Nayax refund was sent.';
comment on function public.service_settle_nayax_refund_attempt(
  text, uuid, uuid, uuid, text, integer, text, text, text, text, text, text
) is
  'Settles one claimed attempt. Confirmed success commits case/reporting; unknown outcomes hold; an authoritative no-refund rejection alone restores a fresh manager-confirmed generation without automatic retry.';
comment on column public.refund_case_nayax_refund_attempts.safe_transport_stage is
  'Sanitized durable transport stage. released_no_refund means immutable provider evidence proved no refund occurred and a fresh manager action may be offered.';
