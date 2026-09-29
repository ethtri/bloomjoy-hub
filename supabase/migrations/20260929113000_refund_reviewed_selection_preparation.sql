-- A case worker may confirm one already-selected, current, review-safe Nayax
-- transaction without making the Manager's final decision. Older selection
-- events did not carry the current candidate/version proof, so an exact replay
-- could never complete the existing Manager-preparation contract.
--
-- Keep this path inside the existing selector. It records one current proof and
-- exposes one advisory recommendation; it does not call Nayax, approve/deny,
-- create a payment attempt, or contact the customer.

do $migration$
declare
  function_definition text;
  old_declaration text := $old$
  selection_event_message text;
$old$;
  new_declaration text := $new$
  selection_event_message text;
  current_selection_proof_refreshed boolean := false;
  current_candidate_evidence_hash text;
$new$;
  old_delegate text := $old$
  result := public.service_select_refund_nayax_candidate_as_actor_pre_lookup_generation_v1(
    p_actor_user_id, p_case_id, p_expected_case_version,
    p_candidate_token, p_nayax_disagreement_reason
  );
$old$;
  new_delegate text := $new$
  -- An exact replay is normally a no-op. When its historical event predates the
  -- current proof schema, record one new proof only after revalidating every
  -- current safety boundary. The case row and its decision stay unchanged.
  if exact_replay and not manual_portal_candidate and not exists (
    select 1 from public.refund_case_events proof
    where proof.refund_case_id = case_row.id
      and proof.event_type = 'nayax_match_selected'
      and proof.actor_user_id = p_actor_user_id
      and proof.metadata ->> 'candidate_token' = candidate_row.token::text
      and proof.metadata ->> 'lookup_generation' = case_row.nayax_lookup_generation::text
      and proof.metadata ->> 'deterministic_fact_version' = case_row.deterministic_fact_version::text
      and proof.metadata ->> 'candidate_evidence_hash' =
        public.refund_nayax_candidate_evidence_hash(
          candidate_row.refund_case_id,candidate_row.actor_user_id,
          candidate_row.provider_transaction_id,candidate_row.site_id,
          candidate_row.machine_authorization_time,candidate_row.amount_cents,
          candidate_row.card_last4,candidate_row.currency_code,
          candidate_row.evidence_summary,candidate_row.expires_at,
          candidate_row.created_at)
      and proof.metadata ->> 'payload_redacted' = 'true'
      and proof.metadata ->> 'provider_call_made' = 'false'
      and proof.metadata ->> 'customer_message_created' = 'false'
  ) then
    evidence_state := public.refund_nayax_candidate_identifier_evidence_state(
      case_row.id,candidate_row.reporting_machine_id,candidate_row.site_id,
      candidate_row.machine_authorization_time,candidate_row.amount_cents,
      candidate_row.card_last4,candidate_row.currency_code,
      candidate_row.evidence_summary);
    if p_expected_case_version is distinct from case_row.official_action_version
      or candidate_row.actor_user_id is distinct from p_actor_user_id
      or candidate_row.lookup_generation is distinct from case_row.nayax_lookup_generation
      or candidate_row.expires_at <= statement_timestamp()
      or case_row.payment_method is distinct from 'card'
      or case_row.case_population is distinct from 'customer'
      or case_row.status not in ('needs_review','correlated')
      or case_row.decision is not null
      or case_row.nayax_lookup_status not in ('multiple_matches','manual_exception')
      or case_row.nayax_recommendation_state is distinct from 'manager_confirmed'
      or case_row.nayax_refund_execution_status is distinct from 'not_requested'
      or case_row.nayax_match_execution_eligible is distinct from true
      or case_row.refund_completed_at is not null
      or case_row.reporting_adjustment_id is not null
      or case_row.manual_refund_reference is not null
      or case_row.duplicate_of_refund_case_id is not null
      or public.refund_case_has_unresolved_reconciliation(case_row.id)
      or evidence_state is distinct from 'valid'
      or public.refund_nayax_request_boundary_evidence_state(
        case_row.customer_request_received_at,
        case_row.customer_request_received_source,
        candidate_row.evidence_summary) is distinct from 'valid'
      or candidate_row.evidence_summary ->> 'selection_allowed' is distinct from 'true'
      or candidate_row.evidence_summary ->> 'payment_status' is distinct from 'approved'
      or candidate_row.evidence_summary ->> 'provider_refund_state' is distinct from 'clear'
      or candidate_row.evidence_summary ->> 'duplicate_provider_record' is distinct from 'false'
      or candidate_row.evidence_summary -> 'hard_exclusions' is distinct from '[]'::jsonb
      or not public.is_review_safe_nayax_transaction_reference(
        candidate_row.provider_transaction_id)
      or candidate_row.site_id is null or candidate_row.site_id < 0
      or candidate_row.machine_authorization_time is null
      or candidate_row.amount_cents is null or candidate_row.amount_cents <= 0
      or candidate_row.currency_code is distinct from 'USD'
      or exists(select 1 from public.refund_authoritative_receipts receipt
        where receipt.refund_case_id = case_row.id)
      or exists(select 1 from public.refund_case_nayax_refund_attempts attempt
        where attempt.refund_case_id = case_row.id)
      or exists(select 1 from public.refund_case_official_action_authorizations auth_row
        where auth_row.refund_case_id = case_row.id
          and auth_row.status in ('pending','consumed'))
      or exists(select 1 from public.refund_cases other
        where other.id <> case_row.id
          and other.matched_nayax_transaction_id = candidate_row.provider_transaction_id)
      or exists(select 1
        from public.refund_nayax_transaction_allocations allocation
        join public.reporting_machines machine
          on machine.id = case_row.reporting_machine_id
        where allocation.account_scope = machine.nayax_account_key
          and allocation.provider_machine_id = machine.nayax_machine_id
          and allocation.original_transaction_id = candidate_row.provider_transaction_id
          and allocation.allocation_state in ('reserved','refunded')) then
      raise exception 'The reviewed Nayax selection changed; refresh the case before preparing a recommendation'
        using errcode = 'P4604';
    end if;
    current_candidate_evidence_hash := public.refund_nayax_candidate_evidence_hash(
      candidate_row.refund_case_id,candidate_row.actor_user_id,
      candidate_row.provider_transaction_id,candidate_row.site_id,
      candidate_row.machine_authorization_time,candidate_row.amount_cents,
      candidate_row.card_last4,candidate_row.currency_code,
      candidate_row.evidence_summary,candidate_row.expires_at,
      candidate_row.created_at);
    insert into public.refund_case_events(
      refund_case_id,actor_user_id,event_type,message,metadata
    ) values (
      case_row.id,p_actor_user_id,'nayax_match_selected',
      'Case worker re-confirmed the current reviewed Nayax transaction for the Manager recommendation.',
      jsonb_build_object(
        'candidate_token',candidate_row.token,
        'candidate_evidence_hash',current_candidate_evidence_hash,
        'lookup_generation',candidate_row.lookup_generation,
        'deterministic_fact_version',case_row.deterministic_fact_version,
        'policy_version',candidate_row.evidence_summary ->> 'policy_version',
        'recommendation_state',case_row.nayax_recommendation_state,
        'scorer_recommendation_state',candidate_row.evidence_summary ->> 'recommendation_state',
        'selected_recommended',
          (candidate_row.evidence_summary ->> 'is_recommended')::boolean,
        'disagreement_reason_code',nullif(
          pg_catalog.lower(pg_catalog.btrim(coalesce(p_nayax_disagreement_reason,''))),''),
        'execution_eligible',true,
        'proof_refresh',true,
        'provider_call_made',false,
        'customer_message_created',false,
        'payload_redacted',true));
    current_selection_proof_refreshed := true;
  end if;

  result := public.service_select_refund_nayax_candidate_as_actor_pre_lookup_generation_v1(
    p_actor_user_id, p_case_id, p_expected_case_version,
    p_candidate_token, p_nayax_disagreement_reason
  );
  if current_selection_proof_refreshed then
    result := result || jsonb_build_object(
      'currentSelectionProofRefreshed',true,
      'providerCallMade',false,
      'customerMessageCreated',false);
  end if;
$new$;
begin
  function_definition := pg_catalog.replace(pg_catalog.pg_get_functiondef(
    'public.service_select_refund_nayax_candidate_as_actor(uuid,uuid,bigint,uuid,text)'::regprocedure
  ),E'\r\n',E'\n');
  if cardinality(pg_catalog.string_to_array(function_definition,old_declaration)) <> 2
    or cardinality(pg_catalog.string_to_array(function_definition,old_delegate)) <> 2 then
    raise exception 'Current reviewed-selection service does not match proof-refresh anchors';
  end if;
  function_definition := pg_catalog.replace(
    function_definition,old_declaration,new_declaration);
  function_definition := pg_catalog.replace(
    function_definition,old_delegate,new_delegate);
  execute function_definition;
end;
$migration$;

do $migration$
declare
  function_definition text;
  old_gate text := $old$
      and refund_case.nayax_recommendation_state in ('ambiguous', 'manual_exception')
      and refund_case.nayax_lookup_status in ('multiple_matches', 'manual_exception')
$old$;
  new_gate text := $new$
      and refund_case.nayax_lookup_status in ('multiple_matches', 'manual_exception')
      and (
        refund_case.nayax_recommendation_state in ('ambiguous', 'manual_exception')
        or (
          refund_case.nayax_recommendation_state = 'manager_confirmed'
          and exists (
            select 1 from public.refund_nayax_lookup_candidates selected
            where selected.token = p_candidate_token
              and selected.refund_case_id = refund_case.id
              and selected.actor_user_id = actor_id
              and selected.lookup_generation = refund_case.nayax_lookup_generation
              and selected.reporting_machine_id = refund_case.reporting_machine_id
              and selected.provider_transaction_id = refund_case.matched_nayax_transaction_id
              and selected.site_id is not distinct from refund_case.matched_nayax_site_id
              and selected.machine_authorization_time is not distinct from
                refund_case.matched_nayax_machine_auth_time
              and selected.amount_cents is not distinct from refund_case.matched_nayax_amount_cents
              and selected.card_last4 is not distinct from refund_case.matched_nayax_card_last4
              and selected.currency_code is not distinct from refund_case.matched_nayax_currency_code
          )
        )
      )
$new$;
begin
  function_definition := pg_catalog.replace(pg_catalog.pg_get_functiondef(
    'public.admin_select_refund_nayax_candidate_current_user_v1(uuid,bigint,uuid,text)'::regprocedure
  ),E'\r\n',E'\n');
  if cardinality(pg_catalog.string_to_array(function_definition,old_gate)) <> 2 then
    raise exception 'Current authenticated candidate selector does not match replay-gate anchor';
  end if;
  execute pg_catalog.replace(function_definition,old_gate,new_gate);
end;
$migration$;

do $migration$
declare
  function_definition text;
  old_query text := $old$
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
$old$;
  new_query text := $new$
    -- Candidate count is not proof. Accept either the prior one-clear-System
    -- evidence or one exact actor-reviewed selection with a current bound proof.
    select k.* into card from public.refund_nayax_lookup_candidates k
    where k.refund_case_id=c.id and k.lookup_generation=c.nayax_lookup_generation
      and k.expires_at>p_observed_at
      and k.evidence_summary->>'selection_allowed'='true'
      and k.evidence_summary->>'payment_status'='approved'
      and k.evidence_summary->>'provider_refund_state'='clear'
      and k.evidence_summary->>'duplicate_provider_record'='false'
      and k.evidence_summary->'hard_exclusions'='[]'::jsonb
      and (
        (
          k.actor_user_id is null
          and k.evidence_summary->>'is_recommended'='true'
          and k.evidence_summary->>'recommendation_state'='high_confidence'
          and ((preparation->>'evidenceBasis'='card_exact_selected'
              and k.provider_transaction_id=c.matched_nayax_transaction_id
              and c.nayax_recommendation_state='high_confidence')
            or (preparation->>'evidenceBasis'='card_reviewed_candidate_set'
              and preparation->'eligibleCandidateTokens' @> jsonb_build_array(k.token)
              and public.refund_reviewed_card_candidate_safe_v1(c.id,k.token)))
        )
        or (
          preparation->>'evidenceBasis'='card_exact_selected'
          and c.nayax_recommendation_state='manager_confirmed'
          and k.actor_user_id is not null
          and k.reporting_machine_id=c.reporting_machine_id
          and k.provider_transaction_id=c.matched_nayax_transaction_id
          and k.site_id is not distinct from c.matched_nayax_site_id
          and k.machine_authorization_time is not distinct from c.matched_nayax_machine_auth_time
          and k.amount_cents is not distinct from c.matched_nayax_amount_cents
          and k.card_last4 is not distinct from c.matched_nayax_card_last4
          and k.currency_code is not distinct from c.matched_nayax_currency_code
          and public.refund_nayax_request_boundary_evidence_state(
            c.customer_request_received_at,c.customer_request_received_source,
            k.evidence_summary)='valid'
          and public.refund_nayax_candidate_identifier_evidence_state(
            k.refund_case_id,k.reporting_machine_id,k.site_id,
            k.machine_authorization_time,k.amount_cents,k.card_last4,
            k.currency_code,k.evidence_summary)='valid'
          and exists(select 1 from public.refund_case_events proof
            where proof.id=(preparation->>'proofId')::uuid
              and proof.refund_case_id=c.id
              and proof.event_type='nayax_match_selected'
              and proof.actor_user_id=k.actor_user_id
              and proof.metadata->>'candidate_token'=k.token::text
              and proof.metadata->>'candidate_evidence_hash'=
                public.refund_nayax_candidate_evidence_hash(
                  k.refund_case_id,k.actor_user_id,k.provider_transaction_id,
                  k.site_id,k.machine_authorization_time,k.amount_cents,
                  k.card_last4,k.currency_code,k.evidence_summary,
                  k.expires_at,k.created_at)
              and proof.metadata->>'lookup_generation'=c.nayax_lookup_generation::text
              and proof.metadata->>'deterministic_fact_version'=c.deterministic_fact_version::text
              and proof.metadata->>'provider_call_made'='false'
              and proof.metadata->>'customer_message_created'='false'
              and proof.metadata->>'payload_redacted'='true')
          and not exists(select 1 from public.refund_cases other_case
            where other_case.id<>c.id
              and other_case.matched_nayax_transaction_id=k.provider_transaction_id)
          and not exists(select 1
            from public.refund_nayax_transaction_allocations allocation
            join public.reporting_machines machine
              on machine.id=c.reporting_machine_id
            where allocation.account_scope=machine.nayax_account_key
              and allocation.provider_machine_id=machine.nayax_machine_id
              and allocation.original_transaction_id=k.provider_transaction_id
              and allocation.allocation_state in ('reserved','refunded'))
        )
      )
      and not exists(select 1 from public.refund_nayax_lookup_candidates other
        where other.refund_case_id=c.id
          and other.lookup_generation=c.nayax_lookup_generation
          and other.token<>k.token and other.expires_at>p_observed_at
          and other.actor_user_id is null
          and other.evidence_summary->>'is_recommended'='true'
          and other.evidence_summary->>'recommendation_state'='high_confidence'
          and other.evidence_summary->>'selection_allowed'='true'
          and other.evidence_summary->'hard_exclusions'='[]'::jsonb)
$new$;
begin
  function_definition := pg_catalog.replace(pg_catalog.pg_get_functiondef(
    'public.refund_decision_recommendation_for_case(uuid,timestamptz)'::regprocedure
  ),E'\r\n',E'\n');
  if cardinality(pg_catalog.string_to_array(function_definition,old_query)) <> 2 then
    raise exception 'Current decision recommendation does not match reviewed-selection anchor';
  end if;
  execute pg_catalog.replace(function_definition,old_query,new_query);
end;
$migration$;

revoke all on function public.service_select_refund_nayax_candidate_as_actor(
  uuid,uuid,bigint,uuid,text) from public,anon,authenticated;
grant execute on function public.service_select_refund_nayax_candidate_as_actor(
  uuid,uuid,bigint,uuid,text) to service_role;
revoke all on function public.admin_select_refund_nayax_candidate_current_user_v1(
  uuid,bigint,uuid,text) from public,anon,service_role;
grant execute on function public.admin_select_refund_nayax_candidate_current_user_v1(
  uuid,bigint,uuid,text) to authenticated;
revoke all on function public.refund_decision_recommendation_for_case(
  uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.refund_decision_recommendation_for_case(
  uuid,timestamptz) to service_role;

comment on function public.service_select_refund_nayax_candidate_as_actor(
  uuid,uuid,bigint,uuid,text) is
  'Selects current Nayax evidence or refreshes the bound proof for an unchanged reviewed selection. It never calls the provider, decides, pays, or messages.';
comment on function public.refund_decision_recommendation_for_case(uuid,timestamptz)
  is 'Service-only redacted current-evidence recommendation, including one exact actor-reviewed selection with a current bound proof. It grants no decision, payment, or messaging authority.';

select pg_notify('pgrst','reload schema');
