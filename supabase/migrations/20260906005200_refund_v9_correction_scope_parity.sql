-- Keep the same-case customer correction request aligned with the validated
-- v9 Nayax recommendation. Provider-only gaps and manager-reviewable
-- identifier uncertainty must not become repeated customer questions.

create or replace function public.refund_purchase_correction_request_fields(p_case_id uuid)
returns text[] language plpgsql stable security definer set search_path='' as $$
declare
  c public.refund_cases;
  selected_candidate public.refund_nayax_lookup_candidates%rowtype;
  fields text[];
  evidence jsonb;
  reasons text[];
  exclusions text[];
  v9_fields text[];
  candidate_count integer:=0;
  evidence_state text;
begin
  select * into c from public.refund_cases where id=p_case_id;
  if c.id is null or not public.refund_purchase_correction_eligible(c) then return '{}'::text[]; end if;
  fields:=case when c.decision='approved' then array['zelle_payment_contact']::text[] else public.refund_missing_follow_up_fields(c.id) end;
  if c.decision is null then
    if c.intake_selection_key is not null then fields:=array_remove(fields,'location_or_machine'); end if;
    if c.payment_method='card' and c.card_wallet_used then
      if c.card_last4 is null or c.card_last4_provenance is distinct from 'wallet_device_token' then fields:=array_append(fields,'card_last4'); end if;
      if c.card_last4_source is null or c.card_last4_source='unknown' then fields:=array_append(fields,'card_last4_source'); end if;
      if c.payment_interaction is distinct from 'phone_watch_wallet' then fields:=array_append(fields,'payment_interaction'); end if;
      if c.wallet_provider is null or c.wallet_provider='unsure' then fields:=array_append(fields,'wallet_provider'); end if;
      if c.wallet_device_kind is null or c.wallet_device_kind='unknown' then fields:=array_append(fields,'wallet_device_kind'); end if;
    end if;
    if c.nayax_recommendation_state in ('manual_exception','no_safe_match')
      and c.nayax_lookup_status in ('manual_exception','no_match')
      and c.nayax_recommendation_evaluated_at>=c.deterministic_facts_updated_at then
      select count(*) into candidate_count from public.refund_nayax_lookup_candidates candidate
        where candidate.refund_case_id=c.id and candidate.lookup_generation=c.nayax_lookup_generation
          and candidate.expires_at>statement_timestamp();
      select candidate.* into selected_candidate from public.refund_nayax_lookup_candidates candidate
        where candidate.refund_case_id=c.id and candidate.lookup_generation=c.nayax_lookup_generation
          and candidate.expires_at>statement_timestamp()
        order by (candidate.evidence_summary->>'is_top_ranked'='true') desc nulls last,candidate.created_at desc limit 1;
      evidence:=selected_candidate.evidence_summary;

      if evidence->>'policy_version'='2026-09-05.v9' then
        if evidence->>'is_top_ranked'='true' then
          evidence_state:=public.refund_nayax_candidate_identifier_evidence_state(
            selected_candidate.refund_case_id,selected_candidate.reporting_machine_id,
            selected_candidate.site_id,selected_candidate.machine_authorization_time,
            selected_candidate.amount_cents,selected_candidate.card_last4,
            selected_candidate.currency_code,evidence);
          if evidence_state='valid' and evidence->>'identifier_review_state'='needs_corroboration' then
            select coalesce(array_agg(value),'{}') into v9_fields
              from jsonb_array_elements_text(coalesce(evidence->'customer_correction_fields','[]'));
            fields:=fields||v9_fields;
          end if;
        end if;
      else
        select coalesce(array_agg(value),'{}') into reasons from jsonb_array_elements_text(
          coalesce(evidence->'reason_codes','[]')||coalesce(evidence->'manual_review_reasons','[]')||coalesce(evidence->'hard_exclusions','[]'));
        select coalesce(array_agg(value),'{}') into exclusions from jsonb_array_elements_text(coalesce(evidence->'hard_exclusions','[]'));
        if not reasons && array['already_refunded','currency_not_usd','duplicate_provider_record','duplicate_transaction','missing_amount_evidence',
          'missing_canonical_machine_mapping','missing_currency_evidence','missing_provider_card_last4','missing_provider_machine_id',
          'missing_provider_site_id','payment_not_approved','provider_machine_mismatch','provider_status_unconfirmed']::text[]
          and array_remove(exclusions,'card_last4_mismatch')='{}'::text[] then
          if 'card_last4_mismatch'=any(reasons) then
            fields:=array_append(fields,'card_last4');
            if c.payment_interaction is null or c.payment_interaction in ('unsure','insert_or_swipe') then fields:=array_append(fields,'payment_interaction'); end if;
            if c.card_last4_source is null or c.card_last4_source='unknown' then fields:=array_append(fields,'card_last4_source'); end if;
            if c.card_network is null or c.card_network='other_unknown' then fields:=array_append(fields,'card_network'); end if;
            if c.payment_interaction='phone_watch_wallet' then
              if c.wallet_provider is null or c.wallet_provider='unsure' then fields:=array_append(fields,'wallet_provider'); end if;
              if c.wallet_device_kind is null or c.wallet_device_kind='unknown' then fields:=array_append(fields,'wallet_device_kind'); end if;
            end if;
          end if;
          if reasons && array['amount_mismatch','amount_uncertain']::text[] then fields:=array_append(fields,'amount'); end if;
          if reasons && array['incident_time_too_far','customer_time_rough']::text[] then
            fields:=array_append(fields,'incident_time');
            if c.incident_time_source is null or c.incident_time_source='unknown' then fields:=array_append(fields,'incident_time_source'); end if;
          end if;
          if candidate_count>1 and (reasons && array['card_last4_mismatch','amount_mismatch','amount_uncertain','incident_time_too_far','customer_time_rough']::text[])
            then fields:=array_append(fields,'nearby_attempt_count'); end if;
        end if;
      end if;
    end if;
  end if;
  fields:=array(select unnest(fields) except select answer.key
    from public.refund_wallet_correction_contexts r cross join lateral jsonb_each(r.correction_response) answer
    where r.refund_case_id=c.id and r.status='submitted' and r.correction_kind='purchase'
      and public.refund_purchase_correction_values(c)->>answer.key is not distinct from coalesce(answer.value->>'value',r.correction_snapshot->>answer.key)
      and (answer.key not in ('card_last4','card_last4_source','wallet_provider','wallet_device_kind','card_network') or (
        public.refund_purchase_correction_values(c)->>'payment_method' is not distinct from r.correction_snapshot->>'payment_method'
        and public.refund_purchase_correction_values(c)->>'payment_interaction' is not distinct from r.correction_snapshot->>'payment_interaction')));
  return public.canonical_refund_follow_up_fields(fields);
end;
$$;

revoke all on function public.refund_purchase_correction_request_fields(uuid)
  from public, anon, authenticated;
grant execute on function public.refund_purchase_correction_request_fields(uuid)
  to service_role;

comment on function public.refund_purchase_correction_request_fields(uuid) is
  'Returns one canonical same-case correction scope. Valid current v9 Nayax evidence supplies only its explicit customer correction fields; manager-owned and provider-only gaps add no customer work. Known legacy evidence retains the prior compatibility path.';
