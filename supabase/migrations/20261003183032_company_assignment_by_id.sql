-- #1719: explicit company creation and atomic canonical company/location assignment.
-- No data normalization, provider/access provisioning or financial-history rewrite.
create function public.admin_get_reporting_company_choices()
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if auth.uid() is null or not coalesce(public.is_super_admin(auth.uid()),false) then
    raise exception 'Admin access required' using errcode='42501';
  end if;
  return jsonb_build_object('canCreateCompany',true,'companies',coalesce((
    select jsonb_agg(jsonb_build_object('accountId',a.id,'accountName',a.name,'status',a.status,
      'locations',coalesce((select jsonb_agg(jsonb_build_object('locationId',l.id,
        'locationName',l.name,'timezone',l.timezone,'status',l.status) order by l.name,l.id)
        from public.reporting_locations l where l.account_id=a.id),'[]'::jsonb)) order by a.name,a.id)
    from public.customer_accounts a),'[]'::jsonb));
end;
$$;

create function public.admin_create_reporting_company(p_name text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.customer_accounts; normalized text:=btrim(coalesce(p_name,'')); created boolean:=false;
begin
  if auth.uid() is null or not coalesce(public.is_super_admin(auth.uid()),false) then
    raise exception 'Admin access required' using errcode='42501';
  end if;
  if normalized='' then raise exception 'Company name is required' using errcode='22023'; end if;
  -- Serializes trim/case-equivalent explicit creates, including uncertain retries.
  -- Existing names/unique index are retained; no historical names are rewritten.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(lower(normalized),1719));
  select * into a from public.customer_accounts where lower(btrim(name))=lower(normalized)
    order by (lower(name)=lower(normalized)) desc,created_at,id limit 1;
  if a.id is null then
    insert into public.customer_accounts(name,account_type,created_by)
      values(normalized,'customer',auth.uid()) on conflict (lower(name)) do nothing returning * into a;
    if a.id is null then
      select * into a from public.customer_accounts where lower(name)=lower(normalized);
    else
      created:=true;
      insert into public.admin_audit_log(actor_user_id,action,entity_type,entity_id,before,after,meta)
        values(auth.uid(),'reporting_company.created','customer_account',a.id::text,'{}'::jsonb,
          to_jsonb(a),jsonb_build_object('reason','Explicit company creation'));
    end if;
  end if;
  return jsonb_build_object('accountId',a.id,'accountName',a.name,'status',a.status,'created',created);
end;
$$;

-- Keep the exact currently replayed source promotion and machine type validation.
-- Build a private ID-only writer from that definition, replacing only lookup and
-- reactivation. Fail closed if an earlier definition no longer has these seams.
do $migration$
declare definition text; first_pos integer; last_pos integer;
begin
  definition:=replace(pg_get_functiondef('public.admin_upsert_reporting_machine(uuid,text,text,text,text,text,text)'::regprocedure),E'\r\n',E'\n');
  definition:=replace(definition,'public.admin_upsert_reporting_machine(', 'private.upsert_reporting_machine_identity(');
  definition:=replace(definition,'p_account_name text','p_account_id uuid');
  definition:=replace(definition,'p_location_name text','p_location_id uuid');
  definition:=replace(definition,$old$normalized_account_name := trim(coalesce(p_account_name, ''));$old$,
    $new$select * into account_row from public.customer_accounts where id=p_account_id;
  normalized_account_name := account_row.name;$new$);
  definition:=replace(definition,$old$normalized_location_name := trim(coalesce(p_location_name, ''));$old$,
    $new$select * into location_row from public.reporting_locations where id=p_location_id and account_id=p_account_id;
  normalized_location_name := location_row.name;$new$);
  first_pos:=strpos(definition,E'  select *\n  into account_row');
  last_pos:=strpos(definition,'  if p_machine_id is not null then');
  if first_pos=0 or last_pos<=first_pos or strpos(definition,$old$status = 'active'$old$)=0 then
    raise exception 'Unexpected canonical machine writer definition';
  end if;
  definition:=substr(definition,1,first_pos-1)||substr(definition,last_pos);
  definition:=replace(definition,E'      sunze_machine_id = normalized_sunze_machine_id,\n      status = ''active''',
    '      sunze_machine_id = normalized_sunze_machine_id');
  -- The public wrapper locks and validates an explicit edit identity. Source ID
  -- discovery remains supported for source mapping with its own expected guard.
  execute definition;
end;
$migration$;
revoke all on function private.upsert_reporting_machine_identity(uuid,uuid,uuid,text,text,text,text) from public,anon,authenticated;

create function public.admin_upsert_reporting_machine_by_id(
  p_machine_id uuid, p_account_id uuid, p_location_id uuid,
  p_machine_label text, p_machine_type text, p_sunze_machine_id text,
  p_operational_phase text, p_reason text,
  p_expected_account_id uuid, p_expected_location_id uuid,
  p_new_location_name text default null, p_new_location_timezone text default null
)
returns public.reporting_machines language plpgsql security definer set search_path='' as $$
declare before_row public.reporting_machines; result public.reporting_machines;
  a public.customer_accounts; l public.reporting_locations;
  location_name text:=btrim(coalesce(p_new_location_name,'')); zone text:=btrim(coalesce(p_new_location_timezone,''));
begin
  if auth.uid() is null or not coalesce(public.is_super_admin(auth.uid()),false) then
    raise exception 'Admin access required' using errcode='42501';
  end if;
  perform public.reporting_admin_assert_reason(p_reason);
  if p_machine_id is not null then
    select * into before_row from public.reporting_machines where id=p_machine_id for update;
    if before_row.id is null then raise exception 'Machine not found' using errcode='22023'; end if;
  elsif nullif(btrim(p_sunze_machine_id),'') is not null then
    -- Source setup must not silently mutate a machine that appeared concurrently.
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(lower(btrim(p_sunze_machine_id)),1720));
    select * into before_row from public.reporting_machines where lower(sunze_machine_id)=lower(btrim(p_sunze_machine_id)) for update;
  end if;
  if before_row.id is not null and (before_row.account_id is distinct from p_expected_account_id
    or before_row.location_id is distinct from p_expected_location_id) then
    raise exception 'Company or location changed. Reload the machine and retry.' using errcode='40001';
  end if;
  if before_row.id is null and (p_expected_account_id is not null or p_expected_location_id is not null) then
    raise exception 'Machine assignment changed. Reload and retry.' using errcode='40001';
  end if;
  select * into a from public.customer_accounts where id=p_account_id for share;
  if a.id is null then raise exception 'Company not found' using errcode='22023'; end if;
  if a.status<>'active' and a.id is distinct from before_row.account_id then
    raise exception 'Choose an active company' using errcode='22023';
  end if;
  if p_location_id is not null then
    if location_name<>'' or zone<>'' then raise exception 'Choose a location or explicitly add one' using errcode='22023'; end if;
    select * into l from public.reporting_locations where id=p_location_id and account_id=a.id for share;
    if l.id is null then raise exception 'Location does not belong to the selected company' using errcode='22023'; end if;
    if l.status<>'active' and l.id is distinct from before_row.location_id then
      raise exception 'Choose an active location' using errcode='22023';
    end if;
  else
    if location_name='' then raise exception 'Choose a location or explicitly add one' using errcode='22023'; end if;
    if zone='' or not exists(select 1 from pg_catalog.pg_timezone_names where name=zone) then
      raise exception 'Choose a valid IANA location timezone' using errcode='22023';
    end if;
    -- Explicit create never silently chooses a same-named existing location.
    insert into public.reporting_locations(account_id,name,timezone) values(a.id,location_name,zone) returning * into l;
    insert into public.admin_audit_log(actor_user_id,action,entity_type,entity_id,before,after,meta)
      values(auth.uid(),'reporting_location.created','reporting_location',l.id::text,'{}'::jsonb,to_jsonb(l),
        jsonb_build_object('reason',btrim(p_reason),'machineId',before_row.id));
  end if;
  result:=private.upsert_reporting_machine_identity(before_row.id,a.id,l.id,
    p_machine_label,p_machine_type,p_sunze_machine_id,p_reason);
  result:=public.admin_set_reporting_machine_operational_phase(result.id,p_operational_phase,p_reason);
  return result;
end;
$$;

-- Existing callers may resolve exact names, but never create companies/locations.
create or replace function public.admin_upsert_reporting_machine(
  p_machine_id uuid,p_account_name text,p_location_name text,p_machine_label text,
  p_machine_type text,p_sunze_machine_id text,p_reason text
) returns public.reporting_machines language plpgsql security definer set search_path='' as $$
declare a uuid; l uuid; m public.reporting_machines;
begin
  if auth.uid() is null or not coalesce(public.is_super_admin(auth.uid()),false) then
    raise exception 'Admin access required' using errcode='42501';
  end if;
  select id into a from public.customer_accounts where lower(name)=lower(btrim(p_account_name));
  if a is null then raise exception 'Choose an existing company; use Add company to create one' using errcode='22023'; end if;
  select id into l from public.reporting_locations where account_id=a and lower(name)=lower(btrim(p_location_name));
  if l is null then raise exception 'Choose an existing location; use Add location to create one' using errcode='22023'; end if;
  if p_machine_id is not null then
    select * into m from public.reporting_machines where id=p_machine_id for update;
    if m.id is null then raise exception 'Machine not found' using errcode='22023'; end if;
  elsif nullif(btrim(p_sunze_machine_id),'') is not null then
    select * into m from public.reporting_machines where lower(sunze_machine_id)=lower(btrim(p_sunze_machine_id)) for update;
  end if;
  -- Legacy APIs carry no expected assignment. Permit compatible ordinary edits;
  -- any reassignment must use the explicit guarded ID endpoint.
  if m.id is not null and (m.account_id<>a or m.location_id<>l) then
    raise exception 'Company changes require the ID-based machine save' using errcode='22023';
  end if;
  return public.admin_upsert_reporting_machine_by_id(coalesce(p_machine_id,m.id),a,l,p_machine_label,p_machine_type,
    p_sunze_machine_id,coalesce(m.operational_phase,'live'),p_reason,m.account_id,m.location_id);
end;
$$;

-- The existing scoped-admin projection remains authoritative; only its visible
-- machine rows gain canonical identity and current location timezone.
do $migration$
declare definition text;
begin
  definition:=replace(pg_get_functiondef('public.admin_get_partnership_reporting_setup()'::regprocedure),E'\r\n',E'\n');
  if strpos(definition,'      account.name as account_name,')=0 then raise exception 'Unexpected machine setup projection'; end if;
  definition:=replace(definition,'      account.name as account_name,',E'      machine.account_id,\n      machine.location_id,\n      location.timezone as location_timezone,\n      account.name as account_name,');
  definition:=replace(definition,'group by machine.id, account.name, location.name','group by machine.id, account.name, location.name, location.timezone');
  execute definition;
end;
$migration$;

revoke all on function public.admin_get_reporting_company_choices(),public.admin_create_reporting_company(text),
  public.admin_upsert_reporting_machine_by_id(uuid,uuid,uuid,text,text,text,text,text,uuid,uuid,text,text) from public,anon;
grant execute on function public.admin_get_reporting_company_choices(),public.admin_create_reporting_company(text),
  public.admin_upsert_reporting_machine_by_id(uuid,uuid,uuid,text,text,text,text,text,uuid,uuid,text,text) to authenticated;
select pg_notify('pgrst','reload schema');
