-- Race-safe claim for one real Nayax refund attempt.
--
-- The Edge Function still owns provider calls. This service-role-only function
-- atomically reserves the case and enforces daily caps before any external write.

create or replace function public.service_claim_nayax_refund_execution(
  p_actor_user_id uuid,
  p_refund_case_id uuid,
  p_idempotency_key text,
  p_daily_amount_cap_cents integer,
  p_daily_count_cap integer,
  p_request_fingerprint text,
  p_provider_contract_version text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  refund_case public.refund_cases%rowtype;
  refund_machine public.reporting_machines%rowtype;
  existing_attempt public.refund_case_nayax_refund_attempts%rowtype;
  new_attempt public.refund_case_nayax_refund_attempts%rowtype;
  committed_count integer := 0;
  committed_amount_cents bigint := 0;
  amount_cents integer;
begin
  if p_actor_user_id is null or p_refund_case_id is null then
    raise exception 'Nayax refund claim requires an actor and refund case';
  end if;

  if p_idempotency_key !~ '^nayax-refund-execute-[a-f0-9]{64}$' then
    raise exception 'Nayax refund idempotency key is invalid';
  end if;

  if p_request_fingerprint !~ '^[a-f0-9]{64}$' then
    raise exception 'Nayax refund request fingerprint is invalid';
  end if;

  if p_provider_contract_version !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{5,79}$' then
    raise exception 'Nayax refund provider contract version is invalid';
  end if;

  if coalesce(p_daily_amount_cap_cents, 0) < 0
    or coalesce(p_daily_count_cap, 0) < 0 then
    raise exception 'Nayax refund daily caps cannot be negative';
  end if;

  -- Return an existing result before re-evaluating readiness. This lets a lost
  -- successful HTTP response be recovered without making a second provider call.
  select attempt.*
  into existing_attempt
  from public.refund_case_nayax_refund_attempts attempt
  where attempt.idempotency_key = p_idempotency_key
  limit 1;

  if found then
    return jsonb_build_object(
      'claimed', false,
      'attemptId', existing_attempt.id,
      'status', existing_attempt.status,
      'errorCode', existing_attempt.error_code,
      'providerReference', existing_attempt.provider_reference
    );
  end if;

  -- One transaction lock serializes the cap check and insert across all cases
  -- for the current UTC day.
  perform pg_advisory_xact_lock(
    hashtextextended(
      'refund_nayax_execution:' || ((now() at time zone 'utc')::date)::text,
      0
    )
  );

  -- Re-check after obtaining the lock in case another request just claimed it.
  select attempt.*
  into existing_attempt
  from public.refund_case_nayax_refund_attempts attempt
  where attempt.idempotency_key = p_idempotency_key
  limit 1;

  if found then
    return jsonb_build_object(
      'claimed', false,
      'attemptId', existing_attempt.id,
      'status', existing_attempt.status,
      'errorCode', existing_attempt.error_code,
      'providerReference', existing_attempt.provider_reference
    );
  end if;

  -- A different execution key must not create a second provider attempt for the
  -- same case. Preflight-only rows do not count as provider attempts.
  select attempt.*
  into existing_attempt
  from public.refund_case_nayax_refund_attempts attempt
  where attempt.refund_case_id = p_refund_case_id
    and attempt.execution_mode = 'request_and_approve'
  order by attempt.created_at desc
  limit 1;

  if found then
    return jsonb_build_object(
      'claimed', false,
      'attemptId', existing_attempt.id,
      'status', existing_attempt.status,
      'errorCode', existing_attempt.error_code,
      'providerReference', existing_attempt.provider_reference
    );
  end if;

  -- Lock the case before the final readiness check so a concurrent manager
  -- edit cannot change payment evidence between validation and the claim.
  select refund.*
  into refund_case
  from public.refund_cases refund
  where refund.id = p_refund_case_id
  for update;

  if not found then
    return jsonb_build_object(
      'claimed', false,
      'status', 'preflight_blocked',
      'errorCode', 'validation_rejected'
    );
  end if;

  select machine.*
  into refund_machine
  from public.reporting_machines machine
  where machine.id = refund_case.reporting_machine_id
  for share;

  if not found or not public.can_prepare_nayax_refund_execution(
    p_actor_user_id,
    p_refund_case_id
  ) then
    return jsonb_build_object(
      'claimed', false,
      'status', 'preflight_blocked',
      'errorCode', 'validation_rejected'
    );
  end if;

  amount_cents := refund_case.refund_amount_cents;
  if amount_cents is null or amount_cents <= 0 then
    return jsonb_build_object(
      'claimed', false,
      'status', 'preflight_blocked',
      'errorCode', 'validation_rejected'
    );
  end if;

  select
    count(*)::integer,
    coalesce(sum(attempt.amount_cents), 0)::bigint
  into committed_count, committed_amount_cents
  from public.refund_case_nayax_refund_attempts attempt
  where attempt.execution_mode = 'request_and_approve'
    and attempt.created_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc'
    and attempt.status in (
      'in_progress',
      'requested',
      'approved',
      'succeeded',
      'ambiguous',
      'manual_review'
    );

  if coalesce(p_daily_count_cap, 0) > 0
    and committed_count + 1 > p_daily_count_cap then
    return jsonb_build_object(
      'claimed', false,
      'status', 'preflight_blocked',
      'errorCode', 'daily_count_cap_exceeded'
    );
  end if;

  if coalesce(p_daily_amount_cap_cents, 0) > 0
    and committed_amount_cents + amount_cents > p_daily_amount_cap_cents then
    return jsonb_build_object(
      'claimed', false,
      'status', 'preflight_blocked',
      'errorCode', 'daily_amount_cap_exceeded'
    );
  end if;

  insert into public.refund_case_nayax_refund_attempts (
    refund_case_id,
    actor_user_id,
    execution_mode,
    status,
    idempotency_key,
    amount_cents,
    transaction_id_present,
    site_id_present,
    machine_auth_time_present,
    sanitized_request,
    sanitized_response
  )
  values (
    refund_case.id,
    p_actor_user_id,
    'request_and_approve',
    'in_progress',
    p_idempotency_key,
    amount_cents,
    public.is_review_safe_nayax_transaction_reference(
      refund_case.matched_nayax_transaction_id
    ),
    refund_case.matched_nayax_site_id is not null,
    refund_case.matched_nayax_machine_auth_time is not null,
    jsonb_build_object(
      'request_fingerprint', p_request_fingerprint,
      'refund_case_reference', refund_case.public_reference,
      'amount_cents', amount_cents,
      'currency_code', refund_case.matched_nayax_currency_code,
      'account_key_present', nullif(btrim(refund_machine.nayax_account_key), '') is not null,
      'nayax_machine_id_present', nullif(btrim(refund_machine.nayax_machine_id), '') is not null,
      'provider_contract_version', p_provider_contract_version,
      'payload_redacted', true
    ),
    '{}'::jsonb
  )
  returning *
  into new_attempt;

  return jsonb_build_object(
    'claimed', true,
    'attemptId', new_attempt.id,
    'status', new_attempt.status,
    'errorCode', null,
    'providerReference', null
  );
end;
$$;

comment on function public.service_claim_nayax_refund_execution(uuid, uuid, text, integer, integer, text, text) is
  'Service-role-only atomic claim for one capped Nayax provider refund attempt.';

revoke execute on function public.service_claim_nayax_refund_execution(uuid, uuid, text, integer, integer, text, text)
from public, anon, authenticated;

grant execute on function public.service_claim_nayax_refund_execution(uuid, uuid, text, integer, integer, text, text)
to service_role;

create or replace function public.guard_claimed_nayax_refund_evidence()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if row(
    new.reporting_machine_id,
    new.payment_method,
    new.payment_amount_cents,
    new.refund_amount_cents,
    new.card_wallet_used,
    new.correlation_status,
    new.correlation_source,
    new.nayax_recommendation_state,
    new.nayax_recommendation_policy_version,
    new.nayax_match_execution_eligible,
    new.matched_nayax_transaction_id,
    new.matched_nayax_site_id,
    new.matched_nayax_machine_auth_time,
    new.matched_nayax_amount_cents,
    new.matched_nayax_currency_code
  ) is distinct from row(
    old.reporting_machine_id,
    old.payment_method,
    old.payment_amount_cents,
    old.refund_amount_cents,
    old.card_wallet_used,
    old.correlation_status,
    old.correlation_source,
    old.nayax_recommendation_state,
    old.nayax_recommendation_policy_version,
    old.nayax_match_execution_eligible,
    old.matched_nayax_transaction_id,
    old.matched_nayax_site_id,
    old.matched_nayax_machine_auth_time,
    old.matched_nayax_amount_cents,
    old.matched_nayax_currency_code
  ) and exists (
    select 1
    from public.refund_case_nayax_refund_attempts attempt
    where attempt.refund_case_id = old.id
      and attempt.execution_mode = 'request_and_approve'
  ) then
    raise exception using
      errcode = '23514',
      message = 'Claimed Nayax refund evidence cannot be changed';
  end if;

  return new;
end;
$$;

comment on function public.guard_claimed_nayax_refund_evidence() is
  'Freezes provider transaction and amount evidence after the single-use Nayax claim.';

revoke execute on function public.guard_claimed_nayax_refund_evidence()
from public, anon, authenticated;

drop trigger if exists refund_cases_guard_claimed_nayax_refund_evidence
  on public.refund_cases;
create trigger refund_cases_guard_claimed_nayax_refund_evidence
before update on public.refund_cases
for each row execute function public.guard_claimed_nayax_refund_evidence();
