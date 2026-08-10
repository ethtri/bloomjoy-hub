-- Allow the Plus Checkout Edge Function to discard a provider-expired
-- durable attempt after Stripe has authoritatively reported no reusable open
-- session for the authenticated account.

create or replace function public.release_my_stale_plus_checkout_attempt(
  p_stripe_checkout_session_id text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  released boolean := false;
begin
  if current_user_id is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  if p_stripe_checkout_session_id !~ '^cs_[A-Za-z0-9_]+$' then
    raise exception 'Invalid Stripe Checkout Session.' using errcode = '22023';
  end if;

  delete from public.plus_checkout_attempts
  where user_id = current_user_id
    and status = 'ready'
    and stripe_checkout_session_id = p_stripe_checkout_session_id;

  released := found;
  return released;
end;
$$;

revoke all on function public.release_my_stale_plus_checkout_attempt(text) from public, anon;
grant execute on function public.release_my_stale_plus_checkout_attempt(text) to authenticated;
