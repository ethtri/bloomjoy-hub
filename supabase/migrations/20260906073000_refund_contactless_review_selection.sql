-- Version the identifier review contract so already-persisted v1 candidates
-- require one read-only refresh before a new transaction selection.
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
  if p_evidence ->> 'identifier_policy_version' is distinct from '2026-09-05.identifier.v2' then
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

-- Allow a manager to review an exact-bound physical contactless sale when the
-- provider suffix differs but its identifier scope is unproved. This does not
-- establish identifier equivalence or one-click eligibility; the existing
-- machine, amount, currency, provider-state, duplicate, generation, and timing
-- safety checks remain authoritative.
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
  neutral_physical_contactless_mismatch boolean;
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
  neutral_physical_contactless_mismatch :=
    expected_customer_credential = 'customer_physical_contactless_pan'
    and p_evidence ->> 'card_last4_comparison' = 'mismatch_neutral_unproven_scope'
    and p_evidence ->> 'card_network_comparison' is distinct from 'mismatch_negative_unproven_equivalence';
  if mismatch_present then
    expected_selection_allowed := expected_selection_allowed
      and (
        neutral_physical_contactless_mismatch
        or (
          case_row.incident_time_confidence in ('exact','within_15_minutes')
          and case_row.incident_time_source is not distinct from 'transaction_alert_or_receipt'
          and case_row.nearby_attempt_count is not distinct from 'one'
          and expected_amount_delta = 0
          and (expected_time_delta is null or expected_time_delta <= 60)
        )
      );
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

