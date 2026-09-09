-- The recovery case guard runs before and after the lifecycle revision trigger.
-- Preserve the exact recovery contract while accepting only the one revision bump
-- that PostgreSQL has already applied by the later provider-hold guard.
create or replace function public.refund_journal_duplicate_recovery_case_change_allowed(
  p_old jsonb,
  p_new jsonb
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    p_old ->> 'id' = p_new ->> 'id'
    and nullif(current_setting('bloomjoy.nayax_journal_recovery_attempt_id', true), '') is not null
    and nullif(current_setting('bloomjoy.nayax_journal_recovery_duplicate_id', true), '') is not null
    and public.refund_nayax_unsettled_api_success_journal_proved(
      (p_old ->> 'id')::uuid,
      current_setting('bloomjoy.nayax_journal_recovery_attempt_id', true)::uuid
    )
    and p_old ->> 'status' in ('approved', 'card_refund_pending')
    and p_old ->> 'decision' = 'approved'
    and p_old ->> 'nayax_refund_execution_status' = 'requested'
    and nullif(p_old ->> 'reporting_adjustment_id', '') is null
    and p_new ->> 'status' = 'completed'
    and p_new ->> 'decision' = 'approved'
    and p_new ->> 'nayax_refund_execution_status' = 'approved'
    and coalesce((p_new ->> 'nayax_match_execution_eligible')::boolean, false) = false
    and nullif(p_new ->> 'reporting_adjustment_id', '') is not null
    and nullif(p_new ->> 'manual_refund_reference', '') is not null
    and nullif(p_new ->> 'refund_completed_by', '') is not null
    and nullif(p_new ->> 'refund_completed_at', '') is not null
    and p_new ->> 'automation_state' = 'completed'
    -- This helper runs in guards on both sides of the lifecycle bump trigger.
    -- Admit only its exact unchanged or single-increment form.
    and (p_new ->> 'lifecycle_revision')::bigint in (
      (p_old ->> 'lifecycle_revision')::bigint,
      (p_old ->> 'lifecycle_revision')::bigint + 1
    )
    and exists (
      select 1
      from public.refund_case_nayax_refund_attempts attempt
      join public.refund_case_official_action_authorizations authz
        on authz.id = attempt.official_action_authorization_id
      join public.refund_cases duplicate
        on duplicate.id = current_setting(
          'bloomjoy.nayax_journal_recovery_duplicate_id', true
        )::uuid
      join public.sales_adjustment_facts adjustment
        on adjustment.id = (p_new ->> 'reporting_adjustment_id')::uuid
      where attempt.id = current_setting(
          'bloomjoy.nayax_journal_recovery_attempt_id', true
        )::uuid
        and attempt.refund_case_id = (p_old ->> 'id')::uuid
        and attempt.status = 'in_progress'
        and attempt.provider_outcome is null
        and attempt.provider_outcome_recorded_at is null
        and attempt.reporting_adjustment_id is null
        and (p_old ->> 'official_action_version')::bigint
          = authz.expected_case_version + 1
        and duplicate.duplicate_of_refund_case_id = (p_old ->> 'id')::uuid
        and duplicate.duplicate_marked_at is not null
        and duplicate.duplicate_marked_by is not null
        and exists (
          select 1 from public.refund_case_reconciliation_reviews review
          where review.left_refund_case_id = least((p_old ->> 'id')::uuid, duplicate.id)
            and review.right_refund_case_id = greatest((p_old ->> 'id')::uuid, duplicate.id)
            and review.status = 'confirmed_duplicate'
            and review.canonical_refund_case_id = (p_old ->> 'id')::uuid
            and review.resolution_reason_code = 'same_incident'
            and review.resolved_by = duplicate.duplicate_marked_by
            and review.resolved_at is not null
        )
        and adjustment.refund_case_id = (p_old ->> 'id')::uuid
        and adjustment.reporting_machine_id = (p_new ->> 'reporting_machine_id')::uuid
        and adjustment.reporting_location_id = (p_new ->> 'reporting_location_id')::uuid
        and adjustment.amount_cents = (p_new ->> 'refund_amount_cents')::integer
        and adjustment.source = 'refund_case'
        and adjustment.adjustment_type = 'refund'
        and adjustment.match_status = 'applied'
    )
    and (p_new - array[
      'status', 'manual_refund_reference', 'refund_completed_by',
      'refund_completed_at', 'automation_state', 'nayax_refund_execution_status',
      'reporting_adjustment_id', 'updated_at', 'official_action_version',
      'lifecycle_revision'
    ]::text[]) is not distinct from (p_old - array[
      'status', 'manual_refund_reference', 'refund_completed_by',
      'refund_completed_at', 'automation_state', 'nayax_refund_execution_status',
      'reporting_adjustment_id', 'updated_at', 'official_action_version',
      'lifecycle_revision'
    ]::text[]),
    false
  );
$$;

revoke all on function public.refund_journal_duplicate_recovery_case_change_allowed(jsonb, jsonb)
  from public, anon, authenticated, service_role;

comment on function public.refund_journal_duplicate_recovery_case_change_allowed(jsonb, jsonb) is
  'Allows only the proved journal recovery transition, before or after the exact lifecycle revision bump.';
