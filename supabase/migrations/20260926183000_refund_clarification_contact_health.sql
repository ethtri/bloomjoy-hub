-- The outreach contract already chooses one causal request. Health reads that
-- current request and its real send evidence instead of treating every old
-- failed clarification message as a fresh obligation.
create function public.service_get_refund_clarification_contact_obligation_health(
  p_automation_enabled boolean,p_customer_contact_enabled boolean,
  p_observed_at timestamptz)
returns jsonb language sql stable security definer set search_path='' as $$
  with eligible as (
    select c.id,c.deterministic_fact_version,o.truth,
      cycle.created_at cycle_created_at,cycle.case_fact_version,
      request.id request_id,request.created_at request_created_at,
      request.status request_status,request.delivery_transport,
      request.delivery_state,request.provider_message_id,
      request.manual_delivery_state,
      exists(select 1 from public.refund_gmail_messages gmail
        where gmail.refund_case_message_id=request.id
          and gmail.refund_case_id=c.id and gmail.direction='outbound'
          and gmail.status='sent' and gmail.sent_at is not null
          and nullif(btrim(gmail.provider_message_id),'') is not null
      ) gmail_accepted,
      exists(select 1 from public.refund_gmail_messages gmail
        where gmail.refund_case_message_id=request.id
          and gmail.refund_case_id=c.id and gmail.direction='outbound'
          and gmail.status='delivery_unknown') gmail_unknown,
      exists(select 1 from public.refund_gmail_messages gmail
        where gmail.refund_case_message_id=request.id
          and gmail.refund_case_id=c.id and gmail.direction='outbound'
          and gmail.status='failed' and gmail.provider_message_id is null
          and gmail.provider_message_header is null) gmail_known_failed,
      exists(select 1 from public.refund_wallet_correction_contexts correction
        where correction.refund_case_id=c.id
          and correction.correction_kind='purchase'
          and correction.status in ('pending','submitted')
          and correction.correction_message_id=request.id
          and coalesce(correction.correction_resulting_fact_version,
            correction.correction_fact_version,0)=c.deterministic_fact_version
      ) current_correction_request,
      exists(select 1 from public.refund_wallet_correction_contexts correction
        where correction.refund_case_id=c.id
          and correction.correction_kind='purchase'
          and correction.status in ('pending','submitted')
          and correction.correction_message_id is null
          and coalesce(correction.correction_resulting_fact_version,
            correction.correction_fact_version,0)=c.deterministic_fact_version
      ) current_unissued_correction
    from public.refund_cases c
    cross join lateral (select public.refund_customer_outreach_contract(c.id) truth) o
    left join public.refund_follow_up_cycles cycle
      on cycle.id=nullif(o.truth->>'cycleId','')::uuid
      and cycle.refund_case_id=c.id
    left join public.refund_case_messages request
      on request.id=nullif(o.truth->>'requestMessageId','')::uuid
      and request.refund_case_id=c.id
    where c.case_population='customer'
      and c.status in ('submitted','needs_review','correlated','card_refund_pending')
      and c.decision is null and c.refund_completed_at is null
      and (exists(select 1 from public.refund_follow_up_cycles current_cycle
          where current_cycle.refund_case_id=c.id
            and current_cycle.case_fact_version=c.deterministic_fact_version)
        or exists(select 1 from public.refund_wallet_correction_contexts current_correction
          where current_correction.refund_case_id=c.id
            and current_correction.correction_kind='purchase'
            and current_correction.status in ('pending','submitted')
            and coalesce(current_correction.correction_resulting_fact_version,
              current_correction.correction_fact_version,0)=c.deterministic_fact_version))
  ), current_work as (
    select *,coalesce(request_created_at,cycle_created_at) due_basis_at
    from eligible
    where truth->>'schemaVersion'='refund_customer_outreach_v1'
      and truth->>'payloadRedacted'='true'
      and ((truth->>'cycleId' is not null
          and case_fact_version=deterministic_fact_version)
        or (truth->>'cycleId' is null
          and (current_correction_request or current_unissued_correction)))
  ), classified as (
    select *,case
      when delivery_state in ('failed','bounced','complained')
        or manual_delivery_state='failed' or gmail_known_failed
        then 'definite_failure'
      when gmail_accepted or (delivery_transport='resend'
        and delivery_state='accepted' and provider_message_id is not null)
        then 'accepted_unconfirmed'
      when gmail_unknown or manual_delivery_state='delivery_unknown'
        or (delivery_transport='resend' and delivery_state='unknown')
        then 'unknown_effect'
      when truth->>'state'='delivery_failed' then 'definite_failure'
      when truth->>'state'='delivery_unknown' then 'unknown_effect'
      when truth->>'state' in ('preparing','queued','policy_suppressed')
        and (not coalesce(p_automation_enabled,false)
          or not coalesce(p_customer_contact_enabled,false))
        then 'policy_suppressed'
      when truth->>'state'='policy_suppressed' then 'policy_suppressed'
      when truth->>'state'='queued'
        and due_basis_at<coalesce(p_observed_at,statement_timestamp())-interval '60 minutes'
        then 'aging_queued'
      when truth->>'state'='preparing'
        and due_basis_at<coalesce(p_observed_at,statement_timestamp())-interval '60 minutes'
        then 'aging_preparing'
      else 'not_due_or_customer_wait'
    end obligation_state
    from current_work
  ), unresolved as (
    select * from classified where obligation_state in
      ('definite_failure','unknown_effect','policy_suppressed',
        'aging_queued','aging_preparing')
  )
  select jsonb_build_object(
    'status',case when count(*)>0 then 'action_needed' else 'healthy' end,
    'unresolvedCount',count(*),
    'definiteFailureCount',count(*) filter(where obligation_state='definite_failure'),
    'unknownEffectCount',count(*) filter(where obligation_state='unknown_effect'),
    'policySuppressedCount',count(*) filter(where obligation_state='policy_suppressed'),
    'agingQueuedCount',count(*) filter(where obligation_state='aging_queued'),
    'agingPreparingCount',count(*) filter(where obligation_state='aging_preparing'),
    'oldestAgeSeconds',max(extract(epoch from
      (coalesce(p_observed_at,statement_timestamp())-due_basis_at)))::bigint,
    'owner',case when count(*)=0 then null
      when count(*) filter(where obligation_state in
        ('definite_failure','unknown_effect','policy_suppressed'))>0
        then 'Refund Operations'
      else 'System' end,
    'nextStep',case when count(*)>0
      then 'Reconcile the current customer question and its exact delivery evidence.'
      else null end,
    'payloadRedacted',true)
  from unresolved;
$$;
revoke all on function public.service_get_refund_clarification_contact_obligation_health(boolean,boolean,timestamptz)
  from public,anon,authenticated;
grant execute on function public.service_get_refund_clarification_contact_obligation_health(boolean,boolean,timestamptz)
  to service_role;

alter function public.service_get_refund_workflow_health(
  boolean,boolean,boolean,boolean,boolean,text[],timestamptz)
  rename to service_get_refund_workflow_health_pre_clarification_20260925;
revoke all on function public.service_get_refund_workflow_health_pre_clarification_20260925(
  boolean,boolean,boolean,boolean,boolean,text[],timestamptz)
  from public,anon,authenticated,service_role;

create function public.service_get_refund_workflow_health(
  p_automation_enabled boolean,
  p_customer_contact_enabled boolean,
  p_manual_outbox_enabled boolean,
  p_manager_digest_enabled boolean,
  p_manager_ready_enabled boolean,
  p_mailbox_identities text[],
  p_observed_at timestamptz default statement_timestamp()
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare
  base jsonb;
  contact jsonb;
  contact_valid boolean:=false;
  blocked text[];
  delivery_status text;
  workflow_status text;
  overall_status text;
begin
  base:=public.service_get_refund_workflow_health_pre_clarification_20260925(
    p_automation_enabled,p_customer_contact_enabled,p_manual_outbox_enabled,
    p_manager_digest_enabled,p_manager_ready_enabled,p_mailbox_identities,
    p_observed_at);
  if to_regprocedure('public.service_get_refund_clarification_contact_obligation_health(boolean,boolean,timestamp with time zone)')
    is not null then
    execute 'select public.service_get_refund_clarification_contact_obligation_health($1,$2,$3)'
      into contact using p_automation_enabled,p_customer_contact_enabled,p_observed_at;
    if contact is not null and contact->>'payloadRedacted'='true'
      and contact->>'status' in ('healthy','action_needed')
      and coalesce(contact->>'unresolvedCount','') ~ '^[0-9]{1,12}$' then
      contact_valid:=case when contact->>'status'='healthy'
        then (contact->>'unresolvedCount')::bigint=0
        else (contact->>'unresolvedCount')::bigint>0 end;
    end if;
  end if;
  if not contact_valid then
    contact:=jsonb_build_object('status','instrumentation_unavailable',
      'reason','clarification_contact_projection_unavailable',
      'payloadRedacted',true);
  end if;
  select coalesce(array_agg(value order by ordinal),'{}'::text[]) into blocked
  from jsonb_array_elements_text(coalesce(base->'blockedReasons','[]'::jsonb))
    with ordinality as reasons(value,ordinal);
  delivery_status:=base->>'deliveryStatus';
  workflow_status:=base->>'workflowStatus';
  overall_status:=base->>'status';
  if contact->>'status'='action_needed' then
    if not 'customer_clarification_obligation'=any(blocked) then
      blocked:=array_append(blocked,'customer_clarification_obligation');
    end if;
    delivery_status:='degraded';
    workflow_status:='degraded';
    if overall_status not in ('failing','stale') then
      overall_status:='failing';
    end if;
  elsif not contact_valid then
    if delivery_status<>'degraded' then
      delivery_status:='instrumentation_unavailable';
    end if;
    if workflow_status<>'degraded' then
      workflow_status:='instrumentation_unavailable';
    end if;
    if overall_status='healthy' then overall_status:='waiting'; end if;
  end if;
  return base || jsonb_build_object(
    'status',overall_status,'workflowStatus',workflow_status,
    'deliveryStatus',delivery_status,'blockedReasons',to_jsonb(blocked),
    'customerClarificationDelivery',contact,'payloadRedacted',true);
end;
$$;
revoke all on function public.service_get_refund_workflow_health(
  boolean,boolean,boolean,boolean,boolean,text[],timestamptz)
  from public,anon,authenticated;
grant execute on function public.service_get_refund_workflow_health(
  boolean,boolean,boolean,boolean,boolean,text[],timestamptz)
  to service_role;
