begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data)
values ('fa410000-0000-4000-8000-000000000001','authenticated','authenticated','lookup-manager@example.invalid','{}','{}'),
  ('fa410000-0000-4000-8000-000000000002','authenticated','authenticated','outside-manager@example.invalid','{}','{}');
insert into public.customer_accounts(id,name,account_type)
values ('fa420000-0000-4000-8000-000000000001','Approved lookup fixture','internal');
insert into public.reporting_locations(id,account_id,name,timezone)
values ('fa430000-0000-4000-8000-000000000001','fa420000-0000-4000-8000-000000000001','Lookup fixture','America/New_York');
insert into public.reporting_machines(id,account_id,location_id,machine_label,status,nayax_machine_id,nayax_account_key,nayax_refunds_enabled)
values ('fa440000-0000-4000-8000-000000000001','fa420000-0000-4000-8000-000000000001',
  'fa430000-0000-4000-8000-000000000001','Lookup fixture','active','APPROVED-LOOKUP-MACHINE','APPROVED-LOOKUP-ACCOUNT',true);
insert into public.reporting_machine_refund_managers(reporting_machine_id,manager_user_id,manager_email,grant_reason)
values ('fa440000-0000-4000-8000-000000000001','fa410000-0000-4000-8000-000000000001','lookup-manager@example.invalid','Lookup fixture');

create function pg_temp.case_id(n integer) returns uuid language sql immutable as $$
  select ('fa450000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid;
$$;
insert into public.refund_cases(id,public_reference,reporting_machine_id,reporting_location_id,customer_email,
  issue_summary,incident_at,incident_timezone,payment_method,payment_amount_cents,refund_amount_cents,card_last4,
  status,decision,decision_reason,decided_by,decided_at,correlation_status,correlation_source,deterministic_fact_version,
  nayax_refund_execution_status,matched_nayax_transaction_id,duplicate_of_refund_case_id,refund_completed_at,
  customer_request_received_at,customer_request_received_source,incident_time_resolution,incident_time_confidence)
select pg_temp.case_id(n),'RF-APPROVED-LOOKUP-'||n,'fa440000-0000-4000-8000-000000000001',
  'fa430000-0000-4000-8000-000000000001','lookup-customer@example.invalid','Synthetic approved lookup',
  now()-interval '2 days','America/New_York',case when n=8 then 'cash' else 'card' end,963,963,'4242',
  case when n=3 then 'denied' when n=4 then 'completed' when n=10 then 'approved' else 'needs_review' end,
  case when n=3 then 'denied' when n=9 then null else 'approved' end,'Ordinary manager decision',
  'fa410000-0000-4000-8000-000000000001',now()-interval '1 day','no_match','nayax',1,
  'not_requested',
  case when n=7 then 'EXISTING-ORIGINAL-0007' else null end,
  case when n=6 then pg_temp.case_id(1) else null end,
  case when n in(4,11) then now()-interval '1 hour' else null end,
  now()-interval '1 day','hosted_refund_intake','exact','exact'
from generate_series(1,19) n;

-- Active triggers remain enabled. These retained historical records distinguish
-- an unattempted approved case from a payment whose outcome requires inspection.
insert into public.refund_case_nayax_refund_attempts(refund_case_id,execution_mode,status,idempotency_key,amount_cents,
  provider_outcome,provider_outcome_recorded_at,reconciliation_required)
values (pg_temp.case_id(5),'preflight','manual_review','approved-lookup-unknown',963,'unknown',now(),true);
insert into public.refund_authoritative_receipts(refund_case_id,reporting_machine_id,account_scope,provider_machine_id,
  original_transaction_id,original_amount_cents,refunded_amount_cents,currency_code,provider_status,
  evidence_reference_digest,recorded_by,attempt_binding_kind,current_provider_observation_reviewed)
values (pg_temp.case_id(2),'fa440000-0000-4000-8000-000000000001','APPROVED-LOOKUP-ACCOUNT','APPROVED-LOOKUP-MACHINE',
  'RECEIPT-ORIGINAL-0002',963,963,'USD',62,repeat('a',64),'fa410000-0000-4000-8000-000000000001',
  'no_attempt_integrity_hold',true);

create temp table approval_before as select id,decision,decision_reason,decided_by,decided_at,refund_amount_cents,
  deterministic_fact_version from public.refund_cases where id=pg_temp.case_id(1);
create function pg_temp.begin_lookup(n integer, actor uuid default 'fa410000-0000-4000-8000-000000000001',
  version bigint default 1, source text default 'manual') returns jsonb language sql as $$
  select public.service_begin_refund_nayax_lookup(pg_temp.case_id(n),version,source,actor);
$$;
create function pg_temp.commit_lookup(n integer, generation bigint, version bigint default 1) returns jsonb language sql as $$
  select public.service_commit_refund_nayax_lookup(pg_temp.case_id(n),generation,version,'no_match','no_safe_match',
    'approved-lookup-fixture-v1',statement_timestamp(),'Synthetic bounded read result',null,0,'manual',
    'fa410000-0000-4000-8000-000000000001');
$$;
select set_config('request.jwt.claim.sub','fa410000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claims','{"sub":"fa410000-0000-4000-8000-000000000001","role":"authenticated","is_anonymous":false}',true);

select ok(has_function_privilege('service_role','public.service_begin_refund_nayax_lookup(uuid,bigint,text,uuid)','execute')
  and not has_function_privilege('authenticated','public.service_begin_refund_nayax_lookup(uuid,bigint,text,uuid)','execute')
  and not has_function_privilege('anon','public.service_begin_refund_nayax_lookup(uuid,bigint,text,uuid)','execute')
  and not has_function_privilege('service_role','public.service_begin_refund_nayax_lookup_pre_scope_recovery_v1(uuid,bigint,text,uuid)','execute'),
  'Only the existing service wrapper exposes the approved lookup continuation');

set local role service_role;
select throws_ok($$select pg_temp.begin_lookup(1,'fa410000-0000-4000-8000-000000000002')$$,'42501',null,'Another manager cannot look up this approved case');
select throws_ok($$select pg_temp.begin_lookup(1,null)$$,'P4622',null,'Approved continuation requires an explicit scoped manager');
select throws_ok($$select pg_temp.begin_lookup(1,version=>2)$$,'P4621',null,'Old fact authority cannot begin a new lookup');
select throws_ok($$select pg_temp.begin_lookup(1,source=>'automatic')$$,'P4622',null,'This bounded change adds no automatic approved-case lookup');
select throws_ok($$select pg_temp.begin_lookup(2)$$,'P4622',null,'An authoritative receipt prevents lookup rebinding');
select throws_ok($$select pg_temp.begin_lookup(3)$$,'P4622',null,'A denied case stays denied');
select throws_ok($$select pg_temp.begin_lookup(4)$$,'P4622',null,'Completed payment cannot be refreshed into unpaid review');
select throws_ok($$select pg_temp.begin_lookup(5)$$,'P4622',null,'An uncertain existing attempt must be inspected instead of rebinding');
select throws_ok($$select pg_temp.begin_lookup(6)$$,'P4622',null,'A recorded duplicate does not receive this continuation');
select throws_ok($$select pg_temp.begin_lookup(7)$$,'P4622',null,'An already selected original remains immutable to lookup continuation');
select throws_ok($$select pg_temp.begin_lookup(8)$$,'P4622',null,'Cash does not enter Nayax transaction lookup');
select throws_ok($$select pg_temp.begin_lookup(11)$$,'P4622',null,'Historical completion evidence wins over a stale review status');
select is(pg_temp.begin_lookup(1)->>'status','checking','Ordinarily approved unpaid case starts a bounded read');
select throws_ok($$select pg_temp.begin_lookup(1)$$,'P4622',null,'A second request observing the locked checking state cannot dispatch another read');
select is(pg_temp.commit_lookup(1,0)->>'stale','true','An older lookup result cannot overwrite the active generation');
select is(pg_temp.commit_lookup(1,1)->>'applied','true','Current read results commit through the unchanged result writer');
select is(pg_temp.begin_lookup(9,null,1,'automatic')->>'status','checking','The existing undecided automatic lookup remains available');
select is(pg_temp.begin_lookup(10)->>'status','checking','Approved status also supports the same unpaid manual continuation');
reset role;

select ok(not exists(select 1 from approval_before b join public.refund_cases c using(id)
  where row(c.decision,c.decision_reason,c.decided_by,c.decided_at,c.refund_amount_cents,c.deterministic_fact_version)
  is distinct from row(b.decision,b.decision_reason,b.decided_by,b.decided_at,b.refund_amount_cents,b.deterministic_fact_version)),
  'Begin and commit preserve exact approval, approver, time, amount and fact version');
select ok((select nayax_lookup_generation=1 and nayax_lookup_status='no_match' and matched_nayax_transaction_id is null
  and not nayax_match_execution_eligible and nayax_refund_execution_status='not_requested'
  from public.refund_cases where id=pg_temp.case_id(1)),'A completed read grants no payment or matching authority');
select is((select count(*)::integer from public.refund_case_events where refund_case_id=pg_temp.case_id(1)
  and event_type='nayax_lookup_started'),1,'Rejected and duplicate begins create no additional dispatch record');
select is((select count(*)::integer from public.refund_case_nayax_refund_attempts where refund_case_id=pg_temp.case_id(1)),0,'Lookup creates no payment attempt');
select is((select count(*)::integer from public.refund_case_messages where refund_case_id=pg_temp.case_id(1)),0,'Lookup sends and queues no customer message');

-- Actual current candidate writer and selection wrapper. Existing readiness
-- supports full refunds, so another amount must not silently replace approval.
create function pg_temp.prepare_candidate(n integer, original_amount integer) returns uuid language plpgsql as $$
declare token_id uuid:=gen_random_uuid(); generation bigint; provider_delta integer;
begin
  generation := (pg_temp.begin_lookup(n)->>'lookupGeneration')::bigint;
  select ceil(abs(extract(epoch from
    (date_trunc('second',now()-interval '2 days')-incident_at)))/60.0)::integer
  into provider_delta from public.refund_cases where id=pg_temp.case_id(n);
  insert into public.refund_nayax_lookup_candidates(token,refund_case_id,lookup_generation,actor_user_id,reporting_machine_id,
    provider_transaction_id,site_id,machine_authorization_time,amount_cents,card_last4,currency_code,evidence_summary,expires_at)
  values(token_id,pg_temp.case_id(n),generation,'fa410000-0000-4000-8000-000000000001','fa440000-0000-4000-8000-000000000001',
    (823456780+n)::text,6,date_trunc('second',now()-interval '2 days'),original_amount,'4242','USD',
    jsonb_build_object(
      'selection_allowed',true,'is_recommended',true,'one_click_eligible',true,
      'recommendation_state','high_confidence','policy_version','2026-09-05.v11',
      'identifier_policy_version','2026-09-05.identifier.v2','customer_fact_version',1,
      'customer_credential_class','customer_identifier_unknown',
      'provider_identifier_class','last_sales_identifier_unknown',
      'card_last4_comparison','exact_support','card_network_comparison','missing',
      'payment_interaction_comparison','unknown','same_identifier_equivalence_proven',false,
      'identifier_review_state','exact_support','customer_correction_fields','[]'::jsonb,
      'hard_exclusions','[]'::jsonb,'reason_codes','[]'::jsonb,
      'lookup_account_scope','APPROVED_LOOKUP_ACCOUNT','lookup_provider_machine_id','APPROVED-LOOKUP-MACHINE',
      'provider_machine_id','APPROVED-LOOKUP-MACHINE','machine_authorization_time_raw',
        to_char(date_trunc('second',now()-interval '2 days') at time zone 'America/New_York','YYYY-MM-DD"T"HH24:MI:SS'),
      'machine_authorization_at',date_trunc('second',now()-interval '2 days'),
      'machine_authorization_time_source','MachineAuthorizationTime','machine_time_resolution','exact',
      'provider_time_resolution','exact',
      'provider_time_source','authorization_gmt','authorized_at',date_trunc('second',now()-interval '2 days'),
      'customer_request_received_at',now()-interval '1 day',
      'customer_request_received_source','hosted_refund_intake',
      'request_time_boundary','before_or_at_request','transaction_occurrence_comparable',true,
      'transaction_occurrence_semantics','online_purchase_occurrence',
      'transaction_occurrence_proof_source','verified_provider_purchase_occurrence_v1',
      'transaction_occurrence_timestamp_source','authorization_gmt',
      'transaction_occurrence_timezone_basis','utc',
      'transaction_occurrence_lower_bound_at',date_trunc('second',now()-interval '2 days'),
      'transaction_occurrence_upper_bound_at',date_trunc('second',now()-interval '2 days'),
      'request_receipt_lower_bound_at',now()-interval '1 day',
      'request_receipt_upper_bound_at',now()-interval '1 day',
      'payment_status','approved','payment_status_evidence','last_sales_contract',
      'provider_refund_state','clear','duplicate_provider_record',false,
      'amount_delta_cents',abs(original_amount-963),'time_delta_minutes',provider_delta,
      'provider_processing_time_delta_minutes',provider_delta
    ),now()+interval '1 hour');
  perform public.service_commit_refund_nayax_lookup(pg_temp.case_id(n),generation,1,'match_found','high_confidence',
    '2026-09-05.v11',now(),'Synthetic exact candidate',null,1,'manual','fa410000-0000-4000-8000-000000000001');
  return token_id;
end;
$$;
create temp table selection_tokens as select 12 n,pg_temp.prepare_candidate(12,963) token
  union all select 13,pg_temp.prepare_candidate(13,1200)
  union all select 14,pg_temp.prepare_candidate(14,800);
create temp table selection_approvals_before as select id,decision,decision_reason,decided_by,decided_at,refund_amount_cents
  from public.refund_cases where id in (pg_temp.case_id(12),pg_temp.case_id(13),pg_temp.case_id(14));
grant select on selection_tokens to service_role;
create function pg_temp.select_candidate(p_n integer) returns jsonb language sql as $$
  select public.service_select_refund_nayax_candidate_as_actor('fa410000-0000-4000-8000-000000000001',c.id,
    c.official_action_version,t.token,null)
  from public.refund_cases c join selection_tokens t on t.n=p_n where c.id=pg_temp.case_id(p_n);
$$;
set local role service_role;
select is(pg_temp.select_candidate(12)->>'selectionApplied','true','Exact original selection preserves existing full approval');
select throws_ok($$select pg_temp.select_candidate(13)$$,'P4604',null,'A larger original cannot silently expand the existing full-refund contract');
select is(pg_temp.select_candidate(12)->>'selectionApplied','false','Exact selection replay creates no second confirmation');
select throws_ok($$select pg_temp.select_candidate(14)$$,'P4604',null,'A smaller original cannot silently change or exceed the approved amount');
reset role;
select ok(not exists(select 1 from selection_approvals_before b join public.refund_cases c using(id)
  where row(c.decision,c.decision_reason,c.decided_by,c.decided_at,c.refund_amount_cents)
  is distinct from row(b.decision,b.decision_reason,b.decided_by,b.decided_at,b.refund_amount_cents)),
  'Successful selection and rejected amount changes keep approved decision, reason, actor, date and amount');
select is(public.refund_case_nayax_manager_readiness('fa410000-0000-4000-8000-000000000001',pg_temp.case_id(12))->>'canIssueCardRefund',
  'true','Selected approved purchase reaches the existing manager refund path without reapproval');

-- Decisions/outcomes can progress while a provider read is in flight without
-- changing deterministic matching facts. Their authority wins over late reads.
select pg_temp.begin_lookup(n) from generate_series(15,19) n;
update public.refund_cases set nayax_lookup_started_at=statement_timestamp()-interval '2 minutes'
  where id in(pg_temp.case_id(15),pg_temp.case_id(16),pg_temp.case_id(17),pg_temp.case_id(18),pg_temp.case_id(19));
update public.refund_cases set decision='denied',status='denied' where id=pg_temp.case_id(15);
insert into public.refund_authoritative_receipts(refund_case_id,reporting_machine_id,account_scope,provider_machine_id,
  original_transaction_id,original_amount_cents,refunded_amount_cents,currency_code,provider_status,
  evidence_reference_digest,recorded_by,attempt_binding_kind,current_provider_observation_reviewed)
values(pg_temp.case_id(16),'fa440000-0000-4000-8000-000000000001','APPROVED-LOOKUP-ACCOUNT','APPROVED-LOOKUP-MACHINE',
  'RECEIPT-ORIGINAL-0016',963,963,'USD',62,repeat('b',64),'fa410000-0000-4000-8000-000000000001','no_attempt_integrity_hold',true);
insert into public.refund_case_nayax_refund_attempts(refund_case_id,execution_mode,status,idempotency_key,amount_cents,
  provider_outcome,provider_outcome_recorded_at,reconciliation_required)
values(pg_temp.case_id(17),'preflight','manual_review','approved-lookup-late-unknown',963,'unknown',now(),true);
update public.refund_cases set card_last4='1234' where id=pg_temp.case_id(18);
create temp table late_cases_before as select id,to_jsonb(c) snapshot from public.refund_cases c
  where id in (pg_temp.case_id(15),pg_temp.case_id(16),pg_temp.case_id(17),pg_temp.case_id(18));
set local role service_role;
select is(pg_temp.commit_lookup(15,1)->>'stale','true','A late read cannot reopen a subsequently denied case');
select is(pg_temp.commit_lookup(16,1)->>'stale','true','A receipt arriving during lookup prevents any late read mutation');
select is(pg_temp.commit_lookup(17,1)->>'stale','true','An uncertain attempt arriving during lookup keeps its reconciliation ownership');
select is(pg_temp.commit_lookup(18,1)->>'stale','true','New matching facts reject a late approved lookup result');
select is(public.service_fail_refund_nayax_lookup(pg_temp.case_id(15),1,1,'timeout',true,'manual','fa410000-0000-4000-8000-000000000001')->>'stale',
  'true','A late timeout cannot reopen a subsequently denied case');
select is(public.service_fail_refund_nayax_lookup(pg_temp.case_id(16),1,1,'timeout',true,'manual','fa410000-0000-4000-8000-000000000001')->>'stale',
  'true','A late timeout cannot mutate a case with a new authoritative receipt');
select is(public.service_fail_refund_nayax_lookup(pg_temp.case_id(17),1,1,'timeout',true,'manual','fa410000-0000-4000-8000-000000000001')->>'stale',
  'true','A late timeout cannot mutate a case with a new uncertain attempt');
select is(public.service_fail_refund_nayax_lookup(pg_temp.case_id(18),1,1,'timeout',true,'manual','fa410000-0000-4000-8000-000000000001')->>'stale',
  'true','A late timeout cannot overwrite newer matching facts');
select is(public.service_recover_stale_refund_nayax_lookups()->>'recoveredCount','1',
  'Interrupted-read recovery touches only the still-eligible stale lookup');
reset role;
select ok(not exists(select 1 from late_cases_before b join public.refund_cases c using(id) where b.snapshot is distinct from to_jsonb(c)),
  'Late rejected results preserve all current decision, payment and matching state');
select ok((select nayax_lookup_status='lookup_failed' and nayax_lookup_failure_class='worker_interrupted'
  and nayax_lookup_safe_retry_eligible and decision='approved' from public.refund_cases where id=pg_temp.case_id(19)),
  'Eligible interrupted lookup retains approval and the existing safe read retry');
select is((select count(*)::integer from public.refund_case_nayax_refund_attempts where refund_case_id in(pg_temp.case_id(12),pg_temp.case_id(13))),0,
  'Selection and amount rejection perform no payment');
select ok(not exists(select 1 from public.refund_cases where id in(pg_temp.case_id(13),pg_temp.case_id(14))
  and matched_nayax_transaction_id is not null),'Different amounts remain unbound for internal review');

select * from finish();
rollback;
