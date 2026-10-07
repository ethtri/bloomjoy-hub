begin;

-- Ordinary name/company edits do not own the read-only provider identity.
do $patch$
declare definition text; anchor text := 'coalesce(machine.machine_label,p_machine_label),p_machine_type,p_sunze_machine_id,';
begin
  definition := replace(pg_get_functiondef('public.admin_save_named_machine(uuid,uuid,uuid,text,text,text,text,text,uuid,uuid,text,text,text)'::regprocedure),E'\r\n',E'\n');
  if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then
    raise exception 'Named machine source preservation anchor changed';
  end if;
  execute replace(definition,anchor,'coalesce(machine.machine_label,p_machine_label),p_machine_type,case when p_machine_id is not null then machine.sunze_machine_id else p_sunze_machine_id end,');
end; $patch$;

create function private.assert_completed_machine_source_identity(p_machine_id uuid)
returns void language plpgsql security definer set search_path='' as $fn$
begin
  if exists(select 1 from private.machine_source_management_associations association
    where association.reporting_machine_id=p_machine_id and not exists(
      select 1 from public.reporting_machines machine
      join private.machine_card_financial_policies policy on policy.reporting_machine_id=machine.id
      where machine.id=association.reporting_machine_id and case when association.platform='Sunze'
        then machine.sunze_machine_id is not distinct from association.source_id
        else exists(select 1 from private.snapcase_machine_mappings mapping
          where mapping.reporting_machine_id=machine.id and mapping.provider_account_id=association.provider_account_id
            and mapping.source_machine_id=association.source_id) end)) then
    raise exception 'Completed source identity must stay connected. Reload and review this machine.' using errcode='22023';
  end if;
end; $fn$;
revoke all on function private.assert_completed_machine_source_identity(uuid) from public,anon,authenticated,service_role;

create function private.guard_completed_machine_source_identity()
returns trigger language plpgsql security definer set search_path='' as $fn$
begin
  if tg_table_name='reporting_machines' then
    perform private.assert_completed_machine_source_identity(new.id);
  else
    perform private.assert_completed_machine_source_identity(old.reporting_machine_id);
    if tg_op='UPDATE' and new.reporting_machine_id is distinct from old.reporting_machine_id then
      perform private.assert_completed_machine_source_identity(new.reporting_machine_id);
    end if;
  end if;
  return null;
end; $fn$;
revoke all on function private.guard_completed_machine_source_identity() from public,anon,authenticated,service_role;
create constraint trigger completed_source_machine_identity
  after update on public.reporting_machines deferrable initially deferred
  for each row execute function private.guard_completed_machine_source_identity();
create constraint trigger completed_source_kex_identity
  after update or delete on private.snapcase_machine_mappings deferrable initially deferred
  for each row execute function private.guard_completed_machine_source_identity();

-- Explicit recovery of a proved prior same-machine association; never replay orders.
create function public.admin_restore_completed_sunze_identity(
  p_machine_id uuid,p_source_id text,p_inventory_id uuid,p_expected_updated_at timestamptz,p_reason text
) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare machine public.reporting_machines; reader public.refund_nayax_machine_inventory; result public.reporting_machines;
begin
  if auth.uid() is null or not coalesce(public.is_super_admin(auth.uid()),false) then
    raise exception 'Super admin access required' using errcode='42501';
  end if;
  perform public.reporting_admin_assert_reason(p_reason);
  perform pg_catalog.pg_advisory_xact_lock(1746,1);
  select * into machine from public.reporting_machines where id=p_machine_id for update nowait;
  select * into reader from public.refund_nayax_machine_inventory where id=p_inventory_id for update nowait;
  if machine.id is null or reader.id is null or p_expected_updated_at is null
    or machine.updated_at is distinct from p_expected_updated_at
    or reader.reporting_machine_id is distinct from machine.id
    or reader.nayax_machine_id is distinct from machine.nayax_machine_id
    or reader.account_key is distinct from upper(coalesce(nullif(btrim(machine.nayax_account_key),''),'TGPACI_USA_DB')) then
    raise exception 'Machine or reader changed. Reload and review.' using errcode='40001';
  end if;
  if machine.management_archived_at is not null or machine.sunze_machine_id is not null
    or nullif(btrim(p_source_id),'') is null
    or not exists(select 1 from private.machine_card_financial_policies where reporting_machine_id=machine.id)
    or not exists(select 1 from private.machine_source_management_associations
      where reporting_machine_id=machine.id and platform='Sunze' and provider_account_id is null and source_id=p_source_id)
    or exists(select 1 from private.machine_source_management_associations
      where reporting_machine_id=machine.id and (platform<>'Sunze' or source_id<>p_source_id))
    or exists(select 1 from public.reporting_machines where id<>machine.id and sunze_machine_id=p_source_id)
    or not exists(select 1 from public.sunze_machine_discoveries where sunze_machine_id=p_source_id and reporting_machine_id=machine.id)
    or exists(select 1 from private.snapcase_machine_mappings where reporting_machine_id=machine.id) then
    raise exception 'Recovery requires the exact previously confirmed source and machine.' using errcode='22023';
  end if;
  result := private.upsert_reporting_machine_identity(machine.id,machine.account_id,machine.location_id,
    machine.machine_label,machine.machine_type,p_source_id,p_reason,false);
  perform private.assert_completed_machine_source_identity(machine.id);
  insert into public.admin_audit_log(actor_user_id,action,entity_type,entity_id,before,after,meta)
  values(auth.uid(),'reporting_machine.completed_source_restored','reporting_machine',machine.id::text,
    jsonb_build_object('sourceId',machine.sunze_machine_id),jsonb_build_object('sourceId',p_source_id),
    jsonb_build_object('reason',p_reason,'inventoryId',reader.id,'readerId',reader.nayax_machine_id,
      'readerAccount',reader.account_key,'promotedPendingCount',0,'financialPolicyUnchanged',true));
  return jsonb_build_object('machineId',machine.id,'sourceId',p_source_id,'promotedPendingCount',0);
exception when lock_not_available then
  raise exception 'Machine is being changed. Reload and retry.' using errcode='40001';
end; $fn$;
revoke all on function public.admin_restore_completed_sunze_identity(uuid,text,uuid,timestamptz,text) from public,anon;
grant execute on function public.admin_restore_completed_sunze_identity(uuid,text,uuid,timestamptz,text) to authenticated;

commit;
