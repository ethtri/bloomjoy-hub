-- Backfill internal notification schema.
-- This exists because two historical migration files shared the same version
-- (202603020001), which prevented this SQL from being recorded/applied remotely.

alter table public.lead_submissions
  add column if not exists client_submission_id uuid,
  add column if not exists internal_notification_sent_at timestamptz;

create unique index if not exists lead_submissions_client_submission_id_idx
  on public.lead_submissions (client_submission_id)
  where client_submission_id is not null;

alter table public.orders
  add column if not exists internal_notification_sent_at timestamptz;

create table if not exists public.internal_notification_dispatches (
  event_key text primary key,
  dispatch_type text not null check (dispatch_type in ('lead_quote', 'order_checkout')),
  source_table text not null,
  source_id text not null,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create index if not exists internal_notification_dispatches_created_at_idx
  on public.internal_notification_dispatches (created_at desc);

alter table public.internal_notification_dispatches enable row level security;

drop policy if exists "internal_notification_dispatches_select_super_admin"
  on public.internal_notification_dispatches;

create policy "internal_notification_dispatches_select_super_admin"
on public.internal_notification_dispatches
for select
to authenticated
using (public.is_super_admin(auth.uid()));
