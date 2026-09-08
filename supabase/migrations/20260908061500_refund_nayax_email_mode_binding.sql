-- Bind the optional email-list representation to the exact reserved request.
-- Historical omitted-email contexts keep their original bytes and hashes.
create function public.refund_nayax_selected_execution_context_v3(
  p_case_id uuid,p_serialization_mode text,p_refund_email_list_mode text
)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  if p_refund_email_list_mode is null or p_refund_email_list_mode not in ('omit','empty_string') then
    return null;
  end if;
  result := public.refund_nayax_selected_execution_context_v2(p_case_id,p_serialization_mode);
  if result is null or p_refund_email_list_mode = 'omit' then return result; end if;
  result := (result - 'contextHash') || jsonb_build_object('refundEmailListMode',p_refund_email_list_mode);
  return result || jsonb_build_object('contextHash',encode(
    extensions.digest(convert_to(result::text,'UTF8'),'sha256'),'hex'));
end;
$$;
revoke all on function public.refund_nayax_selected_execution_context_v3(uuid,text,text)
  from public,anon,authenticated,service_role;

create function public.service_get_refund_nayax_execution_context_v3(
  p_executor_assertion text,p_actor_user_id uuid,p_case_id uuid,
  p_serialization_mode text,p_refund_email_list_mode text
)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.assert_nayax_provider_executor(p_executor_assertion);
  if not public.can_perform_refund_official_action(p_actor_user_id,p_case_id) then
    raise exception 'Active Machine Manager required' using errcode = '42501';
  end if;
  return public.refund_nayax_selected_execution_context_v3(
    p_case_id,p_serialization_mode,p_refund_email_list_mode);
end;
$$;
revoke all on function public.service_get_refund_nayax_execution_context_v3(text,uuid,uuid,text,text)
  from public,anon,authenticated;
grant execute on function public.service_get_refund_nayax_execution_context_v3(text,uuid,uuid,text,text)
  to service_role;
create function public.service_reserve_nayax_refund_manager_action_v5(
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
  p_machine_authorization_time_mode text,
  p_refund_email_list_mode text
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
  if p_refund_email_list_mode is null or p_refund_email_list_mode not in ('omit','empty_string') then
    raise exception 'Unsupported Nayax refund email mode' using errcode = 'P4620';
  end if;
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
    if coalesce(existing_context ->> 'refundEmailListMode','omit')
        is distinct from p_refund_email_list_mode
      or existing_context is null
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
  execution_context := public.refund_nayax_selected_execution_context_v3(
    p_case_id,p_machine_authorization_time_mode,p_refund_email_list_mode
  );
  if coalesce(execution_context ->> 'refundEmailListMode','omit')
      is distinct from p_refund_email_list_mode
    or execution_context is null
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
revoke all on function public.service_reserve_nayax_refund_manager_action_v5(
  text,uuid,uuid,bigint,text,integer,integer,integer,text,text,text,text,text,text
) from public,anon,authenticated;
grant execute on function public.service_reserve_nayax_refund_manager_action_v5(
  text,uuid,uuid,bigint,text,integer,integer,integer,text,text,text,text,text,text
) to service_role;

-- Continuation must preserve the original transport representation even when
-- deployment configuration changes. Case version advances during reservation,
-- so compare transport fields rather than the complete current context hash.
create function public.service_reserve_nayax_refund_approval_continuation_v2(
  p_executor_assertion text,p_actor_user_id uuid,p_case_id uuid,
  p_expected_case_version bigint,p_idempotency_key text,p_amount_cents integer,
  p_currency_code text,p_provider_contract_version text,p_journal_contract_version text,
  p_machine_authorization_time_wire text,p_machine_authorization_time_mode text,
  p_refund_email_list_mode text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare original_context jsonb;
begin
  perform public.assert_nayax_provider_executor(p_executor_assertion);
  perform 1 from public.refund_cases where id=p_case_id for update;
  select frozen.context into original_context
  from public.refund_case_nayax_refund_attempts attempt
  join public.refund_nayax_execution_contexts frozen on frozen.attempt_id=attempt.id
  where attempt.refund_case_id=p_case_id and attempt.idempotency_key=p_idempotency_key
    and frozen.refund_case_id=p_case_id;
  if original_context is null
    or nullif(btrim(p_machine_authorization_time_wire),'') is null
    or p_machine_authorization_time_mode is null
    or p_machine_authorization_time_mode not in ('exact_source','source_with_bound_offset')
    or p_refund_email_list_mode is null
    or p_refund_email_list_mode not in ('omit','empty_string')
    or (original_context ? 'machineAuthorizationTimeSerializationMode'
      and nullif(original_context->>'machineAuthorizationTimeWire','') is null)
    or coalesce(original_context->>'machineAuthorizationTimeWire',
      original_context->>'machineAuthorizationTime') is distinct from p_machine_authorization_time_wire
    or coalesce(original_context->>'machineAuthorizationTimeSerializationMode','exact_source')
      is distinct from p_machine_authorization_time_mode
    or coalesce(original_context->>'refundEmailListMode','omit')
      is distinct from p_refund_email_list_mode then
    raise exception 'Original Nayax continuation serialization changed' using errcode='P4628';
  end if;
  return public.service_reserve_nayax_refund_approval_continuation_v1(
    p_executor_assertion,p_actor_user_id,p_case_id,p_expected_case_version,
    p_idempotency_key,p_amount_cents,p_currency_code,p_provider_contract_version,
    p_journal_contract_version);
end;
$$;
revoke all on function public.service_reserve_nayax_refund_approval_continuation_v2(
  text,uuid,uuid,bigint,text,integer,text,text,text,text,text,text
) from public,anon,authenticated;
grant execute on function public.service_reserve_nayax_refund_approval_continuation_v2(
  text,uuid,uuid,bigint,text,integer,text,text,text,text,text,text
) to service_role;
-- Old workers fail closed during deployment instead of bypassing the binding.
revoke execute on function public.service_reserve_nayax_refund_approval_continuation_v1(
  text,uuid,uuid,bigint,text,integer,text,text,text
) from service_role;
