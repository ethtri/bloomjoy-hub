-- #1162: treat unproved card-identifier mismatches as evidence while retaining
-- exact transaction, payment, duplicate, request-time, and stale-fact guards.

create or replace function public.refund_nayax_request_boundary_evidence_state(
  p_request_received_at timestamptz,
  p_request_received_source text,
  p_evidence jsonb
)
returns text language plpgsql immutable set search_path = '' as $$
declare
  authorized_at timestamptz;
  comparable boolean;
begin
  if p_evidence ->> 'source' = 'manual_nayax_portal' then return 'manual'; end if;
  if coalesce(p_evidence ->> 'policy_version', '') not in ('2026-09-05.v8', '2026-09-05.v9') then
    return case when p_request_received_at is null then 'legacy' else 'refresh' end;
  end if;
  if p_request_received_at is null then
    if p_evidence -> 'customer_request_received_at' = 'null'::jsonb
      and p_evidence -> 'customer_request_received_source' = 'null'::jsonb
      and p_evidence ->> 'request_time_boundary' = 'request_time_unknown'
      and p_evidence ->> 'one_click_eligible' = 'false' then return 'valid'; end if;
    return 'invalid';
  end if;
  if p_request_received_source not in ('hosted_refund_intake', 'gmail_contact_ingested')
    or jsonb_typeof(p_evidence -> 'customer_request_received_at') is distinct from 'string'
    or jsonb_typeof(p_evidence -> 'customer_request_received_source') is distinct from 'string'
    or p_evidence ->> 'customer_request_received_source' is distinct from p_request_received_source then
    return 'invalid';
  end if;
  begin
    if (p_evidence ->> 'customer_request_received_at')::timestamptz is distinct from p_request_received_at then
      return 'invalid';
    end if;
  exception when invalid_datetime_format or datetime_field_overflow then return 'invalid'; end;

  comparable := coalesce((p_evidence ->> 'transaction_occurrence_comparable')::boolean, false);
  if not comparable then
    if p_evidence ->> 'request_time_boundary' = 'occurrence_time_uncertain'
      and p_evidence ->> 'one_click_eligible' = 'false' then return 'valid'; end if;
    return 'invalid';
  end if;
  if p_evidence ->> 'provider_time_resolution' is distinct from 'exact'
    or coalesce(p_evidence ->> 'provider_time_source', '') not in (
      'authorization_gmt', 'machine_authorization_offset', 'verified_machine_clock'
    )
    or jsonb_typeof(p_evidence -> 'authorized_at') is distinct from 'string' then
    return 'invalid';
  end if;
  begin authorized_at := (p_evidence ->> 'authorized_at')::timestamptz;
  exception when invalid_datetime_format or datetime_field_overflow then return 'invalid'; end;
  if authorized_at > p_request_received_at then return 'after_request'; end if;
  if p_evidence ->> 'request_time_boundary' is distinct from 'before_or_at_request' then
    return 'invalid';
  end if;
  return 'valid';
exception when invalid_text_representation then return 'invalid';
end;
$$;
revoke all on function public.refund_nayax_request_boundary_evidence_state(timestamptz,text,jsonb)
  from public, anon, authenticated;

create function public.refund_nayax_identifier_evidence_state(
  p_fact_version bigint,
  p_payment_interaction text,
  p_card_last4_provenance text,
  p_card_last4_source text,
  p_wallet_device_kind text,
  p_nearby_attempt_count text,
  p_evidence jsonb
)
returns text language plpgsql immutable set search_path = '' as $$
declare
  hard_exclusion text;
  corroborator text;
  selection_allowed boolean;
  core_eligible boolean;
  one_click_eligible boolean;
begin
  if p_evidence ->> 'source' = 'manual_nayax_portal' then return 'manual'; end if;
  if p_evidence ->> 'policy_version' = '2026-09-05.v8' then return 'legacy'; end if;
  if p_evidence ->> 'policy_version' is distinct from '2026-09-05.v9'
    or p_evidence ->> 'identifier_policy_version' is distinct from '2026-09-05.identifier.v1'
    or jsonb_typeof(p_evidence -> 'deterministic_fact_version') is distinct from 'number'
    or (p_evidence ->> 'deterministic_fact_version')::bigint is distinct from p_fact_version
    or p_evidence ->> 'customer_payment_interaction' is distinct from coalesce(p_payment_interaction, 'unsure')
    or p_evidence ->> 'customer_card_last4_source' is distinct from coalesce(p_card_last4_source, 'unknown')
    or p_evidence ->> 'customer_card_last4_provenance' is distinct from p_card_last4_provenance
    or p_evidence ->> 'customer_wallet_device_kind' is distinct from p_wallet_device_kind
    or p_evidence ->> 'customer_nearby_attempt_count' is distinct from coalesce(p_nearby_attempt_count, 'unknown')
    or coalesce(p_evidence ->> 'provider_identifier_semantics', '') not in (
      'swipe_pan_unproven','chip_application_pan_unproven',
      'contactless_chip_application_pan_unproven','wallet_device_token_unproven',
      'provider_token_unproven','contactless_identifier_unknown','provider_identifier_unknown'
    )
    or coalesce(p_evidence ->> 'identifier_comparison_class', '') not in (
      'match','negative','neutral','internal_review','unavailable'
    )
    or jsonb_typeof(p_evidence -> 'provider_token_field_present') is distinct from 'boolean'
    or p_evidence ->> 'same_identifier_invariant' is distinct from 'false'
    or jsonb_typeof(p_evidence -> 'hard_exclusions') is distinct from 'array'
    or jsonb_typeof(p_evidence -> 'manager_corroboration_codes') is distinct from 'array'
    or jsonb_typeof(p_evidence -> 'selection_allowed') is distinct from 'boolean'
    or jsonb_typeof(p_evidence -> 'manager_review_core_eligible') is distinct from 'boolean'
    or jsonb_typeof(p_evidence -> 'one_click_eligible') is distinct from 'boolean' then
    return 'invalid';
  end if;

  for hard_exclusion in select value from jsonb_array_elements_text(p_evidence -> 'hard_exclusions') loop
    if hard_exclusion in ('card_last4_mismatch','card_network_mismatch') then return 'invalid'; end if;
  end loop;
  for corroborator in select value from jsonb_array_elements_text(p_evidence -> 'manager_corroboration_codes') loop
    if corroborator not in (
      'card_last4_match','card_network_match','verified_qr_time','customer_reports_one_nearby_attempt'
    ) then return 'invalid'; end if;
  end loop;

  selection_allowed := (p_evidence ->> 'selection_allowed')::boolean;
  core_eligible := (p_evidence ->> 'manager_review_core_eligible')::boolean;
  one_click_eligible := (p_evidence ->> 'one_click_eligible')::boolean;
  if selection_allowed and (
    not core_eligible
    or jsonb_array_length(p_evidence -> 'manager_corroboration_codes') = 0
    or p_evidence ->> 'selection_block_reason' is not null
  ) then return 'invalid'; end if;
  if not selection_allowed and coalesce(p_evidence ->> 'selection_block_reason', '') not in (
    'hard_safety_stop','exact_core_evidence_required','independent_corroboration_required'
  ) then return 'invalid'; end if;
  if one_click_eligible and (
    not selection_allowed
    or p_evidence ->> 'identifier_comparison_class' is distinct from 'match'
    or p_evidence ->> 'customer_payment_interaction' = 'phone_watch_wallet'
    or p_evidence ->> 'provider_identifier_semantics' in (
      'wallet_device_token_unproven','contactless_identifier_unknown','provider_token_unproven'
    )
  ) then return 'invalid'; end if;
  return 'valid';
exception when invalid_text_representation or numeric_value_out_of_range then return 'invalid';
end;
$$;
revoke all on function public.refund_nayax_identifier_evidence_state(bigint,text,text,text,text,text,jsonb)
  from public, anon, authenticated;

create function public.guard_refund_nayax_candidate_identifier_evidence()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  case_row public.refund_cases%rowtype;
  evidence_state text;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('refund-nayax-lookup-v1|' || new.refund_case_id::text, 0)
  );
  select c.* into case_row from public.refund_cases c where c.id = new.refund_case_id for update;
  if not found then raise exception 'Refund case not found' using errcode = 'P4600'; end if;
  evidence_state := public.refund_nayax_identifier_evidence_state(
    case_row.deterministic_fact_version, case_row.payment_interaction,
    case_row.card_last4_provenance, case_row.card_last4_source,
    case_row.wallet_device_kind, case_row.nearby_attempt_count, new.evidence_summary
  );
  if evidence_state = 'invalid' then
    raise exception 'Invalid or stale Nayax identifier evidence' using errcode = 'P4626';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_refund_nayax_candidate_identifier_evidence()
  from public, anon, authenticated;
create trigger zzx_refund_nayax_candidate_identifier_evidence
before insert on public.refund_nayax_lookup_candidates for each row
execute function public.guard_refund_nayax_candidate_identifier_evidence();

alter function public.service_select_refund_nayax_candidate_as_actor(uuid,uuid,bigint,uuid,text)
  rename to service_select_refund_nayax_candidate_as_actor_pre_identifier_evidence_v1;
revoke all on function public.service_select_refund_nayax_candidate_as_actor_pre_identifier_evidence_v1(uuid,uuid,bigint,uuid,text)
  from public, anon, authenticated;

create function public.service_select_refund_nayax_candidate_as_actor(
  p_actor_user_id uuid,
  p_case_id uuid,
  p_expected_case_version bigint,
  p_candidate_token uuid,
  p_nayax_disagreement_reason text default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  case_row public.refund_cases%rowtype;
  candidate_row public.refund_nayax_lookup_candidates%rowtype;
  evidence_state text;
  result jsonb;
begin
  select c.* into case_row from public.refund_cases c where c.id = p_case_id for update;
  if not found then raise exception 'Refund case not found' using errcode = 'P4600'; end if;
  select candidate.* into candidate_row from public.refund_nayax_lookup_candidates candidate
  where candidate.token = p_candidate_token and candidate.refund_case_id = case_row.id for share;
  if not found then
    raise exception 'Nayax lookup evidence expired or belongs to another review session' using errcode = 'P4602';
  end if;
  evidence_state := public.refund_nayax_identifier_evidence_state(
    case_row.deterministic_fact_version, case_row.payment_interaction,
    case_row.card_last4_provenance, case_row.card_last4_source,
    case_row.wallet_device_kind, case_row.nearby_attempt_count, candidate_row.evidence_summary
  );
  if evidence_state = 'invalid' then
    raise exception 'Nayax identifier evidence is stale or invalid; refresh transactions' using errcode = 'P4626';
  end if;

  result := public.service_select_refund_nayax_candidate_as_actor_pre_identifier_evidence_v1(
    p_actor_user_id, p_case_id, p_expected_case_version,
    p_candidate_token, p_nayax_disagreement_reason
  );

  if evidence_state = 'legacy' then return result; end if;

  insert into public.refund_case_events(refund_case_id,actor_user_id,event_type,message,metadata)
  values (p_case_id,p_actor_user_id,'nayax_identifier_evidence_selected',
    'Machine Manager selected the exact Nayax transaction under the identifier-evidence policy.',
    jsonb_build_object(
      'policy_version',candidate_row.evidence_summary ->> 'policy_version',
      'identifier_policy_version',candidate_row.evidence_summary ->> 'identifier_policy_version',
      'deterministic_fact_version',case_row.deterministic_fact_version,
      'provider_identifier_semantics',candidate_row.evidence_summary ->> 'provider_identifier_semantics',
      'identifier_comparison_class',candidate_row.evidence_summary ->> 'identifier_comparison_class',
      'manager_corroboration_codes',candidate_row.evidence_summary -> 'manager_corroboration_codes',
      'exact_provider_transaction_bound',true,
      'payload_redacted',true
    ));
  return result;
end;
$$;
revoke all on function public.service_select_refund_nayax_candidate_as_actor(uuid,uuid,bigint,uuid,text)
  from public, anon, authenticated;
grant execute on function public.service_select_refund_nayax_candidate_as_actor(uuid,uuid,bigint,uuid,text)
  to service_role;

comment on function public.service_select_refund_nayax_candidate_as_actor(uuid,uuid,bigint,uuid,text) is
  'Service-only exact transaction selection. Current customer facts, identifier semantics, independent corroboration, request time, manager authority, duplicate state, and payment safety are revalidated before selection.';

select pg_notify('pgrst','reload schema');
