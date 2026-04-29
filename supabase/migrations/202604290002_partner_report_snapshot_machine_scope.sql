-- Allow official partner report snapshots to distinguish all-machine exports
-- from single-machine drilldown exports for the same partnership and period.

alter table public.partner_report_snapshots
  add column if not exists machine_scope_key text not null default 'all';

update public.partner_report_snapshots
set machine_scope_key = 'all'
where machine_scope_key is null
  or btrim(machine_scope_key) = '';

alter table public.partner_report_snapshots
  drop constraint if exists partner_report_snapshots_machine_scope_key_check;

alter table public.partner_report_snapshots
  add constraint partner_report_snapshots_machine_scope_key_check
    check (btrim(machine_scope_key) <> '');

drop index if exists public.partner_report_snapshots_unique_period_idx;

create unique index if not exists partner_report_snapshots_unique_period_scope_idx
  on public.partner_report_snapshots (
    partnership_id,
    period_grain,
    period_start_date,
    period_end_date,
    machine_scope_key,
    status
  )
  where status in ('draft', 'approved', 'sent');

create index if not exists partner_report_snapshots_period_scope_idx
  on public.partner_report_snapshots (
    partnership_id,
    period_grain,
    machine_scope_key,
    period_end_date desc
  );
