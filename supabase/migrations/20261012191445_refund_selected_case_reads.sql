-- Keep the existing full overview compatible, but scope its expensive evidence
-- and projection chain before it starts when reading one protected case.
begin;
do $migration$
declare
 signature text; definition text; anchor text;
begin
 foreach signature in array array[
  'public.admin_get_refund_operations_overview_raw_20260721()',
  'public.admin_get_refund_operations_overview_pre_durable_lifecycle_v1()'
 ] loop
 definition:=replace(pg_catalog.pg_get_functiondef(signature::regprocedure),E'\r\n',E'\n');
 anchor:=case when signature like '%raw_20260721%'
  then 'where public.can_manage_refund_case(actor_user_id, refund_case.id)'
  else 'and public.can_manage_refund_case(actor_user_id, refund_case.id)' end;
 if length(definition)-length(replace(definition,anchor,'')) <> length(anchor) then
  raise exception 'Expected unique authorized refund case reader changed: %',signature;
 end if;
 execute replace(definition,anchor,anchor || $scope$
        and (nullif(current_setting('bloomjoy.refund_read_case_id',true),'') is null
          or refund_case.id::text=current_setting('bloomjoy.refund_read_case_id',true))$scope$);
 end loop;
end;
$migration$;

-- Unresolved reviewed pairs have no exact machine yet. The queue replaces the
-- full overview as its list source, so retain these existing authorized cases.
-- Generic machine-null drafts remain in their established supplement reader.
do $migration$
declare
 definition text:=replace(pg_get_functiondef(
  'public.get_refund_portal_queue_projection_pre_company_v1(timestamptz)'::regprocedure),E'\r\n',E'\n');
 anchor text;
begin
 anchor:='    join public.reporting_machines machine';
 if cardinality(string_to_array(definition,anchor))<>2 then
  raise exception 'Expected unique queue machine join changed';
 end if;
 definition:=replace(definition,anchor,'    left join public.reporting_machines machine');
 anchor:='where public.can_manage_refund_case(actor_user_id, refund_case.id)';
 if cardinality(string_to_array(definition,anchor))<>2 then
  raise exception 'Expected unique queue authority changed';
 end if;
 definition:=replace(definition,anchor,anchor||$pair_scope$
      and (machine.id is not null or (refund_case.reporting_machine_id is null
        and refund_case.intake_selection_kind='livermore_pair'
        and refund_case.intake_selection_key=public.refund_livermore_selection_key()
        and refund_case.intake_selection_machine_ids=public.refund_livermore_selection_machine_ids()))$pair_scope$);
 anchor:='      machine.refund_public_display_label,';
 if cardinality(string_to_array(definition,anchor))<>2 then
  raise exception 'Expected unique queue display label changed';
 end if;
 definition:=replace(definition,anchor,$label$
      case when refund_case.reporting_machine_id is null
        and refund_case.intake_selection_kind='livermore_pair'
        then 'San Francisco Premium Outlets â€” Cotton candy'
        else machine.refund_public_display_label end as refund_public_display_label,$label$);
 execute definition;
end;
$migration$;

-- A valid unresolved pair shares the canonical reporting location/company.
-- Use that exact current authority for company filtering until machine choice.
do $migration$
declare definition text:=replace(pg_get_functiondef(
 'private.refund_add_current_company(jsonb,text)'::regprocedure),E'\r\n',E'\n');
 anchor text:='  left join public.customer_accounts a on a.id=m.account_id;';
begin
 if cardinality(string_to_array(definition,anchor))<>2 then
  raise exception 'Expected unique current company join changed';
 end if;
 definition:=replace(definition,anchor,$company$
  left join public.reporting_locations location on location.id=c.reporting_location_id
    and c.reporting_machine_id is null and c.intake_selection_kind='livermore_pair'
    and c.intake_selection_key=public.refund_livermore_selection_key()
    and c.intake_selection_machine_ids=public.refund_livermore_selection_machine_ids()
  left join public.customer_accounts a on a.id=coalesce(m.account_id,location.account_id);$company$);
 definition:=replace(definition,'''accountId'',m.account_id','''accountId'',coalesce(m.account_id,location.account_id)');
 execute definition;
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

-- The canonical contract usually produces final nextWork already. Cash
-- research rewrites the legacy stage after producing nextWork, so that state
-- still needs the existing outer projection. Avoid repeating equivalent work
-- for other queue cases; malformed/old contracts retain the previous reader.
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
   and base->>'reasonCode' is distinct from 'cash_purchase_research_required'
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
-- Production profiling found that enumerating 1,194 timezone names for
-- every cash digest dominated queue reads. These exact standard names are
-- validated once here; every other input retains the original live catalogue
-- membership check. Offsets/DST conversion remain runtime AT TIME ZONE work.
do $timezones$ begin
 if exists(select 1 from unnest(array['UTC','America/Los_Angeles','America/New_York',
  'America/Chicago','America/Denver','America/Phoenix','America/Indiana/Indianapolis']) fast(name)
  where not exists(select 1 from pg_catalog.pg_timezone_names() zone where zone.name=fast.name)) then
  raise exception 'Required standard timezone is not installed';
 end if;
end;$timezones$;

-- Reuse SPI plans for measured hot read predicates and catalogue readers.
-- Copy their complete authoritative SQL bodies, including current predicates,
-- volatility, definer, strictness, search_path and privileges. No matching,
-- expiry, scope, allocation or financial condition is replaced or cached.
create function private.refund_timezone_name_supported(p_name text) returns boolean language plpgsql stable set search_path='' as $$begin
if p_name in ('UTC','America/Los_Angeles','America/New_York','America/Chicago','America/Denver','America/Phoenix','America/Indiana/Indianapolis') then return true;end if;
return exists(select 1 from pg_catalog.pg_timezone_names() zone where zone.name=p_name);
end;$$;
revoke all on function private.refund_timezone_name_supported(text) from public,anon,authenticated,service_role;
do $patch$ declare signature text;definition text;anchor text:='exists(select 1 from pg_catalog.pg_timezone_names zone where zone.name=location.timezone)';begin
foreach signature in array array['public.refund_current_sunze_cash_source_key(uuid,timestamptz,timestamptz)','private.refund_snapcase_reviewed_catalog_association(uuid,uuid)'] loop
 definition:=replace(pg_get_functiondef(signature::regprocedure),E'\r\n',E'\n');
 if cardinality(string_to_array(definition,anchor))<>(case when signature like '%refund_current_sunze_cash_source_key%' then 3 else 2 end) then raise exception 'Timezone membership anchor changed';end if;
 execute replace(definition,anchor,'private.refund_timezone_name_supported(location.timezone)');
end loop;end;$patch$;
do $patch$
declare signature text; definition text; source text; replacement text;
begin
foreach signature in array array['public.refund_case_has_unresolved_reconciliation(uuid)','public.refund_reviewed_card_candidate_safe_v1(uuid,uuid)','public.is_review_safe_nayax_transaction_reference(text)'] loop
 select replace(pg_get_functiondef(p.oid),E'\r\n',E'\n'),replace(p.prosrc,E'\r\n',E'\n')
 into definition,source from pg_proc p join pg_language l on l.oid=p.prolang
 where p.oid=signature::regprocedure and l.lanname='sql' and p.prorettype='boolean'::regtype;
 if definition is null or btrim(source,E' \n\t') !~* '^select[[:space:]]' then raise exception 'Expected original boolean SQL body changed';end if;
 replacement:=btrim(source,E' \n\t');
 if right(replacement,1)=';' then replacement:=left(replacement,length(replacement)-1);end if;
 replacement:=E'\ndeclare __refund_read_result boolean;\nbegin\n'||replacement||E' into __refund_read_result;\n return __refund_read_result;\nend;\n';
 execute replace(replace(definition,'LANGUAGE sql','LANGUAGE plpgsql'),source,replacement);
end loop;
end;$patch$;
do $patch$ declare signature text;definition text;source text;replacement text;begin
foreach signature in array array['public.public_refund_machine_options()','public.public_refund_selections()'] loop
 select replace(pg_get_functiondef(p.oid),E'\r\n',E'\n'),replace(p.prosrc,E'\r\n',E'\n') into definition,source
 from pg_proc p join pg_language l on l.oid=p.prolang where p.oid=signature::regprocedure and l.lanname='sql' and p.proretset;
 if definition is null then raise exception 'Expected original public catalogue SQL body changed';end if;
 replacement:=btrim(source,E' \n\t');
 if right(replacement,1)<>';' then replacement:=replacement||';';end if;
 replacement:=E'\n#variable_conflict use_column\nbegin\n return query\n'||replacement||E'\nend;\n';
 execute replace(replace(definition,'LANGUAGE sql','LANGUAGE plpgsql'),source,replacement);
end loop;end;$patch$;
-- Only this read uses generic plans across its differently scoped queue rows.
-- PostgreSQL restores the caller's planning mode on return and on exceptions.
-- Action handlers and individual selected-case reads retain their own planning.
alter function public.get_refund_portal_queue_projection(timestamptz)
 set plan_cache_mode='force_generic_plan';
select pg_notify('pgrst','reload schema');
commit;
