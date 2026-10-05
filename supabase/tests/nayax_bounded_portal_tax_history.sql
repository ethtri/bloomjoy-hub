begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select plan(18);

insert into public.customer_accounts(id,name,account_type)
values('b1769000-0000-4000-8000-000000000001','Historical source fixture','internal');
insert into public.reporting_locations(id,account_id,name,timezone)
values('b1769000-0000-4000-8000-000000000002','b1769000-0000-4000-8000-000000000001','Historical source location','America/New_York');
insert into public.reporting_machines(id,account_id,location_id,machine_label,nayax_machine_id,nayax_account_key)
values('b1769000-0000-4000-8000-000000000003','b1769000-0000-4000-8000-000000000001',
  'b1769000-0000-4000-8000-000000000002','Historical source machine','1769000001','TGPACI_USA_DB');

insert into private.nayax_machine_tax_observations(account_key,nayax_machine_id,observed_at,source,
  classification,rate_percent,provenance,effective_start_date,effective_end_date)
values('TGPACI_USA_DB','1769000001','2099-10-05T22:00:00Z','nayax_portal_history','verified_tax',7,
  'Synthetic portal event 2098-12-06 21:38:10; displayed timezone unknown; checked 2098-12-01 through 2099-10-05; fixture reader1769000001',
  '2099-09-01','2099-09-30'),
  ('TGPACI_USA_DB','1769000001','2099-10-05T23:00:00Z','nayax_api','verified_tax',8,
  'Synthetic current API observation','2099-10-05',null);

select is((select rate_percent from private.resolve_reporting_machine_source_tax('b1769000-0000-4000-8000-000000000003','2099-09-15')),7::numeric,'Reviewed history resolves before review without current API backdating');
select is((select source from private.resolve_reporting_machine_source_tax('b1769000-0000-4000-8000-000000000003','2099-09-15')),'nayax_portal_history','History retains distinct source');
select is((select observed_at from private.resolve_reporting_machine_source_tax('b1769000-0000-4000-8000-000000000003','2099-09-15')),'2099-10-05T22:00:00Z'::timestamptz,'Observed time remains actual review time');
select is((select rate_percent from private.resolve_reporting_machine_source_tax('b1769000-0000-4000-8000-000000000003','2099-09-01')),7::numeric,'Start boundary included');
select is((select rate_percent from private.resolve_reporting_machine_source_tax('b1769000-0000-4000-8000-000000000003','2099-09-30')),7::numeric,'End boundary included');
select is((select rate_percent from private.resolve_reporting_machine_source_tax('b1769000-0000-4000-8000-000000000003','2099-08-31')),null::numeric,'Before history interval remains unknown');
select is((select rate_percent from private.resolve_reporting_machine_source_tax('b1769000-0000-4000-8000-000000000003','2099-10-01')),null::numeric,'After bounded history remains unknown until observed API');
select is((select rate_percent from private.resolve_reporting_machine_source_tax('b1769000-0000-4000-8000-000000000003','2099-10-05')),8::numeric,'Current API observation still resolves independently');

select throws_ok($$insert into private.nayax_machine_tax_observations(account_key,nayax_machine_id,observed_at,source,classification,rate_percent,provenance,effective_start_date)
  values('TGPACI_USA_DB','1769000001','2099-10-06T00:00:00Z','nayax_portal_history','verified_tax',7,'test','2099-09-01')$$,
  '23514',null,'Portal history must have finite end');
select throws_ok($$insert into private.nayax_machine_tax_observations(account_key,nayax_machine_id,observed_at,source,classification,rate_percent,provenance,effective_start_date,effective_end_date)
  values('TGPACI_USA_DB','1769000001','2099-10-06T00:00:00Z','nayax_portal_history','unclassified_extra_charge',7,'test','2099-09-01','2099-09-30')$$,
  '23514',null,'Unclassified history cannot bypass backdating guard');
select throws_ok($$insert into private.nayax_machine_tax_observations(account_key,nayax_machine_id,observed_at,source,classification,rate_percent,provenance,effective_start_date,effective_end_date)
  values('TGPACI_USA_DB','1769000001','2099-10-06T00:00:00Z','nayax_portal','verified_tax',7,'test','2099-09-01','2099-09-30')$$,
  '23514',null,'Current portal observation still cannot backdate');
select throws_ok($$select public.service_record_nayax_tax_observation('{"source":"nayax_portal_history"}'::jsonb)$$,
  '22023','API ingestion only','API entrypoint refuses historical source');

select throws_ok($$insert into private.nayax_machine_tax_observations(account_key,nayax_machine_id,observed_at,source,classification,rate_percent,provenance,effective_start_date,effective_end_date)
  values('TGPACI_USA_DB','1769000001','2099-10-06T00:00:00Z','nayax_portal_history','verified_tax',7,'test','2099-09-01','2099-10-07')$$,
  '23514',null,'Historical evidence cannot claim future coverage');
select throws_ok($$insert into private.nayax_machine_tax_observations(account_key,nayax_machine_id,observed_at,source,classification,rate_percent,provenance,effective_start_date,effective_end_date)
  values('TGPACI_USA_DB','1769000001','2099-10-06T00:00:00Z','nayax_portal_history','verified_tax',7,'test','2099-09-01','infinity')$$,
  '23514',null,'Infinite end cannot evade historical bounds');
select throws_ok($$insert into private.nayax_machine_tax_observations(account_key,nayax_machine_id,observed_at,source,classification,rate_percent,provenance,effective_start_date,effective_end_date)
  values('TGPACI_USA_DB','1769000001','2099-10-06T00:00:00Z','nayax_portal_history','verified_tax',7,'test','-infinity','2099-09-30')$$,
  '23514',null,'Infinite start cannot evade historical bounds');
select throws_ok($$insert into private.nayax_machine_tax_observations(account_key,nayax_machine_id,observed_at,source,classification,rate_percent,provenance,effective_start_date,effective_end_date)
  values('TGPACI_USA_DB','1769000001','2099-10-06T00:00:00Z','nayax_api','verified_tax',7,'test','2099-09-01','2099-09-30')$$,
  '23514',null,'Direct API observation still cannot backdate');
select lives_ok($$insert into private.nayax_machine_tax_observations(account_key,nayax_machine_id,observed_at,source,classification,rate_percent,provenance,effective_start_date,effective_end_date)
  values('TGPACI_USA_DB','1769000001','2099-10-06T00:00:00Z','finance_verified','verified_tax',6,'test Finance confirmation','2099-08-01','2099-08-30')$$,
  'Existing distinct Finance historical confirmation remains allowed');

do $$ begin perform public.service_record_nayax_tax_observation('{"accountKey":"TGPACI_USA_DB","machineId":"1769000001","observedAt":"2099-10-07T00:00:00Z","source":"nayax_api","classification":"verified_tax","ratePercent":9,"provenance":"Synthetic API input attempts historical dates","effectiveStartDate":"2099-09-01","effectiveEndDate":"2099-09-30"}'::jsonb); end; $$;
select is((select effective_start_date from private.nayax_machine_tax_observations
  where nayax_machine_id='1769000001' and observed_at='2099-10-07T00:00:00Z'),
  '2099-10-07'::date,'API entrypoint ignores caller historical dates and uses observation date');

select * from finish();
rollback;


