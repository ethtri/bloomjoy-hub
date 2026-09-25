-- Gmail can already have passed a verified reply when this continuation is
-- installed. Reuse the same exact-request receiver for stored messages.
create function public.service_reconcile_stored_refund_scoped_email_replies(
  p_limit integer default 25,p_dry_run boolean default true
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  candidate record;
  result jsonb;
  examined integer:=0;
  received integer:=0;
begin
  for candidate in
    select r.refund_case_id, reply.id message_id
    from public.refund_wallet_correction_contexts r
    join public.refund_cases c on c.id=r.refund_case_id
    join public.refund_case_messages request on request.id=r.correction_message_id
      and request.refund_case_id=r.refund_case_id
    join lateral (
      select g.id
      from public.refund_gmail_messages g
      where g.refund_case_id=r.refund_case_id
        and g.direction='inbound' and g.message_kind='message'
        and g.status='received' and g.participant_role='customer'
        and g.participant_trust='verified' and g.content_deleted_at is null
        and not exists(select 1 from public.refund_customer_fact_applications applied
          where applied.gmail_message_id=g.id)
        and lower(btrim(g.sender_email))=lower(btrim(c.customer_email))
        and g.received_at>request.sent_at and g.received_at<=r.expires_at
        and (
          exists(select 1 from public.refund_gmail_messages outbound
            where outbound.refund_case_message_id=request.id
              and outbound.refund_case_id=r.refund_case_id
              and outbound.direction='outbound'
              and outbound.message_kind='message' and outbound.status='sent'
              and outbound.gmail_thread_id=g.gmail_thread_id
              and coalesce(outbound.sent_at,outbound.received_at)<=g.received_at
              and outbound.provider_message_header is not null
              and outbound.provider_message_header=any(regexp_split_to_array(
                coalesce(g.references_header,''),'[[:space:]]+')))
          or (not exists(select 1 from public.refund_gmail_messages outbound
                where outbound.refund_case_message_id=request.id
                  and outbound.direction='outbound')
              and request.delivery_transport='resend'
              and request.provider_message_id is not null
              and request.delivery_state in ('accepted','deferred','delivered')
              and not exists(select 1 from public.refund_wallet_correction_contexts prior
                where prior.refund_case_id=r.refund_case_id and prior.id<>r.id)
              and position(upper(c.public_reference) in upper(
                coalesce(g.subject,'')||E'\n'||coalesce(g.plain_body,'')))>0)
        )
      order by g.received_at desc,g.id desc limit 1
    ) reply on true
    where r.correction_kind='purchase' and r.status='pending'
      and r.reply_message_id is null
      and public.refund_purchase_correction_eligible(c)
      and r.correction_fact_version=c.deterministic_fact_version
      and r.correction_requested_fields=request.requested_fields
      and request.status='sent' and request.sent_at is not null
      and lower(btrim(request.recipient_email))=lower(btrim(c.customer_email))
      and not public.is_refund_message_recorded_delivery_failure(to_jsonb(request))
      and coalesce(request.delivery_state,'') not in ('failed','bounced','complained')
    order by r.issued_at,r.id
    limit least(greatest(coalesce(p_limit,25),1),25)
  loop
    examined:=examined+1;
    if not coalesce(p_dry_run,true) then
      result:=public.service_receive_refund_scoped_email_reply(
        candidate.refund_case_id,candidate.message_id);
      if result->>'outcome'='received' then received:=received+1; end if;
    end if;
  end loop;
  return jsonb_build_object('examinedCount',examined,'receivedCount',received,
    'dryRun',coalesce(p_dry_run,true),'payloadRedacted',true);
end;
$$;
revoke all on function public.service_reconcile_stored_refund_scoped_email_replies(integer,boolean)
  from public,anon,authenticated;
grant execute on function public.service_reconcile_stored_refund_scoped_email_replies(integer,boolean)
  to service_role;

comment on function public.service_reconcile_stored_refund_scoped_email_replies(integer,boolean) is
  'Bounded, dry-run-by-default service reconciliation of already-stored verified Gmail replies through the exact current-request receiver; no email, provider read, or customer contact.';
