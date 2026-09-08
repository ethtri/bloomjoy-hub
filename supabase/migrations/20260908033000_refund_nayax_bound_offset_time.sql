-- #1220: preserve Nayax's raw machine wall clock while allowing one explicit
-- RFC date-time serialization experiment derived from the already-selected
-- normalized instant. The selected instant is evidence-bound during lookup;
-- this migration does not invent or persist provider-clock configuration.
create function public.refund_nayax_machine_authorization_wire_value(
  p_raw_time text,
  p_normalized_instant timestamptz,
  p_serialization_mode text
)
returns text
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  raw_timestamp timestamp without time zone;
  offset_seconds numeric;
  offset_minutes integer;
  offset_suffix text;
  wire_value text;
begin
  if p_raw_time !~
      '^[0-9]{4}-[0-9]{2}-[0-9]{2}T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](\.[0-9]{1,7})?(Z|[+-](0[0-9]|1[0-3]):[0-5][0-9]|[+-]14:00)?$' then
    raise exception 'Exact Nayax MachineAuTime required' using errcode = 'P4620';
  end if;
  if p_serialization_mode = 'exact_source' then
    return p_raw_time;
  end if;
  if p_serialization_mode <> 'source_with_bound_offset' then
    raise exception 'Unsupported Nayax MachineAuTime serialization mode'
      using errcode = 'P4620';
  end if;
  if p_raw_time ~ '\.[0-9]{4,7}(Z|[+-][0-9]{2}:[0-9]{2})?$'
    or p_normalized_instant is distinct from
      date_trunc('milliseconds',p_normalized_instant) then
    raise exception 'Bound Nayax MachineAuTime requires millisecond-exact evidence'
      using errcode = 'P4620';
  end if;

  if p_raw_time ~ '(Z|[+-][0-9]{2}:[0-9]{2})$' then
    if p_raw_time::timestamptz is distinct from p_normalized_instant then
      raise exception 'Bound Nayax MachineAuTime instant changed'
        using errcode = 'P4620';
    end if;
    return p_raw_time;
  end if;

  raw_timestamp := p_raw_time::timestamp without time zone;
  offset_seconds := extract(
    epoch from raw_timestamp - (p_normalized_instant at time zone 'UTC')
  );
  if offset_seconds <> trunc(offset_seconds)
    or mod(offset_seconds::bigint, 60) <> 0 then
    raise exception 'Bound Nayax MachineAuTime offset is not an exact minute'
      using errcode = 'P4620';
  end if;
  offset_minutes := (offset_seconds / 60)::integer;
  if abs(offset_minutes) > 14 * 60 then
    raise exception 'Bound Nayax MachineAuTime offset is outside the supported range'
      using errcode = 'P4620';
  end if;
  offset_suffix := case when offset_minutes < 0 then '-' else '+' end
    || lpad((abs(offset_minutes) / 60)::text, 2, '0')
    || ':' || lpad(mod(abs(offset_minutes), 60)::text, 2, '0');
  wire_value := p_raw_time || offset_suffix;
  if wire_value::timestamptz is distinct from p_normalized_instant then
    raise exception 'Bound Nayax MachineAuTime wire value changed the selected instant'
      using errcode = 'P4620';
  end if;
  return wire_value;
exception
  when invalid_datetime_format or datetime_field_overflow
    or numeric_value_out_of_range then
    raise exception 'Invalid bound Nayax MachineAuTime'
      using errcode = 'P4620';
end;
$$;
revoke all on function public.refund_nayax_machine_authorization_wire_value(
  text,timestamptz,text
) from public,anon,authenticated,service_role;

create function public.refund_nayax_selected_execution_context_v2(
  p_case_id uuid,
  p_serialization_mode text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  base_context jsonb;
  case_row public.refund_cases%rowtype;
  exact_candidate_count integer;
  candidate_count integer;
  wire_value text;
  result jsonb;
begin
  base_context := public.refund_nayax_selected_execution_context(p_case_id);
  if base_context is null then return null; end if;
  select * into strict case_row from public.refund_cases where id = p_case_id;

  if p_serialization_mode = 'source_with_bound_offset' then
    select
      count(*) filter (
        where candidate.evidence_summary ->> 'machine_time_resolution' = 'exact'
      ),
      count(*)
    into exact_candidate_count,candidate_count
    from public.refund_nayax_lookup_candidates candidate
    where candidate.refund_case_id = case_row.id
      and candidate.lookup_generation = case_row.nayax_lookup_generation
      and candidate.reporting_machine_id = case_row.reporting_machine_id
      and candidate.provider_transaction_id = case_row.matched_nayax_transaction_id
      and candidate.site_id = case_row.matched_nayax_site_id
      and candidate.machine_authorization_time = case_row.matched_nayax_machine_auth_time
      and candidate.amount_cents = case_row.matched_nayax_amount_cents
      and candidate.currency_code = case_row.matched_nayax_currency_code
      and candidate.evidence_summary ->> 'machine_authorization_time_raw'
        = base_context ->> 'machineAuthorizationTime';
    if candidate_count = 0 or exact_candidate_count <> candidate_count then
      return null;
    end if;
  elsif p_serialization_mode <> 'exact_source' then
    return null;
  end if;

  wire_value := public.refund_nayax_machine_authorization_wire_value(
    base_context ->> 'machineAuthorizationTime',
    case_row.matched_nayax_machine_auth_time,
    p_serialization_mode
  );
  result := (base_context - 'contextHash') || jsonb_build_object(
    'machineAuthorizationTimeInstant', case_row.matched_nayax_machine_auth_time,
    'machineAuthorizationTimeWire', wire_value,
    'machineAuthorizationTimeSerializationMode', p_serialization_mode,
    'machineAuthorizationTimeSerializationSource',
      case when p_serialization_mode = 'exact_source'
        then 'exact_source' else 'selected_normalized_instant' end
  );
  return result || jsonb_build_object(
    'contextHash',
    encode(
      extensions.digest(convert_to(result::text,'UTF8'),'sha256'),
      'hex'
    )
  );
end;
$$;
revoke all on function public.refund_nayax_selected_execution_context_v2(
  uuid,text
) from public,anon,authenticated,service_role;

create function public.service_get_refund_nayax_execution_context_v2(
  p_executor_assertion text,
  p_actor_user_id uuid,
  p_case_id uuid,
  p_serialization_mode text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.assert_nayax_provider_executor(p_executor_assertion);
  if not public.can_perform_refund_official_action(
    p_actor_user_id,p_case_id
  ) then
    raise exception 'Active Machine Manager required' using errcode = '42501';
  end if;
  return public.refund_nayax_selected_execution_context_v2(
    p_case_id,p_serialization_mode
  );
end;
$$;
revoke all on function public.service_get_refund_nayax_execution_context_v2(
  text,uuid,uuid,text
) from public,anon,authenticated;
grant execute on function public.service_get_refund_nayax_execution_context_v2(
  text,uuid,uuid,text
) to service_role;

create function public.service_reserve_nayax_refund_manager_action_v4(
  p_executor_assertion text,
  p_actor_user_id uuid,
  p_case_id uuid,
  p_expected_case_version bigint,
  p_idempotency_key text,
  p_amount_cents integer,
  p_daily_amount_cap_cents integer,
  p_daily_count_cap integer,
  p_currency_code text,
  p_provider_contract_version text,
  p_journal_contract_version text,
  p_execution_context_hash text,
  p_machine_authorization_time_mode text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  case_row public.refund_cases%rowtype;
  existing_attempt_id uuid;
  existing_context jsonb;
  execution_context jsonb;
  result jsonb;
begin
  perform public.assert_nayax_provider_executor(p_executor_assertion);
  select * into strict case_row
  from public.refund_cases
  where id = p_case_id
  for update;
  select attempt.id into existing_attempt_id
  from public.refund_case_nayax_refund_attempts attempt
  where attempt.idempotency_key = p_idempotency_key
    and attempt.refund_case_id = p_case_id;
  if existing_attempt_id is not null then
    select context into existing_context
    from public.refund_nayax_execution_contexts
    where attempt_id = existing_attempt_id;
    if existing_context is null
      or existing_context ->> 'contextHash' is distinct from
        p_execution_context_hash
      or existing_context ->> 'machineAuthorizationTimeSerializationMode'
        is distinct from p_machine_authorization_time_mode then
      raise exception 'Reserved Nayax request serialization changed'
        using errcode = 'P4620';
    end if;
    return public.service_reserve_nayax_refund_manager_action_pre_context_v1(
      p_executor_assertion,p_actor_user_id,p_case_id,p_expected_case_version,
      p_idempotency_key,p_amount_cents,p_daily_amount_cap_cents,
      p_daily_count_cap,p_currency_code,p_provider_contract_version,
      p_journal_contract_version
    );
  end if;
  perform 1
  from public.reporting_machines
  where id = case_row.reporting_machine_id
  for share;
  execution_context := public.refund_nayax_selected_execution_context_v2(
    p_case_id,p_machine_authorization_time_mode
  );
  if execution_context is null
    or execution_context ->> 'contextHash' is distinct from
      p_execution_context_hash
    or case_row.official_action_version is distinct from
      p_expected_case_version
    or case_row.matched_nayax_amount_cents is distinct from p_amount_cents
    or case_row.matched_nayax_currency_code is distinct from p_currency_code
    or execution_context ->> 'machineAuthorizationTimeSerializationMode'
      is distinct from p_machine_authorization_time_mode then
    raise exception 'Selected Nayax purchase changed; refresh the transaction'
      using errcode = 'P4620';
  end if;
  result := public.service_reserve_nayax_refund_manager_action_pre_context_v1(
    p_executor_assertion,p_actor_user_id,p_case_id,p_expected_case_version,
    p_idempotency_key,p_amount_cents,p_daily_amount_cap_cents,
    p_daily_count_cap,p_currency_code,p_provider_contract_version,
    p_journal_contract_version
  );
  if result #>> '{attempt,shouldExecute}' = 'true' then
    insert into public.refund_nayax_execution_contexts(
      attempt_id,refund_case_id,context
    ) values (
      (result #>> '{attempt,attemptId}')::uuid,
      case_row.id,
      execution_context
    );
  end if;
  return result;
end;
$$;
revoke all on function public.service_reserve_nayax_refund_manager_action_v4(
  text,uuid,uuid,bigint,text,integer,integer,integer,text,text,text,text,text
) from public,anon,authenticated;
grant execute on function public.service_reserve_nayax_refund_manager_action_v4(
  text,uuid,uuid,bigint,text,integer,integer,integer,text,text,text,text,text
) to service_role;
