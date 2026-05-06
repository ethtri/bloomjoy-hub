-- Partner report schedule and run-record foundation for scheduled partner delivery.
-- This adds data/RPC scaffolding only: no scheduler trigger, no partner email
-- delivery, no Partner Viewer access, and no admin UI.

create or replace function public.partner_report_schedule_normalize_email(p_email text)
returns text
language sql
immutable
as $$
  select lower(btrim(coalesce(p_email, '')));
$$;

create or replace function public.partner_report_schedule_is_valid_email(p_email text)
returns boolean
language sql
immutable
as $$
  select public.partner_report_schedule_normalize_email(p_email)
    ~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$';
$$;

create table if not exists public.partner_report_schedules (
  id uuid primary key default gen_random_uuid(),
  partnership_id uuid not null references public.reporting_partnerships (id),
  title text not null,
  status text not null default 'paused'
    check (status in ('paused', 'active', 'archived')),
  cadence text not null
    check (cadence in ('weekly', 'monthly')),
  period_grain text not null
    check (period_grain in ('reporting_week', 'calendar_month')),
  timezone text not null default 'America/Los_Angeles',
  send_day_of_week integer check (send_day_of_week between 0 and 6),
  send_day_of_month integer check (send_day_of_month between 1 and 28),
  send_time_local time not null default time '09:00',
  period_delay_days integer not null default 1 check (period_delay_days between 0 and 31),
  sender_profile_key text not null default 'partner_reports',
  reply_to_profile_key text,
  delivery_mode text not null default 'secure_link'
    check (delivery_mode = 'secure_link'),
  configuration_version integer not null default 1 check (configuration_version >= 1),
  configuration_hash text not null default md5('{}'),
  last_validated_configuration_hash text,
  last_validation_run_id uuid,
  last_validated_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  paused_at timestamptz,
  paused_by uuid references auth.users (id) on delete set null,
  pause_reason text,
  archived_at timestamptz,
  archived_by uuid references auth.users (id) on delete set null,
  archive_reason text,
  last_run_at timestamptz,
  last_success_at timestamptz,
  last_status text,
  constraint partner_report_schedules_title_present check (length(btrim(title)) > 0),
  constraint partner_report_schedules_timezone_present check (length(btrim(timezone)) > 0),
  constraint partner_report_schedules_sender_profile_present check (length(btrim(sender_profile_key)) > 0),
  constraint partner_report_schedules_configuration_hash_present check (length(btrim(configuration_hash)) > 0),
  constraint partner_report_schedules_cadence_grain_agree check (
    (cadence = 'weekly' and period_grain = 'reporting_week')
    or (cadence = 'monthly' and period_grain = 'calendar_month')
  ),
  constraint partner_report_schedules_timing_for_cadence check (
    (
      cadence = 'weekly'
      and send_day_of_week is not null
      and send_day_of_month is null
    )
    or (
      cadence = 'monthly'
      and send_day_of_week is null
      and send_day_of_month is not null
    )
  )
);

create index if not exists partner_report_schedules_partnership_status_idx
  on public.partner_report_schedules (partnership_id, status, cadence);

create index if not exists partner_report_schedules_active_weekly_due_idx
  on public.partner_report_schedules (status, cadence, send_day_of_week, send_time_local)
  where status = 'active' and cadence = 'weekly';

create index if not exists partner_report_schedules_active_monthly_due_idx
  on public.partner_report_schedules (status, cadence, send_day_of_month, send_time_local)
  where status = 'active' and cadence = 'monthly';

create index if not exists partner_report_schedules_last_run_idx
  on public.partner_report_schedules (last_run_at desc);

drop trigger if exists partner_report_schedules_set_updated_at on public.partner_report_schedules;
create trigger partner_report_schedules_set_updated_at
before update on public.partner_report_schedules
for each row execute function public.set_updated_at();

create table if not exists public.partner_report_schedule_recipients (
  id uuid primary key default gen_random_uuid(),
  schedule_id uuid not null references public.partner_report_schedules (id) on delete cascade,
  email text not null,
  display_name text,
  recipient_role text,
  status text not null default 'active'
    check (status in ('active', 'removed')),
  added_by uuid references auth.users (id) on delete set null,
  added_at timestamptz not null default now(),
  removed_by uuid references auth.users (id) on delete set null,
  removed_at timestamptz,
  remove_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint partner_report_schedule_recipients_email_present check (length(btrim(email)) > 0),
  constraint partner_report_schedule_recipients_email_normalized check (
    email = public.partner_report_schedule_normalize_email(email)
  ),
  constraint partner_report_schedule_recipients_email_format check (
    public.partner_report_schedule_is_valid_email(email)
  )
);

create unique index if not exists partner_report_schedule_recipients_active_email_idx
  on public.partner_report_schedule_recipients (schedule_id, email)
  where status = 'active';

create index if not exists partner_report_schedule_recipients_schedule_status_idx
  on public.partner_report_schedule_recipients (schedule_id, status, email);

create index if not exists partner_report_schedule_recipients_email_idx
  on public.partner_report_schedule_recipients (email);

drop trigger if exists partner_report_schedule_recipients_set_updated_at on public.partner_report_schedule_recipients;
create trigger partner_report_schedule_recipients_set_updated_at
before update on public.partner_report_schedule_recipients
for each row execute function public.set_updated_at();

create table if not exists public.partner_report_schedule_runs (
  id uuid primary key default gen_random_uuid(),
  schedule_id uuid not null references public.partner_report_schedules (id) on delete cascade,
  partnership_id uuid not null references public.reporting_partnerships (id),
  period_grain text not null
    check (period_grain in ('reporting_week', 'calendar_month')),
  period_start_date date not null,
  period_end_date date not null,
  period_label text not null,
  trigger_type text not null
    check (trigger_type in ('scheduled', 'dry_run', 'test_send', 'manual_retry', 'manual_send')),
  idempotency_key text not null,
  configuration_version integer not null check (configuration_version >= 1),
  configuration_hash text not null,
  status text not null default 'queued'
    check (
      status in (
        'queued',
        'checking_warnings',
        'blocked',
        'generating',
        'artifact_ready',
        'sending',
        'sent',
        'failed',
        'cancelled',
        'validated'
      )
    ),
  warning_gate_status text not null default 'not_checked'
    check (warning_gate_status in ('passed', 'blocked', 'not_checked')),
  warnings_json jsonb not null default '[]'::jsonb,
  snapshot_id uuid references public.partner_report_snapshots (id) on delete set null,
  artifact_storage_path text,
  artifact_format text check (artifact_format is null or artifact_format = 'pdf'),
  artifact_generated_at timestamptz,
  recipient_snapshot_json jsonb not null default '[]'::jsonb,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  claimed_at timestamptz,
  claimed_by text,
  lease_expires_at timestamptz,
  retry_count integer not null default 0 check (retry_count >= 0),
  retry_after timestamptz,
  error_code text,
  error_message text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  parent_run_id uuid references public.partner_report_schedule_runs (id) on delete set null,
  constraint partner_report_schedule_runs_period_window check (period_end_date >= period_start_date),
  constraint partner_report_schedule_runs_period_label_present check (length(btrim(period_label)) > 0),
  constraint partner_report_schedule_runs_idempotency_key_present check (length(btrim(idempotency_key)) > 0),
  constraint partner_report_schedule_runs_configuration_hash_present check (length(btrim(configuration_hash)) > 0),
  constraint partner_report_schedule_runs_warnings_is_array check (jsonb_typeof(warnings_json) = 'array'),
  constraint partner_report_schedule_runs_recipients_is_array check (jsonb_typeof(recipient_snapshot_json) = 'array'),
  constraint partner_report_schedule_runs_lease_consistent check (
    lease_expires_at is null or claimed_at is not null
  )
);

create unique index if not exists partner_report_schedule_runs_idempotency_key_idx
  on public.partner_report_schedule_runs (idempotency_key);

create index if not exists partner_report_schedule_runs_schedule_created_idx
  on public.partner_report_schedule_runs (schedule_id, created_at desc);

create index if not exists partner_report_schedule_runs_partnership_period_idx
  on public.partner_report_schedule_runs (
    partnership_id,
    period_grain,
    period_start_date,
    period_end_date
  );

create index if not exists partner_report_schedule_runs_worker_claim_idx
  on public.partner_report_schedule_runs (status, lease_expires_at, created_at)
  where status in ('queued', 'checking_warnings', 'generating', 'artifact_ready', 'sending');

create index if not exists partner_report_schedule_runs_snapshot_idx
  on public.partner_report_schedule_runs (snapshot_id)
  where snapshot_id is not null;

create index if not exists partner_report_schedule_runs_parent_idx
  on public.partner_report_schedule_runs (parent_run_id)
  where parent_run_id is not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'partner_report_schedules_last_validation_run_id_fkey'
      and conrelid = 'public.partner_report_schedules'::regclass
  ) then
    alter table public.partner_report_schedules
      add constraint partner_report_schedules_last_validation_run_id_fkey
      foreign key (last_validation_run_id)
      references public.partner_report_schedule_runs (id)
      on delete set null;
  end if;
end $$;

create table if not exists public.partner_report_email_attempts (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.partner_report_schedule_runs (id) on delete cascade,
  attempt_number integer not null check (attempt_number >= 1),
  status text not null default 'pending'
    check (status in ('pending', 'sent', 'failed')),
  recipient_emails text[] not null default array[]::text[],
  subject text,
  template_version text,
  signed_url_expires_at timestamptz,
  provider text not null default 'resend'
    check (provider = 'resend'),
  provider_message_id text,
  error_code text,
  error_message text,
  triggered_by uuid references auth.users (id) on delete set null,
  triggered_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint partner_report_email_attempts_unique_attempt unique (run_id, attempt_number)
);

create index if not exists partner_report_email_attempts_run_status_idx
  on public.partner_report_email_attempts (run_id, status, attempt_number);

create index if not exists partner_report_email_attempts_provider_message_idx
  on public.partner_report_email_attempts (provider, provider_message_id)
  where provider_message_id is not null;

alter table public.partner_report_schedules enable row level security;
alter table public.partner_report_schedule_recipients enable row level security;
alter table public.partner_report_schedule_runs enable row level security;
alter table public.partner_report_email_attempts enable row level security;

drop policy if exists "partner_report_schedules_select_super_admin" on public.partner_report_schedules;
create policy "partner_report_schedules_select_super_admin"
on public.partner_report_schedules
for select
using (public.is_super_admin((select auth.uid())));

drop policy if exists "partner_report_schedule_recipients_select_super_admin" on public.partner_report_schedule_recipients;
create policy "partner_report_schedule_recipients_select_super_admin"
on public.partner_report_schedule_recipients
for select
using (public.is_super_admin((select auth.uid())));

drop policy if exists "partner_report_schedule_runs_select_super_admin" on public.partner_report_schedule_runs;
create policy "partner_report_schedule_runs_select_super_admin"
on public.partner_report_schedule_runs
for select
using (public.is_super_admin((select auth.uid())));

drop policy if exists "partner_report_email_attempts_select_super_admin" on public.partner_report_email_attempts;
create policy "partner_report_email_attempts_select_super_admin"
on public.partner_report_email_attempts
for select
using (public.is_super_admin((select auth.uid())));

create or replace function public.partner_report_schedule_recipient_snapshot(p_schedule_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'email', recipient.email,
        'displayName', recipient.display_name,
        'recipientRole', recipient.recipient_role
      )
      order by recipient.email
    ),
    '[]'::jsonb
  )
  from public.partner_report_schedule_recipients recipient
  where recipient.schedule_id = p_schedule_id
    and recipient.status = 'active';
$$;

create or replace function public.partner_report_schedule_active_recipient_emails(p_schedule_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(recipient.email order by recipient.email), '[]'::jsonb)
  from public.partner_report_schedule_recipients recipient
  where recipient.schedule_id = p_schedule_id
    and recipient.status = 'active';
$$;

create or replace function public.partner_report_schedule_configuration_payload(p_schedule_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'partnershipId', schedule.partnership_id,
    'cadence', schedule.cadence,
    'periodGrain', schedule.period_grain,
    'timezone', schedule.timezone,
    'sendDayOfWeek', schedule.send_day_of_week,
    'sendDayOfMonth', schedule.send_day_of_month,
    'sendTimeLocal', to_char(schedule.send_time_local, 'HH24:MI:SS'),
    'periodDelayDays', schedule.period_delay_days,
    'senderProfileKey', schedule.sender_profile_key,
    'replyToProfileKey', schedule.reply_to_profile_key,
    'deliveryMode', schedule.delivery_mode,
    'activeRecipientEmails', public.partner_report_schedule_active_recipient_emails(schedule.id)
  )
  from public.partner_report_schedules schedule
  where schedule.id = p_schedule_id;
$$;

create or replace function public.partner_report_schedule_configuration_hash(p_schedule_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select md5(coalesce(public.partner_report_schedule_configuration_payload(p_schedule_id)::text, '{}'));
$$;

create or replace function public.partner_report_schedule_refresh_configuration(
  p_schedule_id uuid,
  p_increment_version boolean default true
)
returns public.partner_report_schedules
language plpgsql
security definer
set search_path = public
as $$
declare
  before_hash text;
  new_hash text;
  schedule_row public.partner_report_schedules;
begin
  select *
  into schedule_row
  from public.partner_report_schedules schedule
  where schedule.id = p_schedule_id
  for update;

  if schedule_row.id is null then
    raise exception 'Partner report schedule not found';
  end if;

  before_hash := schedule_row.configuration_hash;
  new_hash := public.partner_report_schedule_configuration_hash(p_schedule_id);

  update public.partner_report_schedules
  set
    configuration_hash = new_hash,
    configuration_version = case
      when p_increment_version and before_hash is distinct from new_hash
        then configuration_version + 1
      else configuration_version
    end,
    updated_at = now()
  where id = p_schedule_id
  returning * into schedule_row;

  return schedule_row;
end;
$$;

create or replace function public.partner_report_schedule_assert_can_activate(p_schedule_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  schedule_row public.partner_report_schedules;
  partnership_status text;
  active_recipient_count integer;
  validation_exists boolean;
begin
  select schedule.*
  into schedule_row
  from public.partner_report_schedules schedule
  where schedule.id = p_schedule_id;

  if schedule_row.id is null then
    raise exception 'Partner report schedule not found';
  end if;

  if schedule_row.status = 'archived' then
    raise exception 'Archived schedules cannot be activated';
  end if;

  select partnership.status
  into partnership_status
  from public.reporting_partnerships partnership
  where partnership.id = schedule_row.partnership_id;

  if partnership_status is distinct from 'active' then
    raise exception 'Active schedules require an active partnership';
  end if;

  select count(*)::integer
  into active_recipient_count
  from public.partner_report_schedule_recipients recipient
  where recipient.schedule_id = p_schedule_id
    and recipient.status = 'active';

  if active_recipient_count < 1 then
    raise exception 'Active schedules require at least one active recipient';
  end if;

  select exists (
    select 1
    from public.partner_report_schedule_runs run
    where run.id = schedule_row.last_validation_run_id
      and run.schedule_id = schedule_row.id
      and run.configuration_hash = schedule_row.configuration_hash
      and run.trigger_type in ('dry_run', 'test_send')
      and run.status in ('validated', 'sent')
      and run.warning_gate_status = 'passed'
  )
  into validation_exists;

  if schedule_row.last_validated_configuration_hash is distinct from schedule_row.configuration_hash
     or not validation_exists then
    raise exception 'Active schedules require a successful dry run or test send for the current configuration';
  end if;
end;
$$;

create or replace function public.admin_create_partner_report_schedule(
  p_partnership_id uuid,
  p_title text default null,
  p_cadence text default 'weekly',
  p_timezone text default null,
  p_send_day_of_week integer default null,
  p_send_day_of_month integer default null,
  p_send_time_local time default time '09:00',
  p_period_delay_days integer default null,
  p_sender_profile_key text default 'partner_reports',
  p_reply_to_profile_key text default null,
  p_delivery_mode text default 'secure_link',
  p_recipients jsonb default '[]'::jsonb,
  p_reason text default null
)
returns public.partner_report_schedules
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  partnership_row public.reporting_partnerships;
  schedule_row public.partner_report_schedules;
  normalized_reason text;
  normalized_title text;
  normalized_cadence text;
  normalized_period_grain text;
  normalized_timezone text;
  normalized_sender_profile text;
  normalized_reply_profile text;
  normalized_delivery_mode text;
  normalized_day_of_week integer;
  normalized_day_of_month integer;
  normalized_delay_days integer;
  recipient_value jsonb;
  recipient_email text;
  recipient_display_name text;
  recipient_role text;
  inserted_recipient_count integer := 0;
begin
  if not public.is_super_admin(auth.uid()) then
    raise exception 'Admin access required';
  end if;

  normalized_reason := public.reporting_admin_assert_reason(p_reason);

  if p_partnership_id is null then
    raise exception 'Partnership id is required';
  end if;

  select *
  into partnership_row
  from public.reporting_partnerships partnership
  where partnership.id = p_partnership_id;

  if partnership_row.id is null then
    raise exception 'Partnership not found';
  end if;

  normalized_cadence := lower(coalesce(nullif(btrim(p_cadence), ''), 'weekly'));
  if normalized_cadence not in ('weekly', 'monthly') then
    raise exception 'Cadence must be weekly or monthly';
  end if;

  normalized_period_grain := case
    when normalized_cadence = 'weekly' then 'reporting_week'
    else 'calendar_month'
  end;

  normalized_timezone := coalesce(
    nullif(btrim(p_timezone), ''),
    nullif(btrim(partnership_row.timezone), ''),
    'America/Los_Angeles'
  );
  normalized_sender_profile := lower(coalesce(nullif(btrim(p_sender_profile_key), ''), 'partner_reports'));
  normalized_reply_profile := nullif(lower(btrim(coalesce(p_reply_to_profile_key, ''))), '');
  normalized_delivery_mode := lower(coalesce(nullif(btrim(p_delivery_mode), ''), 'secure_link'));
  normalized_delay_days := coalesce(p_period_delay_days, 1);
  normalized_title := coalesce(
    nullif(btrim(p_title), ''),
    partnership_row.name || ' ' || normalized_cadence || ' partner report'
  );

  if normalized_delivery_mode <> 'secure_link' then
    raise exception 'Only secure_link delivery mode is enabled for scheduled partner reports';
  end if;

  if normalized_delay_days < 0 or normalized_delay_days > 31 then
    raise exception 'Period delay days must be between 0 and 31';
  end if;

  if normalized_cadence = 'weekly' then
    normalized_day_of_week := coalesce(p_send_day_of_week, 1);
    normalized_day_of_month := null;
    if normalized_day_of_week < 0 or normalized_day_of_week > 6 then
      raise exception 'Weekly send day must be 0-6';
    end if;
  else
    normalized_day_of_week := null;
    normalized_day_of_month := coalesce(p_send_day_of_month, 1);
    if normalized_day_of_month < 1 or normalized_day_of_month > 28 then
      raise exception 'Monthly send day must be 1-28';
    end if;
  end if;

  if p_recipients is not null and jsonb_typeof(p_recipients) <> 'array' then
    raise exception 'Recipients must be a JSON array';
  end if;

  insert into public.partner_report_schedules (
    partnership_id,
    title,
    status,
    cadence,
    period_grain,
    timezone,
    send_day_of_week,
    send_day_of_month,
    send_time_local,
    period_delay_days,
    sender_profile_key,
    reply_to_profile_key,
    delivery_mode,
    created_by,
    paused_at,
    paused_by,
    pause_reason
  )
  values (
    partnership_row.id,
    normalized_title,
    'paused',
    normalized_cadence,
    normalized_period_grain,
    normalized_timezone,
    normalized_day_of_week,
    normalized_day_of_month,
    coalesce(p_send_time_local, time '09:00'),
    normalized_delay_days,
    normalized_sender_profile,
    normalized_reply_profile,
    normalized_delivery_mode,
    auth.uid(),
    now(),
    auth.uid(),
    'New scheduled partner reports start paused until validation passes.'
  )
  returning * into schedule_row;

  for recipient_value in
    select value
    from jsonb_array_elements(coalesce(p_recipients, '[]'::jsonb)) as recipient(value)
  loop
    if jsonb_typeof(recipient_value) = 'string' then
      recipient_email := public.partner_report_schedule_normalize_email(recipient_value #>> '{}');
      recipient_display_name := null;
      recipient_role := null;
    else
      recipient_email := public.partner_report_schedule_normalize_email(recipient_value ->> 'email');
      recipient_display_name := nullif(btrim(coalesce(recipient_value ->> 'displayName', recipient_value ->> 'display_name', '')), '');
      recipient_role := nullif(btrim(coalesce(recipient_value ->> 'recipientRole', recipient_value ->> 'recipient_role', recipient_value ->> 'role', '')), '');
    end if;

    if recipient_email = '' then
      continue;
    end if;

    if not public.partner_report_schedule_is_valid_email(recipient_email) then
      raise exception 'Invalid recipient email: %', recipient_email;
    end if;

    insert into public.partner_report_schedule_recipients (
      schedule_id,
      email,
      display_name,
      recipient_role,
      status,
      added_by
    )
    values (
      schedule_row.id,
      recipient_email,
      recipient_display_name,
      recipient_role,
      'active',
      auth.uid()
    )
    on conflict (schedule_id, email) where status = 'active'
    do update
    set
      display_name = excluded.display_name,
      recipient_role = excluded.recipient_role,
      updated_at = now();

    inserted_recipient_count := inserted_recipient_count + 1;
  end loop;

  schedule_row := public.partner_report_schedule_refresh_configuration(schedule_row.id, false);

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
    auth.uid(),
    'partner_report_schedule.created',
    'partner_report_schedule',
    schedule_row.id::text,
    null,
    '{}'::jsonb,
    to_jsonb(schedule_row),
    jsonb_build_object(
      'reason', normalized_reason,
      'recipient_count', inserted_recipient_count,
      'configuration_hash', schedule_row.configuration_hash
    )
  );

  return schedule_row;
end;
$$;

create or replace function public.admin_update_partner_report_schedule(
  p_schedule_id uuid,
  p_title text default null,
  p_cadence text default null,
  p_timezone text default null,
  p_send_day_of_week integer default null,
  p_send_day_of_month integer default null,
  p_send_time_local time default null,
  p_period_delay_days integer default null,
  p_sender_profile_key text default null,
  p_reply_to_profile_key text default null,
  p_delivery_mode text default null,
  p_reason text default null
)
returns public.partner_report_schedules
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  before_row public.partner_report_schedules;
  after_row public.partner_report_schedules;
  normalized_reason text;
  normalized_title text;
  normalized_cadence text;
  normalized_period_grain text;
  normalized_timezone text;
  normalized_sender_profile text;
  normalized_reply_profile text;
  normalized_delivery_mode text;
  normalized_day_of_week integer;
  normalized_day_of_month integer;
  normalized_delay_days integer;
  configuration_changed boolean;
begin
  if not public.is_super_admin(auth.uid()) then
    raise exception 'Admin access required';
  end if;

  normalized_reason := public.reporting_admin_assert_reason(p_reason);

  select *
  into before_row
  from public.partner_report_schedules schedule
  where schedule.id = p_schedule_id
  for update;

  if before_row.id is null then
    raise exception 'Partner report schedule not found';
  end if;

  if before_row.status = 'archived' then
    raise exception 'Archived schedules cannot be edited';
  end if;

  normalized_title := coalesce(nullif(btrim(p_title), ''), before_row.title);
  normalized_cadence := lower(coalesce(nullif(btrim(p_cadence), ''), before_row.cadence));
  if normalized_cadence not in ('weekly', 'monthly') then
    raise exception 'Cadence must be weekly or monthly';
  end if;

  normalized_period_grain := case
    when normalized_cadence = 'weekly' then 'reporting_week'
    else 'calendar_month'
  end;
  normalized_timezone := coalesce(nullif(btrim(p_timezone), ''), before_row.timezone);
  normalized_sender_profile := lower(coalesce(nullif(btrim(p_sender_profile_key), ''), before_row.sender_profile_key));
  normalized_reply_profile := case
    when p_reply_to_profile_key is null then before_row.reply_to_profile_key
    else nullif(lower(btrim(p_reply_to_profile_key)), '')
  end;
  normalized_delivery_mode := lower(coalesce(nullif(btrim(p_delivery_mode), ''), before_row.delivery_mode));
  normalized_delay_days := coalesce(p_period_delay_days, before_row.period_delay_days);

  if normalized_delivery_mode <> 'secure_link' then
    raise exception 'Only secure_link delivery mode is enabled for scheduled partner reports';
  end if;

  if normalized_delay_days < 0 or normalized_delay_days > 31 then
    raise exception 'Period delay days must be between 0 and 31';
  end if;

  if normalized_cadence = 'weekly' then
    normalized_day_of_week := coalesce(p_send_day_of_week, before_row.send_day_of_week, 1);
    normalized_day_of_month := null;
    if normalized_day_of_week < 0 or normalized_day_of_week > 6 then
      raise exception 'Weekly send day must be 0-6';
    end if;
  else
    normalized_day_of_week := null;
    normalized_day_of_month := coalesce(p_send_day_of_month, before_row.send_day_of_month, 1);
    if normalized_day_of_month < 1 or normalized_day_of_month > 28 then
      raise exception 'Monthly send day must be 1-28';
    end if;
  end if;

  update public.partner_report_schedules
  set
    title = normalized_title,
    cadence = normalized_cadence,
    period_grain = normalized_period_grain,
    timezone = normalized_timezone,
    send_day_of_week = normalized_day_of_week,
    send_day_of_month = normalized_day_of_month,
    send_time_local = coalesce(p_send_time_local, before_row.send_time_local),
    period_delay_days = normalized_delay_days,
    sender_profile_key = normalized_sender_profile,
    reply_to_profile_key = normalized_reply_profile,
    delivery_mode = normalized_delivery_mode,
    updated_at = now()
  where id = before_row.id
  returning * into after_row;

  after_row := public.partner_report_schedule_refresh_configuration(after_row.id, true);
  configuration_changed := before_row.configuration_hash is distinct from after_row.configuration_hash;

  if configuration_changed and before_row.status = 'active' then
    update public.partner_report_schedules
    set
      status = 'paused',
      paused_at = now(),
      paused_by = auth.uid(),
      pause_reason = 'Paused automatically because schedule configuration changed.',
      updated_at = now()
    where id = after_row.id
    returning * into after_row;
  end if;

  if after_row.status = 'active' then
    perform public.partner_report_schedule_assert_can_activate(after_row.id);
  end if;

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
    auth.uid(),
    'partner_report_schedule.updated',
    'partner_report_schedule',
    after_row.id::text,
    null,
    to_jsonb(before_row),
    to_jsonb(after_row),
    jsonb_build_object(
      'reason', normalized_reason,
      'configuration_changed', configuration_changed,
      'auto_paused', configuration_changed and before_row.status = 'active'
    )
  );

  return after_row;
end;
$$;

create or replace function public.admin_pause_partner_report_schedule(
  p_schedule_id uuid,
  p_reason text default null
)
returns public.partner_report_schedules
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  before_row public.partner_report_schedules;
  after_row public.partner_report_schedules;
  normalized_reason text;
begin
  if not public.is_super_admin(auth.uid()) then
    raise exception 'Admin access required';
  end if;

  normalized_reason := public.reporting_admin_assert_reason(p_reason);

  select *
  into before_row
  from public.partner_report_schedules schedule
  where schedule.id = p_schedule_id
  for update;

  if before_row.id is null then
    raise exception 'Partner report schedule not found';
  end if;

  if before_row.status = 'archived' then
    raise exception 'Archived schedules cannot be paused';
  end if;

  update public.partner_report_schedules
  set
    status = 'paused',
    paused_at = now(),
    paused_by = auth.uid(),
    pause_reason = normalized_reason,
    updated_at = now()
  where id = before_row.id
  returning * into after_row;

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
    auth.uid(),
    'partner_report_schedule.paused',
    'partner_report_schedule',
    after_row.id::text,
    null,
    to_jsonb(before_row),
    to_jsonb(after_row),
    jsonb_build_object('reason', normalized_reason)
  );

  return after_row;
end;
$$;

create or replace function public.admin_resume_partner_report_schedule(
  p_schedule_id uuid,
  p_reason text default null
)
returns public.partner_report_schedules
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  before_row public.partner_report_schedules;
  after_row public.partner_report_schedules;
  normalized_reason text;
begin
  if not public.is_super_admin(auth.uid()) then
    raise exception 'Admin access required';
  end if;

  normalized_reason := public.reporting_admin_assert_reason(p_reason);

  select *
  into before_row
  from public.partner_report_schedules schedule
  where schedule.id = p_schedule_id
  for update;

  if before_row.id is null then
    raise exception 'Partner report schedule not found';
  end if;

  if before_row.status = 'archived' then
    raise exception 'Archived schedules cannot be resumed';
  end if;

  after_row := public.partner_report_schedule_refresh_configuration(before_row.id, false);
  perform public.partner_report_schedule_assert_can_activate(after_row.id);

  update public.partner_report_schedules
  set
    status = 'active',
    updated_at = now()
  where id = before_row.id
  returning * into after_row;

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
    auth.uid(),
    'partner_report_schedule.resumed',
    'partner_report_schedule',
    after_row.id::text,
    null,
    to_jsonb(before_row),
    to_jsonb(after_row),
    jsonb_build_object('reason', normalized_reason)
  );

  return after_row;
end;
$$;

create or replace function public.admin_archive_partner_report_schedule(
  p_schedule_id uuid,
  p_reason text default null
)
returns public.partner_report_schedules
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  before_row public.partner_report_schedules;
  after_row public.partner_report_schedules;
  normalized_reason text;
begin
  if not public.is_super_admin(auth.uid()) then
    raise exception 'Admin access required';
  end if;

  normalized_reason := public.reporting_admin_assert_reason(p_reason);

  select *
  into before_row
  from public.partner_report_schedules schedule
  where schedule.id = p_schedule_id
  for update;

  if before_row.id is null then
    raise exception 'Partner report schedule not found';
  end if;

  update public.partner_report_schedules
  set
    status = 'archived',
    archived_at = coalesce(archived_at, now()),
    archived_by = coalesce(archived_by, auth.uid()),
    archive_reason = normalized_reason,
    updated_at = now()
  where id = before_row.id
  returning * into after_row;

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
    auth.uid(),
    'partner_report_schedule.archived',
    'partner_report_schedule',
    after_row.id::text,
    null,
    to_jsonb(before_row),
    to_jsonb(after_row),
    jsonb_build_object('reason', normalized_reason)
  );

  return after_row;
end;
$$;

create or replace function public.admin_add_partner_report_schedule_recipient(
  p_schedule_id uuid,
  p_email text,
  p_display_name text default null,
  p_recipient_role text default null,
  p_reason text default null
)
returns public.partner_report_schedule_recipients
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  schedule_before public.partner_report_schedules;
  schedule_after public.partner_report_schedules;
  before_recipient public.partner_report_schedule_recipients;
  after_recipient public.partner_report_schedule_recipients;
  normalized_reason text;
  normalized_email text;
  normalized_display_name text;
  normalized_role text;
  configuration_changed boolean;
  audit_action text;
begin
  if not public.is_super_admin(auth.uid()) then
    raise exception 'Admin access required';
  end if;

  normalized_reason := public.reporting_admin_assert_reason(p_reason);
  normalized_email := public.partner_report_schedule_normalize_email(p_email);
  normalized_display_name := nullif(btrim(coalesce(p_display_name, '')), '');
  normalized_role := nullif(btrim(coalesce(p_recipient_role, '')), '');

  if not public.partner_report_schedule_is_valid_email(normalized_email) then
    raise exception 'Invalid recipient email';
  end if;

  select *
  into schedule_before
  from public.partner_report_schedules schedule
  where schedule.id = p_schedule_id
  for update;

  if schedule_before.id is null then
    raise exception 'Partner report schedule not found';
  end if;

  if schedule_before.status = 'archived' then
    raise exception 'Archived schedules cannot change recipients';
  end if;

  select *
  into before_recipient
  from public.partner_report_schedule_recipients recipient
  where recipient.schedule_id = p_schedule_id
    and recipient.email = normalized_email
    and recipient.status = 'active'
  limit 1
  for update;

  if before_recipient.id is null then
    insert into public.partner_report_schedule_recipients (
      schedule_id,
      email,
      display_name,
      recipient_role,
      status,
      added_by
    )
    values (
      schedule_before.id,
      normalized_email,
      normalized_display_name,
      normalized_role,
      'active',
      auth.uid()
    )
    returning * into after_recipient;
    audit_action := 'partner_report_schedule_recipient.added';
  else
    update public.partner_report_schedule_recipients
    set
      display_name = normalized_display_name,
      recipient_role = normalized_role,
      updated_at = now()
    where id = before_recipient.id
    returning * into after_recipient;
    audit_action := 'partner_report_schedule_recipient.updated';
  end if;

  schedule_after := public.partner_report_schedule_refresh_configuration(schedule_before.id, true);
  configuration_changed := schedule_before.configuration_hash is distinct from schedule_after.configuration_hash;

  if configuration_changed and schedule_before.status = 'active' then
    update public.partner_report_schedules
    set
      status = 'paused',
      paused_at = now(),
      paused_by = auth.uid(),
      pause_reason = 'Paused automatically because active recipients changed.',
      updated_at = now()
    where id = schedule_after.id
    returning * into schedule_after;
  end if;

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
    auth.uid(),
    audit_action,
    'partner_report_schedule_recipient',
    after_recipient.id::text,
    null,
    coalesce(to_jsonb(before_recipient), '{}'::jsonb),
    to_jsonb(after_recipient),
    jsonb_build_object(
      'reason', normalized_reason,
      'schedule_id', schedule_after.id,
      'configuration_changed', configuration_changed,
      'auto_paused', configuration_changed and schedule_before.status = 'active'
    )
  );

  return after_recipient;
end;
$$;

create or replace function public.admin_remove_partner_report_schedule_recipient(
  p_recipient_id uuid,
  p_reason text default null
)
returns public.partner_report_schedule_recipients
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  before_recipient public.partner_report_schedule_recipients;
  after_recipient public.partner_report_schedule_recipients;
  schedule_before public.partner_report_schedules;
  schedule_after public.partner_report_schedules;
  normalized_reason text;
  configuration_changed boolean;
begin
  if not public.is_super_admin(auth.uid()) then
    raise exception 'Admin access required';
  end if;

  normalized_reason := public.reporting_admin_assert_reason(p_reason);

  select *
  into before_recipient
  from public.partner_report_schedule_recipients recipient
  where recipient.id = p_recipient_id
  for update;

  if before_recipient.id is null then
    raise exception 'Partner report schedule recipient not found';
  end if;

  if before_recipient.status = 'removed' then
    raise exception 'Recipient is already removed';
  end if;

  select *
  into schedule_before
  from public.partner_report_schedules schedule
  where schedule.id = before_recipient.schedule_id
  for update;

  if schedule_before.status = 'archived' then
    raise exception 'Archived schedules cannot change recipients';
  end if;

  update public.partner_report_schedule_recipients
  set
    status = 'removed',
    removed_by = auth.uid(),
    removed_at = now(),
    remove_reason = normalized_reason,
    updated_at = now()
  where id = before_recipient.id
  returning * into after_recipient;

  schedule_after := public.partner_report_schedule_refresh_configuration(schedule_before.id, true);
  configuration_changed := schedule_before.configuration_hash is distinct from schedule_after.configuration_hash;

  if configuration_changed and schedule_before.status = 'active' then
    update public.partner_report_schedules
    set
      status = 'paused',
      paused_at = now(),
      paused_by = auth.uid(),
      pause_reason = 'Paused automatically because active recipients changed.',
      updated_at = now()
    where id = schedule_after.id
    returning * into schedule_after;
  end if;

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
    auth.uid(),
    'partner_report_schedule_recipient.removed',
    'partner_report_schedule_recipient',
    after_recipient.id::text,
    null,
    to_jsonb(before_recipient),
    to_jsonb(after_recipient),
    jsonb_build_object(
      'reason', normalized_reason,
      'schedule_id', schedule_after.id,
      'configuration_changed', configuration_changed,
      'auto_paused', configuration_changed and schedule_before.status = 'active'
    )
  );

  return after_recipient;
end;
$$;

create or replace function public.admin_list_partner_report_schedules(
  p_status text default null,
  p_limit integer default 100
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  normalized_status text;
  normalized_limit integer;
  result jsonb;
begin
  if not public.is_super_admin(auth.uid()) then
    raise exception 'Admin access required';
  end if;

  normalized_status := nullif(lower(btrim(coalesce(p_status, ''))), '');
  if normalized_status is not null and normalized_status not in ('paused', 'active', 'archived') then
    raise exception 'Schedule status filter is invalid';
  end if;

  normalized_limit := least(greatest(coalesce(p_limit, 100), 1), 250);

  with schedule_rows as (
    select
      schedule.*,
      partnership.name as partnership_name,
      (
        select count(*)::integer
        from public.partner_report_schedule_recipients recipient
        where recipient.schedule_id = schedule.id
          and recipient.status = 'active'
      ) as active_recipient_count,
      public.partner_report_schedule_recipient_snapshot(schedule.id) as active_recipients
    from public.partner_report_schedules schedule
    join public.reporting_partnerships partnership on partnership.id = schedule.partnership_id
    where normalized_status is null or schedule.status = normalized_status
    order by schedule.updated_at desc
    limit normalized_limit
  )
  select coalesce(jsonb_agg(to_jsonb(schedule_rows) order by schedule_rows.updated_at desc), '[]'::jsonb)
  into result
  from schedule_rows;

  return result;
end;
$$;

create or replace function public.partner_report_schedule_retry_eligibility(p_run_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  run_row public.partner_report_schedule_runs;
  schedule_row public.partner_report_schedules;
  nonterminal boolean;
  lease_active boolean;
  retry_run_eligible boolean;
  retry_email_eligible boolean;
  send_again_eligible boolean;
  worker_reclaim_eligible boolean;
  reason text;
begin
  select *
  into run_row
  from public.partner_report_schedule_runs run
  where run.id = p_run_id;

  if run_row.id is null then
    return jsonb_build_object(
      'runId', p_run_id,
      'retryRunEligible', false,
      'retryEmailEligible', false,
      'sendAgainEligible', false,
      'workerReclaimEligible', false,
      'reason', 'run_not_found'
    );
  end if;

  select *
  into schedule_row
  from public.partner_report_schedules schedule
  where schedule.id = run_row.schedule_id;

  nonterminal := run_row.status in ('queued', 'checking_warnings', 'generating', 'artifact_ready', 'sending');
  lease_active := run_row.lease_expires_at is not null and run_row.lease_expires_at > now();
  worker_reclaim_eligible := nonterminal and not lease_active;
  retry_run_eligible := run_row.status in ('blocked', 'failed', 'cancelled')
    and coalesce(schedule_row.status, 'archived') <> 'archived';
  retry_email_eligible := run_row.status in ('artifact_ready', 'failed')
    and run_row.artifact_storage_path is not null
    and run_row.warning_gate_status = 'passed'
    and coalesce(schedule_row.status, 'archived') <> 'archived';
  send_again_eligible := run_row.status = 'sent'
    and coalesce(schedule_row.status, 'archived') <> 'archived';

  reason := case
    when coalesce(schedule_row.status, 'archived') = 'archived' then 'schedule_archived'
    when lease_active then 'lease_active'
    when send_again_eligible then 'duplicate_send_requires_confirmation'
    when retry_email_eligible then 'artifact_ready_for_email_retry'
    when retry_run_eligible and run_row.status = 'blocked' then 'warning_gate_must_pass_on_retry'
    when retry_run_eligible then 'manual_retry_available'
    when worker_reclaim_eligible then 'worker_reclaim_available'
    else 'not_retryable'
  end;

  return jsonb_build_object(
    'runId', run_row.id,
    'scheduleId', run_row.schedule_id,
    'status', run_row.status,
    'triggerType', run_row.trigger_type,
    'warningGateStatus', run_row.warning_gate_status,
    'retryRunEligible', retry_run_eligible,
    'retryEmailEligible', retry_email_eligible,
    'sendAgainEligible', send_again_eligible,
    'duplicateSendRequiresConfirmation', send_again_eligible,
    'workerReclaimEligible', worker_reclaim_eligible,
    'leaseActive', lease_active,
    'reason', reason
  );
end;
$$;

create or replace function public.admin_get_partner_report_schedule_retry_eligibility(
  p_run_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
begin
  if not public.is_super_admin(auth.uid()) then
    raise exception 'Admin access required';
  end if;

  return public.partner_report_schedule_retry_eligibility(p_run_id);
end;
$$;

create or replace function public.admin_list_partner_report_schedule_runs(
  p_schedule_id uuid default null,
  p_limit integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  normalized_limit integer;
  result jsonb;
begin
  if not public.is_super_admin(auth.uid()) then
    raise exception 'Admin access required';
  end if;

  normalized_limit := least(greatest(coalesce(p_limit, 50), 1), 250);

  with run_rows as (
    select
      run.*,
      schedule.title as schedule_title,
      partnership.name as partnership_name
    from public.partner_report_schedule_runs run
    join public.partner_report_schedules schedule on schedule.id = run.schedule_id
    join public.reporting_partnerships partnership on partnership.id = run.partnership_id
    where p_schedule_id is null or run.schedule_id = p_schedule_id
    order by run.created_at desc
    limit normalized_limit
  )
  select coalesce(jsonb_agg(to_jsonb(run_rows) order by run_rows.created_at desc), '[]'::jsonb)
  into result
  from run_rows;

  return result;
end;
$$;

create or replace function public.admin_get_partner_report_schedule_run(
  p_run_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  result jsonb;
begin
  if not public.is_super_admin(auth.uid()) then
    raise exception 'Admin access required';
  end if;

  select jsonb_build_object(
    'run', to_jsonb(run),
    'schedule', jsonb_build_object(
      'id', schedule.id,
      'title', schedule.title,
      'status', schedule.status,
      'cadence', schedule.cadence,
      'configurationVersion', schedule.configuration_version,
      'configurationHash', schedule.configuration_hash
    ),
    'partnership', jsonb_build_object(
      'id', partnership.id,
      'name', partnership.name,
      'status', partnership.status
    ),
    'emailAttempts',
      coalesce(
        (
          select jsonb_agg(to_jsonb(attempt) order by attempt.attempt_number)
          from public.partner_report_email_attempts attempt
          where attempt.run_id = run.id
        ),
        '[]'::jsonb
      ),
    'retryEligibility', public.partner_report_schedule_retry_eligibility(run.id)
  )
  into result
  from public.partner_report_schedule_runs run
  join public.partner_report_schedules schedule on schedule.id = run.schedule_id
  join public.reporting_partnerships partnership on partnership.id = run.partnership_id
  where run.id = p_run_id;

  if result is null then
    raise exception 'Partner report schedule run not found';
  end if;

  return result;
end;
$$;

create or replace function public.admin_record_partner_report_schedule_dry_run(
  p_schedule_id uuid,
  p_period_start_date date,
  p_period_end_date date,
  p_period_label text default null,
  p_warning_gate_status text default 'not_checked',
  p_warnings_json jsonb default '[]'::jsonb,
  p_status text default 'queued',
  p_reason text default null
)
returns public.partner_report_schedule_runs
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  schedule_row public.partner_report_schedules;
  run_row public.partner_report_schedule_runs;
  run_id uuid := gen_random_uuid();
  normalized_reason text;
  normalized_status text;
  normalized_gate text;
  normalized_label text;
  idempotency_key text;
  terminal_run boolean;
begin
  if not public.is_super_admin(auth.uid()) then
    raise exception 'Admin access required';
  end if;

  normalized_reason := public.reporting_admin_assert_reason(p_reason);
  normalized_status := lower(coalesce(nullif(btrim(p_status), ''), 'queued'));
  normalized_gate := lower(coalesce(nullif(btrim(p_warning_gate_status), ''), 'not_checked'));

  if normalized_status not in ('queued', 'checking_warnings', 'blocked', 'failed', 'cancelled', 'validated') then
    raise exception 'Dry-run status is invalid';
  end if;

  if normalized_gate not in ('passed', 'blocked', 'not_checked') then
    raise exception 'Warning gate status is invalid';
  end if;

  if normalized_status = 'validated' and normalized_gate <> 'passed' then
    raise exception 'Validated dry runs require a passed warning gate';
  end if;

  if p_period_start_date is null or p_period_end_date is null or p_period_end_date < p_period_start_date then
    raise exception 'A valid dry-run period is required';
  end if;

  if p_warnings_json is null or jsonb_typeof(p_warnings_json) <> 'array' then
    raise exception 'Warnings must be a JSON array';
  end if;

  schedule_row := public.partner_report_schedule_refresh_configuration(p_schedule_id, false);

  if schedule_row.status = 'archived' then
    raise exception 'Archived schedules cannot record dry runs';
  end if;

  normalized_label := coalesce(
    nullif(btrim(p_period_label), ''),
    case
      when schedule_row.period_grain = 'reporting_week'
        then 'Week ending ' || p_period_end_date::text
      else to_char(p_period_start_date, 'YYYY-MM')
    end
  );

  idempotency_key := format(
    'partner-report:schedule:%s:period:%s:%s:%s:dry-run:%s',
    schedule_row.id,
    schedule_row.period_grain,
    p_period_start_date,
    p_period_end_date,
    run_id
  );

  terminal_run := normalized_status in ('blocked', 'failed', 'cancelled', 'validated');

  insert into public.partner_report_schedule_runs (
    id,
    schedule_id,
    partnership_id,
    period_grain,
    period_start_date,
    period_end_date,
    period_label,
    trigger_type,
    idempotency_key,
    configuration_version,
    configuration_hash,
    status,
    warning_gate_status,
    warnings_json,
    recipient_snapshot_json,
    created_by,
    started_at,
    finished_at
  )
  values (
    run_id,
    schedule_row.id,
    schedule_row.partnership_id,
    schedule_row.period_grain,
    p_period_start_date,
    p_period_end_date,
    normalized_label,
    'dry_run',
    idempotency_key,
    schedule_row.configuration_version,
    schedule_row.configuration_hash,
    normalized_status,
    normalized_gate,
    p_warnings_json,
    public.partner_report_schedule_recipient_snapshot(schedule_row.id),
    auth.uid(),
    case when normalized_status <> 'queued' then now() else null end,
    case when terminal_run then now() else null end
  )
  returning * into run_row;

  update public.partner_report_schedules
  set
    last_run_at = coalesce(run_row.finished_at, run_row.created_at),
    last_status = run_row.status,
    last_success_at = case
      when run_row.status = 'validated' then coalesce(run_row.finished_at, now())
      else last_success_at
    end,
    last_validated_configuration_hash = case
      when run_row.status = 'validated' then run_row.configuration_hash
      else last_validated_configuration_hash
    end,
    last_validation_run_id = case
      when run_row.status = 'validated' then run_row.id
      else last_validation_run_id
    end,
    last_validated_at = case
      when run_row.status = 'validated' then coalesce(run_row.finished_at, now())
      else last_validated_at
    end,
    updated_at = now()
  where id = schedule_row.id;

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
    auth.uid(),
    'partner_report_schedule_run.dry_run_recorded',
    'partner_report_schedule_run',
    run_row.id::text,
    null,
    '{}'::jsonb,
    to_jsonb(run_row),
    jsonb_build_object(
      'reason', normalized_reason,
      'schedule_id', schedule_row.id,
      'configuration_hash', run_row.configuration_hash,
      'validated_configuration', run_row.status = 'validated'
    )
  );

  return run_row;
end;
$$;

create or replace function public.admin_create_partner_report_schedule_retry_run(
  p_parent_run_id uuid,
  p_reason text default null,
  p_duplicate_send_confirmation text default null
)
returns public.partner_report_schedule_runs
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  parent_run public.partner_report_schedule_runs;
  schedule_row public.partner_report_schedules;
  retry_run public.partner_report_schedule_runs;
  run_id uuid := gen_random_uuid();
  eligibility jsonb;
  normalized_reason text;
  duplicate_confirmation text;
  trigger_type text;
  idempotency_key text;
begin
  if not public.is_super_admin(auth.uid()) then
    raise exception 'Admin access required';
  end if;

  normalized_reason := public.reporting_admin_assert_reason(p_reason);
  duplicate_confirmation := nullif(btrim(coalesce(p_duplicate_send_confirmation, '')), '');

  select *
  into parent_run
  from public.partner_report_schedule_runs run
  where run.id = p_parent_run_id;

  if parent_run.id is null then
    raise exception 'Parent run not found';
  end if;

  schedule_row := public.partner_report_schedule_refresh_configuration(parent_run.schedule_id, false);
  eligibility := public.partner_report_schedule_retry_eligibility(parent_run.id);

  if (eligibility ->> 'sendAgainEligible')::boolean then
    if duplicate_confirmation is null then
      raise exception 'Sending again after a successful run requires a confirmation reason';
    end if;
    trigger_type := 'manual_send';
  elsif (eligibility ->> 'retryRunEligible')::boolean
     or (eligibility ->> 'retryEmailEligible')::boolean then
    trigger_type := 'manual_retry';
  else
    raise exception 'Run is not eligible for manual retry';
  end if;

  idempotency_key := format(
    'partner-report:schedule:%s:period:%s:%s:%s:%s:%s:%s',
    schedule_row.id,
    parent_run.period_grain,
    parent_run.period_start_date,
    parent_run.period_end_date,
    trigger_type,
    parent_run.id,
    run_id
  );

  insert into public.partner_report_schedule_runs (
    id,
    schedule_id,
    partnership_id,
    period_grain,
    period_start_date,
    period_end_date,
    period_label,
    trigger_type,
    idempotency_key,
    configuration_version,
    configuration_hash,
    status,
    warning_gate_status,
    recipient_snapshot_json,
    created_by,
    parent_run_id,
    retry_count
  )
  values (
    run_id,
    schedule_row.id,
    schedule_row.partnership_id,
    parent_run.period_grain,
    parent_run.period_start_date,
    parent_run.period_end_date,
    parent_run.period_label,
    trigger_type,
    idempotency_key,
    schedule_row.configuration_version,
    schedule_row.configuration_hash,
    'queued',
    'not_checked',
    public.partner_report_schedule_recipient_snapshot(schedule_row.id),
    auth.uid(),
    parent_run.id,
    parent_run.retry_count + 1
  )
  returning * into retry_run;

  update public.partner_report_schedules
  set
    last_run_at = retry_run.created_at,
    last_status = retry_run.status,
    updated_at = now()
  where id = schedule_row.id;

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
    auth.uid(),
    'partner_report_schedule_run.retry_queued',
    'partner_report_schedule_run',
    retry_run.id::text,
    null,
    to_jsonb(parent_run),
    to_jsonb(retry_run),
    jsonb_build_object(
      'reason', normalized_reason,
      'parent_run_id', parent_run.id,
      'trigger_type', trigger_type,
      'duplicate_send_confirmation', duplicate_confirmation
    )
  );

  return retry_run;
end;
$$;

create or replace function public.partner_report_schedule_claim_run(
  p_run_id uuid,
  p_worker_key text,
  p_lease_seconds integer default 600
)
returns public.partner_report_schedule_runs
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed_run public.partner_report_schedule_runs;
  normalized_worker_key text;
  normalized_lease_seconds integer;
begin
  normalized_worker_key := nullif(btrim(coalesce(p_worker_key, '')), '');
  if normalized_worker_key is null then
    raise exception 'Worker key is required';
  end if;

  normalized_lease_seconds := least(greatest(coalesce(p_lease_seconds, 600), 60), 3600);

  update public.partner_report_schedule_runs
  set
    claimed_at = now(),
    claimed_by = normalized_worker_key,
    lease_expires_at = now() + (normalized_lease_seconds || ' seconds')::interval,
    started_at = coalesce(started_at, now())
  where id = p_run_id
    and status in ('queued', 'checking_warnings', 'generating', 'artifact_ready', 'sending')
    and (
      lease_expires_at is null
      or lease_expires_at <= now()
      or claimed_by = normalized_worker_key
    )
  returning * into claimed_run;

  if claimed_run.id is null then
    raise exception 'Partner report schedule run is not claimable';
  end if;

  return claimed_run;
end;
$$;

create or replace function public.partner_report_schedule_release_run(
  p_run_id uuid,
  p_worker_key text,
  p_status text,
  p_error_code text default null,
  p_error_message text default null
)
returns public.partner_report_schedule_runs
language plpgsql
security definer
set search_path = public
as $$
declare
  before_run public.partner_report_schedule_runs;
  after_run public.partner_report_schedule_runs;
  normalized_worker_key text;
  normalized_status text;
  terminal_run boolean;
begin
  normalized_worker_key := nullif(btrim(coalesce(p_worker_key, '')), '');
  normalized_status := lower(coalesce(nullif(btrim(p_status), ''), 'queued'));

  if normalized_worker_key is null then
    raise exception 'Worker key is required';
  end if;

  if normalized_status not in (
    'queued',
    'checking_warnings',
    'blocked',
    'generating',
    'artifact_ready',
    'sending',
    'sent',
    'failed',
    'cancelled',
    'validated'
  ) then
    raise exception 'Run status is invalid';
  end if;

  select *
  into before_run
  from public.partner_report_schedule_runs run
  where run.id = p_run_id
  for update;

  if before_run.id is null then
    raise exception 'Partner report schedule run not found';
  end if;

  if before_run.claimed_by is distinct from normalized_worker_key then
    raise exception 'Partner report schedule run is claimed by another worker';
  end if;

  terminal_run := normalized_status in ('blocked', 'sent', 'failed', 'cancelled', 'validated');

  update public.partner_report_schedule_runs
  set
    status = normalized_status,
    error_code = nullif(btrim(coalesce(p_error_code, '')), ''),
    error_message = nullif(btrim(coalesce(p_error_message, '')), ''),
    claimed_at = null,
    claimed_by = null,
    lease_expires_at = null,
    finished_at = case when terminal_run then coalesce(finished_at, now()) else finished_at end
  where id = before_run.id
  returning * into after_run;

  update public.partner_report_schedules
  set
    last_run_at = coalesce(after_run.finished_at, after_run.created_at),
    last_status = after_run.status,
    last_success_at = case
      when after_run.status in ('sent', 'validated') then coalesce(after_run.finished_at, now())
      else last_success_at
    end,
    updated_at = now()
  where id = after_run.schedule_id;

  return after_run;
end;
$$;

do $$
declare
  fn record;
  helper_names constant text[] := array[
    'partner_report_schedule_active_recipient_emails',
    'partner_report_schedule_assert_can_activate',
    'partner_report_schedule_configuration_hash',
    'partner_report_schedule_configuration_payload',
    'partner_report_schedule_is_valid_email',
    'partner_report_schedule_normalize_email',
    'partner_report_schedule_recipient_snapshot',
    'partner_report_schedule_refresh_configuration',
    'partner_report_schedule_retry_eligibility'
  ];
  admin_rpc_names constant text[] := array[
    'admin_add_partner_report_schedule_recipient',
    'admin_archive_partner_report_schedule',
    'admin_create_partner_report_schedule',
    'admin_create_partner_report_schedule_retry_run',
    'admin_get_partner_report_schedule_retry_eligibility',
    'admin_get_partner_report_schedule_run',
    'admin_list_partner_report_schedule_runs',
    'admin_list_partner_report_schedules',
    'admin_pause_partner_report_schedule',
    'admin_record_partner_report_schedule_dry_run',
    'admin_remove_partner_report_schedule_recipient',
    'admin_resume_partner_report_schedule',
    'admin_update_partner_report_schedule'
  ];
  service_role_rpc_names constant text[] := array[
    'partner_report_schedule_claim_run',
    'partner_report_schedule_release_run'
  ];
begin
  for fn in
    select
      n.nspname,
      p.proname,
      pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = any(helper_names || admin_rpc_names || service_role_rpc_names)
  loop
    execute format(
      'revoke execute on function %I.%I(%s) from public, anon, authenticated',
      fn.nspname,
      fn.proname,
      fn.args
    );

    execute format(
      'grant execute on function %I.%I(%s) to service_role',
      fn.nspname,
      fn.proname,
      fn.args
    );

    if fn.proname = any(admin_rpc_names) then
      execute format(
        'grant execute on function %I.%I(%s) to authenticated',
        fn.nspname,
        fn.proname,
        fn.args
      );
    end if;
  end loop;
end $$;

select pg_notify('pgrst', 'reload schema');
