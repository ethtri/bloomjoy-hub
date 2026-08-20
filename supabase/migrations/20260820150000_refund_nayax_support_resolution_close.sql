-- #427: close the reviewed support-resolution window after the exact held
-- outcome is reconciled. This migration fails closed if an intent remains
-- pending or a completed resolution has not reached a sent customer reply.

do $$
declare
  active_operator_count bigint;
  completed_resolution_count bigint;
begin
  select count(*)
  into active_operator_count
  from public.refund_nayax_resolution_operators resolution_operator
  where resolution_operator.status = 'active'
    and resolution_operator.revoked_at is null;

  if active_operator_count <> 1 then
    raise exception 'Cannot close Nayax support resolution without exactly one active operator';
  end if;

  if exists (
    select 1
    from public.refund_nayax_resolution_intents intent
    where intent.status = 'pending'
  ) then
    raise exception 'Cannot close Nayax support resolution with a pending intent';
  end if;

  select count(*)
  into completed_resolution_count
  from public.refund_nayax_resolution_operators resolution_operator
  join public.refund_nayax_outcome_resolutions resolution
    on resolution.actor_user_id = resolution_operator.actor_user_id
   and resolution.created_at >= resolution_operator.approved_at
  join public.refund_case_nayax_refund_attempts attempt
    on attempt.id = resolution.nayax_refund_attempt_id
   and attempt.support_resolution_id = resolution.id
  where resolution_operator.status = 'active'
    and resolution_operator.revoked_at is null
    and resolution.resolution_result = 'provider_confirmed_success'
    and attempt.reporting_adjustment_id is not null
    and attempt.case_finalization_committed_at is not null
    and attempt.completion_delivery_status = 'sent'
    and attempt.completion_message_id is not null
    and attempt.completion_gmail_thread_id is not null;

  if completed_resolution_count <> 1 then
    raise exception 'Cannot close Nayax support resolution before exactly one confirmed refund is finalized and sent';
  end if;

  if exists (
    select 1
    from public.refund_nayax_resolution_operators resolution_operator
    join public.refund_nayax_outcome_resolutions resolution
      on resolution.actor_user_id = resolution_operator.actor_user_id
     and resolution.created_at >= resolution_operator.approved_at
    join public.refund_case_nayax_refund_attempts attempt
      on attempt.id = resolution.nayax_refund_attempt_id
    where resolution_operator.status = 'active'
      and resolution_operator.revoked_at is null
      and resolution.resolution_result in (
        'provider_confirmed_success',
        'documented_manual_completion'
      )
      and attempt.completion_delivery_status is distinct from 'sent'
  ) then
    raise exception 'Cannot close Nayax support resolution before customer completion is sent';
  end if;

  update public.refund_manager_totp_enrollments enrollment
  set status = 'revoked',
      enrollment_version = enrollment.enrollment_version + 1,
      revoked_at = statement_timestamp(),
      updated_at = statement_timestamp()
  where enrollment.status = 'active'
    and enrollment.revoked_at is null
    and exists (
      select 1
      from public.refund_nayax_resolution_operators resolution_operator
      where resolution_operator.actor_user_id = enrollment.actor_user_id
        and resolution_operator.status = 'active'
        and resolution_operator.revoked_at is null
    );

  update public.refund_nayax_resolution_operators resolution_operator
  set status = 'revoked',
      operator_version = resolution_operator.operator_version + 1,
      revoked_at = statement_timestamp(),
      updated_at = statement_timestamp()
  where resolution_operator.status = 'active'
    and resolution_operator.revoked_at is null;
end;
$$;

create or replace function public.refund_nayax_outcome_resolution_enabled()
returns boolean
language sql
immutable
set search_path = public
as $$
  select false;
$$;

revoke execute on function public.refund_nayax_outcome_resolution_enabled()
  from public, anon, authenticated, service_role;

comment on function public.refund_nayax_outcome_resolution_enabled() is
  'Nayax support-resolution window closed after #427 reconciliation; a new reviewed migration is required for any future activation.';
