-- A manager decision records one exact, provider-free refund attempt even when
-- the machine is temporarily inactive or card execution is paused. Those two
-- operational states belong at the System processor boundary: the existing
-- attempt remains created and becomes claimable when the machine is restored.
-- Exact machine/account identity remains mandatory at approval and claim time.

do $move_machine_state_to_processor_boundary$
declare
  function_definition text;
  approval_guard text := $current$
  if machine.id is null or machine.status<>'active' or not machine.nayax_refunds_enabled
    or nullif(btrim(machine.nayax_machine_id),'') is null
    or nullif(btrim(machine.nayax_account_key),'') is null then
    raise exception 'Nayax refund configuration is unavailable' using errcode='P4620';
  end if;
$current$;
  approval_identity_guard text := $replacement$
  if machine.id is null
    or nullif(btrim(machine.nayax_machine_id),'') is null
    or nullif(btrim(machine.nayax_account_key),'') is null then
    raise exception 'Nayax refund configuration is unavailable' using errcode='P4620';
  end if;
$replacement$;
  readiness_guard text := $current$
    when machine.id is null
      or machine.status <> 'active'
      or nullif(btrim(machine.nayax_machine_id), '') is null
      or nullif(btrim(machine.nayax_account_key), '') is null
      then 'provider_unavailable'
    when not machine.nayax_refunds_enabled then 'machine_not_enabled'
$current$;
  readiness_identity_guard text := $replacement$
    when machine.id is null
      or nullif(btrim(machine.nayax_machine_id), '') is null
      or nullif(btrim(machine.nayax_account_key), '') is null
      then 'provider_unavailable'
$replacement$;
begin
  function_definition := replace(
    pg_get_functiondef(
      'public.admin_approve_selected_nayax_refund_for_system_v1(uuid,bigint)'::regprocedure
    ),
    E'\r\n',
    E'\n'
  );
  approval_guard := replace(approval_guard, E'\r\n', E'\n');
  approval_identity_guard := replace(
    approval_identity_guard,
    E'\r\n',
    E'\n'
  );
  if cardinality(string_to_array(function_definition, approval_guard)) <> 2 then
    raise exception
      'Unexpected manager approval machine-state guard; processor hold was not applied';
  end if;
  execute replace(
    function_definition,
    approval_guard,
    approval_identity_guard
  );

  function_definition := replace(
    pg_get_functiondef(
      'public.refund_case_nayax_manager_readiness(uuid,uuid)'::regprocedure
    ),
    E'\r\n',
    E'\n'
  );
  readiness_guard := replace(readiness_guard, E'\r\n', E'\n');
  readiness_identity_guard := replace(
    readiness_identity_guard,
    E'\r\n',
    E'\n'
  );
  if cardinality(string_to_array(function_definition, readiness_guard)) <> 2 then
    raise exception
      'Unexpected manager readiness machine-state guard; processor hold was not applied';
  end if;
  execute replace(
    function_definition,
    readiness_guard,
    readiness_identity_guard
  );
end;
$move_machine_state_to_processor_boundary$;

create or replace function public.service_claim_due_nayax_refund_attempts_v1(
  p_executor_assertion text,
  p_account_key text,
  p_serialization_mode text,
  p_refund_email_list_mode text,
  p_limit integer default 1
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.refund_case_nayax_refund_attempts%rowtype;
  token text;
  claims jsonb := '[]'::jsonb;
begin
  perform public.assert_nayax_provider_executor(p_executor_assertion);
  if p_limit not between 1 and 5
    or p_serialization_mode <> 'exact_source'
    or p_refund_email_list_mode <> 'empty_string' then
    raise exception 'Supported queue claim configuration required'
      using errcode = 'P4620';
  end if;

  for a in
    select attempt.*
    from public.refund_case_nayax_refund_attempts attempt
    join public.refund_case_official_action_authorizations authz
      on authz.id = attempt.official_action_authorization_id
    join public.refund_nayax_execution_contexts saved
      on saved.attempt_id = attempt.id
    join public.refund_cases refund_case
      on refund_case.id = attempt.refund_case_id
    join public.reporting_machines machine
      on machine.id = refund_case.reporting_machine_id
    where attempt.actor_user_id is null
      and attempt.status = 'created'
      and authz.action = 'approve'
      and authz.status = 'consumed'
      and authz.consumed_at is not null
      and authz.authorization_method = 'manager_session'
      and saved.context ->> 'accountScope' = p_account_key
      and saved.context ->> 'accountScope' = machine.nayax_account_key
      and saved.context ->> 'providerMachineId' = machine.nayax_machine_id
      and machine.nayax_account_key = p_account_key
      and machine.status = 'active'
      and machine.nayax_refunds_enabled is true
      and nullif(btrim(machine.nayax_account_key), '') is not null
      and nullif(btrim(machine.nayax_machine_id), '') is not null
      and saved.context ->> 'machineAuthorizationTimeSerializationMode' =
        p_serialization_mode
      and saved.context ->> 'refundEmailListMode' = p_refund_email_list_mode
      and refund_case.status = 'card_refund_pending'
      and refund_case.decision = 'approved'
      and refund_case.reporting_adjustment_id is null
      and (
        (
          attempt.provider_execution_generation = 1
          and attempt.execution_plan = 'request_and_approve'
        )
        or (
          attempt.provider_execution_generation > 1
          and public.refund_nayax_current_continuation_proof_matches_v1(attempt.id)
        )
      )
    order by attempt.created_at, attempt.id
    for update of attempt skip locked
    limit p_limit
  loop
    token := encode(extensions.gen_random_bytes(32), 'hex');
    update public.refund_case_nayax_refund_attempts
    set status = 'in_progress',
      provider_claim_digest = encode(
        extensions.digest(convert_to(token, 'UTF8'), 'sha256'),
        'hex'
      ),
      provider_claim_expires_at = statement_timestamp() + interval '15 minutes'
    where id = a.id;
    perform pg_catalog.set_config(
      'bloomjoy.nayax_settlement_attempt_id',
      a.id::text,
      true
    );
    update public.refund_cases
    set nayax_refund_execution_status = 'requested'
    where id = a.refund_case_id
      and nayax_refund_execution_status = 'not_requested';
    claims := claims || jsonb_build_array(
      public.refund_nayax_attempt_claim_payload_v1(a.id, token)
    );
  end loop;

  return jsonb_build_object(
    'schemaVersion', 'nayax-refund-attempt-queue-v1',
    'claims', claims,
    'payloadRedacted', true
  );
end;
$$;

revoke all on function public.service_claim_due_nayax_refund_attempts_v1(
  text,
  text,
  text,
  text,
  integer
) from public, anon, authenticated, service_role;
grant execute on function public.service_claim_due_nayax_refund_attempts_v1(
  text,
  text,
  text,
  text,
  integer
) to service_role;

revoke all on function public.admin_approve_selected_nayax_refund_for_system_v1(
  uuid,
  bigint
) from public, anon, service_role;
grant execute on function public.admin_approve_selected_nayax_refund_for_system_v1(
  uuid,
  bigint
) to authenticated;

revoke execute on function public.refund_case_nayax_manager_readiness(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.refund_case_nayax_manager_readiness(uuid, uuid)
  to service_role;

comment on function public.admin_approve_selected_nayax_refund_for_system_v1(uuid, bigint) is
  'Atomically consumes one authorized manager decision and queues one exact provider-free System attempt. Machine active/refunds-enabled state is enforced when the processor claims the attempt.';

comment on function public.refund_case_nayax_manager_readiness(uuid, uuid) is
  'Private manager decision readiness for one exact refund. Machine active/refunds-enabled state is processor liveness, not manager authority.';

comment on function public.service_claim_due_nayax_refund_attempts_v1(
  text,
  text,
  text,
  text,
  integer
) is
  'Claims manager-approved attempts only while the current machine is active, refund execution is enabled, and the frozen machine/account identity still matches. Held created attempts resume when those operational states are restored.';

select pg_notify('pgrst', 'reload schema');
