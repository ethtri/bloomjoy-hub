-- Timekeeping V1 manager review
-- Adds machine-scoped review state without changing payout calculation or payment behavior.

alter table public.time_entries
  add column if not exists manager_review_status text not null default 'pending',
  add column if not exists manager_review_reason text,
  add column if not exists manager_reviewed_at timestamptz,
  add column if not exists manager_reviewed_by uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'time_entries_manager_review_status_check'
      and conrelid = 'public.time_entries'::regclass
  ) then
    alter table public.time_entries
      add constraint time_entries_manager_review_status_check
      check (manager_review_status in ('pending', 'approved', 'needs_correction'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'time_entries_manager_reviewed_by_fkey'
      and conrelid = 'public.time_entries'::regclass
  ) then
    alter table public.time_entries
      add constraint time_entries_manager_reviewed_by_fkey
      foreign key (manager_reviewed_by) references auth.users (id) on delete set null;
  end if;
end;
$$;

create index if not exists time_entries_manager_review_queue_idx
  on public.time_entries (reporting_machine_id, work_date desc, manager_review_status)
  where status = 'submitted' and locked_at is null;

create index if not exists time_entries_manager_reviewed_by_idx
  on public.time_entries (manager_reviewed_by)
  where manager_reviewed_by is not null;

-- Browser writes use the audited worker/manager RPCs. Removing direct table writes
-- prevents callers from supplying manager-review fields outside those paths.
revoke insert, update, delete on table public.time_entries from anon, authenticated;
grant select on table public.time_entries to authenticated;

create table if not exists public.time_entry_review_events (
  id uuid primary key default gen_random_uuid(),
  time_entry_id uuid not null references public.time_entries (id) on delete cascade,
  account_id uuid not null references public.customer_accounts (id) on delete cascade,
  operator_profile_id uuid not null references public.operator_payout_profiles (id) on delete cascade,
  reporting_machine_id uuid not null references public.reporting_machines (id) on delete restrict,
  decision text not null check (decision in ('approved', 'needs_correction')),
  reason text,
  reviewed_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint time_entry_review_events_correction_reason_required check (
    decision = 'approved' or length(trim(coalesce(reason, ''))) > 0
  )
);

create index if not exists time_entry_review_events_entry_created_idx
  on public.time_entry_review_events (time_entry_id, created_at desc);

create index if not exists time_entry_review_events_machine_created_idx
  on public.time_entry_review_events (reporting_machine_id, created_at desc);

create index if not exists time_entry_review_events_account_idx
  on public.time_entry_review_events (account_id);

create index if not exists time_entry_review_events_operator_profile_idx
  on public.time_entry_review_events (operator_profile_id);

create index if not exists time_entry_review_events_reviewed_by_idx
  on public.time_entry_review_events (reviewed_by)
  where reviewed_by is not null;

alter table public.time_entry_review_events enable row level security;

drop policy if exists "time_entry_review_events_select_accessible"
  on public.time_entry_review_events;
create policy "time_entry_review_events_select_accessible"
on public.time_entry_review_events
for select
to authenticated
using (
  public.can_manage_operator_payout_machine_current_user(reporting_machine_id)
  or exists (
    select 1
    from public.operator_payout_profiles profile
    where profile.id = time_entry_review_events.operator_profile_id
      and profile.user_id = (select auth.uid())
  )
);

revoke all on table public.time_entry_review_events from anon, authenticated;
grant select on table public.time_entry_review_events to service_role;

create or replace function public.validate_operator_time_entry_assignment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.manager_review_status := 'pending';
    new.manager_review_reason := null;
    new.manager_reviewed_at := null;
    new.manager_reviewed_by := null;
  end if;

  if new.work_date > current_date then
    raise exception 'Future work dates are not allowed';
  end if;

  if tg_op = 'INSERT'
    or new.operator_profile_id is distinct from old.operator_profile_id
    or new.reporting_machine_id is distinct from old.reporting_machine_id
    or new.work_date is distinct from old.work_date then
    if not exists (
      select 1
      from public.operator_machine_assignments assignment
      where assignment.operator_profile_id = new.operator_profile_id
        and assignment.reporting_machine_id = new.reporting_machine_id
        and assignment.status = 'active'
        and assignment.revoked_at is null
        and assignment.effective_start_date <= new.work_date
        and (
          assignment.effective_end_date is null
          or assignment.effective_end_date >= new.work_date
        )
    ) then
      raise exception 'Time entry machine is not assigned for this work date';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists time_entries_validate_assignment on public.time_entries;
create trigger time_entries_validate_assignment
before insert or update on public.time_entries
for each row execute function public.validate_operator_time_entry_assignment();

create or replace function public.reset_operator_time_entry_manager_review()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  shift_details_changed boolean;
begin
  shift_details_changed :=
    new.operator_profile_id is distinct from old.operator_profile_id
    or new.reporting_machine_id is distinct from old.reporting_machine_id
    or new.work_date is distinct from old.work_date
    or new.start_time is distinct from old.start_time
    or new.end_time is distinct from old.end_time
    or new.notes is distinct from old.notes;

  if shift_details_changed then
    new.manager_review_status := 'pending';
    new.manager_review_reason := null;
    new.manager_reviewed_at := null;
    new.manager_reviewed_by := null;
  elsif (
    new.manager_review_status is distinct from old.manager_review_status
    or new.manager_review_reason is distinct from old.manager_review_reason
    or new.manager_reviewed_at is distinct from old.manager_reviewed_at
    or new.manager_reviewed_by is distinct from old.manager_reviewed_by
  ) and coalesce(current_setting('app.time_entry_review_rpc', true), '') <> 'true' then
    raise exception 'Manager review fields can only be changed through the review action';
  end if;

  return new;
end;
$$;

drop trigger if exists time_entries_reset_manager_review on public.time_entries;
create trigger time_entries_reset_manager_review
before update on public.time_entries
for each row execute function public.reset_operator_time_entry_manager_review();

create or replace function public.operator_time_entry_payload(
  p_time_entry_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = public, auth
as $$
  select jsonb_build_object(
    'id', entry.id,
    'accountId', entry.account_id,
    'operatorProfileId', entry.operator_profile_id,
    'machineId', entry.reporting_machine_id,
    'machineLabel', machine.machine_label,
    'locationId', entry.reporting_location_id,
    'locationName', location.name,
    'payoutPolicyId', entry.payout_policy_id,
    'payoutPeriodId', entry.payout_period_id,
    'workDate', entry.work_date,
    'startTime', to_char(entry.start_time, 'HH24:MI'),
    'endTime', to_char(entry.end_time, 'HH24:MI'),
    'rawDurationMinutes', entry.raw_duration_minutes,
    'roundedPaidMinutes', entry.rounded_paid_minutes,
    'notes', entry.notes,
    'status', entry.status,
    'managerReviewStatus', entry.manager_review_status,
    'managerReviewReason', entry.manager_review_reason,
    'managerReviewedAt', entry.manager_reviewed_at,
    'lockedAt', entry.locked_at,
    'createdAt', entry.created_at,
    'updatedAt', entry.updated_at
  )
  from public.time_entries entry
  join public.reporting_machines machine on machine.id = entry.reporting_machine_id
  join public.reporting_locations location on location.id = entry.reporting_location_id
  join public.operator_payout_profiles profile on profile.id = entry.operator_profile_id
  where entry.id = p_time_entry_id
    and (
      profile.user_id = (select auth.uid())
      or public.can_access_operator_payout_profile((select auth.uid()), profile.id)
    );
$$;

create or replace function public.get_my_time_review_context(
  p_work_date date default current_date
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  actor_user_id uuid;
  target_work_date date;
  period_start date;
  period_end date;
  result jsonb;
begin
  actor_user_id := auth.uid();
  target_work_date := coalesce(p_work_date, current_date);
  period_start := date_trunc('month', target_work_date)::date;
  period_end := (date_trunc('month', target_work_date) + interval '1 month - 1 day')::date;

  if actor_user_id is null then
    raise exception 'Authentication required';
  end if;

  with manageable_machines as materialized (
    select
      machine.id,
      machine.machine_label,
      location.id as location_id,
      location.name as location_name
    from public.reporting_machines machine
    join public.reporting_locations location on location.id = machine.location_id
    where public.can_manage_operator_payout_machine(actor_user_id, machine.id)
  )
  select jsonb_build_object(
    'workDate', target_work_date,
    'periodStartDate', period_start,
    'periodEndDate', period_end,
    'hasAccess', exists (select 1 from manageable_machines),
    'machines', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'machineId', machine.id,
          'machineLabel', machine.machine_label,
          'locationId', machine.location_id,
          'locationName', machine.location_name
        )
        order by machine.location_name, machine.machine_label
      )
      from manageable_machines machine
    ), '[]'::jsonb),
    'entries', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', entry.id,
          'accountId', entry.account_id,
          'accountName', account.name,
          'operatorProfileId', entry.operator_profile_id,
          'operatorName', profile.display_name,
          'machineId', entry.reporting_machine_id,
          'machineLabel', machine.machine_label,
          'locationId', entry.reporting_location_id,
          'locationName', machine.location_name,
          'payoutPolicyId', entry.payout_policy_id,
          'payoutPeriodId', entry.payout_period_id,
          'workDate', entry.work_date,
          'startTime', to_char(entry.start_time, 'HH24:MI'),
          'endTime', to_char(entry.end_time, 'HH24:MI'),
          'rawDurationMinutes', entry.raw_duration_minutes,
          'roundedPaidMinutes', entry.rounded_paid_minutes,
          'notes', entry.notes,
          'status', entry.status,
          'managerReviewStatus', entry.manager_review_status,
          'managerReviewReason', entry.manager_review_reason,
          'managerReviewedAt', entry.manager_reviewed_at,
          'lockedAt', entry.locked_at,
          'createdAt', entry.created_at,
          'updatedAt', entry.updated_at
        )
        order by
          case entry.manager_review_status
            when 'needs_correction' then 0
            when 'pending' then 1
            else 2
          end,
          entry.work_date desc,
          entry.start_time desc,
          profile.display_name
      )
      from public.time_entries entry
      join manageable_machines machine on machine.id = entry.reporting_machine_id
      join public.operator_payout_profiles profile on profile.id = entry.operator_profile_id
      join public.customer_accounts account on account.id = entry.account_id
      where entry.work_date between period_start and period_end
        and entry.status in ('submitted', 'locked', 'included_in_payout', 'paid')
    ), '[]'::jsonb)
  )
  into result;

  return coalesce(
    result,
    jsonb_build_object(
      'workDate', target_work_date,
      'periodStartDate', period_start,
      'periodEndDate', period_end,
      'hasAccess', false,
      'machines', '[]'::jsonb,
      'entries', '[]'::jsonb
    )
  );
end;
$$;

create or replace function public.review_operator_time_entry(
  p_time_entry_id uuid,
  p_decision text,
  p_reason text default null,
  p_work_date date default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  actor_user_id uuid;
  normalized_decision text;
  normalized_reason text;
  before_row public.time_entries;
  after_row public.time_entries;
  profile_row public.operator_payout_profiles;
begin
  actor_user_id := auth.uid();
  normalized_decision := lower(trim(coalesce(p_decision, '')));
  normalized_reason := nullif(trim(coalesce(p_reason, '')), '');

  if actor_user_id is null then
    raise exception 'Authentication required';
  end if;

  if normalized_decision not in ('approved', 'needs_correction') then
    raise exception 'Review decision must be approved or needs_correction';
  end if;

  if normalized_decision = 'needs_correction' and normalized_reason is null then
    raise exception 'A correction reason is required';
  end if;

  select *
  into before_row
  from public.time_entries entry
  where entry.id = p_time_entry_id
  for update;

  if before_row.id is null then
    raise exception 'Time entry not found';
  end if;

  if before_row.locked_at is not null or before_row.status <> 'submitted' then
    raise exception 'Only unlocked submitted time can be reviewed';
  end if;

  if not public.can_manage_operator_payout_machine(actor_user_id, before_row.reporting_machine_id) then
    raise exception 'Machine manager access required';
  end if;

  select *
  into profile_row
  from public.operator_payout_profiles profile
  where profile.id = before_row.operator_profile_id;

  perform set_config('app.time_entry_review_rpc', 'true', true);

  update public.time_entries
  set
    manager_review_status = normalized_decision,
    manager_review_reason = normalized_reason,
    manager_reviewed_at = now(),
    manager_reviewed_by = actor_user_id,
    updated_by = actor_user_id
  where id = before_row.id
  returning * into after_row;

  perform set_config('app.time_entry_review_rpc', 'false', true);

  insert into public.time_entry_review_events (
    time_entry_id,
    account_id,
    operator_profile_id,
    reporting_machine_id,
    decision,
    reason,
    reviewed_by
  )
  values (
    after_row.id,
    after_row.account_id,
    after_row.operator_profile_id,
    after_row.reporting_machine_id,
    normalized_decision,
    normalized_reason,
    actor_user_id
  );

  insert into public.admin_audit_log (
    actor_user_id,
    action,
    entity_type,
    entity_id,
    target_user_id,
    before,
    after,
    meta
  )
  values (
    actor_user_id,
    case normalized_decision
      when 'approved' then 'operator_time_entry.manager_approved'
      else 'operator_time_entry.correction_requested'
    end,
    'time_entry',
    after_row.id::text,
    profile_row.user_id,
    to_jsonb(before_row),
    to_jsonb(after_row),
    jsonb_build_object(
      'reason', normalized_reason,
      'machine_manager_review', true,
      'payment_behavior_changed', false
    )
  );

  return jsonb_build_object(
    'timeEntry', public.operator_time_entry_payload(after_row.id),
    'context', public.get_my_time_review_context(coalesce(p_work_date, after_row.work_date))
  );
end;
$$;

comment on table public.time_entry_review_events is
  'Immutable machine-manager review history for operator time entries. Review decisions do not initiate or alter payments.';
comment on function public.get_my_time_review_context(date) is
  'Monthly time-review queue limited to reporting machines the current user can manage.';
comment on function public.review_operator_time_entry(uuid, text, text, date) is
  'Machine-scoped approve or request-correction action for unlocked submitted time. Does not change payout calculation or payment state.';
comment on function public.validate_operator_time_entry_assignment() is
  'Fail-closed trigger guard forcing new time to pending review and requiring a non-future work date plus an active, effective operator-to-machine assignment.';
comment on function public.reset_operator_time_entry_manager_review() is
  'Resets materially edited shifts to pending review and rejects direct review-field writes outside the audited manager-review RPC.';

revoke execute on function public.validate_operator_time_entry_assignment()
  from public, anon, authenticated;
revoke execute on function public.reset_operator_time_entry_manager_review()
  from public, anon, authenticated;
revoke execute on function public.operator_time_entry_payload(uuid)
  from public, anon, authenticated;
revoke execute on function public.get_my_time_review_context(date)
  from public, anon;
revoke execute on function public.review_operator_time_entry(uuid, text, text, date)
  from public, anon;

grant execute on function public.validate_operator_time_entry_assignment()
  to service_role;
grant execute on function public.reset_operator_time_entry_manager_review()
  to service_role;
grant execute on function public.operator_time_entry_payload(uuid)
  to service_role;
grant execute on function public.get_my_time_review_context(date)
  to authenticated, service_role;
grant execute on function public.review_operator_time_entry(uuid, text, text, date)
  to authenticated, service_role;

select pg_notify('pgrst', 'reload schema');
