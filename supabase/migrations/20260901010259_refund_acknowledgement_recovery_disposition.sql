-- Keep a skipped initial acknowledgement visible after later customer mail,
-- and let an authorized manager record the only safe historical disposition:
-- a later sent message already covered the contact, so the acknowledgement
-- must not be resent. This migration performs no outbound or payment work.

create unique index if not exists refund_ack_recovery_disposition_unique
  on public.refund_case_events (
    refund_case_id,
    (metadata ->> 'skipped_message_id')
  )
  where event_type = 'customer_acknowledgement_recovery_disposition';

create or replace function public.refund_acknowledgement_delivery_exception(
  p_case_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  skipped_message public.refund_case_messages%rowtype;
  later_sent_message public.refund_case_messages%rowtype;
  disposition_event public.refund_case_events%rowtype;
begin
  select message.*
  into skipped_message
  from public.refund_case_messages message
  where message.refund_case_id = p_case_id
    and message.message_type = 'confirmation'
    and message.status = 'skipped'
  order by message.created_at, message.id
  limit 1;

  if skipped_message.id is null then
    return null;
  end if;

  select event.*
  into disposition_event
  from public.refund_case_events event
  where event.refund_case_id = p_case_id
    and event.event_type = 'customer_acknowledgement_recovery_disposition'
    and event.metadata ->> 'skipped_message_id' = skipped_message.id::text
  order by event.created_at, event.id
  limit 1;

  select message.*
  into later_sent_message
  from public.refund_case_messages message
  where message.refund_case_id = p_case_id
    and message.status = 'sent'
    and message.created_at > skipped_message.created_at
  order by coalesce(message.sent_at, message.created_at) desc, message.id desc
  limit 1;

  return jsonb_build_object(
    'schemaVersion', 'refund_acknowledgement_recovery_v1',
    'status', case
      when disposition_event.id is null then 'unresolved'
      else 'resolved_later_contact'
    end,
    'reasonCode', 'initial_acknowledgement_skipped',
    'skippedAt', skipped_message.created_at,
    'laterContactSent', later_sent_message.id is not null,
    'laterContactMessageType', later_sent_message.message_type,
    'laterContactSentAt', coalesce(
      later_sent_message.sent_at,
      later_sent_message.created_at
    ),
    'recoveryAction', case
      when disposition_event.id is not null then 'none'
      when later_sent_message.id is not null
        then 'record_later_contact_disposition'
      else 'send_safe_status_update'
    end,
    'resolvedAt', disposition_event.created_at,
    'payloadRedacted', true
  );
end;
$$;

revoke execute on function
  public.refund_acknowledgement_delivery_exception(uuid)
  from public, anon, authenticated, service_role;

comment on function public.refund_acknowledgement_delivery_exception(uuid) is
  'Returns the redacted skipped-initial-acknowledgement recovery contract without exposing recipient, body, or provider data.';

create or replace function public.admin_dispose_refund_acknowledgement_exception(
  p_case_id uuid,
  p_expected_case_version bigint,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_user_id uuid := auth.uid();
  normalized_reason text := lower(btrim(coalesce(p_reason, '')));
  case_row public.refund_cases%rowtype;
  skipped_message public.refund_case_messages%rowtype;
  later_sent_message public.refund_case_messages%rowtype;
  existing_event public.refund_case_events%rowtype;
  event_id_value uuid;
begin
  if actor_user_id is null then
    raise exception using errcode = 'P4610',
      message = 'Authenticated refund manager required';
  end if;

  if normalized_reason <> 'later_customer_contact_already_sent' then
    raise exception using errcode = 'P4611',
      message = 'Valid acknowledgement recovery reason required';
  end if;

  select refund_case.*
  into case_row
  from public.refund_cases refund_case
  where refund_case.id = p_case_id
  for update;

  if case_row.id is null then
    raise exception using errcode = 'P4612',
      message = 'Refund case not found';
  end if;

  if not public.can_manage_refund_case(actor_user_id, p_case_id) then
    raise exception using errcode = 'P4613',
      message = 'Refund case access required';
  end if;

  if p_expected_case_version is null
    or case_row.official_action_version is distinct from p_expected_case_version
  then
    raise exception using errcode = 'P4614',
      message = 'Refund case changed; refresh before recording recovery';
  end if;

  select message.*
  into skipped_message
  from public.refund_case_messages message
  where message.refund_case_id = p_case_id
    and message.message_type = 'confirmation'
    and message.status = 'skipped'
  order by message.created_at, message.id
  limit 1;

  if skipped_message.id is null then
    raise exception using errcode = 'P4615',
      message = 'No skipped acknowledgement requires recovery';
  end if;

  select event.*
  into existing_event
  from public.refund_case_events event
  where event.refund_case_id = p_case_id
    and event.event_type = 'customer_acknowledgement_recovery_disposition'
    and event.metadata ->> 'skipped_message_id' = skipped_message.id::text
  order by event.created_at, event.id
  limit 1;

  if existing_event.id is not null then
    return jsonb_build_object(
      'recorded', false,
      'replayed', true,
      'reason', normalized_reason,
      'caseVersion', case_row.official_action_version,
      'payloadRedacted', true
    );
  end if;

  select message.*
  into later_sent_message
  from public.refund_case_messages message
  where message.refund_case_id = p_case_id
    and message.status = 'sent'
    and message.created_at > skipped_message.created_at
  order by coalesce(message.sent_at, message.created_at) desc, message.id desc
  limit 1;

  if later_sent_message.id is null then
    raise exception using errcode = 'P4616',
      message = 'A later sent customer message is required; do not suppress the delivery exception';
  end if;

  insert into public.refund_case_events (
    refund_case_id,
    actor_user_id,
    event_type,
    message,
    metadata
  ) values (
    p_case_id,
    actor_user_id,
    'customer_acknowledgement_recovery_disposition',
    'A manager confirmed that later customer contact was sent; the skipped initial acknowledgement must not be resent.',
    jsonb_build_object(
      'reason', normalized_reason,
      'skipped_message_id', skipped_message.id,
      'later_sent_message_id', later_sent_message.id,
      'later_sent_message_type', later_sent_message.message_type,
      'payload_redacted', true
    )
  )
  returning id into event_id_value;

  return jsonb_build_object(
    'recorded', true,
    'replayed', false,
    'reason', normalized_reason,
    'caseVersion', case_row.official_action_version,
    'payloadRedacted', true
  );
end;
$$;

revoke execute on function
  public.admin_dispose_refund_acknowledgement_exception(uuid, bigint, text)
  from public, anon, service_role;
grant execute on function
  public.admin_dispose_refund_acknowledgement_exception(uuid, bigint, text)
  to authenticated;

comment on function
  public.admin_dispose_refund_acknowledgement_exception(uuid, bigint, text) is
  'Records one version-checked, actor-authorized, redacted disposition only when a later sent customer message makes acknowledgement resend unsafe and unnecessary.';

alter function public.admin_get_refund_operations_overview()
  rename to admin_get_refund_operations_overview_pre_ack_recovery_v1;

revoke execute on function
  public.admin_get_refund_operations_overview_pre_ack_recovery_v1()
  from public, anon, authenticated, service_role;

create function public.admin_get_refund_operations_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  base_result jsonb;
  projected_cases jsonb;
begin
  base_result :=
    public.admin_get_refund_operations_overview_pre_ack_recovery_v1();

  select coalesce(
    jsonb_agg(
      item.case_json || jsonb_build_object(
        'acknowledgementDeliveryException',
        public.refund_acknowledgement_delivery_exception(
          (item.case_json ->> 'id')::uuid
        )
      )
      order by item.case_order
    ),
    '[]'::jsonb
  )
  into projected_cases
  from jsonb_array_elements(coalesce(base_result -> 'cases', '[]'::jsonb))
    with ordinality item(case_json, case_order);

  return jsonb_set(
    base_result || jsonb_build_object(
      'acknowledgementRecoveryContractVersion',
      'refund_acknowledgement_recovery_v1'
    ),
    '{cases}',
    projected_cases,
    true
  );
end;
$$;

revoke execute on function public.admin_get_refund_operations_overview()
  from public, anon;
grant execute on function public.admin_get_refund_operations_overview()
  to authenticated, service_role;

comment on function public.admin_get_refund_operations_overview() is
  'Actor-scoped refund overview with a redacted skipped-acknowledgement exception that remains visible after later customer contact until an authorized disposition is recorded.';
