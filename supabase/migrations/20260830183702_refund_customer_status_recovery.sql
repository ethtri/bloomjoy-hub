-- Customer-safe status updates use the existing exactly-once automation
-- journal. This migration does not enable customer contact or execute refunds.

alter table public.refund_automation_actions
  drop constraint if exists refund_automation_actions_type_check;

alter table public.refund_automation_actions
  add constraint refund_automation_actions_type_check
  check (action_type in (
    'nayax_lookup',
    'customer_reminder',
    'customer_more_info',
    'wallet_correction_request',
    'wallet_correction_reminder',
    'customer_information_received',
    'customer_reply_recheck',
    'customer_status_update',
    'provider_exception',
    'manager_reminder',
    'manager_escalation',
    'internal_escalation',
    'ops_alert'
  ));

create or replace function public.service_claim_refund_automation_action(
  p_run_id uuid,
  p_refund_case_id uuid,
  p_action_key text,
  p_action_type text,
  p_case_state text default null,
  p_policy_window_start timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_action_key text;
  action_row public.refund_automation_actions;
  claimed boolean := false;
begin
  if not exists (
    select 1
    from public.refund_automation_runs automation_run
    where automation_run.id = p_run_id
      and automation_run.status = 'running'
  ) then
    raise exception 'An active refund automation run is required';
  end if;

  if p_refund_case_id is not null and not exists (
    select 1 from public.refund_cases where id = p_refund_case_id
  ) then
    raise exception 'Refund case not found';
  end if;

  normalized_action_key := nullif(btrim(coalesce(p_action_key, '')), '');
  if normalized_action_key is null
    or length(normalized_action_key) not between 8 and 220
    or normalized_action_key !~ '^[A-Za-z0-9:._-]+$' then
    raise exception 'A safe refund automation action key is required';
  end if;

  if p_action_type not in (
    'nayax_lookup',
    'customer_reminder',
    'customer_more_info',
    'wallet_correction_request',
    'wallet_correction_reminder',
    'customer_information_received',
    'customer_reply_recheck',
    'customer_status_update',
    'provider_exception',
    'manager_reminder',
    'manager_escalation',
    'internal_escalation',
    'ops_alert'
  ) then
    raise exception 'Unsupported refund automation action type';
  end if;

  insert into public.refund_automation_actions (
    run_id,
    refund_case_id,
    action_key,
    action_type,
    case_state,
    policy_window_start,
    metadata
  ) values (
    p_run_id,
    p_refund_case_id,
    normalized_action_key,
    p_action_type,
    nullif(btrim(coalesce(p_case_state, '')), ''),
    p_policy_window_start,
    jsonb_build_object('payload_redacted', true)
  )
  on conflict (action_key) do nothing
  returning * into action_row;

  if action_row.id is not null then
    claimed := true;
  else
    select * into action_row
    from public.refund_automation_actions
    where action_key = normalized_action_key;

    if action_row.action_type <> p_action_type
      or action_row.refund_case_id is distinct from p_refund_case_id then
      raise exception 'Refund automation action key collision';
    end if;
  end if;

  return jsonb_build_object(
    'actionId', action_row.id,
    'claimed', claimed,
    'status', action_row.status,
    'reasonCategory', action_row.reason_category
  );
end;
$$;

comment on function public.service_claim_refund_automation_action(
  uuid, uuid, text, text, text, timestamptz
) is 'Claims one privacy-safe refund automation action; customer status updates are independently journaled so delivery is never blindly retried.';

alter table public.refund_case_messages
  drop constraint if exists refund_case_messages_reason_code_check,
  add constraint refund_case_messages_reason_code_check check (
    reason_code is null
    or reason_code in (
      'missing_information', 'no_safe_match', 'denial_appeal',
      'provider_delay', 'sla_at_risk'
    )
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
        or (
          message_type = 'status_update'
          and reason_code in ('provider_delay', 'sla_at_risk')
          and template_version = 'refund_customer_status_v1'
          and follow_up_cycle_id is null
          and cardinality(requested_fields) = 0
        )
      )
    )
  );

comment on constraint refund_case_messages_safe_evidence_shape
  on public.refund_case_messages is
  'Automatic provider-delay and SLA messages are deterministic, redacted status updates and are not payment decisions.';

drop trigger if exists refund_case_messages_follow_up_guard
  on public.refund_case_messages;
create trigger refund_case_messages_follow_up_guard
before insert or update on public.refund_case_messages
for each row
when (new.message_type not in ('appeal_received', 'status_update'))
execute function public.guard_refund_follow_up_message();

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
    or case_row.status not in ('submitted', 'needs_review', 'correlated', 'card_refund_pending')
    or case_row.decision is not null
    or lower(btrim(new.recipient_email)) <> lower(btrim(case_row.customer_email))
    or new.content_source <> 'deterministic_template'
    or new.reason_code not in ('provider_delay', 'sla_at_risk')
    or new.template_version <> 'refund_customer_status_v1'
    or new.follow_up_cycle_id is not null
    or cardinality(new.requested_fields) <> 0 then
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

drop trigger if exists refund_case_messages_customer_status_guard
  on public.refund_case_messages;
create trigger refund_case_messages_customer_status_guard
before insert or update on public.refund_case_messages
for each row
when (new.message_type = 'status_update')
execute function public.guard_refund_customer_status_message();

revoke all on function public.guard_refund_customer_status_message()
  from public, anon, authenticated, service_role;
