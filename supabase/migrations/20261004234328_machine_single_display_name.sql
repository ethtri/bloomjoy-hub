-- Existing public wording remains the effective name until an explicit edit.
-- No name backfill and no machine/location/provider assignment changes.
alter table public.reporting_machines add column display_name text
  check (display_name is null or (length(btrim(display_name)) between 1 and 120));

create function private.keep_machine_display_name_projection()
returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op='UPDATE' and old.display_name is not null
    and new.display_name is not distinct from old.display_name
    and (new.machine_label is distinct from old.machine_label
      or new.refund_public_display_label is distinct from old.refund_public_display_label) then
    raise exception 'Machine name is managed in Machines. Reload and edit the single Machine name field.' using errcode='40001';
  end if;
  if new.display_name is not null then
    new.display_name := btrim(new.display_name);
    new.machine_label := new.display_name;
    new.refund_public_display_label := new.display_name;
  end if;
  return new;
end;
$$;
revoke all on function private.keep_machine_display_name_projection() from public,anon,authenticated;
create trigger machine_display_name_projection before insert or update
on public.reporting_machines for each row execute function private.keep_machine_display_name_projection();

create function public.admin_set_machine_display_name(
  p_machine_id uuid,p_display_name text,p_expected_display_name text
) returns void language plpgsql security definer set search_path='' as $$
declare machine public.reporting_machines; effective_name text;
begin
  if auth.uid() is null or not coalesce(public.is_super_admin(auth.uid()),false) then
    raise exception 'Super Admin access required' using errcode='42501';
  end if;
  if nullif(btrim(p_display_name),'') is null or length(btrim(p_display_name))>120 then
    raise exception 'Machine name must be 1–120 characters' using errcode='22023';
  end if;
  select * into machine from public.reporting_machines where id=p_machine_id for update;
  if not found then raise exception 'Machine not found' using errcode='22023'; end if;
  effective_name:=coalesce(nullif(btrim(machine.display_name),''),nullif(btrim(machine.refund_public_display_label),''),machine.machine_label);
  if effective_name is distinct from p_expected_display_name then
    raise exception 'Machine name changed. Reload and retry.' using errcode='40001';
  end if;
  update public.reporting_machines set display_name=btrim(p_display_name),updated_at=now() where id=p_machine_id;
  insert into public.admin_audit_log(actor_user_id,action,entity_type,entity_id,before,after,meta)
  values(auth.uid(),'reporting_machine.display_name_saved','reporting_machine',p_machine_id::text,
    jsonb_build_object('displayName',effective_name),jsonb_build_object('displayName',btrim(p_display_name)),
    jsonb_build_object('reason','Explicit machine display name edit'));
end;
$$;
revoke all on function public.admin_set_machine_display_name(uuid,text,text) from public,anon;
grant execute on function public.admin_set_machine_display_name(uuid,text,text) to authenticated;

-- Name and company/type setup share a transaction. An unrelated save keeps
-- legacy names untouched; explicit name edits synchronize public projection.
create function public.admin_save_named_machine(
  p_machine_id uuid,p_account_id uuid,p_location_id uuid,p_machine_label text,
  p_machine_type text,p_sunze_machine_id text,p_operational_phase text,p_reason text,
  p_expected_account_id uuid,p_expected_location_id uuid,p_new_location_name text,
  p_new_location_timezone text,p_expected_display_name text
) returns public.reporting_machines language plpgsql security definer set search_path='' as $$
declare machine public.reporting_machines; result public.reporting_machines; effective_name text;
begin
  if auth.uid() is null or not coalesce(public.is_super_admin(auth.uid()),false) then
    raise exception 'Super Admin access required' using errcode='42501';
  end if;
  if p_machine_id is not null then
    select * into machine from public.reporting_machines where id=p_machine_id for update;
    if not found then raise exception 'Machine not found' using errcode='22023'; end if;
    effective_name:=coalesce(nullif(btrim(machine.display_name),''),nullif(btrim(machine.refund_public_display_label),''),machine.machine_label);
    if effective_name is distinct from p_expected_display_name then
      raise exception 'Machine name changed. Reload and retry.' using errcode='40001';
    end if;
  end if;
  if nullif(btrim(p_machine_label),'') is null or length(btrim(p_machine_label))>120 then
    raise exception 'Machine name must be 1–120 characters' using errcode='22023';
  end if;
  result:=private.upsert_reporting_machine_by_id(p_machine_id,p_account_id,p_location_id,
    coalesce(machine.machine_label,p_machine_label),p_machine_type,p_sunze_machine_id,
    p_operational_phase,p_reason,p_expected_account_id,p_expected_location_id,
    p_new_location_name,p_new_location_timezone);
  if p_machine_id is null or btrim(p_machine_label) is distinct from effective_name then
    perform public.admin_set_machine_display_name(result.id,p_machine_label,
      coalesce(effective_name,result.machine_label));
    select * into result from public.reporting_machines where id=result.id;
  end if;
  return result;
end;
$$;
revoke all on function public.admin_save_named_machine(uuid,uuid,uuid,text,text,text,text,text,uuid,uuid,text,text,text) from public,anon;
grant execute on function public.admin_save_named_machine(uuid,uuid,uuid,text,text,text,text,text,uuid,uuid,text,text,text) to authenticated;

comment on column public.reporting_machines.display_name is
  'Explicit canonical admin/customer machine name. NULL preserves legacy public wording, then internal alias. Source names and shared reporting location/timezone remain independent.';

-- Preserve scoped projection and stable machine UUIDs; expose the effective
-- customer name and retain the raw alias for unrelated identity saves.
do $migration$
declare definition text;
begin
  definition:=replace(pg_get_functiondef('public.admin_get_partnership_reporting_setup()'::regprocedure),E'\r\n',E'\n');
  if strpos(definition,E'      machine.id,\n      machine.machine_label,')=0 then
    raise exception 'Unexpected machine setup projection';
  end if;
  definition:=replace(definition,E'      machine.id,\n      machine.machine_label,',
    E'      machine.id,\n      machine.machine_label as stored_machine_label,\n      coalesce(nullif(btrim(machine.display_name),''''),nullif(btrim(machine.refund_public_display_label),''''),machine.machine_label) as machine_label,');
  execute definition;
end;
$migration$;
select pg_notify('pgrst','reload schema');
