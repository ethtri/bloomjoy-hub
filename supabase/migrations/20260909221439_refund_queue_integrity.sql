-- #992/#1265/#1277: keep manager queues, duplicate outcomes, lookup state,
-- and synthetic production-smoke provenance aligned with durable evidence.

alter table public.refund_cases
  add column if not exists internal_test_classification_source text;

alter table public.refund_cases
  drop constraint if exists refund_cases_internal_test_classification_source_check,
  add constraint refund_cases_internal_test_classification_source_check check (
    internal_test_classification_source is null
    or internal_test_classification_source in (
      'manager', 'owner_synthetic_smoke'
    )
  ),
  drop constraint if exists refund_cases_internal_test_shape_check,
  add constraint refund_cases_internal_test_shape_check check (
    (
      case_population = 'customer'
      and internal_test_reason is null
      and internal_test_classified_at is null
      and internal_test_classified_by is null
      and internal_test_classification_source is null
    )
    or (
      case_population = 'internal_test'
      and internal_test_reason is not null
      and internal_test_classified_at is not null
      and (
        (
          (
            internal_test_classification_source is null
            or internal_test_classification_source = 'manager'
          )
          and internal_test_classified_by is not null
        )
        or (
          internal_test_classification_source = 'owner_synthetic_smoke'
          and internal_test_classified_by is null
        )
      )
      and status = 'closed'
      and automation_state = 'closed_incomplete'
      and automation_follow_up_due_at is null
      and decision is null
      and decided_by is null
      and decided_at is null
      and reporting_adjustment_id is null
      and refund_completed_by is null
      and refund_completed_at is null
    )
  );

update public.refund_cases
set internal_test_classification_source = 'manager'
where case_population = 'internal_test'
  and internal_test_classification_source is null;

create or replace function public.guard_refund_internal_test_case()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.case_population = 'internal_test' then
    if new.case_population is distinct from old.case_population
      or new.internal_test_reason is distinct from old.internal_test_reason
      or new.internal_test_classified_at is distinct from old.internal_test_classified_at
      or new.internal_test_classified_by is distinct from old.internal_test_classified_by
      or new.internal_test_classification_source is distinct from old.internal_test_classification_source
      or new.status is distinct from 'closed'
      or new.automation_state is distinct from 'closed_incomplete'
      or new.automation_follow_up_due_at is not null
      or new.decision is not null
      or new.decided_by is not null
      or new.decided_at is not null
      or new.reporting_adjustment_id is not null
      or new.refund_completed_by is not null
      or new.refund_completed_at is not null then
      raise exception using errcode = 'P4638',
        message = 'Internal/test classification is immutable and customer actions remain suppressed';
    end if;
  elsif new.case_population = 'internal_test' then
    if new.internal_test_classification_source is null
      and new.internal_test_classified_by is not null then
      new.internal_test_classification_source := 'manager';
    end if;
    if current_user in ('anon', 'authenticated', 'service_role') then
      raise exception using errcode = 'P4639',
        message = 'Use the authorized Internal/test disposition';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.guard_refund_internal_test_case()
  from public, anon, authenticated, service_role;

-- This owner-only helper exists solely for the production intake/email smoke
-- runner. Exact run provenance is required; public text, price, or loose
-- keywords can never classify a customer case.
create or replace function public.owner_archive_refund_synthetic_smoke(
  p_case_id uuid,
  p_synthetic_run_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  case_row public.refund_cases%rowtype;
  classified_at timestamptz := statement_timestamp();
  expected_marker text := '[SYNTHETIC PRODUCTION SMOKE] Run '
    || p_synthetic_run_id::text
    || '. Intake and email delivery verification. No customer incident.';
  skipped_message_count integer := 0;
  closed_cycle_count integer := 0;
  revoked_capability_count integer := 0;
begin
  if current_user <> 'postgres' then
    raise exception 'Database owner required' using errcode = '42501';
  end if;

  select refund_case.* into case_row
  from public.refund_cases refund_case
  where refund_case.id = p_case_id
  for update;

  if case_row.id is null then
    raise exception 'Refund case not found' using errcode = 'P4632';
  end if;
  if case_row.case_population = 'internal_test'
    and case_row.internal_test_classification_source = 'owner_synthetic_smoke' then
    return jsonb_build_object(
      'archived', false, 'replayed', true, 'payloadRedacted', true
    );
  end if;
  if case_row.case_population <> 'customer'
    or case_row.customer_name <> 'Bloomjoy Refund Smoke'
    or case_row.issue_summary <> expected_marker then
    raise exception 'Exact synthetic smoke provenance required'
      using errcode = 'P4680';
  end if;
  if case_row.status in ('completed', 'cash_zelle_pending', 'card_refund_pending')
    or case_row.reporting_adjustment_id is not null
    or case_row.refund_completed_at is not null
    or nullif(btrim(coalesce(case_row.manual_refund_reference, '')), '') is not null
    or exists (
      select 1
      from public.refund_case_nayax_refund_attempts attempt
      where attempt.refund_case_id = case_row.id
    ) then
    raise exception 'Synthetic smoke case has payment evidence and cannot be archived'
      using errcode = 'P4681';
  end if;

  update public.refund_cases
  set
    case_population = 'internal_test',
    internal_test_reason = 'provider_test',
    internal_test_classified_at = classified_at,
    internal_test_classified_by = null,
    internal_test_classification_source = 'owner_synthetic_smoke',
    status = 'closed',
    automation_state = 'closed_incomplete',
    automation_follow_up_due_at = null,
    decision = null,
    decision_reason = null,
    decided_by = null,
    decided_at = null,
    nayax_match_execution_eligible = false
  where id = case_row.id;

  update public.refund_case_messages message
  set status = 'skipped', error_message = 'internal_test_customer_contact_suppressed'
  where message.refund_case_id = case_row.id and message.status = 'pending';
  get diagnostics skipped_message_count = row_count;

  update public.refund_follow_up_cycles cycle
  set status = 'manual_review'
  where cycle.refund_case_id = case_row.id
    and cycle.status in ('claimed', 'waiting', 'customer_replied');
  get diagnostics closed_cycle_count = row_count;

  update public.refund_case_status_capabilities capability
  set revoked_at = classified_at, revoked_reason = 'case_closed'
  where capability.refund_case_id = case_row.id
    and capability.revoked_at is null;
  get diagnostics revoked_capability_count = row_count;

  insert into public.refund_case_events (
    refund_case_id, actor_user_id, event_type, message, metadata
  ) values (
    case_row.id,
    null,
    'internal_test_classified',
    'The owner-controlled production smoke archived its explicit synthetic record.',
    jsonb_build_object(
      'classification', 'internal_test_no_customer_refund',
      'reason', 'provider_test',
      'classification_source', 'owner_synthetic_smoke',
      'synthetic_run_id', p_synthetic_run_id,
      'queued_messages_suppressed', skipped_message_count,
      'follow_up_cycles_closed', closed_cycle_count,
      'status_capabilities_revoked', revoked_capability_count,
      'customer_message_sent', false,
      'provider_call_made', false,
      'reporting_adjustment_created', false,
      'payload_redacted', true
    )
  );

  return jsonb_build_object(
    'archived', true, 'replayed', false, 'payloadRedacted', true
  );
end;
$$;

revoke all on function public.owner_archive_refund_synthetic_smoke(uuid, uuid)
  from public, anon, authenticated, service_role;

comment on function public.owner_archive_refund_synthetic_smoke(uuid, uuid) is
  'Owner-only exact-provenance closeout for one production intake/email smoke case; it cannot classify customer text heuristically or touch a case with payment evidence.';

-- Preserve all prior receipt/completion wrappers, then normalize only the
-- manager-facing projection. No underlying payment or message fact changes.
alter function public.refund_lifecycle_contract(uuid)
  rename to refund_lifecycle_contract_pre_queue_integrity_v1;

revoke all on function
  public.refund_lifecycle_contract_pre_queue_integrity_v1(uuid)
  from public, anon, authenticated, service_role;

create function public.refund_lifecycle_contract(p_refund_case_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  base jsonb;
  case_row public.refund_cases%rowtype;
  canonical_case public.refund_cases%rowtype;
  lookup_results_expired boolean := false;
begin
  base := public.refund_lifecycle_contract_pre_queue_integrity_v1(
    p_refund_case_id
  );
  select refund_case.* into case_row
  from public.refund_cases refund_case
  where refund_case.id = p_refund_case_id;

  if case_row.id is null or case_row.case_population = 'internal_test' then
    return base;
  end if;

  if case_row.duplicate_of_refund_case_id is not null then
    select refund_case.* into canonical_case
    from public.refund_cases refund_case
    where refund_case.id = case_row.duplicate_of_refund_case_id;

    if canonical_case.id is not null and (
      canonical_case.status = 'completed'
      or canonical_case.refund_completed_at is not null
      or canonical_case.reporting_adjustment_id is not null
      or exists (
        select 1 from public.refund_authoritative_receipts receipt
        where receipt.refund_case_id = canonical_case.id
      )
      or exists (
        select 1
        from public.refund_case_nayax_refund_attempts attempt
        where attempt.refund_case_id = canonical_case.id
          and (
            attempt.status = 'succeeded'
            or attempt.provider_outcome = 'success'
          )
      )
    ) then
      return base || jsonb_build_object(
        'stage', 'duplicate_resolved',
        'stageRank', 100,
        'reasonCode', 'duplicate_of_completed_case',
        'customerAction', jsonb_build_object(
          'action', 'none', 'required', false,
          'requestedFields', '[]'::jsonb, 'payloadRedacted', true
        ),
        'managerAction', jsonb_build_object(
          'action', 'none', 'owner', 'Machine Manager',
          'safeRetryEligible', false, 'payloadRedacted', true
        ),
        'paymentState', 'not_issued_duplicate',
        'managerNextAction', 'none',
        'publicCopyKey', 'refund_duplicate_resolved',
        'terminal', true,
        'refreshAfterSeconds', null,
        'safeRetryEligible', false,
        'duplicateOfPublicReference', canonical_case.public_reference,
        'lookup', (base -> 'lookup') || jsonb_build_object(
          'safeRetryEligible', false
        ),
        'operations', jsonb_build_object(
          'required', false,
          'queue', 'Refund Operations',
          'owner', 'Refund Operations',
          'slaMinutes', 60,
          'ageMinutes', null,
          'dueAt', null,
          'slaBreached', false,
          'safeStage', 'duplicate_resolved',
          'failureClass', null,
          'nextStep', null
        ),
        'managerQueue', jsonb_build_object(
          'schemaVersion', 'refund_manager_queue_v2',
          'bucket', 'completed',
          'label', 'Duplicate resolved',
          'nextAction', 'none',
          'safeRetryEligible', false,
          'customerActionFields', '[]'::jsonb,
          'payloadRedacted', true
        )
      );
    end if;
  end if;

  lookup_results_expired :=
    base ->> 'stage' = 'matching'
    and case_row.nayax_lookup_finished_at is not null
    and case_row.nayax_lookup_status in (
      'match_found', 'multiple_matches', 'manual_exception'
    )
    and not exists (
      select 1
      from public.refund_nayax_lookup_candidates candidate
      where candidate.refund_case_id = case_row.id
        and candidate.lookup_generation = case_row.nayax_lookup_generation
        and candidate.expires_at > statement_timestamp()
    );

  if lookup_results_expired then
    base := base || jsonb_build_object(
      'reasonCode', 'lookup_results_expired',
      'managerAction', jsonb_build_object(
        'action', 'retry_read_only_lookup',
        'owner', 'Machine Manager',
        'safeRetryEligible', true,
        'payloadRedacted', true
      ),
      'managerNextAction', 'retry_read_only_lookup',
      'lookup', (base -> 'lookup') || jsonb_build_object(
        'status', 'results_expired',
        'safeRetryEligible', true,
        'failureClass', null
      ),
      'managerQueue', (base -> 'managerQueue') || jsonb_build_object(
        'nextAction', 'retry_read_only_lookup',
        'safeRetryEligible', true
      )
    );
  end if;

  if base #>> '{managerQueue,bucket}' = 'needs_action'
    and base ->> 'stage' = 'customer_notified'
    and base ->> 'reasonCode' = 'completion_delivery_unconfirmed'
    and base ->> 'paymentState' = 'confirmed'
    and base ->> 'managerNextAction' = 'review_delivery_no_resend'
    and base #>> '{managerAction,owner}' = 'Refund Operations'
    and coalesce((base #>> '{operations,required}')::boolean, false)
    and base #>> '{operations,failureClass}' = 'customer_delivery_exception'
    and base #>> '{operations,safeStage}' = 'settled' then
    base := base || jsonb_build_object(
      'managerQueue', (base -> 'managerQueue') || jsonb_build_object(
        'bucket', 'provider_hold',
        'label', 'Needs Refund Operations'
      )
    );
  end if;

  return base;
end;
$$;

revoke all on function public.refund_lifecycle_contract(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.refund_lifecycle_contract(uuid)
  to service_role;

comment on function public.refund_lifecycle_contract(uuid) is
  'Canonical lifecycle plus terminal duplicate resolution, expired lookup recovery, and Refund Operations queue ownership normalization.';

select pg_notify('pgrst', 'reload schema');
