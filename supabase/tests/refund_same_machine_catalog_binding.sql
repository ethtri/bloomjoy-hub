-- Disposable synthetic fixture. No customer/provider identity is used.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data)
values('ac710000-0000-4000-8000-000000000001','authenticated','authenticated',
  'catalog-manager@example.invalid','{}','{}');
insert into public.customer_accounts(id,name,account_type) values
('ac720000-0000-4000-8000-000000000001','Catalog source fixture','internal'),
('ac720000-0000-4000-8000-000000000002','Catalog current fixture','internal');
insert into public.reporting_locations(id,account_id,name,city,state,timezone) values
('ac730000-0000-4000-8000-000000000001','ac720000-0000-4000-8000-000000000001',
  'Same physical fixture','Pittsburgh','PA','America/New_York'),
('ac730000-0000-4000-8000-000000000002','ac720000-0000-4000-8000-000000000002',
  'Same physical fixture',null,null,'America/Los_Angeles');
insert into public.reporting_machines(id,account_id,location_id,machine_label,status,
  nayax_machine_id,nayax_account_key,nayax_refunds_enabled,nayax_manual_portal_enabled)
values('ac740000-0000-4000-8000-000000000001','ac720000-0000-4000-8000-000000000001',
  'ac730000-0000-4000-8000-000000000001','Exact catalog fixture','active',
  'CATALOG-FIXTURE-IMMUTABLE','default',true,false);
insert into public.refund_nayax_machine_inventory(account_key,nayax_machine_id,
  reporting_machine_id,provider_is_active,reconciliation_state,refund_category)
values('default','CATALOG-FIXTURE-IMMUTABLE','ac740000-0000-4000-8000-000000000001',true,'published','snapcase');
insert into public.refund_cases(id,public_reference,reporting_machine_id,reporting_location_id,
  customer_email,issue_summary,incident_at,incident_local_datetime,incident_timezone,
  incident_time_resolution,payment_method,payment_amount_cents,refund_amount_cents,card_last4,
  status,decision,decision_reason,decided_by,decided_at,correlation_status,correlation_source,
  nayax_lookup_generation,nayax_lookup_status,nayax_lookup_started_at,nayax_lookup_finished_at,
  nayax_lookup_correlation_digest,nayax_recommendation_state,nayax_recommendation_policy_version,
  nayax_refund_execution_status,created_at,intake_selection_kind,intake_selection_key,
  intake_selection_machine_ids,customer_request_received_at,customer_request_received_source)
values('ac750000-0000-4000-8000-000000000001','RF-CATALOG-RESEARCH-FIXTURE',
  'ac740000-0000-4000-8000-000000000001','ac730000-0000-4000-8000-000000000001',
  'catalog-customer@example.invalid','Synthetic exact-machine request',
  statement_timestamp()-interval '8 hours',
  to_char((statement_timestamp()-interval '8 hours') at time zone 'America/New_York','YYYY-MM-DD"T"HH24:MI'),
  'America/New_York','exact','card',963,963,'4242','needs_review','approved',
  'Saved decision without a payment','ac710000-0000-4000-8000-000000000001',statement_timestamp()-interval '2 hours',
  'manual_review','nayax',3,'manual_exception',statement_timestamp()-interval '4 hours',
  statement_timestamp()-interval '3 hours',repeat('a',64),'manual_exception','automatic-lookup-v1',
  'not_requested',statement_timestamp()-interval '7 hours','exact_machine',
  public.refund_public_selection_key('machine|ac740000-0000-4000-8000-000000000001'),
  array['ac740000-0000-4000-8000-000000000001'::uuid],
  statement_timestamp()-interval '7 hours','hosted_refund_intake');
create temporary table original_case as select * from public.refund_cases
  where id='ac750000-0000-4000-8000-000000000001';
create temporary table original_machine as select * from public.reporting_machines
  where id='ac740000-0000-4000-8000-000000000001';
update public.reporting_machines set account_id='ac720000-0000-4000-8000-000000000002',
  location_id='ac730000-0000-4000-8000-000000000002'
  where id='ac740000-0000-4000-8000-000000000001';
select isnt(public.service_refund_location_binding_correction_context(
  'ac750000-0000-4000-8000-000000000001')->>'eligible','true',
  'Same location name without immutable machine-move evidence is insufficient');
insert into public.admin_audit_log(actor_user_id,action,entity_type,entity_id,before,after,meta)
select 'ac710000-0000-4000-8000-000000000001','reporting_machine.upserted','reporting_machine',
  m.id::text,to_jsonb(o),to_jsonb(m),'{}'::jsonb
from public.reporting_machines m cross join original_machine o where m.id=o.id;
create temporary table reviewed_context as select public.service_refund_location_binding_correction_context(
  'ac750000-0000-4000-8000-000000000001') value;
select is((select value->>'eligible' from reviewed_context),'true',
  'Audited move of the exact intake machine permits reviewed catalog normalization');
savepoint stale_catalog;
update public.reporting_locations set city='Different city'
  where id='ac730000-0000-4000-8000-000000000002';
select throws_ok($$select public.service_correct_refund_location_binding(
  'ac750000-0000-4000-8000-000000000001',(select value->>'caseDigest' from reviewed_context),
  (select official_action_version from original_case),(select deterministic_fact_version from original_case),
  'ac740000-0000-4000-8000-000000000001','ac730000-0000-4000-8000-000000000001',true)$$,
  'P4681','Exact reviewed catalog-move context required','Changed catalog makes a reviewed snapshot stale');
rollback to stale_catalog;
create temporary table corrected as select public.service_correct_refund_location_binding(
  'ac750000-0000-4000-8000-000000000001',(select value->>'caseDigest' from reviewed_context),
  (select official_action_version from original_case),(select deterministic_fact_version from original_case),
  'ac740000-0000-4000-8000-000000000001','ac730000-0000-4000-8000-000000000001',true) value;
select is((select value->>'status' from corrected),'corrected','Existing correction path repairs the catalog binding');
select ok((select c.incident_at=o.incident_at and c.incident_local_datetime=o.incident_local_datetime
  and c.incident_timezone=o.incident_timezone and c.reporting_machine_id=o.reporting_machine_id
  and c.intake_selection_key=o.intake_selection_key and c.intake_selection_machine_ids=o.intake_selection_machine_ids
  and c.decision=o.decision and c.decided_by=o.decided_by and c.decided_at=o.decided_at
  and c.decision_reason=o.decision_reason and c.refund_amount_cents=o.refund_amount_cents
  from public.refund_cases c cross join original_case o where c.id=o.id),
  'Original occurrence, intake and exact saved decision remain unchanged');
select is((select timezone from public.reporting_locations
  where id='ac730000-0000-4000-8000-000000000002'),'America/New_York',
  'The new empty catalog inherits the proven original venue clock');
select is(public.service_correct_refund_location_binding(
  'ac750000-0000-4000-8000-000000000001',(select value->>'caseDigest' from reviewed_context),
  (select official_action_version from original_case),(select deterministic_fact_version from original_case),
  'ac740000-0000-4000-8000-000000000001','ac730000-0000-4000-8000-000000000001',true)->>'status',
  'already_corrected','Retry acknowledges the exact already-applied correction without a second event');
select is((select count(*)::integer from public.refund_due_approved_card_nayax_research()
  where refund_case_id='ac750000-0000-4000-8000-000000000001'),1,
  'The reset lookup is due through the existing saved-approval read-only selector');
set local role service_role;
create temporary table claimed as select public.service_claim_due_approved_card_nayax_research(4) value;
select is((select nayax_lookup_status from public.refund_cases
  where id='ac750000-0000-4000-8000-000000000001'),'checking',
  'One existing atomic claim actually starts the fresh read');
select is((select nayax_lookup_generation from public.refund_cases
  where id='ac750000-0000-4000-8000-000000000001'),4::bigint,
  'One claim advances exactly one generation');
select is(jsonb_array_length(public.service_claim_due_approved_card_nayax_research(4)),0,
  'Repeated sweep cannot repeat the current generation');
reset role;
select is((select count(*)::integer from public.refund_case_nayax_refund_attempts
  where refund_case_id='ac750000-0000-4000-8000-000000000001'),0,'No payment attempt is created');
select is((select count(*)::integer from public.refund_case_messages
  where refund_case_id='ac750000-0000-4000-8000-000000000001'),0,'No customer message is created');
select * from finish();
rollback;
