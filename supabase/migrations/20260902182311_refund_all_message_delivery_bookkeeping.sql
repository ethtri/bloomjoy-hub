-- #628/#917: delivery-only history must not replay present-day send gates.
-- This private predicate neither authorizes a send nor changes any row. VOLATILE
-- is required to see the redacted event inserted earlier in the same RPC.
create or replace function public.is_refund_message_delivery_bookkeeping(
  p_old jsonb, p_new jsonb
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_old ->> 'id' is null or p_old ->> 'refund_case_id' is null then
    return false;
  end if;

  if p_old ->> 'status' = 'sent'
    and p_new ->> 'status' = 'sent'
    and p_old ->> 'sent_at' is not null
    and p_new ->> 'sent_at' is not distinct from p_old ->> 'sent_at'
    and p_old ->> 'provider_message_id' is null
    and (
      (
        p_old ->> 'delivery_transport' is null
        and p_new ->> 'delivery_transport' = 'resend'
        and p_new ->> 'provider_message_id' is null
        and p_new ->> 'delivery_state' = 'unknown'
        and (p_new ->> 'delivery_state_updated_at')::timestamptz
          is not distinct from coalesce(
            (p_old ->> 'sent_at')::timestamptz,
            (p_old ->> 'created_at')::timestamptz
          )
      )
      or (
        p_old ->> 'delivery_transport' = 'resend'
        and p_new ->> 'delivery_transport' = 'resend'
        and p_old ->> 'delivery_state' = 'unknown'
        and p_new ->> 'provider_message_id' is not null
        and p_new ->> 'delivery_state' = 'accepted'
        and (p_new ->> 'delivery_state_updated_at')::timestamptz
          >= (p_old ->> 'delivery_state_updated_at')::timestamptz
      )
    )
    and (p_new - array[
      'delivery_transport', 'provider_message_id',
      'delivery_state', 'delivery_state_updated_at'
    ]::text[]) is not distinct from (p_old - array[
      'delivery_transport', 'provider_message_id',
      'delivery_state', 'delivery_state_updated_at'
    ]::text[]) then
    return true;
  end if;

  -- Keep this branch separate: the historical backfill runs before the event
  -- table/rank function exist. Resolve them only for an already-bound message.
  if p_old ->> 'delivery_transport' = 'resend'
    and p_old ->> 'provider_message_id' is not null
    and p_old ->> 'status' in ('pending', 'sent', 'failed') then
    if (p_new - array[
        'status', 'error_message', 'delivery_state', 'delivery_state_updated_at'
      ]::text[]) is not distinct from (p_old - array[
        'status', 'error_message', 'delivery_state', 'delivery_state_updated_at'
      ]::text[])
      and public.refund_transactional_delivery_state_rank(p_new ->> 'delivery_state')
        >= public.refund_transactional_delivery_state_rank(p_old ->> 'delivery_state')
      and (p_new ->> 'delivery_state_updated_at')::timestamptz
        >= (p_old ->> 'delivery_state_updated_at')::timestamptz
      and p_new ->> 'status' = (case
        when p_new ->> 'delivery_state' in ('failed', 'bounced', 'complained')
          then 'failed'
        else p_old ->> 'status' end)
      and p_new ->> 'error_message' is not distinct from (case p_new ->> 'delivery_state'
        when 'failed' then 'transactional_delivery_failed'
        when 'bounced' then 'transactional_delivery_bounced'
        when 'complained' then 'transactional_delivery_complained'
        else p_old ->> 'error_message' end)
      and exists (
        select 1 from public.refund_transactional_delivery_events event
        where event.provider_message_id = p_old ->> 'provider_message_id'
          and event.delivery_state = p_new ->> 'delivery_state'
          and (p_new ->> 'delivery_state_updated_at')::timestamptz
            is not distinct from greatest(
              coalesce((p_old ->> 'delivery_state_updated_at')::timestamptz, '-infinity'::timestamptz),
              coalesce(event.event_at, '-infinity'::timestamptz)
            )
      ) then
      return true;
    end if;
  end if;
  return false;
end;
$$;

revoke all on function public.is_refund_message_delivery_bookkeeping(jsonb, jsonb)
  from public, anon, authenticated, service_role;

-- A transport failure does not erase the fact that the original message was
-- sent. Recognize only its exact bound, recorded terminal provider evidence.
create or replace function public.is_refund_message_recorded_delivery_failure(
  p_message jsonb
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_message ->> 'status' = 'failed'
    and p_message ->> 'sent_at' is not null
    and p_message ->> 'delivery_transport' = 'resend'
    and p_message ->> 'provider_message_id' is not null
    and p_message ->> 'delivery_state' in ('failed', 'bounced', 'complained')
    and p_message ->> 'error_message' = (case p_message ->> 'delivery_state'
      when 'failed' then 'transactional_delivery_failed'
      when 'bounced' then 'transactional_delivery_bounced'
      when 'complained' then 'transactional_delivery_complained' end) then
    return exists (
      select 1 from public.refund_transactional_delivery_events event
      where event.provider_message_id = p_message ->> 'provider_message_id'
        and event.matched_refund_case_message_id = (p_message ->> 'id')::uuid
        and event.delivery_state = p_message ->> 'delivery_state'
        and event.event_at <= (p_message ->> 'delivery_state_updated_at')::timestamptz
    );
  end if;
  return false;
end;
$$;

revoke all on function public.is_refund_message_recorded_delivery_failure(jsonb)
  from public, anon, authenticated, service_role;

create or replace function public.guard_nayax_attempt_completion_message()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- Immutable history can receive exact delivery bookkeeping after the case
  -- advances; every new send and non-delivery edit still uses the guards below.
  if tg_op = 'UPDATE'
    and current_user not in ('anon', 'authenticated', 'service_role') then
    if public.is_refund_message_delivery_bookkeeping(to_jsonb(old), to_jsonb(new)) then
      return new;
    end if;
  end if;

  if tg_op <> 'DELETE'
    and new.message_type in ('approved', 'completed')
    and exists (
      select 1
      from public.refund_cases refund_case
      where refund_case.id = new.refund_case_id
        and refund_case.payment_method = 'card'
    )
    and (
      new.message_type <> 'completed'
      or new.nayax_refund_attempt_id is null
      or not exists (
        select 1
        from public.refund_case_nayax_refund_attempts attempt
        join public.refund_cases refund_case
          on refund_case.id = attempt.refund_case_id
        where attempt.id = new.nayax_refund_attempt_id
          and attempt.refund_case_id = new.refund_case_id
          and attempt.status = 'succeeded'
          and attempt.provider_outcome = 'success'
          and attempt.reconciliation_required = false
          and attempt.reporting_adjustment_id is not null
          and attempt.case_finalization_committed_at is not null
          and refund_case.status = 'completed'
          and refund_case.reporting_adjustment_id = attempt.reporting_adjustment_id
      )
    ) then
    raise exception 'Card success messages require committed token-bound provider settlement';
  end if;

  if current_user in ('anon', 'authenticated', 'service_role')
    and (
      (tg_op <> 'INSERT' and old.nayax_refund_attempt_id is not null)
      or (tg_op <> 'DELETE' and new.nayax_refund_attempt_id is not null)
    ) then
    raise exception 'Nayax completion messages are orchestration-wrapper owned';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke all on function public.guard_nayax_attempt_completion_message()
  from public, anon, authenticated, service_role;

create or replace function public.guard_refund_legacy_state_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Immutable history can receive exact delivery bookkeeping after the case
  -- advances; every new send and non-delivery edit still uses the guards below.
  if tg_op = 'UPDATE'
    and public.is_refund_message_delivery_bookkeeping(to_jsonb(old), to_jsonb(new)) then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    perform 1
    from public.refund_cases refund_case
    where refund_case.id in (old.refund_case_id, new.refund_case_id)
    order by refund_case.id
    for update;

    if public.refund_case_legacy_state_review_required(old.refund_case_id) then
      raise exception 'Run a fresh transaction check before any customer message';
    end if;
  else
    perform 1
    from public.refund_cases refund_case
    where refund_case.id = new.refund_case_id
    for update;
  end if;

  if new.message_type <> 'manual_note'
    and public.refund_case_legacy_state_review_required(new.refund_case_id) then
    raise exception 'Run a fresh transaction check before any customer message';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_refund_legacy_state_message()
  from public, anon, authenticated, service_role;

create or replace function public.guard_refund_denial_appeal_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  appeal_row public.refund_case_appeals;
  case_row public.refund_cases;
  automatic_contact_enabled boolean := false;
  attempting_delivery boolean := false;
  reconciling_known_gmail_delivery boolean := false;
begin
  -- Immutable history can receive exact delivery bookkeeping after the case
  -- advances; every new send and non-delivery edit still uses the guards below.
  if tg_op = 'UPDATE'
    and public.is_refund_message_delivery_bookkeeping(to_jsonb(old), to_jsonb(new)) then
    return new;
  end if;

  if new.message_type <> 'appeal_received' then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if old.message_type <> 'appeal_received'
      or new.refund_case_id is distinct from old.refund_case_id
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
      or new.appeal_id is distinct from old.appeal_id
      or new.created_at is distinct from old.created_at then
      raise exception 'Automatic appeal receipt evidence is immutable'
        using errcode = '23514';
    end if;
    if old.status <> 'pending' and new.status is distinct from old.status then
      raise exception 'Delivered or uncertain appeal receipt cannot be retried'
        using errcode = '23514';
    end if;
    if old.status = 'pending'
      and new.status not in ('pending', 'sent', 'failed', 'skipped') then
      raise exception 'Invalid appeal receipt delivery transition'
        using errcode = '23514';
    end if;
    if old.sent_at is not null and new.sent_at is distinct from old.sent_at then
      raise exception 'Appeal receipt sent timestamp is immutable'
        using errcode = '23514';
    end if;
  end if;

  select appeal.* into appeal_row
  from public.refund_case_appeals appeal
  where appeal.id = new.appeal_id
  for share;

  select refund_case.* into case_row
  from public.refund_cases refund_case
  where refund_case.id = new.refund_case_id
  for share;

  if appeal_row.id is null
    or appeal_row.refund_case_id <> new.refund_case_id
    or case_row.id is null
    or case_row.status <> 'needs_review'
    or case_row.decision is not null
    or case_row.automation_state <> 'appeal_received'
    or lower(btrim(new.recipient_email)) <> lower(btrim(case_row.customer_email))
    or new.content_source <> 'deterministic_template'
    or new.delivery_kind <> 'automatic'
    or new.reason_code <> 'denial_appeal'
    or new.template_version <> 'refund_appeal_received_v1'
    or new.template_key <> 'refund_appeal_received_v1'
    or new.follow_up_cycle_id is not null
    or cardinality(new.requested_fields) <> 0 then
    raise exception 'Appeal receipt requires current same-case deterministic evidence'
      using errcode = '23514';
  end if;

  if tg_op = 'UPDATE'
    and old.status = 'pending'
    and new.status = 'sent' then
    select exists (
      select 1
      from public.refund_gmail_messages gmail_message
      where gmail_message.refund_case_message_id = new.id
        and gmail_message.refund_case_id = new.refund_case_id
        and gmail_message.direction = 'outbound'
        and gmail_message.status = 'sent'
        and gmail_message.sent_at is not null
    ) into reconciling_known_gmail_delivery;
  end if;

  attempting_delivery := case
    when tg_op = 'INSERT' then new.status in ('pending', 'sent')
    else old.status = 'pending' and new.status = 'sent'
      and not reconciling_known_gmail_delivery
  end;
  if attempting_delivery then
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
    raise exception 'Sent appeal receipt requires a sent timestamp'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_refund_denial_appeal_message()
  from public, anon, authenticated, service_role;

create or replace function public.guard_refund_follow_up_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  cycle_row public.refund_follow_up_cycles;
  case_row public.refund_cases;
  expected_missing text[] := '{}'::text[];
  expected_request_type text;
  automatic_contact_enabled boolean := false;
  attempting_automatic_delivery boolean := false;
  reconciling_known_gmail_delivery boolean := false;
begin
  -- Immutable history can receive exact delivery bookkeeping after the case
  -- advances; every new send and non-delivery edit still uses the guards below.
  if tg_op = 'UPDATE'
    and public.is_refund_message_delivery_bookkeeping(to_jsonb(old), to_jsonb(new)) then
    return new;
  end if;

  if tg_op = 'UPDATE' and old.delivery_kind = 'automatic' then
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
      raise exception 'Automatic customer message evidence is immutable'
        using errcode = '23514';
    end if;

    if old.status <> 'pending' and new.status is distinct from old.status then
      raise exception 'Delivered or failed automatic message cannot be retried'
        using errcode = '23514';
    end if;
    if old.status = 'pending'
      and new.status not in ('pending', 'sent', 'failed', 'skipped') then
      raise exception 'Invalid automatic message delivery transition'
        using errcode = '23514';
    end if;
    if old.sent_at is not null and new.sent_at is distinct from old.sent_at then
      raise exception 'Automatic message sent timestamp is immutable'
        using errcode = '23514';
    end if;
  end if;

  if tg_op = 'INSERT'
    and new.message_type in ('no_safe_match', 'information_received')
    and new.delivery_kind is distinct from 'automatic' then
    raise exception 'Reserved deterministic follow-up class requires automatic cycle evidence'
      using errcode = '23514';
  end if;

  if new.delivery_kind = 'manual'
    and new.message_type = 'more_info'
    and (
      (tg_op = 'INSERT' and new.status in ('pending', 'sent'))
      or (tg_op = 'UPDATE' and old.status = 'pending' and new.status = 'sent')
    ) then
    select * into case_row
    from public.refund_cases
    where id = new.refund_case_id
    for share;
    expected_missing := coalesce(
      public.refund_missing_follow_up_fields(new.refund_case_id),
      '{}'::text[]
    );
    if case_row.id is null
      or case_row.status in ('approved', 'denied', 'completed', 'closed')
      or case_row.decision is not null
      or case_row.card_wallet_used is true
      or cardinality(expected_missing) = 0
      or new.requested_fields <> expected_missing then
      raise exception 'Manual missing-information message requires the current exact server-derived fields'
        using errcode = '23514';
    end if;
  end if;

  if new.delivery_kind is distinct from 'automatic' then
    return new;
  end if;

  if tg_op = 'UPDATE'
    and old.status = 'pending'
    and new.status = 'sent' then
    select exists (
      select 1
      from public.refund_gmail_messages gmail_message
      where gmail_message.refund_case_message_id = new.id
        and gmail_message.refund_case_id = new.refund_case_id
        and gmail_message.direction = 'outbound'
        and gmail_message.status = 'sent'
        and gmail_message.sent_at is not null
    ) into reconciling_known_gmail_delivery;
  end if;

  if tg_op = 'INSERT' then
    attempting_automatic_delivery := new.status in ('pending', 'sent');
  elsif tg_op = 'UPDATE' then
    attempting_automatic_delivery := old.status = 'pending'
      and new.status = 'sent'
      and not reconciling_known_gmail_delivery;
  end if;

  if attempting_automatic_delivery then
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

  if new.message_type in ('wallet_correction', 'wallet_correction_reminder') then
    if not attempting_automatic_delivery then
      return new;
    end if;
    select * into case_row
    from public.refund_cases
    where id = new.refund_case_id
    for share;

    if case_row.id is null
      or lower(btrim(new.recipient_email)) <> lower(btrim(case_row.customer_email))
      or case_row.payment_method <> 'card'
      or case_row.card_wallet_used is not true
      or case_row.status in ('approved', 'denied', 'completed', 'closed')
      or case_row.decision is not null
      or case_row.wallet_correction_state <> 'sent'
      or case_row.wallet_correction_version not between 1 and 2
      or new.content_source <> 'deterministic_template'
      or new.reason_code is not null
      or new.follow_up_cycle_id is not null
      or cardinality(new.requested_fields) <> 0
      or new.template_version <> (case new.message_type
        when 'wallet_correction' then 'refund_wallet_correction_v1'
        else 'refund_wallet_correction_reminder_v1'
      end)
      or not exists (
        select 1
        from public.refund_wallet_correction_contexts context
        where context.refund_case_id = case_row.id
          and context.version = case_row.wallet_correction_version
          and context.status = 'pending'
          and context.expires_at > statement_timestamp()
      ) then
      raise exception 'Automatic wallet-correction message requires current versioned secure-link evidence'
        using errcode = '23514';
    end if;
    if new.status = 'sent' and new.sent_at is null then
      raise exception 'Sent automatic wallet-correction message requires a sent timestamp'
        using errcode = '23514';
    end if;
    return new;
  end if;

  select * into cycle_row
  from public.refund_follow_up_cycles
  where id = new.follow_up_cycle_id
  for update;

  if cycle_row.id is null then
    raise exception 'Automatic follow-up message requires a valid cycle'
      using errcode = '23514';
  end if;

  select * into case_row
  from public.refund_cases
  where id = new.refund_case_id
  for share;

  if attempting_automatic_delivery and (
    case_row.status in ('approved', 'denied', 'completed', 'closed')
    or case_row.decision is not null
  ) then
    raise exception 'Terminal refund case cannot receive automatic follow-up'
      using errcode = '23514';
  end if;

  if cycle_row.refund_case_id <> new.refund_case_id
    or lower(btrim(new.recipient_email)) <> lower(btrim(case_row.customer_email))
    or new.content_source <> 'deterministic_template'
    or new.reason_code <> cycle_row.reason_code
    or new.template_version <> cycle_row.template_version
    or new.requested_fields <> cycle_row.requested_fields then
    raise exception 'Automatic follow-up message evidence does not match its cycle'
      using errcode = '23514';
  end if;

  expected_request_type := case cycle_row.reason_code
    when 'missing_information' then 'more_info'
    when 'no_safe_match' then 'no_safe_match'
  end;

  if attempting_automatic_delivery
    and new.message_type in (expected_request_type, 'reminder') then
    if case_row.deterministic_fact_version <> cycle_row.case_fact_version then
      raise exception 'Automatic follow-up message facts became stale before delivery'
        using errcode = '23514';
    end if;
    expected_missing := coalesce(
      public.refund_missing_follow_up_fields(new.refund_case_id),
      '{}'::text[]
    );
    if cycle_row.reason_code = 'missing_information'
      and (
        case_row.card_wallet_used is true
        or expected_missing <> cycle_row.requested_fields
      ) then
      raise exception 'Automatic missing-information evidence became stale before delivery'
        using errcode = '23514';
    end if;
    if cycle_row.reason_code = 'no_safe_match'
      and (
        cardinality(expected_missing) <> 0
        or not (
          (
            case_row.payment_method = 'card'
            and case_row.card_wallet_used is false
            and case_row.correlation_status = 'no_match'
            and case_row.correlation_source = 'nayax'
            and case_row.nayax_recommendation_state = 'no_safe_match'
            and nullif(btrim(coalesce(case_row.nayax_recommendation_policy_version, '')), '') is not null
            and case_row.nayax_recommendation_evaluated_at is not null
            and case_row.nayax_recommendation_evaluated_at >= case_row.deterministic_facts_updated_at
            and case_row.nayax_match_execution_eligible is not true
            and case_row.matched_nayax_transaction_id is null
          )
          or (
            case_row.payment_method = 'cash'
            and case_row.card_wallet_used is false
            and case_row.correlation_status = 'no_match'
            and case_row.correlation_source = 'sunze'
            and nullif(btrim(coalesce(case_row.correlation_summary, '')), '') is not null
            and case_row.matched_sales_fact_id is null
            and case_row.cash_match_evaluated_fact_version = case_row.deterministic_fact_version
            and case_row.matched_nayax_transaction_id is null
            and case_row.nayax_match_execution_eligible is not true
          )
        )
      ) then
      raise exception 'Automatic no-safe-match evidence became stale before delivery'
        using errcode = '23514';
    end if;
  end if;

  if new.message_type = expected_request_type then
    if cycle_row.status <> 'claimed'
      or (cycle_row.request_message_id is not null and cycle_row.request_message_id <> new.id) then
      raise exception 'Follow-up request is no longer claimable'
        using errcode = '23514';
    end if;
    if attempting_automatic_delivery
      and cycle_row.source_customer_message_id is not null and exists (
      select 1
      from public.refund_gmail_messages newer_message
      join public.refund_gmail_messages source_message
        on source_message.id = cycle_row.source_customer_message_id
      where newer_message.refund_case_id = cycle_row.refund_case_id
        and newer_message.direction = 'inbound'
        and newer_message.message_kind = 'message'
        and newer_message.status = 'received'
        and newer_message.participant_role = 'customer'
        and newer_message.participant_trust = 'verified'
        and newer_message.content_deleted_at is null
        and (newer_message.received_at, newer_message.id)
          > (source_message.received_at, source_message.id)
    ) then
      raise exception 'A newer verified customer message superseded this request'
        using errcode = '23514';
    end if;
    if attempting_automatic_delivery
      and cycle_row.source_customer_message_id is null and exists (
      select 1
      from public.refund_gmail_messages newer_message
      where newer_message.refund_case_id = cycle_row.refund_case_id
        and newer_message.direction = 'inbound'
        and newer_message.message_kind = 'message'
        and newer_message.status = 'received'
        and newer_message.participant_role = 'customer'
        and newer_message.participant_trust = 'verified'
        and newer_message.content_deleted_at is null
        and newer_message.received_at > cycle_row.created_at
    ) then
      raise exception 'A newer verified customer message superseded this request'
        using errcode = '23514';
    end if;
  elsif new.message_type = 'reminder' then
    -- Historical send evidence may survive a later bounce, but it cannot
    -- authorize another automatic reminder to the failed destination.
    if attempting_automatic_delivery and not exists (
      select 1 from public.refund_case_messages request
      where request.id = cycle_row.request_message_id
        and request.refund_case_id = new.refund_case_id
        and request.follow_up_cycle_id = cycle_row.id
        and request.status = 'sent'
        and request.sent_at = cycle_row.request_sent_at
        and request.delivery_state not in ('failed', 'bounced', 'complained')
    ) then
      raise exception 'Follow-up reminder requires a non-failed original request'
        using errcode = '23514';
    end if;
    if cycle_row.status <> 'waiting'
      or cycle_row.request_sent_at is null
      or cycle_row.reminder_due_at is null
      or cycle_row.reminder_due_at > statement_timestamp()
      or cycle_row.reminder_claimed_at is null
      or cycle_row.reply_customer_message_id is not null
      or (cycle_row.reminder_message_id is not null and cycle_row.reminder_message_id <> new.id) then
      raise exception 'Follow-up reminder is not due or was already claimed'
        using errcode = '23514';
    end if;
    if attempting_automatic_delivery and exists (
      select 1
      from public.refund_gmail_messages newer_message
      where newer_message.refund_case_id = cycle_row.refund_case_id
        and newer_message.direction = 'inbound'
        and newer_message.message_kind = 'message'
        and newer_message.status = 'received'
        and newer_message.participant_role = 'customer'
        and newer_message.participant_trust = 'verified'
        and newer_message.content_deleted_at is null
        and newer_message.received_at > cycle_row.request_sent_at
    ) then
      raise exception 'A verified customer reply superseded this reminder'
        using errcode = '23514';
    end if;
  elsif new.message_type = 'information_received' then
    if cycle_row.status <> 'customer_replied'
      or cycle_row.reply_customer_message_id is null
      or (cycle_row.receipt_message_id is not null and cycle_row.receipt_message_id <> new.id) then
      raise exception 'Information-received receipt requires one verified customer reply'
        using errcode = '23514';
    end if;
  else
    raise exception 'Unsupported automatic follow-up message class'
      using errcode = '23514';
  end if;

  if new.status = 'sent' and new.sent_at is null then
    raise exception 'Sent automatic message requires a sent timestamp'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_refund_follow_up_message()
  from public, anon, authenticated, service_role;

create or replace function public.sync_refund_follow_up_cycle_from_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  cycle_row public.refund_follow_up_cycles;
  is_request boolean;
begin
  -- A later verified transport failure cannot rewind a historical sent cycle.
  -- Keep genuine pending-send failures on the original bookkeeping path.
  if tg_op = 'UPDATE'
    and old.status in ('sent', 'failed')
    and old.sent_at is not null
    and new.sent_at is not distinct from old.sent_at
    and public.is_refund_message_delivery_bookkeeping(to_jsonb(old), to_jsonb(new)) then
    return new;
  end if;

  if new.delivery_kind is distinct from 'automatic'
    or new.follow_up_cycle_id is null then
    return new;
  end if;

  if tg_op = 'UPDATE'
    and new.status is not distinct from old.status
    and new.sent_at is not distinct from old.sent_at then
    return new;
  end if;

  select * into cycle_row
  from public.refund_follow_up_cycles
  where id = new.follow_up_cycle_id
  for update;

  is_request := new.message_type in ('more_info', 'no_safe_match');

  if is_request then
    update public.refund_follow_up_cycles
    set
      request_message_id = coalesce(request_message_id, new.id),
      request_created_at = coalesce(request_created_at, new.created_at),
      request_sent_at = case
        when new.status = 'sent' then coalesce(request_sent_at, new.sent_at)
        else request_sent_at
      end,
      reminder_due_at = case
        when new.status = 'sent' then coalesce(
          reminder_due_at,
          new.sent_at + make_interval(hours => reminder_delay_hours)
        )
        else reminder_due_at
      end,
      status = case
        when new.status = 'sent' then 'waiting'
        when new.status in ('failed', 'skipped') then 'failed'
        else status
      end,
      failed_message_id = case
        when new.status in ('failed', 'skipped') then coalesce(failed_message_id, new.id)
        else failed_message_id
      end,
      failed_at = case
        when new.status in ('failed', 'skipped') then coalesce(failed_at, statement_timestamp())
        else failed_at
      end,
      failure_code = case
        when new.status in ('failed', 'skipped') then coalesce(
          failure_code,
          replace(new.message_type, '-', '_') || '_' || new.status
        )
        else failure_code
      end
    where id = cycle_row.id;
  elsif new.message_type = 'reminder' then
    update public.refund_follow_up_cycles
    set
      reminder_message_id = coalesce(reminder_message_id, new.id),
      reminder_created_at = coalesce(reminder_created_at, new.created_at),
      reminder_sent_at = case
        when new.status = 'sent' then coalesce(reminder_sent_at, new.sent_at)
        else reminder_sent_at
      end,
      status = case
        when new.status in ('failed', 'skipped') then 'failed'
        else status
      end,
      failed_message_id = case
        when new.status in ('failed', 'skipped') then coalesce(failed_message_id, new.id)
        else failed_message_id
      end,
      failed_at = case
        when new.status in ('failed', 'skipped') then coalesce(failed_at, statement_timestamp())
        else failed_at
      end,
      failure_code = case
        when new.status in ('failed', 'skipped') then coalesce(failure_code, 'reminder_' || new.status)
        else failure_code
      end
    where id = cycle_row.id;
  elsif new.message_type = 'information_received' then
    update public.refund_follow_up_cycles
    set
      receipt_message_id = coalesce(receipt_message_id, new.id),
      receipt_created_at = coalesce(receipt_created_at, new.created_at),
      receipt_sent_at = case
        when new.status = 'sent' then coalesce(receipt_sent_at, new.sent_at)
        else receipt_sent_at
      end,
      status = case
        -- A receipt can finish after the structured recheck in a second
        -- worker. Settle the cycle as soon as both immutable facts exist so a
        -- crash/retry ordering cannot strand it in customer_replied forever.
        when cycle_row.status = 'customer_replied'
          and new.status = 'sent'
          and cycle_row.recheck_claimed_at is not null
          then 'closed'
        when cycle_row.status = 'customer_replied'
          and new.status in ('failed', 'skipped')
          and cycle_row.recheck_claimed_at is not null
          then 'manual_review'
        else status
      end
    where id = cycle_row.id;
  end if;

  if new.status = 'sent' and is_request then
    update public.refund_cases
    set
      -- Gmail drafts intentionally remain drafts until their required intake
      -- facts are complete. automation_state is the waiting-state source of
      -- truth for those incomplete cases.
      status = case
        when status = 'draft' then status
        else 'waiting_on_customer'
      end,
      automation_state = case
        when new.message_type = 'no_safe_match' then 'under_review'
        else 'more_info_needed'
      end,
      automation_follow_up_due_at = new.sent_at + make_interval(hours => cycle_row.reminder_delay_hours),
      customer_last_contacted_at = new.sent_at,
      last_customer_message_type = new.message_type
    where id = cycle_row.refund_case_id
      and status not in ('approved', 'denied', 'completed', 'closed');
  elsif new.status = 'sent' and new.message_type = 'reminder' then
    update public.refund_cases
    set
      automation_follow_up_due_at = null,
      customer_last_contacted_at = new.sent_at,
      last_customer_message_type = new.message_type
    where id = cycle_row.refund_case_id
      and status not in ('approved', 'denied', 'completed', 'closed');
  elsif new.status = 'sent' and new.message_type = 'information_received' then
    update public.refund_cases
    set
      status = case when status = 'waiting_on_customer' then 'needs_review' else status end,
      automation_state = case
        when status = 'draft' then 'customer_reply_review'
        else 'under_review'
      end,
      automation_follow_up_due_at = null,
      customer_last_contacted_at = new.sent_at,
      last_customer_message_type = new.message_type
    where id = cycle_row.refund_case_id
      and status not in ('approved', 'denied', 'completed', 'closed');
  elsif new.status in ('failed', 'skipped') then
    update public.refund_cases
    set automation_follow_up_due_at = null
    where id = cycle_row.refund_case_id;
  end if;

  return new;
end;
$$;

revoke all on function public.sync_refund_follow_up_cycle_from_message()
  from public, anon, authenticated, service_role;

create or replace function public.guard_refund_follow_up_cycle()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  case_row public.refund_cases;
  existing_count integer;
  existing_max smallint;
  existing_fact_version bigint;
  expected_missing text[] := '{}'::text[];
begin
  if tg_op = 'INSERT' then
    perform pg_advisory_xact_lock(
      hashtextextended('refund_follow_up_cycle:' || new.refund_case_id::text, 0)
    );

    select * into case_row
    from public.refund_cases
    where id = new.refund_case_id
    for update;

    if case_row.id is null then
      raise exception 'Refund case not found';
    end if;

    select
      count(*)::integer,
      coalesce(max(cycle_number), 0)::smallint,
      coalesce(max(case_fact_version), 0)::bigint
    into existing_count, existing_max, existing_fact_version
    from public.refund_follow_up_cycles
    where refund_case_id = new.refund_case_id;

    if existing_count >= 2 then
      raise exception 'Refund follow-up contact limit reached'
        using errcode = '23514';
    end if;
    if new.cycle_number <> existing_max + 1 then
      raise exception 'Refund follow-up cycle number must be sequential'
        using errcode = '23514';
    end if;
    if existing_count > 0 and new.case_fact_version <= existing_fact_version then
      raise exception 'A new refund follow-up cycle requires material fact progress'
        using errcode = '23514';
    end if;
    if new.case_fact_version <> case_row.deterministic_fact_version then
      raise exception 'Refund follow-up cycle facts are stale'
        using errcode = '23514';
    end if;
    if new.source_customer_message_id is not null
      and not public.refund_gmail_message_is_verified_customer(
        new.source_customer_message_id,
        new.refund_case_id
      ) then
      raise exception 'Verified customer source message required'
        using errcode = '23514';
    end if;

    expected_missing := coalesce(
      public.refund_missing_follow_up_fields(new.refund_case_id),
      '{}'::text[]
    );

    if new.reason_code = 'missing_information' then
      if case_row.card_wallet_used is true then
        raise exception 'Wallet cases must use the secure correction flow'
          using errcode = '23514';
      end if;
      if cardinality(expected_missing) = 0
        or new.requested_fields <> expected_missing then
        raise exception 'Missing-information cycle must request every and only missing fact'
          using errcode = '23514';
      end if;
    elsif new.reason_code = 'no_safe_match' then
      if cardinality(expected_missing) <> 0
        or not (
          (
            case_row.payment_method = 'card'
            and case_row.card_wallet_used is false
            and case_row.correlation_status = 'no_match'
            and case_row.correlation_source = 'nayax'
            and case_row.nayax_recommendation_state = 'no_safe_match'
            and nullif(
              btrim(coalesce(case_row.nayax_recommendation_policy_version, '')),
              ''
            ) is not null
            and case_row.nayax_recommendation_evaluated_at is not null
            and case_row.nayax_recommendation_evaluated_at >= case_row.deterministic_facts_updated_at
            and case_row.nayax_match_execution_eligible is not true
            and case_row.matched_nayax_transaction_id is null
          )
          or (
            case_row.payment_method = 'cash'
            and case_row.card_wallet_used is false
            and case_row.correlation_status = 'no_match'
            and case_row.correlation_source = 'sunze'
            and nullif(btrim(coalesce(case_row.correlation_summary, '')), '') is not null
            and case_row.matched_sales_fact_id is null
            and case_row.cash_match_evaluated_fact_version = case_row.deterministic_fact_version
            and case_row.matched_nayax_transaction_id is null
            and case_row.nayax_match_execution_eligible is not true
          )
        ) then
        raise exception 'Confirmed deterministic no-safe-match evidence required'
          using errcode = '23514';
      end if;
    end if;

    if case_row.status in ('approved', 'denied', 'completed', 'closed')
      or case_row.decision is not null then
      raise exception 'Terminal refund case cannot start customer follow-up'
        using errcode = '23514';
    end if;

    if new.status <> 'claimed'
      or new.request_message_id is not null
      or new.request_created_at is not null
      or new.request_sent_at is not null
      or new.reminder_due_at is not null
      or new.reminder_claimed_at is not null
      or new.reminder_message_id is not null
      or new.reminder_created_at is not null
      or new.reminder_sent_at is not null
      or new.reply_customer_message_id is not null
      or new.reply_received_at is not null
      or new.recheck_claimed_at is not null
      or new.receipt_message_id is not null
      or new.receipt_created_at is not null
      or new.receipt_sent_at is not null
      or new.failed_message_id is not null
      or new.failed_at is not null
      or new.failure_code is not null then
      raise exception 'New refund follow-up cycle must start unclaimed by transport'
        using errcode = '23514';
    end if;

    return new;
  end if;

  if new.refund_case_id is distinct from old.refund_case_id
    or new.cycle_number is distinct from old.cycle_number
    or new.trigger_fingerprint is distinct from old.trigger_fingerprint
    or new.reason_code is distinct from old.reason_code
    or new.requested_fields is distinct from old.requested_fields
    or new.template_version is distinct from old.template_version
    or new.case_fact_version is distinct from old.case_fact_version
    or new.reminder_delay_hours is distinct from old.reminder_delay_hours
    or new.source_customer_message_id is distinct from old.source_customer_message_id
    or new.created_at is distinct from old.created_at then
    raise exception 'Refund follow-up cycle evidence is immutable'
      using errcode = '23514';
  end if;

  if old.request_message_id is not null
    and new.request_message_id is distinct from old.request_message_id
    or old.request_created_at is not null
      and new.request_created_at is distinct from old.request_created_at
    or old.request_sent_at is not null
      and new.request_sent_at is distinct from old.request_sent_at
    or old.reminder_due_at is not null
      and new.reminder_due_at is distinct from old.reminder_due_at
    or old.reminder_claimed_at is not null
      and new.reminder_claimed_at is distinct from old.reminder_claimed_at
    or old.reminder_message_id is not null
      and new.reminder_message_id is distinct from old.reminder_message_id
    or old.reminder_created_at is not null
      and new.reminder_created_at is distinct from old.reminder_created_at
    or old.reminder_sent_at is not null
      and new.reminder_sent_at is distinct from old.reminder_sent_at
    or old.reply_customer_message_id is not null
      and new.reply_customer_message_id is distinct from old.reply_customer_message_id
    or old.reply_received_at is not null
      and new.reply_received_at is distinct from old.reply_received_at
    or old.recheck_claimed_at is not null
      and new.recheck_claimed_at is distinct from old.recheck_claimed_at
    or old.receipt_message_id is not null
      and new.receipt_message_id is distinct from old.receipt_message_id
    or old.receipt_created_at is not null
      and new.receipt_created_at is distinct from old.receipt_created_at
    or old.receipt_sent_at is not null
      and new.receipt_sent_at is distinct from old.receipt_sent_at
    or old.failed_message_id is not null
      and new.failed_message_id is distinct from old.failed_message_id
    or old.failed_at is not null
      and new.failed_at is distinct from old.failed_at
    or old.failure_code is not null
      and new.failure_code is distinct from old.failure_code then
    raise exception 'Refund follow-up delivery evidence cannot be replaced or cleared'
      using errcode = '23514';
  end if;

  if old.status = 'claimed' and new.status not in ('claimed', 'waiting', 'failed', 'manual_review')
    or old.status = 'waiting' and new.status not in ('waiting', 'customer_replied', 'failed', 'manual_review')
    or old.status = 'customer_replied' and new.status not in ('customer_replied', 'closed', 'failed', 'manual_review')
    or old.status in ('closed', 'failed', 'manual_review') and new.status <> old.status then
    raise exception 'Invalid refund follow-up cycle transition'
      using errcode = '23514';
  end if;

  if new.request_message_id is not null and not exists (
    select 1
    from public.refund_case_messages message
    where message.id = new.request_message_id
      and message.refund_case_id = new.refund_case_id
      and message.follow_up_cycle_id = new.id
      and message.delivery_kind = 'automatic'
      and message.message_type in ('more_info', 'no_safe_match')
      and message.created_at = new.request_created_at
      and (
        new.request_sent_at is null
        or (
          message.sent_at = new.request_sent_at
          and (
            message.status = 'sent'
            or public.is_refund_message_recorded_delivery_failure(to_jsonb(message))
          )
        )
      )
  ) then
    raise exception 'Valid immutable request message evidence required'
      using errcode = '23514';
  end if;

  if new.reminder_message_id is not null and not exists (
    select 1
    from public.refund_case_messages message
    where message.id = new.reminder_message_id
      and message.refund_case_id = new.refund_case_id
      and message.follow_up_cycle_id = new.id
      and message.delivery_kind = 'automatic'
      and message.message_type = 'reminder'
      and message.created_at = new.reminder_created_at
      and (
        new.reminder_sent_at is null
        or (
          message.sent_at = new.reminder_sent_at
          and (
            message.status = 'sent'
            or public.is_refund_message_recorded_delivery_failure(to_jsonb(message))
          )
        )
      )
  ) then
    raise exception 'Valid immutable reminder message evidence required'
      using errcode = '23514';
  end if;

  if new.reply_customer_message_id is not null and (
    not public.refund_gmail_message_is_verified_customer(
      new.reply_customer_message_id,
      new.refund_case_id
    )
    or not exists (
      select 1
      from public.refund_gmail_messages message
      where message.id = new.reply_customer_message_id
        and message.received_at = new.reply_received_at
    )
  ) then
    raise exception 'Valid immutable verified customer reply evidence required'
      using errcode = '23514';
  end if;

  if new.receipt_message_id is not null and not exists (
    select 1
    from public.refund_case_messages message
    where message.id = new.receipt_message_id
      and message.refund_case_id = new.refund_case_id
      and message.follow_up_cycle_id = new.id
      and message.delivery_kind = 'automatic'
      and message.message_type = 'information_received'
      and message.created_at = new.receipt_created_at
      and (
        new.receipt_sent_at is null
        or (
          message.sent_at = new.receipt_sent_at
          and (
            message.status = 'sent'
            or public.is_refund_message_recorded_delivery_failure(to_jsonb(message))
          )
        )
      )
  ) then
    raise exception 'Valid immutable information-received message evidence required'
      using errcode = '23514';
  end if;

  if new.failed_message_id is not null and not exists (
    select 1
    from public.refund_case_messages message
    where message.id = new.failed_message_id
      and message.refund_case_id = new.refund_case_id
      and message.follow_up_cycle_id = new.id
      and message.delivery_kind = 'automatic'
      and message.status in ('failed', 'skipped')
  ) then
    raise exception 'Valid immutable failed message evidence required'
      using errcode = '23514';
  end if;

  if old.reminder_claimed_at is null
    and new.reminder_claimed_at is not null
    and (
      old.status <> 'waiting'
      or old.reminder_due_at is null
      or new.reminder_claimed_at < old.reminder_due_at
    ) then
    raise exception 'Reminder can be claimed only once after it becomes due'
      using errcode = '23514';
  end if;

  if new.recheck_claimed_at is not null and (
    new.reply_customer_message_id is null
    or new.reply_received_at is null
  ) then
    raise exception 'Recheck claim requires a verified customer reply'
      using errcode = '23514';
  end if;

  if new.status = 'claimed' and (
    new.request_sent_at is not null
    or new.reply_customer_message_id is not null
    or new.receipt_message_id is not null
    or new.failed_message_id is not null
  ) then
    raise exception 'Claimed follow-up cycle has incompatible delivery evidence'
      using errcode = '23514';
  elsif new.status = 'waiting' and (
    new.request_message_id is null
    or new.request_sent_at is null
    or new.reminder_due_at is null
    or new.reply_customer_message_id is not null
    or new.receipt_message_id is not null
    or new.failed_message_id is not null
  ) then
    raise exception 'Waiting follow-up cycle requires one delivered request'
      using errcode = '23514';
  elsif new.status = 'customer_replied' and (
    new.request_sent_at is null
    or new.reply_customer_message_id is null
    or new.reply_received_at is null
  ) then
    raise exception 'Customer-replied cycle requires one verified reply'
      using errcode = '23514';
  elsif new.status = 'closed' and (
    new.request_sent_at is null
    or new.reply_customer_message_id is null
    or new.recheck_claimed_at is null
    or new.receipt_message_id is null
    or new.receipt_sent_at is null
    or new.failed_message_id is not null
  ) then
    raise exception 'Closed follow-up cycle requires one delivered receipt'
      using errcode = '23514';
  elsif new.status = 'failed' and (
    new.failed_message_id is null
    or new.failed_at is null
    or new.failure_code is null
  ) then
    raise exception 'Failed follow-up cycle requires immutable failure evidence'
      using errcode = '23514';
  end if;

  new.updated_at := statement_timestamp();
  return new;
end;
$$;

revoke all on function public.guard_refund_follow_up_cycle()
  from public, anon, authenticated, service_role;

create or replace function public.service_claim_due_refund_follow_up_reminders(
  p_limit integer default 25
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  settings_row public.refund_customer_contact_settings;
  cycle_row public.refund_follow_up_cycles;
  claimed_cycle public.refund_follow_up_cycles;
  reminders jsonb := '[]'::jsonb;
  normalized_limit integer := least(greatest(coalesce(p_limit, 25), 1), 100);
begin
  select * into settings_row
  from public.refund_customer_contact_settings
  where singleton;

  if not coalesce(settings_row.automatic_customer_contact_enabled, false) then
    return jsonb_build_object(
      'enabled', false,
      'reminders', reminders,
      'reason', 'automatic_customer_contact_disabled'
    );
  end if;

  for cycle_row in
    select cycle.*
    from public.refund_follow_up_cycles cycle
    where cycle.status = 'waiting'
      and cycle.request_sent_at is not null
      and cycle.reminder_due_at <= statement_timestamp()
      and cycle.reminder_claimed_at is null
      and cycle.reminder_message_id is null
      and cycle.reply_customer_message_id is null
      -- Preserve original sent evidence without turning a terminal delivery
      -- failure into authority for another customer contact.
      and exists (
        select 1 from public.refund_case_messages request
        where request.id = cycle.request_message_id
          and request.refund_case_id = cycle.refund_case_id
          and request.follow_up_cycle_id = cycle.id
          and request.status = 'sent'
          and request.sent_at = cycle.request_sent_at
          and request.delivery_state not in ('failed', 'bounced', 'complained')
      )
      and not exists (
        select 1
        from public.refund_gmail_threads thread
        where thread.refund_case_id = cycle.refund_case_id
          and thread.automatic_customer_contact_paused_at is not null
      )
    order by cycle.reminder_due_at, cycle.id
    limit normalized_limit
    for update skip locked
  loop
    update public.refund_follow_up_cycles
    set reminder_claimed_at = statement_timestamp()
    where id = cycle_row.id
      and reminder_claimed_at is null
    returning * into claimed_cycle;

    if claimed_cycle.id is not null then
      reminders := reminders || jsonb_build_array(
        public.refund_follow_up_cycle_json(claimed_cycle)
      );
    end if;
  end loop;

  return jsonb_build_object(
    'enabled', true,
    'reminders', reminders
  );
end;
$$;

revoke all on function public.service_claim_due_refund_follow_up_reminders(integer)
  from public, anon, authenticated;
grant execute on function public.service_claim_due_refund_follow_up_reminders(integer)
  to service_role;


-- Fresh-send RPC repairs follow the unchanged nine-function delivery prefix.
create or replace function public.service_mark_refund_transactional_delivery_attempt(
  p_refund_case_message_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  message_row public.refund_case_messages%rowtype;
begin
  select message.* into message_row
  from public.refund_case_messages message
  where message.id = p_refund_case_message_id
  for update;

  if not found or message_row.status not in ('pending', 'failed') then
    raise exception 'Refund customer message is not ready for delivery'
      using errcode = 'P4651';
  end if;
  if exists (
    select 1
    from public.refund_cases refund_case
    where refund_case.id = message_row.refund_case_id
      and refund_case.case_population = 'internal_test'
  ) then
    raise exception 'Customer delivery is suppressed for Internal/test cases'
      using errcode = 'P4640';
  end if;
  if exists (
    select 1 from public.refund_gmail_messages gmail_message
    where gmail_message.refund_case_message_id = message_row.id
  ) then
    raise exception 'Refund customer message already uses Gmail transport'
      using errcode = 'P4651';
  end if;


  -- Recheck the original request at the last database boundary before a new
  -- provider send. A reminder created earlier does not retain send authority
  -- after its exact request bounces, fails, or receives a complaint.
  if message_row.delivery_kind = 'automatic'
    and message_row.message_type = 'reminder'
    and message_row.follow_up_cycle_id is not null
    and not exists (
      select 1
      from public.refund_follow_up_cycles cycle
      join public.refund_case_messages request on request.id = cycle.request_message_id
      where cycle.id = message_row.follow_up_cycle_id
        and cycle.refund_case_id = message_row.refund_case_id
        and request.refund_case_id = message_row.refund_case_id
        and request.follow_up_cycle_id = cycle.id
        and request.status = 'sent'
        and request.sent_at = cycle.request_sent_at
        and request.delivery_state not in ('failed', 'bounced', 'complained')
    ) then
    raise exception 'Follow-up reminder requires a non-failed original request'
      using errcode = '23514';
  end if;

  update public.refund_case_messages message
  set
    delivery_transport = 'resend',
    delivery_state = 'unknown',
    delivery_state_updated_at = coalesce(
      message.delivery_state_updated_at,
      statement_timestamp()
    )
  where message.id = message_row.id;

  return jsonb_build_object(
    'marked', true,
    'deliveryState', 'unknown',
    'payloadRedacted', true
  );
end;
$$;

create or replace function public.service_claim_refund_gmail_outbound_v3(
  p_refund_case_id uuid,
  p_refund_case_message_id uuid,
  p_operation_key text,
  p_sender_email text,
  p_recipient_email text,
  p_plain_body text,
  p_mailbox_identities text[],
  p_delivery_kind text,
  p_target_gmail_thread_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  thread_row public.refund_gmail_threads;
  latest_message public.refund_gmail_messages;
  outbound_row public.refund_gmail_messages;
  message_row public.refund_case_messages;
  delivery_authorization jsonb;
  manager_cc_emails text[] := '{}'::text[];
  mailbox_identities text[] := public.normalize_refund_mailbox_identities(
    p_mailbox_identities
  );
  normalized_sender text := lower(btrim(coalesce(p_sender_email, '')));
  normalized_recipient text := lower(btrim(coalesce(p_recipient_email, '')));
  normalized_delivery_kind text := lower(btrim(coalesce(p_delivery_kind, '')));
  reply_subject text;
  reply_references text;
  case_pause_at timestamptz;
begin
  if length(btrim(coalesce(p_operation_key, ''))) not between 8 and 255 then
    raise exception 'Valid Gmail outbound operation key required';
  end if;
  if normalized_delivery_kind not in ('manual', 'automatic') then
    raise exception 'Valid Gmail delivery kind required';
  end if;
  if coalesce(p_plain_body, '') ~* '/refunds\?case=' then
    raise exception 'Customer Gmail reply cannot contain an internal refund case link';
  end if;
  if not public.refund_email_address_is_valid(normalized_sender)
    or not (normalized_sender = any(mailbox_identities)) then
    raise exception 'Authorized refund mailbox sender required';
  end if;

  select * into message_row
  from public.refund_case_messages
  where id = p_refund_case_message_id
  for update;

  if message_row.id is null
    or message_row.refund_case_id <> p_refund_case_id then
    raise exception 'Tracked refund customer message required';
  end if;

  -- Reconcile a previously provider-confirmed milestone before evaluating any
  -- gate that applies only to a new external send. This is not a retry: the
  -- operation key and exact stored thread/message must already match.
  select * into outbound_row
  from public.refund_gmail_messages
  where operation_key = btrim(p_operation_key)
  for update;

  if outbound_row.id is not null then
    if outbound_row.refund_case_id is distinct from p_refund_case_id
      or outbound_row.refund_case_message_id is distinct from p_refund_case_message_id
      or (
        p_target_gmail_thread_id is not null
        and outbound_row.gmail_thread_id is distinct from p_target_gmail_thread_id
      ) then
      raise exception 'Refund Gmail outbound operation key collision';
    end if;

    select * into thread_row
    from public.refund_gmail_threads
    where id = outbound_row.gmail_thread_id;

    if outbound_row.status = 'sent' and outbound_row.sent_at is not null then
      update public.refund_case_messages
      set
        status = 'sent',
        sent_at = coalesce(sent_at, outbound_row.sent_at),
        error_message = null
      where id = message_row.id
        and status = 'pending';

      return jsonb_build_object(
        'linked', true,
        'claimed', false,
        'reconciled', true,
        'transportMessageId', outbound_row.id,
        'gmailThreadId', outbound_row.gmail_thread_id,
        'providerThreadId', thread_row.provider_thread_id,
        'subject', outbound_row.subject,
        'managerCcEmails', to_jsonb(outbound_row.recipient_cc_emails),
        'managerCcCount', outbound_row.recipient_cc_count,
        'recipientResolutionStatus', outbound_row.recipient_resolution_status,
        'status', 'sent'
      );
    end if;

    return jsonb_build_object(
      'linked', true,
      'claimed', false,
      'transportMessageId', outbound_row.id,
      'status', outbound_row.status
    );
  end if;

  if message_row.status <> 'pending' then
    return jsonb_build_object(
      'linked', true,
      'claimed', false,
      'status', 'message_not_pending'
    );
  end if;
  if normalized_delivery_kind = 'automatic' and not (
    (
      message_row.delivery_kind = 'automatic'
      and message_row.content_source = 'deterministic_template'
    )
    or (
      -- The public first-contact confirmation predates the follow-up evidence
      -- columns and is separately versioned/guarded by its exact template key.
      message_row.message_type = 'confirmation'
      and message_row.template_key = 'refund_confirmation_v1'
      and message_row.delivery_kind is null
      and message_row.content_source is null
    )
  ) then
    return jsonb_build_object(
      'linked', true,
      'claimed', false,
      'status', 'unsafe_automatic_message'
    );
  end if;
  if normalized_delivery_kind = 'manual'
    and message_row.delivery_kind = 'automatic' then
    return jsonb_build_object(
      'linked', true,
      'claimed', false,
      'status', 'delivery_kind_mismatch'
    );
  end if;


  -- Recheck the original request at the last database boundary before a new
  -- provider send. A reminder created earlier does not retain send authority
  -- after its exact request bounces, fails, or receives a complaint.
  if message_row.delivery_kind = 'automatic'
    and message_row.message_type = 'reminder'
    and message_row.follow_up_cycle_id is not null
    and not exists (
      select 1
      from public.refund_follow_up_cycles cycle
      join public.refund_case_messages request on request.id = cycle.request_message_id
      where cycle.id = message_row.follow_up_cycle_id
        and cycle.refund_case_id = message_row.refund_case_id
        and request.refund_case_id = message_row.refund_case_id
        and request.follow_up_cycle_id = cycle.id
        and request.status = 'sent'
        and request.sent_at = cycle.request_sent_at
        and request.delivery_state not in ('failed', 'bounced', 'complained')
    ) then
    raise exception 'Follow-up reminder requires a non-failed original request'
      using errcode = '23514';
  end if;

  delivery_authorization := public.service_authorize_refund_customer_outbound(
    p_refund_case_id,
    normalized_recipient,
    mailbox_identities,
    normalized_delivery_kind
  );
  if not coalesce((delivery_authorization ->> 'allowed')::boolean, false) then
    return jsonb_build_object(
      'linked', true,
      'claimed', false,
      'status', delivery_authorization ->> 'status',
      'recipientResolutionStatus',
        delivery_authorization ->> 'recipientResolutionStatus',
      'managerCcCount', coalesce(
        (delivery_authorization ->> 'managerCcCount')::integer,
        0
      )
    );
  end if;
  select coalesce(array_agg(value order by value), '{}'::text[])
  into manager_cc_emails
  from jsonb_array_elements_text(
    delivery_authorization -> 'managerCcEmails'
  ) value;

  -- Lock every linked thread before selecting the exact reply target. A hard
  -- bounce on any older conversation remains a case-wide automatic-send stop.
  perform linked_thread.id
  from public.refund_gmail_threads linked_thread
  where linked_thread.refund_case_id = p_refund_case_id
  order by linked_thread.id
  for update;

  if p_target_gmail_thread_id is not null then
    select * into thread_row
    from public.refund_gmail_threads
    where id = p_target_gmail_thread_id
      and refund_case_id = p_refund_case_id;

    if thread_row.id is null then
      raise exception 'Target Gmail thread does not belong to the refund case';
    end if;
  elsif normalized_delivery_kind = 'automatic' and exists (
    select 1
    from public.refund_gmail_threads linked_thread
    where linked_thread.refund_case_id = p_refund_case_id
  ) then
    return jsonb_build_object(
      'linked', true,
      'claimed', false,
      'status', 'source_thread_required'
    );
  else
    select * into thread_row
    from public.refund_gmail_threads
    where refund_case_id = p_refund_case_id
    order by latest_message_at desc, id desc
    limit 1;
  end if;

  if thread_row.id is null then
    return jsonb_build_object('linked', false, 'claimed', false);
  end if;

  select min(linked_thread.automatic_customer_contact_paused_at)
  into case_pause_at
  from public.refund_gmail_threads linked_thread
  where linked_thread.refund_case_id = p_refund_case_id
    and linked_thread.automatic_customer_contact_paused_at is not null;

  if normalized_delivery_kind = 'automatic' and case_pause_at is not null then
    return jsonb_build_object(
      'linked', true,
      'claimed', false,
      'status', 'automatic_contact_paused',
      'automaticCustomerContactPaused', true,
      'automaticCustomerContactPauseReason', 'hard_bounce'
    );
  end if;

  select * into latest_message
  from public.refund_gmail_messages
  where gmail_thread_id = thread_row.id
    and message_kind = 'message'
  order by received_at desc, id desc
  limit 1;

  if latest_message.id is null then
    raise exception 'Target Gmail thread has no message to reply to';
  end if;
  reply_subject := coalesce(
    nullif(btrim(latest_message.subject), ''),
    thread_row.thread_subject
  );
  reply_references := btrim(concat_ws(
    ' ',
    nullif(btrim(coalesce(latest_message.references_header, '')), ''),
    nullif(btrim(coalesce(latest_message.provider_message_header, '')), '')
  ));

  insert into public.refund_gmail_messages (
    gmail_thread_id,
    refund_case_id,
    refund_case_message_id,
    operation_key,
    direction,
    message_kind,
    status,
    sender_email,
    recipient_email,
    recipient_cc_emails,
    recipient_cc_count,
    recipient_resolution_status,
    delivery_kind,
    participant_role,
    participant_trust,
    subject,
    plain_body,
    received_at,
    retention_expires_at
  ) values (
    thread_row.id,
    p_refund_case_id,
    p_refund_case_message_id,
    btrim(p_operation_key),
    'outbound',
    'message',
    'pending_send',
    normalized_sender,
    normalized_recipient,
    manager_cc_emails,
    cardinality(manager_cc_emails),
    delivery_authorization ->> 'recipientResolutionStatus',
    normalized_delivery_kind,
    'mailbox',
    'verified',
    reply_subject,
    left(coalesce(p_plain_body, ''), 50000),
    now(),
    now() + interval '180 days'
  )
  on conflict (operation_key) do nothing
  returning * into outbound_row;

  if outbound_row.id is null then
    select * into outbound_row
    from public.refund_gmail_messages
    where operation_key = btrim(p_operation_key);

    if outbound_row.refund_case_id is distinct from p_refund_case_id
      or outbound_row.refund_case_message_id is distinct from p_refund_case_message_id
      or outbound_row.gmail_thread_id is distinct from thread_row.id then
      raise exception 'Refund Gmail outbound operation key collision';
    end if;

    return jsonb_build_object(
      'linked', true,
      'claimed', false,
      'transportMessageId', outbound_row.id,
      'status', outbound_row.status
    );
  end if;

  insert into public.refund_case_events (
    refund_case_id,
    event_type,
    message,
    metadata
  ) values (
    p_refund_case_id,
    'gmail_manager_cc_resolved',
    'Current mapped Machine Managers were included on the customer Gmail reply.',
    jsonb_build_object(
      'recipient_resolution_status',
        delivery_authorization ->> 'recipientResolutionStatus',
      'manager_cc_count', cardinality(manager_cc_emails),
      'source_thread_bound', p_target_gmail_thread_id is not null,
      'payload_redacted', true
    )
  );

  return jsonb_build_object(
    'linked', true,
    'claimed', true,
    'transportMessageId', outbound_row.id,
    'gmailThreadId', thread_row.id,
    'providerThreadId', thread_row.provider_thread_id,
    'subject', reply_subject,
    'inReplyTo', latest_message.provider_message_header,
    'references', nullif(reply_references, ''),
    'managerCcEmails', to_jsonb(manager_cc_emails),
    'managerCcCount', cardinality(manager_cc_emails),
    'recipientResolutionStatus',
      delivery_authorization ->> 'recipientResolutionStatus'
  );
end;
$$;

revoke all on function public.service_mark_refund_transactional_delivery_attempt(uuid)
  from public, anon, authenticated;
grant execute on function public.service_mark_refund_transactional_delivery_attempt(uuid)
  to service_role;
revoke all on function public.service_claim_refund_gmail_outbound_v3(uuid, uuid, text, text, text, text, text[], text, uuid)
  from public, anon, authenticated;
grant execute on function public.service_claim_refund_gmail_outbound_v3(uuid, uuid, text, text, text, text, text[], text, uuid)
  to service_role;
