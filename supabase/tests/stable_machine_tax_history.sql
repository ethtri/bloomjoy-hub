begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
set local session_replication_role=replica;
insert into auth.users(id,email) values('b1824000-0000-4000-8000-000000000011','owner-tax-history@example.invalid');
insert into customer_accounts(id,name) values('b1824100-0000-4000-8000-000000000001','Stable owner tax fixture');
insert into reporting_locations(id,account_id,name,timezone) values
 ('b1824200-0000-4000-8000-000000000011','b1824100-0000-4000-8000-000000000001','Stable site','America/Los_Angeles');
insert into reporting_machines(id,account_id,location_id,machine_label,nayax_machine_id,nayax_account_key) values
 ('b1824300-0000-4000-8000-000000000011','b1824100-0000-4000-8000-000000000001','b1824200-0000-4000-8000-000000000011','Stable rate','1824000011','TGPACI_USA_DB'),
 ('b1824300-0000-4000-8000-000000000012','b1824100-0000-4000-8000-000000000001','b1824200-0000-4000-8000-000000000011','Explicit owner correction','847395658','TGPACI_USA_DB'),
 ('b1824300-0000-4000-8000-000000000013','b1824100-0000-4000-8000-000000000001','b1824200-0000-4000-8000-000000000011','Unknown rate','1824000013','TGPACI_USA_DB'),
 ('b1824300-0000-4000-8000-000000000014','b1824100-0000-4000-8000-000000000001','b1824200-0000-4000-8000-000000000011','Other account','1824000011','OTHER_ACCOUNT'),
 ('b1824300-0000-4000-8000-000000000015','b1824100-0000-4000-8000-000000000001','b1824200-0000-4000-8000-000000000011','Replacement reader','1824000015','TGPACI_USA_DB');
insert into private.machine_nayax_reader_associations(account_key,nayax_machine_id,reporting_machine_id,ownership_basis,created_by,reason) values
 ('TGPACI_USA_DB','1824000016','b1824300-0000-4000-8000-000000000015','same_physical_machine_all_history','b1824000-0000-4000-8000-000000000011','Synthetic retained original reader');
set local session_replication_role=origin;
insert into private.nayax_machine_tax_observations(account_key,nayax_machine_id,observed_at,source,classification,rate_percent,provenance,effective_start_date,effective_end_date) values
 ('TGPACI_USA_DB','1824000011','2099-10-05','nayax_api','verified_tax',8,'Synthetic exact verified API','2099-10-05',null),
 ('TGPACI_USA_DB','847395658','2099-10-05','nayax_api','verified_tax',7.5,'Synthetic verified Nayax correction','2099-10-05',null),
 ('TGPACI_USA_DB','847395658','2099-10-05','finance_verified','verified_tax',8,'Synthetic prior owner Finance estimate','2099-09-01','2099-09-30'),
 ('TGPACI_USA_DB','1824000013','2099-10-05','nayax_api','missing',null,'Synthetic unavailable API rate','2099-10-05',null),
 ('TGPACI_USA_DB','1824000015','2099-10-05','nayax_api','verified_tax',20,'Synthetic replacement reader rate','2099-10-05',null),
 ('TGPACI_USA_DB','1824000016','2099-10-05','nayax_api','verified_tax',8,'Synthetic original reader rate','2099-10-05',null);
select is((select rate_percent from private.resolve_reporting_machine_source_tax('b1824300-0000-4000-8000-000000000011','2099-10-01')),null::numeric,'Before repair Oct1 positive inclusive sales lack artificial dated coverage');
select is((select rate_percent from private.resolve_reporting_machine_source_tax('b1824300-0000-4000-8000-000000000012','2099-09-15')),8::numeric,'Original dated Finance evidence exists before explicit correction');
select private.record_owner_stable_tax_history('2099-10-08T18:09Z','#1824; owner attestation: machine rates unchanged across reporting history');
select is((select rate_percent from private.resolve_reporting_machine_source_tax('b1824300-0000-4000-8000-000000000011','2099-10-01')),8::numeric,'Oct1 receives exact verified stable rate');
select is((select rate_percent from private.resolve_reporting_machine_source_tax('b1824300-0000-4000-8000-000000000011','2099-10-02')),8::numeric,'Oct2 receives exact verified stable rate');
select is((select source from private.resolve_reporting_machine_source_tax('b1824300-0000-4000-8000-000000000011','2099-10-05')),'nayax_api','Existing dated source observation retains priority over ordinary fallback');
select is((select rate_percent from private.resolve_reporting_machine_source_tax('b1824300-0000-4000-8000-000000000012','2099-09-15')),7.5::numeric,'Explicit Avenues owner correction supersedes prior Finance 8');
select is((select rate_percent from private.resolve_reporting_machine_source_tax('b1824300-0000-4000-8000-000000000012','2099-10-01')),7.5::numeric,'Explicit correction covers Oct1 historical gap');
select is((select rate_percent from private.resolve_reporting_machine_source_tax('b1824300-0000-4000-8000-000000000012','2099-10-09')),7.5::numeric,'After attestation day verified ongoing Nayax 7.5 remains applicable');
select is((select count(*) from private.nayax_machine_tax_observations where nayax_machine_id='847395658' and provenance='Synthetic prior owner Finance estimate'),1::bigint,'Prior Finance evidence remains intact');
select is((select rate_percent from private.resolve_reporting_machine_source_tax('b1824300-0000-4000-8000-000000000013','2099-10-01')),null::numeric,'Missing rate never inferred');
select is((select rate_percent from private.resolve_reporting_machine_source_tax('b1824300-0000-4000-8000-000000000014','2099-10-01')),null::numeric,'Exact account identity prevents another account rate leakage');
select results_eq($$select tax_exclusive_amount_cents,tax_cents from private.normalize_reporting_treated_amount_cents('b1824300-0000-4000-8000-000000000011','card','2099-10-01',1080,'tax_inclusive',null,null,true)$$,$$select 1000::bigint,80::bigint$$,'Inclusive charge removes stable tax once');
select results_eq($$select tax_exclusive_amount_cents,tax_cents from private.normalize_reporting_treated_amount_cents('b1824300-0000-4000-8000-000000000011','card','2099-10-01',1080,'tax_inclusive',null,100,true)$$,$$select 980::bigint,100::bigint$$,'Original transaction tax takes precedence over stable rate');
select results_eq($$select tax_exclusive_amount_cents,tax_cents from private.normalize_reporting_treated_amount_cents('b1824300-0000-4000-8000-000000000011','cash','2099-10-01',1080,'tax_inclusive',null,null,true)$$,$$select 1080::bigint,0::bigint$$,'Cash remains amount collected');
select results_eq($$select tax_exclusive_amount_cents,tax_cents from private.normalize_reporting_treated_amount_cents('b1824300-0000-4000-8000-000000000011','card','2099-10-01',1000,'tax_exclusive',null,null,true)$$,$$select 1000::bigint,0::bigint$$,'Exclusive source amount is not double taxed');
select results_eq($$select tax_exclusive_amount_cents,tax_cents from private.normalize_reporting_treated_amount_cents('b1824300-0000-4000-8000-000000000011','card','2099-10-01',1080,'separate_tax',null,0,true)$$,$$select 1080::bigint,0::bigint$$,'Explicit zero original separate tax takes precedence over percentage');
select results_eq($$select tax_exclusive_amount_cents,tax_cents from private.normalize_original_reader_amount_cents('b1824300-0000-4000-8000-000000000015','card','2099-10-01',1080,'tax_inclusive',null,null,true,'nayax_scheduled_report','1824000016')$$,$$select 1000::bigint,80::bigint$$,'Retained original reader obtains stable history rather than replacement rate');
select results_eq($$select tax_exclusive_amount_cents,tax_cents from private.normalize_refund_original_reader_amount_cents('b1824300-0000-4000-8000-000000000015','card','2099-10-01',1080,'tax_inclusive',null,80,true)$$,$$select 1000::bigint,80::bigint$$,'Refund original transaction tax retains purchase identity across replacement');
select is((select tax_exclusive_amount_cents from private.normalize_refund_original_reader_amount_cents('b1824300-0000-4000-8000-000000000015','card','2099-10-01',1080,'tax_inclusive',null,null,true)),null::bigint,'Unmatched historical refund never borrows replacement reader rate');
select is(private.record_owner_stable_tax_history('2099-10-08T18:09Z','#1824; owner attestation: machine rates unchanged across reporting history'),0::bigint,'Attestation replay is idempotent');
select ok(not has_function_privilege('authenticated','private.record_owner_stable_tax_history(timestamptz,text)','EXECUTE') and not has_function_privilege('service_role','private.record_owner_stable_tax_history(timestamptz,text)','EXECUTE'),'Internal attestation cannot be called by browser or worker');
select ok(exists(select 1 from private.nayax_machine_tax_observations where nayax_machine_id='1824000011' and source='owner_stable_rate' and provenance like '%verified observation IDs=%' and observed_at='2099-10-08T18:09Z'),'Owner evidence records actual attestation time and original verified observation IDs');
select * from finish();
rollback;
