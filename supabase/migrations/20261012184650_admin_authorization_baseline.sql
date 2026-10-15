-- Authorization prerequisite for #1856. Preserve the scheduler's internal
-- service context and existing RPC contracts while requiring a definite result.
begin;

create or replace function public.is_super_admin(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select coalesce((
    current_setting('app.partner_report_scheduler_scope', true) = 'service_role'
    and auth.role() = 'service_role'
  ), false)
  or exists (
    select 1 from public.admin_roles ar
    where ar.user_id = uid and ar.role = 'super_admin' and ar.active = true
  );
$$;

-- Patch only the entry guard of these established RPCs. Reusing their current
-- definitions preserves business logic, signatures, defaults and execute ACLs.
-- Abort the transaction if the expected catalogue differs; never skip a repair.
do $migration$
declare
  signature text;
  definition text;
  patched text;
  guard text;
begin
  foreach signature in array array[
    'public.admin_grant_super_admin_by_email(text,text)',
    'public.admin_list_super_admin_roles()',
    'public.admin_revoke_super_admin(uuid,text)',
    'public.admin_grant_scoped_admin_by_email(text,uuid[],text)',
    'public.admin_list_scoped_admin_grants()',
    'public.admin_revoke_scoped_admin(uuid,text)',
    'public.admin_create_scoped_admin_invite(text,uuid[],text,timestamp with time zone)',
    'public.admin_list_scoped_admin_invites()',
    'public.admin_revoke_scoped_admin_invite(uuid,text)'
  ] loop
    select pg_get_functiondef(signature::regprocedure) into definition;
    guard := case when signature like '%scoped_admin_invite%'
      then 'if actor_user_id is null or not public.is_super_admin(actor_user_id) then'
      else 'if not public.is_super_admin(auth.uid()) then' end;
    if (length(definition) - length(replace(definition, guard, ''))) / length(guard) <> 1 then
      raise exception 'Unexpected administration RPC catalogue: %', signature;
    end if;
    patched := replace(definition, guard,
      case when signature like '%scoped_admin_invite%'
        then 'if actor_user_id is null or public.is_super_admin(actor_user_id) is not true then'
        else 'if auth.uid() is null or public.is_super_admin(auth.uid()) is not true then' end);
    execute patched;
  end loop;
end;
$migration$;

commit;
