-- A manager confirmation is evidence selection, not a payment action. This
-- migration gives that selection one replay-safe write boundary and one
-- server-owned readiness contract for the next explicit action.

create or replace function public.refund_case_nayax_manager_readiness(
  p_user_id uuid,
  p_refund_case_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  refund_case public.refund_cases%rowtype;
  machine public.reporting_machines%rowtype;
  transaction_confirmed boolean := false;
  can_issue_card_refund boolean := false;
  block_reason text := null;
begin
  select case_row.* into refund_case
  from public.refund_cases case_row
  where case_row.id = p_refund_case_id;

  if not found then
    return jsonb_build_object(
      'transactionConfirmed', false,
      'canIssueCardRefund', false,
      'blockReason', 'case_not_found',
      'refundAmountCents', null,
      'machineLimitCents', null,
      'caseVersion', null
    );
  end if;

  if refund_case.reporting_machine_id is not null then
    select machine_row.* into machine
    from public.reporting_machines machine_row
    where machine_row.id = refund_case.reporting_machine_id;
  end if;

  transaction_confirmed :=
    refund_case.correlation_status = 'matched'
    and refund_case.correlation_source = 'nayax'
    and refund_case.nayax_recommendation_policy_version is not null
    and public.is_review_safe_nayax_transaction_reference(
      refund_case.matched_nayax_transaction_id
    )
    and (
      refund_case.matched_nayax_site_id is not null
      or exists (
        select 1
        from public.refund_case_events manual_selection_event
        where manual_selection_event.refund_case_id = refund_case.id
          and manual_selection_event.event_type = 'nayax_match_selected'
          and manual_selection_event.metadata ->> 'manual_portal_candidate' = 'true'
      )
    )
    and refund_case.matched_nayax_machine_auth_time is not null
    and refund_case.matched_nayax_amount_cents is not null
    and refund_case.matched_nayax_currency_code = 'USD'
    and refund_case.refund_amount_cents is not null
    and refund_case.refund_amount_cents > 0
    and refund_case.matched_nayax_amount_cents = refund_case.refund_amount_cents
    and exists (
      select 1
      from public.refund_case_events selection_event
      where selection_event.refund_case_id = refund_case.id
        and selection_event.event_type = 'nayax_match_selected'
        and selection_event.actor_user_id is not null
    );

  block_reason := case
    when p_user_id is null
      or not public.can_perform_refund_official_action(
        p_user_id,
        refund_case.id
      ) then 'unauthorized'
    when not transaction_confirmed then 'transaction_not_confirmed'
    when refund_case.reporting_adjustment_id is not null
      or refund_case.refund_completed_at is not null
      or refund_case.nayax_refund_execution_status = 'succeeded'
      then 'already_refunded'
    when public.refund_case_has_unresolved_reconciliation(refund_case.id)
      or refund_case.nayax_refund_execution_status in (
        'requested', 'ambiguous', 'manual_review'
      ) then 'reconciliation_hold'
    when exists (
      select 1
      from public.refund_cases duplicate_case
      where duplicate_case.id <> refund_case.id
        and duplicate_case.matched_nayax_transaction_id =
          refund_case.matched_nayax_transaction_id
    ) then 'duplicate_transaction'
    when refund_case.payment_method <> 'card'
      or refund_case.status not in (
        'needs_review', 'correlated', 'approved', 'card_refund_pending'
      )
      or (refund_case.decision is not null and refund_case.decision <> 'approved')
      or refund_case.nayax_refund_execution_status <> 'not_requested'
      then 'case_not_refundable'
    when machine.id is null
      or machine.status <> 'active'
      or machine.nayax_machine_id is null
      or btrim(machine.nayax_machine_id) = ''
      or machine.nayax_account_key is null
      or btrim(machine.nayax_account_key) = ''
      then 'provider_unavailable'
    when machine.nayax_refunds_enabled is not true
      then 'machine_not_enabled'
    when machine.nayax_refund_max_amount_cents is not null
      and refund_case.refund_amount_cents >
        machine.nayax_refund_max_amount_cents
      then 'cap_exceeded'
    else null
  end;

  can_issue_card_refund := block_reason is null;

  return jsonb_build_object(
    'transactionConfirmed', transaction_confirmed,
    'canIssueCardRefund', can_issue_card_refund,
    'blockReason', block_reason,
    'refundAmountCents', refund_case.refund_amount_cents,
    'machineLimitCents', machine.nayax_refund_max_amount_cents,
    'caseVersion', refund_case.official_action_version
  );
end;
$$;

comment on function public.refund_case_nayax_manager_readiness(uuid, uuid) is
  'Private, side-effect-free readiness contract for the explicit manager Nayax refund action. Runtime/provider gates are merged by the Edge boundary.';

revoke execute on function public.refund_case_nayax_manager_readiness(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.refund_case_nayax_manager_readiness(uuid, uuid)
  to service_role;

create or replace function public.can_offer_nayax_refund_manager_action(
  p_user_id uuid,
  p_refund_case_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      public.refund_case_nayax_manager_readiness(
        p_user_id,
        p_refund_case_id
      ) ->> 'canIssueCardRefund'
    )::boolean,
    false
  );
$$;

revoke execute on function public.can_offer_nayax_refund_manager_action(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.can_offer_nayax_refund_manager_action(uuid, uuid)
  to service_role;

create or replace function public.service_select_refund_nayax_candidate_as_actor(
  p_actor_user_id uuid,
  p_case_id uuid,
  p_expected_case_version bigint,
  p_candidate_token uuid,
  p_nayax_disagreement_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  refund_case public.refund_cases%rowtype;
  candidate public.refund_nayax_lookup_candidates%rowtype;
  candidate_machine_id uuid;
  normalized_disagreement_reason text := lower(btrim(coalesce(p_nayax_disagreement_reason, '')));
  candidate_recommended boolean := false;
  candidate_selection_allowed boolean := false;
  manual_portal_candidate boolean := false;
  recommendation_state text;
  policy_version text;
  one_click_eligible boolean := false;
  updated_case public.refund_cases%rowtype;
  selection_is_replay boolean := false;
begin
  if p_actor_user_id is null or p_case_id is null or p_candidate_token is null then
    raise exception 'Actor, refund case, and Nayax candidate are required'
      using errcode = 'P4600';
  end if;

  select case_row.* into refund_case
  from public.refund_cases case_row
  where case_row.id = p_case_id
  for update;
  if not found then
    raise exception 'Refund case not found' using errcode = 'P4600';
  end if;

  if refund_case.reporting_machine_id is null then
    if not public.can_manage_refund_case(p_actor_user_id, refund_case.id) then
      raise exception 'Complete active manager authority over the grouped selection is required'
        using errcode = 'P4603';
    end if;
  elsif not public.can_perform_refund_official_action(
    p_actor_user_id,
    refund_case.id
  ) then
    raise exception 'Active Machine Manager mapping required; admin identities are review-only'
      using errcode = 'P4603';
  end if;

  -- Read the actor-bound candidate even when expired so an exact completed
  -- confirmation can be acknowledged as a replay. Expiry still blocks every
  -- first-time selection below.
  select lookup_candidate.* into candidate
  from public.refund_nayax_lookup_candidates lookup_candidate
  where lookup_candidate.token = p_candidate_token
    and lookup_candidate.refund_case_id = refund_case.id
    and lookup_candidate.actor_user_id = p_actor_user_id
  for share;
  if not found then
    raise exception 'Nayax lookup evidence expired or belongs to another review session'
      using errcode = 'P4602';
  end if;

  candidate_machine_id := coalesce(
    candidate.reporting_machine_id,
    refund_case.reporting_machine_id
  );

  selection_is_replay :=
    candidate_machine_id is not null
    and refund_case.reporting_machine_id = candidate_machine_id
    and refund_case.matched_nayax_transaction_id = candidate.provider_transaction_id
    and refund_case.matched_nayax_site_id is not distinct from candidate.site_id
    and refund_case.matched_nayax_machine_auth_time =
      candidate.machine_authorization_time
    and refund_case.matched_nayax_amount_cents = candidate.amount_cents
    and refund_case.matched_nayax_card_last4 is not distinct from candidate.card_last4
    and refund_case.matched_nayax_currency_code = candidate.currency_code
    and exists (
      select 1
      from public.refund_case_events selection_event
      where selection_event.refund_case_id = refund_case.id
        and selection_event.event_type = 'nayax_match_selected'
        and selection_event.actor_user_id = p_actor_user_id
    );

  if selection_is_replay then
    return to_jsonb(refund_case) || jsonb_build_object(
      'selectionApplied', false,
      'transactionConfirmed', true,
      'refundReadiness', public.refund_case_nayax_manager_readiness(
        p_actor_user_id,
        refund_case.id
      )
    );
  end if;

  if refund_case.official_action_version is distinct from p_expected_case_version then
    raise exception 'Refund case changed since review; reload before selecting a transaction'
      using errcode = 'P4601';
  end if;
  if refund_case.payment_method <> 'card'
    or refund_case.status <> 'needs_review'
    or refund_case.decision is not null
    or refund_case.nayax_refund_execution_status <> 'not_requested'
    or refund_case.reporting_adjustment_id is not null
    or refund_case.refund_completed_at is not null
    or public.refund_case_has_unresolved_reconciliation(refund_case.id) then
    raise exception 'This refund case is not safe for Nayax evidence selection'
      using errcode = 'P4604';
  end if;
  if candidate.expires_at <= statement_timestamp() then
    raise exception 'Nayax lookup evidence expired or belongs to another review session'
      using errcode = 'P4602';
  end if;

  if candidate_machine_id is null then
    raise exception 'The candidate is missing its exact machine identity'
      using errcode = 'P4604';
  end if;
  if refund_case.reporting_machine_id is not null
    and candidate_machine_id <> refund_case.reporting_machine_id then
    raise exception 'The candidate belongs to a different machine'
      using errcode = 'P4604';
  end if;
  if refund_case.reporting_machine_id is null and (
    refund_case.intake_selection_kind <> 'livermore_pair'
    or refund_case.intake_selection_key <> public.refund_livermore_selection_key()
    or refund_case.intake_selection_machine_ids <> public.refund_livermore_selection_machine_ids()
    or candidate_machine_id <> all(refund_case.intake_selection_machine_ids)
    or not public.refund_livermore_selection_is_valid()
  ) then
    raise exception 'The grouped machine scope changed and requires administrator review'
      using errcode = 'P4604';
  end if;

  candidate_selection_allowed := candidate.evidence_summary ->> 'selection_allowed' = 'true';
  candidate_recommended := candidate.evidence_summary ->> 'is_recommended' = 'true';
  manual_portal_candidate := coalesce(
    candidate.evidence_summary ->> 'source' = 'manual_nayax_portal',
    false
  );
  if not candidate_selection_allowed then
    raise exception 'This Nayax transaction has a safety block and cannot be selected'
      using errcode = 'P4604';
  end if;
  if not candidate_recommended
    and normalized_disagreement_reason not in (
      'closer_time', 'correct_amount', 'correct_card',
      'customer_confirmation', 'provider_data_issue', 'other_review_reason'
    ) then
    raise exception 'Choose why this alternate Nayax transaction is the correct one'
      using errcode = 'P4604';
  end if;
  if not public.is_review_safe_nayax_transaction_reference(candidate.provider_transaction_id)
    or (candidate.site_id is null and not manual_portal_candidate)
    or (candidate.site_id is not null and candidate.site_id < 0)
    or candidate.machine_authorization_time is null
    or candidate.amount_cents is null or candidate.amount_cents <= 0
    or candidate.currency_code <> 'USD' then
    raise exception 'This Nayax transaction does not contain safe refundable evidence'
      using errcode = 'P4604';
  end if;
  if manual_portal_candidate and not exists (
    select 1
    from public.refund_manual_nayax_evidence evidence
    join public.reporting_machines machine
      on machine.id = evidence.reporting_machine_id
    where evidence.candidate_token = candidate.token
      and evidence.refund_case_id = refund_case.id
      and evidence.reporting_machine_id = candidate_machine_id
      and evidence.actor_user_id = p_actor_user_id
      and evidence.provider_transaction_id = candidate.provider_transaction_id
      and evidence.machine_authorization_time = candidate.machine_authorization_time
      and evidence.amount_cents = candidate.amount_cents
      and evidence.card_last4 = candidate.card_last4
      and evidence.selected_at is null
      and machine.nayax_manual_portal_enabled = true
      and machine.nayax_manual_account_scope = evidence.account_scope
      and machine.nayax_refunds_enabled = false
      and machine.nayax_machine_id is null
      and machine.nayax_account_key is null
  ) then
    raise exception 'Manual Nayax portal evidence changed and must be reviewed again'
      using errcode = 'P4604';
  end if;
  if exists (
    select 1 from public.refund_cases duplicate_case
    where duplicate_case.id <> refund_case.id
      and duplicate_case.matched_nayax_transaction_id = candidate.provider_transaction_id
  ) then
    raise exception 'This Nayax transaction is already linked to another refund case'
      using errcode = '23505';
  end if;

  recommendation_state := coalesce(
    nullif(btrim(candidate.evidence_summary ->> 'recommendation_state'), ''),
    'manual_exception'
  );
  policy_version := nullif(btrim(candidate.evidence_summary ->> 'policy_version'), '');
  if policy_version is null then
    raise exception 'This Nayax transaction is missing versioned recommendation evidence'
      using errcode = 'P4604';
  end if;
  one_click_eligible := not manual_portal_candidate
    and recommendation_state = 'high_confidence'
    and candidate_recommended
    and candidate.evidence_summary ->> 'one_click_eligible' = 'true';

  update public.refund_cases
  set
    reporting_machine_id = candidate_machine_id,
    status = 'needs_review',
    decision = null,
    decision_reason = null,
    decided_by = null,
    decided_at = null,
    refund_amount_cents = candidate.amount_cents,
    matched_nayax_transaction_id = candidate.provider_transaction_id,
    matched_nayax_site_id = candidate.site_id,
    matched_nayax_machine_auth_time = candidate.machine_authorization_time,
    matched_nayax_amount_cents = candidate.amount_cents,
    matched_nayax_card_last4 = candidate.card_last4,
    matched_nayax_currency_code = candidate.currency_code,
    correlation_status = 'matched',
    correlation_source = 'nayax',
    correlation_confidence = 0,
    correlation_summary = case
      when manual_portal_candidate then
        'Machine Manager confirmed exact transaction evidence entered from the Nayax portal. Manual refund approval is still required.'
      else 'Machine Manager confirmed the selected Nayax transaction.'
    end,
    nayax_recommendation_state = recommendation_state,
    nayax_recommendation_policy_version = policy_version,
    nayax_recommendation_evaluated_at = statement_timestamp(),
    nayax_match_execution_eligible = one_click_eligible
  where id = refund_case.id
  returning * into updated_case;

  if manual_portal_candidate then
    update public.refund_manual_nayax_evidence
    set selected_at = statement_timestamp()
    where candidate_token = candidate.token
      and selected_at is null;
  end if;

  insert into public.refund_case_events (
    refund_case_id, actor_user_id, event_type, message, metadata
  ) values (
    refund_case.id,
    p_actor_user_id,
    'nayax_match_selected',
    case when manual_portal_candidate then
      'Machine Manager confirmed the exact Nayax portal transaction. No refund, approval, reporting, or customer email occurred.'
    when candidate_recommended
      then 'Machine Manager confirmed the recommended Nayax transaction.'
      else 'Machine Manager confirmed an alternate Nayax transaction after review.'
    end,
    jsonb_build_object(
      'policy_version', policy_version,
      'recommendation_state', recommendation_state,
      'confidence_class', coalesce(
        nullif(btrim(candidate.evidence_summary ->> 'confidence_class'), ''),
        'ambiguous_manual'
      ),
      'reason_codes', coalesce(candidate.evidence_summary -> 'reason_codes', '[]'::jsonb),
      'selected_recommended', candidate_recommended,
      'selected_rank', case
        when coalesce(candidate.evidence_summary ->> 'recommendation_rank', '') ~ '^[0-9]+$'
          then (candidate.evidence_summary ->> 'recommendation_rank')::integer
        else null
      end,
      'disagreement_reason_code', case when candidate_recommended
        then null else normalized_disagreement_reason end,
      'execution_eligible', one_click_eligible,
      'manual_portal_candidate', manual_portal_candidate,
      'provider_call_made', false,
      'customer_message_created', false,
      'exact_machine_bound_from_grouped_scope', refund_case.reporting_machine_id is null,
      'payload_redacted', true
    )
  );

  return to_jsonb(updated_case) || jsonb_build_object(
    'selectionApplied', true,
    'transactionConfirmed', true,
    'refundReadiness', public.refund_case_nayax_manager_readiness(
      p_actor_user_id,
      updated_case.id
    )
  );
end;
$$;

revoke execute on function public.service_select_refund_nayax_candidate_as_actor(
  uuid, uuid, bigint, uuid, text
) from public, anon, authenticated;
grant execute on function public.service_select_refund_nayax_candidate_as_actor(
  uuid, uuid, bigint, uuid, text
) to service_role;

select pg_notify('pgrst', 'reload schema');
