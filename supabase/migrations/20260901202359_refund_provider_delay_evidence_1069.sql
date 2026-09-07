-- #1069 PPV follow-up: a provider-delay update is valid only after a refund
-- decision has been approved and the provider result is still on the latest
-- confirmation hold. SLA-at-risk updates remain limited to undecided cases.

create or replace function public.guard_refund_customer_status_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  case_row public.refund_cases;
  automatic_contact_enabled boolean := false;
begin
  if new.message_type <> 'status_update'
    or new.delivery_kind is distinct from 'automatic' then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if new.refund_case_id is distinct from old.refund_case_id
      or new.message_type is distinct from old.message_type
      or new.recipient_email is distinct from old.recipient_email
      or new.subject is distinct from old.subject
      or new.body is distinct from old.body
      or new.template_key is distinct from old.template_key
      or new.content_source is distinct from old.content_source
      or new.delivery_kind is distinct from old.delivery_kind
      or new.reason_code is distinct from old.reason_code
      or new.template_version is distinct from old.template_version
      or new.follow_up_cycle_id is distinct from old.follow_up_cycle_id
      or new.requested_fields is distinct from old.requested_fields
      or new.created_at is distinct from old.created_at then
      raise exception 'Automatic customer status evidence is immutable'
        using errcode = '23514';
    end if;
    if old.status <> 'pending' and new.status is distinct from old.status then
      raise exception 'Delivered or uncertain status update cannot be retried'
        using errcode = '23514';
    end if;
    if old.status = 'pending'
      and new.status not in ('pending', 'sent', 'failed', 'skipped') then
      raise exception 'Invalid customer status delivery transition'
        using errcode = '23514';
    end if;
    if old.sent_at is not null and new.sent_at is distinct from old.sent_at then
      raise exception 'Customer status sent timestamp is immutable'
        using errcode = '23514';
    end if;
  end if;

  select refund_case.* into case_row
  from public.refund_cases refund_case
  where refund_case.id = new.refund_case_id
  for share;

  if case_row.id is null
    or lower(btrim(new.recipient_email)) <> lower(btrim(case_row.customer_email))
    or new.content_source <> 'deterministic_template'
    or new.reason_code not in ('provider_delay', 'sla_at_risk')
    or new.template_version <> 'refund_customer_status_v1'
    or new.follow_up_cycle_id is not null
    or cardinality(new.requested_fields) <> 0
    or (
      new.reason_code = 'provider_delay'
      and (
        case_row.status <> 'card_refund_pending'
        or case_row.decision is distinct from 'approved'
      )
    )
    or (
      new.reason_code = 'sla_at_risk'
      and (
        case_row.status not in ('submitted', 'needs_review', 'correlated')
        or case_row.decision is not null
      )
    ) then
    raise exception 'Automatic customer status update requires current deterministic evidence'
      using errcode = '23514';
  end if;

  if new.reason_code = 'provider_delay' and not exists (
    select 1
    from public.refund_case_nayax_refund_attempts attempt
    where attempt.refund_case_id = case_row.id
      and attempt.reconciliation_required is true
      and attempt.safe_transport_stage = 'confirmation_hold'
      and attempt.refund_operations_due_at <= statement_timestamp()
      and not exists (
        select 1
        from public.refund_case_nayax_refund_attempts later_attempt
        where later_attempt.refund_case_id = attempt.refund_case_id
          and (later_attempt.created_at, later_attempt.id) >
            (attempt.created_at, attempt.id)
      )
  ) then
    raise exception 'Provider-delay message requires the latest unresolved hold'
      using errcode = '23514';
  end if;

  if new.reason_code = 'sla_at_risk'
    and public.service_refund_business_days_elapsed(
      case_row.created_at,
      statement_timestamp(),
      'America/Los_Angeles'
    ) < 4 then
    raise exception 'SLA status update is not due'
      using errcode = '23514';
  end if;

  if (tg_op = 'INSERT' and new.status in ('pending', 'sent'))
    or (tg_op = 'UPDATE' and old.status = 'pending' and new.status = 'sent') then
    select settings.automatic_customer_contact_enabled
    into automatic_contact_enabled
    from public.refund_customer_contact_settings settings
    where settings.singleton
    for share;
    if not coalesce(automatic_contact_enabled, false) then
      raise exception 'Automatic customer contact is disabled'
        using errcode = '23514';
    end if;
  end if;

  if new.status = 'sent' and new.sent_at is null then
    raise exception 'Sent customer status update requires a sent timestamp'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_refund_customer_status_message()
  from public, anon, authenticated, service_role;

comment on function public.guard_refund_customer_status_message() is
  'Fail-closed customer status guard: provider-delay requires an approved pending refund with a current due confirmation hold; SLA-at-risk requires an undecided case.';

create or replace function public.guard_refund_provider_hold_customer_message()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.message_type is distinct from 'manual_note'
    and not (
      new.message_type is not distinct from 'status_update'
      and new.delivery_kind is not distinct from 'automatic'
      and new.content_source is not distinct from 'deterministic_template'
      and new.reason_code is not distinct from 'provider_delay'
      and new.template_version is not distinct from 'refund_customer_status_v1'
    )
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

revoke all on function public.guard_refund_provider_hold_customer_message()
  from public, anon, authenticated, service_role;

comment on function public.guard_refund_provider_hold_customer_message() is
  'Keeps provider-hold customer messages frozen except for the exact deterministic provider-delay envelope, which is independently validated against the latest due hold.';
