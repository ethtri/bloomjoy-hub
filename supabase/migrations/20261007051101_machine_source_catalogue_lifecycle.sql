begin;

-- Deliberate catalogue visibility, independent of financial/operating status.
alter table public.sunze_machine_discoveries add column catalogue_inactive_at timestamptz;
alter table private.snapcase_source_machines add column catalogue_inactive_at timestamptz;

do $patch$
declare definition text; anchor text:=$old$'machineName',private.reporting_machine_display_name(current_machine),$old$;
begin
  definition:=replace(pg_get_functiondef('public.admin_get_machine_source_inventory()'::regprocedure),E'\r\n',E'\n');
  if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then
    raise exception 'Source catalogue display anchor changed';
  end if;
  execute replace(definition,anchor,$new$'machineName',private.reporting_machine_display_name(current_machine),
      'companyId',current_machine.account_id,
      'companyName',(select account.name from public.customer_accounts account where account.id=current_machine.account_id),
      'catalogueInactiveAt',case when src.platform='Sunze' then
        (select d.catalogue_inactive_at from public.sunze_machine_discoveries d where d.sunze_machine_id=src.source_id)
        else (select s.catalogue_inactive_at from private.snapcase_source_machines s
          where s.provider_account_id=src.provider_account_id and s.source_machine_id=src.source_id) end,$new$);
end; $patch$;

create function public.admin_set_machine_source_catalogue_inactive(
  p_platform text,p_provider_account_id uuid,p_source_id text,p_inactive boolean,
  p_expected_inactive_at timestamptz,p_reason text
) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare actor uuid:=auth.uid(); source jsonb; before_marker timestamptz; after_marker timestamptz;
begin
  if actor is null or not (coalesce(public.is_super_admin(actor),false) or coalesce(public.is_scoped_admin(actor),false)) then
    raise exception 'Admin access required' using errcode='42501';
  end if;
  if p_inactive is null or nullif(btrim(p_source_id),'') is null or p_source_id<>btrim(p_source_id)
    or not coalesce((p_platform='Sunze' and p_provider_account_id is null)
      or (p_platform='Kexiaozhan' and p_provider_account_id is not null),false) then
    raise exception 'Exact source identity and inactive state required' using errcode='22023';
  end if;
  perform public.reporting_admin_assert_reason(p_reason);
  perform pg_catalog.pg_advisory_xact_lock(1746,1);
  if p_platform='Sunze' then
    select catalogue_inactive_at into before_marker from public.sunze_machine_discoveries
      where sunze_machine_id=p_source_id for update;
  else
    select catalogue_inactive_at into before_marker from private.snapcase_source_machines
      where provider_account_id=p_provider_account_id and source_machine_id=p_source_id for update;
  end if;
  if not found then raise exception 'Source not found' using errcode='22023'; end if;
  select item into source from jsonb_array_elements(public.admin_get_machine_source_inventory()->'sources') item
    where item->>'platform'=p_platform and item->>'sourceId'=p_source_id
      and (item->>'providerAccountId')::uuid is not distinct from p_provider_account_id;
  if source is null then raise exception 'Source access required' using errcode='42501'; end if;
  if coalesce((source->>'archivedMapping')::boolean,false) then
    raise exception 'Restore the archived machine explicitly' using errcode='22023';
  end if;
  if before_marker is distinct from p_expected_inactive_at then
    raise exception 'Source state changed. Reload and review.' using errcode='40001';
  end if;
  after_marker:=case when p_inactive then coalesce(before_marker,clock_timestamp()) else null end;
  if after_marker is distinct from before_marker then
    if p_platform='Sunze' then
      update public.sunze_machine_discoveries set catalogue_inactive_at=after_marker where sunze_machine_id=p_source_id;
    else
      update private.snapcase_source_machines set catalogue_inactive_at=after_marker
        where provider_account_id=p_provider_account_id and source_machine_id=p_source_id;
    end if;
    insert into public.admin_audit_log(actor_user_id,action,entity_type,entity_id,before,after,meta)
    values(actor,'machine_source.catalogue_state_changed','machine_source',source->>'sourceKey',
      jsonb_build_object('catalogueInactiveAt',before_marker),jsonb_build_object('catalogueInactiveAt',after_marker),
      jsonb_build_object('platform',p_platform,'providerAccountId',p_provider_account_id,'sourceId',p_source_id,'reason',p_reason));
  end if;
  return jsonb_build_object('sourceKey',source->>'sourceKey','catalogueInactiveAt',after_marker);
end; $fn$;
revoke all on function public.admin_set_machine_source_catalogue_inactive(text,uuid,text,boolean,timestamptz,text) from public,anon;
grant execute on function public.admin_set_machine_source_catalogue_inactive(text,uuid,text,boolean,timestamptz,text) to authenticated;

commit;
