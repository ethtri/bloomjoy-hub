-- Read-only, redacted evidence for one Manager decision. This migration never
-- records a decision, sends a message, starts payment, or completes a refund.
create function public.refund_rejection_wait_clock(
  p_question_delivered_at timestamptz,p_meaningful_input_at timestamptz,
  p_unreviewed_reply boolean,p_observed_at timestamptz
) returns jsonb language sql immutable set search_path='' as $$
  select case when p_question_delivered_at is null or p_observed_at is null
      or p_unreviewed_reply is distinct from false
      or p_question_delivered_at>p_observed_at
      or p_meaningful_input_at>p_observed_at then null
    else jsonb_build_object(
      'waitingSince',greatest(p_question_delivered_at,p_meaningful_input_at),
      'lastMeaningfulInputAt',p_meaningful_input_at,
      'eligibleAt',greatest(p_question_delivered_at,p_meaningful_input_at)+interval '30 days',
      'eligible',p_observed_at>=greatest(
        p_question_delivered_at,p_meaningful_input_at)+interval '30 days') end;
$$;
revoke all on function public.refund_rejection_wait_clock(
  timestamptz,timestamptz,boolean,timestamptz) from public,anon,authenticated;
grant execute on function public.refund_rejection_wait_clock(
  timestamptz,timestamptz,boolean,timestamptz) to service_role;

create function public.refund_decision_recommendation_for_case(
  p_case_id uuid,p_observed_at timestamptz default statement_timestamp()
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  c public.refund_cases%rowtype;
  preparation jsonb; purchase jsonb; result jsonb; outreach jsonb;
  card public.refund_nayax_lookup_candidates%rowtype;
  question public.refund_case_messages%rowtype;
  completed_lookup public.refund_case_events%rowtype;
  researched_at timestamptz; delivered_at timestamptz;
  meaningful_at timestamptz; has_unreviewed boolean:=false; wait_clock jsonb;
begin
  select * into c from public.refund_cases where id=p_case_id;
  if c.id is null or p_observed_at is null
    or c.case_population is distinct from 'customer'
    or c.decision is not null
    or c.status not in ('submitted','needs_review','correlated','waiting_on_customer')
    or c.refund_completed_at is not null or c.reporting_adjustment_id is not null
    or c.duplicate_of_refund_case_id is not null
    or public.refund_case_has_unresolved_reconciliation(c.id)
    or exists(select 1 from public.refund_case_nayax_refund_attempts a
      where a.refund_case_id=c.id)
    then return null; end if;

  preparation:=public.refund_manager_preparation_snapshot(
    c.id,c.official_action_version);
  if c.payment_method='card' and preparation is not null then
    -- Candidate count is not proof. One candidate must independently carry
    -- current, automatic, high-confidence, hard-safe evidence.
    select k.* into card from public.refund_nayax_lookup_candidates k
    where k.refund_case_id=c.id and k.lookup_generation=c.nayax_lookup_generation
      and k.expires_at>p_observed_at and k.actor_user_id is null
      and k.evidence_summary->>'is_recommended'='true'
      and k.evidence_summary->>'recommendation_state'='high_confidence'
      and k.evidence_summary->>'selection_allowed'='true'
      and k.evidence_summary->>'payment_status'='approved'
      and k.evidence_summary->>'provider_refund_state'='clear'
      and k.evidence_summary->>'duplicate_provider_record'='false'
      and k.evidence_summary->'hard_exclusions'='[]'::jsonb
      and ((preparation->>'evidenceBasis'='card_exact_selected'
          and k.provider_transaction_id=c.matched_nayax_transaction_id
          and c.nayax_recommendation_state='high_confidence')
        or (preparation->>'evidenceBasis'='card_reviewed_candidate_set'
          and preparation->'eligibleCandidateTokens' @> jsonb_build_array(k.token)
          and public.refund_reviewed_card_candidate_safe_v1(c.id,k.token)))
      and not exists(select 1 from public.refund_nayax_lookup_candidates other
        where other.refund_case_id=c.id
          and other.lookup_generation=c.nayax_lookup_generation
          and other.token<>k.token and other.expires_at>p_observed_at
          and other.actor_user_id is null
          and other.evidence_summary->>'is_recommended'='true'
          and other.evidence_summary->>'recommendation_state'='high_confidence'
          and other.evidence_summary->>'selection_allowed'='true'
          and other.evidence_summary->'hard_exclusions'='[]'::jsonb)
    order by k.created_at desc,k.token limit 1;
    if card.token is not null then
      purchase:=jsonb_build_object(
        'source','nayax','amountCents',card.amount_cents,
        'currencyCode',card.currency_code,
        'transactionAt',card.machine_authorization_time,
        -- This is a provider authorization timestamp, not separately proved
        -- purchase-time semantics.
        'timeMeaning','unknown','cardLast4',card.card_last4,
        'candidateToken',card.token);
    end if;
  elsif c.payment_method='cash'
    and preparation->>'evidenceBasis'='cash_sale_found' then
    select jsonb_build_object(
      'source','sunze','amountCents',candidate.amount_cents,
      'currencyCode','USD','transactionAt',candidate.payment_time,
      'timeMeaning','purchase') into purchase
    from public.refund_sunze_cash_correlation_attempts attempt
    join public.refund_sunze_cash_sale_links link
      on link.correlation_attempt_id=attempt.id and link.refund_case_id=c.id
      and link.released_at is null
      and link.case_fact_version=c.deterministic_fact_version
    join public.refund_sunze_cash_correlation_candidates candidate
      on candidate.attempt_id=attempt.id and candidate.sales_fact_id=link.sales_fact_id
    join public.machine_sales_facts sale
      on sale.id=candidate.sales_fact_id
      and sale.reporting_machine_id=c.reporting_machine_id
      and sale.source='sunze_browser' and sale.payment_method='cash'
      and lower(btrim(coalesce(sale.source_payment_status,'')))='payment success'
      and sale.payment_time=candidate.payment_time
      and sale.net_sales_cents=candidate.amount_cents
    join public.sales_import_runs import_run
      on import_run.id=sale.import_run_id and import_run.source='sunze_browser'
      and import_run.status='completed'
      and import_run.meta->>'payment_time_semantics_status'='validated'
      and import_run.meta->>'timestamp_proof_scope'='account'
    where attempt.id=(preparation->>'proofId')::uuid
      and attempt.policy_version='sunze_cash_correlation_v1'
      and attempt.case_fact_version=c.deterministic_fact_version
      and attempt.source_snapshot_key=public.refund_current_sunze_cash_source_key(
        c.reporting_machine_id,c.incident_at,p_observed_at)
      and attempt.match_state='sale_found' and attempt.candidate_count=1
      and attempt.invalidated_at is null and not candidate.selection_conflict
      and candidate.evidence_codes @> array[
        'machine_exact','cash_payment','payment_success','validated_coverage']
      and c.cash_match_state='sale_found'
      and c.cash_match_evaluated_fact_version=c.deterministic_fact_version
      and c.matched_sales_fact_id=link.sales_fact_id;
  end if;

  result:=jsonb_build_object(
    'schemaVersion','refund_decision_recommendation_v1',
    'officialActionVersion',c.official_action_version,
    'deterministicFactVersion',c.deterministic_fact_version,
    'decisionReady',false,'waitingSince',null,
    'lastMeaningfulInputAt',null,'eligibleAt',null,'payloadRedacted',true);
  if purchase is not null then
    return result||jsonb_build_object(
      'kind','refund','reasonCode','clear_purchase_match',
      'summary','A matching purchase was found. We recommend refunding this purchase.',
      'purchase',purchase);
  end if;

  -- Reject only after completed current read-only research. Provider failure,
  -- stale source coverage, or a candidate count alone never starts this path.
  if c.payment_method='card'
    and c.nayax_lookup_status in ('no_match','multiple_matches','manual_exception') then
    select e.* into completed_lookup from public.refund_case_events e
    where e.refund_case_id=c.id and e.event_type='nayax_lookup_completed'
      and e.actor_user_id is null
      and e.metadata->>'lookup_generation'=c.nayax_lookup_generation::text
      and e.metadata->>'deterministic_fact_version'=c.deterministic_fact_version::text
      and e.metadata->>'lookup_status'=c.nayax_lookup_status
      and e.metadata->>'recommendation_state'=c.nayax_recommendation_state
      and e.metadata->>'policy_version'=c.nayax_recommendation_policy_version
      and e.metadata->>'correlation_digest'=c.nayax_lookup_correlation_digest
      and e.metadata->>'trigger_source' in ('automatic','scheduled','wallet_correction')
      and e.metadata->>'payload_redacted'='true'
      and exists(select 1 from public.refund_case_events started
        where started.refund_case_id=c.id
          and started.event_type='nayax_lookup_started'
          and started.actor_user_id is null and started.created_at<=e.created_at
          and started.metadata->>'lookup_generation'=c.nayax_lookup_generation::text
          and started.metadata->>'deterministic_fact_version'=c.deterministic_fact_version::text
          and started.metadata->>'trigger_source'=e.metadata->>'trigger_source'
          and started.metadata->>'provider_call_kind'='read_only'
          and started.metadata->>'payload_redacted'='true')
    order by e.created_at desc,e.id desc limit 1;
    researched_at:=completed_lookup.created_at;
  elsif c.payment_method='cash' then
    select a.evaluated_at into researched_at
    from public.refund_sunze_cash_correlation_attempts a
    where a.refund_case_id=c.id
      and a.case_fact_version=c.deterministic_fact_version
      and a.policy_version='sunze_cash_correlation_v1'
      and a.invalidated_at is null
      and a.match_state in (
        'no_sale_found_with_complete_coverage','multiple_possible_sales')
      and a.source_snapshot_key=public.refund_current_sunze_cash_source_key(
        c.reporting_machine_id,c.incident_at,p_observed_at)
      and c.cash_match_state=a.match_state
      and c.cash_match_evaluated_fact_version=c.deterministic_fact_version
    order by a.evaluated_at desc,a.id desc limit 1;
  end if;
  if researched_at is null or researched_at>p_observed_at then return null; end if;

  -- Reuse the canonical causal outreach projection. Old messages, reminders,
  -- failed sends, unknown delivery, and unissued corrections cannot start time.
  outreach:=public.refund_customer_outreach_contract(c.id);
  if outreach->>'schemaVersion' is distinct from 'refund_customer_outreach_v1'
    or outreach->>'payloadRedacted' is distinct from 'true'
    or outreach->>'caseFactVersion' is distinct from c.deterministic_fact_version::text
    or outreach->>'requestMessageId' is null
    or jsonb_typeof(outreach->'requestedFields') is distinct from 'array'
    or jsonb_array_length(outreach->'requestedFields')<1
    or outreach->>'deliveryState' is distinct from 'delivered'
    or outreach->>'requestSentAt' is null then return null; end if;
  select * into question from public.refund_case_messages m
  where m.id=(outreach->>'requestMessageId')::uuid and m.refund_case_id=c.id
    and m.message_type in ('more_info','no_safe_match')
    and cardinality(m.requested_fields)>0
    and lower(btrim(m.recipient_email))=lower(btrim(c.customer_email));
  if question.id is null
    or public.is_refund_message_recorded_delivery_failure(to_jsonb(question))
    or question.status in ('failed','skipped','pending') then return null; end if;
  delivered_at:=case when question.delivery_state='delivered'
      and question.provider_message_id is not null
    then coalesce(question.delivery_state_updated_at,question.sent_at)
    else nullif(outreach->>'requestSentAt','')::timestamptz end;
  if delivered_at is null then return null; end if;

  select max(input_at) into meaningful_at from (
    select g.received_at input_at from public.refund_customer_fact_applications a
    join public.refund_gmail_messages g
      on g.id=a.gmail_message_id and g.refund_case_id=c.id
    where a.refund_case_id=c.id
      and a.resulting_fact_version>a.expected_fact_version
      and cardinality(a.applied_fields)>0 and g.direction='inbound'
      and g.status='received' and g.participant_role='customer'
      and g.participant_trust='verified'
    union all
    select r.reply_received_at from public.refund_wallet_correction_contexts r
    join public.refund_gmail_messages g
      on g.id=r.reply_message_id and g.refund_case_id=c.id
    where r.refund_case_id=c.id and r.reply_review_state='resolved'
      and r.reply_review_result_code in (
        'facts_applied','inexact_purchase_time_requires_research',
        'wallet_token_requires_research','conflicting_reply_evidence')
      and g.direction='inbound' and g.status='received'
      and g.participant_role='customer' and g.participant_trust='verified'
    union all
    select r.consumed_at from public.refund_wallet_correction_contexts r
    where r.refund_case_id=c.id and r.status='submitted'
      and r.correction_kind='purchase' and r.reply_message_id is null
      and r.correction_resulting_fact_version>r.correction_fact_version
  ) meaningful;
  select exists(select 1 from public.refund_gmail_messages g
    where g.refund_case_id=c.id and g.direction='inbound' and g.status='received'
      and g.participant_role='customer' and g.participant_trust='verified'
      and g.received_at>delivered_at
      and not exists(select 1 from public.refund_customer_fact_applications a
        where a.gmail_message_id=g.id and a.refund_case_id=c.id)
      and not exists(select 1 from public.refund_wallet_correction_contexts r
        where r.refund_case_id=c.id and r.reply_message_id=g.id
          and r.reply_review_state='resolved')) into has_unreviewed;
  wait_clock:=public.refund_rejection_wait_clock(
    delivered_at,meaningful_at,has_unreviewed,p_observed_at);
  if wait_clock->>'eligible' is distinct from 'true'
    or meaningful_at>researched_at then return null; end if;
  return result||jsonb_build_object(
    'kind','reject','reasonCode','no_match_after_30_days',
    'summary','No clear purchase match was found, and 30 days have passed without new purchase details. We recommend declining this request.',
    'purchase',null,'waitingSince',wait_clock->'waitingSince',
    'lastMeaningfulInputAt',wait_clock->'lastMeaningfulInputAt',
    'eligibleAt',wait_clock->'eligibleAt');
end;
$$;
revoke all on function public.refund_decision_recommendation_for_case(
  uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.refund_decision_recommendation_for_case(
  uuid,timestamptz) to service_role;

alter function public.refund_next_work_for_case(uuid,jsonb)
  rename to refund_next_work_for_case_pre_decision_recommendation;
revoke all on function public.refund_next_work_for_case_pre_decision_recommendation(
  uuid,jsonb) from public,anon,authenticated,service_role;
create function public.refund_next_work_for_case(
  p_refund_case_id uuid,p_lifecycle jsonb
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb; recommendation jsonb; work jsonb;
  c public.refund_cases%rowtype; manager_available boolean:=false;
begin
  result:=public.refund_next_work_for_case_pre_decision_recommendation(
    p_refund_case_id,p_lifecycle);
  if result is null then return null; end if;
  select * into c from public.refund_cases where id=p_refund_case_id;
  -- Preserve prior decisions, cash execution, payment and delivery recovery.
  if c.id is null or c.decision is not null
    or result#>>'{nextWork,isOpen}' is distinct from 'true' then
    return result||jsonb_build_object('decisionRecommendation',null);
  end if;
  recommendation:=public.refund_decision_recommendation_for_case(c.id);
  work:=result->'nextWork';
  manager_available:=case when auth.uid() is not null
    then public.can_perform_refund_official_action(auth.uid(),c.id)
    else exists(select 1 from public.reporting_machine_refund_managers m
      where m.reporting_machine_id=c.reporting_machine_id and m.status='active'
        and m.revoked_at is null
        and public.can_perform_refund_official_action(m.manager_user_id,c.id)) end;
  if recommendation is not null and manager_available then
    work:=work||jsonb_build_object(
      'actor','manager',
      'actionCode',case when recommendation->>'kind'='reject'
        then 'reject_request' else 'approve_or_deny_request' end,
      'actionLabel',case when recommendation->>'kind'='reject'
        then 'Review the recommendation to decline this request.'
        else 'Approve or deny the recommended refund.' end,'blocker',null);
    -- New recommendation is the only decision prompt. During rollout an older
    -- action must not expose direct cash payment or candidate selection.
    result:=jsonb_set(result,'{managerAction,action}','"none"'::jsonb,true);
  elsif recommendation is not null then
    work:=(work-'preparationProofId'-'eligibleCandidateTokens')
      ||jsonb_build_object(
        'actor','agent','actionCode','resolve_manager_assignment',
        'actionLabel','Restore an authorized Manager for the final decision.',
        'blocker',jsonb_build_object(
          'code','manager_assignment_unavailable','owner','Agent',
          'nextStep','Verify the machine assignment and restore the existing decision path.'));
    result:=jsonb_set(result,'{managerAction,action}','"none"'::jsonb,true);
  elsif work->>'actor'='manager' and (
    (c.payment_method='card'
      and c.nayax_lookup_status in ('multiple_matches','manual_exception')
      and c.nayax_recommendation_state in ('ambiguous','manual_exception'))
    or c.payment_method='cash'
  ) then
    -- Underlying projection fix: ambiguous provider candidates and every
    -- undecided cash case without a current clear Sunze recommendation remain
    -- Agent research instead of becoming Manager decisions or payout work.
    work:=(work-'preparationProofId'-'eligibleCandidateTokens')
      ||jsonb_build_object(
        'actor','agent','actionCode','research_purchase',
        'actionLabel','Find a clear purchase match before requesting a decision.',
        'blocker',jsonb_build_object(
          'code','clear_recommendation_pending','owner','Agent',
          'nextStep','Continue purchase research or review the existing customer conversation.'));
    result:=jsonb_set(result,'{managerAction,action}','"none"'::jsonb,true);
  end if;
  if recommendation is not null then
    recommendation:=recommendation||jsonb_build_object(
      'decisionReady',work->>'actor'='manager');
  end if;
  return result||jsonb_build_object(
    'nextWork',work,'decisionRecommendation',recommendation);
end;
$$;
revoke all on function public.refund_next_work_for_case(uuid,jsonb)
  from public,anon,authenticated;
grant execute on function public.refund_next_work_for_case(uuid,jsonb)
  to service_role;
comment on function public.refund_decision_recommendation_for_case(uuid,timestamptz)
  is 'Service-only redacted current-evidence recommendation. It grants no decision, payment, or messaging authority.';
comment on function public.refund_rejection_wait_clock(
  timestamptz,timestamptz,boolean,timestamptz)
  is 'Pure conservative 30-day clock from confirmed question delivery and later meaningful customer input.';
select pg_notify('pgrst','reload schema');
