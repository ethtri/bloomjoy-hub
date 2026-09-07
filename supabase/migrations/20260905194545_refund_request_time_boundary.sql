-- #1165: bind matching to the first reliable server-observed customer request.
-- Ordered immediately after the production-recorded structured-context migration
-- (20260905190311), whose canonical source was recovered read-only.
-- Provider record delivery/import time is deliberately absent from this contract.

alter table public.refund_cases
  add column customer_request_received_at timestamptz,
  add column customer_request_received_source text,
  add constraint refund_cases_customer_request_received_pair check (
    num_nonnulls(customer_request_received_at, customer_request_received_source) in (0, 2)
  ),
  add constraint refund_cases_customer_request_received_source check (
    customer_request_received_source is null
    or customer_request_received_source in ('hosted_refund_intake', 'gmail_contact_ingested')
  );

comment on column public.refund_cases.customer_request_received_at is
  'Immutable first reliable server-observed receipt of the customer refund request. Never browser, correction, updated_at, or provider record-arrival time.';
comment on column public.refund_cases.customer_request_received_source is
  'Provenance for customer_request_received_at. Null on legacy/imported cases without a reliable request receipt.';

create function public.guard_refund_customer_request_received()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT'
    and new.customer_request_received_at is null
    and new.intake_source = 'form'
    and new.intake_meta ->> 'source' = 'hosted_refund_intake' then
    new.customer_request_received_at := statement_timestamp();
    new.customer_request_received_source := 'hosted_refund_intake';
  end if;

  if tg_op = 'UPDATE' and old.customer_request_received_at is not null and (
    new.customer_request_received_at is distinct from old.customer_request_received_at
    or new.customer_request_received_source is distinct from old.customer_request_received_source
  ) then
    raise exception 'The original customer request receipt is immutable' using errcode = 'P4625';
  end if;

  if new.customer_request_received_at is not null and (
    not isfinite(new.customer_request_received_at)
    or new.incident_at > new.customer_request_received_at + interval '1 minute'
  ) then
    raise exception 'The reported purchase time cannot be after Bloomjoy received the request'
      using errcode = 'P4625';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_refund_customer_request_received()
  from public, anon, authenticated;
create trigger aa_refund_customer_request_received
before insert or update of customer_request_received_at, customer_request_received_source, incident_at
on public.refund_cases for each row
execute function public.guard_refund_customer_request_received();

-- The current public wrapper owns location selection. Add the email contact's
-- immutable database ingestion time after the delegated create/dedupe result.
create or replace function public.service_create_refund_case_from_gmail_contact_form(
  p_token_hash text,
  p_customer_email text,
  p_case_values jsonb
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  selection_kind text := nullif(btrim(p_case_values ->> 'intakeSelectionKind'), '');
  selection_key text := nullif(btrim(p_case_values ->> 'intakeSelectionKey'), '');
  selection_machine_ids uuid[];
  delegated_values jsonb := p_case_values;
  result jsonb;
  refund_case_id uuid;
  contact_received_at timestamptz;
begin
  select contact.created_at into contact_received_at
  from public.refund_gmail_intake_contact_links link
  join public.refund_gmail_intake_contacts contact on contact.id = link.contact_id
  where link.token_hash = lower(p_token_hash);

  select coalesce(array_agg(value::uuid order by ordinality), '{}'::uuid[])
  into selection_machine_ids
  from jsonb_array_elements_text(
    coalesce(p_case_values -> 'intakeSelectionMachineIds', '[]'::jsonb)
  ) with ordinality as item(value, ordinality);

  if selection_kind = 'livermore_pair' then
    if selection_key <> public.refund_livermore_selection_key()
      or selection_machine_ids <> public.refund_livermore_selection_machine_ids()
      or not public.refund_livermore_selection_is_valid() then
      return null;
    end if;
    delegated_values := jsonb_set(
      delegated_values, '{reportingMachineId}',
      to_jsonb(selection_machine_ids[1]::text), true
    );
  end if;

  result := public.service_create_refund_case_from_gmail_contact_form_pre_selection_v1(
    p_token_hash, p_customer_email, delegated_values
  );
  refund_case_id := nullif(result ->> 'id', '')::uuid;
  if refund_case_id is null then return null; end if;

  update public.refund_cases
  set
    reporting_machine_id = case when selection_kind = 'livermore_pair' then null else reporting_machine_id end,
    intake_selection_key = selection_key,
    intake_selection_kind = selection_kind,
    intake_selection_machine_ids = nullif(selection_machine_ids, '{}'::uuid[]),
    card_last4_source = nullif(btrim(p_case_values ->> 'cardLast4Source'), ''),
    card_last4_provenance = case nullif(btrim(p_case_values ->> 'cardLast4Source'), '')
      when 'physical_card' then 'physical_card'
      when 'wallet_device' then case
        when p_case_values ->> 'paymentInteraction' = 'phone_watch_wallet'
          then 'wallet_device_token'
      end
      when 'bank_record' then null
      when 'unknown' then null
      else card_last4_provenance
    end,
    wallet_device_kind = nullif(btrim(p_case_values ->> 'walletDeviceKind'), ''),
    incident_time_source = nullif(btrim(p_case_values ->> 'incidentTimeSource'), ''),
    nearby_attempt_count = nullif(btrim(p_case_values ->> 'nearbyAttemptCount'), ''),
    customer_request_received_at = coalesce(customer_request_received_at, contact_received_at),
    customer_request_received_source = case
      when customer_request_received_at is not null then customer_request_received_source
      when contact_received_at is not null then 'gmail_contact_ingested'
      else null
    end,
    updated_at = statement_timestamp()
  where id = refund_case_id;

  return result;
end;
$$;
revoke all on function public.service_create_refund_case_from_gmail_contact_form(text,text,jsonb)
  from public, anon, authenticated;
grant execute on function public.service_create_refund_case_from_gmail_contact_form(text,text,jsonb)
  to service_role;

-- Pure evidence validator shared by insert and selection guards. Unknown request
-- or provider time remains selectable for review but cannot be one-click.
create function public.refund_nayax_request_boundary_evidence_state(
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
  if p_evidence ->> 'policy_version' is distinct from '2026-09-05.v8' then
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

-- Existing cases predate the dedicated receipt anchor. Preserve their selected
-- transaction and manager-review path, but remove any stale execution claim.
update public.refund_cases as case_row
set nayax_match_execution_eligible = false
where case_row.customer_request_received_at is null
  and case_row.nayax_match_execution_eligible = true
  -- An authoritative receipt is the durable boundary for a confirmed refund.
  -- Its accounting-review state is immutable and must not be rewritten by a
  -- later matching migration, even if the older case has no request anchor.
  and not exists (
    select 1
    from public.refund_authoritative_receipts receipt
    where receipt.refund_case_id = case_row.id
  );

create function public.guard_refund_nayax_candidate_request_boundary()
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
  if new.evidence_summary ->> 'source' = 'manual_nayax_portal'
    and case_row.customer_request_received_at is not null
    and new.machine_authorization_time > case_row.customer_request_received_at then
    raise exception 'Transaction occurred after Bloomjoy received the customer request'
      using errcode = 'P4625';
  end if;
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
create trigger zzy_refund_nayax_candidate_request_boundary
before insert on public.refund_nayax_lookup_candidates for each row
execute function public.guard_refund_nayax_candidate_request_boundary();

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
  manual_portal_candidate boolean := false;
  exact_replay boolean := false;
  evidence_state text;
begin
  select c.* into case_row from public.refund_cases c where c.id = p_case_id for update;
  if not found then raise exception 'Refund case not found' using errcode = 'P4600'; end if;
  select candidate.* into candidate_row from public.refund_nayax_lookup_candidates candidate
  where candidate.token = p_candidate_token and candidate.refund_case_id = case_row.id for share;
  if not found then
    raise exception 'Nayax lookup evidence expired or belongs to another review session' using errcode = 'P4602';
  end if;
  manual_portal_candidate := coalesce(candidate_row.evidence_summary ->> 'source' = 'manual_nayax_portal', false);
  exact_replay := case_row.matched_nayax_transaction_id = candidate_row.provider_transaction_id
    and case_row.matched_nayax_machine_auth_time = candidate_row.machine_authorization_time
    and case_row.matched_nayax_amount_cents = candidate_row.amount_cents;
  if not manual_portal_candidate and not exact_replay and (
    candidate_row.lookup_generation <> case_row.nayax_lookup_generation
    or case_row.nayax_lookup_status = 'checking'
  ) then
    raise exception 'A newer Nayax lookup replaced this transaction evidence' using errcode = 'P4602';
  end if;
  evidence_state := public.refund_nayax_request_boundary_evidence_state(
    case_row.customer_request_received_at, case_row.customer_request_received_source,
    candidate_row.evidence_summary
  );
  if manual_portal_candidate
    and case_row.customer_request_received_at is not null
    and candidate_row.machine_authorization_time > case_row.customer_request_received_at then
    raise exception 'Transaction occurred after Bloomjoy received the customer request'
      using errcode = 'P4625';
  end if;
  if evidence_state = 'legacy'
    and candidate_row.evidence_summary ->> 'one_click_eligible' = 'true' then
    raise exception 'Refresh Nayax transactions to bind the customer request time'
      using errcode = 'P4625';
  end if;
  if evidence_state in ('refresh', 'invalid', 'after_request') then
    raise exception '%', case evidence_state
      when 'after_request' then 'Transaction occurred after Bloomjoy received the customer request'
      when 'refresh' then 'Refresh Nayax transactions to bind the customer request time'
      else 'Invalid customer request time evidence' end using errcode = 'P4625';
  end if;
  return public.service_select_refund_nayax_candidate_as_actor_pre_lookup_generation_v1(
    p_actor_user_id, p_case_id, p_expected_case_version,
    p_candidate_token, p_nayax_disagreement_reason
  );
end;
$$;
revoke all on function public.service_select_refund_nayax_candidate_as_actor(uuid,uuid,bigint,uuid,text)
  from public, anon, authenticated;
grant execute on function public.service_select_refund_nayax_candidate_as_actor(uuid,uuid,bigint,uuid,text)
  to service_role;

create function public.guard_refund_nayax_selected_request_boundary()
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
      if evidence ->> 'source' = 'manual_nayax_portal'
        and new.customer_request_received_at is not null
        and candidate_time > new.customer_request_received_at then
        raise exception 'Nayax request-time evidence is not safe; refresh current evidence'
          using errcode = 'P4625';
      end if;
      if evidence_state in ('refresh', 'invalid', 'after_request') then
        raise exception 'Nayax request-time evidence is not safe; refresh current evidence' using errcode = 'P4625';
      end if;
      if evidence_state = 'legacy' or evidence ->> 'one_click_eligible' = 'false' then
        new.nayax_match_execution_eligible := false;
      end if;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.guard_refund_nayax_selected_request_boundary()
  from public, anon, authenticated;
create trigger zzz_refund_nayax_selected_request_boundary
before update of reporting_machine_id,matched_nayax_transaction_id,matched_nayax_site_id,
  matched_nayax_machine_auth_time,matched_nayax_amount_cents,matched_nayax_card_last4,
  matched_nayax_currency_code on public.refund_cases for each row
execute function public.guard_refund_nayax_selected_request_boundary();

-- Add bounded request-time metrics to the redacted lookup diagnostic while
-- retaining v1/v2 callers during function/database rollout.
create or replace function public.service_commit_refund_nayax_lookup_with_diagnostics(
  p_refund_case_id uuid,
  p_lookup_generation bigint,
  p_expected_fact_version bigint,
  p_lookup_status text,
  p_recommendation_state text,
  p_policy_version text,
  p_last_checked_at timestamptz,
  p_summary text,
  p_resolved_machine_id uuid,
  p_candidate_count integer,
  p_trigger_source text,
  p_actor_user_id uuid,
  p_diagnostics jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  result jsonb;
  key text;
  raw_count integer;
  parseable_count integer;
  window_count integer;
  excluded_count integer;
  uncertain_count integer;
  hours numeric;
  incident timestamptz;
  submitted_request_at timestamptz;
  previous jsonb;
  has_previous boolean;
  schema_version text := p_diagnostics ->> 'schemaVersion';
  is_v2 boolean := coalesce(schema_version = 'nayax_lookup_diagnostics_v2', false);
  is_v3 boolean := coalesce(schema_version = 'nayax_lookup_diagnostics_v3', false);
  has_clock_contexts boolean;
  clock_context jsonb;
  expected_machine_ids uuid[];
  submitted_machine_ids uuid[];
  case_row public.refund_cases%rowtype;
begin
  if p_diagnostics is not null then
    has_clock_contexts := is_v2 or is_v3;
    if jsonb_typeof(p_diagnostics) is distinct from 'object'
      or schema_version is null
      or schema_version not in ('nayax_lookup_diagnostics_v1','nayax_lookup_diagnostics_v2','nayax_lookup_diagnostics_v3')
      or (select count(*) from jsonb_object_keys(p_diagnostics)) <>
        (case when is_v3 then 21 when is_v2 then 17 else 16 end)
      or not p_diagnostics ?& array['schemaVersion','endpoint','historicalCoverage',
        'providerRecordCount','providerParseableRecordCount','providerWindowRecordCount',
        'windowHours','incidentAt','windowStart','windowEnd','incidentTimeResolution',
        'incidentTimeConfidence','locationTimezone','providerTimePolicy','machineTimezoneSource','providerPayloadRedacted']
      or (is_v3 and not p_diagnostics ?& array['providerClockContexts','customerRequestReceivedAt',
        'customerRequestReceivedSource','excludedAfterRequestCount','uncertainRequestTimeCandidateCount'])
      or p_diagnostics ->> 'endpoint' is distinct from 'machine_last_sales'
      or p_diagnostics ->> 'historicalCoverage' is distinct from 'unknown'
      or p_diagnostics -> 'providerPayloadRedacted' is distinct from 'true'::jsonb then
      raise exception 'Invalid bounded lookup diagnostics' using errcode = 'P4623';
    end if;
    if is_v2 and (
      p_diagnostics ->> 'providerTimePolicy' is distinct from 'authorization_gmt_else_provider_clock_else_unverified_location'
      or p_diagnostics ->> 'machineTimezoneSource' is distinct from 'per_machine_provider_clock_contexts'
    ) then raise exception 'Invalid bounded lookup diagnostics' using errcode = 'P4623'; end if;
    if not is_v2 and not is_v3 and (
      p_diagnostics ->> 'providerTimePolicy' is distinct from 'authorization_gmt_else_mapped_machine_clock'
      or p_diagnostics ->> 'machineTimezoneSource' is distinct from 'configured_location_not_verified_provider_clock'
    ) then raise exception 'Invalid bounded lookup diagnostics' using errcode = 'P4623'; end if;
    if has_clock_contexts and jsonb_typeof(p_diagnostics -> 'providerClockContexts') is distinct from 'array' then
      raise exception 'Invalid provider clock contexts' using errcode = 'P4624';
    end if;
    if is_v2 and jsonb_array_length(p_diagnostics -> 'providerClockContexts') not between 1 and 2 then
      raise exception 'Invalid provider clock context count' using errcode = 'P4624';
    end if;
    if is_v3 then
      if jsonb_array_length(p_diagnostics -> 'providerClockContexts') = 0 then
        if p_lookup_status <> 'setup_needed'
          or p_diagnostics ->> 'providerTimePolicy' is distinct from 'authorization_gmt_else_mapped_machine_clock'
          or p_diagnostics ->> 'machineTimezoneSource' is distinct from 'configured_location_not_verified_provider_clock' then
          raise exception 'Missing provider clock contexts for configured lookup' using errcode = 'P4624';
        end if;
      elsif jsonb_array_length(p_diagnostics -> 'providerClockContexts') between 1 and 2 then
        if p_diagnostics ->> 'providerTimePolicy' is distinct from 'authorization_gmt_else_provider_clock_else_unverified_location'
          or p_diagnostics ->> 'machineTimezoneSource' is distinct from 'per_machine_provider_clock_contexts' then
          raise exception 'Invalid v3 provider time policy' using errcode = 'P4624';
        end if;
      else raise exception 'Invalid provider clock context count' using errcode = 'P4624'; end if;
    end if;

    foreach key in array array['providerRecordCount','providerParseableRecordCount','providerWindowRecordCount'] loop
      if p_diagnostics -> key <> 'null'::jsonb and (
        jsonb_typeof(p_diagnostics -> key) <> 'number' or (p_diagnostics ->> key) !~ '^[0-9]{1,6}$'
      ) then raise exception 'Invalid lookup diagnostic count' using errcode = 'P4623'; end if;
    end loop;
    raw_count := (p_diagnostics ->> 'providerRecordCount')::integer;
    parseable_count := (p_diagnostics ->> 'providerParseableRecordCount')::integer;
    window_count := (p_diagnostics ->> 'providerWindowRecordCount')::integer;
    if num_nonnulls(raw_count,parseable_count,window_count) not in (0,3)
      or raw_count < parseable_count or parseable_count < window_count
      or (raw_count is null and p_lookup_status <> 'setup_needed') then
      raise exception 'Inconsistent lookup diagnostic counts' using errcode = 'P4623';
    end if;
    if is_v3 then
      foreach key in array array['excludedAfterRequestCount','uncertainRequestTimeCandidateCount'] loop
        if p_diagnostics -> key <> 'null'::jsonb and (
          jsonb_typeof(p_diagnostics -> key) <> 'number' or (p_diagnostics ->> key) !~ '^[0-9]{1,6}$'
        ) then raise exception 'Invalid request-time diagnostic count' using errcode = 'P4623'; end if;
      end loop;
      excluded_count := (p_diagnostics ->> 'excludedAfterRequestCount')::integer;
      uncertain_count := (p_diagnostics ->> 'uncertainRequestTimeCandidateCount')::integer;
      if num_nonnulls(excluded_count, uncertain_count) not in (0,2)
        or (window_count is not null and (excluded_count > window_count or uncertain_count > window_count))
        or (excluded_count is null and p_lookup_status <> 'setup_needed') then
        raise exception 'Inconsistent request-time diagnostic counts' using errcode = 'P4623';
      end if;
    end if;
    if jsonb_typeof(p_diagnostics -> 'windowHours') <> 'number'
      or (p_diagnostics ->> 'windowHours') !~ '^[0-9]{1,2}([.][0-9]{1,8})?$'
      or jsonb_typeof(p_diagnostics -> 'incidentAt') <> 'string'
      or jsonb_typeof(p_diagnostics -> 'windowStart') <> 'string'
      or jsonb_typeof(p_diagnostics -> 'windowEnd') <> 'string'
      or jsonb_typeof(p_diagnostics -> 'incidentTimeResolution') <> 'string'
      or jsonb_typeof(p_diagnostics -> 'incidentTimeConfidence') <> 'string'
      or p_diagnostics ->> 'incidentTimeResolution' not in ('exact','ambiguous','nonexistent','invalid_local_time','invalid_timezone','legacy_absolute','missing','unknown')
      or p_diagnostics ->> 'incidentTimeConfidence' not in ('exact','within_15_minutes','within_1_hour','rough','unknown')
      or (p_diagnostics -> 'locationTimezone' <> 'null'::jsonb and not exists (
        select 1 from pg_catalog.pg_timezone_names zone where zone.name = p_diagnostics ->> 'locationTimezone'
      )) then raise exception 'Invalid lookup time provenance' using errcode = 'P4623'; end if;
    hours := (p_diagnostics ->> 'windowHours')::numeric;
    begin
      incident := (p_diagnostics ->> 'incidentAt')::timestamptz;
      if hours not between 1 and 24 or not isfinite(incident)
        or (p_diagnostics ->> 'windowStart')::timestamptz is distinct from incident - hours * interval '1 hour'
        or (p_diagnostics ->> 'windowEnd')::timestamptz is distinct from incident + hours * interval '1 hour' then
        raise exception 'Invalid lookup window' using errcode = 'P4623';
      end if;
    exception when invalid_datetime_format or datetime_field_overflow then
      raise exception 'Invalid lookup window' using errcode = 'P4623';
    end;
  end if;

  if is_v2 or is_v3 then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('refund-nayax-lookup-v1|' || p_refund_case_id::text, 0));
    select c.* into case_row from public.refund_cases c where c.id = p_refund_case_id for update;
    expected_machine_ids := case when case_row.reporting_machine_id is not null
      then array[case_row.reporting_machine_id] else case_row.intake_selection_machine_ids end;
  end if;
  if is_v3 then
    if case_row.customer_request_received_at is null then
      if p_diagnostics -> 'customerRequestReceivedAt' <> 'null'::jsonb
        or p_diagnostics -> 'customerRequestReceivedSource' <> 'null'::jsonb then
        raise exception 'Lookup request receipt does not match the case' using errcode = 'P4625';
      end if;
    else
      if jsonb_typeof(p_diagnostics -> 'customerRequestReceivedAt') is distinct from 'string'
        or jsonb_typeof(p_diagnostics -> 'customerRequestReceivedSource') is distinct from 'string'
        or p_diagnostics ->> 'customerRequestReceivedSource' is distinct from case_row.customer_request_received_source then
        raise exception 'Lookup request receipt does not match the case' using errcode = 'P4625';
      end if;
      begin submitted_request_at := (p_diagnostics ->> 'customerRequestReceivedAt')::timestamptz;
      exception when invalid_datetime_format or datetime_field_overflow then
        raise exception 'Invalid lookup request receipt' using errcode = 'P4625'; end;
      if submitted_request_at is distinct from case_row.customer_request_received_at then
        raise exception 'Lookup request receipt does not match the case' using errcode = 'P4625';
      end if;
    end if;
  end if;

  result := public.service_commit_refund_nayax_lookup(
    p_refund_case_id,p_lookup_generation,p_expected_fact_version,p_lookup_status,
    p_recommendation_state,p_policy_version,p_last_checked_at,p_summary,
    p_resolved_machine_id,p_candidate_count,p_trigger_source,p_actor_user_id
  );
  if result ->> 'applied' is distinct from 'true' or p_diagnostics is null then return result; end if;
  if incident is distinct from (select c.incident_at from public.refund_cases c where c.id = p_refund_case_id) then
    raise exception 'Lookup diagnostic incident changed' using errcode = 'P4623';
  end if;
  select e.metadata -> 'diagnostics' into previous from public.refund_case_events e
  where e.refund_case_id = p_refund_case_id and e.event_type = 'nayax_lookup_diagnostics'
    and e.metadata ->> 'lookup_generation' = p_lookup_generation::text;
  has_previous := found;
  if has_previous and previous is distinct from p_diagnostics then
    raise exception 'Lookup diagnostic replay changed' using errcode = 'P4623';
  end if;
  if (is_v2 or is_v3) and not has_previous
    and jsonb_array_length(p_diagnostics -> 'providerClockContexts') > 0 then
    submitted_machine_ids := array[]::uuid[];
    for clock_context in select value from jsonb_array_elements(p_diagnostics -> 'providerClockContexts')
      order by value ->> 'reportingMachineId' loop
      if jsonb_typeof(clock_context) is distinct from 'object'
        or coalesce(clock_context ->> 'reportingMachineId','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        or not ((clock_context ->> 'reportingMachineId')::uuid = any(expected_machine_ids))
        or public.refund_nayax_provider_clock_context_matches((clock_context ->> 'reportingMachineId')::uuid, clock_context) is not true then
        raise exception 'Provider clock context changed or is outside current lookup scope' using errcode = 'P4624';
      end if;
      submitted_machine_ids := array_append(submitted_machine_ids, (clock_context ->> 'reportingMachineId')::uuid);
    end loop;
    if (select array_agg(id order by id) from unnest(submitted_machine_ids) id)
      is distinct from (select array_agg(id order by id) from unnest(expected_machine_ids) id) then
      raise exception 'Provider clock contexts do not cover the exact lookup scope' using errcode = 'P4624';
    end if;
  end if;
  if not has_previous then
    insert into public.refund_case_events(refund_case_id,actor_user_id,event_type,message,metadata)
    values(p_refund_case_id,p_actor_user_id,'nayax_lookup_diagnostics',
      'Bloomjoy retained bounded recent-sales coverage diagnostics; historical coverage remains unknown.',
      jsonb_build_object('lookup_generation',p_lookup_generation,'deterministic_fact_version',p_expected_fact_version,
        'diagnostics',p_diagnostics,'payload_redacted',true));
  end if;
  return result;
end;
$$;
revoke all on function public.service_commit_refund_nayax_lookup_with_diagnostics(
  uuid,bigint,bigint,text,text,text,timestamptz,text,uuid,integer,text,uuid,jsonb)
  from public,anon,authenticated,service_role;
grant execute on function public.service_commit_refund_nayax_lookup_with_diagnostics(
  uuid,bigint,bigint,text,text,text,timestamptz,text,uuid,integer,text,uuid,jsonb)
  to service_role;

select pg_notify('pgrst', 'reload schema');
