-- #1719: imported machine setup chooses a company independently of settlement.
do $migration$
declare definition text; first_pos integer; last_pos integer;
begin
  definition:=replace(pg_get_functiondef('public.admin_map_source_machine_to_partnership(text,uuid,text,text,text,numeric,date,date,date,text)'::regprocedure),E'\r\n',E'\n');
  definition:=replace(definition,'public.admin_map_source_machine_to_partnership(', 'public.admin_map_source_machine_to_partnership_by_id(');
  definition:=replace(definition,'p_reason text)',
    'p_reason text, p_account_id uuid, p_location_id uuid, p_location_timezone text, p_expected_account_id uuid, p_expected_location_id uuid)');
  definition:=replace(definition,$old$  if normalized_location_name = '' then$old$,
    $new$  if p_location_id is null and normalized_location_name = '' then$new$);
  first_pos:=strpos(definition,'  select partner.*');
  last_pos:=strpos(definition,'  insert into public.sunze_machine_discoveries');
  if first_pos=0 or last_pos<=first_pos or strpos(definition,'p_expected_account_id uuid')=0 then
    raise exception 'Unexpected source machine setup definition';
  end if;
  definition:=substr(definition,1,first_pos-1)||$replacement$
  select * into before_machine from public.reporting_machines
    where lower(sunze_machine_id)=lower(normalized_external_machine_id) for update;
  select count(*)::integer,coalesce(sum(net_sales_cents),0)::bigint
    into promoted_row_count,promoted_revenue_cents from public.sunze_unmapped_sales
    where lower(sunze_machine_id)=lower(normalized_external_machine_id) and status in ('pending','ignored');
  after_machine:=public.admin_upsert_reporting_machine_by_id(
    before_machine.id,p_account_id,p_location_id,normalized_machine_label,normalized_machine_type,
    normalized_external_machine_id,coalesce(before_machine.operational_phase,'live'),normalized_reason,
    p_expected_account_id,p_expected_location_id,
    case when p_location_id is null then normalized_location_name end,
    case when p_location_id is null then p_location_timezone end);
  select * into account_row from public.customer_accounts where id=after_machine.account_id;
  select * into location_row from public.reporting_locations where id=after_machine.location_id;

$replacement$||substr(definition,last_pos);
  -- Identity save already promotes the pending facts. Preserve the count and
  -- revenue observed before that atomic save in the source setup result/audit.
  first_pos:=strpos(definition,E'  select\n    count(*)::integer,');
  last_pos:=strpos(definition,'  with promotable as (');
  if first_pos=0 or last_pos<=first_pos then raise exception 'Unexpected source promotion definition'; end if;
  definition:=substr(definition,1,first_pos-1)||substr(definition,last_pos);
  definition:=replace(definition,$old$    'accountName', account_row.name,$old$,
    $new$    'accountId', account_row.id,
    'locationId', location_row.id,
    'accountName', account_row.name,$new$);
  execute definition;
end;
$migration$;
revoke all on function public.admin_map_source_machine_to_partnership_by_id(text,uuid,text,text,text,numeric,date,date,date,text,uuid,uuid,text,uuid,uuid) from public,anon;
grant execute on function public.admin_map_source_machine_to_partnership_by_id(text,uuid,text,text,text,numeric,date,date,date,text,uuid,uuid,text,uuid,uuid) to authenticated;

-- The name-free legacy signature cannot express a deliberate company choice.
create or replace function public.admin_map_source_machine_to_partnership(
  p_external_machine_id text,p_partnership_id uuid,p_machine_label text,p_location_name text,
  p_machine_type text,p_tax_rate_percent numeric,p_assignment_start_date date,p_assignment_end_date date,
  p_tax_effective_start_date date,p_reason text
) returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null or not coalesce(public.is_super_admin(auth.uid()),false) then
    raise exception 'Admin access required' using errcode='42501';
  end if;
  raise exception 'Choose an explicit company and location' using errcode='22023';
end;
$$;

-- Retain current SnapCase mapping eligibility and overlap validation; add an
-- explicit timezone only for a deliberate new location, with no name matching.
do $migration$
declare definition text; first_pos integer; last_pos integer;
begin
  definition:=replace(pg_get_functiondef('public.admin_map_snapcase_machine(uuid,text,uuid,uuid,uuid,text,text,uuid,date,date,text)'::regprocedure),E'\r\n',E'\n');
  definition:=replace(definition,'p_reason text)','p_reason text, p_location_timezone text)');
  first_pos:=strpos(definition,$old$    elsif normalized_location_name <> '' then$old$);
  last_pos:=strpos(definition,E'    if p_location_id is not null and location_row.id is null then');
  if first_pos=0 or last_pos<=first_pos then raise exception 'Unexpected SnapCase location lookup'; end if;
  definition:=substr(definition,1,first_pos-1)||E'    end if;\n\n'||substr(definition,last_pos);
  definition:=replace(definition,$old$        coalesce((select name from pg_timezone_names where name = source_row.source_timezone), 'America/Los_Angeles'),$old$,
    $new$        btrim(p_location_timezone),$new$);
  definition:=replace(definition,E'    if location_row.id is null then\n      insert into public.reporting_locations',
    $new$    if location_row.id is null then
      if nullif(btrim(p_location_timezone),'') is null
        or (btrim(p_location_timezone)<>'UTC' and strpos(btrim(p_location_timezone),'/')=0) or not exists(
        select 1 from pg_catalog.pg_timezone_names where name=btrim(p_location_timezone)) then
        raise exception 'Choose a valid IANA location timezone' using errcode='22023';
      end if;
      insert into public.reporting_locations$new$);
  if strpos(definition,'p_location_timezone text')=0 or strpos(definition,'Choose a valid IANA')=0 then
    raise exception 'Unexpected SnapCase location creation';
  end if;
  execute definition;
end;
$migration$;
revoke all on function public.admin_map_snapcase_machine(uuid,text,uuid,uuid,uuid,text,text,uuid,date,date,text,text) from public,anon;
grant execute on function public.admin_map_snapcase_machine(uuid,text,uuid,uuid,uuid,text,text,uuid,date,date,text,text) to authenticated;

create or replace function public.admin_map_snapcase_machine(
  p_provider_account_id uuid,p_source_machine_id text,p_reporting_machine_id uuid,p_account_id uuid,
  p_location_id uuid,p_location_name text,p_machine_label text,p_partnership_id uuid,
  p_effective_start_date date,p_effective_end_date date,p_reason text
) returns jsonb language sql security definer set search_path='' as $$
  select public.admin_map_snapcase_machine(p_provider_account_id,p_source_machine_id,p_reporting_machine_id,
    p_account_id,p_location_id,p_location_name,p_machine_label,p_partnership_id,p_effective_start_date,
    p_effective_end_date,p_reason,null::text);
$$;
select pg_notify('pgrst','reload schema');
