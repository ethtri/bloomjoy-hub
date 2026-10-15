-- #1426: health already treats an exact empty historical question as obsolete.
-- Keep its unknown transport immutable, while the current case names the real
-- internal evidence dependency. This projection grants no send or decision.
do $obsolete_question_next_work$
declare
  definition text;
  anchor text := $anchor$  work:=result->'nextWork';$anchor$;
  replacement text := $replacement$  work:=result->'nextWork';
  if result->>'schemaVersion'='refund_lifecycle_v2'
    and result->>'payloadRedacted'='true'
    and result->>'paymentState'='not_requested'
    and result->>'terminal'='false'
    and (result->>'stage' in ('matching','needs_transaction_selection')
      or (result->>'stage'='awaiting_payout'
        and result->>'reasonCode'='external_payment_ready'))
    and result->'decisionRecommendation'='null'::jsonb
    and work->>'schemaVersion'='refund_next_work_v1'
    and work->>'payloadRedacted'='true'
    and work->>'isOpen'='true'
    and work->>'actor'='agent'
    and work->>'actionCode'='recover_customer_delivery'
    and work#>>'{blocker,code}'='request_delivery_unknown'
    and result#>>'{customerOutreach,schemaVersion}'='refund_customer_outreach_v1'
    and result#>>'{customerOutreach,payloadRedacted}'='true'
    and result#>>'{customerOutreach,state}'='delivery_unknown'
    and result#>'{customerOutreach,requestedFields}'='[]'::jsonb
    and exists (
      select 1
      from public.refund_cases c
      join public.refund_follow_up_cycles cycle
        on cycle.refund_case_id=c.id
        and cycle.id::text=result#>>'{customerOutreach,cycleId}'
        and cycle.case_fact_version=c.deterministic_fact_version
      join public.refund_case_messages request
        on request.refund_case_id=c.id
        and request.id=cycle.request_message_id
        and request.follow_up_cycle_id=cycle.id
        and request.id::text=result#>>'{customerOutreach,requestMessageId}'
      where c.id=p_refund_case_id
        and c.case_population='customer'
        and c.status in ('submitted','needs_review','correlated')
        and c.resolution_method='original_payment'
        and c.decision is null
        and c.refund_completed_at is null
        and c.reporting_adjustment_id is null
        and c.deterministic_fact_version::text=
          result#>>'{customerOutreach,caseFactVersion}'
        -- These are the existing resolved_obsolete health predicates. NULL
        -- is not an empty question or proof that no current field is needed.
        and request.message_type in ('more_info','no_safe_match')
        and request.requested_fields='{}'::text[]
        and public.refund_purchase_correction_request_fields(c.id)='{}'::text[]
        and not exists (select 1 from public.refund_case_nayax_refund_attempts a
          where a.refund_case_id=c.id)
        and not exists (select 1 from public.refund_authoritative_receipts receipt
          where receipt.refund_case_id=c.id)
    ) then
    work:=work||jsonb_build_object(
      'actionCode','research_purchase',
      'actionLabel','Find verified purchase evidence; no current customer question is outstanding.',
      'dueAt',null,
      'blocker',jsonb_build_object(
        'code','stable_evidence_dependency','owner','Agent',
        'nextStep','Find new verified purchase evidence or resolve the existing research dependency; do not repeat the obsolete question.'));
    queue:=case when jsonb_typeof(result->'managerQueue')='object'
      then result->'managerQueue' else '{}'::jsonb end;
    result:=result||jsonb_build_object(
      'nextWork',work,'managerNextAction','research_purchase',
      'managerAction',coalesce(result->'managerAction','{}'::jsonb)
        ||jsonb_build_object('action','none','owner','System','safeRetryEligible',false),
      'managerQueue',queue||jsonb_build_object(
        'bucket','provider_hold','label','Purchase evidence needed',
        'nextAction','research_purchase','safeRetryEligible',false,
        'customerActionFields','[]'::jsonb),
      'operations',coalesce(result->'operations','{}'::jsonb)
        ||jsonb_build_object('failureClass','stable_evidence_dependency',
          'nextStep','Find verified purchase evidence; do not repeat the obsolete customer question.'));
  end if;$replacement$;
begin
  definition:=replace(pg_get_functiondef(
    'public.refund_next_work_for_case(uuid,jsonb)'::regprocedure),E'\r\n',E'\n');
  if cardinality(string_to_array(definition,anchor))<>2 then
    raise exception 'Unexpected current case-bound next-work assembly';
  end if;
  execute replace(definition,anchor,replacement);
end;
$obsolete_question_next_work$;

-- Carry only the existing redacted blocker code into the compact queue item.
-- Preserve its role/scope checks, limits, single lifecycle read and ACLs.
do $obsolete_question_queue_copy$
declare
  definition text;
  public_definition text;
  anchor text := $anchor$      'nextWorkActionCode', next_work ->> 'actionCode',$anchor$;
begin
  public_definition:=pg_get_functiondef(
    'public.get_refund_portal_queue_projection(timestamptz)'::regprocedure);
  if cardinality(string_to_array(public_definition,
    'public.get_refund_portal_queue_projection_pre_company_v1(p_observed_at)'))<>2 then
    raise exception 'Unexpected compact queue company-wrapper lineage';
  end if;
  definition:=replace(pg_get_functiondef(
    'public.get_refund_portal_queue_projection_pre_company_v1(timestamptz)'::regprocedure),E'\r\n',E'\n');
  if cardinality(string_to_array(definition,anchor))<>2 then
    raise exception 'Unexpected compact refund queue work projection';
  end if;
  execute replace(definition,anchor,anchor||E'\n' ||
    $field$      'nextWorkBlockerCode', next_work #>> '{blocker,code}',$field$);
end;
$obsolete_question_queue_copy$;

select pg_notify('pgrst','reload schema');
