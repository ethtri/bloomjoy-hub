-- Persist a mapped manager's reviewed Nayax candidate without treating evidence
-- selection as an official refund decision or provider action.

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
  normalized_disagreement_reason text := lower(btrim(coalesce(p_nayax_disagreement_reason, '')));
  candidate_recommended boolean := false;
  candidate_selection_allowed boolean := false;
  recommendation_state text;
  policy_version text;
  one_click_eligible boolean := false;
  updated_case public.refund_cases%rowtype;
begin
  if p_actor_user_id is null or p_case_id is null or p_candidate_token is null then
    raise exception 'Actor, refund case, and Nayax candidate are required';
  end if;

  select case_row.*
  into refund_case
  from public.refund_cases case_row
  where case_row.id = p_case_id
  for update;

  if not found then
    raise exception 'Refund case not found';
  end if;

  if not public.can_perform_refund_official_action(p_actor_user_id, refund_case.id) then
    raise exception 'Active Machine Manager mapping required; admin identities are review-only';
  end if;

  if refund_case.official_action_version is distinct from p_expected_case_version then
    raise exception 'Refund case changed since review; reload before selecting a transaction';
  end if;

  if refund_case.payment_method <> 'card'
    or refund_case.status <> 'needs_review'
    or refund_case.decision is not null
    or refund_case.nayax_refund_execution_status <> 'not_requested'
    or refund_case.reporting_adjustment_id is not null
    or refund_case.refund_completed_at is not null
    or public.refund_case_has_unresolved_reconciliation(refund_case.id) then
    raise exception 'This refund case is not safe for Nayax evidence selection';
  end if;

  select lookup_candidate.*
  into candidate
  from public.refund_nayax_lookup_candidates lookup_candidate
  where lookup_candidate.token = p_candidate_token
    and lookup_candidate.refund_case_id = refund_case.id
    and lookup_candidate.actor_user_id = p_actor_user_id
    and lookup_candidate.expires_at > statement_timestamp()
  for share;

  if not found then
    raise exception 'Nayax lookup evidence expired or belongs to another review session';
  end if;

  candidate_selection_allowed := candidate.evidence_summary ->> 'selection_allowed' = 'true';
  candidate_recommended := candidate.evidence_summary ->> 'is_recommended' = 'true';

  if not candidate_selection_allowed then
    raise exception 'This Nayax transaction has a safety block and cannot be selected';
  end if;

  if not candidate_recommended
    and normalized_disagreement_reason not in (
      'closer_time',
      'correct_amount',
      'correct_card',
      'customer_confirmation',
      'provider_data_issue',
      'other_review_reason'
    ) then
    raise exception 'Choose why this alternate Nayax transaction is the correct one';
  end if;

  if not public.is_review_safe_nayax_transaction_reference(candidate.provider_transaction_id)
    or candidate.site_id is null
    or candidate.site_id < 0
    or candidate.machine_authorization_time is null
    or candidate.amount_cents is null
    or candidate.amount_cents <= 0
    or candidate.currency_code <> 'USD' then
    raise exception 'This Nayax transaction does not contain safe refundable evidence';
  end if;

  if exists (
    select 1
    from public.refund_cases duplicate_case
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
    raise exception 'This Nayax transaction is missing versioned recommendation evidence';
  end if;

  one_click_eligible := recommendation_state = 'high_confidence'
    and candidate_recommended
    and candidate.evidence_summary ->> 'one_click_eligible' = 'true';

  update public.refund_cases
  set
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
      when one_click_eligible
        then 'Machine Manager confirmed the recommended Nayax transaction using versioned evidence.'
      else 'Machine Manager selected a Nayax transaction for manual review; one-click execution remains unavailable.'
    end,
    nayax_recommendation_state = recommendation_state,
    nayax_recommendation_policy_version = policy_version,
    nayax_recommendation_evaluated_at = statement_timestamp(),
    nayax_match_execution_eligible = one_click_eligible
  where id = refund_case.id
  returning * into updated_case;

  insert into public.refund_case_events (
    refund_case_id,
    actor_user_id,
    event_type,
    message,
    metadata
  )
  values (
    refund_case.id,
    p_actor_user_id,
    'nayax_match_selected',
    case
      when candidate_recommended then 'Machine Manager confirmed the recommended Nayax transaction.'
      else 'Machine Manager selected an alternate Nayax transaction after review.'
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
      'disagreement_reason_code', case
        when candidate_recommended then null
        else normalized_disagreement_reason
      end,
      'execution_eligible', one_click_eligible,
      'payload_redacted', true
    )
  );

  return to_jsonb(updated_case);
end;
$$;

revoke execute on function public.service_select_refund_nayax_candidate_as_actor(
  uuid, uuid, bigint, uuid, text
) from public, anon, authenticated;
grant execute on function public.service_select_refund_nayax_candidate_as_actor(
  uuid, uuid, bigint, uuid, text
) to service_role;

comment on function public.service_select_refund_nayax_candidate_as_actor(
  uuid, uuid, bigint, uuid, text
) is
  'Service-only, non-financial candidate-selection boundary. It requires an exact mapped manager, immutable actor-bound lookup evidence, and a fresh case version while leaving the case undecided in needs_review.';

select pg_notify('pgrst', 'reload schema');
