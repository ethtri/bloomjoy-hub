-- Align the restored Super Admin revoke RPC with the execute-grant hardening
-- invariant applied to existing security-definer functions.

alter function public.admin_revoke_super_admin(uuid, text)
  set search_path = public;

grant execute on function public.admin_revoke_super_admin(uuid, text)
  to service_role;

select pg_notify('pgrst', 'reload schema');
