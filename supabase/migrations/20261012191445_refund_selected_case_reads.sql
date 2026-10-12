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
-- Keep authorized customer search without transporting whole evidence histories.
alter function public.get_refund_portal_queue_projection(timestamptz)
 rename to get_refund_portal_queue_pre_search_v1;
revoke all on function public.get_refund_portal_queue_pre_search_v1(timestamptz)
 from public,anon,authenticated,service_role;
create function public.get_refund_portal_queue_projection(p_observed_at timestamptz default statement_timestamp())
returns jsonb language plpgsql stable security definer set search_path='' set statement_timeout='8s'
as $function$
declare base jsonb; items jsonb;
begin
 base:=public.get_refund_portal_queue_pre_search_v1(p_observed_at);
 select coalesce(jsonb_agg(item.value || jsonb_build_object('searchText',
   concat_ws(' ',c.customer_email,c.customer_name,c.issue_summary)) order by item.ordinality),'[]'::jsonb)
 into items from jsonb_array_elements(base->'items') with ordinality item
 join public.refund_cases c on c.id=(item.value->>'caseId')::uuid;
 return jsonb_set(base,'{items}',items,true);
end;
$function$;
revoke all on function public.get_refund_portal_queue_projection(timestamptz) from public,anon,service_role;
grant execute on function public.get_refund_portal_queue_projection(timestamptz) to authenticated;
select pg_notify('pgrst','reload schema');
commit;
