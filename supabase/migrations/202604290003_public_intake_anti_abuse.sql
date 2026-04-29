alter table public.lead_submissions
  add column if not exists server_dedupe_key text,
  add column if not exists server_dedupe_window_started_at timestamptz;

create unique index if not exists lead_submissions_server_dedupe_key_idx
  on public.lead_submissions (server_dedupe_key)
  where server_dedupe_key is not null;

create index if not exists lead_submissions_server_dedupe_window_idx
  on public.lead_submissions (server_dedupe_window_started_at desc)
  where server_dedupe_window_started_at is not null;

alter table public.internal_notification_dispatches
  drop constraint if exists internal_notification_dispatches_dispatch_type_check;

alter table public.internal_notification_dispatches
  add constraint internal_notification_dispatches_dispatch_type_check
  check (
    dispatch_type in (
      'lead_quote',
      'lead_submission',
      'mini_waitlist',
      'order_checkout',
      'plus_subscription_activated'
    )
  );

create table if not exists public.public_intake_rate_limit_events (
  event_scope text not null,
  key_type text not null,
  key_hash text not null,
  window_started_at timestamptz not null,
  window_seconds integer not null,
  event_count integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (event_scope, key_type, key_hash, window_started_at, window_seconds),
  constraint public_intake_rate_limit_events_scope_check
    check (event_scope in ('submission', 'notification')),
  constraint public_intake_rate_limit_events_key_type_check
    check (key_type in ('ip', 'email', 'source', 'global')),
  constraint public_intake_rate_limit_events_key_hash_check
    check (key_hash ~ '^[0-9a-f]{64}$'),
  constraint public_intake_rate_limit_events_window_seconds_check
    check (window_seconds between 60 and 86400),
  constraint public_intake_rate_limit_events_count_check
    check (event_count > 0)
);

create index if not exists public_intake_rate_limit_events_updated_at_idx
  on public.public_intake_rate_limit_events (updated_at);

alter table public.public_intake_rate_limit_events enable row level security;

drop policy if exists "public_intake_rate_limit_events_select_super_admin"
  on public.public_intake_rate_limit_events;

create policy "public_intake_rate_limit_events_select_super_admin"
on public.public_intake_rate_limit_events
for select
to authenticated
using (public.is_super_admin(auth.uid()));

create or replace function public.record_public_intake_rate_limit_event(
  p_event_scope text,
  p_key_type text,
  p_key_hash text,
  p_window_seconds integer
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := statement_timestamp();
  v_window_started_at timestamptz;
  v_event_count integer;
begin
  if p_event_scope not in ('submission', 'notification') then
    raise exception 'Unsupported public intake event scope.';
  end if;

  if p_key_type not in ('ip', 'email', 'source', 'global') then
    raise exception 'Unsupported public intake key type.';
  end if;

  if p_key_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid public intake key hash.';
  end if;

  if p_window_seconds < 60 or p_window_seconds > 86400 then
    raise exception 'Invalid public intake rate-limit window.';
  end if;

  v_window_started_at :=
    to_timestamp(floor(extract(epoch from v_now) / p_window_seconds) * p_window_seconds);

  insert into public.public_intake_rate_limit_events (
    event_scope,
    key_type,
    key_hash,
    window_started_at,
    window_seconds,
    event_count,
    created_at,
    updated_at
  )
  values (
    p_event_scope,
    p_key_type,
    p_key_hash,
    v_window_started_at,
    p_window_seconds,
    1,
    v_now,
    v_now
  )
  on conflict (event_scope, key_type, key_hash, window_started_at, window_seconds)
  do update
  set
    event_count = public.public_intake_rate_limit_events.event_count + 1,
    updated_at = excluded.updated_at
  returning event_count into v_event_count;

  delete from public.public_intake_rate_limit_events
  where updated_at < v_now - interval '2 days';

  return v_event_count;
end;
$$;

revoke all on function public.record_public_intake_rate_limit_event(text, text, text, integer)
  from public, anon, authenticated;

grant execute on function public.record_public_intake_rate_limit_event(text, text, text, integer)
  to service_role;

select pg_notify('pgrst', 'reload schema');
