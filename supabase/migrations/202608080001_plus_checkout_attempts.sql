-- Durable, per-account lease for Plus Checkout creation.
-- The lease keeps simultaneous browser tabs from creating separate payable sessions.

create table if not exists public.plus_checkout_attempts (
  user_id uuid primary key references auth.users (id) on delete cascade,
  attempt_token uuid not null,
  status text not null check (status in ('creating', 'ready')),
  stripe_checkout_session_id text,
  checkout_url text,
  lease_expires_at timestamptz not null,
  updated_at timestamptz not null default now(),
  check (
    (status = 'creating' and stripe_checkout_session_id is null and checkout_url is null)
    or
    (
      status = 'ready'
      and stripe_checkout_session_id like 'cs\_%' escape '\'
      and checkout_url like 'https://checkout.stripe.com/%'
    )
  )
);

alter table public.plus_checkout_attempts enable row level security;
alter table public.plus_checkout_attempts force row level security;

revoke all on table public.plus_checkout_attempts from public, anon, authenticated;

create or replace function public.claim_my_plus_checkout_attempt()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  current_attempt public.plus_checkout_attempts%rowtype;
  inserted_attempt boolean := false;
begin
  if current_user_id is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  insert into public.plus_checkout_attempts (
    user_id,
    attempt_token,
    status,
    lease_expires_at
  )
  values (
    current_user_id,
    extensions.gen_random_uuid(),
    'creating',
    now() + interval '5 minutes'
  )
  on conflict (user_id) do nothing
  returning * into current_attempt;

  inserted_attempt := found;
  if inserted_attempt then
    return jsonb_build_object(
      'owner', true,
      'status', current_attempt.status,
      'attemptToken', current_attempt.attempt_token,
      'checkoutUrl', null
    );
  end if;

  select *
  into current_attempt
  from public.plus_checkout_attempts
  where user_id = current_user_id
  for update;

  if current_attempt.lease_expires_at > now() then
    return jsonb_build_object(
      'owner', false,
      'status', current_attempt.status,
      'attemptToken', null,
      'checkoutUrl', current_attempt.checkout_url
    );
  end if;

  -- A timed-out Stripe create can have succeeded remotely. Reclaim the same
  -- token during the Checkout Session/idempotency window so retries use the
  -- same Stripe idempotency key instead of creating a second payable session.
  if
    current_attempt.status = 'creating'
    and current_attempt.updated_at > now() - interval '25 hours'
  then
    update public.plus_checkout_attempts
    set lease_expires_at = now() + interval '5 minutes'
    where user_id = current_user_id
    returning * into current_attempt;

    return jsonb_build_object(
      'owner', true,
      'status', current_attempt.status,
      'attemptToken', current_attempt.attempt_token,
      'checkoutUrl', null
    );
  end if;

  update public.plus_checkout_attempts
  set
    attempt_token = extensions.gen_random_uuid(),
    status = 'creating',
    stripe_checkout_session_id = null,
    checkout_url = null,
    lease_expires_at = now() + interval '5 minutes',
    updated_at = now()
  where user_id = current_user_id
  returning * into current_attempt;

  return jsonb_build_object(
    'owner', true,
    'status', current_attempt.status,
    'attemptToken', current_attempt.attempt_token,
    'checkoutUrl', null
  );
end;
$$;

create or replace function public.complete_my_plus_checkout_attempt(
  p_attempt_token uuid,
  p_stripe_checkout_session_id text,
  p_checkout_url text,
  p_expires_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  completed boolean := false;
begin
  if current_user_id is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  if
    p_attempt_token is null
    or p_stripe_checkout_session_id !~ '^cs_[A-Za-z0-9_]+$'
    or p_checkout_url not like 'https://checkout.stripe.com/%'
    or char_length(p_checkout_url) > 4096
    or p_expires_at <= now()
    or p_expires_at > now() + interval '25 hours'
  then
    raise exception 'Invalid Plus checkout attempt completion.' using errcode = '22023';
  end if;

  update public.plus_checkout_attempts
  set
    status = 'ready',
    stripe_checkout_session_id = p_stripe_checkout_session_id,
    checkout_url = p_checkout_url,
    lease_expires_at = p_expires_at,
    updated_at = now()
  where user_id = current_user_id
    and attempt_token = p_attempt_token
    and status = 'creating'
    and lease_expires_at > now();

  completed := found;
  return completed;
end;
$$;

create or replace function public.mark_my_plus_checkout_provider_attempt(
  p_attempt_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  marked boolean := false;
begin
  if current_user_id is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  update public.plus_checkout_attempts
  set updated_at = now()
  where user_id = current_user_id
    and attempt_token = p_attempt_token
    and status = 'creating'
    and lease_expires_at > now();

  marked := found;
  return marked;
end;
$$;

create or replace function public.preserve_my_plus_checkout_attempt_for_retry(
  p_attempt_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  preserved boolean := false;
begin
  if current_user_id is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  update public.plus_checkout_attempts
  set
    lease_expires_at = now(),
    updated_at = now()
  where user_id = current_user_id
    and attempt_token = p_attempt_token
    and status = 'creating';

  preserved := found;
  return preserved;
end;
$$;

create or replace function public.release_my_plus_checkout_attempt(
  p_attempt_token uuid
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

  delete from public.plus_checkout_attempts
  where user_id = current_user_id
    and attempt_token = p_attempt_token
    and status = 'creating';

  released := found;
  return released;
end;
$$;

revoke all on function public.claim_my_plus_checkout_attempt() from public, anon;
revoke all on function public.complete_my_plus_checkout_attempt(uuid, text, text, timestamptz) from public, anon;
revoke all on function public.mark_my_plus_checkout_provider_attempt(uuid) from public, anon;
revoke all on function public.preserve_my_plus_checkout_attempt_for_retry(uuid) from public, anon;
revoke all on function public.release_my_plus_checkout_attempt(uuid) from public, anon;

grant execute on function public.claim_my_plus_checkout_attempt() to authenticated;
grant execute on function public.complete_my_plus_checkout_attempt(uuid, text, text, timestamptz) to authenticated;
grant execute on function public.mark_my_plus_checkout_provider_attempt(uuid) to authenticated;
grant execute on function public.preserve_my_plus_checkout_attempt_for_retry(uuid) to authenticated;
grant execute on function public.release_my_plus_checkout_attempt(uuid) to authenticated;
