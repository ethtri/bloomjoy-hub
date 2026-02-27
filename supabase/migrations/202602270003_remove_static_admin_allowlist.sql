-- Remove temporary static admin email bypass and rely on DB roles only.

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
