-- Physical management association does not activate or replay financial imports.
-- In particular, do not set reporting_machines.sunze_machine_id here: that
-- activates the existing card-authority reconciliation of historical facts.
create table private.machine_source_management_associations (
  id uuid primary key default gen_random_uuid(),
  platform text not null check(platform in ('Sunze','Kexiaozhan')),
  provider_account_id uuid,
  source_id text not null check(nullif(btrim(source_id),'') is not null),
  reporting_machine_id uuid not null unique references public.reporting_machines(id),
  created_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id),
  reason text not null check(nullif(btrim(reason),'') is not null),
  check((platform='Sunze' and provider_account_id is null) or
    (platform='Kexiaozhan' and provider_account_id is not null)),
  unique nulls not distinct(platform,provider_account_id,source_id)
);
alter table private.machine_source_management_associations enable row level security;
revoke all on private.machine_source_management_associations from public,anon,authenticated;

create function private.machine_source_reuse_blocker(p_machine_id uuid)
returns text language sql stable security definer set search_path='' as $fn$
  select case
    when m.id is null then 'The connected machine is unavailable.'
    when m.management_archived_at is not null then 'Restore the archived machine before changing its source.'
    when nullif(btrim(m.sunze_machine_id),'') is not null
      or exists(select 1 from private.snapcase_machine_mappings k where k.reporting_machine_id=m.id)
      or exists(select 1 from public.sunze_machine_discoveries d where d.reporting_machine_id=m.id)
      or exists(select 1 from public.machine_sales_facts fact where fact.reporting_machine_id=m.id and fact.source='sunze_browser')
      or exists(select 1 from private.machine_source_management_associations a where a.reporting_machine_id=m.id)
      then 'This machine already has a source association. Open its Manage screen to review the existing connection; a source transfer requires reconciliation.'
    else null end
  from (select p_machine_id as id) requested
  left join public.reporting_machines m on m.id=requested.id;
$fn$;
revoke all on function private.machine_source_reuse_blocker(uuid) from public,anon,authenticated;

create function public.admin_get_imported_source_reuse_options(p_platform text,p_provider_account_id uuid,p_source_id text)
returns jsonb language plpgsql stable security definer set search_path='' as $fn$
begin
  if auth.uid() is null or not coalesce(public.is_super_admin(auth.uid()),false) then
    raise exception 'Super admin access required' using errcode='42501';
  end if;
  if not coalesce(((p_platform='Sunze' and p_provider_account_id is null and exists(
      select 1 from public.sunze_machine_discoveries where sunze_machine_id=p_source_id))
    or (p_platform='Kexiaozhan' and exists(select 1 from private.snapcase_source_machines
      where provider_account_id=p_provider_account_id and source_machine_id=p_source_id))),false) then
    raise exception 'Imported source not found' using errcode='22023';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'inventoryId',i.id,'machineId',m.id,'machineName',private.reporting_machine_display_name(m),
    'companyId',m.account_id,'companyName',company.name,'timezone',site.timezone,
    'expectedMachineUpdatedAt',m.updated_at,'expectedInventoryUpdatedAt',i.updated_at,
    'eligible',private.machine_source_reuse_blocker(m.id) is null
      and exists(select 1 from pg_catalog.pg_timezone_names where name=site.timezone)
      and not exists(select 1 from private.snapcase_source_machines source
        where p_platform='Kexiaozhan' and source.provider_account_id=p_provider_account_id and source.source_machine_id=p_source_id
          and source.source_timezone is distinct from site.timezone
          and exists(select 1 from pg_catalog.pg_timezone_names where name=source.source_timezone))
      and m.nayax_machine_id=i.nayax_machine_id
      and upper(coalesce(nullif(btrim(m.nayax_account_key),''),'TGPACI_USA_DB'))=i.account_key,
    'reason',coalesce(private.machine_source_reuse_blocker(m.id),case
      when not exists(select 1 from pg_catalog.pg_timezone_names where name=site.timezone)
        then 'Review the saved machine time zone before connecting this source.'
      when exists(select 1 from private.snapcase_source_machines source where p_platform='Kexiaozhan'
        and source.provider_account_id=p_provider_account_id and source.source_machine_id=p_source_id
        and source.source_timezone is distinct from site.timezone
        and exists(select 1 from pg_catalog.pg_timezone_names where name=source.source_timezone))
        then 'Source time zone differs from the saved machine time zone. Review the current machine first.'
      when m.nayax_machine_id is distinct from i.nayax_machine_id
        or upper(coalesce(nullif(btrim(m.nayax_account_key),''),'TGPACI_USA_DB')) is distinct from i.account_key
      then 'The reader connection changed. Reload and review its current machine.' end)
  ) order by i.id) from public.refund_nayax_machine_inventory i
    join public.reporting_machines m on m.id=i.reporting_machine_id
    join public.customer_accounts company on company.id=m.account_id
    join public.reporting_locations site on site.id=m.location_id),'[]'::jsonb);
end; $fn$;
revoke all on function public.admin_get_imported_source_reuse_options(text,uuid,text) from public,anon;
grant execute on function public.admin_get_imported_source_reuse_options(text,uuid,text) to authenticated;

create function public.admin_reuse_imported_source_machine(
  p_platform text,p_provider_account_id uuid,p_source_id text,p_inventory_id uuid,
  p_expected_machine_id uuid,p_expected_updated_at timestamptz,p_expected_timezone text,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $fn$
declare machine public.reporting_machines; reader public.refund_nayax_machine_inventory;
  association private.machine_source_management_associations; source_zone text; site_zone text;
begin
  if auth.uid() is null or not coalesce(public.is_super_admin(auth.uid()),false) then
    raise exception 'Super admin access required' using errcode='42501';
  end if;
  perform public.reporting_admin_assert_reason(p_reason);
  perform pg_catalog.pg_advisory_xact_lock(1746,1);
  if p_platform='Sunze' and p_provider_account_id is null then
    perform 1 from public.sunze_machine_discoveries where sunze_machine_id=p_source_id for update;
    if not found then raise exception 'Imported source not found' using errcode='22023'; end if;
    if exists(select 1 from public.reporting_machines where sunze_machine_id=p_source_id)
      or exists(select 1 from public.sunze_machine_discoveries where sunze_machine_id=p_source_id and reporting_machine_id is not null) then
      raise exception 'Source connection changed. Reload and review.' using errcode='40001';
    end if;
  elsif p_platform='Kexiaozhan' and p_provider_account_id is not null then
    select source_timezone into source_zone from private.snapcase_source_machines
      where provider_account_id=p_provider_account_id and source_machine_id=p_source_id for update;
    if not found then raise exception 'Imported source not found' using errcode='22023'; end if;
    if exists(select 1 from private.snapcase_machine_mappings where provider_account_id=p_provider_account_id and source_machine_id=p_source_id) then
      raise exception 'Source connection changed. Reload and review.' using errcode='40001';
    end if;
  else raise exception 'Invalid imported source identity' using errcode='22023'; end if;
  if exists(select 1 from private.machine_source_management_associations
    where platform=p_platform and provider_account_id is not distinct from p_provider_account_id and source_id=p_source_id) then
    raise exception 'Source connection changed. Reload and review.' using errcode='40001';
  end if;
  select * into machine from public.reporting_machines where id=p_expected_machine_id for update nowait;
  select * into reader from public.refund_nayax_machine_inventory where id=p_inventory_id for update nowait;
  if machine.id is null or reader.id is null or p_expected_updated_at is null
    or machine.updated_at is distinct from p_expected_updated_at
    or reader.reporting_machine_id is distinct from machine.id
    or machine.nayax_machine_id is distinct from reader.nayax_machine_id
    or upper(coalesce(nullif(btrim(machine.nayax_account_key),''),'TGPACI_USA_DB')) is distinct from reader.account_key then
    raise exception 'Machine or reader connection changed. Reload and review.' using errcode='40001';
  end if;
  if private.machine_source_reuse_blocker(machine.id) is not null then
    raise exception '%',private.machine_source_reuse_blocker(machine.id) using errcode='22023';
  end if;
  select timezone into site_zone from public.reporting_locations where id=machine.location_id for share nowait;
  if p_expected_timezone is null or site_zone is distinct from p_expected_timezone then
    raise exception 'Saved machine time zone changed. Reload and review.' using errcode='40001';
  end if;
  if not exists(select 1 from pg_catalog.pg_timezone_names where name=site_zone) then
    raise exception 'Review the saved machine time zone before connecting this source.' using errcode='22023';
  end if;
  if p_platform='Kexiaozhan' and source_zone is not null
    and exists(select 1 from pg_catalog.pg_timezone_names where name=source_zone)
    and source_zone is distinct from site_zone then
    raise exception 'Source time zone differs from the saved machine time zone. Review the existing machine configuration first.' using errcode='22023';
  end if;
  insert into private.machine_source_management_associations(platform,provider_account_id,source_id,reporting_machine_id,created_by,reason)
    values(p_platform,p_provider_account_id,p_source_id,machine.id,auth.uid(),btrim(p_reason)) returning * into association;
  insert into public.admin_audit_log(actor_user_id,action,entity_type,entity_id,before,after,meta)
    values(auth.uid(),'reporting_machine.source_management_associated','reporting_machine',machine.id::text,
      jsonb_build_object('sourceAssociation',null),
      jsonb_build_object('platform',p_platform,'providerAccountId',p_provider_account_id,'sourceId',p_source_id,
        'reportingMachineId',machine.id,'salesActivationPending',true),
      jsonb_build_object('inventoryId',reader.id,'nayaxMachineId',reader.nayax_machine_id,'nayaxAccountKey',reader.account_key,
        'expectedHubUpdatedAt',p_expected_updated_at,'reason',btrim(p_reason),'financialMappingUnchanged',true,'promotedPendingCount',0));
  return jsonb_build_object('machineId',machine.id,'salesActivationPending',true);
exception when lock_not_available then
  raise exception 'Machine or reader is being updated. Reload and retry.' using errcode='40001';
end; $fn$;
revoke all on function public.admin_reuse_imported_source_machine(text,uuid,text,uuid,uuid,timestamptz,text,text) from public,anon;
grant execute on function public.admin_reuse_imported_source_machine(text,uuid,text,uuid,uuid,timestamptz,text,text) to authenticated;

-- Association is deliberately not a financial activation mechanism. All
-- ordinary writers must reconcile that separately rather than bypass it.
create function private.guard_source_management_financial_activation()
returns trigger language plpgsql security definer set search_path='' as $fn$
begin
  if tg_table_name='reporting_machines' then
    if nullif(btrim(new.sunze_machine_id),'') is not null
      and (tg_op='INSERT' or new.sunze_machine_id is distinct from old.sunze_machine_id)
      and exists(select 1 from private.machine_source_management_associations a
        where a.reporting_machine_id=new.id or (a.platform='Sunze' and a.source_id=new.sunze_machine_id)) then
      raise exception 'This source is connected for management. Financial activation requires reconciliation; pending imports remain preserved.' using errcode='22023';
    end if;
  elsif exists(select 1 from private.machine_source_management_associations a
    where a.reporting_machine_id=new.reporting_machine_id
      or (a.platform='Kexiaozhan' and a.provider_account_id=new.provider_account_id and a.source_id=new.source_machine_id)) then
    raise exception 'This source is connected for management. Financial activation requires reconciliation; pending imports remain preserved.' using errcode='22023';
  end if;
  return new;
end; $fn$;
revoke all on function private.guard_source_management_financial_activation() from public,anon,authenticated;
create trigger a_guard_source_management_financial_activation before insert or update of sunze_machine_id on public.reporting_machines
  for each row execute function private.guard_source_management_financial_activation();
create trigger a_guard_source_management_financial_activation before insert or update on private.snapcase_machine_mappings
  for each row execute function private.guard_source_management_financial_activation();

create function private.guard_source_management_association_immutable()
returns trigger language plpgsql security definer set search_path='' as $fn$
begin
  raise exception 'Source management associations require a reviewed reconciliation to change.' using errcode='22023';
end; $fn$;
revoke all on function private.guard_source_management_association_immutable() from public,anon,authenticated;
create trigger guard_source_management_association_immutable before update or delete on private.machine_source_management_associations
  for each row execute function private.guard_source_management_association_immutable();

do $patch$
declare definition text; anchor text;
begin
  definition:=pg_get_functiondef('public.admin_get_machine_source_inventory()'::regprocedure);
  anchor:='from public.reporting_machines m where m.sunze_machine_id=d.sunze_machine_id';
  if strpos(definition,anchor)=0 then raise exception 'Source inventory Sunze anchor changed'; end if;
  definition:=replace(definition,anchor,$new$from public.reporting_machines m where m.sunze_machine_id=d.sunze_machine_id
          or exists(select 1 from private.machine_source_management_associations association
            where association.platform='Sunze' and association.source_id=d.sunze_machine_id and association.reporting_machine_id=m.id)$new$);
  anchor:=$old$from private.snapcase_machine_mappings map join public.reporting_machines m on m.id=map.reporting_machine_id
        where map.provider_account_id=s.provider_account_id and map.source_machine_id=s.source_machine_id$old$;
  if strpos(definition,anchor)=0 then raise exception 'Source inventory Kex anchor changed'; end if;
  definition:=replace(definition,anchor,$new$from (
          select reporting_machine_id,effective_start_date,effective_end_date from private.snapcase_machine_mappings
            where provider_account_id=s.provider_account_id and source_machine_id=s.source_machine_id
          union all
          select reporting_machine_id,'-infinity'::date,null::date from private.machine_source_management_associations
            where platform='Kexiaozhan' and provider_account_id=s.provider_account_id and source_id=s.source_machine_id
        ) map join public.reporting_machines m on m.id=map.reporting_machine_id$new$);
  anchor:=$old$'machineName',private.reporting_machine_display_name(current_machine),$old$;
  if strpos(definition,anchor)=0 then raise exception 'Source inventory display anchor changed'; end if;
  definition:=replace(definition,anchor,$new$'machineName',private.reporting_machine_display_name(current_machine),
      'salesActivationPending',exists(select 1 from private.machine_source_management_associations association
        where association.platform=src.platform and association.provider_account_id is not distinct from src.provider_account_id
          and association.source_id=src.source_id and association.reporting_machine_id=current_machine.id),$new$);
  execute definition;
end; $patch$;

do $patch$
declare definition text; anchor text:='perform pg_catalog.pg_advisory_xact_lock(1746,1);';
begin
  definition:=pg_get_functiondef('public.admin_setup_imported_machine(text,uuid,text,uuid,text,text,text,text,uuid,text[],text)'::regprocedure);
  if strpos(definition,anchor)=0 then raise exception 'Imported machine setup lock anchor changed'; end if;
  execute replace(definition,anchor,$new$perform pg_catalog.pg_advisory_xact_lock(1746,1);
  if exists(select 1 from private.machine_source_management_associations association
    where association.platform=p_platform and association.provider_account_id is not distinct from p_provider_account_id and association.source_id=p_source_id) then
    raise exception 'Source is already connected for management. Reload and continue with its existing machine.' using errcode='40001';
  end if;$new$);
end; $patch$;

do $patch$
declare definition text; anchor text:=$old$'excludeCashFromFinancialReporting', machine.exclude_cash_from_financial_reporting$old$;
begin
  definition:=pg_get_functiondef('public.admin_get_machine_workspace_metadata()'::regprocedure);
  if strpos(definition,anchor)=0 then raise exception 'Machine metadata wrapper anchor changed'; end if;
  execute replace(definition,anchor,$new$'excludeCashFromFinancialReporting', machine.exclude_cash_from_financial_reporting,
    'machineName',private.reporting_machine_display_name(machine),
    'salesActivationPending',exists(select 1 from private.machine_source_management_associations association where association.reporting_machine_id=machine.id),
    'sources',coalesce(item.value->'sources','[]'::jsonb)||coalesce((
      select jsonb_agg(jsonb_build_object('platform',association.platform,'id',association.source_id,
        'name',coalesce(discovery.sunze_machine_name,source.source_label),
        'account',account.source_account_key,'lastSeenAt',coalesce(discovery.last_seen_at,source.last_seen_at),
        'lastTransaction',case when association.platform='Sunze' then (select max(pending.sale_date)::text
          from public.sunze_unmapped_sales pending where pending.sunze_machine_id=association.source_id and pending.transaction_count>0)
          else (select to_jsonb(max(observation.occurred_at))#>>'{}' from private.snapcase_sales_observations observation
            where observation.provider_account_id=association.provider_account_id and observation.source_machine_id=association.source_id and observation.amount_minor>0) end,
        'lastImportAt',null,'lastSuccessfulImport',null,'salesActivationPending',true))
      from private.machine_source_management_associations association
      left join public.sunze_machine_discoveries discovery on association.platform='Sunze' and discovery.sunze_machine_id=association.source_id
      left join private.snapcase_source_machines source on association.platform='Kexiaozhan' and source.provider_account_id=association.provider_account_id and source.source_machine_id=association.source_id
      left join private.snapcase_provider_accounts account on account.id=association.provider_account_id
      where association.reporting_machine_id=machine.id),'[]'::jsonb)$new$);
end; $patch$;
