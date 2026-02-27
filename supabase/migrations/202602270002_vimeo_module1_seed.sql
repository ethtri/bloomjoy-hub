-- Seed Vimeo module 1 videos into training library and harden admin/tester access.

create or replace function public.can_access_members_only_training()
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select
    exists (
      select 1
      from public.subscriptions s
      where s.user_id = auth.uid()
        and s.status in ('active', 'trialing')
        and (s.current_period_end is null or s.current_period_end > now())
    )
    or exists (
      select 1
      from public.admin_roles ar
      where ar.user_id = auth.uid()
        and ar.role = 'super_admin'
        and ar.active = true
    );
$$;

grant execute on function public.can_access_members_only_training() to authenticated;

drop policy if exists "trainings_select_public_or_member" on public.trainings;
create policy "trainings_select_public_or_member"
on public.trainings
for select
using (
  visibility = 'public'
  or (
    visibility = 'members_only'
    and public.can_access_members_only_training()
  )
);

drop policy if exists "training_assets_select_public_or_member" on public.training_assets;
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
          and public.can_access_members_only_training()
        )
      )
  )
);

-- Hide legacy placeholder module rows from member visibility.
update public.trainings
set visibility = 'draft'
where id in (
  'f9b2a71f-6f9b-4df1-b4a9-6a9f1c7b2a01',
  'b0b9baca-9f6b-4a57-8e1f-2c1ed2a5932e',
  '1f2cbe0d-0f66-4a2a-9f71-8ed6a64f4c12'
);

with vimeo_module1 as (
  select *
  from (
    values
      (
        'd733f400-9e4a-45ea-8a8c-0fb3d3400001'::uuid,
        'Unlock Admin/Service Mode (UI Access)'::text,
        'Gain access to admin/service controls for advanced operations.'::text,
        array['Module 1','Admin','Service']::text[],
        1::integer,
        '1167976486'::text,
        'e32f9c0bb1'::text,
        'https://player.vimeo.com/video/1167976486?h=e32f9c0bb1&dnt=1'::text
      ),
      (
        'd733f400-9e4a-45ea-8a8c-0fb3d3400002'::uuid,
        'Start-Up & Shutdown Procedure (Safe Power Cycle)',
        'Safe startup and shutdown process for daily operation.',
        array['Module 1','Operations','Safety']::text[],
        2,
        '1167976439',
        '1afa672007',
        'https://player.vimeo.com/video/1167976439?h=1afa672007&dnt=1'
      ),
      (
        'd733f400-9e4a-45ea-8a8c-0fb3d3400003'::uuid,
        'Configure Coin Acceptor (Calibration/Setup)',
        'Configure and calibrate the coin acceptor module.',
        array['Module 1','Setup','Payments']::text[],
        3,
        '1167976252',
        'f57db252b9',
        'https://player.vimeo.com/video/1167976252?h=f57db252b9&dnt=1'
      ),
      (
        'd733f400-9e4a-45ea-8a8c-0fb3d3400004'::uuid,
        'Replace advertising video',
        'Update the default ad video shown on your machine.',
        array['Module 1','Display','Content']::text[],
        4,
        '1167976115',
        'b0318e7049',
        'https://player.vimeo.com/video/1167976115?h=b0318e7049&dnt=1'
      ),
      (
        'd733f400-9e4a-45ea-8a8c-0fb3d3400005'::uuid,
        'Daily Maintenance Routine',
        'Routine daily maintenance checks for consistent performance.',
        array['Module 1','Maintenance','Daily']::text[],
        5,
        '1167976086',
        'b2bc9cd54e',
        'https://player.vimeo.com/video/1167976086?h=b2bc9cd54e&dnt=1'
      ),
      (
        'd733f400-9e4a-45ea-8a8c-0fb3d3400006'::uuid,
        'Install Cash Dispenser / Money Box Module',
        'Install or replace the cash dispenser/money box module.',
        array['Module 1','Hardware','Payments']::text[],
        6,
        '1167975956',
        'ce17db4131',
        'https://player.vimeo.com/video/1167975956?h=ce17db4131&dnt=1'
      ),
      (
        'd733f400-9e4a-45ea-8a8c-0fb3d3400007'::uuid,
        'Replace Speed Control Board (Motor Speed)',
        'Swap and validate the motor speed control board.',
        array['Module 1','Repair','Motor']::text[],
        7,
        '1167975905',
        '9f0f8520f1',
        'https://player.vimeo.com/video/1167975905?h=9f0f8520f1&dnt=1'
      ),
      (
        'd733f400-9e4a-45ea-8a8c-0fb3d3400008'::uuid,
        'Replace Forward/Reverse Control Board (Motor Direction)',
        'Replace board controlling motor forward/reverse direction.',
        array['Module 1','Repair','Motor']::text[],
        8,
        '1167975854',
        '145b42ad01',
        'https://player.vimeo.com/video/1167975854?h=145b42ad01&dnt=1'
      ),
      (
        'd733f400-9e4a-45ea-8a8c-0fb3d3400009'::uuid,
        'Reinstall Burner Cover (Correct Fit & Orientation)',
        'Correctly reinstall burner cover and verify orientation.',
        array['Module 1','Maintenance','Burner']::text[],
        9,
        '1167975824',
        '3e04d63847',
        'https://player.vimeo.com/video/1167975824?h=3e04d63847&dnt=1'
      ),
      (
        'd733f400-9e4a-45ea-8a8c-0fb3d3400010'::uuid,
        'Install Bill Validator (Cash Acceptance Module)',
        'Install the bill validator module and validate acceptance.',
        array['Module 1','Hardware','Payments']::text[],
        10,
        '1167975716',
        'ba3b2ab6bc',
        'https://player.vimeo.com/video/1167975716?h=ba3b2ab6bc&dnt=1'
      ),
      (
        'd733f400-9e4a-45ea-8a8c-0fb3d3400011'::uuid,
        'Install/Remove Remote Module (Connectivity/Telemetry)',
        'Install or remove remote connectivity/telemetry module.',
        array['Module 1','Connectivity','Hardware']::text[],
        11,
        '1167975670',
        'b66c8ce52e',
        'https://player.vimeo.com/video/1167975670?h=b66c8ce52e&dnt=1'
      ),
      (
        'd733f400-9e4a-45ea-8a8c-0fb3d3400012'::uuid,
        'Assembly & Reassembly Walkthrough',
        'Full walkthrough for assembly and reassembly.',
        array['Module 1','Assembly','Maintenance']::text[],
        12,
        '1167975492',
        '08ec8594c8',
        'https://player.vimeo.com/video/1167975492?h=08ec8594c8&dnt=1'
      ),
      (
        'd733f400-9e4a-45ea-8a8c-0fb3d3400013'::uuid,
        'Using a Multimeter: DC Voltage Mode (Basics)',
        'Basics of DC voltage measurement with a multimeter.',
        array['Module 1','Electrical','Diagnostics']::text[],
        13,
        '1167975481',
        '2ca6d4c0ab',
        'https://player.vimeo.com/video/1167975481?h=2ca6d4c0ab&dnt=1'
      ),
      (
        'd733f400-9e4a-45ea-8a8c-0fb3d3400014'::uuid,
        'Burner Maintenance: Clean the Burner Cover',
        'How to clean and maintain burner cover components.',
        array['Module 1','Maintenance','Burner']::text[],
        14,
        '1167975465',
        'b1174c9e66',
        'https://player.vimeo.com/video/1167975465?h=b1174c9e66&dnt=1'
      ),
      (
        'd733f400-9e4a-45ea-8a8c-0fb3d3400015'::uuid,
        'Burner Maintenance: Clean the Burner Base',
        'How to clean and maintain burner base components.',
        array['Module 1','Maintenance','Burner']::text[],
        15,
        '1167975334',
        '36cbc4e97f',
        'https://player.vimeo.com/video/1167975334?h=36cbc4e97f&dnt=1'
      ),
      (
        'd733f400-9e4a-45ea-8a8c-0fb3d3400016'::uuid,
        'Safety Check: Verify Ground/Earth Connection',
        'Verify proper ground/earth continuity before operation.',
        array['Module 1','Safety','Electrical']::text[],
        16,
        '1167975282',
        'c14648a973',
        'https://player.vimeo.com/video/1167975282?h=c14648a973&dnt=1'
      ),
      (
        'd733f400-9e4a-45ea-8a8c-0fb3d3400017'::uuid,
        'Using a Multimeter: AC Voltage Mode (Basics)',
        'Basics of AC voltage measurement with a multimeter.',
        array['Module 1','Electrical','Diagnostics']::text[],
        17,
        '1167975174',
        '270ecbf728',
        'https://player.vimeo.com/video/1167975174?h=270ecbf728&dnt=1'
      )
  ) as t(training_id, title, description, tags, sort_order, video_id, video_hash, embed_url)
)
insert into public.trainings (
  id,
  title,
  description,
  tags,
  duration_seconds,
  visibility,
  sort_order
)
select
  training_id,
  title,
  description,
  tags,
  null,
  'members_only'::training_visibility,
  sort_order
from vimeo_module1
on conflict (id) do update
set
  title = excluded.title,
  description = excluded.description,
  tags = excluded.tags,
  duration_seconds = excluded.duration_seconds,
  visibility = excluded.visibility,
  sort_order = excluded.sort_order;

with vimeo_module1 as (
  select *
  from (
    values
      ('d733f400-9e4a-45ea-8a8c-0fb3d3400001'::uuid, '1167976486'::text, 'e32f9c0bb1'::text, 'https://player.vimeo.com/video/1167976486?h=e32f9c0bb1&dnt=1'::text, 'Unlock Admin/Service Mode (UI Access)'::text),
      ('d733f400-9e4a-45ea-8a8c-0fb3d3400002'::uuid, '1167976439', '1afa672007', 'https://player.vimeo.com/video/1167976439?h=1afa672007&dnt=1', 'Start-Up & Shutdown Procedure (Safe Power Cycle)'),
      ('d733f400-9e4a-45ea-8a8c-0fb3d3400003'::uuid, '1167976252', 'f57db252b9', 'https://player.vimeo.com/video/1167976252?h=f57db252b9&dnt=1', 'Configure Coin Acceptor (Calibration/Setup)'),
      ('d733f400-9e4a-45ea-8a8c-0fb3d3400004'::uuid, '1167976115', 'b0318e7049', 'https://player.vimeo.com/video/1167976115?h=b0318e7049&dnt=1', 'Replace advertising video'),
      ('d733f400-9e4a-45ea-8a8c-0fb3d3400005'::uuid, '1167976086', 'b2bc9cd54e', 'https://player.vimeo.com/video/1167976086?h=b2bc9cd54e&dnt=1', 'Daily Maintenance Routine'),
      ('d733f400-9e4a-45ea-8a8c-0fb3d3400006'::uuid, '1167975956', 'ce17db4131', 'https://player.vimeo.com/video/1167975956?h=ce17db4131&dnt=1', 'Install Cash Dispenser / Money Box Module'),
      ('d733f400-9e4a-45ea-8a8c-0fb3d3400007'::uuid, '1167975905', '9f0f8520f1', 'https://player.vimeo.com/video/1167975905?h=9f0f8520f1&dnt=1', 'Replace Speed Control Board (Motor Speed)'),
      ('d733f400-9e4a-45ea-8a8c-0fb3d3400008'::uuid, '1167975854', '145b42ad01', 'https://player.vimeo.com/video/1167975854?h=145b42ad01&dnt=1', 'Replace Forward/Reverse Control Board (Motor Direction)'),
      ('d733f400-9e4a-45ea-8a8c-0fb3d3400009'::uuid, '1167975824', '3e04d63847', 'https://player.vimeo.com/video/1167975824?h=3e04d63847&dnt=1', 'Reinstall Burner Cover (Correct Fit & Orientation)'),
      ('d733f400-9e4a-45ea-8a8c-0fb3d3400010'::uuid, '1167975716', 'ba3b2ab6bc', 'https://player.vimeo.com/video/1167975716?h=ba3b2ab6bc&dnt=1', 'Install Bill Validator (Cash Acceptance Module)'),
      ('d733f400-9e4a-45ea-8a8c-0fb3d3400011'::uuid, '1167975670', 'b66c8ce52e', 'https://player.vimeo.com/video/1167975670?h=b66c8ce52e&dnt=1', 'Install/Remove Remote Module (Connectivity/Telemetry)'),
      ('d733f400-9e4a-45ea-8a8c-0fb3d3400012'::uuid, '1167975492', '08ec8594c8', 'https://player.vimeo.com/video/1167975492?h=08ec8594c8&dnt=1', 'Assembly & Reassembly Walkthrough'),
      ('d733f400-9e4a-45ea-8a8c-0fb3d3400013'::uuid, '1167975481', '2ca6d4c0ab', 'https://player.vimeo.com/video/1167975481?h=2ca6d4c0ab&dnt=1', 'Using a Multimeter: DC Voltage Mode (Basics)'),
      ('d733f400-9e4a-45ea-8a8c-0fb3d3400014'::uuid, '1167975465', 'b1174c9e66', 'https://player.vimeo.com/video/1167975465?h=b1174c9e66&dnt=1', 'Burner Maintenance: Clean the Burner Cover'),
      ('d733f400-9e4a-45ea-8a8c-0fb3d3400015'::uuid, '1167975334', '36cbc4e97f', 'https://player.vimeo.com/video/1167975334?h=36cbc4e97f&dnt=1', 'Burner Maintenance: Clean the Burner Base'),
      ('d733f400-9e4a-45ea-8a8c-0fb3d3400016'::uuid, '1167975282', 'c14648a973', 'https://player.vimeo.com/video/1167975282?h=c14648a973&dnt=1', 'Safety Check: Verify Ground/Earth Connection'),
      ('d733f400-9e4a-45ea-8a8c-0fb3d3400017'::uuid, '1167975174', '270ecbf728', 'https://player.vimeo.com/video/1167975174?h=270ecbf728&dnt=1', 'Using a Multimeter: AC Voltage Mode (Basics)')
  ) as t(training_id, video_id, video_hash, embed_url, video_title)
)
delete from public.training_assets ta
using vimeo_module1 vm
where ta.training_id = vm.training_id
  and ta.asset_type = 'video';

with vimeo_module1 as (
  select *
  from (
    values
      ('d733f400-9e4a-45ea-8a8c-0fb3d3400001'::uuid, '1167976486'::text, 'e32f9c0bb1'::text, 'https://player.vimeo.com/video/1167976486?h=e32f9c0bb1&dnt=1'::text, 'Unlock Admin/Service Mode (UI Access)'::text),
      ('d733f400-9e4a-45ea-8a8c-0fb3d3400002'::uuid, '1167976439', '1afa672007', 'https://player.vimeo.com/video/1167976439?h=1afa672007&dnt=1', 'Start-Up & Shutdown Procedure (Safe Power Cycle)'),
      ('d733f400-9e4a-45ea-8a8c-0fb3d3400003'::uuid, '1167976252', 'f57db252b9', 'https://player.vimeo.com/video/1167976252?h=f57db252b9&dnt=1', 'Configure Coin Acceptor (Calibration/Setup)'),
      ('d733f400-9e4a-45ea-8a8c-0fb3d3400004'::uuid, '1167976115', 'b0318e7049', 'https://player.vimeo.com/video/1167976115?h=b0318e7049&dnt=1', 'Replace advertising video'),
      ('d733f400-9e4a-45ea-8a8c-0fb3d3400005'::uuid, '1167976086', 'b2bc9cd54e', 'https://player.vimeo.com/video/1167976086?h=b2bc9cd54e&dnt=1', 'Daily Maintenance Routine'),
      ('d733f400-9e4a-45ea-8a8c-0fb3d3400006'::uuid, '1167975956', 'ce17db4131', 'https://player.vimeo.com/video/1167975956?h=ce17db4131&dnt=1', 'Install Cash Dispenser / Money Box Module'),
      ('d733f400-9e4a-45ea-8a8c-0fb3d3400007'::uuid, '1167975905', '9f0f8520f1', 'https://player.vimeo.com/video/1167975905?h=9f0f8520f1&dnt=1', 'Replace Speed Control Board (Motor Speed)'),
      ('d733f400-9e4a-45ea-8a8c-0fb3d3400008'::uuid, '1167975854', '145b42ad01', 'https://player.vimeo.com/video/1167975854?h=145b42ad01&dnt=1', 'Replace Forward/Reverse Control Board (Motor Direction)'),
      ('d733f400-9e4a-45ea-8a8c-0fb3d3400009'::uuid, '1167975824', '3e04d63847', 'https://player.vimeo.com/video/1167975824?h=3e04d63847&dnt=1', 'Reinstall Burner Cover (Correct Fit & Orientation)'),
      ('d733f400-9e4a-45ea-8a8c-0fb3d3400010'::uuid, '1167975716', 'ba3b2ab6bc', 'https://player.vimeo.com/video/1167975716?h=ba3b2ab6bc&dnt=1', 'Install Bill Validator (Cash Acceptance Module)'),
      ('d733f400-9e4a-45ea-8a8c-0fb3d3400011'::uuid, '1167975670', 'b66c8ce52e', 'https://player.vimeo.com/video/1167975670?h=b66c8ce52e&dnt=1', 'Install/Remove Remote Module (Connectivity/Telemetry)'),
      ('d733f400-9e4a-45ea-8a8c-0fb3d3400012'::uuid, '1167975492', '08ec8594c8', 'https://player.vimeo.com/video/1167975492?h=08ec8594c8&dnt=1', 'Assembly & Reassembly Walkthrough'),
      ('d733f400-9e4a-45ea-8a8c-0fb3d3400013'::uuid, '1167975481', '2ca6d4c0ab', 'https://player.vimeo.com/video/1167975481?h=2ca6d4c0ab&dnt=1', 'Using a Multimeter: DC Voltage Mode (Basics)'),
      ('d733f400-9e4a-45ea-8a8c-0fb3d3400014'::uuid, '1167975465', 'b1174c9e66', 'https://player.vimeo.com/video/1167975465?h=b1174c9e66&dnt=1', 'Burner Maintenance: Clean the Burner Cover'),
      ('d733f400-9e4a-45ea-8a8c-0fb3d3400015'::uuid, '1167975334', '36cbc4e97f', 'https://player.vimeo.com/video/1167975334?h=36cbc4e97f&dnt=1', 'Burner Maintenance: Clean the Burner Base'),
      ('d733f400-9e4a-45ea-8a8c-0fb3d3400016'::uuid, '1167975282', 'c14648a973', 'https://player.vimeo.com/video/1167975282?h=c14648a973&dnt=1', 'Safety Check: Verify Ground/Earth Connection'),
      ('d733f400-9e4a-45ea-8a8c-0fb3d3400017'::uuid, '1167975174', '270ecbf728', 'https://player.vimeo.com/video/1167975174?h=270ecbf728&dnt=1', 'Using a Multimeter: AC Voltage Mode (Basics)')
  ) as t(training_id, video_id, video_hash, embed_url, video_title)
)
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
select
  training_id,
  'video'::training_asset_type,
  'vimeo'::training_provider,
  video_id,
  video_hash,
  embed_url,
  null,
  jsonb_build_object('title', video_title)
from vimeo_module1;
