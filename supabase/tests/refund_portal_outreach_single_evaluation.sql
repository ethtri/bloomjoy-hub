begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();

-- Clone the actual retained reader with its old expression, and instrument the
-- real current outreach contract. Neither the canonical lifecycle nor privacy
-- projections are mocked; all changes disappear at rollback.
do $clone$
declare definition text; current_expression text := $expression$  outreach jsonb := case
    when jsonb_typeof(base -> 'customerOutreach') = 'object'
      then base -> 'customerOutreach'
    else public.refund_customer_outreach_contract(p_refund_case_id)
  end;$expression$;
begin
  definition:=replace(pg_get_functiondef(
    'public.get_refund_lifecycle_for_manager_pre_next_work_v1(uuid)'::regprocedure),E'\r\n',E'\n');
  if length(definition)-length(replace(definition,current_expression,''))<>length(current_expression) then
    raise exception 'Exact optimized reader is required';
  end if;
  execute replace(replace(definition,
    'public.get_refund_lifecycle_for_manager_pre_next_work_v1(', 'pg_temp.manager_outreach_before_reuse('),
    current_expression,'  outreach jsonb := public.refund_customer_outreach_contract(p_refund_case_id);');
  definition:=pg_get_functiondef('public.get_refund_lifecycle_for_manager(uuid)'::regprocedure);
  execute replace(replace(definition,'public.get_refund_lifecycle_for_manager(', 'pg_temp.manager_before_reuse('),
    'public.get_refund_lifecycle_for_manager_pre_next_work_v1(', 'pg_temp.manager_outreach_before_reuse(');
  definition:=pg_get_functiondef('public.refund_customer_outreach_contract(uuid)'::regprocedure);
  execute replace(definition,'public.refund_customer_outreach_contract(', 'pg_temp.original_outreach(');
end;
$clone$;
create temporary sequence outreach_evaluations;
create or replace function public.refund_customer_outreach_contract(p_refund_case_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  perform nextval('pg_temp.outreach_evaluations');
  return pg_temp.original_outreach(p_refund_case_id);
end $$;

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
 raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values
 ('00000000-0000-0000-0000-000000000000','ab450000-0000-4000-8000-000000000001',
  'authenticated','authenticated','reuse-manager@example.invalid','',now(),'{}','{}',now(),now()),
 ('00000000-0000-0000-0000-000000000000','ab450000-0000-4000-8000-000000000002',
  'authenticated','authenticated','reuse-admin@example.invalid','',now(),'{}','{}',now(),now());
insert into public.admin_roles(user_id,role,active)
values('ab450000-0000-4000-8000-000000000002','super_admin',true);
insert into public.customer_accounts(id,name,account_type)
values('ab451000-0000-4000-8000-000000000001','Outreach reuse','customer');
insert into public.reporting_locations(id,account_id,name,timezone)
values('ab452000-0000-4000-8000-000000000001',
 'ab451000-0000-4000-8000-000000000001','Reuse place','America/Los_Angeles');
insert into public.reporting_machines(id,account_id,location_id,machine_label)
values('ab453000-0000-4000-8000-000000000001','ab451000-0000-4000-8000-000000000001',
 'ab452000-0000-4000-8000-000000000001','Reuse machine');
insert into public.reporting_machine_refund_managers(
 reporting_machine_id,manager_user_id,manager_email,grant_reason)
values('ab453000-0000-4000-8000-000000000001','ab450000-0000-4000-8000-000000000001',
 'reuse-manager@example.invalid','Synthetic reuse fixture');
insert into public.refund_cases(id,public_reference,reporting_machine_id,reporting_location_id,
 customer_email,issue_summary,status,intake_source,incident_at,incident_local_datetime,
 incident_timezone,incident_time_resolution,incident_time_confidence,payment_method,
 payment_interaction,card_last4,card_last4_provenance,card_wallet_used,correlation_status)
values('ab455000-0000-4000-8000-000000000001','RF-OUTREACH-REUSE',
 'ab453000-0000-4000-8000-000000000001','ab452000-0000-4000-8000-000000000001',
 'reuse-customer@example.invalid','Synthetic missing information','needs_review','gmail',
 now()-interval '2 hours',to_char((now()-interval '2 hours') at time zone 'America/Los_Angeles',
 'YYYY-MM-DD"T"HH24:MI'),'America/Los_Angeles','exact','exact','card','tap_card','1234',
 'physical_card',false,'manual_review');

create function pg_temp.set_actor(p_id uuid) returns void language plpgsql as $$
begin
 perform set_config('request.jwt.claim.sub',p_id::text,true);
 perform set_config('request.jwt.claim.role','authenticated',true);
 perform set_config('request.jwt.claims',jsonb_build_object(
 'sub',p_id,'role','authenticated','is_anonymous',false)::text,true);
end $$;
create function pg_temp.compare_readers(p_label text)
returns setof text language plpgsql as $$
declare current_value jsonb; old_value jsonb; current_calls bigint; old_calls bigint;
begin
 perform setval('pg_temp.outreach_evaluations',1,false);
 current_value:=public.get_refund_lifecycle_for_manager('ab455000-0000-4000-8000-000000000001');
 select last_value into current_calls from outreach_evaluations;
 perform setval('pg_temp.outreach_evaluations',1,false);
 old_value:=pg_temp.manager_before_reuse('ab455000-0000-4000-8000-000000000001');
 select last_value into old_calls from outreach_evaluations;
 return next is(current_value,old_value,p_label||': complete Manager payload parity');
 return next is(current_calls,1::bigint,p_label||': canonical outreach evaluated once');
 return next is(old_calls,2::bigint,p_label||': former reader repeated real outreach work');
end $$;

select pg_temp.set_actor('ab450000-0000-4000-8000-000000000001');
select * from pg_temp.compare_readers('No active clarification');
update public.refund_customer_contact_settings set automatic_customer_contact_enabled=true where singleton;
create temp table claimed_cycle as select public.service_claim_refund_follow_up_cycle(
 'ab455000-0000-4000-8000-000000000001','missing_information',
 (select template_version from public.refund_customer_contact_settings where singleton),
 repeat('a',64),null) value;
select is((select value->>'claimed' from claimed_cycle),'true','A real supported synthetic clarification was claimed');
select * from pg_temp.compare_readers('Preparing clarification');
update public.refund_customer_contact_settings set automatic_customer_contact_enabled=false where singleton;
select * from pg_temp.compare_readers('Contact policy disabled');
select pg_temp.set_actor('ab450000-0000-4000-8000-000000000002');
select * from pg_temp.compare_readers('Current Super-admin');
select pg_temp.set_actor('ab450000-0000-4000-8000-000000000001');
delete from public.reporting_machine_refund_managers
where manager_user_id='ab450000-0000-4000-8000-000000000001';
select throws_ok($$select public.get_refund_lifecycle_for_manager('ab455000-0000-4000-8000-000000000001')$$,
 '42501','Current refund case access required','Revoked Manager scope stays denied');
select set_config('request.jwt.claims',jsonb_build_object(
 'sub','ab450000-0000-4000-8000-000000000002','role','authenticated','is_anonymous',true)::text,true);
select throws_ok($$select public.get_refund_lifecycle_for_manager('ab455000-0000-4000-8000-000000000001')$$,
 '42501','Current refund case access required','Anonymous sessions stay denied');
select ok(not has_function_privilege('authenticated',
 'public.get_refund_lifecycle_for_manager_pre_next_work_v1(uuid)','execute'),
 'The reused private reader remains inaccessible to authenticated callers');
select * from finish();
rollback;
