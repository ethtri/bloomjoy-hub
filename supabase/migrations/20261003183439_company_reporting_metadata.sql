-- #1719: current canonical reporting company, layered over existing exact
-- actor/domain scopes. Historical venue, recognition, and payment rows stay put.
alter function public.get_refund_analytics_access() rename to get_refund_analytics_access_pre_company_v1;
revoke all on function public.get_refund_analytics_access_pre_company_v1() from public,anon,authenticated,service_role;
create function public.get_refund_analytics_access()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare base jsonb:=public.get_refund_analytics_access_pre_company_v1(); dimensions jsonb;
begin
  select coalesce(jsonb_agg(d.item||jsonb_build_object('accountId',m.account_id,'accountName',a.name)
    order by d.ordinal),'[]'::jsonb) into dimensions
  from jsonb_array_elements(base->'dimensions') with ordinality d(item,ordinal)
  left join public.reporting_machines m on m.id=(d.item->>'machineId')::uuid
  left join public.customer_accounts a on a.id=m.account_id;
  return jsonb_set(base,'{dimensions}',dimensions,true);
end;
$$;

alter function public.get_finance_reporting_access() rename to get_finance_reporting_access_pre_company_v1;
revoke all on function public.get_finance_reporting_access_pre_company_v1() from public,anon,authenticated,service_role;
create function public.get_finance_reporting_access()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare base jsonb:=public.get_finance_reporting_access_pre_company_v1(); dimensions jsonb;
begin
  select coalesce(jsonb_agg(d.item||jsonb_build_object('accountId',m.account_id,'accountName',a.name)
    order by d.ordinal),'[]'::jsonb) into dimensions
  from jsonb_array_elements(base->'dimensions') with ordinality d(item,ordinal)
  left join public.reporting_machines m on m.id=(d.item->>'machineId')::uuid
  left join public.customer_accounts a on a.id=m.account_id;
  return jsonb_set(base,'{dimensions}',dimensions,true);
end;
$$;

-- This helper is private and never accepts browser requests. Its caller first
-- invokes the existing authorized projection; metadata comes from exact case
-- identity, not labels, customer-entered locations, or provider credentials.
create function private.refund_add_current_company(p_items jsonb,p_id_key text)
returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(item.value||jsonb_build_object('accountId',m.account_id,'accountName',a.name)
    order by item.ordinal),'[]'::jsonb)
  from jsonb_array_elements(coalesce(p_items,'[]'::jsonb)) with ordinality item(value,ordinal)
  left join public.refund_cases c on c.id=(item.value->>p_id_key)::uuid
  left join public.reporting_machines m on m.id=c.reporting_machine_id
  left join public.customer_accounts a on a.id=m.account_id;
$$;
revoke all on function private.refund_add_current_company(jsonb,text) from public,anon,authenticated,service_role;

alter function public.admin_get_refund_operations_overview() rename to admin_get_refund_operations_overview_pre_company_v1;
revoke all on function public.admin_get_refund_operations_overview_pre_company_v1() from public,anon,authenticated,service_role;
create function public.admin_get_refund_operations_overview()
returns jsonb language plpgsql stable security definer set search_path=''
set statement_timeout='20s' set work_mem='32MB' as $$
declare base jsonb:=public.admin_get_refund_operations_overview_pre_company_v1(); field_name text;
begin
  foreach field_name in array array['cases','internalTestCases'] loop
    if jsonb_typeof(base->field_name)='array' then
      base:=jsonb_set(base,array[field_name],private.refund_add_current_company(base->field_name,'id'),true);
    end if;
  end loop;
  return base;
end;
$$;

alter function public.get_refund_portal_queue_projection(timestamptz) rename to get_refund_portal_queue_projection_pre_company_v1;
revoke all on function public.get_refund_portal_queue_projection_pre_company_v1(timestamptz) from public,anon,authenticated,service_role;
create function public.get_refund_portal_queue_projection(p_observed_at timestamptz default statement_timestamp())
returns jsonb language plpgsql stable security definer set search_path='' set statement_timeout='8s' as $$
declare base jsonb:=public.get_refund_portal_queue_projection_pre_company_v1(p_observed_at);
begin
  return jsonb_set(base,'{items}',private.refund_add_current_company(base->'items','caseId'),true);
end;
$$;

revoke all on function public.get_refund_analytics_access(),public.get_finance_reporting_access(),
  public.admin_get_refund_operations_overview(),public.get_refund_portal_queue_projection(timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.get_refund_analytics_access(),public.get_finance_reporting_access(),
  public.get_refund_portal_queue_projection(timestamptz) to authenticated;
grant execute on function public.admin_get_refund_operations_overview() to authenticated,service_role;
create function private.company_reporting_machine_ids(p_company_id uuid,p_domain text,p_machine_ids uuid[])
returns uuid[] language plpgsql stable security definer set search_path='' as $$
declare allowed uuid[]; result uuid[];
begin
  if p_company_id is null then raise exception 'Choose a company' using errcode='22023'; end if;
  if p_domain='sales' then
    select array_agg(distinct d.machine_id) into allowed from public.get_reporting_dimensions() d
      where d.account_id=p_company_id;
  elsif p_domain='refunds' then
    select array_agg(distinct (d->>'machineId')::uuid) into allowed
      from jsonb_array_elements(public.get_refund_analytics_access()->'dimensions') d
      where (d->>'accountId')::uuid=p_company_id;
  elsif p_domain='finance' then
    select array_agg(distinct (d->>'machineId')::uuid) into allowed
      from jsonb_array_elements(public.get_finance_reporting_access()->'dimensions') d
      where (d->>'accountId')::uuid=p_company_id;
  else raise exception 'Unsupported reporting domain' using errcode='22023'; end if;
  if cardinality(allowed) is null or cardinality(allowed)=0 then
    raise exception 'Company is unavailable in this reporting scope' using errcode='42501';
  end if;
  select array_agg(id) into result from unnest(allowed) id where p_machine_ids is null or id=any(p_machine_ids);
  if cardinality(result) is null or cardinality(result)=0 then
    raise exception 'No machines match the selected company and filters' using errcode='22023';
  end if;
  return result;
end;
$$;
revoke all on function private.company_reporting_machine_ids(uuid,text,uuid[]) from public,anon,authenticated,service_role;

-- Match the deployed table result exactly rather than maintain a second list of
-- shared accounting components. Company selection and report share one snapshot.
do $migration$
declare definition text; return_clause text; first_pos integer; last_pos integer;
begin
  definition:=pg_get_functiondef('public.get_sales_report(date,date,text,uuid[],uuid[],text[])'::regprocedure);
  first_pos:=strpos(definition,' RETURNS TABLE('); last_pos:=strpos(definition,' LANGUAGE ');
  if first_pos=0 or last_pos<=first_pos then raise exception 'Unexpected sales report return contract'; end if;
  return_clause:=substr(definition,first_pos,last_pos-first_pos);
  execute 'create function public.get_company_sales_report(p_company_id uuid,p_date_from date,p_date_to date,
    p_grain text default ''week'',p_machine_ids uuid[] default null,p_location_ids uuid[] default null,
    p_payment_methods text[] default null)'||return_clause||$body$
    language plpgsql stable security definer set search_path='' as $function$
    declare machines uuid[]:=private.company_reporting_machine_ids(p_company_id,'sales',p_machine_ids);
    begin
      return query select * from public.get_sales_report(p_date_from,p_date_to,p_grain,machines,p_location_ids,p_payment_methods);
    end;
    $function$;$body$;
end;
$migration$;

create function public.get_company_refund_analytics(p_company_id uuid,p_date_from date,p_date_to date,
  p_machine_ids uuid[] default null,p_location_ids uuid[] default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare machines uuid[]:=private.company_reporting_machine_ids(p_company_id,'refunds',p_machine_ids);
begin
  return public.get_refund_analytics(p_date_from,p_date_to,machines,p_location_ids);
end;
$$;
create function public.get_company_finance_reporting(p_company_id uuid,p_date_from date,p_date_to date,
  p_machine_ids uuid[] default null,p_location_ids uuid[] default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare machines uuid[]:=private.company_reporting_machine_ids(p_company_id,'finance',p_machine_ids);
begin
  return public.get_finance_reporting(p_date_from,p_date_to,machines,p_location_ids);
end;
$$;
revoke all on function public.get_company_sales_report(uuid,date,date,text,uuid[],uuid[],text[]),
  public.get_company_refund_analytics(uuid,date,date,uuid[],uuid[]),
  public.get_company_finance_reporting(uuid,date,date,uuid[],uuid[]) from public,anon,authenticated,service_role;
grant execute on function public.get_company_sales_report(uuid,date,date,text,uuid[],uuid[],text[]),
  public.get_company_refund_analytics(uuid,date,date,uuid[],uuid[]),
  public.get_company_finance_reporting(uuid,date,date,uuid[],uuid[]) to authenticated;
select pg_notify('pgrst','reload schema');
