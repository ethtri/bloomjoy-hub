begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select plan(10);

create function pg_temp.set_auth_claims(p_user_id uuid)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub',p_user_id::text,true);
  perform set_config('request.jwt.claim.role','authenticated',true);
  perform set_config('request.jwt.claims',jsonb_build_object(
    'sub',p_user_id,'role','authenticated','is_anonymous',false)::text,true);
end $$;

select ok(has_function_privilege('authenticated',
  'public.get_refund_portal_queue_projection(timestamptz)','execute'),
  'authenticated managers can read the small queue projection');
select ok(not has_function_privilege('anon',
  'public.get_refund_portal_queue_projection(timestamptz)','execute'),
  'anonymous users cannot read the queue projection');
select ok(not has_function_privilege('service_role',
  'public.get_refund_portal_queue_projection(timestamptz)','execute'),
  'service jobs cannot substitute for the current portal actor');
select ok((select proconfig @> array['statement_timeout=8s']
    from pg_proc where oid=
      'public.get_refund_portal_queue_projection(timestamptz)'::regprocedure),
  'the queue projection has a bounded runtime');

insert into auth.users(
  instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values
  ('00000000-0000-0000-0000-000000000000','aa450000-0000-4000-8000-000000000001',
   'authenticated','authenticated','portal-queue-admin@example.invalid','',now(),'{}','{}',now(),now());
insert into public.customer_accounts(id,name,account_type)
values('aa451000-0000-4000-8000-000000000001','Portal queue account','internal');
insert into public.reporting_locations(id,account_id,name,timezone)
values('aa452000-0000-4000-8000-000000000001',
  'aa451000-0000-4000-8000-000000000001','Portal queue location','America/Los_Angeles');
insert into public.reporting_machines(
  id,account_id,location_id,machine_label,refund_public_display_label)
values('aa453000-0000-4000-8000-000000000001',
  'aa451000-0000-4000-8000-000000000001',
  'aa452000-0000-4000-8000-000000000001','Private queue machine','Queue machine');
insert into public.reporting_machine_refund_managers(
  id,reporting_machine_id,manager_user_id,manager_email,grant_reason)
values('aa454000-0000-4000-8000-000000000001',
  'aa453000-0000-4000-8000-000000000001',
  'aa450000-0000-4000-8000-000000000001',
  'portal-queue-admin@example.invalid','Portal queue test');
insert into public.refund_cases(
  id,public_reference,reporting_machine_id,reporting_location_id,
  customer_email,issue_summary,incident_at,payment_method,payment_amount_cents,
  status,correlation_status,correlation_source,automation_state,
  deterministic_fact_version,created_at)
values('aa455000-0000-4000-8000-000000000001','RF-QUEUE-0001',
  'aa453000-0000-4000-8000-000000000001','aa452000-0000-4000-8000-000000000001',
  'portal-queue-customer@example.invalid','Portal queue test',now()-interval '1 day',
  'card',500,'needs_review','needs_nayax','nayax','under_review',1,now()-interval '1 day');

set local role authenticated;
select pg_temp.set_auth_claims('aa450000-0000-4000-8000-000000000001');
create temporary table queue_projection on commit drop as
select public.get_refund_portal_queue_projection(statement_timestamp()) value;
select is((select value->>'schemaVersion' from queue_projection),
  'refund_portal_queue_v1','the queue projection publishes its exact version');
select is((select jsonb_array_length(value->'items')::text from queue_projection),
  '1','the authorized queue returns the visible case once');
select ok((select value->'items'->0->>'publicReference'='RF-QUEUE-0001'
    and value->'items'->0->>'payloadRedacted'='true'
    and value->'items'->0 ? 'nextWorkActionLabel'
    and not (value->'items'->0 ? 'customerEmail')
    and not (value->'items'->0 ? 'customerName')
  from queue_projection),
  'queue items contain current work copy without customer PII');
select ok((select (value->'counts'->>'allOpen')::integer
      +(value->'counts'->>'completed')::integer=1
    and value->>'refundOperationsAccess'='false'
    and value->>'payloadRedacted'='true'
  from queue_projection),
  'queue counts cover every visible customer case exactly once');

reset role;
delete from public.reporting_machine_refund_managers
where id='aa454000-0000-4000-8000-000000000001';
set local role authenticated;
select throws_ok(
  $$select public.get_refund_portal_queue_projection()$$,
  '42501','Refund operations access required',
  'a former machine manager cannot reuse access after the mapping is removed');
select set_config('request.jwt.claims',jsonb_build_object(
  'sub','aa450000-0000-4000-8000-000000000001',
  'role','authenticated','is_anonymous',true)::text,true);
select throws_ok(
  $$select public.get_refund_portal_queue_projection()$$,
  '42501','Authentication required',
  'anonymous authenticated sessions cannot read private refund cases');

select * from finish();
rollback;
