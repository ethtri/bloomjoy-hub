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
set local statement_timeout='7500ms';
select lives_ok($test$
  select public.admin_get_refund_operations_overview()
$test$,'production-shaped authenticated overview stays below the API timeout');
reset role;

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

select * from finish();
rollback;
