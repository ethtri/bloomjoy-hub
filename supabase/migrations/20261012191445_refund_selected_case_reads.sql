-- Keep the existing full overview compatible, but scope its expensive evidence
-- and projection chain before it starts when reading one protected case.
begin;
do $migration$
declare
 definition text := replace(pg_catalog.pg_get_functiondef(
  'public.admin_get_refund_operations_overview_raw_20260721()'::regprocedure), E'\r\n', E'\n');
 anchor text := 'where public.can_manage_refund_case(actor_user_id, refund_case.id)';
begin
 if length(definition)-length(replace(definition,anchor,'')) <> length(anchor) then
  raise exception 'Expected unique authorized refund case reader changed';
 end if;
 execute replace(definition,anchor,anchor || $scope$
        and (nullif(current_setting('bloomjoy.refund_read_case_id',true),'') is null
          or refund_case.id::text=current_setting('bloomjoy.refund_read_case_id',true))$scope$);
end;
$migration$;

create function public.get_refund_portal_case_detail(p_case_id uuid)
returns jsonb language plpgsql security definer set search_path=''
set statement_timeout='8s'
as $function$
declare
 previous_scope text:=current_setting('bloomjoy.refund_read_case_id',true);
 result jsonb;
begin
 if auth.uid() is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,false)
   or p_case_id is null or not public.can_manage_refund_case(auth.uid(),p_case_id) then
  raise exception 'Current refund case access required' using errcode='42501';
 end if;
 perform set_config('bloomjoy.refund_read_case_id',p_case_id::text,true);
 result:=public.admin_get_refund_operations_overview();
 perform set_config('bloomjoy.refund_read_case_id',coalesce(previous_scope,''),true);
 -- Guard the boundary even if a future overview stage introduces another row.
 if exists(select 1 from jsonb_array_elements(coalesce(result->'cases','[]')) item
   where item->>'id' is distinct from p_case_id::text)
   or exists(select 1 from jsonb_array_elements(coalesce(result->'internalTestCases','[]')) item
   where item->>'id' is distinct from p_case_id::text) then
  raise exception 'Unsupported selected refund case contract' using errcode='P4652';
 end if;
 return result;
exception when others then
 perform set_config('bloomjoy.refund_read_case_id',coalesce(previous_scope,''),true);
 raise;
end;
$function$;
revoke all on function public.get_refund_portal_case_detail(uuid) from public,anon,service_role;
grant execute on function public.get_refund_portal_case_detail(uuid) to authenticated;

-- The canonical contract produces nextWork already. Manager redaction changes
-- neither its actor nor action. Avoid preparing/researching every queue case a
-- second time; malformed/old contracts retain the exact previous reader.
do $migration$
declare definition text:=pg_get_functiondef('public.get_refund_lifecycle_for_manager(uuid)'::regprocedure);
begin
 if strpos(definition,'refund_next_work_for_case')=0 or
   strpos(definition,'get_refund_lifecycle_for_manager_pre_next_work_v1')=0 then
  raise exception 'Expected Manager lifecycle read boundary changed';
 end if;
 execute replace(definition,'FUNCTION public.get_refund_lifecycle_for_manager(',
   'FUNCTION private.refund_manager_lifecycle_pre_read_v1(');
end;
$migration$;
revoke all on function private.refund_manager_lifecycle_pre_read_v1(uuid) from public,anon,authenticated,service_role;
create or replace function public.get_refund_lifecycle_for_manager(p_refund_case_id uuid)
returns jsonb language plpgsql stable security definer set search_path=''
as $function$
declare base jsonb;
begin
 base:=public.get_refund_lifecycle_for_manager_pre_next_work_v1(p_refund_case_id);
 if base->>'schemaVersion'='refund_lifecycle_v2' and base->>'payloadRedacted'='true'
   and base#>>'{nextWork,schemaVersion}'='refund_next_work_v1'
   and base#>>'{nextWork,payloadRedacted}'='true'
   and jsonb_typeof(base#>'{nextWork,isOpen}')='boolean'
   and base#>>'{nextWork,actor}' in ('manager','system','agent','customer') then
  return base;
 end if;
 return private.refund_manager_lifecycle_pre_read_v1(p_refund_case_id);
end;
$function$;
revoke all on function public.get_refund_lifecycle_for_manager(uuid) from public,anon,service_role;
grant execute on function public.get_refund_lifecycle_for_manager(uuid) to authenticated;
-- Return only authorized matches; the lightweight queue stays free of customer
-- text, while the existing name/email/comment search remains useful.
create function public.search_refund_portal_queue(p_query text)
returns jsonb language plpgsql stable security definer set search_path='' set statement_timeout='8s'
as $function$
begin
 if auth.uid() is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,false)
   or not (public.is_super_admin(auth.uid()) or public.is_scoped_admin(auth.uid())
     or public.user_is_refund_manager(auth.uid())) then
  raise exception 'Refund operations access required' using errcode='42501';
 end if;
 if nullif(btrim(p_query),'') is null then return '[]'::jsonb; end if;
 return coalesce((select jsonb_agg(c.id order by c.created_at,c.id)
  from public.refund_cases c where public.can_manage_refund_case(auth.uid(),c.id)
   and (c.case_population='customer' or public.is_super_admin(auth.uid()) or public.is_scoped_admin(auth.uid()))
   and strpos(lower(concat_ws(' ',c.public_reference,c.customer_email,c.customer_name,c.issue_summary)),
     lower(btrim(p_query)))>0),'[]'::jsonb);
end;
$function$;
revoke all on function public.search_refund_portal_queue(text) from public,anon,service_role;
grant execute on function public.search_refund_portal_queue(text) to authenticated;
select pg_notify('pgrst','reload schema');
commit;
