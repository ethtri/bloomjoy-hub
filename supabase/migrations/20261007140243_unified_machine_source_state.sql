begin;

do $patch$
declare definition text; anchor text:=$old$'companyId',current_machine.account_id,$old$;
begin
  definition:=replace(pg_get_functiondef('public.admin_get_machine_source_inventory()'::regprocedure),E'\r\n',E'\n');
  if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then
    raise exception 'Source State stamp projection anchor changed';
  end if;
  execute replace(definition,anchor,$new$'machineUpdatedAt',current_machine.updated_at,
      'companyId',current_machine.account_id,$new$);
end; $patch$;

-- One State control; catalogue inactivity never changes financial machine status.
create function public.admin_set_machine_source_state(
  p_platform text,p_provider_account_id uuid,p_source_id text,p_state text,
  p_expected_inactive_at timestamptz,p_expected_machine_updated_at timestamptz,p_reason text
) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare source jsonb; marker jsonb; machine public.reporting_machines;
begin
  if p_state is null or p_state not in ('setup','live','inactive') then
    raise exception 'Choose Setup, Live or Inactive' using errcode='22023';
  end if;
  -- Existing writer establishes auth, exact identity, reason, advisory/source locks,
  -- stale marker and archive guards. A later failure rolls this change back too.
  marker:=public.admin_set_machine_source_catalogue_inactive(p_platform,p_provider_account_id,
    p_source_id,p_state='inactive',p_expected_inactive_at,p_reason);
  select item into source from jsonb_array_elements(public.admin_get_machine_source_inventory()->'sources') item
    where item->>'platform'=p_platform and item->>'sourceId'=p_source_id
      and (item->>'providerAccountId')::uuid is not distinct from p_provider_account_id;
  if source is null then raise exception 'Source access required' using errcode='42501'; end if;
  if p_state<>'inactive' then
    if coalesce((source->>'mappingConflict')::boolean,false) then
      raise exception 'Resolve the exact source mapping before changing its phase' using errcode='22023';
    end if;
    if source->>'reportingMachineId' is null then
      if p_state='live' then raise exception 'Complete machine setup before choosing Live' using errcode='22023'; end if;
    else
      select * into machine from public.reporting_machines
        where id=(source->>'reportingMachineId')::uuid for update nowait;
      if machine.id is null or p_expected_machine_updated_at is null or machine.updated_at is distinct from p_expected_machine_updated_at then
        raise exception 'Machine changed. Reload and review its state.' using errcode='40001';
      end if;
      if machine.operational_phase is distinct from p_state then
        machine:=public.admin_set_reporting_machine_operational_phase(machine.id,p_state,p_reason);
      end if;
    end if;
  end if;
  return jsonb_build_object('sourceKey',source->>'sourceKey','machineId',source->>'reportingMachineId',
    'catalogueInactiveAt',marker->'catalogueInactiveAt','state',case when p_state='inactive' then 'inactive' else coalesce(machine.operational_phase,'setup') end);
exception when lock_not_available then
  raise exception 'Machine is being changed. Reload and retry.' using errcode='40001';
end; $fn$;
revoke all on function public.admin_set_machine_source_state(text,uuid,text,text,timestamptz,timestamptz,text) from public,anon;
grant execute on function public.admin_set_machine_source_state(text,uuid,text,text,timestamptz,timestamptz,text) to authenticated;

commit;
