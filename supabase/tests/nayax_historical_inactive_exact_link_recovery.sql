begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('00000000-0000-0000-0000-000000000000','e1000000-0000-4000-8000-000000000001',
  'authenticated','authenticated','historical-recovery@example.invalid','',now(),'{}','{}',now(),now());
insert into public.customer_accounts(id,name,account_type)
values('e1100000-0000-4000-8000-000000000001','Historical recovery fixture','internal');
insert into public.reporting_locations(id,account_id,name,timezone)
values('e1200000-0000-4000-8000-000000000001','e1100000-0000-4000-8000-000000000001',
  'Reviewed historical location','America/Los_Angeles');
insert into public.reporting_machines(id,account_id,location_id,machine_label,nayax_machine_id,nayax_account_key,status)
values('e1300000-0000-4000-8000-000000000001','e1100000-0000-4000-8000-000000000001',
  'e1200000-0000-4000-8000-000000000001','Reviewed inactive reporting machine',
  '800000001','TGPACI_USA_DB','inactive');
insert into public.refund_nayax_machine_inventory(account_key,nayax_machine_id,provider_is_active,refund_category,
  reporting_machine_id,reconciliation_state,setup_reason,exclusion_reason)
values('TGPACI_USA_DB','800000001',true,'snapcase','e1300000-0000-4000-8000-000000000001',
  'excluded','historical_fixture','Inactive reporting machine with reviewed history.');

create function pg_temp.recovery_row(
  p_transaction text,
  p_status integer,
  p_settlement integer,
  p_order_hash text,
  p_row_hash text,
  p_mapping text,
  p_refund_hash text default null,
  p_refund_kind text default null,
  p_refund_amount integer default null,
  p_original_transaction text default null,
  p_machine_time text default '2025-01-02T23:04:06'
) returns jsonb language sql as $$
  select jsonb_build_object(
    'sourceRowHash',p_row_hash,
    'sourceOrderHash',p_order_hash,
    'refundIdentityHash',p_refund_hash,
    'refundEvidenceKind',p_refund_kind,
    'historicalMappingDisposition',p_mapping,
    'financialDisposition','eligible',
    'machineNameHash',repeat('9',64),
    'actorId','2003563806',
    'providerMachineId','800000001',
    'siteId','4',
    'transactionId',p_transaction,
    'originalTransactionId',p_original_transaction,
    'currencyCode','USD',
    'authorizationAmountCents',case when p_settlement < 0 then p_settlement else p_settlement+100 end,
    'settlementAmountCents',p_settlement,
    'machineSettledAt',p_machine_time,
    'machineSaleDate',left(p_machine_time,10),
    'providerSettledAt',(p_machine_time::timestamp at time zone 'America/Los_Angeles'),
    'providerUpdatedAt',((p_machine_time::timestamp + interval '1 hour') at time zone 'America/Los_Angeles'),
    'providerStatus',p_status,
    'providerStatusName',case p_status when 62 then 'Refunded' when 12 then 'Settled' else '' end,
    'providerType',case when p_refund_kind='native_event' then 1 else 0 end,
    'refundAmountCents',p_refund_amount,
    'historyScopeDisposition','in_scope',
    'isTransactionRefunded',p_refund_kind='approved_original_annotation',
    'refundRequestedAt',null,
    'refundApprovedAt',case when p_refund_kind='approved_original_annotation'
      then (p_machine_time::timestamp + interval '1 day')::text else null end
  );
$$;

select set_config('request.jwt.claim.role','service_role',true);

select public.service_begin_nayax_dtm_history_import(jsonb_build_object(
  'fileDigest',repeat('a',64),
  'byteCount',1000,
  'rowCount',3,
  'authorizationCents',1400,
  'settlementCents',1200,
  'refundAnnotationCents',1500,
  'currencyCode','USD',
  'periodStart','2025-01-01T00:00:00Z',
  'periodEnd','2025-02-01T00:00:00Z',
  'partial',false,
  'origin','manual_dtm_export'
));

select public.service_ingest_nayax_dtm_history_rows(repeat('a',64),jsonb_build_array(
  pg_temp.recovery_row(
    '810000001',62,1000,repeat('1',64),repeat('2',64),'historical_inactive_exact_link',
    repeat('3',64),'approved_original_annotation',1000,null,'2025-01-02T23:04:06'
  ),
  pg_temp.recovery_row(
    '810000002',62,500,repeat('4',64),repeat('5',64),'canonical',
    repeat('6',64),'approved_original_annotation',500,null,'2025-01-03T23:04:06'
  ),
  pg_temp.recovery_row(
    '810000003',null,-300,null,repeat('7',64),'historical_inactive_exact_link',
    repeat('8',64),'native_event',null,'810000004','2025-01-04T23:04:06'
  )
));
select public.service_finalize_nayax_dtm_history_import(repeat('a',64));

select is((select count(*) from public.machine_sales_facts
  where source_order_hash in (repeat('1',64),repeat('4',64))),0::bigint,
  'Provider-active excluded inventory is held before reviewed recovery');
select is((select count(*) from public.nayax_provider_refund_events
  where refund_identity_hash in (repeat('3',64),repeat('6',64),repeat('8',64))
    and disposition='held_unmapped'),3::bigint,
  'Refund effects are held before reviewed recovery');

select is((public.service_promote_nayax_pending_sales(100)->>'promotedHistoricalInactiveRows')::integer,1,
  'Only the positive row with immutable reviewed classification is promoted');
select is((select count(*) from public.machine_sales_facts
  where source='nayax_scheduled_report' and source_order_hash=repeat('1',64)),1::bigint,
  'Reviewed historical gross sale enters the canonical Nayax fact source once');
select is((select net_sales_cents from public.machine_sales_facts
  where source='nayax_scheduled_report' and source_order_hash=repeat('1',64)),1000,
  'Reviewed historical gross uses settlement value');
select is((select sale_date from public.machine_sales_facts
  where source='nayax_scheduled_report' and source_order_hash=repeat('1',64)),date '2025-01-02',
  'Reviewed historical gross keeps the provider machine-local business date');
select is((select disposition from public.nayax_pending_sales
  where source_order_hash=repeat('4',64)),'excluded',
  'An ordinary excluded positive row without reviewed classification stays held');
select is((select count(*) from public.sales_adjustment_facts
  where source='nayax_provider_refund'
    and source_row_hash in (repeat('3',64),repeat('8',64))),2::bigint,
  'Reviewed annotation and native-event refunds each contribute once');
select is((select sum(amount_cents) from public.sales_adjustment_facts
  where source='nayax_provider_refund'
    and source_row_hash in (repeat('3',64),repeat('8',64))),1300::bigint,
  'Reviewed refund effects retain their exact amounts');
select is((select disposition from public.nayax_provider_refund_events
  where refund_identity_hash=repeat('6',64)),'held_unmapped',
  'An ordinary excluded refund without reviewed classification stays held');
select is((select count(*) from public.nayax_dtm_export_rows
  where file_digest=repeat('a',64) and fact_id is null and adjustment_id is null),3::bigint,
  'Recovery preserves immutable DTM row receipts and links through canonical identities');

select is((public.service_promote_nayax_pending_sales(100)->>'promotedHistoricalInactiveRows')::integer,0,
  'Repeated recovery does not promote the reviewed sale twice');
select is((select count(*) from public.machine_sales_facts
  where source='nayax_scheduled_report' and source_order_hash=repeat('1',64)),1::bigint,
  'Repeated recovery leaves one canonical sale fact');
select is((select count(*) from public.sales_adjustment_facts
  where source='nayax_provider_refund'
    and source_row_hash in (repeat('3',64),repeat('8',64))),2::bigint,
  'Repeated recovery leaves one financial effect per refund identity');

select set_config('request.jwt.claim.role','authenticated',true);
select throws_ok($$select public.service_promote_nayax_pending_sales(100)$$,
  'P0001','Service pending Nayax sales promotion required',
  'Customer sessions cannot run historical recovery');

select * from finish();
rollback;
