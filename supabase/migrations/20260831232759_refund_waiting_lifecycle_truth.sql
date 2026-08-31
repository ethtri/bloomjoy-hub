-- #891: a case may wait on a customer only after a sent message names a
-- deterministic customer-correctable field. Notice-only no-match mail remains
-- useful, but it is Bloomjoy-owned review work rather than a customer wait.

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

  -- The secure wallet form predates requested_fields. Its bounded, single-use
  -- context still names a deterministic correction set without storing payment
  -- values in lifecycle output. Preserve that existing safe path while making
  -- its action explicit to managers.
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

revoke all on function public.refund_customer_action_contract(uuid)
  from public, anon, authenticated, service_role;

comment on function public.refund_customer_action_contract(uuid) is
  'Redacted proof that the latest successfully sent customer request names deterministic customer-correctable fields.';

create or replace function public.guard_refund_case_customer_waiting_truth()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  action_contract jsonb;
  requested_wait boolean;
  requested_more_info boolean;
begin
  requested_wait := new.status = 'waiting_on_customer';
  requested_more_info := new.automation_state = 'more_info_needed';

  if not requested_wait and not requested_more_info then return new; end if;

  action_contract := public.refund_customer_action_contract(new.id);
  if coalesce((action_contract ->> 'valid')::boolean, false) then
    return new;
  end if;

  if requested_wait then new.status := 'needs_review'; end if;
  if requested_more_info then new.automation_state := 'under_review'; end if;
  new.automation_follow_up_due_at := null;

  insert into public.refund_case_events (
    refund_case_id,
    event_type,
    message,
    metadata
  )
  select
    new.id,
    'customer_waiting_contract_rejected',
    'The case stayed in manager review because no sent message named a required customer correction.',
    jsonb_build_object(
      'requested_status', case when requested_wait then 'waiting_on_customer' else null end,
      'requested_automation_state', case when requested_more_info then 'more_info_needed' else null end,
      'reason', coalesce(action_contract ->> 'reason', 'missing_contract'),
      'payload_redacted', true
    )
  where not exists (
    select 1
    from public.refund_case_events event
    where event.refund_case_id = new.id
      and event.event_type = 'customer_waiting_contract_rejected'
      and event.metadata ->> 'reason' = coalesce(
        action_contract ->> 'reason',
        'missing_contract'
      )
  );

  return new;
end;
$$;

drop trigger if exists refund_cases_customer_waiting_truth_guard
  on public.refund_cases;
create trigger refund_cases_customer_waiting_truth_guard
before update of status, automation_state on public.refund_cases
for each row
when (
  new.status = 'waiting_on_customer'
  or new.automation_state = 'more_info_needed'
)
execute function public.guard_refund_case_customer_waiting_truth();

revoke all on function public.guard_refund_case_customer_waiting_truth()
  from public, anon, authenticated, service_role;

create or replace function public.sync_refund_waiting_truth_from_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  cycle_row public.refund_follow_up_cycles%rowtype;
  specific_fields boolean := false;
begin
  if new.status <> 'sent'
    or new.sent_at is null
    or (
      tg_op = 'UPDATE'
      and old.status = 'sent'
      and old.sent_at is not distinct from new.sent_at
    ) then
    return new;
  end if;

  if new.follow_up_cycle_id is not null
    and new.message_type in ('more_info', 'no_safe_match', 'reminder') then
    select cycle.* into cycle_row
    from public.refund_follow_up_cycles cycle
    where cycle.id = new.follow_up_cycle_id;

    if cycle_row.id is null then return new; end if;
    specific_fields := cardinality(
      public.canonical_refund_follow_up_fields(cycle_row.requested_fields)
    ) > 0;

    if new.message_type in ('more_info', 'no_safe_match') then
      update public.refund_cases
      set
        status = case
          when status = 'draft' then status
          when specific_fields then 'waiting_on_customer'
          else 'needs_review'
        end,
        automation_state = case
          when specific_fields then 'more_info_needed'
          else 'under_review'
        end,
        automation_follow_up_due_at = case
          when specific_fields then new.sent_at
            + make_interval(hours => cycle_row.reminder_delay_hours)
          else null
        end,
        customer_last_contacted_at = new.sent_at,
        last_customer_message_type = new.message_type
      where id = new.refund_case_id
        and status not in ('approved', 'denied', 'completed', 'closed');
    elsif new.message_type = 'reminder' then
      update public.refund_follow_up_cycles
      set status = case when specific_fields then status else 'manual_review' end
      where id = cycle_row.id;

      update public.refund_cases
      set
        status = case
          when specific_fields then status
          when status = 'waiting_on_customer' then 'needs_review'
          else status
        end,
        automation_state = case
          when specific_fields then 'more_info_needed'
          else 'under_review'
        end,
        automation_follow_up_due_at = null,
        customer_last_contacted_at = new.sent_at,
        last_customer_message_type = new.message_type
      where id = new.refund_case_id
        and status not in ('approved', 'denied', 'completed', 'closed');
    end if;
  elsif new.message_type in ('wallet_correction', 'wallet_correction_reminder') then
    -- service_issue_refund_wallet_correction prepares the token before delivery.
    -- Enter the customer-wait state only after the outbound row is sent.
    update public.refund_cases
    set
      status = 'waiting_on_customer',
      automation_state = 'wallet_correction_sent',
      automation_follow_up_due_at = (
        select context.expires_at
        from public.refund_wallet_correction_contexts context
        where context.refund_case_id = new.refund_case_id
          and context.version = public.refund_cases.wallet_correction_version
          and context.status = 'pending'
        order by context.created_at desc, context.id desc
        limit 1
      ),
      customer_last_contacted_at = new.sent_at,
      last_customer_message_type = new.message_type
    where id = new.refund_case_id
      and payment_method = 'card'
      and card_wallet_used is true
      and wallet_correction_state = 'sent'
      and status not in ('approved', 'denied', 'completed', 'closed');
  end if;

  return new;
end;
$$;

drop trigger if exists zz_refund_case_messages_waiting_truth_sync
  on public.refund_case_messages;
create trigger zz_refund_case_messages_waiting_truth_sync
after insert or update of status, sent_at on public.refund_case_messages
for each row execute function public.sync_refund_waiting_truth_from_message();

revoke all on function public.sync_refund_waiting_truth_from_message()
  from public, anon, authenticated, service_role;

-- Repair only the redacted state contract. Historical messages remain
-- immutable and no customer/provider action is performed.
with invalid_cases as (
  select refund_case.id
  from public.refund_cases refund_case
  where refund_case.status = 'waiting_on_customer'
    and not coalesce(
      (
        public.refund_customer_action_contract(refund_case.id) ->> 'valid'
      )::boolean,
      false
    )
), repaired as (
  update public.refund_cases refund_case
  set
    status = 'needs_review',
    automation_state = 'under_review',
    automation_follow_up_due_at = null
  from invalid_cases
  where refund_case.id = invalid_cases.id
  returning refund_case.id
)
insert into public.refund_case_events (
  refund_case_id,
  event_type,
  message,
  metadata
)
select
  repaired.id,
  'customer_waiting_contract_repaired',
  'The case returned to manager review because no sent message named a required customer correction.',
  jsonb_build_object(
    'disposition', 'needs_review',
    'customer_message_sent', false,
    'payload_redacted', true
  )
from repaired;

with invalid_more_info as (
  select refund_case.id
  from public.refund_cases refund_case
  where refund_case.automation_state = 'more_info_needed'
    and not coalesce(
      (
        public.refund_customer_action_contract(refund_case.id) ->> 'valid'
      )::boolean,
      false
    )
), repaired as (
  update public.refund_cases refund_case
  set
    automation_state = 'under_review',
    automation_follow_up_due_at = null
  from invalid_more_info
  where refund_case.id = invalid_more_info.id
  returning refund_case.id
)
insert into public.refund_case_events (
  refund_case_id,
  event_type,
  message,
  metadata
)
select
  repaired.id,
  'more_information_state_repaired',
  'The case returned to manager review because no sent information request exists.',
  jsonb_build_object(
    'disposition', 'under_review',
    'payload_redacted', true
  )
from repaired;

alter function public.refund_lifecycle_contract(uuid)
  rename to refund_lifecycle_contract_pre_waiting_truth_v2;

revoke execute on function
  public.refund_lifecycle_contract_pre_waiting_truth_v2(uuid)
  from public, anon, authenticated, service_role;

create function public.refund_lifecycle_contract(
  p_refund_case_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  lifecycle jsonb;
  case_row public.refund_cases%rowtype;
  action_contract jsonb;
  action_valid boolean := false;
begin
  select refund_case.* into case_row
  from public.refund_cases refund_case
  where refund_case.id = p_refund_case_id;
  if not found then return null; end if;

  lifecycle := public.refund_lifecycle_contract_pre_waiting_truth_v2(
    p_refund_case_id
  );
  if lifecycle is null then return null; end if;

  action_contract := public.refund_customer_action_contract(p_refund_case_id);
  action_valid := coalesce((action_contract ->> 'valid')::boolean, false);

  if action_valid then
    lifecycle := lifecycle || jsonb_build_object(
      'customerAction', action_contract,
      'managerQueue', coalesce(lifecycle -> 'managerQueue', '{}'::jsonb)
        || jsonb_build_object(
          'customerActionFields', action_contract -> 'requestedFields'
        )
    );
  end if;

  if (
      lifecycle ->> 'stage' = 'waiting_on_customer'
      or case_row.status = 'waiting_on_customer'
      or case_row.automation_state = 'more_info_needed'
    ) and not action_valid then
    lifecycle := lifecycle || jsonb_build_object(
      'stage', 'matching',
      'stageRank', 10,
      'evidenceState', 'customer_contact_contract_missing',
      'publicCopyKey', 'refund_under_review',
      'managerNextAction', 'review_customer_contact',
      'terminal', false,
      'refreshAfterSeconds', 15,
      'customerAction', action_contract,
      'managerQueue', jsonb_build_object(
        'schemaVersion', 'refund_manager_queue_v1',
        'bucket', 'needs_action',
        'label', 'Action needed',
        'nextAction', 'review_customer_contact',
        'safeRetryEligible', false,
        'customerActionFields', '[]'::jsonb,
        'payloadRedacted', true
      )
    );
  end if;

  return lifecycle;
end;
$$;

revoke all on function public.refund_lifecycle_contract(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.refund_lifecycle_contract(uuid)
  to service_role;

comment on function public.refund_lifecycle_contract(uuid) is
  'Canonical refund lifecycle; waiting_on_customer and more_info_needed require one successfully sent deterministic customer action contract.';
