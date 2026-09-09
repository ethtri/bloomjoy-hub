-- #1257: make Pay Stub freshness deterministic across concurrent time changes,
-- propagate older-period changes into later YTD statements, and reject every
-- time-entry write whose destination payout period is voided.

create sequence if not exists private.time_entry_change_source_revision_seq
  as bigint
  minvalue 1
  start with 1
  increment by 1
  no cycle;

revoke all on sequence private.time_entry_change_source_revision_seq
  from public, anon, authenticated;
grant usage, select on sequence private.time_entry_change_source_revision_seq
  to service_role;

alter table public.time_entry_change_events
  add column if not exists source_revision bigint;

with ranked_events as (
  select
    event.id,
    row_number() over (order by event.created_at, event.id)::bigint as source_revision
  from public.time_entry_change_events event
  where event.source_revision is null
)
update public.time_entry_change_events event
set source_revision = ranked.source_revision
from ranked_events ranked
where ranked.id = event.id;

select setval(
  'private.time_entry_change_source_revision_seq',
  coalesce((select max(event.source_revision) from public.time_entry_change_events event), 1),
  exists(select 1 from public.time_entry_change_events)
);

alter table public.time_entry_change_events
  alter column source_revision
    set default nextval('private.time_entry_change_source_revision_seq'),
  alter column source_revision set not null;

create unique index if not exists time_entry_change_events_source_revision_uidx
  on public.time_entry_change_events (source_revision);

create index if not exists time_entry_change_events_profile_source_revision_idx
  on public.time_entry_change_events (operator_profile_id, source_revision desc);

create or replace function private.operator_pay_time_source_lock_key(
  p_operator_profile_id uuid,
  p_calendar_year integer
)
returns bigint
language sql
immutable
set search_path = ''
as $$
  select hashtextextended(
    'operator-pay-time-source:'
      || p_operator_profile_id::text
      || ':'
      || p_calendar_year::text,
    0
  );
$$;

revoke execute on function private.operator_pay_time_source_lock_key(uuid, integer)
  from public, anon, authenticated;
grant execute on function private.operator_pay_time_source_lock_key(uuid, integer)
  to service_role;

create or replace function public.record_time_entry_change_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  configured_kind text;
  resolved_kind text;
  lock_key bigint;
begin
  -- Serialize statement calculation and time changes for every affected
  -- Technician/calendar-year pair. Sorted acquisition prevents deadlocks when
  -- a correction moves time across a profile or year boundary.
  for lock_key in
    select distinct affected.lock_key
    from (
      select private.operator_pay_time_source_lock_key(
        case when tg_op = 'UPDATE' then old.operator_profile_id else new.operator_profile_id end,
        extract(year from case when tg_op = 'UPDATE' then old.work_date else new.work_date end)::integer
      ) as lock_key
      union all
      select private.operator_pay_time_source_lock_key(
        new.operator_profile_id,
        extract(year from new.work_date)::integer
      )
    ) affected
    order by affected.lock_key
  loop
    perform pg_advisory_xact_lock(lock_key);
  end loop;

  configured_kind := nullif(
    current_setting('app.timekeeping_change_kind', true),
    ''
  );

  resolved_kind := coalesce(configured_kind, 'system_changed');

  insert into public.time_entry_change_events (
    time_entry_id,
    account_id,
    operator_profile_id,
    reporting_machine_id,
    actor_user_id,
    change_kind,
    before_state,
    after_state
  )
  values (
    new.id,
    new.account_id,
    new.operator_profile_id,
    new.reporting_machine_id,
    auth.uid(),
    resolved_kind,
    case when tg_op = 'UPDATE' then to_jsonb(old) else null end,
    to_jsonb(new)
  );

  return new;
end;
$$;

drop trigger if exists time_entries_record_change_event on public.time_entries;
create trigger time_entries_record_change_event
after insert or update of
  operator_profile_id,
  reporting_machine_id,
  reporting_location_id,
  payout_policy_id,
  payout_period_id,
  work_date,
  start_time,
  end_time,
  actual_start_at,
  actual_end_at,
  raw_duration_minutes,
  rounded_paid_minutes,
  paid_shift_count,
  notes,
  status
on public.time_entries
for each row execute function public.record_time_entry_change_event();

revoke execute on function public.record_time_entry_change_event()
  from public, anon, authenticated;
grant execute on function public.record_time_entry_change_event()
  to service_role;

create or replace function private.guard_time_entry_voided_payout_period()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  period_status text;
begin
  -- Lock the destination period against a concurrent status change. A status
  -- update must therefore linearize before this write (and be observed) or
  -- after this write commits.
  select period.status into period_status
  from public.payout_periods period
  where period.id = new.payout_period_id
  for share;

  if period_status = 'voided' then
    raise exception 'Voided pay periods cannot accept time changes';
  end if;

  return new;
end;
$$;

revoke execute on function private.guard_time_entry_voided_payout_period()
  from public, anon, authenticated;
grant execute on function private.guard_time_entry_voided_payout_period()
  to service_role;

drop trigger if exists time_entries_guard_voided_payout_period on public.time_entries;
create trigger time_entries_guard_voided_payout_period
before insert or update on public.time_entries
for each row execute function private.guard_time_entry_voided_payout_period();

create or replace function private.operator_pay_time_source_revision(
  p_operator_profile_id uuid,
  p_through_date date
)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(max(event.source_revision), 0)::bigint
  from public.time_entry_change_events event
  where (
      (
        coalesce(
          nullif(event.after_state ->> 'operator_profile_id', '')::uuid,
          event.operator_profile_id
        ) = p_operator_profile_id
        and nullif(event.after_state ->> 'work_date', '')::date between
          date_trunc('year', p_through_date::timestamp)::date and p_through_date
      )
      or (
        nullif(event.before_state ->> 'operator_profile_id', '')::uuid = p_operator_profile_id
        and nullif(event.before_state ->> 'work_date', '')::date between
          date_trunc('year', p_through_date::timestamp)::date and p_through_date
      )
    );
$$;

revoke execute on function private.operator_pay_time_source_revision(uuid, date)
  from public, anon, authenticated;
grant execute on function private.operator_pay_time_source_revision(uuid, date)
  to service_role;

-- Give already-generated v2 statements a best available source watermark.
-- New statements use the serialized wrapper below and do not depend on time.
update public.pay_statements statement
set statement_payload = statement.statement_payload || jsonb_build_object(
  'calculationMeta',
  coalesce(statement.statement_payload -> 'calculationMeta', '{}'::jsonb)
    || jsonb_build_object(
      'paySourceRevision',
      coalesce((
        select max(event.source_revision)
        from public.time_entry_change_events event
        where event.created_at <= coalesce(
            statement.statement_generated_at,
            statement.issued_at,
            statement.created_at
          )
          and (
            (
              coalesce(
                nullif(event.after_state ->> 'operator_profile_id', '')::uuid,
                event.operator_profile_id
              ) = statement.operator_profile_id
              and nullif(event.after_state ->> 'work_date', '')::date between
                date_trunc('year', period.period_end_date::timestamp)::date
                and period.period_end_date
            )
            or (
              nullif(event.before_state ->> 'operator_profile_id', '')::uuid = statement.operator_profile_id
              and nullif(event.before_state ->> 'work_date', '')::date between
                date_trunc('year', period.period_end_date::timestamp)::date
                and period.period_end_date
            )
          )
      ), 0)
    )
)
from public.payout_runs run
join public.payout_periods period on period.id = run.payout_period_id
where run.id = statement.payout_run_id
  and statement.statement_payload ->> 'schemaVersion' = 'operator-pay-stub-v2'
  and nullif(statement.statement_payload #>> '{calculationMeta,paySourceRevision}', '') is null;

create or replace function private.operator_pay_stub_regeneration_required(
  p_operator_profile_id uuid,
  p_period_start date,
  p_period_end date
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with latest_statement as (
    select
      nullif(
        statement.statement_payload #>> '{calculationMeta,paySourceRevision}',
        ''
      )::bigint as source_revision
    from public.pay_statements statement
    join public.payout_runs run on run.id = statement.payout_run_id
    join public.payout_periods period on period.id = run.payout_period_id
    where statement.operator_profile_id = p_operator_profile_id
      and statement.status = 'issued'
      and statement.statement_payload ->> 'schemaVersion' = 'operator-pay-stub-v2'
      and period.period_start_date = p_period_start
      and period.period_end_date = p_period_end
    order by statement.version desc, statement.issued_at desc nulls last, statement.created_at desc
    limit 1
  )
  select coalesce(
    (
      select latest.source_revision is null
        or latest.source_revision < private.operator_pay_time_source_revision(
          p_operator_profile_id,
          p_period_end
        )
      from latest_statement latest
    ),
    false
  );
$$;

revoke execute on function private.operator_pay_stub_regeneration_required(uuid, date, date)
  from public, anon, authenticated;
grant execute on function private.operator_pay_stub_regeneration_required(uuid, date, date)
  to service_role;

alter function public.service_prepare_pay_stub(uuid)
  rename to service_prepare_pay_stub_without_time_source_revision;

revoke execute on function public.service_prepare_pay_stub_without_time_source_revision(uuid)
  from public, anon, authenticated;
grant execute on function public.service_prepare_pay_stub_without_time_source_revision(uuid)
  to service_role;

create function public.service_prepare_pay_stub(
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_row public.pay_stub_generation_requests;
  period_row public.payout_periods;
  result jsonb;
  current_source_revision bigint;
  updated_payload jsonb;
begin
  if current_user not in ('postgres', 'service_role')
    and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Service role required';
  end if;

  select request.* into request_row
  from public.pay_stub_generation_requests request
  where request.id = p_request_id;

  if request_row.id is null then
    raise exception 'Pay Stub request not found';
  end if;

  select period.* into period_row
  from public.payout_periods period
  where period.id = request_row.payout_period_id;

  if period_row.id is null or period_row.status = 'voided' then
    raise exception 'Monthly pay period not found';
  end if;

  perform pg_advisory_xact_lock(
    private.operator_pay_time_source_lock_key(
      request_row.operator_profile_id,
      extract(year from period_row.period_end_date)::integer
    )
  );

  select period.* into period_row
  from public.payout_periods period
  where period.id = request_row.payout_period_id
  for share;

  if period_row.id is null or period_row.status = 'voided' then
    raise exception 'Monthly pay period not found';
  end if;

  result := public.service_prepare_pay_stub_without_time_source_revision(p_request_id);

  if result ->> 'status' <> 'prepared' then
    return result;
  end if;

  current_source_revision := private.operator_pay_time_source_revision(
    request_row.operator_profile_id,
    period_row.period_end_date
  );

  update public.pay_statements statement
  set statement_payload = statement.statement_payload || jsonb_build_object(
    'calculationMeta',
    coalesce(statement.statement_payload -> 'calculationMeta', '{}'::jsonb)
      || jsonb_build_object('paySourceRevision', current_source_revision)
  )
  where statement.id = (result ->> 'statementId')::uuid
    and statement.status = 'draft'
  returning statement.statement_payload into updated_payload;

  if updated_payload is null then
    raise exception 'Prepared Pay Stub not found';
  end if;

  return result || jsonb_build_object('payload', updated_payload);
end;
$$;

revoke execute on function public.service_prepare_pay_stub(uuid)
  from public, anon, authenticated;
grant execute on function public.service_prepare_pay_stub(uuid)
  to service_role;

alter function public.service_complete_pay_stub(uuid, uuid, text)
  rename to service_complete_pay_stub_without_time_source_revision;

revoke execute on function public.service_complete_pay_stub_without_time_source_revision(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.service_complete_pay_stub_without_time_source_revision(uuid, uuid, text)
  to service_role;

create function public.service_complete_pay_stub(
  p_request_id uuid,
  p_pay_statement_id uuid,
  p_storage_path text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_row public.pay_stub_generation_requests;
  period_row public.payout_periods;
  statement_row public.pay_statements;
  statement_source_revision bigint;
  current_source_revision bigint;
begin
  if current_user not in ('postgres', 'service_role')
    and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Service role required';
  end if;

  select request.* into request_row
  from public.pay_stub_generation_requests request
  where request.id = p_request_id
    and request.status = 'processing'
    and request.pay_statement_id = p_pay_statement_id;

  if request_row.id is null then
    raise exception 'Processing Pay Stub request not found';
  end if;

  select period.* into period_row
  from public.payout_periods period
  where period.id = request_row.payout_period_id;

  select statement.* into statement_row
  from public.pay_statements statement
  where statement.id = p_pay_statement_id
    and statement.status = 'draft';

  if statement_row.id is null then
    raise exception 'Prepared Pay Stub not found';
  end if;

  perform pg_advisory_xact_lock(
    private.operator_pay_time_source_lock_key(
      request_row.operator_profile_id,
      extract(year from period_row.period_end_date)::integer
    )
  );

  select period.* into period_row
  from public.payout_periods period
  where period.id = request_row.payout_period_id
  for share;

  if period_row.id is null or period_row.status = 'voided' then
    raise exception 'Monthly pay period not found';
  end if;

  statement_source_revision := nullif(
    statement_row.statement_payload #>> '{calculationMeta,paySourceRevision}',
    ''
  )::bigint;
  current_source_revision := private.operator_pay_time_source_revision(
    request_row.operator_profile_id,
    period_row.period_end_date
  );

  if statement_source_revision is null
    or statement_source_revision <> current_source_revision then
    raise exception 'Pay Stub source changed during generation; retry required';
  end if;

  return public.service_complete_pay_stub_without_time_source_revision(
    p_request_id,
    p_pay_statement_id,
    p_storage_path
  );
end;
$$;

revoke execute on function public.service_complete_pay_stub(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.service_complete_pay_stub(uuid, uuid, text)
  to service_role;

comment on column public.time_entry_change_events.source_revision is
  'Monotonic committed-source watermark used with the profile/year advisory lock to prove Pay Stub time freshness.';
comment on function private.operator_pay_time_source_revision(uuid, date) is
  'Latest audited time-source revision affecting the Technician calendar year through the requested statement period.';
comment on function private.operator_pay_stub_regeneration_required(uuid, date, date) is
  'Returns true when the latest issued Pay Stub lacks the current cumulative time-source revision, including earlier-period changes that affect YTD.';
comment on function public.service_prepare_pay_stub(uuid) is
  'Service-only serialized Pay Stub preparation that records the cumulative audited time-source revision used by the statement.';
comment on function public.service_complete_pay_stub(uuid, uuid, text) is
  'Service-only Pay Stub publication that rechecks the serialized time-source revision and refuses to publish a stale draft.';
