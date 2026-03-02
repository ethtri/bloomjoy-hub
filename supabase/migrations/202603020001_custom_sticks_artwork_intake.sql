-- Custom sticks artwork intake storage for public supplies flow.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'custom-sticks-artwork',
  'custom-sticks-artwork',
  true,
  5242880,
  array['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "custom_sticks_artwork_insert_public" on storage.objects;
drop policy if exists "custom_sticks_artwork_read_public" on storage.objects;

create policy "custom_sticks_artwork_insert_public"
on storage.objects
for insert
to anon, authenticated
with check (
  bucket_id = 'custom-sticks-artwork'
  and (storage.foldername(name))[1] = 'public'
);

create policy "custom_sticks_artwork_read_public"
on storage.objects
for select
to anon, authenticated
using (bucket_id = 'custom-sticks-artwork');
