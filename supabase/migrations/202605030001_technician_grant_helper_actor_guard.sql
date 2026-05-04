-- Issue #379: keep the Technician grant RLS helper callable by policies, but
-- prevent authenticated callers from probing access for arbitrary user IDs.

create or replace function public.can_access_technician_grant(
  p_user_id uuid,
  p_technician_grant_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select p_user_id is not null
    and p_user_id = (select auth.uid())
    and p_technician_grant_id is not null
    and (
      public.is_super_admin(p_user_id)
      or exists (
        select 1
        from public.technician_grants grant_row
        left join auth.users auth_user on auth_user.id = p_user_id
        where grant_row.id = p_technician_grant_id
          and (
            (
              grant_row.sponsor_user_id = p_user_id
              and (
                grant_row.sponsor_type <> 'corporate_partner'
                or public.can_manage_corporate_partner_technician_grant(
                  p_user_id,
                  grant_row.id,
                  null
                )
              )
            )
            or grant_row.technician_user_id = p_user_id
            or lower(grant_row.technician_email) = lower(auth_user.email)
            or public.can_manage_corporate_partner_technician_grant(
              p_user_id,
              grant_row.id,
              null
            )
          )
      )
    );
$$;

comment on function public.can_access_technician_grant(uuid, uuid) is
  'Caller-bound RLS helper for Technician grant visibility; authenticated callers cannot test access for arbitrary users.';

revoke execute on function public.can_access_technician_grant(uuid, uuid)
  from public, anon;
grant execute on function public.can_access_technician_grant(uuid, uuid)
  to authenticated;

select pg_notify('pgrst', 'reload schema');
