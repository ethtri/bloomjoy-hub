begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select no_plan();

insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data)
values ('52960000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
  'cash-positive-manager@example.test', '{}'::jsonb, '{}'::jsonb);

insert into public.customer_accounts (id, name, account_type, status)
values ('52900000-0000-4000-8000-000000000001', 'Cash positive fixtures', 'internal', 'active');

insert into public.reporting_locations (id, account_id, name, timezone, status)
values
  ('52910000-0000-4000-8000-000000000001', '52900000-0000-4000-8000-000000000001',
    'Cash positive location', 'America/Los_Angeles', 'active'),
  ('52910000-0000-4000-8000-000000000002', '52900000-0000-4000-8000-000000000001',
    'Cash unavailable location', 'America/Los_Angeles', 'active');

insert into public.reporting_machines (
  id, account_id, location_id, machine_label, machine_type, sunze_machine_id,
  status, refund_intake_enabled
)
values
  ('52920000-0000-4000-8000-000000000001', '52900000-0000-4000-8000-000000000001',
    '52910000-0000-4000-8000-000000000001', 'Positive fixture', 'commercial',
    'SUNZE-POSITIVE-1', 'active', true),
  ('52920000-0000-4000-8000-000000000002', '52900000-0000-4000-8000-000000000001',
    '52910000-0000-4000-8000-000000000002', 'Unavailable fixture', 'commercial',
    'SUNZE-POSITIVE-2', 'active', true);

insert into public.reporting_machine_refund_managers (
  reporting_machine_id, manager_user_id, manager_email, status, grant_reason
)
values
  ('52920000-0000-4000-8000-000000000001', '52960000-0000-4000-8000-000000000001',
    'cash-positive-manager@example.test', 'active', 'Cash positive fixture'),
  ('52920000-0000-4000-8000-000000000002', '52960000-0000-4000-8000-000000000001',
    'cash-positive-manager@example.test', 'active', 'Cash unavailable fixture');

insert into public.sales_import_runs (
  id, source, status, rows_seen, rows_imported, meta, completed_at
)
values
  (
    '52930000-0000-4000-8000-000000000001', 'sunze_browser', 'completed', 1, 1,
    '{"github_run_id":"cash-positive-run-1","payment_time_semantics_status":"unvalidated","timestamp_proof_scope":"unvalidated","machine_coverage_verified":true,"visible_machine_count_mismatch":false}'::jsonb,
    '2099-09-29 20:00:00+00'
  ),
  (
    '52930000-0000-4000-8000-000000000003', 'sunze_browser', 'completed', 1, 1,
    '{"github_run_id":"cash-positive-run-1","payment_time_semantics_status":"unvalidated","timestamp_proof_scope":"unvalidated","machine_coverage_verified":true,"visible_machine_count_mismatch":false}'::jsonb,
    '2099-09-29 20:01:00+00'
  );

insert into public.machine_sales_facts (
  id, reporting_machine_id, reporting_location_id, sale_date, payment_method,
  net_sales_cents, transaction_count, source, source_row_hash, source_order_hash,
  import_run_id, payment_time, source_payment_status, raw_payload
)
values
  ('52940000-0000-4000-8000-000000000001', '52920000-0000-4000-8000-000000000001',
    '52910000-0000-4000-8000-000000000001', '2026-09-29', 'cash', 975, 1,
    'sunze_browser', 'cash-positive-row-1', 'cash-positive-order-1',
    '52930000-0000-4000-8000-000000000001', '2026-09-29 10:05:00+00',
    'Payment success', '{"payment_time_iso":"2026-09-29T10:05:00.000Z"}'::jsonb),
  ('52940000-0000-4000-8000-000000000002', '52920000-0000-4000-8000-000000000001',
    '52910000-0000-4000-8000-000000000001', '2026-09-28', 'cash', 1250, 1,
    'sunze_browser', 'cash-positive-row-2', 'cash-positive-order-2',
    '52930000-0000-4000-8000-000000000003', '2026-09-29 11:15:00+00',
    'Payment success', '{"payment_time_iso":"2026-09-29T11:15:00.000Z"}'::jsonb);

insert into public.refund_cases (
  id, public_reference, reporting_machine_id, reporting_location_id, customer_email,
  issue_summary, incident_at, incident_local_datetime,
  incident_timezone, incident_time_resolution, payment_method, payment_amount_cents,
  status, correlation_status
)
values
  ('52950000-0000-4000-8000-000000000001', 'RF-CASH-POS-1',
    '52920000-0000-4000-8000-000000000001', '52910000-0000-4000-8000-000000000001',
    'positive@example.test', 'Positive evidence fixture',
    '2026-09-29 18:00:00+00', '2026-09-29 11:00:00', 'America/Los_Angeles', 'exact',
    'cash', 1000, 'needs_review', 'manual_review'),
  ('52950000-0000-4000-8000-000000000002', 'RF-CASH-POS-2',
    '52920000-0000-4000-8000-000000000002', '52910000-0000-4000-8000-000000000002',
    'unavailable@example.test', 'Unavailable evidence fixture',
    '2026-09-29 18:00:00+00', '2026-09-29 11:00:00', 'America/Los_Angeles', 'exact',
    'cash', 1000, 'needs_review', 'manual_review');

-- A newer daily export covers a different period. It cannot withdraw already
-- published historical positives or turn a partial search into no-sale proof.
update public.sales_import_runs set meta=meta||
  '{"window_start":"2026-09-01","window_end":"2026-09-30"}'::jsonb
where id in ('52930000-0000-4000-8000-000000000001',
  '52930000-0000-4000-8000-000000000003');
insert into public.sales_import_runs(id,source,status,rows_seen,rows_imported,meta,completed_at)
values('52930000-0000-4000-8000-000000000004','sunze_browser','completed',0,0,
  '{"github_run_id":"cash-unrelated-week","window_start":"2026-10-01","window_end":"2026-10-07","machine_coverage_verified":true,"visible_machine_count_mismatch":false}'::jsonb,
  '2099-10-07 20:00:00+00');

-- Model the existing historical empty research hold. It is lifted only
-- after the exact new cash evidence has an explicit current reviewed link.
update public.refund_cases set correlation_status='no_match',correlation_source='sunze',
 correlation_summary='Historical no safe match.',cash_match_evaluated_fact_version=1
where id='52950000-0000-4000-8000-000000000001';
insert into public.refund_follow_up_cycles(
 id,refund_case_id,cycle_number,trigger_fingerprint,reason_code,requested_fields,
 template_version,case_fact_version,reminder_delay_hours,status)
select '52970000-0000-4000-8000-000000000001',c.id,1,repeat('e',64),
 'no_safe_match','{}'::text[],settings.template_version,c.deterministic_fact_version,
 settings.reminder_delay_hours,'claimed'
from public.refund_cases c cross join public.refund_customer_contact_settings settings
where c.id='52950000-0000-4000-8000-000000000001';
update public.refund_follow_up_cycles set status='manual_review',
 failed_at=statement_timestamp(),failure_code='request_claim_abandoned'
where id='52970000-0000-4000-8000-000000000001';

select is(
  public.service_correlate_sunze_cash_case(
    '52950000-0000-4000-8000-000000000001', 1, 'backfill', null, '2026-09-29 21:00:00+00'
  )->>'state',
  'multiple_possible_sales',
  'Positive exact-machine cash facts remain reviewable without a validated watermark'
);
select is((
  select reason_code from public.refund_sunze_cash_correlation_attempts
  where refund_case_id = '52950000-0000-4000-8000-000000000001'
), 'positive_sales_found_without_validated_coverage',
  'Positive review evidence explicitly preserves the missing-coverage reason');
select is((
  select candidate_count from public.refund_sunze_cash_correlation_attempts
  where refund_case_id = '52950000-0000-4000-8000-000000000001'
), 1, 'One amount-mismatched positive row remains reviewable rather than auto-selected');
select ok((
  select source_snapshot_key like 'positive:cash-positive-run-1:%'
    and source_import_run_id = '52930000-0000-4000-8000-000000000003'::uuid
  from public.refund_sunze_cash_correlation_attempts
  where refund_case_id = '52950000-0000-4000-8000-000000000001'
), 'The attempt binds the completed import group and deterministic candidate digest');
select ok((
  select attempt.source_import_run_id = '52930000-0000-4000-8000-000000000003'::uuid
    and fact.import_run_id = '52930000-0000-4000-8000-000000000001'::uuid
  from public.refund_sunze_cash_correlation_attempts attempt
  join public.refund_sunze_cash_correlation_candidates candidate on candidate.attempt_id = attempt.id
  join public.machine_sales_facts fact on fact.id = candidate.sales_fact_id
  where attempt.refund_case_id = '52950000-0000-4000-8000-000000000001'
), 'A candidate may come from an earlier chunk in the same completed GitHub run group');
select ok((
  select bool_and(time_delta_seconds is null)
    and bool_and(evidence_codes @> array['same_venue_date','coverage_unvalidated','source_time_unvalidated'])
  from public.refund_sunze_cash_correlation_candidates candidate
  join public.refund_sunze_cash_correlation_attempts attempt on attempt.id = candidate.attempt_id
  where attempt.refund_case_id = '52950000-0000-4000-8000-000000000001'
), 'Review-only candidates do not invent a validated minute delta');
select is((
  select matched_sales_fact_id from public.refund_cases
  where id = '52950000-0000-4000-8000-000000000001'
), null::uuid, 'Positive unvalidated evidence is never selected automatically');
select is(
  public.service_get_sunze_cash_correlation(
    '52950000-0000-4000-8000-000000000001',
    '52960000-0000-4000-8000-000000000001', 100
  )->>'sourceReadiness',
  'unavailable',
  'The manager read never presents review-only rows as complete coverage'
);
select is(
  public.service_correlate_sunze_cash_case(
    '52950000-0000-4000-8000-000000000002', 1, 'backfill', null, '2026-09-29 21:00:00+00'
  )->>'state',
  'sales_history_unavailable',
  'No positive row remains unavailable rather than becoming no-sale evidence'
);
select is((
  select candidate_count from public.refund_sunze_cash_correlation_attempts
  where refund_case_id = '52950000-0000-4000-8000-000000000002'
), 0, 'Missing positive evidence creates no candidate');


select is(public.refund_current_sunze_cash_source_key('52920000-0000-4000-8000-000000000001','2026-09-29T18:00:00Z'),(select source_snapshot_key from public.refund_sunze_cash_correlation_attempts where refund_case_id='52950000-0000-4000-8000-000000000001'),
 'Current helper reproduces the positive research snapshot without a coverage watermark');
select is(jsonb_array_length(public.service_get_sunze_cash_correlation('52950000-0000-4000-8000-000000000001','52960000-0000-4000-8000-000000000001',100)->'candidates'),1,'Current positive candidate remains visible for review');
select is(public.refund_decision_recommendation_for_case('52950000-0000-4000-8000-000000000001')->'purchase',null::jsonb,'Unreviewed positive evidence cannot prepare a purchase');
select ok(not public.refund_payout_destination_case_current((select c from public.refund_cases c where id='52950000-0000-4000-8000-000000000001')),'Unreviewed positive evidence cannot authorize a payout request');
select is(public.refund_current_sunze_cash_source_key('52920000-0000-4000-8000-000000000002','2026-09-29T18:00:00Z'),
 'unavailable:none','No grounded positive and no watermark remain unavailable');

select is(
  public.service_select_sunze_cash_candidate(
    '52950000-0000-4000-8000-000000000001',
    (select id from public.refund_sunze_cash_correlation_attempts
      where refund_case_id = '52950000-0000-4000-8000-000000000001'),
    '52940000-0000-4000-8000-000000000001', 1, 0,
    '52960000-0000-4000-8000-000000000001'
  )->>'selected',
  'true',
  'An authorized reviewer may bind a current positive candidate'
);
select is((
  select link_origin from public.refund_sunze_cash_sale_links
  where refund_case_id = '52950000-0000-4000-8000-000000000001' and released_at is null
), 'reviewed', 'A positive candidate is bound only as reviewed evidence');
select ok((
  select decision is null and refund_completed_at is null and reporting_adjustment_id is null
  from public.refund_cases where id = '52950000-0000-4000-8000-000000000001'
), 'Evidence selection does not decide, complete, or account for a refund');


create temporary table positive_current_proof as select public.refund_current_sunze_cash_source_key('52920000-0000-4000-8000-000000000001','2026-09-29T18:00:00Z') source_key;
select like((select source_key from positive_current_proof),'positive:cash-positive-run-1:%',
 'Newer unrelated import does not hide the relevant historical source group');
select is(public.refund_manager_preparation_snapshot('52950000-0000-4000-8000-000000000001',(select official_action_version from public.refund_cases where id='52950000-0000-4000-8000-000000000001'))->>'evidenceBasis','cash_multiple_reviewed','Reviewed positive purchase supplies current preparation proof');
select is(public.refund_decision_recommendation_for_case('52950000-0000-4000-8000-000000000001')#>>'{purchase,source}','sunze','Reviewed positive purchase uses the existing Sunze recommendation');
select is(public.refund_decision_recommendation_for_case('52950000-0000-4000-8000-000000000001')#>>'{purchase,amountCents}','975','Reviewed source amount remains authoritative despite customer estimate');
select ok(public.refund_payout_destination_case_current((select c from public.refund_cases c where id='52950000-0000-4000-8000-000000000001')),'Reviewed current positive purchase permits only the existing missing payout field');
select is(public.refund_decision_recommendation_for_case('52950000-0000-4000-8000-000000000001')#>>'{purchase,timeMeaning}','unknown','Reviewed unvalidated source time never becomes a proven purchase instant');
select is(public.service_get_sunze_cash_correlation('52950000-0000-4000-8000-000000000001','52960000-0000-4000-8000-000000000001',100)#>>'{selectedSale,sourceTimeUnvalidated}','true','Explicit review preserves the source-time limitation');

update public.machine_sales_facts set source_row_hash='changed-positive-row' where id='52940000-0000-4000-8000-000000000001';
select isnt(public.refund_current_sunze_cash_source_key('52920000-0000-4000-8000-000000000001','2026-09-29T18:00:00Z'),(select source_key from positive_current_proof),'Snapshot changes for source row mutation');
select is(public.refund_manager_preparation_snapshot('52950000-0000-4000-8000-000000000001',(select official_action_version from public.refund_cases where id='52950000-0000-4000-8000-000000000001')),null::jsonb,'Stale source row mutation cannot retain preparation');
select is(public.refund_decision_recommendation_for_case('52950000-0000-4000-8000-000000000001')->'purchase',null::jsonb,'Stale source row mutation cannot retain a prepared purchase');
select ok(not public.refund_payout_destination_case_current((select c from public.refund_cases c where id='52950000-0000-4000-8000-000000000001')),'Stale source row mutation cannot authorize a payout request');
select is(public.service_get_sunze_cash_correlation('52950000-0000-4000-8000-000000000001','52960000-0000-4000-8000-000000000001',100)->'selectedSale','null'::jsonb,'Getter hides obsolete proof after source row mutation');
select throws_ok($call$select public.service_select_sunze_cash_candidate(
 '52950000-0000-4000-8000-000000000001',
 (select id from public.refund_sunze_cash_correlation_attempts where refund_case_id='52950000-0000-4000-8000-000000000001'),
 '52940000-0000-4000-8000-000000000001',1,1,
 '52960000-0000-4000-8000-000000000001')$call$,
 '40001','Stale Sunze candidate selection','Changed source identity rejects even a repeated selection');
update public.machine_sales_facts set source_row_hash='cash-positive-row-1' where id='52940000-0000-4000-8000-000000000001';
select is(public.refund_current_sunze_cash_source_key('52920000-0000-4000-8000-000000000001','2026-09-29T18:00:00Z'),(select source_key from positive_current_proof),'Restored source row mutation restores exact snapshot identity');

update public.sales_import_runs set status='failed' where id in ('52930000-0000-4000-8000-000000000001','52930000-0000-4000-8000-000000000003');
select isnt(public.refund_current_sunze_cash_source_key('52920000-0000-4000-8000-000000000001','2026-09-29T18:00:00Z'),(select source_key from positive_current_proof),'Snapshot changes for withdrawn import');
select is(public.refund_manager_preparation_snapshot('52950000-0000-4000-8000-000000000001',(select official_action_version from public.refund_cases where id='52950000-0000-4000-8000-000000000001')),null::jsonb,'Stale withdrawn import cannot retain preparation');
select is(public.refund_decision_recommendation_for_case('52950000-0000-4000-8000-000000000001')->'purchase',null::jsonb,'Stale withdrawn import cannot retain a prepared purchase');
select ok(not public.refund_payout_destination_case_current((select c from public.refund_cases c where id='52950000-0000-4000-8000-000000000001')),'Stale withdrawn import cannot authorize a payout request');
select is(public.service_get_sunze_cash_correlation('52950000-0000-4000-8000-000000000001','52960000-0000-4000-8000-000000000001',100)->'selectedSale','null'::jsonb,'Getter hides obsolete proof after withdrawn import');
update public.sales_import_runs set status='completed' where id in ('52930000-0000-4000-8000-000000000001','52930000-0000-4000-8000-000000000003');
select is(public.refund_current_sunze_cash_source_key('52920000-0000-4000-8000-000000000001','2026-09-29T18:00:00Z'),(select source_key from positive_current_proof),'Restored withdrawn import restores exact snapshot identity');

update public.sales_import_runs set meta=meta||'{"payment_time_timezone":"America/New_York"}'::jsonb where id='52930000-0000-4000-8000-000000000001';
select isnt(public.refund_current_sunze_cash_source_key('52920000-0000-4000-8000-000000000001','2026-09-29T18:00:00Z'),(select source_key from positive_current_proof),'Snapshot changes for changed import clock proof');
select is(public.refund_manager_preparation_snapshot('52950000-0000-4000-8000-000000000001',(select official_action_version from public.refund_cases where id='52950000-0000-4000-8000-000000000001')),null::jsonb,'Stale changed import clock proof cannot retain preparation');
select is(public.refund_decision_recommendation_for_case('52950000-0000-4000-8000-000000000001')->'purchase',null::jsonb,'Stale changed import clock proof cannot retain a prepared purchase');
select ok(not public.refund_payout_destination_case_current((select c from public.refund_cases c where id='52950000-0000-4000-8000-000000000001')),'Stale changed import clock proof cannot authorize a payout request');
select is(public.service_get_sunze_cash_correlation('52950000-0000-4000-8000-000000000001','52960000-0000-4000-8000-000000000001',100)->'selectedSale','null'::jsonb,'Getter hides obsolete proof after changed import clock proof');
update public.sales_import_runs set meta=meta-'payment_time_timezone' where id='52930000-0000-4000-8000-000000000001';
select is(public.refund_current_sunze_cash_source_key('52920000-0000-4000-8000-000000000001','2026-09-29T18:00:00Z'),(select source_key from positive_current_proof),'Restored changed import clock proof restores exact snapshot identity');

update public.reporting_locations set timezone='America/Denver' where id='52910000-0000-4000-8000-000000000001';
select isnt(public.refund_current_sunze_cash_source_key('52920000-0000-4000-8000-000000000001','2026-09-29T18:00:00Z'),(select source_key from positive_current_proof),'Snapshot changes for changed venue clock');
select is(public.refund_manager_preparation_snapshot('52950000-0000-4000-8000-000000000001',(select official_action_version from public.refund_cases where id='52950000-0000-4000-8000-000000000001')),null::jsonb,'Stale changed venue clock cannot retain preparation');
select is(public.refund_decision_recommendation_for_case('52950000-0000-4000-8000-000000000001')->'purchase',null::jsonb,'Stale changed venue clock cannot retain a prepared purchase');
select ok(not public.refund_payout_destination_case_current((select c from public.refund_cases c where id='52950000-0000-4000-8000-000000000001')),'Stale changed venue clock cannot authorize a payout request');
select is(public.service_get_sunze_cash_correlation('52950000-0000-4000-8000-000000000001','52960000-0000-4000-8000-000000000001',100)->'selectedSale','null'::jsonb,'Getter hides obsolete proof after changed venue clock');
update public.reporting_locations set timezone='America/Los_Angeles' where id='52910000-0000-4000-8000-000000000001';
select is(public.refund_current_sunze_cash_source_key('52920000-0000-4000-8000-000000000001','2026-09-29T18:00:00Z'),(select source_key from positive_current_proof),'Restored changed venue clock restores exact snapshot identity');

update public.machine_sales_facts set reporting_location_id='52910000-0000-4000-8000-000000000002' where id='52940000-0000-4000-8000-000000000001';
select isnt(public.refund_current_sunze_cash_source_key('52920000-0000-4000-8000-000000000001','2026-09-29T18:00:00Z'),(select source_key from positive_current_proof),'Snapshot changes for wrong fact location');
select is(public.refund_manager_preparation_snapshot('52950000-0000-4000-8000-000000000001',(select official_action_version from public.refund_cases where id='52950000-0000-4000-8000-000000000001')),null::jsonb,'Stale wrong fact location cannot retain preparation');
select is(public.refund_decision_recommendation_for_case('52950000-0000-4000-8000-000000000001')->'purchase',null::jsonb,'Stale wrong fact location cannot retain a prepared purchase');
select ok(not public.refund_payout_destination_case_current((select c from public.refund_cases c where id='52950000-0000-4000-8000-000000000001')),'Stale wrong fact location cannot authorize a payout request');
select is(public.service_get_sunze_cash_correlation('52950000-0000-4000-8000-000000000001','52960000-0000-4000-8000-000000000001',100)->'selectedSale','null'::jsonb,'Getter hides obsolete proof after wrong fact location');
update public.machine_sales_facts set reporting_location_id='52910000-0000-4000-8000-000000000001' where id='52940000-0000-4000-8000-000000000001';
select is(public.refund_current_sunze_cash_source_key('52920000-0000-4000-8000-000000000001','2026-09-29T18:00:00Z'),(select source_key from positive_current_proof),'Restored wrong fact location restores exact snapshot identity');

update public.reporting_machines set sunze_machine_id='SUNZE-REBOUND' where id='52920000-0000-4000-8000-000000000001';
select isnt(public.refund_current_sunze_cash_source_key('52920000-0000-4000-8000-000000000001','2026-09-29T18:00:00Z'),(select source_key from positive_current_proof),'Snapshot changes for changed provider machine');
select is(public.refund_manager_preparation_snapshot('52950000-0000-4000-8000-000000000001',(select official_action_version from public.refund_cases where id='52950000-0000-4000-8000-000000000001')),null::jsonb,'Stale changed provider machine cannot retain preparation');
select is(public.refund_decision_recommendation_for_case('52950000-0000-4000-8000-000000000001')->'purchase',null::jsonb,'Stale changed provider machine cannot retain a prepared purchase');
select ok(not public.refund_payout_destination_case_current((select c from public.refund_cases c where id='52950000-0000-4000-8000-000000000001')),'Stale changed provider machine cannot authorize a payout request');
select is(public.service_get_sunze_cash_correlation('52950000-0000-4000-8000-000000000001','52960000-0000-4000-8000-000000000001',100)->'selectedSale','null'::jsonb,'Getter hides obsolete proof after changed provider machine');
update public.reporting_machines set sunze_machine_id='SUNZE-POSITIVE-1' where id='52920000-0000-4000-8000-000000000001';
select is(public.refund_current_sunze_cash_source_key('52920000-0000-4000-8000-000000000001','2026-09-29T18:00:00Z'),(select source_key from positive_current_proof),'Restored changed provider machine restores exact snapshot identity');

update public.machine_sales_facts set source='manual_csv' where id='52940000-0000-4000-8000-000000000001';
select isnt(public.refund_current_sunze_cash_source_key('52920000-0000-4000-8000-000000000001','2026-09-29T18:00:00Z'),(select source_key from positive_current_proof),'Snapshot changes for wrong source');
select is(public.refund_manager_preparation_snapshot('52950000-0000-4000-8000-000000000001',(select official_action_version from public.refund_cases where id='52950000-0000-4000-8000-000000000001')),null::jsonb,'Stale wrong source cannot retain preparation');
select is(public.refund_decision_recommendation_for_case('52950000-0000-4000-8000-000000000001')->'purchase',null::jsonb,'Stale wrong source cannot retain a prepared purchase');
select ok(not public.refund_payout_destination_case_current((select c from public.refund_cases c where id='52950000-0000-4000-8000-000000000001')),'Stale wrong source cannot authorize a payout request');
select is(public.service_get_sunze_cash_correlation('52950000-0000-4000-8000-000000000001','52960000-0000-4000-8000-000000000001',100)->'selectedSale','null'::jsonb,'Getter hides obsolete proof after wrong source');
update public.machine_sales_facts set source='sunze_browser' where id='52940000-0000-4000-8000-000000000001';
select is(public.refund_current_sunze_cash_source_key('52920000-0000-4000-8000-000000000001','2026-09-29T18:00:00Z'),(select source_key from positive_current_proof),'Restored wrong source restores exact snapshot identity');

select is(public.refund_decision_recommendation_for_case('52950000-0000-4000-8000-000000000001')#>>'{purchase,source}','sunze','Restored exact positive proof resumes the existing recommendation');

update public.refund_sunze_cash_correlation_candidates set selection_conflict=true
where sales_fact_id='52940000-0000-4000-8000-000000000001';
select is(public.refund_decision_recommendation_for_case('52950000-0000-4000-8000-000000000001')->'purchase',null::jsonb,
 'A current selected-sale conflict still rejects recommendation');
select ok(not public.refund_payout_destination_case_current((select c from public.refund_cases c where id='52950000-0000-4000-8000-000000000001')),
 'A current selected-sale conflict still rejects payout-field eligibility');
update public.refund_sunze_cash_correlation_candidates set selection_conflict=false
where sales_fact_id='52940000-0000-4000-8000-000000000001';
update public.reporting_machine_refund_managers set status='revoked'
where reporting_machine_id='52920000-0000-4000-8000-000000000001';
select throws_ok($call$select public.service_select_sunze_cash_candidate(
 '52950000-0000-4000-8000-000000000001',
 (select id from public.refund_sunze_cash_correlation_attempts where refund_case_id='52950000-0000-4000-8000-000000000001'),
 '52940000-0000-4000-8000-000000000001',1,1,
 '52960000-0000-4000-8000-000000000001')$call$,
 '42501','Authorized refund manager actor required','Current selecting actor must still be authorized');
update public.reporting_machine_refund_managers set status='active'
where reporting_machine_id='52920000-0000-4000-8000-000000000001';

insert into public.sales_import_runs (
  id, source, status, rows_seen, rows_imported, meta, completed_at
)
values (
  '52930000-0000-4000-8000-000000000002', 'sunze_browser', 'completed', 0, 0,
  '{"github_run_id":"cash-positive-run-2","payment_time_semantics_status":"unvalidated","timestamp_proof_scope":"unvalidated","machine_coverage_verified":true,"visible_machine_count_mismatch":false}'::jsonb,
  '2099-09-29 22:00:00+00'
);

select throws_ok(
  $$select public.service_select_sunze_cash_candidate(
    '52950000-0000-4000-8000-000000000001',
    (select id from public.refund_sunze_cash_correlation_attempts
      where refund_case_id = '52950000-0000-4000-8000-000000000001'),
    '52940000-0000-4000-8000-000000000001', 1, 1,
    '52960000-0000-4000-8000-000000000001')$$,
  '40001', 'Stale Sunze candidate selection',
  'A newer completed import makes the prior positive snapshot stale'
);

select is(
  public.service_correlate_sunze_cash_case(
    '52950000-0000-4000-8000-000000000001',
    (select deterministic_fact_version from public.refund_cases
      where id = '52950000-0000-4000-8000-000000000001'),
    'completed_import', '52930000-0000-4000-8000-000000000002',
    '2026-09-29 22:01:00+00'
  )->>'state',
  'multiple_possible_sales',
  'A later empty import keeps the reviewed link but exposes no current candidate'
);
create temporary table superseded_positive_read as select
 public.service_get_sunze_cash_correlation('52950000-0000-4000-8000-000000000001',
 '52960000-0000-4000-8000-000000000001',100) result;
select is((select jsonb_array_length(result->'candidates') from superseded_positive_read),0,
 'A later empty import has no current purchase candidate');
select is((select result->'selectedSale' from superseded_positive_read),'null'::jsonb,
 'A superseded positive snapshot cannot present an old selection as current');
select is((select result->>'sourceReadiness' from superseded_positive_read),'unavailable',
 'An empty partial import remains unavailable rather than covered');

update public.refund_cases
set incident_time_resolution = 'ambiguous'
where id = '52950000-0000-4000-8000-000000000002';
select is(
  public.service_correlate_sunze_cash_case(
    '52950000-0000-4000-8000-000000000002', 2, 'corrected_case_facts', null,
    '2026-09-29 22:05:00+00'
  )->>'state',
  'sales_history_unavailable',
  'Ambiguous venue time never enters the positive review path'
);
select is((
  select count(*)::integer from public.refund_sunze_cash_sale_links
  where refund_case_id = '52950000-0000-4000-8000-000000000002'
), 0, 'Unavailable evidence cannot create a sale link');

select * from finish();
rollback;
