begin;

-- Keep the cheap queue predicates ahead of the reader-history lookup. A plain
-- subquery can be folded back into the five original identity comparisons.
-- The outer predicates deliberately remain current when FOR UPDATE performs
-- EvalPlanQual after a concurrent claimant commits a changed attempt tuple.
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
    with eligible as materialized (
      select attempt.id, refund_case.id as case_id, machine.id as machine_id
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
        and saved.context ->> 'machineAuthorizationTimeSerializationMode' = p_serialization_mode
        and saved.context ->> 'refundEmailListMode' = p_refund_email_list_mode
        and refund_case.status = 'card_refund_pending'
        and refund_case.decision = 'approved'
        and refund_case.reporting_adjustment_id is null
        and machine.status = 'active'
        and machine.nayax_refunds_enabled is true
    ), readers as materialized (
      select eligible.id,
        public.service_refund_case_reader_identity(eligible.case_id, eligible.machine_id) as identity
      from eligible
    )
    select attempt.*
    from public.refund_case_nayax_refund_attempts attempt
    join readers on readers.id = attempt.id
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
      and saved.context ->> 'accountScope' = readers.identity ->> 'accountKey'
      and saved.context ->> 'providerMachineId' = readers.identity ->> 'readerId'
      and readers.identity ->> 'accountKey' = p_account_key
      and machine.status = 'active'
      and machine.nayax_refunds_enabled is true
      and nullif(btrim(readers.identity ->> 'accountKey'), '') is not null
      and nullif(btrim(readers.identity ->> 'readerId'), '') is not null
      and saved.context ->> 'machineAuthorizationTimeSerializationMode' = p_serialization_mode
      and saved.context ->> 'refundEmailListMode' = p_refund_email_list_mode
      and refund_case.status = 'card_refund_pending'
      and refund_case.decision = 'approved'
      and refund_case.reporting_adjustment_id is null
      and (
        (attempt.provider_execution_generation = 1
          and attempt.execution_plan = 'request_and_approve')
        or (attempt.provider_execution_generation > 1
          and public.refund_nayax_current_continuation_proof_matches_v1(attempt.id))
      )
    order by attempt.created_at, attempt.id
    for update of attempt skip locked
    limit p_limit
  loop
    token := encode(extensions.gen_random_bytes(32), 'hex');
    update public.refund_case_nayax_refund_attempts
    set status = 'in_progress',
      provider_claim_digest = encode(
        extensions.digest(convert_to(token, 'UTF8'), 'sha256'), 'hex'),
      provider_claim_expires_at = statement_timestamp() + interval '15 minutes'
    where id = a.id;
    perform pg_catalog.set_config('bloomjoy.nayax_settlement_attempt_id', a.id::text, true);
    update public.refund_cases
    set nayax_refund_execution_status = 'requested'
    where id = a.refund_case_id
      and nayax_refund_execution_status = 'not_requested';
    claims := claims || jsonb_build_array(
      public.refund_nayax_attempt_claim_payload_v1(a.id, token));
  end loop;

  return jsonb_build_object(
    'schemaVersion', 'nayax-refund-attempt-queue-v1',
    'claims', claims, 'payloadRedacted', true);
end;
$$;

revoke all on function public.service_claim_due_nayax_refund_attempts_v1(text,text,text,text,integer)
  from public, anon, authenticated, service_role;
grant execute on function public.service_claim_due_nayax_refund_attempts_v1(text,text,text,text,integer)
  to service_role;

commit;
