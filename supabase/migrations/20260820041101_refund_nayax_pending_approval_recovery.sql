-- Repair the Nayax request/approve handoff without weakening the provider
-- contract. Normal attempts gain a redacted, immutable stage journal. A
-- separate recovery reservation may call only refund-approve, at most once,
-- after a request-stage contract mismatch has been reconciled in Nayax DTM.

create table public.refund_nayax_pending_approval_recoveries (
  id uuid primary key default extensions.gen_random_uuid(),
  nayax_refund_attempt_id uuid not null unique
    references public.refund_case_nayax_refund_attempts (id) on delete restrict,
  refund_case_id uuid not null
    references public.refund_cases (id) on delete restrict,
  actor_user_id uuid not null references auth.users (id) on delete restrict,
  status text not null default 'in_progress'
    check (status in ('in_progress', 'succeeded', 'rejected', 'ambiguous')),
  evidence_type text not null
    check (evidence_type = 'nayax_dtm_refund_requested'),
  evidence_reference_digest text not null
    check (evidence_reference_digest ~ '^[a-f0-9]{64}$'),
  provider_claim_digest text not null
    check (provider_claim_digest ~ '^[a-f0-9]{64}$'),
  provider_claim_expires_at timestamptz not null,
  provider_claim_consumed_at timestamptz,
  provider_outcome text
    check (provider_outcome is null or provider_outcome in ('success', 'rejected', 'timeout', 'unknown')),
  provider_reference text,
  provider_status text,
  error_code text,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  completed_at timestamptz,
  constraint refund_nayax_pending_approval_recovery_state_check check (
    (
      status = 'in_progress'
      and provider_outcome is null
      and provider_claim_consumed_at is null
      and completed_at is null
    )
    or (
      status <> 'in_progress'
      and provider_outcome is not null
      and provider_claim_consumed_at is not null
      and completed_at is not null
    )
  ),
  constraint refund_nayax_pending_approval_recovery_safe_text_check check (
    (provider_reference is null or provider_reference ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{5,119}$')
    and (provider_status is null or provider_status ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$')
    and (error_code is null or error_code ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$')
  )
);

create index refund_nayax_pending_approval_recovery_case_idx
  on public.refund_nayax_pending_approval_recoveries (refund_case_id, created_at desc);

create table public.refund_nayax_provider_stage_journal (
  id uuid primary key default extensions.gen_random_uuid(),
  nayax_refund_attempt_id uuid not null
    references public.refund_case_nayax_refund_attempts (id) on delete restrict,
  pending_approval_recovery_id uuid
    references public.refund_nayax_pending_approval_recoveries (id) on delete restrict,
  stage text not null check (stage in ('request', 'approve')),
  event text not null check (event in ('started', 'result')),
  http_status integer check (http_status is null or http_status between 100 and 599),
  outcome text check (
    outcome is null or outcome in (
      'accepted', 'succeeded', 'rejected', 'duplicate',
      'already_refunded', 'pending', 'unknown'
    )
  ),
  contract_matched boolean,
  failure_type text check (failure_type is null or failure_type in ('timeout', 'network')),
  classification_digest text not null
    check (classification_digest ~ '^[a-f0-9]{64}$'),
  payload_redacted boolean not null default true check (payload_redacted),
  created_at timestamptz not null default statement_timestamp(),
  constraint refund_nayax_provider_stage_event_shape_check check (
    (
      event = 'started'
      and http_status is null
      and outcome is null
      and contract_matched is null
      and failure_type is null
    )
    or (
      event = 'result'
      and outcome is not null
      and contract_matched is not null
    )
  ),
  constraint refund_nayax_provider_stage_recovery_shape_check check (
    pending_approval_recovery_id is null or stage = 'approve'
  )
);

create unique index refund_nayax_provider_stage_once_idx
  on public.refund_nayax_provider_stage_journal (
    nayax_refund_attempt_id,
    coalesce(
      pending_approval_recovery_id,
      '00000000-0000-0000-0000-000000000000'::uuid
    ),
    stage,
    event
  );

revoke all on table public.refund_nayax_pending_approval_recoveries
  from public, anon, authenticated, service_role;
revoke all on table public.refund_nayax_provider_stage_journal
  from public, anon, authenticated, service_role;

create or replace function public.guard_refund_nayax_provider_stage_immutable()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'Nayax provider stage evidence is immutable';
end;
$$;

create trigger refund_nayax_provider_stage_immutable
before update or delete on public.refund_nayax_provider_stage_journal
for each row execute function public.guard_refund_nayax_provider_stage_immutable();

create or replace function public.refund_nayax_pending_approval_recovery_snapshot(
  p_recovery_id uuid,
  p_should_execute boolean default false
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'recoveryId', recovery.id,
    'attemptId', recovery.nayax_refund_attempt_id,
    'refundCaseId', recovery.refund_case_id,
    'status', recovery.status,
    'providerOutcome', recovery.provider_outcome,
    'providerStatus', recovery.provider_status,
    'errorCode', recovery.error_code,
    'shouldExecute', p_should_execute,
    'payloadRedacted', true
  )
  from public.refund_nayax_pending_approval_recoveries recovery
  where recovery.id = p_recovery_id;
$$;

revoke execute on function public.refund_nayax_pending_approval_recovery_snapshot(uuid, boolean)
  from public, anon, authenticated, service_role;

create or replace function public.service_record_nayax_refund_provider_stage(
  p_executor_assertion text,
  p_attempt_id uuid,
  p_pending_approval_recovery_id uuid,
  p_provider_claim_token text,
  p_stage text,
  p_event text,
  p_http_status integer,
  p_outcome text,
  p_contract_matched boolean,
  p_failure_type text,
  p_classification_digest text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  normalized_stage text := lower(btrim(coalesce(p_stage, '')));
  normalized_event text := lower(btrim(coalesce(p_event, '')));
  normalized_outcome text := nullif(lower(btrim(coalesce(p_outcome, ''))), '');
  normalized_failure text := nullif(lower(btrim(coalesce(p_failure_type, ''))), '');
  attempt_row public.refund_case_nayax_refund_attempts%rowtype;
  recovery_row public.refund_nayax_pending_approval_recoveries%rowtype;
  claim_digest text;
begin
  perform public.assert_nayax_provider_executor(p_executor_assertion);
  if p_attempt_id is null
    or normalized_stage not in ('request', 'approve')
    or normalized_event not in ('started', 'result')
    or p_classification_digest !~ '^[a-f0-9]{64}$'
    or nullif(p_provider_claim_token, '') is null then
    raise exception 'Exact redacted Nayax stage evidence is required';
  end if;
  if normalized_event = 'started' and (
    p_http_status is not null or normalized_outcome is not null
    or p_contract_matched is not null or normalized_failure is not null
  ) then
    raise exception 'A started stage cannot claim a provider result';
  end if;
  if normalized_event = 'result' and (
    normalized_outcome not in (
      'accepted', 'succeeded', 'rejected', 'duplicate',
      'already_refunded', 'pending', 'unknown'
    ) or p_contract_matched is null
    or (p_http_status is not null and (p_http_status < 100 or p_http_status > 599))
    or (normalized_failure is not null and normalized_failure not in ('timeout', 'network'))
  ) then
    raise exception 'Invalid sanitized Nayax stage result';
  end if;

  claim_digest := encode(
    extensions.digest(convert_to(p_provider_claim_token, 'UTF8'), 'sha256'),
    'hex'
  );
  select attempt.* into attempt_row
  from public.refund_case_nayax_refund_attempts attempt
  where attempt.id = p_attempt_id
  for share;
  if not found then raise exception 'Nayax provider attempt not found'; end if;

  if p_pending_approval_recovery_id is null then
    if attempt_row.status is distinct from 'in_progress'
      or attempt_row.provider_outcome is not null
      or attempt_row.provider_claim_consumed_at is not null
      or attempt_row.provider_claim_expires_at <= statement_timestamp()
      or attempt_row.provider_claim_digest is distinct from claim_digest then
      raise exception 'Valid active attempt-scoped provider claim required';
    end if;
  else
    select recovery.* into recovery_row
    from public.refund_nayax_pending_approval_recoveries recovery
    where recovery.id = p_pending_approval_recovery_id
    for share;
    if not found
      or normalized_stage <> 'approve'
      or recovery_row.nayax_refund_attempt_id is distinct from p_attempt_id
      or recovery_row.status is distinct from 'in_progress'
      or recovery_row.provider_claim_consumed_at is not null
      or recovery_row.provider_claim_expires_at <= statement_timestamp()
      or recovery_row.provider_claim_digest is distinct from claim_digest then
      raise exception 'Valid active recovery-scoped provider claim required';
    end if;
  end if;

  if normalized_event = 'result' and not exists (
    select 1 from public.refund_nayax_provider_stage_journal journal
    where journal.nayax_refund_attempt_id = p_attempt_id
      and journal.pending_approval_recovery_id is not distinct from p_pending_approval_recovery_id
      and journal.stage = normalized_stage
      and journal.event = 'started'
  ) then
    raise exception 'Nayax stage result requires its started marker';
  end if;
  if p_pending_approval_recovery_id is null
    and normalized_stage = 'approve'
    and normalized_event = 'started'
    and not exists (
      select 1 from public.refund_nayax_provider_stage_journal journal
      where journal.nayax_refund_attempt_id = p_attempt_id
        and journal.pending_approval_recovery_id is null
        and journal.stage = 'request'
        and journal.event = 'result'
        and journal.outcome = 'accepted'
        and journal.contract_matched = true
    ) then
    raise exception 'Approval requires an exact journaled request acceptance';
  end if;

  insert into public.refund_nayax_provider_stage_journal (
    nayax_refund_attempt_id, pending_approval_recovery_id, stage, event,
    http_status, outcome, contract_matched, failure_type,
    classification_digest
  ) values (
    p_attempt_id, p_pending_approval_recovery_id, normalized_stage,
    normalized_event, p_http_status, normalized_outcome,
    p_contract_matched, normalized_failure, p_classification_digest
  );
  return jsonb_build_object('recorded', true, 'payloadRedacted', true);
end;
$$;

create or replace function public.service_reserve_nayax_pending_approval_recovery(
  p_executor_assertion text,
  p_actor_user_id uuid,
  p_case_id uuid,
  p_attempt_id uuid,
  p_expected_case_version bigint,
  p_evidence_reference text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  case_row public.refund_cases%rowtype;
  attempt_row public.refund_case_nayax_refund_attempts%rowtype;
  recovery_row public.refund_nayax_pending_approval_recoveries%rowtype;
  provider_claim_token text;
  evidence_reference text := btrim(coalesce(p_evidence_reference, ''));
begin
  perform public.assert_nayax_provider_executor(p_executor_assertion);
  if p_actor_user_id is null or p_case_id is null or p_attempt_id is null
    or p_expected_case_version is null
    or evidence_reference !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{5,199}$' then
    raise exception 'Exact DTM pending-request recovery evidence is required';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'refund-nayax-pending-approval-v1|' || p_attempt_id::text,
      0
    )
  );
  select refund_case.* into case_row
  from public.refund_cases refund_case
  where refund_case.id = p_case_id
  for update;
  select attempt.* into attempt_row
  from public.refund_case_nayax_refund_attempts attempt
  where attempt.id = p_attempt_id
  for update;

  if case_row.id is null or attempt_row.id is null
    or case_row.official_action_version is distinct from p_expected_case_version
    or not public.can_perform_refund_official_action(p_actor_user_id, case_row.id)
    or case_row.payment_method is distinct from 'card'
    or case_row.status is distinct from 'card_refund_pending'
    or case_row.decision is distinct from 'approved'
    or case_row.nayax_refund_execution_status is distinct from 'ambiguous'
    or case_row.reporting_adjustment_id is not null
    or case_row.refund_completed_at is not null
    or case_row.matched_nayax_transaction_id !~ '^[1-9][0-9]{0,18}$'
    or case_row.matched_nayax_site_id is null
    or case_row.matched_nayax_site_id <= 0
    or case_row.matched_nayax_machine_auth_time is null
    or case_row.matched_nayax_currency_code is distinct from 'USD'
    or case_row.refund_amount_cents is null
    or case_row.refund_amount_cents <= 0
    or case_row.matched_nayax_amount_cents is distinct from case_row.refund_amount_cents
    or attempt_row.refund_case_id is distinct from case_row.id
    or attempt_row.status is distinct from 'ambiguous'
    or attempt_row.provider_outcome is distinct from 'unknown'
    or attempt_row.provider_status is distinct from 'request_unknown_contract_mismatch'
    or attempt_row.error_code is distinct from 'provider_request_outcome_unknown'
    or attempt_row.reconciliation_required is distinct from true
    or attempt_row.support_resolution_id is not null
    or exists (
      select 1 from public.refund_case_nayax_refund_attempts later_attempt
      where later_attempt.refund_case_id = case_row.id
        and row(later_attempt.created_at, later_attempt.id) >
          row(attempt_row.created_at, attempt_row.id)
    )
    or exists (
      select 1 from public.refund_nayax_provider_stage_journal journal
      where journal.nayax_refund_attempt_id = attempt_row.id
        and journal.stage = 'approve'
        and journal.event = 'started'
    ) then
    raise exception 'Only the exact latest DTM-confirmed request-only hold is recoverable';
  end if;

  select recovery.* into recovery_row
  from public.refund_nayax_pending_approval_recoveries recovery
  where recovery.nayax_refund_attempt_id = attempt_row.id
  for update;
  if found then
    return jsonb_build_object(
      'recovery', public.refund_nayax_pending_approval_recovery_snapshot(recovery_row.id, false),
      'providerClaimToken', null,
      'evidence', null
    );
  end if;

  provider_claim_token := 'nayax-recovery-' || encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.refund_nayax_pending_approval_recoveries (
    nayax_refund_attempt_id, refund_case_id, actor_user_id,
    evidence_type, evidence_reference_digest, provider_claim_digest,
    provider_claim_expires_at
  ) values (
    attempt_row.id, case_row.id, p_actor_user_id,
    'nayax_dtm_refund_requested',
    encode(extensions.digest(convert_to(evidence_reference, 'UTF8'), 'sha256'), 'hex'),
    encode(extensions.digest(convert_to(provider_claim_token, 'UTF8'), 'sha256'), 'hex'),
    statement_timestamp() + interval '30 seconds'
  ) returning * into recovery_row;

  insert into public.refund_case_events (
    refund_case_id, actor_user_id, event_type, message, metadata
  ) values (
    case_row.id, p_actor_user_id,
    'nayax_pending_approval_recovery_reserved',
    'A DTM-confirmed pending Nayax request reserved one approval-only recovery; no request was created.',
    jsonb_build_object(
      'attempt_id', attempt_row.id,
      'recovery_id', recovery_row.id,
      'evidence_type', recovery_row.evidence_type,
      'payload_redacted', true
    )
  );

  return jsonb_build_object(
    'recovery', public.refund_nayax_pending_approval_recovery_snapshot(recovery_row.id, true),
    'providerClaimToken', provider_claim_token,
    'evidence', jsonb_build_object(
      'caseId', case_row.id,
      'transactionId', case_row.matched_nayax_transaction_id,
      'siteId', case_row.matched_nayax_site_id,
      'machineAuthorizationTime', case_row.matched_nayax_machine_auth_time,
      'amountCents', case_row.refund_amount_cents,
      'currencyCode', case_row.matched_nayax_currency_code
    )
  );
end;
$$;

create or replace function public.service_settle_nayax_pending_approval_recovery(
  p_executor_assertion text,
  p_recovery_id uuid,
  p_attempt_id uuid,
  p_case_id uuid,
  p_provider_claim_token text,
  p_provider_outcome text,
  p_provider_reference text default null,
  p_provider_status text default null,
  p_error_code text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  recovery_row public.refund_nayax_pending_approval_recoveries%rowtype;
  attempt_row public.refund_case_nayax_refund_attempts%rowtype;
  case_row public.refund_cases%rowtype;
  normalized_outcome text := lower(btrim(coalesce(p_provider_outcome, '')));
  normalized_reference text := nullif(btrim(coalesce(p_provider_reference, '')), '');
  normalized_status text := nullif(btrim(coalesce(p_provider_status, '')), '');
  normalized_error text := nullif(btrim(coalesce(p_error_code, '')), '');
  terminal_status text;
  settled_at timestamptz := statement_timestamp();
begin
  perform public.assert_nayax_provider_executor(p_executor_assertion);
  if p_recovery_id is null or p_attempt_id is null or p_case_id is null
    or normalized_outcome not in ('success', 'rejected', 'timeout', 'unknown')
    or (normalized_reference is not null and normalized_reference !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{5,119}$')
    or (normalized_status is not null and normalized_status !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$')
    or (normalized_error is not null and normalized_error !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$') then
    raise exception 'Exact sanitized recovery outcome is required';
  end if;
  if normalized_outcome = 'success' and normalized_reference is null then
    raise exception 'Confirmed approval recovery requires a redacted correlation reference';
  end if;

  select recovery.* into recovery_row
  from public.refund_nayax_pending_approval_recoveries recovery
  where recovery.id = p_recovery_id
  for update;
  select attempt.* into attempt_row
  from public.refund_case_nayax_refund_attempts attempt
  where attempt.id = p_attempt_id
  for share;
  select refund_case.* into case_row
  from public.refund_cases refund_case
  where refund_case.id = p_case_id
  for share;

  if recovery_row.id is null
    or recovery_row.nayax_refund_attempt_id is distinct from p_attempt_id
    or recovery_row.refund_case_id is distinct from p_case_id
    or recovery_row.status is distinct from 'in_progress'
    or recovery_row.provider_claim_consumed_at is not null
    or recovery_row.provider_claim_expires_at <= settled_at
    or nullif(p_provider_claim_token, '') is null
    or recovery_row.provider_claim_digest is distinct from encode(
      extensions.digest(convert_to(p_provider_claim_token, 'UTF8'), 'sha256'), 'hex'
    )
    or attempt_row.refund_case_id is distinct from p_case_id
    or attempt_row.status is distinct from 'ambiguous'
    or attempt_row.provider_outcome is distinct from 'unknown'
    or attempt_row.reconciliation_required is distinct from true
    or case_row.status is distinct from 'card_refund_pending'
    or case_row.decision is distinct from 'approved'
    or case_row.reporting_adjustment_id is not null
    or case_row.refund_completed_at is not null then
    raise exception 'Recovery claim is invalid, expired, changed, or already used';
  end if;

  terminal_status := case normalized_outcome
    when 'success' then 'succeeded'
    when 'rejected' then 'rejected'
    else 'ambiguous'
  end;
  update public.refund_nayax_pending_approval_recoveries
  set
    status = terminal_status,
    provider_outcome = normalized_outcome,
    provider_reference = normalized_reference,
    provider_status = normalized_status,
    error_code = normalized_error,
    provider_claim_consumed_at = settled_at,
    updated_at = settled_at,
    completed_at = settled_at
  where id = recovery_row.id
  returning * into recovery_row;

  insert into public.refund_case_events (
    refund_case_id, actor_user_id, event_type, message, metadata
  ) values (
    case_row.id, recovery_row.actor_user_id,
    'nayax_pending_approval_recovery_recorded',
    case
      when normalized_outcome = 'success'
        then 'Nayax accepted the one approval-only recovery; DTM confirmation is still required before finalization.'
      when normalized_outcome = 'rejected'
        then 'Nayax rejected the one approval-only recovery; the original case remains held.'
      else 'The one approval-only recovery is ambiguous; no retry, finalization, or customer message was issued.'
    end,
    jsonb_build_object(
      'attempt_id', attempt_row.id,
      'recovery_id', recovery_row.id,
      'provider_outcome', normalized_outcome,
      'provider_reference_present', normalized_reference is not null,
      'requires_dtm_reconciliation', true,
      'payload_redacted', true
    )
  );

  return public.refund_nayax_pending_approval_recovery_snapshot(recovery_row.id, false);
end;
$$;

revoke execute on function public.service_record_nayax_refund_provider_stage(
  text, uuid, uuid, text, text, text, integer, text, boolean, text, text
) from public, anon, authenticated;
grant execute on function public.service_record_nayax_refund_provider_stage(
  text, uuid, uuid, text, text, text, integer, text, boolean, text, text
) to service_role;

revoke execute on function public.service_reserve_nayax_pending_approval_recovery(
  text, uuid, uuid, uuid, bigint, text
) from public, anon, authenticated;
grant execute on function public.service_reserve_nayax_pending_approval_recovery(
  text, uuid, uuid, uuid, bigint, text
) to service_role;

revoke execute on function public.service_settle_nayax_pending_approval_recovery(
  text, uuid, uuid, uuid, text, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.service_settle_nayax_pending_approval_recovery(
  text, uuid, uuid, uuid, text, text, text, text, text
) to service_role;

comment on table public.refund_nayax_pending_approval_recoveries is
  'One immutable-attempt approval-only recovery reservation. It can never create or retry a refund request.';
comment on table public.refund_nayax_provider_stage_journal is
  'Append-only redacted provider stage evidence. Unmatched response values are represented only by a keyed digest.';
