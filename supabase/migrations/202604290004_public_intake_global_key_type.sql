alter table public.public_intake_rate_limit_events
  drop constraint if exists public_intake_rate_limit_events_key_type_check;

alter table public.public_intake_rate_limit_events
  add constraint public_intake_rate_limit_events_key_type_check
  check (key_type in ('ip', 'email', 'source', 'global'));

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
