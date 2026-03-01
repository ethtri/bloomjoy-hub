-- Standardize Vimeo training thumbnail metadata to first-party Supabase Storage keys.
-- `meta.thumbnail_url` now stores an object key in bucket `training-thumbnails`.
-- Example key: `vimeo/1167976486.jpg`

update public.training_assets
set meta = jsonb_set(
  coalesce(meta, '{}'::jsonb),
  '{thumbnail_url}',
  to_jsonb(format('vimeo/%s.jpg', provider_video_id)),
  true
)
where asset_type = 'video'
  and provider = 'vimeo'
  and nullif(trim(provider_video_id), '') is not null
  and (
    not (coalesce(meta, '{}'::jsonb) ? 'thumbnail_url')
    or nullif(trim(coalesce(meta, '{}'::jsonb)->>'thumbnail_url'), '') is null
    or lower(coalesce(meta, '{}'::jsonb)->>'thumbnail_url') like 'https://vumbnail.com/%'
  );
