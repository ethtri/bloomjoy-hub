-- MVP training seed data (safe to run in Supabase SQL Editor)
-- Assumes tables from 20260122_training_and_membership.sql exist.

insert into public.trainings (id, title, description, tags, duration_seconds, visibility, sort_order)
values
  (
    'f9b2a71f-6f9b-4df1-b4a9-6a9f1c7b2a01',
    'Machine Setup Basics',
    'Learn how to properly set up your Bloomjoy machine for first-time use.',
    array['Setup','Beginner'],
    720,
    'members_only',
    1
  ),
  (
    'b0b9baca-9f6b-4a57-8e1f-2c1ed2a5932e',
    'Sugar Loading Best Practices',
    'Optimal sugar loading techniques for consistent cotton candy production.',
    array['Operations','Sugar'],
    480,
    'members_only',
    2
  ),
  (
    '1f2cbe0d-0f66-4a2a-9f71-8ed6a64f4c12',
    'Troubleshooting Common Issues',
    'Quick fixes for the most common machine issues operators encounter.',
    array['Troubleshooting','Maintenance'],
    900,
    'members_only',
    3
  );

insert into public.training_assets (
  training_id,
  asset_type,
  provider,
  provider_video_id,
  provider_hash,
  embed_url,
  download_url,
  meta
)
values
  (
    'f9b2a71f-6f9b-4df1-b4a9-6a9f1c7b2a01',
    'video',
    'vimeo',
    null,
    null,
    null,
    null,
    '{"title":"Setup walkthrough"}'
  ),
  (
    'b0b9baca-9f6b-4a57-8e1f-2c1ed2a5932e',
    'video',
    'vimeo',
    null,
    null,
    null,
    null,
    '{"title":"Sugar loading demo"}'
  ),
  (
    '1f2cbe0d-0f66-4a2a-9f71-8ed6a64f4c12',
    'video',
    'vimeo',
    null,
    null,
    null,
    null,
    '{"title":"Troubleshooting walkthrough"}'
  );
