-- The harness injects the real migration, not a duplicated data patch.
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
set local timezone='UTC';
select no_plan();
select lives_ok(current_setting('bloomjoy.test.eastridge_correction'),
  'Empty replay safely skips absent reviewed source evidence');
select is((select count(*) from private.nayax_machine_tax_observations
  where nayax_machine_id='627583676' and source='owner_rate_correction'),0::bigint,
  'Empty replay invents no owner rate');
set local session_replication_role=replica;
insert into auth.users(id,email) values('b1850000-0000-4000-8000-000000000001','eastridge-fixture@example.invalid');
insert into customer_accounts(id,name) values('b1850100-0000-4000-8000-000000000001','Eastridge source fixture');
insert into reporting_locations(id,account_id,name,timezone) values
 ('b1850200-0000-4000-8000-000000000001','b1850100-0000-4000-8000-000000000001','Eastridge synthetic','UTC');
insert into reporting_machines(id,account_id,location_id,machine_label,nayax_machine_id,nayax_account_key) values
 ('18ec7a81-d4a7-4c8e-85f2-19d0e7c9b439','b1850100-0000-4000-8000-000000000001','b1850200-0000-4000-8000-000000000001','Reviewed physical machine','123456789','TGPACI_USA_DB'),
 ('b1850300-0000-4000-8000-000000000002','b1850100-0000-4000-8000-000000000001','b1850200-0000-4000-8000-000000000001','Other physical machine','729256014','TGPACI_USA_DB');
insert into private.machine_nayax_reader_associations(account_key,nayax_machine_id,reporting_machine_id,ownership_basis,created_by,reason,
 effective_from,effective_from_date,effective_timezone,effective_until,closed_at,closed_by,close_reason) values
 ('TGPACI_USA_DB','729256014','18ec7a81-d4a7-4c8e-85f2-19d0e7c9b439','original_transactions_only','b1850000-0000-4000-8000-000000000001','Retained exact historical original source',
 null,null,null,'2026-10-08T19:29Z','2026-10-08T19:29Z','b1850000-0000-4000-8000-000000000001','Reviewed dated original source boundary'),
 ('TGPACI_USA_DB','729256014','b1850300-0000-4000-8000-000000000002','reviewed_physical_reader_change','b1850000-0000-4000-8000-000000000001','Other financial machine dated placement',
 '2026-10-08T19:29Z','2026-10-08','UTC',null,null,null,null);
insert into private.nayax_machine_tax_observations(account_key,nayax_machine_id,observed_at,source,classification,rate_percent,provenance,effective_start_date,effective_end_date) values
 ('TGPACI_USA_DB','627583676','2026-10-08T16:27:11.867Z','nayax_api','verified_tax',0.09,'Synthetic exact reviewed value','2026-10-08',null),
 ('TGPACI_USA_DB','627583676','2026-10-08T18:09Z','owner_stable_rate','verified_tax',0.09,'owner attestation; verified observation IDs=synthetic','-infinity','2026-10-08'),
 ('TGPACI_USA_DB','729256014','2026-10-05T21:00Z','nayax_api','verified_tax',9,'Synthetic original historical rate','2026-10-05',null),
 ('TGPACI_USA_DB','729256014','2026-10-08T20:18Z','owner_stable_rate','verified_tax',9,'owner attestation; verified observation IDs=synthetic','-infinity','2026-10-08'),
 ('TGPACI_USA_DB','729256014','2026-10-08T20:30Z','finance_verified','verified_tax',10,'Synthetic other physical machine Finance authority','2026-10-08',null),
 ('OTHER_ACCOUNT','627583676','2026-10-08T16:27Z','finance_verified','verified_tax',12,'Synthetic unrelated account','2026-10-08',null);
set local session_replication_role=origin;
select throws_ok(current_setting('bloomjoy.test.eastridge_correction'),
 'P0001','Reviewed Eastridge financial-machine reader identity changed',
 'Reviewed source cannot correct a different current financial-machine reader');
set local session_replication_role=replica;
update reporting_machines set nayax_machine_id='627583676' where id='18ec7a81-d4a7-4c8e-85f2-19d0e7c9b439';
set local session_replication_role=origin;
create temporary table original_eastridge_evidence as select jsonb_agg(to_jsonb(o) order by o.id) value
 from private.nayax_machine_tax_observations o;
create temporary table original_eastridge_mappings as select jsonb_agg(to_jsonb(m) order by m.id) value from reporting_machines m;
select lives_ok(current_setting('bloomjoy.test.eastridge_correction'),'Actual guarded migration appends the latest owner 9 percent answer');
select is((select count(*) from private.nayax_machine_tax_observations where source='owner_rate_correction'),1::bigint,
 'Only one exact current-reader correction is appended');
select is((select jsonb_agg(to_jsonb(o) order by o.id) from private.nayax_machine_tax_observations o where source<>'owner_rate_correction'),
 (select value from original_eastridge_evidence),'Every original source observation is retained byte-for-byte');
select is((select jsonb_agg(to_jsonb(m) order by m.id) from reporting_machines m),
 (select value from original_eastridge_mappings),'No mapping or financial machine fields change');
select lives_ok(current_setting('bloomjoy.test.eastridge_correction'),'Same-day correction replay is idempotent');
select is((select count(*) from private.nayax_machine_tax_observations where source='owner_rate_correction'),1::bigint,'Replay creates no second owner row');
select is((select rate_percent from private.resolve_reporting_machine_source_tax('18ec7a81-d4a7-4c8e-85f2-19d0e7c9b439','2026-09-01')),9::numeric,
 'Historical current-reader rate is 9 percent, not 0.09 or interim 10');
select results_eq($$select tax_exclusive_amount_cents,tax_cents from private.normalize_original_reader_amount_cents(
 '18ec7a81-d4a7-4c8e-85f2-19d0e7c9b439','card','2026-09-01',1090,'tax_inclusive',null,null,true,'nayax_scheduled_report','627583676')$$,
 $$select 1000::bigint,90::bigint$$,'Supported inclusive sale consumes the exact owner correction');
select results_eq($$select tax_exclusive_amount_cents,tax_cents from private.normalize_original_reader_amount_cents(
 '18ec7a81-d4a7-4c8e-85f2-19d0e7c9b439','card','2026-09-01',1090,'tax_inclusive',null,140,true,'nayax_scheduled_report','627583676')$$,
 $$select 950::bigint,140::bigint$$,'Actual transaction tax overrides the owner percentage');
select results_eq($$select tax_exclusive_amount_cents,tax_cents from private.normalize_original_reader_amount_cents(
 '18ec7a81-d4a7-4c8e-85f2-19d0e7c9b439','card','2026-09-01',1090,'tax_inclusive',null,0,true,'nayax_scheduled_report','627583676')$$,
 $$select 1090::bigint,0::bigint$$,'Separately sourced zero tax is preserved');
select results_eq($$select tax_exclusive_amount_cents,tax_cents from private.normalize_original_reader_amount_cents(
 '18ec7a81-d4a7-4c8e-85f2-19d0e7c9b439','cash','2026-09-01',1090,'unknown',null,null,true,'nayax_scheduled_report','627583676')$$,
 $$select 1090::bigint,0::bigint$$,'Cash stays independent of card-rate correction');
select results_eq($$select tax_exclusive_amount_cents,tax_cents from private.normalize_original_reader_amount_cents(
 '18ec7a81-d4a7-4c8e-85f2-19d0e7c9b439','card','2026-09-01',1090,'tax_exclusive',null,null,true,'nayax_scheduled_report','627583676')$$,
 $$select 1090::bigint,0::bigint$$,'Tax-exclusive source amounts are not divided again');
select results_eq($$select tax_exclusive_amount_cents,tax_cents from private.normalize_original_reader_amount_cents(
 '18ec7a81-d4a7-4c8e-85f2-19d0e7c9b439','card','2026-09-01',1090,'tax_inclusive',null,null,true,'nayax_scheduled_report','729256014')$$,
 $$select 1000::bigint,90::bigint$$,'Former reader retains original Eastridge 9 percent history');
select results_eq($$select tax_exclusive_amount_cents,tax_cents from private.normalize_original_reader_amount_cents(
 'b1850300-0000-4000-8000-000000000002','card','2026-10-08',1100,'tax_inclusive',null,null,true,'nayax_scheduled_report','729256014')$$,
 $$select 1000::bigint,100::bigint$$,'Other machine dated Finance 10 percent remains separate');
select ok((select provenance like '%owner attestation 2026-10-08%' and provenance like '%actual application=%'
 and observed_at>=transaction_timestamp() and observed_at<=statement_timestamp()
 and effective_end_date is null
 from private.nayax_machine_tax_observations where source='owner_rate_correction'),
 'Owner date and actual application time remain truthful without an artificial expiry');
insert into private.nayax_machine_tax_observations(account_key,nayax_machine_id,observed_at,source,classification,rate_percent,provenance,effective_start_date)
 values('TGPACI_USA_DB','627583676','2026-10-09T16:27Z','nayax_api','verified_tax',0.09,'Synthetic next-day unchanged bad provider value','2026-10-09');
select is((select rate_percent from private.resolve_reporting_machine_source_tax('18ec7a81-d4a7-4c8e-85f2-19d0e7c9b439','2026-10-09')),9::numeric,
 'Next-day source import cannot reinstate the corrected 0.09 percent');
select results_eq($$select tax_exclusive_amount_cents,tax_cents from private.normalize_original_reader_amount_cents(
 '18ec7a81-d4a7-4c8e-85f2-19d0e7c9b439','card','2026-10-09',1090,'tax_inclusive',null,null,true,'nayax_scheduled_report','627583676')$$,
 $$select 1000::bigint,90::bigint$$,'Future Eastridge sales retain the owner-confirmed 9 percent');
select is((select rate_percent from private.resolve_reporting_machine_source_tax('b1850300-0000-4000-8000-000000000002','2026-10-09')),10::numeric,
 'Future Stoneridge Finance 10 percent remains unchanged');
insert into private.nayax_machine_tax_observations(account_key,nayax_machine_id,observed_at,source,classification,rate_percent,provenance,effective_start_date)
 values('TGPACI_USA_DB','627583676','2026-10-08T22:00Z','finance_verified','verified_tax',8,'Synthetic unreviewed conflict','2026-10-08');
select throws_ok(current_setting('bloomjoy.test.eastridge_correction'),'P0001','Unreviewed conflicting Eastridge reader rate',
 'An unreviewed conflicting rate cannot silently join the correction');
select * from finish();
