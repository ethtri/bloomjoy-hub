-- Repair/normalize submission pipeline tables and policies in case of drift.

create table if not exists public.lead_submissions (
  id uuid primary key default gen_random_uuid(),
  submission_type text not null check (submission_type in ('quote', 'demo', 'procurement', 'general')),
  name text not null,
  email text not null,
  message text not null,
  source_page text not null default '/contact',
  created_at timestamptz not null default now()
);

alter table public.lead_submissions
  add column if not exists submission_type text,
  add column if not exists name text,
  add column if not exists email text,
  add column if not exists message text,
  add column if not exists source_page text,
  add column if not exists created_at timestamptz default now(),
  add column if not exists client_submission_id uuid,
  add column if not exists internal_notification_sent_at timestamptz;

alter table public.lead_submissions
  alter column submission_type set not null,
  alter column name set not null,
  alter column email set not null,
  alter column message set not null,
  alter column source_page set not null,
  alter column created_at set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'lead_submissions_submission_type_check'
      and conrelid = 'public.lead_submissions'::regclass
  ) then
    alter table public.lead_submissions
      add constraint lead_submissions_submission_type_check
      check (submission_type in ('quote', 'demo', 'procurement', 'general'));
  end if;
end $$;

create index if not exists lead_submissions_created_at_idx
  on public.lead_submissions (created_at desc);

create index if not exists lead_submissions_email_idx
  on public.lead_submissions (lower(email));

create unique index if not exists lead_submissions_client_submission_id_idx
  on public.lead_submissions (client_submission_id)
  where client_submission_id is not null;

alter table public.lead_submissions enable row level security;

drop policy if exists "lead_submissions_insert_public" on public.lead_submissions;
drop policy if exists "lead_submissions_select_super_admin" on public.lead_submissions;

create policy "lead_submissions_insert_public"
on public.lead_submissions
for insert
to anon, authenticated
with check (true);

create policy "lead_submissions_select_super_admin"
on public.lead_submissions
for select
to authenticated
using (public.is_super_admin(auth.uid()));

create table if not exists public.mini_waitlist_submissions (
  id uuid primary key default gen_random_uuid(),
  product_slug text not null default 'mini' check (product_slug = 'mini'),
  email text not null,
  source_page text not null default '/products/mini',
  created_at timestamptz not null default now()
);

alter table public.mini_waitlist_submissions
  add column if not exists product_slug text default 'mini',
  add column if not exists email text,
  add column if not exists source_page text default '/products/mini',
  add column if not exists created_at timestamptz default now();

alter table public.mini_waitlist_submissions
  alter column product_slug set not null,
  alter column email set not null,
  alter column source_page set not null,
  alter column created_at set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'mini_waitlist_submissions_product_slug_check'
      and conrelid = 'public.mini_waitlist_submissions'::regclass
  ) then
    alter table public.mini_waitlist_submissions
      add constraint mini_waitlist_submissions_product_slug_check
      check (product_slug = 'mini');
  end if;
end $$;

create unique index if not exists mini_waitlist_submissions_unique_product_email_idx
  on public.mini_waitlist_submissions (product_slug, lower(email));

create index if not exists mini_waitlist_submissions_created_at_idx
  on public.mini_waitlist_submissions (created_at desc);

alter table public.mini_waitlist_submissions enable row level security;

drop policy if exists "mini_waitlist_submissions_insert_public" on public.mini_waitlist_submissions;
drop policy if exists "mini_waitlist_submissions_select_super_admin" on public.mini_waitlist_submissions;

create policy "mini_waitlist_submissions_insert_public"
on public.mini_waitlist_submissions
for insert
to anon, authenticated
with check (true);

create policy "mini_waitlist_submissions_select_super_admin"
on public.mini_waitlist_submissions
for select
to authenticated
using (public.is_super_admin(auth.uid()));
