create table if not exists public.refund_automation_runs (
  id uuid primary key default gen_random_uuid(),
  run_key text not null unique,
  trigger_source text not null,
  scheduled_for timestamptz,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running',
  cases_evaluated integer not null default 0,
  actions_attempted integer not null default 0,
  actions_succeeded integer not null default 0,
  actions_failed integer not null default 0,
  actions_suppressed integer not null default 0,
  reason_counts jsonb not null default '{}'::jsonb,
  failure_category text,
  alert_status text not null default 'not_needed',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint refund_automation_runs_run_key_check
    check (length(run_key) between 8 and 160 and run_key ~ '^[A-Za-z0-9:_-]+$'),
  constraint refund_automation_runs_trigger_source_check
    check (trigger_source in ('scheduled', 'manual', 'health_check', 'failure_test')),
  constraint refund_automation_runs_status_check
    check (status in ('running', 'succeeded', 'failed', 'suppressed')),
  constraint refund_automation_runs_counts_check
    check (
      cases_evaluated >= 0
      and actions_attempted >= 0
      and actions_succeeded >= 0
      and actions_failed >= 0
      and actions_suppressed >= 0
    ),
  constraint refund_automation_runs_reason_counts_check
    check (jsonb_typeof(reason_counts) = 'object'),
  constraint refund_automation_runs_alert_status_check
    check (alert_status in ('not_needed', 'pending', 'sent', 'failed', 'suppressed'))
);

create index if not exists refund_automation_runs_started_at_idx
  on public.refund_automation_runs (started_at desc);

create index if not exists refund_automation_runs_health_idx
  on public.refund_automation_runs (trigger_source, status, started_at desc);

create table if not exists public.refund_automation_actions (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.refund_automation_runs(id) on delete cascade,
  refund_case_id uuid references public.refund_cases(id) on delete cascade,
  action_key text not null unique,
  action_type text not null,
  case_state text,
  policy_window_start timestamptz,
  status text not null default 'claimed',
  reason_category text,
  message_id uuid references public.refund_case_messages(id) on delete set null,
  metadata jsonb not null default '{"payload_redacted":true}'::jsonb,
  attempted_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint refund_automation_actions_key_check
    check (length(action_key) between 8 and 220 and action_key ~ '^[A-Za-z0-9:._-]+$'),
  constraint refund_automation_actions_type_check
    check (action_type in ('nayax_lookup', 'customer_reminder', 'customer_more_info', 'internal_escalation', 'ops_alert')),
  constraint refund_automation_actions_status_check
    check (status in ('claimed', 'completed', 'failed', 'suppressed')),
  constraint refund_automation_actions_metadata_check
    check (
      jsonb_typeof(metadata) = 'object'
      and metadata ->> 'payload_redacted' = 'true'
    )
);

create index if not exists refund_automation_actions_run_idx
  on public.refund_automation_actions (run_id, attempted_at desc);

create index if not exists refund_automation_actions_case_idx
  on public.refund_automation_actions (refund_case_id, action_type, attempted_at desc)
  where refund_case_id is not null;

alter table public.refund_automation_runs enable row level security;
alter table public.refund_automation_actions enable row level security;

revoke all on table public.refund_automation_runs from public, anon, authenticated;
revoke all on table public.refund_automation_actions from public, anon, authenticated;
grant select, insert, update, delete on table public.refund_automation_runs to service_role;
grant select, insert, update, delete on table public.refund_automation_actions to service_role;

create or replace function public.service_start_refund_automation_run(
  p_run_key text,
  p_trigger_source text,
  p_scheduled_for timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_run_key text;
  run_row public.refund_automation_runs;
  claimed boolean := false;
begin
  normalized_run_key := nullif(btrim(coalesce(p_run_key, '')), '');
  if normalized_run_key is null
    or length(normalized_run_key) not between 8 and 160
    or normalized_run_key !~ '^[A-Za-z0-9:_-]+$' then
    raise exception 'A safe refund automation run key is required';
  end if;

  if p_trigger_source not in ('scheduled', 'manual', 'health_check', 'failure_test') then
    raise exception 'Unsupported refund automation trigger source';
  end if;

  insert into public.refund_automation_runs (
    run_key,
    trigger_source,
    scheduled_for
  )
  values (
    normalized_run_key,
    p_trigger_source,
    p_scheduled_for
  )
  on conflict (run_key) do nothing
  returning * into run_row;

  if run_row.id is not null then
    claimed := true;
  else
    select *
    into run_row
    from public.refund_automation_runs
    where run_key = normalized_run_key;
  end if;

  return jsonb_build_object(
    'runId', run_row.id,
    'claimed', claimed,
    'status', run_row.status,
    'startedAt', run_row.started_at,
    'finishedAt', run_row.finished_at
  );
end;
$$;

create or replace function public.service_claim_refund_automation_action(
  p_run_id uuid,
  p_refund_case_id uuid,
  p_action_key text,
  p_action_type text,
  p_case_state text default null,
  p_policy_window_start timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_action_key text;
  action_row public.refund_automation_actions;
  claimed boolean := false;
begin
  if not exists (
    select 1
    from public.refund_automation_runs automation_run
    where automation_run.id = p_run_id
      and automation_run.status = 'running'
  ) then
    raise exception 'An active refund automation run is required';
  end if;

  if p_refund_case_id is not null
    and not exists (
      select 1
      from public.refund_cases refund_case
      where refund_case.id = p_refund_case_id
    ) then
    raise exception 'Refund case not found';
  end if;

  normalized_action_key := nullif(btrim(coalesce(p_action_key, '')), '');
  if normalized_action_key is null
    or length(normalized_action_key) not between 8 and 220
    or normalized_action_key !~ '^[A-Za-z0-9:._-]+$' then
    raise exception 'A safe refund automation action key is required';
  end if;

  if p_action_type not in ('nayax_lookup', 'customer_reminder', 'customer_more_info', 'internal_escalation', 'ops_alert') then
    raise exception 'Unsupported refund automation action type';
  end if;

  insert into public.refund_automation_actions (
    run_id,
    refund_case_id,
    action_key,
    action_type,
    case_state,
    policy_window_start,
    metadata
  )
  values (
    p_run_id,
    p_refund_case_id,
    normalized_action_key,
    p_action_type,
    nullif(btrim(coalesce(p_case_state, '')), ''),
    p_policy_window_start,
    jsonb_build_object('payload_redacted', true)
  )
  on conflict (action_key) do nothing
  returning * into action_row;

  if action_row.id is not null then
    claimed := true;
  else
    select *
    into action_row
    from public.refund_automation_actions
    where action_key = normalized_action_key;
  end if;

  return jsonb_build_object(
    'actionId', action_row.id,
    'claimed', claimed,
    'status', action_row.status,
    'reasonCategory', action_row.reason_category
  );
end;
$$;

create or replace function public.service_finish_refund_automation_action(
  p_action_id uuid,
  p_status text,
  p_reason_category text default null,
  p_message_id uuid default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_count integer;
begin
  if p_status not in ('completed', 'failed', 'suppressed') then
    raise exception 'Unsupported refund automation action result';
  end if;

  update public.refund_automation_actions
  set
    status = p_status,
    reason_category = nullif(btrim(coalesce(p_reason_category, '')), ''),
    message_id = p_message_id,
    completed_at = now(),
    updated_at = now()
  where id = p_action_id
    and status = 'claimed';

  get diagnostics updated_count = row_count;
  return updated_count = 1;
end;
$$;

create or replace function public.service_finish_refund_automation_run(
  p_run_id uuid,
  p_status text,
  p_cases_evaluated integer default 0,
  p_actions_attempted integer default 0,
  p_actions_succeeded integer default 0,
  p_actions_failed integer default 0,
  p_actions_suppressed integer default 0,
  p_reason_counts jsonb default '{}'::jsonb,
  p_failure_category text default null,
  p_alert_status text default 'not_needed'
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_count integer;
begin
  if p_status not in ('succeeded', 'failed', 'suppressed') then
    raise exception 'Unsupported refund automation run result';
  end if;

  if least(
    coalesce(p_cases_evaluated, 0),
    coalesce(p_actions_attempted, 0),
    coalesce(p_actions_succeeded, 0),
    coalesce(p_actions_failed, 0),
    coalesce(p_actions_suppressed, 0)
  ) < 0 then
    raise exception 'Refund automation counts cannot be negative';
  end if;

  if jsonb_typeof(coalesce(p_reason_counts, '{}'::jsonb)) <> 'object' then
    raise exception 'Refund automation reason counts must be an object';
  end if;

  if p_alert_status not in ('not_needed', 'pending', 'sent', 'failed', 'suppressed') then
    raise exception 'Unsupported refund automation alert result';
  end if;

  update public.refund_automation_runs
  set
    status = p_status,
    cases_evaluated = coalesce(p_cases_evaluated, 0),
    actions_attempted = coalesce(p_actions_attempted, 0),
    actions_succeeded = coalesce(p_actions_succeeded, 0),
    actions_failed = coalesce(p_actions_failed, 0),
    actions_suppressed = coalesce(p_actions_suppressed, 0),
    reason_counts = coalesce(p_reason_counts, '{}'::jsonb),
    failure_category = nullif(btrim(coalesce(p_failure_category, '')), ''),
    alert_status = p_alert_status,
    finished_at = now(),
    updated_at = now()
  where id = p_run_id
    and status = 'running';

  get diagnostics updated_count = row_count;
  return updated_count = 1;
end;
$$;

create or replace function public.service_get_refund_automation_health()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  latest_run public.refund_automation_runs;
  latest_success public.refund_automation_runs;
  consecutive_failures integer := 0;
  stale_after_minutes integer := 60;
  health_status text;
begin
  select *
  into latest_run
  from public.refund_automation_runs automation_run
  where automation_run.trigger_source in ('scheduled', 'manual')
  order by automation_run.started_at desc
  limit 1;

  select *
  into latest_success
  from public.refund_automation_runs automation_run
  where automation_run.trigger_source in ('scheduled', 'manual')
    and automation_run.status = 'succeeded'
  order by automation_run.finished_at desc nulls last, automation_run.started_at desc
  limit 1;

  select count(*)::integer
  into consecutive_failures
  from public.refund_automation_runs automation_run
  where automation_run.trigger_source in ('scheduled', 'manual')
    and automation_run.status = 'failed'
    and (
      latest_success.id is null
      or automation_run.started_at > latest_success.started_at
    );

  health_status := case
    when latest_run.id is null then 'waiting'
    when latest_run.status = 'suppressed'
      and latest_run.failure_category = 'automation_disabled' then 'paused'
    when latest_success.id is null and consecutive_failures >= 2 then 'failing'
    when latest_success.id is null then 'waiting'
    when latest_success.finished_at < now() - make_interval(mins => stale_after_minutes) then 'stale'
    when latest_run.status = 'failed' or consecutive_failures >= 2 then 'failing'
    else 'healthy'
  end;

  return jsonb_build_object(
    'status', health_status,
    'lastRunAt', latest_run.started_at,
    'lastSuccessAt', latest_success.finished_at,
    'lastRunStatus', latest_run.status,
    'consecutiveFailures', consecutive_failures,
    'staleAfterMinutes', stale_after_minutes,
    'casesEvaluated', coalesce(latest_run.cases_evaluated, 0),
    'actionsAttempted', coalesce(latest_run.actions_attempted, 0),
    'actionsSucceeded', coalesce(latest_run.actions_succeeded, 0),
    'actionsFailed', coalesce(latest_run.actions_failed, 0),
    'actionsSuppressed', coalesce(latest_run.actions_suppressed, 0),
    'failureCategory', latest_run.failure_category,
    'alertStatus', coalesce(latest_run.alert_status, 'not_needed'),
    'payloadRedacted', true
  );
end;
$$;

create or replace function public.get_refund_automation_health()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  actor_user_id uuid;
begin
  actor_user_id := auth.uid();
  if actor_user_id is null then
    raise exception 'Authentication required';
  end if;

  if not (
    public.is_super_admin(actor_user_id)
    or public.is_scoped_admin(actor_user_id)
    or public.user_is_refund_manager(actor_user_id)
  ) then
    raise exception 'Refund operations access required';
  end if;

  return public.service_get_refund_automation_health();
end;
$$;

revoke execute on function public.service_start_refund_automation_run(text, text, timestamp with time zone)
  from public, anon, authenticated;
revoke execute on function public.service_claim_refund_automation_action(uuid, uuid, text, text, text, timestamp with time zone)
  from public, anon, authenticated;
revoke execute on function public.service_finish_refund_automation_action(uuid, text, text, uuid)
  from public, anon, authenticated;
revoke execute on function public.service_finish_refund_automation_run(uuid, text, integer, integer, integer, integer, integer, jsonb, text, text)
  from public, anon, authenticated;
revoke execute on function public.service_get_refund_automation_health()
  from public, anon, authenticated;
revoke execute on function public.get_refund_automation_health()
  from public, anon;

grant execute on function public.service_start_refund_automation_run(text, text, timestamp with time zone)
  to service_role;
grant execute on function public.service_claim_refund_automation_action(uuid, uuid, text, text, text, timestamp with time zone)
  to service_role;
grant execute on function public.service_finish_refund_automation_action(uuid, text, text, uuid)
  to service_role;
grant execute on function public.service_finish_refund_automation_run(uuid, text, integer, integer, integer, integer, integer, jsonb, text, text)
  to service_role;
grant execute on function public.service_get_refund_automation_health()
  to service_role;
grant execute on function public.get_refund_automation_health()
  to authenticated;

comment on table public.refund_automation_runs is
  'Sanitized scheduler-run ledger for Refund Operations automation. Contains aggregate counts and reason categories only.';

comment on table public.refund_automation_actions is
  'Once-only action claims for Refund Operations automation. Keys are deterministic and metadata is redacted.';

comment on function public.get_refund_automation_health() is
  'Returns redacted scheduler health and aggregate counts to authorized refund operators.';

select pg_notify('pgrst', 'reload schema');
