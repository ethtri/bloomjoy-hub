-- A current no-question cycle is internal purchase research, not a customer
-- message awaiting delivery. Keep the old failure row and all real message
-- failures visible; change only the redacted health projection.
do $no_question_health$
declare
  body text;
  anchor text;
  replacement text;
begin
  body := replace(pg_get_functiondef(
    'public.service_get_refund_clarification_contact_obligation_health(boolean,boolean,timestamptz)'::regprocedure),
    E'\r\n', E'\n');
  anchor := $anchor$    from eligible
    where truth->>'schemaVersion'='refund_customer_outreach_v1'$anchor$;
  replacement := $replacement$    from eligible e
    where not coalesce((
      e.truth->>'state' = 'policy_suppressed'
      and e.truth->>'reasonCode' = 'no_customer_correctable_fact'
      and e.truth->>'failureCode' in (
        'request_claim_abandoned',
        'pre_message_suppressed:no_customer_correctable_fact'
      )
      and e.truth->>'requestMessageId' is null
      and e.truth->>'requestSentAt' is null
      and e.truth->'requestedFields' = '[]'::jsonb
      and exists (
        select 1 from public.refund_follow_up_cycles no_question_cycle
        where no_question_cycle.id = nullif(e.truth->>'cycleId', '')::uuid
          and no_question_cycle.refund_case_id = e.id
          and no_question_cycle.status = 'manual_review'
          and no_question_cycle.reason_code = 'no_safe_match'
          and no_question_cycle.failure_code = e.truth->>'failureCode'
          and no_question_cycle.case_fact_version = e.deterministic_fact_version
          and cardinality(no_question_cycle.requested_fields) = 0
          and no_question_cycle.request_message_id is null
          and no_question_cycle.request_created_at is null
          and no_question_cycle.request_sent_at is null
          and no_question_cycle.reminder_message_id is null
          and no_question_cycle.reminder_sent_at is null
          and no_question_cycle.receipt_message_id is null
          and no_question_cycle.receipt_sent_at is null
          and not exists (
            select 1 from public.refund_case_messages linked_message
            where linked_message.follow_up_cycle_id = no_question_cycle.id
          )
      )
    ), false)
      and truth->>'schemaVersion'='refund_customer_outreach_v1'$replacement$;
  if cardinality(string_to_array(body, anchor)) <> 2 then
    raise exception 'Unexpected clarification health current-work shape';
  end if;
  execute replace(body, anchor, replacement);
end;
$no_question_health$;
