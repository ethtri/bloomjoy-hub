begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(22);

select ok(has_function_privilege('service_role',
  'public.refund_manager_preparation_snapshot(uuid,bigint)','execute')
  and not has_function_privilege('authenticated',
    'public.refund_manager_preparation_snapshot(uuid,bigint)','execute')
  and not has_function_privilege('anon',
    'public.refund_manager_preparation_snapshot(uuid,bigint)','execute'),
  'Preparation proof is service-only');
select ok(has_function_privilege('service_role',
  'public.service_prepare_due_refund_cash_cases(integer)','execute')
  and not has_function_privilege('authenticated',
    'public.service_prepare_due_refund_cash_cases(integer)','execute'),
  'Only the scheduled server can continue cash research');

insert into public.customer_accounts(id,name,account_type)
values('e2900000-0000-4000-8000-000000000001','Preparation fixtures','internal');
insert into public.reporting_locations(id,account_id,name,timezone)
values('e2900000-0000-4000-8000-000000000002',
  'e2900000-0000-4000-8000-000000000001','Preparation location','America/Los_Angeles');
insert into public.reporting_machines(
  id,account_id,location_id,machine_label,status,sunze_machine_id
) values
('e2900000-0000-4000-8000-000000000003',
  'e2900000-0000-4000-8000-000000000001',
  'e2900000-0000-4000-8000-000000000002','Covered cash','active','PREP-COVERED'),
('e2900000-0000-4000-8000-000000000004',
  'e2900000-0000-4000-8000-000000000001',
  'e2900000-0000-4000-8000-000000000002','No source cash','active','PREP-UNAVAILABLE'),
('e2900000-0000-4000-8000-000000000005',
  'e2900000-0000-4000-8000-000000000001',
  'e2900000-0000-4000-8000-000000000002','Incomplete cash','active','PREP-INCOMPLETE');
insert into public.sales_import_runs(
  id,source,status,rows_seen,rows_imported,meta,completed_at
) values('e2900000-0000-4000-8000-000000000006',
  'sunze_browser','completed',3,3,
  '{"payment_time_semantics_status":"validated","payment_time_timezone":"America/Los_Angeles","timestamp_proof_scope":"account","machine_coverage_verified":true,"visible_machine_count_mismatch":false}'::jsonb,
  statement_timestamp()-interval '30 minutes');
insert into public.sunze_cash_source_watermarks(
  reporting_machine_id,coverage_started_at,covered_through,
  last_successful_import_at,freshness_expires_at,payment_time_basis,
  payment_time_timezone,timestamp_proof_scope,import_run_id
) values
('e2900000-0000-4000-8000-000000000003',
  statement_timestamp()-interval '14 hours',statement_timestamp()+interval '1 hour',
  statement_timestamp()-interval '30 minutes',statement_timestamp()+interval '1 day',
  'validated_iana_timezone','America/Los_Angeles','account',
  'e2900000-0000-4000-8000-000000000006'),
('e2900000-0000-4000-8000-000000000005',
  statement_timestamp()-interval '14 hours',statement_timestamp()-interval '8 hours',
  statement_timestamp()-interval '30 minutes',statement_timestamp()+interval '1 day',
  'validated_iana_timezone','America/Los_Angeles','account',
  'e2900000-0000-4000-8000-000000000006');
insert into public.machine_sales_facts(
  id,reporting_machine_id,reporting_location_id,sale_date,payment_method,
  net_sales_cents,transaction_count,source,source_row_hash,source_order_hash,
  import_run_id,payment_time,source_payment_status,raw_payload
) values
('e2900000-0000-4000-8000-000000000021',
  'e2900000-0000-4000-8000-000000000003','e2900000-0000-4000-8000-000000000002',
  (statement_timestamp()-interval '5 hours')::date,'cash',800,1,'sunze_browser',
  'prep-sale-1','prep-order-1','e2900000-0000-4000-8000-000000000006',
  statement_timestamp()-interval '5 hours','Payment success','{}'::jsonb),
('e2900000-0000-4000-8000-000000000022',
  'e2900000-0000-4000-8000-000000000003','e2900000-0000-4000-8000-000000000002',
  (statement_timestamp()-interval '2 hours')::date,'cash',700,1,'sunze_browser',
  'prep-sale-2','prep-order-2','e2900000-0000-4000-8000-000000000006',
  statement_timestamp()-interval '2 hours','Payment success','{}'::jsonb),
('e2900000-0000-4000-8000-000000000023',
  'e2900000-0000-4000-8000-000000000003','e2900000-0000-4000-8000-000000000002',
  (statement_timestamp()-interval '2 hours')::date,'cash',750,1,'sunze_browser',
  'prep-sale-3','prep-order-3','e2900000-0000-4000-8000-000000000006',
  statement_timestamp()-interval '2 hours'+interval '5 minutes',
  'Payment success','{}'::jsonb);
insert into public.refund_cases(
  id,public_reference,reporting_machine_id,reporting_location_id,
  customer_email,issue_summary,incident_at,incident_timezone,
  payment_method,payment_amount_cents,refund_amount_cents,
  zelle_payment_contact,status,correlation_status
) values
('e2900000-0000-4000-8000-000000000011','RF-PREP-UNAVAILABLE',
  'e2900000-0000-4000-8000-000000000004','e2900000-0000-4000-8000-000000000002',
  'unavailable@example.invalid','Research unavailable coverage',
  statement_timestamp()-interval '11 hours','America/Los_Angeles',
  'cash',900,900,'unavailable@example.invalid','needs_review','manual_review'),
('e2900000-0000-4000-8000-000000000012','RF-PREP-UNMATCHED',
  'e2900000-0000-4000-8000-000000000003','e2900000-0000-4000-8000-000000000002',
  'unmatched@example.invalid','Research covered no sale',
  statement_timestamp()-interval '8 hours','America/Los_Angeles',
  'cash',900,900,'unmatched@example.invalid','needs_review','manual_review'),
('e2900000-0000-4000-8000-000000000013','RF-PREP-SINGLE',
  'e2900000-0000-4000-8000-000000000003','e2900000-0000-4000-8000-000000000002',
  'single@example.invalid','Research one sale',
  statement_timestamp()-interval '5 hours','America/Los_Angeles',
  'cash',800,800,'single@example.invalid','needs_review','manual_review'),
('e2900000-0000-4000-8000-000000000014','RF-PREP-MULTI',
  'e2900000-0000-4000-8000-000000000003','e2900000-0000-4000-8000-000000000002',
  'multi@example.invalid','Research several sales',
  statement_timestamp()-interval '2 hours','America/Los_Angeles',
  'cash',700,700,'multi@example.invalid','needs_review','manual_review'),
('e2900000-0000-4000-8000-000000000015','RF-PREP-CHECKING',
  'e2900000-0000-4000-8000-000000000005','e2900000-0000-4000-8000-000000000002',
  'checking@example.invalid','Wait for complete coverage',
  statement_timestamp()-interval '7 hours','America/Los_Angeles',
  'cash',700,700,'checking@example.invalid','needs_review','manual_review');

select is(public.refund_manager_preparation_snapshot(
  'e2900000-0000-4000-8000-000000000011',
  (select official_action_version from public.refund_cases
    where id='e2900000-0000-4000-8000-000000000011')),
  null::jsonb,'Destination and amount alone do not prove preparation');
select is((public.service_prepare_due_refund_cash_cases(2)->>'evaluated')::integer,2,
  'Oldest two due cash cases are actually researched first');
select is((select count(*)::integer from public.refund_sunze_cash_correlation_attempts
  where refund_case_id in ('e2900000-0000-4000-8000-000000000011',
    'e2900000-0000-4000-8000-000000000012')),2,
  'First bounded batch persisted two distinct completion attempts');
select is((public.service_prepare_due_refund_cash_cases(2)->>'evaluated')::integer,2,
  'Next bounded batch progresses past prior attempts without starvation');
select is((public.service_prepare_due_refund_cash_cases(2)->>'evaluated')::integer,1,
  'Final due case is researched in the next sweep');
select is((public.service_prepare_due_refund_cash_cases(2)->>'evaluated')::integer,0,
  'Repeated sweeps do not manufacture new preparation progress');
select is((public.refund_manager_preparation_snapshot(
  'e2900000-0000-4000-8000-000000000011',
  (select official_action_version from public.refund_cases
    where id='e2900000-0000-4000-8000-000000000011'))->>'evidenceBasis'),
  'cash_coverage_unavailable_researched','No-source result is a completed reviewed gap');
select is((public.refund_manager_preparation_snapshot(
  'e2900000-0000-4000-8000-000000000012',
  (select official_action_version from public.refund_cases
    where id='e2900000-0000-4000-8000-000000000012'))->>'evidenceBasis'),
  'cash_researched_unmatched','Complete coverage with no sale is a reviewed outcome');
select is((public.refund_manager_preparation_snapshot(
  'e2900000-0000-4000-8000-000000000013',
  (select official_action_version from public.refund_cases
    where id='e2900000-0000-4000-8000-000000000013'))->>'evidenceBasis'),
  'cash_sale_found','One sale is prepared from completed evidence');
select is((public.refund_manager_preparation_snapshot(
  'e2900000-0000-4000-8000-000000000014',
  (select official_action_version from public.refund_cases
    where id='e2900000-0000-4000-8000-000000000014'))->>'evidenceBasis'),
  'cash_multiple_reviewed','Several sales are prepared as advisory evidence');
select is(public.refund_manager_preparation_snapshot(
  'e2900000-0000-4000-8000-000000000015',
  (select official_action_version from public.refund_cases
    where id='e2900000-0000-4000-8000-000000000015')),
  null::jsonb,'Incomplete fresh coverage remains System work');
select ok((select snapshot->>'proofId' = attempt.id::text
    and (snapshot->>'deterministicFactVersion')::bigint = attempt.case_fact_version
    and (snapshot->>'officialActionVersion')::bigint = c.official_action_version
    and length(snapshot->>'summary') <= 160
    and snapshot->>'payloadRedacted' = 'true'
    from public.refund_cases c
    join public.refund_sunze_cash_correlation_attempts attempt
      on attempt.refund_case_id=c.id
    cross join lateral public.refund_manager_preparation_snapshot(
      c.id,c.official_action_version) snapshot
    where c.id='e2900000-0000-4000-8000-000000000011'),
  'Proof identity, fact/action versions and bounded safe summary share the completed attempt');
select is(public.refund_manager_preparation_snapshot(
  'e2900000-0000-4000-8000-000000000011',0),null::jsonb,
  'Stale official action version cannot read a current proof');

insert into public.sales_import_runs(
  id,source,status,rows_seen,rows_imported,meta,completed_at
) values('e2900000-0000-4000-8000-000000000007',
  'sunze_browser','completed',0,0,
  '{"payment_time_semantics_status":"validated","payment_time_timezone":"America/Los_Angeles","timestamp_proof_scope":"account","machine_coverage_verified":true,"visible_machine_count_mismatch":false}'::jsonb,
  statement_timestamp());
insert into public.sunze_cash_source_watermarks(
  reporting_machine_id,coverage_started_at,covered_through,
  last_successful_import_at,freshness_expires_at,payment_time_basis,
  payment_time_timezone,timestamp_proof_scope,import_run_id
) values('e2900000-0000-4000-8000-000000000003',
  statement_timestamp()-interval '14 hours',statement_timestamp()+interval '1 hour',
  statement_timestamp(),statement_timestamp()+interval '1 day',
  'validated_iana_timezone','America/Los_Angeles','account',
  'e2900000-0000-4000-8000-000000000007');
select is(public.refund_manager_preparation_snapshot(
  'e2900000-0000-4000-8000-000000000012',
  (select official_action_version from public.refund_cases
    where id='e2900000-0000-4000-8000-000000000012')),
  null::jsonb,'New source snapshot invalidates previous preparation');
select is((public.service_prepare_due_refund_cash_cases(10)->>'evaluated')::integer,3,
  'Next sweep reprocesses all affected cases on the changed source');
select is((public.service_prepare_due_refund_cash_cases(10)->>'evaluated')::integer,0,
  'New source snapshot is still processed once per fact version');
select ok((select count(*)=2 from public.refund_sunze_cash_correlation_attempts
  where refund_case_id='e2900000-0000-4000-8000-000000000012'),
  'Source refresh preserves immutable earlier proof and adds a new attempt');
select ok((select (public.refund_manager_preparation_snapshot(
    c.id,c.official_action_version)->>'proofId')::uuid = attempt.id
    from public.refund_cases c
    join public.refund_sunze_cash_correlation_attempts attempt
      on attempt.refund_case_id=c.id
    where c.id='e2900000-0000-4000-8000-000000000012'
      and attempt.source_snapshot_key = public.refund_current_sunze_cash_source_key(
        c.reporting_machine_id,c.incident_at,statement_timestamp())),
  'Source refresh binds readiness to the new completed attempt, not stale proof');

update public.refund_cases set decision='approved'
where id='e2900000-0000-4000-8000-000000000013';
select is(public.refund_manager_preparation_snapshot(
  'e2900000-0000-4000-8000-000000000013',
  (select official_action_version from public.refund_cases
    where id='e2900000-0000-4000-8000-000000000013')),
  null::jsonb,'Already approved case does not request a fresh decision proof');
select is((public.service_prepare_due_refund_cash_cases(10)->>'evaluated')::integer,0,
  'Already approved case is not requeued for preparation');

select * from finish();
rollback;
