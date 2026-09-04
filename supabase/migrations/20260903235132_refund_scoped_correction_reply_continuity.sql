-- A supported verified email response answers the existing scoped request.
-- Keep the original Gmail fact-application receipt and all sent-message history.
create or replace function public.service_apply_refund_gmail_customer_facts_v1(
  p_refund_case_id uuid,p_gmail_message_id uuid,p_expected_fact_version bigint,
  p_updates jsonb,p_applied_fields text[],p_extraction_policy text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  c public.refund_cases; source public.refund_gmail_messages;
  r public.refund_wallet_correction_contexts; request public.refund_case_messages;
  result jsonb; answers jsonb; answered_fields text[]; remaining_fields text[];
begin
  -- Match the current scoped form/issuance lock order. Legacy fact application
  -- remains the only writer of parsed facts and its immutable application receipt.
  select * into c from public.refund_cases where id=p_refund_case_id for update;
  select * into source from public.refund_gmail_messages where id=p_gmail_message_id for update;
  if exists(select 1 from public.refund_wallet_correction_contexts ctx where ctx.refund_case_id=c.id
    and ctx.correction_kind='purchase' and ctx.status='submitted' and ctx.consumed_at>=source.received_at
    and not exists(select 1 from public.refund_customer_fact_applications a where a.gmail_message_id=source.id)) then
    return jsonb_build_object('outcome','conflict','reason','newer_customer_form_response','factVersion',c.deterministic_fact_version);
  end if;
  -- Replays already have their atomic application and request settlement. Never
  -- attach an old application to a later request, even if processing resumes.
  if exists(select 1 from public.refund_customer_fact_applications a where a.gmail_message_id=source.id) then
    return public.service_apply_refund_gmail_customer_facts_pre_purchase_correction(
      p_refund_case_id,p_gmail_message_id,p_expected_fact_version,p_updates,p_applied_fields,p_extraction_policy);
  end if;
  if exists(select 1 from public.refund_authoritative_receipts receipt where receipt.refund_case_id=c.id) then
    return public.service_apply_refund_gmail_customer_facts_pre_purchase_correction(
      p_refund_case_id,p_gmail_message_id,p_expected_fact_version,p_updates,p_applied_fields,p_extraction_policy);
  end if;
  select * into r from public.refund_wallet_correction_contexts ctx
    where ctx.refund_case_id=c.id and ctx.correction_kind='purchase' and ctx.status='pending'
    order by ctx.version desc limit 1 for update;
  -- A manager can revoke the old capability and queue its replacement before
  -- the new sender issues a capability. Do not treat that gap as legacy mail.
  if r.id is null and exists(select 1 from (
      select ctx.* from public.refund_wallet_correction_contexts ctx
      where ctx.refund_case_id=c.id and ctx.correction_kind='purchase'
      order by ctx.version desc,ctx.issued_at desc,ctx.id desc limit 1
    ) old_scope join public.refund_case_messages sent_request on sent_request.id=old_scope.correction_message_id
    where old_scope.status='revoked' and sent_request.refund_case_id=c.id
      and sent_request.status='sent' and sent_request.sent_at is not null
      and (exists(select 1 from public.refund_gmail_messages outbound
        where outbound.refund_case_message_id=sent_request.id and outbound.refund_case_id=c.id
          and outbound.direction='outbound' and outbound.message_kind='message' and outbound.status='sent'
          and coalesce(outbound.sent_at,outbound.received_at) is not null)
        or (sent_request.delivery_transport='resend' and nullif(btrim(sent_request.provider_message_id),'') is not null
          and sent_request.delivery_state_updated_at is not null))) then
    return jsonb_build_object('outcome','conflict','reason','scoped_reply_superseded','factVersion',c.deterministic_fact_version);
  end if;
  if r.id is not null then
    select * into request from public.refund_case_messages where id=r.correction_message_id for update;
    if source.id is null or source.refund_case_id is distinct from c.id
      or source.direction<>'inbound' or source.message_kind<>'message' or source.status<>'received'
      or source.participant_role<>'customer' or source.participant_trust<>'verified'
      or source.content_deleted_at is not null or source.sensitive_data_redacted
      or lower(btrim(source.sender_email)) is distinct from lower(btrim(c.customer_email))
      or request.refund_case_id is distinct from c.id or request.status is distinct from 'sent'
      or request.sent_at is null or request.sent_at>=source.received_at
      or request.recipient_email is distinct from c.customer_email
      or public.is_refund_message_recorded_delivery_failure(to_jsonb(request))
      or coalesce(request.delivery_state,'') in ('failed','bounced','complained')
      or r.correction_requested_fields is distinct from request.requested_fields
      or r.correction_fact_version is distinct from p_expected_fact_version
      or c.deterministic_fact_version is distinct from p_expected_fact_version
      or r.expires_at<source.received_at
      or not public.refund_purchase_correction_eligible(c) then
      return jsonb_build_object('outcome','conflict','reason','scoped_reply_not_current','factVersion',c.deterministic_fact_version);
    end if;
    -- Gmail replies must follow this exact delivered message, not another
    -- customer's/request's conversation. Preserve the supported Resend fallback.
    if exists(select 1 from public.refund_gmail_messages g where g.refund_case_message_id=request.id and g.direction='outbound') then
      if not exists(select 1 from public.refund_gmail_messages g where g.refund_case_message_id=request.id
        and g.refund_case_id=c.id and g.direction='outbound' and g.message_kind='message' and g.status='sent'
        and g.gmail_thread_id=source.gmail_thread_id and coalesce(g.sent_at,g.received_at)<=source.received_at
        and g.provider_message_header is not null
        and g.provider_message_header=any(regexp_split_to_array(coalesce(source.references_header,''),'[[:space:]]+'))) then
        return jsonb_build_object('outcome','conflict','reason','scoped_reply_thread_mismatch','factVersion',c.deterministic_fact_version);
      end if;
    elsif request.delivery_transport is distinct from 'resend' or request.provider_message_id is null
      or coalesce(request.delivery_state,'') not in ('accepted','deferred','delivered')
      or exists(select 1 from public.refund_wallet_correction_contexts prior where prior.refund_case_id=c.id and prior.id<>r.id)
      or position(upper(c.public_reference) in upper(coalesce(source.subject,'')||E'\n'||coalesce(source.plain_body,'')))=0 then
      return jsonb_build_object('outcome','conflict','reason','scoped_reply_delivery_unverified','factVersion',c.deterministic_fact_version);
    end if;
  end if;
  result:=public.service_apply_refund_gmail_customer_facts_pre_purchase_correction(
    p_refund_case_id,p_gmail_message_id,p_expected_fact_version,p_updates,p_applied_fields,p_extraction_policy);
  if r.id is null or result->>'outcome' is distinct from 'applied' then return result; end if;
  select * into c from public.refund_cases where id=p_refund_case_id;
  select coalesce(array_agg(field order by field),'{}'::text[]) into answered_fields
    from unnest(r.correction_requested_fields) field where field=any(p_applied_fields)
      and public.refund_purchase_correction_values(c) ? field;
  if cardinality(answered_fields)=0 then return result; end if;
  select coalesce(jsonb_object_agg(field,jsonb_build_object('disposition','changed',
    'value',public.refund_purchase_correction_values(c)->>field)),'{}'::jsonb) into answers
    from unnest(answered_fields) field;
  remaining_fields:=array(select unnest(r.correction_requested_fields) except select unnest(answered_fields));
  -- Partial replies are real responses, not fabricated answers to missing
  -- questions. Stop the obsolete task; Operations owns any remaining detail.
  update public.refund_wallet_correction_contexts set status='submitted',consumed_at=statement_timestamp(),
    correction_response=answers,correction_resulting_fact_version=c.deterministic_fact_version,
    correction_next_action='review',correction_recheck_state=null,updated_at=statement_timestamp() where id=r.id;
  update public.refund_follow_up_cycles set status='manual_review'
    where id=request.follow_up_cycle_id and refund_case_id=c.id and status in ('claimed','waiting','customer_replied');
  update public.refund_cases set status=case when status='waiting_on_customer' then 'needs_review' else status end,
    automation_follow_up_due_at=null,
    wallet_correction_state=case when wallet_correction_state in ('needed','sent','reminder_sent') then 'received' else wallet_correction_state end
    where id=c.id;
  insert into public.refund_case_events(refund_case_id,event_type,message,metadata)
  values(c.id,'purchase_correction_email_received','Verified email response saved on the same correction request; Bloomjoy owns the next review.',
    jsonb_build_object('request_id',r.id,'gmail_message_id',source.id,'answered_fields',answered_fields,
      'remaining_fields',remaining_fields,'resulting_fact_version',c.deterministic_fact_version,'payload_redacted',true));
  return result;
end;
$$;
revoke all on function public.service_apply_refund_gmail_customer_facts_v1(uuid,uuid,bigint,jsonb,text[],text) from public,anon,authenticated;
grant execute on function public.service_apply_refund_gmail_customer_facts_v1(uuid,uuid,bigint,jsonb,text[],text) to service_role;
