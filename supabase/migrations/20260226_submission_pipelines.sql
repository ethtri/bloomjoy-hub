-- Persist contact leads and Mini waitlist submissions (issue #62 scoped slice)

create table if not exists public.lead_submissions (
  id uuid primary key default gen_random_uuid(),
  submission_type text not null check (submission_type in ('quote', 'demo', 'procurement', 'general')),
  name text not null,
  email text not null,
  message text not null,
  source_page text not null default '/contact',
  created_at timestamptz not null default now()
);

create index if not exists lead_submissions_created_at_idx
  on public.lead_submissions (created_at desc);

create index if not exists lead_submissions_email_idx
  on public.lead_submissions (lower(email));

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
