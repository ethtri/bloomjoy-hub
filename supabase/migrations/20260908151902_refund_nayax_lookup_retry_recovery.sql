-- #1236: read-only transaction checks may be retried after a failure that the
-- provider boundary classified as safe. Payment retries remain governed by
-- the separate immutable attempt/receipt contracts.

alter table public.refund_cases
  drop constraint if exists refund_cases_nayax_lookup_retry_count_check,
  add constraint refund_cases_nayax_lookup_retry_count_check
    check (nayax_lookup_retry_count >= 0);

comment on column public.refund_cases.nayax_lookup_retry_count is
  'Diagnostic count of manager-owned safe read-only lookup retries for the current deterministic fact version; it never authorizes a payment retry.';
comment on column public.refund_cases.nayax_lookup_retry_fact_version is
  'Deterministic fact version to which the read-only lookup retry count belongs.';

create or replace function public.guard_refund_nayax_lookup_retry_budget()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.deterministic_fact_version is distinct from old.deterministic_fact_version then
    new.nayax_lookup_retry_count := 0;
    new.nayax_lookup_retry_fact_version := new.deterministic_fact_version;
    new.nayax_lookup_status := 'not_started';
    new.nayax_lookup_started_at := null;
    new.nayax_lookup_finished_at := null;
    new.nayax_lookup_failure_class := null;
    new.nayax_lookup_safe_retry_eligible := false;
    new.nayax_lookup_correlation_digest := null;
  end if;
  return new;
end;
$$;

comment on function public.guard_refund_nayax_lookup_retry_budget() is
  'Resets read-only lookup state when deterministic facts change. Retry eligibility is supplied by the bounded provider-failure classification, not a lifetime attempt cap.';

create or replace function public.repair_refund_nayax_lookup_retry_eligibility()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  repaired_count integer := 0;
begin
  with repaired as (
    update public.refund_cases refund_case
    set
      nayax_lookup_safe_retry_eligible = true,
      correlation_summary =
        'The read-only transaction check can be tried again. No payment action was taken.'
    where not refund_case.nayax_lookup_safe_retry_eligible
      and refund_case.nayax_lookup_retry_count >= 1
      and refund_case.nayax_lookup_retry_fact_version =
        refund_case.deterministic_fact_version
      and refund_case.nayax_lookup_generation > 0
      and refund_case.nayax_lookup_started_at is not null
      and refund_case.nayax_lookup_finished_at is not null
      and refund_case.nayax_lookup_correlation_digest is not null
      and (
        (refund_case.nayax_lookup_status = 'lookup_timed_out'
          and refund_case.nayax_lookup_failure_class = 'timeout')
        or
        (refund_case.nayax_lookup_status = 'lookup_failed'
          and refund_case.nayax_lookup_failure_class in (
            'transport_error', 'malformed_response', 'worker_interrupted'
          ))
      )
      and refund_case.status in (
        'submitted', 'needs_review', 'correlated', 'approved'
      )
      and refund_case.decision is distinct from 'denied'
      and refund_case.nayax_refund_execution_status = 'not_requested'
      and refund_case.refund_completed_at is null
      and refund_case.reporting_adjustment_id is null
      and refund_case.manual_refund_reference is null
      and refund_case.matched_nayax_transaction_id is null
      and refund_case.duplicate_of_refund_case_id is null
      and exists (
        select 1
        from public.reporting_machine_refund_managers manager
        where manager.reporting_machine_id = refund_case.reporting_machine_id
          and manager.status = 'active'
          and manager.revoked_at is null
      )
      and not exists (
        select 1
        from public.refund_authoritative_receipts receipt
        where receipt.refund_case_id = refund_case.id
      )
      and not exists (
        select 1
        from public.refund_case_nayax_refund_attempts attempt
        where attempt.refund_case_id = refund_case.id
      )
    returning refund_case.id, refund_case.nayax_lookup_generation,
      refund_case.deterministic_fact_version
  ), recorded as (
    insert into public.refund_case_events (
      refund_case_id, actor_user_id, event_type, message, metadata
    )
    select
      repaired.id,
      null,
      'nayax_lookup_retry_reenabled',
      'A previously capped read-only transaction check was made retryable without any payment action.',
      jsonb_build_object(
        'lookup_generation', repaired.nayax_lookup_generation,
        'deterministic_fact_version', repaired.deterministic_fact_version,
        'provider_call_kind', 'read_only',
        'provider_write_made', false,
        'payload_redacted', true
      )
    from repaired
    returning 1
  )
  select count(*)::integer into repaired_count from recorded;

  return repaired_count;
end;
$$;

revoke all on function public.repair_refund_nayax_lookup_retry_eligibility()
  from public, anon, authenticated, service_role;

select public.repair_refund_nayax_lookup_retry_eligibility();

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
  consumes_safe_retry boolean := false;
  result jsonb;
begin
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

  if case_row.nayax_lookup_status = 'checking' then
    if case_row.nayax_lookup_started_at is null
      or case_row.nayax_lookup_started_at >=
        statement_timestamp() - interval '90 seconds' then
      raise exception 'A read-only Nayax transaction check is already in progress'
        using errcode = 'P4622';
    end if;

    update public.refund_cases
    set
      nayax_lookup_status = 'lookup_failed',
      nayax_lookup_finished_at = statement_timestamp(),
      nayax_lookup_failure_class = 'worker_interrupted',
      nayax_lookup_safe_retry_eligible = true,
      correlation_status = 'needs_nayax',
      correlation_summary =
        'The transaction check was interrupted. A fresh read-only check is safe.'
    where id = case_row.id;

    delete from public.refund_nayax_lookup_candidates candidate
    where candidate.refund_case_id = case_row.id
      and candidate.lookup_generation = case_row.nayax_lookup_generation;

    select refund_case.* into case_row
    from public.refund_cases refund_case
    where refund_case.id = p_refund_case_id;
  end if;

  consumes_safe_retry := case_row.nayax_lookup_status in (
      'lookup_failed', 'lookup_timed_out', 'response_limited'
    )
    and case_row.nayax_lookup_safe_retry_eligible;

  if case_row.nayax_lookup_status in (
      'lookup_failed', 'lookup_timed_out', 'response_limited'
    )
    and not case_row.nayax_lookup_safe_retry_eligible then
    raise exception
      'A read-only Nayax retry is not safe; use the reviewed internal fallback'
      using errcode = 'P4622';
  end if;

  result := public.service_begin_refund_nayax_lookup_pre_scope_recovery_v1(
    p_refund_case_id,
    p_expected_fact_version,
    p_trigger_source,
    p_actor_user_id
  );

  if result ->> 'status' = 'checking' then
    update public.refund_cases
    set
      nayax_lookup_retry_count = case
        when consumes_safe_retry then least(
          nayax_lookup_retry_count::integer + 1,
          32767
        )::smallint
        when nayax_lookup_retry_fact_version <> p_expected_fact_version then 0
        else nayax_lookup_retry_count
      end,
      nayax_lookup_retry_fact_version = p_expected_fact_version
    where id = p_refund_case_id;
  end if;

  return result || jsonb_build_object(
    'safeRetryConsumed', consumes_safe_retry,
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
  result jsonb;
  actual_safe_retry boolean := false;
begin
  result := public.service_fail_refund_nayax_lookup_pre_scope_recovery_v1(
    p_refund_case_id,
    p_lookup_generation,
    p_expected_fact_version,
    p_failure_class,
    p_safe_retry_eligible,
    p_trigger_source,
    p_actor_user_id
  );

  if result ->> 'applied' = 'true' then
    select refund_case.nayax_lookup_safe_retry_eligible
    into actual_safe_retry
    from public.refund_cases refund_case
    where refund_case.id = p_refund_case_id;
    result := result || jsonb_build_object(
      'safeRetryEligible', coalesce(actual_safe_retry, false)
    );
  end if;

  return result;
end;
$$;

revoke execute on function public.service_fail_refund_nayax_lookup(
  uuid, bigint, bigint, text, boolean, text, uuid
) from public, anon, authenticated;
grant execute on function public.service_fail_refund_nayax_lookup(
  uuid, bigint, bigint, text, boolean, text, uuid
) to service_role;

do $migration$
declare
  definition text;
  old_text text := 'then run one safe read-only retry or use the reviewed manual Nayax portal fallback.';
  new_text text := 'then run a fresh read-only transaction check or use the reviewed manual Nayax portal fallback.';
begin
  definition := pg_catalog.pg_get_functiondef(
    'public.admin_get_refund_operations_overview()'::regprocedure
  );
  if length(definition) - length(replace(definition, old_text, '')) <>
    length(old_text) then
    raise exception 'Exact manager overview retry-copy anchor is required';
  end if;
  execute replace(definition, old_text, new_text);
end;
$migration$;

comment on function public.admin_get_refund_operations_overview() is
  'Actor-scoped refund overview with internal Nayax setup ownership, required account scope, and classified-safe read-only retry state.';

select pg_notify('pgrst', 'reload schema');
