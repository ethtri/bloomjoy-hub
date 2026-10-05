begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select plan(1);
insert into public.customer_accounts(id,name,account_type)
values('b1763000-0000-4000-8000-000000000001','Source tax fixture','internal');
insert into public.reporting_locations(id,account_id,name,timezone)
values('b1763000-0000-4000-8000-000000000002','b1763000-0000-4000-8000-000000000001','Source tax location','America/Los_Angeles');
insert into public.reporting_machines(id,account_id,location_id,machine_label,nayax_machine_id,nayax_account_key)
values('b1763000-0000-4000-8000-000000000003','b1763000-0000-4000-8000-000000000001',
  'b1763000-0000-4000-8000-000000000002','Source tax machine','1763000001','TGPACI_USA_DB');
select lives_ok($test$
do $$
declare machine public.reporting_machines%rowtype; resolved record;
begin
  select * into machine from public.reporting_machines
    where id='b1763000-0000-4000-8000-000000000003';
  if machine.id is null then raise exception 'Mapped machine fixture required'; end if;
  insert into private.nayax_machine_tax_observations(account_key,nayax_machine_id,observed_at,
    source,classification,rate_percent,field_name,provenance,effective_start_date,effective_end_date)
  values(upper(coalesce(machine.nayax_account_key,'TGPACI_USA_DB')),machine.nayax_machine_id,
    '2099-10-05T00:00:00Z','nayax_api','unclassified_extra_charge',7,'Credit Card Extra Charge',
    'test observation','2099-10-05','2099-10-05');
  select * into resolved from private.resolve_reporting_machine_source_tax(machine.id,'2099-10-05');
  if resolved.rate_percent is not null or resolved.coverage_status <> 'unclassified_extra_charge' then
    raise exception 'Surcharge silently treated as tax'; end if;
  select * into resolved from private.resolve_reporting_machine_source_tax(machine.id,'2099-10-04');
  if resolved.rate_percent is not null then raise exception 'Observation backdated'; end if;
  select * into resolved from private.resolve_reporting_machine_source_tax(machine.id,'2099-10-06');
  if resolved.rate_percent is not null then raise exception 'Observation projected forward'; end if;
  insert into private.nayax_machine_tax_observations(account_key,nayax_machine_id,observed_at,
    source,classification,rate_percent,field_name,provenance,effective_start_date,effective_end_date)
  values(upper(coalesce(machine.nayax_account_key,'TGPACI_USA_DB')),machine.nayax_machine_id,
    '2099-10-05T01:00:00Z','finance_verified','verified_tax',8,'Finance confirmation',
    'test period evidence','2099-09-01','2099-09-30');
  select * into resolved from private.resolve_reporting_machine_source_tax(machine.id,'2099-09-15');
  if resolved.rate_percent <> 8 or resolved.source <> 'finance_verified' then
    raise exception 'Dated verified source unavailable'; end if;
  if has_table_privilege('authenticated','private.nayax_machine_tax_observations','SELECT')
    or has_table_privilege('anon','private.nayax_machine_tax_observations','INSERT')
    or has_function_privilege('authenticated','public.service_record_nayax_tax_observation(jsonb)','EXECUTE')
    or has_function_privilege('anon','public.admin_reporting_machine_source_tax(uuid,date)','EXECUTE') then
    raise exception 'Source permission leak'; end if;
end;
$$;
$test$,'Dated source classification, bounds, and permission checks');
select * from finish();
rollback;
