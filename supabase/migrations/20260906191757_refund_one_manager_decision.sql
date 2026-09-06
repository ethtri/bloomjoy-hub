-- A customer's honest rough-time answer is review context, not a categorical
-- veto after the combined current evidence identifies an exact provider sale.
-- Wallet classification likewise does not change the provider transaction
-- identity or the existing retry-safe payment controls.
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
  conservative_competing_purchase_hold boolean := false;
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
  neutral_physical_contactless_mismatch :=
    expected_customer_credential = 'customer_physical_contactless_pan'
    and p_evidence ->> 'card_last4_comparison' = 'mismatch_neutral_unproven_scope'
    and p_evidence ->> 'card_network_comparison' is distinct from 'mismatch_negative_unproven_equivalence';
  expected_selection_allowed :=
    jsonb_array_length(coalesce(p_evidence -> 'hard_exclusions','[]'::jsonb)) = 0
    and expected_machine_in_scope
    and (
      (
        case_row.incident_time_resolution in ('exact','legacy_absolute')
        and case_row.incident_time_confidence is distinct from 'rough'
      )
      or p_evidence ->> 'card_last4_comparison' is not distinct from 'exact_support'
    )
    and case_row.payment_amount_cents > 0
    and p_amount_cents > 0
    and expected_amount_delta is not null
    and p_site_id is not null
    and p_evidence ->> 'provider_machine_id' is not distinct from machine_row.nayax_machine_id
    and p_evidence ->> 'provider_time_resolution' is not distinct from 'exact'
    and p_evidence ->> 'machine_time_resolution' is not distinct from 'exact'
    and coalesce(p_evidence ->> 'machine_authorization_time_raw','') <> ''
    and p_currency_code is not distinct from 'USD'
    and p_evidence ->> 'payment_status' is not distinct from 'approved'
    and coalesce(p_evidence ->> 'payment_status_evidence','') in ('explicit','last_sales_contract')
    and p_evidence ->> 'provider_refund_state' is not distinct from 'clear'
    and not duplicate_provider_record
    and boundary_state = 'valid'
    and p_evidence ->> 'request_time_boundary' is distinct from 'after_request';
  if mismatch_present then
    expected_selection_allowed := expected_selection_allowed
      and (
        neutral_physical_contactless_mismatch
        or (
          case_row.incident_time_confidence in ('exact','within_15_minutes')
          and case_row.incident_time_source is not distinct from 'transaction_alert_or_receipt'
          and case_row.nearby_attempt_count is not distinct from 'one'
          and (expected_time_delta is null or expected_time_delta <= 60)
        )
      );
  end if;
  conservative_competing_purchase_hold :=
    expected_selection_allowed
    and selection_allowed is false
    and not (
      case_row.incident_time_resolution in ('exact','legacy_absolute')
      and case_row.incident_time_confidence is distinct from 'rough'
    )
    and p_evidence ->> 'card_last4_comparison' is not distinct from 'exact_support'
    and p_evidence ->> 'identifier_review_state' is not distinct from 'needs_corroboration'
    and p_evidence -> 'customer_correction_fields' = '["incident_time"]'::jsonb
    and coalesce(p_evidence -> 'reason_codes','[]'::jsonb)
      ? 'multiple_candidates_need_distinguishing_time';
  if selection_allowed is distinct from expected_selection_allowed
    and not conservative_competing_purchase_hold then return 'invalid'; end if;

  if p_evidence ->> 'identifier_review_state' = 'reviewable_uncertainty'
    and not expected_selection_allowed then return 'invalid'; end if;
  return 'valid';
exception when invalid_text_representation or numeric_value_out_of_range then return 'invalid';
end;
$$;
revoke all on function public.refund_nayax_candidate_identifier_evidence_state(
  uuid,uuid,integer,timestamptz,integer,text,text,jsonb
) from public, anon, authenticated;


-- When every current candidate in a genuine collision is conservatively held,
-- expose the scorer's one distinguishing question through the existing
-- versioned same-case correction path.
alter function public.refund_purchase_correction_request_fields(uuid)
  rename to refund_purchase_correction_request_fields_pre_one_manager_decision_v1;
revoke all on function public.refund_purchase_correction_request_fields_pre_one_manager_decision_v1(uuid)
  from public, anon, authenticated, service_role;

create function public.refund_purchase_correction_request_fields(p_case_id uuid)
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  case_row public.refund_cases%rowtype;
  candidate_row public.refund_nayax_lookup_candidates%rowtype;
  fields text[];
  candidate_fields text[] := '{}'::text[];
  candidate_count integer := 0;
begin
  fields := public.refund_purchase_correction_request_fields_pre_one_manager_decision_v1(p_case_id);
  if cardinality(fields) > 0 then
    return public.canonical_refund_follow_up_fields(fields);
  end if;

  select * into case_row from public.refund_cases where id = p_case_id;
  if not found
    or case_row.decision is not null
    or case_row.nayax_recommendation_state <> 'ambiguous'
    or case_row.nayax_lookup_status <> 'multiple_matches'
    or case_row.nayax_recommendation_evaluated_at < case_row.deterministic_facts_updated_at then
    return public.canonical_refund_follow_up_fields(fields);
  end if;

  for candidate_row in
    select candidate.*
    from public.refund_nayax_lookup_candidates candidate
    where candidate.refund_case_id = case_row.id
      and candidate.lookup_generation = case_row.nayax_lookup_generation
      and candidate.expires_at > statement_timestamp()
    order by candidate.created_at, candidate.token
  loop
    if candidate_row.evidence_summary ->> 'policy_version' is distinct from '2026-09-05.v11'
      or candidate_row.evidence_summary ->> 'selection_allowed' is distinct from 'false'
      or candidate_row.evidence_summary ->> 'identifier_review_state' is distinct from 'needs_corroboration'
      or public.refund_nayax_candidate_identifier_evidence_state(
        candidate_row.refund_case_id,
        candidate_row.reporting_machine_id,
        candidate_row.site_id,
        candidate_row.machine_authorization_time,
        candidate_row.amount_cents,
        candidate_row.card_last4,
        candidate_row.currency_code,
        candidate_row.evidence_summary
      ) is distinct from 'valid' then
      return public.canonical_refund_follow_up_fields(fields);
    end if;
    candidate_count := candidate_count + 1;
    candidate_fields := candidate_fields || array(
      select jsonb_array_elements_text(
        coalesce(candidate_row.evidence_summary -> 'customer_correction_fields', '[]'::jsonb)
      )
    );
  end loop;

  if candidate_count < 2 then
    return public.canonical_refund_follow_up_fields(fields);
  end if;
  return public.canonical_refund_follow_up_fields(fields || candidate_fields);
end;
$$;
revoke all on function public.refund_purchase_correction_request_fields(uuid)
  from public, anon, authenticated;
grant execute on function public.refund_purchase_correction_request_fields(uuid)
  to service_role;


-- Manager-selected wallet sales use the same exact transaction, duplicate,
-- idempotency, amount, machine and prior-outcome controls as physical cards.
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
    and public.is_review_safe_nayax_transaction_reference(p_case.matched_nayax_transaction_id)
    and p_case.matched_nayax_site_id is not null
    and p_case.matched_nayax_machine_auth_time is not null
    and p_case.matched_nayax_currency_code = 'USD'
    and p_case.refund_amount_cents is not null
    and p_case.refund_amount_cents > 0
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
    );
$$;
revoke execute on function public.refund_nayax_retry_safe_case_is_current(public.refund_cases)
  from public, anon, authenticated, service_role;
