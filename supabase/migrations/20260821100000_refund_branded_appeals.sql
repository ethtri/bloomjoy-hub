-- Refund Pilot v1: one branded customer-message system and reply-based denial appeals.
-- Customer replies can reopen a denied case, but never authorize or attempt payment.

create table public.refund_case_appeals (
  id uuid primary key default gen_random_uuid(),
  refund_case_id uuid not null references public.refund_cases (id) on delete restrict,
  source_gmail_message_id uuid not null references public.refund_gmail_messages (id) on delete restrict,
  prior_customer_safe_reason text not null,
  received_at timestamptz not null,
  confirmation_status text not null default 'pending_send' check (
    confirmation_status in ('pending_send', 'sending', 'sent', 'failed', 'delivery_unknown')
  ),
  confirmation_claimed_at timestamptz,
  confirmation_attempt_count integer not null default 0 check (
    confirmation_attempt_count between 0 and 10
  ),
  confirmation_error_code text,
  confirmation_sent_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint refund_case_appeals_source_unique unique (source_gmail_message_id),
  constraint refund_case_appeals_reason_present check (
    length(btrim(prior_customer_safe_reason)) between 8 and 360
  )
);

create index refund_case_appeals_case_received_idx
  on public.refund_case_appeals (refund_case_id, received_at desc);

alter table public.refund_case_appeals enable row level security;

create policy refund_case_appeals_manager_read
on public.refund_case_appeals for select to authenticated
using (public.can_manage_refund_case(auth.uid(), refund_case_id));

revoke all on public.refund_case_appeals from public, anon, authenticated;
grant select on public.refund_case_appeals to authenticated;
grant select, insert, update on public.refund_case_appeals to service_role;

alter table public.refund_case_messages
  add column appeal_id uuid references public.refund_case_appeals (id) on delete restrict;

create unique index refund_case_messages_appeal_unique
  on public.refund_case_messages (appeal_id)
  where appeal_id is not null;

alter table public.refund_case_messages
  drop constraint if exists refund_case_messages_message_type_check,
  add constraint refund_case_messages_message_type_check
    check (message_type in (
      'confirmation',
      'more_info',
      'no_safe_match',
      'reminder',
      'information_received',
      'wallet_correction',
      'wallet_correction_reminder',
      'status_update',
      'approved',
      'denied',
      'appeal_received',
      'completed',
      'escalation',
      'manual_note'
    )),
  drop constraint if exists refund_case_messages_reason_code_check,
  add constraint refund_case_messages_reason_code_check check (
    reason_code is null
    or reason_code in ('missing_information', 'no_safe_match', 'denial_appeal')
  ),
  drop constraint if exists refund_case_messages_safe_evidence_shape,
  add constraint refund_case_messages_safe_evidence_shape check (
    (
      delivery_kind is null
      and content_source is null
      and reason_code is null
      and template_version is null
      and follow_up_cycle_id is null
      and cardinality(requested_fields) = 0
    )
    or (
      delivery_kind = 'manual'
      and content_source in ('deterministic_template', 'manager_reviewed_gpt', 'manager_authored')
      and follow_up_cycle_id is null
      and (
        (
          message_type = 'more_info'
          and content_source in ('manager_reviewed_gpt', 'manager_authored')
          and reason_code = 'missing_information'
          and cardinality(requested_fields) > 0
          and template_version is null
        )
        or (
          message_type <> 'more_info'
          and reason_code is null
          and cardinality(requested_fields) = 0
          and (
            (content_source = 'deterministic_template' and template_version is not null)
            or (content_source <> 'deterministic_template' and template_version is null)
          )
        )
      )
    )
    or (
      delivery_kind = 'automatic'
      and content_source = 'deterministic_template'
      and (
        (
          reason_code in ('missing_information', 'no_safe_match')
          and template_version in ('refund_follow_up_v1', 'refund_follow_up_v2')
          and follow_up_cycle_id is not null
          and message_type in ('more_info', 'no_safe_match', 'reminder', 'information_received')
        )
        or (
          message_type in ('wallet_correction', 'wallet_correction_reminder')
          and reason_code is null
          and template_version = case message_type
            when 'wallet_correction' then 'refund_wallet_correction_v1'
            else 'refund_wallet_correction_reminder_v1'
          end
          and follow_up_cycle_id is null
          and cardinality(requested_fields) = 0
        )
        or (
          message_type = 'appeal_received'
          and appeal_id is not null
          and reason_code = 'denial_appeal'
          and template_version = 'refund_appeal_received_v1'
          and follow_up_cycle_id is null
          and cardinality(requested_fields) = 0
        )
      )
    )
  );

alter table public.refund_cases
  drop constraint if exists refund_cases_automation_state_check,
  add constraint refund_cases_automation_state_check
  check (automation_state in (
    'submitted',
    'under_review',
    'more_info_needed',
    'customer_replied',
    'customer_reply_review',
    'wallet_correction_needed',
    'wallet_correction_sent',
    'wallet_correction_received',
    'fallback_eligible',
    'approved',
    'denied',
    'appeal_received',
    'completed',
    'closed_incomplete',
    'escalated'
  ));

-- Preserve the existing follow-up guard for every existing message class, and
-- give denial appeals an equally strict guard without pretending they belong
-- to a missing-information follow-up cycle.
drop trigger if exists refund_case_messages_follow_up_guard
  on public.refund_case_messages;
create trigger refund_case_messages_follow_up_guard
before insert or update on public.refund_case_messages
for each row
when (new.message_type <> 'appeal_received')
execute function public.guard_refund_follow_up_message();

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

drop trigger if exists refund_case_messages_denial_appeal_guard
  on public.refund_case_messages;
create trigger refund_case_messages_denial_appeal_guard
before insert or update on public.refund_case_messages
for each row
when (new.message_type = 'appeal_received')
execute function public.guard_refund_denial_appeal_message();

create or replace function public.service_record_refund_denial_appeal(
  p_refund_case_id uuid,
  p_source_gmail_message_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  case_row public.refund_cases;
  source_row public.refund_gmail_messages;
  appeal_row public.refund_case_appeals;
  appeal_created boolean := false;
begin
  if p_refund_case_id is null or p_source_gmail_message_id is null then
    return jsonb_build_object('appealReceived', false, 'appealId', null);
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('refund_denial_appeal:' || p_refund_case_id::text, 0)
  );

  select refund_case.* into case_row
  from public.refund_cases refund_case
  where refund_case.id = p_refund_case_id
  for update;

  select message.* into source_row
  from public.refund_gmail_messages message
  where message.id = p_source_gmail_message_id
    and message.refund_case_id = p_refund_case_id
    and message.direction = 'inbound'
    and message.participant_role = 'customer'
    and message.participant_trust = 'verified'
    and message.status = 'received'
    and lower(btrim(message.sender_email)) = lower(btrim(case_row.customer_email));

  if case_row.id is null or source_row.id is null then
    return jsonb_build_object('appealReceived', false, 'appealId', null);
  end if;

  select appeal.* into appeal_row
  from public.refund_case_appeals appeal
  where appeal.source_gmail_message_id = source_row.id;

  if appeal_row.id is not null then
    return jsonb_build_object(
      'appealReceived', false,
      'appealId', appeal_row.id,
      'appealConfirmationStatus', appeal_row.confirmation_status
    );
  end if;

  if case_row.status <> 'denied'
    or case_row.decision <> 'denied'
    or length(btrim(coalesce(case_row.decision_reason, ''))) < 8
    or not exists (
      select 1
      from public.refund_case_messages denial_message
      where denial_message.refund_case_id = case_row.id
        and denial_message.message_type = 'denied'
        and denial_message.status = 'sent'
        and denial_message.sent_at <= source_row.received_at
    ) then
    return jsonb_build_object('appealReceived', false, 'appealId', null);
  end if;

  insert into public.refund_case_appeals (
    refund_case_id,
    source_gmail_message_id,
    prior_customer_safe_reason,
    received_at
  ) values (
    case_row.id,
    source_row.id,
    left(btrim(case_row.decision_reason), 360),
    source_row.received_at
  )
  returning * into appeal_row;
  appeal_created := true;

  update public.refund_cases
  set
    status = 'needs_review',
    decision = null,
    decision_reason = null,
    decided_by = null,
    decided_at = null,
    refund_amount_cents = null,
    manual_refund_reference = null,
    automation_state = 'appeal_received',
    automation_follow_up_due_at = null,
    nayax_match_execution_eligible = false,
    updated_at = statement_timestamp()
  where id = case_row.id;

  insert into public.refund_case_events (
    refund_case_id,
    event_type,
    message,
    metadata,
    created_at
  ) values (
    case_row.id,
    'refund_denial_appeal_received',
    'The customer replied to the denial. The same case was reopened for manager review without authorizing payment.',
    jsonb_build_object(
      'appeal_id', appeal_row.id,
      'source_message_id', source_row.id,
      'payment_authorized', false,
      'provider_attempt_created', false,
      'payload_redacted', true
    ),
    source_row.received_at
  );

  return jsonb_build_object(
    'appealReceived', appeal_created,
    'appealId', appeal_row.id,
    'appealConfirmationStatus', appeal_row.confirmation_status
  );
end;
$$;

create or replace function public.service_claim_refund_denial_appeal_confirmation(
  p_appeal_id uuid,
  p_subject text,
  p_body text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  appeal_row public.refund_case_appeals;
  case_row public.refund_cases;
  source_row public.refund_gmail_messages;
  message_row public.refund_case_messages;
begin
  select appeal.* into appeal_row
  from public.refund_case_appeals appeal
  where appeal.id = p_appeal_id
  for update;

  if appeal_row.id is null then
    return jsonb_build_object('claimed', false, 'status', 'not_found');
  end if;

  if appeal_row.confirmation_status in ('sent', 'delivery_unknown', 'sending')
    and not (
      appeal_row.confirmation_status = 'sending'
      and appeal_row.confirmation_claimed_at < statement_timestamp() - interval '15 minutes'
    ) then
    return jsonb_build_object(
      'claimed', false,
      'status', appeal_row.confirmation_status
    );
  end if;

  select refund_case.* into case_row
  from public.refund_cases refund_case
  where refund_case.id = appeal_row.refund_case_id
  for share;

  select source.* into source_row
  from public.refund_gmail_messages source
  where source.id = appeal_row.source_gmail_message_id;

  if case_row.id is null
    or source_row.id is null
    or case_row.status <> 'needs_review'
    or case_row.decision is not null
    or case_row.automation_state <> 'appeal_received'
    or length(btrim(coalesce(p_subject, ''))) not between 8 and 180
    or length(btrim(coalesce(p_body, ''))) not between 40 and 50000 then
    raise exception 'Appeal confirmation context is no longer safe';
  end if;

  select message.* into message_row
  from public.refund_case_messages message
  where message.appeal_id = appeal_row.id
  for update;

  if message_row.id is null then
    insert into public.refund_case_messages (
      refund_case_id,
      message_type,
      status,
      recipient_email,
      subject,
      body,
      template_key,
      content_source,
      delivery_kind,
      reason_code,
      template_version,
      requested_fields,
      appeal_id
    ) values (
      case_row.id,
      'appeal_received',
      'pending',
      case_row.customer_email,
      left(btrim(p_subject), 180),
      left(p_body, 50000),
      'refund_appeal_received_v1',
      'deterministic_template',
      'automatic',
      'denial_appeal',
      'refund_appeal_received_v1',
      '{}'::text[],
      appeal_row.id
    )
    returning * into message_row;
  elsif message_row.status = 'failed'
    and appeal_row.confirmation_status = 'failed' then
    update public.refund_case_messages
    set
      status = 'pending',
      error_message = null,
      subject = left(btrim(p_subject), 180),
      body = left(p_body, 50000)
    where id = message_row.id
    returning * into message_row;
  end if;

  update public.refund_case_appeals
  set
    confirmation_status = 'sending',
    confirmation_claimed_at = statement_timestamp(),
    confirmation_attempt_count = confirmation_attempt_count + 1,
    confirmation_error_code = null,
    updated_at = statement_timestamp()
  where id = appeal_row.id;

  return jsonb_build_object(
    'claimed', true,
    'status', 'sending',
    'appealId', appeal_row.id,
    'refundCaseId', case_row.id,
    'refundCaseMessageId', message_row.id,
    'gmailThreadId', source_row.gmail_thread_id,
    'recipientEmail', case_row.customer_email,
    'customerName', case_row.customer_name,
    'publicReference', case_row.public_reference
  );
end;
$$;

create or replace function public.service_finish_refund_denial_appeal_confirmation(
  p_appeal_id uuid,
  p_refund_case_message_id uuid,
  p_delivery_status text,
  p_error_code text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_status text := lower(btrim(coalesce(p_delivery_status, '')));
  appeal_row public.refund_case_appeals;
begin
  if normalized_status not in ('sent', 'failed', 'delivery_unknown') then
    raise exception 'Valid appeal confirmation delivery status required';
  end if;

  select appeal.* into appeal_row
  from public.refund_case_appeals appeal
  where appeal.id = p_appeal_id
  for update;

  if appeal_row.id is null
    or appeal_row.confirmation_status <> 'sending'
    or not exists (
      select 1 from public.refund_case_messages message
      where message.id = p_refund_case_message_id
        and message.appeal_id = appeal_row.id
    ) then
    return false;
  end if;

  update public.refund_case_messages
  set
    status = case
      when normalized_status = 'sent' then 'sent'
      when normalized_status = 'delivery_unknown' then 'failed'
      else 'failed'
    end,
    sent_at = case when normalized_status = 'sent' then statement_timestamp() else null end,
    error_message = case
      when normalized_status = 'sent' then null
      when normalized_status = 'delivery_unknown' then 'gmail_delivery_reconciliation_required'
      else left(coalesce(nullif(btrim(p_error_code), ''), 'customer_email_delivery_failed'), 240)
    end
  where id = p_refund_case_message_id;

  update public.refund_case_appeals
  set
    confirmation_status = normalized_status,
    confirmation_error_code = case
      when normalized_status = 'sent' then null
      when normalized_status = 'delivery_unknown' then 'gmail_delivery_reconciliation_required'
      else left(coalesce(nullif(btrim(p_error_code), ''), 'customer_email_delivery_failed'), 240)
    end,
    confirmation_sent_at = case
      when normalized_status = 'sent' then statement_timestamp()
      else confirmation_sent_at
    end,
    updated_at = statement_timestamp()
  where id = appeal_row.id;

  if normalized_status = 'sent' then
    update public.refund_cases
    set
      customer_last_contacted_at = statement_timestamp(),
      last_customer_message_type = 'appeal_received',
      automation_state = 'appeal_received',
      updated_at = statement_timestamp()
    where id = appeal_row.refund_case_id;
  end if;

  insert into public.refund_case_events (
    refund_case_id,
    event_type,
    message,
    metadata
  ) values (
    appeal_row.refund_case_id,
    case normalized_status
      when 'sent' then 'refund_denial_appeal_confirmation_sent'
      else 'refund_denial_appeal_confirmation_attention'
    end,
    case normalized_status
      when 'sent' then 'Bloomjoy confirmed the appeal in the original customer conversation.'
      when 'delivery_unknown' then 'Appeal confirmation delivery is uncertain. Reconcile the original conversation before retrying.'
      else 'Appeal confirmation did not send and remains eligible for a known-safe retry.'
    end,
    jsonb_build_object(
      'appeal_id', appeal_row.id,
      'delivery_status', normalized_status,
      'payment_authorized', false,
      'payload_redacted', true
    )
  );

  return true;
end;
$$;

-- Keep the existing linked-thread ingestion implementation intact and wrap it
-- so every existing caller receives appeal semantics without changing its API.
alter function public.service_ingest_refund_gmail_message_v2(
  text,text,text,text,text,text,boolean,text,text,text,text,text,boolean,
  timestamptz,text,jsonb,text[],text[],text,boolean,boolean,text[]
)
rename to service_ingest_refund_gmail_message_v2_pre_appeal_20260821;

create function public.service_ingest_refund_gmail_message_v2(
  p_mailbox_hash text,
  p_provider_thread_id text,
  p_provider_message_id text,
  p_provider_message_header text,
  p_references_header text,
  p_direction text,
  p_is_bounce boolean,
  p_sender_email text,
  p_sender_name text,
  p_recipient_email text,
  p_subject text,
  p_plain_body text,
  p_sensitive_data_redacted boolean,
  p_received_at timestamptz,
  p_public_reference text,
  p_attachments jsonb,
  p_recipient_cc_emails text[],
  p_mailbox_identities text[],
  p_participant_trust text,
  p_provider_sent boolean,
  p_is_hard_bounce boolean,
  p_failed_recipient_emails text[]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  result jsonb;
  appeal_result jsonb := jsonb_build_object(
    'appealReceived', false,
    'appealId', null
  );
begin
  result := public.service_ingest_refund_gmail_message_v2_pre_appeal_20260821(
    p_mailbox_hash, p_provider_thread_id, p_provider_message_id,
    p_provider_message_header, p_references_header, p_direction, p_is_bounce,
    p_sender_email, p_sender_name, p_recipient_email, p_subject, p_plain_body,
    p_sensitive_data_redacted, p_received_at, p_public_reference, p_attachments,
    p_recipient_cc_emails, p_mailbox_identities, p_participant_trust,
    p_provider_sent, p_is_hard_bounce, p_failed_recipient_emails
  );

  if result ->> 'participantRole' = 'customer'
    and nullif(result ->> 'caseId', '') is not null
    and nullif(result ->> 'messageId', '') is not null then
    appeal_result := public.service_record_refund_denial_appeal(
      (result ->> 'caseId')::uuid,
      (result ->> 'messageId')::uuid
    );
  end if;

  return result || appeal_result;
end;
$$;

create or replace function public.canonicalize_refund_outcome_customer_copy()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  case_row public.refund_cases;
  greeting_break integer;
  required_opening constant text :=
    'Good news—your refund request was approved, and your refund is on its way.';
begin
  if new.message_type <> 'completed'
    or coalesce(new.template_version, '') <> 'refund_nayax_completion_v2' then
    return new;
  end if;

  select refund_case.* into case_row
  from public.refund_cases refund_case
  where refund_case.id = new.refund_case_id;

  if case_row.id is null
    or case_row.status <> 'completed'
    or case_row.decision <> 'approved'
    or case_row.refund_completed_at is null then
    raise exception 'Confirmed completion required for customer success copy';
  end if;

  if position(required_opening in coalesce(new.body, '')) = 0 then
    greeting_break := position(E'\n\n' in coalesce(new.body, ''));
    new.body := case
      when greeting_break > 0 then
        left(new.body, greeting_break - 1) || E'\n\n' || required_opening ||
          E'\n\n' || substring(new.body from greeting_break + 2)
      else required_opening || E'\n\n' || coalesce(new.body, '')
    end;
  end if;
  return new;
end;
$$;

drop trigger if exists refund_case_messages_canonical_outcome_copy
  on public.refund_case_messages;
create trigger refund_case_messages_canonical_outcome_copy
before insert or update of subject, body, message_type, template_version
on public.refund_case_messages
for each row execute function public.canonicalize_refund_outcome_customer_copy();

revoke execute on function public.service_record_refund_denial_appeal(uuid,uuid)
  from public, anon, authenticated;
revoke execute on function public.guard_refund_denial_appeal_message()
  from public, anon, authenticated, service_role;
revoke execute on function public.service_claim_refund_denial_appeal_confirmation(uuid,text,text)
  from public, anon, authenticated;
revoke execute on function public.service_finish_refund_denial_appeal_confirmation(uuid,uuid,text,text)
  from public, anon, authenticated;
revoke execute on function public.service_ingest_refund_gmail_message_v2_pre_appeal_20260821(
  text,text,text,text,text,text,boolean,text,text,text,text,text,boolean,
  timestamptz,text,jsonb,text[],text[],text,boolean,boolean,text[]
) from public, anon, authenticated;
revoke execute on function public.service_ingest_refund_gmail_message_v2(
  text,text,text,text,text,text,boolean,text,text,text,text,text,boolean,
  timestamptz,text,jsonb,text[],text[],text,boolean,boolean,text[]
) from public, anon, authenticated;

grant execute on function public.service_record_refund_denial_appeal(uuid,uuid)
  to service_role;
grant execute on function public.service_claim_refund_denial_appeal_confirmation(uuid,text,text)
  to service_role;
grant execute on function public.service_finish_refund_denial_appeal_confirmation(uuid,uuid,text,text)
  to service_role;
grant execute on function public.service_ingest_refund_gmail_message_v2_pre_appeal_20260821(
  text,text,text,text,text,text,boolean,text,text,text,text,text,boolean,
  timestamptz,text,jsonb,text[],text[],text,boolean,boolean,text[]
) to service_role;
grant execute on function public.service_ingest_refund_gmail_message_v2(
  text,text,text,text,text,text,boolean,text,text,text,text,text,boolean,
  timestamptz,text,jsonb,text[],text[],text,boolean,boolean,text[]
) to service_role;

comment on table public.refund_case_appeals is
  'One verified denial reply reopens the same refund case. Confirmation delivery is idempotent and never authorizes payment.';
