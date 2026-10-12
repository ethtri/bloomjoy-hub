begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

create function pg_temp.error_state(statement text)
returns text language plpgsql as $$
begin
  execute statement;
  return null;
exception when others then return sqlstate;
end;
$$;

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
\ir fixtures/reporting_source_tax.inc


insert into public.reporting_machine_refund_managers(
  reporting_machine_id,manager_user_id,manager_email,grant_reason)
values('16612000-0000-4000-8000-000000000002',
  '16600000-0000-4000-8000-000000000001',
  'snapcase-completion-admin@example.invalid','Ready snapshot fixture');

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
 payment_method,payment_amount_cents,status,correlation_status,intake_selection_kind,intake_selection_machine_ids,intake_selection_key,created_at
) values (
 '16617000-0000-4000-8000-000000000001','RF-SNAPCASE-CASH-TEST',
 '16612000-0000-4000-8000-000000000002','16611000-0000-4000-8000-000000000001',
 'snapcase-refund@example.invalid','Published cash fixture',
 '2026-09-20T19:00:36Z','2026-09-20 12:00:36','America/Los_Angeles','exact',
 'cash',900,'needs_review','manual_review','exact_machine',array['16612000-0000-4000-8000-000000000002'::uuid],public.refund_public_selection_key('machine|16612000-0000-4000-8000-000000000002'),statement_timestamp()-interval '1 day'
);


insert into public.refund_follow_up_cycles(id,refund_case_id,cycle_number,trigger_fingerprint,reason_code,
 requested_fields,template_version,case_fact_version,reminder_delay_hours,status)
 select '16618000-0000-4000-8000-000000000001',c.id,1,repeat('b',64),'no_safe_match','{}'::text[],
 settings.template_version,c.deterministic_fact_version,settings.reminder_delay_hours,'claimed'
 from public.refund_cases c cross join public.refund_customer_contact_settings settings
 where c.id='16617000-0000-4000-8000-000000000001';
update public.refund_follow_up_cycles set status='manual_review',failed_at=statement_timestamp(),failure_code='request_claim_abandoned'
 where id='16618000-0000-4000-8000-000000000001';

-- Fixtures reproduce separate production transactions inside a rollback-only test.
update private.snapcase_machine_mappings set mapped_at=statement_timestamp()-interval '3 hours',
 updated_at=statement_timestamp()-interval '3 hours';
select public.service_project_snapcase_financial_window(
 '16613000-0000-4000-8000-000000000001','refund-cash-machine','2026-09-20T07:00:00Z','2026-09-21T07:00:00Z');
create temporary table original_proof as select public.service_correlate_sunze_cash_case(
 '16617000-0000-4000-8000-000000000001',1,'backfill') result;
select public.service_select_sunze_cash_candidate(
 '16617000-0000-4000-8000-000000000001',(select (result->>'attemptId')::uuid from original_proof),
 (select sales_fact_id from public.refund_sunze_cash_correlation_candidates where attempt_id=(select (result->>'attemptId')::uuid from original_proof)),
 1,0,'16600000-0000-4000-8000-000000000001');
update public.refund_sunze_cash_correlation_attempts set evaluated_at=statement_timestamp()-interval '2 hours'
 where id=(select (result->>'attemptId')::uuid from original_proof);
update public.refund_sunze_cash_sale_links set linked_at=statement_timestamp()-interval '2 hours'
 where refund_case_id='16617000-0000-4000-8000-000000000001';
update public.refund_case_events set created_at=statement_timestamp()-interval '2 hours'
 where refund_case_id='16617000-0000-4000-8000-000000000001' and event_type='sunze_cash_candidate_selected';
set local role service_role;
create temporary table payout_receipt_intent as select
 public.service_enqueue_refund_manual_message_intent(
 '16617000-0000-4000-8000-000000000001',
 (select official_action_version from public.refund_cases where id='16617000-0000-4000-8000-000000000001'),
 '16618100-0000-4000-8000-000000000004','16600000-0000-4000-8000-000000000001',
 'more_info','snapcase-refund@example.invalid','One payout detail needed',
 'Please check the Zelle email or phone for this refund.',
 'refund_more_info_editable_v1','manager_authored','missing_information',
 array['zelle_payment_contact']::text[],null,false,null) result;
create temporary table payout_receipt_claim as select * from
 public.service_claim_refund_manual_message_deliveries(
 (select (result->>'messageId')::uuid from payout_receipt_intent),1);
select is((select count(*)::integer from payout_receipt_claim),1,
 'The exact supported payout request is claimed once');
select public.service_mark_refund_manual_message_provider_attempt(
 (select refund_case_message_id from payout_receipt_claim),
 (select claim_token from payout_receipt_claim));
select public.service_bind_refund_transactional_delivery(
 (select refund_case_message_id from payout_receipt_claim),
 'snapcase_payout_receipt_accepted',statement_timestamp());
reset role;
set local role service_role;
select is(public.service_finish_refund_manual_message_delivery(
 (select refund_case_message_id from payout_receipt_claim),
 (select claim_token from payout_receipt_claim),'sent','transactional_email',null,0,
 'sole_customer')->>'outcome','sent','Supported sender settles the existing provider acceptance');
reset role;
select ok((select m.manual_delivery_state='sent' and m.status='sent'
 and m.sent_at is not null and m.delivery_state='accepted'
 and c.status='waiting_on_customer' and c.decision is null
 and public.refund_payout_destination_case_current(c)
 from public.refund_case_messages m join public.refund_cases c on c.id=m.refund_case_id
 where m.id=(select refund_case_message_id from payout_receipt_claim)),
 'The sent manual request remains current for its one followup while awaiting the customer');
create temporary table original_contact as select to_jsonb(m) message_snapshot,
 (select jsonb_agg(to_jsonb(f) order by f.id) from public.refund_payout_destination_follow_ups f where f.refund_case_id=m.refund_case_id) followup_snapshot
 from public.refund_case_messages m where m.id=(select refund_case_message_id from payout_receipt_claim);
create temporary table before_move as select to_jsonb(c) case_snapshot,
 (select to_jsonb(a) from public.refund_sunze_cash_correlation_attempts a where a.id=(original_proof.result->>'attemptId')::uuid) reviewed_attempt,
 (select to_jsonb(k) from public.refund_sunze_cash_correlation_candidates k where k.attempt_id=(original_proof.result->>'attemptId')::uuid) reviewed_candidate,
 c.matched_sales_fact_id sale_id,
 (select to_jsonb(f)-'updated_at'-'reporting_location_id' from public.machine_sales_facts f where f.id=c.matched_sales_fact_id) sale_snapshot
 from public.refund_cases c cross join original_proof where c.id='16617000-0000-4000-8000-000000000001';
insert into public.customer_accounts(id,name,account_type,status)
 values('16610000-0000-4000-8000-000000000002','Current company ordinary correction','internal','active');
select set_config('request.jwt.claim.sub','16600000-0000-4000-8000-000000000001',true);
select public.admin_upsert_reporting_machine_by_id(
 '16612000-0000-4000-8000-000000000002','16610000-0000-4000-8000-000000000002',null,
 'Duplicate SnapCase record','snapcase',null,'live','Reporting machine identity updated',
 '16610000-0000-4000-8000-000000000001','16611000-0000-4000-8000-000000000001',
 'Unmapped Hub 16612000-0000-4000-8000-000000000002','America/Los_Angeles');
select public.service_project_snapcase_financial_window(
 '16613000-0000-4000-8000-000000000001','refund-cash-machine','2026-09-20T07:00:00Z','2026-09-21T07:00:00Z');
select isnt((select c.reporting_location_id from public.refund_cases c where id='16617000-0000-4000-8000-000000000001'),
 (select location_id from public.reporting_machines where id='16612000-0000-4000-8000-000000000002'),'Real company-save chain leaves original intake Location intact');
select ok(private.refund_snapcase_reviewed_catalog_association('16617000-0000-4000-8000-000000000001',(select sale_id from before_move)),
 'Exact pre-change reviewed source reconstructs through the single audited ordinary correction');
-- Reproduce the actual pre-upgrade cached exclusion using the previous gate and
-- source-key format; run the corrected actual service against that retained cache.
create function pg_temp.source_key_before(uuid,timestamptz,timestamptz)
 returns text language sql as $$select replace(public.refund_current_sunze_cash_source_key($1,$2,$3),':reviewed_catalog_v1','')$$;
do $$declare definition text; begin
 definition:=pg_get_functiondef('public.service_correlate_sunze_cash_case(uuid,bigint,text,uuid,timestamptz)'::regprocedure);
 definition:=replace(definition,'public.service_correlate_sunze_cash_case','pg_temp.correlate_before');
 definition:=replace(definition,'public.refund_current_sunze_cash_source_key','pg_temp.source_key_before');
 definition:=replace(definition,'(case_row.reporting_location_id=machine.location_id or
        private.refund_snapcase_reviewed_catalog_association(case_row.id,fact.id))','case_row.reporting_location_id=machine.location_id');
 execute definition;
end$$;
create temporary table excluded as select pg_temp.correlate_before('16617000-0000-4000-8000-000000000001',1,'backfill',null,statement_timestamp()) result;
select is((select result->>'candidateCount' from excluded),'0','Pre-upgrade actual-chain matcher excludes the retained sale');
select is((select result->>'reason' from excluded),'selected_sale_conflict','Zero candidates reproduce the observed retained-selection conflict');
create temporary table excluded_snapshot as select to_jsonb(a) snapshot from public.refund_sunze_cash_correlation_attempts a
 where a.id=(select (result->>'attemptId')::uuid from excluded);
create temporary table recovered as select public.service_correlate_sunze_cash_case('16617000-0000-4000-8000-000000000001',1,'backfill') result;
select is((select result->>'candidateCount' from recovered),'1','Corrected existing correlation exposes the exact retained purchase');
select isnt((select result->>'attemptId' from recovered),(select result->>'attemptId' from excluded),'Audited source discriminator supersedes cached exclusion without mutating it');
select is((select to_jsonb(a) from public.refund_sunze_cash_correlation_attempts a where a.id=(select (result->>'attemptId')::uuid from excluded)),
 (select snapshot from excluded_snapshot),'Old zero-candidate attempt remains immutable');
select is((select sales_fact_id from public.refund_sunze_cash_correlation_candidates where attempt_id=(select (result->>'attemptId')::uuid from recovered)),
 (select sale_id from before_move),'No similar purchase substitutes for the retained reviewed identity');
select is(public.service_correlate_sunze_cash_case('16617000-0000-4000-8000-000000000001',1,'backfill')->>'replayed','true','Unchanged recovered proof replays idempotently');
select is(public.service_get_sunze_cash_correlation('16617000-0000-4000-8000-000000000001','16600000-0000-4000-8000-000000000001')->>'attemptId',
 (select result->>'attemptId' from recovered),'Existing authorized read RPC presents the new current attempt');
select is(public.refund_payout_destination_case_current((select c from public.refund_cases c where id='16617000-0000-4000-8000-000000000001')),false,
 'Candidate visibility does not auto-rebind a legacy payout request');

-- Challenges run against the actual recovered attempt/selection API, not just
-- the helper. Every mutation is synthetic and rolled back before the next one.
savepoint challenge;
update public.admin_audit_log set meta=meta||jsonb_build_object('ownershipTransfer',true,'effectiveStartDate','2026-10-07')
 where action='reporting_machine.upserted' and entity_id='16612000-0000-4000-8000-000000000002';
select is(pg_temp.error_state($call$select public.service_select_sunze_cash_candidate(
 '16617000-0000-4000-8000-000000000001',(select (result->>'attemptId')::uuid from recovered),
 (select sale_id from before_move),1,1,'16600000-0000-4000-8000-000000000001')$call$),'40001',
 'Explicit dated ownership transfer cannot use the ordinary-correction proof');
rollback to challenge;
update public.admin_audit_log set after=jsonb_set(after,'{installed_at}',to_jsonb('2026-10-07'::text))
 where action='reporting_machine.upserted' and entity_id='16612000-0000-4000-8000-000000000002';
select is(pg_temp.error_state($call$select public.service_select_sunze_cash_candidate(
 '16617000-0000-4000-8000-000000000001',(select (result->>'attemptId')::uuid from recovered),
 (select sale_id from before_move),1,1,'16600000-0000-4000-8000-000000000001')$call$),'40001',
 'Recorded relocation or another changed machine fact remains excluded');
rollback to challenge;
delete from public.admin_audit_log where action='reporting_location.created'
 and meta->>'machineId'='16612000-0000-4000-8000-000000000002';
select is(pg_temp.error_state($call$select public.service_select_sunze_cash_candidate(
 '16617000-0000-4000-8000-000000000001',(select (result->>'attemptId')::uuid from recovered),
 (select sale_id from before_move),1,1,'16600000-0000-4000-8000-000000000001')$call$),'40001',
 'Unaudited internal scaffold cannot bypass the original Location guard');
rollback to challenge;
insert into public.admin_audit_log(actor_user_id,action,entity_type,entity_id,before,after,meta,created_at)
 select actor_user_id,action,entity_type,entity_id,before,after,meta,created_at+interval '1 second'
 from public.admin_audit_log where action='reporting_machine.upserted'
 and entity_id='16612000-0000-4000-8000-000000000002';
select is(pg_temp.error_state($call$select public.service_select_sunze_cash_candidate(
 '16617000-0000-4000-8000-000000000001',(select (result->>'attemptId')::uuid from recovered),
 (select sale_id from before_move),1,1,'16600000-0000-4000-8000-000000000001')$call$),'40001',
 'Multiple or ambiguous association changes require separate review');
rollback to challenge;
update public.admin_audit_log set before=jsonb_set(before,'{location_id}',to_jsonb(gen_random_uuid()::text))
 where action='reporting_machine.upserted' and entity_id='16612000-0000-4000-8000-000000000002';
select ok(not private.refund_snapcase_reviewed_catalog_association('16617000-0000-4000-8000-000000000001',(select sale_id from before_move)),
 'Unrelated prior Location cannot borrow the same-machine audit');
rollback to challenge;
update private.snapcase_machine_mappings set reporting_machine_id='16612000-0000-4000-8000-000000000001';
select is(pg_temp.error_state($call$select public.service_select_sunze_cash_candidate(
 '16617000-0000-4000-8000-000000000001',(select (result->>'attemptId')::uuid from recovered),
 (select sale_id from before_move),1,1,'16600000-0000-4000-8000-000000000001')$call$),'40001',
 'Distinct original financial-owner machine/provider association cannot be merged');
rollback to challenge;
update private.snapcase_machine_mappings set updated_at=statement_timestamp();
select is(pg_temp.error_state($call$select public.service_select_sunze_cash_candidate(
 '16617000-0000-4000-8000-000000000001',(select (result->>'attemptId')::uuid from recovered),
 (select sale_id from before_move),1,1,'16600000-0000-4000-8000-000000000001')$call$),'40001',
 'Changed mapping lineage cannot reuse pre-change review');
rollback to challenge;
update public.refund_sunze_cash_correlation_attempts set invalidated_at=statement_timestamp(),invalidation_reason='selected_sale_released'
 where id=(select (result->>'attemptId')::uuid from original_proof);
select is(pg_temp.error_state($call$select public.service_select_sunze_cash_candidate(
 '16617000-0000-4000-8000-000000000001',(select (result->>'attemptId')::uuid from recovered),
 (select sale_id from before_move),1,1,'16600000-0000-4000-8000-000000000001')$call$),'40001',
 'Invalidated original source proof remains closed');
rollback to challenge;
update public.refund_sunze_cash_sale_links set released_at=statement_timestamp(),release_reason='wrong_sale',
 released_by='16600000-0000-4000-8000-000000000001',released_case_fact_version=1
 where refund_case_id='16617000-0000-4000-8000-000000000001';
select is(pg_temp.error_state($call$select public.service_select_sunze_cash_candidate(
 '16617000-0000-4000-8000-000000000001',(select (result->>'attemptId')::uuid from recovered),
 (select sale_id from before_move),1,2,'16600000-0000-4000-8000-000000000001')$call$),'40001',
 'Revoked retained review cannot resurrect an old purchase');
rollback to challenge;
update public.refund_sunze_cash_correlation_candidates set selection_conflict=true
 where attempt_id=(select (result->>'attemptId')::uuid from original_proof);
select is(pg_temp.error_state($call$select public.service_select_sunze_cash_candidate(
 '16617000-0000-4000-8000-000000000001',(select (result->>'attemptId')::uuid from recovered),
 (select sale_id from before_move),1,1,'16600000-0000-4000-8000-000000000001')$call$),'40001',
 'Conflicting retained selection cannot supply historical review');
rollback to challenge;
update private.snapcase_sales_observations set normalized_tender='card',source_tender_code='3';
select is(pg_temp.error_state($call$select public.service_select_sunze_cash_candidate(
 '16617000-0000-4000-8000-000000000001',(select (result->>'attemptId')::uuid from recovered),
 (select sale_id from before_move),1,1,'16600000-0000-4000-8000-000000000001')$call$),'40001',
 'Contradictory current tender cannot borrow reviewed cash evidence');
rollback to challenge;
update private.snapcase_sales_observations set source_status='unknown';
select is(pg_temp.error_state($call$select public.service_select_sunze_cash_candidate(
 '16617000-0000-4000-8000-000000000001',(select (result->>'attemptId')::uuid from recovered),
 (select sale_id from before_move),1,1,'16600000-0000-4000-8000-000000000001')$call$),'40001',
 'Unknown current provider outcome stays closed');
rollback to challenge;
update private.snapcase_sales_observations set revision_digest=repeat('0',64);
select is(pg_temp.error_state($call$select public.service_select_sunze_cash_candidate(
 '16617000-0000-4000-8000-000000000001',(select (result->>'attemptId')::uuid from recovered),
 (select sale_id from before_move),1,1,'16600000-0000-4000-8000-000000000001')$call$),'40001',
 'Stale publication payment revision stays closed');
rollback to challenge;
update public.machine_sales_facts set payment_time=payment_time+interval '2 hours'
 where id=(select sale_id from before_move);
select is(pg_temp.error_state($call$select public.service_select_sunze_cash_candidate(
 '16617000-0000-4000-8000-000000000001',(select (result->>'attemptId')::uuid from recovered),
 (select sale_id from before_move),1,1,'16600000-0000-4000-8000-000000000001')$call$),'40001',
 'Changed payment window cannot reuse historical review');
rollback to challenge;
update public.machine_sales_facts set net_sales_cents=net_sales_cents+1
 where id=(select sale_id from before_move);
select is(pg_temp.error_state($call$select public.service_select_sunze_cash_candidate(
 '16617000-0000-4000-8000-000000000001',(select (result->>'attemptId')::uuid from recovered),
 (select sale_id from before_move),1,1,'16600000-0000-4000-8000-000000000001')$call$),'40001',
 'Changed current amount cannot borrow retained purchase identity');
rollback to challenge;
update public.refund_sunze_cash_correlation_attempts set evaluated_at=statement_timestamp()
 where id=(select (result->>'attemptId')::uuid from original_proof);
select ok(not private.refund_snapcase_reviewed_catalog_association('16617000-0000-4000-8000-000000000001',(select sale_id from before_move)),
 'Review after reassignment is not evidence of the original historical association');
rollback to challenge;
select ok(not private.refund_snapcase_reviewed_catalog_association('16617000-0000-4000-8000-000000000001',gen_random_uuid()),
 'An unrelated selected sale cannot borrow the exact retained proof');
update public.admin_roles set active=false where user_id='16600000-0000-4000-8000-000000000001';
update public.reporting_machine_refund_managers set status='revoked' where manager_user_id='16600000-0000-4000-8000-000000000001';
select is(pg_temp.error_state($call$select public.service_select_sunze_cash_candidate(
 '16617000-0000-4000-8000-000000000001',(select (result->>'attemptId')::uuid from recovered),
 (select sale_id from before_move),1,1,'16600000-0000-4000-8000-000000000001')$call$),'42501',
 'Revoked current actor cannot use historical association to regain authority');
rollback to challenge;
create temporary table reselected as select public.service_select_sunze_cash_candidate(
 '16617000-0000-4000-8000-000000000001',(select (result->>'attemptId')::uuid from recovered),
 (select sale_id from before_move),1,1,'16600000-0000-4000-8000-000000000001') result;
select is((select result->>'selected' from reselected),'true','Existing authorized reviewed selection rebinds only the exact current candidate');
select is(public.service_select_sunze_cash_candidate(
 '16617000-0000-4000-8000-000000000001',(select (result->>'attemptId')::uuid from recovered),
 (select sale_id from before_move),1,1,'16600000-0000-4000-8000-000000000001')->>'replayed','true',
 'Exact current reviewed selection replays without another link');
select ok(public.refund_payout_destination_case_current((select c from public.refund_cases c where id='16617000-0000-4000-8000-000000000001')),
 'Rebound current review restores existing customer-wait payout eligibility');
select is((select to_jsonb(a) from public.refund_sunze_cash_correlation_attempts a where a.id=(select (result->>'attemptId')::uuid from original_proof)),
 (select reviewed_attempt from before_move),'Original reviewed attempt remains immutable');
select is((select to_jsonb(k) from public.refund_sunze_cash_correlation_candidates k where k.attempt_id=(select (result->>'attemptId')::uuid from original_proof)),
 (select reviewed_candidate from before_move),'Original reviewed candidate remains immutable');
select is((select to_jsonb(f)-'updated_at'-'reporting_location_id' from public.machine_sales_facts f where id=(select sale_id from before_move)),
 (select sale_snapshot from before_move),'Association replay preserves every original financial/source fact');
select is((select to_jsonb(c)-array['updated_at','lifecycle_revision','official_action_version','correlation_status','correlation_source','correlation_summary','cash_match_state','cash_match_evaluated_fact_version']
 from public.refund_cases c where id='16617000-0000-4000-8000-000000000001'),
 (select case_snapshot-array['updated_at','lifecycle_revision','official_action_version','correlation_status','correlation_source','correlation_summary','cash_match_state','cash_match_evaluated_fact_version'] from before_move),
 'Original intake, case identity, fact version, decisions and financial facts remain intact');
select is((select to_jsonb(m) from public.refund_case_messages m where id=(select refund_case_message_id from payout_receipt_claim)),
 (select message_snapshot from original_contact),'Delivered original question and receipt remain immutable');
select is((select jsonb_agg(to_jsonb(f) order by f.id) from public.refund_payout_destination_follow_ups f where refund_case_id='16617000-0000-4000-8000-000000000001'),
 (select followup_snapshot from original_contact),'Existing one-reminder ledger remains untouched');
select is((select count(*)::integer from public.refund_case_messages where refund_case_id='16617000-0000-4000-8000-000000000001'),1,
 'Recovery visibility and reviewed selection create no additional customer message');
set local role service_role;
select is(pg_temp.error_state($call$select public.service_enqueue_refund_manual_message_intent(
 '16617000-0000-4000-8000-000000000001',
 (select official_action_version from public.refund_cases where id='16617000-0000-4000-8000-000000000001'),
 '16618100-0000-4000-8000-000000000009','16600000-0000-4000-8000-000000000001',
 'more_info','snapcase-refund@example.invalid','Repeated request','Repeated request',
 'refund_more_info_editable_v1','manager_authored','missing_information',array['zelle_payment_contact']::text[],null,false,null)$call$),
 'P4662','Recovered current review cannot bypass the consumed original-question budget');
reset role;
select ok(not has_function_privilege('anon','private.refund_snapcase_reviewed_catalog_association(uuid,uuid)','execute')
 and not has_function_privilege('authenticated','private.refund_snapcase_reviewed_catalog_association(uuid,uuid)','execute')
 and not has_function_privilege('service_role','private.refund_snapcase_reviewed_catalog_association(uuid,uuid)','execute'),
 'Internal proof predicate creates no independently callable authority');

create temporary table accepted_source as select public.refund_current_sunze_cash_source_key(
 '16612000-0000-4000-8000-000000000002','2026-09-20T19:00:36Z') source_key;
savepoint phase_probe;
update public.refund_cases set decision='approved',status='cash_zelle_pending'
 where id='16617000-0000-4000-8000-000000000001';
select is(public.refund_current_sunze_cash_source_key('16612000-0000-4000-8000-000000000002','2026-09-20T19:00:36Z'),
 (select source_key from accepted_source),'Manager approval cannot change the accepted purchase source identity');
select is(public.service_get_sunze_cash_correlation('16617000-0000-4000-8000-000000000001','16600000-0000-4000-8000-000000000001')->>'attemptId',
 (select result->>'attemptId' from recovered),'Approved cash read keeps its reviewed purchase instead of reverting to checking history');
select is(pg_temp.error_state($call$select public.service_select_sunze_cash_candidate(
 '16617000-0000-4000-8000-000000000001',(select (result->>'attemptId')::uuid from recovered),
 (select sale_id from before_move),1,3,'16600000-0000-4000-8000-000000000001')$call$),'P0001',
 'Source association does not reopen selection after the Manager decision');
rollback to phase_probe;
update public.refund_cases set nayax_refund_execution_status='manual_review'
 where id='16617000-0000-4000-8000-000000000001';
select is(public.refund_current_sunze_cash_source_key('16612000-0000-4000-8000-000000000002','2026-09-20T19:00:36Z'),
 (select source_key from accepted_source),'Outcome hold does not invent changed purchase source evidence');
select is(public.refund_manager_preparation_snapshot('16617000-0000-4000-8000-000000000001',
 (select official_action_version from public.refund_cases where id='16617000-0000-4000-8000-000000000001')),null::jsonb,
 'Unresolved payment outcome remains unavailable to the Manager decision consumer');
select ok(not public.refund_payout_destination_case_current((select c from public.refund_cases c where id='16617000-0000-4000-8000-000000000001')),
 'Unresolved payment outcome still blocks contact/payment continuation despite unchanged purchase proof');
rollback to phase_probe;
select * from finish();
rollback;
