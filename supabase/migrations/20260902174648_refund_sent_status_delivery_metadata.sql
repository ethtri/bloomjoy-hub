-- #628/#917: preserve immutable historical send evidence while recording only
-- provider delivery metadata. Repeat the pre-backfill guard from 0700 after
-- the existing 1069 migration so fresh and populated upgrades converge.

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
  -- An existing automatic status message cannot escape its immutable evidence
  -- checks by changing the discriminators used by the early return below.
  if tg_op = 'UPDATE' then
    if old.message_type = 'status_update'
      and old.delivery_kind = 'automatic'
      and (
        new.message_type is distinct from old.message_type
        or new.delivery_kind is distinct from old.delivery_kind
      ) then
      raise exception 'Automatic customer status evidence is immutable'
        using errcode = '23514';
    end if;
  end if;

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
    -- Historical SENT messages retain their original send evidence after the
    -- case advances. Delivery-only bookkeeping must not authorize a new send
    -- or revalidate the old send against today's case/contact state.
    if old.status = 'sent'
      and new.status = 'sent'
      and old.sent_at is not null
      and new.sent_at is not distinct from old.sent_at
      -- Before a provider identity exists, only the historical unknown
      -- backfill or the first accepted provider binding is bookkeeping.
      and old.provider_message_id is null
      and (
        (
          old.delivery_transport is null
          and new.delivery_transport = 'resend'
          and new.provider_message_id is null
          and new.delivery_state = 'unknown'
          and new.delivery_state_updated_at
            is not distinct from coalesce(old.sent_at, old.created_at)
        )
        or (
          old.delivery_transport = 'resend'
          and new.delivery_transport = 'resend'
          and old.delivery_state = 'unknown'
          and new.provider_message_id is not null
          and new.delivery_state = 'accepted'
          and new.delivery_state_updated_at >= old.delivery_state_updated_at
        )
      )
      and (
        to_jsonb(new) - array[
          'delivery_transport', 'provider_message_id',
          'delivery_state', 'delivery_state_updated_at'
        ]::text[]
      ) is not distinct from (
        to_jsonb(old) - array[
          'delivery_transport', 'provider_message_id',
          'delivery_state', 'delivery_state_updated_at'
        ]::text[]
      ) then
      return new;
    end if;

    -- A verified provider event may change delivery outcome after the case
    -- advances or contact closes. It cannot change provider binding, original
    -- sent time, immutable message evidence, or authorize a new send.
    if old.delivery_transport = 'resend'
      and old.provider_message_id is not null
      and old.status in ('pending', 'sent', 'failed') then
      if to_jsonb(new)
          - 'status' - 'error_message' - 'delivery_state' - 'delivery_state_updated_at'
        is not distinct from to_jsonb(old)
          - 'status' - 'error_message' - 'delivery_state' - 'delivery_state_updated_at'
        and public.refund_transactional_delivery_state_rank(new.delivery_state)
          >= public.refund_transactional_delivery_state_rank(old.delivery_state)
        and new.delivery_state_updated_at >= old.delivery_state_updated_at
        and new.status = (case
          when new.delivery_state in ('failed', 'bounced', 'complained') then 'failed'
          else old.status end)
        and new.error_message is not distinct from (case new.delivery_state
          when 'failed' then 'transactional_delivery_failed'
          when 'bounced' then 'transactional_delivery_bounced'
          when 'complained' then 'transactional_delivery_complained'
          else old.error_message end)
        and exists (
          select 1 from public.refund_transactional_delivery_events event
          where event.provider_message_id = old.provider_message_id
            and event.delivery_state = new.delivery_state
            and event.event_at <= new.delivery_state_updated_at
        ) then
        return new;
      end if;
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

-- Dispatch updates even when an existing automatic status message changes its
-- type; the function itself safely ignores unrelated message rows.
create or replace trigger refund_case_messages_customer_status_guard
before insert or update on public.refund_case_messages
for each row
execute function public.guard_refund_customer_status_message();
