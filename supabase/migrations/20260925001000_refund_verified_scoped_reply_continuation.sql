-- A verified response to an issued purchase question is work for Bloomjoy even
-- when no safe structured value can be extracted from the email.
alter table public.refund_wallet_correction_contexts
  add column if not exists reply_message_id uuid references public.refund_gmail_messages(id),
  add column if not exists reply_received_at timestamptz,
  add column if not exists reply_review_due_at timestamptz,
  add column if not exists reply_review_state text
    check (reply_review_state in ('pending','claimed','resolved')),
  add column if not exists reply_review_claim_token uuid,
  add column if not exists reply_review_claimed_at timestamptz,
  add column if not exists reply_review_result_code text;

create index if not exists refund_purchase_reply_review_due_idx
  on public.refund_wallet_correction_contexts(reply_review_due_at, id)
  where correction_kind='purchase' and reply_review_state in ('pending','claimed');

create or replace function public.service_receive_refund_scoped_email_reply(
  p_refund_case_id uuid, p_gmail_message_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  c public.refund_cases;
  source public.refund_gmail_messages;
  ctx public.refund_wallet_correction_contexts;
  request public.refund_case_messages;
begin
  select * into c from public.refund_cases where id=p_refund_case_id for update;
  if c.id is null then return jsonb_build_object('outcome','not_found'); end if;
  select * into source from public.refund_gmail_messages where id=p_gmail_message_id for update;
  if source.id is null or source.refund_case_id is distinct from c.id
    or source.direction<>'inbound' or source.message_kind<>'message'
    or source.status<>'received' or source.participant_role<>'customer'
    or source.participant_trust<>'verified' or source.content_deleted_at is not null
    or lower(btrim(source.sender_email)) is distinct from lower(btrim(c.customer_email)) then
    return jsonb_build_object('outcome','unverified');
  end if;
  select * into ctx from public.refund_wallet_correction_contexts r
    where r.refund_case_id=c.id and r.correction_kind='purchase' and r.status='pending'
    order by r.version desc, r.issued_at desc limit 1 for update;
  if ctx.id is null then return jsonb_build_object('outcome','no_current_request'); end if;
  select * into request from public.refund_case_messages where id=ctx.correction_message_id for update;
  if request.id is null or request.refund_case_id is distinct from c.id
    or request.status<>'sent' or request.sent_at is null
    or request.sent_at>=source.received_at
    or lower(btrim(request.recipient_email)) is distinct from lower(btrim(c.customer_email))
    or public.is_refund_message_recorded_delivery_failure(to_jsonb(request))
    or coalesce(request.delivery_state,'') in ('failed','bounced','complained')
    or ctx.correction_requested_fields is distinct from request.requested_fields
    or ctx.correction_fact_version is distinct from c.deterministic_fact_version
    or ctx.expires_at<source.received_at
    or not public.refund_purchase_correction_eligible(c) then
    return jsonb_build_object('outcome','request_not_current');
  end if;
  if exists(select 1 from public.refund_gmail_messages g
    where g.refund_case_message_id=request.id and g.direction='outbound') then
    if not exists(select 1 from public.refund_gmail_messages g
      where g.refund_case_message_id=request.id and g.refund_case_id=c.id
        and g.direction='outbound' and g.message_kind='message' and g.status='sent'
        and g.gmail_thread_id=source.gmail_thread_id
        and coalesce(g.sent_at,g.received_at)<=source.received_at
        and g.provider_message_header is not null
        and g.provider_message_header=any(regexp_split_to_array(
          coalesce(source.references_header,''),'[[:space:]]+'))) then
      return jsonb_build_object('outcome','request_thread_mismatch');
    end if;
  elsif request.delivery_transport is distinct from 'resend'
    or request.provider_message_id is null
    or coalesce(request.delivery_state,'') not in ('accepted','deferred','delivered')
    or exists(select 1 from public.refund_wallet_correction_contexts prior
      where prior.refund_case_id=c.id and prior.id<>ctx.id)
    or position(upper(c.public_reference) in upper(coalesce(source.subject,'')||E'\n'||coalesce(source.plain_body,'')))=0 then
    return jsonb_build_object('outcome','request_delivery_unverified');
  end if;
  if ctx.reply_message_id is not null then
    return jsonb_build_object('outcome','already_received','requestId',ctx.id,
      'replyMessageId',ctx.reply_message_id,'dueAt',ctx.reply_review_due_at);
  end if;
  update public.refund_wallet_correction_contexts set
    reply_message_id=source.id, reply_received_at=source.received_at,
    reply_review_due_at=statement_timestamp(), reply_review_state='pending',
    updated_at=statement_timestamp() where id=ctx.id;
  update public.refund_follow_up_cycles set status='customer_replied',
    reply_customer_message_id=source.id, reply_received_at=source.received_at
    where id=request.follow_up_cycle_id and refund_case_id=c.id and status='waiting'
      and reply_customer_message_id is null;
  update public.refund_cases set
    status=case when status='waiting_on_customer' then 'needs_review' else status end,
    automation_state='customer_reply_review', automation_follow_up_due_at=null
    where id=c.id;
  insert into public.refund_case_events(refund_case_id,event_type,message,metadata)
    values(c.id,'purchase_correction_verified_email_received',
      'A verified reply to the current request is queued for Bloomjoy review.',
      jsonb_build_object('request_id',ctx.id,'gmail_message_id',source.id,
        'fact_version',c.deterministic_fact_version,'payload_redacted',true));
  return jsonb_build_object('outcome','received','requestId',ctx.id,
    'replyMessageId',source.id,'dueAt',statement_timestamp(),'payloadRedacted',true);
end;
$$;
revoke all on function public.service_receive_refund_scoped_email_reply(uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.service_receive_refund_scoped_email_reply(uuid,uuid)
  to service_role;

-- The request row itself is the durable task; no parallel case queue is made.
create or replace function public.service_claim_refund_scoped_reply_reviews(
  p_limit integer default 25
) returns jsonb language plpgsql security definer set search_path='' as $$
declare ctx public.refund_wallet_correction_contexts; tasks jsonb:='[]'::jsonb; token uuid;
begin
  for ctx in select r.* from public.refund_wallet_correction_contexts r
    where r.correction_kind='purchase' and r.status='pending'
      and r.reply_message_id is not null and r.reply_review_due_at<=statement_timestamp()
      and (r.reply_review_state='pending' or
        (r.reply_review_state='claimed' and r.reply_review_claimed_at<statement_timestamp()-interval '15 minutes'))
    order by r.reply_review_due_at,r.id limit least(greatest(coalesce(p_limit,25),1),25)
    for update skip locked
  loop
    token:=gen_random_uuid();
    update public.refund_wallet_correction_contexts set
      reply_review_state='claimed',reply_review_claim_token=token,
      reply_review_claimed_at=statement_timestamp(),updated_at=statement_timestamp()
      where id=ctx.id;
    tasks:=tasks||jsonb_build_array(jsonb_build_object('requestId',ctx.id,
      'refundCaseId',ctx.refund_case_id,'sourceMessageId',ctx.reply_message_id,
      'factVersion',ctx.correction_fact_version,'claimToken',token,
      'dueAt',ctx.reply_review_due_at,'payloadRedacted',true));
  end loop;
  return jsonb_build_object('tasks',tasks,'payloadRedacted',true);
end;
$$;
revoke all on function public.service_claim_refund_scoped_reply_reviews(integer)
  from public,anon,authenticated;
grant execute on function public.service_claim_refund_scoped_reply_reviews(integer)
  to service_role;

alter function public.service_apply_refund_gmail_customer_facts_v1(
  uuid,uuid,bigint,jsonb,text[],text)
  rename to service_apply_refund_gmail_customer_facts_pre_reply_continuation;

create or replace function public.service_apply_refund_gmail_customer_facts_v1(
  p_refund_case_id uuid,p_gmail_message_id uuid,p_expected_fact_version bigint,
  p_updates jsonb,p_applied_fields text[],p_extraction_policy text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  result:=public.service_apply_refund_gmail_customer_facts_pre_reply_continuation(
    p_refund_case_id,p_gmail_message_id,p_expected_fact_version,
    p_updates,p_applied_fields,p_extraction_policy);
  if result->>'outcome' in ('applied','already_applied') then
    update public.refund_wallet_correction_contexts ctx set
      reply_review_state='resolved',reply_review_result_code='facts_applied',
      updated_at=statement_timestamp()
      where ctx.refund_case_id=p_refund_case_id and ctx.correction_kind='purchase'
        and ctx.reply_message_id is not null
        and ctx.reply_review_state in ('pending','claimed')
        and exists(select 1 from public.refund_gmail_messages source
          where source.id=p_gmail_message_id and source.refund_case_id=ctx.refund_case_id
            and source.received_at>=ctx.reply_received_at);
  end if;
  return result;
end;
$$;
revoke all on function public.service_apply_refund_gmail_customer_facts_v1(
  uuid,uuid,bigint,jsonb,text[],text) from public,anon,authenticated;
grant execute on function public.service_apply_refund_gmail_customer_facts_v1(
  uuid,uuid,bigint,jsonb,text[],text) to service_role;

alter function public.refund_customer_outreach_contract(uuid)
  rename to refund_customer_outreach_pre_verified_reply_continuation;
revoke all on function public.refund_customer_outreach_pre_verified_reply_continuation(uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.refund_customer_outreach_pre_verified_reply_continuation(uuid)
  to service_role;

create or replace function public.refund_customer_outreach_contract(
  p_refund_case_id uuid
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb; ctx public.refund_wallet_correction_contexts;
begin
  result:=public.refund_customer_outreach_pre_verified_reply_continuation(p_refund_case_id);
  if result is null or result->>'state'<>'waiting_for_customer' then return result; end if;
  select * into ctx from public.refund_wallet_correction_contexts r
    where r.refund_case_id=p_refund_case_id and r.correction_kind='purchase'
      and r.status='pending' and r.reply_message_id is not null
      and r.reply_review_state in ('pending','claimed')
      and r.correction_message_id=(result->>'requestMessageId')::uuid
    order by r.version desc,r.issued_at desc limit 1;
  if ctx.id is null then return result; end if;
  return result||jsonb_build_object('state','customer_replied','owner','Agent',
    'nextAction','review_customer_reply','replyReceivedAt',ctx.reply_received_at,
    'replyReviewDueAt',ctx.reply_review_due_at,
    'replyReviewState',ctx.reply_review_state,
    'reasonCode','verified_reply_review_due',
    'payloadRedacted',true);
end;
$$;
revoke all on function public.refund_customer_outreach_contract(uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.refund_customer_outreach_contract(uuid)
  to service_role;
