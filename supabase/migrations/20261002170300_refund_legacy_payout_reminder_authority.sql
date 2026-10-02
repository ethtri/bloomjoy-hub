-- Keep the generic automatic-contact terminal guard unchanged. Only the
-- existing exact-message Gmail claim may authorize a protected reminder for
-- an unfinished historical cash commitment.
do $migration$
declare
  definition text;
  needle text;
  replacement text;
begin
  definition := replace(pg_get_functiondef(
    'public.service_authorize_refund_customer_outbound(uuid,text,text[],text)'::regprocedure),chr(13)||chr(10),chr(10));
  needle := 'public.service_authorize_refund_customer_outbound(p_refund_case_id uuid, p_recipient_email text';
  if (length(definition)-length(replace(definition,needle,'')))/length(needle) <> 1 then
    raise exception 'Customer authorization signature changed';
  end if;
  definition := replace(definition,needle,
    'public.service_authorize_refund_customer_message_outbound(p_refund_case_id uuid, p_refund_case_message_id uuid, p_recipient_email text');
  needle := ') and not authority_bound_completion then';
  if (length(definition)-length(replace(definition,needle,'')))/length(needle) <> 1 then
    raise exception 'Customer authorization terminal boundary changed';
  end if;
  replacement := $body$) and not authority_bound_completion
      and not coalesce((
        case_row.resolution_method = 'original_payment'
        and case_row.payment_method = 'cash'
        and case_row.decision = 'approved'
        and case_row.status not in ('completed','closed','denied')
        and case_row.refund_completed_at is null
        and nullif(btrim(case_row.zelle_payment_contact),'') is null
        and public.refund_payout_destination_case_current(case_row)
        and exists (
          select 1
          from public.refund_case_messages reminder
          join public.refund_payout_destination_follow_ups follow_up
            on follow_up.id = reminder.payout_destination_follow_up_id
            and follow_up.refund_case_id = reminder.refund_case_id
            and follow_up.reminder_message_id = reminder.id
          join public.refund_case_messages request
            on request.id = follow_up.request_message_id
            and request.refund_case_id = reminder.refund_case_id
          where reminder.id = p_refund_case_message_id
            and reminder.refund_case_id = case_row.id
            and reminder.recipient_email = normalized_recipient
            and reminder.status = 'pending'
            and reminder.delivery_kind = 'automatic'
            and reminder.content_source = 'deterministic_template'
            and reminder.message_type = 'reminder'
            and reminder.template_key = 'refund_payout_destination_reminder_v1'
            and reminder.template_version = 'refund_payout_destination_v1'
            and reminder.reason_code = 'missing_information'
            and reminder.requested_fields = array['zelle_payment_contact']::text[]
            and reminder.follow_up_cycle_id is null
            and reminder.provider_message_id is null
            and reminder.delivery_transport is null
            and reminder.sent_at is null
            and reminder.manual_delivery_provider_attempted_at is null
            and follow_up.status = 'reminder_claimed'
            and follow_up.reminder_claim_token is not null
            and follow_up.reminder_claimed_at is not null
            and follow_up.reminder_due_at <= statement_timestamp()
            and follow_up.reminder_sent_at is null
            and follow_up.satisfied_at is null
            and request.message_type = 'more_info'
            and request.delivery_kind = 'manual'
            and request.requested_fields = array['zelle_payment_contact']::text[]
            and request.recipient_email = normalized_recipient
            and request.status = 'sent' and request.sent_at is not null
            and request.delivery_state not in ('failed','bounced','complained')
            and request.requested_fields_satisfied_at is null
            and request.requested_fields_satisfied_by_gmail_message_id is null
            and (
              request.delivery_state in ('accepted','delivered')
              or exists (
                select 1 from public.refund_gmail_messages original
                where original.refund_case_message_id = request.id
                  and original.refund_case_id = request.refund_case_id
                  and original.direction = 'outbound' and original.status = 'sent'
              )
            )
            and not exists (
              select 1 from public.refund_wallet_correction_contexts correction
              where correction.correction_message_id = request.id
                and (correction.refund_case_id is distinct from case_row.id
                  or correction.correction_fact_version is distinct from
                    case_row.deterministic_fact_version
                  or correction.status in ('submitted','revoked'))
            )
        )
      ), false) then$body$;
  execute replace(definition,needle,replacement);

  definition := replace(pg_get_functiondef(
    'public.service_claim_refund_gmail_outbound_pre_receipt_v1(uuid,uuid,text,text,text,text,text[],text,uuid)'::regprocedure),chr(13)||chr(10),chr(10));
  needle := 'delivery_authorization := public.service_authorize_refund_customer_outbound(
    p_refund_case_id,
    normalized_recipient,';
  if (length(definition)-length(replace(definition,needle,'')))/length(needle) <> 1 then
    raise exception 'Gmail exact-message authorization call changed';
  end if;
  execute replace(definition,needle,
    'delivery_authorization := public.service_authorize_refund_customer_message_outbound(
    p_refund_case_id,
    p_refund_case_message_id,
    normalized_recipient,');
end;
$migration$;

-- Internal exact-message authorization for the existing Gmail/transactional
-- transport. No customer or operator role can invoke it.
revoke all on function public.service_authorize_refund_customer_message_outbound(
  uuid,uuid,text,text[],text) from public,anon,authenticated,service_role;
grant execute on function public.service_authorize_refund_customer_message_outbound(
  uuid,uuid,text,text[],text) to service_role;

select pg_notify('pgrst','reload schema');
