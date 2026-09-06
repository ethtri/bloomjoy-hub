-- Request timing is supporting evidence. Current Nayax authorization/report timing defaults to
-- unknown ordering unless a separately established online purchase occurrence contract supplies
-- bounded comparable intervals. Manager corroboration can resolve otherwise complete evidence.

-- Align the current matcher, persisted candidate evidence, and server-side
-- selection validator. Historical evidence remains immutable and readable, but
-- only v11 evidence may create a new exact transaction binding.

alter table public.refund_cases
  drop constraint if exists refund_cases_nayax_recommendation_state_check,
  add constraint refund_cases_nayax_recommendation_state_check
    check (
      nayax_recommendation_state is null
      or nayax_recommendation_state in (
        'high_confidence', 'manager_confirmed', 'ambiguous',
        'no_safe_match', 'manual_exception'
      )
    ),
  drop constraint if exists refund_cases_nayax_execution_eligibility_check,
  add constraint refund_cases_nayax_execution_eligibility_check
    check (
      nayax_match_execution_eligible = false
      or (
        nayax_recommendation_state in ('high_confidence', 'manager_confirmed')
        and correlation_status = 'matched'
        and correlation_source = 'nayax'
        and matched_nayax_transaction_id is not null
        and (
          nayax_recommendation_state = 'manager_confirmed'
          or card_wallet_used = false
        )
        and nayax_recommendation_policy_version is not null
      )
    );

comment on column public.refund_cases.nayax_recommendation_state is
  'Versioned matcher state. manager_confirmed records explicit manager corroboration without relabeling uncertain timing as automatic high confidence.';
comment on column public.refund_cases.nayax_match_execution_eligible is
  'Fail-closed flag set after a manager confirms either a unique high-confidence recommendation or a validated manager-review candidate.';

create or replace function public.refund_nayax_request_boundary_evidence_state(
  p_request_received_at timestamptz,
  p_request_received_source text,
  p_evidence jsonb
)
returns text language plpgsql immutable set search_path = '' as $$
declare
  authorized_at timestamptz;
  occurrence_lower timestamptz;
  occurrence_upper timestamptz;
  request_lower timestamptz;
  request_upper timestamptz;
  comparable boolean;
begin
  if p_evidence ->> 'source' = 'manual_nayax_portal' then return 'manual'; end if;
  if coalesce(p_evidence ->> 'policy_version', '') not in (
    '2026-09-05.v8','2026-09-05.v9','2026-09-05.v10','2026-09-05.v11'
  ) then
    return case when p_request_received_at is null then 'legacy' else 'refresh' end;
  end if;
  if p_request_received_at is null then
    if p_evidence -> 'customer_request_received_at' = 'null'::jsonb
      and p_evidence -> 'customer_request_received_source' = 'null'::jsonb
      and p_evidence ->> 'request_time_boundary' = 'request_time_unknown'
      and p_evidence ->> 'transaction_occurrence_comparable' = 'false'
      and p_evidence ->> 'transaction_occurrence_semantics' = 'unknown'
      and p_evidence -> 'transaction_occurrence_proof_source' = 'null'::jsonb
      and p_evidence -> 'transaction_occurrence_timestamp_source' = 'null'::jsonb
      and p_evidence -> 'transaction_occurrence_timezone_basis' = 'null'::jsonb
      and p_evidence -> 'transaction_occurrence_lower_bound_at' = 'null'::jsonb
      and p_evidence -> 'transaction_occurrence_upper_bound_at' = 'null'::jsonb
      and p_evidence -> 'request_receipt_lower_bound_at' = 'null'::jsonb
      and p_evidence -> 'request_receipt_upper_bound_at' = 'null'::jsonb
      and p_evidence ->> 'one_click_eligible' = 'false' then return 'valid'; end if;
    return 'invalid';
  end if;
  if not isfinite(p_request_received_at) then return 'invalid'; end if;
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
    comparable := coalesce((p_evidence ->> 'transaction_occurrence_comparable')::boolean, false);
  exception when invalid_datetime_format or datetime_field_overflow or invalid_text_representation then
    return 'invalid';
  end;

  if not comparable then
    if p_evidence ->> 'request_time_boundary' = 'occurrence_time_uncertain'
      and p_evidence ->> 'transaction_occurrence_semantics' = 'unknown'
      and p_evidence -> 'transaction_occurrence_proof_source' = 'null'::jsonb
      and p_evidence -> 'transaction_occurrence_timestamp_source' = 'null'::jsonb
      and p_evidence -> 'transaction_occurrence_timezone_basis' = 'null'::jsonb
      and p_evidence -> 'transaction_occurrence_lower_bound_at' = 'null'::jsonb
      and p_evidence -> 'transaction_occurrence_upper_bound_at' = 'null'::jsonb
      and p_evidence -> 'request_receipt_lower_bound_at' = 'null'::jsonb
      and p_evidence -> 'request_receipt_upper_bound_at' = 'null'::jsonb
      and p_evidence ->> 'one_click_eligible' = 'false' then return 'valid'; end if;
    return 'invalid';
  end if;
  if p_evidence ->> 'transaction_occurrence_semantics' is distinct from 'online_purchase_occurrence'
    or p_evidence ->> 'transaction_occurrence_proof_source' is distinct from
      'verified_provider_purchase_occurrence_v1'
    or p_evidence ->> 'transaction_occurrence_timestamp_source' is distinct from
      p_evidence ->> 'provider_time_source'
    or not (
      (
        p_evidence ->> 'transaction_occurrence_timestamp_source' is not distinct from 'authorization_gmt'
        and p_evidence ->> 'transaction_occurrence_timezone_basis' is not distinct from 'utc'
      )
      or (
        p_evidence ->> 'transaction_occurrence_timestamp_source' is not distinct from 'machine_authorization_offset'
        and p_evidence ->> 'transaction_occurrence_timezone_basis' is not distinct from 'embedded_offset'
      )
      or (
        p_evidence ->> 'transaction_occurrence_timestamp_source' is not distinct from 'verified_machine_clock'
        and p_evidence ->> 'transaction_occurrence_timezone_basis' is not distinct from 'verified_machine_timezone'
      )
    )
    or p_evidence ->> 'provider_time_resolution' is distinct from 'exact'
    or jsonb_typeof(p_evidence -> 'authorized_at') is distinct from 'string'
    or jsonb_typeof(p_evidence -> 'transaction_occurrence_lower_bound_at') is distinct from 'string'
    or jsonb_typeof(p_evidence -> 'transaction_occurrence_upper_bound_at') is distinct from 'string'
    or jsonb_typeof(p_evidence -> 'request_receipt_lower_bound_at') is distinct from 'string'
    or jsonb_typeof(p_evidence -> 'request_receipt_upper_bound_at') is distinct from 'string' then
    return 'invalid';
  end if;
  begin
    authorized_at := (p_evidence ->> 'authorized_at')::timestamptz;
    occurrence_lower := (p_evidence ->> 'transaction_occurrence_lower_bound_at')::timestamptz;
    occurrence_upper := (p_evidence ->> 'transaction_occurrence_upper_bound_at')::timestamptz;
    request_lower := (p_evidence ->> 'request_receipt_lower_bound_at')::timestamptz;
    request_upper := (p_evidence ->> 'request_receipt_upper_bound_at')::timestamptz;
  exception when invalid_datetime_format or datetime_field_overflow then return 'invalid'; end;
  if not isfinite(authorized_at) or not isfinite(occurrence_lower) or not isfinite(occurrence_upper)
    or not isfinite(request_lower) or not isfinite(request_upper)
    or occurrence_lower > authorized_at or authorized_at > occurrence_upper
    or request_lower > p_request_received_at or p_request_received_at > request_upper
    or occurrence_lower > occurrence_upper or request_lower > request_upper
    or authorized_at - occurrence_lower > interval '24 hours'
    or occurrence_upper - authorized_at > interval '48 hours'
    or p_request_received_at - request_lower > interval '24 hours'
    or request_upper - p_request_received_at > interval '48 hours'
    then return 'invalid'; end if;
  if occurrence_lower > request_upper then
    return case when p_evidence ->> 'request_time_boundary' = 'after_request'
      then 'after_request' else 'invalid' end;
  end if;
  if occurrence_upper <= request_lower then
    return case when p_evidence ->> 'request_time_boundary' = 'before_or_at_request'
      then 'valid' else 'invalid' end;
  end if;
  return case when p_evidence ->> 'request_time_boundary' = 'occurrence_time_uncertain'
      and p_evidence ->> 'one_click_eligible' = 'false'
    then 'valid' else 'invalid' end;
exception when invalid_text_representation then return 'invalid';
end;
$$;
revoke all on function public.refund_nayax_request_boundary_evidence_state(timestamptz,text,jsonb)
  from public, anon, authenticated;


create or replace function public.refund_nayax_identifier_evidence_state(
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
  if p_evidence ->> 'policy_version' is distinct from '2026-09-05.v11' then
    -- A current identifier-review object cannot evade v11 validation by
    -- changing its policy-version string. Older immutable lookup rows remain
    -- readable so migration/replay can preserve their audit trail, but only
    -- the known v8 shape retains its immutable historical contract.
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
    and not (reason_codes ?| array[
      'missing_provider_site_id','provider_status_unconfirmed',
      'customer_request_time_unknown','transaction_occurrence_time_uncertain'
    ]) then
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


create or replace function public.refund_nayax_machine_authorization_raw_at(
  p_raw text,
  p_machine_timezone text
)
returns timestamptz language plpgsql immutable set search_path = '' as $$
declare
  parts text[];
  normalized text;
  milliseconds text;
  local_timestamp timestamp;
  resolved_at timestamptz;
  earlier_fold_at timestamptz;
begin
  if p_raw is null or length(p_raw) > 80 then return null; end if;
  parts := regexp_match(btrim(p_raw),
    '^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})?$','i');
  if parts is null then return null; end if;
  milliseconds := left(rpad(coalesce(parts[3], ''), 3, '0'), 3);
  normalized := parts[1] || 'T' || parts[2] || '.' || milliseconds || coalesce(parts[4], '');
  if parts[4] is not null then return normalized::timestamptz; end if;
  if nullif(btrim(p_machine_timezone), '') is null then return null; end if;
  local_timestamp := normalized::timestamp;
  resolved_at := local_timestamp at time zone p_machine_timezone;
  -- PostgreSQL chooses the later instant during an autumn clock fold while
  -- the shared scorer deliberately chooses the first occurrence. Preserve
  -- the scorer's first-fold rule for exact raw MachineAuTime binding.
  earlier_fold_at := resolved_at - interval '1 hour';
  if earlier_fold_at at time zone p_machine_timezone = local_timestamp then
    return earlier_fold_at;
  end if;
  return resolved_at;
exception when invalid_datetime_format or datetime_field_overflow or invalid_parameter_value then
  return null;
end;
$$;
revoke all on function public.refund_nayax_machine_authorization_raw_at(text,text)
  from public, anon, authenticated, service_role;


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

  -- Reconcile scorer claims to immutable candidate columns and current case
  -- facts. Provider-record arrival time is deliberately absent: only the
  -- transaction occurrence is compared.
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
      (p_site_id is null and coalesce(p_evidence -> 'reason_codes', '[]'::jsonb) ? 'missing_provider_site_id')
      or (
        p_evidence ->> 'payment_status' is distinct from 'approved'
        and coalesce(p_evidence -> 'reason_codes', '[]'::jsonb) ? 'provider_status_unconfirmed'
      )
      or coalesce(p_evidence -> 'reason_codes', '[]'::jsonb) ?| array[
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
  if mismatch_present then
    expected_selection_allowed := expected_selection_allowed
      and case_row.incident_time_confidence in ('exact','within_15_minutes')
      and case_row.incident_time_source is not distinct from 'transaction_alert_or_receipt'
      and case_row.nearby_attempt_count is not distinct from 'one'
      and expected_amount_delta = 0
      and (expected_time_delta is null or expected_time_delta <= 60);
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





-- Remove the old raw MachineAuTime-versus-request hard gate from every
-- current persistence/selection layer. The v11 interval validator above is authoritative.

create or replace function public.guard_refund_nayax_candidate_request_boundary()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  case_row public.refund_cases%rowtype;
  evidence_state text;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('refund-nayax-lookup-v1|' || new.refund_case_id::text, 0)
  );
  select c.* into case_row from public.refund_cases c where c.id = new.refund_case_id for update;
  evidence_state := public.refund_nayax_request_boundary_evidence_state(
    case_row.customer_request_received_at, case_row.customer_request_received_source, new.evidence_summary
  );
  if evidence_state = 'legacy' then
    -- During a migration/function rollout, keep older unknown-anchor candidates
    -- selectable for review while removing their stale execution claim.
    new.evidence_summary := jsonb_set(
      new.evidence_summary, '{one_click_eligible}', 'false'::jsonb, true
    );
  end if;
  if evidence_state in ('refresh', 'invalid', 'after_request') then
    raise exception '%', case evidence_state
      when 'after_request' then 'Transaction occurred after Bloomjoy received the customer request'
      when 'refresh' then 'Refresh Nayax transactions to bind the customer request time'
      else 'Invalid customer request time evidence' end using errcode = 'P4625';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_refund_nayax_candidate_request_boundary()
  from public, anon, authenticated;

create or replace function public.guard_refund_nayax_selected_request_boundary()
returns trigger language plpgsql security definer set search_path = '' as $$
declare evidence jsonb; evidence_state text; candidate_time timestamptz;
begin
  if new.matched_nayax_transaction_id is not null
    and row(new.reporting_machine_id,new.matched_nayax_transaction_id,new.matched_nayax_site_id,
      new.matched_nayax_machine_auth_time,new.matched_nayax_amount_cents,new.matched_nayax_card_last4,new.matched_nayax_currency_code)
    is distinct from row(old.reporting_machine_id,old.matched_nayax_transaction_id,old.matched_nayax_site_id,
      old.matched_nayax_machine_auth_time,old.matched_nayax_amount_cents,old.matched_nayax_card_last4,old.matched_nayax_currency_code) then
    select c.evidence_summary,c.machine_authorization_time into evidence,candidate_time
    from public.refund_nayax_lookup_candidates c
    where c.refund_case_id = new.id and c.provider_transaction_id = new.matched_nayax_transaction_id
      and c.reporting_machine_id = new.reporting_machine_id
    order by (c.lookup_generation = new.nayax_lookup_generation) desc, c.created_at desc limit 1;
    if evidence is null and new.customer_request_received_at is not null then
      raise exception 'Current request-bound Nayax evidence is required' using errcode = 'P4625';
    end if;
    if evidence is not null then
      evidence_state := public.refund_nayax_request_boundary_evidence_state(
        new.customer_request_received_at, new.customer_request_received_source, evidence
      );
      if evidence_state in ('refresh', 'invalid', 'after_request') then
        raise exception 'Nayax request-time evidence is not safe; refresh current evidence' using errcode = 'P4625';
      end if;
      if evidence_state = 'legacy' or (
        evidence ->> 'one_click_eligible' = 'false'
        and not (
          evidence ->> 'policy_version' = '2026-09-05.v11'
          and evidence ->> 'selection_allowed' = 'true'
          and evidence ->> 'request_time_boundary' in ('request_time_unknown','occurrence_time_uncertain')
        )
      ) then
        new.nayax_match_execution_eligible := false;
      end if;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.guard_refund_nayax_selected_request_boundary()
  from public, anon, authenticated;

-- Preserve every existing authority, version, expiry, duplicate, and exact-binding
-- check while treating an explicit manager confirmation as corroboration for a
-- selectable v11 candidate whose ordering remains unknown.

create or replace function public.service_select_refund_nayax_candidate_as_actor_pre_lookup_generation_v1(
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
  scorer_recommendation_state text;
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
  elsif not public.refund_case_user_has_active_manager_mapping(
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
    or refund_case.status not in ('needs_review','correlated','approved')
    or (
      refund_case.decision is not null and (
        refund_case.decision <> 'approved'
        or refund_case.matched_nayax_transaction_id is not null
        or refund_case.duplicate_of_refund_case_id is not null
        or refund_case.manual_refund_reference is not null
        or refund_case.refund_amount_cents is null
        or refund_case.refund_amount_cents <= 0
        or refund_case.refund_amount_cents is distinct from candidate.amount_cents
        or exists (select 1 from public.refund_authoritative_receipts receipt
          where receipt.refund_case_id = refund_case.id)
        or exists (select 1 from public.refund_case_nayax_refund_attempts attempt
          where attempt.refund_case_id = refund_case.id)
      )
    )
    or refund_case.nayax_refund_execution_status <> 'not_requested'
    or refund_case.reporting_adjustment_id is not null
    or refund_case.refund_completed_at is not null then
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

  scorer_recommendation_state := coalesce(
    nullif(btrim(candidate.evidence_summary ->> 'recommendation_state'), ''),
    'manual_exception'
  );
  recommendation_state := scorer_recommendation_state;
  policy_version := nullif(btrim(candidate.evidence_summary ->> 'policy_version'), '');
  if policy_version is null then
    raise exception 'This Nayax transaction is missing versioned recommendation evidence'
      using errcode = 'P4604';
  end if;
  -- Automatic one-click evidence remains narrow. A manager's explicit confirmation
  -- can make a fully validated v11 candidate executable when request ordering is
  -- unknown; that confirmation is the corroboration action, not timestamp proof.
  one_click_eligible := not manual_portal_candidate and (
    (
      scorer_recommendation_state = 'high_confidence'
      and candidate_recommended
      and candidate.evidence_summary ->> 'one_click_eligible' = 'true'
    ) or (
      candidate.evidence_summary ->> 'policy_version' = '2026-09-05.v11'
      and candidate_selection_allowed
      and candidate.evidence_summary ->> 'one_click_eligible' = 'false'
      and candidate.evidence_summary ->> 'request_time_boundary' in (
        'request_time_unknown','occurrence_time_uncertain'
      )
    )
  );
  if not manual_portal_candidate
    and candidate.evidence_summary ->> 'policy_version' = '2026-09-05.v11'
    and candidate_selection_allowed
    and candidate.evidence_summary ->> 'one_click_eligible' = 'false'
    and candidate.evidence_summary ->> 'request_time_boundary' in (
      'request_time_unknown','occurrence_time_uncertain'
    ) then
    recommendation_state := 'manager_confirmed';
  end if;

  update public.refund_cases
  set
    reporting_machine_id = candidate_machine_id,
    status = case when refund_case.decision = 'approved' then 'approved' else 'needs_review' end,
    decision = refund_case.decision,
    decision_reason = case when refund_case.decision = 'approved' then refund_case.decision_reason else null end,
    decided_by = case when refund_case.decision = 'approved' then refund_case.decided_by else null end,
    decided_at = case when refund_case.decision = 'approved' then refund_case.decided_at else null end,
    refund_amount_cents = case when refund_case.decision = 'approved'
      then refund_case.refund_amount_cents else candidate.amount_cents end,
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
      'scorer_recommendation_state', scorer_recommendation_state,
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

revoke execute on function public.service_select_refund_nayax_candidate_as_actor_pre_lookup_generation_v1(
  uuid, uuid, bigint, uuid, text
) from public, anon, authenticated, service_role;

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


-- Use explicit current evidence for same-case correction scope, including an intentional empty set.
create or replace function public.refund_purchase_correction_request_fields(p_case_id uuid)
returns text[] language plpgsql stable security definer set search_path='' as $$
declare
  c public.refund_cases;
  selected_candidate public.refund_nayax_lookup_candidates%rowtype;
  fields text[];
  evidence jsonb;
  reasons text[];
  exclusions text[];
  current_fields text[];
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

      if evidence->>'policy_version' = '2026-09-05.v11' then
        if evidence->>'is_top_ranked'='true' then
          evidence_state:=public.refund_nayax_candidate_identifier_evidence_state(
            selected_candidate.refund_case_id,selected_candidate.reporting_machine_id,
            selected_candidate.site_id,selected_candidate.machine_authorization_time,
            selected_candidate.amount_cents,selected_candidate.card_last4,
            selected_candidate.currency_code,evidence);
          if evidence_state='valid' and evidence->>'identifier_review_state'='needs_corroboration' then
            select coalesce(array_agg(value),'{}') into current_fields
              from jsonb_array_elements_text(coalesce(evidence->'customer_correction_fields','[]'));
            fields:=fields||current_fields;
          end if;
        end if;
      elsif evidence->>'policy_version' in ('2026-09-05.v9','2026-09-05.v10') then
        -- Recognized structured evidence never falls back to guessed legacy
        -- customer questions. Current coherent facts supply their exact scope;
        -- stale or malformed facts require an internal refresh only.
        if evidence->>'is_top_ranked'='true'
          and evidence ? 'customer_correction_fields'
          and jsonb_typeof(evidence->'customer_correction_fields')='array'
          and coalesce(evidence->>'customer_fact_version','') ~ '^[1-9][0-9]*$'
          and (evidence->>'customer_fact_version')::bigint=c.deterministic_fact_version then
          select coalesce(array_agg(value),'{}') into current_fields
            from jsonb_array_elements_text(evidence->'customer_correction_fields');
          fields:=fields||current_fields;
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

-- Retry-safe support recovery remains bound to all existing payment, amount,
-- machine, duplicate, and provider-state checks. Integrate only the new
-- manager-confirmed recommendation state.
create or replace function public.refund_nayax_retry_safe_case_is_current(
  p_case public.refund_cases
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_case.payment_method = 'card'
    and p_case.status = 'card_refund_pending'
    and p_case.decision = 'approved'
    and p_case.correlation_status = 'matched'
    and p_case.correlation_source = 'nayax'
    and p_case.nayax_recommendation_state in ('high_confidence','manager_confirmed')
    and p_case.card_wallet_used = false
    and public.is_review_safe_nayax_transaction_reference(p_case.matched_nayax_transaction_id)
    and p_case.matched_nayax_site_id is not null
    and p_case.matched_nayax_machine_auth_time is not null
    and p_case.matched_nayax_currency_code = 'USD'
    and p_case.refund_amount_cents is not null
    and p_case.refund_amount_cents > 0
    and p_case.refund_amount_cents = p_case.payment_amount_cents
    and p_case.refund_amount_cents = p_case.matched_nayax_amount_cents
    and p_case.reporting_adjustment_id is null
    and p_case.refund_completed_at is null
    and not exists (
      select 1 from public.refund_cases duplicate_case
      where duplicate_case.id <> p_case.id
        and duplicate_case.matched_nayax_transaction_id = p_case.matched_nayax_transaction_id
    )
    and exists (
      select 1 from public.reporting_machines machine
      where machine.id = p_case.reporting_machine_id
        and machine.status = 'active'
        and machine.nayax_refunds_enabled = true
        and machine.nayax_machine_id is not null
        and btrim(machine.nayax_machine_id) <> ''
        and (
          machine.nayax_refund_max_amount_cents is null
          or p_case.refund_amount_cents <= machine.nayax_refund_max_amount_cents
        )
    );
$$;
revoke execute on function public.refund_nayax_retry_safe_case_is_current(public.refund_cases)
  from public, anon, authenticated, service_role;

revoke all on function public.refund_purchase_correction_request_fields(uuid)
  from public, anon, authenticated;
grant execute on function public.refund_purchase_correction_request_fields(uuid)
  to service_role;

comment on function public.refund_purchase_correction_request_fields(uuid) is
  'Returns one canonical same-case correction scope. Valid current Nayax evidence supplies only its explicit customer correction fields; manager-owned and provider-only gaps add no customer work. Known legacy evidence retains the prior compatibility path.';
