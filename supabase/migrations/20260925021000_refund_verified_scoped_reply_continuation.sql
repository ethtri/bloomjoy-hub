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
  add column if not exists reply_review_result_code text,
  add column if not exists reply_body_sha256 text
    check (reply_body_sha256 ~ '^[0-9a-f]{64}$'),
  add column if not exists reply_review_attempt_count integer not null default 0
    check (reply_review_attempt_count>=0);

create index if not exists refund_purchase_reply_review_due_idx
  on public.refund_wallet_correction_contexts(reply_review_due_at, id)
  where correction_kind='purchase' and reply_review_state in ('pending','claimed');

-- A request may receive several verified free-text messages. Read the whole
-- currently bound message set from the existing Gmail evidence; one context
-- remains the task and its digest invalidates any earlier claim. This helper
-- can contain customer content and is callable only by security-definer code.
create function public.refund_scoped_verified_reply_set(p_context_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  with scope as (
    select r.id,r.refund_case_id,r.expires_at,c.customer_email,c.public_reference,
      request.id request_id,request.sent_at,request.delivery_transport,
      request.provider_message_id,request.delivery_state
    from public.refund_wallet_correction_contexts r
    join public.refund_cases c on c.id=r.refund_case_id
    join public.refund_case_messages request on request.id=r.correction_message_id
      and request.refund_case_id=r.refund_case_id
    where r.id=p_context_id and r.correction_kind='purchase'
  ), verified as (
    select g.id,g.received_at,g.plain_body
    from scope s
    join public.refund_gmail_messages g on g.refund_case_id=s.refund_case_id
    where g.direction='inbound' and g.message_kind='message'
      and g.status='received' and g.participant_role='customer'
      and g.participant_trust='verified' and g.content_deleted_at is null
      and lower(btrim(g.sender_email))=lower(btrim(s.customer_email))
      and g.received_at>s.sent_at and g.received_at<=s.expires_at
      and (
        exists(select 1 from public.refund_gmail_messages outbound
          where outbound.refund_case_message_id=s.request_id
            and outbound.refund_case_id=s.refund_case_id
            and outbound.direction='outbound' and outbound.message_kind='message'
            and outbound.status='sent' and outbound.gmail_thread_id=g.gmail_thread_id
            and coalesce(outbound.sent_at,outbound.received_at)<=g.received_at
            and outbound.provider_message_header is not null
            and outbound.provider_message_header=any(regexp_split_to_array(
              coalesce(g.references_header,''),'[[:space:]]+')))
        or (not exists(select 1 from public.refund_gmail_messages outbound
              where outbound.refund_case_message_id=s.request_id
                and outbound.direction='outbound')
            and s.delivery_transport='resend'
            and s.provider_message_id is not null
            and s.delivery_state in ('accepted','deferred','delivered')
            and not exists(select 1 from public.refund_wallet_correction_contexts prior
              where prior.refund_case_id=s.refund_case_id and prior.id<>s.id)
            and position(upper(s.public_reference) in upper(
              coalesce(g.subject,'')||E'\n'||coalesce(g.plain_body,'')))>0)
      )
  ), ordered as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'messageId',id,'receivedAt',received_at,'body',plain_body)
      order by received_at,id),'[]'::jsonb) messages
    from verified
  )
  select jsonb_build_object('messages',messages,
    'bodySha256',encode(extensions.digest(convert_to(messages::text,'UTF8'),
      'sha256'),'hex'),
    'latestMessageId',messages->(jsonb_array_length(messages)-1)->>'messageId',
    'latestReceivedAt',messages->(jsonb_array_length(messages)-1)->>'receivedAt')
  from ordered;
$$;
revoke all on function public.refund_scoped_verified_reply_set(uuid)
  from public,anon,authenticated,service_role;

create or replace function public.service_receive_refund_scoped_email_reply(
  p_refund_case_id uuid, p_gmail_message_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  c public.refund_cases;
  source public.refund_gmail_messages;
  ctx public.refund_wallet_correction_contexts;
  request public.refund_case_messages;
  reply_set jsonb;
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
  reply_set:=public.refund_scoped_verified_reply_set(ctx.id);
  if not (reply_set->'messages' @> jsonb_build_array(
      jsonb_build_object('messageId',source.id))) then
    return jsonb_build_object('outcome','request_not_current');
  end if;
  if ctx.reply_body_sha256=reply_set->>'bodySha256' then
    return jsonb_build_object('outcome','already_received','requestId',ctx.id,
      'replyMessageId',ctx.reply_message_id,'dueAt',ctx.reply_review_due_at);
  end if;
  update public.refund_wallet_correction_contexts set
    reply_message_id=(reply_set->>'latestMessageId')::uuid,
    reply_received_at=(reply_set->>'latestReceivedAt')::timestamptz,
    reply_review_due_at=statement_timestamp(), reply_review_state='pending',
    reply_review_claim_token=null,reply_review_claimed_at=null,
    reply_review_result_code=null,
    reply_body_sha256=reply_set->>'bodySha256',
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
    'replyMessageId',reply_set->>'latestMessageId',
    'dueAt',statement_timestamp(),'payloadRedacted',true);
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
      reply_review_claimed_at=statement_timestamp(),
      reply_review_attempt_count=reply_review_attempt_count+1,
      updated_at=statement_timestamp()
      where id=ctx.id;
    tasks:=tasks||jsonb_build_array(jsonb_build_object('requestId',ctx.id,
      'refundCaseId',ctx.refund_case_id,'sourceMessageId',ctx.reply_message_id,
      'factVersion',ctx.correction_fact_version,'claimToken',token,
      'bodySha256',ctx.reply_body_sha256,
      'dueAt',ctx.reply_review_due_at,'payloadRedacted',true));
  end loop;
  return jsonb_build_object('tasks',tasks,'payloadRedacted',true);
end;
$$;
revoke all on function public.service_claim_refund_scoped_reply_reviews(integer)
  from public,anon,authenticated;
grant execute on function public.service_claim_refund_scoped_reply_reviews(integer)
  to service_role;

-- A provider/configuration failure releases only the exact claim for a later
-- scheduled attempt. It never turns an ordinary free-text reply into a
-- terminal technical exception or resumes customer waiting.
create function public.service_defer_refund_scoped_reply_review(
  p_request_id uuid,p_claim_token uuid,p_source_message_id uuid,
  p_expected_fact_version bigint,p_body_sha256 text,p_reason_code text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare ctx public.refund_wallet_correction_contexts;
  source public.refund_gmail_messages;
  c public.refund_cases;
begin
  select * into ctx from public.refund_wallet_correction_contexts
    where id=p_request_id for update;
  select * into c from public.refund_cases where id=ctx.refund_case_id for update;
  select * into source from public.refund_gmail_messages
    where id=p_source_message_id for update;
  if ctx.id is null or ctx.status<>'pending'
    or ctx.reply_review_state<>'claimed'
    or ctx.reply_review_claim_token is distinct from p_claim_token
    or ctx.reply_message_id is distinct from p_source_message_id
    or ctx.correction_fact_version is distinct from p_expected_fact_version
    or ctx.reply_body_sha256 is distinct from p_body_sha256
    or c.deterministic_fact_version is distinct from p_expected_fact_version
    or source.refund_case_id is distinct from ctx.refund_case_id
    or source.participant_role<>'customer' or source.participant_trust<>'verified'
    or source.received_at is distinct from ctx.reply_received_at
    or source.content_deleted_at is not null
    or public.refund_scoped_verified_reply_set(ctx.id)->>'bodySha256'
      is distinct from p_body_sha256 then
    return jsonb_build_object('outcome','stale_claim','payloadRedacted',true);
  end if;
  if p_reason_code not in ('provider_configuration_missing','provider_unavailable',
      'provider_timeout','provider_schema_rejected','research_input_unavailable',
      'research_result_unresolved') then
    raise exception 'Allowlisted redacted deferral reason required';
  end if;
  update public.refund_wallet_correction_contexts set
    reply_review_state='pending',reply_review_claim_token=null,
    reply_review_claimed_at=null,
    reply_review_due_at=statement_timestamp()+make_interval(
      mins=>least(60,5*greatest(1,ctx.reply_review_attempt_count))),
    reply_review_result_code=p_reason_code,updated_at=statement_timestamp()
    where id=ctx.id;
  return jsonb_build_object('outcome','deferred','reasonCode',p_reason_code,
    'requestId',ctx.id,'payloadRedacted',true);
end;
$$;
revoke all on function public.service_defer_refund_scoped_reply_review(
  uuid,uuid,uuid,bigint,text,text) from public,anon,authenticated;
grant execute on function public.service_defer_refund_scoped_reply_review(
  uuid,uuid,uuid,bigint,text,text) to service_role;

-- Content crosses to the existing scheduled service worker only after the
-- exact verified request/reply claim has been rechecked. Callers must treat
-- both bodies as untrusted data, redact before provider use, and never log
-- this service-only result.
create function public.service_get_refund_scoped_reply_research_input(
  p_request_id uuid,p_claim_token uuid,p_source_message_id uuid,
  p_expected_fact_version bigint,p_body_sha256 text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare ctx public.refund_wallet_correction_contexts;
  c public.refund_cases;
  source public.refund_gmail_messages;
  request public.refund_case_messages;
begin
  select * into ctx from public.refund_wallet_correction_contexts
    where id=p_request_id for update;
  select * into c from public.refund_cases where id=ctx.refund_case_id for update;
  select * into source from public.refund_gmail_messages
    where id=p_source_message_id for update;
  select * into request from public.refund_case_messages
    where id=ctx.correction_message_id for update;
  if ctx.id is null or ctx.correction_kind<>'purchase' or ctx.status<>'pending'
    or ctx.reply_review_state<>'claimed'
    or ctx.reply_review_claim_token is distinct from p_claim_token
    or ctx.reply_message_id is distinct from p_source_message_id
    or ctx.correction_fact_version is distinct from p_expected_fact_version
    or ctx.reply_body_sha256 is distinct from p_body_sha256
    or c.id is null or c.deterministic_fact_version is distinct from p_expected_fact_version
    or request.id is null or request.refund_case_id is distinct from c.id
    or request.status<>'sent' or request.sent_at is null
    or request.sent_at>=source.received_at
    or request.requested_fields is distinct from ctx.correction_requested_fields
    or source.id is null or source.refund_case_id is distinct from c.id
    or source.direction<>'inbound' or source.message_kind<>'message'
    or source.status<>'received' or source.participant_role<>'customer'
    or source.participant_trust<>'verified' or source.content_deleted_at is not null
    or source.received_at is distinct from ctx.reply_received_at
    or lower(btrim(source.sender_email)) is distinct from lower(btrim(c.customer_email))
    or public.refund_scoped_verified_reply_set(ctx.id)->>'bodySha256'
      is distinct from p_body_sha256 then
    return jsonb_build_object('outcome','stale_claim');
  end if;
  return jsonb_build_object('outcome','ready',
    'requestId',ctx.id,'refundCaseId',c.id,'sourceMessageId',source.id,
    'factVersion',c.deterministic_fact_version,'bodySha256',ctx.reply_body_sha256,
    'receivedAt',source.received_at,
    'requestedFields',to_jsonb(ctx.correction_requested_fields),
    'requestBody',regexp_replace(coalesce(request.body,''),
      'https?://[^[:space:]<>]+','[secure link omitted]','gi'),
    'replyBody',source.plain_body,
    'replyMessages',public.refund_scoped_verified_reply_set(ctx.id)->'messages',
    'sensitiveDataRedacted',source.sensitive_data_redacted,
    'currentFacts',jsonb_build_object(
      'paymentMethod',c.payment_method,
      'paymentAmountCents',c.payment_amount_cents,
      'cardLast4',c.card_last4,
      'incidentAt',c.incident_at,
      'reportingMachineId',c.reporting_machine_id),
    'containsCustomerContent',true);
end;
$$;
revoke all on function public.service_get_refund_scoped_reply_research_input(
  uuid,uuid,uuid,bigint,text) from public,anon,authenticated;
grant execute on function public.service_get_refund_scoped_reply_research_input(
  uuid,uuid,uuid,bigint,text) to service_role;

create function public.service_get_refund_scoped_reply_research_health()
returns jsonb language sql stable security definer set search_path='' as $$
  with tasks as (
    select r.reply_review_due_at,r.reply_review_state,
      r.reply_review_claimed_at,r.reply_review_result_code
    from public.refund_wallet_correction_contexts r
    where r.correction_kind='purchase' and r.status='pending'
      and r.reply_message_id is not null
      and r.reply_review_state in ('pending','claimed')
  )
  select jsonb_build_object(
    'status',case when count(*) filter(where reply_review_result_code in
        ('provider_configuration_missing','provider_unavailable','provider_timeout',
          'provider_schema_rejected','research_input_unavailable'))>0
        or count(*) filter(where reply_review_due_at<=statement_timestamp())>0
        or count(*) filter(where reply_review_state='claimed'
          and reply_review_claimed_at<statement_timestamp()-interval '15 minutes')>0
      then 'action_needed'
      when count(*)>0 then 'waiting' else 'healthy' end,
    'pendingCount',count(*),
    'dueCount',count(*) filter(where reply_review_due_at<=statement_timestamp()),
    'staleClaimedCount',count(*) filter(where reply_review_state='claimed'
      and reply_review_claimed_at<statement_timestamp()-interval '15 minutes'),
    'providerConfigurationCount',count(*) filter(
      where reply_review_result_code='provider_configuration_missing'),
    'oldestDueAgeSeconds',max(extract(epoch from
      (statement_timestamp()-reply_review_due_at))) filter(
        where reply_review_due_at<=statement_timestamp())::bigint,
    'owner','Agent','payloadRedacted',true)
  from tasks;
$$;
revoke all on function public.service_get_refund_scoped_reply_research_health()
  from public,anon,authenticated;
grant execute on function public.service_get_refund_scoped_reply_research_health()
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
  if result is null or result->>'state' not in ('waiting_for_customer','customer_replied')
    then return result; end if;
  select * into ctx from public.refund_wallet_correction_contexts r
    where r.refund_case_id=p_refund_case_id and r.correction_kind='purchase'
      and r.status='pending' and r.reply_message_id is not null
      and r.reply_review_state in ('pending','claimed')
      and r.correction_message_id=(result->>'requestMessageId')::uuid
    order by r.version desc,r.issued_at desc limit 1;
  if ctx.id is null then return result; end if;
  -- The public lifecycle wire schema has a fixed field set. Internal claim and
  -- due details remain in the service-only task/health contracts.
  return result||jsonb_build_object('state','customer_replied','owner','System',
    'nextAction','recheck_customer_reply','replyReceivedAt',ctx.reply_received_at,
    'reasonCode','verified_reply_review_due',
    'payloadRedacted',true);
end;
$$;
revoke all on function public.refund_customer_outreach_contract(uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.refund_customer_outreach_contract(uuid)
  to service_role;

-- The existing generic follow-up reply sweep can acknowledge a reply and
-- escalate unchanged facts to a Manager. A purchase correction has its own
-- exact-request System task; exclude it before the bounded generic page and
-- recheck after the generic cycle/case locks so two sweeps cannot race.
create or replace function public.service_list_refund_follow_up_customer_reply_candidates(
  p_limit integer default 25
) returns table(id uuid,refund_case_id uuid)
language sql stable security definer set search_path='' as $$
  select cycle.id,cycle.refund_case_id
  from public.refund_follow_up_cycles cycle
  where cycle.status in ('waiting','customer_replied')
    and cycle.request_sent_at is not null
    and cycle.recheck_claimed_at is null
    and not exists (select 1 from public.refund_authoritative_receipts receipt
      where receipt.refund_case_id=cycle.refund_case_id)
    and not exists (select 1 from public.refund_wallet_correction_contexts ctx
      where ctx.refund_case_id=cycle.refund_case_id
        and ctx.correction_message_id=cycle.request_message_id
        and ctx.correction_kind='purchase' and ctx.status='pending')
  order by cycle.request_sent_at,cycle.id
  limit least(greatest(coalesce(p_limit,25),1),100);
$$;
revoke all on function public.service_list_refund_follow_up_customer_reply_candidates(integer)
  from public,anon,authenticated;
grant execute on function public.service_list_refund_follow_up_customer_reply_candidates(integer)
  to service_role;

do $migration$
declare definition text; anchor text; replacement text;
begin
  definition:=pg_catalog.pg_get_functiondef(
    'public.service_claim_refund_follow_up_customer_reply(uuid,uuid)'::regprocedure);
  anchor:='  if cycle_row.reply_customer_message_id is not null then';
  replacement:=$guard$
  if exists (select 1 from public.refund_wallet_correction_contexts ctx
    where ctx.refund_case_id=cycle_row.refund_case_id
      and ctx.correction_message_id=cycle_row.request_message_id
      and ctx.correction_kind='purchase' and ctx.status='pending') then
    return jsonb_build_object('enabled',true,'claimed',false,
      'reason','scoped_purchase_reply_owned_by_system');
  end if;

  if cycle_row.reply_customer_message_id is not null then$guard$;
  if cardinality(string_to_array(definition,anchor))<>2 then
    raise exception 'Unexpected generic refund reply claim source';
  end if;
  execute replace(definition,anchor,replacement);
end;
$migration$;
