-- Preserve bounded response diagnostics in the existing case event stream.
-- The canonical commit owns all lifecycle/approval/payment guards and locks.
-- Old deployed callers keep their existing signature and behavior.
create function public.service_commit_refund_nayax_lookup_with_diagnostics(
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
  hours numeric;
  incident timestamptz;
  previous jsonb;
  has_previous boolean;
begin
  if p_diagnostics is not null then
    if jsonb_typeof(p_diagnostics) is distinct from 'object'
      or (select count(*) from jsonb_object_keys(p_diagnostics)) <> 16
      or not p_diagnostics ?& array['schemaVersion','endpoint','historicalCoverage',
        'providerRecordCount','providerParseableRecordCount','providerWindowRecordCount',
        'windowHours','incidentAt','windowStart','windowEnd','incidentTimeResolution',
        'incidentTimeConfidence','locationTimezone','providerTimePolicy','machineTimezoneSource','providerPayloadRedacted']
      or p_diagnostics->>'schemaVersion' is distinct from 'nayax_lookup_diagnostics_v1'
      or p_diagnostics->>'endpoint' is distinct from 'machine_last_sales'
      or p_diagnostics->>'historicalCoverage' is distinct from 'unknown'
      or p_diagnostics->>'providerTimePolicy' is distinct from 'authorization_gmt_else_mapped_machine_clock'
      or p_diagnostics->>'machineTimezoneSource' is distinct from 'configured_location_not_verified_provider_clock'
      or p_diagnostics->'providerPayloadRedacted' is distinct from 'true'::jsonb then
      raise exception 'Invalid bounded lookup diagnostics' using errcode = 'P4623';
    end if;
    foreach key in array array['providerRecordCount','providerParseableRecordCount','providerWindowRecordCount'] loop
      if p_diagnostics->key <> 'null'::jsonb and (
        jsonb_typeof(p_diagnostics->key) <> 'number'
        or (p_diagnostics->>key) !~ '^[0-9]{1,6}$'
      ) then
        raise exception 'Invalid lookup diagnostic count' using errcode = 'P4623';
      end if;
    end loop;
    raw_count := (p_diagnostics->>'providerRecordCount')::integer;
    parseable_count := (p_diagnostics->>'providerParseableRecordCount')::integer;
    window_count := (p_diagnostics->>'providerWindowRecordCount')::integer;
    if num_nonnulls(raw_count,parseable_count,window_count) not in (0,3)
      or raw_count < parseable_count or parseable_count < window_count
      or (raw_count is null and p_lookup_status <> 'setup_needed') then
      raise exception 'Inconsistent lookup diagnostic counts' using errcode = 'P4623';
    end if;
    if jsonb_typeof(p_diagnostics->'windowHours') <> 'number'
      or (p_diagnostics->>'windowHours') !~ '^[0-9]{1,2}([.][0-9]{1,8})?$'
      or jsonb_typeof(p_diagnostics->'incidentAt') <> 'string'
      or jsonb_typeof(p_diagnostics->'windowStart') <> 'string'
      or jsonb_typeof(p_diagnostics->'windowEnd') <> 'string'
      or jsonb_typeof(p_diagnostics->'incidentTimeResolution') <> 'string'
      or jsonb_typeof(p_diagnostics->'incidentTimeConfidence') <> 'string'
      or p_diagnostics->>'incidentTimeResolution' not in ('exact','ambiguous','nonexistent','invalid_local_time','invalid_timezone','legacy_absolute','missing','unknown')
      or p_diagnostics->>'incidentTimeConfidence' not in ('exact','within_15_minutes','within_1_hour','rough','unknown')
      or (p_diagnostics->'locationTimezone' <> 'null'::jsonb and not exists (
        select 1 from pg_catalog.pg_timezone_names zone where zone.name = p_diagnostics->>'locationTimezone'
      )) then
      raise exception 'Invalid lookup time provenance' using errcode = 'P4623';
    end if;
    hours := (p_diagnostics->>'windowHours')::numeric;
    begin
      incident := (p_diagnostics->>'incidentAt')::timestamptz;
      if hours not between 1 and 24 or not isfinite(incident)
        or (p_diagnostics->>'windowStart')::timestamptz is distinct from incident - hours * interval '1 hour'
        or (p_diagnostics->>'windowEnd')::timestamptz is distinct from incident + hours * interval '1 hour' then
        raise exception 'Invalid lookup window' using errcode = 'P4623';
      end if;
    exception when invalid_datetime_format or datetime_field_overflow then
      raise exception 'Invalid lookup window' using errcode = 'P4623';
    end;
  end if;

  -- Lock ordering and late outcome/receipt/decision protection are inherited.
  result := public.service_commit_refund_nayax_lookup(
    p_refund_case_id,p_lookup_generation,p_expected_fact_version,p_lookup_status,
    p_recommendation_state,p_policy_version,p_last_checked_at,p_summary,
    p_resolved_machine_id,p_candidate_count,p_trigger_source,p_actor_user_id);
  if result->>'applied' is distinct from 'true' or p_diagnostics is null then
    return result;
  end if;
  -- The existing commit retains the case and advisory locks until transaction end.
  if incident is distinct from (select c.incident_at from public.refund_cases c where c.id=p_refund_case_id) then
    raise exception 'Lookup diagnostic incident changed' using errcode = 'P4623';
  end if;
  select e.metadata->'diagnostics' into previous
  from public.refund_case_events e
  where e.refund_case_id=p_refund_case_id and e.event_type='nayax_lookup_diagnostics'
    and e.metadata->>'lookup_generation'=p_lookup_generation::text;
  has_previous := found;
  if has_previous and previous is distinct from p_diagnostics then
    raise exception 'Lookup diagnostic replay changed' using errcode = 'P4623';
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
  uuid,bigint,bigint,text,text,text,timestamptz,text,uuid,integer,text,uuid,jsonb) to service_role;
comment on function public.service_commit_refund_nayax_lookup_with_diagnostics(
  uuid,bigint,bigint,text,text,text,timestamptz,text,uuid,integer,text,uuid,jsonb) is
  'Service-only existing lookup commit plus bounded redacted coverage evidence. No provider call or payment authority; old callers remain compatible.';
select pg_notify('pgrst','reload schema');
