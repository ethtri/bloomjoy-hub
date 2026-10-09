begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
set local session_replication_role=replica;
insert into auth.users(id,email) values
 ('b1825000-0000-4000-8000-000000000001','rate-admin@example.invalid'),
 ('b1825000-0000-4000-8000-000000000002','rate-other@example.invalid');
insert into admin_roles(user_id,role,active) values('b1825000-0000-4000-8000-000000000001','super_admin',true);
insert into customer_profiles(user_id,full_name) values('b1825000-0000-4000-8000-000000000001','Synthetic Rate Administrator');
insert into customer_accounts(id,name) values('b1825100-0000-4000-8000-000000000001','Rate policy fixture');
insert into reporting_locations(id,account_id,name,timezone) values
 ('b1825200-0000-4000-8000-000000000001','b1825100-0000-4000-8000-000000000001','Rate site','America/New_York');
insert into reporting_machines(id,account_id,location_id,machine_label) values
 ('b1825300-0000-4000-8000-000000000001','b1825100-0000-4000-8000-000000000001','b1825200-0000-4000-8000-000000000001','Rate machine'),
 ('b1825300-0000-4000-8000-000000000002','b1825100-0000-4000-8000-000000000001','b1825200-0000-4000-8000-000000000001','Verified zero source');
update reporting_machines set nayax_machine_id='1825000002',nayax_account_key='TGPACI_USA_DB' where id='b1825300-0000-4000-8000-000000000002';
insert into private.nayax_machine_tax_observations(account_key,nayax_machine_id,observed_at,source,classification,
 rate_percent,provenance,effective_start_date,effective_end_date) values
 ('TGPACI_USA_DB','1825000002',statement_timestamp(),'owner_stable_rate','verified_tax',0,
 '#1824; owner attestation: synthetic zero rate; verified observation IDs=synthetic','-infinity',(statement_timestamp() at time zone 'UTC')::date);
insert into private.refund_request_recognition_rollout(singleton,activated_at,activated_by)
 values(true,'2026-10-01','Synthetic rate policy fixture') on conflict(singleton) do update set activated_at=excluded.activated_at;
set local session_replication_role=origin;
select set_config('request.jwt.claim.sub','b1825000-0000-4000-8000-000000000001',true);
select is(public.admin_get_reporting_machine_rate_policy('b1825300-0000-4000-8000-000000000001')->'current'->>'status','unavailable','Unconfigured machine is unavailable');
select is(public.admin_get_reporting_machine_rate_policy('b1825300-0000-4000-8000-000000000001')->>'asOfDate',
 (statement_timestamp() at time zone 'America/New_York')::date::text,'Editor uses financial machine business date');
create temporary table rate_preview as select public.admin_preview_reporting_machine_rate_policy(
 'b1825300-0000-4000-8000-000000000001',8,'provisional','2026-01-01',null,'Synthetic estimate',null) result;
select is((select count(*) from private.reporting_machine_rate_policies),0::bigint,'Preview hypothetical policy is rolled back');
select lives_ok($$select public.admin_save_reporting_machine_rate_policy('b1825300-0000-4000-8000-000000000001',8,'provisional','2026-01-01',null,'Synthetic estimate',null,(select (result->>'previewToken')::uuid from rate_preview))$$,'Reviewed draft saves');
select lives_ok($$select public.admin_save_reporting_machine_rate_policy('b1825300-0000-4000-8000-000000000001',8,'provisional','2026-01-01',null,'Synthetic estimate',null,(select (result->>'previewToken')::uuid from rate_preview))$$,'Lost reply retry is idempotent');
select is((select count(*) from private.reporting_machine_rate_policies),1::bigint,'Retry creates no duplicate policies');
select is(public.admin_get_reporting_machine_rate_policy('b1825300-0000-4000-8000-000000000001')->'policies'->0->>'createdByLabel','Synthetic Rate Administrator','Policy history identifies actual safe profile author');
select is(public.admin_get_reporting_machine_rate_policy('b1825300-0000-4000-8000-000000000002')->'current'->>'startsOn',null::text,'Infinite source coverage serializes as null instead of invalid date string');
select is((public.admin_get_reporting_machine_rate_policy('b1825300-0000-4000-8000-000000000002')->'current'->>'ratePercent')::numeric,0::numeric,'Verified source zero stays distinct from missing rate');
set local session_replication_role=replica;
insert into machine_sales_facts(id,reporting_machine_id,reporting_location_id,sale_date,payment_method,
 net_sales_cents,tax_cents,transaction_count,source,source_row_hash,raw_payload) values
 ('b1825500-0000-4000-8000-000000000001','b1825300-0000-4000-8000-000000000001','b1825200-0000-4000-8000-000000000001','2026-09-01','credit',1080,0,1,
 'nayax_scheduled_report',repeat('c',64),'{"actorId":"2003563806","providerMachineId":"1825000001","transactionId":"rate-sale","currencyCode":"USD","amountBasis":"tax_inclusive","manualDtmEvidence":true}');
set local session_replication_role=origin;
select is((select estimatedSalesExTaxCents from (select (tax_policy_evidence->>'estimatedSalesExTaxCents')::bigint as estimatedSalesExTaxCents
 from private.sales_report_rows_for_actor('b1825000-0000-4000-8000-000000000001','2026-09-01','2026-09-01','day',array['b1825300-0000-4000-8000-000000000001'::uuid],null,null)) r),1000::bigint,'Actual report RPC exposes incremental provisional sales');
select is((select gross_sales_known_cents from private.sales_report_rows_for_actor('b1825000-0000-4000-8000-000000000001','2026-09-01','2026-09-01','day',array['b1825300-0000-4000-8000-000000000001'::uuid],null,null)),null::bigint,'Estimate never enters canonical confirmed gross subtotal');
create temporary table rate_change_preview as select public.admin_preview_reporting_machine_rate_policy(
 'b1825300-0000-4000-8000-000000000001',10,'provisional','2026-01-01',null,'Synthetic revised estimate',null) result;
select is((select (result->>'affectedSalesComponents')::bigint from rate_change_preview),1::bigint,'Changing an existing estimated rate counts its actually changed sales component');
select is((select (result->'after'->>'estimatedSalesExTaxCents')::bigint from rate_change_preview),982::bigint,'Preview shows proposed estimated amount');
select throws_ok($$select public.admin_save_reporting_machine_rate_policy('b1825300-0000-4000-8000-000000000001',11,'provisional','2026-01-01',null,'Synthetic revised estimate',null,(select (result->>'previewToken')::uuid from rate_change_preview))$$,
 '40001','Draft changed; preview again','A preview cannot authorize a changed rate draft');
set local session_replication_role=replica;
update machine_sales_facts set tax_cents=80,raw_payload=raw_payload||'{"taxBasis":"separate_tax","_salesAuthorityOriginal":{"amountCents":1080,"taxCents":80}}'::jsonb
 where id='b1825500-0000-4000-8000-000000000001';
set local session_replication_role=origin;
select throws_ok($$select public.admin_save_reporting_machine_rate_policy('b1825300-0000-4000-8000-000000000001',10,'provisional','2026-01-01',null,'Synthetic revised estimate',null,(select (result->>'previewToken')::uuid from rate_change_preview))$$,
 '40001','Reporting inputs changed; preview again','Original recorded tax arriving invalidates stale preview');
set local session_replication_role=replica;
update machine_sales_facts set tax_cents=0,raw_payload='{"actorId":"2003563806","providerMachineId":"1825000001","transactionId":"rate-sale","currencyCode":"USD","amountBasis":"tax_inclusive","manualDtmEvidence":true}'
 where id='b1825500-0000-4000-8000-000000000001';
set local session_replication_role=origin;
select is((select tax_exclusive_amount_cents from private.normalize_refund_original_reader_amount_cents(
 'b1825300-0000-4000-8000-000000000001','card','2026-09-01',1080,'tax_inclusive',null,null,true)),null::bigint,'Provisional rate preserves authoritative unknown');
select is((select tax_exclusive_amount_cents from private.normalize_refund_original_reader_amount_cents_estimate(
 'b1825300-0000-4000-8000-000000000001','card','2026-09-01',1080,'tax_inclusive',null,null,true)),1000::bigint,'Provisional rate supplies separately estimated amount');
select is((select tax_exclusive_amount_cents from private.normalize_refund_original_reader_amount_cents_estimate(
 'b1825300-0000-4000-8000-000000000001','card','2026-09-01',1080,'separate_tax',null,0,true)),1080::bigint,'Actual tax zero precedes provisional estimate');
select is((select tax_exclusive_amount_cents from private.normalize_original_reader_amount_cents_estimate(
 'b1825300-0000-4000-8000-000000000001','card','2026-09-01',1080,'tax_exclusive',null,null,true,'sunze_browser',null)),1080::bigint,'Tax-exclusive source never double taxes');
select is((select tax_exclusive_amount_cents from private.normalize_refund_original_reader_amount_cents_estimate(
 'b1825300-0000-4000-8000-000000000001','cash','2026-09-01',1080,'tax_inclusive',null,null,true)),1080::bigint,'Cash remains untaxed');
select private.version_reporting_machine_rate_policy('b1825300-0000-4000-8000-000000000001',10,'confirmed','2026-09-01','2026-09-30','Synthetic dated correction','Owner correction','b1825000-0000-4000-8000-000000000001');
select is((select count(*) from private.reporting_machine_rate_policies where superseded_at is null),3::bigint,'Historical edit preserves both surviving ranges');
select is((private.reporting_machine_rate_policy('b1825300-0000-4000-8000-000000000001','2026-10-01','provisional')).rate_percent,8::numeric,'Current surviving estimate retains provenance/rate');
select is((select tax_exclusive_amount_cents from private.normalize_refund_original_reader_amount_cents(
 'b1825300-0000-4000-8000-000000000001','card','2026-09-01',1100,'tax_inclusive',null,null,true)),1000::bigint,'Confirmed policy supplies canonical corrected amount');
select is((select tax_exclusive_amount_cents from private.normalize_refund_original_reader_amount_cents(
 'b1825300-0000-4000-8000-000000000001','card','2026-09-01',1100,'separate_tax',null,50,true)),1050::bigint,'Actual original tax precedes confirmed correction');
select is((select tax_exclusive_amount_cents from private.normalize_refund_original_reader_amount_cents(
 'b1825300-0000-4000-8000-000000000001','unknown','2026-09-01',1100,'tax_inclusive',null,null,true)),null::bigint,'Confirmed rate does not invent card tender');
create temporary table deconfirm_preview as select public.admin_preview_reporting_machine_rate_policy(
 'b1825300-0000-4000-8000-000000000001',8,'provisional','2026-09-01','2026-09-30','Synthetic return to estimate',null) result;
select is((select (result->>'affectedSalesComponents')::bigint from deconfirm_preview),1::bigint,'Confirmed to provisional counts changed authoritative component once');
select is((select (result->'after'->>'unknownSalesComponents')::bigint from deconfirm_preview),1::bigint,'Deconfirm preview restores canonical unknown rather than silently verifying estimate');
select is((select (result->'after'->>'estimatedSalesExTaxCents')::bigint from deconfirm_preview),1000::bigint,'Deconfirm preview retains useful separate estimated money');
select public.admin_save_reporting_machine_rate_policy('b1825300-0000-4000-8000-000000000001',8,'provisional','2026-09-01','2026-09-30','Synthetic return to estimate',null,(select (result->>'previewToken')::uuid from deconfirm_preview));
set local session_replication_role=replica;
insert into machine_sales_facts(id,reporting_machine_id,reporting_location_id,sale_date,payment_method,
 net_sales_cents,tax_cents,transaction_count,source,source_row_hash,raw_payload) values
 ('b1825500-0000-4000-8000-000000000002','b1825300-0000-4000-8000-000000000001','b1825200-0000-4000-8000-000000000001','2026-09-01','credit',500,0,1,
 'manual_csv',repeat('d',64),'{"amountBasis":"unknown"}'),
 ('b1825500-0000-4000-8000-000000000003','b1825300-0000-4000-8000-000000000001','b1825200-0000-4000-8000-000000000001','2026-09-01','credit',250,0,1,
 'manual_csv',repeat('f',64),'{"amountBasis":"tax_exclusive"}');
insert into sales_adjustment_facts(id,reporting_machine_id,reporting_location_id,adjustment_date,adjustment_type,
 amount_cents,source,source_reference,source_row_reference,source_row_hash,match_status,raw_payload,created_at,updated_at)
 values('b1825600-0000-4000-8000-000000000001','b1825300-0000-4000-8000-000000000001','b1825200-0000-4000-8000-000000000001','2026-10-01','refund',1080,
 'google_sheets','sheet:rate-policy','rate-refund',repeat('e',64),'applied',
 '{"original_order_date":"2026-09-01","payment_method":"credit","amountBasis":"gross_customer_charge_minor","source_evidence":{"schema":"original_refund_payment.v1","tender_source":"original_payment_method","amount_source":"refund_amount"}}','2026-09-30','2026-09-30');
set local session_replication_role=origin;
create temporary table actual_rate_rpc as select * from private.sales_report_rows_for_actor(
 'b1825000-0000-4000-8000-000000000001','2026-09-01','2026-10-01','day',array['b1825300-0000-4000-8000-000000000001'::uuid],null,null);
select is((select gross_sales_unknown_count from actual_rate_rpc where period_start='2026-09-01'),2::bigint,'Mixed supported and unknown-basis source components both remain canonically unresolved');
select is((select (tax_policy_evidence->>'provisionalSalesComponents')::bigint from actual_rate_rpc where period_start='2026-09-01'),1::bigint,'Estimate covers only the supported portion of a partial source group');
select is((select gross_sales_known_cents from actual_rate_rpc where period_start='2026-09-01'),250::bigint,'Partial confirmed money is retained alongside estimate and remaining unknown');
select is((select (tax_policy_evidence->>'estimatedRefundExTaxCents')::bigint from actual_rate_rpc where period_start='2026-10-01'),1000::bigint,'Historical purchase policy estimates later recognized refund without moving booking');
select is((select (tax_policy_evidence->>'estimatedNetExTaxCents')::bigint from actual_rate_rpc where period_start='2026-10-01'),-1000::bigint,'Refund estimate deducts from operational estimated net');
select is((select (tax_policy_evidence->>'provisionalNetComponents')::bigint from actual_rate_rpc where period_start='2026-10-01'),1::bigint,'Explicit provisional net component count shares canonical net units');
set local session_replication_role=replica;
insert into public.machine_sales_facts(reporting_machine_id,reporting_location_id,sale_date,payment_method,net_sales_cents,tax_cents,transaction_count,item_quantity,source,source_row_hash,source_order_hash,raw_payload)
select 'b1825300-0000-4000-8000-000000000001','b1825200-0000-4000-8000-000000000001','2026-09-02','credit',1080*n,0,1,1,'nayax_scheduled_report',md5('rate-two-reader-'||n),md5('rate-two-reader-order-'||n),
 jsonb_build_object('amountBasis','tax_inclusive','actorId','2003563806','providerMachineId',(1825000002+n)::text,'transactionId','rate-two-reader-'||n,'currencyCode','USD','manualDtmEvidence',true)
from generate_series(1,2)n;
set local session_replication_role=origin;
select is((select (tax_policy_evidence->>'provisionalSalesComponents')::bigint from private.sales_report_rows_for_actor(
 'b1825000-0000-4000-8000-000000000001','2026-09-02','2026-09-02','day',array['b1825300-0000-4000-8000-000000000001'::uuid],null,null)),2::bigint,'One final tuple retains two provisional normalization contributors');
create temp table multi_contributor_preview as select public.admin_preview_reporting_machine_rate_policy(
 'b1825300-0000-4000-8000-000000000001',9,'provisional','2026-09-02','2026-09-02','Synthetic grouped impact correction',null) result;
select is((select (result->>'affectedSalesComponents')::bigint from multi_contributor_preview),1::bigint,'Preview counts a changed grouped sales amount once while coverage remains two');
set local session_replication_role=replica;
update public.reporting_machines set nayax_machine_id='1825000001',nayax_account_key='TGPACI_USA_DB'
 where id='b1825300-0000-4000-8000-000000000001';
insert into private.nayax_machine_tax_observations(account_key,nayax_machine_id,observed_at,source,classification,rate_percent,provenance,effective_start_date,effective_end_date)
values('TGPACI_USA_DB','1825000001','2026-09-01','nayax_api','verified_tax',8,'Synthetic later available verified source','2026-09-01',null);
set local session_replication_role=origin;
select is((public.admin_get_reporting_machine_rate_policy('b1825300-0000-4000-8000-000000000001')->'current'->>'status'),'source_verified','Verified source replaces provisional display authority');
select is((select (tax_policy_evidence->>'provisionalSalesComponents')::bigint from private.sales_report_rows_for_actor(
 'b1825000-0000-4000-8000-000000000001','2026-09-01','2026-09-01','day',array['b1825300-0000-4000-8000-000000000001'::uuid],null,null)),null::bigint,'Verified source replaces provisional money instead of double-counting it');
select set_config('request.jwt.claim.sub','b1825000-0000-4000-8000-000000000002',true);
select throws_ok($$select public.admin_get_reporting_machine_rate_policy('b1825300-0000-4000-8000-000000000001')$$,'42501','Machine reporting administration required','Unauthorised actor cannot inspect policy');
select throws_ok($$select public.admin_save_reporting_machine_rate_policy('b1825300-0000-4000-8000-000000000001',8,'provisional','2026-01-01',null,'Synthetic estimate',null,(select (result->>'previewToken')::uuid from rate_preview))$$,'42501','Machine reporting administration required','Unauthorised actor cannot reuse another preview');
select ok(not has_table_privilege('authenticated','private.reporting_machine_rate_policies','select'),'Policy table is private');
select ok(not has_function_privilege('anon','public.admin_get_reporting_machine_rate_policy(uuid)','execute'),'Anonymous policy access denied');
select * from finish();
rollback;
