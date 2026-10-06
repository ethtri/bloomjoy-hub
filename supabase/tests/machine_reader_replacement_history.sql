begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
set local timezone='UTC';
select no_plan();
-- Synthetic history only. All guarded writer actions below use origin triggers.
set local session_replication_role=replica;
insert into auth.users(id,email) values
 ('aa180300-0000-4000-8000-000000000001','reader-change-admin@example.invalid'),
 ('aa180300-0000-4000-8000-000000000002','reader-change-outsider@example.invalid');
insert into admin_roles(user_id,role,active) values('aa180300-0000-4000-8000-000000000001','super_admin',true);
insert into customer_accounts(id,name) values('aa180301-0000-4000-8000-000000000001','Reader replacement company');
insert into reporting_locations(id,account_id,name,timezone) values
 ('aa180302-0000-4000-8000-000000000001','aa180301-0000-4000-8000-000000000001','Reader replacement saved site','America/Los_Angeles');
insert into reporting_machines(id,account_id,location_id,machine_label,machine_type,nayax_machine_id,nayax_account_key,sunze_machine_id,nayax_card_sales_started_on) values
 ('aa180303-0000-4000-8000-000000000001','aa180301-0000-4000-8000-000000000001','aa180302-0000-4000-8000-000000000001','Stable physical cabinet','commercial','18030001','TGPACI_USA_DB','reader-change-source',null),
 ('aa180303-0000-4000-8000-000000000002','aa180301-0000-4000-8000-000000000001','aa180302-0000-4000-8000-000000000001','Unrelated dated cabinet','commercial','18030003','TGPACI_USA_DB','reader-change-dated','2025-01-01');
insert into sunze_machine_discoveries(sunze_machine_id,sunze_machine_name,status,reporting_machine_id) values
 ('reader-change-source','Read-only app label','mapped','aa180303-0000-4000-8000-000000000001'),
 ('reader-change-dated','Dated app label','mapped','aa180303-0000-4000-8000-000000000002');
insert into refund_nayax_machine_inventory(id,account_key,nayax_machine_id,machine_name,provider_is_active,reporting_machine_id,reconciliation_state,refund_category) values
 ('aa180304-0000-4000-8000-000000000001','TGPACI_USA_DB','18030001','Previous reader',true,'aa180303-0000-4000-8000-000000000001','published','cotton_candy'),
 ('aa180304-0000-4000-8000-000000000002','TGPACI_USA_DB','18030002','Replacement reader',true,null,'needs_setup','cotton_candy'),
 ('aa180304-0000-4000-8000-000000000003','TGPACI_USA_DB','18030003','Unrelated dated reader',true,'aa180303-0000-4000-8000-000000000002','published','cotton_candy');
insert into private.nayax_machine_tax_observations(account_key,nayax_machine_id,observed_at,source,classification,rate_percent,provenance,effective_start_date) values
 ('TGPACI_USA_DB','18030001',now(),'finance_verified','verified_tax',10,'Explicit synthetic original-reader evidence','2025-01-01'),
 ('TGPACI_USA_DB','18030002',now(),'finance_verified','verified_tax',20,'Explicit synthetic replacement-reader evidence','2025-01-01'),
 ('TGPACI_USA_DB','18030003',now(),'finance_verified','verified_tax',15,'Explicit synthetic unrelated-reader evidence','2025-01-01');
insert into machine_sales_facts(id,reporting_machine_id,reporting_location_id,sale_date,payment_method,net_sales_cents,transaction_count,item_quantity,tax_cents,source,source_order_hash,source_row_hash,raw_payload) values
 ('aa180305-0000-4000-8000-000000000001','aa180303-0000-4000-8000-000000000001','aa180302-0000-4000-8000-000000000001','2026-09-01','credit',1100,1,1,0,'nayax_scheduled_report',repeat('a',64),'reader-change-original','{"amountBasis":"tax_inclusive","providerMachineId":"18030001","transactionId":"1803000101","actorId":"2003563806","currencyCode":"USD"}'),
 ('aa180305-0000-4000-8000-000000000002','aa180303-0000-4000-8000-000000000001','aa180302-0000-4000-8000-000000000001','2026-09-01','cash',200,1,1,0,'sunze_browser',repeat('b',64),'reader-change-cash','{"amountBasis":"tax_exclusive","order_amount_cents":200}'),
 ('aa180305-0000-4000-8000-000000000003','aa180303-0000-4000-8000-000000000002','aa180302-0000-4000-8000-000000000001','2026-09-01','credit',1150,1,1,0,'nayax_scheduled_report',repeat('c',64),'reader-change-dated-original','{"amountBasis":"tax_inclusive","providerMachineId":"18030003"}');
insert into machine_sales_facts(id,reporting_machine_id,reporting_location_id,sale_date,payment_method,net_sales_cents,transaction_count,item_quantity,tax_cents,source,source_order_hash,source_row_hash,raw_payload) values
 ('aa180305-0000-4000-8000-000000000004','aa180303-0000-4000-8000-000000000002','aa180302-0000-4000-8000-000000000001','2026-09-01','credit',1500,2,2,0,'sunze_browser',repeat('9',64),'reader-change-dated-source','{"amountBasis":"tax_inclusive","order_amount_cents":1500}');
insert into reporting_machine_refund_managers(reporting_machine_id,manager_user_id,manager_email,status) values
 ('aa180303-0000-4000-8000-000000000001','aa180300-0000-4000-8000-000000000001','reader-change-admin@example.invalid','active');
insert into refund_machine_qr_codes(reporting_machine_id,public_code,version) values('aa180303-0000-4000-8000-000000000001',repeat('7',32),1);
insert into refund_cases(id,public_reference,reporting_machine_id,reporting_location_id,customer_email,issue_summary,incident_at,payment_method,payment_amount_cents,status,customer_request_received_at,customer_request_received_source,matched_sales_fact_id) values
 ('aa180306-0000-4000-8000-000000000001','RF-1803-ORIGINAL','aa180303-0000-4000-8000-000000000001','aa180302-0000-4000-8000-000000000001','reader-original@example.invalid','Synthetic original-reader evidence','2026-09-01T19:00Z','card',1100,'needs_review','2026-09-01T19:00Z','hosted_refund_intake','aa180305-0000-4000-8000-000000000001');
insert into sales_adjustment_facts(id,reporting_machine_id,reporting_location_id,adjustment_date,adjustment_type,amount_cents,source,source_row_hash,raw_payload,created_at) values
 ('aa180307-0000-4000-8000-000000000001','aa180303-0000-4000-8000-000000000001','aa180302-0000-4000-8000-000000000001','2026-10-03','refund',110,'nayax_provider_refund',repeat('d',64),'{}','2026-09-27');
insert into nayax_provider_refund_events(refund_identity_hash,account_key,provider_actor_id,provider_machine_id,original_transaction_id,event_transaction_id,currency_code,amount_cents,machine_event_at,evidence_kind,reporting_machine_id,adjustment_id,disposition) values
 (repeat('d',64),'TGPACI_USA_DB','2003563806','18030001','1803000101','1803000199','USD',110,'2026-10-03 12:00','native_event','aa180303-0000-4000-8000-000000000001','aa180307-0000-4000-8000-000000000001','applied');
insert into sales_import_runs(id,source,status) values('aa180308-0000-4000-8000-000000000001','nayax_dtm_history','completed');
insert into nayax_dtm_export_files(file_digest,import_run_id,byte_count,row_count,authorization_cents,settlement_cents,refund_annotation_cents,currency_code,period_start,period_end,is_partial,origin) values
 (repeat('e',64),'aa180308-0000-4000-8000-000000000001',500,1,1100,1100,0,'USD','2026-09-01T00:00Z','2026-09-02T00:00Z',false,'manual_dtm_export');
insert into nayax_dtm_export_rows(file_digest,source_row_hash,provider_actor_id,provider_machine_id,provider_site_id,provider_transaction_id,settlement_amount_cents,machine_settled_at,provider_type,machine_name_hash,mapping_disposition,financial_disposition,history_scope_disposition,disposition,fact_id) values
 (repeat('e',64),repeat('f',64),'2003563806','18030001','4','1803000101',1100,'2026-09-01 12:00',0,repeat('8',64),'canonical','eligible','in_scope','fact_linked','aa180305-0000-4000-8000-000000000001');
insert into private.refund_request_recognition_rollout(singleton,activated_at,activated_by) values(true,'2026-09-29','Synthetic reader-history test') on conflict(singleton) do update set activated_at=excluded.activated_at;
set local session_replication_role=origin;
select private.reconcile_machine_card_sales_authority('aa180303-0000-4000-8000-000000000002','2026-09-01');
create temporary table reader_change_before as select
 (select jsonb_agg(to_jsonb(f) order by id) from machine_sales_facts f where id::text like 'aa180305-%') facts,
 (select to_jsonb(m) from reporting_machines m where id='aa180303-0000-4000-8000-000000000002') unrelated,
 (select jsonb_agg(to_jsonb(l) order by id) from reporting_locations l where id::text like 'aa180302-%') sites,
 (select jsonb_agg(to_jsonb(m) order by reporting_machine_id,manager_user_id) from reporting_machine_refund_managers m where reporting_machine_id='aa180303-0000-4000-8000-000000000001') managers,
 (select jsonb_agg(to_jsonb(q) order by id) from refund_machine_qr_codes q where reporting_machine_id='aa180303-0000-4000-8000-000000000001') qr,
 (select to_jsonb(c) from refund_cases c where id='aa180306-0000-4000-8000-000000000001') refund_case,
 (select to_jsonb(a) from sales_adjustment_facts a where id='aa180307-0000-4000-8000-000000000001') adjustment,
 (select jsonb_agg(to_jsonb(component) order by booking_date,tender) from private.machine_sales_daily_components('aa180303-0000-4000-8000-000000000002','2026-09-01','2026-09-30') component) unrelated_components,
 (select updated_at from reporting_machines where id='aa180303-0000-4000-8000-000000000001') expected_updated_at;
grant select on reader_change_before to authenticated;
set local session_replication_role=origin;
select set_config('request.jwt.claim.sub','aa180300-0000-4000-8000-000000000002',true);
set local role authenticated;
select throws_ok($$select admin_change_machine_reader('aa180303-0000-4000-8000-000000000001','aa180304-0000-4000-8000-000000000002',(select expected_updated_at from reader_change_before),null,'America/Los_Angeles','2026-10-02',null,'Unauthorized reader replacement')$$,'42501',null,'Outsider cannot replace a machine reader');
reset role;
select set_config('request.jwt.claim.sub','aa180300-0000-4000-8000-000000000001',true);
set local role authenticated;
select throws_ok($$select admin_change_machine_reader('aa180303-0000-4000-8000-000000000001','aa180304-0000-4000-8000-000000000002',(select expected_updated_at from reader_change_before),null,'America/New_York','2026-10-02',null,'Wrong saved zone replacement')$$,'40001',null,'Changed saved timezone requires fresh review');
select lives_ok($$select admin_change_machine_reader('aa180303-0000-4000-8000-000000000001','aa180304-0000-4000-8000-000000000002',(select expected_updated_at from reader_change_before),null,'America/Los_Angeles','2026-10-02',null,'Actual broken-reader replacement, calendar date known')$$,'Date-only same-machine replacement is an ordinary guarded save');
reset role;
select is((select nayax_machine_id from reporting_machines where id='aa180303-0000-4000-8000-000000000001'),'18030002','Replacement reader becomes current on the same stable machine');
select is((select count(*) from reporting_machines where id::text like 'aa180303-%'),2::bigint,'Reader replacement creates no additional machine');
select is((select jsonb_agg(to_jsonb(f) order by id) from machine_sales_facts f where id::text like 'aa180305-%'),(select facts from reader_change_before),'Replacement rewrites no original sales or cash facts');
select is((select to_jsonb(m) from reporting_machines m where id='aa180303-0000-4000-8000-000000000002'),(select unrelated from reader_change_before),'Unrelated dated authority machine retains every field and stamp');
select is((select jsonb_agg(to_jsonb(component) order by booking_date,tender) from private.machine_sales_daily_components('aa180303-0000-4000-8000-000000000002','2026-09-01','2026-09-30') component),(select unrelated_components from reader_change_before),'Unreviewed dated financial components remain byte-identical');
select is((select jsonb_agg(to_jsonb(l) order by id) from reporting_locations l where id::text like 'aa180302-%'),(select sites from reader_change_before),'Reader replacement preserves saved site timezone and company');
select is((select jsonb_agg(to_jsonb(m) order by reporting_machine_id,manager_user_id) from reporting_machine_refund_managers m where reporting_machine_id='aa180303-0000-4000-8000-000000000001'),(select managers from reader_change_before),'Reader replacement preserves managers and existing service scope');
select is((select jsonb_agg(to_jsonb(q) order by id) from refund_machine_qr_codes q where reporting_machine_id='aa180303-0000-4000-8000-000000000001'),(select qr from reader_change_before),'Reader replacement preserves public service QR identity');
select is((select to_jsonb(c) from refund_cases c where id='aa180306-0000-4000-8000-000000000001'),(select refund_case from reader_change_before),'Reader replacement preserves the original matched refund case');
select is((select to_jsonb(a) from sales_adjustment_facts a where id='aa180307-0000-4000-8000-000000000001'),(select adjustment from reader_change_before),'Reader replacement preserves issued provider refund adjustment bytes');
select is(private.refund_original_source_tax_cents('aa180306-0000-4000-8000-000000000001',110),10::bigint,'Matched case uses its original-reader 10 percent tax evidence');
select is(private.provider_refund_original_source_tax_cents('aa180307-0000-4000-8000-000000000001',110),10::bigint,'Provider refund uses the exact original-reader sale tax evidence');
select is((select sum(legacy_paid_deduction_ex_tax_cents) from private.machine_sales_daily_components('aa180303-0000-4000-8000-000000000001','2026-10-01','2026-10-31')),100::numeric,'Paid adjustment remains 100 excluding original tax despite replacement-reader 20 percent');
select results_eq($$select sum(recorded_sales_cents),sum(sales_ex_tax_cents),sum(sales_tax_cents) from private.machine_sales_daily_components('aa180303-0000-4000-8000-000000000001','2026-09-01','2026-09-30')$$,$$ values (1300::numeric,1200::numeric,100::numeric)$$,'Old-reader 10 percent tax and genuine cash retain their original contributions despite new-reader 20 percent');
select ok(exists(select 1 from private.machine_nayax_reader_associations where reporting_machine_id='aa180303-0000-4000-8000-000000000001' and nayax_machine_id='18030002' and ownership_basis='reviewed_calendar_reader_change' and effective_from is null and effective_from_date='2026-10-02' and effective_timezone='America/Los_Angeles'),'Calendar evidence is stored without fabricating midnight or an installation timestamp');
select is(private.resolve_machine_reader_purchase_owner('TGPACI_USA_DB','18030001',null),null::uuid,'Unproved old installation interval never attributes unseen transactions');
select ok(exists(select 1 from private.machine_nayax_reader_associations where reporting_machine_id='aa180303-0000-4000-8000-000000000001' and nayax_machine_id='18030001' and ownership_basis='original_transactions_only' and closed_on='2026-10-02' and effective_from is null and effective_until is null),'Legacy reader retirement retains the actual calendar evidence and original-only basis');
select is(private.resolve_machine_reader_purchase_owner('TGPACI_USA_DB','18030002','2026-10-03T08:00:00Z'),'aa180303-0000-4000-8000-000000000001'::uuid,'Known authorization after the replacement day belongs to the same machine');
select is(private.resolve_machine_reader_purchase_owner('TGPACI_USA_DB','18030002','2026-10-02T12:00:00Z'),null::uuid,'Date-only replacement day is explicitly ambiguous for unseen transactions');
-- Exact old transactions remain with their original cabinet. Unseen switch-day
-- transactions are pending rather than assigned by an invented midnight.
insert into nayax_scheduled_report_files(file_digest,received_at,byte_count,row_count,report) values(repeat('5',64),'2026-10-04T03:00:00Z',800,4,'{}');
create function pg_temp.reader_change_native(p_reader text,p_transaction text,p_hash text,p_day date) returns jsonb language sql as $$
 select jsonb_build_object('transactionId',p_transaction,'siteId','4','actorId','2003563806','providerMachineId',p_reader,'currencyCode','USD','authorizationAmountCents',1100,'settlementAmountCents',1100,'paidAmountCents',1100,
 'machineAuthorizedAt',p_day::text||'T12:00:00','authorizedAt',p_day::text||'T19:00:00Z','machineSettledAt',p_day::text||'T12:00:01','providerSettledAt',p_day::text||'T19:00:01Z','providerUpdatedAt',p_day::text||'T19:00:02Z','providerStatus',12,'providerStatusName','Settled','sourceOrderHash',p_hash,'sourceRowHash',repeat('2',64))
$$;
select set_config('request.jwt.claim.role','service_role',true);
select lives_ok($$select service_ingest_nayax_scheduled_sales(repeat('5',64),jsonb_build_array(
 pg_temp.reader_change_native('18030001','1803000101',repeat('a',64),'2026-09-01'),
 pg_temp.reader_change_native('18030002','1803000201',repeat('1a',32),'2026-10-03'),
 pg_temp.reader_change_native('18030002','1803000202',repeat('1b',32),'2026-10-02'),
 pg_temp.reader_change_native('18030001','1803000102',repeat('1c',32),'2026-09-02')))$$,'Replacement replay and new-reader ingestion use reviewed ownership without guessing switch-day time');
select results_eq($$select reporting_machine_id,sale_date,net_sales_cents from machine_sales_facts where source_order_hash=repeat('a',64)$$,$$ values('aa180303-0000-4000-8000-000000000001'::uuid,'2026-09-01'::date,1100)$$,'Exact original old-reader transaction keeps machine/day/amount after replacement replay');
select is((select count(*) from machine_sales_facts where source_order_hash=repeat('a',64)),1::bigint,'Old-reader file replay cannot duplicate the original financial fact');
select is((select reporting_machine_id from machine_sales_facts where source_order_hash=repeat('1a',32)),'aa180303-0000-4000-8000-000000000001'::uuid,'New-reader authorized purchase after the actual change day reaches the same stable cabinet');
select ok(not exists(select 1 from machine_sales_facts where source_order_hash in(repeat('1b',32),repeat('1c',32))),'Switch-day and unknown old interval evidence add no invented revenue or units');
select is((select count(*) from nayax_pending_sales where source_order_hash in(repeat('1b',32),repeat('1c',32))),2::bigint,'Ambiguous historical observations remain recoverable pending');
select is((service_ingest_nayax_scheduled_sales(repeat('5',64),'[]'::jsonb)->>'duplicate')::boolean,true,'Repeated replacement import file is idempotent');
-- A real move between two cabinets requires an actual UTC instant. Existing
-- dated authority and old card/source daily projection stay with the old Hub.
set local session_replication_role=replica;
insert into reporting_machines(id,account_id,location_id,machine_label,machine_type,sunze_machine_id) values
 ('aa180303-0000-4000-8000-000000000003','aa180301-0000-4000-8000-000000000001','aa180302-0000-4000-8000-000000000001','Different physical cabinet','commercial','reader-change-other-source');
insert into sunze_machine_discoveries(sunze_machine_id,sunze_machine_name,status,reporting_machine_id) values('reader-change-other-source','Different source cabinet','mapped','aa180303-0000-4000-8000-000000000003');
set local session_replication_role=origin;
create temporary table reader_move_before as select
 (select jsonb_agg(to_jsonb(m) order by id) from reporting_machines m where id::text like 'aa180303-%') machines,
 (select jsonb_agg(to_jsonb(i) order by id) from refund_nayax_machine_inventory i where id::text like 'aa180304-%') inventory,
 (select jsonb_agg(to_jsonb(f) order by id) from machine_sales_facts f where reporting_machine_id='aa180303-0000-4000-8000-000000000002') dated_facts,
 (select jsonb_agg(to_jsonb(component) order by booking_date,tender) from private.machine_sales_daily_components('aa180303-0000-4000-8000-000000000002','2026-09-01','2026-09-30') component) components,
 (select updated_at from reporting_machines where id='aa180303-0000-4000-8000-000000000003') target_stamp,
 (select updated_at from reporting_machines where id='aa180303-0000-4000-8000-000000000002') owner_stamp,
 (select count(*) from private.machine_nayax_reader_associations) history_count,
 (select count(*) from admin_audit_log) audits;
grant select on reader_move_before to authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
set local role authenticated;
select throws_ok($$select admin_change_machine_reader('aa180303-0000-4000-8000-000000000003','aa180304-0000-4000-8000-000000000003',(select target_stamp from reader_move_before),null,'America/Los_Angeles','2026-10-03','2026-10-03T19:00Z','Occupied reader missing owner review')$$,'40001',null,'Occupied reader requires the exact former-owner snapshot');
select throws_ok($$select admin_change_machine_reader('aa180303-0000-4000-8000-000000000003','aa180304-0000-4000-8000-000000000003',(select target_stamp from reader_move_before),(select owner_stamp from reader_move_before),'America/Los_Angeles','2026-10-03',null,'Date without actual between-cabinet time')$$,'22023',null,'Cross-machine calendar-only evidence cannot silently move ownership');
reset role;
create function pg_temp.fail_reader_move_audit() returns trigger language plpgsql as $$begin if new.action='reporting_machine.reader_changed' and new.entity_id='aa180303-0000-4000-8000-000000000003' then raise exception 'Synthetic final reader move audit failure' using errcode='P0001'; end if; return new; end$$;
create trigger reader_move_late_failure before insert on admin_audit_log for each row execute function pg_temp.fail_reader_move_audit();
set local role authenticated;
select throws_ok($$select admin_change_machine_reader('aa180303-0000-4000-8000-000000000003','aa180304-0000-4000-8000-000000000003',(select target_stamp from reader_move_before),(select owner_stamp from reader_move_before),'America/Los_Angeles','2026-10-03','2026-10-03T19:00Z','Explicit different-cabinet reviewed reader move')$$,'P0001','Synthetic final reader move audit failure','Late final audit rolls back both owners, policy, inventory and history');
reset role;
drop trigger reader_move_late_failure on admin_audit_log;
select is((select jsonb_agg(to_jsonb(m) order by id) from reporting_machines m where id::text like 'aa180303-%'),(select machines from reader_move_before),'Rejected move preserves complete machine fields and timestamps');
select is((select jsonb_agg(to_jsonb(i) order by id) from refund_nayax_machine_inventory i where id::text like 'aa180304-%'),(select inventory from reader_move_before),'Rejected move preserves every current reader pointer');
select is((select count(*) from private.machine_nayax_reader_associations),(select history_count from reader_move_before),'Rejected move creates no partial ownership interval');
select is((select count(*) from admin_audit_log),(select audits from reader_move_before),'Rejected move commits no partial canonical audit');
select ok(not exists(select 1 from private.machine_card_financial_policies where reporting_machine_id='aa180303-0000-4000-8000-000000000003'),'Rejected move rolls back new financial policy');
set local role authenticated;
select lives_ok($$select admin_change_machine_reader('aa180303-0000-4000-8000-000000000003','aa180304-0000-4000-8000-000000000003',(select target_stamp from reader_move_before),(select owner_stamp from reader_move_before),'America/Los_Angeles','2026-10-03','2026-10-03T19:00Z','Explicit different-cabinet reviewed reader move')$$,'Reviewed actual cross-machine instant completes atomically');
reset role;
select is((select nayax_machine_id from reporting_machines where id='aa180303-0000-4000-8000-000000000002'),null::text,'Previous owner has no current reader after the actual move');
select is((select nayax_card_sales_started_on from reporting_machines where id='aa180303-0000-4000-8000-000000000002'),'2025-01-01'::date,'Former owner keeps its original real authority boundary');
select is((select nayax_machine_id from reporting_machines where id='aa180303-0000-4000-8000-000000000003'),'18030003','Incoming owner has the one reviewed current reader');
select lives_ok($$select private.reconcile_machine_card_sales_authority('aa180303-0000-4000-8000-000000000002','2026-09-01')$$,'Later authority reconciliation recognizes reviewed former reader ownership');
select is((select jsonb_agg(to_jsonb(f) order by id) from machine_sales_facts f where reporting_machine_id='aa180303-0000-4000-8000-000000000002'),(select dated_facts from reader_move_before),'Reconciliation after detach preserves exact old source/card/projection fact bytes');
select is((select jsonb_agg(to_jsonb(component) order by booking_date,tender) from private.machine_sales_daily_components('aa180303-0000-4000-8000-000000000002','2026-09-01','2026-09-30') component),(select components from reader_move_before),'Former dated owner money/tax/count/units remain unchanged after replay reconciliation');
select ok(exists(select 1 from private.machine_nayax_reader_associations where reporting_machine_id='aa180303-0000-4000-8000-000000000002' and nayax_machine_id='18030003' and ownership_basis='original_transactions_only' and effective_until='2026-10-03T19:00Z'),'Unproved former installation period is recorded only as original-transaction evidence');
select is(private.resolve_machine_reader_purchase_owner('TGPACI_USA_DB','18030003','2026-10-03T19:00:01Z'),'aa180303-0000-4000-8000-000000000003'::uuid,'After the actual move instant new purchases use the new physical owner');
select is(private.resolve_machine_reader_purchase_owner('TGPACI_USA_DB','18030003','2026-10-03T18:59:59Z'),null::uuid,'Unseen pre-transfer transactions are not assigned through an invented old installation period');
select * from finish();
rollback;
