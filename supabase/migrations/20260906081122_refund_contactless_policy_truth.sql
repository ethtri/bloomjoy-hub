-- Repair the neutral physical-contactless selection contract before the
-- 20260906073000 policy reaches production. The exception is intentionally
-- narrower than ordinary manager review: exact amount, a finite occurrence
-- comparison within 60 minutes of an exact customer-reported time, and a
-- supporting provider interaction are all mandatory. Identifier equivalence
-- and one-click eligibility remain unproved and false.
create or replace function public.refund_nayax_candidate_identifier_evidence_state(
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
  evidence_machine_authorization_at timestamptz;
  expected_amount_delta integer;
  expected_time_delta integer;
  expected_provider_processing_time_delta integer;
  evidence_amount_delta integer;
  evidence_time_delta integer;
  evidence_provider_processing_time_delta integer;
  boundary_state text;
  selection_allowed boolean;
  duplicate_provider_record boolean;
  expected_customer_credential text;
  mismatch_present boolean;
  expected_machine_in_scope boolean;
  expected_selection_allowed boolean;
  corroborated_mismatch_review_eligible boolean;
  neutral_physical_contactless_mismatch boolean;
  neutral_physical_contactless_exact_scope_eligible boolean;
  reason_codes jsonb := coalesce(p_evidence -> 'reason_codes', '[]'::jsonb);
  machine_timezone text;
  raw_machine_authorization_at timestamptz;
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
  select case
      when inventory.provider_clock_source = 'native_machine_configuration'
        and inventory.provider_clock_daylight_saving is true
        and inventory.provider_clock_timezone is not null
      then inventory.provider_clock_timezone
      else location.timezone
    end
  into machine_timezone
  from public.reporting_locations location
  left join public.refund_nayax_machine_inventory inventory
    on inventory.reporting_machine_id = machine_row.id
    and inventory.account_key = machine_row.nayax_account_key
    and inventory.nayax_machine_id = machine_row.nayax_machine_id
  where location.id = machine_row.location_id;

  begin
    evidence_authorized_at := (p_evidence ->> 'authorized_at')::timestamptz;
    evidence_machine_authorization_at := (p_evidence ->> 'machine_authorization_at')::timestamptz;
    raw_machine_authorization_at := public.refund_nayax_machine_authorization_raw_at(
      p_evidence ->> 'machine_authorization_time_raw', machine_timezone
    );
    selection_allowed := (p_evidence ->> 'selection_allowed')::boolean;
    duplicate_provider_record := (p_evidence ->> 'duplicate_provider_record')::boolean;
    expected_amount_delta := case when p_amount_cents is not null and case_row.payment_amount_cents is not null
      then abs(p_amount_cents - case_row.payment_amount_cents) else null end;
    expected_provider_processing_time_delta := ceil(abs(extract(epoch from
      (evidence_authorized_at - case_row.incident_at))) / 60.0)::integer;
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
  if coalesce(p_evidence ->> 'provider_processing_time_delta_minutes', '') !~ '^\d+$'
    then return 'invalid'; end if;
  evidence_provider_processing_time_delta :=
    (p_evidence ->> 'provider_processing_time_delta_minutes')::integer;
  if evidence_provider_processing_time_delta is distinct from expected_provider_processing_time_delta
    then return 'invalid'; end if;
  if case_row.card_last4 is null or p_card_last4 is null then
    if p_evidence ->> 'card_last4_comparison' is distinct from 'missing' then return 'invalid'; end if;
  elsif case_row.card_last4 = p_card_last4 then
    if p_evidence ->> 'card_last4_comparison' is distinct from 'exact_support' then return 'invalid'; end if;
  elsif p_evidence ->> 'card_last4_comparison' not like 'mismatch_%' then
    return 'invalid';
  end if;

  if p_machine_authorization_time is null
    or p_evidence ->> 'lookup_account_scope' is distinct from
      regexp_replace(upper(btrim(machine_row.nayax_account_key)), '[^A-Z0-9_]', '_', 'g')
    or p_evidence ->> 'lookup_provider_machine_id' is distinct from machine_row.nayax_machine_id
    or p_evidence ->> 'customer_credential_class' is distinct from expected_customer_credential
    or p_evidence ->> 'machine_authorization_time_source' is distinct from 'MachineAuthorizationTime'
    or jsonb_typeof(p_evidence -> 'machine_authorization_at') is distinct from 'string'
    or evidence_machine_authorization_at is distinct from p_machine_authorization_time
    or raw_machine_authorization_at is distinct from p_machine_authorization_time
    or duplicate_provider_record is null then return 'invalid'; end if;

  boundary_state := public.refund_nayax_request_boundary_evidence_state(
    case_row.customer_request_received_at,case_row.customer_request_received_source,p_evidence
  );
  if p_evidence ->> 'transaction_occurrence_comparable' = 'true' then
    expected_time_delta := expected_provider_processing_time_delta;
    if coalesce(p_evidence ->> 'time_delta_minutes', '') !~ '^\d+$' then return 'invalid'; end if;
    evidence_time_delta := (p_evidence ->> 'time_delta_minutes')::integer;
    if evidence_time_delta is distinct from expected_time_delta then return 'invalid'; end if;
  elsif p_evidence -> 'time_delta_minutes' is distinct from 'null'::jsonb then
    return 'invalid';
  end if;
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
      (p_site_id is null and reason_codes ? 'missing_provider_site_id')
      or (
        p_evidence ->> 'payment_status' is distinct from 'approved'
        and reason_codes ? 'provider_status_unconfirmed'
      )
      or reason_codes ?| array[
        'customer_request_time_unknown','transaction_occurrence_time_uncertain'
      ]
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
    and (expected_time_delta is null or expected_time_delta <= 180)
    and p_currency_code is not distinct from 'USD'
    and p_evidence ->> 'payment_status' is not distinct from 'approved'
    and coalesce(p_evidence ->> 'payment_status_evidence','') in ('explicit','last_sales_contract')
    and p_evidence ->> 'provider_refund_state' is not distinct from 'clear'
    and not duplicate_provider_record
    and boundary_state = 'valid'
    and p_evidence ->> 'request_time_boundary' is distinct from 'after_request';
  neutral_physical_contactless_mismatch :=
    expected_customer_credential = 'customer_physical_contactless_pan'
    and p_evidence ->> 'card_last4_comparison' = 'mismatch_neutral_unproven_scope'
    and p_evidence ->> 'card_network_comparison' is distinct from 'mismatch_negative_unproven_equivalence';
  corroborated_mismatch_review_eligible :=
    expected_selection_allowed
    and case_row.incident_time_confidence in ('exact','within_15_minutes')
    and case_row.incident_time_source is not distinct from 'transaction_alert_or_receipt'
    and case_row.nearby_attempt_count is not distinct from 'one'
    and expected_amount_delta = 0
    and (expected_time_delta is null or expected_time_delta <= 60);
  neutral_physical_contactless_exact_scope_eligible :=
    expected_selection_allowed
    and neutral_physical_contactless_mismatch
    and p_evidence ->> 'payment_interaction_comparison' is not distinct from 'supporting'
    and case_row.incident_time_confidence is not distinct from 'exact'
    and expected_amount_delta = 0
    and p_evidence ->> 'transaction_occurrence_comparable' is not distinct from 'true'
    and expected_time_delta is not null
    and expected_time_delta <= 60;

  -- The scorer emits this code only for the strict contactless path. Requiring
  -- an exact equivalence between the code and recomputed eligibility keeps the
  -- manager copy and immutable audit path from being selected by stale or
  -- forged evidence.
  if (reason_codes ? 'physical_contactless_exact_scope_review')
    is distinct from neutral_physical_contactless_exact_scope_eligible then
    return 'invalid';
  end if;
  if mismatch_present then
    expected_selection_allowed := case
      when neutral_physical_contactless_mismatch
        then neutral_physical_contactless_exact_scope_eligible
      else corroborated_mismatch_review_eligible
    end;
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

-- Keep selection read-only with respect to payment and customer delivery while
-- recording only facts the selected review path actually established.
create or replace function public.service_select_refund_nayax_candidate_as_actor(
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
  review_path text;
  corroboration_codes jsonb;
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
  if manual_portal_candidate and not exact_replay then
    evidence_state := public.refund_nayax_request_boundary_evidence_state(
      case_row.customer_request_received_at,
      case_row.customer_request_received_source,
      candidate_row.evidence_summary
    );
    if evidence_state in ('refresh','invalid','after_request') then
      raise exception '%', case evidence_state
        when 'after_request' then 'Transaction occurred after Bloomjoy received the customer request'
        else 'Invalid customer request time evidence' end using errcode='P4625';
    end if;
  end if;
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
    if evidence_state <> 'valid' then
      raise exception '%', case evidence_state
        when 'stale' then 'Refund case details changed; refresh Nayax transactions'
        when 'refresh' then 'Refresh Nayax transactions to use current identifier evidence'
        when 'legacy' then 'Refresh Nayax transactions to use current identifier evidence'
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

  result := public.service_select_refund_nayax_candidate_as_actor_pre_lookup_generation_v1(
    p_actor_user_id, p_case_id, p_expected_case_version,
    p_candidate_token, p_nayax_disagreement_reason
  );
  if not manual_portal_candidate and evidence_state = 'valid'
    and coalesce((result ->> 'selectionApplied')::boolean, false) then
    review_path := case
      when coalesce(candidate_row.evidence_summary -> 'reason_codes','[]'::jsonb)
        ? 'physical_contactless_exact_scope_review'
      then 'physical_contactless_exact_scope'
      when candidate_row.evidence_summary ->> 'identifier_review_state' = 'reviewable_uncertainty'
      then 'corroborated_identifier_mismatch'
      else 'identifier_evidence'
    end;
    corroboration_codes := case review_path
      when 'physical_contactless_exact_scope' then jsonb_build_array(
        'machine_exact','amount_exact','approved_sale','customer_reported_time_exact',
        'occurrence_time_comparable','occurrence_time_within_60m',
        'payment_interaction_supporting','identifier_equivalence_unproved'
      )
      when 'corroborated_identifier_mismatch' then
        jsonb_build_array(
          'machine_exact','amount_exact','approved_sale',
          'customer_time_from_alert_or_receipt','customer_reports_one_nearby_attempt',
          'identifier_equivalence_unproved'
        ) || case
          when candidate_row.evidence_summary ->> 'transaction_occurrence_comparable' = 'true'
            and coalesce(candidate_row.evidence_summary ->> 'time_delta_minutes','') ~ '^\d+$'
            and (candidate_row.evidence_summary ->> 'time_delta_minutes')::integer <= 60
          then jsonb_build_array('occurrence_time_within_60m')
          else jsonb_build_array('occurrence_time_unproved')
        end
      else '[]'::jsonb
    end;
    insert into public.refund_case_events(refund_case_id,actor_user_id,event_type,message,metadata)
    values(case_row.id,p_actor_user_id,'nayax_identifier_evidence_selected',
      case review_path
        when 'physical_contactless_exact_scope'
          then 'Manager selected one exact-scope physical contactless transaction after reviewing the unproved card identifier difference.'
        else 'Manager selected one exact Nayax transaction after reviewing the identifier evidence.'
      end,
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
        'review_path',review_path,
        'same_identifier_equivalence_proven',false,
        'corroboration_codes',corroboration_codes,
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
