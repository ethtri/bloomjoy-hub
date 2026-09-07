-- Derive a same-case correction scope from current customer facts instead of
-- replaying a stale candidate-authored field list. The retained implementation
-- continues to own eligibility, evidence freshness, and prior-answer filtering;
-- this wrapper only reconciles a valid current v11 corroboration request.

alter function public.refund_purchase_correction_request_fields(uuid)
  rename to refund_purchase_correction_request_fields_pre_current_fact;

revoke all on function public.refund_purchase_correction_request_fields_pre_current_fact(uuid)
  from public, anon, authenticated, service_role;

create function public.refund_purchase_correction_request_fields(p_case_id uuid)
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  case_row public.refund_cases;
  candidate_row public.refund_nayax_lookup_candidates%rowtype;
  fields text[];
  evidence jsonb;
  evidence_state text;
  needs_scope_repair boolean;
begin
  fields := public.refund_purchase_correction_request_fields_pre_current_fact(p_case_id);

  select * into case_row
  from public.refund_cases
  where id = p_case_id;

  if case_row.id is null
    or case_row.decision is not null
    or case_row.nayax_recommendation_state not in ('manual_exception', 'no_safe_match')
    or case_row.nayax_lookup_status not in ('manual_exception', 'no_match')
    or case_row.nayax_recommendation_evaluated_at < case_row.deterministic_facts_updated_at then
    return public.canonical_refund_follow_up_fields(fields);
  end if;

  select candidate.* into candidate_row
  from public.refund_nayax_lookup_candidates candidate
  where candidate.refund_case_id = case_row.id
    and candidate.lookup_generation = case_row.nayax_lookup_generation
    and candidate.expires_at > statement_timestamp()
  order by (candidate.evidence_summary ->> 'is_top_ranked' = 'true') desc nulls last,
    candidate.created_at desc
  limit 1;

  evidence := candidate_row.evidence_summary;
  if candidate_row.token is null
    or evidence ->> 'policy_version' is distinct from '2026-09-05.v11'
    or evidence ->> 'is_top_ranked' is distinct from 'true'
    or evidence ->> 'identifier_review_state' is distinct from 'needs_corroboration' then
    return public.canonical_refund_follow_up_fields(fields);
  end if;

  evidence_state := public.refund_nayax_candidate_identifier_evidence_state(
    candidate_row.refund_case_id,
    candidate_row.reporting_machine_id,
    candidate_row.site_id,
    candidate_row.machine_authorization_time,
    candidate_row.amount_cents,
    candidate_row.card_last4,
    candidate_row.currency_code,
    evidence
  );
  if evidence_state is distinct from 'valid' then
    return public.canonical_refund_follow_up_fields(fields);
  end if;

  -- Values the case already states clearly are not useful customer questions.
  if case_row.card_last4_source is not null
    and case_row.card_last4_source <> 'unknown' then
    fields := array_remove(fields, 'card_last4_source');
  end if;
  if case_row.card_network is not null
    and case_row.card_network <> 'other_unknown' then
    fields := array_remove(fields, 'card_network');
  end if;
  if case_row.incident_time_source is not null
    and case_row.incident_time_source <> 'unknown' then
    fields := array_remove(fields, 'incident_time_source');
  end if;
  if case_row.nearby_attempt_count is not null
    and case_row.nearby_attempt_count <> 'unknown' then
    fields := array_remove(fields, 'nearby_attempt_count');
  end if;
  if case_row.payment_interaction not in ('unsure', 'insert_or_swipe') then
    fields := array_remove(fields, 'payment_interaction');
  end if;
  if case_row.incident_at is not null
    and case_row.incident_time_resolution in ('exact', 'legacy_absolute')
    and case_row.incident_time_confidence <> 'rough' then
    fields := array_remove(fields, 'incident_time');
  end if;

  -- Repair the stale candidate shape only when its settled questions would
  -- otherwise leave a dead end. Existing useful, validated scopes stay narrow.
  needs_scope_repair := cardinality(public.canonical_refund_follow_up_fields(fields)) = 0;
  if needs_scope_repair then
    if case_row.incident_time_confidence = 'rough'
      or case_row.incident_time_resolution is null
      or case_row.incident_time_resolution not in ('exact', 'legacy_absolute') then
      fields := array_append(fields, 'incident_time');
    end if;
    if case_row.incident_time_source is null
      or case_row.incident_time_source = 'unknown' then
      fields := array_append(fields, 'incident_time_source');
    end if;
    if case_row.nearby_attempt_count is null
      or case_row.nearby_attempt_count = 'unknown' then
      fields := array_append(fields, 'nearby_attempt_count');
    end if;
    if case_row.payment_method = 'card'
      and (case_row.card_network is null or case_row.card_network = 'other_unknown') then
      fields := array_append(fields, 'card_network');
    end if;
  end if;

  -- A submitted "Not sure" is a complete answer. Do not ask it again while
  -- the corresponding current fact and payment context remain unchanged.
  fields := array(
    select unnest(fields)
    except
    select answer.key
    from public.refund_wallet_correction_contexts response
    cross join lateral jsonb_each(response.correction_response) answer
    where response.refund_case_id = case_row.id
      and response.status = 'submitted'
      and response.correction_kind = 'purchase'
      and public.refund_purchase_correction_values(case_row) ->> answer.key
        is not distinct from coalesce(
          answer.value ->> 'value',
          response.correction_snapshot ->> answer.key
        )
      and (
        answer.key not in (
          'card_last4', 'card_last4_source', 'wallet_provider',
          'wallet_device_kind', 'card_network'
        )
        or (
          public.refund_purchase_correction_values(case_row) ->> 'payment_method'
            is not distinct from response.correction_snapshot ->> 'payment_method'
          and public.refund_purchase_correction_values(case_row) ->> 'payment_interaction'
            is not distinct from response.correction_snapshot ->> 'payment_interaction'
        )
      )
  );

  return public.canonical_refund_follow_up_fields(fields);
end;
$$;

revoke all on function public.refund_purchase_correction_request_fields(uuid)
  from public, anon, authenticated;
grant execute on function public.refund_purchase_correction_request_fields(uuid)
  to service_role;

comment on function public.refund_purchase_correction_request_fields(uuid) is
  'Returns one current-fact-derived same-case correction scope. Settled and already-answered fields are suppressed; a valid current Nayax corroboration scope that would otherwise become empty is repaired with useful unresolved purchase time, time source, card network, and nearby-attempt questions.';
