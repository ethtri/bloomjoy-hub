-- #1262: project completion contact from durable transport evidence. This is a
-- read-only projection change: no message, provider, payment, or case row is
-- written by these functions.

create function public.refund_completion_contact_contract(p_refund_case_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  message_row public.refund_case_messages%rowtype;
  gmail_row public.refund_gmail_messages%rowtype;
  adoption_sent_at timestamptz;
  observation_sent_at timestamptz;
  callback_state text;
  callback_at timestamptz;
  contact_state text := 'none';
  provider_identity_recorded boolean := false;
  sent_evidence_at timestamptz;
  state_updated_at timestamptz;
begin
  select adoption.sent_at into adoption_sent_at
  from public.refund_completion_notice_adoptions adoption
  where adoption.refund_case_id = p_refund_case_id;

  select observation.sent_at into observation_sent_at
  from public.refund_external_notice_observations observation
  where observation.refund_case_id = p_refund_case_id;

  if adoption_sent_at is not null or observation_sent_at is not null then
    contact_state := 'sent';
    provider_identity_recorded := true;
    sent_evidence_at := coalesce(adoption_sent_at, observation_sent_at);
    state_updated_at := sent_evidence_at;
  else
    select message.* into message_row
    from public.refund_case_messages message
    where message.refund_case_id = p_refund_case_id
      and message.message_type = 'completed'
    order by message.created_at desc, message.id desc
    limit 1;

    if message_row.id is not null then
      select gmail.* into gmail_row
      from public.refund_gmail_messages gmail
      where gmail.refund_case_message_id = message_row.id
        and gmail.direction = 'outbound'
      order by gmail.created_at desc, gmail.id desc
      limit 1;

      provider_identity_recorded :=
        (message_row.delivery_transport = 'resend'
          and nullif(btrim(message_row.provider_message_id), '') is not null)
        or (gmail_row.status = 'sent'
          and nullif(btrim(gmail_row.provider_message_id), '') is not null);
      sent_evidence_at := coalesce(message_row.sent_at, gmail_row.sent_at);

      if message_row.provider_message_id is not null then
        select event.delivery_state, event.event_at
        into callback_state, callback_at
        from public.refund_transactional_delivery_events event
        where event.provider_message_id = message_row.provider_message_id
          and event.matched_refund_case_message_id = message_row.id
          and event.delivery_state in ('delivered', 'failed', 'bounced', 'complained')
        order by public.refund_transactional_delivery_state_rank(event.delivery_state) desc,
          event.event_at desc, event.event_key_digest desc
        limit 1;
      end if;

      contact_state := case
        when callback_state in ('complained', 'bounced', 'delivered') then callback_state
        when callback_state = 'failed' then 'failed'
        when message_row.manual_delivery_state = 'delivery_unknown'
          or gmail_row.status = 'delivery_unknown' then 'delivery_unconfirmed'
        when message_row.status = 'failed'
          or message_row.manual_delivery_state = 'failed'
          or gmail_row.status = 'failed' then 'failed'
        when message_row.manual_delivery_state in ('queued', 'claimed')
          or message_row.status = 'pending' then 'pending'
        when (message_row.status = 'sent' or gmail_row.status = 'sent')
          and sent_evidence_at is not null and provider_identity_recorded then 'sent'
        when message_row.status = 'sent' or gmail_row.status = 'sent'
          then 'delivery_unconfirmed'
        else 'none'
      end;
      state_updated_at := coalesce(
        callback_at, message_row.delivery_state_updated_at, sent_evidence_at,
        gmail_row.updated_at, message_row.created_at
      );
    end if;
  end if;

  return jsonb_build_object(
    'state', contact_state,
    'messageType', case when message_row.id is not null then 'completed' else null end,
    'lastUpdatedAt', state_updated_at,
    'payloadRedacted', true
  );
end;
$$;

revoke all on function public.refund_completion_contact_contract(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.refund_completion_contact_contract(uuid)
  to service_role;

comment on function public.refund_completion_contact_contract(uuid) is
  'Redacted completion-contact truth. Sent requires time plus provider identity; delivered/bounced/complained require callback evidence.';

create function public.refund_apply_completion_contact_to_lifecycle(
  p_lifecycle jsonb,
  p_contact jsonb
)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  result jsonb := coalesce(p_lifecycle, '{}'::jsonb)
    || jsonb_build_object('messageState', p_contact);
  contact_state text := p_contact ->> 'state';
begin
  if p_lifecycle ->> 'paymentState' <> 'confirmed' then return p_lifecycle; end if;

  -- Unknown-date accounting remains a separate Refund Operations queue. Only
  -- its contact truth and polling terminality change here.
  if p_lifecycle #>> '{accountingState,state}' = 'pending' then
    return result || jsonb_build_object(
      'terminal', contact_state in ('sent', 'delivered'),
      'refreshAfterSeconds', case when contact_state in ('sent', 'delivered') then null else 5 end
    );
  end if;

  if contact_state in ('sent', 'delivered') then
    return result || jsonb_build_object(
      'stage', 'customer_notified', 'stageRank', 80,
      'reasonCode', 'completion_sent', 'terminal', true,
      'refreshAfterSeconds', null
    );
  elsif contact_state in ('failed', 'delivery_unconfirmed', 'bounced', 'complained') then
    return result || jsonb_build_object(
      'stage', case when contact_state = 'failed' then 'refund_confirmed' else 'customer_notified' end,
      'stageRank', case when contact_state = 'failed' then 70 else 80 end,
      'reasonCode', case when contact_state = 'delivery_unconfirmed'
        then 'completion_delivery_unconfirmed' else 'completion_delivery_failed' end,
      'managerNextAction', 'review_delivery_no_resend',
      'managerAction', jsonb_build_object(
        'action', 'review_delivery_no_resend', 'owner', 'Refund Operations',
        'safeRetryEligible', false, 'payloadRedacted', true
      ),
      'managerQueue', (case
        when jsonb_typeof(result -> 'managerQueue') = 'object' then result -> 'managerQueue'
        else '{}'::jsonb
      end) || jsonb_build_object(
        'bucket', 'provider_hold', 'label', 'Needs Refund Operations',
        'nextAction', 'review_delivery_no_resend', 'safeRetryEligible', false
      ),
      'operations', (case
        when jsonb_typeof(result -> 'operations') = 'object' then result -> 'operations'
        else '{}'::jsonb
      end) || jsonb_build_object(
        'required', true, 'owner', 'Refund Operations',
        'failureClass', 'customer_delivery_exception'
      ),
      'terminal', false, 'refreshAfterSeconds', 5
    );
  end if;

  return result || jsonb_build_object(
    'stage', 'refund_confirmed', 'stageRank', 70,
    'reasonCode', 'customer_notification_pending',
    'terminal', false, 'refreshAfterSeconds', 5
  );
end;
$$;

revoke all on function public.refund_apply_completion_contact_to_lifecycle(jsonb, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.refund_apply_completion_contact_to_lifecycle(jsonb, jsonb)
  to service_role;

alter function public.refund_lifecycle_contract(uuid)
  rename to refund_lifecycle_contract_pre_completion_contact_truth_v1;
revoke all on function public.refund_lifecycle_contract_pre_completion_contact_truth_v1(uuid)
  from public, anon, authenticated, service_role;

create function public.refund_lifecycle_contract(p_refund_case_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  base jsonb := public.refund_lifecycle_contract_pre_completion_contact_truth_v1(p_refund_case_id);
begin
  if base is null then return null; end if;
  return public.refund_apply_completion_contact_to_lifecycle(
    base, public.refund_completion_contact_contract(p_refund_case_id)
  );
end;
$$;

revoke all on function public.refund_lifecycle_contract(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.refund_lifecycle_contract(uuid) to service_role;

comment on function public.refund_lifecycle_contract(uuid) is
  'Canonical lifecycle with redacted proof-backed completion-contact truth; no sender, retry, payment, or provider behavior.';

select pg_notify('pgrst', 'reload schema');
