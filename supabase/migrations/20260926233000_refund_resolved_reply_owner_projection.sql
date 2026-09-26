-- A source-bound reply fact can settle its correction context while the
-- original delivery remains recorded as waiting for a customer response.
-- Keep the existing message history, but project the current System recheck.
create or replace function public.refund_customer_outreach_contract(
  p_refund_case_id uuid
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb; ctx public.refund_wallet_correction_contexts;
  lookup_status text; case_payment_method text;
begin
  result:=public.refund_customer_outreach_pre_verified_reply_continuation(p_refund_case_id);
  if result is null or result->>'state' not in ('waiting_for_customer','customer_replied')
    then return result; end if;
  select * into ctx from public.refund_wallet_correction_contexts r
    where r.refund_case_id=p_refund_case_id and r.correction_kind='purchase'
      and r.reply_message_id is not null
      and ((r.status='pending' and r.reply_review_state in ('pending','claimed','resolved'))
        or (r.status='submitted' and r.reply_review_state='resolved'
          and r.reply_review_result_code='facts_applied'))
      and r.correction_message_id=(result->>'requestMessageId')::uuid
    order by r.version desc,r.issued_at desc limit 1;
  if ctx.id is null then return result; end if;
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
revoke all on function public.refund_customer_outreach_contract(uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.refund_customer_outreach_contract(uuid)
  to service_role;

-- The canonical next-work projection must not reopen a completed reply task.
-- It should point to the already scheduled read-only lookup while that lookup
-- has not finished; later provider results use the ordinary case-stage rules.
do $resolved_reply_next_work$
declare body text; anchor text; replacement text;
begin
  body:=replace(pg_get_functiondef(
    'public.refund_next_work_projection(jsonb,timestamptz)'::regprocedure),E'\r\n',E'\n');
  anchor:=$anchor$  elsif reply_at <> '-infinity'::timestamptz and request_sent_at is not null
    and reply_at > request_sent_at and outreach_state in ('waiting_for_customer', 'customer_replied', 'rechecking') then$anchor$;
  replacement:=$replacement$  elsif outreach_state='rechecking' and outreach->>'reasonCode'='verified_reply_reviewed'
    and p_lifecycle->'lookup'->>'status' in ('not_started','checking') then
    actor_name := 'system';
    action_code := 'run_lookup';
    action_label := 'Recheck the purchase using the verified customer reply.';
  elsif outreach_state='customer_replied' and outreach->>'reasonCode'='verified_reply_reviewed' then
    actor_name := 'agent';
    action_code := 'research_purchase';
    action_label := 'Continue purchase research; the verified reply has already been reviewed.';
    blocker := jsonb_build_object(
      'code', 'stable_evidence_dependency', 'owner', 'Agent',
      'nextStep', 'Find new verified purchase evidence or wait for a completed read-only lookup before continuing.'
    );
  elsif reply_at <> '-infinity'::timestamptz and request_sent_at is not null
    and reply_at > request_sent_at and outreach_state in ('waiting_for_customer', 'customer_replied', 'rechecking')
    and coalesce(outreach->>'reasonCode','') <> 'verified_reply_reviewed' then$replacement$;
  if cardinality(string_to_array(body,anchor))<>2 then
    raise exception 'Unexpected canonical reply next-work projection shape';
  end if;
  execute replace(body,anchor,replacement);
end;
$resolved_reply_next_work$;

-- The legacy queue still offers Manager transaction selection after purchase
-- research, even when the canonical next work correctly stays internal. Keep
-- the overview and detail queue aligned until a reviewed candidate-set proof
-- makes one final Manager decision available.
create function public.refund_resolved_reply_internal_queue(
  p_lifecycle jsonb, p_projected_lifecycle jsonb
) returns jsonb language sql immutable set search_path='' as $$
  select case when p_lifecycle#>>'{customerOutreach,reasonCode}'='verified_reply_reviewed'
      and p_lifecycle#>>'{customerOutreach,state}'='none'
      and p_lifecycle->>'stage'='needs_transaction_selection'
      and p_projected_lifecycle->>'preparationPending'='true'
    then p_lifecycle||jsonb_build_object(
      'managerAction',coalesce(p_lifecycle->'managerAction','{}'::jsonb)
        ||jsonb_build_object('action','none','owner','System'),
      'managerNextAction','research_purchase',
      'managerQueue',coalesce(p_lifecycle->'managerQueue','{}'::jsonb)
        ||jsonb_build_object('bucket','in_progress',
          'label','Bloomjoy purchase research','nextAction','research_purchase',
          'customerActionFields','[]'::jsonb))
    else p_lifecycle end;
$$;
revoke all on function public.refund_resolved_reply_internal_queue(jsonb,jsonb)
  from public,anon,authenticated;
grant execute on function public.refund_resolved_reply_internal_queue(jsonb,jsonb)
  to service_role;

do $resolved_reply_queue$
declare body text; anchor text; replacement text;
begin
  body:=replace(pg_get_functiondef(
    'public.refund_next_work_for_case(uuid,jsonb)'::regprocedure),E'\r\n',E'\n');
  anchor:=$anchor$  return p_lifecycle || jsonb_build_object(
    'nextWork', public.refund_next_work_projection(projected_lifecycle, verified_reply_at)
  );$anchor$;
  replacement:=$replacement$  return public.refund_resolved_reply_internal_queue(p_lifecycle,projected_lifecycle)
    || jsonb_build_object(
      'nextWork', public.refund_next_work_projection(projected_lifecycle, verified_reply_at)
    );$replacement$;
  if cardinality(string_to_array(body,anchor))<>2 then
    raise exception 'Unexpected next-work case wrapper shape';
  end if;
  execute replace(body,anchor,replacement);
end;
$resolved_reply_queue$;

select pg_notify('pgrst','reload schema');
