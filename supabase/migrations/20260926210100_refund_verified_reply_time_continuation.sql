-- A verified reply can correct the purchase wall-clock time without letting an
-- interpreter invent a date, timezone, UTC instant, provider purchase, or
-- payment action. The existing customer-fact writer owns the one fact receipt.
create function public.service_apply_refund_scoped_reply_incident_time(
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
    or ctx.correction_kind<>'purchase' or ctx.status<>'pending'
    or ctx.reply_review_state<>'claimed'
    or ctx.reply_review_claim_token is distinct from p_claim_token
    or ctx.reply_message_id is distinct from p_source_message_id
    or ctx.correction_fact_version is distinct from p_expected_fact_version
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
    or source.direction<>'inbound' or source.status<>'received'
    or source.participant_role<>'customer' or source.participant_trust<>'verified'
    or source.content_deleted_at is not null or source.sensitive_data_redacted
    or source.received_at is distinct from ctx.reply_received_at
    or evidence.id is null or evidence.refund_case_id is distinct from c.id
    or evidence.direction<>'inbound' or evidence.status<>'received'
    or evidence.participant_role<>'customer' or evidence.participant_trust<>'verified'
    or evidence.content_deleted_at is not null or evidence.sensitive_data_redacted
    or not (public.refund_scoped_verified_reply_set(ctx.id)->'messages'
      @>jsonb_build_array(jsonb_build_object('messageId',evidence.id)))
    or public.refund_scoped_verified_reply_set(ctx.id)->>'bodySha256'
      is distinct from p_body_sha256
    or coalesce(length(p_source_quote),0) not between 10 and 40
    or position(p_source_quote in coalesce(evidence.plain_body,''))=0
    or c.incident_local_datetime !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}$'
    or location_row.id is null or location_row.status<>'active'
    or c.incident_timezone is distinct from location_row.timezone
  then
    return jsonb_build_object('outcome','stale_or_unsupported_source',
      'payloadRedacted',true);
  end if;
  parts:=regexp_match(p_source_quote,
    '^Time:[[:space:]]*([0-9]{1,2}):([0-9]{2})[[:space:]]*(am|pm)[[:space:]]*$','i');
  if parts is null or parts[1]::integer not between 1 and 12
    or parts[2]::integer not between 0 and 59 then
    raise exception 'Exact labeled purchase time required';
  end if;
  -- Repeated quoted copies of the same answer are harmless; distinct labeled
  -- times in this verified set need human research rather than a chosen value.
  if (select count(distinct (capture[1])::integer::text||':'||capture[2]||' '||lower(capture[3]))
      from jsonb_array_elements(public.refund_scoped_verified_reply_set(ctx.id)->'messages') item
      join public.refund_gmail_messages reply on reply.id=(item->>'messageId')::uuid
      cross join lateral regexp_matches(coalesce(reply.plain_body,''),
        '^Time:[[:space:]]*([0-9]{1,2}):([0-9]{2})[[:space:]]*(am|pm)[[:space:]]*$','gim') as matches(capture)
    )<>1 then
    raise exception 'Conflicting labeled purchase times require research';
  end if;
  hour_value:=parts[1]::integer % 12 + case when lower(parts[3])='pm' then 12 else 0 end;
  minute_value:=parts[2]::integer;
  local_date:=substring(c.incident_local_datetime from 1 for 10);
  old_local:=c.incident_local_datetime::timestamp;
  local_stamp:=(local_date||'T'||lpad(hour_value::text,2,'0')||':'||
    lpad(minute_value::text,2,'0'))::timestamp;
  if abs(extract(epoch from local_stamp-old_local))>43200
    or local_stamp=old_local then
    return jsonb_build_object('outcome','time_requires_research',
      'payloadRedacted',true);
  end if;
  instant:=local_stamp at time zone c.incident_timezone;
  if instant at time zone c.incident_timezone<>local_stamp
    or (instant-interval '1 hour') at time zone c.incident_timezone=local_stamp
    or (instant+interval '1 hour') at time zone c.incident_timezone=local_stamp
    or instant<statement_timestamp()-interval '90 days'
    or instant>statement_timestamp()+interval '1 hour' then
    return jsonb_build_object('outcome','time_requires_research',
      'payloadRedacted',true);
  end if;
  result:=public.service_apply_refund_gmail_customer_facts_v1(
    c.id,evidence.id,p_expected_fact_version,
    jsonb_build_object('incident_at',instant,
      'incident_local_datetime',to_char(local_stamp,'YYYY-MM-DD"T"HH24:MI'),
      'incident_timezone',c.incident_timezone,
      'incident_time_resolution','exact'),
    array['incident_time']::text[],'verified_reply_semantic_v1');
  return result||jsonb_build_object('payloadRedacted',true);
end;
$$;
revoke all on function public.service_apply_refund_scoped_reply_incident_time(
  uuid,uuid,uuid,bigint,text,uuid,text) from public,anon,authenticated;
grant execute on function public.service_apply_refund_scoped_reply_incident_time(
  uuid,uuid,uuid,bigint,text,uuid,text) to service_role;
comment on function public.service_apply_refund_scoped_reply_incident_time(
  uuid,uuid,uuid,bigint,text,uuid,text) is
  'Applies one exact source-quoted verified reply time through the existing fact writer using the case date and canonical location timezone. No provider or payment call.';
