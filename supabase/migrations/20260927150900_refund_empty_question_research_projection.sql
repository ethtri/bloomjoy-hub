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
-- The old cycle evidence is immutable. Project its current no-message truth
-- without changing the historical failure code or claiming a customer send.
do $empty_question_outreach$
declare body text; anchor text; replacement text; reason_anchor text; reason_replacement text;
begin
  body := replace(pg_get_functiondef(
    'public.refund_customer_outreach_contract(uuid)'::regprocedure),
    E'\r\n', E'\n');
  anchor := $anchor$      'pre_message_suppressed:no_customer_correctable_fact'
    ) then$anchor$;
  replacement := $replacement$      'pre_message_suppressed:no_customer_correctable_fact'
    )
    or (cycle_row.status = 'manual_review'
      and cycle_row.failure_code = 'request_claim_abandoned'
      and cycle_row.reason_code = 'no_safe_match'
      and cycle_row.case_fact_version = case_row.deterministic_fact_version
      and cardinality(cycle_row.requested_fields) = 0
      and cardinality(current_fields) = 0
      and cycle_row.request_message_id is null
      and cycle_row.request_created_at is null
      and cycle_row.request_sent_at is null
      and cycle_row.reminder_message_id is null
      and cycle_row.reminder_sent_at is null
      and cycle_row.receipt_message_id is null
      and cycle_row.receipt_sent_at is null
      and not exists (
        select 1 from public.refund_case_messages message
        where message.follow_up_cycle_id = cycle_row.id
      ))
    then$replacement$;
  reason_anchor := $anchor$    reason_code := replace(cycle_row.failure_code, 'pre_message_suppressed:', '');$anchor$;
  reason_replacement := $replacement$    reason_code := case
      when cycle_row.failure_code = 'request_claim_abandoned'
        then 'no_customer_correctable_fact'
      else replace(cycle_row.failure_code, 'pre_message_suppressed:', '')
    end;$replacement$;
  if cardinality(string_to_array(body, anchor)) <> 2
    or cardinality(string_to_array(body, reason_anchor)) <> 2 then
    raise exception 'Unexpected refund outreach no-message branch shape';
  end if;
  execute replace(replace(body, anchor, replacement), reason_anchor, reason_replacement);
end;
$empty_question_outreach$;