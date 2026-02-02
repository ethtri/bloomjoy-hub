-- Training library + membership source-of-truth tables (MVP)

create type training_visibility as enum ('members_only', 'public', 'draft');
create type training_asset_type as enum ('video', 'pdf', 'link');
create type training_provider as enum ('vimeo', 'wistia', 'aws', 'youtube', 'loom');

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  stripe_customer_id text,
  stripe_subscription_id text unique,
  status text not null,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists subscriptions_user_id_idx on public.subscriptions (user_id);

create table if not exists public.trainings (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  tags text[] not null default '{}',
  duration_seconds integer,
  visibility training_visibility not null default 'members_only',
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.training_assets (
  id uuid primary key default gen_random_uuid(),
  training_id uuid not null references public.trainings (id) on delete cascade,
  asset_type training_asset_type not null,
  provider training_provider,
  provider_video_id text,
  provider_hash text,
  embed_url text,
  download_url text,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists training_assets_training_id_idx on public.training_assets (training_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger subscriptions_set_updated_at
before update on public.subscriptions
for each row execute function public.set_updated_at();

create trigger trainings_set_updated_at
before update on public.trainings
for each row execute function public.set_updated_at();

create trigger training_assets_set_updated_at
before update on public.training_assets
for each row execute function public.set_updated_at();

alter table public.subscriptions enable row level security;
alter table public.trainings enable row level security;
alter table public.training_assets enable row level security;

create policy "subscriptions_select_own"
on public.subscriptions
for select
using (auth.uid() = user_id);

create policy "trainings_select_public_or_member"
on public.trainings
for select
using (
  visibility = 'public'
  or (
    visibility = 'members_only'
    and exists (
      select 1
      from public.subscriptions s
      where s.user_id = auth.uid()
        and s.status in ('active', 'trialing')
        and (s.current_period_end is null or s.current_period_end > now())
    )
  )
);

create policy "training_assets_select_public_or_member"
on public.training_assets
for select
using (
  exists (
    select 1
    from public.trainings t
    where t.id = training_id
      and (
        t.visibility = 'public'
        or (
          t.visibility = 'members_only'
          and exists (
            select 1
            from public.subscriptions s
            where s.user_id = auth.uid()
              and s.status in ('active', 'trialing')
              and (s.current_period_end is null or s.current_period_end > now())
          )
        )
      )
  )
);
