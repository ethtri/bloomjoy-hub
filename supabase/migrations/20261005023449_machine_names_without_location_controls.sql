-- Presentation only: do not rewrite aliases, venues, historical facts or matching inputs.
create function private.reporting_machine_display_name(p_machine public.reporting_machines)
returns text language sql stable set search_path='' as $$
 select coalesce(nullif(btrim((p_machine).machine_display_name),''),
   nullif(btrim((p_machine).refund_public_display_label),''),(p_machine).machine_label);
$$;
create function private.reporting_location_display_name(p_name text,p_machine public.reporting_machines)
returns text language sql stable set search_path='' as $$
 select case when lower(p_name) like 'unmapped hub %' then private.reporting_machine_display_name(p_machine) else p_name end;
$$;
revoke all on function private.reporting_machine_display_name(public.reporting_machines) from public,anon,authenticated,service_role;
revoke all on function private.reporting_location_display_name(text,public.reporting_machines) from public,anon,authenticated,service_role;

-- Operates on already-authorized report output, never on matching/calculation inputs.
create function private.project_machine_report_names(p_payload jsonb)
returns jsonb language plpgsql stable set search_path='' as $$
declare key text; items jsonb;
begin
  foreach key in array array['dimensions','rows','machines','machine_periods','warnings'] loop
    if jsonb_typeof(p_payload->key) <> 'array' then continue; end if;
    select coalesce(jsonb_agg(d.item || case when m.id is null then '{}'::jsonb else
      (case when d.item ? 'machineLabel' then jsonb_build_object('machineLabel',private.reporting_machine_display_name(m)) else '{}'::jsonb end) ||
      (case when d.item ? 'machine_label' then jsonb_build_object('machine_label',private.reporting_machine_display_name(m)) else '{}'::jsonb end) ||
      (case when d.item ? 'locationName' then jsonb_build_object('locationName',private.reporting_location_display_name(d.item->>'locationName',m)) else '{}'::jsonb end) ||
      (case when d.item ? 'location_name' then jsonb_build_object('location_name',private.reporting_location_display_name(d.item->>'location_name',m)) else '{}'::jsonb end) ||
      (case when key='warnings' and nullif(d.item->>'machine_label','') is not null and d.item ? 'message'
        then jsonb_build_object('message',replace(d.item->>'message',d.item->>'machine_label',private.reporting_machine_display_name(m))) else '{}'::jsonb end)
      end order by d.ordinal),'[]'::jsonb) into items
    from jsonb_array_elements(p_payload->key) with ordinality d(item,ordinal)
    left join public.reporting_machines m on m.id=case
      when coalesce(d.item->>'machineId',d.item->>'reporting_machine_id',d.item->>'machine_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then coalesce(d.item->>'machineId',d.item->>'reporting_machine_id',d.item->>'machine_id')::uuid end;
    p_payload:=jsonb_set(p_payload,array[key],items,false);
  end loop;
  return p_payload;
end;
$$;
revoke all on function private.project_machine_report_names(jsonb) from public,anon,authenticated,service_role;

-- Modify only final display projections; leave scopes and label-based legacy matching unchanged.
do $migration$
declare signature text; definition text; needle text; pos integer;
begin
  foreach signature in array array[
    'public.get_reporting_dimensions()',
    'private.sales_report_rows_for_actor(uuid,date,date,text,uuid[],uuid[],text[])',
    'private.sales_report_legacy_rows_for_actor(uuid,date,date,text,uuid[],uuid[],text[])'
  ] loop
    definition:=replace(pg_get_functiondef(signature::regprocedure),E'\r\n',E'\n');
    needle:=E'    machine.machine_label,\n'; pos:=strpos(definition,needle);
    if pos=0 then raise exception 'Missing final machine display projection in %',signature; end if;
    definition:=overlay(definition placing E'    private.reporting_machine_display_name(machine),\n' from pos for length(needle));
    needle:=E'    location.name,\n'; pos:=strpos(definition,needle);
    if pos=0 then raise exception 'Missing final location display projection in %',signature; end if;
    definition:=overlay(definition placing E'    private.reporting_location_display_name(location.name,machine),\n' from pos for length(needle));
    execute definition;
  end loop;
  foreach signature in array array[
    'public.get_finance_reporting(date,date,uuid[],uuid[])',
    'public.get_refund_analytics(date,date,uuid[],uuid[])',
    'public.admin_preview_partner_period_report_internal(uuid,date,date,text)'
  ] loop
    definition:=replace(pg_get_functiondef(signature::regprocedure),E'\r\n',E'\n');
    if strpos(definition,'return result;')=0 then raise exception 'Missing report result in %',signature; end if;
    execute replace(definition,'return result;','return private.project_machine_report_names(result);');
  end loop;
  foreach signature in array array['public.get_finance_reporting_access()','public.get_refund_analytics_access()'] loop
    definition:=replace(pg_get_functiondef(signature::regprocedure),E'\r\n',E'\n');
    needle:='return jsonb_set(base,''{dimensions}'',dimensions,true);';
    if strpos(definition,needle)=0 then raise exception 'Missing report access projection in %',signature; end if;
    execute replace(definition,needle,'return private.project_machine_report_names(jsonb_set(base,''{dimensions}'',dimensions,true));');
  end loop;
  definition:=replace(pg_get_functiondef('public.public_refund_selections()'::regprocedure),E'\r\n',E'\n');
  needle:='current_machine.machine_display_name from public.reporting_machines current_machine';
  if strpos(definition,needle)=0 then raise exception 'Missing public name output projection'; end if;
  execute replace(definition,needle,'private.reporting_machine_display_name(current_machine) from public.reporting_machines current_machine');
end;
$migration$;

-- Assignment moves may alter legacy duplicate suppression. Preserve public selection identity.
create function private.refund_selection_membership()
returns jsonb language sql stable set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_array(selection_key,selection_kind,location_timezone,machine_id)
   order by selection_key,selection_kind,location_timezone,machine_id),'[]'::jsonb)
 from public.public_refund_selections_v2();
$$;
revoke all on function private.refund_selection_membership() from public,anon,authenticated,service_role;
do $migration$
declare definition text; needle text;
begin
  definition:=replace(pg_get_functiondef('public.admin_save_named_machine(uuid,uuid,uuid,text,text,text,text,text,uuid,uuid,text,text,text)'::regprocedure),E'\r\n',E'\n');
  definition:=replace(definition,'effective_name text;','effective_name text; selections_before jsonb;');
  needle:='  result:=private.upsert_reporting_machine_by_id(';
  if strpos(definition,needle)=0 then raise exception 'Missing named assignment writer'; end if;
  definition:=replace(definition,needle,E'  if p_machine_id is not null then selections_before:=private.refund_selection_membership(); end if;\n'||needle);
  definition:=replace(definition,'  return result;',E'  if selections_before is not null and selections_before is distinct from private.refund_selection_membership() then\n    raise exception ''This assignment changes customer machine choices. Review the existing duplicate machine setup before moving the company.'' using errcode=''22023'';\n  end if;\n  return result;');
  execute definition;

  definition:=replace(pg_get_functiondef('private.upsert_reporting_machine_by_id(uuid,uuid,uuid,text,text,text,text,text,uuid,uuid,text,text,boolean)'::regprocedure),E'\r\n',E'\n');
  definition:=replace(definition,'declare before_row public.reporting_machines;','declare selections_before jsonb; before_row public.reporting_machines;');
  definition:=replace(definition,E'  if p_machine_id is not null then\n',E'  perform pg_catalog.pg_advisory_xact_lock(1746,1);\n  if p_machine_id is not null then\n');
  needle:='  select * into a from public.customer_accounts';
  if strpos(definition,needle)=0 then raise exception 'Missing internal association validation'; end if;
  definition:=replace(definition,needle,E'  if before_row.id is not null then selections_before:=private.refund_selection_membership(); end if;\n'||needle);
  definition:=replace(definition,'  return result;',E'  if selections_before is not null and selections_before is distinct from private.refund_selection_membership() then\n    raise exception ''This assignment changes customer machine choices. Review the existing duplicate machine setup before moving the company.'' using errcode=''22023'';\n  end if;\n  return result;');
  execute definition;
  definition:=replace(pg_get_functiondef('public.admin_map_source_machine_to_partnership_by_id(text,uuid,text,text,text,numeric,date,date,date,text,uuid,uuid,text,uuid,uuid)'::regprocedure),E'\r\n',E'\n');
  needle:='  select * into before_machine from public.reporting_machines';
  if strpos(definition,needle)=0 then raise exception 'Missing source assignment row lock'; end if;
  execute replace(definition,needle,E'  perform pg_catalog.pg_advisory_xact_lock(1746,1);\n'||needle);
end;
$migration$;
notify pgrst,'reload schema';
