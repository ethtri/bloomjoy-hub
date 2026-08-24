-- The refund Edge functions need aggregate daily usage for readiness caps, but
-- the underlying attempt ledger is intentionally unreadable by service_role.
-- Keep the ledger private and expose only the two non-identifying totals.

create or replace function public.service_refund_nayax_daily_usage()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'dailyCountUsed', count(*)::integer,
    'dailyAmountUsedCents', coalesce(sum(attempt.amount_cents), 0)::bigint
  )
  from public.refund_case_nayax_refund_attempts attempt
  where attempt.execution_mode = 'request_and_approve'
    and attempt.created_at >= (
      date_trunc('day', statement_timestamp() at time zone 'UTC')
      at time zone 'UTC'
    )
    and attempt.created_at < (
      date_trunc('day', statement_timestamp() at time zone 'UTC')
      at time zone 'UTC'
    ) + interval '1 day';
$$;

comment on function public.service_refund_nayax_daily_usage() is
  'Service-only aggregate UTC-day Nayax refund usage for runtime cap readiness; returns no attempt or customer identifiers.';

revoke execute on function public.service_refund_nayax_daily_usage()
  from public, anon, authenticated;
grant execute on function public.service_refund_nayax_daily_usage()
  to service_role;
