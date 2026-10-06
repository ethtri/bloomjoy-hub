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
begin
  if exists(select 1 from public.reporting_machines where id=p_machine_id and management_archived_at is not null) then
    raise exception 'This machine is archived from management. Restore it explicitly before changing its setup.' using errcode='22023';
  end if;
end; $fn$;
revoke all on function private.assert_machine_management_active(uuid) from public,anon,authenticated;

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
          where m.id::text=coalesce(option.value->>'id',option.value->>'machineId') and m.management_archived_at is not null);
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
do $archive$
declare target public.reporting_machines; reference record; has_reference boolean;
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
        and map.effective_start_date<=current_date and (map.effective_end_date is null or map.effective_end_date>=current_date)
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
      management_archive_reason='Owner-reviewed legacy management retirement; #1774. History retained.' where id=target.id;
    insert into public.admin_audit_log(action,entity_type,entity_id,before,after,meta)
      select 'reporting_machine.management_archived','reporting_machine',target.id::text,to_jsonb(target),to_jsonb(m),
        jsonb_build_object('reason','Owner-reviewed exact retirement set','issue',1774) from public.reporting_machines m where m.id=target.id;
    perform set_config('app.machine_management_archive','0',true);
  end loop;
end; $archive$;

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
        (select max(sale_date)::timestamptz from public.sunze_unmapped_sales pending
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
        null::text,s.first_seen_at,s.last_seen_at,s.source_timezone,match.machine_ids,match.archived_ids,
        (select max(occurred_at) from private.snapcase_sales_observations observation
          where observation.provider_account_id=s.provider_account_id and observation.source_machine_id=s.source_machine_id
            and amount_minor>0)
      from private.snapcase_source_machines s join private.snapcase_provider_accounts a on a.id=s.provider_account_id
      left join lateral (
        select array_agg(distinct m.id order by m.id) filter(where m.management_archived_at is null) as machine_ids,
          array_agg(distinct m.id order by m.id) filter(where m.management_archived_at is not null) as archived_ids
        from private.snapcase_machine_mappings map join public.reporting_machines m on m.id=map.reporting_machine_id
        where map.provider_account_id=s.provider_account_id and map.source_machine_id=s.source_machine_id
          and map.effective_start_date<=current_date and (map.effective_end_date is null or map.effective_end_date>=current_date)
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
      'archivedMapping',coalesce(cardinality(archived_ids)>0,false)
    ) order by platform,source_name nulls last,source_key)
    from source_inventory
    left join public.reporting_machines current_machine on current_machine.id=case when cardinality(machine_ids)=1 then machine_ids[1] end
    left join public.refund_nayax_machine_inventory inventory on inventory.nayax_machine_id=current_machine.nayax_machine_id
      and inventory.account_key=upper(coalesce(nullif(btrim(current_machine.nayax_account_key),''),'TGPACI_USA_DB'))
    where super_admin or (cardinality(machine_ids)=1 and machine_ids[1]=any(scoped_ids))
  ),'[]'::jsonb);
  return jsonb_build_object('sources',inventory,'count',jsonb_array_length(inventory));
end; $fn$;
revoke all on function public.admin_get_machine_source_inventory() from public,anon;
grant execute on function public.admin_get_machine_source_inventory() to authenticated;
