-- Allow admin/testing accounts to access members_only training records.

create or replace function public.can_access_members_only_training()
returns boolean
language sql
stable
as $$
  select
    exists (
      select 1
      from public.subscriptions s
      where s.user_id = auth.uid()
        and s.status in ('active', 'trialing')
        and (s.current_period_end is null or s.current_period_end > now())
    )
    or lower(coalesce(auth.jwt() ->> 'email', '')) in (
      'etrifari@bloomjoysweets.com',
      'ethtri@gmail.com'
    );
$$;

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
