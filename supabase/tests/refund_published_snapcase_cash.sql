begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

insert into auth.users(
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  '16600000-0000-4000-8000-000000000001',
  'authenticated', 'authenticated', 'snapcase-completion-admin@example.invalid', '', now(),
  '{}'::jsonb, '{}'::jsonb, now(), now()
);
insert into public.admin_roles(user_id, role, active)
values ('16600000-0000-4000-8000-000000000001', 'super_admin', true);

insert into public.customer_accounts(id, name, account_type, status)
values ('16610000-0000-4000-8000-000000000001', 'SnapCase completion fixture', 'internal', 'active');
insert into public.reporting_locations(id, account_id, name, timezone, status)
values ('16611000-0000-4000-8000-000000000001', '16610000-0000-4000-8000-000000000001', 'Completion location', 'America/Los_Angeles', 'active');
insert into public.reporting_machines(
  id, account_id, location_id, machine_label, machine_type, status,
  nayax_account_key, nayax_machine_id
)
values
  (
    '16612000-0000-4000-8000-000000000001',
    '16610000-0000-4000-8000-000000000001',
    '16611000-0000-4000-8000-000000000001',
    'Legacy Nayax-bound SnapCase', 'commercial', 'active',
    'TGPACI_USA_DB', '166120001'
  ),
  (
    '16612000-0000-4000-8000-000000000002',
    '16610000-0000-4000-8000-000000000001',
    '16611000-0000-4000-8000-000000000001',
    'Duplicate SnapCase record', 'snapcase', 'active', null, null
  );
insert into public.reporting_machine_tax_rates(id, machine_id, tax_rate_percent, effective_start_date, status)
values ('16612500-0000-4000-8000-000000000001', '16612000-0000-4000-8000-000000000001', 0, '2025-01-01', 'active');

insert into private.snapcase_provider_accounts(id, source_account_key)
values ('16613000-0000-4000-8000-000000000001', 'refund-cash-fixture');

create function pg_temp.add_batch(
  p_id uuid, p_run text, p_batch text, p_payment_count integer, p_evidence_count integer
) returns void language sql as $$
  insert into private.snapcase_ingest_batches(
    id, provider_account_id, contract_version, run_key, batch_key, batch_digest,
    request_fingerprint, machine_count, order_count, payment_count, evidence_count
  ) values (
    p_id, '16613000-0000-4000-8000-000000000001', 'snapcase.ingest.v1',
    p_run, p_batch, encode(extensions.digest(convert_to(p_batch, 'UTF8'), 'sha256'), 'hex'),
    encode(extensions.digest(convert_to(p_batch || '-request', 'UTF8'), 'sha256'), 'hex'),
    0, 0, p_payment_count, p_evidence_count
  );
$$;

select pg_temp.add_batch('16614000-0000-4000-8000-000000000001', repeat('1',64), repeat('a',64), 1, 0);
select pg_temp.add_batch('16614000-0000-4000-8000-000000000002', repeat('1',64), repeat('b',64), 0, 1);

insert into private.snapcase_source_machines(
  provider_account_id, source_machine_id, source_timezone, source_currency,
  revision_digest, revision_number, first_seen_batch_id, last_seen_batch_id
) values (
  '16613000-0000-4000-8000-000000000001', 'refund-cash-machine',
  'America/Los_Angeles', 'USD', repeat('c',64), 1,
  '16614000-0000-4000-8000-000000000001', '16614000-0000-4000-8000-000000000001'
);
insert into private.snapcase_machine_mappings(
  id, provider_account_id, source_machine_id, reporting_machine_id,
  effective_start_date, mapping_reason
) values (
  '16616600-0000-4000-8000-000000000001',
  '16613000-0000-4000-8000-000000000001', 'refund-cash-machine',
  '16612000-0000-4000-8000-000000000002', '2025-01-01', 'Refund cash fixture'
);

insert into private.snapcase_sales_observations(
  id, provider_account_id, resource, source_key, source_key_version,
  source_machine_id, source_status, source_tender_code, source_tender_label,
  normalized_tender, occurred_time_raw, occurred_at, source_currency,
  currency_code, source_amount_text, amount_minor, exception_codes,
  revision_digest, first_seen_batch_id, last_seen_batch_id
) values (
  '16616000-0000-4000-8000-000000000001',
  '16613000-0000-4000-8000-000000000001', 'payment', repeat('d',64), 1,
  'refund-cash-machine', 'success', '1', 'cash', 'cash',
  '2026-09-20 12:00:00', '2026-09-20T19:00:00Z', 'USD', 'USD',
  '10.00', 1000, array['financial_status_semantics_unverified'], repeat('e',64),
  '16614000-0000-4000-8000-000000000001', '16614000-0000-4000-8000-000000000001'
);

insert into private.snapcase_extraction_evidence(
  provider_account_id, ingest_batch_id, resource, source_machine_id,
  requested_start, requested_end, requested_timezone, extraction_status,
  page_count, next_cursor_present, response_truncated, observed_count,
  expected_total, effective_page_size, rejected_count,
  business_coverage_status, coverage_reason_code
) values (
  '16613000-0000-4000-8000-000000000001', '16614000-0000-4000-8000-000000000002',
  'payments', 'refund-cash-machine', '2026-09-20T07:00:00Z', '2026-09-21T07:00:00Z',
  'America/Los_Angeles', 'complete', 1, false, false, 1, 1, 50, 0,
  'unverified', 'source_time_semantics_unverified'
);


select set_config('request.jwt.claim.role','service_role',true);
select public.service_finalize_snapcase_import_run('refund-cash-fixture',repeat('1',64));
insert into public.refund_cases(
 id,public_reference,reporting_machine_id,reporting_location_id,customer_email,
 issue_summary,incident_at,incident_local_datetime,incident_timezone,incident_time_resolution,
 payment_method,payment_amount_cents,status,correlation_status
) values (
 '16617000-0000-4000-8000-000000000001','RF-SNAPCASE-CASH-TEST',
 '16612000-0000-4000-8000-000000000002','16611000-0000-4000-8000-000000000001',
 'snapcase-refund@example.invalid','Published cash fixture',
 '2026-09-20T19:00:36Z','2026-09-20 12:00:36','America/Los_Angeles','exact',
 'cash',900,'needs_review','manual_review'
);
create temporary table baseline as
select c.decision,c.refund_completed_at,c.reporting_adjustment_id,c.refund_amount_cents,
 (select count(*) from public.refund_case_messages m where m.refund_case_id=c.id) messages,
 (select count(*) from public.refund_case_nayax_refund_attempts a where a.refund_case_id=c.id) attempts,
 (select count(*) from public.refund_authoritative_receipts a where a.refund_case_id=c.id) receipts
from public.refund_cases c where id='16617000-0000-4000-8000-000000000001';
create temporary table cash_proof as select
 public.service_correlate_sunze_cash_case('16617000-0000-4000-8000-000000000001',1,'backfill') result;
select is((select result->>'state' from cash_proof),'multiple_possible_sales','Published cash needs reviewed selection, not automatic choice');
select is((select result->>'candidateCount' from cash_proof),'1','Published source without Sunze import supplies the exact-machine candidate');
select is((select cash_match_state from public.refund_cases where id='16617000-0000-4000-8000-000000000001'),'multiple_possible_sales','Incomplete coverage never claims no sale');
select is((select matched_sales_fact_id from public.refund_cases where id='16617000-0000-4000-8000-000000000001'),null::uuid,'No automatic selection from a positive-only publication');
select is((select amount_delta_cents from public.refund_sunze_cash_correlation_candidates where attempt_id=(select (result->>'attemptId')::uuid from cash_proof)),100,'Approximate customer amount difference stays advisory');
select is((select time_delta_seconds from public.refund_sunze_cash_correlation_candidates where attempt_id=(select (result->>'attemptId')::uuid from cash_proof)),36,'Existing published machine-local time is comparable');
select ok((select evidence_codes @> array['published_snapcase_cash','source_time_validated'] from public.refund_sunze_cash_correlation_candidates where attempt_id=(select (result->>'attemptId')::uuid from cash_proof)),'Evidence carries published source and clock provenance');
select is(public.service_get_sunze_cash_correlation('16617000-0000-4000-8000-000000000001','16600000-0000-4000-8000-000000000001')->>'cashSource','snapcase','Existing read projection identifies actual source');
select is(public.service_get_sunze_cash_correlation('16617000-0000-4000-8000-000000000001','16600000-0000-4000-8000-000000000001')->>'sourceReadiness','unavailable','Positive publication does not imply global completeness');
select is(public.service_correlate_sunze_cash_case('16617000-0000-4000-8000-000000000001',1,'backfill')->>'replayed','true','Unchanged publication correlation replays idempotently');
create temporary table picked as select public.service_select_sunze_cash_candidate(
 '16617000-0000-4000-8000-000000000001',(select (result->>'attemptId')::uuid from cash_proof),
 (select sales_fact_id from public.refund_sunze_cash_correlation_candidates where attempt_id=(select (result->>'attemptId')::uuid from cash_proof)),
 1,0,'16600000-0000-4000-8000-000000000001') result;
select is((select result->>'selected' from picked),'true','Existing fact/version-bound selection accepts reviewed SnapCase evidence');
select is(public.service_select_sunze_cash_candidate(
 '16617000-0000-4000-8000-000000000001',(select (result->>'attemptId')::uuid from cash_proof),
 (select sales_fact_id from public.refund_sunze_cash_correlation_candidates where attempt_id=(select (result->>'attemptId')::uuid from cash_proof)),
 1,0,'16600000-0000-4000-8000-000000000001')->>'replayed','true','Same reviewed selection does not repeat writes');
select is(public.refund_decision_recommendation_for_case('16617000-0000-4000-8000-000000000001')->'purchase'->>'source','snapcase','Existing cash recommendation uses actual current reviewed purchase source');
select is(public.refund_decision_recommendation_for_case('16617000-0000-4000-8000-000000000001')->'purchase'->>'amountCents','1000','Recommendation preserves source amount rather than customer estimate');
select is((select count(*)::integer from public.refund_sunze_cash_sale_links where refund_case_id='16617000-0000-4000-8000-000000000001'),1,'Idempotent selection retains one existing sale link');
update public.machine_sales_facts set raw_payload=jsonb_set(raw_payload,'{providerAccountId}',to_jsonb('wrong-account'::text)) where source='snapcase_cash' and raw_payload->>'sourceMachineId'='refund-cash-machine';
select throws_ok($case$select public.service_select_sunze_cash_candidate(
 '16617000-0000-4000-8000-000000000001',(select (result->>'attemptId')::uuid from cash_proof),
 (select sales_fact_id from public.refund_sunze_cash_correlation_candidates where attempt_id=(select (result->>'attemptId')::uuid from cash_proof)),
 1,1,'16600000-0000-4000-8000-000000000001')$case$,'40001','Stale Sunze candidate selection','Wrong provider account blocks current selection');
select is(public.service_get_sunze_cash_correlation('16617000-0000-4000-8000-000000000001','16600000-0000-4000-8000-000000000001')->>'selectedSalesFactId',null::text,'Wrong provider account hides stale selected evidence');
select is(public.refund_decision_recommendation_for_case('16617000-0000-4000-8000-000000000001')->'purchase',null::jsonb,'Wrong provider account cannot prepare a refund recommendation');
update public.machine_sales_facts set raw_payload=jsonb_set(raw_payload,'{providerAccountId}',to_jsonb('16613000-0000-4000-8000-000000000001'::text)) where source='snapcase_cash' and raw_payload->>'sourceMachineId'='refund-cash-machine';
update public.machine_sales_facts set raw_payload=jsonb_set(raw_payload,'{sourceMachineId}',to_jsonb('wrong-device'::text)) where source='snapcase_cash' and raw_payload->>'sourcePaymentKey'=repeat('d',64);
select throws_ok($case$select public.service_select_sunze_cash_candidate(
 '16617000-0000-4000-8000-000000000001',(select (result->>'attemptId')::uuid from cash_proof),
 (select sales_fact_id from public.refund_sunze_cash_correlation_candidates where attempt_id=(select (result->>'attemptId')::uuid from cash_proof)),
 1,1,'16600000-0000-4000-8000-000000000001')$case$,'40001','Stale Sunze candidate selection','Wrong source device blocks current selection');
select is(public.service_get_sunze_cash_correlation('16617000-0000-4000-8000-000000000001','16600000-0000-4000-8000-000000000001')->>'selectedSalesFactId',null::text,'Wrong source device hides stale selected evidence');
select is(public.refund_decision_recommendation_for_case('16617000-0000-4000-8000-000000000001')->'purchase',null::jsonb,'Wrong source device cannot prepare a refund recommendation');
update public.machine_sales_facts set raw_payload=jsonb_set(raw_payload,'{sourceMachineId}',to_jsonb('refund-cash-machine'::text)) where source='snapcase_cash' and raw_payload->>'sourcePaymentKey'=repeat('d',64);
update private.snapcase_source_machines set source_timezone='America/Chicago' where source_machine_id='refund-cash-machine';
select throws_ok($case$select public.service_select_sunze_cash_candidate(
 '16617000-0000-4000-8000-000000000001',(select (result->>'attemptId')::uuid from cash_proof),
 (select sales_fact_id from public.refund_sunze_cash_correlation_candidates where attempt_id=(select (result->>'attemptId')::uuid from cash_proof)),
 1,1,'16600000-0000-4000-8000-000000000001')$case$,'40001','Stale Sunze candidate selection','Unproved source clock blocks current selection');
select is(public.service_get_sunze_cash_correlation('16617000-0000-4000-8000-000000000001','16600000-0000-4000-8000-000000000001')->>'selectedSalesFactId',null::text,'Unproved source clock hides stale selected evidence');
select is(public.refund_decision_recommendation_for_case('16617000-0000-4000-8000-000000000001')->'purchase',null::jsonb,'Unproved source clock cannot prepare a refund recommendation');
update private.snapcase_source_machines set source_timezone='America/Los_Angeles' where source_machine_id='refund-cash-machine';
update private.snapcase_machine_mappings set effective_end_date='2026-09-19' where source_machine_id='refund-cash-machine';
select throws_ok($case$select public.service_select_sunze_cash_candidate(
 '16617000-0000-4000-8000-000000000001',(select (result->>'attemptId')::uuid from cash_proof),
 (select sales_fact_id from public.refund_sunze_cash_correlation_candidates where attempt_id=(select (result->>'attemptId')::uuid from cash_proof)),
 1,1,'16600000-0000-4000-8000-000000000001')$case$,'40001','Stale Sunze candidate selection','Mapping outside occurrence date blocks current selection');
select is(public.service_get_sunze_cash_correlation('16617000-0000-4000-8000-000000000001','16600000-0000-4000-8000-000000000001')->>'selectedSalesFactId',null::text,'Mapping outside occurrence date hides stale selected evidence');
select is(public.refund_decision_recommendation_for_case('16617000-0000-4000-8000-000000000001')->'purchase',null::jsonb,'Mapping outside occurrence date cannot prepare a refund recommendation');
update private.snapcase_machine_mappings set effective_end_date=null where source_machine_id='refund-cash-machine';
update private.snapcase_sales_observations set revision_digest=repeat('f',64) where source_machine_id='refund-cash-machine';
select throws_ok($case$select public.service_select_sunze_cash_candidate(
 '16617000-0000-4000-8000-000000000001',(select (result->>'attemptId')::uuid from cash_proof),
 (select sales_fact_id from public.refund_sunze_cash_correlation_candidates where attempt_id=(select (result->>'attemptId')::uuid from cash_proof)),
 1,1,'16600000-0000-4000-8000-000000000001')$case$,'40001','Stale Sunze candidate selection','New unpublished payment revision blocks current selection');
select is(public.service_get_sunze_cash_correlation('16617000-0000-4000-8000-000000000001','16600000-0000-4000-8000-000000000001')->>'selectedSalesFactId',null::text,'New unpublished payment revision hides stale selected evidence');
select is(public.refund_decision_recommendation_for_case('16617000-0000-4000-8000-000000000001')->'purchase',null::jsonb,'New unpublished payment revision cannot prepare a refund recommendation');
update private.snapcase_sales_observations set revision_digest=repeat('e',64) where source_machine_id='refund-cash-machine';
update public.machine_sales_facts set raw_payload=jsonb_set(raw_payload,'{publicationState}',to_jsonb('superseded'::text)) where source='snapcase_cash' and raw_payload->>'sourceMachineId'='refund-cash-machine';
select throws_ok($case$select public.service_select_sunze_cash_candidate(
 '16617000-0000-4000-8000-000000000001',(select (result->>'attemptId')::uuid from cash_proof),
 (select sales_fact_id from public.refund_sunze_cash_correlation_candidates where attempt_id=(select (result->>'attemptId')::uuid from cash_proof)),
 1,1,'16600000-0000-4000-8000-000000000001')$case$,'40001','Stale Sunze candidate selection','Superseded publication blocks current selection');
select is(public.service_get_sunze_cash_correlation('16617000-0000-4000-8000-000000000001','16600000-0000-4000-8000-000000000001')->>'selectedSalesFactId',null::text,'Superseded publication hides stale selected evidence');
select is(public.refund_decision_recommendation_for_case('16617000-0000-4000-8000-000000000001')->'purchase',null::jsonb,'Superseded publication cannot prepare a refund recommendation');
update public.machine_sales_facts set raw_payload=jsonb_set(raw_payload,'{publicationState}',to_jsonb('active'::text)) where source='snapcase_cash' and raw_payload->>'sourceMachineId'='refund-cash-machine';
update private.snapcase_sales_observations set normalized_tender='card',source_tender_code='0' where source_machine_id='refund-cash-machine';
select throws_ok($case$select public.service_select_sunze_cash_candidate(
 '16617000-0000-4000-8000-000000000001',(select (result->>'attemptId')::uuid from cash_proof),
 (select sales_fact_id from public.refund_sunze_cash_correlation_candidates where attempt_id=(select (result->>'attemptId')::uuid from cash_proof)),
 1,1,'16600000-0000-4000-8000-000000000001')$case$,'40001','Stale Sunze candidate selection','Current payment is not cash blocks current selection');
select is(public.service_get_sunze_cash_correlation('16617000-0000-4000-8000-000000000001','16600000-0000-4000-8000-000000000001')->>'selectedSalesFactId',null::text,'Current payment is not cash hides stale selected evidence');
select is(public.refund_decision_recommendation_for_case('16617000-0000-4000-8000-000000000001')->'purchase',null::jsonb,'Current payment is not cash cannot prepare a refund recommendation');
update private.snapcase_sales_observations set normalized_tender='cash',source_tender_code='1' where source_machine_id='refund-cash-machine';
update public.machine_sales_facts set source_row_hash=repeat('f',64) where source='snapcase_cash' and raw_payload->>'sourceMachineId'='refund-cash-machine';
select throws_ok($case$select public.service_select_sunze_cash_candidate(
 '16617000-0000-4000-8000-000000000001',(select (result->>'attemptId')::uuid from cash_proof),
 (select sales_fact_id from public.refund_sunze_cash_correlation_candidates where attempt_id=(select (result->>'attemptId')::uuid from cash_proof)),
 1,1,'16600000-0000-4000-8000-000000000001')$case$,'40001','Stale Sunze candidate selection','Changed publication digest blocks current selection');
select is(public.service_get_sunze_cash_correlation('16617000-0000-4000-8000-000000000001','16600000-0000-4000-8000-000000000001')->>'selectedSalesFactId',null::text,'Changed publication digest hides stale selected evidence');
select is(public.refund_decision_recommendation_for_case('16617000-0000-4000-8000-000000000001')->'purchase',null::jsonb,'Changed publication digest cannot prepare a refund recommendation');
update public.machine_sales_facts f set source_row_hash=encode(extensions.digest(convert_to(concat_ws('|','snapcase-cash-publication-v1',repeat('d',64),repeat('e',64),m.id::text,m.mapped_at::text,'snapcase.financial.machine-local.v1'),'UTF8'),'sha256'),'hex') from private.snapcase_machine_mappings m where f.source='snapcase_cash' and f.raw_payload->>'mappingId'=m.id::text and m.source_machine_id='refund-cash-machine';

select throws_ok($case$select public.service_select_sunze_cash_candidate(
 '16617000-0000-4000-8000-000000000001',(select (result->>'attemptId')::uuid from cash_proof),
 (select sales_fact_id from public.refund_sunze_cash_correlation_candidates where attempt_id=(select (result->>'attemptId')::uuid from cash_proof)),
 2,1,'16600000-0000-4000-8000-000000000001')$case$,'40001','Stale Sunze candidate selection','Stale case fact version cannot select');
select throws_ok($case$select public.service_select_sunze_cash_candidate(
 '16617000-0000-4000-8000-000000000001',(select (result->>'attemptId')::uuid from cash_proof),
 (select sales_fact_id from public.refund_sunze_cash_correlation_candidates where attempt_id=(select (result->>'attemptId')::uuid from cash_proof)),
 1,99,'16600000-0000-4000-8000-000000000001')$case$,'40001','Stale Sunze link version','Stale link version cannot select');
update public.admin_roles set active=false where user_id='16600000-0000-4000-8000-000000000001';
select throws_ok($case$select public.service_select_sunze_cash_candidate(
 '16617000-0000-4000-8000-000000000001',(select (result->>'attemptId')::uuid from cash_proof),
 (select sales_fact_id from public.refund_sunze_cash_correlation_candidates where attempt_id=(select (result->>'attemptId')::uuid from cash_proof)),
 1,1,'16600000-0000-4000-8000-000000000001')$case$,'42501','Authorized refund manager actor required','Current selecting actor scope still required');
update public.admin_roles set active=true where user_id='16600000-0000-4000-8000-000000000001';
select is(public.refund_decision_recommendation_for_case('16617000-0000-4000-8000-000000000001')->'purchase'->>'source','snapcase','Restored current source proof resumes existing recommendation');
select ok((select c.decision is not distinct from b.decision and c.refund_completed_at is not distinct from b.refund_completed_at
 and c.reporting_adjustment_id is not distinct from b.reporting_adjustment_id and c.refund_amount_cents is not distinct from b.refund_amount_cents
 and (select count(*) from public.refund_case_messages m where m.refund_case_id=c.id)=b.messages
 and (select count(*) from public.refund_case_nayax_refund_attempts a where a.refund_case_id=c.id)=b.attempts
 and (select count(*) from public.refund_authoritative_receipts a where a.refund_case_id=c.id)=b.receipts
 from public.refund_cases c cross join baseline b where c.id='16617000-0000-4000-8000-000000000001'),
 'Research, reviewed selection and failed stale attempts preserve decisions, payment, receipts and messages');
-- Both catalog clocks changing together must invalidate the selected clock proof.
update public.reporting_locations set timezone='America/Chicago' where id='16611000-0000-4000-8000-000000000001';
update private.snapcase_source_machines set source_timezone='America/Chicago' where source_machine_id='refund-cash-machine';
select is(public.service_get_sunze_cash_correlation('16617000-0000-4000-8000-000000000001','16600000-0000-4000-8000-000000000001')->>'selectedSalesFactId',null::text,'Joint source and venue clock change hides the old selected proof');
select is(public.refund_decision_recommendation_for_case('16617000-0000-4000-8000-000000000001')->'purchase',null::jsonb,'Joint clock change cannot retain a prepared purchase');
update public.reporting_locations set timezone='America/Los_Angeles' where id='16611000-0000-4000-8000-000000000001';
update private.snapcase_source_machines set source_timezone='America/Los_Angeles' where source_machine_id='refund-cash-machine';
select is(public.refund_decision_recommendation_for_case('16617000-0000-4000-8000-000000000001')->'purchase'->>'source','snapcase','Restored clock identity restores the selected proof');

-- An unqualified SnapCase mapping must not discard existing grounded Sunze positives.
insert into public.sales_import_runs(id,source,status,rows_seen,rows_imported,meta,completed_at)
values('16619000-0000-4000-8000-000000000001','sunze_browser','completed',1,1,
 '{"github_run_id":"snapcase-fallback-fixture","payment_time_semantics_status":"unvalidated","timestamp_proof_scope":"unvalidated","machine_coverage_verified":true,"visible_machine_count_mismatch":false}',now());
insert into public.machine_sales_facts(id,reporting_machine_id,reporting_location_id,sale_date,payment_method,net_sales_cents,transaction_count,source,source_row_hash,source_order_hash,import_run_id,payment_time,source_payment_status,raw_payload)
values('16619100-0000-4000-8000-000000000001','16612000-0000-4000-8000-000000000002','16611000-0000-4000-8000-000000000001','2026-09-20','cash',950,1,'sunze_browser','snapcase-fallback-row','snapcase-fallback-order','16619000-0000-4000-8000-000000000001','2026-09-20T19:00:00Z','Payment success','{"payment_time_iso":"2026-09-20T19:00:00.000Z"}');
update private.snapcase_machine_mappings set effective_end_date='2026-09-19' where source_machine_id='refund-cash-machine';
select unlike(public.refund_current_sunze_cash_source_key('16612000-0000-4000-8000-000000000002','2026-09-20T19:00:36Z'),'snapcase:%','Out-of-window mapping does not claim the source');
select is(public.service_correlate_sunze_cash_case('16617000-0000-4000-8000-000000000001',1,'backfill')->>'candidateCount','1','Dormant SnapCase mapping preserves grounded Sunze positive research');
select ok(exists(select 1 from public.refund_sunze_cash_correlation_candidates candidate join public.refund_sunze_cash_correlation_attempts attempt on attempt.id=candidate.attempt_id where attempt.refund_case_id='16617000-0000-4000-8000-000000000001' and candidate.sales_fact_id='16619100-0000-4000-8000-000000000001'),'Sunze positive is retained on its exact source');
select * from finish();
rollback;
