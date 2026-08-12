-- Atomic daily caps for the receipt-bound Nayax provider attempt.
--
-- This wraps the existing #689-compatible reservation function instead of
-- reintroducing the older arbitrary-actor claim/finalization paths. The lock
-- covers only the short database cap check and attempt reservation; it is
-- released before the Edge Function performs either provider HTTP request.

create index if not exists refund_case_nayax_attempt_daily_cap_idx
  on public.refund_case_nayax_refund_attempts (created_at)
  include (amount_cents)
  where execution_mode = 'request_and_approve';

create or replace function public.service_reserve_and_consume_nayax_refund_attempt_v2(
  p_executor_assertion text,
  p_authorization_id uuid,
  p_case_id uuid,
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
  existing_attempt_id uuid;
  current_daily_amount_cents bigint := 0;
  current_daily_count integer := 0;
  utc_day_start timestamptz :=
    date_trunc('day', statement_timestamp() at time zone 'UTC') at time zone 'UTC';
begin
  perform public.assert_nayax_provider_executor(p_executor_assertion);

  if p_authorization_id is null or p_case_id is null then
    raise exception 'Exact Nayax authorization and case are required';
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
  if p_daily_amount_cap_cents is null
    or p_daily_amount_cap_cents <= 0
    or p_daily_amount_cap_cents > 1000000
    or p_daily_count_cap is null
    or p_daily_count_cap <= 0
    or p_daily_count_cap > 100 then
    raise exception 'Valid bounded Nayax daily caps are required';
  end if;

  -- Serialize only the short UTC-day check and reservation. Every production
  -- caller must use this wrapper; the legacy reservation RPC is revoked below.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'refund_nayax_daily_caps_v1|' || utc_day_start::text,
      0
    )
  );

  -- Replays must return the original reservation without consuming cap twice.
  -- The wrapped function revalidates the exact authorization, case, amount,
  -- currency, and immutable request fingerprint before returning it.
  select attempt.id
  into existing_attempt_id
  from public.refund_case_nayax_refund_attempts attempt
  where attempt.idempotency_key = p_idempotency_key
  for update;

  if existing_attempt_id is not null then
    return public.service_reserve_and_consume_nayax_refund_attempt(
      p_executor_assertion,
      p_authorization_id,
      p_case_id,
      p_idempotency_key,
      p_amount_cents,
      'USD'
    );
  end if;

  select
    count(*)::integer,
    coalesce(sum(attempt.amount_cents), 0)::bigint
  into current_daily_count, current_daily_amount_cents
  from public.refund_case_nayax_refund_attempts attempt
  where attempt.execution_mode = 'request_and_approve'
    and attempt.created_at >= utc_day_start
    and attempt.created_at < utc_day_start + interval '1 day';

  if current_daily_count + 1 > p_daily_count_cap then
    raise exception 'Nayax daily refund count cap exceeded';
  end if;
  if current_daily_amount_cents + p_amount_cents > p_daily_amount_cap_cents then
    raise exception 'Nayax daily refund amount cap exceeded';
  end if;

  return public.service_reserve_and_consume_nayax_refund_attempt(
    p_executor_assertion,
    p_authorization_id,
    p_case_id,
    p_idempotency_key,
    p_amount_cents,
    'USD'
  );
end;
$$;

-- Force all service callers through the cap wrapper. The wrapper is a
-- SECURITY DEFINER function owned by the migration owner and can still invoke
-- the now-private original reservation implementation.
revoke execute on function public.service_reserve_and_consume_nayax_refund_attempt(
  text, uuid, uuid, text, integer, text
) from service_role;

revoke execute on function public.service_reserve_and_consume_nayax_refund_attempt_v2(
  text, uuid, uuid, text, integer, integer, integer, text
) from public, anon, authenticated;
grant execute on function public.service_reserve_and_consume_nayax_refund_attempt_v2(
  text, uuid, uuid, text, integer, integer, integer, text
) to service_role;

comment on function public.service_reserve_and_consume_nayax_refund_attempt_v2(
  text, uuid, uuid, text, integer, integer, integer, text
) is
  'Atomically enforces bounded UTC-day Nayax count and amount caps before consuming one mapped-manager authorization and reserving one provider attempt.';
