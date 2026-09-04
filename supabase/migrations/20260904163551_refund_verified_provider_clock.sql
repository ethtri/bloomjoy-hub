-- #1123: exact native provider-clock configuration is independent of physical
-- purchase location and the legacy manual-only portal timezone.
alter table public.refund_nayax_machine_inventory
  add column provider_clock_timezone text,
  add column provider_clock_source text,
  add column provider_clock_observed_at timestamptz,
  add column provider_clock_daylight_saving boolean,
  add constraint refund_nayax_provider_clock_complete check (
    num_nonnulls(provider_clock_timezone,provider_clock_source,provider_clock_observed_at,provider_clock_daylight_saving)=0
    or (num_nonnulls(provider_clock_timezone,provider_clock_source,provider_clock_observed_at,provider_clock_daylight_saving)=4
      and provider_clock_source='native_machine_configuration'
      and provider_clock_daylight_saving is true and isfinite(provider_clock_observed_at))
  );
comment on column public.refund_nayax_machine_inventory.provider_clock_timezone is
  'Verified native machine-clock IANA zone for future offsetless MachineAuthorizationTime interpretation only. Not physical purchase timezone, historical report coverage, or replacement raw payment binding.';

create function public.guard_refund_nayax_provider_clock() returns trigger
language plpgsql set search_path='' as $$
begin
  if tg_op='UPDATE' and (new.account_key is distinct from old.account_key
    or new.nayax_machine_id is distinct from old.nayax_machine_id) then
    new.provider_clock_timezone:=null;
    new.provider_clock_source:=null;
    new.provider_clock_observed_at:=null;
    new.provider_clock_daylight_saving:=null;
  end if;
  if new.provider_clock_timezone is not null and not exists (
    select 1 from pg_catalog.pg_timezone_names z where z.name=new.provider_clock_timezone
  ) then raise exception 'Invalid verified provider clock timezone' using errcode='P4624'; end if;
  return new;
end;
$$;
revoke all on function public.guard_refund_nayax_provider_clock() from public,anon,authenticated;
create trigger refund_nayax_provider_clock_guard before insert or update on public.refund_nayax_machine_inventory
for each row execute function public.guard_refund_nayax_provider_clock();

-- Native UI observations: #1123 comment5542953702 and exact Sep4 machine
-- captures. Windows US Eastern Standard Time -> America/Indiana/Indianapolis;
-- Pacific Standard Time -> America/Los_Angeles (Unicode CLDR windowsZones).
-- All four native configurations have DST enabled. DC's Pacific provider clock
-- is intentional evidence, not an inference from its city name.
do $$
declare entry record; present_count integer; updated_count integer:=0;
begin
  select count(*) into present_count from public.refund_nayax_machine_inventory
  where account_key='TGPACI_USA_DB' and nayax_machine_id in ('545814962','403158085','938197833','287196350');
  if present_count not in (0,4) then raise exception 'Verified provider clock inventory is incomplete'; end if;
  for entry in select * from (values
    ('545814962','America/Indiana/Indianapolis','2026-09-04T15:41:16.081541Z'::timestamptz),
    ('403158085','America/Indiana/Indianapolis','2026-09-04T15:43:07.034221Z'::timestamptz),
    ('938197833','America/Los_Angeles','2026-09-04T15:44:13.963271Z'::timestamptz),
    ('287196350','America/Los_Angeles','2026-09-04T15:44:54.138356Z'::timestamptz)
  ) as observed(machine_id,zone,observed_at) loop
    update public.refund_nayax_machine_inventory i set
      provider_clock_timezone=entry.zone,provider_clock_source='native_machine_configuration',
      provider_clock_observed_at=entry.observed_at,provider_clock_daylight_saving=true
    where i.account_key='TGPACI_USA_DB' and i.nayax_machine_id=entry.machine_id
      and exists(select 1 from public.reporting_machines m where m.id=i.reporting_machine_id
        and m.nayax_machine_id=i.nayax_machine_id and m.nayax_account_key=i.account_key
        and m.nayax_manual_portal_enabled is false);
    if found then updated_count:=updated_count+1; end if;
  end loop;
  if updated_count<>present_count then raise exception 'Verified provider clock exact mapping changed'; end if;
end;
$$;

-- The caller already owns the case lock. Retain the inventory read lock while
-- admitting new clock evidence; existing canonical guards own machine binding.
create function public.refund_nayax_provider_clock_context_matches(p_machine_id uuid,p_context jsonb)
returns boolean language plpgsql security definer set search_path='' as $$
declare clock_row public.refund_nayax_machine_inventory%rowtype;
begin
  if jsonb_typeof(p_context) is distinct from 'object'
    or (select count(*) from jsonb_object_keys(p_context))<>4
    or not p_context ?& array['reportingMachineId','timezone','source','observedAt']
    or p_context->>'reportingMachineId' is distinct from p_machine_id::text then return false; end if;
  select i.* into clock_row from public.refund_nayax_machine_inventory i
  join public.reporting_machines m on m.id=i.reporting_machine_id
    and m.nayax_machine_id=i.nayax_machine_id and m.nayax_account_key=i.account_key
  where m.id=p_machine_id for share of i;
  if clock_row.provider_clock_timezone is null then
    return p_context->'timezone'='null'::jsonb and p_context->>'source'='unknown'
      and p_context->'observedAt'='null'::jsonb;
  end if;
  return jsonb_typeof(p_context->'timezone')='string' and jsonb_typeof(p_context->'observedAt')='string'
    and p_context->>'timezone'=clock_row.provider_clock_timezone
    and p_context->>'source'=clock_row.provider_clock_source
    and (p_context->>'observedAt')::timestamptz=clock_row.provider_clock_observed_at;
exception when invalid_datetime_format or datetime_field_overflow then return false;
end;
$$;
revoke all on function public.refund_nayax_provider_clock_context_matches(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.refund_nayax_provider_clock_context_matches(uuid,jsonb) to service_role;

create function public.guard_refund_nayax_candidate_provider_clock() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.evidence_summary->'machine_clock_context' is not null
    and new.evidence_summary->'machine_clock_context'<>'null'::jsonb then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('refund-nayax-lookup-v1|'||new.refund_case_id::text,0));
    perform 1 from public.refund_cases c where c.id=new.refund_case_id for update;
    if public.refund_nayax_provider_clock_context_matches(new.reporting_machine_id,new.evidence_summary->'machine_clock_context') is not true then
      raise exception 'Provider clock changed during lookup; refresh current evidence' using errcode='P4624';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.guard_refund_nayax_candidate_provider_clock() from public,anon,authenticated;
create trigger zz_refund_nayax_candidate_provider_clock before insert on public.refund_nayax_lookup_candidates
for each row execute function public.guard_refund_nayax_candidate_provider_clock();

create function public.guard_refund_nayax_selected_provider_clock() returns trigger
language plpgsql security definer set search_path='' as $$
declare clock_context jsonb;
begin
  if new.matched_nayax_transaction_id is not null
    and row(new.reporting_machine_id,new.matched_nayax_transaction_id,new.matched_nayax_site_id,
      new.matched_nayax_machine_auth_time,new.matched_nayax_amount_cents,new.matched_nayax_card_last4,new.matched_nayax_currency_code)
    is distinct from row(old.reporting_machine_id,old.matched_nayax_transaction_id,old.matched_nayax_site_id,
      old.matched_nayax_machine_auth_time,old.matched_nayax_amount_cents,old.matched_nayax_card_last4,old.matched_nayax_currency_code) then
    for clock_context in select c.evidence_summary->'machine_clock_context'
      from public.refund_nayax_lookup_candidates c where c.refund_case_id=new.id
        and c.lookup_generation=new.nayax_lookup_generation
        and c.provider_transaction_id=new.matched_nayax_transaction_id
        and c.reporting_machine_id=new.reporting_machine_id loop
      if clock_context is not null and clock_context<>'null'::jsonb
        and public.refund_nayax_provider_clock_context_matches(new.reporting_machine_id,clock_context) is not true then
        raise exception 'Provider clock changed after lookup; refresh current evidence' using errcode='P4624';
      end if;
    end loop;
  end if;
  return new;
end;
$$;
revoke all on function public.guard_refund_nayax_selected_provider_clock() from public,anon,authenticated;
create trigger zz_refund_nayax_selected_provider_clock before update of reporting_machine_id,matched_nayax_transaction_id,matched_nayax_site_id,matched_nayax_machine_auth_time,matched_nayax_amount_cents,matched_nayax_card_last4,matched_nayax_currency_code on public.refund_cases
for each row execute function public.guard_refund_nayax_selected_provider_clock();

-- Add explicit bounded v2 clock provenance; retain the complete v1 caller contract.
-- Preserve bounded response diagnostics in the existing case event stream.
-- The canonical commit owns all lifecycle/approval/payment guards and locks.
-- Old deployed callers keep their existing signature and behavior.
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
  hours numeric;
  incident timestamptz;
  previous jsonb;
  has_previous boolean;
  is_v2 boolean := coalesce(p_diagnostics->>'schemaVersion'='nayax_lookup_diagnostics_v2',false);
  clock_context jsonb;
  expected_machine_ids uuid[];
  submitted_machine_ids uuid[];
begin
  if p_diagnostics is not null then
    if jsonb_typeof(p_diagnostics) is distinct from 'object'
      or (select count(*) from jsonb_object_keys(p_diagnostics)) <> case when is_v2 then 17 else 16 end
      or not p_diagnostics ?& array['schemaVersion','endpoint','historicalCoverage',
        'providerRecordCount','providerParseableRecordCount','providerWindowRecordCount',
        'windowHours','incidentAt','windowStart','windowEnd','incidentTimeResolution',
        'incidentTimeConfidence','locationTimezone','providerTimePolicy','machineTimezoneSource','providerPayloadRedacted']
      or p_diagnostics->>'schemaVersion' is distinct from case when is_v2 then 'nayax_lookup_diagnostics_v2' else 'nayax_lookup_diagnostics_v1' end
      or p_diagnostics->>'endpoint' is distinct from 'machine_last_sales'
      or p_diagnostics->>'historicalCoverage' is distinct from 'unknown'
      or p_diagnostics->>'providerTimePolicy' is distinct from case when is_v2 then 'authorization_gmt_else_provider_clock_else_unverified_location' else 'authorization_gmt_else_mapped_machine_clock' end
      or p_diagnostics->>'machineTimezoneSource' is distinct from case when is_v2 then 'per_machine_provider_clock_contexts' else 'configured_location_not_verified_provider_clock' end
      or p_diagnostics->'providerPayloadRedacted' is distinct from 'true'::jsonb then
      raise exception 'Invalid bounded lookup diagnostics' using errcode = 'P4623';
    end if;
    if is_v2 then
      if jsonb_typeof(p_diagnostics->'providerClockContexts') is distinct from 'array' then
        raise exception 'Invalid provider clock contexts' using errcode='P4624';
      end if;
      if jsonb_array_length(p_diagnostics->'providerClockContexts') not between 1 and 2 then
        raise exception 'Invalid provider clock context count' using errcode='P4624';
      end if;
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

  if is_v2 then
    -- Match canonical advisory -> case ordering before capturing the invocation
    -- scope. An unresolved pair can become resolved during the delegated commit.
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('refund-nayax-lookup-v1|'||p_refund_case_id::text,0));
    select case when c.reporting_machine_id is not null then array[c.reporting_machine_id]
      else c.intake_selection_machine_ids end into expected_machine_ids
    from public.refund_cases c where c.id=p_refund_case_id for update;
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
  if is_v2 and not has_previous then
    submitted_machine_ids:=array[]::uuid[];
    for clock_context in select value from jsonb_array_elements(p_diagnostics->'providerClockContexts') order by value->>'reportingMachineId' loop
      if jsonb_typeof(clock_context) is distinct from 'object'
        or coalesce(clock_context->>'reportingMachineId','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        or not ((clock_context->>'reportingMachineId')::uuid=any(expected_machine_ids))
        or public.refund_nayax_provider_clock_context_matches((clock_context->>'reportingMachineId')::uuid,clock_context) is not true then
        raise exception 'Provider clock context changed or is outside current lookup scope' using errcode='P4624';
      end if;
      submitted_machine_ids:=array_append(submitted_machine_ids,(clock_context->>'reportingMachineId')::uuid);
    end loop;
    if (select array_agg(id order by id) from unnest(submitted_machine_ids) id)
      is distinct from (select array_agg(id order by id) from unnest(expected_machine_ids) id) then
      raise exception 'Provider clock contexts do not cover the exact lookup scope' using errcode='P4624';
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
  uuid,bigint,bigint,text,text,text,timestamptz,text,uuid,integer,text,uuid,jsonb) to service_role;
comment on function public.service_commit_refund_nayax_lookup_with_diagnostics(
  uuid,bigint,bigint,text,text,text,timestamptz,text,uuid,integer,text,uuid,jsonb) is
  'Service-only existing lookup commit plus bounded redacted coverage evidence. No provider call or payment authority; old callers remain compatible.';
select pg_notify('pgrst','reload schema');
