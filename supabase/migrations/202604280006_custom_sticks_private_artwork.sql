-- Make custom sticks artwork private and store lead metadata for signed access.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'custom-sticks-artwork',
  'custom-sticks-artwork',
  false,
  5242880,
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "custom_sticks_artwork_insert_public" on storage.objects;
drop policy if exists "custom_sticks_artwork_read_public" on storage.objects;
drop policy if exists "custom_sticks_artwork_insert_private_intake" on storage.objects;
drop policy if exists "custom_sticks_artwork_read_super_admin" on storage.objects;

create policy "custom_sticks_artwork_read_super_admin"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'custom-sticks-artwork'
  and public.is_super_admin((select auth.uid()))
);

alter table public.lead_submissions
  add column if not exists metadata jsonb not null default '{}'::jsonb;

comment on column public.lead_submissions.metadata is
  'Structured lead metadata such as private custom sticks artwork bucket/path/file details. Do not store long-lived public artwork URLs here.';

select pg_notify('pgrst', 'reload schema');
