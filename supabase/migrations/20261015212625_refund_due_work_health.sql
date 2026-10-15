-- #1430: a heartbeat is not evidence that current work received an opportunity.
-- Keep observations on the existing run, and keep health reads side-effect free.
alter table public.refund_automation_runs add column work_observation jsonb
 check(work_observation is null or (jsonb_typeof(work_observation)='object'
  and work_observation->>'schemaVersion'='refund_work_observation_v1'
  and work_observation->>'payloadRedacted'='true'));

create function private.refund_work_item(
 p_identity text,p_lane text,p_action text,p_due_at timestamptz,
 p_progress_at timestamptz,p_state text default 'due',p_reason text default null
) returns jsonb language sql immutable set search_path='' as $$
 select jsonb_build_object('key',encode(extensions.digest(convert_to(p_identity,'UTF8'),'sha256'),'hex'),
  'lane',p_lane,'action',p_action,'dueAt',p_due_at,'lastProgressAt',p_progress_at,
  'state',p_state,'reason',p_reason,'owner','Agent','payloadRedacted',true);
$$;
revoke all on function private.refund_work_item(text,text,text,timestamptz,timestamptz,text,text)
 from public,anon,authenticated,service_role;

-- This is an observation, never an authorization to claim, contact or pay.
create function private.refund_current_work(p_observed_at timestamptz)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare c public.refund_cases; lifecycle jsonb; work jsonb; item record;
 items jsonb:='[]'; decisions integer:=0; customer_waits integer:=0;
 agent_work integer:=0; unsupported integer:=0; closed_count integer:=0; evidence_dependencies integer:=0;
 oldest_decision timestamptz; decision_since timestamptz; result_state text; decision_clock_unavailable integer:=0;
 scope_count integer:=0; technical jsonb:='[]';
 projected_work jsonb:='[]'; recognized_work jsonb:='{}'; source_lane text; work_key text;
 manual_recovery_count integer:=0;
begin
 if p_observed_at is null then raise exception 'Observation time required' using errcode='22023'; end if;
 if auth.uid() is not null then
  return jsonb_build_object('status','instrumentation_unavailable','reason','server_observation_context_required','payloadRedacted',true);
 end if;
 -- Filter historical/internal/duplicate cases before invoking the canonical
 -- projection. Bound the observation explicitly; truncation is unavailable.
 for c in select candidate.* from public.refund_cases candidate
  where candidate.case_population='customer' and candidate.duplicate_of_refund_case_id is null
   and (candidate.status not in ('completed','denied','closed')
    or exists(select 1 from public.refund_case_messages m where m.refund_case_id=candidate.id
      and m.manual_delivery_state in ('queued','claimed','delivery_unknown'))
    or (candidate.resolution_method='gift_card' and candidate.gift_card_state='denied'
      and private.refund_denial_owner_recovery_root(candidate.id) is not null))
  order by candidate.created_at,candidate.id limit 501
 loop
  scope_count:=scope_count+1;
  if scope_count>500 then
   return jsonb_build_object('status','instrumentation_unavailable','reason','current_work_scope_limit',
    'payloadRedacted',true);
  end if;
  lifecycle:=public.refund_lifecycle_contract(c.id); work:=lifecycle->'nextWork';
  if lifecycle is null or lifecycle->>'payloadRedacted' is distinct from 'true'
   or work->>'payloadRedacted' is distinct from 'true' then
   raise exception 'Current lifecycle observation unavailable' using errcode='P4652';
  end if;
  if c.resolution_method='gift_card' and c.gift_card_state='denied'
   and private.refund_denial_owner_recovery_root(c.id) is not null then
   manual_recovery_count:=manual_recovery_count+1;
   recognized_work:=recognized_work||jsonb_build_object(c.id::text||'|recover_customer_delivery',true);
  end if;
  if work->>'isOpen'='false' then closed_count:=closed_count+1;
  elsif work->>'actor'='manager' then
   decisions:=decisions+1;
   -- Prefer the semantic decision's current attention clock, not age of intake.
   select a.attention_started_at into decision_since from public.refund_manager_attention_states a
    where a.refund_case_id=c.id and a.deterministic_fact_version=c.deterministic_fact_version
     and a.case_status=c.status and a.correlation_status=c.correlation_status
     and a.decision is not distinct from c.decision;
   if decision_since is null then decision_clock_unavailable:=decision_clock_unavailable+1; end if;
   oldest_decision:=least(oldest_decision,decision_since);
  elsif work->>'actor'='customer' then customer_waits:=customer_waits+1;
  elsif work->>'actor'='agent' then
   agent_work:=agent_work+1;
   if work#>>'{blocker,code}'='stable_evidence_dependency' then evidence_dependencies:=evidence_dependencies+1; end if;
  end if;
  if work#>>'{blocker,code}' in ('provider_mapping_required','manager_assignment_unavailable',
    'payment_record_mismatch','lookup_failed','lookup_timed_out','lookup_response_limited')
   and not (work#>>'{blocker,code}' in ('lookup_failed','lookup_timed_out','lookup_response_limited')
    and c.nayax_lookup_safe_retry_eligible) then
   technical:=technical||jsonb_build_array(private.refund_work_item(
    c.id::text||':'||c.deterministic_fact_version::text||':'||coalesce(work#>>'{blocker,code}',''),
    'technical_recovery',coalesce(work->>'actionCode','inspect_current_work'),
    coalesce(nullif(work->>'lastProgressAt','')::timestamptz,c.created_at),
    nullif(work->>'lastProgressAt','')::timestamptz,'blocked',work#>>'{blocker,code}'));
  end if;
  -- An unrecognized System action remains unavailable rather than healthy zero.
  if work->>'isOpen'='true' and (work->>'actor'='system'
   or (work->>'actor'='agent' and work->>'actionCode' in ('review_customer_reply','prepare_manager_decision'))) then
   projected_work:=projected_work||jsonb_build_array(c.id::text||'|'||coalesce(work->>'actionCode',''));
  end if;
 end loop;

 -- Reuse this lane's existing pure selector; never invoke its claimant.
 for item in select due.*,c.deterministic_fact_version,c.nayax_lookup_generation,
   public.refund_approved_card_research_scope_digest(c.id) scope_digest
  from public.refund_due_approved_card_nayax_research() due
  join public.refund_cases c on c.id=due.refund_case_id
  where c.case_population='customer' and c.resolution_method='original_payment'
   and c.duplicate_of_refund_case_id is null
 loop
  items:=items||jsonb_build_array(private.refund_work_item(
   item.refund_case_id::text||':approved-research:'||item.deterministic_fact_version::text||':'
    ||item.nayax_lookup_generation::text||':'||coalesce(item.scope_digest,''),
   'purchase_lookup','research_existing_approval',item.due_at,null,
   case when item.due_at>p_observed_at then 'future_retry' else 'due' end));
 end loop;

 for item in select a.* from public.refund_case_nayax_refund_attempts a
  join public.refund_cases c on c.id=a.refund_case_id
  where c.case_population='customer' and c.duplicate_of_refund_case_id is null
   and a.reconciliation_required and a.status not in ('created','in_progress')
   and not exists(select 1 from public.refund_case_nayax_refund_attempts later
    where later.refund_case_id=a.refund_case_id and (later.created_at,later.id)>(a.created_at,a.id))
   and not exists(select 1 from public.refund_authoritative_receipts receipt where receipt.refund_case_id=c.id)
 loop
  recognized_work:=recognized_work||jsonb_build_object(item.refund_case_id::text||'|continue_refund',true);
  items:=items||jsonb_build_array(private.refund_work_item(item.id::text||':reconciliation',
   'approved_refund','reconcile_existing_provider_attempt',item.refund_operations_due_at,
   item.provider_outcome_recorded_at,'unknown_hold'));
 end loop;

 -- Durable exact message intents, including interrupted claims. Unknown sends
 -- remain a distinct hold; they are never eligible send/retry opportunities.
 for item in select m.*,c.official_action_version,c.deterministic_fact_version
  from public.refund_case_messages m join public.refund_cases c on c.id=m.refund_case_id
  where c.case_population='customer' and c.duplicate_of_refund_case_id is null
   and m.manual_delivery_state in ('queued','claimed','delivery_unknown')
 loop
  recognized_work:=recognized_work||jsonb_build_object(item.refund_case_id::text||'|deliver_customer_question',true,
   item.refund_case_id::text||'|recover_customer_delivery',true);
  source_lane:=case when item.delivery_kind='automatic' and item.template_version is distinct from 'refund_gift_card_v1'
   then 'automatic_customer_outbox' else 'customer_outbox' end;
  result_state:=case
   when item.manual_delivery_state='delivery_unknown' or
    (item.manual_delivery_state='claimed' and item.manual_delivery_provider_attempted_at is not null)
     then 'unknown_hold'
   when item.manual_delivery_expected_case_version is distinct from item.official_action_version then 'blocked'
   when item.manual_delivery_state='claimed'
    and item.manual_delivery_claimed_at+interval '10 minutes'>p_observed_at then 'active_claim'
   else 'due' end;
  items:=items||jsonb_build_array(private.refund_work_item(
   item.id::text||':'||item.manual_delivery_expected_case_version::text,
   source_lane,'deliver_customer_notice',
   case when item.manual_delivery_state='claimed' then item.manual_delivery_claimed_at+interval '10 minutes'
    else item.created_at end,item.manual_delivery_claimed_at,result_state,
   case when result_state='blocked' then 'outbox_current_version_mismatch' else null end));
 end loop;

 -- One prepared payment attempt already owns its approval. No provider access
 -- occurs here; uncertain outcomes stay with the existing reconciliation lane.
 for item in select a.*,c.official_action_version,c.deterministic_fact_version,
   machine.status machine_status,machine.nayax_refunds_enabled,machine.nayax_account_key,
   machine.nayax_machine_id,saved.context,authz.status authorization_status,
   authz.authorization_method
  from public.refund_case_nayax_refund_attempts a
  join public.refund_cases c on c.id=a.refund_case_id
  left join public.reporting_machines machine on machine.id=c.reporting_machine_id
  left join public.refund_nayax_execution_contexts saved on saved.attempt_id=a.id
  left join public.refund_case_official_action_authorizations authz on authz.id=a.official_action_authorization_id
  where c.case_population='customer' and c.duplicate_of_refund_case_id is null
   and c.status='card_refund_pending' and c.decision='approved'
   and c.reporting_adjustment_id is null and a.actor_user_id is null
   and a.status in ('created','in_progress')
 loop
  recognized_work:=recognized_work||jsonb_build_object(item.refund_case_id::text||'|continue_refund',true);
  result_state:=case
   when item.reconciliation_required then 'unknown_hold'
   when item.status='in_progress' and item.provider_claim_expires_at>p_observed_at then 'active_claim'
   when item.status='in_progress' then 'unknown_hold'
   when item.authorization_status is distinct from 'consumed'
    or item.authorization_method is distinct from 'manager_session'
    or item.machine_status is distinct from 'active' or item.nayax_refunds_enabled is not true
    or item.context->>'accountScope' is distinct from item.nayax_account_key
    or item.context->>'providerMachineId' is distinct from item.nayax_machine_id then 'blocked'
   else 'due' end;
  items:=items||jsonb_build_array(private.refund_work_item(
   item.id::text||':'||item.provider_execution_generation::text||':'||item.official_action_version::text,
   'approved_refund','continue_refund',item.created_at,item.provider_claim_consumed_at,result_state,
   case when result_state='blocked' then 'approved_executor_context_unavailable' else null end));
 end loop;

 -- The normal read-only lookup claimant's complete eligibility predicate.
 -- Keep its original due anchor; touching updated_at is not progress.
 for item in select candidate.* from public.refund_cases candidate
  where candidate.case_population='customer' and candidate.resolution_method='original_payment'
   and candidate.payment_method='card' and candidate.status in ('submitted','needs_review','correlated')
   and candidate.decision is null and candidate.duplicate_of_refund_case_id is null
   and (candidate.nayax_lookup_status='not_started'
    or (candidate.nayax_lookup_status in ('lookup_failed','lookup_timed_out')
     and candidate.nayax_lookup_safe_retry_eligible and candidate.nayax_lookup_retry_count<1)
    or (candidate.nayax_lookup_status in ('match_found','multiple_matches','manual_exception')
     and candidate.nayax_lookup_finished_at is not null
     and exists(select 1 from public.reporting_machines m where m.id=candidate.reporting_machine_id
      and m.nayax_manual_portal_enabled is not true)
     and not exists(select 1 from public.refund_nayax_lookup_candidates k
      where k.refund_case_id=candidate.id and k.lookup_generation=candidate.nayax_lookup_generation
       and k.expires_at>p_observed_at)
     and (public.refund_lifecycle_contract(candidate.id)->'lookup')
      @> '{"status":"results_expired","safeRetryEligible":true}'::jsonb
     and (candidate.nayax_lookup_status<>'manual_exception'
      or (candidate.nayax_lookup_started_at is not null
       and candidate.nayax_lookup_correlation_digest ~ '^[a-f0-9]{64}$'
       and nullif(candidate.nayax_recommendation_policy_version,'') is not null
       and candidate.nayax_recommendation_policy_version<>'manual-nayax-portal-v1'
       and not exists(select 1 from public.refund_case_events e where e.refund_case_id=candidate.id
        and e.event_type in ('manual_nayax_evidence_entered','nayax_match_preselection_disputed')
        and e.created_at>=candidate.nayax_lookup_finished_at)))))
   and candidate.reporting_location_id is not null
   and (candidate.reporting_machine_id is null or exists(select 1 from public.reporting_machines m
    where m.id=candidate.reporting_machine_id and m.location_id=candidate.reporting_location_id))
   and (candidate.reporting_machine_id is not null or (candidate.intake_selection_kind='livermore_pair'
    and candidate.intake_selection_key is not null and cardinality(candidate.intake_selection_machine_ids)=2))
   and candidate.incident_at is not null and candidate.incident_time_resolution is not null
   and candidate.payment_amount_cents>0 and (candidate.card_wallet_used or candidate.card_last4 ~ '^[0-9]{4}$')
   and candidate.matched_nayax_transaction_id is null and candidate.nayax_refund_execution_status='not_requested'
   and candidate.refund_completed_at is null and candidate.reporting_adjustment_id is null
   and candidate.manual_refund_reference is null and not public.refund_case_has_unresolved_reconciliation(candidate.id)
   and not exists(select 1 from public.refund_authoritative_receipts r where r.refund_case_id=candidate.id)
   and not exists(select 1 from public.refund_case_nayax_refund_attempts a where a.refund_case_id=candidate.id)
 loop
  recognized_work:=recognized_work||jsonb_build_object(item.id::text||'|run_lookup',true,
   item.id::text||'|prepare_manager_decision',true);
  decision_since:=case when item.nayax_lookup_status='not_started'
   then coalesce(item.deterministic_facts_updated_at,item.created_at)
   else item.nayax_lookup_finished_at+interval '2 minutes' end;
  items:=items||jsonb_build_array(private.refund_work_item(
   item.id::text||':'||item.deterministic_fact_version::text||':'||item.nayax_lookup_generation::text
    ||':'||coalesce(item.refund_business_fingerprint,'')||':'||coalesce(item.reporting_machine_id::text,''),
   'purchase_lookup','run_lookup',decision_since,item.nayax_lookup_finished_at,
   case when decision_since>p_observed_at then 'future_retry' else 'due' end));
 end loop;

 for item in select c.* from public.refund_cases c where c.case_population='customer'
  and c.resolution_method='original_payment' and c.duplicate_of_refund_case_id is null
  and c.decision is null and c.nayax_lookup_status='checking'
 loop
  recognized_work:=recognized_work||jsonb_build_object(item.id::text||'|run_lookup',true,
   item.id::text||'|prepare_manager_decision',true);
  items:=items||jsonb_build_array(private.refund_work_item(
   item.id::text||':'||item.deterministic_fact_version::text||':'||item.nayax_lookup_generation::text||':claim',
   'purchase_lookup','recover_interrupted_lookup',item.nayax_lookup_started_at+interval '90 seconds',
   item.nayax_lookup_started_at,
   case when item.nayax_lookup_started_at is null then 'blocked'
    when item.nayax_lookup_started_at+interval '90 seconds'<=p_observed_at then 'due' else 'active_claim' end,
   case when item.nayax_lookup_started_at is null then 'lookup_claim_clock_unavailable' else null end));
 end loop;

 -- Due reminders retain their one existing cycle. A delivered question is a
 -- legitimate wait until this exact reminder becomes eligible.
 for item in select cycle.*,c.deterministic_fact_version,c.official_action_version
  from public.refund_follow_up_cycles cycle join public.refund_cases c on c.id=cycle.refund_case_id
  join public.refund_case_messages request on request.id=cycle.request_message_id
   and request.refund_case_id=c.id and request.follow_up_cycle_id=cycle.id
   and request.status='sent' and request.sent_at=cycle.request_sent_at
   and request.delivery_state not in ('failed','bounced','complained')
  where c.case_population='customer' and c.duplicate_of_refund_case_id is null
   and c.resolution_method='original_payment' and c.decision is null
   and c.status in ('submitted','needs_review','waiting_on_customer','correlated')
   and cycle.status='waiting' and cycle.request_sent_at is not null
   and cycle.case_fact_version=c.deterministic_fact_version
   and cycle.reminder_due_at is not null and cycle.reminder_message_id is null
   and cycle.reply_customer_message_id is null
   and not exists(select 1 from public.refund_gmail_threads t where t.refund_case_id=c.id
    and t.automatic_customer_contact_paused_at is not null)
   and not exists(select 1 from public.refund_authoritative_receipts r where r.refund_case_id=c.id)
 loop
  result_state:=case when item.reminder_claimed_at+interval '10 minutes'<=p_observed_at then 'blocked'
   when item.reminder_claimed_at is not null then 'active_claim'
   when item.reminder_due_at>p_observed_at then 'future_retry' else 'due' end;
  items:=items||jsonb_build_array(private.refund_work_item(
   item.id::text||':'||item.case_fact_version::text,'customer_follow_up','send_existing_reminder',
   item.reminder_due_at,item.request_sent_at,result_state,
   case when result_state='blocked' then 'expired_reminder_claim_without_message' else null end));
 end loop;

 for item in select c.*,public.refund_current_sunze_cash_source_key(
   c.reporting_machine_id,c.incident_at,p_observed_at) source_key
  from public.refund_cases c
  where c.case_population='customer' and c.resolution_method='original_payment'
   and c.payment_method='cash' and c.status in ('submitted','needs_review','waiting_on_customer','correlated')
   and c.decision is null and c.reporting_machine_id is not null and c.incident_at is not null
   and c.refund_completed_at is null and c.reporting_adjustment_id is null
   and c.duplicate_of_refund_case_id is null
   and not exists(select 1 from public.refund_sunze_cash_correlation_attempts a
    where a.refund_case_id=c.id and a.case_fact_version=c.deterministic_fact_version
     and a.policy_version='sunze_cash_correlation_v1'
     and a.source_snapshot_key=public.refund_current_sunze_cash_source_key(
      c.reporting_machine_id,c.incident_at,p_observed_at))
 loop
  recognized_work:=recognized_work||jsonb_build_object(item.id::text||'|prepare_manager_decision',true);
  items:=items||jsonb_build_array(private.refund_work_item(
   item.id::text||':'||item.deterministic_fact_version::text||':'||coalesce(item.source_key,''),
   'cash_preparation','prepare_purchase_evidence',coalesce(item.deterministic_facts_updated_at,item.created_at),null));
 end loop;

 for item in select f.*,c.deterministic_fact_version,
   public.refund_payout_destination_case_current(c) current_case
  from public.refund_payout_destination_follow_ups f
  join public.refund_cases c on c.id=f.refund_case_id
  join public.refund_case_messages request on request.id=f.request_message_id
   and request.refund_case_id=c.id and request.requested_fields_satisfied_by_gmail_message_id is null
  where c.case_population='customer' and c.duplicate_of_refund_case_id is null
   and c.resolution_method='original_payment' and c.payment_method='cash'
   and c.status not in ('completed','denied','closed') and c.refund_completed_at is null
   and c.reporting_adjustment_id is null
   and nullif(btrim(c.zelle_payment_contact),'') is null
   and f.status in ('waiting','reminder_claimed','reminder_sent')
   and not exists(select 1 from public.refund_gmail_threads t where t.refund_case_id=c.id
    and t.automatic_customer_contact_paused_at is not null)
 loop
  decision_since:=case when item.status='reminder_sent' then item.escalation_due_at else item.reminder_due_at end;
  if decision_since is null then continue; end if;
  result_state:=case when decision_since>p_observed_at then 'future_retry'
   when item.current_case is not true then 'blocked'
   when item.status='reminder_claimed' and item.reminder_claimed_at+interval '10 minutes'>p_observed_at then 'active_claim'
   else 'due' end;
  items:=items||jsonb_build_array(private.refund_work_item(
   item.id::text||':'||item.deterministic_fact_version::text||':'||item.status,
   'payout_follow_up','continue_existing_contact',decision_since,item.created_at,result_state,
   case when result_state='blocked' then 'existing_contact_currentness_unavailable' else null end));
 end loop;

 -- Stock absence is a legitimate wait. Available compatible stock makes the
 -- existing resume lane due; this query never allocates or exposes a code.
 for item in select c.*,p.enabled pool_enabled,p.expires_at pool_expires_at,
   exists(select 1 from public.refund_gift_card_codes code where code.pool_id=p.id
    and code.status='available' and code.issued_case_id is null
    and code.valid_from<=p_observed_at and code.expires_at>=c.gift_card_expires_at
    and code.expires_at>p_observed_at) stock_available
  from public.refund_cases c left join public.refund_gift_card_pools p on p.id=c.gift_card_pool_id
  where c.case_population='customer' and c.duplicate_of_refund_case_id is null
   and c.resolution_method='gift_card' and c.gift_card_state='pending_inventory'
 loop
  recognized_work:=recognized_work||jsonb_build_object(item.id::text||'|none',true);
  items:=items||jsonb_build_array(private.refund_work_item(
   item.id::text||':'||item.official_action_version::text||':'||coalesce(item.gift_card_pool_id::text,''),
   'gift_inventory','resume_existing_gift_request',item.created_at,null,
   case when item.pool_enabled and item.pool_expires_at>p_observed_at and item.stock_available then 'due'
    else 'external_wait' end));
 end loop;

 for work_key in select value from jsonb_array_elements_text(projected_work) loop
  if not recognized_work ? work_key then unsupported:=unsupported+1; end if;
 end loop;
 return jsonb_build_object('schemaVersion','refund_current_work_v1','status','available',
  'items',items||technical,'sourceCoverage',jsonb_build_array('customer_outbox','approved_refund',
   'automatic_customer_outbox','purchase_lookup','cash_preparation','customer_follow_up','payout_follow_up','gift_inventory',
   'supported_denial_contact_recovery'),
  'unsupportedActionCount',unsupported,'decisionCount',decisions,'oldestDecisionAt',oldest_decision,
  'decisionClockBasis','recorded_attention_clock','decisionClockUnavailableCount',decision_clock_unavailable,
  'customerWaitCount',customer_waits,'agentWorkCount',agent_work,
  'evidenceDependencyCount',evidence_dependencies,'manualContactRecoveryCount',manual_recovery_count,'payloadRedacted',true);
end;
$$;
revoke all on function private.refund_current_work(timestamptz) from public,anon,authenticated,service_role;

create function public.service_record_refund_work_observation(
 p_run_id uuid,p_phase text,p_runtime jsonb
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare r public.refund_automation_runs; snapshot jsonb; runtime jsonb; observed timestamptz:=statement_timestamp();
begin
 if p_phase is null or p_phase not in ('before','after') or jsonb_typeof(p_runtime) is distinct from 'object' then
  raise exception 'Exact observation phase and runtime required' using errcode='22023';
 end if;
 select * into r from public.refund_automation_runs where id=p_run_id for update;
 if r.id is null or r.trigger_source<>'scheduled' or r.status<>'running'
  or not exists(select 1 from public.refund_automation_scheduler_dispatches d
   where d.run_key=r.run_key and d.mode='run' and d.status='dispatched' and d.bucket_at=r.scheduled_for) then
  return jsonb_build_object('recorded',false,'reason','not_normal_scheduled_opportunity','payloadRedacted',true);
 end if;
 if r.work_observation ? p_phase then
  return jsonb_build_object('recorded',false,'reason','observation_already_recorded','payloadRedacted',true);
 end if;
 if p_phase='after' and not coalesce(r.work_observation ? 'before',false) then
  raise exception 'Initial observation required' using errcode='22023';
 end if;
 -- Whitelist booleans only: caller secrets, recipients and provider identifiers
 -- cannot enter this run evidence. A missing observation is never healthy zero.
 select jsonb_object_agg(key,case when jsonb_typeof(p_runtime->key)='boolean'
   then p_runtime->key else 'null'::jsonb end) into runtime
 from unnest(array['automation','contact','manualOutbox','paymentExecutor','policyWindow']) as k(key);
 begin
  snapshot:=private.refund_current_work(observed);
 exception when others then
  snapshot:=jsonb_build_object('status','instrumentation_unavailable','reason','current_work_query_failed',
   'payloadRedacted',true);
 end;
 update public.refund_automation_runs set work_observation=
  coalesce(work_observation,jsonb_build_object('schemaVersion','refund_work_observation_v1','payloadRedacted',true))
  ||jsonb_build_object(p_phase,jsonb_build_object('observedAt',observed,'runtime',runtime,'work',snapshot))
 where id=r.id;
 return jsonb_build_object('recorded',true,'status',snapshot->>'status','payloadRedacted',true);
end;
$$;
revoke all on function public.service_record_refund_work_observation(uuid,text,jsonb)
 from public,anon,authenticated;
grant execute on function public.service_record_refund_work_observation(uuid,text,jsonb) to service_role;

create function private.refund_work_lane_available(p_lane text,p_runtime jsonb)
returns boolean language sql immutable set search_path='' as $$
 select case p_lane
  when 'purchase_lookup' then (p_runtime->>'automation')::boolean
  when 'cash_preparation' then (p_runtime->>'automation')::boolean
  when 'gift_inventory' then true
  when 'approved_refund' then (p_runtime->>'paymentExecutor')::boolean
  when 'customer_outbox' then (p_runtime->>'manualOutbox')::boolean
  when 'automatic_customer_outbox' then (p_runtime->>'manualOutbox')::boolean
   and (p_runtime->>'automation')::boolean and (p_runtime->>'contact')::boolean
  when 'customer_follow_up' then (p_runtime->>'automation')::boolean
   and (p_runtime->>'contact')::boolean and (p_runtime->>'policyWindow')::boolean
  when 'payout_follow_up' then (p_runtime->>'automation')::boolean
   and (p_runtime->>'contact')::boolean and (p_runtime->>'policyWindow')::boolean
  else null end;
$$;
revoke all on function private.refund_work_lane_available(text,jsonb) from public,anon,authenticated,service_role;

create function private.refund_work_lane_disabled(p_lane text,p_runtime jsonb)
returns boolean language sql immutable set search_path='' as $$
 select not private.refund_work_lane_available(p_lane,p_runtime||'{"policyWindow":true}'::jsonb);
$$;
revoke all on function private.refund_work_lane_disabled(text,jsonb) from public,anon,authenticated,service_role;

create function private.refund_due_work_health(p_observed_at timestamptz,p_current_work jsonb default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare current_work jsonb; r record; observations jsonb:='[]'; item jsonb; prior jsonb;
 latest_runtime jsonb; overdue integer:=0; due_count integer:=0; disabled_count integer:=0;
 active_claims integer:=0; unknown_holds integer:=0; future_count integer:=0; blocked_count integer:=0;
 policy_waits integer:=0; external_waits integer:=0; incident_id uuid;
 missed integer; complete boolean:=true; oldest_due timestamptz; groups jsonb:='[]'; state text;
 reason text; source_lane text; available boolean; current_status text;
begin
 current_work:=coalesce(p_current_work,private.refund_current_work(p_observed_at));
 if current_work->>'status' is distinct from 'available' then return current_work; end if;
 -- Take the latest normal runs first. Never skip a failed/partial/missing
 -- observation to find two older green snapshots. Same slot is one opportunity.
 for r in select d.bucket_at scheduled_for,run.started_at,run.finished_at,run.status,run.work_observation
  from public.refund_automation_scheduler_dispatches d
  left join public.refund_automation_runs run on run.run_key=d.run_key and run.trigger_source='scheduled'
  where d.mode='run' and d.status='dispatched' and d.bucket_at<=p_observed_at
  order by d.bucket_at desc limit 2
 loop
  if r.status is null or r.status not in ('succeeded','suppressed') or r.finished_at is null
   or r.work_observation#>>'{before,work,status}' is distinct from 'available'
   or r.work_observation#>>'{after,work,status}' is distinct from 'available'
   or r.work_observation#>>'{before,work,schemaVersion}' is distinct from 'refund_current_work_v1'
   or r.work_observation#>>'{after,work,schemaVersion}' is distinct from 'refund_current_work_v1'
   or nullif(r.work_observation#>>'{before,observedAt}','')::timestamptz<r.started_at
   or nullif(r.work_observation#>>'{after,observedAt}','')::timestamptz>r.finished_at
   or nullif(r.work_observation#>>'{after,observedAt}','')::timestamptz<
      nullif(r.work_observation#>>'{before,observedAt}','')::timestamptz then complete:=false; end if;
  if jsonb_typeof(r.work_observation#>'{before,work,items}') is distinct from 'array'
   or jsonb_typeof(r.work_observation#>'{after,work,items}') is distinct from 'array'
   or nullif(r.work_observation#>>'{before,observedAt}','') is null
   or nullif(r.work_observation#>>'{after,observedAt}','') is null
   or exists(select 1 from unnest(array['automation','contact','manualOutbox','paymentExecutor','policyWindow']) k(key)
    where jsonb_typeof(r.work_observation#>array['before','runtime',key]) is distinct from 'boolean'
     or jsonb_typeof(r.work_observation#>array['after','runtime',key]) is distinct from 'boolean') then complete:=false; end if;
  observations:=observations||jsonb_build_array(r.work_observation);
 end loop;
 if jsonb_array_length(observations)<2 then complete:=false; end if;
 latest_runtime:=observations#>'{0,after,runtime}';
 for item in select value from jsonb_array_elements(current_work->'items') loop
  state:=item->>'state'; source_lane:=item->>'lane'; reason:=item->>'reason';
  if state='active_claim' then active_claims:=active_claims+1;
  elsif state='unknown_hold' then unknown_holds:=unknown_holds+1;
  elsif state='external_wait' then external_waits:=external_waits+1;
  elsif state='future_retry' then future_count:=future_count+1;
  elsif state='blocked' then blocked_count:=blocked_count+1;
  elsif state='due' and (item->>'dueAt')::timestamptz<=p_observed_at then
   due_count:=due_count+1; missed:=0;
   available:=private.refund_work_lane_available(source_lane,latest_runtime);
   if available is null then complete:=false;
   elsif private.refund_work_lane_disabled(source_lane,latest_runtime) then disabled_count:=disabled_count+1;
    reason:='required_worker_disabled'; end if;
   if available is false and not private.refund_work_lane_disabled(source_lane,latest_runtime) then
    policy_waits:=policy_waits+1; end if;
   for prior in select value from jsonb_array_elements(observations) loop
    if private.refund_work_lane_available(source_lane,prior#>'{before,runtime}')
     and private.refund_work_lane_available(source_lane,prior#>'{after,runtime}')
     and exists(select 1 from jsonb_array_elements(prior#>'{before,work,items}') before_item
      where before_item->>'key'=item->>'key' and before_item->>'state'='due'
       and (before_item->>'dueAt')::timestamptz<=(prior#>>'{before,observedAt}')::timestamptz)
     and exists(select 1 from jsonb_array_elements(prior#>'{after,work,items}') after_item
      where after_item->>'key'=item->>'key' and after_item->>'state'='due') then missed:=missed+1; end if;
   end loop;
   if complete and missed=2 then overdue:=overdue+1;
    reason:='two_missed_normal_opportunities'; end if;
   if (complete and missed=2) or private.refund_work_lane_disabled(source_lane,latest_runtime) then
    oldest_due:=least(oldest_due,(item->>'dueAt')::timestamptz);
    groups:=groups||jsonb_build_array(jsonb_build_object('lane',source_lane,'action',item->>'action',
     'reason',reason,'owner','Agent','dueAt',item->'dueAt','lastProgressAt',item->'lastProgressAt'));
   end if;
  end if;
  if state='blocked' then groups:=groups||jsonb_build_array(item-'key'); end if;
 end loop;
 current_status:=case when overdue+disabled_count+blocked_count>0 then 'degraded'
  when not complete or (current_work->>'unsupportedActionCount')::integer>0 then 'instrumentation_unavailable'
  else 'healthy' end;
 select id into incident_id from public.refund_automation_alert_incidents
  where status='open' order by opened_at desc,id desc limit 1;
 return jsonb_build_object('schemaVersion','refund_due_work_health_v1','status',current_status,'observedAt',p_observed_at,
  'sourceCoverage',current_work->'sourceCoverage','observationsComplete',complete,
  'dueCount',due_count,'overdueCount',overdue,'disabledWorkerCount',disabled_count,
  'blockedCount',blocked_count,'oldestOverdueAt',oldest_due,
  'activeClaimCount',active_claims,'unknownHoldCount',unknown_holds,'futureRetryCount',future_count,
  'policyWaitCount',policy_waits,'externalWaitCount',external_waits,
  'customerWaitCount',current_work->'customerWaitCount','agentWorkCount',current_work->'agentWorkCount',
  'evidenceDependencyCount',current_work->'evidenceDependencyCount',
  'manualContactRecoveryCount',current_work->'manualContactRecoveryCount',
  'awaitingDecisionCount',current_work->'decisionCount','oldestDecisionAt',current_work->'oldestDecisionAt',
  'decisionClockBasis',current_work->'decisionClockBasis',
  'decisionClockUnavailableCount',current_work->'decisionClockUnavailableCount',
  'unsupportedActionCount',current_work->'unsupportedActionCount','blockedWork',groups,
  'technicalOwner',jsonb_build_object('route','bloomjoy-technical-incident-repair',
    'required',overdue+disabled_count+blocked_count>0 or incident_id is not null,'incidentId',incident_id,
    'availability','unverified','activity',null,'dependencyIssue',1430,
    'reason','routing_event_is_not_executor_activity'),
  'payloadRedacted',true);
exception when others then
 return jsonb_build_object('status','instrumentation_unavailable','reason','current_work_query_failed',
  'payloadRedacted',true);
end;
$$;
revoke all on function private.refund_due_work_health(timestamptz,jsonb) from public,anon,authenticated,service_role;

create function public.service_get_refund_due_work_health(p_observed_at timestamptz default statement_timestamp())
returns jsonb language sql stable security definer set search_path='' as $$
 select private.refund_due_work_health(p_observed_at);
$$;
revoke all on function public.service_get_refund_due_work_health(timestamptz) from public,anon,authenticated;
grant execute on function public.service_get_refund_due_work_health(timestamptz) to service_role;

-- Preserve a verified server summary for the existing authorized health API.
-- This reuses the captured after-snapshot rather than running the investigation
-- again. It is evidence from a finished run, never an active-repair assertion.
alter function public.service_finish_refund_automation_run(uuid,text,integer,integer,integer,integer,integer,jsonb,text,text)
 rename to service_finish_refund_automation_run_pre_work_observation_v1;
revoke all on function public.service_finish_refund_automation_run_pre_work_observation_v1(
 uuid,text,integer,integer,integer,integer,integer,jsonb,text,text) from public,anon,authenticated,service_role;
create function public.service_finish_refund_automation_run(
 p_run_id uuid,p_status text,p_cases_evaluated integer,p_actions_attempted integer,p_actions_succeeded integer,
 p_actions_failed integer,p_actions_suppressed integer,p_reason_counts jsonb,p_failure_category text default null,
 p_alert_status text default 'not_needed'
) returns boolean language plpgsql volatile security definer set search_path='' as $$
declare done boolean; r public.refund_automation_runs; summary jsonb; observed_at timestamptz;
begin
 done:=public.service_finish_refund_automation_run_pre_work_observation_v1(p_run_id,p_status,p_cases_evaluated,
  p_actions_attempted,p_actions_succeeded,p_actions_failed,p_actions_suppressed,p_reason_counts,p_failure_category,p_alert_status);
 select * into r from public.refund_automation_runs where id=p_run_id;
 if done and r.work_observation ? 'after' then
  observed_at:=nullif(r.work_observation#>>'{after,observedAt}','')::timestamptz;
  begin
   summary:=private.refund_due_work_health(observed_at,r.work_observation#>'{after,work}');
  exception when others then summary:=jsonb_build_object('status','instrumentation_unavailable',
   'reason','server_summary_unavailable','observedAt',observed_at,'payloadRedacted',true); end;
  update public.refund_automation_runs set work_observation=work_observation||jsonb_build_object('healthSummary',summary)
   where id=r.id;
 end if;
 return done;
end;
$$;
revoke all on function public.service_finish_refund_automation_run(uuid,text,integer,integer,integer,integer,integer,jsonb,text,text)
 from public,anon,authenticated;
grant execute on function public.service_finish_refund_automation_run(uuid,text,integer,integer,integer,integer,integer,jsonb,text,text)
 to service_role;

create function private.refund_observed_work_health(p_observed_at timestamptz,p_stale_minutes integer)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare summary jsonb; source_observed_at timestamptz;
begin
 if p_stale_minutes is null or p_stale_minutes<=0 then
  return jsonb_build_object('status','instrumentation_unavailable','reason','scheduler_freshness_unavailable','payloadRedacted',true);
 end if;
 select r.work_observation->'healthSummary' into summary
 from public.refund_automation_scheduler_dispatches d
 left join public.refund_automation_runs r on r.run_key=d.run_key and r.trigger_source='scheduled'
 where d.mode='run' and d.status='dispatched' and d.bucket_at<=p_observed_at
 order by d.bucket_at desc limit 1;
 source_observed_at:=nullif(summary->>'observedAt','')::timestamptz;
 if summary->>'schemaVersion' is distinct from 'refund_due_work_health_v1'
  or summary->>'payloadRedacted' is distinct from 'true' or source_observed_at is null then
  return jsonb_build_object('status','instrumentation_unavailable','reason','verified_server_summary_missing','payloadRedacted',true);
 end if;
 if source_observed_at>p_observed_at or source_observed_at<p_observed_at-make_interval(mins=>p_stale_minutes) then
  return jsonb_build_object('status','instrumentation_unavailable','reason','verified_server_summary_stale',
   'observedAt',source_observed_at,'payloadRedacted',true);
 end if;
 return summary||jsonb_build_object('source','verified_scheduled_run');
end;
$$;
revoke all on function private.refund_observed_work_health(timestamptz,integer) from public,anon,authenticated,service_role;

alter function public.service_get_refund_workflow_health(boolean,boolean,boolean,boolean,boolean,text[],timestamptz)
 rename to service_get_refund_workflow_health_pre_due_work_v1;
revoke all on function public.service_get_refund_workflow_health_pre_due_work_v1(
 boolean,boolean,boolean,boolean,boolean,text[],timestamptz) from public,anon,authenticated,service_role;
create function public.service_get_refund_workflow_health(
 p_automation_enabled boolean,p_customer_contact_enabled boolean,p_manual_outbox_enabled boolean,
 p_manager_digest_enabled boolean,p_manager_ready_enabled boolean,p_mailbox_identities text[],
 p_observed_at timestamptz default statement_timestamp()
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare base jsonb; due jsonb; workflow_status text; overall_status text; reasons jsonb;
begin
 base:=public.service_get_refund_workflow_health_pre_due_work_v1(p_automation_enabled,p_customer_contact_enabled,
  p_manual_outbox_enabled,p_manager_digest_enabled,p_manager_ready_enabled,p_mailbox_identities,p_observed_at);
 due:=case when auth.uid() is null then private.refund_due_work_health(p_observed_at)
  else private.refund_observed_work_health(p_observed_at,(base->>'staleAfterMinutes')::integer) end;
 reasons:=base->'blockedReasons'; overall_status:=base->>'status';
 workflow_status:=case when base->>'deliveryStatus'='degraded' or due->>'status'='degraded' then 'degraded'
  when base->>'deliveryStatus'='healthy' and due->>'status'='healthy' then 'healthy'
  else 'instrumentation_unavailable' end;
 if due->>'status'='degraded' then reasons:=reasons||'"current_case_work_not_advancing"'::jsonb; end if;
 if base->>'schedulerStatus'='healthy' then overall_status:=case workflow_status
  when 'degraded' then 'failing' when 'healthy' then 'healthy' else 'waiting' end; end if;
 return base||jsonb_build_object('status',overall_status,'workflowStatus',workflow_status,
  'blockedReasons',reasons,'dueWork',due,'payloadRedacted',true);
end;
$$;
revoke all on function public.service_get_refund_workflow_health(boolean,boolean,boolean,boolean,boolean,text[],timestamptz)
 from public,anon,authenticated;
grant execute on function public.service_get_refund_workflow_health(boolean,boolean,boolean,boolean,boolean,text[],timestamptz)
 to service_role;
select pg_notify('pgrst','reload schema');
