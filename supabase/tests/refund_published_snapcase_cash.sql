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
 payment_method,payment_amount_cents,status,correlation_status
) values (
 '16617000-0000-4000-8000-000000000001','RF-SNAPCASE-CASH-TEST',
 '16612000-0000-4000-8000-000000000002','16611000-0000-4000-8000-000000000001',
 'snapcase-refund@example.invalid','Published cash fixture',
 '2026-09-20T19:00:36Z','2026-09-20 12:00:36','America/Los_Angeles','exact',
 'cash',900,'needs_review','manual_review'
);
update public.refund_cases set correlation_status='no_match',correlation_source='sunze',
 correlation_summary='Historical internal cash research had no safe match.',
 cash_match_evaluated_fact_version=deterministic_fact_version
where id='16617000-0000-4000-8000-000000000001';
insert into public.refund_follow_up_cycles(
 id,refund_case_id,cycle_number,trigger_fingerprint,reason_code,requested_fields,
 template_version,case_fact_version,reminder_delay_hours,status
)
select '16618000-0000-4000-8000-000000000001',c.id,1,repeat('b',64),
 'no_safe_match','{}'::text[],settings.template_version,
 c.deterministic_fact_version,settings.reminder_delay_hours,'claimed'
from public.refund_cases c cross join public.refund_customer_contact_settings settings
where c.id='16617000-0000-4000-8000-000000000001';
update public.refund_follow_up_cycles set status='manual_review',
 failed_at=statement_timestamp(),failure_code='request_claim_abandoned'
where id='16618000-0000-4000-8000-000000000001';
select is(public.refund_purchase_correction_request_fields('16617000-0000-4000-8000-000000000001'),
 '{}'::text[],'Historical empty research hold remains before any positive purchase evidence');
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
select is(public.service_refund_manager_ready_notice_snapshot(
 '16617000-0000-4000-8000-000000000001','16600000-0000-4000-8000-000000000001'),
 null::jsonb,'Unselected positive publication cannot become a Manager-ready notice');
select is(public.refund_purchase_correction_request_fields('16617000-0000-4000-8000-000000000001'),
 '{}'::text[],'Positive cash candidate alone does not lift the historical research hold');
create temporary table picked as select public.service_select_sunze_cash_candidate(
 '16617000-0000-4000-8000-000000000001',(select (result->>'attemptId')::uuid from cash_proof),
 (select sales_fact_id from public.refund_sunze_cash_correlation_candidates where attempt_id=(select (result->>'attemptId')::uuid from cash_proof)),
 1,0,'16600000-0000-4000-8000-000000000001') result;
select is((select result->>'selected' from picked),'true','Existing fact/version-bound selection accepts reviewed SnapCase evidence');
select is(public.refund_purchase_correction_request_fields('16617000-0000-4000-8000-000000000001'),
 array['zelle_payment_contact'],'Current reviewed SnapCase purchase exposes only the existing missing payout field');
savepoint payout_contact_contract;
set local role service_role;
select is(public.service_enqueue_refund_manual_message_intent(
 '16617000-0000-4000-8000-000000000001',
 (select official_action_version from public.refund_cases where id='16617000-0000-4000-8000-000000000001'),
 '16618100-0000-4000-8000-000000000001','16600000-0000-4000-8000-000000000001',
 'more_info','snapcase-refund@example.invalid','One payout detail needed',
 'Please check the Zelle email or phone for this refund.',
 'refund_more_info_editable_v1','manager_authored','missing_information',
 array['zelle_payment_contact']::text[],null,false,null)->>'enqueued','true',
 'Existing protected contact writer accepts the current reviewed cash payout field');
select is(pg_temp.error_state($call$select public.service_enqueue_refund_manual_message_intent(
 '16617000-0000-4000-8000-000000000001',
 (select official_action_version from public.refund_cases where id='16617000-0000-4000-8000-000000000001'),
 '16618100-0000-4000-8000-000000000002','16600000-0000-4000-8000-000000000001',
 'more_info','snapcase-refund@example.invalid','Duplicate payout detail',
 'Duplicate payout detail','refund_more_info_editable_v1','manager_authored',
 'missing_information',array['zelle_payment_contact']::text[],null,false,null)$call$),
 'P4662','Current reviewed purchase does not bypass the existing duplicate contact guard');
reset role;
rollback to savepoint payout_contact_contract;
update public.admin_roles set active=false where user_id='16600000-0000-4000-8000-000000000001';
update public.reporting_machine_refund_managers set status='revoked' where manager_user_id='16600000-0000-4000-8000-000000000001';
select is(public.can_manage_refund_case('16600000-0000-4000-8000-000000000001',
 '16617000-0000-4000-8000-000000000001'),false,
 'Revoked current actor still fails the scope check used by the authenticated contact handler');
set local role authenticated;
select is(pg_temp.error_state($call$select public.service_enqueue_refund_manual_message_intent(
 '16617000-0000-4000-8000-000000000001',
 1,
 '16618100-0000-4000-8000-000000000003','16600000-0000-4000-8000-000000000001',
 'more_info','snapcase-refund@example.invalid','Unauthorized payout detail',
 'Unauthorized payout detail','refund_more_info_editable_v1','manager_authored',
 'missing_information',array['zelle_payment_contact']::text[],null,false,null)$call$),
 '42501','Authenticated callers cannot bypass the contact handler through the trusted service writer');
reset role;
rollback to savepoint payout_contact_contract;
-- Reproduce a manual payout request that was sent against the current reviewed
-- purchase, then became ineligible for another request while awaiting its reply.
savepoint payout_receipt_contract;
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
savepoint payout_unsent_receipt;
update public.refund_sunze_cash_sale_links set released_at=now(),release_reason='wrong_sale',
 released_by='16600000-0000-4000-8000-000000000001',released_case_fact_version=1
where refund_case_id='16617000-0000-4000-8000-000000000001';
select is(pg_temp.error_state($call$select public.service_record_refund_transactional_delivery_event(
 repeat('9',64),'snapcase_payout_receipt_accepted','delivered',
 statement_timestamp(),'<payout-receipt@example.invalid>')$call$),'23514',
 'A claimed but unsent request cannot use receipt reconciliation to bypass current contact eligibility');
rollback to savepoint payout_unsent_receipt;
set local role service_role;
select is(public.service_finish_refund_manual_message_delivery(
 (select refund_case_message_id from payout_receipt_claim),
 (select claim_token from payout_receipt_claim),'sent','transactional_email',null,0,
 'sole_customer')->>'outcome','sent','Supported sender settles the existing provider acceptance');
reset role;
select ok((select m.manual_delivery_state='sent' and m.status='sent'
 and m.sent_at is not null and m.delivery_state='accepted'
 and c.status='waiting_on_customer' and c.decision is null
 and not public.refund_payout_destination_case_current(c)
 from public.refund_case_messages m join public.refund_cases c on c.id=m.refund_case_id
 where m.id=(select refund_case_message_id from payout_receipt_claim)),
 'The actual sent manual request is accepted while current payout-request eligibility is false');
create temporary table payout_receipt_before as select
 to_jsonb(c) case_json,
 to_jsonb(m)-'status'-'error_message'-'delivery_state'-'delivery_state_updated_at'
   immutable_message,
 (select jsonb_agg(to_jsonb(l) order by l.id) from public.refund_sunze_cash_sale_links l
   where l.refund_case_id=c.id) links,
 (select jsonb_agg(to_jsonb(e) order by e.id) from public.refund_case_events e
   where e.refund_case_id=c.id) events,
 (select count(*)::integer from public.refund_case_messages other where other.refund_case_id=c.id) messages
 from public.refund_cases c join public.refund_case_messages m on m.refund_case_id=c.id
 where m.id=(select refund_case_message_id from payout_receipt_claim);
set local role service_role;
select is(public.service_record_refund_transactional_delivery_event(
 repeat('8',64),'snapcase_payout_receipt_foreign','delivered',statement_timestamp(),
 '<foreign-receipt@example.invalid>')->>'matched','false',
 'A foreign provider receipt cannot bind the original request');
select is(pg_temp.error_state($call$select public.service_record_refund_transactional_delivery_event(
 repeat('7',64),'snapcase_payout_receipt_accepted','unknown',statement_timestamp(),
 '<payout-receipt@example.invalid>')$call$),'P4650',
 'Unknown provider state is not invented as a confirmed receipt');
select is(public.service_record_refund_transactional_delivery_event(
 repeat('6',64),'snapcase_payout_receipt_accepted','delivered',statement_timestamp(),
 '<payout-receipt@example.invalid>')->>'deliveryState','delivered',
 'Existing receipt writer reconciles the sent manual request without reopening contact eligibility');
reset role;
select ok((select m.delivery_state='delivered' and m.status='sent'
 and not public.refund_payout_destination_case_current(c)
 and to_jsonb(c)=b.case_json
 and to_jsonb(m)-'status'-'error_message'-'delivery_state'-'delivery_state_updated_at'
     -'transactional_provider_message_header'
   =b.immutable_message-'transactional_provider_message_header'
 and (select jsonb_agg(to_jsonb(l) order by l.id) from public.refund_sunze_cash_sale_links l
   where l.refund_case_id=c.id)=b.links
 and (select jsonb_agg(to_jsonb(e) order by e.id) from public.refund_case_events e
   where e.refund_case_id=c.id)=b.events
 and (select count(*)::integer from public.refund_case_messages other where other.refund_case_id=c.id)=b.messages
 from public.refund_cases c join public.refund_case_messages m on m.refund_case_id=c.id
 cross join payout_receipt_before b
 where m.id=(select refund_case_message_id from payout_receipt_claim)),
 'Only receipt truth/header changes; case, contact budget, selected evidence and message identity remain intact');
create temporary table payout_receipt_delivered as select to_jsonb(m) message_json
 from public.refund_case_messages m where m.id=(select refund_case_message_id from payout_receipt_claim);
set local role service_role;
select is(public.service_record_refund_transactional_delivery_event(
 repeat('6',64),'snapcase_payout_receipt_accepted','delivered',statement_timestamp(),
 '<payout-receipt@example.invalid>')->>'duplicate','true',
 'The same delivery receipt is idempotent without another provider attempt');
select public.service_record_refund_transactional_delivery_event(
 repeat('5',64),'snapcase_payout_receipt_accepted','accepted',statement_timestamp(),
 '<payout-receipt@example.invalid>');
reset role;
select is((select to_jsonb(m) from public.refund_case_messages m
 where m.id=(select refund_case_message_id from payout_receipt_claim)),
 (select message_json from payout_receipt_delivered),
 'Receipt replay and a lower-ranked accepted event cannot downgrade delivered truth');
select is(pg_temp.error_state($call$update public.refund_case_messages set body='Changed content'
 where id=(select refund_case_message_id from payout_receipt_claim)$call$),'23514',
 'Receipt parity cannot edit the sent content');
select is(pg_temp.error_state($call$update public.refund_case_messages set recipient_email='other@example.invalid'
 where id=(select refund_case_message_id from payout_receipt_claim)$call$),'23514',
 'Receipt parity cannot redirect the original recipient');
select is(pg_temp.error_state($call$update public.refund_case_messages set provider_message_id='different_receipt_provider'
 where id=(select refund_case_message_id from payout_receipt_claim)$call$),'23514',
 'Receipt parity cannot change provider identity');
select is(pg_temp.error_state($call$update public.refund_case_messages set delivery_state='accepted'
 where id=(select refund_case_message_id from payout_receipt_claim)$call$),'23514',
 'A direct lower-ranked state mutation is rejected');
select is(pg_temp.error_state($call$update public.refund_case_messages
 set delivery_state_updated_at=delivery_state_updated_at-interval '1 second'
 where id=(select refund_case_message_id from payout_receipt_claim)$call$),'23514',
 'A receipt cannot move its evidence timestamp backwards');
select is(pg_temp.error_state($call$update public.refund_case_messages
 set delivery_state='bounced',status='failed',error_message='transactional_delivery_bounced'
 where id=(select refund_case_message_id from payout_receipt_claim)$call$),'23514',
 'A higher-ranked state still requires an exact recorded provider event');
select is(pg_temp.error_state($call$update public.refund_case_messages
 set transactional_provider_message_header='<changed-receipt@example.invalid>'
 where id=(select refund_case_message_id from payout_receipt_claim)$call$),'23514',
 'A bound RFC Message-ID cannot be replaced by another header');
set local role service_role;
select is(pg_temp.error_state($call$select public.service_record_refund_transactional_delivery_event(
 repeat('3',64),'snapcase_payout_receipt_accepted','delivered',statement_timestamp(),
 '<changed-receipt@example.invalid>')$call$),'P4650',
 'The existing five-argument writer rejects conflicting provider headers atomically');
reset role;
set local role authenticated;
select is(pg_temp.error_state($call$select public.service_record_refund_transactional_delivery_event(
 repeat('4',64),'snapcase_payout_receipt_accepted','delivered',statement_timestamp(),
 '<payout-receipt@example.invalid>')$call$),'42501',
 'Receipt recording remains a service-only boundary');
reset role;
rollback to savepoint payout_receipt_contract;
savepoint payout_link_negative;
update public.refund_sunze_cash_sale_links set released_at=now(),release_reason='wrong_sale',
 released_by='16600000-0000-4000-8000-000000000001',released_case_fact_version=1
where refund_case_id='16617000-0000-4000-8000-000000000001';
select is(public.refund_purchase_correction_request_fields('16617000-0000-4000-8000-000000000001'),
 '{}'::text[],'Released reviewed link cannot lift the research hold');
rollback to savepoint payout_link_negative;
savepoint payout_conflict_negative;
update public.refund_sunze_cash_correlation_candidates set selection_conflict=true
where attempt_id=(select (result->>'attemptId')::uuid from cash_proof);
select is(public.refund_purchase_correction_request_fields('16617000-0000-4000-8000-000000000001'),
 '{}'::text[],'Conflicted candidate cannot lift the research hold');
rollback to savepoint payout_conflict_negative;
savepoint payout_attempt_negative;
update public.refund_sunze_cash_correlation_attempts set invalidated_at=now(),
 invalidation_reason='selected_sale_released'
where id=(select (result->>'attemptId')::uuid from cash_proof);
select is(public.refund_purchase_correction_request_fields('16617000-0000-4000-8000-000000000001'),
 '{}'::text[],'Invalidated attempt cannot lift the research hold');
rollback to savepoint payout_attempt_negative;
savepoint payout_fact_negative;
update public.refund_sunze_cash_sale_links set case_fact_version=2
where refund_case_id='16617000-0000-4000-8000-000000000001';
select is(public.refund_purchase_correction_request_fields('16617000-0000-4000-8000-000000000001'),
 '{}'::text[],'Stale reviewed-link fact cannot lift the research hold');
rollback to savepoint payout_fact_negative;
savepoint payout_review_negative;
update public.refund_sunze_cash_sale_links set link_origin='system_single_candidate'
where refund_case_id='16617000-0000-4000-8000-000000000001';
select is(public.refund_purchase_correction_request_fields('16617000-0000-4000-8000-000000000001'),
 '{}'::text[],'Automatic link alone cannot replace explicit reviewed cash evidence');
rollback to savepoint payout_review_negative;
select ok(public.refund_payout_destination_case_current(
 jsonb_populate_record(null::public.refund_cases,
  (select to_jsonb(c)||'{"decision":"approved","status":"cash_zelle_pending"}'::jsonb
   from public.refund_cases c where c.id='16617000-0000-4000-8000-000000000001'))),
 'Existing approved legacy cash payout eligibility is unchanged');
select is(public.service_select_sunze_cash_candidate(
 '16617000-0000-4000-8000-000000000001',(select (result->>'attemptId')::uuid from cash_proof),
 (select sales_fact_id from public.refund_sunze_cash_correlation_candidates where attempt_id=(select (result->>'attemptId')::uuid from cash_proof)),
 1,0,'16600000-0000-4000-8000-000000000001')->>'replayed','true','Same reviewed selection does not repeat writes');
select is(public.refund_decision_recommendation_for_case('16617000-0000-4000-8000-000000000001')->'purchase'->>'source','snapcase','Existing cash recommendation uses actual current reviewed purchase source');
select is(public.refund_decision_recommendation_for_case('16617000-0000-4000-8000-000000000001')->'purchase'->>'amountCents','1000','Recommendation preserves source amount rather than customer estimate');
select is((select count(*)::integer from public.refund_sunze_cash_sale_links where refund_case_id='16617000-0000-4000-8000-000000000001'),1,'Idempotent selection retains one existing sale link');
create temporary table projection_before as select to_jsonb(c) case_row,
 (select count(*) from public.refund_case_messages) message_count,
 (select count(*) from public.refund_manager_notification_actions) notification_count
 from public.refund_cases c where c.id='16617000-0000-4000-8000-000000000001';
create temporary table current_ready as select public.service_refund_manager_ready_notice_snapshot(
 '16617000-0000-4000-8000-000000000001','16600000-0000-4000-8000-000000000001') snapshot;
select ok((select snapshot->>'schemaVersion'='refund_manager_ready_notice_v2'
 and snapshot->>'actionCode'='approve_or_deny_request'
 and snapshot->>'evidenceBasis'='cash_multiple_reviewed'
 and snapshot->>'proofId'=(select result->>'attemptId' from cash_proof)
 and snapshot->>'officialActionVersion'=c.official_action_version::text
 and snapshot->>'deterministicFactVersion'=c.deterministic_fact_version::text
 and snapshot->>'amountCents'='1000' and snapshot->>'currencyCode'='USD'
 and snapshot->>'payloadRedacted'='true'
 from current_ready cross join public.refund_cases c
 where c.id='16617000-0000-4000-8000-000000000001'),
 'Reviewed SnapCase ready notice preserves exact proof, versions and full purchase amount');
select is(public.service_refund_manager_ready_notice_snapshot(
 '16617000-0000-4000-8000-000000000001','16600000-0000-4000-8000-000000000099'),
 null::jsonb,'An unassigned actor cannot obtain the exact Manager-ready snapshot');
select ok(exists(select 1 from jsonb_array_elements(
 public.refund_manager_daily_digest_projection_for('16600000-0000-4000-8000-000000000001')->'items') item
 where item->>'caseId'='16617000-0000-4000-8000-000000000001'
 and item->>'actionCode'='approve_or_deny_request'
 and item->>'evidenceBasis'='cash_multiple_reviewed' and item->>'amountCents'='1000'),
 'Daily digest consumes the same current reviewed SnapCase decision snapshot');
select ok((select to_jsonb(c)=b.case_row
 and (select count(*) from public.refund_case_messages)=b.message_count
 and (select count(*) from public.refund_manager_notification_actions)=b.notification_count
 from public.refund_cases c cross join projection_before b
 where c.id='16617000-0000-4000-8000-000000000001'),
 'Ready and digest projections leave the entire case and all message/notice rows unchanged');
update public.machine_sales_facts set raw_payload=jsonb_set(raw_payload,'{providerAccountId}',to_jsonb('wrong-account'::text)) where source='snapcase_cash' and raw_payload->>'sourceMachineId'='refund-cash-machine';
select throws_ok($case$select public.service_select_sunze_cash_candidate(
 '16617000-0000-4000-8000-000000000001',(select (result->>'attemptId')::uuid from cash_proof),
 (select sales_fact_id from public.refund_sunze_cash_correlation_candidates where attempt_id=(select (result->>'attemptId')::uuid from cash_proof)),
 1,1,'16600000-0000-4000-8000-000000000001')$case$,'40001','Stale Sunze candidate selection','Wrong provider account blocks current selection');
select is(public.service_get_sunze_cash_correlation('16617000-0000-4000-8000-000000000001','16600000-0000-4000-8000-000000000001')->>'selectedSalesFactId',null::text,'Wrong provider account hides stale selected evidence');
select is(public.refund_decision_recommendation_for_case('16617000-0000-4000-8000-000000000001')->'purchase',null::jsonb,'Wrong provider account cannot prepare a refund recommendation');
select is(public.service_refund_manager_ready_notice_snapshot('16617000-0000-4000-8000-000000000001','16600000-0000-4000-8000-000000000001'),null::jsonb,'Invalid current purchase proof also excludes a ready notice 1');
select is(public.refund_purchase_correction_request_fields('16617000-0000-4000-8000-000000000001'),
 '{}'::text[],'Wrong current source account cannot authorize a payout question');
update public.machine_sales_facts set raw_payload=jsonb_set(raw_payload,'{providerAccountId}',to_jsonb('16613000-0000-4000-8000-000000000001'::text)) where source='snapcase_cash' and raw_payload->>'sourceMachineId'='refund-cash-machine';
update public.machine_sales_facts set raw_payload=jsonb_set(raw_payload,'{sourceMachineId}',to_jsonb('wrong-device'::text)) where source='snapcase_cash' and raw_payload->>'sourcePaymentKey'=repeat('d',64);
select throws_ok($case$select public.service_select_sunze_cash_candidate(
 '16617000-0000-4000-8000-000000000001',(select (result->>'attemptId')::uuid from cash_proof),
 (select sales_fact_id from public.refund_sunze_cash_correlation_candidates where attempt_id=(select (result->>'attemptId')::uuid from cash_proof)),
 1,1,'16600000-0000-4000-8000-000000000001')$case$,'40001','Stale Sunze candidate selection','Wrong source device blocks current selection');
select is(public.service_get_sunze_cash_correlation('16617000-0000-4000-8000-000000000001','16600000-0000-4000-8000-000000000001')->>'selectedSalesFactId',null::text,'Wrong source device hides stale selected evidence');
select is(public.refund_decision_recommendation_for_case('16617000-0000-4000-8000-000000000001')->'purchase',null::jsonb,'Wrong source device cannot prepare a refund recommendation');
select is(public.service_refund_manager_ready_notice_snapshot('16617000-0000-4000-8000-000000000001','16600000-0000-4000-8000-000000000001'),null::jsonb,'Invalid current purchase proof also excludes a ready notice 2');
update public.machine_sales_facts set raw_payload=jsonb_set(raw_payload,'{sourceMachineId}',to_jsonb('refund-cash-machine'::text)) where source='snapcase_cash' and raw_payload->>'sourcePaymentKey'=repeat('d',64);
update private.snapcase_source_machines set source_timezone='America/Chicago' where source_machine_id='refund-cash-machine';
select throws_ok($case$select public.service_select_sunze_cash_candidate(
 '16617000-0000-4000-8000-000000000001',(select (result->>'attemptId')::uuid from cash_proof),
 (select sales_fact_id from public.refund_sunze_cash_correlation_candidates where attempt_id=(select (result->>'attemptId')::uuid from cash_proof)),
 1,1,'16600000-0000-4000-8000-000000000001')$case$,'40001','Stale Sunze candidate selection','Unproved source clock blocks current selection');
select is(public.service_get_sunze_cash_correlation('16617000-0000-4000-8000-000000000001','16600000-0000-4000-8000-000000000001')->>'selectedSalesFactId',null::text,'Unproved source clock hides stale selected evidence');
select is(public.refund_decision_recommendation_for_case('16617000-0000-4000-8000-000000000001')->'purchase',null::jsonb,'Unproved source clock cannot prepare a refund recommendation');
select is(public.service_refund_manager_ready_notice_snapshot('16617000-0000-4000-8000-000000000001','16600000-0000-4000-8000-000000000001'),null::jsonb,'Invalid current purchase proof also excludes a ready notice 3');
update private.snapcase_source_machines set source_timezone='America/Los_Angeles' where source_machine_id='refund-cash-machine';
update private.snapcase_machine_mappings set effective_end_date='2026-09-19' where source_machine_id='refund-cash-machine';
select throws_ok($case$select public.service_select_sunze_cash_candidate(
 '16617000-0000-4000-8000-000000000001',(select (result->>'attemptId')::uuid from cash_proof),
 (select sales_fact_id from public.refund_sunze_cash_correlation_candidates where attempt_id=(select (result->>'attemptId')::uuid from cash_proof)),
 1,1,'16600000-0000-4000-8000-000000000001')$case$,'40001','Stale Sunze candidate selection','Mapping outside occurrence date blocks current selection');
select is(public.service_get_sunze_cash_correlation('16617000-0000-4000-8000-000000000001','16600000-0000-4000-8000-000000000001')->>'selectedSalesFactId',null::text,'Mapping outside occurrence date hides stale selected evidence');
select is(public.refund_decision_recommendation_for_case('16617000-0000-4000-8000-000000000001')->'purchase',null::jsonb,'Mapping outside occurrence date cannot prepare a refund recommendation');
select is(public.service_refund_manager_ready_notice_snapshot('16617000-0000-4000-8000-000000000001','16600000-0000-4000-8000-000000000001'),null::jsonb,'Invalid current purchase proof also excludes a ready notice 4');
update private.snapcase_machine_mappings set effective_end_date=null where source_machine_id='refund-cash-machine';
update private.snapcase_sales_observations set revision_digest=repeat('f',64) where source_machine_id='refund-cash-machine';
select throws_ok($case$select public.service_select_sunze_cash_candidate(
 '16617000-0000-4000-8000-000000000001',(select (result->>'attemptId')::uuid from cash_proof),
 (select sales_fact_id from public.refund_sunze_cash_correlation_candidates where attempt_id=(select (result->>'attemptId')::uuid from cash_proof)),
 1,1,'16600000-0000-4000-8000-000000000001')$case$,'40001','Stale Sunze candidate selection','New unpublished payment revision blocks current selection');
select is(public.service_get_sunze_cash_correlation('16617000-0000-4000-8000-000000000001','16600000-0000-4000-8000-000000000001')->>'selectedSalesFactId',null::text,'New unpublished payment revision hides stale selected evidence');
select is(public.refund_decision_recommendation_for_case('16617000-0000-4000-8000-000000000001')->'purchase',null::jsonb,'New unpublished payment revision cannot prepare a refund recommendation');
select is(public.service_refund_manager_ready_notice_snapshot('16617000-0000-4000-8000-000000000001','16600000-0000-4000-8000-000000000001'),null::jsonb,'Invalid current purchase proof also excludes a ready notice 5');
select is(public.refund_purchase_correction_request_fields('16617000-0000-4000-8000-000000000001'),
 '{}'::text[],'Stale publication cannot authorize a payout question');
update private.snapcase_sales_observations set revision_digest=repeat('e',64) where source_machine_id='refund-cash-machine';
update public.machine_sales_facts set raw_payload=jsonb_set(raw_payload,'{publicationState}',to_jsonb('superseded'::text)) where source='snapcase_cash' and raw_payload->>'sourceMachineId'='refund-cash-machine';
select throws_ok($case$select public.service_select_sunze_cash_candidate(
 '16617000-0000-4000-8000-000000000001',(select (result->>'attemptId')::uuid from cash_proof),
 (select sales_fact_id from public.refund_sunze_cash_correlation_candidates where attempt_id=(select (result->>'attemptId')::uuid from cash_proof)),
 1,1,'16600000-0000-4000-8000-000000000001')$case$,'40001','Stale Sunze candidate selection','Superseded publication blocks current selection');
select is(public.service_get_sunze_cash_correlation('16617000-0000-4000-8000-000000000001','16600000-0000-4000-8000-000000000001')->>'selectedSalesFactId',null::text,'Superseded publication hides stale selected evidence');
select is(public.refund_decision_recommendation_for_case('16617000-0000-4000-8000-000000000001')->'purchase',null::jsonb,'Superseded publication cannot prepare a refund recommendation');
select is(public.service_refund_manager_ready_notice_snapshot('16617000-0000-4000-8000-000000000001','16600000-0000-4000-8000-000000000001'),null::jsonb,'Invalid current purchase proof also excludes a ready notice 6');
update public.machine_sales_facts set raw_payload=jsonb_set(raw_payload,'{publicationState}',to_jsonb('active'::text)) where source='snapcase_cash' and raw_payload->>'sourceMachineId'='refund-cash-machine';
update private.snapcase_sales_observations set normalized_tender='card',source_tender_code='0' where source_machine_id='refund-cash-machine';
select throws_ok($case$select public.service_select_sunze_cash_candidate(
 '16617000-0000-4000-8000-000000000001',(select (result->>'attemptId')::uuid from cash_proof),
 (select sales_fact_id from public.refund_sunze_cash_correlation_candidates where attempt_id=(select (result->>'attemptId')::uuid from cash_proof)),
 1,1,'16600000-0000-4000-8000-000000000001')$case$,'40001','Stale Sunze candidate selection','Current payment is not cash blocks current selection');
select is(public.service_get_sunze_cash_correlation('16617000-0000-4000-8000-000000000001','16600000-0000-4000-8000-000000000001')->>'selectedSalesFactId',null::text,'Current payment is not cash hides stale selected evidence');
select is(public.refund_decision_recommendation_for_case('16617000-0000-4000-8000-000000000001')->'purchase',null::jsonb,'Current payment is not cash cannot prepare a refund recommendation');
select is(public.service_refund_manager_ready_notice_snapshot('16617000-0000-4000-8000-000000000001','16600000-0000-4000-8000-000000000001'),null::jsonb,'Invalid current purchase proof also excludes a ready notice 7');
update private.snapcase_sales_observations set normalized_tender='cash',source_tender_code='1' where source_machine_id='refund-cash-machine';
update public.machine_sales_facts set source_row_hash=repeat('f',64) where source='snapcase_cash' and raw_payload->>'sourceMachineId'='refund-cash-machine';
select throws_ok($case$select public.service_select_sunze_cash_candidate(
 '16617000-0000-4000-8000-000000000001',(select (result->>'attemptId')::uuid from cash_proof),
 (select sales_fact_id from public.refund_sunze_cash_correlation_candidates where attempt_id=(select (result->>'attemptId')::uuid from cash_proof)),
 1,1,'16600000-0000-4000-8000-000000000001')$case$,'40001','Stale Sunze candidate selection','Changed publication digest blocks current selection');
select is(public.service_get_sunze_cash_correlation('16617000-0000-4000-8000-000000000001','16600000-0000-4000-8000-000000000001')->>'selectedSalesFactId',null::text,'Changed publication digest hides stale selected evidence');
select is(public.refund_decision_recommendation_for_case('16617000-0000-4000-8000-000000000001')->'purchase',null::jsonb,'Changed publication digest cannot prepare a refund recommendation');
select is(public.service_refund_manager_ready_notice_snapshot('16617000-0000-4000-8000-000000000001','16600000-0000-4000-8000-000000000001'),null::jsonb,'Invalid current purchase proof also excludes a ready notice 8');
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
update public.reporting_machine_refund_managers set status='revoked'
 where manager_user_id='16600000-0000-4000-8000-000000000001';
select throws_ok($case$select public.service_select_sunze_cash_candidate(
 '16617000-0000-4000-8000-000000000001',(select (result->>'attemptId')::uuid from cash_proof),
 (select sales_fact_id from public.refund_sunze_cash_correlation_candidates where attempt_id=(select (result->>'attemptId')::uuid from cash_proof)),
 1,1,'16600000-0000-4000-8000-000000000001')$case$,'42501','Authorized refund manager actor required','Current selecting actor scope still required');
update public.admin_roles set active=true where user_id='16600000-0000-4000-8000-000000000001';
update public.reporting_machine_refund_managers set status='active'
 where manager_user_id='16600000-0000-4000-8000-000000000001';
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
select is(public.service_refund_manager_ready_notice_snapshot('16617000-0000-4000-8000-000000000001','16600000-0000-4000-8000-000000000001'),null::jsonb,'Invalid current purchase proof also excludes a ready notice 9');
select is(public.refund_purchase_correction_request_fields('16617000-0000-4000-8000-000000000001'),
 '{}'::text[],'Changed source and venue clock cannot authorize a payout question');
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
select ok(public.refund_current_sunze_cash_source_key('16612000-0000-4000-8000-000000000002','2026-09-20T19:00:36Z') not like 'snapcase:%','Out-of-window mapping does not claim the source');
-- These two generations must have distinct chronology even when the runner
-- executes the fixture in one statement timestamp.
select is(public.service_correlate_sunze_cash_case('16617000-0000-4000-8000-000000000001',1,'backfill',null,statement_timestamp()+interval '1 second')->>'candidateCount','1','Dormant SnapCase mapping preserves grounded Sunze positive research');
select ok(exists(select 1 from public.refund_sunze_cash_correlation_candidates candidate join public.refund_sunze_cash_correlation_attempts attempt on attempt.id=candidate.attempt_id where attempt.refund_case_id='16617000-0000-4000-8000-000000000001' and candidate.sales_fact_id='16619100-0000-4000-8000-000000000001'),'Sunze positive is retained on its exact source');
select is(public.refund_purchase_correction_request_fields('16617000-0000-4000-8000-000000000001'),
 '{}'::text[],'Changing to new grounded Sunze evidence requires a fresh reviewed selection');
-- Existing limitation under #1429/#628: positive-only Sunze research uses a
-- positive snapshot key that the current preparation source-key helper does not
-- reproduce. Retain the candidate without claiming reviewed preparation parity.
select is(public.refund_manager_preparation_snapshot(
 '16617000-0000-4000-8000-000000000001',
 (select official_action_version from public.refund_cases where id='16617000-0000-4000-8000-000000000001')),
 null::jsonb,'Unvalidated Sunze positive retains the existing preparation source-key limitation');
select is(public.service_refund_manager_ready_notice_snapshot(
 '16617000-0000-4000-8000-000000000001','16600000-0000-4000-8000-000000000001'),
 null::jsonb,'Unvalidated Sunze positive cannot borrow ready-notice authority');

-- Separate current, clock-validated Sunze proof exercises the same bounded
-- payout exception without changing the positive-only source contract above.
insert into public.reporting_machines(id,account_id,location_id,machine_label,machine_type,status,sunze_machine_id)
values('16612000-0000-4000-8000-000000000003','16610000-0000-4000-8000-000000000001',
 '16611000-0000-4000-8000-000000000001','Validated cash fixture','commercial','active','SUNZE-PAYOUT-VALIDATED');
insert into public.refund_cases(
 id,public_reference,reporting_machine_id,reporting_location_id,customer_email,
 issue_summary,incident_at,incident_local_datetime,incident_timezone,incident_time_resolution,
 payment_method,payment_amount_cents,status,correlation_status,correlation_source,
 correlation_summary,cash_match_evaluated_fact_version
) values (
 '16617000-0000-4000-8000-000000000002','RF-SUNZE-PAYOUT-TEST',
 '16612000-0000-4000-8000-000000000003','16611000-0000-4000-8000-000000000001',
 'sunze-payout@example.invalid','Validated reviewed cash fixture',
 '2026-09-20T19:00:36Z','2026-09-20 12:00:36','America/Los_Angeles','exact',
 'cash',900,'needs_review','no_match','sunze','Historical no safe match.',1
);
insert into public.refund_follow_up_cycles(
 id,refund_case_id,cycle_number,trigger_fingerprint,reason_code,requested_fields,
 template_version,case_fact_version,reminder_delay_hours,status
)
select '16618000-0000-4000-8000-000000000002',c.id,1,repeat('c',64),
 'no_safe_match','{}'::text[],settings.template_version,
 c.deterministic_fact_version,settings.reminder_delay_hours,'claimed'
from public.refund_cases c cross join public.refund_customer_contact_settings settings
where c.id='16617000-0000-4000-8000-000000000002';
update public.refund_follow_up_cycles set status='manual_review',
 failed_at=statement_timestamp(),failure_code='request_claim_abandoned'
where id='16618000-0000-4000-8000-000000000002';
insert into public.sales_import_runs(id,source,status,rows_seen,rows_imported,meta,completed_at)
values('16619000-0000-4000-8000-000000000002','sunze_browser','completed',1,1,
 '{"github_run_id":"validated-payout-fixture","payment_time_semantics_status":"validated","payment_time_timezone":"America/Los_Angeles","timestamp_proof_scope":"account","machine_coverage_verified":true,"visible_machine_count_mismatch":false}',statement_timestamp());
insert into public.sunze_cash_source_watermarks(
 reporting_machine_id,coverage_started_at,covered_through,last_successful_import_at,
 freshness_expires_at,payment_time_basis,payment_time_timezone,timestamp_proof_scope,import_run_id
) values (
 '16612000-0000-4000-8000-000000000003','2026-09-20T18:00:00Z','2026-09-20T20:01:00Z',
 statement_timestamp(),statement_timestamp()+interval '1 day','validated_iana_timezone',
 'America/Los_Angeles','account','16619000-0000-4000-8000-000000000002'
);
insert into public.machine_sales_facts(id,reporting_machine_id,reporting_location_id,sale_date,payment_method,net_sales_cents,transaction_count,source,source_row_hash,source_order_hash,import_run_id,payment_time,source_payment_status,raw_payload)
values('16619100-0000-4000-8000-000000000002','16612000-0000-4000-8000-000000000003','16611000-0000-4000-8000-000000000001','2026-09-20','cash',950,1,'sunze_browser','validated-payout-row','validated-payout-order','16619000-0000-4000-8000-000000000002','2026-09-20T19:00:00Z','Payment success','{"payment_time_iso":"2026-09-20T19:00:00.000Z"}');
create temporary table validated_sunze_proof as select
 public.service_correlate_sunze_cash_case('16617000-0000-4000-8000-000000000002',1,'backfill') result;
select is((select result->>'candidateCount' from validated_sunze_proof),'1','Validated Sunze source supplies its exact current candidate');
select is(public.refund_purchase_correction_request_fields('16617000-0000-4000-8000-000000000002'),
 '{}'::text[],'Automatic single-candidate linkage does not lift the historical hold without review');
select is(public.service_select_sunze_cash_candidate(
 '16617000-0000-4000-8000-000000000002',
 (select (result->>'attemptId')::uuid from validated_sunze_proof),
 '16619100-0000-4000-8000-000000000002',1,
 (select coalesce(max(link_version),0) from public.refund_sunze_cash_sale_links where refund_case_id='16617000-0000-4000-8000-000000000002'),
 '16600000-0000-4000-8000-000000000001')->>'selected','true',
 'Validated current Sunze purchase accepts explicit reviewed selection');
select is(public.refund_purchase_correction_request_fields('16617000-0000-4000-8000-000000000002'),
 array['zelle_payment_contact'],'Current reviewed validated Sunze proof also exposes only the missing payout field');
select * from finish(true);
rollback;
