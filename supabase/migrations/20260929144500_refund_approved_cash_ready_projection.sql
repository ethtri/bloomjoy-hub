-- An approved cash case may return from a payout-destination correction with
-- the new destination saved while its case state still requires Agent review.
-- The lifecycle's broad cash stage can look payment-ready before the protected
-- payout action is actually eligible. Keep that intermediate state internal so
-- the Manager digest cannot advertise an action that its exact snapshot rejects.
do $approved_cash_ready_projection$
declare
  source_definition text;
  old_fragment text := $fragment$
  -- Preserve prior decisions, cash execution, payment and delivery recovery.
  if c.id is null or c.decision is not null
    or result#>>'{nextWork,isOpen}' is distinct from 'true' then
    return result||jsonb_build_object('decisionRecommendation',null);
  end if;
  recommendation:=public.refund_decision_recommendation_for_case(c.id);
  work:=result->'nextWork';
$fragment$;
  new_fragment text := $fragment$
  work:=result->'nextWork';
  -- A saved approval is payment authority only after the case reaches the
  -- protected cash_zelle_pending state. A just-applied payout-destination
  -- reply remains Agent work; any other state mismatch remains an integrity
  -- reconciliation. Neither path reopens the approval or permits payment.
  if c.id is not null
    and c.decision='approved'
    and c.payment_method='cash'
    and work->>'actor'='manager'
    and work->>'actionCode'='send_cash_refund_and_confirm'
    and (c.status<>'cash_zelle_pending'
      or result#>>'{managerAction,action}' is distinct from 'mark_external_refund') then
    work:=(work-'preparationProofId'-'eligibleCandidateTokens')
      ||jsonb_build_object(
        'actor','agent',
        'actionCode',case when c.status='cash_zelle_pending'
            and result#>>'{managerAction,action}'='resolve_manager_access'
          then 'resolve_manager_assignment'
          when c.status='needs_review'
            and c.automation_state='customer_replied'
          then 'review_customer_reply' else 'reconcile_integrity' end,
        'actionLabel',case when c.status='cash_zelle_pending'
            and result#>>'{managerAction,action}'='resolve_manager_access'
          then 'Resolve the assigned Manager access for this machine.'
          when c.status='needs_review'
            and c.automation_state='customer_replied'
          then 'Review the payout-destination reply before continuing the approved cash case.'
          else 'Reconcile the approved cash case before any payout action.' end,
        'blocker',jsonb_build_object(
          'code',case when c.status='cash_zelle_pending'
              and result#>>'{managerAction,action}'='resolve_manager_access'
            then 'manager_assignment_unavailable'
            when c.status='needs_review'
              and c.automation_state='customer_replied'
            then 'payout_destination_review_pending'
            else 'approved_cash_state_not_ready' end,
          'owner','Agent',
          'nextStep',case when c.status='cash_zelle_pending'
              and result#>>'{managerAction,action}'='resolve_manager_access'
            then 'Verify the machine assignment and restore the existing payout path.'
            when c.status='needs_review'
              and c.automation_state='customer_replied'
            then 'Review the verified reply and restore the existing approved payout path.'
            else 'Reconcile the case state without changing the saved decision or sending funds.' end));
    result:=jsonb_set(result,'{managerAction,action}','"none"'::jsonb,true);
    return result||jsonb_build_object(
      'nextWork',work,'decisionRecommendation',null);
  end if;
  -- Preserve prior decisions, cash execution, payment and delivery recovery.
  if c.id is null or c.decision is not null
    or result#>>'{nextWork,isOpen}' is distinct from 'true' then
    return result||jsonb_build_object('decisionRecommendation',null);
  end if;
  recommendation:=public.refund_decision_recommendation_for_case(c.id);
$fragment$;
begin
  source_definition:=replace(pg_get_functiondef(
    'public.refund_next_work_for_case(uuid,jsonb)'::regprocedure),E'\r\n',E'\n');
  if strpos(source_definition,old_fragment)=0
    or strpos(source_definition,new_fragment)>0 then
    raise exception 'Refund next-work decision wrapper source changed'
      using errcode='P4652';
  end if;
  execute replace(source_definition,old_fragment,new_fragment);
end;
$approved_cash_ready_projection$;

comment on function public.refund_next_work_for_case(uuid,jsonb) is
  'Canonical current-case next-work projection. Approved cash payout is Manager work only from protected cash_zelle_pending state with an exact authorized Manager action; reply review, assignment repair and inconsistent states remain Agent-owned.';

select pg_notify('pgrst','reload schema');
