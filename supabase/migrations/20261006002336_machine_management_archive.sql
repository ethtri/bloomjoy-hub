-- Management retirement is independent of operating state and financial authority.
alter table public.reporting_machines
  add column management_archived_at timestamptz,
  add column management_archived_by uuid references auth.users(id),
  add column management_archive_reason text;
alter table public.reporting_machines add constraint reporting_machine_archive_reason_check
  check (management_archived_at is null or nullif(btrim(management_archive_reason),'') is not null);
create index reporting_machines_management_active_idx on public.reporting_machines(id)
  where management_archived_at is null;

create function private.assert_machine_management_active(p_machine_id uuid)
returns void language plpgsql security definer set search_path='' as $fn$
declare archived boolean;
begin
  select management_archived_at is not null into archived from public.reporting_machines where id=p_machine_id for share;
  if archived then
    raise exception 'This machine is archived from management. Restore it explicitly before changing its setup.' using errcode='22023';
  end if;
end; $fn$;
revoke all on function private.assert_machine_management_active(uuid) from public,anon,authenticated;

create function private.assert_machine_management_choices(p_machine_ids uuid[])
returns void language plpgsql security definer set search_path='' as $fn$
begin
  perform id from public.reporting_machines where id=any(coalesce(p_machine_ids,array[]::uuid[])) order by id for share;
  if exists(select 1 from public.reporting_machines where id=any(coalesce(p_machine_ids,array[]::uuid[])) and management_archived_at is not null) then
    raise exception 'Archived machines cannot receive new management assignments. Restore them explicitly.' using errcode='22023';
  end if;
end; $fn$;
revoke all on function private.assert_machine_management_choices(uuid[]) from public,anon,authenticated;

create function private.guard_machine_management_archive()
returns trigger language plpgsql security definer set search_path='' as $fn$
begin
  if tg_op='DELETE' then
    if old.management_archived_at is not null then raise exception 'Archived machine history cannot be deleted. Restore management access explicitly.' using errcode='22023'; end if;
    return old;
  end if;
  if tg_op='INSERT' then
    if new.management_archived_at is not null or new.management_archived_by is not null or new.management_archive_reason is not null then
      raise exception 'Create the machine before using the authorized archive action.' using errcode='42501';
    end if;
    return new;
  end if;
  if (new.management_archived_at,new.management_archived_by,new.management_archive_reason)
    is distinct from (old.management_archived_at,old.management_archived_by,old.management_archive_reason)
    and current_setting('app.machine_management_archive',true) is distinct from '1' then
    raise exception 'Use the authorized machine archive or restore action.' using errcode='42501';
  end if;
  if old.management_archived_at is not null
    and current_setting('app.machine_management_archive',true) is distinct from '1'
    and (to_jsonb(new)-'updated_at') is distinct from (to_jsonb(old)-'updated_at') then
    raise exception 'This machine is archived from management. Restore it explicitly before changing its setup.' using errcode='22023';
  end if;
  return new;
end; $fn$;
revoke all on function private.guard_machine_management_archive() from public,anon,authenticated;
create trigger z_guard_machine_management_archive before insert or update or delete on public.reporting_machines
  for each row execute function private.guard_machine_management_archive();

create function public.admin_set_machine_management_archive(p_machine_id uuid,p_archived boolean,p_reason text,p_expected_updated_at timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $fn$
declare old_row public.reporting_machines; new_row public.reporting_machines;
begin
  if auth.uid() is null or not coalesce(public.is_super_admin(auth.uid()),false) then
    raise exception 'Super admin access required' using errcode='42501';
  end if;
  perform public.reporting_admin_assert_reason(p_reason);
  if p_archived is null then raise exception 'Choose archive or restore' using errcode='22023'; end if;
  perform pg_catalog.pg_advisory_xact_lock(1746,1);
  select * into old_row from public.reporting_machines where id=p_machine_id for update;
  if old_row.id is null then raise exception 'Machine not found' using errcode='22023'; end if;
  if old_row.updated_at is distinct from p_expected_updated_at then
    raise exception 'Machine changed. Reload and retry.' using errcode='40001';
  end if;
  if (old_row.management_archived_at is not null)=p_archived then return to_jsonb(old_row); end if;
  perform set_config('app.machine_management_archive','1',true);
  update public.reporting_machines set
    management_archived_at=case when p_archived then now() end,
    management_archived_by=case when p_archived then auth.uid() end,
    management_archive_reason=case when p_archived then btrim(p_reason) end
  where id=p_machine_id returning * into new_row;
  if (to_jsonb(new_row)-array['management_archived_at','management_archived_by','management_archive_reason','updated_at'])
    is distinct from (to_jsonb(old_row)-array['management_archived_at','management_archived_by','management_archive_reason','updated_at']) then
    raise exception 'Archive must preserve machine identity and operating history' using errcode='22023';
  end if;
  perform set_config('app.machine_management_archive','0',true);
  insert into public.admin_audit_log(actor_user_id,action,entity_type,entity_id,before,after,meta)
    values(auth.uid(),case when p_archived then 'reporting_machine.management_archived' else 'reporting_machine.management_restored' end,
      'reporting_machine',p_machine_id::text,to_jsonb(old_row),to_jsonb(new_row),jsonb_build_object('reason',btrim(p_reason)));
  return to_jsonb(new_row);
end; $fn$;
revoke all on function public.admin_set_machine_management_archive(uuid,boolean,text,timestamptz) from public,anon;
grant execute on function public.admin_set_machine_management_archive(uuid,boolean,text,timestamptz) to authenticated;

-- Filter new-management option arrays only. Scope IDs and historical payloads are untouched.
create function private.active_machine_management_options(p_payload jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $fn$
declare option_key text; options jsonb; nested_key text;
begin
  foreach option_key in array array['machines','availableMachines','assignedMachines'] loop
    if jsonb_typeof(p_payload->option_key)='array' then
      select coalesce(jsonb_agg(option.value || jsonb_build_object('managementArchivedAt',null) order by option.ordinality),'[]'::jsonb)
        into options from jsonb_array_elements(p_payload->option_key) with ordinality option(value,ordinality)
        where not exists(select 1 from public.reporting_machines m
          where m.id::text=coalesce(option.value->>'reportingMachineId',option.value->>'id',option.value->>'machineId') and m.management_archived_at is not null);
      p_payload:=jsonb_set(p_payload,array[option_key],options);
    end if;
  end loop;
  -- Only current choice containers recurse; grants, entries, scopes and issued history do not.
  foreach nested_key in array array['profiles','accounts','partners','portalPartnerships'] loop
    if jsonb_typeof(p_payload->nested_key)='array' then
      select coalesce(jsonb_agg(private.active_machine_management_options(item.value) order by item.ordinality),'[]'::jsonb)
        into options from jsonb_array_elements(p_payload->nested_key) with ordinality item(value,ordinality);
      p_payload:=jsonb_set(p_payload,array[nested_key],options);
    end if;
  end loop;
  if p_payload ? 'machineCount' and jsonb_typeof(p_payload->'machines')='array' then
    p_payload:=jsonb_set(p_payload,'{machineCount}',to_jsonb(jsonb_array_length(p_payload->'machines')));
  end if;
  return p_payload;
end; $fn$;
revoke all on function private.active_machine_management_options(jsonb) from public,anon,authenticated;

-- Preserve the existing function ACL, authorization, scope and historical payload.
do $patch$
declare definition text; anchor text:=$old$return result;$old$;
begin
  definition:=replace(replace(pg_get_functiondef('public.admin_get_partnership_reporting_setup()'::regprocedure),E'\r\n',E'\n'),E'\r',E'\n');
  if strpos(definition,anchor)=0 then raise exception 'Machine archive function anchor changed: admin_get_partnership_reporting_setup()'; end if;
  execute replace(definition,anchor,$new$return private.active_machine_management_options(result);$new$);
end; $patch$;

-- Preserve the existing function ACL, authorization, scope and historical payload.
do $patch$
declare definition text; anchor text:=$old$return result;$old$;
begin
  definition:=replace(replace(pg_get_functiondef('public.admin_get_refund_manager_setup()'::regprocedure),E'\r\n',E'\n'),E'\r',E'\n');
  if strpos(definition,anchor)=0 then raise exception 'Machine archive function anchor changed: admin_get_refund_manager_setup()'; end if;
  execute replace(definition,anchor,$new$return private.active_machine_management_options(result);$new$);
end; $patch$;

-- Preserve the existing function ACL, authorization, scope and historical payload.
do $patch$
declare definition text; anchor text:=$old$return result;$old$;
begin
  definition:=replace(replace(pg_get_functiondef('public.get_timekeeping_setup_context()'::regprocedure),E'\r\n',E'\n'),E'\r',E'\n');
  if strpos(definition,anchor)=0 then raise exception 'Machine archive function anchor changed: get_timekeeping_setup_context()'; end if;
  execute replace(definition,anchor,$new$return private.active_machine_management_options(result);$new$);
end; $patch$;

-- Preserve the existing function ACL, authorization, scope and historical payload.
do $patch$
declare definition text; anchor text:=$old$return coalesce(result, jsonb_build_object('partners', '[]'::jsonb));$old$;
begin
  definition:=replace(replace(pg_get_functiondef('public.admin_get_corporate_partner_access_options()'::regprocedure),E'\r\n',E'\n'),E'\r',E'\n');
  if strpos(definition,anchor)=0 then raise exception 'Machine archive function anchor changed: admin_get_corporate_partner_access_options()'; end if;
  execute replace(definition,anchor,$new$return private.active_machine_management_options(coalesce(result, jsonb_build_object('partners', '[]'::jsonb)));$new$);
end; $patch$;

-- Preserve the existing function ACL, authorization, scope and historical payload.
do $patch$
declare definition text; anchor text:=$old$'machineId',m.id,'venueLabel',m.venue_label,$old$;
begin
  definition:=replace(replace(pg_get_functiondef('public.admin_get_machine_workspace_metadata()'::regprocedure),E'\r\n',E'\n'),E'\r',E'\n');
  if strpos(definition,anchor)=0 then raise exception 'Machine archive function anchor changed: admin_get_machine_workspace_metadata()'; end if;
  execute replace(definition,anchor,$new$'machineId',m.id,'managementArchivedAt',m.management_archived_at,'venueLabel',m.venue_label,$new$);
end; $patch$;

-- Preserve the existing function ACL, authorization, scope and historical payload.
do $patch$
declare definition text; anchor text:=$old$where public.is_super_admin(auth.uid()) or m.id=any(public.scoped_admin_machine_ids(auth.uid()))$old$;
begin
  definition:=replace(replace(pg_get_functiondef('public.admin_get_machine_workspace_metadata()'::regprocedure),E'\r\n',E'\n'),E'\r',E'\n');
  if strpos(definition,anchor)=0 then raise exception 'Machine archive function anchor changed: admin_get_machine_workspace_metadata()'; end if;
  execute replace(definition,anchor,$new$where m.management_archived_at is null and (public.is_super_admin(auth.uid()) or m.id=any(public.scoped_admin_machine_ids(auth.uid())))$new$);
end; $patch$;

-- Preserve the existing function ACL, authorization, scope and historical payload.
do $patch$
declare definition text; anchor text:=$old$if before_row.id is not null and (before_row.account_id$old$;
begin
  definition:=replace(replace(pg_get_functiondef('private.upsert_reporting_machine_by_id(uuid,uuid,uuid,text,text,text,text,text,uuid,uuid,text,text,boolean)'::regprocedure),E'\r\n',E'\n'),E'\r',E'\n');
  if strpos(definition,anchor)=0 then raise exception 'Machine archive function anchor changed: private.upsert_reporting_machine_by_id(uuid,uuid,uuid,text,text,text,text,text,uuid,uuid,text,text,boolean)'; end if;
  execute replace(definition,anchor,$new$perform private.assert_machine_management_active(before_row.id);
  if before_row.id is not null and (before_row.account_id$new$);
end; $patch$;

-- Preserve the existing function ACL, authorization, scope and historical payload.
do $patch$
declare definition text; anchor text:=$old$if before_row.id is null then
    insert$old$;
begin
  definition:=replace(replace(pg_get_functiondef('private.upsert_reporting_machine_identity(uuid,uuid,uuid,text,text,text,text,boolean)'::regprocedure),E'\r\n',E'\n'),E'\r',E'\n');
  if strpos(definition,anchor)=0 then raise exception 'Machine archive function anchor changed: private.upsert_reporting_machine_identity(uuid,uuid,uuid,text,text,text,text,boolean)'; end if;
  execute replace(definition,anchor,$new$perform private.assert_machine_management_active(before_row.id);
  if before_row.id is null then
    insert$new$);
end; $patch$;

-- Preserve the existing function ACL, authorization, scope and historical payload.
do $patch$
declare definition text; anchor text:=$old$where option.machine_id = p_machine_id$old$;
begin
  definition:=replace(replace(pg_get_functiondef('public.service_refund_machine_is_public(uuid)'::regprocedure),E'\r\n',E'\n'),E'\r',E'\n');
  if strpos(definition,anchor)=0 then raise exception 'Machine archive function anchor changed: service_refund_machine_is_public(uuid)'; end if;
  execute replace(definition,anchor,$new$where option.machine_id = p_machine_id
      and not exists(select 1 from public.reporting_machines archived where archived.id=p_machine_id and archived.management_archived_at is not null)$new$);
end; $patch$;

-- Exact owner-reviewed retirement set. Missing IDs on fresh databases are harmless.
-- Refuse to retire a record whose source connection changed after the review.
create function private.apply_reviewed_machine_retirements()
returns integer language plpgsql security definer set search_path='' as $archive$
declare target public.reporting_machines; reference record; has_reference boolean; archived_count integer:=0; updated public.reporting_machines;
begin
  perform pg_catalog.pg_advisory_xact_lock(1746,1);
  for target in select * from public.reporting_machines where id=any(array[
    '19f40178-711c-499d-bf51-c68374959f25','53efdc1f-4792-4065-a87d-800cbaad2eab',
    '7d0ccdfb-e758-4723-8e12-a525b03f6a35','233970ef-9ff8-4cd0-bc5c-6eafea7058bc',
    '4208448f-633f-4c24-8848-30b788a9ff0f','b9c8b260-cbe1-467c-9a94-40b17358fb66',
    'a4d61df8-9f6d-4022-be00-b6e94113d302','1608ca48-9b3a-4dec-a228-71a9cfbecbb7'
  ]::uuid[]) for update loop
    if target.management_archived_at is not null then continue; end if;
    if nullif(btrim(target.sunze_machine_id),'') is not null or exists(
      select 1 from private.snapcase_machine_mappings map where map.reporting_machine_id=target.id
    ) then raise exception 'Retirement source connection changed for machine %',target.id; end if;
    if target.id in ('19f40178-711c-499d-bf51-c68374959f25','53efdc1f-4792-4065-a87d-800cbaad2eab',
      '7d0ccdfb-e758-4723-8e12-a525b03f6a35','233970ef-9ff8-4cd0-bc5c-6eafea7058bc',
      '4208448f-633f-4c24-8848-30b788a9ff0f','b9c8b260-cbe1-467c-9a94-40b17358fb66') then
      if target.nayax_machine_id is not null or target.refund_intake_enabled or target.nayax_refunds_enabled then
        raise exception 'Placeholder setup changed for machine %',target.id;
      end if;
      for reference in select c.conrelid::regclass as relation,a.attname as column_name
        from pg_catalog.pg_constraint c join pg_catalog.pg_attribute a on a.attrelid=c.conrelid and a.attnum=c.conkey[1]
        where c.contype='f' and c.confrelid='public.reporting_machines'::regclass and cardinality(c.conkey)=1 loop
        execute format('select exists(select 1 from %s where %I=$1)',reference.relation,reference.column_name) into has_reference using target.id;
        if has_reference then raise exception 'Placeholder gained history in % for machine %',reference.relation,target.id; end if;
      end loop;
    elsif target.id='a4d61df8-9f6d-4022-be00-b6e94113d302' then
      if target.nayax_machine_id is distinct from '86881349' or target.status<>'inactive'
        or target.refund_intake_enabled or target.nayax_refunds_enabled then raise exception 'Retired Gilroy setup changed'; end if;
    elsif target.id='1608ca48-9b3a-4dec-a228-71a9cfbecbb7' then
      if target.nayax_machine_id is distinct from '40390734' or target.refund_intake_enabled or target.nayax_refunds_enabled then
        raise exception 'Withdrawn Snapcase03 setup changed'; end if;
    end if;
    perform set_config('app.machine_management_archive','1',true);
    update public.reporting_machines set management_archived_at=now(),
      management_archive_reason='Owner-reviewed legacy management retirement; #1774. History retained.' where id=target.id returning * into updated;
    if (to_jsonb(updated)-array['management_archived_at','management_archived_by','management_archive_reason','updated_at']) is distinct from (to_jsonb(target)-array['management_archived_at','management_archived_by','management_archive_reason','updated_at']) then raise exception 'Retirement must preserve all original machine fields'; end if;
    archived_count:=archived_count+1;
    insert into public.admin_audit_log(action,entity_type,entity_id,before,after,meta)
      select 'reporting_machine.management_archived','reporting_machine',target.id::text,to_jsonb(target),to_jsonb(m),
        jsonb_build_object('reason','Owner-reviewed exact retirement set','issue',1774) from public.reporting_machines m where m.id=target.id;
    perform set_config('app.machine_management_archive','0',true);
  end loop;
  return archived_count;
end; $archive$;
revoke all on function private.apply_reviewed_machine_retirements() from public,anon,authenticated,service_role;
select private.apply_reviewed_machine_retirements();

do $patch$
declare definition text; anchor text:=$old$return result;$old$;
begin
 definition:=replace(replace(pg_get_functiondef('public.admin_get_technician_access_context(text)'::regprocedure),E'\r\n',E'\n'),E'\r',E'\n');
 if strpos(definition,anchor)=0 then raise exception 'Machine archive function anchor changed: admin_get_technician_access_context(text)'; end if;
 execute replace(definition,anchor,$new$return private.active_machine_management_options(result);$new$);
end; $patch$;

do $patch$
declare definition text; anchor text:=$old$return coalesce(result, jsonb_build_object('workDate', target_work_date, 'profiles', '[]'::jsonb));$old$;
begin
 definition:=replace(replace(pg_get_functiondef('public.get_my_operator_timekeeping_context(date)'::regprocedure),E'\r\n',E'\n'),E'\r',E'\n');
 if strpos(definition,anchor)=0 then raise exception 'Machine archive function anchor changed: get_my_operator_timekeeping_context(date)'; end if;
 execute replace(definition,anchor,$new$return private.active_machine_management_options(coalesce(result, jsonb_build_object('workDate', target_work_date, 'profiles', '[]'::jsonb)));$new$);
end; $patch$;

do $patch$
declare definition text; anchor text:=$old$and prior_mapping_withdrawn
$old$;
begin
 definition:=replace(replace(pg_get_functiondef('private.sync_nayax_card_authority_from_inventory()'::regprocedure),E'\r\n',E'\n'),E'\r',E'\n');
 if strpos(definition,anchor)=0 then raise exception 'Machine archive function anchor changed: private.sync_nayax_card_authority_from_inventory()'; end if;
 execute replace(definition,anchor,$new$and prior_mapping_withdrawn
    and not exists(select 1 from public.reporting_machines archived where archived.id=prior_machine_id and archived.management_archived_at is not null)
$new$);
end; $patch$;

do $patch$
declare definition text; anchor text:=$old$and machine.status = 'active'$old$;
begin
 definition:=replace(replace(pg_get_functiondef('private.sync_nayax_card_authority_from_inventory()'::regprocedure),E'\r\n',E'\n'),E'\r',E'\n');
 if strpos(definition,anchor)=0 then raise exception 'Machine archive function anchor changed: private.sync_nayax_card_authority_from_inventory()'; end if;
 execute replace(definition,anchor,$new$and machine.status = 'active'
      and machine.management_archived_at is null$new$);
end; $patch$;

-- Physical inventory originates from every stored imported source identity, not Hub rows
-- or a pending-only setup queue. No import status, last-seen or name-based exclusion.
create function public.admin_get_machine_source_inventory()
returns jsonb language plpgsql stable security definer set search_path='' as $fn$
declare actor uuid:=auth.uid(); super_admin boolean; scoped_ids uuid[]; inventory jsonb;
begin
  super_admin:=coalesce(public.is_super_admin(actor),false);
  if actor is null or not (super_admin or coalesce(public.is_scoped_admin(actor),false)) then
    raise exception 'Admin access required' using errcode='42501';
  end if;
  scoped_ids:=coalesce(public.scoped_admin_machine_ids(actor),'{}'::uuid[]);
  inventory:=coalesce((
    with source_inventory as (
      select 'sunze:'||d.sunze_machine_id as source_key,'Sunze'::text as platform,
        null::uuid as provider_account_id,null::text as source_account_key,d.sunze_machine_id as source_id,
        d.sunze_machine_name as source_name,null::text as source_status,d.status as discovery_status,
        d.first_seen_at,d.last_seen_at,null::text as source_timezone,
        match.machine_ids,match.archived_ids,
        (select max(sale_date)::text from public.sunze_unmapped_sales pending
          where pending.sunze_machine_id=d.sunze_machine_id and transaction_count>0) as last_source_transaction
      from public.sunze_machine_discoveries d
      left join lateral (
        select array_agg(m.id order by m.id) filter(where m.management_archived_at is null) as machine_ids,
          array_agg(m.id order by m.id) filter(where m.management_archived_at is not null) as archived_ids
        from public.reporting_machines m where m.sunze_machine_id=d.sunze_machine_id
      ) match on true
      union all
      select jsonb_build_array('kexiaozhan',s.provider_account_id,s.source_machine_id)::text,'Kexiaozhan',
        s.provider_account_id,a.source_account_key,s.source_machine_id,s.source_label,s.source_status,
        null::text,s.first_seen_at,s.last_seen_at,case when s.source_timezone='UTC' or (strpos(s.source_timezone,'/')>0 and exists(select 1 from pg_catalog.pg_timezone_names zone where zone.name=s.source_timezone)) then s.source_timezone end,match.machine_ids,match.archived_ids,
        (select to_jsonb(max(occurred_at))#>>'{}' from private.snapcase_sales_observations observation
          where observation.provider_account_id=s.provider_account_id and observation.source_machine_id=s.source_machine_id
            and amount_minor>0)
      from private.snapcase_source_machines s join private.snapcase_provider_accounts a on a.id=s.provider_account_id
      left join lateral (
        select array_agg(distinct m.id order by m.id) filter(where m.management_archived_at is null and map.effective_start_date<=current_date and (map.effective_end_date is null or map.effective_end_date>=current_date)) as machine_ids,
          array_agg(distinct m.id order by m.id) filter(where m.management_archived_at is not null) as archived_ids
        from private.snapcase_machine_mappings map join public.reporting_machines m on m.id=map.reporting_machine_id
        where map.provider_account_id=s.provider_account_id and map.source_machine_id=s.source_machine_id
      ) match on true
    )
    select jsonb_agg(jsonb_build_object(
      'sourceKey',source_key,'platform',platform,'providerAccountId',provider_account_id,
      'sourceAccountKey',source_account_key,'sourceId',source_id,'sourceName',source_name,
      'sourceStatus',source_status,'discoveryStatus',discovery_status,
      'firstSeenAt',first_seen_at,'lastSeenAt',last_seen_at,'sourceTimezone',source_timezone,
      'lastSourceTransaction',last_source_transaction,
      'reportingMachineId',case when cardinality(machine_ids)=1 then machine_ids[1] end,
      'machineName',private.reporting_machine_display_name(current_machine),
      'nayaxMachineId',current_machine.nayax_machine_id,
      'nayaxAccountKey',case when current_machine.nayax_machine_id is not null then upper(coalesce(nullif(btrim(current_machine.nayax_account_key),''),'TGPACI_USA_DB')) end,
      'nayaxName',inventory.machine_name,
      'mappingConflict',coalesce(cardinality(machine_ids)>1,false),
      'archivedMapping',coalesce(cardinality(archived_ids)>0 and coalesce(cardinality(machine_ids),0)=0,false)
    ) order by platform,source_name nulls last,source_key)
    from source_inventory
    left join public.reporting_machines current_machine on current_machine.id=case when cardinality(machine_ids)=1 then machine_ids[1] end
    left join public.refund_nayax_machine_inventory inventory on inventory.nayax_machine_id=current_machine.nayax_machine_id
      and inventory.account_key=upper(coalesce(nullif(btrim(current_machine.nayax_account_key),''),'TGPACI_USA_DB'))
    where super_admin or (cardinality(machine_ids)=1 and machine_ids[1]=any(scoped_ids))
  ),'[]'::jsonb);
  return jsonb_build_object('sources',inventory,'count',jsonb_array_length(inventory),
    'importHealth',case when super_admin then coalesce((select jsonb_build_object(
      'observedAt',coalesce(run.completed_at,run.created_at),
      'verified',run.status='completed' and coalesce(run.meta->>'machine_coverage_verification_version','')='1' and coalesce(run.meta->>'machine_coverage_verified','')='true',
      'status',run.status,
      'issue',case when run.status<>'completed' then 'latest_import_not_completed' when coalesce(run.meta->>'machine_coverage_verification_version','')<>'1' then 'machine_coverage_proof_missing' else run.meta->>'machine_coverage_issue' end
    ) from public.sales_import_runs run where run.source='sunze_browser'
      order by greatest(run.created_at,run.completed_at) desc nulls last,run.id limit 1),jsonb_build_object('observedAt',null,'verified',false,'issue','import_history_unavailable')) end);
end; $fn$;
revoke all on function public.admin_get_machine_source_inventory() from public,anon;
grant execute on function public.admin_get_machine_source_inventory() to authenticated;

-- First setup is one transaction: invalid mapping or manager assignments cannot
-- leave a second physical record or a partially connected source behind.
create function public.admin_setup_imported_machine(
  p_platform text,p_provider_account_id uuid,p_source_id text,p_account_id uuid,
  p_machine_name text,p_machine_type text,p_operational_phase text,p_timezone text,
  p_inventory_id uuid,p_manager_emails text[],p_reason text
) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare machine public.reporting_machines; source_date date; authoritative_zone text; mapped jsonb;
begin
  if auth.uid() is null or not coalesce(public.is_super_admin(auth.uid()),false) then
    raise exception 'Super Admin access required' using errcode='42501';
  end if;
  if nullif(btrim(p_machine_name),'') is null or length(p_machine_name)>120 then
    raise exception 'Enter a machine name of at most 120 characters' using errcode='22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(1746,1);
  if p_platform='Sunze' then
    perform 1 from public.sunze_machine_discoveries where sunze_machine_id=p_source_id for update;
    if not found then raise exception 'Imported source no longer exists. Reload Machines.' using errcode='22023'; end if;
    if exists(select 1 from public.reporting_machines where sunze_machine_id=p_source_id)
      or exists(select 1 from public.sunze_machine_discoveries where sunze_machine_id=p_source_id and reporting_machine_id is not null) then
      raise exception 'This source already has a machine. Reload Machines.' using errcode='40001';
    end if;
    machine:=private.upsert_reporting_machine_by_id(null,p_account_id,null,btrim(p_machine_name),p_machine_type,p_source_id,
      p_operational_phase,p_reason,null,null,'Unmapped Hub Source Sunze '||p_source_id,p_timezone,true);
  elsif p_platform='Kexiaozhan' then
    if p_machine_type<>'snapcase' then raise exception 'Kexiaozhan source requires SnapCase type' using errcode='22023'; end if;
    select (first_seen_at at time zone 'UTC')::date,source_timezone into source_date,authoritative_zone from private.snapcase_source_machines
      where provider_account_id=p_provider_account_id and source_machine_id=p_source_id for update;
    if not found then raise exception 'Imported source no longer exists. Reload Machines.' using errcode='22023'; end if;
    if (authoritative_zone='UTC' or (strpos(authoritative_zone,'/')>0 and exists(select 1 from pg_catalog.pg_timezone_names zone where zone.name=authoritative_zone))) and authoritative_zone is distinct from p_timezone then
      raise exception 'The imported machine time zone must be preserved. Reload Machines.' using errcode='22023';
    end if;
    if exists(select 1 from private.snapcase_machine_mappings mapping join public.reporting_machines existing on existing.id=mapping.reporting_machine_id
      where mapping.provider_account_id=p_provider_account_id and mapping.source_machine_id=p_source_id
        and (existing.management_archived_at is not null or (mapping.effective_start_date<=current_date and coalesce(mapping.effective_end_date,'infinity'::date)>=current_date))) then
      raise exception 'This source already has a machine. Reload Machines.' using errcode='40001';
    end if;
    mapped:=public.admin_map_snapcase_machine(p_provider_account_id,p_source_id,null,p_account_id,null,
      'Unmapped Hub Source Kexiaozhan '||p_provider_account_id::text||' '||p_source_id,btrim(p_machine_name),null,
      coalesce(source_date,current_date),null,p_reason,p_timezone);
    select * into strict machine from public.reporting_machines where id=(mapped->>'machineId')::uuid;
    update public.reporting_machines set operational_phase=p_operational_phase where id=machine.id;
  else raise exception 'Unsupported source platform' using errcode='22023';
  end if;
  perform public.admin_set_machine_display_name(machine.id,btrim(p_machine_name),private.reporting_machine_display_name(machine));
  if p_inventory_id is not null then
    perform public.admin_save_machine_workspace_mapping(machine.id,'',p_inventory_id,null,null,null);
  end if;
  if cardinality(coalesce(p_manager_emails,array[]::text[]))>0 then
    perform public.admin_set_reporting_machine_refund_managers(machine.id,p_manager_emails,p_reason);
  end if;
  return jsonb_build_object('machineId',machine.id);
end; $fn$;
revoke all on function public.admin_setup_imported_machine(text,uuid,text,uuid,text,text,text,text,uuid,text[],text) from public,anon;
grant execute on function public.admin_setup_imported_machine(text,uuid,text,uuid,text,text,text,text,uuid,text[],text) to authenticated;

create function public.admin_get_imported_machine_tax(p_inventory_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $fn$
declare result jsonb;
begin
  if auth.uid() is null or not coalesce(public.is_super_admin(auth.uid()),false) then
    raise exception 'Super Admin access required' using errcode='42501';
  end if;
  select jsonb_build_object('coverageStatus',observation.classification,'source',observation.source,
    'ratePercent',case when observation.classification='verified_tax' then observation.rate_percent end,
    'observedAt',observation.observed_at,'saleDate',current_date)
  into result from public.refund_nayax_machine_inventory inventory
  left join lateral (
    select evidence.* from private.nayax_machine_tax_observations evidence
    where evidence.account_key=inventory.account_key and evidence.nayax_machine_id=inventory.nayax_machine_id
      and evidence.effective_start_date<=current_date and coalesce(evidence.effective_end_date,'infinity'::date)>=current_date
    order by (evidence.classification<>'unavailable') desc,evidence.effective_start_date desc,evidence.observed_at desc,evidence.id
    limit 1
  ) observation on true where inventory.id=p_inventory_id;
  return coalesce(result,jsonb_build_object('coverageStatus','missing','ratePercent',null));
end; $fn$;
revoke all on function public.admin_get_imported_machine_tax(uuid) from public,anon;
grant execute on function public.admin_get_imported_machine_tax(uuid) to authenticated;

do $patch$
declare definition text; anchor text:=$old$  perform pg_advisory_xact_lock(hashtext('machine_manager:' || p_machine_id::text));$old$;
begin
  definition:=replace(replace(pg_get_functiondef('public.admin_set_reporting_machine_refund_managers(uuid,text[],text)'::regprocedure),E'\r\n',E'\n'),E'\r',E'\n');
  if strpos(definition,anchor)=0 then raise exception 'Archive admission anchor changed: admin_set_reporting_machine_refund_managers(uuid,text[],text)'; end if;
  execute replace(definition,anchor,$new$  perform pg_advisory_xact_lock(hashtext('machine_manager:' || p_machine_id::text));
  perform private.assert_machine_management_active(p_machine_id);$new$);
end; $patch$;

do $patch$
declare definition text; anchor text:=$old$  normalized_reason := public.reporting_admin_assert_reason(p_reason);$old$;
begin
  definition:=replace(replace(pg_get_functiondef('public.admin_map_snapcase_machine(uuid,text,uuid,uuid,uuid,text,text,uuid,date,date,text,text)'::regprocedure),E'\r\n',E'\n'),E'\r',E'\n');
  if strpos(definition,anchor)=0 then raise exception 'Archive admission anchor changed: admin_map_snapcase_machine(uuid,text,uuid,uuid,uuid,text,text,uuid,date,date,text,text)'; end if;
  execute replace(definition,anchor,$new$  normalized_reason := public.reporting_admin_assert_reason(p_reason);
  perform private.assert_machine_management_active(p_reporting_machine_id);
  if exists(select 1 from private.snapcase_machine_mappings archived_map join public.reporting_machines archived on archived.id=archived_map.reporting_machine_id where archived_map.provider_account_id=p_provider_account_id and archived_map.source_machine_id=normalized_source_machine_id and archived.management_archived_at is not null) then raise exception 'This source belongs to an archived machine. Restore it explicitly.' using errcode='22023'; end if;$new$);
end; $patch$;

do $patch$
declare definition text; anchor text:=$old$  where public.is_super_admin(actor_user_id)
    or ($old$;
begin
  definition:=replace(replace(pg_get_functiondef('public.admin_get_refund_nayax_inventory()'::regprocedure),E'\r\n',E'\n'),E'\r',E'\n');
  if strpos(definition,anchor)=0 then raise exception 'Archive admission anchor changed: admin_get_refund_nayax_inventory()'; end if;
  execute replace(definition,anchor,$new$  where not exists(select 1 from public.reporting_machines archived where archived.id=inventory.reporting_machine_id and archived.management_archived_at is not null)
    and (public.is_super_admin(actor_user_id)
    or ($new$);
end; $patch$;

do $patch$
declare definition text; anchor text:=$old$      and public.can_manage_refund_machine(actor_user_id, inventory.reporting_machine_id)
    );$old$;
begin
  definition:=replace(replace(pg_get_functiondef('public.admin_get_refund_nayax_inventory()'::regprocedure),E'\r\n',E'\n'),E'\r',E'\n');
  if strpos(definition,anchor)=0 then raise exception 'Archive admission anchor changed: admin_get_refund_nayax_inventory()'; end if;
  execute replace(definition,anchor,$new$      and public.can_manage_refund_machine(actor_user_id, inventory.reporting_machine_id)
    ));$new$);
end; $patch$;

do $patch$
declare definition text; anchor text:=$old$   and btrim(coalesce(reporting.nayax_machine_id, '')) = stage.nayax_machine_id$old$;
begin
  definition:=replace(replace(pg_get_functiondef('public.service_sync_refund_nayax_inventory(text,text,jsonb,boolean,text)'::regprocedure),E'\r\n',E'\n'),E'\r',E'\n');
  if strpos(definition,anchor)=0 then raise exception 'Archive admission anchor changed: service_sync_refund_nayax_inventory(text,text,jsonb,boolean,text)'; end if;
  execute replace(definition,anchor,$new$   and btrim(coalesce(reporting.nayax_machine_id, '')) = stage.nayax_machine_id
   and reporting.management_archived_at is null$new$);
end; $patch$;

do $patch$
declare definition text; anchor text:=$old$    reconciliation_state = case
      when public.refund_nayax_machine_inventory.reconciliation_state = 'excluded'$old$;
begin
  definition:=replace(replace(pg_get_functiondef('public.service_sync_refund_nayax_inventory(text,text,jsonb,boolean,text)'::regprocedure),E'\r\n',E'\n'),E'\r',E'\n');
  if strpos(definition,anchor)=0 then raise exception 'Archive admission anchor changed: service_sync_refund_nayax_inventory(text,text,jsonb,boolean,text)'; end if;
  execute replace(definition,anchor,$new$    reconciliation_state = case
      when public.refund_nayax_machine_inventory.reconciliation_state <> 'published' and exists(select 1 from public.reporting_machines archived where archived.id=public.refund_nayax_machine_inventory.reporting_machine_id and archived.management_archived_at is not null) then public.refund_nayax_machine_inventory.reconciliation_state
      when public.refund_nayax_machine_inventory.reconciliation_state = 'excluded'$new$);
end; $patch$;

do $patch$
declare definition text; anchor text:=$old$  where machine.status = 'active'$old$;
begin
  definition:=replace(replace(pg_get_functiondef('public.public_refund_machine_options()'::regprocedure),E'\r\n',E'\n'),E'\r',E'\n');
  if strpos(definition,anchor)=0 then raise exception 'Archive assignment anchor changed: public_refund_machine_options()'; end if;
  execute replace(definition,anchor,$new$  where machine.management_archived_at is null and machine.status = 'active'$new$);
end; $patch$;

do $patch$
declare definition text; anchor text:=$old$  if existing_row.id is not null then$old$;
begin
  definition:=replace(replace(pg_get_functiondef('public.admin_grant_machine_report_access(text,uuid,uuid,uuid,text,text)'::regprocedure),E'\r\n',E'\n'),E'\r',E'\n');
  if strpos(definition,anchor)=0 then raise exception 'Archive assignment anchor changed: admin_grant_machine_report_access(text,uuid,uuid,uuid,text,text)'; end if;
  execute replace(definition,anchor,$new$  perform private.assert_machine_management_active(normalized_machine_id);
  if existing_row.id is not null then$new$);
end; $patch$;

do $patch$
declare definition text; anchor text:=$old$  for existing_row in$old$;
begin
  definition:=replace(replace(pg_get_functiondef('public.admin_set_user_machine_reporting_access(text,uuid[],text,text)'::regprocedure),E'\r\n',E'\n'),E'\r',E'\n');
  if strpos(definition,anchor)=0 then raise exception 'Archive assignment anchor changed: admin_set_user_machine_reporting_access(text,uuid[],text,text)'; end if;
  execute replace(definition,anchor,$new$  perform private.assert_machine_management_choices(array(select wanted from unnest(normalized_machine_ids) wanted where not exists(select 1 from public.reporting_machine_entitlements existing where existing.user_id=target_user_id and existing.machine_id=wanted and public.reporting_entitlement_is_active(existing.starts_at,existing.expires_at,existing.revoked_at))));
  for existing_row in$new$);
end; $patch$;

do $patch$
declare definition text; anchor text:=$old$  select count(*)
  into machine_count$old$;
begin
  definition:=replace(replace(pg_get_functiondef('public.admin_set_operator_machine_assignments(uuid,uuid[],text)'::regprocedure),E'\r\n',E'\n'),E'\r',E'\n');
  if strpos(definition,anchor)=0 then raise exception 'Archive assignment anchor changed: admin_set_operator_machine_assignments(uuid,uuid[],text)'; end if;
  execute replace(definition,anchor,$new$  perform private.assert_machine_management_choices(array(select wanted from unnest(normalized_machine_ids) wanted where not exists(select 1 from public.operator_machine_assignments existing where existing.operator_profile_id=profile_row.id and existing.reporting_machine_id=wanted and existing.status='active' and existing.revoked_at is null)));
  select count(*)
  into machine_count$new$);
end; $patch$;

do $patch$
declare definition text; anchor text:=$old$  with revoked_assignments as ($old$;
begin
  definition:=replace(replace(pg_get_functiondef('public.technician_apply_machine_assignments(uuid,uuid[],text,uuid)'::regprocedure),E'\r\n',E'\n'),E'\r',E'\n');
  if strpos(definition,anchor)=0 then raise exception 'Archive assignment anchor changed: technician_apply_machine_assignments(uuid,uuid[],text,uuid)'; end if;
  execute replace(definition,anchor,$new$  perform private.assert_machine_management_choices(added_machine_ids);
  with revoked_assignments as ($new$);
end; $patch$;

-- New time admission is blocked; unchanged historical entry corrections remain valid.
do $patch$
declare definition text; anchor text:=$old$begin
  manager_correction :=$old$;
begin
 definition:=replace(replace(pg_get_functiondef('public.validate_operator_time_entry_assignment()'::regprocedure),E'\r\n',E'\n'),E'\r',E'\n');
 if strpos(definition,anchor)=0 then raise exception 'Archive admission anchor changed: validate_operator_time_entry_assignment()'; end if;
 execute replace(definition,anchor,$new$begin
  if tg_op='INSERT' then
    perform private.assert_machine_management_active(new.reporting_machine_id);
  elsif new.reporting_machine_id is distinct from old.reporting_machine_id then
    perform private.assert_machine_management_active(new.reporting_machine_id);
  end if;
  manager_correction :=$new$);
end; $patch$;

do $patch$
declare definition text; anchor text:=$old$  if p_reporting_machine_id is not null then
    select * into reporting$old$;
begin
 definition:=replace(replace(pg_get_functiondef('public.admin_reconcile_refund_nayax_machine(uuid,text,text,uuid,text,text)'::regprocedure),E'\r\n',E'\n'),E'\r',E'\n');
 if strpos(definition,anchor)=0 then raise exception 'Archive admission anchor changed: admin_reconcile_refund_nayax_machine'; end if;
 execute replace(definition,anchor,$new$  perform private.assert_machine_management_active(coalesce(p_reporting_machine_id,before_row.reporting_machine_id));
  if p_reporting_machine_id is not null then
    select * into reporting$new$);
end; $patch$;

-- Missed-time and tax setup choices are current options; historical contexts stay intact.
do $patch$
declare definition text; anchor text:=$old$  from scoped_assignments option_row;$old$;
begin
 definition:=replace(replace(pg_get_functiondef('public.get_my_time_review_entry_options(date)'::regprocedure),E'\r\n',E'\n'),E'\r',E'\n');
 if strpos(definition,anchor)=0 then raise exception 'Archive choice anchor changed: get_my_time_review_entry_options'; end if;
 execute replace(definition,anchor,$new$  from scoped_assignments option_row
  where not exists(select 1 from public.reporting_machines archived where archived.id=option_row.machine_id and archived.management_archived_at is not null);$new$);
end; $patch$;

do $patch$
declare definition text; anchor text:=$old$  return coalesce(
    result,
    jsonb_build_object(
      'machines', '[]'::jsonb,
      'taxRates', '[]'::jsonb,
      'warnings', '[]'::jsonb
    )
  );$old$;
begin
 definition:=replace(replace(pg_get_functiondef('public.admin_get_scoped_machine_tax_setup()'::regprocedure),E'\r\n',E'\n'),E'\r',E'\n');
 if strpos(definition,anchor)=0 then raise exception 'Archive choice anchor changed: admin_get_scoped_machine_tax_setup'; end if;
 execute replace(definition,anchor,$new$  return private.active_machine_management_options(coalesce(
    result,
    jsonb_build_object('machines','[]'::jsonb,'taxRates','[]'::jsonb,'warnings','[]'::jsonb)
  ));$new$);
end; $patch$;
