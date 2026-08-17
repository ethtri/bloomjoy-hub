-- Let a mapped manager refund the exact Nayax transaction they explicitly
-- selected from server-issued lookup evidence. Wallet card digits and the
-- customer's reported amount remain useful clues, but are not execution gates.

create or replace function public.can_prepare_nayax_refund_execution(
  p_user_id uuid,
  p_refund_case_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_user_id is not null
    and p_refund_case_id is not null
    and exists (
      select 1
      from public.refund_cases refund_case
      where refund_case.id = p_refund_case_id
        and public.can_perform_refund_official_action(p_user_id, refund_case.id)
        and refund_case.payment_method = 'card'
        and refund_case.decision = 'approved'
        and refund_case.status in ('approved', 'card_refund_pending')
        and refund_case.correlation_status = 'matched'
        and refund_case.correlation_source = 'nayax'
        and (
          (
            refund_case.nayax_recommendation_state = 'high_confidence'
            and refund_case.nayax_match_execution_eligible = true
            and refund_case.card_wallet_used = false
            and refund_case.payment_amount_cents is not null
            and refund_case.refund_amount_cents = refund_case.payment_amount_cents
          )
          or exists (
            select 1
            from public.refund_case_events selection_event
            where selection_event.refund_case_id = refund_case.id
              and selection_event.event_type = 'nayax_match_selected'
              and selection_event.actor_user_id is not null
          )
        )
        and refund_case.nayax_refund_execution_status = 'not_requested'
        and refund_case.nayax_recommendation_policy_version is not null
        and public.is_review_safe_nayax_transaction_reference(
          refund_case.matched_nayax_transaction_id
        )
        and refund_case.matched_nayax_site_id is not null
        and refund_case.matched_nayax_machine_auth_time is not null
        and refund_case.matched_nayax_currency_code = 'USD'
        and refund_case.refund_amount_cents is not null
        and refund_case.matched_nayax_amount_cents is not null
        and refund_case.refund_amount_cents > 0
        and refund_case.refund_amount_cents = refund_case.matched_nayax_amount_cents
        and refund_case.reporting_adjustment_id is null
        and not exists (
          select 1
          from public.refund_cases duplicate_case
          where duplicate_case.id <> refund_case.id
            and duplicate_case.matched_nayax_transaction_id =
              refund_case.matched_nayax_transaction_id
        )
        and exists (
          select 1
          from public.reporting_machines machine
          where machine.id = refund_case.reporting_machine_id
            and machine.status = 'active'
            and machine.nayax_refunds_enabled = true
            and machine.nayax_machine_id is not null
            and btrim(machine.nayax_machine_id) <> ''
            and (
              machine.nayax_refund_max_amount_cents is null
              or refund_case.refund_amount_cents <= machine.nayax_refund_max_amount_cents
            )
        )
    );
$$;

revoke execute on function public.can_prepare_nayax_refund_execution(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.can_prepare_nayax_refund_execution(uuid, uuid)
  to service_role;

create or replace function public.service_reserve_nayax_refund_manager_action(
  p_executor_assertion text,
  p_actor_user_id uuid,
  p_case_id uuid,
  p_expected_case_version bigint,
  p_idempotency_key text,
  p_amount_cents integer,
  p_daily_amount_cap_cents integer,
  p_daily_count_cap integer,
  p_currency_code text default 'USD'
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  refund_case public.refund_cases%rowtype;
  machine public.reporting_machines%rowtype;
  manager_mapping public.reporting_machine_refund_managers%rowtype;
  existing_attempt public.refund_case_nayax_refund_attempts%rowtype;
  intent public.refund_manager_action_step_up_intents%rowtype;
  authorization_row public.refund_case_official_action_authorizations%rowtype;
  action_context_hash text;
  execution_evidence_hash text;
  authorized_at timestamptz := statement_timestamp();
begin
  perform public.assert_nayax_provider_executor(p_executor_assertion);

  if p_actor_user_id is null or p_case_id is null then
    raise exception 'Authenticated Machine Manager and refund case are required';
  end if;
  if p_idempotency_key !~ '^nayax-refund-[a-f0-9]{64}$' then
    raise exception 'Invalid Nayax idempotency key';
  end if;
  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'Positive Nayax refund amount required';
  end if;
  if upper(btrim(coalesce(p_currency_code, ''))) <> 'USD' then
    raise exception 'Only exact USD Nayax refund context is supported';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'refund-nayax-manager-session-v1|' || p_actor_user_id::text || '|' || p_case_id::text,
      0
    )
  );

  select case_row.*
  into refund_case
  from public.refund_cases case_row
  where case_row.id = p_case_id
  for update;

  if not found then
    raise exception 'Refund case not found';
  end if;

  if not public.can_perform_refund_official_action(p_actor_user_id, refund_case.id) then
    raise exception 'Active Machine Manager mapping required; admin identities are review-only';
  end if;

  select mapping.*
  into manager_mapping
  from public.reporting_machine_refund_managers mapping
  where mapping.reporting_machine_id = refund_case.reporting_machine_id
    and mapping.manager_user_id = p_actor_user_id
    and mapping.status = 'active'
    and mapping.revoked_at is null
  for share;

  if not found then
    raise exception 'Active Machine Manager mapping required';
  end if;

  select attempt.*
  into existing_attempt
  from public.refund_case_nayax_refund_attempts attempt
  where attempt.idempotency_key = p_idempotency_key
  for update;

  if found then
    if existing_attempt.refund_case_id is distinct from refund_case.id
      or existing_attempt.actor_user_id is distinct from p_actor_user_id
      or existing_attempt.amount_cents is distinct from p_amount_cents
      or existing_attempt.currency_code is distinct from 'USD' then
      raise exception 'Nayax idempotency key is bound to different immutable context';
    end if;

    return public.refund_nayax_attempt_reservation_payload(
      existing_attempt.id,
      false,
      null
    );
  end if;

  if refund_case.official_action_version is distinct from p_expected_case_version then
    raise exception 'Refund case changed since review; reload before refunding';
  end if;

  select configured_machine.*
  into machine
  from public.reporting_machines configured_machine
  where configured_machine.id = refund_case.reporting_machine_id
  for share;

  if not found
    or machine.status <> 'active'
    or machine.nayax_machine_id is null
    or btrim(machine.nayax_machine_id) = ''
    or machine.nayax_refunds_enabled is distinct from true then
    raise exception 'Nayax refunds are not enabled for this machine';
  end if;

  if refund_case.payment_method <> 'card'
    or refund_case.status not in ('needs_review', 'correlated', 'approved', 'card_refund_pending')
    or (refund_case.decision is not null and refund_case.decision <> 'approved')
    or refund_case.correlation_status <> 'matched'
    or refund_case.correlation_source <> 'nayax'
    or refund_case.nayax_recommendation_policy_version is null
    or not public.is_review_safe_nayax_transaction_reference(
      refund_case.matched_nayax_transaction_id
    )
    or refund_case.matched_nayax_site_id is null
    or refund_case.matched_nayax_machine_auth_time is null
    or refund_case.matched_nayax_currency_code <> 'USD'
    or refund_case.refund_amount_cents is distinct from p_amount_cents
    or refund_case.matched_nayax_amount_cents is distinct from p_amount_cents
    or refund_case.reporting_adjustment_id is not null
    or refund_case.nayax_refund_execution_status <> 'not_requested'
    or not exists (
      select 1
      from public.refund_case_events selection_event
      where selection_event.refund_case_id = refund_case.id
        and selection_event.event_type = 'nayax_match_selected'
        and selection_event.actor_user_id is not null
    ) then
    raise exception 'The selected Nayax transaction is not ready for refund';
  end if;

  if machine.nayax_refund_max_amount_cents is not null
    and p_amount_cents > machine.nayax_refund_max_amount_cents then
    raise exception 'Nayax refund amount exceeds the machine limit';
  end if;

  if exists (
    select 1
    from public.refund_cases duplicate_case
    where duplicate_case.id <> refund_case.id
      and duplicate_case.matched_nayax_transaction_id =
        refund_case.matched_nayax_transaction_id
  ) then
    raise exception 'This Nayax transaction is already linked to another refund case';
  end if;

  update public.refund_cases
  set
    status = 'card_refund_pending',
    decision = 'approved',
    decided_by = p_actor_user_id,
    decided_at = coalesce(decided_at, authorized_at)
  where id = refund_case.id;

  select case_row.*
  into refund_case
  from public.refund_cases case_row
  where case_row.id = p_case_id
  for update;

  action_context_hash := public.refund_official_action_context_hash(
    'nayax_execute',
    'card_refund_pending',
    'approved',
    null,
    null,
    null,
    p_amount_cents,
    null,
    null,
    false,
    null,
    null,
    null
  );
  execution_evidence_hash := public.refund_nayax_execution_evidence_hash(
    refund_case,
    machine
  );

  insert into public.refund_manager_action_step_up_intents (
    actor_user_id,
    refund_case_id,
    action,
    target_function,
    manager_mapping_id,
    manager_mapping_version,
    manager_totp_enrollment_version,
    expected_case_version,
    action_context_hash,
    candidate_evidence_hash,
    nayax_execution_evidence_hash,
    authorization_method,
    status,
    not_before,
    expires_at,
    factor_verified_at,
    verified_totp_at,
    consumed_at
  ) values (
    p_actor_user_id,
    refund_case.id,
    'nayax_execute',
    'nayax-card-refund',
    manager_mapping.id,
    manager_mapping.mapping_version,
    null,
    refund_case.official_action_version,
    action_context_hash,
    null,
    execution_evidence_hash,
    'manager_session',
    'consumed',
    authorized_at,
    authorized_at + interval '30 seconds',
    authorized_at,
    authorized_at,
    authorized_at
  )
  returning * into intent;

  insert into public.refund_case_official_action_authorizations (
    refund_case_id,
    action,
    actor_user_id,
    manager_mapping_id,
    manager_mapping_version,
    expected_case_version,
    action_context_hash,
    status,
    expires_at,
    step_up_intent_id,
    verified_totp_at,
    nayax_execution_evidence_hash,
    authorization_method
  ) values (
    refund_case.id,
    'nayax_execute',
    p_actor_user_id,
    manager_mapping.id,
    manager_mapping.mapping_version,
    refund_case.official_action_version,
    action_context_hash,
    'authorized',
    authorized_at + interval '30 seconds',
    intent.id,
    authorized_at,
    execution_evidence_hash,
    'manager_session'
  )
  returning * into authorization_row;

  insert into public.refund_case_events (
    refund_case_id,
    actor_user_id,
    event_type,
    message,
    metadata
  ) values (
    refund_case.id,
    p_actor_user_id,
    'official_action_committed',
    'The mapped Machine Manager approved this exact Nayax refund.',
    jsonb_build_object(
      'action', 'nayax_execute',
      'authorization_method', 'manager_session',
      'manager_mapping_id', manager_mapping.id,
      'manager_mapping_version', manager_mapping.mapping_version,
      'payload_redacted', true
    )
  );

  return public.service_reserve_and_consume_nayax_refund_attempt_v2(
    p_executor_assertion,
    authorization_row.id,
    refund_case.id,
    p_idempotency_key,
    p_amount_cents,
    p_daily_amount_cap_cents,
    p_daily_count_cap,
    'USD'
  );
end;
$$;

revoke execute on function public.service_reserve_nayax_refund_manager_action(
  text, uuid, uuid, bigint, text, integer, integer, integer, text
) from public, anon, authenticated;
grant execute on function public.service_reserve_nayax_refund_manager_action(
  text, uuid, uuid, bigint, text, integer, integer, integer, text
) to service_role;

comment on function public.service_reserve_nayax_refund_manager_action(
  text, uuid, uuid, bigint, text, integer, integer, integer, text
) is
  'Reserves one exact manager-selected Nayax transaction. Wallet/card clues and the reported customer amount do not replace the selected provider amount.';
