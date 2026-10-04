-- A physical placement label is independent of reporting location/timezone.
alter table public.reporting_machines add column venue_label text
  check (venue_label is null or length(venue_label) <= 300);

create function public.admin_get_machine_workspace_metadata()
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if auth.uid() is null or not (coalesce(public.is_super_admin(auth.uid()),false)
    or coalesce(public.is_scoped_admin(auth.uid()),false)) then
    raise exception 'Admin access required' using errcode='42501';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'machineId',m.id,'venueLabel',m.venue_label,
    'nayaxMachineId',m.nayax_machine_id,'nayaxAccountKey',m.nayax_account_key,
    'nayaxName',(select machine_name from public.refund_nayax_machine_inventory
      where nayax_machine_id=m.nayax_machine_id
        and account_key=upper(coalesce(nullif(btrim(m.nayax_account_key),''),'TGPACI_USA_DB'))),
    'nayaxLastTransaction',(select max(sale_date) from public.machine_sales_facts
      where reporting_machine_id=m.id and source='nayax_scheduled_report'
        and (transaction_count>0 or coalesce(raw_payload #>> '{_salesAuthorityOriginal,transactionCount}','0') ~ '^[1-9][0-9]*$')),
    'lastRecordedTransaction',last_fact.sale_date,'transactionSource',last_fact.source,
    'transactionImportedAt',last_fact.created_at,
    'lastSuccessfulSalesImport',(select max(completed_at) from public.sales_import_runs
      where status='completed' and source=case when m.sunze_machine_id is not null then 'sunze_browser'
        when m.nayax_machine_id is not null then 'nayax_scheduled_report' else last_fact.source end),
    'sources',coalesce((select jsonb_agg(source_row.value) from (
      select jsonb_build_object('platform','Sunze','name',d.sunze_machine_name,
        'id',m.sunze_machine_id,'account',null,'lastSeenAt',d.last_seen_at,
        'lastTransaction',sf.sale_date,'lastImportAt',sf.created_at,
        'lastSuccessfulImport',(select max(completed_at) from public.sales_import_runs
          where source='sunze_browser' and status='completed')) as value
      from (select 1) one left join public.sunze_machine_discoveries d
        on d.sunze_machine_id=m.sunze_machine_id
      left join lateral (select sale_date,created_at from public.machine_sales_facts
        where reporting_machine_id=m.id and source='sunze_browser' and transaction_count>0
        order by sale_date desc,created_at desc limit 1) sf on true
      where m.sunze_machine_id is not null
      union all
      select jsonb_build_object('platform','Kexiaozhan','name',s.source_label,
        'id',s.source_machine_id,'account',a.source_account_key,'lastSeenAt',s.last_seen_at,
        'lastTransaction',obs.occurred_at,'lastImportAt',obs.last_seen_at,
        'lastSuccessfulImport',(select max(completed_at) from private.snapcase_completed_import_windows
          where provider_account_id=s.provider_account_id and source_machine_id=s.source_machine_id))
      from private.snapcase_machine_mappings map
      join private.snapcase_source_machines s on s.provider_account_id=map.provider_account_id
        and s.source_machine_id=map.source_machine_id
      join private.snapcase_provider_accounts a on a.id=s.provider_account_id
      left join lateral (select occurred_at,last_seen_at from private.snapcase_sales_observations
        where provider_account_id=s.provider_account_id and source_machine_id=s.source_machine_id
          and occurred_at is not null and amount_minor>0
        order by occurred_at desc limit 1) obs on true
      where map.reporting_machine_id=m.id and map.effective_start_date<=current_date
        and (map.effective_end_date is null or map.effective_end_date>=current_date)
    ) source_row),'[]'::jsonb)
  )) from public.reporting_machines m
  left join lateral (select sale_date,source,created_at from public.machine_sales_facts
    where reporting_machine_id=m.id and transaction_count>0
    order by sale_date desc,created_at desc limit 1) last_fact on true
  where public.is_super_admin(auth.uid()) or m.id=any(public.scoped_admin_machine_ids(auth.uid()))),'[]'::jsonb);
end;
$$;

-- An inventory UUID resolves the exact provider ID + account on the server.
-- NULL inventory means preserve the current link, never implicitly unlink it.
create function public.admin_save_machine_workspace_mapping(
  p_machine_id uuid,p_venue_label text,p_inventory_id uuid,
  p_expected_nayax_machine_id text,p_expected_nayax_account_key text,p_expected_venue_label text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.reporting_machines; i public.refund_nayax_machine_inventory;
  current_inventory public.refund_nayax_machine_inventory;
  updated public.reporting_machines;
begin
  if auth.uid() is null or not coalesce(public.is_super_admin(auth.uid()),false) then
    raise exception 'Super Admin access required' using errcode='42501';
  end if;
  if length(coalesce(p_venue_label,''))>300 then raise exception 'Venue label is too long' using errcode='22023'; end if;
  -- Serialize mapping changes across different Hub rows before taking row locks.
  perform pg_catalog.pg_advisory_xact_lock(1742,1);
  select * into m from public.reporting_machines where id=p_machine_id for update;
  if m.id is null then raise exception 'Machine not found' using errcode='22023'; end if;
  if m.nayax_machine_id is distinct from p_expected_nayax_machine_id
    or m.nayax_account_key is distinct from p_expected_nayax_account_key
    or m.venue_label is distinct from p_expected_venue_label then
    raise exception 'Machine mapping or venue changed. Reload and retry.' using errcode='40001';
  end if;
  if p_inventory_id is not null then
    select * into i from public.refund_nayax_machine_inventory where id=p_inventory_id for update;
    if i.id is null then raise exception 'Imported Nayax record not found' using errcode='22023'; end if;
    if (i.reporting_machine_id is not null and i.reporting_machine_id<>m.id)
      or exists(select 1 from public.reporting_machines other where other.id<>m.id
        and other.nayax_machine_id=i.nayax_machine_id
        and upper(coalesce(nullif(btrim(other.nayax_account_key),''),'TGPACI_USA_DB'))=i.account_key) then
      raise exception 'This Nayax record is already linked to another Hub machine' using errcode='23505';
    end if;
    select * into current_inventory from public.refund_nayax_machine_inventory
      where reporting_machine_id=m.id for update;
    if current_inventory.id is distinct from i.id then
      if current_inventory.reconciliation_state='published' then
        -- Identity matching does not activate/publish a replacement or require
        -- refund readiness. Reuse canonical audited writers while preserving
        -- historical reader attribution and the existing accounting boundary.
        perform set_config('app.nayax_reader_replacement','1',true);
        perform public.admin_reconcile_refund_nayax_machine(current_inventory.id,'excluded',
          current_inventory.refund_category,null,'Retired reader after explicit exact match',
          'Explicit machine workspace reader replacement');
        perform public.admin_set_reporting_machine_nayax_config(m.id,i.nayax_machine_id,i.account_key,
          'Explicit machine workspace reader replacement');
        perform public.admin_reconcile_refund_nayax_machine(i.id,
          case when i.reconciliation_state='excluded' then 'excluded' else 'needs_setup' end,
          i.refund_category,m.id,i.exclusion_reason,'Explicit machine workspace replacement awaiting refund setup');
        update public.reporting_machines set nayax_card_sales_started_on=m.nayax_card_sales_started_on,
          refund_intake_enabled=m.refund_intake_enabled where id=m.id;
        perform set_config('app.nayax_reader_replacement','0',true);
      else
        if current_inventory.id is not null then
          perform public.admin_reconcile_refund_nayax_machine(current_inventory.id,
            current_inventory.reconciliation_state,current_inventory.refund_category,null,
            current_inventory.exclusion_reason,'Explicit machine workspace mapping changed');
        end if;
        perform public.admin_set_reporting_machine_nayax_config(m.id,i.nayax_machine_id,i.account_key,
          'Explicit imported Nayax record selected in machine workspace');
        perform public.admin_reconcile_refund_nayax_machine(i.id,case when i.reconciliation_state='excluded' then 'excluded' else 'needs_setup' end,
          i.refund_category,m.id,i.exclusion_reason,'Explicit machine workspace exact mapping');
        -- Matching is independent of refund intake configuration.
        update public.reporting_machines set refund_intake_enabled=m.refund_intake_enabled where id=m.id;
      end if;
    elsif m.nayax_machine_id is distinct from i.nayax_machine_id or m.nayax_account_key is distinct from i.account_key then
      perform public.admin_set_reporting_machine_nayax_config(m.id,i.nayax_machine_id,i.account_key,
        'Explicit machine workspace exact mapping repaired');
    end if;
  end if;
  update public.reporting_machines set venue_label=nullif(btrim(p_venue_label),''),
    nayax_machine_id=case when i.id is null then m.nayax_machine_id else i.nayax_machine_id end,
    nayax_account_key=case when i.id is null then m.nayax_account_key else i.account_key end
    where id=m.id returning * into updated;
  insert into public.admin_audit_log(actor_user_id,action,entity_type,entity_id,before,after,meta)
    values(auth.uid(),'reporting_machine.workspace_mapping_saved','reporting_machine',m.id::text,
      jsonb_build_object('venueLabel',m.venue_label,'nayaxMachineId',m.nayax_machine_id,'nayaxAccountKey',m.nayax_account_key),
      jsonb_build_object('venueLabel',updated.venue_label,'nayaxMachineId',updated.nayax_machine_id,'nayaxAccountKey',updated.nayax_account_key),
      jsonb_build_object('inventoryId',p_inventory_id,'reason','Explicit machine workspace setup'));
  return jsonb_build_object('machineId',m.id,'venueLabel',updated.venue_label,
    'nayaxMachineId',updated.nayax_machine_id,'nayaxAccountKey',updated.nayax_account_key);
end;
$$;
create function public.admin_link_sunze_source_to_machine(p_machine_id uuid,p_source_machine_id text)
returns uuid language plpgsql security definer set search_path='' as $$
declare m public.reporting_machines;
begin
  if auth.uid() is null or not coalesce(public.is_super_admin(auth.uid()),false) then
    raise exception 'Super Admin access required' using errcode='42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('machine-workspace-sunze:'||p_source_machine_id,1742));
  select * into m from public.reporting_machines where id=p_machine_id for update;
  if m.id is null then raise exception 'Machine not found' using errcode='22023'; end if;
  if nullif(btrim(m.sunze_machine_id),'') is not null and m.sunze_machine_id<>p_source_machine_id then
    raise exception 'This Hub machine already has a different Sunze source' using errcode='23505';
  end if;
  if not exists(select 1 from public.sunze_machine_discoveries where sunze_machine_id=p_source_machine_id) then
    raise exception 'Imported Sunze source not found' using errcode='22023';
  end if;
  if exists(select 1 from public.reporting_machines where sunze_machine_id=p_source_machine_id and id<>m.id) then
    raise exception 'This Sunze source is already linked to another Hub machine' using errcode='23505';
  end if;
  perform public.admin_upsert_reporting_machine_by_id(m.id,m.account_id,m.location_id,m.machine_label,
    m.machine_type,p_source_machine_id,m.operational_phase,'Explicit discovered Sunze source linked to existing Hub machine',m.account_id,m.location_id);
  return m.id;
end;
$$;
revoke all on function public.admin_link_sunze_source_to_machine(uuid,text), public.admin_get_machine_workspace_metadata(),
  public.admin_save_machine_workspace_mapping(uuid,text,uuid,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.admin_link_sunze_source_to_machine(uuid,text), public.admin_get_machine_workspace_metadata(),
  public.admin_save_machine_workspace_mapping(uuid,text,uuid,text,text,text) to authenticated;
select pg_notify('pgrst','reload schema');
