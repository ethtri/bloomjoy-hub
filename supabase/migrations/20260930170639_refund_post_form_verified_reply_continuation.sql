-- Continue a verified reply on the same delivered conversation after its
-- secure form was submitted. Capability expiry does not reopen the form.
-- Bind only the existing request-row review to the current fact version;
-- preserve issuance facts, submitted answers and the original form receipt.
alter table public.refund_wallet_correction_contexts
  add column reply_review_fact_version bigint check(reply_review_fact_version>0);


create or replace function public.refund_scoped_verified_reply_set(p_context_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  with scope as (
    select r.id,r.refund_case_id,r.expires_at,r.status,r.consumed_at,
      r.reply_review_fact_version,c.customer_email,c.public_reference,
      request.id request_id,request.sent_at,request.delivery_transport,
      request.provider_message_id,request.delivery_state
    from public.refund_wallet_correction_contexts r
    join public.refund_cases c on c.id=r.refund_case_id
    join public.refund_case_messages request on request.id=r.correction_message_id
      and request.refund_case_id=r.refund_case_id
    where r.id=p_context_id and r.correction_kind='purchase'
      and not exists(select 1 from public.refund_wallet_correction_contexts newer
        where newer.refund_case_id=r.refund_case_id and newer.correction_kind='purchase'
          and (newer.version,newer.issued_at,newer.id)>(r.version,r.issued_at,r.id))
  ), verified as (
    select g.id,g.received_at,g.plain_body
    from scope s
    join public.refund_gmail_messages g on g.refund_case_id=s.refund_case_id
    where g.direction='inbound' and g.message_kind='message'
      and g.status='received' and g.participant_role='customer'
      and g.participant_trust='verified' and g.content_deleted_at is null
      and lower(btrim(g.sender_email))=lower(btrim(s.customer_email))
      and g.received_at>s.sent_at
      and ((s.reply_review_fact_version is null and g.received_at<=s.expires_at)
        or (s.status='submitted' and s.reply_review_fact_version is not null
          and s.consumed_at is not null and g.received_at>s.consumed_at))
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

-- Keep the public receiver's exact reconciliation-clarification lane intact.
create or replace function public.service_receive_refund_reply_pre_recon_v1(
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
    where r.refund_case_id=c.id and r.correction_kind='purchase'
    order by r.version desc, r.issued_at desc,r.id desc limit 1 for update;
  if ctx.id is null or ctx.status not in ('pending','submitted') then
    return jsonb_build_object('outcome','no_current_request'); end if;
  select * into request from public.refund_case_messages where id=ctx.correction_message_id for update;
  if request.id is null or request.refund_case_id is distinct from c.id
    or request.status<>'sent' or request.sent_at is null
    or request.sent_at>=source.received_at
    or lower(btrim(request.recipient_email)) is distinct from lower(btrim(c.customer_email))
    or public.is_refund_message_recorded_delivery_failure(to_jsonb(request))
    or coalesce(request.delivery_state,'') in ('failed','bounced','complained')
    or ctx.correction_requested_fields is distinct from request.requested_fields
    or (ctx.status='pending' and (ctx.correction_fact_version is distinct from c.deterministic_fact_version
      or ctx.expires_at<source.received_at))
    or (ctx.status='submitted' and (ctx.consumed_at is null
      or source.received_at<=ctx.consumed_at
      or coalesce(ctx.reply_review_fact_version,ctx.correction_resulting_fact_version)
        is distinct from c.deterministic_fact_version
      or exists(select 1 from public.refund_customer_fact_applications application
        join public.refund_gmail_messages applied on applied.id=application.gmail_message_id
        where application.refund_case_id=c.id
          and application.resulting_fact_version=c.deterministic_fact_version
          and applied.received_at>=source.received_at and applied.id<>source.id)))
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
  if ctx.status='submitted' then
    update public.refund_wallet_correction_contexts set
      reply_review_fact_version=c.deterministic_fact_version where id=ctx.id;
  end if;
  reply_set:=public.refund_scoped_verified_reply_set(ctx.id);
  if not (reply_set->'messages' @> jsonb_build_array(
      jsonb_build_object('messageId',source.id))) then
    raise exception 'Verified reply set changed during exact request binding';
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
    reply_lookup_generation=null,
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
  update public.refund_wallet_correction_contexts set
    reply_review_action_version=(select official_action_version
      from public.refund_cases where id=c.id)
    where id=ctx.id;
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

create or replace function public.service_claim_refund_scoped_reply_reviews(
  p_limit integer default 25
) returns jsonb language plpgsql security definer set search_path='' as $$
declare ctx public.refund_wallet_correction_contexts; tasks jsonb:='[]'::jsonb; token uuid;
begin
  -- An undecided case may acquire new read-only evidence without a new
  -- customer answer. Invalidate an in-flight token and rebind the same task
  -- to the current action version; a final decision is never rebound.
  update public.refund_wallet_correction_contexts r set
    reply_review_state='pending',reply_review_due_at=statement_timestamp(),
    reply_review_claim_token=null,reply_review_claimed_at=null,
    reply_review_action_version=c.official_action_version,
    reply_review_result_code='current_case_evidence_changed',
    updated_at=statement_timestamp()
    from public.refund_cases c
    where r.refund_case_id=c.id and r.correction_kind='purchase'
      and (r.status='pending' or (r.status='submitted' and r.reply_review_fact_version is not null)) and r.reply_message_id is not null
      and r.reply_review_state in ('pending','claimed')
      and r.reply_review_action_version is distinct from c.official_action_version
      and coalesce(r.reply_review_fact_version,r.correction_fact_version)=c.deterministic_fact_version
      and c.decision is null and public.refund_purchase_correction_eligible(c);
  update public.refund_wallet_correction_contexts r set
    reply_review_state='resolved',reply_review_due_at=null,
    reply_review_claim_token=null,reply_review_claimed_at=null,
    reply_review_result_code='superseded_by_current_case',
    updated_at=statement_timestamp()
    from public.refund_cases c
    where r.refund_case_id=c.id and r.correction_kind='purchase'
      and (r.status='pending' or (r.status='submitted' and r.reply_review_fact_version is not null)) and r.reply_message_id is not null
      and r.reply_review_state in ('pending','claimed')
      and (r.reply_review_action_version is distinct from c.official_action_version
        or coalesce(r.reply_review_fact_version,r.correction_fact_version) is distinct from c.deterministic_fact_version
        or c.decision is not null or not public.refund_purchase_correction_eligible(c)
        or exists(select 1 from public.refund_wallet_correction_contexts newer
          where newer.refund_case_id=r.refund_case_id and newer.correction_kind='purchase'
            and (newer.version,newer.issued_at,newer.id)>(r.version,r.issued_at,r.id)));
  for ctx in select r.* from public.refund_wallet_correction_contexts r
    join public.refund_cases c on c.id=r.refund_case_id
    where r.correction_kind='purchase' and (r.status='pending' or (r.status='submitted' and r.reply_review_fact_version is not null))
      and not exists(select 1 from public.refund_wallet_correction_contexts newer
        where newer.refund_case_id=r.refund_case_id and newer.correction_kind='purchase'
          and (newer.version,newer.issued_at,newer.id)>(r.version,r.issued_at,r.id))
      and r.reply_message_id is not null and r.reply_review_due_at<=statement_timestamp()
      and (r.reply_review_state='pending' or
        (r.reply_review_state='claimed' and r.reply_review_claimed_at<statement_timestamp()-interval '15 minutes'))
      and r.reply_review_action_version=c.official_action_version
      and coalesce(r.reply_review_fact_version,r.correction_fact_version)=c.deterministic_fact_version
      and c.decision is null and public.refund_purchase_correction_eligible(c)
    order by r.reply_review_due_at,r.id limit least(greatest(coalesce(p_limit,25),1),25)
    for update of r skip locked
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
      'factVersion',coalesce(ctx.reply_review_fact_version,ctx.correction_fact_version),'claimToken',token,
      'bodySha256',ctx.reply_body_sha256,
      'dueAt',ctx.reply_review_due_at,'payloadRedacted',true));
  end loop;
  return jsonb_build_object('tasks',tasks,'payloadRedacted',true);
end;
$$;

create or replace function public.service_defer_refund_scoped_reply_review(
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
  if ctx.id is null or (ctx.status not in ('pending','submitted') or (ctx.status='submitted' and ctx.reply_review_fact_version is null))
    or ctx.reply_review_state<>'claimed'
    or ctx.reply_review_claim_token is distinct from p_claim_token
    or ctx.reply_message_id is distinct from p_source_message_id
    or coalesce(ctx.reply_review_fact_version,ctx.correction_fact_version) is distinct from p_expected_fact_version
    or ctx.reply_review_action_version is distinct from c.official_action_version
    or c.decision is not null or not public.refund_purchase_correction_eligible(c)
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

create or replace function public.service_get_refund_scoped_reply_research_input_pre_subscription(
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
  if ctx.id is null or ctx.correction_kind<>'purchase' or (ctx.status not in ('pending','submitted') or (ctx.status='submitted' and ctx.reply_review_fact_version is null))
    or ctx.reply_review_state<>'claimed'
    or ctx.reply_review_claim_token is distinct from p_claim_token
    or ctx.reply_message_id is distinct from p_source_message_id
    or coalesce(ctx.reply_review_fact_version,ctx.correction_fact_version) is distinct from p_expected_fact_version
    or ctx.reply_review_action_version is distinct from c.official_action_version
    or c.decision is not null or not public.refund_purchase_correction_eligible(c)
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
      'cardLast4Provenance',c.card_last4_provenance,
      'cardNetwork',c.card_network,
      'incidentAt',c.incident_at,
      'incidentLocalDateTime',c.incident_local_datetime,
      'incidentTimezone',c.incident_timezone,
      'incidentTimeConfidence',c.incident_time_confidence,
      'reportingMachineId',c.reporting_machine_id),
    'containsCustomerContent',true);
end;
$$;

create or replace function public.service_get_refund_scoped_reply_research_health_pre_subscription()
returns jsonb language sql stable security definer set search_path='' as $$
  with tasks as (
    select r.reply_review_due_at,r.reply_review_state,
      r.reply_review_claimed_at,r.reply_review_result_code
    from public.refund_wallet_correction_contexts r
    where r.correction_kind='purchase' and (r.status='pending' or (r.status='submitted' and r.reply_review_fact_version is not null))
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

-- Preserve subscription health while extending its existing dependency count.
do $health$
declare definition text; anchor text;
begin
  definition:=pg_get_functiondef('public.service_get_refund_scoped_reply_research_health()'::regprocedure);
  anchor:=$old$r.status='pending'$old$;
  if cardinality(string_to_array(definition,anchor))<>2 then
    raise exception 'Unexpected scoped reply dependency health guard'; end if;
  execute replace(definition,anchor,
    $new$(r.status='pending' or (r.status='submitted' and r.reply_review_fact_version is not null))$new$);
end;
$health$;


-- The unchanged semantic/no-fact service entry points use the same current
-- claim binding when the original form is already submitted. No new API.
do $guards$
declare definition text; signature text; anchor text;
begin
  foreach signature in array array[
    'public.service_apply_refund_scoped_reply_semantic_fact(uuid,uuid,uuid,bigint,text,jsonb,jsonb,text[])',
    'public.service_complete_refund_scoped_reply_no_fact(uuid,uuid,uuid,bigint,text,uuid,text,text)'
  ] loop
    definition:=pg_get_functiondef(signature::regprocedure);
    anchor:=$old$ctx.status<>'pending'$old$;
    if cardinality(string_to_array(definition,anchor))<>2 then
      raise exception 'Unexpected scoped reply status guard: %',signature; end if;
    definition:=replace(definition,anchor,
      $new$(ctx.status not in ('pending','submitted') or (ctx.status='submitted' and ctx.reply_review_fact_version is null))$new$);
    anchor:='ctx.correction_fact_version is distinct from p_expected_fact_version';
    if cardinality(string_to_array(definition,anchor))<>2 then
      raise exception 'Unexpected scoped reply fact guard: %',signature; end if;
    execute replace(definition,anchor,
      'coalesce(ctx.reply_review_fact_version,ctx.correction_fact_version) is distinct from p_expected_fact_version');
  end loop;
end;
$guards$;


create or replace function public.service_apply_refund_scoped_reply_incident_time(
  p_request_id uuid,p_claim_token uuid,p_source_message_id uuid,
  p_expected_fact_version bigint,p_body_sha256 text,
  p_evidence_message_id uuid,p_source_quote text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  ctx public.refund_wallet_correction_contexts;
  c public.refund_cases;
  source public.refund_gmail_messages;
  evidence public.refund_gmail_messages;
  location_row public.reporting_locations;
  parts text[];
  hour_value integer;
  minute_value integer;
  local_date text;
  old_local timestamp;
  local_stamp timestamp;
  instant timestamptz;
  observed_times text[];
  verified_bodies text[];
  source_body text;
  source_timezone text;
  approximate_time boolean:=false;
  natural_time boolean:=false;
  result jsonb;
begin
  select * into c from public.refund_cases
    where id=(select refund_case_id from public.refund_wallet_correction_contexts
      where id=p_request_id) for update;
  select * into ctx from public.refund_wallet_correction_contexts
    where id=p_request_id for update;
  select * into source from public.refund_gmail_messages
    where id=p_source_message_id for update;
  select * into evidence from public.refund_gmail_messages
    where id=p_evidence_message_id for update;
  select * into location_row from public.reporting_locations
    where id=c.reporting_location_id;
  if c.id is null or ctx.id is null or ctx.refund_case_id<>c.id
    or ctx.correction_kind<>'purchase' or (ctx.status not in ('pending','submitted') or (ctx.status='submitted' and ctx.reply_review_fact_version is null))
    or ctx.reply_review_state<>'claimed'
    or ctx.reply_review_claim_token is distinct from p_claim_token
    or ctx.reply_message_id is distinct from p_source_message_id
    or coalesce(ctx.reply_review_fact_version,ctx.correction_fact_version) is distinct from p_expected_fact_version
    or ctx.reply_review_action_version is distinct from c.official_action_version
    or c.deterministic_fact_version is distinct from p_expected_fact_version
    or ctx.reply_body_sha256 is distinct from p_body_sha256
    or c.decision is not null or not public.refund_purchase_correction_eligible(c)
    or c.payment_method is distinct from 'card'
    or c.nayax_refund_execution_status is distinct from 'not_requested'
    or c.refund_completed_at is not null
    or exists(select 1 from public.refund_case_nayax_refund_attempts a
      where a.refund_case_id=c.id)
    or exists(select 1 from public.refund_authoritative_receipts receipt
      where receipt.refund_case_id=c.id)
    or source.id is null or source.refund_case_id is distinct from c.id
    or source.direction<>'inbound' or source.message_kind<>'message'
    or source.status<>'received'
    or source.participant_role<>'customer' or source.participant_trust<>'verified'
    or source.content_deleted_at is not null or source.sensitive_data_redacted
    or source.received_at is distinct from ctx.reply_received_at
    or evidence.id is null or evidence.refund_case_id is distinct from c.id
    or evidence.direction<>'inbound' or evidence.message_kind<>'message'
    or evidence.status<>'received'
    or evidence.participant_role<>'customer' or evidence.participant_trust<>'verified'
    or evidence.content_deleted_at is not null or evidence.sensitive_data_redacted
    or not (public.refund_scoped_verified_reply_set(ctx.id)->'messages'
      @>jsonb_build_array(jsonb_build_object('messageId',evidence.id)))
    or public.refund_scoped_verified_reply_set(ctx.id)->>'bodySha256'
      is distinct from p_body_sha256
    or coalesce(length(p_source_quote),0) not between 3 and 240
    or position(p_source_quote in coalesce(evidence.plain_body,''))=0
    or c.incident_at is null or c.incident_local_datetime is null
    or c.incident_local_datetime !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}$'
  then
    return jsonb_build_object('outcome','stale_or_unsupported_source',
      'payloadRedacted',true);
  end if;
  -- Match currentReplyOnly in the existing email parser. A quoted mail
  -- header's date/time is not a new customer purchase statement.
  select array_agg(regexp_replace(item->>'body',
      E'(^|\\n)[[:blank:]]*(on [^\\n]+wrote:|from:|el [^\\n]+escribi[oó]:|escribi[oó]:|de:|-----[[:blank:]]*(original message|mensaje original)[[:blank:]]*-----).*$',
      '', 'is')) into verified_bodies
    from jsonb_array_elements(public.refund_scoped_verified_reply_set(ctx.id)->'messages') item;
  source_body:=regexp_replace(coalesce(evidence.plain_body,''),
    E'(^|\\n)[[:blank:]]*(on [^\\n]+wrote:|from:|el [^\\n]+escribi[oó]:|escribi[oó]:|de:|-----[[:blank:]]*(original message|mensaje original)[[:blank:]]*-----).*$',
    '', 'is');
  if position(p_source_quote in source_body)=0 then
    return jsonb_build_object('outcome','stale_or_unsupported_source','payloadRedacted',true);
  end if;
  source_timezone:=c.incident_timezone;
  parts:=regexp_match(p_source_quote,
    '^Time:[[:space:]]*([0-9]{1,2}):([0-9]{2})[[:space:]]*(am|pm)[[:space:]]*$','i');
  if parts is null then
    -- Explicit source timezone resolves the clock independently of an old
    -- location mapping. "Eastern" means America/New_York on the saved date,
    -- including DST; it never means a guessed fixed UTC offset.
    parts:=regexp_match(p_source_quote,
      '^(around|about|roughly|approximately)[[:space:]]+([0-9]{1,2})(?::([0-9]{2}))?[[:space:]]*(am|pm)[[:space:]]+eastern(?:[[:space:]]+time)?$','i');
    if parts is null then raise exception 'Source-bound purchase time required'; end if;
    parts:=array[parts[2],coalesce(parts[3],'00'),parts[4]];
    source_timezone:='America/New_York';
    approximate_time:=true;
    natural_time:=true;
    -- A positive clipped phrase cannot stand in for a negated, competing,
    -- date-changing or question-shaped statement in the verified message set.
    if exists(select 1
      from unnest(verified_bodies) body
      where body ~* '(not|never|maybe|perhaps|possibly|or|before|after)[[:space:]]+(around|about|roughly|approximately|[0-9])'
        or body ~ '[?]'
        or body ~* '([0-9]{4}-[0-9]{2}-[0-9]{2}|[0-9]{1,2}/[0-9]{1,2}|yesterday|tomorrow|last[[:space:]]+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)|(jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|may|jun(e)?|jul(y)?|aug(ust)?|sep(tember)?|oct(ober)?|nov(ember)?|dec(ember)?)[[:space:]]+[0-9])'
        or body ~* '\m(pacific|central|mountain|utc|gmt|est|edt|pst|pdt)\M') then
      return jsonb_build_object('outcome','time_requires_research','payloadRedacted',true);
    end if;
    select array_agg(distinct capture[1]::integer::text||':'||coalesce(capture[2],'00')||' '||lower(capture[3]))
      into observed_times
      from unnest(verified_bodies) body
      cross join lateral regexp_matches(body,
        '([0-9]{1,2})(?::([0-9]{2}))?[[:space:]]*(am|pm)','gi') as matches(capture);
    if cardinality(observed_times)<>1 or observed_times[1] is distinct from
      parts[1]::integer::text||':'||parts[2]||' '||lower(parts[3]) then
      return jsonb_build_object('outcome','time_requires_research','payloadRedacted',true);
    end if;
  else
    if location_row.id is null or location_row.status<>'active'
      or c.incident_timezone is distinct from location_row.timezone
      or not exists(select 1 from regexp_split_to_table(source_body,E'\\r?\\n') line
        where btrim(line)=p_source_quote) then
      return jsonb_build_object('outcome','stale_or_unsupported_source','payloadRedacted',true);
    end if;
    select array_agg(distinct (capture[1])::integer::text||':'||capture[2]||' '||lower(capture[3]))
      into observed_times
      from unnest(verified_bodies) body
      cross join lateral regexp_matches(body,
        '^Time:[[:space:]]*([0-9]{1,2}):([0-9]{2})[[:space:]]*(am|pm)[[:space:]]*$','gim') as matches(capture);
    if cardinality(observed_times)<>1 or observed_times[1] is distinct from
      (parts[1])::integer::text||':'||parts[2]||' '||lower(parts[3]) then
      raise exception 'Conflicting labeled purchase times require research';
    end if;
  end if;
  if parts[1]::integer not between 1 and 12 or parts[2]::integer not between 0 and 59 then
    raise exception 'Valid source-bound purchase time required';
  end if;
  hour_value:=parts[1]::integer % 12 + case when lower(parts[3])='pm' then 12 else 0 end;
  minute_value:=parts[2]::integer;
  local_date:=substring(c.incident_local_datetime from 1 for 10);
  old_local:=c.incident_local_datetime::timestamp;
  local_stamp:=(local_date||'T'||lpad(hour_value::text,2,'0')||':'||
    lpad(minute_value::text,2,'0'))::timestamp;
  if (not natural_time and abs(extract(epoch from local_stamp-old_local))>43200)
    or (local_stamp=old_local and source_timezone=c.incident_timezone
      and (not approximate_time or c.incident_time_confidence='rough')) then
    return jsonb_build_object('outcome','time_requires_research',
      'payloadRedacted',true);
  end if;
  instant:=local_stamp at time zone source_timezone;
  if instant at time zone source_timezone<>local_stamp
    or (instant-interval '1 hour') at time zone source_timezone=local_stamp
    or (instant+interval '1 hour') at time zone source_timezone=local_stamp
    or instant<statement_timestamp()-interval '90 days'
    or instant>statement_timestamp()+interval '1 hour' then
    return jsonb_build_object('outcome','time_requires_research',
      'payloadRedacted',true);
  end if;
  result:=public.service_apply_refund_gmail_customer_facts_v1(
    c.id,evidence.id,p_expected_fact_version,
    jsonb_build_object('incident_at',instant,
      'incident_local_datetime',to_char(local_stamp,'YYYY-MM-DD"T"HH24:MI'),
      'incident_timezone',source_timezone,
      'incident_time_resolution','exact')||
      case when approximate_time then jsonb_build_object('incident_time_confidence','rough')
        else '{}'::jsonb end,
    array['incident_time']::text[],'verified_reply_semantic_v1');
  if result->>'outcome'='already_applied' and not exists(
    select 1 from public.refund_customer_fact_applications application
    where application.gmail_message_id=evidence.id and application.refund_case_id=c.id
      and 'incident_time'=any(application.applied_fields)) then
    return jsonb_build_object('outcome','stale_or_unsupported_source','payloadRedacted',true);
  end if;
  if result->>'outcome' in ('applied','already_applied') then
    update public.refund_wallet_correction_contexts set
      reply_review_state='resolved',reply_review_result_code='facts_applied',
      reply_review_fact_version=case when reply_review_fact_version is not null then
        (select deterministic_fact_version from public.refund_cases where id=c.id) end,
      updated_at=statement_timestamp()
    where id=ctx.id and reply_review_state in ('claimed','resolved')
      and reply_review_claim_token=p_claim_token
      and reply_message_id=p_source_message_id
      and reply_body_sha256=p_body_sha256;
  end if;
  return result||jsonb_build_object('payloadRedacted',true);
end;
$$;

-- A settled reply receipt advances only its reply fact binding. The original
-- secure-form resulting version and submitted answers remain immutable history.
do $reply_receipt$
declare definition text; anchor text;
begin
  definition:=replace(pg_get_functiondef(
    'public.service_apply_refund_gmail_customer_facts_v1(uuid,uuid,bigint,jsonb,text[],text)'::regprocedure),E'\r\n',E'\n');
  anchor:=$old$reply_review_state='resolved',reply_review_result_code='facts_applied',
      updated_at=statement_timestamp()$old$;
  if cardinality(string_to_array(definition,anchor))<>2 then
    raise exception 'Unexpected customer fact reply settlement'; end if;
  execute replace(definition,anchor,
    $new$reply_review_state='resolved',reply_review_result_code='facts_applied',
      reply_review_fact_version=case when ctx.reply_review_fact_version is not null then
        (select deterministic_fact_version from public.refund_cases where id=p_refund_case_id) end,
      updated_at=statement_timestamp()$new$);
end;
$reply_receipt$;


-- Keep the public secure-form continuation projection around this reply lane.
create or replace function public.refund_outreach_pre_form_continuation_v1(
  p_refund_case_id uuid
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb; ctx public.refund_wallet_correction_contexts;
  lookup_status text; case_payment_method text;
begin
  result:=public.refund_customer_outreach_pre_verified_reply_continuation(p_refund_case_id);
  if result is null then return result; end if;
  select * into ctx from public.refund_wallet_correction_contexts r
    where r.refund_case_id=p_refund_case_id and r.correction_kind='purchase'
      and r.reply_message_id is not null
      and ((r.status='pending' and r.reply_review_state in ('pending','claimed','resolved'))
        or (r.status='submitted' and r.reply_review_state='resolved'
          and r.reply_review_result_code='facts_applied')
        or (r.status='submitted' and r.reply_review_fact_version is not null
          and r.reply_review_state in ('pending','claimed','resolved')))
      and (r.correction_message_id=(result->>'requestMessageId')::uuid
        or (r.status='submitted' and r.reply_review_fact_version is not null))
      and not exists(select 1 from public.refund_wallet_correction_contexts newer
        where newer.refund_case_id=r.refund_case_id and newer.correction_kind='purchase'
          and (newer.version,newer.issued_at,newer.id)>(r.version,r.issued_at,r.id))
    order by r.version desc,r.issued_at desc limit 1;
  if ctx.id is null or (ctx.reply_review_fact_version is null
    and result->>'state' not in ('waiting_for_customer','customer_replied')) then
    return result; end if;
  if ctx.status='submitted' and ctx.reply_review_result_code='facts_applied' then
    select c.nayax_lookup_status,c.payment_method into lookup_status,case_payment_method
      from public.refund_cases c
      where c.id=p_refund_case_id;
    if case_payment_method='card' and lookup_status in ('not_started','checking') then
      return result||jsonb_build_object('state','rechecking','owner','System',
        'nextAction','recheck_customer_reply','replyReceivedAt',ctx.reply_received_at,
        'reasonCode','verified_reply_reviewed','payloadRedacted',true);
    end if;
    -- The subsequent provider result now owns the case stage. Preserve the
    -- delivered request history without presenting an active customer wait.
    return result||jsonb_build_object('state','none','owner','None',
      'nextAction','none','replyReceivedAt',ctx.reply_received_at,
      'reasonCode','verified_reply_reviewed','payloadRedacted',true);
  end if;
  return result||jsonb_build_object('state','customer_replied','owner','System',
    'nextAction','recheck_customer_reply','replyReceivedAt',ctx.reply_received_at,
    'reasonCode',case when ctx.reply_review_state='resolved'
      then 'verified_reply_reviewed' else 'verified_reply_review_due' end,
    'payloadRedacted',true);
end;
$$;

-- Approximation belongs in the existing atomic fact write and receipt;
-- changing confidence separately would create a second version outside it.
do $confidence$
declare definition text; anchor text;
begin
  definition:=replace(pg_get_functiondef(
    'public.service_apply_refund_gmail_customer_facts_pre_payout_destination(uuid,uuid,bigint,jsonb,text[],text)'::regprocedure),E'\r\n',E'\n');
  anchor:=$old$      'incident_time_resolution',$old$;
  if cardinality(string_to_array(definition,anchor))<>2 then
    raise exception 'Unexpected customer fact confidence allowlist'; end if;
  definition:=replace(definition,anchor,anchor||E'\n      ''incident_time_confidence'',');
  anchor:=$old$    incident_time_resolution = case when p_updates ? 'incident_time_resolution'$old$;
  if cardinality(string_to_array(definition,anchor))<>2 then
    raise exception 'Unexpected customer fact confidence writer'; end if;
  execute replace(definition,anchor,
    $new$    incident_time_confidence = case when p_updates ? 'incident_time_confidence'
      then nullif(p_updates ->> 'incident_time_confidence', '')
      else refund_case.incident_time_confidence end,
$new$||anchor);
end;
$confidence$;

select pg_notify('pgrst','reload schema');

