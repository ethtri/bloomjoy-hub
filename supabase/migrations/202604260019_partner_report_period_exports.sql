-- Add period metadata so official partner report exports can support both
-- weekly and monthly artifacts without overloading week_ending_date.

alter table public.partner_report_snapshots
  add column if not exists period_grain text,
  add column if not exists period_start_date date,
  add column if not exists period_end_date date;

update public.partner_report_snapshots
set
  period_grain = coalesce(period_grain, 'reporting_week'),
  period_start_date = coalesce(period_start_date, week_ending_date - 6),
  period_end_date = coalesce(period_end_date, week_ending_date)
where period_grain is null
  or period_start_date is null
  or period_end_date is null;

alter table public.partner_report_snapshots
  alter column period_grain set default 'reporting_week',
  alter column period_grain set not null,
  alter column period_start_date set not null,
  alter column period_end_date set not null;

alter table public.partner_report_snapshots
  drop constraint if exists partner_report_snapshots_period_grain_check,
  drop constraint if exists partner_report_snapshots_period_window_check;

alter table public.partner_report_snapshots
  add constraint partner_report_snapshots_period_grain_check
    check (period_grain in ('reporting_week', 'calendar_month')),
  add constraint partner_report_snapshots_period_window_check
    check (period_end_date >= period_start_date);

drop index if exists public.partner_report_snapshots_unique_week_idx;

create unique index if not exists partner_report_snapshots_unique_period_idx
  on public.partner_report_snapshots (
    partnership_id,
    period_grain,
    period_start_date,
    period_end_date,
    status
  )
  where status in ('draft', 'approved', 'sent');

create index if not exists partner_report_snapshots_period_idx
  on public.partner_report_snapshots (
    partnership_id,
    period_grain,
    period_end_date desc
  );
