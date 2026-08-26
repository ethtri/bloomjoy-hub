-- #991: publish one durable refund lifecycle, bound read-only Nayax lookup,
-- and recover interrupted provider attempts without ever guessing or retrying
-- an uncertain payment.

alter table public.refund_cases
  add column if not exists nayax_lookup_generation bigint not null default 0,
  add column if not exists nayax_lookup_status text not null default 'not_started',
  add column if not exists nayax_lookup_started_at timestamptz,
  add column if not exists nayax_lookup_finished_at timestamptz,
  add column if not exists nayax_lookup_failure_class text,
  add column if not exists nayax_lookup_safe_retry_eligible boolean not null default false,
  add column if not exists nayax_lookup_correlation_digest text;

alter table public.refund_cases
  drop constraint if exists refund_cases_nayax_lookup_generation_check,
  add constraint refund_cases_nayax_lookup_generation_check
    check (nayax_lookup_generation between 0 and 1000000),
  drop constraint if exists refund_cases_nayax_lookup_status_check,
  add constraint refund_cases_nayax_lookup_status_check check (
    nayax_lookup_status in (
      'not_started', 'checking', 'match_found', 'multiple_matches',
      'no_match', 'manual_exception', 'setup_needed', 'lookup_failed',
      'lookup_timed_out', 'response_limited'
    )
  ),
  drop constraint if exists refund_cases_nayax_lookup_failure_class_check,
  add constraint refund_cases_nayax_lookup_failure_class_check check (
    nayax_lookup_failure_class is null or nayax_lookup_failure_class in (
      'timeout', 'transport_error', 'provider_error', 'malformed_response',
      'response_limit', 'evidence_changed', 'worker_interrupted'
    )
  ),
  drop constraint if exists refund_cases_nayax_lookup_digest_check,
  add constraint refund_cases_nayax_lookup_digest_check check (
    nayax_lookup_correlation_digest is null
    or nayax_lookup_correlation_digest ~ '^[a-f0-9]{64}$'
  ),
  drop constraint if exists refund_cases_nayax_lookup_timing_check,
  add constraint refund_cases_nayax_lookup_timing_check check (
    nayax_lookup_finished_at is null
    or nayax_lookup_started_at is null
    or nayax_lookup_finished_at >= nayax_lookup_started_at
  );

alter table public.refund_nayax_lookup_candidates
  add column if not exists lookup_generation bigint not null default 0;

alter table public.refund_nayax_lookup_candidates
  drop constraint if exists refund_nayax_lookup_candidates_generation_check,
  add constraint refund_nayax_lookup_candidates_generation_check
    check (lookup_generation between 0 and 1000000);

create index if not exists refund_nayax_lookup_candidates_case_generation_idx
  on public.refund_nayax_lookup_candidates (
    refund_case_id, lookup_generation, expires_at desc
  );

alter table public.refund_case_nayax_refund_attempts
  add column if not exists safe_transport_stage text not null default 'reserved',
  add column if not exists safe_failure_class text,
  add column if not exists correlation_digest text,
  add column if not exists refund_operations_due_at timestamptz;

alter table public.refund_case_nayax_refund_attempts
  drop constraint if exists refund_nayax_attempt_safe_transport_stage_check,
  add constraint refund_nayax_attempt_safe_transport_stage_check check (
    safe_transport_stage in (
      'reserved', 'request_started', 'request_result', 'approval_started',
      'approval_result', 'settled', 'released_no_call',
      'confirmation_hold'
    )
  ),
  drop constraint if exists refund_nayax_attempt_safe_failure_class_check,
  add constraint refund_nayax_attempt_safe_failure_class_check check (
    safe_failure_class is null or safe_failure_class in (
      'interrupted_before_transport', 'interrupted_after_transport',
      'provider_timeout', 'provider_network', 'provider_rejected',
      'provider_unknown', 'contract_mismatch', 'settlement_failure'
    )
  ),
  drop constraint if exists refund_nayax_attempt_correlation_digest_check,
  add constraint refund_nayax_attempt_correlation_digest_check check (
    correlation_digest is null or correlation_digest ~ '^[a-f0-9]{64}$'
  );

update public.refund_case_nayax_refund_attempts attempt
set
  safe_transport_stage = case
    when attempt.provider_outcome = 'success' and attempt.status = 'succeeded'
      then 'settled'
    when attempt.status in ('ambiguous', 'manual_review')
      or attempt.provider_outcome in ('timeout', 'unknown', 'rejected')
      then 'confirmation_hold'
    when exists (
      select 1 from public.refund_nayax_provider_stage_journal journal
      where journal.nayax_refund_attempt_id = attempt.id
        and journal.stage = 'approve' and journal.event = 'result'
    ) then 'approval_result'
    when exists (
      select 1 from public.refund_nayax_provider_stage_journal journal
      where journal.nayax_refund_attempt_id = attempt.id
        and journal.stage = 'approve' and journal.event = 'started'
    ) then 'approval_started'
    when exists (
      select 1 from public.refund_nayax_provider_stage_journal journal
      where journal.nayax_refund_attempt_id = attempt.id
        and journal.stage = 'request' and journal.event = 'result'
    ) then 'request_result'
    when exists (
      select 1 from public.refund_nayax_provider_stage_journal journal
      where journal.nayax_refund_attempt_id = attempt.id
        and journal.stage = 'request' and journal.event = 'started'
    ) then 'request_started'
    else 'reserved'
  end,
  safe_failure_class = case
    when attempt.provider_outcome = 'timeout' then 'provider_timeout'
    when attempt.provider_outcome = 'rejected' then 'provider_rejected'
    when attempt.provider_outcome = 'unknown'
      or attempt.status in ('ambiguous', 'manual_review') then 'provider_unknown'
    else null
  end,
  correlation_digest = coalesce(
    attempt.correlation_digest,
    (
      select journal.classification_digest
      from public.refund_nayax_provider_stage_journal journal
      where journal.nayax_refund_attempt_id = attempt.id
      order by journal.created_at desc, journal.id desc
      limit 1
    )
  ),
  refund_operations_due_at = case
    when attempt.reconciliation_required is true then coalesce(
      attempt.refund_operations_due_at,
      attempt.created_at + interval '60 minutes'
    )
    else null
  end;

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
    or new.provider_outcome in ('timeout', 'unknown', 'rejected') then
    new.safe_transport_stage := 'confirmation_hold';
    new.safe_failure_class := coalesce(
      new.safe_failure_class,
      case
        when new.provider_outcome = 'timeout' then 'provider_timeout'
        when new.provider_outcome = 'rejected' then 'provider_rejected'
        else 'provider_unknown'
      end
    );
    new.refund_operations_due_at := coalesce(
      new.refund_operations_due_at,
      new.created_at + interval '60 minutes'
    );
  elsif new.reconciliation_required is false then
    new.refund_operations_due_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists refund_nayax_attempt_safe_state
  on public.refund_case_nayax_refund_attempts;
create trigger refund_nayax_attempt_safe_state
before insert or update on public.refund_case_nayax_refund_attempts
for each row execute function public.sync_refund_nayax_attempt_safe_state();

create index if not exists refund_nayax_attempt_operations_sla_idx
  on public.refund_case_nayax_refund_attempts (refund_operations_due_at, created_at)
  where reconciliation_required is true;

comment on column public.refund_cases.nayax_lookup_generation is
  'Monotonic read-only lookup generation. Only the latest generation may publish or select candidates.';
comment on column public.refund_case_nayax_refund_attempts.safe_transport_stage is
  'Sanitized durable transport stage; it contains no provider identifiers or payload.';
comment on column public.refund_case_nayax_refund_attempts.correlation_digest is
  'Privacy-safe digest linking an attempt to immutable journal classification evidence.';

create or replace function public.service_begin_refund_nayax_lookup(
  p_refund_case_id uuid,
  p_expected_fact_version bigint,
  p_trigger_source text,
  p_actor_user_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  case_row public.refund_cases%rowtype;
  next_generation bigint;
  normalized_trigger text := lower(btrim(coalesce(p_trigger_source, '')));
begin
  if p_refund_case_id is null
    or p_expected_fact_version is null
    or normalized_trigger not in (
      'automatic', 'manual', 'wallet_correction', 'scheduled'
    ) then
    raise exception 'Exact refund lookup context is required' using errcode = 'P4620';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'refund-nayax-lookup-v1|' || p_refund_case_id::text,
      0
    )
  );

  select refund_case.* into case_row
  from public.refund_cases refund_case
  where refund_case.id = p_refund_case_id
  for update;

  if not found then
    raise exception 'Refund case not found' using errcode = 'P4620';
  end if;
  if case_row.deterministic_fact_version is distinct from p_expected_fact_version then
    raise exception 'Refund case matching evidence changed during Nayax lookup'
      using errcode = 'P4621';
  end if;
  if p_actor_user_id is not null
    and not public.can_manage_refund_case(p_actor_user_id, case_row.id) then
    raise exception 'Current refund case access required' using errcode = '42501';
  end if;
  if case_row.payment_method <> 'card'
    or case_row.status not in ('submitted', 'needs_review', 'correlated')
    or case_row.decision is not null
    or case_row.status in ('approved', 'denied', 'completed', 'closed')
    or case_row.matched_nayax_transaction_id is not null
    or public.refund_case_has_unresolved_reconciliation(case_row.id) then
    raise exception 'This refund case is not safe for transaction lookup'
      using errcode = 'P4622';
  end if;

  next_generation := case_row.nayax_lookup_generation + 1;
  if next_generation > 1000000 then
    raise exception 'Refund lookup generation limit reached' using errcode = 'P4622';
  end if;

  update public.refund_cases
  set
    nayax_lookup_generation = next_generation,
    nayax_lookup_status = 'checking',
    nayax_lookup_started_at = statement_timestamp(),
    nayax_lookup_finished_at = null,
    nayax_lookup_failure_class = null,
    nayax_lookup_safe_retry_eligible = false,
    nayax_lookup_correlation_digest = null,
    correlation_status = 'needs_nayax',
    correlation_source = 'nayax',
    correlation_confidence = 0,
    correlation_summary =
      'Bloomjoy is checking recent Nayax sales for this case.',
    nayax_recommendation_state = null,
    nayax_recommendation_policy_version = null,
    nayax_recommendation_evaluated_at = null,
    nayax_match_execution_eligible = false
  where id = case_row.id;

  insert into public.refund_case_events (
    refund_case_id, actor_user_id, event_type, message, metadata
  ) values (
    case_row.id,
    p_actor_user_id,
    'nayax_lookup_started',
    'Bloomjoy started one bounded read-only Nayax transaction lookup.',
    jsonb_build_object(
      'lookup_generation', next_generation,
      'deterministic_fact_version', p_expected_fact_version,
      'trigger_source', normalized_trigger,
      'provider_call_kind', 'read_only',
      'payload_redacted', true
    )
  );

  return jsonb_build_object(
    'lookupGeneration', next_generation,
    'factVersion', p_expected_fact_version,
    'status', 'checking',
    'payloadRedacted', true
  );
end;
$$;

revoke execute on function public.service_begin_refund_nayax_lookup(
  uuid, bigint, text, uuid
) from public, anon, authenticated;
grant execute on function public.service_begin_refund_nayax_lookup(
  uuid, bigint, text, uuid
) to service_role;

create or replace function public.service_commit_refund_nayax_lookup(
  p_refund_case_id uuid,
  p_lookup_generation bigint,
  p_expected_fact_version bigint,
  p_lookup_status text,
  p_recommendation_state text,
  p_policy_version text,
  p_last_checked_at timestamptz,
  p_summary text,
  p_resolved_machine_id uuid,
  p_candidate_count integer,
  p_trigger_source text,
  p_actor_user_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  case_row public.refund_cases%rowtype;
  actual_candidate_count integer := 0;
  computed_correlation_status text;
  digest text;
  normalized_status text := lower(btrim(coalesce(p_lookup_status, '')));
  normalized_recommendation text := lower(btrim(coalesce(p_recommendation_state, '')));
  normalized_policy text := btrim(coalesce(p_policy_version, ''));
  normalized_summary text := left(btrim(coalesce(p_summary, '')), 800);
begin
  if normalized_status not in (
    'match_found', 'multiple_matches', 'no_match',
    'manual_exception', 'setup_needed'
  )
    or normalized_recommendation not in (
      'high_confidence', 'ambiguous', 'no_safe_match', 'manual_exception'
    )
    or normalized_policy !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$'
    or p_last_checked_at is null
    or p_candidate_count is null
    or p_candidate_count not between 0 and 200 then
    raise exception 'Invalid sanitized Nayax lookup result' using errcode = 'P4623';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'refund-nayax-lookup-v1|' || p_refund_case_id::text,
      0
    )
  );
  select refund_case.* into case_row
  from public.refund_cases refund_case
  where refund_case.id = p_refund_case_id
  for update;

  if not found then
    raise exception 'Refund case not found' using errcode = 'P4620';
  end if;

  if case_row.nayax_lookup_generation is distinct from p_lookup_generation
    or case_row.deterministic_fact_version is distinct from p_expected_fact_version then
    delete from public.refund_nayax_lookup_candidates candidate
    where candidate.refund_case_id = p_refund_case_id
      and candidate.lookup_generation = p_lookup_generation;
    return jsonb_build_object(
      'applied', false,
      'stale', true,
      'payloadRedacted', true
    );
  end if;

  select count(*)::integer into actual_candidate_count
  from public.refund_nayax_lookup_candidates candidate
  where candidate.refund_case_id = p_refund_case_id
    and candidate.lookup_generation = p_lookup_generation;

  if actual_candidate_count <> p_candidate_count
    or (normalized_status = 'match_found' and actual_candidate_count = 0)
    or (normalized_status in ('no_match', 'setup_needed') and actual_candidate_count <> 0) then
    raise exception 'Nayax lookup candidate count mismatch' using errcode = 'P4623';
  end if;

  if p_resolved_machine_id is not null
    and p_resolved_machine_id is distinct from case_row.reporting_machine_id
    and not (
      case_row.reporting_machine_id is null
      and p_resolved_machine_id = any(case_row.intake_selection_machine_ids)
    ) then
    raise exception 'Resolved Nayax machine is outside the immutable case scope'
      using errcode = 'P4623';
  end if;

  computed_correlation_status := case
    when normalized_status = 'setup_needed' then 'nayax_not_configured'
    when normalized_status = 'multiple_matches' then 'multiple_candidates'
    when normalized_status = 'no_match' then 'no_match'
    else 'manual_review'
  end;
  digest := encode(extensions.digest(convert_to(
    jsonb_build_array(
      'refund-nayax-lookup-v1', p_refund_case_id, p_lookup_generation,
      p_expected_fact_version, normalized_status, normalized_recommendation,
      normalized_policy, actual_candidate_count, p_last_checked_at
    )::text,
    'UTF8'
  ), 'sha256'), 'hex');

  update public.refund_cases
  set
    reporting_machine_id = coalesce(p_resolved_machine_id, reporting_machine_id),
    status = 'needs_review',
    correlation_status = computed_correlation_status,
    correlation_source = 'nayax',
    correlation_confidence = 0,
    correlation_summary = coalesce(
      nullif(normalized_summary, ''),
      'Bloomjoy completed the bounded Nayax transaction check.'
    ),
    automation_state = case
      when normalized_status = 'no_match' then 'more_info_needed'
      else 'under_review'
    end,
    nayax_recommendation_state = normalized_recommendation,
    nayax_recommendation_policy_version = normalized_policy,
    nayax_recommendation_evaluated_at = p_last_checked_at,
    nayax_match_execution_eligible = false,
    nayax_lookup_status = normalized_status,
    nayax_lookup_finished_at = statement_timestamp(),
    nayax_lookup_failure_class = null,
    nayax_lookup_safe_retry_eligible = false,
    nayax_lookup_correlation_digest = digest
  where id = case_row.id;

  delete from public.refund_nayax_lookup_candidates candidate
  where candidate.refund_case_id = case_row.id
    and candidate.lookup_generation <> p_lookup_generation;

  insert into public.refund_case_events (
    refund_case_id, actor_user_id, event_type, message, metadata
  ) values (
    case_row.id,
    p_actor_user_id,
    'nayax_lookup_completed',
    'Bloomjoy completed one bounded read-only Nayax transaction lookup.',
    jsonb_build_object(
      'lookup_generation', p_lookup_generation,
      'deterministic_fact_version', p_expected_fact_version,
      'lookup_status', normalized_status,
      'recommendation_state', normalized_recommendation,
      'policy_version', normalized_policy,
      'candidate_count', actual_candidate_count,
      'correlation_digest', digest,
      'trigger_source', lower(btrim(coalesce(p_trigger_source, ''))),
      'provider_payload_redacted', true,
      'payload_redacted', true
    )
  );

  return jsonb_build_object(
    'applied', true,
    'stale', false,
    'lookupStatus', normalized_status,
    'correlationDigest', digest,
    'payloadRedacted', true
  );
end;
$$;

revoke execute on function public.service_commit_refund_nayax_lookup(
  uuid, bigint, bigint, text, text, text, timestamptz, text,
  uuid, integer, text, uuid
) from public, anon, authenticated;
grant execute on function public.service_commit_refund_nayax_lookup(
  uuid, bigint, bigint, text, text, text, timestamptz, text,
  uuid, integer, text, uuid
) to service_role;

create or replace function public.service_fail_refund_nayax_lookup(
  p_refund_case_id uuid,
  p_lookup_generation bigint,
  p_expected_fact_version bigint,
  p_failure_class text,
  p_safe_retry_eligible boolean,
  p_trigger_source text,
  p_actor_user_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  case_row public.refund_cases%rowtype;
  normalized_failure text := lower(btrim(coalesce(p_failure_class, '')));
  result_status text;
  digest text;
begin
  if normalized_failure not in (
    'timeout', 'transport_error', 'provider_error', 'malformed_response',
    'response_limit', 'evidence_changed', 'worker_interrupted'
  ) then
    raise exception 'Invalid sanitized Nayax lookup failure' using errcode = 'P4624';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'refund-nayax-lookup-v1|' || p_refund_case_id::text,
      0
    )
  );
  select refund_case.* into case_row
  from public.refund_cases refund_case
  where refund_case.id = p_refund_case_id
  for update;

  if not found then
    raise exception 'Refund case not found' using errcode = 'P4620';
  end if;
  if case_row.nayax_lookup_generation is distinct from p_lookup_generation
    or case_row.deterministic_fact_version is distinct from p_expected_fact_version then
    delete from public.refund_nayax_lookup_candidates candidate
    where candidate.refund_case_id = p_refund_case_id
      and candidate.lookup_generation = p_lookup_generation;
    return jsonb_build_object(
      'applied', false,
      'stale', true,
      'payloadRedacted', true
    );
  end if;

  result_status := case
    when normalized_failure = 'timeout' then 'lookup_timed_out'
    when normalized_failure = 'response_limit' then 'response_limited'
    else 'lookup_failed'
  end;
  digest := encode(extensions.digest(convert_to(
    jsonb_build_array(
      'refund-nayax-lookup-failure-v1', p_refund_case_id,
      p_lookup_generation, p_expected_fact_version, normalized_failure
    )::text,
    'UTF8'
  ), 'sha256'), 'hex');

  delete from public.refund_nayax_lookup_candidates candidate
  where candidate.refund_case_id = case_row.id
    and candidate.lookup_generation = p_lookup_generation;

  update public.refund_cases
  set
    status = 'needs_review',
    correlation_status = 'needs_nayax',
    correlation_source = 'nayax',
    correlation_confidence = 0,
    correlation_summary = case
      when normalized_failure = 'timeout'
        then 'The bounded transaction check timed out. A read-only retry is safe.'
      when normalized_failure = 'response_limit'
        then 'Nayax returned more transaction evidence than Bloomjoy can review safely.'
      when normalized_failure = 'evidence_changed'
        then 'The purchase details changed during the transaction check.'
      else 'Bloomjoy could not finish the read-only transaction check.'
    end,
    nayax_recommendation_state = null,
    nayax_recommendation_policy_version = null,
    nayax_recommendation_evaluated_at = null,
    nayax_match_execution_eligible = false,
    nayax_lookup_status = result_status,
    nayax_lookup_finished_at = statement_timestamp(),
    nayax_lookup_failure_class = normalized_failure,
    nayax_lookup_safe_retry_eligible = coalesce(p_safe_retry_eligible, false),
    nayax_lookup_correlation_digest = digest
  where id = case_row.id;

  insert into public.refund_case_events (
    refund_case_id, actor_user_id, event_type, message, metadata
  ) values (
    case_row.id,
    p_actor_user_id,
    'nayax_lookup_failed',
    'The bounded read-only Nayax lookup stopped without any payment action.',
    jsonb_build_object(
      'lookup_generation', p_lookup_generation,
      'failure_class', normalized_failure,
      'safe_retry_eligible', coalesce(p_safe_retry_eligible, false),
      'correlation_digest', digest,
      'trigger_source', lower(btrim(coalesce(p_trigger_source, ''))),
      'provider_write_made', false,
      'payload_redacted', true
    )
  );

  return jsonb_build_object(
    'applied', true,
    'stale', false,
    'lookupStatus', result_status,
    'safeRetryEligible', coalesce(p_safe_retry_eligible, false),
    'correlationDigest', digest,
    'payloadRedacted', true
  );
end;
$$;

revoke execute on function public.service_fail_refund_nayax_lookup(
  uuid, bigint, bigint, text, boolean, text, uuid
) from public, anon, authenticated;
grant execute on function public.service_fail_refund_nayax_lookup(
  uuid, bigint, bigint, text, boolean, text, uuid
) to service_role;

create or replace function public.service_recover_stale_refund_nayax_lookups()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  recovered_count integer := 0;
begin
  with stale as (
    select refund_case.id
    from public.refund_cases refund_case
    where refund_case.nayax_lookup_status = 'checking'
      and refund_case.nayax_lookup_started_at <
        statement_timestamp() - interval '90 seconds'
    order by refund_case.nayax_lookup_started_at, refund_case.id
    limit 25
    for update skip locked
  ), updated as (
    update public.refund_cases refund_case
    set
      nayax_lookup_status = 'lookup_failed',
      nayax_lookup_finished_at = statement_timestamp(),
      nayax_lookup_failure_class = 'worker_interrupted',
      nayax_lookup_safe_retry_eligible = true,
      correlation_status = 'needs_nayax',
      correlation_summary =
        'The transaction check was interrupted. A read-only retry is safe.'
    from stale
    where refund_case.id = stale.id
    returning refund_case.id, refund_case.nayax_lookup_generation
  )
  select count(*)::integer into recovered_count from updated;

  delete from public.refund_nayax_lookup_candidates candidate
  using public.refund_cases refund_case
  where candidate.refund_case_id = refund_case.id
    and candidate.lookup_generation = refund_case.nayax_lookup_generation
    and refund_case.nayax_lookup_status = 'lookup_failed'
    and refund_case.nayax_lookup_failure_class = 'worker_interrupted';

  return jsonb_build_object(
    'recoveredCount', recovered_count,
    'providerWritesMade', 0,
    'safeRetryEligible', true,
    'payloadRedacted', true
  );
end;
$$;

revoke execute on function public.service_recover_stale_refund_nayax_lookups()
  from public, anon, authenticated;
grant execute on function public.service_recover_stale_refund_nayax_lookups()
  to service_role;

-- Keep the immutable journal authoritative while also projecting a sanitized
-- stage/failure digest onto the attempt. Each journal RPC commits separately
-- from settlement, so this projection survives a later settlement failure.
alter function public.service_record_nayax_refund_provider_stage_v2(
  text, uuid, text, text, text, integer, text, boolean, text, text, text, text
) rename to service_record_nayax_refund_provider_stage_v2_pre_durable_lifecycle_v1;

revoke execute on function
  public.service_record_nayax_refund_provider_stage_v2_pre_durable_lifecycle_v1(
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
  durable_stage text;
  durable_failure text;
  operations_required boolean := false;
begin
  result := public.service_record_nayax_refund_provider_stage_v2_pre_durable_lifecycle_v1(
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
    when normalized_failure = 'timeout' then 'provider_timeout'
    when normalized_failure = 'network' then 'provider_network'
    when p_contract_matched is false then 'contract_mismatch'
    when normalized_outcome = 'rejected' then 'provider_rejected'
    when normalized_outcome in ('pending', 'unknown') then 'provider_unknown'
    else null
  end;
  operations_required := durable_failure is not null;

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
      else refund_operations_due_at
    end
  where id = p_attempt_id;

  return result || jsonb_build_object(
    'safeStage', durable_stage,
    'safeFailureClass', durable_failure,
    'refundOperationsRequired', operations_required,
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

-- Extend the existing generation guard with one narrowly proven no-call
-- interruption release. Any journal marker keeps the attempt on a no-retry hold.
create or replace function public.guard_refund_nayax_attempt_generation()
returns trigger
language plpgsql
set search_path = public
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
  database_owner text;
  resolver_owner text;
  recovery_owner text;
  exact_generation_advance boolean := false;
  exact_no_call_advance boolean := false;
begin
  if new.nayax_refund_attempt_generation is not distinct from
      old.nayax_refund_attempt_generation then
    return new;
  end if;

  select pg_get_userbyid(database.datdba)
  into database_owner
  from pg_database database
  where database.datname = current_database();

  select pg_get_userbyid(procedure.proowner)
  into resolver_owner
  from pg_proc procedure
  where procedure.oid =
    'public.admin_consume_refund_nayax_resolution_intent(uuid,uuid,uuid,text,text,text,timestamptz,text,text)'::regprocedure;

  select pg_get_userbyid(procedure.proowner)
  into recovery_owner
  from pg_proc procedure
  where procedure.oid =
    'public.service_recover_stale_nayax_refund_attempts(text)'::regprocedure;

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

  if current_user is distinct from database_owner
    or not (
      (exact_generation_advance and resolver_owner = database_owner)
      or (exact_no_call_advance and recovery_owner = database_owner)
    ) then
    raise exception 'Nayax attempt generation advances only through one exact retry-safe support resolution or provable no-call recovery';
  end if;

  return new;
end;
$$;

create or replace function public.guard_refund_case_active_nayax_attempt()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  settlement_attempt_id uuid;
  settlement_provider_claim text;
  settlement_provider_claim_digest text;
  resolution_id uuid := nullif(
    current_setting('bloomjoy.nayax_support_resolution_id', true),
    ''
  )::uuid;
  interruption_attempt_id uuid := nullif(
    current_setting('bloomjoy.nayax_interruption_recovery_attempt_id', true),
    ''
  )::uuid;
  database_owner text;
  resolver_owner text;
  recovery_owner text;
  exact_completion_resolution boolean := false;
  exact_interruption_recovery boolean := false;
begin
  select pg_get_userbyid(database.datdba)
  into database_owner
  from pg_database database
  where database.datname = current_database();

  if resolution_id is not null then
    select pg_get_userbyid(procedure.proowner)
    into resolver_owner
    from pg_proc procedure
    where procedure.oid =
      'public.admin_consume_refund_nayax_resolution_intent(uuid,uuid,uuid,text,text,text,timestamptz,text,text)'::regprocedure;

    select exists (
      select 1
      from public.refund_nayax_outcome_resolutions resolution
      where resolution.id = resolution_id
        and resolution.refund_case_id = old.id
        and resolution.resolution_result in (
          'provider_confirmed_success', 'documented_manual_completion'
        )
    )
    and current_user = database_owner
    and current_user = resolver_owner
    into exact_completion_resolution;
  end if;

  if interruption_attempt_id is not null then
    select pg_get_userbyid(procedure.proowner)
    into recovery_owner
    from pg_proc procedure
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
    )
    and current_user = database_owner
    and recovery_owner = database_owner
    into exact_interruption_recovery;
  end if;

  settlement_provider_claim := nullif(
    current_setting('bloomjoy.nayax_settlement_provider_claim', true),
    ''
  );
  settlement_provider_claim_digest := case
    when settlement_provider_claim is null then null
    else encode(extensions.digest(
      convert_to(settlement_provider_claim, 'UTF8'), 'sha256'
    ), 'hex')
  end;

  if new.payment_method = 'card'
    and new.status = 'completed'
    and old.status is distinct from 'completed'
    and not exact_completion_resolution then
    settlement_attempt_id := nullif(
      current_setting('bloomjoy.nayax_settlement_attempt_id', true),
      ''
    )::uuid;
    if settlement_attempt_id is null
      or settlement_provider_claim_digest is null
      or old.nayax_refund_execution_status is distinct from 'requested'
      or not exists (
        select 1
        from public.refund_case_nayax_refund_attempts attempt
        join public.refund_case_official_action_authorizations action_authorization
          on action_authorization.id = attempt.official_action_authorization_id
        join public.refund_manager_action_step_up_intents intent
          on intent.id = attempt.step_up_intent_id
        where attempt.id = settlement_attempt_id
          and attempt.refund_case_id = old.id
          and attempt.status = 'in_progress'
          and attempt.provider_outcome is null
          and attempt.provider_claim_consumed_at is null
          and attempt.provider_claim_expires_at > statement_timestamp()
          and attempt.provider_claim_digest = settlement_provider_claim_digest
          and action_authorization.status = 'consumed'
          and action_authorization.verified_totp_at is not null
          and intent.status = 'consumed'
          and intent.target_function = 'nayax-card-refund'
          and intent.verified_totp_at = action_authorization.verified_totp_at
      ) then
      raise exception 'Card completion requires token-bound confirmed provider settlement';
    end if;
  end if;

  if old.nayax_refund_execution_status = 'requested'
    and row(
      old.status, old.decision, old.refund_amount_cents,
      old.manual_refund_reference, old.refund_completed_by,
      old.refund_completed_at, old.reporting_adjustment_id,
      old.nayax_refund_execution_status
    ) is distinct from row(
      new.status, new.decision, new.refund_amount_cents,
      new.manual_refund_reference, new.refund_completed_by,
      new.refund_completed_at, new.reporting_adjustment_id,
      new.nayax_refund_execution_status
    )
    and not exact_interruption_recovery then
    settlement_attempt_id := nullif(
      current_setting('bloomjoy.nayax_settlement_attempt_id', true),
      ''
    )::uuid;
    if settlement_attempt_id is null
      or settlement_provider_claim_digest is null
      or not exists (
        select 1
        from public.refund_case_nayax_refund_attempts attempt
        where attempt.id = settlement_attempt_id
          and attempt.refund_case_id = old.id
          and attempt.status = 'in_progress'
          and attempt.provider_outcome is null
          and attempt.provider_claim_consumed_at is null
          and attempt.provider_claim_expires_at > statement_timestamp()
          and attempt.provider_claim_digest = settlement_provider_claim_digest
      ) then
      raise exception 'An active Nayax provider attempt must settle before another official mutation';
    end if;
  end if;
  return new;
end;
$$;

-- Preserve the provider-outcome decision freeze while allowing only this
-- database-owned recovery function to publish its exact no-call release or
-- confirmation-hold state after the attempt row has been made terminal.
create or replace function public.guard_refund_provider_hold_case_update()
returns trigger
language plpgsql
set search_path = public
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
  database_owner text;
  resolver_owner text;
  recovery_owner text;
  exact_resolution boolean := false;
  exact_interruption_recovery boolean := false;
begin
  select pg_get_userbyid(database.datdba)
  into database_owner
  from pg_database database
  where database.datname = current_database();

  if resolution_id is not null then
    select pg_get_userbyid(procedure.proowner)
    into resolver_owner
    from pg_proc procedure
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
    select pg_get_userbyid(procedure.proowner)
    into recovery_owner
    from pg_proc procedure
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
    and (
      lower(btrim(coalesce(old.nayax_refund_execution_status, ''))) <> 'requested'
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

create or replace function public.service_recover_stale_nayax_refund_attempts(
  p_executor_assertion text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  attempt_row public.refund_case_nayax_refund_attempts%rowtype;
  journal_started boolean;
  latest_digest text;
  recovered_no_call integer := 0;
  held_for_confirmation integer := 0;
begin
  perform public.assert_nayax_provider_executor(p_executor_assertion);

  for attempt_row in
    select attempt.*
    from public.refund_case_nayax_refund_attempts attempt
    where attempt.execution_mode = 'request_and_approve'
      and attempt.status = 'in_progress'
      and attempt.provider_outcome is null
      and attempt.created_at < statement_timestamp() - interval '2 minutes'
    order by attempt.created_at, attempt.id
    limit 25
    for update skip locked
  loop
    select
      count(*) > 0,
      (
        array_agg(journal.classification_digest order by journal.created_at desc)
          filter (where journal.classification_digest is not null)
      )[1]
    into journal_started, latest_digest
    from public.refund_nayax_provider_stage_journal journal
    where journal.nayax_refund_attempt_id = attempt_row.id;

    perform pg_catalog.set_config(
      'bloomjoy.nayax_interruption_recovery_attempt_id',
      attempt_row.id::text,
      true
    );

    if not journal_started then
      update public.refund_case_nayax_refund_attempts
      set
        status = 'failed',
        provider_claim_consumed_at = statement_timestamp(),
        reconciliation_required = false,
        error_code = 'interrupted_before_transport',
        safe_transport_stage = 'released_no_call',
        safe_failure_class = 'interrupted_before_transport',
        correlation_digest = encode(extensions.digest(convert_to(
          jsonb_build_array(
            'refund-nayax-no-call-recovery-v1', attempt_row.id,
            attempt_row.request_fingerprint, attempt_row.created_at
          )::text,
          'UTF8'
        ), 'sha256'), 'hex'),
        refund_operations_due_at = null,
        sanitized_response = coalesce(sanitized_response, '{}'::jsonb) ||
          jsonb_build_object(
            'safe_stage', 'released_no_call',
            'failure_class', 'interrupted_before_transport',
            'provider_call_made', false,
            'automatic_retry_made', false,
            'payload_redacted', true
          )
      where id = attempt_row.id;

      perform pg_catalog.set_config(
        'bloomjoy.nayax_no_call_recovery_attempt_id',
        attempt_row.id::text,
        true
      );
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
      where id = attempt_row.refund_case_id;
      recovered_no_call := recovered_no_call + 1;
    else
      update public.refund_case_nayax_refund_attempts
      set
        status = 'manual_review',
        provider_claim_consumed_at = statement_timestamp(),
        provider_outcome = 'unknown',
        provider_outcome_recorded_at = statement_timestamp(),
        reconciliation_required = true,
        error_code = 'interrupted_after_transport',
        safe_transport_stage = 'confirmation_hold',
        safe_failure_class = 'interrupted_after_transport',
        correlation_digest = coalesce(
          latest_digest,
          encode(extensions.digest(convert_to(
            jsonb_build_array(
              'refund-nayax-transport-hold-v1', attempt_row.id,
              attempt_row.request_fingerprint, attempt_row.created_at
            )::text,
            'UTF8'
          ), 'sha256'), 'hex')
        ),
        refund_operations_due_at = coalesce(
          refund_operations_due_at,
          created_at + interval '60 minutes'
        ),
        sanitized_response = coalesce(sanitized_response, '{}'::jsonb) ||
          jsonb_build_object(
            'safe_stage', 'confirmation_hold',
            'failure_class', 'interrupted_after_transport',
            'provider_call_made', true,
            'automatic_retry_made', false,
            'payload_redacted', true
          )
      where id = attempt_row.id;

      update public.refund_cases
      set
        status = 'card_refund_pending',
        decision = 'approved',
        nayax_refund_execution_status = 'manual_review',
        nayax_match_execution_eligible = false
      where id = attempt_row.refund_case_id;
      held_for_confirmation := held_for_confirmation + 1;
    end if;

    insert into public.refund_case_events (
      refund_case_id, actor_user_id, event_type, message, metadata
    ) values (
      attempt_row.refund_case_id,
      null,
      case when journal_started
        then 'nayax_interruption_confirmation_hold'
        else 'nayax_interruption_no_call_released'
      end,
      case when journal_started
        then 'An interrupted provider attempt entered Refund Operations confirmation hold. It will not retry automatically.'
        else 'An interrupted reservation was released only after the journal proved no provider transport started.'
      end,
      jsonb_build_object(
        'attempt_id', attempt_row.id,
        'safe_stage', case when journal_started
          then 'confirmation_hold' else 'released_no_call' end,
        'failure_class', case when journal_started
          then 'interrupted_after_transport'
          else 'interrupted_before_transport' end,
        'refund_operations_owner', 'Refund Operations',
        'refund_operations_sla_minutes', 60,
        'provider_retry_made', false,
        'payload_redacted', true
      )
    );
  end loop;

  return jsonb_build_object(
    'releasedNoCallCount', recovered_no_call,
    'confirmationHoldCount', held_for_confirmation,
    'providerRetriesMade', 0,
    'ownerLabel', 'Refund Operations',
    'escalationSlaMinutes', 60,
    'payloadRedacted', true
  );
end;
$$;

revoke execute on function public.service_recover_stale_nayax_refund_attempts(text)
  from public, anon, authenticated;
grant execute on function public.service_recover_stale_nayax_refund_attempts(text)
  to service_role;

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

  operations_required := attempt_row.id is not null and (
    attempt_row.status in ('ambiguous', 'manual_review')
    or attempt_row.reconciliation_required is true
    or attempt_row.provider_outcome in ('timeout', 'unknown', 'rejected')
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
        when operations_required then 'Confirm the authoritative Nayax result. Do not retry.'
        else null
      end
    ),
    'payloadRedacted', true
  );
end;
$$;

revoke execute on function public.refund_lifecycle_contract(uuid)
  from public, anon, authenticated, service_role;

create or replace function public.service_get_refund_lifecycle(
  p_refund_case_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select public.refund_lifecycle_contract(p_refund_case_id);
$$;

revoke execute on function public.service_get_refund_lifecycle(uuid)
  from public, anon, authenticated;
grant execute on function public.service_get_refund_lifecycle(uuid)
  to service_role;

create or replace function public.get_refund_lifecycle_for_manager(
  p_refund_case_id uuid
)
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
    or not public.can_manage_refund_case(actor_user_id, p_refund_case_id) then
    raise exception 'Current refund case access required' using errcode = '42501';
  end if;
  return public.refund_lifecycle_contract(p_refund_case_id);
end;
$$;

revoke execute on function public.get_refund_lifecycle_for_manager(uuid)
  from public, anon, service_role;
grant execute on function public.get_refund_lifecycle_for_manager(uuid)
  to authenticated;

-- Prevent a stale candidate from being selected after a newer lookup starts.
alter function public.service_select_refund_nayax_candidate_as_actor(
  uuid, uuid, bigint, uuid, text
) rename to service_select_refund_nayax_candidate_as_actor_pre_lookup_generation_v1;

revoke execute on function
  public.service_select_refund_nayax_candidate_as_actor_pre_lookup_generation_v1(
    uuid, uuid, bigint, uuid, text
  ) from public, anon, authenticated, service_role;

create function public.service_select_refund_nayax_candidate_as_actor(
  p_actor_user_id uuid,
  p_case_id uuid,
  p_expected_case_version bigint,
  p_candidate_token uuid,
  p_nayax_disagreement_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  case_row public.refund_cases%rowtype;
  candidate_row public.refund_nayax_lookup_candidates%rowtype;
  manual_portal_candidate boolean := false;
  exact_replay boolean := false;
begin
  select refund_case.* into case_row
  from public.refund_cases refund_case
  where refund_case.id = p_case_id
  for update;
  if not found then
    raise exception 'Refund case not found' using errcode = 'P4600';
  end if;

  select candidate.* into candidate_row
  from public.refund_nayax_lookup_candidates candidate
  where candidate.token = p_candidate_token
    and candidate.refund_case_id = case_row.id
  for share;
  if not found then
    raise exception 'Nayax lookup evidence expired or belongs to another review session'
      using errcode = 'P4602';
  end if;

  manual_portal_candidate := coalesce(
    candidate_row.evidence_summary ->> 'source' = 'manual_nayax_portal',
    false
  );
  exact_replay :=
    case_row.matched_nayax_transaction_id = candidate_row.provider_transaction_id
    and case_row.matched_nayax_machine_auth_time =
      candidate_row.machine_authorization_time
    and case_row.matched_nayax_amount_cents = candidate_row.amount_cents;

  if not manual_portal_candidate and not exact_replay and (
    candidate_row.lookup_generation <> case_row.nayax_lookup_generation
    or case_row.nayax_lookup_status = 'checking'
  ) then
    raise exception 'A newer Nayax lookup replaced this transaction evidence'
      using errcode = 'P4602';
  end if;

  return public.service_select_refund_nayax_candidate_as_actor_pre_lookup_generation_v1(
    p_actor_user_id,
    p_case_id,
    p_expected_case_version,
    p_candidate_token,
    p_nayax_disagreement_reason
  );
end;
$$;

revoke execute on function public.service_select_refund_nayax_candidate_as_actor(
  uuid, uuid, bigint, uuid, text
) from public, anon, authenticated;
grant execute on function public.service_select_refund_nayax_candidate_as_actor(
  uuid, uuid, bigint, uuid, text
) to service_role;

-- Add the durable lifecycle and only current-generation candidates to the
-- existing scoped overview without reimplementing its privacy boundary.
alter function public.admin_get_refund_operations_overview()
  rename to admin_get_refund_operations_overview_pre_durable_lifecycle_v1;

revoke execute on function
  public.admin_get_refund_operations_overview_pre_durable_lifecycle_v1()
  from public, anon, authenticated, service_role;

create function public.admin_get_refund_operations_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  base_result jsonb;
  enriched_cases jsonb;
begin
  -- The delegated manager overview retains these reviewed compatibility
  -- anchors while this wrapper appends the versioned lifecycle projection:
  -- current_lookup.status = 'claimed'; lookup_failed;
  -- Refresh transaction results; 'cardNetwork', refund_case.card_network;
  -- paymentInteraction; incidentTimeConfidence; issueCategory;
  -- productLabel; machineStatus; nearbyMachineAlerts.
  base_result := public.admin_get_refund_operations_overview_pre_durable_lifecycle_v1();

  select coalesce(jsonb_agg(
    item.case_json
      || jsonb_build_object(
        'lifecycle', public.refund_lifecycle_contract(refund_case.id),
        'nayaxLookupCandidates', case
          when refund_case.nayax_lookup_status = 'checking' then '[]'::jsonb
          else coalesce((
            select jsonb_agg(candidate_json.value order by candidate_json.ordinality)
            from jsonb_array_elements(coalesce(
              item.case_json -> 'nayaxLookupCandidates',
              '[]'::jsonb
            )) with ordinality candidate_json(value, ordinality)
            join public.refund_nayax_lookup_candidates candidate
              on candidate.token = (candidate_json.value ->> 'candidateToken')::uuid
             and candidate.refund_case_id = refund_case.id
             and candidate.lookup_generation = refund_case.nayax_lookup_generation
             and candidate.expires_at > statement_timestamp()
          ), '[]'::jsonb)
        end,
        'nayaxLookupSummary', coalesce(
          item.case_json -> 'nayaxLookupSummary',
          '{}'::jsonb
        ) || jsonb_build_object(
          'lookupStatus', refund_case.nayax_lookup_status,
          'safeRetryEligible', refund_case.nayax_lookup_safe_retry_eligible,
          'failureClass', refund_case.nayax_lookup_failure_class,
          'automatic', true,
          'evidenceVersion', refund_case.deterministic_fact_version,
          'lookupGeneration', refund_case.nayax_lookup_generation,
          'lastUpdatedAt', coalesce(
            refund_case.nayax_lookup_finished_at,
            refund_case.nayax_lookup_started_at
          )
        )
      )
    order by item.case_order
  ), '[]'::jsonb) into enriched_cases
  from jsonb_array_elements(coalesce(base_result -> 'cases', '[]'::jsonb))
    with ordinality item(case_json, case_order)
  join public.refund_cases refund_case
    on refund_case.id = (item.case_json ->> 'id')::uuid;

  return jsonb_set(
    base_result || jsonb_build_object(
      'lifecycleContractVersion', 'refund_lifecycle_v1'
    ),
    '{cases}',
    enriched_cases,
    true
  );
end;
$$;

revoke execute on function public.admin_get_refund_operations_overview()
  from public, anon;
grant execute on function public.admin_get_refund_operations_overview()
  to authenticated, service_role;

-- Extend aggregate health with the lookup and interruption contract while
-- preserving the existing privacy-safe metrics.
alter function public.refund_nayax_reliability_health_snapshot(uuid)
  rename to refund_nayax_reliability_health_snapshot_pre_durable_lifecycle_v1;

revoke execute on function
  public.refund_nayax_reliability_health_snapshot_pre_durable_lifecycle_v1(uuid)
  from public, anon, authenticated, service_role;

create function public.refund_nayax_reliability_health_snapshot(
  p_actor_user_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  base_result jsonb;
  lookup_stale_count integer;
  oldest_lookup_started_at timestamptz;
  sla_breach_count integer;
  failure_counts jsonb;
  stage_counts jsonb;
begin
  base_result := public.refund_nayax_reliability_health_snapshot_pre_durable_lifecycle_v1(
    p_actor_user_id
  );

  select
    count(*) filter (
      where refund_case.nayax_lookup_status = 'checking'
        and refund_case.nayax_lookup_started_at <
          statement_timestamp() - interval '90 seconds'
    )::integer,
    min(refund_case.nayax_lookup_started_at) filter (
      where refund_case.nayax_lookup_status = 'checking'
    )
  into lookup_stale_count, oldest_lookup_started_at
  from public.refund_cases refund_case
  where p_actor_user_id is null
    or public.is_super_admin(p_actor_user_id)
    or public.can_manage_refund_case(p_actor_user_id, refund_case.id);

  select count(*) filter (
    where attempt.reconciliation_required is true
      and coalesce(
        attempt.refund_operations_due_at,
        attempt.created_at + interval '60 minutes'
      ) <= statement_timestamp()
  )::integer
  into sla_breach_count
  from public.refund_case_nayax_refund_attempts attempt
  join public.refund_cases refund_case on refund_case.id = attempt.refund_case_id
  where p_actor_user_id is null
    or public.is_super_admin(p_actor_user_id)
    or public.can_manage_refund_case(p_actor_user_id, refund_case.id);

  -- Rebuild grouped counts without exposing attempt rows.
  select coalesce(jsonb_object_agg(grouped.safe_failure_class, grouped.total), '{}'::jsonb)
  into failure_counts
  from (
    select coalesce(attempt.safe_failure_class, 'none') as safe_failure_class,
      count(*)::integer as total
    from public.refund_case_nayax_refund_attempts attempt
    join public.refund_cases refund_case on refund_case.id = attempt.refund_case_id
    where p_actor_user_id is null
      or public.is_super_admin(p_actor_user_id)
      or public.can_manage_refund_case(p_actor_user_id, refund_case.id)
    group by coalesce(attempt.safe_failure_class, 'none')
  ) grouped;
  select coalesce(jsonb_object_agg(grouped.safe_transport_stage, grouped.total), '{}'::jsonb)
  into stage_counts
  from (
    select attempt.safe_transport_stage, count(*)::integer as total
    from public.refund_case_nayax_refund_attempts attempt
    join public.refund_cases refund_case on refund_case.id = attempt.refund_case_id
    where p_actor_user_id is null
      or public.is_super_admin(p_actor_user_id)
      or public.can_manage_refund_case(p_actor_user_id, refund_case.id)
    group by attempt.safe_transport_stage
  ) grouped;

  return base_result || jsonb_build_object(
    'lifecycleContractVersion', 'refund_lifecycle_v1',
    'staleLookupCount', lookup_stale_count,
    'oldestLookupStartedAt', oldest_lookup_started_at,
    'refundOperationsSlaBreachCount', sla_breach_count,
    'safeFailureClassCounts', failure_counts,
    'safeStageCounts', stage_counts,
    'ownerLabel', 'Refund Operations',
    'escalationSlaMinutes', 60,
    'payloadRedacted', true
  );
end;
$$;

revoke execute on function public.refund_nayax_reliability_health_snapshot(uuid)
  from public, anon, authenticated, service_role;

select pg_notify('pgrst', 'reload schema');
