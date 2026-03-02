-- Restrict custom sticks artwork uploads to raster formats only.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'custom-sticks-artwork',
  'custom-sticks-artwork',
  true,
  5242880,
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
