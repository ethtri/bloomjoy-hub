-- A manager-session retry-safe resolution intentionally preserves the original
-- provider outcome as immutable evidence. Treat the linked authoritative
-- resolution as the release signal instead of continuing to hold the account.

create or replace function public.refund_nayax_retry_safe_resolution_is_current(
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
      and resolution.prior_attempt_generation + 1 = resolution.next_attempt_generation
      and resolution.next_attempt_generation = refund_case.nayax_refund_attempt_generation
      and resolution.payload_redacted is true
      and refund_case.nayax_refund_execution_status = 'not_requested'
      and refund_case.refund_completed_at is null
      and refund_case.reporting_adjustment_id is null
  );
$$;

revoke execute on function public.refund_nayax_retry_safe_resolution_is_current(uuid)
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
      and not public.refund_nayax_retry_safe_resolution_is_current(attempt.id)
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

-- Keep the lifecycle contract byte-for-byte aligned with its latest version,
-- changing only how its definitive no-refund projection recognizes a resolved
-- manager-session attempt. Exact anchors make the migration fail closed if the
-- function changed unexpectedly.
do $$
declare
  lifecycle_definition text;
  definitive_anchor text := $anchor$  definitive_no_refund := attempt_row.id is not null
    and attempt_row.provider_outcome = 'rejected'
    and attempt_row.safe_transport_stage = 'released_no_refund'
    and attempt_row.reconciliation_required is false
    and case_row.nayax_refund_execution_status = 'not_requested'
    and public.refund_nayax_definitive_rejection_is_retry_safe(attempt_row.id);$anchor$;
  definitive_replacement text := $replacement$  definitive_no_refund := attempt_row.id is not null
    and (
      (
        attempt_row.provider_outcome = 'rejected'
        and attempt_row.safe_transport_stage = 'released_no_refund'
        and attempt_row.reconciliation_required is false
        and case_row.nayax_refund_execution_status = 'not_requested'
        and public.refund_nayax_definitive_rejection_is_retry_safe(attempt_row.id)
      )
      or public.refund_nayax_retry_safe_resolution_is_current(attempt_row.id)
    );$replacement$;
  operations_anchor text := $anchor$  operations_required := attempt_row.id is not null and (
    attempt_row.status in ('ambiguous', 'manual_review')
    or attempt_row.reconciliation_required is true
    or attempt_row.provider_outcome in ('timeout', 'unknown')
    or (
      attempt_row.provider_outcome = 'rejected'
      and not definitive_no_refund
    )
  );$anchor$;
  operations_replacement text := $replacement$  operations_required := attempt_row.id is not null
    and not definitive_no_refund
    and (
      attempt_row.status in ('ambiguous', 'manual_review')
      or attempt_row.reconciliation_required is true
      or attempt_row.provider_outcome in ('timeout', 'unknown')
      or attempt_row.provider_outcome = 'rejected'
    );$replacement$;
  confirming_anchor text := $anchor$  elsif attempt_row.id is not null and (
    latest_journal.stage = 'approve'
    or attempt_row.status in ('approved', 'requested')
  ) then$anchor$;
  confirming_replacement text := $replacement$  elsif attempt_row.id is not null
    and not definitive_no_refund
    and (
      latest_journal.stage = 'approve'
      or attempt_row.status in ('approved', 'requested')
    ) then$replacement$;
  initiated_anchor text := $anchor$  elsif attempt_row.id is not null
    and attempt_row.status in ('in_progress', 'requested') then$anchor$;
  initiated_replacement text := $replacement$  elsif attempt_row.id is not null
    and not definitive_no_refund
    and attempt_row.status in ('in_progress', 'requested') then$replacement$;
begin
  lifecycle_definition := pg_catalog.pg_get_functiondef(
    'public.refund_lifecycle_contract(uuid)'::regprocedure
  );
  lifecycle_definition := replace(lifecycle_definition, E'\r\n', E'\n');

  if length(lifecycle_definition) - length(replace(
      lifecycle_definition, definitive_anchor, ''
    )) <> length(definitive_anchor)
    or length(lifecycle_definition) - length(replace(
      lifecycle_definition, operations_anchor, ''
    )) <> length(operations_anchor)
    or length(lifecycle_definition) - length(replace(
      lifecycle_definition, confirming_anchor, ''
    )) <> length(confirming_anchor)
    or length(lifecycle_definition) - length(replace(
      lifecycle_definition, initiated_anchor, ''
    )) <> length(initiated_anchor) then
    raise exception 'Exact refund lifecycle release anchors are required';
  end if;

  lifecycle_definition := replace(
    lifecycle_definition,
    definitive_anchor,
    definitive_replacement
  );
  lifecycle_definition := replace(
    lifecycle_definition,
    operations_anchor,
    operations_replacement
  );
  lifecycle_definition := replace(
    lifecycle_definition,
    confirming_anchor,
    confirming_replacement
  );
  lifecycle_definition := replace(
    lifecycle_definition,
    initiated_anchor,
    initiated_replacement
  );
  execute lifecycle_definition;
end;
$$;

revoke execute on function public.refund_lifecycle_contract(uuid)
  from public, anon, authenticated, service_role;

comment on function public.refund_nayax_retry_safe_resolution_is_current(uuid) is
  'Internal exact predicate for a manager-session retry-safe Nayax resolution. It preserves the immutable prior provider outcome while proving the current case generation is released.';
comment on function public.refund_nayax_account_execution_hold(text) is
  'Account-scoped Nayax circuit breaker. Authoritatively resolved retry-safe attempts do not hold the account; every unresolved or unknown attempt still does.';
