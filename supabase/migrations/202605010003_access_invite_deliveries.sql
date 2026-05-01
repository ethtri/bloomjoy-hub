create table if not exists public.access_invite_deliveries (
  id uuid primary key default gen_random_uuid(),
  invite_type text not null,
  source_type text not null,
  source_id uuid not null,
  target_email text not null,
  sent_by uuid references auth.users (id) on delete set null,
  sent_at timestamptz not null default now(),
  delivery_status text not null default 'sent',
  error_message text,
  created_at timestamptz not null default now(),
  constraint access_invite_deliveries_invite_type_check
    check (invite_type in ('corporate_partner', 'technician')),
  constraint access_invite_deliveries_source_type_check
    check (source_type in ('corporate_partner_membership', 'technician_grant')),
  constraint access_invite_deliveries_delivery_status_check
    check (delivery_status in ('sent', 'failed')),
  constraint access_invite_deliveries_target_email_present
    check (length(trim(target_email)) > 0)
);

create index if not exists access_invite_deliveries_source_idx
  on public.access_invite_deliveries (source_type, source_id, sent_at desc);

create index if not exists access_invite_deliveries_email_idx
  on public.access_invite_deliveries (lower(target_email), sent_at desc);

create index if not exists access_invite_deliveries_sent_by_idx
  on public.access_invite_deliveries (sent_by, sent_at desc);

alter table public.access_invite_deliveries enable row level security;

drop policy if exists "access_invite_deliveries_select_super_admin"
  on public.access_invite_deliveries;
create policy "access_invite_deliveries_select_super_admin"
on public.access_invite_deliveries
for select
to authenticated
using (public.is_super_admin((select auth.uid())));

comment on table public.access_invite_deliveries is
  'Audit-friendly delivery log for access invite emails. Grants remain source-owned by their existing tables.';

comment on column public.access_invite_deliveries.invite_type is
  'User-facing invite preset. V1 supports Corporate Partner and Technician invite emails.';

comment on column public.access_invite_deliveries.source_type is
  'Grant table behind the invite, currently corporate_partner_membership or technician_grant.';

select pg_notify('pgrst', 'reload schema');
