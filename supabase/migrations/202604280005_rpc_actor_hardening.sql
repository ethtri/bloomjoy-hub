-- Harden legacy account/operator RPCs reported in issue #290.
--
-- The legacy account RPCs below are SECURITY DEFINER functions that accept
-- caller-supplied actor/user IDs. Current browser-callable access should stay
-- on auth.uid()-bound wrappers such as get_my_portal_access_context(),
-- get_portal_access_context(), can_access_plus_portal(), and
-- can_access_members_only_training().

revoke execute on function public.create_customer_account_invite_as_actor(uuid, text, text, text)
  from public, anon, authenticated;
revoke execute on function public.record_customer_account_invite_delivery_as_actor(uuid, uuid, text)
  from public, anon, authenticated;
revoke execute on function public.revoke_customer_account_access_as_actor(uuid, uuid, uuid, text)
  from public, anon, authenticated;

grant execute on function public.create_customer_account_invite_as_actor(uuid, text, text, text)
  to service_role;
grant execute on function public.record_customer_account_invite_delivery_as_actor(uuid, uuid, text)
  to service_role;
grant execute on function public.revoke_customer_account_access_as_actor(uuid, uuid, uuid, text)
  to service_role;

create or replace function public.has_my_active_customer_account_membership(p_account_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select public.has_active_customer_account_membership(auth.uid(), p_account_id);
$$;

create or replace function public.is_my_partner_on_customer_account(p_account_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select public.is_partner_on_customer_account(auth.uid(), p_account_id);
$$;

revoke execute on function public.has_my_active_customer_account_membership(uuid)
  from public, anon;
revoke execute on function public.is_my_partner_on_customer_account(uuid)
  from public, anon;

grant execute on function public.has_my_active_customer_account_membership(uuid)
  to authenticated, service_role;
grant execute on function public.is_my_partner_on_customer_account(uuid)
  to authenticated, service_role;

drop policy if exists "customer_accounts_select_member_or_admin" on public.customer_accounts;
create policy "customer_accounts_select_member_or_admin"
on public.customer_accounts
for select
to authenticated
using (
  public.is_super_admin(auth.uid())
  or public.has_my_active_customer_account_membership(id)
);

drop policy if exists "customer_account_memberships_select_partner_or_self" on public.customer_account_memberships;
create policy "customer_account_memberships_select_partner_or_self"
on public.customer_account_memberships
for select
to authenticated
using (
  user_id = auth.uid()
  or public.is_super_admin(auth.uid())
  or public.is_my_partner_on_customer_account(account_id)
);

drop policy if exists "customer_account_invites_select_partner_or_admin" on public.customer_account_invites;
create policy "customer_account_invites_select_partner_or_admin"
on public.customer_account_invites
for select
to authenticated
using (
  public.is_super_admin(auth.uid())
  or public.is_my_partner_on_customer_account(account_id)
);

revoke execute on function public.has_active_customer_account_membership(uuid, uuid)
  from public, anon, authenticated;
revoke execute on function public.is_partner_on_customer_account(uuid, uuid)
  from public, anon, authenticated;
revoke execute on function public.get_active_customer_account_id(uuid)
  from public, anon, authenticated;
revoke execute on function public.get_active_customer_account_role(uuid)
  from public, anon, authenticated;
revoke execute on function public.get_portal_access_tier_for_user(uuid)
  from public, anon, authenticated;
revoke execute on function public.can_manage_customer_account_operators_for_user(uuid)
  from public, anon, authenticated;
revoke execute on function public.get_portal_access_context_for_user(uuid)
  from public, anon, authenticated;
revoke execute on function public.can_access_plus_portal_for_user(uuid)
  from public, anon, authenticated;

grant execute on function public.has_active_customer_account_membership(uuid, uuid)
  to service_role;
grant execute on function public.is_partner_on_customer_account(uuid, uuid)
  to service_role;
grant execute on function public.get_active_customer_account_id(uuid)
  to service_role;
grant execute on function public.get_active_customer_account_role(uuid)
  to service_role;
grant execute on function public.get_portal_access_tier_for_user(uuid)
  to service_role;
grant execute on function public.can_manage_customer_account_operators_for_user(uuid)
  to service_role;
grant execute on function public.get_portal_access_context_for_user(uuid)
  to service_role;
grant execute on function public.can_access_plus_portal_for_user(uuid)
  to service_role;

grant execute on function public.get_portal_access_context()
  to authenticated, service_role;
grant execute on function public.can_access_plus_portal()
  to authenticated, service_role;
grant execute on function public.can_access_members_only_training()
  to authenticated, service_role;
grant execute on function public.accept_customer_account_invite()
  to authenticated, service_role;
grant execute on function public.get_my_portal_access_context()
  to authenticated, service_role;

comment on function public.create_customer_account_invite_as_actor(uuid, text, text, text) is
  'Legacy service-role-only account invite RPC. Browser callers must not pass actor user IDs.';
comment on function public.record_customer_account_invite_delivery_as_actor(uuid, uuid, text) is
  'Legacy service-role-only invite delivery RPC. Browser callers must not pass actor user IDs.';
comment on function public.revoke_customer_account_access_as_actor(uuid, uuid, uuid, text) is
  'Legacy service-role-only account access revoke RPC. Browser callers must not pass actor user IDs.';
comment on function public.has_my_active_customer_account_membership(uuid) is
  'Auth.uid-bound customer-account membership helper for browser-facing RLS checks.';
comment on function public.is_my_partner_on_customer_account(uuid) is
  'Auth.uid-bound customer-account partner helper for browser-facing RLS checks.';
comment on function public.get_portal_access_context_for_user(uuid) is
  'Service-role/internal helper for arbitrary-user portal access checks. Browser callers should use get_my_portal_access_context() or get_portal_access_context().';

select pg_notify('pgrst', 'reload schema');
