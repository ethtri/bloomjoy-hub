-- This trigger helper is invoked only by the existing table trigger. Keep it
-- out of the Data API role surface even though PostgreSQL rejects direct calls
-- to functions that return trigger.
revoke all on function public.guard_refund_nayax_lookup_retry_budget()
  from public, anon, authenticated;
