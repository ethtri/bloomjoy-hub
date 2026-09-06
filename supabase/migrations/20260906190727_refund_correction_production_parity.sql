-- Repair the production correction-scope mismatch where a current wallet case
-- already establishes device-token provenance but a refresh-only v11 candidate
-- still offers only the generic last-four-source question. This wrapper changes
-- customer-question derivation only; candidate selection and payment functions
-- continue to enforce their existing freshness and safety contracts.

alter function public.refund_purchase_correction_request_fields(uuid)
  rename to refund_purchase_correction_request_fields_pre_production_parity;

revoke all on function public.refund_purchase_correction_request_fields_pre_production_parity(uuid)
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
  reasons text[];
  candidate_count integer := 0;
  include_incident_time boolean := false;
begin
  fields := public.refund_purchase_correction_request_fields_pre_production_parity(p_case_id);

  select * into case_row
  from public.refund_cases
  where id = p_case_id;

  -- Stay narrowly bound to the demonstrated production shape. The retained
  -- function remains authoritative for every other case and candidate state.
  if case_row.id is null
    or case_row.decision is not null
    or case_row.payment_method is distinct from 'card'
    or case_row.payment_interaction is distinct from 'phone_watch_wallet'
    or case_row.card_wallet_used is distinct from true
    or case_row.card_last4_provenance is distinct from 'wallet_device_token'
    or case_row.card_last4 is null
    or case_row.card_last4_source is not null
    or public.canonical_refund_follow_up_fields(fields)
      is distinct from array['card_last4_source']::text[] then
    return public.canonical_refund_follow_up_fields(fields);
  end if;

  -- This source question is redundant from current case facts regardless of
  -- lookup lifecycle. Remove it before every fallback so a completed Not-sure
  -- response cannot reopen the same customer-contact loop after the submit
  -- path invalidates its prior recommendation and candidates.
  fields := array_remove(fields, 'card_last4_source');

  -- An internal lookup refresh never becomes a customer question. Returning an
  -- empty scope also makes the message-enqueue guard reject the action.
  if case_row.nayax_lookup_status = 'checking' then
    return '{}'::text[];
  end if;
  if case_row.nayax_recommendation_state is distinct from 'manual_exception'
    or case_row.nayax_lookup_status is distinct from 'manual_exception' then
    return public.canonical_refund_follow_up_fields(fields);
  end if;

  select count(*) into candidate_count
  from public.refund_nayax_lookup_candidates candidate
  where candidate.refund_case_id = case_row.id
    and candidate.lookup_generation = case_row.nayax_lookup_generation
    and candidate.expires_at > statement_timestamp();

  select candidate.* into candidate_row
  from public.refund_nayax_lookup_candidates candidate
  where candidate.refund_case_id = case_row.id
    and candidate.lookup_generation = case_row.nayax_lookup_generation
    and candidate.expires_at > statement_timestamp()
  order by (candidate.evidence_summary ->> 'is_top_ranked' = 'true') desc nulls last,
    candidate.created_at desc
  limit 1;

  evidence := candidate_row.evidence_summary;
  if candidate_row.token is null then
    return '{}'::text[];
  end if;
  if evidence ->> 'policy_version' is distinct from '2026-09-05.v11'
    or evidence ->> 'is_top_ranked' is distinct from 'true'
    or evidence ->> 'identifier_review_state' is distinct from 'exact_support' then
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
    return '{}'::text[];
  end if;
  if evidence -> 'customer_correction_fields' is distinct from '[]'::jsonb then
    return public.canonical_refund_follow_up_fields(fields);
  end if;

  -- The interaction and suffix provenance independently agree that the
  -- customer-provided suffix is a wallet device token. Ask only unresolved
  -- current case facts that can distinguish nearby purchases; never infer or
  -- persist a card source from this read.
  select coalesce(array_agg(value), '{}') into reasons
  from jsonb_array_elements_text(
    coalesce(evidence -> 'reason_codes', '[]'::jsonb)
      || coalesce(evidence -> 'manual_review_reasons', '[]'::jsonb)
  );
  include_incident_time := (
      case_row.incident_time_confidence = 'rough'
      or case_row.incident_time_resolution is null
      or case_row.incident_time_resolution not in ('exact', 'legacy_absolute')
    ) and reasons && array[
      'customer_time_rough', 'transaction_occurrence_time_uncertain'
    ]::text[];
  if include_incident_time then
    fields := array_append(fields, 'incident_time');
  end if;
  if include_incident_time and (case_row.incident_time_source is null
    or case_row.incident_time_source = 'unknown') then
    fields := array_append(fields, 'incident_time_source');
  end if;
  if (case_row.card_network is null or case_row.card_network = 'other_unknown')
    and 'customer_card_network_unknown' = any(reasons) then
    fields := array_append(fields, 'card_network');
  end if;
  if candidate_count > 1 and (case_row.nearby_attempt_count is null
    or case_row.nearby_attempt_count = 'unknown') then
    fields := array_append(fields, 'nearby_attempt_count');
  end if;

  -- A submitted "Not sure" is complete while the relevant case facts and
  -- payment context remain unchanged, matching the retained wrapper contract.
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
  'Returns the current structured same-case correction scope. Checking, stale, and refresh-only evidence is customer-silent. A valid refreshed exact-support v11 wallet generation with an empty candidate-authored scope replaces a redundant generic device-token-source question with unresolved current facts that discriminate its candidate set; all selection and payment gates remain unchanged.';
