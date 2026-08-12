-- Freeze manager decisions and customer outcome messages while Nayax has not
-- confirmed whether a card refund was sent. Live execution remains disabled.

create or replace function public.refund_nayax_provider_outcome_state(
  p_execution_status text
)
returns text
language sql
immutable
set search_path = public
as $$
  select case lower(btrim(coalesce(p_execution_status, '')))
    when 'requested' then 'unconfirmed'
    when 'failed' then 'unconfirmed'
    when 'ambiguous' then 'unconfirmed'
    when 'manual_review' then 'unconfirmed'
    when 'declined' then 'rejected'
    when 'approved' then 'succeeded'
    else 'not_attempted'
  end;
$$;

create or replace function public.guard_refund_provider_hold_case_update()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if public.refund_nayax_provider_outcome_state(
      old.nayax_refund_execution_status
    ) in ('unconfirmed', 'rejected')
    and row(
      old.status,
      old.decision,
      old.decision_reason,
      old.decided_by,
      old.decided_at,
      old.refund_amount_cents,
      old.manual_refund_reference,
      old.refund_completed_by,
      old.refund_completed_at,
      old.reporting_adjustment_id
    ) is distinct from row(
      new.status,
      new.decision,
      new.decision_reason,
      new.decided_by,
      new.decided_at,
      new.refund_amount_cents,
      new.manual_refund_reference,
      new.refund_completed_by,
      new.refund_completed_at,
      new.reporting_adjustment_id
    )
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

drop trigger if exists refund_cases_guard_provider_hold_decisions
  on public.refund_cases;
create trigger refund_cases_guard_provider_hold_decisions
before update on public.refund_cases
for each row execute function public.guard_refund_provider_hold_case_update();

create or replace function public.guard_refund_provider_hold_customer_message()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.message_type <> 'manual_note'
    and exists (
      select 1
      from public.refund_cases refund_case
      where refund_case.id = new.refund_case_id
        and public.refund_nayax_provider_outcome_state(
          refund_case.nayax_refund_execution_status
        ) in ('unconfirmed', 'rejected')
    ) then
    raise exception 'Nayax provider outcome pauses customer messages for payment support';
  end if;

  return new;
end;
$$;

drop trigger if exists refund_case_messages_guard_provider_hold
  on public.refund_case_messages;
create trigger refund_case_messages_guard_provider_hold
before insert on public.refund_case_messages
for each row execute function public.guard_refund_provider_hold_customer_message();

create or replace function public.admin_get_refund_email_queue_states()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  actor_user_id uuid := auth.uid();
begin
  if actor_user_id is null then
    raise exception 'Authentication required';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'caseId', refund_case.id,
      'intakeSource', refund_case.intake_source,
      'exactCasePath', '/refunds?case=' || refund_case.id::text,
      'missingInformation', refund_case.status in ('draft', 'waiting_on_customer'),
      'possibleDuplicate', public.refund_case_has_unresolved_reconciliation(refund_case.id),
      'confirmedDuplicate', refund_case.duplicate_of_refund_case_id is not null,
      'duplicateOfCaseId', refund_case.duplicate_of_refund_case_id,
      'aging', exists (
        select 1
        from public.refund_manager_attention_states attention
        where attention.refund_case_id = refund_case.id
          and attention.attention_started_at is not null
          and attention.delivery_review_required_at is null
          and public.refund_case_requires_manager_attention(refund_case.status)
          and refund_case.status not in (
            'draft', 'waiting_on_customer', 'denied', 'completed', 'closed'
          )
          and attention.case_status = refund_case.status
          and attention.correlation_status = refund_case.correlation_status
          and attention.decision is not distinct from refund_case.decision
          and attention.deterministic_fact_version = refund_case.deterministic_fact_version
          and public.service_refund_business_days_elapsed(
            attention.attention_started_at,
            statement_timestamp(),
            'America/Los_Angeles'
          ) >= 2
      ),
      'providerHold', public.refund_nayax_provider_outcome_state(
        refund_case.nayax_refund_execution_status
      ) = 'unconfirmed',
      'providerOutcome', public.refund_nayax_provider_outcome_state(
        refund_case.nayax_refund_execution_status
      ),
      'actionBlocked', refund_case.duplicate_of_refund_case_id is not null
        or public.refund_case_has_unresolved_reconciliation(refund_case.id),
      'payloadRedacted', true
    ) order by refund_case.updated_at desc, refund_case.id)
    from public.refund_cases refund_case
    where public.can_manage_refund_case(actor_user_id, refund_case.id)
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.admin_get_refund_email_queue_states()
  from public, anon;
grant execute on function public.admin_get_refund_email_queue_states()
  to authenticated, service_role;

comment on function public.admin_get_refund_email_queue_states() is
  'Returns manager-scoped website/email queue signals, sanitized provider outcome state, and exact internal paths without customer identifiers.';

comment on function public.guard_refund_provider_hold_case_update() is
  'Freezes unconfirmed and provider-rejected refund decisions. Releasing a case requires a future audited payment-support migration; no session bypass exists after rejection.';

comment on function public.guard_refund_provider_hold_customer_message() is
  'Pauses customer outcome messages for unconfirmed and provider-rejected refunds until a future audited payment-support resolution path exists.';

select pg_notify('pgrst', 'reload schema');
