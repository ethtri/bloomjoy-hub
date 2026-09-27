begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('00000000-0000-0000-0000-000000000000','f1000000-0000-4000-8000-000000000001',
  'authenticated','authenticated','dtm-history@example.invalid','',now(),'{}','{}',now(),now());
insert into public.customer_accounts(id,name,account_type)
values('f1100000-0000-4000-8000-000000000001','DTM history fixture','internal');
insert into public.reporting_locations(id,account_id,name,timezone)
values('f1200000-0000-4000-8000-000000000001','f1100000-0000-4000-8000-000000000001',
  'Historical location','America/Los_Angeles');
insert into public.reporting_machines(id,account_id,location_id,machine_label,nayax_machine_id,nayax_account_key,status)
values('f1300000-0000-4000-8000-000000000001','f1100000-0000-4000-8000-000000000001',
  'f1200000-0000-4000-8000-000000000001','Inactive historical machine','900000001','TGPACI_USA_DB','inactive');
insert into public.refund_nayax_machine_inventory(account_key,nayax_machine_id,provider_is_active,refund_category,
  reporting_machine_id,reconciliation_state,setup_reason)
values('TGPACI_USA_DB','900000001',false,'snapcase','f1300000-0000-4000-8000-000000000001','excluded','test_fixture'),
  ('TGPACI_USA_DB','900000002',true,'snapcase',null,'needs_setup','test_fixture');

select set_config('request.jwt.claim.role','service_role',true);

insert into public.sales_adjustment_facts(reporting_machine_id,reporting_location_id,adjustment_date,adjustment_type,
  amount_cents,complaint_count,source,source_row_hash,source_reference,source_row_reference,
  match_status,match_confidence,raw_payload)
values('f1300000-0000-4000-8000-000000000001','f1200000-0000-4000-8000-000000000001',
  '2025-01-03','refund',1000,0,'google_sheets',repeat('8',64),'fixture','annotation-overlap',
  'applied',1,'{"payload_redacted":true}');

create function pg_temp.history_row(
  p_transaction text,p_machine text,p_status integer,p_settlement integer,
  p_order_hash text,p_row_hash text,p_mapping text default 'canonical'
) returns jsonb language sql as $$
  select jsonb_build_object(
    'sourceRowHash',p_row_hash,'sourceOrderHash',p_order_hash,'refundIdentityHash',null,
    'refundEvidenceKind',null,'historicalMappingDisposition',p_mapping,'financialDisposition','eligible',
    'machineNameHash',repeat('9',64),'actorId','2003563806','providerMachineId',p_machine,
    'siteId','4','transactionId',p_transaction,'originalTransactionId',null,'currencyCode','USD',
    'authorizationAmountCents',p_settlement+100,'settlementAmountCents',p_settlement,
    'machineSettledAt','2025-01-02T23:04:06','machineSaleDate','2025-01-02',
    'providerSettledAt','2025-01-03T07:04:06Z','providerUpdatedAt','2025-01-03T08:04:06Z',
    'providerStatus',p_status,'providerStatusName',case p_status when 62 then 'Refunded' else 'Settled' end,
    'providerType',0,'refundAmountCents',null,'historyScopeDisposition','in_scope','isTransactionRefunded',false,
    'refundRequestedAt',null,'refundApprovedAt',null
  );
$$;

select lives_ok($$select public.service_begin_nayax_dtm_history_import(jsonb_build_object(
  'fileDigest',repeat('1',64),'byteCount',1000,'rowCount',3,'authorizationCents',3300,
  'settlementCents',3000,'refundAnnotationCents',1000,'currencyCode','USD',
  'periodStart','2025-01-01T00:00:00Z','periodEnd','2026-01-01T00:00:00Z',
  'partial',false,'origin','manual_dtm_export'))$$,'Manual DTM receipt is recorded separately');

select lives_ok($$select public.service_ingest_nayax_dtm_history_rows(repeat('1',64),jsonb_build_array(
  pg_temp.history_row('910000001','900000001',62,1000,repeat('a',64),repeat('b',64),
    'historical_inactive_exact_link')||jsonb_build_object(
    'refundIdentityHash',repeat('0',64),'refundEvidenceKind','approved_original_annotation',
    'refundAmountCents',1000,'isTransactionRefunded',true,'refundApprovedAt','2025-01-03T12:00:00'),
  pg_temp.history_row('910000002','900000001',12,1000,repeat('c',64),repeat('d',64),'relocation_candidate'),
  pg_temp.history_row('910000003','900000002',12,1000,repeat('e',64),repeat('f',64))
))$$,'Mapped, relocation-held, and unmapped rows are ingested as one bounded batch');

select lives_ok($$select public.service_finalize_nayax_dtm_history_import(repeat('1',64))$$,
  'Receipt controls reconcile before completion');
select is((select count(*) from public.machine_sales_facts where source='nayax_scheduled_report'
  and source_order_hash=repeat('a',64)),1::bigint,'An inactive but exactly published historical machine retains its sale');
select is((select net_sales_cents from public.machine_sales_facts where source_order_hash=repeat('a',64)),1000,
  'Settlement value is revenue even when authorization differs and current status is refunded');
select is((select sale_date from public.machine_sales_facts where source_order_hash=repeat('a',64)),date '2025-01-02',
  'Machine-local workbook date is the business date');
select is((select count(*) from public.sales_adjustment_facts where source='nayax_provider_refund'
  and source_row_hash=repeat('0',64)),0::bigint,
  'A refunded positive original contributes gross sale while an exact sheet-overlap annotation stays held');
select is((select held_rows from public.nayax_dtm_export_completions where file_digest=repeat('1',64)),2,
  'Held totals include relocation rows and positive originals with held refund annotations');
select is((select count(*) from public.machine_sales_facts where source_order_hash=repeat('c',64)),0::bigint,
  'A relocation candidate does not publish against the current location');
select is((select count(*) from public.nayax_pending_sales where source_order_hash=repeat('e',64)),1::bigint,
  'An exact but unpublished machine uses the shared pending queue');
select is((select count(*) from public.nayax_scheduled_report_files where file_digest=repeat('1',64)),0::bigint,
  'Manual DTM provenance does not masquerade as an authenticated scheduled report');
select is((public.service_begin_nayax_dtm_history_import(jsonb_build_object(
  'fileDigest',repeat('1',64),'byteCount',1000,'rowCount',3,'authorizationCents',3300,
  'settlementCents',3000,'refundAnnotationCents',1000,'currencyCode','USD',
  'periodStart','2025-01-01T00:00:00Z','periodEnd','2026-01-01T00:00:00Z',
  'partial',false,'origin','manual_dtm_export'))->>'duplicate')::boolean,true,
  'Replaying the same DTM file is unchanged');
select is((public.service_begin_nayax_dtm_history_import(jsonb_build_object(
  'fileDigest',repeat('1',64),'byteCount',1000,'rowCount',3,'authorizationCents',3300,
  'settlementCents',3000,'refundAnnotationCents',1000,'currencyCode','USD',
  'periodStart','2025-01-01T00:00:00Z','periodEnd','2026-01-01T00:00:00Z',
  'partial',false,'origin','manual_dtm_export'))->>'completed')::boolean,true,
  'Completed receipts skip row replay');

select public.service_begin_nayax_dtm_history_import(jsonb_build_object(
  'fileDigest',repeat('2',64),'byteCount',800,'rowCount',2,'authorizationCents',2200,
  'settlementCents',2000,'refundAnnotationCents',0,'currencyCode','USD',
  'periodStart','2025-02-01T00:00:00Z','periodEnd','2025-03-01T00:00:00Z',
  'partial',false,'origin','manual_dtm_export'));
select public.service_ingest_nayax_dtm_history_rows(repeat('2',64),jsonb_build_array(
  pg_temp.history_row('910000011','900000001',12,1000,repeat('1',63)||'a',repeat('1',63)||'b')));
select is((public.service_begin_nayax_dtm_history_import(jsonb_build_object(
  'fileDigest',repeat('2',64),'byteCount',800,'rowCount',2,'authorizationCents',2200,
  'settlementCents',2000,'refundAnnotationCents',0,'currencyCode','USD',
  'periodStart','2025-02-01T00:00:00Z','periodEnd','2025-03-01T00:00:00Z',
  'partial',false,'origin','manual_dtm_export'))->>'completed')::boolean,false,
  'An interrupted receipt is resumable');
select public.service_ingest_nayax_dtm_history_rows(repeat('2',64),jsonb_build_array(
  pg_temp.history_row('910000011','900000001',12,1000,repeat('1',63)||'a',repeat('1',63)||'b'),
  pg_temp.history_row('910000012','900000001',12,1000,repeat('1',63)||'c',repeat('1',63)||'d')));
select lives_ok($$select public.service_finalize_nayax_dtm_history_import(repeat('2',64))$$,
  'Idempotent row replay finishes an interrupted file');
select is((select rows_recorded from public.nayax_dtm_export_completions where file_digest=repeat('2',64)),2,
  'Resumed file records every source row once');
select is((select count(*) from public.nayax_pending_sales where source_order_hash in (
  repeat('1',63)||'a',repeat('1',63)||'c')),2::bigint,
  'Ordinary excluded inactive rows stay in the shared hold queue');

update public.refund_nayax_machine_inventory set reconciliation_state='published'
where account_key='TGPACI_USA_DB' and nayax_machine_id='900000001';

-- Case-first order: the provider event links to the existing case adjustment.
insert into public.refund_cases(id,public_reference,reporting_machine_id,reporting_location_id,customer_email,
  issue_summary,incident_at,payment_method,payment_amount_cents,refund_amount_cents,status)
values('f1400000-0000-4000-8000-000000000001','RF-DTM-1','f1300000-0000-4000-8000-000000000001',
  'f1200000-0000-4000-8000-000000000001','case-first@example.invalid','Synthetic case-first refund',
  '2025-01-02T20:00:00Z','card',1000,1000,'completed');
insert into public.sales_adjustment_facts(reporting_machine_id,reporting_location_id,adjustment_date,adjustment_type,
  amount_cents,complaint_count,source,source_row_hash,source_reference,source_row_reference,refund_case_id,
  match_status,match_confidence,raw_payload)
values('f1300000-0000-4000-8000-000000000001','f1200000-0000-4000-8000-000000000001','2025-01-03',
  'refund',1000,1,'refund_case','f1400000-0000-4000-8000-000000000001','refund_cases','RF-DTM-1',
  'f1400000-0000-4000-8000-000000000001','applied',1,'{"payload_redacted":true}');
insert into public.refund_authoritative_receipts(refund_case_id,reporting_machine_id,account_scope,provider_machine_id,
  original_transaction_id,original_amount_cents,refunded_amount_cents,currency_code,provider_status,
  evidence_reference_digest,recorded_by,attempt_binding_kind,current_provider_observation_reviewed)
values('f1400000-0000-4000-8000-000000000001','f1300000-0000-4000-8000-000000000001','TGPACI_USA_DB',
  '900000001','920000001',1000,1000,'USD',62,repeat('1',64),'f1000000-0000-4000-8000-000000000001',
  'no_attempt_integrity_hold',true);
select lives_ok($$select private.record_nayax_provider_refund(repeat('2',64),'TGPACI_USA_DB','2003563806',
  '900000001','920000001','930000001',1000,'2025-01-03 12:00:00',
  '2025-01-03T20:00:00Z','native_event','manual_dtm_export',null,repeat('1',64),repeat('2',64),null)$$,
  'A case-first provider event reuses the case accounting adjustment');
select is((select count(*) from public.sales_adjustment_facts where refund_case_id='f1400000-0000-4000-8000-000000000001'
  or source_row_hash=repeat('2',64)),1::bigint,
  'Case-first arrival contributes one adjustment');

-- Event-first order: the later case projection reuses the provider adjustment id.
select lives_ok($$select private.record_nayax_provider_refund(repeat('3',64),'TGPACI_USA_DB','2003563806',
  '900000001','920000002','930000002',900,'2025-01-04 12:00:00',
  '2025-01-04T20:00:00Z','native_event','manual_dtm_export',null,repeat('1',64),repeat('3',64),null)$$,
  'An event-first provider refund creates one adjustment');
insert into public.nayax_dtm_export_rows(file_digest,source_row_hash,refund_identity_hash,provider_actor_id,
  provider_machine_id,provider_site_id,provider_transaction_id,original_transaction_id,
  authorization_amount_cents,settlement_amount_cents,machine_settled_at,provider_settled_at,
  provider_status,provider_type,machine_name_hash,mapping_disposition,financial_disposition,
  history_scope_disposition,disposition,adjustment_id)
select repeat('1',64),repeat('3',64),refund_identity_hash,'2003563806','900000001','4','930000002',
  '920000002',-900,-900,'2025-01-04 12:00:00','2025-01-04T20:00:00Z',null,1,repeat('9',64),
  'historical_inactive_exact_link','eligible','in_scope','refund_applied',adjustment_id
from public.nayax_provider_refund_events where refund_identity_hash=repeat('3',64);
insert into public.refund_cases(id,public_reference,reporting_machine_id,reporting_location_id,customer_email,
  issue_summary,incident_at,payment_method,payment_amount_cents,refund_amount_cents,status)
values('f1400000-0000-4000-8000-000000000002','RF-DTM-2','f1300000-0000-4000-8000-000000000001',
  'f1200000-0000-4000-8000-000000000001','event-first@example.invalid','Synthetic event-first refund',
  '2025-01-03T20:00:00Z','card',900,900,'completed');
insert into public.sales_adjustment_facts(reporting_machine_id,reporting_location_id,adjustment_date,adjustment_type,
  amount_cents,complaint_count,source,source_row_hash,source_reference,source_row_reference,refund_case_id,
  match_status,match_confidence,raw_payload)
values('f1300000-0000-4000-8000-000000000001','f1200000-0000-4000-8000-000000000001','2025-09-09',
  'refund',900,1,'refund_case','f1400000-0000-4000-8000-000000000002','refund_cases','RF-DTM-2',
  'f1400000-0000-4000-8000-000000000002','applied',1,'{"payload_redacted":true}');
insert into public.refund_authoritative_receipts(refund_case_id,reporting_machine_id,account_scope,provider_machine_id,
  original_transaction_id,original_amount_cents,refunded_amount_cents,currency_code,provider_status,
  evidence_reference_digest,recorded_by,attempt_binding_kind,current_provider_observation_reviewed)
values('f1400000-0000-4000-8000-000000000002','f1300000-0000-4000-8000-000000000001','TGPACI_USA_DB',
  '900000001','920000002',900,900,'USD',62,repeat('4',64),'f1000000-0000-4000-8000-000000000001',
  'no_attempt_integrity_hold',true);
select is((select count(*) from public.sales_adjustment_facts where amount_cents=900),1::bigint,
  'Event-first then case completion still contributes one adjustment');
select is((select adjustment_date from public.sales_adjustment_facts where amount_cents=900),date '2025-01-04',
  'Case projection preserves the actual provider event date');
select ok((select e.adjustment_id=a.id and e.linked_refund_case_id='f1400000-0000-4000-8000-000000000002'
    and a.source='refund_case' and a.refund_case_id='f1400000-0000-4000-8000-000000000002'
  from public.nayax_provider_refund_events e join public.sales_adjustment_facts a on a.id=e.adjustment_id
  where e.original_transaction_id='920000002'),'Both receipts remain linked to the single accounting fact');
select is((select amount_cents from public.sales_adjustment_facts where source='nayax_provider_refund'
  and source_row_hash=repeat('3',64)),0,'The retained provider receipt row no longer contributes money');
select is((select adjustment.amount_cents from public.nayax_dtm_export_rows dtm
  join public.sales_adjustment_facts adjustment on adjustment.id=dtm.adjustment_id
  where dtm.source_row_hash=repeat('3',64)),0,'Immutable DTM evidence still points to the retained zero receipt row');

-- Native and approved-annotation evidence converge in either arrival order.
select private.record_nayax_provider_refund(repeat('5',64),'TGPACI_USA_DB','2003563806','900000001',
  '920000003','930000003',800,'2025-01-05 12:00:00','2025-01-05T20:00:00Z','native_event',
  'manual_dtm_export',null,repeat('1',64),repeat('5',64),null);
select private.record_nayax_provider_refund(repeat('6',64),'TGPACI_USA_DB','2003563806','900000001',
  '920000003',null,800,'2025-01-05 12:00:02',null,'approved_original_annotation',
  'manual_dtm_export',null,repeat('1',64),repeat('6',64),null);
select is((select count(*) from public.nayax_provider_refund_events where original_transaction_id='920000003'),
  1::bigint,'Annotation after native evidence does not double deduct');
select private.record_nayax_provider_refund(repeat('7',64),'TGPACI_USA_DB','2003563806','900000001',
  '920000004',null,700,'2025-01-06 12:00:00',null,'approved_original_annotation',
  'manual_dtm_export',null,repeat('1',64),repeat('7',64),null);
select private.record_nayax_provider_refund(repeat('8',64),'TGPACI_USA_DB','2003563806','900000001',
  '920000004','930000004',700,'2025-01-06 12:00:03','2025-01-06T20:00:03Z','native_event',
  'manual_dtm_export',null,repeat('1',64),repeat('8',64),null);
select is((select count(*) from public.nayax_provider_refund_events where original_transaction_id='920000004'),
  1::bigint,'Native evidence upgrades an earlier annotation without a second adjustment');
select is((select count(*) from public.nayax_provider_refund_event_provenance
  where refund_identity_hash in (repeat('5',64),repeat('7',64))),4::bigint,
  'Both truthful DTM row receipts remain associated with the two canonical events');
select private.record_nayax_provider_refund(repeat('8',64),'TGPACI_USA_DB','2003563806','900000001',
  '920000004','930000004',700,'2025-01-06 12:00:03','2025-01-06T20:00:03Z','native_event',
  'manual_dtm_export',null,repeat('1',64),repeat('8',64),null);
select is((select count(*) from public.nayax_provider_refund_event_provenance
  where refund_identity_hash=repeat('7',64)),2::bigint,'Exact evidence replay leaves provenance unchanged');

-- Held refunds use the same mapping-promotion path as pending positive sales.
select private.record_nayax_provider_refund(repeat('a',64),'TGPACI_USA_DB','2003563806','900000002',
  '920000005','930000005',600,'2025-01-07 12:00:00','2025-01-07T20:00:00Z','native_event',
  'manual_dtm_export',null,repeat('1',64),repeat('a',64),null);
select is((select disposition from public.nayax_provider_refund_events where refund_identity_hash=repeat('a',64)),
  'held_unmapped','An unmapped provider refund is held without a deduction');
update public.refund_nayax_machine_inventory set reporting_machine_id='f1300000-0000-4000-8000-000000000001',
  reconciliation_state='published' where account_key='TGPACI_USA_DB' and nayax_machine_id='900000002';
select public.service_promote_nayax_pending_sales(100);
select is((select disposition from public.nayax_provider_refund_events where refund_identity_hash=repeat('a',64)),
  'applied','The existing periodic mapping recovery promotes a held refund once');
select is((select count(*) from public.sales_adjustment_facts where source='nayax_provider_refund'
  and source_row_hash=repeat('a',64)),1::bigint,'Repeated promotion has one financial effect');

insert into public.sales_adjustment_facts(reporting_machine_id,reporting_location_id,adjustment_date,adjustment_type,
  amount_cents,complaint_count,source,source_row_hash,source_reference,source_row_reference,
  match_status,match_confidence,raw_payload)
values('f1300000-0000-4000-8000-000000000001','f1200000-0000-4000-8000-000000000001',
  '2025-01-08','refund',500,0,'google_sheets',repeat('b',64),'fixture','sheet-row',
  'applied',1,'{"payload_redacted":true}');
select private.record_nayax_provider_refund(repeat('c',64),'TGPACI_USA_DB','2003563806','900000001',
  '920000006','930000006',500,'2025-01-08 12:00:00','2025-01-08T20:00:00Z','native_event',
  'manual_dtm_export',null,repeat('1',64),repeat('c',64),null);
select is((select disposition from public.nayax_provider_refund_events where refund_identity_hash=repeat('c',64)),
  'held_sheet_overlap','An exact machine/date/amount sheet overlap remains staged');
select is((select count(*) from public.sales_adjustment_facts where source='nayax_provider_refund'
  and source_row_hash=repeat('c',64)),0::bigint,'A sheet-overlap candidate is not deducted twice');

select set_config('request.jwt.claim.role','authenticated',true);
select ok(not has_function_privilege('service_role',
  'public.service_promote_nayax_pending_sales_pre_refund_v1(integer)','execute'),
  'Service callers cannot bypass canonical refund promotion');
select ok(not has_function_privilege('service_role',
  'public.service_record_nayax_scheduled_report_pre_provider_refund_v1(text,timestamptz,text,jsonb)','execute'),
  'Service callers cannot bypass canonical scheduled refund projection');
select throws_ok($$select public.service_begin_nayax_dtm_history_import('{}')$$,'P0001','Service DTM import required',
  'Customer sessions cannot import private history');
select * from finish();
rollback;
