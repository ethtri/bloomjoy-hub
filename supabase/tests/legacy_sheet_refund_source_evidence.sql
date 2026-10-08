begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
set local session_replication_role=replica;
insert into private.refund_request_recognition_rollout(singleton,activated_at,activated_by)
 values(true,'2026-10-01','Synthetic Sheet evidence fixture') on conflict(singleton) do update set activated_at=excluded.activated_at;
set local session_replication_role=replica;
insert into auth.users(id,email) values('b1824000-0000-4000-8000-000000000091','sheet-evidence@example.invalid');
insert into customer_accounts(id,name) values('b1824100-0000-4000-8000-000000000091','Sheet evidence fixture');
insert into reporting_locations(id,account_id,name,timezone) values
 ('b1824200-0000-4000-8000-000000000091','b1824100-0000-4000-8000-000000000091','Sheet site','America/Los_Angeles');
insert into reporting_machines(id,account_id,location_id,machine_label,nayax_machine_id,nayax_account_key) values
 ('b1824300-0000-4000-8000-000000000091','b1824100-0000-4000-8000-000000000091','b1824200-0000-4000-8000-000000000091','Consistent','1824000091','TGPACI_USA_DB'),
 ('b1824300-0000-4000-8000-000000000092','b1824100-0000-4000-8000-000000000091','b1824200-0000-4000-8000-000000000091','Conflicting','1824000092','TGPACI_USA_DB'),
 ('b1824300-0000-4000-8000-000000000093','b1824100-0000-4000-8000-000000000091','b1824200-0000-4000-8000-000000000091','No evidence',null,'TGPACI_USA_DB'),
 ('b1824300-0000-4000-8000-000000000094','b1824100-0000-4000-8000-000000000091','b1824200-0000-4000-8000-000000000091','Historical only',null,'TGPACI_USA_DB');
insert into private.machine_nayax_reader_associations(account_key,nayax_machine_id,reporting_machine_id,ownership_basis,created_by,reason) values
 ('TGPACI_USA_DB','1824000094','b1824300-0000-4000-8000-000000000091','same_physical_machine_all_history','b1824000-0000-4000-8000-000000000091','Synthetic consistent old reader'),
 ('TGPACI_USA_DB','1824000095','b1824300-0000-4000-8000-000000000092','same_physical_machine_all_history','b1824000-0000-4000-8000-000000000091','Synthetic conflicting old reader'),
 ('TGPACI_USA_DB','1824000096','b1824300-0000-4000-8000-000000000094','same_physical_machine_all_history','b1824000-0000-4000-8000-000000000091','Synthetic historical only reader');
insert into private.nayax_machine_tax_observations(account_key,nayax_machine_id,observed_at,source,classification,rate_percent,provenance,effective_start_date,effective_end_date)
select 'TGPACI_USA_DB',reader,'2026-10-08','owner_stable_rate','verified_tax',rate,
 '#1824; owner attestation: synthetic unchanged machine rates; verified observation IDs=synthetic','-infinity','2026-10-08'
from (values('1824000091',8::numeric),('1824000094',8::numeric),('1824000092',0.09::numeric),('1824000095',9::numeric),('1824000096',8::numeric)) fixtures(reader,rate);
insert into refund_adjustment_review_rows(id,source_reference,source_row_reference,source_row_hash,source_location,
 refund_date,original_order_date,amount_cents,match_status,match_confidence,matched_machine_id)
 values('b1824600-0000-4000-8000-000000000091','sheet:synthetic','synthetic-request',repeat('a',64),'Sheet site',
 '2026-09-30','2026-09-15',1080,'applied',1,'b1824300-0000-4000-8000-000000000091');
set local session_replication_role=origin;
insert into sales_adjustment_facts(id,reporting_machine_id,reporting_location_id,adjustment_date,adjustment_type,
 amount_cents,source,source_reference,source_row_reference,source_row_hash,raw_payload,created_at,updated_at,refund_review_row_id,match_status,match_confidence)
values('b1824500-0000-4000-8000-000000000091','b1824300-0000-4000-8000-000000000091',
 'b1824200-0000-4000-8000-000000000091','2026-09-30','refund',1080,'google_sheets','sheet:synthetic','synthetic-request',repeat('a',64),
 '{"amount_source":"refund_amount","source_status":"Closed","source_decision":"Approve","original_order_date":"2026-09-15","source_location":"Sheet site","refund_date":"2026-09-30"}',
 '2026-09-30','2026-09-30','b1824600-0000-4000-8000-000000000091','applied',1);
set local session_replication_role=origin;
create temporary table original_sheet_financial as select to_jsonb(adjustment)-array['raw_payload','updated_at'] financial
from sales_adjustment_facts adjustment where id='b1824500-0000-4000-8000-000000000091';
create temporary table sheet_proof as select jsonb_build_array(jsonb_build_object(
 'id','b1824500-0000-4000-8000-000000000091','sourceReference','sheet:synthetic','sourceRowReference','synthetic-request',
 'sourceRowHash',repeat('a',64),'machineId','b1824300-0000-4000-8000-000000000091','refundDate','2026-09-30',
 'originalOrderDate','2026-09-15','amountCents',1080,'originalTender','credit','amountSource','refund_amount')) proof;
select is(private.resolve_unique_stable_machine_tax('b1824300-0000-4000-8000-000000000091','2026-09-15'),8::numeric,'All approved reader rates agree');
select is(private.resolve_unique_stable_machine_tax('b1824300-0000-4000-8000-000000000092','2026-09-15'),null::numeric,'Current fractional percent cannot override different approved original rate');
select is(private.resolve_unique_stable_machine_tax('b1824300-0000-4000-8000-000000000093',null),null::numeric,'No identity/rate evidence remains unknown');
select is((public.service_reconcile_sheet_refund_source_evidence((select proof from sheet_proof),'Synthetic original K/Q review')->>'changed')::integer,1,'Exact source evidence repair changes one payload');
select is((public.service_reconcile_sheet_refund_source_evidence((select proof from sheet_proof),'Synthetic repeated review')->>'changed')::integer,0,'Repair replay is idempotent');
select is((select to_jsonb(adjustment)-array['raw_payload','updated_at'] from sales_adjustment_facts adjustment where id='b1824500-0000-4000-8000-000000000091'),
 (select financial from original_sheet_financial),'Every financial field, date and immutable hash is unchanged');
select ok((select updated_at>'2026-09-30'::timestamptz from sales_adjustment_facts where id='b1824500-0000-4000-8000-000000000091'),'Evidence update advances audit timestamp on the older existing row');
select results_eq($$select booking_date,legacy_paid_deduction_ex_tax_cents from private.machine_sales_daily_components(
 'b1824300-0000-4000-8000-000000000091','2026-09-30','2026-09-30') where source='google_sheets'$$,
 $$select '2026-09-30'::date,1000::bigint$$,'Actual persisted Sheet payload normalizes through canonical adapter without moving refund booking');
select results_eq($$select tax_exclusive_amount_cents,tax_cents from private.normalize_refund_original_reader_amount_cents('b1824300-0000-4000-8000-000000000091','card','2026-09-15',1080,'tax_inclusive',null,null,true)$$,
 $$select 1000::bigint,80::bigint$$,'Machine-level owner proof normalizes supported gross customer refund');
select results_eq($$select tax_exclusive_amount_cents,tax_cents from private.normalize_refund_original_reader_amount_cents('b1824300-0000-4000-8000-000000000094','card','2026-09-15',1080,'tax_inclusive',null,null,true)$$,
 $$select 1000::bigint,80::bigint$$,'Historical-only approved reader normalizes without a current configuration reader');
select results_eq($$select tax_exclusive_amount_cents,tax_cents from private.normalize_refund_original_reader_amount_cents('b1824300-0000-4000-8000-000000000092','card','2026-09-15',1080,'tax_inclusive',null,0,true)$$,
 $$select 1080::bigint,0::bigint$$,'Actual explicit zero tax wins despite rate conflict');
select results_eq($$select tax_exclusive_amount_cents,tax_cents from private.normalize_refund_original_reader_amount_cents('b1824300-0000-4000-8000-000000000092','card','2026-09-15',1080,'tax_inclusive',null,100,true)$$,
 $$select 980::bigint,100::bigint$$,'Actual positive transaction tax wins over every machine percentage');
select is((select tax_exclusive_amount_cents from private.normalize_refund_original_reader_amount_cents('b1824300-0000-4000-8000-000000000091','card','2026-09-15',1080,'unknown',null,null,true)),null::bigint,'Unique rate does not invent customer amount basis');
select results_eq($$select tax_exclusive_amount_cents,tax_cents from private.normalize_refund_original_reader_amount_cents('b1824300-0000-4000-8000-000000000092','cash',null,1080,'unknown',null,null,true)$$,
 $$select 1080::bigint,0::bigint$$,'Recorded cash stays cash independently of card-rate conflict');
select throws_ok($$select public.service_reconcile_sheet_refund_source_evidence(jsonb_set((select proof from sheet_proof),'{0,amountCents}','1081'),'Synthetic stale proof')$$,
 '22023','Source evidence does not match retained financial identity','Mismatched retained amount cannot alter evidence');
select throws_ok($$select public.service_reconcile_sheet_refund_source_evidence(jsonb_set((select proof from sheet_proof),'{0,sourceRowHash}','"wrong"'),'Synthetic stale proof')$$,
 '22023','Source evidence does not match retained financial identity','Wrong hash cannot alter evidence');
select throws_ok($$select public.service_reconcile_sheet_refund_source_evidence(jsonb_set((select proof from sheet_proof),'{0,machineId}','"b1824300-0000-4000-8000-000000000092"'),'Synthetic stale proof')$$,
 '22023','Source evidence does not match retained financial identity','Another financial machine cannot supply proof');
select throws_ok($$select public.service_reconcile_sheet_refund_source_evidence(jsonb_set((select proof from sheet_proof),'{0,sourceReference}','"sheet:other"'),'Synthetic stale proof')$$,
 '22023','Source evidence does not match retained financial identity','Another sheet identity cannot supply proof');
select throws_ok($$select public.service_reconcile_sheet_refund_source_evidence(jsonb_set((select proof from sheet_proof),'{0,refundDate}','"2026-09-29"'),'Synthetic stale proof')$$,
 '22023','Source evidence does not match retained financial identity','Different refund date cannot supply proof');
select throws_ok($$select public.service_reconcile_sheet_refund_source_evidence(jsonb_set((select proof from sheet_proof),'{0,originalOrderDate}','"2026-09-14"'),'Synthetic stale proof')$$,
 '22023','Source evidence does not match retained financial identity','Different original purchase date cannot supply proof');
update sales_adjustment_facts set raw_payload=raw_payload-'source_evidence_reconciliation' where id='b1824500-0000-4000-8000-000000000091';
select ok((select raw_payload ? 'source_evidence_reconciliation' from sales_adjustment_facts where id='b1824500-0000-4000-8000-000000000091'),'Unchanged future sync retains review provenance');
update sales_adjustment_facts set raw_payload=raw_payload-array['source_evidence_parser','payment_method','payment_method_source','amountBasis','source_evidence','source_evidence_reconciliation']
 where id='b1824500-0000-4000-8000-000000000091';
select ok((select raw_payload ? 'source_evidence_reconciliation' and raw_payload->>'payment_method'='credit'
 and raw_payload->>'source_evidence_parser'='original_refund_payment.v1'
 from sales_adjustment_facts where id='b1824500-0000-4000-8000-000000000091'),
 'Older in-flight parser cannot strip reviewed original payment evidence on unchanged identity');
update sales_adjustment_facts set raw_payload=jsonb_set(raw_payload,'{payment_method}','"cash"')-'source_evidence_reconciliation'
 where id='b1824500-0000-4000-8000-000000000091';
select ok((select not(raw_payload ? 'source_evidence_reconciliation') and raw_payload ? 'superseded_source_evidence_reconciliation'
 from sales_adjustment_facts where id='b1824500-0000-4000-8000-000000000091'),'Contradictory future tender supersedes prior active review');
select throws_ok($$select public.service_reconcile_sheet_refund_source_evidence((select proof from sheet_proof),'Synthetic stale credit proof')$$,
 '22023','Source evidence does not match retained financial identity','Old credit proof cannot overwrite changed cash evidence');
update sales_adjustment_facts set raw_payload=jsonb_set(raw_payload,'{payment_method}','"credit"')
 where id='b1824500-0000-4000-8000-000000000091';
select is((public.service_reconcile_sheet_refund_source_evidence((select proof from sheet_proof),'Synthetic fresh original source review')->>'changed')::integer,1,
 'Fresh compatible review restores active provenance after source correction');
update sales_adjustment_facts set raw_payload=raw_payload-array['payment_method','amountBasis','source_evidence','source_evidence_reconciliation'] where id='b1824500-0000-4000-8000-000000000091';
select ok((select not(raw_payload ? 'source_evidence_reconciliation') and raw_payload ? 'superseded_source_evidence_reconciliation'
 from sales_adjustment_facts where id='b1824500-0000-4000-8000-000000000091'),'Missing original tender cannot retain outdated active proof');
insert into private.nayax_machine_tax_observations(account_key,nayax_machine_id,observed_at,source,classification,rate_percent,provenance,effective_start_date)
 values('TGPACI_USA_DB','1824000094','2026-10-09','finance_verified','verified_tax',10,'Synthetic later applicable source correction','2026-10-09');
select is(private.resolve_unique_stable_machine_tax('b1824300-0000-4000-8000-000000000091','2026-09-15'),8::numeric,'Later dated other-period evidence does not override known original date');
select is(private.resolve_unique_stable_machine_tax('b1824300-0000-4000-8000-000000000091','2026-10-10'),null::numeric,'Later applicable conflicting observation is not masked by owner attestation');
select is(private.resolve_unique_stable_machine_tax('b1824300-0000-4000-8000-000000000091',null),null::numeric,'Missing purchase date requires agreement across every applicable period');
insert into private.nayax_machine_tax_observations(account_key,nayax_machine_id,observed_at,source,classification,rate_percent,provenance,effective_start_date)
 values('TGPACI_USA_DB','1824000096','2026-10-09','nayax_api','unclassified_extra_charge',null,'Synthetic fixed charge, not verified tax','2026-10-09');
select is(private.resolve_unique_stable_machine_tax('b1824300-0000-4000-8000-000000000094','2026-10-10'),null::numeric,'Later unclassified fixed charge cannot borrow older attested tax');
select is(private.resolve_unique_stable_machine_tax('b1824300-0000-4000-8000-000000000094','2026-09-15'),8::numeric,'Classification change outside proved purchase date does not rewrite history');
insert into private.nayax_machine_tax_observations(account_key,nayax_machine_id,observed_at,source,classification,rate_percent,provenance,effective_start_date)
 values('TGPACI_USA_DB','1824000096','2026-10-08T12:00Z','nayax_api','unavailable',null,'Synthetic transient provider read failure','2026-10-08');
select is(private.resolve_unique_stable_machine_tax('b1824300-0000-4000-8000-000000000094','2026-10-08'),8::numeric,
 'Transient unavailable read remains deprioritized under existing source policy');
select ok(not has_function_privilege('authenticated','public.service_reconcile_sheet_refund_source_evidence(jsonb,text)','EXECUTE')
 and not has_function_privilege('anon','public.service_reconcile_sheet_refund_source_evidence(jsonb,text)','EXECUTE'),'Browser cannot reconcile financial source evidence');
-- Current-only Machines must not bypass a failed unique stable proof.
set local session_replication_role=replica;
insert into reporting_machines(id,account_id,location_id,machine_label,nayax_machine_id,nayax_account_key) values
 ('b1824300-0000-4000-8000-000000000095','b1824100-0000-4000-8000-000000000091','b1824200-0000-4000-8000-000000000091','Current-only conflict','1824000097','TGPACI_USA_DB'),
 ('b1824300-0000-4000-8000-000000000096','b1824100-0000-4000-8000-000000000091','b1824200-0000-4000-8000-000000000091','Current-only unattested','1824000098','TGPACI_USA_DB');
insert into private.nayax_machine_tax_observations(account_key,nayax_machine_id,observed_at,source,classification,rate_percent,provenance,effective_start_date) values
 ('TGPACI_USA_DB','1824000097','2026-10-08','owner_stable_rate','verified_tax',8,'#1824; owner attestation: synthetic unchanged machine rates; verified observation IDs=synthetic','-infinity'),
 ('TGPACI_USA_DB','1824000097','2026-10-09','finance_verified','verified_tax',10,'Synthetic contradictory applicable Finance evidence','2026-09-01'),
 ('TGPACI_USA_DB','1824000098','2026-09-01','nayax_api','verified_tax',8,'Synthetic source rate without owner coverage','2026-09-01');
set local session_replication_role=origin;
select is((select tax_exclusive_amount_cents from private.normalize_refund_original_reader_amount_cents('b1824300-0000-4000-8000-000000000095','card','2026-09-15',1080,'tax_inclusive',null,null,true)),null::bigint,
 'Current-only conflicting stable proof cannot borrow the latest current-reader rate');
select is((select tax_exclusive_amount_cents from private.normalize_refund_original_reader_amount_cents('b1824300-0000-4000-8000-000000000096','card','2026-09-15',1080,'tax_inclusive',null,null,true)),1000::bigint,
 'Current-only dated source normalization without an owner attestation retains its prior behavior');
select * from finish();
rollback;
