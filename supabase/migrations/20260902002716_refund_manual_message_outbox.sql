-- #917: make manager-authored refund email a durable, replay-safe outbox.
-- The manager request commits one immutable intent before provider access.
-- A bounded worker claim then delivers with the message id as the provider
-- idempotency identity. Customer-wait lifecycle state is advanced only by the
-- same transaction that records a successful send.

alter table public.refund_case_messages
  add column if not exists manual_delivery_intent_id uuid,
  add column if not exists manual_delivery_state text,
  add column if not exists manual_delivery_expected_case_version bigint,
  add column if not exists manual_delivery_claim_token uuid,
  add column if not exists manual_delivery_claimed_at timestamptz,
  add column if not exists manual_delivery_provider_attempted_at timestamptz,
  add column if not exists manual_delivery_attempt_count smallint not null default 0,
  add column if not exists manual_delivery_status_link_requested boolean not null default false,
  add column if not exists manual_delivery_triage_suggestion_id uuid
    references public.refund_gpt_triage_runs(id) on delete restrict;

alter table public.refund_case_messages
  drop constraint if exists refund_case_messages_manual_delivery_state_check,
  add constraint refund_case_messages_manual_delivery_state_check check (
    manual_delivery_state is null
    or manual_delivery_state in (
      'queued', 'claimed', 'sent', 'failed', 'delivery_unknown'
    )
  ),
  drop constraint if exists refund_case_messages_manual_delivery_attempt_check,
  add constraint refund_case_messages_manual_delivery_attempt_check check (
    manual_delivery_attempt_count between 0 and 3
  ),
  drop constraint if exists refund_case_messages_manual_delivery_claim_check,
  add constraint refund_case_messages_manual_delivery_claim_check check (
    (manual_delivery_state = 'claimed'
      and manual_delivery_claim_token is not null
      and manual_delivery_claimed_at is not null)
    or (manual_delivery_state is distinct from 'claimed'
      and manual_delivery_claim_token is null
      and manual_delivery_claimed_at is null)
  ),
  drop constraint if exists refund_case_messages_manual_delivery_intent_check,
  add constraint refund_case_messages_manual_delivery_intent_check check (
    (manual_delivery_state is null
      and manual_delivery_intent_id is null
      and manual_delivery_expected_case_version is null
      and manual_delivery_provider_attempted_at is null
      and manual_delivery_status_link_requested is false
      and manual_delivery_triage_suggestion_id is null)
    or (manual_delivery_state is not null
      and manual_delivery_intent_id is not null
      and manual_delivery_expected_case_version > 0
      and delivery_kind = 'manual'
      and content_source in ('manager_authored', 'manager_reviewed_gpt'))
  );

create unique index if not exists refund_case_messages_manual_intent_unique
  on public.refund_case_messages (manual_delivery_intent_id);

create unique index if not exists refund_case_messages_one_active_manual_intent
  on public.refund_case_messages (refund_case_id)
  where manual_delivery_state in ('queued', 'claimed');

create index if not exists refund_case_messages_manual_outbox_due_idx
  on public.refund_case_messages (created_at, id)
  where manual_delivery_state in ('queued', 'claimed');

create or replace function public.service_enqueue_refund_manual_message_intent(
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
declare
  case_row public.refund_cases%rowtype;
  message_row public.refund_case_messages%rowtype;
  normalized_recipient text := lower(btrim(coalesce(p_recipient_email, '')));
  normalized_subject text := btrim(coalesce(p_subject, ''));
  normalized_body text := btrim(coalesce(p_body, ''));
  normalized_template_key text := btrim(coalesce(p_template_key, ''));
  inserted boolean := false;
begin
  if p_refund_case_id is null
    or p_expected_case_version is null or p_expected_case_version < 1
    or p_intent_id is null or p_actor_user_id is null
    or p_message_type not in ('more_info', 'status_update', 'approved', 'denied', 'completed')
    or p_content_source not in ('manager_authored', 'manager_reviewed_gpt')
    or normalized_recipient !~ '^[^[:space:]@<>]+@[^[:space:]@<>]+\.[^[:space:]@<>]+$'
    or length(normalized_recipient) > 320
    or normalized_subject = '' or length(normalized_subject) > 180
    or normalized_body = '' or length(normalized_body) > 4000
    or normalized_template_key !~ '^refund_[a-z_]+_editable_v1$'
    or normalized_template_key <>
      ('refund_' || p_message_type || '_editable_v1')
    or coalesce(array_length(p_requested_fields, 1), 0) > 8
    or not coalesce(p_requested_fields, '{}'::text[]) <@ array[
      'location_or_machine', 'incident_date', 'incident_time',
      'payment_method', 'amount', 'card_last4'
    ]::text[]
    or (p_message_type = 'more_info'
      and coalesce(array_length(p_requested_fields, 1), 0) = 0)
    or (p_message_type <> 'more_info'
      and coalesce(array_length(p_requested_fields, 1), 0) > 0) then
    raise exception 'Valid refund manual-message intent is required'
      using errcode = 'P4655';
  end if;

  select refund_case.* into case_row
  from public.refund_cases refund_case
  where refund_case.id = p_refund_case_id
  for update;

  if not found then
    raise exception 'Refund case not found' using errcode = 'P4655';
  end if;
  if case_row.case_population = 'internal_test' then
    raise exception 'Customer delivery is suppressed for Internal/test cases'
      using errcode = 'P4640';
  end if;
  if case_row.official_action_version is distinct from p_expected_case_version then
    raise exception 'Refund case changed before message intent'
      using errcode = 'P4609';
  end if;
  if lower(btrim(coalesce(case_row.customer_email, ''))) <> normalized_recipient then
    raise exception 'Refund customer address changed before message intent'
      using errcode = 'P4655';
  end if;
  if not exists (select 1 from auth.users actor where actor.id = p_actor_user_id) then
    raise exception 'Refund message actor is invalid' using errcode = 'P4655';
  end if;
  if p_triage_suggestion_id is not null and p_content_source <> 'manager_reviewed_gpt' then
    raise exception 'Refund triage evidence does not match message source'
      using errcode = 'P4655';
  end if;
  if p_triage_suggestion_id is null and p_content_source = 'manager_reviewed_gpt' then
    raise exception 'Refund triage evidence is required for reviewed content'
      using errcode = 'P4655';
  end if;

  select existing.* into message_row
  from public.refund_case_messages existing
  where existing.manual_delivery_intent_id = p_intent_id;

  if found then
    if message_row.refund_case_id is distinct from p_refund_case_id
      or message_row.created_by is distinct from p_actor_user_id
      or message_row.message_type is distinct from p_message_type
      or lower(btrim(message_row.recipient_email)) is distinct from normalized_recipient
      or message_row.subject is distinct from normalized_subject
      or message_row.body is distinct from normalized_body
      or message_row.template_key is distinct from normalized_template_key
      or message_row.content_source is distinct from p_content_source
      or message_row.reason_code is distinct from p_reason_code
      or message_row.requested_fields is distinct from coalesce(p_requested_fields, '{}'::text[])
      or message_row.synthetic_gmail_proof_authorization_id is distinct from p_synthetic_proof_authorization_id
      or message_row.manual_delivery_status_link_requested is distinct from coalesce(p_status_link_requested, false)
      or message_row.manual_delivery_triage_suggestion_id is distinct from p_triage_suggestion_id
      or message_row.manual_delivery_expected_case_version is distinct from p_expected_case_version then
      raise exception 'Refund message intent identity is already bound'
        using errcode = 'P4656';
    end if;
    return jsonb_build_object(
      'enqueued', true,
      'replayed', true,
      'messageId', message_row.id,
      'messageStatus', message_row.status,
      'outboxState', message_row.manual_delivery_state,
      'payloadRedacted', true
    );
  end if;

  if exists (
    select 1 from public.refund_case_messages active
    where active.refund_case_id = p_refund_case_id
      and active.manual_delivery_state in ('queued', 'claimed')
  ) then
    raise exception 'A customer message is already queued for this case'
      using errcode = 'P4657';
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
    synthetic_gmail_proof_authorization_id,
    status_capability_id,
    status_link_included,
    manual_delivery_intent_id,
    manual_delivery_state,
    manual_delivery_expected_case_version,
    manual_delivery_status_link_requested,
    manual_delivery_triage_suggestion_id
  ) values (
    p_refund_case_id,
    p_message_type,
    'pending',
    normalized_recipient,
    normalized_subject,
    normalized_body,
    normalized_template_key,
    p_actor_user_id,
    p_content_source,
    'manual',
    p_reason_code,
    null,
    coalesce(p_requested_fields, '{}'::text[]),
    p_synthetic_proof_authorization_id,
    null,
    false,
    p_intent_id,
    'queued',
    p_expected_case_version,
    coalesce(p_status_link_requested, false),
    p_triage_suggestion_id
  ) returning * into message_row;
  inserted := true;

  insert into public.refund_case_events (
    refund_case_id, actor_user_id, event_type, message, metadata
  ) values (
    p_refund_case_id,
    p_actor_user_id,
    'customer_message_queued',
    'Manager customer message entered the durable delivery queue.',
    jsonb_build_object(
      'message_id', message_row.id,
      'message_type', p_message_type,
      'outbox_state', 'queued',
      'expected_case_version', p_expected_case_version,
      'payload_redacted', true
    )
  );

  return jsonb_build_object(
    'enqueued', inserted,
    'replayed', false,
    'messageId', message_row.id,
    'messageStatus', message_row.status,
    'outboxState', message_row.manual_delivery_state,
    'payloadRedacted', true
  );
exception
  when unique_violation then
    select existing.* into message_row
    from public.refund_case_messages existing
    where existing.manual_delivery_intent_id = p_intent_id;
    if found
      and message_row.refund_case_id = p_refund_case_id
      and message_row.created_by = p_actor_user_id
      and message_row.message_type is not distinct from p_message_type
      and lower(btrim(message_row.recipient_email)) is not distinct from normalized_recipient
      and message_row.subject is not distinct from normalized_subject
      and message_row.body is not distinct from normalized_body
      and message_row.template_key is not distinct from normalized_template_key
      and message_row.content_source is not distinct from p_content_source
      and message_row.reason_code is not distinct from p_reason_code
      and message_row.requested_fields is not distinct from coalesce(p_requested_fields, '{}'::text[])
      and message_row.synthetic_gmail_proof_authorization_id is not distinct from p_synthetic_proof_authorization_id
      and message_row.manual_delivery_status_link_requested is not distinct from coalesce(p_status_link_requested, false)
      and message_row.manual_delivery_triage_suggestion_id is not distinct from p_triage_suggestion_id
      and message_row.manual_delivery_expected_case_version is not distinct from p_expected_case_version then
      return jsonb_build_object(
        'enqueued', true,
        'replayed', true,
        'messageId', message_row.id,
        'messageStatus', message_row.status,
        'outboxState', message_row.manual_delivery_state,
        'payloadRedacted', true
      );
    end if;
    if exists (
      select 1 from public.refund_case_messages active
      where active.refund_case_id = p_refund_case_id
        and active.manual_delivery_state in ('queued', 'claimed')
    ) then
      raise exception 'A customer message is already queued for this case'
        using errcode = 'P4657';
    end if;
    raise;
end;
$$;

create or replace function public.service_mark_refund_manual_message_provider_attempt(
  p_refund_case_message_id uuid,
  p_claim_token uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  message_row public.refund_case_messages%rowtype;
  case_row public.refund_cases%rowtype;
begin
  if p_refund_case_message_id is null or p_claim_token is null then
    raise exception 'Valid refund manual-message provider attempt is required'
      using errcode = 'P4660';
  end if;

  select message.* into message_row
  from public.refund_case_messages message
  where message.id = p_refund_case_message_id
  for update;
  if not found
    or message_row.status <> 'pending'
    or message_row.manual_delivery_state <> 'claimed'
    or message_row.manual_delivery_claim_token is distinct from p_claim_token then
    raise exception 'Refund manual-message delivery claim changed'
      using errcode = 'P4659';
  end if;

  select refund_case.* into case_row
  from public.refund_cases refund_case
  where refund_case.id = message_row.refund_case_id
  for update;
  if case_row.case_population = 'internal_test'
    or case_row.official_action_version is distinct from
      message_row.manual_delivery_expected_case_version then
    raise exception 'Refund case changed before provider attempt'
      using errcode = 'P4609';
  end if;

  if message_row.manual_delivery_provider_attempted_at is not null then
    return jsonb_build_object(
      'marked', true,
      'replayed', true,
      'messageId', message_row.id,
      'payloadRedacted', true
    );
  end if;

  update public.refund_case_messages message
  set manual_delivery_provider_attempted_at = statement_timestamp()
  where message.id = message_row.id;

  return jsonb_build_object(
    'marked', true,
    'replayed', false,
    'messageId', message_row.id,
    'payloadRedacted', true
  );
end;
$$;

create or replace function public.service_claim_refund_manual_message_deliveries(
  p_refund_case_message_id uuid,
  p_limit integer
)
returns table(refund_case_message_id uuid, claim_token uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_limit integer := least(greatest(coalesce(p_limit, 10), 1), 25);
begin
  -- If a case changed after provider access began, preserve uncertainty and
  -- never replay the stale content or call it a pre-provider cancellation.
  with uncertain as (
    update public.refund_case_messages message
    set
      manual_delivery_state = 'delivery_unknown',
      manual_delivery_claim_token = null,
      manual_delivery_claimed_at = null,
      status = 'failed',
      error_message = 'manual_delivery_case_changed_after_provider_attempt'
    from public.refund_cases refund_case
    where refund_case.id = message.refund_case_id
      and message.status = 'pending'
      and message.manual_delivery_state = 'claimed'
      and message.manual_delivery_provider_attempted_at is not null
      and (p_refund_case_message_id is null or message.id = p_refund_case_message_id)
      and (
        refund_case.case_population = 'internal_test'
        or refund_case.official_action_version is distinct from
          message.manual_delivery_expected_case_version
      )
    returning message.id, message.refund_case_id, message.created_by,
      message.message_type, message.error_message
  )
  insert into public.refund_case_events (
    refund_case_id, actor_user_id, event_type, message, metadata
  )
  select
    uncertain.refund_case_id,
    uncertain.created_by,
    'customer_message_failed',
    'Queued customer message delivery requires reconciliation.',
    jsonb_build_object(
      'message_id', uncertain.id,
      'message_type', uncertain.message_type,
      'error_code', uncertain.error_message,
      'provider_result', 'unknown',
      'payload_redacted', true
    )
  from uncertain;

  -- A case-version change or Internal/test classification invalidates an
  -- unsent intent. It becomes manager-owned evidence and is never delivered.
  with invalid as (
    update public.refund_case_messages message
    set
      manual_delivery_state = 'failed',
      manual_delivery_claim_token = null,
      manual_delivery_claimed_at = null,
      status = 'failed',
      error_message = case
        when refund_case.case_population = 'internal_test'
          then 'internal_test_customer_contact_suppressed'
        else 'manual_delivery_case_version_changed'
      end
    from public.refund_cases refund_case
    where refund_case.id = message.refund_case_id
      and message.status = 'pending'
      and message.manual_delivery_state in ('queued', 'claimed')
      and message.manual_delivery_provider_attempted_at is null
      and (p_refund_case_message_id is null or message.id = p_refund_case_message_id)
      and (
        refund_case.case_population = 'internal_test'
        or refund_case.official_action_version is distinct from
          message.manual_delivery_expected_case_version
      )
    returning message.id, message.refund_case_id, message.created_by,
      message.message_type, message.error_message
  )
  insert into public.refund_case_events (
    refund_case_id, actor_user_id, event_type, message, metadata
  )
  select
    invalid.refund_case_id,
    invalid.created_by,
    'customer_message_failed',
    'Queued customer message was cancelled before provider access.',
    jsonb_build_object(
      'message_id', invalid.id,
      'message_type', invalid.message_type,
      'error_code', invalid.error_message,
      'provider_accessed', false,
      'payload_redacted', true
    )
  from invalid;

  -- Reclaim interrupted workers with the same immutable message/provider
  -- idempotency identity. Three abandoned claims exhaust the automatic lane.
  with exhausted as (
    update public.refund_case_messages message
    set
      manual_delivery_state = 'failed',
      manual_delivery_claim_token = null,
      manual_delivery_claimed_at = null,
      status = 'failed',
      error_message = 'manual_delivery_claims_exhausted'
    where message.status = 'pending'
      and message.manual_delivery_state = 'claimed'
      and message.manual_delivery_claimed_at < statement_timestamp() - interval '10 minutes'
      and message.manual_delivery_attempt_count >= 3
      and (p_refund_case_message_id is null or message.id = p_refund_case_message_id)
    returning message.id, message.refund_case_id, message.created_by,
      message.message_type, message.manual_delivery_provider_attempted_at
  )
  insert into public.refund_case_events (
    refund_case_id, actor_user_id, event_type, message, metadata
  )
  select
    exhausted.refund_case_id,
    exhausted.created_by,
    'customer_message_failed',
    'Queued customer message requires Refund Operations delivery review.',
    jsonb_build_object(
      'message_id', exhausted.id,
      'message_type', exhausted.message_type,
      'error_code', 'manual_delivery_claims_exhausted',
      'provider_result', case
        when exhausted.manual_delivery_provider_attempted_at is null
          then 'not_started'
        else 'unknown'
      end,
      'payload_redacted', true
    )
  from exhausted;

  update public.refund_case_messages message
  set
    manual_delivery_state = 'queued',
    manual_delivery_claim_token = null,
    manual_delivery_claimed_at = null
  where message.status = 'pending'
    and message.manual_delivery_state = 'claimed'
    and message.manual_delivery_claimed_at < statement_timestamp() - interval '10 minutes'
    and message.manual_delivery_attempt_count < 3
    and (p_refund_case_message_id is null or message.id = p_refund_case_message_id);

  return query
  with candidates as (
    select message.id
    from public.refund_case_messages message
    where message.status = 'pending'
      and message.manual_delivery_state = 'queued'
      and (p_refund_case_message_id is null or message.id = p_refund_case_message_id)
    order by message.created_at, message.id
    limit normalized_limit
    for update skip locked
  ), claimed as (
    update public.refund_case_messages message
    set
      manual_delivery_state = 'claimed',
      manual_delivery_claim_token = gen_random_uuid(),
      manual_delivery_claimed_at = statement_timestamp(),
      manual_delivery_attempt_count = message.manual_delivery_attempt_count + 1,
      error_message = null
    from candidates
    where message.id = candidates.id
    returning message.id, message.manual_delivery_claim_token
  )
  select claimed.id, claimed.manual_delivery_claim_token
  from claimed
  order by claimed.id;
end;
$$;

create or replace function public.service_finish_refund_manual_message_delivery(
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
  case_id uuid;
  case_row public.refund_cases%rowtype;
  message_row public.refund_case_messages%rowtype;
  normalized_error text := nullif(btrim(coalesce(p_error_code, '')), '');
  normalized_recipient_status text := nullif(
    btrim(coalesce(p_recipient_resolution_status, '')), ''
  );
  case_updated boolean := false;
begin
  if p_refund_case_message_id is null or p_claim_token is null
    or p_outcome not in ('sent', 'failed', 'delivery_unknown')
    or (p_outcome = 'sent' and p_transport not in ('gmail_thread', 'transactional_email'))
    or (p_outcome <> 'sent' and p_transport is not null)
    or coalesce(p_manager_cc_count, 0) < 0
    or coalesce(p_manager_cc_count, 0) > 4
    or (normalized_error is not null and normalized_error !~ '^[a-z0-9_:-]{3,160}$')
    or (normalized_recipient_status is not null
      and normalized_recipient_status !~ '^[a-z0-9_:-]{3,160}$') then
    raise exception 'Valid refund manual-message delivery result is required'
      using errcode = 'P4658';
  end if;

  select message.refund_case_id into case_id
  from public.refund_case_messages message
  where message.id = p_refund_case_message_id;
  if case_id is null then
    raise exception 'Refund customer message not found' using errcode = 'P4658';
  end if;

  select refund_case.* into case_row
  from public.refund_cases refund_case
  where refund_case.id = case_id
  for update;

  select message.* into message_row
  from public.refund_case_messages message
  where message.id = p_refund_case_message_id
  for update;

  if message_row.manual_delivery_state = 'sent'
    and message_row.status = 'sent' then
    return jsonb_build_object(
      'finished', true,
      'replayed', true,
      'messageId', message_row.id,
      'outcome', 'sent',
      'payloadRedacted', true
    );
  end if;
  if message_row.manual_delivery_state <> 'claimed'
    or message_row.manual_delivery_claim_token is distinct from p_claim_token
    or message_row.status <> 'pending' then
    raise exception 'Refund manual-message delivery claim changed'
      using errcode = 'P4659';
  end if;

  update public.refund_case_messages message
  set
    manual_delivery_state = p_outcome,
    manual_delivery_claim_token = null,
    manual_delivery_claimed_at = null,
    status = case when p_outcome = 'sent' then 'sent' else 'failed' end,
    sent_at = case
      when p_outcome = 'sent' then coalesce(message.sent_at, statement_timestamp())
      else message.sent_at
    end,
    error_message = case
      when p_outcome = 'sent' then null
      when p_outcome = 'delivery_unknown' then
        coalesce(normalized_error, 'manual_delivery_result_unknown')
      else coalesce(normalized_error, 'manual_delivery_failed')
    end
  where message.id = message_row.id
  returning * into message_row;

  if p_outcome = 'sent'
    and case_row.case_population <> 'internal_test'
    and case_row.official_action_version =
      message_row.manual_delivery_expected_case_version then
    update public.refund_cases refund_case
    set
      automation_state = case message_row.message_type
        when 'more_info' then 'more_info_needed'
        when 'approved' then 'approved'
        when 'denied' then 'denied'
        when 'completed' then 'completed'
        else 'under_review'
      end,
      customer_last_contacted_at = statement_timestamp(),
      last_customer_message_type = message_row.message_type,
      automation_follow_up_due_at = null
    where refund_case.id = case_row.id;
    case_updated := found;
  end if;

  insert into public.refund_case_events (
    refund_case_id, actor_user_id, event_type, message, metadata
  ) values (
    message_row.refund_case_id,
    message_row.created_by,
    case when p_outcome = 'sent'
      then 'customer_message_sent'
      else 'customer_message_failed'
    end,
    case
      when p_outcome = 'sent' and p_transport = 'gmail_thread'
        then 'Manager customer message was sent in the linked Gmail thread.'
      when p_outcome = 'sent'
        then 'Manager customer message was accepted by the transactional email provider.'
      when p_outcome = 'delivery_unknown'
        then 'Manager customer message delivery requires reconciliation.'
      else 'Manager customer message could not be sent.'
    end,
    jsonb_build_object(
      'message_id', message_row.id,
      'message_type', message_row.message_type,
      'outbox_state', p_outcome,
      'transport', p_transport,
      'manager_cc_count', coalesce(p_manager_cc_count, 0),
      'recipient_resolution_status', normalized_recipient_status,
      'case_lifecycle_updated', case_updated,
      'error_code', normalized_error,
      'payload_redacted', true
    )
  );

  return jsonb_build_object(
    'finished', true,
    'replayed', false,
    'messageId', message_row.id,
    'outcome', p_outcome,
    'caseLifecycleUpdated', case_updated,
    'payloadRedacted', true
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

revoke execute on function public.service_mark_refund_manual_message_provider_attempt(
  uuid, uuid
) from public, anon, authenticated;
grant execute on function public.service_mark_refund_manual_message_provider_attempt(
  uuid, uuid
) to service_role;

revoke execute on function public.service_claim_refund_manual_message_deliveries(
  uuid, integer
) from public, anon, authenticated;
grant execute on function public.service_claim_refund_manual_message_deliveries(
  uuid, integer
) to service_role;

revoke execute on function public.service_finish_refund_manual_message_delivery(
  uuid, uuid, text, text, text, integer, text
) from public, anon, authenticated;
grant execute on function public.service_finish_refund_manual_message_delivery(
  uuid, uuid, text, text, text, integer, text
) to service_role;

comment on function public.service_enqueue_refund_manual_message_intent(
  uuid, bigint, uuid, uuid, text, text, text, text, text, text, text,
  text[], uuid, boolean, uuid
) is 'Commits one version-bound manager-authored refund message intent and redacted audit event before provider access.';
comment on function public.service_mark_refund_manual_message_provider_attempt(
  uuid, uuid
) is 'Marks the claim immediately before customer-message provider access so later recovery never misstates an unknown attempt as pre-provider cancellation.';
comment on function public.service_claim_refund_manual_message_deliveries(
  uuid, integer
) is 'Claims queued manager-authored refund messages with bounded stale-claim recovery and SKIP LOCKED concurrency.';
comment on function public.service_finish_refund_manual_message_delivery(
  uuid, uuid, text, text, text, integer, text
) is 'Atomically records manager-authored delivery outcome, redacted audit evidence, and sent-only customer lifecycle state.';

select pg_notify('pgrst', 'reload schema');
