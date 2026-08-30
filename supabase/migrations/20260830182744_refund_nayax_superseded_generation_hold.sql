-- Retry-safe resolutions have two deliberately different meanings:
--
-- 1. The active lifecycle needs exact equality with the case generation.
-- 2. Account-wide history needs a monotonic proof that remains true after the
--    case advances again or reaches a terminal state.
--
-- Keep refund_nayax_retry_safe_resolution_is_current() exact for (1). This
-- historical predicate supplies (2) without changing any financial evidence,
-- attempt row, case projection, provider state, reporting fact, or message.

create or replace function public.refund_nayax_retry_safe_resolution_is_historical(
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
    join public.refund_cases refund_case
      on refund_case.id = attempt.refund_case_id
    join public.refund_nayax_outcome_resolutions resolution
      on resolution.id = attempt.support_resolution_id
      and resolution.nayax_refund_attempt_id = attempt.id
      and resolution.refund_case_id = attempt.refund_case_id
    where attempt.id = p_attempt_id
      and attempt.execution_mode = 'request_and_approve'
      and attempt.reconciliation_required is false
      and attempt.support_resolution_result = 'provider_confirmed_retry_safe'
      and attempt.support_resolution_recorded_at is not null
      and resolution.resolution_result = 'provider_confirmed_retry_safe'
      and resolution.prior_reconciliation_required is true
      and resolution.prior_attempt_generation + 1 =
        resolution.next_attempt_generation
      and resolution.next_attempt_generation <=
        refund_case.nayax_refund_attempt_generation
      and resolution.payload_redacted is true
  );
$$;

revoke execute on function public.refund_nayax_retry_safe_resolution_is_historical(uuid)
  from public, anon, authenticated, service_role;

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
    where upper(btrim(machine.nayax_account_key)) =
      upper(btrim(coalesce(p_nayax_account_key, '')))
      and attempt.execution_mode = 'request_and_approve'
      and not public.refund_nayax_retry_safe_resolution_is_historical(
        attempt.id
      )
      and (
        attempt.status in (
          'in_progress', 'requested', 'approved', 'ambiguous', 'manual_review'
        )
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

comment on function public.refund_nayax_retry_safe_resolution_is_historical(uuid) is
  'Internal monotonic predicate for account-hold history. A structurally valid retry-safe resolution remains applicable after its case advances to the next or any later generation.';
comment on function public.refund_nayax_account_execution_hold(text) is
  'Account-scoped Nayax circuit breaker. Permanently resolved retry-safe history is excluded; every unresolved or unknown current attempt still holds the account.';
