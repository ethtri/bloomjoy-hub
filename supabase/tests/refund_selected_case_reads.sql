begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select plan(31);

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
-- Larger authorized queue: detail reads must still project just the target.
insert into public.refund_cases(id,public_reference,reporting_machine_id,reporting_location_id,
 customer_email,issue_summary,incident_at,payment_method,payment_amount_cents,status,
 correlation_status,correlation_source,automation_state,deterministic_fact_version,created_at)
select ('aa455000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'RF-SCOPED-'||n,
 'aa453000-0000-4000-8000-000000000001','aa452000-0000-4000-8000-000000000001',
 'scope-'||n||'@example.invalid','Synthetic separate purchase',now()-interval '1 day',
 'card',500,'needs_review','needs_nayax','nayax','under_review',1,now()-interval '1 day'
from generate_series(2,95) n;
select ok(has_function_privilege('authenticated','public.get_refund_portal_case_detail(uuid)','execute'),'authenticated selected-case read is available');
select ok(not has_function_privilege('anon','public.get_refund_portal_case_detail(uuid)','execute'),'anonymous role cannot execute case detail');
select ok(not has_function_privilege('service_role','public.get_refund_portal_case_detail(uuid)','execute'),'service role cannot replace the current case actor');
create temporary table lifecycle_parity on commit drop as select
 public.get_refund_lifecycle_for_manager('aa455000-0000-4000-8000-000000000001') current,
 private.refund_manager_lifecycle_pre_read_v1('aa455000-0000-4000-8000-000000000001') prior;
select is((select current->'nextWork' from lifecycle_parity),(select prior->'nextWork' from lifecycle_parity),'reuse retains exact canonical next-work truth');
set local role authenticated;
create temporary table full_evidence on commit drop as select public.admin_get_refund_operations_overview() value;
create temporary table case_evidence on commit drop as select public.get_refund_portal_case_detail('aa455000-0000-4000-8000-000000000001') value;
select is((select jsonb_array_length(value->'cases') from case_evidence),1,'case read returns exactly one authorized target');
select is((select value->'cases'->0 from case_evidence),(select item from full_evidence,jsonb_array_elements(value->'cases') item where item->>'id'='aa455000-0000-4000-8000-000000000001'),'all target evidence matches compatible full overview');
select is((select value#>'{cases,0,nayaxLookupCandidates}' from case_evidence),(select item->'nayaxLookupCandidates' from full_evidence,jsonb_array_elements(value->'cases') item where item->>'id'='aa455000-0000-4000-8000-000000000001'),'alternate candidate coverage is unchanged');
select is(coalesce(current_setting('bloomjoy.refund_read_case_id',true),''),'','selected read restores its transaction scope');
select is(jsonb_array_length(public.admin_get_refund_operations_overview()->'cases'),95,'later legacy read still returns the full authorized queue');
create function pg_temp.benchmark_refund_reads(p_count integer,p_queue boolean)
returns table(read_count integer,slowest_ms numeric) language plpgsql as $$
declare started timestamptz; value jsonb; elapsed numeric; array_key text; expected_count integer;
begin
 read_count:=0; slowest_ms:=0;
 array_key:='cases'; expected_count:=1;
 if p_queue then array_key:='items'; expected_count:=95; end if;
 for n in 1..p_count loop
  started:=clock_timestamp();
  value:=case when p_queue then public.get_refund_portal_queue_projection()
    else public.get_refund_portal_case_detail('aa455000-0000-4000-8000-000000000001') end;
  elapsed:=extract(epoch from clock_timestamp()-started)*1000;
  slowest_ms:=greatest(slowest_ms,elapsed);
  if jsonb_array_length(value->array_key)=expected_count then
   read_count:=read_count+1;
  end if;
 end loop;
 return next;
end $$;
create temporary table detail_timings on commit drop as select * from pg_temp.benchmark_refund_reads(20,false);
create temporary table queue_timings on commit drop as select * from pg_temp.benchmark_refund_reads(3,true);
select is((select read_count from detail_timings),20,'twenty independently executed reads retain exactly one case');
select ok((select slowest_ms<3000 from detail_timings),'selected reads meet the three-second target in the 95-case synthetic database');
select ok((select read_count=3 and slowest_ms<3000 from queue_timings),'three fresh queue reads meet the three-second target in the synthetic database');
select diag('95 synthetic cases: selected maximum '||(select round(slowest_ms,2) from detail_timings)||' ms; queue maximum '||(select round(slowest_ms,2) from queue_timings)||' ms. Production mobile/network timing still requires deployment verification.');
select ok((select octet_length(value::text) from case_evidence)<(select octet_length(value::text) from full_evidence),'scoped payload is smaller without dropping target evidence');
select throws_ok($$select public.get_refund_portal_case_detail('aa455000-0000-4000-8000-000000000099')$$,'42501','Current refund case access required','unknown or unauthorized case does not disclose evidence');
select ok(has_function_privilege('authenticated','public.search_refund_portal_queue(text)','execute'),'authorized portal roles can search');
select ok(not has_function_privilege('anon','public.search_refund_portal_queue(text)','execute'),'anonymous role cannot search');
select ok(not has_function_privilege('service_role','public.search_refund_portal_queue(text)','execute'),'service role cannot search as a manager');
select is(public.search_refund_portal_queue('portal-queue-customer@example.invalid'),'["aa455000-0000-4000-8000-000000000001"]'::jsonb,'customer email search returns only the matching authorized ID');
select is(public.search_refund_portal_queue('PORTAL QUEUE TEST'),'["aa455000-0000-4000-8000-000000000001"]'::jsonb,'comment search remains case insensitive and returns IDs only');
select is(public.search_refund_portal_queue('  '),'[]'::jsonb,'empty search cannot dump the case inventory');

reset role;
delete from public.reporting_machine_refund_managers
where id='aa454000-0000-4000-8000-000000000001';
set local role authenticated;
select throws_ok(
  $$select public.get_refund_portal_queue_projection()$$,
  '42501','Refund operations access required',
  'a former machine manager cannot reuse access after the mapping is removed');
select throws_ok($$select public.search_refund_portal_queue('portal')$$,'42501','Refund operations access required','search access is revoked with the manager assignment');
select set_config('request.jwt.claims',jsonb_build_object(
  'sub','aa450000-0000-4000-8000-000000000001',
  'role','authenticated','is_anonymous',true)::text,true);
select throws_ok(
  $$select public.get_refund_portal_queue_projection()$$,
  '42501','Authentication required',
  'anonymous authenticated sessions cannot read private refund cases');

select * from finish();
rollback;
