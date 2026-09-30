-- A completed secure-form response is already verified case evidence. Do not
-- keep projecting it as an unread customer reply after the exact current facts
-- are saved and the prior read-only recheck has finished. The delivered request
-- remains immutable history; the existing lifecycle chooses the next internal
-- research or provider-setup action.
alter function public.refund_customer_outreach_contract(uuid)
  rename to refund_outreach_pre_form_continuation_v1;

revoke all on function public.refund_outreach_pre_form_continuation_v1(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.refund_outreach_pre_form_continuation_v1(uuid)
  to service_role;

create function public.refund_customer_outreach_contract(
  p_refund_case_id uuid
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
  case_row public.refund_cases%rowtype;
  context_row public.refund_wallet_correction_contexts%rowtype;
  response_complete boolean := false;
  payout_destination_complete boolean := false;
begin
  result := public.refund_outreach_pre_form_continuation_v1(
    p_refund_case_id
  );

  if result is null or nullif(result ->> 'requestMessageId', '') is null then
    return result;
  end if;

  select refund_case.* into case_row
  from public.refund_cases refund_case
  where refund_case.id = p_refund_case_id;

  select context.* into context_row
  from public.refund_wallet_correction_contexts context
  join public.refund_case_messages message
    on message.id = context.correction_message_id
   and message.refund_case_id = context.refund_case_id
  where context.refund_case_id = case_row.id
    and context.correction_kind = 'purchase'
    and context.status = 'submitted'
    and context.reply_message_id is null
    and context.correction_message_id =
      (result ->> 'requestMessageId')::uuid
    and context.correction_resulting_fact_version =
      case_row.deterministic_fact_version
    and jsonb_typeof(context.correction_response) = 'object'
    and context.correction_response <> '{}'::jsonb
    and message.status = 'sent'
    and not public.is_refund_message_recorded_delivery_failure(to_jsonb(message))
    and coalesce(message.delivery_state, '') not in (
      'failed', 'bounced', 'complained'
    )
    and not exists (
      select 1
      from public.refund_wallet_correction_contexts newer
      where newer.refund_case_id = context.refund_case_id
        and newer.correction_kind = 'purchase'
        and (newer.version, newer.issued_at, newer.id) >
          (context.version, context.issued_at, context.id)
    )
  order by context.version desc, context.issued_at desc, context.id desc
  limit 1;

  if context_row.id is null
    or case_row.decision is not null
    or case_row.refund_completed_at is not null
    or case_row.reporting_adjustment_id is not null
    or coalesce(
      public.refund_purchase_correction_request_fields(case_row.id),
      '{}'::text[]
    ) <> '{}'::text[] then
    return result;
  end if;

  response_complete := not exists (
    select 1
    from jsonb_each(context_row.correction_response) answer
    where coalesce(answer.value ->> 'disposition', '')
        not in ('changed', 'confirmed')
      or case
        when answer.value ->> 'disposition' = 'changed' then
          public.refund_purchase_correction_values(case_row) ->> answer.key
            is distinct from answer.value ->> 'value'
        else
          public.refund_purchase_correction_values(case_row) ->> answer.key
            is distinct from context_row.correction_snapshot ->> answer.key
      end
  );

  payout_destination_complete :=
    context_row.correction_requested_fields =
      array['zelle_payment_contact']::text[]
    and context_row.correction_response = jsonb_build_object(
      'zelle_payment_contact',
      jsonb_build_object(
        'disposition', 'changed',
        'value', case_row.zelle_payment_contact
      )
    )
    and nullif(btrim(coalesce(case_row.zelle_payment_contact, '')), '')
      is not null;

  if response_complete
    and (
      context_row.correction_recheck_state = 'completed'
      or payout_destination_complete
    ) then
    return result || jsonb_build_object(
      'state', 'none',
      'owner', 'None',
      'nextAction', 'none',
      'requestedFields', '[]'::jsonb,
      'replyReceivedAt', context_row.consumed_at,
      'reasonCode', 'verified_form_response_applied',
      'failureCode', null,
      'payloadRedacted', true
    );
  end if;

  return result;
end;
$$;

revoke all on function public.refund_customer_outreach_contract(uuid)
  from public, anon, authenticated;
grant execute on function public.refund_customer_outreach_contract(uuid)
  to service_role;

comment on function public.refund_customer_outreach_contract(uuid) is
  'Projects customer outreach after exact current secure-form facts; completed rechecks and exact payout-destination responses resume existing internal work without another customer request.';

select pg_notify('pgrst', 'reload schema');
