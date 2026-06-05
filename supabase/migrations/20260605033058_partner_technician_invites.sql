-- Issues #492/#493: allow partner and account owners to send/review
-- Technician invite evidence only for grants they can already manage.

create or replace function public.can_send_technician_access_invite(
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
    and p_technician_grant_id is not null
    and (
      auth.role() = 'service_role'
      or p_user_id = (select auth.uid())
    )
    and exists (
      select 1
      from public.technician_grants grant_row
      where grant_row.id = p_technician_grant_id
        and public.technician_grant_is_active(
          grant_row.starts_at,
          grant_row.expires_at,
          grant_row.revoked_at,
          grant_row.status
        )
        and (
          public.is_super_admin(p_user_id)
          or (
            grant_row.sponsor_type = 'plus_customer_account'
            and grant_row.sponsor_user_id = p_user_id
          )
          or (
            grant_row.sponsor_type = 'plus_customer_account'
            and public.has_plus_access(p_user_id)
            and exists (
              select 1
              from public.customer_account_memberships membership
              where membership.account_id = grant_row.account_id
                and membership.user_id = p_user_id
                and membership.active
                and membership.role = 'owner'
            )
          )
          or public.can_manage_corporate_partner_technician_grant(
            p_user_id,
            grant_row.id,
            null
          )
        )
    );
$$;

comment on function public.can_send_technician_access_invite(uuid, uuid) is
  'Returns true when the actor may send or view invite evidence for an active Technician grant they manage.';

drop policy if exists "access_invite_deliveries_select_technician_managers"
  on public.access_invite_deliveries;
create policy "access_invite_deliveries_select_technician_managers"
on public.access_invite_deliveries
for select
to authenticated
using (
  invite_type = 'technician'
  and source_type = 'technician_grant'
  and public.can_send_technician_access_invite((select auth.uid()), source_id)
);

revoke execute on function public.can_send_technician_access_invite(uuid, uuid)
  from public, anon;
grant execute on function public.can_send_technician_access_invite(uuid, uuid)
  to authenticated, service_role;

select pg_notify('pgrst', 'reload schema');
