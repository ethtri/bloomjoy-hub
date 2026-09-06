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
  base_selection_allowed boolean;
  expected_selection_allowed boolean;
  neutral_physical_contactless_mismatch boolean;
  conservative_competing_purchase_hold boolean := false;
  rough_same_card_candidate_count integer := 0;
  candidate_already_persisted boolean := false;
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
  base_selection_allowed := expected_selection_allowed;
  if expected_selection_allowed
    and case_row.card_last4 is not null
    and not (
      case_row.incident_time_resolution in ('exact','legacy_absolute')
      and case_row.incident_time_confidence is distinct from 'rough'
    ) then
    select count(*)::integer into rough_same_card_candidate_count
    from public.refund_nayax_lookup_candidates sibling
    where sibling.refund_case_id = case_row.id
      and sibling.lookup_generation = case_row.nayax_lookup_generation
      and sibling.expires_at > statement_timestamp()
      and sibling.card_last4 = case_row.card_last4
      and sibling.amount_cents = p_amount_cents
      and sibling.currency_code = p_currency_code
      and (
        (case_row.reporting_machine_id is not null
          and sibling.reporting_machine_id = case_row.reporting_machine_id)
        or (
          case_row.reporting_machine_id is null
          and case_row.intake_selection_kind = 'livermore_pair'
          and case_row.intake_selection_key = public.refund_livermore_selection_key()
          and case_row.intake_selection_machine_ids = public.refund_livermore_selection_machine_ids()
          and sibling.reporting_machine_id = any(case_row.intake_selection_machine_ids)
          and public.refund_livermore_selection_is_valid()
        )
      )
      and sibling.evidence_summary ->> 'policy_version' = '2026-09-05.v11'
      and sibling.evidence_summary ->> 'card_last4_comparison' = 'exact_support'
      and jsonb_typeof(sibling.evidence_summary -> 'hard_exclusions') = 'array'
      and jsonb_array_length(sibling.evidence_summary -> 'hard_exclusions') = 0
      and (
        sibling.evidence_summary ->> 'selection_allowed' = 'true'
        or (
          sibling.evidence_summary ->> 'selection_allowed' = 'false'
          and sibling.evidence_summary ->> 'identifier_review_state' = 'needs_corroboration'
          and sibling.evidence_summary -> 'customer_correction_fields' = '["incident_time"]'::jsonb
          and coalesce(sibling.evidence_summary -> 'reason_codes','[]'::jsonb)
            ? 'multiple_candidates_need_distinguishing_time'
        )
      );
    if rough_same_card_candidate_count > 1 then
      expected_selection_allowed := false;
    end if;
  end if;
  select exists(
    select 1
    from public.refund_nayax_lookup_candidates persisted
    where persisted.refund_case_id = p_case_id
      and persisted.lookup_generation = case_row.nayax_lookup_generation
      and persisted.reporting_machine_id = p_reporting_machine_id
      and persisted.site_id is not distinct from p_site_id
      and persisted.machine_authorization_time is not distinct from p_machine_authorization_time
      and persisted.amount_cents is not distinct from p_amount_cents
      and persisted.card_last4 is not distinct from p_card_last4
      and persisted.currency_code is not distinct from p_currency_code
      and persisted.evidence_summary = p_evidence
  ) into candidate_already_persisted;
  conservative_competing_purchase_hold :=
    base_selection_allowed
    and selection_allowed is false
    and (rough_same_card_candidate_count > 1 or not candidate_already_persisted)
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
  collision_candidate_count integer := 0;
  grouped_collision_context_compatible boolean := true;
  all_candidates_valid boolean := true;
  any_selection_allowed boolean := false;
  canonical_collision_hold boolean;
  upgrade_collision_hold boolean;
  ignorable_hard_exclusion boolean;
  candidate_in_scope boolean;
  candidate_evidence_state text;
begin
  fields := public.refund_purchase_correction_request_fields_pre_one_manager_decision_v1(p_case_id);
  select * into case_row from public.refund_cases where id = p_case_id;
  if not found
    or case_row.decision is not null
    or case_row.nayax_recommendation_state not in ('ambiguous','manual_exception')
    or case_row.nayax_lookup_status not in ('multiple_matches','manual_exception')
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
    candidate_count := candidate_count + 1;
    candidate_in_scope :=
      (case_row.reporting_machine_id is not null
        and candidate_row.reporting_machine_id = case_row.reporting_machine_id)
      or (
        case_row.reporting_machine_id is null
        and case_row.intake_selection_kind = 'livermore_pair'
        and case_row.intake_selection_key = public.refund_livermore_selection_key()
        and case_row.intake_selection_machine_ids = public.refund_livermore_selection_machine_ids()
        and candidate_row.reporting_machine_id = any(case_row.intake_selection_machine_ids)
        and public.refund_livermore_selection_is_valid()
      );
    candidate_evidence_state := public.refund_nayax_candidate_identifier_evidence_state(
      candidate_row.refund_case_id,
      candidate_row.reporting_machine_id,
      candidate_row.site_id,
      candidate_row.machine_authorization_time,
      candidate_row.amount_cents,
      candidate_row.card_last4,
      candidate_row.currency_code,
      candidate_row.evidence_summary
    );
    canonical_collision_hold :=
      candidate_row.evidence_summary ->> 'selection_allowed' = 'false'
      and candidate_row.evidence_summary ->> 'identifier_review_state' = 'needs_corroboration'
      and candidate_row.evidence_summary -> 'customer_correction_fields' = '["incident_time"]'::jsonb
      and coalesce(candidate_row.evidence_summary -> 'reason_codes','[]'::jsonb)
        ? 'multiple_candidates_need_distinguishing_time'
      and candidate_in_scope
      and candidate_row.card_last4 = case_row.card_last4
      and candidate_row.amount_cents = case_row.payment_amount_cents
      and candidate_row.currency_code = 'USD'
      and candidate_evidence_state = 'valid';
    upgrade_collision_hold :=
      candidate_row.evidence_summary ->> 'selection_allowed' = 'false'
      and case_row.nayax_recommendation_state = 'ambiguous'
      and case_row.nayax_lookup_status = 'multiple_matches'
      and candidate_row.evidence_summary ->> 'policy_version' = '2026-09-05.v11'
      and candidate_row.evidence_summary ->> 'customer_fact_version' = case_row.deterministic_fact_version::text
      and candidate_in_scope
      and case_row.incident_time_confidence = 'rough'
      and case_row.card_last4 is not null
      and candidate_row.card_last4 = case_row.card_last4
      and candidate_row.evidence_summary ->> 'card_last4_comparison' = 'exact_support'
      and jsonb_typeof(candidate_row.evidence_summary -> 'hard_exclusions') = 'array'
      and jsonb_array_length(candidate_row.evidence_summary -> 'hard_exclusions') = 0
      and candidate_row.amount_cents = case_row.payment_amount_cents
      and candidate_row.amount_cents > 0
      and candidate_row.currency_code = 'USD'
      and candidate_row.site_id is not null
      and candidate_row.machine_authorization_time is not null
      and exists (
        select 1
        from public.reporting_machines machine
        where machine.id = candidate_row.reporting_machine_id
          and candidate_row.evidence_summary ->> 'lookup_account_scope' =
            regexp_replace(upper(btrim(machine.nayax_account_key)), '[^A-Z0-9_]', '_', 'g')
          and candidate_row.evidence_summary ->> 'lookup_provider_machine_id' = machine.nayax_machine_id
          and candidate_row.evidence_summary ->> 'provider_machine_id' = machine.nayax_machine_id
      )
      and candidate_row.evidence_summary ->> 'payment_status' = 'approved'
      and candidate_row.evidence_summary ->> 'provider_refund_state' = 'clear'
      and candidate_row.evidence_summary ->> 'duplicate_provider_record' = 'false'
      and (
        (
          candidate_row.evidence_summary ->> 'identifier_review_state' = 'exact_support'
          and coalesce(candidate_row.evidence_summary -> 'customer_correction_fields','[]'::jsonb) = '[]'::jsonb
        )
        or (
          candidate_row.evidence_summary ->> 'identifier_review_state' = 'needs_corroboration'
          and coalesce(candidate_row.evidence_summary -> 'customer_correction_fields','[]'::jsonb)
            = '["card_last4_source"]'::jsonb
        )
      );
    ignorable_hard_exclusion :=
      candidate_evidence_state = 'valid'
      and candidate_row.evidence_summary ->> 'selection_allowed' = 'false'
      and jsonb_typeof(candidate_row.evidence_summary -> 'hard_exclusions') = 'array'
      and jsonb_array_length(candidate_row.evidence_summary -> 'hard_exclusions') > 0;
    if canonical_collision_hold or upgrade_collision_hold then
      collision_candidate_count := collision_candidate_count + 1;
    end if;
    grouped_collision_context_compatible := grouped_collision_context_compatible
      and (canonical_collision_hold or upgrade_collision_hold or ignorable_hard_exclusion);
    all_candidates_valid := all_candidates_valid and candidate_evidence_state = 'valid';
    any_selection_allowed := any_selection_allowed
      or candidate_row.evidence_summary ->> 'selection_allowed' = 'true';
    candidate_fields := candidate_fields || array(
      select jsonb_array_elements_text(
        coalesce(candidate_row.evidence_summary -> 'customer_correction_fields', '[]'::jsonb)
      )
    );
  end loop;

  if any_selection_allowed then return '{}'::text[]; end if;
  if collision_candidate_count >= 2 and grouped_collision_context_compatible then
    return array['incident_time']::text[];
  end if;
  -- Invalid current evidence needs an internal refresh. Do not ask the
  -- customer speculative questions or make old rows selectable.
  if candidate_count > 0 and not all_candidates_valid then
    return '{}'::text[];
  end if;
  if candidate_count > 0 then
    return public.canonical_refund_follow_up_fields(fields || candidate_fields);
  end if;
  return public.canonical_refund_follow_up_fields(fields);
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

-- One ordinary manager confirmation must survive the narrow gap between
-- selecting the exact sale and starting the guarded provider executor. This
-- wrapper commits the existing official approval and an immutable resume
-- marker in one database transaction. It never creates a provider attempt or
-- customer message.
create function public.service_apply_refund_nayax_selection_approval(
  p_authorization_id uuid,
  p_case_id uuid,
  p_assigned_manager_email text default null,
  p_decision_reason text default null,
  p_internal_note text default null,
  p_refund_amount_cents integer default null,
  p_matched_nayax_candidate_token uuid default null,
  p_nayax_disagreement_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  result jsonb;
  case_row public.refund_cases%rowtype;
  authorization_row public.refund_case_official_action_authorizations%rowtype;
  candidate_row public.refund_nayax_lookup_candidates%rowtype;
  scorer_recommendation_state text;
  manager_recommendation_state text;
  manager_execution_eligible boolean := false;
begin
  if p_matched_nayax_candidate_token is null then
    raise exception 'An exact Nayax candidate is required for combined approval'
      using errcode = 'P4600';
  end if;

  result := public.service_apply_refund_official_case_update(
    p_authorization_id,
    p_case_id,
    'approve',
    'card_refund_pending',
    p_assigned_manager_email,
    'approved',
    p_decision_reason,
    p_internal_note,
    p_refund_amount_cents,
    null,
    p_matched_nayax_candidate_token,
    p_nayax_disagreement_reason
  );

  select authorization.* into strict authorization_row
  from public.refund_case_official_action_authorizations authorization
  where authorization.id = p_authorization_id
  for share;
  select candidate.* into strict candidate_row
  from public.refund_nayax_lookup_candidates candidate
  where candidate.token = p_matched_nayax_candidate_token
    and candidate.refund_case_id = p_case_id
    and candidate.actor_user_id = authorization_row.actor_user_id
  for share;
  select refund_case.* into strict case_row
  from public.refund_cases refund_case
  where refund_case.id = p_case_id
  for share;

  if authorization_row.action <> 'approve'
    or authorization_row.status <> 'consumed'
    or case_row.payment_method <> 'card'
    or case_row.status <> 'card_refund_pending'
    or case_row.decision <> 'approved'
    or case_row.correlation_status <> 'matched'
    or case_row.correlation_source <> 'nayax'
    or case_row.matched_nayax_transaction_id is distinct from candidate_row.provider_transaction_id
    or case_row.matched_nayax_site_id is distinct from candidate_row.site_id
    or case_row.matched_nayax_machine_auth_time is distinct from candidate_row.machine_authorization_time
    or case_row.matched_nayax_amount_cents is distinct from candidate_row.amount_cents
    or case_row.matched_nayax_card_last4 is distinct from candidate_row.card_last4
    or case_row.matched_nayax_currency_code is distinct from candidate_row.currency_code
    or case_row.refund_amount_cents is distinct from candidate_row.amount_cents
    or candidate_row.evidence_summary ->> 'selection_allowed' <> 'true'
    or public.refund_nayax_candidate_identifier_evidence_state(
      case_row.id,
      candidate_row.reporting_machine_id,
      candidate_row.site_id,
      candidate_row.machine_authorization_time,
      candidate_row.amount_cents,
      candidate_row.card_last4,
      candidate_row.currency_code,
      candidate_row.evidence_summary
    ) <> 'valid'
    or case_row.nayax_refund_execution_status <> 'not_requested'
    or case_row.reporting_adjustment_id is not null
    or case_row.refund_completed_at is not null
    or public.refund_case_has_unresolved_reconciliation(case_row.id)
    or exists (
      select 1 from public.refund_case_nayax_refund_attempts attempt
      where attempt.refund_case_id = case_row.id
        and attempt.created_at >= candidate_row.created_at
    ) then
    raise exception 'Combined Nayax approval did not preserve a clean exact execution state'
      using errcode = 'P4620';
  end if;

  scorer_recommendation_state := coalesce(
    nullif(btrim(candidate_row.evidence_summary ->> 'recommendation_state'), ''),
    'manual_exception'
  );
  manager_recommendation_state := scorer_recommendation_state;
  manager_execution_eligible := (
    scorer_recommendation_state = 'high_confidence'
    and candidate_row.evidence_summary ->> 'is_recommended' = 'true'
    and candidate_row.evidence_summary ->> 'one_click_eligible' = 'true'
  ) or (
    candidate_row.evidence_summary ->> 'policy_version' = '2026-09-05.v11'
    and candidate_row.evidence_summary ->> 'selection_allowed' = 'true'
    and candidate_row.evidence_summary ->> 'one_click_eligible' = 'false'
    and candidate_row.evidence_summary ->> 'request_time_boundary' in (
      'request_time_unknown','occurrence_time_uncertain'
    )
  );
  if manager_execution_eligible
    and scorer_recommendation_state <> 'high_confidence' then
    manager_recommendation_state := 'manager_confirmed';
  end if;

  update public.refund_cases
  set nayax_recommendation_state = manager_recommendation_state,
      nayax_recommendation_policy_version = candidate_row.evidence_summary ->> 'policy_version',
      nayax_recommendation_evaluated_at = statement_timestamp(),
      nayax_match_execution_eligible = manager_execution_eligible,
      correlation_confidence = 0,
      correlation_summary = 'Machine Manager approved the selected Nayax transaction for guarded execution.'
  where id = case_row.id
  returning * into case_row;

  insert into public.refund_case_events(
    refund_case_id, actor_user_id, event_type, message, metadata
  ) values (
    case_row.id,
    authorization_row.actor_user_id,
    'nayax_refund_execution_authorized',
    'The mapped Machine Manager approved this exact selected Nayax refund for guarded execution.',
    jsonb_build_object(
      'schema_version', 'nayax-selection-approval-v1',
      'case_version', case_row.official_action_version,
      'deterministic_fact_version', case_row.deterministic_fact_version,
      'attempt_generation', case_row.nayax_refund_attempt_generation,
      'transaction_id', case_row.matched_nayax_transaction_id,
      'site_id', case_row.matched_nayax_site_id,
      'machine_authorization_time', case_row.matched_nayax_machine_auth_time,
      'amount_cents', case_row.matched_nayax_amount_cents,
      'card_last4', case_row.matched_nayax_card_last4,
      'currency_code', case_row.matched_nayax_currency_code,
      'authorization_id', authorization_row.id,
      'payload_redacted', true
    )
  );

  return result;
end;
$$;
revoke all on function public.service_apply_refund_nayax_selection_approval(
  uuid,uuid,text,text,text,integer,uuid,text
) from public,anon,authenticated;
grant execute on function public.service_apply_refund_nayax_selection_approval(
  uuid,uuid,text,text,text,integer,uuid,text
) to service_role;

create function public.refund_nayax_current_manager_approval_pending(
  p_user_id uuid,
  p_case_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  case_row public.refund_cases%rowtype;
  marker public.refund_case_events%rowtype;
  approval public.refund_case_official_action_authorizations%rowtype;
begin
  select refund_case.* into case_row
  from public.refund_cases refund_case
  where refund_case.id = p_case_id;
  if not found then return false; end if;

  select event.* into marker
  from public.refund_case_events event
  where event.refund_case_id = case_row.id
    and event.event_type = 'nayax_refund_execution_authorized'
  order by event.created_at desc, event.id desc
  limit 1;
  if not found then return false; end if;

  if coalesce(marker.metadata ->> 'authorization_id','') !~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    return false;
  end if;
  select authorization.* into approval
  from public.refund_case_official_action_authorizations authorization
  where authorization.id = (marker.metadata ->> 'authorization_id')::uuid;
  if not found then return false; end if;

  return public.can_perform_refund_official_action(p_user_id, case_row.id)
    and approval.refund_case_id = case_row.id
    and approval.action = 'approve'
    and approval.status = 'consumed'
    and approval.actor_user_id = marker.actor_user_id
    and approval.manager_mapping_id is not null
    and approval.manager_mapping_version > 0
    and marker.metadata ->> 'schema_version' = 'nayax-selection-approval-v1'
    and marker.metadata ->> 'payload_redacted' = 'true'
    and marker.metadata ->> 'case_version' ~ '^[0-9]+$'
    and (marker.metadata ->> 'case_version')::bigint = case_row.official_action_version
    and marker.metadata ->> 'deterministic_fact_version' ~ '^[0-9]+$'
    and (marker.metadata ->> 'deterministic_fact_version')::bigint = case_row.deterministic_fact_version
    and marker.metadata ->> 'attempt_generation' ~ '^[0-9]+$'
    and (marker.metadata ->> 'attempt_generation')::integer = case_row.nayax_refund_attempt_generation
    and marker.metadata ->> 'transaction_id' is not distinct from case_row.matched_nayax_transaction_id
    and marker.metadata ->> 'site_id' ~ '^[0-9]+$'
    and (marker.metadata ->> 'site_id')::integer is not distinct from case_row.matched_nayax_site_id
    and (marker.metadata ->> 'machine_authorization_time')::timestamptz
      is not distinct from case_row.matched_nayax_machine_auth_time
    and marker.metadata ->> 'amount_cents' ~ '^[1-9][0-9]*$'
    and (marker.metadata ->> 'amount_cents')::integer is not distinct from case_row.matched_nayax_amount_cents
    and marker.metadata ->> 'card_last4' is not distinct from case_row.matched_nayax_card_last4
    and marker.metadata ->> 'currency_code' is not distinct from case_row.matched_nayax_currency_code
    and case_row.payment_method = 'card'
    and case_row.status = 'card_refund_pending'
    and case_row.decision = 'approved'
    and case_row.correlation_status = 'matched'
    and case_row.correlation_source = 'nayax'
    and case_row.refund_amount_cents is not null
    and case_row.refund_amount_cents = case_row.matched_nayax_amount_cents
    and case_row.nayax_refund_execution_status = 'not_requested'
    and case_row.reporting_adjustment_id is null
    and case_row.refund_completed_at is null
    and not public.refund_case_has_unresolved_reconciliation(case_row.id)
    and not exists (
      select 1 from public.refund_case_nayax_refund_attempts attempt
      where attempt.refund_case_id = case_row.id
        and attempt.created_at >= marker.created_at
    );
exception when invalid_text_representation or datetime_field_overflow then
  return false;
end;
$$;
revoke all on function public.refund_nayax_current_manager_approval_pending(uuid,uuid)
  from public,anon,authenticated,service_role;

-- The existing reservation kernel historically recorded a second approval and
-- changed decided_by to the manager who happened to start provider execution.
-- A current immutable selection-approval marker already contains the business
-- decision. Preserve that approver and record the current manager only as the
-- executor who continued the guarded attempt.
do $$
declare
  function_definition text;
  decision_actor_anchor text := $anchor$    decided_by = p_actor_user_id,
    decided_at = coalesce(decided_at, authorized_at)$anchor$;
  decision_actor_replacement text := $replacement$    decided_by = case
      when public.refund_nayax_current_manager_approval_pending(
        p_actor_user_id, refund_case.id
      ) then coalesce(refund_case.decided_by, p_actor_user_id)
      else p_actor_user_id
    end,
    decided_at = case
      when public.refund_nayax_current_manager_approval_pending(
        p_actor_user_id, refund_case.id
      ) then refund_case.decided_at
      else coalesce(refund_case.decided_at, authorized_at)
    end$replacement$;
  version_anchor text := $anchor$  if refund_case.official_action_version is distinct from p_expected_case_version then
    raise exception 'Refund case changed since review; reload before refunding';
  end if;

  select configured_machine.*$anchor$;
  version_replacement text := $replacement$  if refund_case.official_action_version is distinct from p_expected_case_version then
    raise exception 'Refund case changed since review; reload before refunding';
  end if;

  if exists (
    select 1
    from public.refund_case_events marker
    where marker.refund_case_id = refund_case.id
      and marker.event_type = 'nayax_refund_execution_authorized'
      and marker.metadata ->> 'case_version' ~ '^[0-9]+$'
      and (marker.metadata ->> 'case_version')::bigint = refund_case.official_action_version
      and marker.metadata ->> 'attempt_generation' ~ '^[0-9]+$'
      and (marker.metadata ->> 'attempt_generation')::integer = refund_case.nayax_refund_attempt_generation
      and marker.metadata ->> 'transaction_id' is not distinct from refund_case.matched_nayax_transaction_id
      and marker.metadata ->> 'site_id' ~ '^[0-9]+$'
      and (marker.metadata ->> 'site_id')::integer is not distinct from refund_case.matched_nayax_site_id
      and (marker.metadata ->> 'machine_authorization_time')::timestamptz
        is not distinct from refund_case.matched_nayax_machine_auth_time
      and marker.metadata ->> 'amount_cents' ~ '^[1-9][0-9]*$'
      and (marker.metadata ->> 'amount_cents')::integer is not distinct from refund_case.matched_nayax_amount_cents
      and marker.metadata ->> 'currency_code' is not distinct from refund_case.matched_nayax_currency_code
  ) and not public.refund_nayax_current_manager_approval_pending(
    p_actor_user_id, refund_case.id
  ) then
    raise exception 'Saved Nayax approval changed before execution; reload for review'
      using errcode = 'P4620';
  end if;

  select configured_machine.*$replacement$;
  approval_event_anchor text := $anchor$    'official_action_committed',
    'The mapped Machine Manager approved this exact Nayax refund.',
    jsonb_build_object(
      'action', 'nayax_execute',$anchor$;
  approval_event_replacement text := $replacement$    case
      when public.refund_nayax_current_manager_approval_pending(
        p_actor_user_id, refund_case.id
      ) then 'nayax_refund_execution_continued'
      else 'official_action_committed'
    end,
    case
      when public.refund_nayax_current_manager_approval_pending(
        p_actor_user_id, refund_case.id
      ) then 'The current mapped Machine Manager continued a previously approved exact Nayax refund.'
      else 'The mapped Machine Manager approved this exact Nayax refund.'
    end,
    jsonb_build_object(
      'action', 'nayax_execute',
      'business_approval_reused', public.refund_nayax_current_manager_approval_pending(
        p_actor_user_id, refund_case.id
      ),$replacement$;
begin
  function_definition := replace(pg_catalog.pg_get_functiondef(
    'public.service_reserve_nayax_refund_manager_action(text,uuid,uuid,bigint,text,integer,integer,integer,text)'::regprocedure
  ), E'\r\n', E'\n');
  if length(function_definition) - length(replace(
      function_definition, decision_actor_anchor, ''
    )) <> length(decision_actor_anchor)
    or length(function_definition) - length(replace(
      function_definition, version_anchor, ''
    )) <> length(version_anchor)
    or length(function_definition) - length(replace(
      function_definition, approval_event_anchor, ''
    )) <> length(approval_event_anchor) then
    raise exception 'Exact saved-approval reservation anchors required';
  end if;
  function_definition := replace(
    function_definition, decision_actor_anchor, decision_actor_replacement
  );
  function_definition := replace(
    function_definition, version_anchor, version_replacement
  );
  function_definition := replace(
    function_definition, approval_event_anchor, approval_event_replacement
  );
  execute function_definition;
end;
$$;

-- Keep the existing readiness contract and OID used by all overview wrappers;
-- append only the fail-closed reload-resume signal.
do $$
declare
  function_definition text;
  anchor text := $anchor$    'caseVersion', refund_case.official_action_version,
    'accountCircuitBreakerActive', false
  );$anchor$;
  replacement text := $replacement$    'caseVersion', refund_case.official_action_version,
    'accountCircuitBreakerActive', false,
    'approvalPendingExecution', public.refund_nayax_current_manager_approval_pending(
      p_user_id, refund_case.id
    )
  );$replacement$;
begin
  function_definition := replace(pg_catalog.pg_get_functiondef(
    'public.refund_case_nayax_manager_readiness(uuid,uuid)'::regprocedure
  ), E'\r\n', E'\n');
  if length(function_definition) - length(replace(function_definition, anchor, ''))
      <> length(anchor) then
    raise exception 'Exact Nayax manager readiness return anchor required';
  end if;
  execute replace(function_definition, anchor, replacement);
end;
$$;

-- This migration intentionally follows the correction-overview wrapper. Re-run
-- that exact final definition after replacing the helper so its compiled plan
-- resolves the current correction-only compatibility function.
do $$
declare
  overview_definition text;
begin
  overview_definition := pg_catalog.pg_get_functiondef(
    'public.admin_get_refund_operations_overview()'::regprocedure
  );
  if position('refund_purchase_correction_request_fields' in overview_definition) = 0 then
    raise exception 'Final refund overview must retain current correction helper binding';
  end if;
  execute overview_definition;
end;
$$;
