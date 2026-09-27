-- A no-message cycle cannot have a customer question to deliver. Patch the
-- current projection in place, preserving the earlier reply and wallet gates.
do $empty_question_projection$
declare body text; anchor text; replacement text;
begin
  body := replace(pg_get_functiondef(
    'public.refund_next_work_projection(jsonb,timestamptz)'::regprocedure),
    E'\r\n', E'\n');
  anchor := $anchor$  elsif outreach_state in ('delivery_failed', 'delivery_unknown', 'policy_suppressed', 'clarification_exhausted', 'manual_fallback') then$anchor$;
  replacement := $replacement$  elsif outreach_state in ('delivery_failed', 'policy_suppressed')
    and outreach ->> 'requestMessageId' is null
    and outreach ->> 'requestSentAt' is null
    and outreach -> 'requestedFields' = '[]'::jsonb
    and outreach ->> 'failureCode' in (
      'request_claim_abandoned',
      'pre_message_suppressed:no_customer_correctable_fact'
    ) then
    actor_name := 'agent';
    action_code := 'research_purchase';
    action_label := 'Research the purchase internally; no customer question is ready.';
    blocker := jsonb_build_object(
      'code', 'no_customer_correctable_fact', 'owner', 'Agent',
      'nextStep', 'Check purchase evidence internally before asking the customer for a specific fact.'
    );
  elsif outreach_state in ('delivery_failed', 'delivery_unknown', 'policy_suppressed', 'clarification_exhausted', 'manual_fallback') then$replacement$;
  if cardinality(string_to_array(body, anchor)) <> 2 then
    raise exception 'Unexpected refund next-work outreach branch shape';
  end if;
  execute replace(body, anchor, replacement);
end;
$empty_question_projection$;
-- These six legacy cycles stopped before message creation, but were marked as
-- abandoned delivery. Reclassify only an exact still-current no-safe-match
-- cycle after checking there is no customer question or send evidence.
create function public.service_reclassify_unsent_empty_refund_question(
  p_refund_case_id uuid,
  p_follow_up_cycle_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  case_row public.refund_cases%rowtype;
  cycle_row public.refund_follow_up_cycles%rowtype;
begin
  select * into case_row from public.refund_cases
  where id = p_refund_case_id for update;
  select * into cycle_row from public.refund_follow_up_cycles
  where id = p_follow_up_cycle_id and refund_case_id = p_refund_case_id for update;

  if case_row.id is null or cycle_row.id is null
    or case_row.status <> 'needs_review'
    or cycle_row.status <> 'manual_review'
    or cycle_row.reason_code <> 'no_safe_match'
    or cycle_row.failure_code <> 'request_claim_abandoned'
    or cycle_row.case_fact_version <> case_row.deterministic_fact_version
    or cardinality(cycle_row.requested_fields) <> 0
    or cardinality(public.refund_purchase_correction_request_fields(case_row.id)) <> 0
    or cycle_row.request_message_id is not null
    or cycle_row.request_created_at is not null
    or cycle_row.request_sent_at is not null
    or cycle_row.reminder_message_id is not null
    or cycle_row.reminder_sent_at is not null
    or cycle_row.receipt_message_id is not null
    or cycle_row.receipt_sent_at is not null
    or exists (
      select 1 from public.refund_case_messages message
      where message.follow_up_cycle_id = cycle_row.id
    )
  then
    raise exception 'Exact unsent current empty-question cycle required';
  end if;

  update public.refund_follow_up_cycles
  set failure_code = 'pre_message_suppressed:no_customer_correctable_fact',
      updated_at = statement_timestamp()
  where id = cycle_row.id;

  insert into public.refund_case_events(refund_case_id,event_type,message,metadata)
  values (case_row.id,'refund_empty_question_reclassified',
    'An unsent empty customer question was reclassified for internal purchase research.',
    jsonb_build_object('follow_up_cycle_id',cycle_row.id,
      'message_created',false,'customer_send',false,'payload_redacted',true));

  return jsonb_build_object('reclassified',true,'caseId',case_row.id,
    'cycleId',cycle_row.id,'payloadRedacted',true);
end;
$$;

revoke all on function public.service_reclassify_unsent_empty_refund_question(uuid,uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.service_reclassify_unsent_empty_refund_question(uuid,uuid)
  to service_role;
