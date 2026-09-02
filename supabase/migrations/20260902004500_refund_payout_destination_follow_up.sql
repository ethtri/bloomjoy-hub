-- #628 / #891: make the approved cash-payout destination one protected,
-- canonical customer follow-up fact. The request, reply, lifecycle, and
-- manager queue now share one durable message-ledger contract.

create or replace function public.canonical_refund_follow_up_fields(p_fields text[])
returns text[]
language sql
immutable
set search_path = public
as $$
  with allowed(value, position) as (
    values
      ('location_or_machine'::text, 1),
      ('incident_date'::text, 2),
      ('incident_time'::text, 3),
      ('payment_method'::text, 4),
      ('payment_interaction'::text, 5),
      ('wallet_provider'::text, 6),
      ('amount'::text, 7),
      ('card_last4'::text, 8),
      ('card_network'::text, 9),
      ('zelle_payment_contact'::text, 10)
  ), selected as (
    select distinct allowed.value, allowed.position
    from unnest(coalesce(p_fields, '{}'::text[])) entry
    join allowed on allowed.value = entry
  )
  select coalesce(array_agg(value order by position), '{}'::text[])
  from selected;
$$;

alter table public.refund_case_messages
  add column if not exists requested_fields_satisfied_by_gmail_message_id uuid
    references public.refund_gmail_messages(id) on delete restrict,
  add column if not exists requested_fields_satisfied_at timestamptz;

create table if not exists public.refund_payout_destination_follow_ups (
  id uuid primary key default gen_random_uuid(),
  refund_case_id uuid not null unique
    references public.refund_cases(id) on delete cascade,
  request_message_id uuid not null unique
    references public.refund_case_messages(id) on delete restrict,
  reminder_intent_id uuid not null unique default gen_random_uuid(),
  reminder_delay_hours integer not null check (reminder_delay_hours between 24 and 168),
  status text not null default 'waiting' check (status in (
    'waiting', 'reminder_claimed', 'reminder_sent', 'satisfied', 'manual_review'
  )),
  reminder_due_at timestamptz not null,
  reminder_claim_token uuid,
  reminder_claimed_at timestamptz,
  reminder_message_id uuid unique,
  reminder_sent_at timestamptz,
  escalation_due_at timestamptz,
  satisfied_by_gmail_message_id uuid unique
    references public.refund_gmail_messages(id) on delete restrict,
  satisfied_at timestamptz,
  manual_review_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint refund_payout_destination_follow_up_claim_shape check (
    (status = 'reminder_claimed' and reminder_claim_token is not null
      and reminder_claimed_at is not null)
    or (status <> 'reminder_claimed' and reminder_claim_token is null)
  ),
  constraint refund_payout_destination_follow_up_sent_shape check (
    (status = 'reminder_sent'
      and reminder_message_id is not null and reminder_sent_at is not null
      and escalation_due_at is not null)
    or (status = 'waiting'
      and reminder_message_id is null and reminder_sent_at is null
      and escalation_due_at is null)
    or (status = 'reminder_claimed'
      and reminder_sent_at is null and escalation_due_at is null)
    or status in ('satisfied', 'manual_review')
  ),
  constraint refund_payout_destination_follow_up_satisfied_shape check (
    (status = 'satisfied' and satisfied_by_gmail_message_id is not null
      and satisfied_at is not null)
    or (status <> 'satisfied' and satisfied_by_gmail_message_id is null
      and satisfied_at is null)
  ),
  constraint refund_payout_destination_follow_up_review_shape check (
    (status = 'manual_review' and manual_review_at is not null)
    or status <> 'manual_review'
  )
);

create index if not exists refund_payout_destination_follow_ups_reminder_due_idx
  on public.refund_payout_destination_follow_ups(reminder_due_at, id)
  where status in ('waiting', 'reminder_claimed');
create index if not exists refund_payout_destination_follow_ups_escalation_due_idx
  on public.refund_payout_destination_follow_ups(escalation_due_at, id)
  where status = 'reminder_sent';

alter table public.refund_payout_destination_follow_ups enable row level security;
revoke all on table public.refund_payout_destination_follow_ups
  from public, anon, authenticated;
grant select, insert, update on table public.refund_payout_destination_follow_ups
  to service_role;

alter table public.refund_case_messages
  add column if not exists payout_destination_follow_up_id uuid
    references public.refund_payout_destination_follow_ups(id) on delete restrict;

create unique index if not exists refund_case_messages_one_payout_reminder_idx
  on public.refund_case_messages(payout_destination_follow_up_id)
  where payout_destination_follow_up_id is not null;

alter table public.refund_case_messages
  drop constraint if exists refund_case_messages_requested_fields_satisfaction_check,
  add constraint refund_case_messages_requested_fields_satisfaction_check check (
    (
      requested_fields_satisfied_by_gmail_message_id is null
      and requested_fields_satisfied_at is null
    )
    or (
      requested_fields_satisfied_by_gmail_message_id is not null
      and requested_fields_satisfied_at is not null
      and status = 'sent'
      and message_type in ('more_info', 'no_safe_match', 'reminder')
      and cardinality(requested_fields) > 0
    )
  );

create unique index if not exists refund_case_messages_customer_reply_satisfaction_unique
  on public.refund_case_messages (requested_fields_satisfied_by_gmail_message_id)
  where requested_fields_satisfied_by_gmail_message_id is not null;

create or replace function public.guard_refund_deterministic_fact_version()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.reporting_machine_id is distinct from old.reporting_machine_id
    or new.reporting_location_id is distinct from old.reporting_location_id
    or new.incident_at is distinct from old.incident_at
    or new.incident_local_datetime is distinct from old.incident_local_datetime
    or new.incident_timezone is distinct from old.incident_timezone
    or new.incident_time_resolution is distinct from old.incident_time_resolution
    or new.payment_method is distinct from old.payment_method
    or new.payment_amount_cents is distinct from old.payment_amount_cents
    or new.card_last4 is distinct from old.card_last4
    or new.card_last4_provenance is distinct from old.card_last4_provenance
    or new.card_network is distinct from old.card_network
    or new.card_wallet_used is distinct from old.card_wallet_used
    or new.payment_interaction is distinct from old.payment_interaction
    or new.wallet_provider is distinct from old.wallet_provider
    or new.zelle_payment_contact is distinct from old.zelle_payment_contact then
    new.deterministic_fact_version := old.deterministic_fact_version + 1;
    new.deterministic_facts_updated_at := statement_timestamp();
    new.cash_match_evaluated_fact_version := null;
  else
    new.deterministic_fact_version := old.deterministic_fact_version;
    new.deterministic_facts_updated_at := old.deterministic_facts_updated_at;
  end if;

  return new;
end;
$$;

drop trigger if exists refund_cases_guard_deterministic_fact_version
  on public.refund_cases;
create trigger refund_cases_guard_deterministic_fact_version
before update of
  reporting_machine_id,
  reporting_location_id,
  incident_at,
  incident_local_datetime,
  incident_timezone,
  incident_time_resolution,
  payment_method,
  payment_amount_cents,
  card_last4,
  card_last4_provenance,
  card_network,
  card_wallet_used,
  payment_interaction,
  wallet_provider,
  zelle_payment_contact,
  deterministic_fact_version,
  deterministic_facts_updated_at
on public.refund_cases
for each row execute function public.guard_refund_deterministic_fact_version();

create or replace function public.refund_customer_action_contract(
  p_refund_case_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  message_row public.refund_case_messages%rowtype;
  case_row public.refund_cases%rowtype;
  action_fields text[] := '{}'::text[];
begin
  select refund_case.* into case_row
  from public.refund_cases refund_case
  where refund_case.id = p_refund_case_id;

  if not found then return null; end if;

  select message.* into message_row
  from public.refund_case_messages message
  where message.refund_case_id = p_refund_case_id
    and message.status = 'sent'
    and message.sent_at is not null
    and message.message_type in (
      'more_info', 'no_safe_match', 'reminder',
      'wallet_correction', 'wallet_correction_reminder'
    )
  order by message.sent_at desc, message.id desc
  limit 1;

  if message_row.id is null then
    return jsonb_build_object(
      'valid', false,
      'reason', 'no_sent_information_request',
      'requestedFields', '[]'::jsonb,
      'payloadRedacted', true
    );
  end if;

  action_fields := public.canonical_refund_follow_up_fields(
    message_row.requested_fields
  );

  if message_row.requested_fields_satisfied_by_gmail_message_id is not null then
    action_fields := '{}'::text[];
  end if;

  if message_row.follow_up_cycle_id is not null and not exists (
    select 1
    from public.refund_follow_up_cycles cycle
    where cycle.id = message_row.follow_up_cycle_id
      and cycle.refund_case_id = case_row.id
      and cycle.status = 'waiting'
      and cycle.reply_customer_message_id is null
  ) then
    action_fields := '{}'::text[];
  end if;

  if message_row.requested_fields = array['zelle_payment_contact']::text[]
    and exists (
      select 1
      from public.refund_payout_destination_follow_ups follow_up
      where follow_up.refund_case_id = case_row.id
        and (
          follow_up.request_message_id = message_row.id
          or follow_up.reminder_message_id = message_row.id
        )
        and follow_up.status in ('satisfied', 'manual_review')
    ) then
    action_fields := '{}'::text[];
  end if;

  if message_row.message_type in (
      'wallet_correction', 'wallet_correction_reminder'
    )
    and case_row.payment_method = 'card'
    and case_row.card_wallet_used is true
    and case_row.wallet_correction_state = 'sent'
    and exists (
      select 1
      from public.refund_wallet_correction_contexts context
      where context.refund_case_id = case_row.id
        and context.version = case_row.wallet_correction_version
        and context.status = 'pending'
        and context.expires_at > statement_timestamp()
    ) then
    action_fields := array[
      'payment_interaction', 'wallet_provider', 'card_last4', 'card_network'
    ]::text[];
  end if;

  return jsonb_build_object(
    'valid', cardinality(action_fields) > 0,
    'reason', case
      when cardinality(action_fields) > 0 then 'sent_specific_request'
      when message_row.requested_fields_satisfied_by_gmail_message_id is not null
        then 'request_satisfied'
      else 'sent_notice_without_required_fields'
    end,
    'messageId', message_row.id,
    'messageType', message_row.message_type,
    'sentAt', message_row.sent_at,
    'requestedFields', to_jsonb(action_fields),
    'payloadRedacted', true
  );
end;
$$;

alter table public.refund_case_messages
  drop constraint if exists refund_case_messages_safe_evidence_shape,
  add constraint refund_case_messages_safe_evidence_shape check (
    (
      delivery_kind is null
      and content_source is null
      and reason_code is null
      and template_version is null
      and follow_up_cycle_id is null
      and payout_destination_follow_up_id is null
      and cardinality(requested_fields) = 0
    )
    or (
      delivery_kind = 'manual'
      and content_source in ('deterministic_template', 'manager_reviewed_gpt', 'manager_authored')
      and follow_up_cycle_id is null
      and payout_destination_follow_up_id is null
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
          and payout_destination_follow_up_id is null
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
          and payout_destination_follow_up_id is null
          and cardinality(requested_fields) = 0
        )
        or (
          message_type = 'appeal_received'
          and appeal_id is not null
          and reason_code = 'denial_appeal'
          and template_version = 'refund_appeal_received_v1'
          and follow_up_cycle_id is null
          and payout_destination_follow_up_id is null
          and cardinality(requested_fields) = 0
        )
        or (
          message_type = 'status_update'
          and reason_code in ('provider_delay', 'sla_at_risk')
          and template_version = 'refund_customer_status_v1'
          and follow_up_cycle_id is null
          and payout_destination_follow_up_id is null
          and cardinality(requested_fields) = 0
        )
        or (
          message_type = 'reminder'
          and reason_code = 'missing_information'
          and template_version = 'refund_payout_destination_v1'
          and follow_up_cycle_id is null
          and payout_destination_follow_up_id is not null
          and requested_fields = array['zelle_payment_contact']::text[]
        )
      )
    )
  );

create or replace function public.guard_refund_payout_destination_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  case_row public.refund_cases%rowtype;
  follow_up_row public.refund_payout_destination_follow_ups%rowtype;
  automatic_contact_enabled boolean := false;
begin
  -- Delivery receipts settle the immutable intent after the sending claim has
  -- finished, including after a reply, payment, or contact-gate change. Only
  -- the existing provider identity's recorded, monotonic delivery evidence may
  -- use this path; it cannot edit content, recipients, or resend the reminder.
  if tg_op = 'UPDATE'
    and old.delivery_kind = 'automatic'
    and old.payout_destination_follow_up_id is not null
    and old.delivery_transport = 'resend'
    and old.provider_message_id is not null
    and to_jsonb(new)
        - 'status' - 'error_message' - 'delivery_state' - 'delivery_state_updated_at'
      is not distinct from to_jsonb(old)
        - 'status' - 'error_message' - 'delivery_state' - 'delivery_state_updated_at'
    and public.refund_transactional_delivery_state_rank(new.delivery_state)
      >= public.refund_transactional_delivery_state_rank(old.delivery_state)
    and new.delivery_state_updated_at >= old.delivery_state_updated_at
    and new.status = case
      when new.delivery_state in ('failed', 'bounced', 'complained') then 'failed'
      else old.status end
    and new.error_message is not distinct from case new.delivery_state
      when 'failed' then 'transactional_delivery_failed'
      when 'bounced' then 'transactional_delivery_bounced'
      when 'complained' then 'transactional_delivery_complained'
      else old.error_message end
    and exists (
      select 1 from public.refund_transactional_delivery_events event
      where event.provider_message_id = old.provider_message_id
        and event.delivery_state = new.delivery_state
        and event.event_at <= new.delivery_state_updated_at
    ) then
    return new;
  end if;

  select refund_case.* into case_row
  from public.refund_cases refund_case
  where refund_case.id = new.refund_case_id
  for share;

  if not found
    or case_row.payment_method <> 'cash'
    or case_row.decision is distinct from 'approved'
    or (
      nullif(btrim(coalesce(case_row.zelle_payment_contact, '')), '') is not null
      and (tg_op = 'INSERT' or new.delivery_kind <> 'manual')
    )
    or lower(btrim(coalesce(new.recipient_email, ''))) <>
      lower(btrim(coalesce(case_row.customer_email, '')))
    or new.requested_fields is distinct from array['zelle_payment_contact']::text[]
    or new.reason_code is distinct from 'missing_information' then
    raise exception 'Protected payout-destination message is not eligible'
      using errcode = '23514';
  end if;

  if new.delivery_kind = 'manual' then
    if new.message_type <> 'more_info'
      or new.content_source not in ('manager_authored', 'manager_reviewed_gpt')
      or new.template_version is not null
      or new.follow_up_cycle_id is not null
      or new.payout_destination_follow_up_id is not null then
      raise exception 'Protected payout request requires one manager-reviewed ledger intent'
        using errcode = '23514';
    end if;

    if tg_op = 'UPDATE' then
      if to_jsonb(new)
          - 'status'
          - 'sent_at'
          - 'error_message'
          - 'manual_delivery_state'
          - 'manual_delivery_claim_token'
          - 'manual_delivery_claimed_at'
          - 'manual_delivery_provider_attempted_at'
          - 'manual_delivery_attempt_count'
          - 'delivery_transport'
          - 'provider_message_id'
          - 'delivery_state'
          - 'delivery_state_updated_at'
          - 'status_capability_id'
          - 'status_link_included'
          - 'requested_fields_satisfied_by_gmail_message_id'
          - 'requested_fields_satisfied_at'
        is distinct from to_jsonb(old)
          - 'status'
          - 'sent_at'
          - 'error_message'
          - 'manual_delivery_state'
          - 'manual_delivery_claim_token'
          - 'manual_delivery_claimed_at'
          - 'manual_delivery_provider_attempted_at'
          - 'manual_delivery_attempt_count'
          - 'delivery_transport'
          - 'provider_message_id'
          - 'delivery_state'
          - 'delivery_state_updated_at'
          - 'status_capability_id'
          - 'status_link_included'
          - 'requested_fields_satisfied_by_gmail_message_id'
          - 'requested_fields_satisfied_at' then
        raise exception 'Protected payout request content and identity are immutable'
          using errcode = '23514';
      end if;

      if new.requested_fields_satisfied_by_gmail_message_id is distinct from
          old.requested_fields_satisfied_by_gmail_message_id
        or new.requested_fields_satisfied_at is distinct from
          old.requested_fields_satisfied_at then
        if old.requested_fields_satisfied_by_gmail_message_id is not null
          or old.requested_fields_satisfied_at is not null
          or new.requested_fields_satisfied_by_gmail_message_id is null
          or new.requested_fields_satisfied_at is null
          or old.status <> 'sent'
          or old.sent_at is null
          or to_jsonb(new)
              - 'requested_fields_satisfied_by_gmail_message_id'
              - 'requested_fields_satisfied_at'
            is distinct from to_jsonb(old)
              - 'requested_fields_satisfied_by_gmail_message_id'
              - 'requested_fields_satisfied_at' then
          raise exception 'Protected payout request satisfaction evidence is invalid'
            using errcode = '23514';
        end if;

        if not exists (
          select 1
          from public.refund_gmail_messages source
          where source.id =
              new.requested_fields_satisfied_by_gmail_message_id
            and source.refund_case_id = new.refund_case_id
            and source.direction = 'inbound'
            and source.message_kind = 'message'
            and source.status = 'received'
            and source.participant_role = 'customer'
            and source.participant_trust = 'verified'
            and lower(btrim(source.sender_email)) =
              lower(btrim(case_row.customer_email))
            and source.received_at = new.requested_fields_satisfied_at
            and source.received_at >= old.sent_at
            and (
              exists (
                select 1
                from public.refund_gmail_messages outbound
                where outbound.refund_case_message_id = old.id
                  and outbound.direction = 'outbound'
                  and outbound.message_kind = 'message'
                  and outbound.status = 'sent'
                  and outbound.gmail_thread_id = source.gmail_thread_id
                  and coalesce(outbound.sent_at, outbound.received_at) <=
                    source.received_at
              )
              or (
                old.delivery_transport = 'resend'
                and old.provider_message_id is not null
                and position(upper(case_row.public_reference) in upper(
                  coalesce(source.subject, '') || E'\n' ||
                  coalesce(source.plain_body, '')
                )) > 0
              )
            )
        ) then
          raise exception 'Protected payout request satisfaction evidence is invalid'
            using errcode = '23514';
        end if;
      end if;
    end if;
    return new;
  end if;

  if new.delivery_kind <> 'automatic'
    or new.message_type <> 'reminder'
    or new.content_source <> 'deterministic_template'
    or new.template_version <> 'refund_payout_destination_v1'
    or new.follow_up_cycle_id is not null
    or new.payout_destination_follow_up_id is null then
    raise exception 'Protected payout reminder requires deterministic follow-up evidence'
      using errcode = '23514';
  end if;

  select follow_up.* into follow_up_row
  from public.refund_payout_destination_follow_ups follow_up
  where follow_up.id = new.payout_destination_follow_up_id
    and follow_up.refund_case_id = new.refund_case_id
  for update;

  if not found
    or follow_up_row.status <> 'reminder_claimed'
    or follow_up_row.reminder_claimed_at is null
    or follow_up_row.reminder_due_at > statement_timestamp()
    or (follow_up_row.reminder_message_id is not null
      and follow_up_row.reminder_message_id <> new.id) then
    raise exception 'Protected payout reminder is not due or already has evidence'
      using errcode = '23514';
  end if;

  if tg_op = 'INSERT' or (tg_op = 'UPDATE' and old.status = 'pending') then
    select settings.automatic_customer_contact_enabled
    into automatic_contact_enabled
    from public.refund_customer_contact_settings settings
    where settings.singleton;
    if not coalesce(automatic_contact_enabled, false) then
      raise exception 'Automatic customer contact is disabled'
        using errcode = '23514';
    end if;
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
      or new.payout_destination_follow_up_id is distinct from old.payout_destination_follow_up_id
      or new.requested_fields is distinct from old.requested_fields
      or new.created_at is distinct from old.created_at
      or old.status <> 'pending'
      or new.status not in ('pending', 'sent', 'failed', 'skipped') then
      raise exception 'Protected payout reminder evidence is immutable'
        using errcode = '23514';
    end if;
  end if;

  if new.status = 'sent' and new.sent_at is null then
    raise exception 'Sent payout reminder requires a sent timestamp'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists refund_case_messages_follow_up_guard
  on public.refund_case_messages;
create trigger refund_case_messages_follow_up_guard
before insert or update on public.refund_case_messages
for each row
when (
  new.message_type not in ('appeal_received', 'status_update')
  and new.payout_destination_follow_up_id is null
  and not (
    new.delivery_kind = 'manual'
    and new.message_type = 'more_info'
    and new.requested_fields = array['zelle_payment_contact']::text[]
  )
)
execute function public.guard_refund_follow_up_message();

drop trigger if exists refund_case_messages_payout_destination_guard
  on public.refund_case_messages;
create trigger refund_case_messages_payout_destination_guard
before insert or update on public.refund_case_messages
for each row
when (
  new.payout_destination_follow_up_id is not null
  or (
    new.delivery_kind = 'manual'
    and new.message_type = 'more_info'
    and new.requested_fields = array['zelle_payment_contact']::text[]
  )
)
execute function public.guard_refund_payout_destination_message();

alter function public.service_enqueue_refund_manual_message_intent(
  uuid, bigint, uuid, uuid, text, text, text, text, text, text, text,
  text[], uuid, boolean, uuid
) rename to service_enqueue_refund_manual_message_intent_pre_payout_recovery;

revoke all on function public.service_enqueue_refund_manual_message_intent_pre_payout_recovery(
  uuid, bigint, uuid, uuid, text, text, text, text, text, text, text,
  text[], uuid, boolean, uuid
) from public, anon, authenticated, service_role;

create function public.service_enqueue_refund_manual_message_intent(
  p_refund_case_id uuid,
  p_expected_case_version bigint,
  p_intent_id uuid,
  p_actor_user_id uuid,
  p_message_type text,
  p_recipient_email text,
  p_subject text,
  p_body text,
  p_template_key text,
  p_content_source text,
  p_reason_code text,
  p_requested_fields text[],
  p_synthetic_proof_authorization_id uuid,
  p_status_link_requested boolean,
  p_triage_suggestion_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_requested_fields is not distinct from array['zelle_payment_contact']::text[]
    and exists (
      select 1
      from public.refund_payout_destination_follow_ups follow_up
      join public.refund_case_messages request_message
        on request_message.id = follow_up.request_message_id
      where follow_up.refund_case_id = p_refund_case_id
        and request_message.manual_delivery_intent_id is distinct from p_intent_id
    ) then
    raise exception 'Payout destination contact already has a durable outcome; Refund Operations review is required before any new customer request'
      using errcode = 'P4662';
  end if;

  return public.service_enqueue_refund_manual_message_intent_pre_payout_recovery(
    p_refund_case_id,
    p_expected_case_version,
    p_intent_id,
    p_actor_user_id,
    p_message_type,
    p_recipient_email,
    p_subject,
    p_body,
    p_template_key,
    p_content_source,
    p_reason_code,
    p_requested_fields,
    p_synthetic_proof_authorization_id,
    p_status_link_requested,
    p_triage_suggestion_id
  );
end;
$$;

revoke execute on function public.service_enqueue_refund_manual_message_intent(
  uuid, bigint, uuid, uuid, text, text, text, text, text, text, text,
  text[], uuid, boolean, uuid
) from public, anon, authenticated;
grant execute on function public.service_enqueue_refund_manual_message_intent(
  uuid, bigint, uuid, uuid, text, text, text, text, text, text, text,
  text[], uuid, boolean, uuid
) to service_role;

alter function public.service_finish_refund_manual_message_delivery(
  uuid, uuid, text, text, text, integer, text
) rename to service_finish_refund_manual_message_delivery_pre_payout_follow_up;

revoke all on function public.service_finish_refund_manual_message_delivery_pre_payout_follow_up(
  uuid, uuid, text, text, text, integer, text
) from public, anon, authenticated, service_role;

create function public.service_finish_refund_manual_message_delivery(
  p_refund_case_message_id uuid,
  p_claim_token uuid,
  p_outcome text,
  p_transport text,
  p_error_code text,
  p_manager_cc_count integer,
  p_recipient_resolution_status text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  result jsonb;
  message_row public.refund_case_messages%rowtype;
  delay_hours integer;
  due_at timestamptz;
begin
  result := public.service_finish_refund_manual_message_delivery_pre_payout_follow_up(
    p_refund_case_message_id,
    p_claim_token,
    p_outcome,
    p_transport,
    p_error_code,
    p_manager_cc_count,
    p_recipient_resolution_status
  );

  select message.* into message_row
  from public.refund_case_messages message
  where message.id = p_refund_case_message_id;

  if result ->> 'outcome' = 'sent'
    and message_row.message_type = 'more_info'
    and message_row.delivery_kind = 'manual'
    and message_row.requested_fields = array['zelle_payment_contact']::text[] then
    select settings.reminder_delay_hours into delay_hours
    from public.refund_customer_contact_settings settings
    where settings.singleton;
    delay_hours := least(greatest(coalesce(delay_hours, 48), 24), 168);
    due_at := message_row.sent_at + make_interval(hours => delay_hours);

    insert into public.refund_payout_destination_follow_ups (
      refund_case_id,
      request_message_id,
      reminder_delay_hours,
      reminder_due_at
    ) values (
      message_row.refund_case_id,
      message_row.id,
      delay_hours,
      due_at
    ) on conflict (refund_case_id) do nothing;

    update public.refund_cases refund_case
    set automation_follow_up_due_at = due_at
    where refund_case.id = message_row.refund_case_id
      and refund_case.payment_method = 'cash'
      and refund_case.decision = 'approved'
      and nullif(btrim(coalesce(refund_case.zelle_payment_contact, '')), '') is null;
  end if;

  return result;
end;
$$;

revoke execute on function public.service_finish_refund_manual_message_delivery(
  uuid, uuid, text, text, text, integer, text
) from public, anon, authenticated;
grant execute on function public.service_finish_refund_manual_message_delivery(
  uuid, uuid, text, text, text, integer, text
) to service_role;

create or replace function public.sync_refund_payout_destination_follow_up_from_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  follow_up_row public.refund_payout_destination_follow_ups%rowtype;
  next_due timestamptz;
begin
  if new.payout_destination_follow_up_id is null then return new; end if;

  select follow_up.* into follow_up_row
  from public.refund_payout_destination_follow_ups follow_up
  where follow_up.id = new.payout_destination_follow_up_id
  for update;

  if tg_op = 'INSERT' then
    update public.refund_payout_destination_follow_ups follow_up
    set reminder_message_id = coalesce(follow_up.reminder_message_id, new.id),
        updated_at = statement_timestamp()
    where follow_up.id = follow_up_row.id;
    return new;
  end if;

  if old.status = 'pending' and new.status = 'sent' then
    next_due := new.sent_at + make_interval(hours => follow_up_row.reminder_delay_hours);
    update public.refund_payout_destination_follow_ups follow_up
    set status = 'reminder_sent',
        reminder_claim_token = null,
        reminder_sent_at = new.sent_at,
        escalation_due_at = next_due,
        updated_at = statement_timestamp()
    where follow_up.id = follow_up_row.id;

    update public.refund_cases refund_case
    set automation_follow_up_due_at = next_due,
        customer_last_contacted_at = new.sent_at,
        last_customer_message_type = 'reminder'
    where refund_case.id = follow_up_row.refund_case_id;
  elsif old.status in ('pending', 'sent') and new.status in ('failed', 'skipped') then
    update public.refund_payout_destination_follow_ups follow_up
    set status = 'manual_review',
        reminder_claim_token = null,
        manual_review_at = statement_timestamp(),
        updated_at = statement_timestamp()
    where follow_up.id = follow_up_row.id
      and follow_up.status <> 'satisfied';

    update public.refund_cases refund_case
    set status = 'needs_review',
        automation_state = 'under_review',
        automation_follow_up_due_at = null
    where refund_case.id = follow_up_row.refund_case_id
      and refund_case.status = 'waiting_on_customer'
      and follow_up_row.status <> 'satisfied';
  end if;
  return new;
end;
$$;

drop trigger if exists refund_case_messages_sync_payout_destination_follow_up
  on public.refund_case_messages;
create trigger refund_case_messages_sync_payout_destination_follow_up
after insert or update of status, sent_at on public.refund_case_messages
for each row
when (new.payout_destination_follow_up_id is not null)
execute function public.sync_refund_payout_destination_follow_up_from_message();

create or replace function public.service_claim_due_refund_payout_destination_follow_ups(
  p_limit integer default 25,
  p_customer_contact_runtime_enabled boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  settings_row public.refund_customer_contact_settings%rowtype;
  follow_up_row public.refund_payout_destination_follow_ups%rowtype;
  claimed_row public.refund_payout_destination_follow_ups%rowtype;
  reminders jsonb := '[]'::jsonb;
  escalated integer := 0;
  contact_disabled_to_review integer := 0;
  paused_thread_to_review integer := 0;
  contact_enabled boolean := false;
  normalized_limit integer := least(greatest(coalesce(p_limit, 25), 1), 100);
begin
  select settings.* into settings_row
  from public.refund_customer_contact_settings settings
  where settings.singleton;

  contact_enabled := coalesce(settings_row.automatic_customer_contact_enabled, false)
    and coalesce(p_customer_contact_runtime_enabled, false);

  -- Reconcile immutable provider evidence before treating an interrupted
  -- worker as uncertain. Never make a second provider call for the same row.
  update public.refund_case_messages message
  set status = 'sent',
      sent_at = coalesce(message.sent_at, outbound.sent_at, statement_timestamp())
  from public.refund_gmail_messages outbound
  where message.payout_destination_follow_up_id is not null
    and message.status = 'pending'
    and outbound.refund_case_message_id = message.id
    and outbound.direction = 'outbound'
    and outbound.status = 'sent'
    and outbound.sent_at is not null;

  update public.refund_case_messages message
  set status = 'sent',
      sent_at = coalesce(message.sent_at, message.delivery_state_updated_at,
        statement_timestamp())
  where message.payout_destination_follow_up_id is not null
    and message.status = 'pending'
    and message.provider_message_id is not null
    and message.delivery_state in ('accepted', 'delivered');

  update public.refund_case_messages message
  set status = 'failed',
      error_message = 'payout_reminder_delivery_requires_review'
  from public.refund_payout_destination_follow_ups follow_up
  where message.id = follow_up.reminder_message_id
    and message.status = 'pending'
    and follow_up.status = 'reminder_claimed'
    and follow_up.reminder_claimed_at < statement_timestamp() - interval '10 minutes';

  update public.refund_payout_destination_follow_ups follow_up
  set status = 'waiting',
      reminder_claim_token = null,
      reminder_claimed_at = null,
      updated_at = statement_timestamp()
  where follow_up.status = 'reminder_claimed'
    and follow_up.reminder_message_id is null
    and follow_up.reminder_claimed_at < statement_timestamp() - interval '10 minutes';

  for follow_up_row in
    select follow_up.*
    from public.refund_payout_destination_follow_ups follow_up
    join public.refund_cases refund_case on refund_case.id = follow_up.refund_case_id
    where follow_up.status = 'reminder_sent'
      and follow_up.escalation_due_at <= statement_timestamp()
      and nullif(btrim(coalesce(refund_case.zelle_payment_contact, '')), '') is null
    order by follow_up.escalation_due_at, follow_up.id
    limit normalized_limit
    for update of follow_up skip locked
  loop
    update public.refund_payout_destination_follow_ups follow_up
    set status = 'manual_review',
        manual_review_at = statement_timestamp(),
        updated_at = statement_timestamp()
    where follow_up.id = follow_up_row.id;

    update public.refund_cases refund_case
    set status = case when refund_case.status = 'waiting_on_customer'
          then 'needs_review' else refund_case.status end,
        automation_state = 'under_review',
        automation_follow_up_due_at = null
    where refund_case.id = follow_up_row.refund_case_id;

    insert into public.refund_case_events (
      refund_case_id, event_type, message, metadata
    ) values (
      follow_up_row.refund_case_id,
      'refund_payout_destination_contact_exhausted',
      'The single payout-destination reminder window ended; Refund Operations review is required.',
      jsonb_build_object(
        'follow_up_id', follow_up_row.id,
        'requested_fields', jsonb_build_array('zelle_payment_contact'),
        'payload_redacted', true
      )
    );
    escalated := escalated + 1;
  end loop;

  if not contact_enabled then
    for follow_up_row in
      select follow_up.*
      from public.refund_payout_destination_follow_ups follow_up
      join public.refund_cases refund_case on refund_case.id = follow_up.refund_case_id
      join public.refund_case_messages request_message
        on request_message.id = follow_up.request_message_id
      where follow_up.status = 'waiting'
        and follow_up.reminder_due_at <= statement_timestamp()
        and request_message.requested_fields_satisfied_by_gmail_message_id is null
        and refund_case.payment_method = 'cash'
        and refund_case.decision = 'approved'
        and nullif(btrim(coalesce(refund_case.zelle_payment_contact, '')), '') is null
      order by follow_up.reminder_due_at, follow_up.id
      limit normalized_limit
      for update of follow_up skip locked
    loop
      update public.refund_payout_destination_follow_ups follow_up
      set status = 'manual_review',
          reminder_claim_token = null,
          manual_review_at = statement_timestamp(),
          updated_at = statement_timestamp()
      where follow_up.id = follow_up_row.id;

      update public.refund_cases refund_case
      set status = case when refund_case.status = 'waiting_on_customer'
            then 'needs_review' else refund_case.status end,
          automation_state = 'under_review',
          automation_follow_up_due_at = null
      where refund_case.id = follow_up_row.refund_case_id;

      insert into public.refund_case_events (
        refund_case_id, event_type, message, metadata
      ) values (
        follow_up_row.refund_case_id,
        'refund_payout_destination_contact_suppressed',
        'Automatic payout-destination contact was disabled; Refund Operations review is required.',
        jsonb_build_object(
          'follow_up_id', follow_up_row.id,
          'requested_fields', jsonb_build_array('zelle_payment_contact'),
          'automatic_contact_enabled', false,
          'payload_redacted', true
        )
      );
      contact_disabled_to_review := contact_disabled_to_review + 1;
    end loop;

    return jsonb_build_object(
      'enabled', false,
      'reminders', reminders,
      'escalated', escalated,
      'contactDisabledToReview', contact_disabled_to_review,
      'reason', 'automatic_customer_contact_disabled',
      'payloadRedacted', true
    );
  end if;

  for follow_up_row in
    select follow_up.*
    from public.refund_payout_destination_follow_ups follow_up
    join public.refund_cases refund_case on refund_case.id = follow_up.refund_case_id
    join public.refund_case_messages request_message
      on request_message.id = follow_up.request_message_id
    where follow_up.status = 'waiting'
      and follow_up.reminder_due_at <= statement_timestamp()
      and request_message.requested_fields_satisfied_by_gmail_message_id is null
      and refund_case.payment_method = 'cash'
      and refund_case.decision = 'approved'
      and nullif(btrim(coalesce(refund_case.zelle_payment_contact, '')), '') is null
      and exists (
        select 1 from public.refund_gmail_threads thread
        where thread.refund_case_id = follow_up.refund_case_id
          and thread.automatic_customer_contact_paused_at is not null
      )
    order by follow_up.reminder_due_at, follow_up.id
    limit normalized_limit
    for update of follow_up skip locked
  loop
    update public.refund_payout_destination_follow_ups follow_up
    set status = 'manual_review',
        reminder_claim_token = null,
        manual_review_at = statement_timestamp(),
        updated_at = statement_timestamp()
    where follow_up.id = follow_up_row.id;

    update public.refund_cases refund_case
    set status = case when refund_case.status = 'waiting_on_customer'
          then 'needs_review' else refund_case.status end,
        automation_state = 'under_review',
        automation_follow_up_due_at = null
    where refund_case.id = follow_up_row.refund_case_id;

    insert into public.refund_case_events (
      refund_case_id, event_type, message, metadata
    ) values (
      follow_up_row.refund_case_id,
      'refund_payout_destination_contact_paused',
      'The customer thread is paused; Refund Operations review is required.',
      jsonb_build_object(
        'follow_up_id', follow_up_row.id,
        'requested_fields', jsonb_build_array('zelle_payment_contact'),
        'payload_redacted', true
      )
    );
    paused_thread_to_review := paused_thread_to_review + 1;
  end loop;

  for follow_up_row in
    select follow_up.*
    from public.refund_payout_destination_follow_ups follow_up
    join public.refund_cases refund_case on refund_case.id = follow_up.refund_case_id
    join public.refund_case_messages request_message
      on request_message.id = follow_up.request_message_id
    where follow_up.status = 'waiting'
      and follow_up.reminder_due_at <= statement_timestamp()
      and request_message.requested_fields_satisfied_by_gmail_message_id is null
      and refund_case.payment_method = 'cash'
      and refund_case.decision = 'approved'
      and nullif(btrim(coalesce(refund_case.zelle_payment_contact, '')), '') is null
      and not exists (
        select 1 from public.refund_gmail_threads thread
        where thread.refund_case_id = follow_up.refund_case_id
          and thread.automatic_customer_contact_paused_at is not null
      )
    order by follow_up.reminder_due_at, follow_up.id
    limit normalized_limit
    for update of follow_up skip locked
  loop
    update public.refund_payout_destination_follow_ups follow_up
    set status = 'reminder_claimed',
        reminder_claim_token = gen_random_uuid(),
        reminder_claimed_at = statement_timestamp(),
        updated_at = statement_timestamp()
    where follow_up.id = follow_up_row.id
    returning * into claimed_row;

    reminders := reminders || jsonb_build_array(jsonb_build_object(
      'followUpId', claimed_row.id,
      'refundCaseId', claimed_row.refund_case_id,
      'claimToken', claimed_row.reminder_claim_token,
      'reminderIntentId', claimed_row.reminder_intent_id,
      'requestMessageId', claimed_row.request_message_id,
      'requestedFields', jsonb_build_array('zelle_payment_contact'),
      'payloadRedacted', true
    ));
  end loop;

  return jsonb_build_object(
    'enabled', true,
    'reminders', reminders,
    'escalated', escalated,
    'contactDisabledToReview', contact_disabled_to_review,
    'pausedThreadToReview', paused_thread_to_review,
    'payloadRedacted', true
  );
end;
$$;

revoke execute on function public.service_claim_due_refund_payout_destination_follow_ups(integer, boolean)
  from public, anon, authenticated;
grant execute on function public.service_claim_due_refund_payout_destination_follow_ups(integer, boolean)
  to service_role;

create or replace function public.service_create_refund_payout_destination_reminder_message(
  p_follow_up_id uuid,
  p_claim_token uuid,
  p_subject text,
  p_body text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  follow_up_row public.refund_payout_destination_follow_ups%rowtype;
  case_row public.refund_cases%rowtype;
  request_row public.refund_case_messages%rowtype;
  message_row public.refund_case_messages%rowtype;
  normalized_subject text := btrim(coalesce(p_subject, ''));
  normalized_body text := btrim(coalesce(p_body, ''));
begin
  if p_follow_up_id is null or p_claim_token is null
    or normalized_subject = '' or length(normalized_subject) > 180
    or normalized_body = '' or length(normalized_body) > 4000 then
    raise exception 'Valid protected payout reminder content is required';
  end if;

  select follow_up.* into follow_up_row
  from public.refund_payout_destination_follow_ups follow_up
  where follow_up.id = p_follow_up_id
  for update;
  if not found
    or follow_up_row.status <> 'reminder_claimed'
    or follow_up_row.reminder_claim_token is distinct from p_claim_token then
    raise exception 'Protected payout reminder claim changed';
  end if;

  if follow_up_row.reminder_message_id is not null then
    select message.* into message_row
    from public.refund_case_messages message
    where message.id = follow_up_row.reminder_message_id;
    return jsonb_build_object(
      'created', true,
      'replayed', true,
      'messageId', message_row.id,
      'payloadRedacted', true
    );
  end if;

  select refund_case.* into case_row
  from public.refund_cases refund_case
  where refund_case.id = follow_up_row.refund_case_id
  for update;
  select message.* into request_row
  from public.refund_case_messages message
  where message.id = follow_up_row.request_message_id;

  if case_row.payment_method <> 'cash'
    or case_row.decision is distinct from 'approved'
    or nullif(btrim(coalesce(case_row.zelle_payment_contact, '')), '') is not null
    or request_row.status <> 'sent'
    or request_row.requested_fields_satisfied_by_gmail_message_id is not null then
    raise exception 'Protected payout reminder facts changed';
  end if;

  insert into public.refund_case_messages (
    refund_case_id,
    message_type,
    status,
    recipient_email,
    subject,
    body,
    template_key,
    created_by,
    content_source,
    delivery_kind,
    reason_code,
    template_version,
    requested_fields,
    follow_up_cycle_id,
    payout_destination_follow_up_id
  ) values (
    case_row.id,
    'reminder',
    'pending',
    case_row.customer_email,
    normalized_subject,
    normalized_body,
    'refund_payout_destination_reminder_v1',
    request_row.created_by,
    'deterministic_template',
    'automatic',
    'missing_information',
    'refund_payout_destination_v1',
    array['zelle_payment_contact']::text[],
    null,
    follow_up_row.id
  ) returning * into message_row;

  return jsonb_build_object(
    'created', true,
    'replayed', false,
    'messageId', message_row.id,
    'payloadRedacted', true
  );
end;
$$;

revoke execute on function public.service_create_refund_payout_destination_reminder_message(
  uuid, uuid, text, text
) from public, anon, authenticated;
grant execute on function public.service_create_refund_payout_destination_reminder_message(
  uuid, uuid, text, text
) to service_role;

alter function public.service_apply_refund_gmail_customer_facts_v1(
  uuid, uuid, bigint, jsonb, text[], text
) rename to service_apply_refund_gmail_customer_facts_pre_payout_destination;

revoke all on function public.service_apply_refund_gmail_customer_facts_pre_payout_destination(
  uuid, uuid, bigint, jsonb, text[], text
) from public, anon, authenticated, service_role;

create function public.service_apply_refund_gmail_customer_facts_v1(
  p_refund_case_id uuid,
  p_gmail_message_id uuid,
  p_expected_fact_version bigint,
  p_updates jsonb,
  p_applied_fields text[],
  p_extraction_policy text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  source_row public.refund_gmail_messages%rowtype;
  case_row public.refund_cases%rowtype;
  prior_application public.refund_customer_fact_applications%rowtype;
  request_message public.refund_case_messages%rowtype;
  event_row public.refund_case_events%rowtype;
  destination text := btrim(coalesce(p_updates ->> 'zelle_payment_contact', ''));
  payout_path boolean :=
    p_updates ? 'zelle_payment_contact'
    or 'zelle_payment_contact' = any(coalesce(p_applied_fields, '{}'::text[]));
begin
  if not payout_path then
    return public.service_apply_refund_gmail_customer_facts_pre_payout_destination(
      p_refund_case_id,
      p_gmail_message_id,
      p_expected_fact_version,
      p_updates,
      p_applied_fields,
      p_extraction_policy
    );
  end if;

  if p_refund_case_id is null
    or p_gmail_message_id is null
    or coalesce(p_expected_fact_version, 0) < 1
    or pg_catalog.jsonb_typeof(p_updates) <> 'object'
    or p_updates is distinct from jsonb_build_object(
      'zelle_payment_contact',
      p_updates -> 'zelle_payment_contact'
    )
    or not (p_updates ? 'zelle_payment_contact')
    or public.canonical_refund_follow_up_fields(p_applied_fields)
      is distinct from array['zelle_payment_contact']::text[]
    or p_extraction_policy not in (
      'labeled_customer_correction_v3',
      'labeled_routine_facts_v1'
    )
    or length(destination) > 320
    or not (
      destination ~ '^[^[:space:]@<>]+@[^[:space:]@<>]+\.[^[:space:]@<>]+$'
      or regexp_replace(destination, '[[:space:]().-]', '', 'g')
        ~ '^\+?[0-9]{10,15}$'
    ) then
    raise exception 'Valid protected payout destination reply required';
  end if;

  select message.* into source_row
  from public.refund_gmail_messages message
  where message.id = p_gmail_message_id
  for update;
  if source_row.id is null
    or source_row.refund_case_id <> p_refund_case_id
    or source_row.direction <> 'inbound'
    or source_row.message_kind <> 'message'
    or source_row.status <> 'received'
    or source_row.participant_role <> 'customer'
    or source_row.participant_trust <> 'verified' then
    return jsonb_build_object(
      'outcome', 'conflict',
      'reason', 'source_not_eligible'
    );
  end if;

  select application.* into prior_application
  from public.refund_customer_fact_applications application
  where application.gmail_message_id = p_gmail_message_id;
  if prior_application.gmail_message_id is not null then
    return jsonb_build_object(
      'outcome', 'already_applied',
      'factVersion', prior_application.resulting_fact_version
    );
  end if;

  select refund_case.* into case_row
  from public.refund_cases refund_case
  where refund_case.id = p_refund_case_id
  for update;
  if case_row.id is null
    or case_row.deterministic_fact_version <> p_expected_fact_version then
    return jsonb_build_object(
      'outcome', 'conflict',
      'reason', 'fact_version_changed',
      'factVersion', case_row.deterministic_fact_version
    );
  end if;
  if case_row.payment_method <> 'cash'
    or nullif(btrim(coalesce(case_row.zelle_payment_contact, '')), '') is not null then
    return jsonb_build_object(
      'outcome', 'conflict',
      'reason', 'payout_destination_not_expected',
      'factVersion', case_row.deterministic_fact_version
    );
  end if;

  select message.* into request_message
  from public.refund_case_messages message
  where message.refund_case_id = case_row.id
    and message.status = 'sent'
    and message.sent_at is not null
    and message.message_type = 'more_info'
    and message.requested_fields = array['zelle_payment_contact']::text[]
    and message.requested_fields_satisfied_by_gmail_message_id is null
  order by message.sent_at desc, message.id desc
  limit 1
  for update;
  if request_message.id is null then
    return jsonb_build_object(
      'outcome', 'conflict',
      'reason', 'payout_destination_request_not_active',
      'factVersion', case_row.deterministic_fact_version
    );
  end if;

  if exists (
    select 1
    from public.refund_gmail_messages outbound
    where outbound.refund_case_message_id = request_message.id
      and outbound.direction = 'outbound'
      and outbound.message_kind = 'message'
      and outbound.status = 'sent'
  ) then
    if not exists (
      select 1
      from public.refund_gmail_messages outbound
      where outbound.refund_case_message_id = request_message.id
        and outbound.direction = 'outbound'
        and outbound.message_kind = 'message'
        and outbound.status = 'sent'
        and outbound.gmail_thread_id = source_row.gmail_thread_id
        and coalesce(outbound.sent_at, outbound.received_at) <= source_row.received_at
    ) then
      return jsonb_build_object(
        'outcome', 'conflict',
        'reason', 'payout_destination_reply_thread_mismatch',
        'factVersion', case_row.deterministic_fact_version
      );
    end if;
  elsif request_message.delivery_transport = 'resend'
    and request_message.provider_message_id is not null then
    if source_row.received_at < request_message.sent_at
      or position(upper(case_row.public_reference) in upper(
        coalesce(source_row.subject, '') || E'\n' || coalesce(source_row.plain_body, '')
      )) = 0 then
      return jsonb_build_object(
        'outcome', 'conflict',
        'reason', 'payout_destination_reply_reference_mismatch',
        'factVersion', case_row.deterministic_fact_version
      );
    end if;
  else
    return jsonb_build_object(
      'outcome', 'conflict',
      'reason', 'payout_destination_delivery_evidence_missing',
      'factVersion', case_row.deterministic_fact_version
    );
  end if;

  update public.refund_case_messages message
  set
    requested_fields_satisfied_by_gmail_message_id = p_gmail_message_id,
    requested_fields_satisfied_at = source_row.received_at
  where message.id = request_message.id;

  update public.refund_case_messages message
  set status = 'skipped',
      error_message = 'payout_destination_reply_superseded_reminder'
  from public.refund_payout_destination_follow_ups follow_up
  where follow_up.request_message_id = request_message.id
    and message.id = follow_up.reminder_message_id
    and message.status = 'pending';

  update public.refund_cases refund_case
  set
    zelle_payment_contact = destination,
    status = case when refund_case.status = 'waiting_on_customer'
      then 'needs_review' else refund_case.status end,
    automation_state = 'customer_replied',
    automation_follow_up_due_at = null
  where refund_case.id = case_row.id
  returning refund_case.* into case_row;

  if case_row.deterministic_fact_version <= p_expected_fact_version then
    raise exception 'Payout destination reply made no protected fact change';
  end if;

  insert into public.refund_case_events (
    refund_case_id, event_type, message, metadata
  ) values (
    case_row.id,
    'gmail_customer_facts_applied',
    'The verified customer reply supplied the requested payout destination on the same refund case.',
    jsonb_build_object(
      'applied_fields', jsonb_build_array('zelle_payment_contact'),
      'extraction_policy', p_extraction_policy,
      'resulting_fact_version', case_row.deterministic_fact_version,
      'request_message_id', request_message.id,
      'payload_redacted', true
    )
  ) returning * into event_row;

  insert into public.refund_customer_fact_applications (
    gmail_message_id,
    refund_case_id,
    event_id,
    expected_fact_version,
    resulting_fact_version,
    applied_fields,
    extraction_policy
  ) values (
    p_gmail_message_id,
    case_row.id,
    event_row.id,
    p_expected_fact_version,
    case_row.deterministic_fact_version,
    array['zelle_payment_contact']::text[],
    p_extraction_policy
  );

  update public.refund_payout_destination_follow_ups follow_up
  set status = 'satisfied',
      reminder_claim_token = null,
      satisfied_by_gmail_message_id = p_gmail_message_id,
      satisfied_at = source_row.received_at,
      updated_at = statement_timestamp()
  where follow_up.request_message_id = request_message.id;

  return jsonb_build_object(
    'outcome', 'applied',
    'factVersion', case_row.deterministic_fact_version
  );
end;
$$;

revoke all on function public.service_apply_refund_gmail_customer_facts_v1(
  uuid, uuid, bigint, jsonb, text[], text
) from public, anon, authenticated;
grant execute on function public.service_apply_refund_gmail_customer_facts_v1(
  uuid, uuid, bigint, jsonb, text[], text
) to service_role;

revoke execute on function public.canonical_refund_follow_up_fields(text[])
  from public, anon, authenticated;
grant execute on function public.canonical_refund_follow_up_fields(text[])
  to service_role;

comment on column public.refund_case_messages.requested_fields_satisfied_by_gmail_message_id is
  'Verified same-case Gmail reply that satisfied this exact protected customer request; the payout value remains on refund_cases and is never copied into message or event metadata.';
