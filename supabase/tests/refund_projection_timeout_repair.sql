begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();

select ok(strpos(pg_get_functiondef(
    'public.refund_decision_recommendation_for_case(uuid,timestamptz)'::regprocedure),
    'conservative superset of every supported')>0,
  'recommendation projection has the guarded impossible-evidence fast path');
select ok(strpos(pg_get_functiondef(
    'public.service_refund_manager_ready_notice_snapshot(uuid,uuid,timestamptz)'::regprocedure),
    'Delegate only when the')>0,
  'ready snapshot reuses non-Manager lifecycle truth before legacy delegation');

insert into auth.users (
  instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values
  ('00000000-0000-0000-0000-000000000000','a9500000-0000-4000-8000-000000000001',
    'authenticated','authenticated','projection-one@example.invalid','',now(),'{}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','a9500000-0000-4000-8000-000000000002',
    'authenticated','authenticated','projection-two@example.invalid','',now(),'{}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','a9500000-0000-4000-8000-000000000003',
    'authenticated','authenticated','projection-three@example.invalid','',now(),'{}','{}',now(),now());
insert into public.customer_accounts(id,name,account_type)
values ('a9510000-0000-4000-8000-000000000001','Projection benchmark account','customer');
insert into public.reporting_locations(id,account_id,name,timezone)
values ('a9520000-0000-4000-8000-000000000001',
  'a9510000-0000-4000-8000-000000000001','Projection benchmark location',
  'America/Los_Angeles');
insert into public.reporting_machines(
  id,account_id,location_id,machine_label,refund_public_display_label)
values
  ('a9530000-0000-4000-8000-000000000001',
    'a9510000-0000-4000-8000-000000000001',
    'a9520000-0000-4000-8000-000000000001','Benchmark private one','Benchmark one'),
  ('a9530000-0000-4000-8000-000000000002',
    'a9510000-0000-4000-8000-000000000001',
    'a9520000-0000-4000-8000-000000000001','Benchmark private two','Benchmark two');
insert into public.reporting_machine_refund_managers(
  id,reporting_machine_id,manager_user_id,manager_email,grant_reason)
values
  ('a9540000-0000-4000-8000-000000000001',
    'a9530000-0000-4000-8000-000000000001',
    'a9500000-0000-4000-8000-000000000001',
    'projection-one@example.invalid','Projection benchmark'),
  ('a9540000-0000-4000-8000-000000000002',
    'a9530000-0000-4000-8000-000000000001',
    'a9500000-0000-4000-8000-000000000002',
    'projection-two@example.invalid','Projection benchmark'),
  ('a9540000-0000-4000-8000-000000000003',
    'a9530000-0000-4000-8000-000000000002',
    'a9500000-0000-4000-8000-000000000003',
    'projection-three@example.invalid','Projection benchmark');

-- Match the current production cardinality: 78 cases and 152 active
-- case/manager mappings. These rows have open work but no evidence shape that
-- can produce a refund or rejection recommendation.
insert into public.refund_cases(
  id,public_reference,reporting_machine_id,reporting_location_id,
  customer_email,issue_summary,incident_at,payment_method,payment_amount_cents,
  status,correlation_status,correlation_source,automation_state,
  deterministic_fact_version,created_at)
select md5('refund-projection-bench-case-'||n)::uuid,
  'RF-PERF-'||lpad(n::text,4,'0'),
  case when n<=74 then 'a9530000-0000-4000-8000-000000000001'::uuid
    else 'a9530000-0000-4000-8000-000000000002'::uuid end,
  'a9520000-0000-4000-8000-000000000001',
  'projection-customer-'||n||'@example.invalid','Private benchmark case',
  statement_timestamp()-interval '2 days',
  case when n%2=0 then 'cash' else 'card' end,
  500,'needs_review','not_started',null,'under_review',1,
  statement_timestamp()-interval '2 days'
from generate_series(1,78) n;

select is((select count(*)::text
    from public.refund_cases c
    join public.reporting_machine_refund_managers m
      on m.reporting_machine_id=c.reporting_machine_id
      and m.status='active' and m.revoked_at is null
    where c.public_reference like 'RF-PERF-%'),'152',
  'benchmark contains the production-sized 152 case/manager mappings');
select is(public.refund_decision_recommendation_for_case(
    md5('refund-projection-bench-case-1')::uuid)::text,null::text,
  'untouched card intake has no recommendation');
select is(public.refund_decision_recommendation_for_case(
    md5('refund-projection-bench-case-2')::uuid)::text,null::text,
  'cash intake without a completed match state has no recommendation');

set local role service_role;
set local statement_timeout='7500ms';
select lives_ok($test$
  select public.service_enqueue_refund_manager_ready_notices(
    null,statement_timestamp())
$test$,'production-sized zero-ready enqueue stays below the API timeout');
reset role;
select is((select count(*)::text from public.refund_manager_notification_actions
    where notice_reason='decision_ready'),'0',
  'zero-ready scan does not create Manager notification work');

-- A saved cash approval remains a genuine legacy Manager action and must pass
-- the new delegation guard for both current managers.
insert into public.refund_cases(
  id,public_reference,reporting_machine_id,reporting_location_id,
  customer_email,issue_summary,incident_at,payment_method,payment_amount_cents,
  refund_amount_cents,zelle_payment_contact,status,decision,
  correlation_status,correlation_source,automation_state,
  deterministic_fact_version,created_at)
values ('a9550000-0000-4000-8000-000000000001','RF-PERF-APPROVED',
  'a9530000-0000-4000-8000-000000000001',
  'a9520000-0000-4000-8000-000000000001',
  'approved-projection@example.invalid','Private approved payout',
  statement_timestamp()-interval '1 day','cash',900,900,
  'verified-payout-destination','cash_zelle_pending','approved',
  'matched','manual','under_review',1,statement_timestamp()-interval '1 day');
set local role service_role;
select is(public.service_refund_manager_ready_notice_snapshot(
    'a9550000-0000-4000-8000-000000000001',
    'a9500000-0000-4000-8000-000000000001')->>'evidenceBasis',
  'cash_approved_payout','approved cash still delegates to the legacy payout proof');
create temporary table approved_fingerprints on commit drop as
select public.service_refund_manager_ready_notice_snapshot(
    'a9550000-0000-4000-8000-000000000001',manager_id)
    ->>'decisionFingerprint' fingerprint
from (values
  ('a9500000-0000-4000-8000-000000000001'::uuid),
  ('a9500000-0000-4000-8000-000000000002'::uuid)) manager(manager_id);
select is((select count(distinct fingerprint)::text from approved_fingerprints),'1',
  'co-managers retain one stable material decision fingerprint');
select is(public.service_enqueue_refund_manager_ready_notices(
    'a9550000-0000-4000-8000-000000000001')->>'queuedCount','2',
  'approved cash enqueues one intent for each current manager');
select is(public.service_enqueue_refund_manager_ready_notices(
    'a9550000-0000-4000-8000-000000000001')->>'queuedCount','0',
  'replayed enqueue does not report or create duplicate intents');
select is((select count(*)::text from public.refund_manager_notification_actions
    where refund_case_id='a9550000-0000-4000-8000-000000000001'
      and notice_reason='decision_ready'),'2',
  'approved cash retains exactly two co-manager intents after replay');
reset role;

select * from finish();
rollback;
