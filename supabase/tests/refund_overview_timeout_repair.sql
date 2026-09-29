begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();

create function pg_temp.set_auth_claims(p_user_id uuid)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub',p_user_id::text,true);
  perform set_config('request.jwt.claim.role','authenticated',true);
  perform set_config('request.jwt.claims',jsonb_build_object(
    'sub',p_user_id,'role','authenticated','is_anonymous',false)::text,true);
end $$;

select ok(strpos(pg_get_functiondef(
    'public.refund_decision_recommendation_for_case(uuid,timestamptz)'::regprocedure),
    'A rejection needs 30 elapsed days')>0,
  'recommendation projection has the guarded young-case rejection bound');
select ok(strpos(pg_get_functiondef(
    'public.admin_get_refund_operations_overview_pre_lookup_recovery_v1()'::regprocedure),
    'refund_customer_correction_fields_v1')>0,
  'correction parity emits its exact contract marker');
select ok(strpos(pg_get_functiondef(
    'public.refund_project_nayax_lookup_recovery_cases_for_manager(jsonb,boolean)'::regprocedure),
    'refund_project_lookup_work_pre_setwise_v1')>0,
  'lookup recovery retains its exact case-owned delegate');
select ok(strpos(pg_get_functiondef(
    'public.refund_project_customer_outreach_cases_for_manager(jsonb,boolean)'::regprocedure),
    'refund_project_outreach_pre_setwise_v1')>0,
  'customer outreach retains its exact fail-closed delegate');
select ok(strpos(pg_get_functiondef(
    'public.refund_project_lifecycle_v2_cases(jsonb)'::regprocedure),
    'refund_project_lifecycle_pre_setwise_reuse_v1')>0,
  'lifecycle reuse retains its exact fail-closed delegate');
select ok(strpos(pg_get_functiondef(
    'public.admin_get_refund_operations_overview_pre_manager_lifecycle_v1()'
      ::regprocedure),
    'refund_lifecycle_contract_pre_manager_queue_truth_v1(refund_case.id)')>0
  and strpos(pg_get_functiondef(
    'public.admin_get_refund_operations_overview_pre_manager_lifecycle_v1()'
      ::regprocedure),
    'public.refund_lifecycle_contract(refund_case.id)')=0,
  'durable overview stage reuses its retained lifecycle before v2 projection');
select ok(strpos(pg_get_functiondef(
    'public.admin_get_refund_operations_overview()'::regprocedure),
    'admin_refund_overview_pre_reconcile_v1')>0
  and strpos(pg_get_functiondef(
    'public.admin_get_refund_operations_overview()'::regprocedure),
    'refund_case_has_unresolved_reconciliation')>0,
  'final overview validates current next-work contracts before reuse');
select ok(strpos(pg_get_functiondef(
    'public.refund_project_current_next_work_cases(jsonb)'::regprocedure),
    'refund_project_next_work_pre_identity_repair_v1')>0,
  'next-work reuse retains its exact fail-closed delegate');
select ok((select proconfig @> array['statement_timeout=20s','work_mem=32MB']
    from pg_proc where oid=
      'public.admin_get_refund_operations_overview()'::regprocedure),
  'overview has a function-scoped production runtime and memory budget');

insert into auth.users(
  instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values
  ('00000000-0000-0000-0000-000000000000','a9600000-0000-4000-8000-000000000001',
   'authenticated','authenticated','overview-admin@example.invalid','',now(),'{}','{}',now(),now()),
  ('00000000-0000-0000-8000-000000000000','a9600000-0000-4000-8000-000000000002',
   'authenticated','authenticated','overview-manager-two@example.invalid','',now(),'{}','{}',now(),now()),
  ('00000000-0000-0000-8000-000000000000','a9600000-0000-4000-8000-000000000003',
   'authenticated','authenticated','overview-manager-three@example.invalid','',now(),'{}','{}',now(),now());
insert into public.admin_roles(user_id,role,active)
values('a9600000-0000-4000-8000-000000000001','super_admin',true);
insert into public.customer_accounts(id,name,account_type)
values('a9610000-0000-4000-8000-000000000001','Overview benchmark account','internal');
insert into public.reporting_locations(id,account_id,name,timezone)
values('a9620000-0000-4000-8000-000000000001',
  'a9610000-0000-4000-8000-000000000001','Overview benchmark location',
  'America/Los_Angeles');
insert into public.reporting_machines(
  id,account_id,location_id,machine_label,refund_public_display_label)
values
  ('a9630000-0000-4000-8000-000000000001',
   'a9610000-0000-4000-8000-000000000001',
   'a9620000-0000-4000-8000-000000000001','Overview private one','Overview one'),
  ('a9630000-0000-4000-8000-000000000002',
   'a9610000-0000-4000-8000-000000000001',
   'a9620000-0000-4000-8000-000000000001','Overview private two','Overview two');
insert into public.reporting_machine_refund_managers(
  id,reporting_machine_id,manager_user_id,manager_email,grant_reason)
values
  ('a9640000-0000-4000-8000-000000000001',
   'a9630000-0000-4000-8000-000000000001',
   'a9600000-0000-4000-8000-000000000001',
   'overview-admin@example.invalid','Overview benchmark'),
  ('a9640000-0000-4000-8000-000000000002',
   'a9630000-0000-4000-8000-000000000001',
   'a9600000-0000-4000-8000-000000000002',
   'overview-manager-two@example.invalid','Overview benchmark'),
  ('a9640000-0000-4000-8000-000000000003',
   'a9630000-0000-4000-8000-000000000002',
   'a9600000-0000-4000-8000-000000000003',
   'overview-manager-three@example.invalid','Overview benchmark');

-- Reproduce the current production volume and the rejection-shaped subset:
-- 10 multiple matches, 2 no matches, 14 setup failures, 4 lookup failures,
-- 2 untouched card cases, 8 unavailable cash cases, and 38 cheap card cases.
insert into public.refund_cases(
  id,public_reference,reporting_machine_id,reporting_location_id,
  customer_email,issue_summary,incident_at,payment_method,payment_amount_cents,
  status,correlation_status,correlation_source,automation_state,
  deterministic_fact_version,created_at,nayax_lookup_generation,
  nayax_lookup_status,nayax_recommendation_state,
  nayax_recommendation_policy_version,nayax_lookup_correlation_digest,
  cash_match_state,cash_match_evaluated_fact_version)
select md5('refund-overview-bench-case-'||n)::uuid,
  'RF-OVERVIEW-'||lpad(n::text,4,'0'),
  case when n<=74 then 'a9630000-0000-4000-8000-000000000001'::uuid
    else 'a9630000-0000-4000-8000-000000000002'::uuid end,
  'a9620000-0000-4000-8000-000000000001',
  'overview-customer-'||n||'@example.invalid','Private overview benchmark case',
  statement_timestamp()-interval '2 days',
  case when n between 33 and 40 then 'cash' else 'card' end,
  case when n=11 then null else 500 end,'needs_review',
  case when n between 33 and 40 then 'manual_review' else 'needs_nayax' end,
  case when n between 33 and 40 then 'sunze' else 'nayax' end,
  'under_review',1,statement_timestamp()-interval '2 days',
  case when n<=12 then 1 else 0 end,
  case when n<=10 then 'multiple_matches'
    when n<=12 then 'no_match'
    when n<=26 then 'setup_needed'
    when n<=30 then 'lookup_failed'
    else 'not_started' end,
  case when n<=10 then 'ambiguous'
    when n<=12 then 'no_safe_match' else null end,
  case when n<=12 then '2026-09-05.v11' else null end,
  case when n<=12 then repeat('a',64) else null end,
  case when n between 33 and 40 then 'sales_history_unavailable' else null end,
  case when n between 33 and 40 then 1 else null end
from generate_series(1,78) n;

insert into public.refund_case_events(refund_case_id,event_type,message,metadata,created_at)
select md5('refund-overview-bench-case-'||n)::uuid,'nayax_lookup_started',
  'Read-only benchmark lookup started',jsonb_build_object(
    'lookup_generation',1,'deterministic_fact_version',1,
    'trigger_source','scheduled','provider_call_kind','read_only',
    'payload_redacted',true),statement_timestamp()-interval '1 day 1 minute'
from generate_series(1,12) n;

-- One current untouched card has enough exact evidence for the unchanged
-- case-owned lookup helper to assign System work. Contract reuse must preserve
-- its control suppression rather than treating it as an inert recovery row.
update public.refund_cases
set card_last4='1234',card_last4_provenance='physical_card',
    incident_time_resolution='exact',incident_time_confidence='exact'
where id=md5('refund-overview-bench-case-31')::uuid;
insert into public.refund_case_events(refund_case_id,event_type,message,metadata,created_at)
select md5('refund-overview-bench-case-'||n)::uuid,'nayax_lookup_completed',
  'Read-only benchmark lookup completed',jsonb_build_object(
    'lookup_generation',1,'deterministic_fact_version',1,
    'lookup_status',case when n<=10 then 'multiple_matches' else 'no_match' end,
    'recommendation_state',case when n<=10 then 'ambiguous' else 'no_safe_match' end,
    'policy_version','2026-09-05.v11','correlation_digest',repeat('a',64),
    'trigger_source','scheduled','payload_redacted',true),
  statement_timestamp()-interval '1 day'
from generate_series(1,12) n;

select is((select count(*)::text from public.refund_cases c
    join public.reporting_machine_refund_managers m
      on m.reporting_machine_id=c.reporting_machine_id
      and m.status='active' and m.revoked_at is null
    where c.public_reference like 'RF-OVERVIEW-%'),'152',
  'overview benchmark contains the production-sized 152 mappings for 78 cases');
select is(public.refund_decision_recommendation_for_case(
    md5('refund-overview-bench-case-1')::uuid)::text,null::text,
  'a two-day multiple-match case is rejection-ineligible after purchase evaluation');
select is(public.refund_decision_recommendation_for_case(
    md5('refund-overview-bench-case-11')::uuid)::text,null::text,
  'a two-day no-match case is rejection-ineligible after purchase evaluation');

set local role authenticated;
select pg_temp.set_auth_claims('a9600000-0000-4000-8000-000000000001');
set local statement_timeout='30s';
select lives_ok($test$
  select public.admin_get_refund_operations_overview()
$test$,'production-shaped authenticated overview completes within its bounded runtime budget');
create temporary table current_overview on commit drop as
select public.admin_get_refund_operations_overview() value;
select is((select value->>'customerCorrectionFieldsContractVersion'
    from current_overview),'refund_customer_correction_fields_v1',
  'overview publishes the correction-field authority used by recovery reuse');
select is((select count(*)::text
    from current_overview o
    cross join lateral jsonb_array_elements(
      coalesce(o.value->'cases','[]'::jsonb)
      ||coalesce(o.value->'internalTestCases','[]'::jsonb)) item
    where jsonb_typeof(item->'customerCorrectionFields')='array'),
  (select count(*)::text
    from current_overview o
    cross join lateral jsonb_array_elements(
      coalesce(o.value->'cases','[]'::jsonb)
      ||coalesce(o.value->'internalTestCases','[]'::jsonb)) item),
  'ordinary and Internal/test items carry authoritative correction arrays');
reset role;
select ok((select
    public.refund_project_current_next_work_cases(value->'cases')
      is not distinct from value->'cases'
    and public.refund_project_current_next_work_cases(value->'internalTestCases')
      is not distinct from value->'internalTestCases'
    from current_overview),
  'current next-work and recommendation contracts are reused exactly in both collections');
select ok((select
    public.refund_project_lifecycle_v2_cases(
      value->'cases'||value->'internalTestCases')
      is not distinct from
    public.refund_project_lifecycle_pre_setwise_reuse_v1(
      value->'cases'||value->'internalTestCases')
    from current_overview),
  'set-wise lifecycle reuse is byte-for-byte equal to the retained projector at production-sized volume');
select ok((select
    public.refund_project_nayax_lookup_recovery_cases_for_manager(
      value->'cases'||value->'internalTestCases',true)
      is not distinct from
    public.refund_project_lookup_work_pre_setwise_v1(
      value->'cases'||value->'internalTestCases',true)
    from current_overview),
  'set-wise lookup-work projection preserves the complete ordered collection');
select ok((select
    public.refund_project_customer_outreach_cases_for_manager(
      value->'cases'||value->'internalTestCases',true)
      is not distinct from
    public.refund_project_outreach_pre_setwise_v1(
      value->'cases'||value->'internalTestCases',true)
    from current_overview),
  'set-wise outreach projection preserves the complete ordered collection');
select ok((select
    public.refund_project_current_next_work_cases(
      value->'cases'||value->'internalTestCases')
      is not distinct from
    public.refund_project_next_work_pre_setwise_v1(
      value->'cases'||value->'internalTestCases')
    from current_overview),
  'set-wise next-work validation preserves the complete ordered collection');
select ok((with stale_lookup as (
    select jsonb_build_array(jsonb_build_object(
      'id',c.id,'officialActionVersion',c.official_action_version,
      'nayaxLookupWork',jsonb_build_object('state','complete'),
      'lifecycle',jsonb_set(jsonb_set(public.refund_lifecycle_contract(c.id),
        '{nextWork,actor}','"system"'::jsonb,true),
        '{nextWork,actionCode}','"run_lookup"'::jsonb,true))) payload
    from public.refund_cases c
    where c.id=md5('refund-overview-bench-case-32')::uuid
  ) select
    public.refund_project_next_work_pre_identity_repair_v1(payload)
      #>>'{0,lifecycle,nextWork,actionCode}'='run_lookup'
    and public.refund_project_current_next_work_cases(payload)
      #>>'{0,lifecycle,nextWork,actionCode}'='research_purchase'
    and ((public.refund_project_current_next_work_cases(payload)
      #>'{0,lifecycle}')-'nextWork') is not distinct from
      ((public.refund_project_next_work_pre_identity_repair_v1(payload)
      #>'{0,lifecycle}')-'nextWork')
    from stale_lookup),
  'stale System lookup work repairs only nextWork from current case truth');
savepoint overview_lookup_claim_parity;
insert into public.refund_case_reconciliation_reviews(
  id,left_refund_case_id,right_refund_case_id,match_class,reason_codes,
  left_fact_fingerprint,right_fact_fingerprint)
select 'a9680000-0000-4000-8000-000000000001',least(left_case,right_case),
  greatest(left_case,right_case),'possible',array['customer_email_exact'],
  repeat('d',64),repeat('e',64)
from (select md5('refund-overview-bench-case-31')::uuid left_case,
             md5('refund-overview-bench-case-32')::uuid right_case) fixture;
select ok((with projected_system as (
    select jsonb_build_object(
      'id',c.id,'officialActionVersion',c.official_action_version,
      'lifecycle',jsonb_set(jsonb_set(public.refund_lifecycle_contract(c.id),
        '{nextWork,actor}','"system"'::jsonb,true),
        '{nextWork,actionCode}','"run_lookup"'::jsonb,true)) payload,
      public.refund_lifecycle_contract(c.id)->'nextWork' canonical_next_work
    from public.refund_cases c
    where c.id=md5('refund-overview-bench-case-31')::uuid
  ) select
    public.refund_case_has_unresolved_reconciliation(
      md5('refund-overview-bench-case-31')::uuid)
    and public.refund_project_nayax_lookup_recovery_cases_for_manager(
      jsonb_build_array(payload),true)#>>'{0,nayaxLookupWork,state}'='system'
    and public.refund_project_current_next_work_cases(
      jsonb_build_array(payload))#>'{0,lifecycle,nextWork}'
      is not distinct from canonical_next_work
    and public.refund_project_current_next_work_cases(
      jsonb_build_array(payload))#>>'{0,lifecycle,nextWork,actionCode}'
      is distinct from 'run_lookup'
    from projected_system),
  'unresolved reconciliation cannot be presented as executable System lookup work');
select ok((select exists(
    select 1
    from jsonb_array_elements(
      coalesce(value->'cases','[]'::jsonb)
      ||coalesce(value->'internalTestCases','[]'::jsonb)) item
    where item->>'id'=md5('refund-overview-bench-case-31')::uuid::text
      and item#>>'{lifecycle,nextWork,actor}'='agent'
      and item#>>'{lifecycle,nextWork,actionCode}'='research_purchase'
      and item#>>'{lifecycle,nextWork,actionLabel}'=
        'Research the purchase and prepare the next safe step.'
      and item#>'{lifecycle,nextWork,blocker}'='null'::jsonb)
  from (select public.admin_get_refund_operations_overview() value) overview),
  'final overview cannot reintroduce System lookup after reconciliation exclusion');
rollback to savepoint overview_lookup_claim_parity;
select is(public.refund_project_current_next_work_cases('{}'::jsonb),
  '{}'::jsonb,
  'next-work keeps its prior non-array identity contract');
select throws_like($test$
  select public.refund_project_lifecycle_v2_cases('{}'::jsonb)
$test$,'%cannot extract elements%',
  'malformed lifecycle input still fails through the retained projector');
select ok((select bool_and(
    public.refund_project_lifecycle_v2_cases(jsonb_build_array(
      jsonb_set(item,'{lifecycle,stage}',to_jsonb(stage_name),true)))
      is not distinct from
    public.refund_project_lifecycle_pre_setwise_reuse_v1(jsonb_build_array(
      jsonb_set(item,'{lifecycle,stage}',to_jsonb(stage_name),true))))
    from current_overview o
    cross join lateral jsonb_array_elements(o.value->'cases') item
    cross join unnest(array[
      'needs_transaction_selection','transaction_confirmed','awaiting_payout'
    ]::text[]) stage_name
    limit 3),
  'selection and payout stages keep the full canonical lifecycle fallback');
select ok((select
    public.refund_project_lifecycle_v2_cases(jsonb_build_array(
      jsonb_set(item,'{officialActionVersion}','-1'::jsonb,true)))
      is not distinct from
    public.refund_project_lifecycle_pre_setwise_reuse_v1(jsonb_build_array(
      jsonb_set(item,'{officialActionVersion}','-1'::jsonb,true)))
    from current_overview o
    cross join lateral jsonb_array_elements(o.value->'cases') item
    limit 1),
  'a stale official-action version falls back to the retained lifecycle projector');
select is((select
    public.refund_project_customer_outreach_cases_for_manager(
      jsonb_build_array(jsonb_set(item,
        '{lifecycle,customerOutreach,failureCode}',
        '"private_failure"'::jsonb,true)),false)
      #>>'{0,lifecycle,customerOutreach,failureCode}'
    from current_overview o
    cross join lateral jsonb_array_elements(
      o.value->'cases'||o.value->'internalTestCases') item
    where item#>>'{nayaxLookupWork,state}' in ('complete','refund_operations')
    limit 1),null::text,
  'non-operations projection still redacts the outreach failure code');
select ok((select item#>>'{nayaxLookupWork,state}'='system'
      and item->>'canSelectNayaxCandidate'='false'
      and item#>>'{lifecycle,managerAction,action}'='none'
      and item#>>'{lifecycle,lookup,status}'='checking'
      and item#>>'{lifecycle,nextWork,actionCode}'='run_lookup'
    from current_overview o
    cross join lateral jsonb_array_elements(
      coalesce(o.value->'cases','[]'::jsonb)
      ||coalesce(o.value->'internalTestCases','[]'::jsonb)) item
    where item->>'id'=md5('refund-overview-bench-case-31')::uuid::text),
  'non-complete lookup work retains the unchanged System/control-suppression projection');
select ok((select
    public.refund_project_customer_outreach_cases_for_manager(
      jsonb_build_array(item),true)
      is not distinct from public.refund_project_outreach_pre_reuse_v1(
        jsonb_build_array(item),true)
    from current_overview o
    cross join lateral jsonb_array_elements(
      coalesce(o.value->'cases','[]'::jsonb)
      ||coalesce(o.value->'internalTestCases','[]'::jsonb)) item
    where item#>>'{nayaxLookupWork,state}'='complete'
    limit 1),
  'reuse-eligible outreach is byte-for-byte equal to the retained prior projector');
select ok((select
    public.refund_project_customer_outreach_cases_for_manager(
      jsonb_build_array(item),true)
      is not distinct from public.refund_project_outreach_pre_reuse_v1(
        jsonb_build_array(item),true)
    from current_overview o
    cross join lateral jsonb_array_elements(
      coalesce(o.value->'cases','[]'::jsonb)
      ||coalesce(o.value->'internalTestCases','[]'::jsonb)) item
    where item#>>'{nayaxLookupWork,state}'='refund_operations'
    limit 1),
  'Refund Operations lookup ownership also preserves exact outreach projection');
select ok((select
    public.refund_project_current_next_work_cases(jsonb_build_array(item))->0
      is not distinct from jsonb_set(item,'{lifecycle}',
        public.refund_next_work_for_case((item->>'id')::uuid,
          (item->'lifecycle')-'nextWork'-'decisionRecommendation'),true)
    from current_overview o
    cross join lateral jsonb_array_elements(
      coalesce(o.value->'cases','[]'::jsonb)
      ||coalesce(o.value->'internalTestCases','[]'::jsonb)) item
    where item#>>'{nayaxLookupWork,state}'='complete'
    limit 1),
  'reuse-eligible next work is byte-for-byte equal to fresh canonical projection');
select ok((select
    public.refund_project_current_next_work_cases(jsonb_build_array(item))->0
      is not distinct from jsonb_set(item,'{lifecycle}',
        public.refund_next_work_for_case((item->>'id')::uuid,
          (item->'lifecycle')-'nextWork'-'decisionRecommendation'),true)
    from current_overview o
    cross join lateral jsonb_array_elements(
      coalesce(o.value->'cases','[]'::jsonb)
      ||coalesce(o.value->'internalTestCases','[]'::jsonb)) item
    where item#>>'{nayaxLookupWork,state}'='refund_operations'
    limit 1),
  'Refund Operations next work is byte-for-byte equal to fresh canonical projection');
select ok((select
    public.refund_project_current_next_work_cases(jsonb_build_array(
      jsonb_set(item,'{lifecycle,nextWork,schemaVersion}',
        '"stale_next_work"'::jsonb,true)))->0
      ->'lifecycle'->'nextWork'->>'schemaVersion'='refund_next_work_v1'
    from current_overview o
    cross join lateral jsonb_array_elements(
      coalesce(o.value->'cases','[]'::jsonb)
      ||coalesce(o.value->'internalTestCases','[]'::jsonb)) item
    limit 1),
  'a stale next-work contract falls back to canonical recomputation');
select ok((select
    public.refund_project_current_next_work_cases(jsonb_build_array(
      jsonb_set(jsonb_set(jsonb_set(item,
        '{lifecycle,decisionRecommendation}',jsonb_build_object(
          'schemaVersion','refund_decision_recommendation_v1',
          'officialActionVersion',item->'officialActionVersion',
          'deterministicFactVersion',
            item#>'{lifecycle,customerOutreach,caseFactVersion}',
          'kind','reject','reasonCode','no_match_after_30_days',
          'purchase',null,'decisionReady',true,'payloadRedacted',true),true),
        '{lifecycle,nextWork,actor}','"agent"'::jsonb,true),
        '{lifecycle,nextWork,actionCode}',
        '"resolve_manager_assignment"'::jsonb,true)))->0
      ->'lifecycle'->'decisionRecommendation'='null'::jsonb
    from current_overview o
    cross join lateral jsonb_array_elements(
      coalesce(o.value->'cases','[]'::jsonb)
      ||coalesce(o.value->'internalTestCases','[]'::jsonb)) item
    where item#>>'{nayaxLookupWork,state}'='complete'
    limit 1),
  'an inconsistent recommendation readiness and actor contract is recomputed');
select ok((select
    public.refund_project_customer_outreach_cases_for_manager(
      jsonb_build_array(jsonb_set(item,
        '{lifecycle,customerOutreach,caseFactVersion}','-1'::jsonb,true)),true)
      ->0->'lifecycle'->'customerOutreach'->>'caseFactVersion'
        is distinct from '-1'
    from current_overview o
    cross join lateral jsonb_array_elements(
      coalesce(o.value->'cases','[]'::jsonb)
      ||coalesce(o.value->'internalTestCases','[]'::jsonb)) item
    limit 1),
  'a stale outreach fact version falls back to canonical recomputation');

-- Preserve an imported/anomalous historical cycle. Its message row is young,
-- but its immutable cycle delivery time predates the case. The shortcut must
-- fail open and let the full outreach contract prove the 30-day rejection.
update public.refund_customer_contact_settings
set automatic_customer_contact_enabled=true where singleton;
create temporary table imported_cycle on commit drop as
select (public.service_claim_refund_follow_up_cycle(
  md5('refund-overview-bench-case-11')::uuid,'missing_information',
  'refund_follow_up_v2',repeat('b',64),null)#>>'{cycle,id}')::uuid id;
insert into public.refund_case_messages(
  id,refund_case_id,message_type,status,recipient_email,subject,body,
  content_source,delivery_kind,reason_code,template_version,
  follow_up_cycle_id,requested_fields,sent_at)
select 'a9650000-0000-4000-8000-000000000001',
  md5('refund-overview-bench-case-11')::uuid,'more_info','sent',
  'overview-customer-11@example.invalid','Historical imported question',
  'Please reply with the amount.','deterministic_template','automatic',
  cycle.reason_code,cycle.template_version,cycle.id,cycle.requested_fields,
  statement_timestamp()
from imported_cycle imported
join public.refund_follow_up_cycles cycle on cycle.id=imported.id;
insert into public.refund_gmail_threads(
  id,refund_case_id,mailbox_hash,provider_thread_id,thread_subject,
  first_message_at,latest_message_at,retention_expires_at)
values('a9660000-0000-4000-8000-000000000001',
  md5('refund-overview-bench-case-11')::uuid,repeat('c',64),
  'overview-imported-thread','Historical imported question',
  statement_timestamp(),statement_timestamp(),
  statement_timestamp()+interval '90 days');
insert into public.refund_gmail_messages(
  id,gmail_thread_id,refund_case_id,refund_case_message_id,provider_message_id,
  direction,message_kind,status,sender_email,recipient_email,subject,plain_body,
  received_at,sent_at,retention_expires_at,participant_role,participant_trust)
values('a9670000-0000-4000-8000-000000000001',
  'a9660000-0000-4000-8000-000000000001',
  md5('refund-overview-bench-case-11')::uuid,
  'a9650000-0000-4000-8000-000000000001','overview-imported-provider-message',
  'outbound','message','sent','refunds@example.invalid',
  'overview-customer-11@example.invalid','Historical imported question',
  'Please reply with the amount.',statement_timestamp(),statement_timestamp(),
  statement_timestamp()+interval '90 days','mailbox','verified');
alter table public.refund_follow_up_cycles
  disable trigger refund_follow_up_cycles_guard;
update public.refund_follow_up_cycles
set request_created_at=statement_timestamp()-interval '31 days',
    request_sent_at=statement_timestamp()-interval '31 days'
where id=(select id from imported_cycle);
alter table public.refund_follow_up_cycles
  enable trigger refund_follow_up_cycles_guard;
select is(public.refund_decision_recommendation_for_case(
    md5('refund-overview-bench-case-11')::uuid)->>'kind','reject',
  'an older imported cycle reaches the full causal 30-day rejection proof');
select ok((select projected#>>'{lifecycle,nextWork,actor}'='manager'
      and projected#>>'{lifecycle,nextWork,actionCode}'='reject_request'
      and projected#>>'{lifecycle,decisionRecommendation,decisionReady}'='true'
    from public.refund_cases c
    cross join lateral (
      select public.refund_next_work_for_case(c.id,
        public.refund_lifecycle_contract(c.id)) lifecycle
    ) canonical
    cross join lateral (
      select public.refund_project_current_next_work_cases(jsonb_build_array(
        jsonb_build_object(
          'id',c.id,'officialActionVersion',c.official_action_version,
          'nayaxLookupWork',jsonb_build_object('state','complete'),
          'lifecycle',jsonb_set(jsonb_set(canonical.lifecycle,
            '{nextWork,actor}','"system"'::jsonb,true),
            '{nextWork,actionCode}','"wait"'::jsonb,true))))->0 projected
    ) repaired
    where c.id=md5('refund-overview-bench-case-11')::uuid),
  'a malformed valid-version rejection actor is recomputed from canonical truth');

select * from finish();
rollback;
