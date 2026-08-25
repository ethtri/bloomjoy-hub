-- Make the database the sole authority for the normal Nayax request-to-approval
-- transition. The existing v1 RPC remains unchanged so migration-first rollout
-- and an immediate Edge rollback both fail closed on unfamiliar responses.

alter table public.refund_nayax_provider_stage_journal
  add column if not exists approval_authorized boolean,
  add column if not exists provider_contract_version text,
  add column if not exists journal_contract_version text;

alter table public.refund_nayax_provider_stage_journal
  drop constraint if exists refund_nayax_provider_stage_approval_authority_shape_check,
  add constraint refund_nayax_provider_stage_approval_authority_shape_check check (
    approval_authorized is null
    or (stage = 'request' and event = 'result')
  ),
  drop constraint if exists refund_nayax_provider_stage_contract_versions_safe_check,
  add constraint refund_nayax_provider_stage_contract_versions_safe_check check (
    (provider_contract_version is null or provider_contract_version ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$')
    and (journal_contract_version is null or journal_contract_version ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$')
  );

alter table public.refund_nayax_pending_approval_recoveries enable row level security;
alter table public.refund_nayax_provider_stage_journal enable row level security;

revoke all on table public.refund_nayax_pending_approval_recoveries
  from public, anon, authenticated, service_role;
revoke all on table public.refund_nayax_provider_stage_journal
  from public, anon, authenticated, service_role;

create index if not exists refund_nayax_pending_recoveries_actor_idx
  on public.refund_nayax_pending_approval_recoveries (actor_user_id);
create index if not exists refund_nayax_stage_journal_recovery_idx
  on public.refund_nayax_provider_stage_journal (pending_approval_recovery_id);

create or replace function public.service_get_nayax_refund_provider_journal_capability(
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
    'journalContractVersion', 'nayax-provider-journal-v2',
    'approvalPolicyVersion', 'db-authoritative-unknown-2xx-v1',
    'supportedProviderContractVersions', jsonb_build_array(
      'nayax-production-observed-2026-08-22'
    ),
    'payloadRedacted', true
  );
end;
$$;

create or replace function public.service_record_nayax_refund_provider_stage_v2(
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
  normalized_stage text := lower(btrim(coalesce(p_stage, '')));
  normalized_event text := lower(btrim(coalesce(p_event, '')));
  normalized_outcome text := nullif(lower(btrim(coalesce(p_outcome, ''))), '');
  normalized_failure text := nullif(lower(btrim(coalesce(p_failure_type, ''))), '');
  normalized_provider_version text := btrim(coalesce(p_provider_contract_version, ''));
  normalized_journal_version text := btrim(coalesce(p_journal_contract_version, ''));
  attempt_row public.refund_case_nayax_refund_attempts%rowtype;
  claim_digest text;
  approval_authorized boolean := false;
begin
  perform public.assert_nayax_provider_executor(p_executor_assertion);

  if normalized_journal_version <> 'nayax-provider-journal-v2'
    or normalized_provider_version <> 'nayax-production-observed-2026-08-22' then
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
    p_http_status is not null or normalized_outcome is not null
    or p_contract_matched is not null or normalized_failure is not null
  ) then
    raise exception 'A started stage cannot claim a provider result'
      using errcode = 'P4612';
  end if;
  if normalized_event = 'result' and (
    normalized_outcome not in (
      'accepted', 'succeeded', 'rejected', 'duplicate',
      'already_refunded', 'pending', 'unknown'
    ) or p_contract_matched is null
    or (p_http_status is not null and (p_http_status < 100 or p_http_status > 599))
    or (normalized_failure is not null and normalized_failure not in ('timeout', 'network'))
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
  ) then
    raise exception 'Nayax stage result requires its started marker'
      using errcode = 'P4612';
  end if;

  if normalized_stage = 'request' and normalized_event = 'result' then
    approval_authorized :=
      normalized_failure is null
      and p_http_status between 200 and 299
      and (
        (normalized_outcome = 'accepted' and p_contract_matched is true)
        or (normalized_outcome = 'unknown' and p_contract_matched is false)
      );
  end if;

  if normalized_stage = 'approve' and normalized_event = 'started'
    and not exists (
      select 1
      from public.refund_nayax_provider_stage_journal journal
      where journal.nayax_refund_attempt_id = p_attempt_id
        and journal.pending_approval_recovery_id is null
        and journal.stage = 'request'
        and journal.event = 'result'
        and journal.approval_authorized is true
        and journal.provider_contract_version = normalized_provider_version
        and journal.journal_contract_version = normalized_journal_version
    ) then
    raise exception 'Approval requires database-authorized request evidence'
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
    journal_contract_version
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
    normalized_journal_version
  );

  return jsonb_build_object(
    'recorded', true,
    'approvalAuthorized', approval_authorized,
    'journalContractVersion', normalized_journal_version,
    'providerContractVersion', normalized_provider_version,
    'payloadRedacted', true
  );
end;
$$;

create or replace function public.refund_nayax_account_execution_hold(
  p_nayax_account_key text
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with held as (
    select attempt.created_at
    from public.refund_case_nayax_refund_attempts attempt
    join public.refund_cases refund_case
      on refund_case.id = attempt.refund_case_id
    join public.reporting_machines machine
      on machine.id = refund_case.reporting_machine_id
    where upper(btrim(machine.nayax_account_key)) = upper(btrim(coalesce(p_nayax_account_key, '')))
      and attempt.execution_mode = 'request_and_approve'
      and (
        attempt.status in ('in_progress', 'requested', 'approved', 'ambiguous', 'manual_review')
        or attempt.reconciliation_required is true
        or attempt.provider_outcome in ('timeout', 'unknown')
      )
  )
  select jsonb_build_object(
    'blocked', count(*) > 0,
    'unresolvedCount', count(*),
    'oldestUnresolvedAt', min(created_at),
    'ownerLabel', 'Refund Operations',
    'escalationSlaMinutes', 60,
    'payloadRedacted', true
  )
  from held;
$$;

revoke execute on function public.refund_nayax_account_execution_hold(text)
  from public, anon, authenticated, service_role;

create or replace function public.guard_refund_nayax_account_circuit_breaker()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  account_key text;
begin
  if coalesce(current_setting('bloomjoy.nayax_journal_contract_version', true), '')
      <> 'nayax-provider-journal-v2' then
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

drop trigger if exists refund_nayax_account_circuit_breaker
  on public.refund_case_nayax_refund_attempts;
create trigger refund_nayax_account_circuit_breaker
before insert on public.refund_case_nayax_refund_attempts
for each row execute function public.guard_refund_nayax_account_circuit_breaker();

create or replace function public.service_reserve_nayax_refund_manager_action_v2(
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
  if btrim(coalesce(p_journal_contract_version, '')) <> 'nayax-provider-journal-v2'
    or btrim(coalesce(p_provider_contract_version, ''))
      <> 'nayax-production-observed-2026-08-22' then
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

create or replace function public.refund_case_nayax_manager_readiness(
  p_user_id uuid,
  p_refund_case_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  refund_case public.refund_cases%rowtype;
  machine public.reporting_machines%rowtype;
  account_hold jsonb := '{}'::jsonb;
  transaction_confirmed boolean := false;
  can_issue_card_refund boolean := false;
  block_reason text := null;
begin
  select case_row.* into refund_case
  from public.refund_cases case_row
  where case_row.id = p_refund_case_id;

  if not found then
    return jsonb_build_object(
      'transactionConfirmed', false,
      'canIssueCardRefund', false,
      'blockReason', 'case_not_found',
      'refundAmountCents', null,
      'machineLimitCents', null,
      'caseVersion', null
    );
  end if;

  if refund_case.reporting_machine_id is not null then
    select machine_row.* into machine
    from public.reporting_machines machine_row
    where machine_row.id = refund_case.reporting_machine_id;
  end if;
  if machine.nayax_account_key is not null then
    account_hold := public.refund_nayax_account_execution_hold(machine.nayax_account_key);
  end if;

  transaction_confirmed :=
    refund_case.correlation_status = 'matched'
    and refund_case.correlation_source = 'nayax'
    and refund_case.nayax_recommendation_policy_version is not null
    and public.is_review_safe_nayax_transaction_reference(
      refund_case.matched_nayax_transaction_id
    )
    and (
      refund_case.matched_nayax_site_id is not null
      or exists (
        select 1
        from public.refund_case_events manual_selection_event
        where manual_selection_event.refund_case_id = refund_case.id
          and manual_selection_event.event_type = 'nayax_match_selected'
          and manual_selection_event.metadata ->> 'manual_portal_candidate' = 'true'
      )
    )
    and refund_case.matched_nayax_machine_auth_time is not null
    and refund_case.matched_nayax_amount_cents is not null
    and refund_case.matched_nayax_currency_code = 'USD'
    and refund_case.refund_amount_cents is not null
    and refund_case.refund_amount_cents > 0
    and refund_case.matched_nayax_amount_cents = refund_case.refund_amount_cents
    and exists (
      select 1
      from public.refund_case_events selection_event
      where selection_event.refund_case_id = refund_case.id
        and selection_event.event_type = 'nayax_match_selected'
        and selection_event.actor_user_id is not null
    );

  block_reason := case
    when p_user_id is null
      or not public.can_perform_refund_official_action(p_user_id, refund_case.id)
      then 'unauthorized'
    when not transaction_confirmed then 'transaction_not_confirmed'
    when refund_case.reporting_adjustment_id is not null
      or refund_case.refund_completed_at is not null
      or refund_case.nayax_refund_execution_status = 'succeeded'
      then 'already_refunded'
    when public.refund_case_has_unresolved_reconciliation(refund_case.id)
      or refund_case.nayax_refund_execution_status in ('requested', 'ambiguous', 'manual_review')
      then 'reconciliation_hold'
    when exists (
      select 1
      from public.refund_cases duplicate_case
      where duplicate_case.id <> refund_case.id
        and duplicate_case.matched_nayax_transaction_id = refund_case.matched_nayax_transaction_id
    ) then 'duplicate_transaction'
    when refund_case.payment_method <> 'card'
      or refund_case.status not in ('needs_review', 'correlated', 'approved', 'card_refund_pending')
      or (refund_case.decision is not null and refund_case.decision <> 'approved')
      or refund_case.nayax_refund_execution_status <> 'not_requested'
      then 'case_not_refundable'
    when machine.id is null
      or machine.status <> 'active'
      or machine.nayax_machine_id is null
      or btrim(machine.nayax_machine_id) = ''
      or machine.nayax_account_key is null
      or btrim(machine.nayax_account_key) = ''
      then 'provider_unavailable'
    when coalesce((account_hold ->> 'blocked')::boolean, false)
      then 'account_reconciliation_hold'
    when machine.nayax_refunds_enabled is not true then 'machine_not_enabled'
    when machine.nayax_refund_max_amount_cents is not null
      and refund_case.refund_amount_cents > machine.nayax_refund_max_amount_cents
      then 'cap_exceeded'
    else null
  end;

  can_issue_card_refund := block_reason is null;
  return jsonb_build_object(
    'transactionConfirmed', transaction_confirmed,
    'canIssueCardRefund', can_issue_card_refund,
    'blockReason', block_reason,
    'refundAmountCents', refund_case.refund_amount_cents,
    'machineLimitCents', machine.nayax_refund_max_amount_cents,
    'caseVersion', refund_case.official_action_version,
    'accountCircuitBreakerActive',
      coalesce((account_hold ->> 'blocked')::boolean, false)
  );
end;
$$;

create or replace function public.refund_nayax_attempt_snapshot(
  p_attempt_id uuid,
  p_should_execute boolean default false
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'attemptId', attempt.id,
    'status', case
      when not p_should_execute and attempt.status = 'in_progress'
        and attempt.provider_outcome is null then 'ambiguous'
      else attempt.status
    end,
    'providerOutcome', case
      when not p_should_execute and attempt.status = 'in_progress'
        and attempt.provider_outcome is null then 'unknown'
      else attempt.provider_outcome
    end,
    'providerStatus', attempt.provider_status,
    'errorCode', attempt.error_code,
    'shouldExecute', p_should_execute,
    'reconciliationRequired',
      attempt.reconciliation_required
      or (not p_should_execute and attempt.status = 'in_progress' and attempt.provider_outcome is null),
    'reportingAdjustmentPresent',
      attempt.reporting_adjustment_id is not null
      and refund_case.reporting_adjustment_id = attempt.reporting_adjustment_id,
    'caseFinalizationCommitted',
      attempt.case_finalization_committed_at is not null
      and refund_case.status = 'completed'
      and refund_case.refund_completed_at is not null
      and refund_case.reporting_adjustment_id = attempt.reporting_adjustment_id
  )
  from public.refund_case_nayax_refund_attempts attempt
  join public.refund_cases refund_case on refund_case.id = attempt.refund_case_id
  where attempt.id = p_attempt_id;
$$;

create or replace function public.refund_nayax_reliability_health_snapshot(
  p_actor_user_id uuid default null
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with visible_attempts as (
    select attempt.*
    from public.refund_case_nayax_refund_attempts attempt
    join public.refund_cases refund_case on refund_case.id = attempt.refund_case_id
    join public.reporting_machines machine on machine.id = refund_case.reporting_machine_id
    where p_actor_user_id is null
      or public.is_super_admin(p_actor_user_id)
      or public.can_manage_refund_machine(p_actor_user_id, machine.id)
  ),
  metrics as (
    select
      count(*) filter (
        where provider_outcome = 'success' and support_resolution_id is null
      ) as direct_success_count,
      count(*) filter (
        where provider_outcome = 'success' and support_resolution_id is not null
      ) as support_resolved_success_count,
      count(*) filter (
        where execution_mode = 'request_and_approve' and (
          status in ('in_progress', 'requested', 'approved', 'ambiguous', 'manual_review')
          or reconciliation_required is true
          or provider_outcome in ('timeout', 'unknown')
        )
      ) as unresolved_count,
      min(created_at) filter (
        where execution_mode = 'request_and_approve' and (
          status in ('in_progress', 'requested', 'approved', 'ambiguous', 'manual_review')
          or reconciliation_required is true
          or provider_outcome in ('timeout', 'unknown')
        )
      ) as oldest_unresolved_at,
      count(*) filter (
        where error_code like 'stage_journal_%'
          or error_code like 'provider_journal_%'
          or error_code like 'settlement_failure_%'
      ) as journal_or_settlement_failure_count,
      count(*) filter (
        where provider_outcome = 'success' and (
          reporting_adjustment_id is null
          or case_finalization_committed_at is null
          or completion_message_id is null
        )
      ) as completion_mismatch_count
    from visible_attempts
  ),
  approval_latency as (
    select avg(extract(epoch from (approve_start.created_at - request_result.created_at)) * 1000.0)
      as average_ms
    from public.refund_nayax_provider_stage_journal request_result
    join public.refund_nayax_provider_stage_journal approve_start
      on approve_start.nayax_refund_attempt_id = request_result.nayax_refund_attempt_id
      and approve_start.pending_approval_recovery_id is null
      and approve_start.stage = 'approve'
      and approve_start.event = 'started'
    join visible_attempts attempt
      on attempt.id = request_result.nayax_refund_attempt_id
    where request_result.pending_approval_recovery_id is null
      and request_result.stage = 'request'
      and request_result.event = 'result'
  )
  select jsonb_build_object(
    'status', case when metrics.unresolved_count > 0
      or metrics.journal_or_settlement_failure_count > 0
      or metrics.completion_mismatch_count > 0 then 'attention' else 'healthy' end,
    'directSuccessCount', metrics.direct_success_count,
    'supportResolvedSuccessCount', metrics.support_resolved_success_count,
    'unresolvedCount', metrics.unresolved_count,
    'oldestUnresolvedAt', metrics.oldest_unresolved_at,
    'journalOrSettlementFailureCount', metrics.journal_or_settlement_failure_count,
    'completionMismatchCount', metrics.completion_mismatch_count,
    'averageApprovalStartLatencyMs', round(approval_latency.average_ms),
    'ownerLabel', 'Refund Operations',
    'escalationSlaMinutes', 60,
    'escalationDueAt', metrics.oldest_unresolved_at + interval '60 minutes',
    'payloadRedacted', true
  )
  from metrics cross join approval_latency;
$$;

revoke execute on function public.refund_nayax_reliability_health_snapshot(uuid)
  from public, anon, authenticated, service_role;

create or replace function public.service_get_refund_nayax_reliability_health(
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
  return public.refund_nayax_reliability_health_snapshot(null);
end;
$$;

create or replace function public.get_refund_nayax_reliability_health()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_user_id uuid := auth.uid();
begin
  if actor_user_id is null
    or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)
    or (
      not public.is_super_admin(actor_user_id)
      and not exists (
        select 1
        from public.reporting_machine_refund_managers manager
        where manager.manager_user_id = actor_user_id
          and manager.status = 'active'
          and manager.revoked_at is null
      )
    ) then
    raise exception 'Active Refund Operations access required' using errcode = '42501';
  end if;
  return public.refund_nayax_reliability_health_snapshot(actor_user_id);
end;
$$;

revoke execute on function public.service_get_nayax_refund_provider_journal_capability(text)
  from public, anon, authenticated;
grant execute on function public.service_get_nayax_refund_provider_journal_capability(text)
  to service_role;

revoke execute on function public.service_record_nayax_refund_provider_stage_v2(
  text, uuid, text, text, text, integer, text, boolean, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.service_record_nayax_refund_provider_stage_v2(
  text, uuid, text, text, text, integer, text, boolean, text, text, text, text
) to service_role;

revoke execute on function public.service_reserve_nayax_refund_manager_action_v2(
  text, uuid, uuid, bigint, text, integer, integer, integer, text, text, text
) from public, anon, authenticated;
grant execute on function public.service_reserve_nayax_refund_manager_action_v2(
  text, uuid, uuid, bigint, text, integer, integer, integer, text, text, text
) to service_role;

revoke execute on function public.service_get_refund_nayax_reliability_health(text)
  from public, anon, authenticated;
grant execute on function public.service_get_refund_nayax_reliability_health(text)
  to service_role;

revoke execute on function public.get_refund_nayax_reliability_health()
  from public, anon, service_role;
grant execute on function public.get_refund_nayax_reliability_health()
  to authenticated;

revoke execute on function public.guard_refund_nayax_account_circuit_breaker()
  from public, anon, authenticated, service_role;

comment on function public.service_record_nayax_refund_provider_stage_v2(
  text, uuid, text, text, text, integer, text, boolean, text, text, text, text
) is 'Database-owned Nayax stage state machine. Only its approvalAuthorized result may permit the Edge function to call refund-approve.';
comment on function public.service_reserve_nayax_refund_manager_action_v2(
  text, uuid, uuid, bigint, text, integer, integer, integer, text, text, text
) is 'Version-negotiated manager reservation that activates the authoritative journal v2 account circuit breaker.';
comment on function public.get_refund_nayax_reliability_health() is
  'Privacy-safe reliability alert and aggregate metrics for active refund operators.';

select pg_notify('pgrst', 'reload schema');
