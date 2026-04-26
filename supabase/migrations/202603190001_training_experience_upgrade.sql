-- Training experience upgrade: tracks, progress, certificates, and document-first job aids.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'training-documents',
  'training-documents',
  false,
  10485760,
  array['application/pdf']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.training_tracks (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  description text,
  audience text not null default 'Operator',
  certificate_title text,
  visibility training_visibility not null default 'members_only',
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.training_track_items (
  id uuid primary key default gen_random_uuid(),
  track_id uuid not null references public.training_tracks (id) on delete cascade,
  training_id uuid not null references public.trainings (id) on delete cascade,
  required boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (track_id, training_id)
);

create table if not exists public.training_progress (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  training_id uuid not null references public.trainings (id) on delete cascade,
  started_at timestamptz,
  completed_at timestamptz,
  completion_source text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, training_id)
);

create table if not exists public.training_certifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  track_id uuid not null references public.training_tracks (id) on delete cascade,
  certificate_title text not null,
  issued_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, track_id)
);

create index if not exists training_track_items_track_id_idx
  on public.training_track_items (track_id);
create index if not exists training_progress_user_id_idx
  on public.training_progress (user_id);
create index if not exists training_progress_training_id_idx
  on public.training_progress (training_id);
create index if not exists training_certifications_user_id_idx
  on public.training_certifications (user_id);

drop trigger if exists training_tracks_set_updated_at on public.training_tracks;
create trigger training_tracks_set_updated_at
before update on public.training_tracks
for each row execute function public.set_updated_at();

drop trigger if exists training_track_items_set_updated_at on public.training_track_items;
create trigger training_track_items_set_updated_at
before update on public.training_track_items
for each row execute function public.set_updated_at();

drop trigger if exists training_progress_set_updated_at on public.training_progress;
create trigger training_progress_set_updated_at
before update on public.training_progress
for each row execute function public.set_updated_at();

drop trigger if exists training_certifications_set_updated_at on public.training_certifications;
create trigger training_certifications_set_updated_at
before update on public.training_certifications
for each row execute function public.set_updated_at();

alter table public.training_tracks enable row level security;
alter table public.training_track_items enable row level security;
alter table public.training_progress enable row level security;
alter table public.training_certifications enable row level security;

drop policy if exists "training_tracks_select_public_or_member" on public.training_tracks;
create policy "training_tracks_select_public_or_member"
on public.training_tracks
for select
using (
  visibility = 'public'
  or (
    visibility = 'members_only'
    and public.can_access_members_only_training()
  )
);

drop policy if exists "training_track_items_select_public_or_member" on public.training_track_items;
create policy "training_track_items_select_public_or_member"
on public.training_track_items
for select
using (
  exists (
    select 1
    from public.training_tracks tt
    where tt.id = track_id
      and (
        tt.visibility = 'public'
        or (
          tt.visibility = 'members_only'
          and public.can_access_members_only_training()
        )
      )
  )
);

drop policy if exists "training_progress_select_own" on public.training_progress;
create policy "training_progress_select_own"
on public.training_progress
for select
using (
  auth.uid() = user_id
  and public.can_access_members_only_training()
);

drop policy if exists "training_certifications_select_own" on public.training_certifications;
create policy "training_certifications_select_own"
on public.training_certifications
for select
using (
  auth.uid() = user_id
  and public.can_access_members_only_training()
);

drop policy if exists "training_documents_read_member_only" on storage.objects;
create policy "training_documents_read_member_only"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'training-documents'
  and public.can_access_members_only_training()
);

create or replace function public.save_training_progress(
  training_id_input uuid,
  mark_complete_input boolean default false,
  completion_source_input text default 'portal_training'
)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  current_user_id uuid;
  current_timestamp timestamptz := now();
begin
  current_user_id := auth.uid();

  if current_user_id is null then
    raise exception 'Authentication required';
  end if;

  if not public.can_access_members_only_training() then
    raise exception 'Membership required';
  end if;

  if not exists (
    select 1
    from public.trainings t
    where t.id = training_id_input
      and t.visibility <> 'draft'
  ) then
    raise exception 'Training item not found';
  end if;

  insert into public.training_progress (
    user_id,
    training_id,
    started_at,
    completed_at,
    completion_source
  )
  values (
    current_user_id,
    training_id_input,
    current_timestamp,
    case when mark_complete_input then current_timestamp else null end,
    completion_source_input
  )
  on conflict (user_id, training_id) do update
  set
    started_at = coalesce(public.training_progress.started_at, excluded.started_at),
    completed_at = case
      when mark_complete_input then coalesce(public.training_progress.completed_at, excluded.completed_at)
      else public.training_progress.completed_at
    end,
    completion_source = excluded.completion_source,
    updated_at = now();
end;
$$;

grant execute on function public.save_training_progress(uuid, boolean, text) to authenticated;

create or replace function public.issue_training_certificate(
  track_slug_input text,
  final_acknowledgement_input boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  current_user_id uuid;
  current_track public.training_tracks%rowtype;
  missing_required_count integer;
  existing_or_new_id uuid;
begin
  current_user_id := auth.uid();

  if current_user_id is null then
    raise exception 'Authentication required';
  end if;

  if not public.can_access_members_only_training() then
    raise exception 'Membership required';
  end if;

  if not final_acknowledgement_input then
    raise exception 'Final acknowledgement required';
  end if;

  select *
  into current_track
  from public.training_tracks tt
  where tt.slug = track_slug_input
    and tt.visibility <> 'draft'
  limit 1;

  if not found then
    raise exception 'Training track not found';
  end if;

  select count(*)
  into missing_required_count
  from public.training_track_items tti
  left join public.training_progress tp
    on tp.training_id = tti.training_id
   and tp.user_id = current_user_id
   and tp.completed_at is not null
  where tti.track_id = current_track.id
    and tti.required = true
    and tp.training_id is null;

  if missing_required_count > 0 then
    raise exception 'Complete all required items before unlocking the certificate';
  end if;

  insert into public.training_certifications (
    user_id,
    track_id,
    certificate_title
  )
  values (
    current_user_id,
    current_track.id,
    coalesce(current_track.certificate_title, current_track.title)
  )
  on conflict (user_id, track_id) do update
  set certificate_title = excluded.certificate_title
  returning id into existing_or_new_id;

  return existing_or_new_id;
end;
$$;

grant execute on function public.issue_training_certificate(text, boolean) to authenticated;

update public.trainings
set tags = coalesce(tags, '{}') || array['Audience: Operator', 'Format: Video', 'Task: Daily Operation']
where title in (
  'Start-Up & Shutdown Procedure (Safe Power Cycle)',
  'Replace advertising video',
  'Unlock Admin/Service Mode (UI Access)'
);

update public.trainings
set tags = coalesce(tags, '{}') || array['Audience: Operator', 'Format: Video', 'Task: Software & Payments']
where title in (
  'Configure Coin Acceptor (Calibration/Setup)',
  'Install Cash Dispenser / Money Box Module',
  'Install Bill Validator (Cash Acceptance Module)',
  'Install/Remove Remote Module (Connectivity/Telemetry)'
);

update public.trainings
set tags = coalesce(tags, '{}') || array['Audience: Operator', 'Format: Video', 'Task: Cleaning & Maintenance']
where title in (
  'Daily Maintenance Routine',
  'Reinstall Burner Cover (Correct Fit & Orientation)',
  'Assembly & Reassembly Walkthrough',
  'Burner Maintenance: Clean the Burner Cover',
  'Burner Maintenance: Clean the Burner Base'
);

update public.trainings
set tags = coalesce(tags, '{}') || array['Audience: Operator', 'Format: Video', 'Task: Troubleshooting']
where title in (
  'Replace Speed Control Board (Motor Speed)',
  'Replace Forward/Reverse Control Board (Motor Direction)',
  'Using a Multimeter: DC Voltage Mode (Basics)',
  'Safety Check: Verify Ground/Earth Connection',
  'Using a Multimeter: AC Voltage Mode (Basics)'
);

insert into public.trainings (
  id,
  title,
  description,
  tags,
  duration_seconds,
  visibility,
  sort_order
)
values
  (
    'e1f10000-7c1b-49f7-a1aa-100000000001'::uuid,
    'Software Setup Quickstart',
    'Use this guide when you need fast admin access, Wi-Fi, time zone, and first-login setup.',
    array['Audience: Operator', 'Task: Start Here', 'Task: Software & Payments', 'Format: Guide', 'Admin', 'Wi-Fi', 'Time zone'],
    540,
    'members_only',
    18
  ),
  (
    'e1f10000-7c1b-49f7-a1aa-100000000002'::uuid,
    'Pricing, Passwords, and Payment Settings',
    'Configure prices, guest and staff passwords, payment mode, and operator-facing contact details.',
    array['Audience: Operator', 'Task: Software & Payments', 'Format: Guide', 'Pricing', 'Passwords', 'Payments', 'Nayax'],
    480,
    'members_only',
    19
  ),
  (
    'e1f10000-7c1b-49f7-a1aa-100000000003'::uuid,
    'Alarm and Power Timer Setup',
    'Set the burner auto-start alarm and the daily power schedule so the machine opens and closes on time.',
    array['Audience: Operator', 'Task: Daily Operation', 'Task: Software & Payments', 'Format: Checklist', 'Alarm', 'Timer', 'Scheduling'],
    360,
    'members_only',
    20
  ),
  (
    'e1f10000-7c1b-49f7-a1aa-100000000004'::uuid,
    'Maintenance Guide Reference Manual',
    'Use the full maintenance manual to understand the major modules, cleaning points, and inspection steps.',
    array['Audience: Operator', 'Task: Start Here', 'Task: Cleaning & Maintenance', 'Format: Reference', 'Maintenance', 'Module map'],
    840,
    'members_only',
    21
  ),
  (
    'e1f10000-7c1b-49f7-a1aa-100000000005'::uuid,
    'Cleaning and Hygiene Checklist',
    'Follow the daily cleaning points that prevent sugar buildup, debris, and avoidable downtime.',
    array['Audience: Operator', 'Task: Cleaning & Maintenance', 'Format: Checklist', 'Maintenance', 'Daily', 'Cleaning'],
    420,
    'members_only',
    22
  ),
  (
    'e1f10000-7c1b-49f7-a1aa-100000000006'::uuid,
    'Module Function Check Guide',
    'Run the module inspection steps when the burner, door, air pump, cooling, or output modules need verification.',
    array['Audience: Operator', 'Task: Troubleshooting', 'Task: Cleaning & Maintenance', 'Format: Guide', 'Diagnostics', 'Function check'],
    600,
    'members_only',
    23
  ),
  (
    'e1f10000-7c1b-49f7-a1aa-100000000007'::uuid,
    'Consumables Loading and Stick Handling',
    'Use the manual checks for sugar fill level, pipe routing, and paper-stick handling when output quality drops.',
    array['Audience: Operator', 'Task: Daily Operation', 'Task: Troubleshooting', 'Format: Guide', 'Sugar', 'Sticks', 'Consumables'],
    360,
    'members_only',
    24
  )
on conflict (id) do update
set
  title = excluded.title,
  description = excluded.description,
  tags = excluded.tags,
  duration_seconds = excluded.duration_seconds,
  visibility = excluded.visibility,
  sort_order = excluded.sort_order;

insert into public.training_assets (
  id,
  training_id,
  asset_type,
  provider,
  meta
)
values
  (
    'f2a20000-7c1b-49f7-a1aa-200000000001'::uuid,
    'e1f10000-7c1b-49f7-a1aa-100000000001'::uuid,
    'pdf',
    null,
    jsonb_build_object(
      'title', 'Software Setup Reference Manual',
      'description', 'Download the full software setup PDF for the original admin, pricing, and scheduling instructions.',
      'format_badge', 'PDF',
      'action_label', 'Download PDF',
      'source_document_title', 'Software setup manual',
      'read_minutes', 9,
      'storage_path', 'manuals/software-setup.pdf'
    )
  ),
  (
    'f2a20000-7c1b-49f7-a1aa-200000000002'::uuid,
    'e1f10000-7c1b-49f7-a1aa-100000000002'::uuid,
    'pdf',
    null,
    jsonb_build_object(
      'title', 'Pricing, Passwords, and Payment Settings',
      'description', 'Guide for pricing, passwords, Nayax payment mode, and operator contact settings.',
      'format_badge', 'Guide',
      'action_label', 'Open guide',
      'source_document_title', 'Software setup manual',
      'read_minutes', 8
    )
  ),
  (
    'f2a20000-7c1b-49f7-a1aa-200000000003'::uuid,
    'e1f10000-7c1b-49f7-a1aa-100000000003'::uuid,
    'pdf',
    null,
    jsonb_build_object(
      'title', 'Alarm and Power Timer Setup',
      'description', 'Checklist for burner auto-start and daily power scheduling.',
      'format_badge', 'Checklist',
      'action_label', 'Open checklist',
      'source_document_title', 'Software setup manual',
      'read_minutes', 6
    )
  ),
  (
    'f2a20000-7c1b-49f7-a1aa-200000000004'::uuid,
    'e1f10000-7c1b-49f7-a1aa-100000000004'::uuid,
    'pdf',
    null,
    jsonb_build_object(
      'title', 'Cotton Candy Maintenance Guide (PDF)',
      'description', 'Download the full maintenance guide for the original module map, cleaning, and inspection instructions.',
      'format_badge', 'PDF',
      'action_label', 'Download PDF',
      'source_document_title', 'Cotton Candy Maintenance Guide',
      'read_minutes', 14,
      'storage_path', 'manuals/cotton-candy-maintenance-guide.pdf'
    )
  ),
  (
    'f2a20000-7c1b-49f7-a1aa-200000000005'::uuid,
    'e1f10000-7c1b-49f7-a1aa-100000000005'::uuid,
    'pdf',
    null,
    jsonb_build_object(
      'title', 'Cleaning and Hygiene Checklist',
      'description', 'Daily cleaning checklist pulled from the maintenance guide.',
      'format_badge', 'Checklist',
      'action_label', 'Open checklist',
      'source_document_title', 'Cotton Candy Maintenance Guide',
      'read_minutes', 7
    )
  ),
  (
    'f2a20000-7c1b-49f7-a1aa-200000000006'::uuid,
    'e1f10000-7c1b-49f7-a1aa-100000000006'::uuid,
    'pdf',
    null,
    jsonb_build_object(
      'title', 'Module Function Check Guide',
      'description', 'Structured inspection guide for module diagnostics and support escalation.',
      'format_badge', 'Guide',
      'action_label', 'Open guide',
      'source_document_title', 'Cotton Candy Maintenance Guide',
      'read_minutes', 10
    )
  ),
  (
    'f2a20000-7c1b-49f7-a1aa-200000000007'::uuid,
    'e1f10000-7c1b-49f7-a1aa-100000000007'::uuid,
    'pdf',
    null,
    jsonb_build_object(
      'title', 'Consumables Loading and Stick Handling',
      'description', 'Guide for sugar fill level, pipe routing, and paper-stick handling checks.',
      'format_badge', 'Guide',
      'action_label', 'Open guide',
      'source_document_title', 'Cotton Candy Maintenance Guide',
      'read_minutes', 6
    )
  )
on conflict (id) do update
set
  training_id = excluded.training_id,
  asset_type = excluded.asset_type,
  provider = excluded.provider,
  meta = excluded.meta;

insert into public.training_tracks (
  id,
  slug,
  title,
  description,
  audience,
  certificate_title,
  visibility,
  sort_order
)
values (
  'd7c30000-7c1b-49f7-a1aa-300000000001'::uuid,
  'operator-essentials',
  'Operator Essentials',
  'The shortest path to safe setup, daily operation, cleaning, and recovery for day-to-day operators.',
  'Operator',
  'Bloomjoy Operator Essentials',
  'members_only',
  1
)
on conflict (slug) do update
set
  title = excluded.title,
  description = excluded.description,
  audience = excluded.audience,
  certificate_title = excluded.certificate_title,
  visibility = excluded.visibility,
  sort_order = excluded.sort_order;

with track_row as (
  select id
  from public.training_tracks
  where slug = 'operator-essentials'
),
required_items as (
  select *
  from (
    values
      ('Software Setup Quickstart'::text, true, 1),
      ('Start-Up & Shutdown Procedure (Safe Power Cycle)'::text, true, 2),
      ('Pricing, Passwords, and Payment Settings'::text, true, 3),
      ('Alarm and Power Timer Setup'::text, true, 4),
      ('Daily Maintenance Routine'::text, true, 5),
      ('Cleaning and Hygiene Checklist'::text, true, 6),
      ('Consumables Loading and Stick Handling'::text, true, 7),
      ('Module Function Check Guide'::text, true, 8)
  ) as t(training_title, required, sort_order)
)
insert into public.training_track_items (
  track_id,
  training_id,
  required,
  sort_order
)
select
  track_row.id,
  tr.id,
  required_items.required,
  required_items.sort_order
from track_row
join required_items on true
join public.trainings tr
  on tr.title = required_items.training_title
on conflict (track_id, training_id) do update
set
  required = excluded.required,
  sort_order = excluded.sort_order;
