-- Evidence-aware Nayax matching keeps identifier mismatches visible and
-- reviewable without weakening exact transaction, request-time, or duplicate
-- guards. Last Sales identifier semantics are explicitly unproved.

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
  if coalesce(p_evidence ->> 'policy_version', '') not in ('2026-09-05.v8','2026-09-05.v9') then
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
  p_case_fact_version bigint,
  p_evidence jsonb
)
returns text language plpgsql immutable set search_path = '' as $$
declare
  correction_field jsonb;
  hard_exclusions jsonb := coalesce(p_evidence -> 'hard_exclusions', '[]'::jsonb);
  last4_comparison text := p_evidence ->> 'card_last4_comparison';
  network_comparison text := p_evidence ->> 'card_network_comparison';
  interaction_comparison text := p_evidence ->> 'payment_interaction_comparison';
  review_state text := p_evidence ->> 'identifier_review_state';
  reason_codes jsonb := coalesce(p_evidence -> 'reason_codes', '[]'::jsonb);
  selection_allowed boolean;
  one_click boolean;
begin
  if p_evidence ->> 'source' = 'manual_nayax_portal' then return 'manual'; end if;
  if p_evidence ->> 'policy_version' is distinct from '2026-09-05.v9' then
    -- A current identifier-review object cannot evade v9 validation by
    -- changing its policy-version string. Older immutable lookup rows remain
    -- readable so migration/replay can preserve their audit trail, but only
    -- the known v8 shape retains the pre-v9 selection contract.
    if not (p_evidence ?| array[
        'identifier_policy_version','customer_fact_version','customer_credential_class',
        'provider_identifier_class','card_last4_comparison','card_network_comparison',
        'payment_interaction_comparison','same_identifier_equivalence_proven',
        'identifier_review_state','customer_correction_fields'
      ]) then
      if p_evidence ->> 'policy_version' = '2026-09-05.v8' then return 'legacy'; end if;
      return 'legacy_readonly';
    end if;
    return 'refresh';
  end if;
  if p_evidence ->> 'identifier_policy_version' is distinct from '2026-09-05.identifier.v1' then
    return 'refresh';
  end if;
  if p_case_fact_version is null or p_case_fact_version < 1
    or jsonb_typeof(p_evidence -> 'customer_fact_version') is distinct from 'number'
    or coalesce(p_evidence ->> 'customer_fact_version', '') !~ '^[1-9][0-9]*$'
    or (p_evidence ->> 'customer_fact_version')::bigint is distinct from p_case_fact_version then
    return 'stale';
  end if;
  if coalesce(p_evidence ->> 'customer_credential_class', '') not in (
      'customer_physical_swipe_pan','customer_physical_contact_chip_pan',
      'customer_physical_contactless_pan','customer_physical_card_interface_unknown',
      'customer_phone_wallet_token','customer_watch_wallet_token','customer_wallet_device_token',
      'customer_bank_record_identifier','customer_identifier_unknown'
    )
    or coalesce(p_evidence ->> 'provider_identifier_class', '') not in (
      'last_sales_swipe_identifier_unverified','last_sales_chip_identifier_unverified',
      'last_sales_contactless_identifier_unverified','last_sales_wallet_identifier_unverified',
      'last_sales_present_identifier_unverified','last_sales_identifier_unknown'
    )
    or coalesce(last4_comparison, '') not in (
      'exact_support','missing','mismatch_neutral_unproven_scope','mismatch_negative_unproven_equivalence'
    )
    or coalesce(network_comparison, '') not in (
      'exact_support','missing','mismatch_neutral_unproven_scope','mismatch_negative_unproven_equivalence'
    )
    or coalesce(interaction_comparison, '') not in (
      'supporting','unknown','conflict_unverified_provider_semantics'
    )
    or coalesce(review_state, '') not in (
      'exact_support','no_identifier_conflict','reviewable_uncertainty',
      'needs_corroboration','blocked_safety'
    )
    or p_evidence ->> 'same_identifier_equivalence_proven' is distinct from 'false'
    or jsonb_typeof(hard_exclusions) is distinct from 'array'
    or jsonb_typeof(reason_codes) is distinct from 'array'
    or jsonb_typeof(coalesce(p_evidence -> 'customer_correction_fields', '[]'::jsonb)) is distinct from 'array' then
    return 'invalid';
  end if;
  if hard_exclusions ?| array['card_last4_mismatch','card_network_mismatch'] then
    return 'invalid';
  end if;
  for correction_field in select value from jsonb_array_elements(
    coalesce(p_evidence -> 'customer_correction_fields', '[]'::jsonb)
  ) loop
    if jsonb_typeof(correction_field) is distinct from 'string'
      or correction_field #>> '{}' not in (
        'amount','incident_time','payment_interaction','card_last4_source','card_network',
        'wallet_provider','wallet_device_kind','incident_time_source','nearby_attempt_count'
      ) then return 'invalid'; end if;
  end loop;
  begin
    selection_allowed := (p_evidence ->> 'selection_allowed')::boolean;
    one_click := (p_evidence ->> 'one_click_eligible')::boolean;
  exception when invalid_text_representation then return 'invalid'; end;
  if selection_allowed is null or one_click is null then return 'invalid'; end if;
  if selection_allowed and jsonb_array_length(hard_exclusions) <> 0 then return 'invalid'; end if;
  if review_state in ('blocked_safety','needs_corroboration') and selection_allowed then return 'invalid'; end if;
  if review_state = 'reviewable_uncertainty' and not selection_allowed then return 'invalid'; end if;
  if review_state = 'exact_support' and last4_comparison <> 'exact_support' then return 'invalid'; end if;
  if review_state = 'no_identifier_conflict' and last4_comparison <> 'missing' then return 'invalid'; end if;
  if review_state = 'reviewable_uncertainty'
    and last4_comparison not like 'mismatch_%'
    and network_comparison not like 'mismatch_%' then return 'invalid'; end if;
  if review_state = 'needs_corroboration'
    and jsonb_array_length(coalesce(p_evidence -> 'customer_correction_fields', '[]'::jsonb)) = 0
    and not (reason_codes ?| array['missing_provider_site_id','provider_status_unconfirmed']) then
    return 'invalid';
  end if;
  if (last4_comparison like 'mismatch_%' or network_comparison like 'mismatch_%') and one_click then
    return 'invalid';
  end if;
  if one_click and not selection_allowed then return 'invalid'; end if;
  if one_click and (
    review_state not in ('exact_support','no_identifier_conflict')
    or network_comparison like 'mismatch_%'
    or interaction_comparison = 'conflict_unverified_provider_semantics'
  ) then return 'invalid'; end if;
  return 'valid';
exception when invalid_text_representation or numeric_value_out_of_range then return 'invalid';
end;
$$;
revoke all on function public.refund_nayax_identifier_evidence_state(bigint,jsonb)
  from public, anon, authenticated;

create function public.refund_nayax_candidate_identifier_evidence_state(
  p_case_id uuid,
  p_reporting_machine_id uuid,
  p_site_id integer,
  p_machine_authorization_time timestamptz,
  p_amount_cents integer,
  p_card_last4 text,
  p_currency_code text,
  p_evidence jsonb
)
returns text language plpgsql stable set search_path = '' as $$
declare
  case_row public.refund_cases%rowtype;
  machine_row public.reporting_machines%rowtype;
  evidence_state text;
  evidence_authorized_at timestamptz;
  expected_amount_delta integer;
  expected_time_delta integer;
  evidence_amount_delta integer;
  evidence_time_delta integer;
  boundary_state text;
  selection_allowed boolean;
  duplicate_provider_record boolean;
  expected_customer_credential text;
  mismatch_present boolean;
  expected_machine_in_scope boolean;
  expected_selection_allowed boolean;
begin
  select c.* into case_row from public.refund_cases c where c.id = p_case_id;
  if not found then return 'invalid'; end if;
  evidence_state := public.refund_nayax_identifier_evidence_state(
    case_row.deterministic_fact_version, p_evidence
  );
  if evidence_state = 'legacy' then
    boundary_state := public.refund_nayax_request_boundary_evidence_state(
      case_row.customer_request_received_at,case_row.customer_request_received_source,p_evidence
    );
    if boundary_state = 'refresh' or boundary_state = 'invalid' then return 'refresh'; end if;
    return 'legacy';
  end if;
  if evidence_state <> 'valid' then return evidence_state; end if;
  select m.* into machine_row from public.reporting_machines m where m.id = p_reporting_machine_id;
  if not found then return 'invalid'; end if;

  begin
    evidence_authorized_at := (p_evidence ->> 'authorized_at')::timestamptz;
    selection_allowed := (p_evidence ->> 'selection_allowed')::boolean;
    duplicate_provider_record := (p_evidence ->> 'duplicate_provider_record')::boolean;
    expected_amount_delta := case when p_amount_cents is not null and case_row.payment_amount_cents is not null
      then abs(p_amount_cents - case_row.payment_amount_cents) else null end;
    expected_time_delta := ceil(abs(extract(epoch from
      (p_machine_authorization_time - case_row.incident_at))) / 60.0)::integer;
    expected_customer_credential := case
      when case_row.payment_interaction = 'phone_watch_wallet'
        or case_row.card_last4_source = 'wallet_device'
        or case_row.card_last4_provenance = 'wallet_device_token'
      then case case_row.wallet_device_kind when 'phone' then 'customer_phone_wallet_token'
        when 'watch' then 'customer_watch_wallet_token' else 'customer_wallet_device_token' end
      when case_row.card_last4_source = 'bank_record' then 'customer_bank_record_identifier'
      when case_row.card_last4_source = 'physical_card'
        or case_row.card_last4_provenance = 'physical_card'
      then case case_row.payment_interaction when 'swipe_card' then 'customer_physical_swipe_pan'
        when 'insert_card' then 'customer_physical_contact_chip_pan'
        when 'tap_card' then 'customer_physical_contactless_pan'
        else 'customer_physical_card_interface_unknown' end
      else 'customer_identifier_unknown' end;
  exception when invalid_text_representation or invalid_datetime_format
    or datetime_field_overflow or numeric_value_out_of_range then return 'invalid'; end;

  if expected_amount_delta is null then
    if p_evidence -> 'amount_delta_cents' is distinct from 'null'::jsonb then return 'invalid'; end if;
  else
    if coalesce(p_evidence ->> 'amount_delta_cents', '') !~ '^\d+$' then return 'invalid'; end if;
    evidence_amount_delta := (p_evidence ->> 'amount_delta_cents')::integer;
    if evidence_amount_delta is distinct from expected_amount_delta then return 'invalid'; end if;
  end if;
  if coalesce(p_evidence ->> 'time_delta_minutes', '') !~ '^\d+$' then return 'invalid'; end if;
  evidence_time_delta := (p_evidence ->> 'time_delta_minutes')::integer;
  if evidence_time_delta is distinct from expected_time_delta then return 'invalid'; end if;
  if case_row.card_last4 is null or p_card_last4 is null then
    if p_evidence ->> 'card_last4_comparison' is distinct from 'missing' then return 'invalid'; end if;
  elsif case_row.card_last4 = p_card_last4 then
    if p_evidence ->> 'card_last4_comparison' is distinct from 'exact_support' then return 'invalid'; end if;
  elsif p_evidence ->> 'card_last4_comparison' not like 'mismatch_%' then
    return 'invalid';
  end if;

  -- Reconcile scorer claims to immutable candidate columns and current case
  -- facts. Provider-record arrival time is deliberately absent: only the
  -- transaction occurrence is compared.
  if p_machine_authorization_time is null
    or p_evidence ->> 'lookup_account_scope' is distinct from
      regexp_replace(upper(btrim(machine_row.nayax_account_key)), '[^A-Z0-9_]', '_', 'g')
    or p_evidence ->> 'lookup_provider_machine_id' is distinct from machine_row.nayax_machine_id
    or p_evidence ->> 'customer_credential_class' is distinct from expected_customer_credential
    or evidence_authorized_at is distinct from p_machine_authorization_time
    or duplicate_provider_record is null then return 'invalid'; end if;

  boundary_state := public.refund_nayax_request_boundary_evidence_state(
    case_row.customer_request_received_at,case_row.customer_request_received_source,p_evidence
  );
  mismatch_present := p_evidence ->> 'card_last4_comparison' like 'mismatch_%'
    or p_evidence ->> 'card_network_comparison' like 'mismatch_%';
  expected_machine_in_scope :=
    (case_row.reporting_machine_id is not null
      and p_reporting_machine_id is not distinct from case_row.reporting_machine_id)
    or (
      case_row.reporting_machine_id is null
      and case_row.intake_selection_kind = 'livermore_pair'
      and case_row.intake_selection_key = public.refund_livermore_selection_key()
      and case_row.intake_selection_machine_ids = public.refund_livermore_selection_machine_ids()
      and p_reporting_machine_id = any(case_row.intake_selection_machine_ids)
      and public.refund_livermore_selection_is_valid()
    );
  if p_evidence ->> 'identifier_review_state' = 'needs_corroboration'
    and jsonb_array_length(coalesce(p_evidence -> 'customer_correction_fields', '[]'::jsonb)) = 0
    and not (
      (p_site_id is null and coalesce(p_evidence -> 'reason_codes', '[]'::jsonb) ? 'missing_provider_site_id')
      or (
        p_evidence ->> 'payment_status' is distinct from 'approved'
        and coalesce(p_evidence -> 'reason_codes', '[]'::jsonb) ? 'provider_status_unconfirmed'
      )
    ) then return 'invalid'; end if;
  expected_selection_allowed :=
    jsonb_array_length(coalesce(p_evidence -> 'hard_exclusions','[]'::jsonb)) = 0
    and expected_machine_in_scope
    and case_row.incident_time_resolution is not distinct from 'exact'
    and case_row.incident_time_confidence is distinct from 'rough'
    and case_row.payment_amount_cents > 0
    and p_amount_cents > 0
    and expected_amount_delta is not null
    and expected_amount_delta <= 300
    and p_site_id is not null
    and p_evidence ->> 'provider_machine_id' is not distinct from machine_row.nayax_machine_id
    and p_evidence ->> 'provider_time_resolution' is not distinct from 'exact'
    and p_evidence ->> 'machine_time_resolution' is not distinct from 'exact'
    and coalesce(p_evidence ->> 'machine_authorization_time_raw','') <> ''
    and expected_time_delta <= 180
    and p_currency_code is not distinct from 'USD'
    and p_evidence ->> 'payment_status' is not distinct from 'approved'
    and coalesce(p_evidence ->> 'payment_status_evidence','') in ('explicit','last_sales_contract')
    and p_evidence ->> 'provider_refund_state' is not distinct from 'clear'
    and not duplicate_provider_record
    and boundary_state = 'valid'
    and p_evidence ->> 'request_time_boundary' is not distinct from 'before_or_at_request';
  if mismatch_present then
    expected_selection_allowed := expected_selection_allowed
      and case_row.incident_time_confidence in ('exact','within_15_minutes')
      and case_row.incident_time_source is not distinct from 'transaction_alert_or_receipt'
      and case_row.nearby_attempt_count is not distinct from 'one'
      and expected_amount_delta = 0
      and expected_time_delta <= 60;
  end if;
  if selection_allowed is distinct from expected_selection_allowed then return 'invalid'; end if;

  if p_evidence ->> 'identifier_review_state' = 'reviewable_uncertainty'
    and not expected_selection_allowed then return 'invalid'; end if;
  return 'valid';
exception when invalid_text_representation or numeric_value_out_of_range then return 'invalid';
end;
$$;
revoke all on function public.refund_nayax_candidate_identifier_evidence_state(
  uuid,uuid,integer,timestamptz,integer,text,text,jsonb
) from public, anon, authenticated;

create function public.guard_refund_nayax_candidate_identifier_evidence()
returns trigger language plpgsql security definer set search_path = '' as $$
declare evidence_state text;
begin
  perform 1 from public.refund_cases c where c.id = new.refund_case_id for share;
  if not found then raise exception 'Refund case not found' using errcode = 'P4600'; end if;
  evidence_state := public.refund_nayax_candidate_identifier_evidence_state(
    new.refund_case_id,new.reporting_machine_id,new.site_id,new.machine_authorization_time,
    new.amount_cents,new.card_last4,new.currency_code,new.evidence_summary
  );
  if evidence_state not in ('valid','manual','legacy','legacy_readonly') then
    raise exception '%', case evidence_state
      when 'stale' then 'Refund case details changed; refresh Nayax transactions'
      when 'refresh' then 'Refresh Nayax transactions to use current identifier evidence'
      else 'Invalid Nayax identifier evidence' end using errcode = 'P4626';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_refund_nayax_candidate_identifier_evidence()
  from public, anon, authenticated;
create trigger zzz_refund_nayax_candidate_identifier_evidence
before insert on public.refund_nayax_lookup_candidates for each row
execute function public.guard_refund_nayax_candidate_identifier_evidence();

alter function public.service_select_refund_nayax_candidate_as_actor(uuid,uuid,bigint,uuid,text)
  rename to service_select_refund_nayax_candidate_as_actor_pre_identifier_evidence_v1;
revoke all on function public.service_select_refund_nayax_candidate_as_actor_pre_identifier_evidence_v1(uuid,uuid,bigint,uuid,text)
  from public, anon, authenticated, service_role;

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
  candidate_machine_id uuid;
  manual_portal_candidate boolean;
  exact_replay boolean;
  evidence_state text;
  result jsonb;
  selectable_count integer;
begin
  select c.* into case_row from public.refund_cases c where c.id = p_case_id for update;
  if not found then raise exception 'Refund case not found' using errcode = 'P4600'; end if;
  select candidate.* into candidate_row from public.refund_nayax_lookup_candidates candidate
  where candidate.token = p_candidate_token and candidate.refund_case_id = case_row.id for share;
  if not found then
    raise exception 'Nayax lookup evidence expired or belongs to another review session' using errcode = 'P4602';
  end if;
  candidate_machine_id := coalesce(candidate_row.reporting_machine_id, case_row.reporting_machine_id);
  manual_portal_candidate := coalesce(candidate_row.evidence_summary ->> 'source' = 'manual_nayax_portal', false);
  exact_replay := candidate_machine_id is not null
    and case_row.reporting_machine_id = candidate_machine_id
    and case_row.matched_nayax_transaction_id = candidate_row.provider_transaction_id
    and case_row.matched_nayax_site_id is not distinct from candidate_row.site_id
    and case_row.matched_nayax_machine_auth_time = candidate_row.machine_authorization_time
    and case_row.matched_nayax_amount_cents = candidate_row.amount_cents
    and case_row.matched_nayax_card_last4 is not distinct from candidate_row.card_last4
    and case_row.matched_nayax_currency_code = candidate_row.currency_code
    and exists (
      select 1 from public.refund_case_events e
      where e.refund_case_id = case_row.id and e.event_type = 'nayax_match_selected'
        and e.actor_user_id = p_actor_user_id
    );
  if not manual_portal_candidate and not exact_replay then
    if candidate_row.lookup_generation <> case_row.nayax_lookup_generation
      or case_row.nayax_lookup_status = 'checking' then
      raise exception 'A newer Nayax lookup replaced this transaction evidence'
        using errcode = 'P4602';
    end if;
    evidence_state := public.refund_nayax_candidate_identifier_evidence_state(
      case_row.id,candidate_row.reporting_machine_id,candidate_row.site_id,
      candidate_row.machine_authorization_time,candidate_row.amount_cents,
      candidate_row.card_last4,candidate_row.currency_code,candidate_row.evidence_summary
    );
    if evidence_state not in ('valid','legacy') then
      raise exception '%', case evidence_state
        when 'stale' then 'Refund case details changed; refresh Nayax transactions'
        when 'refresh' then 'Refresh Nayax transactions to use current identifier evidence'
        when 'legacy_readonly' then 'Refresh Nayax transactions to use current identifier evidence'
        else 'Invalid Nayax identifier evidence' end using errcode = 'P4626';
    end if;
    if evidence_state = 'valid'
      and candidate_row.evidence_summary ->> 'identifier_review_state' = 'reviewable_uncertainty'
      and candidate_row.evidence_summary ->> 'is_recommended' = 'true' then
      select count(*) into selectable_count
      from public.refund_nayax_lookup_candidates c
      where c.refund_case_id = case_row.id
        and c.lookup_generation = candidate_row.lookup_generation
        and c.expires_at > statement_timestamp()
        and c.evidence_summary ->> 'selection_allowed' = 'true';
      if selectable_count <> 1 then
        raise exception 'Multiple Nayax transactions require explicit manager corroboration'
          using errcode = 'P4626';
      end if;
    end if;
  end if;

  result := public.service_select_refund_nayax_candidate_as_actor_pre_identifier_evidence_v1(
    p_actor_user_id, p_case_id, p_expected_case_version,
    p_candidate_token, p_nayax_disagreement_reason
  );
  if not manual_portal_candidate and evidence_state = 'valid'
    and coalesce((result ->> 'selectionApplied')::boolean, false) then
    insert into public.refund_case_events(refund_case_id,actor_user_id,event_type,message,metadata)
    values(case_row.id,p_actor_user_id,'nayax_identifier_evidence_selected',
      'Manager selected one exact Nayax transaction after reviewing the identifier evidence.',
      jsonb_build_object(
        'policy_version',candidate_row.evidence_summary ->> 'policy_version',
        'identifier_policy_version',candidate_row.evidence_summary ->> 'identifier_policy_version',
        'customer_fact_version',(candidate_row.evidence_summary ->> 'customer_fact_version')::bigint,
        'customer_credential_class',candidate_row.evidence_summary ->> 'customer_credential_class',
        'provider_identifier_class',candidate_row.evidence_summary ->> 'provider_identifier_class',
        'card_last4_comparison',candidate_row.evidence_summary ->> 'card_last4_comparison',
        'card_network_comparison',candidate_row.evidence_summary ->> 'card_network_comparison',
        'payment_interaction_comparison',candidate_row.evidence_summary ->> 'payment_interaction_comparison',
        'identifier_review_state',candidate_row.evidence_summary ->> 'identifier_review_state',
        'corroboration_codes',case
          when candidate_row.evidence_summary ->> 'identifier_review_state' = 'reviewable_uncertainty'
          then jsonb_build_array(
            'machine_exact','amount_exact','approved_sale','occurrence_time_within_60m',
            'customer_time_from_alert_or_receipt','customer_reports_one_nearby_attempt'
          ) else '[]'::jsonb end,
        'provider_call_made',false,'customer_message_created',false,'payload_redacted',true
      ));
  end if;
  return result;
end;
$$;
revoke all on function public.service_select_refund_nayax_candidate_as_actor(uuid,uuid,bigint,uuid,text)
  from public, anon, authenticated;
grant execute on function public.service_select_refund_nayax_candidate_as_actor(uuid,uuid,bigint,uuid,text)
  to service_role;

alter function public.admin_get_refund_operations_overview()
  rename to admin_get_refund_operations_overview_pre_identifier_context_v1;
revoke all on function public.admin_get_refund_operations_overview_pre_identifier_context_v1()
  from public, anon, authenticated, service_role;
create function public.admin_get_refund_operations_overview()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  base jsonb;
  enriched jsonb;
begin
  base := public.admin_get_refund_operations_overview_pre_identifier_context_v1();
  select coalesce(jsonb_agg(
    case when c.id is null then item.value else item.value || jsonb_build_object(
      'cardLast4Source',c.card_last4_source,
      'walletDeviceKind',c.wallet_device_kind,
      'incidentTimeSource',c.incident_time_source,
      'nearbyAttemptCount',c.nearby_attempt_count
    ) end order by item.ordinality
  ),'[]'::jsonb) into enriched
  from jsonb_array_elements(coalesce(base -> 'cases','[]'::jsonb)) with ordinality item
  left join public.refund_cases c on c.id = (item.value ->> 'id')::uuid;
  return jsonb_set(base,'{cases}',enriched,true);
end;
$$;
revoke all on function public.admin_get_refund_operations_overview() from public, anon;
grant execute on function public.admin_get_refund_operations_overview() to authenticated, service_role;

select pg_notify('pgrst','reload schema');
