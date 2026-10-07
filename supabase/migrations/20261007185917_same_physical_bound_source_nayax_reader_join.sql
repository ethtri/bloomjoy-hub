-- #1815: an explicit same-physical-machine correction is not a dated reader move.
-- Original facts, accounts, Managers, cases and accounting assignments stay put.
alter table private.machine_nayax_reader_associations
  drop constraint machine_nayax_reader_associations_ownership_basis_check,
  drop constraint machine_nayax_reader_associations_check,
  drop constraint machine_nayax_reader_associations_check2;
alter table private.machine_nayax_reader_associations
  add constraint machine_nayax_reader_associations_ownership_basis_check check (
    ownership_basis in ('same_physical_machine_all_history','reviewed_physical_reader_change',
      'reviewed_calendar_reader_change','original_transactions_only','retired_same_physical_machine_duplicate')),
  add constraint machine_nayax_reader_associations_check check (
    (effective_until is null and closed_on is null and closed_timezone is null
      and closed_at is null and closed_by is null and close_reason is null)
    or ((effective_until is not null or closed_on is not null
        or ownership_basis='retired_same_physical_machine_duplicate')
      and closed_at is not null and closed_by is not null and nullif(btrim(close_reason),'') is not null)),
  add constraint machine_nayax_reader_associations_check2 check (
    (ownership_basis='same_physical_machine_all_history' and effective_from is null
      and effective_from_date is null and effective_timezone is null)
    or (ownership_basis='reviewed_physical_reader_change' and effective_from is not null
      and effective_from_date is not null and effective_timezone is not null)
    or (ownership_basis='reviewed_calendar_reader_change' and effective_from is null
      and effective_from_date is not null and effective_timezone is not null)
    or (ownership_basis='original_transactions_only' and effective_from is null
      and effective_from_date is null and effective_timezone is null and closed_at is not null)
    or (ownership_basis='retired_same_physical_machine_duplicate' and effective_from is null
      and effective_from_date is null and effective_timezone is null and effective_until is null
      and closed_on is null and closed_timezone is null and closed_at is not null));

create function private.same_physical_reader_legacy_owner(
  p_machine_id uuid,p_account_key text,p_reader_id text,p_original_owner uuid
) returns boolean language sql stable security definer set search_path='' as $fn$
  select p_machine_id<>p_original_owner and exists(
    select 1 from private.machine_nayax_reader_associations current_reader
    join private.machine_nayax_reader_associations retained
      on retained.account_key=current_reader.account_key and retained.nayax_machine_id=current_reader.nayax_machine_id
    join public.reporting_machines old_machine on old_machine.id=retained.reporting_machine_id
    where current_reader.reporting_machine_id=p_machine_id and current_reader.account_key=upper(btrim(p_account_key))
      and current_reader.nayax_machine_id=btrim(p_reader_id)
      and current_reader.ownership_basis='same_physical_machine_all_history' and current_reader.closed_at is null
      and retained.reporting_machine_id=p_original_owner
      and retained.ownership_basis='retired_same_physical_machine_duplicate' and retained.closed_at is not null
      and old_machine.management_archived_at is not null);
$fn$;
revoke all on function private.same_physical_reader_legacy_owner(uuid,text,text,uuid) from public,anon,authenticated;

create function private.bound_machine_source_identity_digest(p_machine_id uuid)
returns text language sql stable security definer set search_path='' as $fn$
  select md5(jsonb_build_object('sunzeId',m.sunze_machine_id,'sunzeDiscoveryOwner',
    (select d.reporting_machine_id from public.sunze_machine_discoveries d where d.sunze_machine_id=m.sunze_machine_id),
    'kexMappings',coalesce((select jsonb_agg(jsonb_build_object('id',k.id,'account',k.provider_account_id,
      'sourceId',k.source_machine_id,'start',k.effective_start_date,'end',k.effective_end_date,
      'updatedAt',k.updated_at,'mappedAt',k.mapped_at) order by k.id)
      from private.snapcase_machine_mappings k where k.reporting_machine_id=m.id
        and k.effective_start_date<=current_date and coalesce(k.effective_end_date,'infinity'::date)>=current_date),'[]'::jsonb))::text)
  from public.reporting_machines m where m.id=p_machine_id;
$fn$;
revoke all on function private.bound_machine_source_identity_digest(uuid) from public,anon,authenticated;

create function private.same_physical_reader_join_blocker(p_machine_id uuid,p_inventory_id uuid)
returns text language plpgsql stable security definer set search_path='' as $fn$
declare machine public.reporting_machines; owner public.reporting_machines;
  reader public.refund_nayax_machine_inventory; zone text; owner_zone text; source_count integer;
begin
  select * into machine from public.reporting_machines where id=p_machine_id;
  select * into reader from public.refund_nayax_machine_inventory where id=p_inventory_id;
  select * into owner from public.reporting_machines where id=reader.reporting_machine_id;
  if machine.id is null or reader.id is null or owner.id is null or machine.id=owner.id then return 'Select a reader connected to a separate historical machine record.'; end if;
  if machine.management_archived_at is not null or owner.management_archived_at is not null
    or machine.status<>'active' or owner.status<>'active'
    or machine.operational_phase<>'live' then return 'Both machine records must be active and the selected source machine must be Live.'; end if;
  if nullif(btrim(machine.nayax_machine_id),'') is not null then return 'The selected source machine already has a reader. Review its actual reader change instead.'; end if;
  if not reader.provider_is_active or reader.missing_successful_snapshots>=2 then return 'Refresh or review the inactive reader before connecting it.'; end if;
  if owner.nayax_machine_id is distinct from reader.nayax_machine_id
    or upper(coalesce(nullif(btrim(owner.nayax_account_key),''),'TGPACI_USA_DB')) is distinct from reader.account_key then return 'The historical record does not hold this exact reader connection.'; end if;
  if machine.machine_type not in ('commercial','mini','micro','snapcase')
    or owner.machine_type is distinct from machine.machine_type then return 'Review the saved machine types before confirming the same physical machine.'; end if;
  if private.machine_source_reuse_blocker(owner.id) is not null then return 'The reader belongs to another source machine; use the reviewed reader-change action.'; end if;
  select timezone into zone from public.reporting_locations where id=machine.location_id and status='active';
  select timezone into owner_zone from public.reporting_locations where id=owner.location_id and status='active';
  if zone is null or owner_zone is distinct from zone
    or not exists(select 1 from pg_catalog.pg_timezone_names where name=zone) then return 'Review both saved machine time zones before confirming the same physical machine.'; end if;
  select count(*) into source_count from (
    select 'Sunze' where nullif(btrim(machine.sunze_machine_id),'') is not null
      and exists(select 1 from public.sunze_machine_discoveries d where d.sunze_machine_id=machine.sunze_machine_id
        and d.catalogue_inactive_at is null)
    union all
    select distinct k.provider_account_id::text||':'||k.source_machine_id
    from private.snapcase_machine_mappings k join private.snapcase_source_machines source
      on source.provider_account_id=k.provider_account_id and source.source_machine_id=k.source_machine_id
    where k.reporting_machine_id=machine.id and k.effective_start_date<=current_date
      and coalesce(k.effective_end_date,'infinity'::date)>=current_date and source.catalogue_inactive_at is null
  ) sources;
  if source_count<>1 then return 'The selected machine must have one current active imported source connection.'; end if;
  if exists(select 1 from public.sunze_machine_discoveries d where d.sunze_machine_id=machine.sunze_machine_id
      and d.reporting_machine_id is not null and d.reporting_machine_id<>machine.id)
    or exists(select 1 from public.reporting_machines other where other.id<>machine.id
      and nullif(btrim(machine.sunze_machine_id),'') is not null and other.sunze_machine_id=machine.sunze_machine_id)
    or exists(select 1 from private.snapcase_machine_mappings chosen join private.snapcase_machine_mappings other
      on other.provider_account_id=chosen.provider_account_id and other.source_machine_id=chosen.source_machine_id
      where chosen.reporting_machine_id=machine.id and other.reporting_machine_id<>machine.id
        and chosen.effective_start_date<=current_date and coalesce(chosen.effective_end_date,'infinity'::date)>=current_date
        and other.effective_start_date<=current_date and coalesce(other.effective_end_date,'infinity'::date)>=current_date)
    or exists(select 1 from private.machine_source_management_associations association
      where association.reporting_machine_id<>machine.id and (
        (association.platform='Sunze' and association.source_id=machine.sunze_machine_id)
        or (association.platform='Kexiaozhan' and exists(select 1 from private.snapcase_machine_mappings chosen
          where chosen.reporting_machine_id=machine.id and chosen.provider_account_id=association.provider_account_id
            and chosen.source_machine_id=association.source_id)))) then return 'The imported source has conflicting machine ownership. Review its exact source connection first.'; end if;
  if exists(select 1 from private.machine_nayax_reader_associations a
    where a.reporting_machine_id in (machine.id,owner.id)
      or (a.account_key=reader.account_key and a.nayax_machine_id=reader.nayax_machine_id)) then return 'Reader ownership has reviewed history. Use the existing reader reconciliation action.'; end if;
  if exists(select 1 from unnest(private.original_reader_machine_owners(reader.account_key,reader.nayax_machine_id)) original_owner
    where original_owner<>owner.id) then return 'This reader has other retained transaction owners. Review its ownership history.'; end if;
  if exists(select 1 from public.reporting_machines other where other.id not in (machine.id,owner.id)
    and other.nayax_machine_id=reader.nayax_machine_id
    and upper(coalesce(nullif(btrim(other.nayax_account_key),''),'TGPACI_USA_DB'))=reader.account_key) then return 'This reader has another current machine connection.'; end if;
  return null;
end; $fn$;
revoke all on function private.same_physical_reader_join_blocker(uuid,uuid) from public,anon,authenticated;

create function public.admin_preview_same_physical_machine_reader_join(p_machine_id uuid,p_inventory_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $fn$
declare machine public.reporting_machines; owner public.reporting_machines;
  reader public.refund_nayax_machine_inventory; blocker text;
begin
  if auth.uid() is null or not coalesce(public.is_super_admin(auth.uid()),false) then raise exception 'Super admin access required' using errcode='42501'; end if;
  select * into machine from public.reporting_machines where id=p_machine_id;
  select * into reader from public.refund_nayax_machine_inventory where id=p_inventory_id;
  select * into owner from public.reporting_machines where id=reader.reporting_machine_id;
  blocker:=private.same_physical_reader_join_blocker(p_machine_id,p_inventory_id);
  return jsonb_build_object('eligible',blocker is null,'reason',blocker,'machineId',machine.id,
    'machineName',private.reporting_machine_display_name(machine),'companyId',machine.account_id,
    'inventoryId',reader.id,'readerId',reader.nayax_machine_id,'accountKey',reader.account_key,
    'historicalMachineId',owner.id,'historicalMachineName',coalesce(nullif(btrim(owner.machine_display_name),''),owner.machine_label),
    'expectedMachineUpdatedAt',machine.updated_at,'expectedHistoricalMachineUpdatedAt',owner.updated_at,
    'expectedInventoryUpdatedAt',reader.updated_at,
    'expectedSourceIdentityDigest',private.bound_machine_source_identity_digest(machine.id),
    'historicalCardTransactionCount',(select count(*) from public.machine_sales_facts f where f.reporting_machine_id=owner.id and f.source='nayax_scheduled_report' and f.payment_method='credit'),
    'historicalRefundCaseCount',(select count(*) from public.refund_cases c where c.reporting_machine_id=owner.id));
end; $fn$;
revoke all on function public.admin_preview_same_physical_machine_reader_join(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_preview_same_physical_machine_reader_join(uuid,uuid) to authenticated;

create function public.admin_join_same_physical_machine_reader(
  p_machine_id uuid,p_inventory_id uuid,p_expected_machine_updated_at timestamptz,
  p_expected_historical_machine_id uuid,p_expected_historical_machine_updated_at timestamptz,
  p_expected_inventory_updated_at timestamptz,p_expected_source_identity_digest text,
  p_confirm_same_machine boolean,p_reason text
) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare machine public.reporting_machines; owner public.reporting_machines;
  reader public.refund_nayax_machine_inventory; blocker text; previous_change text; previous_replacement text;
begin
  if auth.uid() is null or not coalesce(public.is_super_admin(auth.uid()),false) then raise exception 'Super admin access required' using errcode='42501'; end if;
  if p_confirm_same_machine is not true then raise exception 'Confirm that these records describe the same physical machine.' using errcode='22023'; end if;
  perform public.reporting_admin_assert_reason(p_reason);
  perform pg_catalog.pg_advisory_xact_lock(1742,1);
  perform pg_catalog.pg_advisory_xact_lock(1746,1);
  perform id from public.reporting_machines where id in (p_machine_id,p_expected_historical_machine_id) order by id for update nowait;
  select * into machine from public.reporting_machines where id=p_machine_id;
  select * into owner from public.reporting_machines where id=p_expected_historical_machine_id;
  select * into reader from public.refund_nayax_machine_inventory where id=p_inventory_id for update nowait;
  if machine.id is null or owner.id is null or reader.id is null
    or p_expected_machine_updated_at is null or p_expected_historical_machine_updated_at is null
    or p_expected_inventory_updated_at is null
    or machine.updated_at is distinct from p_expected_machine_updated_at
    or owner.updated_at is distinct from p_expected_historical_machine_updated_at
    or reader.updated_at is distinct from p_expected_inventory_updated_at
    or reader.reporting_machine_id is distinct from owner.id then raise exception 'Machine or reader changed. Reload and review the exact connection.' using errcode='40001'; end if;
  -- Lock current source rows as well as the machine snapshot; the source itself
  -- is never remapped or financially replayed by this administrative correction.
  perform 1 from public.sunze_machine_discoveries where sunze_machine_id=machine.sunze_machine_id for update nowait;
  perform 1 from private.snapcase_machine_mappings where reporting_machine_id=machine.id for update nowait;
  perform 1 from private.snapcase_source_machines source where exists(select 1 from private.snapcase_machine_mappings k
    where k.reporting_machine_id=machine.id and k.provider_account_id=source.provider_account_id
      and k.source_machine_id=source.source_machine_id) for update nowait;
  if p_expected_source_identity_digest is null or p_expected_source_identity_digest
    is distinct from private.bound_machine_source_identity_digest(machine.id) then
    raise exception 'Imported source connection changed. Reload and review.' using errcode='40001';
  end if;
  blocker:=private.same_physical_reader_join_blocker(machine.id,reader.id);
  if blocker is not null then raise exception '%',blocker using errcode='22023'; end if;
  perform private.establish_machine_card_financial_policy(machine.id,p_reason,false);
  perform private.establish_machine_card_financial_policy(owner.id,p_reason,false);
  insert into private.machine_nayax_reader_associations(account_key,nayax_machine_id,reporting_machine_id,
    ownership_basis,created_by,reason,closed_at,closed_by,close_reason)
    values(reader.account_key,reader.nayax_machine_id,owner.id,'retired_same_physical_machine_duplicate',
      auth.uid(),btrim(p_reason),statement_timestamp(),auth.uid(),btrim(p_reason));
  insert into private.machine_nayax_reader_associations(account_key,nayax_machine_id,reporting_machine_id,
    ownership_basis,created_by,reason)
    values(reader.account_key,reader.nayax_machine_id,machine.id,'same_physical_machine_all_history',auth.uid(),btrim(p_reason));
  previous_change:=current_setting('app.machine_reader_change',true);
  previous_replacement:=current_setting('app.nayax_reader_replacement',true);
  perform set_config('app.machine_reader_change','1',true);
  perform set_config('app.nayax_reader_replacement','1',true);
  perform public.admin_set_reporting_machine_nayax_config(owner.id,null,null,p_reason);
  perform public.admin_set_reporting_machine_nayax_config(machine.id,reader.nayax_machine_id,reader.account_key,p_reason);
  update public.refund_nayax_machine_inventory set reporting_machine_id=machine.id,reconciliation_state='needs_setup',
    refund_category=case when machine.machine_type='snapcase' then 'snapcase' else 'cotton_candy' end,
    exclusion_reason=null,setup_reason='machine_setup_incomplete',decision_reason=btrim(p_reason),
    decided_by=auth.uid(),decided_at=statement_timestamp(),updated_at=statement_timestamp() where id=reader.id;
  -- Canonical writers may reset matching/card-start defaults. Preserve every
  -- existing per-machine capability; this action grants no payment capability.
  update public.reporting_machines set refund_intake_enabled=machine.refund_intake_enabled,
    nayax_card_sales_started_on=machine.nayax_card_sales_started_on where id=machine.id;
  update public.reporting_machines set refund_intake_enabled=owner.refund_intake_enabled,
    nayax_card_sales_started_on=owner.nayax_card_sales_started_on where id=owner.id;
  perform set_config('app.nayax_reader_replacement',coalesce(previous_replacement,''),true);
  perform set_config('app.machine_reader_change',coalesce(previous_change,''),true);
  perform public.admin_set_machine_management_archive(owner.id,true,p_reason,
    (select updated_at from public.reporting_machines where id=owner.id));
  insert into public.admin_audit_log(actor_user_id,action,entity_type,entity_id,before,after,meta)
    values(auth.uid(),'reporting_machine.same_physical_duplicate_connected','reporting_machine',machine.id::text,
      jsonb_build_object('currentMachine',to_jsonb(machine),'historicalMachine',to_jsonb(owner),'inventory',to_jsonb(reader)),
      jsonb_build_object('currentMachineId',machine.id,'retainedHistoricalMachineId',owner.id,'inventoryId',reader.id),
      jsonb_build_object('reason',btrim(p_reason),'physicalChangeDate',null,'historicalFinancialFactsUnchanged',true,
        'historicalRefundCasesUnchanged',true,'paymentCapabilityUnchanged',true));
  return jsonb_build_object('machineId',machine.id,'retainedHistoricalMachineId',owner.id,'inventoryId',reader.id);
exception when lock_not_available then raise exception 'Machine or reader is being updated. Reload and retry.' using errcode='40001';
end; $fn$;
revoke all on function public.admin_join_same_physical_machine_reader(uuid,uuid,timestamptz,uuid,timestamptz,timestamptz,text,boolean,text) from public,anon,authenticated,service_role;
grant execute on function public.admin_join_same_physical_machine_reader(uuid,uuid,timestamptz,uuid,timestamptz,timestamptz,text,boolean,text) to authenticated;

-- A confirmed former duplicate has the same attested reader for its retained
-- cases even when a denied/rough-time case has no original transaction match.
-- This is limited to exactly one association; actual replacements stay blocked.
do $patch$
declare definition text; anchor text;
begin
  definition:=replace(pg_get_functiondef('public.service_refund_case_reader_identity(uuid,uuid)'::regprocedure),E'\r\n',E'\n');
  anchor:=$old$  if tuple_count=1 and exists(select 1 from private.machine_nayax_reader_associations$old$;
  if strpos(definition,anchor)=0 then raise exception 'Original case reader fallback changed'; end if;
  definition:=replace(definition,anchor,$new$  if tuple_count=1 and exists(select 1 from private.machine_nayax_reader_associations retired
    where retired.reporting_machine_id=machine.id
      and retired.ownership_basis='retired_same_physical_machine_duplicate' and retired.closed_at is not null
      and exists(select 1 from private.machine_nayax_reader_associations current_reader
        where current_reader.account_key=retired.account_key and current_reader.nayax_machine_id=retired.nayax_machine_id
          and current_reader.reporting_machine_id<>retired.reporting_machine_id
          and current_reader.ownership_basis='same_physical_machine_all_history' and current_reader.closed_at is null)) then
    return tuples->0||jsonb_build_object('basis','retained_same_physical_duplicate_reader');
  end if;
  if tuple_count=1 and exists(select 1 from private.machine_nayax_reader_associations$new$);
  execute definition;
  definition:=replace(pg_get_functiondef('public.admin_save_machine_workspace_mapping(uuid,text,uuid,text,text,text)'::regprocedure),E'\r\n',E'\n');
  anchor:='where historical_owner<>m.id)';
  if strpos(definition,anchor)=0 then raise exception 'Ordinary workspace original-owner guard changed'; end if;
  execute replace(definition,anchor,'where historical_owner<>m.id and not private.same_physical_reader_legacy_owner(m.id,i.account_key,i.nayax_machine_id,historical_owner))');
end; $patch$;
